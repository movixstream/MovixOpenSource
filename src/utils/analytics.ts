// Analytics — un seul fournisseur à la fois, choisi par variable d'environnement.
//
// `VITE_ANALYTICS_PROVIDER` vaut "ga" (Google Analytics 4), "plausible", ou
// "none" (par défaut : rien n'est chargé, aucun script tiers n'est injecté).
//
// Le snippet gtag était auparavant codé en dur dans `index.html` avec l'ID de
// mesure en clair : impossible de changer de fournisseur ou de couper la
// mesure sans toucher au HTML. Tout passe maintenant par ici, appelé depuis
// `main.tsx`.
//
// Les deux fournisseurs sont chargés en `async` après le premier rendu, et le
// suivi des changements de route est fait à la main (SPA : aucun rechargement
// de page, donc aucune vue supplémentaire n'est envoyée automatiquement).

type AnalyticsProvider = 'ga' | 'plausible' | 'none';

type GtagWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
  plausible?: ((event: string, options?: Record<string, unknown>) => void) & {
    q?: unknown[];
  };
  __movixAnalyticsStarted?: boolean;
};

/** Clé localStorage : "1" coupe toute mesure sur cet appareil. */
const OPT_OUT_STORAGE_KEY = 'movix_analytics_opt_out';

const readEnv = (value: string | undefined): string => (value ?? '').trim();

const resolveProvider = (): AnalyticsProvider => {
  const raw = readEnv(import.meta.env.VITE_ANALYTICS_PROVIDER).toLowerCase();

  if (raw === 'ga' || raw === 'google' || raw === 'gtag') return 'ga';
  if (raw === 'plausible') return 'plausible';
  return 'none';
};

const isOptedOut = (): boolean => {
  try {
    if (localStorage.getItem(OPT_OUT_STORAGE_KEY) === '1') return true;
  } catch {
    // Stockage indisponible (mode privé strict) : on continue.
  }

  // Do Not Track : respecté pour les deux fournisseurs, même si Plausible ne
  // pose pas de cookie.
  const dnt =
    navigator.doNotTrack ??
    (window as unknown as { doNotTrack?: string }).doNotTrack;
  return dnt === '1' || dnt === 'yes';
};

const injectScript = (
  src: string,
  attributes: Record<string, string> = {}
): void => {
  const script = document.createElement('script');
  script.src = src;
  script.async = true;
  script.defer = true;
  Object.entries(attributes).forEach(([name, value]) => {
    script.setAttribute(name, value);
  });
  document.head.appendChild(script);
};

const currentPath = (): string =>
  `${window.location.pathname}${window.location.search}`;

/**
 * Rejoue une vue de page à chaque changement d'URL côté client.
 * React Router n'émet rien de global : on écoute donc l'History API.
 */
const observeRouteChanges = (onChange: () => void): void => {
  let lastPath = currentPath();

  const notifyIfChanged = () => {
    const nextPath = currentPath();
    if (nextPath === lastPath) return;
    lastPath = nextPath;
    onChange();
  };

  const patch = (method: 'pushState' | 'replaceState') => {
    const original = history[method];
    if (typeof original !== 'function') return;
    const patched = function patched(
      this: History,
      ...args: Parameters<History['pushState']>
    ) {
      let result: void;
      try {
        result = original.apply(this, args);
      } catch (error) {
        // Le script de challenge Cloudflare enveloppe aussi l'History API et
        // glisse parfois une fonction dans l'état : le navigateur refuse alors
        // de le cloner et la navigation plantait (GlitchTip 6E, 6F, 6G, 6H,
        // 6L, 6M). L'état de React Router est du JSON : le rejouer sans ce
        // qui n'est pas clonable garde la navigation.
        //
        // Toute autre erreur (SecurityError : quota de pushState d'iOS,
        // refus de Firefox — GlitchTip G4, F5) repart telle quelle : c'est
        // l'appelant qui sait s'en remettre (React Router se replie sur
        // location.assign pour un push) et l'enveloppe doit rester
        // transparente.
        if ((error as { name?: unknown })?.name !== 'DataCloneError') throw error;
        let cloneable: unknown = null;
        try {
          cloneable = args[0] === undefined ? null : JSON.parse(JSON.stringify(args[0]));
        } catch {
          // État circulaire : naviguer sans état plutôt que planter.
        }
        try {
          result = original.apply(this, [cloneable, args[1], args[2]]);
        } catch {
          // Le second essai échoue aussi : remonter l'erreur d'origine, pas
          // une erreur née de notre rattrapage.
          throw error;
        }
      }
      // Micro-tâche : laisse React Router monter la nouvelle route (et donc
      // mettre à jour document.title) avant l'envoi.
      window.setTimeout(notifyIfChanged, 0);
      return result;
    } as History[typeof method];
    try {
      history[method] = patched;
    } catch {
      // History API figée (extension, WebView) : la mesure des vues de page
      // ne doit pas empêcher l'application de démarrer.
    }
  };

  patch('pushState');
  patch('replaceState');
  window.addEventListener('popstate', () => {
    window.setTimeout(notifyIfChanged, 0);
  });
};

/**
 * Safari 15 lève « TypeError: Unable to deserialize data. » à la simple
 * lecture de history.state quand l'entrée restaurée (session rouverte,
 * Safari mis à jour) contient un état qu'il ne sait plus relire. BrowserRouter
 * lit cet état dès sa création : la page entière tombait au démarrage
 * (GlitchTip GB). Repartir d'un état vide garde l'URL et ne perd que
 * l'index de navigation de React Router, qu'il recrée aussitôt.
 */
export const repairUnreadableHistoryState = (): void => {
  try {
    void window.history.state;
    return;
  } catch {
    // État illisible : on tente de le remplacer ci-dessous.
  }
  try {
    window.history.replaceState(null, '');
  } catch {
    // Le navigateur refuse aussi l'écriture : rien de plus à tenter ici.
  }
};

const startGoogleAnalytics = (measurementId: string): void => {
  const globalWindow = window as GtagWindow;

  globalWindow.dataLayer = globalWindow.dataLayer || [];
  const gtag: (...args: unknown[]) => void = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    globalWindow.dataLayer!.push(arguments);
  };
  globalWindow.gtag = gtag;

  gtag('js', new Date());
  // `send_page_view: false` : la première vue et les suivantes sont envoyées
  // par `observeRouteChanges` / l'appel ci-dessous, sinon la page d'entrée est
  // comptée deux fois.
  gtag('config', measurementId, { send_page_view: false });

  const sendPageView = () => {
    gtag('event', 'page_view', {
      page_path: currentPath(),
      page_location: window.location.href,
      page_title: document.title,
    });
  };

  injectScript(
    `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`
  );

  sendPageView();
  observeRouteChanges(sendPageView);
};

/** Chemin par défaut du script Plausible (variante « manuelle »). */
const DEFAULT_PLAUSIBLE_SCRIPT_PATH = '/js/script.manual.js';
/** Chemin par défaut de l'API d'événements Plausible. */
const DEFAULT_PLAUSIBLE_API_PATH = '/api/event';

const joinUrl = (base: string, path: string): string =>
  `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;

const startPlausible = (
  domain: string,
  host: string,
  scriptPath: string,
  apiPath: string
): void => {
  const globalWindow = window as GtagWindow;

  // File d'attente officielle Plausible : les appels faits avant le
  // chargement du script sont rejoués une fois qu'il est prêt.
  if (!globalWindow.plausible) {
    const queue: unknown[] = [];
    const stub = ((...args: unknown[]) => {
      queue.push(args);
    }) as NonNullable<GtagWindow['plausible']>;
    stub.q = queue;
    globalWindow.plausible = stub;
  }

  // Le script et l'API sont servis derrière des chemins configurables : les
  // chemins officiels (`/js/script*.js`, `/api/event`) sont dans les listes de
  // blocage type EasyPrivacy, quel que soit le domaine qui les héberge. Le
  // reverse proxy réécrit les chemins déguisés vers les vrais — voir
  // VITE_PLAUSIBLE_SCRIPT_PATH / VITE_PLAUSIBLE_API_PATH dans `.env.example`.
  // `data-api` est l'attribut officiel pour rediriger l'envoi des événements.
  injectScript(joinUrl(host, scriptPath), {
    'data-domain': domain,
    'data-api': joinUrl(host, apiPath),
  });

  const sendPageView = () => {
    globalWindow.plausible?.('pageview', { u: window.location.href });
  };

  sendPageView();
  observeRouteChanges(sendPageView);
};

/**
 * Charge le fournisseur d'analytics configuré. Sans effet si
 * `VITE_ANALYTICS_PROVIDER` vaut "none" / est absent, si l'utilisateur a
 * désactivé la mesure, ou si la config du fournisseur est incomplète.
 */
export const initAnalytics = (): void => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  // Appelé par main.tsx avant le premier rendu, donc avant que BrowserRouter
  // ne lise history.state : c'est le dernier moment pour réparer un état
  // illisible, quel que soit le fournisseur choisi.
  repairUnreadableHistoryState();

  const globalWindow = window as GtagWindow;
  if (globalWindow.__movixAnalyticsStarted) return;

  const provider = resolveProvider();
  if (provider === 'none') return;
  if (isOptedOut()) return;

  if (provider === 'ga') {
    const measurementId = readEnv(import.meta.env.VITE_GA_MEASUREMENT_ID);
    if (!measurementId) return;
    globalWindow.__movixAnalyticsStarted = true;
    startGoogleAnalytics(measurementId);
    return;
  }

  const domain = readEnv(import.meta.env.VITE_PLAUSIBLE_DOMAIN);
  if (!domain) return;
  const host =
    readEnv(import.meta.env.VITE_PLAUSIBLE_HOST) || 'https://plausible.io';
  const scriptPath =
    readEnv(import.meta.env.VITE_PLAUSIBLE_SCRIPT_PATH) ||
    DEFAULT_PLAUSIBLE_SCRIPT_PATH;
  const apiPath =
    readEnv(import.meta.env.VITE_PLAUSIBLE_API_PATH) ||
    DEFAULT_PLAUSIBLE_API_PATH;
  globalWindow.__movixAnalyticsStarted = true;
  startPlausible(domain, host, scriptPath, apiPath);
};

/** Événement personnalisé, ignoré si aucun fournisseur n'est actif. */
export const trackEvent = (
  name: string,
  properties: Record<string, unknown> = {}
): void => {
  const globalWindow = window as GtagWindow;
  if (!globalWindow.__movixAnalyticsStarted) return;

  if (resolveProvider() === 'ga') {
    globalWindow.gtag?.('event', name, properties);
    return;
  }

  globalWindow.plausible?.(name, { props: properties });
};

/** Coupe (ou réactive) la mesure sur cet appareil. Effet au rechargement. */
export const setAnalyticsOptOut = (optOut: boolean): void => {
  try {
    if (optOut) {
      localStorage.setItem(OPT_OUT_STORAGE_KEY, '1');
    } else {
      localStorage.removeItem(OPT_OUT_STORAGE_KEY);
    }
  } catch {
    // Stockage indisponible : rien à faire.
  }
};
