import { useCallback, useState } from 'react';

/** Durée de l'animation de fermeture de `DetailsVideoModal`. */
const CLOSE_DELAY_MS = 300;

/**
 * Fenêtre vidéo d'une fiche : ouverte, en cours de fermeture (le temps de son
 * animation), puis fermée. `payload` garde ce que la fenêtre montre.
 */
export function useDetailsModal<T = undefined>() {
  const [isOpen, setOpen] = useState(false);
  const [isClosing, setClosing] = useState(false);
  const [payload, setPayload] = useState<T | null>(null);

  const open = useCallback((next?: T) => {
    if (next !== undefined) setPayload(next);
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, CLOSE_DELAY_MS);
  }, []);

  return { isOpen, isClosing, payload, open, close };
}
