'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createCollector } = require('../collector');
const { aggregateGroups, renderMarkdown, buildReport } = require('../report');

test('concurrent sources, bytes, errors and latency are counted exactly once', async () => {
  let clock = 100;
  const collector = createCollector({ now: () => clock, monotonic: () => clock });
  await Promise.all(['KissKH', 'TMDB'].map((source) => collector.withSource(source, async () => {
    await Promise.resolve();
    const span = collector.start({ kind: 'http', operation: 'GET /page', byteMode: 'encoded-body' });
    span.send(10); span.receive(1024); span.receive(-5);
    clock += 50;
    span.finish({ status: source === 'KissKH' ? 429 : 200 });
    span.finish({ status: 200 }); span.receive(999);
  })));
  const snapshot = collector.snapshot();
  assert.equal(snapshot.groups.length, 2);
  assert.deepEqual(snapshot.groups.map((row) => row.source).sort(), ['KissKH', 'TMDB']);
  assert.equal(snapshot.groups.reduce((sum, row) => sum + row.completed, 0), 2);
  assert.equal(snapshot.groups.reduce((sum, row) => sum + row.failed, 0), 1);
  assert.ok(snapshot.groups.every((row) => row.receivedBytes === 1024 && row.durationMs === 50));
  assert.equal(snapshot.openSpans, 0);
  collector.stop();
});

test('group and active budgets bound memory while preserving started counts', () => {
  const collector = createCollector({ maxGroups: 2, maxActive: 3 });
  const spans = [];
  for (let index = 0; index < 20; index++) spans.push(collector.start({ operation: `query-${index}` }));
  const snapshot = collector.snapshot();
  assert.equal(snapshot.groups.length, 3);
  assert.equal(snapshot.groups.reduce((sum, row) => sum + row.started, 0), 20);
  assert.equal(snapshot.openSpans, 3);
  assert.equal(snapshot.warnings.active_span_budget_exceeded, 17);
  spans.forEach((span) => span.finish());
  assert.equal(collector.snapshot().openSpans, 0);
  collector.stop();
});

test('socket reuse counts deltas once and stop detaches listeners', () => {
  const collector = createCollector();
  const socket = Object.assign(new EventEmitter(), { bytesRead: 10, bytesWritten: 15 });
  collector.trackSocket(socket, 'redis'); collector.trackSocket(socket, 'redis');
  socket.bytesRead += 20; socket.bytesWritten += 30;
  assert.deepEqual(collector.snapshot().sockets[0], { label: 'redis', connections: 1, receivedBytes: 20, sentBytes: 30 });
  collector.snapshot(); socket.bytesRead += 40;
  collector.stop();
  assert.equal(socket.listenerCount('close'), 0);
  assert.equal(collector.snapshot().sockets[0].receivedBytes, 60);
  collector.start({ kind: 'http' }).receive(500);
  assert.equal(collector.snapshot().groups.length, 0);
});

test('la chauffe exclut les anciens appels et remet les sockets persistants à leur valeur courante', () => {
  const collector = createCollector({ paused: true });
  const socket = Object.assign(new EventEmitter(), { bytesRead: 1000, bytesWritten: 100 });
  const closed = Object.assign(new EventEmitter(), { bytesRead: 0, bytesWritten: 0 });
  collector.trackSocket(socket, 'redis'); collector.trackSocket(closed, 'closed');
  const old = collector.start({ kind: 'redis', operation: 'warmup' });
  old.receive(1000);
  socket.bytesRead += 9000; socket.bytesWritten += 500;
  closed.bytesRead += 10000; closed.emit('close');
  assert.equal(collector.active, true, 'les adaptateurs peuvent s’installer avant le début des mesures');
  assert.equal(collector.recording, false);
  assert.deepEqual(collector.snapshot().groups, []);
  assert.deepEqual(collector.snapshot().sockets, []);
  collector.begin();
  old.receive(3000); old.finish();
  const current = collector.start({ kind: 'redis', operation: 'measured' });
  current.receive(50); current.finish();
  socket.bytesRead += 50; socket.bytesWritten += 10;
  collector.begin(); // Ne remet pas à zéro une fenêtre déjà commencée.
  collector.stop();
  const snapshot = collector.snapshot();
  assert.equal(snapshot.groups.length, 1);
  assert.equal(snapshot.groups[0].operation, 'measured');
  assert.equal(snapshot.groups[0].receivedBytes, 50);
  assert.deepEqual(snapshot.sockets, [{ label: 'redis', connections: 1, receivedBytes: 50, sentBytes: 10 }]);
  collector.begin();
  assert.equal(collector.recording, false, 'un arrêt est définitif');
});

test('le travail lancé après la réponse et les chaînes de la chauffe ne sont pas attribués à la route', async () => {
  const collector = createCollector({ paused: true });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  // Chaîne commencée pendant la chauffe et qui appelle après le début de la mesure.
  const warmupChain = collector.withSource('route GET /api/wiflix/movie/:id', async () => {
    await gate;
    collector.start({ kind: 'http', destination: 'flemmix.test', operation: 'POST flemmix.test/' }).finish({ status: 200 });
  });
  collector.begin();
  release(); await warmupChain;
  await collector.withSource('route GET /api/wiflix/movie/:id', async (store) => {
    collector.start({ kind: 'http', destination: 'flemmix.test', operation: 'GET flemmix.test/' }).finish({ status: 200 });
    store.responded = true;
    // Rafraîchissement lancé sans attente après la réponse 202.
    await Promise.resolve();
    collector.start({ kind: 'http', destination: 'flemmix.test', operation: 'GET flemmix.test/' }).finish({ status: 200 });
  });
  await collector.withSource('route GET /api/tmdb/movie/:id', async (store) => {
    let headersSent = false;
    store.isResponded = () => headersSent;
    collector.start({ kind: 'redis', destination: 'redis', operation: 'GET tmdb' }).finish();
    headersSent = true;
    collector.start({ kind: 'redis', destination: 'redis', operation: 'GET tmdb' }).finish();
  });
  const sources = collector.snapshot().groups.map((row) => `${row.operation} <- ${row.source}`).sort();
  assert.deepEqual(sources, [
    'GET flemmix.test/ <- background after route GET /api/wiflix/movie/:id',
    'GET flemmix.test/ <- route GET /api/wiflix/movie/:id',
    'GET tmdb <- background after route GET /api/tmdb/movie/:id',
    'GET tmdb <- route GET /api/tmdb/movie/:id',
    'POST flemmix.test/ <- background/startup',
  ]);
  collector.stop();
});

test('detail overflow retains destinations, protocol totals and each heavy call attribution', () => {
  const collector = createCollector({ maxGroups: 1 });
  const calls = [
    ['http', 'site.test', 'GET /items/:id', 'encoded-body', '/items/1?page=1', 10],
    ['inbound', 'mainapi', 'GET /incoming', 'encoded-body', '/incoming', 9000],
    ['redis', 'redis', 'GET catalogue', 'redis-values', 'GET catalogue', 80],
    ['cycletls', 'cine.test', 'GET /page', 'decoded-body', '/page', 200],
    ['http', 'site.test', 'GET /items/:id', 'encoded-body', '/items/2?page=2', 1000],
    ['http', 'site.test', 'GET /new', 'encoded-body', '/new?page=3', 2000],
    ['mysql', 'mysql', 'SELECT query', 'sql-text', 'SELECT query', 0],
    ['http', 'kisskh.test', 'GET /catalogue', 'encoded-body', '/catalogue', 5],
  ];
  for (const [kind, destination, operation, byteMode, example, received] of calls) {
    collector.withSource('route GET /catalogue', () => {
      const span = collector.start({ kind, destination, operation, byteMode, example });
      span.receive(received); span.send(5);
      if (kind === 'mysql') span.markUnmeasured();
      span.finish({ status: destination === 'kisskh.test' ? 429 : 200 });
    });
  }
  const snapshot = collector.snapshot();
  assert.ok(snapshot.groups.every((row) => row.kind !== 'overflow' && row.byteMode !== 'mixed'));
  assert.ok(snapshot.groups.filter((row) => row.aggregation === 'destination').every((row) => row.example === ''));
  assert.equal(snapshot.heaviest.receivedBytes[0].destination, 'site.test');
  assert.equal(snapshot.heaviest.receivedBytes[0].example, '/new?page=3');
  assert.equal(snapshot.heaviest.receivedBytes[0].source, 'route GET /catalogue');
  assert.equal(snapshot.heaviest.receivedBytes[1].example, '/items/2?page=2', 'the detail group first example must not be reused');
  assert.ok(snapshot.heaviest.receivedBytes.every((row) => row.kind !== 'inbound'));
  const workers = new Map([1, 2].map((pid) => [pid, { pid, final: true, metrics: snapshot }]));
  const report = buildReport({ workers, system: [], processes: new Map(), warnings: {}, startedAt: 1, endsAt: 5000 });
  assert.equal(report.summary.outboundCalls, 10);
  assert.equal(report.summary.inboundCalls, 2);
  assert.equal(report.groups.reduce((sum, row) => sum + row.started, 0), calls.length * 2);
  const site = report.destinations.find((row) => row.destination === 'site.test');
  assert.equal(site.started, 6);
  assert.equal(site.receivedBytes, 6020);
  assert.equal(site.detailLimitedCalls, 2);
  assert.deepEqual(site.pids, [1, 2]);
  assert.equal(report.destinations.find((row) => row.kind === 'mysql').unknownResponses, 2);
  assert.equal(report.destinations.find((row) => row.destination === 'kisskh.test').failed, 2);
  assert.match(renderMarkdown(report), /Destinations par volume reçu/);
  collector.stop();
});

test('destination overflow stays bounded and keeps known protocol counts and units', () => {
  const collector = createCollector({ maxGroups: 1, maxDestinationGroups: 2 });
  const types = [['http', 'encoded-body'], ['inbound', 'encoded-body'], ['redis', 'redis-values'], ['mysql', 'sql-text']];
  for (let index = 0; index < 2000; index++) {
    const [kind, byteMode] = types[index % types.length];
    const span = collector.start({ kind, byteMode, destination: `host-${index}.test`, operation: `op-${index}` });
    span.receive(10); span.finish();
  }
  const snapshot = collector.snapshot();
  assert.equal(snapshot.groups.length, 7, 'one detail, two destinations, four fixed type/unit fallbacks');
  assert.equal(snapshot.warnings.destination_group_budget_exceeded, 1997);
  for (const [kind, byteMode] of types) {
    const groups = snapshot.groups.filter((row) => row.kind === kind);
    assert.equal(groups.reduce((sum, row) => sum + row.started, 0), 500);
    assert.equal(groups.reduce((sum, row) => sum + row.receivedBytes, 0), 5000);
    assert.ok(groups.every((row) => row.byteMode === byteMode));
  }
  for (let index = 0; index < 100; index++) collector.start({ kind: `unknown-${index}`, byteMode: `unknown-${index}`, destination: `host-${index}` }).finish();
  assert.equal(collector.snapshot().groups.length, 8, 'unknown type names cannot create unlimited fallback groups');
  collector.stop();
});

test('report sums each worker once and preserves byte modes and missing measurements', () => {
  const collector = createCollector();
  const one = collector.start({ kind: 'http', operation: 'GET /a|b', byteMode: 'encoded-body' });
  one.receive(100); one.finish({ status: 301 });
  const two = collector.start({ kind: 'cycletls', operation: 'GET /a|b', byteMode: 'decoded-body' });
  two.receive(200); two.finish();
  const worker = { pid: 1, slot: 0, final: true, metrics: collector.snapshot(), resources: [] };
  const groups = aggregateGroups([worker, { ...worker, pid: 2 }]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].receivedBytes, 200);
  const report = buildReport({ workers: new Map([[1, worker]]), system: [], processes: new Map(), warnings: {}, startedAt: 1, endsAt: 5000 });
  assert.equal(report.summary.networkReceivedBytes, null);
  assert.equal(report.summary.containerCpuMeanPercent, null);
  assert.equal(report.destinations.find((row) => row.kind === 'http').redirects, 1);
  assert.equal(report.destinations.find((row) => row.kind === 'http').failed, 0);
  assert.match(renderMarkdown(report), /GET \/a\\\|b/);
  assert.match(renderMarkdown(report), /indisponible/);
  collector.stop();
});
