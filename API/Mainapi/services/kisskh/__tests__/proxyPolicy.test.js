const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const PROXY_A = { type: 'socks5h', host: 'Proxy.Example', port: 1080, auth: 'user:secret' };
const PROXY_B = { type: 'socks5', host: '198.51.100.22', port: 1081 };

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createRedisDouble() {
  const values = new Map();
  const calls = [];
  return {
    calls,
    values,
    async get(key) { calls.push(['get', key]); return values.get(key) ?? null; },
    async mget(...keys) {
      calls.push(['mget', ...keys]);
      return keys.map((key) => values.get(key) ?? null);
    },
    async set(key, value, ...args) {
      calls.push(['set', key, String(value), ...args]);
      values.set(key, String(value));
      return 'OK';
    },
    async eval(script, keyCount, key, now, interval, maxWait) {
      calls.push(['eval', script, keyCount, key, now, interval, maxWait]);
      const requestedAt = Number(now);
      const spacing = Number(interval);
      const current = Number(values.get(key) || 0);
      const slot = Math.max(requestedAt, current);
      if (slot - requestedAt >= Number(maxWait)) return -1;
      values.set(key, String(slot + spacing));
      return slot - requestedAt;
    },
    async del(...keys) {
      calls.push(['del', ...keys]);
      for (const key of keys) values.delete(key);
      return keys.length;
    },
  };
}

function selectionDouble(snapshots = [[PROXY_A]]) {
  let index = 0;
  const calls = { snapshots: [], reserves: [] };
  return {
    calls,
    async getProxyCandidates(options) {
      calls.snapshots.push(options);
      const snapshot = snapshots[Math.min(index, snapshots.length - 1)];
      index += 1;
      return snapshot;
    },
    async reserveProxy(proxy, options) {
      calls.reserves.push([proxy, options]);
      return true;
    },
  };
}

function managerCandidates(pool, reserveProxyWindow) {
  const filename = path.resolve(__dirname, '../../../utils/proxyManager.js');
  const source = fs.readFileSync(filename, 'utf8');
  const declarations = [
    source.match(/const KISSKH_METADATA_PROXY_OPTIONS = Object\.freeze\(\{[\s\S]*?\n\}\);/)?.[0],
    source.match(/function buildProxyRateLimitKey\([\s\S]*?\n\}/)?.[0],
    source.match(/async function getKisskhProxyCandidates\([\s\S]*?\n\}/)?.[0],
  ];
  assert.ok(declarations.every(Boolean));
  const context = {
    crypto: require('node:crypto'), PROXIES: pool, reserveProxyWindow,
    PROXY_RATE_LIMIT_REDIS_PREFIX: 'test:proxy',
  };
  // Isoler les fonctions reelles du demarrage reseau de proxyManager.
  vm.runInNewContext(`${declarations.join('\n')}\nthis.select = getKisskhProxyCandidates;`, context, { filename });
  return context.select;
}

test('the real proxy manager and policy inspect only one available proxy in a 1000-proxy pool', async () => {
  const { createKisskhProxyPolicy } = require('../proxyPolicy');
  const inspected = new Set();
  const proxies = Array.from({ length: 1000 }, (_, index) => ({
    type: 'socks5', port: 1080,
    get host() { inspected.add(index); return `proxy-${index}.example`; },
  }));
  let rotations = 0;
  let reservations = 0;
  const redis = createRedisDouble();
  const policy = createKisskhProxyPolicy({
    redis,
    getProxyCandidates: managerCandidates(proxies, async (_name, length, count) => {
      assert.equal(length, 1000);
      assert.equal(count, 1);
      return 999 + rotations++;
    }),
    reserveProxy: async () => { reservations += 1; return true; },
  });

  assert.equal(await policy.reserve(), proxies[999]);
  assert.deepEqual([...inspected], [999]);
  assert.equal(await policy.reserve(), proxies[0]);
  assert.deepEqual([...inspected], [999, 0]);
  assert.equal(rotations, 2);
  assert.equal(reservations, 2);
  const reads = redis.calls.filter(([command]) => command === 'mget');
  assert.deepEqual(reads.map((call) => call.length - 1), [1, 1]);
});

test('lazy proxy candidates keep their snapshot across pool refreshes and skip duplicate identities', async () => {
  const pool = [PROXY_A, PROXY_A, PROXY_B];
  const select = managerCandidates(pool, async () => 0);
  const candidates = await select();
  pool.splice(0, pool.length, { type: 'socks5', host: 'new.example', port: 1080 });
  assert.deepEqual([...candidates], [PROXY_A, PROXY_B]);
  assert.deepEqual([...(await select())], pool);
});

test('reservations consume one rotated snapshot and atomically space only the selected proxy', async () => {
  const { createKisskhProxyPolicy } = require('../proxyPolicy');
  const selection = selectionDouble([[PROXY_A, PROXY_B], [PROXY_B, PROXY_A]]);
  const policy = createKisskhProxyPolicy({
    redis: createRedisDouble(),
    ...selection,
    now: () => 10_000,
  });
  assert.equal(await policy.reserve(), PROXY_A);
  assert.equal(await policy.reserve(), PROXY_B);
  assert.equal(selection.calls.snapshots.length, 2);
  assert.equal(selection.calls.reserves.length, 2);
  assert.ok(selection.calls.reserves.every(([, options]) => options.minIntervalMs === 1000));
});

test('global metadata slots keep a 100ms floor while rotating distinct proxies', async () => {
  const { createKisskhProxyPolicy } = require('../proxyPolicy');
  const redis = createRedisDouble();
  const sleeps = [];
  const policy = createKisskhProxyPolicy({
    redis,
    ...selectionDouble([[PROXY_A, PROXY_B]]),
    now: () => 10_000,
    async sleep(milliseconds) { sleeps.push(milliseconds); },
  });

  await Promise.all([policy.reserveGlobal(), policy.reserveGlobal(), policy.reserveGlobal()]);

  assert.deepEqual(sleeps, [100, 200]);
  const reservations = redis.calls.filter(([command]) => command === 'eval');
  assert.equal(reservations.length, 3);
  assert.ok(reservations.every((call) => call[3] === 'kisskh:metadata:global:next'));
  assert.deepEqual(reservations.map((call) => Number(call[5])), [100, 100, 100]);
});

test('transport failures quarantine exponentially and cap at 900 seconds', async () => {
  const { createKisskhProxyPolicy } = require('../proxyPolicy');
  const redis = createRedisDouble();
  let clock = 1_000;
  const selection = selectionDouble([[PROXY_A, PROXY_B], [PROXY_A, PROXY_B]]);
  const policy = createKisskhProxyPolicy({
    redis,
    ...selection,
    now: () => clock,
    quarantineBaseMs: 30_000,
    quarantineMaxMs: 900_000,
  });

  await policy.recordFailure(PROXY_A, 'timeout');
  clock = 30_999;
  assert.equal(await policy.reserve(), PROXY_B);
  clock = 31_000;
  assert.equal(await policy.reserve(), PROXY_A);

  for (let failure = 0; failure < 10; failure += 1) await policy.recordFailure(PROXY_A, 'transport');
  const quarantineWrite = redis.calls.filter((call) => call[0] === 'set' && call[1].endsWith(':quarantine')).at(-1);
  assert.equal(Number(quarantineWrite[2]) - clock, 900_000);
});

test('an absent breaker never causes Redis deletes and an open breaker rejects bursts locally', async () => {
  const { createKisskhProxyPolicy } = require('../proxyPolicy');
  const redis = createRedisDouble();
  const selection = selectionDouble();
  const policy = createKisskhProxyPolicy({ redis, ...selection, now: () => 10_000 });
  await policy.assertCircuitClosed();
  assert.equal(redis.calls.filter(([command]) => command === 'del').length, 0);
  await policy.record429({});
  const before = redis.calls.length;
  const results = await Promise.allSettled(Array.from({ length: 100 }, () => policy.reserve()));
  assert.ok(results.every((result) => result.status === 'rejected'
    && result.reason.code === 'provider_rate_limited'));
  assert.equal(selection.calls.snapshots.length, 0);
  assert.equal(redis.calls.length, before);
});

test('a saturated proxy pool has a command budget and a local retry delay', async () => {
  const { createKisskhProxyPolicy } = require('../proxyPolicy');
  const redis = createRedisDouble();
  let clock = 10_000;
  let reservations = 0;
  const candidates = Array.from({ length: 1000 }, (_, index) => ({
    type: 'socks5', host: `proxy-${index}.example`, port: 1080,
  }));
  const policy = createKisskhProxyPolicy({
    redis, now: () => clock,
    getProxyCandidates: async () => candidates,
    reserveProxy: async () => { reservations += 1; return false; },
  });
  assert.equal(await policy.reserve(), null);
  assert.ok(reservations > 0 && reservations <= 32, `reservations: ${reservations}`);
  const quarantineKeys = redis.calls.filter(([command]) => command === 'mget')
    .reduce((total, call) => total + call.length - 1, 0);
  assert.ok(quarantineKeys <= 33, `quarantine keys: ${quarantineKeys}`);
  const before = redis.calls.length;
  const attempts = reservations;
  for (let index = 0; index < 100; index += 1) assert.equal(await policy.reserve(), null);
  assert.equal(redis.calls.length, before);
  assert.equal(reservations, attempts);
  clock += 1_000;
  await policy.reserve();
  assert.ok(reservations > attempts);
});

test('slow reservations admit at most twelve selections without queuing more Redis work', async () => {
  const { createKisskhProxyPolicy } = require('../proxyPolicy');
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let selections = 0;
  const policy = createKisskhProxyPolicy({
    redis: createRedisDouble(),
    async getProxyCandidates() { selections += 1; await pending; return [PROXY_A]; },
    reserveProxy: async () => true,
  });
  const reservations = Promise.all(Array.from({ length: 100 }, () => policy.reserve()));
  await new Promise((resolve) => setImmediate(resolve));
  release();
  const results = await reservations;
  assert.ok(selections > 0 && selections <= 12, `selections: ${selections}`);
  assert.equal(results.filter(Boolean).length, selections);
});

test('global slots are shared across workers and a burst cannot extend the queue indefinitely', async () => {
  const { createKisskhProxyPolicy } = require('../proxyPolicy');
  const redis = createRedisDouble();
  let clock = 10_000;
  const sleeps = [];
  const options = { redis, ...selectionDouble(), now: () => clock,
    sleep: async (ms) => { sleeps.push(ms); } };
  const workers = [createKisskhProxyPolicy(options), createKisskhProxyPolicy(options)];
  const results = await Promise.allSettled(Array.from({ length: 100 }, (_, index) =>
    workers[index % workers.length].reserveGlobal()));
  const accepted = results.filter((result) => result.status === 'fulfilled');
  assert.equal(accepted.length, 20);
  assert.ok(sleeps.every((ms) => ms < 2_000));
  assert.equal(Number(redis.values.get('kisskh:metadata:global:next')), 12_000);
  assert.ok(redis.calls.length <= 40, `Redis commands: ${redis.calls.length}`);
  clock += 2_000;
  assert.equal(await workers[0].reserveGlobal(), 0);
});

test('success resets failure count and quarantine', async () => {
  const { createKisskhProxyPolicy } = require('../proxyPolicy');
  const redis = createRedisDouble();
  let clock = 5_000;
  const policy = createKisskhProxyPolicy({
    redis,
    ...selectionDouble(),
    now: () => clock,
    quarantineBaseMs: 30_000,
  });
  await policy.recordFailure(PROXY_A, 'timeout');
  await policy.recordFailure(PROXY_A, 'timeout');
  await policy.recordSuccess(PROXY_A);
  clock = 10_000;
  await policy.recordFailure(PROXY_A, 'transport');
  const quarantineWrite = redis.calls.filter((call) => call[0] === 'set' && call[1].endsWith(':quarantine')).at(-1);
  assert.equal(Number(quarantineWrite[2]) - clock, 30_000);
});

test('429 opens one shared breaker, parses integer Retry-After and blocks reservation', async () => {
  const { createKisskhProxyPolicy } = require('../proxyPolicy');
  const redis = createRedisDouble();
  let clock = 100_000;
  const selection = selectionDouble();
  const policy = createKisskhProxyPolicy({
    redis,
    ...selection,
    now: () => clock,
    circuitDefaultMs: 60_000,
  });
  await policy.record429({ 'Retry-After': '120' });
  await assert.rejects(policy.assertCircuitClosed(), (error) => error.code === 'provider_rate_limited');
  await assert.rejects(policy.reserve(), (error) => error.code === 'provider_rate_limited');
  assert.equal(selection.calls.snapshots.length, 0);
  clock = 220_000;
  await policy.assertCircuitClosed();
  assert.equal(await policy.reserve(), PROXY_A);
});

test('Retry-After HTTP-date is honored and short/missing values use at least 60 seconds', async () => {
  const { createKisskhProxyPolicy } = require('../proxyPolicy');
  for (const retryAfter of ['Thu, 01 Jan 1970 00:03:20 GMT', '1', undefined]) {
    const redis = createRedisDouble();
    let clock = 100_000;
    const policy = createKisskhProxyPolicy({
      redis,
      ...selectionDouble(),
      now: () => clock,
      circuitDefaultMs: 60_000,
    });
    await policy.record429(retryAfter === undefined ? {} : { 'retry-after': retryAfter });
    const breakerWrite = redis.calls.find((call) => call[0] === 'set' && call[1].endsWith(':breaker:429'));
    const expected = typeof retryAfter === 'string' && retryAfter.startsWith('Thu') ? 200_000 : 160_000;
    assert.equal(Number(breakerWrite[2]), expected);
    clock = expected - 1;
    await assert.rejects(policy.assertCircuitClosed(), (error) => error.code === 'provider_rate_limited');
    clock = expected;
    await policy.assertCircuitClosed();
  }
});

test('a later short 429 cannot shorten an already-open shared breaker', async () => {
  const { createKisskhProxyPolicy } = require('../proxyPolicy');
  const redis = createRedisDouble();
  let clock = 100_000;
  const policy = createKisskhProxyPolicy({
    redis,
    ...selectionDouble(),
    now: () => clock,
  });
  assert.equal(await policy.record429({ 'retry-after': '120' }), 220_000);
  clock = 101_000;
  assert.equal(await policy.record429({ 'retry-after': '1' }), 220_000);
});

test('Redis proxy identities are normalized SHA-256 digests and never raw proxy material', async () => {
  const { createKisskhProxyPolicy } = require('../proxyPolicy');
  const redis = createRedisDouble();
  const policy = createKisskhProxyPolicy({
    redis,
    ...selectionDouble(),
    now: () => 10_000,
  });
  await policy.recordFailure(PROXY_A, 'timeout');
  await policy.recordSuccess(PROXY_A);
  const serialized = JSON.stringify(redis.calls);
  assert.doesNotMatch(serialized, /Proxy\.Example|user|secret|1080/i);
  const proxyKeys = redis.calls.flatMap((call) => call.slice(1))
    .filter((value) => typeof value === 'string' && value.includes('kisskh:metadata:proxy:'));
  assert.ok(proxyKeys.length > 0);
  assert.ok(proxyKeys.every((key) => /:[a-f0-9]{64}(?::|$)/.test(key)));
});

test('reservation batches quarantine state and reaches a healthy candidate after 39 quarantines', async () => {
  const { createKisskhProxyPolicy } = require('../proxyPolicy');
  const redis = createRedisDouble();
  const proxies = Array.from({ length: 40 }, (_, index) => ({
    type: 'socks5',
    host: `198.51.100.${index + 1}`,
    port: 1080,
  }));
  const selection = selectionDouble([proxies]);
  const policy = createKisskhProxyPolicy({
    redis,
    ...selection,
    now: () => 10_000,
  });
  for (const proxy of proxies.slice(0, -1)) await policy.recordFailure(proxy, 'transport');

  const selected = await policy.reserve();

  assert.equal(selected, proxies.at(-1));
  assert.equal(selection.calls.snapshots.length, 1);
  assert.deepEqual(selection.calls.reserves.map(([proxy]) => proxy), [proxies.at(-1)]);
  const quarantineReads = redis.calls.filter(([command]) => command === 'mget');
  assert.deepEqual(quarantineReads.map((call) => call.length - 1), [1, 32, 7]);
});

test('a 1000-entry snapshot with repeats is deduplicated and processed with bounded Redis work', async () => {
  const { createKisskhProxyPolicy } = require('../proxyPolicy');
  const redis = createRedisDouble();
  const unique = Array.from({ length: 500 }, (_, index) => ({
    type: 'socks5',
    host: `203.0.${Math.floor(index / 250)}.${(index % 250) + 1}`,
    port: 1080,
  }));
  const selection = selectionDouble([unique.flatMap((proxy) => [proxy, proxy])]);
  const policy = createKisskhProxyPolicy({
    redis,
    ...selection,
    now: () => 20_000,
  });
  for (const proxy of unique.slice(0, -1)) await policy.recordFailure(proxy, 'transport');
  const beforeReserve = redis.calls.length;

  const selected = await policy.reserve();

  assert.equal(selected, unique.at(-1));
  assert.equal(selection.calls.snapshots.length, 1);
  assert.deepEqual(selection.calls.reserves.map(([proxy]) => proxy), [unique.at(-1)]);
  const reserveRedisCalls = redis.calls.slice(beforeReserve);
  const quarantineReads = reserveRedisCalls.filter(([command]) => command === 'mget');
  assert.equal(quarantineReads.length, 17);
  assert.ok(quarantineReads.every((call) => call.length - 1 <= 32));
  assert.equal(quarantineReads.reduce((total, call) => total + call.length - 1, 0), unique.length);
  assert.equal(reserveRedisCalls.filter(([command]) => command === 'get').length, 1);
});

test('an expired quarantine-read deadline never inspects the next proxy or reserves late', async () => {
  const { createKisskhProxyPolicy } = require('../proxyPolicy');
  let inspected = 0;
  let reservations = 0;
  const redis = createRedisDouble();
  redis.mget = async () => { await delay(80); return [null]; };
  const policy = createKisskhProxyPolicy({
    redis,
    getProxyCandidates: async () => (function* () {
      inspected += 1;
      yield PROXY_A;
      inspected += 1;
      yield PROXY_B;
    })(),
    reserveProxy: async () => { reservations += 1; return true; },
    reservationDeadlineMs: 20,
  });
  assert.equal(await policy.reserve(), null);
  await delay(80);
  assert.equal(inspected, 1);
  assert.equal(reservations, 0);
});

test('reservation enforces hard candidate and wall-clock bounds', async () => {
  const { createKisskhProxyPolicy } = require('../proxyPolicy');
  assert.throws(() => createKisskhProxyPolicy({
    redis: createRedisDouble(),
    ...selectionDouble(),
    maxCandidates: 1001,
  }), TypeError);

  const startedAt = Date.now();
  const policy = createKisskhProxyPolicy({
    redis: createRedisDouble(),
    getProxyCandidates: () => new Promise(() => {}),
    reserveProxy: async () => true,
    reservationDeadlineMs: 20,
  });
  assert.equal(await policy.reserve(), null);
  assert.ok(Date.now() - startedAt < 500);
});

test('the global deadline includes a slow breaker read and starts no late candidate work', async () => {
  const { createKisskhProxyPolicy } = require('../proxyPolicy');
  let candidateCalls = 0;
  let reservationCalls = 0;
  const redis = createRedisDouble();
  redis.get = async () => {
    await delay(80);
    return null;
  };
  const policy = createKisskhProxyPolicy({
    redis,
    getProxyCandidates: async () => {
      candidateCalls += 1;
      return [PROXY_A];
    },
    reserveProxy: async () => {
      reservationCalls += 1;
      return true;
    },
    reservationDeadlineMs: 20,
  });

  const outcome = await Promise.race([
    policy.reserve().then((value) => ({ value })),
    delay(50).then(() => ({ late: true })),
  ]);
  assert.deepEqual(outcome, { value: null });
  assert.equal(candidateCalls, 0);
  assert.equal(reservationCalls, 0);

  await delay(60);
  assert.equal(candidateCalls, 0);
  assert.equal(reservationCalls, 0);
});
