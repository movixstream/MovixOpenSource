/**
 * PurStream routes module.
 * Proxy vers l'API PurStream pour récupérer les streams de films et séries.
 * Résolution TMDB → PurStream ID via recherche par titre + poster.
 * Cache fichier L2 + memoryCache L1 (pattern identique aux autres routes).
 * Pattern stale-while-revalidate : on sert le cache, on update en background.
 *
 * Mounted at /api/purstream
 */

const express = require('express');
const axios = require('axios');
const router = express.Router();
const { generateCacheKey, CACHE_DIR } = require('../utils/cacheManager');
const { fetchTmdbDetails, fetchTmdbImages } = require('../utils/tmdbCache');
const { pickRandomProxy, getProxyAgent } = require('../utils/proxyManager');
const { buildSignedProxyUrl, signingConfigured } = require('../utils/mediaSigning');
const { createWiflixRefreshState } = require('../utils/wiflixRefreshState');
const { reportRefreshFailure } = require('../utils/sourceRefreshTelemetry');
const { redis } = require('../config/redis');

// Repli statique si `/api/status` est injoignable. `api.purstream.cc` est mort
// (404) : le repli ne servait plus qu'à masquer la panne.
const PURSTREAM_BASE = 'https://api.purstream.id/api/v1';
const PURSTREAM_STATUS_URL = 'https://purstream.wiki/api/status';
const PURSTREAM_CACHE_DIR = CACHE_DIR.PURSTREAM;
const PURSTREAM_STATUS_TTL_MS = 5 * 60 * 1000;
const PURSTREAM_CACHE_REFRESH_MS = 6 * 60 * 60 * 1000;
const refreshState = createWiflixRefreshState({ successRefreshMs: PURSTREAM_CACHE_REFRESH_MS,
  isNegative: data => Boolean(data?.__not_found) });

// ---------------------------------------------------------------------------
// Dependencies injected via configure()
// ---------------------------------------------------------------------------
let TMDB_API_KEY;
let TMDB_API_URL;
let PROXY_SERVER_URL;
let verifyAccessKey;
let getFromCacheNoExpiration;
let saveToCache;

let purstreamApiBase = PURSTREAM_BASE;
let purstreamApiBaseCheckedAt = 0;
let purstreamApiBaseLoading = null;

function configure(deps) {
  if (deps.TMDB_API_KEY) TMDB_API_KEY = deps.TMDB_API_KEY;
  if (deps.TMDB_API_URL) TMDB_API_URL = deps.TMDB_API_URL;
  if (deps.PROXY_SERVER_URL) PROXY_SERVER_URL = deps.PROXY_SERVER_URL;
  if (deps.verifyAccessKey) verifyAccessKey = deps.verifyAccessKey;
  if (deps.getFromCacheNoExpiration) getFromCacheNoExpiration = deps.getFromCacheNoExpiration;
  if (deps.saveToCache) saveToCache = deps.saveToCache;
}

/** Appel interne PurStream status endpoint */
async function purstreamStatusRequest() {
  return axios({
    url: PURSTREAM_STATUS_URL,
    method: 'get',
    timeout: 10000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
      'Accept': 'application/json'
    }
  });
}

function normalizePurstreamDomain(domain) {
  const trimmed = domain.trim();
  const withoutProtocol = trimmed.replace(/^https?:\/\//i, '').replace(/\/+$/, '');

  // `/api/status` renvoie le domaine nu du service (« purstream.id »), pas
  // l'hôte de son API — celle-ci vit sur le sous-domaine `api.`. Servi tel
  // quel, `https://purstream.id/api/v1/...` répond 200 avec le HTML du site :
  // axios ne lève rien, `data.type` reste undefined, et toute recherche paraît
  // sans résultat avant de se figer en négatif caché. On préfixe donc, sauf si
  // le statut a déjà donné un hôte `api.`.
  const host = withoutProtocol.split('/')[0];
  const path = withoutProtocol.slice(host.length);
  const apiHost = /^api\./i.test(host) ? host : `api.${host}`;

  return `https://${apiHost}${path}/api/v1`;
}

async function resolvePurstreamApiBase(force = false) {
  const now = Date.now();
  if (!force && purstreamApiBase && now - purstreamApiBaseCheckedAt < PURSTREAM_STATUS_TTL_MS) {
    return purstreamApiBase;
  }

  if (purstreamApiBaseLoading) {
    await purstreamApiBaseLoading;
    return purstreamApiBase;
  }

  purstreamApiBaseLoading = (async () => {
    try {
      const response = await purstreamStatusRequest();
      const domain = typeof response?.data?.domain === 'string' ? response.data.domain.trim() : '';
      if (domain) {
        purstreamApiBase = normalizePurstreamDomain(domain);
      } else {
        console.warn('[PURSTREAM] Réponse status invalide: domaine manquant, fallback base statique');
        purstreamApiBase = PURSTREAM_BASE;
      }
    } catch (err) {
      purstreamApiBase = purstreamApiBase || PURSTREAM_BASE;
      console.warn('[PURSTREAM] Impossible de récupérer le statut pour la résolution d\'API, fallback:', err.message);
    } finally {
      purstreamApiBaseCheckedAt = Date.now();
      purstreamApiBaseLoading = null;
    }
  })();

  await purstreamApiBaseLoading;
  return purstreamApiBase;
}

/** Wrap une URL m3u8 dans le proxy cinep si VIP et PROXY_SERVER_URL configuré */
function wrapSourceUrl(url, isVip) {
  if (isVip && PROXY_SERVER_URL && url) {
    // PROXY_SERVER_URL pointe sur proxiesembed (.../proxy) → on veut la base sans /proxy
    const serverBase = PROXY_SERVER_URL.replace(/\/proxy\/?$/, '').replace(/\/+$/, '');
    // /cinep-proxy n'accepte plus qu'une URL signée : sans signature le player
    // recevrait un 403 à la lecture.
    if (!signingConfigured()) {
      console.error('[PURSTREAM] MEDIA_SIGNING_SECRET absent — URL non proxifiable');
      return url;
    }
    return buildSignedProxyUrl(serverBase, '/cinep-proxy', url);
  }
  return url;
}

/** Fait une requête vers PurStream avec un proxy SOCKS5 aléatoire */
async function purstreamRequest(urlPath) {
  const proxy = pickRandomProxy();
  const agent = proxy ? getProxyAgent(proxy) : null;
  const apiBase = await resolvePurstreamApiBase();

  return axios({
    url: `${apiBase}${urlPath}`,
    method: 'get',
    timeout: 10000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
      'Accept': 'application/json'
    },
    ...(agent ? { httpAgent: agent, httpsAgent: agent, proxy: false } : {}),
    decompress: true
  });
}

// Marqueur pour les résultats négatifs cachés
const NOT_FOUND_MARKER = { __not_found: true };
const ongoingCacheUpdates = new Map();

// Partager les actualisations simultanées d'une même entrée dans ce worker.
function refreshCache(cacheKey, update) {
  if (ongoingCacheUpdates.has(cacheKey)) return ongoingCacheUpdates.get(cacheKey);

  const promise = Promise.resolve().then(update).finally(() => {
    ongoingCacheUpdates.delete(cacheKey);
  });
  ongoingCacheUpdates.set(cacheKey, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// Résolution TMDB ID → PurStream ID
// ---------------------------------------------------------------------------
async function resolvePurstreamId(tmdbId, type, { waitForRefresh = false, forceRefresh = false } = {}) {
  const cacheKey = generateCacheKey(`purstream_map_${type}_${tmdbId}`);

  const cached = await getFromCacheNoExpiration(PURSTREAM_CACHE_DIR, cacheKey);

  if (forceRefresh) {
    // Plusieurs épisodes absents ne doivent pas relancer la même recherche en boucle.
    const checkKey = `${cacheKey}.revalidation`;
    if (await refreshState.remaining(PURSTREAM_CACHE_DIR, checkKey, null) > 0) {
      return cached?.purstream_id ? cached : null;
    }
    await refreshState.defer(PURSTREAM_CACHE_DIR, checkKey);
  }

  if (cached && !forceRefresh) {
    const stale = await refreshState.remaining(PURSTREAM_CACHE_DIR, cacheKey, cached) <= 0;
    if (cached.__not_found) {
      if (stale) {
        const refresh = refreshCache(cacheKey, () => backgroundUpdateMapping(tmdbId, type, cacheKey));
        if (waitForRefresh) return await refresh;
        refresh.catch(() => {});
      }
      return null;
    }
    if (stale) {
      const refresh = refreshCache(cacheKey, () => backgroundUpdateMapping(tmdbId, type, cacheKey));
      if (waitForRefresh) return await refresh;
      refresh.catch(() => {});
    }
    return cached;
  }

  if (!forceRefresh && await refreshState.remaining(PURSTREAM_CACHE_DIR, cacheKey, null) > 0) return null;
  return await refreshCache(cacheKey, () => backgroundUpdateMapping(tmdbId, type, cacheKey));
}

/** Recherche et cache le mapping TMDB → PurStream */
async function fetchAndCacheMapping(tmdbId, type, cacheKey) {
  const tmdbData = await fetchTmdbDetails(TMDB_API_URL, TMDB_API_KEY, tmdbId, type, 'fr-FR');
  if (!tmdbData) {
    throw new Error(`Métadonnées TMDB indisponibles pour ${type}:${tmdbId}`);
  }

  const tmdbTitle = type === 'movie' ? tmdbData.title : tmdbData.name;
  const tmdbOriginalTitle = type === 'movie' ? tmdbData.original_title : tmdbData.original_name;
  if (!tmdbTitle) {
    console.warn(`[PURSTREAM] TMDB ${type}:${tmdbId} n'a pas de titre`);
    await saveMapping(cacheKey, NOT_FOUND_MARKER);
    return null;
  }

  // Collecter TOUS les posters TMDB (toutes langues, cache Redis intégré)
  const tmdbPosters = new Set();
  if (tmdbData.poster_path) tmdbPosters.add(tmdbData.poster_path);
  if (tmdbData.backdrop_path) tmdbPosters.add(tmdbData.backdrop_path);
  const imagesData = await fetchTmdbImages(TMDB_API_URL, TMDB_API_KEY, tmdbId, type);
  if (imagesData?.posters) {
    for (const p of imagesData.posters) {
      if (p.file_path) tmdbPosters.add(p.file_path);
    }
  }
  if (imagesData?.backdrops) {
    for (const b of imagesData.backdrops) {
      if (b.file_path) tmdbPosters.add(b.file_path);
    }
  }

  // Chercher sur PurStream (titre FR puis titre original si différent)
  const searchQueries = [tmdbTitle];
  if (tmdbOriginalTitle && tmdbOriginalTitle !== tmdbTitle) {
    searchQueries.push(tmdbOriginalTitle);
  }
  // Le serveur amont rejette le slash même encodé (%2F) dans ce segment.
  const queries = [...new Set(searchQueries.map(query => query.replace(/[\\/]+/g, ' ').replace(/\s+/g, ' ').trim()))];

  let allItems = [];
  let searchError = false;
  for (const query of queries) {
    try {
      const response = await purstreamRequest(`/search-bar/search/${encodeURIComponent(query)}`);
      if (response.data?.type === 'success') {
        const items = response.data.data?.items?.movies?.items || [];
        for (const item of items) {
          if (!allItems.some(existing => existing.id === item.id)) {
            allItems.push(item);
          }
        }
      } else {
        // Un 200 qui n'est pas la réponse attendue (page HTML servie par le
        // site quand la base d'API est mal résolue, page d'erreur d'un CDN…)
        // n'est PAS une absence de résultat : le compter comme tel graverait
        // un négatif en cache pour un titre qui existe.
        searchError = true;
        console.warn(
          `[PURSTREAM] Réponse inattendue pour "${query}" via ${purstreamApiBase} ` +
          `(HTTP ${response.status}, ${response.headers?.['content-type'] || 'content-type inconnu'}, ` +
          `type=${response.data?.type ?? 'absent'})`
        );
      }
    } catch (err) {
      searchError = true;
      console.warn(`[PURSTREAM] Recherche échouée pour "${query}": ${err.response?.status || err.message}`);
    }
  }

  // Erreur réseau/429/5xx → ne PAS cacher (résultat temporaire)
  if (allItems.length === 0 && searchError) {
    console.warn(
      `[PURSTREAM] Recherche indisponible pour ${type}:${tmdbId} "${tmdbTitle}" — non caché, réessai au prochain appel`
    );
    return null;
  }

  if (allItems.length === 0) {
    console.warn(
      `[PURSTREAM] Aucun résultat de recherche pour ${type}:${tmdbId} (requêtes: ${queries.join(' | ')})`
    );
    await saveMapping(cacheKey, NOT_FOUND_MARKER);
    return null;
  }

  // Extraire posters PurStream
  const extractPosterPath = (url) => {
    if (!url) return '';
    const m = url.match(/\/([^/?]+\.(?:jpg|png|webp))(?:\?.*)?$/i);
    return m ? `/${m[1]}` : '';
  };

  // Matcher strictement par type + poster TMDB
  const getPurstreamPosters = (item) => {
    const posters = new Set();
    const p1 = extractPosterPath(item.large_poster_path);
    const p2 = extractPosterPath(item.small_poster_path);
    const p3 = extractPosterPath(item.wallpaper_poster_path);
    if (p1) posters.add(p1);
    if (p2) posters.add(p2);
    if (p3) posters.add(p3);
    return posters;
  };

  const posterMatch = (item) => {
    if (tmdbPosters.size === 0) return false;
    const purPosters = getPurstreamPosters(item);
    for (const p of purPosters) {
      if (tmdbPosters.has(p)) return true;
    }
    return false;
  };

  const best = allItems.find(item => item.type === type && posterMatch(item));

  if (!best) {
    console.warn(`[PURSTREAM] Aucun match pour ${type}:${tmdbId} "${tmdbTitle}"`);
    await saveMapping(cacheKey, NOT_FOUND_MARKER);
    return null;
  }

  const result = { purstream_id: best.id, title: best.title, type: best.type };
  await saveMapping(cacheKey, result);
  return result;
}

async function saveMapping(cacheKey, result) {
  const previous = await getFromCacheNoExpiration(PURSTREAM_CACHE_DIR, cacheKey);
  if (result.__not_found && previous?.purstream_id) return;
  await saveToCache(PURSTREAM_CACHE_DIR, cacheKey, result);
}

/** Revalidation background du mapping — ne jamais écraser un mapping valide par un échec */
async function backgroundUpdateMapping(tmdbId, type, cacheKey) {
  const existing = await getFromCacheNoExpiration(PURSTREAM_CACHE_DIR, cacheKey);
  const hasValidMapping = existing && !existing.__not_found && existing.purstream_id;

  try {
    await refreshState.defer(PURSTREAM_CACHE_DIR, cacheKey);
    const result = await fetchAndCacheMapping(tmdbId, type, cacheKey);
    if (result) await refreshState.clear(PURSTREAM_CACHE_DIR, cacheKey);
    return result || (hasValidMapping ? existing : null);
  } catch (err) {
    console.warn(`[PURSTREAM] BG mapping ${type}:${tmdbId} erreur: ${err.message}`);
    reportRefreshFailure('mapping_refresh_failed', err, { source: 'PurStream', type, id: tmdbId,
      cachePresent: Boolean(existing), cacheUsable: Boolean(hasValidMapping) }, redis);
    return hasValidMapping ? existing : null;
  }
}

/** Fetch stream depuis PurStream, retourne les sources ou marqueur erreur */
async function fetchStream(purstreamId, urlPath, context = {}) {
  try {
    const response = await purstreamRequest(urlPath);
    if (response.data?.type !== 'success') return null;
    return response.data.data?.items || null;
  } catch (err) {
    if (err.response?.status !== 404) reportRefreshFailure('upstream_error', err, {
      source: 'PurStream', ...context, purstreamId, path: urlPath,
    }, redis);
    return { __error: true, status: err.response?.status || 0 };
  }
}

async function fetchMappedStream(tmdbId, type, mapping, season, episode) {
  const fetch = id => fetchStream(id, type === 'movie' ? `/stream/${id}`
    : `/stream/${id}/episode?season=${Number(season)}&episode=${Number(episode)}`,
  { id: tmdbId, type, season, episode });
  let streamData = await fetch(mapping.purstream_id);
  if (streamData?.__error && streamData.status === 404) {
    const updated = await resolvePurstreamId(tmdbId, type, { waitForRefresh: true, forceRefresh: true });
    if (updated && updated.purstream_id !== mapping.purstream_id) {
      mapping = updated;
      streamData = await fetch(mapping.purstream_id);
    }
  }
  if (streamData?.__error && streamData.status === 404) reportRefreshFailure('stream_not_found',
    { message: 'Stream absent après revalidation du mapping', response: { status: 404 } },
    { source: 'PurStream', id: tmdbId, type, season, episode, purstreamId: mapping.purstream_id }, redis);
  return { mapping, streamData };
}

// ---------------------------------------------------------------------------
// GET /api/purstream/movie/:tmdbId/stream
// ---------------------------------------------------------------------------
router.get('/movie/:tmdbId/stream', async (req, res) => {
  try {
    const { tmdbId } = req.params;
    if (!tmdbId || isNaN(tmdbId)) return res.status(400).json({ error: 'TMDB ID invalide' });

    // Vérifier VIP pour proxifier les URLs
    const accessKey = req.headers['x-access-key'] || null;
    const vipStatus = verifyAccessKey ? await verifyAccessKey(accessKey) : { vip: false };
    const isVip = vipStatus.vip;

    const cacheKey = generateCacheKey(`purstream_stream_movie_${tmdbId}`);
    const cached = await getFromCacheNoExpiration(PURSTREAM_CACHE_DIR, cacheKey);

    if (cached) {
      const stale = await refreshState.remaining(PURSTREAM_CACHE_DIR, cacheKey, cached) <= 0;
      if (stale) refreshCache(cacheKey, () => backgroundUpdateStreamMovie(tmdbId, cacheKey)).catch(() => {});
      if (cached.__not_found) {
        return res.status(404).json({ error: 'Film non trouvé sur PurStream' });
      }
      // Appliquer le proxy VIP au moment de la réponse (le cache stocke les URLs brutes)
      const response = { ...cached, sources: cached.sources.map(s => ({ ...s, url: wrapSourceUrl(s.url, isVip) })) };
      return res.json(response);
    }

    const initialMapping = await resolvePurstreamId(tmdbId, 'movie');
    if (!initialMapping) {
      return res.status(404).json({ error: 'Film non trouvé sur PurStream' });
    }

    const { mapping, streamData } = await fetchMappedStream(tmdbId, 'movie', initialMapping);

    if (streamData?.__error) {
      if (streamData.status === 404) {
        await saveToCache(PURSTREAM_CACHE_DIR, cacheKey, NOT_FOUND_MARKER);
        return res.status(404).json({ error: 'Film non trouvé sur PurStream' });
      }
      return res.status(502).json({ error: 'Erreur temporaire PurStream' });
    }

    if (!streamData) {
      return res.status(502).json({ error: 'Réponse invalide de PurStream' });
    }

    const sources = streamData.sources || [];
    const result = {
      purstream_id: mapping.purstream_id,
      sources: sources.map(s => ({ url: s.stream_url, name: s.source_name, format: s.format }))
    };

    if (sources.length === 0) {
      await saveToCache(PURSTREAM_CACHE_DIR, cacheKey, NOT_FOUND_MARKER);
      return res.status(404).json({ error: 'Aucun stream disponible pour ce film' });
    }

    await saveToCache(PURSTREAM_CACHE_DIR, cacheKey, result);
    // Retourner avec URLs proxifiées si VIP
    const response = { ...result, sources: result.sources.map(s => ({ ...s, url: wrapSourceUrl(s.url, isVip) })) };
    res.json(response);
  } catch (error) {
    console.error('[PURSTREAM] Erreur stream film:', error.message);
    res.status(502).json({ error: 'Erreur lors de la récupération du stream' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/purstream/tv/:tmdbId/stream?season=X&episode=Y
// ---------------------------------------------------------------------------
router.get('/tv/:tmdbId/stream', async (req, res) => {
  try {
    const { tmdbId } = req.params;
    const { season, episode } = req.query;

    if (!tmdbId || isNaN(tmdbId)) return res.status(400).json({ error: 'TMDB ID invalide' });
    if (!season || isNaN(season)) return res.status(400).json({ error: 'Le paramètre season est requis' });
    if (!episode || isNaN(episode)) return res.status(400).json({ error: 'Le paramètre episode est requis' });

    // Vérifier VIP pour proxifier les URLs
    const accessKey = req.headers['x-access-key'] || null;
    const vipStatus = verifyAccessKey ? await verifyAccessKey(accessKey) : { vip: false };
    const isVip = vipStatus.vip;

    const cacheKey = generateCacheKey(`purstream_stream_tv_${tmdbId}_s${season}e${episode}`);
    const cached = await getFromCacheNoExpiration(PURSTREAM_CACHE_DIR, cacheKey);

    if (cached) {
      const stale = await refreshState.remaining(PURSTREAM_CACHE_DIR, cacheKey, cached) <= 0;
      if (stale) refreshCache(cacheKey, () => backgroundUpdateStreamTv(tmdbId, season, episode, cacheKey)).catch(() => {});
      if (cached.__not_found) {
        return res.status(404).json({ error: 'Épisode non trouvé sur PurStream' });
      }
      const response = { ...cached, sources: cached.sources.map(s => ({ ...s, url: wrapSourceUrl(s.url, isVip) })) };
      return res.json(response);
    }

    const initialMapping = await resolvePurstreamId(tmdbId, 'tv');
    if (!initialMapping) {
      return res.status(404).json({ error: 'Série non trouvée sur PurStream' });
    }

    const { mapping, streamData } = await fetchMappedStream(tmdbId, 'tv', initialMapping, season, episode);

    if (streamData?.__error) {
      if (streamData.status === 404) {
        await saveToCache(PURSTREAM_CACHE_DIR, cacheKey, NOT_FOUND_MARKER);
        return res.status(404).json({ error: 'Épisode non trouvé sur PurStream' });
      }
      return res.status(502).json({ error: 'Erreur temporaire PurStream' });
    }

    if (!streamData) {
      return res.status(502).json({ error: 'Réponse invalide de PurStream' });
    }

    const sources = streamData.sources || [];
    const result = {
      purstream_id: mapping.purstream_id,
      season: streamData.season || Number(season),
      episode: streamData.episode || Number(episode),
      sources: sources.map(s => ({ url: s.stream_url, name: s.source_name, format: s.format }))
    };

    if (sources.length === 0) {
      await saveToCache(PURSTREAM_CACHE_DIR, cacheKey, NOT_FOUND_MARKER);
      return res.status(404).json({ error: 'Aucun stream disponible pour cet épisode' });
    }

    await saveToCache(PURSTREAM_CACHE_DIR, cacheKey, result);
    const response = { ...result, sources: result.sources.map(s => ({ ...s, url: wrapSourceUrl(s.url, isVip) })) };
    res.json(response);
  } catch (error) {
    console.error('[PURSTREAM] Erreur stream série:', error.message);
    res.status(502).json({ error: 'Erreur lors de la récupération du stream' });
  }
});

// ---------------------------------------------------------------------------
// Background updates — ne jamais écraser un cache valide par un échec
// ---------------------------------------------------------------------------
async function backgroundUpdateStreamMovie(tmdbId, cacheKey) {
  const existing = await getFromCacheNoExpiration(PURSTREAM_CACHE_DIR, cacheKey);
  const hasValidCache = existing && !existing.__not_found && existing.sources?.length > 0;

  try {
    await refreshState.defer(PURSTREAM_CACHE_DIR, cacheKey);
    const initialMapping = await resolvePurstreamId(tmdbId, 'movie', { waitForRefresh: true });
    if (!initialMapping) return;

    const { mapping, streamData } = await fetchMappedStream(tmdbId, 'movie', initialMapping);

    if (streamData?.__error && streamData.status === 404) {
      // Espacer les nouvelles tentatives sans perdre les derniers liens utilisables.
      if (!hasValidCache) await saveToCache(PURSTREAM_CACHE_DIR, cacheKey, NOT_FOUND_MARKER);
    }
    if (!streamData || streamData.__error) return;

    const sources = streamData.sources || [];
    if (sources.length === 0) {
      if (!hasValidCache) await saveToCache(PURSTREAM_CACHE_DIR, cacheKey, NOT_FOUND_MARKER);
      return;
    }

    const result = {
      purstream_id: mapping.purstream_id,
      sources: sources.map(s => ({ url: s.stream_url, name: s.source_name, format: s.format }))
    };
    await saveToCache(PURSTREAM_CACHE_DIR, cacheKey, result);
    await refreshState.clear(PURSTREAM_CACHE_DIR, cacheKey);
  } catch (err) {
    reportRefreshFailure('refresh_exception', err, { source: 'PurStream', type: 'movie', id: tmdbId,
      cachePresent: Boolean(existing), cacheUsable: Boolean(hasValidCache) }, redis);
  }
}

async function backgroundUpdateStreamTv(tmdbId, season, episode, cacheKey) {
  const existing = await getFromCacheNoExpiration(PURSTREAM_CACHE_DIR, cacheKey);
  const hasValidCache = existing && !existing.__not_found && existing.sources?.length > 0;

  try {
    await refreshState.defer(PURSTREAM_CACHE_DIR, cacheKey);
    const initialMapping = await resolvePurstreamId(tmdbId, 'tv', { waitForRefresh: true });
    if (!initialMapping) return;

    const { mapping, streamData } = await fetchMappedStream(tmdbId, 'tv', initialMapping, season, episode);

    if (streamData?.__error && streamData.status === 404) {
      // Espacer les nouvelles tentatives sans perdre les derniers liens utilisables.
      if (!hasValidCache) await saveToCache(PURSTREAM_CACHE_DIR, cacheKey, NOT_FOUND_MARKER);
    }
    if (!streamData || streamData.__error) return;

    const sources = streamData.sources || [];
    if (sources.length === 0) {
      if (!hasValidCache) await saveToCache(PURSTREAM_CACHE_DIR, cacheKey, NOT_FOUND_MARKER);
      return;
    }

    const result = {
      purstream_id: mapping.purstream_id,
      season: streamData.season || Number(season),
      episode: streamData.episode || Number(episode),
      sources: sources.map(s => ({ url: s.stream_url, name: s.source_name, format: s.format }))
    };
    await saveToCache(PURSTREAM_CACHE_DIR, cacheKey, result);
    await refreshState.clear(PURSTREAM_CACHE_DIR, cacheKey);
  } catch (err) {
    reportRefreshFailure('refresh_exception', err, { source: 'PurStream', type: 'tv', id: tmdbId, season, episode,
      cachePresent: Boolean(existing), cacheUsable: Boolean(hasValidCache) }, redis);
  }
}

module.exports = router;
module.exports.configure = configure;
