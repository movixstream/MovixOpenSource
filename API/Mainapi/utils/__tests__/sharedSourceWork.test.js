'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSharedSourceWork, createSharedSourceLookup } = require('../sharedSourceWork');

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const tick = () => new Promise(setImmediate);

// Transport Redis en mémoire : SET NX, TTL et scripts conditionnés par le jeton.
// Deux instances indépendantes du helper partagent uniquement ce transport.
function redisFixture() {
  const values = new Map();
  const get = key => {
    const entry = values.get(key);
    if (!entry || entry.until <= Date.now()) { values.delete(key); return null; }
    return entry.raw;
  };
  const set = (key, raw, ...args) => {
    if (args.includes('NX') && get(key) !== null) return null;
    const ttl = args.includes('PX') ? Number(args[args.indexOf('PX') + 1]) : Infinity;
    values.set(key, { raw, until: Date.now() + ttl });
    return 'OK';
  };
  return {
    status: 'ready', values,
    async get(key) { return get(key); },
    async set(...args) { return set(...args); },
    async eval(script, count, ...args) {
      const keys = args.slice(0, count), argv = args.slice(count);
      if (get(keys[0]) !== argv[0]) return 0;
      if (script.includes('pexpire')) { values.get(keys[0]).until = Date.now() + Number(argv[1]); return 1; }
      if (script.includes('"set"')) return set(keys[1], argv[1], 'PX', argv[2]);
      assert.ok(script.includes('"del"'));
      values.delete(keys[0]);
      return 1;
    },
  };
}

test('deux workers et vingt appelants partagent une recherche, puis son résultat parsé', async () => {
  const redis = redisFixture();
  const options = { redis, namespace: 'search', pollMs: 2 };
  const workers = [createSharedSourceLookup(options), createSharedSourceLookup(options)];
  const gate = deferred(), began = deferred();
  let calls = 0;
  const loader = async () => { calls++; began.resolve(); await gate.promise; return { url: 'https://source.test/serie' }; };
  const first = workers[0].load(['Serie', '2012', 'tv'], loader);
  await began.promise;
  const others = Array.from({ length: 19 }, (_, i) => workers[i % 2].load(['Serie', '2012', 'tv'], loader));
  await tick();
  gate.resolve();
  const results = await Promise.all([first, ...others]);
  assert.equal(calls, 1);
  assert.ok(results.every(result => result.url === 'https://source.test/serie'));
  results[0].url = 'modified-by-caller';
  assert.equal((await createSharedSourceLookup(options).load(['Serie', '2012', 'tv'], loader)).url, 'https://source.test/serie');
  await workers[1].load(['Serie', '1985', 'tv'], loader);
  assert.equal(calls, 2, 'une autre année doit être recherchée séparément');
});

test('une panne est partagée sans conserver la réponse Axios ni créer de faux résultat vide', async () => {
  const redis = redisFixture();
  const options = { redis, namespace: 'search', pollMs: 2 };
  const error = Object.assign(new Error('source indisponible'), {
    code: 'UPSTREAM_FAILURE', httpStatus: 503, response: { data: 'large-html'.repeat(10000) }, config: { token: 'fixture-secret' },
  });
  let calls = 0;
  const loader = async () => { calls++; throw error; };
  await assert.rejects(createSharedSourceLookup(options).load(['Serie'], loader), value => value === error);
  await assert.rejects(createSharedSourceLookup(options).load(['Serie'], loader), value =>
    value.code === 'UPSTREAM_FAILURE' && value.httpStatus === 503 && !value.response && !value.config);
  assert.equal(calls, 1);
  const stored = [...redis.values.values()].map(value => value.raw).join('');
  assert.ok(stored.length < 1024);
  assert.equal(stored.includes('fixture-secret'), false);
  assert.equal([...redis.values.keys()].some(key => key.endsWith(':value')), false);
});

test('un ancien propriétaire ne peut ni remplacer le résultat du nouveau worker ni publier un échec', async () => {
  const redis = redisFixture();
  const options = { redis, namespace: 'search', pollMs: 2 };
  const gate = deferred(), began = deferred();
  const old = createSharedSourceLookup(options).load(['Serie'], async () => {
    began.resolve(); await gate.promise; return 'ancien';
  });
  const rejection = assert.rejects(old, { code: 'SOURCE_REFRESH_UNAVAILABLE' });
  await began.promise;
  for (const key of redis.values.keys()) if (key.endsWith(':lock')) redis.values.delete(key);
  assert.equal(await createSharedSourceLookup(options).load(['Serie'], async () => 'récent'), 'récent');
  gate.resolve();
  await rejection;
  assert.equal(await createSharedSourceLookup(options).load(['Serie'], () => assert.fail('résultat déjà partagé')), 'récent');
  assert.equal([...redis.values.keys()].some(key => key.endsWith(':failure')), false);
});

test('une perte du verrou au moment de publier est aussi détectée atomiquement', async () => {
  const redis = redisFixture();
  const original = redis.eval.bind(redis);
  redis.eval = async (script, count, ...args) => {
    if (count === 2 && args[1].endsWith(':value')) redis.values.delete(args[0]);
    return original(script, count, ...args);
  };
  await assert.rejects(createSharedSourceLookup({ redis, namespace: 'search' }).load(['Serie'], async () => 'ancien'),
    { code: 'SOURCE_REFRESH_UNAVAILABLE' });
  assert.equal([...redis.values.keys()].some(key => key.endsWith(':value')), false);
});

test('Redis déconnecté conserve un repli local borné et les petits caches respectent leur budget', async () => {
  const redis = { status: 'reconnecting', get() { assert.fail('ne pas alimenter la file Redis hors ligne'); } };
  const work = createSharedSourceWork({ redis, namespace: 'refresh', maxInFlight: 1 });
  const gate = deferred(), began = deferred();
  let calls = 0;
  const loader = async () => { calls++; began.resolve(); return gate.promise; };
  const first = work.run('A', loader);
  await began.promise;
  const duplicate = work.run('A', loader);
  try {
    await assert.rejects(work.run('B', loader), { code: 'SOURCE_REFRESH_UNAVAILABLE' });
  } finally { gate.resolve('ready'); }
  assert.deepEqual(await Promise.all([first, duplicate]), ['ready', 'ready']);
  assert.equal(calls, 1);
  const cache = createSharedSourceLookup({ redis, namespace: 'local', maxEntries: 1 });
  const search = async () => ++calls;
  assert.equal(await cache.load(['A'], search), 2);
  assert.equal(await cache.load(['A'], search), 2);
  assert.equal(await cache.load(['B'], search), 3);
  assert.equal(await cache.load(['A'], search), 4);
});
