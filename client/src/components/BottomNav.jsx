import { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import * as api from '../api';
import { IconSearch, IconUsers, IconUser } from './Icons';

const tabs = [
  { to: '/search', label: 'Buscar', Icon: IconSearch },
  { to: '/friends', label: 'Amigos', Icon: IconUsers },
  { to: '/profile', label: 'Perfil', Icon: IconUser },
];

export default function BottomNav() {
  const location = useLocation();
  const [pendingRecsCount, setPendingRecsCount] = useState(0);

  useEffect(() => {
    const refreshRecsCount = () => {
      api
        .getRecommendations()
        .then((list) => setPendingRecsCount(Array.isArray(list) ? list.length : 0))
        .catch(() => {});
    };

    refreshRecsCount();
    window.addEventListener('recommendations-updated', refreshRecsCount);
    window.addEventListener('focus', refreshRecsCount);
    const interval = setInterval(refreshRecsCount, 30000);

    return () => {
      window.removeEventListener('recommendations-updated', refreshRecsCount);
      window.removeEventListener('focus', refreshRecsCount);
      clearInterval(interval);
    };
  }, [location.pathname]);

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
                  <Icon className={`w-5 h-5 transition-transform ${isActive ? 'scale-110' : ''}`} />
                  {to === '/friends' && pendingRecsCount > 0 && (
                    <span className="absolute -top-1.5 -right-2.5 min-w-[17px] h-[17px] px-1 rounded-full bg-primary text-white text-[10px] font-extrabold flex items-center justify-center shadow-xs">
                      {pendingRecsCount > 9 ? '9+' : pendingRecsCount}
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