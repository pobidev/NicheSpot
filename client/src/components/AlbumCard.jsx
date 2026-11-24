import { IconMusic } from './Icons';

export default function AlbumCard({ album, onClick, compact }) {
  const handleImgError = (e) => {
    e.target.src = '/default-cover.svg';
  };

  if (compact) {
    return (
      <div
        onClick={onClick}
        className="flex items-center gap-3 p-2.5 rounded-xl bg-card hover:bg-cardhover border border-borderc/40 cursor-pointer active:scale-[0.99] transition-all duration-150 shadow-xs"
      >
        <img
          src={album.cover_url || '/default-cover.svg'}
          alt={album.title}
          onError={handleImgError}
          className="w-12 h-12 rounded-lg object-cover flex-shrink-0 bg-inputbg"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-main truncate leading-tight">{album.title}</p>
          <p className="text-xs text-muted truncate mt-0.5">{album.artist}{album.year ? ` · ${album.year}` : ''}</p>
          {album.matched_track && (
            <p className="text-[11px] text-primary truncate mt-1 flex items-center gap-1 font-medium">
              <IconMusic className="w-3 h-3 flex-shrink-0" />
              <span>{album.matched_track}</span>
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      className="bg-card border border-borderc/50 rounded-xl overflow-hidden shadow-xs hover:shadow-md hover:border-primary/40 active:scale-[0.98] cursor-pointer transition-all duration-200 flex flex-col group"
    >
      <div className="relative aspect-square w-full bg-inputbg overflow-hidden">
        <img
          src={album.cover_url || '/default-cover.svg'}
          alt={album.title}
          onError={handleImgError}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
        {album.matched_track && (
          <div className="absolute bottom-1.5 inset-x-1.5 bg-black/85 backdrop-blur-xs text-white text-[10px] px-1.5 py-0.5 rounded truncate flex items-center gap-1">
            <IconMusic className="w-2.5 h-2.5 flex-shrink-0 text-primary" />
            <span className="truncate">{album.matched_track}</span>
          </div>
        )}
      </div>
      <div className="p-3 flex-1 flex flex-col justify-between">
        <p className="font-semibold text-xs text-main line-clamp-1 leading-snug">{album.title}</p>
        <p className="text-[11px] text-muted truncate mt-0.5">{album.artist}{album.year ? ` · ${album.year}` : ''}</p>
      </div>
    </div>
  );
}
