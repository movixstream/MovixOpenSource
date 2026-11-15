'use strict';

// « Tu regardes plus que X % des membres » pour le Wrapped.
//
// Avant, Redis gardait le classement complet de l'année (une entrée par
// compte) et chaque ouverture d'un Wrapped le relisait en entier pour y
// chercher un seul compte : plusieurs mégaoctets transférés et décodés par
// requête, sur le fil principal du worker.
//
// Ici, un seul passage sur la table (en arrière-plan, sous verrou Redis)
// résume l'année en 1 000 seuils de minutes, quelques kilo-octets. Le rang
// d'un membre se lit ensuite par dichotomie à partir du temps de son propre
// Wrapped, sans chercher son identifiant.
//
// - population : les comptes qui ont atteint le temps de déblocage du Wrapped.
//   Compter aussi les comptes à 2 minutes rendrait le « top X % » flatteur
//   pour tout le monde ;
// - le temps comparé est celui du Wrapped affiché (le profil). Pour un compte
//   à plusieurs profils, le rang est donc prudent, jamais gonflé ;
// - sans Redis, pas de calcul : rien ne protégerait la table d'un passage
//   complet à chaque requête.

const CUT_COUNT = 1000;
const MIN_POPULATION = 50;
const KEY_PREFIX = 'wrapped:pctile:v2:';
const REFRESH_AFTER_MS = 60 * 60 * 1000;
const OPEN_YEAR_TTL_SECONDS = 24 * 60 * 60;
const CLOSED_YEAR_TTL_SECONDS = 30 * 24 * 60 * 60;
const LOCK_TTL_SECONDS = 300;
const MEMORY_TTL_MS = 60 * 1000;

/**
 * Résume une liste de minutes (une valeur par compte) en seuils triés.
 * cuts[i] = minutes du compte situé à la fraction (i + 1) / cuts.length.
 * @returns {{ count: number, cuts: number[] }}
 */
function buildDistribution(totals) {
  const sorted = (Array.isArray(totals) ? totals : [])
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  const count = sorted.length;
  if (count === 0) return { count: 0, cuts: [] };
  const size = Math.min(CUT_COUNT, count);
  const cuts = Array.from({ length: size }, (_, index) => sorted[Math.ceil(((index + 1) * count) / size) - 1]);
  return { count, cuts };
}

/**
 * Part des membres qui ont regardé strictement moins, de 1 à 99.
 * null si la population est trop petite pour dire quelque chose.
 */
function percentileOf(distribution, minutes) {
  const cuts = distribution?.cuts;
  const value = Number(minutes);
  if (!Array.isArray(cuts) || cuts.length === 0 || !(distribution.count >= MIN_POPULATION) || !Number.isFinite(value)) {
    return null;
  }
  let low = 0;
  let high = cuts.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (cuts[middle] < value) low = middle + 1;
    else high = middle;
  }
  return Math.min(99, Math.max(1, Math.floor((low / cuts.length) * 100)));
}

// Par worker : évite un GET Redis + décodage à chaque Wrapped.
const memory = new Map();
const refreshing = new Set();

function remember(year, distribution, nowMs) {
  memory.set(year, { at: nowMs, distribution });
}

async function readDistribution(redis, year, nowMs) {
  const cached = memory.get(year);
  if (cached && nowMs - cached.at < MEMORY_TTL_MS) return cached.distribution;
  let distribution = null;
  try {
    const raw = await redis.get(`${KEY_PREFIX}${year}`);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && Array.isArray(parsed.cuts)) distribution = parsed;
  } catch {
    distribution = null;
  }
  remember(year, distribution, nowMs);
  return distribution;
}

async function refreshDistribution({ pool, redis, year, minMinutes, closedYear, nowMs }) {
  if (refreshing.has(year)) return;
  refreshing.add(year);
  try {
    // Un seul worker du cluster lance le passage sur la table.
    const lock = await redis.set(`${KEY_PREFIX}${year}:lock`, '1', 'EX', LOCK_TTL_SECONDS, 'NX');
    if (!lock) return;
    const [rows] = await pool.execute(
      `SELECT ROUND(SUM(watch_duration) / 60) AS total
         FROM wrapped_viewing_data WHERE year = ?
        GROUP BY user_id HAVING total >= ?`,
      [year, minMinutes]
    );
    const distribution = { builtAt: nowMs, ...buildDistribution(rows.map((row) => row.total)) };
    await redis.set(
      `${KEY_PREFIX}${year}`,
      JSON.stringify(distribution),
      'EX',
      closedYear ? CLOSED_YEAR_TTL_SECONDS : OPEN_YEAR_TTL_SECONDS
    );
    remember(year, distribution, nowMs);
  } catch (error) {
    console.warn('[Wrapped] Classement non recalculé :', error?.message || error);
  } finally {
    refreshing.delete(year);
  }
}

/**
 * Ne bloque jamais la réponse : si le résumé de l'année manque ou date, il est
 * recalculé en arrière-plan et la valeur connue (ou null) est renvoyée.
 * @returns {Promise<{ percentile: number|null, pending: boolean }>}
 *   `pending` : pas encore de résumé, la valeur arrivera aux prochains appels.
 */
async function getWrappedPercentile({ pool, redis, year, minutes, minMinutes, now = Date.now, currentYear = new Date().getFullYear() }) {
  if (!redis || redis.status !== 'ready' || !pool) return { percentile: null, pending: false };
  const nowMs = now();
  const closedYear = year < currentYear;
  const distribution = await readDistribution(redis, year, nowMs);
  const stale = !distribution || (!closedYear && nowMs - Number(distribution.builtAt || 0) > REFRESH_AFTER_MS);
  if (stale) {
    setImmediate(() => { refreshDistribution({ pool, redis, year, minMinutes, closedYear, nowMs }); });
  }
  return { percentile: distribution ? percentileOf(distribution, minutes) : null, pending: !distribution };
}

function resetWrappedPercentileMemory() {
  memory.clear();
  refreshing.clear();
}

module.exports = {
  CUT_COUNT,
  MIN_POPULATION,
  KEY_PREFIX,
  buildDistribution,
  percentileOf,
  getWrappedPercentile,
  refreshDistribution,
  resetWrappedPercentileMemory,
};
