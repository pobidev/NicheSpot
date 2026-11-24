import { Router } from 'express';
import db, { resolveFavoriteAlbums } from '../db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();
router.use(authenticateToken);

const albumTracksCache = new Map();
const TRACKS_CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function getLastfmAlbumTracks(artist, albumTitle, apiKey) {
  const key = `${artist.toLowerCase().trim()}:::${albumTitle.toLowerCase().trim()}`;
  const cached = albumTracksCache.get(key);
  if (cached && Date.now() - cached.timestamp < TRACKS_CACHE_TTL) {
    return cached.tracks;
  }

  try {
    const url = `https://ws.audioscrobbler.com/2.0/?method=album.getinfo&api_key=${encodeURIComponent(apiKey)}&artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(albumTitle)}&format=json`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!data || data.error || !data.album?.tracks?.track) return null;

    let rawTracks = data.album.tracks.track;
    if (!Array.isArray(rawTracks)) rawTracks = [rawTracks];

    const names = rawTracks
      .map((t) => (typeof t === 'string' ? t : t?.name))
      .map((name) => (name || '').trim())
      .filter(Boolean);

    if (names.length === 0) return null;

    albumTracksCache.set(key, { timestamp: Date.now(), tracks: names });
    return names;
  } catch {
    return null;
  }
}

router.get('/', (req, res) => {
  try {
    const userId = req.user.id;

    const user = db.prepare(
      'SELECT id, username, display_name, lastfm_username, created_at FROM users WHERE id = ?'
    ).get(userId);

    if (!user) return res.status(404).json({ error: 'User not found' });

    const counts = db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'listened' THEN 1 ELSE 0 END) AS listened_count,
        SUM(CASE WHEN status = 'partially_listened' THEN 1 ELSE 0 END) AS partially_listened_count,
        SUM(CASE WHEN status = 'to_listen' THEN 1 ELSE 0 END) AS to_listen_count
      FROM user_albums
      WHERE user_id = ? AND COALESCE(pending_recommendation, 0) = 0
    `).get(userId);

    const friendsCount = db.prepare(
      "SELECT COUNT(*) as count FROM friendships WHERE (user_id = ? OR friend_id = ?) AND status = 'accepted'"
    ).get(userId, userId).count;

    res.json({
      ...user,
      favorite_albums: resolveFavoriteAlbums(userId),
      listened_count: counts?.listened_count || 0,
      partially_listened_count: counts?.partially_listened_count || 0,
      to_listen_count: counts?.to_listen_count || 0,
      friends_count: friendsCount,
    });
  } catch {
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

router.put('/', (req, res) => {
  try {
    const userId = req.user.id;
    const { display_name, lastfm_username } = req.body;

    const current = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!current) return res.status(404).json({ error: 'User not found' });

    db.prepare(`
      UPDATE users SET display_name = ?, lastfm_username = ? WHERE id = ?
    `).run(
      display_name !== undefined ? display_name : current.display_name,
      lastfm_username !== undefined ? lastfm_username : current.lastfm_username,
      userId
    );

    const updated = db.prepare(
      'SELECT id, username, display_name, lastfm_username, created_at FROM users WHERE id = ?'
    ).get(userId);

    res.json({
      ...updated,
      favorite_albums: resolveFavoriteAlbums(userId),
    });
  } catch {
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

router.put('/favorites', (req, res) => {
  try {
    const userId = req.user.id;
    const { album_ids } = req.body;

    if (!Array.isArray(album_ids)) {
      return res.status(400).json({ error: 'album_ids must be an array' });
    }

    const uniqueIds = [...new Set(album_ids.map(Number).filter(Boolean))].slice(0, 6);

    if (uniqueIds.length > 0) {
      const placeholders = uniqueIds.map(() => '?').join(',');
      const validRows = db
        .prepare(
          `SELECT album_id
           FROM user_albums
           WHERE user_id = ?
             AND status = 'listened'
             AND COALESCE(pending_recommendation, 0) = 0
             AND album_id IN (${placeholders})`
        )
        .all(userId, ...uniqueIds);

      const validSet = new Set(validRows.map((r) => Number(r.album_id)));
      const filtered = uniqueIds.filter((id) => validSet.has(id));

      db.prepare('UPDATE users SET favorite_albums = ? WHERE id = ?').run(
        JSON.stringify(filtered),
        userId
      );
    } else {
      db.prepare("UPDATE users SET favorite_albums = '[]' WHERE id = ?").run(userId);
    }

    res.json({ favorite_albums: resolveFavoriteAlbums(userId) });
  } catch (err) {
    console.error('Error updating favorites:', err);
    res.status(500).json({ error: 'Failed to update favorites' });
  }
});

router.post('/sync-lastfm', async (req, res) => {
  try {
    const userId = req.user.id;
    const user = db.prepare('SELECT lastfm_username FROM users WHERE id = ?').get(userId);

    if (!user?.lastfm_username) {
      return res.status(400).json({ error: 'Last.fm username not set. Update your profile first.' });
    }

    const apiKey = process.env.LASTFM_API_KEY;
    if (!apiKey) {
      return res.status(400).json({ error: 'LASTFM_API_KEY not configured on the server' });
    }

    const lastfmUser = user.lastfm_username.trim();
    const collectedAlbums = new Map();
    const albumScrobbledTracks = new Map(); // key -> Set of lowercase track names

    const addAlbumEntry = (title, artist, mbid, coverUrl) => {
      if (!title || !artist || title === '(null)' || artist === '(null)') return;
      const key = `${artist.trim()}:::${title.trim()}`.toLowerCase();
      if (!collectedAlbums.has(key)) {
        collectedAlbums.set(key, {
          title: title.trim(),
          artist: artist.trim(),
          externalId: mbid && mbid.length > 10 ? mbid : `lastfm-${artist.trim()}-${title.trim()}`,
          coverUrl: coverUrl || null,
        });
      }
    };

    const recordTrackForAlbum = (artist, albumTitle, trackTitle) => {
      if (!artist || !albumTitle || !trackTitle) return;
      const key = `${artist.trim()}:::${albumTitle.trim()}`.toLowerCase();
      if (!albumScrobbledTracks.has(key)) albumScrobbledTracks.set(key, new Set());
      albumScrobbledTracks.get(key).add(trackTitle.trim().toLowerCase());
    };

    // 1. Paginate through user.gettopalbums with limit=500
    let page = 1;
    let totalPages = 1;
    const maxPages = 40;

    while (page <= totalPages && page <= maxPages) {
      const topUrl = `https://ws.audioscrobbler.com/2.0/?method=user.gettopalbums&user=${encodeURIComponent(lastfmUser)}&api_key=${encodeURIComponent(apiKey)}&format=json&limit=500&page=${page}`;
      const response = await fetch(topUrl);
      if (!response.ok) break;

      const data = await response.json().catch(() => null);
      if (!data || data.error) break;

      const attr = data?.topalbums?.['@attr'];
      if (attr?.totalPages) {
        totalPages = parseInt(attr.totalPages, 10) || 1;
      }

      let rawAlbums = data?.topalbums?.album || [];
      if (!Array.isArray(rawAlbums)) rawAlbums = [rawAlbums];
      if (rawAlbums.length === 0) break;

      let hasValidPlaycount = false;
      for (const alb of rawAlbums) {
        const playcount = parseInt(alb.playcount || '0', 10);
        if (playcount >= 1 || !alb.playcount) {
          hasValidPlaycount = true;
          const artistName = typeof alb.artist === 'object' ? alb.artist?.name : alb.artist;
          const cover = alb.image?.find?.((i) => i.size === 'extralarge' || i.size === 'large')?.['#text'];
          addAlbumEntry(alb.name, artistName, alb.mbid, cover);
        }
      }

      if (!hasValidPlaycount) break;
      page++;
      if (page <= totalPages) {
        await new Promise((r) => setTimeout(r, 120));
      }
    }

    // 2. Fetch recent tracks to catch recently scrobbled albums & individual tracks
    try {
      const recentUrl = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${encodeURIComponent(lastfmUser)}&api_key=${encodeURIComponent(apiKey)}&format=json&limit=200`;
      const recentRes = await fetch(recentUrl);
      if (recentRes.ok) {
        const recentData = await recentRes.json().catch(() => null);
        let tracks = recentData?.recenttracks?.track || [];
        if (!Array.isArray(tracks)) tracks = [tracks];
        for (const t of tracks) {
          const albumName = t.album?.['#text'];
          const artistName = typeof t.artist === 'object' ? (t.artist?.['#text'] || t.artist?.name) : t.artist;
          const cover = t.image?.find?.((i) => i.size === 'large' || i.size === 'extralarge')?.['#text'];
          if (albumName && artistName) {
            addAlbumEntry(albumName, artistName, t.album?.mbid, cover);
            if (t.name) recordTrackForAlbum(artistName, albumName, t.name);
          }
        }
      }
    } catch {
      // Non-fatal if recent tracks fails
    }

    // 3. Check tracklists for up to 40 albums to detect partial listens
    const albumStatuses = new Map();
    let inspectedCount = 0;
    const maxInspect = 40;

    for (const [key, item] of collectedAlbums.entries()) {
      const listenedSet = albumScrobbledTracks.get(key) || new Set();
      let status = 'listened';
      let officialTracks = null;

      if (inspectedCount < maxInspect) {
        inspectedCount++;
        officialTracks = await getLastfmAlbumTracks(item.artist, item.title, apiKey);
        if (officialTracks && officialTracks.length > 0 && listenedSet.size > 0 && listenedSet.size < officialTracks.length) {
          status = 'partially_listened';
        }
        await new Promise((r) => setTimeout(r, 120));
      }

      albumStatuses.set(key, { status, officialTracks, listenedSet });
    }

    // 4. Batch insert/update into SQLite
    let imported = 0;
    let partialCount = 0;

    const insertAlbum = db.prepare(
      'INSERT OR IGNORE INTO albums (external_id, source, title, artist, year, cover_url) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const getAlbum = db.prepare('SELECT id FROM albums WHERE external_id = ? AND source = ?');
    const getExistingUserAlbum = db.prepare(
      'SELECT id, status, pending_recommendation FROM user_albums WHERE user_id = ? AND album_id = ?'
    );
    const insertUserAlbum = db.prepare(
      'INSERT INTO user_albums (user_id, album_id, status, pending_recommendation) VALUES (?, ?, ?, 0)'
    );
    const updateStatusFromSync = db.prepare(
      "UPDATE user_albums SET status = ?, pending_recommendation = 0, updated_at = datetime('now') WHERE id = ?"
    );
    const deleteTracks = db.prepare('DELETE FROM user_album_tracks WHERE user_album_id = ?');
    const insertTrack = db.prepare(
      'INSERT OR REPLACE INTO user_album_tracks (user_album_id, track_title, track_number, listened) VALUES (?, ?, ?, ?)'
    );

    const syncAll = db.transaction(() => {
      for (const [key, item] of collectedAlbums.entries()) {
        insertAlbum.run(item.externalId, 'lastfm', item.title, item.artist, null, item.coverUrl);
        const dbAlbum = getAlbum.get(item.externalId, 'lastfm');
        if (!dbAlbum) continue;

        const meta = albumStatuses.get(key) || { status: 'listened', officialTracks: null, listenedSet: new Set() };
        const existing = getExistingUserAlbum.get(userId, dbAlbum.id);
        let userAlbumId;

        if (!existing) {
          const info = insertUserAlbum.run(userId, dbAlbum.id, meta.status);
          userAlbumId = info.lastInsertRowid;
          imported++;
        } else {
          userAlbumId = existing.id;
          if (existing.pending_recommendation === 1 || (meta.status === 'partially_listened' && existing.status === 'to_listen')) {
            updateStatusFromSync.run(meta.status, existing.id);
          }
        }

        if (meta.status === 'partially_listened') {
          partialCount++;
        }

        if (meta.officialTracks && meta.officialTracks.length > 0 && meta.listenedSet.size > 0) {
          deleteTracks.run(userAlbumId);
          meta.officialTracks.forEach((trackName, idx) => {
            const isListened = meta.listenedSet.has(trackName.toLowerCase()) ? 1 : 0;
            insertTrack.run(userAlbumId, trackName, idx + 1, isListened);
          });
        }
      }
    });

    syncAll();

    res.json({
      imported,
      partially_listened: partialCount,
      total_found: collectedAlbums.size,
      message: `Sincronizados ${collectedAlbums.size} álbumes (${imported} nuevos${partialCount > 0 ? `, ${partialCount} escuchados parcialmente` : ''})`,
    });
  } catch (err) {
    console.error('Last.fm sync error:', err);
    res.status(500).json({ error: 'Failed to sync Last.fm data' });
  }
});

export default router;