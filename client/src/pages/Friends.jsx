import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { useAuth } from '../context/AuthContext';
import * as api from '../api';
import AlbumCard, { AlbumCover } from '../components/AlbumCard';
import AlbumDetail from '../components/AlbumDetail';
import UserAvatar from '../components/UserAvatar';
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
  IconSearch,
  IconMusic,
} from '../components/Icons';

const PAGE_SIZE = 24;
const MAX_FAVORITE_ALBUMS = 10;
const MAX_FAVORITE_TRACKS = 10;

function FriendDetail({ friendId }) {
  const navigate = useNavigate();
  const [friend, setFriend] = useState(null);
  const [favoriteAlbums, setFavoriteAlbums] = useState([]);
  const [favoriteTracks, setFavoriteTracks] = useState([]);
  const [tab, setTab] = useState('listened');
  const [sortBy, setSortBy] = useState('recent');
  const [filterQuery, setFilterQuery] = useState('');
  const [page, setPage] = useState(1);
  const [albums, setAlbums] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showRecommend, setShowRecommend] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [recommendMsg, setRecommendMsg] = useState(null);
  const [selectedAlbum, setSelectedAlbum] = useState(null);
  const [selectedIsFavorite, setSelectedIsFavorite] = useState(false);
  const [friendsList, setFriendsList] = useState([]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.getFriends().catch(() => []),
      api.getFriendAlbums(friendId).catch(() => []),
      api.getFriendFavorites(friendId).catch(() => []),
      api.getFriendFavoriteTracks(friendId).catch(() => []),
    ]).then(([friends, friendAlbums, favs, favTracks]) => {
      setFriendsList(friends);
      setFriend(
        friends.find((fr) => String(fr.id) === String(friendId)) || {
          id: friendId,
          display_name: 'Amigo',
        }
      );
      setAlbums(friendAlbums || []);
      setFavoriteAlbums(Array.isArray(favs) ? favs.slice(0, MAX_FAVORITE_ALBUMS) : []);
      setFavoriteTracks(Array.isArray(favTracks) ? favTracks.slice(0, MAX_FAVORITE_TRACKS) : []);
      setLoading(false);
    });
  }, [friendId]);

  useEffect(() => {
    if (!showRecommend) return;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => e.key === 'Escape' && setShowRecommend(false);
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [showRecommend]);

  const stats = useMemo(() => {
    let listened = 0;
    let partially_listened = 0;
    let to_listen = 0;
    let ratingSum = 0;
    let ratedCount = 0;
    const artists = new Set();

    for (const a of albums) {
      if (a.status === 'listened') listened++;
      else if (a.status === 'partially_listened') partially_listened++;
      else if (a.status === 'to_listen') to_listen++;

      if ((a.status === 'listened' || a.status === 'partially_listened') && a.artist) {
        artists.add(a.artist.trim().toLowerCase());
      }
      if (a.rating != null) {
        ratingSum += Number(a.rating);
        ratedCount++;
      }
    }

    return {
      listened,
      partially_listened,
      to_listen,
      avgRating: ratedCount > 0 ? (ratingSum / ratedCount).toFixed(1) : '—',
      uniqueArtists: artists.size,
    };
  }, [albums]);

  const filtered = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    return albums
      .filter((a) => a.status === tab)
      .filter((a) => {
        if (!q) return true;
        return (
          a.title?.toLowerCase().includes(q) ||
          a.artist?.toLowerCase().includes(q) ||
          a.note?.toLowerCase().includes(q) ||
          a.recommended_by?.toLowerCase().includes(q) ||
          a.tracks?.some((t) => t.listened && t.track_title?.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        if (sortBy === 'artist_asc')
          return (a.artist || '').localeCompare(b.artist || '', undefined, { sensitivity: 'base' });
        if (sortBy === 'title_asc')
          return (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' });
        if (sortBy === 'rating_desc') return (b.rating ?? -1) - (a.rating ?? -1);
        return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
      });
  }, [albums, tab, filterQuery, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginatedAlbums = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleSearch = async () => {
    if (!searchQ.trim()) return;
    setSearching(true);
    setRecommendMsg(null);
    try {
      const data = await api.searchAlbums(searchQ.trim());
      setSearchResults(Array.isArray(data) ? data : data?.results || []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const handleRecommend = async (album) => {
    setRecommendMsg(null);
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
      setRecommendMsg({ type: 'ok', text: `"${album.title}" recomendado a ${friend?.display_name}` });
      setTimeout(() => {
        setShowRecommend(false);
        setSearchQ('');
        setSearchResults([]);
        setRecommendMsg(null);
      }, 1100);
    } catch (err) {
      setRecommendMsg({ type: 'err', text: err.message || 'Error al recomendar álbum' });
    }
  };

  return (
    <div className="p-4 space-y-4">
      <button
        onClick={() => navigate('/friends')}
        className="text-primary hover:text-primaryhover text-xs font-semibold flex items-center gap-1.5"
      >
        <IconArrowLeft className="w-3.5 h-3.5" />
        <span>Volver a amigos</span>
      </button>

      <div className="bg-card border border-borderc rounded-2xl p-4 shadow-xs space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <UserAvatar
              src={friend?.avatar_url}
              name={friend?.display_name}
              username={friend?.username}
              className="w-12 h-12 text-base"
            />
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-main truncate">{friend?.display_name}</h2>
              {friend?.username && <p className="text-xs text-muted truncate">@{friend.username}</p>}
            </div>
          </div>
          <button
            onClick={() => {
              setShowRecommend(true);
              setRecommendMsg(null);
            }}
            className="px-3.5 py-2 rounded-xl bg-primary hover:bg-primaryhover text-white text-xs font-semibold flex items-center gap-1.5 shadow-xs active:scale-[0.98]"
          >
            <IconSend className="w-3.5 h-3.5" />
            <span>Recomendar</span>
          </button>
        </div>

        {/* Estadísticas rápidas del amigo */}
        <div className="grid grid-cols-4 gap-1.5 pt-2 border-t border-borderc text-center">
          <div className="bg-inputbg/70 rounded-xl py-1.5 px-1">
            <p className="text-sm font-bold text-primary">{stats.listened}</p>
            <p className="text-[10px] text-muted">Escuchados</p>
          </div>
          <div className="bg-inputbg/70 rounded-xl py-1.5 px-1">
            <p className="text-sm font-bold text-amber-400">{stats.partially_listened}</p>
            <p className="text-[10px] text-muted">Parciales</p>
          </div>
          <div className="bg-inputbg/70 rounded-xl py-1.5 px-1">
            <p className="text-sm font-bold text-main">{stats.uniqueArtists}</p>
            <p className="text-[10px] text-muted">Artistas</p>
          </div>
          <div className="bg-inputbg/70 rounded-xl py-1.5 px-1">
            <p className="text-sm font-bold text-main flex items-center justify-center gap-0.5">
              <span>{stats.avgRating}</span>
              {stats.avgRating !== '—' && <IconStar className="w-3 h-3 text-primary fill-current" />}
            </p>
            <p className="text-[10px] text-muted">Nota media</p>
          </div>
        </div>
      </div>

      {/* Álbumes Favoritos del amigo (hasta 10) */}
      {favoriteAlbums.length > 0 && (
        <section className="bg-card border border-borderc rounded-2xl p-3.5 space-y-2.5 shadow-xs">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-main uppercase tracking-wider flex items-center gap-1.5">
              <IconStar className="w-3.5 h-3.5 text-primary fill-current" />
              <span>Álbumes Favoritos</span>
            </h3>
            <span className="text-[11px] text-muted">
              {favoriteAlbums.length}/{MAX_FAVORITE_ALBUMS}
            </span>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {favoriteAlbums.map((fav, idx) => {
              const matchedFriendAlbum = albums.find(
                (a) => a.album_id === fav.id || a.id === fav.id
              );
              return (
                <button
                  key={fav.id || idx}
                  type="button"
                  onClick={() => {
                    setSelectedAlbum(matchedFriendAlbum || fav);
                    setSelectedIsFavorite(!matchedFriendAlbum);
                  }}
                  className="group text-left bg-inputbg hover:bg-cardhover border border-borderc hover:border-primary rounded-xl p-1.5 transition-all active:scale-[0.98]"
                >
                  <div className="relative mb-1.5">
                    <AlbumCover
                      src={fav.cover_url}
                      alt={fav.title}
                      className="w-full aspect-square rounded-lg"
                      iconSize="w-5 h-5"
                    />
                    <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded-md bg-black/75 text-white text-[10px] font-bold">
                      #{idx + 1}
                    </span>
                  </div>
                  <p className="text-[11px] font-semibold text-main truncate group-hover:text-primary transition-colors">
                    {fav.title}
                  </p>
                  <p className="text-[10px] text-muted truncate">{fav.artist}</p>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Top 10 Canciones Favoritas del amigo */}
      {favoriteTracks.length > 0 && (
        <section className="bg-card border border-borderc rounded-2xl p-3.5 space-y-2.5 shadow-xs">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-main uppercase tracking-wider flex items-center gap-1.5">
              <IconMusic className="w-3.5 h-3.5 text-primary" />
              <span>Top 10 Canciones Favoritas</span>
            </h3>
            <span className="text-[11px] text-muted">
              {favoriteTracks.length}/{MAX_FAVORITE_TRACKS}
            </span>
          </div>
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
        </section>
      )}

      <div className="p-1 bg-inputbg rounded-xl border border-borderc flex gap-1">
        {[
          { id: 'listened', label: `Escuchados (${stats.listened})` },
          { id: 'partially_listened', label: `Parciales (${stats.partially_listened})` },
          { id: 'to_listen', label: `Por escuchar (${stats.to_listen})` },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTab(t.id);
              setPage(1);
            }}
            className={`flex-1 py-2 px-2 rounded-lg text-[11px] font-semibold transition-all ${
              tab === t.id ? 'bg-primary text-white shadow-xs font-bold' : 'text-muted hover:text-main'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

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
        >
          <option value="recent">Más recientes</option>
          <option value="artist_asc">Artista (A-Z)</option>
          <option value="title_asc">Álbum (A-Z)</option>
          <option value="rating_desc">Mayor puntuación</option>
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <IconSpinner className="w-6 h-6 text-primary" />
        </div>
      ) : paginatedAlbums.length > 0 ? (
        <div className="space-y-2">
          {paginatedAlbums.map((a) => {
            const listenedCount = Array.isArray(a.tracks)
              ? a.tracks.filter((t) => t.listened).length
              : 0;
            return (
              <AlbumCard
                key={a.user_album_id || a.id}
                album={a}
                compact
                onClick={() => {
                  setSelectedAlbum(a);
                  setSelectedIsFavorite(false);
                }}
                rightContent={
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {a.status === 'partially_listened' && a.tracks?.length > 0 && (
                      <span className="text-[11px] font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md flex items-center gap-1">
                        <IconMusic className="w-3 h-3" />
                        <span>
                          {listenedCount}/{a.tracks.length}
                        </span>
                      </span>
                    )}
                    {a.status !== 'to_listen' && a.rating != null && (
                      <span className="text-xs font-bold text-primary bg-primarysubtle border border-primary px-2 py-0.5 rounded-md flex items-center gap-1">
                        <IconStar className="w-3 h-3 fill-current" />
                        <span>{a.rating}/10</span>
                      </span>
                    )}
                  </div>
                }
              />
            );
          })}
        </div>
      ) : (
        <div className="text-center py-12 bg-card border border-borderc rounded-2xl p-6 flex flex-col items-center">
          <IconDisc className="w-7 h-7 text-muted mb-2" />
          <p className="text-sm font-semibold text-main">
            {filterQuery ? 'Ningún álbum coincide con tu búsqueda' : 'Sin álbumes en esta lista'}
          </p>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs pt-1">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="px-3 py-1.5 rounded-xl bg-card border border-borderc disabled:opacity-30 text-main font-semibold flex items-center gap-1"
          >
            <IconArrowLeft className="w-3.5 h-3.5" />
            <span>Anterior</span>
          </button>
          <span className="text-muted">
            Página {page} de {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1.5 rounded-xl bg-card border border-borderc disabled:opacity-30 text-main font-semibold flex items-center gap-1"
          >
            <span>Siguiente</span>
            <IconArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {showRecommend &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-backdrop-in"
            onClick={(e) => e.target === e.currentTarget && setShowRecommend(false)}
          >
            <div
              className="w-full max-w-md max-h-[85dvh] overflow-y-auto rounded-2xl bg-card border border-borderc p-5 shadow-2xl space-y-4 animate-modal-in"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-bold text-main">Recomendar a {friend?.display_name}</h3>
                <button
                  onClick={() => setShowRecommend(false)}
                  className="text-muted hover:text-main p-1"
                >
                  <IconClose className="w-4 h-4" />
                </button>
              </div>

              {recommendMsg && (
                <div
                  className={`p-2.5 rounded-xl border text-xs text-center font-medium ${
                    recommendMsg.type === 'ok'
                      ? 'bg-primarysubtle border-primary text-primary'
                      : 'bg-red-500/15 border-red-500/30 text-red-400'
                  }`}
                >
                  {recommendMsg.text}
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
                  className="px-3.5 py-2.5 rounded-xl bg-primary hover:bg-primaryhover text-white text-xs font-semibold"
                >
                  Buscar
                </button>
              </div>

              {searching && (
                <div className="flex justify-center py-4">
                  <IconSpinner className="w-5 h-5 text-primary" />
                </div>
              )}

              <div className="space-y-2 max-h-[50dvh] overflow-y-auto">
                {searchResults.map((album, i) => {
                  const alreadyListened = albums.some(
                    (a) =>
                      a.status === 'listened' &&
                      a.title?.toLowerCase() === album.title?.toLowerCase()
                  );
                  return (
                    <div
                      key={album.external_id || i}
                      className="flex items-center gap-2.5 p-2 rounded-xl bg-inputbg border border-borderc"
                    >
                      <img
                        src={album.cover_url || '/default-cover.svg'}
                        onError={(e) => {
                          e.target.src = '/default-cover.svg';
                        }}
                        alt=""
                        className="w-11 h-11 rounded-lg object-cover flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-main truncate">{album.title}</p>
                        <p className="text-[11px] text-muted truncate">{album.artist}</p>
                      </div>
                      <button
                        onClick={() => handleRecommend(album)}
                        disabled={alreadyListened}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 ${
                          alreadyListened
                            ? 'bg-card text-muted border border-borderc cursor-not-allowed'
                            : 'bg-primary hover:bg-primaryhover text-white'
                        }`}
                      >
                        <IconSend className="w-3 h-3" />
                        <span>{alreadyListened ? 'Escuchado' : 'Recomendar'}</span>
                      </button>
                    </div>
                  );
                })}
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
          userAlbum={selectedIsFavorite ? null : selectedAlbum}
          ownerName={selectedIsFavorite ? null : friend?.display_name || 'tu amigo'}
          onAction={async (action) => {
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
                tracks: action.tracks,
              });
            }
          }}
        />
      )}
    </div>
  );
}

export default function Friends() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [friends, setFriends] = useState([]);
  const [pending, setPending] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [recNotifications, setRecNotifications] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [userFilter, setUserFilter] = useState('');
  const [sendingTo, setSendingTo] = useState(null);
  const [sentIds, setSentIds] = useState(() => new Set());
  const [feedbackMsg, setFeedbackMsg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedAlbum, setSelectedAlbum] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [f, p, r, rn, u] = await Promise.all([
      api.getFriends().catch(() => []),
      api.getPending().catch(() => []),
      api.getRecommendations().catch(() => []),
      api.getRecommendationNotifications().catch(() => []),
      api.searchUsers('').catch(() => []),
    ]);

    setFriends(f || []);
    setPending(p || []);
    setRecommendations(r || []);
    setRecNotifications(rn || []);
    setAllUsers(Array.isArray(u) ? u : u?.users || []);
    setLoading(false);
    window.dispatchEvent(new Event('recommendations-updated'));
  }, []);

  useEffect(() => {
    if (!id) loadData();
  }, [id, loadData]);

  const handleAddUser = async (targetUser) => {
    setSendingTo(targetUser.id);
    setFeedbackMsg(null);
    try {
      await api.sendFriendRequest({
        friend_id: targetUser.id,
        user_id: targetUser.id,
        username: targetUser.username,
      });
      setSentIds((prev) => new Set(prev).add(String(targetUser.id)));
      setFeedbackMsg({
        type: 'success',
        text: `Solicitud enviada a ${targetUser.display_name || targetUser.username}`,
      });
    } catch (err) {
      setFeedbackMsg({ type: 'error', text: err.message });
    } finally {
      setSendingTo(null);
    }
  };

  const handleAccept = async (reqId) => {
    await api.acceptFriend(reqId).catch(console.error);
    loadData();
  };

  const handleReject = async (reqId) => {
    await api.removeFriend(reqId).catch(console.error);
    loadData();
  };

  const handleDismissRecommendation = async (rec, e) => {
    e?.stopPropagation();
    setRecommendations((prev) =>
      prev.filter((r) => r.user_album_id !== rec.user_album_id && r.album_id !== rec.album_id)
    );
    await api.dismissRecommendation(rec.album_id || rec.user_album_id).catch(console.error);
    window.dispatchEvent(new Event('recommendations-updated'));
  };

  const handleDismissNotification = async (notifId) => {
    setRecNotifications((prev) => prev.filter((n) => n.id !== notifId));
    await api.dismissRecommendationNotification(notifId).catch(console.error);
    window.dispatchEvent(new Event('recommendations-updated'));
  };

  const handleRecommendationAction = async (action) => {
    if (!selectedAlbum) return;
    const target = selectedAlbum;
    const cached = await api.addAlbum({
      external_id: target.external_id || target.id?.toString(),
      source: target.source || 'musicbrainz',
      title: target.title,
      artist: target.artist,
      year: target.year,
      cover_url: target.cover_url,
    });

    if (action.type === 'recommend') {
      await api.recommendAlbum({ album_id: cached.id, friend_id: action.friend_id });
      return;
    }

    setRecommendations((prev) =>
      prev.filter((r) => r.user_album_id !== target.user_album_id && r.album_id !== target.album_id)
    );
    setSelectedAlbum(null);

    await api.addUserAlbum({
      album_id: cached.id,
      status: action.status,
      rating: action.rating,
      note: action.note,
      tracks: action.tracks,
    });
    window.dispatchEvent(new Event('recommendations-updated'));
    loadData();
  };

  const friendIdsSet = useMemo(() => new Set(friends.map((f) => String(f.id))), [friends]);

  const incomingByUserId = useMemo(() => {
    const map = new Map();
    pending.forEach((req) => {
      const uid = req.user_id || req.requester_id || req.sender_id || req.id;
      if (uid != null) map.set(String(uid), req);
    });
    return map;
  }, [pending]);

  const directoryUsers = useMemo(() => {
    const q = userFilter.trim().toLowerCase();
    return allUsers
      .filter((u) => String(u.id) !== String(user?.id) && u.username !== user?.username)
      .filter(
        (u) =>
          !q || u.display_name?.toLowerCase().includes(q) || u.username?.toLowerCase().includes(q)
      )
      .sort((a, b) =>
        (a.display_name || a.username || '').localeCompare(
          b.display_name || b.username || '',
          undefined,
          { sensitivity: 'base' }
        )
      );
  }, [allUsers, user, userFilter]);

  if (id) return <FriendDetail friendId={id} />;
  if (loading)
    return (
      <div className="flex justify-center py-16">
        <IconSpinner className="w-7 h-7 text-primary" />
      </div>
    );

  return (
    <div className="p-4 space-y-6">
      {recNotifications.length > 0 && (
        <section className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-main uppercase tracking-wider">
              Han escuchado tus recomendaciones
            </h3>
            <span className="text-xs bg-primarysubtle text-primary font-bold px-2 py-0.5 rounded-full">
              {recNotifications.length}
            </span>
          </div>
          {recNotifications.map((notif) => (
            <div
              key={notif.id}
              className="bg-card border border-primary/50 rounded-xl p-3 flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src={notif.cover_url || '/default-cover.svg'}
                  onError={(e) => {
                    e.target.src = '/default-cover.svg';
                  }}
                  alt=""
                  className="w-11 h-11 rounded-lg object-cover flex-shrink-0 bg-inputbg"
                />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-main truncate">
                    <span className="text-primary">
                      {notif.listener_display_name || notif.listener_username}
                    </span>{' '}
                    ha escuchado <strong>{notif.title}</strong>
                  </p>
                  <p className="text-[11px] text-muted truncate">
                    {notif.artist}
                    {notif.rating != null ? ` · Nota: ${notif.rating}/10` : ''}
                  </p>
                  {notif.note && (
                    <p className="text-[11px] text-main/80 italic truncate mt-0.5">
                      "{notif.note}"
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleDismissNotification(notif.id)}
                className="px-2.5 py-1.5 rounded-lg bg-inputbg hover:bg-cardhover border border-borderc text-xs font-semibold text-muted hover:text-main flex-shrink-0"
              >
                Listo
              </button>
            </div>
          ))}
        </section>
      )}

      {pending.length > 0 && (
        <section className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-main uppercase tracking-wider">
              Solicitudes pendientes
            </h3>
            <span className="text-xs bg-primarysubtle text-primary font-bold px-2 py-0.5 rounded-full">
              {pending.length}
            </span>
          </div>
          {pending.map((req) => (
            <div
              key={req.id}
              className="bg-card border border-borderc rounded-xl p-3 flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <UserAvatar
                  src={req.avatar_url}
                  name={req.display_name}
                  username={req.username}
                  className="w-10 h-10 text-xs"
                />
                <div className="min-w-0">
                  <p className="font-semibold text-xs text-main truncate">{req.display_name}</p>
                  <p className="text-[11px] text-muted truncate">@{req.username}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleAccept(req.id)}
                  className="px-3 py-1.5 rounded-xl bg-primary hover:bg-primaryhover text-white text-xs font-semibold flex items-center gap-1"
                >
                  <IconCheck className="w-3.5 h-3.5" />
                  <span>Aceptar</span>
                </button>
                <button
                  onClick={() => handleReject(req.id)}
                  className="px-3 py-1.5 rounded-xl bg-inputbg hover:bg-cardhover border border-borderc text-muted hover:text-main text-xs font-semibold"
                >
                  Rechazar
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {recommendations.length > 0 && (
        <section className="space-y-2.5">
          <h3 className="text-xs font-bold text-main uppercase tracking-wider">
            Recomendaciones recibidas ({recommendations.length})
          </h3>
          {recommendations.map((rec) => (
            <div
              key={rec.user_album_id || rec.album_id}
              onClick={() => setSelectedAlbum(rec)}
              className="bg-card hover:bg-cardhover border border-primary rounded-xl p-3 flex items-center gap-3 cursor-pointer"
            >
              <img
                src={rec.cover_url || '/default-cover.svg'}
                onError={(e) => {
                  e.target.src = '/default-cover.svg';
                }}
                alt=""
                className="w-12 h-12 rounded-lg object-cover flex-shrink-0 bg-inputbg"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-main truncate">{rec.title}</p>
                <p className="text-xs text-muted truncate">{rec.artist}</p>
                <div className="text-xs text-primary font-medium mt-1 flex items-center gap-1.5">
                  {rec.recommender_avatar_url ? (
                    <UserAvatar
                      src={rec.recommender_avatar_url}
                      name={rec.recommended_by || rec.recommender_display_name}
                      className="w-4 h-4 text-[9px]"
                    />
                  ) : (
                    <IconHeart className="w-3 h-3 fill-current flex-shrink-0" />
                  )}
                  <span className="truncate">
                    Recomendado por {rec.recommended_by || rec.recommender_display_name || 'un amigo'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  type="button"
                  onClick={(e) => handleDismissRecommendation(rec, e)}
                  className="p-1.5 text-muted hover:text-red-400 rounded-lg"
                  title="Descartar"
                >
                  <IconClose className="w-3.5 h-3.5" />
                </button>
                <span className="text-xs text-primary font-semibold flex items-center gap-0.5">
                  <span>Elegir</span>
                  <IconArrowRight className="w-3 h-3" />
                </span>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="space-y-2.5">
        <h3 className="text-xs font-bold text-main uppercase tracking-wider">
          Mis amigos ({friends.length})
        </h3>
        {friends.length > 0 ? (
          friends.map((friend) => (
            <div
              key={friend.id}
              onClick={() => navigate(`/friends/${friend.id}`)}
              className="bg-card hover:bg-cardhover border border-borderc rounded-xl p-3 flex items-center justify-between cursor-pointer"
            >
              <div className="flex items-center gap-3 min-w-0">
                <UserAvatar
                  src={friend.avatar_url}
                  name={friend.display_name}
                  username={friend.username}
                  className="w-10 h-10 text-xs"
                />
                <div className="min-w-0">
                  <p className="font-semibold text-xs text-main truncate">{friend.display_name}</p>
                  <p className="text-[11px] text-muted truncate">@{friend.username}</p>
                </div>
              </div>
              <div className="flex items-center gap-1 text-primary text-xs font-semibold">
                <span>Ver lista</span>
                <IconArrowRight className="w-3.5 h-3.5" />
              </div>
            </div>
          ))
        ) : (
          <div className="text-center py-6 bg-card border border-borderc rounded-2xl px-4 flex flex-col items-center">
            <IconUsers className="w-6 h-6 text-muted mb-1.5" />
            <p className="text-xs font-semibold text-main">Aún no tienes amigos añadidos</p>
            <p className="text-[11px] text-muted mt-0.5">
              Añade usuarios de la lista de abajo para compartir discos.
            </p>
          </div>
        )}
      </section>

      <section className="space-y-2.5">
        <h3 className="text-xs font-bold text-main uppercase tracking-wider">
          Todos los usuarios ({directoryUsers.length})
        </h3>

        {feedbackMsg && (
          <div
            className={`text-xs p-2.5 rounded-xl border ${
              feedbackMsg.type === 'success'
                ? 'bg-primarysubtle border-primary text-primary'
                : 'bg-red-500/15 border-red-500/30 text-red-400'
            }`}
          >
            {feedbackMsg.text}
          </div>
        )}

        {allUsers.length > 5 && (
          <div className="relative">
            <input
              type="text"
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
              placeholder="Filtrar usuarios..."
              className="w-full bg-inputbg border border-borderc rounded-xl py-2 pl-8 pr-7 text-xs text-main placeholder-muted focus:outline-none focus:border-primary"
            />
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted">
              <IconSearch className="w-3.5 h-3.5" />
            </span>
          </div>
        )}

        {directoryUsers.length > 0 ? (
          directoryUsers.map((u) => {
            const uid = String(u.id);
            const isFriend = friendIdsSet.has(uid) || u.friendship_status === 'accepted';
            const incoming = incomingByUserId.get(uid);
            const isSent =
              sentIds.has(uid) ||
              u.friendship_status === 'pending' ||
              u.friendship_status === 'sent';

            return (
              <div
                key={u.id}
                className="bg-card border border-borderc rounded-xl p-3 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <UserAvatar
                    src={u.avatar_url}
                    name={u.display_name}
                    username={u.username}
                    className="w-10 h-10 text-xs"
                    bgClassName="bg-inputbg text-main border border-borderc"
                  />
                  <div className="min-w-0">
                    <p className="font-semibold text-xs text-main truncate">
                      {u.display_name || u.username}
                    </p>
                    <p className="text-[11px] text-muted truncate">@{u.username}</p>
                  </div>
                </div>

                {isFriend ? (
                  <button
                    type="button"
                    onClick={() => navigate(`/friends/${u.id}`)}
                    className="px-3 py-1.5 rounded-xl bg-primarysubtle border border-primary text-primary text-xs font-semibold flex items-center gap-1"
                  >
                    <IconCheck className="w-3.5 h-3.5" />
                    <span>Amigo</span>
                  </button>
                ) : incoming ? (
                  <button
                    type="button"
                    onClick={() => handleAccept(incoming.id)}
                    className="px-3 py-1.5 rounded-xl bg-primary text-white text-xs font-semibold flex items-center gap-1"
                  >
                    <IconCheck className="w-3.5 h-3.5" />
                    <span>Aceptar</span>
                  </button>
                ) : isSent ? (
                  <span className="px-3 py-1.5 rounded-xl bg-inputbg border border-borderc text-muted text-xs font-semibold inline-flex items-center gap-1">
                    <IconCheck className="w-3.5 h-3.5 text-primary" />
                    <span>Enviada</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleAddUser(u)}
                    disabled={sendingTo === u.id}
                    className="px-3 py-1.5 rounded-xl bg-primary hover:bg-primaryhover disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1"
                  >
                    {sendingTo === u.id ? (
                      <IconSpinner className="w-3.5 h-3.5" />
                    ) : (
                      <IconPlus className="w-3.5 h-3.5" />
                    )}
                    <span>Añadir</span>
                  </button>
                )}
              </div>
            );
          })
        ) : (
          <p className="text-center text-xs text-muted py-6 bg-card border border-borderc rounded-2xl">
            No hay otros usuarios disponibles.
          </p>
        )}
      </section>

      {selectedAlbum && (
        <AlbumDetail
          album={selectedAlbum}
          onClose={() => setSelectedAlbum(null)}
          friends={friends}
          recommenderName={
            selectedAlbum.recommended_by ||
            selectedAlbum.recommender_display_name ||
            'un amigo'
          }
          onDismissRecommendation={() => handleDismissRecommendation(selectedAlbum)}
          onAction={handleRecommendationAction}
        />
      )}
    </div>
  );
}