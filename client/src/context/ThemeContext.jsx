import { createContext, useContext, useState, useEffect } from 'react';

export const THEMES = [
  // Temas oscuros
  { id: 'indigo', name: 'Morado', color: '#6366f1', group: 'dark' },
  { id: 'oled', name: 'Vinilo OLED', color: '#a855f7', group: 'dark' },
  { id: 'slate', name: 'Azul Pizarra', color: '#38bdf8', group: 'dark' },
  { id: 'ocean', name: 'Océano', color: '#14b8a6', group: 'dark' },
  { id: 'emerald', name: 'Verde Bosque', color: '#10b981', group: 'dark' },
  { id: 'amber', name: 'Ámbar', color: '#f59e0b', group: 'dark' },
  { id: 'rose', name: 'Carmesí', color: '#f43f5e', group: 'dark' },

  // Temas claros
  { id: 'light', name: 'Nieve', color: '#4f46e5', group: 'light' },
  { id: 'cream', name: 'Papel', color: '#d95d1e', group: 'light' },
  { id: 'sage', name: 'Salvia', color: '#059669', group: 'light' },
  { id: 'lavender', name: 'Lavanda', color: '#7c3aed', group: 'light' },
  { id: 'sky', name: 'Brisa', color: '#0284c7', group: 'light' },
];

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    const saved = localStorage.getItem('theme');
    return THEMES.some((t) => t.id === saved) ? saved : 'indigo';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme: setThemeState, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);