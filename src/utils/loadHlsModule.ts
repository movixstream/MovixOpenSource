import { lazyWithRetry } from '../routing/lazyWithRetry';

type HlsModule = typeof import('hls.js');

// Les lecteurs partagent la même promesse pour ne pas lancer plusieurs reprises
// concurrentes. Le mode silencieux ne recharge jamais depuis un consommateur
// déjà démonté ; le lecteur encore actif transmet l'erreur à son interface.
let hlsModulePromise: Promise<HlsModule> | null = null;

export const loadHlsModule = (): Promise<HlsModule> => {
  if (!hlsModulePromise) {
    hlsModulePromise = lazyWithRetry(() => import('hls.js'), { silent: true })
      .catch((error: unknown) => {
        hlsModulePromise = null;
        throw error;
      });
  }

  return hlsModulePromise;
};
