// Chargé uniquement dans le chunk de polyfills legacy, avant l'application.
// Chrome 53 possède fetch, mais pas son annulation ni ResizeObserver ; son
// IntersectionObserver a aussi besoin du repli pour entry.isIntersecting.
// Ce chunk est assemblé séparément des chunks applicatifs : conserver une
// syntaxe compatible Chrome 53, sans optional chaining ni catch sans paramètre.
import 'abortcontroller-polyfill/dist/polyfill-patch-fetch';
import 'intersection-observer';
import ResizeObserverPolyfill from 'resize-observer-polyfill';

if (typeof window.ResizeObserver === 'undefined') {
  window.ResizeObserver = ResizeObserverPolyfill;
}

// SystemJS conserve dans son registre la promesse d'un module dont le chargement
// a échoué. Relancer ensuite le même import dynamique côté application réutilise
// donc ce rejet sans recréer de balise <script>. Installer la reprise au niveau
// d'`instantiate` permet au premier load record de refaire une vraie requête.
//
// Ce module s'exécute avant SystemJS dans le chunk de polyfills. La balise qui
// porte ce chunk émet ensuite `load` : en phase capture, le hook est posé avant
// l'import du bundle d'entrée, y compris dans le clone utilisé par le repli
// Safari 15 de @vitejs/plugin-legacy.
const SYSTEMJS_ERROR_3_SUFFIX =
  '(SystemJS https://github.com/systemjs/systemjs/blob/main/docs/errors.md#3)';
const SYSTEMJS_RETRY_DELAY_MS = 400;
const LEGACY_ASSET_PATH_RE = /^\/assets\/[^/]+-legacy-[A-Za-z0-9_-]{8}\.js$/;
const pendingLegacyLoads = Object.create(null);

const getOwnLegacyAssetUrl = (value) => {
  try {
    const url = new URL(value, window.location.href);
    if (url.origin !== window.location.origin || url.search || url.hash) return null;
    return LEGACY_ASSET_PATH_RE.test(url.pathname) ? url.href : null;
  } catch (error) {
    return null;
  }
};

// Lu par le bootstrap de récupération dans index.html. Seule la première
// erreur de ressource d'un instantiate en cours est différée ; le second échec
// conserve la purge et le rechargement encadrés existants.
window.__MOVIX_DEFER_LEGACY_SCRIPT_RECOVERY__ = (value) => {
  const url = getOwnLegacyAssetUrl(value);
  return url !== null && pendingLegacyLoads[url] === 'initial';
};

const installSystemJsTransportRetry = () => {
  const System = window.System;
  const prototype = System && System.constructor && System.constructor.prototype;
  const originalInstantiate = prototype && prototype.instantiate;
  if (typeof originalInstantiate !== 'function' || originalInstantiate.__movixTransportRetry) return;

  const instantiateWithRetry = function (...args) {
    const assetUrl = getOwnLegacyAssetUrl(args[0]);
    if (!assetUrl) return originalInstantiate.apply(this, args);

    const loader = this;
    pendingLegacyLoads[assetUrl] = 'initial';

    return Promise.resolve()
      .then(() => originalInstantiate.apply(loader, args))
      .catch((error) => {
        const message = String((error && error.message) || error || '');
        if (!message.endsWith(SYSTEMJS_ERROR_3_SUFFIX)) throw error;

        pendingLegacyLoads[assetUrl] = 'retry';
        return new Promise((resolve) => window.setTimeout(resolve, SYSTEMJS_RETRY_DELAY_MS))
          .then(() => originalInstantiate.apply(loader, args));
      })
      .then(
        (registration) => {
          delete pendingLegacyLoads[assetUrl];
          return registration;
        },
        (error) => {
          delete pendingLegacyLoads[assetUrl];
          throw error;
        }
      );
  };

  instantiateWithRetry.__movixTransportRetry = true;
  prototype.instantiate = instantiateWithRetry;
};

const onLegacyPolyfillsLoaded = (event) => {
  const target = event.target;
  if (!(target instanceof HTMLScriptElement)) return;

  const configuredPolyfills = document.getElementById('vite-legacy-polyfill');
  if (!(configuredPolyfills instanceof HTMLScriptElement)) return;
  if (target !== configuredPolyfills && target.src !== configuredPolyfills.src) return;

  installSystemJsTransportRetry();
  window.removeEventListener('load', onLegacyPolyfillsLoaded, true);
};

window.addEventListener('load', onLegacyPolyfillsLoaded, true);
