/**
 * Virtual office themes.
 *
 * A theme is two things: a block of CSS variables and rules under
 * `:root[data-theme='<id>']` in `world.css`, and — when it wants more than a
 * re-colour — a capability flag here that tells the renderer to draw
 * differently. Adding a theme is therefore: one entry below, one CSS block.
 *
 * The choice is per browser (localStorage); it never reaches the server.
 */

import { useCallback, useEffect, useState } from 'react';

export interface ThemeDef {
  id: string;
  name: string;
  /** Draw top-down furniture symbols and label tags instead of plain boxes. */
  symbols: boolean;
}

export const THEMES: ThemeDef[] = [
  { id: 'garage', name: 'Garage', symbols: true },
  { id: 'classic', name: 'Classic', symbols: false },
];

export const DEFAULT_THEME = 'garage';
const STORAGE_KEY = 'as500.world.theme';

function find(id: string | null | undefined): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES.find((t) => t.id === DEFAULT_THEME) ?? THEMES[0];
}

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function useTheme(): { theme: ThemeDef; themes: ThemeDef[]; setTheme: (id: string) => void } {
  const [id, setId] = useState<string>(() => find(readStored()).id);

  // Applied on <html> so every rule in world.css, portaled modals included, can key off it.
  useEffect(() => {
    document.documentElement.dataset.theme = id;
  }, [id]);

  const setTheme = useCallback((next: string) => {
    const def = find(next);
    setId(def.id);
    try {
      window.localStorage.setItem(STORAGE_KEY, def.id);
    } catch {
      // Private window or blocked storage: the theme still applies for this visit.
    }
  }, []);

  return { theme: find(id), themes: THEMES, setTheme };
}
