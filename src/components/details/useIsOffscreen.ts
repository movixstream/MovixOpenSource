import { useEffect, useState, type RefObject } from 'react';
import { DETAILS_HEADER_HEIGHT } from './layout';

/**
 * Vrai quand l'élément observé n'est plus à l'écran (l'en-tête fixe compte
 * comme hors écran). Faux tant qu'il n'est pas monté.
 */
export function useIsOffscreen(target: RefObject<Element>, enabled = true): boolean {
  const [offscreen, setOffscreen] = useState(false);
  useEffect(() => {
    const element = target.current;
    if (!enabled || !element || typeof IntersectionObserver === 'undefined') {
      setOffscreen(false);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setOffscreen(!entry.isIntersecting),
      { rootMargin: `-${DETAILS_HEADER_HEIGHT}px 0px 0px 0px`, threshold: 0 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [target, enabled]);
  return offscreen;
}
