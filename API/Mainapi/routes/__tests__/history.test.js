const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Les objets créés dans le contexte `vm` n'ont pas le même prototype.
const plain = value => JSON.parse(JSON.stringify(value));

const OWNER = { userType: 'oauth', userId: 'user', profileId: 'profile-one' };

function fakeStore() {
  const calls = { listContinue: [], listHistory: [], getTitle: [], listProgress: [], recordProgress: [], hide: [], hideAll: [] };
  return {
    async getTitle(owner, options) {
      calls.getTitle.push({ owner, options });
      if (options.tmdbId === 404) return null;
      return { mediaType: options.mediaType, tmdbId: options.tmdbId, status: 'in_progress', episodes: [] };
    },
    calls,
    async listHistory(owner, options) {
      calls.listHistory.push({ owner, options });
      return {
        items: [{ mediaType: 'movie', tmdbId: 550, title: 'Fight Club', finished: false, episodesWatched: null, episodesTotal: null }],
        total: 16,
        counts: { inProgress: 16, finished: 0, notStarted: 2 },
        stats: { watchedSeconds: 44820, trackedSeconds: 51000, moviesFinished: 0, episodesFinished: 0 },
      };
    },
    async listContinue(owner, language) {
      calls.listContinue.push({ owner, language });
      return [{ mediaType: 'movie', tmdbId: 550, title: 'Fight Club' }];
    },
    async listProgress(owner, mediaType, tmdbId) {
      calls.listProgress.push({ owner, mediaType, tmdbId });
      return [{ season: 1, episode: 2, position: 30, duration: 100, updatedAt: '2026-10-16T10:00:00.000Z' }];
    },
    async recordProgress(owner, entry) { calls.recordProgress.push({ owner, entry }); },
    async hide(owner, mediaType, tmdbId) { calls.hide.push({ owner, mediaType, tmdbId }); },
    async hideAll(owner) { calls.hideAll.push({ owner }); return 3; },
  };
}

// Même chargement `vm` que syncPerformance.test.js : routes/history.js avec
// une auth, un module de synchro et un import factices.
async function fixture({ importStatus = 'already', profileData = { user_language: 'fr' }, marksVerified = true } = {}) {
  const markChecks = [];
  const titleDeletes = [];
  const ensureProfileMarks = async (owner) => { markChecks.push(owner); return marksVerified; };
  const store = fakeStore();
  const imports = [];
  const resyncProfileMarks = async () => {};
  const accounts = {
    'oauth:user': { profiles: [{ id: 'profile-one' }] },
    'oauth:other': { profiles: [{ id: 'profile-two' }] },
  };
  const filename = path.resolve(__dirname, '../history.js');
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  const stubs = {
    '../middleware/auth': { getAuthIfValid: async req => req.auth },
    './sync': {
      readUserData: async (userType, userId) => structuredClone(accounts[`${userType}:${userId}`] || {}),
      readProfileImportData: async () => ({ progress_550: '{}' }),
      readProfileData: async () => structuredClone(profileData),
      getHistoryStore: () => store,
      resyncProfileMarks,
      ensureProfileMarks,
      deleteTitleFromProfile: async (owner, mediaType, tmdbId) => { titleDeletes.push({ owner, mediaType, tmdbId }); },
    },
    '../mysqlPool': { getPool: () => ({ fake: true }) },
    '../utils/historyImport': {
      ensureImported: async (...args) => { imports.push(args); return importStatus; },
    },
    '../utils/redisRateLimitStore': { createRedisRateLimitStore: () => ({}) },
    'express-rate-limit': Object.assign(() => (_req, _res, next) => next(), { ipKeyGenerator: value => value }),
  };
  vm.runInNewContext(await fs.readFile(filename, 'utf8'), {
    module, exports: module.exports, __dirname: path.dirname(filename),
    require: request => request in stubs ? stubs[request] : localRequire(request),
    console: { log() {}, warn() {}, error() {} },
  }, { filename });
  const router = module.exports;

  async function request(method, routePath, { auth = { userType: 'oauth', userId: 'user' }, query = {}, params = {}, body = {} } = {}) {
    const req = { method: method.toUpperCase(), headers: {}, auth, query, params, body };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(data) { this.body = JSON.parse(JSON.stringify(data)); return this; },
      end() { this.ended = true; return this; },
      sendStatus(code) { this.statusCode = code; this.ended = true; return this; },
    };
    const layer = router.stack.find(item => item.route?.path === routePath && item.route.methods[method.toLowerCase()]);
    assert.ok(layer, `route ${method} ${routePath} absente`);
    for (const handler of layer.route.stack) {
      let next = false;
      await handler.handle(req, res, () => { next = true; });
      if (!next) break;
    }
    return res;
  }

  // Routes DELETE qu'Express choisirait pour un chemin réel (ordre de la pile).
  function deleteRoutesMatching(urlPath) {
    return router.stack
      .filter(item => item.route?.methods.delete && item.match(urlPath))
      .map(item => item.route.path);
  }

  return { request, store, imports, deleteRoutesMatching, resyncProfileMarks, markChecks, titleDeletes };
}

test('sans auth : 401 sur chaque route', async () => {
  const f = await fixture();
  const cases = [
    ['get', '/history/continue', { query: { profileId: 'profile-one' } }],
    ['get', '/history/progress', { query: { profileId: 'profile-one', type: 'tv', id: '1399' } }],
    ['post', '/history/progress', { body: { profileId: 'profile-one', type: 'movie', id: 550, position: 1, duration: 2 } }],
    ['delete', '/history/continue/:type/:id', { params: { type: 'tv', id: '1399' }, query: { profileId: 'profile-one' } }],
    ['delete', '/history/continue', { query: { profileId: 'profile-one' } }],
    ['get', '/history/list', { query: { profileId: 'profile-one', status: 'in_progress' } }],
  ];
  for (const [method, routePath, options] of cases) {
    const response = await f.request(method, routePath, { ...options, auth: null });
    assert.equal(response.statusCode, 401, `${method} ${routePath}`);
  }
  // Type de compte non synchronisé (invité) : 401 aussi.
  const guest = await f.request('get', '/history/continue', { auth: { userType: 'guest', userId: 'g' }, query: { profileId: 'profile-one' } });
  assert.equal(guest.statusCode, 401);
  assert.equal(f.imports.length, 0);
  assert.equal(f.store.calls.listContinue.length, 0);
  assert.equal(f.store.calls.hideAll.length, 0);
  assert.equal(f.store.calls.listHistory.length, 0);
});

test('GET list : ensureImported puis page du magasin, complete suit l’import', async () => {
  for (const [status, complete] of [['already', true], ['imported', true], ['deferred', false], ['failed', false]]) {
    const f = await fixture({ importStatus: status });
    const response = await f.request('get', '/history/list', {
      query: { profileId: 'profile-one', language: 'en-US', status: 'finished', page: '3', pageSize: '10' },
    });
    assert.equal(response.statusCode, 200, status);
    assert.deepEqual(response.body, {
      items: [{ mediaType: 'movie', tmdbId: 550, title: 'Fight Club', finished: false, episodesWatched: null, episodesTotal: null }],
      page: 3,
      pageSize: 10,
      total: 16,
      counts: { inProgress: 16, finished: 0, notStarted: 2 },
      stats: { watchedSeconds: 44820, trackedSeconds: 51000, moviesFinished: 0, episodesFinished: 0 },
      complete,
    });
    assert.equal(f.imports.length, 1);
    const [, historyStore, owner, , options] = f.imports[0];
    assert.equal(historyStore, f.store);
    assert.deepEqual(plain(owner), OWNER);
    // Marques relues sous le verrou de synchro après un import.
    assert.equal(options.afterImport, f.resyncProfileMarks);
    // Import pas fait : liste partielle, pas gardée en mémoire.
    assert.deepEqual(plain(f.store.calls.listHistory[0]), {
      owner: OWNER,
      options: { status: 'finished', language: 'en-US', page: 3, pageSize: 10, cache: complete },
    });
  }
});

test('GET list : valeurs par défaut et bornes de page / pageSize / langue', async () => {
  const cases = [
    [{}, { language: 'fr-FR', page: 1, pageSize: 20 }],
    [{ language: 'de-DE', page: '0', pageSize: '0' }, { language: 'fr-FR', page: 1, pageSize: 20 }],
    [{ page: 'abc', pageSize: '1.5' }, { language: 'fr-FR', page: 1, pageSize: 20 }],
    [{ page: '-2', pageSize: '500' }, { language: 'fr-FR', page: 1, pageSize: 50 }],
    [{ page: '7', pageSize: '1' }, { language: 'fr-FR', page: 7, pageSize: 1 }],
  ];
  for (const [query, expected] of cases) {
    const f = await fixture();
    const response = await f.request('get', '/history/list', { query: { profileId: 'profile-one', status: 'not_started', ...query } });
    assert.equal(response.statusCode, 200, JSON.stringify(query));
    assert.deepEqual(plain(f.store.calls.listHistory[0].options), { status: 'not_started', ...expected, cache: true }, JSON.stringify(query));
    assert.equal(response.body.page, expected.page);
    assert.equal(response.body.pageSize, expected.pageSize);
  }
});

test('DELETE title : 401, 404, 400, puis 204 avec suppression sous le verrou ; routes DELETE distinctes', async () => {
  const f = await fixture();
  const route = '/history/title/:type/:id';
  assert.equal((await f.request('delete', route, { auth: null, params: { type: 'tv', id: '1399' }, query: { profileId: 'profile-one' } })).statusCode, 401);
  assert.equal((await f.request('delete', route, { params: { type: 'tv', id: '1399' }, query: { profileId: 'profile-two' } })).statusCode, 404);
  for (const params of [{ type: 'film', id: '1399' }, { type: 'tv', id: '0' }, { type: 'tv', id: 'abc' }]) {
    assert.equal((await f.request('delete', route, { params, query: { profileId: 'profile-one' } })).statusCode, 400, JSON.stringify(params));
  }
  assert.equal(f.titleDeletes.length, 0);

  const response = await f.request('delete', route, { params: { type: 'tv', id: '1399' }, query: { profileId: 'profile-one' } });
  assert.equal(response.statusCode, 204);
  assert.deepEqual(plain(f.titleDeletes), [{ owner: OWNER, mediaType: 'tv', tmdbId: 1399 }]);
  // Pas de masquage « Reprendre » à la place.
  assert.equal(f.store.calls.hide.length, 0);

  assert.deepEqual(f.deleteRoutesMatching('/history/title/tv/1399'), ['/history/title/:type/:id']);
  assert.deepEqual(f.deleteRoutesMatching('/history/continue/tv/1399'), ['/history/continue/:type/:id']);
});

test('GET title : 401, 404, 400 (type ou id invalide)', async () => {
  const f = await fixture();
  const unauth = await f.request('get', '/history/title', { auth: null, query: { profileId: 'profile-one', type: 'tv', id: '1399' } });
  assert.equal(unauth.statusCode, 401);
  const other = await f.request('get', '/history/title', { query: { profileId: 'profile-two', type: 'tv', id: '1399' } });
  assert.equal(other.statusCode, 404);
  for (const query of [{ type: 'film', id: '1399' }, { type: 'tv', id: 'abc' }, { type: 'tv' }]) {
    const response = await f.request('get', '/history/title', { query: { profileId: 'profile-one', ...query } });
    assert.equal(response.statusCode, 400, JSON.stringify(query));
  }
  assert.equal(f.imports.length, 0);
  assert.equal(f.store.calls.getTitle.length, 0);
});

test('GET title : import + recalage des marques comme /list, titre du magasin, absent → null', async () => {
  const f = await fixture({ importStatus: 'already' });
  const response = await f.request('get', '/history/title', { query: { profileId: 'profile-one', type: 'tv', id: '1399', language: 'en-US' } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { complete: true, title: { mediaType: 'tv', tmdbId: 1399, status: 'in_progress', episodes: [] } });
  assert.equal(f.imports.length, 1);
  assert.equal(f.imports[0][4].afterImport, f.resyncProfileMarks);
  assert.deepEqual(plain(f.markChecks), [OWNER]);
  assert.deepEqual(plain(f.store.calls.getTitle[0]), { owner: OWNER, options: { mediaType: 'tv', tmdbId: 1399, language: 'en-US', cache: true } });

  const absent = await f.request('get', '/history/title', { query: { profileId: 'profile-one', type: 'movie', id: '404' } });
  assert.deepEqual(absent.body, { complete: true, title: null });

  // Import pas fait : pas de recalage, pas de cache, complete false.
  const deferred = await fixture({ importStatus: 'deferred' });
  const partial = await deferred.request('get', '/history/title', { query: { profileId: 'profile-one', type: 'movie', id: '550' } });
  assert.equal(partial.body.complete, false);
  assert.equal(deferred.markChecks.length, 0);
  assert.equal(deferred.store.calls.getTitle[0].options.cache, false);
  // Recalage raté : réponse servie sans cache.
  const failed = await fixture({ marksVerified: false });
  await failed.request('get', '/history/title', { query: { profileId: 'profile-one', type: 'movie', id: '550' } });
  assert.equal(failed.store.calls.getTitle[0].options.cache, false);
});

test('GET title : historique désactivé → titre vide et complet, sans import', async () => {
  const f = await fixture({ profileData: { settings_disable_history: 'true' } });
  const response = await f.request('get', '/history/title', { query: { profileId: 'profile-one', type: 'tv', id: '1399' } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { complete: true, title: null });
  assert.equal(f.imports.length, 0);
  assert.equal(f.store.calls.getTitle.length, 0);
});

test('GET list : marques vérifiées avant le calcul (import fait) ; échec → liste non gardée', async () => {
  const ok = await fixture({ importStatus: 'already' });
  await ok.request('get', '/history/list', { query: { profileId: 'profile-one', status: 'finished' } });
  assert.deepEqual(plain(ok.markChecks), [OWNER]);
  assert.equal(ok.store.calls.listHistory[0].options.cache, true);

  const failed = await fixture({ importStatus: 'imported', marksVerified: false });
  const response = await failed.request('get', '/history/list', { query: { profileId: 'profile-one', status: 'finished' } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.complete, true);
  assert.equal(failed.store.calls.listHistory[0].options.cache, false);

  // Import pas fait : pas de vérification (fichier pas encore importé), pas de cache.
  const deferred = await fixture({ importStatus: 'deferred' });
  await deferred.request('get', '/history/list', { query: { profileId: 'profile-one', status: 'finished' } });
  assert.equal(deferred.markChecks.length, 0);
  assert.equal(deferred.store.calls.listHistory[0].options.cache, false);
});

test('GET list : statut absent ou inconnu → 400, sans import ni lecture', async () => {
  const f = await fixture();
  for (const status of [undefined, '', 'all', 'IN_PROGRESS', 'inProgress']) {
    const response = await f.request('get', '/history/list', { query: { profileId: 'profile-one', status } });
    assert.equal(response.statusCode, 400, String(status));
    assert.equal(response.body.code, 'INVALID_HISTORY_STATUS');
  }
  assert.equal(f.imports.length, 0);
  assert.equal(f.store.calls.listHistory.length, 0);
});

test('GET list : profil d’un autre compte → 404', async () => {
  const f = await fixture();
  const response = await f.request('get', '/history/list', { query: { profileId: 'profile-two', status: 'in_progress' } });
  assert.equal(response.statusCode, 404);
  assert.equal(response.body.code, 'PROFILE_NOT_FOUND');
  assert.equal(f.imports.length, 0);
  assert.equal(f.store.calls.listHistory.length, 0);
});

test('GET list : historique désactivé → liste vide et chiffres à 0, sans import', async () => {
  const f = await fixture({ profileData: { settings_disable_history: 'true' } });
  const response = await f.request('get', '/history/list', { query: { profileId: 'profile-one', status: 'in_progress', page: '2' } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    items: [],
    page: 2,
    pageSize: 20,
    total: 0,
    counts: { inProgress: 0, finished: 0, notStarted: 0 },
    stats: { watchedSeconds: 0, trackedSeconds: 0, moviesFinished: 0, episodesFinished: 0 },
    complete: true,
  });
  assert.equal(f.imports.length, 0);
  assert.equal(f.store.calls.listHistory.length, 0);
});

test('historique désactivé : liste vide et complète, sans import ni lecture de la rangée', async () => {
  const f = await fixture({ profileData: { settings_disable_history: 'true', progress_550: '{}' } });
  const response = await f.request('get', '/history/continue', { query: { profileId: 'profile-one', language: 'fr-FR' } });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { items: [], complete: true });
  assert.equal(f.imports.length, 0);
  assert.equal(f.store.calls.listContinue.length, 0);

  // Réglage à 'false' : rangée lue normalement.
  const enabled = await fixture({ profileData: { settings_disable_history: 'false' } });
  const normal = await enabled.request('get', '/history/continue', { query: { profileId: 'profile-one' } });
  assert.equal(normal.body.items.length, 1);
  assert.equal(enabled.store.calls.listContinue.length, 1);
});

test('profil d’un autre compte : 404', async () => {
  const f = await fixture();
  const response = await f.request('get', '/history/continue', { query: { profileId: 'profile-two' } });
  assert.equal(response.statusCode, 404);
  assert.equal(response.body.code, 'PROFILE_NOT_FOUND');
  assert.equal(f.imports.length, 0);

  const removed = await f.request('delete', '/history/continue/:type/:id', { params: { type: 'tv', id: '1399' }, query: { profileId: 'profile-two' } });
  assert.equal(removed.statusCode, 404);
  assert.equal(f.store.calls.hide.length, 0);

  const cleared = await f.request('delete', '/history/continue', { query: { profileId: 'profile-two' } });
  assert.equal(cleared.statusCode, 404);
  assert.equal(f.store.calls.hideAll.length, 0);
});

test('profileId absent ou invalide : 400', async () => {
  const f = await fixture();
  assert.equal((await f.request('get', '/history/continue', { query: {} })).statusCode, 400);
  assert.equal((await f.request('get', '/history/continue', { query: { profileId: '../x' } })).statusCode, 400);
});

test('type=film : 400', async () => {
  const f = await fixture();
  const progress = await f.request('get', '/history/progress', { query: { profileId: 'profile-one', type: 'film', id: '550' } });
  assert.equal(progress.statusCode, 400);
  const removed = await f.request('delete', '/history/continue/:type/:id', { params: { type: 'film', id: '550' }, query: { profileId: 'profile-one' } });
  assert.equal(removed.statusCode, 400);
  const posted = await f.request('post', '/history/progress', { body: { profileId: 'profile-one', type: 'film', id: 550, position: 1, duration: 2 } });
  assert.equal(posted.statusCode, 400);
  assert.equal(f.store.calls.hide.length, 0);
  assert.equal(f.store.calls.recordProgress.length, 0);
});

test('id non entier positif : 400', async () => {
  const f = await fixture();
  for (const id of ['0', '-3', '1.5', 'abc', '', '99999999999']) {
    const response = await f.request('get', '/history/progress', { query: { profileId: 'profile-one', type: 'movie', id } });
    assert.equal(response.statusCode, 400, `id ${JSON.stringify(id)}`);
  }
});

test('GET continue appelle ensureImported puis renvoie {items} du magasin', async () => {
  const f = await fixture({ importStatus: 'imported' });
  const response = await f.request('get', '/history/continue', { query: { profileId: 'profile-one', language: 'en-US' } });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { items: [{ mediaType: 'movie', tmdbId: 550, title: 'Fight Club' }], complete: true });
  assert.equal(f.imports.length, 1);
  const [pool, historyStore, owner, readProfileData] = f.imports[0];
  assert.deepEqual(plain(pool), { fake: true });
  assert.equal(historyStore, f.store);
  assert.deepEqual(plain(owner), OWNER);
  assert.deepEqual(plain(await readProfileData('oauth', 'user', 'profile-one')), { progress_550: '{}' });
  assert.equal(f.store.calls.listContinue.length, 1);
  assert.deepEqual(plain(f.store.calls.listContinue[0].owner), OWNER);
  assert.equal(f.store.calls.listContinue[0].language, 'en-US');
});

test('GET continue : complete suit le statut de l’import, langue inconnue → fr-FR', async () => {
  for (const [status, complete] of [['already', true], ['imported', true], ['deferred', false], ['failed', false]]) {
    const f = await fixture({ importStatus: status });
    const response = await f.request('get', '/history/continue', { query: { profileId: 'profile-one', language: 'de-DE' } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.complete, complete, status);
    assert.equal(f.store.calls.listContinue[0].language, 'fr-FR');
  }
});

test('GET progress renvoie {items} du magasin', async () => {
  const f = await fixture();
  const response = await f.request('get', '/history/progress', { query: { profileId: 'profile-one', type: 'tv', id: '1399' } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { items: [{ season: 1, episode: 2, position: 30, duration: 100, updatedAt: '2026-10-16T10:00:00.000Z' }] });
  assert.deepEqual(plain(f.store.calls.listProgress[0]), { owner: OWNER, mediaType: 'tv', tmdbId: 1399 });
});

test('POST progress enregistre la position (film et épisode) et répond 204', async () => {
  const f = await fixture();
  const before = Date.now();
  const movie = await f.request('post', '/history/progress', { body: { profileId: 'profile-one', type: 'movie', id: 550, position: 42.5, duration: 7200 } });
  const episode = await f.request('post', '/history/progress', { body: { profileId: 'profile-one', type: 'tv', id: 1399, season: 2, episode: 3, position: 0, duration: 3000 } });

  assert.equal(movie.statusCode, 204);
  assert.equal(episode.statusCode, 204);
  assert.equal(f.store.calls.recordProgress.length, 2);
  const [first, second] = f.store.calls.recordProgress;
  assert.deepEqual(plain(first.owner), OWNER);
  assert.equal(first.entry.mediaType, 'movie');
  assert.equal(first.entry.tmdbId, 550);
  assert.equal(first.entry.season, 0);
  assert.equal(first.entry.episode, 0);
  assert.equal(first.entry.position, 42.5);
  assert.equal(first.entry.duration, 7200);
  assert.ok(first.entry.updatedAt.getTime() >= before);
  assert.equal(second.entry.mediaType, 'tv');
  assert.equal(second.entry.season, 2);
  assert.equal(second.entry.episode, 3);
});

test('POST progress : corps invalide → 400', async () => {
  const f = await fixture();
  const base = { profileId: 'profile-one', type: 'tv', id: 1399, season: 1, episode: 1, position: 10, duration: 100 };
  const invalid = [
    { ...base, season: undefined },
    { ...base, episode: 0 },
    { ...base, season: 1.5 },
    { ...base, position: -1 },
    { ...base, position: '10' },
    { ...base, duration: Number.POSITIVE_INFINITY },
    { ...base, duration: undefined },
    { ...base, id: 13.5 },
    { ...base, id: 'abc' },
    { ...base, type: 'movie', id: 550 },
  ];
  for (const body of invalid) {
    const response = await f.request('post', '/history/progress', { body });
    assert.equal(response.statusCode, 400, JSON.stringify(body));
  }
  assert.equal(f.store.calls.recordProgress.length, 0);
});

test('DELETE continue appelle hide avec (tv, 1399) et répond 204', async () => {
  const f = await fixture();
  const response = await f.request('delete', '/history/continue/:type/:id', { params: { type: 'tv', id: '1399' }, query: { profileId: 'profile-one' } });
  assert.equal(response.statusCode, 204);
  assert.equal(f.store.calls.hide.length, 1);
  assert.deepEqual(plain(f.store.calls.hide[0].owner), OWNER);
  assert.equal(f.store.calls.hide[0].mediaType, 'tv');
  assert.equal(f.store.calls.hide[0].tmdbId, 1399);
});

test('DELETE continue sans type ni id : hideAll du profil en une fois, 204', async () => {
  const f = await fixture();
  const response = await f.request('delete', '/history/continue', { query: { profileId: 'profile-one' } });
  assert.equal(response.statusCode, 204);
  assert.equal(f.store.calls.hideAll.length, 1);
  assert.deepEqual(plain(f.store.calls.hideAll[0].owner), OWNER);
  assert.equal(f.store.calls.hide.length, 0);
});

test('DELETE continue : la route groupée et la route par titre ne se masquent pas', async () => {
  const f = await fixture();
  assert.deepEqual(f.deleteRoutesMatching('/history/continue'), ['/history/continue']);
  assert.deepEqual(f.deleteRoutesMatching('/history/continue/tv/1399'), ['/history/continue/:type/:id']);
});
