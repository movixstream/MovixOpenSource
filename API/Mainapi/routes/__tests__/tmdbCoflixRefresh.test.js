// Actualisation Coflix de /api/tmdb/:type/:id : détails TMDB repris du cache,
// une seule lecture du cache par étape et pause du disjoncteur Coflix.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROUTE = path.join(__dirname, '..', 'tmdb.js');
const HOUR = 60 * 60 * 1000;
let now = 1800000000000;
class Clock extends Date { static now() { return now; } }

// sourceRefresh (mémoire des échecs 60 s) doit suivre la même horloge que la route.
const helperModule = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../utils/sourceRefresh.js'), 'utf8'), {
  module: helperModule, Date: Clock, setTimeout, clearTimeout,
  require(name) {
    if (name === './singleFlight') return require('../../utils/singleFlight');
    if (name === './refreshError') return require('../../utils/refreshError');
    throw new Error(`Dépendance inattendue : ${name}`);
  },
});
const sourceRefresh = helperModule.exports;

// Les objets créés dans le contexte vm ont un autre Object.prototype.
const plain = (value) => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(setImmediate);
async function settle() { for (let i = 0; i < 20; i++) await tick(); }

const circuitOpenError = () => Object.assign(new Error('Source Coflix en pause'), {
  code: 'SOURCE_CIRCUIT_OPEN', isSourceCircuitOpen: true, httpStatus: 503,
});
const DETAILS = { id: 42, title: 'Film', original_title: 'Film', release_date: '2020-01-01' };
const OLD_LINKS = [{ decoded_url: 'https://old.invalid/play' }];
const NEW_LINKS = [{ decoded_url: 'https://new.invalid/play' }];
const staleCache = (details = DETAILS) => ({
  tmdb_details: details,
  player_links: OLD_LINKS,
  _coflixRefreshedAt: now - 3 * HOUR,
});

function response() {
  return {
    statusCode: 200, headersSent: false, headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; this.headersSent = true; return this; },
  };
}

// `proxyManager: false` simule un proxyManager absent (require qui échoue).
function harness({ cached = null, paused = false, proxyManager } = {}) {
  const state = { cache: cached, circuitOpen: paused };
  const calls = { reads: 0, writes: [], details: [], searches: [], errors: [] };
  let readCache = async () => state.cache;
  let details = async () => ({ ...DETAILS, name: DETAILS.title, original_name: DETAILS.original_title });
  let search = async () => [{ url: 'https://coflix.invalid/film', similarity: 1 }];
  let syncClones = (links) => links;

  const routes = new Map();
  const router = {};
  for (const method of ['get', 'post', 'use']) {
    router[method] = (url, ...handlers) => routes.set(`${method} ${url}`, handlers.at(-1));
  }
  const stubs = {
    express: { Router: () => router },
    axios: {},
    path,
    fs: { promises: { access: async () => {}, mkdir: async () => {} } },
    '../utils/cacheManager': { CACHE_DIR: { COFLIX: '/fixture/coflix' }, generateCacheKey: () => 'fixture-key' },
    '../utils/tmdbCache': {
      fetchTmdbDetails: async (_url, _key, _id, _type, language) => { calls.details.push(language); return details(); },
      searchTmdb: async () => null,
      fetchTmdbImages: async () => null,
    },
    '../utils/redisLock': { acquireRedisLock: async () => ({ release: async () => {} }) },
    '../utils/sourceRefresh': sourceRefresh,
    '../utils/embedExtraction': { respondWithResolvedSources: async (_req, res, data) => res.json(data) },
    './coflix': { COFLIX_ENABLED: true },
    '../utils/cloneLinks': {
      applyCloneUrlsToPlayerLinks: async ({ playerLinks }) => playerLinks,
      syncCloneLinksForPlayerLinks: async ({ playerLinks }) => syncClones(playerLinks),
    },
  };
  if (proxyManager !== false) {
    stubs['../utils/proxyManager'] = proxyManager ?? { isCoflixCircuitOpen: () => state.circuitOpen };
  }
  const requireStub = (name) => {
    if (Object.hasOwn(stubs, name)) return stubs[name];
    throw new Error(`Dépendance non simulée : ${name}`);
  };
  const module = { exports: {} };
  const quiet = () => {};
  vm.runInNewContext(fs.readFileSync(ROUTE, 'utf8'), {
    require: requireStub, module, exports: module.exports,
    __filename: ROUTE, __dirname: path.dirname(ROUTE),
    process: { env: {}, pid: 12345 },
    console: { log: quiet, warn: quiet, error: (...args) => calls.errors.push(args.map(String).join(' ')) },
    Date: Clock, URL, URLSearchParams, Buffer, structuredClone, setTimeout, clearTimeout,
    setInterval: () => ({ unref() {} }), clearInterval() {},
  }, { filename: ROUTE, timeout: 5000 });

  module.exports.configure({
    TMDB_API_KEY: 'test-key',
    TMDB_API_URL: 'https://tmdb.invalid',
    getFromCacheNoExpiration: async () => { calls.reads++; return readCache(); },
    saveToCache: async (_dir, _key, value) => { calls.writes.push(value); state.cache = value; },
    searchCoflixByTitle: async (title, _type, year) => {
      calls.searches.push(title);
      // Comme makeCoflixRequest : le disjoncteur ouvert fait échouer l'appel.
      if (state.circuitOpen) throw circuitOpenError();
      return search(title, year);
    },
    getMovieDataFromCoflix: async () => ({ player_links: NEW_LINKS }),
    getTvDataFromCoflix: async () => ({ seasons: [], current_episode: null }),
    filterEmmmmbedReaders: (value) => value,
  });

  const call = async (id = '42') => {
    const res = response();
    await routes.get('get /tmdb/:type/:id')({ params: { type: 'movie', id }, query: {}, headers: {} }, res);
    return res;
  };
  return {
    state, calls, call,
    setDetails(fn) { details = fn; },
    setSearch(fn) { search = fn; },
    setClones(fn) { syncClones = fn; },
    setReadCache(fn) { readCache = fn; },
  };
}

test('Coflix : l’actualisation d’un cache périmé reprend ses détails TMDB sans les relire', async () => {
  const cached = staleCache();
  const h = harness({ cached });
  const res = await h.call();
  assert.equal(res.body, cached, 'la réponse sort du cache');
  await settle();

  assert.deepEqual(h.calls.details, [], 'aucune lecture TMDB pour des détails déjà en cache');
  assert.deepEqual(h.calls.searches, ['Film']);
  assert.equal(h.calls.writes.length, 1);
  assert.deepEqual(h.calls.writes[0].tmdb_details, cached.tmdb_details, 'même format de détails enregistré');
  assert.deepEqual(h.calls.writes[0].player_links, NEW_LINKS);
  assert.deepEqual(h.calls.errors, []);
});

test('Coflix : des détails du cache qui ne trouvent plus rien sont relus une fois et remplacés', async () => {
  const stale = { id: 42, title: 'Ancien titre', original_title: 'Original', release_date: '2020-01-01' };
  const h = harness({ cached: staleCache(stale) });
  h.setDetails(async () => ({ id: 42, title: 'Nouveau titre', original_title: 'Original', release_date: '2020-01-01' }));
  h.setSearch(async (title) => (title === 'Nouveau titre'
    ? [{ url: 'https://coflix.invalid/nouveau', similarity: 1 }]
    : []));
  await h.call();
  await settle();

  assert.deepEqual(h.calls.details, ['fr-FR'], 'une seule relecture des détails actuels');
  assert.deepEqual(h.calls.searches, ['Ancien titre', 'Original', 'Nouveau titre']);
  assert.equal(h.calls.writes.length, 1);
  assert.equal(h.calls.writes[0].tmdb_details.title, 'Nouveau titre', 'le cache garde les détails à jour');
  assert.deepEqual(h.calls.writes[0].player_links, NEW_LINKS);
});

test('Coflix : une date de sortie changée sur TMDB relance la recherche avec la nouvelle année', async () => {
  const h = harness({ cached: staleCache() });
  h.setDetails(async () => ({ ...DETAILS, release_date: '2021-05-01' }));
  h.setSearch(async (_title, year) => (year === 2021
    ? [{ url: 'https://coflix.invalid/film', similarity: 1 }]
    : []));
  await h.call();
  await settle();

  assert.deepEqual(h.calls.details, ['fr-FR']);
  assert.deepEqual(h.calls.searches, ['Film', 'Film'], 'même titre, mais avec l’année actuelle');
  assert.equal(h.calls.writes.length, 1);
  assert.equal(h.calls.writes[0].tmdb_details.release_date, '2021-05-01');
  assert.deepEqual(h.calls.writes[0].player_links, NEW_LINKS);
});

test('Coflix : sans cache, les détails fr-FR ne sont lus qu’une fois et la réponse ne change pas', async () => {
  const h = harness();
  h.setSearch(async () => []);
  const res = await h.call();

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.message, 'Contenu non disponible');
  assert.equal(res.body.tmdb_id, '42');
  assert.equal(res.body.tmdb_details.title, 'Film');
  assert.deepEqual(h.calls.details, ['fr-FR'], 'le second appel fr-FR identique a disparu');
  assert.deepEqual(h.calls.searches, ['Film']);
  assert.equal(h.calls.writes.length, 1, 'le « Contenu non disponible » reste enregistré comme avant');
});

test('Coflix : la synchro des clones transmet sa version à l’actualisation sans relire le cache', async () => {
  const h = harness({ cached: staleCache() });
  const clone = { decoded_url: 'https://clone.invalid/play' };
  h.setClones((links) => [...links, clone]);
  await h.call();
  await settle();

  assert.equal(h.calls.writes.length, 2);
  // Chaque écriture relit le cache sous verrou (saveCoflixCachePreservingPlayable).
  assert.equal(h.calls.reads - h.calls.writes.length, 2,
    'une lecture pour la réponse, une pour la synchro, aucune pour l’actualisation');
  assert.deepEqual(h.calls.writes[0].player_links, [...OLD_LINKS, clone], 'la synchro écrit sa version');
  assert.deepEqual(h.calls.writes[1].player_links, [...NEW_LINKS, clone]);
  assert.deepEqual(h.calls.errors, []);
});

test('Coflix : une synchro des clones refusée laisse l’actualisation relire le cache', async () => {
  const fresh = { tmdb_details: DETAILS, player_links: NEW_LINKS, _coflixRefreshedAt: now };
  const h = harness({ cached: staleCache() });
  h.setClones((links) => [...links, { decoded_url: 'https://clone.invalid/play' }]);
  // Un autre worker publie un cache récent entre la lecture de la synchro et son écriture.
  let reads = 0;
  h.setReadCache(async () => (++reads <= 2 ? staleCache() : fresh));
  await h.call();
  await settle();

  assert.equal(h.calls.writes.length, 0, 'le cache plus récent est gardé');
  assert.deepEqual(h.calls.searches, [], 'l’actualisation voit le cache récent au lieu de l’ancienne version');
  assert.deepEqual(h.calls.details, []);
});

test('Coflix : après une synchro récente, l’actualisation relit elle-même le cache', async () => {
  const h = harness({ cached: staleCache() });
  h.setSearch(async () => { throw new Error('upstream unavailable'); });
  await h.call();
  await settle();
  assert.equal(h.calls.reads, 2);
  assert.equal(h.calls.writes.length, 0, 'l’ancien succès est conservé');

  // Reprise après 60 s : la synchro, déjà faite, ne lit rien ; l'actualisation lit.
  now += 60001;
  h.setSearch(async () => [{ url: 'https://coflix.invalid/film', similarity: 1 }]);
  await h.call();
  await settle();
  assert.equal(h.calls.writes.length, 1);
  assert.equal(h.calls.reads, 2 + 2 + 1, 'réponse + actualisation, puis la relecture sous verrou');
  assert.deepEqual(h.calls.searches, ['Film', 'Film']);
  assert.deepEqual(h.calls.writes.at(-1).player_links, NEW_LINKS);
});

test('Coflix en pause : le cache périmé reste servi sans TMDB, recherche ni écriture', async () => {
  const cached = staleCache();
  const h = harness({ cached, paused: true });
  for (let i = 0; i < 3; i++) {
    const res = await h.call();
    assert.equal(res.statusCode, 200);
    assert.equal(res.body, cached);
    await settle();
  }
  assert.deepEqual(h.calls.details, []);
  assert.deepEqual(h.calls.searches, []);
  assert.equal(h.calls.writes.length, 0);
  assert.equal(h.state.cache, cached, 'l’ancien succès est conservé');
  assert.deepEqual(h.calls.errors, []);
  assert.equal(h.calls.reads, 3 + 1, 'une lecture par visite, plus celle de la première synchro');

  // Pas d'échec mémorisé : dès la fin de la pause, l'actualisation reprend.
  h.state.circuitOpen = false;
  await h.call();
  await settle();
  assert.deepEqual(h.calls.searches, ['Film']);
  assert.deepEqual(h.calls.writes.at(-1).player_links, NEW_LINKS);
});

test('Coflix en pause sans cache : même réponse qu’avant, rien enregistré ni journalisé', async () => {
  const h = harness({ paused: true });
  const expected = { message: 'Contenu non disponible en raison d\'une erreur', tmdb_id: '42' };
  for (let i = 0; i < 3; i++) {
    const res = await h.call();
    assert.equal(res.statusCode, 200);
    assert.deepEqual(plain(res.body), expected);
  }
  assert.deepEqual(h.calls.searches, [], 'aucune recherche vouée à l’échec');
  assert.equal(h.calls.writes.length, 0, 'pas de cache négatif');
  assert.deepEqual(h.calls.details, ['fr-FR'], 'un seul essai par minute, comme avant');
  assert.deepEqual(h.calls.errors, [], 'l’échec mémorisé reste silencieux');

  now += 60001;
  h.state.circuitOpen = false;
  const res = await h.call();
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.player_links, NEW_LINKS);
});

test('Coflix en pause sans cache ni détails TMDB : le 404 ne change pas', async () => {
  const h = harness({ paused: true });
  h.setDetails(async () => null);
  const res = await h.call('99');
  assert.equal(res.statusCode, 404);
  assert.deepEqual(plain(res.body), { message: 'Contenu non trouve sur TMDB' });
  assert.deepEqual(h.calls.searches, []);
  assert.equal(h.calls.writes.length, 0);
  assert.deepEqual(h.calls.errors, []);
});

test('Coflix en pause : un cache apparu entre deux lectures est servi au lieu d’une erreur', async () => {
  const cached = staleCache();
  const h = harness({ paused: true });
  let reads = 0;
  h.setReadCache(async () => (++reads === 1 ? null : cached));
  const res = await h.call();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, cached);
  assert.deepEqual(h.calls.details, []);
  assert.deepEqual(h.calls.searches, []);
  assert.equal(h.calls.writes.length, 0);
});

test('Coflix : sans isCoflixCircuitOpen (ou sans proxyManager), l’actualisation reste celle d’avant', async () => {
  for (const proxyManager of [{}, false]) {
    const h = harness({ cached: staleCache(), proxyManager });
    await h.call();
    await settle();
    assert.deepEqual(h.calls.searches, ['Film']);
    assert.deepEqual(h.calls.writes.at(-1).player_links, NEW_LINKS);
  }
});
