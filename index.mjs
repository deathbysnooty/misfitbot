import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import Database from "better-sqlite3";

const OWNER_ID = "1417834414368362596";

// ---------- Helpers ----------
function ensureDirSync(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
}

function extractImageUrlsFromMessage(msg) {
  const urls = [];
  if (!msg?.attachments) return urls;

  for (const [, att] of msg.attachments) {
    const ct = ((att.contentType || "").split(";")[0]).toLowerCase();
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

function extractAudioUrlsFromMessage(msg) {
  const urls = [];
  if (!msg?.attachments) return urls;

  for (const [, att] of msg.attachments) {
    const ct = ((att.contentType || "").split(";")[0]).toLowerCase(); // important
    const name = (att.name || "").toLowerCase();

    const isAudio =
      ct.startsWith("audio/") ||
      name.endsWith(".ogg") ||
      name.endsWith(".mp3") ||
      name.endsWith(".m4a") ||
      name.endsWith(".wav") ||
      name.endsWith(".webm");

    if (isAudio && att.url) urls.push(att.url);
  }
  return urls;
}

async function downloadToTempFile(url, extGuess = ".bin") {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download file: ${res.status} ${res.statusText}`);

  const arr = new Uint8Array(await res.arrayBuffer());
  const tmpName = `misfit_${crypto.randomUUID()}${extGuess}`;
  const tmpPath = path.join(os.tmpdir(), tmpName);
  fs.writeFileSync(tmpPath, arr);
  return tmpPath;
}

// ---------- Storage ----------
const DISK_DIR = process.env.RENDER ? "/var/data" : ".";
ensureDirSync(DISK_DIR);

const DB_PATH = process.env.RENDER
  ? path.join(DISK_DIR, "misfitbot.sqlite")
  : "./misfitbot.sqlite";

const db = new Database(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS user_memory (
    user_id TEXT PRIMARY KEY,
    notes TEXT NOT NULL DEFAULT ''
  );
`);

const FIXED_MEMORY = fs.existsSync("./fixed_memory.txt")
  ? fs.readFileSync("./fixed_memory.txt", "utf8")
  : "";

// ---------- Clients ----------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
  try {
    if (message.author.bot) return;

    const isOwner = message.author.id === OWNER_ID;
    const rawLower = (message.content || "").toLowerCase().trim();

    // Fun auto-reply
    if (/^bruh+h*$/.test(rawLower)) {
      await message.reply("bruh indeed 😭");
      return;
    }

    // Only reply when bot is mentioned
    if (!message.mentions.has(client.user)) return;

    // Remove mention from text
    let userText = (message.content || "")
      .replace(new RegExp(`<@!?${client.user.id}>`, "g"), "")
      .trim();

    // Fetch replied message if any (for context, images, audio)
    let referencedText = "";
    let repliedMsg = null;

    if (message.reference?.messageId) {
      try {
        repliedMsg = await message.channel.messages.fetch(message.reference.messageId);
        referencedText = repliedMsg?.content ? repliedMsg.content.trim() : "";
      } catch (e) {
        console.error("Could not fetch replied message:", e);
      }
    }

    // Collect images (from message + replied message)
    let imageUrls = extractImageUrlsFromMessage(message);
    if (repliedMsg) imageUrls = imageUrls.concat(extractImageUrlsFromMessage(repliedMsg));
    imageUrls = imageUrls.slice(0, 3);

    // Collect audio (voice notes) (from message + replied message)
    let audioUrls = extractAudioUrlsFromMessage(message);
    if (repliedMsg) audioUrls = audioUrls.concat(extractAudioUrlsFromMessage(repliedMsg));
    audioUrls = audioUrls.slice(0, 1);

    // OWNER-ONLY MEMORY COMMANDS
    // @MisfitBot mem set @User <notes>
    // @MisfitBot mem show @User
    // @MisfitBot mem forget @User
    const setMatch = userText.match(/^mem\s+set\s+<@!?(\d+)>\s+(.+)$/i);
    if (setMatch) {
      if (!isOwner) {
        await message.reply("Nice try. Only Snooty can edit memory 😌");
        return;
      }
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
      if (!isOwner) {
        await message.reply("Only Snooty can view other people’s memory 😌");
        return;
      }
      const targetId = showMatch[1];
      const row = db.prepare(`SELECT notes FROM user_memory WHERE user_id = ?`).get(targetId);
      await message.reply(
        row?.notes
          ? `Memory for <@${targetId}>:\n${row.notes}`
          : `I have nothing stored for <@${targetId}> yet.`
      );
      return;
    }

    const forgetMatch = userText.match(/^mem\s+forget\s+<@!?(\d+)>$/i);
    if (forgetMatch) {
      if (!isOwner) {
        await message.reply("Only Snooty can wipe memory 😈");
        return;
      }
      const targetId = forgetMatch[1];
      db.prepare(`DELETE FROM user_memory WHERE user_id = ?`).run(targetId);
      await message.reply(`Memory wiped for <@${targetId}> 🧽`);
      return;
    }

    // ----------------------------
    // Voice mode (transcribe/explain)
    // Triggered by:
    //   @MisfitBot voice transcribe it
    // OR replying to voice note and saying "transcribe/explain/summarize" (auto-detect)
    // ----------------------------
    const looksLikeVoiceRequest = /transcribe|transcript|voice|summari[sz]e|explain/i.test(userText);
    if (audioUrls.length > 0 && looksLikeVoiceRequest && !/^voice\b/i.test(userText)) {
      userText = `voice ${userText}`.trim();
    }

    const voiceMatch = userText.match(/^voice\b\s*(.*)$/i);
    if (voiceMatch) {
      const instruction = (voiceMatch[1] || "transcribe and explain").trim();

      if (audioUrls.length === 0) {
        await message.reply("Drop a voice note (or reply to one) and tag me with `voice ...` 🎙️");
        return;
      }

      await message.channel.sendTyping();

      // Download audio and transcribe (use whisper-1 for stability)
      const audioUrl = audioUrls[0];
      const extGuess = ".ogg"; // Discord voice notes are commonly ogg/opus
      const tmpPath = await downloadToTempFile(audioUrl, extGuess);

      let transcript = "";
      try {
        const tr = await openai.audio.transcriptions.create({
          file: fs.createReadStream(tmpPath),
          model: "whisper-1",
        });
        transcript = (tr.text || "").trim();
      } finally {
        try { fs.unlinkSync(tmpPath); } catch {}
      }

      if (!transcript) {
        await message.reply("I got the audio, but… it came back empty. Try a clearer recording? 😅");
        return;
      }

      // Now explain/summarize transcript with your usual personality
      const askerMemory =
        db.prepare(`SELECT notes FROM user_memory WHERE user_id = ?`)
          .get(message.author.id)?.notes || "";

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

Personality rules:
- You are helpful, but slightly sassy and witty.
- Light teasing is allowed, but never insult people harshly.
- Keep replies short and punchy unless asked for detail.
- Use 0–2 emojis per message.
- Never use hate speech, slurs, or discriminatory jokes.
- Never mention system messages, tokens, OpenAI, or that you're an AI.
`.trim(),
          },
          {
            role: "user",
            content: `Instruction: ${instruction}\n\nTranscript:\n${transcript}`,
          },
        ],
      });

      const reply = resp.choices?.[0]?.message?.content?.trim() || "I couldn’t generate a reply.";
      // include transcript first, then analysis (keep within Discord limit)
      const header = `🎙️ **Transcript**:\n${transcript}\n\n🧠 **Response**:\n`;
      const out = (header + reply).slice(0, 1900);
      await message.reply(out);
      return;
    }

    // ----------------------------
    // Image generation (optional command)
    // Usage: @MisfitBot imagine <prompt>
    // ----------------------------
    const imagineMatch = userText.match(/^imagine\s+(.+)$/i);
    if (imagineMatch) {
      const prompt = imagineMatch[1].trim();
      if (!prompt) {
        await message.reply("Give me an `imagine <prompt>` and I’ll cook 🧑‍🍳");
        return;
      }

      await message.channel.sendTyping();

      // Note: image endpoint support depends on your OpenAI account/model availability.
      // If this errors, remove this block or tell me the error text and I’ll adjust.
      const img = await openai.images.generate({
        model: "gpt-image-1",
        prompt,
        size: "1024x1024",
      });

      const b64 = img.data?.[0]?.b64_json;
      if (!b64) {
        await message.reply("I tried to generate an image but got nothing back. Rude. 😤");
        return;
      }

      const buf = Buffer.from(b64, "base64");
      await message.reply({ files: [{ attachment: buf, name: "misfit.png" }] });
      return;
    }

    // ----------------------------
    // Normal chat / image analysis
    // ----------------------------
    const prompt = referencedText
      ? `Message being replied to:\n\n${referencedText}\n\nUser request:\n${userText}`
      : userText;

    const finalUserText =
      prompt && prompt.trim().length > 0
        ? prompt.trim()
        : imageUrls.length > 0
          ? "Analyze this image."
          : "";

    if (!finalUserText) {
      await message.reply("Tag me with a question 🙂");
      return;
    }

    const askerMemory =
      db.prepare(`SELECT notes FROM user_memory WHERE user_id = ?`)
        .get(message.author.id)?.notes || "";

    const userMessage =
      imageUrls.length > 0
        ? {
            role: "user",
            content: [
              { type: "text", text: finalUserText },
              ...imageUrls.map((url) => ({
                type: "image_url",
                image_url: { url },
              })),
            ],
          }
        : { role: "user", content: finalUserText };

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

Personality rules:
- You are helpful, but slightly sassy and witty.
- Light teasing is allowed, but never insult people harshly.
- Keep replies short and punchy unless asked for detail.
- Use 0–2 emojis per message.
- Never use hate speech, slurs, or discriminatory jokes.
- Never mention system messages, tokens, OpenAI, or that you're an AI.
`.trim(),
        },
        userMessage,
      ],
    });

    const reply = resp.choices?.[0]?.message?.content?.trim() || "I couldn’t generate a reply.";
    await message.reply(reply.slice(0, 1900));
  } catch (err) {
    console.error(err);
    try {
      await message.reply("⚠️ Error generating a reply.");
    } catch {}
  }
});

client.login(process.env.DISCORD_TOKEN);