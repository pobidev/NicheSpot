import { createContext, useContext, useState, useEffect } from 'react';

export const THEMES = [
  { id: 'indigo', name: 'Morado', color: '#6366f1', bg: '#030712' },
  { id: 'oled', name: 'Vinilo OLED', color: '#a855f7', bg: '#000000' },
  { id: 'slate', name: 'Azul Pizarra', color: '#38bdf8', bg: '#0b1120' },
  { id: 'ocean', name: 'Océano', color: '#14b8a6', bg: '#041217' },
  { id: 'emerald', name: 'Verde Bosque', color: '#10b981', bg: '#04140e' },
  { id: 'amber', name: 'Ámbar', color: '#f59e0b', bg: '#140d06' },
  { id: 'rose', name: 'Carmesí', color: '#f43f5e', bg: '#17070d' },
  { id: 'light', name: 'Claro', color: '#4f46e5', bg: '#f8fafc' },
  { id: 'cream', name: 'Papel', color: '#ea580c', bg: '#f6f2ea' },
];

const ThemeContext = createContext();

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    return localStorage.getItem('nichospot-theme') || 'indigo';
  });

  const setTheme = (newTheme) => {
    setThemeState(newTheme);
    localStorage.setItem('nichospot-theme', newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
  };

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}