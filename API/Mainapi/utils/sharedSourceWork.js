'use strict';
const { createHash, randomUUID } = require('node:crypto');
const { createSingleFlight } = require('./singleFlight');
const { compactRefreshError } = require('./refreshError');

const unavailable = () => Object.assign(new Error('Récupération de source temporairement indisponible'), {
  code: 'SOURCE_REFRESH_UNAVAILABLE',
});
const RENEW = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) end return 0';
const RELEASE = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) end return 0';
const PUBLISH = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("set", KEYS[2], ARGV[2], "PX", ARGV[3]) end return 0';

/** Un bail renouvelé couvre le scraping ET sa publication. Aucun HTML/objet Axios
 * n'est conservé ici. Les autres workers laissent le propriétaire terminer. */
function createSharedSourceWork({ redis = null, namespace, leaseMs = 45000, retryMs = 60000,
  maxInFlight = 64, commandTimeoutMs = 500 } = {}) {
  const flight = createSingleFlight();
  let active = 0, commands = 0;
  const ready = () => redis && (!redis.status || redis.status === 'ready');
  const keyFor = key => `${namespace}:${createHash('sha256').update(String(key)).digest('hex')}`;
  const command = async operation => {
    if (!ready() || commands >= maxInFlight * 2) throw unavailable();
    commands++;
    let timer;
    const pending = Promise.resolve().then(operation);
    pending.then(() => commands--, () => commands--);
    try {
      return await Promise.race([pending, new Promise((_, reject) => {
        timer = setTimeout(() => reject(unavailable()), commandTimeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  };
  const run = (key, task) => flight(key, async () => {
    if (active >= maxInFlight) throw unavailable();
    active++;
    let lockKey, token, timer;
    try {
      // Le repli local reste borné lorsque Redis est déconnecté.
      if (!ready()) return await task({ isCurrent: async () => true, publishValue: async () => true });
      const base = keyFor(key);
      const failureKey = `${base}:failure`;
      const failure = await command(() => redis.get(failureKey));
      if (failure) {
        let data;
        try { data = JSON.parse(failure); } catch {}
        if (data?.message) throw Object.assign(new Error(data.message), data);
      }
      lockKey = `${base}:lock`;
      token = randomUUID();
      const acquired = await command(() => redis.set(lockKey, token, 'PX', leaseMs, 'NX'));
      if (acquired !== 'OK') { token = null; return undefined; }
      let lost = false, renewal = null;
      const isCurrent = async () => {
        if (lost) return false;
        if (renewal) return renewal;
        renewal = command(() => redis.eval(RENEW, 1, lockKey, token, leaseMs))
          .then(result => { if (Number(result) !== 1) lost = true; return !lost; }, () => { lost = true; return false; })
          .finally(() => { renewal = null; });
        return renewal;
      };
      timer = setInterval(() => { void isCurrent(); }, Math.max(10, Math.floor(leaseMs / 3)));
      timer.unref?.();
      const publishValue = async (raw, ttlMs) => {
        if (lost) return false;
        const result = await command(() => redis.eval(PUBLISH, 2, lockKey, `${base}:value`, token, raw, ttlMs));
        if (result !== 'OK') lost = true;
        return !lost;
      };
      try {
        return await task({ isCurrent, publishValue });
      } catch (error) {
        // Le compare-and-set empêche un ancien propriétaire de publier son échec.
        const compact = compactRefreshError(error);
        const raw = JSON.stringify({ message: compact.message, code: compact.code,
          httpStatus: compact.httpStatus, coflixSiteRateLimited: compact.coflixSiteRateLimited });
        await command(() => redis.eval(PUBLISH, 2, lockKey, failureKey, token, raw, retryMs)).catch(() => {});
        throw error;
      }
    } finally {
      clearInterval(timer);
      if (token) await command(() => redis.eval(RELEASE, 1, lockKey, token)).catch(() => {});
      active--;
    }
  });
  return { run, command, ready, keyFor };
}

/** Cache de petits résultats publics parsés, avec budgets mémoire et concurrence.
 * Un échec est partagé brièvement sans devenir un résultat « introuvable ». */
function createSharedSourceLookup({ redis = null, namespace, ttlMs = 40 * 60000,
  maxEntries = 500, maxBytes = 2 * 1024 * 1024, maxEntryBytes = 64 * 1024,
  localTtlMs = 60000, waitMs = 65000, pollMs = 250, maxInFlight = 64, ...workOptions } = {}) {
  const work = createSharedSourceWork({ redis, namespace, maxInFlight, ...workOptions });
  const flight = createSingleFlight();
  const entries = new Map();
  let bytes = 0, pending = 0;
  const forget = key => {
    bytes -= entries.get(key)?.bytes || 0;
    entries.delete(key);
  };
  const remember = (key, raw, expiresAt) => {
    forget(key);
    const size = Buffer.byteLength(raw);
    if (size > maxEntryBytes || size > maxBytes) return;
    entries.set(key, { raw, expiresAt: Math.min(expiresAt, Date.now() + localTtlMs), bytes: size });
    bytes += size;
    while (entries.size > maxEntries || bytes > maxBytes) forget(entries.keys().next().value);
  };
  const read = async key => {
    const local = entries.get(key);
    if (local?.expiresAt > Date.now()) return JSON.parse(local.raw);
    forget(key);
    if (!work.ready()) return null;
    const raw = await work.command(() => redis.get(`${work.keyFor(key)}:value`));
    if (!raw || Buffer.byteLength(raw) > maxEntryBytes) return null;
    try {
      const entry = JSON.parse(raw);
      if (!(entry.expiresAt > Date.now()) || !Object.hasOwn(entry, 'value')) return null;
      remember(key, raw, entry.expiresAt);
      return entry;
    } catch { return null; }
  };
  const load = (parts, loader, { cacheable = value => value != null } = {}) => {
    const key = JSON.stringify(parts);
    return flight(key, async () => {
      if (pending >= maxInFlight) throw unavailable();
      pending++;
      try {
        const deadline = Date.now() + waitMs;
        do {
          const cached = await read(key);
          if (cached) return cached.value;
          const result = await work.run(key, async ({ isCurrent, publishValue }) => {
            const latest = await read(key);
            if (latest) return latest;
            const value = await loader();
            const entry = { value, expiresAt: Date.now() + ttlMs };
            if (!await isCurrent()) throw unavailable();
            if (cacheable(value)) {
              const raw = JSON.stringify(entry);
              if (Buffer.byteLength(raw) <= maxEntryBytes) {
                if (!await publishValue(raw, ttlMs)) throw unavailable();
                remember(key, raw, entry.expiresAt);
              }
            }
            return entry;
          });
          if (result) return result.value;
          if (Date.now() >= deadline) throw unavailable();
          await new Promise(resolve => setTimeout(resolve, pollMs));
        } while (true);
      } finally { pending--; }
    });
  };
  return { load };
}

module.exports = { createSharedSourceWork, createSharedSourceLookup };
