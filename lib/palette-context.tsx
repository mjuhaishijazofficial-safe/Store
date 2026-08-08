'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_PALETTE, Palette, PALETTE_COOKIE } from './palette';

type Ctx = { palette: Palette; setPalette: (p: Palette) => void };

const PaletteContext = createContext<Ctx | null>(null);

// Independent of light/dark — same DOM-attribute pattern as ThemeProvider,
// just a second attribute (data-palette) so the two combine freely
// (spice+light, spice+dark, navy+light, navy+dark) without either one
// needing to know the other exists.
export function PaletteProvider({ children, initialPalette }: { children: React.ReactNode; initialPalette: Palette }) {
  const [palette, setPaletteState] = useState<Palette>(initialPalette || DEFAULT_PALETTE);

  useEffect(() => {
    document.documentElement.setAttribute('data-palette', palette);
  }, [palette]);

  const setPalette = useCallback((p: Palette) => {
    setPaletteState(p);
    document.cookie = `${PALETTE_COOKIE}=${p}; path=/; max-age=31536000`;
  }, []);

  const value = useMemo(() => ({ palette, setPalette }), [palette, setPalette]);

  return <PaletteContext.Provider value={value}>{children}</PaletteContext.Provider>;
}

export function usePalette(): Ctx {
  const ctx = useContext(PaletteContext);
  if (!ctx) throw new Error('usePalette must be used within PaletteProvider');
  return ctx;
}
