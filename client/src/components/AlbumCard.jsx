import { useState, useEffect } from 'react';
import { IconMusic, IconDisc } from './Icons';

export function AlbumCover({
  src,
  alt = '',
  className = 'w-12 h-12 rounded-lg',
  imgClassName = '',
  iconSize = 'w-5 h-5',
  showTitleFallback = false,
}) {
  const [status, setStatus] = useState(src ? 'loading' : 'error');

  useEffect(() => {
    setStatus(src ? 'loading' : 'error');
  }, [src]);

  return (
    <div className={`relative overflow-hidden bg-inputbg select-none ${className}`}>
      {/* Skeleton animado mientras descarga la portada */}
      {status === 'loading' && (
        <div className="absolute inset-0 cover-shimmer bg-inputbg flex items-center justify-center">
          <IconDisc className={`${iconSize} text-muted/40 animate-spin`} style={{ animationDuration: '4s' }} />
        </div>
      )}

      {/* Fallback estilizado tipo vinilo si no existe portada o falla */}
      {status === 'error' ? (
        <div className="w-full h-full bg-gradient-to-br from-primarysubtle via-inputbg to-card border border-borderc/40 flex flex-col items-center justify-center p-2 text-center">
          <div className="w-9 h-9 rounded-full bg-card/80 border border-primary/25 flex items-center justify-center text-primary shadow-xs">
            <IconDisc className={iconSize} />
          </div>
          {showTitleFallback && alt && (
            <span className="mt-1.5 text-[10px] font-semibold text-muted line-clamp-2 leading-tight px-1">
              {alt}
            </span>
          )}
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('error')}
          className={`w-full h-full object-cover transition-all duration-300 ${
            status === 'loaded' ? 'opacity-100 scale-100' : 'opacity-0 scale-[1.03]'
          } ${imgClassName}`}
        />
      )}
    </div>
  );
}

export default function AlbumCard({ album, onClick, compact, rightContent = null }) {
  if (compact) {
    return (
      <div
        onClick={onClick}
        className="group flex items-center gap-3 p-2.5 rounded-xl bg-card hover:bg-cardhover border border-borderc/40 hover:border-primary/35 cursor-pointer active:scale-[0.97] transition-all duration-200 shadow-xs hover:shadow-sm"
      >
        <AlbumCover
          src={album.cover_url}
          alt={album.title}
          className="w-12 h-12 rounded-lg flex-shrink-0"
          imgClassName="group-hover:scale-105"
          iconSize="w-5 h-5"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-main truncate leading-tight group-hover:text-primary transition-colors">
            {album.title}
          </p>
          <p className="text-xs text-muted truncate mt-0.5">
            {album.artist}{album.year ? ` · ${album.year}` : ''}
          </p>
          {album.matched_track && (
            <p className="text-[11px] text-primary truncate mt-1 flex items-center gap-1 font-medium">
              <IconMusic className="w-3 h-3 flex-shrink-0" />
              <span>{album.matched_track}</span>
            </p>
          )}
        </div>
        {rightContent}
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      className="bg-card border border-borderc/50 rounded-xl overflow-hidden shadow-xs hover:shadow-md hover:-translate-y-0.5 hover:border-primary/45 active:scale-[0.96] active:translate-y-0 cursor-pointer transition-all duration-200 flex flex-col group"
    >
      <div className="relative aspect-square w-full bg-inputbg overflow-hidden">
        <AlbumCover
          src={album.cover_url}
          alt={album.title}
          className="w-full h-full"
          imgClassName="group-hover:scale-105"
          iconSize="w-7 h-7"
          showTitleFallback
        />
        {album.matched_track && (
          <div className="absolute bottom-1.5 inset-x-1.5 bg-black/85 backdrop-blur-xs text-white text-[10px] px-1.5 py-0.5 rounded truncate flex items-center gap-1">
            <IconMusic className="w-2.5 h-2.5 flex-shrink-0 text-primary" />
            <span className="truncate">{album.matched_track}</span>
          </div>
        )}
      </div>
      <div className="p-3 flex-1 flex flex-col justify-between">
        <p className="font-semibold text-xs text-main line-clamp-1 leading-snug group-hover:text-primary transition-colors">
          {album.title}
        </p>
        <p className="text-[11px] text-muted truncate mt-0.5">
          {album.artist}{album.year ? ` · ${album.year}` : ''}
        </p>
      </div>
    </div>
  );
}