// Onglet « Historique » du profil : classement en mémoire de tous les titres
// d'un profil (En cours / Terminés / Non démarrés) et chiffres, avec les
// mêmes seuils que la page profil du site (`useInProgressShows.ts`,
// `autoMarkWatched.ts`). Module pur : aucune base, aucune entrée/sortie.
//
// Titres = lignes `watch_history` (masquées comprises) ∪ titres marqués
// « Déjà vu » ∪ séries avec au moins un épisode marqué.
// Avancement d'un film ou d'un épisode : position exacte (`watch_progress`
// avec position > 0), sinon estimé avec le temps passé dans un lecteur web
// (`wrapped_viewing_data`) rapporté à la durée TMDB.

// Film vu à partir de 95 %, épisode vu au-delà de 85 % (exact) ou à 85 %
// (estimé), titre démarré à partir de 5 %.
const MOVIE_DONE_PERCENT = 95;
const EPISODE_DONE_PERCENT = 85;
const STARTED_PERCENT = 5;

const { MAX_INT, MAX_SMALLINT, toBoundedInt, toDate } = require('./historyRules');

/** Statut demandé → clé de `counts`. */
const STATUS_KEYS = { in_progress: 'inProgress', finished: 'finished', not_started: 'notStarted' };

const MOVIE_EPISODE = '0:0';
const EMPTY = new Map();

function titleKey(mediaType, tmdbId) {
  return `${mediaType}:${tmdbId}`;
}

function episodeKey(season, episode) {
  return `${season}:${episode}`;
}

function parseEpisodeKey(key) {
  const [season, episode] = key.split(':').map(Number);
  return { season, episode };
}

// Entier borné (nombre MySQL ou texte de chiffres) : règle commune de historyRules.
const toInt = toBoundedInt;

// Date MySQL (Date) ou texte → millisecondes ; illisible → 0.
function toTime(value) {
  const date = value instanceof Date ? value : toDate(value);
  const time = date ? date.getTime() : NaN;
  return Number.isNaN(time) ? 0 : time;
}

function mapOf(collection, key) {
  let map = collection.get(key);
  if (!map) {
    map = new Map();
    collection.set(key, map);
  }
  return map;
}

// Comparaisons de pourcentages en entiers (pas d'arrondi flottant à 85 % pile).
function atLeast(part, whole, percent) {
  return whole > 0 && part * 100 >= percent * whole;
}

function above(part, whole, percent) {
  return whole > 0 && part * 100 > percent * whole;
}

// Progression exacte : position ET durée enregistrées par un lecteur, > 0
// (même règle que le site) ; sinon l'estimé du lecteur web peut servir.
function isExact(progress) {
  return Boolean(progress) && progress.position > 0 && progress.duration > 0;
}

/**
 * Nombre d'épisodes d'une série d'après ses saisons TMDB, saison 0 exclue ;
 * null si les saisons sont inconnues.
 */
function episodesTotalOf(seasons) {
  if (!Array.isArray(seasons)) return null;
  let total = 0;
  let known = false;
  for (const entry of seasons) {
    if (!entry || !Number.isInteger(entry.season) || entry.season <= 0) continue;
    known = true;
    total += Number.isInteger(entry.episodes) && entry.episodes > 0 ? entry.episodes : 0;
  }
  return known ? total : null;
}

/**
 * Regroupe les lignes SQL du profil par titre.
 * @param {object} rows
 * @param {object[]} rows.historyRows - watch_history
 * @param {object[]} rows.progressRows - watch_progress
 * @param {object[]} rows.markRows - watch_marks
 * @param {object[]} rows.viewingRows - wrapped_viewing_data agrégé
 *   (content_type, content_id, season_number, episode_number, seconds)
 */
function buildIndex({ historyRows = [], progressRows = [], markRows = [], viewingRows = [] }) {
  const titles = new Map();
  const progress = new Map();
  const viewing = new Map();
  let trackedSeconds = 0;

  const titleOf = (mediaType, tmdbId) => {
    const key = titleKey(mediaType, tmdbId);
    let title = titles.get(key);
    if (!title) {
      title = { key, mediaType, tmdbId, history: null, titleMarked: false, episodeMarks: new Set(), lastMarkAt: null };
      titles.set(key, title);
    }
    return title;
  };

  for (const row of historyRows) {
    if (row.media_type !== 'movie' && row.media_type !== 'tv') continue;
    const tmdbId = toInt(row.tmdb_id, 1, MAX_INT);
    if (!tmdbId) continue;
    const isTv = row.media_type === 'tv';
    const season = isTv ? toInt(row.season, 0, MAX_SMALLINT) : null;
    const episode = season !== null ? toInt(row.episode, 0, MAX_SMALLINT) : null;
    titleOf(row.media_type, tmdbId).history = {
      season: episode === null ? null : season,
      episode,
      finished: Number(row.finished) === 1,
      lastWatchedAt: toTime(row.last_watched_at),
    };
  }

  for (const row of markRows) {
    if (row.media_type !== 'movie' && row.media_type !== 'tv') continue;
    const tmdbId = toInt(row.tmdb_id, 1, MAX_INT);
    const season = toInt(row.season, 0, MAX_SMALLINT);
    const episode = toInt(row.episode, 0, MAX_SMALLINT);
    if (!tmdbId || season === null || episode === null) continue;
    const isTitleMark = season === 0 && episode === 0;
    // Un film n'a pas d'épisodes.
    if (!isTitleMark && row.media_type !== 'tv') continue;
    const title = titleOf(row.media_type, tmdbId);
    if (isTitleMark) title.titleMarked = true;
    else title.episodeMarks.add(episodeKey(season, episode));
    const at = toTime(row.marked_at);
    if (title.lastMarkAt === null || at > title.lastMarkAt) title.lastMarkAt = at;
  }

  for (const row of progressRows) {
    if (row.media_type !== 'movie' && row.media_type !== 'tv') continue;
    const tmdbId = toInt(row.tmdb_id, 1, MAX_INT);
    const season = toInt(row.season, 0, MAX_SMALLINT);
    const episode = toInt(row.episode, 0, MAX_SMALLINT);
    if (!tmdbId || season === null || episode === null) continue;
    const key = row.media_type === 'movie' ? MOVIE_EPISODE : episodeKey(season, episode);
    mapOf(progress, titleKey(row.media_type, tmdbId)).set(key, {
      position: Math.max(Number(row.position_sec) || 0, 0),
      duration: Math.max(Number(row.duration_sec) || 0, 0),
    });
  }

  const animeTitles = animeModeTitles(viewingRows);
  for (const row of viewingRows) {
    // Lecteur anime (WatchAnime.tsx) : même id TMDB de série que « tv ».
    const mediaType = row.content_type === 'anime' ? 'tv' : row.content_type;
    if (mediaType !== 'movie' && mediaType !== 'tv') continue;
    const tmdbId = toInt(typeof row.content_id === 'number' ? row.content_id : String(row.content_id ?? ''), 1, MAX_INT);
    const seconds = Number(row.seconds);
    // Temps réel sur la page du lecteur (même source que Wrapped) : toutes
    // les lignes film/série/anime comptent, même celles qu'on ne sait pas attribuer.
    if (seconds > 0) trackedSeconds += seconds;
    if (!tmdbId || !(seconds > 0)) continue;
    // Épisodes : numérotation TMDB pour « tv », anime-sama pour « anime ».
    // On ne garde que les lignes du mode de la série, jamais les deux mêlées.
    if (mediaType === 'tv' && (row.content_type === 'anime') !== animeTitles.has(tmdbId)) continue;
    let key = MOVIE_EPISODE;
    if (mediaType === 'tv') {
      const season = toInt(row.season_number, 0, MAX_SMALLINT);
      const episode = toInt(row.episode_number, 1, MAX_SMALLINT);
      // Temps passé sur une série sans épisode connu : rien à estimer.
      if (season === null || episode === null) continue;
      key = episodeKey(season, episode);
    }
    const episodes = mapOf(viewing, titleKey(mediaType, tmdbId));
    episodes.set(key, (episodes.get(key) || 0) + seconds);
  }

  return { titles, progress, viewing, trackedSeconds, animeTitles };
}

/**
 * Séries regardées en « mode anime » (lecteur anime-sama : saisons et
 * épisodes dans la numérotation anime-sama, pas celle de TMDB). Rien ne le
 * dit dans les données enregistrées : on le déduit du temps du lecteur web.
 * Une série est en mode anime si sa ligne wrapped la plus récente
 * (`last_at` = MAX(created_at)) est de type `anime` plutôt que `tv`.
 * @returns {Set<number>} ids TMDB des séries en mode anime
 */
function animeModeTitles(viewingRows = []) {
  const latest = new Map();
  for (const row of viewingRows) {
    if (row.content_type !== 'tv' && row.content_type !== 'anime') continue;
    const tmdbId = toInt(typeof row.content_id === 'number' ? row.content_id : String(row.content_id ?? ''), 1, MAX_INT);
    if (!tmdbId) continue;
    const times = latest.get(tmdbId) || { tv: null, anime: null };
    const at = toTime(row.last_at);
    if (times[row.content_type] === null || at > times[row.content_type]) times[row.content_type] = at;
    latest.set(tmdbId, times);
  }
  const result = new Set();
  for (const [tmdbId, { tv, anime }] of latest) {
    if (anime !== null && (tv === null || anime > tv)) result.add(tmdbId);
  }
  return result;
}

// Date de tri : dernière lecture, sinon marque la plus récente.
function dateOf(title) {
  if (title.history) return title.history.lastWatchedAt;
  return title.lastMarkAt ?? 0;
}

// Date ↓, puis type ↓ (`tv` avant `movie`), puis id ↓ : même ordre que « Reprendre ».
function compareTitles(a, b) {
  return (b.date - a.date)
    || (a.mediaType === b.mediaType ? 0 : (a.mediaType < b.mediaType ? 1 : -1))
    || (b.tmdbId - a.tmdbId);
}

function sortedTitles(index) {
  return [...index.titles.values()]
    .map((title) => ({ title, date: dateOf(title), mediaType: title.mediaType, tmdbId: title.tmdbId }))
    .sort(compareTitles)
    .map(({ title, date }) => ({ title, date }));
}

/**
 * Infos TMDB utiles au classement, titres les plus récents d'abord :
 * - `mediaItems` : toutes les séries (total d'épisodes, durée d'épisode type)
 *   et les films à estimer (temps de lecteur web sans position exacte) ;
 * - `seasons` : saisons dont un épisode est à estimer (durée de l'épisode).
 */
function lookupsFor(index) {
  const mediaItems = [];
  const seasons = [];
  for (const { title } of sortedTitles(index)) {
    const progress = index.progress.get(title.key) || EMPTY;
    const viewing = index.viewing.get(title.key) || EMPTY;
    if (title.mediaType === 'tv') {
      mediaItems.push({ mediaType: 'tv', tmdbId: title.tmdbId });
      // Mode anime : numéros anime-sama, les saisons TMDB ne correspondent pas.
      if (index.animeTitles && index.animeTitles.has(title.tmdbId)) continue;
      const seen = new Set();
      for (const key of viewing.keys()) {
        if (isExact(progress.get(key))) continue;
        const { season } = parseEpisodeKey(key);
        if (seen.has(season)) continue;
        seen.add(season);
        seasons.push({ tmdbId: title.tmdbId, season });
      }
    } else if (!isExact(progress.get(MOVIE_EPISODE)) && (viewing.get(MOVIE_EPISODE) || 0) > 0) {
      mediaItems.push({ mediaType: 'movie', tmdbId: title.tmdbId });
    }
  }
  return { mediaItems, seasons };
}

function classifyMovie(title, progress, viewing, info) {
  const exact = progress.get(MOVIE_EPISODE);
  let position = null;
  let duration = null;
  let estimated = false;
  let done = false;
  let started = false;

  if (isExact(exact)) {
    position = exact.position;
    duration = exact.duration;
    done = atLeast(exact.position, exact.duration, MOVIE_DONE_PERCENT);
    started = atLeast(exact.position, exact.duration, STARTED_PERCENT);
  } else {
    const seconds = viewing.get(MOVIE_EPISODE) || 0;
    const minutes = info && info.runtimeMinutes;
    if (seconds > 0 && minutes > 0) {
      duration = minutes * 60;
      position = Math.min(seconds, duration);
      estimated = true;
      done = atLeast(seconds, duration, MOVIE_DONE_PERCENT);
      started = atLeast(seconds, duration, STARTED_PERCENT);
    }
  }

  const markedWatched = title.titleMarked;
  const finished = markedWatched || Boolean(title.history && title.history.finished) || done;
  let status = 'not_started';
  if (finished) status = 'finished';
  else if (started) status = 'in_progress';

  // Position connue (exacte ou estimée) : la fiche renvoie null sinon.
  const positionKnown = position !== null;
  // Sans exact ni estimé : position enregistrée (0) pour l'onglet ; film marqué : null.
  if (position === null && !markedWatched) {
    position = exact ? exact.position : 0;
    duration = exact ? exact.duration : 0;
  }

  return {
    status, season: null, episode: null, position, duration, estimated, markedWatched,
    episodesWatched: null, episodesTotal: null, animeMode: false, positionKnown, episodeSource: null,
  };
}

/**
 * Épisodes connus d'une série pour sa fiche : un par progression exacte,
 * estimé (temps de lecteur web avec durée connue) ou marque, triés par
 * saison puis épisode. `watched` = la règle de l'onglet (ensemble `watched`
 * déjà calculé). Numéros tels qu'enregistrés (anime-sama en mode anime).
 */
function episodeList(progress, viewing, marks, watched, runtimeOf) {
  const keys = new Set();
  for (const [key, entry] of progress) if (isExact(entry)) keys.add(key);
  for (const key of marks) keys.add(key);
  for (const [key, seconds] of viewing) {
    const minutes = runtimeOf(key);
    if (seconds > 0 && minutes > 0) keys.add(key);
  }
  return [...keys].map((key) => {
    const { season, episode } = parseEpisodeKey(key);
    const entry = progress.get(key);
    const seconds = viewing.get(key) || 0;
    const minutes = runtimeOf(key);
    let position = null;
    let duration = null;
    let estimated = false;
    if (isExact(entry)) {
      position = entry.position;
      duration = entry.duration;
    } else if (seconds > 0 && minutes > 0) {
      duration = minutes * 60;
      position = Math.min(seconds, duration);
      estimated = true;
    }
    return { season, episode, position, duration, estimated, watched: watched.has(key), marked: marks.has(key) };
  }).sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
}

// Dernier épisode vu (saison > 0 de préférence) ; null s'il n'y en a pas.
function lastEpisodeOf(keys) {
  let best = null;
  for (const key of keys) {
    const { season, episode } = parseEpisodeKey(key);
    const rank = season > 0 ? 1 : 0;
    if (!best || rank > best.rank
      || (rank === best.rank && (season > best.season || (season === best.season && episode > best.episode)))) {
      best = { rank, season, episode };
    }
  }
  return best;
}

// Mode anime (`animeMode`) : numéros anime-sama, donc pas de total TMDB
// (`episodesTotal` null, jamais « terminée » par le compte d'épisodes) ;
// `episodesWatched` compte les épisodes vus sans plafond.
function classifySeries(title, progress, viewing, info, runtimeOf, animeMode = false) {
  const watched = new Set();
  let started = false;

  for (const [key, entry] of progress) {
    if (!isExact(entry)) continue;
    if (above(entry.position, entry.duration, EPISODE_DONE_PERCENT)) watched.add(key);
    if (atLeast(entry.position, entry.duration, STARTED_PERCENT)) started = true;
  }
  for (const key of title.episodeMarks) watched.add(key);
  for (const [key, seconds] of viewing) {
    if (isExact(progress.get(key))) continue;
    const minutes = runtimeOf(key);
    if (!(minutes > 0)) continue;
    if (atLeast(seconds, minutes * 60, EPISODE_DONE_PERCENT)) watched.add(key);
    if (atLeast(seconds, minutes * 60, STARTED_PERCENT)) started = true;
  }
  if (watched.size > 0) started = true;

  let watchedCount = 0;
  for (const key of watched) if (parseEpisodeKey(key).season > 0) watchedCount++;
  const episodesTotal = animeMode ? null : episodesTotalOf(info && info.seasons);
  const markedWatched = title.titleMarked;
  const finished = markedWatched
    || Boolean(title.history && title.history.finished)
    || (episodesTotal !== null && episodesTotal > 0 && watchedCount >= episodesTotal);
  let status = 'not_started';
  if (finished) status = 'finished';
  else if (started) status = 'in_progress';

  // Série marquée vue en entier : tous ses épisodes connus comptent.
  let episodesWatched = episodesTotal !== null ? Math.min(watchedCount, episodesTotal) : watchedCount;
  if (markedWatched && episodesTotal !== null) episodesWatched = episodesTotal;

  // Épisode affiché : celui de l'historique, sinon le dernier épisode vu.
  let season = title.history ? title.history.season : null;
  let episode = title.history ? title.history.episode : null;
  if (season === null || episode === null) {
    const last = lastEpisodeOf(watched);
    season = last ? last.season : null;
    episode = last ? last.episode : null;
  }

  let position = 0;
  let duration = 0;
  let estimated = false;
  let positionKnown = false;
  if (season !== null) {
    const key = episodeKey(season, episode);
    const entry = progress.get(key);
    const seconds = viewing.get(key) || 0;
    const minutes = runtimeOf(key);
    if (isExact(entry)) {
      position = entry.position;
      duration = entry.duration;
      positionKnown = true;
    } else if (seconds > 0 && minutes > 0) {
      duration = minutes * 60;
      position = Math.min(seconds, duration);
      estimated = true;
      positionKnown = true;
    } else if (entry) {
      position = entry.position;
      duration = entry.duration;
    }
  }

  return {
    status, season, episode, position, duration, estimated, markedWatched, episodesWatched, episodesTotal, animeMode,
    positionKnown,
    // Références seulement : la liste d'épisodes n'est construite que pour
    // une fiche (titleDetails), jamais pour tout le classement. Ces champs
    // internes (episodeSource, positionKnown) ne doivent pas sortir : les
    // lignes de l'onglet (pageItems) listent leurs champs un par un, jamais
    // par un « ...title ».
    episodeSource: { progress, viewing, marks: title.episodeMarks, watched, runtimeOf },
  };
}

/**
 * Fiche d'un titre (GET /history/title) tirée du classement de l'onglet :
 * même statut, mêmes positions, mêmes épisodes vus. Position ni exacte ni
 * estimée (ou pas d'épisode courant) → `position` / `duration` null. Une
 * série marquée en entier (`markedWatched`) compte tous ses épisodes comme
 * vus, sans que `episodes` soit complété. Titre absent du classement → null.
 * @param {{ titles: object[] }} overview - résultat de `classify`
 */
function titleDetails(overview, mediaType, tmdbId) {
  const title = overview.titles.find((entry) => entry.mediaType === mediaType && entry.tmdbId === tmdbId);
  if (!title) return null;
  const source = title.episodeSource;
  return {
    mediaType: title.mediaType,
    tmdbId: title.tmdbId,
    status: title.status,
    markedWatched: title.markedWatched,
    animeMode: title.animeMode,
    estimated: title.estimated,
    position: title.positionKnown ? title.position : null,
    duration: title.positionKnown ? title.duration : null,
    season: title.season,
    episode: title.episode,
    episodesWatched: title.episodesWatched,
    episodesTotal: title.episodesTotal,
    episodes: source ? episodeList(source.progress, source.viewing, source.marks, source.watched, source.runtimeOf) : null,
  };
}

/**
 * Classe chaque titre et calcule les chiffres.
 * @param {ReturnType<typeof buildIndex>} index
 * @param {object} lookups
 * @param {Map<string, object>} [lookups.media] - Media par `type:id` (runtimeMinutes, seasons)
 * @param {Map<string, Map<number, number|null>>} [lookups.episodeRuntimes] -
 *   durée (minutes) par épisode, clé `id:saison`
 * @returns {{ titles: object[], counts: object, stats: object }} titres triés
 */
function classify(index, { media = new Map(), episodeRuntimes = new Map() } = {}) {
  const counts = { inProgress: 0, finished: 0, notStarted: 0 };
  let moviesFinished = 0;
  let episodesFinished = 0;

  // Durée d'un épisode : celle de l'épisode si connue, sinon l'épisode type
  // de la série.
  const runtimeFor = (tmdbId, info) => (key) => {
    const { season, episode } = parseEpisodeKey(key);
    const runtimes = episodeRuntimes.get(`${tmdbId}:${season}`);
    const minutes = runtimes ? runtimes.get(episode) : null;
    return minutes || (info && info.runtimeMinutes) || null;
  };

  const titles = sortedTitles(index).map(({ title, date }) => {
    const info = media.get(title.key) || null;
    const progress = index.progress.get(title.key) || EMPTY;
    const viewing = index.viewing.get(title.key) || EMPTY;
    const result = title.mediaType === 'movie'
      ? classifyMovie(title, progress, viewing, info)
      : classifySeries(title, progress, viewing, info, runtimeFor(title.tmdbId, info),
        Boolean(index.animeTitles && index.animeTitles.has(title.tmdbId)));
    counts[STATUS_KEYS[result.status]]++;
    if (title.mediaType === 'movie' && result.status === 'finished') moviesFinished++;
    if (title.mediaType === 'tv') episodesFinished += result.episodesWatched;
    return { mediaType: title.mediaType, tmdbId: title.tmdbId, date, ...result };
  });

  // Temps vu : positions exactes (bornées à leur durée), plus le temps des
  // lecteurs web sans position exacte, borné à la durée quand elle est connue.
  let watchedSeconds = 0;
  for (const episodes of index.progress.values()) {
    for (const entry of episodes.values()) watchedSeconds += Math.min(entry.position, entry.duration);
  }
  for (const [key, episodes] of index.viewing) {
    const [mediaType, id] = key.split(':');
    const info = media.get(key) || null;
    const progress = index.progress.get(key) || EMPTY;
    const runtimeOf = mediaType === 'tv' ? runtimeFor(Number(id), info) : () => (info && info.runtimeMinutes) || null;
    for (const [episode, seconds] of episodes) {
      if (isExact(progress.get(episode))) continue;
      const minutes = runtimeOf(episode);
      watchedSeconds += minutes > 0 ? Math.min(seconds, minutes * 60) : seconds;
    }
  }

  return {
    titles,
    counts,
    stats: {
      watchedSeconds: Math.round(watchedSeconds),
      trackedSeconds: Math.round(index.trackedSeconds || 0),
      moviesFinished,
      episodesFinished,
    },
  };
}

module.exports = {
  STATUS_KEYS,
  buildIndex,
  classify,
  episodesTotalOf,
  animeModeTitles,
  lookupsFor,
  titleDetails,
};
