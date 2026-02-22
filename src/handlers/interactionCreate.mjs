import {
  AttachmentBuilder,
  EmbedBuilder,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { MBTI_QUESTIONS, MBTI_TYPE_SUMMARIES, MBTI_AXIS_INFO } from "../core/mbti.mjs";

export function registerInteractionCreateHandler({
  client,
  openai,
  trivia,
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
  formatIntervalLabel,
  resolveTimeZoneInput,
  parseLocalHHMMToNextUnixSeconds,
}) {
  const EMBED_COLORS = {
    info: 0x5865f2,
    success: 0x57f287,
    warn: 0xfee75c,
    error: 0xed4245,
  };

  function statusEmbed({
    title,
    description,
    tone = "info",
  }) {
    return new EmbedBuilder()
      .setColor(EMBED_COLORS[tone] || EMBED_COLORS.info)
      .setTitle(title)
      .setDescription(String(description || "").slice(0, 4000));
  }

  const pendingScheduleEmbedModal = new Map();
  const pendingScheduleTextModal = new Map();
  const pendingWelcomeSetModal = new Map();
  const pendingProfileSetModal = new Map();
  const pendingProfileSetForModal = new Map();
  const activeQuizSessions = new Map(); // guildId -> active quiz session
  const lastStartQuestionKeyByGuild = new Map(); // guildId -> last opening question key
  const quizLeaderRoleOwnerByGuild = new Map(); // guildId -> current leader user id
  const QUIZ_CHANNEL_ID = String(process.env.QUIZ_CHANNEL_ID || "").trim();
  const QUIZ_LEADER_ROLE_ID = String(process.env.QUIZ_LEADER_ROLE_ID || "")
    .trim()
    .replace(/\D/g, "");
  const QUIZ_ACK_WINDOW_SECONDS = Math.max(
    5,
    Math.min(60, Number(process.env.QUIZ_ACK_WINDOW_SECONDS || 15) || 15)
  );
  const QUIZ_NEXT_DELAY_SECONDS = Math.max(
    0,
    Math.min(30, Number(process.env.QUIZ_NEXT_DELAY_SECONDS || 5) || 5)
  );
  const QUIZ_OPEN_ANSWER_PERCENT = Math.max(
    0,
    Math.min(100, Number(process.env.QUIZ_OPEN_ANSWER_PERCENT || 35) || 35)
  );
  const BOT_GUIDE_URL = String(
    process.env.BOT_GUIDE_URL || "https://deathbysnooty.github.io/misfitbot/"
  ).trim();

  function cleanupPending(map, maxAgeMs = 20 * 60 * 1000) {
    const now = Date.now();
    for (const [k, v] of map.entries()) {
      if (now - (v?.createdAt || 0) > maxAgeMs) map.delete(k);
    }
  }

  function parseEmbedColor(input) {
    const raw = String(input || "").trim();
    if (!raw) return EMBED_COLORS.info;
    const hex = raw.replace(/^#/, "").toUpperCase();
    if (!/^[0-9A-F]{6}$/.test(hex)) return null;
    return parseInt(hex, 16);
  }

  function normalizePresetTitle(input) {
    return String(input || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
  }

  function presetTitleKey(input) {
    return normalizePresetTitle(input).toLowerCase();
  }

  const MBTI_ANSWER_VALUES = {
    sd: -2,
    d: -1,
    a: 1,
    sa: 2,
  };

  const QUIZ_GENRE_LABELS = {
    mixed: "Mixed",
    history: "History",
    politics: "Politics",
    sports: "Sports",
    harry_potter: "Harry Potter",
    game_of_thrones: "Game of Thrones",
    lord_of_the_rings: "Lord of the Rings",
    movies: "Movies",
    tv_show: "TV Show",
    celebrity_news: "Celebrity News",
    music: "Music",
    random: "Random",
  };

  function sanitizeModelJson(raw) {
    const text = String(raw || "").trim();
    if (!text) return "";
    if (text.startsWith("```")) {
      return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    }
    return text;
  }

  function quizCategoryPrompt(category) {
    const c = String(category || "mixed").toLowerCase();
    if (!c || c === "mixed" || c === "random") {
      return "Topic must be mixed/random across history, politics, sports, books, movies, TV, celebrity news, and music.";
    }
    const label = QUIZ_GENRE_LABELS[c] || c;
    return `Topic must be strictly: ${label}. Keep it in that category only.`;
  }

  async function generateQuizQuestion(category = "mixed") {
    const resp = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            "Create one short-answer quiz question and return strict JSON only. Keys: question (string), answer (string, one word or short phrase), aliases (array of strings max 6), explanation (string max 180 chars). No markdown.",
        },
        {
          role: "user",
          content: quizCategoryPrompt(category),
        },
      ],
      temperature: 0.9,
    });

    const raw = resp.choices?.[0]?.message?.content || "";
    let parsed = null;
    try {
      parsed = JSON.parse(sanitizeModelJson(raw));
    } catch {
      parsed = null;
    }

    const question = String(parsed?.question || "").trim();
    const answer = String(parsed?.answer || "").trim();
    const aliases = Array.isArray(parsed?.aliases)
      ? parsed.aliases
          .map((v) => String(v || "").trim())
          .filter(Boolean)
          .slice(0, 6)
      : [];
    const explanation = String(parsed?.explanation || "").trim().slice(0, 180);

    if (!question || !answer) {
      throw new Error("Quiz generation failed.");
    }

    return {
      question: question.slice(0, 1200),
      answer: answer.slice(0, 120),
      aliases: aliases.map((v) => v.slice(0, 120)),
      explanation,
    };
  }

  function normalizeQuestionKey(input) {
    return String(input || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  async function generateUniqueQuizQuestion({
    recentQuestionKeys = [],
    maxTries = 5,
    category = "mixed",
  }) {
    const seen = new Set(recentQuestionKeys.filter(Boolean));

    for (let i = 0; i < maxTries; i += 1) {
      const q = await generateQuizQuestion(category);
      const key = normalizeQuestionKey(q.question);
      if (!seen.has(key)) return q;
    }

    throw new Error("Could not generate a unique quiz question.");
  }

  function insertQuizQuestion({
    genre,
    difficulty,
    question,
    options,
    correctIndex,
    explanation,
    createdBy,
  }) {
    const questionKey = normalizeQuestionKey(question);
    try {
      const result = db
        .prepare(
          `INSERT OR IGNORE INTO quiz_questions
           (genre, difficulty, question, question_key, options_json, correct_index, explanation, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%s','now'))`
        )
        .run(
          genre,
          difficulty,
          question.slice(0, 1200),
          questionKey,
          JSON.stringify(options),
          correctIndex,
          String(explanation || "").slice(0, 180),
          createdBy || ""
        );
      return { inserted: result.changes > 0, questionKey };
    } catch {
      return { inserted: false, questionKey };
    }
  }

  function getStoredQuizQuestion(session) {
    let rows = [];
    try {
      rows = db
        .prepare(
          `SELECT id, genre, question, question_key, options_json, correct_index, explanation, created_by
           FROM quiz_questions
           WHERE (? = 'mixed' OR genre = ?)
           ORDER BY RANDOM()
           LIMIT 200`
        )
        .all(session.genre || "mixed", session.genre || "mixed");
    } catch {
      return null;
    }

    for (const row of rows) {
      const id = Number(row.id);
      if (session.usedQuestionIds.has(id)) continue;
      const key = String(row.question_key || normalizeQuestionKey(row.question || ""));
      if (session.askedQuestionKeys.has(key)) continue;

      let options = [];
      try {
        options = JSON.parse(row.options_json || "[]");
      } catch {
        options = [];
      }
      if (!Array.isArray(options) || options.length < 1) continue;

      const correctIndex = Number(row.correct_index);
      if (
        !Number.isInteger(correctIndex) ||
        correctIndex < 0 ||
        correctIndex >= options.length
      ) {
        continue;
      }

      const normalizedOptions = options.map((v) => String(v || "").slice(0, 120));
      const isOpenTdbRow = String(row.created_by || "") === "opentdb";
      const answerOptions = isOpenTdbRow
        ? [String(normalizedOptions[correctIndex] || "").slice(0, 120)]
        : normalizedOptions;
      const displayOptions = isOpenTdbRow ? normalizedOptions : [];

      return {
        id,
        question: String(row.question || "").slice(0, 1200),
        questionKey: key,
        options: normalizedOptions,
        correctIndex,
        acceptedAnswers: answerOptions,
        displayOptions,
        explanation: String(row.explanation || "").slice(0, 180),
      };
    }

    return null;
  }

  async function getNextQuizPayload(session) {
    const selectedGenre = String(session.genre || "mixed").toLowerCase();
    async function generateOpenPayload() {
      let duplicateFallback = null;
      for (let i = 0; i < 10; i += 1) {
        const generated = await generateUniqueQuizQuestion({
          recentQuestionKeys: Array.from(session.askedQuestionKeys),
          maxTries: 12,
          category: selectedGenre,
        });
        const saved = insertQuizQuestion({
          genre: selectedGenre,
          difficulty: "mixed",
          question: generated.question,
          options: [generated.answer, ...generated.aliases],
          correctIndex: 0,
          explanation: generated.explanation,
          createdBy: session.startedBy,
        });
        const key = saved.questionKey || normalizeQuestionKey(generated.question);
        const payload = {
          id: null,
          question: generated.question,
          questionKey: key,
          options: [generated.answer, ...generated.aliases],
          correctIndex: 0,
          acceptedAnswers: [generated.answer, ...generated.aliases],
          displayOptions: [],
          explanation: generated.explanation,
        };
        if (session.askedQuestionKeys.has(key)) {
          // In narrow categories, strict uniqueness can stall the quiz.
          // Keep one duplicate fallback so rounds never deadlock.
          duplicateFallback = payload;
          continue;
        }

        return payload;
      }
      return duplicateFallback;
    }

    async function getOnlinePayload() {
      const online = await trivia?.getQuestion?.({
        avoidQuestionKeys: Array.from(session.askedQuestionKeys),
        category: selectedGenre,
      });
      if (!online?.question || !online?.answer) return null;
      const key = normalizeQuestionKey(online.question);
      if (session.askedQuestionKeys.has(key)) return null;

      const onlineOptions = Array.isArray(online.options) && online.options.length
        ? online.options.map((v) => String(v || "").slice(0, 120)).filter(Boolean)
        : [String(online.answer || "").slice(0, 120)].filter(Boolean);
      const onlineCorrectIndex =
        Number.isInteger(online.correctIndex) &&
        online.correctIndex >= 0 &&
        online.correctIndex < onlineOptions.length
          ? online.correctIndex
          : Math.max(0, onlineOptions.findIndex((v) => v === online.answer));
      insertQuizQuestion({
        genre: selectedGenre,
        difficulty: "mixed",
        question: online.question,
        options: onlineOptions,
        correctIndex: onlineCorrectIndex,
        explanation: online.explanation || "",
        createdBy: "opentdb",
      });
      return {
        id: null,
        question: online.question,
        questionKey: key,
        options: onlineOptions,
        correctIndex: onlineCorrectIndex,
        acceptedAnswers: [String(onlineOptions[onlineCorrectIndex] || "").trim()],
        displayOptions: onlineOptions,
        explanation: online.explanation || "",
      };
    }

    const preferOpen = Math.random() * 100 < QUIZ_OPEN_ANSWER_PERCENT;
    if (preferOpen) {
      const openPayload = await generateOpenPayload();
      if (openPayload) return openPayload;
    }

    const onlinePayload = await getOnlinePayload();
    if (onlinePayload) return onlinePayload;

    const stored = getStoredQuizQuestion(session);
    if (stored) return stored;

    const openPayload = await generateOpenPayload();
    if (openPayload) return openPayload;

    throw new Error("No unique question available for this session.");
  }

  async function syncQuizLeaderRole(guildId) {
    if (!QUIZ_LEADER_ROLE_ID || !guildId) return;

    const top = db
      .prepare(
        `SELECT user_id
         FROM quiz_scores
         WHERE guild_id = ?
         ORDER BY points DESC, correct_answers DESC, total_attempts ASC
         LIMIT 1`
      )
      .get(guildId);
    const newLeaderId = String(top?.user_id || "");
    const oldLeaderId = String(quizLeaderRoleOwnerByGuild.get(guildId) || "");
    if (newLeaderId && oldLeaderId && newLeaderId === oldLeaderId) return;

    const guild = client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
    if (!guild) return;
    const role = await guild.roles.fetch(QUIZ_LEADER_ROLE_ID).catch((err) => {
      console.warn("Quiz leader role fetch failed:", err?.message || err);
      return null;
    });
    if (!role) {
      console.warn(`Quiz leader role not found for guild ${guildId}. Check QUIZ_LEADER_ROLE_ID.`);
      return;
    }

    // First sync after restart: normalize all existing holders before assigning new winner.
    if (!oldLeaderId) {
      await guild.members.fetch().catch(() => null);
      const holders = role.members.filter((m) => newLeaderId ? m.id !== newLeaderId : true);
      for (const member of holders.values()) {
        await member.roles.remove(role).catch((err) => {
          console.warn(`Quiz leader role remove failed for ${member.id}:`, err?.message || err);
        });
      }
    } else if (oldLeaderId !== newLeaderId) {
      const oldMember = await guild.members.fetch(oldLeaderId).catch(() => null);
      if (oldMember?.roles?.cache?.has(role.id)) {
        await oldMember.roles.remove(role).catch((err) => {
          console.warn(`Quiz leader role remove failed for ${oldLeaderId}:`, err?.message || err);
        });
      }
    }

    if (newLeaderId) {
      const newMember = await guild.members.fetch(newLeaderId).catch(() => null);
      if (newMember && !newMember.roles.cache.has(role.id)) {
        await newMember.roles.add(role).catch((err) => {
          console.warn(`Quiz leader role add failed for ${newLeaderId}:`, err?.message || err);
        });
      }
      quizLeaderRoleOwnerByGuild.set(guildId, newLeaderId);
      return;
    }

    quizLeaderRoleOwnerByGuild.delete(guildId);
  }

  async function recordQuizAttempt({ guildId, userId, pointsAwarded }) {
    const points = Math.max(0, Number(pointsAwarded) || 0);
    const correctDelta = points > 0 ? 1 : 0;
    db.prepare(`
      INSERT INTO quiz_scores (
        guild_id, user_id, points, correct_answers, total_attempts, updated_at
      )
      VALUES (?, ?, ?, ?, 1, strftime('%s','now'))
      ON CONFLICT(guild_id, user_id) DO UPDATE SET
        points = points + excluded.points,
        correct_answers = correct_answers + excluded.correct_answers,
        total_attempts = total_attempts + 1,
        updated_at = strftime('%s','now')
    `).run(guildId, userId, points, correctDelta);
    await syncQuizLeaderRole(guildId).catch(() => {});
  }

  function normalizeQuizAnswer(input) {
    return normalizeQuestionKey(input);
  }

  function levenshteinDistance(a, b) {
    const s = String(a || "");
    const t = String(b || "");
    const m = s.length;
    const n = t.length;
    if (!m) return n;
    if (!n) return m;
    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i += 1) dp[i][0] = i;
    for (let j = 0; j <= n; j += 1) dp[0][j] = j;
    for (let i = 1; i <= m; i += 1) {
      for (let j = 1; j <= n; j += 1) {
        const cost = s[i - 1] === t[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost
        );
      }
    }
    return dp[m][n];
  }

  function isGuessCloseEnough(guessKey, answerKeys) {
    if (!guessKey) return false;
    for (const ans of answerKeys) {
      if (!ans) continue;
      if (guessKey === ans) return true;
      // Do not fuzzy-match short tokens (like A/B/C/D or 1/2/3/4).
      // They must be exact to avoid false positives.
      if (guessKey.length <= 2 || ans.length <= 2) continue;
      const gap = Math.abs(guessKey.length - ans.length);
      if (gap > 2) continue;
      const dist = levenshteinDistance(guessKey, ans);
      if (dist <= 1) return true;
      if (guessKey.length >= 6 && dist <= 2) return true;
    }
    return false;
  }

  async function reactQuizAnswer(message, emoji) {
    try {
      await message.react(emoji);
    } catch {
      // Ignore missing reaction permissions.
    }
  }

  async function fetchQuizChannel(session) {
    const ch = await client.channels.fetch(session.channelId).catch(() => null);
    if (!ch?.isTextBased()) return null;
    return ch;
  }

  async function sendOpenQuizQuestion(session) {
    const next = await getNextQuizPayload(session);
    const key = next.questionKey || normalizeQuestionKey(next.question);
    const acceptedAnswers = Array.isArray(next.acceptedAnswers) && next.acceptedAnswers.length
      ? next.acceptedAnswers
      : [String(next.options[next.correctIndex] || "").trim()];
    const displayOptions = Array.isArray(next.displayOptions) ? next.displayOptions : [];
    const optionLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    const optionLines = displayOptions
      .slice(0, optionLetters.length)
      .map((opt, i) => `${optionLetters[i]}. ${String(opt || "").trim()}`)
      .filter(Boolean);
    const correctLetter =
      displayOptions.length > 0 ? optionLetters[next.correctIndex] || "" : "";
    const letterAliases = correctLetter
      ? [correctLetter.toLowerCase(), `${next.correctIndex + 1}`]
      : [];

    session.currentQuestion = next.question;
    session.currentAnswer = String(next.options[next.correctIndex] || "").trim();
    session.currentAnswerKey = normalizeQuizAnswer(session.currentAnswer);
    session.currentAliasKeys = [...acceptedAnswers, ...letterAliases]
      .map((v) => normalizeQuizAnswer(v))
      .filter(Boolean);
    session.currentOptionLines = optionLines;
    session.lastQuestionKey = key;
    session.roundSolved = false;
    session.firstCorrectUserId = null;
    session.correctNoPointUsers = new Set();
    session.scheduledNext = false;

    session.recentQuestionKeys.push(key);
    if (session.recentQuestionKeys.length > 50) {
      session.recentQuestionKeys = session.recentQuestionKeys.slice(-50);
    }
    session.askedQuestionKeys.add(key);
    if (Number.isInteger(next.id)) session.usedQuestionIds.add(next.id);

    const targetChannel = await fetchQuizChannel(session);
    if (!targetChannel) throw new Error("Quiz channel unavailable");

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLORS.info)
      .setTitle("Midnight Misfit Quiz")
      .setDescription(
        [
          session.currentQuestion.slice(0, 3200),
          optionLines.length ? "" : null,
          optionLines.length ? optionLines.join("\n").slice(0, 600) : null,
        ]
          .filter(Boolean)
          .join("\n")
      )
      .setFooter({
        text: optionLines.length
          ? "Reply with option text or letter (A/B/C/D). First correct gets 1 point. Use !hint for a hint."
          : "Reply with a word/phrase. First correct gets 1 point. Use !hint for a hint.",
      });

    await targetChannel.send({ embeds: [embed] });
  }

  function scheduleNextOpenQuizQuestion(session, delaySeconds = null) {
    if (!session || !session.active || session.scheduledNext) return;
    session.scheduledNext = true;
    if (session.nextQuestionTimeout) clearTimeout(session.nextQuestionTimeout);
    const delayMs = Math.max(
      1000,
      (Number.isFinite(delaySeconds) ? delaySeconds : session.intervalSeconds) * 1000
    );

    session.nextQuestionTimeout = setTimeout(async () => {
      try {
        if (!session.active) {
          session.scheduledNext = false;
          return;
        }
        await sendOpenQuizQuestion(session);
      } catch (err) {
        session.scheduledNext = false;
        console.error("Open quiz next question failed:", err);
        const targetChannel = await fetchQuizChannel(session);
        if (targetChannel) {
          await targetChannel
            .send("⚠️ Couldn’t load the next quiz question. Retrying shortly...")
            .catch(() => {});
        }
        if (session.active) scheduleNextOpenQuizQuestion(session, 8);
      }
    }, delayMs);
  }

  async function forceNextOpenQuizQuestion(session) {
    if (!session || !session.active) return false;
    if (session.nextQuestionTimeout) clearTimeout(session.nextQuestionTimeout);
    session.scheduledNext = false;
    try {
      await sendOpenQuizQuestion(session);
      return true;
    } catch (err) {
      console.error("Force next quiz question failed:", err);
      const targetChannel = await fetchQuizChannel(session);
      if (targetChannel) {
        await targetChannel
          .send("⚠️ Couldn’t load next question right now. Retrying shortly...")
          .catch(() => {});
      }
      scheduleNextOpenQuizQuestion(session, 8);
      return false;
    }
  }

  async function stopOpenQuizSession(session, stoppedByUserId = "") {
    if (!session || !session.active) return;
    session.active = false;
    if (session.nextQuestionTimeout) clearTimeout(session.nextQuestionTimeout);
    activeQuizSessions.delete(session.guildId);

    const targetChannel = await fetchQuizChannel(session);
    if (targetChannel) {
      await targetChannel
        .send(
          stoppedByUserId
            ? `🛑 Quiz stopped by <@${stoppedByUserId}>.`
            : "🛑 Quiz stopped."
        )
        .catch(() => {});
    }
  }

  client.on("messageCreate", async (message) => {
    try {
      if (message.author.bot || !message.guildId) return;

      const session = activeQuizSessions.get(message.guildId);
      if (!session || !session.active) return;
      if (message.channelId !== session.channelId) return;
      if (!session.currentAnswerKey) return;

      const raw = String(message.content || "").trim();
      if (!raw) return;

      if (raw.toLowerCase() === "!hint") {
        if (session.roundSolved || session.hintLock) return;
        session.hintLock = true;
        try {
          const hintResp = await openai.chat.completions.create({
            model: "gpt-4.1-mini",
            messages: [
              {
                role: "system",
                content:
                  "Give one short hint for this quiz question. Do not reveal the exact answer or quote it directly.",
              },
              {
                role: "user",
                content: `Question: ${session.currentQuestion}\nAnswer: ${session.currentAnswer}`,
              },
            ],
            temperature: 0.6,
          });
          const hint =
            hintResp.choices?.[0]?.message?.content?.trim().slice(0, 240) ||
            "Think of the most common short answer to this question.";
          await message.channel.send(`💡 Hint: ${hint}`);
        } catch {
          await message.channel.send("💡 Hint: focus on the most common short answer.");
        } finally {
          session.hintLock = false;
        }
        return;
      }

      const guess = normalizeQuizAnswer(raw);
      if (!guess) return;

      if (
        Array.isArray(session.prevSolvedAnswerKeys) &&
        session.prevSolvedAnswerKeys.length > 0 &&
        Date.now() < session.prevSolvedExpiresAt &&
        session.prevSolvedAnswerKeys.includes(guess) &&
        message.author.id !== session.prevSolvedFirstUserId &&
        !session.prevSolvedAckUsers.has(message.author.id)
      ) {
        await reactQuizAnswer(message, "✅");
        session.prevSolvedAckUsers.add(message.author.id);
        await message.channel.send(
          `✅ <@${message.author.id}> also correct (no points, first answer already scored).`
        );
        return;
      }

      if (!isGuessCloseEnough(guess, session.currentAliasKeys || [session.currentAnswerKey])) {
        await reactQuizAnswer(message, "❌");
        return;
      }

      if (!session.roundSolved) {
        await reactQuizAnswer(message, "✅");
        session.roundSolved = true;
        session.firstCorrectUserId = message.author.id;
        session.prevSolvedAnswerKey = session.currentAnswerKey;
        session.prevSolvedAnswerKeys = [...new Set(session.currentAliasKeys || [])];
        session.prevSolvedFirstUserId = message.author.id;
        session.prevSolvedAckUsers = new Set();
        session.prevSolvedExpiresAt = Date.now() + QUIZ_ACK_WINDOW_SECONDS * 1000;
        await recordQuizAttempt({
          guildId: message.guildId,
          userId: message.author.id,
          pointsAwarded: 1,
        });

        await message.channel.send(
          `✅ <@${message.author.id}> is first and gets **+1 point**.`
        );
        scheduleNextOpenQuizQuestion(session);
        return;
      }

      if (
        message.author.id !== session.firstCorrectUserId &&
        !session.correctNoPointUsers.has(message.author.id)
      ) {
        await reactQuizAnswer(message, "✅");
        session.correctNoPointUsers.add(message.author.id);
        await message.channel.send(
          `✅ <@${message.author.id}> also correct (no points, first answer already scored).`
        );
      }
    } catch (err) {
      console.error("Open quiz message handler failed:", err);
    }
  });

  function computeMbtiType(scores) {
    const ei = scores.score_ei >= 0 ? "E" : "I";
    const sn = scores.score_sn >= 0 ? "S" : "N";
    const tf = scores.score_tf >= 0 ? "T" : "F";
    const jp = scores.score_jp >= 0 ? "J" : "P";
    return `${ei}${sn}${tf}${jp}`;
  }

  function mbtiQuestionEmbed(questionIndex, scores) {
    const q = MBTI_QUESTIONS[questionIndex];
    const total = MBTI_QUESTIONS.length;
    return new EmbedBuilder()
      .setColor(EMBED_COLORS.info)
      .setTitle(`MBTI Test - Question ${questionIndex + 1}/${total}`)
      .setDescription(q.text)
      .setFooter({
        text: "Strongly Disagree=-2, Disagree=-1, Agree=+1, Strongly Agree=+2",
      });
  }

  function mbtiButtons() {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("mbti_ans:sd")
          .setLabel("Strongly Disagree")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("mbti_ans:d")
          .setLabel("Disagree")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("mbti_ans:a")
          .setLabel("Agree")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("mbti_ans:sa")
          .setLabel("Strongly Agree")
          .setStyle(ButtonStyle.Success)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("mbti_nav:back")
          .setLabel("Back")
          .setStyle(ButtonStyle.Secondary)
      ),
    ];
  }

  async function assignMbtiRole(guild, userId, mbtiType) {
    const targetRoleName = `MBTI-${mbtiType}`;
    let role = guild.roles.cache.find((r) => r.name === targetRoleName);
    if (!role) {
      role = await guild.roles.create({
        name: targetRoleName,
        reason: "Auto-created MBTI personality role",
      });
    }

    const member = await guild.members.fetch(userId);
    const toRemove = guild.roles.cache.filter(
      (r) => /^MBTI-[A-Z]{4}$/.test(r.name) && member.roles.cache.has(r.id)
    );
    if (toRemove.size > 0) {
      await member.roles.remove([...toRemove.keys()]).catch(() => {});
    }
    await member.roles.add(role.id).catch(() => {});
  }

  async function generateVibeSummary(note) {
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
    return vibeResp.choices?.[0]?.message?.content?.trim().slice(0, 280) || "";
  }

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
      if (interaction.isAutocomplete()) {
        if (interaction.commandName !== "preset") return;
        if (!interaction.guildId) {
          await interaction.respond([]);
          return;
        }

        const sub = interaction.options.getSubcommand(false);
        if (sub !== "send" && sub !== "remove") {
          await interaction.respond([]);
          return;
        }

        const focused = interaction.options.getFocused(true);
        if (focused.name !== "title") {
          await interaction.respond([]);
          return;
        }

        const keyPart = presetTitleKey(focused.value);
        const rows = keyPart
          ? db
              .prepare(
                `SELECT title
                 FROM message_presets
                 WHERE guild_id = ? AND title_key LIKE ?
                 ORDER BY updated_at DESC
                 LIMIT 25`
              )
              .all(interaction.guildId, `%${keyPart}%`)
          : db
              .prepare(
                `SELECT title
                 FROM message_presets
                 WHERE guild_id = ?
                 ORDER BY updated_at DESC
                 LIMIT 25`
              )
              .all(interaction.guildId);

        const choices = rows.map((r) => {
          const title = String(r.title || "").slice(0, 100);
          return { name: title, value: title };
        });
        await interaction.respond(choices);
        return;
      }

      if (interaction.isButton()) {
        if (
          !interaction.customId.startsWith("mbti_ans:") &&
          !interaction.customId.startsWith("mbti_nav:")
        ) {
          return;
        }
        if (!interaction.guildId) {
          await interaction.reply({
            content: "MBTI test only works in a server.",
            ephemeral: true,
          });
          return;
        }

        const session = db
          .prepare(
            `SELECT guild_id, user_id, current_index, score_ei, score_sn, score_tf, score_jp, answers_json
             FROM mbti_sessions
             WHERE guild_id = ? AND user_id = ? AND active = 1`
          )
          .get(interaction.guildId, interaction.user.id);

        if (!session) {
          await interaction.reply({
            content: "No active MBTI session. Use `/mbti start`.",
            ephemeral: true,
          });
          return;
        }

        let answers = [];
        try {
          answers = JSON.parse(session.answers_json || "[]");
        } catch {}
        if (!Array.isArray(answers)) answers = [];

        if (interaction.customId === "mbti_nav:back") {
          if (session.current_index <= 0 || answers.length === 0) {
            await interaction.reply({
              content: "You are already on the first question.",
              ephemeral: true,
            });
            return;
          }

          const last = answers.pop();
          const nextScores = {
            score_ei: session.score_ei,
            score_sn: session.score_sn,
            score_tf: session.score_tf,
            score_jp: session.score_jp,
          };
          if (last?.axis && Number.isFinite(last?.delta)) {
            const key = `score_${last.axis}`;
            if (Object.prototype.hasOwnProperty.call(nextScores, key)) {
              nextScores[key] -= last.delta;
            }
          }

          const prevIndex = Math.max(0, session.current_index - 1);
          db.prepare(
            `UPDATE mbti_sessions
             SET current_index = ?, score_ei = ?, score_sn = ?, score_tf = ?, score_jp = ?,
                 answers_json = ?, updated_at = strftime('%s','now')
             WHERE guild_id = ? AND user_id = ?`
          ).run(
            prevIndex,
            nextScores.score_ei,
            nextScores.score_sn,
            nextScores.score_tf,
            nextScores.score_jp,
            JSON.stringify(answers),
            interaction.guildId,
            interaction.user.id
          );

          await interaction.update({
            embeds: [mbtiQuestionEmbed(prevIndex, nextScores)],
            components: mbtiButtons(),
          });
          return;
        }

        const answerKey = interaction.customId.slice("mbti_ans:".length);
        const answerValue = MBTI_ANSWER_VALUES[answerKey];
        if (!Number.isFinite(answerValue)) {
          await interaction.reply({ content: "Invalid answer.", ephemeral: true });
          return;
        }

        const q = MBTI_QUESTIONS[session.current_index];
        if (!q) {
          db.prepare(
            `UPDATE mbti_sessions SET active = 0, updated_at = strftime('%s','now')
             WHERE guild_id = ? AND user_id = ?`
          ).run(interaction.guildId, interaction.user.id);
          await interaction.reply({
            content: "Session finished. Use `/mbti result`.",
            ephemeral: true,
          });
          return;
        }

        const axis = MBTI_AXIS_INFO[q.axis];
        const sign = q.agree === axis.positive ? 1 : -1;
        const delta = answerValue * sign;

        const nextScores = {
          score_ei: session.score_ei,
          score_sn: session.score_sn,
          score_tf: session.score_tf,
          score_jp: session.score_jp,
        };
        const key = `score_${q.axis}`;
        nextScores[key] += delta;
        answers.push({ axis: q.axis, delta });

        const nextIndex = session.current_index + 1;
        if (nextIndex < MBTI_QUESTIONS.length) {
          db.prepare(
            `UPDATE mbti_sessions
             SET current_index = ?, score_ei = ?, score_sn = ?, score_tf = ?, score_jp = ?,
                 answers_json = ?,
                 updated_at = strftime('%s','now')
             WHERE guild_id = ? AND user_id = ?`
          ).run(
            nextIndex,
            nextScores.score_ei,
            nextScores.score_sn,
            nextScores.score_tf,
            nextScores.score_jp,
            JSON.stringify(answers),
            interaction.guildId,
            interaction.user.id
          );

          await interaction.update({
            embeds: [mbtiQuestionEmbed(nextIndex, nextScores)],
            components: mbtiButtons(),
          });
          return;
        }

        const mbtiType = computeMbtiType(nextScores);
        db.prepare(
          `UPDATE mbti_sessions
           SET active = 0, current_index = ?, score_ei = ?, score_sn = ?, score_tf = ?, score_jp = ?,
               answers_json = ?,
               updated_at = strftime('%s','now')
           WHERE guild_id = ? AND user_id = ?`
        ).run(
          MBTI_QUESTIONS.length,
          nextScores.score_ei,
          nextScores.score_sn,
          nextScores.score_tf,
          nextScores.score_jp,
          JSON.stringify(answers),
          interaction.guildId,
          interaction.user.id
        );

        db.prepare(
          `INSERT INTO mbti_results (guild_id, user_id, mbti_type, score_ei, score_sn, score_tf, score_jp, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%s','now'))
           ON CONFLICT(guild_id, user_id) DO UPDATE SET
             mbti_type = excluded.mbti_type,
             score_ei = excluded.score_ei,
             score_sn = excluded.score_sn,
             score_tf = excluded.score_tf,
             score_jp = excluded.score_jp,
             completed_at = strftime('%s','now')`
        ).run(
          interaction.guildId,
          interaction.user.id,
          mbtiType,
          nextScores.score_ei,
          nextScores.score_sn,
          nextScores.score_tf,
          nextScores.score_jp
        );

        await assignMbtiRole(interaction.guild, interaction.user.id, mbtiType).catch(
          () => {}
        );

        const resultEmbed = new EmbedBuilder()
          .setColor(EMBED_COLORS.success)
          .setTitle(`Your MBTI Result: ${mbtiType}`)
          .setDescription(MBTI_TYPE_SUMMARIES[mbtiType] || "No summary available.")
          .addFields(
            { name: MBTI_AXIS_INFO.ei.label, value: String(nextScores.score_ei), inline: true },
            { name: MBTI_AXIS_INFO.sn.label, value: String(nextScores.score_sn), inline: true },
            { name: MBTI_AXIS_INFO.tf.label, value: String(nextScores.score_tf), inline: true },
            { name: MBTI_AXIS_INFO.jp.label, value: String(nextScores.score_jp), inline: true }
          )
          .setFooter({ text: "Role assigned: MBTI-{type} (if bot has role permissions)." });

        await interaction.update({
          embeds: [resultEmbed],
          components: [],
        });
        await interaction.followUp({
          content: `🧠 I am **${mbtiType}**. (<@${interaction.user.id}>)`,
          ephemeral: false,
        });
        return;
      }

      if (interaction.isModalSubmit()) {
        const cid = interaction.customId;

        if (cid.startsWith("schedule_embed:")) {
          const token = cid.slice("schedule_embed:".length);
          const pending = pendingScheduleEmbedModal.get(token);
          if (!pending) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Schedule Form Expired",
                  description: "Please run `/schedule addembed` again.",
                  tone: "warn",
                }),
              ],
              ephemeral: true,
            });
            return;
          }

          if (
            pending.userId !== interaction.user.id ||
            pending.guildId !== interaction.guildId
          ) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Schedule Form Invalid",
                  description: "This form does not belong to you.",
                  tone: "error",
                }),
              ],
              ephemeral: true,
            });
            return;
          }

          const title = interaction.fields.getTextInputValue("title").trim().slice(0, 256);
          const description = interaction.fields
            .getTextInputValue("description")
            .trim()
            .slice(0, 4000);
          const colorRaw = interaction.fields.getTextInputValue("color").trim();
          const footer = interaction.fields
            .getTextInputValue("footer")
            .trim()
            .slice(0, 2048);
          const mediaRaw = interaction.fields.getTextInputValue("media_urls").trim();

          const color = parseEmbedColor(colorRaw);
          if (color === null) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Invalid Color",
                  description: "Use 6-digit hex like `#5865F2`.",
                  tone: "warn",
                }),
              ],
              ephemeral: true,
            });
            return;
          }

          const mediaUrls = parseMediaUrlsInput(mediaRaw).slice(0, 10);

          const embedPayload = {
            title: title || undefined,
            description: description || undefined,
            color,
            footer: footer ? { text: footer } : undefined,
          };

          if (!embedPayload.title && !embedPayload.description) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Embed Is Empty",
                  description: "Add a title or description.",
                  tone: "warn",
                }),
              ],
              ephemeral: true,
            });
            return;
          }

          const previewText = description || title || "";
          const result = db
            .prepare(`
              INSERT INTO scheduled_messages (
                guild_id, channel_id, content, media_json, payload_type, embed_json, send_at,
                interval_minutes, active, last_error, created_by, created_at, updated_at
              )
              VALUES (?, ?, ?, ?, 'embed', ?, ?, ?, 1, '', ?, strftime('%s','now'), strftime('%s','now'))
            `)
            .run(
              pending.guildId,
              pending.channelId,
              previewText.slice(0, 1800),
              JSON.stringify(mediaUrls),
              JSON.stringify(embedPayload),
              pending.sendAt,
              pending.repeatMinutes,
              interaction.user.id
            );

          pendingScheduleEmbedModal.delete(token);

          await interaction.reply({
            embeds: [
              statusEmbed({
                title: `Scheduled #${result.lastInsertRowid}`,
                description: [
                  `Type: embed`,
                  `Channel: <#${pending.channelId}>`,
                  `Next run: <t:${pending.sendAt}:F>`,
                  `Repeat: ${
                    pending.repeatMinutes > 0
                      ? `every ${pending.repeatMinutes} minute(s)`
                      : "one-time"
                  }`,
                  `Media items: ${mediaUrls.length}`,
                ].join("\n"),
                tone: "success",
              }),
            ],
            ephemeral: true,
          });
          return;
        }

        if (cid.startsWith("schedule_text:")) {
          const token = cid.slice("schedule_text:".length);
          const pending = pendingScheduleTextModal.get(token);
          if (!pending) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Schedule Form Expired",
                  description: "Please run `/schedule addtext` again.",
                  tone: "warn",
                }),
              ],
              ephemeral: true,
            });
            return;
          }
          if (
            pending.userId !== interaction.user.id ||
            pending.guildId !== interaction.guildId
          ) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Schedule Form Invalid",
                  description: "This form does not belong to you.",
                  tone: "error",
                }),
              ],
              ephemeral: true,
            });
            return;
          }

          const content = interaction.fields
            .getTextInputValue("message")
            .trim()
            .slice(0, 1800);
          const mediaUrls = parseMediaUrlsInput(
            interaction.fields.getTextInputValue("media_urls").trim()
          ).slice(0, 10);

          if (!content && mediaUrls.length === 0) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Schedule Text",
                  description: "Provide message text or media URLs.",
                  tone: "warn",
                }),
              ],
              ephemeral: true,
            });
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
              pending.guildId,
              pending.channelId,
              content,
              JSON.stringify(mediaUrls),
              pending.sendAt,
              pending.repeatMinutes,
              interaction.user.id
            );
          pendingScheduleTextModal.delete(token);

          await interaction.reply({
            embeds: [
              statusEmbed({
                title: `Scheduled #${result.lastInsertRowid}`,
                description: [
                  `Type: text`,
                  `Channel: <#${pending.channelId}>`,
                  `Next run: <t:${pending.sendAt}:F>`,
                  `Repeat: ${
                    pending.repeatMinutes > 0
                      ? `every ${pending.repeatMinutes} minute(s)`
                      : "one-time"
                  }`,
                  `Media items: ${mediaUrls.length}`,
                ].join("\n"),
                tone: "success",
              }),
            ],
            ephemeral: true,
          });
          return;
        }

        if (cid.startsWith("welcome_set:")) {
          const token = cid.slice("welcome_set:".length);
          const pending = pendingWelcomeSetModal.get(token);
          if (!pending) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Welcome Form Expired",
                  description: "Please run `/welcome set` again.",
                  tone: "warn",
                }),
              ],
              ephemeral: true,
            });
            return;
          }
          if (
            pending.userId !== interaction.user.id ||
            pending.guildId !== interaction.guildId
          ) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Welcome Form Invalid",
                  description: "This form does not belong to you.",
                  tone: "error",
                }),
              ],
              ephemeral: true,
            });
            return;
          }
          const message = interaction.fields
            .getTextInputValue("message")
            .trim()
            .slice(0, 1800);
          if (!message) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Welcome Config",
                  description: "Message cannot be empty.",
                  tone: "warn",
                }),
              ],
              ephemeral: true,
            });
            return;
          }
          upsertWelcomeConfig(
            pending.guildId,
            pending.channelId,
            message,
            interaction.user.id
          );
          pendingWelcomeSetModal.delete(token);

          const preview = formatWelcomeMessage(
            message,
            interaction.guild?.name || "this server",
            interaction.user.id,
            WELCOME_MESSAGE
          );

          await interaction.reply({
            embeds: [
              statusEmbed({
                title: "Welcome Config Saved",
                description: `Channel: <#${pending.channelId}>\n\nPreview:\n${preview}`.slice(
                  0,
                  1900
                ),
                tone: "success",
              }),
            ],
            ephemeral: true,
          });
          return;
        }

        if (cid.startsWith("profile_setfor:") || cid.startsWith("profile_set:")) {
          const isSetFor = cid.startsWith("profile_setfor:");
          const token = cid.slice((isSetFor ? "profile_setfor:" : "profile_set:").length);
          const pending = isSetFor
            ? pendingProfileSetForModal.get(token)
            : pendingProfileSetModal.get(token);

          if (!pending) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Profile Form Expired",
                  description: "Please run the profile command again.",
                  tone: "warn",
                }),
              ],
              ephemeral: true,
            });
            return;
          }
          if (
            pending.userId !== interaction.user.id ||
            pending.guildId !== (interaction.guildId || "")
          ) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Profile Form Invalid",
                  description: "This form does not belong to you.",
                  tone: "error",
                }),
              ],
              ephemeral: true,
            });
            return;
          }

          const note = interaction.fields.getTextInputValue("note").trim().slice(0, 1200);
          if (!note) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Profile",
                  description: "Note cannot be empty.",
                  tone: "warn",
                }),
              ],
              ephemeral: true,
            });
            return;
          }

          const targetUserId = isSetFor ? pending.targetUserId : interaction.user.id;
          upsertProfile(targetUserId, note);
          const vibe = await generateVibeSummary(note);
          setVibe(targetUserId, vibe);

          if (isSetFor) pendingProfileSetForModal.delete(token);
          else pendingProfileSetModal.delete(token);

          await interaction.reply({
            embeds: [
              statusEmbed({
                title: "Profile Saved",
                description: isSetFor
                  ? `Saved for <@${targetUserId}>.`
                  : "I’ll remember that.",
                tone: "success",
              }),
            ],
            ephemeral: true,
          });
          return;
        }

        return;
      }

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
        const embed = statusEmbed({
          title: "MisfitBot Help",
          description: helpText,
          tone: "info",
        });
        const helpComponents = [];
        try {
          const u = new URL(BOT_GUIDE_URL);
          if (u.protocol === "https:" || u.protocol === "http:") {
            helpComponents.push(
              new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setStyle(ButtonStyle.Link)
                  .setURL(BOT_GUIDE_URL)
                  .setLabel("Bot Guide")
              )
            );
          }
        } catch {}
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({
            embeds: [embed],
            components: helpComponents,
          });
        } else {
          await interaction.reply({
            embeds: [embed],
            components: helpComponents,
            ephemeral: true,
          });
        }
        return;
      }

      if (interaction.commandName === "quiz") {
        if (!interaction.guildId) {
          await interaction.reply({
            embeds: [
              statusEmbed({
                title: "Quiz",
                description: "This command only works in a server.",
                tone: "warn",
              }),
            ],
            ephemeral: true,
          });
          return;
        }

        const sub = interaction.options.getSubcommand();

        if (sub === "leaderboard") {
          await safeDefer(interaction);
          await syncQuizLeaderRole(interaction.guildId).catch(() => {});
          let limit = interaction.options.getInteger("limit") ?? 10;
          if (limit < 3) limit = 3;
          if (limit > 20) limit = 20;

          const rows = db
            .prepare(
              `SELECT user_id, points, correct_answers, total_attempts
               FROM quiz_scores
               WHERE guild_id = ?
               ORDER BY points DESC, correct_answers DESC, total_attempts ASC
               LIMIT ?`
            )
            .all(interaction.guildId, limit);

          if (rows.length === 0) {
            await interaction.editReply({
              embeds: [
                statusEmbed({
                  title: "Quiz Leaderboard",
                  description: "No quiz scores yet. Start one with `/quiz start`.",
                  tone: "info",
                }),
              ],
            });
            return;
          }

          const lines = rows.map((r, i) => {
            return `${i + 1}. <@${r.user_id}> - **${r.points}** pts`;
          });

          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Quiz Leaderboard",
                description: lines.join("\n").slice(0, 3900),
                tone: "info",
              }),
            ],
          });
          return;
        }

        if (sub === "stop") {
          const session = activeQuizSessions.get(interaction.guildId);
          if (!session || !session.active) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Quiz",
                  description: "No active quiz in this server.",
                  tone: "warn",
                }),
              ],
              ephemeral: true,
            });
            return;
          }

          const isOwner = interaction.user.id === OWNER_ID;
          const isStarter = interaction.user.id === session.startedBy;
          const isAdmin = Boolean(interaction.memberPermissions?.has("ManageGuild"));
          const canStop =
            isOwner || isStarter || isAdmin;
          if (!canStop) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Quiz",
                  description: "Only an admin, the starter, or Snooty can stop this quiz.",
                  tone: "error",
                }),
              ],
              ephemeral: true,
            });
            return;
          }

          await interaction.reply({
            embeds: [
              statusEmbed({
                title: "Quiz",
                description: "Stopping quiz...",
                tone: "info",
                }),
              ],
              ephemeral: true,
            });
          await stopOpenQuizSession(session, interaction.user.id);
          return;
        }

        if (sub === "skip") {
          const session = activeQuizSessions.get(interaction.guildId);
          if (!session || !session.active) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Quiz",
                  description: "No active quiz in this server.",
                  tone: "warn",
                }),
              ],
              ephemeral: true,
            });
            return;
          }

          const isOwner = interaction.user.id === OWNER_ID;
          const isStarter = interaction.user.id === session.startedBy;
          const isAdmin = Boolean(interaction.memberPermissions?.has("ManageGuild"));
          if (!isOwner && !isStarter && !isAdmin) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Quiz",
                  description: "Only an admin, the starter, or Snooty can skip.",
                  tone: "error",
                }),
              ],
              ephemeral: true,
            });
            return;
          }

          session.roundSolved = true;
          session.prevSolvedAnswerKey = session.currentAnswerKey;
          session.prevSolvedAnswerKeys = [...new Set(session.currentAliasKeys || [])];
          session.prevSolvedFirstUserId = "";
          session.prevSolvedAckUsers = new Set();
          session.prevSolvedExpiresAt = Date.now() + QUIZ_ACK_WINDOW_SECONDS * 1000;

          await interaction.reply({
            embeds: [
              statusEmbed({
                title: "Quiz Skipped",
                description: `Correct answer: **${session.currentAnswer}**`,
                tone: "info",
              }),
            ],
            ephemeral: false,
          });
          await forceNextOpenQuizQuestion(session);
          return;
        }

        if (sub === "clearleaderboard") {
          const isOwner = interaction.user.id === OWNER_ID;
          const isAdmin = Boolean(interaction.memberPermissions?.has("ManageGuild"));
          if (!isOwner && !isAdmin) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Quiz",
                  description: "Only an admin or Snooty can clear the quiz leaderboard.",
                  tone: "error",
                }),
              ],
              ephemeral: true,
            });
            return;
          }

          await safeDefer(interaction, { ephemeral: true });
          try {
            const before = db
              .prepare(`SELECT COUNT(*) AS c FROM quiz_scores WHERE guild_id = ?`)
              .get(interaction.guildId)?.c || 0;
            db.prepare(`DELETE FROM quiz_scores WHERE guild_id = ?`).run(interaction.guildId);
            await syncQuizLeaderRole(interaction.guildId).catch(() => {});
            await interaction.editReply({
              embeds: [
                statusEmbed({
                  title: "Quiz Leaderboard Cleared",
                  description: `Removed ${before} score row(s) for this server.`,
                  tone: "success",
                }),
              ],
            });
          } catch {
            await interaction.editReply({
              embeds: [
                statusEmbed({
                  title: "Quiz Leaderboard Clear Failed",
                  description:
                    "Could not clear leaderboard in this DB instance (likely missing table).",
                  tone: "warn",
                }),
              ],
            });
          }
          return;
        }

        if (sub === "start") {
          const existing = activeQuizSessions.get(interaction.guildId);
          if (existing && existing.active) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Quiz Already Running",
                  description: `Quiz is already running in <#${existing.channelId}>.`,
                  tone: "warn",
                }),
              ],
              ephemeral: true,
            });
            return;
          }

          const isOwner = interaction.user.id === OWNER_ID;
          const isAdmin = Boolean(interaction.memberPermissions?.has("ManageGuild"));
          if (!isOwner && !isAdmin) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Permission Denied",
                  description: "Only admins (or Snooty) can start the quiz.",
                  tone: "error",
                }),
              ],
              ephemeral: true,
            });
            return;
          }

          await safeDefer(interaction, { ephemeral: true });
          const rawCategory = String(
            interaction.options.getString("category") || "mixed"
          ).toLowerCase();
          const category = rawCategory === "random" ? "mixed" : rawCategory;
          const allowedCategories = new Set(Object.keys(QUIZ_GENRE_LABELS));
          if (!allowedCategories.has(category)) {
            await interaction.editReply({
              embeds: [
                statusEmbed({
                  title: "Quiz",
                  description: "Invalid category. Use the provided choices.",
                  tone: "warn",
                }),
              ],
            });
            return;
          }

          const channelId = QUIZ_CHANNEL_ID || interaction.channelId;
          const lastStartKey =
            String(lastStartQuestionKeyByGuild.get(interaction.guildId) || "").trim();
          const seedRecent = lastStartKey ? [lastStartKey] : [];

          const session = {
            guildId: interaction.guildId,
            channelId,
            startedBy: interaction.user.id,
            genre: category,
            difficulty: "mixed",
            intervalSeconds: QUIZ_NEXT_DELAY_SECONDS,
            recentQuestionKeys: seedRecent,
            askedQuestionKeys: new Set(seedRecent),
            usedQuestionIds: new Set(),
            currentQuestion: "",
            currentAnswer: "",
            currentAnswerKey: "",
            currentAliasKeys: [],
            currentOptionLines: [],
            roundSolved: false,
            firstCorrectUserId: null,
            correctNoPointUsers: new Set(),
            prevSolvedAnswerKey: "",
            prevSolvedAnswerKeys: [],
            prevSolvedFirstUserId: "",
            prevSolvedAckUsers: new Set(),
            prevSolvedExpiresAt: 0,
            hintLock: false,
            scheduledNext: false,
            nextQuestionTimeout: null,
            active: true,
          };

          try {
            await sendOpenQuizQuestion(session);
            if (session.lastQuestionKey) {
              lastStartQuestionKeyByGuild.set(interaction.guildId, session.lastQuestionKey);
            }
            activeQuizSessions.set(interaction.guildId, session);
          } catch {
            // If uniqueness constraints became too strict with a tiny question pool, retry once.
            if (lastStartKey) {
              try {
                session.recentQuestionKeys = [];
                session.askedQuestionKeys = new Set();
                await sendOpenQuizQuestion(session);
                if (session.lastQuestionKey) {
                  lastStartQuestionKeyByGuild.set(interaction.guildId, session.lastQuestionKey);
                }
                activeQuizSessions.set(interaction.guildId, session);
              } catch {
                await interaction.editReply({
                  embeds: [
                    statusEmbed({
                      title: "Quiz",
                      description:
                        "Could not start quiz question generation. Try again in a few seconds.",
                      tone: "error",
                    }),
                  ],
                });
                return;
              }
            } else {
            await interaction.editReply({
              embeds: [
                statusEmbed({
                  title: "Quiz",
                  description:
                    "Could not start quiz question generation. Try again in a few seconds.",
                  tone: "error",
                }),
              ],
            });
            return;
            }
          }

          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Quiz Started",
                description: [
                  `Channel: <#${channelId}>`,
                  `Category: ${QUIZ_GENRE_LABELS[category] || category}`,
                  "Answer type: word/short phrase",
                  `Next question delay: ${session.intervalSeconds}s`,
                  "Use `!hint` in quiz channel for hints",
                  QUIZ_CHANNEL_ID && interaction.channelId !== channelId
                    ? `Configured quiz channel override is active via \`QUIZ_CHANNEL_ID\`.`
                    : "",
                ]
                  .filter(Boolean)
                  .join("\n"),
                tone: "success",
              }),
            ],
          });
          return;
        }

        await interaction.reply({
          embeds: [
            statusEmbed({
              title: "Quiz",
              description: "That subcommand isn’t wired up 😌",
              tone: "warn",
            }),
          ],
          ephemeral: true,
        });
        return;
      }

      if (interaction.commandName === "mbti") {
        if (!interaction.guildId) {
          await interaction.reply({
            embeds: [
              statusEmbed({
                title: "MBTI Test",
                description: "This command only works in a server.",
                tone: "warn",
              }),
            ],
            ephemeral: true,
          });
          return;
        }

        const sub = interaction.options.getSubcommand();

        if (sub === "start") {
          const mbtiChannelId = process.env.MBTI_CHANNEL_ID || "";
          if (mbtiChannelId && interaction.channelId !== mbtiChannelId) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Wrong Channel",
                  description: `Use this in <#${mbtiChannelId}>.`,
                  tone: "warn",
                }),
              ],
              ephemeral: true,
            });
            return;
          }

          db.prepare(
            `INSERT INTO mbti_sessions (
              guild_id, user_id, current_index, score_ei, score_sn, score_tf, score_jp, answers_json, active, updated_at
            )
            VALUES (?, ?, 0, 0, 0, 0, 0, '[]', 1, strftime('%s','now'))
            ON CONFLICT(guild_id, user_id) DO UPDATE SET
              current_index = 0,
              score_ei = 0,
              score_sn = 0,
              score_tf = 0,
              score_jp = 0,
              answers_json = '[]',
              active = 1,
              updated_at = strftime('%s','now')`
          ).run(interaction.guildId, interaction.user.id);

          await interaction.reply({
            embeds: [
              mbtiQuestionEmbed(0, {
                score_ei: 0,
                score_sn: 0,
                score_tf: 0,
                score_jp: 0,
              }),
            ],
            components: mbtiButtons(),
            ephemeral: true,
          });
          return;
        }

        if (sub === "result") {
          const row = db
            .prepare(
              `SELECT mbti_type, score_ei, score_sn, score_tf, score_jp, completed_at
               FROM mbti_results WHERE guild_id = ? AND user_id = ?`
            )
            .get(interaction.guildId, interaction.user.id);

          if (!row) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "No MBTI Result",
                  description: "Run `/mbti start` first.",
                  tone: "info",
                }),
              ],
              ephemeral: true,
            });
            return;
          }

          const embed = new EmbedBuilder()
            .setColor(EMBED_COLORS.info)
            .setTitle(`Your MBTI Result: ${row.mbti_type}`)
            .setDescription(
              MBTI_TYPE_SUMMARIES[row.mbti_type] || "No summary available."
            )
            .addFields(
              { name: MBTI_AXIS_INFO.ei.label, value: String(row.score_ei), inline: true },
              { name: MBTI_AXIS_INFO.sn.label, value: String(row.score_sn), inline: true },
              { name: MBTI_AXIS_INFO.tf.label, value: String(row.score_tf), inline: true },
              { name: MBTI_AXIS_INFO.jp.label, value: String(row.score_jp), inline: true }
            )
            .setFooter({
              text: `Completed: <t:${row.completed_at}:R>`,
            });

          await interaction.reply({ embeds: [embed], ephemeral: true });
          return;
        }

        if (sub === "reset") {
          const targetUser = interaction.options.getUser("user");
          const isOwner = interaction.user.id === OWNER_ID;
          const targetId = targetUser ? targetUser.id : interaction.user.id;

          if (targetUser && !isOwner) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Permission Denied",
                  description: "Only Snooty can reset someone else’s MBTI data.",
                  tone: "error",
                }),
              ],
              ephemeral: true,
            });
            return;
          }

          db.prepare(
            `DELETE FROM mbti_sessions WHERE guild_id = ? AND user_id = ?`
          ).run(interaction.guildId, targetId);
          db.prepare(
            `DELETE FROM mbti_results WHERE guild_id = ? AND user_id = ?`
          ).run(interaction.guildId, targetId);

          await interaction.reply({
            embeds: [
              statusEmbed({
                title: "MBTI Reset",
                description: targetUser
                  ? `Reset MBTI data for <@${targetId}>.`
                  : "Your MBTI data has been reset.",
                tone: "success",
              }),
            ],
            ephemeral: true,
          });
          return;
        }

        await interaction.reply({
          embeds: [
            statusEmbed({
              title: "MBTI",
              description: "That subcommand isn’t wired up 😌",
              tone: "warn",
            }),
          ],
          ephemeral: true,
        });
        return;
      }

      if (interaction.commandName === "welcome") {
        if (!interaction.guildId) {
          await interaction.reply({
            embeds: [
              statusEmbed({
                title: "Welcome Config",
                description: "This command only works in a server.",
                tone: "warn",
              }),
            ],
            ephemeral: true,
          });
          return;
        }

        const isOwner = interaction.user.id === OWNER_ID;
        if (!isOwner) {
          await interaction.reply({
            embeds: [
              statusEmbed({
                title: "Permission Denied",
                description: "Only Snooty can change welcome settings 😌",
                tone: "error",
              }),
            ],
            ephemeral: true,
          });
          return;
        }

        const sub = interaction.options.getSubcommand();

        if (sub === "set") {
          const channel = interaction.options.getChannel("channel", true);
          if (!channel.isTextBased()) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Welcome Config",
                  description: "Please choose a text channel.",
                  tone: "warn",
                }),
              ],
              ephemeral: true,
            });
            return;
          }

          const messageArg = (interaction.options.getString("message") || "")
            .trim()
            .slice(0, 1800);

          if (!messageArg) {
            const token = `${Date.now().toString(36)}${Math.random()
              .toString(36)
              .slice(2, 10)}`;
            cleanupPending(pendingWelcomeSetModal);
            pendingWelcomeSetModal.set(token, {
              createdAt: Date.now(),
              userId: interaction.user.id,
              guildId: interaction.guildId,
              channelId: channel.id,
            });

            const modal = new ModalBuilder()
              .setCustomId(`welcome_set:${token}`)
              .setTitle("Set Welcome Message");

            const messageInput = new TextInputBuilder()
              .setCustomId("message")
              .setLabel("Welcome template ({user}, {guild}, \\n)")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
              .setMaxLength(1800)
              .setPlaceholder("Welcome {user} to {guild}!");

            modal.addComponents(new ActionRowBuilder().addComponents(messageInput));
            await interaction.showModal(modal);
            return;
          }

          await safeDefer(interaction, { ephemeral: true });

          upsertWelcomeConfig(
            interaction.guildId,
            channel.id,
            messageArg,
            interaction.user.id
          );

          const preview = formatWelcomeMessage(
            messageArg,
            interaction.guild?.name || "this server",
            interaction.user.id,
            WELCOME_MESSAGE
          );

          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Welcome Config Saved",
                description: `Channel: <#${channel.id}>\n\nPreview:\n${preview}`.slice(
                  0,
                  1900
                ),
                tone: "success",
              }),
            ],
          });
          return;
        }

        await safeDefer(interaction, { ephemeral: true });

        if (sub === "show") {
          const cfg = getWelcomeConfig(interaction.guildId);
          if (!cfg) {
            await interaction.editReply({
              embeds: [
                statusEmbed({
                  title: "Welcome Config",
                  description: [
                    "No DB welcome config set for this server.",
                    `Current fallback channel: ${
                      WELCOME_CHANNEL_ID ? `<#${WELCOME_CHANNEL_ID}>` : "(system channel)"
                    }`,
                    "Current fallback message:",
                    WELCOME_MESSAGE,
                  ].join("\n"),
                  tone: "info",
                }),
              ],
            });
            return;
          }

          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Welcome Config",
                description: [
                  `Channel: <#${cfg.channel_id}>`,
                  `Updated by: <@${cfg.updated_by}>`,
                  "Template:",
                  cfg.message,
                ].join("\n"),
                tone: "info",
              }),
            ],
          });
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
          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Welcome Preview",
                description: preview.slice(0, 1900),
                tone: "info",
              }),
            ],
          });
          return;
        }

        if (sub === "clear") {
          clearWelcomeConfig(interaction.guildId);
          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Welcome Config Cleared",
                description: "Falling back to `.env`.",
                tone: "success",
              }),
            ],
          });
          return;
        }

        await interaction.editReply("That subcommand isn’t wired up 😌");
        return;
      }

      if (interaction.commandName === "mode") {
        await safeDefer(interaction, { ephemeral: true });

        const isOwner = interaction.user.id === OWNER_ID;
        if (!isOwner) {
          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Permission Denied",
                description: "Only Snooty can change bot mode 😌",
                tone: "error",
              }),
            ],
          });
          return;
        }

        const sub = interaction.options.getSubcommand();

        if (sub === "show") {
          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Current Mode",
                description: `\`${getBotMode()}\``,
                tone: "info",
              }),
            ],
          });
          return;
        }

        if (sub === "set") {
          const mode = interaction.options.getString("name", true).toLowerCase();
          if (!MODE_PRESETS[mode]) {
            await interaction.editReply({
              embeds: [
                statusEmbed({
                  title: "Invalid Mode",
                  description:
                    "Use one of: sassy, chill, serious, hype, rude, ultraroast.",
                  tone: "warn",
                }),
              ],
            });
            return;
          }
          setBotMode(mode);
          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Mode Updated",
                description: `Now using \`${mode}\`.`,
                tone: "success",
              }),
            ],
          });
          return;
        }

        await interaction.editReply("That subcommand isn’t wired up 😌");
        return;
      }

      if (interaction.commandName === "schedule") {
        if (!interaction.guildId) {
          await interaction.reply({
            embeds: [
              statusEmbed({
                title: "Schedule",
                description: "This command only works in a server.",
                tone: "warn",
              }),
            ],
            ephemeral: true,
          });
          return;
        }

        const isOwner = interaction.user.id === OWNER_ID;
        if (!isOwner) {
          await interaction.reply({
            embeds: [
              statusEmbed({
                title: "Permission Denied",
                description: "Only Snooty can manage schedules 😌",
                tone: "error",
              }),
            ],
            ephemeral: true,
          });
          return;
        }

        const sub = interaction.options.getSubcommand();
        const now = Math.floor(Date.now() / 1000);

        if (sub === "addembed") {
          const channel = interaction.options.getChannel("channel", true);
          if (!channel.isTextBased()) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Schedule Embed",
                  description: "Pick a text channel.",
                  tone: "warn",
                }),
              ],
              ephemeral: true,
            });
            return;
          }

          const whenRaw = interaction.options.getString("when", true);
          const sendAt = parseScheduleTimeToUnixSeconds(whenRaw);
          if (!sendAt) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Invalid Time",
                  description:
                    "Use ISO UTC, unix, `dd/hh/mm` (like `01/02/30`), `hh/mm`, or token form like `1d2h30m`.",
                  tone: "warn",
                }),
              ],
              ephemeral: true,
            });
            return;
          }
          if (sendAt <= now + 5) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Invalid Time",
                  description: "`when` must be in the future.",
                  tone: "warn",
                }),
              ],
              ephemeral: true,
            });
            return;
          }

          let repeatMinutes = interaction.options.getInteger("repeat_minutes") || 0;
          if (repeatMinutes < 0) repeatMinutes = 0;
          if (repeatMinutes > 43200) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Invalid Repeat",
                  description: "`repeat_minutes` max is 43200 (30 days).",
                  tone: "warn",
                }),
              ],
              ephemeral: true,
            });
            return;
          }

          const token = `${Date.now().toString(36)}${Math.random()
            .toString(36)
            .slice(2, 10)}`;
          cleanupPending(pendingScheduleEmbedModal);
          pendingScheduleEmbedModal.set(token, {
            createdAt: Date.now(),
            userId: interaction.user.id,
            guildId: interaction.guildId,
            channelId: channel.id,
            sendAt,
            repeatMinutes,
          });

          const modal = new ModalBuilder()
            .setCustomId(`schedule_embed:${token}`)
            .setTitle("Schedule Embedded Message");

          const titleInput = new TextInputBuilder()
            .setCustomId("title")
            .setLabel("Embed Title (optional)")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(256);

          const descriptionInput = new TextInputBuilder()
            .setCustomId("description")
            .setLabel("Embed Description (required)")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(4000);

          const colorInput = new TextInputBuilder()
            .setCustomId("color")
            .setLabel("Color Hex (optional, e.g. #5865F2)")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setValue("#5865F2")
            .setMaxLength(7);

          const footerInput = new TextInputBuilder()
            .setCustomId("footer")
            .setLabel("Footer (optional)")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(2048);

          const mediaInput = new TextInputBuilder()
            .setCustomId("media_urls")
            .setLabel("Media URLs (optional)")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(1000);

          modal.addComponents(
            new ActionRowBuilder().addComponents(titleInput),
            new ActionRowBuilder().addComponents(descriptionInput),
            new ActionRowBuilder().addComponents(colorInput),
            new ActionRowBuilder().addComponents(footerInput),
            new ActionRowBuilder().addComponents(mediaInput)
          );

          await interaction.showModal(modal);
          return;
        }

        if (sub === "addtext") {
          const channel = interaction.options.getChannel("channel", true);
          if (!channel.isTextBased()) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Schedule Text",
                  description: "Pick a text channel.",
                  tone: "warn",
                }),
              ],
              ephemeral: true,
            });
            return;
          }

          const whenRaw = interaction.options.getString("when", true);
          const sendAt = parseScheduleTimeToUnixSeconds(whenRaw);
          if (!sendAt || sendAt <= now + 5) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Invalid Time",
                  description:
                    "Use a future time. Supported: ISO UTC, unix, `dd/hh/mm`, `hh/mm`, or `1d2h30m`.",
                  tone: "warn",
                }),
              ],
              ephemeral: true,
            });
            return;
          }

          let repeatMinutes = interaction.options.getInteger("repeat_minutes") || 0;
          if (repeatMinutes < 0) repeatMinutes = 0;
          if (repeatMinutes > 43200) {
            await interaction.reply({
              embeds: [
                statusEmbed({
                  title: "Invalid Repeat",
                  description: "`repeat_minutes` max is 43200 (30 days).",
                  tone: "warn",
                }),
              ],
              ephemeral: true,
            });
            return;
          }

          const contentArg = (interaction.options.getString("message") || "")
            .trim()
            .slice(0, 1800);
          const mediaArg = parseMediaUrlsInput(
            interaction.options.getString("media_urls") || ""
          ).slice(0, 10);

          if (!contentArg && mediaArg.length === 0) {
            const token = `${Date.now().toString(36)}${Math.random()
              .toString(36)
              .slice(2, 10)}`;
            cleanupPending(pendingScheduleTextModal);
            pendingScheduleTextModal.set(token, {
              createdAt: Date.now(),
              userId: interaction.user.id,
              guildId: interaction.guildId,
              channelId: channel.id,
              sendAt,
              repeatMinutes,
            });

            const modal = new ModalBuilder()
              .setCustomId(`schedule_text:${token}`)
              .setTitle("Schedule Text Message");

            const messageInput = new TextInputBuilder()
              .setCustomId("message")
              .setLabel("Message text (optional)")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(false)
              .setMaxLength(1800);

            const mediaInput = new TextInputBuilder()
              .setCustomId("media_urls")
              .setLabel("Media URLs (optional)")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(false)
              .setMaxLength(1000);

            modal.addComponents(
              new ActionRowBuilder().addComponents(messageInput),
              new ActionRowBuilder().addComponents(mediaInput)
            );
            await interaction.showModal(modal);
            return;
          }
        }

        await safeDefer(interaction, { ephemeral: true });

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

          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: `Scheduled #${result.lastInsertRowid}`,
                description: [
                  `Channel: <#${channel.id}>`,
                  `Next run: <t:${sendAt}:F>`,
                  `Repeat: ${
                    repeatMinutes > 0 ? `every ${repeatMinutes} minute(s)` : "one-time"
                  }`,
                  `Media items: ${mediaUrls.length}`,
                  `Debug time: ${scheduleTimeLabel(sendAt)}`,
                ].join("\n"),
                tone: "success",
              }),
            ],
          });
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

          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: `Scheduled #${result.lastInsertRowid}`,
                description: [
                  `Source: linked message`,
                  `Target: <#${targetChannel.id}>`,
                  `Next run: <t:${sendAt}:F>`,
                  `Repeat: ${
                    repeatMinutes > 0 ? `every ${repeatMinutes} minute(s)` : "one-time"
                  }`,
                  `Media items: ${mediaUrls.length}`,
                  `Debug time: ${scheduleTimeLabel(sendAt)}`,
                ].join("\n"),
                tone: "success",
              }),
            ],
          });
          return;
        }

        if (sub === "list") {
          const channel = interaction.options.getChannel("channel");
          const rows = channel
            ? db
                .prepare(
                  `SELECT id, channel_id, send_at, interval_minutes, payload_type, active, content, media_json, last_error
                   FROM scheduled_messages
                   WHERE guild_id = ? AND channel_id = ?
                   ORDER BY id DESC
                   LIMIT 30`
                )
                .all(interaction.guildId, channel.id)
            : db
                .prepare(
                  `SELECT id, channel_id, send_at, interval_minutes, payload_type, active, content, media_json, last_error
                   FROM scheduled_messages
                   WHERE guild_id = ?
                   ORDER BY id DESC
                   LIMIT 30`
                )
                .all(interaction.guildId);

          if (rows.length === 0) {
            await interaction.editReply({
              embeds: [
                statusEmbed({
                  title: "Schedules",
                  description: "No schedules found.",
                  tone: "info",
                }),
              ],
            });
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
            const kind = r.payload_type === "embed" ? "embed" : "text";
            return `#${r.id} | <#${r.channel_id}> | <t:${r.send_at}:R> | ${repeat} | ${status} | type:${kind} | media:${mediaCount} | "${preview}"${err}`;
          });

          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Schedules (latest 30)",
                description: lines.join("\n").slice(0, 3800),
                tone: "info",
              }),
            ],
          });
          return;
        }

        if (sub === "remove") {
          const id = interaction.options.getInteger("id", true);
          const result = db
            .prepare(`DELETE FROM scheduled_messages WHERE id = ? AND guild_id = ?`)
            .run(id, interaction.guildId);
          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: result.changes > 0 ? "Schedule Removed" : "Schedule Not Found",
                description: result.changes > 0 ? `#${id}` : `No schedule #${id} found.`,
                tone: result.changes > 0 ? "success" : "warn",
              }),
            ],
          });
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
          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: result.changes > 0 ? "Schedule Paused" : "Schedule Not Found",
                description: result.changes > 0 ? `#${id}` : `No schedule #${id} found.`,
                tone: result.changes > 0 ? "warn" : "warn",
              }),
            ],
          });
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
          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: result.changes > 0 ? "Schedule Resumed" : "Schedule Not Found",
                description: result.changes > 0 ? `#${id}` : `No schedule #${id} found.`,
                tone: result.changes > 0 ? "success" : "warn",
              }),
            ],
          });
          return;
        }

        await interaction.editReply("That subcommand isn’t wired up 😌");
        return;
      }

      if (interaction.commandName === "purge") {
        await safeDefer(interaction, { ephemeral: true });

        if (!interaction.guildId) {
          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Purge",
                description: "This command only works in a server.",
                tone: "warn",
              }),
            ],
          });
          return;
        }

        const isOwner = interaction.user.id === OWNER_ID;
        if (!isOwner) {
          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Permission Denied",
                description: "Only Snooty can run purge commands 😌",
                tone: "error",
              }),
            ],
          });
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
          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: `Purge Complete (${sub})`,
                description: [
                  `Channel: <#${channel.id}>`,
                  `Scanned: ${result.scanned}`,
                  `Matched: ${result.matched}`,
                  `Deleted: ${result.deleted}`,
                  `Skipped (older than 14 days): ${result.tooOld}`,
                ].join("\n"),
                tone: "success",
              }),
            ],
          });
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

          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Auto-Purge Set",
                description: [
                  `Channel: <#${channel.id}>`,
                  `Mode: ${mode}`,
                  `Interval: every ${every} ${unit}`,
                  `Scan limit per run: ${scanLimit}`,
                  `Next run: <t:${nextRun}:F>`,
                ].join("\n"),
                tone: "success",
              }),
            ],
          });
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
            await interaction.editReply({
              embeds: [
                statusEmbed({
                  title: "Auto-Purge Rules",
                  description: "No auto-purge rules found.",
                  tone: "info",
                }),
              ],
            });
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

          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Auto-Purge Rules",
                description: lines.join("\n").slice(0, 3800),
                tone: "info",
              }),
            ],
          });
          return;
        }

        if (sub === "autopurge_remove") {
          const id = interaction.options.getInteger("id", true);
          const result = db
            .prepare(`DELETE FROM auto_purge_rules WHERE id = ? AND guild_id = ?`)
            .run(id, interaction.guildId);

          await interaction.editReply({
            embeds: [
              statusEmbed({
                title:
                  result.changes > 0 ? "Auto-Purge Rule Removed" : "Rule Not Found",
                description:
                  result.changes > 0 ? `#${id}` : `No rule #${id} found.`,
                tone: result.changes > 0 ? "success" : "warn",
              }),
            ],
          });
          return;
        }

        if (sub === "msgttl_set") {
          const channel = interaction.options.getChannel("channel", true);
          if (!channel.isTextBased()) {
            await interaction.editReply("Target channel must be text-based.");
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

          const ttlSeconds = every * mult;
          if (ttlSeconds < 5) {
            await interaction.editReply("Minimum TTL is 5 seconds.");
            return;
          }
          if (ttlSeconds > 86400 * 30) {
            await interaction.editReply("Maximum TTL is 30 days.");
            return;
          }

          db.prepare(`
            INSERT INTO message_ttl_rules (
              guild_id, channel_id, ttl_seconds, active, created_by, created_at, updated_at
            )
            VALUES (?, ?, ?, 1, ?, strftime('%s','now'), strftime('%s','now'))
            ON CONFLICT(channel_id) DO UPDATE SET
              guild_id = excluded.guild_id,
              ttl_seconds = excluded.ttl_seconds,
              active = 1,
              updated_at = strftime('%s','now')
          `).run(interaction.guildId, channel.id, ttlSeconds, interaction.user.id);

          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Message TTL Rule Set",
                description: [
                  `Channel: <#${channel.id}>`,
                  `Each new message will be deleted after: ${every} ${unit}`,
                ].join("\n"),
                tone: "success",
              }),
            ],
          });
          return;
        }

        if (sub === "msgttl_list") {
          const rows = db
            .prepare(
              `SELECT id, channel_id, ttl_seconds, active
               FROM message_ttl_rules
               WHERE guild_id = ?
               ORDER BY id DESC
               LIMIT 30`
            )
            .all(interaction.guildId);

          if (rows.length === 0) {
            await interaction.editReply({
              embeds: [
                statusEmbed({
                  title: "Message TTL Rules",
                  description: "No per-message auto-delete rules found.",
                  tone: "info",
                }),
              ],
            });
            return;
          }

          const lines = rows.map((r) => {
            const secs = Math.max(1, Number(r.ttl_seconds || 0));
            let label = `${secs}s`;
            if (secs % 86400 === 0) label = `${secs / 86400}d`;
            else if (secs % 3600 === 0) label = `${secs / 3600}h`;
            else if (secs % 60 === 0) label = `${secs / 60}m`;
            return `#${r.id} | <#${r.channel_id}> | delete-after ${label} | ${r.active ? "active" : "inactive"}`;
          });

          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Message TTL Rules",
                description: lines.join("\n").slice(0, 3800),
                tone: "info",
              }),
            ],
          });
          return;
        }

        if (sub === "msgttl_remove") {
          const id = interaction.options.getInteger("id", true);
          const result = db
            .prepare(`DELETE FROM message_ttl_rules WHERE id = ? AND guild_id = ?`)
            .run(id, interaction.guildId);
          if (result.changes > 0) {
            db.prepare(
              `UPDATE message_ttl_queue
               SET active = 0, updated_at = strftime('%s','now')
               WHERE guild_id = ?
                 AND channel_id NOT IN (
                   SELECT channel_id FROM message_ttl_rules WHERE guild_id = ? AND active = 1
                 )`
            ).run(interaction.guildId, interaction.guildId);
          }

          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: result.changes > 0 ? "Message TTL Rule Removed" : "Rule Not Found",
                description: result.changes > 0 ? `#${id}` : `No rule #${id} found.`,
                tone: result.changes > 0 ? "success" : "warn",
              }),
            ],
          });
          return;
        }

        await interaction.editReply("That subcommand isn’t wired up 😌");
        return;
      }

      if (interaction.commandName === "preset") {
        if (!interaction.guildId) {
          await interaction.reply({
            embeds: [
              statusEmbed({
                title: "Preset Messages",
                description: "This command only works in a server.",
                tone: "warn",
              }),
            ],
            ephemeral: true,
          });
          return;
        }

        const isAdmin = Boolean(interaction.memberPermissions?.has("Administrator"));
        if (!isAdmin) {
          await interaction.reply({
            embeds: [
              statusEmbed({
                title: "Permission Denied",
                description: "Only admins can manage preset messages.",
                tone: "error",
              }),
            ],
            ephemeral: true,
          });
          return;
        }

        await safeDefer(interaction, { ephemeral: true });
        const sub = interaction.options.getSubcommand();

        if (sub === "add") {
          const titleRaw = interaction.options.getString("title", true);
          const content = interaction.options
            .getString("message", true)
            .trim()
            .slice(0, 1800);
          const title = normalizePresetTitle(titleRaw);
          const key = presetTitleKey(titleRaw);

          if (!title || !key) {
            await interaction.editReply({
              embeds: [
                statusEmbed({
                  title: "Invalid Title",
                  description: "Title cannot be empty.",
                  tone: "warn",
                }),
              ],
            });
            return;
          }
          if (!content) {
            await interaction.editReply({
              embeds: [
                statusEmbed({
                  title: "Invalid Message",
                  description: "Preset message cannot be empty.",
                  tone: "warn",
                }),
              ],
            });
            return;
          }

          const existing = db
            .prepare(
              `SELECT id
               FROM message_presets
               WHERE guild_id = ? AND title_key = ?`
            )
            .get(interaction.guildId, key);

          db.prepare(
            `INSERT INTO message_presets (
               guild_id, title, title_key, content, created_by, created_at, updated_at
             )
             VALUES (?, ?, ?, ?, ?, strftime('%s','now'), strftime('%s','now'))
             ON CONFLICT(guild_id, title_key) DO UPDATE SET
               title = excluded.title,
               content = excluded.content,
               updated_at = strftime('%s','now')`
          ).run(interaction.guildId, title, key, content, interaction.user.id);

          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: existing ? "Preset Updated" : "Preset Added",
                description: `**${title}** is ready to use with \`/preset send\`.`,
                tone: "success",
              }),
            ],
          });
          return;
        }

        if (sub === "send") {
          const titleRaw = interaction.options.getString("title", true);
          const key = presetTitleKey(titleRaw);
          const preset = db
            .prepare(
              `SELECT title, content
               FROM message_presets
               WHERE guild_id = ? AND title_key = ?`
            )
            .get(interaction.guildId, key);

          if (!preset) {
            await interaction.editReply({
              embeds: [
                statusEmbed({
                  title: "Preset Not Found",
                  description: `No preset found for \`${normalizePresetTitle(titleRaw)}\`.`,
                  tone: "warn",
                }),
              ],
            });
            return;
          }

          const channel = interaction.options.getChannel("channel") || interaction.channel;
          if (!channel?.isTextBased() || typeof channel.send !== "function") {
            await interaction.editReply({
              embeds: [
                statusEmbed({
                  title: "Invalid Channel",
                  description: "Pick a text channel.",
                  tone: "warn",
                }),
              ],
            });
            return;
          }

          await channel.send({ content: String(preset.content || "").slice(0, 1800) });
          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Preset Sent",
                description: `Sent **${preset.title}** in <#${channel.id}>.`,
                tone: "success",
              }),
            ],
          });
          return;
        }

        if (sub === "list") {
          const rows = db
            .prepare(
              `SELECT title
               FROM message_presets
               WHERE guild_id = ?
               ORDER BY updated_at DESC
               LIMIT 50`
            )
            .all(interaction.guildId);

          if (rows.length === 0) {
            await interaction.editReply({
              embeds: [
                statusEmbed({
                  title: "Preset Messages",
                  description: "No presets saved yet. Use `/preset add`.",
                  tone: "info",
                }),
              ],
            });
            return;
          }

          const lines = rows.map((r, i) => `${i + 1}. ${String(r.title || "")}`);
          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: `Preset Messages (${rows.length})`,
                description: lines.join("\n").slice(0, 3900),
                tone: "info",
              }),
            ],
          });
          return;
        }

        if (sub === "remove") {
          const titleRaw = interaction.options.getString("title", true);
          const key = presetTitleKey(titleRaw);
          const result = db
            .prepare(
              `DELETE FROM message_presets
               WHERE guild_id = ? AND title_key = ?`
            )
            .run(interaction.guildId, key);

          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: result.changes > 0 ? "Preset Removed" : "Preset Not Found",
                description:
                  result.changes > 0
                    ? `Removed \`${normalizePresetTitle(titleRaw)}\`.`
                    : `No preset found for \`${normalizePresetTitle(titleRaw)}\`.`,
                tone: result.changes > 0 ? "success" : "warn",
              }),
            ],
          });
          return;
        }

        await interaction.editReply("That subcommand isn’t wired up 😌");
        return;
      }

      if (interaction.commandName === "nsfwguard") {
        if (!interaction.guildId) {
          await interaction.reply({
            embeds: [
              statusEmbed({
                title: "NSFW Guard",
                description: "This command only works in a server.",
                tone: "warn",
              }),
            ],
            ephemeral: true,
          });
          return;
        }

        const isAdmin = Boolean(interaction.memberPermissions?.has("Administrator"));
        if (!isAdmin) {
          await interaction.reply({
            embeds: [
              statusEmbed({
                title: "Permission Denied",
                description: "Only admins can manage NSFW guard channels.",
                tone: "error",
              }),
            ],
            ephemeral: true,
          });
          return;
        }

        await safeDefer(interaction, { ephemeral: true });
        const sub = interaction.options.getSubcommand();

        if (sub === "set") {
          const channel = interaction.options.getChannel("channel", true);
          if (!channel.isTextBased()) {
            await interaction.editReply({
              embeds: [
                statusEmbed({
                  title: "Invalid Channel",
                  description: "Pick a text channel.",
                  tone: "warn",
                }),
              ],
            });
            return;
          }

          db.prepare(`
            INSERT INTO nsfw_media_guard_rules (
              guild_id, channel_id, mode, active, created_by, created_at, updated_at
            )
            VALUES (?, ?, 'adult_only', 1, ?, strftime('%s','now'), strftime('%s','now'))
            ON CONFLICT(channel_id) DO UPDATE SET
              guild_id = excluded.guild_id,
              mode = excluded.mode,
              active = 1,
              updated_at = strftime('%s','now')
          `).run(interaction.guildId, channel.id, interaction.user.id);

          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "NSFW Guard Enabled",
                description:
                  `Adult/NSFW image auto-delete is now active in <#${channel.id}>.\n` +
                  "Note: this guard checks image content and only removes flagged adult media from non-admin users.",
                tone: "success",
              }),
            ],
          });
          return;
        }

        if (sub === "list") {
          const rows = db
            .prepare(
              `SELECT id, channel_id, mode, active
               FROM nsfw_media_guard_rules
               WHERE guild_id = ?
               ORDER BY id DESC
               LIMIT 30`
            )
            .all(interaction.guildId);

          if (rows.length === 0) {
            await interaction.editReply({
              embeds: [
                statusEmbed({
                  title: "NSFW Guard",
                  description: "No guarded channels configured.",
                  tone: "info",
                }),
              ],
            });
            return;
          }

          const lines = rows.map(
            (r) =>
              `#${r.id} | <#${r.channel_id}> | mode:${r.mode || "adult_only"} | ${r.active ? "active" : "inactive"}`
          );
          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "NSFW Guard Channels",
                description: lines.join("\n"),
                tone: "info",
              }),
            ],
          });
          return;
        }

        if (sub === "remove") {
          const channel = interaction.options.getChannel("channel", true);
          const result = db
            .prepare(
              `DELETE FROM nsfw_media_guard_rules
               WHERE guild_id = ? AND channel_id = ?`
            )
            .run(interaction.guildId, channel.id);

          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: result.changes > 0 ? "NSFW Guard Disabled" : "No Guard Found",
                description:
                  result.changes > 0
                    ? `Removed guard from <#${channel.id}>.`
                    : `No guard configured for <#${channel.id}>.`,
                tone: result.changes > 0 ? "success" : "warn",
              }),
            ],
          });
          return;
        }

        await interaction.editReply("That subcommand isn’t wired up 😌");
        return;
      }

      if (interaction.commandName === "reminder") {
        if (!interaction.guildId) {
          await interaction.reply({
            embeds: [
              statusEmbed({
                title: "Reminder",
                description: "This command only works in a server.",
                tone: "warn",
              }),
            ],
            ephemeral: true,
          });
          return;
        }

        await safeDefer(interaction, { ephemeral: true });
        const sub = interaction.options.getSubcommand();
        const now = Math.floor(Date.now() / 1000);

        if (sub === "add") {
          const whenRaw = interaction.options.getString("when", true);
          const sendAt = parseScheduleTimeToUnixSeconds(whenRaw);
          if (!sendAt || sendAt <= now + 2) {
            await interaction.editReply({
              embeds: [
                statusEmbed({
                  title: "Invalid Time",
                  description:
                    "Use a future time: ISO UTC, unix, `dd/hh/mm`, `hh/mm`, or token form like `1d2h30m`.",
                  tone: "warn",
                }),
              ],
            });
            return;
          }

          const message = interaction.options
            .getString("message", true)
            .trim()
            .slice(0, 1800);
          if (!message) {
            await interaction.editReply({
              embeds: [
                statusEmbed({
                  title: "Invalid Message",
                  description: "Reminder message cannot be empty.",
                  tone: "warn",
                }),
              ],
            });
            return;
          }

          let intervalSeconds = 0;
          const every = interaction.options.getInteger("every");
          if (Number.isInteger(every) && every > 0) {
            const unit = (interaction.options.getString("unit") || "minutes").toLowerCase();
            const unitMap = {
              seconds: 1,
              minutes: 60,
              hours: 3600,
              days: 86400,
            };
            const mult = unitMap[unit] || 60;
            intervalSeconds = every * mult;
          }

          if (intervalSeconds > 0 && intervalSeconds < 5) {
            await interaction.editReply({
              embeds: [
                statusEmbed({
                  title: "Invalid Repeat",
                  description: "Minimum repeat interval is 5 seconds.",
                  tone: "warn",
                }),
              ],
            });
            return;
          }
          if (intervalSeconds > 86400 * 30) {
            await interaction.editReply({
              embeds: [
                statusEmbed({
                  title: "Invalid Repeat",
                  description: "Maximum repeat interval is 30 days.",
                  tone: "warn",
                }),
              ],
            });
            return;
          }

          const result = db
            .prepare(
              `INSERT INTO user_reminders (
                 user_id, guild_id, message, send_at, interval_seconds, active, last_error, created_at, updated_at
               )
               VALUES (?, ?, ?, ?, ?, 1, '', strftime('%s','now'), strftime('%s','now'))`
            )
            .run(
              interaction.user.id,
              interaction.guildId,
              message,
              sendAt,
              intervalSeconds
            );

          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: `Reminder Created (#${result.lastInsertRowid})`,
                description: [
                  `When: <t:${sendAt}:F>`,
                  `Repeat: ${formatIntervalLabel(intervalSeconds)}`,
                  "Delivery: DM",
                ].join("\n"),
                tone: "success",
              }),
            ],
          });
          return;
        }

        if (sub === "addlocal") {
          const tzRow = db
            .prepare(`SELECT tz, city_label FROM user_timezones WHERE user_id = ?`)
            .get(interaction.user.id);
          if (!tzRow?.tz) {
            await interaction.editReply({
              embeds: [
                statusEmbed({
                  title: "Timezone Required",
                  description:
                    "Set your city/timezone first with `/timezone set city:<city>`.",
                  tone: "warn",
                }),
              ],
            });
            return;
          }

          const timeRaw = interaction.options.getString("time", true);
          const sendAt = parseLocalHHMMToNextUnixSeconds(timeRaw, tzRow.tz);
          if (!sendAt || sendAt <= now + 2) {
            await interaction.editReply({
              embeds: [
                statusEmbed({
                  title: "Invalid Local Time",
                  description:
                    "Use `HH:mm` in 24-hour format, like `09:30` or `18:45`.",
                  tone: "warn",
                }),
              ],
            });
            return;
          }

          const message = interaction.options
            .getString("message", true)
            .trim()
            .slice(0, 1800);
          if (!message) {
            await interaction.editReply({
              embeds: [
                statusEmbed({
                  title: "Invalid Message",
                  description: "Reminder message cannot be empty.",
                  tone: "warn",
                }),
              ],
            });
            return;
          }

          let intervalSeconds = 0;
          const every = interaction.options.getInteger("every");
          if (Number.isInteger(every) && every > 0) {
            const unit = (interaction.options.getString("unit") || "days").toLowerCase();
            const unitMap = {
              seconds: 1,
              minutes: 60,
              hours: 3600,
              days: 86400,
            };
            intervalSeconds = every * (unitMap[unit] || 86400);
          }
          if (intervalSeconds > 0 && intervalSeconds < 5) {
            await interaction.editReply({
              embeds: [
                statusEmbed({
                  title: "Invalid Repeat",
                  description: "Minimum repeat interval is 5 seconds.",
                  tone: "warn",
                }),
              ],
            });
            return;
          }
          if (intervalSeconds > 86400 * 30) {
            await interaction.editReply({
              embeds: [
                statusEmbed({
                  title: "Invalid Repeat",
                  description: "Maximum repeat interval is 30 days.",
                  tone: "warn",
                }),
              ],
            });
            return;
          }

          const result = db
            .prepare(
              `INSERT INTO user_reminders (
                 user_id, guild_id, message, send_at, interval_seconds, active, last_error, created_at, updated_at
               )
               VALUES (?, ?, ?, ?, ?, 1, '', strftime('%s','now'), strftime('%s','now'))`
            )
            .run(
              interaction.user.id,
              interaction.guildId,
              message,
              sendAt,
              intervalSeconds
            );

          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: `Reminder Created (#${result.lastInsertRowid})`,
                description: [
                  `Timezone: ${tzRow.city_label || tzRow.tz} (${tzRow.tz})`,
                  `Local time: ${timeRaw}`,
                  `When: <t:${sendAt}:F>`,
                  `Repeat: ${formatIntervalLabel(intervalSeconds)}`,
                  "Delivery: DM",
                ].join("\n"),
                tone: "success",
              }),
            ],
          });
          return;
        }

        if (sub === "list") {
          const rows = db
            .prepare(
              `SELECT id, message, send_at, interval_seconds, active, last_error
               FROM user_reminders
               WHERE guild_id = ? AND user_id = ?
               ORDER BY id DESC
               LIMIT 30`
            )
            .all(interaction.guildId, interaction.user.id);

          if (rows.length === 0) {
            await interaction.editReply({
              embeds: [
                statusEmbed({
                  title: "Your Reminders",
                  description: "No reminders found. Use `/reminder add`.",
                  tone: "info",
                }),
              ],
            });
            return;
          }

          const lines = rows.map((r) => {
            const msg = String(r.message || "").replace(/\s+/g, " ").slice(0, 60);
            const err = r.last_error ? ` | err: ${String(r.last_error).slice(0, 36)}` : "";
            return `#${r.id} | <t:${r.send_at}:R> | ${formatIntervalLabel(
              r.interval_seconds
            )} | ${r.active ? "active" : "done/paused"} | "${msg}"${err}`;
          });

          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Your Reminders (latest 30)",
                description: lines.join("\n").slice(0, 3800),
                tone: "info",
              }),
            ],
          });
          return;
        }

        if (sub === "remove") {
          const id = interaction.options.getInteger("id", true);
          const result = db
            .prepare(
              `DELETE FROM user_reminders
               WHERE id = ? AND guild_id = ? AND user_id = ?`
            )
            .run(id, interaction.guildId, interaction.user.id);

          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: result.changes > 0 ? "Reminder Removed" : "Reminder Not Found",
                description:
                  result.changes > 0
                    ? `Removed #${id}.`
                    : `No reminder #${id} found for you.`,
                tone: result.changes > 0 ? "success" : "warn",
              }),
            ],
          });
          return;
        }

        await interaction.editReply("That subcommand isn’t wired up 😌");
        return;
      }

      if (interaction.commandName === "timezone") {
        await safeDefer(interaction, { ephemeral: true });
        const sub = interaction.options.getSubcommand();

        if (sub === "set") {
          const cityRaw = interaction.options.getString("city", true).trim();
          const tz = resolveTimeZoneInput(cityRaw);
          if (!tz) {
            await interaction.editReply({
              embeds: [
                statusEmbed({
                  title: "Timezone Not Found",
                  description:
                    "Use a known city (like `Singapore`) or IANA timezone (`Asia/Singapore`).",
                  tone: "warn",
                }),
              ],
            });
            return;
          }

          db.prepare(
            `INSERT INTO user_timezones (user_id, tz, city_label, updated_at)
             VALUES (?, ?, ?, strftime('%s','now'))
             ON CONFLICT(user_id) DO UPDATE SET
               tz = excluded.tz,
               city_label = excluded.city_label,
               updated_at = strftime('%s','now')`
          ).run(interaction.user.id, tz, cityRaw.slice(0, 120));

          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Timezone Saved",
                description: `Saved as **${cityRaw}** -> \`${tz}\`.`,
                tone: "success",
              }),
            ],
          });
          return;
        }

        if (sub === "show") {
          const row = db
            .prepare(`SELECT tz, city_label FROM user_timezones WHERE user_id = ?`)
            .get(interaction.user.id);
          if (!row) {
            await interaction.editReply({
              embeds: [
                statusEmbed({
                  title: "Timezone",
                  description: "No timezone set. Use `/timezone set city:<city>`.",
                  tone: "info",
                }),
              ],
            });
            return;
          }
          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Your Timezone",
                description: `${row.city_label || row.tz} (\`${row.tz}\`)`,
                tone: "info",
              }),
            ],
          });
          return;
        }

        if (sub === "clear") {
          db.prepare(`DELETE FROM user_timezones WHERE user_id = ?`).run(interaction.user.id);
          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Timezone Cleared",
                description: "Your saved timezone has been removed.",
                tone: "success",
              }),
            ],
          });
          return;
        }

        await interaction.editReply("That subcommand isn’t wired up 😌");
        return;
      }

      if (interaction.commandName === "profile") {
        const sub = interaction.options.getSubcommand();
        const isOwner = interaction.user.id === OWNER_ID;

        if (sub === "set") {
          const noteArg = (interaction.options.getString("note") || "")
            .trim()
            .slice(0, 1200);
          if (!noteArg) {
            const token = `${Date.now().toString(36)}${Math.random()
              .toString(36)
              .slice(2, 10)}`;
            cleanupPending(pendingProfileSetModal);
            pendingProfileSetModal.set(token, {
              createdAt: Date.now(),
              userId: interaction.user.id,
              guildId: interaction.guildId || "",
            });

            const modal = new ModalBuilder()
              .setCustomId(`profile_set:${token}`)
              .setTitle("Set Profile Note");
            const noteInput = new TextInputBuilder()
              .setCustomId("note")
              .setLabel("Profile note")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
              .setMaxLength(1200);
            modal.addComponents(new ActionRowBuilder().addComponents(noteInput));
            await interaction.showModal(modal);
            return;
          }
        }

        if (sub === "setfor") {
          if (!isOwner) {
            await interaction.reply({
              content: "Only Snooty can set profiles for others 😌",
              ephemeral: true,
            });
            return;
          }
          const user = interaction.options.getUser("user", true);
          const noteArg = (interaction.options.getString("note") || "")
            .trim()
            .slice(0, 1200);
          if (!noteArg) {
            const token = `${Date.now().toString(36)}${Math.random()
              .toString(36)
              .slice(2, 10)}`;
            cleanupPending(pendingProfileSetForModal);
            pendingProfileSetForModal.set(token, {
              createdAt: Date.now(),
              userId: interaction.user.id,
              guildId: interaction.guildId || "",
              targetUserId: user.id,
            });
            const modal = new ModalBuilder()
              .setCustomId(`profile_setfor:${token}`)
              .setTitle(`Set Profile: ${user.username}`);
            const noteInput = new TextInputBuilder()
              .setCustomId("note")
              .setLabel("Profile note")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
              .setMaxLength(1200);
            modal.addComponents(new ActionRowBuilder().addComponents(noteInput));
            await interaction.showModal(modal);
            return;
          }
        }

        await safeDefer(interaction, { ephemeral: true });

        if (sub === "set") {
          const note = interaction.options
            .getString("note")
            .trim()
            .slice(0, 1200);

          upsertProfile(interaction.user.id, note);

          const vibe = await generateVibeSummary(note);

          setVibe(interaction.user.id, vibe);

          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Profile Saved",
                description: "I’ll remember that.",
                tone: "success",
              }),
            ],
          });
          return;
        }

        if (sub === "show") {
          const row = getProfile(interaction.user.id);
          if (!row) {
            await interaction.editReply({
              embeds: [
                statusEmbed({
                  title: "Profile",
                  description: "You don’t have a profile yet. Use `/profile set`.",
                  tone: "info",
                }),
              ],
            });
            return;
          }
          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Your Profile",
                description: `Profile note:\n${row.notes}\n\nVibe summary:\n${
                  row.vibe_summary || "(none)"
                }`.slice(0, 3800),
                tone: "info",
              }),
            ],
          });
          return;
        }

        if (sub === "clear") {
          clearProfile(interaction.user.id);
          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Profile Deleted",
                description: "Your profile has been removed.",
                tone: "success",
              }),
            ],
          });
          return;
        }

        if (sub === "peek") {
          if (!isOwner) {
            await interaction.editReply("Only Snooty can peek 😌");
            return;
          }
          const user = interaction.options.getUser("user", true);
          const row = getProfile(user.id);
          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: `Profile: ${user.username}`,
                description: row
                  ? `Profile note:\n${row.notes}\n\nVibe:\n${row.vibe_summary || "(none)"}`
                  : `No profile stored for ${user.username}.`,
                tone: "info",
              }),
            ],
          });
          return;
        }

        if (sub === "setfor") {
          if (!isOwner) {
            await interaction.editReply("Only Snooty can set profiles for others 😌");
            return;
          }
          const user = interaction.options.getUser("user", true);
          const note = interaction.options
            .getString("note")
            .trim()
            .slice(0, 1200);

          upsertProfile(user.id, note);

          const vibe = await generateVibeSummary(note);

          setVibe(user.id, vibe);

          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Profile Saved",
                description: `Saved for ${user.username}.`,
                tone: "success",
              }),
            ],
          });
          return;
        }

        if (sub === "clearfor") {
          if (!isOwner) {
            await interaction.editReply("Only Snooty can clear profiles for others 😌");
            return;
          }
          const user = interaction.options.getUser("user", true);
          clearProfile(user.id);
          await interaction.editReply({
            embeds: [
              statusEmbed({
                title: "Profile Deleted",
                description: `Deleted for ${user.username}.`,
                tone: "success",
              }),
            ],
          });
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
