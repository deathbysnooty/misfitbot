import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import OpenAI from "openai";
import fs from "fs";
import Database from "better-sqlite3";
const OWNER_ID = "1417834414368362596";

// Render persistent disk path
const DB_PATH = process.env.RENDER ? "/var/data/misfitbot.sqlite" : "./misfitbot.sqlite";
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


const text = message.content.toLowerCase().trim();

if (/^bruh+h*$/.test(text)) {
  await message.reply("bruh indeed 😭");
  return;
}


    // reply only when MisfitBot is mentioned
    if (!message.mentions.has(client.user)) return;

    // Remove bot mention from the user's message
const userText = message.content
  .replace(new RegExp(`<@!?${client.user.id}>`, "g"), "")
  .trim();

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
  await message.reply(row?.notes ? `Memory for <@${targetId}>:\n${row.notes}` : `I have nothing stored for <@${targetId}> yet.`);
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


// If the user is replying to another message, fetch it and include it
let referencedText = "";
if (message.reference?.messageId) {
  try {
    const repliedMsg = await message.channel.messages.fetch(message.reference.messageId);
    if (repliedMsg?.content) referencedText = repliedMsg.content.trim();
  } catch (e) {
    console.error("Could not fetch replied message:", e);
  }
}

// Build final prompt
const prompt = referencedText
  ? `Message being replied to:\n\n${referencedText}\n\nUser request:\n${userText}`
  : userText;

if (!prompt) {
  await message.reply("Tag me with a question 🙂");
  return;
}

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
    { role: "user", content: prompt },
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


