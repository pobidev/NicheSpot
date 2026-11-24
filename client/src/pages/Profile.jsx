import { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import * as api from '../api';
import AlbumCard, { AlbumCover } from '../components/AlbumCard';
import AlbumDetail from '../components/AlbumDetail';
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
} from '../components/Icons';

const PAGE_SIZE = 24;

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

  // Last.fm integrado en su propia sección
  const [lastfmInput, setLastfmInput] = useState('');
  const [savingLastfm, setSavingLastfm] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState(null);

  // Top 6 álbumes favoritos
  const [favoriteIds, setFavoriteIds] = useState([]);
  const [favModalOpen, setFavModalOpen] = useState(false);
  const [favSearchQuery, setFavSearchQuery] = useState('');
  const [draftFavIds, setDraftFavIds] = useState([]);
  const [savingFavorites, setSavingFavorites] = useState(false);

  // Modales
  const [themeModalOpen, setThemeModalOpen] = useState(false);
  const [selectedAlbum, setSelectedAlbum] = useState(null);

  const loadData = useCallback(() => {
    setLoading(true);
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
          ? p.favorite_albums.map((item) => Number(item.id || item.album_id)).filter(Boolean).slice(0, 6)
          : [];
        setFavoriteIds(initialFavIds);
      }
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Cerrar modales con Escape
  useEffect(() => {
    if (!themeModalOpen && !favModalOpen) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        setThemeModalOpen(false);
        setFavModalOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [themeModalOpen, favModalOpen]);

  const listened = useMemo(() => albums.filter((a) => a.status === 'listened'), [albums]);
  const partiallyListened = useMemo(
    () => albums.filter((a) => a.status === 'partially_listened'),
    [albums]
  );
  const toListen = useMemo(() => albums.filter((a) => a.status === 'to_listen'), [albums]);

  // Resolver los objetos completos de los favoritos de entre los discos escuchados
  const favoriteAlbums = useMemo(() => {
    const byAlbumId = new Map();
    for (const a of listened) {
      const realId = Number(a.album_id || a.id);
      if (realId) byAlbumId.set(realId, a);
    }
    return favoriteIds
      .map((id) => byAlbumId.get(Number(id)))
      .filter(Boolean)
      .slice(0, 6);
  }, [favoriteIds, listened]);

  const filteredFavoriteCandidates = useMemo(() => {
    const q = favSearchQuery.trim().toLowerCase();
    if (!q) return listened;
    return listened.filter(
      (a) =>
        a.title?.toLowerCase().includes(q) || a.artist?.toLowerCase().includes(q)
    );
  }, [listened, favSearchQuery]);

  // Estadísticas extra calculadas desde la biblioteca del usuario
  const extraStats = useMemo(() => {
    let tracksListened = 0;
    let ratingSum = 0;
    let ratedCount = 0;
    const uniqueArtists = new Set();

    for (const a of albums) {
      if (a.status === 'listened' || a.status === 'partially_listened') {
        if (a.artist) uniqueArtists.add(a.artist.trim().toLowerCase());
      }
      if (a.rating != null) {
        ratingSum += Number(a.rating);
        ratedCount += 1;
      }
      if (Array.isArray(a.tracks) && a.tracks.length > 0) {
        if (a.status === 'listened') {
          tracksListened += a.tracks.length;
        } else if (a.status === 'partially_listened') {
          tracksListened += a.tracks.filter((t) => Boolean(t.listened)).length;
        }
      }
    }

    return {
      tracksListened,
      avgRating: ratedCount > 0 ? (ratingSum / ratedCount).toFixed(1) : '—',
      uniqueArtists: uniqueArtists.size,
    };
  }, [albums]);

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
          const inTracks =
            Array.isArray(a.tracks) && a.tracks.some((t) => t.track_title?.toLowerCase().includes(q));
          return inTitle || inArtist || inNote || inTracks;
        })
      : [...base];

    filtered.sort((a, b) => {
      if (sortBy === 'artist_asc') {
        const cmp = (a.artist || '').localeCompare(b.artist || '', undefined, { sensitivity: 'base' });
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

  const openFavoritesModal = () => {
    setDraftFavIds(favoriteAlbums.map((a) => Number(a.album_id || a.id)));
    setFavSearchQuery('');
    setFavModalOpen(true);
  };

  const toggleDraftFavorite = (albumId) => {
    const numId = Number(albumId);
    setDraftFavIds((prev) => {
      if (prev.includes(numId)) return prev.filter((id) => id !== numId);
      if (prev.length >= 6) return prev;
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
          ? savedList.map((a) => Number(a.id || a.album_id)).filter(Boolean).slice(0, 6)
          : draftFavIds.slice(0, 6);
      setFavoriteIds(nextIds);
      setProfile((prev) => (prev ? { ...prev, favorite_albums: savedList } : prev));
      setFavModalOpen(false);
    } catch (err) {
      console.error('Error guardando favoritos:', err);
    } finally {
      setSavingFavorites(false);
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

  const handleSaveLastfmOnly = async () => {
    const cleanLfm = lastfmInput.trim();
    setSavingLastfm(true);
    setSyncMessage(null);
    try {
      const updated = await api.updateProfile({
        display_name: profile?.display_name || user?.display_name,
        lastfm_username: cleanLfm,
      });
      setProfile((prev) => ({ ...prev, ...updated }));
      updateUser({ ...user, lastfm_username: cleanLfm });
      setSyncMessage({
        type: 'success',
        text: cleanLfm ? `Usuario @${cleanLfm} guardado.` : 'Usuario de Last.fm eliminado.',
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
    const cleanLfm = lastfmInput.trim();
    if (!cleanLfm) {
      setSyncMessage({ type: 'error', text: 'Introduce primero tu nombre de usuario de Last.fm.' });
      return;
    }

    setSyncing(true);
    setSyncMessage(null);
    try {
      if (cleanLfm !== (profile?.lastfm_username || '').trim()) {
        const updated = await api.updateProfile({
          display_name: profile?.display_name || user?.display_name,
          lastfm_username: cleanLfm,
        });
        setProfile((prev) => ({ ...prev, ...updated }));
        updateUser({ ...user, lastfm_username: cleanLfm });
      }

      const res = await api.syncLastfm();
      setSyncMessage({
        type: 'success',
        text:
          res.message ||
          `Sincronizados ${res.imported} nuevos álbumes (total: ${res.total_found || res.imported})`,
      });
      loadData();
    } catch (err) {
      setSyncMessage({
        type: 'error',
        text: err.message || 'Error al sincronizar con Last.fm',
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleAlbumAction = async (action) => {
    if (!selectedAlbum) return;
    if (action.type === 'recommend') {
      const cached = await api.addAlbum({
        external_id: selectedAlbum.external_id || selectedAlbum.id?.toString(),
        source: selectedAlbum.source || 'musicbrainz',
        title: selectedAlbum.title,
        artist: selectedAlbum.artist,
        year: selectedAlbum.year,
        cover_url: selectedAlbum.cover_url,
      });
      await api.recommendAlbum({ album_id: cached.id, friend_id: action.friend_id });
      return;
    }

    const uaId = selectedAlbum.user_album_id || (selectedAlbum.user_id ? selectedAlbum.id : null);
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
    loadData();
  };

  const handleDeleteUserAlbum = async (targetAlbum) => {
    const uaId = targetAlbum?.user_album_id || (targetAlbum?.user_id ? targetAlbum.id : null);
    if (!uaId) return;
    await api.deleteUserAlbum(uaId);
    loadData();
  };

  const handleQuickDeleteToListen = async (album, e) => {
    e.stopPropagation();
    const uaId = album.user_album_id || album.id;
    if (!uaId) return;
    try {
      await api.deleteUserAlbum(uaId);
      setAlbums((prev) => prev.filter((item) => (item.user_album_id || item.id) !== uaId));
    } catch (err) {
      console.error('Error eliminando álbum de por escuchar:', err);
    }
  };

  const darkThemes = themes.filter((t) => t.group !== 'light');
  const lightThemes = themes.filter((t) => t.group === 'light');
  const lastfmChanged = lastfmInput.trim() !== (profile?.lastfm_username || '').trim();
  const favSlots = Array.from({ length: 6 }, (_, i) => favoriteAlbums[i] || null);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <IconSpinner className="w-7 h-7 text-primary" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Cabecera de usuario + Estadísticas */}
      <div className="bg-card border border-borderc rounded-2xl p-4 shadow-xs space-y-4">
        <div className="flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-12 h-12 rounded-full bg-primarysubtle text-primary border border-primary/20 flex items-center justify-center text-base font-bold flex-shrink-0">
              {(profile?.display_name || user?.username || '?')[0].toUpperCase()}
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-main truncate">
                {profile?.display_name || user?.display_name}
              </h2>
              <p className="text-xs text-muted truncate">@{profile?.username || user?.username}</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              type="button"
              onClick={() => setThemeModalOpen(true)}
              className="px-2.5 py-1.5 rounded-xl bg-inputbg hover:bg-cardhover border border-borderc text-main text-xs font-semibold transition-all active:scale-95 flex items-center gap-1.5"
              title="Cambiar tema visual"
            >
              <IconPalette className="w-3.5 h-3.5 text-primary" />
              <span>Tema</span>
            </button>

            <button
              type="button"
              onClick={logout}
              className="px-2.5 py-1.5 rounded-xl border border-red-500/25 hover:bg-red-500/10 text-red-400 text-xs font-semibold transition-all active:scale-95 flex items-center gap-1"
              title="Cerrar sesión"
            >
              <IconLogout className="w-3.5 h-3.5" />
              <span>Salir</span>
            </button>
          </div>
        </div>

        {/* Estadísticas principales (3 categorías clicables) */}
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <div
              onClick={() => handleTabChange('listened')}
              className={`border rounded-xl p-2.5 text-center cursor-pointer transition-all active:scale-[0.98] ${
                tab === 'listened'
                  ? 'bg-primarysubtle border-primary shadow-xs'
                  : 'bg-inputbg border-borderc hover:bg-cardhover'
              }`}
            >
              <p className="text-xl font-bold text-primary">{listened.length}</p>
              <p className="text-[11px] text-muted font-medium mt-0.5">Escuchados</p>
            </div>
            <div
              onClick={() => handleTabChange('partially_listened')}
              className={`border rounded-xl p-2.5 text-center cursor-pointer transition-all active:scale-[0.98] ${
                tab === 'partially_listened'
                  ? 'bg-primarysubtle border-primary shadow-xs'
                  : 'bg-inputbg border-borderc hover:bg-cardhover'
              }`}
            >
              <p className="text-xl font-bold text-amber-400">{partiallyListened.length}</p>
              <p className="text-[11px] text-muted font-medium mt-0.5">Parciales</p>
            </div>
            <div
              onClick={() => handleTabChange('to_listen')}
              className={`border rounded-xl p-2.5 text-center cursor-pointer transition-all active:scale-[0.98] ${
                tab === 'to_listen'
                  ? 'bg-primarysubtle border-primary shadow-xs'
                  : 'bg-inputbg border-borderc hover:bg-cardhover'
              }`}
            >
              <p className="text-xl font-bold text-primary">{toListen.length}</p>
              <p className="text-[11px] text-muted font-medium mt-0.5">Por escuchar</p>
            </div>
          </div>

          {/* Estadísticas adicionales */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-inputbg/60 border border-borderc rounded-xl px-2.5 py-2 text-center">
              <p className="text-sm font-bold text-main">{extraStats.tracksListened}</p>
              <p className="text-[10px] text-muted mt-0.5">Pistas marcadas</p>
            </div>
            <div className="bg-inputbg/60 border border-borderc rounded-xl px-2.5 py-2 text-center">
              <p className="text-sm font-bold text-main flex items-center justify-center gap-1">
                <span>{extraStats.avgRating}</span>
                {extraStats.avgRating !== '—' && <IconStar className="w-3 h-3 text-primary fill-current" />}
              </p>
              <p className="text-[10px] text-muted mt-0.5">Nota media</p>
            </div>
            <div className="bg-inputbg/60 border border-borderc rounded-xl px-2.5 py-2 text-center">
              <p className="text-sm font-bold text-main">{extraStats.uniqueArtists}</p>
              <p className="text-[10px] text-muted mt-0.5">Artistas</p>
            </div>
          </div>
        </div>

        {/* Editar nombre visible */}
        {editing ? (
          <div className="space-y-2.5 pt-2 border-t border-borderc animate-fade-up">
            <div>
              <label className="text-xs text-muted block mb-1">Nombre para mostrar</label>
              <input
                value={displayNameInput}
                onChange={(e) => setDisplayNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveDisplayName();
                }}
                placeholder="Tu nombre visible"
                className="w-full bg-inputbg border border-borderc rounded-xl p-2.5 text-main placeholder-muted text-xs focus:outline-none focus:border-primary"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setDisplayNameInput(profile?.display_name || '');
                }}
                className="flex-1 py-2 rounded-xl bg-inputbg border border-borderc text-main text-xs font-semibold hover:bg-cardhover transition-all active:scale-[0.98]"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveDisplayName}
                disabled={savingName || !displayNameInput.trim()}
                className="flex-1 py-2 rounded-xl bg-primary hover:bg-primaryhover disabled:opacity-50 text-white text-xs font-semibold transition-all active:scale-[0.98] shadow-xs"
              >
                {savingName ? 'Guardando...' : 'Guardar nombre'}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="w-full py-2 rounded-xl bg-inputbg hover:bg-cardhover border border-borderc text-main text-xs font-semibold transition-all active:scale-[0.99] flex items-center justify-center gap-1.5"
          >
            <IconEdit className="w-3.5 h-3.5 text-muted" />
            <span>Editar nombre</span>
          </button>
        )}
      </div>

      {/* Sincronización con Last.fm */}
      <div className="bg-card border border-borderc rounded-2xl p-4 shadow-xs space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-bold text-main flex items-center gap-1.5">
            <IconRadio className="w-4 h-4 text-primary flex-shrink-0" />
            <span>Sincronización con Last.fm</span>
          </p>
          {profile?.lastfm_username && !lastfmChanged && (
            <span className="text-[11px] text-primary bg-primarysubtle px-2 py-0.5 rounded-full font-medium">
              Conectado
            </span>
          )}
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={lastfmInput}
            onChange={(e) => {
              setLastfmInput(e.target.value);
              if (syncMessage) setSyncMessage(null);
            }}
            placeholder="Tu usuario de Last.fm (ej: pobi)"
            className="flex-1 min-w-0 bg-inputbg border border-borderc rounded-xl px-3 py-2 text-xs text-main placeholder-muted focus:outline-none focus:border-primary"
          />

          {lastfmChanged && (
            <button
              type="button"
              onClick={handleSaveLastfmOnly}
              disabled={savingLastfm || syncing}
              className="px-3 py-2 rounded-xl bg-inputbg hover:bg-cardhover border border-borderc text-main text-xs font-semibold transition-all active:scale-95 flex-shrink-0"
            >
              {savingLastfm ? '...' : 'Guardar'}
            </button>
          )}

          <button
            type="button"
            onClick={handleSync}
            disabled={syncing || !lastfmInput.trim()}
            className="px-3.5 py-2 rounded-xl bg-primary hover:bg-primaryhover disabled:opacity-45 text-white text-xs font-semibold transition-all active:scale-95 flex items-center gap-1.5 flex-shrink-0 shadow-xs"
          >
            {syncing ? (
              <>
                <IconSpinner className="w-3.5 h-3.5 text-white" />
                <span>Sincronizando...</span>
              </>
            ) : (
              <>
                <IconRefresh className="w-3.5 h-3.5" />
                <span>Sincronizar</span>
              </>
            )}
          </button>
        </div>

        {syncMessage && (
          <div
            className={`text-xs p-2.5 rounded-xl border flex items-center gap-1.5 animate-fade-up ${
              syncMessage.type === 'success'
                ? 'bg-primarysubtle border-primary/30 text-primary'
                : 'bg-red-500/15 border-red-500/30 text-red-400'
            }`}
          >
            {syncMessage.type === 'success' && <IconCheck className="w-4 h-4 flex-shrink-0" />}
            <span>{syncMessage.text}</span>
          </div>
        )}
      </div>

      {/* Top 6 Álbumes Favoritos (debajo de Last.fm) */}
      <div className="bg-card border border-borderc rounded-2xl p-4 shadow-xs space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs font-bold text-main flex items-center gap-1.5">
              <IconStar className="w-4 h-4 text-primary fill-current flex-shrink-0" />
              <span>Mis 6 álbumes favoritos</span>
            </p>
            <p className="text-[11px] text-muted mt-0.5">
              Elegidos entre tus escuchados · Visibles para tus amigos ({favoriteAlbums.length}/6)
            </p>
          </div>
          <button
            type="button"
            onClick={openFavoritesModal}
            className="px-3 py-1.5 rounded-xl bg-primarysubtle hover:bg-primary border border-primary text-primary hover:text-white text-xs font-semibold transition-colors flex-shrink-0"
          >
            Elegir
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {favSlots.map((alb, idx) =>
            alb ? (
              <div
                key={alb.album_id || alb.id || idx}
                onClick={openFavoritesModal}
                className="cursor-pointer bg-inputbg border border-borderc hover:border-primary rounded-xl p-1.5 transition-colors"
              >
                <div className="relative mb-1.5">
                  <AlbumCover
                    src={alb.cover_url}
                    alt={alb.title}
                    className="w-full aspect-square rounded-lg"
                    iconSize="w-5 h-5"
                  />
                  <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded-md bg-black/75 text-white text-[10px] font-bold">
                    #{idx + 1}
                  </span>
                </div>
                <p className="text-[11px] font-semibold text-main truncate">{alb.title}</p>
                <p className="text-[10px] text-muted truncate">{alb.artist}</p>
              </div>
            ) : (
              <button
                key={`empty-fav-${idx}`}
                type="button"
                onClick={openFavoritesModal}
                className="aspect-square rounded-xl border border-dashed border-borderc hover:border-primary bg-inputbg/50 flex flex-col items-center justify-center gap-1 text-muted hover:text-primary transition-colors"
              >
                <IconStar className="w-4 h-4" />
                <span className="text-[10px] font-semibold">Hueco #{idx + 1}</span>
              </button>
            )
          )}
        </div>
      </div>

      {/* Pestañas + Buscador + Ordenación */}
      <div className="space-y-3">
        <div className="p-1 bg-inputbg rounded-xl border border-borderc flex gap-1">
          <button
            type="button"
            onClick={() => handleTabChange('listened')}
            className={`flex-1 py-2 px-2 rounded-lg text-[11px] font-semibold transition-all flex items-center justify-center gap-1 active:scale-[0.98] ${
              tab === 'listened'
                ? 'bg-primary text-white shadow-xs font-bold'
                : 'text-muted hover:text-main'
            }`}
          >
            <span>Escuchados ({listened.length})</span>
          </button>
          <button
            type="button"
            onClick={() => handleTabChange('partially_listened')}
            className={`flex-1 py-2 px-2 rounded-lg text-[11px] font-semibold transition-all flex items-center justify-center gap-1 active:scale-[0.98] ${
              tab === 'partially_listened'
                ? 'bg-primary text-white shadow-xs font-bold'
                : 'text-muted hover:text-main'
            }`}
          >
            <span>Parciales ({partiallyListened.length})</span>
          </button>
          <button
            type="button"
            onClick={() => handleTabChange('to_listen')}
            className={`flex-1 py-2 px-2 rounded-lg text-[11px] font-semibold transition-all flex items-center justify-center gap-1 active:scale-[0.98] ${
              tab === 'to_listen'
                ? 'bg-primary text-white shadow-xs font-bold'
                : 'text-muted hover:text-main'
            }`}
          >
            <span>Por escuchar ({toListen.length})</span>
          </button>
        </div>

        {/* Barra de búsqueda y selector de orden */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => {
                setFilterQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Buscar álbum, artista o canción..."
              className="w-full bg-inputbg border border-borderc rounded-xl py-2 pl-8 pr-7 text-xs text-main placeholder-muted focus:outline-none focus:border-primary"
            />
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none">
              <IconSearch className="w-3.5 h-3.5" />
            </span>
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
            aria-label="Ordenar álbumes"
          >
            <option value="recent">Más recientes</option>
            <option value="artist_asc">Artista (A-Z)</option>
            <option value="title_asc">Álbum (A-Z)</option>
            <option value="rating_desc">Mayor puntuación</option>
          </select>
        </div>

        {/* Controles de paginación superiores */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-xs px-1">
            <span className="text-muted">
              Página <strong className="text-main">{page}</strong> de {totalPages} ({displayed.length} álbumes)
            </span>
            <div className="flex gap-1.5">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-2.5 py-1 rounded-lg bg-card border border-borderc disabled:opacity-30 text-main text-xs font-semibold flex items-center gap-1"
              >
                <IconArrowLeft className="w-3 h-3" />
                <span>Ant.</span>
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="px-2.5 py-1 rounded-lg bg-card border border-borderc disabled:opacity-30 text-main text-xs font-semibold flex items-center gap-1"
              >
                <span>Sig.</span>
                <IconArrowRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}

        {/* Lista paginada de álbumes */}
        {paginatedAlbums.length > 0 ? (
          <div className="space-y-2">
            {paginatedAlbums.map((album) => {
              const listenedTracksCount = Array.isArray(album.tracks)
                ? album.tracks.filter((t) => t.listened).length
                : 0;

              return (
                <div key={album.user_album_id || album.id} className="relative">
                  <AlbumCard
                    album={album}
                    compact
                    onClick={() =>
                      setSelectedAlbum({ ...album, user_album_id: album.user_album_id || album.id })
                    }
                  />

                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                    {album.status === 'partially_listened' &&
                      Array.isArray(album.tracks) &&
                      album.tracks.length > 0 && (
                        <span className="text-[11px] font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md flex items-center gap-1">
                          <IconMusic className="w-3 h-3" />
                          <span>
                            {listenedTracksCount}/{album.tracks.length}
                          </span>
                        </span>
                      )}

                    {(album.status === 'listened' || album.status === 'partially_listened') &&
                      album.rating != null && (
                        <span className="text-xs font-bold text-primary bg-primarysubtle border border-primary/20 px-2 py-0.5 rounded-md flex items-center gap-1">
                          <IconStar className="w-3 h-3 fill-current" />
                          <span>{album.rating}/10</span>
                        </span>
                      )}

                    {album.status === 'to_listen' && (
                      <button
                        type="button"
                        onClick={(e) => handleQuickDeleteToListen(album, e)}
                        className="p-1.5 rounded-lg bg-inputbg hover:bg-red-500/15 border border-borderc hover:border-red-500/30 text-muted hover:text-red-400 transition-colors"
                        title="Eliminar de Por escuchar"
                        aria-label="Eliminar de Por escuchar"
                      >
                        <IconClose className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-10 bg-card/40 border border-borderc rounded-2xl p-6 flex flex-col items-center">
            <div className="w-12 h-12 rounded-2xl bg-inputbg border border-borderc flex items-center justify-center text-muted mb-3">
              <IconDisc className="w-6 h-6" />
            </div>
            <p className="text-sm font-semibold text-main">
              {filterQuery
                ? 'Ningún álbum coincide con tu búsqueda'
                : tab === 'listened'
                ? 'Aún no has marcado álbumes como escuchados'
                : tab === 'partially_listened'
                ? 'No tienes álbumes escuchados parcialmente'
                : 'No tienes álbumes pendientes'}
            </p>
            <p className="text-xs text-muted mt-1">
              {filterQuery
                ? 'Prueba con otro artista o título.'
                : 'Busca canciones o álbumes en la pestaña Buscar.'}
            </p>
          </div>
        )}

        {/* Controles de paginación inferiores */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-xs pt-2 px-1">
            <button
              disabled={page <= 1}
              onClick={() => {
                setPage((p) => Math.max(1, p - 1));
                window.scrollTo({ top: 300, behavior: 'smooth' });
              }}
              className="px-3.5 py-1.5 rounded-xl bg-card border border-borderc disabled:opacity-30 text-main font-semibold shadow-xs flex items-center gap-1"
            >
              <IconArrowLeft className="w-3.5 h-3.5" />
              <span>Anterior</span>
            </button>
            <span className="text-muted">
              Página {page} de {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => {
                setPage((p) => Math.min(totalPages, p + 1));
                window.scrollTo({ top: 300, behavior: 'smooth' });
              }}
              className="px-3.5 py-1.5 rounded-xl bg-card border border-borderc disabled:opacity-30 text-main font-semibold shadow-xs flex items-center gap-1"
            >
              <span>Siguiente</span>
              <IconArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Modal selector de 6 álbumes favoritos */}
      {favModalOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-backdrop-in"
            onClick={(e) => {
              if (e.target === e.currentTarget) setFavModalOpen(false);
            }}
          >
            <div
              className="relative w-full max-w-md max-h-[85dvh] flex flex-col rounded-2xl bg-card border border-borderc p-5 shadow-2xl space-y-3 animate-modal-in"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-main">Elige tus 6 álbumes favoritos</h3>
                  <p className="text-[11px] text-muted">
                    Seleccionados: <strong className="text-primary">{draftFavIds.length}/6</strong> (solo entre tus escuchados)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setFavModalOpen(false)}
                  className="text-muted hover:text-main p-1 rounded-lg hover:bg-cardhover transition-colors"
                >
                  <IconClose className="w-4 h-4" />
                </button>
              </div>

              <div className="relative">
                <input
                  type="text"
                  value={favSearchQuery}
                  onChange={(e) => setFavSearchQuery(e.target.value)}
                  placeholder="Filtrar álbumes escuchados..."
                  className="w-full bg-inputbg border border-borderc rounded-xl py-2 pl-8 pr-3 text-xs text-main placeholder-muted focus:outline-none focus:border-primary"
                />
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none">
                  <IconSearch className="w-3.5 h-3.5" />
                </span>
              </div>

              <div className="flex-1 overflow-y-auto space-y-1.5 min-h-[180px] max-h-[48dvh] pr-1">
                {filteredFavoriteCandidates.length > 0 ? (
                  filteredFavoriteCandidates.map((alb) => {
                    const realAlbumId = Number(alb.album_id || alb.id);
                    const pos = draftFavIds.indexOf(realAlbumId);
                    const isPicked = pos !== -1;
                    const limitReached = !isPicked && draftFavIds.length >= 6;

                    return (
                      <button
                        key={alb.user_album_id || realAlbumId}
                        type="button"
                        disabled={limitReached}
                        onClick={() => toggleDraftFavorite(realAlbumId)}
                        className={`w-full flex items-center gap-2.5 p-2 rounded-xl border text-left transition-colors ${
                          isPicked
                            ? 'bg-primarysubtle border-primary'
                            : limitReached
                            ? 'bg-inputbg border-borderc opacity-40 cursor-not-allowed'
                            : 'bg-inputbg border-borderc hover:bg-cardhover'
                        }`}
                      >
                        <AlbumCover
                          src={alb.cover_url}
                          alt={alb.title}
                          className="w-10 h-10 rounded-lg flex-shrink-0"
                          iconSize="w-4 h-4"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-main truncate">{alb.title}</p>
                          <p className="text-[11px] text-muted truncate">{alb.artist}</p>
                        </div>
                        {isPicked ? (
                          <span className="px-2 py-0.5 rounded-lg bg-primary text-white text-[11px] font-bold flex items-center gap-1 flex-shrink-0">
                            <IconCheck className="w-3 h-3" />
                            <span>#{pos + 1}</span>
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-lg border border-borderc text-[11px] text-muted flex-shrink-0">
                            Elegir
                          </span>
                        )}
                      </button>
                    );
                  })
                ) : (
                  <p className="text-center text-xs text-muted py-8">
                    No tienes álbumes escuchados que coincidan.
                  </p>
                )}
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setFavModalOpen(false)}
                  className="flex-1 py-2.5 rounded-xl bg-inputbg border border-borderc text-main text-xs font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSaveFavorites}
                  disabled={savingFavorites}
                  className="flex-1 py-2.5 rounded-xl bg-primary hover:bg-primaryhover disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-1.5"
                >
                  {savingFavorites ? (
                    <IconSpinner className="w-4 h-4 text-white" />
                  ) : (
                    <IconCheck className="w-4 h-4" />
                  )}
                  <span>Guardar</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Modal selector de temas */}
      {themeModalOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-backdrop-in"
            onClick={(e) => {
              if (e.target === e.currentTarget) setThemeModalOpen(false);
            }}
          >
            <div
              className="relative w-full max-w-sm rounded-2xl bg-card border border-borderc p-5 shadow-2xl space-y-4 animate-modal-in"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-main flex items-center gap-2">
                  <IconPalette className="w-4 h-4 text-primary" />
                  <span>Apariencia y tema</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setThemeModalOpen(false)}
                  className="text-muted hover:text-main p-1 rounded-lg hover:bg-cardhover transition-colors"
                  aria-label="Cerrar selector de temas"
                >
                  <IconClose className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <p className="text-[11px] font-bold text-muted uppercase tracking-wider mb-2">
                    Temas oscuros
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {darkThemes.map((t) => {
                      const isSelected = theme === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setTheme(t.id)}
                          className={`flex items-center justify-between gap-2 p-2.5 rounded-xl border text-left transition-all active:scale-[0.97] ${
                            isSelected
                              ? 'border-primary bg-primarysubtle text-main font-semibold'
                              : 'border-borderc bg-inputbg/70 hover:bg-inputbg text-main'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="w-3.5 h-3.5 rounded-full flex-shrink-0 border border-white/20"
                              style={{ backgroundColor: t.color }}
                            />
                            <span className="text-xs truncate">{t.name}</span>
                          </div>
                          {isSelected && <IconCheck className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <p className="text-[11px] font-bold text-muted uppercase tracking-wider mb-2">
                    Temas claros
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {lightThemes.map((t) => {
                      const isSelected = theme === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setTheme(t.id)}
                          className={`flex items-center justify-between gap-2 p-2.5 rounded-xl border text-left transition-all active:scale-[0.97] ${
                            isSelected
                              ? 'border-primary bg-primarysubtle text-main font-semibold'
                              : 'border-borderc bg-inputbg/70 hover:bg-inputbg text-main'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="w-3.5 h-3.5 rounded-full flex-shrink-0 border border-black/15"
                              style={{ backgroundColor: t.color }}
                            />
                            <span className="text-xs truncate">{t.name}</span>
                          </div>
                          {isSelected && <IconCheck className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setThemeModalOpen(false)}
                className="w-full py-2.5 rounded-xl bg-primary hover:bg-primaryhover text-white text-xs font-semibold transition-all active:scale-[0.98] shadow-xs"
              >
                Listo
              </button>
            </div>
          </div>,
          document.body
        )}

      {/* Modal detalle cuando se pulsa un álbum de la lista */}
      {selectedAlbum && (
        <AlbumDetail
          album={selectedAlbum}
          onClose={() => setSelectedAlbum(null)}
          friends={friends}
          onAction={handleAlbumAction}
          onDelete={handleDeleteUserAlbum}
          userAlbum={selectedAlbum}
        />
      )}
    </div>
  );
}