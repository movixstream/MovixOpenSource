'use strict';

const { getTable, renderCreateTable } = require('../db/schema');

// Compteurs des ouvertures de /api/go, une instance par worker.
//
// Rien ne part au clic : les ouvertures sont comptées en mémoire puis envoyées
// toutes les 10 s. Les stats vont dans MySQL (table monetization_daily_stats,
// gardée sans limite de durée) en une seule requête ; les plafonds
// `globalPerDay` restent dans Redis (go:cap, un seul pipeline). Les totaux
// renvoyés par les HINCRBY de go:cap servent au plafond (quelques secondes de
// retard, léger dépassement accepté). Redis n'est appelé pendant un clic que
// pour le point de départ d'un geste à plusieurs fenêtres.

const DAILY_STATS_TABLE = 'monetization_daily_stats';
// Anciennes stats Redis (avant MySQL), recopiées une seule fois au démarrage.
const STATS_KEY_PREFIX = 'go:stats:';
const LEGACY_IMPORT_FLAG_KEY = 'go:stats:imported';
// Les anciennes clés vivaient 120 jours après leur dernière écriture : 120
// jours passés + le jour en cours.
const LEGACY_IMPORT_DAYS = 121;
const CAP_KEY_PREFIX = 'go:cap:';
const SEQUENCE_KEY_PREFIX = 'go:seq:';
const GESTURE_KEY_PREFIX = 'go:g:';
const CAP_TTL_SECONDS = 3 * 24 * 60 * 60;
const GESTURE_TTL_SECONDS = 60;
const GESTURE_MEMORY_TTL_MS = GESTURE_TTL_SECONDS * 1000;
const GESTURE_MEMORY_MAX_ENTRIES = 5000;
const DEFAULT_FLUSH_INTERVAL_MS = 10 * 1000;
// Un clic ne doit pas attendre un Redis qui rame : au-delà, compteur local.
const GESTURE_REDIS_TIMEOUT_MS = 1000;
const PIPELINE_TIMEOUT_MS = 5000;
// MySQL en panne longtemps : au-delà, les ouvertures en attente sont perdues.
const MAX_PENDING_STATS_FIELDS = 5000;
const MAX_ROWS_PER_INSERT = 500;
const MAX_STATS_SPAN_DAYS = 1100;
// Colonnes ad_id et placement en VARCHAR(16) : une valeur plus longue ferait
// échouer tout l'envoi groupé.
const MAX_KEY_LENGTH = 16;
const MAX_WINDOWS = 3;
const NONE_FIELD = 'none';
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const SELECT_STATS_SQL = `SELECT day, ad_id, placement, openings FROM ${DAILY_STATS_TABLE} WHERE day BETWEEN ? AND ?`;
const SELECT_FIRST_DAY_SQL = `SELECT MIN(day) AS first_day FROM ${DAILY_STATS_TABLE}`;

// Point de départ d'un geste, d'un seul bloc : deux fenêtres du même clic
// arrivées sur deux workers lisent la même valeur, et le cycle n'avance qu'une
// fois. KEYS[1] = go:g:<geste>, KEYS[2] = go:seq:<emplacement>, ARGV[1] = TTL.
const GESTURE_BASE_SCRIPT = `
local base = redis.call('GET', KEYS[1])
if base then return tonumber(base) end
local counter = redis.call('INCR', KEYS[2])
redis.call('SET', KEYS[1], counter - 1, 'EX', ARGV[1])
return counter - 1`;

const PARIS_DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

// Jour « YYYY-MM-DD » à Paris : plafonds et stats changent de jour à minuit
// heure de Paris, pas à minuit UTC.
function getParisDateKey(date) {
  const parts = {};
  for (const part of PARIS_DATE_FORMAT.formatToParts(date)) {
    parts[part.type] = part.value;
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// Recule ou avance un jour calendaire sans passer par l'heure locale.
function shiftDateKey(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

// Vraie date du calendrier au format YYYY-MM-DD (pas de 30 février), dans la
// plage du type DATE de MySQL.
function isDateKey(value) {
  const match = typeof value === 'string' ? DATE_KEY_PATTERN.exec(value) : null;
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  if (year < 1000) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function countDaysBetween(from, to) {
  const toTime = (dateKey) => {
    const [year, month, day] = dateKey.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((toTime(to) - toTime(from)) / DAY_MS);
}

function isValidPeriod(from, to) {
  return isDateKey(from) && isDateKey(to) && from <= to && countDaysBetween(from, to) <= MAX_STATS_SPAN_DAYS;
}

// Jour lu dans MySQL. mysql2 rend une colonne DATE en Date à minuit, heure
// locale du processus (ou en chaîne avec dateStrings) : on relit l'année, le
// mois et le jour locaux, jamais toISOString() qui décalerait d'un jour selon
// le fuseau.
function formatDay(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (Number.isNaN(value.getTime())) return null;
    const year = String(value.getFullYear()).padStart(4, '0');
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  if (typeof value === 'string') {
    const dateKey = value.slice(0, 10);
    return isDateKey(dateKey) ? dateKey : null;
  }
  return null;
}

function normalizeWindows(windows) {
  const count = Math.floor(Number(windows));
  if (!Number.isFinite(count) || count < 1) return 1;
  return Math.min(count, MAX_WINDOWS);
}

function parseBase(value) {
  if (value === null || value === undefined) return null;
  const base = Number(value);
  return Number.isSafeInteger(base) && base >= 0 ? base : null;
}

function withTimeout(promise, ms) {
  let timer = null;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Redis ne répond pas')), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Compteurs rangés par jour : Map<dateKey, Map<champ, nombre>>.
function addCount(store, dateKey, field, amount) {
  let fields = store.get(dateKey);
  if (!fields) {
    fields = new Map();
    store.set(dateKey, fields);
  }
  fields.set(field, (fields.get(field) || 0) + amount);
}

function hasPipeline(redis) {
  return Boolean(redis) && typeof redis.pipeline === 'function';
}

function isPool(pool) {
  return Boolean(pool) && typeof pool.query === 'function';
}

// Champ `<pub|none>|<emplacement>` → ligne de la table, ou null si illisible.
function toRow(day, field, openings) {
  const separator = field.indexOf('|');
  const adId = field.slice(0, separator);
  const placement = field.slice(separator + 1);
  if (separator < 1 || !placement || adId.length > MAX_KEY_LENGTH || placement.length > MAX_KEY_LENGTH) return null;
  if (!Number.isSafeInteger(openings) || openings <= 0) return null;
  return { day, adId, placement, openings };
}

function buildUpsertSql(rowCount) {
  return `INSERT INTO ${DAILY_STATS_TABLE} (day, ad_id, placement, openings) VALUES `
    + new Array(rowCount).fill('(?, ?, ?, ?)').join(', ')
    + ' ON DUPLICATE KEY UPDATE openings = openings + VALUES(openings)';
}

// Ajoute les lignes à la table (une requête, découpée au-delà de 500 lignes).
// `progress.written` dit combien de lignes sont écrites si un morceau échoue.
async function upsertDailyStats(pool, rows, progress = { written: 0 }) {
  for (let start = 0; start < rows.length; start += MAX_ROWS_PER_INSERT) {
    const chunk = rows.slice(start, start + MAX_ROWS_PER_INSERT);
    const params = [];
    for (const row of chunk) params.push(row.day, row.adId, row.placement, row.openings);
    await pool.query(buildUpsertSql(chunk.length), params);
    progress.written = start + chunk.length;
  }
  return progress.written;
}

// La table est décrite dans db/schema/monetization.js : la créer depuis cette
// définition garde le démarrage et le planificateur de schéma alignés.
async function ensureMonetizationDailyStatsTable(pool) {
  const table = getTable(DAILY_STATS_TABLE);
  if (!table) {
    throw new Error(`Table ${DAILY_STATS_TABLE} absente du schéma déclaratif`);
  }
  await pool.execute(renderCreateTable(table));
}

// Reprise unique des stats que Redis gardait 120 jours (go:stats:<jour>) : le
// premier worker qui pose le drapeau les ajoute à la table, une seule fois
// pour tout le cluster. Jamais d'exception : le démarrage continue.
async function importLegacyRedisStats({ redis = null, pool = null, now = () => new Date() } = {}) {
  if (!redis || typeof redis.set !== 'function' || !hasPipeline(redis)) {
    return { imported: false, reason: 'redis-absent' };
  }
  if (!isPool(pool)) return { imported: false, reason: 'mysql-absent' };

  let claimed = false;
  const progress = { written: 0 };
  try {
    claimed = await withTimeout(redis.set(LEGACY_IMPORT_FLAG_KEY, '1', 'NX'), PIPELINE_TIMEOUT_MS) === 'OK';
    if (!claimed) return { imported: false, reason: 'already-done' };

    const today = getParisDateKey(now());
    const dates = [];
    for (let offset = LEGACY_IMPORT_DAYS - 1; offset >= 0; offset -= 1) {
      dates.push(shiftDateKey(today, -offset));
    }
    const pipeline = redis.pipeline();
    for (const date of dates) pipeline.hgetall(STATS_KEY_PREFIX + date);
    const results = await withTimeout(pipeline.exec(), PIPELINE_TIMEOUT_MS);

    const rows = [];
    for (const [index, date] of dates.entries()) {
      const [error, raw] = Array.isArray(results?.[index]) ? results[index] : [new Error('Réponse Redis absente')];
      if (error) throw error;
      for (const [field, value] of Object.entries(raw || {})) {
        const row = toRow(date, field, Number(value));
        if (row) rows.push(row);
      }
    }
    await upsertDailyStats(pool, rows, progress);
    console.log(`[Pubs] Reprise des statistiques Redis : ${rows.length} ligne(s) ajoutée(s) dans MySQL`);
    return { imported: true, rows: rows.length };
  } catch (error) {
    console.error('[Pubs] Reprise des statistiques Redis impossible :', error?.message || error);
    // Rien d'écrit : le drapeau est rendu, le prochain démarrage réessaiera.
    // Une partie écrite : il reste posé, une 2e reprise compterait ces lignes
    // deux fois.
    if (claimed && progress.written === 0 && typeof redis.del === 'function') {
      try {
        await withTimeout(redis.del(LEGACY_IMPORT_FLAG_KEY), PIPELINE_TIMEOUT_MS);
      } catch (releaseError) {
        console.error('[Pubs] Drapeau de reprise non rendu :', releaseError?.message || releaseError);
      }
    }
    return { imported: false, reason: 'error' };
  }
}

function createMonetizationStats({
  redis = null,
  pool = null,
  getPool = null,
  flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS,
  now = () => new Date()
} = {}) {
  let pendingStats = new Map();
  let pendingCaps = new Map();
  let inflightCaps = null;
  // Total du jour lu dans Redis (tous les workers) et ouvertures de ce worker
  // qui n'ont pas pu y être envoyées : les deux comptent pour le plafond.
  const redisCaps = new Map();
  const lostCaps = new Map();
  const localSequence = new Map();
  const localGestures = new Map();
  // Envois séparés : un MySQL qui rame ne retient pas les plafonds, et
  // inversement.
  let statsFlushing = null;
  let capsFlushing = null;
  let timer = null;

  // Le pool est demandé au moment de l'envoi : au chargement de la route, il
  // n'est pas encore prêt.
  function requirePool() {
    let db = pool;
    if (!db && typeof getPool === 'function') {
      try {
        db = getPool();
      } catch {
        db = null;
      }
    }
    if (!isPool(db)) throw new Error('MySQL absent');
    return db;
  }

  // `countsTowardCap: false` : l'ouverture entre dans les stats mais pas dans
  // le plafond `globalPerDay` (IP qui a déjà beaucoup ouvert aujourd'hui).
  function recordOpening({ adId = null, placement, countsTowardCap = true } = {}) {
    if (typeof placement !== 'string' || !placement || placement.length > MAX_KEY_LENGTH) return;
    const id = typeof adId === 'string' && adId ? adId : null;
    if (id && id.length > MAX_KEY_LENGTH) return;
    const dateKey = getParisDateKey(now());
    addCount(pendingStats, dateKey, `${id || NONE_FIELD}|${placement}`, 1);
    if (id && countsTowardCap !== false) addCount(pendingCaps, dateKey, id, 1);
  }

  function getGlobalCounts(dateKey) {
    const counts = {};
    for (const store of [redisCaps, lostCaps, inflightCaps, pendingCaps]) {
      const fields = store?.get(dateKey);
      if (!fields) continue;
      for (const [id, amount] of fields) {
        counts[id] = (counts[id] || 0) + amount;
      }
    }
    return counts;
  }

  // Seul le jour en cours sert au plafond : on oublie les jours passés.
  function forgetPastDays() {
    const today = getParisDateKey(now());
    for (const store of [redisCaps, lostCaps]) {
      for (const dateKey of store.keys()) {
        if (dateKey !== today) store.delete(dateKey);
      }
    }
  }

  function keepLostCaps(caps) {
    for (const [dateKey, ids] of caps) {
      for (const [id, amount] of ids) addCount(lostCaps, dateKey, id, amount);
    }
  }

  async function sendCapsToRedis(caps) {
    try {
      if (!hasPipeline(redis)) throw new Error('Redis absent');
      const pipeline = redis.pipeline();
      const capReplies = [];
      let commandCount = 0;

      for (const [dateKey, ids] of caps) {
        const key = CAP_KEY_PREFIX + dateKey;
        for (const [id, amount] of ids) {
          capReplies.push({ index: commandCount, dateKey, id, amount });
          pipeline.hincrby(key, id, amount);
          commandCount += 1;
        }
        pipeline.expire(key, CAP_TTL_SECONDS);
        commandCount += 1;
      }

      const results = await withTimeout(pipeline.exec(), PIPELINE_TIMEOUT_MS);
      for (const { index, dateKey, id, amount } of capReplies) {
        const [error, value] = Array.isArray(results?.[index]) ? results[index] : [true];
        const total = Number(value);
        if (error || !Number.isFinite(total)) {
          addCount(lostCaps, dateKey, id, amount);
          continue;
        }
        let fields = redisCaps.get(dateKey);
        if (!fields) {
          fields = new Map();
          redisCaps.set(dateKey, fields);
        }
        fields.set(id, Math.max(fields.get(id) || 0, total));
      }
    } catch (error) {
      // Le plafond garde les ouvertures locales.
      console.warn('[Pubs] Plafonds non envoyés à Redis :', error?.message || error);
      keepLostCaps(caps);
    }
    forgetPastDays();
  }

  // MySQL en erreur : les lignes non écrites reviennent en attente pour le
  // prochain envoi. Au-delà de MAX_PENDING_STATS_FIELDS champs (MySQL en panne
  // longtemps), les nouveaux champs sont perdus plutôt que de grossir sans fin.
  function requeueStats(rows) {
    let fieldCount = 0;
    for (const fields of pendingStats.values()) fieldCount += fields.size;
    let dropped = 0;
    for (const { day, adId, placement, openings } of rows) {
      const field = `${adId}|${placement}`;
      if (!pendingStats.get(day)?.has(field)) {
        if (fieldCount >= MAX_PENDING_STATS_FIELDS) {
          dropped += openings;
          continue;
        }
        fieldCount += 1;
      }
      addCount(pendingStats, day, field, openings);
    }
    if (dropped > 0) {
      console.warn(`[Pubs] Trop de statistiques en attente : ${dropped} ouverture(s) perdue(s)`);
    }
  }

  async function sendStatsToMysql(stats) {
    const rows = [];
    for (const [dateKey, fields] of stats) {
      for (const [field, amount] of fields) {
        const row = toRow(dateKey, field, amount);
        if (row) rows.push(row);
      }
    }
    const progress = { written: 0 };
    try {
      await upsertDailyStats(requirePool(), rows, progress);
    } catch (error) {
      console.warn('[Pubs] Statistiques non enregistrées dans MySQL, nouvel essai au prochain envoi :', error?.message || error);
      requeueStats(rows.slice(progress.written));
    }
  }

  function flushStats() {
    if (statsFlushing) return statsFlushing;
    if (!pendingStats.size) return Promise.resolve();
    const stats = pendingStats;
    pendingStats = new Map();
    statsFlushing = sendStatsToMysql(stats).finally(() => {
      statsFlushing = null;
    });
    return statsFlushing;
  }

  function flushCaps() {
    if (capsFlushing) return capsFlushing;
    if (!pendingCaps.size) {
      forgetPastDays();
      return Promise.resolve();
    }
    const caps = pendingCaps;
    pendingCaps = new Map();
    inflightCaps = caps;
    capsFlushing = sendCapsToRedis(caps).finally(() => {
      inflightCaps = null;
      capsFlushing = null;
    });
    return capsFlushing;
  }

  // Ne lance jamais d'exception : les erreurs sont journalisées et les
  // compteurs gardés pour le prochain envoi.
  async function flush() {
    await Promise.all([flushCaps(), flushStats()]);
  }

  // Compteur de séquence `global` propre au worker : aucun appel Redis. Il
  // avance d'un cran par geste, quel que soit le nombre de fenêtres : le
  // navigateur bloque souvent les suivantes, et la 1re fenêtre doit parcourir
  // tout le cycle (A A A B…), pas une case sur deux.
  function nextLocalBase(placement) {
    const base = localSequence.get(placement) || 0;
    localSequence.set(placement, base + 1);
    return base;
  }

  function forgetExpiredGestures(nowMs) {
    for (const [key, entry] of localGestures) {
      if (entry.expiresAt <= nowMs) localGestures.delete(key);
    }
  }

  async function resolveGestureBase(placement, gesture) {
    const base = parseBase(await redis.eval(
      GESTURE_BASE_SCRIPT,
      2,
      GESTURE_KEY_PREFIX + gesture,
      SEQUENCE_KEY_PREFIX + placement,
      GESTURE_TTL_SECONDS
    ));
    if (base === null) throw new Error('Compteur de séquence illisible');
    return base;
  }

  async function resolveGestureBaseSafely(placement, gesture) {
    try {
      if (!redis || typeof redis.eval !== 'function') throw new Error('Redis absent');
      return await withTimeout(resolveGestureBase(placement, gesture), GESTURE_REDIS_TIMEOUT_MS);
    } catch (error) {
      console.warn('[Pubs] Point de départ du geste calculé en local :', error?.message || error);
      return nextLocalBase(placement);
    }
  }

  // Point de départ commun aux fenêtres d'un même geste (portée `global`).
  // Les fenêtres qui arrivent sur ce worker réutilisent la même promesse :
  // un seul aller-retour Redis par geste et par worker.
  function nextGestureBase({ placement, gesture, windows } = {}) {
    if (normalizeWindows(windows) <= 1 || typeof gesture !== 'string' || !gesture) {
      return Promise.resolve(nextLocalBase(placement));
    }

    const nowMs = Date.now();
    const memoryKey = `${placement}:${gesture}`;
    const remembered = localGestures.get(memoryKey);
    if (remembered && remembered.expiresAt > nowMs) return remembered.promise;

    if (localGestures.size >= GESTURE_MEMORY_MAX_ENTRIES) forgetExpiredGestures(nowMs);
    if (localGestures.size >= GESTURE_MEMORY_MAX_ENTRIES) localGestures.clear();
    const promise = resolveGestureBaseSafely(placement, gesture);
    localGestures.set(memoryKey, { promise, expiresAt: nowMs + GESTURE_MEMORY_TTL_MS });
    return promise;
  }

  // Ouvertures de chaque jour de `from` à `to` (YYYY-MM-DD, jours de Paris),
  // du plus ancien au plus récent ; `counts` vide un jour sans ouverture. Les
  // compteurs de ce worker encore en attente sont envoyés avant la lecture.
  async function readStats({ from, to } = {}) {
    if (!isValidPeriod(from, to)) throw new Error('Période de statistiques invalide');
    // Un envoi déjà en cours n'a pas les dernières ouvertures : on l'attend,
    // puis on envoie ce qui reste.
    if (statsFlushing) await statsFlushing;
    await flushStats();
    const [rows] = await requirePool().query(SELECT_STATS_SQL, [from, to]);

    const days = [];
    const countsByDate = new Map();
    const dayCount = countDaysBetween(from, to) + 1;
    for (let offset = 0; offset < dayCount; offset += 1) {
      const date = shiftDateKey(from, offset);
      const counts = {};
      days.push({ date, counts });
      countsByDate.set(date, counts);
    }
    for (const row of Array.isArray(rows) ? rows : []) {
      const counts = countsByDate.get(formatDay(row?.day));
      const amount = Number(row?.openings);
      if (!counts || !Number.isFinite(amount) || amount <= 0) continue;
      const field = `${row.ad_id}|${row.placement}`;
      counts[field] = (counts[field] || 0) + amount;
    }
    return days;
  }

  // Premier jour présent dans la table (YYYY-MM-DD), ou null si elle est vide.
  async function readFirstStatsDate() {
    const [rows] = await requirePool().query(SELECT_FIRST_DAY_SQL);
    const first = Array.isArray(rows) ? rows[0]?.first_day : null;
    return first === null || first === undefined ? null : formatDay(first);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  if (Number(flushIntervalMs) > 0) {
    timer = setInterval(() => {
      flush().catch(() => {});
    }, Number(flushIntervalMs));
    // La minuterie ne doit pas retenir l'arrêt du worker.
    timer.unref?.();
  }

  return {
    recordOpening,
    getGlobalCounts,
    nextGestureBase,
    nextLocalBase,
    flush,
    readStats,
    readFirstStatsDate,
    stop
  };
}

module.exports = {
  DAILY_STATS_TABLE,
  STATS_KEY_PREFIX,
  LEGACY_IMPORT_FLAG_KEY,
  LEGACY_IMPORT_DAYS,
  CAP_KEY_PREFIX,
  SEQUENCE_KEY_PREFIX,
  GESTURE_KEY_PREFIX,
  CAP_TTL_SECONDS,
  GESTURE_TTL_SECONDS,
  MAX_PENDING_STATS_FIELDS,
  MAX_ROWS_PER_INSERT,
  MAX_STATS_SPAN_DAYS,
  createMonetizationStats,
  ensureMonetizationDailyStatsTable,
  importLegacyRedisStats,
  getParisDateKey,
  shiftDateKey,
  isDateKey,
  countDaysBetween
};
