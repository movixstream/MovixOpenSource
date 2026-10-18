import type { TvmazeEpisode } from '@/types/tvAiring';

/**
 * Liste d'épisodes affichée pour une série : TVmaze ou TMDB.
 *
 * Certaines séries ont un découpage différent selon la base (ex. Coven Academy :
 * 10 épisodes sur TMDB, 21 chapitres sur TVmaze et chez la plupart des sources).
 * Les sources reçoivent le numéro tel quel. Trois choix :
 * - `tvmaze` (avec filtre) : TVmaze seulement s'il est compatible avec TMDB
 *   (voir `isTvmazeListCompatible`) ;
 * - `tvmaze_all` (sans filtre) : toujours TVmaze quand il connaît la série ;
 * - `tmdb` : toujours TMDB.
 *
 * Une série Netflix suit d'office le découpage Netflix quand TVmaze le publie
 * (ex. La Casa de Papel), sauf avec le choix global `tmdb`. `netflix` n'existe
 * que comme choix propre à une série.
 */
export type EpisodeListSource = 'tvmaze' | 'tvmaze_all' | 'tmdb' | 'netflix';

/** Liste réellement affichée. */
export type EpisodeListKind = 'tmdb' | 'tvmaze' | 'netflix';

export interface ShowEpisodeLists {
  tmdbCounts: Record<number, number>;
  tvmaze?: TvmazeEpisode[] | null;
  netflix?: TvmazeEpisode[] | null;
  onNetflix?: boolean;
}

export const EPISODE_LIST_SOURCE_KEY = 'settings_episode_list_source';
export const EPISODE_LIST_SOURCE_EVENT = 'movix:episode-list-source';
const showKey = (showId: string | number) => `settings_episode_list_source_tv_${showId}`;

const parseSource = (value: string | null): EpisodeListSource | null =>
  value === 'tvmaze' || value === 'tvmaze_all' || value === 'tmdb' || value === 'netflix' ? value : null;

const read = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

/** Choix global des paramètres. TVmaze par défaut. */
export const getDefaultEpisodeListSource = (): EpisodeListSource => {
  const source = parseSource(read(EPISODE_LIST_SOURCE_KEY));
  return source && source !== 'netflix' ? source : 'tvmaze';
};

/** Choix propre à une série, sinon le choix global. */
export const getEpisodeListSource = (showId: string | number | null | undefined): EpisodeListSource =>
  (showId != null ? parseSource(read(showKey(showId))) : null) ?? getDefaultEpisodeListSource();

const write = (key: string, value: string | null) => {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Stockage refusé : le choix reste valable jusqu'au rechargement.
  }
  window.dispatchEvent(new CustomEvent(EPISODE_LIST_SOURCE_EVENT));
};

export const setDefaultEpisodeListSource = (source: EpisodeListSource) => write(EPISODE_LIST_SOURCE_KEY, source);

/** `null` efface l'exception propre à la série (retour au choix global). */
export const setEpisodeListSource = (showId: string | number, source: EpisodeListSource | null) =>
  write(showKey(showId), source);

const countBySeason = (episodes: TvmazeEpisode[]): Record<number, number> => {
  const counts: Record<number, number> = {};
  for (const episode of episodes) {
    if (episode.season >= 1) counts[episode.season] = (counts[episode.season] ?? 0) + 1;
  }
  return counts;
};

const nonEmptySeasons = (counts: Record<number, number>): number[] =>
  Object.keys(counts).map(Number).filter((season) => season >= 1 && counts[season] > 0).sort((a, b) => a - b);

/** Vrai si TVmaze a une liste et qu'elle ne compte pas pareil que TMDB. */
export const isTvmazeListDifferent = (
  tmdbEpisodeCounts: Record<number, number>,
  tvmazeEpisodes: TvmazeEpisode[] | null | undefined,
): boolean => {
  if (!tvmazeEpisodes?.length) return false;
  const tvmazeCounts = countBySeason(tvmazeEpisodes);
  const seasons = new Set([...nonEmptySeasons(tmdbEpisodeCounts), ...nonEmptySeasons(tvmazeCounts)]);
  return [...seasons].some((season) => (tmdbEpisodeCounts[season] ?? 0) !== (tvmazeCounts[season] ?? 0));
};

/**
 * TVmaze n'est sûr que si les deux bases ont les mêmes saisons et que TVmaze
 * découpe au moins une saison en plus d'épisodes. Les animes en numérotation
 * absolue (une seule saison TVmaze face à plusieurs saisons TMDB) gardent TMDB.
 */
export const isTvmazeListCompatible = (
  tmdbEpisodeCounts: Record<number, number>,
  tvmazeEpisodes: TvmazeEpisode[] | null | undefined,
): boolean => {
  if (!tvmazeEpisodes?.length) return false;
  const tvmazeCounts = countBySeason(tvmazeEpisodes);
  const tmdbSeasons = nonEmptySeasons(tmdbEpisodeCounts);
  if (!tmdbSeasons.length || tmdbSeasons.join() !== nonEmptySeasons(tvmazeCounts).join()) return false;
  let hasMore = false;
  for (const season of tmdbSeasons) {
    if (tvmazeCounts[season] < tmdbEpisodeCounts[season]) return false;
    if (tvmazeCounts[season] > tmdbEpisodeCounts[season]) hasMore = true;
  }
  return hasMore;
};

/** La liste TVmaze s'applique-t-elle avec ce choix ? */
export const shouldUseTvmazeList = (
  source: EpisodeListSource,
  tmdbEpisodeCounts: Record<number, number>,
  tvmazeEpisodes: TvmazeEpisode[] | null | undefined,
): boolean => {
  if (source === 'tvmaze') return isTvmazeListCompatible(tmdbEpisodeCounts, tvmazeEpisodes);
  if (source === 'tvmaze_all') return !!tvmazeEpisodes?.length;
  return false;
};

/** Liste affichée pour un choix donné. `netflix` sans liste Netflix suit le choix global. */
export const resolveEpisodeList = (source: EpisodeListSource, lists: ShowEpisodeLists): EpisodeListKind => {
  if (source === 'netflix') {
    return lists.netflix?.length ? 'netflix' : resolveEpisodeList(getDefaultEpisodeListSource(), lists);
  }
  return shouldUseTvmazeList(source, lists.tmdbCounts, lists.tvmaze) ? 'tvmaze' : 'tmdb';
};

/** Liste donnée par le choix global : Netflix d'office pour une série Netflix. */
export const getDefaultEpisodeList = (lists: ShowEpisodeLists): EpisodeListKind => {
  const source = getDefaultEpisodeListSource();
  if (source !== 'tmdb' && lists.onNetflix && lists.netflix?.length) return 'netflix';
  return resolveEpisodeList(source, lists);
};

/** Liste affichée pour une série : son exception, sinon le choix global. */
export const getShowEpisodeList = (
  showId: string | number | null | undefined,
  lists: ShowEpisodeLists,
): EpisodeListKind => {
  const own = showId != null ? parseSource(read(showKey(showId))) : null;
  return own ? resolveEpisodeList(own, lists) : getDefaultEpisodeList(lists);
};

/** Choix à enregistrer pour afficher `kind` ; `null` si le choix global y mène déjà. */
export const episodeListChoice = (kind: EpisodeListKind, lists: ShowEpisodeLists): EpisodeListSource | null => {
  if (getDefaultEpisodeList(lists) === kind) return null;
  return kind === 'tvmaze' ? 'tvmaze_all' : kind;
};

/** Épisode TVmaze au format TMDB attendu par les listes et le lecteur. */
export interface TvmazeTmdbEpisode {
  /** Identifiant TVmaze (pas un identifiant d'épisode TMDB). */
  id: number;
  season_number: number;
  episode_number: number;
  name: string;
  overview: string;
  air_date?: string;
  runtime: number | null;
  /** Toujours vide : les écrans préfixent ce champ par l'URL des images TMDB. */
  still_path: null;
  /** Image TVmaze complète, à utiliser à la place de `still_path`. */
  still_url: string | null;
  vote_average: number;
  source: 'tvmaze';
}

export const toTmdbEpisode = (episode: TvmazeEpisode): TvmazeTmdbEpisode => ({
  id: episode.id,
  season_number: episode.season,
  episode_number: episode.number,
  name: episode.name,
  overview: episode.summary,
  air_date: episode.airdate ?? undefined,
  runtime: episode.runtime,
  still_path: null,
  still_url: episode.image,
  vote_average: 0,
  source: 'tvmaze',
});

export const groupTvmazeSeasons = (episodes: TvmazeEpisode[]): Record<number, TvmazeTmdbEpisode[]> => {
  const seasons: Record<number, TvmazeTmdbEpisode[]> = {};
  for (const episode of episodes) {
    if (episode.season < 1) continue;
    (seasons[episode.season] ??= []).push(toTmdbEpisode(episode));
  }
  for (const list of Object.values(seasons)) list.sort((a, b) => a.episode_number - b.episode_number);
  return seasons;
};
