const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const policy = require('../../utils/syncPolicy');
const { createAccountDataCache } = require('../../utils/accountDataCache');

async function fixture(t, profile = { user_language: 'fr' }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'movix-sync-perf-'));
  const usersDir = path.join(dir, 'data', 'users');
  const accountPath = policy.getUserDataFilePath({ usersDir }, 'oauth', 'user');
  const profilePath = policy.getProfileFilePath(usersDir, 'oauth', 'user', 'profile-one');
  await fs.mkdir(path.dirname(profilePath), { recursive: true });
  await fs.writeFile(accountPath, JSON.stringify({ profiles: [{ id: 'profile-one', avatar: '/avatars/test.png' }] }));
  await fs.writeFile(profilePath, JSON.stringify(profile));
  let serial = Promise.resolve();
  let writes = 0;
  let lockedWrites = 0;
  let validations = 0;
  const accountCache = createAccountDataCache();
  const filename = path.resolve(__dirname, '../sync.js');
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  const stubs = {
    '../middleware/auth': { getAuthIfValid: async req => req.auth },
    '../mysqlPool': {
      getPool: () => ({}),
      withMysqlAdvisoryLock: async (_pool, _name, task) => {
        const current = serial.then(task);
        serial = current.catch(() => {});
        return current;
      },
    },
    '../utils/accountDataCache': { readAccountData: accountCache.read },
    '../utils/syncPolicy': {
      ...policy,
      sanitizeProfileData: data => { validations++; return policy.sanitizeProfileData(data); },
    },
    '../utils/safeFile': {
      async safeWriteFile(target, data) { writes++; await fs.writeFile(target, data); return true; },
      async safeWriteJsonFile(target, data) { writes++; await fs.writeFile(target, JSON.stringify(data)); return true; },
    },
    // Écritures faites sous le verrou du profil (sans verrou Redis).
    'write-file-atomic': async (target, data) => { writes++; lockedWrites++; await fs.writeFile(target, data); },
    '../utils/discord': { logSyncErrorToDiscord: async () => {} },
    '../utils/redisRateLimitStore': { createRedisRateLimitStore: () => ({}) },
    'express-rate-limit': Object.assign(() => (_req, _res, next) => next(), { ipKeyGenerator: value => value }),
  };
  vm.runInNewContext(await fs.readFile(filename, 'utf8'), {
    module, exports: module.exports, __dirname: path.join(dir, 'routes'),
    require: request => request in stubs ? stubs[request] : localRequire(request),
    Buffer, structuredClone, setInterval, clearInterval, setTimeout, clearTimeout,
    process: { on() {} }, console: { log() {}, warn() {}, error() {} },
  }, { filename });
  const router = module.exports;
  async function request(ops, { userType = 'oauth', userId = 'user', profileId = 'profile-one', auth = { userType: 'oauth', userId: 'user' } } = {}) {
    const req = { headers: {}, auth, body: { userType, userId, profileId, ops } };
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.body = JSON.parse(JSON.stringify(data)); return this; } };
    const route = router.stack.find(layer => layer.route?.path === '/sync');
    for (const layer of route.route.stack) {
      let next = false;
      await layer.handle(req, res, () => { next = true; });
      if (!next) break;
    }
    return res;
  }
  t.after(async () => {
    await serial;
    // Attendre aussi un éventuel nettoyage lancé par une route de lecture.
    await new Promise(resolve => setImmediate(resolve));
    await serial;
    await fs.rm(dir, { recursive: true, force: true });
  });
  return {
    router, request, accountPath, profilePath,
    read: async () => JSON.parse(await fs.readFile(profilePath, 'utf8')),
    counts: () => ({ writes, validations }),
    lockedWrites: () => lockedWrites,
  };
}

test('une sync sans changement évite toute écriture et toute validation en double', async t => {
  const f = await fixture(t);
  const response = await f.request([
    { op: 'set', key: 'user_language', value: 'fr' },
    { op: 'remove', key: 'favorite_movies' },
  ]);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.stats.profileBytes, Buffer.byteLength('{"user_language":"fr"}'));
  assert.deepEqual(f.counts(), { writes: 0, validations: 1 });
});

test('des opérations qui s’annulent ne réécrivent pas le profil', async t => {
  const f = await fixture(t);
  await f.request([
    { op: 'set', key: 'user_language', value: 'en' },
    { op: 'set', key: 'user_language', value: 'fr' },
  ]);
  assert.equal(f.counts().writes, 0);
});

test('une modification est validée puis écrite une fois, avec les quotas exacts', async t => {
  const f = await fixture(t);
  const response = await f.request([{ op: 'set', key: 'user_language', value: 'en' }]);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(await f.read(), { user_language: 'en' });
  assert.deepEqual(f.counts(), { writes: 1, validations: 2 });
});

test('un ajout déjà présent dans une liste ne réécrit pas le fichier', async t => {
  const f = await fixture(t, { favorite_movies: '[{"type":"movie","id":42}]' });
  await f.request([{ op: 'arrayAdd', key: 'favorite_movies', value: { type: 'movie', id: 42 } }]);
  assert.equal(f.counts().writes, 0);
});

test('le nettoyage de données anciennes reste écrit même sans opération', async t => {
  const f = await fixture(t, { user_language: 'fr', auth: 'obsolete' });
  const response = await f.request([]);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(await f.read(), { user_language: 'fr' });
  assert.equal(f.counts().writes, 1);
});

function progressAt(position, seconds) {
  return JSON.stringify({ position, timestamp: new Date(Date.parse('2026-10-19T10:00:00.000Z') + seconds * 1000).toISOString(), duration: 3600 });
}

test('un lecteur en pause qui renvoie la même position ne réécrit pas le profil', async t => {
  const stored = progressAt(600, 0);
  const f = await fixture(t, { user_language: 'fr', progress_550: stored });
  // Ops réelles du site : objPatch du seul horodatage, ou valeur complète.
  const patch = await f.request([{ op: 'objPatch', key: 'progress_550', delta: { set: { timestamp: JSON.parse(progressAt(600, 10)).timestamp } } }]);
  const set = await f.request([{ op: 'set', key: 'progress_550', value: progressAt(602, 20) }]);
  assert.equal(patch.statusCode, 200);
  assert.equal(set.statusCode, 200);
  assert.equal(f.counts().writes, 0);
  assert.equal((await f.read()).progress_550, stored);
});

test('une position qui avance est écrite une fois, sous le verrou du profil et sans verrou Redis', async t => {
  const f = await fixture(t, { user_language: 'fr', progress_550: progressAt(600, 0) });
  const response = await f.request([{ op: 'objPatch', key: 'progress_550', delta: { set: { position: 630, timestamp: JSON.parse(progressAt(630, 30)).timestamp } } }]);
  assert.equal(response.statusCode, 200);
  assert.equal(f.counts().writes, 1);
  assert.equal(f.lockedWrites(), 1);
  assert.equal(JSON.parse((await f.read()).progress_550).position, 630);
});

test('un autre profil, compte ou type d’authentification ne peut pas être modifié', async t => {
  const f = await fixture(t);
  const ops = [{ op: 'set', key: 'user_language', value: 'en' }];
  assert.equal((await f.request(ops, { profileId: 'profile-two' })).statusCode, 404);
  assert.equal((await f.request(ops, { userId: 'another' })).statusCode, 401);
  assert.equal((await f.request(ops, { userType: 'bip39' })).statusCode, 401);
  assert.equal((await f.request(ops, { auth: null })).statusCode, 401);
  assert.equal(f.counts().writes, 0);
});

test('les clés interdites et les valeurs trop grandes sont toujours refusées', async t => {
  const f = await fixture(t);
  assert.equal((await f.request([{ op: 'set', key: 'auth', value: 'bad' }])).statusCode, 400);
  assert.equal((await f.request([{ op: 'set', key: 'user_language', value: 'x'.repeat(policy.SYNC_LIMITS.maxStringValueBytes + 1) }])).statusCode, 413);
  assert.equal(f.counts().writes, 0);
});

test('le quota du profil est contrôlé après application des opérations', async t => {
  const f = await fixture(t, Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`progress_${i}`, 'x'.repeat(250_000)])));
  const response = await f.request([{ op: 'set', key: 'progress_extra', value: 'x'.repeat(250_000) }]);
  assert.equal(response.statusCode, 413);
  assert.equal(response.body.code, 'PROFILE_QUOTA_EXCEEDED');
  assert.equal(f.counts().writes, 0);
});

test('deux sync concurrentes conservent les deux modifications sous le verrou', async t => {
  const f = await fixture(t);
  const responses = await Promise.all([
    f.request([{ op: 'set', key: 'user_language', value: 'en' }]),
    f.request([{ op: 'set', key: 'snow_enabled', value: 'false' }]),
  ]);
  assert.ok(responses.every(response => response.statusCode === 200));
  assert.deepEqual(await f.read(), { user_language: 'en', snow_enabled: 'false' });
});

test('le cache de compte ne partage pas les mutations entre appelants', async t => {
  const f = await fixture(t);
  const first = await f.router.readUserData('oauth', 'user');
  first.profiles[0].id = 'other';
  const second = await f.router.readUserData('oauth', 'user');
  assert.equal(second.profiles[0].id, 'profile-one');
  await fs.writeFile(f.accountPath, JSON.stringify({ profiles: [] }));
  assert.equal((await f.request([])).statusCode, 404);
});

test('le nettoyage d’un GET attend le verrou et ne remplace pas une sync plus récente', async t => {
  const f = await fixture(t, { user_language: 'fr', auth: 'obsolete' });
  let release;
  let entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const held = f.router.withProfileSyncLock('oauth', 'user', 'profile-one', async () => {
    entered();
    await gate;
  });
  await started;
  const post = f.request([{ op: 'set', key: 'user_language', value: 'en' }]);
  await new Promise(resolve => setImmediate(resolve));
  try {
    const oldSnapshot = await f.router.readProfileData('oauth', 'user', 'profile-one');
    assert.equal(oldSnapshot.user_language, 'fr');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.counts().writes, 0, 'le nettoyage ne contourne pas le verrou');
  } finally {
    release();
  }
  await held;
  assert.equal((await post).statusCode, 200);
  await f.router.withProfileSyncLock('oauth', 'user', 'profile-one', async () => {});
  assert.deepEqual(await f.read(), { user_language: 'en' });
  assert.equal(f.counts().writes, 1, 'le nettoyage recharge le profil déjà nettoyé par le POST');
});
