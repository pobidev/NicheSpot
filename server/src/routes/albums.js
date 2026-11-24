import { Router } from 'express';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();
router.use(authenticateToken);

// Rate limiter for MusicBrainz (strict ~1 req/s requirement)
let lastMusicBrainzCall = 0;
async function fetchMusicBrainzRateLimited(url) {
  const now = Date.now();
  const diff = now - lastMusicBrainzCall;
  if (diff < 1100) {
    await new Promise((r) => setTimeout(r, 1100 - diff));
  }
  lastMusicBrainzCall = Date.now();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 7000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': process.env.MUSICBRAINZ_USER_AGENT || 'NichoSpot/1.0 (contacto@homelab.local)',
        'Accept': 'application/json',
      },
    });
    clearTimeout(timeoutId);
    return res;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// In-memory query cache with TTL (15 minutes)
const searchMemoryCache = new Map();
const SEARCH_CACHE_TTL = 15 * 60 * 1000;

router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || !q.trim()) return res.status(400).json({ error: 'Query parameter q is required' });

    const cleanQ = q.trim();
    const cacheKey = cleanQ.toLowerCase();

    // Check memory cache
    const cached = searchMemoryCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < SEARCH_CACHE_TTL) {
      return res.json(cached.results);
    }

    const albumsMap = new Map();

    const addAlbumResult = (album) => {
      if (!album.title || !album.artist) return;
      const key = `${album.artist.toLowerCase()}:::${album.title.toLowerCase()}`;
      if (!albumsMap.has(key)) {
        albumsMap.set(key, album);
      } else {
        const existing = albumsMap.get(key);
        if (!existing.cover_url && album.cover_url) existing.cover_url = album.cover_url;
        if (!existing.matched_track && album.matched_track) existing.matched_track = album.matched_track;
      }
    };

    // 1. Unified search on MusicBrainz: Release-groups (covers albums and artists)
    try {
      const rgUrl = `https://musicbrainz.org/ws/2/release-group?query=${encodeURIComponent(cleanQ)}&type=album&fmt=json&limit=15`;
      const rgRes = await fetchMusicBrainzRateLimited(rgUrl);
      if (rgRes.ok) {
        const rgData = await rgRes.json().catch(() => null);
        for (const rg of (rgData?.['release-groups'] || [])) {
          addAlbumResult({
            external_id: rg.id,
            source: 'musicbrainz',
            title: rg.title,
            artist: rg['artist-credit']?.[0]?.name || 'Unknown Artist',
            year: rg['first-release-date']?.substring(0, 4) || null,
            cover_url: `https://coverartarchive.org/release-group/${rg.id}/front-250`,
          });
        }
      }
    } catch (mbErr) {
      console.warn('MusicBrainz release-group search error:', mbErr.message);
    }

    // 2. MusicBrainz Recording search (find tracks and resolve to their parent album)
    try {
      const recUrl = `https://musicbrainz.org/ws/2/recording?query=recording:${encodeURIComponent(cleanQ)}%20OR%20${encodeURIComponent(cleanQ)}&fmt=json&limit=10`;
      const recRes = await fetchMusicBrainzRateLimited(recUrl);
      if (recRes.ok) {
        const recData = await recRes.json().catch(() => null);
        for (const rec of (recData?.recordings || [])) {
          const songTitle = rec.title;
          const artistName = rec['artist-credit']?.[0]?.name || 'Unknown Artist';
          for (const rel of (rec.releases || [])) {
            const rgId = rel['release-group']?.id || rel.id;
            const albumTitle = rel['release-group']?.title || rel.title;
            if (albumTitle) {
              addAlbumResult({
                external_id: rgId,
                source: 'musicbrainz',
                title: albumTitle,
                artist: artistName,
                year: rel.date?.substring(0, 4) || null,
                cover_url: `https://coverartarchive.org/release-group/${rgId}/front-250`,
                matched_track: songTitle,
              });
            }
          }
        }
      }
    } catch (mbRecErr) {
      console.warn('MusicBrainz recording search error:', mbRecErr.message);
    }

    // 3. Fallback or enrichment with iTunes Search API if few or no results found
    if (albumsMap.size < 4) {
      try {
        const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(cleanQ)}&entity=album&limit=15`;
        const itunesRes = await fetch(itunesUrl);
        if (itunesRes.ok) {
          const itunesData = await itunesRes.json().catch(() => null);
          for (const item of (itunesData?.results || [])) {
            const highResCover = item.artworkUrl100?.replace('100x100bb', '600x600bb') || null;
            addAlbumResult({
              external_id: `itunes-${item.collectionId}`,
              source: 'itunes',
              title: item.collectionName,
              artist: item.artistName,
              year: item.releaseDate?.substring(0, 4) || null,
              cover_url: highResCover,
            });
          }
        }

        // Also search songs in iTunes to resolve tracks to albums
        if (albumsMap.size < 3) {
          const songUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(cleanQ)}&entity=song&limit=10`;
          const songRes = await fetch(songUrl);
          if (songRes.ok) {
            const songData = await songRes.json().catch(() => null);
            for (const item of (songData?.results || [])) {
              if (item.collectionName && item.artistName) {
                const highResCover = item.artworkUrl100?.replace('100x100bb', '600x600bb') || null;
                addAlbumResult({
                  external_id: `itunes-${item.collectionId}`,
                  source: 'itunes',
                  title: item.collectionName,
                  artist: item.artistName,
                  year: item.releaseDate?.substring(0, 4) || null,
                  cover_url: highResCover,
                  matched_track: item.trackName,
                });
              }
            }
          }
        }
      } catch (itunesErr) {
        console.warn('iTunes fallback search error:', itunesErr.message);
      }
    }

    const results = Array.from(albumsMap.values());

    // Cache in SQLite albums table so records exist locally
    if (results.length > 0) {
      const insertStmt = db.prepare(
        'INSERT OR IGNORE INTO albums (external_id, source, title, artist, year, cover_url) VALUES (?, ?, ?, ?, ?, ?)'
      );
      const cacheAll = db.transaction(() => {
        for (const alb of results) {
          insertStmt.run(alb.external_id, alb.source || 'musicbrainz', alb.title, alb.artist, alb.year || null, alb.cover_url || null);
        }
      });
      cacheAll();
    }

    // Cache results in memory
    searchMemoryCache.set(cacheKey, { timestamp: Date.now(), results });
    if (searchMemoryCache.size > 200) {
      const firstKey = searchMemoryCache.keys().next().value;
      searchMemoryCache.delete(firstKey);
    }

    res.json(results);
  } catch (err) {
    console.error('Search endpoint error:', err);
    res.status(500).json({ error: 'Failed to search albums' });
  }
});

router.get('/feed', (req, res) => {
  try {
    const userId = req.user.id;
    const feed = db.prepare(`
      SELECT ua.id as user_album_id, ua.status, ua.rating, ua.note, ua.updated_at,
             a.id as album_id, a.external_id, a.source, a.title, a.artist, a.year, a.cover_url,
             u.id as user_id, u.username, u.display_name
      FROM user_albums ua
      JOIN albums a ON a.id = ua.album_id
      JOIN users u ON u.id = ua.user_id
      WHERE ua.user_id IN (
        SELECT CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END
        FROM friendships f
        WHERE (f.user_id = ? OR f.friend_id = ?) AND f.status = 'accepted'
      )
      ORDER BY ua.updated_at DESC
      LIMIT 20
    `).all(userId, userId, userId);

    res.json(feed);
  } catch {
    res.status(500).json({ error: 'Failed to get feed' });
  }
});

router.post('/', (req, res) => {
  try {
    const { external_id, source, title, artist, year, cover_url } = req.body;

    if (!external_id || !title || !artist) {
      return res.status(400).json({ error: 'external_id, title, and artist are required' });
    }

    db.prepare(
      'INSERT OR IGNORE INTO albums (external_id, source, title, artist, year, cover_url) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(external_id, source || 'musicbrainz', title, artist, year || null, cover_url || null);

    const album = db.prepare(
      'SELECT * FROM albums WHERE external_id = ? AND source = ?'
    ).get(external_id, source || 'musicbrainz');

    res.status(201).json(album);
  } catch {
    res.status(500).json({ error: 'Failed to add album' });
  }
});

router.post('/user-albums', (req, res) => {
  try {
    const { album_id, status, rating, note } = req.body;
    const userId = req.user.id;

    if (!album_id) return res.status(400).json({ error: 'album_id is required' });

    const targetAlbum = db.prepare('SELECT id, title, artist FROM albums WHERE id = ?').get(album_id);
    if (!targetAlbum) return res.status(404).json({ error: 'Album not found' });

    // Look for existing record by album_id OR normalized title + artist
    const existing = db.prepare(`
      SELECT ua.id, ua.album_id
      FROM user_albums ua
      JOIN albums a ON a.id = ua.album_id
      WHERE ua.user_id = ? AND (
        ua.album_id = ? OR (
          LOWER(TRIM(a.title)) = LOWER(TRIM(?)) AND
          LOWER(TRIM(a.artist)) = LOWER(TRIM(?))
        )
      )
    `).get(userId, album_id, targetAlbum.title, targetAlbum.artist);

    let userAlbumId;

    if (existing) {
      db.prepare(`
        UPDATE user_albums SET
          album_id = ?,
          status = ?,
          rating = ?,
          note = ?,
          recommended_by_user_id = NULL,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(
        album_id,
        status || 'to_listen',
        rating !== undefined ? rating : null,
        note !== undefined ? note : null,
        existing.id
      );
      userAlbumId = existing.id;
    } else {
      const info = db.prepare(`
        INSERT INTO user_albums (user_id, album_id, status, rating, note, recommended_by_user_id)
        VALUES (?, ?, ?, ?, ?, NULL)
      `).run(
        userId,
        album_id,
        status || 'to_listen',
        rating !== undefined ? rating : null,
        note !== undefined ? note : null
      );
      userAlbumId = info.lastInsertRowid;
    }

    const userAlbum = db.prepare('SELECT * FROM user_albums WHERE id = ?').get(userAlbumId);
    res.status(201).json(userAlbum);
  } catch (err) {
    console.error('Error in POST /user-albums:', err);
    res.status(500).json({ error: 'Failed to add user album' });
  }
});

router.put('/user-albums/:id', (req, res) => {
  try {
    const { status, rating, note } = req.body;
    const userId = req.user.id;
    const { id } = req.params;

    const existing = db.prepare('SELECT * FROM user_albums WHERE id = ? AND user_id = ?').get(id, userId);
    if (!existing) return res.status(404).json({ error: 'User album not found' });

    db.prepare(`
      UPDATE user_albums SET
        status = COALESCE(?, status),
        rating = ?,
        note = COALESCE(?, note),
        recommended_by_user_id = NULL,
        updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `).run(
      status || null,
      rating !== undefined ? rating : existing.rating,
      note !== undefined ? note : null,
      id,
      userId
    );

    const updated = db.prepare('SELECT * FROM user_albums WHERE id = ?').get(id);
    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Failed to update user album' });
  }
});

router.delete('/user-albums/:id', (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = db.prepare('DELETE FROM user_albums WHERE id = ? AND user_id = ?').run(id, userId);
    if (result.changes === 0) return res.status(404).json({ error: 'User album not found' });

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete user album' });
  }
});

router.get('/user-albums', (req, res) => {
  try {
    const userId = req.user.id;
    const { status } = req.query;

    let query = `
      SELECT ua.id as user_album_id, ua.*, a.external_id, a.source, a.title, a.artist, a.year, a.cover_url
      FROM user_albums ua
      JOIN albums a ON a.id = ua.album_id
      WHERE ua.user_id = ?
    `;
    const params = [userId];

    if (status) {
      query += ' AND ua.status = ?';
      params.push(status);
    }

    query += ' ORDER BY ua.updated_at DESC';

    const albums = db.prepare(query).all(...params);
    res.json(albums);
  } catch {
    res.status(500).json({ error: 'Failed to get user albums' });
  }
});

router.get('/user-albums/user/:userId', (req, res) => {
  try {
    const currentUserId = req.user.id;
    const targetUserId = parseInt(req.params.userId);

    const friendship = db.prepare(`
      SELECT id FROM friendships
      WHERE ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))
        AND status = 'accepted'
    `).get(currentUserId, targetUserId, targetUserId, currentUserId);

    if (!friendship) {
      return res.status(403).json({ error: 'You must be friends to view their albums' });
    }

    const { status } = req.query;
    let query = `
      SELECT ua.id as user_album_id, ua.*, a.external_id, a.source, a.title, a.artist, a.year, a.cover_url
      FROM user_albums ua
      JOIN albums a ON a.id = ua.album_id
      WHERE ua.user_id = ?
    `;
    const params = [targetUserId];

    if (status) {
      query += ' AND ua.status = ?';
      params.push(status);
    }

    query += ' ORDER BY ua.updated_at DESC';

    const albums = db.prepare(query).all(...params);
    res.json(albums);
  } catch {
    res.status(500).json({ error: 'Failed to get user albums' });
  }
});

router.post('/recommend', (req, res) => {
  try {
    const { album_id, friend_id } = req.body;
    const userId = req.user.id;

    if (!album_id || !friend_id) {
      return res.status(400).json({ error: 'album_id y friend_id son requeridos' });
    }

    const friendship = db.prepare(`
      SELECT id FROM friendships
      WHERE ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))
        AND status = 'accepted'
    `).get(userId, friend_id, friend_id, userId);

    if (!friendship) {
      return res.status(403).json({ error: 'Solo puedes recomendar álbumes a amigos' });
    }

    const album = db.prepare('SELECT id, title, artist FROM albums WHERE id = ?').get(album_id);
    if (!album) {
      return res.status(404).json({ error: 'Álbum no encontrado' });
    }

    // Check if the friend already has this album in 'listened'
    const alreadyListened = db.prepare(`
      SELECT ua.id, a.title, a.artist
      FROM user_albums ua
      JOIN albums a ON a.id = ua.album_id
      WHERE ua.user_id = ?
        AND ua.status = 'listened'
        AND (
          ua.album_id = ?
          OR (
            LOWER(TRIM(a.title)) = LOWER(TRIM(?))
            AND LOWER(TRIM(a.artist)) = LOWER(TRIM(?))
          )
        )
    `).get(friend_id, album_id, album.title, album.artist);

    if (alreadyListened) {
      return res.status(400).json({ error: 'Este usuario ya ha escuchado este álbum' });
    }

    // Check if friend already has it in 'to_listen'
    const inToListen = db.prepare(`
      SELECT ua.id
      FROM user_albums ua
      JOIN albums a ON a.id = ua.album_id
      WHERE ua.user_id = ?
        AND ua.status = 'to_listen'
        AND (
          ua.album_id = ?
          OR (
            LOWER(TRIM(a.title)) = LOWER(TRIM(?))
            AND LOWER(TRIM(a.artist)) = LOWER(TRIM(?))
          )
        )
    `).get(friend_id, album_id, album.title, album.artist);

    if (inToListen) {
      db.prepare(`
        UPDATE user_albums SET
          recommended_by_user_id = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(userId, inToListen.id);
    } else {
      db.prepare(`
        INSERT INTO user_albums (user_id, album_id, status, recommended_by_user_id)
        VALUES (?, ?, 'to_listen', ?)
      `).run(friend_id, album_id, userId);
    }

    res.json({ success: true, message: 'Álbum recomendado con éxito' });
  } catch (err) {
    console.error('Error in POST /recommend:', err);
    res.status(500).json({ error: 'Failed to recommend album' });
  }
});

export default router;
