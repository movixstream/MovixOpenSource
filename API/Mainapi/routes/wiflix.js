/**
 * Wiflix routes.
 * Extracted from server.js -- Wiflix search, player extraction, and routes.
 * Mount point: app.use('/api/wiflix', router)
 */

const express = require("express");
const router = express.Router();
const axios = require("axios");
const cheerio = require("cheerio");
const path = require("path");
const fsp = require("fs").promises;

const { redis } = require("../config/redis");
const { reportRefreshFailure, refreshStep, withRefreshDiagnostics } = require("../utils/sourceRefreshTelemetry");
const { createIdentityVerifier, parseSourceIdentity, searchTitles } = require("../utils/sourceIdentity");
const {
  generateCacheKey,
  saveToCache,
} = require("../utils/cacheManager");
const {
  makeWiflixRequest,
  makeWiflixSearchRequest,
  runWithWiflixPriority,
} = require("../utils/proxyManager");
const { acquireRedisLock } = require("../utils/redisLock");
const { createWiflixRefreshState } = require("../utils/wiflixRefreshState");
// Un titre absent de Flemmix (cache négatif confirmé) est recherché à nouveau
// après 6 h, pas 30 min : la plupart des visites portent sur des titres que le
// site n'a pas, et chacune relançait une recherche complète (accueil + POST,
// ~40 Ko d'HTML par requête). Rapport du 2026-10-19 : ~1 700 recherches par
// minute pour ~400 fiches lues. Une panne n'écrit jamais ce cache négatif.
const WIFLIX_NEGATIVE_REFRESH_MS = 6 * 60 * 60 * 1000;
// Fraîcheur selon l'âge de la sortie (release_date du cache : sortie du film,
// dernier épisode de la saison). Une sortie récente change encore (VF ajoutée,
// nouvel épisode) ; une fiche ancienne presque plus, et un titre ancien absent
// de Flemmix le reste en général. Relire une fiche connue coûte une requête,
// réexaminer un introuvable une recherche complète.
//   sortie             trouvé   introuvable
//   < 3 mois (*)       3 h      6 h
//   3 mois à 1 an      12 h     24 h
//   plus d'un an       12 h     3 jours
// (*) ou à venir, inconnue, saison en cours, ancien cache sans date.
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WIFLIX_RECENT_RELEASE_MS = 90 * DAY_MS;
const WIFLIX_OLD_RELEASE_MS = 365 * DAY_MS;

// Page du site (gabarit DLE : formulaire de recherche, variable dle_root). Une
// page d'attente (« Flemmix - Acces securise ») ou de blocage n'en a pas : sans
// résultat, ce n'est pas une recherche vide.
function isWiflixSitePage(html) {
  return typeof html === "string" && /dle_root|name=["']story["']|id=["']quicksearch["']/i.test(html);
}

// Introuvable enregistré avant la vérification de la page de résultats
// (2026-10-19) : il a pu venir d'une page d'attente prise pour une recherche
// vide. Réexaminé une fois, l'ancien cache restant servi en attendant.
function isUnverifiedNegative(data) {
  return data?.success === false && data.search_page_checked !== true && !isWiflixSitePage(data.debugHtml);
}

function wiflixFreshnessMs(data, now = Date.now()) {
  if (isUnverifiedNegative(data)) return 0;
  const age = now - Date.parse(data?.release_date);
  const negative = data?.success === false;
  if (!(age >= WIFLIX_RECENT_RELEASE_MS)) return negative ? WIFLIX_NEGATIVE_REFRESH_MS : 3 * HOUR_MS;
  if (!negative) return 12 * HOUR_MS;
  return age >= WIFLIX_OLD_RELEASE_MS ? 3 * DAY_MS : DAY_MS;
}
const refreshState = createWiflixRefreshState({ freshnessMs: wiflixFreshnessMs });
const { respondWithResolvedSources } = require("../utils/embedExtraction");

// Wiflix range la map de langues à même l'épisode (`{ vf: [], vostfr: [] }`),
// sans enveloppe `languages` — d'où `languageKey: null`.
const respondWithEpisodeSources = (req, res, payload) =>
  respondWithResolvedSources(req, res, payload, { languageKey: null, label: "WIFLIX TV" });

const respondWithMovieSources = (req, res, payload) =>
  respondWithResolvedSources(req, res, payload, { movieMapKey: "players", label: "WIFLIX MOVIE" });
const {
  fetchTmdbDetails,
  fetchTmdbSeason,
} = require("../utils/tmdbCache");
// Movies are scraped from cinestream.info (flemmix's bot-shield is painful for
// films); TV stays on flemmix below. Same return shape, so the route + cache
// here consume it unchanged.
const { fetchCinestreamMovieData } = require("./cinestream");

const TMDB_API_KEY = process.env.TMDB_API_KEY || "";
const TMDB_API_URL = "https://api.themoviedb.org/3";
// Source rotates domains (flemmix.fast -> flemmix.rip -> flemmix.land -> ...). Override via env, no code change.
const WIFLIX_BASE_URL = process.env.WIFLIX_BASE_URL || "https://flemmix.land";

// Les lecteurs portent désormais leur URL dans `data-v` (base64 puis ROT13,
// cf. decodeStream du site) ; l'ancien `onclick="loadVideo('…')"` reste lu.
function decodeWiflixStream(value) {
  if (!value) return null;
  if (/^(https?:)?\/\//i.test(value)) return value;
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8").replace(/[a-zA-Z]/g, (c) => {
      const base = c <= "Z" ? 65 : 97;
      return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
    });
    return /^https?:\/\//i.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function wiflixLinkUrl($link) {
  const fromData = decodeWiflixStream($link.attr("data-v"));
  if (fromData) return fromData;
  const match = ($link.attr("onclick") || "").match(/loadVideo\('([^']+)'/);
  return match ? match[1] : null;
}

// Le site saute lui-même ces hébergeurs au profit du lien suivant.
const isSkippedWiflixHost = (url) => /up4fun\.top|up4stream/i.test(url);

// === Cache helpers (local, since getFromCacheNoExpiration is not yet in cacheManager) ===
// Lecture du seul fichier, comme cacheManager : plus de copie Redis devant les
// caches (rapport du 2026-10-19 : 45 Mio de GET en 2 min côté route séries,
// un SET par visite de la route film), saveToCache ne la remplit plus.
const getFromCacheNoExpiration = async (cacheDir, key) => {
  try {
    const cacheFilePath = path.join(cacheDir, `${key}.json`);
    let fileContent;
    try {
      fileContent = await fsp.readFile(cacheFilePath, "utf8");
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    }

    const cacheData = JSON.parse(fileContent);
    if (
      typeof cacheData === "string" ||
      cacheData === null ||
      cacheData === undefined
    ) {
      try {
        await fsp.unlink(cacheFilePath);
      } catch {}
      return null;
    }

    return cacheData;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    console.error(
      `Erreur lors de la recuperation du cache pour ${key}:`,
      error,
    );
    return null;
  }
};

// === Utility Functions ===
const normalizeString = (str) => {
  if (!str) return "";
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

// Normalise un titre en retirant les termes generiques FR/EN (articles, "film/movie", etc.)
// pour comparer le "coeur" du titre (ex: "The Super Mario Galaxy Movie" → "super mario galaxy")
const stripTitleNoise = (str) => {
  return normalizeString(str)
    .replace(/\b(le film|the movie|the film|le movie|film|movie|movies|films)\b/g, '')
    .replace(/\b(the|a|an|le|la|les|l|un|une|des|de|du|d)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const prepareWiflixTitle = (str) => {
  const title = str.toLowerCase().replace(/\s+saison\s+\d+\b/g, "").trim();
  // Le site ajoute parfois l'année au titre : « From (2022) ».
  // Conserver les nombres du titre lui-même, comme « 1899 » ou « 1923 ».
  const yearMatch = title.match(/\s+(?:\(((?:19|20)\d{2})\)|\[((?:19|20)\d{2})\])$/);
  return {
    title: yearMatch ? title.slice(0, yearMatch.index).trim() : title,
    year: yearMatch ? yearMatch[1] || yearMatch[2] : null,
  };
};

const getLevenshteinSimilarity = (str1, str2) => {
  const s1 = normalizeString(str1);
  const s2 = normalizeString(str2);
  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  const matrix = [];
  for (let i = 0; i <= s2.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= s1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= s2.length; i++) {
    for (let j = 1; j <= s1.length; j++) {
      if (s2.charAt(i - 1) === s1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        );
      }
    }
  }

  const maxLength = Math.max(s1.length, s2.length);
  return maxLength === 0
    ? 1
    : (maxLength - matrix[s2.length][s1.length]) / maxLength;
};

function formatNextUpdate(ms) {
  if (ms <= 0) return 'imminent';
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

// === Search ===
// Coupe-circuit Flemmix ouvert (proxyManager) : l'échec est immédiat et
// attendu, donc sans journal à chaque appel. Il reste une indisponibilité,
// jamais un « introuvable » : reprise différée, ancien cache conservé.
const isSourceCircuitOpen = (error) =>
  error?.code === 'SOURCE_CIRCUIT_OPEN' || error?.isSourceCircuitOpen === true;
// Débit global vers Flemmix atteint (proxyManager) : même traitement, les
// refus sont relevés une fois par minute par la porte elle-même.
const isWiflixRateLimited = (error) => error?.code === 'WIFLIX_RATE_LIMITED';
const isExpectedWiflixFailure = (error) => isSourceCircuitOpen(error) || isWiflixRateLimited(error);
const rateLimitedFlag = (error) => (isWiflixRateLimited(error) ? { rateLimited: true } : {});

// Partie utile d'une page de résultats pour cheerio : du premier bloc de
// résultat (ou du bloc « Populaires » #no-results-rec) jusqu'à la fin du
// contenu (<!-- end content -->), sans l'en-tête, les menus, la barre latérale
// ni le pied de page. Sur une page réelle du site : 65 Ko sur 134 Ko, analyse
// en 7 ms au lieu de 11. Au moindre doute, jusqu'au bout de la page (bloc de
// résultat après la fin du contenu, repère absent) ou toute la page (balise
// de départ douteuse). Les blocs retenus et leur appartenance à
// #no-results-rec ne changent pas : rien de ce qui précède le premier bloc
// n'en contient.
const WIFLIX_RESULT_TOKEN = /[\s"'=](?:mov|mov-t|block-sai|no-results-rec)[\s"'>]/i;
const WIFLIX_FRAGMENT_SCAN = new RegExp('<!--|-->|<(\\/?)(script|style|textarea|title|noscript|template|iframe'
  + `|xmp|noembed|noframes)\\b|${WIFLIX_RESULT_TOKEN.source}`, 'gi');

// Position du premier repère de résultat hors commentaire et hors élément de
// texte brut (un gabarit de bloc dans un script n'en est pas un), ou -1.
function firstWiflixResultToken(html) {
  let open = null; // Commentaire (« -- ») ou élément de texte brut ouvert.
  for (const match of html.matchAll(WIFLIX_FRAGMENT_SCAN)) {
    const [token, closing, tag] = match;
    if (open === '--') {
      if (token === '-->') open = null;
    } else if (open) {
      if (closing && tag.toLowerCase() === open) open = null;
    } else if (token === '<!--') {
      open = '--';
    } else if (tag) {
      if (!closing) open = tag.toLowerCase();
    } else if (token !== '-->') {
      return match.index;
    }
  }
  return -1;
}

function wiflixResultsFragment(html) {
  const first = firstWiflixResultToken(html);
  if (first < 0) return html;
  const start = html.lastIndexOf('<', first);
  // Le premier repère doit tenir dans la balise ouverte en `start`.
  if (start < 0 || !/[a-z]/i.test(html[start + 1] || '') || html.indexOf('>', start) < first) return html;
  const end = html.indexOf('<!-- end content -->', first);
  if (end < 0 || WIFLIX_RESULT_TOKEN.test(html.slice(end))) return html.slice(start);
  return html.slice(start, end);
}

async function searchWiflixMovie(title, baseUrl = WIFLIX_BASE_URL) {
  const searchUrl = `${baseUrl}/`;
  const payload = `do=search&subaction=search&story=${encodeURIComponent(title)}`;
  try {
    let responseBody = null;

    try {
      // Cookie handshake: GET homepage to harvest the bot-shield session cookie,
      // then POST the search with it + h_check=25 on the same proxy.
      const res = await makeWiflixSearchRequest(baseUrl + "/", searchUrl, {
        data: payload,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Referer": baseUrl + "/",
          "Origin": baseUrl,
        },
        timeout: 15000,
      });
      responseBody = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
      console.log(`[WIFLIX SEARCH] OK via proxy`);
    } catch (err) {
      if (!isExpectedWiflixFailure(err)) console.log(`[WIFLIX SEARCH] Echec: ${err.message}`);
      refreshStep('search_error', { query: title }, err);
      return { url: null, unavailable: true, ...rateLimitedFlag(err),
        debugHtml: 'Erreur: service temporairement indisponible' };
    }

    if (!responseBody || responseBody.includes("Un instant, s'il vous plait")) {
      return { url: null, unavailable: true, debugHtml: responseBody || 'Challenge Cloudflare non resolu' };
    }

    const $ = cheerio.load(wiflixResultsFragment(responseBody));
    // Template has no #dle-content wrapper. Real results are div.mov; the
    // "Populaires" reco block (#no-results-rec) is hidden when results exist —
    // exclude it exactly like the site's own JS result counter does.
    const movBlocks = $("div.mov").not("#no-results-rec .mov");
    if (movBlocks.length === 0) {
      // Page d'attente ou de blocage servie en 200 : panne passagère, jamais un
      // « introuvable » (cache négatif de 6 h à 3 jours).
      if (!isWiflixSitePage(responseBody)) {
        refreshStep('search_unexpected_page', { query: title });
        return { url: null, unavailable: true, debugHtml: responseBody };
      }
      return { url: null, debugHtml: responseBody };
    }

    let bestMatch = null;
    const candidates = [];
    let bestSimilarity = 0;
    const { title: cleanSearchTitle, year: searchYear } = prepareWiflixTitle(title);

    movBlocks.each((_, block) => {
      const $block = $(block);
      const $titleLink = $block.find("a.mov-t");
      if (!$titleLink.length) return;

      const href = $titleLink.attr("href");
      if (!href) return;

      const resultTitle = $titleLink.text().trim();
      if (!resultTitle || resultTitle.length < 2) return;

      const resultTitleLower = resultTitle.toLowerCase();
      const hasBlockSai = $block.find(".block-sai").length > 0;
      const isSeries =
        href.includes("/serie-") ||
        resultTitleLower.includes("saison") ||
        /saison-\d+/i.test(href) ||
        hasBlockSai;
      const searchIsSeries = title.toLowerCase().includes("saison");

      if (searchIsSeries && !isSeries) return;
      if (!searchIsSeries && isSeries) return;

      if (searchIsSeries) {
        const searchSeasonMatch = title.match(/saison\s+(\d+)/i);
        if (searchSeasonMatch) {
          const searchSeason = parseInt(searchSeasonMatch[1]);

          let resultSeasonNum = null;
          const titleSeasonMatch = resultTitle.match(/saison\s+(\d+)/i);
          if (titleSeasonMatch) {
            resultSeasonNum = parseInt(titleSeasonMatch[1]);
          }
          if (resultSeasonNum === null) {
            const blockSaiText = $block.find(".block-sai").text().trim();
            const saiMatch =
              blockSaiText.match(/saison\s+(\d+)/i) ||
              blockSaiText.match(/^(\d+)/);
            if (saiMatch) {
              resultSeasonNum = parseInt(saiMatch[1]);
            }
          }
          if (resultSeasonNum === null) {
            const urlSeasonMatch = href.match(/saison-(\d+)/i);
            if (urlSeasonMatch) {
              resultSeasonNum = parseInt(urlSeasonMatch[1]);
            }
          }

          if (resultSeasonNum === null || searchSeason !== resultSeasonNum)
            return;
        }
      }

      const { title: cleanResultTitle, year: resultYear } = prepareWiflixTitle(resultTitle);
      if (searchYear && resultYear && searchYear !== resultYear) return;

      let similarity = 0;
      if (cleanResultTitle === cleanSearchTitle) {
        similarity = 1.0;
      } else {
        similarity = getLevenshteinSimilarity(
          cleanResultTitle,
          cleanSearchTitle,
        );
        // Fallback: comparer les titres sans bruit FR/EN ("The ... Movie" vs "Le Film")
        if (similarity < 0.85) {
          const coreSearch = stripTitleNoise(cleanSearchTitle);
          const coreResult = stripTitleNoise(cleanResultTitle);
          if (coreSearch && coreResult) {
            const coreSim = coreSearch === coreResult
              ? 1.0
              : getLevenshteinSimilarity(coreSearch, coreResult);
            similarity = Math.max(similarity, coreSim);
          }
        }
      }

      // Certains titres de séries portent un préfixe de franchise sur le site,
      // ex. « Game Of Thrones: House of the Dragon ». Accepter uniquement le
      // suffixe complet d'un titre de plusieurs mots, après contrôle de saison.
      // Un titre complet exact conserve la priorité (1 contre 0.95).
      const prefixEnd = cleanResultTitle.indexOf(":");
      if (searchIsSeries && prefixEnd > 0
        && stripTitleNoise(cleanSearchTitle).split(" ").filter(Boolean).length >= 2
        && normalizeString(cleanResultTitle.slice(prefixEnd + 1)) === normalizeString(cleanSearchTitle)) {
        similarity = Math.max(similarity, 0.95);
      }

      let fullUrl = href;
      if (fullUrl && !fullUrl.startsWith("http")) {
        fullUrl = fullUrl.startsWith("/")
          ? `${baseUrl}${fullUrl}`
          : `${baseUrl}/${fullUrl}`;
      }

      try { if (new URL(fullUrl).origin !== new URL(baseUrl).origin) return; } catch { return; }
      if (similarity >= 0.5) candidates.push({ url: encodeURI(fullUrl), title: resultTitle, similarity });
      if (similarity >= 0.85 && similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatch = fullUrl ? encodeURI(fullUrl) : fullUrl;
      }
    });

    candidates.sort((a, b) => b.similarity - a.similarity);
    refreshStep('search_candidates', { query: title, results: movBlocks.length, candidates: candidates.length });
    return { url: bestMatch, candidates, debugHtml: candidates.length ? null : responseBody };
  } catch (error) {
    if (error.response?.status === 403) {
      console.error(
        `[WIFLIX SEARCH] 403 Forbidden pour "${title}" sur ${searchUrl}`,
      );
    }
    refreshStep('search_error', { query: title }, error);
    return { url: null, unavailable: true, debugHtml: 'Erreur: service temporairement indisponible' };
  }
}

// === Player Extraction ===
// Lien de lecteur tel que la fiche le donne : URL lisible (http, base64 +
// ROT13) ou jeton « fx1_ » à échanger contre l'URL (resolveWiflixToken).
function wiflixLinkSource($link) {
  const raw = $link.attr("data-v") || "";
  if (raw.startsWith(WIFLIX_TOKEN_PREFIX)) return { token: raw };
  const url = wiflixLinkUrl($link);
  return url ? { url } : null;
}

// Hébergeur réécrit comme le fait le site, nom tiré du domaine.
function wiflixPlayer(linkUrl, name, episode, type) {
  if (!linkUrl || isSkippedWiflixHost(linkUrl)) return null;
  let processedUrl = linkUrl;
  if (processedUrl.includes("tipfly.xyz")) {
    const tipflyMatch = processedUrl.match(/tipfly\.xyz\/em-?\d+-(.+)/);
    if (tipflyMatch && tipflyMatch[1]) processedUrl = `https://oneupload.net/embed-${tipflyMatch[1]}.html`;
  } else if (name.toLowerCase() === "voe" || processedUrl.includes("jilliandescribecompany.com")) {
    processedUrl = processedUrl.replace(/^https?:\/\/[^/]+/, "https://voe.sx");
  }
  const domainMatch = processedUrl.match(/https?:\/\/(?:www\.)?([^\/]+)/);
  return { name: domainMatch ? domainMatch[1] : name, url: processedUrl, episode, type };
}

// Nom de l'hébergeur : attribut data-n en base64 (« Voe », « Vidara »…) quand
// le lien n'affiche que « Lecteur HD », sinon le texte du lien. La réécriture
// Voe en dépend.
function wiflixHostName($span) {
  const encoded = $span.attr("data-n");
  if (encoded) {
    try {
      const decoded = Buffer.from(encoded, "base64").toString("utf8").trim();
      if (/^[\w .-]{1,40}$/.test(decoded)) return decoded;
    } catch { /* texte du lien */ }
  }
  return $span.text().trim();
}

async function extractWiflixPlayers(pageUrl) {
  try {
    let rawHtml = null;

    try {
      const res = await makeWiflixRequest(pageUrl, {
        timeout: 15000,
        headers: {
          "Referer": WIFLIX_BASE_URL + "/",
        },
      });
      rawHtml = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
      console.log(`[WIFLIX PLAYERS] OK via proxy`);
    } catch (err) {
      // Fiche supprimée (404) : ce n'est pas une panne de proxy. La relecture
      // d'une fiche connue repasse alors par la recherche.
      if (err?.response?.status === 404 || err?.wiflixStatus === 404) {
        return { players: [], releaseYear: null, notFound: true, debugHtml: 'Fiche introuvable (404)' };
      }
      if (!isExpectedWiflixFailure(err)) console.log(`[WIFLIX PLAYERS] Echec: ${err.message}`);
      return { players: [], releaseYear: null, ...rateLimitedFlag(err), debugHtml: 'Impossible de charger la page' };
    }

    if (!rawHtml) {
      return { players: [], releaseYear: null, debugHtml: 'Impossible de charger la page' };
    }
    const $ = cheerio.load(rawHtml);
    // Liens dans l'ordre de la fiche. Un jeton « fx1_ » n'est échangé qu'une
    // fois l'identité acceptée (completeWiflixPlayers) : un mauvais candidat
    // ne coûte qu'une requête.
    const links = [];
    const addLink = ($link, episode, type) => {
      const source = wiflixLinkSource($link);
      // Template dropped the .clichost class (like the movie page) — match any span.
      const $span = $link.find("span");
      if (!source || !$span.length) return;
      links.push({ ...source, name: wiflixHostName($span), episode, type });
    };

    const episodeDivs = $(
      'div[class*="ep"][class*="vf"], div[class*="ep"][class*="vs"]',
    );

    if (episodeDivs.length > 0) {
      episodeDivs.each((index, element) => {
        const $episodeDiv = $(element);
        const episodeMatch = ($episodeDiv.attr("class") || "").match(/ep(\d+)(vf|vs)/);
        if (!episodeMatch) return;
        const episodeNumber = parseInt(episodeMatch[1]);
        const type = episodeMatch[2] === "vf" ? "VF" : "VOSTFR";
        $episodeDiv.find("a[data-v], a[onclick]").each((linkIndex, linkElement) => {
          addLink($(linkElement), episodeNumber, type);
        });
      });
    } else {
      $(".tabs-sel a[data-v], .tabs-sel a[onclick]").each((index, element) => {
        const $link = $(element);
        const label = $link.find("span").text().toLowerCase();
        addLink($link, 1, label.includes("vostfr") ? "VOSTFR" : "VF");
      });
    }

    const players = [];
    for (const link of links) {
      if (link.token) continue;
      const player = wiflixPlayer(link.url, link.name, link.episode, link.type);
      if (player) players.push(player);
    }
    const tokenCount = links.filter((link) => link.token).length;

    // Le DOM déjà chargé évite une seconde analyse de la fiche.
    const identity = parseSourceIdentity($);
    return { players, links, tokenCount, pageUrl, pageKey: wiflixPageKey(rawHtml),
      releaseYear: identity.year, identity, debugHtml: links.length === 0 ? rawHtml : null };
  } catch (error) {
    return {
      players: [],
      releaseYear: null,
      debugHtml: error.response?.data || error.message || null,
    };
  }
}

// === Jetons de lecteur « fx1_ » (fiches depuis le 2026-11-22) ===
// La fiche ne porte plus l'URL du lecteur mais un jeton, différent à chaque
// chargement. Le site l'échange par POST /ajax_player.php (v = jeton, k = clé
// de la page, b = 1 hors navigateur automatisé) contre {"u": URL}.
const WIFLIX_TOKEN_PREFIX = "fx1_";
const WIFLIX_TOKEN_CONCURRENCY = 4;

// Clé de la page (window._fx_k) : tableau _a XOR _m, partie avant « | ».
function wiflixPageKey(html) {
  const match = /var _a=\[([\d,\s]+)\],\s*_m=(\d+)/.exec(html);
  if (!match) return "";
  const mask = Number(match[2]);
  const decoded = match[1].split(",").map((code) => String.fromCharCode(Number(code) ^ mask)).join("");
  return decoded.split("|")[0];
}

async function resolveWiflixToken(token, pageUrl, pageKey) {
  const origin = new URL(pageUrl).origin;
  const res = await makeWiflixRequest(`${origin}/ajax_player.php`, {
    method: "POST",
    timeout: 15000,
    responseType: "text",
    minBodyLength: 1,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Referer": pageUrl,
      "Origin": origin,
      accept: "*/*",
    },
    data: `v=${encodeURIComponent(token)}&k=${encodeURIComponent(pageKey || "")}&b=1`,
  });
  let url = null;
  try { url = JSON.parse(res.data)?.u; } catch { /* réponse non JSON */ }
  return typeof url === "string" && /^https?:\/\//i.test(url) ? url : null;
}

// Échange les jetons d'une fiche dont l'identité est acceptée, puis range les
// lecteurs dans l'ordre de la fiche. Un jeton refusé est sauté. Le débit
// global atteint, ou aucun jeton échangé sans autre lecteur, est une panne :
// l'appelant garde l'ancien cache au lieu d'écrire un « introuvable ».
async function completeWiflixPlayers(extraction) {
  if (!extraction.tokenCount) return { ok: true };
  const resolved = new Map();
  const queue = extraction.links.filter((link) => link.token);
  let rateLimited = false;
  let failed = 0;
  const worker = async () => {
    while (queue.length && !rateLimited) {
      const link = queue.shift();
      try {
        const url = await resolveWiflixToken(link.token, extraction.pageUrl, extraction.pageKey);
        if (url) resolved.set(link, url);
        else failed++;
      } catch (error) {
        if (isWiflixRateLimited(error)) rateLimited = true;
        failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(WIFLIX_TOKEN_CONCURRENCY, queue.length) }, worker));
  refreshStep('player_tokens', { url: extraction.pageUrl, tokens: extraction.tokenCount,
    resolved: resolved.size, failed, rateLimited });
  if (rateLimited) return { ok: false, rateLimited: true };
  if (!resolved.size && !extraction.players.length) return { ok: false };

  const players = [];
  for (const link of extraction.links) {
    const url = link.token ? resolved.get(link) : link.url;
    const player = url ? wiflixPlayer(url, link.name, link.episode, link.type) : null;
    if (player) players.push(player);
  }
  extraction.players = players;
  extraction.tokenCount = 0;
  return { ok: true };
}

// === Data Fetching ===
// Movie data comes from cinestream.info first (see ./cinestream + updateWiflixCache);
// flemmix is the movie fallback and still the only TV source.

// Fiche Flemmix déjà confirmée : la relire coûte une requête au lieu d'une
// recherche complète. Une recherche reste forcée tous les 7 jours (searched_at)
// pour découvrir une nouvelle fiche ; un autre domaine repasse aussi par elle.
const WIFLIX_KNOWN_PAGE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function knownWiflixPage(cache, { requireFlemmixSource = true } = {}) {
  if (!cache?.success || typeof cache.wiflix_url !== 'string') return null;
  // Un cache CineStream seul porte l'URL CineStream dans wiflix_url.
  const source = String(cache.source || '');
  if ((requireFlemmixSource || cache.source) && !source.includes('flemmix')) return null;
  try { if (new URL(cache.wiflix_url).origin !== new URL(WIFLIX_BASE_URL).origin) return null; }
  catch { return null; }
  const searchedAt = cache.searched_at || cache.cache_timestamp;
  const age = Date.now() - Date.parse(searchedAt);
  if (!(age >= 0 && age < WIFLIX_KNOWN_PAGE_MAX_AGE_MS)) return null;
  return { url: cache.wiflix_url, searchedAt };
}

// Panne de la source : reprise différée, ancien cache gardé. Un refus du débit
// global porte WIFLIX_RATE_LIMITED : même traitement, sans rapport d'échec.
function wiflixUnavailable(message, rateLimited = false) {
  return rateLimited
    ? Object.assign(new Error('Débit global Flemmix atteint, actualisation différée'), { code: 'WIFLIX_RATE_LIMITED' })
    : new Error(message);
}

// Relit la fiche connue. null : recherche complète (fiche disparue, identité
// refusée ou sans lecteur). Une fiche impossible à charger reste une panne,
// comme pour un candidat : l'ancien cache est gardé, la reprise différée.
async function rereadKnownWiflixPage(known, verify, triedUrls) {
  triedUrls.add(known.url);
  const extraction = await extractWiflixPlayers(known.url);
  if (extraction.notFound) {
    refreshStep('known_page_not_found', { url: known.url });
    return null;
  }
  if (!extraction.identity) {
    refreshStep('known_page_fetch_failed', { url: known.url });
    throw wiflixUnavailable('Fiche Wiflix connue temporairement indisponible', extraction.rateLimited);
  }
  const identity = await verify(extraction.identity);
  refreshStep('known_page_identity', { url: known.url, ...identity });
  if (!identity.accepted) return null;
  const completion = await completeWiflixPlayers(extraction);
  if (!completion.ok) {
    throw wiflixUnavailable('Lecteurs de la fiche Wiflix connue temporairement indisponibles', completion.rateLimited);
  }
  return extraction.players.length ? { extraction, identity } : null;
}

// Recherches d'une actualisation : 6 au plus (8 avant), dont 3 pour la passe
// des alias TMDB, et 8 fiches candidates. Le moteur du site ignore la casse et
// les espaces répétés : « DUNE  Deuxième partie » rendrait la page de « Dune
// Deuxième Partie », il n'est pas redemandé. Un titre sans lettre latine ni
// chiffre (기생충, Брат) ne peut donner aucun candidat, la comparaison des
// titres le réduisant à une chaîne vide : il n'est pas envoyé.
const WIFLIX_MAX_SEARCHES = 6;
const WIFLIX_MAX_ALIAS_SEARCHES = 3;
const WIFLIX_MAX_CANDIDATES = 8;
const wiflixQueryKey = (title) => String(title).toLowerCase().split(/\s+/).filter(Boolean).join(' ');
const isSearchableWiflixTitle = (title) => normalizeString(prepareWiflixTitle(String(title)).title) !== '';

// Titres TMDB, puis alias si aucune fiche n'est confirmée. Une recherche ou
// une fiche en échec signale une source (ou une sortie réseau) en panne : le
// titre suivant échouerait de la même façon, l'examen s'arrête et la reprise
// différée prend le relais. Rend la fiche confirmée, la panne, ou le bilan
// d'un examen complet sans fiche.
async function lookupWiflixPage(verifier, triedUrls, season = null) {
  const tried = new Map(); // Clé de requête → titre envoyé.
  let debugHtml = null;
  for (let pass = 0; pass < 2; pass++) {
    if (pass && (tried.size >= WIFLIX_MAX_SEARCHES || triedUrls.size >= WIFLIX_MAX_CANDIDATES)) break;
    const titles = pass ? await verifier.aliases() : verifier.titles;
    const limit = pass ? Math.min(WIFLIX_MAX_SEARCHES, tried.size + WIFLIX_MAX_ALIAS_SEARCHES) : WIFLIX_MAX_SEARCHES;
    for (const title of searchTitles(titles)) {
      if (tried.size >= limit || triedUrls.size >= WIFLIX_MAX_CANDIDATES) break;
      const key = wiflixQueryKey(title);
      if (tried.has(key) || !isSearchableWiflixTitle(title)) continue;
      tried.set(key, title);
      const search = await searchWiflixMovie(season === null ? title : `${title} saison ${season}`);
      debugHtml = search.debugHtml || debugHtml;
      if (search.unavailable) return { unavailable: true, rateLimited: search.rateLimited === true };
      for (const candidate of search.candidates || []) {
        if (triedUrls.has(candidate.url) || triedUrls.size >= WIFLIX_MAX_CANDIDATES) continue;
        triedUrls.add(candidate.url);
        const extraction = await extractWiflixPlayers(candidate.url);
        if (!extraction.identity) {
          refreshStep('candidate_fetch_failed', { url: candidate.url });
          return { unavailable: true, rateLimited: extraction.rateLimited === true };
        }
        const identity = await verifier.verify(extraction.identity, season === null ? undefined : { season });
        refreshStep('candidate_identity', { url: candidate.url, title: candidate.title, ...identity });
        if (!identity.accepted) continue;
        const completion = await completeWiflixPlayers(extraction);
        if (!completion.ok) return { unavailable: true, rateLimited: completion.rateLimited === true };
        if (extraction.players.length) return { url: candidate.url, extraction, identity };
      }
    }
  }
  return { queries: [...tried.values()], debugHtml };
}

// Date du dernier épisode de la saison ; null tant qu'un épisode reste sans
// date (saison en cours ou annoncée).
function seasonReleaseDate(seasonData) {
  const dates = (seasonData?.episodes || []).map((episode) => episode?.air_date);
  if (!dates.length) return seasonData?.air_date || null;
  return dates.every(Boolean) ? dates.sort().at(-1) : null;
}

function fetchWiflixMovieData(tmdbId, cachedData = null, known = null) {
  return withRefreshDiagnostics({ source: 'Wiflix/Flemmix', type: 'movie', id: tmdbId,
    cachePresent: Boolean(cachedData), knownPage: Boolean(known) }, redis,
  () => loadWiflixMovieData(tmdbId, cachedData, known));
}

async function loadWiflixMovieData(tmdbId, cachedData, known = null) {
  try {
    const [tmdbData, english] = await Promise.all([
      fetchTmdbDetails(TMDB_API_URL, TMDB_API_KEY, tmdbId, 'movie', 'fr-FR'),
      fetchTmdbDetails(TMDB_API_URL, TMDB_API_KEY, tmdbId, 'movie', 'en-US'),
    ]);
    if (!tmdbData) throw new Error('Métadonnées TMDB du film indisponibles');
    refreshStep('tmdb_result', { title: tmdbData.title, originalTitle: tmdbData.original_title });
    const verifier = createIdentityVerifier({ apiUrl: TMDB_API_URL, apiKey: TMDB_API_KEY,
      type: 'movie', details: tmdbData, english });
    const triedUrls = new Set();
    // Date de sortie : elle règle la fraîcheur du cache (wiflixFreshnessMs).
    const releaseDate = tmdbData.release_date || null;
    // searched_at date la dernière recherche complète ; une simple relecture
    // de la fiche connue le conserve.
    const found = (url, extraction, identity, searchedAt) => {
      const players = { vf: [], vostfr: [] };
      for (const player of extraction.players) players[player.type === 'VOSTFR' ? 'vostfr' : 'vf'].push(player);
      const now = new Date().toISOString();
      return { success: true, tmdb_id: tmdbId, title: tmdbData.title,
        original_title: tmdbData.original_title, source: 'flemmix',
        wiflix_url: url, players, identity: { ...identity, tmdbId: tmdbData.id },
        release_date: releaseDate, searched_at: searchedAt || now, cache_timestamp: now };
    };
    if (known) {
      const reread = await rereadKnownWiflixPage(known, (identity) => verifier.verify(identity), triedUrls);
      if (reread) return found(known.url, reread.extraction, reread.identity, known.searchedAt);
    }
    const lookup = await lookupWiflixPage(verifier, triedUrls);
    if (lookup.url) return found(lookup.url, lookup.extraction, lookup.identity);
    if (lookup.unavailable) {
      throw wiflixUnavailable('Recherche ou fiche Wiflix temporairement indisponible', lookup.rateLimited);
    }
    reportRefreshFailure('content_not_found', 'Aucune fiche avec lecteurs et identité confirmée après examen des candidats', {
      title: tmdbData.title, candidatesChecked: triedUrls.size, queries: lookup.queries,
    });
    return { success: false, error: 'Film non trouvé ou identité non confirmée sur Wiflix',
      tmdb_id: tmdbId, titles_tried: lookup.queries, release_date: releaseDate, search_page_checked: true,
      debugHtml: lookup.debugHtml };
  } catch (error) {
    if (!isWiflixRateLimited(error)) reportRefreshFailure('refresh_exception', error);
    if (cachedData) return cachedData;
    return { success: false, unavailable: true, ...rateLimitedFlag(error),
      error: 'Wiflix temporairement indisponible', tmdb_id: tmdbId };
  }
}

// CineStream a le film, Flemmix non : le cache est un succès, mais Flemmix
// n'est réexaminé qu'au rythme d'un introuvable (6 h à 3 jours selon l'âge de
// la sortie, depuis flemmix_missing_at) au lieu d'une recherche complète à
// chaque actualisation.
function flemmixRecentlyMissing(cache, now = Date.now()) {
  const age = now - Date.parse(cache?.flemmix_missing_at);
  return age >= 0 && age < wiflixFreshnessMs({ success: false, search_page_checked: true,
    release_date: cache?.release_date }, now);
}

// Films : CineStream et Flemmix en parallèle, lecteurs fusionnés (sans doublon).
// Une source en panne n'efface rien : sans aucun succès, l'ancien cache reste.
async function fetchMovieData(tmdbId, existingCache) {
  // Les loaders reçoivent null : sur panne, c'est cette fonction qui rend
  // l'ancien cache. Flemmix ne reçoit que l'adresse de la fiche connue.
  const loadFlemmix = () => fetchWiflixMovieData(tmdbId, null, knownWiflixPage(existingCache));
  let flemmixSkipped = flemmixRecentlyMissing(existingCache);
  let [cinestream, flemmix] = await Promise.allSettled([
    fetchCinestreamMovieData(tmdbId, null),
    flemmixSkipped ? null : loadFlemmix(),
  ]);
  // Pause ou refroidissement CineStream (CINESTREAM_*) : attendu, sans journal.
  const cinestreamPaused = cinestream.status === 'rejected'
    && Boolean(cinestream.reason?.code?.startsWith('CINESTREAM_'));
  if (cinestream.status === 'rejected' && !cinestreamPaused) {
    console.error(`[WIFLIX UPDATE] movie ${tmdbId}: CineStream ${cinestream.reason?.message}`);
  }
  // Sans le film sur CineStream, Flemmix est examiné malgré tout.
  if (flemmixSkipped && !(cinestream.status === 'fulfilled' && cinestream.value?.success)) {
    flemmixSkipped = false;
    [flemmix] = await Promise.allSettled([loadFlemmix()]);
  }
  const results = [flemmix, cinestream]
    .filter((result) => result.status === 'fulfilled' && result.value?.success)
    .map((result) => result.value);

  if (results.length > 0) {
    const players = { vf: [], vostfr: [] };
    const seen = new Set();
    for (const result of results) {
      for (const lang of ['vf', 'vostfr']) {
        for (const player of result.players?.[lang] || []) {
          if (!player?.url || seen.has(player.url)) continue;
          seen.add(player.url);
          players[lang].push(player);
        }
      }
    }
    const [main] = results;
    const flemmixValue = flemmix.status === 'fulfilled' ? flemmix.value : null;
    const flemmixMissingAt = flemmixSkipped ? existingCache.flemmix_missing_at
      : flemmixValue?.success === false && !flemmixValue.unavailable ? new Date().toISOString() : null;
    const merged = { ...main, source: results.map((result) => result.source).join('+'), players,
      release_date: main.release_date || flemmixValue?.release_date || existingCache?.release_date || null,
      cache_timestamp: new Date().toISOString() };
    if (flemmixMissingAt) merged.flemmix_missing_at = flemmixMissingAt;
    return merged;
  }

  // Cette pause ne rend pas à elle seule le résultat indisponible quand Flemmix
  // a répondu sans erreur : sinon un film introuvable n'aurait jamais de cache
  // négatif et serait rescrapé à chaque reprise.
  const unavailable = (cinestream.status === 'rejected' && !cinestreamPaused)
    || flemmix.status === 'rejected' || flemmix.value?.unavailable;
  if (unavailable) {
    if (existingCache) return existingCache;
    throw Object.assign(new Error('CineStream et Flemmix temporairement indisponibles'),
      flemmix.value?.rateLimited ? { code: 'WIFLIX_RATE_LIMITED' } : {});
  }
  return flemmix.value;
}

function fetchWiflixTvData(tmdbId, season, cachedData = null) {
  // Les saisons ne viennent que de Flemmix : leur cache n'a pas de champ source.
  const known = knownWiflixPage(cachedData, { requireFlemmixSource: false });
  return withRefreshDiagnostics({ source: 'Wiflix/Flemmix', type: 'tv', id: tmdbId, season,
    cachePresent: Boolean(cachedData), knownPage: Boolean(known) }, redis,
  () => loadWiflixTvData(tmdbId, season, cachedData, known));
}

async function loadWiflixTvData(tmdbId, season, cachedData, known = null) {
  try {
    const [tmdbData, english, seasonData] = await Promise.all([
      fetchTmdbDetails(TMDB_API_URL, TMDB_API_KEY, tmdbId, 'tv', 'fr-FR'),
      fetchTmdbDetails(TMDB_API_URL, TMDB_API_KEY, tmdbId, 'tv', 'en-US'),
      fetchTmdbSeason(TMDB_API_URL, TMDB_API_KEY, tmdbId, season, 'fr-FR'),
    ]);
    if (!tmdbData || !seasonData) throw new Error('Métadonnées TMDB de la série ou de la saison indisponibles');
    refreshStep('tmdb_result', { title: tmdbData.name, originalTitle: tmdbData.original_name });
    const verifier = createIdentityVerifier({ apiUrl: TMDB_API_URL, apiKey: TMDB_API_KEY,
      type: 'tv', details: tmdbData, english, seasonData });
    const triedUrls = new Set();
    const releaseDate = seasonReleaseDate(seasonData);
    const found = (url, extraction, identity, searchedAt) => {
      const episodes = {};
      for (const player of extraction.players) {
        const number = player.episode;
        episodes[number] ||= { vf: [], vostfr: [] };
        episodes[number][player.type === 'VOSTFR' ? 'vostfr' : 'vf'].push(player);
      }
      const now = new Date().toISOString();
      return { success: true, tmdb_id: tmdbId, title: tmdbData.name,
        original_title: tmdbData.original_name, season: Number(season),
        wiflix_url: url, episodes, identity: { ...identity, tmdbId: tmdbData.id },
        release_date: releaseDate, searched_at: searchedAt || now, cache_timestamp: now };
    };
    // Fiche connue : même contrôle de saison que pour un candidat.
    if (known) {
      const reread = await rereadKnownWiflixPage(known, (identity) => verifier.verify(identity, { season }), triedUrls);
      if (reread) return found(known.url, reread.extraction, reread.identity, known.searchedAt);
    }
    // Arrêt au premier échec de recherche ou de fiche, comme pour les films.
    const lookup = await lookupWiflixPage(verifier, triedUrls, season);
    if (lookup.url) return found(lookup.url, lookup.extraction, lookup.identity);
    if (lookup.unavailable) {
      throw wiflixUnavailable('Recherche ou fiche Wiflix temporairement indisponible', lookup.rateLimited);
    }
    reportRefreshFailure('content_not_found', 'Aucune fiche avec lecteurs et identité confirmée après examen des candidats', {
      title: tmdbData.name, candidatesChecked: triedUrls.size, queries: lookup.queries,
    });
    return { success: false, error: 'Série non trouvée ou identité non confirmée sur Wiflix',
      tmdb_id: tmdbId, season, titles_tried: lookup.queries, release_date: releaseDate, search_page_checked: true,
      debugHtml: lookup.debugHtml };
  } catch (error) {
    if (!isWiflixRateLimited(error)) reportRefreshFailure('refresh_exception', error);
    if (cachedData) return cachedData;
    // Comme pour les films, une panne n'est jamais publiée en cache négatif.
    return { success: false, unavailable: true, ...rateLimitedFlag(error),
      error: 'Wiflix temporairement indisponible', tmdb_id: tmdbId, season };
  }
}

// === Background Cache Update ===
const WIFLIX_UPDATE_LOCK_TTL = 60; // Renouvelé pendant l'examen des candidats.

// Plafond par worker des actualisations détachées, films et séries ensemble.
// Après une coupure, chaque titre périmé en lançait une (≈ 100 par worker).
// Un titre sans cache passe avant un cache périmé, qui reste servi : le
// frontend ne réinterroge pas. Un refus n'écrit rien ; la visite suivante
// réessaie. Ce n'est jamais une pause de la source.
const configuredRefreshMax = Math.floor(Number(process.env.WIFLIX_REFRESH_MAX_PER_WORKER));
const WIFLIX_REFRESH_MAX_PER_WORKER = configuredRefreshMax > 0 ? configuredRefreshMax : 16;
let activeWiflixRefreshes = 0;
let refusedWiflixRefreshes = null; // Refus de la minute en cours, journalisés en une ligne.

function reserveWiflixRefresh(hasCache) {
  const limit = hasCache ? Math.ceil(WIFLIX_REFRESH_MAX_PER_WORKER / 2) : WIFLIX_REFRESH_MAX_PER_WORKER;
  if (activeWiflixRefreshes < limit) {
    activeWiflixRefreshes++;
    return true;
  }
  if (!refusedWiflixRefreshes) {
    refusedWiflixRefreshes = { stale: 0, missing: 0 };
    setTimeout(() => {
      const { stale, missing } = refusedWiflixRefreshes;
      refusedWiflixRefreshes = null;
      console.warn(`[WIFLIX UPDATE] Plafond de ${WIFLIX_REFRESH_MAX_PER_WORKER} actualisations par worker : ${
        stale + missing} refusées en 1 min (${stale} caches périmés, ${missing} sans cache)`);
    }, 60_000).unref?.();
  }
  refusedWiflixRefreshes[hasCache ? 'stale' : 'missing']++;
  return false;
}

// Réservation et test synchrones, avant toute attente : une rafale de visites
// ne peut pas dépasser le plafond. Les requêtes Flemmix d'un titre sans cache
// (visiteur en 202) attendent leur créneau du débit global plus longtemps que
// celles d'un cache périmé, déjà servi.
const updateWiflixCache = (cacheDir, cacheKey, type, tmdbId, season = null, { hasCache = false } = {}) => {
  if (!reserveWiflixRefresh(hasCache)) return Promise.resolve();
  return runWithWiflixPriority(hasCache ? 'stale' : 'missing',
    () => runWiflixCacheUpdate(cacheDir, cacheKey, type, tmdbId, season))
    .finally(() => { activeWiflixRefreshes--; });
};

const runWiflixCacheUpdate = async (
  cacheDir,
  cacheKey,
  type,
  tmdbId,
  season = null,
) => {
  // Dedup cross-cluster: only one worker scrapes a given cacheKey at a time
  const lock = await acquireRedisLock(`wiflix:update:${cacheKey}`, {
    ttl: WIFLIX_UPDATE_LOCK_TTL,
    retries: 0, // Don't wait — if another worker is already on it, skip
  });
  if (!lock) return; // Another worker (or this one) is already updating this key
  let leaseLost = false, renewing = false;
  const renewal = setInterval(async () => {
    if (renewing || leaseLost) return;
    renewing = true;
    try { if (!await lock.renew()) leaseLost = true; }
    finally { renewing = false; }
  }, 20000);
  renewal.unref();

  try {
    // Une autre actualisation peut s'être terminée depuis la réponse au visiteur.
    const existingCache = await getFromCacheNoExpiration(cacheDir, cacheKey);
    if (await refreshState.remaining(cacheDir, cacheKey, existingCache) > 0) return;

    let newData;
    if (type === "movie")
      newData = await fetchMovieData(tmdbId, existingCache);
    else if (type === "tv")
      newData = await fetchWiflixTvData(tmdbId, season, existingCache);
    else throw new Error(`Type non supporte: ${type}`);

    if (
      typeof newData === "string" &&
      newData.includes("Maintenance en cours")
    )
      throw new Error("Maintenance en cours - donnees invalides");
    if (
      typeof newData === "string" ||
      newData === null ||
      newData === undefined
    )
      throw new Error("Donnees invalides - non-JSON");

    if (newData) {
      if (leaseLost || !await lock.renew()) {
        reportRefreshFailure('refresh_lock_lost', 'Publication abandonnée : bail d’actualisation perdu', {
          source: 'Wiflix/Flemmix', type, id: tmdbId, season,
        }, redis);
        return;
      }
      const isFailedResult = newData.success === false;
      // Les extracteurs peuvent également retourner l'ancien objet sur panne.
      // Une source indisponible ne publie rien : ni cache négatif, ni écrasement,
      // ni nouvelle date pour un ancien cache négatif.
      if (newData === existingCache || newData.unavailable === true
        || (isFailedResult && existingCache?.success)) {
        await refreshState.defer(cacheDir, cacheKey);
        return;
      }
      // Jamais de page HTML de diagnostic en cache, négatifs compris.
      const { debugHtml: _dh, ...cacheableData } = newData;
      const saved = await saveToCache(cacheDir, cacheKey, cacheableData);
      // Un introuvable publié est une réponse de la source : la reprise
      // progressive repart de zéro, comme après un succès.
      if (saved === false) await refreshState.defer(cacheDir, cacheKey);
      else await refreshState.clear(cacheDir, cacheKey);
    }
  } catch (error) {
    // Débit global atteint : déjà relevé une fois par minute par la porte.
    if (!isWiflixRateLimited(error)) console.error(`[WIFLIX UPDATE] ${type} ${tmdbId}: ${error.message}`);
    await refreshState.defer(cacheDir, cacheKey).catch((retryError) => {
      console.error(`[WIFLIX UPDATE] Délai de reprise non enregistré: ${retryError.message}`);
    });
  } finally {
    clearInterval(renewal);
    await lock.release();
  }
};

// === Routes ===

// GET /movie/:tmdbId
router.get("/movie/:tmdbId", async (req, res) => {
  const { tmdbId } = req.params;
  const cacheKey = generateCacheKey(`wiflix_movie_${tmdbId}`);
  const cacheDir = path.join(__dirname, "..", "cache", "wiflix");

  try {
    await fsp.mkdir(cacheDir, { recursive: true });

    const cachedData = await getFromCacheNoExpiration(cacheDir, cacheKey);
    let dataReturned = false;

    if (cachedData) {
      const remaining = await refreshState.remaining(cacheDir, cacheKey, cachedData).catch(() => 0);
      const shouldSkipUpdate = remaining > 0;
      const nextUpdateIn = shouldSkipUpdate ? formatNextUpdate(remaining) : 'imminent';

      await respondWithMovieSources(req, res, { ...cachedData, next_update_in: nextUpdateIn });
      dataReturned = true;

      if (!shouldSkipUpdate)
        updateWiflixCache(cacheDir, cacheKey, "movie", tmdbId, null, { hasCache: true });
    }

    if (!dataReturned) {
      res.status(202).json({
        success: false,
        pending: true,
        message: "Recherche en cours, reessayez dans quelques secondes",
        tmdb_id: tmdbId,
      });

      updateWiflixCache(cacheDir, cacheKey, "movie", tmdbId, null, { hasCache: false });
    }
  } catch (error) {
    console.error(`[WIFLIX MOVIE] Erreur: ${error.message}`);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: "Erreur lors de la recuperation des donnees Wiflix",
        message: error.message,
        tmdb_id: tmdbId,
      });
    }
  }
});

// GET /tv/:tmdbId/:season
router.get("/tv/:tmdbId/:season", async (req, res) => {
  const { tmdbId, season } = req.params;
  if (!/^[1-9]\d*$/.test(tmdbId) || !/^\d+$/.test(season)) {
    return res.status(400).json({ success: false, error: 'Identifiant TMDB ou saison invalide' });
  }
  const cacheKey = generateCacheKey(`wiflix_tv_${tmdbId}_${season}`);
  const cacheDir = path.join(__dirname, "..", "cache", "wiflix");

  try {
    await fsp.mkdir(cacheDir, { recursive: true });

    const cachedData = await getFromCacheNoExpiration(cacheDir, cacheKey);
    let dataReturned = false;

    if (cachedData) {
      const remaining = await refreshState.remaining(cacheDir, cacheKey, cachedData).catch(() => 0);
      const shouldSkipUpdate = remaining > 0;
      const nextUpdateIn = shouldSkipUpdate ? formatNextUpdate(remaining) : 'imminent';

      await respondWithEpisodeSources(req, res, { ...cachedData, next_update_in: nextUpdateIn });
      dataReturned = true;

      if (!shouldSkipUpdate)
        updateWiflixCache(cacheDir, cacheKey, "tv", tmdbId, season, { hasCache: true });
    }

    if (!dataReturned) {
      res.status(202).json({
        success: false,
        pending: true,
        message: "Recherche en cours, reessayez dans quelques secondes",
        tmdb_id: tmdbId,
        season: parseInt(season),
      });

      updateWiflixCache(cacheDir, cacheKey, "tv", tmdbId, season, { hasCache: false });
    }
  } catch (error) {
    console.error(`[WIFLIX TV] Erreur: ${error.message}`);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: "Erreur lors de la recuperation des donnees Wiflix",
        message: error.message,
        tmdb_id: tmdbId,
        season,
      });
    }
  }
});

module.exports = router;
