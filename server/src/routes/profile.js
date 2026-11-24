import { Router } from 'express';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();
router.use(authenticateToken);

router.get('/', (req, res) => {
  try {
    const userId = req.user.id;

    const user = db.prepare(
      'SELECT id, username, display_name, lastfm_username, created_at FROM users WHERE id = ?'
    ).get(userId);

    if (!user) return res.status(404).json({ error: 'User not found' });

    const listenedCount = db.prepare(
      "SELECT COUNT(*) as count FROM user_albums WHERE user_id = ? AND status = 'listened'"
    ).get(userId).count;

    const toListenCount = db.prepare(
      "SELECT COUNT(*) as count FROM user_albums WHERE user_id = ? AND status = 'to_listen'"
    ).get(userId).count;

    const friendsCount = db.prepare(
      "SELECT COUNT(*) as count FROM friendships WHERE (user_id = ? OR friend_id = ?) AND status = 'accepted'"
    ).get(userId, userId).count;

    res.json({ ...user, listened_count: listenedCount, to_listen_count: toListenCount, friends_count: friendsCount });
  } catch {
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

router.put('/', (req, res) => {
  try {
    const userId = req.user.id;
    const { display_name, lastfm_username } = req.body;

    const current = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

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

    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Failed to update profile' });
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

    // 1. Paginate through user.gettopalbums with limit=500
    let page = 1;
    let totalPages = 1;
    const maxPages = 40; // up to 20,000 albums

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

    // 2. Complement with recent tracks to catch songs scrobbled recently
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
          }
        }
      }
    } catch {
      // Non-fatal if recent tracks fails
    }

    // 3. Batch insert into SQLite
    let imported = 0;
    const insertAlbum = db.prepare(
      'INSERT OR IGNORE INTO albums (external_id, source, title, artist, year, cover_url) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const getAlbum = db.prepare('SELECT id FROM albums WHERE external_id = ? AND source = ?');
    const insertUserAlbum = db.prepare(
      "INSERT OR IGNORE INTO user_albums (user_id, album_id, status) VALUES (?, ?, 'listened')"
    );

    const syncAll = db.transaction(() => {
      for (const item of collectedAlbums.values()) {
        insertAlbum.run(item.externalId, 'lastfm', item.title, item.artist, null, item.coverUrl);
        const dbAlbum = getAlbum.get(item.externalId, 'lastfm');
        if (dbAlbum) {
          const res = insertUserAlbum.run(userId, dbAlbum.id);
          if (res.changes > 0) imported++;
        }
      }
    });

    syncAll();

    res.json({
      imported,
      total_found: collectedAlbums.size,
      message: `Sincronizados ${collectedAlbums.size} álbumes (${imported} nuevos añadidos)`
    });
  } catch (err) {
    console.error('Last.fm sync error:', err);
    res.status(500).json({ error: 'Failed to sync Last.fm data' });
  }
});

export default router;