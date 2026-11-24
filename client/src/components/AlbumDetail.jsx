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
  IconHeart,
} from './Icons';

export default function AlbumDetail({
  album,
  onClose,
  friends = [],
  onAction,
  onDelete,
  onDismissRecommendation,
  userAlbum,
  ownerName = null,
  recommenderName = null,
}) {
  const isFriendView = Boolean(ownerName);
  const isPendingRec = Boolean(recommenderName);
  const effectiveUserAlbum = isPendingRec ? null : userAlbum;

  // Solo permite recomendar si el usuario actual ya tiene el álbum como 'listened'
  const canRecommend = !isFriendView && !isPendingRec && effectiveUserAlbum?.status === 'listened';

  const [mode, setMode] = useState(null); // 'listened' | 'partially_listened' | 'recommend'
  const [rating, setRating] = useState(!isFriendView ? (effectiveUserAlbum?.rating ?? null) : null);
  const [note, setNote] = useState(!isFriendView ? (effectiveUserAlbum?.note || '') : '');
  const [selectedFriend, setSelectedFriend] = useState('');
  const [actionError, setActionError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showAllSummaryTracks, setShowAllSummaryTracks] = useState(false);

  const initialTracks = Array.isArray(effectiveUserAlbum?.tracks) ? effectiveUserAlbum.tracks : [];
  const [tracks, setTracks] = useState(
    initialTracks.map((t, idx) => ({
      track_title: typeof t === 'string' ? t : t.track_title || t.title || '',
      track_number: typeof t === 'object' && t.track_number != null ? t.track_number : idx + 1,
      listened: typeof t === 'object' ? Boolean(t.listened) : true,
    }))
  );
  const [loadingTracks, setLoadingTracks] = useState(false);

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

  const loadAlbumTracklist = useCallback(async () => {
    if (!album?.artist || !album?.title) return;
    setLoadingTracks(true);
    try {
      const res = await api.getAlbumTracklist({
        artist: album.artist,
        title: album.title,
        external_id: album.external_id || album.id?.toString(),
        source: album.source || 'musicbrainz',
        sync_lastfm: true,
      });

      const fetched = res?.tracks || [];
      if (fetched.length > 0) {
        setTracks((prev) => {
          const prevMap = new Map(prev.map((p) => [p.track_title.toLowerCase().trim(), p.listened]));
          const matchedTrackLower = album.matched_track?.toLowerCase().trim();

          return fetched.map((ft, idx) => {
            const key = ft.track_title.toLowerCase().trim();
            const wasPreviouslyListened = prevMap.get(key) === true;
            const isMatchedFromSearch = matchedTrackLower && key === matchedTrackLower;
            return {
              track_number: ft.track_number || idx + 1,
              track_title: ft.track_title,
              listened: Boolean(ft.listened || wasPreviouslyListened || isMatchedFromSearch),
            };
          });
        });
      }
    } catch (err) {
      console.error('Error cargando tracklist:', err);
    } finally {
      setLoadingTracks(false);
    }
  }, [album]);

  const handleOpenPartialMode = () => {
    setMode('partially_listened');
    setActionError('');
    if (isFriendView || isPendingRec) {
      setTracks([]);
      loadAlbumTracklist();
      return;
    }
    if (tracks.length === 0 || tracks.every((t) => t.listened)) {
      loadAlbumTracklist();
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

  const handleListened = async () => {
    setActionError('');
    setSubmitting(true);
    try {
      await onAction({
        status: 'listened',
        rating: rating || null,
        note: note.trim() ? note.trim() : null,
      });
      onClose();
    } catch (err) {
      setActionError(err.message || 'Error al guardar');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePartiallyListened = async () => {
    const selectedCount = tracks.filter((t) => t.listened).length;
    if (selectedCount === 0) {
      setActionError('Marca al menos una canción que hayas escuchado.');
      return;
    }

    setActionError('');
    setSubmitting(true);
    try {
      await onAction({
        status: 'partially_listened',
        rating: rating || null,
        note: note.trim() ? note.trim() : null,
        tracks,
      });
      onClose();
    } catch (err) {
      setActionError(err.message || 'Error al guardar');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToListen = async () => {
    setActionError('');
    setSubmitting(true);
    try {
      await onAction({ status: 'to_listen', rating: null, note: null });
      onClose();
    } catch (err) {
      setActionError(err.message || 'Error al guardar');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteAlbum = async () => {
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

  const handleRecommend = async () => {
    if (!selectedFriend) return;
    setActionError('');
    setSubmitting(true);
    try {
      await onAction({ type: 'recommend', friend_id: selectedFriend });
      onClose();
    } catch (err) {
      setActionError(err.message || 'Error al recomendar');
    } finally {
      setSubmitting(false);
    }
  };

  const renderStatusBadge = (status) => {
    if (status === 'listened') {
      return (
        <span className="text-primary font-semibold flex items-center gap-1">
          <IconCheck className="w-3.5 h-3.5" /> Escuchado
        </span>
      );
    }
    if (status === 'partially_listened') {
      return (
        <span className="text-amber-400 font-semibold flex items-center gap-1">
          <IconMusic className="w-3.5 h-3.5" /> Escuchado parcialmente
        </span>
      );
    }
    return (
      <span className="text-primary font-semibold flex items-center gap-1">
        <IconList className="w-3.5 h-3.5" /> Por escuchar
      </span>
    );
  };

  const listenedCount = tracks.filter((t) => t.listened).length;
  const allTracksChecked = tracks.length > 0 && listenedCount === tracks.length;

  const summaryTracks = Array.isArray(effectiveUserAlbum?.tracks) ? effectiveUserAlbum.tracks : [];
  const summaryListenedTracks = summaryTracks.filter((t) => Boolean(t.listened));
  const summaryUnlistenedTracks = summaryTracks.filter((t) => !t.listened);

  const modalContent = (
    <div
      className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto animate-backdrop-in"
      onClick={handleBackdrop}
    >
      <div
        className="relative w-full max-w-md max-h-[85dvh] overflow-y-auto rounded-2xl bg-card border border-borderc p-5 shadow-2xl animate-modal-in"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-muted hover:text-main p-1.5 rounded-lg hover:bg-cardhover transition-colors z-10"
          aria-label="Cerrar"
        >
          <IconClose className="w-5 h-5" />
        </button>

        {/* Cabecera portada + título */}
        <div className="flex flex-col items-center mb-5 pt-2">
          <AlbumCover
            src={album.cover_url}
            alt={album.title}
            className="w-36 h-36 rounded-xl shadow-md mb-3"
            iconSize="w-9 h-9"
            showTitleFallback
          />
          <h2 className="text-base font-bold text-main text-center leading-tight px-2">{album.title}</h2>
          <p className="text-xs text-muted text-center mt-1">
            {album.artist}{album.year ? ` · ${album.year}` : ''}
          </p>
          {album.matched_track && (
            <span className="mt-2 inline-flex items-center gap-1.5 text-xs bg-primarysubtle text-primary px-2.5 py-0.5 rounded-full font-medium">
              <IconMusic className="w-3 h-3" />
              <span>Canción: {album.matched_track}</span>
            </span>
          )}
        </div>

        {/* Banner de recomendación pendiente */}
        {isPendingRec && (
          <div className="mb-4 p-3 rounded-xl bg-primarysubtle border border-primary text-xs space-y-1 animate-fade-up">
            <p className="text-primary font-bold flex items-center gap-1.5">
              <IconHeart className="w-3.5 h-3.5 fill-current" />
              <span>Recomendado por {recommenderName}</span>
            </p>
            <p className="text-muted text-[11px]">
              Elige si ya lo has escuchado, si lo llevas a medias o si quieres guardarlo en Por escuchar.
            </p>
          </div>
        )}

        {/* Resumen de estado actual (propio o del amigo) */}
        {effectiveUserAlbum && effectiveUserAlbum.status && (
          <div className="mb-4 p-3 rounded-xl bg-inputbg border border-borderc text-xs text-muted space-y-2 animate-fade-up">
            <div className="flex items-center justify-between">
              <span>{isFriendView ? `Estado de ${ownerName}:` : 'Estado actual:'}</span>
              {renderStatusBadge(effectiveUserAlbum.status)}
            </div>

            {effectiveUserAlbum.rating != null && (
              <div className="flex items-center justify-between">
                <span>Puntuación:</span>
                <span className="text-primary font-bold flex items-center gap-1">
                  <IconStar className="w-3.5 h-3.5 fill-current" /> {effectiveUserAlbum.rating}/10
                </span>
              </div>
            )}

            {effectiveUserAlbum.note && (
              <p className="italic pt-1.5 border-t border-borderc text-main">"{effectiveUserAlbum.note}"</p>
            )}

            {effectiveUserAlbum.status === 'partially_listened' && (
              <div className="pt-2 border-t border-borderc space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-main">
                    Canciones escuchadas ({summaryListenedTracks.length}
                    {summaryTracks.length > summaryListenedTracks.length ? ` de ${summaryTracks.length}` : ''})
                  </span>
                  {summaryUnlistenedTracks.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowAllSummaryTracks((prev) => !prev)}
                      className="text-[11px] text-primary hover:text-primaryhover font-medium"
                    >
                      {showAllSummaryTracks ? 'Ver solo escuchadas' : `Ver todas (${summaryTracks.length})`}
                    </button>
                  )}
                </div>

                {summaryListenedTracks.length > 0 ? (
                  <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                    {(showAllSummaryTracks ? summaryTracks : summaryListenedTracks).map((t, idx) => (
                      <div
                        key={`${t.track_title}-${idx}`}
                        className={`flex items-center gap-2 px-2 py-1 rounded-lg text-[11px] border ${
                          t.listened
                            ? 'bg-primarysubtle text-main border-primary font-medium'
                            : 'bg-card text-muted border-borderc'
                        }`}
                      >
                        <span
                          className={`w-3.5 h-3.5 rounded flex items-center justify-center flex-shrink-0 ${
                            t.listened ? 'bg-primary text-white' : 'border border-borderc'
                          }`}
                        >
                          {t.listened && <IconCheck className="w-2.5 h-2.5" />}
                        </span>
                        <span className="text-[10px] text-muted w-4 flex-shrink-0">
                          {t.track_number || idx + 1}.
                        </span>
                        <span className="truncate">{t.track_title}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-muted italic">
                    Aún no hay canciones específicas marcadas en este álbum.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {actionError && (
          <div className="mb-4 p-2.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 text-xs text-center font-medium">
            {actionError}
          </div>
        )}

        {/* MENÚ PRINCIPAL DE ACCIONES */}
        {!mode && (
          <div className="flex flex-col gap-2.5 animate-fade-up">
            {!isFriendView && effectiveUserAlbum?.status === 'partially_listened' ? (
              <>
                <button
                  onClick={handleOpenPartialMode}
                  disabled={submitting}
                  className="w-full py-2.5 px-4 rounded-xl bg-primary hover:bg-primaryhover text-white font-semibold text-xs transition-all active:scale-[0.98] flex items-center justify-center gap-2 shadow-xs"
                >
                  <IconMusic className="w-4 h-4" />
                  <span>Editar canciones escuchadas</span>
                </button>
                <button
                  onClick={() => { setMode('listened'); setActionError(''); }}
                  disabled={submitting}
                  className="w-full py-2.5 px-4 rounded-xl bg-inputbg hover:bg-cardhover border border-borderc text-main font-semibold text-xs transition-all active:scale-[0.98] flex items-center justify-center gap-2 shadow-xs"
                >
                  <IconCheck className="w-4 h-4 text-primary" />
                  <span>Escuchado</span>
                </button>
                <button
                  onClick={handleToListen}
                  disabled={submitting}
                  className="w-full py-2.5 px-4 rounded-xl bg-inputbg hover:bg-cardhover border border-borderc text-main font-semibold text-xs transition-all active:scale-[0.98] flex items-center justify-center gap-2 shadow-xs"
                >
                  <IconList className="w-4 h-4 text-primary" />
                  <span>Mover a Por escuchar</span>
                </button>
              </>
            ) : !isFriendView && effectiveUserAlbum?.status === 'listened' ? (
              <>
                <button
                  onClick={() => { setMode('listened'); setActionError(''); }}
                  disabled={submitting}
                  className="w-full py-2.5 px-4 rounded-xl bg-primary hover:bg-primaryhover text-white font-semibold text-xs transition-all active:scale-[0.98] flex items-center justify-center gap-2 shadow-xs"
                >
                  <IconStar className="w-4 h-4" />
                  <span>Editar puntuación o nota</span>
                </button>
                <button
                  onClick={handleOpenPartialMode}
                  disabled={submitting}
                  className="w-full py-2.5 px-4 rounded-xl bg-inputbg hover:bg-cardhover border border-amber-500/30 text-main font-semibold text-xs transition-all active:scale-[0.98] flex items-center justify-center gap-2 shadow-xs"
                >
                  <IconMusic className="w-4 h-4 text-amber-400" />
                  <span>Cambiar a Escuchado parcialmente</span>
                </button>
                <button
                  onClick={handleToListen}
                  disabled={submitting}
                  className="w-full py-2.5 px-4 rounded-xl bg-inputbg hover:bg-cardhover border border-borderc text-main font-semibold text-xs transition-all active:scale-[0.98] flex items-center justify-center gap-2 shadow-xs"
                >
                  <IconList className="w-4 h-4 text-primary" />
                  <span>Mover a Por escuchar</span>
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => {
                    if (isPendingRec) {
                      handleListened();
                    } else {
                      setMode('listened');
                      setActionError('');
                    }
                  }}
                  disabled={submitting}
                  className="w-full py-2.5 px-4 rounded-xl bg-primary hover:bg-primaryhover disabled:opacity-50 text-white font-semibold text-xs transition-all active:scale-[0.98] flex items-center justify-center gap-2 shadow-xs"
                >
                  {submitting && isPendingRec ? (
                    <>
                      <IconSpinner className="w-4 h-4 text-white" />
                      <span>Guardando...</span>
                    </>
                  ) : (
                    <>
                      <IconCheck className="w-4 h-4" />
                      <span>
                        {isPendingRec
                          ? '¡Ya lo he escuchado!'
                          : isFriendView
                          ? 'Añadir a mi lista como Escuchado'
                          : 'Escuchado'}
                      </span>
                    </>
                  )}
                </button>
                <button
                  onClick={handleOpenPartialMode}
                  disabled={submitting}
                  className="w-full py-2.5 px-4 rounded-xl bg-inputbg hover:bg-cardhover border border-amber-500/30 text-main font-semibold text-xs transition-all active:scale-[0.98] flex items-center justify-center gap-2 shadow-xs"
                >
                  <IconMusic className="w-4 h-4 text-amber-400" />
                  <span>
                    {isFriendView ? 'Añadir a mi lista como Parcial' : 'Escuchado parcialmente'}
                  </span>
                </button>
                {(!effectiveUserAlbum || isFriendView || effectiveUserAlbum.status !== 'to_listen') && (
                  <button
                    onClick={handleToListen}
                    disabled={submitting}
                    className="w-full py-2.5 px-4 rounded-xl bg-inputbg hover:bg-cardhover border border-borderc text-main font-semibold text-xs transition-all active:scale-[0.98] flex items-center justify-center gap-2 shadow-xs"
                  >
                    <IconList className="w-4 h-4 text-primary" />
                    <span>{isFriendView ? 'Añadir a mi Por escuchar' : 'Guardar en Por escuchar'}</span>
                  </button>
                )}
              </>
            )}

            {/* Solo permite recomendar si ya lo has escuchado */}
            {canRecommend && (
              <button
                onClick={() => { setMode('recommend'); setActionError(''); }}
                disabled={submitting}
                className="w-full py-2.5 px-4 rounded-xl bg-inputbg hover:bg-cardhover border border-borderc text-main font-semibold text-xs transition-all active:scale-[0.98] flex items-center justify-center gap-2 shadow-xs"
              >
                <IconSend className="w-4 h-4 text-primary" />
                <span>Recomendar a un amigo</span>
              </button>
            )}

            {isPendingRec && onDismissRecommendation && (
              <button
                type="button"
                onClick={async () => {
                  setSubmitting(true);
                  try {
                    await onDismissRecommendation();
                    onClose();
                  } finally {
                    setSubmitting(false);
                  }
                }}
                disabled={submitting}
                className="w-full py-2.5 px-4 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 font-semibold text-xs transition-all active:scale-[0.98] flex items-center justify-center gap-2 mt-1"
              >
                <IconClose className="w-4 h-4" />
                <span>Descartar recomendación</span>
              </button>
            )}

            {!isFriendView && !isPendingRec && onDelete && (effectiveUserAlbum?.user_album_id || effectiveUserAlbum?.id) && (
              <button
                type="button"
                onClick={handleDeleteAlbum}
                disabled={submitting}
                className="w-full py-2.5 px-4 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 font-semibold text-xs transition-all active:scale-[0.98] flex items-center justify-center gap-2 mt-1"
              >
                <IconClose className="w-4 h-4" />
                <span>
                  {effectiveUserAlbum?.status === 'to_listen'
                    ? 'Eliminar de Por escuchar'
                    : 'Eliminar de mi biblioteca'}
                </span>
              </button>
            )}
          </div>
        )}

        {/* MODO ESCUCHADO COMPLETO */}
        {mode === 'listened' && (
          <div className="space-y-4 pt-1 animate-fade-up">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-muted">Puntuación (opcional, 1 al 10)</label>
                <div className="flex items-center gap-2">
                  {rating != null && (
                    <button
                      type="button"
                      onClick={() => setRating(null)}
                      className="text-[11px] text-muted hover:text-main underline"
                    >
                      Quitar nota
                    </button>
                  )}
                  <span className="text-xs font-bold text-primary flex items-center gap-1">
                    <IconStar className="w-3.5 h-3.5 fill-current" />
                    {rating != null ? `${rating}/10` : 'Sin puntuar'}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-5 gap-1.5 sm:flex sm:gap-1">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRating((prev) => (prev === n ? null : n))}
                    className={`h-9 rounded-lg font-bold text-xs transition-all active:scale-95 ${
                      rating != null && n <= rating
                        ? 'bg-primary text-white shadow-xs'
                        : 'bg-inputbg text-muted hover:bg-cardhover border border-borderc'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-muted mb-1 block">Nota o comentario (opcional)</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                className="w-full bg-inputbg border border-borderc rounded-xl p-2.5 text-main text-xs resize-none focus:outline-none focus:border-primary transition-colors"
                placeholder="¿Qué te pareció este álbum?"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setMode(null); setActionError(''); }}
                className="flex-1 py-2.5 rounded-xl bg-inputbg border border-borderc text-main font-semibold text-xs hover:bg-cardhover transition-colors active:scale-[0.98]"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={handleListened}
                disabled={submitting}
                className="flex-1 py-2.5 rounded-xl bg-primary hover:bg-primaryhover disabled:opacity-50 text-white font-semibold text-xs transition-colors shadow-xs active:scale-[0.98] flex items-center justify-center gap-1.5"
              >
                {submitting ? (
                  <>
                    <IconSpinner className="w-4 h-4 text-white" />
                    <span>Guardando...</span>
                  </>
                ) : (
                  <span>Guardar</span>
                )}
              </button>
            </div>
          </div>
        )}

        {/* MODO ESCUCHADO PARCIALMENTE */}
        {mode === 'partially_listened' && (
          <div className="space-y-4 pt-1 animate-fade-up">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-semibold text-muted">
                  Canciones escuchadas ({listenedCount}/{tracks.length})
                </label>

                {tracks.length > 0 && (
                  <div className="flex items-center gap-2 text-[11px]">
                    <button
                      type="button"
                      onClick={() => handleSelectAllTracks(true)}
                      className="text-muted hover:text-main transition-colors"
                    >
                      Marcar todas
                    </button>
                    <span className="text-muted">·</span>
                    <button
                      type="button"
                      onClick={() => handleSelectAllTracks(false)}
                      className="text-muted hover:text-main transition-colors"
                    >
                      Desmarcar todas
                    </button>
                  </div>
                )}
              </div>

              {loadingTracks ? (
                <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted bg-inputbg rounded-xl border border-borderc">
                  <IconSpinner className="w-4 h-4 text-primary" />
                  <span>Obteniendo lista de canciones...</span>
                </div>
              ) : tracks.length > 0 ? (
                <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                  {tracks.map((t, idx) => (
                    <button
                      key={`${t.track_title}-${idx}`}
                      type="button"
                      onClick={() => handleToggleTrack(idx)}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs text-left transition-colors ${
                        t.listened
                          ? 'bg-primarysubtle border-primary'
                          : 'bg-inputbg border-borderc hover:bg-cardhover'
                      }`}
                    >
                      <span
                        className={`w-4 h-4 rounded flex items-center justify-center border flex-shrink-0 transition-all ${
                          t.listened
                            ? 'bg-primary border-primary text-white scale-105'
                            : 'border-borderc bg-card text-transparent'
                        }`}
                      >
                        <IconCheck className="w-2.5 h-2.5" />
                      </span>
                      <span className="text-[11px] text-muted w-4 flex-shrink-0">
                        {t.track_number || idx + 1}.
                      </span>
                      <span className={`truncate ${t.listened ? 'text-main font-medium' : 'text-muted'}`}>
                        {t.track_title}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-muted bg-inputbg border border-borderc rounded-xl p-3 text-center">
                  No se encontró el listado de canciones para este álbum.
                </p>
              )}

              {allTracksChecked && (
                <div className="p-2.5 rounded-xl bg-primarysubtle border border-primary flex items-center justify-between gap-2 animate-fade-up">
                  <span className="text-[11px] text-main font-medium">
                    ¡Has marcado todas las canciones!
                  </span>
                  <button
                    type="button"
                    onClick={handleListened}
                    disabled={submitting}
                    className="px-2.5 py-1 rounded-lg bg-primary text-white text-[11px] font-semibold flex-shrink-0 active:scale-95 transition-transform"
                  >
                    Pasar a Escuchado
                  </button>
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-muted">Puntuación (opcional, 1 al 10)</label>
                <div className="flex items-center gap-2">
                  {rating != null && (
                    <button
                      type="button"
                      onClick={() => setRating(null)}
                      className="text-[11px] text-muted hover:text-main underline"
                    >
                      Quitar nota
                    </button>
                  )}
                  <span className="text-xs font-bold text-primary flex items-center gap-1">
                    <IconStar className="w-3.5 h-3.5 fill-current" />
                    {rating != null ? `${rating}/10` : 'Sin puntuar'}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-5 gap-1.5 sm:flex sm:gap-1">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRating((prev) => (prev === n ? null : n))}
                    className={`h-9 rounded-lg font-bold text-xs transition-all active:scale-95 ${
                      rating != null && n <= rating
                        ? 'bg-primary text-white shadow-xs'
                        : 'bg-inputbg text-muted hover:bg-cardhover border border-borderc'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-muted mb-1 block">Nota o comentario (opcional)</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                className="w-full bg-inputbg border border-borderc rounded-xl p-2.5 text-main text-xs resize-none focus:outline-none focus:border-primary transition-colors"
                placeholder="¿Qué te parecen estas canciones de momento?"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setMode(null); setActionError(''); }}
                className="flex-1 py-2.5 rounded-xl bg-inputbg border border-borderc text-main font-semibold text-xs hover:bg-cardhover transition-colors active:scale-[0.98]"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={handlePartiallyListened}
                disabled={submitting || tracks.length === 0}
                className="flex-1 py-2.5 rounded-xl bg-primary hover:bg-primaryhover disabled:opacity-50 text-white font-semibold text-xs transition-colors shadow-xs active:scale-[0.98] flex items-center justify-center gap-1.5"
              >
                {submitting ? (
                  <>
                    <IconSpinner className="w-4 h-4 text-white" />
                    <span>Guardando...</span>
                  </>
                ) : (
                  <span>Guardar</span>
                )}
              </button>
            </div>
          </div>
        )}

        {/* MODO RECOMENDAR */}
        {mode === 'recommend' && (
          <div className="space-y-4 pt-1 animate-fade-up">
            <div>
              <label className="text-xs font-semibold text-muted mb-1.5 block">Selecciona un amigo</label>
              {friends.length > 0 ? (
                <select
                  value={selectedFriend}
                  onChange={(e) => { setSelectedFriend(e.target.value); setActionError(''); }}
                  className="w-full bg-inputbg border border-borderc rounded-xl p-2.5 text-main text-xs focus:outline-none focus:border-primary transition-colors"
                >
                  <option value="">-- Elige un amigo --</option>
                  {friends.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.display_name || f.username} (@{f.username})
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-xs text-muted p-3 bg-inputbg rounded-xl border border-borderc">
                  Aún no tienes amigos aceptados. Añade amigos en la pestaña Amigos.
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setMode(null); setActionError(''); }}
                className="flex-1 py-2.5 rounded-xl bg-inputbg border border-borderc text-main font-semibold text-xs hover:bg-cardhover transition-colors active:scale-[0.98]"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={handleRecommend}
                disabled={!selectedFriend || submitting}
                className="flex-1 py-2.5 rounded-xl bg-primary hover:bg-primaryhover disabled:opacity-50 text-white font-semibold text-xs transition-colors shadow-xs active:scale-[0.98] flex items-center justify-center gap-1.5"
              >
                {submitting ? (
                  <>
                    <IconSpinner className="w-4 h-4 text-white" />
                    <span>Enviando...</span>
                  </>
                ) : (
                  <>
                    <IconSend className="w-3.5 h-3.5" />
                    <span>Enviar recomendación</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}