import { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import * as api from '../api';
import { IconSearch, IconUsers, IconUser } from './Icons';

const tabs = [
  { to: '/search', label: 'Buscar', Icon: IconSearch },
  { to: '/friends', label: 'Amigos', Icon: IconUsers },
  { to: '/profile', label: 'Perfil', Icon: IconUser },
];

export default function BottomNav() {
  const location = useLocation();
  const { user } = useAuth();
  const [badgeCount, setBadgeCount] = useState(0);
  const [avatarFailed, setAvatarFailed] = useState(false);

  useEffect(() => {
    setAvatarFailed(false);
  }, [user?.avatar_url]);

  useEffect(() => {
    const refreshBadgeCount = () => {
      Promise.all([
        api.getRecommendations().catch(() => []),
        api.getRecommendationNotifications().catch(() => []),
      ]).then(([recs, notifs]) => {
        const recsLen = Array.isArray(recs) ? recs.length : 0;
        const notifsLen = Array.isArray(notifs) ? notifs.length : 0;
        setBadgeCount(recsLen + notifsLen);
      });
    };

    refreshBadgeCount();
    window.addEventListener('recommendations-updated', refreshBadgeCount);
    window.addEventListener('focus', refreshBadgeCount);
    const interval = setInterval(refreshBadgeCount, 30000);

    return () => {
      window.removeEventListener('recommendations-updated', refreshBadgeCount);
      window.removeEventListener('focus', refreshBadgeCount);
      clearInterval(interval);
    };
  }, [location.pathname]);

  const hasUserAvatar = Boolean(user?.avatar_url) && !avatarFailed;

  return (
    <nav
      className="fixed bottom-0 inset-x-0 backdrop-blur-md border-t rounded-t-2xl z-40 transition-colors duration-200 shadow-lg"
      style={{
        backgroundColor: 'var(--nav-bg)',
        borderColor: 'var(--nav-border)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      <div className="max-w-lg mx-auto flex justify-around items-center h-16 px-2">
        {tabs.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-1 flex-1 py-1.5 rounded-xl transition-all duration-200 select-none ${
                isActive
                  ? 'text-primary font-bold scale-105'
                  : 'text-muted hover:text-main'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <div className="relative inline-flex items-center justify-center">
                  {to === '/profile' && hasUserAvatar ? (
                    <img
                      src={user.avatar_url}
                      alt={user.display_name || user.username || 'Perfil'}
                      onError={() => setAvatarFailed(true)}
                      className={`w-5 h-5 rounded-full object-cover transition-transform ${
                        isActive ? 'scale-110 ring-2 ring-primary' : 'ring-1 ring-borderc'
                      }`}
                    />
                  ) : (
                    <Icon className={`w-5 h-5 transition-transform ${isActive ? 'scale-110' : ''}`} />
                  )}
                  {to === '/friends' && badgeCount > 0 && (
                    <span className="absolute -top-1.5 -right-2.5 min-w-[17px] h-[17px] px-1 rounded-full bg-primary text-white text-[10px] font-extrabold flex items-center justify-center shadow-xs">
                      {badgeCount > 9 ? '9+' : badgeCount}
                    </span>
                  )}
                </div>
                <span className="text-[11px] leading-tight tracking-tight">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}