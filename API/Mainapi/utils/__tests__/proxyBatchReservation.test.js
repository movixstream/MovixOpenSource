'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Faux Redis qui applique la règle du script Lua : clés dans l'ordre, SET NX
// tant que le plafond du groupe et le total le permettent.
function fakeRedis({ failing = false } = {}) {
  const reserved = new Set();
  const calls = [];
  return {
    reserved,
    calls,
    async eval(script, numKeys, ...args) {
      calls.push({ script, numKeys, args });
      if (failing) throw new Error('Redis indisponible');
      const keys = args.slice(0, numKeys);
      const argv = args.slice(numKeys);
      const maxTotal = Number(argv[2]);
      const counts = new Map();
      const picked = [];
      keys.forEach((key, index) => {
        if (picked.length >= maxTotal) return;
        const [, group, cap] = /^(.*):(\d+)$/.exec(argv[3 + index]);
        const used = counts.get(group) || 0;
        if (used >= Number(cap) || reserved.has(key)) return;
        reserved.add(key);
        counts.set(group, used + 1);
        picked.push(index + 1);
      });
      return picked;
    },
  };
}

function load(redis) {
  const filename = path.resolve(__dirname, '../proxyManager.js');
  const code = fs.readFileSync(filename, 'utf8');
  const start = code.indexOf('function buildProxyRateLimitKey(');
  const end = code.indexOf('setInterval(() => {', code.indexOf('async function reserveRateLimitedProxyBatch('));
  assert.ok(start > 0 && end > start);
  const context = vm.createContext({
    crypto,
    redis,
    proxyRateLimitState: new Map(),
    PROXY_RATE_LIMIT_REDIS_PREFIX: 'proxyscrape:rate-limit:v1',
  });
  vm.runInContext(`${code.slice(start, end)}\nglobalThis.reserve = reserveRateLimitedProxyBatch;`, context, { filename });
  return context.reserve;
}

const entry = (host, group, cap) => ({ proxy: { type: 'http', host, port: 8080, auth: '' }, group, cap, host });

test('un seul appel Redis réserve le préféré, trois ProxyScrape puis un proxy configuré', async () => {
  const redis = fakeRedis();
  const reserve = load(redis);
  const entries = [
    entry('preferred.test', 'preferred', 1),
    ...Array.from({ length: 6 }, (_, i) => entry(`ps-${i}.test`, 'proxyscrape', 3)),
    entry('socks.test', 'others', 4),
  ];
  const picked = await reserve('WIFLIX', entries, { minIntervalMs: 1000, maxTotal: 4, digestIdentity: true });
  assert.deepEqual(picked.map(p => p.host), ['preferred.test', 'ps-0.test', 'ps-1.test', 'ps-2.test']);
  assert.equal(redis.calls.length, 1);
  const [{ numKeys, args }] = redis.calls;
  assert.equal(numKeys, entries.length);
  assert.equal(args[numKeys], 1000);
  assert.equal(args[numKeys + 2], 4);
  assert.equal(args[numKeys + 3], 'preferred:1');
  assert.ok(args.slice(0, numKeys).every(key => /^proxyscrape:rate-limit:v1:WIFLIX:[0-9a-f]{64}$/.test(key)));
});

test('les proxys déjà réservés sont sautés et le proxy configuré complète la liste', async () => {
  const redis = fakeRedis();
  const reserve = load(redis);
  const entries = [
    ...Array.from({ length: 3 }, (_, i) => entry(`ps-${i}.test`, 'proxyscrape', 3)),
    entry('socks.test', 'others', 4),
  ];
  await reserve('WIFLIX', entries.slice(0, 2), { minIntervalMs: 1000, maxTotal: 4 });
  const picked = await reserve('WIFLIX', entries, { minIntervalMs: 1000, maxTotal: 4 });
  assert.deepEqual(picked.map(p => p.host), ['ps-2.test', 'socks.test']);
});

test('sans Redis, la réservation locale garde les mêmes plafonds', async () => {
  const reserve = load(fakeRedis({ failing: true }));
  const entries = Array.from({ length: 5 }, (_, i) => entry(`ps-${i}.test`, 'proxyscrape', 3));
  // Tableaux créés dans le contexte vm : on les recopie avant de comparer.
  const first = await reserve('WIFLIX', entries, { minIntervalMs: 1000, maxTotal: 4 });
  assert.deepEqual(Array.from(first, p => p.host), ['ps-0.test', 'ps-1.test', 'ps-2.test']);
  const second = await reserve('WIFLIX', entries, { minIntervalMs: 1000, maxTotal: 4 });
  assert.deepEqual(Array.from(second, p => p.host), ['ps-3.test', 'ps-4.test']);
});
