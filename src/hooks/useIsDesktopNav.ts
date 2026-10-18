import { useSyncExternalStore } from 'react';

// Même seuil que la classe `lg` de Tailwind, qui bascule l'en-tête.
const DESKTOP_QUERY = '(min-width: 1024px)';

const subscribe = (onChange: () => void) => {
  const query = window.matchMedia(DESKTOP_QUERY);
  // Safari 13 et plus anciens ne connaissent que addListener.
  if (typeof query.addEventListener === 'function') query.addEventListener('change', onChange);
  else query.addListener(onChange);
  return () => {
    if (typeof query.removeEventListener === 'function') query.removeEventListener('change', onChange);
    else query.removeListener(onChange);
  };
};

/** Vrai à partir de `lg` : menu Explorer déroulant ; en dessous, panneau mobile. */
export const useIsDesktopNav = (): boolean => useSyncExternalStore(
  subscribe,
  () => window.matchMedia(DESKTOP_QUERY).matches,
  () => true,
);
