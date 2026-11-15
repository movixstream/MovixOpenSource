'use strict';

const test = require('node:test');
const { beforeEach } = test;
const assert = require('node:assert/strict');

const percentile = require('../wrappedPercentile');
const { createGate } = require('../concurrencyGate');

beforeEach(() => percentile.resetWrappedPercentileMemory());

const nextTick = () => new Promise((resolve) => setImmediate(resolve));

test('buildDistribution : seuils triés, au plus 1 000, valeurs invalides ignorées', () => {
  assert.deepEqual(percentile.buildDistribution([]), { count: 0, cuts: [] });
  assert.deepEqual(percentile.buildDistribution([30, 10, 'x', -5, 20, null]), { count: 4, cuts: [0, 10, 20, 30] });

  const big = percentile.buildDistribution(Array.from({ length: 50000 }, (_, i) => 50000 - i));
  assert.equal(big.count, 50000);
  assert.equal(big.cuts.length, percentile.CUT_COUNT);
  assert.equal(big.cuts[0], 50);
  assert.equal(big.cuts.at(-1), 50000);
  assert.deepEqual([...big.cuts].sort((a, b) => a - b), big.cuts);
});

test('percentileOf : part des membres qui ont regardé moins, de 1 à 99', () => {
  // 1 000 membres : 1, 2, …, 1 000 minutes.
  const distribution = percentile.buildDistribution(Array.from({ length: 1000 }, (_, i) => i + 1));
  assert.equal(percentile.percentileOf(distribution, 501), 50);
  assert.equal(percentile.percentileOf(distribution, 901), 90);
  assert.equal(percentile.percentileOf(distribution, 991), 99);
  // Le premier du classement : « top 1 % », jamais « top 0 % ».
  assert.equal(percentile.percentileOf(distribution, 1000), 99);
  assert.equal(percentile.percentileOf(distribution, 999999), 99);
  // Le dernier : 1, jamais 0.
  assert.equal(percentile.percentileOf(distribution, 1), 1);
  assert.equal(percentile.percentileOf(distribution, 0), 1);
});

test('percentileOf : à égalité, personne n’est dépassé', () => {
  const distribution = percentile.buildDistribution(Array.from({ length: 100 }, () => 300));
  assert.equal(percentile.percentileOf(distribution, 300), 1);
  assert.equal(percentile.percentileOf(distribution, 301), 99);
});

test('percentileOf : population trop petite ou valeur illisible → null', () => {
  const small = percentile.buildDistribution(Array.from({ length: percentile.MIN_POPULATION - 1 }, (_, i) => i));
  assert.equal(percentile.percentileOf(small, 10), null);
  assert.equal(percentile.percentileOf(null, 10), null);
  assert.equal(percentile.percentileOf({ count: 500, cuts: [] }, 10), null);
  const fine = percentile.buildDistribution(Array.from({ length: 100 }, (_, i) => i));
  assert.equal(percentile.percentileOf(fine, 'abc'), null);
});

function fakeRedis() {
  const store = new Map();
  const calls = [];
  return {
    status: 'ready',
    store,
    calls,
    async get(key) { calls.push(['get', key]); return store.has(key) ? store.get(key) : null; },
    async set(key, value, ...options) {
      calls.push(['set', key, ...options]);
      if (options.includes('NX') && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    },
  };
}

function fakePool(totals) {
  const queries = [];
  return {
    queries,
    async execute(sql, params) {
      queries.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      return [totals.filter((total) => total >= params[1]).map((total) => ({ total }))];
    },
  };
}

test('getWrappedPercentile : cache froid → null tout de suite, calcul en arrière-plan, puis valeur', async () => {
  const redis = fakeRedis();
  // 200 comptes au-dessus du seuil, 300 en dessous (non comptés).
  const pool = fakePool([...Array.from({ length: 200 }, (_, i) => 120 + i * 10), ...Array.from({ length: 300 }, () => 5)]);
  const options = { pool, redis, year: 2026, minutes: 1120, minMinutes: 120, now: () => 1000, currentYear: 2026 };

  assert.deepEqual(await percentile.getWrappedPercentile(options), { percentile: null, pending: true });
  await nextTick();
  await nextTick();

  assert.equal(pool.queries.length, 1);
  assert.match(pool.queries[0].sql, /GROUP BY user_id HAVING total >= \?$/);
  assert.deepEqual(pool.queries[0].params, [2026, 120]);
  const stored = JSON.parse(redis.store.get('wrapped:pctile:v2:2026'));
  assert.equal(stored.count, 200);
  assert.equal(stored.builtAt, 1000);
  // Année en cours : gardé 24 h, verrou de 5 min pour un seul worker.
  assert.deepEqual(redis.calls.filter((call) => call[0] === 'set').map((call) => call.slice(1)), [
    ['wrapped:pctile:v2:2026:lock', 'EX', 300, 'NX'],
    ['wrapped:pctile:v2:2026', 'EX', 24 * 60 * 60],
  ]);

  // 1 120 min = 100 comptes sur 200 ont regardé moins.
  assert.deepEqual(await percentile.getWrappedPercentile(options), { percentile: 50, pending: false });
  assert.equal(pool.queries.length, 1);
});

test('getWrappedPercentile : résumé de plus d’une heure → servi tel quel et recalculé ; année terminée → jamais', async () => {
  const totals = Array.from({ length: 100 }, (_, i) => 200 + i);
  const stale = JSON.stringify({ builtAt: 0, ...percentile.buildDistribution(totals) });

  const redis = fakeRedis();
  redis.store.set('wrapped:pctile:v2:2026', stale);
  const pool = fakePool(totals);
  const twoHours = 2 * 60 * 60 * 1000;
  const open = await percentile.getWrappedPercentile({ pool, redis, year: 2026, minutes: 250, minMinutes: 120, now: () => twoHours, currentYear: 2026 });
  assert.deepEqual(open, { percentile: 50, pending: false });
  await nextTick();
  await nextTick();
  assert.equal(pool.queries.length, 1);

  percentile.resetWrappedPercentileMemory();
  const closedRedis = fakeRedis();
  closedRedis.store.set('wrapped:pctile:v2:2025', stale);
  const closedPool = fakePool(totals);
  await percentile.getWrappedPercentile({ pool: closedPool, redis: closedRedis, year: 2025, minutes: 250, minMinutes: 120, now: () => twoHours, currentYear: 2026 });
  await nextTick();
  assert.equal(closedPool.queries.length, 0);
});

test('getWrappedPercentile : sans Redis, ou verrou pris ailleurs → aucun passage sur la table', async () => {
  const pool = fakePool([500]);
  assert.deepEqual(await percentile.getWrappedPercentile({ pool, redis: null, year: 2026, minutes: 500, minMinutes: 120 }), { percentile: null, pending: false });
  assert.deepEqual(await percentile.getWrappedPercentile({ pool, redis: { status: 'end' }, year: 2026, minutes: 500, minMinutes: 120 }), { percentile: null, pending: false });

  const redis = fakeRedis();
  redis.store.set('wrapped:pctile:v2:2026:lock', '1');
  await percentile.getWrappedPercentile({ pool, redis, year: 2026, minutes: 500, minMinutes: 120, currentYear: 2026 });
  await nextTick();
  await nextTick();
  assert.equal(pool.queries.length, 0);
});

test('createGate : jamais plus de tâches en cours que de places, dans l’ordre d’arrivée', async () => {
  const gate = createGate(2);
  let running = 0;
  let peak = 0;
  const order = [];
  const task = (name, ms) => gate(async () => {
    running += 1;
    peak = Math.max(peak, running);
    order.push(name);
    await new Promise((resolve) => setTimeout(resolve, ms));
    running -= 1;
    return name;
  });
  const results = await Promise.all([task('a', 20), task('b', 5), task('c', 5), task('d', 5), task('e', 1)]);
  assert.deepEqual(results, ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(order, ['a', 'b', 'c', 'd', 'e']);
  assert.equal(peak, 2);
  assert.equal(running, 0);
});

test('createGate : une tâche en erreur libère sa place', async () => {
  const gate = createGate(1);
  await assert.rejects(gate(async () => { throw new Error('raté'); }), /raté/);
  assert.equal(await gate(async () => 'suivante'), 'suivante');
});
