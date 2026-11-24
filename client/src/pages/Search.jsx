import { useState, useEffect, useCallback } from 'react';
import * as api from '../api';
import AlbumCard from '../components/AlbumCard';
import AlbumDetail from '../components/AlbumDetail';
import {
  IconSearch,
  IconMusic,
  IconUsers,
  IconClose,
  IconDisc,
  IconPlus,
  IconCheck,
  IconStar,
  IconSpinner,
} from '../components/Icons';

export default function Search() {
  const [tab, setTab] = useState('albums'); // 'albums' | 'users'
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [feed, setFeed] = useState([]);
  const [userResults, setUserResults] = useState([]);
  const [selectedAlbum, setSelectedAlbum] = useState(null);
  const [friends, setFriends] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [requestSent, setRequestSent] = useState({});

  // Load feed and friends when on albums tab without query
  useEffect(() => {
    if (tab === 'albums') {
      api.getFriends().then(setFriends).catch(() => []);
      if (!query.trim()) {
        api.getFeed().then(setFeed).catch(() => setFeed([]));
      }
    }
  }, [tab, query]);

  // Load all users by default when on users tab
  useEffect(() => {
    if (tab === 'users' && !query.trim()) {
      setLoading(true);
      api.searchUsers('')
        .then((data) => {
          setUserResults(data);
          setLoading(false);
        })
        .catch(() => {
          setUserResults([]);
          setLoading(false);
        });
    }
  }, [tab, query]);

  // Search albums (unified: album title, track, or artist)
  const searchAlbums = useCallback(async (q) => {
    if (!q.trim()) {
      setResults([]);
      setSearchError(null);
      return;
    }
    setLoading(true);
    setSearchError(null);
    try {
      const data = await api.searchAlbums(q.trim());
      setResults(data || []);
    } catch (err) {
      console.error('Error buscando álbumes:', err);
      setSearchError('No se pudo completar la búsqueda. Inténtalo de nuevo.');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Search users
  const searchUsers = useCallback(async (q) => {
    setLoading(true);
    try {
      const data = await api.searchUsers(q.trim());
      setUserResults(data || []);
    } catch (err) {
      console.error('Error buscando usuarios:', err);
      setUserResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search trigger
  useEffect(() => {
    const timer = setTimeout(() => {
      if (tab === 'albums') {
        if (query.trim()) searchAlbums(query);
        else setResults([]);
      } else {
        searchUsers(query);
      }
    }, 450);

    return () => clearTimeout(timer);
  }, [query, tab, searchAlbums, searchUsers]);

  const handleAlbumAction = async (action) => {
    if (!selectedAlbum) return;
    const cached = await api.addAlbum({
      external_id: selectedAlbum.external_id || selectedAlbum.id?.toString(),
      source: selectedAlbum.source || 'musicbrainz',
      title: selectedAlbum.title,
      artist: selectedAlbum.artist,
      year: selectedAlbum.year,
      cover_url: selectedAlbum.cover_url,
    });

    if (action.type === 'recommend') {
      await api.recommendAlbum({ album_id: cached.id, friend_id: action.friend_id });
    } else {
      await api.addUserAlbum({
        album_id: cached.id,
        status: action.status,
        rating: action.rating,
        note: action.note,
      });
    }
  };

  const handleFriendRequest = async (userId) => {
    try {
      await api.sendFriendRequest({ friend_id: userId });
      setRequestSent((prev) => ({ ...prev, [userId]: true }));
      const updated = await api.searchUsers(query);
      setUserResults(updated);
    } catch (err) {
      console.error('Error enviando solicitud de amistad:', err);
    }
  };

  const handleAcceptFriend = async (friendshipId) => {
    try {
      await api.acceptFriend(friendshipId);
      const updated = await api.searchUsers(query);
      setUserResults(updated);
      const updatedFriends = await api.getFriends();
      setFriends(updatedFriends);
    } catch (err) {
      console.error('Error aceptando solicitud:', err);
    }
  };

  return (
    <div className="p-4 space-y-4">
      {/* Selector de modo: Música / Buscar amigos (Segmented control) */}
      <div className="p-1 bg-inputbg rounded-xl border border-borderc/60 flex gap-1">
        <button
          type="button"
          onClick={() => { setTab('albums'); setQuery(''); setSearchError(null); }}
          className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 active:scale-[0.99] ${
            tab === 'albums'
              ? 'bg-primary text-white shadow-xs font-bold'
              : 'text-muted hover:text-main'
          }`}
        >
          <IconMusic className="w-3.5 h-3.5" />
          <span>Buscar música</span>
        </button>
        <button
          type="button"
          onClick={() => { setTab('users'); setQuery(''); setSearchError(null); }}
          className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 active:scale-[0.99] ${
            tab === 'users'
              ? 'bg-primary text-white shadow-xs font-bold'
              : 'text-muted hover:text-main'
          }`}
        >
          <IconUsers className="w-3.5 h-3.5" />
          <span>Buscar amigos</span>
        </button>
      </div>

      {/* Input de búsqueda unificada */}
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            tab === 'albums'
              ? 'Álbum, canción o artista (ej: Bohemian Rhapsody, Daft Punk...)'
              : 'Filtrar por nombre o usuario...'
          }
          className="w-full bg-inputbg border border-borderc rounded-xl py-2.5 pl-10 pr-9 text-xs text-main placeholder-muted focus:outline-none focus:border-primary transition-colors shadow-xs"
        />
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none">
          <IconSearch className="w-4 h-4" />
        </span>
        {query && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-main p-1 rounded-md"
            aria-label="Limpiar búsqueda"
          >
            <IconClose className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Spinner de carga */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted">
          <IconSpinner className="w-6 h-6 text-primary" />
          <span className="text-xs">
            {tab === 'albums' ? 'Buscando en MusicBrainz...' : 'Cargando usuarios...'}
          </span>
        </div>
      )}

      {/* Error de búsqueda */}
      {searchError && !loading && (
        <div className="p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 text-xs text-center font-medium">
          {searchError}
        </div>
      )}

      {/* PESTAÑA 1: MÚSICA */}
      {tab === 'albums' && !loading && (
        <>
          {query.trim() ? (
            results.length > 0 ? (
              <div className="space-y-3">
                <p className="text-xs font-medium text-muted px-0.5">
                  {results.length} {results.length === 1 ? 'álbum encontrado' : 'álbumes encontrados'}
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {results.map((album, i) => (
                    <AlbumCard
                      key={album.external_id || i}
                      album={album}
                      onClick={() => setSelectedAlbum(album)}
                    />
                  ))}
                </div>
              </div>
            ) : (
              !searchError && (
                <div className="text-center py-12 flex flex-col items-center justify-center">
                  <div className="w-12 h-12 rounded-2xl bg-inputbg border border-borderc/40 flex items-center justify-center text-muted mb-3">
                    <IconSearch className="w-6 h-6" />
                  </div>
                  <p className="text-sm font-semibold text-main">No se encontraron álbumes</p>
                  <p className="text-xs text-muted mt-1">Prueba con el nombre del álbum, artista o canción</p>
                </div>
              )
            )
          ) : (
            /* Sin búsqueda activa: Feed de amigos */
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-main uppercase tracking-wider px-0.5">
                Actividad reciente de amigos
              </h3>
              {feed.length > 0 ? (
                <div className="space-y-2">
                  {feed.map((item, i) => (
                    <div
                      key={i}
                      onClick={() => setSelectedAlbum(item)}
                      className="bg-card hover:bg-cardhover border border-borderc/40 rounded-xl p-3 flex items-center gap-3 cursor-pointer transition-colors shadow-xs active:scale-[0.99]"
                    >
                      <img
                        src={item.cover_url || '/default-cover.svg'}
                        alt={item.title}
                        onError={(e) => { e.target.src = '/default-cover.svg'; }}
                        className="w-12 h-12 rounded-lg object-cover flex-shrink-0 bg-inputbg"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-main truncate leading-tight">{item.title}</p>
                        <p className="text-xs text-muted truncate mt-0.5">{item.artist}</p>
                        <p className="text-[11px] text-primary font-medium mt-1 flex items-center gap-1">
                          <span>{item.display_name}</span>
                          <span className="text-muted">·</span>
                          {item.status === 'listened' ? (
                            <span className="flex items-center gap-1">
                              <IconCheck className="w-3 h-3 inline" />
                              <span>Escuchado</span>
                              {item.rating && (
                                <span className="text-primary font-bold">({item.rating}/10)</span>
                              )}
                            </span>
                          ) : (
                            <span className="flex items-center gap-1">
                              <IconDisc className="w-3 h-3 inline" />
                              <span>Por escuchar</span>
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 bg-card/40 border border-borderc/30 rounded-2xl p-6 flex flex-col items-center">
                  <div className="w-12 h-12 rounded-2xl bg-inputbg border border-borderc/40 flex items-center justify-center text-muted mb-3">
                    <IconDisc className="w-6 h-6" />
                  </div>
                  <p className="text-sm font-semibold text-main">Sin actividad reciente</p>
                  <p className="text-xs text-muted mt-1 max-w-xs">
                    Escribe arriba para buscar música o añade amigos para ver sus valoraciones aquí.
                  </p>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* PESTAÑA 2: BUSCAR AMIGOS (LISTADO INICIAL COMPLETO) */}
      {tab === 'users' && !loading && (
        <div className="space-y-3">
          <p className="text-xs font-medium text-muted px-0.5">
            {query.trim()
              ? `${userResults.length} usuarios encontrados`
              : `Usuarios registrados (${userResults.length})`}
          </p>

          {userResults.length > 0 ? (
            <div className="space-y-2">
              {userResults.map((user) => {
                const isSent = requestSent[user.id] || (user.friendship_status === 'pending' && user.is_requester);
                const isReceived = user.friendship_status === 'pending' && !user.is_requester;
                const isFriend = user.friendship_status === 'accepted';

                return (
                  <div
                    key={user.id}
                    className="bg-card border border-borderc/50 rounded-xl p-3 flex items-center justify-between gap-3 shadow-xs"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-full bg-primarysubtle text-primary border border-primary/20 flex items-center justify-center font-bold text-xs flex-shrink-0">
                        {(user.display_name || user.username || '?')[0].toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-xs text-main truncate">{user.display_name}</p>
                        <p className="text-[11px] text-muted truncate">@{user.username}</p>
                      </div>
                    </div>

                    <div className="flex-shrink-0">
                      {isFriend ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primarysubtle text-primary text-xs font-semibold">
                          <IconCheck className="w-3 h-3" />
                          <span>Amigos</span>
                        </span>
                      ) : isReceived ? (
                        <button
                          onClick={() => handleAcceptFriend(user.friendship_id)}
                          className="px-3 py-1.5 rounded-xl bg-primary hover:bg-primaryhover text-white text-xs font-semibold transition-all active:scale-[0.98] shadow-xs flex items-center gap-1"
                        >
                          <IconCheck className="w-3.5 h-3.5" />
                          <span>Aceptar solicitud</span>
                        </button>
                      ) : isSent ? (
                        <span className="px-2.5 py-1 rounded-lg bg-inputbg text-muted border border-borderc text-xs font-semibold">
                          Enviada
                        </span>
                      ) : (
                        <button
                          onClick={() => handleFriendRequest(user.id)}
                          className="px-3 py-1.5 rounded-xl bg-primary hover:bg-primaryhover text-white text-xs font-semibold transition-all active:scale-[0.98] shadow-xs flex items-center gap-1"
                        >
                          <IconPlus className="w-3.5 h-3.5" />
                          <span>Añadir</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-10 bg-card/40 border border-borderc/30 rounded-2xl p-6 flex flex-col items-center">
              <div className="w-12 h-12 rounded-2xl bg-inputbg border border-borderc/40 flex items-center justify-center text-muted mb-3">
                <IconUsers className="w-6 h-6" />
              </div>
              <p className="text-sm font-semibold text-main">No hay usuarios disponibles</p>
              <p className="text-xs text-muted mt-1">
                {query ? 'Ningún usuario coincide con tu búsqueda.' : 'Aún no hay otros usuarios registrados.'}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Modal detalle de álbum */}
      {selectedAlbum && (
        <AlbumDetail
          album={selectedAlbum}
          onClose={() => setSelectedAlbum(null)}
          friends={friends}
          onAction={handleAlbumAction}
        />
      )}
    </div>
  );
}
