// Historique et progression d'un profil (`watch_progress`, `watch_history`).
// Propriétaire = user_type + user_id + profile_id, jamais user_id seul.
// Deux appareils peuvent écrire en même temps : l'écriture la plus récente
// gagne toujours, une écriture plus ancienne ne recule jamais rien.

const { isFinished, nextPointer } = require('./historyRules');
const { STATUS_KEYS, animeModeTitles, buildIndex, classify, lookupsFor, titleDetails } = require('./historyOverview');

const MAX_TUPLES_PER_SELECT = 500;

// Onglet « Historique » : classement gardé 30 s par propriétaire et langue
// (Précédent / Suivant ne refont pas tout), oublié à chaque écriture du
// propriétaire dans ce processus. Les autres workers du cluster gardent le
// leur au plus 30 s.
const OVERVIEW_TTL_MS = 30 * 1000;
const MAX_OVERVIEW_OWNERS = 200;

// Temps passé dans un lecteur web, même filtre que GET /api/wrapped/progress,
// plus les lignes « anime » (lecteur anime : contentId = id TMDB de la série,
// comptées comme « tv »). La télé en direct n'en fait jamais partie.
// `last_at` (dernière ligne par type) sert à reconnaître le mode anime.
const VIEWING_SQL = `SELECT content_type, content_id, season_number, episode_number, SUM(watch_duration) AS seconds,
    MAX(created_at) AS last_at
  FROM wrapped_viewing_data
  WHERE user_id = ? AND profile_id <=> ? AND content_type IN ('movie', 'tv', 'anime')
  GROUP BY content_type, content_id, season_number, episode_number`;

// Temps de lecteur web d'un titre. Comme VIEWING_SQL (et GET
// /api/wrapped/progress), wrapped_viewing_data n'a pas de user_type : le
// propriétaire y est user_id (= `sub` du jeton) + profile_id.
const DELETE_VIEWING_MOVIE_SQL = "DELETE FROM wrapped_viewing_data WHERE user_id = ? AND profile_id <=> ? AND content_type = 'movie' AND content_id = ?";
const DELETE_VIEWING_TV_SQL = "DELETE FROM wrapped_viewing_data WHERE user_id = ? AND profile_id <=> ? AND content_type IN ('tv', 'anime') AND content_id = ?";

function logError(message, error) {
  console.error(`[HISTORY] ${message}:`, error && error.message ? error.message : error);
}

function ownerParams(owner) {
  return [owner.userType, owner.userId, owner.profileId];
}

const OWNER_WHERE = 'user_type = ? AND user_id = ? AND profile_id = ?';

function ownerKeyOf(owner) {
  return `${owner.userType}:${owner.userId}:${owner.profileId}`;
}

function toDate(value) {
  if (value instanceof Date) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function toIso(value) {
  return toDate(value).toISOString();
}

function toSeconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.round(n), 2147483647);
}

function intOrNull(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

// Plus récente (ou égale) que la ligne en base : seule une telle écriture
// déplace le pointeur, change `finished` ou fait réapparaître le titre.
const IS_NEWER = 'VALUES(last_watched_at) >= last_watched_at';
// Réapparition d'un titre masqué : seulement pour une écriture strictement
// plus récente. `hide` ne touche pas `last_watched_at`, et `/api/sync` peut
// renvoyer une clé inchangée (même horodatage) : avec `>=`, ce renvoi ferait
// revenir le titre.
const IS_STRICTLY_NEWER = 'VALUES(last_watched_at) > last_watched_at';

// Les affectations de ON DUPLICATE KEY UPDATE s'appliquent de gauche à droite :
// `last_watched_at` doit rester la dernière, les autres lisent l'ancienne valeur.
const UPSERT_HISTORY_SQL = `INSERT INTO watch_history
  (user_type, user_id, profile_id, media_type, tmdb_id, season, episode, finished, hidden, last_watched_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  ON DUPLICATE KEY UPDATE
    season = IF(${IS_NEWER}, VALUES(season), season),
    episode = IF(${IS_NEWER}, VALUES(episode), episode),
    finished = IF(${IS_NEWER}, VALUES(finished), finished),
    hidden = IF(${IS_STRICTLY_NEWER}, 0, hidden),
    last_watched_at = GREATEST(last_watched_at, VALUES(last_watched_at))`;

// Ouverture sans progression : `finished` gardé si la ligne pointe déjà le
// même épisode (ou si aucun épisode n'est donné), remis à 0 sinon ; un
// pointeur absent ne remplace pas celui en base.
const TOUCH_HISTORY_SQL = `INSERT INTO watch_history
  (user_type, user_id, profile_id, media_type, tmdb_id, season, episode, finished, hidden, last_watched_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
  ON DUPLICATE KEY UPDATE
    finished = IF(${IS_NEWER},
      IF(VALUES(season) IS NULL OR (season <=> VALUES(season) AND episode <=> VALUES(episode)), finished, 0),
      finished),
    season = IF(${IS_NEWER}, COALESCE(VALUES(season), season), season),
    episode = IF(${IS_NEWER}, IF(VALUES(season) IS NULL, episode, VALUES(episode)), episode),
    hidden = IF(${IS_STRICTLY_NEWER}, 0, hidden),
    last_watched_at = GREATEST(last_watched_at, VALUES(last_watched_at))`;

// Point de revue 4 : la position la plus récente (par updated_at) gagne.
const UPSERT_PROGRESS_SQL = `INSERT INTO watch_progress
  (user_type, user_id, profile_id, media_type, tmdb_id, season, episode, position_sec, duration_sec, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON DUPLICATE KEY UPDATE
    position_sec = IF(VALUES(updated_at) >= updated_at, VALUES(position_sec), position_sec),
    duration_sec = IF(VALUES(updated_at) >= updated_at, VALUES(duration_sec), duration_sec),
    updated_at = GREATEST(updated_at, VALUES(updated_at))`;

/**
 * @param {object} deps
 * @param {{ execute: Function, query: Function }} deps.pool - pool mysql2/promise
 * @param {{ getMany: Function, getEpisodes: Function }} deps.mediaStore - voir `utils/mediaStore.js`
 * @param {() => number} [deps.now] - horloge (ms) de la mémoire de l'onglet « Historique »
 */
function createHistoryStore({ pool, mediaStore, now = () => Date.now() }) {
  // Classements de l'onglet « Historique » : propriétaire → langue →
  // { expiresAt, promise }. La promesse est partagée par les appels simultanés.
  const overviews = new Map();

  function forgetOverview(owner) {
    overviews.delete(ownerKeyOf(owner));
  }

  // Au-delà de 200 propriétaires : on retire d'abord les classements
  // expirés, puis les plus anciens.
  function makeRoomForOverview(time) {
    if (overviews.size < MAX_OVERVIEW_OWNERS) return;
    for (const [key, byLanguage] of overviews) {
      if ([...byLanguage.values()].every((entry) => entry.expiresAt <= time)) overviews.delete(key);
    }
    for (const key of overviews.keys()) {
      if (overviews.size < MAX_OVERVIEW_OWNERS) break;
      overviews.delete(key);
    }
  }

  // Saisons d'une série pour calculer l'épisode suivant ; null si inconnues.
  async function seasonsOf(tmdbId) {
    try {
      const media = await mediaStore.getMany([{ mediaType: 'tv', tmdbId }], 'fr-FR');
      const found = media.get(`tv:${tmdbId}`);
      return found && Array.isArray(found.seasons) ? found.seasons : null;
    } catch (error) {
      logError(`saisons de la série ${tmdbId} indisponibles`, error);
      return null;
    }
  }

  /**
   * Enregistre une position puis met à jour la carte « Reprendre » du titre.
   * Film : saison/épisode 0/0 dans `watch_progress`, NULL dans `watch_history`.
   */
  async function recordProgress(owner, { mediaType, tmdbId, season, episode, position, duration, updatedAt }) {
    const isTv = mediaType === 'tv';
    const seasonNumber = isTv ? Number(season) : 0;
    const episodeNumber = isTv ? Number(episode) : 0;
    const at = toDate(updatedAt);

    await pool.execute(UPSERT_PROGRESS_SQL, [
      ...ownerParams(owner), mediaType, tmdbId, seasonNumber, episodeNumber,
      toSeconds(position), toSeconds(duration), at,
    ]);

    const finished = isFinished(position, duration);
    const seasons = isTv && finished ? await seasonsOf(tmdbId) : null;
    const pointer = nextPointer({ mediaType, season: seasonNumber, episode: episodeNumber, finished, seasons, status: null });

    await pool.execute(UPSERT_HISTORY_SQL, [
      ...ownerParams(owner), mediaType, tmdbId,
      isTv ? pointer.season : null,
      isTv ? pointer.episode : null,
      pointer.finished ? 1 : 0,
      at,
    ]);
  }

  /** Crée ou avance la ligne d'historique d'un titre ouvert, sans progression. */
  async function touch(owner, { mediaType, tmdbId, season, episode, at }) {
    const isTv = mediaType === 'tv';
    const seasonNumber = isTv ? intOrNull(season) : null;
    const episodeNumber = isTv && seasonNumber !== null ? intOrNull(episode) : null;
    const hasPointer = seasonNumber !== null && episodeNumber !== null;
    await pool.execute(TOUCH_HISTORY_SQL, [
      ...ownerParams(owner), mediaType, tmdbId,
      hasPointer ? seasonNumber : null,
      hasPointer ? episodeNumber : null,
      toDate(at),
    ]);
  }

  // Progression des épisodes pointés, en un seul SELECT (par tranches de 500).
  // `query` et non `execute` : une liste IN de longueur variable créerait une
  // requête préparée par longueur (limite `max_prepared_stmt_count`). Les
  // valeurs restent passées en `?`.
  async function progressFor(owner, targets) {
    const result = new Map();
    for (let start = 0; start < targets.length; start += MAX_TUPLES_PER_SELECT) {
      const chunk = targets.slice(start, start + MAX_TUPLES_PER_SELECT);
      const params = [...ownerParams(owner)];
      for (const target of chunk) params.push(target.mediaType, target.tmdbId, target.season, target.episode);
      const [rows] = await pool.query(
        `SELECT media_type, tmdb_id, season, episode, position_sec, duration_sec
        FROM watch_progress
        WHERE ${OWNER_WHERE} AND (media_type, tmdb_id, season, episode) IN (${chunk.map(() => '(?, ?, ?, ?)').join(', ')})`,
        params,
      );
      for (const row of rows) {
        result.set(`${row.media_type}:${Number(row.tmdb_id)}:${Number(row.season)}:${Number(row.episode)}`, {
          position: Number(row.position_sec) || 0,
          duration: Number(row.duration_sec) || 0,
        });
      }
    }
    return result;
  }

  // Ligne `watch_history` → entrée (pointeur NULL pour un film).
  function entryFromRow(row) {
    const mediaType = row.media_type;
    const isTv = mediaType === 'tv';
    const season = isTv ? intOrNull(row.season) : null;
    const episode = isTv && season !== null ? intOrNull(row.episode) : null;
    return { mediaType, tmdbId: Number(row.tmdb_id), season, episode, lastWatchedAt: row.last_watched_at };
  }

  /**
   * Infos TMDB des entrées : titre (`getMany`) et épisode pointé
   * (`getEpisodes`, un appel par série et par saison). Erreur → infos absentes.
   */
  async function loadDetails(entries, language, label) {
    let media = new Map();
    try {
      media = await mediaStore.getMany(entries.map(({ mediaType, tmdbId }) => ({ mediaType, tmdbId })), language);
    } catch (error) {
      logError(`infos TMDB ${label} indisponibles`, error);
    }

    const seasonKeys = new Map();
    for (const entry of entries) {
      // Mode anime : numéros anime-sama, pas d'épisode TMDB à lire.
      if (entry.mediaType !== 'tv' || entry.season === null || entry.animeMode) continue;
      const key = `${entry.tmdbId}:${entry.season}`;
      if (!seasonKeys.has(key)) seasonKeys.set(key, { tmdbId: entry.tmdbId, season: entry.season });
    }
    const episodesBySeason = new Map();
    await Promise.all([...seasonKeys].map(async ([key, { tmdbId, season }]) => {
      try {
        episodesBySeason.set(key, await mediaStore.getEpisodes(tmdbId, season, language));
      } catch (error) {
        logError(`épisodes de ${tmdbId} saison ${season} indisponibles`, error);
      }
    }));
    return { media, episodesBySeason };
  }

  // Entrée + infos TMDB + position → ContinueItem. Partagé par « Reprendre »
  // et l'onglet « Historique ».
  function buildItem(entry, { media, episodesBySeason }, watched) {
    const isTv = entry.mediaType === 'tv';
    const info = media.get(`${entry.mediaType}:${entry.tmdbId}`) || null;
    const episodeInfo = isTv && entry.season !== null && !entry.animeMode
      ? (episodesBySeason.get(`${entry.tmdbId}:${entry.season}`) || new Map()).get(entry.episode) || null
      : null;
    return {
      mediaType: entry.mediaType,
      tmdbId: entry.tmdbId,
      season: entry.season,
      episode: entry.episode,
      position: watched.position,
      duration: watched.duration,
      lastWatchedAt: toIso(entry.lastWatchedAt),
      title: info && info.title ? info.title : null,
      overview: info ? info.overview ?? null : null,
      posterPath: info ? info.posterPath ?? null : null,
      backdropPath: info ? info.backdropPath ?? null : null,
      year: info ? info.year ?? null : null,
      rating: info ? info.rating ?? null : null,
      episodeName: episodeInfo ? episodeInfo.name ?? null : null,
      episodeOverview: episodeInfo ? episodeInfo.overview ?? null : null,
      stillPath: episodeInfo ? episodeInfo.stillPath ?? null : null,
      animeMode: Boolean(entry.animeMode),
    };
  }

  /**
   * Rangée « Reprendre » complète, la plus récente en premier, sans limite.
   * Titre sans infos TMDB → gardé avec `title: null` (le client le cache).
   */
  async function listContinue(owner, language) {
    // Mode anime : même lecture wrapped que l'onglet « Historique », lancée en
    // même temps (en panne → aucun titre en mode anime).
    const [[rows], viewingRows] = await Promise.all([
      pool.execute(
        `SELECT media_type, tmdb_id, season, episode, last_watched_at
        FROM watch_history
        WHERE ${OWNER_WHERE} AND finished = 0 AND hidden = 0
        ORDER BY last_watched_at DESC, media_type DESC, tmdb_id DESC`,
        ownerParams(owner),
      ),
      viewingRowsOf(owner),
    ]);
    if (rows.length === 0) return [];
    const animeTitles = animeModeTitles(viewingRows);
    const entries = rows.map(entryFromRow).map((entry) => (
      { ...entry, animeMode: entry.mediaType === 'tv' && animeTitles.has(entry.tmdbId) }
    ));
    const details = await loadDetails(entries, language, 'de la rangée « Reprendre »');
    const targets = [];
    for (const entry of entries) {
      if (entry.mediaType === 'movie') targets.push({ mediaType: 'movie', tmdbId: entry.tmdbId, season: 0, episode: 0 });
      else if (entry.season !== null && entry.episode !== null) targets.push(entry);
    }
    const progress = targets.length > 0 ? await progressFor(owner, targets) : new Map();

    return entries.map((entry) => {
      const progressKey = entry.mediaType === 'tv'
        ? `tv:${entry.tmdbId}:${entry.season}:${entry.episode}`
        : `movie:${entry.tmdbId}:0:0`;
      return buildItem(entry, details, progress.get(progressKey) || { position: 0, duration: 0 });
    });
  }

  // Temps passé dans un lecteur web ; table absente ou en panne → aucun
  // (l'onglet reste lisible, sans estimation).
  async function viewingRowsOf(owner) {
    try {
      const [rows] = await pool.execute(VIEWING_SQL, [owner.userId, owner.profileId]);
      return Array.isArray(rows) ? rows : [];
    } catch (error) {
      logError('temps des lecteurs web indisponible', error);
      return [];
    }
  }

  // Durées des épisodes des saisons à estimer : une lecture groupée du cache
  // (`getEpisodeRuntimes`), TMDB seulement pour les saisons absentes.
  // Erreur → aucune durée d'épisode (repli sur la durée type de la série).
  async function seasonRuntimes(seasons, language) {
    if (seasons.length === 0) return new Map();
    try {
      return await mediaStore.getEpisodeRuntimes(seasons, language);
    } catch (error) {
      logError("durées des épisodes de l'historique indisponibles", error);
      return new Map();
    }
  }

  // Classement complet du profil : 4 lectures indexées (préfixe de la clé
  // primaire pour les tables de l'historique ; `wrapped_viewing_data` par un
  // index qui commence par `user_id`, `idx_user_year` sur le plan mesuré),
  // infos TMDB des titres qui en ont besoin, puis classement en mémoire.
  async function computeOverview(owner, language) {
    const [[historyRows], [progressRows], [markRows], viewingRows] = await Promise.all([
      pool.execute(
        `SELECT media_type, tmdb_id, season, episode, finished, last_watched_at FROM watch_history WHERE ${OWNER_WHERE}`,
        ownerParams(owner),
      ),
      pool.execute(
        `SELECT media_type, tmdb_id, season, episode, position_sec, duration_sec FROM watch_progress WHERE ${OWNER_WHERE}`,
        ownerParams(owner),
      ),
      pool.execute(
        `SELECT media_type, tmdb_id, season, episode, marked_at FROM watch_marks WHERE ${OWNER_WHERE}`,
        ownerParams(owner),
      ),
      viewingRowsOf(owner),
    ]);
    const index = buildIndex({ historyRows, progressRows, markRows, viewingRows });
    const { mediaItems, seasons } = lookupsFor(index);

    let media = new Map();
    if (mediaItems.length > 0) {
      try {
        media = await mediaStore.getMany(mediaItems, language);
      } catch (error) {
        logError("infos TMDB de l'historique indisponibles", error);
      }
    }
    // Séries récentes d'abord : le budget TMDB de 300 saisons par appel
    // (getEpisodeRuntimes) va aux plus récentes.
    const episodeRuntimes = await seasonRuntimes(seasons, language);
    return classify(index, { media, episodeRuntimes });
  }

  function overviewOf(owner, language) {
    const key = ownerKeyOf(owner);
    const time = now();
    let byLanguage = overviews.get(key);
    const cached = byLanguage && byLanguage.get(language);
    if (cached && cached.expiresAt > time) return cached.promise;
    if (!byLanguage) {
      makeRoomForOverview(time);
      byLanguage = new Map();
      overviews.set(key, byLanguage);
    }
    const entry = { expiresAt: time + OVERVIEW_TTL_MS, promise: computeOverview(owner, language) };
    byLanguage.set(language, entry);
    // Échec : rien n'est gardé, le prochain appel recommence.
    entry.promise.catch(() => {
      if (byLanguage.get(language) === entry) byLanguage.delete(language);
    });
    return entry.promise;
  }

  // Lignes d'une page : infos TMDB de la page seulement.
  async function pageItems(titles, language) {
    const entries = titles.map((title) => ({
      mediaType: title.mediaType, tmdbId: title.tmdbId, season: title.season, episode: title.episode, lastWatchedAt: new Date(title.date),
      animeMode: title.animeMode,
    }));
    const details = await loadDetails(entries, language, "de l'historique");
    return titles.map((title, index) => ({
      ...buildItem(entries[index], details, { position: title.position, duration: title.duration }),
      finished: title.status === 'finished',
      estimated: title.estimated,
      markedWatched: title.markedWatched,
      episodesWatched: title.episodesWatched,
      episodesTotal: title.episodesTotal,
    }));
  }

  /**
   * Onglet « Historique » du profil : une page de titres d'un statut, les
   * compteurs des trois statuts et les chiffres (voir `historyOverview.js`
   * pour les règles). Titres masqués compris : « masqué » ne concerne que
   * « Reprendre ».
   * `cache: false` (import pas encore fait) : classement calculé sans être
   * gardé ni repris de la mémoire, la liste étant peut-être partielle.
   * @param {{ status: 'in_progress'|'finished'|'not_started', language: string, page: number, pageSize: number, cache?: boolean }} options
   * @returns {Promise<{ items: object[], total: number, counts: object, stats: object }>}
   */
  async function listHistory(owner, { status, language, page, pageSize, cache = true }) {
    if (!STATUS_KEYS[status]) throw new Error(`Statut d'historique inconnu : ${status}`);
    const overview = cache ? await overviewOf(owner, language) : await computeOverview(owner, language);
    const matching = overview.titles.filter((title) => title.status === status);
    const offset = (page - 1) * pageSize;
    const slice = matching.slice(offset, offset + pageSize);
    return {
      items: slice.length > 0 ? await pageItems(slice, language) : [],
      total: matching.length,
      counts: { ...overview.counts },
      stats: { ...overview.stats },
    };
  }

  /**
   * Fiche d'un titre (GET /history/title) : tirée du même classement que
   * l'onglet « Historique » (même mémoire de 30 s, `cache` comme
   * `listHistory`), sans lecture TMDB de plus. Titre absent → null.
   */
  async function getTitle(owner, { mediaType, tmdbId, language, cache = true }) {
    const overview = cache ? await overviewOf(owner, language) : await computeOverview(owner, language);
    return titleDetails(overview, mediaType, tmdbId);
  }

  /** Toutes les positions d'un titre (un film : une seule, saison/épisode 0/0). */
  async function listProgress(owner, mediaType, tmdbId) {
    const [rows] = await pool.execute(
      `SELECT season, episode, position_sec, duration_sec, updated_at
      FROM watch_progress
      WHERE ${OWNER_WHERE} AND media_type = ? AND tmdb_id = ?
      ORDER BY season, episode`,
      [...ownerParams(owner), mediaType, tmdbId],
    );
    return rows.map((row) => ({
      season: Number(row.season),
      episode: Number(row.episode),
      position: Number(row.position_sec) || 0,
      duration: Number(row.duration_sec) || 0,
      updatedAt: toIso(row.updated_at),
    }));
  }

  /** Retire le titre de la rangée « Reprendre » (il revient à la prochaine lecture). */
  async function hide(owner, mediaType, tmdbId) {
    await pool.execute(
      `UPDATE watch_history SET hidden = 1 WHERE ${OWNER_WHERE} AND media_type = ? AND tmdb_id = ?`,
      [...ownerParams(owner), mediaType, tmdbId],
    );
  }

  /**
   * Vide la rangée « Reprendre » du profil en une seule requête (« Tout
   * retirer ») : une requête par titre buterait sur la limite de débit.
   * @returns {Promise<number>} nombre de cartes masquées
   */
  async function hideAll(owner) {
    const [result] = await pool.execute(
      `UPDATE watch_history SET hidden = 1 WHERE ${OWNER_WHERE} AND hidden = 0`,
      ownerParams(owner),
    );
    return Number(result && result.affectedRows) || 0;
  }

  /**
   * Ajoute des marques « Déjà vu » ; une marque déjà présente garde sa date.
   * `markedAt` null → heure de l'insertion. Ne touche ni l'historique ni
   * « Reprendre ».
   * @param {{ mediaType: string, tmdbId: number, season: number, episode: number, markedAt: Date|null }[]} marks
   * @returns {Promise<number>} marques réellement ajoutées
   */
  async function addMarks(owner, marks) {
    let inserted = 0;
    const insertedAt = new Date(now());
    for (let start = 0; start < marks.length; start += MAX_TUPLES_PER_SELECT) {
      const chunk = marks.slice(start, start + MAX_TUPLES_PER_SELECT);
      const params = [];
      for (const mark of chunk) {
        params.push(...ownerParams(owner), mark.mediaType, mark.tmdbId, mark.season, mark.episode, mark.markedAt || insertedAt);
      }
      // Nombre de lignes variable : `query` (voir progressFor).
      const [result] = await pool.query(
        `INSERT IGNORE INTO watch_marks (user_type, user_id, profile_id, media_type, tmdb_id, season, episode, marked_at)
        VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
        params,
      );
      inserted += Number(result && result.affectedRows) || 0;
    }
    return inserted;
  }

  /**
   * Retire des marques « Déjà vu » du profil.
   * @returns {Promise<number>} marques retirées
   */
  async function removeMarks(owner, marks) {
    let removed = 0;
    for (let start = 0; start < marks.length; start += MAX_TUPLES_PER_SELECT) {
      const chunk = marks.slice(start, start + MAX_TUPLES_PER_SELECT);
      const params = [...ownerParams(owner)];
      for (const mark of chunk) params.push(mark.mediaType, mark.tmdbId, mark.season, mark.episode);
      const [result] = await pool.query(
        `DELETE FROM watch_marks
        WHERE ${OWNER_WHERE} AND (media_type, tmdb_id, season, episode) IN (${chunk.map(() => '(?, ?, ?, ?)').join(', ')})`,
        params,
      );
      removed += Number(result && result.affectedRows) || 0;
    }
    return removed;
  }

  /**
   * Remplace toutes les marques « Déjà vu » du profil par `marks` : celles
   * qui manquent sont ajoutées (une marque gardée garde sa date), les autres
   * retirées. À appeler sous le verrou de synchro du profil.
   * @returns {Promise<{ added: number, removed: number }>}
   */
  async function replaceMarks(owner, marks) {
    const markId = (mark) => `${mark.mediaType}:${mark.tmdbId}:${mark.season}:${mark.episode}`;
    const [rows] = await pool.execute(
      `SELECT media_type, tmdb_id, season, episode FROM watch_marks WHERE ${OWNER_WHERE}`,
      ownerParams(owner),
    );
    const wanted = new Map(marks.map((mark) => [markId(mark), mark]));
    const existing = new Set();
    const removals = [];
    for (const row of rows) {
      const mark = { mediaType: row.media_type, tmdbId: Number(row.tmdb_id), season: Number(row.season), episode: Number(row.episode) };
      existing.add(markId(mark));
      if (!wanted.has(markId(mark))) removals.push(mark);
    }
    const additions = [...wanted].filter(([id]) => !existing.has(id)).map(([, mark]) => mark);
    const removed = removals.length > 0 ? await removeMarks(owner, removals) : 0;
    const added = additions.length > 0 ? await addMarks(owner, additions) : 0;
    return { added, removed };
  }

  /**
   * « Supprimer de l'historique » (partie base) : efface la progression,
   * l'historique et les marques du titre pour ce propriétaire, puis son temps
   * de lecteur web (`wrapped_viewing_data` : `movie` pour un film, `tv` et
   * `anime` pour une série). Une panne de cette dernière étape est seulement
   * loguée. À appeler sous le verrou de synchro, après le nettoyage du fichier.
   */
  async function deleteTitle(owner, mediaType, tmdbId) {
    for (const table of ['watch_progress', 'watch_history', 'watch_marks']) {
      await pool.execute(
        `DELETE FROM ${table} WHERE ${OWNER_WHERE} AND media_type = ? AND tmdb_id = ?`,
        [...ownerParams(owner), mediaType, tmdbId],
      );
    }
    try {
      await pool.execute(mediaType === 'tv' ? DELETE_VIEWING_TV_SQL : DELETE_VIEWING_MOVIE_SQL, [owner.userId, owner.profileId, String(tmdbId)]);
    } catch (error) {
      logError(`temps du lecteur web de ${mediaType}:${tmdbId} non effacé`, error);
    }
  }

  /**
   * Profil supprimé : efface sa progression, son historique, ses marques
   * « Déjà vu » et sa marque d'import. Une erreur SQL est propagée
   * (l'appelant la logue).
   */
  async function deleteProfile(owner) {
    for (const table of ['watch_progress', 'watch_history', 'watch_marks', 'watch_history_imports']) {
      await pool.execute(`DELETE FROM ${table} WHERE ${OWNER_WHERE}`, ownerParams(owner));
    }
  }

  // Une écriture oublie le classement de l'onglet « Historique » du
  // propriétaire, même si elle échoue à mi-chemin.
  const forgetting = (write) => async (owner, ...args) => {
    try {
      return await write(owner, ...args);
    } finally {
      forgetOverview(owner);
    }
  };

  return {
    recordProgress: forgetting(recordProgress),
    touch: forgetting(touch),
    listContinue,
    listHistory,
    getTitle,
    listProgress,
    hide: forgetting(hide),
    hideAll: forgetting(hideAll),
    addMarks: forgetting(addMarks),
    removeMarks: forgetting(removeMarks),
    replaceMarks: forgetting(replaceMarks),
    deleteProfile: forgetting(deleteProfile),
    deleteTitle: forgetting(deleteTitle),
  };
}

module.exports = { createHistoryStore };
