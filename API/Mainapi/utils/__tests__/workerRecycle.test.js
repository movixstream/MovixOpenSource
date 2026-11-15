'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_MAX_RSS_MB, readRssLimitMb, shouldRequestRecycle, createRecycleGate,
} = require('../workerRecycle');

const MB = 1024 * 1024;
const worker = (dead = false) => ({ dead, isDead() { return this.dead; } });

test('le seuil vient de l’environnement, 0 désactive et une valeur invalide garde le défaut', () => {
  assert.equal(readRssLimitMb(undefined), DEFAULT_MAX_RSS_MB);
  assert.equal(readRssLimitMb(''), DEFAULT_MAX_RSS_MB);
  assert.equal(readRssLimitMb('3000'), 3000);
  assert.equal(readRssLimitMb('0'), 0);
  assert.equal(readRssLimitMb('-5'), DEFAULT_MAX_RSS_MB);
  assert.equal(readRssLimitMb('abc'), DEFAULT_MAX_RSS_MB);
});

test('un worker ne demande son remplacement qu’au-delà du seuil et après la chauffe', () => {
  const base = { limitMb: 2560, minUptimeMs: 15 * 60 * 1000 };
  assert.equal(shouldRequestRecycle({ ...base, rssBytes: 2600 * MB, uptimeMs: 20 * 60 * 1000 }), true);
  assert.equal(shouldRequestRecycle({ ...base, rssBytes: 2500 * MB, uptimeMs: 20 * 60 * 1000 }), false);
  assert.equal(shouldRequestRecycle({ ...base, rssBytes: 4000 * MB, uptimeMs: 5 * 60 * 1000 }), false);
  assert.equal(shouldRequestRecycle({ ...base, limitMb: 0, rssBytes: 9000 * MB, uptimeMs: 99 * 60 * 1000 }), false);
});

test('le master ne recycle qu’un worker à la fois, espacés du délai minimal', () => {
  let clock = 0;
  const gate = createRecycleGate({ minGapMs: 1000, now: () => clock });
  const a = worker(), b = worker();
  assert.equal(gate.tryAcquire(a), true);
  // A n'est pas encore sorti : B attend, même après le délai.
  clock = 5000;
  assert.equal(gate.tryAcquire(b), false);
  a.dead = true;
  assert.equal(gate.tryAcquire(b), true);
  // B vient de partir : le délai minimal s'applique au suivant.
  b.dead = true;
  clock = 5500;
  assert.equal(gate.tryAcquire(worker()), false);
  clock = 6000;
  assert.equal(gate.tryAcquire(worker()), true);
});

test('un recyclage périodique noté bloque le recyclage par RSS jusqu’à son tour', () => {
  let clock = 0;
  const gate = createRecycleGate({ minGapMs: 1000, now: () => clock });
  const periodic = worker(), big = worker();
  gate.note(periodic);
  clock = 2000;
  assert.equal(gate.tryAcquire(big), false);
  periodic.dead = true;
  assert.equal(gate.tryAcquire(big), true);
});

test('les demandes répétées du worker déjà en cours de recyclage n’en relancent pas un second', () => {
  let clock = 0;
  const gate = createRecycleGate({ minGapMs: 1000, now: () => clock });
  const a = worker();
  assert.equal(gate.tryAcquire(a), true);
  clock = 500;
  assert.equal(gate.tryAcquire(a), false);
});
