'use strict';

// Disjoncteur par source amont (Coflix, Flemmix, Cpasmal…), propre à chaque
// worker : aucun appel Redis, donc aucun coût quand la source répond.
// - fermé : les requêtes passent ; `failureThreshold` pannes d'affilée (délai,
//   408, 5xx, blocage 403/429, erreur réseau) l'ouvrent ;
// - ouvert : pendant `openMs` (5 min par défaut), chaque appel échoue tout de
//   suite avec SOURCE_CIRCUIT_OPEN, sans réseau ni proxy ;
// - à l'échéance, une seule requête d'essai passe : un succès referme le
//   circuit, un échec le rouvre pour `openMs`.
// Une réponse définitive de la source (200, 404, 400…) compte comme un succès :
// la source est joignable, c'est seulement le contenu qui manque.

const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_OPEN_MS = 5 * 60 * 1000;

const SOURCE_DOWN_STATUSES = new Set([0, 403, 408, 425, 429]);

function isSourceCircuitOpenError(error) {
  return error?.isSourceCircuitOpen === true;
}

function responseStatusOf(error) {
  const status = Number(error?.response?.status ?? error?.httpStatus);
  return Number.isInteger(status) ? status : null;
}

// Statut HTTP (ou synthétique CycleTLS : 0/408) qui signale une source en panne
// ou qui nous bloque, par opposition à une réponse définitive sur le contenu.
function isSourceDownStatus(status) {
  return SOURCE_DOWN_STATUSES.has(status) || (status >= 500 && status < 600);
}

function createSourceCircuitBreaker({
  name,
  failureThreshold = DEFAULT_FAILURE_THRESHOLD,
  openMs = DEFAULT_OPEN_MS,
  // Codes d'erreur qui ne disent rien de la source (pool de proxys vide…).
  neutralCodes = [],
  now = Date.now,
  logger = console,
} = {}) {
  if (!name) throw new TypeError('nom de source requis');
  const threshold = Math.max(1, Math.floor(Number(failureThreshold) || DEFAULT_FAILURE_THRESHOLD));
  const pauseMs = Math.max(1000, Math.floor(Number(openMs) || DEFAULT_OPEN_MS));
  const neutral = new Set(neutralCodes);

  let state = 'closed';
  let failures = 0;
  let openUntil = 0;
  let probeInFlight = false;
  let lastFailure = null;

  function openError() {
    const retryAfterMs = Math.max(0, openUntil - now());
    return Object.assign(
      new Error(`Source ${name} en pause après des échecs répétés (reprise dans ${Math.ceil(retryAfterMs / 1000)} s)`),
      { code: 'SOURCE_CIRCUIT_OPEN', isSourceCircuitOpen: true, source: name, retryAfterMs, httpStatus: 503 },
    );
  }

  function describe(error) {
    if (!error) return 'statut en échec';
    const status = responseStatusOf(error);
    return status !== null ? `HTTP ${status}` : String(error.code || error.message || 'erreur').slice(0, 80);
  }

  function trip(reason) {
    const reopening = state === 'half-open';
    state = 'open';
    failures = 0;
    openUntil = now() + pauseMs;
    logger?.warn?.(
      `[CIRCUIT] ${name} ${reopening ? 'toujours en échec' : `en échec ${threshold} fois d'affilée`} (${reason}) : pause de ${Math.round(pauseMs / 60000)} min`,
    );
  }

  // Réserve un passage, ou lève SOURCE_CIRCUIT_OPEN si la source est en pause.
  function enter() {
    if (state === 'open') {
      if (now() < openUntil) throw openError();
      state = 'half-open';
    }
    if (state === 'half-open') {
      // Une seule requête d'essai à la fois ; les autres attendent son verdict.
      if (probeInFlight) throw openError();
      probeInFlight = true;
      return { probe: true };
    }
    return { probe: false };
  }

  function settle(ticket, verdict, reason) {
    if (ticket.probe) probeInFlight = false;
    if (verdict === 'neutral') return;
    if (verdict === 'success') {
      // Une réponse arrivée pendant la pause vient d'une requête lancée avant :
      // elle ne lève pas la pause, seule la requête d'essai le peut.
      if (state === 'open') return;
      if (state === 'half-open') logger?.log?.(`[CIRCUIT] ${name} répond de nouveau : reprise normale`);
      state = 'closed';
      failures = 0;
      return;
    }
    lastFailure = reason;
    if (state === 'open') return; // Échecs en vol au moment de la coupure.
    if (state === 'half-open') {
      if (ticket.probe) trip(reason);
      return;
    }
    failures += 1;
    if (failures >= threshold) trip(reason);
  }

  function classifyError(error) {
    if (isSourceCircuitOpenError(error)) return 'neutral';
    if (error?.code && neutral.has(error.code)) return 'neutral';
    const status = responseStatusOf(error);
    if (status === null) return 'failure'; // Délai, erreur réseau ou proxy.
    return isSourceDownStatus(status) ? 'failure' : 'success';
  }

  // `classifyResult(résultat)` sert aux helpers qui renvoient un statut d'erreur
  // au lieu de lever (CycleTLS) : 'failure' | 'success' | 'neutral'.
  async function run(task, { classifyResult } = {}) {
    const ticket = enter();
    let result;
    try {
      result = await task();
    } catch (error) {
      settle(ticket, classifyError(error), describe(error));
      throw error;
    }
    const verdict = classifyResult ? classifyResult(result) : 'success';
    settle(ticket, verdict, describe(result?.status !== undefined ? { httpStatus: result.status } : null));
    return result;
  }

  function isOpen() {
    return state === 'open' && now() < openUntil;
  }

  function snapshot() {
    return {
      name,
      state: state === 'open' && now() >= openUntil ? 'half-open' : state,
      failures,
      retryAfterMs: state === 'open' ? Math.max(0, openUntil - now()) : 0,
      lastFailure,
    };
  }

  return Object.freeze({ run, isOpen, snapshot });
}

module.exports = {
  DEFAULT_FAILURE_THRESHOLD,
  DEFAULT_OPEN_MS,
  createSourceCircuitBreaker,
  isSourceCircuitOpenError,
  isSourceDownStatus,
};
