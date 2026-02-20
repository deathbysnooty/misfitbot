export function createSchedulerService({
  client,
  db,
  autoPurgeModes,
  clampPurgeScanLimit,
  schedulerPollMs,
}) {
  let schedulerTimer = null;
  let schedulerBusy = false;
  let autoPurgeBusy = false;
  let reminderBusy = false;
  let messageTtlBusy = false;

  async function isMessageAuthorAdmin(msg, memberPermCache) {
    if (!msg?.guild || !msg?.author?.id) return false;

    const uid = msg.author.id;
    if (memberPermCache.has(uid)) return memberPermCache.get(uid);

    let isAdmin = false;
    if (msg.member?.permissions?.has("Administrator")) {
      isAdmin = true;
    } else {
      try {
        const member = await msg.guild.members.fetch(uid);
        isAdmin = member?.permissions?.has("Administrator") || false;
      } catch {
        isAdmin = false;
      }
    }

    memberPermCache.set(uid, isAdmin);
    return isAdmin;
  }

  async function collectMessagesForPurge(channel, mode, scanLimit) {
    const collected = [];
    let before = undefined;

    while (collected.length < scanLimit) {
      const remaining = scanLimit - collected.length;
      const pageSize = remaining > 100 ? 100 : remaining;
      const page = await channel.messages.fetch({ limit: pageSize, before });
      if (!page || page.size === 0) break;

      const arr = [...page.values()];
      collected.push(...arr);
      before = arr[arr.length - 1]?.id;
      if (!before) break;
    }

    const memberPermCache = new Map();
    const matches = [];
    for (const m of collected) {
      if (mode === "all") {
        matches.push(m);
        continue;
      }
      if (mode === "media") {
        if (m.attachments?.size > 0) matches.push(m);
        continue;
      }
      if (mode === "nonadmin") {
        const isAdmin = await isMessageAuthorAdmin(m, memberPermCache);
        if (!isAdmin) matches.push(m);
      }
    }
    return matches;
  }

  async function purgeMessagesInChannel(channel, mode, scanLimit) {
    if (!channel?.isTextBased() || typeof channel.bulkDelete !== "function") {
      throw new Error("Target channel does not support bulk message deletion.");
    }
    if (!autoPurgeModes.has(mode)) throw new Error("Invalid purge mode.");

    const candidates = await collectMessagesForPurge(channel, mode, scanLimit);
    if (candidates.length === 0) {
      return {
        scanned: scanLimit,
        matched: 0,
        deleted: 0,
        tooOld: 0,
      };
    }

    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const youngIds = [];
    let tooOld = 0;

    for (const m of candidates) {
      if (now - m.createdTimestamp < fourteenDaysMs) youngIds.push(m.id);
      else tooOld += 1;
    }

    let deleted = 0;
    for (let i = 0; i < youngIds.length; i += 100) {
      const chunk = youngIds.slice(i, i + 100);
      if (chunk.length === 0) continue;
      const res = await channel.bulkDelete(chunk, true);
      deleted += res?.size || 0;
    }

    return {
      scanned: scanLimit,
      matched: candidates.length,
      deleted,
      tooOld,
    };
  }

  async function processDueScheduledMessages() {
    if (schedulerBusy) return;
    schedulerBusy = true;
    try {
      const now = Math.floor(Date.now() / 1000);
      const due = db
        .prepare(
          `SELECT id, channel_id, content, media_json, payload_type, embed_json, send_at, interval_minutes
           FROM scheduled_messages
           WHERE active = 1 AND send_at <= ?
           ORDER BY send_at ASC
           LIMIT 20`
        )
        .all(now);

      for (const row of due) {
        try {
          const ch = await client.channels.fetch(row.channel_id).catch(() => null);
          if (!ch?.isTextBased()) {
            throw new Error("Target channel not found or not text-based.");
          }

          let media = [];
          try {
            media = JSON.parse(row.media_json || "[]");
          } catch {}
          media = Array.isArray(media) ? media.filter(Boolean).slice(0, 10) : [];

          const content = String(row.content || "").trim().slice(0, 1900);
          const isEmbed = String(row.payload_type || "text") === "embed";

          let embed = null;
          if (isEmbed) {
            try {
              const parsed = JSON.parse(row.embed_json || "{}");
              if (parsed && typeof parsed === "object") embed = parsed;
            } catch {}
          }

          if (!content && media.length === 0 && !embed) {
            throw new Error("Scheduled payload is empty.");
          }

          const payload = {
            content: isEmbed ? undefined : content || undefined,
            files: media,
          };
          if (embed) payload.embeds = [embed];

          await ch.send(payload);

          if ((row.interval_minutes || 0) > 0) {
            const intervalSec = row.interval_minutes * 60;
            let next = Number(row.send_at) + intervalSec;
            while (next <= now) next += intervalSec;

            db.prepare(`
              UPDATE scheduled_messages
              SET send_at = ?, last_error = '', updated_at = strftime('%s','now')
              WHERE id = ?
            `).run(next, row.id);
          } else {
            db.prepare(`
              UPDATE scheduled_messages
              SET active = 0, last_error = '', updated_at = strftime('%s','now')
              WHERE id = ?
            `).run(row.id);
          }
        } catch (err) {
          const errText = String(err?.message || err || "unknown error").slice(
            0,
            240
          );
          const retryAt = now + 60;
          db.prepare(`
            UPDATE scheduled_messages
            SET send_at = ?, last_error = ?, updated_at = strftime('%s','now')
            WHERE id = ?
          `).run(retryAt, errText, row.id);
          console.error(`Scheduled send failed #${row.id}:`, err);
        }
      }
    } finally {
      schedulerBusy = false;
    }
  }

  async function processDueAutoPurgeRules() {
    if (autoPurgeBusy) return;
    autoPurgeBusy = true;
    try {
      const now = Math.floor(Date.now() / 1000);
      const dueRules = db
        .prepare(
          `SELECT id, guild_id, channel_id, mode, interval_minutes, interval_seconds, scan_limit
           FROM auto_purge_rules
           WHERE active = 1 AND next_run_at <= ?
           ORDER BY next_run_at ASC
           LIMIT 10`
        )
        .all(now);

      for (const rule of dueRules) {
        try {
          const ch = await client.channels.fetch(rule.channel_id).catch(() => null);
          if (!ch?.isTextBased()) throw new Error("Channel unavailable.");

          await purgeMessagesInChannel(
            ch,
            String(rule.mode || "all"),
            clampPurgeScanLimit(rule.scan_limit, 200)
          );

          const intervalSec =
            Number(rule.interval_seconds || 0) > 0
              ? Math.max(1, Number(rule.interval_seconds))
              : Math.max(1, Number(rule.interval_minutes || 1)) * 60;
          let next = now + intervalSec;
          if (next <= now) next = now + intervalSec;

          db.prepare(`
            UPDATE auto_purge_rules
            SET next_run_at = ?, last_error = '', updated_at = strftime('%s','now')
            WHERE id = ?
          `).run(next, rule.id);
        } catch (err) {
          const errText = String(err?.message || err || "unknown error").slice(
            0,
            240
          );
          const retryAt = now + 60;
          db.prepare(`
            UPDATE auto_purge_rules
            SET next_run_at = ?, last_error = ?, updated_at = strftime('%s','now')
            WHERE id = ?
          `).run(retryAt, errText, rule.id);
          console.error(`Auto purge failed #${rule.id}:`, err);
        }
      }
    } finally {
      autoPurgeBusy = false;
    }
  }

  async function processDueReminders() {
    if (reminderBusy) return;
    reminderBusy = true;
    try {
      const now = Math.floor(Date.now() / 1000);
      const due = db
        .prepare(
          `SELECT id, user_id, guild_id, message, send_at, interval_seconds
           FROM user_reminders
           WHERE active = 1 AND send_at <= ?
           ORDER BY send_at ASC
           LIMIT 30`
        )
        .all(now);

      for (const row of due) {
        try {
          const user = await client.users.fetch(row.user_id).catch(() => null);
          if (!user) throw new Error("User not found.");

          const content = String(row.message || "").trim().slice(0, 1800);
          if (!content) throw new Error("Reminder message empty.");
          const guild =
            client.guilds.cache.get(row.guild_id) ||
            (await client.guilds.fetch(row.guild_id).catch(() => null));
          const guildLabel = guild?.name || `Unknown Server (${row.guild_id})`;

          await user.send(
            [
              "⏰ Reminder",
              `Server: ${guildLabel}`,
              `Message: ${content}`,
              `Scheduled for: <t:${Number(row.send_at)}:F>`,
            ].join("\n")
          );

          const intervalSeconds = Math.max(0, Number(row.interval_seconds || 0));
          if (intervalSeconds > 0) {
            let next = Number(row.send_at) + intervalSeconds;
            while (next <= now) next += intervalSeconds;
            db.prepare(`
              UPDATE user_reminders
              SET send_at = ?, last_error = '', updated_at = strftime('%s','now')
              WHERE id = ?
            `).run(next, row.id);
          } else {
            db.prepare(`
              UPDATE user_reminders
              SET active = 0, last_error = '', updated_at = strftime('%s','now')
              WHERE id = ?
            `).run(row.id);
          }
        } catch (err) {
          const errText = String(err?.message || err || "unknown error").slice(0, 240);
          const retryAt = now + 300;
          db.prepare(`
            UPDATE user_reminders
            SET send_at = ?, last_error = ?, updated_at = strftime('%s','now')
            WHERE id = ?
          `).run(retryAt, errText, row.id);
          console.error(`Reminder send failed #${row.id}:`, err);
        }
      }
    } finally {
      reminderBusy = false;
    }
  }

  async function processDueMessageTtlDeletes() {
    if (messageTtlBusy) return;
    messageTtlBusy = true;
    try {
      const now = Math.floor(Date.now() / 1000);
      const due = db
        .prepare(
          `SELECT message_id, guild_id, channel_id
           FROM message_ttl_queue
           WHERE active = 1 AND delete_at <= ?
           ORDER BY delete_at ASC
           LIMIT 100`
        )
        .all(now);

      for (const row of due) {
        try {
          const channel = await client.channels.fetch(row.channel_id).catch(() => null);
          if (!channel?.isTextBased()) {
            throw new Error("Channel unavailable.");
          }

          const msg = await channel.messages.fetch(row.message_id).catch(() => null);
          if (msg) await msg.delete().catch(() => null);

          db.prepare(`
            UPDATE message_ttl_queue
            SET active = 0, last_error = '', updated_at = strftime('%s','now')
            WHERE message_id = ?
          `).run(row.message_id);
        } catch (err) {
          const errText = String(err?.message || err || "unknown error").slice(0, 240);
          db.prepare(`
            UPDATE message_ttl_queue
            SET delete_at = ?, last_error = ?, updated_at = strftime('%s','now')
            WHERE message_id = ?
          `).run(now + 60, errText, row.message_id);
          console.error(`Message TTL delete failed #${row.message_id}:`, err);
        }
      }
    } finally {
      messageTtlBusy = false;
    }
  }

  function startScheduler() {
    if (schedulerTimer) clearInterval(schedulerTimer);
    processDueScheduledMessages().catch((e) =>
      console.error("Scheduler startup tick failed:", e)
    );
    processDueAutoPurgeRules().catch((e) =>
      console.error("Auto-purge startup tick failed:", e)
    );
    processDueReminders().catch((e) =>
      console.error("Reminder startup tick failed:", e)
    );
    processDueMessageTtlDeletes().catch((e) =>
      console.error("Message TTL startup tick failed:", e)
    );
    schedulerTimer = setInterval(() => {
      processDueScheduledMessages().catch((e) =>
        console.error("Scheduler tick failed:", e)
      );
      processDueAutoPurgeRules().catch((e) =>
        console.error("Auto-purge tick failed:", e)
      );
      processDueReminders().catch((e) =>
        console.error("Reminder tick failed:", e)
      );
      processDueMessageTtlDeletes().catch((e) =>
        console.error("Message TTL tick failed:", e)
      );
    }, schedulerPollMs);
    schedulerTimer.unref?.();
  }

  return {
    startScheduler,
    purgeMessagesInChannel,
  };
}
