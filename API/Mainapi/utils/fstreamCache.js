const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const lockfile = require('proper-lockfile');
const writeFileAtomic = require('write-file-atomic');
const { refreshStep, reportRefreshFailure, recordRefreshResult } = require('./sourceRefreshTelemetry');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const atomic = (file, value) => writeFileAtomic(file, value, { encoding: 'utf8', fsync: false });
const positive = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
const uncachedFStreamResponse = (status, body) => ({ __fstreamResponse: true, status, body });
const isUncachedResponse = (data) => data?.__fstreamResponse === true && Number.isInteger(data.status) && data.body;

/** Workers share cacheDir. Short filesystem transactions fence JSON publication,
 * repair and purge even when Redis is unavailable. Redis leases cover scraping.
 * The durable generation file must survive a purge (including Redis downtime).
 */
function createFStreamCacheStore({
  cacheDir,
  redis = null,
  refreshMs = positive(process.env.FSTREAM_CACHE_REFRESH_MS, 10 * 60 * 1000),
  retryMs = 60 * 1000,
  lockTtlMs = 30 * 1000,
  lockWaitMs = 35 * 1000,
  localLimit = 250,
  localMaxBytes = 16 * 1024 * 1024,
  redisRepairIntervalMs = 10000,
  redisReadTimeoutMs = 250,
} = {}) {
  const local = new Map();
  const sizes = new Map();
  const failures = new Map();
  const pending = new Map();
  const repairs = new Map();
  const nextRepairs = new WeakMap();
  const readyRedis = () => redis && (!redis.status || redis.status === 'ready') ? redis : null;
  let localBytes = 0;
  const dataKey = (key) => `fstream:${key}`;
  const versionKey = (key) => `fstream:version:${key}`;
  const lockKey = (key) => `fstream:refresh-lock:${key}`;
  const retryKey = (key) => `fstream:retry:${key}`;
  const fileFor = (key) => {
    if (!/^[\w-]{1,160}$/.test(key)) throw new Error('Invalid FStream cache key');
    return path.join(cacheDir, `${key}.json`);
  };
  const forget = (key) => {
    localBytes -= sizes.get(key) || 0;
    sizes.delete(key);
    local.delete(key);
  };
  const remember = (key, entry) => {
    forget(key);
    // Budget counts serialized UTF-8 bytes; oversized payloads bypass L1.
    const size = Buffer.byteLength(JSON.stringify(entry));
    if (size > localMaxBytes || localLimit <= 0) return;
    local.set(key, entry);
    sizes.set(key, size);
    localBytes += size;
    while (local.size > localLimit || localBytes > localMaxBytes) forget(local.keys().next().value);
  };
  const transaction = async (key, fn) => {
    const file = fileFor(key);
    await fs.mkdir(cacheDir, { recursive: true });
    let compromised = false;
    const release = await lockfile.lock(file, {
      realpath: false, lockfilePath: `${file}.publish.lock`,
      stale: 30000, update: 5000,
      retries: { retries: 150, minTimeout: 10, maxTimeout: 50, factor: 1.2 },
      onCompromised: () => { compromised = true; },
    });
    try { return await fn(() => { if (compromised) throw new Error('FStream disk lock lost'); }); }
    finally { await release().catch(() => {}); }
  };
  const generation = async (key) => {
    try { return await fs.readFile(`${fileFor(key)}.generation`, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return '0'; throw error; }
  };
  const diskStamp = async (key) => {
    try {
      const stat = await fs.stat(fileFor(key), { bigint: true });
      return `${stat.ino}:${stat.mtimeNs}:${stat.ctimeNs}:${stat.size}`;
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  const publishRedis = async (key, entry) => {
    if (!readyRedis()) return false;
    try {
      const ttl = Math.max(refreshMs * 2, 60000);
      await readyRedis()?.set(dataKey(key), JSON.stringify(entry), 'PX', ttl);
      if (!readyRedis()) return false;
      await redis.set(versionKey(key), entry.version, 'PX', ttl);
      return true;
    } catch { return false; }
  };
  // Call only inside a transaction: repair cannot race an invalidation/save.
  const read = async (key) => {
    const gen = await generation(key);
    const stamp = await diskStamp(key);
    const known = local.get(key);
    let sharedVersion;
    try { sharedVersion = await readyRedis()?.get(versionKey(key)); } catch {}
    if (known && known.generation === gen && known.diskStamp === stamp) {
      // Keep the parsed object even after Redis expires; repair from L1.
      if (redis && sharedVersion !== known.version) await publishRedis(key, known);
      local.delete(key);
      local.set(key, known);
      return known;
    }
    forget(key);
    let entry;
    try {
      const raw = await readyRedis()?.get(dataKey(key));
      if (raw) {
        const parsed = JSON.parse(raw);
        if ((parsed.generation || '0') === gen &&
            (stamp ? parsed.diskStamp === stamp : gen === '0') && parsed.data) entry = parsed;
      }
    } catch {}
    if (!entry && stamp) {
      try {
        const raw = await fs.readFile(fileFor(key), 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed.data && (parsed.generation || '0') === gen) {
          const stat = await fs.stat(fileFor(key));
          entry = {
            data: parsed.data, cachedAt: parsed.cachedAt || stat.mtimeMs,
            version: parsed.version || crypto.createHash('sha256').update(raw).digest('hex'),
            generation: gen, diskStamp: stamp,
          };
          await publishRedis(key, entry);
        }
      } catch (error) {
        if (error.code !== 'ENOENT') console.error(`[FSTREAM CACHE] Lecture ${key}: ${error.message}`);
      }
    }
    if (entry) {
      // A missing disk file can still use a legacy Redis-only cache until purge.
      entry = { ...entry, generation: gen, diskStamp: stamp };
      remember(key, entry);
    }
    return entry || null;
  };
  // Redis repair still uses the publication mutex, but HTTP readers never wait
  // for that mutex or a Redis round trip when the local JSON is available.
  const repairLater = (key, entry) => {
    if (!readyRedis() || repairs.has(key) || repairs.size >= Math.max(1, localLimit)
        || (nextRepairs.get(entry) || 0) > Date.now()) return;
    nextRepairs.set(entry, Date.now() + redisRepairIntervalMs);
    const repair = transaction(key, () => read(key)).catch(() => {}).finally(() => repairs.delete(key));
    repairs.set(key, repair);
  };
  const readLegacyRedis = async (key) => {
    if (!readyRedis()) return null;
    let timer;
    try {
      return await Promise.race([
        redis.get(dataKey(key)),
        new Promise(resolve => { timer = setTimeout(() => resolve(null), redisReadTimeoutMs); }),
      ]);
    } catch { return null; }
    finally { clearTimeout(timer); }
  };
  const get = async (key) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const [gen, stamp] = await Promise.all([generation(key), diskStamp(key)]);
      const known = local.get(key);
      if (known && known.generation === gen && known.diskStamp === stamp) {
        local.delete(key);
        local.set(key, known);
        repairLater(key, known);
        return known;
      }
      forget(key);
      let entry;
      try {
        if (stamp) {
          const raw = await fs.readFile(fileFor(key), 'utf8');
          const parsed = JSON.parse(raw);
          if (parsed.data && (parsed.generation || '0') === gen) {
            const stat = await fs.stat(fileFor(key));
            entry = {
              data: parsed.data, cachedAt: parsed.cachedAt || stat.mtimeMs,
              version: parsed.version || crypto.createHash('sha256').update(raw).digest('hex'),
              generation: gen, diskStamp: stamp,
            };
          }
        } else if (gen === '0') {
          const raw = await readLegacyRedis(key);
          const parsed = raw ? JSON.parse(raw) : null;
          if (parsed?.data && (parsed.generation || '0') === gen) {
            entry = { ...parsed, generation: gen, diskStamp: null };
          }
        }
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        console.error(`[FSTREAM CACHE] Lecture ${key}: ${error.message}`);
      }
      // Atomic replacement/purge may have occurred during the read. Retry the
      // current snapshot instead of retaining or republishing the old one.
      const [currentGen, currentStamp] = await Promise.all([generation(key), diskStamp(key)]);
      if (currentGen !== gen || currentStamp !== stamp) continue;
      if (entry) {
        remember(key, entry);
        repairLater(key, entry);
      }
      return entry || null;
    }
    return null;
  };
  const pruneFailures = () => {
    for (const [key, entry] of failures) if (entry.until <= Date.now()) failures.delete(key);
  };
  const fail = (key, response = null, fence, delayMs = retryMs) => transaction(key, async () => {
    const gen = await generation(key);
    if (fence && (fence.generation !== gen || !await fence.ownsLease())) return false;
    pruneFailures();
    const entry = { until: Date.now() + delayMs, generation: gen, response };
    const raw = JSON.stringify(entry);
    failures.delete(key);
    failures.set(key, { ...entry, bytes: Buffer.byteLength(raw) });
    let bytes = [...failures.values()].reduce((sum, value) => sum + value.bytes, 0);
    while (failures.size > Math.max(0, localLimit) || bytes > localMaxBytes) {
      const first = failures.keys().next().value;
      bytes -= failures.get(first).bytes;
      failures.delete(first);
    }
    try { await readyRedis()?.set(retryKey(key), raw, 'PX', delayMs); } catch {}
    return true;
  });
  const cooldown = async (key) => {
    pruneFailures();
    const gen = await generation(key);
    let entry = failures.get(key);
    if (entry?.generation !== gen) entry = null;
    try {
      const raw = await readyRedis()?.get(retryKey(key));
      const shared = raw ? JSON.parse(raw) : null;
      if (shared?.generation === gen && shared.until > (entry?.until || 0)) entry = shared;
    } catch {}
    return entry?.until > Date.now() ? entry : null;
  };
  const saveEntry = (key, data, fence) => transaction(key, async (checkDiskLock) => {
    const gen = await generation(key);
    if (fence && (gen !== fence.generation || !await fence.ownsLease())) return { saved: false };
    const file = fileFor(key);
    const previous = fence ? await fs.readFile(file, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    }) : null;
    const entry = { data, cachedAt: Date.now(), version: crypto.randomUUID(), generation: gen };
    checkDiskLock();
    await atomic(file, JSON.stringify(entry));
    // A stalled write may outlive the Redis lease. Roll back while still holding
    // the disk mutex; a successor cannot have published its JSON in between.
    if (fence && !await fence.ownsLease()) {
      if (previous === null) await fs.unlink(file);
      else await atomic(file, previous);
      forget(key);
      return { saved: false };
    }
    checkDiskLock();
    entry.diskStamp = await diskStamp(key);
    remember(key, entry);
    const shared = await publishRedis(key, entry);
    if (shared) nextRepairs.set(entry, Date.now() + redisRepairIntervalMs);
    failures.delete(key);
    try { await readyRedis()?.del(retryKey(key)); } catch {}
    return { saved: true, shared };
  });
  const save = async (key, data) => {
    try { return (await saveEntry(key, data)).saved; }
    catch (error) { console.error(`[FSTREAM CACHE] Écriture ${key}: ${error.message}`); return false; }
  };
  const invalidate = (key) => transaction(key, async (checkDiskLock) => {
    checkDiskLock();
    await atomic(`${fileFor(key)}.generation`, crypto.randomUUID());
    await fs.unlink(fileFor(key)).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    forget(key);
    failures.delete(key);
    try { await readyRedis()?.del(dataKey(key), versionKey(key), retryKey(key)); } catch {}
    return true;
  });
  const isFresh = (entry) => Boolean(entry && Date.now() - entry.cachedAt < refreshMs);
  const playable = (data) => data?.success === true && Number(data.total) > 0;
  const refresh = async (key, scrape, validate) => {
    const valid = (entry) => entry && playable(entry.data) && validate(entry.data) ? entry : null;
    const latest = async () => valid(await get(key));
    const fallback = async () => (await latest())?.data || (await cooldown(key))?.response || null;
    const rawInitial = await get(key);
    const initial = valid(rawInitial);
    refreshStep('cache', {
      cacheAgeMs: rawInitial ? Date.now() - rawInitial.cachedAt : null,
      cachedExtractedAt: rawInitial?.data?.metadata?.extractedAt,
      cachedEpisodes: Object.keys(rawInitial?.data?.episodes || {}),
      cachePresent: Boolean(rawInitial), cacheUsable: Boolean(initial),
      title: rawInitial?.data?.tmdb?.title,
    });
    if (isFresh(initial)) return initial.data;
    const retry = await cooldown(key);
    if (retry) return initial?.data || retry.response || null;
    const token = crypto.randomUUID();
    let coordinated = Boolean(readyRedis()), locked;
    try { locked = readyRedis() && await redis.set(lockKey(key), token, 'PX', lockTtlMs, 'NX') === 'OK'; }
    catch { coordinated = false; }
    if (coordinated && !locked) {
      const deadline = Date.now() + lockWaitMs;
      while (Date.now() < deadline) {
        await sleep(Math.min(100, lockTtlMs / 3));
        const shared = await latest();
        if (shared && (isFresh(shared) || shared.version !== initial?.version)) return shared.data;
        try { if (!await readyRedis()?.get(lockKey(key))) return shared?.data || (await cooldown(key))?.response || null; }
        catch { return shared?.data || null; }
      }
      reportRefreshFailure('refresh_lock_timeout', 'Attente du verrou d’actualisation expirée', { cacheKey: key });
      return fallback();
    }
    let lost = false, renewing = false;
    const ownsLease = async () => {
      if (!coordinated) return true;
      if (lost) return false;
      try { if (await readyRedis()?.get(lockKey(key)) !== token) lost = true; }
      catch { lost = true; }
      return !lost;
    };
    const timer = coordinated ? setInterval(async () => {
      if (renewing || lost) return;
      renewing = true;
      try {
        const renewed = await readyRedis()?.eval('if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) end return 0', 1, lockKey(key), token, lockTtlMs);
        if (!renewed) lost = true;
      } catch { lost = true; }
      finally { renewing = false; }
    }, Math.max(1, Math.floor(lockTtlMs / 3))) : null;
    timer?.unref();
    let fence;
    try {
      const start = await transaction(key, async () => ({ entry: valid(await read(key)), generation: await generation(key) }));
      fence = { generation: start.generation, ownsLease };
      if (isFresh(start.entry)) return start.entry.data;
      const retryAfterLock = await cooldown(key);
      if (retryAfterLock) return start.entry?.data || retryAfterLock.response || null;
      const data = await scrape();
      if (!playable(data) || !validate(data)) {
        const response = isUncachedResponse(data) && validate(data.body) ? data : null;
        const body = isUncachedResponse(data) ? data.body : data;
        const dateValidation = body?.metadata?.dateValidation;
        const reason = ['content_not_found', 'extraction_empty'].includes(body?.code) ? body.code
          : dateValidation?.isAvailable === false ? 'release_year_mismatch'
          : playable(data) ? 'selection_rejected' : 'unusable_result';
        const message = reason === 'release_year_mismatch' ? 'Validation de l’année refusée'
          : reason === 'selection_rejected' ? 'Fiche incompatible avec le titre TMDB ou la saison demandée'
            : 'Aucune source valide produite par l’actualisation';
        reportRefreshFailure(reason, body?.error || message, {
          cacheKey: key, total: body?.total, success: body?.success,
          tmdbYear: dateValidation?.tmdbYear,
          sourceYear: dateValidation?.fstreamYear || body?.search?.bestMatch?.year,
        });
        const recorded = await fail(key, response, fence, reason === 'content_not_found' ? refreshMs : retryMs);
        return (await latest())?.data || (recorded ? response : await fallback());
      }
      refreshStep('cache_write', { cacheKey: key });
      const result = await saveEntry(key, data, fence);
      if (!result.saved) reportRefreshFailure('cache_write_rejected', 'Écriture refusée : génération du cache modifiée ou verrou perdu', { cacheKey: key });
      else if (redis && !result.shared) reportRefreshFailure('redis_publish_failed', 'JSON actualisé, mais publication Redis impossible', { cacheKey: key });
      if (!result.saved || (redis && !result.shared)) await fail(key, null, fence);
      if (result.saved) recordRefreshResult(data);
      return result.saved ? data : fallback();
    } catch (error) {
      reportRefreshFailure('refresh_exception', error, { cacheKey: key });
      await fail(key, null, fence);
      return fallback();
    } finally {
      if (timer) clearInterval(timer);
      if (coordinated) {
        try { await readyRedis()?.eval('if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) end return 0', 1, lockKey(key), token); } catch {}
      }
    }
  };
  const getOrRefresh = (key, scrape, validate = () => true) => {
    if (!pending.has(key)) {
      const promise = refresh(key, scrape, validate).finally(() => pending.delete(key));
      pending.set(key, promise);
    }
    return pending.get(key).then((data) => data && validate(isUncachedResponse(data) ? data.body : data) ? data : null);
  };
  return { get, save, invalidate, getOrRefresh, isFresh, local, failures, repairs };
}

module.exports = { createFStreamCacheStore, uncachedFStreamResponse };
