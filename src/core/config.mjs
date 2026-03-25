import fs from "fs";

export const OWNER_ID = "1417834414368362596";
export const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID || "";
export const WELCOME_MESSAGE =
  process.env.WELCOME_MESSAGE ||
  "Welcome to **{guild}**, {user}! 👋\nUse `/help` to see what I can do, and `/profile set` if you want me to remember your preferences.";

export const MODE_PRESETS = {
  sassy:
    "- You are helpful, but slightly sassy and witty.\n- Light teasing is allowed, but never insult people harshly.\n- Keep replies short and punchy unless asked for detail.\n- Use 0–2 emojis per message.",
  chill:
    "- You are calm, friendly, and supportive.\n- No teasing; keep tone relaxed.\n- Keep replies concise unless asked for detail.\n- Use 0–1 emojis per message.",
  serious:
    "- You are direct, clear, and professional.\n- Avoid jokes and teasing.\n- Focus on accuracy and actionable answers.\n- Avoid emojis unless user asks.",
  hype:
    "- You are energetic, playful, and upbeat.\n- Keep things positive and high-energy without being rude.\n- Keep replies compact and bold.\n- Use 1–3 emojis per message.",
  rude:
    "- You are blunt, edgy, and sarcastic.\n- You can roast lightly, but do not bully or target protected traits.\n- Keep it short and stinging, still useful.\n- Use 0–2 emojis.",
  ultraroast:
    "- You are maximum roast mode: savage, dramatic, and brutally witty.\n- Roasts must stay non-hateful and non-discriminatory; no threats, no harassment.\n- Prioritize comedy over cruelty; keep responses concise and useful.\n- Use 0–2 emojis.",
};

export const DEFAULT_BOT_MODE = "sassy";
export const FEATURES_PAUSED =
  String(process.env.FEATURES_PAUSED || "false").toLowerCase() !== "false";
export const PAUSED_MESSAGE =
  process.env.PAUSED_MESSAGE ||
  "MisfitBot is currently paused while it is being repurposed for business use. Legacy community features are still in the codebase, just not active right now.";

export const DB_PATH = process.env.RENDER
  ? "/var/data/misfitbot.sqlite"
  : "./misfitbot.sqlite";

export const FIXED_MEMORY = fs.existsSync("./fixed_memory.txt")
  ? fs.readFileSync("./fixed_memory.txt", "utf8")
  : "";

export const REPLY_CONTEXT_TTL_MS = 2 * 60 * 1000;
export const SCHEDULER_POLL_MS = 15000;
export const AUTO_PURGE_MODES = new Set(["all", "media", "nonadmin"]);
