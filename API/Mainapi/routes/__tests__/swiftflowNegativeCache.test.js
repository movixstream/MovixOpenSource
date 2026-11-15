const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');

const routePath = path.join(__dirname, '..', 'swiftflow.js');
const routeSource = fs.readFileSync(routePath, 'utf8');
const HOUR = 60 * 60 * 1000;
const L1_TTL_MS = 300 * 1000;
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
};
const pending = (id) => ({ success: false, pending: true, tmdb_id: Number(id) });
const movieAbsent = (id) => ({ success: false, error: 'Film non disponible sur SwiftFlow', tmdb_id: id });
const seriesAbsent = (id) => ({ success: false, error: 'Série non disponible sur SwiftFlow', tmdb_id: id });

/** Charge la route avec un amont, un Redis et un cache disque simulés. */
function createFixture() {
  let now = 10 * HOUR;
  const upstream = new Map();
  const calls = [];

  // Redis simulé : TTL sur la même horloge que le cache disque.
  const redisStore = new Map();
  const redisReads = [];
  const redis = {
    status: 'ready',
    failing: false,
    check() { if (this.failing) throw new Error('Redis injoignable'); },
    live(key) {
      const entry = redisStore.get(key);
      if (entry && entry.expiresAt !== null && entry.expiresAt <= now) redisStore.delete(key);
      return redisStore.get(key) || null;
    },
    async get(key) { this.check(); redisReads.push(key); return this.live(key)?.value ?? null; },
    async set(key, value, mode, seconds) {
      this.check();
      redisStore.set(key, { value, ttlSeconds: mode === 'EX' ? seconds : null, expiresAt: mode === 'EX' ? now + seconds * 1000 : null });
      return 'OK';
    },
    async incr(key) {
      this.check();
      const value = Number(this.live(key)?.value || 0) + 1;
      redisStore.set(key, { value: String(value), ttlSeconds: null, expiresAt: null });
      return value;
    },
    async expire() { this.check(); return 1; },
  };

  // Cache disque (fichier + date) et copie L1 de 5 min, comme cacheManager.
  const files = new Map();
  const l1 = new Map();
  const cacheManager = {
    CACHE_DIR: { SWIFTFLOW: 'swiftflow-test-cache' },
    async getFromCacheNoExpiration(_dir, key) {
      const memory = l1.get(key);
      if (memory && memory.expiresAt > now) return memory.data;
      const file = files.get(key);
      if (!file) return null;
      l1.set(key, { data: file.data, expiresAt: now + L1_TTL_MS });
      return file.data;
    },
    async saveToCache(_dir, key, data) {
      files.set(key, { data, mtime: now });
      l1.set(key, { data, expiresAt: now + L1_TTL_MS });
      return true;
    },
    async touchCacheEntry(_dir, key) {
      const file = files.get(key);
      if (!file) return false;
      file.mtime = now;
      return true;
    },
    async shouldUpdateCache(_dir, key, ttl) {
      const file = files.get(key);
      return !file || now - file.mtime >= ttl;
    },
  };

  // axios simulé : applique validateStatus comme le vrai axios.
  const axios = {
    async get(url, options) {
      const route = new URL(url).searchParams.get('route');
      calls.push(route);
      const answer = upstream.get(route);
      assert.ok(answer, `Réponse amont non prévue : ${route}`);
      if (answer.error) throw answer.error;
      if (!options.validateStatus(answer.status)) {
        throw Object.assign(new Error(`Request failed with status code ${answer.status}`), {
          response: { status: answer.status, data: answer.data },
        });
      }
      return { status: answer.status, data: answer.data };
    },
  };

  const rateLimit = Object.assign(() => (_req, _res, next) => next(), { ipKeyGenerator: (ip) => ip });
  const modules = {
    express,
    axios,
    '../utils/cacheManager': cacheManager,
    '../config/redis': { redis },
    '../utils/embedExtraction': { respondWithResolvedSources: async (_req, res, body) => res.json(body) },
    '../utils/turnstile': { verifyTurnstile: async () => true, turnstileSecretFor: () => null },
    '../checkVip': { verifyAccessKey: async () => ({ vip: false }) },
    'express-rate-limit': rateLimit,
    '../utils/redisRateLimitStore': { createRedisRateLimitStore: () => ({}) },
  };

  const logs = [];
  const env = { base: process.env.SWIFTFLOW_BASE_URL, key: process.env.SWIFTFLOW_API_KEY, cdn: process.env.SWIFTFLOW_CDN_BASE_URL };
  process.env.SWIFTFLOW_BASE_URL = 'https://blinkflux.test';
  process.env.SWIFTFLOW_API_KEY = 'cle-test';
  delete process.env.SWIFTFLOW_CDN_BASE_URL;
  const routeModule = { exports: {} };
  try {
    vm.compileFunction(routeSource, ['require', 'module', 'console'], { filename: routePath })((request) => {
      assert.ok(Object.hasOwn(modules, request), `Dépendance non simulée : ${request}`);
      return modules[request];
    }, routeModule, { ...console, warn: (...args) => logs.push(args), error: (...args) => logs.push(args) });
  } finally {
    for (const [name, value] of [['SWIFTFLOW_BASE_URL', env.base], ['SWIFTFLOW_API_KEY', env.key], ['SWIFTFLOW_CDN_BASE_URL', env.cdn]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }

  const router = routeModule.exports;
  const handlerFor = (routePathName) => router.stack.find((layer) => layer.route?.path === routePathName).route.stack[0].handle;
  const invoke = async (handler, params, query = {}) => {
    const response = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    await handler({ params, query, headers: {} }, response);
    return response;
  };
  const movieHandler = handlerFor('/movie/:id');
  const tvHandler = handlerFor('/tv/:id/season/:season');

  return {
    router,
    redis,
    upstream,
    logs,
    redisReads,
    calls: (route) => calls.filter((value) => value === route).length,
    redisEntry: (key) => {
      const entry = redis.live(key);
      return entry ? { value: entry.value, ttlSeconds: entry.ttlSeconds } : null;
    },
    fileData: (key) => files.get(key)?.data ?? null,
    setL1: (key, data) => l1.set(key, { data, expiresAt: now + L1_TTL_MS }),
    /** Cache disque vidé (fichiers et copie L1), la clé Redis reste. */
    wipeDisk: () => { files.clear(); l1.clear(); },
    advance: (ms) => { now += ms; },
    movie: (id) => invoke(movieHandler, { id }),
    tv: (id, season, episode) => invoke(tvHandler, { id, season }, episode ? { episode } : {}),
  };
}

const absentPayload = { status: 404, data: { success: false, error: 'Movie not found' } };

test('la route exporte toujours le routeur Express seul', () => {
  const fixture = createFixture();
  assert.equal(typeof fixture.router, 'function');
  assert.equal(typeof fixture.router.stack, 'object');
});

test('film : un 404 JSON pose la clé négative et la visite suivante n’appelle plus l’amont', async () => {
  const fixture = createFixture();
  fixture.upstream.set('movies/42', absentPayload);

  assert.deepEqual((await fixture.movie('42')).body, pending('42'));
  await settle();
  assert.equal(fixture.calls('movies/42'), 1);
  assert.deepEqual(fixture.redisEntry('swiftflow:absent:movies/42'), { value: '1', ttlSeconds: 3600 });

  // Réponse inchangée : celle d'aujourd'hui après un 404.
  assert.deepEqual((await fixture.movie('42')).body, movieAbsent('42'));
  await settle();
  assert.equal(fixture.calls('movies/42'), 1);

  // Fichier disque perdu : la clé Redis suffit, aucun nouvel appel amont.
  fixture.wipeDisk();
  assert.deepEqual((await fixture.movie('42')).body, pending('42'));
  await settle();
  assert.equal(fixture.calls('movies/42'), 1);
  assert.deepEqual((await fixture.movie('42')).body, movieAbsent('42'));
  await settle();
  assert.equal(fixture.calls('movies/42'), 1);

  // Passé l'heure, le titre est revérifié une fois.
  fixture.advance(HOUR);
  assert.deepEqual((await fixture.movie('42')).body, movieAbsent('42'));
  await settle();
  assert.equal(fixture.calls('movies/42'), 2);
  assert.deepEqual(fixture.logs, []);
});

test('série : un 404 JSON pose la clé négative et la visite suivante n’appelle plus l’amont', async () => {
  const fixture = createFixture();
  fixture.upstream.set('series/7', { status: 404, data: { success: false } });

  assert.deepEqual((await fixture.tv('7', '1')).body, pending('7'));
  await settle();
  assert.equal(fixture.calls('series/7'), 1);
  assert.deepEqual(fixture.redisEntry('swiftflow:absent:series/7'), { value: '1', ttlSeconds: 3600 });
  assert.deepEqual((await fixture.tv('7', '1', '3')).body, seriesAbsent('7'));

  fixture.wipeDisk();
  await fixture.tv('7', '2');
  await settle();
  assert.deepEqual((await fixture.tv('7', '2')).body, seriesAbsent('7'));
  assert.equal(fixture.calls('series/7'), 1);
});

const transientFailures = [
  ['timeout', { error: Object.assign(new Error('timeout of 10000ms exceeded'), { code: 'ECONNABORTED' }) }],
  ['erreur réseau', { error: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) }],
  ['500', { status: 500, data: { success: false } }],
  ['502', { status: 502, data: '<html>Bad Gateway</html>' }],
  ['503', { status: 503, data: { success: false } }],
  ['403', { status: 403, data: { success: false, error: 'Forbidden' } }],
  ['429', { status: 429, data: { success: false, error: 'Too many requests' } }],
];

for (const [label, failure] of transientFailures) {
  test(`film : ${label} ne pose aucune clé négative et la visite suivante retente`, async () => {
    const fixture = createFixture();
    fixture.upstream.set('movies/42', failure);

    assert.deepEqual((await fixture.movie('42')).body, pending('42'));
    await settle();
    assert.equal(fixture.calls('movies/42'), 1);
    assert.equal(fixture.redisEntry('swiftflow:absent:movies/42'), null);
    assert.equal(fixture.fileData('movie-42'), null);

    assert.deepEqual((await fixture.movie('42')).body, pending('42'));
    await settle();
    assert.equal(fixture.calls('movies/42'), 2);
    assert.equal(fixture.redisEntry('swiftflow:absent:movies/42'), null);
  });
}

test('film : un 404 HTML (page nginx) garde le négatif disque d’avant, sans clé Redis', async () => {
  const fixture = createFixture();
  fixture.upstream.set('movies/42', { status: 404, data: '<html><body>404 Not Found</body></html>' });

  await fixture.movie('42');
  await settle();
  assert.equal(fixture.redisEntry('swiftflow:absent:movies/42'), null);
  assert.deepEqual((await fixture.movie('42')).body, movieAbsent('42'));

  // Sans preuve d'absence, un cache disque perdu relance bien l'amont.
  fixture.wipeDisk();
  await fixture.movie('42');
  await settle();
  assert.equal(fixture.calls('movies/42'), 2);
});

test('film : un succès reste servi comme avant et ne pose aucune clé négative', async () => {
  const fixture = createFixture();
  fixture.upstream.set('movies/42', {
    status: 200,
    data: { success: true, data: { title: 'Film test', year: 2024, sources: [{ language: 'VF', quality: '1080p', size: '2 GB', url: 'https://cdn.test/film.mp4' }] } },
  });

  assert.deepEqual((await fixture.movie('42')).body, pending('42'));
  await settle();
  const body = (await fixture.movie('42')).body;
  assert.equal(body.success, true);
  assert.equal(body.title, 'Film test');
  assert.match(body.players.vf[0].url, /route=movies\/42\/player&api_key=cle-test$/);
  assert.deepEqual(body.mp4, { available: true, entries: [{ index: 0, label: '1080p · 2 GB', quality: '1080p', size: '2 GB', language: 'VF' }] });
  await settle();
  assert.equal(fixture.calls('movies/42'), 1);
  assert.equal(fixture.redisEntry('swiftflow:absent:movies/42'), null);
});

test('Redis en panne : le 404 retombe sur le négatif disque, sans erreur', async () => {
  const fixture = createFixture();
  fixture.redis.failing = true;
  fixture.upstream.set('movies/42', absentPayload);

  assert.deepEqual((await fixture.movie('42')).body, pending('42'));
  await settle();
  assert.equal(fixture.calls('movies/42'), 1);
  assert.deepEqual((await fixture.movie('42')).body, movieAbsent('42'));
  await settle();
  assert.equal(fixture.calls('movies/42'), 1);
  assert.deepEqual(fixture.logs, []);

  // Comportement d'avant : sans fichier ni Redis, la visite relance l'amont.
  fixture.wipeDisk();
  await fixture.movie('42');
  await settle();
  assert.equal(fixture.calls('movies/42'), 2);
});

test('Redis en reconnexion : la clé négative n’est ni lue ni écrite', async () => {
  const fixture = createFixture();
  fixture.redis.status = 'reconnecting';
  fixture.upstream.set('movies/42', absentPayload);

  await fixture.movie('42');
  await settle();
  assert.equal(fixture.calls('movies/42'), 1);
  assert.deepEqual(fixture.redisReads.filter((key) => key.startsWith('swiftflow:absent:')), []);
  assert.equal(fixture.redisEntry('swiftflow:absent:movies/42'), null);
  assert.deepEqual((await fixture.movie('42')).body, movieAbsent('42'));
});

test('fichier disparu avec la copie L1 vivante : un échec amont réécrit l’entrée au lieu de retenter à chaque visite', async () => {
  const fixture = createFixture();
  const cached = {
    kind: 'movie',
    notFound: false,
    data: { title: 'Film test', year: 2024, sources: [{ language: 'VF', quality: '1080p', size: '2 GB', url: 'https://cdn.test/film.mp4' }] },
    _ts: 123,
  };
  fixture.setL1('movie-42', cached);
  fixture.upstream.set('movies/42', { status: 503, data: { success: false } });

  assert.equal((await fixture.movie('42')).body.success, true);
  await settle();
  assert.equal(fixture.calls('movies/42'), 1);
  assert.deepEqual(fixture.fileData('movie-42'), cached);

  assert.equal((await fixture.movie('42')).body.success, true);
  await settle();
  assert.equal(fixture.calls('movies/42'), 1);
});
