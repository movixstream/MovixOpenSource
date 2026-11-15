'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../tvmazeNumbering.js');

// Module chargé avec un faux axios, un faux Redis et un faux TMDB → IMDb.
function load(respond, imdbId = 'tt2531336') {
  const calls = [];
  const writes = [];
  const store = new Map();
  const memoryCache = {
    async get(key) { return store.has(key) ? store.get(key) : undefined; },
    async set(key, value, ttl) { writes.push([key, value, ttl]); store.set(key, value); },
  };
  const axiosDouble = { async get(url, options) { calls.push([url, options?.params]); return respond(url); } };
  const originalLoad = Module._load;
  delete require.cache[modulePath];
  Module._load = function stub(request, parent, isMain) {
    if (parent?.filename === modulePath && request === 'axios') return axiosDouble;
    if (parent?.filename === modulePath && request === '../config/redis') return { memoryCache };
    if (parent?.filename === modulePath && request === '../services/mediaSegments/identifiers') {
      return { resolveImdbId: async () => imdbId };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return { ...require(modulePath), calls, writes };
  } finally {
    Module._load = originalLoad;
    delete require.cache[modulePath];
  }
}

const { tmdbSeasonCounts, mapTmdbSeasonToTvmaze, sourceFollowsTvmaze } = load(async () => ({ data: null }));
const httpError = status => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status } });
const episodes = counts => Object.entries(counts).flatMap(([season, count]) =>
  Array.from({ length: count }, (_, index) => ({ season: Number(season), number: index + 1 })));

// Lupin : 3 saisons TMDB, 4 parties chez TVmaze (et chez FStream).
const TMDB = { 1: 10, 2: 7, 3: 8 };
const TVMAZE = { 1: 5, 2: 5, 3: 7, 4: 8 };

test('les saisons TMDB sont lues sans les épisodes spéciaux', () => {
  assert.deepEqual(tmdbSeasonCounts({ seasons: [
    { season_number: 0, episode_count: 3 }, { season_number: 1, episode_count: 10 },
    { season_number: 2, episode_count: 0 }, { season_number: 3, episode_count: 8 },
  ] }), { 1: 10, 3: 8 });
  assert.deepEqual(tmdbSeasonCounts(null), {});
});

test('Lupin : chaque saison TMDB retrouve ses épisodes TVmaze par leur place dans la série', () => {
  const s1 = mapTmdbSeasonToTvmaze(TMDB, TVMAZE, 1);
  assert.equal(s1.length, 10);
  assert.deepEqual(s1[4], { season: 1, episode: 5 });
  assert.deepEqual(s1[5], { season: 2, episode: 1 });
  assert.deepEqual(s1[9], { season: 2, episode: 5 });
  assert.deepEqual(mapTmdbSeasonToTvmaze(TMDB, TVMAZE, 2), Array.from({ length: 7 }, (_, i) => ({ season: 3, episode: i + 1 })));
  assert.deepEqual(mapTmdbSeasonToTvmaze(TMDB, TVMAZE, 3), Array.from({ length: 8 }, (_, i) => ({ season: 4, episode: i + 1 })));
});

test('pas de conversion si le découpage est le même ou si les totaux diffèrent', () => {
  assert.equal(mapTmdbSeasonToTvmaze({ 1: 10, 2: 8 }, { 1: 10, 2: 8 }, 2), null);
  // Une saison TVmaze annoncée en plus : découpage douteux.
  assert.equal(mapTmdbSeasonToTvmaze(TMDB, { ...TVMAZE, 5: 1 }, 1), null);
  assert.equal(mapTmdbSeasonToTvmaze(TMDB, { 1: 5, 2: 5, 3: 7, 4: 7 }, 1), null);
  // Saison inconnue de TMDB.
  assert.equal(mapTmdbSeasonToTvmaze(TMDB, TVMAZE, 4), null);
  // Même saison 1 partout : seule la saison 2 change.
  assert.equal(mapTmdbSeasonToTvmaze({ 1: 5, 2: 10 }, { 1: 5, 2: 5, 3: 5 }, 1), null);
  assert.equal(mapTmdbSeasonToTvmaze({ 1: 5, 2: 10 }, { 1: 5, 2: 5, 3: 5 }, 2).length, 10);
});

test('la source suit TVmaze seulement si sa saison compte comme TVmaze et pas comme TMDB', () => {
  assert.equal(sourceFollowsTvmaze(5, TMDB, TVMAZE, 1), true);
  assert.equal(sourceFollowsTvmaze(7, TMDB, TVMAZE, 3), true);
  // Comme TMDB, ou une saison en cours de mise en ligne.
  assert.equal(sourceFollowsTvmaze(10, TMDB, TVMAZE, 1), false);
  assert.equal(sourceFollowsTvmaze(3, TMDB, TVMAZE, 1), false);
  // Même nombre des deux côtés : rien ne permet de trancher.
  assert.equal(sourceFollowsTvmaze(5, { 1: 5, 2: 10 }, { 1: 5, 2: 5, 3: 5 }, 1), false);
  assert.equal(sourceFollowsTvmaze(5, TMDB, null, 1), false);
});

test('TVmaze : les épisodes sont comptés par saison et gardés 12 h', async () => {
  const api = load(async url => url.endsWith('/lookup/shows')
    ? { data: { id: 50701, externals: { imdb: 'tt2531336' } } }
    : { data: [...episodes(TVMAZE), { season: 0, number: 1 }, { season: 2, number: null }] });
  assert.deepEqual(await api.fetchTvmazeSeasonCounts('96677'), TVMAZE);
  assert.deepEqual(api.calls, [
    ['https://api.tvmaze.com/lookup/shows', { imdb: 'tt2531336' }],
    ['https://api.tvmaze.com/shows/50701/episodes', undefined],
  ]);
  assert.deepEqual(api.writes, [['tvmaze:season-counts:v1:96677', TVMAZE, 12 * 3600]]);
  // Deuxième lecture : Redis seulement.
  assert.deepEqual(await api.fetchTvmazeSeasonCounts('96677'), TVMAZE);
  assert.equal(api.calls.length, 2);
});

test('une série absente de TVmaze ou mal reliée est mémorisée 6 h', async () => {
  for (const respond of [
    async () => { throw httpError(404); },
    async () => ({ data: { id: 1, externals: { imdb: 'tt0000001' } } }),
  ]) {
    const api = load(respond);
    assert.equal(await api.fetchTvmazeSeasonCounts('96677'), null);
    assert.deepEqual(api.writes, [['tvmaze:season-counts:v1:96677', null, 6 * 3600]]);
  }
});

test('une panne TVmaze ou un IMDb introuvable ne sont pas mis en cache', async () => {
  let attempts = 0;
  const api = load(async url => {
    attempts++;
    if (attempts === 1) throw httpError(429);
    return url.endsWith('/lookup/shows') ? { data: { id: 50701, externals: { imdb: 'tt2531336' } } } : { data: episodes(TVMAZE) };
  });
  assert.equal(await api.fetchTvmazeSeasonCounts('96677'), null);
  assert.deepEqual(api.writes, []);
  assert.deepEqual(await api.fetchTvmazeSeasonCounts('96677'), TVMAZE);

  const withoutImdb = load(async () => ({ data: null }), null);
  assert.equal(await withoutImdb.fetchTvmazeSeasonCounts('96677'), null);
  assert.deepEqual(withoutImdb.calls, []);
  assert.deepEqual(withoutImdb.writes, []);
});

test('des lectures simultanées partagent un seul appel TVmaze', async () => {
  const api = load(async url => url.endsWith('/lookup/shows')
    ? { data: { id: 50701, externals: { imdb: 'tt2531336' } } }
    : { data: episodes(TVMAZE) });
  const results = await Promise.all(Array.from({ length: 5 }, () => api.fetchTvmazeSeasonCounts('96677')));
  assert.ok(results.every(result => result === results[0]));
  assert.equal(api.calls.length, 2);
});
