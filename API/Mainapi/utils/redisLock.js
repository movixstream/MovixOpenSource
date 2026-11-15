/**
 * Redis distributed lock (replaces proper-lockfile).
 * Extracted from server.js — uses SET NX EX for atomic locking with TTL auto-expiration.
 * More reliable than filesystem lockfiles (no orphan .lock files, works in cluster).
 */

const { redis } = require('../config/redis');
const { isShuttingDown } = require('./shutdownFlag');

// === REDIS DISTRIBUTED LOCK (remplace proper-lockfile) ===
// Utilise SET NX EX pour un verrou atomique avec TTL auto-expiration.
// Plus fiable que les lockfiles filesystem (pas de .lock orphelins, fonctionne en cluster).
const LOCK_PREFIX = 'lock:';
const LOCK_DEFAULT_TTL = 10; // secondes — TTL auto-expiration du verrou
const LOCK_RETRY_DELAY = 100; // ms entre chaque tentative
const LOCK_MAX_RETRIES = 50; // 50 × 100ms = 5s max d'attente

/**
 * Acquiert un verrou distribué Redis sur une clé donnée.
 * @param {string} resourceKey - Identifiant unique de la ressource (ex: chemin de fichier)
 * @param {object} opts - Options : ttl (sec), retries, retryDelay (ms)
 * @returns {Promise<{release: Function, renew: Function}|null>} - Bail renouvelable, ou null si échec
 */
async function acquireRedisLock(resourceKey, opts = {}) {
  if (isShuttingDown()) return null;

  const ttl = opts.ttl || LOCK_DEFAULT_TTL;
  const retries = opts.retries ?? LOCK_MAX_RETRIES;
  const retryDelay = opts.retryDelay || LOCK_RETRY_DELAY;
  const lockKey = LOCK_PREFIX + resourceKey;
  const lockValue = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // SET key value NX EX ttl — atomique, ne set que si la clé n'existe pas
      const result = await redis.set(lockKey, lockValue, 'EX', ttl, 'NX');
      if (result === 'OK') {
        // Verrou acquis — retourner une fonction release sécurisée
        return {
          renew: async () => {
            try {
              return await redis.eval('if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("expire", KEYS[1], ARGV[2]) else return 0 end',
                1, lockKey, lockValue, ttl) === 1;
            } catch { return false; }
          },
          release: async () => {
            try {
              // Script Lua atomique : ne supprime que si la valeur correspond (évite de libérer le lock d'un autre process)
              const luaScript = `
                if redis.call("get", KEYS[1]) == ARGV[1] then
                  return redis.call("del", KEYS[1])
                else
                  return 0
                end
              `;
              await redis.eval(luaScript, 1, lockKey, lockValue);
            } catch (e) {
              if (!isShuttingDown()) {
                console.warn(`[RedisLock] Erreur release ${resourceKey}:`, e.message);
              }
            }
          }
        };
      }
    } catch (err) {
      // Redis indisponible — on abandonne immédiatement
      console.warn(`[RedisLock] Redis indisponible pour ${resourceKey}:`, err.message);
      return null;
    }

    // Attendre avant de réessayer
    if (attempt < retries) {
      await new Promise(r => setTimeout(r, retryDelay));
    }
  }

  // Timeout — impossible d'acquérir le verrou (skip le warn si retries=0, c'est un dedup volontaire)
  if (retries > 0) {
    console.warn(`[RedisLock] Timeout: impossible d'acquérir le verrou pour ${resourceKey} après ${retries} tentatives`);
  }
  return null;
}

module.exports = { acquireRedisLock };
