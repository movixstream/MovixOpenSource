const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const repo = path.resolve(__dirname, '../../../..');
let now = 1800000000000;
class Clock extends Date { static now() { return now; } }
const helperModule = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../utils/sourceRefresh.js'), 'utf8'), {
  module: helperModule, Date: Clock, setTimeout, clearTimeout,
  require(name) {
    if (name === './singleFlight') return require('../../utils/singleFlight');
    if (name === './refreshError') return require('../../utils/refreshError');
    throw new Error(`Dépendance helper inattendue : ${name}`);
  },
});
const sourceRefresh = helperModule.exports;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(setImmediate);
async function settle() { for (let i = 0; i < 12; i++) await tick(); }
const silentConsole = { log() {}, warn() {}, error() {}, time() {}, timeEnd() {} };
function response() {
  return { statusCode: 200, headersSent: false, headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; this.headersSent = true; return this; }
  };
}
function loadRoute(relative, stubs, suffix = '', timerOverrides = {}) {
  const filename = path.join(repo, relative);
  const source = fs.readFileSync(filename, 'utf8');
  const routes = new Map();
  const router = {};
  for (const method of ['get', 'post', 'put', 'patch', 'delete', 'use']) {
    router[method] = (url, ...handlers) => routes.set(`${method} ${url}`, handlers.at(-1));
  }
  const module = { exports: {} };
  const standard = {
    express: { Router: () => router }, path,
    '../utils/sourceRefresh': sourceRefresh,
    '../utils/sharedSourceWork': require('../../utils/sharedSourceWork'),
    '../utils/concurrency': require('../../utils/concurrency'),
    'write-file-atomic': (...args) => stubs.fs.promises.writeFile(...args),
    axios: { create: () => ({}) },
    '../utils/embedExtraction': {
      buildM3u8Map: async () => ({}),
      respondWithResolvedSources: async (_req, res, data) => res.json(data)
    },
  };
  const requireStub = (name) => {
    if (Object.hasOwn(stubs, name)) return stubs[name];
    if (Object.hasOwn(standard, name)) return standard[name];
    throw new Error(`Dépendance non simulée : ${relative}: ${name}`);
  };
  vm.runInNewContext(source + '\n' + suffix, {
    require: requireStub, module, exports: module.exports,
    __filename: filename, __dirname: path.dirname(filename),
    process: { env: {}, pid: 12345 }, console: silentConsole,
    Date: Clock, URL, URLSearchParams, Buffer, structuredClone, setTimeout, clearTimeout,
    setInterval: () => ({ unref() {} }), clearInterval() {}, ...timerOverrides
  }, { filename, timeout: 5000 });
  return { exports: module.exports, routes };
}
const cacheStub = {
  CACHE_DIR: { CPASMAL: '/fixture/cpasmal', COFLIX: '/fixture/coflix' },
  ANIME_SAMA_CACHE_DIR: '/fixture/anime', generateCacheKey: () => 'fixture-key'
};
const basicFs = { access: async () => {}, mkdir: async () => {}, utimes: async () => {} };
const lockStub = { acquireRedisLock: async () => ({ release: async () => {} }) };

function tmdbHarness({ enabled = true, cached = null, stale = true } = {}) {
  let cache = cached;
  const counts = { reads: 0, scrapes: 0, writes: 0, cloneChecks: 0, details: 0 };
  const errors = [];
  let details = async () => ({ title: 'Film', original_title: 'Film', release_date: '2020-01-01' });
  let scrape = async () => cached;
  let clones = links => links;
  const loaded = loadRoute('API/Mainapi/routes/tmdb.js', {
    fs: { promises: basicFs }, '../utils/cacheManager': cacheStub,
    '../utils/tmdbCache': { fetchTmdbDetails: async () => { counts.details++; return details(); } },
    '../utils/redisLock': lockStub, './coflix': { COFLIX_ENABLED: enabled },
    '../utils/cloneLinks': {
      applyCloneUrlsToPlayerLinks: async ({ playerLinks }) => playerLinks,
      syncCloneLinksForPlayerLinks: async ({ playerLinks }) => { counts.cloneChecks++; return clones(playerLinks); },
    },
  }, '', { console: { ...silentConsole, error: (...args) => errors.push(args) } });
  loaded.exports.configure({
    getFromCacheNoExpiration: async () => { counts.reads++; return cache; },
    saveToCache: async (_dir, _key, value) => { counts.writes++; cache = value; },
    shouldUpdateCacheFrenchStream: async () => stale,
    getFrenchStreamMovie: async () => { counts.scrapes++; return scrape(); },
    getFrenchStreamSeries: async () => { counts.scrapes++; return scrape(); },
    getFrenchStreamSeriesDetails: async () => { throw new Error('Les saisons FrenchCloud sont déjà chargées'); },
    extractSeriesInfo: title => ({ baseName: title, partNumber: 1 }),
    mergeSeriesParts: parts => parts[0],
    searchCoflixByTitle: async () => { counts.scrapes++; return scrape(); },
    getMovieDataFromCoflix: async () => playableMovie,
    filterEmmmmbedReaders: data => data,
    cleanTvCacheData: data => data,
  });
  const call = async (provider = 'imdb', id = '42', type = 'movie') => {
    const res = response();
    await loaded.routes.get(`get /${provider}/:type/:id`)({ params: { type, id }, query: {}, headers: {} }, res);
    return res;
  };
  return { counts, errors, call, setDetails(fn) { details = fn; }, setScrape(fn) { scrape = fn; }, setClones(fn) { clones = fn; }, get cache() { return cache; }, set cache(value) { cache = value; } };
}
const playableMovie = { player_links: [{ decoded_url: 'https://fixture.invalid/play' }] };

test('Omega: les séries FrenchCloud déjà chargées sont publiées sans seconde récupération des détails', async () => {
  const h = tmdbHarness();
  const seasons = [{ number: 1, episodes: [{ number: '1', versions: { vf: { players: [{ link: 'https://fixture.invalid/episode' }] } } }] }];
  h.setScrape(async () => [{ title: 'Série', link: 'https://frenchcloud.cam/serial/7414406', seasons }]);
  const result = await h.call('imdb', 'tt7414406', 'tv');
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.type, 'tv');
  assert.equal(result.body.series[0].seasons, seasons);
  assert.equal(h.counts.scrapes, 1);
  assert.equal(h.counts.writes, 1);
});

test('Omega: fresh movie and series hits read the cache once per request without scraping', async () => {
  const series = { type: 'tv', series: [{ title: 'Série', seasons: [] }] };
  for (const [type, cached] of [['movie', playableMovie], ['tv', series]]) {
    const h = tmdbHarness({ cached, stale: false });
    for (let i = 0; i < 20; i++) {
      const res = await h.call('imdb', '42', type);
      await settle();
      assert.equal(res.body, cached);
    }
    assert.equal(h.counts.reads, 20, 'un hit frais ne doit pas relire le JSON en arrière-plan');
    assert.equal(h.counts.scrapes, 0);
    assert.equal(h.counts.writes, 0);
  }
});

test('Omega: cold/stale bursts share one check and publication; unchanged checks are spaced', async () => {
  for (const cached of [null, playableMovie]) {
    const h = tmdbHarness({ cached });
    const gate = deferred();
    h.setScrape(async () => { await gate.promise; return playableMovie; });
    const responses = Array.from({ length: 20 }, () => h.call());
    await settle();
    assert.equal(h.counts.scrapes, 1);
    gate.resolve();
    await Promise.all(responses);
    await settle();
    assert.equal(h.counts.writes, 1);
    await h.call();
    await settle();
    assert.equal(h.counts.scrapes, 1);
  }
});

test('Omega: refresh errors retain playable cache and back off for a minute', async () => {
  const h = tmdbHarness({ cached: playableMovie });
  h.setScrape(async () => { throw new Error('upstream timeout'); });
  await h.call(); await settle();
  await h.call(); await settle();
  assert.equal(h.counts.scrapes, 1);
  assert.equal(h.counts.writes, 0);
  assert.equal(h.cache, playableMovie);
  now += 60001;
  await h.call(); await settle();
  assert.equal(h.counts.scrapes, 2);
});

test('Coflix: unchanged clone hits publish nothing; new clone appears at next check', async () => {
  const h = tmdbHarness({ cached: playableMovie, enabled: false });
  await Promise.all(Array.from({ length: 20 }, () => h.call('tmdb')));
  await settle();
  assert.equal(h.counts.cloneChecks, 1);
  assert.equal(h.counts.writes, 0);
  h.setClones(() => [{ decoded_url: 'https://clone.invalid/play' }]);
  await h.call('tmdb'); await settle();
  assert.equal(h.counts.cloneChecks, 1);
  now += 2 * 60 * 60 * 1000 + 1;
  await h.call('tmdb'); await settle();
  assert.equal(h.counts.cloneChecks, 2);
  assert.equal(h.counts.writes, 1);
  const result = await h.call('tmdb');
  assert.equal(result.body.player_links[0].decoded_url, 'https://clone.invalid/play');
});

test('Coflix: expired unchanged source checks and concurrent cold scrapes are shared', async () => {
  for (const cached of [null, { ...playableMovie, _coflixRefreshedAt: 1 }]) {
    const h = tmdbHarness({ cached });
    const gate = deferred();
    h.setScrape(async () => { await gate.promise; return []; });
    const responses = Array.from({ length: 20 }, () => h.call('tmdb'));
    await settle(); assert.equal(h.counts.scrapes, 1);
    gate.resolve(); await Promise.all(responses); await settle();
    await h.call('tmdb'); await settle();
    assert.equal(h.counts.scrapes, 1);
    if (cached) assert.equal(h.counts.writes, 0);
  }
});

test('Coflix: delayed clone publication cannot replace a newer cache', async () => {
  const h = tmdbHarness({ cached: { ...playableMovie, _coflixRefreshedAt: 100 }, enabled: false });
  const gate = deferred();
  h.setClones(async () => { await gate.promise; return [{ decoded_url: 'https://stale-clone.invalid/play' }]; });
  await h.call('tmdb'); await settle();
  const newer = { player_links: [{ decoded_url: 'https://new.invalid/play' }], _coflixRefreshedAt: 200 };
  h.cache = newer;
  gate.resolve(); await settle();
  assert.equal(h.cache, newer);
  assert.equal(h.counts.writes, 0);
});

test('Coflix: failed source refresh retains usable links and observes retry backoff', async () => {
  const h = tmdbHarness({ cached: { ...playableMovie, _coflixRefreshedAt: 1 } });
  h.setScrape(async () => { throw new Error('upstream unavailable'); });
  await h.call('tmdb'); await settle(); await h.call('tmdb'); await settle();
  assert.equal(h.counts.scrapes, 1); assert.equal(h.counts.writes, 0);
  assert(h.errors.some(args => String(args[0]).includes('upstream unavailable')), 'les erreurs inattendues restent journalisées');
  now += 60001;
  await h.call('tmdb'); await settle();
  assert.equal(h.counts.scrapes, 2);
});

test('Coflix: unavailable TMDB details return 404 quietly through bursts and the retry delay', async () => {
  const h = tmdbHarness();
  h.setDetails(async () => null);
  const request = () => h.call('tmdb', '15123747');
  const responses = await Promise.all(Array.from({ length: 20 }, request));
  for (const res of responses) {
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.message, 'Contenu non trouve sur TMDB');
  }
  assert.equal(h.counts.details, 1);
  assert.equal((await request()).statusCode, 404);
  assert.equal(h.counts.details, 1, 'aucun nouvel appel pendant les 60 secondes de reprise');
  assert.equal(h.errors.length, 0, 'aucune exception métier répétée dans les logs');
  now += 60001;
  assert.equal((await request()).statusCode, 404);
  assert.equal(h.counts.details, 2);
  assert.equal(h.counts.scrapes, 0);
  assert.equal(h.counts.writes, 0);
  assert.equal(h.errors.length, 0);
});

test('Coflix: unavailable TMDB details preserve playable stale cache without error logs', async () => {
  const cached = { ...playableMovie, _coflixRefreshedAt: 1 };
  const h = tmdbHarness({ cached });
  h.setDetails(async () => null);
  const responses = await Promise.all(Array.from({ length: 20 }, () => h.call('tmdb', '15123747')));
  await settle();
  assert(responses.every(res => res.statusCode === 200 && res.body === cached));
  await h.call('tmdb', '15123747'); await settle();
  assert.equal(h.cache, cached);
  assert.equal(h.counts.details, 1);
  assert.equal(h.counts.scrapes, 0);
  assert.equal(h.counts.writes, 0);
  assert.equal(h.errors.length, 0);
});

test('Omega: genuine not-found responses stay negatively cached; transport errors keep their response contract', async () => {
  const missing = tmdbHarness();
  missing.setScrape(async () => ({ error: 'Movie not found on FrenchCloud' }));
  assert.equal((await missing.call()).statusCode, 200);
  assert.equal(missing.counts.writes, 1);
  const failing = tmdbHarness();
  failing.setScrape(async () => ({ error: 'Failed to fetch movie data: timeout' }));
  const result = await failing.call();
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.message, 'Contenu non disponible');
  assert.equal(failing.counts.writes, 0);
  await failing.call(); assert.equal(failing.counts.scrapes, 1);
});

function cpasmalHarness(cached) {
  let cache = cached;
  let scrape = async () => cached;
  let fresh = false;
  const counts = { reads: 0, scrapes: 0, writes: 0 };
  const loaded = loadRoute('API/Mainapi/routes/cpasmal.js', {
    fs: { promises: { ...basicFs, stat: async () => ({ mtime: new Date(now - 7200000) }), writeFile: async () => { counts.writes++; } } },
    cheerio: {}, '../utils/cacheManager': cacheStub, '../utils/tmdbCache': {}, '../utils/redisLock': lockStub,
    '../config/redis': { memoryCache: { set: async (_key, value) => { cache = value; } } },
  }, `module.exports.audit = { setScrape(fn) { fetchCpasmalMovieData = fn; fetchCpasmalTvData = fn; } };`);
  loaded.exports.configure({ getFromCacheNoExpiration: async () => { counts.reads++; return cache; }, shouldUpdateCache: async () => !fresh });
  loaded.exports.audit.setScrape(async () => { counts.scrapes++; return scrape(); });
  const call = async (type = 'movie') => {
    const res = response();
    await loaded.routes.get(type === 'movie' ? 'get /movie/:tmdbid' : 'get /tv/:tmdbid/:season/:episode')({ params: { tmdbid: '42', season: '1', episode: '2' }, query: {}, headers: {} }, res);
    return res;
  };
  return { counts, call, setScrape(fn) { scrape = fn; }, set fresh(value) { fresh = value; }, get cache() { return cache; } };
}
const playableCpasmal = { _tvCacheVersion: 1, links: { vf: [{ server: 'voe', url: 'https://fixture.invalid/play' }], vostfr: [] } };

test('Cpasmal: fresh movie and episode caches read once per request without scraping', async () => {
  const h = cpasmalHarness(playableCpasmal); h.fresh = true;
  await h.call(); await h.call('tv'); await settle();
  assert.equal(h.counts.reads, 2, 'un hit frais ne doit pas relire le JSON en arrière-plan');
  assert.equal(h.counts.scrapes, 0); assert.equal(h.counts.writes, 0);
});

test('Cpasmal: cold and stale bursts respond before retrieval finishes and publish once', async () => {
  for (const type of ['movie', 'tv']) for (const cached of [null, playableCpasmal]) {
    const h = cpasmalHarness(cached); const gate = deferred();
    h.setScrape(async () => { await gate.promise; return playableCpasmal; });
    const responses = await Promise.all(Array.from({ length: 20 }, () => h.call(type)));
    for (const res of responses) {
      assert.equal(res.statusCode, cached ? 200 : 202);
      if (cached) {
        assert.deepEqual(res.body.links, cached.links);
      } else {
        assert.equal(res.body.pending, true);
        assert.equal(res.body.code, 'retrieval_in_progress');
        assert.match(res.body.message, /Récupération Cpasmal en cours/);
        assert.equal(res.body.tmdb_id, '42');
        if (type === 'tv') {
          assert.equal(res.body.season, 1);
          assert.equal(res.body.episode, 2);
        }
        assert.equal(res.headers['retry-after'], '2');
        assert.equal(res.headers['cache-control'], 'no-store');
      }
    }
    await settle(); assert.equal(h.counts.scrapes, 1);
    assert.equal(h.counts.writes, 0);
    gate.resolve(); await settle();
    assert.equal(h.counts.writes, 1);
    const ready = await h.call(type);
    assert.equal(ready.statusCode, 200);
    assert.deepEqual(ready.body.links, playableCpasmal.links);
    await settle(); assert.equal(h.counts.scrapes, 1);
  }
});

test('Cpasmal: negative refresh retains playable cache and errors do not publish/retry immediately', async () => {
  for (const fail of [false, true]) {
    const h = cpasmalHarness(playableCpasmal);
    h.setScrape(async () => { if (fail) throw new Error('timeout'); return null; });
    await h.call(); await settle(); await h.call(); await settle();
    assert.equal(h.counts.scrapes, 1); assert.equal(h.counts.writes, 0);
    assert.equal(h.cache, playableCpasmal);
  }
});

test('Cpasmal: empty positive results keep the existing ten-minute retry interval', async () => {
  const empty = { links: { vf: [], vostfr: [] } };
  const h = cpasmalHarness(empty);
  await h.call(); await settle();
  now += 10 * 60 * 1000 + 1;
  await h.call(); await settle();
  assert.equal(h.counts.scrapes, 2);
});

test('Cpasmal: failed background retrieval surfaces on polling and retries after cooldown', async () => {
  for (const type of ['movie', 'tv']) {
    const h = cpasmalHarness(null);
    h.setScrape(async () => { throw Object.assign(new Error('Cpasmal temporarily unavailable'), { code: 'CPASMAL_UPSTREAM_ERROR' }); });
    assert.equal((await h.call(type)).statusCode, 202);
    await settle();
    const failed = await h.call(type);
    assert.equal(failed.statusCode, 503);
    assert.equal(failed.body.error, 'Cpasmal temporarily unavailable');
    assert.equal((await h.call(type)).statusCode, 503);
    assert.equal(h.counts.scrapes, 1);
    assert.equal(h.counts.writes, 0);

    now += 60001;
    h.setScrape(async () => playableCpasmal);
    assert.equal((await h.call(type)).statusCode, 202);
    await settle();
    assert.equal((await h.call(type)).statusCode, 200);
    assert.equal(h.counts.scrapes, 2);
    assert.equal(h.counts.writes, 1);
  }
});

function animeHarness(fresh = false, cached = null, scanned = null) {
  const episodes = [{ name: 'Episode 1', index: 1, streaming_links: [{ language: 'vostfr', players: ['https://fixture.invalid/play'] }] }];
  let raw = JSON.stringify({ timestamp: now - 7200000, seasons: { 'Saison 1': { episodes: cached || episodes } } });
  let mtime = now - (fresh ? 1000 : 7200000);
  let fail = false;
  const counts = { catalogs: 0, scans: 0, writes: 0, touches: 0 };
  const loaded = loadRoute('API/Mainapi/routes/animeSama.js', {
    fs: { promises: { ...basicFs, readdir: async () => ['Example Anime.json'], readFile: async () => raw, stat: async () => ({ mtime: new Date(mtime) }), utimes: async (_path, _atime, checkedAt) => { counts.touches++; mtime = checkedAt.getTime(); } } },
    'write-file-atomic': async (_path, value) => { counts.writes++; raw = value; mtime = now; },
    '../utils/cacheManager': cacheStub, '../config/redis': { memoryCache: { set: async () => {} } },
  }, `module.exports.audit = { setScan(fn) { Season.prototype.episodes = fn; } };`);
  loaded.exports.configure({
    ANIME_SAMA_URL: 'https://anime-sama.invalid/',
    getFromCacheNoExpiration: async () => [{ name: 'Example Anime', url: 'https://anime-sama.invalid/catalogue/example/' }],
    axiosAnimeSamaRequest: async () => { counts.catalogs++; if (fail) throw new Error('timeout'); return { data: 'panneauAnime("Saison 1", "saison1/vostfr");' }; },
    cleanupOldCacheFiles: async () => {},
  });
  loaded.exports.audit.setScan(async () => { counts.scans++; return scanned || episodes; });
  const call = () => loaded.routes.get('get /search/:query')({ params: { query: 'example' }, query: {}, headers: {} }, response());
  return { counts, call, set fail(value) { fail = value; }, get data() { return JSON.parse(raw); }, get mtime() { return mtime; } };
}

test('AnimeSama: fresh caches skip seasons entirely under 20 simultaneous searches', async () => {
  const h = animeHarness(true);
  await Promise.all(Array.from({ length: 20 }, () => h.call())); await settle();
  assert.deepEqual(h.counts, { catalogs: 0, scans: 0, writes: 0, touches: 0 });
});

test('AnimeSama: expired unchanged catalogs are checked once and touch only the file freshness', async () => {
  const h = animeHarness(); const original = h.data;
  await Promise.all(Array.from({ length: 20 }, () => h.call())); await settle();
  await h.call(); await settle();
  assert.deepEqual(h.counts, { catalogs: 1, scans: 1, writes: 0, touches: 1 });
  assert.deepEqual(h.data, original);
  assert.equal(h.mtime, now);
});

test('AnimeSama: upstream failure retains usable data and retries only after backoff', async () => {
  const h = animeHarness(); const original = h.data; h.fail = true;
  await h.call(); await settle(); await h.call(); await settle();
  assert.equal(h.counts.catalogs, 1); assert.equal(h.counts.writes, 0);
  assert.deepEqual(h.data, original);
  now += 60001; h.fail = false;
  await h.call(); await settle();
  assert.equal(h.counts.catalogs, 2); assert.equal(h.counts.writes, 0);
  assert.equal(h.counts.touches, 1);
});

test('AnimeSama: removed players, languages and episodes leave the cache', async () => {
  const ep = (index, links) => ({ name: `Episode ${index}`, serie_name: 'example', season_name: 'Saison 1', index, streaming_links: links });
  const cached = [
    ep(1, [{ language: 'vostfr', players: ['https://a.invalid/1', 'https://b.invalid/1'] }, { language: 'vf', players: ['https://a.invalid/vf1'] }]),
    ep(2, [{ language: 'vostfr', players: ['https://a.invalid/2'] }]),
  ];
  const scanned = [ep(1, [{ language: 'vostfr', players: ['https://a.invalid/1'] }])];
  const h = animeHarness(false, cached, scanned);
  await h.call(); await settle();
  assert.equal(h.counts.writes, 1);
  assert.deepEqual(h.data.seasons['Saison 1'].episodes, scanned);
});

test('AnimeSama: older-format caches and empty languages do not force a rewrite', async () => {
  const links = [{ language: 'vostfr', players: ['https://a.invalid/1'] }];
  const cached = [{ name: 'Episode 1', index: 1, streaming_links: links, legacy: true }];
  const scanned = [{ name: 'Episode 1', serie_name: 'example', season_name: 'Saison 1', index: 1, streaming_links: [...links, { language: 'vf', players: [] }] }];
  const h = animeHarness(false, cached, scanned);
  await h.call(); await settle();
  assert.equal(h.counts.writes, 0);
  assert.equal(h.counts.touches, 1);
});

test('AnimeSama: an empty season scan keeps the cached episodes', async () => {
  const h = animeHarness(false, null, []); const original = h.data;
  await h.call(); await settle();
  assert.equal(h.counts.writes, 0);
  assert.deepEqual(h.data, original);
});

test('AnimeSama: unchanged worker cannot replace episodes published after its version check', async () => {
  const episode = { name: 'Episode 1', index: 1, streaming_links: [{ language: 'vostfr', players: ['https://fixture.invalid/play'] }] };
  const newerEpisode = { ...episode, name: 'Episode 2', index: 2 };
  let raw = JSON.stringify({ timestamp: now - 7200000, seasons: { 'Saison 1': { episodes: [episode] } } });
  let mtime = now - 7200000;
  const gate = deferred();
  let delayedCheck = false;
  const writes = [];
  const touches = [];
  function worker(name, episodes) {
    let stats = 0;
    const route = loadRoute('API/Mainapi/routes/animeSama.js', {
      fs: { promises: { ...basicFs, readdir: async () => ['Example Anime.json'], readFile: async () => raw,
        stat: async () => {
          stats++; const value = { mtime: new Date(mtime) };
          if (name === 'unchanged' && stats === 2) { delayedCheck = true; await gate.promise; }
          return value;
        },
        utimes: async (_path, _atime, checkedAt) => { touches.push(name); mtime = checkedAt.getTime(); },
      } },
      'write-file-atomic': async (_path, value) => { writes.push(name); raw = value; mtime = now; },
      '../utils/cacheManager': cacheStub, '../config/redis': { memoryCache: {} },
    }, 'module.exports.scan = fn => { Season.prototype.episodes = fn; };');
    route.exports.scan(async () => episodes);
    route.exports.configure({
      ANIME_SAMA_URL: 'https://anime-sama.invalid/',
      getFromCacheNoExpiration: async () => [{ name: 'Example Anime', url: 'https://anime-sama.invalid/catalogue/example/' }],
      axiosAnimeSamaRequest: async () => ({ data: 'panneauAnime("Saison 1", "saison1/vostfr");' }),
      cleanupOldCacheFiles: async () => {},
    });
    return () => route.routes.get('get /search/:query')({ params: { query: 'example' }, query: {}, headers: {} }, response());
  }
  await worker('unchanged', [episode])(); await settle(); assert(delayedCheck);
  await worker('changed', [episode, newerEpisode])(); await settle();
  const newerPayload = raw;
  gate.resolve(); await settle();
  assert.equal(raw, newerPayload);
  assert.equal(JSON.parse(raw).seasons['Saison 1'].episodes.length, 2);
  assert.deepEqual(writes, ['changed']);
  assert.deepEqual(touches, ['unchanged']);
});

test('Coflix: cold validation errors preserve HTTP 400 with the real enrichment helper', async () => {
  const extraction = fs.readFileSync(path.join(__dirname, '../../utils/embedExtraction.js'), 'utf8');
  const start = extraction.indexOf('async function respondWithResolvedSources(');
  const end = extraction.indexOf('\nmodule.exports', start);
  // Le vrai helper impose status=200 par défaut ; le stub ordinaire masquait ce contrat.
  const respond = vm.runInNewContext('(' + extraction.slice(start, end).trim() + ')');
  const route = loadRoute('API/Mainapi/routes/tmdb.js', {
    fs: { promises: basicFs }, '../utils/cacheManager': cacheStub,
    '../utils/tmdbCache': {}, '../utils/redisLock': {}, './coflix': { COFLIX_ENABLED: true },
    '../utils/cloneLinks': {}, '../utils/embedExtraction': { respondWithResolvedSources: respond },
  });
  route.exports.configure({ getFromCacheNoExpiration: async () => null, filterEmmmmbedReaders: value => value });
  for (const type of ['invalid', 'tv']) {
    const res = response();
    await route.routes.get('get /tmdb/:type/:id')({ params: { type, id: '42' }, query: {}, headers: {} }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, type === 'invalid' ? /Type de media/ : /saison\/episode/);
  }
});
