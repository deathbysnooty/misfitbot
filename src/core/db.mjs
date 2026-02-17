import Database from "better-sqlite3";

export function createDb({ dbPath, defaultBotMode }) {
  const db = new Database(dbPath);

  function ensureColumn(table, column, ddl) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    const exists = cols.some((c) => c.name === column);
    if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_memory (
      user_id TEXT PRIMARY KEY,
      notes TEXT NOT NULL DEFAULT ''
    );
  `);

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

  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      media_json TEXT NOT NULL DEFAULT '[]',
      payload_type TEXT NOT NULL DEFAULT 'text',
      embed_json TEXT NOT NULL DEFAULT '',
      send_at INTEGER NOT NULL,
      interval_minutes INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      last_error TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_scheduled_messages_due
    ON scheduled_messages (active, send_at);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS message_presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      title TEXT NOT NULL,
      title_key TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(guild_id, title_key)
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_message_presets_lookup
    ON message_presets (guild_id, title_key);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      send_at INTEGER NOT NULL,
      interval_seconds INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      last_error TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_user_reminders_due
    ON user_reminders (active, send_at);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_timezones (
      user_id TEXT PRIMARY KEY,
      tz TEXT NOT NULL,
      city_label TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS nsfw_media_guard_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL UNIQUE,
      active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_nsfw_media_guard_rules_lookup
    ON nsfw_media_guard_rules (guild_id, channel_id, active);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS auto_purge_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL UNIQUE,
      mode TEXT NOT NULL DEFAULT 'all',
      interval_minutes INTEGER NOT NULL,
      scan_limit INTEGER NOT NULL DEFAULT 200,
      next_run_at INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      last_error TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS mbti_sessions (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      current_index INTEGER NOT NULL DEFAULT 0,
      score_ei INTEGER NOT NULL DEFAULT 0,
      score_sn INTEGER NOT NULL DEFAULT 0,
      score_tf INTEGER NOT NULL DEFAULT 0,
      score_jp INTEGER NOT NULL DEFAULT 0,
      answers_json TEXT NOT NULL DEFAULT '[]',
      active INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      PRIMARY KEY (guild_id, user_id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS mbti_results (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      mbti_type TEXT NOT NULL,
      score_ei INTEGER NOT NULL DEFAULT 0,
      score_sn INTEGER NOT NULL DEFAULT 0,
      score_tf INTEGER NOT NULL DEFAULT 0,
      score_jp INTEGER NOT NULL DEFAULT 0,
      completed_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      PRIMARY KEY (guild_id, user_id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS quiz_scores (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      points INTEGER NOT NULL DEFAULT 0,
      correct_answers INTEGER NOT NULL DEFAULT 0,
      total_attempts INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      PRIMARY KEY (guild_id, user_id)
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_quiz_scores_guild_points
    ON quiz_scores (guild_id, points DESC, correct_answers DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS quiz_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      genre TEXT NOT NULL,
      difficulty TEXT NOT NULL,
      question TEXT NOT NULL,
      question_key TEXT NOT NULL,
      options_json TEXT NOT NULL,
      correct_index INTEGER NOT NULL,
      explanation TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(genre, difficulty, question_key)
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_quiz_questions_lookup
    ON quiz_questions (genre, difficulty, id);
  `);

  ensureColumn(
    "auto_purge_rules",
    "interval_seconds",
    "interval_seconds INTEGER NOT NULL DEFAULT 0"
  );
  ensureColumn(
    "scheduled_messages",
    "payload_type",
    "payload_type TEXT NOT NULL DEFAULT 'text'"
  );
  ensureColumn(
    "scheduled_messages",
    "embed_json",
    "embed_json TEXT NOT NULL DEFAULT ''"
  );
  ensureColumn(
    "mbti_sessions",
    "answers_json",
    "answers_json TEXT NOT NULL DEFAULT '[]'"
  );
  ensureColumn(
    "nsfw_media_guard_rules",
    "mode",
    "mode TEXT NOT NULL DEFAULT 'adult_only'"
  );

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_auto_purge_due
    ON auto_purge_rules (active, next_run_at);
  `);

  db.prepare(`
    INSERT INTO bot_config (key, value, updated_at)
    VALUES ('mode', ?, strftime('%s','now'))
    ON CONFLICT(key) DO NOTHING
  `).run(defaultBotMode);

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

  function getBotMode(modePresets) {
    const row = db.prepare(`SELECT value FROM bot_config WHERE key = 'mode'`).get();
    const mode = String(row?.value || defaultBotMode).toLowerCase();
    return modePresets[mode] ? mode : defaultBotMode;
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

  function getUserMemory(userId) {
    return (
      db.prepare(`SELECT notes FROM user_memory WHERE user_id = ?`).get(userId)
        ?.notes || ""
    );
  }

  function setUserMemory(userId, notes) {
    db.prepare(`
      INSERT INTO user_memory (user_id, notes)
      VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET notes = excluded.notes
    `).run(userId, notes);
  }

  function clearUserMemory(userId) {
    db.prepare(`DELETE FROM user_memory WHERE user_id = ?`).run(userId);
  }

  return {
    db,
    getProfile,
    upsertProfile,
    setVibe,
    clearProfile,
    getWelcomeConfig,
    upsertWelcomeConfig,
    clearWelcomeConfig,
    getBotMode,
    setBotMode,
    getUserMemory,
    setUserMemory,
    clearUserMemory,
  };
}
