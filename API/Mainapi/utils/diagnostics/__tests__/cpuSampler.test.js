const assert = require('node:assert/strict');
const test = require('node:test');
const { createCpuSampler } = require('../cpuSampler');

function fakeTimers() {
  const timers = new Map(); let id = 0;
  return {
    setTimeout(fn) { const value = ++id; timers.set(value, fn); return { value, unref() {} }; },
    clearTimeout(timer) { timers.delete(timer.value); },
    runOne() { const [key, fn] = timers.entries().next().value || []; if (key) { timers.delete(key); fn(); } },
    runLast() { const entries = [...timers.entries()]; const [key, fn] = entries[entries.length - 1] || []; if (key) { timers.delete(key); fn(); } },
    size: () => timers.size,
  };
}

test('agrège exclusivement les feuilles et borne les fonctions', async () => {
  const timers = fakeTimers();
  let disconnected = 0;
  const sampler = createCpuSampler({ timers, profileMs: 5, intervalMs: 60, rootDir: '/app', sessionFactory: () => ({
    connect() {}, disconnect() { disconnected += 1; },
    post(method, _params, callback) {
      if (method === 'Profiler.stop') callback(null, { profile: { nodes: [{ id: 1, callFrame: { functionName: 'work', url: 'file:///app/lib/a.js', lineNumber: 4 } }], samples: [1, 1], timeDeltas: [1000, 2000] } });
      else callback(null, {});
    },
  }) });
  sampler.start(); timers.runOne(); await new Promise((resolve) => setImmediate(resolve)); timers.runLast(); await new Promise((resolve) => setImmediate(resolve));
  const report = await sampler.stop();
  assert.equal(report.windows, 1);
  assert.equal(report.sampledDurationMs, 3);
  assert.deepEqual(report.functions, [{ name: 'work', file: 'lib/a.js', line: 5, samples: 2, estimatedCpuMs: 3 }]);
  assert.equal(disconnected, 1);
  assert.equal(timers.size(), 0);
});

test('les défaillances de profiler restent locales et stop est idempotent', async () => {
  const timers = fakeTimers();
  const sampler = createCpuSampler({ timers, sessionFactory: () => ({ connect() { throw new Error('no inspector'); }, disconnect() {}, post() {} }) });
  assert.equal(sampler.snapshot().active, false);
  sampler.start(); timers.runOne(); await new Promise((resolve) => setImmediate(resolve));
  const first = await sampler.stop();
  const second = await sampler.stop();
  assert.equal(first.active, false);
  assert.equal(second.active, false);
  assert.ok(first.errors >= 1);
  assert.equal(timers.size(), 0);
});

test('stop reste borné pendant Profiler.enable et empêche le démarrage tardif', async () => {
  const timers = fakeTimers();
  let enableCallback;
  let starts = 0;
  let disconnected = 0;
  const sampler = createCpuSampler({ timers, sessionFactory: () => ({
    connect() {}, disconnect() { disconnected += 1; },
    post(method, _params, callback) {
      if (method === 'Profiler.enable') { enableCallback = callback; return; }
      if (method === 'Profiler.start') starts += 1;
      callback(null, {});
    },
  }) });
  sampler.start();
  timers.runOne();
  await new Promise((resolve) => setImmediate(resolve));
  const report = await sampler.stop();
  assert.equal(report.active, false);
  assert.equal(disconnected, 1);
  enableCallback(null, {});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(starts, 0);
  assert.equal(timers.size(), 0);
});

test('la durée de Profiler.start est mesurée à part : coût propre de la sonde', async () => {
  const timers = fakeTimers();
  let clock = 1000;
  const sampler = createCpuSampler({ timers, profileMs: 5, intervalMs: 60, monotonic: () => clock, sessionFactory: () => ({
    connect() {}, disconnect() {},
    post(method, _params, callback) {
      if (method === 'Profiler.start') clock += 250; // V8 parcourt le tas, thread principal bloqué.
      callback(null, method === 'Profiler.stop' ? { profile: { nodes: [], samples: [], timeDeltas: [] } } : {});
    },
  }) });
  assert.deepEqual(sampler.snapshot().startStallMs, { count: 0, total: 0, max: 0 });
  sampler.start(); timers.runOne(); await new Promise((resolve) => setImmediate(resolve));
  const report = await sampler.stop();
  assert.deepEqual(report.startStallMs, { count: 1, total: 250, max: 250 });
});

function recordingTimers() {
  const delays = [];
  return { delays, setTimeout(_fn, delay) { delays.push(delay); return { unref() {} }; }, clearTimeout() {} };
}

test('première fenêtre au début de la mesure, démarrages des slots jamais simultanés', () => {
  const firstDelay = (options) => {
    const timers = recordingTimers();
    const sampler = createCpuSampler({ timers, sessionFactory: () => ({}), ...options });
    sampler.start();
    return timers.delays[0];
  };
  const delays = Array.from({ length: 12 }, (_, slot) => firstDelay({ slot }));
  assert.equal(delays[0], 0, 'le slot 0 profile dès le début');
  assert.equal(delays[5], 7500, 'six workers ont tous démarré une fenêtre en moins de 8 s');
  const sorted = [...delays].sort((a, b) => a - b);
  for (let index = 1; index < sorted.length; index++) assert.ok(sorted[index] - sorted[index - 1] >= 1500);
  // Grille commune ancrée sur le début de la mesure.
  const anchorAt = 1_000_000;
  assert.equal(firstDelay({ slot: 2, anchorAt, now: () => anchorAt + 100 }), 2900);
  assert.equal(firstDelay({ slot: 2, anchorAt, now: () => anchorAt - 4000 }), 7000, 'chauffe : attendre le créneau commun');
  assert.equal(firstDelay({ slot: 0, anchorAt, now: () => anchorAt + 1200 }), 8800, 'worker lent au démarrage : sous-grille de 10 s');
  assert.equal(firstDelay({ slot: 1, anchorAt, now: () => anchorAt + 90_000 }), 31_500, 'remplaçant : prochain créneau de son slot');
  // Temps de chargement différents (cas d'un redémarrage) : les slots gardent leur écart.
  const slot0 = 4000 + firstDelay({ slot: 0, anchorAt, now: () => anchorAt + 4000 });
  const slot1 = 2600 + firstDelay({ slot: 1, anchorAt, now: () => anchorAt + 2600 });
  assert.ok(Math.abs(slot1 - slot0) >= 1500, `slot 0 à ${slot0} ms, slot 1 à ${slot1} ms`);
});

test('les fenêtres suivantes restent sur la grille commune malgré les minuteurs en retard', () => {
  const anchorAt = 1_000_000;
  const run = (slot, bootAt, lateness) => {
    let clock = bootAt;
    const pending = [];
    const timers = { setTimeout(fn, delay) { const timer = { fn, delay, unref() {} }; pending.push(timer); return timer; }, clearTimeout() {} };
    const sampler = createCpuSampler({ slot, anchorAt, now: () => clock, timers, sessionFactory: () => { throw new Error('off'); } });
    sampler.start();
    const starts = [];
    for (const late of lateness) {
      const timer = pending.shift();
      clock += timer.delay + late; // Boucle d'événements chargée : le minuteur part en retard.
      starts.push(clock - anchorAt);
      timer.fn();
    }
    return starts;
  };
  // Le retard d'une minute ne décale pas la suivante : créneau à 3 s + k minutes.
  assert.deepEqual(run(2, anchorAt + 100, [0, 400, 700, 300, 0]), [3000, 63_400, 123_700, 183_300, 243_000]);
  // Worker lent au démarrage : première fenêtre sur la sous-grille de 10 s, puis grille de la minute.
  assert.deepEqual(run(1, anchorAt + 3000, [0, 0, 0]), [11_500, 61_500, 121_500]);
});

test('une très courte fenêtre inspector locale se termine sans port de débogage', async () => {
  const sampler = createCpuSampler({ profileMs: 5, intervalMs: 60000, samplingIntervalUs: 1000 });
  sampler.start();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const report = await sampler.stop();
  assert.equal(report.active, false);
  assert.ok(report.windows <= 1);
  assert.ok(Number.isFinite(report.sampledDurationMs));
});
