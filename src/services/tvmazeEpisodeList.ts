import axios from 'axios';
import { TMDB_API_KEY } from '@/config/config';
import { getTvAiringSchedule } from '@/services/tvAiringService';
import {
  getEpisodeListSource,
  getShowEpisodeList,
  groupTvmazeSeasons,
  type ShowEpisodeLists,
  type TvmazeTmdbEpisode,
} from '@/utils/tvmazeEpisodes';

type TvmazeSeasons = Record<number, TvmazeTmdbEpisode[]>;

const MAX_CACHE_ENTRIES = 50;
// Seulement les listes : le choix TVmaze/Netflix/TMDB est relu à chaque appel.
const lists = new Map<string, Promise<ShowEpisodeLists | null>>();

const loadShowLists = async (showId: string): Promise<ShowEpisodeLists | null> => {
  const { data } = await axios.get(`https://api.themoviedb.org/3/tv/${showId}`, {
    params: { api_key: TMDB_API_KEY, append_to_response: 'external_ids' },
  });
  const tmdbCounts: Record<number, number> = {};
  for (const season of Array.isArray(data?.seasons) ? data.seasons : []) {
    if (Number.isSafeInteger(season?.season_number)) tmdbCounts[season.season_number] = Number(season.episode_count) || 0;
  }
  const schedule = await getTvAiringSchedule(data?.external_ids);
  return schedule ? {
    tmdbCounts,
    tvmaze: schedule.episodeList,
    netflix: schedule.netflixEpisodeList,
    onNetflix: schedule.onNetflix,
  } : null;
};

/**
 * Liste TVmaze ou Netflix à afficher à la place de TMDB, ou `null` pour garder
 * TMDB (choix de l'utilisateur, filtre non passé ou TVmaze indisponible).
 */
export const getEpisodeListOverride = async (
  showId: string | number | null | undefined,
): Promise<{ kind: 'tvmaze' | 'netflix'; seasons: TvmazeSeasons } | null> => {
  if (showId == null) return null;
  if (getEpisodeListSource(showId) === 'tmdb') return null;
  const key = String(showId);
  let request = lists.get(key);
  if (!request) {
    request = loadShowLists(key).catch(() => {
      lists.delete(key);
      return null;
    });
    lists.set(key, request);
    if (lists.size > MAX_CACHE_ENTRIES) lists.delete(lists.keys().next().value!);
  }
  const data = await request;
  if (!data) return null;
  const kind = getShowEpisodeList(showId, data);
  if (kind === 'tmdb') return null;
  return { kind, seasons: groupTvmazeSeasons((kind === 'netflix' ? data.netflix : data.tvmaze) ?? []) };
};

export const getTvmazeSeasonsOverride = async (showId: string | number | null | undefined): Promise<TvmazeSeasons | null> =>
  (await getEpisodeListOverride(showId))?.seasons ?? null;
