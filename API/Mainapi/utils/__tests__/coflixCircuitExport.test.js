'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createSourceCircuitBreaker } = require('../sourceCircuitBreaker');

const filename = path.resolve(__dirname, '../proxyManager.js');
const code = fs.readFileSync(filename, 'utf8');

// Vrais disjoncteurs de proxyManager, avec une horloge et un journal muets.
function load() {
  const start = code.indexOf('const coflixCircuit = createSourceCircuitBreaker({');
  const end = code.indexOf('// Pas de disjoncteur pour Flemmix', start);
  assert.ok(start > 0 && end > start);
  const clock = { now: 0 };
  const context = vm.createContext({
    createSourceCircuitBreaker: options => createSourceCircuitBreaker({
      ...options,
      now: () => clock.now,
      logger: { log() {}, warn() {} },
    }),
  });
  vm.runInContext(`${code.slice(start, end)}\nglobalThis.api = { coflixCircuit, isCoflixCircuitOpen };`, context, { filename });
  return { ...context.api, clock };
}

const timeout = () => Object.assign(new Error('timeout'), { code: 'ECONNABORTED' });

test('isCoflixCircuitOpen suit la pause Coflix du worker sans la modifier', async () => {
  const { coflixCircuit, isCoflixCircuitOpen, clock } = load();
  assert.equal(isCoflixCircuitOpen(), false);
  for (let i = 0; i < 3; i++) await assert.rejects(coflixCircuit.run(() => Promise.reject(timeout())));
  assert.equal(isCoflixCircuitOpen(), true);
  // Lire l'état plusieurs fois ne consomme pas la requête d'essai.
  clock.now += 5 * 60 * 1000;
  assert.equal(isCoflixCircuitOpen(), false);
  assert.equal(isCoflixCircuitOpen(), false);
  assert.equal(await coflixCircuit.run(async () => 'essai'), 'essai');
  assert.equal(isCoflixCircuitOpen(), false);
});

test('Coflix muet : 8 appels en vol au plus par worker, les suivants repartent en pause', async () => {
  const { coflixCircuit, isCoflixCircuitOpen } = load();
  let started = 0;
  let fail;
  const silentCoflix = new Promise((_, reject) => { fail = reject; });
  const calls = Array.from({ length: 30 }, () => coflixCircuit.run(() => { started++; return silentCoflix; }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, 8);
  fail(timeout());
  const results = await Promise.allSettled(calls);
  assert.equal(started, 8);
  assert.deepEqual(results.map(result => result.reason?.code),
    [...Array(8).fill('ECONNABORTED'), ...Array(22).fill('SOURCE_CIRCUIT_OPEN')]);
  assert.equal(isCoflixCircuitOpen(), true);
});

test('Coflix : au-delà de 32 appels en attente, refus immédiat traité comme une pause', async () => {
  const { coflixCircuit, isCoflixCircuitOpen } = load();
  const releases = [];
  const calls = Array.from({ length: 40 }, () => coflixCircuit.run(() => new Promise(resolve => { releases.push(resolve); })));
  await assert.rejects(coflixCircuit.run(async () => 'trop'), error =>
    error.isSourceCircuitOpen === true && error.saturated === true);
  assert.equal(isCoflixCircuitOpen(), false);
  // Coflix sain : chaque place libérée sert un appel en attente.
  while (releases.length) {
    releases.shift()('ok');
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.deepEqual(new Set(await Promise.all(calls)), new Set(['ok']));
});

test('proxyManager exporte isCoflixCircuitOpen', () => {
  const exportsBlock = code.slice(code.lastIndexOf('module.exports = {'));
  assert.match(exportsBlock, /^\s+isCoflixCircuitOpen,\r?$/m);
});
