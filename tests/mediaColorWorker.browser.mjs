/**
 * Vérification navigateur de l'extraction de couleur des cartes et de son
 * partage avec le service worker.
 *
 * Le scénario monte les vraies cards, sert le vrai public/sw.js depuis
 * un serveur HTTP local et simule uniquement l'image TMDB. Il ne démarre pas
 * Vite et ne contacte aucun service externe.
 *
 * Profil de la version actuelle (avant optimisation) :
 *   $env:MEDIA_COLOR_EXPECTATION='baseline'
 *   $env:MEDIA_COLOR_SOURCE_REF='fee8861031eafc133079cf02186e94efbaacab26'
 *   node tests/mediaColorWorker.browser.mjs
 *
 * Profil attendu après l'optimisation :
 *   $env:MEDIA_COLOR_EXPECTATION='optimized'
 *   node tests/mediaColorWorker.browser.mjs
 *
 * MEDIA_COLOR_REPORT_DIR conserve REPORT.md, results.json, captures et traces
 * hors du dépôt. CODEX_PRIMARY_RUNTIME_NODE_MODULES permet de fournir
 * Playwright depuis le runtime Codex.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { deflateSync } from 'node:zlib';
import { build } from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const runtimeRequire = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ? createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'package.json'))
  : require;
const { chromium } = runtimeRequire('playwright');

const expectation = process.env.MEDIA_COLOR_EXPECTATION || 'optimized';
const debug = process.env.MEDIA_COLOR_DEBUG === '1';
const traceLog = (...values) => { if (debug) console.error('[media-color-e2e]', ...values); };
const selectedScenarios = process.env.MEDIA_COLOR_SCENARIOS?.split(',').map((value) => value.trim()).filter(Boolean);
assert.ok(expectation === 'baseline' || expectation === 'optimized',
  'MEDIA_COLOR_EXPECTATION doit valoir baseline ou optimized');
const sourceRef = process.env.MEDIA_COLOR_SOURCE_REF || null;
const sourceCommit = sourceRef
  ? execFileSync('git', ['rev-parse', sourceRef], { cwd: repo, encoding: 'utf8' }).trim()
  : null;
const artifactDir = process.env.MEDIA_COLOR_REPORT_DIR
  ? path.resolve(process.env.MEDIA_COLOR_REPORT_DIR)
  : await mkdtemp(path.join(tmpdir(), 'movix-media-color-worker-'));
const work = path.join(artifactDir, 'fixture');
await mkdir(work, { recursive: true });

const source = (name) => JSON.stringify(path.join(repo, 'src', name));

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const body = Buffer.concat([name, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  return Buffer.concat([length, body, crc]);
}

// PNG raster 64×96 : une grande zone gris clair et un accent rouge inférieur.
// Cela permet de vérifier aussi cardsIgnoreLightBackgrounds sans dépendre d'un
// fichier d'image du poste de développement.
function createPosterPng() {
  const width = 64;
  const height = 96;
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 4);
    row[0] = 0;
    for (let x = 0; x < width; x++) {
      const offset = 1 + x * 4;
      const red = y >= 72 ? 196 : 238;
      const green = y >= 72 ? 54 : 238;
      const blue = y >= 72 ? 42 : 238;
      row[offset] = red;
      row[offset + 1] = green;
      row[offset + 2] = blue;
      row[offset + 3] = 255;
    }
    rows.push(row);
  }
  const raw = Buffer.concat(rows);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const posterBody = createPosterPng();

const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import fr from ${source('i18n/locales/fr.json')};
import { LightModeProvider } from ${source('context/LightModeContext')};
import { TooltipProvider } from ${source('components/ui/tooltip')};
import { SearchGridCard, SearchListCard } from ${source('components/SearchCard')};
import { CarouselCard } from ${source('components/EmblaCarousel')};

const params = new URLSearchParams(location.search);
const mode = params.get('mode') || 'auto';
const algorithm = params.get('algorithm') || 'legacy';
const ignoreLightBackgrounds = params.get('ignore') !== 'false';
const concurrent = params.get('concurrent') === 'true';
const surface = params.get('surface') || 'grid';
const disableSw = params.get('sw') === 'off';

if (!disableSw && 'serviceWorker' in navigator) {
  const registration = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  }
}

localStorage.setItem('settings_media_colors', JSON.stringify({
  heroMode: 'off', cardsMode: mode, heroAlgorithm: 'legacy', cardsAlgorithm: algorithm,
  heroColor: '#b33838', cardsColor: '#2674c9', sharedFixedColor: false,
  heroGradientPosition: 'bottom', heroBaseGradient: true, cardsBaseGradient: true,
  heroIgnoreLightBackgrounds: true, cardsIgnoreLightBackgrounds: ignoreLightBackgrounds,
}));
localStorage.setItem('settings_image_quality', 'economy');
localStorage.setItem('settings_light_mode', 'off');
localStorage.setItem('watchlist_movie', '[]');

const item = {
  id: 42, title: 'Affiche témoin', media_type: 'movie', poster_path: '/poster.png',
  overview: 'Fixture raster', vote_average: 8, release_date: '2024-01-01',
};

function App() {
  const cards = concurrent ? [0, 1] : [0];
  return <main data-media-color-case style={{ width: 240, padding: 12 }}>
    {cards.map((index) => <div data-card-slot={index} key={index}>
      {surface === 'carousel' ? <CarouselCard item={item} priority />
        : surface === 'list' ? <SearchListCard item={item} index={index} movieLabel="Film" serieLabel="Série" watchlistLabel="Ajouter" removeLabel="Retirer" noDescLabel="Résumé" animateEntrance={false} />
        : <SearchGridCard item={item} index={index} movieLabel="Film" serieLabel="Série" animateEntrance={false} />}
    </div>)}
  </main>;
}

await i18next.init({ lng: 'fr', resources: { fr: { translation: fr } }, interpolation: { escapeValue: false } });
createRoot(document.getElementById('root')).render(
  <I18nextProvider i18n={i18next}>
    <LightModeProvider>
      <TooltipProvider><MemoryRouter><App /></MemoryRouter></TooltipProvider>
    </LightModeProvider>
  </I18nextProvider>,
);
`;

await writeFile(path.join(work, 'entry.tsx'), fixture, 'utf8');

const sourceOverrides = new Map();
if (sourceRef) {
  for (const relative of ['components/SearchCard.tsx', 'components/EmblaCarousel.tsx', 'hooks/useMediaColor.ts', 'services/mediaColorService.ts']) {
    const contents = execFileSync('git', ['show', `${sourceRef}:src/${relative}`], { cwd: repo, encoding: 'utf8' });
    sourceOverrides.set(path.resolve(repo, 'src', relative), contents);
  }
}

await build({
  entryPoints: [path.join(work, 'entry.tsx')],
  outfile: path.join(work, 'app.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  jsx: 'automatic',
  nodePaths: [path.join(repo, 'node_modules')],
  alias: { '@': path.join(repo, 'src') },
  define: { 'import.meta.env': '{}' },
  plugins: [{
    name: 'media-color-fixture-context',
    setup(builder) {
      builder.onResolve({ filter: /useAgeRestrictedContent$|PrefetchLink$|\/i18n$/ }, ({ path: name }) => ({
        path: name,
        namespace: 'fixture-context',
      }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture-context' }, ({ path: name }) => ({
        contents: name.endsWith('useAgeRestrictedContent')
          ? 'export const useAgeRestrictedContent=items=>({items:items||[]});'
          : name.endsWith('PrefetchLink')
            ? "export {Link as PrefetchLink} from 'react-router-dom';"
            : "export const getTmdbLanguage=()=> 'fr-FR';",
        resolveDir: repo,
      }));
      builder.onLoad({ filter: /\.(tsx?|jsx?)$/ }, ({ path: filePath }) => {
        const contents = sourceOverrides.get(path.resolve(filePath));
        if (!contents) return undefined;
        return {
          contents,
          loader: filePath.endsWith('.tsx') ? 'tsx' : 'ts',
          resolveDir: path.dirname(filePath),
        };
      });
    },
  }],
});

await writeFile(path.join(work, 'index.html'), `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
html,body,#root{margin:0;min-height:100%;background:#111;color:#fff}
main{display:block}.aspect-\\[2\\/3\\]{aspect-ratio:2/3}
main img{display:block;width:100%;height:216px;object-fit:cover}
</style></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`, 'utf8');

async function bundleServiceWorker(port) {
  const configUrl = `http://127.0.0.1:${port}/config`;
  const entry = path.join(repo, 'public/sw.js');
  if (process.env.MEDIA_COLOR_SW_FILE) {
    const configuredPath = path.resolve(process.env.MEDIA_COLOR_SW_FILE);
    traceLog('service worker configuré', configuredPath);
    return readFile(configuredPath, 'utf8');
  }
  if (sourceRef) {
    const sourceText = execFileSync('git', ['show', `${sourceRef}:public/sw.js`], { cwd: repo, encoding: 'utf8' });
    return sourceText
      .replaceAll('__MOVIX_DEFAULT_MIRRORS__', '[]')
      .replaceAll('__MOVIX_CONFIG_URL__', JSON.stringify(configUrl));
  }
  const bundled = await build({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    write: false,
    alias: { '@': path.join(repo, 'src') },
    define: {
      '__MOVIX_DEFAULT_MIRRORS__': '[]',
      '__MOVIX_CONFIG_URL__': JSON.stringify(configUrl),
    },
  });
  const output = bundled.outputFiles?.[0]?.text;
  if (!output) throw new Error('Bundle du service worker introuvable');
  return output;
}

let serviceWorkerBody = '';
const server = createServer((request, response) => {
  const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
  const pathname = requestUrl.pathname;
  if (pathname === '/sw.js') {
    response.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(serviceWorkerBody);
    return;
  }
  if (pathname === '/config') {
    response.writeHead(404, { 'Content-Type': 'text/plain' });
    response.end('no mirrors');
    return;
  }
  if (pathname === '/' || pathname === '/index.html') {
    readFile(path.join(work, 'index.html')).then((body) => {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(body);
    });
    return;
  }
  if (pathname === '/app.js') {
    readFile(path.join(work, 'app.js')).then((body) => {
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      response.end(body);
    });
    return;
  }
  response.writeHead(404, { 'Content-Type': 'text/plain' });
  response.end('not found');
});
const listen = promisify(server.listen.bind(server));
await listen(0, '127.0.0.1');
const port = server.address().port;
traceLog('serveur local', port);
serviceWorkerBody = await bundleServiceWorker(port);
traceLog('service worker prêt', serviceWorkerBody.length);

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
});
const results = [];
const failures = [];

function isPoster(url) {
  return url.hostname === 'image.tmdb.org'
    && !isSample(url)
    && /\/t\/p\/(?:w\d+|original)\/poster\.png$/.test(url.pathname);
}

function isSample(url) {
  return url.hostname === 'image.tmdb.org' && /\/t\/p\/w92\/poster\.png$/.test(url.pathname);
}

async function scenario(name, options, verify) {
  if (selectedScenarios && !selectedScenarios.includes(name)) return;
  const context = await browser.newContext({
    viewport: { width: 800, height: 700 },
    deviceScaleFactor: options.dpr || 1,
    serviceWorkers: options.sw === 'off' ? 'block' : 'allow',
  });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const networkRequests = [];
  const observedRequests = [];
  const errors = [];
  const consoleMessages = [];
  const routePoster = async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'image.tmdb.org') {
      networkRequests.push({ url: url.href, method: route.request().method() });
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        headers: { 'access-control-allow-origin': '*' },
        body: posterBody,
      });
      return;
    }
    if (url.hostname === '127.0.0.1' && url.port === String(port)) {
      await route.continue();
      return;
    }
    if (url.hostname === 'api.themoviedb.org' && url.pathname.endsWith('/images')) {
      await route.fulfill({ json: { posters: [], logos: [] }, headers: { 'access-control-allow-origin': '*' } });
      return;
    }
    await route.abort();
  };
  await context.route('**/*', routePoster);
  const page = await context.newPage();
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname === 'image.tmdb.org') observedRequests.push({ url: url.href, method: request.method() });
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => consoleMessages.push(`${message.type()}: ${message.text()}`));
  const baseUrl = `http://127.0.0.1:${port}/?mode=${encodeURIComponent(options.mode || 'auto')}&algorithm=${encodeURIComponent(options.algorithm || 'legacy')}&ignore=${options.ignoreLightBackgrounds === false ? 'false' : 'true'}&concurrent=${options.concurrent ? 'true' : 'false'}&sw=${options.sw || 'on'}&surface=${options.surface || 'grid'}`;
  let status = 'passed';
  let error;
  let snapshot;
  try {
    traceLog('scénario', name, 'goto');
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    traceLog('scénario', name, 'domcontentloaded');
    await page.locator('[data-media-color-case] img').first().waitFor({ timeout: 5000 });
    await page.waitForFunction(() => document.querySelector('[data-media-color-case] img')?.naturalWidth > 0, null, { timeout: 5000 });
    traceLog('scénario', name, 'image chargée');
    if (options.mode !== 'off') await page.waitForFunction(() => {
      const cards = [...document.querySelectorAll('[data-card-slot]')];
      return cards.length > 0 && cards.every((card) => card.querySelector('[style*="--media-color"]'));
    }, null, { timeout: 10000 });
    snapshot = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('[data-card-slot]')];
      return {
        swControlled: Boolean(navigator.serviceWorker?.controller),
        sessionColorCache: sessionStorage.getItem('movix_media_colors_v8') || sessionStorage.getItem('movix_media_colors_v7'),
        cards: cards.map((slot) => {
          const card = slot.querySelector('[style*="--media-color"]') || slot.firstElementChild;
          const image = slot.querySelector('img');
          const style = card.getAttribute('style') || '';
          return {
            source: image?.currentSrc || image?.src || null,
            naturalWidth: image?.naturalWidth || 0,
            color: getComputedStyle(card).getPropertyValue('--media-color').trim() || null,
            style,
          };
        }),
      };
    });
    traceLog('scénario', name, 'snapshot', JSON.stringify(snapshot));
    await verify({ page, context, networkRequests, observedRequests, snapshot, options });
    assert.deepEqual(errors, [], 'aucune erreur JavaScript dans la fixture');
    await page.screenshot({ path: path.join(artifactDir, `${name}.png`), fullPage: true });
  } catch (failure) {
    status = 'failed';
    error = failure.message;
    traceLog('échec', name, error, JSON.stringify({ errors, consoleMessages }));
    failures.push(`${name}: ${error}`);
    await page.screenshot({ path: path.join(artifactDir, `${name}-failed.png`), fullPage: true }).catch(() => {});
  } finally {
    const tracePath = path.join(artifactDir, `${name}.trace.zip`);
    await context.tracing.stop({ path: tracePath }).catch((failure) => {
      status = 'failed';
      error = `${error ? `${error}\n` : ''}échec de sauvegarde de la trace: ${failure.message}`;
      failures.push(`${name}: ${error}`);
    });
    results.push({
      name,
      status,
      error,
      options,
      snapshot,
      networkRequests,
      observedRequests,
      posterRequests: networkRequests.filter(({ url }) => isPoster(new URL(url))),
      sampleRequests: networkRequests.filter(({ url }) => isSample(new URL(url))),
      trace: `${name}.trace.zip`,
      errors,
      consoleMessages,
    });
    await context.close();
  }
}

const countUrls = (requests, predicate) => requests.filter(({ url }) => predicate(new URL(url))).length;
const cardColor = (snapshot) => snapshot?.cards?.[0]?.color || null;
const assertColor = (snapshot, label) => {
  assert.ok(cardColor(snapshot), `${label}: palette de carte absente`);
  assert.match(cardColor(snapshot), /^\d+,\s*\d+,\s*\d+$/, `${label}: variable --media-color invalide`);
};

try {
  await scenario('auto-cold', { mode: 'auto' }, async ({ networkRequests, snapshot }) => {
    assertColor(snapshot, 'auto froid');
    const posterCount = countUrls(networkRequests, isPoster);
    const sampleCount = countUrls(networkRequests, isSample);
    assert.equal(posterCount, 1, 'auto froid: une affiche réseau attendue');
    assert.equal(sampleCount, expectation === 'baseline' ? 1 : 0,
      expectation === 'baseline' ? 'auto froid: échantillon w92 attendu avant optimisation' : 'auto froid: aucune requête w92 attendue avec le SW');
  });

  await scenario('auto-concurrent', { mode: 'auto', concurrent: true }, async ({ networkRequests, snapshot }) => {
    assert.equal(snapshot.cards.length, 2, 'concurrent: deux cartes montées');
    assertColor(snapshot, 'concurrent');
    assert.equal(countUrls(networkRequests, isPoster), 1, 'concurrent: affiche dédupliquée');
    assert.equal(countUrls(networkRequests, isSample), expectation === 'baseline' ? 1 : 0,
      'concurrent: échantillonnage dédupliqué selon le profil');
  });

  await scenario('auto-raw-rgb', { mode: 'auto', algorithm: 'rgb', ignoreLightBackgrounds: false }, async ({ networkRequests, snapshot }) => {
    assertColor(snapshot, 'rgb brut');
    assert.equal(countUrls(networkRequests, isPoster), 1, 'rgb brut: une affiche réseau attendue');
    assert.equal(countUrls(networkRequests, isSample), expectation === 'baseline' ? 1 : 0,
      'rgb brut: échantillonnage selon le profil');
    const channels = cardColor(snapshot).split(',').map(Number);
    assert.ok(channels.every((channel) => channel > 200), 'rgb brut: le fond clair majoritaire est conservé');
  });

  for (const surface of ['carousel', 'list']) {
    await scenario(`auto-${surface}`, { mode: 'auto', surface, dpr: 2 }, async ({ networkRequests, snapshot }) => {
      assertColor(snapshot, surface);
      assert.equal(countUrls(networkRequests, isPoster), 1, `${surface}: une seule affiche réseau`);
      assert.equal(countUrls(networkRequests, isSample), expectation === 'baseline' ? 1 : 0,
        `${surface}: aucune miniature dédiée avec le service worker optimisé`);
    });
  }

  await scenario('off', { mode: 'off' }, async ({ networkRequests, snapshot }) => {
    assert.equal(cardColor(snapshot), null, 'off: aucune palette');
    assert.equal(countUrls(networkRequests, isSample), 0, 'off: aucune requête w92');
  });

  await scenario('fixed', { mode: 'fixed' }, async ({ networkRequests, snapshot }) => {
    assertColor(snapshot, 'fixed');
    assert.equal(cardColor(snapshot), '38, 116, 201', 'fixed: couleur persistée appliquée');
    assert.equal(countUrls(networkRequests, isSample), 0, 'fixed: aucune requête w92');
  });

  await scenario('fallback-without-sw', { mode: 'auto', sw: 'off' }, async ({ networkRequests, snapshot }) => {
    assert.equal(snapshot.swControlled, false, 'fallback: service worker absent');
    assertColor(snapshot, 'fallback sans SW');
    assert.equal(countUrls(networkRequests, isPoster), 1, 'fallback: affiche réseau attendue');
    assert.equal(countUrls(networkRequests, isSample), 1, 'fallback: w92 utilisé sans SW');
  });

  await scenario('cache-reload', { mode: 'auto' }, async ({ page, networkRequests, snapshot }) => {
    assertColor(snapshot, 'cache premier chargement');
    assert.equal(countUrls(networkRequests, isPoster), 1, 'cache: affiche initiale attendue');
    assert.equal(countUrls(networkRequests, isSample), expectation === 'baseline' ? 1 : 0,
      'cache: échantillon initial selon le profil');
    snapshot.initialNetworkRequests = networkRequests.slice();
    await page.evaluate(() => {
      for (const key of ['movix_media_colors_v7', 'movix_media_colors_v8']) sessionStorage.removeItem(key);
    });
    networkRequests.length = 0;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('[data-media-color-case] img').first().waitFor();
    await page.waitForFunction(() => document.querySelector('[data-media-color-case] img')?.naturalWidth > 0, null, { timeout: 5000 });
    await page.waitForFunction(() => Boolean(document.querySelector('[data-media-color-case] [style*="--media-color"]')), null, { timeout: 10000 });
    const reloaded = await page.evaluate(() => {
      const card = document.querySelector('[data-card-slot] > div');
      return { color: getComputedStyle(card).getPropertyValue('--media-color').trim() || null, controlled: Boolean(navigator.serviceWorker?.controller) };
    });
    assert.ok(reloaded.color, 'cache: couleur conservée après reload et nettoyage sessionStorage');
    assert.equal(reloaded.controlled, true, 'cache: service worker toujours contrôleur');
    assert.equal(networkRequests.length, 0, 'cache: aucune requête TMDB réseau après reload');
    snapshot.reloadNetworkRequests = networkRequests.slice();

    if (expectation !== 'optimized') return;
    // Une demande directe après éviction de l'image ne peut plus être calculée
    // depuis ses pixels : seule la couleur persistée peut satisfaire ce besoin.
    const cachedColor = await page.evaluate(async (source) => {
      for (const key of await caches.keys()) {
        if (key.startsWith('movix-tmdb-images-')) await caches.delete(key);
      }
      return new Promise((resolve, reject) => {
        const channel = new MessageChannel();
        const timeout = setTimeout(() => { channel.port1.close(); reject(new Error('Réponse du cache couleur absente')); }, 5000);
        channel.port1.onmessage = ({ data }) => {
          if (data.pending) return;
          clearTimeout(timeout);
          channel.port1.close();
          resolve(data);
        };
        navigator.serviceWorker.controller.postMessage({ type: 'MOVIX_MEDIA_COLOR', source, algorithm: 'legacy', ignoreLightBackgrounds: true }, [channel.port2]);
      });
    }, snapshot.cards[0].source);
    const expectedChannels = cardColor(snapshot).split(',').map(Number);
    const expectedHex = '#' + expectedChannels.map((channel) => channel.toString(16).padStart(2, '0')).join('');
    assert.equal(cachedColor.color, expectedHex, 'cache couleur: résultat disponible sans image ni cache de session');
    assert.equal(networkRequests.length, 0, 'cache couleur: aucune requête déclenchée par le message');
    snapshot.persistedColorWithoutImage = cachedColor;
  });
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  const report = {
    expectation,
    sourceRef,
    sourceCommit,
    serviceWorkerFile: process.env.MEDIA_COLOR_SW_FILE || null,
    node: process.version,
    platform: process.platform,
    posterBytes: posterBody.length,
    results,
    failures,
  };
  await writeFile(path.join(artifactDir, 'results.json'), JSON.stringify(report, null, 2), 'utf8');
  const lines = [
    '# Vérification E2E de l’extraction des couleurs',
    '',
    'Commande courte : `node tests/mediaColorWorker.browser.mjs`',
    '',
    'Commande de relance de ce rapport :',
    '```powershell',
    ...(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? [`$env:CODEX_PRIMARY_RUNTIME_NODE_MODULES='${process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES}'`] : []),
    `$env:MEDIA_COLOR_EXPECTATION='${expectation}'`,
    ...(sourceCommit ? [`$env:MEDIA_COLOR_SOURCE_REF='${sourceCommit}'`] : []),
    ...(!sourceCommit ? ['Remove-Item Env:MEDIA_COLOR_SOURCE_REF -ErrorAction SilentlyContinue'] : []),
    ...(process.env.MEDIA_COLOR_SW_FILE ? [`$env:MEDIA_COLOR_SW_FILE='${process.env.MEDIA_COLOR_SW_FILE}'`] : []),
    `$env:MEDIA_COLOR_REPORT_DIR='${artifactDir}'`,
    'node tests/mediaColorWorker.browser.mjs',
    '```',
    '',
    `Profil : **${expectation}**${sourceRef ? `, sources de référence \`${sourceRef}\` (SHA \`${sourceCommit}\`)` : ''}${process.env.MEDIA_COLOR_SW_FILE ? `, service worker \`${process.env.MEDIA_COLOR_SW_FILE}\`` : ''}.`,
    '',
    'Les vrais `SearchGridCard`, `SearchListCard`, `CarouselCard`, `useMediaColor`, `mediaColorService` et le service worker sont utilisés. Le serveur HTTP local sert la fixture et le SW ; les réponses TMDB sont simulées avec un PNG raster déterministe 64×96 (gris clair majoritaire, accent rouge inférieur) et des métadonnées vides.',
    '',
    'Scénarios : extraction automatique sur les trois types de cartes, deux cartes concurrentes, options RGB brut, modes off/fixed, repli sans service worker et rechargement après suppression du cache sessionStorage. En mode optimisé, une demande directe après éviction du cache image vérifie que la couleur persistée reste disponible sans nouveau téléchargement.',
    '',
    `Résultat : ${results.filter((result) => result.status === 'passed').length}/${results.length} scénarios réussis.`,
    '',
    ...results.map((result) => {
      const posterCount = result.posterRequests?.length ?? 0;
      const sampleCount = result.sampleRequests?.length ?? 0;
      const initial = result.snapshot?.initialNetworkRequests
        ? `, reload initial: affiche ${result.snapshot.initialNetworkRequests.filter(({ url }) => isPoster(new URL(url))).length}/w92 ${result.snapshot.initialNetworkRequests.filter(({ url }) => isSample(new URL(url))).length}`
        : '';
      const colorCacheReload = result.snapshot?.colorCacheReloadNetworkRequests
        ? `, cache couleur: affiche ${result.snapshot.colorCacheReloadNetworkRequests.filter(({ url }) => isPoster(new URL(url))).length}/w92 ${result.snapshot.colorCacheReloadNetworkRequests.filter(({ url }) => isSample(new URL(url))).length}`
        : '';
      return `- ${result.name} : ${result.status} — réseau affiche ${posterCount}, w92 ${sampleCount}${initial}${colorCacheReload}${result.error ? ` — ${result.error}` : ''} — [trace](${result.trace})`;
    }),
    '',
    'Les compteurs détaillés des URLs affiche/w92, la couleur effective et les requêtes observées sont dans `results.json`. Les traces s’ouvrent avec `npx playwright show-trace <trace>.trace.zip`.',
    '',
    'Prérequis : Node.js, dépendances npm et Playwright/Chromium. Aucun serveur Vite, compte ou accès réseau externe.',
    '',
    'Limites : Chromium de bureau avec données déterministes. Les comptes de requêtes ne constituent pas une mesure du temps CPU, du réseau réel ou du rendu sur téléphone/TV.',
  ];
  await writeFile(path.join(artifactDir, 'REPORT.md'), `${lines.join('\n')}\n`, 'utf8');
}

console.log(JSON.stringify({ artifactDir, expectation, sourceRef, sourceCommit, passed: results.length - failures.length, total: results.length, failures }, null, 2));
if (failures.length) process.exitCode = 1;
