const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const policy = require('../../utils/syncPolicy');
const historyImport = require('../../utils/historyImport');
const { createAccountDataCache } = require('../../utils/accountDataCache');

// Les objets créés dans le contexte `vm` n'ont pas le même prototype.
const plain = value => JSON.parse(JSON.stringify(value));

function progress(position, duration, timestamp) {
  return JSON.stringify({ position, duration, timestamp });
}

// Même chargement `vm` que syncPerformance.test.js, avec un faux magasin
// d'historique injecté à la place de la base.
async function fixture(t, profile, { historyStore, ensureImported } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'movix-sync-history-'));
  const usersDir = path.join(dir, 'data', 'users');
  const accountPath = policy.getUserDataFilePath({ usersDir }, 'oauth', 'user');
  const profilePath = policy.getProfileFilePath(usersDir, 'oauth', 'user', 'profile-one');
  await fs.mkdir(path.dirname(profilePath), { recursive: true });
  await fs.writeFile(accountPath, JSON.stringify({ profiles: [{ id: 'profile-one', avatar: '/avatars/test.png' }] }));
  await fs.writeFile(profilePath, JSON.stringify(profile));
  const locks = new Map();
  const warnings = [];
  const imports = [];
  let writes = 0;
  const accountCache = createAccountDataCache();
  const filename = path.resolve(__dirname, '../sync.js');
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  const stubs = {
    '../middleware/auth': { getAuthIfValid: async req => req.auth },
    '../mysqlPool': {
      getPool: () => ({}),
      // Un verrou par nom, comme GET_LOCK.
      withMysqlAdvisoryLock: async (_pool, name, task) => {
        const previous = locks.get(name) || Promise.resolve();
        const current = previous.then(task);
        locks.set(name, current.catch(() => {}));
        return current;
      },
    },
    '../utils/accountDataCache': { readAccountData: accountCache.read },
    '../utils/safeFile': {
      async safeWriteFile(target, data) { writes++; await fs.writeFile(target, data); return true; },
      async safeWriteJsonFile(target, data) { await fs.writeFile(target, JSON.stringify(data)); return true; },
    },
    '../utils/discord': { logSyncErrorToDiscord: async () => {} },
    '../utils/redisRateLimitStore': { createRedisRateLimitStore: () => ({}) },
    '../utils/historyStore': { createHistoryStore: () => historyStore },
    '../utils/mediaStore': { createDefaultMediaStore: () => ({}) },
    '../utils/historyImport': {
      ...historyImport,
      ensureImported: ensureImported || (async (...args) => { imports.push(args); return 'already'; }),
    },
    'express-rate-limit': Object.assign(() => (_req, _res, next) => next(), { ipKeyGenerator: value => value }),
  };
  vm.runInNewContext(await fs.readFile(filename, 'utf8'), {
    module, exports: module.exports, __dirname: path.join(dir, 'routes'),
    require: request => request in stubs ? stubs[request] : localRequire(request),
    Buffer, structuredClone, setInterval, clearInterval, setTimeout, clearTimeout,
    process: { on() {} },
    console: { log() {}, warn(...args) { warnings.push(args.join(' ')); }, error() {} },
  }, { filename });
  const router = module.exports;
  async function request(ops) {
    const req = { headers: {}, auth: { userType: 'oauth', userId: 'user' }, body: { userType: 'oauth', userId: 'user', profileId: 'profile-one', ops } };
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.body = JSON.parse(JSON.stringify(data)); return this; } };
    const route = router.stack.find(layer => layer.route?.path === '/sync');
    for (const layer of route.route.stack) {
      let next = false;
      await layer.handle(req, res, () => { next = true; });
      if (!next) break;
    }
    return res;
  }
  async function get() {
    const req = {
      headers: {}, auth: { userType: 'oauth', userId: 'user' },
      params: { userType: 'oauth', userId: 'user', profileId: 'profile-one' },
    };
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.body = JSON.parse(JSON.stringify(data)); return this; } };
    const route = router.stack.find(layer => layer.route?.path === '/sync/:userType/:userId/:profileId?');
    await route.route.stack[0].handle(req, res, () => {});
    return res;
  }
  async function settle() {
    for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
    await Promise.all(locks.values());
  }
  t.after(async () => {
    await settle();
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { router, request, get, settle, warnings, imports, writes: () => writes, read: async () => JSON.parse(await fs.readFile(profilePath, 'utf8')) };
}

function recordingStore({ failWith = null } = {}) {
  const calls = { recordProgress: [], touch: [], hideAll: [], addMarks: [], removeMarks: [] };
  return {
    calls,
    async addMarks(owner, marks) {
      if (failWith) throw failWith;
      calls.addMarks.push(...marks.map(mark => `${mark.mediaType}:${mark.tmdbId}:${mark.season}:${mark.episode}`));
      return marks.length;
    },
    async removeMarks(owner, marks) {
      if (failWith) throw failWith;
      calls.removeMarks.push(...marks.map(mark => `${mark.mediaType}:${mark.tmdbId}:${mark.season}:${mark.episode}`));
      return marks.length;
    },
    async hideAll(owner) {
      if (failWith) throw failWith;
      calls.hideAll.push(owner);
      return 0;
    },
    async recordProgress(owner, entry) {
      if (failWith) throw failWith;
      calls.recordProgress.push({ owner, entry });
    },
    async touch(owner, entry) {
      if (failWith) throw failWith;
      calls.touch.push({ owner, entry });
    },
  };
}

test('un set sur progress_550 est recopié une fois dans l’historique', async t => {
  t.mock.method(console, 'warn', () => {});
  const store = recordingStore();
  const f = await fixture(t, { user_language: 'fr' }, { historyStore: store });
  const value = progress(42, 100, '2026-10-16T10:00:00.000Z');

  const response = await f.request([{ op: 'set', key: 'progress_550', value }]);
  await f.settle();

  assert.equal(response.statusCode, 200);
  assert.equal(store.calls.recordProgress.length, 1);
  assert.deepEqual(plain(store.calls.recordProgress[0].owner), { userType: 'oauth', userId: 'user', profileId: 'profile-one' });
  assert.deepEqual(store.calls.recordProgress[0].entry, {
    mediaType: 'movie', tmdbId: 550, season: 0, episode: 0,
    position: 42, duration: 100, updatedAt: new Date('2026-10-16T10:00:00.000Z'),
  });
  // L'import reçoit les données d'avant les ops, sous son propre verrou.
  assert.equal(f.imports.length, 1);
  const [, , owner, readProfileData] = f.imports[0];
  assert.deepEqual(plain(owner), { userType: 'oauth', userId: 'user', profileId: 'profile-one' });
  assert.deepEqual(plain(await readProfileData('oauth', 'user', 'profile-one')), { user_language: 'fr' });
});

test('une marque « Déjà vu » synchronisée passe par le magasin (ops réelles du site : arrayAdd / arrayRemove / objPatch)', async t => {
  t.mock.method(console, 'warn', () => {});
  const store = recordingStore();
  const f = await fixture(t, {
    watched_movie: JSON.stringify([{ id: 13, type: 'movie' }]),
    watched_episodes_tv_1399: JSON.stringify({ S1E1: true }),
  }, { historyStore: store });

  // Mêmes ops que computeArrayDiffOps / computeObjectPatch de src/App.tsx.
  const response = await f.request([
    { op: 'arrayRemove', key: 'watched_movie', value: { id: 13, type: 'movie' } },
    { op: 'arrayAdd', key: 'watched_movie', value: { id: 550, type: 'movie', title: 'Fight Club', poster_path: '', addedAt: '2026-10-16T08:00:00.000Z' } },
    { op: 'objPatch', key: 'watched_episodes_tv_1399', delta: { set: { S1E2: true }, remove: ['S1E1'] } },
  ]);
  await f.settle();

  assert.equal(response.statusCode, 200);
  assert.deepEqual(store.calls.addMarks.sort(), ['movie:550:0:0', 'tv:1399:1:2']);
  assert.deepEqual(store.calls.removeMarks.sort(), ['movie:13:0:0', 'tv:1399:1:1']);
  assert.equal(store.calls.recordProgress.length + store.calls.touch.length, 0);
});

// Magasin à état pour les marques : ajout lent (le miroir hors verrou
// arrivait après le retrait suivant), retrait et remplacement immédiats.
function markStateStore() {
  const marks = new Set();
  const key = mark => `${mark.mediaType}:${mark.tmdbId}:${mark.season}:${mark.episode}`;
  return {
    marks,
    async addMarks(owner, list) {
      await new Promise(resolve => setTimeout(resolve, 30));
      for (const mark of list) marks.add(key(mark));
      return list.length;
    },
    async removeMarks(owner, list) {
      for (const mark of list) marks.delete(key(mark));
      return list.length;
    },
    async replaceMarks(owner, list) {
      marks.clear();
      for (const mark of list) marks.add(key(mark));
      return list.length;
    },
    async recordProgress() {},
    async touch() {},
    async hide() {},
    async hideAll() { return 0; },
  };
}

test('deux POST, marquer puis démarquer : la base finit démarquée, quel que soit le délai d’écriture', async t => {
  t.mock.method(console, 'warn', () => {});
  const store = markStateStore();
  const f = await fixture(t, { watched_movie: '[]' }, { historyStore: store });

  const marked = await f.request([{ op: 'arrayAdd', key: 'watched_movie', value: { id: 550, type: 'movie' } }]);
  const unmarked = await f.request([{ op: 'arrayRemove', key: 'watched_movie', value: { id: 550, type: 'movie' } }]);
  await f.settle();
  await new Promise(resolve => setTimeout(resolve, 60));

  assert.equal(marked.statusCode, 200);
  assert.equal(unmarked.statusCode, 200);
  assert.deepEqual([...store.marks], []);
});

test('marques écrites sous le verrou de synchro : une erreur du magasin ne fait pas échouer la synchro', async t => {
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => { warnings.push(args.join(' ')); });
  const f = await fixture(t, { watched_movie: '[]' }, { historyStore: recordingStore({ failWith: new Error('SQL en panne') }) });
  const response = await f.request([{ op: 'arrayAdd', key: 'watched_movie', value: { id: 550, type: 'movie' } }]);
  // Échec logué avant la réponse : l'écriture a bien été attendue sous le verrou.
  assert.equal(response.statusCode, 200);
  assert.ok(warnings.some(line => line.includes('[HISTORY]') && line.includes('watched_movie')));
});

test('ensureProfileMarks : marques recalées une fois par profil et par worker, retentées après un échec', async t => {
  t.mock.method(console, 'warn', () => {});
  const store = markStateStore();
  let replaces = 0;
  let failNext = true;
  const replace = store.replaceMarks;
  store.replaceMarks = async (...args) => {
    replaces++;
    if (failNext) { failNext = false; throw new Error('SQL en panne'); }
    return replace(...args);
  };
  const f = await fixture(t, { watched_movie: JSON.stringify([{ id: 13, type: 'movie' }]) }, { historyStore: store });
  const owner = { userType: 'oauth', userId: 'user', profileId: 'profile-one' };

  // Échec : faux, logué, rien de retenu.
  assert.equal(await f.router.ensureProfileMarks(owner), false);
  assert.ok(f.warnings.some(line => line.includes('[HISTORY]')));
  // Appel suivant : nouvel essai, réussi.
  assert.equal(await f.router.ensureProfileMarks(owner), true);
  assert.deepEqual([...store.marks], ['movie:13:0:0']);
  // Ensuite : déjà vérifié, plus de relecture.
  assert.equal(await f.router.ensureProfileMarks(owner), true);
  assert.equal(replaces, 2);
});

test('ancienne clé watched_tv_episodes : recalée avec les autres, retrait ignoré si l’épisode reste marqué ailleurs', async t => {
  t.mock.method(console, 'warn', () => {});
  const store = markStateStore();
  const legacy = (id, season, episode) => ({ id, type: 'tv', title: 'S', poster_path: '', episodeInfo: { season, episode }, addedAt: '2026-01-10T20:00:00.000Z' });
  const f = await fixture(t, {
    watched_tv_episodes: JSON.stringify([legacy(1399, 1, 1), legacy(94605, 2, 3)]),
    watched_episodes_tv_1399: JSON.stringify({ S1E1: true, S1E2: true }),
  }, { historyStore: store });
  const owner = { userType: 'oauth', userId: 'user', profileId: 'profile-one' };

  await f.router.resyncProfileMarks(owner);
  assert.deepEqual([...store.marks].sort(), ['tv:1399:1:1', 'tv:1399:1:2', 'tv:94605:2:3']);

  // Retrait de l'ancienne clé (comme le site, arrayRemove) : S1E1 reste
  // marqué par watched_episodes_tv_1399, 94605 S2E3 part.
  await f.request([
    { op: 'arrayRemove', key: 'watched_tv_episodes', value: legacy(1399, 1, 1) },
    { op: 'arrayRemove', key: 'watched_tv_episodes', value: legacy(94605, 2, 3) },
  ]);
  await f.settle();
  assert.deepEqual([...store.marks].sort(), ['tv:1399:1:1', 'tv:1399:1:2']);
});

test('deleteTitleFromProfile : fichier nettoyé et base effacée sous le verrou ; un recalage ne fait pas revenir le titre', async t => {
  t.mock.method(console, 'warn', () => {});
  const store = markStateStore();
  const deleted = [];
  store.deleteTitle = async (owner, mediaType, tmdbId) => { deleted.push(`${mediaType}:${tmdbId}`); };
  const f = await fixture(t, {
    user_language: 'fr',
    progress_tv_1399_s1_e1: progress(10, 100, '2026-10-10T10:00:00.000Z'),
    progress_550: progress(10, 100, '2026-10-10T10:00:00.000Z'),
    continueWatching: JSON.stringify({ movies: [{ id: 550 }], tv: [{ id: 1399, currentEpisode: { season: 1, episode: 1 } }] }),
    watched_tv: JSON.stringify([{ id: 1399, type: 'tv' }]),
    watched_episodes_tv_1399: JSON.stringify({ S1E1: true }),
    watched_tv_episodes: JSON.stringify([{ id: 1399, type: 'tv', episodeInfo: { season: 1, episode: 2 } }]),
    watched_movie: JSON.stringify([{ id: 550, type: 'movie' }]),
  }, { historyStore: store });
  const owner = { userType: 'oauth', userId: 'user', profileId: 'profile-one' };

  await f.router.deleteTitleFromProfile(owner, 'tv', 1399);

  const saved = await f.read();
  assert.deepEqual(Object.keys(saved).sort(), ['continueWatching', 'progress_550', 'user_language', 'watched_movie', 'watched_tv', 'watched_tv_episodes']);
  assert.deepEqual(JSON.parse(saved.continueWatching), { movies: [{ id: 550 }], tv: [] });
  assert.deepEqual(JSON.parse(saved.watched_tv), []);
  assert.deepEqual(JSON.parse(saved.watched_tv_episodes), []);
  assert.deepEqual(deleted, ['tv:1399']);

  // Recalage des marques depuis le fichier : rien ne revient pour 1399.
  await f.router.resyncProfileMarks(owner);
  assert.deepEqual([...store.marks], ['movie:550:0:0']);

  // Titre absent du fichier : pas d'écriture, la base est quand même nettoyée.
  const writesBefore = f.writes();
  await f.router.deleteTitleFromProfile(owner, 'tv', 1399);
  assert.equal(f.writes(), writesBefore);
  assert.deepEqual(deleted, ['tv:1399', 'tv:1399']);
});

// Magasin à état pour la suppression : titres présents en base, écritures
// de progression retenues par une barrière.
function titleStateStore() {
  const titles = new Set();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const store = {
    titles,
    release: () => release(),
    gated: true,
    async recordProgress(owner, entry) {
      if (store.gated) await gate;
      titles.add(`${entry.mediaType}:${entry.tmdbId}`);
    },
    async touch(owner, entry) { titles.add(`${entry.mediaType}:${entry.tmdbId}`); },
    async hide() {},
    async hideAll() { return 0; },
    async addMarks() { return 0; },
    async removeMarks() { return 0; },
    async replaceMarks() { return { added: 0, removed: 0 }; },
    async deleteTitle(owner, mediaType, tmdbId) { titles.delete(`${mediaType}:${tmdbId}`); },
  };
  return store;
}

test('suppression pendant un miroir de synchro en cours : le titre ne revient pas', async t => {
  t.mock.method(console, 'warn', () => {});
  const store = titleStateStore();
  const f = await fixture(t, { user_language: 'fr' }, { historyStore: store });
  const owner = { userType: 'oauth', userId: 'user', profileId: 'profile-one' };

  // POST : le miroir (lancé sans attente) reste bloqué dans recordProgress.
  await f.request([{ op: 'set', key: 'progress_tv_1399_s1_e1', value: progress(10, 100, '2026-10-16T10:00:00.000Z') }]);
  // Le miroir finit 50 ms après le début de la suppression (bien après son
  // DELETE sans attente).
  setTimeout(() => store.release(), 50);
  await f.router.deleteTitleFromProfile(owner, 'tv', 1399);
  await new Promise(resolve => setTimeout(resolve, 80));
  await f.settle();

  assert.equal(store.titles.has('tv:1399'), false);
});

test('suppression pendant un import en tâche de fond : le titre ne revient pas', async t => {
  t.mock.method(console, 'warn', () => {});
  const store = titleStateStore();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { progress_tv_1399_s1_e1: progress(10, 100, '2026-10-10T10:00:00.000Z') }, {
    historyStore: store,
    // Import lent qui réécrit la progression (données d'avant la suppression).
    ensureImported: async (_pool, historyStore, who) => {
      await gate;
      store.gated = false;
      await historyStore.recordProgress(who, { mediaType: 'tv', tmdbId: 1399, season: 1, episode: 1, position: 10, duration: 100, updatedAt: new Date() });
      return 'imported';
    },
  });
  const owner = { userType: 'oauth', userId: 'user', profileId: 'profile-one' };

  await f.request([{ op: 'set', key: 'user_language', value: 'fr' }]);
  setTimeout(release, 50);
  await f.router.deleteTitleFromProfile(owner, 'tv', 1399);
  await new Promise(resolve => setTimeout(resolve, 80));
  await f.settle();

  assert.equal(store.titles.has('tv:1399'), false);
  assert.equal('progress_tv_1399_s1_e1' in await f.read(), false);
});

test('suppression sur un profil de plus de 600 clés : élagage si l’import est fait, sinon 413 et fichier intact', async t => {
  t.mock.method(console, 'warn', () => {});
  const owner = { userType: 'oauth', userId: 'user', profileId: 'profile-one' };
  const big = () => {
    const profile = { watched_movie: JSON.stringify([{ id: 550, type: 'movie' }]), progress_550: progress(10, 100, 1_600_000_000_000) };
    for (let i = 1; i <= 620; i++) profile[`progress_${100000 + i}`] = progress(10, 100, 1_700_000_000_000 + i * 1000);
    return profile;
  };

  const done = await fixture(t, big(), { historyStore: titleStateStore(), ensureImported: async () => 'already' });
  await done.router.deleteTitleFromProfile(owner, 'movie', 550);
  const saved = await done.read();
  assert.ok(Object.keys(saved).length <= 550);
  assert.equal('progress_550' in saved, false);
  assert.deepEqual(JSON.parse(saved.watched_movie), []);

  for (const status of ['failed', 'deferred']) {
    const blocked = await fixture(t, big(), { historyStore: titleStateStore(), ensureImported: async () => status });
    await assert.rejects(blocked.router.deleteTitleFromProfile(owner, 'movie', 550), (error) => error.status === 413);
    const untouched = await blocked.read();
    assert.equal(Object.keys(untouched).length, 622, status);
    assert.ok('progress_550' in untouched);
  }
});

test('import : les marques viennent du fichier relu sous le verrou de synchro (resyncProfileMarks)', async t => {
  t.mock.method(console, 'warn', () => {});
  const store = markStateStore();
  store.marks.add('movie:550:0:0'); // marque périmée en base
  const f = await fixture(t, {
    watched_movie: JSON.stringify([{ id: 13, type: 'movie' }]),
    watched_episodes_tv_1399: JSON.stringify({ S1E1: true }),
  }, { historyStore: store });
  const owner = { userType: 'oauth', userId: 'user', profileId: 'profile-one' };

  // Import lancé par une synchro : la resynchronisation des marques est
  // passée à ensureImported (lancée seulement après un import réussi).
  await f.request([{ op: 'set', key: 'user_language', value: 'fr' }]);
  await f.settle();
  assert.equal(typeof f.imports[0][4].afterImport, 'function');

  // Resynchro et retrait concurrent : les deux passent par le verrou, la
  // base suit le fichier final.
  await Promise.all([
    f.router.resyncProfileMarks(owner),
    f.request([{ op: 'arrayRemove', key: 'watched_movie', value: { id: 13, type: 'movie' } }]),
  ]);
  await f.settle();
  assert.deepEqual([...store.marks].sort(), ['tv:1399:1:1']);

  // Dans l'autre ordre aussi.
  await Promise.all([
    f.request([{ op: 'objPatch', key: 'watched_episodes_tv_1399', delta: { set: { S1E2: true } } }]),
    f.router.resyncProfileMarks(owner),
  ]);
  await f.settle();
  assert.deepEqual([...store.marks].sort(), ['tv:1399:1:1', 'tv:1399:1:2']);
});

test('désactiver l’historique (remove continueWatching + réglage à true) vide la rangée du serveur', async t => {
  t.mock.method(console, 'warn', () => {});
  const store = recordingStore();
  const f = await fixture(t, {
    settings_disable_history: 'false',
    continueWatching: JSON.stringify({ movies: [{ id: 550 }] }),
  }, { historyStore: store });

  const response = await f.request([
    { op: 'set', key: 'settings_disable_history', value: 'true' },
    { op: 'remove', key: 'continueWatching' },
  ]);
  await f.settle();

  assert.equal(response.statusCode, 200);
  assert.equal(store.calls.hideAll.length, 1);
  assert.deepEqual(plain(store.calls.hideAll[0]), { userType: 'oauth', userId: 'user', profileId: 'profile-one' });
});

test('deleteProfileHistory efface l’historique du profil et n’échoue jamais', async t => {
  const deleted = [];
  const f = await fixture(t, {}, {
    historyStore: { async deleteProfile(owner) { deleted.push(plain(owner)); } },
  });
  await f.router.deleteProfileHistory('oauth', 'user', 'profile-one');
  assert.deepEqual(deleted, [{ userType: 'oauth', userId: 'user', profileId: 'profile-one' }]);

  const failing = await fixture(t, {}, {
    historyStore: { async deleteProfile() { throw new Error('SQL en panne'); } },
  });
  await assert.doesNotReject(failing.router.deleteProfileHistory('oauth', 'user', 'profile-one'));
});

test('un magasin d’historique qui lève ne change pas la réponse 200', async t => {
  t.mock.method(console, 'warn', () => {});
  const store = recordingStore({ failWith: new Error('SQL en panne') });
  const f = await fixture(t, { user_language: 'fr' }, {
    historyStore: store,
    ensureImported: async () => { throw new Error('import en panne'); },
  });

  const response = await f.request([{ op: 'set', key: 'progress_550', value: progress(42, 100, '2026-10-16T10:00:00.000Z') }]);
  await f.settle();

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.deepEqual(await f.read(), { user_language: 'fr', progress_550: progress(42, 100, '2026-10-16T10:00:00.000Z') });
  assert.ok(f.warnings.some(line => line.includes('[HISTORY]')), 'l’échec de l’import est logué');
});

test('un profil de 600 clés accepte une nouvelle clé : les plus vieilles progress_* sont élaguées', async t => {
  t.mock.method(console, 'warn', () => {});
  const store = recordingStore();
  const profile = {};
  for (let i = 1; i <= 600; i++) profile[`progress_${i}`] = progress(10, 100, 1_700_000_000_000 + i * 1000);
  const f = await fixture(t, profile, { historyStore: store });

  const response = await f.request([{ op: 'set', key: 'user_language', value: 'en' }]);
  await f.settle();

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.stats.profileKeyCount, 550);
  const saved = await f.read();
  assert.equal(Object.keys(saved).length, 550);
  assert.equal(saved.user_language, 'en');
  assert.equal(saved.progress_51, undefined);
  assert.ok(saved.progress_52);
  assert.ok(saved.progress_600);
});

test('un fichier déjà au-delà de 600 clés est élagué à la lecture au lieu de répondre 413', async t => {
  t.mock.method(console, 'warn', () => {});
  const store = recordingStore();
  const profile = {};
  for (let i = 1; i <= 620; i++) profile[`progress_${i}`] = progress(10, 100, 1_700_000_000_000 + i * 1000);
  const f = await fixture(t, profile, { historyStore: store });

  const response = await f.request([]);
  await f.settle();

  assert.equal(response.statusCode, 200);
  assert.equal(Object.keys(await f.read()).length, 550);
  // L'import reçoit le profil complet, d'avant l'élagage.
  const [, , , readProfileData] = f.imports[0];
  assert.equal(Object.keys(await readProfileData()).length, 620);
});

test('un GET sur un fichier de 620 clés répond 200 sans jamais réécrire le fichier élagué', async t => {
  t.mock.method(console, 'warn', () => {});
  const profile = {};
  for (let i = 1; i <= 620; i++) profile[`progress_${i}`] = progress(10, 100, 1_700_000_000_000 + i * 1000);
  const f = await fixture(t, profile, { historyStore: recordingStore() });

  const response = await f.get();
  await f.settle();

  assert.equal(response.statusCode, 200);
  assert.equal(Object.keys(response.body.data).filter(key => key.startsWith('progress_')).length, 550);
  assert.equal(f.writes(), 0);
  assert.equal(Object.keys(await f.read()).length, 620);
});

test('import en échec : pas d’élagage, la limite répond 413 comme avant et le fichier reste entier', async t => {
  t.mock.method(console, 'warn', () => {});
  const profile = {};
  for (let i = 1; i <= 600; i++) profile[`progress_${i}`] = progress(10, 100, 1_700_000_000_000 + i * 1000);
  const f = await fixture(t, profile, {
    historyStore: recordingStore(),
    ensureImported: async () => 'failed',
  });

  const response = await f.request([{ op: 'set', key: 'user_language', value: 'en' }]);
  await f.settle();

  assert.equal(response.statusCode, 413);
  assert.equal(response.body.code, 'TOO_MANY_KEYS');
  assert.equal(f.writes(), 0);
  assert.equal(Object.keys(await f.read()).length, 600);
});

test('import remis à plus tard (aucune place) : pas d’élagage non plus', async t => {
  t.mock.method(console, 'warn', () => {});
  const profile = {};
  for (let i = 1; i <= 620; i++) profile[`progress_${i}`] = progress(10, 100, 1_700_000_000_000 + i * 1000);
  const f = await fixture(t, profile, {
    historyStore: recordingStore(),
    ensureImported: async () => 'deferred',
  });

  const response = await f.request([]);
  await f.settle();

  assert.equal(response.statusCode, 413);
  assert.equal(f.writes(), 0);
  assert.equal(Object.keys(await f.read()).length, 620);
});
