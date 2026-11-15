import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from 'axios';
import { t } from 'i18next';

// Rescapé : La Série — S1E5 manque dans TMDB. Le complément s'applique après
// le cache, à la fiche, à la liste et au 404 de l'épisode utilisé par WatchTv.
const SHOW_ID = 335292;
const SEASON_NUMBER = 1;
const EPISODE_NUMBER = 5;
const TARGET_RE =
  /^https:\/\/api\.themoviedb\.org\/3\/tv\/335292(?:\/season\/(1)(?:\/episode\/(5))?)?(?:\?.*)?$/;

const createManualEpisode = () => ({
  // Identifiant local négatif : ne pas le confondre avec un identifiant TMDB.
  id: -3352920105,
  show_id: SHOW_ID,
  season_number: SEASON_NUMBER,
  episode_number: EPISODE_NUMBER,
  name: t('details.episodeNumber', { number: EPISODE_NUMBER }),
  overview: '',
  air_date: null,
  still_path: null,
  runtime: null,
  production_code: '',
  vote_average: 0,
  vote_count: 0,
  crew: [],
  guest_stars: [],
});

interface SeasonSummary {
  season_number: number;
  episode_count?: number;
}

export const installManualEpisodes = (instance: AxiosInstance): void => {
  const getTarget = (config?: AxiosRequestConfig): 'show' | 'season' | 'episode' | null => {
    if (!config || (config.method ?? 'get').toLowerCase() !== 'get') return null;
    const match = TARGET_RE.exec(instance.getUri(config));
    if (!match) return null;
    return match[2] ? 'episode' : match[1] ? 'season' : 'show';
  };

  instance.interceptors.response.use(
    (response: AxiosResponse) => {
      const target = getTarget(response.config);
      const data = response.data;

      if (target === 'show' && Array.isArray(data?.seasons)) {
        const seasons = data.seasons.map((season: SeasonSummary) =>
          season.season_number === SEASON_NUMBER
            ? { ...season, episode_count: Math.max(season.episode_count ?? 0, EPISODE_NUMBER) }
            : season,
        );
        const episodeCount = seasons.reduce((total: number, season: SeasonSummary) =>
          total + (season.season_number > 0 ? season.episode_count ?? 0 : 0), 0);
        return {
          ...response,
          data: { ...data, seasons, number_of_episodes: Math.max(data.number_of_episodes ?? 0, episodeCount) },
        };
      }

      if (target === 'season' && Array.isArray(data?.episodes)) {
        if (data.episodes.some((episode: { episode_number: number }) => episode.episode_number === EPISODE_NUMBER)) {
          return response;
        }
        const episodes = [...data.episodes, createManualEpisode()].sort(
          (a, b) => a.episode_number - b.episode_number,
        );
        return { ...response, data: { ...data, episodes } };
      }

      // Dès que TMDB référence l'épisode, conserver ses métadonnées officielles.
      return response;
    },
    (error: unknown) => {
      if (axios.isAxiosError(error) && error.response?.status === 404 && getTarget(error.config) === 'episode') {
        return {
          ...error.response,
          status: 200,
          statusText: 'OK',
          data: createManualEpisode(),
        };
      }
      return Promise.reject(error);
    },
  );
};
