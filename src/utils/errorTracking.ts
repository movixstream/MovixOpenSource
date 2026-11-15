// Suivi des crashs frontend — GlitchTip, serveur open source compatible avec
// l'API et les SDK Sentry (offre hébergée pour l'instant, voir
// docs/error-tracking-glitchtip.md).
//
// Remplace le webhook Discord qui était codé en dur dans ErrorBoundary : l'URL
// partait dans le bundle (n'importe qui pouvait spammer le salon) et chaque
// crash faisait un message. Ici le SDK envoie les erreurs à GlitchTip, qui
// regroupe les doublons, applique les source maps envoyées au build
// (vite.config.ts) et prévient Discord quand un crash arrive.
//
// Périmètre volontairement réduit : les crashs du code Movix seulement
// (ErrorBoundary, exceptions non rattrapées). Le bruit réseau — sources qui
// tombent, API injoignable, extensions, interruptions du lecteur vidéo — est
// jeté avant envoi : l'offre gratuite plafonne à 1 000 événements par mois, ils
// ne doivent pas partir en fumée sur une panne d'hébergeur.
//
// Rien n'est envoyé depuis `npm run dev` ni sans VITE_GLITCHTIP_DSN.

import * as Sentry from '@sentry/react';
import type { ErrorEvent, StackFrame } from '@sentry/react';
import type { ErrorInfo } from 'react';
import { isChunkLoadError } from '../routing/lazyWithRetry';

const readEnv = (value: string | undefined): string => (value ?? '').trim();

/**
 * Plafond d'événements par chargement de page. Une boucle de rendu qui plante
 * en continu chez un seul utilisateur ne doit pas vider le quota mensuel.
 */
const MAX_EVENTS_PER_PAGE_LOAD = 5;

let sentEvents = 0;
let enabled = false;

/**
 * Erreurs « récupérables » : pas un bug du code, un rechargement suffit.
 *  - chunks dynamiques périmés après un déploiement (isChunkLoadError)
 *  - course React + traduction automatique du navigateur (removeChild/insertBefore)
 *  - React #306 : un élément lazy résolu en `undefined` (chunk raté ou périmé)
 * ErrorBoundary leur affiche un écran « mise à jour » avec rechargement
 * automatique, et elles ne sont jamais remontées à GlitchTip.
 */
export const isRecoverableError = (error: unknown, fromErrorBoundary = false): boolean => {
  if (!error) return false;
  // Une page dont le body a disparu ne peut plus afficher React. Les effets
  // de nettoyage (dont ceux des bibliothèques de modales) peuvent alors
  // planter en cascade : reprendre via le rechargement déjà limité en nombre.
  // Seul ErrorBoundary programme ce rechargement. Les erreurs globales
  // restent observables : beforeSend ne doit pas les masquer sans reprise.
  if (fromErrorBoundary && typeof document !== 'undefined' && !document.body) return true;
  if (isChunkLoadError(error)) return true;
  const msg = String((error as { message?: unknown })?.message || '');
  // lazyWithRetry marque déjà un import résolu sans module en ChunkLoadError.
  // Un accès invalide à .default ou _result peut venir du module lui-même :
  // conserver cette erreur et sa pile au lieu de la masquer par un rechargement.
  return /removeChild|insertBefore|not a child of this node|Minified React error #306|invariant=306/i.test(msg);
};

/** Une requête HTTP ratée (axios) n'est pas un crash du code. */
const isAxiosError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { isAxiosError?: unknown }).isAxiosError === true;

/**
 * Messages jetés avant envoi. Une chaîne = sous-chaîne, une regex = test,
 * appliqués au message et au « Type: message » de chaque exception.
 */
const IGNORED_ERRORS: Array<string | RegExp> = [
  // Réseau : sources qui tombent, API ou proxy injoignables, requêtes annulées.
  'Network Error',
  'Failed to fetch',
  'Load failed',
  'NetworkError when attempting to fetch resource',
  'Request failed with status code',
  'Request aborted',
  /^timeout of \d+ms exceeded/i,
  /^(?:canceled|cancelled|annulé)$/i,
  'CanceledError',
  'AbortError',
  'The operation was aborted',
  'The user aborted a request',
  // Délai d'une requête dépassé. `AbortSignal.timeout()` avorte avec une
  // DOMException « TimeoutError: signal timed out », sans pile — le filtre par
  // cadre (beforeSend) ne peut donc pas trancher, alors qu'un serveur qui ne
  // répond pas est un échec réseau, pas un plantage du code.
  'TimeoutError',
  'signal timed out',
  'timed out after',
  // Lecteur vidéo : interruptions normales de play()/pause(), autoplay refusé,
  // fonction absente sur l'appareil (verrouillage d'orientation, PiP… sur iOS).
  /play\(\) request was interrupted/i,
  /play\(\) failed because the user didn't interact/i,
  'NotAllowedError',
  'NotSupportedError',
  // Bruit navigateur connu, sans rapport avec le code.
  /^ResizeObserver loop/,
  // Promesse rejetée avec autre chose qu'une Error (objet, chaîne) : pas un
  // plantage. Le SDK a deux formulations selon la version et la valeur.
  'Non-Error promise rejection captured',
  'Object captured as promise rejection',
  /^Event `(?:CustomEvent|Event)` \(type=unhandledrejection\) captured as promise rejection$/,
  'Non-Error exception captured',
  // Extensions et scripts injectés par le navigateur. `runtime.sendMessage`
  // est l'API des extensions : une promesse rejetée sans pile, vue sur iOS.
  /chrome-extension:\/\//,
  /moz-extension:\/\//,
  'Extension context invalidated',
  'runtime.sendMessage',
  // Safari : les rejets non rattrapés des scripts de contenu d'une extension
  // remontent dans la page, sans pile. Ses erreurs d'API commencent toutes
  // par « Invalid call to browser.<api>() » (storage.local.set plein, etc.).
  'Invalid call to browser.',
  // Script que Cloudflare injecte en bordure (Bot Fight Mode) : il lit le
  // document d'une iframe cachée, que Safari refuse parfois. Pas notre code.
  'Blocked a frame with origin',
  // Scripts que des apps WebView injectent dans la page. Le « video injector »
  // d'un navigateur iOS déclenche un clic synthétique sur notre zone plein
  // écran ; Safari ne garde dans la pile que notre wrapper d'événement, donc
  // le filtre par cadre de pile (beforeSend) ne le voit pas.
  '_internal_videoInjector',
  // DuckDuckGo iOS : ses scripts de contenu parlent à l'app via
  // webkit.messageHandlers, et le rejet remonte dans la page, sans pile.
  'WKWebView API client did not respond',
  // Service worker : une réponse opaque (cachée pour un <img>) servie à un
  // fetch() CORS. Corrigé dans sw.js le 2026-09-02, mais un ancien SW reste
  // actif jusqu'à la prochaine navigation de l'onglet — et c'est un échec
  // réseau, pas un plantage du code.
  'Response served by service worker is opaque',
  // Le fetch du service worker a échoué : le navigateur enveloppe l'erreur
  // réseau dans « FetchEvent.respondWith received an error: … ». Le préfixe est
  // stable, le message enveloppé non (Safari y met la description réseau de
  // macOS, traduite). C'est un échec réseau, jamais un bug du code. sw.js
  // retente une fois avant d'en arriver là.
  'FetchEvent.respondWith received an error',
  // Chunks périmés après un déploiement : lazyWithRetry recharge, ErrorBoundary
  // affiche l'écran « mise à jour ». Rien à corriger dans le code.
  'ChunkLoadError',
  'Failed to fetch dynamically imported module',
  'Importing a module script failed',
  'error loading dynamically imported module',
  /Unable to preload (CSS|module)/,
  // Course React + traduction automatique : rendue inoffensive dans main.tsx.
  'not a child of this node',
  'Minified React error #306',
  // Chrome/Edge iOS : l'app hôte a détruit son WKWebView avant de répondre à
  // un message de ses propres scripts. Aucune pile, rien côté Movix.
  'The WKWebView was deallocated before the message was delivered',
  // Firefox : la page touche un objet dont le compartiment a été détruit,
  // typiquement une API patchée par une extension désactivée ou mise à jour
  // (fetch, Image, window.event lu par React). Pas reproductible côté Movix.
  "can't access dead object",
  // Firefox : une extension fait remonter un événement dont la cible vient
  // d'un autre compartiment ; React (__reactFiber…) ou le SDK (_sentryId) ne
  // peuvent pas la lire.
  /^Permission denied to access property "(?:__react[A-Za-z]+\$[a-z0-9]+|_sentryId)"$/,
  // Safari 14 : le service worker a été arrêté pendant la requête. Échec
  // réseau, comme « FetchEvent.respondWith received an error ».
  'Fetch event is destroyed',
  // Refus d'une permission par le navigateur (plein écran, notifications…) :
  // la page continue, ce n'est pas un plantage.
  'Fullscreen request denied',
  'Permissions check failed',
];

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Signatures de scripts navigateur absents du code et des dépendances Movix.
 * Safari ne conserve parfois que le wrapper setTimeout du SDK dans la pile.
 * Garder les captures explicites et les noms génériques (ex. « msg »).
 */
const isInjectedBrowserError = (event: ErrorEvent): boolean => {
  const exception = event.exception?.values?.slice(-1)[0];
  if (exception?.mechanism?.handled !== false) return false;
  if (/this\.blobUrls\[0\]\.start|MinHeightToDisplayTitle|(?:Can't find variable: (?:webkit|logMutedMessage)$)|window\.webkit\.messageHandlers|'e\.target\.tagName\.toLowerCase'/.test(exception.value || '')) return true;

  // A2/AR : un script d'appui long probablement injecté en WebView iOS écrit
  // « statrt » puis, ~800 ms après, « timer fired » et « target -> … ».
  // Ces messages sont absents de Movix et des scripts chargés inspectés.
  // Exiger toute la signature : le seul nom imageParam ne prouve rien.
  if (exception.type !== 'ReferenceError'
    || exception.value !== "Can't find variable: imageParam"
    || !String(exception.mechanism.type || '').endsWith('.setTimeout')
    || exception.stacktrace?.frames?.length !== 1
    || typeof event.timestamp !== 'number') return false;

  const logs = (event.breadcrumbs ?? []).filter((crumb) => crumb.category === 'console');
  const target = logs[logs.length - 1];
  const timer = logs[logs.length - 2];
  if (!target?.message?.startsWith('target -> ')
    || timer?.message !== 'timer fired'
    || typeof target.timestamp !== 'number'
    || typeof timer.timestamp !== 'number') return false;

  // Ne pas attribuer une erreur ultérieure à un ancien appui long.
  const eventTimestamp = event.timestamp;
  const timerTimestamp = timer.timestamp;
  const sinceTarget = eventTimestamp - target.timestamp;
  const sinceTimer = target.timestamp - timerTimestamp;
  if (!(sinceTarget >= 0 && sinceTarget <= 1 && sinceTimer >= 0 && sinceTimer <= 1)) return false;
  return logs.slice(0, -2).some((crumb) => crumb.message === 'statrt'
    && typeof crumb.timestamp === 'number'
    && timerTimestamp >= crumb.timestamp
    && eventTimestamp - crumb.timestamp <= 2);
};

/**
 * Cadre sans fichier exploitable, à sauter en remontant la pile : appel natif
 * (Chrome « native », Safari « [native code] ») ou cadre sans nom de fichier.
 */
const isNativeFrame = (frame: StackFrame): boolean => {
  const file = frame.filename || frame.abs_path || '';
  // Chrome écrit « at Array.forEach (<anonymous>) » pour les fonctions
  // natives. Avec un numéro de ligne, <anonymous> est au contraire du code
  // évalué ou injecté sans URL.
  if (file === '<anonymous>') return frame.lineno === undefined;
  return !file || file === 'native' || file === '[native code]';
};

const lastValue = (event: ErrorEvent) => {
  const values = event.exception?.values ?? [];
  return values[values.length - 1];
};

/**
 * Erreur globale sans aucun cadre de nos chunks : pas de pile, ou seulement
 * des appels natifs. Rien ne la rattache au code Movix et rien ne permet de
 * la corriger ici (scripts d'apps hôtes, de navigateurs, d'extensions :
 * GlitchTip 9K, 5U, 8M, 7T, 40, 9V…). Les captures explicites (ErrorBoundary)
 * ne sont pas concernées.
 */
const hasNoOwnFrame = (event: ErrorEvent, ownBundle: RegExp): boolean => {
  const exception = lastValue(event);
  if (!exception || exception.mechanism?.handled !== false) return false;
  return !(exception.stacktrace?.frames ?? []).some((frame) => ownBundle.test(frame.filename || frame.abs_path || ''));
};

/**
 * Le SDK enveloppe les callbacks de setTimeout, addEventListener… Quand le
 * seul cadre non natif est cette enveloppe, la fonction qui a levé l'erreur
 * n'apparaît pas : Safari masque ainsi les scripts injectés par une app ou une
 * extension (GlitchTip 7K, 8N, A3, 59, 92…). Une erreur de notre callback
 * laisserait son propre cadre sous l'enveloppe.
 */
const isWrappedInvisibleCallback = (event: ErrorEvent): boolean => {
  const exception = lastValue(event);
  if (!exception || exception.mechanism?.handled !== false) return false;
  if (!String(exception.mechanism?.type || '').startsWith('auto.browser.browserapierrors.')) return false;
  const frames = (exception.stacktrace?.frames ?? []).filter((frame) => !isNativeFrame(frame));
  return frames.length === 1;
};

/**
 * Crash rattrapé par ErrorBoundary dont toute la pile d'origine est du code
 * étranger : un script injecté qui redéfinit Object.getOwnPropertyDescriptor
 * et boucle jusqu'à épuiser la pile (GlitchTip DQ, 9A, 95). Dès qu'un de nos
 * cadres apparaît, l'erreur reste visible : un polyfill de la plateforme qui
 * jette sur une valeur fournie par Movix est un bug à traiter chez nous (CO).
 * La valeur « React ErrorBoundary » ne porte que la pile des composants.
 */
const isBoundaryErrorThrownByForeignCode = (event: ErrorEvent, ownBundle: RegExp): boolean => {
  const values = event.exception?.values ?? [];
  if (!values.some((value) => value.mechanism?.type === 'auto.function.react.error_boundary')) return false;
  const original = values.find((value) => !String(value.type || '').startsWith('React ErrorBoundary'));
  const frames = (original?.stacktrace?.frames ?? []).filter((frame) => !isNativeFrame(frame));
  return frames.length > 0 && !frames.some((frame) => ownBundle.test(frame.filename || frame.abs_path || ''));
};

/**
 * Vrai quand une erreur attrapée automatiquement (window.onerror, rejet de
 * promesse, handler instrumenté par le SDK) a été levée hors des chunks du
 * build : script d'extension, d'app WebView (« ibFindAllVideos »,
 * « isMiniViewNotVisible », un XMLHttpRequest.open patché qui s'appelle en
 * boucle…) ou de bloqueur de pub. Leurs cadres portent « <anonymous> », l'URL
 * de la page ou celle de l'extension — jamais /assets/.
 *
 * `allowUrls` ne suffit pas : il ne regarde que le dernier cadre AVEC une URL,
 * et un handler tiers enveloppé par le SDK laisse un cadre de notre bundle
 * (helpers.js) juste sous le cadre « <anonymous> » fautif. Ici on part du
 * cadre qui a levé l'erreur (le dernier), en sautant les appels natifs.
 *
 * Les erreurs capturées explicitement (ErrorBoundary, captureException) ne
 * sont pas concernées : elles viennent forcément de notre code.
 */
const isThrownOutsideOwnBundle = (event: ErrorEvent, ownBundle: RegExp): boolean => {
  const values = event.exception?.values ?? [];
  // Les causes chaînées sont insérées AVANT l'exception d'origine : la dernière
  // valeur est celle qui porte le mécanisme de capture et la vraie pile.
  const exception = values[values.length - 1];
  if (!exception || exception.mechanism?.handled !== false) return false;
  const frames = exception.stacktrace?.frames ?? [];
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    const frame = frames[i];
    if (isNativeFrame(frame)) continue;
    return !ownBundle.test(frame.filename || frame.abs_path || '');
  }
  // Pas de pile du tout : impossible de trancher, ignoreErrors s'en charge.
  return false;
};

/** Au-delà, le fetch d'asset qui précède n'explique plus le rejet. */
const CHUNK_FETCH_WINDOW_S = 10;

/**
 * Vrai quand un rejet non rattrapé suit immédiatement le chargement raté d'un
 * chunk du build.
 *
 * Safari remonte l'échec réseau d'un `import()` en TypeError portant la
 * description réseau de macOS, traduite dans la langue du système : « annulé »,
 * « L'opération n'a pas pu s'achever. Type de protocole incompatible avec
 * socket »… Une locale, un errno, un texte différent : ces messages ne peuvent
 * pas être listés dans IGNORED_ERRORS, contrairement au « Failed to fetch
 * dynamically imported module » de Chrome et Firefox. On regarde donc le
 * contexte plutôt que le texte — la dernière requête avant le rejet est un
 * fetch d'un de NOS assets resté sans statut, donc jamais abouti.
 *
 * Volontairement étroit : rejet non rattrapé + TypeError + requête d'asset
 * inachevée juste avant. Un vrai bug du code ne coche pas les trois cases.
 * lazyWithRetry recharge de son côté ; ici on évite seulement de vider le
 * quota mensuel avec des coupures réseau.
 */
const followsFailedChunkFetch = (event: ErrorEvent, ownAssets: RegExp): boolean => {
  const values = event.exception?.values ?? [];
  const exception = values[values.length - 1];
  if (!exception || exception.mechanism?.handled !== false) return false;
  if (exception.mechanism?.type !== 'onunhandledrejection'
    && !String(exception.mechanism?.type || '').endsWith('.onunhandledrejection')) return false;
  if (exception.type !== 'TypeError') return false;

  const crumbs = event.breadcrumbs ?? [];
  for (let i = crumbs.length - 1; i >= 0; i -= 1) {
    const crumb = crumbs[i];
    if (crumb.category !== 'fetch' && crumb.category !== 'xhr') continue;
    const url = crumb.data?.url;
    if (typeof url !== 'string' || !ownAssets.test(url)) return false;
    // Un statut renseigné = la requête a abouti : elle n'explique pas le rejet.
    if (crumb.data?.status_code) return false;
    if (event.timestamp && crumb.timestamp
      && event.timestamp - crumb.timestamp > CHUNK_FETCH_WINDOW_S) return false;
    return true;
  }
  return false;
};

/**
 * Safari peut rejeter un import sans URL ni pile JavaScript (GlitchTip
 * 8366421). Joindre les derniers chargements de JS disponibles aide à
 * identifier les fichiers à examiner, sans désigner l'un d'eux comme fautif.
 * Le buffer du navigateur peut être incomplet ou ancien.
 */
const readRecentAssetLoads = () => {
  try {
    const resources = (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
      .filter((entry) => {
        const url = new URL(entry.name);
        return url.origin === window.location.origin
          && /^\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.js$/.test(url.pathname);
      })
      .sort((a, b) => b.responseEnd - a.responseEnd)
      .slice(0, 12)
      .map((entry) => ({
        // Aucun paramètre d'URL, contenu de script ou en-tête n'est collecté.
        path: new URL(entry.name).pathname,
        initiator: entry.initiatorType,
        start_ms: Math.round(entry.startTime),
        duration_ms: Math.round(entry.duration),
        response_end_ms: Math.round(entry.responseEnd),
        worker_start_ms: entry.workerStart,
        transfer_bytes: entry.transferSize,
        encoded_body_bytes: entry.encodedBodySize,
        decoded_body_bytes: entry.decodedBodySize,
        // Zéro ou une propriété absente ne constitue pas un statut HTTP.
        status: entry.responseStatus > 0 ? entry.responseStatus : null,
      }));
    return { captured_at_ms: Math.round(performance.now()), resources };
  } catch {
    // Le diagnostic facultatif ne doit jamais empêcher l'envoi du crash.
    return null;
  }
};

/**
 * Démarre le SDK. À appeler avant tout le reste dans main.tsx : les handlers
 * globaux (window.onerror, unhandledrejection) ne voient que ce qui se passe
 * après leur pose.
 */
export const initErrorTracking = (): void => {
  const dsn = readEnv(import.meta.env.VITE_GLITCHTIP_DSN);
  if (!dsn || !import.meta.env.PROD) return;

  // Seules les erreurs levées depuis un chunk du build passent : /assets/ sur
  // l'origine de la page, miroirs compris. Tout ce qu'un tiers injecte dans la
  // page — script Cloudflare (Bot Fight Mode), lecteur JSON-LD de Safari 18,
  // extensions, apps WebView, régies — porte l'URL de la page, d'un autre hôte
  // ou « <anonymous> », et est jeté (allowUrls + isThrownOutsideOwnBundle).
  // Le code tapé dans la console est donc filtré aussi : pour tester la chaîne
  // en prod, appeler `window.__movixTestCrash()` (capture explicite, voir bas).
  // Nos chunks portent tous un hash de 8 caractères : un `/assets/vendor.js`
  // sans hash vient d'un script injecté (GlitchTip 8P).
  const ownBundle = new RegExp(`^${escapeRegExp(window.location.origin)}/assets/[^/?#]+-[A-Za-z0-9_-]{8}\\.js(?:[?#]|$)`);

  Sentry.init({
    dsn,
    // Même valeur que le nom de release des source maps (vite.config.ts) : le
    // SHA du commit sur Cloudflare Pages, la date du build sinon.
    release: readEnv(import.meta.env.VITE_APP_BUILD_ID) || undefined,
    environment: import.meta.env.MODE,
    // Aucune donnée personnelle : pas d'IP, pas de cookies, pas d'en-têtes.
    sendDefaultPii: false,
    // Erreurs seulement : pas de traces de perf, pas de replay. Les sessions
    // (BrowserSession) sont ignorées par GlitchTip, autant ne pas les envoyer.
    integrations: (defaults) => defaults.filter((integration) => integration.name !== 'BrowserSession'),
    ignoreErrors: IGNORED_ERRORS,
    allowUrls: [ownBundle],
    maxBreadcrumbs: 30,
    beforeBreadcrumb(breadcrumb) {
      // Les bandeaux stylés de main.tsx (avertissement console) n'expliquent
      // aucun crash et pèsent six lignes par événement.
      if (breadcrumb.category === 'console' && String(breadcrumb.message || '').startsWith('%c')) {
        return null;
      }
      // Les URL TMDB embarquent la clé API : inutile de la stocker chez GlitchTip.
      const url = breadcrumb.data?.url;
      if (typeof url === 'string' && url.includes('api_key=')) {
        breadcrumb.data = {
          ...breadcrumb.data,
          url: url.replace(/([?&])api_key=[^&]*&?/, '$1').replace(/[?&]$/, ''),
        };
      }
      return breadcrumb;
    },
    beforeSend(event, hint) {
      if (sentEvents >= MAX_EVENTS_PER_PAGE_LOAD) return null;
      const original = hint.originalException;
      if (isRecoverableError(original) || isAxiosError(original)) return null;
      // Document sans body : un script tiers a remplacé ou vidé la page
      // (aucun code Movix ne retire le body). Les erreurs qui suivent, comme
      // Framer Motion lisant body.scrollLeft (GlitchTip 8T, 6P), n'en sont
      // que la conséquence.
      if (!document.body) return null;
      if (isThrownOutsideOwnBundle(event, ownBundle)) return null;
      if (hasNoOwnFrame(event, ownBundle)) return null;
      if (isWrappedInvisibleCallback(event)) return null;
      if (isBoundaryErrorThrownByForeignCode(event, ownBundle)) return null;
      if (isInjectedBrowserError(event)) return null;
      if (followsFailedChunkFetch(event, ownBundle)) return null;
      event.contexts = {
        ...event.contexts,
        movix_document: {
          readyState: document.readyState,
          hasBody: Boolean(document.body),
          visibilityState: document.visibilityState,
          online: navigator.onLine,
        },
      };
      // Les chunks tronqués et les échecs SystemJS #3 sont désormais traités
      // comme des échecs de chargement (isRecoverableError) et ne partent plus.
      if (event.exception?.values?.some((exception) =>
        exception.type === 'SyntaxError'
          && /^Importing binding name '[A-Za-z_$][\w$]*' is not found\.$/.test(exception.value || '')
      )) {
        const assetLoads = readRecentAssetLoads();
        if (assetLoads) event.contexts.movix_asset_loads = assetLoads;
      }
      sentEvents += 1;
      return event;
    },
  });

  enabled = true;

  // Test de la chaîne en prod depuis la console : `window.__movixTestCrash()`.
  // Capture explicite (mechanism handled), donc exemptée du filtre par cadre
  // de pile qui jette tout ce qui vient de la console.
  (window as unknown as Record<string, unknown>).__movixTestCrash = (message?: string): string =>
    Sentry.captureException(new Error(message || 'Test GlitchTip depuis la console'));
};

/**
 * Remonte un crash rattrapé par ErrorBoundary, avec la pile de composants.
 * Renvoie l'identifiant de l'événement (affiché à l'utilisateur, utile au
 * support), ou null si le suivi est coupé (dev, DSN absent).
 */
export const captureCrash = (error: unknown, errorInfo: ErrorInfo): string | null => {
  if (!enabled) return null;
  return Sentry.captureReactException(error, errorInfo, {
    mechanism: { handled: true, type: 'auto.function.react.error_boundary' },
  });
};
