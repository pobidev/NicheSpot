import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import * as api from '../api';
import AlbumCard from '../components/AlbumCard';
import AlbumDetail from '../components/AlbumDetail';
import {
  IconArrowLeft,
  IconArrowRight,
  IconSend,
  IconCheck,
  IconClose,
  IconStar,
  IconDisc,
  IconUsers,
  IconPlus,
  IconHeart,
  IconSpinner,
} from '../components/Icons';

const PAGE_SIZE = 24;

function FriendDetail({ friendId }) {
  const navigate = useNavigate();
  const [friend, setFriend] = useState(null);
  const [tab, setTab] = useState('listened'); // 'listened' | 'to_listen'
  const [page, setPage] = useState(1);
  const [albums, setAlbums] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showRecommend, setShowRecommend] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [recommendError, setRecommendError] = useState('');
  const [recommendSuccess, setRecommendSuccess] = useState('');
  const [selectedAlbum, setSelectedAlbum] = useState(null);
  const [friendsList, setFriendsList] = useState([]);

  useEffect(() => {
    setLoading(true);
    api.getFriends()
      .then((friends) => {
        setFriendsList(friends);
        const f = friends.find((fr) => String(fr.id) === String(friendId));
        setFriend(f || { id: friendId, display_name: 'Amigo' });
      })
      .catch(() => {});

    api.getFriendAlbums(friendId)
      .then((data) => {
        setAlbums(data || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [friendId]);

  // Lock scroll when recommend modal is open
  useEffect(() => {
    if (!showRecommend) return;
    const orig = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') setShowRecommend(false); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = orig;
      window.removeEventListener('keydown', onKey);
    };
  }, [showRecommend]);

  const filtered = albums.filter((a) =>
    tab === 'listened' ? a.status === 'listened' : a.status === 'to_listen'
  );

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE) || 1;
  const paginatedAlbums = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleTabChange = (newTab) => {
    setTab(newTab);
    setPage(1);
  };

  const handleSearch = async () => {
    if (!searchQ.trim()) return;
    setSearching(true);
    setRecommendError('');
    try {
      const data = await api.searchAlbums(searchQ.trim());
      setSearchResults(data || []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const isAlbumAlreadyListenedByFriend = (alb) => {
    return albums.some(
      (a) =>
        a.status === 'listened' &&
        (a.album_id === alb.id ||
          (a.title?.toLowerCase().trim() === alb.title?.toLowerCase().trim() &&
            a.artist?.toLowerCase().trim() === alb.artist?.toLowerCase().trim()))
    );
  };

  const handleRecommend = async (album) => {
    setRecommendError('');
    setRecommendSuccess('');
    try {
      const cached = await api.addAlbum({
        external_id: album.external_id || album.id?.toString(),
        source: album.source || 'musicbrainz',
        title: album.title,
        artist: album.artist,
        year: album.year,
        cover_url: album.cover_url,
      });

      await api.recommendAlbum({ album_id: cached.id, friend_id: friendId });
      setRecommendSuccess(`"${album.title}" recomendado a ${friend?.display_name}`);
      setTimeout(() => {
        setShowRecommend(false);
        setSearchQ('');
        setSearchResults([]);
        setRecommendSuccess('');
      }, 1200);
    } catch (err) {
      setRecommendError(err.message || 'Error al recomendar álbum');
    }
  };

  return (
    <div className="p-4 space-y-4">
      <button
        onClick={() => navigate('/friends')}
        className="text-primary hover:text-primaryhover text-xs font-semibold flex items-center gap-1.5 transition-colors"
      >
        <IconArrowLeft className="w-3.5 h-3.5" />
        <span>Volver a amigos</span>
      </button>

      <div className="flex items-center justify-between gap-3 bg-card border border-borderc/50 rounded-2xl p-4 shadow-xs">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-12 h-12 rounded-full bg-primarysubtle text-primary border border-primary/20 flex items-center justify-center font-bold text-base flex-shrink-0">
            {(friend?.display_name || friend?.username || '?')[0].toUpperCase()}
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-main truncate">{friend?.display_name}</h2>
            {friend?.username && <p className="text-xs text-muted truncate">@{friend.username}</p>}
          </div>
        </div>

        <button
          onClick={() => { setShowRecommend(true); setRecommendError(''); setRecommendSuccess(''); }}
          className="px-3.5 py-2 rounded-xl bg-primary hover:bg-primaryhover text-white text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-[0.98] shadow-xs flex-shrink-0"
        >
          <IconSend className="w-3.5 h-3.5" />
          <span>Recomendar</span>
        </button>
      </div>

      {/* Tabs Escuchados / Por escuchar (Segmented control) */}
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
          <span>Escuchados ({albums.filter((a) => a.status === 'listened').length})</span>
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
          <span>Por escuchar ({albums.filter((a) => a.status === 'to_listen').length})</span>
        </button>
      </div>

      {/* Paginación superior si hay más de 1 página */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs px-1">
          <span className="text-muted">
            Página <strong className="text-main">{page}</strong> de {totalPages} ({filtered.length} álbumes)
          </span>
          <div className="flex gap-1.5">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-2.5 py-1 rounded-lg bg-card border border-borderc/60 disabled:opacity-30 text-main text-xs font-semibold"
            >
              ← Ant.
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="px-2.5 py-1 rounded-lg bg-card border border-borderc/60 disabled:opacity-30 text-main text-xs font-semibold"
            >
              Sig. →
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <IconSpinner className="w-6 h-6 text-primary" />
        </div>
      ) : paginatedAlbums.length > 0 ? (
        <div className="space-y-2">
          {paginatedAlbums.map((a) => (
            <div key={a.user_album_id || a.id} className="relative">
              <AlbumCard album={a} compact onClick={() => setSelectedAlbum(a)} />
              {a.status === 'listened' && a.rating && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-primary bg-primarysubtle border border-primary/20 px-2 py-0.5 rounded-md flex items-center gap-1">
                  <IconStar className="w-3 h-3 fill-current" />
                  <span>{a.rating}/10</span>
                </span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 bg-card/40 border border-borderc/30 rounded-2xl p-6 flex flex-col items-center">
          <div className="w-12 h-12 rounded-2xl bg-inputbg border border-borderc/40 flex items-center justify-center text-muted mb-3">
            <IconDisc className="w-6 h-6" />
          </div>
          <p className="text-sm font-semibold text-main">Sin álbumes en esta lista</p>
          <p className="text-xs text-muted mt-1">Usa el botón Recomendar para enviarle un álbum.</p>
        </div>
      )}

      {/* Paginación inferior si hay más de 1 página */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs pt-1 px-1">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-3.5 py-1.5 rounded-xl bg-card border border-borderc/60 disabled:opacity-30 text-main font-semibold shadow-xs"
          >
            ← Anterior
          </button>
          <span className="text-muted">
            Página {page} de {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="px-3.5 py-1.5 rounded-xl bg-card border border-borderc/60 disabled:opacity-30 text-main font-semibold shadow-xs"
          >
            Siguiente →
          </button>
        </div>
      )}

      {/* Modal Recomendar Álbum (Centrado y en Portal) */}
      {showRecommend &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
            onClick={(e) => { if (e.target === e.currentTarget) setShowRecommend(false); }}
          >
            <div
              className="relative w-full max-w-md max-h-[85dvh] overflow-y-auto rounded-2xl bg-card border border-borderc p-5 shadow-2xl space-y-4 animate-modal-in"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-bold text-main">Recomendar a {friend?.display_name}</h3>
                <button
                  onClick={() => setShowRecommend(false)}
                  className="text-muted hover:text-main p-1.5 rounded-lg hover:bg-cardhover transition-colors"
                >
                  <IconClose className="w-4 h-4" />
                </button>
              </div>

              {recommendError && (
                <div className="p-2.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 text-xs text-center font-medium">
                  {recommendError}
                </div>
              )}

              {recommendSuccess && (
                <div className="p-2.5 rounded-xl bg-primarysubtle border border-primary/30 text-primary text-xs text-center font-medium flex items-center justify-center gap-1.5">
                  <IconCheck className="w-4 h-4" />
                  <span>{recommendSuccess}</span>
                </div>
              )}

              <div className="flex gap-2">
                <input
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="Álbum, canción o artista..."
                  className="flex-1 bg-inputbg border border-borderc rounded-xl p-2.5 text-main placeholder-muted text-xs focus:outline-none focus:border-primary"
                />
                <button
                  onClick={handleSearch}
                  className="px-3.5 py-2.5 rounded-xl bg-primary hover:bg-primaryhover text-white text-xs font-semibold transition-all active:scale-[0.98]"
                >
                  Buscar
                </button>
              </div>

              {searching && (
                <div className="flex justify-center py-4">
                  <IconSpinner className="w-5 h-5 text-primary" />
                </div>
              )}

              <div className="space-y-2 max-h-[50dvh] overflow-y-auto pr-1">
                {searchResults.map((album, i) => {
                  const alreadyListened = isAlbumAlreadyListenedByFriend(album);

                  return (
                    <div
                      key={album.external_id || i}
                      className="flex items-center gap-2.5 p-2 rounded-xl bg-inputbg border border-borderc/40 hover:bg-cardhover transition-colors"
                    >
                      <img
                        src={album.cover_url || '/default-cover.svg'}
                        onError={(e) => { e.target.src = '/default-cover.svg'; }}
                        alt=""
                        className="w-11 h-11 rounded-lg object-cover flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-main truncate">{album.title}</p>
                        <p className="text-[11px] text-muted truncate">{album.artist}</p>
                        {alreadyListened && (
                          <span className="text-[10px] text-primary flex items-center gap-1 font-medium mt-0.5">
                            <IconCheck className="w-2.5 h-2.5" />
                            <span>Ya escuchado por {friend?.display_name}</span>
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => handleRecommend(album)}
                        disabled={alreadyListened}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex-shrink-0 flex items-center gap-1 ${
                          alreadyListened
                            ? 'bg-borderc/30 text-muted cursor-not-allowed border border-borderc/30'
                            : 'bg-primary hover:bg-primaryhover text-white shadow-xs active:scale-[0.98]'
                        }`}
                      >
                        <IconSend className="w-3 h-3" />
                        <span>{alreadyListened ? 'Escuchado' : 'Recomendar'}</span>
                      </button>
                    </div>
                  );
                })}
                {searchQ && !searching && searchResults.length === 0 && (
                  <p className="text-center text-xs text-muted py-4">No se encontraron resultados</p>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}

      {selectedAlbum && (
        <AlbumDetail
          album={selectedAlbum}
          onClose={() => setSelectedAlbum(null)}
          friends={friendsList}
          userAlbum={selectedAlbum}
          onAction={async (action) => {
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
          }}
        />
      )}
    </div>
  );
}

export default function Friends() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [friends, setFriends] = useState([]);
  const [pending, setPending] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedAlbum, setSelectedAlbum] = useState(null);

  const loadData = () => {
    setLoading(true);
    Promise.all([
      api.getFriends().catch(() => []),
      api.getPending().catch(() => []),
      api.getRecommendations().catch(() => []),
    ]).then(([f, p, r]) => {
      setFriends(f || []);
      setPending(p || []);
      setRecommendations(r || []);
      setLoading(false);
    });
  };

  useEffect(() => {
    if (id) return;
    loadData();
  }, [id]);

  const handleAccept = async (reqId) => {
    try {
      await api.acceptFriend(reqId);
      loadData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleReject = async (reqId) => {
    try {
      await api.removeFriend(reqId);
      loadData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDismissRecommendation = async (rec, e) => {
    if (e) e.stopPropagation();
    try {
      setRecommendations((prev) =>
        prev.filter((r) => r.user_album_id !== rec.user_album_id && r.album_id !== rec.album_id)
      );
      await fetch(`/api/friends/recommendations/${rec.album_id || rec.user_album_id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
      });
    } catch (err) {
      console.error('Error descartando recomendación:', err);
    }
  };

  const handleRecommendationAction = async (action) => {
    if (!selectedAlbum) return;
    const targetAlbum = selectedAlbum;

    setRecommendations((prev) =>
      prev.filter(
        (r) =>
          r.user_album_id !== targetAlbum.user_album_id &&
          r.album_id !== targetAlbum.album_id
      )
    );
    setSelectedAlbum(null);

    try {
      const cached = await api.addAlbum({
        external_id: targetAlbum.external_id || targetAlbum.id?.toString(),
        source: targetAlbum.source || 'musicbrainz',
        title: targetAlbum.title,
        artist: targetAlbum.artist,
        year: targetAlbum.year,
        cover_url: targetAlbum.cover_url,
      });

      await api.addUserAlbum({
        album_id: cached.id,
        status: action.status,
        rating: action.rating,
        note: action.note,
      });

      loadData();
    } catch (err) {
      console.error('Error aplicando recomendación:', err);
      loadData();
    }
  };

  if (id) return <FriendDetail friendId={id} />;

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <IconSpinner className="w-7 h-7 text-primary" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6">
      {/* Solicitudes de amistad pendientes */}
      {pending.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-main uppercase tracking-wider px-0.5">
              Solicitudes pendientes
            </h3>
            <span className="text-xs bg-primarysubtle text-primary font-bold px-2 py-0.5 rounded-full">
              {pending.length}
            </span>
          </div>
          <div className="space-y-2">
            {pending.map((req) => (
              <div
                key={req.id}
                className="bg-card border border-borderc/50 rounded-xl p-3 flex items-center justify-between gap-3 shadow-xs"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-primarysubtle text-primary border border-primary/20 flex items-center justify-center font-bold text-xs flex-shrink-0">
                    {(req.display_name || req.username || '?')[0].toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-xs text-main truncate">{req.display_name}</p>
                    <p className="text-[11px] text-muted truncate">@{req.username}</p>
                  </div>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleAccept(req.id)}
                    className="px-3 py-1.5 rounded-xl bg-primary hover:bg-primaryhover text-white text-xs font-semibold transition-all active:scale-[0.98] shadow-xs flex items-center gap-1"
                  >
                    <IconCheck className="w-3.5 h-3.5" />
                    <span>Aceptar</span>
                  </button>
                  <button
                    onClick={() => handleReject(req.id)}
                    className="px-3 py-1.5 rounded-xl bg-inputbg hover:bg-cardhover border border-borderc text-muted hover:text-main text-xs font-semibold transition-all active:scale-[0.98]"
                  >
                    Rechazar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recomendaciones de amigos recibidas */}
      {recommendations.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-xs font-bold text-main uppercase tracking-wider px-0.5">
            Recomendaciones recibidas ({recommendations.length})
          </h3>
          <div className="space-y-2">
            {recommendations.map((rec) => (
              <div
                key={rec.user_album_id || rec.album_id}
                onClick={() => setSelectedAlbum(rec)}
                className="bg-card hover:bg-cardhover border border-primary/30 rounded-xl p-3 flex items-center gap-3 cursor-pointer transition-colors shadow-xs active:scale-[0.99]"
              >
                <img
                  src={rec.cover_url || '/default-cover.svg'}
                  onError={(e) => { e.target.src = '/default-cover.svg'; }}
                  alt=""
                  className="w-12 h-12 rounded-lg object-cover flex-shrink-0 bg-inputbg"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-main truncate leading-tight">{rec.title}</p>
                  <p className="text-xs text-muted truncate mt-0.5">{rec.artist}</p>
                  <p className="text-xs text-primary font-medium mt-1 flex items-center gap-1">
                    <IconHeart className="w-3 h-3 fill-current flex-shrink-0" />
                    <span>Recomendado por {rec.recommended_by || rec.recommender_display_name || 'un amigo'}</span>
                  </p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    type="button"
                    onClick={(e) => handleDismissRecommendation(rec, e)}
                    className="p-1.5 text-muted hover:text-red-400 rounded-lg hover:bg-inputbg transition-colors"
                    title="Descartar"
                    aria-label="Descartar recomendación"
                  >
                    <IconClose className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-xs text-primary font-medium flex items-center gap-0.5">
                    <span>Ver</span>
                    <IconArrowRight className="w-3 h-3" />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Lista de amigos */}
      <section className="space-y-3">
        <div className="flex items-center justify-between px-0.5">
          <h3 className="text-xs font-bold text-main uppercase tracking-wider">
            Mis amigos ({friends.length})
          </h3>
          <button
            onClick={() => navigate('/search')}
            className="text-xs text-primary hover:text-primaryhover font-semibold flex items-center gap-1"
          >
            <IconPlus className="w-3 h-3" />
            <span>Buscar más</span>
          </button>
        </div>

        {friends.length > 0 ? (
          <div className="space-y-2">
            {friends.map((friend) => (
              <div
                key={friend.id}
                onClick={() => navigate(`/friends/${friend.id}`)}
                className="bg-card hover:bg-cardhover border border-borderc/40 rounded-xl p-3 flex items-center justify-between cursor-pointer transition-colors shadow-xs active:scale-[0.99]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-primarysubtle text-primary border border-primary/20 flex items-center justify-center font-bold text-xs flex-shrink-0">
                    {(friend.display_name || friend.username || '?')[0].toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-xs text-main truncate">{friend.display_name}</p>
                    <p className="text-[11px] text-muted truncate">@{friend.username}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-muted text-xs font-medium">
                  <span>Ver lista</span>
                  <IconArrowRight className="w-3.5 h-3.5" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-10 bg-card/40 border border-borderc/30 rounded-2xl p-6 flex flex-col items-center">
            <div className="w-12 h-12 rounded-2xl bg-inputbg border border-borderc/40 flex items-center justify-center text-muted mb-3">
              <IconUsers className="w-6 h-6" />
            </div>
            <p className="text-sm font-semibold text-main">Aún no tienes amigos añadidos</p>
            <p className="text-xs text-muted mt-1 max-w-xs">
              Ve a Buscar amigos para conectar con personas y compartir álbumes.
            </p>
            <button
              onClick={() => navigate('/search')}
              className="mt-3.5 px-4 py-2 rounded-xl bg-primary hover:bg-primaryhover text-white text-xs font-semibold transition-all active:scale-[0.98] shadow-xs flex items-center gap-1.5"
            >
              <IconPlus className="w-3.5 h-3.5" />
              <span>Buscar amigos</span>
            </button>
          </div>
        )}
      </section>

      {/* Modal detalle cuando se pulsa una recomendación */}
      {selectedAlbum && (
        <AlbumDetail
          album={selectedAlbum}
          onClose={() => setSelectedAlbum(null)}
          friends={friends}
          userAlbum={selectedAlbum}
          onAction={handleRecommendationAction}
        />
      )}
    </div>
  );
}
