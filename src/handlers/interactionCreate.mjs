import { AttachmentBuilder } from "discord.js";

export function registerInteractionCreateHandler({
  client,
  openai,
  db,
  OWNER_ID,
  WELCOME_CHANNEL_ID,
  WELCOME_MESSAGE,
  MODE_PRESETS,
  getBotMode,
  setBotMode,
  getProfile,
  upsertProfile,
  setVibe,
  clearProfile,
  getWelcomeConfig,
  upsertWelcomeConfig,
  clearWelcomeConfig,
  getReplyContext,
  makeChatReply,
  transcribeAudioAttachment,
  generateImageFromPrompt,
  generateVoiceFromText,
  formatMessageForChannelSummary,
  purgeMessagesInChannel,
  helpText,
  safeDefer,
  isDiscordUnknownInteraction,
  isAlreadyAcknowledged,
  extractImageUrlsFromMessage,
  extractAudioAttachmentsFromMessage,
  parseDiscordMessageLink,
  parseScheduleTimeToUnixSeconds,
  parseMediaUrlsInput,
  extractAttachmentUrlsFromMessage,
  scheduleTimeLabel,
  clampPurgeScanLimit,
  autoPurgeModes,
  formatWelcomeMessage,
}) {
  async function resolveTargetMessageFromSlash(interaction, optionName = "message") {
    const link = interaction.options.getString(optionName);
    if (link) {
      const parsed = parseDiscordMessageLink(link);
      if (!parsed) return null;
      const ch = await client.channels.fetch(parsed.channelId);
      if (!ch?.isTextBased()) return null;
      return await ch.messages.fetch(parsed.messageId);
    }

    const msgId = getReplyContext(interaction.user.id, interaction.channelId);
    if (!msgId) return null;
    return await interaction.channel.messages.fetch(msgId);
  }

  async function beautifyText(inputText, style = "box") {
    const safeStyle = String(style || "box").toLowerCase();
    const source = String(inputText || "").trim();
    if (!source) return "";

    const lines = source.split(/\r?\n/);
    const maxLen = lines.reduce((m, l) => Math.max(m, l.length), 0);

    const smallCapsMap = {
      a: "ᴀ",
      b: "ʙ",
      c: "ᴄ",
      d: "ᴅ",
      e: "ᴇ",
      f: "ꜰ",
      g: "ɢ",
      h: "ʜ",
      i: "ɪ",
      j: "ᴊ",
      k: "ᴋ",
      l: "ʟ",
      m: "ᴍ",
      n: "ɴ",
      o: "ᴏ",
      p: "ᴘ",
      q: "ǫ",
      r: "ʀ",
      s: "ꜱ",
      t: "ᴛ",
      u: "ᴜ",
      v: "ᴠ",
      w: "ᴡ",
      x: "x",
      y: "ʏ",
      z: "ᴢ",
    };

    const bubbleMap = {
      a: "ⓐ",
      b: "ⓑ",
      c: "ⓒ",
      d: "ⓓ",
      e: "ⓔ",
      f: "ⓕ",
      g: "ⓖ",
      h: "ⓗ",
      i: "ⓘ",
      j: "ⓙ",
      k: "ⓚ",
      l: "ⓛ",
      m: "ⓜ",
      n: "ⓝ",
      o: "ⓞ",
      p: "ⓟ",
      q: "ⓠ",
      r: "ⓡ",
      s: "ⓢ",
      t: "ⓣ",
      u: "ⓤ",
      v: "ⓥ",
      w: "ⓦ",
      x: "ⓧ",
      y: "ⓨ",
      z: "ⓩ",
      "0": "⓪",
      "1": "①",
      "2": "②",
      "3": "③",
      "4": "④",
      "5": "⑤",
      "6": "⑥",
      "7": "⑦",
      "8": "⑧",
      "9": "⑨",
    };

    const leetMap = {
      a: "4",
      e: "3",
      i: "1",
      l: "1",
      o: "0",
      s: "5",
      t: "7",
      b: "8",
      g: "6",
      z: "2",
    };

    if (safeStyle === "code") {
      return `\`\`\`\n${source}\n\`\`\``;
    }

    if (safeStyle === "spaced") {
      return lines
        .map((line) => line.split("").join(" "))
        .join("\n");
    }

    if (safeStyle === "wave") {
      let up = true;
      const waveLines = lines.map((line) =>
        line
          .split("")
          .map((ch) => {
            if (!/[a-z]/i.test(ch)) return ch;
            const out = up ? ch.toUpperCase() : ch.toLowerCase();
            up = !up;
            return out;
          })
          .join("")
      );
      return waveLines.join("\n");
    }

    if (safeStyle === "tinycaps") {
      return lines
        .map((line) =>
          line
            .split("")
            .map((ch) => smallCapsMap[ch.toLowerCase()] || ch)
            .join("")
        )
        .join("\n");
    }

    if (safeStyle === "bubble") {
      return lines
        .map((line) =>
          line
            .split("")
            .map((ch) => bubbleMap[ch.toLowerCase()] || ch)
            .join("")
        )
        .join("\n");
    }

    if (safeStyle === "leet") {
      return lines
        .map((line) =>
          line
            .split("")
            .map((ch) => leetMap[ch.toLowerCase()] || ch)
            .join("")
        )
        .join("\n");
    }

    if (safeStyle === "glitch") {
      const marks = ["~", "^", "*", "`", "!", "+", ":", "."];
      let idx = 0;
      return lines
        .map((line) =>
          line
            .split("")
            .map((ch) => {
              if (!/[a-z0-9]/i.test(ch)) return ch;
              const m = marks[idx % marks.length];
              idx += 1;
              return `${ch}${m}`;
            })
            .join("")
        )
        .join("\n");
    }

    if (safeStyle === "shadow") {
      const top = lines.join("\n");
      const bottom = lines
        .map((line) => ` ${line.replace(/[^\s]/g, ".")}`)
        .join("\n");
      return `${top}\n${bottom}`;
    }

    if (safeStyle === "matrix") {
      const chars = source.replace(/\s+/g, "");
      if (!chars) return source;
      return chars
        .slice(0, 180)
        .split("")
        .map((ch, i) => `${" ".repeat(i % 8)}${ch}`)
        .join("\n");
    }

    if (safeStyle === "staircase") {
      const words = source.split(/\s+/).filter(Boolean);
      return words.map((w, i) => `${" ".repeat(i * 2)}${w}`).join("\n");
    }

    if (safeStyle === "divider") {
      const bar = "=".repeat(Math.max(20, Math.min(60, maxLen + 6)));
      return `${bar}\n${source}\n${bar}`;
    }

    if (safeStyle === "banner") {
      const width = Math.max(28, Math.min(72, maxLen + 8));
      const edge = "=".repeat(width);
      const centered = lines
        .map((line) => {
          const inner = width - 4;
          const trimmed = line.slice(0, inner);
          const left = Math.floor((inner - trimmed.length) / 2);
          const right = inner - trimmed.length - left;
          return `||${" ".repeat(left)}${trimmed}${" ".repeat(right)}||`;
        })
        .join("\n");
      return `${edge}\n${centered}\n${edge}`;
    }

    if (safeStyle === "framed_quote") {
      const quote = lines.map((line) => `> ${line}`).join("\n");
      const top = `/${"-".repeat(maxLen + 4)}\\`;
      const bottom = `\\${"-".repeat(maxLen + 4)}/`;
      return `${top}\n${quote}\n${bottom}`;
    }

    if (safeStyle === "double_box") {
      const top = `#${"=".repeat(maxLen + 2)}#`;
      const body = lines.map((line) => `|| ${line.padEnd(maxLen, " ")} ||`).join("\n");
      return `${top}\n${body}\n${top}`;
    }

    const top = `+${"-".repeat(maxLen + 2)}+`;
    const body = lines.map((line) => `| ${line.padEnd(maxLen, " ")} |`).join("\n");
    return `${top}\n${body}\n${top}`;
  }

  client.on("interactionCreate", async (interaction) => {
    try {
      if (interaction.isMessageContextMenuCommand()) {
        await safeDefer(interaction);

        const targetMsg = interaction.targetMessage;

        if (interaction.commandName === "Misfit: Summarize") {
          const reply = await makeChatReply({
            userId: interaction.user.id,
            userText: "Summarize this.",
            referencedText: targetMsg.content || "",
            imageUrls: extractImageUrlsFromMessage(targetMsg),
          });
          await interaction.editReply(reply.slice(0, 1900));
          return;
        }

        if (interaction.commandName === "Misfit: Explain") {
          const reply = await makeChatReply({
            userId: interaction.user.id,
            userText: "Explain this clearly.",
            referencedText: targetMsg.content || "",
            imageUrls: extractImageUrlsFromMessage(targetMsg),
          });
          await interaction.editReply(reply.slice(0, 1900));
          return;
        }

        if (interaction.commandName === "Misfit: Analyze Image") {
          const imgs = extractImageUrlsFromMessage(targetMsg);
          if (imgs.length === 0) {
            await interaction.editReply("No image found in that message 😌");
            return;
          }
          const reply = await makeChatReply({
            userId: interaction.user.id,
            userText: "Analyze this image.",
            referencedText: targetMsg.content || "",
            imageUrls: imgs,
          });
          await interaction.editReply(reply.slice(0, 1900));
          return;
        }

        if (interaction.commandName === "Misfit: Transcribe Voice") {
          const aud = extractAudioAttachmentsFromMessage(targetMsg);
          if (aud.length === 0) {
            await interaction.editReply("No audio/voice note found 😌");
            return;
          }

          const transcript = await transcribeAudioAttachment(aud[0]);
          if (!transcript) {
            await interaction.editReply("Couldn’t transcribe that 😭");
            return;
          }

          const explain = await makeChatReply({
            userId: interaction.user.id,
            userText: "Explain this transcript briefly and clearly.",
            referencedText: transcript,
            imageUrls: [],
          });

          await interaction.editReply(
            `**Transcript:**\n${transcript}\n\n**Explanation:**\n${explain}`.slice(
              0,
              1900
            )
          );
          return;
        }

        if (interaction.commandName === "Misfit: Voice Note") {
          const text = (targetMsg.content || "").trim();
          if (!text) {
            await interaction.editReply("No text found in that message 😌");
            return;
          }

          const mp3Buf = await generateVoiceFromText(text, "alloy");
          const file = new AttachmentBuilder(mp3Buf, {
            name: "misfit-voicenote.mp3",
          });

          await interaction.editReply({
            content: "🎙️ Voice note ready (alloy).",
            files: [file],
          });
          return;
        }

        if (interaction.commandName === "Misfit: Beautify Text") {
          const text = (targetMsg.content || "").trim();
          if (!text) {
            await interaction.editReply("No text found in that message 😌");
            return;
          }
          const out = await beautifyText(text, "box");
          await interaction.editReply(
            `**Beautified:**\n${out || "I couldn’t beautify that text."}`.slice(0, 1900)
          );
          return;
        }

        await interaction.editReply("Nope. That one isn’t wired up 😌");
        return;
      }

      if (!interaction.isChatInputCommand()) return;

      if (interaction.commandName === "help") {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(helpText);
        } else {
          await interaction.reply({ content: helpText, ephemeral: true });
        }
        return;
      }

      if (interaction.commandName === "welcome") {
        await safeDefer(interaction, { ephemeral: true });

        if (!interaction.guildId) {
          await interaction.editReply("This command only works in a server.");
          return;
        }

        const isOwner = interaction.user.id === OWNER_ID;
        if (!isOwner) {
          await interaction.editReply("Only Snooty can change welcome settings 😌");
          return;
        }

        const sub = interaction.options.getSubcommand();

        if (sub === "set") {
          const channel = interaction.options.getChannel("channel", true);
          const message = interaction.options
            .getString("message", true)
            .trim()
            .slice(0, 1800);

          if (!channel.isTextBased()) {
            await interaction.editReply("Please choose a text channel.");
            return;
          }

          upsertWelcomeConfig(
            interaction.guildId,
            channel.id,
            message,
            interaction.user.id
          );

          const preview = formatWelcomeMessage(
            message,
            interaction.guild?.name || "this server",
            interaction.user.id,
            WELCOME_MESSAGE
          );

          await interaction.editReply(
            `✅ Welcome config saved for <#${channel.id}>.\n\n**Preview:**\n${preview}`.slice(
              0,
              1900
            )
          );
          return;
        }

        if (sub === "show") {
          const cfg = getWelcomeConfig(interaction.guildId);
          if (!cfg) {
            await interaction.editReply(
              [
                "No DB welcome config set for this server.",
                `Current fallback channel: ${
                  WELCOME_CHANNEL_ID ? `<#${WELCOME_CHANNEL_ID}>` : "(system channel)"
                }`,
                "Current fallback message:",
                WELCOME_MESSAGE,
              ].join("\n")
            );
            return;
          }

          await interaction.editReply(
            [
              `Channel: <#${cfg.channel_id}>`,
              `Updated by: <@${cfg.updated_by}>`,
              "Template:",
              cfg.message,
            ].join("\n")
          );
          return;
        }

        if (sub === "preview") {
          const cfg = getWelcomeConfig(interaction.guildId);
          const template = cfg?.message || WELCOME_MESSAGE;
          const preview = formatWelcomeMessage(
            template,
            interaction.guild?.name || "this server",
            interaction.user.id,
            WELCOME_MESSAGE
          );
          await interaction.editReply(`**Preview:**\n${preview}`.slice(0, 1900));
          return;
        }

        if (sub === "clear") {
          clearWelcomeConfig(interaction.guildId);
          await interaction.editReply("🧽 Welcome config cleared. Falling back to `.env`.");
          return;
        }

        await interaction.editReply("That subcommand isn’t wired up 😌");
        return;
      }

      if (interaction.commandName === "mode") {
        await safeDefer(interaction, { ephemeral: true });

        const isOwner = interaction.user.id === OWNER_ID;
        if (!isOwner) {
          await interaction.editReply("Only Snooty can change bot mode 😌");
          return;
        }

        const sub = interaction.options.getSubcommand();

        if (sub === "show") {
          await interaction.editReply(`Current mode: \`${getBotMode()}\``);
          return;
        }

        if (sub === "set") {
          const mode = interaction.options.getString("name", true).toLowerCase();
          if (!MODE_PRESETS[mode]) {
            await interaction.editReply(
              "Invalid mode. Use one of: sassy, chill, serious, hype, rude, ultraroast."
            );
            return;
          }
          setBotMode(mode);
          await interaction.editReply(`✅ Mode updated to \`${mode}\`.`);
          return;
        }

        await interaction.editReply("That subcommand isn’t wired up 😌");
        return;
      }

      if (interaction.commandName === "schedule") {
        await safeDefer(interaction, { ephemeral: true });

        if (!interaction.guildId) {
          await interaction.editReply("This command only works in a server.");
          return;
        }

        const isOwner = interaction.user.id === OWNER_ID;
        if (!isOwner) {
          await interaction.editReply("Only Snooty can manage schedules 😌");
          return;
        }

        const sub = interaction.options.getSubcommand();
        const now = Math.floor(Date.now() / 1000);

        if (sub === "addtext") {
          const channel = interaction.options.getChannel("channel", true);
          if (!channel.isTextBased()) {
            await interaction.editReply("Pick a text channel.");
            return;
          }

          const whenRaw = interaction.options.getString("when", true);
          const sendAt = parseScheduleTimeToUnixSeconds(whenRaw);
          if (!sendAt) {
            await interaction.editReply(
              "Invalid `when`. Use ISO UTC, unix, `dd/hh/mm` (like `01/02/30`), `hh/mm`, or token form like `1d2h30m`."
            );
            return;
          }
          if (sendAt <= now + 5) {
            await interaction.editReply("`when` must be in the future.");
            return;
          }

          const content = (interaction.options.getString("message") || "")
            .trim()
            .slice(0, 1800);
          const mediaUrls = parseMediaUrlsInput(
            interaction.options.getString("media_urls") || ""
          ).slice(0, 10);

          if (!content && mediaUrls.length === 0) {
            await interaction.editReply("Provide `message` text or `media_urls`.");
            return;
          }

          let repeatMinutes = interaction.options.getInteger("repeat_minutes") || 0;
          if (repeatMinutes < 0) repeatMinutes = 0;
          if (repeatMinutes > 43200) {
            await interaction.editReply("`repeat_minutes` max is 43200 (30 days).");
            return;
          }

          const result = db
            .prepare(`
              INSERT INTO scheduled_messages (
                guild_id, channel_id, content, media_json, send_at,
                interval_minutes, active, last_error, created_by, created_at, updated_at
              )
              VALUES (?, ?, ?, ?, ?, ?, 1, '', ?, strftime('%s','now'), strftime('%s','now'))
            `)
            .run(
              interaction.guildId,
              channel.id,
              content,
              JSON.stringify(mediaUrls),
              sendAt,
              repeatMinutes,
              interaction.user.id
            );

          await interaction.editReply(
            [
              `✅ Scheduled #${result.lastInsertRowid} for <#${channel.id}>.`,
              `Next run: <t:${sendAt}:F>`,
              `Repeat: ${
                repeatMinutes > 0 ? `every ${repeatMinutes} minute(s)` : "one-time"
              }`,
              `Media items: ${mediaUrls.length}`,
              `Debug time: ${scheduleTimeLabel(sendAt)}`,
            ].join("\n")
          );
          return;
        }

        if (sub === "addfrom") {
          const link = interaction.options.getString("message_link", true);
          const parsed = parseDiscordMessageLink(link);
          if (!parsed) {
            await interaction.editReply("Invalid message link.");
            return;
          }

          const sourceCh = await client.channels.fetch(parsed.channelId).catch(() => null);
          if (!sourceCh?.isTextBased()) {
            await interaction.editReply("Couldn’t access source channel.");
            return;
          }
          const sourceMsg = await sourceCh.messages.fetch(parsed.messageId).catch(() => null);
          if (!sourceMsg) {
            await interaction.editReply("Couldn’t fetch source message.");
            return;
          }

          const targetChannel =
            interaction.options.getChannel("channel") ||
            (await client.channels.fetch(parsed.channelId).catch(() => null));
          if (!targetChannel?.isTextBased()) {
            await interaction.editReply("Target channel is invalid.");
            return;
          }

          const whenRaw = interaction.options.getString("when", true);
          const sendAt = parseScheduleTimeToUnixSeconds(whenRaw);
          if (!sendAt) {
            await interaction.editReply(
              "Invalid `when`. Use ISO UTC, unix, `dd/hh/mm` (like `01/02/30`), `hh/mm`, or token form like `1d2h30m`."
            );
            return;
          }
          if (sendAt <= now + 5) {
            await interaction.editReply("`when` must be in the future.");
            return;
          }

          let repeatMinutes = interaction.options.getInteger("repeat_minutes") || 0;
          if (repeatMinutes < 0) repeatMinutes = 0;
          if (repeatMinutes > 43200) {
            await interaction.editReply("`repeat_minutes` max is 43200 (30 days).");
            return;
          }

          const content = (sourceMsg.content || "").trim().slice(0, 1800);
          const mediaUrls = extractAttachmentUrlsFromMessage(sourceMsg).slice(0, 10);
          if (!content && mediaUrls.length === 0) {
            await interaction.editReply("Source message has no text or attachments.");
            return;
          }

          const result = db
            .prepare(`
              INSERT INTO scheduled_messages (
                guild_id, channel_id, content, media_json, send_at,
                interval_minutes, active, last_error, created_by, created_at, updated_at
              )
              VALUES (?, ?, ?, ?, ?, ?, 1, '', ?, strftime('%s','now'), strftime('%s','now'))
            `)
            .run(
              interaction.guildId,
              targetChannel.id,
              content,
              JSON.stringify(mediaUrls),
              sendAt,
              repeatMinutes,
              interaction.user.id
            );

          await interaction.editReply(
            [
              `✅ Scheduled #${result.lastInsertRowid} from linked message to <#${targetChannel.id}>.`,
              `Next run: <t:${sendAt}:F>`,
              `Repeat: ${
                repeatMinutes > 0 ? `every ${repeatMinutes} minute(s)` : "one-time"
              }`,
              `Media items: ${mediaUrls.length}`,
              `Debug time: ${scheduleTimeLabel(sendAt)}`,
            ].join("\n")
          );
          return;
        }

        if (sub === "list") {
          const channel = interaction.options.getChannel("channel");
          const rows = channel
            ? db
                .prepare(
                  `SELECT id, channel_id, send_at, interval_minutes, active, content, media_json, last_error
                   FROM scheduled_messages
                   WHERE guild_id = ? AND channel_id = ?
                   ORDER BY id DESC
                   LIMIT 30`
                )
                .all(interaction.guildId, channel.id)
            : db
                .prepare(
                  `SELECT id, channel_id, send_at, interval_minutes, active, content, media_json, last_error
                   FROM scheduled_messages
                   WHERE guild_id = ?
                   ORDER BY id DESC
                   LIMIT 30`
                )
                .all(interaction.guildId);

          if (rows.length === 0) {
            await interaction.editReply("No schedules found.");
            return;
          }

          const lines = rows.map((r) => {
            let mediaCount = 0;
            try {
              const arr = JSON.parse(r.media_json || "[]");
              mediaCount = Array.isArray(arr) ? arr.length : 0;
            } catch {}
            const preview = String(r.content || "").replace(/\s+/g, " ").slice(0, 60);
            const repeat =
              r.interval_minutes > 0 ? `every ${r.interval_minutes}m` : "one-time";
            const status = r.active ? "active" : "paused/done";
            const err = r.last_error ? ` | err: ${String(r.last_error).slice(0, 40)}` : "";
            return `#${r.id} | <#${r.channel_id}> | <t:${r.send_at}:R> | ${repeat} | ${status} | media:${mediaCount} | "${preview}"${err}`;
          });

          await interaction.editReply(
            `**Schedules (latest 30):**\n${lines.join("\n")}`.slice(0, 1900)
          );
          return;
        }

        if (sub === "remove") {
          const id = interaction.options.getInteger("id", true);
          const result = db
            .prepare(`DELETE FROM scheduled_messages WHERE id = ? AND guild_id = ?`)
            .run(id, interaction.guildId);
          await interaction.editReply(
            result.changes > 0 ? `🧽 Removed schedule #${id}.` : `No schedule #${id} found.`
          );
          return;
        }

        if (sub === "pause") {
          const id = interaction.options.getInteger("id", true);
          const result = db
            .prepare(
              `UPDATE scheduled_messages
               SET active = 0, updated_at = strftime('%s','now')
               WHERE id = ? AND guild_id = ?`
            )
            .run(id, interaction.guildId);
          await interaction.editReply(
            result.changes > 0 ? `⏸️ Paused schedule #${id}.` : `No schedule #${id} found.`
          );
          return;
        }

        if (sub === "resume") {
          const id = interaction.options.getInteger("id", true);
          const result = db
            .prepare(
              `UPDATE scheduled_messages
               SET active = 1,
                   send_at = CASE WHEN send_at < ? THEN ? ELSE send_at END,
                   updated_at = strftime('%s','now')
               WHERE id = ? AND guild_id = ?`
            )
            .run(now + 15, now + 15, id, interaction.guildId);
          await interaction.editReply(
            result.changes > 0 ? `▶️ Resumed schedule #${id}.` : `No schedule #${id} found.`
          );
          return;
        }

        await interaction.editReply("That subcommand isn’t wired up 😌");
        return;
      }

      if (interaction.commandName === "purge") {
        await safeDefer(interaction, { ephemeral: true });

        if (!interaction.guildId) {
          await interaction.editReply("This command only works in a server.");
          return;
        }

        const isOwner = interaction.user.id === OWNER_ID;
        if (!isOwner) {
          await interaction.editReply("Only Snooty can run purge commands 😌");
          return;
        }

        const sub = interaction.options.getSubcommand();

        if (sub === "media" || sub === "nonadmin" || sub === "all") {
          const channel = interaction.options.getChannel("channel", true);
          if (!channel.isTextBased() || typeof channel.bulkDelete !== "function") {
            await interaction.editReply("Target channel must support message deletion.");
            return;
          }

          const scanLimit = clampPurgeScanLimit(
            interaction.options.getInteger("limit") || 100,
            100
          );

          const result = await purgeMessagesInChannel(channel, sub, scanLimit);
          await interaction.editReply(
            [
              `🧹 Purge complete in <#${channel.id}> (${sub}).`,
              `Scanned: ${result.scanned}`,
              `Matched: ${result.matched}`,
              `Deleted: ${result.deleted}`,
              `Skipped (older than 14 days): ${result.tooOld}`,
            ].join("\n")
          );
          return;
        }

        if (sub === "autopurge_set") {
          const channel = interaction.options.getChannel("channel", true);
          if (!channel.isTextBased() || typeof channel.bulkDelete !== "function") {
            await interaction.editReply("Target channel must support message deletion.");
            return;
          }

          let every = interaction.options.getInteger("every", true);
          const unit = (interaction.options.getString("unit") || "minutes").toLowerCase();
          const unitMap = {
            seconds: 1,
            minutes: 60,
            hours: 3600,
            days: 86400,
          };
          const mult = unitMap[unit];
          if (!mult) {
            await interaction.editReply("Invalid `unit`. Use seconds, minutes, hours, or days.");
            return;
          }
          if (every < 1) every = 1;

          const intervalSeconds = every * mult;
          if (intervalSeconds < 5) {
            await interaction.editReply("Minimum interval is 5 seconds.");
            return;
          }
          if (intervalSeconds > 86400 * 30) {
            await interaction.editReply("Maximum interval is 30 days.");
            return;
          }
          const intervalMinutes = Math.max(1, Math.ceil(intervalSeconds / 60));

          const mode = (interaction.options.getString("mode") || "all").toLowerCase();
          if (!autoPurgeModes.has(mode)) {
            await interaction.editReply("Invalid mode. Use all, media, or nonadmin.");
            return;
          }

          const scanLimit = clampPurgeScanLimit(
            interaction.options.getInteger("scan_limit") || 200,
            200
          );

          const now = Math.floor(Date.now() / 1000);
          const nextRun = now + intervalSeconds;

          db.prepare(`
            INSERT INTO auto_purge_rules (
              guild_id, channel_id, mode, interval_minutes, interval_seconds, scan_limit,
              next_run_at, active, last_error, created_by, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, '', ?, strftime('%s','now'), strftime('%s','now'))
            ON CONFLICT(channel_id) DO UPDATE SET
              guild_id = excluded.guild_id,
              mode = excluded.mode,
              interval_minutes = excluded.interval_minutes,
              interval_seconds = excluded.interval_seconds,
              scan_limit = excluded.scan_limit,
              next_run_at = excluded.next_run_at,
              active = 1,
              last_error = '',
              updated_at = strftime('%s','now')
          `).run(
            interaction.guildId,
            channel.id,
            mode,
            intervalMinutes,
            intervalSeconds,
            scanLimit,
            nextRun,
            interaction.user.id
          );

          await interaction.editReply(
            [
              `✅ Auto-purge set for <#${channel.id}>.`,
              `Mode: ${mode}`,
              `Interval: every ${every} ${unit}`,
              `Scan limit per run: ${scanLimit}`,
              `Next run: <t:${nextRun}:F>`,
            ].join("\n")
          );
          return;
        }

        if (sub === "autopurge_list") {
          const rows = db
            .prepare(
              `SELECT id, channel_id, mode, interval_minutes, interval_seconds, scan_limit, next_run_at, active, last_error
               FROM auto_purge_rules
               WHERE guild_id = ?
               ORDER BY id DESC
               LIMIT 30`
            )
            .all(interaction.guildId);

          if (rows.length === 0) {
            await interaction.editReply("No auto-purge rules found.");
            return;
          }

          const lines = rows.map((r) => {
            const err = r.last_error ? ` | err: ${String(r.last_error).slice(0, 40)}` : "";
            const secs =
              Number(r.interval_seconds || 0) > 0
                ? Number(r.interval_seconds)
                : Math.max(1, Number(r.interval_minutes || 1)) * 60;
            let label = `${secs}s`;
            if (secs % 86400 === 0) label = `${secs / 86400}d`;
            else if (secs % 3600 === 0) label = `${secs / 3600}h`;
            else if (secs % 60 === 0) label = `${secs / 60}m`;
            return `#${r.id} | <#${r.channel_id}> | mode:${r.mode} | every ${label} | scan:${r.scan_limit} | next <t:${r.next_run_at}:R> | ${r.active ? "active" : "paused"}${err}`;
          });

          await interaction.editReply(
            `**Auto-purge rules:**\n${lines.join("\n")}`.slice(0, 1900)
          );
          return;
        }

        if (sub === "autopurge_remove") {
          const id = interaction.options.getInteger("id", true);
          const result = db
            .prepare(`DELETE FROM auto_purge_rules WHERE id = ? AND guild_id = ?`)
            .run(id, interaction.guildId);

          await interaction.editReply(
            result.changes > 0 ? `🧽 Removed auto-purge rule #${id}.` : `No rule #${id} found.`
          );
          return;
        }

        await interaction.editReply("That subcommand isn’t wired up 😌");
        return;
      }

      if (interaction.commandName === "profile") {
        await safeDefer(interaction, { ephemeral: true });

        const sub = interaction.options.getSubcommand();
        const isOwner = interaction.user.id === OWNER_ID;

        if (sub === "set") {
          const note = interaction.options
            .getString("note", true)
            .trim()
            .slice(0, 1200);

          upsertProfile(interaction.user.id, note);

          const vibeResp = await openai.chat.completions.create({
            model: "gpt-4.1-mini",
            messages: [
              {
                role: "system",
                content:
                  "Turn this note into a short neutral vibe summary (1–2 lines). No negative judgments, no sensitive inferences.",
              },
              { role: "user", content: note },
            ],
          });

          const vibe =
            vibeResp.choices?.[0]?.message?.content?.trim().slice(0, 280) || "";

          setVibe(interaction.user.id, vibe);

          await interaction.editReply("✅ Profile saved. I’ll remember that.");
          return;
        }

        if (sub === "show") {
          const row = getProfile(interaction.user.id);
          if (!row) {
            await interaction.editReply("You don’t have a profile yet. Use `/profile set`.");
            return;
          }
          await interaction.editReply(
            `**Your profile note:**\n${row.notes}\n\n**Vibe summary:**\n${row.vibe_summary || "(none)"}`
          );
          return;
        }

        if (sub === "clear") {
          clearProfile(interaction.user.id);
          await interaction.editReply("🧽 Profile deleted.");
          return;
        }

        if (sub === "peek") {
          if (!isOwner) {
            await interaction.editReply("Only Snooty can peek 😌");
            return;
          }
          const user = interaction.options.getUser("user", true);
          const row = getProfile(user.id);
          await interaction.editReply(
            row
              ? `**Profile for ${user.username}:**\n${row.notes}\n\n**Vibe:**\n${row.vibe_summary || "(none)"}`
              : `No profile stored for ${user.username}.`
          );
          return;
        }

        if (sub === "setfor") {
          if (!isOwner) {
            await interaction.editReply("Only Snooty can set profiles for others 😌");
            return;
          }
          const user = interaction.options.getUser("user", true);
          const note = interaction.options
            .getString("note", true)
            .trim()
            .slice(0, 1200);

          upsertProfile(user.id, note);

          const vibeResp = await openai.chat.completions.create({
            model: "gpt-4.1-mini",
            messages: [
              {
                role: "system",
                content:
                  "Turn this note into a short neutral vibe summary (1–2 lines). No negative judgments, no sensitive inferences.",
              },
              { role: "user", content: note },
            ],
          });

          const vibe =
            vibeResp.choices?.[0]?.message?.content?.trim().slice(0, 280) || "";

          setVibe(user.id, vibe);

          await interaction.editReply(`✅ Profile saved for ${user.username}.`);
          return;
        }

        if (sub === "clearfor") {
          if (!isOwner) {
            await interaction.editReply("Only Snooty can clear profiles for others 😌");
            return;
          }
          const user = interaction.options.getUser("user", true);
          clearProfile(user.id);
          await interaction.editReply(`🧽 Profile deleted for ${user.username}.`);
          return;
        }

        await interaction.editReply("That subcommand isn’t wired up 😌");
        return;
      }

      await safeDefer(interaction);

      if (interaction.commandName === "ask") {
        const prompt = interaction.options.getString("prompt", true);

        const targetMsg = await resolveTargetMessageFromSlash(interaction, "message");
        const referencedText = targetMsg?.content ? targetMsg.content : "";
        const imgs = targetMsg ? extractImageUrlsFromMessage(targetMsg) : [];

        const reply = await makeChatReply({
          userId: interaction.user.id,
          userText: prompt,
          referencedText,
          imageUrls: imgs,
        });

        await interaction.editReply(reply.slice(0, 1900));
        return;
      }

      if (interaction.commandName === "imagine") {
        const prompt = interaction.options.getString("prompt", true);

        const pngBuf = await generateImageFromPrompt(prompt);
        const file = new AttachmentBuilder(pngBuf, { name: "misfit.png" });

        await interaction.editReply({
          content: `Here. Don’t say I never do anything for you 😌\n**Prompt:** ${prompt}`.slice(
            0,
            1800
          ),
          files: [file],
        });
        return;
      }

      if (interaction.commandName === "voicenote") {
        const text = interaction.options.getString("text", true).trim().slice(0, 3000);
        const voice = (interaction.options.getString("voice") || "alloy").toLowerCase();

        const mp3Buf = await generateVoiceFromText(text, voice);
        const file = new AttachmentBuilder(mp3Buf, { name: "misfit-voicenote.mp3" });

        await interaction.editReply({
          content: `🎙️ Voice note ready (${voice}).`,
          files: [file],
        });
        return;
      }

      if (interaction.commandName === "beautify") {
        const style = (interaction.options.getString("style") || "box").toLowerCase();
        let sourceText = (interaction.options.getString("text") || "").trim();

        if (!sourceText) {
          const targetMsg = await resolveTargetMessageFromSlash(interaction, "message");
          sourceText = (targetMsg?.content || "").trim();
        }

        if (!sourceText) {
          await interaction.editReply(
            "Provide `text`, or reply first and run `/beautify`, or pass a message link 😌"
          );
          return;
        }

        const out = await beautifyText(sourceText, style);
        await interaction.editReply(
          `**Beautified (${style}):**\n${out || "I couldn’t beautify that text."}`.slice(
            0,
            1900
          )
        );
        return;
      }

      if (interaction.commandName === "summarize") {
        const targetMsg = await resolveTargetMessageFromSlash(interaction);
        if (!targetMsg) {
          await interaction.editReply(
            "Reply to the message first (any text), then run `/summarize`, OR pass a message link 😌"
          );
          return;
        }
        const reply = await makeChatReply({
          userId: interaction.user.id,
          userText: "Summarize this.",
          referencedText: targetMsg.content || "",
          imageUrls: extractImageUrlsFromMessage(targetMsg),
        });
        await interaction.editReply(reply.slice(0, 1900));
        return;
      }

      if (interaction.commandName === "explain") {
        const targetMsg = await resolveTargetMessageFromSlash(interaction);
        if (!targetMsg) {
          await interaction.editReply(
            "Reply to the message first, then run `/explain`, OR pass a message link 😌"
          );
          return;
        }
        const reply = await makeChatReply({
          userId: interaction.user.id,
          userText: "Explain this clearly.",
          referencedText: targetMsg.content || "",
          imageUrls: extractImageUrlsFromMessage(targetMsg),
        });
        await interaction.editReply(reply.slice(0, 1900));
        return;
      }

      if (interaction.commandName === "analyzeimage") {
        const targetMsg = await resolveTargetMessageFromSlash(interaction);
        const prompt = interaction.options.getString("prompt") || "Analyze this image.";

        if (!targetMsg) {
          await interaction.editReply(
            "Reply first, then run `/analyzeimage`, OR pass a message link 😌"
          );
          return;
        }
        const imgs = extractImageUrlsFromMessage(targetMsg);
        if (imgs.length === 0) {
          await interaction.editReply("No image found in that message 😌");
          return;
        }

        const reply = await makeChatReply({
          userId: interaction.user.id,
          userText: prompt,
          referencedText: targetMsg.content || "",
          imageUrls: imgs,
        });
        await interaction.editReply(reply.slice(0, 1900));
        return;
      }

      if (interaction.commandName === "transcribe") {
        const targetMsg = await resolveTargetMessageFromSlash(interaction);
        const doExplain = interaction.options.getBoolean("explain") || false;

        if (!targetMsg) {
          await interaction.editReply(
            "Reply first, then run `/transcribe`, OR pass a message link 😌"
          );
          return;
        }
        const aud = extractAudioAttachmentsFromMessage(targetMsg);
        if (aud.length === 0) {
          await interaction.editReply("No audio/voice note found in that message 😌");
          return;
        }

        const transcript = await transcribeAudioAttachment(aud[0]);
        if (!transcript) {
          await interaction.editReply("Couldn’t transcribe that audio 😭");
          return;
        }

        if (!doExplain) {
          await interaction.editReply(`**Transcript:**\n${transcript}`.slice(0, 1900));
          return;
        }

        const explanation = await makeChatReply({
          userId: interaction.user.id,
          userText: "Explain this transcript briefly and clearly.",
          referencedText: transcript,
          imageUrls: [],
        });

        await interaction.editReply(
          `**Transcript:**\n${transcript}\n\n**Explanation:**\n${explanation}`.slice(
            0,
            1900
          )
        );
        return;
      }

      if (interaction.commandName === "summarizechannel") {
        let count = interaction.options.getInteger("count", true);
        if (count < 1) count = 1;
        if (count > 100) count = 100;

        const fetched = await interaction.channel.messages.fetch({ limit: count });

        const lines = fetched
          .filter((m) => !m.author?.bot)
          .map(formatMessageForChannelSummary)
          .filter(Boolean)
          .reverse()
          .join("\n");

        if (!lines.trim()) {
          await interaction.editReply("Nothing to summarize here 🤨");
          return;
        }

        const capped = lines.length > 12000 ? lines.slice(-12000) : lines;

        const reply = await makeChatReply({
          userId: interaction.user.id,
          userText:
            "Summarize this channel conversation. Include: key points, any decisions, and a short vibe/chaos score (0-10).",
          referencedText: capped,
          imageUrls: [],
        });

        await interaction.editReply(reply.slice(0, 1900));
        return;
      }

      await interaction.editReply(
        "That command exists… but does nothing. Like some people here 😌"
      );
    } catch (err) {
      console.error(err);

      if (isDiscordUnknownInteraction(err) || isAlreadyAcknowledged(err)) return;

      try {
        if (interaction?.deferred || interaction?.replied) {
          await interaction.editReply("⚠️ Something broke. Try again 😭");
        } else {
          await interaction.reply({
            content: "⚠️ Something broke. Try again 😭",
            ephemeral: true,
          });
        }
      } catch {}
    }
  });
}
