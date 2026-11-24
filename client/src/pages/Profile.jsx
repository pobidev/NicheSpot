import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import * as api from '../api';
import AlbumCard from '../components/AlbumCard';
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
} from '../components/Icons';

const PAGE_SIZE = 24;

export default function Profile() {
  const { user, logout, updateUser } = useAuth();
  const { theme, setTheme, themes } = useTheme();

  const [profile, setProfile] = useState(null);
  const [tab, setTab] = useState('listened'); // 'listened' | 'to_listen'
  const [page, setPage] = useState(1);
  const [albums, setAlbums] = useState([]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ display_name: '', lastfm_username: '' });
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedAlbum, setSelectedAlbum] = useState(null);
  const [friends, setFriends] = useState([]);

  const loadData = () => {
    setLoading(true);
    Promise.all([
      api.getProfile().catch(() => null),
      api.getUserAlbums().catch(() => []),
      api.getFriends().catch(() => []),
    ]).then(([p, a, f]) => {
      setProfile(p);
      setAlbums(a || []);
      setFriends(f || []);
      if (p) setForm({ display_name: p.display_name || '', lastfm_username: p.lastfm_username || '' });
      setLoading(false);
    });
  };

  useEffect(loadData, []);

  const listened = albums.filter((a) => a.status === 'listened');
  const toListen = albums.filter((a) => a.status === 'to_listen');
  const displayed = tab === 'listened' ? listened : toListen;

  // Pagination calculation
  const totalPages = Math.ceil(displayed.length / PAGE_SIZE) || 1;
  const paginatedAlbums = displayed.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleTabChange = (newTab) => {
    setTab(newTab);
    setPage(1);
  };

  const handleSave = async () => {
    try {
      const updated = await api.updateProfile(form);
      setProfile((prev) => ({ ...prev, ...updated }));
      updateUser({ ...user, display_name: form.display_name, lastfm_username: form.lastfm_username });
      setEditing(false);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await api.syncLastfm();
      setSyncMessage({
        type: 'success',
        text: res.message || `Sincronizados ${res.imported} nuevos álbumes (total: ${res.total_found || res.imported})`,
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
    const uaId = selectedAlbum.user_album_id || (selectedAlbum.user_id ? selectedAlbum.id : null);
    if (uaId) {
      await api.updateUserAlbum(uaId, {
        status: action.status,
        rating: action.rating,
        note: action.note,
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
      });
    }
    loadData();
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <IconSpinner className="w-7 h-7 text-primary" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-5">
      {/* Cabecera de usuario con botón de cerrar sesión arriba */}
      <div className="bg-card border border-borderc/50 rounded-2xl p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-13 h-13 rounded-full bg-primarysubtle text-primary border border-primary/20 flex items-center justify-center text-lg font-bold flex-shrink-0">
              {(profile?.display_name || user?.username || '?')[0].toUpperCase()}
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-main truncate">
                {profile?.display_name || user?.display_name}
              </h2>
              <p className="text-xs text-muted truncate">@{profile?.username || user?.username}</p>
            </div>
          </div>

          {/* Botón Cerrar sesión ubicado arriba */}
          <button
            onClick={logout}
            className="px-3 py-1.5 rounded-xl border border-red-500/30 hover:bg-red-500/10 text-red-400 text-xs font-semibold transition-all active:scale-[0.98] flex items-center gap-1.5 flex-shrink-0"
          >
            <IconLogout className="w-3.5 h-3.5" />
            <span>Cerrar sesión</span>
          </button>
        </div>

        {/* Estadísticas de álbumes */}
        <div className="grid grid-cols-2 gap-3">
          <div
            onClick={() => handleTabChange('listened')}
            className={`border rounded-xl p-3 text-center cursor-pointer transition-all active:scale-[0.99] ${
              tab === 'listened'
                ? 'bg-primarysubtle border-primary shadow-xs'
                : 'bg-inputbg border-borderc/40 hover:bg-cardhover'
            }`}
          >
            <p className="text-2xl font-bold text-primary">{listened.length}</p>
            <p className="text-xs text-muted font-medium mt-0.5">Escuchados</p>
          </div>
          <div
            onClick={() => handleTabChange('to_listen')}
            className={`border rounded-xl p-3 text-center cursor-pointer transition-all active:scale-[0.99] ${
              tab === 'to_listen'
                ? 'bg-primarysubtle border-primary shadow-xs'
                : 'bg-inputbg border-borderc/40 hover:bg-cardhover'
            }`}
          >
            <p className="text-2xl font-bold text-primary">{toListen.length}</p>
            <p className="text-xs text-muted font-medium mt-0.5">Por escuchar</p>
          </div>
        </div>

        {/* Formulario de edición de perfil */}
        {editing ? (
          <div className="space-y-3 pt-1 border-t border-borderc/40">
            <div>
              <label className="text-xs text-muted block mb-1">Nombre para mostrar</label>
              <input
                value={form.display_name}
                onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                placeholder="Nombre para mostrar"
                className="w-full bg-inputbg border border-borderc rounded-xl p-2.5 text-main placeholder-muted text-xs focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">Usuario de Last.fm (opcional)</label>
              <input
                value={form.lastfm_username}
                onChange={(e) => setForm({ ...form, lastfm_username: e.target.value })}
                placeholder="Ej: tu_usuario_lastfm"
                className="w-full bg-inputbg border border-borderc rounded-xl p-2.5 text-main placeholder-muted text-xs focus:outline-none focus:border-primary"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setEditing(false)}
                className="flex-1 py-2 rounded-xl bg-inputbg border border-borderc text-main text-xs font-semibold hover:bg-cardhover transition-all active:scale-[0.98]"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                className="flex-1 py-2 rounded-xl bg-primary hover:bg-primaryhover text-white text-xs font-semibold transition-all active:scale-[0.98] shadow-xs"
              >
                Guardar cambios
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="w-full py-2.5 rounded-xl bg-inputbg hover:bg-cardhover border border-borderc/60 text-main text-xs font-semibold transition-all active:scale-[0.99] flex items-center justify-center gap-1.5"
          >
            <IconEdit className="w-3.5 h-3.5" />
            <span>Editar perfil</span>
          </button>
        )}
      </div>

      {/* SELECTOR DE TEMA DE COLOR */}
      <div className="bg-card border border-borderc/50 rounded-2xl p-4 shadow-xs space-y-3">
        <h3 className="text-xs font-bold text-main uppercase tracking-wider flex items-center gap-1.5">
          <IconPalette className="w-4 h-4 text-primary" />
          <span>Tema visual</span>
        </h3>
        <div className="grid grid-cols-3 gap-2">
          {themes.map((t) => {
            const isSelected = theme === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                className={`flex items-center gap-2 p-2.5 rounded-xl border text-left transition-all active:scale-[0.98] ${
                  isSelected
                    ? 'border-primary ring-2 ring-primary/30 bg-inputbg shadow-xs font-semibold'
                    : 'border-borderc/40 bg-inputbg/50 hover:bg-inputbg'
                }`}
              >
                <span
                  className="w-3.5 h-3.5 rounded-full flex-shrink-0 border border-white/20"
                  style={{ backgroundColor: t.color }}
                />
                <span className="text-xs text-main truncate">{t.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Sincronización completa con Last.fm */}
      {(profile?.lastfm_username || form.lastfm_username) && (
        <div className="bg-card border border-borderc/50 rounded-2xl p-4 shadow-xs space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold text-main flex items-center gap-1.5">
                <IconRadio className="w-4 h-4 text-primary flex-shrink-0" />
                <span>Sincronización con Last.fm</span>
              </p>
              <p className="text-xs text-muted truncate mt-0.5">
                @{profile?.lastfm_username || form.lastfm_username}
              </p>
            </div>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="px-3.5 py-2 rounded-xl bg-primary hover:bg-primaryhover disabled:opacity-50 text-white text-xs font-semibold transition-all active:scale-[0.98] flex items-center gap-1.5 flex-shrink-0 shadow-xs"
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
              className={`text-xs p-2.5 rounded-xl border flex items-center gap-1.5 ${
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
      )}

      {/* Selector de pestañas unificado estilo segmented control */}
      <div className="space-y-3">
        <div className="p-1 bg-inputbg rounded-xl border border-borderc/60 flex gap-1">
          <button
            type="button"
            onClick={() => handleTabChange('listened')}
            className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 active:scale-[0.99] ${
              tab === 'listened'
                ? 'bg-primary text-white shadow-xs font-bold'
                : 'text-muted hover:text-main'
            }`}
          >
            {tab === 'listened' && <span className="inline-block w-1.5 h-1.5 rounded-full bg-white" />}
            <span>Escuchados ({listened.length})</span>
          </button>
          <button
            type="button"
            onClick={() => handleTabChange('to_listen')}
            className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 active:scale-[0.99] ${
              tab === 'to_listen'
                ? 'bg-primary text-white shadow-xs font-bold'
                : 'text-muted hover:text-main'
            }`}
          >
            {tab === 'to_listen' && <span className="inline-block w-1.5 h-1.5 rounded-full bg-white" />}
            <span>Por escuchar ({toListen.length})</span>
          </button>
        </div>

        {/* Controles de paginación superiores (si hay más de 1 página) */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-xs px-1">
            <span className="text-muted">
              Página <strong className="text-main">{page}</strong> de {totalPages} ({displayed.length} álbumes)
            </span>
            <div className="flex gap-1.5">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-2.5 py-1 rounded-lg bg-card border border-borderc/60 disabled:opacity-30 text-main text-xs font-semibold flex items-center gap-1"
              >
                <IconArrowLeft className="w-3 h-3" />
                <span>Ant.</span>
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="px-2.5 py-1 rounded-lg bg-card border border-borderc/60 disabled:opacity-30 text-main text-xs font-semibold flex items-center gap-1"
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
            {paginatedAlbums.map((album) => (
              <div key={album.user_album_id || album.id} className="relative">
                <AlbumCard
                  album={album}
                  compact
                  onClick={() => setSelectedAlbum({ ...album, user_album_id: album.user_album_id || album.id })}
                />
                {album.status === 'listened' && album.rating && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-primary bg-primarysubtle border border-primary/20 px-2 py-0.5 rounded-md flex items-center gap-1">
                    <IconStar className="w-3 h-3 fill-current" />
                    <span>{album.rating}/10</span>
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-10 bg-card/40 border border-borderc/30 rounded-2xl p-6 flex flex-col items-center">
            <div className="w-12 h-12 rounded-2xl bg-inputbg border border-borderc/40 flex items-center justify-center text-muted mb-3">
              <IconDisc className="w-6 h-6" />
            </div>
            <p className="text-sm font-semibold text-main">
              {tab === 'listened' ? 'Aún no has valorado ningún álbum' : 'No tienes álbumes pendientes'}
            </p>
            <p className="text-xs text-muted mt-1">Busca canciones o álbumes en la pestaña Buscar.</p>
          </div>
        )}

        {/* Controles de paginación inferiores (si hay más de 1 página) */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-xs pt-2 px-1">
            <button
              disabled={page <= 1}
              onClick={() => { setPage((p) => Math.max(1, p - 1)); window.scrollTo({ top: 300, behavior: 'smooth' }); }}
              className="px-3.5 py-1.5 rounded-xl bg-card border border-borderc/60 disabled:opacity-30 text-main font-semibold shadow-xs flex items-center gap-1"
            >
              <IconArrowLeft className="w-3.5 h-3.5" />
              <span>Anterior</span>
            </button>
            <span className="text-muted">
              Página {page} de {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => { setPage((p) => Math.min(totalPages, p + 1)); window.scrollTo({ top: 300, behavior: 'smooth' }); }}
              className="px-3.5 py-1.5 rounded-xl bg-card border border-borderc/60 disabled:opacity-30 text-main font-semibold shadow-xs flex items-center gap-1"
            >
              <span>Siguiente</span>
              <IconArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Modal detalle cuando se pulsa un álbum de la lista */}
      {selectedAlbum && (
        <AlbumDetail
          album={selectedAlbum}
          onClose={() => setSelectedAlbum(null)}
          friends={friends}
          onAction={handleAlbumAction}
          userAlbum={selectedAlbum}
        />
      )}
    </div>
  );
}
