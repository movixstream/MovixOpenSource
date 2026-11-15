import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CineMap } from '@/services/cineGraph/types';
import type { CardState } from './cards';

/**
 * Passer d'une vignette à sa voisine traverse l'espace vide entre les deux.
 * Sans ce délai, la zone s'éteignait un instant : le point lumineux de son
 * trait repartait du début et les vignettes liées clignotaient.
 */
const LEAVE_DELAY_MS = 150;

/**
 * Survoler ou choisir un élément fait ressortir les autres éléments de la
 * carte qui lui sont liés (ex. un acteur et ses films présents ailleurs) :
 * ce sont les connexions cachées. Le reste s'efface un peu.
 */
export function useMapFocus(map: CineMap, selectedKey: string | null) {
  const [hoverKey, setHoverKeyNow] = useState<string | null>(null);
  const leaveTimer = useRef<number>();

  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);
  useEffect(() => {
    window.clearTimeout(leaveTimer.current);
    setHoverKeyNow(null);
  }, [map]);

  const setHoverKey = useCallback((key: string | null) => {
    window.clearTimeout(leaveTimer.current);
    if (key) setHoverKeyNow(key);
    else leaveTimer.current = window.setTimeout(() => setHoverKeyNow(null), LEAVE_DELAY_MS);
  }, []);

  const focusKey = hoverKey ?? selectedKey;
  const related = useMemo(() => {
    const keys = focusKey ? map.items[focusKey]?.related ?? [] : [];
    // Sans lien caché, rien ne s'efface : survoler ne doit pas faire clignoter la carte.
    return keys.length ? new Set(keys) : null;
  }, [map, focusKey]);

  const stateOf = useCallback((key: string): CardState => {
    if (key === selectedKey) return 'selected';
    if (!related || key === focusKey) return 'idle';
    return related.has(key) ? 'related' : 'dimmed';
  }, [selectedKey, focusKey, related]);

  return { focusKey, related, stateOf, setHoverKey };
}
