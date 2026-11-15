// Contrat de navigation du service worker (public/sw.js).
//
// Le SW est exécuté dans un contexte `vm` avec un `fetch` simulé : on vérifie
// le comportement réel de `handleNavigation`, pas la forme du source.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// Le SW est bundlé par Vite : ses imports (cache des couleurs et des images
// TMDB) sont remplacés par des bouchons, hors du périmètre de la navigation.
const IMPORT_STUBS = [
  "const MEDIA_COLOR_CACHE_NAME = 'media-color-test';",
  "const TMDB_IMAGE_CACHE_NAME = 'tmdb-images-test';",
  'const handleTmdbImage = (req) => fetch(req);',
  'const installMediaColorServiceWorker = () => {};',
].join('\n');

const SOURCE = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
  .replace(/^import\s*\{[^}]*\}\s*from\s*['"][^'"]+['"];?/m, IMPORT_STUBS)
  .replace('__MOVIX_DEFAULT_MIRRORS__', '["miroir.example"]')
  .replace('__MOVIX_CONFIG_URL__', '"https://config.example/movix"');

// `fetchImpl(input, init)` reçoit chaque appel ; les minuteries sont réelles
// mais NAV_TIMEOUT_MS est ramené à 20ms pour garder le test rapide.
function loadWorker(fetchImpl, { onLine = true } = {}) {
  const calls = [];
  const context = {
    self: {
      addEventListener() {},
      location: { origin: 'https://movix.example', hostname: 'movix.example' },
    },
    navigator: { onLine },
    fetch: (input, init) => {
      calls.push({ input, init, argCount: init === undefined ? 1 : 2 });
      return fetchImpl(input, init);
    },
    caches: { open: async () => ({ match: async () => undefined, put: async () => {}, keys: async () => [] }) },
    URL,
    Response,
    AbortController,
    setTimeout,
    clearTimeout,
    console,
  };
  vm.createContext(context);
  vm.runInContext(
    SOURCE.replace('const NAV_TIMEOUT_MS = 3000;', 'const NAV_TIMEOUT_MS = 20;') +
      '\n;globalThis.__handleNavigation = handleNavigation;',
    context
  );
  return { handleNavigation: context.__handleNavigation, calls };
}

const NAV_REQUEST = { url: 'https://movix.example/', mode: 'navigate', method: 'GET' };
const isNav = (input) => input === NAV_REQUEST;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('la requête de navigation est relayée sans RequestInit', async () => {
  // Chromium 68 (webOS 5) lève un TypeError sur `fetch(navRequest, { … })`.
  const { handleNavigation, calls } = loadWorker(async () => new Response('ok'));
  const res = await handleNavigation(NAV_REQUEST);
  assert.equal(await res.text(), 'ok');
  const nav = calls.filter((c) => isNav(c.input));
  assert.equal(nav.length, 1);
  assert.equal(nav[0].argCount, 1, 'aucun second argument sur la requête navigate');
});

test('origine lente mais joignable : on attend la vraie réponse', async () => {
  const { handleNavigation } = loadWorker(async (input) => {
    if (isNav(input)) {
      await delay(80); // > NAV_TIMEOUT_MS
      return new Response('page lente');
    }
    return new Response(null, { status: 200 }); // sonde HEAD
  });
  const res = await handleNavigation(NAV_REQUEST);
  assert.equal(await res.text(), 'page lente');
});

test('échec réseau avec origine joignable : erreur d’origine relayée', async () => {
  const boom = new TypeError('Failed to fetch');
  const { handleNavigation } = loadWorker(async (input) => {
    if (isNav(input)) throw boom;
    return new Response(null, { status: 200 });
  });
  await assert.rejects(handleNavigation(NAV_REQUEST), (err) => err === boom);
});

test('origine injoignable : page de redirection vers le miroir', async () => {
  const { handleNavigation } = loadWorker(async (input) => {
    if (typeof input === 'string' && input.startsWith('https://config.example')) {
      return new Response('{"mirrors":["miroir.example"]}');
    }
    throw new TypeError('Failed to fetch');
  });
  const res = await handleNavigation(NAV_REQUEST);
  const html = await res.text();
  assert.match(html, /https:\/\/miroir\.example\/\?from=movix\.example/);
  assert.match(html, /via=sw-fetch/);
});
