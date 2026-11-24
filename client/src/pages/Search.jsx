import { useState, useEffect, useCallback, useRef } from 'react';
import * as api from '../api';
import AlbumCard, { AlbumCover } from '../components/AlbumCard';
import AlbumDetail from '../components/AlbumDetail';
import {
  IconSearch,
  IconMusic,
  IconClose,
  IconDisc,
  IconCheck,
  IconSpinner,
  IconArrowLeft,
  IconArrowRight,
} from '../components/Icons';

const SEARCH_LIMIT = 18;

const SEARCH_TABS = [
  {
    id: 'artist',
    label: 'Por Artista',
    placeholder: 'Nombre del artista (ej: Nine Inch Nails, Radiohead, Daft Punk...)',
    loadingText: 'Buscando discografía del artista...',
    emptyHint: 'Comprueba el nombre del artista o prueba en "Por Álbum".',
  },
  {
    id: 'album',
    label: 'Por Álbum',
    placeholder: 'Título del álbum (ej: The Downward Spiral, OK Computer...)',
    loadingText: 'Buscando álbumes en MusicBrainz...',
    emptyHint: 'Prueba con otro título o busca directamente "Por Artista".',
  },
  {
    id: 'song',
    label: 'Por Canción',
    placeholder: 'Nombre de la canción (ej: Hurt, Bohemian Rhapsody...)',
    loadingText: 'Buscando canciones y sus álbumes...',
    emptyHint: 'Comprueba el título de la canción o prueba en "Por Álbum".',
  },
];

export default function Search() {
  const [searchType, setSearchType] = useState('artist');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalResults, setTotalResults] = useState(0);
  const [results, setResults] = useState([]);
  const [feed, setFeed] = useState([]);
  const [selectedAlbum, setSelectedAlbum] = useState(null);
  const [friends, setFriends] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState(null);

  const requestSeqRef = useRef(0);
  const activeTabMeta = SEARCH_TABS.find((t) => t.id === searchType) || SEARCH_TABS[0];

  useEffect(() => {
    api.getFriends().then(setFriends).catch(() => []);
    if (!query.trim()) {
      api.getFeed().then(setFeed).catch(() => setFeed([]));
    }
  }, [query]);

  const executeSearch = useCallback(async (q, type, targetPage) => {
    const clean = q.trim();
    const currentSeq = ++requestSeqRef.current;

    if (!clean) {
      setResults([]);
      setTotalPages(1);
      setTotalResults(0);
      setSearchError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setSearchError(null);

    try {
      const data = await api.searchAlbums(clean, {
        type,
        page: targetPage,
        limit: SEARCH_LIMIT,
      });

      if (currentSeq !== requestSeqRef.current) return;

      if (Array.isArray(data)) {
        setResults(data);
        setTotalPages(1);
        setTotalResults(data.length);
      } else {
        setResults(data?.results || []);
        setPage(data?.page || targetPage);
        setTotalPages(data?.total_pages || 1);
        setTotalResults(data?.total ?? (data?.results?.length || 0));
      }
    } catch (err) {
      if (currentSeq !== requestSeqRef.current) return;
      console.error('Error buscando música:', err);
      setSearchError('No se pudo completar la búsqueda. Inténtalo de nuevo.');
      setResults([]);
    } finally {
      if (currentSeq === requestSeqRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (query.trim()) {
        executeSearch(query, searchType, 1);
      } else {
        requestSeqRef.current += 1;
        setResults([]);
        setTotalPages(1);
        setTotalResults(0);
        setSearchError(null);
      }
    }, 450);

    return () => clearTimeout(timer);
  }, [query, searchType, executeSearch]);

  const handleTypeChange = (newType) => {
    if (newType === searchType) return;
    setSearchType(newType);
    setPage(1);
    setSearchError(null);
  };

  const handlePageChange = (newPage) => {
    if (newPage < 1 || newPage > totalPages || newPage === page || !query.trim()) return;
    setPage(newPage);
    executeSearch(query, searchType, newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

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
        tracks: action.tracks,
      });
    }
  };

  return (
    <div className="p-4 space-y-4">
      {/* Selector de 3 modos */}
      <div className="p-1 bg-inputbg rounded-xl border border-borderc flex gap-1">
        {SEARCH_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => handleTypeChange(tab.id)}
            className={`flex-1 py-2 px-2 rounded-lg text-xs font-semibold transition-all flex items-center justify-center active:scale-[0.98] ${
              searchType === tab.id
                ? 'bg-primary text-white shadow-xs font-bold'
                : 'text-muted hover:text-main'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Buscador */}
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
          placeholder={activeTabMeta.placeholder}
          className="w-full bg-inputbg border border-borderc rounded-xl py-2.5 pl-10 pr-9 text-xs text-main placeholder-muted focus:outline-none focus:border-primary transition-colors shadow-xs"
        />
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none">
          <IconSearch className="w-4 h-4" />
        </span>
        {query && (
          <button
            onClick={() => {
              setQuery('');
              setPage(1);
              setResults([]);
            }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-main p-1 rounded-md"
            aria-label="Limpiar búsqueda"
          >
            <IconClose className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted">
          <IconSpinner className="w-6 h-6 text-primary" />
          <span className="text-xs">{activeTabMeta.loadingText}</span>
        </div>
      )}

      {searchError && !loading && (
        <div className="p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 text-xs text-center font-medium">
          {searchError}
        </div>
      )}

      {!loading && (
        <>
          {query.trim() ? (
            results.length > 0 ? (
              <div key={`${searchType}-${page}`} className="space-y-3 animate-fade-up">
                {/* Resumen + Paginación superior */}
                <div className="flex items-center justify-between gap-2 px-0.5">
                  <p className="text-xs font-medium text-muted">
                    {totalResults > 0 ? (
                      <>
                        {totalResults} {totalResults === 1 ? 'resultado' : 'resultados'}
                        {totalPages > 1 && ` · Pág. ${page}/${totalPages}`}
                      </>
                    ) : (
                      `${results.length} resultados`
                    )}
                  </p>

                  {totalPages > 1 && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={page <= 1}
                        onClick={() => handlePageChange(page - 1)}
                        className="px-2.5 py-1 rounded-lg bg-card border border-borderc disabled:opacity-30 text-main text-xs font-semibold flex items-center gap-1 active:scale-95 transition-transform"
                      >
                        <IconArrowLeft className="w-3 h-3" />
                        <span>Ant.</span>
                      </button>
                      <button
                        type="button"
                        disabled={page >= totalPages}
                        onClick={() => handlePageChange(page + 1)}
                        className="px-2.5 py-1 rounded-lg bg-card border border-borderc disabled:opacity-30 text-main text-xs font-semibold flex items-center gap-1 active:scale-95 transition-transform"
                      >
                        <span>Sig.</span>
                        <IconArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Cuadrícula */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {results.map((album, i) => (
                    <AlbumCard
                      key={`${album.external_id || i}-${page}-${i}`}
                      album={album}
                      onClick={() => setSelectedAlbum(album)}
                    />
                  ))}
                </div>

                {/* Paginación inferior */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between text-xs pt-2 px-0.5">
                    <button
                      type="button"
                      disabled={page <= 1}
                      onClick={() => handlePageChange(page - 1)}
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
                      onClick={() => handlePageChange(page + 1)}
                      className="px-3.5 py-1.5 rounded-xl bg-card border border-borderc disabled:opacity-30 text-main font-semibold shadow-xs flex items-center gap-1 active:scale-95 transition-transform"
                    >
                      <span>Siguiente</span>
                      <IconArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ) : (
              !searchError && (
                <div className="text-center py-12 flex flex-col items-center justify-center animate-fade-up">
                  <div className="w-12 h-12 rounded-2xl bg-inputbg border border-borderc flex items-center justify-center text-muted mb-3">
                    <IconSearch className="w-6 h-6" />
                  </div>
                  <p className="text-sm font-semibold text-main">No se encontraron resultados</p>
                  <p className="text-xs text-muted mt-1">{activeTabMeta.emptyHint}</p>
                </div>
              )
            )
          ) : (
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-main uppercase tracking-wider px-0.5">
                Actividad reciente de amigos
              </h3>
              {feed.length > 0 ? (
                <div className="space-y-2">
                  {feed.map((item, i) => (
                    <div
                      key={item.user_album_id || i}
                      onClick={() => setSelectedAlbum(item)}
                      className="group bg-card hover:bg-cardhover border border-borderc hover:border-primary rounded-xl p-3 flex items-center gap-3 cursor-pointer transition-all duration-200 shadow-xs active:scale-[0.98]"
                    >
                      <AlbumCover
                        src={item.cover_url}
                        alt={item.title}
                        className="w-12 h-12 rounded-lg flex-shrink-0"
                        imgClassName="group-hover:scale-105"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-main truncate leading-tight group-hover:text-primary transition-colors">
                          {item.title}
                        </p>
                        <p className="text-xs text-muted truncate mt-0.5">{item.artist}</p>
                        <p className="text-[11px] text-primary font-medium mt-1 flex items-center gap-1">
                          <span>{item.display_name}</span>
                          <span className="text-muted">·</span>
                          {item.status === 'listened' ? (
                            <span className="flex items-center gap-1">
                              <IconCheck className="w-3 h-3 inline" />
                              <span>Escuchado</span>
                              {item.rating != null && (
                                <span className="text-primary font-bold">({item.rating}/10)</span>
                              )}
                            </span>
                          ) : item.status === 'partially_listened' ? (
                            <span className="flex items-center gap-1 text-amber-400">
                              <IconMusic className="w-3 h-3 inline" />
                              <span>Escuchado parcialmente</span>
                              {item.rating != null && (
                                <span className="font-bold">({item.rating}/10)</span>
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
                <div className="text-center py-12 bg-card border border-borderc rounded-2xl p-6 flex flex-col items-center">
                  <div className="w-12 h-12 rounded-2xl bg-inputbg border border-borderc flex items-center justify-center text-muted mb-3">
                    <IconDisc className="w-6 h-6" />
                  </div>
                  <p className="text-sm font-semibold text-main">Sin actividad reciente</p>
                  <p className="text-xs text-muted mt-1 max-w-xs">
                    Elige arriba si quieres buscar por artista, álbum o canción, o añade amigos en la pestaña Amigos.
                  </p>
                </div>
              )}
            </div>
          )}
        </>
      )}

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