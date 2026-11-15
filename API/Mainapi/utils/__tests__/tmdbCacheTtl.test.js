'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createSingleFlight } = require('../singleFlight');

const source = fs.readFileSync(path.join(__dirname, '..', 'tmdbCache.js'), 'utf8');
const DAY = 24 * 60 * 60;
const API = 'https://tmdb.test';

function fakeRedis() {
  const values = new Map();
  return {
    status: 'ready', values, writes: [],
    async get(key) { return values.get(key) ?? null; },
    async mget(...keys) { return keys.map(key => values.get(key) ?? null); },
    async set(key, value, mode, amount) {
      this.writes.push([key, value, mode, amount]);
      values.set(key, value);
      return 'OK';
    },
  };
}

// Débit très large : la porte n'intervient pas dans ces tests.
function loadTmdbCache({ axios, redis }) {
  const module = { exports: {} };
  const fakeProcess = { ...process, env: { ...process.env, TMDB_RATE_PER_WORKER: '100000' } };
  vm.compileFunction(source, ['require', 'module', 'process'], { filename: 'tmdbCache.js' })((request) => {
    if (request === 'axios') return axios;
    if (request === '../config/redis') return { redis };
    if (request === './singleFlight') return { createSingleFlight };
    if (request === './sourceRefreshTelemetry') return { refreshStep: () => {} };
    throw new Error(`Dépendance non simulée : ${request}`);
  }, module, fakeProcess);
  return module.exports;
}

const ttlOf = (redis, key) => redis.writes.find(([written]) => written === key)?.[3];
const assertAround = (actual, expected, ratio, label) => {
  assert.ok(actual >= Math.floor(expected * (1 - ratio)) && actual <= Math.ceil(expected * (1 + ratio)),
    `${label} : ${actual} s hors de ${expected} s ± ${ratio * 100} %`);
};
const daysAgo = days => new Date(Date.now() - days * DAY * 1000).toISOString().slice(0, 10);

test('les détails ramènent les titres alternatifs dans le même appel et gardent leur format', async () => {
  const redis = fakeRedis();
  const calls = [];
  const payloads = {
    '/movie/550': { id: 550, title: 'Fight Club', release_date: '1999-10-15',
      alternative_titles: { titles: [{ iso_3166_1: 'FR', title: 'Le Club' }] } },
    '/tv/1399': { id: 1399, name: 'Game of Thrones', first_air_date: '2011-04-17',
      alternative_titles: { results: [{ iso_3166_1: 'FR', title: 'Le Trône de fer' }] } },
  };
  const api = loadTmdbCache({ redis, axios: { get: async (url, options) => {
    calls.push([url, options]);
    return { data: payloads[url.slice(API.length)] };
  } } });

  const movie = await api.fetchTmdbDetails(API, 'key', 550, 'movie', 'fr-FR');
  assert.deepEqual(calls[0], [`${API}/movie/550`, {
    params: { api_key: 'key', language: 'fr-FR', append_to_response: 'alternative_titles' }, timeout: 10000,
  }]);
  assert.deepEqual(movie, { id: 550, title: 'Fight Club', release_date: '1999-10-15' });
  assert.deepEqual(JSON.parse(redis.values.get('tmdb:details:movie:550:fr-FR')), movie,
    'wrappedRoutes lit tmdb:details par MGET : format inchangé');
  assert.deepEqual(JSON.parse(redis.values.get('tmdb:alternative_titles:movie:550')),
    { id: 550, titles: [{ iso_3166_1: 'FR', title: 'Le Club' }] });
  assertAround(ttlOf(redis, 'tmdb:alternative_titles:movie:550'), 30 * DAY, 0.15, 'titres alternatifs joints');

  const tv = await api.fetchTmdbDetails(API, 'key', 1399, 'tv', 'en-US');
  assert.equal('alternative_titles' in tv, false);
  assert.deepEqual(JSON.parse(redis.values.get('tmdb:alternative_titles:tv:1399')),
    { id: 1399, results: [{ iso_3166_1: 'FR', title: 'Le Trône de fer' }] });

  // Les lecteurs habituels trouvent la clé sans nouvel appel TMDB.
  assert.deepEqual((await api.fetchTmdbAlternativeTitles(API, 'key', 550, 'movie')).titles[0].title, 'Le Club');
  assert.deepEqual((await api.fetchTmdbAlternativeTitles(API, 'key', 1399)).results[0].title, 'Le Trône de fer');
  assert.equal(calls.length, 2);
});

test('durées de vie : 7 j pour un titre ancien, 24 h pour un récent ou en diffusion, 30 j pour les petites données', async () => {
  const redis = fakeRedis();
  const details = {
    '/movie/1': { id: 1, title: 'Ancien', release_date: '2010-07-15' },
    '/movie/2': { id: 2, title: 'Récent', release_date: daysAgo(10) },
    '/movie/3': { id: 3, title: 'Sans date', release_date: '' },
    '/tv/4': { id: 4, name: 'En cours', first_air_date: '2005-01-01', last_air_date: daysAgo(200), in_production: true },
    '/tv/5': { id: 5, name: 'Terminée', first_air_date: '2005-01-01', last_air_date: '2015-05-01', in_production: false },
    '/tv/6': { id: 6, name: 'Épisode récent', first_air_date: '2005-01-01', last_air_date: daysAgo(20), in_production: false },
  };
  const api = loadTmdbCache({ redis, axios: { get: async (url) => ({ data: details[url.slice(API.length)] || { id: 9, results: [] } }) } });

  for (const [type, id] of [['movie', 1], ['movie', 2], ['movie', 3], ['tv', 4], ['tv', 5], ['tv', 6]]) {
    await api.fetchTmdbDetails(API, 'key', id, type, 'fr-FR');
  }
  assertAround(ttlOf(redis, 'tmdb:details:movie:1:fr-FR'), 7 * DAY, 0.1, 'film ancien');
  assertAround(ttlOf(redis, 'tmdb:details:movie:2:fr-FR'), DAY, 0.1, 'film récent');
  assertAround(ttlOf(redis, 'tmdb:details:movie:3:fr-FR'), DAY, 0.1, 'film sans date');
  assertAround(ttlOf(redis, 'tmdb:details:tv:4:fr-FR'), DAY, 0.1, 'série en production');
  assertAround(ttlOf(redis, 'tmdb:details:tv:5:fr-FR'), 7 * DAY, 0.1, 'série terminée');
  assertAround(ttlOf(redis, 'tmdb:details:tv:6:fr-FR'), DAY, 0.1, 'série au dernier épisode récent');

  await api.fetchTmdbAlternativeTitles(API, 'key', 7, 'movie');
  await api.fetchTmdbCredits(API, 'key', 7, 'movie');
  await api.fetchTmdbCredits(API, 'key', 7, 'tv');
  await api.fetchTmdbFrenchReleaseYear(API, 'key', 7);
  await api.fetchTmdbImages(API, 'key', 7, 'movie');
  await api.fetchTmdbSeason(API, 'key', 7, 1);
  await api.searchTmdb(API, 'key', 'movie', 'Kraken', { primary_release_year: 2026 });
  assertAround(ttlOf(redis, 'tmdb:alternative_titles:movie:7'), 30 * DAY, 0.15, 'titres alternatifs');
  assertAround(ttlOf(redis, 'tmdb:credits:movie:7'), 30 * DAY, 0.15, 'crédits');
  assertAround(ttlOf(redis, 'tmdb:aggregate_credits:tv:7'), 30 * DAY, 0.15, 'crédits agrégés');
  assertAround(ttlOf(redis, 'tmdb:release_dates:movie:7'), 30 * DAY, 0.15, 'dates de sortie');
  assertAround(ttlOf(redis, 'tmdb:images:movie:7'), DAY, 0.1, 'images');
  assertAround(ttlOf(redis, 'tmdb:season:7:1:fr-FR'), DAY, 0.1, 'saison');
  assertAround(ttlOf(redis, 'tmdb:search:movie:Kraken:primary_release_year=2026:fr-FR'), 12 * 60 * 60, 0.1, 'recherche');
});

test('le jitter étale les expirations des clés écrites au même moment', async () => {
  const redis = fakeRedis();
  const api = loadTmdbCache({ redis, axios: { get: async () => ({ data: { id: 1, titles: [] } }) } });
  for (let id = 1; id <= 20; id++) await api.fetchTmdbAlternativeTitles(API, 'key', id, 'movie');
  const ttls = redis.writes.map(([, , , ttl]) => ttl);
  assert.equal(ttls.length, 20);
  assert.ok(new Set(ttls).size > 10, 'des TTL différents pour des clés écrites ensemble');
});
