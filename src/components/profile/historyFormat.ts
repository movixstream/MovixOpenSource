// Logique pure de l'onglet « Historique » : durées, épisodes, pages, ligne
// de date et lien de reprise. Module sans import (l'encodeur d'identifiant
// est passé en paramètre) : testé directement par node --test.

const safeSeconds = (value: number) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
const pad = (value: number) => String(value).padStart(2, '0');
const isEnglish = (language: string) => language.toLowerCase().startsWith('en');

/**
 * Durée longue. Français (et toute langue autre que l'anglais) : « 12h27 »,
 * « 1h00 », « 45 min ». Anglais : « 12h 27m », « 1h », « 45m ».
 */
export function formatHoursMinutes(seconds: number, language = 'fr'): string {
  const total = safeSeconds(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (isEnglish(language)) {
    if (hours === 0) return `${minutes}m`;
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return hours > 0 ? `${hours}h${pad(minutes)}` : `${minutes} min`;
}

/**
 * Chiffre « Visionné » : en grand le temps réel passé dans le lecteur
 * (trackedSeconds, comme Wrapped), en petit la somme des positions
 * (watchedSeconds). Ancien serveur sans trackedSeconds : la somme des
 * positions en grand et pas de ligne en plus.
 */
export function watchedFigures(
  stats: { watchedSeconds: number; trackedSeconds: number | null },
  language = 'fr',
): { main: string; fromPositions: string | null } {
  if (stats.trackedSeconds === null) return { main: formatHoursMinutes(stats.watchedSeconds, language), fromPositions: null };
  return {
    main: formatHoursMinutes(stats.trackedSeconds, language),
    fromPositions: formatHoursMinutes(stats.watchedSeconds, language),
  };
}

/** Position dans la vidéo : « 27:52 », « 1:02:05 ». */
export function formatClock(seconds: number): string {
  const total = safeSeconds(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}

/** « 27:52 / 3h17 » (« 27:52 / 3h 17m » en anglais) ; la position seule si la durée est inconnue. */
export function formatProgress(position: number, duration: number, language = 'fr'): string {
  const length = safeSeconds(duration);
  if (length === 0) return formatClock(position);
  return `${formatClock(Math.min(safeSeconds(position), length))} / ${formatHoursMinutes(length, language)}`;
}

/** Ce qu'affiche la ligne d'un film après « Film · ». */
export type MovieMeta =
  | { kind: 'estimated'; percent: number }
  | { kind: 'watched' }
  | { kind: 'progress'; text: string }
  | { kind: 'none' };

interface MovieProgress {
  position: number | null;
  duration: number | null;
  estimated: boolean;
  markedWatched: boolean;
}

/**
 * Lecteur web → « ≈ 47 % · estimé » (jamais sans durée connue) ; marqué
 * « Déjà vu » sans aucune progression → « Vu » ; sinon le temps
 * « 27:52 / 3h17 » (la durée seule pour un film ouvert jamais lancé).
 */
export function movieMeta(item: MovieProgress, language = 'fr'): MovieMeta {
  const position = safeSeconds(item.position ?? 0);
  const duration = safeSeconds(item.duration ?? 0);
  if (item.estimated) {
    // Le temps passé dans un lecteur web n'est pas une position : sans durée
    // pour en faire un pourcentage, on ne l'affiche pas comme « 47:12 ».
    if (position > 0 && duration > 0) {
      return { kind: 'estimated', percent: Math.min(100, Math.round((position / duration) * 100)) };
    }
    return item.markedWatched ? { kind: 'watched' } : { kind: 'none' };
  }
  if (item.markedWatched && position === 0) return { kind: 'watched' };
  if (position > 0 || duration > 0) return { kind: 'progress', text: formatProgress(position, duration, language) };
  return { kind: 'none' };
}

/**
 * Avancement de l'épisode affiché d'une série ou d'un animé : « 54 % »,
 * marqué estimé s'il vient du temps passé dans un lecteur web. null pour un
 * film (sa ligne montre déjà son temps) ou sans position et durée.
 */
export function episodeProgress(item: {
  mediaType: 'movie' | 'tv';
  position: number | null;
  duration: number | null;
  estimated: boolean;
}): { percent: number; estimated: boolean } | null {
  if (item.mediaType !== 'tv') return null;
  const position = safeSeconds(item.position ?? 0);
  const duration = safeSeconds(item.duration ?? 0);
  if (position === 0 || duration === 0) return null;
  return { percent: Math.min(100, Math.round((position / duration) * 100)), estimated: item.estimated };
}

/** Part des épisodes vus, arrondie et bornée ; null si le total est inconnu. */
export function episodePercent(watched: number, total: number | null): number | null {
  if (typeof total !== 'number' || !Number.isFinite(total) || total <= 0) return null;
  const seen = Number.isFinite(watched) && watched > 0 ? watched : 0;
  return Math.min(100, Math.round((seen / total) * 100));
}

/** Ce qu'affiche la ligne d'une série après le code d'épisode. */
export type SeriesMeta =
  | { kind: 'episodes'; watched: number; total: number; percent: number }
  | { kind: 'count'; watched: number }
  | { kind: 'watched' };

interface SeriesProgress {
  episodesWatched: number | null;
  episodesTotal: number | null;
  markedWatched: boolean;
}

/**
 * Total connu → « 3/10 épisodes (30 %) » (le serveur met vus = total pour
 * une série marquée en entier) ; total inconnu → « Vu » si la série est
 * marquée « Déjà vu », sinon « 3 épisodes ».
 */
export function seriesMeta(item: SeriesProgress): SeriesMeta {
  const watched = typeof item.episodesWatched === 'number' && Number.isFinite(item.episodesWatched) && item.episodesWatched > 0
    ? item.episodesWatched
    : 0;
  const percent = episodePercent(watched, item.episodesTotal);
  if (percent !== null) return { kind: 'episodes', watched, total: item.episodesTotal as number, percent };
  return item.markedWatched ? { kind: 'watched' } : { kind: 'count', watched };
}

/**
 * Fin de ligne d'un titre : série TMDB → épisodes (seriesMeta) ; animé
 * (numérotation anime-sama, pas TMDB) → nombre d'épisodes vus seul, sans
 * total ni pourcentage ; film → movieMeta.
 */
export function progressMeta(
  item: MovieProgress & SeriesProgress & { mediaType: 'movie' | 'tv'; animeMode: boolean },
  language = 'fr',
): MovieMeta | SeriesMeta {
  if (item.mediaType === 'movie') return movieMeta(item, language);
  return seriesMeta(item.animeMode ? { ...item, episodesTotal: null } : item);
}

const isInteger = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);

/**
 * Saison et épisode utilisables : épisode ≥ 1, saison ≥ 1, ou saison 0
 * (épisodes spéciaux) quand l'épisode est connu.
 */
function episodeTarget(season: number | null, episode: number | null) {
  const episodeOk = isInteger(episode) && episode >= 1;
  const seasonOk = isInteger(season) && (season >= 1 || (season === 0 && episodeOk));
  return { season: seasonOk ? season : null, episode: episodeOk ? episode : null };
}

/** « S01E01 », « S00E03 » (spécial) ; null sans saison ni épisode valides. */
export function episodeCode(season: number | null, episode: number | null): string | null {
  const target = episodeTarget(season, episode);
  if (target.season === null || target.episode === null) return null;
  return `S${pad(target.season)}E${pad(target.episode)}`;
}

interface WatchTarget {
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  season: number | null;
  episode: number | null;
  /** Série lue en mode animé (anime-sama) : lecteur animé. */
  animeMode?: boolean;
}

/**
 * Lien du lecteur, comme le panneau « Reprendre » du profil : film →
 * /watch/movie/{id} ; série → /watch/tv/{id}/s/{saison}/e/{épisode} ; animé
 * → /watch/anime/{id}/season/{saison}/episode/{épisode} (comme TVDetails).
 * Saison 1 et épisode 1 à la place de ce qui manque (S00E03 gardé).
 */
export function watchPath(item: WatchTarget, encode: (id: number) => string): string {
  const id = encode(item.tmdbId);
  if (item.mediaType === 'movie') return `/watch/movie/${id}`;
  const target = episodeTarget(item.season, item.episode);
  const season = target.season ?? 1;
  const episode = target.episode ?? 1;
  if (item.animeMode) return `/watch/anime/${id}/season/${season}/episode/${episode}`;
  return `/watch/tv/${id}/s/${season}/e/${episode}`;
}

/**
 * « Dernière lecture · 27 mars » seulement pour une série lancée (comme la
 * maquette). Un film, une série jamais lancée ou seulement marquée « Déjà vu »
 * (date de la marque) affichent la date seule.
 */
export function isLastPlayedDate(item: { mediaType: 'movie' | 'tv'; position: number | null }): boolean {
  return item.mediaType === 'tv' && safeSeconds(item.position ?? 0) > 0;
}

/** Clé d'une ligne (« tv-1399 ») : clé React et repère du bouton « ⋯ » pour le focus. */
export const historyRowKey = (item: { mediaType: 'movie' | 'tv'; tmdbId: number }) => `${item.mediaType}-${item.tmdbId}`;

/** Nombre de pages, au moins une. */
export function pageCount(total: number, pageSize: number): number {
  if (!Number.isFinite(total) || !Number.isFinite(pageSize) || pageSize <= 0 || total <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}
