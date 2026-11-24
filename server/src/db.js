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

export const MAX_FAVORITE_ALBUMS = 10;
export const MAX_FAVORITE_TRACKS = 10;

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    lastfm_username TEXT,
    lastfm_last_sync_uts INTEGER DEFAULT 0,
    lastfm_synced_user TEXT,
    avatar_url TEXT,
    favorite_albums TEXT DEFAULT '[]',
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
    status TEXT NOT NULL DEFAULT 'to_listen' CHECK(status IN ('to_listen','partially_listened','listened')),
    rating INTEGER CHECK(rating IS NULL OR (rating BETWEEN 1 AND 10)),
    note TEXT,
    recommended_by_user_id INTEGER REFERENCES users(id),
    pending_recommendation INTEGER NOT NULL DEFAULT 0 CHECK(pending_recommendation IN (0, 1)),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, album_id)
  );

  CREATE TABLE IF NOT EXISTS user_album_tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_album_id INTEGER NOT NULL REFERENCES user_albums(id) ON DELETE CASCADE,
    track_title TEXT NOT NULL,
    track_number INTEGER,
    listened INTEGER NOT NULL DEFAULT 1 CHECK(listened IN (0, 1)),
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_album_id, track_title)
  );

  CREATE TABLE IF NOT EXISTS favorite_tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 10),
    track_title TEXT NOT NULL,
    artist_name TEXT NOT NULL,
    album_title TEXT,
    cover_url TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, position)
  );

  CREATE INDEX IF NOT EXISTS idx_favorite_tracks_user
  ON favorite_tracks(user_id, position);

  CREATE TABLE IF NOT EXISTS recommendation_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recommender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    listener_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    rating INTEGER,
    note TEXT,
    seen INTEGER NOT NULL DEFAULT 0 CHECK(seen IN (0, 1)),
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS user_lastfm_tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    artist_norm TEXT NOT NULL,
    album_norm TEXT NOT NULL,
    track_norm TEXT NOT NULL,
    track_title TEXT NOT NULL,
    play_count INTEGER NOT NULL DEFAULT 1,
    last_played_uts INTEGER DEFAULT 0,
    UNIQUE(user_id, artist_norm, album_norm, track_norm)
  );

  CREATE INDEX IF NOT EXISTS idx_user_lastfm_tracks_lookup
  ON user_lastfm_tracks(user_id, artist_norm, album_norm);

  CREATE TABLE IF NOT EXISTS album_tracklists_cache (
    artist_norm TEXT NOT NULL,
    album_norm TEXT NOT NULL,
    tracks_json TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (artist_norm, album_norm)
  );
`);

// Safe migration if user_albums already existed with old CHECK constraint on status
try {
  const tableSql = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='user_albums'")
    .get()?.sql || '';

  if (tableSql && !tableSql.includes('partially_listened')) {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      BEGIN TRANSACTION;
      CREATE TABLE user_albums_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        album_id INTEGER NOT NULL REFERENCES albums(id),
        status TEXT NOT NULL DEFAULT 'to_listen' CHECK(status IN ('to_listen','partially_listened','listened')),
        rating INTEGER CHECK(rating IS NULL OR (rating BETWEEN 1 AND 10)),
        note TEXT,
        recommended_by_user_id INTEGER REFERENCES users(id),
        pending_recommendation INTEGER NOT NULL DEFAULT 0 CHECK(pending_recommendation IN (0, 1)),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, album_id)
      );
      INSERT INTO user_albums_new (id, user_id, album_id, status, rating, note, recommended_by_user_id, updated_at)
      SELECT id, user_id, album_id, status, rating, note, recommended_by_user_id, updated_at
      FROM user_albums;
      DROP TABLE user_albums;
      ALTER TABLE user_albums_new RENAME TO user_albums;
      COMMIT;
    `);
    db.pragma('foreign_keys = ON');
  }
} catch (migErr) {
  db.pragma('foreign_keys = ON');
  console.warn('Schema migration notice:', migErr.message);
}

// Additive column migrations for existing databases
const columnMigrations = [
  "ALTER TABLE users ADD COLUMN favorite_albums TEXT DEFAULT '[]'",
  'ALTER TABLE users ADD COLUMN lastfm_last_sync_uts INTEGER DEFAULT 0',
  'ALTER TABLE users ADD COLUMN lastfm_synced_user TEXT',
  'ALTER TABLE users ADD COLUMN avatar_url TEXT',
  'ALTER TABLE user_albums ADD COLUMN pending_recommendation INTEGER NOT NULL DEFAULT 0',
];

for (const sql of columnMigrations) {
  try {
    db.exec(sql);
  } catch {
    // Column already exists
  }
}

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

export function resolveFavoriteAlbums(userId) {
  const row = db.prepare('SELECT favorite_albums FROM users WHERE id = ?').get(userId);
  let ids = [];
  try {
    ids = JSON.parse(row?.favorite_albums || '[]');
  } catch {
    ids = [];
  }
  if (!Array.isArray(ids) || ids.length === 0) return [];

  const limitedIds = ids
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, MAX_FAVORITE_ALBUMS);

  if (limitedIds.length === 0) return [];

  const placeholders = limitedIds.map(() => '?').join(',');
  const albums = db
    .prepare(
      `SELECT a.*
       FROM albums a
       JOIN user_albums ua ON ua.album_id = a.id
       WHERE ua.user_id = ?
         AND ua.status = 'listened'
         AND COALESCE(ua.pending_recommendation, 0) = 0
         AND a.id IN (${placeholders})`
    )
    .all(userId, ...limitedIds);

  const byId = new Map(albums.map((a) => [Number(a.id), a]));
  return limitedIds.map((id) => byId.get(Number(id))).filter(Boolean);
}

export function removeAlbumFromFavorites(userId, albumId) {
  const row = db.prepare('SELECT favorite_albums FROM users WHERE id = ?').get(userId);
  if (!row?.favorite_albums) return;
  try {
    const parsed = JSON.parse(row.favorite_albums);
    if (!Array.isArray(parsed)) return;
    const filtered = parsed.filter((id) => Number(id) !== Number(albumId));
    if (filtered.length !== parsed.length) {
      db.prepare('UPDATE users SET favorite_albums = ? WHERE id = ?').run(
        JSON.stringify(filtered),
        userId
      );
    }
  } catch {
    // Ignore malformed JSON
  }
}

export function resolveFavoriteTracks(userId) {
  return db
    .prepare(
      `SELECT id, position, track_title, artist_name, album_title, cover_url, created_at
       FROM favorite_tracks
       WHERE user_id = ?
       ORDER BY position ASC
       LIMIT ?`
    )
    .all(userId, MAX_FAVORITE_TRACKS);
}

export function createRecommendationNotification({
  recommenderId,
  listenerId,
  albumId,
  rating = null,
  note = null,
}) {
  if (!recommenderId || !listenerId || !albumId) return;
  if (Number(recommenderId) === Number(listenerId)) return;

  const recentDuplicate = db
    .prepare(
      `SELECT id
       FROM recommendation_notifications
       WHERE recommender_id = ?
         AND listener_id = ?
         AND album_id = ?
         AND COALESCE(seen, 0) = 0
         AND datetime(created_at) >= datetime('now', '-2 hours')
       LIMIT 1`
    )
    .get(recommenderId, listenerId, albumId);

  if (recentDuplicate) return;

  db.prepare(
    `INSERT INTO recommendation_notifications (recommender_id, listener_id, album_id, rating, note, seen)
     VALUES (?, ?, ?, ?, ?, 0)`
  ).run(
    recommenderId,
    listenerId,
    albumId,
    rating != null ? Number(rating) : null,
    note || null
  );
}

db.resolveFavoriteAlbums = resolveFavoriteAlbums;
db.removeAlbumFromFavorites = removeAlbumFromFavorites;
db.resolveFavoriteTracks = resolveFavoriteTracks;
db.createRecommendationNotification = createRecommendationNotification;

export default db;