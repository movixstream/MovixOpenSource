/**
 * Cache Redis centralisé pour les appels TMDB API.
 * Partagé entre tous les workers du cluster — évite les appels TMDB redondants.
 *
 * Pattern identique à wrappedRoutes.js : redisReady() + get/set avec TTL.
 * Préfixe Redis : "tmdb:"
 */

const axios = require('axios');
const { redis } = require('../config/redis');
const { createSingleFlight } = require('./singleFlight');
const { refreshStep } = require('./sourceRefreshTelemetry');

// TTL par type de requête
const TTL_DETAILS = 24 * 60 * 60;  // 24h — les détails d'un film/série changent rarement
const TTL_SEARCH  = 12 * 60 * 60;  // 12h — les résultats de recherche peuvent évoluer
const runTmdbRequest = createSingleFlight();

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

/** Attend un travail partagé sans transmettre l'annulation d'un appelant au transport. */
function waitForCaller(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.resolve(null);

  return new Promise((resolve) => {
    const onAbort = () => resolve(null);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, () => resolve(null)).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/**
 * Partage le miss Redis dans le worker puis revalide le cache avant l'appel amont.
 * La promesse commune ne reçoit jamais le signal HTTP d'un appelant individuel.
 */
function getOrFetch(redisKey, ttl, request) {
  return runTmdbRequest(redisKey, async () => {
    const cached = await redisGet(redisKey);
    if (cached) return cached;
    try {
      const data = await request();
      if (data) await redisSet(redisKey, data, ttl);
      return data || null;
    } catch {
      return null;
    }
  });
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
 * @returns {object|null}
 */
async function fetchTmdbDetails(tmdbApiUrl, tmdbApiKey, id, type, language = 'fr-FR', { signal } = {}) {
  if (signal?.aborted) return null;
  const redisKey = `tmdb:details:${type}:${id}:${language}`;

  // 1. Cache Redis
  const cached = await redisGet(redisKey);
  if (cached) return cached;
  if (signal?.aborted) return null;

  const work = getOrFetch(redisKey, TTL_DETAILS, async () => {
    try {
      const response = await axios.get(`${tmdbApiUrl}/${type}/${id}`, {
        params: { api_key: tmdbApiKey, language },
        timeout: 10000,
      });
      return response.data;
    } catch (error) {
      refreshStep('tmdb_http_error', { id, type, language }, error);
      throw error;
    }
  });
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
 * @returns {object|null} - response.data complet (avec .results)
 */
async function searchTmdb(tmdbApiUrl, tmdbApiKey, type, query, extraParams = {}, language = 'fr-FR') {
  const paramsSuffix = Object.entries(extraParams).sort().map(([k, v]) => `${k}=${v}`).join('&');
  const redisKey = `tmdb:search:${type}:${query}:${paramsSuffix}:${language}`;

  const cached = await redisGet(redisKey);
  if (cached) return cached;

  return getOrFetch(redisKey, TTL_SEARCH, async () => {
    const response = await axios.get(`${tmdbApiUrl}/search/${type}`, {
      params: { api_key: tmdbApiKey, query, language, ...extraParams },
      timeout: 10000
    });

    return response.data;
  });
}

/**
 * Récupère les détails d'une saison TMDB avec cache Redis.
 * Clé : tmdb:season:{tvId}:{seasonNumber}:{language}
 */
async function fetchTmdbSeason(tmdbApiUrl, tmdbApiKey, tvId, seasonNumber, language = 'fr-FR') {
  const redisKey = `tmdb:season:${tvId}:${seasonNumber}:${language}`;

  const cached = await redisGet(redisKey);
  if (cached) return cached;

  return getOrFetch(redisKey, TTL_DETAILS, async () => {
    const response = await axios.get(`${tmdbApiUrl}/tv/${tvId}/season/${seasonNumber}`, {
      params: { api_key: tmdbApiKey, language },
      timeout: 10000
    });

    return response.data;
  });
}

/**
 * Recupere les titres alternatifs d'un media TMDB avec le TTL des details.
 * Cle : tmdb:alternative_titles:{mediaType}:{id}
 */
async function fetchTmdbAlternativeTitles(tmdbApiUrl, tmdbApiKey, id, mediaType = 'tv') {
  if (!['tv', 'movie'].includes(mediaType)) throw new TypeError('type media TMDB invalide');
  const redisKey = `tmdb:alternative_titles:${mediaType}:${id}`;
  const cached = await redisGet(redisKey);
  if (cached) return cached;

  return getOrFetch(redisKey, TTL_DETAILS, async () => {
    const response = await axios.get(`${tmdbApiUrl}/${mediaType}/${id}/alternative_titles`, {
      params: { api_key: tmdbApiKey },
      timeout: 10000
    });
    return response.data;
  });
}

/**
 * Récupère l'année de sortie française d'un film via /movie/{id}/release_dates.
 * Clé : tmdb:release_dates:movie:{id}
 */
async function fetchTmdbFrenchReleaseYear(tmdbApiUrl, tmdbApiKey, id) {
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

  const data = await getOrFetch(redisKey, TTL_DETAILS, async () => {
    const response = await axios.get(`${tmdbApiUrl}/movie/${id}/release_dates`, {
      params: { api_key: tmdbApiKey },
      timeout: 10000
    });

    return response.data;
  });
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
async function fetchTmdbImages(tmdbApiUrl, tmdbApiKey, id, type) {
  const redisKey = `tmdb:images:${type}:${id}`;

  const cached = await redisGet(redisKey);
  if (cached) return cached;

  return getOrFetch(redisKey, TTL_DETAILS, async () => {
    const response = await axios.get(`${tmdbApiUrl}/${type}/${id}/images`, {
      params: { api_key: tmdbApiKey },
      timeout: 10000
    });

    return response.data;
  });
}

async function fetchTmdbCredits(tmdbApiUrl, tmdbApiKey, id, type) {
  const endpoint = type === 'tv' ? 'aggregate_credits' : 'credits';
  return getOrFetch(`tmdb:${endpoint}:${type}:${id}`, TTL_DETAILS, async () => {
    const response = await axios.get(`${tmdbApiUrl}/${type}/${id}/${endpoint}`, {
      params: { api_key: tmdbApiKey, language: 'fr-FR' }, timeout: 10000,
    });
    return response.data;
  });
}

module.exports = {
  fetchTmdbDetails,
  searchTmdb,
  fetchTmdbSeason,
  fetchTmdbAlternativeTitles,
  fetchTmdbFrenchReleaseYear,
  fetchTmdbImages,
  fetchTmdbCredits,
  TTL_DETAILS,
  TTL_SEARCH
};
