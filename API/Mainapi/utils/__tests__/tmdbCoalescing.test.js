'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createSingleFlight } = require('../singleFlight');
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

const source = fs.readFileSync(path.join(__dirname, '..', 'tmdbCache.js'), 'utf8');

function loadTmdbCache({ axios, redis }) {
  const module = { exports: {} };
  vm.compileFunction(source, ['require', 'module'], { filename: 'tmdbCache.js' })((request) => {
    if (request === 'axios') return axios;
    if (request === '../config/redis') return { redis };
    if (request === './singleFlight') return { createSingleFlight };
    if (request === './sourceRefreshTelemetry') return { refreshStep: () => {} };
    throw new Error(`Dépendance non simulée : ${request}`);
  }, module);
  return module.exports;
}

test('TMDB mutualise un miss identique puis revalide le cache dans la tâche partagée', async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const redisValues = new Map();
  const api = loadTmdbCache({
    axios: { get: async () => { calls++; await gate; return { data: { id: 7, name: 'Test' } }; } },
    redis: {
      status: 'ready',
      get: async (key) => redisValues.get(key) || null,
      mget: async (...keys) => keys.map((key) => redisValues.get(key) || null),
      set: async (key, value) => redisValues.set(key, value),
    },
  });

  const requests = Array.from({ length: 20 }, () => api.fetchTmdbDetails('https://tmdb.test', 'key', 7, 'tv'));
  await nextTurn();
  assert.equal(calls, 1, '20 misses simultanés ne doivent lancer qu’un transport');
  release();
  assert.deepEqual(await Promise.all(requests), Array(20).fill({ id: 7, name: 'Test' }));
  assert.equal(calls, 1);
  await api.fetchTmdbDetails('https://tmdb.test', 'key', 7, 'tv');
  assert.equal(calls, 1, 'le hit Redis évite un nouveau transport');
});

test('la relecture de la tâche partagée trouve la valeur écrite entre-temps par un autre worker', async () => {
  let calls = 0;
  const mgets = [];
  const api = loadTmdbCache({
    axios: { get: async () => { calls++; return { data: { id: 8 } }; } },
    redis: {
      status: 'ready',
      get: async () => null,
      mget: async (...keys) => { mgets.push(keys); return [JSON.stringify({ id: 8, name: 'Déjà là' }), null]; },
      set: async () => 'OK',
    },
  });
  assert.deepEqual(await api.fetchTmdbDetails('https://tmdb.test', 'key', 8, 'tv'), { id: 8, name: 'Déjà là' });
  assert.equal(calls, 0);
  assert.deepEqual(mgets, [['tmdb:details:tv:8:fr-FR', 'tmdb:transient:tmdb:details:tv:8:fr-FR', 'tmdb:missing:details:tv:8']],
    'valeur, marqueur d’échec et marqueur d’absence relus en un seul MGET');
});

test('l’annulation d’un appelant TMDB ne coupe pas le transport partagé', async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const api = loadTmdbCache({
    axios: { get: async () => { calls++; await gate; return { data: { id: 9 } }; } },
    redis: { status: 'end' },
  });
  const controller = new AbortController();
  const cancelled = api.fetchTmdbDetails('https://tmdb.test', 'key', 9, 'tv', 'fr-FR', { signal: controller.signal });
  const active = api.fetchTmdbDetails('https://tmdb.test', 'key', 9, 'tv');
  await Promise.resolve();
  controller.abort();
  assert.equal(await cancelled, null);
  assert.equal(calls, 1);
  release();
  assert.deepEqual(await active, { id: 9 });
});

test('un signal TMDB déjà annulé ne démarre aucun transport', async () => {
  let calls = 0;
  const controller = new AbortController();
  controller.abort();
  const api = loadTmdbCache({ axios: { get: async () => { calls++; return { data: {} }; } }, redis: { status: 'end' } });
  assert.equal(await api.fetchTmdbDetails('https://tmdb.test', 'key', 3, 'tv', 'fr-FR', { signal: controller.signal }), null);
  assert.equal(calls, 0);
});

test('une annulation pendant la lecture Redis ne démarre pas de transport', async () => {
  let release;
  let calls = 0;
  const controller = new AbortController();
  const api = loadTmdbCache({
    axios: { get: async () => { calls++; return { data: {} }; } },
    redis: { status: 'ready', get: async () => new Promise((resolve) => { release = resolve; }) },
  });
  const request = api.fetchTmdbDetails('https://tmdb.test', 'key', 4, 'tv', 'fr-FR', { signal: controller.signal });
  await nextTurn();
  controller.abort();
  release(null);
  assert.equal(await request, null);
  assert.equal(calls, 0);
});
