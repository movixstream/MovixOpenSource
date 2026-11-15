import { useCallback, useSyncExternalStore } from 'react';

/** Suit une media query CSS (ex. largeur d'écran, souris ou tactile). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((notify: () => void) => {
    const list = window.matchMedia(query);
    // Safari < 14 ne connaît que addListener sur MediaQueryList.
    if (typeof list.addEventListener === 'function') {
      list.addEventListener('change', notify);
      return () => list.removeEventListener('change', notify);
    }
    list.addListener(notify);
    return () => list.removeListener(notify);
  }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}
