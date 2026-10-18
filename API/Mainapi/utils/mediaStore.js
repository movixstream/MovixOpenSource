// Cache TMDB permanent partagé par tous les profils : une ligne par titre et
// par langue (`tmdb_media`) et une par épisode (`tmdb_episodes`). Un titre
// absent est demandé une seule fois à TMDB puis gardé ; une ligne de plus de
// 7 jours est renvoyée telle quelle et rafraîchie en arrière-plan.
// Titre inconnu de TMDB (404, réponse sans id) : ligne « inconnue » au titre
// vide, jamais renvoyée, redemandée après 1 jour. Panne TMDB (délai, 5xx) :
// le titre n'est pas redemandé pendant 10 minutes (mémoire du processus).
// Au plus 300 demandes TMDB par appel de `getMany`, le reste au suivant.
// Aucune méthode ne lève : un échec TMDB ou SQL donne un titre absent.

const TMDB_API_URL = 'https://api.themoviedb.org/3';
const LANGUAGES = new Set(['fr-FR', 'en-US']);
const STALE_MS = 7 * 24 * 60 * 60 * 1000;
const UNKNOWN_RETRY_MS = 24 * 60 * 60 * 1000;
const FAILURE_RETRY_MS = 10 * 60 * 1000;
const MAX_REMEMBERED_FAILURES = 10000;
// Assez haut pour qu'une grosse rangée « Reprendre » (180+ titres, cache vide)
// arrive complète dès la première lecture : les clients cachent les cartes
// sans titre.
const MAX_TMDB_FETCHES_PER_CALL = 300;
const MAX_TMDB_CONCURRENCY = 4;
const MAX_PAIRS_PER_SELECT = 500;

// TMDB ne connaît pas ce titre (supprimé, id faux) : à mémoriser.
function isNotFound(error) {
  return Boolean(error && error.response && error.response.status === 404);
}

function normalizeLanguage(language) {
  return LANGUAGES.has(language) ? language : 'fr-FR';
}

function mediaKey(mediaType, tmdbId) {
  return `${mediaType}:${tmdbId}`;
}

function logError(message, error) {
  console.error(`[HISTORY] ${message}:`, error && error.message ? error.message : error);
}

// Limite le nombre de tâches lancées en même temps (appels TMDB).
function createLimiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || queue.length === 0) return;
    active += 1;
    const { task, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(task)
      .then(resolve, reject)
      .finally(() => {
        active -= 1;
        next();
      });
  };
  return (task) => new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    next();
  });
}

function textOrNull(value, maxLength) {
  if (typeof value !== 'string' || value === '') return null;
  return maxLength ? value.slice(0, maxLength) : value;
}

function smallIntOrNull(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 32767 ? n : null;
}

function yearFrom(date) {
  if (typeof date !== 'string') return null;
  const match = /^(\d{4})/.exec(date);
  return match ? smallIntOrNull(Number(match[1])) : null;
}

// DECIMAL(3,1) : note TMDB entre 0 et 10, arrondie au dixième.
function ratingOrNull(value) {
  const n = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(n)) return null;
  return Math.round(Math.min(Math.max(n, 0), 10) * 10) / 10;
}

// Saisons d'une série, saison 0 (épisodes spéciaux) exclue.
function seasonsFrom(details) {
  if (!Array.isArray(details.seasons)) return null;
  return details.seasons
    .filter((entry) => entry && Number.isInteger(entry.season_number) && entry.season_number > 0)
    .map((entry) => ({
      season: entry.season_number,
      episodes: Number.isInteger(entry.episode_count) ? entry.episode_count : 0,
    }));
}

function parseSeasonsJson(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Réponse TMDB → colonnes de `tmdb_media`.
function rowFromDetails(mediaType, tmdbId, language, details, fetchedAt) {
  const isTv = mediaType === 'tv';
  const runtime = isTv
    ? (Array.isArray(details.episode_run_time) ? details.episode_run_time[0] : null)
    : details.runtime;
  const seasons = isTv ? seasonsFrom(details) : null;
  return {
    media_type: mediaType,
    tmdb_id: tmdbId,
    language,
    // `title` est NOT NULL : chaîne vide quand TMDB n'a pas de titre.
    title: textOrNull(isTv ? details.name : details.title, 255) || '',
    original_title: textOrNull(isTv ? details.original_name : details.original_title, 255),
    overview: textOrNull(details.overview),
    poster_path: textOrNull(details.poster_path, 128),
    backdrop_path: textOrNull(details.backdrop_path, 128),
    release_year: yearFrom(isTv ? details.first_air_date : details.release_date),
    vote_average: ratingOrNull(details.vote_average),
    runtime_minutes: smallIntOrNull(runtime),
    status: textOrNull(details.status, 32),
    seasons_json: seasons ? JSON.stringify(seasons) : null,
    fetched_at: fetchedAt,
  };
}

// Durée en minutes (film, ou épisode type d'une série) ; null si inconnue.
function runtimeOrNull(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Ligne de `tmdb_media` → Media.
function mediaFromRow(row) {
  return {
    mediaType: row.media_type,
    tmdbId: Number(row.tmdb_id),
    title: row.title,
    overview: row.overview ?? null,
    posterPath: row.poster_path ?? null,
    backdropPath: row.backdrop_path ?? null,
    year: row.release_year === null || row.release_year === undefined ? null : Number(row.release_year),
    rating: ratingOrNull(row.vote_average),
    runtimeMinutes: runtimeOrNull(row.runtime_minutes),
    status: row.status ?? null,
    seasons: parseSeasonsJson(row.seasons_json),
  };
}

function episodeFromRow(row) {
  return {
    episode: Number(row.episode),
    name: row.name ?? null,
    overview: row.overview ?? null,
    stillPath: row.still_path ?? null,
    runtimeMinutes: runtimeOrNull(row.runtime_minutes),
  };
}

const MEDIA_COLUMNS = [
  'media_type', 'tmdb_id', 'language', 'title', 'original_title', 'overview', 'poster_path',
  'backdrop_path', 'release_year', 'vote_average', 'runtime_minutes', 'status', 'seasons_json', 'fetched_at',
];
const MEDIA_UPDATE_COLUMNS = MEDIA_COLUMNS.slice(3);

const INSERT_MEDIA_SQL = `INSERT INTO tmdb_media (${MEDIA_COLUMNS.join(', ')})
  VALUES (${MEDIA_COLUMNS.map(() => '?').join(', ')})
  ON DUPLICATE KEY UPDATE ${MEDIA_UPDATE_COLUMNS.map((name) => `${name} = VALUES(${name})`).join(', ')}`;

const EPISODE_COLUMNS = ['tmdb_id', 'season', 'episode', 'language', 'name', 'overview', 'still_path', 'runtime_minutes', 'fetched_at'];

/**
 * @param {object} deps
 * @param {{ execute: Function }} deps.pool - pool mysql2/promise
 * @param {(type: 'movie'|'tv', id: number, language: string) => Promise<object|null>} deps.fetchDetails
 * @param {(tvId: number, season: number, language: string) => Promise<object|null>} deps.fetchSeason
 * @param {() => Date} [deps.now]
 */
function createMediaStore({ pool, fetchDetails, fetchSeason, now = () => new Date() }) {
  const limit = createLimiter(MAX_TMDB_CONCURRENCY);
  // Demandes TMDB en cours, fusionnées entre appels simultanés.
  const pendingMedia = new Map();
  const pendingSeasons = new Map();
  // Pannes TMDB récentes : clé `type:id:langue` → heure jusqu'à laquelle on
  // ne redemande pas.
  const failedUntil = new Map();

  function isFailingRecently(key) {
    const until = failedUntil.get(key);
    if (until === undefined) return false;
    if (until > now().getTime()) return true;
    failedUntil.delete(key);
    return false;
  }

  function rememberFailure(key, retryMs = FAILURE_RETRY_MS) {
    if (failedUntil.size >= MAX_REMEMBERED_FAILURES) failedUntil.clear();
    failedUntil.set(key, now().getTime() + retryMs);
  }

  // Clé de la mémoire des pannes pour une saison (distincte des titres).
  function seasonFailureKey(tmdbId, season, language) {
    return `season:${tmdbId}:${season}:${language}`;
  }

  async function storeRow(row) {
    try {
      await pool.execute(INSERT_MEDIA_SQL, MEDIA_COLUMNS.map((name) => row[name]));
    } catch (error) {
      logError(`enregistrement de ${row.media_type} ${row.tmdb_id} impossible`, error);
    }
  }

  // Demande un titre à TMDB et l'enregistre ; Media ou null, jamais d'exception.
  function fetchAndStore(mediaType, tmdbId, language) {
    const key = `${mediaKey(mediaType, tmdbId)}:${language}`;
    if (pendingMedia.has(key)) return pendingMedia.get(key);
    if (isFailingRecently(key)) return Promise.resolve(null);

    const work = (async () => {
      let details;
      try {
        details = await limit(() => fetchDetails(mediaType, tmdbId, language));
      } catch (error) {
        if (isNotFound(error)) {
          // Ligne « inconnue » (titre vide) : pas de nouvelle demande avant 1 jour.
          await storeRow(rowFromDetails(mediaType, tmdbId, language, {}, now()));
          return null;
        }
        logError(`TMDB ${mediaType} ${tmdbId} (${language}) indisponible`, error);
        rememberFailure(key);
        return null;
      }
      if (!details || typeof details !== 'object') {
        rememberFailure(key);
        return null;
      }
      if (details.id === undefined || details.id === null) {
        await storeRow(rowFromDetails(mediaType, tmdbId, language, {}, now()));
        return null;
      }

      const row = rowFromDetails(mediaType, tmdbId, language, details, now());
      await storeRow(row);
      return mediaFromRow(row);
    })().finally(() => pendingMedia.delete(key));

    pendingMedia.set(key, work);
    return work;
  }

  // `query` et non `execute` : une liste IN de longueur variable créerait une
  // requête préparée par longueur (limite `max_prepared_stmt_count`). Les
  // valeurs restent passées en `?`.
  async function selectMedia(pairs, language) {
    const rows = [];
    for (let start = 0; start < pairs.length; start += MAX_PAIRS_PER_SELECT) {
      const chunk = pairs.slice(start, start + MAX_PAIRS_PER_SELECT);
      const placeholders = chunk.map(() => '(?, ?)').join(', ');
      const params = [];
      for (const { mediaType, tmdbId } of chunk) params.push(mediaType, tmdbId);
      params.push(language);
      const [result] = await pool.query(
        `SELECT media_type, tmdb_id, title, overview, poster_path, backdrop_path, release_year,
          vote_average, runtime_minutes, status, seasons_json, fetched_at
        FROM tmdb_media
        WHERE (media_type, tmdb_id) IN (${placeholders}) AND language = ?`,
        params,
      );
      rows.push(...result);
    }
    return rows;
  }

  /**
   * Infos de plusieurs titres, clé `movie:550` / `tv:1399`.
   * Les titres sans infos (TMDB en panne, id inconnu, au-delà des 300
   * demandes TMDB de l'appel) sont absents de la Map.
   */
  async function getMany(items, language) {
    const lang = normalizeLanguage(language);
    const result = new Map();

    const pairs = [];
    const seen = new Set();
    for (const item of Array.isArray(items) ? items : []) {
      if (!item || (item.mediaType !== 'movie' && item.mediaType !== 'tv')) continue;
      const tmdbId = Number(item.tmdbId);
      if (!Number.isInteger(tmdbId) || tmdbId <= 0) continue;
      const key = mediaKey(item.mediaType, tmdbId);
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ mediaType: item.mediaType, tmdbId });
    }
    if (pairs.length === 0) return result;

    let rows = [];
    try {
      rows = await selectMedia(pairs, lang);
    } catch (error) {
      logError('lecture de tmdb_media impossible', error);
    }

    const nowMs = now().getTime();
    const staleBefore = nowMs - STALE_MS;
    const unknownBefore = nowMs - UNKNOWN_RETRY_MS;
    // Titres inconnus de TMDB depuis moins d'un jour : ni renvoyés, ni redemandés.
    const knownUnknown = new Set();
    const stale = [];
    for (const row of rows) {
      const fetchedAt = row.fetched_at instanceof Date ? row.fetched_at : new Date(row.fetched_at);
      const key = mediaKey(row.media_type, Number(row.tmdb_id));
      if (!row.title) {
        if (fetchedAt.getTime() >= unknownBefore) knownUnknown.add(key);
        continue;
      }
      const media = mediaFromRow(row);
      result.set(key, media);
      if (!(fetchedAt.getTime() >= staleBefore)) stale.push(media);
    }

    // Les plus récents d'abord (ordre de `items`), au plus 300 demandes TMDB.
    let budget = MAX_TMDB_FETCHES_PER_CALL;
    const missing = [];
    for (const pair of pairs) {
      const key = mediaKey(pair.mediaType, pair.tmdbId);
      if (result.has(key) || knownUnknown.has(key) || isFailingRecently(`${key}:${lang}`)) continue;
      if (budget <= 0) break;
      budget--;
      missing.push(pair);
    }
    for (const media of stale) {
      if (budget <= 0) break;
      budget--;
      // Rafraîchissement en arrière-plan : ne bloque ni ne fait échouer l'appelant.
      fetchAndStore(media.mediaType, media.tmdbId, lang)
        .catch((error) => logError('rafraîchissement TMDB impossible', error));
    }

    const fetched = await Promise.all(
      missing.map(({ mediaType, tmdbId }) => fetchAndStore(mediaType, tmdbId, lang).catch(() => null)),
    );
    for (const media of fetched) {
      if (media) result.set(mediaKey(media.mediaType, media.tmdbId), media);
    }
    return result;
  }

  // Demande une saison à TMDB et l'enregistre ; Map (vide en cas d'échec).
  // Échec gardé en mémoire comme pour les titres : saison inconnue (404)
  // 1 jour, panne ou réponse vide 10 minutes, sans nouvelle demande.
  function fetchAndStoreSeason(tmdbId, season, language) {
    const key = `${tmdbId}:${season}:${language}`;
    if (pendingSeasons.has(key)) return pendingSeasons.get(key);
    const failureKey = seasonFailureKey(tmdbId, season, language);
    if (isFailingRecently(failureKey)) return Promise.resolve(new Map());

    const work = (async () => {
      const episodes = new Map();
      let data;
      try {
        data = await limit(() => fetchSeason(tmdbId, season, language));
      } catch (error) {
        rememberFailure(failureKey, isNotFound(error) ? UNKNOWN_RETRY_MS : FAILURE_RETRY_MS);
        if (!isNotFound(error)) logError(`TMDB saison ${season} de ${tmdbId} (${language}) indisponible`, error);
        return episodes;
      }
      const list = data && Array.isArray(data.episodes) ? data.episodes : [];
      if (list.length === 0) rememberFailure(failureKey);
      const rows = [];
      const fetchedAt = now();
      for (const entry of list) {
        const number = smallIntOrNull(entry && entry.episode_number);
        if (number === null || episodes.has(number)) continue;
        const row = {
          tmdb_id: tmdbId,
          season,
          episode: number,
          language,
          name: textOrNull(entry.name, 255),
          overview: textOrNull(entry.overview),
          still_path: textOrNull(entry.still_path, 128),
          runtime_minutes: smallIntOrNull(entry.runtime),
          fetched_at: fetchedAt,
        };
        rows.push(row);
        episodes.set(number, episodeFromRow(row));
      }
      if (rows.length === 0) return episodes;

      const placeholders = rows.map(() => `(${EPISODE_COLUMNS.map(() => '?').join(', ')})`).join(', ');
      const params = [];
      for (const row of rows) params.push(...EPISODE_COLUMNS.map((name) => row[name]));
      try {
        // Nombre de lignes variable : `query` (voir selectMedia).
        await pool.query(
          `INSERT INTO tmdb_episodes (${EPISODE_COLUMNS.join(', ')}) VALUES ${placeholders}
          ON DUPLICATE KEY UPDATE name = VALUES(name), overview = VALUES(overview),
            still_path = VALUES(still_path), runtime_minutes = VALUES(runtime_minutes),
            fetched_at = VALUES(fetched_at)`,
          params,
        );
      } catch (error) {
        logError(`enregistrement de la saison ${season} de ${tmdbId} impossible`, error);
      }
      return episodes;
    })().finally(() => pendingSeasons.delete(key));

    pendingSeasons.set(key, work);
    return work;
  }

  /** Épisodes d'une saison, clé = numéro d'épisode ; Map vide en cas d'échec. */
  async function getEpisodes(tmdbId, season, language) {
    const lang = normalizeLanguage(language);
    const id = Number(tmdbId);
    const seasonNumber = Number(season);
    if (!Number.isInteger(id) || id <= 0 || smallIntOrNull(seasonNumber) === null) return new Map();

    try {
      const [rows] = await pool.execute(
        `SELECT episode, name, overview, still_path, runtime_minutes FROM tmdb_episodes
        WHERE tmdb_id = ? AND season = ? AND language = ?`,
        [id, seasonNumber, lang],
      );
      if (rows.length > 0) return new Map(rows.map((row) => [Number(row.episode), episodeFromRow(row)]));
    } catch (error) {
      logError('lecture de tmdb_episodes impossible', error);
    }
    return fetchAndStoreSeason(id, seasonNumber, lang).catch(() => new Map());
  }

  /**
   * Durées des épisodes de plusieurs saisons : une lecture groupée de
   * `tmdb_episodes` (`query`, par tranches de 500), puis TMDB pour les
   * saisons absentes (au plus 300 par appel, mémoire des pannes respectée).
   * @param {{ tmdbId: number, season: number }[]} seasons
   * @returns {Promise<Map<string, Map<number, number|null>>>} clé `id:saison`
   *   → minutes par numéro d'épisode ; saison inconnue → absente.
   */
  async function getEpisodeRuntimes(seasons, language) {
    const lang = normalizeLanguage(language);
    const result = new Map();
    const pairs = [];
    const seen = new Set();
    for (const item of Array.isArray(seasons) ? seasons : []) {
      const tmdbId = Number(item && item.tmdbId);
      const season = smallIntOrNull(item && item.season);
      if (!Number.isInteger(tmdbId) || tmdbId <= 0 || season === null) continue;
      const key = `${tmdbId}:${season}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ tmdbId, season, key });
    }

    try {
      for (let start = 0; start < pairs.length; start += MAX_PAIRS_PER_SELECT) {
        const chunk = pairs.slice(start, start + MAX_PAIRS_PER_SELECT);
        const params = [lang];
        for (const { tmdbId, season } of chunk) params.push(tmdbId, season);
        const [rows] = await pool.query(
          `SELECT tmdb_id, season, episode, runtime_minutes FROM tmdb_episodes
          WHERE language = ? AND (tmdb_id, season) IN (${chunk.map(() => '(?, ?)').join(', ')})`,
          params,
        );
        for (const row of rows) {
          const key = `${Number(row.tmdb_id)}:${Number(row.season)}`;
          if (!result.has(key)) result.set(key, new Map());
          result.get(key).set(Number(row.episode), runtimeOrNull(row.runtime_minutes));
        }
      }
    } catch (error) {
      logError('lecture groupée de tmdb_episodes impossible', error);
    }

    const missing = pairs
      .filter(({ tmdbId, season, key }) => !result.has(key) && !isFailingRecently(seasonFailureKey(tmdbId, season, lang)))
      .slice(0, MAX_TMDB_FETCHES_PER_CALL);
    const fetched = await Promise.all(missing.map(({ tmdbId, season }) => (
      fetchAndStoreSeason(tmdbId, season, lang).catch(() => new Map())
    )));
    fetched.forEach((episodes, index) => {
      if (episodes.size === 0) return;
      result.set(missing[index].key, new Map([...episodes].map(([number, episode]) => [number, episode.runtimeMinutes ?? null])));
    });
    return result;
  }

  return { getMany, getEpisodes, getEpisodeRuntimes };
}

/**
 * Câblage par défaut sur `utils/tmdbCache.js` (cache Redis) et la clé TMDB
 * du serveur. `tmdbCache` est chargé ici seulement, pour que les tests des
 * magasins n'ouvrent pas de connexion Redis.
 */
function createDefaultMediaStore(pool) {
  const { fetchTmdbDetails, fetchTmdbSeason } = require('./tmdbCache');
  const axios = require('axios');
  // `fetchTmdbDetails` rend null sur toute erreur. Sur un null, une seconde
  // demande directe dit si TMDB ne connaît pas le titre (404, levée telle
  // quelle et mémorisée un jour) ou s'il est en panne (erreur, 10 minutes).
  async function fetchDetails(type, id, language) {
    const details = await fetchTmdbDetails(TMDB_API_URL, process.env.TMDB_API_KEY, id, type, language);
    if (details) return details;
    const response = await axios.get(`${TMDB_API_URL}/${type}/${id}`, {
      params: { api_key: process.env.TMDB_API_KEY, language },
      timeout: 10000,
    });
    return response.data || null;
  }
  return createMediaStore({
    pool,
    fetchDetails,
    fetchSeason: (tvId, season, language) => fetchTmdbSeason(TMDB_API_URL, process.env.TMDB_API_KEY, tvId, season, language),
  });
}

module.exports = {
  MAX_TMDB_FETCHES_PER_CALL,
  createMediaStore,
  createDefaultMediaStore,
  normalizeLanguage,
};
