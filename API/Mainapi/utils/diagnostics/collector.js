'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const { performance } = require('node:perf_hooks');

const LATENCY_BUCKETS_MS = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000, 300000, null];
const NOOP_SPAN = Object.freeze({ send() {}, receive() {}, markUnmeasured() {}, finish() {} });
const clean = (value, length = 240) => String(value ?? '').replace(/[\r\n\t]/g, ' ').slice(0, length);
const count = (value) => Number.isFinite(value) && value > 0 ? value : 0;
const FALLBACK_KINDS = new Set(['http', 'fetch', 'cycletls', 'impit', 'inbound', 'redis', 'mysql', 'job']);
const FALLBACK_BYTE_MODES = new Set(['encoded-body', 'decoded-body', 'redis-values', 'sql-text', 'unavailable']);

function createCollector(options = {}) {
  const now = options.now || Date.now;
  const monotonic = options.monotonic || (() => performance.now());
  const maxGroups = options.maxGroups || 1024;
  const maxDestinationGroups = options.maxDestinationGroups || 256;
  const maxSockets = options.maxSockets || 2048;
  const maxActive = options.maxActive || 8192;
  const context = new AsyncLocalStorage();
  const groups = new Map();
  const destinationGroups = new Map();
  const fallbackGroups = new Map();
  const sockets = new Map();
  const socketGroups = new Map();
  const warnings = new Map();
  const heavy = { receivedBytes: [], durationMs: [] };
  let active = true;
  let recording = !options.paused;
  let openSpans = 0;

  function warn(code) {
    const key = warnings.has(code) || warnings.size < 64 ? clean(code, 100) : 'other';
    warnings.set(key, (warnings.get(key) || 0) + 1);
  }

  function sourceOf(store) {
    if (!store) return 'background/startup';
    if (typeof store === 'string') return store;
    // Chaîne lancée pendant la chauffe : ni la requête ni ses appels de départ ne sont mesurés.
    if (store.warmup) return 'background/startup';
    // Travail détaché après la réponse (rafraîchissement lancé sans attente, par exemple).
    if (store.responded || safeResponded(store)) return `background after ${store.source}`;
    return store.source;
  }
  function safeResponded(store) {
    try { return Boolean(store.isResponded?.()); } catch { return false; }
  }

  function labelsFor(meta) {
    return {
      kind: clean(meta.kind || 'unknown', 32),
      source: clean(meta.source || sourceOf(context.getStore())),
      destination: clean(meta.destination || 'local', 180),
      operation: clean(meta.operation || 'unknown'),
      byteMode: clean(meta.byteMode || 'unavailable', 40),
    };
  }

  function groupFor(label, example) {
    let key = JSON.stringify(label), target = groups;
    if (target.has(key)) return target.get(key);
    let groupedLabel = { ...label, aggregation: 'operation' };
    if (target.size >= maxGroups) {
      warn('group_budget_exceeded');
      // Detail and destination budgets are independent. HTTP, inbound, Redis and
      // SQL must retain their own counters and units after detail is exhausted.
      target = destinationGroups;
      key = JSON.stringify([label.kind, label.destination, label.byteMode]);
      if (target.has(key)) return target.get(key);
      groupedLabel = { ...label, aggregation: 'destination', source: 'routes/tâches regroupées (limite de détail)',
        operation: `${label.destination} (opérations regroupées)` };
      if (target.size >= maxDestinationGroups) {
        warn('destination_group_budget_exceeded');
        target = fallbackGroups;
        const kind = FALLBACK_KINDS.has(label.kind) ? label.kind : 'unknown';
        const byteMode = FALLBACK_BYTE_MODES.has(label.byteMode) ? label.byteMode : 'unavailable';
        key = JSON.stringify([kind, byteMode]);
        groupedLabel = { ...groupedLabel, kind, byteMode, aggregation: 'kind',
          destination: 'destinations regroupées (limite atteinte)', operation: `${kind} (destinations regroupées)` };
      }
    }
    if (!target.has(key)) target.set(key, {
      ...groupedLabel, example: groupedLabel.aggregation === 'operation' ? example : '', started: 0, completed: 0, failed: 0,
      sentBytes: 0, receivedBytes: 0, durationMs: 0, maxDurationMs: 0,
      maxReceivedBytes: 0, unknownResponses: 0, rows: 0, statuses: {}, histogram: LATENCY_BUCKETS_MS.map(() => 0),
    });
    return target.get(key);
  }

  function keepHeavy(entry, field) {
    const list = heavy[field];
    if (list.length >= 40 && entry[field] <= list[list.length - 1][field]) return;
    const index = list.findIndex((old) => old[field] < entry[field]);
    list.splice(index < 0 ? list.length : index, 0, entry);
    if (list.length > 40) list.pop();
  }

  function start(meta) {
    if (!active || !recording) return NOOP_SPAN;
    const label = labelsFor(meta);
    const example = clean(meta.example, 512);
    const group = groupFor(label, example);
    group.started++;
    if (openSpans >= maxActive) {
      warn('active_span_budget_exceeded');
      return NOOP_SPAN;
    }
    openSpans++;
    const startedAt = now();
    const tick = monotonic();
    let finished = false;
    let sentBytes = 0;
    let receivedBytes = 0;
    let unknownResponse = false;
    return {
      markUnmeasured() {
        if (active && !finished && !unknownResponse) { group.unknownResponses++; unknownResponse = true; }
      },
      send(bytes) {
        if (!active || finished) return;
        const amount = count(bytes); sentBytes += amount; group.sentBytes += amount;
      },
      receive(bytes) {
        if (!active || finished) return;
        const amount = count(bytes); receivedBytes += amount; group.receivedBytes += amount;
      },
      finish(result = {}) {
        if (finished) return;
        finished = true; openSpans--;
        if (!active) return;
        const durationMs = Math.max(0, monotonic() - tick);
        const status = Number.isInteger(Number(result.status)) && Number(result.status) >= 100 && Number(result.status) <= 599
          ? String(result.status) : result.error ? 'transport-error' : 'ok';
        group.completed++;
        group.failed += result.error || Number(status) >= 400 ? 1 : 0;
        group.durationMs += durationMs;
        group.maxDurationMs = Math.max(group.maxDurationMs, durationMs);
        group.maxReceivedBytes = Math.max(group.maxReceivedBytes, receivedBytes);
        group.rows += count(result.rows);
        group.statuses[status] = (group.statuses[status] || 0) + 1;
        group.histogram[LATENCY_BUCKETS_MS.findIndex((limit) => limit === null || durationMs <= limit)]++;
        if (label.kind !== 'inbound') {
          // Use this call's labels, never the first example of an aggregate.
          const entry = { ...label, example,
            startedAt, finishedAt: now(), status, durationMs, sentBytes, receivedBytes };
          keepHeavy(entry, 'receivedBytes'); keepHeavy(entry, 'durationMs');
        }
      },
    };
  }

  function flushSocket(socket, state) {
    const rx = count(socket.bytesRead), tx = count(socket.bytesWritten);
    if (recording) {
      state.group.receivedBytes += Math.max(0, rx - state.rx);
      state.group.sentBytes += Math.max(0, tx - state.tx);
    }
    state.rx = rx; state.tx = tx;
  }

  function trackSocket(socket, label) {
    if (!active || !socket || sockets.has(socket)) return;
    if (sockets.size >= maxSockets) { warn('socket_budget_exceeded'); return; }
    let key = clean(label || 'unknown', 180);
    if (!socketGroups.has(key) && socketGroups.size >= 256) { key = 'other'; warn('socket_group_budget_exceeded'); }
    if (!socketGroups.has(key)) socketGroups.set(key, { label: key, connections: 0, receivedBytes: 0, sentBytes: 0 });
    const group = socketGroups.get(key);
    if (recording) group.connections++;
    const state = { group, rx: count(socket.bytesRead), tx: count(socket.bytesWritten) };
    state.close = () => { flushSocket(socket, state); sockets.delete(socket); };
    sockets.set(socket, state);
    socket.once('close', state.close);
  }

  return {
    get active() { return active; },
    get recording() { return active && recording; },
    begin() {
      if (!active || recording) return;
      // Les clients sont instrumentés au chargement. Repartir des compteurs
      // courants des connexions persistantes exclut tout le trafic de chauffe.
      for (const [socket, state] of sockets) {
        state.rx = count(socket.bytesRead); state.tx = count(socket.bytesWritten);
        state.group.connections++;
      }
      recording = true;
    },
    start, warn, trackSocket,
    // Le contexte est un objet : la route peut signaler sa réponse (responded) sans changer de contexte.
    withSource(source, fn) {
      if (!active) return fn();
      const store = { source: clean(source), responded: false, warmup: !recording };
      return context.run(store, () => fn(store));
    },
    snapshot() {
      for (const [socket, state] of sockets) flushSocket(socket, state);
      return {
        at: now(), active, recording: active && recording, openSpans,
        groups: [...groups.values(), ...destinationGroups.values(), ...fallbackGroups.values()]
          .map((group) => ({ ...group, statuses: { ...group.statuses }, histogram: [...group.histogram] })),
        sockets: Array.from(socketGroups.values(), (group) => ({ ...group })).filter((group) => group.connections > 0),
        warnings: Object.fromEntries(warnings),
        heaviest: { receivedBytes: [...heavy.receivedBytes], durationMs: [...heavy.durationMs] },
        latencyBucketsMs: LATENCY_BUCKETS_MS,
      };
    },
    stop() {
      if (!active) return;
      for (const [socket, state] of sockets) {
        flushSocket(socket, state); socket.removeListener('close', state.close);
      }
      sockets.clear(); active = false; context.disable();
    },
  };
}

module.exports = { createCollector, LATENCY_BUCKETS_MS };
