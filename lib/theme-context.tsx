'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_THEME, Theme, THEME_COOKIE } from './theme';

type Ctx = { theme: Theme; setTheme: (t: Theme) => void };

const ThemeContext = createContext<Ctx | null>(null);

export function ThemeProvider({ children, initialTheme }: { children: React.ReactNode; initialTheme: Theme }) {
  const [theme, setThemeState] = useState<Theme>(initialTheme || DEFAULT_THEME);

  // Purely a client-side visual concern — no server component branches on
  // theme, so unlike language this just flips a DOM attribute. No
  // router.refresh() needed.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    document.cookie = `${THEME_COOKIE}=${t}; path=/; max-age=31536000`;
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Ctx {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
