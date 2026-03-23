import "dotenv/config";
import { Client, GatewayIntentBits, ApplicationCommandType } from "discord.js";
import OpenAI from "openai";

import {
  OWNER_ID,
  WELCOME_CHANNEL_ID,
  WELCOME_MESSAGE,
  MODE_PRESETS,
  DEFAULT_BOT_MODE,
  FEATURES_PAUSED,
  PAUSED_MESSAGE,
  DB_PATH,
  FIXED_MEMORY,
  REPLY_CONTEXT_TTL_MS,
  SCHEDULER_POLL_MS,
  AUTO_PURGE_MODES,
} from "./src/core/config.mjs";
import {
  extractImageUrlsFromMessage,
  extractAudioAttachmentsFromMessage,
  parseDiscordMessageLink,
  extFromContentType,
  extFromUrl,
  extFromName,
  downloadToTemp,
  isDiscordUnknownInteraction,
  isAlreadyAcknowledged,
  safeDefer,
  extractAttachmentUrlsFromMessage,
  parseMediaUrlsInput,
  parseScheduleTimeToUnixSeconds,
  scheduleTimeLabel,
  clampPurgeScanLimit,
  formatWelcomeMessage,
  parseIntervalToSeconds,
  formatIntervalLabel,
  resolveTimeZoneInput,
  parseLocalHHMMToNextUnixSeconds,
} from "./src/core/helpers.mjs";
import { createDb } from "./src/core/db.mjs";
import { createReplyContext } from "./src/core/replyContext.mjs";
import {
  getCommands,
  getHelpText,
  registerCommands,
} from "./src/core/commands.mjs";
import { createAiService } from "./src/services/ai.mjs";
import { createSchedulerService } from "./src/services/scheduler.mjs";
import { createTriviaService } from "./src/services/trivia.mjs";
import { createDashboardService } from "./src/services/dashboard.mjs";
import { createBusinessBriefingService } from "./src/services/businessBriefing.mjs";
import { registerGuildMemberAddHandler } from "./src/handlers/guildMemberAdd.mjs";
import { registerMessageCreateHandler } from "./src/handlers/messageCreate.mjs";
import { registerInteractionCreateHandler } from "./src/handlers/interactionCreate.mjs";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const {
  db,
  getProfile,
  upsertProfile,
  setVibe,
  clearProfile,
  getWelcomeConfig,
  upsertWelcomeConfig,
  clearWelcomeConfig,
  getGuildFeatureConfig,
  upsertGuildFeatureConfig,
  clearGuildFeatureConfig,
  getBotMode: getBotModeFromDb,
  setBotMode,
  getUserMemory,
  setUserMemory,
  clearUserMemory,
} = createDb({
  dbPath: DB_PATH,
  defaultBotMode: DEFAULT_BOT_MODE,
});

const getBotMode = () => getBotModeFromDb(MODE_PRESETS);

const replyContext = createReplyContext(REPLY_CONTEXT_TTL_MS);

const ai = createAiService({
  openai,
  fixedMemory: FIXED_MEMORY,
  modePresets: MODE_PRESETS,
  getBotMode,
  getProfile,
  getUserMemory,
  extractImageUrlsFromMessage,
  extractAudioAttachmentsFromMessage,
  extFromName,
  extFromContentType,
  extFromUrl,
  downloadToTemp,
});

const scheduler = createSchedulerService({
  client,
  db,
  autoPurgeModes: AUTO_PURGE_MODES,
  clampPurgeScanLimit,
  schedulerPollMs: SCHEDULER_POLL_MS,
});
const trivia = createTriviaService();
const dashboard = createDashboardService({
  db,
  client,
  getBotMode,
  setBotMode,
  ownerId: OWNER_ID,
  clampPurgeScanLimit,
});
const businessBriefing = createBusinessBriefingService({
  client,
  db,
  openai,
});

const commands = getCommands({ ApplicationCommandType, featuresPaused: FEATURES_PAUSED });
const helpText = getHelpText({
  featuresPaused: FEATURES_PAUSED,
  pausedMessage: PAUSED_MESSAGE,
});

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await registerCommands(client, commands);
  scheduler.startScheduler();
  dashboard.start();
  businessBriefing.start();
});

registerGuildMemberAddHandler({
  client,
  featuresPaused: FEATURES_PAUSED,
  getWelcomeConfig,
  WELCOME_CHANNEL_ID,
  WELCOME_MESSAGE,
  formatWelcomeMessage,
});

registerMessageCreateHandler({
  client,
  OWNER_ID,
  featuresPaused: FEATURES_PAUSED,
  pausedMessage: PAUSED_MESSAGE,
  db,
  setUserMemory,
  clearUserMemory,
  ai,
  extractImageUrlsFromMessage,
  extractAudioAttachmentsFromMessage,
  setReplyContext: replyContext.setReplyContext,
  parseScheduleTimeToUnixSeconds,
  parseIntervalToSeconds,
  formatIntervalLabel,
});

registerInteractionCreateHandler({
  client,
  openai,
  trivia,
  db,
  OWNER_ID,
  WELCOME_CHANNEL_ID,
  WELCOME_MESSAGE,
  MODE_PRESETS,
  featuresPaused: FEATURES_PAUSED,
  pausedMessage: PAUSED_MESSAGE,
  getBotMode,
  setBotMode,
  getProfile,
  upsertProfile,
  setVibe,
  clearProfile,
  getWelcomeConfig,
  upsertWelcomeConfig,
  clearWelcomeConfig,
  getGuildFeatureConfig,
  upsertGuildFeatureConfig,
  clearGuildFeatureConfig,
  getReplyContext: replyContext.getReplyContext,
  makeChatReply: ai.makeChatReply,
  transcribeAudioAttachment: ai.transcribeAudioAttachment,
  generateImageFromPrompt: ai.generateImageFromPrompt,
  generateVoiceFromText: ai.generateVoiceFromText,
  formatMessageForChannelSummary: ai.formatMessageForChannelSummary,
  purgeMessagesInChannel: scheduler.purgeMessagesInChannel,
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
  autoPurgeModes: AUTO_PURGE_MODES,
  formatWelcomeMessage,
  formatIntervalLabel,
  resolveTimeZoneInput,
  parseLocalHHMMToNextUnixSeconds,
  runManualBriefing: businessBriefing.runManualBriefing,
});

client.login(process.env.DISCORD_TOKEN);

// Start Telegram bot as a child process (if token is set)
if (process.env.TELEGRAM_BOT_TOKEN) {
  import("node:child_process").then(({ spawn }) => {
    const tg = spawn("python3", ["telegram_bot.py"], {
      stdio: "inherit",
      env: process.env,
    });
    tg.on("error", (err) => console.error("❌ Telegram bot failed to start:", err.message));
    tg.on("exit", (code) => {
      if (code) console.error(`⚠️ Telegram bot exited with code ${code}`);
    });
    console.log("🤖 Telegram bot spawned");
  });
}
