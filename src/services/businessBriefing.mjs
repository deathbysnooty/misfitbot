import Database from "better-sqlite3";
import { EmbedBuilder } from "discord.js";

const SGT_TIMEZONE = "Asia/Singapore";
const BRIEFING_CHANNEL_NAME = "daily-briefing";

function getSgtParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: SGT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).map((p) => [p.type, p.value])
  );
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: String(parts.weekday || ""),
    hour: Number(parts.hour || 0),
    minute: Number(parts.minute || 0),
  };
}

function rankArrow(delta) {
  if (delta == null) return "new";
  if (delta > 0) return `up ${delta}`;
  if (delta < 0) return `down ${Math.abs(delta)}`;
  return "no change";
}

function topicForWeekday(weekday) {
  const map = {
    Mon: "SEO",
    Tue: "content",
    Wed: "competitor analysis",
    Thu: "enquiry conversion",
    Fri: "planning",
  };
  return map[weekday] || "business operations";
}

export function createBusinessBriefingService({ client, db, openai }) {
  let timer = null;
  let ranksDb = null;

  function getRanksDb() {
    const path = String(process.env.RANKS_DB_PATH || "").trim();
    if (!path) return null;
    try {
      if (!ranksDb) {
        ranksDb = new Database(path, { readonly: true, fileMustExist: true });
      }
      return ranksDb;
    } catch (err) {
      console.warn("Daily briefing could not open ranks DB:", err?.message || err);
      return null;
    }
  }

  function loadRankPulse() {
    const rdb = getRanksDb();
    if (!rdb) {
      return {
        summary: "Rank pulse unavailable: `RANKS_DB_PATH` is not configured or readable.",
        latestDate: "",
      };
    }

    const latest = rdb
      .prepare(
        `SELECT date
         FROM ranks
         WHERE domain = ?
         ORDER BY date DESC
         LIMIT 1`
      )
      .get("ibtuition.sg");

    if (!latest?.date) {
      return {
        summary: "Rank pulse unavailable: no `ibtuition.sg` rank rows found.",
        latestDate: "",
      };
    }

    const previous = rdb
      .prepare(
        `SELECT date
         FROM ranks
         WHERE domain = ? AND date < ?
         ORDER BY date DESC
         LIMIT 1`
      )
      .get("ibtuition.sg", latest.date);

    const currentRows = rdb
      .prepare(
        `SELECT keyword, position
         FROM ranks
         WHERE domain = ? AND date = ?
         ORDER BY position ASC, keyword ASC
         LIMIT 5`
      )
      .all("ibtuition.sg", latest.date);

    if (!currentRows.length) {
      return {
        summary: "Rank pulse unavailable: latest rank snapshot is empty.",
        latestDate: latest.date,
      };
    }

    const previousMap = new Map(
      (previous?.date
        ? rdb
            .prepare(
              `SELECT keyword, position
               FROM ranks
               WHERE domain = ? AND date = ?`
            )
            .all("ibtuition.sg", previous.date)
        : []
      ).map((row) => [String(row.keyword || ""), Number(row.position)])
    );

    const lines = currentRows.map((row) => {
      const keyword = String(row.keyword || "");
      const current = Number(row.position || 0);
      const prev = previousMap.has(keyword) ? previousMap.get(keyword) : null;
      const delta = prev == null ? null : prev - current;
      return `• ${keyword}: #${current} (${rankArrow(delta)})`;
    });

    return {
      summary: lines.join("\n"),
      latestDate: latest.date,
      previousDate: previous?.date || "",
    };
  }

  async function generateBusinessTip(weekday) {
    const focus = topicForWeekday(weekday);
    const resp = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content:
            "You help run a private IB tuition business dashboard for Singapore. Write one short, practical morning briefing tip. Keep it tight, useful, and specific. Max 3 sentences.",
        },
        {
          role: "user",
          content: `Write today's business tip focused on ${focus} for ibtuition.sg.`,
        },
      ],
    });

    return (
      resp.choices?.[0]?.message?.content?.trim() ||
      "Focus on one high-leverage business task this morning and finish it before context-switching."
    );
  }

  function mondayFocus(weekday) {
    if (weekday !== "Mon") return "";
    return [
      "This week: daily rank visibility in `#seo-reports`, competitor thinking midweek, and tighter content follow-through.",
      "Use today to confirm priorities before the Wednesday competitor cycle starts.",
    ].join(" ");
  }

  async function buildBriefingEmbed() {
    const sgt = getSgtParts();
    const rankPulse = loadRankPulse();
    let tip = "";
    try {
      tip = await generateBusinessTip(sgt.weekday);
    } catch (err) {
      console.warn("Daily briefing tip generation failed:", err?.message || err);
      tip = "Business tip unavailable right now. Default move: review visibility, leads, and one content task before teaching starts.";
    }

    const monday = mondayFocus(sgt.weekday);
    return new EmbedBuilder()
      .setColor(0x2b7fff)
      .setTitle(`Daily Briefing • ${sgt.dateKey}`)
      .setDescription(
        [
          "**Rank pulse**",
          rankPulse.summary,
          "",
          "**Thought for the day**",
          tip,
          monday ? `\n**This week's focus**\n${monday}` : "",
        ]
          .filter(Boolean)
          .join("\n")
          .slice(0, 3900)
      )
      .setFooter({
        text: rankPulse.latestDate
          ? `Rank snapshot ${rankPulse.latestDate} • ${SGT_TIMEZONE}`
          : SGT_TIMEZONE,
      })
      .setTimestamp(new Date());
  }

  async function postDailyBriefingToGuild(guild) {
    await guild.channels.fetch().catch(() => null);
    const channel = [...guild.channels.cache.values()].find(
      (ch) => Number(ch?.type) === 0 && String(ch.name || "").toLowerCase() === BRIEFING_CHANNEL_NAME
    );
    if (!channel?.isTextBased?.()) {
      return { ok: false, reason: `Missing #${BRIEFING_CHANNEL_NAME} channel.` };
    }

    const embed = await buildBriefingEmbed();
    await channel.send({ embeds: [embed] });
    return { ok: true, channelId: channel.id };
  }

  async function runManualBriefing(guildId) {
    const guild =
      client.guilds.cache.get(guildId) ||
      (await client.guilds.fetch(guildId).catch(() => null));
    if (!guild) throw new Error("Guild not found.");
    return postDailyBriefingToGuild(guild);
  }

  async function tick() {
    const sgt = getSgtParts();
    if (!["Mon", "Tue", "Wed", "Thu", "Fri"].includes(sgt.weekday)) return;
    if (sgt.hour !== 7 || sgt.minute !== 30) return;

    for (const guild of client.guilds.cache.values()) {
      const key = `daily_briefing_last_sent:${guild.id}`;
      const sent = db.prepare(`SELECT value FROM bot_config WHERE key = ?`).get(key);
      if (String(sent?.value || "") === sgt.dateKey) continue;

      try {
        const result = await postDailyBriefingToGuild(guild);
        if (result.ok) {
          db.prepare(`
            INSERT INTO bot_config (key, value, updated_at)
            VALUES (?, ?, strftime('%s','now'))
            ON CONFLICT(key) DO UPDATE SET
              value = excluded.value,
              updated_at = strftime('%s','now')
          `).run(key, sgt.dateKey);
        }
      } catch (err) {
        console.error(`Daily briefing failed for guild ${guild.id}:`, err);
      }
    }
  }

  function start() {
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      tick().catch((err) => console.error("Daily briefing tick failed:", err));
    }, 60_000);
    timer.unref?.();
    tick().catch((err) => console.error("Initial daily briefing tick failed:", err));
  }

  return {
    start,
    runManualBriefing,
  };
}
