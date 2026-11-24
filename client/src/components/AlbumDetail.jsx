import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { IconClose, IconMusic, IconStar, IconList, IconCheck, IconSend, IconSpinner } from './Icons';

export default function AlbumDetail({ album, onClose, friends = [], onAction, userAlbum }) {
  const [mode, setMode] = useState(null); // 'listened' | 'recommend'
  const [rating, setRating] = useState(userAlbum?.rating || 7);
  const [note, setNote] = useState(userAlbum?.note || '');
  const [selectedFriend, setSelectedFriend] = useState('');
  const [actionError, setActionError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Lock background scroll when modal is open
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

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleListened = async () => {
    setActionError('');
    setSubmitting(true);
    try {
      await onAction({ status: 'listened', rating, note });
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
      await onAction({ status: 'to_listen' });
      onClose();
    } catch (err) {
      setActionError(err.message || 'Error al guardar');
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

  const modalContent = (
    <div
      className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
      onClick={handleBackdrop}
    >
      <div
        className="relative w-full max-w-md max-h-[85dvh] overflow-y-auto rounded-2xl bg-card border border-borderc p-5 shadow-2xl transition-all animate-modal-in"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-muted hover:text-main p-1.5 rounded-lg hover:bg-cardhover transition-colors z-10"
          aria-label="Cerrar"
        >
          <IconClose className="w-5 h-5" />
        </button>

        <div className="flex flex-col items-center mb-5 pt-2">
          <img
            src={album.cover_url || '/default-cover.svg'}
            alt={album.title}
            onError={(e) => { e.target.src = '/default-cover.svg'; }}
            className="w-36 h-36 rounded-xl object-cover shadow-md mb-3 bg-inputbg"
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

        {userAlbum && (
          <div className="mb-4 p-3 rounded-xl bg-inputbg border border-borderc/60 text-xs text-muted space-y-1.5">
            <div className="flex items-center justify-between">
              <span>Estado actual:</span>
              <span className="text-primary font-semibold flex items-center gap-1">
                {userAlbum.status === 'listened' ? (
                  <>
                    <IconCheck className="w-3.5 h-3.5" /> Escuchado
                  </>
                ) : (
                  <>
                    <IconList className="w-3.5 h-3.5" /> Por escuchar
                  </>
                )}
              </span>
            </div>
            {userAlbum.rating && (
              <div className="flex items-center justify-between">
                <span>Puntuación:</span>
                <span className="text-primary font-bold flex items-center gap-1">
                  <IconStar className="w-3.5 h-3.5 fill-current" /> {userAlbum.rating}/10
                </span>
              </div>
            )}
            {userAlbum.note && (
              <p className="italic pt-1 border-t border-borderc/40 text-main">"{userAlbum.note}"</p>
            )}
          </div>
        )}

        {actionError && (
          <div className="mb-4 p-2.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 text-xs text-center font-medium">
            {actionError}
          </div>
        )}

        {!mode && (
          <div className="flex flex-col gap-2.5">
            <button
              onClick={handleToListen}
              disabled={submitting}
              className="w-full py-2.5 px-4 rounded-xl bg-inputbg hover:bg-cardhover border border-borderc text-main font-semibold text-xs transition-all active:scale-[0.98] flex items-center justify-center gap-2 shadow-xs"
            >
              <IconList className="w-4 h-4 text-primary" />
              <span>Marcar como Por escuchar</span>
            </button>
            <button
              onClick={() => { setMode('listened'); setActionError(''); }}
              disabled={submitting}
              className="w-full py-2.5 px-4 rounded-xl bg-primary hover:bg-primaryhover text-white font-semibold text-xs transition-all active:scale-[0.98] flex items-center justify-center gap-2 shadow-xs"
            >
              <IconCheck className="w-4 h-4" />
              <span>Marcar como Escuchado</span>
            </button>
            <button
              onClick={() => { setMode('recommend'); setActionError(''); }}
              disabled={submitting}
              className="w-full py-2.5 px-4 rounded-xl bg-inputbg hover:bg-cardhover border border-borderc text-main font-semibold text-xs transition-all active:scale-[0.98] flex items-center justify-center gap-2 shadow-xs"
            >
              <IconSend className="w-4 h-4 text-primary" />
              <span>Recomendar a un amigo</span>
            </button>
          </div>
        )}

        {mode === 'listened' && (
          <div className="space-y-4 pt-1">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-muted">Puntuación (1 al 10)</label>
                <span className="text-xs font-bold text-primary flex items-center gap-1">
                  <IconStar className="w-3.5 h-3.5 fill-current" /> {rating}/10
                </span>
              </div>
              <div className="grid grid-cols-5 gap-1.5 sm:flex sm:gap-1">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRating(n)}
                    className={`h-9 rounded-lg font-bold text-xs transition-all ${
                      n <= rating
                        ? 'bg-primary text-white shadow-xs'
                        : 'bg-inputbg text-muted hover:bg-cardhover border border-borderc/50'
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

        {mode === 'recommend' && (
          <div className="space-y-4 pt-1">
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
                  Aún no tienes amigos aceptados. Añade amigos en la pestaña Buscar o Amigos.
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
