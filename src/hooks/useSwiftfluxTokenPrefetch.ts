// Vérification Turnstile invisible de SwiftFlux, faite d'avance.
//
// La page Watch la lance dès que le site SwiftFlow annonce un MP4 SwiftFlux,
// pendant l'écran de chargement : quand l'utilisateur choisit ce lecteur, le
// jeton est déjà là et la porte (`SwiftfluxGate`) n'a rien à demander.
//
// Un jeton Turnstile ne sert qu'une fois et vit 300 s : on le prend une seule
// fois (`take`), et seulement s'il a moins de 4 minutes. Le widget invisible
// est partagé avec les likes (`TurnstileContext`) : on le réinitialise avant et
// après, pour ne jamais rejouer un jeton qu'un like aurait déjà consommé, ni
// laisser le nôtre à un like.
import { useCallback, useEffect, useRef } from 'react';

import { useTurnstile } from '@/context/TurnstileContext';
import { ADMIN_BYPASS_TOKEN } from '@/utils/turnstileBypass';

const MAX_TOKEN_AGE_MS = 240_000;

export interface SwiftfluxTokenPrefetch {
  /** Lance la vérification. `onDone` est appelé quand elle finit, réussie ou non. */
  start: (onDone?: (ok: boolean) => void) => void;
  /** Rend le jeton préparé (une seule fois), ou `null`. */
  take: () => string | null;
  /** Demande un jeton invisible tout neuf (la porte, quand rien n'est prêt). */
  fetchFresh: () => Promise<string | null>;
}

export function useSwiftfluxTokenPrefetch(): SwiftfluxTokenPrefetch {
  const { getValidToken, resetToken } = useTurnstile();
  const tokenRef = useRef<{ token: string; at: number } | null>(null);
  const runningRef = useRef(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  const fetchFresh = useCallback(async (): Promise<string | null> => {
    resetToken();
    const token = await getValidToken();
    resetToken();
    // La dispense admin n'est pas acceptée par cette route : l'équipe passe
    // par la case visible, comme aujourd'hui.
    return token && token !== ADMIN_BYPASS_TOKEN ? token : null;
  }, [getValidToken, resetToken]);

  const start = useCallback((onDone?: (ok: boolean) => void) => {
    if (runningRef.current) return;
    runningRef.current = true;
    tokenRef.current = null;
    void fetchFresh().then((token) => {
      runningRef.current = false;
      if (!aliveRef.current) return;
      tokenRef.current = token ? { token, at: Date.now() } : null;
      onDone?.(!!token);
    });
  }, [fetchFresh]);

  const take = useCallback(() => {
    const entry = tokenRef.current;
    tokenRef.current = null;
    return entry && Date.now() - entry.at < MAX_TOKEN_AGE_MS ? entry.token : null;
  }, []);

  return { start, take, fetchFresh };
}
