'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

// services/mediaSegments/identifiers.js : TMDB id → IMDb, mis en cache 30 j (trouvé) ou 6 h (absent).
const identifiersPath = path.resolve(__dirname, '../../services/mediaSegments/identifiers.js');

function loadIdentifiers(respond) {
  const axiosCalls = [];
  const cacheWrites = [];
  const store = new Map();
  const memoryCache = {
    async get(key) { return store.has(key) ? store.get(key) : undefined; },
    async set(key, value, ttl) { cacheWrites.push([key, value, ttl]); store.set(key, value); },
  };
  const axiosDouble = { async get(url) { axiosCalls.push(url); return respond(url); } };
  const originalLoad = Module._load;
  delete require.cache[identifiersPath];
  Module._load = function load(request, parent, isMain) {
    if (parent?.filename === identifiersPath && request === 'axios') return axiosDouble;
    if (parent?.filename === identifiersPath && request === '../../config/redis') return { memoryCache };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return { ...require(identifiersPath), axiosCalls, cacheWrites };
  } finally {
    Module._load = originalLoad;
    delete require.cache[identifiersPath];
  }
}

const httpError = status => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status } });
const timeoutError = () => Object.assign(new Error('timeout of 6000ms exceeded'), { code: 'ECONNABORTED' });

test.beforeEach(() => { process.env.TMDB_API_KEY = 'test-key'; });

test('un identifiant IMDb trouvé est gardé 30 jours', async () => {
  const api = loadIdentifiers(async () => ({ data: { imdb_id: 'tt1375666' } }));
  assert.equal(await api.resolveImdbId('movie', 27205), 'tt1375666');
  assert.deepEqual(api.cacheWrites, [['segments:v3:imdb:movie:27205', 'tt1375666', 30 * 24 * 3600]]);
});

test('un vrai absent (404 ou imdb_id vide) est mémorisé 6 heures', async () => {
  for (const respond of [async () => { throw httpError(404); }, async () => ({ data: { imdb_id: '' } })]) {
    const api = loadIdentifiers(respond);
    assert.equal(await api.resolveImdbId('tv', 1399), null);
    assert.deepEqual(api.cacheWrites, [['segments:v3:imdb:tv:1399', null, 6 * 3600]]);
  }
});

test('un 429, un 5xx ou un délai dépassé ne sont pas mis en cache et la lecture suivante réessaie', async () => {
  for (const failure of [() => httpError(429), () => httpError(503), timeoutError]) {
    let attempts = 0;
    const api = loadIdentifiers(async () => {
      attempts++;
      if (attempts === 1) throw failure();
      return { data: { imdb_id: 'tt0944947' } };
    });
    assert.equal(await api.resolveImdbId('tv', 1399), null);
    assert.deepEqual(api.cacheWrites, [], 'aucun négatif de 6 h après un échec temporaire');
    assert.equal(await api.resolveImdbId('tv', 1399), 'tt0944947');
    assert.equal(api.axiosCalls.length, 2);
  }
});
