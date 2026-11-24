import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import * as api from '../api';
import AlbumCard, { AlbumCover } from '../components/AlbumCard';
import AlbumDetail from '../components/AlbumDetail';
import UserAvatar from '../components/UserAvatar';
import {
  IconLogout,
  IconEdit,
  IconPalette,
  IconRadio,
  IconRefresh,
  IconDisc,
  IconStar,
  IconCheck,
  IconSpinner,
  IconArrowLeft,
  IconArrowRight,
  IconSearch,
  IconClose,
  IconMusic,
  IconPlus,
  IconHeart,
} from '../components/Icons';

const PAGE_SIZE = 24;
const MAX_FAVORITE_ALBUMS = 10;
const MAX_FAVORITE_TRACKS = 10;

function compressAvatarFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxSide = 256;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error('No se pudo procesar la imagen seleccionada'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });
}

function trackKey(title, artist) {
  return `${String(title || '').trim().toLowerCase()}:::${String(artist || '').trim().toLowerCase()}`;
}

export default function Profile() {
  const { user, logout, updateUser } = useAuth();
  const { theme, setTheme, themes } = useTheme();

  const [profile, setProfile] = useState(null);
  const [tab, setTab] = useState('listened'); // 'listened' | 'partially_listened' | 'to_listen'
  const [sortBy, setSortBy] = useState('recent');
  const [filterQuery, setFilterQuery] = useState('');
  const [page, setPage] = useState(1);
  const [albums, setAlbums] = useState([]);
  const [friends, setFriends] = useState([]);
  const [loading, setLoading] = useState(true);

  // Edición de nombre visible
  const [editing, setEditing] = useState(false);
  const [displayNameInput, setDisplayNameInput] = useState('');
  const [savingName, setSavingName] = useState(false);

  // Edición de foto de perfil
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const [avatarDraft, setAvatarDraft] = useState('');
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const avatarFileInputRef = useRef(null);

  // Last.fm
  const [lastfmInput, setLastfmInput] = useState('');
  const [savingLastfm, setSavingLastfm] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncJob, setSyncJob] = useState(null);
  const [syncMessage, setSyncMessage] = useState(null);

  // Top 10 álbumes favoritos
  const [favoriteIds, setFavoriteIds] = useState([]);
  const [favModalOpen, setFavModalOpen] = useState(false);
  const [favSearchQuery, setFavSearchQuery] = useState('');
  const [draftFavIds, setDraftFavIds] = useState([]);
  const [savingFavorites, setSavingFavorites] = useState(false);

  // Top 10 canciones favoritas
  const [favoriteTracks, setFavoriteTracks] = useState([]);
  const [trackModalOpen, setTrackModalOpen] = useState(false);
  const [trackSearchQuery, setTrackSearchQuery] = useState('');
  const [draftTracks, setDraftTracks] = useState([]);
  const [customTrackTitle, setCustomTrackTitle] = useState('');
  const [customTrackArtist, setCustomTrackArtist] = useState('');
  const [savingTracks, setSavingTracks] = useState(false);

  // Modales
  const [themeModalOpen, setThemeModalOpen] = useState(false);
  const [selectedAlbum, setSelectedAlbum] = useState(null);

  const loadData = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    Promise.all([
      api.getProfile().catch(() => null),
      api.getUserAlbums().catch(() => []),
      api.getFriends().catch(() => []),
    ]).then(([p, a, f]) => {
      setProfile(p);
      setAlbums(a || []);
      setFriends(f || []);
      if (p) {
        setDisplayNameInput(p.display_name || '');
        setLastfmInput(p.lastfm_username || '');
        const initialFavIds = Array.isArray(p.favorite_albums)
          ? p.favorite_albums
              .map((item) => Number(item.id || item.album_id))
              .filter(Boolean)
              .slice(0, MAX_FAVORITE_ALBUMS)
          : [];
        setFavoriteIds(initialFavIds);
        setFavoriteTracks(
          Array.isArray(p.favorite_tracks)
            ? p.favorite_tracks.slice(0, MAX_FAVORITE_TRACKS)
            : []
        );
      }
      if (!silent) setLoading(false);
    });
  }, []);

  useEffect(() => {
    loadData(false);
  }, [loadData]);

  // Consultar estado de sincronización en segundo plano si está activo
  useEffect(() => {
    let timer = null;
    const pollSyncStatus = async () => {
      try {
        const statusFn = api.getLastfmSyncStatus || api.getSyncLastfmStatus;
        if (!statusFn) return;
        const job = await statusFn();
        if (!job || job.status === 'idle') return;

        setSyncJob(job);
        if (job.status === 'running') {
          setSyncing(true);
          timer = setTimeout(pollSyncStatus, 1800);
        } else if (job.status === 'completed') {
          setSyncing(false);
          setSyncMessage({
            type: 'success',
            text: job.message || 'Sincronización con Last.fm completada',
          });
          loadData(true);
        } else if (job.status === 'error') {
          setSyncing(false);
          setSyncMessage({
            type: 'error',
            text: job.error || 'Error al sincronizar con Last.fm',
          });
        }
      } catch {
        // Ignorar errores puntuales de polling
      }
    };

    pollSyncStatus();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [loadData]);

  // Cerrar modales con Escape
  useEffect(() => {
    if (!themeModalOpen && !favModalOpen && !trackModalOpen && !avatarModalOpen) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        setThemeModalOpen(false);
        setFavModalOpen(false);
        setTrackModalOpen(false);
        setAvatarModalOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [themeModalOpen, favModalOpen, trackModalOpen, avatarModalOpen]);

  const listened = useMemo(() => albums.filter((a) => a.status === 'listened'), [albums]);
  const partiallyListened = useMemo(
    () => albums.filter((a) => a.status === 'partially_listened'),
    [albums]
  );
  const toListen = useMemo(() => albums.filter((a) => a.status === 'to_listen'), [albums]);

  // Candidatos de canciones desde los álbumes escuchados/parciales del usuario
  const candidateTracks = useMemo(() => {
    const map = new Map();
    const sources = [...listened, ...partiallyListened];
    for (const alb of sources) {
      if (!Array.isArray(alb.tracks)) continue;
      for (const t of alb.tracks) {
        if (alb.status === 'partially_listened' && !t.listened) continue;
        const title = (typeof t === 'string' ? t : t?.track_title || t?.title || '').trim();
        const artist = (alb.artist || '').trim();
        if (!title || !artist) continue;
        const key = trackKey(title, artist);
        if (!map.has(key)) {
          map.set(key, {
            track_title: title,
            artist_name: artist,
            album_title: alb.title || null,
            cover_url: alb.cover_url || null,
          });
        }
      }
    }
    return Array.from(map.values());
  }, [listened, partiallyListened]);

  const filteredCandidateTracks = useMemo(() => {
    const q = trackSearchQuery.trim().toLowerCase();
    if (!q) return candidateTracks;
    return candidateTracks.filter(
      (t) =>
        t.track_title.toLowerCase().includes(q) ||
        t.artist_name.toLowerCase().includes(q) ||
        (t.album_title && t.album_title.toLowerCase().includes(q))
    );
  }, [candidateTracks, trackSearchQuery]);

  // Estadísticas limpias: Colección total, Artistas únicos, Nota media, Top 5 Artistas y Distribución 1-10
  const stats = useMemo(() => {
    let ratingSum = 0;
    let ratedCount = 0;
    const artistMap = new Map();
    const scoreBuckets = Array.from({ length: 10 }, (_, idx) => ({
      score: idx + 1,
      count: 0,
    }));

    for (const a of albums) {
      const hasRating = a.rating != null && Number(a.rating) >= 1 && Number(a.rating) <= 10;
      const numericRating = hasRating ? Math.round(Number(a.rating)) : null;

      if (hasRating) {
        ratingSum += Number(a.rating);
        ratedCount += 1;
        scoreBuckets[numericRating - 1].count += 1;
      }

      if (a.artist) {
        const norm = a.artist.trim().toLowerCase();
        if (!artistMap.has(norm)) {
          artistMap.set(norm, {
            name: a.artist.trim(),
            count: 0,
            heardCount: 0,
            ratingSum: 0,
            ratedCount: 0,
          });
        }
        const entry = artistMap.get(norm);
        entry.count += 1;
        if (a.status === 'listened' || a.status === 'partially_listened') {
          entry.heardCount += 1;
        }
        if (hasRating) {
          entry.ratingSum += Number(a.rating);
          entry.ratedCount += 1;
        }
      }
    }

    const topArtists = Array.from(artistMap.values())
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        if (b.heardCount !== a.heardCount) return b.heardCount - a.heardCount;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      })
      .slice(0, 5)
      .map((item) => ({
        ...item,
        avgRating:
          item.ratedCount > 0 ? (item.ratingSum / item.ratedCount).toFixed(1) : null,
      }));

    const maxBucketCount = Math.max(1, ...scoreBuckets.map((b) => b.count));

    return {
      totalCollection: albums.length,
      uniqueArtists: artistMap.size,
      avgRating: ratedCount > 0 ? (ratingSum / ratedCount).toFixed(1) : '—',
      ratedCount,
      topArtists,
      scoreBuckets,
      maxBucketCount,
    };
  }, [albums]);

  // Resolver Top 10 álbumes favoritos
  const favoriteAlbums = useMemo(() => {
    const byAlbumId = new Map();
    for (const a of listened) {
      const realId = Number(a.album_id || a.id);
      if (realId) byAlbumId.set(realId, a);
    }
    return favoriteIds
      .map((id) => byAlbumId.get(Number(id)))
      .filter(Boolean)
      .slice(0, MAX_FAVORITE_ALBUMS);
  }, [favoriteIds, listened]);

  const filteredFavoriteCandidates = useMemo(() => {
    const q = favSearchQuery.trim().toLowerCase();
    if (!q) return listened;
    return listened.filter(
      (a) => a.title?.toLowerCase().includes(q) || a.artist?.toLowerCase().includes(q)
    );
  }, [listened, favSearchQuery]);

  const displayed = useMemo(() => {
    const base =
      tab === 'listened'
        ? listened
        : tab === 'partially_listened'
        ? partiallyListened
        : toListen;

    const q = filterQuery.trim().toLowerCase();
    const filtered = q
      ? base.filter((a) => {
          const inTitle = a.title?.toLowerCase().includes(q);
          const inArtist = a.artist?.toLowerCase().includes(q);
          const inNote = a.note?.toLowerCase().includes(q);
          const inRecommender = a.recommended_by?.toLowerCase().includes(q);
          const inTracks =
            Array.isArray(a.tracks) &&
            a.tracks.some((t) => t.track_title?.toLowerCase().includes(q));
          return inTitle || inArtist || inNote || inRecommender || inTracks;
        })
      : [...base];

    filtered.sort((a, b) => {
      if (sortBy === 'artist_asc') {
        const cmp = (a.artist || '').localeCompare(b.artist || '', undefined, {
          sensitivity: 'base',
        });
        return cmp !== 0
          ? cmp
          : (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' });
      }
      if (sortBy === 'title_asc') {
        return (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' });
      }
      if (sortBy === 'rating_desc') {
        const rA = a.rating ?? -1;
        const rB = b.rating ?? -1;
        if (rB !== rA) return rB - rA;
      }
      return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
    });

    return filtered;
  }, [tab, listened, partiallyListened, toListen, filterQuery, sortBy]);

  const totalPages = Math.ceil(displayed.length / PAGE_SIZE) || 1;
  const paginatedAlbums = displayed.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleTabChange = (newTab) => {
    setTab(newTab);
    setPage(1);
  };

  // Handlers de Avatar
  const openAvatarModal = () => {
    setAvatarDraft(profile?.avatar_url || user?.avatar_url || '');
    setAvatarError('');
    setAvatarModalOpen(true);
  };

  const handleAvatarFileSelected = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarError('');
    try {
      const compressedDataUrl = await compressAvatarFile(file);
      setAvatarDraft(compressedDataUrl);
    } catch (err) {
      setAvatarError(err.message || 'No se pudo cargar la imagen');
    }
  };

  const handleSaveAvatar = async (customUrl = avatarDraft) => {
    setSavingAvatar(true);
    setAvatarError('');
    try {
      const trimmed = customUrl ? customUrl.trim() : null;
      const updated = await api.updateProfile({
        display_name: profile?.display_name || user?.display_name,
        lastfm_username: profile?.lastfm_username || '',
        avatar_url: trimmed,
      });
      setProfile((prev) => ({ ...prev, ...updated }));
      updateUser({ ...user, avatar_url: updated?.avatar_url ?? trimmed });
      setAvatarModalOpen(false);
    } catch (err) {
      setAvatarError(err.message || 'Error al guardar la foto de perfil');
    } finally {
      setSavingAvatar(false);
    }
  };

  // Handlers de Favoritos (Álbumes hasta 10)
  const openFavoritesModal = () => {
    setDraftFavIds(
      favoriteAlbums.map((a) => Number(a.album_id || a.id)).slice(0, MAX_FAVORITE_ALBUMS)
    );
    setFavSearchQuery('');
    setFavModalOpen(true);
  };

  const toggleDraftFavorite = (albumId) => {
    const numId = Number(albumId);
    setDraftFavIds((prev) => {
      if (prev.includes(numId)) return prev.filter((id) => id !== numId);
      if (prev.length >= MAX_FAVORITE_ALBUMS) return prev;
      return [...prev, numId];
    });
  };

  const handleSaveFavorites = async () => {
    setSavingFavorites(true);
    try {
      const res = await api.updateFavorites(draftFavIds);
      const savedList = Array.isArray(res?.favorite_albums) ? res.favorite_albums : [];
      const nextIds =
        savedList.length > 0 || draftFavIds.length === 0
          ? savedList
              .map((a) => Number(a.id || a.album_id))
              .filter(Boolean)
              .slice(0, MAX_FAVORITE_ALBUMS)
          : draftFavIds.slice(0, MAX_FAVORITE_ALBUMS);

      setFavoriteIds(nextIds);
      setProfile((prev) => (prev ? { ...prev, favorite_albums: savedList } : prev));
      setFavModalOpen(false);
    } catch (err) {
      console.error('Error guardando favoritos:', err);
    } finally {
      setSavingFavorites(false);
    }
  };

  // Handlers de Canciones Favoritas (hasta 10)
  const openTrackModal = () => {
    setDraftTracks(
      favoriteTracks.slice(0, MAX_FAVORITE_TRACKS).map((t) => ({
        track_title: t.track_title,
        artist_name: t.artist_name,
        album_title: t.album_title || null,
        cover_url: t.cover_url || null,
      }))
    );
    setTrackSearchQuery('');
    setCustomTrackTitle('');
    setCustomTrackArtist('');
    setTrackModalOpen(true);
  };

  const toggleDraftTrack = (candidate) => {
    const key = trackKey(candidate.track_title, candidate.artist_name);
    setDraftTracks((prev) => {
      const exists = prev.some(
        (item) => trackKey(item.track_title, item.artist_name) === key
      );
      if (exists) {
        return prev.filter(
          (item) => trackKey(item.track_title, item.artist_name) !== key
        );
      }
      if (prev.length >= MAX_FAVORITE_TRACKS) return prev;
      return [...prev, candidate];
    });
  };

  const handleAddCustomTrack = (e) => {
    e?.preventDefault();
    const title = customTrackTitle.trim();
    const artist = customTrackArtist.trim();
    if (!title || !artist) return;
    if (draftTracks.length >= MAX_FAVORITE_TRACKS) return;

    const key = trackKey(title, artist);
    if (draftTracks.some((item) => trackKey(item.track_title, item.artist_name) === key)) {
      return;
    }

    setDraftTracks((prev) => [
      ...prev,
      {
        track_title: title,
        artist_name: artist,
        album_title: null,
        cover_url: null,
      },
    ]);
    setCustomTrackTitle('');
    setCustomTrackArtist('');
  };

  const handleSaveFavoriteTracks = async () => {
    setSavingTracks(true);
    try {
      const res = await api.updateFavoriteTracks(draftTracks.slice(0, MAX_FAVORITE_TRACKS));
      const saved = Array.isArray(res?.favorite_tracks)
        ? res.favorite_tracks.slice(0, MAX_FAVORITE_TRACKS)
        : [];
      setFavoriteTracks(saved);
      setProfile((prev) => (prev ? { ...prev, favorite_tracks: saved } : prev));
      setTrackModalOpen(false);
    } catch (err) {
      console.error('Error guardando canciones favoritas:', err);
    } finally {
      setSavingTracks(false);
    }
  };

  const handleSaveDisplayName = async () => {
    const cleanName = displayNameInput.trim();
    if (!cleanName) return;
    setSavingName(true);
    try {
      const updated = await api.updateProfile({
        display_name: cleanName,
        lastfm_username: profile?.lastfm_username || '',
      });
      setProfile((prev) => ({ ...prev, ...updated }));
      updateUser({ ...user, display_name: cleanName });
      setEditing(false);
    } catch (err) {
      console.error(err);
    } finally {
      setSavingName(false);
    }
  };

  const handleSaveLastfmUser = async () => {
    const cleanLastfm = lastfmInput.trim();
    setSavingLastfm(true);
    setSyncMessage(null);
    try {
      const updated = await api.updateProfile({
        display_name: profile?.display_name || user?.display_name || '',
        lastfm_username: cleanLastfm,
      });
      setProfile((prev) => ({ ...prev, ...updated }));
      updateUser({ ...user, lastfm_username: cleanLastfm });
      setSyncMessage({
        type: 'success',
        text: cleanLastfm
          ? `Usuario de Last.fm guardado (@${cleanLastfm}). Ya puedes sincronizar.`
          : 'Usuario de Last.fm desvinculado.',
      });
    } catch (err) {
      setSyncMessage({
        type: 'error',
        text: err.message || 'No se pudo guardar el usuario de Last.fm',
      });
    } finally {
      setSavingLastfm(false);
    }
  };

  const handleSync = async () => {
    const cleanLastfm = lastfmInput.trim();
    if (!cleanLastfm) {
      setSyncMessage({
        type: 'error',
        text: 'Introduce primero tu nombre de usuario de Last.fm.',
      });
      return;
    }

    setSyncing(true);
    setSyncMessage(null);
    try {
      if (cleanLastfm !== (profile?.lastfm_username || '').trim()) {
        const updated = await api.updateProfile({
          display_name: profile?.display_name || user?.display_name || '',
          lastfm_username: cleanLastfm,
        });
        setProfile((prev) => ({ ...prev, ...updated }));
        updateUser({ ...user, lastfm_username: cleanLastfm });
      }

      const res = await api.syncLastfm();
      if (res?.started && res?.job) {
        setSyncJob(res.job);
        const statusFn = api.getLastfmSyncStatus || api.getSyncLastfmStatus;
        const poll = async () => {
          try {
            if (!statusFn) return;
            const job = await statusFn();
            setSyncJob(job);
            if (job.status === 'running') {
              setTimeout(poll, 1800);
            } else if (job.status === 'completed') {
              setSyncing(false);
              setSyncMessage({
                type: 'success',
                text: job.message || 'Sincronización completada',
              });
              loadData(true);
            } else if (job.status === 'error') {
              setSyncing(false);
              setSyncMessage({
                type: 'error',
                text: job.error || 'Error al sincronizar con Last.fm',
              });
            }
          } catch {
            setSyncing(false);
          }
        };
        setTimeout(poll, 1500);
      } else {
        setSyncing(false);
        setSyncMessage({
          type: 'success',
          text:
            res.message ||
            `Sincronizados ${res.imported} nuevos álbumes (total: ${res.total_found || res.imported})`,
        });
        loadData(true);
      }
    } catch (err) {
      setSyncing(false);
      setSyncMessage({
        type: 'error',
        text: err.message || 'Error al sincronizar con Last.fm',
      });
    }
  };

  const handleAlbumAction = async (action) => {
    if (!selectedAlbum) return;

    if (action.type === 'recommend') {
      const targetAlbumId = selectedAlbum.album_id || selectedAlbum.id;
      await api.recommendAlbum({
        album_id: targetAlbumId,
        friend_id: action.friend_id,
      });
      return;
    }

    const uaId =
      selectedAlbum.user_album_id || (selectedAlbum.user_id ? selectedAlbum.id : null);
    if (uaId) {
      await api.updateUserAlbum(uaId, {
        status: action.status,
        rating: action.rating,
        note: action.note,
        tracks: action.tracks,
      });
    } else {
      const cached = await api.addAlbum({
        external_id: selectedAlbum.external_id || selectedAlbum.id?.toString(),
        source: selectedAlbum.source || 'musicbrainz',
        title: selectedAlbum.title,
        artist: selectedAlbum.artist,
        year: selectedAlbum.year,
        cover_url: selectedAlbum.cover_url,
      });
      await api.addUserAlbum({
        album_id: cached.id,
        status: action.status,
        rating: action.rating,
        note: action.note,
        tracks: action.tracks,
      });
    }
    window.dispatchEvent(new Event('recommendations-updated'));
    loadData(true);
  };

  const handleDeleteUserAlbum = async (targetUserAlbum) => {
    const uaId = targetUserAlbum?.user_album_id || targetUserAlbum?.id;
    if (!uaId) return;
    await api.deleteUserAlbum(uaId);
    loadData(true);
  };

  const activeThemeObj = themes.find((t) => t.id === theme) || themes[0];
  const darkThemes = themes.filter((t) => t.group === 'dark');
  const lightThemes = themes.filter((t) => t.group === 'light');
  const currentAvatar = profile?.avatar_url || user?.avatar_url || null;

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <IconSpinner className="w-7 h-7 text-primary" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* 1. Cabecera del usuario + Tema + Salir */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={openAvatarModal}
            className="relative group flex-shrink-0 rounded-full focus:outline-none"
            title="Cambiar foto de perfil"
          >
            <UserAvatar
              src={currentAvatar}
              name={profile?.display_name || user?.display_name}
              username={profile?.username || user?.username}
              className="w-12 h-12 text-base"
            />
            <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-primary text-white border-2 border-page flex items-center justify-center shadow-xs group-hover:scale-110 transition-transform">
              <IconEdit className="w-2.5 h-2.5" />
            </span>
          </button>

          <div className="min-w-0">
            <h2 className="text-base font-bold text-main truncate">
              {profile?.display_name || user?.display_name}
            </h2>
            <p className="text-xs text-muted truncate">
              @{profile?.username || user?.username}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            type="button"
            onClick={() => setThemeModalOpen(true)}
            className="px-2.5 py-2 rounded-xl bg-card hover:bg-cardhover border border-borderc text-main text-xs font-semibold transition-colors flex items-center gap-1.5 active:scale-95 shadow-xs"
            title="Cambiar tema de color"
          >
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0 border border-white/25"
              style={{ backgroundColor: activeThemeObj?.color }}
            />
            <IconPalette className="w-3.5 h-3.5 text-primary" />
            <span>Tema</span>
          </button>

          <button
            type="button"
            onClick={logout}
            className="px-2.5 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-semibold transition-colors flex items-center gap-1.5 active:scale-95"
          >
            <IconLogout className="w-3.5 h-3.5" />
            <span>Salir</span>
          </button>
        </div>
      </div>

      {/* 2. Resumen limpio de 3 KPIs: Colección, Artistas y Nota media */}
      <div className="grid grid-cols-3 gap-2.5">
        <div className="bg-card border border-borderc rounded-2xl p-3 text-center shadow-xs">
          <p className="text-xl font-extrabold text-primary leading-tight">
            {stats.totalCollection}
          </p>
          <p className="text-[11px] font-medium text-muted mt-0.5">Colección</p>
        </div>

        <div className="bg-card border border-borderc rounded-2xl p-3 text-center shadow-xs">
          <p className="text-xl font-extrabold text-main leading-tight">
            {stats.uniqueArtists}
          </p>
          <p className="text-[11px] font-medium text-muted mt-0.5">Artistas</p>
        </div>

        <div className="bg-card border border-borderc rounded-2xl p-3 text-center shadow-xs">
          <p className="text-xl font-extrabold text-main leading-tight flex items-center justify-center gap-1">
            <span>{stats.avgRating}</span>
            {stats.avgRating !== '—' && (
              <IconStar className="w-3.5 h-3.5 text-primary fill-current" />
            )}
          </p>
          <p className="text-[11px] font-medium text-muted mt-0.5">Nota media</p>
        </div>
      </div>

      {/* 3. Editar nombre visible */}
      {editing ? (
        <div className="bg-card border border-borderc rounded-2xl p-3.5 space-y-2.5 shadow-xs">
          <label className="text-[11px] font-semibold text-muted uppercase tracking-wider block">
            Nombre visible
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={displayNameInput}
              onChange={(e) => setDisplayNameInput(e.target.value)}
              placeholder="Tu nombre visible"
              className="flex-1 bg-inputbg border border-borderc rounded-xl px-3 py-2 text-xs text-main focus:outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDisplayNameInput(profile?.display_name || '');
              }}
              className="px-3 py-2 rounded-xl bg-inputbg hover:bg-cardhover border border-borderc text-xs text-muted font-semibold"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={savingName || !displayNameInput.trim()}
              onClick={handleSaveDisplayName}
              className="px-3.5 py-2 rounded-xl bg-primary hover:bg-primaryhover text-white text-xs font-bold disabled:opacity-50"
            >
              {savingName ? '...' : 'Guardar'}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="w-full py-2.5 rounded-xl bg-card hover:bg-cardhover border border-borderc text-xs text-main font-semibold transition-colors flex items-center justify-center gap-1.5 shadow-xs"
        >
          <IconEdit className="w-3.5 h-3.5 text-primary" />
          <span>Editar nombre</span>
        </button>
      )}

      {/* 4. Álbumes Favoritos (hasta 10) */}
      <div className="bg-card border border-borderc rounded-2xl p-4 space-y-3 shadow-xs">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-bold text-main uppercase tracking-wider flex items-center gap-1.5">
              <IconStar className="w-3.5 h-3.5 text-primary fill-current" />
              <span>Álbumes Favoritos</span>
            </h3>
            <p className="text-[11px] text-muted mt-0.5">
              Visibles para tus amigos ({favoriteAlbums.length}/{MAX_FAVORITE_ALBUMS})
            </p>
          </div>
          <button
            type="button"
            onClick={openFavoritesModal}
            className="px-3 py-1.5 rounded-xl bg-primarysubtle border border-primary/50 text-primary text-xs font-semibold hover:bg-primary hover:text-white transition-colors"
          >
            Elegir
          </button>
        </div>

        {favoriteAlbums.length > 0 ? (
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {favoriteAlbums.map((fav, idx) => (
              <button
                key={fav.album_id || fav.id || idx}
                type="button"
                onClick={() => setSelectedAlbum(fav)}
                className="group text-left bg-inputbg hover:bg-cardhover border border-borderc hover:border-primary rounded-xl p-1.5 transition-all active:scale-[0.98]"
                title={`${fav.title} — ${fav.artist}`}
              >
                <div className="relative mb-1.5">
                  <AlbumCover
                    src={fav.cover_url}
                    alt={fav.title}
                    className="w-full aspect-square rounded-lg"
                    imgClassName="group-hover:scale-105"
                    iconSize="w-5 h-5"
                  />
                  <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded-md bg-black/80 text-white text-[10px] font-bold">
                    #{idx + 1}
                  </span>
                </div>
                <p className="text-[11px] font-semibold text-main truncate group-hover:text-primary transition-colors">
                  {fav.title}
                </p>
                <p className="text-[10px] text-muted truncate">{fav.artist}</p>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted bg-inputbg/60 border border-borderc/60 rounded-xl p-3 text-center">
            Pulsa <strong className="text-main">Elegir</strong> para destacar hasta{' '}
            {MAX_FAVORITE_ALBUMS} álbumes de tu lista de escuchados.
          </p>
        )}
      </div>

      {/* 5. Top 10 Canciones Favoritas */}
      <div className="bg-card border border-borderc rounded-2xl p-4 space-y-3 shadow-xs">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-bold text-main uppercase tracking-wider flex items-center gap-1.5">
              <IconMusic className="w-3.5 h-3.5 text-primary" />
              <span>Top 10 Canciones Favoritas</span>
            </h3>
            <p className="text-[11px] text-muted mt-0.5">
              Visibles en tu perfil para tus amigos ({favoriteTracks.length}/
              {MAX_FAVORITE_TRACKS})
            </p>
          </div>
          <button
            type="button"
            onClick={openTrackModal}
            className="px-3 py-1.5 rounded-xl bg-primarysubtle border border-primary/50 text-primary text-xs font-semibold hover:bg-primary hover:text-white transition-colors"
          >
            Elegir
          </button>
        </div>

        {favoriteTracks.length > 0 ? (
          <div className="space-y-1.5">
            {favoriteTracks.map((trk, idx) => (
              <div
                key={trk.id || `${trk.track_title}-${idx}`}
                className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-inputbg/70 border border-borderc"
              >
                <span className="w-5 h-5 rounded-md bg-primarysubtle text-primary text-[11px] font-extrabold flex items-center justify-center flex-shrink-0">
                  {idx + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-main truncate">{trk.track_title}</p>
                  <p className="text-[11px] text-muted truncate">
                    {trk.artist_name}
                    {trk.album_title ? ` · ${trk.album_title}` : ''}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted bg-inputbg/60 border border-borderc/60 rounded-xl p-3 text-center">
            Pulsa <strong className="text-main">Elegir</strong> para seleccionar hasta{' '}
            {MAX_FAVORITE_TRACKS} canciones favoritas.
          </p>
        )}
      </div>

      {/* 6. Estadísticas detalladas: Top Artistas + Gráfico de Notas */}
      {stats.totalCollection > 0 && (
        <div className="bg-card border border-borderc rounded-2xl p-4 space-y-4 shadow-xs">
          {stats.topArtists.length > 0 && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold text-main uppercase tracking-wider">
                  Top artistas en tu colección
                </p>
                <span className="text-[11px] text-muted">Top {stats.topArtists.length}</span>
              </div>

              <div className="space-y-2">
                {stats.topArtists.map((artist, idx) => {
                  const maxArtistCount = stats.topArtists[0]?.count || 1;
                  const pct = Math.max(12, Math.round((artist.count / maxArtistCount) * 100));

                  return (
                    <div
                      key={artist.name}
                      className="p-2.5 rounded-xl bg-inputbg/70 border border-borderc space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`px-1.5 py-0.5 rounded-md text-[10px] font-extrabold flex-shrink-0 ${
                              idx === 0
                                ? 'bg-primary text-white'
                                : 'bg-primarysubtle text-primary'
                            }`}
                          >
                            #{idx + 1}
                          </span>
                          <span className="font-semibold text-main truncate">
                            {artist.name}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                          {artist.avgRating && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-card border border-borderc text-[10px] font-bold text-primary">
                              <IconStar className="w-2.5 h-2.5 fill-current" />
                              <span>{artist.avgRating}</span>
                            </span>
                          )}
                          <span className="text-[11px] font-bold text-muted">
                            {artist.count} {artist.count === 1 ? 'disco' : 'discos'}
                          </span>
                        </div>
                      </div>

                      <div className="h-1.5 w-full rounded-full bg-card overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Gráfico visual para medias y distribución de notas (1 a 10) */}
          <div className="space-y-2.5 pt-1 border-t border-borderc">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[11px] font-bold text-main uppercase tracking-wider">
                  Gráfico de puntuaciones
                </p>
                <p className="text-[11px] text-muted">
                  {stats.ratedCount}{' '}
                  {stats.ratedCount === 1 ? 'álbum valorado' : 'álbumes valorados'}
                </p>
              </div>

              <div className="px-2.5 py-1 rounded-xl bg-primarysubtle border border-primary/40 flex items-center gap-1.5">
                <IconStar className="w-3.5 h-3.5 text-primary fill-current" />
                <span className="text-xs font-extrabold text-primary">
                  Media: {stats.avgRating}
                </span>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-inputbg/70 border border-borderc">
              <div className="relative h-[104px] flex items-end justify-between gap-1.5">
                {/* Líneas guía horizontales */}
                <div className="pointer-events-none absolute inset-x-0 bottom-[38px] border-t border-dashed border-borderc/60" />
                <div className="pointer-events-none absolute inset-x-0 bottom-[76px] border-t border-dashed border-borderc/60" />

                {stats.scoreBuckets.map((bucket) => {
                  const count = Number(bucket.count) || 0;
                  const maxCount = Math.max(1, Number(stats.maxBucketCount) || 1);
                  const maxBarPx = 76;
                  const barPx =
                    count > 0 ? Math.max(16, Math.round((count / maxCount) * maxBarPx)) : 0;

                  const barColor =
                    bucket.score >= 9
                      ? 'var(--color-primary, #f59e0b)'
                      : bucket.score >= 7
                      ? 'var(--color-primary, #eab308)'
                      : bucket.score >= 5
                      ? '#f59e0b'
                      : '#38bdf8';

                  return (
                    <div
                      key={bucket.score}
                      className="relative z-10 flex-1 h-full flex flex-col items-center justify-end"
                      title={`Nota ${bucket.score}: ${count} ${
                        count === 1 ? 'álbum' : 'álbumes'
                      }`}
                    >
                      {count > 0 && (
                        <span className="text-[10px] font-bold text-main leading-none mb-1">
                          {count}
                        </span>
                      )}

                      {count > 0 ? (
                        <div
                          className="w-full max-w-[22px] rounded-t-md transition-all duration-300"
                          style={{
                            height: `${barPx}px`,
                            backgroundColor: barColor,
                            opacity: bucket.score >= 7 && bucket.score < 9 ? 0.8 : 1,
                          }}
                        />
                      ) : (
                        <div className="w-full max-w-[22px] h-[3px] rounded-full bg-borderc/40" />
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Etiquetas del 1 al 10 */}
              <div className="flex items-center justify-between gap-1.5 pt-1.5 mt-1 border-t border-borderc">
                {stats.scoreBuckets.map((bucket) => {
                  const hasAlbums = (Number(bucket.count) || 0) > 0;
                  return (
                    <span
                      key={`label-${bucket.score}`}
                      className={`flex-1 text-center text-[10px] font-bold ${
                        hasAlbums ? 'text-main' : 'text-muted/60'
                      }`}
                    >
                      {bucket.score}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 7. Sincronización con Last.fm */}
      <div className="bg-card border border-borderc rounded-2xl p-4 space-y-3 shadow-xs">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-primarysubtle text-primary flex items-center justify-center flex-shrink-0">
              <IconRadio className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-xs font-bold text-main">Sincronización con Last.fm</h3>
              <p className="text-[11px] text-muted truncate">
                {profile?.lastfm_username
                  ? `Conectado como @${profile.lastfm_username}`
                  : 'Importa tus álbumes escuchados y parciales'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleSync}
            disabled={syncing || !lastfmInput.trim()}
            className="px-3 py-1.5 rounded-xl bg-primary hover:bg-primaryhover disabled:opacity-50 text-white text-xs font-semibold transition-colors flex items-center gap-1.5 flex-shrink-0 active:scale-95 shadow-xs"
          >
            {syncing ? (
              <IconSpinner className="w-3.5 h-3.5" />
            ) : (
              <IconRefresh className="w-3.5 h-3.5" />
            )}
            <span>{syncing ? 'Sincronizando...' : 'Sincronizar'}</span>
          </button>
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={lastfmInput}
            onChange={(e) => setLastfmInput(e.target.value)}
            placeholder="Tu usuario de Last.fm"
            className="flex-1 bg-inputbg border border-borderc rounded-xl px-3 py-2 text-xs text-main placeholder-muted focus:outline-none focus:border-primary"
          />
          {lastfmInput.trim() !== (profile?.lastfm_username || '').trim() && (
            <button
              type="button"
              disabled={savingLastfm}
              onClick={handleSaveLastfmUser}
              className="px-3 py-2 rounded-xl bg-inputbg hover:bg-cardhover border border-borderc text-xs font-semibold text-main transition-colors"
            >
              {savingLastfm ? '...' : 'Guardar'}
            </button>
          )}
        </div>

        {syncing && syncJob && (
          <div className="p-2.5 rounded-xl bg-inputbg/70 border border-borderc space-y-1.5">
            <p className="text-[11px] text-main font-medium">
              {syncJob.message || 'Analizando historial de Last.fm en segundo plano...'}
            </p>
            {syncJob.tracklists_total > 0 && (
              <div className="h-1.5 w-full rounded-full bg-card overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{
                    width: `${Math.min(
                      100,
                      Math.round(
                        (syncJob.tracklists_checked / syncJob.tracklists_total) * 100
                      )
                    )}%`,
                  }}
                />
              </div>
            )}
          </div>
        )}

        {syncMessage && (
          <p
            className={`text-xs ${
              syncMessage.type === 'success' ? 'text-primary font-medium' : 'text-red-400'
            }`}
          >
            {syncMessage.text}
          </p>
        )}
      </div>

      {/* 8. Pestañas de tu biblioteca: Escuchados, Parciales y Por escuchar */}
      <div className="p-1 bg-inputbg rounded-xl border border-borderc flex gap-1">
        <button
          type="button"
          onClick={() => handleTabChange('listened')}
          className={`flex-1 py-2 px-1.5 rounded-lg text-[11px] font-semibold transition-all flex items-center justify-center gap-1 active:scale-[0.98] ${
            tab === 'listened'
              ? 'bg-primary text-white shadow-xs font-bold'
              : 'text-muted hover:text-main'
          }`}
        >
          <IconCheck className="w-3 h-3 flex-shrink-0" />
          <span className="truncate">Escuchados ({listened.length})</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange('partially_listened')}
          className={`flex-1 py-2 px-1.5 rounded-lg text-[11px] font-semibold transition-all flex items-center justify-center gap-1 active:scale-[0.98] ${
            tab === 'partially_listened'
              ? 'bg-primary text-white shadow-xs font-bold'
              : 'text-muted hover:text-main'
          }`}
        >
          <IconMusic className="w-3 h-3 flex-shrink-0" />
          <span className="truncate">Parciales ({partiallyListened.length})</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange('to_listen')}
          className={`flex-1 py-2 px-1.5 rounded-lg text-[11px] font-semibold transition-all flex items-center justify-center gap-1 active:scale-[0.98] ${
            tab === 'to_listen'
              ? 'bg-primary text-white shadow-xs font-bold'
              : 'text-muted hover:text-main'
          }`}
        >
          <IconDisc className="w-3 h-3 flex-shrink-0" />
          <span className="truncate">Por escuchar ({toListen.length})</span>
        </button>
      </div>

      {/* Buscador interno + selector de orden */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={filterQuery}
            onChange={(e) => {
              setFilterQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Filtrar álbum, artista o canción..."
            className="w-full bg-inputbg border border-borderc rounded-xl py-2 pl-8 pr-7 text-xs text-main placeholder-muted focus:outline-none focus:border-primary"
          />
          <IconSearch className="w-3.5 h-3.5 text-muted absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          {filterQuery && (
            <button
              type="button"
              onClick={() => {
                setFilterQuery('');
                setPage(1);
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-main"
            >
              <IconClose className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <select
          value={sortBy}
          onChange={(e) => {
            setSortBy(e.target.value);
            setPage(1);
          }}
          className="bg-inputbg border border-borderc rounded-xl px-2.5 py-2 text-xs text-main focus:outline-none focus:border-primary"
        >
          <option value="recent">Recientes</option>
          <option value="artist_asc">Artista (A-Z)</option>
          <option value="title_asc">Álbum (A-Z)</option>
          <option value="rating_desc">Mayor nota</option>
        </select>
      </div>

      {/* Cuadrícula paginada de álbumes */}
      {paginatedAlbums.length > 0 ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {paginatedAlbums.map((album) => {
              const listenedTracks = Array.isArray(album.tracks)
                ? album.tracks.filter((t) => t.listened).length
                : 0;
              const totalTracks = Array.isArray(album.tracks) ? album.tracks.length : 0;

              return (
                <div key={album.user_album_id || album.id} className="relative">
                  <AlbumCard
                    album={album}
                    onClick={() => setSelectedAlbum(album)}
                  />
                  {album.rating != null && (
                    <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md bg-black/80 text-white text-[10px] font-bold flex items-center gap-0.5 pointer-events-none">
                      <IconStar className="w-2.5 h-2.5 text-primary fill-current" />
                      <span>{album.rating}</span>
                    </span>
                  )}
                  {album.status === 'partially_listened' && totalTracks > 0 && (
                    <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded-md bg-amber-500 text-black text-[10px] font-extrabold pointer-events-none">
                      {listenedTracks}/{totalTracks}
                    </span>
                  )}
                  {album.status !== 'partially_listened' && album.recommended_by && (
                    <span className="absolute top-2 left-2 max-w-[72%] px-1.5 py-0.5 rounded-md bg-black/80 text-primary text-[10px] font-bold truncate inline-flex items-center gap-1 pointer-events-none">
                      <IconHeart className="w-2.5 h-2.5 fill-current flex-shrink-0" />
                      <span className="truncate">{album.recommended_by}</span>
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between text-xs pt-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-3.5 py-1.5 rounded-xl bg-card border border-borderc disabled:opacity-30 text-main font-semibold shadow-xs flex items-center gap-1 active:scale-95 transition-transform"
              >
                <IconArrowLeft className="w-3.5 h-3.5" />
                <span>Anterior</span>
              </button>
              <span className="text-muted">
                Página <strong className="text-main">{page}</strong> de {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="px-3.5 py-1.5 rounded-xl bg-card border border-borderc disabled:opacity-30 text-main font-semibold shadow-xs flex items-center gap-1 active:scale-95 transition-transform"
              >
                <span>Siguiente</span>
                <IconArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-12 bg-card border border-borderc rounded-2xl p-6 flex flex-col items-center">
          <div className="w-12 h-12 rounded-2xl bg-inputbg border border-borderc flex items-center justify-center text-muted mb-3">
            <IconDisc className="w-6 h-6" />
          </div>
          <p className="text-sm font-semibold text-main">
            {filterQuery.trim()
              ? 'No hay coincidencias con tu filtro'
              : tab === 'listened'
              ? 'Aún no tienes álbumes escuchados'
              : tab === 'partially_listened'
              ? 'Aún no tienes álbumes escuchados parcialmente'
              : 'Tu lista "Por escuchar" está vacía'}
          </p>
          <p className="text-xs text-muted mt-1 max-w-xs">
            Usa el buscador para añadir discos o sincroniza tu historial desde Last.fm.
          </p>
        </div>
      )}

      {/* MODAL: Foto de perfil */}
      {avatarModalOpen &&
        createPortal(
          <div
            onClick={(e) => e.target === e.currentTarget && setAvatarModalOpen(false)}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          >
            <div className="relative bg-card border border-borderc rounded-2xl w-full max-w-sm p-5 space-y-4 shadow-2xl">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-main">Foto de perfil</h3>
                <button
                  type="button"
                  onClick={() => setAvatarModalOpen(false)}
                  className="w-7 h-7 rounded-full bg-inputbg hover:bg-cardhover text-muted hover:text-main flex items-center justify-center"
                >
                  <IconClose className="w-4 h-4" />
                </button>
              </div>

              <div className="flex flex-col items-center gap-3">
                <UserAvatar
                  src={avatarDraft || null}
                  name={profile?.display_name || user?.display_name}
                  username={profile?.username || user?.username}
                  className="w-20 h-20 text-2xl"
                />

                <input
                  ref={avatarFileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarFileSelected}
                  className="hidden"
                />

                <button
                  type="button"
                  onClick={() => avatarFileInputRef.current?.click()}
                  className="px-4 py-2 rounded-xl bg-primarysubtle border border-primary/50 text-primary text-xs font-semibold hover:bg-primary hover:text-white transition-colors"
                >
                  Subir imagen desde el dispositivo
                </button>
              </div>

              <div>
                <label className="text-[11px] text-muted block mb-1">
                  O pega la URL de una imagen
                </label>
                <input
                  type="url"
                  value={avatarDraft.startsWith('data:') ? '' : avatarDraft}
                  onChange={(e) => setAvatarDraft(e.target.value)}
                  placeholder="https://ejemplo.com/mi-avatar.jpg"
                  className="w-full bg-inputbg border border-borderc rounded-xl px-3 py-2 text-xs text-main placeholder-muted focus:outline-none focus:border-primary"
                />
              </div>

              {avatarError && (
                <div className="p-2 rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 text-xs text-center">
                  {avatarError}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                {currentAvatar && (
                  <button
                    type="button"
                    disabled={savingAvatar}
                    onClick={() => handleSaveAvatar(null)}
                    className="px-3 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-semibold"
                  >
                    Quitar
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setAvatarModalOpen(false)}
                  className="flex-1 py-2 rounded-xl bg-inputbg hover:bg-cardhover border border-borderc text-xs text-muted font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={savingAvatar}
                  onClick={() => handleSaveAvatar(avatarDraft)}
                  className="flex-1 py-2 rounded-xl bg-primary hover:bg-primaryhover text-white text-xs font-bold flex items-center justify-center gap-1 disabled:opacity-50"
                >
                  {savingAvatar ? <IconSpinner className="w-3.5 h-3.5" /> : null}
                  <span>Guardar</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* MODAL: Seleccionar hasta 10 álbumes favoritos */}
      {favModalOpen &&
        createPortal(
          <div
            onClick={(e) => e.target === e.currentTarget && setFavModalOpen(false)}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          >
            <div className="relative bg-card border border-borderc rounded-2xl w-full max-w-md max-h-[85dvh] flex flex-col p-5 space-y-3 shadow-2xl">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-main">Álbumes Favoritos</h3>
                  <p className="text-[11px] text-muted">
                    Selecciona hasta {MAX_FAVORITE_ALBUMS} álbumes escuchados (
                    {draftFavIds.length}/{MAX_FAVORITE_ALBUMS})
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setFavModalOpen(false)}
                  className="w-7 h-7 rounded-full bg-inputbg hover:bg-cardhover text-muted hover:text-main flex items-center justify-center"
                >
                  <IconClose className="w-4 h-4" />
                </button>
              </div>

              <div className="relative">
                <input
                  type="text"
                  value={favSearchQuery}
                  onChange={(e) => setFavSearchQuery(e.target.value)}
                  placeholder="Buscar entre tus escuchados..."
                  className="w-full bg-inputbg border border-borderc rounded-xl py-2 pl-8 pr-3 text-xs text-main placeholder-muted focus:outline-none focus:border-primary"
                />
                <IconSearch className="w-3.5 h-3.5 text-muted absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>

              <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
                {filteredFavoriteCandidates.length > 0 ? (
                  filteredFavoriteCandidates.map((alb) => {
                    const realAlbumId = Number(alb.album_id || alb.id);
                    const selectedIdx = draftFavIds.indexOf(realAlbumId);
                    const isSelected = selectedIdx !== -1;
                    const atLimit = !isSelected && draftFavIds.length >= MAX_FAVORITE_ALBUMS;

                    return (
                      <button
                        key={alb.user_album_id || realAlbumId}
                        type="button"
                        disabled={atLimit}
                        onClick={() => toggleDraftFavorite(realAlbumId)}
                        className={`w-full flex items-center gap-2.5 p-2 rounded-xl border text-left transition-colors ${
                          isSelected
                            ? 'bg-primarysubtle border-primary text-main'
                            : atLimit
                            ? 'bg-inputbg/40 border-borderc/50 opacity-50 cursor-not-allowed'
                            : 'bg-inputbg/70 border-borderc hover:border-primary/50 text-main'
                        }`}
                      >
                        <AlbumCover
                          src={alb.cover_url}
                          alt={alb.title}
                          className="w-10 h-10 rounded-lg flex-shrink-0"
                          iconSize="w-4 h-4"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold truncate">{alb.title}</p>
                          <p className="text-[11px] text-muted truncate">{alb.artist}</p>
                        </div>
                        {isSelected ? (
                          <span className="w-6 h-6 rounded-full bg-primary text-white text-[11px] font-extrabold flex items-center justify-center flex-shrink-0">
                            {selectedIdx + 1}
                          </span>
                        ) : (
                          <span className="w-5 h-5 rounded-full border border-borderc flex-shrink-0" />
                        )}
                      </button>
                    );
                  })
                ) : (
                  <p className="text-center text-xs text-muted py-6">
                    No tienes álbumes escuchados que coincidan.
                  </p>
                )}
              </div>

              <div className="flex gap-2 pt-2 border-t border-borderc">
                <button
                  type="button"
                  onClick={() => setDraftFavIds([])}
                  className="px-3 py-2 rounded-xl bg-inputbg hover:bg-cardhover border border-borderc text-xs text-muted font-semibold"
                >
                  Limpiar
                </button>
                <button
                  type="button"
                  onClick={() => setFavModalOpen(false)}
                  className="flex-1 py-2 rounded-xl bg-inputbg hover:bg-cardhover border border-borderc text-xs text-muted font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={savingFavorites}
                  onClick={handleSaveFavorites}
                  className="flex-1 py-2 rounded-xl bg-primary hover:bg-primaryhover text-white text-xs font-bold flex items-center justify-center gap-1 disabled:opacity-50"
                >
                  {savingFavorites ? <IconSpinner className="w-3.5 h-3.5" /> : null}
                  <span>Guardar ({draftFavIds.length})</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* MODAL: Seleccionar hasta 10 canciones favoritas */}
      {trackModalOpen &&
        createPortal(
          <div
            onClick={(e) => e.target === e.currentTarget && setTrackModalOpen(false)}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          >
            <div className="relative bg-card border border-borderc rounded-2xl w-full max-w-md max-h-[88dvh] flex flex-col p-5 space-y-3 shadow-2xl">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-main">Top 10 Canciones Favoritas</h3>
                  <p className="text-[11px] text-muted">
                    Elige de tus álbumes o añade una canción ({draftTracks.length}/
                    {MAX_FAVORITE_TRACKS})
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setTrackModalOpen(false)}
                  className="w-7 h-7 rounded-full bg-inputbg hover:bg-cardhover text-muted hover:text-main flex items-center justify-center"
                >
                  <IconClose className="w-4 h-4" />
                </button>
              </div>

              {/* Añadir canción manual */}
              <form
                onSubmit={handleAddCustomTrack}
                className="space-y-1.5 p-2.5 rounded-xl bg-inputbg/70 border border-borderc"
              >
                <p className="text-[10px] font-bold text-muted uppercase tracking-wider">
                  Añadir canción manual
                </p>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={customTrackTitle}
                    onChange={(e) => setCustomTrackTitle(e.target.value)}
                    placeholder="Canción"
                    className="flex-1 min-w-0 bg-card border border-borderc rounded-lg px-2.5 py-1.5 text-xs text-main placeholder-muted focus:outline-none focus:border-primary"
                  />
                  <input
                    type="text"
                    value={customTrackArtist}
                    onChange={(e) => setCustomTrackArtist(e.target.value)}
                    placeholder="Artista"
                    className="flex-1 min-w-0 bg-card border border-borderc rounded-lg px-2.5 py-1.5 text-xs text-main placeholder-muted focus:outline-none focus:border-primary"
                  />
                  <button
                    type="submit"
                    disabled={
                      !customTrackTitle.trim() ||
                      !customTrackArtist.trim() ||
                      draftTracks.length >= MAX_FAVORITE_TRACKS
                    }
                    className="px-2.5 py-1.5 rounded-lg bg-primary hover:bg-primaryhover disabled:opacity-40 text-white text-xs font-bold flex items-center gap-1 flex-shrink-0"
                  >
                    <IconPlus className="w-3.5 h-3.5" />
                    <span>Añadir</span>
                  </button>
                </div>
              </form>

              <div className="relative">
                <input
                  type="text"
                  value={trackSearchQuery}
                  onChange={(e) => setTrackSearchQuery(e.target.value)}
                  placeholder="Buscar canción o artista en tus álbumes..."
                  className="w-full bg-inputbg border border-borderc rounded-xl py-2 pl-8 pr-3 text-xs text-main placeholder-muted focus:outline-none focus:border-primary"
                />
                <IconSearch className="w-3.5 h-3.5 text-muted absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>

              <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
                {filteredCandidateTracks.length > 0 ? (
                  filteredCandidateTracks.map((cand, idx) => {
                    const key = trackKey(cand.track_title, cand.artist_name);
                    const selectedIdx = draftTracks.findIndex(
                      (item) => trackKey(item.track_title, item.artist_name) === key
                    );
                    const isSelected = selectedIdx !== -1;
                    const atLimit = !isSelected && draftTracks.length >= MAX_FAVORITE_TRACKS;

                    return (
                      <button
                        key={`${key}-${idx}`}
                        type="button"
                        disabled={atLimit}
                        onClick={() => toggleDraftTrack(cand)}
                        className={`w-full flex items-center justify-between gap-2.5 p-2 rounded-xl border text-left transition-colors ${
                          isSelected
                            ? 'bg-primarysubtle border-primary text-main'
                            : atLimit
                            ? 'bg-inputbg/40 border-borderc/50 opacity-50 cursor-not-allowed'
                            : 'bg-inputbg/70 border-borderc hover:border-primary/50 text-main'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold truncate">{cand.track_title}</p>
                          <p className="text-[11px] text-muted truncate">
                            {cand.artist_name}
                            {cand.album_title ? ` · ${cand.album_title}` : ''}
                          </p>
                        </div>
                        {isSelected ? (
                          <span className="w-6 h-6 rounded-full bg-primary text-white text-[11px] font-extrabold flex items-center justify-center flex-shrink-0">
                            {selectedIdx + 1}
                          </span>
                        ) : (
                          <span className="w-5 h-5 rounded-full border border-borderc flex-shrink-0" />
                        )}
                      </button>
                    );
                  })
                ) : (
                  <p className="text-center text-xs text-muted py-5">
                    {candidateTracks.length === 0
                      ? 'Abre tus álbumes escuchados o parciales para cargar pistas, o añade una canción arriba.'
                      : 'No hay canciones que coincidan con tu búsqueda.'}
                  </p>
                )}
              </div>

              <div className="flex gap-2 pt-2 border-t border-borderc">
                <button
                  type="button"
                  onClick={() => setDraftTracks([])}
                  className="px-3 py-2 rounded-xl bg-inputbg hover:bg-cardhover border border-borderc text-xs text-muted font-semibold"
                >
                  Limpiar
                </button>
                <button
                  type="button"
                  onClick={() => setTrackModalOpen(false)}
                  className="flex-1 py-2 rounded-xl bg-inputbg hover:bg-cardhover border border-borderc text-xs text-muted font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={savingTracks}
                  onClick={handleSaveFavoriteTracks}
                  className="flex-1 py-2 rounded-xl bg-primary hover:bg-primaryhover text-white text-xs font-bold flex items-center justify-center gap-1 disabled:opacity-50"
                >
                  {savingTracks ? <IconSpinner className="w-3.5 h-3.5" /> : null}
                  <span>Guardar ({draftTracks.length})</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* MODAL: Selector de temas */}
      {themeModalOpen &&
        createPortal(
          <div
            onClick={(e) => e.target === e.currentTarget && setThemeModalOpen(false)}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          >
            <div className="relative bg-card border border-borderc rounded-2xl w-full max-w-md max-h-[85dvh] overflow-y-auto p-5 space-y-4 shadow-2xl">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-main">Elige un tema</h3>
                  <p className="text-[11px] text-muted">
                    Oscuros, claros y colores de acento
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setThemeModalOpen(false)}
                  className="w-7 h-7 rounded-full bg-inputbg hover:bg-cardhover text-muted hover:text-main flex items-center justify-center"
                >
                  <IconClose className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-2">
                <p className="text-[10px] font-bold text-muted uppercase tracking-wider">
                  Temas oscuros
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {darkThemes.map((t) => {
                    const active = theme === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setTheme(t.id)}
                        className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all ${
                          active
                            ? 'bg-primarysubtle border-primary text-main font-bold'
                            : 'bg-inputbg/70 border-borderc hover:border-primary/50 text-main'
                        }`}
                      >
                        <span
                          className="w-4 h-4 rounded-full flex-shrink-0 border border-white/20"
                          style={{ backgroundColor: t.color }}
                        />
                        <span className="text-xs truncate flex-1">{t.name}</span>
                        {active && <IconCheck className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-[10px] font-bold text-muted uppercase tracking-wider">
                  Temas claros
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {lightThemes.map((t) => {
                    const active = theme === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setTheme(t.id)}
                        className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all ${
                          active
                            ? 'bg-primarysubtle border-primary text-main font-bold'
                            : 'bg-inputbg/70 border-borderc hover:border-primary/50 text-main'
                        }`}
                      >
                        <span
                          className="w-4 h-4 rounded-full flex-shrink-0 border border-black/15"
                          style={{ backgroundColor: t.color }}
                        />
                        <span className="text-xs truncate flex-1">{t.name}</span>
                        {active && <IconCheck className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* MODAL: Detalle / Edición de álbum */}
      {selectedAlbum && (
        <AlbumDetail
          album={selectedAlbum}
          onClose={() => setSelectedAlbum(null)}
          friends={friends}
          userAlbum={selectedAlbum}
          recommenderName={selectedAlbum.recommended_by}
          onAction={handleAlbumAction}
          onDelete={() => handleDeleteUserAlbum(selectedAlbum)}
        />
      )}
    </div>
  );
}