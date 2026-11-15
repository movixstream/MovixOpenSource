'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSourceCircuitBreaker, isSourceCircuitOpenError } = require('../sourceCircuitBreaker');

const silent = { log() {}, warn() {} };
const timeout = () => Object.assign(new Error('délai dépassé'), { code: 'ETIMEDOUT' });
const httpError = status => Object.assign(new Error(`status ${status}`), { response: { status } });

function fixture(options = {}) {
  let clock = 0;
  const breaker = createSourceCircuitBreaker({ name: 'Test', now: () => clock, logger: silent, ...options });
  return { breaker, advance: ms => { clock += ms; } };
}

test('trois délais d’affilée coupent la source : la suivante échoue sans appel réseau', async () => {
  const { breaker } = fixture();
  for (let i = 0; i < 3; i++) await assert.rejects(breaker.run(async () => { throw timeout(); }), { code: 'ETIMEDOUT' });
  let calls = 0;
  await assert.rejects(breaker.run(async () => { calls++; }), error =>
    isSourceCircuitOpenError(error) && error.code === 'SOURCE_CIRCUIT_OPEN' && error.httpStatus === 503
    && error.retryAfterMs === 5 * 60 * 1000);
  assert.equal(calls, 0);
  assert.equal(breaker.isOpen(), true);
});

test('un succès remet le compteur à zéro', async () => {
  const { breaker } = fixture();
  await assert.rejects(breaker.run(async () => { throw timeout(); }));
  await assert.rejects(breaker.run(async () => { throw httpError(502); }));
  await breaker.run(async () => 'ok');
  await assert.rejects(breaker.run(async () => { throw timeout(); }));
  await assert.rejects(breaker.run(async () => { throw httpError(408); }));
  assert.equal(breaker.isOpen(), false);
});

test('un 404 est une réponse de la source, pas une panne', async () => {
  const { breaker } = fixture({ failureThreshold: 1 });
  await assert.rejects(breaker.run(async () => { throw httpError(404); }), { response: { status: 404 } });
  assert.equal(breaker.isOpen(), false);
});

test('les codes neutres ne comptent ni comme panne ni comme succès', async () => {
  const { breaker } = fixture({ failureThreshold: 2, neutralCodes: ['POOL_EMPTY'] });
  await assert.rejects(breaker.run(async () => { throw timeout(); }));
  await assert.rejects(breaker.run(async () => { throw Object.assign(new Error('vide'), { code: 'POOL_EMPTY' }); }));
  assert.equal(breaker.isOpen(), false);
  await assert.rejects(breaker.run(async () => { throw timeout(); }));
  assert.equal(breaker.isOpen(), true);
});

test('un statut renvoyé sans exception peut compter comme panne via classifyResult', async () => {
  const { breaker } = fixture({ failureThreshold: 2 });
  const classifyResult = result => (result.status === 403 ? 'failure' : 'success');
  await breaker.run(async () => ({ status: 403 }), { classifyResult });
  await breaker.run(async () => ({ status: 403 }), { classifyResult });
  assert.equal(breaker.isOpen(), true);
  assert.equal(breaker.snapshot().lastFailure, 'HTTP 403');
});

test('après la pause, une seule requête d’essai passe ; son succès referme le circuit', async () => {
  const { breaker, advance } = fixture({ failureThreshold: 1 });
  await assert.rejects(breaker.run(async () => { throw timeout(); }));
  advance(5 * 60 * 1000);
  let release;
  const probe = breaker.run(() => new Promise(resolve => { release = resolve; }));
  await assert.rejects(breaker.run(async () => 'trop tôt'), { code: 'SOURCE_CIRCUIT_OPEN' });
  release('ok');
  assert.equal(await probe, 'ok');
  assert.equal(await breaker.run(async () => 'libre'), 'libre');
  assert.equal(breaker.snapshot().state, 'closed');
});

test('l’échec de la requête d’essai rouvre la pause pour cinq minutes', async () => {
  const { breaker, advance } = fixture({ failureThreshold: 1 });
  await assert.rejects(breaker.run(async () => { throw timeout(); }));
  advance(5 * 60 * 1000);
  await assert.rejects(breaker.run(async () => { throw httpError(503); }), { response: { status: 503 } });
  await assert.rejects(breaker.run(async () => 'x'), error => error.retryAfterMs === 5 * 60 * 1000);
});

test('avec maxConcurrent, une source muette ne reçoit que ce nombre d’appels avant la pause', async () => {
  const { breaker } = fixture({ maxConcurrent: 3 });
  let started = 0;
  let fail;
  const silentSource = new Promise((_, reject) => { fail = reject; });
  const calls = Array.from({ length: 8 }, () => breaker.run(() => { started++; return silentSource; }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, 3);
  assert.equal(breaker.snapshot().queued, 5);
  fail(timeout());
  const results = await Promise.allSettled(calls);
  assert.equal(started, 3);
  assert.deepEqual(results.map(result => result.reason?.code),
    [...Array(3).fill('ETIMEDOUT'), ...Array(5).fill('SOURCE_CIRCUIT_OPEN')]);
  assert.equal(breaker.isOpen(), true);
  assert.equal(breaker.snapshot().queued, 0);
});

test('avec maxConcurrent, une source saine sert les appels en attente un par un', async () => {
  const { breaker } = fixture({ maxConcurrent: 1 });
  const order = [];
  let release;
  const first = breaker.run(() => new Promise(resolve => { release = resolve; }));
  const second = breaker.run(async () => { order.push('deuxième'); return 'deuxième'; });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(order, []);
  release('premier');
  assert.equal(await first, 'premier');
  assert.equal(await second, 'deuxième');
  assert.equal(breaker.snapshot().state, 'closed');
});

test('file d’attente pleine : refus immédiat traité comme une pause, sans compter de panne', async () => {
  const { breaker } = fixture({ maxConcurrent: 1, maxQueued: 1, failureThreshold: 1 });
  let release;
  const first = breaker.run(() => new Promise(resolve => { release = resolve; }));
  const second = breaker.run(async () => 'deuxième');
  let calls = 0;
  await assert.rejects(breaker.run(async () => { calls++; }), error =>
    isSourceCircuitOpenError(error) && error.code === 'SOURCE_CIRCUIT_OPEN' && error.saturated === true);
  assert.equal(calls, 0);
  assert.equal(breaker.isOpen(), false);
  release('premier');
  assert.equal(await first, 'premier');
  assert.equal(await second, 'deuxième');
});

test('les réponses en vol pendant la coupure ne prolongent ni ne lèvent la pause', async () => {
  const { breaker, advance } = fixture({ failureThreshold: 1 });
  let finishLate;
  const late = breaker.run(() => new Promise(resolve => { finishLate = resolve; }));
  let failLate;
  const lateFailure = breaker.run(() => new Promise((_, reject) => { failLate = reject; }));
  await assert.rejects(breaker.run(async () => { throw timeout(); }));
  advance(60 * 1000);
  failLate(timeout());
  await assert.rejects(lateFailure);
  finishLate('ancienne réponse');
  await late;
  assert.equal(breaker.isOpen(), true);
  assert.equal(breaker.snapshot().retryAfterMs, 4 * 60 * 1000);
});
