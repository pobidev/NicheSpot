import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

const dbPath = process.env.DB_PATH || './data/nichospot.db';
const dir = dirname(dbPath);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    lastfm_username TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS friendships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    friend_id INTEGER NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted')),
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, friend_id)
  );

  CREATE TABLE IF NOT EXISTS albums (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'musicbrainz',
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    year TEXT,
    cover_url TEXT,
    cached_at TEXT DEFAULT (datetime('now')),
    UNIQUE(external_id, source)
  );

  CREATE TABLE IF NOT EXISTS user_albums (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    album_id INTEGER NOT NULL REFERENCES albums(id),
    status TEXT NOT NULL DEFAULT 'to_listen' CHECK(status IN ('to_listen','listened')),
    rating INTEGER CHECK(rating BETWEEN 1 AND 10),
    note TEXT,
    recommended_by_user_id INTEGER REFERENCES users(id),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, album_id)
  );
`);

// Clean any potential duplicate entries across sources for the same user and album title + artist
try {
  db.exec(`
    DELETE FROM user_albums WHERE id IN (
      SELECT ua1.id
      FROM user_albums ua1
      JOIN albums a1 ON a1.id = ua1.album_id
      JOIN user_albums ua2 ON ua2.user_id = ua1.user_id AND ua2.id > ua1.id
      JOIN albums a2 ON a2.id = ua2.album_id
      WHERE LOWER(TRIM(a1.title)) = LOWER(TRIM(a2.title))
        AND LOWER(TRIM(a1.artist)) = LOWER(TRIM(a2.artist))
    );
  `);
} catch (cleanupErr) {
  console.warn('Initial cleanup notice:', cleanupErr.message);
}

export default db;
