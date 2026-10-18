const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');

// DELETE /api/profiles/:profileId efface aussi l'historique du profil, et une
// panne de l'historique ne fait jamais échouer la suppression.

const PROFILE_ID = '11111111-2222-4333-8444-555555555555';
const OTHER_PROFILE_ID = '99999999-2222-4333-8444-555555555555';

const state = { historyDeletes: [], userWrites: 0 };

const routesDir = path.resolve(__dirname, '..');
const mainDir = path.resolve(routesDir, '..');
const stubs = {
  [path.join(mainDir, 'middleware/auth.js')]: {
    getAuthIfValid: async () => ({ userType: 'bip39', userId: 'user-bob' }),
  },
  [path.join(mainDir, 'mysqlPool.js')]: {
    getPool: () => ({ execute: async () => [{ affectedRows: 0 }, []] }),
  },
  [path.join(routesDir, 'sync.js')]: {
    USERS_DIR: path.join(mainDir, '__no_such_dir__'),
    readUserData: async () => ({
      profiles: [
        { id: PROFILE_ID, name: 'Bob', isDefault: true },
        { id: OTHER_PROFILE_ID, name: 'Enfant' },
      ],
    }),
    writeUserData: async () => { state.userWrites++; return true; },
    deleteProfileHistory: async (userType, userId, profileId) => {
      state.historyDeletes.push({ userType, userId, profileId });
    },
  },
};

const snapshots = [];
for (const [resolved, exports] of Object.entries(stubs)) {
  snapshots.push([resolved, require.cache[resolved]]);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const routePath = path.join(routesDir, 'profiles.js');
delete require.cache[routePath];
const router = require(routePath);

let server;
let baseUrl;

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/profiles', router);
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/profiles`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  for (const [resolved, previous] of snapshots) {
    if (previous) require.cache[resolved] = previous;
    else delete require.cache[resolved];
  }
  delete require.cache[routePath];
});

test('supprimer un profil efface aussi son historique', async () => {
  const response = await fetch(`${baseUrl}/${OTHER_PROFILE_ID}`, { method: 'DELETE' });

  assert.equal(response.status, 200);
  assert.equal(state.userWrites, 1);
  assert.deepEqual(state.historyDeletes, [{ userType: 'bip39', userId: 'user-bob', profileId: OTHER_PROFILE_ID }]);
});
