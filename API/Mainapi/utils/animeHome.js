/**
 * Page Animes du site, calculée par le serveur une fois par langue.
 *
 * Sans ça, chaque visiteur demandait lui-même 200 à 300 pages à TMDB : les
 * listes « discover », la classification d'âge de chaque œuvre (pour écarter
 * celles réservées aux adultes), puis la fiche de chaque œuvre du catalogue de
 * la source anime. Ici, ce travail est fait une fois, rangé dans Redis et
 * partagé par tous les workers : le site ne fait plus qu'une requête.
 *
 * Le résultat contient :
 *  - `shows` : les œuvres TMDB, triées par popularité, sans les œuvres pour
 *    adultes. Le site en tire lui-même la bannière, le top et les rangées par
 *    genre (les titres des rangées sont traduits côté site) ;
 *  - `genrePosters` : deux affiches par tuile de « Parcourir par genre » ;
 *  - `siteRows` : les rangées « en cours » et « VF » du catalogue indexé.
 *
 * Le résultat reste frais une heure, puis il est servi tel quel pendant qu'un
 * seul worker le recalcule. Tant qu'une langue n'a jamais été calculée, la
 * route répond « en attente » et le site fait le travail lui-même.
 */

const LANGUAGES = new Set([
  'fr-FR', 'en-US', 'es-ES', 'de-DE', 'it-IT', 'pt-PT', 'nl-NL',
  'ru-RU', 'ja-JP', 'ko-KR', 'zh-CN', 'ar-SA', 'tr-TR', 'pl-PL',
]);
const DEFAULT_LANGUAGE = 'fr-FR';

const STORE_PREFIX = 'anime:home:v1:';
const FRESH_MS = 60 * 60 * 1000;
const KEEP_SECONDS = 7 * 24 * 60 * 60;
// Première demande d'une langue : attente du calcul avant de répondre « en attente ».
const COLD_WAIT_MS = 8000;
// Après un échec (TMDB en panne), pas de nouveau calcul avant ce délai.
const RETRY_AFTER_FAILURE_MS = 60 * 1000;
const LOCK_TTL_SECONDS = 180;
// Appels TMDB en parallèle : la porte de débit de tmdbCache est commune à tout
// le worker, le calcul ne doit pas la monopoliser.
const TMDB_CONCURRENCY = 2;
const TMDB_ATTEMPTS = 3;
const TMDB_RETRY_DELAY_MS = 1000;
// Au-delà de cette part de classifications illisibles, le calcul est refusé
// plutôt que de garder une page incomplète pendant une heure.
const MAX_RATING_FAILURE_RATIO = 0.1;

const MATURE_AGE = 17;
const DISCOVER_PAGES = 3;
const SITE_ROW_FETCH_LIMIT = 40;
const SITE_ROW_SIZE = 15;
const GENRE_POSTERS = 2;

// Tuiles « Parcourir par genre », dans l'ordre de src/pages/Anime.tsx
// (ANIME_GENRE_CONFIG). Un genre absent d'ici n'a simplement pas d'affiches.
const GENRES = [
  { id: 16, discover: '16' },
  { id: 10759, discover: '16,10759' },
  { id: 10765, discover: '16,10765' },
  { id: 35, discover: '16,35' },
  { id: 18, discover: '16,18' },
  { id: 9648, discover: '16,9648' },
  { id: 10751, discover: '16,10751' },
  { id: 10762, discover: '16,10762' },
];

// ---- Classification d'âge (copie de src/utils/certificationUtils.ts) ----

const ALL_AGES = new Set(['TP', 'TP+', 'G', 'PG', 'TV-Y', 'TV-G', 'TV-PG', 'U', '0', 'T', 'ALL', 'L', 'AA', 'A', 'ATP']);
const AGE_BY_CERTIFICATION = {
  '6': 6, '6+': 6,
  '7': 7, 'TV-Y7': 7,
  '10': 10,
  '12': 12, '12A': 12, 'PG12': 12, 'IIB': 12,
  'PG-13': 13, 'R13': 13, 'R-13': 13, '+13': 13,
  '14': 14, '14A': 14, '14+': 14, 'TV-14': 14,
  '15': 15, 'MA 15+': 15, 'M': 15, 'R15+': 15, 'K15': 15, 'B': 15, 'B-15': 15,
  '16': 16, '+16': 16, 'NC16': 16, 'K-16': 16, 'N-16': 16, '16+': 16,
  'R': 17, 'TV-MA': 17, 'NC-17': 17,
  '18': 18, '18+': 18, '18A': 18, 'R18+': 18, 'M18': 18, 'III': 18, 'R-18': 18, '18SG': 18, 'N-18': 18, 'C': 18, 'D': 18,
  '19': 19, '21+': 21,
};
const RATING_REGIONS = ['FR', 'US', 'JP', 'GB', 'CA'];

/** Âge minimal d'une série d'après ses classifications ; 0 si aucune n'est connue. */
function ageOfRatings(ratings) {
  const list = Array.isArray(ratings) ? ratings : [];
  const preferred = RATING_REGIONS.map(region => list.find(item => item?.iso_3166_1 === region && item.rating))
    .find(Boolean) || list.find(item => item?.rating);
  const certification = preferred?.rating || '';
  if (!certification || ALL_AGES.has(certification)) return 0;
  return AGE_BY_CERTIFICATION[certification] ?? 0;
}

// ---- Œuvres ----

const toShow = raw => ({
  id: raw.id,
  name: raw.name || '',
  overview: raw.overview || '',
  poster_path: raw.poster_path || '',
  backdrop_path: raw.backdrop_path || '',
  vote_average: raw.vote_average ?? 0,
  vote_count: raw.vote_count ?? 0,
  popularity: raw.popularity ?? 0,
  first_air_date: raw.first_air_date || '',
  genre_ids: Array.isArray(raw.genre_ids) ? raw.genre_ids : (raw.genres || []).map(genre => genre.id),
  media_type: 'tv',
});

// Même règle que isValidAnimeShow côté site.
const isListable = show => Boolean(show?.id && show.name && show.poster_path && String(show.overview || '').trim());

// Même ordre que compareAnimeByPopularity côté site.
function byPopularity(left, right) {
  return (right.popularity ?? 0) - (left.popularity ?? 0)
    || (right.vote_count ?? 0) - (left.vote_count ?? 0)
    || (right.vote_average ?? 0) - (left.vote_average ?? 0)
    || left.name.localeCompare(right.name, undefined, { sensitivity: 'base', numeric: true });
}

const uniqueById = items => [...new Map(items.map(item => [item.id, item])).values()];

/** Deux affiches par genre, sans reprendre une œuvre déjà montrée par un genre précédent. */
function pickGenrePosters(candidatesByGenre, perGenre = GENRE_POSTERS) {
  const used = new Set();
  return candidatesByGenre.map(candidates => {
    const posters = [];
    for (const candidate of candidates) {
      if (posters.length >= perGenre) break;
      if (!candidate.poster_path || used.has(candidate.id)) continue;
      used.add(candidate.id);
      posters.push(`https://image.tmdb.org/t/p/w185${candidate.poster_path}`);
    }
    return posters;
  });
}

const normalizeLabel = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

const defaultSleep = ms => new Promise(resolve => { setTimeout(resolve, ms).unref?.(); });

/**
 * @param {object} deps
 * @param {{ searchKeyword: Function, discover: Function, contentRatings: Function, details: Function }} deps.tmdb
 *   Appels TMDB en mode strict : un échec temporaire est levé (`error.transient`),
 *   null veut dire absent.
 * @param {{ listTitles?: Function }} [deps.animeIndex] - Index du catalogue (utils/animeSamaIndex.js).
 * @param {{ get: Function, set: Function }} deps.store - JSON partagé entre workers (Redis).
 * @param {(key: string, ttlSeconds: number) => Promise<{ release?: Function }|null>} deps.acquireLock
 */
function createAnimeHome({
  tmdb,
  animeIndex = null,
  store,
  acquireLock,
  now = Date.now,
  sleep = defaultSleep,
  log = console,
}) {
  const memory = new Map();
  const inFlight = new Map();
  const failedAt = new Map();

  const storeKey = language => `${STORE_PREFIX}${language}`;
  const isFresh = data => Boolean(data) && now() - Number(data.updatedAt) < FRESH_MS;

  async function retryTransient(call) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await call();
      } catch (error) {
        if (!error?.transient || attempt >= TMDB_ATTEMPTS) throw error;
        await sleep(TMDB_RETRY_DELAY_MS * attempt);
      }
    }
  }

  async function resolveAnimeKeyword(language) {
    const data = await retryTransient(() => tmdb.searchKeyword('anime', language));
    const keywords = Array.isArray(data?.results) ? data.results : [];
    const match = keywords.find(item => normalizeLabel(item?.name) === 'anime')
      || keywords.find(item => normalizeLabel(item?.name).includes('anime'));
    return match?.id || null;
  }

  // Âge de chaque série, une seule fois par calcul ; null si TMDB n'a pas répondu.
  function createAgeBook() {
    const ages = new Map();
    let failures = 0;
    let asked = 0;
    return {
      async rate(ids) {
        const missing = [...new Set(ids)].filter(id => !ages.has(id));
        asked += missing.length;
        await mapLimit(missing, TMDB_CONCURRENCY, async id => {
          try {
            const data = await retryTransient(() => tmdb.contentRatings(id));
            ages.set(id, ageOfRatings(data?.results));
          } catch {
            failures += 1;
            ages.set(id, null);
          }
        });
        if (asked > 0 && failures / asked > MAX_RATING_FAILURE_RATIO) {
          throw new Error(`classifications TMDB illisibles (${failures}/${asked})`);
        }
      },
      // Une œuvre dont l'âge est inconnu est écartée : la page est gardée une heure.
      isSafe: id => {
        const age = ages.get(id);
        return typeof age === 'number' && age < MATURE_AGE;
      },
      ageOf: id => ages.get(id),
    };
  }

  async function loadDiscover(language, keywordId) {
    const base = {
      include_adult: false,
      with_genres: '16',
      sort_by: 'popularity.desc',
      'vote_count.gte': 25,
      ...(keywordId ? { with_keywords: String(keywordId) } : {}),
    };
    const requests = [
      ...Array.from({ length: DISCOVER_PAGES }, (_, index) => ({
        genreId: index === 0 ? 16 : null,
        params: { ...base, page: index + 1 },
      })),
      ...GENRES.filter(genre => genre.id !== 16).map(genre => ({
        genreId: genre.id,
        params: { ...base, page: 1, with_genres: genre.discover },
      })),
    ];

    const pages = await mapLimit(requests, TMDB_CONCURRENCY, async request => {
      try {
        return await retryTransient(() => tmdb.discover(request.params, language));
      } catch {
        return null;
      }
    });
    if (pages.some(page => !Array.isArray(page?.results))) {
      throw new Error('listes discover TMDB indisponibles');
    }

    return requests.map((request, index) => ({
      genreId: request.genreId,
      results: pages[index].results.filter(raw => raw?.id && raw.poster_path),
    }));
  }

  async function loadSiteRows(language, ageBook) {
    const empty = { airing: [], dubbed: [] };
    if (typeof animeIndex?.listTitles !== 'function') return empty;

    let listings;
    try {
      const listing = options => animeIndex.listTitles({
        page: 1, limit: SITE_ROW_FETCH_LIMIT, type: 'tv', linkedOnly: true, sort: 'recent', ...options,
      });
      listings = await Promise.all([listing({ status: 'ongoing' }), listing({ language: 'vf' })]);
    } catch (error) {
      log.warn?.(`[AnimeHome] catalogue indisponible : ${error.message}`);
      return empty;
    }

    const idsOf = listing => (listing?.items || []).flatMap(item => (item?.tmdb?.type === 'tv' ? [item.tmdb.id] : []));
    const [airingIds, dubbedIds] = listings.map(idsOf);
    const ids = [...new Set([...airingIds, ...dubbedIds])];
    await ageBook.rate(ids);

    const shows = new Map();
    await mapLimit(ids.filter(ageBook.isSafe), TMDB_CONCURRENCY, async id => {
      try {
        const details = await retryTransient(() => tmdb.details(id, language));
        if (details?.name && details.poster_path) shows.set(id, toShow({ ...details, id }));
      } catch {
        // Fiche illisible : l'œuvre manque à la rangée jusqu'au prochain calcul.
      }
    });

    const rowOf = rowIds => [...new Set(rowIds)]
      .flatMap(id => shows.get(id) ?? [])
      .sort(byPopularity)
      .slice(0, SITE_ROW_SIZE);
    return { airing: rowOf(airingIds), dubbed: rowOf(dubbedIds) };
  }

  async function build(language) {
    const keywordId = await resolveAnimeKeyword(language);
    const pages = await loadDiscover(language, keywordId);
    const ageBook = createAgeBook();
    await ageBook.rate(pages.flatMap(page => page.results.map(raw => raw.id)));

    const shows = uniqueById(pages.flatMap(page => page.results).map(toShow))
      .filter(show => isListable(show) && ageBook.isSafe(show.id))
      .sort(byPopularity);
    if (shows.length === 0) throw new Error('aucune œuvre TMDB');

    const candidatesByGenre = GENRES.map(genre => (pages.find(page => page.genreId === genre.id)?.results || [])
      .filter(raw => ageBook.isSafe(raw.id)));
    const posters = pickGenrePosters(candidatesByGenre);
    const genrePosters = Object.fromEntries(GENRES.map((genre, index) => [genre.id, posters[index]]));

    const siteRows = await loadSiteRows(language, ageBook);
    return { language, updatedAt: now(), shows, genrePosters, siteRows };
  }

  function refresh(language) {
    if (inFlight.has(language)) return inFlight.get(language);
    if (now() - (failedAt.get(language) ?? -Infinity) < RETRY_AFTER_FAILURE_MS) return Promise.resolve(null);

    const task = (async () => {
      let lease = null;
      try {
        lease = await acquireLock(`anime-home:${language}`, LOCK_TTL_SECONDS);
        // Un autre worker calcule déjà cette langue.
        if (!lease) return null;
        const data = await build(language);
        memory.set(language, data);
        await store.set(storeKey(language), data, KEEP_SECONDS);
        return data;
      } catch (error) {
        failedAt.set(language, now());
        log.warn?.(`[AnimeHome] calcul ${language} impossible : ${error.message}`);
        return null;
      } finally {
        await lease?.release?.();
      }
    })().finally(() => inFlight.delete(language));

    inFlight.set(language, task);
    return task;
  }

  // Copie du worker si elle est fraîche, sinon la plus récente entre elle et Redis.
  async function readStored(language) {
    const local = memory.get(language);
    if (isFresh(local)) return local;
    const shared = await store.get(storeKey(language));
    const best = [local, shared].filter(Boolean).sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt))[0] || null;
    if (best) memory.set(language, best);
    return best;
  }

  /**
   * @returns {Promise<{ status: 'ready', data: object } | { status: 'pending' }>}
   */
  async function read(rawLanguage) {
    const language = normalizeLanguage(rawLanguage);
    const stored = await readStored(language);
    if (isFresh(stored)) return { status: 'ready', data: stored };

    const building = refresh(language);
    // Page périmée : servie telle quelle pendant le recalcul.
    if (stored) return { status: 'ready', data: stored };

    const data = await Promise.race([building, sleep(COLD_WAIT_MS).then(() => null)]);
    return data ? { status: 'ready', data } : { status: 'pending' };
  }

  return { read };
}

function normalizeLanguage(value) {
  return LANGUAGES.has(value) ? value : DEFAULT_LANGUAGE;
}

/**
 * Branchement du serveur : appels TMDB par tmdbCache, résultat dans Redis.
 * Sans clé TMDB, pas de calcul : la route répond « en attente » et le site
 * interroge TMDB lui-même.
 */
function createDefaultAnimeHome({ animeIndex, TMDB_API_URL, TMDB_API_KEY }) {
  if (!TMDB_API_KEY) return null;
  // Chargés ici : les tests de createAnimeHome n'ouvrent ni Redis ni axios.
  const tmdbCache = require('./tmdbCache');
  const { redis } = require('../config/redis');
  const { acquireRedisLock } = require('./redisLock');
  const redisReady = () => redis && redis.status === 'ready';
  const strict = { strict: true };

  return createAnimeHome({
    animeIndex,
    tmdb: {
      searchKeyword: (query, language) => tmdbCache.searchTmdb(TMDB_API_URL, TMDB_API_KEY, 'keyword', query, { page: 1 }, language, strict),
      discover: (params, language) => tmdbCache.fetchTmdbDiscover(TMDB_API_URL, TMDB_API_KEY, 'tv', params, language, strict),
      contentRatings: id => tmdbCache.fetchTmdbContentRatings(TMDB_API_URL, TMDB_API_KEY, id, strict),
      details: (id, language) => tmdbCache.fetchTmdbDetails(TMDB_API_URL, TMDB_API_KEY, id, 'tv', language, strict),
    },
    store: {
      async get(key) {
        if (!redisReady()) return null;
        try {
          const raw = await redis.get(key);
          return raw ? JSON.parse(raw) : null;
        } catch { return null; }
      },
      async set(key, value, ttlSeconds) {
        if (!redisReady()) return;
        try { await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds); } catch { /* copie du worker gardée */ }
      },
    },
    // Redis absent : chaque worker calcule seul, une fois à la fois.
    acquireLock: (key, ttl) => (redisReady() ? acquireRedisLock(key, { ttl, retries: 0 }) : Promise.resolve({})),
  });
}

module.exports = {
  createAnimeHome,
  createDefaultAnimeHome,
  normalizeLanguage,
  ageOfRatings,
  pickGenrePosters,
  FRESH_MS,
  COLD_WAIT_MS,
};
