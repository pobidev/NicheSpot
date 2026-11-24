import { Router } from 'express';
import db, { removeAlbumFromFavorites } from '../db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();
router.use(authenticateToken);

const VALID_STATUSES = ['to_listen', 'partially_listened', 'listened'];
const VALID_SEARCH_TYPES = ['artist', 'album', 'song'];

// Caches en memoria con TTL
const tracklistMemoryCache = new Map();
const fullSearchListCache = new Map();
const artistIdMemoryCache = new Map();
const TRACKLIST_CACHE_TTL = 60 * 60 * 1000; // 1 hora
const SEARCH_CACHE_TTL = 15 * 60 * 1000; // 15 min

function setBoundedCache(map, key, value, maxSize = 200) {
  map.set(key, value);
  if (map.size > maxSize) {
    const oldestKey = map.keys().next().value;
    map.delete(oldestKey);
  }
}

function escapeLucene(str) {
  return str.replace(/([+\-&|!(){}[\]^"~*?:\\/])/g, '\\$1');
}

function normalizeRating(rawRating) {
  if (rawRating === undefined || rawRating === null || rawRating === '') return null;
  const num = Number(rawRating);
  if (!Number.isInteger(num) || num < 1 || num > 10) return NaN;
  return num;
}

function getOrderByClause(sort) {
  switch (sort) {
    case 'artist_asc':
      return 'a.artist COLLATE NOCASE ASC, a.title COLLATE NOCASE ASC';
    case 'artist_desc':
      return 'a.artist COLLATE NOCASE DESC, a.title COLLATE NOCASE ASC';
    case 'title_asc':
      return 'a.title COLLATE NOCASE ASC, a.artist COLLATE NOCASE ASC';
    case 'title_desc':
      return 'a.title COLLATE NOCASE DESC, a.artist COLLATE NOCASE ASC';
    case 'rating_desc':
      return 'COALESCE(ua.rating, -1) DESC, ua.updated_at DESC';
    case 'recent':
    default:
      return 'ua.updated_at DESC';
  }
}

function attachTracksToAlbums(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const ids = rows.map((r) => r.user_album_id).filter(Boolean);
  if (ids.length === 0) return rows.map((r) => ({ ...r, tracks: [] }));

  const placeholders = ids.map(() => '?').join(',');
  const tracks = db
    .prepare(
      `SELECT * FROM user_album_tracks WHERE user_album_id IN (${placeholders}) ORDER BY COALESCE(track_number, 999999) ASC, id ASC`
    )
    .all(...ids);

  const byUserAlbum = new Map();
  for (const t of tracks) {
    if (!byUserAlbum.has(t.user_album_id)) byUserAlbum.set(t.user_album_id, []);
    byUserAlbum.get(t.user_album_id).push(t);
  }

  return rows.map((r) => ({
    ...r,
    tracks: byUserAlbum.get(r.user_album_id) || [],
  }));
}

function syncTracksForUserAlbum(userAlbumId, tracks) {
  if (!Array.isArray(tracks)) return;
  const deleteAll = db.prepare('DELETE FROM user_album_tracks WHERE user_album_id = ?');
  const insertTrack = db.prepare(`
    INSERT OR REPLACE INTO user_album_tracks (user_album_id, track_title, track_number, listened)
    VALUES (?, ?, ?, ?)
  `);

  db.transaction(() => {
    deleteAll.run(userAlbumId);
    tracks.forEach((item, idx) => {
      const title =
        typeof item === 'string' ? item.trim() : (item?.track_title || item?.title || '').trim();
      if (!title) return;
      const trackNumber =
        typeof item === 'object' && item?.track_number != null ? Number(item.track_number) : idx + 1;
      const listened = typeof item === 'object' && !item?.listened ? 0 : 1;
      insertTrack.run(userAlbumId, title, trackNumber, listened);
    });
  })();
}

function queryUserAlbums(targetUserId, { status, sort, q }) {
  let query = `
    SELECT ua.id as user_album_id, ua.*, a.external_id, a.source, a.title, a.artist, a.year, a.cover_url
    FROM user_albums ua
    JOIN albums a ON a.id = ua.album_id
    WHERE ua.user_id = ?
      AND COALESCE(ua.pending_recommendation, 0) = 0
  `;
  const params = [targetUserId];

  if (status) {
    query += ' AND ua.status = ?';
    params.push(status);
  }

  if (q && q.trim()) {
    const term = `%${q.trim()}%`;
    query += ` AND (
      a.title LIKE ? OR
      a.artist LIKE ? OR
      COALESCE(ua.note, '') LIKE ? OR
      EXISTS (
        SELECT 1 FROM user_album_tracks uat
        WHERE uat.user_album_id = ua.id AND uat.track_title LIKE ?
      )
    )`;
    params.push(term, term, term, term);
  }

  query += ` ORDER BY ${getOrderByClause(sort)}`;
  return attachTracksToAlbums(db.prepare(query).all(...params));
}

// Rate limiter para MusicBrainz (~1 req/s)
let lastMusicBrainzCall = 0;
async function fetchMusicBrainzRateLimited(url) {
  const wait = 1100 - (Date.now() - lastMusicBrainzCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastMusicBrainzCall = Date.now();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8500);

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': process.env.MUSICBRAINZ_USER_AGENT || 'NichoSpot/1.0 (contacto@homelab.local)',
        Accept: 'application/json',
      },
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchAlbumTracklistFromProviders({ artist, title, external_id, source }) {
  const cacheKey = `${(artist || '').toLowerCase()}:::${(title || '').toLowerCase()}:::${external_id || ''}`;
  const cached = tracklistMemoryCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < TRACKLIST_CACHE_TTL) {
    return cached.tracks;
  }

  let tracks = [];
  const apiKey = process.env.LASTFM_API_KEY;

  // 1. Last.fm album.getInfo
  if (apiKey && artist && title) {
    try {
      const lfmUrl = `https://ws.audioscrobbler.com/2.0/?method=album.getinfo&api_key=${encodeURIComponent(apiKey)}&artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(title)}&format=json`;
      const lfmRes = await fetch(lfmUrl);
      if (lfmRes.ok) {
        const lfmData = await lfmRes.json().catch(() => null);
        let rawTracks = lfmData?.album?.tracks?.track;
        if (rawTracks) {
          if (!Array.isArray(rawTracks)) rawTracks = [rawTracks];
          tracks = rawTracks
            .map((t, idx) => ({
              track_number: Number(t?.['@attr']?.rank) || idx + 1,
              track_title: (typeof t === 'string' ? t : t?.name || '').trim(),
            }))
            .filter((t) => t.track_title);
        }
      }
    } catch {
      // Fallback a MusicBrainz / iTunes
    }
  }

  // 2. MusicBrainz
  if (
    tracks.length === 0 &&
    source === 'musicbrainz' &&
    external_id &&
    !String(external_id).startsWith('lastfm-') &&
    !String(external_id).startsWith('itunes-')
  ) {
    try {
      const rgRes = await fetchMusicBrainzRateLimited(
        `https://musicbrainz.org/ws/2/release-group/${encodeURIComponent(external_id)}?inc=releases&fmt=json`
      );
      if (rgRes.ok) {
        const rgData = await rgRes.json().catch(() => null);
        const firstReleaseId = rgData?.releases?.[0]?.id;
        if (firstReleaseId) {
          const relRes = await fetchMusicBrainzRateLimited(
            `https://musicbrainz.org/ws/2/release/${encodeURIComponent(firstReleaseId)}?inc=recordings&fmt=json`
          );
          if (relRes.ok) {
            const relData = await relRes.json().catch(() => null);
            tracks = (relData?.media?.[0]?.tracks || [])
              .map((t, idx) => ({
                track_number: Number(t.position) || idx + 1,
                track_title: (t.title || t.recording?.title || '').trim(),
              }))
              .filter((t) => t.track_title);
          }
        }
      }
    } catch {
      // Fallback a iTunes
    }
  }

  // 3. iTunes Lookup / Search
  if (tracks.length === 0 && artist && title) {
    try {
      let collectionId = String(external_id || '').startsWith('itunes-')
        ? String(external_id).replace('itunes-', '')
        : null;

      if (!collectionId) {
        const searchRes = await fetch(
          `https://itunes.apple.com/search?term=${encodeURIComponent(`${artist} ${title}`)}&entity=album&limit=3`
        );
        if (searchRes.ok) {
          const searchData = await searchRes.json().catch(() => null);
          const match =
            (searchData?.results || []).find(
              (r) =>
                r.collectionName?.toLowerCase().includes(title.toLowerCase()) ||
                title.toLowerCase().includes(r.collectionName?.toLowerCase())
            ) || searchData?.results?.[0];
          collectionId = match?.collectionId;
        }
      }

      if (collectionId) {
        const lookupRes = await fetch(
          `https://itunes.apple.com/lookup?id=${encodeURIComponent(collectionId)}&entity=song`
        );
        if (lookupRes.ok) {
          const lookupData = await lookupRes.json().catch(() => null);
          tracks = (lookupData?.results || [])
            .filter((item) => item.wrapperType === 'track' && item.trackName)
            .map((item, idx) => ({
              track_number: Number(item.trackNumber) || idx + 1,
              track_title: item.trackName.trim(),
            }));
        }
      }
    } catch {
      // No crítico
    }
  }

  if (tracks.length > 0) {
    setBoundedCache(tracklistMemoryCache, cacheKey, { timestamp: Date.now(), tracks }, 250);
  }
  return tracks;
}

async function getUserScrobbledTracksForAlbum(lastfmUsername, artist, albumTitle) {
  const apiKey = process.env.LASTFM_API_KEY;
  if (!apiKey || !lastfmUsername || !artist || !albumTitle) return new Set();

  const listenedSet = new Set();
  const normArtist = artist.trim().toLowerCase();
  const normAlbum = albumTitle.trim().toLowerCase();

  try {
    for (let page = 1; page <= 2; page++) {
      const url = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${encodeURIComponent(lastfmUsername)}&api_key=${encodeURIComponent(apiKey)}&format=json&limit=200&page=${page}`;
      const res = await fetch(url);
      if (!res.ok) break;
      const data = await res.json().catch(() => null);
      let raw = data?.recenttracks?.track || [];
      if (!Array.isArray(raw)) raw = [raw];
      if (raw.length === 0) break;

      for (const t of raw) {
        const tArtist = (
          typeof t.artist === 'object' ? t.artist?.['#text'] || t.artist?.name : t.artist || ''
        )
          .trim()
          .toLowerCase();
        const tAlbum = (t.album?.['#text'] || '').trim().toLowerCase();
        if (tArtist === normArtist && tAlbum === normAlbum && t.name) {
          listenedSet.add(t.name.trim().toLowerCase());
        }
      }
    }
  } catch {
    // Ignorar fallos de red con Last.fm
  }

  return listenedSet;
}

// Helpers unificados de búsqueda y deduplicación
function createAlbumCollector() {
  const map = new Map();
  return {
    add(album) {
      if (!album?.title || !album?.artist) return;
      const key = `${album.artist.toLowerCase().trim()}:::${album.title.toLowerCase().trim()}`;
      if (!map.has(key)) {
        map.set(key, album);
      } else {
        const existing = map.get(key);
        if (!existing.cover_url && album.cover_url) existing.cover_url = album.cover_url;
        if (!existing.matched_track && album.matched_track) existing.matched_track = album.matched_track;
      }
    },
    size: () => map.size,
    values: () => Array.from(map.values()),
  };
}

function mapItunesItem(item, matchedTrack = null) {
  return {
    external_id: `itunes-${item.collectionId}`,
    source: 'itunes',
    title: item.collectionName,
    artist: item.artistName,
    year: item.releaseDate?.substring(0, 4) || null,
    cover_url: item.artworkUrl100?.replace('100x100bb', '600x600bb') || null,
    ...(matchedTrack ? { matched_track: matchedTrack } : {}),
  };
}

async function resolveMusicBrainzArtist(cleanQ) {
  const key = cleanQ.toLowerCase();
  const cached = artistIdMemoryCache.get(key);
  if (cached && Date.now() - cached.timestamp < SEARCH_CACHE_TTL) {
    return cached.artist;
  }

  const escaped = escapeLucene(cleanQ);
  const url = `https://musicbrainz.org/ws/2/artist?query=artist:"${encodeURIComponent(escaped)}"%20OR%20artist:${encodeURIComponent(escaped)}&fmt=json&limit=5`;
  const res = await fetchMusicBrainzRateLimited(url);
  if (!res.ok) throw new Error(`MusicBrainz artist status ${res.status}`);

  const data = await res.json().catch(() => null);
  const artists = data?.artists || [];
  if (artists.length === 0) return null;

  const chosen = artists.find((a) => a.name?.toLowerCase().trim() === key) || artists[0];
  const resolved = { id: chosen.id, name: chosen.name };

  setBoundedCache(artistIdMemoryCache, key, { timestamp: Date.now(), artist: resolved }, 200);
  return resolved;
}

async function fetchFullArtistResults(cleanQ) {
  const collector = createAlbumCollector();
  let mbFailed = false;

  try {
    const resolvedArtist = await resolveMusicBrainzArtist(cleanQ);
    if (resolvedArtist?.id) {
      const rgRes = await fetchMusicBrainzRateLimited(
        `https://musicbrainz.org/ws/2/release-group?artist=${encodeURIComponent(resolvedArtist.id)}&type=album&fmt=json&limit=100&offset=0`
      );
      if (!rgRes.ok) throw new Error(`MusicBrainz browse status ${rgRes.status}`);

      const rgData = await rgRes.json().catch(() => null);
      const groups = (rgData?.['release-groups'] || []).sort((a, b) =>
        (a['first-release-date'] || '9999').localeCompare(b['first-release-date'] || '9999')
      );

      for (const rg of groups) {
        collector.add({
          external_id: rg.id,
          source: 'musicbrainz',
          title: rg.title,
          artist: resolvedArtist.name,
          year: rg['first-release-date']?.substring(0, 4) || null,
          cover_url: `https://coverartarchive.org/release-group/${rg.id}/front-250`,
        });
      }
    }
  } catch (err) {
    mbFailed = true;
    console.warn('MusicBrainz artist search error:', err.message);
  }

  if (collector.size() === 0) {
    try {
      const artistRes = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(cleanQ)}&entity=musicArtist&limit=3`
      );
      if (artistRes.ok) {
        const artistData = await artistRes.json().catch(() => null);
        const match =
          (artistData?.results || []).find(
            (a) => a.artistName?.toLowerCase().trim() === cleanQ.toLowerCase()
          ) || artistData?.results?.[0];

        if (match?.artistId) {
          const lookupRes = await fetch(
            `https://itunes.apple.com/lookup?id=${match.artistId}&entity=album&limit=100`
          );
          if (lookupRes.ok) {
            const lookupData = await lookupRes.json().catch(() => null);
            for (const item of lookupData?.results || []) {
              if (item.wrapperType === 'collection' && item.collectionName) {
                collector.add(mapItunesItem(item));
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn('iTunes artist fallback error:', err.message);
      if (mbFailed) throw new Error('No se pudo conectar con el servicio de música');
    }
  }

  return collector.values();
}

async function fetchFullAlbumResults(cleanQ) {
  const collector = createAlbumCollector();
  let mbFailed = false;

  try {
    const escaped = escapeLucene(cleanQ);
    const rgRes = await fetchMusicBrainzRateLimited(
      `https://musicbrainz.org/ws/2/release-group?query=(releasegroup:"${encodeURIComponent(escaped)}"%20OR%20releasegroup:${encodeURIComponent(escaped)})%20AND%20primarytype:album&fmt=json&limit=75&offset=0`
    );
    if (!rgRes.ok) throw new Error(`MusicBrainz album status ${rgRes.status}`);

    const rgData = await rgRes.json().catch(() => null);
    for (const rg of rgData?.['release-groups'] || []) {
      collector.add({
        external_id: rg.id,
        source: 'musicbrainz',
        title: rg.title,
        artist: rg['artist-credit']?.[0]?.name || 'Unknown Artist',
        year: rg['first-release-date']?.substring(0, 4) || null,
        cover_url: `https://coverartarchive.org/release-group/${rg.id}/front-250`,
      });
    }
  } catch (err) {
    mbFailed = true;
    console.warn('MusicBrainz album search error:', err.message);
  }

  if (collector.size() < 4) {
    try {
      const itunesRes = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(cleanQ)}&entity=album&limit=40`
      );
      if (itunesRes.ok) {
        const itunesData = await itunesRes.json().catch(() => null);
        for (const item of itunesData?.results || []) {
          collector.add(mapItunesItem(item));
        }
      }
    } catch (err) {
      console.warn('iTunes album fallback error:', err.message);
      if (mbFailed && collector.size() === 0) {
        throw new Error('No se pudo conectar con el servicio de música');
      }
    }
  }

  return collector.values();
}

async function fetchFullSongResults(cleanQ) {
  const collector = createAlbumCollector();
  let mbFailed = false;

  try {
    const escaped = escapeLucene(cleanQ);
    const recRes = await fetchMusicBrainzRateLimited(
      `https://musicbrainz.org/ws/2/recording?query=recording:"${encodeURIComponent(escaped)}"%20OR%20recording:${encodeURIComponent(escaped)}&fmt=json&limit=75&offset=0`
    );
    if (!recRes.ok) throw new Error(`MusicBrainz recording status ${recRes.status}`);

    const recData = await recRes.json().catch(() => null);
    for (const rec of recData?.recordings || []) {
      const artistName = rec['artist-credit']?.[0]?.name || 'Unknown Artist';
      const releases = rec.releases || [];
      const preferredRel =
        releases.find((r) => r['release-group']?.['primary-type'] === 'Album') || releases[0];

      if (preferredRel) {
        const rgId = preferredRel['release-group']?.id || preferredRel.id;
        const albumTitle = preferredRel['release-group']?.title || preferredRel.title;
        if (albumTitle) {
          collector.add({
            external_id: rgId,
            source: 'musicbrainz',
            title: albumTitle,
            artist: artistName,
            year: preferredRel.date?.substring(0, 4) || null,
            cover_url: `https://coverartarchive.org/release-group/${rgId}/front-250`,
            matched_track: rec.title,
          });
        }
      }
    }
  } catch (err) {
    mbFailed = true;
    console.warn('MusicBrainz song search error:', err.message);
  }

  if (collector.size() < 4) {
    try {
      const songRes = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(cleanQ)}&entity=song&limit=40`
      );
      if (songRes.ok) {
        const songData = await songRes.json().catch(() => null);
        for (const item of songData?.results || []) {
          if (item.collectionName && item.artistName) {
            collector.add(mapItunesItem(item, item.trackName));
          }
        }
      }
    } catch (err) {
      console.warn('iTunes song fallback error:', err.message);
      if (mbFailed && collector.size() === 0) {
        throw new Error('No se pudo conectar con el servicio de música');
      }
    }
  }

  return collector.values();
}

// Endpoints

router.get('/tracklist', async (req, res) => {
  try {
    const { artist, title, external_id, source, sync_lastfm } = req.query;
    if (!artist || !title) {
      return res.status(400).json({ error: 'artist and title are required' });
    }

    const baseTracks = await fetchAlbumTracklistFromProviders({ artist, title, external_id, source });

    let scrobbledSet = new Set();
    if (sync_lastfm === '1' || sync_lastfm === 'true') {
      const user = db.prepare('SELECT lastfm_username FROM users WHERE id = ?').get(req.user.id);
      if (user?.lastfm_username) {
        scrobbledSet = await getUserScrobbledTracksForAlbum(user.lastfm_username.trim(), artist, title);
      }
    }

    const tracks = baseTracks.map((t) => ({
      track_number: t.track_number,
      track_title: t.track_title,
      listened: scrobbledSet.has(t.track_title.toLowerCase()),
    }));

    res.json({
      tracks,
      lastfm_synced: scrobbledSet.size > 0,
      scrobbled_count: scrobbledSet.size,
    });
  } catch (err) {
    console.error('Tracklist endpoint error:', err);
    res.status(500).json({ error: 'Failed to fetch album tracklist' });
  }
});

router.get('/search', async (req, res) => {
  try {
    const { q, type = 'artist', page = '1', limit = '18' } = req.query;
    if (!q || !q.trim()) return res.status(400).json({ error: 'Query parameter q is required' });

    const cleanQ = q.trim();
    const searchType = VALID_SEARCH_TYPES.includes(type) ? type : 'album';
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(30, Math.max(6, parseInt(limit, 10) || 18));

    const listCacheKey = `${searchType}:::${cleanQ.toLowerCase()}`;
    const cached = fullSearchListCache.get(listCacheKey);
    let fullList;

    if (cached && Date.now() - cached.timestamp < SEARCH_CACHE_TTL) {
      fullList = cached.results;
    } else {
      if (searchType === 'artist') fullList = await fetchFullArtistResults(cleanQ);
      else if (searchType === 'song') fullList = await fetchFullSongResults(cleanQ);
      else fullList = await fetchFullAlbumResults(cleanQ);

      if (fullList.length > 0) {
        const insertStmt = db.prepare(
          'INSERT OR IGNORE INTO albums (external_id, source, title, artist, year, cover_url) VALUES (?, ?, ?, ?, ?, ?)'
        );
        db.transaction(() => {
          for (const alb of fullList) {
            insertStmt.run(
              alb.external_id,
              alb.source || 'musicbrainz',
              alb.title,
              alb.artist,
              alb.year || null,
              alb.cover_url || null
            );
          }
        })();

        setBoundedCache(fullSearchListCache, listCacheKey, { timestamp: Date.now(), results: fullList }, 150);
      }
    }

    const total = fullList.length;
    const totalPages = Math.max(1, Math.ceil(total / limitNum));
    const safePage = Math.min(pageNum, totalPages);
    const offset = (safePage - 1) * limitNum;

    res.json({
      results: fullList.slice(offset, offset + limitNum),
      type: searchType,
      page: safePage,
      limit: limitNum,
      total,
      total_pages: totalPages,
    });
  } catch (err) {
    console.error('Search endpoint error:', err);
    res.status(502).json({ error: err.message || 'Failed to search albums' });
  }
});

router.get('/feed', (req, res) => {
  try {
    const userId = req.user.id;
    const feed = db
      .prepare(
        `
      SELECT ua.id as user_album_id, ua.status, ua.rating, ua.note, ua.updated_at,
             a.id as album_id, a.external_id, a.source, a.title, a.artist, a.year, a.cover_url,
             u.id as user_id, u.username, u.display_name
      FROM user_albums ua
      JOIN albums a ON a.id = ua.album_id
      JOIN users u ON u.id = ua.user_id
      WHERE COALESCE(ua.pending_recommendation, 0) = 0
        AND ua.user_id IN (
          SELECT CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END
          FROM friendships f
          WHERE (f.user_id = ? OR f.friend_id = ?) AND f.status = 'accepted'
        )
      ORDER BY ua.updated_at DESC
      LIMIT 20
    `
      )
      .all(userId, userId, userId);

    res.json(attachTracksToAlbums(feed));
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

    const finalSource = source || 'musicbrainz';
    db.prepare(
      'INSERT OR IGNORE INTO albums (external_id, source, title, artist, year, cover_url) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(external_id, finalSource, title, artist, year || null, cover_url || null);

    const album = db
      .prepare('SELECT * FROM albums WHERE external_id = ? AND source = ?')
      .get(external_id, finalSource);

    res.status(201).json(album);
  } catch {
    res.status(500).json({ error: 'Failed to add album' });
  }
});

router.post('/user-albums', (req, res) => {
  try {
    const { album_id, status, rating, note, tracks } = req.body;
    const userId = req.user.id;
    if (!album_id) return res.status(400).json({ error: 'album_id is required' });

    const finalStatus = status || 'to_listen';
    if (!VALID_STATUSES.includes(finalStatus)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const parsedRating = normalizeRating(rating);
    if (Number.isNaN(parsedRating)) {
      return res.status(400).json({ error: 'Rating must be an integer between 1 and 10 or null' });
    }

    const targetAlbum = db.prepare('SELECT id, title, artist FROM albums WHERE id = ?').get(album_id);
    if (!targetAlbum) return res.status(404).json({ error: 'Album not found' });

    const existing = db
      .prepare(
        `
      SELECT ua.id
      FROM user_albums ua
      JOIN albums a ON a.id = ua.album_id
      WHERE ua.user_id = ? AND (
        ua.album_id = ? OR (
          LOWER(TRIM(a.title)) = LOWER(TRIM(?)) AND
          LOWER(TRIM(a.artist)) = LOWER(TRIM(?))
        )
      )
    `
      )
      .get(userId, album_id, targetAlbum.title, targetAlbum.artist);

    let userAlbumId;
    const cleanNote = note !== undefined && note !== '' ? note : null;

    if (existing) {
      db.prepare(
        `
        UPDATE user_albums SET
          album_id = ?, status = ?, rating = ?, note = ?,
          recommended_by_user_id = NULL, pending_recommendation = 0, updated_at = datetime('now')
        WHERE id = ?
      `
      ).run(album_id, finalStatus, parsedRating, cleanNote, existing.id);
      userAlbumId = existing.id;
    } else {
      const info = db
        .prepare(
          `
        INSERT INTO user_albums (user_id, album_id, status, rating, note, recommended_by_user_id, pending_recommendation)
        VALUES (?, ?, ?, ?, ?, NULL, 0)
      `
        )
        .run(userId, album_id, finalStatus, parsedRating, cleanNote);
      userAlbumId = info.lastInsertRowid;
    }

    if (finalStatus !== 'listened') {
      removeAlbumFromFavorites(userId, album_id);
    }

    if (Array.isArray(tracks)) syncTracksForUserAlbum(userAlbumId, tracks);

    const userAlbum = db.prepare('SELECT * FROM user_albums WHERE id = ?').get(userAlbumId);
    const savedTracks = db
      .prepare('SELECT * FROM user_album_tracks WHERE user_album_id = ? ORDER BY COALESCE(track_number, 999999) ASC')
      .all(userAlbumId);
    res.status(201).json({ ...userAlbum, tracks: savedTracks });
  } catch (err) {
    console.error('Error in POST /user-albums:', err);
    res.status(500).json({ error: 'Failed to add user album' });
  }
});

router.put('/user-albums/:id', (req, res) => {
  try {
    const { status, rating, note, tracks } = req.body;
    const userId = req.user.id;
    const { id } = req.params;

    const existing = db.prepare('SELECT * FROM user_albums WHERE id = ? AND user_id = ?').get(id, userId);
    if (!existing) return res.status(404).json({ error: 'User album not found' });

    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const parsedRating = rating !== undefined ? normalizeRating(rating) : existing.rating;
    if (Number.isNaN(parsedRating)) {
      return res.status(400).json({ error: 'Rating must be an integer between 1 and 10 or null' });
    }

    const cleanNote = note !== undefined ? (note === '' ? null : note) : existing.note;
    const nextStatus = status || existing.status;

    db.prepare(
      `
      UPDATE user_albums SET
        status = ?, rating = ?, note = ?,
        recommended_by_user_id = NULL, pending_recommendation = 0, updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `
    ).run(nextStatus, parsedRating, cleanNote, id, userId);

    if (nextStatus !== 'listened') {
      removeAlbumFromFavorites(userId, existing.album_id);
    }

    if (Array.isArray(tracks)) syncTracksForUserAlbum(existing.id, tracks);

    const updated = db.prepare('SELECT * FROM user_albums WHERE id = ?').get(id);
    const savedTracks = db
      .prepare('SELECT * FROM user_album_tracks WHERE user_album_id = ? ORDER BY COALESCE(track_number, 999999) ASC')
      .all(id);
    res.json({ ...updated, tracks: savedTracks });
  } catch {
    res.status(500).json({ error: 'Failed to update user album' });
  }
});

router.delete('/user-albums/:id', (req, res) => {
  try {
    const existing = db
      .prepare('SELECT id, album_id FROM user_albums WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.user.id);

    if (!existing) return res.status(404).json({ error: 'User album not found' });

    db.prepare('DELETE FROM user_albums WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    removeAlbumFromFavorites(req.user.id, existing.album_id);

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete user album' });
  }
});

router.get('/user-albums', (req, res) => {
  try {
    res.json(queryUserAlbums(req.user.id, req.query));
  } catch {
    res.status(500).json({ error: 'Failed to get user albums' });
  }
});

router.get('/user-albums/user/:userId', (req, res) => {
  try {
    const currentUserId = req.user.id;
    const targetUserId = parseInt(req.params.userId, 10);

    const friendship = db
      .prepare(
        `
      SELECT id FROM friendships
      WHERE ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))
        AND status = 'accepted'
    `
      )
      .get(currentUserId, targetUserId, targetUserId, currentUserId);

    if (!friendship) {
      return res.status(403).json({ error: 'You must be friends to view their albums' });
    }

    res.json(queryUserAlbums(targetUserId, req.query));
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

    const friendship = db
      .prepare(
        `
      SELECT id FROM friendships
      WHERE ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))
        AND status = 'accepted'
    `
      )
      .get(userId, friend_id, friend_id, userId);

    if (!friendship) {
      return res.status(403).json({ error: 'Solo puedes recomendar álbumes a amigos' });
    }

    const album = db.prepare('SELECT id, title, artist FROM albums WHERE id = ?').get(album_id);
    if (!album) return res.status(404).json({ error: 'Álbum no encontrado' });

    const existingForFriend = db
      .prepare(
        `
      SELECT ua.id, ua.status
      FROM user_albums ua
      JOIN albums a ON a.id = ua.album_id
      WHERE ua.user_id = ?
        AND (
          ua.album_id = ?
          OR (
            LOWER(TRIM(a.title)) = LOWER(TRIM(?))
            AND LOWER(TRIM(a.artist)) = LOWER(TRIM(?))
          )
        )
    `
      )
      .get(friend_id, album_id, album.title, album.artist);

    if (existingForFriend?.status === 'listened') {
      return res.status(400).json({ error: 'Este usuario ya ha escuchado este álbum' });
    }

    if (existingForFriend) {
      db.prepare(
        `UPDATE user_albums
         SET recommended_by_user_id = ?, pending_recommendation = 1, updated_at = datetime('now')
         WHERE id = ?`
      ).run(userId, existingForFriend.id);
    } else {
      db.prepare(
        `INSERT INTO user_albums (user_id, album_id, status, recommended_by_user_id, pending_recommendation)
         VALUES (?, ?, 'to_listen', ?, 1)`
      ).run(friend_id, album_id, userId);
    }

    res.json({ success: true, message: 'Álbum recomendado con éxito' });
  } catch (err) {
    console.error('Error in POST /recommend:', err);
    res.status(500).json({ error: 'Failed to recommend album' });
  }
});

export default router;