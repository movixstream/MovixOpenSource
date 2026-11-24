/**
 * AnimeSama route module.
 * Extracted from server.js -- handles anime search, season/episode scraping, and caching.
 *
 * Mounted as: app.use('/anime', require('./routes/animeSama'));
 * Route paths are relative to the mount point.
 */

const express = require('express');
const router = express.Router();
const fsp = require('fs').promises;
const path = require('path');
const axios = require('axios');
const writeFileAtomic = require('write-file-atomic');
const { createSourceRefresh } = require('../utils/sourceRefresh');
const { createSourceCircuitBreaker, isSourceCircuitOpenError } = require('../utils/sourceCircuitBreaker');
const animeRefresh = createSourceRefresh();
const ANIME_CHECK_INTERVAL = 60 * 60 * 1000;
// Disjoncteur propre au worker, limité aux pages de saison et à /api/lien.php :
// la recherche et la fiche peuvent répondre 200 pendant que la bordure bloque
// le reste (403). Trois échecs d'affilée suspendent ces lectures 5 min, puis un
// seul essai passe. Un 404 (langue ou lien absent) compte comme une réponse
// normale, comme un refus de /api/lien.php lui-même (jeton expiré…).
const animeSamaSeasonCircuit = createSourceCircuitBreaker({ name: 'Anime-Sama saisons', logger: console });

const { ANIME_SAMA_CACHE_DIR, generateCacheKey } = require('../utils/cacheManager');
const { memoryCache } = require('../config/redis');
const { buildM3u8Map } = require('../utils/embedExtraction');
const { createDeadPlayerList, isDeadPlayerUrl } = require('../utils/animeSamaDeadPlayers');
const {
  LANGUAGE_IDS,
  parseTitlePage,
  parseSeasonPage,
  parseEpisodeListCalls,
  episodeLabelsFromCalls,
} = require('../utils/animeSamaPages');
const { createLinkResolver, isLinkTokenError, isLinkRateError } = require('../utils/animeSamaLinks');
const DEBUG_ANIMESAMA = process.env.DEBUG_ANIMESAMA === 'true';

// Anime-Sama est le seul catalogue dont les lecteurs sont des chaînes brutes
// (`players: ["https://…"]`) et non des objets : impossible d'y greffer un
// champ `m3u8Url` sans casser la forme de la réponse. On joint donc à l'épisode
// une table `m3u8ByPlayer` en parallèle, que le client consulte par lien.
//
// La résolution ne porte que sur l'épisode désigné par `?season=&episode=` :
// le client n'envoie que des identifiants, jamais d'URL, et le catalogue
// entier n'est jamais extrait.
async function respondWithAnimeSources(req, res, animes) {
  if (String(req.query.resolve || '') !== '1') return res.json(animes);

  const seasonNum = Number.parseInt(req.query.season, 10);
  const episodeNum = Number.parseInt(req.query.episode, 10);
  if (!Number.isInteger(seasonNum) || !Number.isInteger(episodeNum)) return res.json(animes);

  const accessKey = req.headers['x-access-key'] || null;

  try {
    const { verifyAccessKey } = require('../checkVip');
    const vipStatus = await verifyAccessKey(accessKey);
    if (!vipStatus?.vip) return res.json(animes);

    // `season`/`episode` sont des rangs 1-based côté client.
    const episode = animes?.[0]?.seasons?.[seasonNum - 1]?.episodes?.[episodeNum - 1];
    if (!episode || !Array.isArray(episode.streaming_links)) return res.json(animes);

    const urls = episode.streaming_links.flatMap((link) =>
      Array.isArray(link.players) ? link.players : []
    );

    episode.m3u8ByPlayer = await buildM3u8Map(urls, { accessKey });
    return res.json(animes);
  } catch (error) {
    // L'extraction est un bonus : le catalogue reste servi si elle échoue.
    console.error(`[ANIME-SAMA] Extraction S${seasonNum}E${episodeNum} échouée: ${error.message}`);
    return res.json(animes);
  }
}

// ---- Lazy-bound dependencies injected via configure() ----
let deps = {
  ANIME_SAMA_URL: '',
  axiosAnimeSama: null,
  axiosAnimeSamaRequest: async () => { throw new Error('animeSama not configured'); },
  getFromCacheNoExpiration: async () => null,
  saveToCache: async () => false,
  normalizeAnimeSamaUrls: (data) => data,
  cleanupOldCacheFiles: async () => {},
  migrateOldCacheFiles: async () => {},
  limitConcurrency10: async (fn) => fn(),
  // Lecteurs « hors service » d'anime-sama. Sans requête injectée, seul le
  // relevé de secours s'applique (aucun appel réseau).
  deadPlayerList: createDeadPlayerList(),
  // Verrou par œuvre entre workers (utils/animeSamaShared.js) : null quand un
  // autre worker actualise déjà l'œuvre. Sans Redis injecté, le processus
  // travaille seul.
  acquireRefreshLock: async () => ({ renew: async () => true, release: async () => {} }),
  // Débit commun des demandes à /api/lien.php (utils/animeSamaShared.js).
  linkBudget: null,
  // Index du catalogue (utils/animeSamaIndex.js) : œuvre par ID TMDB, liste du
  // catalogue, planning. Sans lui, ces routes répondent vide.
  animeIndex: null,
  // Page Animes calculée par le serveur (utils/animeHome.js). Sans elle,
  // /anime/home répond « en attente » et le site interroge TMDB lui-même.
  animeHome: null,
  // Une œuvre jamais lue, demandée par son ID TMDB : la réponse attend au plus
  // ce délai la première lecture du site.
  firstScanWaitMs: 12000,
};

function configure(injected) {
  Object.assign(deps, injected);
  // Re-bind normalizeAnimeSamaUrls with the current ANIME_SAMA_URL
  deps.normalizeAnimeSamaUrls = normalizeAnimeSamaUrls;
}

// Adresses des vidéos : une demande à /api/lien.php par lien, jamais deux fois
// le même (carnet de liens par œuvre), et seulement pour l'épisode qu'un
// visiteur va lire (voir Season.resolveEpisode et /anime/episode/<slug>).
const linkResolver = createLinkResolver({
  request: config => deps.axiosAnimeSamaRequest(config),
  circuit: animeSamaSeasonCircuit,
  budget: { take: async () => { await deps.linkBudget?.take?.(); } },
});

// ---- normalizeAnimeSamaUrls (was inline in server.js) ----
const normalizeAnimeSamaUrls = (data) => {
  if (!data) return data;
  const currentDomain = (deps.ANIME_SAMA_URL || '').replace(/\/$/, '');

  const isValidPlayerUrl = (url) => {
    if (typeof url !== 'string' || url.length === 0) return false;
    if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
    if (!url.includes('.')) return false;
    const invalidPatterns = ['_self', 'containerSamedi', '\u00e9lite', 'Sectes', 'prouesses', 'discord.gg'];
    if (invalidPatterns.some(pattern => url.includes(pattern))) return false;
    return true;
  };

    const replaceUrls = (obj, key = null) => {
    if (typeof obj === 'string') {
      let cleanedUrl = obj.replace(/https:\/\/proxy\.movix\.(blog|club|site)\/proxy\//gi, '');
      return cleanedUrl.replace(/https?:\/\/anime-sama\.[a-z]+/gi, currentDomain);
    }
    if (Array.isArray(obj)) {
      if (key === 'players') {
        return obj.map(item => replaceUrls(item)).filter(item => {
          if (item && typeof item === 'object' && item.link) return true;
          return isValidPlayerUrl(item);
        });
      }
      if (key === 'streaming_links') {
        return obj.map(item => replaceUrls(item)).filter(item => item && item.players && item.players.length > 0);
      }
      return obj.map(item => replaceUrls(item));
    }
    if (obj && typeof obj === 'object') {
      const newObj = {};
      for (const [k, value] of Object.entries(obj)) {
        newObj[k] = replaceUrls(value, k);
      }
      return newObj;
    }
    return obj;
  };

  return replaceUrls(data);
};

// ---- Utility functions ----

const splitAndStrip = (str, delimiter) => {
  return str.split(delimiter).map(item => item.trim()).filter(item => item);
};

const removeQuotes = (str) => {
  if (typeof str !== 'string') return str;
  return str.replace(/^["'](.*)["']$/, '$1');
};

const safeFilename = (str) => {
  return str.replace(/[^a-zA-Z0-9\s\-_]/g, '').trim();
};

// Langues qui ont des lecteurs dans le cache d'une saison.
const languagesOf = (episodes) => [...new Set((episodes || []).flatMap(episode =>
  (episode?.streaming_links || []).map(linkObj => linkObj?.language)
).filter(Boolean))];

// Helper function to validate player URLs
const isValidPlayerUrl = (url) => {
  if (typeof url !== 'string' || url.length === 0) return false;
  if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
  if (!url.includes('.')) return false;
  const invalidPatterns = ['_self', 'containerSamedi', '\u00e9lite', 'Sectes', 'prouesses', 'discord.gg'];
  if (invalidPatterns.some(pattern => url.includes(pattern))) return false;
  return true;
};

// Gabarits d'embed sans identifiant : anime-sama les emet quand un lecteur est
// annonce mais vide. Le test porte sur un motif et non sur une URL exacte, car
// ces hebergeurs font tourner leurs TLD — une liste en dur laissait passer le
// meme gabarit sur un nouveau domaine (vidmoly.org apres vidmoly.to).
const EMPTY_PLAYER_PATTERNS = [
  /sibnet\.[a-z0-9-]+\/shell\.php\?videoid=$/i,
  /vidmoly\.[a-z0-9-]+\/embed-\.html$/i,
  /sendvid\.[a-z0-9-]+\/embed\/$/i,
  /vk\.[a-z0-9-]+\/video_ext\.php\?oid=&hd=3$/i,
];

const isEmptyPlayerUrl = (url) =>
  typeof url === 'string' && EMPTY_PLAYER_PATTERNS.some((re) => re.test(url));

// Le cache reprend exactement les saisons du site, dans le même ordre. Avant,
// une saison renommée par anime-sama (« Avec Fillers » devenu « Saison 1 -
// Avec Fillers ») restait en cache sous l'ancien nom et s'affichait en double,
// et les nouvelles saisons s'ajoutaient en fin de liste.
const alignToSiteSeasons = (cache, siteNames) => {
  const seasons = {};
  for (const name of siteNames) {
    if (cache[name] && !(name in seasons)) seasons[name] = cache[name];
  }
  const before = Object.keys(cache).join('\n');
  return { seasons, changed: before !== Object.keys(seasons).join('\n') };
};

// Les épisodes en cache reprennent eux aussi exactement le site. Avant, une
// actualisation ne faisait qu'ajouter : un lecteur supprimé, une langue retirée
// ou un épisode enlevé par anime-sama restait en cache pour toujours.
//
// Une langue porte soit `refs` (format du site depuis le 2026-11-12 : repères
// `{ id, host }` dont l'adresse se demande à la lecture, ou `{ url }`), soit
// `players` (adresses en clair, caches d'avant).
const cachedRefs = refs => refs
  .filter(ref => ref && (typeof ref.url === 'string' || /^\d+$/.test(String(ref.id ?? ''))))
  .map(ref => (typeof ref.url === 'string' ? { url: ref.url } : { id: String(ref.id), host: ref.host || null }));

const toCachedEpisodes = (episodes) => (episodes || []).map(episode => ({
  name: episode.name,
  serie_name: episode.serie_name || episode.serieName,
  season_name: episode.season_name || episode.seasonName,
  index: episode.index,
  streaming_links: (episode.streaming_links || []).map(linkObj => (Array.isArray(linkObj.refs)
    ? { language: linkObj.language, refs: cachedRefs(linkObj.refs) }
    : {
      language: linkObj.language,
      players: (Array.isArray(linkObj.players) ? linkObj.players : []).filter(url => !isEmptyPlayerUrl(url))
    })).filter(linkObj => (linkObj.refs || linkObj.players).length > 0)
}));

// Compare épisodes, langues et lecteurs dans l'ordre ; les métadonnées
// annexes (timestamp, ancien format) ne déclenchent pas de réécriture.
const episodesSignature = (episodes) => JSON.stringify((episodes || []).map(episode => [
  episode.name,
  episode.index,
  (episode.streaming_links || []).map(linkObj => [
    linkObj.language,
    Array.isArray(linkObj.refs)
      ? cachedRefs(linkObj.refs).map(ref => ref.url || `lien:${ref.id}@${ref.host || ''}`)
      : (Array.isArray(linkObj.players) ? linkObj.players.filter(url => !isEmptyPlayerUrl(url)) : [])
  ]).filter(([, players]) => players.length > 0)
]));

const sameEpisodes = (cached, site) => episodesSignature(cached) === episodesSignature(site);

// Vrai si l'adresse est servie par cet hébergeur (`video.sibnet.ru` et `sibnet.ru`).
function sameHost(url, host) {
  if (!host) return false;
  let hostname;
  try { hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return false; }
  const wanted = String(host).toLowerCase().replace(/^www\./, '');
  return hostname === wanted || hostname.endsWith(`.${wanted}`) || wanted.endsWith(`.${hostname}`);
}

// Les caches d'avant le 2026-11-12 portent déjà l'adresse de chaque lecteur.
// Quand le site liste, pour le même épisode et la même langue, un repère chez
// le même hébergeur et dans le même ordre, l'adresse connue est notée au
// carnet : elle ne sera jamais redemandée. Sans ça, tout le catalogue déjà en
// cache repartirait de zéro face à la limite de débit de /api/lien.php.
function seedLinkBookFromLegacy(cachedEpisodes, siteEpisodes, links) {
  let seeded = 0;
  const legacyByIndex = new Map((cachedEpisodes || []).map(episode => [episode.index, episode]));
  for (const episode of siteEpisodes) {
    const legacy = legacyByIndex.get(episode.index);
    if (!legacy) continue;
    for (const linkObj of episode.streaming_links) {
      const known = (legacy.streaming_links || []).find(candidate => candidate.language === linkObj.language);
      if (!Array.isArray(known?.players) || !Array.isArray(linkObj.refs)) continue;
      let cursor = 0;
      for (const ref of linkObj.refs) {
        if (!ref.id || links[ref.id]) continue;
        for (let rank = cursor; rank < known.players.length; rank++) {
          if (!isValidPlayerUrl(known.players[rank]) || !sameHost(known.players[rank], ref.host)) continue;
          links[ref.id] = [known.players[rank], ref.host];
          cursor = rank + 1;
          seeded += 1;
          break;
        }
      }
    }
  }
  return seeded;
}

// Ce qui est servi pour une langue : les adresses connues (`players`) et le
// nombre de lecteurs dont l'adresse reste à demander (`pending`). Un hébergeur
// hors service ne compte ni dans l'un ni dans l'autre.
function materializeLink(linkObj, links, hostStatus) {
  if (!Array.isArray(linkObj?.refs)) return linkObj;
  const players = [];
  let pending = 0;
  for (const ref of linkObj.refs) {
    if (typeof ref.url === 'string') {
      if (isValidPlayerUrl(ref.url) && !isEmptyPlayerUrl(ref.url) && !isDeadPlayerUrl(ref.url, hostStatus)) players.push(ref.url);
      continue;
    }
    if (ref.host && isDeadPlayerUrl(`https://${ref.host}/`, hostStatus)) continue;
    const known = links[ref.id];
    if (!Array.isArray(known) || known[1] !== ref.host) { pending += 1; continue; }
    if (isValidPlayerUrl(known[0]) && !isEmptyPlayerUrl(known[0]) && !isDeadPlayerUrl(known[0], hostStatus)) players.push(known[0]);
  }
  return pending ? { language: linkObj.language, players, pending } : { language: linkObj.language, players };
}

const hasPlayable = linkObj => (Array.isArray(linkObj?.players) && linkObj.players.length > 0) || linkObj?.pending > 0;

// ---- Rangement du cache ----
//
// Une œuvre est rangée sous son slug (`/catalogue/<slug>/`), stable, et non
// plus sous son nom : la recherche d'anime-sama écrit le même nom de
// plusieurs façons (`l'` ou `l&#039;`), ce qui donnait deux caches pour une
// œuvre, et l'index par ID TMDB ne connaît que le slug.
//
//   oeuvres/<slug>.json  saisons, épisodes et lecteurs (ce qui est servi)
//   liens/<slug>.json    carnet de liens : n° → [adresse, hébergeur annoncé]
//   <nom>.json           ancien rangement : lu tant que l'œuvre n'a pas été
//                        actualisée, puis retiré
const TITLE_CACHE_DIR = 'oeuvres';
const LINK_BOOK_DIR = 'liens';
const SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

const isSlug = slug => typeof slug === 'string' && slug.length <= 200 && SLUG_PATTERN.test(slug);

// Slug d'une adresse de fiche, ou null si elle n'en porte pas un sûr.
function slugOfUrl(url) {
  const slug = /\/catalogue\/([^/?#]+)/.exec(String(url || ''))?.[1]?.toLowerCase();
  return isSlug(slug) ? slug : null;
}

// Chemin d'une adresse anime-sama, sans hôte ni paramètres.
const pathOfUrl = url => String(url || '').replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, '').split(/[?#]/)[0];

// Page d'une saison ou d'une langue (`/catalogue/<œuvre>/saison2/vf/`), pas
// la fiche de l'œuvre. D'anciens caches de recherche en gardent : lue comme
// une fiche, elle est illisible, et son nom déduit de l'adresse vaut « vf ».
const isSeasonPageUrl = url => /\/catalogue\/[^/]+\/[^/]+/.test(pathOfUrl(url));

// Adresse de la fiche de l'œuvre d'une page anime-sama, ou null sans slug sûr.
function ficheUrlOf(url) {
  const slug = slugOfUrl(url);
  return slug ? `${deps.ANIME_SAMA_URL}catalogue/${slug}/` : null;
}

// Nom d'une œuvre donnée par une page de saison : un nom qui n'est qu'un
// segment de l'adresse (« vf », « saison2 ») est remplacé par le slug.
function titleNameFor(url, name) {
  const text = String(name || '').trim();
  if (!isSeasonPageUrl(url)) return text;
  const segments = pathOfUrl(url).toLowerCase().split('/').filter(Boolean);
  return text && !segments.includes(text.toLowerCase()) ? text : (slugOfUrl(url) || text);
}

// Entrée de recherche ramenée à la fiche de son œuvre.
function repairSearchEntry(entry) {
  if (!entry || !isSeasonPageUrl(entry.url) || !ficheUrlOf(entry.url)) return entry;
  return { ...entry, url: ficheUrlOf(entry.url), name: titleNameFor(entry.url, entry.name) };
}

// Une œuvre une seule fois (la fiche et une de ses saisons ramenée à la fiche).
function uniqueTitles(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    const key = slugOfUrl(entry?.url) || entry?.url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cachePathsFor(anime) {
  const slug = slugOfUrl(anime.url);
  const safeName = safeFilename(String(anime.name || ''));
  const legacyPath = path.join(ANIME_SAMA_CACHE_DIR, `${safeName}.json`);
  const key = slug || safeName;
  return {
    key,
    safeName,
    legacyPath,
    titlePath: slug ? path.join(ANIME_SAMA_CACHE_DIR, TITLE_CACHE_DIR, `${slug}.json`) : legacyPath,
    linksPath: path.join(ANIME_SAMA_CACHE_DIR, LINK_BOOK_DIR, `${key}.json`),
  };
}

// Cache d'une œuvre : `{ file, legacy, mtime, data }`, ou null s'il n'existe
// pas (ou n'est pas lisible). Le nouveau rangement passe avant l'ancien.
// `withStat` (actualisation) : lit aussi la date du fichier, et lève sur un
// fichier illisible au lieu de le prendre pour un cache absent.
async function readTitleCache(anime, { withStat = false } = {}) {
  const paths = cachePathsFor(anime);
  for (const file of [...new Set([paths.titlePath, paths.legacyPath])]) {
    try {
      const mtime = withStat ? (await fsp.stat(file)).mtime.getTime() : 0;
      const data = JSON.parse(await fsp.readFile(file, 'utf-8'));
      if (data && typeof data === 'object') return { file, legacy: file !== paths.titlePath, mtime, data };
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      if (withStat) throw error;
      console.error(`Error reading unified cache for ${anime.name}:`, error.message);
    }
  }
  return null;
}

// Carnet de liens d'une œuvre : n° → [adresse, hébergeur annoncé par la page
// au moment de la demande]. Un carnet absent ou illisible est un carnet vide :
// les adresses seront redemandées, rien d'autre.
async function readLinkBook(file) {
  const book = {};
  try {
    const raw = JSON.parse(await fsp.readFile(file, 'utf-8'));
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [id, entry] of Object.entries(raw)) {
        if (/^\d+$/.test(id) && Array.isArray(entry) && typeof entry[0] === 'string') {
          book[id] = [entry[0], typeof entry[1] === 'string' ? entry[1] : null];
        }
      }
    }
  } catch { /* carnet absent ou illisible */ }
  return book;
}

async function writeCacheFile(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await writeFileAtomic(file, JSON.stringify(value), 'utf-8');
}

// Ajoute des adresses au carnet d'une œuvre sans perdre celles qu'un autre
// travail y a notées entre-temps (lecture d'un épisode pendant une
// actualisation). `keepOnly` : repères encore listés par le site ; les autres
// quittent le carnet. Rend le carnet enregistré, ou null s'il n'a pas pu
// l'être : il faudra alors seulement redemander ces adresses.
async function updateLinkBook(file, added, { keepOnly = null, label = '' } = {}) {
  try {
    const current = await readLinkBook(file);
    const merged = { ...current, ...added };
    if (keepOnly) {
      for (const id of Object.keys(merged)) if (!keepOnly.has(id)) delete merged[id];
    }
    const changed = Object.keys(merged).length !== Object.keys(current).length
      || Object.entries(merged).some(([id, entry]) => current[id]?.[0] !== entry[0] || current[id]?.[1] !== entry[1]);
    if (changed) await writeCacheFile(file, merged);
    return merged;
  } catch (error) {
    console.error(`[ANIME-SAMA] Carnet de liens de ${label} non enregistré : ${error.message}`);
    return null;
  }
}

// ---- Classes ----

class Season {
  constructor(url, name = "", serieName = "", client = null, announcedLang = null, seasonPath = "") {
    const normalizedUrl = url.endsWith('/') ? url : url + '/';
    this.url = normalizedUrl;
    this.siteUrl = url.split('/').slice(0, 3).join('/') + '/';

    this.name = name || url.split('/').slice(-2)[0];
    this.serieName = serieName || url.split('/').slice(-3)[0];
    // Chemin de la saison sous la fiche (« saison1 », « film ») : son identifiant stable.
    this.path = seasonPath || normalizedUrl.split('/').filter(Boolean).slice(-1)[0];
    // Langue du lien `panneauAnime` de la fiche : sa page existe à coup sûr.
    this.announcedLang = LANGUAGE_IDS.includes(announcedLang) ? announcedLang : LANGUAGE_IDS[0];
    // Vrai après `episodes()` si la page de la saison existe sans aucun épisode :
    // c'est anime-sama qui l'a vidée (saison masquée, « Bientôt de retour »).
    this.emptiedBySite = false;
    // Repères (`lien:<n°>`) que le site liste encore pour cette saison.
    this.usedLinkIds = new Set();

    this.client = client || deps.axiosAnimeSama;
  }

  pageUrl(lang) {
    return `${this.url}${lang}/`;
  }

  // Lecteurs d'un épisode tels que la page les liste : repères `{ id, host }`
  // et adresses en clair `{ url }`, sans les vidéos que le site marque supprimées.
  static refsOf(players) {
    const refs = [];
    for (const player of players || []) {
      if (typeof player.url === 'string') {
        if (isValidPlayerUrl(player.url)) refs.push({ url: player.url });
      } else if (player.id && !player.removed) {
        refs.push({ id: player.id, host: player.host || null });
      }
    }
    return refs;
  }

  // Page de la saison dans une langue, ou null si elle n'existe pas (404) ou
  // n'est pas une page de saison. Une panne (403, 5xx, délai, pause du
  // disjoncteur) lève : elle ne doit jamais passer pour une langue absente.
  async _readPage(lang) {
    const url = this.pageUrl(lang);
    let response;
    try {
      response = await animeSamaSeasonCircuit.run(() => deps.axiosAnimeSamaRequest({ method: 'get', url, timeout: 10000 }));
    } catch (error) {
      if (error?.response?.status === 404) return null;
      throw error;
    }
    if (response?.status !== undefined && response.status !== 200) {
      if (response.status === 404) return null;
      throw Object.assign(new Error(`AnimeSama saison HTTP ${response.status}`), { httpStatus: response.status });
    }
    const page = parseSeasonPage(response?.data);
    if (!page.valid) return null;
    return { ...page, url, html: response.data };
  }

  // `knownLangs` : langues qui ont des lecteurs dans le cache de la saison.
  // Rend [] sans `emptiedBySite` quand la page de la saison est introuvable ou
  // illisible : l'appelant garde alors son cache.
  async episodes(strict = false, { knownLangs = [] } = {}) {
    this.emptiedBySite = false;
    this.usedLinkIds = new Set();
    try {
      return await this._scan(knownLangs);
    } catch (error) {
      if (strict) throw error;
      return [];
    }
  }

  // Une page par langue, aucune demande d'adresse : l'adresse d'un lecteur se
  // demande quand son épisode est lu (`resolveEpisode`). /api/lien.php limite
  // le débit par IP (environ 300 demandes par tranche de 10 min) ; demander
  // d'avance les adresses de toute une œuvre y passerait en quelques secondes.
  async _scan(knownLangs) {
    // La langue annoncée est lue seule d'abord. Un blocage (403…) y arrête la
    // saison sans lancer les autres langues.
    const first = await this._readPage(this.announcedLang);
    if (!first) return [];
    // La même page porte la table des lecteurs hors service (en rouge sur le site).
    deps.deadPlayerList?.learn?.(first.html);

    // Ensuite, les langues que la page publie (`languesDispo`), plus celles du
    // cache : une table en retard ne doit jamais retirer une langue déjà connue,
    // et un échec passager sur l'une d'elles fait échouer l'actualisation au
    // lieu de la faire disparaître.
    const others = [...new Set([...(first.langs || []), ...knownLangs])]
      .filter(lang => lang !== this.announcedLang && LANGUAGE_IDS.includes(lang));
    // Attendre aussi les langues restantes avant de libérer la tâche commune.
    const outcomes = await Promise.allSettled(others.map(lang => this._readPage(lang)));
    const failure = outcomes.find(outcome => outcome.status === 'rejected');
    if (failure) throw failure.reason;
    const pages = new Map([[this.announcedLang, first]]);
    others.forEach((lang, rank) => { if (outcomes[rank].value) pages.set(lang, outcomes[rank].value); });

    const episodesInSeason = Math.max(0, ...[...pages.values()].map(page => page.episodeCount));
    this.emptiedBySite = episodesInSeason === 0;

    // Les noms viennent de la liste du site (« Episode 62 » en saison 2 de
    // One Piece) ; sans liste lisible, la numérotation reste 1, 2, 3…
    const padding = episodesInSeason.toString().length;
    const siteLabels = episodeLabelsFromCalls(first.listCalls, episodesInSeason) || [];

    // Le scan rend exactement ce que publie anime-sama : un lecteur, une langue
    // ou un épisode retiré du site disparaît aussi du résultat.
    const episodes = [];
    for (let index = 0; index < episodesInSeason; index++) {
      const streamingLinks = [];
      for (const lang of LANGUAGE_IDS) {
        const page = pages.get(lang);
        if (!page) continue;
        const refs = Season.refsOf(page.episodes[index]);
        for (const ref of refs) if (ref.id) this.usedLinkIds.add(ref.id);
        if (refs.length) streamingLinks.push({ language: lang, refs });
      }
      episodes.push({
        name: siteLabels[index] || `Episode ${(index + 1).toString().padStart(padding, '0')}`,
        serie_name: this.serieName,
        season_name: this.name,
        index: index + 1,
        streaming_links: streamingLinks,
      });
    }
    return episodes;
  }

  /**
   * Demande au site l'adresse des lecteurs de l'épisode `index` (à partir de
   * 1) que le carnet ne connaît pas encore, dans les langues données. Un lien
   * supprimé ou d'un hébergeur hors service n'est jamais demandé ; un lien dont
   * l'hébergeur annoncé a changé l'est de nouveau.
   *
   * `links` (le carnet) est complété au fil des réponses : une panne en route
   * lève, mais garde les adresses déjà reçues. Rend, par langue lue, les
   * lecteurs que la page liste à l'instant (`fresh`) et le nombre d'adresses
   * reçues (`resolved`).
   */
  async resolveEpisode(index, langs, links, hostStatus, fresh = new Map()) {
    let resolved = 0;
    for (const lang of langs) {
      const page = await this._readPage(lang);
      if (!page) continue;
      const refs = Season.refsOf(page.episodes[index - 1]);
      fresh.set(lang, refs);

      const hosts = new Map();
      for (const ref of refs) {
        if (!ref.id) continue;
        if (ref.host && isDeadPlayerUrl(`https://${ref.host}/`, hostStatus)) continue;
        const known = links[ref.id];
        if (!Array.isArray(known) || known[1] !== ref.host) hosts.set(ref.id, ref.host);
      }
      if (!hosts.size) continue;
      if (!page.token) throw new Error(`Page de saison AnimeSama sans jeton : ${this.name}`);

      const received = new Set();
      const ask = token => linkResolver.resolve({
        pageUrl: page.url,
        token,
        ids: [...hosts.keys()].filter(id => !received.has(id)),
        onLink: (id, url) => {
          links[id] = [url, hosts.get(id)];
          received.add(id);
          resolved += 1;
        },
      });
      try {
        await ask(page.token);
      } catch (error) {
        if (!isLinkTokenError(error)) throw error;
        // Jeton refusé : la page est relue une fois pour en prendre un neuf.
        const reread = await this._readPage(lang);
        if (!reread?.token) throw error;
        await ask(reread.token);
      }
    }
    return { fresh, resolved };
  }
}

class Catalogue {
  constructor(url, name = "", client = null, additionalData = null) {
    if (url.startsWith('/')) {
      this.url = deps.ANIME_SAMA_URL + url.substring(1);
    } else if (url.startsWith('http')) {
      try {
        const urlObj = new URL(url);
        let urlPath = urlObj.pathname;
        if (urlPath.startsWith('/')) urlPath = urlPath.substring(1);
        this.url = deps.ANIME_SAMA_URL + urlPath + urlObj.search;
      } catch (e) {
        console.error("Error parsing URL in Catalogue constructor:", url);
        this.url = url;
      }
    } else {
      this.url = url.endsWith('/') ? url : url + '/';
    }
    // La recherche d'anime-sama rend parfois l'adresse sans barre finale.
    if (!this.url.includes('?') && !this.url.endsWith('/')) this.url += '/';
    // Une page de saison (ancien cache) se lit depuis la fiche de son œuvre.
    const seasonPage = isSeasonPageUrl(this.url) && ficheUrlOf(this.url);
    this.name = (seasonPage ? titleNameFor(this.url, name) : name) || url.split('/').slice(-2)[0];
    if (seasonPage) this.url = seasonPage;
    this.siteUrl = url.split('/').slice(0, 3).join('/') + '/';
    this.client = client || deps.axiosAnimeSama;
    this.slug = slugOfUrl(this.url);
    // Fiche lue par `seasons()` : identifiants externes, genres, saisons masquées…
    this.fiche = null;

    if (additionalData) {
      this.image = additionalData.image || '';
      this.alternative_names = additionalData.alternative_names || [];
      this.alternative_names_string = additionalData.alternative_names_string || '';
    } else {
      this.image = '';
      this.alternative_names = [];
      this.alternative_names_string = '';
    }
  }

  // Saisons visibles de la fiche. Une fiche lisible sans aucune saison (saisons
  // masquées par anime-sama, œuvre en scans seulement) rend [] ; une page qui
  // n'est pas une fiche lève, pour ne jamais passer pour une œuvre sans anime.
  async seasons(strict = false) {
    try {
      const response = await deps.axiosAnimeSamaRequest({
        method: 'get',
        url: this.url
      });
      const fiche = parseTitlePage(String(response.data ?? ''), { slug: this.slug || '' });
      if (!fiche.valid) throw new Error('Fiche AnimeSama illisible');
      this.fiche = fiche;

      const baseUrl = this.url.split('?')[0];
      return fiche.seasons.map(season => new Season(
        `${baseUrl}${season.path}/`,
        season.name,
        this.name,
        this.client,
        season.lang,
        season.path
      ));
    } catch (error) {
      if (strict) throw error;
      console.error(`Error getting seasons for ${this.name}:`, error.message);
      return [];
    }
  }
}

class AnimeSama {
  constructor(siteUrl) {
    this.siteUrl = siteUrl;
    this.client = deps.axiosAnimeSama;
  }

  async search(query, forceNoCache = false) {
    try {
      const cacheKey = generateCacheKey(query);
      if (!forceNoCache) {
        const cachedResults = await deps.getFromCacheNoExpiration(ANIME_SAMA_CACHE_DIR, cacheKey);
        if (cachedResults) {
          return cachedResults.map(result =>
            new Catalogue(result.url, result.name, this.client, result)
          );
        }
      }

      const requestUrl = `${this.siteUrl}template-php/defaut/fetch.php`;
      const requestData = `query=${encodeURIComponent(query)}`;
      if (DEBUG_ANIMESAMA) {
        console.log(`\n[AnimeSama Search] DEBUG INFO:`);
        console.log(`[AnimeSama Search] Query: ${query}`);
        console.log(`[AnimeSama Search] URL: ${requestUrl}`);
        console.log(`[AnimeSama Search] Payload: ${requestData}`);
      }

      const response = await deps.axiosAnimeSamaRequest({
        method: 'post',
        url: requestUrl,
        data: requestData,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      if (DEBUG_ANIMESAMA) {
        console.log(`[AnimeSama Search] Response status: ${response.status}`);
        console.log(`[AnimeSama Search] Response content-type: ${response.headers?.['content-type'] || 'n/a'}`);
      }

      if (response.status !== 200) {
        console.warn(`[AnimeSama Search] Recherche interrompue : HTTP ${response.status}`);
        if (DEBUG_ANIMESAMA) console.log('[AnimeSama Search] Body snippet:', typeof response.data === 'string' ? response.data.slice(0, 500) : response.data);
        return [];
      }

      const responseData = response.data;
      if (DEBUG_ANIMESAMA) {
        const bodyLen = typeof responseData === 'string' ? responseData.length : -1;
        console.log(`[AnimeSama Search] Body length: ${bodyLen}`);
        if (typeof responseData === 'string') {
          console.log(`[AnimeSama Search] Body snippet (first 500):`, responseData.slice(0, 500));
          console.log(`[AnimeSama Search] Body snippet (last 500):`, responseData.slice(-500));
        }
      }

      const results = this.parseSearchResults(responseData);
      if (DEBUG_ANIMESAMA) console.log(`[AnimeSama Search] parseSearchResults -> ${results.length} results`);

      await deps.saveToCache(ANIME_SAMA_CACHE_DIR, cacheKey, results);

      return results.map(result =>
        new Catalogue(result.url, result.name, this.client, result)
      );
    } catch (error) {
      console.error(`[AnimeSama Search] Échec : ${error.message} (HTTP ${error.response?.status || 'indisponible'})`);
      if (DEBUG_ANIMESAMA) {
        console.log(`[AnimeSama Search] Query: ${query}`);
        if (error.response) console.log('[AnimeSama Search] Response Data:', JSON.stringify(error.response.data, null, 2));
        if (error.config) console.log('[AnimeSama Search] Request Config URL:', error.config.url);
      }
      return [];
    }
  }

  parseSearchResults(htmlData) {
    const results = [];

    try {
      if (typeof htmlData !== 'string') {
        console.warn('[AnimeSama Parse] htmlData is not a string, type:', typeof htmlData);
        return [];
      }

      if (DEBUG_ANIMESAMA) {
        const allAnchors = (htmlData.match(/<a\b/gi) || []).length;
        const asnAnchors = (htmlData.match(/class="asn-search-result"/gi) || []).length;
        const catalogueHrefs = (htmlData.match(/href="[^"]*\/catalogue\/[^"]*"/gi) || []).length;
        console.log(`[AnimeSama Parse] anchors=${allAnchors} asn-class=${asnAnchors} catalogue-hrefs=${catalogueHrefs}`);
      }

      const anchorRegex = /<a\b([^>]*\bclass="asn-search-result"[^>]*)>([\s\S]*?)<\/a>/gi;
      let match;
      let iterations = 0;

      while ((match = anchorRegex.exec(htmlData)) !== null) {
        iterations++;
        const attrs = match[1];
        const inner = match[2];

        const hrefMatch = attrs.match(/href="([^"]+)"/i);
        if (!hrefMatch) {
          if (DEBUG_ANIMESAMA) console.log(`[AnimeSama Parse] block #${iterations}: no href in attrs:`, attrs.slice(0, 200));
          continue;
        }
        const href = hrefMatch[1];

        if (!href.includes('/catalogue/')) {
          if (DEBUG_ANIMESAMA) console.log(`[AnimeSama Parse] block #${iterations}: skipped (not catalogue): ${href}`);
          continue;
        }
        if (!/\/catalogue\/[a-zA-Z0-9][a-zA-Z0-9\-_.]+/.test(href)) {
          if (DEBUG_ANIMESAMA) console.log(`[AnimeSama Parse] block #${iterations}: skipped (bad slug): ${href}`);
          continue;
        }

        const imgMatch = inner.match(/<img\b[^>]*\bsrc="([^"]+)"/i);
        const imageUrl = imgMatch ? imgMatch[1] : '';

        const titleMatch = inner.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i);
        const mainTitle = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';

        const subtitleMatch = inner.match(/<p\b[^>]*class="asn-search-result-subtitle"[^>]*>([\s\S]*?)<\/p>/i);
        const alternativeNames = subtitleMatch ? subtitleMatch[1].replace(/<[^>]+>/g, '').trim() : '';

        const altNamesArray = alternativeNames
          ? alternativeNames.split(',').map(name => name.trim()).filter(name => name.length > 0)
          : [];

        if (mainTitle) {
          results.push({
            url: ficheUrlOf(href) && isSeasonPageUrl(href) ? ficheUrlOf(href) : href,
            name: titleNameFor(href, mainTitle),
            image: imageUrl,
            alternative_names: altNamesArray,
            alternative_names_string: alternativeNames
          });
        } else {
          if (DEBUG_ANIMESAMA) console.log(`[AnimeSama Parse] block #${iterations}: skipped (no title). inner snippet:`, inner.slice(0, 300));
        }
      }

      if (DEBUG_ANIMESAMA) console.log(`[AnimeSama Parse] iterations=${iterations} kept=${results.length}`);
      return uniqueTitles(results);
    } catch (error) {
      console.error('[AnimeSama Parse] Error:', error.message);
      return [];
    }
  }
}

// Episode cache for Anime Sama
class EpisodeCache {
  constructor(cacheDir = ANIME_SAMA_CACHE_DIR, ttl = 3600) {
    this.cacheDir = cacheDir;
    this.ttl = ttl * 1000;
  }

  _getCachePath(serieName) {
    const safeSerie = safeFilename(serieName);
    return path.join(this.cacheDir, `${safeSerie}.json`);
  }

  async getAnimeData(serieName) {
    const cachePath = this._getCachePath(serieName);

    try {
      const fileContent = await fsp.readFile(cachePath, 'utf-8');
      const data = deps.normalizeAnimeSamaUrls(JSON.parse(fileContent));

      if (Date.now() - data.timestamp > this.ttl) {
        return null;
      }

      return data.seasons || {};
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('Error reading cache:', error);
      }
      return null;
    }
  }

  async getEpisodes(serieName, seasonName) {
    const animeData = await this.getAnimeData(serieName);
    if (!animeData) return null;

    const seasonData = animeData[seasonName];
    return seasonData ? seasonData.episodes : null;
  }

  async saveAnimeData(serieName, seasonsData) {
    const cachePath = this._getCachePath(serieName);

    const data = {
      timestamp: Date.now(),
      seasons: seasonsData
    };

    try {
      await writeFileAtomic(cachePath, JSON.stringify(data), 'utf-8');
      await memoryCache.set(`anime:${serieName}`, data);
    } catch (error) {
      console.error('Error saving cache:', error);
    }
  }

  async saveEpisodes(serieName, seasonName, episodesData) {
    let animeData = await this.getAnimeData(serieName) || {};

    animeData[seasonName] = {
      timestamp: Date.now(),
      episodes: episodesData
    };

    await this.saveAnimeData(serieName, animeData);
  }
}

// ---- Actualisation d'une œuvre ----

const refreshFailureLabel = (error) => {
  const status = Number(error?.response?.status ?? error?.httpStatus);
  return Number.isInteger(status) ? `HTTP ${status}` : String(error?.code || error?.message || 'erreur').slice(0, 120);
};

// Disjoncteur ouvert : l'actualisation est sautée sans rien écrire ni mémoriser
// d'échec. C'est une indisponibilité temporaire, jamais un cache négatif : le
// cache existant reste servi. Les vrais échecs sont journalisés ici, une fois
// par essai ; le .catch de l'appelant reçoit aussi l'échec mémorisé, rejoué à
// chaque recherche pendant 60 s.
function guardAnimeRefresh(animeName, task) {
  return async () => {
    if (animeSamaSeasonCircuit.isOpen()) return;
    try {
      return await task();
    } catch (error) {
      if (isSourceCircuitOpenError(error)) return;
      console.warn(`[ANIME-SAMA] Actualisation de ${animeName} échouée : ${refreshFailureLabel(error)}`);
      throw error;
    }
  };
}

// Relit une œuvre sur anime-sama et aligne son cache sur le site : au plus une
// fois par heure, par un seul worker à la fois. Ne lève jamais.
function refreshAnime(anime, client) {
  const paths = cachePathsFor(anime);
  return animeRefresh.run(paths.titlePath, guardAnimeRefresh(anime.name, async () => {
    let source = null;
    try {
      source = await readTitleCache(anime, { withStat: true });
    } catch (error) {
      // Cache illisible (JSON tronqué) : il sera réécrit.
      if (!(error instanceof SyntaxError)) throw error;
    }
    const existingData = source?.data || {};
    const originalMtime = source?.mtime || 0;
    if (animeRefresh.recentlyChecked(paths.titlePath, ANIME_CHECK_INTERVAL)) return;
    if (source && Date.now() - Math.max(originalMtime, Number(existingData.lastCheckedAt) || 0) < ANIME_CHECK_INTERVAL) return;

    // Une œuvre se lit en plusieurs pages (la fiche, puis une page par saison
    // et par langue) : un seul worker s'en charge. Ni « vérifié » ni « en
    // échec » pour les autres, qui réessaieront à la recherche suivante.
    const lock = await deps.acquireRefreshLock(`animesama:actualisation:${paths.key}`);
    if (!lock) return;
    const keepAlive = setInterval(() => { Promise.resolve(lock.renew()).catch(() => {}); }, 30000);
    keepAlive.unref?.();

    // Carnet de liens : lu pour savoir ce qui est déjà connu. Ce passage n'y
    // ajoute que les adresses reprises d'un cache d'avant le 2026-11-12.
    const links = await readLinkBook(paths.linksPath);
    const knownBefore = new Set(Object.keys(links));

    try {
      const existingAnimeCache = existingData.seasons || {};
      const catalogueObj = new Catalogue(anime.url, anime.name, client, anime);
      const seasonsList = await catalogueObj.seasons(true);
      // La fiche vient d'être lue : l'index du catalogue en profite (ID TMDB…).
      if (catalogueObj.slug && typeof deps.animeIndex?.recordTitle === 'function') {
        Promise.resolve().then(() => deps.animeIndex.recordTitle(catalogueObj.slug, catalogueObj.fiche)).catch(() => {});
      }
      if (!seasonsList.length && Object.keys(existingAnimeCache).length) {
        const reason = catalogueObj.fiche?.hiddenSeasons
          ? `${catalogueObj.fiche.hiddenSeasons} saison(s) masquée(s) par anime-sama`
          : 'plus aucune saison d’anime sur la fiche';
        console.log(`[ANIME-SAMA] ${anime.name} : ${reason}, cache vidé`);
      }

      // Un cache encore rangé par nom est repris sous son slug.
      let animeDataUpdated = Boolean(source?.legacy);
      let updatedAnimeCache = { ...existingAnimeCache };
      const unreadable = [];
      const usedLinkIds = new Set();

      for (const seasonObj of seasonsList) {
        const seasonCache = existingAnimeCache[seasonObj.name];
        const cachedEpisodes = seasonCache && Array.isArray(seasonCache.episodes)
          ? seasonCache.episodes
          : null;
        const siteEpisodes = toCachedEpisodes(await seasonObj.episodes(true, { knownLangs: languagesOf(cachedEpisodes) }));
        for (const id of seasonObj.usedLinkIds) usedLinkIds.add(id);
        // Cache d'avant le 2026-11-12 : ses adresses passent au carnet.
        seedLinkBookFromLegacy(cachedEpisodes, siteEpisodes, links);

        if (!siteEpisodes.length) {
          // Page de saison introuvable ou illisible : ce n'est pas un retrait.
          // Cette saison garde son cache, les autres sont actualisées.
          if (!seasonObj.emptiedBySite) {
            unreadable.push(seasonObj.name);
            continue;
          }
          // Anime-sama l'a vidée lui-même (saison masquée, « Bientôt de
          // retour ») : le cache suit le site au lieu de resservir des lecteurs
          // retirés à chaque recherche.
          if (seasonCache) {
            if (cachedEpisodes && cachedEpisodes.length) {
              console.log(`[ANIME-SAMA] ${anime.name} : « ${seasonObj.name} » vidée par anime-sama, retirée du cache`);
            }
            delete updatedAnimeCache[seasonObj.name];
            animeDataUpdated = true;
          }
          continue;
        }
        if (cachedEpisodes && (seasonCache.path ?? seasonObj.path) === seasonObj.path && sameEpisodes(cachedEpisodes, siteEpisodes)) continue;

        updatedAnimeCache[seasonObj.name] = {
          timestamp: Date.now(),
          path: seasonObj.path,
          episodes: siteEpisodes
        };
        animeDataUpdated = true;
      }

      if (unreadable.length) {
        console.warn(`[ANIME-SAMA] ${anime.name} : page de saison illisible, cache gardé : ${unreadable.join(', ')}`);
      }

      const aligned = alignToSiteSeasons(updatedAnimeCache, seasonsList.map(s => s.name));
      if (aligned.changed) {
        updatedAnimeCache = aligned.seasons;
        animeDataUpdated = true;
      }

      // Le carnet ne garde que les liens encore listés par le site. Quand une
      // saison n'a pas pu être lue, ou que la fiche n'a plus d'anime (saisons
      // masquées : elles reviennent), rien n'est retiré.
      await updateLinkBook(
        paths.linksPath,
        Object.fromEntries(Object.entries(links).filter(([id]) => !knownBefore.has(id))),
        { keepOnly: seasonsList.length && !unreadable.length ? usedLinkIds : null, label: anime.name },
      );

      // Une vérification réussie espace aussi le prochain scan sans nouveau lecteur.
      // Le contrôle de version est optimiste ; un contrôle inchangé ne réécrit
      // jamais le payload, même si un autre worker publie après ce stat.
      let latestMtime = 0;
      if (source) {
        try { latestMtime = (await fsp.stat(source.file)).mtime.getTime(); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      if (latestMtime !== originalMtime) return;
      if (animeDataUpdated) {
        await writeCacheFile(paths.titlePath, {
          ...existingData,
          timestamp: Date.now(),
          lastCheckedAt: Date.now(),
          seasons: updatedAnimeCache,
        });
        // Ancien rangement (fichier au nom de l'œuvre) : repris, puis retiré.
        if (source?.legacy) await fsp.unlink(source.file).catch(() => {});
        await deps.cleanupOldCacheFiles(paths.safeName, ANIME_SAMA_CACHE_DIR);
      } else if (source) {
        const checkedAt = new Date(Date.now());
        await fsp.utimes(source.file, checkedAt, checkedAt);
      } else {
        await deps.migrateOldCacheFiles(paths.safeName, ANIME_SAMA_CACHE_DIR);
      }
      animeRefresh.markChecked(paths.titlePath);
    } finally {
      clearInterval(keepAlive);
      await Promise.resolve(lock.release()).catch(() => {});
    }
  })).catch(() => {});
}

// Actualisation de fond, une œuvre après l'autre, après la réponse.
function refreshInBackground(animes) {
  (async () => {
    const client = new AnimeSama(deps.ANIME_SAMA_URL);
    for (const anime of animes) {
      // Skip entries without valid catalogue URLs
      if (!anime.url || !anime.url.includes('/catalogue/') || !anime.name) continue;
      await refreshAnime(anime, client.client);
    }
  })();
}

// ---- Réponses ----

// Joint à chaque œuvre ses saisons en cache.
async function attachCachedSeasons(animes, searchCacheKey = null) {
  let listing = null;
  const listCacheFiles = () => {
    if (!listing) listing = fsp.readdir(ANIME_SAMA_CACHE_DIR).catch(() => []);
    return listing;
  };

  return Promise.all(animes.map(async (anime) => {
    let saisons = [];
    const cached = await readTitleCache(anime);
    const paths = cachePathsFor(anime);

    if (cached) {
      const seasons = cached.data.seasons && typeof cached.data.seasons === 'object' ? cached.data.seasons : {};
      const usesRefs = Object.values(seasons).some(season => (season?.episodes || []).some(episode =>
        (episode?.streaming_links || []).some(linkObj => Array.isArray(linkObj?.refs))));
      const links = usesRefs ? await readLinkBook(paths.linksPath) : {};
      const hostStatus = deps.deadPlayerList.current();
      saisons = Object.entries(seasons).map(([seasonName, seasonData]) => {
        // Les adresses en clair (caches d'avant) repassent par la remise au
        // domaine courant ; les repères prennent leur adresse au carnet.
        const episodes = (seasonData.episodes || []).map(episode => ({
          ...episode,
          streaming_links: (episode.streaming_links || []).map(linkObj => (Array.isArray(linkObj?.refs)
            ? materializeLink(linkObj, links, hostStatus)
            : deps.normalizeAnimeSamaUrls({ streaming_links: [linkObj] }).streaming_links[0]
          )).filter(Boolean),
        }));
        return {
          name: seasonName,
          ...(typeof seasonData.path === 'string' ? { path: seasonData.path } : {}),
          episodes,
          episodeCount: episodes.length,
          cacheFile: path.basename(cached.file),
          timestamp: seasonData.timestamp || cached.data.timestamp || null
        };
      });
    } else {
      // Très anciens caches : un fichier par saison (<nom>_<saison>.json).
      const safeAnimeName = safeFilename(String(anime.name || ''));
      const allCacheFiles = await listCacheFiles();
      const seasonFiles = allCacheFiles.filter(f => f.startsWith(safeAnimeName + '_') && f !== searchCacheKey + '.json');

      saisons = (await Promise.all(seasonFiles.map(async seasonFile => {
        try {
          const seasonContent = await fsp.readFile(path.join(ANIME_SAMA_CACHE_DIR, seasonFile), 'utf-8');
          const seasonCache = deps.normalizeAnimeSamaUrls(JSON.parse(seasonContent));
          return {
            name: seasonFile.replace(safeAnimeName + '_', '').replace('.json', ''),
            episodes: seasonCache.episodes || [],
            episodeCount: (seasonCache.episodes || []).length,
            cacheFile: seasonFile,
            timestamp: seasonCache.timestamp || null
          };
        } catch (e) {
          return null;
        }
      }))).filter(Boolean);
    }

    return {
      ...anime,
      // Identifiant de l'œuvre pour demander les adresses d'un épisode (/anime/episode/<slug>).
      ...(slugOfUrl(anime.url) ? { slug: slugOfUrl(anime.url) } : {}),
      seasons: saisons
    };
  }));
}

// Les lecteurs hors service sortent aussi du cache déjà écrit, sans attendre
// sa prochaine actualisation ; une langue sans lecteur restant disparaît, comme
// un épisode ou une saison sans lecteur. Un lecteur dont l'adresse reste à
// demander (`pending`) compte comme un lecteur : son épisode reste listé.
function stripUnplayable(animesWithSeasons) {
  const hostStatus = deps.deadPlayerList.current();
  animesWithSeasons.forEach(anime => {
    if (anime.seasons && Array.isArray(anime.seasons)) {
      anime.seasons.forEach(season => {
        if (season.episodes && Array.isArray(season.episodes)) {
          season.episodes.forEach(ep => {
            if (ep.streaming_links && Array.isArray(ep.streaming_links)) {
              ep.streaming_links.forEach(linkObj => {
                if (linkObj.players && Array.isArray(linkObj.players)) {
                  linkObj.players = linkObj.players.filter(url => !isEmptyPlayerUrl(url) && !isDeadPlayerUrl(url, hostStatus));
                }
              });
              ep.streaming_links = ep.streaming_links.filter(hasPlayable);
            }
          });
          season.episodes = season.episodes.filter(ep =>
            Array.isArray(ep.streaming_links) && ep.streaming_links.some(hasPlayable)
          );
          season.episodeCount = season.episodes.length;
        }
      });

      anime.seasons = anime.seasons.filter(season =>
        Array.isArray(season.episodes) && season.episodes.length > 0
      );
    }
  });
}

// Attend `promise` au plus `ms` millisecondes, sans jamais lever.
function waitAtMost(promise, ms) {
  if (!(ms > 0)) return Promise.resolve();
  let timer;
  return Promise.race([
    Promise.resolve(promise).catch(() => {}),
    new Promise((resolve) => { timer = setTimeout(resolve, ms); }),
  ]).finally(() => clearTimeout(timer));
}

// ---- Routes ----

router.get('/search/:query', async (req, res) => {
  try {
    const { query } = req.params;
    const cacheKey = generateCacheKey(query);
    const animeCacheDir = ANIME_SAMA_CACHE_DIR;
    let cachedResults = await deps.getFromCacheNoExpiration(animeCacheDir, cacheKey);
    // Ancien cache qui garde une page de saison au lieu d'une fiche : la
    // recherche est refaite sur le site. Sans réponse du site, les entrées
    // sont ramenées à leur fiche.
    const staleEntries = Array.isArray(cachedResults) && cachedResults.some(entry => isSeasonPageUrl(entry?.url));

    if (!cachedResults || !Array.isArray(cachedResults) || cachedResults.length === 0 || staleEntries) {
      try {
        const client = new AnimeSama(deps.ANIME_SAMA_URL);
        const searchResults = await client.search(query, staleEntries);
        let serializedResults = searchResults.map(cat => ({
          url: cat.url,
          name: cat.name,
          image: cat.image,
          alternative_names: cat.alternative_names,
          alternative_names_string: cat.alternative_names_string
        }));
        if (staleEntries && !serializedResults.length) serializedResults = uniqueTitles(cachedResults.map(repairSearchEntry));
        await deps.saveToCache(animeCacheDir, cacheKey, serializedResults);
        cachedResults = serializedResults;
      } catch (err) {
        console.error('Erreur scraping Anime Sama:', err);
        return res.status(500).json({ error: 'Erreur lors de la recherche Anime Sama' });
      }
    }

    const animesWithSeasons = await attachCachedSeasons(cachedResults, cacheKey);
    stripUnplayable(animesWithSeasons);

    await respondWithAnimeSources(req, res, animesWithSeasons);
    refreshInBackground(animesWithSeasons);

  } catch (error) {
    console.error('Erreur /anime/search/:query:', error);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ---- Adresses des lecteurs d'un épisode ----
//
// La liste d'une œuvre donne, pour chaque épisode, les adresses déjà connues
// (`players`) et le nombre de lecteurs dont l'adresse reste à demander
// (`pending`). Le site demande alors les adresses de l'épisode qu'il va lire :
// quelques requêtes à /api/lien.php, notées au carnet pour toujours.

const episodeFlights = new Map();
// /api/lien.php a répondu « trop » : plus aucune demande d'adresse pendant
// cette pause. Les adresses déjà connues restent servies.
const LINK_PAUSE_MS = 60 * 1000;
let linkPauseUntil = 0;
const SEASON_PATH_PATTERN = /^[a-z0-9][a-z0-9._-]{0,60}(?:\/[a-z0-9][a-z0-9._-]{0,60}){0,2}$/i;

// Rend null quand l'œuvre, la saison ou l'épisode n'est pas en cache.
async function episodeLinks(slug, seasonPath, index) {
  const anime = { url: `${deps.ANIME_SAMA_URL}catalogue/${slug}/`, name: slug };
  const paths = cachePathsFor(anime);
  const cached = await readTitleCache(anime);
  const seasons = cached?.data?.seasons && typeof cached.data.seasons === 'object' ? cached.data.seasons : {};
  const entry = Object.entries(seasons).find(([, season]) => season?.path === seasonPath);
  const episode = (entry?.[1]?.episodes || []).find(candidate => candidate?.index === index);
  if (!episode) return null;

  const hostStatus = deps.deadPlayerList.current();
  let links = await readLinkBook(paths.linksPath);
  const cachedLinks = Array.isArray(episode.streaming_links) ? episode.streaming_links : [];
  const pendingLangs = cachedLinks
    .filter(linkObj => Array.isArray(linkObj?.refs) && materializeLink(linkObj, links, hostStatus).pending > 0)
    .map(linkObj => linkObj.language);
  const fresh = new Map();
  let limited = false;

  if (pendingLangs.length) {
    if (Date.now() < linkPauseUntil || animeSamaSeasonCircuit.isOpen()) {
      limited = true;
    } else {
      const before = { ...links };
      const season = new Season(`${anime.url}${seasonPath}/`, entry[0], episode.serie_name || slug, null, pendingLangs[0], seasonPath);
      try {
        await season.resolveEpisode(index, pendingLangs, links, hostStatus, fresh);
      } catch (error) {
        limited = true;
        if (isLinkRateError(error)) {
          linkPauseUntil = Date.now() + LINK_PAUSE_MS;
          console.warn(`[ANIME-SAMA] /api/lien.php limite le débit : demandes d'adresses en pause ${LINK_PAUSE_MS / 1000} s`);
        } else if (!isSourceCircuitOpenError(error)) {
          console.warn(`[ANIME-SAMA] Adresses de ${slug} ${seasonPath} épisode ${index} : ${refreshFailureLabel(error)}`);
        }
      }
      // Les adresses reçues sont notées même quand la demande a échoué en route.
      const added = Object.fromEntries(Object.entries(links).filter(([id, known]) => before[id] !== known));
      if (Object.keys(added).length) links = (await updateLinkBook(paths.linksPath, added, { label: slug })) || links;
    }
  }

  const streamingLinks = cachedLinks.map((linkObj) => {
    if (!Array.isArray(linkObj?.refs)) {
      const legacy = deps.normalizeAnimeSamaUrls({ streaming_links: [linkObj] }).streaming_links[0];
      return legacy && { ...legacy, players: legacy.players.filter(url => !isEmptyPlayerUrl(url) && !isDeadPlayerUrl(url, hostStatus)) };
    }
    // La page vient d'être lue pour cette langue : ses lecteurs font foi.
    const refs = fresh.get(linkObj.language) || linkObj.refs;
    return materializeLink({ language: linkObj.language, refs }, links, hostStatus);
  }).filter(hasPlayable);

  return {
    slug,
    season: seasonPath,
    index,
    name: episode.name,
    streaming_links: streamingLinks,
    ...(limited ? { limited: true } : {}),
  };
}

// Adresses des lecteurs d'un épisode : `season` est le chemin de la saison
// (`path` dans la liste de l'œuvre), `episode` son rang sur le site (`index`).
// `resolve=1` avec une clé VIP joint les m3u8 extraits, comme la recherche.
router.get('/episode/:slug', async (req, res) => {
  try {
    const slug = String(req.params.slug || '').toLowerCase();
    const seasonPath = typeof req.query.season === 'string' ? req.query.season.trim() : '';
    const index = /^[1-9]\d{0,4}$/.test(String(req.query.episode)) ? Number(req.query.episode) : NaN;
    if (!isSlug(slug) || !SEASON_PATH_PATTERN.test(seasonPath) || !Number.isInteger(index)) {
      return res.status(400).json({ error: 'Paramètres invalides' });
    }

    // Les demandes simultanées du même épisode partagent une seule lecture.
    const key = `${slug}|${seasonPath}|${index}`;
    let flight = episodeFlights.get(key);
    if (!flight) {
      flight = episodeLinks(slug, seasonPath, index).finally(() => episodeFlights.delete(key));
      episodeFlights.set(key, flight);
    }
    const shared = await flight;
    if (!shared) return res.status(404).json({ error: 'Épisode inconnu' });
    const episode = { ...shared, streaming_links: shared.streaming_links.map(linkObj => ({ ...linkObj, players: [...linkObj.players] })) };

    if (String(req.query.resolve || '') === '1') {
      try {
        const accessKey = req.headers['x-access-key'] || null;
        const { verifyAccessKey } = require('../checkVip');
        const vipStatus = await verifyAccessKey(accessKey);
        if (vipStatus?.vip) {
          episode.m3u8ByPlayer = await buildM3u8Map(episode.streaming_links.flatMap(linkObj => linkObj.players), { accessKey });
        }
      } catch (error) {
        // L'extraction est un bonus : les adresses restent servies si elle échoue.
        console.error(`[ANIME-SAMA] Extraction ${slug} ${seasonPath} épisode ${index} échouée: ${error.message}`);
      }
    }
    return res.json(episode);
  } catch (error) {
    console.error('Erreur /anime/episode/:slug:', error);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

let indexFailureLoggedAt = 0;
// Index injoignable (base en panne) : la route répond vide ; un log par minute.
function logIndexFailure(error) {
  if (Date.now() - indexFailureLoggedAt < 60000) return;
  indexFailureLoggedAt = Date.now();
  console.warn(`[ANIME-SAMA] Index du catalogue injoignable : ${String(error?.message || error).slice(0, 120)}`);
}

// Œuvre(s) d'anime-sama dont la fiche renvoie à cet ID TMDB, dans la même forme
// que la recherche par nom. Liste vide quand aucune fiche ne porte cet ID : le
// client retombe alors sur la recherche par nom.
router.get('/tmdb/:type/:id', async (req, res) => {
  try {
    const { type } = req.params;
    const id = /^[1-9]\d{0,9}$/.test(String(req.params.id)) ? Number(req.params.id) : NaN;
    if (!['tv', 'movie'].includes(type) || !Number.isSafeInteger(id)) {
      return res.status(400).json({ error: 'Paramètres invalides' });
    }

    let titles = [];
    if (typeof deps.animeIndex?.findByTmdb === 'function') {
      try {
        titles = await deps.animeIndex.findByTmdb(type, id) || [];
      } catch (error) {
        logIndexFailure(error);
      }
    }
    const animes = titles.filter(title => isSlug(title?.slug) && title.name).map((title) => {
      const alternativeNames = Array.isArray(title.altNames) ? title.altNames : [];
      return {
        url: `${deps.ANIME_SAMA_URL}catalogue/${title.slug}/`,
        name: title.name,
        image: title.image || '',
        alternative_names: alternativeNames,
        alternative_names_string: alternativeNames.join(', ')
      };
    });
    if (!animes.length) return res.json([]);

    // Une œuvre jamais lue n'a encore aucun épisode : plutôt que de répondre
    // vide, attendre (un peu) sa première lecture.
    const client = new AnimeSama(deps.ANIME_SAMA_URL);
    await Promise.all(animes.map(async (anime) => {
      if (await readTitleCache(anime)) return;
      await waitAtMost(refreshAnime(anime, client.client), deps.firstScanWaitMs);
    }));

    const animesWithSeasons = await attachCachedSeasons(animes);
    stripUnplayable(animesWithSeasons);

    await respondWithAnimeSources(req, res, animesWithSeasons);
    refreshInBackground(animesWithSeasons);
  } catch (error) {
    console.error('Erreur /anime/tmdb/:type/:id:', error);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

const clampInt = (value, fallback, min, max) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};
const textParam = (value, maxLength) => (typeof value === 'string' ? value.trim().slice(0, maxLength) : '');
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

// Catalogue d'anime-sama (œuvres qui ont un anime), paginé, pour la page Animes.
router.get('/catalogue', async (req, res) => {
  const page = clampInt(req.query.page, 1, 1, 100000);
  const limit = clampInt(req.query.limit, 48, 1, 60);
  const empty = { page, limit, total: 0, totalPages: 0, items: [] };
  if (typeof deps.animeIndex?.listTitles !== 'function') return res.json(empty);
  try {
    const result = await deps.animeIndex.listTitles({
      page,
      limit,
      search: textParam(req.query.q, 80),
      genre: textParam(req.query.genre, 40),
      language: LANGUAGE_IDS.includes(req.query.lang) ? req.query.lang : '',
      type: ['tv', 'movie'].includes(req.query.type) ? req.query.type : '',
      status: ['ongoing', 'finished'].includes(req.query.status) ? req.query.status : '',
      sort: ['recent', 'name', 'added'].includes(req.query.sort) ? req.query.sort : 'recent',
      linkedOnly: req.query.linked === '1',
    });
    res.set('Cache-Control', 'public, max-age=300');
    return res.json(result);
  } catch (error) {
    logIndexFailure(error);
    return res.json(empty);
  }
});

// Genres du catalogue, du plus fourni au moins fourni (filtres de la page Animes).
router.get('/catalogue/genres', async (req, res) => {
  if (typeof deps.animeIndex?.listGenres !== 'function') return res.json({ genres: [] });
  try {
    const genres = await deps.animeIndex.listGenres();
    res.set('Cache-Control', 'public, max-age=3600');
    return res.json({ genres });
  } catch (error) {
    logIndexFailure(error);
    return res.json({ genres: [] });
  }
});

// Page Animes du site (`language` = langue TMDB, ex. fr-FR) : œuvres TMDB sans
// celles pour adultes, affiches des genres et rangées du catalogue, calculées
// une fois par langue. 202 tant que le premier calcul n'est pas fini.
router.get('/home', async (req, res) => {
  const pending = status => {
    res.set('Cache-Control', 'no-store');
    return res.status(status).json({ pending: true });
  };
  if (typeof deps.animeHome?.read !== 'function') return pending(503);
  try {
    const result = await deps.animeHome.read(req.query.language);
    if (result.status !== 'ready') return pending(202);
    res.set('Cache-Control', 'public, max-age=300');
    return res.json(result.data);
  } catch (error) {
    console.warn(`[AnimeHome] lecture impossible : ${error.message}`);
    return pending(503);
  }
});

// Sorties d'animes annoncées par le planning d'anime-sama, entre deux jours
// (`from`/`to` en AAAA-MM-JJ ; par défaut, des 7 derniers jours aux 14 prochains).
router.get('/planning', async (req, res) => {
  const dayKey = offsetDays => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
  const from = DAY_KEY.test(req.query.from) ? req.query.from : dayKey(-7);
  const to = DAY_KEY.test(req.query.to) ? req.query.to : dayKey(14);
  const empty = { from, to, updatedAt: null, entries: [] };
  if (typeof deps.animeIndex?.readPlanning !== 'function') return res.json(empty);
  try {
    const result = await deps.animeIndex.readPlanning({ from, to });
    res.set('Cache-Control', 'public, max-age=300');
    return res.json({ from, to, ...result });
  } catch (error) {
    logIndexFailure(error);
    return res.json(empty);
  }
});

module.exports = router;
module.exports.configure = configure;
module.exports.alignToSiteSeasons = alignToSiteSeasons;
module.exports.toCachedEpisodes = toCachedEpisodes;
module.exports.sameEpisodes = sameEpisodes;
module.exports.parseEpisodeListCalls = parseEpisodeListCalls;
module.exports.episodeLabelsFromCalls = episodeLabelsFromCalls;
