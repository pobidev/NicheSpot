import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import * as api from '../api';
import { AlbumCover } from './AlbumCard';
import {
  IconClose,
  IconMusic,
  IconStar,
  IconList,
  IconCheck,
  IconSend,
  IconSpinner,
  IconRefresh,
  IconEdit,
  IconHeart,
} from './Icons';

export default function AlbumDetail({
  album,
  onClose,
  friends = [],
  onAction,
  onDelete,
  userAlbum,
  recommenderName = null,
  friendContext = null,
}) {
  const effectiveUserAlbum = userAlbum || (!friendContext && album?.status ? album : null);
  const isPendingRec = Boolean(effectiveUserAlbum?.pending_recommendation === 1);
  const currentStatus = isPendingRec ? null : effectiveUserAlbum?.status || null;
  const resolvedRecommender =
    recommenderName ||
    effectiveUserAlbum?.recommended_by ||
    effectiveUserAlbum?.recommended_by_name ||
    effectiveUserAlbum?.recommended_by_username ||
    null;

  const [mode, setMode] = useState(null); // null | 'listened' | 'partially_listened' | 'to_listen_note' | 'recommend'
  const [rating, setRating] = useState(effectiveUserAlbum?.rating ?? null);
  const [note, setNote] = useState(effectiveUserAlbum?.note || '');
  const [selectedFriend, setSelectedFriend] = useState('');
  const [actionError, setActionError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const initialTracks = Array.isArray(effectiveUserAlbum?.tracks) ? effectiveUserAlbum.tracks : [];
  const [tracks, setTracks] = useState(
    initialTracks.map((t, idx) => ({
      track_title: typeof t === 'string' ? t : t.track_title || t.title || '',
      track_number:
        typeof t === 'object' && t.track_number != null ? t.track_number : idx + 1,
      listened: typeof t === 'object' ? Boolean(t.listened) : true,
    }))
  );
  const [loadingTracks, setLoadingTracks] = useState(false);
  const [tracksSyncInfo, setTracksSyncInfo] = useState('');

  const canRecommend = currentStatus === 'listened' && Array.isArray(friends) && friends.length > 0;

  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const loadAlbumTracklist = useCallback(
    async ({ forceSyncLastfm = true } = {}) => {
      if (!album?.artist || !album?.title) return;
      setLoadingTracks(true);
      setTracksSyncInfo('');
      try {
        const res = await api.getAlbumTracklist({
          artist: album.artist,
          title: album.title,
          external_id: album.external_id || album.id?.toString(),
          source: album.source || 'musicbrainz',
          sync_lastfm: forceSyncLastfm,
        });

        const fetched = res?.tracks || [];
        if (fetched.length > 0) {
          setTracks((prev) => {
            const prevMap = new Map(
              prev.map((p) => [p.track_title.toLowerCase().trim(), p.listened])
            );
            const matchedTrackLower = album.matched_track?.toLowerCase().trim();

            return fetched.map((ft, idx) => {
              const key = ft.track_title.toLowerCase().trim();
              const wasPreviouslyListened = prevMap.get(key) === true;
              const isMatchedFromSearch = matchedTrackLower && key === matchedTrackLower;
              return {
                track_number: ft.track_number || idx + 1,
                track_title: ft.track_title,
                listened: Boolean(
                  ft.listened || wasPreviouslyListened || isMatchedFromSearch
                ),
              };
            });
          });

          if (res.lastfm_synced) {
            setTracksSyncInfo(
              `Sincronizadas ${res.scrobbled_count} canciones desde Last.fm`
            );
          }
        }
      } catch (err) {
        console.error('Error cargando tracklist:', err);
      } finally {
        setLoadingTracks(false);
      }
    },
    [album]
  );

  useEffect(() => {
    if (currentStatus === 'partially_listened' && tracks.length === 0) {
      loadAlbumTracklist({ forceSyncLastfm: true });
    }
  }, [currentStatus, tracks.length, loadAlbumTracklist]);

  const handleOpenPartialMode = () => {
    setMode('partially_listened');
    setActionError('');
    if (tracks.length === 0) {
      loadAlbumTracklist({ forceSyncLastfm: true });
    }
  };

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleToggleTrack = (index) => {
    setTracks((prev) =>
      prev.map((t, i) => (i === index ? { ...t, listened: !t.listened } : t))
    );
  };

  const handleSelectAllTracks = (value) => {
    setTracks((prev) => prev.map((t) => ({ ...t, listened: value })));
  };

  const handleSaveListened = async () => {
    setActionError('');
    setSubmitting(true);
    try {
      const normalizedTracks =
        tracks.length > 0
          ? tracks.map((t, idx) => ({
              track_number: t.track_number || idx + 1,
              track_title: t.track_title,
              listened: true,
            }))
          : undefined;

      await onAction({
        status: 'listened',
        rating: rating === '' ? null : rating,
        note: note.trim(),
        ...(normalizedTracks ? { tracks: normalizedTracks } : {}),
      });
      onClose();
    } catch (err) {
      setActionError(err.message || 'Error al guardar');
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickAcceptRecommendation = async () => {
    setActionError('');
    setSubmitting(true);
    try {
      await onAction({
        status: 'listened',
        rating: null,
        note: '',
      });
      onClose();
    } catch (err) {
      setActionError(err.message || 'Error al guardar');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSavePartiallyListened = async () => {
    const listenedTracks = tracks.filter((t) => t.listened);
    if (listenedTracks.length === 0) {
      setActionError('Marca al menos una canción que hayas escuchado.');
      return;
    }

    setActionError('');
    setSubmitting(true);
    try {
      await onAction({
        status: 'partially_listened',
        rating: rating === '' ? null : rating,
        note: note.trim(),
        tracks: tracks.map((t, idx) => ({
          track_number: t.track_number || idx + 1,
          track_title: t.track_title,
          listened: Boolean(t.listened),
        })),
      });
      onClose();
    } catch (err) {
      setActionError(err.message || 'Error al guardar');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToListen = async (keepNote = false) => {
    setActionError('');
    setSubmitting(true);
    try {
      await onAction({
        status: 'to_listen',
        rating: null,
        note: keepNote ? note.trim() : '',
      });
      onClose();
    } catch (err) {
      setActionError(err.message || 'Error al guardar');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRecommend = async () => {
    if (!selectedFriend) {
      setActionError('Selecciona un amigo');
      return;
    }
    setActionError('');
    setSubmitting(true);
    try {
      await onAction({ type: 'recommend', friend_id: Number(selectedFriend) });
      onClose();
    } catch (err) {
      setActionError(err.message || 'Error al recomendar');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    setActionError('');
    setSubmitting(true);
    try {
      await onDelete(effectiveUserAlbum);
      onClose();
    } catch (err) {
      setActionError(err.message || 'Error al eliminar');
    } finally {
      setSubmitting(false);
    }
  };

  const listenedTracksCount = tracks.filter((t) => t.listened).length;
  const allTracksChecked = tracks.length > 0 && listenedTracksCount === tracks.length;

  const renderRatingAndNoteFields = () => (
    <>
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-medium text-muted">
            Puntuación (opcional, 1 al 10)
          </label>
          <button
            type="button"
            onClick={() => setRating(null)}
            className={`text-[11px] font-semibold flex items-center gap-1 transition-colors ${
              rating == null ? 'text-primary' : 'text-muted hover:text-main'
            }`}
          >
            <IconStar className="w-3 h-3" />
            <span>{rating == null ? 'Sin puntuar' : 'Quitar nota'}</span>
          </button>
        </div>

        <div className="grid grid-cols-10 gap-1">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => {
            const active = Number(rating) === num;
            return (
              <button
                key={num}
                type="button"
                onClick={() => setRating(active ? null : num)}
                className={`py-2 rounded-lg text-xs font-bold border transition-all active:scale-95 ${
                  active
                    ? 'bg-primary text-white border-primary shadow-xs'
                    : 'bg-inputbg border-borderc text-muted hover:text-main hover:border-primary/50'
                }`}
              >
                {num}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted block mb-1.5">
          Nota o comentario (opcional)
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="¿Qué te ha parecido este álbum?"
          rows={2}
          className="w-full bg-inputbg border border-borderc rounded-xl p-2.5 text-xs text-main placeholder-muted focus:outline-none focus:border-primary resize-none"
        />
      </div>
    </>
  );

  const renderSingleTracklistEditor = () => (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-bold text-main">
          Canciones escuchadas ({listenedTracksCount}/{tracks.length})
        </span>
        <div className="flex items-center gap-2 text-[11px]">
          {tracks.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => handleSelectAllTracks(true)}
                className="text-primary hover:underline font-medium"
              >
                Marcar todas
              </button>
              <span className="text-muted">·</span>
              <button
                type="button"
                onClick={() => handleSelectAllTracks(false)}
                className="text-muted hover:text-main font-medium"
              >
                Desmarcar todas
              </button>
            </>
          )}
          <button
            type="button"
            disabled={loadingTracks}
            onClick={() => loadAlbumTracklist({ forceSyncLastfm: true })}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-inputbg border border-borderc text-muted hover:text-primary transition-colors disabled:opacity-50"
            title="Actualizar lista de canciones y cruzar con Last.fm"
          >
            <IconRefresh className={`w-3 h-3 ${loadingTracks ? 'animate-spin' : ''}`} />
            <span>Last.fm</span>
          </button>
        </div>
      </div>

      {tracksSyncInfo && (
        <p className="text-[11px] text-primary font-medium">{tracksSyncInfo}</p>
      )}

      {loadingTracks ? (
        <div className="flex items-center justify-center gap-2 py-8 bg-inputbg/60 border border-borderc rounded-xl text-xs text-muted">
          <IconSpinner className="w-4 h-4 text-primary" />
          <span>Cargando lista de canciones...</span>
        </div>
      ) : tracks.length > 0 ? (
        <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
          {tracks.map((track, idx) => (
            <button
              key={`${track.track_title}-${idx}`}
              type="button"
              onClick={() => handleToggleTrack(idx)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border text-left text-xs transition-all ${
                track.listened
                  ? 'bg-primarysubtle/70 border-primary/60 text-main font-medium'
                  : 'bg-inputbg/60 border-borderc text-muted hover:text-main'
              }`}
            >
              <span
                className={`w-4 h-4 rounded-md flex items-center justify-center flex-shrink-0 border transition-colors ${
                  track.listened
                    ? 'bg-primary border-primary text-white'
                    : 'border-borderc bg-card'
                }`}
              >
                {track.listened && <IconCheck className="w-3 h-3" />}
              </span>
              <span className="text-[11px] text-muted w-5 flex-shrink-0">
                {track.track_number || idx + 1}.
              </span>
              <span className="truncate flex-1">{track.track_title}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="p-3 rounded-xl bg-inputbg/60 border border-borderc text-xs text-muted text-center">
          No se encontró el listado oficial de pistas para este lanzamiento.
        </div>
      )}

      {allTracksChecked && (
        <div className="p-2.5 rounded-xl bg-primarysubtle border border-primary/40 flex items-center justify-between gap-2">
          <span className="text-[11px] text-main font-medium">
            ¡Has marcado todas las canciones del álbum!
          </span>
          <button
            type="button"
            disabled={submitting}
            onClick={handleSaveListened}
            className="px-2.5 py-1 rounded-lg bg-primary text-white text-[11px] font-bold hover:bg-primaryhover transition-colors flex-shrink-0"
          >
            Guardar como Escuchado
          </button>
        </div>
      )}
    </div>
  );

  const modalContent = (
    <div
      onClick={handleBackdrop}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
    >
      <div className="relative bg-card border border-borderc rounded-2xl w-full max-w-md max-h-[88dvh] overflow-y-auto p-5 space-y-4 shadow-2xl">
        {/* Botón cerrar */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3.5 right-3.5 w-8 h-8 rounded-full bg-inputbg hover:bg-cardhover text-muted hover:text-main flex items-center justify-center transition-colors"
          aria-label="Cerrar"
        >
          <IconClose className="w-4 h-4" />
        </button>

        {/* Cabecera del álbum */}
        <div className="flex flex-col items-center text-center pt-1">
          <AlbumCover
            src={album.cover_url}
            alt={album.title}
            className="w-32 h-32 rounded-2xl shadow-lg mb-3 border border-borderc"
            iconSize="w-9 h-9"
          />
          <h2 className="text-base font-bold text-main leading-snug px-4">{album.title}</h2>
          <p className="text-xs text-muted mt-0.5">
            {album.artist}
            {album.year ? ` · ${album.year}` : ''}
          </p>
          {album.matched_track && (
            <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primarysubtle border border-primary/30 text-primary text-[11px] font-medium">
              <IconMusic className="w-3 h-3" />
              <span>Canción: {album.matched_track}</span>
            </div>
          )}
        </div>

        {/* Contexto si estamos viendo el álbum desde el perfil de un amigo */}
        {friendContext && (
          <div className="p-3 rounded-xl bg-inputbg/80 border border-borderc space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted">
                En la biblioteca de <strong className="text-main">{friendContext.name}</strong>:
              </span>
              <span className="font-semibold text-primary">
                {friendContext.status === 'listened'
                  ? 'Escuchado'
                  : friendContext.status === 'partially_listened'
                  ? 'Parcial'
                  : 'Por escuchar'}
              </span>
            </div>
            {friendContext.rating != null && (
              <p className="text-muted">
                Nota: <strong className="text-main">{friendContext.rating}/10</strong>
              </p>
            )}
            {friendContext.note && (
              <p className="text-main/90 italic">"{friendContext.note}"</p>
            )}
          </div>
        )}

        {/* Banner de quién recomendó este álbum */}
        {resolvedRecommender && (
          <div className="p-3 rounded-xl bg-primarysubtle border border-primary/40 space-y-1 text-xs">
            <div className="flex items-center gap-1.5 font-bold text-primary">
              <IconHeart className="w-3.5 h-3.5 fill-current" />
              <span>Recomendado por {resolvedRecommender}</span>
            </div>
            {!isPendingRec && currentStatus === 'to_listen' && (
              <p className="text-[11px] text-muted">
                Cuando lo marques como Escuchado se le avisará automáticamente en Amigos.
              </p>
            )}
            {isPendingRec && effectiveUserAlbum?.note && (
              <p className="text-main/90 italic">"{effectiveUserAlbum.note}"</p>
            )}
          </div>
        )}

        {/* Caja de estado actual (solo cuando ya está en tu biblioteca y NO es recomendación pendiente) */}
        {currentStatus && (
          <div className="p-3 rounded-xl bg-inputbg/70 border border-borderc flex items-center justify-between gap-2 text-xs">
            <span className="text-muted font-medium">Estado actual:</span>
            {currentStatus === 'listened' && (
              <span className="inline-flex items-center gap-1.5 font-bold text-primary">
                <IconCheck className="w-3.5 h-3.5" />
                <span>Escuchado</span>
                {effectiveUserAlbum?.rating != null && (
                  <span className="px-1.5 py-0.5 rounded bg-primarysubtle text-primary text-[11px]">
                    {effectiveUserAlbum.rating}/10
                  </span>
                )}
              </span>
            )}
            {currentStatus === 'partially_listened' && (
              <span className="inline-flex items-center gap-1.5 font-bold text-amber-400">
                <IconMusic className="w-3.5 h-3.5" />
                <span>Escuchado parcialmente</span>
                {tracks.length > 0 && (
                  <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 text-[11px]">
                    {listenedTracksCount}/{tracks.length}
                  </span>
                )}
              </span>
            )}
            {currentStatus === 'to_listen' && (
              <span className="inline-flex items-center gap-1.5 font-bold text-primary">
                <IconList className="w-3.5 h-3.5" />
                <span>Por escuchar</span>
              </span>
            )}
          </div>
        )}

        {actionError && (
          <div className="p-2.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 text-xs text-center font-medium">
            {actionError}
          </div>
        )}

        {/* 1. ÁLBUM YA EN "ESCUCHADOS" */}
        {currentStatus === 'listened' && mode !== 'recommend' && (
          <div className="space-y-3">
            {renderRatingAndNoteFields()}

            <button
              type="button"
              disabled={submitting}
              onClick={handleSaveListened}
              className="w-full py-2.5 rounded-xl bg-primary hover:bg-primaryhover text-white text-xs font-bold transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {submitting ? <IconSpinner className="w-4 h-4" /> : <IconCheck className="w-4 h-4" />}
              <span>Guardar cambios</span>
            </button>

            {canRecommend && (
              <button
                type="button"
                onClick={() => {
                  setMode('recommend');
                  setActionError('');
                }}
                className="w-full py-2.5 rounded-xl bg-inputbg hover:bg-cardhover border border-borderc text-main text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
              >
                <IconSend className="w-3.5 h-3.5 text-primary" />
                <span>Recomendar a un amigo</span>
              </button>
            )}

            {onDelete && (
              <button
                type="button"
                disabled={submitting}
                onClick={handleDelete}
                className="w-full py-2.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <IconClose className="w-3.5 h-3.5" />
                <span>Eliminar de mi biblioteca</span>
              </button>
            )}
          </div>
        )}

        {/* 2. ÁLBUM EN "ESCUCHADO PARCIALMENTE" */}
        {currentStatus === 'partially_listened' && (
          <div className="space-y-3">
            {renderSingleTracklistEditor()}
            {renderRatingAndNoteFields()}

            <button
              type="button"
              disabled={submitting || loadingTracks}
              onClick={handleSavePartiallyListened}
              className="w-full py-2.5 rounded-xl bg-primary hover:bg-primaryhover text-white text-xs font-bold transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {submitting ? <IconSpinner className="w-4 h-4" /> : <IconCheck className="w-4 h-4" />}
              <span>Guardar cambios</span>
            </button>

            <button
              type="button"
              disabled={submitting}
              onClick={handleSaveListened}
              className="w-full py-2.5 rounded-xl bg-inputbg hover:bg-cardhover border border-primary/50 text-primary text-xs font-bold transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <IconCheck className="w-3.5 h-3.5" />
              <span>Escuchado</span>
            </button>

            {onDelete && (
              <button
                type="button"
                disabled={submitting}
                onClick={handleDelete}
                className="w-full py-2.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <IconClose className="w-3.5 h-3.5" />
                <span>Eliminar de mi biblioteca</span>
              </button>
            )}
          </div>
        )}

        {/* 3. ÁLBUM EN "POR ESCUCHAR" */}
        {currentStatus === 'to_listen' && mode === null && (
          <div className="space-y-2.5">
            {effectiveUserAlbum?.note && (
              <div className="p-2.5 rounded-xl bg-inputbg/50 border border-borderc text-xs text-muted">
                Nota guardada: <span className="text-main">{effectiveUserAlbum.note}</span>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setMode('listened');
                setActionError('');
              }}
              className="w-full py-2.5 rounded-xl bg-primary hover:bg-primaryhover text-white text-xs font-bold transition-colors flex items-center justify-center gap-1.5 shadow-xs"
            >
              <IconCheck className="w-4 h-4" />
              <span>Escuchado</span>
            </button>

            <button
              type="button"
              onClick={handleOpenPartialMode}
              className="w-full py-2.5 rounded-xl bg-inputbg hover:bg-cardhover border border-borderc text-main text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
            >
              <IconMusic className="w-3.5 h-3.5 text-amber-400" />
              <span>Escuchado parcialmente (elegir canciones)</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setMode('to_listen_note');
                setActionError('');
              }}
              className="w-full py-2 rounded-xl bg-inputbg/50 hover:bg-cardhover border border-borderc text-muted hover:text-main text-xs font-medium transition-colors flex items-center justify-center gap-1.5"
            >
              <IconEdit className="w-3.5 h-3.5" />
              <span>Editar nota en Por escuchar</span>
            </button>

            {onDelete && (
              <button
                type="button"
                disabled={submitting}
                onClick={handleDelete}
                className="w-full py-2.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <IconClose className="w-3.5 h-3.5" />
                <span>Eliminar de Por escuchar</span>
              </button>
            )}
          </div>
        )}

        {/* Sub-modo: Editar nota manteniendo el álbum en "Por escuchar" */}
        {currentStatus === 'to_listen' && mode === 'to_listen_note' && (
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted block mb-1.5">
                Nota o recordatorio en Por escuchar
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ej. Recomendado por..., escuchar con calma..."
                rows={3}
                className="w-full bg-inputbg border border-borderc rounded-xl p-2.5 text-xs text-main placeholder-muted focus:outline-none focus:border-primary resize-none"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMode(null)}
                className="flex-1 py-2.5 rounded-xl bg-inputbg hover:bg-cardhover border border-borderc text-xs text-muted font-semibold"
              >
                Volver
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleToListen(true)}
                className="flex-1 py-2.5 rounded-xl bg-primary hover:bg-primaryhover text-white text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {submitting ? <IconSpinner className="w-4 h-4" /> : <IconCheck className="w-4 h-4" />}
                <span>Guardar nota</span>
              </button>
            </div>
          </div>
        )}

        {/* 4. RECOMENDACIÓN PENDIENTE RECIBIDA */}
        {isPendingRec && mode === null && (
          <div className="space-y-2.5">
            <button
              type="button"
              disabled={submitting}
              onClick={handleQuickAcceptRecommendation}
              className="w-full py-2.5 rounded-xl bg-primary hover:bg-primaryhover text-white text-xs font-bold transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {submitting ? <IconSpinner className="w-4 h-4" /> : <IconCheck className="w-4 h-4" />}
              <span>¡Ya lo he escuchado!</span>
            </button>

            <button
              type="button"
              disabled={submitting}
              onClick={() => handleToListen(false)}
              className="w-full py-2.5 rounded-xl bg-inputbg hover:bg-cardhover border border-borderc text-main text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <IconList className="w-3.5 h-3.5 text-primary" />
              <span>Añadir a Por escuchar</span>
            </button>

            <button
              type="button"
              onClick={handleOpenPartialMode}
              className="w-full py-2.5 rounded-xl bg-inputbg hover:bg-cardhover border border-borderc text-main text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
            >
              <IconMusic className="w-3.5 h-3.5 text-amber-400" />
              <span>Escuchado parcialmente</span>
            </button>

            {onDelete && (
              <button
                type="button"
                disabled={submitting}
                onClick={handleDelete}
                className="w-full py-2.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <IconClose className="w-3.5 h-3.5" />
                <span>Descartar recomendación</span>
              </button>
            )}
          </div>
        )}

        {/* 5. ÁLBUM NUEVO */}
        {!currentStatus && !isPendingRec && mode === null && (
          <div className="space-y-2.5">
            <button
              type="button"
              onClick={() => {
                setMode('listened');
                setActionError('');
              }}
              className="w-full py-2.5 rounded-xl bg-primary hover:bg-primaryhover text-white text-xs font-bold transition-colors flex items-center justify-center gap-1.5"
            >
              <IconCheck className="w-4 h-4" />
              <span>Escuchado</span>
            </button>

            <button
              type="button"
              onClick={handleOpenPartialMode}
              className="w-full py-2.5 rounded-xl bg-inputbg hover:bg-cardhover border border-borderc text-main text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
            >
              <IconMusic className="w-3.5 h-3.5 text-amber-400" />
              <span>Escuchado parcialmente (elegir canciones)</span>
            </button>

            <button
              type="button"
              disabled={submitting}
              onClick={() => handleToListen(false)}
              className="w-full py-2.5 rounded-xl bg-inputbg hover:bg-cardhover border border-borderc text-main text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <IconList className="w-3.5 h-3.5 text-primary" />
              <span>Añadir a Por escuchar</span>
            </button>
          </div>
        )}

        {/* SUB-MODO: Formulario "Escuchado" */}
        {currentStatus !== 'listened' &&
          currentStatus !== 'partially_listened' &&
          mode === 'listened' && (
            <div className="space-y-3 pt-1 border-t border-borderc">
              <p className="text-xs font-bold text-main">
                Marcar álbum completo como Escuchado
              </p>
              {renderRatingAndNoteFields()}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode(null)}
                  className="flex-1 py-2.5 rounded-xl bg-inputbg hover:bg-cardhover border border-borderc text-xs text-muted font-semibold"
                >
                  Volver
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleSaveListened}
                  className="flex-1 py-2.5 rounded-xl bg-primary hover:bg-primaryhover text-white text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {submitting ? (
                    <IconSpinner className="w-4 h-4" />
                  ) : (
                    <IconCheck className="w-4 h-4" />
                  )}
                  <span>Guardar en Escuchados</span>
                </button>
              </div>
            </div>
          )}

        {/* SUB-MODO: Formulario "Escuchado parcialmente" */}
        {currentStatus !== 'partially_listened' && mode === 'partially_listened' && (
          <div className="space-y-3 pt-1 border-t border-borderc">
            {renderSingleTracklistEditor()}
            {renderRatingAndNoteFields()}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMode(null)}
                className="flex-1 py-2.5 rounded-xl bg-inputbg hover:bg-cardhover border border-borderc text-xs text-muted font-semibold"
              >
                Volver
              </button>
              <button
                type="button"
                disabled={submitting || loadingTracks}
                onClick={handleSavePartiallyListened}
                className="flex-1 py-2.5 rounded-xl bg-primary hover:bg-primaryhover text-white text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {submitting ? (
                  <IconSpinner className="w-4 h-4" />
                ) : (
                  <IconCheck className="w-4 h-4" />
                )}
                <span>Guardar parcial</span>
              </button>
            </div>
          </div>
        )}

        {/* SUB-MODO: Recomendar a un amigo (solo si status === 'listened') */}
        {mode === 'recommend' && canRecommend && (
          <div className="space-y-3 pt-1 border-t border-borderc">
            <div>
              <label className="text-xs font-medium text-muted block mb-1.5">
                Elige a un amigo para recomendarle este álbum
              </label>
              <select
                value={selectedFriend}
                onChange={(e) => setSelectedFriend(e.target.value)}
                className="w-full bg-inputbg border border-borderc rounded-xl p-2.5 text-xs text-main focus:outline-none focus:border-primary"
              >
                <option value="">Selecciona un amigo...</option>
                {friends.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.display_name} (@{f.username})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMode(null)}
                className="flex-1 py-2.5 rounded-xl bg-inputbg hover:bg-cardhover border border-borderc text-xs text-muted font-semibold"
              >
                Volver
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleRecommend}
                className="flex-1 py-2.5 rounded-xl bg-primary hover:bg-primaryhover text-white text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {submitting ? (
                  <IconSpinner className="w-4 h-4" />
                ) : (
                  <IconSend className="w-3.5 h-3.5" />
                )}
                <span>Enviar recomendación</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}