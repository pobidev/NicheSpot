import { useState, useEffect } from 'react';

export default function UserAvatar({
  src,
  name,
  username,
  className = 'w-10 h-10 text-xs',
  bgClassName = 'bg-primarysubtle text-primary border border-borderc',
}) {
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [src]);

  const initial = (name || username || '?').trim()[0]?.toUpperCase() || '?';
  const showImage = Boolean(src) && !imgFailed;

  return (
    <div
      className={`rounded-full flex items-center justify-center font-bold flex-shrink-0 overflow-hidden select-none ${bgClassName} ${className}`}
    >
      {showImage ? (
        <img
          src={src}
          alt={name || username || 'Avatar'}
          onError={() => setImgFailed(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <span>{initial}</span>
      )}
    </div>
  );
}