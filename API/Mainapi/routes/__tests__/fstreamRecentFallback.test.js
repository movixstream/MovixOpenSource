'use strict';
// Aucune alerte Discord depuis les tests, même si l'environnement en déclare une.
process.env.WIFLIX_PROXY_BLOCK_WEBHOOK_URL = '';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const cheerio = require('cheerio');
const { createSingleFlight } = require('../../utils/singleFlight');
const { FSTREAM_BASE_URL } = require('../../config/fstream');

const ROUTES_DIR = path.join(__dirname, '..');
const UTILS_DIR = path.join(ROUTES_DIR, '..', 'utils');
const filename = path.join(ROUTES_DIR, 'fstream.js');
const source = fs.readFileSync(filename, 'utf8');
const fragment = (begin, end) => {
  const start = source.indexOf(begin), stop = source.indexOf(end, start);
  assert.ok(start > 0 && stop > start);
  return source.slice(start, stop);
};
const tick = () => new Promise(resolve => setImmediate(resolve));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const plain = value => JSON.parse(JSON.stringify(value));
const BASE = 'https://source.test';

const card = (id, title) => `<div class="short film"><a class="short-poster" href="/${id}-film.html"><img src="/img/${id}.jpg"></a>`
  + `<div class="short-title">${title}</div><span id="trailer-${id}">yt${id}</span><span id="desc-${id}">Résumé ${id}</span>`
  + '<div class="film-quality"><a>HD</a></div><div class="film-version"><a>VF</a></div><div class="vote-score">7.5</div></div>';
const filmsPage = (...cards) => `<html><body><div id="dle-content">${cards.join('')}</div></body></html>`;

// Fonctions « récents » isolées, avec une horloge et un French-Stream simulés.
function loadRecentFunctions(request) {
  let time = 1_000;
  const calls = [];
  const context = vm.createContext({
    Date: { now: () => time }, console: { error() {}, log() {} },
    cheerio, createSingleFlight, refreshStep: () => {}, FSTREAM_BASE_URL: BASE,
    axiosFStreamRequest: async config => { calls.push(config.url); return request(config); },
  });
  vm.runInContext(fragment('function calculateTitleSimilarity(', 'function normalizeFStreamBaseTitle(')
    + fragment('// === Scraping Functions ===', '// === API-based extraction helpers ===')
    + '\nglobalThis.api = { scrapeFStreamRecentMovies, getRecentFStreamMovies, findMovieInRecentFStream, findSeriesInRecentFStream };',
  context, { filename });
  return { api: context.api, calls, advance: ms => { time += ms; } };
}

test('50 recherches simultanées lisent /films/ une fois et reçoivent la même liste gelée, réduite à titre, lien et affiche', async () => {
  const { api, calls } = loadRecentFunctions(async () => {
    await tick();
    return { status: 200, data: filmsPage(card(1, 'Le Film Rare (2024)'), card(2, 'Autre Film')) };
  });
  const results = await Promise.all(Array.from({ length: 50 }, (_, i) => i % 2
    ? api.findMovieInRecentFStream('Le Film Rare', '2024') : api.getRecentFStreamMovies()));
  assert.deepEqual(calls, [`${BASE}/films/`]);
  const list = results[0];
  assert.ok(Object.isFrozen(list) && list.every(item => Object.isFrozen(item)));
  assert.ok(results.every((result, i) => result === (i % 2 ? list[0] : list)));
  assert.deepEqual(plain(list), [
    { title: 'Le Film Rare (2024)', link: `${BASE}/1-film.html`, poster: `${BASE}/img/1.jpg` },
    { title: 'Autre Film', link: `${BASE}/2-film.html`, poster: `${BASE}/img/2.jpg` },
  ]);
});

test('la liste est relue après 10 minutes, l’ancienne restant servie pendant la lecture', async () => {
  let version = 1, release = null;
  const { api, calls, advance } = loadRecentFunctions(async () => {
    if (version === 2) await new Promise(resolve => { release = resolve; });
    return { status: 200, data: filmsPage(card(version, `Film ${version}`)) };
  });
  const first = await api.getRecentFStreamMovies();
  advance(10 * 60 * 1000 - 1);
  assert.equal(await api.getRecentFStreamMovies(), first);
  assert.equal(calls.length, 1);
  advance(1);
  version = 2;
  assert.equal(await api.getRecentFStreamMovies(), first, 'aucune attente pendant l’actualisation');
  await tick();
  assert.equal(await api.getRecentFStreamMovies(), first);
  assert.equal(calls.length, 2, 'une seule relecture en cours');
  release();
  await tick();
  const second = await api.getRecentFStreamMovies();
  assert.equal(second[0].title, 'Film 2');
  assert.equal(calls.length, 2);
});

test('un échec ou une liste vide n’est gardé que 60 s et n’efface jamais une liste valide', async () => {
  let mode = 'error';
  const { api, calls, advance } = loadRecentFunctions(async () => {
    if (mode === 'error') throw new Error('timeout');
    return { status: 200, data: mode === 'empty' ? filmsPage() : filmsPage(card(7, 'Film 7')) };
  });
  assert.equal((await api.getRecentFStreamMovies()).length, 0);
  assert.equal(await api.findMovieInRecentFStream('Film 7'), null);
  advance(59_999);
  assert.equal((await api.getRecentFStreamMovies()).length, 0);
  assert.equal(calls.length, 1, 'pas de nouvelle lecture pendant 60 s');
  advance(1);
  mode = 'ok';
  const list = await api.getRecentFStreamMovies();
  assert.equal(list[0].title, 'Film 7');
  assert.equal(calls.length, 2);

  for (const failure of ['empty', 'error']) {
    advance(10 * 60 * 1000);
    mode = failure;
    assert.equal(await api.getRecentFStreamMovies(), list);
    await tick();
    const count = calls.length;
    assert.equal(await api.getRecentFStreamMovies(), list, `liste valide gardée après : ${failure}`);
    advance(59_999);
    await api.getRecentFStreamMovies();
    assert.equal(calls.length, count, 'nouvel essai seulement après 60 s');
  }
});

test('/test/recent garde la lecture complète de /films/, sans mémoire', async () => {
  const { api, calls } = loadRecentFunctions(async () => ({ status: 200, data: filmsPage(card(3, 'Film 3')) }));
  const [movie] = await api.scrapeFStreamRecentMovies();
  await api.scrapeFStreamRecentMovies();
  assert.equal(calls.length, 2);
  assert.deepEqual(plain(movie), {
    title: 'Film 3', link: `${BASE}/3-film.html`, id: '3', trailerId: 'yt3', description: 'Résumé 3',
    quality: 'HD', version: 'VF', posterUrl: `${BASE}/img/3.jpg`, rating: 7.5, source: 'fstream_recent',
  });
  assert.match(source, /router\.get\('\/test\/recent', async[\s\S]*?await scrapeFStreamRecentMovies\(\);/);
  assert.match(source, /router\.get\('\/test\/recent-series', async[\s\S]*?await scrapeFStreamRecentSeries\(\);/);
});

test('la liste /s-tv/ des séries récentes est partagée de la même façon', async () => {
  const { api, calls } = loadRecentFunctions(async () => {
    await tick();
    return { status: 200, data: '<div id="dle-content"><div class="short serie"><a class="short-poster" href="/9-serie.html"></a>'
      + '<div class="short-title">Série Neuve - Saison 1</div></div></div>' };
  });
  const results = await Promise.all(Array.from({ length: 10 }, () => api.findSeriesInRecentFStream('Série Neuve - Saison 1')));
  assert.deepEqual(calls, [`${BASE}/s-tv/`]);
  assert.ok(results.every(result => result === results[0] && Object.isFrozen(result)));
  assert.deepEqual(plain(results[0]), { title: 'Série Neuve - Saison 1', link: `${BASE}/9-serie.html` });
});

// === Route réelle, dépendances simulées ===
function installModuleStubs(stubs) {
  const snapshots = [];
  for (const [request, exports] of Object.entries(stubs)) {
    const resolved = require.resolve(request);
    snapshots.push([resolved, require.cache[resolved]]);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  }
  return () => {
    for (const [resolved, previous] of snapshots.reverse()) {
      if (previous) require.cache[resolved] = previous;
      else delete require.cache[resolved];
    }
  };
}

const transient = () => Object.assign(new Error('TMDB 429'), { code: 'TMDB_TRANSIENT' });
const searchItem = (id, title) => `<div class="search-item" onclick="location.href='/${id}-film.html'"><div class="search-title">${title}</div></div>`;
const refusingVerifier = ({ details }) => ({
  titles: [details.title],
  aliases: async () => [details.title],
  verify: async () => ({ accepted: false, reason: 'identity_unconfirmed' }),
});

async function loadRoute(t, { search = () => '', films = () => filmsPage(), verifier = refusingVerifier, redis = null,
  english = true } = {}) {
  for (const method of ['error', 'warn', 'info', 'log']) t.mock.method(console, method, () => {});
  const { createFStreamCacheStore } = require('../../utils/fstreamCache');
  const cacheDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'movix-fstream-recent-'));
  const store = createFStreamCacheStore({ cacheDir, redis: null, refreshMs: 50 });
  const requests = [], invalidations = [], waiters = [];
  const restoreTmdb = installModuleStubs({
    [path.join(UTILS_DIR, 'tmdbCache.js')]: {
      // english: false simule une fiche en-US perdue (429) : fetchTmdbDetails renvoie alors null.
      fetchTmdbDetails: async (_url, _key, id, _type, language) => (language === 'en-US' && !english ? null
        : { id: Number(id), title: `Film ${id}`, original_title: `Film ${id}`, release_date: '2001-05-01', overview: '' }),
      fetchTmdbSeason: async () => null, fetchTmdbAlternativeTitles: async () => null,
      fetchTmdbImages: async () => null, fetchTmdbCredits: async () => null, searchTmdb: async () => null,
    },
  });
  // Vérificateur simulé : seul le contrat (refus, ou erreur TMDB_TRANSIENT) compte ici.
  const identityPath = require.resolve('../../utils/sourceIdentity');
  const previousIdentity = require.cache[identityPath];
  delete require.cache[identityPath];
  const identity = require(identityPath);
  const restore = installModuleStubs({
    [path.join(ROUTES_DIR, '..', 'config', 'redis.js')]: { redis },
    [identityPath]: { ...identity, createIdentityVerifier: options => verifier(options) },
    [path.join(UTILS_DIR, 'cacheManager.js')]: {
      generateFStreamCacheKey: (type, id, season = null) => `${type}_${id}${season == null ? '' : `_s${season}`}`,
      getFStreamRefreshInfo: async key => { const entry = await store.get(key); return { entry, isFresh: store.isFresh(entry) }; },
      refreshFStreamCache: async (...args) => {
        try { return await store.getOrRefresh(...args); }
        finally { waiters.splice(0).forEach(resolve => resolve()); }
      },
      invalidateFStreamCache: async key => { invalidations.push(key); return store.invalidate(key); },
      ongoingFStreamRequests: new Map(),
      getOrCreateFStreamRequest: (_key, request) => request(),
    },
    [path.join(UTILS_DIR, 'axiosHelpers.js')]: {
      configure: () => {},
      axiosFStreamRequest: async config => {
        requests.push(`${config.method.toUpperCase()} ${config.url}`);
        if (config.url.endsWith('/engine/ajax/search.php')) {
          const result = await search(config.data.get('query'));
          return typeof result === 'string' ? { status: 200, data: result } : result;
        }
        if (config.url === `${FSTREAM_BASE_URL}/films/`) return { status: 200, data: films() };
        return { status: 200, data: '<h1>Fiche</h1>' };
      },
    },
    [path.join(UTILS_DIR, 'proxyManager.js')]: {
      PROXIES: ['test-proxy'], DARKINO_PROXIES: [], withFStreamProxy: (_entry, request) => request({}),
    },
    [require.resolve('axios')]: async config => {
      requests.push(`GET ${config.url}`);
      const id = config.url.match(/film_api\.php\?id=(\d+)/)?.[1];
      if (!id) throw new Error(`Requête inattendue : ${config.url}`);
      return { status: 200, data: { players: { premium: { default: `https://player.invalid/${id}` } } } };
    },
  });
  delete require.cache[filename];
  const app = express();
  app.use('/api/fstream', require(filename));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
    delete require.cache[filename];
    restore();
    if (previousIdentity) require.cache[identityPath] = previousIdentity;
    else delete require.cache[identityPath];
    restoreTmdb();
    await fsp.rm(cacheDir, { recursive: true, force: true });
  });
  return {
    store, requests, invalidations,
    count: suffix => requests.filter(request => request.endsWith(suffix)).length,
    nextRefresh: () => new Promise(resolve => waiters.push(resolve)),
    get: async route => {
      const response = await fetch(`${url}/api/fstream${route}`);
      return { status: response.status, retryAfter: response.headers.get('retry-after'), body: await response.json() };
    },
  };
}

test('route : 50 films introuvables demandés en même temps ne lisent /films/ qu’une fois', async t => {
  const route = await loadRoute(t, { films: () => filmsPage(card(900, 'Sans Rapport')) });
  const responses = await Promise.all(Array.from({ length: 50 }, (_, i) => route.get(`/movie/${i + 1}`)));
  assert.ok(responses.every(response => response.status === 404 && response.body.code === 'content_not_found'));
  assert.equal(route.count(`GET ${FSTREAM_BASE_URL}/films/`), 1);
  assert.equal(route.count('/search.php'), 50);
});

test('route : une recherche en échec ne lit pas /films/ et répond 503 avec Retry-After', async t => {
  const route = await loadRoute(t, { search: () => ({ status: 500, data: '' }) });
  for (const attempt of ['échec', 'reprise de 60 s']) {
    const response = await route.get('/movie/5');
    assert.equal(route.count('/films/'), 0, 'la recherche a échoué : /films/ ne doit pas être lu');
    assert.equal(response.status, 503, attempt);
    assert.equal(response.retryAfter, '60', attempt);
    assert.equal(response.body.code, 'source_temporarily_unavailable');
  }
  assert.equal(route.count('/search.php'), 1, 'la reprise de 60 s ne relance pas la recherche');
});

test('route : un TMDB_TRANSIENT pendant la revérification du lien en cache garde le cache, jamais de 404', async t => {
  const verifier = ({ details }) => ({
    titles: [details.title],
    aliases: async () => { throw transient(); },
    verify: async (_candidate, { enrich = true } = {}) => {
      if (enrich) throw transient();
      return { accepted: false, reason: 'identity_unconfirmed' };
    },
  });
  const route = await loadRoute(t, { verifier, search: query => searchItem(query.split(' ')[1], query) });
  const link = `${FSTREAM_BASE_URL}/77-film.html`;
  const cached = { success: true, source: 'FStream', type: 'movie', tmdb: { id: 77, title: 'Film 77' },
    search: { bestMatch: { title: 'Film 77', originalTitle: 'Film 77', link } },
    players: { Default: [{ url: 'https://cached.invalid/77' }] }, total: 1 };
  await route.store.save('movie_77', cached);
  await delay(60);
  let refreshed = route.nextRefresh();
  const stale = await route.get('/movie/77');
  assert.equal(stale.status, 200);
  assert.deepEqual(stale.body, cached);
  await refreshed;
  assert.equal(route.count(`GET ${link}`), 1, 'la fiche en cache a bien été revérifiée');
  assert.deepEqual(route.invalidations, []);
  assert.deepEqual((await route.store.get('movie_77')).data, cached);
  assert.equal(route.count('/films/'), 0);
  refreshed = route.nextRefresh();
  const next = await route.get('/movie/77');
  assert.equal(next.status, 200);
  assert.deepEqual(next.body, cached);
  await refreshed;

  // Sans cache : échec passager (503 + Retry-After), pas un « absent » mémorisé.
  for (const attempt of ['échec', 'reprise de 60 s']) {
    const cold = await route.get('/movie/78');
    assert.equal(cold.status, 503, attempt);
    assert.equal(cold.retryAfter, '60', attempt);
    assert.equal(cold.body.code, 'source_temporarily_unavailable');
  }
});

test('route : un vrai refus du lien en cache l’invalide toujours (homonyme réfuté)', async t => {
  const route = await loadRoute(t, { search: query => searchItem(query.split(' ')[1], query) });
  const link = `${FSTREAM_BASE_URL}/79-film.html`;
  await route.store.save('movie_79', { success: true, source: 'FStream', type: 'movie', tmdb: { id: 79, title: 'Film 79' },
    search: { bestMatch: { title: 'Film 79', link } }, players: { Default: [{ url: 'https://cached.invalid/79' }] }, total: 1 });
  await delay(60);
  const refreshed = route.nextRefresh();
  assert.equal((await route.get('/movie/79')).status, 200);
  await refreshed;
  assert.deepEqual(route.invalidations, ['movie_79']);
  const after = await route.get('/movie/79');
  assert.equal(after.status, 404);
  assert.equal(after.body.code, 'content_not_found');
});

test('route : sans la fiche TMDB en-US (429), un refus du lien en cache ne l’invalide pas', async t => {
  const route = await loadRoute(t, { english: false, search: query => searchItem(query.split(' ')[1], query) });
  const link = `${FSTREAM_BASE_URL}/81-film.html`;
  const cached = { success: true, source: 'FStream', type: 'movie', tmdb: { id: 81, title: 'Film 81' },
    search: { bestMatch: { title: 'Film 81', link } }, players: { Default: [{ url: 'https://cached.invalid/81' }] }, total: 1 };
  await route.store.save('movie_81', cached);
  await delay(60);
  let refreshed = route.nextRefresh();
  assert.equal((await route.get('/movie/81')).status, 200);
  await refreshed;
  assert.equal(route.count(`GET ${link}`), 1, 'la fiche en cache a bien été revérifiée et refusée');
  assert.deepEqual(route.invalidations, []);
  assert.deepEqual((await route.store.get('movie_81')).data, cached);
  refreshed = route.nextRefresh();
  const after = await route.get('/movie/81');
  assert.equal(after.status, 200);
  assert.deepEqual(after.body, cached);
  await refreshed;
});

test('route : une vérification en échec sur un candidat n’interrompt pas la recherche', async t => {
  const verifier = ({ details }) => ({
    titles: [details.title],
    aliases: async () => [details.title],
    verify: async candidate => {
      if (!candidate.year) throw transient();
      return { accepted: true, reason: 'title_and_year' };
    },
  });
  const route = await loadRoute(t, { verifier, search: () => searchItem(11, 'Film 11') + searchItem(12, 'Film 11 (2001)') });
  const response = await route.get('/movie/11');
  assert.equal(response.status, 200);
  assert.equal(response.body.search.bestMatch.link, `${FSTREAM_BASE_URL}/12-film.html`);
  assert.equal(response.body.total, 1);
});

test('route : le cache de recherche FStream reste local au worker, sans GET ni SET Redis', async t => {
  const operations = [];
  const redis = {
    status: 'ready',
    get: async key => { operations.push(`get ${key}`); return null; },
    set: async key => { operations.push(`set ${key}`); return 'OK'; },
  };
  const route = await loadRoute(t, { redis, search: () => searchItem(31, 'Autre Titre') });
  assert.equal((await route.get('/movie/31')).status, 404);
  assert.equal(route.count('/search.php'), 1);
  assert.deepEqual(operations.filter(operation => operation.includes('fstream:search')), []);
});
