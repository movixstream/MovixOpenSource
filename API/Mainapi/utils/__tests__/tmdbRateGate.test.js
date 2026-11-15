'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createSingleFlight } = require('../singleFlight');

const source = fs.readFileSync(path.join(__dirname, '..', 'tmdbCache.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 30; i++) await new Promise(resolve => setImmediate(resolve)); };

// Horloge simulée : Date.now() et setTimeout du module n'avancent qu'avec advance().
function fakeClock(start = Date.parse('2026-10-19T09:52:00Z')) {
  const timers = [];
  const clock = {
    now: start,
    Date: class extends Date { static now() { return clock.now; } },
    setTimeout(fn, ms = 0) {
      const timer = { at: clock.now + Math.max(0, ms), fn };
      timers.push(timer);
      timers.sort((a, b) => a.at - b.at);
      return timer;
    },
    async advance(ms) {
      const target = clock.now + ms;
      for (;;) {
        await flush();
        if (!timers.length || timers[0].at > target) break;
        const timer = timers.shift();
        clock.now = timer.at;
        timer.fn();
      }
      clock.now = target;
      await flush();
    },
  };
  return clock;
}

// Redis commun à plusieurs workers, avec expiration PX/EX sur l'horloge simulée.
function fakeRedis(clock) {
  const values = new Map();
  const live = (key) => {
    const entry = values.get(key);
    if (!entry) return null;
    if (entry.expiresAt != null && entry.expiresAt <= clock.now) { values.delete(key); return null; }
    return entry.value;
  };
  return {
    status: 'ready', writes: [],
    async get(key) { return live(key); },
    async mget(...keys) { return keys.map(live); },
    async set(key, value, mode, amount) {
      this.writes.push([key, value, mode, amount]);
      const ms = mode === 'PX' ? amount : mode === 'EX' ? amount * 1000 : null;
      values.set(key, { value, expiresAt: ms == null ? null : clock.now + ms });
      return 'OK';
    },
  };
}

function loadTmdbCache({ axios, redis = { status: 'end' }, clock, env = {}, proxyManager = null }) {
  const module = { exports: {} };
  const fakeProcess = { ...process, env: { ...process.env, TMDB_RATE_PER_WORKER: '', ...env } };
  vm.compileFunction(source, ['require', 'module', 'process', 'Date', 'setTimeout'], { filename: 'tmdbCache.js' })((request) => {
    if (request === 'axios') return axios;
    if (request === '../config/redis') return { redis };
    if (request === './singleFlight') return { createSingleFlight };
    if (request === './sourceRefreshTelemetry') return { refreshStep: () => {} };
    if (request === './proxyManager' && proxyManager) return proxyManager;
    throw new Error(`Dépendance non simulée : ${request}`);
  }, module, fakeProcess, clock.Date, clock.setTimeout);
  return module.exports;
}

const httpError = (status, headers = {}) => Object.assign(new Error(`Request failed with status code ${status}`),
  { isAxiosError: true, response: { status, headers } });
const timeoutError = () => Object.assign(new Error('timeout of 10000ms exceeded'), { isAxiosError: true, code: 'ECONNABORTED' });
const okAxios = (calls) => ({ get: async (url) => { calls.push(url); return { data: { url } }; } });
const images = (api, id, options) => api.fetchTmdbImages('https://tmdb.test', 'key', id, 'movie', options);
const strict = { strict: true };
const settle = promises => Promise.allSettled(promises);
const fulfilled = results => results.filter(result => result.status === 'fulfilled').length;
const transientReasons = results => results.filter(result => result.status === 'rejected')
  .map(result => [result.reason.code, result.reason.reason]);

async function admittedWithin(api, clock, calls, ids) {
  const before = calls.length;
  const pending = settle(ids.map(id => images(api, id, strict)));
  await clock.advance(1500);
  const results = await pending;
  assert.equal(calls.length - before, fulfilled(results), 'un refus de la porte ne fait aucun appel réseau');
  return { admitted: fulfilled(results), results };
}

test('la porte TMDB laisse passer une petite rafale puis 7 requêtes/s, et refuse sans réseau au-delà de 1,5 s d’attente', async () => {
  const clock = fakeClock();
  const calls = [];
  const api = loadTmdbCache({ axios: okAxios(calls), clock });
  const pending = settle(Array.from({ length: 20 }, (_, i) => images(api, i + 1, strict)));
  await flush();
  assert.equal(calls.length, 3, 'rafale de 3 appels immédiats');
  await clock.advance(1500);
  const results = await pending;
  assert.equal(calls.length, 13, '3 immédiats puis 10 en 1,5 s à 7/s');
  assert.equal(fulfilled(results), 13);
  assert.deepEqual(transientReasons(results), Array(7).fill(['TMDB_TRANSIENT', 'gate']));

  // Sans strict, le refus reste un simple null.
  const loosePending = Promise.all(Array.from({ length: 20 }, (_, i) => images(api, 100 + i)));
  await clock.advance(1500);
  const loose = await loosePending;
  assert.equal(loose.filter(value => value === null).length > 0, true);
});

test('TMDB_RATE_PER_WORKER règle le débit local', async () => {
  const clock = fakeClock();
  const calls = [];
  const api = loadTmdbCache({ axios: okAxios(calls), clock, env: { TMDB_RATE_PER_WORKER: '2' } });
  const { admitted } = await admittedWithin(api, clock, calls, Array.from({ length: 20 }, (_, i) => i + 1));
  assert.equal(admitted, 6, '3 immédiats puis 3 en 1,5 s à 2/s');
});

test('un 429 sans Retry-After baisse le débit local de 20 % puis il remonte lentement', async () => {
  const ids = Array.from({ length: 20 }, (_, i) => i + 1);
  const control = fakeClock();
  const controlCalls = [];
  const controlApi = loadTmdbCache({ axios: okAxios(controlCalls), clock: control });
  await images(controlApi, 0);
  assert.equal((await admittedWithin(controlApi, control, controlCalls, ids)).admitted, 12);

  const clock = fakeClock();
  const calls = [];
  let first = true;
  const api = loadTmdbCache({ clock, axios: { get: async (url) => {
    calls.push(url);
    if (first) { first = false; throw httpError(429); }
    return { data: { url } };
  } } });
  await assert.rejects(images(api, 0, strict), { code: 'TMDB_TRANSIENT', reason: 'rate_limited', status: 429 });
  assert.equal((await admittedWithin(api, clock, calls, ids)).admitted, 10, '5,6/s au lieu de 7/s');

  // +0,5/s par seconde : après quelques secondes, retour à 7/s (3 immédiats + 10).
  await clock.advance(4000);
  assert.equal((await admittedWithin(api, clock, calls, ids.map(id => id + 100))).admitted, 13);
});

test('un 429 avec Retry-After met la porte en pause, plafonnée à 10 s, sans appel réseau', async () => {
  const clock = fakeClock();
  const calls = [];
  let first = true;
  const api = loadTmdbCache({ clock, axios: { get: async (url) => {
    calls.push(url);
    if (first) { first = false; throw httpError(429, { 'retry-after': '60' }); }
    return { data: { url } };
  } } });
  await assert.rejects(images(api, 1, strict), { code: 'TMDB_TRANSIENT', reason: 'rate_limited' });
  await assert.rejects(images(api, 2, strict), { code: 'TMDB_TRANSIENT', reason: 'gate' });
  assert.equal(await images(api, 3), null);
  await clock.advance(8000);
  await assert.rejects(images(api, 4, strict), { reason: 'gate' }, 'pause de 10 s : il reste 2 s');
  assert.equal(calls.length, 1);
  await clock.advance(2000);
  const resumed = images(api, 5);
  await clock.advance(200);
  assert.deepEqual(await resumed, { url: 'https://tmdb.test/movie/5/images' });
  assert.equal(calls.length, 2);
});

test('un Retry-After court fait attendre l’appel au lieu de le refuser', async () => {
  const clock = fakeClock();
  const calls = [];
  let first = true;
  const api = loadTmdbCache({ clock, axios: { get: async (url) => {
    calls.push(url);
    if (first) { first = false; throw httpError(429, { 'retry-after': '1' }); }
    return { data: { url } };
  } } });
  assert.equal(await images(api, 1), null);
  const waiting = images(api, 2);
  await clock.advance(999);
  assert.equal(calls.length, 1);
  await clock.advance(10);
  assert.deepEqual(await waiting, { url: 'https://tmdb.test/movie/2/images' });
  assert.equal(calls.length, 2);
});

test('une horloge système qui recule ne bloque pas la porte pendant la durée du recul', async () => {
  const clock = fakeClock();
  const calls = [];
  let first = true;
  const api = loadTmdbCache({ clock, axios: { get: async (url) => {
    calls.push(url);
    if (first) { first = false; throw httpError(429, { 'retry-after': '10' }); }
    return { data: { url } };
  } } });
  await assert.rejects(images(api, 1, strict), { code: 'TMDB_TRANSIENT', reason: 'rate_limited' });
  // Recul d'une heure (NTP, reprise de VM) : la pause de 10 s reste la seule attente.
  clock.now -= 60 * 60 * 1000;
  await assert.rejects(images(api, 2, strict), { code: 'TMDB_TRANSIENT', reason: 'gate' });
  await clock.advance(10_000);
  const resumed = images(api, 3, strict);
  await clock.advance(200);
  assert.deepEqual(await resumed, { url: 'https://tmdb.test/movie/3/images' });
  assert.equal(calls.length, 2);
});

test('un 429, un 5xx ou un délai dépassé posent un marqueur de 5 s respecté par les autres workers', async () => {
  for (const [id, failure] of [[5, () => httpError(429)], [6, () => httpError(503)], [7, timeoutError]]) {
    const clock = fakeClock();
    const redis = fakeRedis(clock);
    const workerA = loadTmdbCache({ clock, redis, axios: { get: async () => { throw failure(); } } });
    const callsB = [];
    const workerB = loadTmdbCache({ clock, redis, axios: okAxios(callsB) });

    await assert.rejects(images(workerA, id, strict), { code: 'TMDB_TRANSIENT' });
    assert.deepEqual(redis.writes, [[`tmdb:transient:tmdb:images:movie:${id}`, '1', 'PX', 5000]]);
    assert.equal(await images(workerB, id), null);
    await assert.rejects(images(workerB, id, strict), { code: 'TMDB_TRANSIENT', reason: 'marker' });
    assert.equal(callsB.length, 0, 'la clé marquée n’est pas redemandée');

    await clock.advance(5000);
    assert.deepEqual(await images(workerB, id), { url: `https://tmdb.test/movie/${id}/images` });
    assert.equal(callsB.length, 1);
  }
});

test('le mode strict sépare l’absent (404) du temporaire ; sans strict, tout échec reste null', async () => {
  const clock = fakeClock();
  const redis = fakeRedis(clock);
  const failures = { 404: httpError(404), 500: httpError(500), 401: httpError(401) };
  const api = loadTmdbCache({ clock, redis, axios: { get: async (url) => {
    throw failures[(url.match(/\/(\d+)(?:\/|$)/) || [])[1]] || timeoutError();
  } } });
  // Chaque appel laisse passer 1 s simulée : la porte n'intervient pas ici.
  const later = (promise) => {
    promise.catch(() => {});
    return clock.advance(1000).then(() => promise);
  };

  assert.equal(await later(images(api, 404, strict)), null, 'un vrai absent reste null');
  assert.equal(await later(images(api, 401, strict)), null, 'un refus définitif n’est pas temporaire');
  assert.equal(redis.writes.length, 0, 'ni 404 ni 401 ne posent de marqueur');
  assert.equal(await later(images(api, 500)), null);
  await clock.advance(5000);
  await assert.rejects(later(images(api, 500, strict)), { code: 'TMDB_TRANSIENT', reason: 'upstream', status: 500 });
  await assert.rejects(
    later(api.fetchTmdbDetails('https://tmdb.test', 'key', 900, 'movie', 'fr-FR', strict)),
    { code: 'TMDB_TRANSIENT', reason: 'timeout', transient: true },
  );
  await assert.rejects(later(api.fetchTmdbAlternativeTitles('https://tmdb.test', 'key', 500, 'movie', strict)), { code: 'TMDB_TRANSIENT' });
  await assert.rejects(later(api.fetchTmdbCredits('https://tmdb.test', 'key', 500, 'movie', strict)), { code: 'TMDB_TRANSIENT' });
  await assert.rejects(later(api.searchTmdb('https://tmdb.test', 'key', 'movie', 'x', { page: 2 }, 'fr-FR', strict)), { code: 'TMDB_TRANSIENT' });
  await assert.rejects(later(api.fetchTmdbSeason('https://tmdb.test', 'key', 500, 1, 'fr-FR', strict)), { code: 'TMDB_TRANSIENT' });
  assert.equal(await later(api.fetchTmdbCredits('https://tmdb.test', 'key', 404, 'movie', strict)), null);
});

test('appelants stricts et non stricts partagent le même transport', async () => {
  const clock = fakeClock();
  const calls = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const api = loadTmdbCache({ clock, axios: { get: async (url) => { calls.push(url); await gate; throw httpError(429); } } });
  const loose = images(api, 8);
  const strictCall = images(api, 8, strict);
  await flush();
  release();
  assert.equal(await loose, null);
  await assert.rejects(strictCall, { code: 'TMDB_TRANSIENT', reason: 'rate_limited' });
  assert.equal(calls.length, 1);
});

// Sortie directe + un proxy SOCKS5 : chaque IP a sa propre porte.
const socksAgent = { name: 'agent-socks' };
const withSocks = { PROXIES: [{ host: '10.0.0.1', port: 1080 }], getProxyAgent: () => socksAgent };
const viaOf = config => (config?.httpsAgent === socksAgent ? 'socks' : 'direct');

test('TMDB passe aussi par les proxys SOCKS5 : une rafale par sortie', async () => {
  const clock = fakeClock();
  const via = [];
  const api = loadTmdbCache({ clock, proxyManager: withSocks,
    axios: { get: async (url, config) => { via.push(viaOf(config)); return { data: { url } }; } } });
  const pending = settle(Array.from({ length: 20 }, (_, i) => images(api, i + 1, strict)));
  await flush();
  assert.deepEqual(via.sort(), ['direct', 'direct', 'direct', 'socks', 'socks', 'socks']);
  await clock.advance(1500);
  assert.equal(fulfilled(await pending), 20, 'deux sorties à 7/s absorbent la rafale');
});

test('un 429 sur une sortie est réessayé tout de suite sur une autre', async () => {
  const clock = fakeClock();
  const via = [];
  const api = loadTmdbCache({ clock, proxyManager: withSocks, axios: { get: async (url, config) => {
    via.push(viaOf(config));
    if (viaOf(config) === 'direct') throw httpError(429);
    return { data: { url } };
  } } });
  assert.ok(await images(api, 1, strict));
  assert.deepEqual(via, ['direct', 'socks']);
});

test('un proxy injoignable est écarté 60 s, la sortie directe prend le relais', async () => {
  const clock = fakeClock();
  const via = [];
  let socksDown = true;
  const api = loadTmdbCache({ clock, proxyManager: withSocks, axios: { get: async (url, config) => {
    via.push(viaOf(config));
    if (viaOf(config) === 'socks' && socksDown) throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    return { data: { url } };
  } } });
  const burst = async (ids) => {
    const before = via.length;
    const pending = settle(ids.map(id => images(api, id, strict)));
    await clock.advance(1500);
    assert.equal(fulfilled(await pending), ids.length);
    return via.slice(before);
  };
  // Rafale de 3 en direct (égalité), le 4e sur le proxy, qui échoue puis repasse en direct.
  assert.deepEqual(await burst([1, 2, 3, 4]), ['direct', 'direct', 'direct', 'socks', 'direct']);
  socksDown = false;
  await clock.advance(30_000);
  assert.ok(!(await burst([5, 6, 7, 8])).includes('socks'), 'encore écarté à 30 s');
  await clock.advance(31_000);
  assert.ok((await burst([9, 10, 11, 12])).includes('socks'), 'revenu après 60 s');
});

const details = (api, id, type = 'tv', language = 'fr-FR', options) =>
  api.fetchTmdbDetails('https://tmdb.test', 'key', id, type, language, options);

test('un 404 sur les détails est retenu 6 h pour tous les workers et toutes les langues', async () => {
  const clock = fakeClock();
  const redis = fakeRedis(clock);
  const callsA = [];
  const workerA = loadTmdbCache({ clock, redis, axios: { get: async (url) => { callsA.push(url); throw httpError(404); } } });
  const callsB = [];
  const workerB = loadTmdbCache({ clock, redis, axios: okAxios(callsB) });

  assert.equal(await details(workerA, 999, 'tv', 'fr-FR', strict), null, 'un vrai absent reste null en strict');
  assert.equal(callsA.length, 1);
  const [marker] = redis.writes;
  assert.deepEqual(marker.slice(0, 3), ['tmdb:missing:details:tv:999', '1', 'EX']);
  assert.ok(marker[3] >= 6 * 3600 * 0.9 && marker[3] <= 6 * 3600 * 1.1, `TTL de 6 h ±10 % (reçu ${marker[3]} s)`);

  // Autre worker, autre langue, strict ou non : ni appel réseau ni erreur.
  assert.equal(await details(workerB, 999, 'tv', 'en-US'), null);
  assert.equal(await details(workerB, 999, 'tv', 'fr-FR', strict), null);
  assert.equal(callsB.length, 0, 'l’ID absent n’est pas redemandé à TMDB');

  // Le même ID en film est une autre ressource : il reste demandé.
  assert.deepEqual(await details(workerB, 999, 'movie'), { url: 'https://tmdb.test/movie/999' });
  assert.equal(callsB.length, 1);

  // Passé le délai, TMDB est de nouveau interrogé.
  await clock.advance(6.6 * 3600 * 1000);
  assert.deepEqual(await details(workerB, 999, 'tv'), { url: 'https://tmdb.test/tv/999' });
  assert.equal(callsB.length, 2);
});

test('un échec temporaire ou un refus de clé sur les détails n’est jamais retenu comme absent', async () => {
  for (const [id, failure] of [[1, () => httpError(429)], [2, () => httpError(503)], [3, timeoutError], [4, () => httpError(401)]]) {
    const clock = fakeClock();
    const redis = fakeRedis(clock);
    const workerA = loadTmdbCache({ clock, redis, axios: { get: async () => { throw failure(); } } });
    const callsB = [];
    const workerB = loadTmdbCache({ clock, redis, axios: okAxios(callsB) });

    const failed = details(workerA, id);
    await clock.advance(1500);
    assert.equal(await failed, null);
    assert.ok(!redis.writes.some(([key]) => key.startsWith('tmdb:missing:')), `aucun marqueur d’absence (cas ${id})`);

    // Après le marqueur temporaire de 5 s, l'ID est redemandé normalement.
    await clock.advance(5000);
    assert.deepEqual(await details(workerB, id), { url: `https://tmdb.test/tv/${id}` });
    assert.equal(callsB.length, 1);
  }
});

test('TMDB_USE_SOCKS5=false garde la seule sortie directe', async () => {
  const clock = fakeClock();
  const via = [];
  const api = loadTmdbCache({ clock, proxyManager: withSocks, env: { TMDB_USE_SOCKS5: 'false' },
    axios: { get: async (url, config) => { via.push(viaOf(config)); return { data: { url } }; } } });
  const pending = settle(Array.from({ length: 6 }, (_, i) => images(api, i + 1, strict)));
  await flush();
  assert.deepEqual(via, ['direct', 'direct', 'direct']);
  await clock.advance(1500);
  await pending;
});
