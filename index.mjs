import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  ApplicationCommandType,
  AttachmentBuilder,
} from "discord.js";
import OpenAI from "openai";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import crypto from "crypto";
import Database from "better-sqlite3";

const OWNER_ID = "1417834414368362596";
const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID || "";
const WELCOME_MESSAGE =
  process.env.WELCOME_MESSAGE ||
  "Welcome to **{guild}**, {user}! 👋\nUse `/help` to see what I can do, and `/profile set` if you want me to remember your preferences.";

// ========= Helpers =========
function extractImageUrlsFromMessage(msg) {
  const urls = [];
  if (!msg?.attachments) return urls;

  for (const [, att] of msg.attachments) {
    const ct = (att.contentType || "").toLowerCase();
    const name = (att.name || "").toLowerCase();

    const isImage =
      ct.startsWith("image/") ||
      name.endsWith(".png") ||
      name.endsWith(".jpg") ||
      name.endsWith(".jpeg") ||
      name.endsWith(".webp") ||
      name.endsWith(".gif");

    if (isImage && att.url) urls.push(att.url);
  }
  return urls;
}

function extractAudioAttachmentsFromMessage(msg) {
  const atts = [];
  if (!msg?.attachments) return atts;

  for (const [, att] of msg.attachments) {
    const ct = (att.contentType || "").toLowerCase();
    const name = (att.name || "").toLowerCase();

    const looksLikeVoiceNote =
      name.includes("voice") ||
      name.includes("audio") ||
      name.includes("recording");

    const isAudio =
      ct.startsWith("audio/") ||
      ct.includes("ogg") ||
      ct.includes("opus") ||
      ct.includes("webm") ||
      ct.includes("mpeg") ||
      ct.includes("mp4") ||
      ct.includes("octet-stream") ||
      name.endsWith(".mp3") ||
      name.endsWith(".wav") ||
      name.endsWith(".m4a") ||
      name.endsWith(".mp4") ||
      name.endsWith(".ogg") ||
      name.endsWith(".webm");

    if ((isAudio || looksLikeVoiceNote) && att.url) {
      atts.push({
        url: att.url,
        name: att.name || "",
        contentType: att.contentType || "",
      });
    }
  }
  return atts;
}

function parseDiscordMessageLink(input) {
  // https://discord.com/channels/<guildId>/<channelId>/<messageId>
  const m = input?.match(/channels\/(\d+)\/(\d+)\/(\d+)/);
  if (!m) return null;
  return { guildId: m[1], channelId: m[2], messageId: m[3] };
}

function extFromContentType(ct) {
  const s = (ct || "").toLowerCase();
  if (s.includes("ogg") || s.includes("opus")) return ".ogg";
  if (s.includes("webm")) return ".webm";
  if (s.includes("mpeg")) return ".mp3";
  if (s.includes("wav")) return ".wav";
  if (s.includes("mp4") || s.includes("m4a")) return ".m4a";
  return "";
}

function extFromUrl(u) {
  try {
    const p = new URL(u).pathname.toLowerCase();
    const m = p.match(/\.(mp3|wav|m4a|mp4|ogg|webm)$/);
    return m ? `.${m[1]}` : "";
  } catch {
    return "";
  }
}

function extFromName(name) {
  const n = (name || "").toLowerCase();
  const m = n.match(/\.(mp3|wav|m4a|mp4|ogg|webm)$/);
  return m ? `.${m[1]}` : "";
}

async function downloadToTemp(url, desiredExt = ".bin") {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);

  const buf = Buffer.from(await res.arrayBuffer());
  const tmpDir = path.join(process.cwd(), "tmp");
  await fsp.mkdir(tmpDir, { recursive: true });

  const filePath = path.join(tmpDir, `${crypto.randomUUID()}${desiredExt}`);
  await fsp.writeFile(filePath, buf);
  return filePath;
}

function isDiscordUnknownInteraction(err) {
  return (
    err?.code === 10062 ||
    String(err?.message || "").includes("Unknown interaction")
  );
}

function isAlreadyAcknowledged(err) {
  return (
    err?.code === 40060 ||
    String(err?.message || "").includes("already been acknowledged")
  );
}

async function safeDefer(interaction, opts = {}) {
  // Never defer twice
  if (interaction.deferred || interaction.replied) return;
  await interaction.deferReply(opts);
}

// ========= SQLite + Fixed Memory =========
// IMPORTANT (Render): mount Persistent Disk at /var/data
const DB_PATH = process.env.RENDER
  ? "/var/data/misfitbot.sqlite"
  : "./misfitbot.sqlite";

const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS user_memory (
    user_id TEXT PRIMARY KEY,
    notes TEXT NOT NULL DEFAULT ''
  );
`);

// ✅ NEW: opt-in user profiles (notes + neutral vibe summary)
db.exec(`
  CREATE TABLE IF NOT EXISTS user_profiles (
    user_id TEXT PRIMARY KEY,
    notes TEXT NOT NULL DEFAULT '',
    vibe_summary TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS welcome_config (
    guild_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    message TEXT NOT NULL,
    updated_by TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS bot_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
`);

db.prepare(`
  INSERT INTO bot_config (key, value, updated_at)
  VALUES ('mode', 'sassy', strftime('%s','now'))
  ON CONFLICT(key) DO NOTHING
`).run();

function getProfile(userId) {
  return db
    .prepare(`SELECT notes, vibe_summary FROM user_profiles WHERE user_id = ?`)
    .get(userId);
}

function upsertProfile(userId, notes) {
  db.prepare(`
    INSERT INTO user_profiles (user_id, notes, vibe_summary, updated_at)
    VALUES (?, ?, '', strftime('%s','now'))
    ON CONFLICT(user_id) DO UPDATE SET
      notes = excluded.notes,
      updated_at = strftime('%s','now')
  `).run(userId, notes);
}

function setVibe(userId, vibe) {
  db.prepare(`
    UPDATE user_profiles
    SET vibe_summary = ?, updated_at = strftime('%s','now')
    WHERE user_id = ?
  `).run(vibe, userId);
}

function clearProfile(userId) {
  db.prepare(`DELETE FROM user_profiles WHERE user_id = ?`).run(userId);
}

function getWelcomeConfig(guildId) {
  return db
    .prepare(
      `SELECT guild_id, channel_id, message, updated_by, updated_at
       FROM welcome_config
       WHERE guild_id = ?`
    )
    .get(guildId);
}

function upsertWelcomeConfig(guildId, channelId, message, updatedBy) {
  db.prepare(`
    INSERT INTO welcome_config (guild_id, channel_id, message, updated_by, updated_at)
    VALUES (?, ?, ?, ?, strftime('%s','now'))
    ON CONFLICT(guild_id) DO UPDATE SET
      channel_id = excluded.channel_id,
      message = excluded.message,
      updated_by = excluded.updated_by,
      updated_at = strftime('%s','now')
  `).run(guildId, channelId, message, updatedBy);
}

function clearWelcomeConfig(guildId) {
  db.prepare(`DELETE FROM welcome_config WHERE guild_id = ?`).run(guildId);
}

const MODE_PRESETS = {
  sassy:
    "- You are helpful, but slightly sassy and witty.\n- Light teasing is allowed, but never insult people harshly.\n- Keep replies short and punchy unless asked for detail.\n- Use 0–2 emojis per message.",
  chill:
    "- You are calm, friendly, and supportive.\n- No teasing; keep tone relaxed.\n- Keep replies concise unless asked for detail.\n- Use 0–1 emojis per message.",
  serious:
    "- You are direct, clear, and professional.\n- Avoid jokes and teasing.\n- Focus on accuracy and actionable answers.\n- Avoid emojis unless user asks.",
  hype: "- You are energetic, playful, and upbeat.\n- Keep things positive and high-energy without being rude.\n- Keep replies compact and bold.\n- Use 1–3 emojis per message.",
  rude: "- You are blunt, edgy, and sarcastic.\n- You can roast lightly, but do not bully or target protected traits.\n- Keep it short and stinging, still useful.\n- Use 0–2 emojis.",
  ultraroast:
    "- You are maximum roast mode: savage, dramatic, and brutally witty.\n- Roasts must stay non-hateful and non-discriminatory; no threats, no harassment.\n- Prioritize comedy over cruelty; keep responses concise and useful.\n- Use 0–2 emojis.",
};

const DEFAULT_BOT_MODE = "sassy";

function getBotMode() {
  const row = db.prepare(`SELECT value FROM bot_config WHERE key = 'mode'`).get();
  const mode = String(row?.value || DEFAULT_BOT_MODE).toLowerCase();
  return MODE_PRESETS[mode] ? mode : DEFAULT_BOT_MODE;
}

function setBotMode(mode) {
  db.prepare(`
    INSERT INTO bot_config (key, value, updated_at)
    VALUES ('mode', ?, strftime('%s','now'))
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = strftime('%s','now')
  `).run(mode);
}

function formatWelcomeMessage(template, guildName, memberId) {
  return (template || WELCOME_MESSAGE)
    .replaceAll("{user}", `<@${memberId}>`)
    .replaceAll("{guild}", guildName)
    .replace(/<(\d{17,20})>/g, "<#$1>")
    .replaceAll("\\n", "\n");
}

const FIXED_MEMORY = fs.existsSync("./fixed_memory.txt")
  ? fs.readFileSync("./fixed_memory.txt", "utf8")
  : "";

// ========= Discord + OpenAI =========
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Track last replied-to message per user (per channel) for ~2 mins
const lastReplyTarget = new Map(); // key: `${userId}:${channelId}` -> { messageId, ts }
const REPLY_CONTEXT_TTL_MS = 2 * 60 * 1000;

function setReplyContext(userId, channelId, messageId) {
  lastReplyTarget.set(`${userId}:${channelId}`, { messageId, ts: Date.now() });
}
function getReplyContext(userId, channelId) {
  const key = `${userId}:${channelId}`;
  const v = lastReplyTarget.get(key);
  if (!v) return null;
  if (Date.now() - v.ts > REPLY_CONTEXT_TTL_MS) {
    lastReplyTarget.delete(key);
    return null;
  }
  return v.messageId;
}

// ========= AI Handlers =========
async function makeChatReply({ userId, userText, referencedText, imageUrls }) {
  const askerMemory =
    db.prepare(`SELECT notes FROM user_memory WHERE user_id = ?`).get(userId)
      ?.notes || "";

  const profileRow = getProfile(userId);
  const profileBlock = profileRow?.notes
    ? `USER PROFILE (opt-in):
${profileRow.notes}

VIBE SUMMARY:
${profileRow.vibe_summary || "(none)"}`
    : `USER PROFILE (opt-in):
(none)`;

  const finalPrompt = referencedText
    ? `Message being replied to:\n\n${referencedText}\n\nUser request:\n${userText}`
    : userText;
  const botMode = getBotMode();

  const userMessage =
    imageUrls?.length > 0
      ? {
          role: "user",
          content: [
            { type: "text", text: finalPrompt },
            ...imageUrls.slice(0, 3).map((url) => ({
              type: "image_url",
              image_url: { url },
            })),
          ],
        }
      : { role: "user", content: finalPrompt };

  const resp = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      {
        role: "system",
        content: `
You are MisfitBot, the resident smartass assistant of the "Midnight Misfits" Discord server.

FIXED MEMORY (immutable):
${FIXED_MEMORY}

USER MEMORY (about the current user only):
${askerMemory ? askerMemory : "(none)"}

${profileBlock}

Personality rules:
Current mode: ${botMode}
${MODE_PRESETS[botMode]}
- Never use hate speech, slurs, or discriminatory jokes.
- Never mention system messages, tokens, OpenAI, or that you're an AI.
        `.trim(),
      },
      userMessage,
    ],
  });

  return (
    resp.choices?.[0]?.message?.content?.trim() || "I couldn’t generate a reply."
  );
}

async function transcribeAudioAttachment(att) {
  // Infer a REAL extension (OpenAI rejects unknown .bin)
  const ext =
    extFromName(att?.name) ||
    extFromContentType(att?.contentType) ||
    extFromUrl(att?.url) ||
    ".ogg"; // common Discord voice note container

  // 1) Try with inferred ext
  const tryOne = async (forcedExt) => {
    const filePath = await downloadToTemp(att.url, forcedExt);
    try {
      const result = await openai.audio.transcriptions.create({
        file: fs.createReadStream(filePath),
        model: "gpt-4o-mini-transcribe",
      });
      return result.text || "";
    } finally {
      try {
        await fsp.unlink(filePath);
      } catch {}
    }
  };

  try {
    return await tryOne(ext);
  } catch (e1) {
    // 2) If Discord served it as octet-stream, fallback attempts
    // (voice notes often work as .ogg or .webm)
    try {
      return await tryOne(".ogg");
    } catch (e2) {
      return await tryOne(".webm");
    }
  }
}

async function generateImageFromPrompt(prompt) {
  const img = await openai.images.generate({
    model: "gpt-image-1",
    prompt,
    size: "1024x1024",
  });

  const b64 = img?.data?.[0]?.b64_json;
  if (!b64) throw new Error("No image returned from OpenAI");
  return Buffer.from(b64, "base64");
}

async function generateVoiceFromText(text, voice = "alloy") {
  const tts = await openai.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice,
    input: text,
    format: "mp3",
  });

  return Buffer.from(await tts.arrayBuffer());
}

function formatMessageForChannelSummary(m) {
  const content = (m.content || "").trim();
  const parts = [];

  if (content) parts.push(content);

  const imgCount = extractImageUrlsFromMessage(m).length;
  const audCount = extractAudioAttachmentsFromMessage(m).length;

  if (imgCount > 0)
    parts.push(`[${imgCount} image${imgCount === 1 ? "" : "s"}]`);
  if (audCount > 0) parts.push(`[${audCount} audio]`);

  if (parts.length === 0) return "";
  return `${m.author.username}: ${parts.join(" ")}`;
}

// ========= Command Registration (Guild-only by default if GUILD_ID exists) =========
async function registerCommands() {
  const guildId = process.env.GUILD_ID;
  const target = guildId ? client.guilds.cache.get(guildId) : null;

  const commands = [
    { name: "help", description: "Show what MisfitBot can do.", options: [] },
    {
      name: "ask",
      description: "Ask MisfitBot anything (reply context or message link).",
      options: [
        {
          name: "prompt",
          description: "What do you want to ask?",
          type: 3,
          required: true,
        },
        {
          name: "message",
          description:
            "Discord message link (optional). If omitted, uses your recent reply context.",
          type: 3,
          required: false,
        },
      ],
    },
    {
      name: "imagine",
      description: "Generate an image from a prompt.",
      options: [
        {
          name: "prompt",
          description: "Describe the image you want.",
          type: 3,
          required: true,
        },
      ],
    },
    {
      name: "summarize",
      description: "Summarize a message (reply context or message link).",
      options: [
        {
          name: "message",
          description:
            "Discord message link (optional). If omitted, uses your recent reply context.",
          type: 3,
          required: false,
        },
      ],
    },
    {
      name: "explain",
      description: "Explain a message (reply context or message link).",
      options: [
        {
          name: "message",
          description:
            "Discord message link (optional). If omitted, uses your recent reply context.",
          type: 3,
          required: false,
        },
      ],
    },
    {
      name: "analyzeimage",
      description: "Analyze an image (reply context or message link).",
      options: [
        {
          name: "message",
          description:
            "Discord message link (optional). If omitted, uses your recent reply context.",
          type: 3,
          required: false,
        },
        {
          name: "prompt",
          description: "What should I look for? (optional)",
          type: 3,
          required: false,
        },
      ],
    },
    {
      name: "transcribe",
      description: "Transcribe a voice note/audio (reply context or message link).",
      options: [
        {
          name: "message",
          description:
            "Discord message link (optional). If omitted, uses your recent reply context.",
          type: 3,
          required: false,
        },
        {
          name: "explain",
          description: "Also explain what it means",
          type: 5,
          required: false,
        },
      ],
    },
    {
      name: "summarizechannel",
      description: "Summarize last N messages in this channel (max 100).",
      options: [
        {
          name: "count",
          description: "How many recent messages? (1–100)",
          type: 4,
          required: true,
        },
      ],
    },
    {
      name: "voicenote",
      description: "Convert text into a voice-note style audio file.",
      options: [
        {
          name: "text",
          description: "Text to speak",
          type: 3,
          required: true,
        },
        {
          name: "voice",
          description: "Voice style",
          type: 3,
          required: false,
          choices: [
            { name: "alloy", value: "alloy" },
            { name: "nova", value: "nova" },
            { name: "onyx", value: "onyx" },
            { name: "echo", value: "echo" },
            { name: "fable", value: "fable" },
            { name: "shimmer", value: "shimmer" },
          ],
        },
      ],
    },
    {
      name: "welcome",
      description: "Configure join welcome message for this server (owner).",
      options: [
        {
          type: 1,
          name: "set",
          description: "Set welcome channel + message template.",
          options: [
            {
              type: 7,
              name: "channel",
              description: "Where welcome messages should be posted",
              required: true,
            },
            {
              type: 3,
              name: "message",
              description:
                "Template. Use {user}, {guild}, and \\n. Example: Welcome {user} to {guild}!",
              required: true,
            },
          ],
        },
        {
          type: 1,
          name: "show",
          description: "Show current welcome setup for this server.",
        },
        {
          type: 1,
          name: "preview",
          description: "Preview the current welcome message format.",
        },
        {
          type: 1,
          name: "clear",
          description: "Clear DB welcome config and fall back to .env.",
        },
      ],
    },
    {
      name: "mode",
      description: "Owner only: change bot personality mode.",
      options: [
        {
          type: 1,
          name: "set",
          description: "Set the active bot mode.",
          options: [
            {
              type: 3,
              name: "name",
              description: "Mode name",
              required: true,
              choices: [
                { name: "sassy", value: "sassy" },
                { name: "chill", value: "chill" },
                { name: "serious", value: "serious" },
                { name: "hype", value: "hype" },
                { name: "rude", value: "rude" },
                { name: "ultraroast", value: "ultraroast" },
              ],
            },
          ],
        },
        {
          type: 1,
          name: "show",
          description: "Show current bot mode.",
        },
      ],
    },

    // ✅ NEW: /profile set|show|clear|peek
    {
      name: "profile",
      description: "Manage your personal bot profile (opt-in).",
      options: [
        {
          type: 1,
          name: "set",
          description: "Set/update your profile note (opt-in).",
          options: [
            {
              type: 3,
              name: "note",
              description:
                "Example: I'm GMT+8, I like Valorant, keep replies short",
              required: true,
            },
          ],
        },
        { type: 1, name: "show", description: "Show your profile." },
        { type: 1, name: "clear", description: "Delete your profile." },
        {
          type: 1,
          name: "peek",
          description: "Owner only: view someone else’s profile.",
          options: [
            {
              type: 6,
              name: "user",
              description: "User to view",
              required: true,
            },
          ],
        },
        {
          type: 1,
          name: "setfor",
          description: "Owner only: set a profile note for a user.",
          options: [
            {
              type: 6,
              name: "user",
              description: "User to update",
              required: true,
            },
            {
              type: 3,
              name: "note",
              description: "Profile note to store for this user",
              required: true,
            },
          ],
        },
        {
          type: 1,
          name: "clearfor",
          description: "Owner only: clear a user profile.",
          options: [
            {
              type: 6,
              name: "user",
              description: "User to clear",
              required: true,
            },
          ],
        },
      ],
    },

    // Context menu
    { name: "Misfit: Summarize", type: ApplicationCommandType.Message },
    { name: "Misfit: Explain", type: ApplicationCommandType.Message },
    { name: "Misfit: Analyze Image", type: ApplicationCommandType.Message },
    { name: "Misfit: Transcribe Voice", type: ApplicationCommandType.Message },
    { name: "Misfit: Voice Note", type: ApplicationCommandType.Message },
  ];

  try {
    if (target) {
      await target.commands.set(commands);
      console.log(`✅ Registered GUILD commands (fast): ${guildId}`);
    } else {
      await client.application.commands.set(commands);
      console.log("✅ Registered GLOBAL commands (may take time to appear)");
    }
  } catch (err) {
    console.error("❌ Failed to register commands:", err);
  }
}

// ========= Events =========
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await registerCommands();
});

client.on("guildMemberAdd", async (member) => {
  try {
    const cfg = getWelcomeConfig(member.guild.id);
    const selectedChannelId = cfg?.channel_id || WELCOME_CHANNEL_ID;
    const configuredChannel = selectedChannelId
      ? await member.guild.channels.fetch(selectedChannelId).catch(() => null)
      : null;

    const targetChannel =
      configuredChannel && configuredChannel.isTextBased()
        ? configuredChannel
        : member.guild.systemChannel && member.guild.systemChannel.isTextBased()
        ? member.guild.systemChannel
        : null;

    if (!targetChannel) return;

    const welcomeText = formatWelcomeMessage(
      cfg?.message || WELCOME_MESSAGE,
      member.guild.name,
      member.id
    );

    await targetChannel.send(welcomeText);
  } catch (err) {
    console.error("Welcome message failed:", err);
  }
});

client.on("messageCreate", async (message) => {
  try {
    if (message.author.bot) return;

    // Track reply context for slash usage
    if (message.reference?.messageId) {
      setReplyContext(
        message.author.id,
        message.channel.id,
        message.reference.messageId
      );
    }

    // Bruh trigger
    const raw = message.content.toLowerCase().trim();
    if (/^bruh+h*$/.test(raw)) {
      await message.reply("bruh indeed 😭");
      return;
    }

    // ===== Mention-based mode =====
    if (!message.mentions.has(client.user)) return;

    const isOwner = message.author.id === OWNER_ID;

    const userText = message.content
      .replace(new RegExp(`<@!?${client.user.id}>`, "g"), "")
      .trim();

    // Fetch replied message (if any)
    let referencedText = "";
    let repliedMsg = null;

    if (message.reference?.messageId) {
      try {
        repliedMsg = await message.channel.messages.fetch(
          message.reference.messageId
        );
        if (repliedMsg?.content) referencedText = repliedMsg.content.trim();
      } catch {}
    }

    // Gather images/audio from current and replied message
    let imageUrls = extractImageUrlsFromMessage(message);
    let audioAtts = extractAudioAttachmentsFromMessage(message);

    if (repliedMsg) {
      imageUrls = imageUrls.concat(extractImageUrlsFromMessage(repliedMsg));
      audioAtts = audioAtts.concat(
        extractAudioAttachmentsFromMessage(repliedMsg)
      );
    }

    imageUrls = imageUrls.slice(0, 3);
    audioAtts = audioAtts.slice(0, 1);

    // ===== Owner-only memory commands (mention mode) =====
    const setMatch = userText.match(/^mem\s+set\s+<@!?(\d+)>\s+(.+)$/i);
    if (setMatch) {
      if (!isOwner)
        return void (await message.reply(
          "Nice try. Only Snooty can edit memory 😌"
        ));
      const targetId = setMatch[1];
      const notes = setMatch[2].trim();

      db.prepare(`
        INSERT INTO user_memory (user_id, notes)
        VALUES (?, ?)
        ON CONFLICT(user_id) DO UPDATE SET notes = excluded.notes
      `).run(targetId, notes);

      await message.reply(`Got it. I’ll remember that about <@${targetId}> 🧠`);
      return;
    }

    const showMatch = userText.match(/^mem\s+show\s+<@!?(\d+)>$/i);
    if (showMatch) {
      if (!isOwner)
        return void (await message.reply(
          "Only Snooty can view other people’s memory 😌"
        ));
      const targetId = showMatch[1];
      const row = db
        .prepare(`SELECT notes FROM user_memory WHERE user_id = ?`)
        .get(targetId);
      await message.reply(
        row?.notes
          ? `Memory for <@${targetId}>:\n${row.notes}`
          : `I have nothing stored for <@${targetId}> yet.`
      );
      return;
    }

    const forgetMatch = userText.match(/^mem\s+forget\s+<@!?(\d+)>$/i);
    if (forgetMatch) {
      if (!isOwner)
        return void (await message.reply(
          "Only Snooty can wipe memory 😈"
        ));
      const targetId = forgetMatch[1];
      db.prepare(`DELETE FROM user_memory WHERE user_id = ?`).run(targetId);
      await message.reply(`Memory wiped for <@${targetId}> 🧽`);
      return;
    }

    // Reply + mention: convert replied text to voice note.
    // Example: reply to message, then send "@MisfitBot voicenote nova"
    const voiceFromReplyMatch = userText.match(
      /^voice(?:\s*note)?(?:\s+(alloy|nova|onyx|echo|fable|shimmer))?$/i
    );
    if (voiceFromReplyMatch && repliedMsg) {
      const text = (repliedMsg.content || "").trim();
      if (!text) {
        await message.reply("That replied message has no text to read 😌");
        return;
      }

      const voice = (voiceFromReplyMatch[1] || "alloy").toLowerCase();
      await message.channel.sendTyping();
      try {
        const mp3Buf = await generateVoiceFromText(text, voice);
        const file = new AttachmentBuilder(mp3Buf, {
          name: "misfit-voicenote.mp3",
        });
        await message.reply({
          content: `🎙️ Voice note ready (${voice}).`,
          files: [file],
        });
      } catch (e) {
        console.error("Voice note (mention/reply) failed:", e);
        await message.reply("⚠️ I couldn’t generate that voice note 😭");
      }
      return;
    }

    // If no prompt but audio exists -> transcribe + explain
    if (!userText && audioAtts.length > 0) {
      await message.channel.sendTyping();
      try {
        const transcript = await transcribeAudioAttachment(audioAtts[0]);
        const explanation = await makeChatReply({
          userId: message.author.id,
          userText: "Explain this transcript briefly and clearly.",
          referencedText: transcript || "(empty transcript)",
          imageUrls: [],
        });

        await message.reply(
          `**Transcript:**\n${(transcript || "—").slice(
            0,
            1400
          )}\n\n**Explanation:**\n${explanation}`.slice(0, 1900)
        );
      } catch (e) {
        console.error("Transcribe (mention) failed:", e);
        await message.reply("⚠️ I couldn’t transcribe that voice note 😭");
      }
      return;
    }

    // If no prompt but images exist -> analyze image
    const finalText =
      userText && userText.length > 0
        ? userText
        : imageUrls.length > 0
        ? "Analyze this image."
        : "";

    if (!finalText) {
      await message.reply("Tag me with a question 😌");
      return;
    }

    await message.channel.sendTyping();
    try {
      const reply = await makeChatReply({
        userId: message.author.id,
        userText: finalText,
        referencedText,
        imageUrls,
      });
      await message.reply(reply.slice(0, 1900));
    } catch (e) {
      console.error("Chat (mention) failed:", e);
      await message.reply("⚠️ Error generating a reply.");
    }
  } catch (err) {
    console.error(err);
  }
});

// Resolve target message from slash option or reply context
async function resolveTargetMessageFromSlash(
  interaction,
  optionName = "message"
) {
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

function helpText() {
  return [
    "**MisfitBot commands** 😌",
    "",
    "**Tag me:**",
    "• `@MisfitBot <question>` — ask normally",
    "• Reply to an image/voice note and tag me — I’ll analyze/transcribe",
    "• Reply to text and tag me with `voicenote` or `voicenote nova`",
    "",
    "**Owner memory (Snooty only):**",
    "• `@MisfitBot mem set @User <notes>`",
    "• `@MisfitBot mem show @User`",
    "• `@MisfitBot mem forget @User`",
    "• `/welcome set channel:#channel message:<text>` (owner)",
    "• `/welcome show` / `/welcome preview` / `/welcome clear` (owner)",
    "• `/mode set name:<sassy|chill|serious|hype|rude|ultraroast>` / `/mode show` (owner)",
    "",
    "**Profiles (opt-in):**",
    "• `/profile set note:<text>`",
    "• `/profile show`",
    "• `/profile clear`",
    "• `/profile setfor user:@User note:<text>` (owner)",
    "• `/profile clearfor user:@User` (owner)",
    "",
    "**Slash:**",
    "• `/help`",
    "• `/ask prompt:<text> [message:<link>]`",
    "• `/summarize [message:<link>]`",
    "• `/explain [message:<link>]`",
    "• `/analyzeimage [message:<link>] [prompt:<text>]`",
    "• `/transcribe [message:<link>] [explain:true]`",
    "• `/imagine prompt:<text>`",
    "• `/summarizechannel count:<1-100>`",
    "• `/voicenote text:<text> [voice]`",
    "",
    "**Right-click a message → Apps:**",
    "• Misfit: Summarize / Explain / Analyze Image / Transcribe Voice / Voice Note",
  ].join("\n");
}

client.on("interactionCreate", async (interaction) => {
  try {
    // ========= Context Menu =========
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

      await interaction.editReply("Nope. That one isn’t wired up 😌");
      return;
    }

    // ========= Slash =========
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "help") {
      // help is fast; reply immediately
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(helpText());
      } else {
        await interaction.reply({ content: helpText(), ephemeral: true });
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
          interaction.user.id
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
              `Current fallback message:`,
              WELCOME_MESSAGE,
            ].join("\n")
          );
          return;
        }

        await interaction.editReply(
          [
            `Channel: <#${cfg.channel_id}>`,
            `Updated by: <@${cfg.updated_by}>`,
            `Template:`,
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
          interaction.user.id
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

    // ✅ NEW: /profile uses EPHEMERAL defer
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

        // Generate a neutral vibe summary (no judgments)
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

      const targetMsg = await resolveTargetMessageFromSlash(
        interaction,
        "message"
      );
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
      const prompt =
        interaction.options.getString("prompt") || "Analyze this image.";

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
        await interaction.editReply(
          "No audio/voice note found in that message 😌"
        );
        return;
      }

      const transcript = await transcribeAudioAttachment(aud[0]);
      if (!transcript) {
        await interaction.editReply("Couldn’t transcribe that audio 😭");
        return;
      }

      if (!doExplain) {
        await interaction.editReply(
          `**Transcript:**\n${transcript}`.slice(0, 1900)
        );
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

    // If Discord already invalidated interaction, don't try to reply/edit.
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

client.login(process.env.DISCORD_TOKEN);
