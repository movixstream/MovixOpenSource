const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');

// Routes OAuth qui écrivent le fichier d'un profil ou le suppriment :
// - une modification part toujours des données complètes du fichier, jamais
//   de la vue élaguée en mémoire d'un profil au-delà de 600 clés ;
// - la suppression d'un profil efface aussi son historique (au mieux).

const PROFILE_ID = '11111111-2222-4333-8444-555555555555';
const OTHER_PROFILE_ID = '99999999-2222-4333-8444-555555555555';
const TOKEN_RECORD = {
  clientId: 'client-test', userType: 'oauth', userId: 'user-alice',
  scopes: ['lists.create', 'profile.manage', 'history.add'],
};

function bigProfile(count) {
  const data = {};
  for (let i = 1; i <= count; i++) data[`progress_${i}`] = JSON.stringify({ position: 1, duration: 2, timestamp: i });
  return data;
}

const state = {
  full: bigProfile(620),
  writes: [],
  userWrites: [],
  historyDeletes: [],
  markChanges: [],
};

const routesDir = path.resolve(__dirname, '..');
const mainDir = path.resolve(routesDir, '..');
const stubs = {
  [path.join(mainDir, 'middleware/auth.js')]: { getAuthIfValid: async () => null },
  [path.join(mainDir, 'mysqlPool.js')]: {
    getPool: () => ({ execute: async () => [{ affectedRows: 0 }, []], query: async () => [[], []] }),
    withMysqlAdvisoryLock: async (_pool, _name, task) => task(),
  },
  [path.join(mainDir, 'config/redis.js')]: { redis: { status: 'end' } },
  [path.join(mainDir, 'utils/redisRateLimitStore.js')]: { createRedisRateLimitStore: () => ({}) },
  [require.resolve('express-rate-limit')]: Object.assign(() => (_req, _res, next) => next(), { ipKeyGenerator: (ip) => ip }),
  [path.join(mainDir, 'utils/oauthClientsDb.js')]: {
    recordEvent: async () => {},
    grantVip: async () => {},
    getCachedClients: () => [],
  },
  [path.join(mainDir, 'checkVip.js')]: { verifyAccessKey: async () => ({ vip: false }) },
  [path.join(mainDir, 'utils/vipDonations.js')]: {},
  [path.join(routesDir, 'sync.js')]: {
    USERS_DIR: path.join(mainDir, '__no_such_dir__'),
    readUserData: async () => ({
      profiles: [
        { id: PROFILE_ID, name: 'Alice', isDefault: true },
        { id: OTHER_PROFILE_ID, name: 'Bob' },
      ],
    }),
    writeUserData: async (_type, _id, data) => { state.userWrites.push(data); return true; },
    // Vue élaguée en mémoire, comme readProfileSnapshot au-delà de 600 clés.
    readProfileData: async () => bigProfile(550),
    readProfileImportData: async () => ({ ...state.full }),
    // Comme la vraie écriture : au-delà de 600 clés, refus (413) → false.
    writeProfileData: async (_type, _id, _profileId, data) => {
      state.writes.push(Object.keys(data).length);
      return Object.keys(data).length <= 600;
    },
    withProfileSyncLock: async (_type, _id, _profileId, task) => task(),
    deleteProfileHistory: async (userType, userId, profileId) => {
      state.historyDeletes.push({ userType, userId, profileId });
    },
    applyProfileMarkChanges: async (owner, previousData, nextData) => {
      state.markChanges.push({ owner, before: previousData.watched_movie, after: nextData.watched_movie });
    },
  },
};

const snapshots = [];
for (const [resolved, exports] of Object.entries(stubs)) {
  snapshots.push([resolved, require.cache[resolved]]);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
// Jeton OAuth accepté sans base : seule la lecture du jeton est remplacée.
const storagePath = path.join(mainDir, 'utils/oauthStorage.js');
delete require.cache[storagePath];
const realStorage = require(storagePath);
require.cache[storagePath].exports = { ...realStorage, getAccessTokenRecord: async () => ({ ...TOKEN_RECORD }) };
const routePath = path.join(routesDir, 'oauth.js');
delete require.cache[routePath];
const router = require(routePath);

let server;
let baseUrl;

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/oauth', router);
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/oauth`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  for (const [resolved, previous] of snapshots) {
    if (previous) require.cache[resolved] = previous;
    else delete require.cache[resolved];
  }
  delete require.cache[routePath];
  delete require.cache[storagePath];
});

function call(method, route, body) {
  return fetch(`${baseUrl}${route}`, {
    method,
    headers: { authorization: 'Bearer jeton-oauth', 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

test('profil de 620 clés : une modification OAuth part du fichier complet et n’écrit jamais la vue élaguée', async () => {
  state.writes.length = 0;
  const response = await call('POST', '/lists', { name: 'À voir', profileId: PROFILE_ID });

  // 620 clés + custom_lists : l'écriture est refusée comme avant (pas d'élagage silencieux).
  assert.deepEqual(state.writes, [621]);
  assert.equal(response.status, 500);
});

test('marquer « vu » par OAuth : les marques sont recopiées sous le verrou (avant / après la modification)', async () => {
  const previousFull = state.full;
  state.full = { watched_movie: '[]' };
  state.markChanges.length = 0;
  try {
    const response = await call('POST', '/history', { tmdb_id: 550, media_type: 'movie', title: 'Fight Club', profileId: PROFILE_ID });
    assert.equal(response.status, 200);
    assert.equal(state.markChanges.length, 1);
    const [change] = state.markChanges;
    assert.deepEqual(change.owner, { userType: 'oauth', userId: 'user-alice', profileId: PROFILE_ID });
    assert.equal(change.before, '[]');
    assert.equal(JSON.parse(change.after)[0].id, 550);
  } finally {
    state.full = previousFull;
  }
});

test('suppression OAuth d’un profil : son historique est effacé aussi', async () => {
  state.historyDeletes.length = 0;
  const response = await call('DELETE', `/profiles/${OTHER_PROFILE_ID}`);

  assert.equal(response.status, 200);
  assert.deepEqual(state.historyDeletes, [{ userType: 'oauth', userId: 'user-alice', profileId: OTHER_PROFILE_ID }]);
});
