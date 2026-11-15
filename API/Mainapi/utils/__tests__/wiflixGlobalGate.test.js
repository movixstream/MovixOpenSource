'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  WIFLIX_GLOBAL_NEXT_KEY,
  classifyWiflixProxyFailure,
  createWiflixGlobalGate,
  isWiflixTransportFailure,
  runWithWiflixPriority,
} = require('../wiflixProxyAffinity');

// Redis simulé : même logique que le script Lua de la porte globale.
function createRedisDouble() {
  const values = new Map();
  const calls = [];
  return {
    values,
    calls,
    async eval(_script, _keys, key, now, interval, maxWait) {
      calls.push(['eval', key, Number(interval), Number(maxWait)]);
      const slot = Math.max(Number(now), Number(values.get(key) || 0));
      if (slot - Number(now) >= Number(maxWait)) return -1;
      values.set(key, String(slot + Number(interval)));
      return slot - Number(now);
    },
  };
}

function gateFixture({ redis = createRedisDouble(), clock = { now: 10_000 }, ...options } = {}) {
  const sleeps = [], logs = [], timers = [];
  const gate = createWiflixGlobalGate({
    redis,
    now: () => clock.now,
    sleep: async ms => { sleeps.push(ms); },
    log: message => logs.push(message),
    schedule: (callback, ms) => { timers.push({ callback, ms }); return { unref() {} }; },
    ...options,
  });
  return { gate, redis, clock, sleeps, logs, timers };
}

test('les créneaux du débit global sont espacés de 100 ms dans tout le cluster', async () => {
  const redis = createRedisDouble();
  const clock = { now: 10_000 };
  const first = gateFixture({ redis, clock }), second = gateFixture({ redis, clock });
  const waits = await Promise.all([first.gate.reserve('missing'), second.gate.reserve('missing'),
    first.gate.reserve('missing')]);
  assert.deepEqual(waits, [0, 100, 200]);
  assert.deepEqual([...first.sleeps, ...second.sleeps].sort((a, b) => a - b), [100, 200]);
  assert.equal(Number(redis.values.get(WIFLIX_GLOBAL_NEXT_KEY)), 10_300);
  assert.ok(redis.calls.every(([, key, interval]) => key === WIFLIX_GLOBAL_NEXT_KEY && interval === 100));
});

test('au-delà de l’attente permise, refus immédiat : 2 s pour un titre sans cache, 1 s pour un cache périmé', async () => {
  const f = gateFixture();
  // File de 1,5 s : un cache périmé cède la place, un titre sans cache attend.
  f.redis.values.set(WIFLIX_GLOBAL_NEXT_KEY, String(f.clock.now + 1500));
  await assert.rejects(f.gate.reserve('stale'), { code: 'WIFLIX_RATE_LIMITED', priority: 'stale' });
  assert.equal(await f.gate.reserve('missing'), 1500);
  // File de 2 s : le titre sans cache est refusé à son tour, sans attente.
  f.redis.values.set(WIFLIX_GLOBAL_NEXT_KEY, String(f.clock.now + 2000));
  await assert.rejects(f.gate.reserve('missing'), { code: 'WIFLIX_RATE_LIMITED', priority: 'missing' });
  assert.deepEqual(f.sleeps, [1500]);
  // Juste après un refus, ce worker refuse sans réinterroger Redis.
  const before = f.redis.calls.length;
  await assert.rejects(f.gate.reserve('missing'), { code: 'WIFLIX_RATE_LIMITED' });
  await assert.rejects(f.gate.reserve('stale'), { code: 'WIFLIX_RATE_LIMITED' });
  assert.equal(f.redis.calls.length, before);
});

test('la priorité vient de l’actualisation en cours, cache périmé par défaut', async () => {
  const f = gateFixture();
  f.redis.values.set(WIFLIX_GLOBAL_NEXT_KEY, String(f.clock.now + 1200));
  await assert.rejects(f.gate.reserve(), { priority: 'stale' });
  await assert.rejects(runWithWiflixPriority('stale', () => f.gate.reserve()), { priority: 'stale' });
  assert.equal(await runWithWiflixPriority('missing', async () => {
    await Promise.resolve(); // La priorité suit les appels asynchrones.
    return f.gate.reserve();
  }), 1200);
});

test('un refus du débit global n’écarte pas le proxy et ne retire pas son agent', () => {
  const limited = Object.assign(new Error('Flemmix : débit global atteint'), { code: 'WIFLIX_RATE_LIMITED' });
  assert.deepEqual(classifyWiflixProxyFailure(limited), { dead: false, stop: true });
  assert.equal(isWiflixTransportFailure(limited), false);
});

test('sans Redis, le même intervalle est tenu dans le worker', async () => {
  const f = gateFixture({ redis: { eval: async () => { throw new Error('Redis indisponible'); } } });
  const waits = [];
  for (let i = 0; i < 3; i++) waits.push(await f.gate.reserve('missing'));
  assert.deepEqual(waits, [0, 100, 200]);
  // File locale de 2 s : refus sans attente.
  for (let i = 0; i < 17; i++) await f.gate.reserve('missing');
  await assert.rejects(f.gate.reserve('missing'), { code: 'WIFLIX_RATE_LIMITED' });
  const none = gateFixture({ redis: null });
  assert.deepEqual([await none.gate.reserve('stale'), await none.gate.reserve('stale')], [0, 100]);
});

test('une rafale ne dépasse ni la file de 2 s ni 20 attentes par worker', async () => {
  const f = gateFixture();
  const results = await Promise.allSettled(Array.from({ length: 100 }, () => f.gate.reserve('missing')));
  const accepted = results.filter(result => result.status === 'fulfilled');
  assert.equal(accepted.length, 20);
  assert.ok(f.sleeps.every(ms => ms < 2000));
  assert.ok(f.redis.calls.length <= 21, `appels Redis : ${f.redis.calls.length}`);
});

test('les refus sont relevés en une seule ligne par minute', async () => {
  const f = gateFixture();
  f.redis.values.set(WIFLIX_GLOBAL_NEXT_KEY, String(f.clock.now + 5000));
  await assert.rejects(f.gate.reserve('missing'));
  await assert.rejects(f.gate.reserve('stale'));
  await assert.rejects(f.gate.reserve('stale'));
  assert.deepEqual(f.logs, []);
  assert.deepEqual(f.timers.map(timer => timer.ms), [60_000]);
  f.timers[0].callback();
  assert.equal(f.logs.length, 1);
  assert.match(f.logs[0], /10 req\/s : 3 requêtes refusées en 1 min \(1 titres sans cache, 2 caches périmés\)/);
});

test('un intervalle nul désactive la porte', async () => {
  const f = gateFixture({ minIntervalMs: 0 });
  assert.equal(await f.gate.reserve('stale'), 0);
  assert.equal(f.redis.calls.length, 0);
});
