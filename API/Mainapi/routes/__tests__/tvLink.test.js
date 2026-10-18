const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');

// === Faux Redis en mémoire (TTL sur horloge contrôlée) ===

let clock = 1_000_000;
function createFakeRedis() {
  const store = new Map();
  const live = (key) => {
    const item = store.get(key);
    if (!item) return null;
    if (item.expiresAt !== null && item.expiresAt <= clock) { store.delete(key); return null; }
    return item;
  };
  const fake = {
    status: 'ready',
    failing: false,
    store,
    check() { if (this.failing) throw new Error('Connection is closed.'); },
    async get(key) { this.check(); return live(key)?.value ?? null; },
    async set(key, value, ...args) {
      this.check();
      let expiresAt = null;
      let nx = false;
      for (let i = 0; i < args.length; i++) {
        const flag = String(args[i]).toUpperCase();
        if (flag === 'EX') expiresAt = clock + Number(args[++i]) * 1000;
        else if (flag === 'PX') expiresAt = clock + Number(args[++i]);
        else if (flag === 'NX') nx = true;
      }
      if (nx && live(key)) return null;
      store.set(key, { value: String(value), expiresAt });
      return 'OK';
    },
    async del(key) { this.check(); const had = Boolean(live(key)); store.delete(key); return had ? 1 : 0; },
    async incr(key) {
      this.check();
      const item = live(key);
      const value = Number(item?.value || 0) + 1;
      store.set(key, { value: String(value), expiresAt: item?.expiresAt ?? null });
      return value;
    },
    async expire(key, seconds) { this.check(); const item = live(key); if (!item) return 0; item.expiresAt = clock + seconds * 1000; return 1; },
    async ttl(key) { this.check(); const item = live(key); if (!item) return -2; return item.expiresAt === null ? -1 : Math.ceil((item.expiresAt - clock) / 1000); },
    async pttl(key) { this.check(); const item = live(key); if (!item) return -2; return item.expiresAt === null ? -1 : item.expiresAt - clock; },
    multi() {
      const ops = [];
      const chain = {
        get(key) { ops.push(['get', key]); return chain; },
        del(key) { ops.push(['del', key]); return chain; },
        async exec() {
          fake.check();
          // Exécution d'un bloc, sans await intermédiaire : atomique comme MULTI.
          return ops.map(([op, key]) => {
            if (op === 'get') return [null, live(key)?.value ?? null];
            const had = Boolean(live(key));
            store.delete(key);
            return [null, had ? 1 : 0];
          });
        },
      };
      return chain;
    },
  };
  return fake;
}

const redis = createFakeRedis();

// === Stubs des modules voisins ===

const PROFILE_ID = '11111111-2222-4333-8444-555555555555';
const OTHER_PROFILE_ID = '99999999-2222-4333-8444-555555555555';
const CLIENT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const sessions = [];
const limiterOptions = [];
let createSessionResult = 'session-tv-1';
let vipExpiresAt = null;

const routesDir = path.resolve(__dirname, '..');
const stubs = {
  [path.join(routesDir, '../middleware/auth.js')]: {
    getAuthIfValid: async (req) => {
      const header = req.headers.authorization || '';
      const match = /^Bearer (user-[a-z]+)$/.exec(header);
      return match ? { userType: 'oauth', userId: match[1], sessionId: 'site-session' } : null;
    },
    issueJwt: (userType, userId, sessionId, authMethod) => `jwt.${userType}.${userId}.${sessionId}.${authMethod}`,
  },
  [path.join(routesDir, '../config/redis.js')]: { redis },
  [path.join(routesDir, '../utils/redisRateLimitStore.js')]: { createRedisRateLimitStore: (options) => ({ options }) },
  [require.resolve('express-rate-limit')]: Object.assign((options) => {
    limiterOptions.push(options);
    return (_req, _res, next) => next();
  }, { ipKeyGenerator: (ip) => ip }),
  [path.join(routesDir, 'sync.js')]: {
    readUserData: async (_userType, userId) => ({
      profiles: userId === 'user-alice'
        ? [{ id: PROFILE_ID, name: 'Alice', avatar: '/avatars/a.png', ageRestriction: 12 }]
        : [{ id: OTHER_PROFILE_ID, name: 'Bob', avatar: '/avatars/b.png' }],
    }),
    readProfileData: async () => ({ access_code: '"VIP-TEST"', is_vip: 'true' }),
  },
  [path.join(routesDir, 'authRoutes.js')]: {
    createUserSession: async (userType, userId, req, override) => {
      sessions.push({ userType, userId, override });
      return createSessionResult;
    },
  },
  [path.join(routesDir, 'oauth.js')]: {
    extractStringField: (source, key) => {
      const raw = source?.[key];
      if (typeof raw !== 'string') return '';
      try { const parsed = JSON.parse(raw); return typeof parsed === 'string' ? parsed : raw; } catch { return raw; }
    },
    buildVipIdentity: async (_userData, profileData) => {
      const raw = profileData?.access_code;
      return raw === '"VIP-TEST"'
        ? { active: true, expiresAt: vipExpiresAt, duration: null }
        : { active: false, expiresAt: null, duration: null };
    },
  },
};

const snapshots = [];
for (const [resolved, exports] of Object.entries(stubs)) {
  snapshots.push([resolved, require.cache[resolved]]);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const routePath = path.join(routesDir, 'tvLink.js');
delete require.cache[routePath];
const router = require(routePath);

let server;
let baseUrl;

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/tv/link', router);
  server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/tv/link`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  delete require.cache[routePath];
  for (const [resolved, previous] of snapshots.reverse()) {
    if (previous) require.cache[resolved] = previous;
    else delete require.cache[resolved];
  }
});

test.beforeEach(() => {
  redis.store.clear();
  redis.failing = false;
  redis.status = 'ready';
  sessions.length = 0;
  createSessionResult = 'session-tv-1';
  vipExpiresAt = null;
  clock += 3_600_000;
});

async function call(method, route, { body, token } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

const start = (body = { deviceName: 'Android TV salon', clientId: CLIENT_ID }) => call('POST', '/start', { body });
const poll = (deviceCode) => call('POST', '/poll', { body: { deviceCode } });
const confirm = (userCode, profileId = PROFILE_ID, token = 'user-alice') => call('POST', '/confirm', { body: { userCode, profileId }, token });

test('start → info → confirm → poll : le jeton est remis une seule fois', async () => {
  const started = await start();
  assert.equal(started.status, 200);
  assert.match(started.body.deviceCode, /^[A-Za-z0-9_-]{43}$/);
  assert.match(started.body.userCode, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/);
  assert.equal(started.body.verificationUrl, `https://movix.luxe/tv?code=${started.body.userCode}`);
  assert.equal(started.body.expiresIn, 600);
  assert.equal(started.body.interval, 5);

  // Le deviceCode n'est stocké que haché.
  const keys = [...redis.store.keys()];
  assert.ok(keys.every((key) => !key.includes(started.body.deviceCode)));
  const devKey = keys.find((key) => key.startsWith('tvlink:dev:'));
  assert.match(devKey, /^tvlink:dev:[0-9a-f]{64}$/);
  const entry = JSON.parse(redis.store.get(devKey).value);
  assert.deepEqual(Object.keys(entry).sort(), ['clientId', 'createdAt', 'deviceName', 'lastPollAt', 'status', 'userCode']);
  assert.equal(entry.status, 'pending');
  assert.equal(redis.store.get(`tvlink:code:${started.body.userCode}`).value, devKey.slice('tvlink:dev:'.length));

  assert.deepEqual((await poll(started.body.deviceCode)).body, { status: 'pending' });

  clock += 100_000;
  const info = await call('GET', `/info?code=${started.body.userCode.toLowerCase()}`, { token: 'user-alice' });
  assert.equal(info.status, 200);
  assert.deepEqual(info.body, { deviceName: 'Android TV salon', expiresIn: 500 });

  const confirmed = await confirm(started.body.userCode);
  assert.equal(confirmed.status, 200);
  assert.deepEqual(confirmed.body, { ok: true, deviceName: 'Android TV salon' });
  assert.equal(sessions.length, 1);
  assert.deepEqual(sessions[0].override.device, {
    version: 1, browser: null, browserVersion: null, operatingSystem: null, deviceType: 'tv', name: 'Android TV salon',
  });
  assert.equal(sessions[0].override.clientId, CLIENT_ID);
  assert.equal(redis.store.has(`tvlink:code:${started.body.userCode}`), false);

  // Code déjà confirmé : il ne sert plus.
  const again = await call('GET', `/info?code=${started.body.userCode}`, { token: 'user-alice' });
  assert.equal(again.status, 404);

  clock += 5000;
  const approved = await poll(started.body.deviceCode);
  assert.deepEqual(approved.body, {
    status: 'approved',
    token: 'jwt.oauth.user-alice.session-tv-1.tv',
    userType: 'oauth',
    userId: 'user-alice',
    profileId: PROFILE_ID,
    profile: { id: PROFILE_ID, name: 'Alice', avatar: '/avatars/a.png', ageRestriction: 12 },
    vip: { active: true, expiresAt: null, accessKey: 'VIP-TEST' },
  });

  clock += 5000;
  assert.deepEqual((await poll(started.body.deviceCode)).body, { status: 'expired' });
  assert.equal([...redis.store.keys()].some((key) => key.startsWith('tvlink:dev:')), false);
});

test('clé VIP datée : expiresAt (BIGINT en ms) est remis en date ISO', async () => {
  vipExpiresAt = 1823758332500;
  const { body } = await start();
  assert.equal((await confirm(body.userCode)).status, 200);
  clock += 5000;
  const approved = await poll(body.deviceCode);
  assert.equal(approved.body.status, 'approved');
  assert.deepEqual(approved.body.vip, { active: true, expiresAt: '2027-10-17T07:32:12.500Z', accessKey: 'VIP-TEST' });
});

test('deux appels à moins de 4 s donnent slow_down', async () => {
  const { body } = await start();
  assert.deepEqual((await poll(body.deviceCode)).body, { status: 'pending' });
  clock += 2000;
  assert.deepEqual((await poll(body.deviceCode)).body, { status: 'slow_down' });
  clock += 4000;
  assert.deepEqual((await poll(body.deviceCode)).body, { status: 'pending' });
});

test('liaison expirée ou inconnue : expired, et le code n’est plus valable', async () => {
  const { body } = await start();
  clock += 601_000;
  assert.deepEqual((await poll(body.deviceCode)).body, { status: 'expired' });
  const confirmed = await confirm(body.userCode);
  assert.equal(confirmed.status, 404);
  assert.deepEqual(confirmed.body, { error: 'code_invalid' });

  const unknown = await poll('A'.repeat(43));
  assert.deepEqual(unknown.body, { status: 'expired' });
  assert.equal((await poll('trop-court')).status, 400);
});

test('profil d’un autre compte : 403 profile_not_owned, code toujours utilisable', async () => {
  const { body } = await start();
  const refused = await confirm(body.userCode, OTHER_PROFILE_ID);
  assert.equal(refused.status, 403);
  assert.deepEqual(refused.body, { error: 'profile_not_owned' });
  assert.equal(sessions.length, 0);
  assert.equal((await confirm(body.userCode)).status, 200);
});

test('code invalide : 404 code_invalid', async () => {
  await start();
  const wrong = await confirm('ZZZZZ');
  assert.equal(wrong.status, 404);
  assert.deepEqual(wrong.body, { error: 'code_invalid' });
  const malformed = await confirm('K0O1I');
  assert.equal(malformed.status, 404);
  const info = await call('GET', '/info?code=ZZZZZ', { token: 'user-alice' });
  assert.equal(info.status, 404);
});

test('cinq codes faux en 10 min → 429, même avec un bon code, puis la fenêtre expire', async () => {
  const { body } = await start();
  for (let i = 0; i < 5; i++) {
    assert.equal((await confirm('ZZZZZ')).status, 404);
  }
  const blocked = await confirm(body.userCode);
  assert.equal(blocked.status, 429);
  assert.equal((await call('GET', `/info?code=${body.userCode}`, { token: 'user-alice' })).status, 429);
  // Un autre utilisateur n'est pas touché.
  assert.equal((await call('GET', `/info?code=${body.userCode}`, { token: 'user-bob' })).status, 200);

  clock += 601_000;
  const next = await start();
  assert.equal((await confirm(next.body.userCode)).status, 200);
});

test('sans JWT valide : 401', async () => {
  const { body } = await start();
  assert.equal((await call('GET', `/info?code=${body.userCode}`)).status, 401);
  const confirmed = await call('POST', '/confirm', { body: { userCode: body.userCode, profileId: PROFILE_ID } });
  assert.equal(confirmed.status, 401);
  assert.equal((await call('POST', '/confirm', { body: { userCode: body.userCode, profileId: PROFILE_ID }, token: 'nimporte' })).status, 401);
});

test('Redis absent : 503 sur toutes les routes', async () => {
  const { body } = await start();
  redis.status = 'reconnecting';
  assert.deepEqual(await start(), { status: 503, body: { error: 'service_unavailable' } });
  assert.equal((await poll(body.deviceCode)).status, 503);
  assert.equal((await confirm(body.userCode)).status, 503);
  assert.equal((await call('GET', `/info?code=${body.userCode}`, { token: 'user-alice' })).status, 503);

  redis.status = 'ready';
  redis.failing = true;
  assert.equal((await start()).status, 503);
  assert.equal((await poll(body.deviceCode)).status, 503);
});

test('entrées invalides au start : 400', async () => {
  assert.equal((await start({ deviceName: 'x'.repeat(41), clientId: CLIENT_ID })).status, 400);
  assert.equal((await start({ deviceName: 'TV', clientId: 'pas-un-uuid' })).status, 400);
  assert.equal((await start({ deviceName: 42, clientId: CLIENT_ID })).status, 400);
  const unnamed = await start({ clientId: CLIENT_ID });
  assert.equal(unnamed.status, 200);
  const info = await call('GET', `/info?code=${unnamed.body.userCode}`, { token: 'user-alice' });
  assert.equal(info.body.deviceName, 'Movix TV');
});

test('session impossible à créer : 503 et le code reste utilisable', async () => {
  const { body } = await start();
  createSessionResult = null;
  assert.equal((await confirm(body.userCode)).status, 503);
  createSessionResult = 'session-tv-2';
  assert.equal((await confirm(body.userCode)).status, 200);
});

test('limites par IP du contrat : start 10 / 10 min, poll 40 / min', () => {
  const byPrefix = Object.fromEntries(limiterOptions.map((options) => [options.store.options.prefix, options]));
  assert.equal(byPrefix['rate-limit:tvlink:start:'].max, 10);
  assert.equal(byPrefix['rate-limit:tvlink:start:'].windowMs, 600_000);
  assert.equal(byPrefix['rate-limit:tvlink:poll:'].max, 40);
  assert.equal(byPrefix['rate-limit:tvlink:poll:'].windowMs, 60_000);
  for (const options of limiterOptions) assert.equal(options.passOnStoreError, true);
});
