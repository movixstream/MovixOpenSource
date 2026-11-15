'use strict';

// Recyclage des workers selon leur mémoire. Sous charge, la RSS d'un worker
// monte de plusieurs centaines de Mo par heure (tas V8 et surtout mémoire
// native) ; au-delà du seuil, le worker demande au master de le remplacer.
const RECYCLE_REQUEST = 'movix:recycle-request';
const DEFAULT_MAX_RSS_MB = 2560;
const MB = 1024 * 1024;

function readRssLimitMb(raw, fallback = DEFAULT_MAX_RSS_MB) {
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

// Côté worker : la chauffe est exclue pour qu'un seuil trop bas ne fasse pas
// boucler les redémarrages.
function shouldRequestRecycle({ rssBytes, uptimeMs, limitMb, minUptimeMs }) {
  return limitMb > 0 && uptimeMs >= minUptimeMs && rssBytes > limitMb * MB;
}

// Côté master : un seul recyclage à la fois, espacés d'au moins minGapMs, pour
// ne jamais retirer plusieurs workers ensemble.
function createRecycleGate({ minGapMs, now = Date.now }) {
  let current = null;
  let lastAt = -Infinity;
  const note = (worker) => { current = worker; lastAt = now(); };
  return {
    note,
    tryAcquire(worker) {
      if (current && current !== worker && !current.isDead()) return false;
      if (now() - lastAt < minGapMs) return false;
      note(worker);
      return true;
    },
  };
}

module.exports = {
  RECYCLE_REQUEST,
  DEFAULT_MAX_RSS_MB,
  readRssLimitMb,
  shouldRequestRecycle,
  createRecycleGate,
};
