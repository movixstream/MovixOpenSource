'use strict';

const fsp = require('node:fs/promises');
const v8 = require('node:v8');
const { PerformanceObserver, constants } = require('node:perf_hooks');

// entry.detail.kind est une constante numérique : la traduire explicitement.
const GC_KINDS = new Map([
  [constants?.NODE_PERFORMANCE_GC_MINOR ?? 1, 'minor'],
  [constants?.NODE_PERFORMANCE_GC_MAJOR ?? 4, 'major'],
  [constants?.NODE_PERFORMANCE_GC_INCREMENTAL ?? 8, 'incremental'],
  [constants?.NODE_PERFORMANCE_GC_WEAKCB ?? 16, 'weakcb'],
]);
const HEAP_SPACES = new Set(['new_space', 'old_space', 'code_space', 'large_object_space']);
const SMAPS_FIELDS = { Rss: 'rssBytes', Private_Dirty: 'privateDirtyBytes', Shared_Clean: 'sharedCleanBytes', Anonymous: 'anonymousBytes' };
const round = (value) => Math.round(value * 1000) / 1000;

// Cumule les pauses GC entre deux relevés ; take() rend le total et repart de zéro.
function createGcTracker(options = {}) {
  const Observer = options.Observer || PerformanceObserver;
  let totals = empty();
  let observer = null;
  function empty() { return { count: 0, durationMs: 0, byKind: {} }; }
  function add(entry) {
    const kind = GC_KINDS.get(entry?.detail?.kind ?? entry?.kind) || 'other';
    const duration = Number.isFinite(entry?.duration) && entry.duration > 0 ? entry.duration : 0;
    totals.count++; totals.durationMs += duration;
    const row = totals.byKind[kind] || (totals.byKind[kind] = { count: 0, durationMs: 0 });
    row.count++; row.durationMs += duration;
  }
  return {
    start() {
      if (observer) return true;
      try {
        observer = new Observer((list) => { for (const entry of list.getEntries()) add(entry); });
        observer.observe({ entryTypes: ['gc'] });
        return true;
      } catch { observer = null; return false; }
    },
    take() {
      const current = totals;
      totals = empty();
      current.durationMs = round(current.durationMs);
      for (const row of Object.values(current.byKind)) row.durationMs = round(row.durationMs);
      return current;
    },
    stop() { try { observer?.disconnect(); } catch { /* ignored */ } observer = null; },
    add,
  };
}

function heapSummary(api = v8) {
  const spaces = { other: { usedBytes: 0, sizeBytes: 0 } };
  for (const space of api.getHeapSpaceStatistics()) {
    const name = HEAP_SPACES.has(space.space_name) ? space.space_name : 'other';
    spaces[name] ||= { usedBytes: 0, sizeBytes: 0 };
    spaces[name].usedBytes += space.space_used_size || 0;
    spaces[name].sizeBytes += space.space_size || 0;
  }
  const stats = api.getHeapStatistics();
  return { spaces, mallocedBytes: stats.malloced_memory ?? null, peakMallocedBytes: stats.peak_malloced_memory ?? null,
    externalBytes: stats.external_memory ?? null, totalPhysicalBytes: stats.total_physical_size ?? null };
}

function parseSmapsRollup(text) {
  const result = {};
  for (const line of String(text || '').split('\n')) {
    const match = /^(\w+):\s+(\d+)\s+kB/.exec(line);
    if (match && SMAPS_FIELDS[match[1]]) result[SMAPS_FIELDS[match[1]]] = Number(match[2]) * 1024;
  }
  return Object.keys(result).length ? result : null;
}

// Lecture asynchrone : la valeur jointe à un relevé est la dernière lecture terminée.
// Hors Linux, ou si le fichier est absent, plus aucune tentative et jamais d'exception.
function createSmapsReader(options = {}) {
  const platform = options.platform || process.platform;
  const read = options.read || (() => fsp.readFile('/proc/self/smaps_rollup', 'utf8'));
  let available = platform === 'linux', reading = null, latest = null;
  return {
    get available() { return available; },
    latest() { return latest; },
    refresh(now = Date.now()) {
      if (!available || reading) return reading;
      reading = Promise.resolve().then(read).then((text) => {
        const parsed = parseSmapsRollup(text);
        if (parsed) latest = { at: now, ...parsed };
        else available = false;
      }, () => { available = false; }).finally(() => { reading = null; });
      return reading;
    },
  };
}

module.exports = { createGcTracker, heapSummary, parseSmapsRollup, createSmapsReader, GC_KINDS };
