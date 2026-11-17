import React, { createContext, useContext, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark' | 'graphite';

/** In the order the navbar button cycles through them. */
export const THEMES: { id: Theme; label: string }[] = [
  { id: 'light', label: 'Swiss' },
  { id: 'dark', label: 'Haute' },
  { id: 'graphite', label: 'Graphite' },
];

const isTheme = (value: string | null): value is Theme => THEMES.some((t) => t.id === value);

export interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'dark',
  setTheme: () => {},
  toggleTheme: () => {},
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem('theme');
    if (isTheme(saved)) {
      return saved;
    }
    // Respect system preference if available, default to dark for rich aesthetics
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      return 'light';
    }
    return 'dark';
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme !== 'light'); // Tailwind's dark: variant; Graphite is dark too
    root.classList.toggle('graphite', theme === 'graphite');
    root.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark'); // legacy.css only knows two, until P-12
    localStorage.setItem('theme', theme);
  }, [theme]);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
  };

  const toggleTheme = () => {
    setThemeState((prev) => THEMES[(THEMES.findIndex((t) => t.id === prev) + 1) % THEMES.length].id);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
