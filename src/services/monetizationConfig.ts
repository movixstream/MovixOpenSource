// src/services/monetizationConfig.ts
//
// Config publique des pubs, lue sur le Main API (`GET /api/go-settings`).
//
// Le site ne connaît plus aucune URL de régie : il ouvre `/api/go/<emplacement>`
// et c'est le Main API qui choisit la pub selon les réglages de l'admin (onglet
// « Publicités »), puis redirige le navigateur vers elle. Cette config sert
// seulement à savoir, sans attendre le réseau, s'il y a quelque chose à ouvrir
// et combien de fenêtres ouvrir par clic.
//
// Lecture synchrone : mémoire → copie `localStorage` (affichage immédiat au
// chargement suivant) → `FALLBACK_PUBLIC_CONFIG` (emplacements supposés actifs,
// une fenêtre : la route fera le tri). Rafraîchie au démarrage puis toutes les
// 5 minutes.
import i18n from 'i18next';
import { isAdultAdsEnabled } from '../utils/adAdultMode';
import { isMobileOrTabletDevice } from '../utils/deviceDetection';
import { isMovixAppWebView } from '../utils/wrappedShareFile';

export type MonetizationPlacementId = 'player' | 'download' | 'livetv' | 'swiftflux';

export const MONETIZATION_PLACEMENT_IDS: readonly MonetizationPlacementId[] = Object.freeze([
  'player',
  'download',
  'livetv',
  'swiftflux',
]);

export interface PublicMonetizationPlacement {
  /** Pubs en service, emplacement actif et au moins une pub active ici. */
  active: boolean;
  /** Pubs actives ici pour qui garde les pubs +18 (audience `all` ou `adult`). */
  adultCount: number;
  /** Pubs actives ici pour qui les a coupées (audience `all` ou `sfw`). */
  sfwCount: number;
  /** Fenêtres ouvertes par clic, de 1 à 3. */
  windowsPerClick: number;
}

export interface PublicMonetizationConfig {
  enabled: boolean;
  /** Pubs +18 actives pour qui n'a rien choisi dans ses réglages. */
  adultDefault: boolean;
  placements: Record<MonetizationPlacementId, PublicMonetizationPlacement>;
}

const MAIN_API = import.meta.env.VITE_MAIN_API || '';
const CACHE_KEY = 'go_settings_cache';
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_WINDOWS_PER_CLICK = 3;
const GESTURE_LENGTH = 12;
const GESTURE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

const buildUniformConfig = (
  enabled: boolean,
  placement: PublicMonetizationPlacement,
): PublicMonetizationConfig => {
  const placements = {} as Record<MonetizationPlacementId, PublicMonetizationPlacement>;
  for (const id of MONETIZATION_PLACEMENT_IDS) placements[id] = Object.freeze({ ...placement });
  return Object.freeze({ enabled, adultDefault: true, placements: Object.freeze(placements) });
};

/** API injoignable sans copie locale : on suppose tout actif, la route fera le tri. */
export const FALLBACK_PUBLIC_CONFIG: PublicMonetizationConfig = buildUniformConfig(true, {
  active: true,
  adultCount: 1,
  sfwCount: 1,
  windowsPerClick: 1,
});

/** Aucune pub nulle part (API pas encore à jour, route absente). */
export const NO_ADS_PUBLIC_CONFIG: PublicMonetizationConfig = buildUniformConfig(false, {
  active: false,
  adultCount: 0,
  sfwCount: 0,
  windowsPerClick: 1,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toCount = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

const toWindowCount = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(MAX_WINDOWS_PER_CLICK, Math.max(1, Math.floor(value)))
    : 1;

/**
 * Valide une réponse de `/api/go-settings` (ou la copie locale). Renvoie `null`
 * si la forme est inutilisable. Un emplacement absent est considéré inactif :
 * la réponse du serveur fait foi.
 */
export const normalizePublicConfig = (raw: unknown): PublicMonetizationConfig | null => {
  if (!isRecord(raw) || !isRecord(raw.placements)) return null;
  const source = raw.placements;
  const placements = {} as Record<MonetizationPlacementId, PublicMonetizationPlacement>;
  for (const id of MONETIZATION_PLACEMENT_IDS) {
    const value = source[id];
    const entry: Record<string, unknown> = isRecord(value) ? value : {};
    placements[id] = {
      active: entry.active === true,
      adultCount: toCount(entry.adultCount),
      sfwCount: toCount(entry.sfwCount),
      windowsPerClick: toWindowCount(entry.windowsPerClick),
    };
  }
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
    adultDefault: typeof raw.adultDefault === 'boolean' ? raw.adultDefault : true,
    placements,
  };
};

let currentConfig: PublicMonetizationConfig | null = null;
let currentSignature = '';
const listeners = new Set<(config: PublicMonetizationConfig) => void>();

const readStoredConfig = (): PublicMonetizationConfig | null => {
  try {
    const stored = localStorage.getItem(CACHE_KEY);
    return stored ? normalizePublicConfig(JSON.parse(stored)) : null;
  } catch {
    // Stockage indisponible (navigation privée) ou copie corrompue.
    return null;
  }
};

/** Config connue tout de suite, sans réseau. */
export const getMonetizationConfig = (): PublicMonetizationConfig => {
  if (!currentConfig) {
    // Lue une seule fois : ensuite seule la mémoire fait foi.
    currentConfig = readStoredConfig() ?? FALLBACK_PUBLIC_CONFIG;
    currentSignature = JSON.stringify(currentConfig);
  }
  return currentConfig;
};

const applyConfig = (next: PublicMonetizationConfig): PublicMonetizationConfig => {
  getMonetizationConfig();
  const signature = JSON.stringify(next);
  try {
    localStorage.setItem(CACHE_KEY, signature);
  } catch { /* Stockage plein ou indisponible : la mémoire suffit. */ }
  if (signature === currentSignature) return currentConfig ?? next;
  currentConfig = next;
  currentSignature = signature;
  listeners.forEach((cb) => {
    try { cb(next); } catch { /* Un abonné en erreur ne bloque pas les autres. */ }
  });
  return next;
};

let inflight: Promise<PublicMonetizationConfig> | null = null;

/**
 * Relit la config sur le Main API. 404 = API pas encore à jour : plus aucune
 * pub (le popup se valide sans rien ouvrir). Erreur réseau, réponse 5xx ou
 * illisible : la config déjà connue est gardée.
 */
export const refreshMonetizationConfig = (): Promise<PublicMonetizationConfig> => {
  if (inflight) return inflight;
  inflight = (async () => {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
    try {
      const response = await fetch(`${MAIN_API}/api/go-settings`, {
        credentials: 'omit',
        signal: controller?.signal,
      });
      if (response.status === 404) return applyConfig(NO_ADS_PUBLIC_CONFIG);
      if (!response.ok) return getMonetizationConfig();
      const normalized = normalizePublicConfig(await response.json());
      return normalized ? applyConfig(normalized) : getMonetizationConfig();
    } catch {
      return getMonetizationConfig();
    } finally {
      if (timer !== null) clearTimeout(timer);
      inflight = null;
    }
  })();
  return inflight;
};

let syncUsers = 0;
let syncTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Rafraîchit tout de suite puis toutes les 5 minutes. Idempotent : plusieurs
 * appels partagent la même minuterie, arrêtée quand le dernier se désabonne.
 */
export const startMonetizationConfigSync = (): (() => void) => {
  syncUsers += 1;
  if (syncTimer === null) {
    void refreshMonetizationConfig();
    syncTimer = setInterval(() => { void refreshMonetizationConfig(); }, REFRESH_INTERVAL_MS);
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    syncUsers = Math.max(0, syncUsers - 1);
    if (syncUsers === 0 && syncTimer !== null) {
      clearInterval(syncTimer);
      syncTimer = null;
    }
  };
};

export const subscribeToMonetizationConfig = (
  cb: (config: PublicMonetizationConfig) => void,
): (() => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

/**
 * Fenêtres à ouvrir pour un clic : `windowsPerClick`, plafonné au nombre de
 * pubs actives pour l'audience du visiteur (une seule pub SFW → une fenêtre,
 * jamais d'onglet vide). 0 = rien à ouvrir, pas de popup.
 */
export const getAdWindowCount = (
  placement: MonetizationPlacementId,
  adultEnabled: boolean,
  config: PublicMonetizationConfig = getMonetizationConfig(),
): number => {
  if (!config.enabled) return 0;
  const entry = config.placements[placement];
  if (!entry || !entry.active) return 0;
  const available = adultEnabled ? entry.adultCount : entry.sfwCount;
  return Math.max(0, Math.min(entry.windowsPerClick, available));
};

/**
 * Vrai s'il y a au moins une pub à ouvrir ici pour ce visiteur. Jamais dans
 * les applications mobiles (Android et iOS, WebView React Native) : notre
 * popup pub n'y est pas affichée, le lecteur et les liens se débloquent
 * directement.
 */
export const hasAdToOpen = (placement: MonetizationPlacementId): boolean =>
  !isMovixAppWebView() && getAdWindowCount(placement, isAdultAdsEnabled()) > 0;

const createGestureId = (): string => {
  const bytes = new Uint8Array(GESTURE_LENGTH);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (byte) => GESTURE_ALPHABET[byte % GESTURE_ALPHABET.length]).join('');
};

export interface GoUrlOptions {
  adultEnabled: boolean;
  device?: 'mobile' | 'desktop';
  lang?: string;
  /** Identifiant du geste, partagé par toutes les fenêtres d'un même clic. */
  gesture?: string;
}

/**
 * URLs `/api/go/<emplacement>` d'un clic. Toutes portent le même geste `g` :
 * le serveur donne une pub différente à chaque fenêtre `w` du geste.
 */
export const buildGoUrls = (
  placement: MonetizationPlacementId,
  options: GoUrlOptions,
  config: PublicMonetizationConfig = getMonetizationConfig(),
): string[] => {
  const count = getAdWindowCount(placement, options.adultEnabled, config);
  if (count === 0) return [];
  const gesture = options.gesture || createGestureId();
  const extra = `${options.device ? `&d=${encodeURIComponent(options.device)}` : ''}${
    options.lang ? `&lang=${encodeURIComponent(options.lang)}` : ''
  }`;
  const urls: string[] = [];
  for (let w = 0; w < count; w += 1) {
    urls.push(
      `${MAIN_API}/api/go/${placement}?g=${encodeURIComponent(gesture)}&w=${w}&n=${count}`
      + `&sfw=${options.adultEnabled ? 0 : 1}${extra}`,
    );
  }
  return urls;
};

const readLanguage = (): string | undefined => {
  const lang = String(i18n.language || '').slice(0, 2).toLowerCase();
  return /^[a-z]{2}$/.test(lang) ? lang : undefined;
};

/**
 * Ouvre les pubs d'un emplacement dans le geste en cours (à appeler depuis un
 * clic). Ancres créées à l'exécution pour éviter le filtrage réseau (Brave
 * Shields / EasyList). `rel="noopener"` seul, sans `noreferrer` : c'est la
 * route qui décide du référent envoyé à la régie (`Referrer-Policy`).
 * NB : le navigateur n'autorise souvent qu'un popup par geste ; les fenêtres
 * suivantes sont bloquées sauf si le visiteur autorise les popups du site.
 * Renvoie le nombre de fenêtres demandées.
 */
export const openGoLinks = (placement: MonetizationPlacementId): number => {
  if (typeof document === 'undefined' || !document.body) return 0;
  const urls = buildGoUrls(placement, {
    adultEnabled: isAdultAdsEnabled(),
    device: isMobileOrTabletDevice() ? 'mobile' : 'desktop',
    lang: readLanguage(),
  });
  let opened = 0;
  for (const url of urls) {
    try {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.target = '_blank';
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      opened += 1;
    } catch { /* Ouverture refusée par le navigateur. */ }
  }
  return opened;
};
