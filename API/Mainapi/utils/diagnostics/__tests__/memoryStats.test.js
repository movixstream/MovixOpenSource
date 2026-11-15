'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const v8 = require('node:v8');
const vm = require('node:vm');
const { createGcTracker, heapSummary, parseSmapsRollup, createSmapsReader } = require('../memoryStats');

test('les pauses GC sont cumulées par type puis remises à zéro à chaque relevé', () => {
  const tracker = createGcTracker();
  for (const [kind, duration] of [[1, 2.5], [1, 1.5], [4, 30], [8, 3], [16, 0.25], [64, 1]]) tracker.add({ detail: { kind }, duration });
  assert.deepEqual(tracker.take(), { count: 6, durationMs: 38.25, byKind: {
    minor: { count: 2, durationMs: 4 }, major: { count: 1, durationMs: 30 }, incremental: { count: 1, durationMs: 3 },
    weakcb: { count: 1, durationMs: 0.25 }, other: { count: 1, durationMs: 1 },
  } });
  assert.deepEqual(tracker.take(), { count: 0, durationMs: 0, byKind: {} });
});

test('un vrai GC majeur est observé via perf_hooks', async () => {
  v8.setFlagsFromString('--expose-gc');
  const gc = vm.runInNewContext('gc');
  const tracker = createGcTracker();
  assert.equal(tracker.start(), true);
  gc();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const totals = tracker.take();
  tracker.stop();
  assert.ok(totals.byKind.major?.count >= 1, JSON.stringify(totals));
  assert.ok(totals.durationMs > 0);
});

test('le résumé du tas garde les espaces principaux, malloc et la mémoire externe', () => {
  const summary = heapSummary();
  for (const space of ['new_space', 'old_space', 'code_space', 'large_object_space', 'other']) {
    assert.ok(Number.isFinite(summary.spaces[space].usedBytes), space);
    assert.ok(Number.isFinite(summary.spaces[space].sizeBytes), space);
  }
  assert.ok(summary.spaces.old_space.usedBytes > 0);
  for (const field of ['mallocedBytes', 'externalBytes', 'totalPhysicalBytes']) assert.ok(Number.isFinite(summary[field]), field);
});

test('smaps_rollup : lecture Linux asynchrone, jamais d’exception ailleurs ou sans fichier', async () => {
  const text = '55d0c0a00000-7ffd5b1fe000 ---p 00000000 00:00 0 [rollup]\nRss:             1203400 kB\nPss:              1190000 kB\nShared_Clean:      51200 kB\nPrivate_Dirty:   1100000 kB\nAnonymous:       1099000 kB\n';
  assert.deepEqual(parseSmapsRollup(text), { rssBytes: 1203400 * 1024, sharedCleanBytes: 51200 * 1024, privateDirtyBytes: 1100000 * 1024, anonymousBytes: 1099000 * 1024 });
  assert.equal(parseSmapsRollup(''), null);
  let reads = 0;
  const windows = createSmapsReader({ platform: 'win32', read: () => { reads++; return text; } });
  assert.equal(windows.refresh(), null);
  assert.equal(windows.latest(), null);
  assert.equal(reads, 0);
  const linux = createSmapsReader({ platform: 'linux', read: async () => text });
  await linux.refresh(42);
  assert.equal(linux.latest().at, 42);
  assert.equal(linux.latest().privateDirtyBytes, 1100000 * 1024);
  const missing = createSmapsReader({ platform: 'linux', read: () => { throw new Error('ENOENT'); } });
  await missing.refresh();
  assert.equal(missing.available, false);
  assert.equal(missing.refresh(), null, 'plus de tentative après un échec');
});
