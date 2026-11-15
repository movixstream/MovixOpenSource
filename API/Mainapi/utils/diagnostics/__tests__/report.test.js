'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReport, renderMarkdown } = require('../report');

const MiB = 1048576;
const row = (markdown, start) => markdown.split('\n').find((line) => line.startsWith(start));

function state(workers) {
  return { mode: 'analyse', warmupMs: 300000, startedAt: 1000, measurementStartedAt: 301000, endsAt: 3901000,
    reason: 'running', system: [], processes: new Map(), warnings: {}, sampleMs: 5000, snapshotMs: 30000,
    workers: new Map(workers.map((worker) => [worker.pid, worker])) };
}
const point = (values) => ({ at: 306000, elapsedMs: 5000, cpuUsageUs: 0, cpuPercent: 0, memory: { rss: 100 * MiB },
  eventLoopUtilization: 0, eventLoopP99Ms: 0, eventLoopMaxMs: 0, operations: [], ...values });

test('un relevé de capture de 3 ms à 175 % ne devient pas le pic du worker', () => {
  const worker = { pid: 44, slot: 1, final: false, metrics: { groups: [], sockets: [], warnings: {} },
    cpuProfile: { windows: 2, functions: [], errors: 0, startStallMs: { count: 2, total: 1150, max: 678 } },
    resources: [
      point({ cpuUsageUs: 3347976, cpuPercent: 61.2, eventLoopP99Ms: 9.5, eventLoopMaxMs: 473 }),
      point({ at: 306004, elapsedMs: 3.8, cpuUsageUs: 6722, cpuPercent: 174.7, eventLoopP99Ms: 30, capture: true }),
    ] };
  const markdown = renderMarkdown(buildReport(state([worker])));
  const line = row(markdown, '| 44 / 1 |');
  assert.match(line, /\| 61\.2 \|/);
  assert.doesNotMatch(line, /174\.7|30\.0/);
  assert.match(line, /\| 9\.5 \| 473\.0 \| 2 \| 2 \/ 1150\.0 \/ 678\.0 \|/, 'pic de blocage et démarrages du profileur visibles');
});

test('les erreurs entrantes séparent 4xx, 404 « pas de contenu », 5xx et abandons ; les appels en cours sont visibles', () => {
  const group = (values) => ({ kind: 'inbound', source: 'route', destination: 'mainapi', byteMode: 'encoded-body', aggregation: 'operation',
    started: 0, completed: 0, failed: 0, sentBytes: 0, receivedBytes: 0, durationMs: 0, maxDurationMs: 0, maxReceivedBytes: 0,
    unknownResponses: 0, rows: 0, statuses: {}, histogram: Array(16).fill(0), ...values });
  const metrics = { warnings: {}, sockets: [{ label: 'http:flemmix.land', connections: 7, receivedBytes: 0, sentBytes: 0 }], groups: [
    group({ operation: 'GET mainapi/api/fstream/movie/:id', started: 166, completed: 121, failed: 98, durationMs: 88088,
      statuses: { 200: 24, 404: 58, 403: 2, 503: 38 } }),
    group({ operation: 'GET mainapi/api/links/movie/:id', started: 10, completed: 10, failed: 1, statuses: { 200: 10 } }),
    group({ kind: 'http', operation: 'GET flemmix.land/', destination: 'flemmix.land', started: 1655, completed: 1010, failed: 0, statuses: { 200: 1010 } }),
  ] };
  const markdown = renderMarkdown(buildReport(state([{ pid: 43, slot: 0, final: true, metrics, resources: [] }])));
  assert.match(markdown, /\| Route \| Appels \| En cours \| Réponses MiB \| Moyenne ms \(terminées\) \| 4xx \| dont 404 \(pas de contenu\) \| 5xx \| Abandons \/ transport \|/);
  assert.match(row(markdown, '| GET mainapi/api/fstream/movie/:id |'), /\| 166 \| 45 \| 0\.00 \| 728\.0 \| 60 \| 58 \| 38 \| 0 \|/);
  assert.match(row(markdown, '| GET mainapi/api/links/movie/:id |'), /\| 10 \| 0 \| 0\.00 \| 0\.0 \| 0 \| 0 \| 0 \| 1 \|/);
  assert.match(row(markdown, '| flemmix.land |'), /\| 1655 \| 645 \|/);
  assert.match(markdown, /## Sockets Node observées/);
  assert.match(markdown, /Sockets observées \(ouvertes au début \+ nouvelles\)/);
  assert.doesNotMatch(markdown, /## Connexions Node/);
});

test('le tableau mémoire et GC montre pauses par type, tas V8 et smaps_rollup', () => {
  const heap = { spaces: { old_space: { usedBytes: 512 * MiB, sizeBytes: 600 * MiB }, new_space: { usedBytes: 8 * MiB, sizeBytes: 16 * MiB } },
    mallocedBytes: 20 * MiB, externalBytes: 60 * MiB, totalPhysicalBytes: 700 * MiB };
  const worker = { pid: 51, slot: 3, final: true, metrics: { groups: [], sockets: [], warnings: {} }, cpuProfile: { windows: 0, functions: [] },
    resources: [
      point({ gc: { count: 12, durationMs: 400, byKind: { minor: { count: 10, durationMs: 100 }, major: { count: 2, durationMs: 300 } } }, heap }),
      point({ at: 311000, gc: { count: 5, durationMs: 100, byKind: { minor: { count: 5, durationMs: 100 } } }, heap,
        smapsRollup: { at: 310000, rssBytes: 1200 * MiB, privateDirtyBytes: 1100 * MiB, sharedCleanBytes: 50 * MiB, anonymousBytes: 1090 * MiB } }),
    ] };
  const report = buildReport(state([worker]));
  assert.equal(report.schemaVersion, 4);
  assert.equal(report.configuration.eventLoopResolutionMs, 20);
  const line = row(renderMarkdown(report), '| 51 / 3 | 500.0');
  assert.equal(line, '| 51 / 3 | 500.0 (5.0) | 400.0 | 15 / 200.0 | 2 / 300.0 | 0 / 0.0 | 512.00 | 8.00 | 20.00 | 60.00 | 1100.00 | 50.00 |');
  const empty = row(renderMarkdown(buildReport(state([{ ...worker, resources: [point({})] }]))), '| 51 / 3 | n/d');
  assert.ok(empty, 'anciens relevés sans GC : n/d plutôt que zéro');
});
