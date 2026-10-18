// Règles pures de l'historique (aucune base, aucune entrée/sortie) :
// lecture des clés et valeurs de synchro, des anciens formats de
// `continueWatching`, seuil « fini » et calcul de l'épisode suivant.

// Seuil « fini », le même que `Library.FINISHED_RATIO` et `HLSPlayer`.
const FINISHED_RATIO = 0.95;

// Bornes des colonnes SQL (INT pour tmdb_id, SMALLINT pour saison/épisode).
const MAX_INT = 2147483647;
const MAX_SMALLINT = 32767;

const MOVIE_KEY_RE = /^progress_(\d+)$/;
const EPISODE_KEY_RE = /^progress_tv_(\d+)_s(\d+)_e(\d+)$/;

// Marques « Déjà vu » du site : listes de titres et épisodes cochés d'une série.
const MARK_LIST_KEYS = { watched_movie: 'movie', watched_tv: 'tv' };
const EPISODE_MARKS_KEY_RE = /^watched_episodes_tv_(\d+)$/;
// Ancienne clé, encore lue par le site : `[{ id, episodeInfo: { season, episode }, addedAt }]`.
const LEGACY_EPISODE_LIST_KEY = 'watched_tv_episodes';
const EPISODE_MARK_RE = /^S(\d+)E(\d+)$/i;

// Entier dans [min, max], donné en nombre ou en chaîne de chiffres ; sinon null.
function toBoundedInt(value, min, max) {
  let n;
  if (typeof value === 'number') {
    n = value;
  } else if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    n = Number(value.trim());
  } else {
    return null;
  }
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

function toTmdbId(value) {
  return toBoundedInt(value, 1, MAX_INT);
}

// Date valide ou null (chaîne ISO ou horodatage en millisecondes).
function toDate(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function safeJsonParse(raw) {
  if (typeof raw !== 'string') return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * `progress_550` → film 550 (saison 0, épisode 0) ;
 * `progress_tv_94997_s2_e3` → épisode S2E3 de la série 94997 ; sinon null.
 */
function parseProgressKey(key) {
  if (typeof key !== 'string') return null;

  const movie = MOVIE_KEY_RE.exec(key);
  if (movie) {
    const tmdbId = toTmdbId(movie[1]);
    return tmdbId ? { mediaType: 'movie', tmdbId, season: 0, episode: 0 } : null;
  }

  const episode = EPISODE_KEY_RE.exec(key);
  if (episode) {
    const tmdbId = toTmdbId(episode[1]);
    const seasonNumber = toBoundedInt(episode[2], 0, MAX_SMALLINT);
    const episodeNumber = toBoundedInt(episode[3], 1, MAX_SMALLINT);
    if (!tmdbId || seasonNumber === null || episodeNumber === null) return null;
    return { mediaType: 'tv', tmdbId, season: seasonNumber, episode: episodeNumber };
  }

  return null;
}

/**
 * JSON `{position, duration, timestamp}` → `{position, duration, updatedAt}`.
 * Position ou durée non finie ou négative, ou date absente/invalide → null.
 */
function parseProgressValue(raw) {
  const data = safeJsonParse(raw);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

  const { position, duration } = data;
  if (typeof position !== 'number' || !Number.isFinite(position) || position < 0) return null;
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) return null;

  const updatedAt = toDate(data.timestamp);
  if (!updatedAt) return null;

  return { position, duration, updatedAt };
}

// Pointeur d'épisode d'une entrée série ; incomplet ou invalide → nulls.
function readEpisodePointer(item) {
  const current = item && typeof item === 'object' ? item.currentEpisode : null;
  if (!current || typeof current !== 'object') return { season: null, episode: null };
  const season = toBoundedInt(current.season, 0, MAX_SMALLINT);
  const episode = toBoundedInt(current.episode, 1, MAX_SMALLINT);
  if (season === null || episode === null) return { season: null, episode: null };
  return { season, episode };
}

// Une entrée (objet `{id, …}` ou nombre seul) d'un type connu → entrée normalisée ou null.
function normalizeEntry(item, mediaType) {
  if (typeof item === 'number' || typeof item === 'string') {
    const tmdbId = toTmdbId(item);
    return tmdbId ? { mediaType, tmdbId, season: null, episode: null, lastAccessed: null } : null;
  }
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;

  const tmdbId = toTmdbId(item.id);
  if (!tmdbId) return null;

  const pointer = mediaType === 'tv' ? readEpisodePointer(item) : { season: null, episode: null };
  return {
    mediaType,
    tmdbId,
    season: pointer.season,
    episode: pointer.episode,
    lastAccessed: toDate(item.lastAccessed),
  };
}

/**
 * Lit `continueWatching` sous tous ses formats connus (voir la migration de
 * `src/pages/Home.tsx`) :
 * - `{movies: [{id, lastAccessed} | id], tv: [{id, currentEpisode, lastAccessed} | id]}` ;
 * - ancien tableau plat `[{id, media_type | type, currentEpisode?, lastAccessed?}]`.
 * Les entrées illisibles sont ignorées ; JSON invalide → `[]`.
 * `lastAccessed` absent ou invalide → null (l'import choisit la date de repli).
 */
function parseContinueWatching(raw) {
  const data = safeJsonParse(raw);
  const entries = [];

  if (Array.isArray(data)) {
    for (const item of data) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const kind = item.media_type ?? item.type;
      if (kind !== 'movie' && kind !== 'tv') continue;
      const entry = normalizeEntry(item, kind);
      if (entry) entries.push(entry);
    }
    return entries;
  }

  if (!data || typeof data !== 'object') return entries;

  for (const [field, mediaType] of [['movies', 'movie'], ['tv', 'tv']]) {
    const list = data[field];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const entry = normalizeEntry(item, mediaType);
      if (entry) entries.push(entry);
    }
  }
  return entries;
}

/**
 * Clé de marques « Déjà vu » :
 * - `watched_movie` / `watched_tv` → `{ kind: 'titles', mediaType }` ;
 * - `watched_episodes_tv_1399` → `{ kind: 'episodes', tmdbId: 1399 }` ;
 * - `watched_tv_episodes` (ancienne clé) → `{ kind: 'episodeList' }` ;
 * - autre clé (ou id invalide) → null.
 */
function parseMarksKey(key) {
  if (typeof key !== 'string') return null;
  if (Object.prototype.hasOwnProperty.call(MARK_LIST_KEYS, key)) return { kind: 'titles', mediaType: MARK_LIST_KEYS[key] };
  if (key === LEGACY_EPISODE_LIST_KEY) return { kind: 'episodeList' };
  const match = EPISODE_MARKS_KEY_RE.exec(key);
  if (!match) return null;
  const tmdbId = toTmdbId(match[1]);
  return tmdbId ? { kind: 'episodes', tmdbId } : null;
}

function markId(mediaType, tmdbId, season, episode) {
  return `${mediaType}:${tmdbId}:${season}:${episode}`;
}

/**
 * Marques d'une clé « Déjà vu », clé `type:id:saison:épisode` →
 * `{ mediaType, tmdbId, season, episode, markedAt }` :
 * - `watched_movie` / `watched_tv` : tableau `[{ id, addedAt, … }]` (ou ids
 *   seuls) → une marque de titre (saison/épisode 0/0), `markedAt` = `addedAt` ;
 * - `watched_episodes_tv_<id>` : objet `{ "S1E2": true }` → une marque par
 *   épisode à `true`, `markedAt` null (heure de l'insertion).
 * Date absente ou invalide → `markedAt` null. Valeur illisible ou d'une autre
 * forme → null (valeur inconnue, à ne pas prendre pour « aucune marque »).
 */
function parseMarks(key, raw) {
  const target = parseMarksKey(key);
  if (!target) return null;
  const data = safeJsonParse(raw);
  const marks = new Map();

  // Ancienne clé : une entrée par épisode vu ; sans episodeInfo valide → ignorée.
  if (target.kind === 'episodeList') {
    if (!Array.isArray(data)) return null;
    for (const item of data) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const tmdbId = toTmdbId(item.id);
      const info = item.episodeInfo && typeof item.episodeInfo === 'object' ? item.episodeInfo : null;
      const season = info ? toBoundedInt(info.season, 0, MAX_SMALLINT) : null;
      const episode = info ? toBoundedInt(info.episode, 1, MAX_SMALLINT) : null;
      if (!tmdbId || season === null || episode === null) continue;
      const markedAt = toDate(item.addedAt);
      const id = markId('tv', tmdbId, season, episode);
      const known = marks.get(id);
      if (known && !(markedAt && (!known.markedAt || markedAt > known.markedAt))) continue;
      marks.set(id, { mediaType: 'tv', tmdbId, season, episode, markedAt });
    }
    return marks;
  }

  if (target.kind === 'titles') {
    if (!Array.isArray(data)) return null;
    for (const item of data) {
      const isObject = Boolean(item) && typeof item === 'object' && !Array.isArray(item);
      const tmdbId = toTmdbId(isObject ? item.id : item);
      if (!tmdbId) continue;
      const markedAt = isObject ? toDate(item.addedAt) : null;
      const id = markId(target.mediaType, tmdbId, 0, 0);
      const known = marks.get(id);
      // Doublon : la date la plus récente.
      if (known && !(markedAt && (!known.markedAt || markedAt > known.markedAt))) continue;
      marks.set(id, { mediaType: target.mediaType, tmdbId, season: 0, episode: 0, markedAt });
    }
    return marks;
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  for (const [episodeKey, value] of Object.entries(data)) {
    if (value !== true) continue;
    const match = EPISODE_MARK_RE.exec(episodeKey);
    if (!match) continue;
    const season = toBoundedInt(match[1], 0, MAX_SMALLINT);
    const episode = toBoundedInt(match[2], 1, MAX_SMALLINT);
    if (season === null || episode === null) continue;
    marks.set(markId('tv', target.tmdbId, season, episode), { mediaType: 'tv', tmdbId: target.tmdbId, season, episode, markedAt: null });
  }
  return marks;
}

// Id d'une entrée de liste (`{ id }` ou id seul), en nombre ; sinon null.
function entryId(item) {
  return toTmdbId(item && typeof item === 'object' && !Array.isArray(item) ? item.id : item);
}

// Retire d'une valeur JSON (tableau) les entrées du titre ; valeur
// illisible ou rien à retirer → null (clé inchangée).
function withoutEntries(raw, keep) {
  const data = safeJsonParse(raw);
  if (!Array.isArray(data)) return null;
  const next = data.filter(keep);
  return next.length === data.length ? null : JSON.stringify(next);
}

/**
 * « Supprimer de l'historique » : retire un titre des données de synchro du
 * profil (modifiées en place).
 * - film : `progress_<id>`, son entrée dans `continueWatching` et `watched_movie` ;
 * - série : toutes les `progress_tv_<id>_s*_e*`, son entrée dans
 *   `continueWatching` et `watched_tv`, la clé `watched_episodes_tv_<id>` et
 *   ses entrées dans l'ancienne clé `watched_tv_episodes`.
 * Une valeur illisible est laissée telle quelle.
 * @returns {boolean} vrai si quelque chose a été retiré
 */
function removeTitleFromProfile(data, mediaType, tmdbId) {
  if (!data || typeof data !== 'object') return false;
  const isTv = mediaType === 'tv';
  let changed = false;
  const set = (key, value) => {
    if (value === null) return;
    data[key] = value;
    changed = true;
  };
  const remove = (key) => {
    if (!Object.prototype.hasOwnProperty.call(data, key)) return;
    delete data[key];
    changed = true;
  };

  if (isTv) {
    const prefix = `progress_tv_${tmdbId}_`;
    for (const key of Object.keys(data)) {
      const target = key.startsWith(prefix) ? parseProgressKey(key) : null;
      if (target && target.tmdbId === tmdbId) remove(key);
    }
    remove(`watched_episodes_tv_${tmdbId}`);
    set(LEGACY_EPISODE_LIST_KEY, withoutEntries(data[LEGACY_EPISODE_LIST_KEY], (item) => entryId(item) !== tmdbId));
    set('watched_tv', withoutEntries(data.watched_tv, (item) => entryId(item) !== tmdbId));
  } else {
    remove(`progress_${tmdbId}`);
    set('watched_movie', withoutEntries(data.watched_movie, (item) => entryId(item) !== tmdbId));
  }

  // continueWatching : `{ movies, tv }`, ou ancien tableau plat avec `media_type` / `type`.
  const continueWatching = safeJsonParse(data.continueWatching);
  if (Array.isArray(continueWatching)) {
    set('continueWatching', withoutEntries(data.continueWatching, (item) => (
      !(entryId(item) === tmdbId && item && (item.media_type ?? item.type) === mediaType)
    )));
  } else if (continueWatching && typeof continueWatching === 'object') {
    const field = isTv ? 'tv' : 'movies';
    if (Array.isArray(continueWatching[field])) {
      const next = continueWatching[field].filter((item) => entryId(item) !== tmdbId);
      if (next.length !== continueWatching[field].length) {
        set('continueWatching', JSON.stringify({ ...continueWatching, [field]: next }));
      }
    }
  }
  return changed;
}

/** Fini = position ≥ 95 % d'une durée connue. */
function isFinished(position, duration) {
  return duration > 0 && position / duration >= FINISHED_RATIO;
}

/**
 * Pointeur de la carte « Reprendre » après une lecture.
 * - film : `finished` tel quel ;
 * - épisode non fini : même pointeur ;
 * - épisode fini, saisons connues : épisode suivant, sinon épisode 1 de la
 *   première saison suivante présente ; s'il n'y en a pas, la série est finie ;
 * - épisode fini sans saisons (TMDB indisponible) : la carte reste sur
 *   l'épisode plutôt que de faire sortir la série.
 */
function nextPointer({ mediaType, season, episode, finished, seasons }) {
  if (mediaType !== 'tv') return { season, episode, finished: Boolean(finished) };
  if (!finished) return { season, episode, finished: false };
  if (!Array.isArray(seasons)) return { season, episode, finished: false };

  const current = seasons.find((entry) => entry && entry.season === season);
  if (current && Number.isInteger(current.episodes) && episode < current.episodes) {
    return { season, episode: episode + 1, finished: false };
  }

  let nextSeason = null;
  for (const entry of seasons) {
    if (!entry || !Number.isInteger(entry.season) || entry.season <= season) continue;
    if (Number.isInteger(entry.episodes) && entry.episodes < 1) continue;
    if (nextSeason === null || entry.season < nextSeason) nextSeason = entry.season;
  }
  if (nextSeason !== null) return { season: nextSeason, episode: 1, finished: false };

  return { season, episode, finished: true };
}

module.exports = {
  FINISHED_RATIO,
  MAX_INT,
  MAX_SMALLINT,
  toBoundedInt,
  toDate,
  parseProgressKey,
  parseProgressValue,
  parseContinueWatching,
  parseMarksKey,
  parseMarks,
  removeTitleFromProfile,
  isFinished,
  nextPointer,
};
