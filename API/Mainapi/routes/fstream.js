/**
 * FStream routes.
 * Extracted from server.js -- FStream authentication, search, scraping, player extraction, and routes.
 * Mount point: app.use('/api/fstream', router)
 */

const express = require('express');
const router = express.Router();
const axios = require('axios');
const cheerio = require('cheerio');
const { fetchTmdbDetails, fetchTmdbSeason } = require('../utils/tmdbCache');
const { baseTitle, yearOf, titleSimilarity, searchTitles, parseSourceIdentity, createIdentityVerifier } = require('../utils/sourceIdentity');
const { uncachedFStreamResponse } = require('../utils/fstreamCache');
const { withRefreshDiagnostics, refreshStep } = require('../utils/sourceRefreshTelemetry');
const {
  generateFStreamCacheKey,
  getFStreamRefreshInfo,
  refreshFStreamCache,
  invalidateFStreamCache,
  ongoingFStreamRequests,
  getOrCreateFStreamRequest
} = require('../utils/cacheManager');
const axiosHelpers = require('../utils/axiosHelpers');
const { axiosFStreamRequest } = axiosHelpers;
const { redis } = require('../config/redis');
const { createFStreamSearchCache } = require('../utils/fstreamSearchCache');
const searchCache = createFStreamSearchCache({ redis });
const { respondWithResolvedSources } = require('../utils/embedExtraction');

/** Séries : résout les m3u8 de l'épisode demandé (`?episode=N`), pour un VIP. */
const respondWithEpisodeSources = (req, res, payload, status = 200) =>
  respondWithResolvedSources(req, res, payload, { status, label: 'FSTREAM TV' });

/** Films : la map de langues vit sous `players`. */
const respondWithMovieSources = (req, res, payload, status = 200) =>
  respondWithResolvedSources(req, res, payload, {
    status,
    movieMapKey: 'players',
    label: 'FSTREAM MOVIE',
  });
const { PROXIES, DARKINO_PROXIES, withFStreamProxy } = require('../utils/proxyManager');

// === FStream Configuration ===
const TMDB_API_KEY = process.env.TMDB_API_KEY || '';
const TMDB_API_URL = 'https://api.themoviedb.org/3';
const { FSTREAM_BASE_URL, canonicalFStreamUrl } = require('../config/fstream');
const FSTREAM_SEARCH_URL = `${FSTREAM_BASE_URL}/engine/ajax/search.php`;

// === FStream Authentication (disabled) ===
const FSTREAM_LOGIN_NAME = process.env.FSTREAM_LOGIN_NAME || '';
const FSTREAM_LOGIN_PASSWORD = process.env.FSTREAM_LOGIN_PASSWORD || '';

let fstreamLoginPromise = null;

// Configuration des cookies FStream
const fstreamCookies = {
  'PHPSESSID': '',
  'dle_user_id': '',
  'dle_password': '',
  'dle_skin': 'VFV25',
  'dle_newpm': '0',
  '__cf_logged_in': '1',
  'CF_VERIFIED_DEVICE_ae9bb95a6761c08a92f916b7ed7d2c4a985eb220591d1410240412c516f37b0c': '1756239054',
  // Anti-bot "fsschal": le challenge JS de FStream pose juste ce cookie statique puis recharge.
  // Sans lui, search.php / episodes_p.php / film_api.php renvoient la page "Verification..." (1466b)
  // au lieu des donnees. Les fichiers /static/ en sont exempts. Valeur overridable si elle tourne.
  'fsschal': process.env.FSTREAM_FSSCHAL || '1'
};

// Construit le header Cookie complet depuis fstreamCookies, pour les requetes axios
// directes (episodes_p, film_api, static) qui ne passent pas par withOptionalFStreamCookies.
function buildFStreamCookieHeader() {
  return Object.entries(fstreamCookies)
    .filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

let fstreamRequestCounter = 0;
const MAX_REQUESTS_PER_SESSION = 5;

function extractCookieValue(cookies, name) {
  if (!cookies || !Array.isArray(cookies)) return null;
  const target = cookies.find(c => typeof c === 'string' && c.startsWith(`${name}=`));
  if (!target) return null;
  const semi = target.indexOf(';');
  const pair = semi !== -1 ? target.slice(0, semi) : target;
  const idx = pair.indexOf('=');
  return idx !== -1 ? pair.slice(idx + 1) : null;
}

function hasFStreamAuthCookies() {
  return Boolean(fstreamCookies['dle_user_id'] && fstreamCookies['dle_password']);
}

function hasUsableFStreamSession() {
  return hasFStreamAuthCookies() || Boolean(fstreamCookies['PHPSESSID']);
}

function canUseFStreamAuth() {
  return false;
}

async function loginToFStream() {
  if (!canUseFStreamAuth()) return false;
  if (fstreamLoginPromise) return fstreamLoginPromise;
  fstreamLoginPromise = (async () => {
    try {
      // We need the raw axiosFStream instance for login (no proxy)
      // Use axios directly for the login request
      const formData = new URLSearchParams();
      formData.append('login_name', FSTREAM_LOGIN_NAME);
      formData.append('login_password', FSTREAM_LOGIN_PASSWORD);
      formData.append('login', 'submit');

      const response = await axios({
        method: 'post',
        url: FSTREAM_BASE_URL,
        data: formData,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Origin': FSTREAM_BASE_URL,
          'Referer': FSTREAM_BASE_URL,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        },
        timeout: 15000,
        maxRedirects: 5,
        validateStatus: () => true
      });

      const setCookie = response.headers && (response.headers['set-cookie'] || response.headers['Set-Cookie']);
      const phpsessid = extractCookieValue(setCookie, 'PHPSESSID');
      const dleUserId = extractCookieValue(setCookie, 'dle_user_id');
      const dlePassword = extractCookieValue(setCookie, 'dle_password');
      const dleNewpm = extractCookieValue(setCookie, 'dle_newpm');

      fstreamCookies['PHPSESSID'] = phpsessid || '';
      if (dleUserId) fstreamCookies['dle_user_id'] = dleUserId;
      if (dlePassword) fstreamCookies['dle_password'] = dlePassword;
      if (dleNewpm) fstreamCookies['dle_newpm'] = dleNewpm;

      if (!hasFStreamAuthCookies()) {
        console.warn('[FSTREAM LOGIN] Cookies d\'auth non presents dans set-cookie, poursuite sans authentification');
        return false;
      }
      // Connexion reussie, cookies recuperes

      // Changer le skin vers VFV25 via POST
      try {
        const skinCookieHeader = Object.entries(fstreamCookies)
          .filter(([, v]) => v !== '' && v != null)
          .map(([k, v]) => `${k}=${v}`)
          .join('; ');

        const skinFormData = new URLSearchParams();
        skinFormData.append('skin_name', 'VFV25');
        skinFormData.append('action_skin_change', 'yes');

        await axios({
          method: 'post',
          url: FSTREAM_BASE_URL,
          data: skinFormData,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Origin': FSTREAM_BASE_URL,
            'Referer': FSTREAM_BASE_URL + '/',
            'Cookie': skinCookieHeader,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          },
          timeout: 15000,
          maxRedirects: 5,
          validateStatus: () => true
        });

        fstreamCookies['dle_skin'] = 'VFV25';
        // Skin change vers VFV25
      } catch (skinError) {
        console.warn('[FSTREAM LOGIN] Erreur changement de skin:', skinError.message);
      }

      return true;
    } finally {
      fstreamLoginPromise = null;
    }
  })();
  return fstreamLoginPromise;
}

async function ensureFStreamSession() {
  if (!canUseFStreamAuth()) return false;
  if (!hasUsableFStreamSession() || fstreamRequestCounter >= MAX_REQUESTS_PER_SESSION) {
    try {
      const loggedIn = await loginToFStream();
      if (loggedIn) {
        fstreamRequestCounter = 0;
      }
      return loggedIn;
    } catch (error) {
      console.warn('[FSTREAM LOGIN] Auth optionnelle indisponible, poursuite sans cookies:', error.message);
      return false;
    }
  }
  return true;
}

// Inject fstream session management into axiosHelpers so axiosFStreamRequest works
axiosHelpers.configure({
  ensureFStreamSession,
  fstreamCookies,
  getFstreamRequestCounter: () => fstreamRequestCounter,
  incrementFstreamRequestCounter: () => { fstreamRequestCounter++; }
});

// === TMDB Helper (cached via Redis) ===
async function getFStreamTMDBDetails(id, type) {
  if (!/^[1-9]\d*$/.test(String(id))) return null;
  refreshStep('tmdb', { id, type, validTmdbId: /^\d+$/.test(String(id)) });
  try {
    const [frData, enData] = await Promise.all([
      fetchTmdbDetails(TMDB_API_URL, TMDB_API_KEY, id, type, 'fr-FR'),
      fetchTmdbDetails(TMDB_API_URL, TMDB_API_KEY, id, type, 'en-US')
    ]);

    if (!frData) {
      refreshStep('tmdb_missing', { reason: /^\d+$/.test(String(id)) ? 'Fiche absente ou requête TMDB échouée' : 'Identifiant non numérique : ce contenu ne vient pas de TMDB' });
      return null;
    }
    refreshStep('tmdb_result', { title: frData.title || frData.name, originalTitle: frData.original_title || frData.original_name, alternateTitle: enData?.title || enData?.name });

    return {
      id: frData.id,
      title: type === 'movie' ? frData.title : frData.name,
      original_title: type === 'movie' ? frData.original_title : frData.original_name,
      name_no_lang: enData ? (type === 'movie' ? enData.title : enData.name) : null,
      release_date: type === 'movie' ? frData.release_date : frData.first_air_date,
      overview: frData.overview,
      overview_en: enData?.overview,
      poster_path: frData.poster_path,
      backdrop_path: frData.backdrop_path,
      created_by: frData.created_by,
    };
  } catch (error) {
    refreshStep('tmdb_error', {}, error);
    console.error(`Erreur lors de la recuperation des details TMDB pour ${id} (${type}):`, error);
    return null;
  }
}

// === Title Similarity (local copy for FStream matching) ===
function calculateTitleSimilarity(title1, title2) {
  if (!title1 || !title2) return 0;
  const t1 = title1.toLowerCase();
  const t2 = title2.toLowerCase();
  const normalize = (str) => str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const norm1 = normalize(t1);
  const norm2 = normalize(t2);
  if (norm1 === norm2) return 1.0;

  // Token overlap approach
  const tokens1 = new Set(norm1.split(' ').filter(Boolean));
  const tokens2 = new Set(norm2.split(' ').filter(Boolean));
  let intersection = 0;
  for (const t of tokens1) { if (tokens2.has(t)) intersection++; }
  const union = new Set([...tokens1, ...tokens2]).size;
  return union === 0 ? 0 : intersection / union;
}

function normalizeFStreamBaseTitle(value) {
  return (value || '')
    .replace(/\s*\(\d{4}\)\s*/g, ' ')
    .replace(/\s*-\s*Saison\s+\d+.*$/i, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isFStreamCachedSelectionValid(cachedData, requestedSeason) {
  const tmdbTitle = cachedData?.tmdb?.title;
  const bestMatch = cachedData?.search?.bestMatch;
  if (!tmdbTitle || !bestMatch) return true;

  const requestedSeasonNumber = parseInt(requestedSeason, 10);
  const cachedSeasonNumber = parseInt(bestMatch.seasonNumber, 10);
  if (
    !Number.isNaN(requestedSeasonNumber) &&
    !Number.isNaN(cachedSeasonNumber) &&
    cachedSeasonNumber !== requestedSeasonNumber
  ) {
    return false;
  }

  const normalizedTmdbTitle = normalizeFStreamBaseTitle(tmdbTitle);
  const normalizedMatchTitle = normalizeFStreamBaseTitle(
    bestMatch.originalTitle || bestMatch.title,
  );
  const tmdbTokens = normalizedTmdbTitle.split(' ').filter(Boolean);

  if (cachedData.metadata?.identity?.accepted === true
      && String(cachedData.metadata.identity.tmdbId) === String(cachedData.tmdb.id)) return true;

  if (tmdbTokens.length === 1) {
    // La recherche peut retenir le titre original/anglais (Mentalist -> The
    // Mentalist, Chacal -> The Day of the Jackal). Garder une égalité stricte
    // avec ces titres TMDB pour ne pas confondre FROM avec From Me to You.
    return [tmdbTitle, cachedData.tmdb.original_title, cachedData.tmdb.name_no_lang]
      .filter(Boolean)
      .some((title) => normalizeFStreamBaseTitle(title) === normalizedMatchTitle);
  }

  return true;
}

// === Search Functions ===
async function searchFStream(query, page = 1) {
  refreshStep('search', { query, page, url: FSTREAM_SEARCH_URL });
  try {
    const result = await searchCache.load(FSTREAM_SEARCH_URL, query, page, async (normalizedQuery) => {
      const formData = new URLSearchParams({ query: normalizedQuery, page: page.toString() });
      const response = await axiosFStreamRequest({
        method: 'post',
        url: FSTREAM_SEARCH_URL,
        data: formData,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      if (response.status !== 200) throw Object.assign(new Error(`Erreur HTTP: ${response.status}`), { response: { status: response.status } });
      if (typeof response.data !== 'string' || /cf-chl-|just a moment|bot shield|<title>[^<]*verification/i.test(response.data)) {
        throw Object.assign(new Error('Recherche FStream bloquée ou réponse inattendue'), { code: 'UPSTREAM_INVALID_RESPONSE' });
      }
      return response.data;
    });
    refreshStep('search_response', { query, html: typeof result === 'string', challenge: typeof result === 'string' && /verification|cf-chl-|just a moment|bot shield/i.test(result) });
    return result;
  } catch (error) {
    refreshStep('search_error', { query, url: FSTREAM_SEARCH_URL }, error);
    if (error.response) {
      const status = error.response.status;
      if (status === 429 || status === 403 || status === 503 || status === 502) throw error;
    }
    console.error(`Erreur lors de la recherche FStream: ${error.message}`);
    throw error;
  }
}

async function searchFStreamDirect(query, page = 1) {
  return searchFStream(query, page);
}

// FStream renvoie certains titres échappés à la PHP (« L\'Arène - Saison 1 »).
// Normalisé, « l arene » ne correspond plus à « larene » (TMDB « L'Arène ») et
// la fiche est écartée dès le score de titre.
function repairFStreamSearchHtml(html) {
  return String(html || '').replace(/\\'/g, "'");
}

// Fallback "fuzzy" : search.php avec titre nu + filtre permissif (pas de filtre annee).
// Remplace l'ancien get_seasons.php (mort cote upstream depuis ~2026-05) qui prenait
// un TMDB id ; on simule le meme role en listant toutes les saisons matchant le titre.
async function fetchFStreamSeasonSearchResults(tmdbId, serieTitle) {
  if (!serieTitle) return [];
  refreshStep('season_search', { query: serieTitle });
  try {
    // Ce parcours conserve sa requête AJAX sans pagination. Ne pas confondre
    // sa réponse avec celle d'une recherche paginée, même pour le même titre.
    const result = await searchCache.load(FSTREAM_SEARCH_URL, serieTitle, null, async (normalizedQuery) => {
      const response = await axiosFStreamRequest({
        method: 'post',
        url: FSTREAM_SEARCH_URL,
        data: new URLSearchParams({ query: normalizedQuery }),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest'
        },
        timeout: 6000
      });
      if (response.status !== 200) throw new Error(`Erreur HTTP: ${response.status}`);
      return response.data;
    });
    const html = typeof result === 'string' ? result : '';
    if (!html.trim()) return [];

    const $ = cheerio.load(repairFStreamSearchHtml(html));
    const normalize = (s) => (s || '').toLowerCase().normalize('NFD')
      .replace(/[̀-ͯ]/g, '').replace(/[''`´]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const normalizedSerie = normalize(serieTitle);
    if (!normalizedSerie) return [];

    const results = [];
    const exactResults = [];
    const normalizedSerieTokens = normalizedSerie.split(' ').filter(Boolean);
    $('div.search-item').each((_, element) => {
      const $el = $(element);
      const rawTitle = $el.find('.search-title').text().trim();
      const onclickAttr = $el.attr('onclick') || '';
      const linkMatch = onclickAttr.match(/location\.href=['"]([^'"]+)['"]/);
      const link = linkMatch ? linkMatch[1] : null;
      if (!rawTitle || !link) return;

      const seasonMatch = rawTitle.match(/Saison\s+(\d+)/i);
      if (!seasonMatch) return;
      const seasonNumber = parseInt(seasonMatch[1], 10);
      if (Number.isNaN(seasonNumber)) return;

      const baseTitle = rawTitle.replace(/\s*-\s*Saison\s+\d+.*$/i, '').replace(/\s*\(\d{4}\)\s*$/, '').trim();
      const normalizedBase = normalize(baseTitle);
      if (!normalizedBase) return;
      const isExactTitle = normalizedBase === normalizedSerie;
      if (normalizedSerieTokens.length === 1 && !isExactTitle) return;
      if (!normalizedBase.includes(normalizedSerie) && !normalizedSerie.includes(normalizedBase)) return;

      const titleYearMatch = rawTitle.match(/\((\d{4})\)/);
      const urlYearMatch = link.match(/-(\d{4})\.html/);
      const year = titleYearMatch ? parseInt(titleYearMatch[1], 10)
        : urlYearMatch ? parseInt(urlYearMatch[1], 10) : null;

      const cleanTitle = baseTitle ? `${baseTitle} - Saison ${seasonNumber}` : rawTitle;
      const normalizedLink = link.startsWith('http')
        ? link
        : `${FSTREAM_BASE_URL}${link.startsWith('/') ? '' : '/'}${link}`;

      const target = isExactTitle ? exactResults : results;
      target.push({
        title: cleanTitle,
        originalTitle: rawTitle,
        link: normalizedLink,
        seasonNumber,
        year
      });
    });

    const matches = exactResults.length > 0 ? exactResults : results;
    refreshStep('season_search_result', { query: serieTitle, results: matches.length });
    return matches;
  } catch (error) {
    refreshStep('season_search_error', { query: serieTitle }, error);
    console.error(`[FSTREAM TV] Erreur lors de la recuperation des saisons pour ${tmdbId}: ${error.message}`);
    return [];
  }
}

// get_seasons.php (ajax related-seasons de DLE) est toujours vivant cote upstream,
// contrairement a l'hypothese de fetchFStreamSeasonSearchResults. serie_tag = s-<tmdbId>
// (l'id TMDB brut), news_id = page id d'une saison deja trouvee via search. Retourne
// TOUTES les saisons de la serie (id, title, full_url), y compris celles que search.php
// ne liste pas (ex: Mayans MC -> search ne voit que S4/S5, get_seasons rend S1/S2/S3/S5).
// Fallback quand la saison demandee est absente des resultats search mais existe cote FStream.
async function fetchFStreamSeasonsAjax(tmdbId, newsId, baseUrl) {
  if (!tmdbId || !newsId) return [];
  const apiUrl = `${baseUrl}/engine/ajax/get_seasons.php?serie_tag=s-${tmdbId}&news_id=${newsId}`;

  const proxies = getShuffledAllProxies();
  const maxAttempts = Math.min(proxies.length, 3);
  refreshStep('related_seasons', { url: apiUrl, proxyCount: proxies.length });

  for (let i = 0; i < maxAttempts; i++) {
    const entry = proxies[i];
    try {
      const response = await withFStreamProxy(entry, (agents) => axios({
        method: 'get',
        url: apiUrl,
        timeout: 8000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Referer': `${baseUrl}/`,
          'Accept': 'application/json, text/javascript, */*',
          'X-Requested-With': 'XMLHttpRequest',
          'Cookie': buildFStreamCookieHeader()
        },
        httpAgent: agents.httpAgent, httpsAgent: agents.httpsAgent, proxy: false
      }));

      refreshStep('related_seasons_response', { httpStatus: response.status, proxyType: entry.type, attempt: i + 1 });
      if (response.status === 429) continue;
      if (response.status !== 200 || !response.data) return [];

      const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
      if (!Array.isArray(data)) return [];

      const seasons = data.map(item => {
        const seasonMatch = (item.title || '').match(/Saison\s+(\d+)/i);
        const seasonNumber = seasonMatch ? parseInt(seasonMatch[1], 10) : null;
        const rawUrl = item.full_url || '';
        const link = !rawUrl ? null
          : rawUrl.startsWith('http') ? rawUrl
          : `${baseUrl}/${rawUrl.replace(/^\//, '')}`;
        return { title: item.title || `Saison ${seasonNumber}`, originalTitle: item.title || '', link, seasonNumber, year: null };
      }).filter(r => r.link && r.seasonNumber);
      refreshStep('related_seasons_result', { seasons: seasons.map(item => item.seasonNumber) });
      return seasons;
    } catch (error) {
      refreshStep('related_seasons_error', { proxyType: entry.type, attempt: i + 1 }, error);
      if (error.response?.status === 429) continue;
      console.error(`[FStream] Erreur get_seasons.php (proxy ${entry.type} #${i}): ${error.message}`);
      continue;
    }
  }

  return [];
}

// === Scraping Functions ===
async function scrapeFStreamRecentMovies() {
  refreshStep('recent_movies', { url: `${FSTREAM_BASE_URL}/films/` });
  try {
    const response = await axiosFStreamRequest({
      method: 'get',
      url: `${FSTREAM_BASE_URL}/films/`,
      timeout: 10000
    });

    if (response.status !== 200) throw new Error(`Erreur HTTP: ${response.status}`);
    if (!response.data || typeof response.data !== 'string') throw new Error('La reponse n\'est pas du HTML valide');

    const $ = cheerio.load(response.data);
    const movies = [];

    const dleContent = $('#dle-content');
    let filmElements;

    if (dleContent.length > 0) {
      filmElements = dleContent.find('.short.film');
      if (filmElements.length === 0) filmElements = dleContent.find('div.short.film');
      if (filmElements.length === 0) filmElements = dleContent.find('div[class*="short"][class*="film"]');
      if (filmElements.length === 0) {
        const shortInDle = dleContent.find('.short');
        if (shortInDle.length > 0) filmElements = shortInDle;
      }
    } else {
      filmElements = $('.short.film');
      if (filmElements.length === 0) filmElements = $('div.short.film');
      if (filmElements.length === 0) filmElements = $('div[class*="short"][class*="film"]');
      if (filmElements.length === 0) {
        const allShorts = $('.short');
        if (allShorts.length > 0) filmElements = allShorts;
      }
    }

    filmElements.each((index, element) => {
      try {
        const $el = $(element);
        const titleElement = $el.find('.short-title');
        if (titleElement.length === 0) return;
        const title = titleElement.text().trim();
        if (!title) return;

        const linkElement = $el.find('a.short-poster');
        if (linkElement.length === 0) return;
        const href = linkElement.attr('href');
        if (!href) return;

        const fullLink = href.startsWith('http') ? href
          : href.startsWith('/') ? `${FSTREAM_BASE_URL}${href}`
          : `${FSTREAM_BASE_URL}/${href}`;

        let movieId = null;
        const idMatch = href.match(/(\d+)/);
        if (idMatch) movieId = idMatch[1];

        let trailerId = null;
        if (movieId) {
          let trailerElement = $el.find(`span#trailer-${movieId}`);
          if (trailerElement.length === 0) trailerElement = $(`span#trailer-${movieId}`);
          if (trailerElement.length > 0) trailerId = trailerElement.text().trim();
        }

        let description = null;
        if (movieId) {
          let descElement = $el.find(`span#desc-${movieId}`);
          if (descElement.length === 0) descElement = $(`span#desc-${movieId}`);
          if (descElement.length > 0) description = descElement.text().trim();
        }

        const quality = $el.find('.film-quality a').text().trim() || null;
        const version = $el.find('.film-version a').text().trim() || null;

        const imgElement = $el.find('img');
        let posterUrl = null;
        if (imgElement.length > 0) {
          posterUrl = imgElement.attr('src');
          if (posterUrl && !posterUrl.startsWith('http')) {
            posterUrl = posterUrl.startsWith('/')
              ? `${FSTREAM_BASE_URL}${posterUrl}`
              : `${FSTREAM_BASE_URL}/${posterUrl}`;
          }
        }

        const ratingElement = $el.find('.vote-score');
        let rating = null;
        if (ratingElement.length > 0) {
          const ratingText = ratingElement.text().trim();
          const ratingMatch = ratingText.match(/(\d+\.?\d*)/);
          if (ratingMatch) rating = parseFloat(ratingMatch[1]);
        }

        movies.push({
          title, link: fullLink, id: movieId, trailerId, description,
          quality, version, posterUrl, rating, source: 'fstream_recent'
        });
      } catch (error) {
        console.error(`[FSTREAM RECENT] Erreur lors du parsing d'un film: ${error.message}`);
      }
    });

    return movies;
  } catch (error) {
    refreshStep('recent_movies_error', {}, error);
    console.error(`[FSTREAM RECENT] Erreur lors du scraping: ${error.message}`);
    return [];
  }
}

async function scrapeFStreamRecentSeries() {
  refreshStep('recent_series', { url: `${FSTREAM_BASE_URL}/s-tv/` });
  try {
    const response = await axiosFStreamRequest({
      method: 'get',
      url: `${FSTREAM_BASE_URL}/s-tv/`,
      timeout: 10000
    });

    if (response.status !== 200) throw new Error(`Erreur HTTP: ${response.status}`);

    const $ = cheerio.load(response.data);
    const series = [];
    const seriesElements = $('#dle-content .short.serie');

    seriesElements.each((index, element) => {
      try {
        const $el = $(element);
        const titleElement = $el.find('.short-title');
        if (titleElement.length === 0) return;
        const title = titleElement.text().trim();
        if (!title) return;

        const linkElement = $el.find('a.short-poster');
        if (linkElement.length === 0) return;
        const href = linkElement.attr('href');
        if (!href) return;

        const fullLink = href.startsWith('http') ? href : `${FSTREAM_BASE_URL}${href}`;

        let seriesId = null;
        const idMatch = href.match(/(\d+)/);
        if (idMatch) seriesId = idMatch[1];

        series.push({
          title, link: fullLink, id: seriesId, tmdbId: null, source: 'fstream_recent_series'
        });
      } catch (error) {
        console.error(`[FSTREAM RECENT SERIES] Erreur lors du parsing d'une serie: ${error.message}`);
      }
    });

    return series;
  } catch (error) {
    refreshStep('recent_series_error', {}, error);
    console.error(`[FSTREAM RECENT SERIES] Erreur lors du scraping: ${error.message}`);
    return [];
  }
}

// === Finding Functions ===
async function findMovieInRecentFStream(tmdbTitle, tmdbYear) {
  try {
    const recentMovies = await scrapeFStreamRecentMovies();
    if (recentMovies.length === 0) return null;

    const extractYear = (title) => {
      const yearMatch = title.match(/\((\d{4})\)/);
      return yearMatch ? yearMatch[1] : null;
    };

    const removeYear = (title) => title.replace(/\s*\((\d{4})\)\s*$/, '').trim();

    const normalizeTitle = (str) => {
      if (!str) return '';
      let cleaned = removeYear(str);
      return cleaned.toLowerCase().normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    };

    let yearToMatch = tmdbYear;
    if (!yearToMatch) yearToMatch = extractYear(tmdbTitle);

    const tmdbTitleWithoutYear = removeYear(tmdbTitle);
    const normalizedTmdbTitle = normalizeTitle(tmdbTitleWithoutYear);

    let bestMatch = null;
    let bestSimilarity = 0;

    for (const movie of recentMovies) {
      const normalizedMovieTitle = normalizeTitle(movie.title);
      if (normalizedMovieTitle === normalizedTmdbTitle) return movie;

      const similarity = calculateTitleSimilarity(normalizedTmdbTitle, normalizedMovieTitle);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatch = movie;
      }
    }

    if (bestMatch && bestSimilarity >= 0.7) return bestMatch;

    if (bestMatch && bestSimilarity >= 0.6 && normalizedTmdbTitle.length > 3) {
      const tmdbWords = normalizedTmdbTitle.split(/\s+/).filter(w => w.length > 2);
      const movieWords = normalizeTitle(bestMatch.title).split(/\s+/).filter(w => w.length > 2);
      const allWordsMatch = tmdbWords.length > 0 && (
        tmdbWords.every(word => movieWords.some(mw => mw.includes(word) || word.includes(mw))) ||
        movieWords.every(word => tmdbWords.some(tw => tw.includes(word) || word.includes(tw)))
      );
      if (allWordsMatch) {
        // Verifier que les tokens bruts (sans filtre de longueur) ont un recouvrement suffisant
        const rawTmdbTokens = normalizedTmdbTitle.split(/\s+/).filter(Boolean);
        const rawMovieTokens = new Set(normalizeTitle(bestMatch.title).split(/\s+/).filter(Boolean));
        const rawCoverage = rawTmdbTokens.length > 0 ? rawTmdbTokens.filter(t => rawMovieTokens.has(t)).length / rawTmdbTokens.length : 0;
        if (rawCoverage >= 0.75) return bestMatch;
      }
    }

    return null;
  } catch (error) {
    console.error(`[FSTREAM RECENT] Erreur lors de la recherche: ${error.message}`);
    return null;
  }
}

async function findSeriesInRecentFStream(tmdbTitle, tmdbYear) {
  try {
    const recentSeries = await scrapeFStreamRecentSeries();
    if (recentSeries.length === 0) return null;

    const normalizeTitle = (str) => (str || '')
      .toLowerCase().normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const normalizedTmdbTitle = normalizeTitle(tmdbTitle);

    for (const series of recentSeries) {
      const normalizedSeriesTitle = normalizeTitle(series.title);
      if (normalizedSeriesTitle === normalizedTmdbTitle) return series;
      const similarity = calculateTitleSimilarity(normalizedTmdbTitle, normalizedSeriesTitle);
      if (similarity > 0.8) return series;
    }

    return null;
  } catch (error) {
    console.error(`[FSTREAM RECENT SERIES] Erreur lors de la recherche: ${error.message}`);
    return null;
  }
}

// === API-based extraction helpers ===
function extractPageIdFromUrl(url) {
  if (!url) return null;
  const match = url.match(/\/(\d+)-[^/]+\.html/);
  return match ? match[1] : null;
}

function extractBaseUrlFromLink(url) {
  try {
    const parsed = new URL(canonicalFStreamUrl(url));
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return FSTREAM_BASE_URL;
  }
}

// Construit une liste melangee de proxies SOCKS5 + Darkino HTTP
function getShuffledAllProxies() {
  const all = [];
  // Ajouter les SOCKS5
  if (PROXIES && PROXIES.length > 0) {
    PROXIES.forEach(p => all.push({ proxy: p, type: 'socks5' }));
  }
  // Ajouter les Darkino HTTP
  if (DARKINO_PROXIES && DARKINO_PROXIES.length > 0) {
    DARKINO_PROXIES.forEach(p => all.push({ proxy: p, type: 'darkino' }));
  }
  // Melanger
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all;
}

// Parse le payload episodes FStream (shape commune {vf,vostfr,vo,info}) en map normalisee.
// Partage entre la source statique (<base>/static/series) et l'API dynamique (episodes_p.php).
function normalizeFStreamPlayerUrl(provider, value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  // Les anciennes fiches Uqload stockent un code, pas une URL d'embed.
  if (provider === 'uqload' && /^[a-z0-9]{12}$/i.test(raw)) return `https://uqload.is/embed-${raw.toLowerCase()}.html`;
  return null;
}

function parseEpisodesPayload(data) {
  if (!data || typeof data !== 'object') return null;

  const episodes = {};
  const langMap = { vf: 'VF', vostfr: 'VOSTFR', vo: 'VOENG' };

  for (const [langKey, langLabel] of Object.entries(langMap)) {
    const langData = data[langKey];
    if (!langData || typeof langData !== 'object') continue;

    for (const [epNum, providers] of Object.entries(langData)) {
      const epNumber = parseInt(epNum);
      if (isNaN(epNumber) || epNumber === 0) continue;

      if (!episodes[epNumber]) {
        episodes[epNumber] = {
          number: epNumber,
          title: `Episode ${epNumber}`,
          languages: { VF: [], VOSTFR: [], VOENG: [], Default: [] }
        };
      }

      for (const [provider, rawUrl] of Object.entries(providers || {})) {
        const url = normalizeFStreamPlayerUrl(provider, rawUrl);
        if (!url) continue;
        let displayName = provider;
        if (provider === 'premium') displayName = 'Premium';
        else if (provider === 'vidzy') displayName = 'Vidzy';
        else if (provider === 'uqload') displayName = 'Uqload';
        else if (provider === 'netu') displayName = 'Netu';
        else if (provider === 'voe') displayName = 'Voe';
        else displayName = provider.charAt(0).toUpperCase() + provider.slice(1);

        const exists = episodes[epNumber].languages[langLabel].some(p => p.url === url);
        if (!exists) {
          episodes[epNumber].languages[langLabel].push({ url, type: 'embed', quality: 'HD', player: displayName });
        }
      }
    }
  }

  // Enrichir avec les infos (titres, synopsis) si disponibles
  if (data.info && typeof data.info === 'object') {
    for (const [epNum, info] of Object.entries(data.info)) {
      const epNumber = parseInt(epNum);
      if (episodes[epNumber] && info.title) {
        episodes[epNumber].title = info.title;
      }
    }
  }

  if (Object.keys(episodes).length > 0) return episodes;
  return null;
}

// Source statique prioritaire: <base>/static/series/<id>.js (JSON fige, frais, inclut premium).
// Meme domaine que le lien de recherche (base url), pas un host distinct.
async function fetchEpisodesFromStaticJs(pageUrl) {
  pageUrl = canonicalFStreamUrl(pageUrl);
  const pageId = extractPageIdFromUrl(pageUrl);
  if (!pageId) return null;

  const baseUrl = extractBaseUrlFromLink(pageUrl);
  const apiUrl = `${baseUrl}/static/series/${pageId}.js?v=${Math.floor(Date.now() / 30000)}`;

  const proxies = getShuffledAllProxies();
  const maxAttempts = Math.min(proxies.length, 3);
  let lastError = null;
  refreshStep('static_series', { url: apiUrl, proxyCount: proxies.length });

  for (let i = 0; i < maxAttempts; i++) {
    const entry = proxies[i];
    try {
      const response = await withFStreamProxy(entry, (agents) => axios({
        method: 'get',
        url: apiUrl,
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Referer': pageUrl,
          'Accept': 'application/json, text/javascript, */*',
          'Cookie': buildFStreamCookieHeader()
        },
        httpAgent: agents.httpAgent, httpsAgent: agents.httpsAgent, proxy: false
      }));

      refreshStep('static_series_response', { httpStatus: response.status, proxyType: entry.type, attempt: i + 1 });
      if (response.status === 429) {
        console.log(`[FStream] static series.js: 429 avec proxy ${entry.type} #${i}, retry...`);
        continue;
      }
      if (response.status !== 200 || !response.data) return null;

      const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
      const episodes = parseEpisodesPayload(data);
      refreshStep('static_series_result', { episodes: Object.keys(episodes || {}) });
      return episodes;
    } catch (error) {
      lastError = error;
      refreshStep('static_series_error', { proxyType: entry.type, attempt: i + 1 }, error);
      if (error.response?.status === 429) {
        console.log(`[FStream] static series.js: 429 avec proxy ${entry.type} #${i}, retry...`);
        continue;
      }
      console.error(`[FStream] Erreur static series.js (proxy ${entry.type} #${i}): ${error.message}`);
      continue;
    }
  }

  if (lastError) console.error(`[FStream] static series.js: tous les proxies ont echoue. Derniere erreur: ${lastError.message}`);
  return null;
}

async function fetchEpisodesFromApi(pageUrl) {
  pageUrl = canonicalFStreamUrl(pageUrl);
  const pageId = extractPageIdFromUrl(pageUrl);
  if (!pageId) return null;

  const baseUrl = extractBaseUrlFromLink(pageUrl);
  const apiUrl = `${baseUrl}/engine/ajax/episodes_p.php?id=${pageId}`;

  const proxies = getShuffledAllProxies();
  const maxAttempts = Math.min(proxies.length, 3);
  let lastError = null;
  refreshStep('episodes_api', { url: apiUrl, proxyCount: proxies.length });

  for (let i = 0; i < maxAttempts; i++) {
    const entry = proxies[i];
    try {
      const response = await withFStreamProxy(entry, (agents) => axios({
        method: 'get',
        url: apiUrl,
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Referer': pageUrl,
          'Accept': 'application/json, text/plain, */*',
          'Cookie': buildFStreamCookieHeader()
        },
        httpAgent: agents.httpAgent, httpsAgent: agents.httpsAgent, proxy: false
      }));

      refreshStep('episodes_api_response', { httpStatus: response.status, proxyType: entry.type, attempt: i + 1 });
      if (response.status === 429) {
        console.log(`[FStream] API episodes_p: 429 avec proxy ${entry.type} #${i}, retry...`);
        continue;
      }
      if (response.status !== 200 || !response.data) return null;

      const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
      const episodes = parseEpisodesPayload(data);
      refreshStep('episodes_api_result', { episodes: Object.keys(episodes || {}) });
      return episodes;
    } catch (error) {
      lastError = error;
      refreshStep('episodes_api_error', { proxyType: entry.type, attempt: i + 1 }, error);
      if (error.response?.status === 429) {
        console.log(`[FStream] API episodes_p: 429 avec proxy ${entry.type} #${i}, retry...`);
        continue;
      }
      console.error(`[FStream] Erreur API episodes_p (proxy ${entry.type} #${i}): ${error.message}`);
      continue;
    }
  }

  if (lastError) console.error(`[FStream] API episodes_p: tous les proxies ont echoue. Derniere erreur: ${lastError.message}`);
  return null;
}

async function fetchMoviePlayersFromApi(pageUrl) {
  pageUrl = canonicalFStreamUrl(pageUrl);
  const pageId = extractPageIdFromUrl(pageUrl);
  if (!pageId) return null;

  const baseUrl = extractBaseUrlFromLink(pageUrl);
  const apiUrl = `${baseUrl}/engine/ajax/film_api.php?id=${pageId}`;

  const proxies = getShuffledAllProxies();
  const maxAttempts = Math.min(proxies.length, 3);
  let lastError = null;
  refreshStep('movie_api', { url: apiUrl, proxyCount: proxies.length });

  for (let i = 0; i < maxAttempts; i++) {
    const entry = proxies[i];
    try {
      const response = await withFStreamProxy(entry, (agents) => axios({
        method: 'get',
        url: apiUrl,
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Referer': pageUrl,
          'Accept': 'application/json, text/plain, */*',
          'Cookie': buildFStreamCookieHeader()
        },
        httpAgent: agents.httpAgent, httpsAgent: agents.httpsAgent, proxy: false
      }));

      refreshStep('movie_api_response', { httpStatus: response.status, proxyType: entry.type, attempt: i + 1 });
      if (response.status === 429) {
        console.log(`[FStream] API film_api: 429 avec proxy ${entry.type} #${i}, retry...`);
        continue;
      }
      if (response.status !== 200 || !response.data) return null;

      const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
      if (!data || !data.players || typeof data.players !== 'object') return null;

      const players = [];
      const versionMap = { 'default': 'Default', 'vf': 'VF', 'vfq': 'VFQ', 'vff': 'VFF', 'vostfr': 'VOSTFR' };

      for (const [provider, versions] of Object.entries(data.players)) {
        if (!versions || typeof versions !== 'object') continue;

        for (const [versionKey, url] of Object.entries(versions)) {
          if (!url || typeof url !== 'string') continue;
          let finalUrl = url;
          if (provider === 'netu' && !url.startsWith('http')) {
            finalUrl = `https://www.fembed.com/v/${url}`;
          }
          if (!finalUrl.startsWith('http')) continue;

          let displayName = provider;
          if (provider === 'premium') displayName = 'Premium';
          else if (provider === 'vidzy') displayName = 'Vidzy';
          else if (provider === 'uqload') displayName = 'Uqload';
          else if (provider === 'netu') displayName = 'Netu';
          else if (provider === 'voe') displayName = 'Voe';
          else if (provider === 'dood') displayName = 'Dood';
          else if (provider === 'filmoon') displayName = 'Filmoon';
          else displayName = provider.charAt(0).toUpperCase() + provider.slice(1);

          const version = versionMap[versionKey] || versionKey.toUpperCase();
          players.push({ url: finalUrl, type: 'embed', quality: 'HD', player: displayName, version });
        }
      }

      refreshStep('movie_api_result', { total: players.length });
      if (players.length > 0) {
        return players;
      }
      return null;
    } catch (error) {
      lastError = error;
      refreshStep('movie_api_error', { proxyType: entry.type, attempt: i + 1 }, error);
      if (error.response?.status === 429) {
        console.log(`[FStream] API film_api: 429 avec proxy ${entry.type} #${i}, retry...`);
        continue;
      }
      console.error(`[FStream] Erreur API film_api (proxy ${entry.type} #${i}): ${error.message}`);
      continue;
    }
  }

  if (lastError) console.error(`[FStream] API film_api: tous les proxies ont echoue. Derniere erreur: ${lastError.message}`);
  return null;
}

// === High-level wrappers: API-first, HTML fallback ===
// Bypass le fetch HTML (souvent 429) en appelant l'API directe d'abord
async function getSeriesPlayersForUrl(pageUrl) {
  refreshStep('series_players', { url: pageUrl });
  // 1. Source statique <base>/static/series/<id>.js (prioritaire: fraiche, premium, inclut tous les eps)
  let apiEpisodes = await fetchEpisodesFromStaticJs(pageUrl);

  // 2. Fallback: API dynamique episodes_p.php (si la statique 404/echoue ou host a tourne)
  const hasPlayers = episodes => Object.values(episodes || {}).some(episode =>
    Object.values(episode.languages || {}).some(players => players.length > 0));
  if (!hasPlayers(apiEpisodes)) {
    apiEpisodes = await fetchEpisodesFromApi(pageUrl);
  }

  if (hasPlayers(apiEpisodes)) {
    const organizedPlayers = { VF: [], VOSTFR: [], VOENG: [], Default: [] };
    let totalPlayers = 0;
    Object.values(apiEpisodes).forEach(episode => {
      Object.entries(episode.languages).forEach(([lang, players]) => {
        if (players.length > 0) {
          if (organizedPlayers[lang]) organizedPlayers[lang].push(...players);
          totalPlayers += players.length;
        }
      });
    });
    return { organized: organizedPlayers, episodes: apiEpisodes, total: totalPlayers, fstreamReleaseDate: null, fromApi: true };
  }

  // 3. Fallback: fetch HTML de la fiche.
  console.log(`[FStream] getSeriesPlayersForUrl: sources JSON echouees, fallback HTML pour ${pageUrl}`);
  refreshStep('series_html', { url: pageUrl });
  const contentResponse = await axiosFStreamRequest({ method: 'get', url: pageUrl });
  refreshStep('series_html_response', { httpStatus: contentResponse.status });
  if (contentResponse.status !== 200) return { organized: { VF: [], VOSTFR: [], VOENG: [], Default: [] }, episodes: {}, total: 0, fstreamReleaseDate: null };
  return await extractFStreamPlayers(contentResponse.data, true, pageUrl);
}

async function getMoviePlayersForUrl(pageUrl) {
  refreshStep('movie_players', { url: pageUrl });
  // 1. API directe
  const apiPlayers = await fetchMoviePlayersFromApi(pageUrl);
  if (apiPlayers && apiPlayers.length > 0) {
    const uniquePlayers = [];
    const seenUrls = new Set();
    apiPlayers.forEach(player => {
      if (!seenUrls.has(player.url)) { seenUrls.add(player.url); uniquePlayers.push(player); }
    });
    const organized = { VFQ: [], VFF: [], VOSTFR: [], Default: [] };
    uniquePlayers.forEach(player => {
      const version = (player.version && organized[player.version]) ? player.version : 'Default';
      organized[version].push({ url: player.url, type: player.type, quality: player.quality, player: player.player || 'Lecteur' });
    });
    return { organized, total: uniquePlayers.length, fromApi: true };
  }

  // 2. Fallback: fetch HTML
  console.log(`[FStream] getMoviePlayersForUrl: API echouee, fallback HTML pour ${pageUrl}`);
  refreshStep('movie_html', { url: pageUrl });
  const contentResponse = await axiosFStreamRequest({ method: 'get', url: pageUrl });
  refreshStep('movie_html_response', { httpStatus: contentResponse.status });
  if (contentResponse.status !== 200) return { organized: { VFQ: [], VFF: [], VOSTFR: [], Default: [] }, total: 0 };
  return await extractFStreamPlayers(contentResponse.data, false, pageUrl);
}

// Une fiche déjà validée permet de rafraîchir les épisodes même si le titre
// TMDB change et que la recherche FStream ne reconnaît plus ce nouveau nom.
async function refreshCachedFStreamSeries(cachedData, id, season, episode) {
  const bestMatch = cachedData?.search?.bestMatch;
  if (cachedData?.success !== true || !(Number(cachedData.total) > 0)
      || String(cachedData.tmdb?.id) !== String(id)
      || Number(bestMatch?.seasonNumber) !== Number(season)
      || !isFStreamCachedSelectionValid(cachedData, season)) return null;

  let pageUrl;
  try {
    const url = new URL(canonicalFStreamUrl(bestMatch.link));
    if (url.origin !== FSTREAM_BASE_URL || url.username || url.password
        || !extractPageIdFromUrl(url.href)) return null;
    pageUrl = url.href;
  } catch { return null; }

  refreshStep('cached_series_page', { url: pageUrl, title: bestMatch.title, season });
  try {
    let identity = cachedData.metadata?.identity;
    let tmdb = cachedData.tmdb;
    let seasonYear = cachedData.metadata?.seasonYear;
    if (!identity?.accepted) {
      const [details, seasonData, page] = await Promise.all([
        getFStreamTMDBDetails(id, 'tv'), fetchTmdbSeason(TMDB_API_URL, TMDB_API_KEY, id, season),
        axiosFStreamRequest({ method: 'get', url: pageUrl, timeout: 10000 }),
      ]);
      if (!details || page.status !== 200) return null;
      const verifier = createIdentityVerifier({ apiUrl: TMDB_API_URL, apiKey: TMDB_API_KEY,
        type: 'tv', details, seasonData });
      identity = await verifier.verify(parseSourceIdentity(page.data), { season });
      refreshStep('cached_series_identity', identity);
      if (!identity.accepted) return null;
      identity = { ...identity, tmdbId: details.id };
      tmdb = details;
      seasonYear = yearOf(seasonData?.air_date);
    }
    const players = await getSeriesPlayersForUrl(pageUrl);
    if (players.total === 0) {
      refreshStep('cached_series_page_empty', { url: pageUrl });
      return null;
    }
    const tmdbYear = tmdb.release_date?.split('-')[0];
    const sourceYear = players.fromApi ? bestMatch.year : players.fstreamReleaseDate;
    const acceptedYears = [Number(tmdbYear), Number(seasonYear)].filter(Boolean);
    if (!identity?.accepted && sourceYear && acceptedYears.length
        && !acceptedYears.includes(Number(sourceYear))) {
      refreshStep('cached_series_page_year_mismatch', { tmdbYear, sourceYear });
      return null;
    }

    return {
      ...cachedData,
      tmdb,
      search: { ...cachedData.search, bestMatch: { ...bestMatch, link: pageUrl } },
      episodes: players.episodes, total: players.total,
      metadata: {
        ...cachedData.metadata,
        identity, seasonYear,
        season: parseInt(season, 10), episode: episode ? parseInt(episode, 10) : null,
        extractedAt: new Date().toISOString(), backgroundUpdate: true,
        refreshMethod: 'cached_page', fstreamReleaseDate: players.fstreamReleaseDate,
        dateValidation: { fstreamYear: players.fstreamReleaseDate, tmdbYear, isAvailable: true },
      },
    };
  } catch (error) {
    refreshStep('cached_series_page_error', { url: pageUrl }, error);
    return null;
  }
}

// === Player Extraction ===
async function extractFStreamPlayers(htmlContent, isSeries = false, pageUrl = null) {
  try {
    const $ = cheerio.load(htmlContent);
    let players = [];

    if (isSeries) {
      return await extractFStreamSeriesPlayers(htmlContent, pageUrl);
    } else {
      // Methode API (la plus fiable)
      if (pageUrl) {
        const apiPlayers = await fetchMoviePlayersFromApi(pageUrl);
        if (apiPlayers && apiPlayers.length > 0) {
          players = apiPlayers;
        }
      }

      // Pour les films - extraction via #film-data
      const filmData = $('#film-data');
      if (players.length === 0 && filmData.length > 0) {
        const providers = ['premium', 'vidzy', 'uqload', 'dood', 'voe', 'filmoon', 'netu'];
        providers.forEach(provider => {
          const versions = { 'vostfr': 'VOSTFR', 'vff': 'VFF', 'vfq': 'VFQ', '': 'Default' };
          Object.entries(versions).forEach(([suffix, label]) => {
            const attr = `data-${provider}${suffix}`;
            const value = filmData.attr(attr);
            if (value && value.trim() !== '') {
              let url = value;
              if (provider === 'netu' && !value.startsWith('http')) {
                url = `https://www.fembed.com/v/${value}`;
              }
              if (url.startsWith('http')) {
                players.push({ url, type: 'embed', quality: 'HD', player: provider, version: label });
              }
            }
          });
        });
      }

      // Fallback: script parsing
      if (players.length === 0) {
        const scriptContent = $('script').text();
        const playerUrlsMatch = scriptContent.match(/var\s+playerUrls\s*=\s*({[\s\S]*?});/);
        if (playerUrlsMatch && playerUrlsMatch[1]) {
          try {
            const playerUrlsStr = playerUrlsMatch[1];
            const playerPattern = /"([^"]+)":\s*{([^}]+)}/g;
            let playerMatch;
            while ((playerMatch = playerPattern.exec(playerUrlsStr)) !== null) {
              const playerName = playerMatch[1];
              const versionsStr = playerMatch[2];
              const versionPattern = /"([^"]+)":\s*"([^"]*)"/g;
              let versionMatch;
              while ((versionMatch = versionPattern.exec(versionsStr)) !== null) {
                const version = versionMatch[1];
                const url = versionMatch[2];
                if (url && url.trim() !== '') {
                  players.push({ url, type: 'embed', quality: 'HD', player: playerName, version });
                }
              }
            }
            if (players.length === 0) {
              const urlPattern = /"([^"]+)":\s*"([^"]+)"/g;
              let match;
              while ((match = urlPattern.exec(playerUrlsStr)) !== null) {
                const key = match[1];
                const url = match[2];
                if (url && url.includes('http') && !key.includes('Default') && !key.includes('VFQ') && !key.includes('VFF') && !key.includes('VOSTFR')) {
                  players.push({ url, type: 'embed', quality: 'HD', player: key });
                }
              }
            }
          } catch (parseError) {
            console.error('Erreur lors du parsing de playerUrls:', parseError.message);
          }
        }

        if (players.length === 0) {
          const urlPattern = /https?:\/\/[^\s"']+/g;
          const urls = scriptContent.match(urlPattern);
          if (urls) {
            urls.forEach(url => {
              if (url.includes('embed') || url.includes('player')) {
                players.push({ url, type: 'embed', quality: 'HD' });
              }
            });
          }
        }
      }

      // Fallback: iframes
      if (players.length === 0) {
        $('iframe[src], a[href*="embed"], a[href*="player"]').each((_, element) => {
          const $el = $(element);
          const src = $el.attr('src') || $el.attr('href');
          if (src && !src.includes('episodes-suivant')) {
            players.push({
              url: src.startsWith('http') ? src : `${FSTREAM_BASE_URL}${src}`,
              type: 'embed', quality: 'HD'
            });
          }
        });
      }
    }

    // Deduplicate and organize
    const uniquePlayers = [];
    const seenUrls = new Set();
    players.forEach(player => {
      if (!seenUrls.has(player.url)) {
        seenUrls.add(player.url);
        uniquePlayers.push(player);
      }
    });

    const organizedPlayers = { VFQ: [], VFF: [], VOSTFR: [], Default: [] };
    uniquePlayers.forEach(player => {
      const version = (player.version && organizedPlayers[player.version]) ? player.version : 'Default';
      organizedPlayers[version].push({
        url: player.url, type: player.type, quality: player.quality, player: player.player || 'Lecteur'
      });
    });

    return { organized: organizedPlayers, total: uniquePlayers.length };
  } catch (error) {
    refreshStep('movie_parse_error', { url: pageUrl }, error);
    console.error(`Erreur lors de l'extraction des lecteurs FStream: ${error.message}`);
    return { organized: { VFQ: [], VFF: [], VOSTFR: [], Default: [] }, total: 0 };
  }
}

async function extractFStreamSeriesPlayers(htmlContent, pageUrl = null) {
  try {
    const $ = cheerio.load(htmlContent);
    let episodes = {};

    // Extract release date (toujours depuis le HTML)
    let fstreamReleaseDate = null;
    const selectors = [
      'html body div:nth-child(2) div div:nth-child(2) article div:nth-child(2) div:nth-child(1) div:nth-child(1) div:nth-child(1) span:nth-child(2)',
      'span.release', 'div[class*="release"] span', 'article div span[class*="release"]',
      'div[class*="info"] span[class*="release"]', 'div[class*="meta"] span[class*="release"]'
    ];
    for (const selector of selectors) {
      const releaseSpan = $(selector);
      if (releaseSpan.length > 0) {
        const releaseText = releaseSpan.text().trim();
        const yearMatch = releaseText.match(/(\d{4})/);
        if (yearMatch) { fstreamReleaseDate = yearMatch[1]; break; }
      }
    }
    if (!fstreamReleaseDate) {
      const allText = $.text();
      const yearMatches = allText.match(/(\d{4})\s*-\s*/g);
      if (yearMatches && yearMatches.length > 0) {
        const firstYear = yearMatches[0].match(/(\d{4})/)[1];
        if (parseInt(firstYear) >= 1900 && parseInt(firstYear) <= new Date().getFullYear() + 2) {
          fstreamReleaseDate = firstYear;
        }
      }
    }

    // Methode API (la plus fiable)
    let foundEpisodesData = false;
    if (pageUrl) {
      const apiEpisodes = await fetchEpisodesFromApi(pageUrl);
      if (apiEpisodes) {
        Object.assign(episodes, apiEpisodes);
        foundEpisodesData = true;
      }
    }

    // New method: HTML IDs
    if (!foundEpisodesData) try {
      const versionMap = {
        '#episodes-vf-data': 'VF',
        '#episodes-vostfr-data': 'VOSTFR',
        '#episodes-vo-data': 'VOENG'
      };
      for (const [selector, langKey] of Object.entries(versionMap)) {
        const container = $(selector);
        if (container.length > 0) {
          container.children('div').each((_, element) => {
            const $el = $(element);
            const epNumStr = $el.attr('data-ep');
            if (!epNumStr) return;
            const epNum = parseInt(epNumStr);
            if (isNaN(epNum) || epNum === 0) return;

            const attributes = {
              'data-premium': 'FSvid', 'data-vidzy': 'Vidzy',
              'data-uqload': 'Uqload', 'data-netu': 'Netu', 'data-voe': 'Voe'
            };
            const playersToAdd = [];
            Object.entries(attributes).forEach(([attr, playerName]) => {
              const url = $el.attr(attr);
              if (url && url.startsWith('http')) {
                playersToAdd.push({ url, type: 'embed', quality: 'HD', player: playerName });
              }
            });

            if (playersToAdd.length > 0) {
              if (!episodes[epNum]) {
                episodes[epNum] = { number: epNum, title: `Episode ${epNum}`, languages: { VF: [], VOSTFR: [], VOENG: [], Default: [] } };
              }
              playersToAdd.forEach(player => {
                const exists = episodes[epNum].languages[langKey].some(p => p.url === player.url);
                if (!exists) episodes[epNum].languages[langKey].push(player);
              });
            }
          });
          if (Object.keys(episodes).length > 0) foundEpisodesData = true;
        }
      }
      if (foundEpisodesData) {
        // Donnees trouvees via les IDs HTML
      }
    } catch (newMethodError) {
      console.error(`[FStream] Erreur nouvelle methode extraction: ${newMethodError.message}`);
    }

    // Legacy: episodesData from script
    if (!foundEpisodesData) $('script').each((_, scriptEl) => {
      const scriptContent = $(scriptEl).html() || '';
      const episodesDataMatch = scriptContent.match(/var\s+episodesData\s*=\s*(\{[\s\S]*?\});(?:\s*var|\s*\n\s*var|\s*\n\s*\n)/);
      if (episodesDataMatch && episodesDataMatch[1]) {
        try {
          let jsonStr = episodesDataMatch[1];
          const vfMatch = jsonStr.match(/vf:\s*\{([\s\S]*?)\},\s*(?:vostfr|vo):/);
          const vostfrMatch = jsonStr.match(/vostfr:\s*\{([\s\S]*?)\},\s*vo:/);
          const voMatch = jsonStr.match(/vo:\s*\{([\s\S]*?)\}\s*\}/);

          const parseLanguageEpisodes = (langContent, langKey) => {
            if (!langContent) return;
            const episodePattern = /(\d+):\s*\{([^}]+)\}/g;
            let epMatch;
            while ((epMatch = episodePattern.exec(langContent)) !== null) {
              const epNum = parseInt(epMatch[1]);
              const playersContent = epMatch[2];
              if (!episodes[epNum]) {
                episodes[epNum] = { number: epNum, title: `Episode ${epNum}`, languages: { VF: [], VOSTFR: [], VOENG: [], Default: [] } };
              }
              const playerPattern = /(\w+):"([^"]+)"/g;
              let playerMatch;
              while ((playerMatch = playerPattern.exec(playersContent)) !== null) {
                const playerName = playerMatch[1];
                const playerUrl = playerMatch[2];
                if (!playerUrl || playerUrl.includes('&#91;') || playerUrl.includes('xfvalue_')) continue;
                let displayName = playerName.toUpperCase();
                if (playerName === 'vidzy') displayName = 'Vidzy';
                else if (playerName === 'uqload') displayName = 'Uqload';
                else if (playerName === 'netu') displayName = 'Netu';
                else if (playerName === 'voe') displayName = 'Voe';
                else if (playerName === 'premium') displayName = 'Premium';
                const player = { url: playerUrl, type: 'embed', quality: 'HD', player: displayName };
                const targetLang = langKey === 'vo' ? 'VOENG' : (langKey === 'vostfr' ? 'VOSTFR' : 'VF');
                const exists = episodes[epNum].languages[targetLang].some(p => p.url === playerUrl);
                if (!exists) episodes[epNum].languages[targetLang].push(player);
              }
            }
          };

          if (vfMatch && vfMatch[1]) parseLanguageEpisodes(vfMatch[1], 'vf');
          if (vostfrMatch && vostfrMatch[1]) parseLanguageEpisodes(vostfrMatch[1], 'vostfr');
          if (voMatch && voMatch[1]) parseLanguageEpisodes(voMatch[1], 'vo');

          foundEpisodesData = Object.keys(episodes).length > 0;
          if (foundEpisodesData) {
            console.log(`[FStream] Parsed episodesData: ${Object.keys(episodes).length} episodes found`);
          }
        } catch (parseError) {
          console.error('[FStream] Erreur parsing episodesData:', parseError.message);
        }
      }
    });

    // Legacy HTML method
    if (!foundEpisodesData) {
      console.log('[FStream] episodesData non trouve, utilisation de la methode legacy...');
      $('div.fullsfeature').each((_, element) => {
        const $episode = $(element);
        const titleSpan = $episode.find('.selink span').first();
        const episodeTitle = titleSpan.text().trim();
        if (!episodeTitle || episodeTitle.trim() === '') return;

        let language = 'Default';
        if (episodeTitle.toLowerCase().includes('vostfr')) language = 'VOSTFR';
        else if (episodeTitle.toLowerCase().includes('vf')) language = 'VFF';

        const episodeMatch = episodeTitle.match(/episode\s+(\d+)/i);
        const episodeNumber = episodeMatch ? parseInt(episodeMatch[1]) : 1;
        const episodePlayers = [];
        $episode.find('ul.btnss a.fsctab').each((_, linkElement) => {
          const $link = $(linkElement);
          const href = $link.attr('href');
          const playerName = $link.text().trim();
          if (href && href.startsWith('http') && !href.includes('episodes-suivant')) {
            episodePlayers.push({ url: href, type: 'embed', quality: 'HD', player: playerName });
          }
        });

        if (episodePlayers.length > 0) {
          if (!episodes[episodeNumber]) {
            episodes[episodeNumber] = { number: episodeNumber, title: episodeTitle, languages: { VF: [], VOSTFR: [], VOENG: [], Default: [] } };
          }
          const langKey = language === 'VOSTFR' ? 'VOSTFR' : 'VF';
          episodes[episodeNumber].languages[langKey] = episodePlayers;
        }
      });

      $('div.elink a.fstab').each((_, linkElement) => {
        const $link = $(linkElement);
        const href = $link.attr('href');
        const linkText = $link.text().trim();
        if (!href || !href.startsWith('http') || linkText.trim() === '') return;

        const episodeMatch = linkText.match(/episode\s+(\d+)/i);
        if (!episodeMatch) return;
        const episodeNumber = parseInt(episodeMatch[1]);

        let language = 'Default';
        const lowerText = linkText.toLowerCase();
        if (lowerText.includes('vosteng') || lowerText.includes('voeng')) language = 'VOENG';
        else if (lowerText.includes('vostfr')) language = 'VOSTFR';
        else if (lowerText.includes('vf')) language = 'VFF';

        let playerName = 'Unknown';
        if (href.includes('fsvid.lol')) playerName = 'FSvid';
        else if (href.includes('vidzy.org')) playerName = 'Vidzy';
        else if (href.includes('uqload')) playerName = 'Uqload';
        else if (href.includes('voe.sx')) playerName = 'Voe';

        const player = { url: href, type: 'embed', quality: 'HD', player: playerName };
        if (!episodes[episodeNumber]) {
          episodes[episodeNumber] = { number: episodeNumber, title: linkText, languages: { VF: [], VOSTFR: [], VOENG: [], Default: [] } };
        }
        const langKey = language === 'VOENG' ? 'VOENG' : (language === 'VOSTFR' ? 'VOSTFR' : 'VF');
        const existingPlayer = episodes[episodeNumber].languages[langKey].find(p => p.url === href);
        if (!existingPlayer) episodes[episodeNumber].languages[langKey].push(player);
      });
    }

    // Organize by language
    const organizedPlayers = { VF: [], VOSTFR: [], VOENG: [], Default: [] };
    let totalPlayers = 0;
    Object.values(episodes).forEach(episode => {
      Object.entries(episode.languages).forEach(([lang, players]) => {
        if (players.length > 0) {
          organizedPlayers[lang].push(...players);
          totalPlayers += players.length;
        }
      });
    });

    return { organized: organizedPlayers, episodes, total: totalPlayers, fstreamReleaseDate };
  } catch (error) {
    refreshStep('series_parse_error', { url: pageUrl }, error);
    console.error(`Erreur lors de l'extraction des lecteurs serie FStream: ${error.message}`);
    return { organized: { VF: [], VOSTFR: [], VOENG: [], Default: [] }, episodes: {}, total: 0, fstreamReleaseDate: null };
  }
}

// === Filtering ===
function parseFStreamCandidates(html) {
  const $ = cheerio.load(repairFStreamSearchHtml(html));
  const candidates = [];
  $('div.search-item').each((_, node) => {
    const row = $(node), title = row.find('.search-title').text().trim();
    const path = row.attr('onclick')?.match(/location\.href=['"]([^'"]+)['"]/)?.[1];
    if (!title || !path) return;
    let link;
    try {
      const url = new URL(canonicalFStreamUrl(new URL(path, FSTREAM_BASE_URL).href));
      if (url.origin !== FSTREAM_BASE_URL || url.username || url.password) return;
      link = url.href;
    } catch { return; }
    const seasonMatch = title.match(/saison\s+(\d+)/i);
    const seasonNumber = seasonMatch ? Number(seasonMatch[1]) : null;
    const year = yearOf(title.match(/\((\d{4})\)/)?.[1] || link.match(/-(\d{4})\.html/)?.[1]);
    candidates.push({ title: baseTitle(title), originalTitle: title, link, seasonNumber, year,
      poster: row.find('img').first().attr('src') });
  });
  return candidates;
}

async function findValidatedFStream(tmdb, type, season, seasonData) {
  const verifier = createIdentityVerifier({ apiUrl: TMDB_API_URL, apiKey: TMDB_API_KEY, type,
    details: tmdb, english: { title: tmdb.name_no_lang, overview: tmdb.overview_en }, seasonData });
  const queried = new Set(), visited = new Set(), rejected = new Set(), related = [];
  let candidateCount = 0, pageChecks = 0, lastError = null, confirmedWithoutPlayers = false;
  let titles = verifier.titles;
  const inspect = async candidate => {
    if (!candidate?.link || visited.has(candidate.link)) return null;
    try {
      const url = new URL(canonicalFStreamUrl(candidate.link));
      if (url.origin !== FSTREAM_BASE_URL || url.username || url.password) return null;
      candidate = { ...candidate, link: url.href };
    } catch { return null; }
    if (type === 'tv' && (candidate.seasonNumber == null || Number(candidate.seasonNumber) !== Number(season))) return null;
    if (type === 'movie' && candidate.seasonNumber != null) return null;
    visited.add(candidate.link);
    const source = { titles: [candidate.title, candidate.originalTitle], type,
      season: candidate.seasonNumber, year: candidate.year, posters: [candidate.poster].filter(Boolean) };
    let identity = await verifier.verify(source, { enrich: false, season });
    if (!identity.accepted) {
      if (pageChecks >= 8) return null;
      pageChecks++;
      try {
        const page = await axiosFStreamRequest({ method: 'get', url: candidate.link, timeout: 10000 });
        if (page.status !== 200) throw Object.assign(new Error('Fiche FStream indisponible'), { response: { status: page.status } });
        const metadata = parseSourceIdentity(page.data);
        identity = await verifier.verify({ ...metadata,
          posters: [...metadata.posters, ...source.posters],
          season: metadata.season ?? source.season, year: metadata.year ?? source.year,
        }, { season });
      } catch (error) {
        lastError = error;
        refreshStep('candidate_fetch_error', { url: candidate.link }, error);
        return null;
      }
    }
    refreshStep('candidate_identity', { title: candidate.title, url: candidate.link, ...identity });
    if (!identity.accepted) {
      rejected.add(candidate.link);
      return null;
    }
    const players = type === 'tv' ? await getSeriesPlayersForUrl(candidate.link) : await getMoviePlayersForUrl(candidate.link);
    if (!(players.total > 0)) {
      confirmedWithoutPlayers = true;
      refreshStep('candidate_empty', { url: candidate.link });
      return null;
    }
    return { candidate, players, identity: { ...identity, tmdbId: tmdb.id }, candidateCount };
  };
  for (let pass = 0; pass < 2; pass++) {
    if (pass) titles = await verifier.aliases();
    const queries = searchTitles(titles).flatMap(title => type === 'tv' ? [`${title} - Saison ${season}`, title] : [title]);
    for (const query of queries) {
      if (queried.has(query) || queried.size >= 14) continue;
      queried.add(query);
      for (let page = 1; page <= 2; page++) {
        let candidates;
        try { candidates = parseFStreamCandidates(await searchFStreamDirect(query, page)); }
        catch (error) { lastError = error; refreshStep('search_error', { query, page }, error); break; }
        candidateCount += candidates.length;
        const score = item => Math.max(...titles.map(title => titleSimilarity(title, item.title)));
        candidates.sort((a, b) => score(b) - score(a));
        refreshStep('search_filter', { query, page, results: candidates.length,
          titleCandidates: candidates.filter(item => score(item) >= 0.3).length });
        for (const candidate of candidates) {
          if (score(candidate) < 0.3) continue;
          if (type === 'tv' && (candidate.seasonNumber == null || Number(candidate.seasonNumber) !== Number(season))) {
            if (score(candidate) >= 0.7 && !related.some(item => item.link === candidate.link)) related.push(candidate);
            continue;
          }
          const found = await inspect(candidate);
          if (found) return { ...found, query };
        }
        if (candidates.length < 15) break;
      }
    }
  }
  if (type === 'tv') {
    for (const candidate of related.slice(0, 2)) {
      const seasons = await fetchFStreamSeasonsAjax(tmdb.id, extractPageIdFromUrl(candidate.link), FSTREAM_BASE_URL);
      for (const item of seasons.filter(item => item.seasonNumber === Number(season))) {
        const found = await inspect(item);
        if (found) return { ...found, query: tmdb.title };
      }
    }
    const releaseAgeMs = Date.now() - Date.parse(seasonData?.air_date || tmdb.release_date);
    if (releaseAgeMs >= 0 && releaseAgeMs <= 2 * 24 * 60 * 60 * 1000) {
      const recent = await findSeriesInRecentFStream(tmdb.title, tmdb.release_date?.split('-')[0]);
      if (recent) {
        const recentSeason = recent.title.match(/saison\s+(\d+)/i);
        const found = await inspect({ ...recent, originalTitle: recent.title,
          seasonNumber: recentSeason ? Number(recentSeason[1]) : null, year: null });
        if (found) return { ...found, query: tmdb.title };
      }
    }
  } else {
    const recent = await findMovieInRecentFStream(tmdb.title, tmdb.release_date?.split('-')[0]);
    if (recent) {
      const found = await inspect({ ...recent, originalTitle: recent.title, year: yearOf(recent.year), seasonNumber: null });
      if (found) return { ...found, query: tmdb.title };
    }
  }
  if (lastError) throw lastError;
  return { failureCode: confirmedWithoutPlayers ? 'extraction_empty' : 'content_not_found', rejected };
}

async function loadFStreamContent(type, id, season, cachedData) {
  if (type === 'tv') {
    const refreshed = await refreshCachedFStreamSeries(cachedData, id, season, null);
    if (refreshed) return refreshed;
  }
  const [tmdb, seasonData] = await Promise.all([
    getFStreamTMDBDetails(id, type),
    type === 'tv' ? fetchTmdbSeason(TMDB_API_URL, TMDB_API_KEY, id, season) : null,
  ]);
  // fetchTmdbDetails renvoie aussi null lors d'une panne : ne pas en faire un négatif durable.
  if (!tmdb) throw Object.assign(new Error('Métadonnées TMDB indisponibles'), { code: 'TMDB_UNAVAILABLE' });
  const found = await findValidatedFStream(tmdb, type, season, seasonData);
  const cachedLink = cachedData?.search?.bestMatch?.link;
  if (!found.candidate && cachedLink && found.rejected?.has(canonicalFStreamUrl(cachedLink))) {
    // La fiche en cache vient d'être réfutée (homonyme : « Kraken » norvégien
    // servi pour le film français) : le cache ne doit plus la servir.
    refreshStep('cached_selection_refuted', { url: cachedLink });
    await invalidateFStreamCache(generateFStreamCacheKey(type, id, season ?? null));
  }
  if (!found.candidate) return uncachedFStreamResponse(404, {
    success: false, source: 'FStream', type, code: found.failureCode,
    error: 'Aucune fiche FStream utilisable après recherche et vérification',
    tmdb, ...(type === 'tv' ? { episodes: {}, metadata: { season: Number(season) } } : {}), total: 0,
  });
  const { candidate, players, identity } = found;
  return {
    success: true, source: 'FStream', type, tmdb,
    search: { query: found.query, results: found.candidateCount, bestMatch: candidate },
    ...(type === 'tv' ? { episodes: players.episodes } : { players: players.organized }), total: players.total,
    metadata: { extractedAt: new Date().toISOString(), backgroundUpdate: Boolean(cachedData), identity,
      ...(type === 'tv' ? { season: Number(season), episode: null, seasonYear: yearOf(seasonData?.air_date) } : {}),
      dateValidation: { tmdbYear: yearOf(tmdb.release_date), fstreamYear: candidate.year, isAvailable: true },
    },
  };
}

async function serveFStream(req, res, type) {
  const { id, season } = req.params;
  const episode = req.query.episode;
  if (!/^[1-9]\d*$/.test(id) || type === 'tv' && (!/^\d+$/.test(season)
      || episode != null && (typeof episode !== 'string' || !/^[1-9]\d*$/.test(episode)))) {
    return res.status(400).json({ success: false, code: 'invalid_tmdb_request', error: 'Identifiant TMDB, saison ou épisode invalide' });
  }
  // Une seule récupération des liens bruts par saison. La résolution vidéo reste par épisode.
  const cacheKey = generateFStreamCacheKey(type, id, season ?? null);
  const valid = data => type !== 'tv' || isFStreamCachedSelectionValid(data, season);
  const respond = data => {
    const payload = type === 'tv' ? { ...data, metadata: { ...data.metadata, episode: episode ? Number(episode) : null } } : data;
    return type === 'tv' ? respondWithEpisodeSources(req, res, payload) : respondWithMovieSources(req, res, payload);
  };
  try {
    const state = await getFStreamRefreshInfo(cacheKey);
    let cachedData = state.entry?.data;
    if (!cachedData && type === 'tv' && episode) {
      // Migration progressive des anciens caches par épisode, sans supprimer de liens.
      cachedData = (await getFStreamRefreshInfo(generateFStreamCacheKey(type, id, season, episode))).entry?.data;
    }
    if (!(cachedData?.success && cachedData.total > 0 && valid(cachedData))) cachedData = null;
    const refresh = () => getOrCreateFStreamRequest(cacheKey, () => withRefreshDiagnostics({
      source: 'FStream', cacheKey, type, id, season, episode, background: Boolean(cachedData),
    }, redis, () => refreshFStreamCache(cacheKey, () => loadFStreamContent(type, id, season, cachedData), valid)));
    if (cachedData) {
      await respond(cachedData);
      if (!state.isFresh || !state.entry) setImmediate(() => { void refresh().catch(() => {}); });
      return;
    }
    const result = await refresh();
    if (result?.__fstreamResponse) return res.status(result.status).json(result.body);
    if (!result) return res.status(503).json({ success: false, code: 'source_temporarily_unavailable', error: 'FStream temporairement indisponible' });
    await respond(result);
  } catch (error) {
    console.error(`[FSTREAM ${type.toUpperCase()}] Erreur pour ${id}: ${error.message}`);
    res.status(503).json({ success: false, code: 'source_temporarily_unavailable', error: 'Sources FStream temporairement indisponibles' });
  }
}

router.get('/movie/:id', (req, res) => serveFStream(req, res, 'movie'));
router.get('/tv/:id/season/:season', (req, res) => serveFStream(req, res, 'tv'));

// GET /test/recent
router.get('/test/recent', async (req, res) => {
  try {
    const recentMovies = await scrapeFStreamRecentMovies();
    res.status(200).json({ success: true, count: recentMovies.length, movies: recentMovies.slice(0, 10), timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, timestamp: new Date().toISOString() });
  }
});

// GET /test/recent-series
router.get('/test/recent-series', async (req, res) => {
  try {
    const recentSeries = await scrapeFStreamRecentSeries();
    res.status(200).json({ success: true, count: recentSeries.length, series: recentSeries.slice(0, 10), timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, timestamp: new Date().toISOString() });
  }
});

// GET /debug/ongoing
router.get('/debug/ongoing', async (req, res) => {
  try {
    const ongoingKeys = Array.from(ongoingFStreamRequests.keys());
    res.status(200).json({ success: true, ongoingRequests: ongoingKeys.length, keys: ongoingKeys, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
