'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const express = require('express');
const cheerio = require('cheerio');

const routePath = path.join(__dirname, '..', 'wiflix.js');
const routeSource = fsSync.readFileSync(routePath, 'utf8');
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

// Les actualisations écrivent de vrais fichiers .retry : attente bornée à 5 s.
async function until(condition) {
  const deadline = Date.now() + 5000;
  while (!condition() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(condition());
}

// Vraie route Wiflix, dépendances simulées. Chaque actualisation lancée prend
// le verrou de sa clé puis attend `open()` sur ses appels TMDB et CineStream.
async function loadRoute(t, { max }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wiflix-cap-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const cacheDir = path.join(root, 'cache', 'wiflix');
  await fs.mkdir(cacheDir, { recursive: true });
  let open;
  const gate = new Promise(resolve => { open = resolve; });
  const locks = { taken: [], released: 0, busy: new Set() };
  const timers = [], warnings = [], priorities = [];
  const unexpected = async () => { throw new Error('Appel Flemmix inattendu'); };
  const modules = {
    express, axios: {}, cheerio, path, fs: fsSync,
    '../config/redis': { memoryCache: { get: async () => null, set: async () => {} }, redis: null },
    '../utils/sourceRefreshTelemetry': {
      reportRefreshFailure() {}, refreshStep() {}, withRefreshDiagnostics: (_details, _redis, work) => work(),
    },
    '../utils/sourceIdentity': { createIdentityVerifier() {}, parseSourceIdentity() {}, searchTitles: titles => titles },
    '../utils/cacheManager': { generateCacheKey: key => key, saveToCache: async () => true },
    '../utils/proxyManager': {
      makeWiflixRequest: unexpected, makeWiflixSearchRequest: unexpected,
      runWithWiflixPriority: (priority, work) => { priorities.push(priority); return work(); },
    },
    '../utils/redisLock': {
      acquireRedisLock: async name => {
        if (locks.busy.has(name)) return null;
        locks.taken.push(name);
        return { renew: async () => true, release: async () => { locks.released++; } };
      },
    },
    '../utils/wiflixRefreshState': require('../../utils/wiflixRefreshState'),
    '../utils/embedExtraction': { respondWithResolvedSources: async (_req, res, payload) => res.json(payload) },
    '../utils/tmdbCache': {
      fetchTmdbDetails: async () => { await gate; return null; },
      fetchTmdbSeason: async () => { await gate; return null; },
    },
    './cinestream': { fetchCinestreamMovieData: async () => { await gate; return { success: false }; } },
  };
  const routeModule = { exports: {} };
  vm.compileFunction(routeSource, ['require', 'module', '__dirname', 'process', 'console', 'setTimeout'],
    { filename: routePath })(
    request => {
      assert.ok(Object.hasOwn(modules, request), `Dépendance non simulée : ${request}`);
      return modules[request];
    },
    routeModule,
    path.join(root, 'routes'),
    { env: { WIFLIX_REFRESH_MAX_PER_WORKER: String(max), WIFLIX_BASE_URL: 'https://source.test' } },
    { ...console, log() {}, info() {}, error() {}, warn: (...args) => warnings.push(args.join(' ')) },
    (callback, ms) => { timers.push({ callback, ms }); return { unref() {} }; },
  );
  const router = routeModule.exports;
  const request = async (routePathName, params) => {
    const handler = router.stack.find(layer => layer.route?.path === routePathName).route.stack[0].handle;
    const response = {
      statusCode: 200, headersSent: false,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; this.headersSent = true; return this; },
    };
    await handler({ params, query: {}, headers: {} }, response);
    return response;
  };
  // Cache réussi publié il y a 4 h : servi, puis actualisé.
  const stale = async key => {
    const file = path.join(cacheDir, `${key}.json`);
    await fs.writeFile(file, JSON.stringify({ success: true, players: { vf: [{ url: 'https://cached.test/embed' }], vostfr: [] } }));
    const old = new Date(Date.now() - 4 * 60 * 60 * 1000);
    await fs.utimes(file, old, old);
  };
  // Cache publié il y a `hours` heures.
  const write = async (key, data, hours) => {
    const file = path.join(cacheDir, `${key}.json`);
    await fs.writeFile(file, JSON.stringify(data));
    const old = new Date(Date.now() - hours * 60 * 60 * 1000);
    await fs.utimes(file, old, old);
  };
  // Cache négatif (titre absent de la source) publié il y a `hours` heures.
  const negative = (key, hours) => write(key, { success: false, error: 'Film non trouvé', search_page_checked: true }, hours);
  return {
    cacheDir, locks, timers, warnings, priorities, open, stale, negative, write,
    movie: tmdbId => request('/movie/:tmdbId', { tmdbId }),
    tv: tmdbId => request('/tv/:tmdbId/:season', { tmdbId, season: '1' }),
    lock: key => `wiflix:update:${key}`,
  };
}

test('le plafond par worker garde des places aux titres sans cache, films et séries ensemble', async t => {
  // Plafond de 4 : 2 places pour les caches périmés, 4 pour les titres sans cache.
  const r = await loadRoute(t, { max: 4 });
  for (const key of ['wiflix_movie_1', 'wiflix_movie_2', 'wiflix_movie_3', 'wiflix_tv_9_1']) await r.stale(key);

  for (const id of ['1', '2', '3']) assert.equal((await r.movie(id)).statusCode, 200);
  assert.equal((await r.tv('9')).statusCode, 200);
  assert.deepEqual(r.locks.taken, [r.lock('wiflix_movie_1'), r.lock('wiflix_movie_2')]);

  assert.equal((await r.movie('4')).statusCode, 202);
  assert.equal((await r.tv('8')).statusCode, 202);
  assert.equal((await r.movie('6')).statusCode, 202);
  assert.deepEqual(r.locks.taken.slice(2), [r.lock('wiflix_movie_4'), r.lock('wiflix_tv_8_1')]);
  // Un titre sans cache attend plus longtemps son créneau du débit global.
  assert.deepEqual(r.priorities, ['stale', 'stale', 'missing', 'missing']);

  // Un refus n'écrit rien : ni cache, ni délai de reprise.
  for (const key of ['wiflix_movie_3', 'wiflix_tv_9_1', 'wiflix_movie_6']) {
    await assert.rejects(fs.stat(path.join(r.cacheDir, `${key}.retry`)), { code: 'ENOENT' }, key);
  }
  await assert.rejects(fs.stat(path.join(r.cacheDir, 'wiflix_movie_6.json')), { code: 'ENOENT' });

  // Une seule ligne de relevé par minute, aucune par requête.
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.timers.map(timer => timer.ms), [60_000]);
  r.timers[0].callback();
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /Plafond de 4 .* 3 refusées en 1 min \(2 caches périmés, 1 sans cache\)/);

  // Fin des actualisations : les places se libèrent, la visite suivante réessaie.
  r.open();
  await until(() => r.locks.released === 4);
  await nextTurn();
  assert.equal((await r.movie('3')).statusCode, 200);
  assert.equal((await r.movie('6')).statusCode, 202);
  assert.deepEqual(r.locks.taken.slice(4), [r.lock('wiflix_movie_3'), r.lock('wiflix_movie_6')]);
  await until(() => r.locks.released === 6);
  assert.equal(r.timers.length, 1);
});

test('un titre absent de Flemmix n’est recherché à nouveau qu’après 6 h', async t => {
  const r = await loadRoute(t, { max: 4 });
  // 2 h : encore frais (l'ancien délai de 30 min relançait une recherche).
  await r.negative('wiflix_movie_1', 2);
  // 7 h : au-delà de 6 h et de l'écart de ±10 %, actualisé.
  await r.negative('wiflix_movie_2', 7);
  assert.equal((await r.movie('1')).statusCode, 200);
  assert.equal((await r.movie('2')).statusCode, 200);
  assert.deepEqual(r.locks.taken, [r.lock('wiflix_movie_2')]);
  r.open();
  await until(() => r.locks.released === 1);
});

test('un introuvable écrit avant la vérification de la page est réexaminé une fois', async t => {
  const r = await loadRoute(t, { max: 4 });
  const accessPage = '<title>Flemmix - Acces securise</title><a id="_btn" class="button">Accéder maintenant</a>';
  const searchPage = '<form id="quicksearch" method="post"><input name="story"></form><p>Aucun résultat</p>';
  // Page d'accès prise pour une recherche vide (ancien cache), puis négatif
  // sans page gardée : réexaminés malgré leur fraîcheur de 6 h.
  await r.write('wiflix_movie_1', { success: false, error: 'Film non trouvé', debugHtml: accessPage }, 1);
  await r.write('wiflix_movie_2', { success: false, error: 'Film non trouvé' }, 1);
  // Vraie page de résultats vide, ou négatif vérifié : gardés 6 h.
  await r.write('wiflix_movie_3', { success: false, error: 'Film non trouvé', debugHtml: searchPage }, 1);
  await r.negative('wiflix_movie_4', 1);
  for (let id = 1; id <= 4; id++) assert.equal((await r.movie(String(id))).statusCode, 200);
  assert.deepEqual(r.locks.taken, [r.lock('wiflix_movie_1'), r.lock('wiflix_movie_2')]);
  r.open();
  await until(() => r.locks.released === 2);
});

test('la fraîcheur suit l’âge de la sortie : introuvable ancien 3 jours, succès ancien 12 h', async t => {
  const r = await loadRoute(t, { max: 8 });
  const daysAgo = days => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const found = release => ({ success: true, players: { vf: [{ url: 'https://cached.test/embed' }], vostfr: [] },
    release_date: release });
  const missing = release => ({ success: false, error: 'Film non trouvé', release_date: release, search_page_checked: true });
  // Âges de publication à ±10 % des durées : frais, puis périmé.
  await r.write('wiflix_movie_1', missing(daysAgo(800)), 2 * 24);
  await r.write('wiflix_movie_2', missing(daysAgo(800)), 3.4 * 24);
  await r.write('wiflix_movie_3', found(daysAgo(800)), 10);
  await r.write('wiflix_movie_4', found(daysAgo(800)), 14);
  await r.write('wiflix_movie_5', missing(daysAgo(200)), 21);
  await r.write('wiflix_movie_6', missing(daysAgo(200)), 27);
  // Sortie récente : 3 h, comme avant.
  await r.write('wiflix_movie_7', found(daysAgo(20)), 4);
  for (let id = 1; id <= 7; id++) assert.equal((await r.movie(String(id))).statusCode, 200);
  assert.deepEqual(r.locks.taken, ['2', '4', '6', '7'].map(id => r.lock(`wiflix_movie_${id}`)));
  r.open();
  await until(() => r.locks.released === 4);
});

test('une actualisation déjà prise par un autre worker rend aussitôt sa place', async t => {
  // Plafond de 2 : une seule place pour un cache périmé.
  const r = await loadRoute(t, { max: 2 });
  await r.stale('wiflix_movie_1');
  await r.stale('wiflix_movie_2');
  r.locks.busy.add(r.lock('wiflix_movie_1'));
  assert.equal((await r.movie('1')).statusCode, 200);
  await nextTurn();
  assert.equal((await r.movie('2')).statusCode, 200);
  assert.deepEqual(r.locks.taken, [r.lock('wiflix_movie_2')]);
  assert.deepEqual(r.timers, []);
  r.open();
  await until(() => r.locks.released === 1);
});
