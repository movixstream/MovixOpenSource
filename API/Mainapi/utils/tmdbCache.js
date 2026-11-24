/**
 * Cache Redis centralisé pour les appels TMDB API.
 * Partagé entre tous les workers du cluster — évite les appels TMDB redondants.
 *
 * Pattern identique à wrappedRoutes.js : redisReady() + get/set avec TTL.
 * Préfixe Redis : "tmdb:"
 *
 * Chaque appel réseau passe par une porte de débit propre au worker (sans Redis).
 * Un 429, un 5xx ou un délai dépassé pose `tmdb:transient:<clé>` pendant 5 s :
 * les autres workers ne redemandent pas tout de suite la même clé.
 * Par défaut, tout échec renvoie null. Avec { strict: true }, un échec temporaire
 * (429, 5xx, délai, porte saturée, marqueur) rejette une erreur dont
 * `code === 'TMDB_TRANSIENT'` ; null veut alors dire absent (404) ou refus définitif (autre 4xx).
 *
 * Un 404 sur les détails (`/{type}/{id}`) pose `tmdb:missing:details:<type>:<id>`
 * pendant 6 h, toutes langues confondues : un ID inconnu de TMDB pour ce type
 * (souvent un ID de film envoyé sur une route série) n'est plus redemandé à
 * chaque requête. Seul un vrai 404 est retenu, jamais un échec temporaire.
 */

const axios = require('axios');
const { redis } = require('../config/redis');
const { createSingleFlight } = require('./singleFlight');
const { refreshStep } = require('./sourceRefreshTelemetry');

// TTL par type de requête (secondes), étalés par un jitter pour éviter les vagues d'expiration
const DAY = 24 * 60 * 60;
const TTL_DETAILS = DAY;              // 24h — titre récent ou encore en diffusion
const TTL_DETAILS_SETTLED = 7 * DAY;  // 7 j — titre sorti depuis plus de 90 jours
const TTL_SEARCH  = 12 * 60 * 60;     // 12h — les résultats de recherche peuvent évoluer
const TTL_STABLE = 30 * DAY;          // 30 j — titres alternatifs, crédits, dates de sortie : petits et quasi immuables
const TTL_MISSING = 6 * 60 * 60;      // 6 h — 404 TMDB confirmé sur les détails
const TTL_DISCOVER = 6 * 60 * 60;     // 6 h — listes « discover » : popularité recalculée chaque jour par TMDB
const SETTLED_AFTER_MS = 90 * DAY * 1000;
const runTmdbRequest = createSingleFlight();

// Porte de débit par worker : TMDB accepte ≈ 36 à 43 requêtes/s par IP, pour 6 workers.
const configuredRate = Number(process.env.TMDB_RATE_PER_WORKER);
const RATE_MAX = configuredRate > 0 ? configuredRate : 7;
const RATE_MIN = Math.min(3, RATE_MAX);
const RATE_RECOVERY = 0.5;          // requêtes/s regagnées chaque seconde après une baisse
const BURST = 3;
const GATE_MAX_WAIT_MS = 1500;
const RETRY_AFTER_MAX_MS = 10_000;
const TRANSIENT_MARKER_MS = 5000;
const PROXY_DOWN_MS = 60_000;
const newGate = () => ({ rate: RATE_MAX, at: Date.now(), tat: 0, pausedUntil: 0, loweredAt: 0 });

// Sorties TMDB : l'IP du serveur, puis chaque proxy SOCKS5 (SOCKS5_PROXIES).
// TMDB limite par IP : chaque sortie a sa propre porte de débit.
// TMDB_USE_SOCKS5=false garde la sortie directe seule.
const USE_SOCKS5 = !['0', 'false', 'no', 'off'].includes(String(process.env.TMDB_USE_SOCKS5 || '').trim().toLowerCase());
const directEgress = { name: 'direct', agent: null, gate: newGate(), downUntil: 0 };
let egresses = null;
function tmdbEgresses() {
  if (egresses) return egresses;
  let proxies = [];
  if (USE_SOCKS5) {
    try {
      // Chargé à la demande : proxyManager est lourd et les bancs de test le simulent.
      const { PROXIES, getProxyAgent } = require('./proxyManager');
      proxies = (PROXIES || []).map(proxy => ({
        name: `socks5:${proxy.host}:${proxy.port}`, agent: getProxyAgent(proxy), gate: newGate(), downUntil: 0,
      })).filter(egress => egress.agent);
    } catch { proxies = []; }
  }
  egresses = [directEgress, ...proxies];
  return egresses;
}
const egressOptions = egress => (egress?.agent ? { httpAgent: egress.agent, httpsAgent: egress.agent, proxy: false } : {});

function redisReady() {
  return redis && redis.status === 'ready';
}

async function redisGet(key) {
  if (!redisReady()) return null;
  try {
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  } catch { return null; }
}

async function redisSet(key, value, ttl) {
  if (!redisReady()) return;
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttl);
  } catch { /* ignore */ }
}

const transientKey = key => `tmdb:transient:${key}`;

// Relecture dans la tâche partagée : valeur, marqueur d'échec et, si demandé,
// marqueur d'absence (404) en un seul aller-retour.
async function redisGetWithMarker(key, missingKey = null) {
  if (!redisReady()) return { cached: null, transient: false, missing: false };
  try {
    const keys = missingKey ? [key, transientKey(key), missingKey] : [key, transientKey(key)];
    const [data, marker, missing] = await redis.mget(...keys);
    return { cached: data ? JSON.parse(data) : null, transient: Boolean(marker), missing: Boolean(missing) };
  } catch { return { cached: null, transient: false, missing: false }; }
}

async function markTmdbTransient(key) {
  if (!redisReady()) return;
  try {
    await redis.set(transientKey(key), '1', 'PX', TRANSIENT_MARKER_MS);
  } catch { /* ignore */ }
}

async function markTmdbMissing(missingKey) {
  if (!redisReady()) return;
  try {
    await redis.set(missingKey, '1', 'EX', withJitter(TTL_MISSING, 0.1));
  } catch { /* ignore */ }
}

const detailsMissingKey = (type, id) => `tmdb:missing:details:${type}:${id}`;

/**
 * Vrai seulement si TMDB a répondu 404 sur ces détails (marqueur posé par
 * fetchTmdbDetails). En strict, null couvre aussi un refus 401/403 (clé API) :
 * l'appelant qui grave un « absent » doit d'abord le vérifier ici. Redis
 * indisponible : faux, donc jamais d'absent gravé par défaut.
 */
async function isTmdbDetailsMissing(type, id) {
  if (!redisReady()) return false;
  try { return Boolean(await redis.exists(detailsMissingKey(type, id))); }
  catch { return false; }
}

const withJitter = (ttl, ratio) => Math.max(1, Math.round(ttl * (1 + (Math.random() * 2 - 1) * ratio)));
const jittered = (ttl, ratio = 0.1) => () => withJitter(ttl, ratio);

// Un titre sorti depuis plus de 90 jours et qui ne diffuse plus change rarement.
function detailsTtl(data) {
  const dates = [data?.release_date, data?.first_air_date, data?.last_air_date]
    .map(date => Date.parse(date)).filter(Number.isFinite);
  const settled = dates.length > 0 && Date.now() - Math.max(...dates) > SETTLED_AFTER_MS
    && !data.in_production && !data.next_episode_to_air;
  return withJitter(settled ? TTL_DETAILS_SETTLED : TTL_DETAILS, 0.1);
}

function gateRate(gate, now) {
  // Horloge reculée (NTP, reprise de VM) : décaler l'état d'autant, sinon la porte
  // refuserait tout appel TMDB pendant toute la durée du recul.
  if (now < gate.at) {
    const back = gate.at - now;
    gate.tat -= back; gate.pausedUntil -= back; gate.loweredAt -= back;
  }
  if (gate.rate < RATE_MAX) gate.rate = Math.min(RATE_MAX, gate.rate + RATE_RECOVERY * Math.max(0, now - gate.at) / 1000);
  gate.at = now;
  return gate.rate;
}

const slotTime = (gate, now) => {
  const interval = 1000 / gateRate(gate, now);
  return { interval, sendAt: Math.max(now, gate.tat - (BURST - 1) * interval, gate.pausedUntil) };
};

/**
 * Réserve un créneau (GCRA) sur la sortie qui part le plus tôt (la directe à égalité).
 * Renvoie { egress, waitMs }, ou null si l'attente dépasse 1,5 s partout.
 */
function reserveTmdbSlot(now, deadline, exclude = null) {
  let best = null;
  for (const egress of tmdbEgresses()) {
    if (egress === exclude || egress.downUntil > now) continue;
    const slot = slotTime(egress.gate, now);
    if (slot.sendAt <= deadline && (!best || slot.sendAt < best.sendAt)) best = { egress, ...slot };
  }
  if (!best) return null;
  const { gate } = best.egress;
  gate.tat = Math.max(gate.tat, best.sendAt) + best.interval;
  return { egress: best.egress, waitMs: best.sendAt - now };
}

async function waitForTmdbSlot(slot, deadline) {
  while (slot && slot.waitMs > 0) {
    await new Promise(resolve => setTimeout(resolve, slot.waitMs));
    const now = Date.now();
    // Un Retry-After reçu pendant l'attente repousse le départ.
    if (now >= slot.egress.gate.pausedUntil) return slot;
    slot = reserveTmdbSlot(now, deadline);
  }
  return slot;
}

function retryAfterMs(headers, now) {
  const value = headers?.get?.('retry-after') ?? headers?.['retry-after'];
  if (value == null || String(value).trim() === '') return 0;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return ms > 0 ? Math.min(ms, RETRY_AFTER_MAX_MS) : 0;
}

// Sur un 429 : débit local −20 % (plancher 3/s, une baisse par seconde au plus),
// et pause complète jusqu'au Retry-After annoncé (10 s au plus).
function slowDownTmdbGate(gate, headers) {
  const now = Date.now();
  gateRate(gate, now);
  if (now - gate.loweredAt >= 1000) {
    gate.rate = Math.max(RATE_MIN, gate.rate * 0.8);
    gate.loweredAt = now;
  }
  const pauseMs = retryAfterMs(headers, now);
  if (pauseMs > 0) {
    gate.pausedUntil = Math.max(gate.pausedUntil, now + pauseMs);
    // Pas de rafale à la reprise : un créneau à la fois.
    gate.tat = Math.max(gate.tat, gate.pausedUntil + (BURST - 1) * 1000 / gate.rate);
  }
}

// null : absent (404) ou refus définitif ; sinon échec temporaire.
function classifyTmdbError(error) {
  const status = Number(error?.response?.status) || 0;
  if (status === 429) return { reason: 'rate_limited', status, shared: true };
  if (status >= 500) return { reason: 'upstream', status, shared: true };
  if (status) return null;
  const timeout = ['ECONNABORTED', 'ETIMEDOUT'].includes(error?.code) || /timeout/i.test(error?.message || '');
  return { reason: timeout ? 'timeout' : 'network', status: 0, shared: timeout };
}

function tmdbTransientError({ reason, status }) {
  return Object.assign(new Error(`TMDB temporairement indisponible (${reason})`), {
    code: 'TMDB_TRANSIENT', transient: true, reason, ...(status ? { status } : {}),
  });
}

/** Attend un travail partagé sans transmettre l'annulation d'un appelant au transport. */
function waitForCaller(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const onAbort = () => resolve(null);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/**
 * Partage le miss Redis dans le worker puis revalide le cache avant l'appel amont.
 * La promesse commune ne reçoit jamais le signal HTTP d'un appelant individuel ;
 * elle ne rejette pas et renvoie { data, failure }.
 * `missingKey` (facultatif) retient un 404 pendant TTL_MISSING : ni appel ni échec.
 */
function getOrFetch(redisKey, ttl, request, { missingKey = null } = {}) {
  return runTmdbRequest(redisKey, async (egress) => {
    const { cached, transient, missing } = await redisGetWithMarker(redisKey, missingKey);
    if (cached) return { data: cached, failure: null };
    // TMDB a déjà répondu 404 pour cet ID : absent, sans nouvel appel réseau.
    if (missing) return { data: null, failure: null };
    // Un autre worker vient d'avoir un 429, un 5xx ou un délai dépassé sur cette clé.
    if (transient) return { data: null, failure: { reason: 'marker' } };
    const now = Date.now(), deadline = now + GATE_MAX_WAIT_MS;
    let slot = await waitForTmdbSlot(reserveTmdbSlot(now, deadline), deadline);
    if (!slot) return { data: null, failure: { reason: 'gate' } };
    for (let attempt = 0; ; attempt++) {
      try {
        const data = await request(slot.egress);
        if (data) await redisSet(redisKey, data, ttl(data));
        return { data: data || null, failure: null };
      } catch (error) {
        const failure = classifyTmdbError(error);
        if (!failure) {
          // Seul un 404 est retenu : un 401/403 (clé API) reste redemandé.
          if (missingKey && Number(error?.response?.status) === 404) await markTmdbMissing(missingKey);
          return { data: null, failure: null };
        }
        if (failure.status === 429) slowDownTmdbGate(slot.egress.gate, error.response?.headers);
        // Proxy injoignable : écarté 60 s, la sortie directe reste toujours là.
        if (!failure.status && slot.egress.agent) slot.egress.downUntil = Date.now() + PROXY_DOWN_MS;
        // 429 (limite par IP) ou panne réseau : un seul nouvel essai, sur une
        // autre sortie, dans la même attente de 1,5 s. Un 5xx vient de TMDB lui-même.
        const retry = attempt === 0 && (failure.status === 429 || !failure.status)
          ? await waitForTmdbSlot(reserveTmdbSlot(Date.now(), deadline, slot.egress), deadline) : null;
        if (retry) { slot = retry; continue; }
        if (failure.shared) await markTmdbTransient(redisKey);
        return { data: null, failure };
      }
    }
  });
}

/** Sans strict, tout échec vaut null ; en strict, l'échec temporaire est levé. */
function fetchCached(redisKey, ttl, request, strict, options) {
  return getOrFetch(redisKey, ttl, request, options).then(({ data, failure }) => {
    if (strict && failure) throw tmdbTransientError(failure);
    return data;
  });
}

// Les titres alternatifs joints aux détails (un seul appel TMDB) rejoignent leur
// propre clé ; tmdb:details garde son format, lu tel quel par wrappedRoutes (MGET).
async function storeAppendedAlternativeTitles(data, type, id) {
  if (!data || typeof data !== 'object' || !('alternative_titles' in data)) return data;
  const { alternative_titles: alternatives, ...details } = data;
  if (alternatives && typeof alternatives === 'object') {
    // Même forme que l'endpoint dédié : { id, titles } (film) ou { id, results } (série).
    await redisSet(`tmdb:alternative_titles:${type}:${id}`, { id: data.id, ...alternatives }, withJitter(TTL_STABLE, 0.15));
  }
  return details;
}

/**
 * Récupère les détails TMDB pour un ID donné, avec cache Redis.
 * Clé : tmdb:details:{type}:{id}
 *
 * @param {string} tmdbApiUrl - Ex: "https://api.themoviedb.org/3"
 * @param {string} tmdbApiKey - Clé API TMDB
 * @param {string|number} id  - ID TMDB
 * @param {string} type       - "movie" ou "tv"
 * @param {string} [language] - Langue (défaut: "fr-FR")
 * @param {{ signal?: AbortSignal, strict?: boolean }} [options]
 * @returns {object|null}
 */
async function fetchTmdbDetails(tmdbApiUrl, tmdbApiKey, id, type, language = 'fr-FR', { signal, strict = false } = {}) {
  if (signal?.aborted) return null;
  const redisKey = `tmdb:details:${type}:${id}:${language}`;

  // 1. Cache Redis
  const cached = await redisGet(redisKey);
  if (cached) return cached;
  if (signal?.aborted) return null;

  const withAlternatives = type === 'movie' || type === 'tv';
  const work = fetchCached(redisKey, detailsTtl, async (egress) => {
    try {
      const response = await axios.get(`${tmdbApiUrl}/${type}/${id}`, {
        params: { api_key: tmdbApiKey, language, ...(withAlternatives ? { append_to_response: 'alternative_titles' } : {}) },
        timeout: 10000, ...egressOptions(egress),
      });
      return withAlternatives ? storeAppendedAlternativeTitles(response.data, type, id) : response.data;
    } catch (error) {
      refreshStep('tmdb_http_error', { id, type, language }, error);
      throw error;
    }
  }, strict, { missingKey: detailsMissingKey(type, id) });
  return waitForCaller(work, signal);
}

/**
 * Recherche TMDB avec cache Redis.
 * Clé : tmdb:search:{type}:{query}:{year}:{language}
 *
 * @param {string} tmdbApiUrl
 * @param {string} tmdbApiKey
 * @param {string} type       - "movie" ou "tv"
 * @param {string} query      - Terme de recherche
 * @param {object} [extraParams] - Params additionnels (first_air_date_year, year, etc.)
 * @param {string} [language]
 * @param {{ strict?: boolean }} [options]
 * @returns {object|null} - response.data complet (avec .results)
 */
async function searchTmdb(tmdbApiUrl, tmdbApiKey, type, query, extraParams = {}, language = 'fr-FR', { strict = false } = {}) {
  const paramsSuffix = Object.entries(extraParams).sort().map(([k, v]) => `${k}=${v}`).join('&');
  const redisKey = `tmdb:search:${type}:${query}:${paramsSuffix}:${language}`;

  const cached = await redisGet(redisKey);
  if (cached) return cached;

  return fetchCached(redisKey, jittered(TTL_SEARCH), async (egress) => {
    const response = await axios.get(`${tmdbApiUrl}/search/${type}`, {
      params: { api_key: tmdbApiKey, query, language, ...extraParams },
      timeout: 10000, ...egressOptions(egress)
    });

    return response.data;
  }, strict);
}

/**
 * Récupère les détails d'une saison TMDB avec cache Redis.
 * Clé : tmdb:season:{tvId}:{seasonNumber}:{language}
 */
async function fetchTmdbSeason(tmdbApiUrl, tmdbApiKey, tvId, seasonNumber, language = 'fr-FR', { strict = false } = {}) {
  const redisKey = `tmdb:season:${tvId}:${seasonNumber}:${language}`;

  const cached = await redisGet(redisKey);
  if (cached) return cached;

  return fetchCached(redisKey, jittered(TTL_DETAILS), async (egress) => {
    const response = await axios.get(`${tmdbApiUrl}/tv/${tvId}/season/${seasonNumber}`, {
      params: { api_key: tmdbApiKey, language },
      timeout: 10000, ...egressOptions(egress)
    });

    return response.data;
  }, strict);
}

/**
 * Récupère les titres alternatifs d'un média TMDB (aussi écrits par fetchTmdbDetails).
 * Clé : tmdb:alternative_titles:{mediaType}:{id}
 */
async function fetchTmdbAlternativeTitles(tmdbApiUrl, tmdbApiKey, id, mediaType = 'tv', { strict = false } = {}) {
  if (!['tv', 'movie'].includes(mediaType)) throw new TypeError('type media TMDB invalide');
  const redisKey = `tmdb:alternative_titles:${mediaType}:${id}`;
  const cached = await redisGet(redisKey);
  if (cached) return cached;

  return fetchCached(redisKey, jittered(TTL_STABLE, 0.15), async (egress) => {
    const response = await axios.get(`${tmdbApiUrl}/${mediaType}/${id}/alternative_titles`, {
      params: { api_key: tmdbApiKey },
      timeout: 10000, ...egressOptions(egress)
    });
    return response.data;
  }, strict);
}

/**
 * Récupère l'année de sortie française d'un film via /movie/{id}/release_dates.
 * Clé : tmdb:release_dates:movie:{id}
 */
async function fetchTmdbFrenchReleaseYear(tmdbApiUrl, tmdbApiKey, id, { strict = false } = {}) {
  const redisKey = `tmdb:release_dates:movie:${id}`;

  const cached = await redisGet(redisKey);
  if (cached) {
    const frRelease = cached.results ? cached.results.find(r => r.iso_3166_1 === 'FR') : null;
    if (frRelease && frRelease.release_dates && frRelease.release_dates.length > 0) {
      const date = frRelease.release_dates[0].release_date;
      if (date) return new Date(date).getFullYear();
    }
    return null;
  }

  const data = await fetchCached(redisKey, jittered(TTL_STABLE, 0.15), async (egress) => {
    const response = await axios.get(`${tmdbApiUrl}/movie/${id}/release_dates`, {
      params: { api_key: tmdbApiKey },
      timeout: 10000, ...egressOptions(egress)
    });

    return response.data;
  }, strict);
  const frRelease = data?.results?.find(r => r.iso_3166_1 === 'FR');
  if (frRelease && frRelease.release_dates && frRelease.release_dates.length > 0) {
    const date = frRelease.release_dates[0].release_date;
    if (date) return new Date(date).getFullYear();
  }
  return null;
}

/**
 * Récupère toutes les images TMDB (posters + backdrops, toutes langues).
 * Clé : tmdb:images:{type}:{id}
 */
async function fetchTmdbImages(tmdbApiUrl, tmdbApiKey, id, type, { strict = false } = {}) {
  const redisKey = `tmdb:images:${type}:${id}`;

  const cached = await redisGet(redisKey);
  if (cached) return cached;

  return fetchCached(redisKey, jittered(TTL_DETAILS), async (egress) => {
    const response = await axios.get(`${tmdbApiUrl}/${type}/${id}/images`, {
      params: { api_key: tmdbApiKey },
      timeout: 10000, ...egressOptions(egress)
    });

    return response.data;
  }, strict);
}

/**
 * Liste « discover » TMDB avec cache Redis.
 * Clé : tmdb:discover:{type}:{params triés}:{language}
 * @returns {object|null} - response.data complet (avec .results)
 */
async function fetchTmdbDiscover(tmdbApiUrl, tmdbApiKey, type, params = {}, language = 'fr-FR', { strict = false } = {}) {
  if (!['tv', 'movie'].includes(type)) throw new TypeError('type media TMDB invalide');
  const paramsSuffix = Object.entries(params).sort().map(([k, v]) => `${k}=${v}`).join('&');
  const redisKey = `tmdb:discover:${type}:${paramsSuffix}:${language}`;

  const cached = await redisGet(redisKey);
  if (cached) return cached;

  return fetchCached(redisKey, jittered(TTL_DISCOVER), async (egress) => {
    const response = await axios.get(`${tmdbApiUrl}/discover/${type}`, {
      params: { api_key: tmdbApiKey, language, ...params },
      timeout: 10000, ...egressOptions(egress)
    });
    return response.data;
  }, strict);
}

/**
 * Classifications d'âge d'une série, par pays (/tv/{id}/content_ratings).
 * Une classification peut arriver après la sortie : gardée 7 jours, pas 30.
 * Clé : tmdb:content_ratings:tv:{id}
 */
async function fetchTmdbContentRatings(tmdbApiUrl, tmdbApiKey, id, { strict = false } = {}) {
  const redisKey = `tmdb:content_ratings:tv:${id}`;

  const cached = await redisGet(redisKey);
  if (cached) return cached;

  return fetchCached(redisKey, jittered(TTL_DETAILS_SETTLED), async (egress) => {
    const response = await axios.get(`${tmdbApiUrl}/tv/${id}/content_ratings`, {
      params: { api_key: tmdbApiKey },
      timeout: 10000, ...egressOptions(egress)
    });
    return response.data;
  }, strict);
}

async function fetchTmdbCredits(tmdbApiUrl, tmdbApiKey, id, type, { strict = false } = {}) {
  const endpoint = type === 'tv' ? 'aggregate_credits' : 'credits';
  return fetchCached(`tmdb:${endpoint}:${type}:${id}`, jittered(TTL_STABLE, 0.15), async (egress) => {
    const response = await axios.get(`${tmdbApiUrl}/${type}/${id}/${endpoint}`, {
      params: { api_key: tmdbApiKey, language: 'fr-FR' }, timeout: 10000, ...egressOptions(egress),
    });
    return response.data;
  }, strict);
}

module.exports = {
  fetchTmdbDetails,
  searchTmdb,
  fetchTmdbSeason,
  fetchTmdbAlternativeTitles,
  fetchTmdbFrenchReleaseYear,
  fetchTmdbImages,
  fetchTmdbCredits,
  fetchTmdbDiscover,
  fetchTmdbContentRatings,
  TTL_DETAILS,
  TTL_DETAILS_SETTLED,
  TTL_SEARCH,
  TTL_STABLE,
  TTL_MISSING,
  isTmdbDetailsMissing
};
