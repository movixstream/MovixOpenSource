'use strict';

const test = require('node:test');
const { beforeEach } = test;
const assert = require('node:assert/strict');

const budget = require('../wrappedTimeBudget');

const T0 = Date.parse('2026-11-07T20:00:00Z');

beforeEach(() => budget.resetWrappedTimeBudgetMemory());

// Rejoue une suite d'envois [instant en ms depuis T0, secondes annoncées] avec
// la règle pure et renvoie le total crédité.
function replay(sends) {
  let cursor = null;
  let total = 0;
  for (const [offsetMs, seconds] of sends) {
    const result = budget.applyBudget(cursor, T0 + offsetMs, seconds * 1000);
    cursor = result.cursorMs;
    total += result.allowedMs / 1000;
  }
  return total;
}

test('usage normal : 30 s toutes les 30 s pendant 1 h, rien n’est rogné', () => {
  const sends = Array.from({ length: 120 }, (_, i) => [(i + 1) * 30000, 30]);
  assert.equal(replay(sends), 3600);
});

test('envoi en retard de quelques secondes (réseau) : toujours accepté en entier', () => {
  assert.equal(replay([[30000, 30], [62000, 30], [89000, 30]]), 90);
});

test('rafale : 30 envois de 60 s au même instant ne donnent que 35 s', () => {
  const sends = Array.from({ length: 30 }, () => [0, 60]);
  assert.equal(replay(sends), 35);
});

test('script : 30 envois de 60 s étalés sur une minute restent au rythme du temps réel', () => {
  const sends = Array.from({ length: 30 }, (_, i) => [i * 2000, 60]);
  // 35 s au départ (30 s d'avance + 5 s de marge), puis 2 s par envoi.
  assert.equal(replay(sends), 93);
  // 1 h annoncée en 2 minutes : 1 h refusée.
  const twoMinutes = Array.from({ length: 60 }, (_, i) => [i * 2000, 60]);
  assert.ok(replay(twoMinutes) <= 120 + 35);
});

test('après une longue pause, au plus 35 s d’un coup', () => {
  assert.equal(replay([[30000, 30], [30000 + 20 * 60000, 60]]), 65);
});

test('applyBudget : jamais négatif, secondes entières', () => {
  const result = budget.applyBudget(T0 + 60000, T0, 30000);
  assert.equal(result.allowedMs, 0);
  const partial = budget.applyBudget(T0 - 1500, T0, 30000);
  assert.equal(partial.allowedMs % 1000, 0);
  assert.equal(partial.allowedMs, 6000);
});

test('takeWrappedTime sans Redis : un budget par profil et par type', async () => {
  const take = (profileId, type, seconds, offset = 0) => budget.takeWrappedTime({
    type, userId: 'u1', profileId, requestedSeconds: seconds, nowMs: T0 + offset
  });
  assert.equal(await take('p1', 'viewing', 60), 35);
  assert.equal(await take('p1', 'viewing', 60), 0);
  // Autre profil du même compte, ou les pages : budgets séparés.
  assert.equal(await take('p2', 'viewing', 60), 35);
  assert.equal(await take('p1', 'page', 20), 20);
  assert.equal(await take('p1', 'viewing', 60, 30000), 30);
});

test('takeWrappedTime avec Redis : script appelé avec la clé et les bons nombres', async () => {
  const calls = [];
  const store = new Map();
  // Faux Redis : applique la même règle que le script Lua.
  const redis = {
    async eval(script, keyCount, key, now, requested, backlog, slack, ttl) {
      calls.push({ keyCount, key, now, requested, backlog, slack, ttl, isScript: script === budget.BUDGET_SCRIPT });
      const result = budget.applyBudget(store.has(key) ? store.get(key) : null, Number(now), Number(requested));
      store.set(key, result.cursorMs);
      return result.allowedMs;
    }
  };
  const credited = await budget.takeWrappedTime({ redis, type: 'viewing', userId: 'u1', profileId: null, requestedSeconds: 30, nowMs: T0 });
  assert.equal(credited, 30);
  assert.deepEqual(calls[0], {
    keyCount: 1, key: 'wrapped:budget:viewing:u1:-', now: String(T0), requested: '30000',
    backlog: '30000', slack: '5000', ttl: String(budget.IDLE_TTL_MS), isScript: true
  });
});

test('takeWrappedTime : Redis en panne → même règle en mémoire', async () => {
  const redis = { eval: async () => { throw new Error('down'); } };
  assert.equal(await budget.takeWrappedTime({ redis, type: 'viewing', userId: 'u2', requestedSeconds: 60, nowMs: T0 }), 35);
  assert.equal(await budget.takeWrappedTime({ redis, type: 'viewing', userId: 'u2', requestedSeconds: 60, nowMs: T0 }), 0);
});
