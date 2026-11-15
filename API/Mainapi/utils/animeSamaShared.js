'use strict';

/**
 * Ce que les workers partagent pour anime-sama, par Redis :
 *
 *  - un verrou par œuvre en cours d'actualisation : sans lui, chaque worker
 *    qui reçoit une recherche relirait la fiche et toutes les pages de saison
 *    de la même œuvre ;
 *  - un débit commun pour `/api/lien.php`, pour que douze workers ne cumulent
 *    pas leurs demandes vers anime-sama dans la même seconde. Il lisse les
 *    rafales ; le quota du site (environ 300 demandes par 10 minutes) se gère
 *    à part, par une pause quand le site répond « trop » (routes/animeSama.js).
 *
 * Redis en panne ne bloque rien : chaque worker travaille alors seul, avec son
 * seul plafond local.
 */

const RELEASE_SCRIPT = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';
const RENEW_SCRIPT = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("expire", KEYS[1], ARGV[2]) else return 0 end';

const UNLOCKED = Object.freeze({ renew: async () => true, release: async () => {} });

/**
 * Rend `acquire(key)` : un bail `{ renew, release }`, ou null si un autre
 * worker tient déjà le verrou. Le bail expire seul après `ttlSeconds` (worker
 * tué en route) ; `renew` le prolonge pendant une longue actualisation.
 */
function createRefreshLock({ redis, ttlSeconds = 120 }) {
  return async function acquire(key) {
    const value = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    let granted;
    try {
      granted = await redis.set(key, value, 'EX', ttlSeconds, 'NX');
    } catch {
      return UNLOCKED;
    }
    if (granted !== 'OK') return null;
    return {
      async renew() {
        try { return await redis.eval(RENEW_SCRIPT, 1, key, value, ttlSeconds) === 1; } catch { return false; }
      },
      async release() {
        try { await redis.eval(RELEASE_SCRIPT, 1, key, value); } catch { /* le bail expirera seul */ }
      },
    };
  };
}

const defaultSleep = ms => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Débit commun des demandes de liens : au plus `perSecond` par seconde pour
 * tous les workers (compteur Redis par seconde). `take()` rend la main quand
 * la demande peut partir ; après `maxWaits` secondes pleines, elle part quand
 * même plutôt que d'attendre sans fin.
 */
function createLinkBudget({ redis, perSecond = 10, key = 'animesama:liens', now = Date.now, sleep = defaultSleep, maxWaits = 30 }) {
  const limit = Math.max(1, Math.floor(Number(perSecond) || 1));
  return {
    perSecond: limit,
    async take() {
      for (let waits = 0; waits < maxWaits; waits++) {
        const second = Math.floor(now() / 1000);
        const counter = `${key}:${second}`;
        let count;
        try {
          count = await redis.incr(counter);
          if (count === 1) await redis.expire(counter, 5);
        } catch {
          return;
        }
        if (count <= limit) return;
        await sleep(1000 - (now() % 1000) + 5);
      }
    },
  };
}

module.exports = { createRefreshLock, createLinkBudget };
