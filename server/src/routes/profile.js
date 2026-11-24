import { Router } from 'express';
import db, {
  MAX_FAVORITE_ALBUMS,
  MAX_FAVORITE_TRACKS,
  resolveFavoriteAlbums,
  resolveFavoriteTracks,
} from '../db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();
router.use(authenticateToken);

const activeSyncJobs = new Map();
const TRACKLIST_DB_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

// Control de ritmo global para Last.fm (~4 req/s máx)
let lastLastfmCallAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeMusicText(str) {
  return String(str || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeTrackTitle(str) {
  const base = normalizeMusicText(str);
  const stripped = base
    .replace(
      /\s*[-–—]\s*(remaster(ed)?|deluxe|bonus track|live|mono|stereo|radio edit|single version|explicit|clean).*$/i,
      ''
    )
    .replace(
      /\s*\((remaster(ed)?|deluxe|bonus track|live|mono|stereo|radio edit|single version|explicit|clean|feat\.?[^)]*|ft\.?[^)]*)\)\s*/gi,
      ' '
    )
    .replace(
      /\s*\[(remaster(ed)?|deluxe|bonus track|live|mono|stereo|radio edit|single version|explicit|clean|feat\.?[^\]]*|ft\.?[^\]]*)\]\s*/gi,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length >= 2 ? stripped : base;
}

function sanitizeAvatarUrl(raw) {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  if (trimmed.length > 90000) {
    return { error: 'La imagen es demasiado grande. Elige una más ligera.' };
  }

  const isHttp = /^https?:\/\/.+/i.test(trimmed);
  const isDataImage = /^data:image\/(jpeg|jpg|png|webp|gif);base64,[a-z0-9+/=]+$/i.test(trimmed);

  if (!isHttp && !isDataImage) {
    return { error: 'Formato de imagen no válido. Usa una foto o URL http/https.' };
  }

  return trimmed;
}

function sanitizeOptionalCoverUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 90000) return null;
  if (/^https?:\/\/.+/i.test(trimmed) || /^data:image\/(jpeg|jpg|png|webp|gif);base64,[a-z0-9+/=]+$/i.test(trimmed)) {
    return trimmed;
  }
  return null;
}

async function fetchLastfmWithRetry(url, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const wait = 240 - (Date.now() - lastLastfmCallAt);
    if (wait > 0) await sleep(wait);
    lastLastfmCallAt = Date.now();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.status === 429) {
        await sleep(3000 * (attempt + 1));
        continue;
      }

      if (!res.ok) {
        if (res.status >= 500 && attempt < retries) {
          await sleep(1500 * (attempt + 1));
          continue;
        }
        return null;
      }

      const data = await res.json().catch(() => null);
      if (data?.error === 29) {
        // Last.fm Rate Limit Exceeded
        await sleep(3500 * (attempt + 1));
        continue;
      }

      return data;
    } catch {
      clearTimeout(timeoutId);
      if (attempt < retries) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      return null;
    }
  }
  return null;
}

async function getLastfmAlbumTracksPersistent(artist, albumTitle, apiKey) {
  const artistNorm = normalizeMusicText(artist);
  const albumNorm = normalizeMusicText(albumTitle);
  if (!artistNorm || !albumNorm) return null;

  const cachedRow = db
    .prepare('SELECT tracks_json, updated_at FROM album_tracklists_cache WHERE artist_norm = ? AND album_norm = ?')
    .get(artistNorm, albumNorm);

  if (cachedRow) {
    const updatedMs = Date.parse(`${cachedRow.updated_at}Z`) || 0;
    if (Date.now() - updatedMs < TRACKLIST_DB_TTL_MS) {
      try {
        const parsed = JSON.parse(cachedRow.tracks_json);
        return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
      } catch {
        // Re-fetch if corrupted
      }
    }
  }

  const url = `https://ws.audioscrobbler.com/2.0/?method=album.getinfo&api_key=${encodeURIComponent(
    apiKey
  )}&artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(albumTitle)}&format=json`;

  const data = await fetchLastfmWithRetry(url, 2);
  let names = [];

  if (data && !data.error && data.album?.tracks?.track) {
    let rawTracks = data.album.tracks.track;
    if (!Array.isArray(rawTracks)) rawTracks = [rawTracks];

    names = rawTracks
      .map((t) => (typeof t === 'string' ? t : t?.name))
      .map((name) => (name || '').trim())
      .filter(Boolean);
  }

  db.prepare(
    `INSERT INTO album_tracklists_cache (artist_norm, album_norm, tracks_json, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(artist_norm, album_norm) DO UPDATE SET
       tracks_json = excluded.tracks_json,
       updated_at = datetime('now')`
  ).run(artistNorm, albumNorm, JSON.stringify(names));

  return names.length > 0 ? names : null;
}

async function runLastfmBackgroundSync(userId, lastfmUser, apiKey) {
  const job = activeSyncJobs.get(userId);
  if (!job) return;

  try {
    const userRow = db
      .prepare('SELECT lastfm_last_sync_uts, lastfm_synced_user FROM users WHERE id = ?')
      .get(userId);

    const normalizedUser = lastfmUser.toLowerCase().trim();
    const isSameLastfmAccount =
      (userRow?.lastfm_synced_user || '').toLowerCase().trim() === normalizedUser;

    let lastSyncUts = isSameLastfmAccount ? Number(userRow?.lastfm_last_sync_uts || 0) : 0;

    if (!isSameLastfmAccount) {
      db.prepare('DELETE FROM user_lastfm_tracks WHERE user_id = ?').run(userId);
      db.prepare('UPDATE users SET lastfm_last_sync_uts = 0, lastfm_synced_user = ? WHERE id = ?').run(
        normalizedUser,
        userId
      );
    }

    const collectedAlbums = new Map();
    const addAlbumEntry = (title, artist, mbid, coverUrl, playcount = 1) => {
      if (!title || !artist || title === '(null)' || artist === '(null)') return;
      const artistNorm = normalizeMusicText(artist);
      const albumNorm = normalizeMusicText(title);
      if (!artistNorm || !albumNorm) return;

      const key = `${artistNorm}:::${albumNorm}`;
      if (!collectedAlbums.has(key)) {
        collectedAlbums.set(key, {
          title: title.trim(),
          artist: artist.trim(),
          artistNorm,
          albumNorm,
          externalId: mbid && mbid.length > 10 ? mbid : `lastfm-${artist.trim()}-${title.trim()}`,
          coverUrl: coverUrl || null,
          playcount: Number(playcount) || 1,
        });
      } else {
        const existing = collectedAlbums.get(key);
        if (!existing.coverUrl && coverUrl) existing.coverUrl = coverUrl;
        if (Number(playcount) > existing.playcount) existing.playcount = Number(playcount);
      }
    };

    // FASE 1: Obtener todos los álbumes históricos mediante user.gettopalbums
    job.phase = 'albums';
    job.message = 'Obteniendo catálogo de álbumes de Last.fm...';

    let albumPage = 1;
    let albumTotalPages = 1;
    const maxAlbumPages = 40;

    while (albumPage <= albumTotalPages && albumPage <= maxAlbumPages) {
      const topUrl = `https://ws.audioscrobbler.com/2.0/?method=user.gettopalbums&user=${encodeURIComponent(
        lastfmUser
      )}&api_key=${encodeURIComponent(apiKey)}&format=json&limit=500&page=${albumPage}`;

      const data = await fetchLastfmWithRetry(topUrl);
      if (!data || data.error) {
        if (albumPage === 1) {
          throw new Error(data?.message || 'No se pudo leer el perfil de Last.fm');
        }
        break;
      }

      const attr = data?.topalbums?.['@attr'];
      if (attr?.totalPages) {
        albumTotalPages = parseInt(attr.totalPages, 10) || 1;
      }

      job.albums_page = albumPage;
      job.albums_total_pages = albumTotalPages;
      job.message = `Leyendo álbumes (página ${albumPage} de ${albumTotalPages})...`;

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
          addAlbumEntry(alb.name, artistName, alb.mbid, cover, playcount || 1);
        }
      }

      if (!hasValidPlaycount) break;
      albumPage++;
    }

    // FASE 2: Recorrer historial de reproducciones (completo la 1ª vez, incremental después)
    job.phase = 'tracks';
    job.message =
      lastSyncUts > 0
        ? 'Buscando nuevas canciones reproducidas...'
        : 'Analizando historial completo de canciones (puede tardar un par de minutos)...';

    const syncUpperUts = Math.floor(Date.now() / 1000);
    const fromParam = lastSyncUts > 0 ? `&from=${lastSyncUts + 1}` : '';
    const toParam = `&to=${syncUpperUts}`;

    let trackPage = 1;
    let trackTotalPages = 1;
    const maxTrackPages = 500; // Hasta 100.000 scrobbles en el archivo completo
    let maxUtsSeen = lastSyncUts;
    const newTrackBatches = new Map();

    while (trackPage <= trackTotalPages && trackPage <= maxTrackPages) {
      const recentUrl = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${encodeURIComponent(
        lastfmUser
      )}&api_key=${encodeURIComponent(apiKey)}&format=json&limit=200&page=${trackPage}${fromParam}${toParam}`;

      const recentData = await fetchLastfmWithRetry(recentUrl);
      if (!recentData || recentData.error) break;

      const rAttr = recentData?.recenttracks?.['@attr'];
      if (rAttr?.totalPages) {
        trackTotalPages = Math.min(maxTrackPages, parseInt(rAttr.totalPages, 10) || 1);
      }

      job.tracks_page = trackPage;
      job.tracks_total_pages = trackTotalPages;
      job.message =
        lastSyncUts > 0
          ? `Sincronizando nuevas escuchas (pág. ${trackPage}/${trackTotalPages})...`
          : `Leyendo archivo histórico (pág. ${trackPage}/${trackTotalPages} · ${job.tracks_fetched} canciones)...`;

      let tracks = recentData?.recenttracks?.track || [];
      if (!Array.isArray(tracks)) tracks = [tracks];
      if (tracks.length === 0) break;

      for (const t of tracks) {
        if (t?.['@attr']?.nowplaying === 'true') continue;

        const uts = parseInt(t?.date?.uts || '0', 10);
        if (uts > maxUtsSeen) maxUtsSeen = uts;

        const albumName = (t.album?.['#text'] || '').trim();
        const artistName = (
          typeof t.artist === 'object' ? t.artist?.['#text'] || t.artist?.name : t.artist || ''
        ).trim();
        const trackTitle = (t.name || '').trim();
        const cover = t.image?.find?.((i) => i.size === 'large' || i.size === 'extralarge')?.['#text'];

        if (!artistName || !albumName || !trackTitle) continue;

        job.tracks_fetched += 1;
        addAlbumEntry(albumName, artistName, t.album?.mbid, cover, 1);

        const artistNorm = normalizeMusicText(artistName);
        const albumNorm = normalizeMusicText(albumName);
        const trackNorm = normalizeTrackTitle(trackTitle);
        const tKey = `${artistNorm}:::${albumNorm}:::${trackNorm}`;

        if (!newTrackBatches.has(tKey)) {
          newTrackBatches.set(tKey, {
            artistNorm,
            albumNorm,
            trackNorm,
            trackTitle,
            count: 1,
            lastUts: uts,
          });
        } else {
          const item = newTrackBatches.get(tKey);
          item.count += 1;
          if (uts > item.lastUts) item.lastUts = uts;
        }
      }

      trackPage++;
    }

    // Guardar las nuevas canciones en el histórico acumulado del usuario
    if (newTrackBatches.size > 0) {
      const upsertLastfmTrack = db.prepare(`
        INSERT INTO user_lastfm_tracks (user_id, artist_norm, album_norm, track_norm, track_title, play_count, last_played_uts)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, artist_norm, album_norm, track_norm) DO UPDATE SET
          play_count = play_count + excluded.play_count,
          last_played_uts = MAX(last_played_uts, excluded.last_played_uts)
      `);

      db.transaction(() => {
        for (const item of newTrackBatches.values()) {
          upsertLastfmTrack.run(
            userId,
            item.artistNorm,
            item.albumNorm,
            item.trackNorm,
            item.trackTitle,
            item.count,
            item.lastUts
          );
        }
      })();
    }

    db.prepare('UPDATE users SET lastfm_last_sync_uts = ?, lastfm_synced_user = ? WHERE id = ?').run(
      maxUtsSeen,
      normalizedUser,
      userId
    );

    // Cargar TODO el archivo histórico de canciones del usuario desde SQLite
    const allSavedTracks = db
      .prepare('SELECT artist_norm, album_norm, track_norm, track_title FROM user_lastfm_tracks WHERE user_id = ?')
      .all(userId);

    const lifetimeTracksByAlbum = new Map();
    for (const row of allSavedTracks) {
      const key = `${row.artist_norm}:::${row.album_norm}`;
      if (!lifetimeTracksByAlbum.has(key)) lifetimeTracksByAlbum.set(key, new Set());
      lifetimeTracksByAlbum.get(key).add(row.track_norm);
      addAlbumEntry(row.album_norm, row.artist_norm, null, null, 1);
    }

    // FASE 3: Comprobar tracklists oficiales y clasificar Escuchado vs Parcial
    job.phase = 'analyzing';
    job.tracklists_total = collectedAlbums.size;
    job.tracklists_checked = 0;

    const albumDecisions = new Map();

    for (const [key, item] of collectedAlbums.entries()) {
      job.tracklists_checked += 1;
      if (job.tracklists_checked % 10 === 0 || job.tracklists_checked === job.tracklists_total) {
        job.message = `Verificando canciones por álbum (${job.tracklists_checked}/${job.tracklists_total})...`;
      }

      const scrobbledSet = lifetimeTracksByAlbum.get(key) || new Set();
      let officialTracks = null;

      if (scrobbledSet.size > 0) {
        officialTracks = await getLastfmAlbumTracksPersistent(item.artist, item.title, apiKey);
      }

      let status = 'listened';
      let matchedCount = 0;

      if (officialTracks && officialTracks.length > 0 && scrobbledSet.size > 0) {
        for (const tName of officialTracks) {
          if (scrobbledSet.has(normalizeTrackTitle(tName))) {
            matchedCount++;
          }
        }

        if (matchedCount >= officialTracks.length) {
          status = 'listened';
        } else if (matchedCount > 0) {
          status = 'partially_listened';
        } else {
          status = 'listened';
        }
      }

      albumDecisions.set(key, {
        status,
        officialTracks,
        scrobbledSet,
        matchedCount,
      });
    }

    // FASE 4: Guardar/actualizar en albums, user_albums y user_album_tracks sin perder datos manuales
    job.phase = 'saving';
    job.message = 'Guardando cambios en tu biblioteca...';

    let imported = 0;
    let updated = 0;
    let partialCount = 0;

    const insertAlbum = db.prepare(
      'INSERT OR IGNORE INTO albums (external_id, source, title, artist, year, cover_url) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const getAlbumByExt = db.prepare('SELECT id, cover_url FROM albums WHERE external_id = ? AND source = ?');
    const updateAlbumCover = db.prepare('UPDATE albums SET cover_url = ? WHERE id = ? AND cover_url IS NULL');

    const getExistingUserAlbum = db.prepare(`
      SELECT ua.id, ua.album_id, ua.status, ua.rating, ua.note, ua.pending_recommendation
      FROM user_albums ua
      JOIN albums a ON a.id = ua.album_id
      WHERE ua.user_id = ?
        AND (
          ua.album_id = ?
          OR (LOWER(TRIM(a.artist)) = ? AND LOWER(TRIM(a.title)) = ?)
        )
      LIMIT 1
    `);

    const insertUserAlbum = db.prepare(
      'INSERT INTO user_albums (user_id, album_id, status, pending_recommendation) VALUES (?, ?, ?, 0)'
    );
    const updateUserAlbumStatus = db.prepare(
      "UPDATE user_albums SET status = ?, pending_recommendation = 0, updated_at = datetime('now') WHERE id = ?"
    );
    const getExistingTracks = db.prepare(
      'SELECT track_title, listened FROM user_album_tracks WHERE user_album_id = ?'
    );
    const deleteTracks = db.prepare('DELETE FROM user_album_tracks WHERE user_album_id = ?');
    const insertTrack = db.prepare(
      'INSERT OR REPLACE INTO user_album_tracks (user_album_id, track_title, track_number, listened) VALUES (?, ?, ?, ?)'
    );

    db.transaction(() => {
      for (const [key, item] of collectedAlbums.entries()) {
        insertAlbum.run(item.externalId, 'lastfm', item.title, item.artist, null, item.coverUrl);
        const dbAlbum = getAlbumByExt.get(item.externalId, 'lastfm');
        if (!dbAlbum) continue;

        if (!dbAlbum.cover_url && item.coverUrl) {
          updateAlbumCover.run(item.coverUrl, dbAlbum.id);
        }

        const decision = albumDecisions.get(key) || {
          status: 'listened',
          officialTracks: null,
          scrobbledSet: new Set(),
          matchedCount: 0,
        };

        const existing = getExistingUserAlbum.get(
          userId,
          dbAlbum.id,
          item.artistNorm,
          item.albumNorm
        );

        let userAlbumId;
        let finalStatus = decision.status;

        if (!existing) {
          const info = insertUserAlbum.run(userId, dbAlbum.id, decision.status);
          userAlbumId = info.lastInsertRowid;
          imported++;
        } else {
          userAlbumId = existing.id;
          const hasManualFeedback = existing.rating != null || Boolean(existing.note);

          if (existing.pending_recommendation === 1) {
            updateUserAlbumStatus.run(decision.status, existing.id);
            updated++;
          } else if (existing.status === 'to_listen') {
            updateUserAlbumStatus.run(decision.status, existing.id);
            updated++;
          } else if (existing.status === 'partially_listened' && decision.status === 'listened') {
            updateUserAlbumStatus.run('listened', existing.id);
            updated++;
          } else if (
            existing.status === 'listened' &&
            decision.status === 'partially_listened' &&
            !hasManualFeedback
          ) {
            updateUserAlbumStatus.run('partially_listened', existing.id);
            updated++;
          } else {
            finalStatus = existing.status;
          }
        }

        if (finalStatus === 'partially_listened') {
          partialCount++;
        }

        if (decision.officialTracks && decision.officialTracks.length > 0 && decision.matchedCount > 0) {
          const prevRows = getExistingTracks.all(userAlbumId);
          const prevCheckedSet = new Set(
            prevRows.filter((r) => r.listened === 1).map((r) => normalizeTrackTitle(r.track_title))
          );

          deleteTracks.run(userAlbumId);
          decision.officialTracks.forEach((trackName, idx) => {
            const norm = normalizeTrackTitle(trackName);
            const isListened =
              finalStatus === 'listened' ||
              decision.scrobbledSet.has(norm) ||
              prevCheckedSet.has(norm)
                ? 1
                : 0;
            insertTrack.run(userAlbumId, trackName, idx + 1, isListened);
          });
        }
      }
    })();

    job.status = 'completed';
    job.phase = 'done';
    job.imported = imported;
    job.updated = updated;
    job.partially_listened = partialCount;
    job.total_found = collectedAlbums.size;
    job.finished_at = Date.now();
    job.message = `Sincronización completada: ${collectedAlbums.size} álbumes (${imported} nuevos${
      partialCount > 0 ? `, ${partialCount} parciales` : ''
    })`;
  } catch (err) {
    console.error('Background Last.fm sync error:', err);
    job.status = 'error';
    job.finished_at = Date.now();
    job.error = err.message || 'Error al sincronizar con Last.fm';
    job.message = job.error;
  }
}

router.get('/', (req, res) => {
  try {
    const userId = req.user.id;

    const user = db.prepare(
      'SELECT id, username, display_name, lastfm_username, avatar_url, created_at FROM users WHERE id = ?'
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
      favorite_tracks: resolveFavoriteTracks(userId),
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
    const { display_name, lastfm_username, avatar_url } = req.body;

    const current = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!current) return res.status(404).json({ error: 'User not found' });

    const cleanAvatar = sanitizeAvatarUrl(avatar_url);
    if (cleanAvatar && typeof cleanAvatar === 'object' && cleanAvatar.error) {
      return res.status(400).json({ error: cleanAvatar.error });
    }

    db.prepare(`
      UPDATE users SET display_name = ?, lastfm_username = ?, avatar_url = ? WHERE id = ?
    `).run(
      display_name !== undefined ? display_name : current.display_name,
      lastfm_username !== undefined ? lastfm_username : current.lastfm_username,
      cleanAvatar !== undefined ? cleanAvatar : current.avatar_url,
      userId
    );

    const updated = db.prepare(
      'SELECT id, username, display_name, lastfm_username, avatar_url, created_at FROM users WHERE id = ?'
    ).get(userId);

    res.json({
      ...updated,
      favorite_albums: resolveFavoriteAlbums(userId),
      favorite_tracks: resolveFavoriteTracks(userId),
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

    const uniqueIds = [...new Set(album_ids.map(Number).filter(Boolean))].slice(0, MAX_FAVORITE_ALBUMS);

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

router.get('/favorite-tracks', (req, res) => {
  try {
    res.json({ favorite_tracks: resolveFavoriteTracks(req.user.id) });
  } catch (err) {
    console.error('Error fetching favorite tracks:', err);
    res.status(500).json({ error: 'Failed to get favorite tracks' });
  }
});

router.put('/favorite-tracks', (req, res) => {
  try {
    const userId = req.user.id;
    const rawTracks = req.body?.tracks;

    if (!Array.isArray(rawTracks)) {
      return res.status(400).json({ error: 'tracks must be an array' });
    }

    const cleaned = [];
    const seen = new Set();

    for (const item of rawTracks) {
      const title = String(item?.track_title ?? item?.title ?? '').trim();
      const artist = String(item?.artist_name ?? item?.artist ?? '').trim();
      if (!title || !artist) continue;

      const dedupKey = `${normalizeTrackTitle(title)}:::${normalizeMusicText(artist)}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      const albumTitle = String(item?.album_title ?? item?.album ?? '').trim() || null;
      const coverUrl = sanitizeOptionalCoverUrl(item?.cover_url);

      cleaned.push({
        track_title: title,
        artist_name: artist,
        album_title: albumTitle,
        cover_url: coverUrl,
      });

      if (cleaned.length >= MAX_FAVORITE_TRACKS) break;
    }

    const deleteAll = db.prepare('DELETE FROM favorite_tracks WHERE user_id = ?');
    const insertTrack = db.prepare(
      `INSERT INTO favorite_tracks (user_id, position, track_title, artist_name, album_title, cover_url)
       VALUES (?, ?, ?, ?, ?, ?)`
    );

    db.transaction(() => {
      deleteAll.run(userId);
      cleaned.forEach((track, idx) => {
        insertTrack.run(
          userId,
          idx + 1,
          track.track_title,
          track.artist_name,
          track.album_title,
          track.cover_url
        );
      });
    })();

    res.json({ favorite_tracks: resolveFavoriteTracks(userId) });
  } catch (err) {
    console.error('Error updating favorite tracks:', err);
    res.status(500).json({ error: 'Failed to update favorite tracks' });
  }
});

router.get('/sync-lastfm/status', (req, res) => {
  const job = activeSyncJobs.get(req.user.id);
  if (!job) {
    return res.json({ status: 'idle' });
  }
  res.json(job);
});

router.post('/sync-lastfm', (req, res) => {
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

    const existingJob = activeSyncJobs.get(userId);
    if (existingJob && existingJob.status === 'running') {
      return res.status(202).json({ started: true, already_running: true, job: existingJob });
    }

    const job = {
      status: 'running',
      phase: 'albums',
      message: 'Iniciando sincronización con Last.fm...',
      albums_page: 0,
      albums_total_pages: 0,
      tracks_page: 0,
      tracks_total_pages: 0,
      tracks_fetched: 0,
      tracklists_checked: 0,
      tracklists_total: 0,
      imported: 0,
      updated: 0,
      partially_listened: 0,
      total_found: 0,
      started_at: Date.now(),
      finished_at: null,
      error: null,
    };

    activeSyncJobs.set(userId, job);

    setImmediate(() => {
      runLastfmBackgroundSync(userId, user.lastfm_username.trim(), apiKey);
    });

    res.status(202).json({ started: true, job });
  } catch (err) {
    console.error('Last.fm sync trigger error:', err);
    res.status(500).json({ error: 'Failed to start Last.fm sync' });
  }
});

export default router;