'use strict';

// Plafond du temps accepté par POST /api/wrapped/track : jamais plus que le
// temps réel, par profil et par type (visionnage ou page). Le navigateur
// annonce sa durée (60 s au plus par envoi) ; sans ce plafond, un script
// envoyant 30 fois « 60 s » par minute comptait 30 minutes par minute, pour
// le Wrapped comme pour le parrainage qui s'appuie dessus.
//
// Un curseur retient l'instant jusqu'où le temps a déjà été crédité. Un envoi
// ne peut consommer que le temps entre ce curseur et maintenant (+ 5 s de
// marge pour le réseau), et le curseur avance d'autant : multiplier les
// petits envois ne donne rien de plus. Après une pause, le curseur repart au
// plus 30 s en arrière (un cycle d'envoi du client). Un usage normal (un
// envoi toutes les 30 s) n'est jamais rogné ; deux onglets du même profil qui
// comptent en même temps se partagent le temps réel, ce qui est voulu.

const SLACK_MS = 5 * 1000;
const BACKLOG_MS = 30 * 1000;
const IDLE_TTL_MS = 10 * 60 * 1000;
const KEY_PREFIX = 'wrapped:budget:';
const MEMORY_MAX_ENTRIES = 50000;

// Même calcul que applyBudget, fait par Redis en une seule opération : deux
// workers qui reçoivent deux envois en même temps ne lisent jamais le même curseur.
// '%.0f' et non '%d' : un horodatage en millisecondes dépasse les entiers de
// certains Lua, '%.0f' l'écrit pareil partout.
const BUDGET_SCRIPT = `
local now = tonumber(ARGV[1])
local requested = tonumber(ARGV[2])
local backlog = tonumber(ARGV[3])
local slack = tonumber(ARGV[4])
local cursor = tonumber(redis.call('GET', KEYS[1]) or '0') or 0
if cursor < now - backlog then cursor = now - backlog end
local available = now + slack - cursor
if available < 0 then available = 0 end
local allowed = requested
if allowed > available then allowed = available end
allowed = math.floor(allowed / 1000) * 1000
redis.call('SET', KEYS[1], string.format('%.0f', cursor + allowed), 'PX', ARGV[5])
return allowed
`;

/**
 * @param {number|null} cursorMs instant jusqu'où le temps est déjà crédité
 * @returns {{ allowedMs: number, cursorMs: number }} millisecondes acceptées (secondes entières) et nouveau curseur
 */
function applyBudget(cursorMs, nowMs, requestedMs) {
  let cursor = Number(cursorMs);
  if (!Number.isFinite(cursor) || cursor < nowMs - BACKLOG_MS) cursor = nowMs - BACKLOG_MS;
  const available = Math.max(0, nowMs + SLACK_MS - cursor);
  const allowedMs = Math.floor(Math.min(Math.max(0, requestedMs), available) / 1000) * 1000;
  return { allowedMs, cursorMs: cursor + allowedMs };
}

function buildBudgetKey({ type, userId, profileId }) {
  return `${KEY_PREFIX}${type}:${userId}:${profileId || '-'}`;
}

// Repli sans Redis : même règle, propre à chaque worker.
const memory = new Map();

function takeFromMemory(key, nowMs, requestedMs) {
  if (memory.size >= MEMORY_MAX_ENTRIES) {
    for (const [entryKey, entry] of memory) {
      if (nowMs - entry.touchedMs > IDLE_TTL_MS) memory.delete(entryKey);
    }
    if (memory.size >= MEMORY_MAX_ENTRIES) memory.clear();
  }
  const entry = memory.get(key);
  const result = applyBudget(entry ? entry.cursorMs : null, nowMs, requestedMs);
  memory.set(key, { cursorMs: result.cursorMs, touchedMs: nowMs });
  return result.allowedMs;
}

/**
 * Prend la part de temps réel de cet envoi et renvoie les secondes à créditer.
 * @param {{ redis?: object|null, type: string, userId: string, profileId?: string|null, requestedSeconds: number, nowMs?: number }} options
 */
async function takeWrappedTime({ redis = null, type, userId, profileId = null, requestedSeconds, nowMs = Date.now() }) {
  const key = buildBudgetKey({ type, userId, profileId });
  const requestedMs = Math.max(0, Math.floor(Number(requestedSeconds) || 0)) * 1000;
  let allowedMs;
  if (redis) {
    try {
      allowedMs = Number(await redis.eval(
        BUDGET_SCRIPT, 1, key,
        String(nowMs), String(requestedMs), String(BACKLOG_MS), String(SLACK_MS), String(IDLE_TTL_MS)
      ));
    } catch {
      allowedMs = takeFromMemory(key, nowMs, requestedMs);
    }
  } else {
    allowedMs = takeFromMemory(key, nowMs, requestedMs);
  }
  return Math.max(0, Math.floor((Number(allowedMs) || 0) / 1000));
}

function resetWrappedTimeBudgetMemory() {
  memory.clear();
}

module.exports = {
  SLACK_MS,
  BACKLOG_MS,
  IDLE_TTL_MS,
  BUDGET_SCRIPT,
  applyBudget,
  buildBudgetKey,
  takeWrappedTime,
  resetWrappedTimeBudgetMemory
};
