import { NavLink } from 'react-router-dom';
import { IconSearch, IconUsers, IconUser } from './Icons';

const tabs = [
  { to: '/search', label: 'Buscar', Icon: IconSearch },
  { to: '/friends', label: 'Amigos', Icon: IconUsers },
  { to: '/profile', label: 'Perfil', Icon: IconUser },
];

export default function BottomNav() {
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
                <Icon className={`w-5 h-5 transition-transform ${isActive ? 'scale-110' : ''}`} />
                <span className="text-[11px] leading-tight tracking-tight">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
