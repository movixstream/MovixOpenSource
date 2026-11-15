const { AsyncLocalStorage } = require('node:async_hooks');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { HttpProxyAgent } = require('http-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');

const WIFLIX_PROXY_REDIS_KEY = 'wiflix:free-proxy:last-success';
const WIFLIX_PROXY_REDIS_TTL_SECONDS = 24 * 60 * 60;
// Exclusion d'un proxy : longue après un blocage (403, page bouclier), courte
// après un délai dépassé ou une erreur réseau, souvent passagers.
const WIFLIX_DEAD_PROXY_BLOCKED_MS = 2 * 60 * 1000;
const WIFLIX_DEAD_PROXY_TRANSPORT_MS = 30 * 1000;
const WIFLIX_DEAD_PROXY_MAX_ENTRIES = 5000;
// Délai dur d'une requête par proxy (connexion, CONNECT, TLS et réponse).
const WIFLIX_REQUEST_DEADLINE_MS = 6000;
// Plafond d'une réponse décompressée : un proxy défaillant ne remplit pas la mémoire.
const WIFLIX_RESPONSE_MAX_BYTES = 4 * 1024 * 1024;
const WIFLIX_AGENT_SOCKET_TIMEOUT_MS = 15000;
// Débit global vers Flemmix, pour tout le cluster : une requête toutes les
// 100 ms (WIFLIX_GLOBAL_MIN_INTERVAL_MS), contre ~103/s mesurées le 2026-10-19.
// Un titre sans cache (visiteur en 202) attend son créneau jusqu'à 2 s ; une
// actualisation de cache périmé, qui sert déjà l'ancien, 1 s seulement : elle
// cède la place.
const WIFLIX_GLOBAL_NEXT_KEY = 'wiflix:global:next';
const WIFLIX_GLOBAL_MIN_INTERVAL_MS = 100;
const WIFLIX_GLOBAL_MAX_WAIT_MS = { missing: 2000, stale: 1000 };
const WIFLIX_GLOBAL_MAX_PENDING = 20;
// Cookie de session du bouclier, par proxy : gardé 10 min après son dernier
// usage réussi (une session PHP expire après 24 min d'inactivité), 1 h au plus.
const WIFLIX_SESSION_IDLE_MS = 10 * 60 * 1000;
const WIFLIX_SESSION_MAX_AGE_MS = 60 * 60 * 1000;
const WIFLIX_SESSION_MAX_ENTRIES = 256;
// Cookies refusés d'affilée (puis acceptés frais) avant de suspendre la reprise.
const WIFLIX_SESSION_REJECT_LIMIT = 5;
const WIFLIX_SESSION_PAUSE_MS = 30 * 60 * 1000;

// Prochain créneau libre, partagé par les workers ; -1 si l'attente dépasse
// ARGV[3]. Même script que la porte globale KissKH.
const RESERVE_WIFLIX_GLOBAL_SCRIPT = [
  "local current = tonumber(redis.call('GET', KEYS[1]) or '0')",
  'local now = tonumber(ARGV[1])',
  'local interval = tonumber(ARGV[2])',
  'local slot = math.max(now, current)',
  'if slot - now >= tonumber(ARGV[3]) then return -1 end',
  'local next_slot = slot + interval',
  "redis.call('SET', KEYS[1], tostring(next_slot), 'PX', next_slot - now + interval)",
  'return slot - now',
].join('\n');

const COMPARE_AND_DELETE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

function isValidWiflixProxyUrl(proxyUrl) {
  return (
    typeof proxyUrl === 'string' &&
    /^(?:https?|socks5h?):\/\/[^\s]+:\d+$/i.test(proxyUrl.trim())
  );
}

function isSocksWiflixProxyUrl(proxyUrl) {
  return (
    isValidWiflixProxyUrl(proxyUrl) &&
    /^socks5h?:\/\//i.test(proxyUrl.trim())
  );
}

function mergeWiflixProxySources(...sources) {
  const merged = [];
  const seen = new Set();

  for (const source of sources) {
    for (const proxyUrl of Array.isArray(source) ? source : []) {
      if (!isValidWiflixProxyUrl(proxyUrl)) continue;
      const normalized = proxyUrl.trim();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      merged.push(normalized);
    }
  }

  return merged;
}

function redactWiflixProxyUrl(proxyUrl) {
  try {
    const parsed = new URL(proxyUrl);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '[proxy invalide]';
  }
}

function createWiflixProxyAffinity({
  redis,
  key = WIFLIX_PROXY_REDIS_KEY,
  ttlSeconds = WIFLIX_PROXY_REDIS_TTL_SECONDS,
}) {
  return {
    async getPreferred() {
      try {
        const proxyUrl = await redis.get(key);
        return isValidWiflixProxyUrl(proxyUrl) ? proxyUrl.trim() : null;
      } catch {
        return null;
      }
    },

    async remember(proxyUrl) {
      if (!isValidWiflixProxyUrl(proxyUrl)) return false;
      try {
        await redis.set(key, proxyUrl.trim(), 'EX', ttlSeconds);
        return true;
      } catch {
        return false;
      }
    },

    async forget(proxyUrl) {
      if (!isValidWiflixProxyUrl(proxyUrl)) return false;
      try {
        const deleted = await redis.eval(
          COMPARE_AND_DELETE_SCRIPT,
          1,
          key,
          proxyUrl.trim(),
        );
        return Number(deleted) > 0;
      } catch {
        return false;
      }
    },
  };
}

function orderWiflixProxyCandidates({
  priorityProxies = [],
  preferred,
  proxies,
  deadProxies,
  maxAttempts,
}) {
  const ordered = [];
  const seen = new Set();
  const limit = Math.max(0, Math.floor(Number(maxAttempts) || 0));

  for (const proxyUrl of [
    ...(Array.isArray(priorityProxies) ? priorityProxies : []),
    preferred,
    ...(Array.isArray(proxies) ? proxies : []),
  ]) {
    if (!isValidWiflixProxyUrl(proxyUrl)) continue;
    const normalized = proxyUrl.trim();
    if (seen.has(normalized) || deadProxies?.has(normalized)) continue;
    seen.add(normalized);
    ordered.push(normalized);
    if (ordered.length >= limit) break;
  }

  return ordered;
}

// Statut HTTP d'un essai raté (réponse d'axios ou réponse jugée invalide), ou null.
function wiflixFailureStatus(error) {
  const status = Number(error?.response?.status ?? error?.wiflixStatus);
  return Number.isInteger(status) && status > 0 ? status : null;
}

// Refus de la porte de débit globale : aucune requête n'est partie.
function isWiflixRateLimited(error) {
  return error?.code === 'WIFLIX_RATE_LIMITED';
}

// Délai dépassé, connexion coupée, CONNECT sans réponse : rien n'a été reçu.
function isWiflixTransportFailure(error) {
  return wiflixFailureStatus(error) === null && !isWiflixRateLimited(error);
}

function isWiflixSocketReset(error) {
  return isWiflixTransportFailure(error)
    && (error?.code === 'ECONNRESET' || error?.code === 'EPIPE');
}

// Verdict d'un essai raté :
// - débit global atteint : rien n'est parti, le proxy n'y est pour rien ; les
//   essais s'arrêtent (le proxy suivant serait refusé de même) ;
// - 404 : l'origine a répondu par ce proxy, qui est sain, et la page n'existe
//   pas : les essais s'arrêtent et cette erreur remonte telle quelle ;
// - 503 : l'origine a été atteinte mais refuse pour l'instant : l'essai compte,
//   le proxy reste utilisable ;
// - autre statut, page bouclier ou réponse invalide : proxy écarté 2 min ;
// - délai dépassé ou erreur réseau : proxy écarté 30 s.
function classifyWiflixProxyFailure(error) {
  if (isWiflixRateLimited(error)) return { dead: false, stop: true };
  const status = wiflixFailureStatus(error);
  if (status === 404) return { dead: false, stop: true };
  if (status === 503) return { dead: false };
  if (status !== null) return { dead: true, ttlMs: WIFLIX_DEAD_PROXY_BLOCKED_MS };
  return { dead: true, ttlMs: WIFLIX_DEAD_PROXY_TRANSPORT_MS };
}

// Proxys écartés, chacun avec sa propre échéance : une IP refusée revient
// seule dans la rotation, au lieu d'un vidage complet de la liste.
function createWiflixDeadProxies({
  now = Date.now,
  defaultTtlMs = WIFLIX_DEAD_PROXY_TRANSPORT_MS,
  maxEntries = WIFLIX_DEAD_PROXY_MAX_ENTRIES,
} = {}) {
  const until = new Map();
  const purge = () => {
    const time = now();
    for (const [proxyUrl, expiresAt] of until) {
      if (expiresAt <= time) until.delete(proxyUrl);
    }
  };
  const has = (proxyUrl) => {
    const expiresAt = until.get(proxyUrl);
    if (expiresAt === undefined) return false;
    if (expiresAt > now()) return true;
    until.delete(proxyUrl);
    return false;
  };

  const store = {
    add(proxyUrl, ttlMs) {
      const delay = Number(ttlMs) > 0 ? Number(ttlMs) : defaultTtlMs;
      const expiresAt = now() + delay;
      // Un délai dépassé ne raccourcit pas l'exclusion d'un proxy bloqué.
      if ((until.get(proxyUrl) || 0) >= expiresAt) return store;
      until.delete(proxyUrl);
      until.set(proxyUrl, expiresAt);
      if (until.size > maxEntries) {
        purge();
        while (until.size > maxEntries) until.delete(until.keys().next().value);
      }
      return store;
    },
    has,
    remainingMs: (proxyUrl) => (has(proxyUrl) ? until.get(proxyUrl) - now() : 0),
    delete: (proxyUrl) => until.delete(proxyUrl),
    clear: () => until.clear(),
    get size() {
      purge();
      return until.size;
    },
  };
  return store;
}

// Le délai d'axios n'est qu'un minuteur d'inactivité, armé une fois le socket
// remis par l'agent : la connexion au proxy et sa réponse au CONNECT n'avaient
// aucune borne. Chaque ouverture reçoit un signal qui détruit le socket s'il
// n'est pas prêt à temps ; il est désarmé dès que la connexion est établie.
function withConnectDeadline(ProxyAgent) {
  return class extends ProxyAgent {
    constructor(proxyUrl, { connectDeadlineMs, ...options } = {}) {
      super(proxyUrl, options);
      this.connectDeadlineMs = connectDeadlineMs;
      // https-proxy-agent remplace this.options : sans ce rappel, un socket
      // libre ne serait jamais fermé pour inactivité.
      if (this.options && this.options.timeout === undefined && options.timeout !== undefined) {
        this.options.timeout = options.timeout;
      }
    }

    connect(req, opts) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.connectDeadlineMs);
      const connectOpts = this.connectOpts;
      // http(s)-proxy-agent ouvrent le socket avec connectOpts avant leur premier await.
      this.connectOpts = { ...connectOpts, signal: controller.signal };
      let pending;
      try {
        pending = super.connect(req, opts);
      } finally {
        this.connectOpts = connectOpts;
      }
      return Promise.resolve(pending).finally(() => clearTimeout(timer));
    }
  };
}

const WiflixHttpProxyAgent = withConnectDeadline(HttpProxyAgent);
const WiflixHttpsProxyAgent = withConnectDeadline(HttpsProxyAgent);

// Agents keep-alive d'un proxy : le GET d'accueil et le POST d'un même essai,
// puis les requêtes suivantes par ce proxy, réutilisent la connexion. Un
// socket libre est fermé après 15 s d'inactivité.
function createWiflixProxyAgents(proxyUrl, {
  keepAlive = true,
  connectDeadlineMs = WIFLIX_REQUEST_DEADLINE_MS,
} = {}) {
  const options = {
    keepAlive,
    maxSockets: 4,
    maxFreeSockets: 1,
    timeout: WIFLIX_AGENT_SOCKET_TIMEOUT_MS,
  };
  if (isSocksWiflixProxyUrl(proxyUrl)) {
    // SOCKS : la connexion est déjà bornée par le délai de la négociation.
    const agent = new SocksProxyAgent(proxyUrl, options);
    return { httpAgent: agent, httpsAgent: agent, destroy() { agent.destroy(); } };
  }
  const httpAgent = new WiflixHttpProxyAgent(proxyUrl, { ...options, connectDeadlineMs });
  const httpsAgent = new WiflixHttpsProxyAgent(proxyUrl, { ...options, connectDeadlineMs });
  return {
    httpAgent,
    httpsAgent,
    destroy() { httpAgent.destroy(); httpsAgent.destroy(); },
  };
}

function hasFreeWiflixSocket(agents) {
  return [agents?.httpAgent, agents?.httpsAgent].some((agent) =>
    Object.values(agent?.freeSockets || {}).some((sockets) => sockets?.length > 0));
}

// Borne toute la requête : `send(signal)` est annulée à l'échéance, et la
// promesse échoue à temps même si le transport ignore le signal.
async function runWithWiflixDeadline(send, deadlineMs = WIFLIX_REQUEST_DEADLINE_MS) {
  const controller = new AbortController();
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = Object.assign(
        new Error(`timeout of ${deadlineMs}ms exceeded (délai dur Wiflix)`),
        { code: 'ECONNABORTED', wiflixDeadline: true },
      );
      reject(error);
      controller.abort(error);
    }, deadlineMs);
  });
  try {
    return await Promise.race([send(controller.signal), expired]);
  } finally {
    clearTimeout(timer);
  }
}

async function runWiflixProxyAttempts({
  affinity,
  priorityProxies = [],
  proxies,
  deadProxies,
  maxAttempts,
  attempt,
  onFailure,
  // Par défaut, tout échec écarte le proxy (voir classifyWiflixProxyFailure).
  classifyFailure = () => ({ dead: true }),
}) {
  let preferred = null;
  try {
    preferred = await affinity?.getPreferred?.();
  } catch {
    preferred = null;
  }

  const candidates = orderWiflixProxyCandidates({
    priorityProxies,
    preferred,
    proxies,
    deadProxies,
    maxAttempts,
  });
  let lastError = null;

  for (let index = 0; index < candidates.length; index++) {
    const proxyUrl = candidates[index];
    try {
      const response = await attempt(proxyUrl, index, candidates.length);
      try {
        await affinity?.remember?.(proxyUrl);
      } catch {
        // Redis is best-effort; a cache outage must not discard a good response.
      }
      return {
        response,
        proxyUrl,
        attemptedCount: index + 1,
        candidateCount: candidates.length,
      };
    } catch (error) {
      lastError = error;
      let verdict;
      try {
        verdict = classifyFailure(error) || {};
      } catch {
        verdict = { dead: true };
      }

      if (verdict.dead !== false) {
        deadProxies?.add(proxyUrl, verdict.ttlMs);

        if (proxyUrl === preferred) {
          try {
            await affinity?.forget?.(proxyUrl);
          } catch {
            // Fail open when Redis is unavailable.
          }
        }
      }

      try {
        await onFailure?.(proxyUrl, error);
      } catch {
        // Cleanup hooks must not stop proxy rotation.
      }

      if (verdict.stop) {
        return {
          response: null,
          proxyUrl: null,
          attemptedCount: index + 1,
          candidateCount: candidates.length,
          lastError,
          stopped: true,
        };
      }
    }
  }

  return {
    response: null,
    proxyUrl: null,
    attemptedCount: candidates.length,
    candidateCount: candidates.length,
    lastError,
  };
}

// Priorité des requêtes Flemmix de l'actualisation en cours : « missing » pour
// un titre sans cache, « stale » (par défaut) pour un cache périmé déjà servi.
const wiflixPriority = new AsyncLocalStorage();

function runWithWiflixPriority(priority, work) {
  return wiflixPriority.run(priority === 'missing' ? 'missing' : 'stale', work);
}

function wiflixRateLimited(priority) {
  return Object.assign(new Error('Flemmix : débit global atteint, requête différée'), {
    code: 'WIFLIX_RATE_LIMITED',
    priority,
  });
}

// Porte de débit globale vers Flemmix (voir WIFLIX_GLOBAL_*), comme celle de
// KissKH : chaque requête prend un créneau dans Redis avant de partir. Au-delà
// de l'attente permise, refus immédiat : une indisponibilité passagère pour
// l'appelant, jamais un échec de proxy. Sans Redis, le même intervalle est
// tenu dans ce worker. Les refus sont relevés en une ligne par minute.
function createWiflixGlobalGate({
  redis,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  minIntervalMs = WIFLIX_GLOBAL_MIN_INTERVAL_MS,
  maxWaitMs = WIFLIX_GLOBAL_MAX_WAIT_MS,
  maxPending = WIFLIX_GLOBAL_MAX_PENDING,
  key = WIFLIX_GLOBAL_NEXT_KEY,
  log = (message) => console.warn(message),
  schedule = (callback, ms) => setTimeout(callback, ms),
} = {}) {
  let nextAt = 0; // Fin de la file vue par ce worker.
  let pending = 0;
  const retryAt = { missing: 0, stale: 0 };
  let refused = null;

  const refuse = (level) => {
    if (!refused) {
      refused = { missing: 0, stale: 0 };
      schedule(() => {
        const { missing, stale } = refused;
        refused = null;
        log(`[WIFLIX GATE] Débit global de ${Math.round(1000 / minIntervalMs)} req/s : ${
          missing + stale} requêtes refusées en 1 min (${missing} titres sans cache, ${stale} caches périmés)`);
      }, 60_000)?.unref?.();
    }
    refused[level]++;
    return wiflixRateLimited(level);
  };

  async function reserve(priority = wiflixPriority.getStore()) {
    if (!(minIntervalMs > 0)) return 0; // Porte désactivée (intervalle 0).
    const level = priority === 'missing' ? 'missing' : 'stale';
    const limit = maxWaitMs[level];
    const requestedAt = now();
    // File locale pleine, refus récent ou file déjà trop longue : sans Redis.
    if (pending >= maxPending || requestedAt < retryAt[level] || nextAt - requestedAt >= limit) {
      throw refuse(level);
    }
    pending++;
    try {
      let waitMs;
      if (typeof redis?.eval === 'function') {
        try {
          waitMs = Number(await redis.eval(
            RESERVE_WIFLIX_GLOBAL_SCRIPT, 1, key, requestedAt, minIntervalMs, limit,
          ));
          if (!Number.isSafeInteger(waitMs) || waitMs < -1 || waitMs >= limit) waitMs = undefined;
        } catch {
          // Redis indisponible : même intervalle, tenu dans ce worker.
        }
      }
      if (waitMs === undefined) waitMs = Math.max(0, nextAt - requestedAt);
      if (waitMs === -1 || waitMs >= limit) {
        // File du cluster pleine : pas de nouvel appel Redis avant un intervalle.
        // Un titre sans cache refusé l'est aussi pour les caches périmés.
        retryAt[level] = now() + minIntervalMs;
        if (level === 'missing') retryAt.stale = retryAt.missing;
        throw refuse(level);
      }
      nextAt = Math.max(nextAt, requestedAt + waitMs + minIntervalMs);
      if (waitMs > 0) await sleep(waitMs);
      return waitMs;
    } finally {
      pending--;
    }
  }

  return { reserve };
}

// Cookies de session du bouclier Flemmix, par proxy (le cookie est lié à l'IP
// du proxy), dans la mémoire du worker : une recherche par un proxy connu saute
// le GET d'accueil. Si 5 cookies d'affilée sont refusés alors qu'un cookie
// frais passe aussitôt sur le même proxy, la reprise est suspendue 30 min : le
// site ne l'accepte plus et chaque essai coûterait un POST de plus.
function createWiflixSessionCookies({
  now = Date.now,
  idleMs = WIFLIX_SESSION_IDLE_MS,
  maxAgeMs = WIFLIX_SESSION_MAX_AGE_MS,
  maxEntries = WIFLIX_SESSION_MAX_ENTRIES,
  rejectLimit = WIFLIX_SESSION_REJECT_LIMIT,
  pauseMs = WIFLIX_SESSION_PAUSE_MS,
} = {}) {
  // Ordre d'insertion : dernier usage réussi, le plus récent en dernier.
  const sessions = new Map();
  let rejectedInRow = 0;
  let pausedUntil = 0;
  const live = (proxyUrl) => {
    const session = sessions.get(proxyUrl);
    if (!session) return null;
    const time = now();
    if (time - session.usedAt < idleMs && time - session.createdAt < maxAgeMs) return session;
    sessions.delete(proxyUrl);
    return null;
  };

  return {
    // Cookie à reprendre pour ce proxy, ou null.
    get(proxyUrl) {
      if (now() < pausedUntil) return null;
      return live(proxyUrl)?.cookie || null;
    },
    // Poignée de main complète réussie. `replaced` : le cookie connu de ce
    // proxy venait d'être refusé.
    remember(proxyUrl, cookie, { replaced = false } = {}) {
      if (!cookie) return;
      const time = now();
      sessions.delete(proxyUrl);
      sessions.set(proxyUrl, { cookie, createdAt: time, usedAt: time });
      while (sessions.size > maxEntries) sessions.delete(sessions.keys().next().value);
      if (replaced && ++rejectedInRow >= rejectLimit) {
        rejectedInRow = 0;
        pausedUntil = time + pauseMs;
      }
    },
    // Cookie repris avec succès : son délai d'inactivité repart de zéro.
    confirm(proxyUrl) {
      rejectedInRow = 0;
      const session = live(proxyUrl);
      if (!session) return;
      session.usedAt = now();
      sessions.delete(proxyUrl);
      sessions.set(proxyUrl, session);
    },
    forget(proxyUrl) {
      sessions.delete(proxyUrl);
    },
    // Proxys au cookie encore valable, le dernier utilisé d'abord.
    warm(limit) {
      const warm = [];
      if (now() < pausedUntil) return warm;
      for (const proxyUrl of [...sessions.keys()].reverse()) {
        if (warm.length >= limit) break;
        if (live(proxyUrl)) warm.push(proxyUrl);
      }
      return warm;
    },
    get size() {
      return sessions.size;
    },
  };
}

module.exports = {
  WIFLIX_AGENT_SOCKET_TIMEOUT_MS,
  WIFLIX_DEAD_PROXY_BLOCKED_MS,
  WIFLIX_DEAD_PROXY_TRANSPORT_MS,
  WIFLIX_GLOBAL_MAX_WAIT_MS,
  WIFLIX_GLOBAL_MIN_INTERVAL_MS,
  WIFLIX_GLOBAL_NEXT_KEY,
  WIFLIX_PROXY_REDIS_KEY,
  WIFLIX_PROXY_REDIS_TTL_SECONDS,
  WIFLIX_REQUEST_DEADLINE_MS,
  WIFLIX_RESPONSE_MAX_BYTES,
  WIFLIX_SESSION_IDLE_MS,
  classifyWiflixProxyFailure,
  createWiflixDeadProxies,
  createWiflixGlobalGate,
  createWiflixProxyAffinity,
  createWiflixProxyAgents,
  createWiflixSessionCookies,
  hasFreeWiflixSocket,
  isSocksWiflixProxyUrl,
  isValidWiflixProxyUrl,
  isWiflixRateLimited,
  isWiflixSocketReset,
  isWiflixTransportFailure,
  mergeWiflixProxySources,
  orderWiflixProxyCandidates,
  redactWiflixProxyUrl,
  runWiflixProxyAttempts,
  runWithWiflixDeadline,
  runWithWiflixPriority,
  wiflixFailureStatus,
};
