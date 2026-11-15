/**
 * Cpasmal route module.
 * Extracted from server.js — handles Cpasmal search, link extraction, and caching.
 *
 * Mounted as: app.use('/api/cpasmal', require('./routes/cpasmal'));
 * Route paths are relative to the mount point.
 */

const express = require('express');
const router = express.Router();
const cheerio = require('cheerio');
const fsp = require('fs').promises;
const path = require('path');
const axios = require('axios');
const writeFileAtomic = require('write-file-atomic');

const { CACHE_DIR, generateCacheKey } = require('../utils/cacheManager');
const { redis, memoryCache } = require('../config/redis');
const { respondWithResolvedSources } = require('../utils/embedExtraction');

// Cpasmal expose la map de langues sous `links` (`{ vf: [...], vostfr: [...] }`),
// et une seule route sert film comme épisode : la même bascule couvre les deux.
const respondWithSources = (req, res, payload) =>
  respondWithResolvedSources(req, res, payload, { movieMapKey: 'links', label: 'CPASMAL' });
const { fetchTmdbDetails, fetchTmdbAlternativeTitles } = require('../utils/tmdbCache');
const { titleSimilarity } = require('../utils/sourceIdentity');
const { acquireRedisLock } = require('../utils/redisLock');
const { createSourceRefresh } = require('../utils/sourceRefresh');
const { createSharedSourceWork, createSharedSourceLookup } = require('../utils/sharedSourceWork');
const { createConcurrencyLimiter } = require('../utils/concurrency');
const { reportRefreshFailure } = require('../utils/sourceRefreshTelemetry');
const limitCpasmalRequest = createConcurrencyLimiter(12);
const cpasmalSearchCache = createSharedSourceLookup({ redis, namespace: 'cpasmal:search:v1' });
// L'index doit voir une nouvelle saison au prochain contrôle des épisodes vides.
const cpasmalSeriesCache = createSharedSourceLookup({ redis, namespace: 'cpasmal:series:v1', ttlMs: 10 * 60000 });
const cpasmalSharedWork = createSharedSourceWork({ redis, namespace: 'cpasmal:refresh:v1' });

// ---- Lazy-bound dependencies injected via configure() ----
let deps = {
  CPASMAL_BASE_URL: '',
  TMDB_API_URL: '',
  TMDB_API_KEY: '',
  makeCpasmalRequest: async () => { throw new Error('cpasmal not configured'); },
  getFromCacheNoExpiration: async () => null,
  shouldUpdateCache: async () => true
};

/**
 * Toutes les requêtes Cpasmal passent par CycleTLS (JA3 Chrome), avec priorité
 * aux SOCKS5 dédiés et repli sur le pool partagé dans makeCpasmalRequest.
 * Adapte la config axios-style { method, url, data, headers } du routeur vers
 * la signature de makeCpasmalRequest et conserve les statuts/en-têtes de redirection.
 */
function _createScopedRequest() {
  return async (config) => {
    const response = await limitCpasmalRequest(() => deps.makeCpasmalRequest(config.url, {
      method: config.method || 'get',
      body: config.data || '',
      headers: config.headers || {},
      disableRedirect: config.disableRedirect === true,
    })).catch(error => {
      // Proxys en quarantaine ou Cpasmal en pause (disjoncteur) : panne temporaire.
      if (error.code === 'CPASMAL_PROXY_COOLDOWN' || error.code === 'SOURCE_CIRCUIT_OPEN') {
        throw cpasmalUpstreamError();
      }
      throw error;
    });
    // CycleTLS, contrairement à axios, ne rejette pas les statuts d'erreur.
    if (response.status >= 400 || response.status === 0) {
      const error = cpasmalUpstreamError();
      error.response = { status: response.status };
      error.cpasmalProxy = response.cpasmalProxy;
      error.cpasmalAttempts = response.cpasmalAttempts;
      error.cpasmalStatuses = response.cpasmalStatuses;
      const target = new URL(config.url);
      error.cpasmalUrl = response.cpasmalUrl || `${target.origin}${target.pathname}`;
      throw error;
    }
    return response;
  };
}

function configure(injected) {
  Object.assign(deps, injected);
}

// ---- Helper: log 403 errors ----
function _log403(context, error) {
  const status = error.response?.status;
  if (status === 403) {
    const proxy = error.cpasmalProxy || 'unknown';
    const url = error.cpasmalUrl || error.config?.url || '';
    console.log(`[Cpasmal] 403 Forbidden — ${context} | proxy=${proxy} | url=${url} | tentatives=${error.cpasmalAttempts || 1} | statuts=${(error.cpasmalStatuses || [403]).join(',')}`);
    reportRefreshFailure('upstream_forbidden', error, { source: 'Cpasmal', stage: context, url,
      proxy, attempts: error.cpasmalAttempts, statuses: error.cpasmalStatuses }, redis);
  }
}

// ---- Helper functions ----

function cpasmalUpstreamError() {
  return Object.assign(new Error('Cpasmal temporarily unavailable'), { code: 'CPASMAL_UPSTREAM_ERROR' });
}

// Les anciens caches TV peuvent contenir une autre série ou un faux notFound.
const CPASMAL_TV_CACHE_VERSION = 1;
function isObsoleteTvCache(data) {
  return data && data._tvCacheVersion !== CPASMAL_TV_CACHE_VERSION;
}

function hasEmptyLinks(data) {
  if (!data || !data.links) return true;
  const vf = Array.isArray(data.links.vf) ? data.links.vf : [];
  const vostfr = Array.isArray(data.links.vostfr) ? data.links.vostfr : [];
  return vf.length === 0 && vostfr.length === 0;
}

function hasPlayableCpasmalResult(data) {
  return Boolean(data && !data.notFound && !hasEmptyLinks(data));
}

async function saveCpasmalCachePreservingPlayable(cacheKey, candidate, { partial = false, isCurrent = async () => true } = {}) {
  const candidateIsPlayable = hasPlayableCpasmalResult(candidate);
  const candidateIsEmpty = candidate && !candidate.notFound && hasEmptyLinks(candidate);
  const cacheFilePath = path.join(CACHE_DIR.CPASMAL, `${cacheKey}.json`);
  const lock = await acquireRedisLock(`cpasmal-cache-write:${cacheKey}`, {
    ttl: 10,
    retries: 20,
    retryDelay: 50,
  });

  if (!lock) {
    if (!candidateIsPlayable || partial || !await isCurrent()) {
      console.warn(`[CPASMAL CACHE] Ecriture vide ignoree sans verrou pour ${cacheKey}`);
      return false;
    }
    await writeFileAtomic(cacheFilePath, JSON.stringify(candidate), { encoding: 'utf8', fsync: false });
    await memoryCache.set(`${CACHE_DIR.CPASMAL}:${cacheKey}`, candidate);
    return true;
  }

  try {
    if (!await isCurrent()) return false;
    if (partial) {
      const latest = await deps.getFromCacheNoExpiration(CACHE_DIR.CPASMAL, cacheKey);
      // Les lecteurs déjà valides restent disponibles pendant le complément.
      if (hasPlayableCpasmalResult(latest) && !isObsoleteTvCache(latest)) {
        const merge = language => {
          const values = [...(candidate.links[language] || []), ...(latest.links[language] || [])];
          return sortCpasmalLinks(values.filter((link, index) => values.findIndex(item => item.url === link.url) === index));
        };
        candidate = { ...candidate, links: { vf: merge('vf'), vostfr: merge('vostfr') } };
      }
    }
    if (!candidateIsPlayable) {
      const latestCache = await deps.getFromCacheNoExpiration(CACHE_DIR.CPASMAL, cacheKey);
      const replacingObsoleteTvCache = candidate?._tvCacheVersion === CPASMAL_TV_CACHE_VERSION && isObsoleteTvCache(latestCache);
      // La fiche en cache est celle d'un autre film : ses lecteurs ne valent rien.
      const replacingRejectedFilm = Boolean(candidate?.rejectedCpasmalUrl && latestCache?.cpasmalUrl === candidate.rejectedCpasmalUrl);
      if (hasPlayableCpasmalResult(latestCache) && !replacingObsoleteTvCache && !replacingRejectedFilm) {
        try {
          const now = new Date();
          await fsp.utimes(cacheFilePath, now, now);
        } catch (error) { /* ignore */ }
        return false;
      }
    }

    await writeFileAtomic(cacheFilePath, JSON.stringify(candidate), { encoding: 'utf8', fsync: false });
    await memoryCache.set(`${CACHE_DIR.CPASMAL}:${cacheKey}`, candidate);

    if (candidateIsEmpty) {
      try {
        const oldTime = new Date(Date.now() - 30 * 60 * 1000);
        await fsp.utimes(cacheFilePath, oldTime, oldTime);
      } catch (error) { /* ignore */ }
    }

    return true;
  } finally {
    await lock.release();
  }
}

function sortCpasmalLinks(links) {
  const priority = ['voe', 'uqload'];
  return links.sort((a, b) => {
    const indexA = priority.indexOf(a.server);
    const indexB = priority.indexOf(b.server);

    if (indexA !== -1 && indexB !== -1) return indexA - indexB;
    if (indexA !== -1) return -1;
    if (indexB !== -1) return 1;
    return 0;
  });
}

// Helper to get TMDB details (cached via Redis)
async function getTmdbDetails(tmdbId, type) {
  return fetchTmdbDetails(deps.TMDB_API_URL, deps.TMDB_API_KEY, tmdbId, type, 'fr-FR');
}

// Scores search results from a single search query and returns { bestMatch, bestScore }
function _scoreCpasmalResults($, items, title, year, type, normalize) {
  let bestMatch = null;
  let bestScore = -1;

  items.each((i, el) => {
    const $el = $(el);
    const link = $el.find('a.th-img').attr('href');
    const titleText = $el.find('.th-desc .th-capt').text().trim();
    const yearText = $el.find('.th-desc .th-year').text().trim();
    const isSerie = $el.find('.th-Serie').length > 0;
    const isMovie = $el.find('.th-Film').length > 0;

    // Check type - strict filtering
    if (type === 'movie' && !isMovie) return;
    if (type === 'tv' && !isSerie) return;
    // Deux séries homonymes (Nord et Sud 1985 / 2004) ne sont pas interchangeables.
    const resultYear = yearText.match(/\b\d{4}\b/)?.[0];
    if (type === 'tv' && year && resultYear && resultYear !== String(year)) return;

    const normTitle = normalize(title);
    // Retirer l'annee entre parentheses du titre (deja capturee dans yearText)
    const cleanedTitleText = titleText.replace(/\s*\(\d{4}\)\s*/g, '').trim();
    const normTitleText = normalize(cleanedTitleText);

    // Calculate match score
    let score = 0;
    let titleMatchQuality = 'none';

    // Exact title match (highest priority) - 100 points
    if (normTitleText === normTitle) {
      score += 100;
      titleMatchQuality = 'exact';
    }
    // Title starts with search term (good match)
    else if (normTitleText.startsWith(normTitle + ' ')) {
      const lengthRatio = normTitle.length / normTitleText.length;
      if (lengthRatio >= 0.75) {
        score += 50;
        titleMatchQuality = 'strong';
      } else if (lengthRatio >= 0.60) {
        score += 25;
        titleMatchQuality = 'moderate';
      } else {
        score += 5;
        titleMatchQuality = 'weak';
      }
    }
    // Title ends with search term
    else if (normTitleText.endsWith(' ' + normTitle)) {
      const lengthRatio = normTitle.length / normTitleText.length;
      if (lengthRatio >= 0.75) {
        score += 50;
        titleMatchQuality = 'strong';
      } else if (lengthRatio >= 0.60) {
        score += 25;
        titleMatchQuality = 'moderate';
      } else {
        score += 5;
        titleMatchQuality = 'weak';
      }
    }
    // Search term is contained but not at start/end
    else if (normTitleText.includes(normTitle)) {
      score += 5;
      titleMatchQuality = 'weak';
    }
    // Search term contains the result title
    else if (normTitle.includes(normTitleText)) {
      score += 3;
      titleMatchQuality = 'weak';
    }
    // No match at all - skip
    else {
      return;
    }

    // Year matching bonus points
    if (year && yearText) {
      const yearDiff = Math.abs(parseInt(yearText) - parseInt(year));
      const isWeakTitle = (titleMatchQuality === 'weak');
      if (yearDiff === 0) {
        score += isWeakTitle ? 10 : 50;
      } else if (yearDiff === 1) {
        score += isWeakTitle ? 5 : 20;
      } else if (yearDiff > 5) {
        // Forte penalite: empecher un exact title match avec mauvaise annee de battre
        // un match partiel avec bonne annee (ex: "Magnum" 1980 vs "Magnum, P.I." 2018)
        score -= 100;
      } else {
        score -= 30;
      }
    }

    if (score > bestScore && score > 0) {
      bestScore = score;
      bestMatch = link;
    }
  });

  return { bestMatch, bestScore };
}

// Run a single cpasmal search query across multiple pages, return { bestMatch, bestScore }
async function _runCpasmalSearch(searchQuery, title, year, type, normalize, maxPages, requestFn) {
  const doRequest = requestFn || _createScopedRequest();
  let bestMatch = null;
  let bestScore = -1;
  let page = 1;

  while (page <= maxPages) {
    try {
      // POST form (DLE classic): Cloudflare WAF 403s the GET ?do=search querystring, POST body passes.
      const params = new URLSearchParams();
      params.append('do', 'search');
      params.append('subaction', 'search');
      params.append('search_start', String(page));
      params.append('full_search', '0');
      params.append('story', searchQuery);
      const response = await doRequest({
        method: 'post',
        url: `${deps.CPASMAL_BASE_URL}/index.php`,
        data: params.toString(),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Origin': deps.CPASMAL_BASE_URL,
          'Referer': `${deps.CPASMAL_BASE_URL}/`
        }
      });
      const $ = cheerio.load(response.data);

      const items = $('div.thumb');
      if (items.length === 0) break;

      const result = _scoreCpasmalResults($, items, title, year, type, normalize);
      if (result.bestScore > bestScore) {
        bestScore = result.bestScore;
        bestMatch = result.bestMatch;
      }

      // Only stop early if we have title + year confirmed match
      if (bestScore >= 140) break;

      page++;
    } catch (error) {
      _log403('search', error);
      if (!bestMatch) throw error;
      break;
    }
  }

  return { bestMatch, bestScore };
}

async function searchCpasmal(title, year, type, requestFn) {
  return cpasmalSearchCache.load([deps.CPASMAL_BASE_URL, title, year, type],
    () => searchCpasmalUncached(title, year, type, requestFn));
}

async function searchCpasmalUncached(title, year, type, requestFn) {
  const doRequest = requestFn || _createScopedRequest();
  // Prepare search query: normalize spaces and keep colons
  let searchQuery = title.replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();

  // Normalize function for title comparison
  const normalize = (str) => str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[:\s\-.,!?'"()]+/g, ' ').replace(/\s+/g, ' ').trim();

  // === Strategy 1: Search by title only (2 pages) ===
  let { bestMatch, bestScore } = await _runCpasmalSearch(searchQuery, title, year, type, normalize, 2, doRequest);

  // === Strategy 2: If no year-confirmed match, retry with "title year" ===
  if (bestScore < 140 && year) {
    const searchQueryWithYear = `${searchQuery} ${year}`;
    const result2 = await _runCpasmalSearch(searchQueryWithYear, title, year, type, normalize, 1, doRequest);
    if (result2.bestScore > bestScore) {
      bestScore = result2.bestScore;
      bestMatch = result2.bestMatch;
    }
  }

  // === Strategy 3: If still no good match, try full_search=1 ===
  if (bestScore < 20) {
    try {
      const params = new URLSearchParams();
      params.append('do', 'search');
      params.append('subaction', 'search');
      params.append('search_start', '1');
      params.append('full_search', '1');
      params.append('story', searchQuery);
      const response = await doRequest({
        method: 'post',
        url: `${deps.CPASMAL_BASE_URL}/index.php`,
        data: params.toString(),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Origin': deps.CPASMAL_BASE_URL,
          'Referer': `${deps.CPASMAL_BASE_URL}/`
        }
      });
      const $ = cheerio.load(response.data);
      const items = $('div.thumb');
      if (items.length > 0) {
        const result3 = _scoreCpasmalResults($, items, title, year, type, normalize);
        if (result3.bestScore > bestScore) {
          bestScore = result3.bestScore;
          bestMatch = result3.bestMatch;
        }
      }
    } catch (error) {
      _log403('full_search', error);
      throw error;
    }
  }

  return bestScore >= 20 ? bestMatch : null;
}

// Helper to extract links from a movie page
async function extractMovieLinks(url, requestFn, { acceptTitle } = {}) {
  const doRequest = requestFn || _createScopedRequest();
  if (process.env.DEBUG_CPASMAL) console.time(`[Cpasmal] ExtractMovieLinks ${url}`);
  try {
    const response = await doRequest({ method: 'get', url: url });
    const $ = cheerio.load(response.data);
    const links = { vf: [], vostfr: [] };
    let cpasmalYear = null;
    // « Rental Family <span>streaming</span> » : le titre seul, sans le suffixe.
    const heading = $('h1').first().clone();
    heading.find('span').remove();
    const cpasmalTitle = heading.text().replace(/\s+/g, ' ').trim();

    // Extraire l'annee de sortie depuis la page cpasmal
    $('article ul li').each((i, el) => {
      const $el = $(el);
      const infoLabel = $el.find('span.info').text().trim().toLowerCase();
      if (infoLabel.includes('date de sortie') || infoLabel.includes('ann\u00e9e') || infoLabel.includes('annee')) {
        const infoValue = $el.find('span.infos').text().trim();
        const yearMatch = infoValue.match(/(\d{4})/);
        if (yearMatch) {
          cpasmalYear = yearMatch[1];
        }
      }
    });

    // Si pas trouve, chercher avec d'autres selecteurs
    if (!cpasmalYear) {
      const infosList = $('div.content-info ul li, div.shortpost-info ul li, .fx-info ul li');
      infosList.each((i, el) => {
        const text = $(el).text().toLowerCase();
        if (text.includes('date de sortie') || text.includes('ann\u00e9e') || text.includes('annee')) {
          const yearMatch = text.match(/(\d{4})/);
          if (yearMatch) {
            cpasmalYear = yearMatch[1];
          }
        }
      });
    }

    // Une fiche d'un autre film ne doit pas déclencher les appels getxfield.
    if (acceptTitle && cpasmalTitle && !await acceptTitle(cpasmalTitle)) {
      return { links, cpasmalYear, cpasmalTitle, titleRejected: true };
    }

    const linkElements = $('.liens-c .lien');

    // Collect all tasks first
    const tasks = [];

    for (let i = 0; i < linkElements.length; i++) {
      const el = linkElements[i];
      const onclick = $(el).attr('onclick');
      if (onclick && onclick.includes('getxfield')) {
        const match = onclick.match(/getxfield\('([^']*)',\s*'([^']*)',\s*'([^']*)'\)/);
        if (match) {
          const [_, id, xfield, token] = match;
          const isVostfr = xfield.includes('vostfr');
          const isVf = xfield.includes('vf');

          const ajaxUrl = `${deps.CPASMAL_BASE_URL}/engine/ajax/getxfield.php?id=${id}&xfield=${xfield}&token=${token}`;
          tasks.push({ ajaxUrl, xfield, isVostfr, isVf });
        }
      }
    }

    // Execute requests sequentially
    for (const task of tasks) {
      try {
        const ajaxResponse = await doRequest({ method: 'get', url: task.ajaxUrl });
        const iframeMatch = ajaxResponse.data.match(/src="([^"]+)"/);
        if (iframeMatch) {
          const linkData = { server: task.xfield.split('_')[0], url: iframeMatch[1] };
          if (task.isVostfr) links.vostfr.push(linkData);
          if (task.isVf) links.vf.push(linkData);
        }
      } catch (err) {
        _log403('getxfield', err);
      }
    }

    links.vf = sortCpasmalLinks(links.vf);
    links.vostfr = sortCpasmalLinks(links.vostfr);
    if (process.env.DEBUG_CPASMAL) {
      console.timeEnd(`[Cpasmal] ExtractMovieLinks ${url}`);
      console.log(`[Cpasmal] Found ${links.vf.length} VF and ${links.vostfr.length} VOSTFR links`);
    }
    return { links, cpasmalYear, cpasmalTitle };
  } catch (error) {
    _log403('extractMovieLinks', error);
    throw error;
  }
}

// Helper to extract links from a series episode
function readCpasmalSeasons($) {
  const seasons = {};
  $('.th-seas').each((i, el) => {
    const match = $(el).find('.th-count').text().trim().match(/^saison\s+(\d+)$/i);
    const url = $(el).closest('a').attr('href');
    if (match && url) seasons[Number(match[1])] = url;
  });
  return seasons;
}

async function extractSeriesLinks(seriesUrl, seasonNumber, episodeNumber, requestFn, seriesHtml, metadata, onProgress) {
  const doRequest = requestFn || _createScopedRequest();
  if (process.env.DEBUG_CPASMAL) console.time(`[Cpasmal] ExtractSeriesLinks ${seriesUrl}`);
  try {
    const seasons = metadata?.seasons || readCpasmalSeasons(cheerio.load(
      seriesHtml ?? (await doRequest({ method: 'get', url: seriesUrl })).data));
    const seasonUrl = seasons[Number(seasonNumber)];

    if (!seasonUrl) {
      return { vf: [], vostfr: [] };
    }

    // Construct episode URL
    const episodeUrl = new URL(`${seasonUrl.replace(/\.html$/, '')}/${episodeNumber}-episode.html`, seriesUrl).href;

    // Fetch episode page
    const epResponse = await doRequest({ method: 'get', url: episodeUrl });
    const $ = cheerio.load(epResponse.data);

    const links = { vf: [], vostfr: [] };
    const linkElements = $('.liens-c .lien');

    // Collect all tasks first
    const tasks = [];

    for (let i = 0; i < linkElements.length; i++) {
      const el = linkElements[i];
      const onclick = $(el).attr('onclick');
      const redirectMatch = onclick?.match(/\bgetxfield\s*\(\s*this\s*,\s*['"](\d+)['"]\s*,\s*['"](\w+)['"]\s*,\s*['"]serial['"](?:\s*,\s*event)?\s*\)/i);
      if (redirectMatch) {
        const [, id, xfield] = redirectMatch;
        if (!/_(?:vf|vostfr)$/i.test(xfield)) continue;
        // /episode redirige vers l'hébergeur sans le Turnstile de getxfield.
        // L'ID vient du bouton de l'épisode, jamais de TMDB ou de la fiche série.
        const ajaxUrl = `${deps.CPASMAL_BASE_URL}/episode/${id}/${xfield}`;
        const data = new URLSearchParams({ episode_id: id, xfield, range: '100' }).toString();
        if (!tasks.some(task => task.ajaxUrl === ajaxUrl)) {
          tasks.push({ ajaxUrl, data, xfield, redirect: true,
            isVostfr: /_vostfr$/i.test(xfield), isVf: /_vf$/i.test(xfield) });
        }
      } else if (onclick && onclick.includes('playEpisode')) {
        const match = onclick.match(/playEpisode\(this,\s*'([^']*)',\s*'([^']*)'\)/);
        if (match) {
          const [_, id, xfield] = match;
          const isVostfr = xfield.includes('vostfr');
          const isVf = xfield.includes('vf');

          const ajaxUrl = `${deps.CPASMAL_BASE_URL}/engine/inc/serial/app/ajax/Season.php`;
          const params = new URLSearchParams();
          params.append('id', id);
          params.append('xfield', xfield);
          params.append('action', 'playEpisode');

          tasks.push({ ajaxUrl, data: params.toString(), xfield, isVostfr, isVf });
        }
      }
    }

    // Trois lecteurs au plus par épisode, douze requêtes pour tout le worker.
    // Commencer par les lecteurs prioritaires, quel que soit l'ordre du HTML.
    const priority = ['voe', 'uqload'];
    const rank = task => { const index = priority.indexOf(task.xfield.split('_')[0]); return index < 0 ? priority.length : index; };
    tasks.sort((a, b) => rank(a) - rank(b));
    const limitEpisode = createConcurrencyLimiter(3);
    let extractionError = null;
    let published = false;
    await Promise.all(tasks.map(task => limitEpisode(async () => {
      try {
        const ajaxResponse = await doRequest({
          method: 'post',
          url: task.ajaxUrl,
          data: task.data,
          disableRedirect: task.redirect === true,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': task.redirect ? task.ajaxUrl : episodeUrl,
          }
        });

        let playerUrl;
        if (task.redirect) {
          const location = Object.entries(ajaxResponse.headers || {})
            .find(([name]) => name.toLowerCase() === 'location')?.[1];
          if (ajaxResponse.status < 300 || ajaxResponse.status >= 400 || typeof location !== 'string') {
            throw cpasmalUpstreamError();
          }
          const target = new URL(location);
          if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password ||
              target.hostname.replace(/^www\./, '') === new URL(deps.CPASMAL_BASE_URL).hostname.replace(/^www\./, '')) {
            throw cpasmalUpstreamError();
          }
          playerUrl = target.href;
        } else {
          playerUrl = cheerio.load(ajaxResponse.data)('iframe[src]').first().attr('src');
        }
        if (playerUrl) {
          const linkData = { server: task.xfield.split('_')[0], url: playerUrl };
          if (task.isVostfr) links.vostfr.push(linkData);
          if (task.isVf) links.vf.push(linkData);
          if (!published && tasks.length > 3 && onProgress) {
            published = true;
            await onProgress({ vf: sortCpasmalLinks([...links.vf]), vostfr: sortCpasmalLinks([...links.vostfr]) });
          }
        } else {
          throw cpasmalUpstreamError();
        }
      } catch (err) {
        _log403('playEpisode', err);
        extractionError = cpasmalUpstreamError();
      }
    })));

    if (hasEmptyLinks({ links }) && (extractionError || (linkElements.length && !tasks.length))) {
      throw extractionError || cpasmalUpstreamError();
    }

    links.vf = sortCpasmalLinks(links.vf);
    links.vostfr = sortCpasmalLinks(links.vostfr);
    if (process.env.DEBUG_CPASMAL) {
      console.timeEnd(`[Cpasmal] ExtractSeriesLinks ${seriesUrl}`);
      console.log(`[Cpasmal] Found ${links.vf.length} VF and ${links.vostfr.length} VOSTFR links`);
    }
    return links;

  } catch (error) {
    _log403('extractSeriesLinks', error);
    throw error;
  }
}

// === DATA FETCHING FUNCTIONS ===

// « Family » (2026) ne doit pas recevoir la fiche « Rental Family » : le score
// de recherche tolère un titre partiel, la fiche retenue doit porter le titre
// TMDB, son titre original ou un titre alternatif FR/US/GB.
function createCpasmalTitleCheck(tmdbData) {
  const titles = [tmdbData.title, tmdbData.original_title].filter(Boolean);
  let aliasesPromise;
  const matches = (candidate, list) => list.some(title => titleSimilarity(title, candidate) >= 0.8);
  return async (cpasmalTitle) => {
    if (matches(cpasmalTitle, titles)) return true;
    aliasesPromise ||= fetchTmdbAlternativeTitles(deps.TMDB_API_URL, deps.TMDB_API_KEY, tmdbData.id, 'movie')
      .then(result => (result?.titles || result?.results || [])
        .filter(item => ['FR', 'US', 'GB'].includes(item.iso_3166_1)).map(item => item.title))
      .catch(() => null);
    const aliases = await aliasesPromise;
    // Sans réponse TMDB, on ne rejette pas une fiche sur le seul titre principal.
    if (!aliases) return true;
    return matches(cpasmalTitle, aliases);
  };
}

async function fetchCpasmalMovieData(tmdbId, throwOnError = true, knownCpasmalUrl = null) {
  const requestFn = _createScopedRequest();

  const tmdbData = await getTmdbDetails(tmdbId, 'movie');
  if (!tmdbData) {
    if (throwOnError) throw new Error('Movie not found on TMDB');
    return null;
  }

  const title = tmdbData.title;
  const tmdbYear = tmdbData.release_date ? tmdbData.release_date.split('-')[0] : null;
  const acceptTitle = createCpasmalTitleCheck(tmdbData);
  // Le cache peut contenir une fiche acceptée avant ce contrôle : si elle porte
  // un autre titre, l'indiquer pour qu'elle soit remplacée par le notFound.
  const notFound = async (message) => {
    if (throwOnError) throw new Error(message);
    if (!knownCpasmalUrl) return null;
    const known = await extractMovieLinks(knownCpasmalUrl, requestFn, { acceptTitle }).catch(() => null);
    return known?.titleRejected ? { rejectedCpasmalUrl: knownCpasmalUrl } : null;
  };

  const cpasmalUrl = await searchCpasmal(title, tmdbYear, 'movie', requestFn);
  if (!cpasmalUrl) return notFound('Movie not found on Cpasmal');
  let { links, cpasmalYear, titleRejected } = await extractMovieLinks(cpasmalUrl, requestFn, { acceptTitle });
  if (titleRejected) {
    if (throwOnError) throw new Error('Movie not found on Cpasmal (title mismatch)');
    return cpasmalUrl === knownCpasmalUrl ? { rejectedCpasmalUrl: cpasmalUrl } : notFound();
  }
  let finalCpasmalUrl = cpasmalUrl;

  // Validation post-match: reject if year mismatch, retry with explicit year search
  if (cpasmalYear && tmdbYear && cpasmalYear !== tmdbYear) {
    // Retry: search specifically with "title year"
    const normalize = (str) => str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[:\s\-.,!?'"()]+/g, ' ').replace(/\s+/g, ' ').trim();
    const searchQueryWithYear = `${title.replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim()} ${tmdbYear}`;
    const retryResult = await _runCpasmalSearch(searchQueryWithYear, title, tmdbYear, 'movie', normalize, 2, requestFn);

    if (retryResult.bestMatch && retryResult.bestMatch !== cpasmalUrl) {
      const retryExtract = await extractMovieLinks(retryResult.bestMatch, requestFn, { acceptTitle });
      // Accept if year matches or if year is not available on the page
      if (!retryExtract.titleRejected && (!retryExtract.cpasmalYear || retryExtract.cpasmalYear === tmdbYear)) {
        links = retryExtract.links;
        cpasmalYear = retryExtract.cpasmalYear;
        finalCpasmalUrl = retryResult.bestMatch;
      } else {
        return notFound('Movie not found on Cpasmal (year mismatch)');
      }
    } else {
      return notFound('Movie not found on Cpasmal (year mismatch)');
    }
  }

  const year = cpasmalYear || tmdbYear;
  return { title, year, cpasmalUrl: finalCpasmalUrl, links };
}

async function fetchCpasmalSeriesMetadata(tmdbData, requestFn) {
  const title = tmdbData.name;
  const year = tmdbData.first_air_date ? tmdbData.first_air_date.split('-')[0] : null;

  let cpasmalUrl = await searchCpasmal(title, year, 'tv', requestFn);
  if (!cpasmalUrl) {
    return null;
  }

  // Vérifier aussi la fiche, y compris celle trouvée par la seconde recherche.
  // Une erreur réseau pendant cette validation ne doit jamais autoriser le match.
  let pageResponse;
  let seasons;
  for (let attempt = 0; attempt < 2; attempt++) {
    pageResponse = await requestFn({ method: 'get', url: cpasmalUrl });
    const $page = cheerio.load(pageResponse.data);
    let cpasmalYear = null;
    $page('article ul li, div.content-info ul li, div.shortpost-info ul li, .fx-info ul li').each((i, el) => {
      const $el = $page(el);
      const label = ($el.find('span.info').text() || $el.text()).trim().toLowerCase();
      if (label.includes('date de sortie') || label.includes('année') || label.includes('annee')) {
        const value = $el.find('span.infos').text() || $el.text();
        cpasmalYear = value.match(/\b\d{4}\b/)?.[0] || cpasmalYear;
      }
    });
    if (!year || !cpasmalYear || cpasmalYear === year) {
      seasons = readCpasmalSeasons($page);
      break;
    }

    if (attempt === 0) {
      const normalize = (str) => str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[:\s\-.,!?'"()]+/g, ' ').replace(/\s+/g, ' ').trim();
      const searchQueryWithYear = `${title.replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim()} ${year}`;
      const retry = await _runCpasmalSearch(searchQueryWithYear, title, year, 'tv', normalize, 2, requestFn);
      if (retry.bestScore >= 20 && retry.bestMatch && retry.bestMatch !== cpasmalUrl) {
        cpasmalUrl = retry.bestMatch;
        continue;
      }
    }
    return null;
  }
  return { title, year, cpasmalUrl, seasons };
}

async function fetchCpasmalTvData(tmdbId, season, episode, throwOnError = true, onProgress) {
  const requestFn = _createScopedRequest();
  const tmdbData = await getTmdbDetails(tmdbId, 'tv');
  if (!tmdbData) throw cpasmalUpstreamError();
  // La validation de l'année et l'index des saisons sont communs aux épisodes.
  const metadata = await cpasmalSeriesCache.load(
    [deps.CPASMAL_BASE_URL, tmdbId, tmdbData.name, tmdbData.first_air_date],
    () => fetchCpasmalSeriesMetadata(tmdbData, requestFn));
  if (!metadata) {
    if (throwOnError) throw new Error('TV Show not found on Cpasmal');
    return null;
  }
  const { title, year, cpasmalUrl } = metadata;
  const links = await extractSeriesLinks(cpasmalUrl, season, episode, requestFn, undefined, metadata,
    onProgress && (links => onProgress({ title, year, cpasmalUrl, links })));
  return { title, year, cpasmalUrl, links };
}

// La récupération et sa publication continuent après la réponse HTTP.
const cpasmalRefresh = createSourceRefresh();
const CPASMAL_CHECK_INTERVAL = 40 * 60 * 1000;

const refreshCpasmalCache = (cacheKey, type, ...args) => cpasmalRefresh.run(cacheKey, () => cpasmalSharedWork.run(cacheKey, async ({ isCurrent }) => {
  const cached = await deps.getFromCacheNoExpiration(CACHE_DIR.CPASMAL, cacheKey);
  // Les réponses vides étaient antidatées de 30 minutes pour une reprise à 10 min.
  const checkInterval = cached && !cached.notFound && hasEmptyLinks(cached)
    ? 10 * 60 * 1000 : CPASMAL_CHECK_INTERVAL;
  if (cached && !cached._cpasmalPartial && !(type === 'tv' && isObsoleteTvCache(cached)) && (cpasmalRefresh.recentlyChecked(cacheKey, checkInterval) ||
      !await deps.shouldUpdateCache(CACHE_DIR.CPASMAL, cacheKey))) return cached;

  const fetched = type === 'movie'
    ? await fetchCpasmalMovieData(args[0], false, cached?.cpasmalUrl || null)
    : await fetchCpasmalTvData(args[0], args[1], args[2], false, partial =>
      saveCpasmalCachePreservingPlayable(cacheKey, { ...partial, _tvCacheVersion: CPASMAL_TV_CACHE_VERSION, _cpasmalPartial: true }, { partial: true, isCurrent }));
  const rejectedCpasmalUrl = fetched?.rejectedCpasmalUrl;
  const newData = rejectedCpasmalUrl ? null : fetched;
  const candidate = newData || {
    notFound: true, tmdbId: args[0],
    ...(type === 'tv' ? { season: args[1], episode: args[2] } : {}),
    ...(rejectedCpasmalUrl ? { rejectedCpasmalUrl } : {}),
    timestamp: Date.now(),
  };
  if (type === 'tv') candidate._tvCacheVersion = CPASMAL_TV_CACHE_VERSION;
  if (!await isCurrent()) throw Object.assign(cpasmalUpstreamError(), { message: 'Récupération Cpasmal interrompue' });
  await saveCpasmalCachePreservingPlayable(cacheKey, candidate, { isCurrent });
  cpasmalRefresh.markChecked(cacheKey);
  return candidate;
}));

const updateCpasmalCache = async (cacheKey, type, ...args) => {
  try {
    // Vérifier la date avant de relire un JSON déjà servi depuis le cache.
    if (!await deps.shouldUpdateCache(CACHE_DIR.CPASMAL, cacheKey)) return;
    await refreshCpasmalCache(cacheKey, type, ...args);
  } catch {
    // La réponse en cache a déjà été envoyée.
  }
};

function respondWithRetrieval(res, cacheKey, type, ...args) {
  res.setHeader('Cache-Control', 'no-store');
  // Un échec récent doit être visible au prochain appel, pas rester un 202.
  const failure = cpasmalRefresh.getFailure(cacheKey);
  if (failure) throw failure;

  void refreshCpasmalCache(cacheKey, type, ...args).catch(() => {
    // createSourceRefresh conserve l'erreur et temporise les nouvelles tentatives.
  });
  res.setHeader('Retry-After', '2');
  return res.status(202).json({
    success: false,
    pending: true,
    code: 'retrieval_in_progress',
    message: 'Récupération Cpasmal en cours, réessayez dans quelques secondes',
    tmdb_id: args[0],
    ...(type === 'tv' ? { season: Number(args[1]), episode: Number(args[2]) } : {}),
  });
}

// ---- Routes ----

router.get('/movie/:tmdbid', async (req, res) => {
  const { tmdbid } = req.params;
  const cacheKey = generateCacheKey(`movie_${tmdbid}`);

  if (process.env.DEBUG_CPASMAL) {
    const used = process.memoryUsage().heapUsed / 1024 / 1024;
    console.log(`[Cpasmal API] Start /movie/${tmdbid} - Memory: ${Math.round(used * 100) / 100} MB`);
  }

  try {
    // 1. Try cache
    const cachedData = await deps.getFromCacheNoExpiration(CACHE_DIR.CPASMAL, cacheKey);
    if (cachedData) {
      const cacheFilePath = path.join(CACHE_DIR.CPASMAL, `${cacheKey}.json`);

      if (cachedData.notFound) {
        res.status(404).json({ error: 'Movie not found on Cpasmal (Cached)' });
      } else {
        // Calculer la prochaine mise à jour
        let prochaineMiseAJour = null;
        try {
          const stats = await fsp.stat(cacheFilePath);
          const nextUpdateTime = stats.mtime.getTime() + 40 * 60 * 1000;
          if (nextUpdateTime <= Date.now()) {
            prochaineMiseAJour = 'immédiate';
          } else {
            prochaineMiseAJour = new Date(nextUpdateTime).toISOString();
          }
        } catch (e) { /* ignore */ }
        await respondWithSources(req, res, { ...cachedData, prochaineMiseAJour });
      }

      updateCpasmalCache(cacheKey, 'movie', tmdbid);
      return;
    }

    return respondWithRetrieval(res, cacheKey, 'movie', tmdbid);

  } catch (error) {
    if (error.code === 'CPASMAL_UPSTREAM_ERROR' || error.code === 'SOURCE_REFRESH_UNAVAILABLE') {
      return res.status(503).json({ error: error.message });
    }
    if (error.message && error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.get('/tv/:tmdbid/:season/:episode', async (req, res) => {
  const { tmdbid, season, episode } = req.params;
  const cacheKey = generateCacheKey(`tv_${tmdbid}_s${season}_e${episode}`);

  try {
    // 1. Try cache
    const cachedData = await deps.getFromCacheNoExpiration(CACHE_DIR.CPASMAL, cacheKey);
    if (cachedData && !isObsoleteTvCache(cachedData)) {
      const cacheFilePath = path.join(CACHE_DIR.CPASMAL, `${cacheKey}.json`);

      if (cachedData.notFound) {
        res.status(404).json({ error: 'TV Show not found on Cpasmal (Cached)' });
      } else {
        // Calculer la prochaine mise à jour
        let prochaineMiseAJour = null;
        try {
          const stats = await fsp.stat(cacheFilePath);
          const nextUpdateTime = stats.mtime.getTime() + 40 * 60 * 1000;
          if (nextUpdateTime <= Date.now()) {
            prochaineMiseAJour = 'immédiate';
          } else {
            prochaineMiseAJour = new Date(nextUpdateTime).toISOString();
          }
        } catch (e) { /* ignore */ }
        await respondWithSources(req, res, { ...cachedData, prochaineMiseAJour });
      }

      if (cachedData._cpasmalPartial) {
        void refreshCpasmalCache(cacheKey, 'tv', tmdbid, season, episode).catch(() => {});
      } else {
        updateCpasmalCache(cacheKey, 'tv', tmdbid, season, episode);
      }
      return;
    }

    return respondWithRetrieval(res, cacheKey, 'tv', tmdbid, season, episode);

  } catch (error) {
    if (error.code === 'CPASMAL_UPSTREAM_ERROR' || error.code === 'SOURCE_REFRESH_UNAVAILABLE') {
      return res.status(503).json({ error: error.message });
    }
    if (error.message && error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
module.exports.configure = configure;
