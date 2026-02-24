const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, 'db');
fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(path.join(DB_DIR, 'clud.db'));

// WAL mode for better concurrent reads
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    username TEXT,
    display_name TEXT,
    first_seen TEXT DEFAULT (datetime('now')),
    last_seen TEXT DEFAULT (datetime('now')),
    interaction_count INTEGER DEFAULT 0,
    topics TEXT DEFAULT '[]',
    mood TEXT DEFAULT 'neutral',
    notes TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS interactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    tweet_id TEXT UNIQUE,
    user_text TEXT,
    clud_reply TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(user_id)
  );

  CREATE TABLE IF NOT EXISTS thoughts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thought TEXT,
    source TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS stats (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Prepared statements
const upsertUser = db.prepare(`
  INSERT INTO users (user_id, username, display_name, last_seen, interaction_count)
  VALUES (?, ?, ?, datetime('now'), 1)
  ON CONFLICT(user_id) DO UPDATE SET
    username = excluded.username,
    display_name = excluded.display_name,
    last_seen = datetime('now'),
    interaction_count = interaction_count + 1
`);

const getUser = db.prepare('SELECT * FROM users WHERE user_id = ?');
const getUserByName = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE');

const addInteraction = db.prepare(`
  INSERT OR IGNORE INTO interactions (user_id, tweet_id, user_text, clud_reply)
  VALUES (?, ?, ?, ?)
`);

const getRecentInteractions = db.prepare(`
  SELECT * FROM interactions WHERE user_id = ?
  ORDER BY created_at DESC LIMIT ?
`);

const addThought = db.prepare(`
  INSERT INTO thoughts (thought, source) VALUES (?, ?)
`);

const getRecentThoughts = db.prepare(`
  SELECT * FROM thoughts ORDER BY created_at DESC LIMIT ?
`);

const getTotalUsers = db.prepare('SELECT COUNT(*) as count FROM users');
const getTotalInteractions = db.prepare('SELECT COUNT(*) as count FROM interactions');

const updateUserTopics = db.prepare(`
  UPDATE users SET topics = ? WHERE user_id = ?
`);

const setStat = db.prepare(`
  INSERT INTO stats (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);

const getStat = db.prepare('SELECT value FROM stats WHERE key = ?');

module.exports = {
  db,
  upsertUser,
  getUser,
  getUserByName,
  addInteraction,
  getRecentInteractions,
  addThought,
  getRecentThoughts,
  getTotalUsers,
  getTotalInteractions,
  updateUserTopics,
  setStat,
  getStat,
};
