/**
 * Ce qui est propre à la fiche série (`/tv/:id`) ; le reste vient des briques
 * communes de `@/components/details`.
 *
 *   <TvSeasonPills seasons selected onSelect />          saisons en pastilles
 *   <TvEpisodesToolbar seasonLayout episodeList animeMode view />
 *   <TvEpisodeList view="grid" | "list" episodes … />    cartes ou lignes
 *   <TvFullDetails show … />                             section Détails dépliée
 *
 * La page prépare chaque épisode (`TvEpisodeItem`) : anti-spoil, dates de
 * diffusion et historique y sont déjà appliqués, les composants n'affichent
 * que ce qu'on leur donne.
 */
export type { TvEpisodeItem, TvEpisodeView, TvSeasonOption } from './types';
export { TvSegmented, type TvSegmentedOption, type TvSegmentedProps } from './TvSegmented';
export { TvSeasonPills, type TvSeasonPillsProps } from './TvSeasonPills';
export {
  TvEpisodeViewSwitch, TvEpisodesToolbar,
  type TvEpisodeViewSwitchProps, type TvEpisodesToolbarProps,
} from './TvEpisodesToolbar';
export { TV_EPISODE_ACTION_CLASS, TvEpisodeCard, TvEpisodeRow, type TvEpisodeEntryProps } from './TvEpisodeCard';
export { TvEpisodeList, type TvEpisodeListProps } from './TvEpisodeList';
export { tvEpisodeCardWidth, tvEpisodeRowThumbWidth } from './sizes';
export {
  TvFullDetails,
  type TvFullDetailsEpisode, type TvFullDetailsProps, type TvFullDetailsSource,
} from './TvFullDetails';

// Données et état de la fiche, sortis de la page :
//   useTvShowDetails(id)     fiche, saisons, vidéos, distribution, similaires, personnages
//   useTvEpisodeLists(…)     liste TMDB, TVmaze ou Netflix, épisodes diffusés
//   useTvWatchStatus / useTvResume   listes locales, reprise, historique serveur
//   useTvAnime(…)            mode anime (Anime-Sama)
//   useTvImagesAndTrailer / useTvMultiLangVideos
export {
  animeSeasonNumber, fetchSeasonDetails, fetchTvShowData,
  type AnimeData, type AnimeEpisode, type AnimeSeason, type TVShow, type TvEpisode, type TvSeason, type TvShowData,
} from './tvData';
export {
  animeLanguageLabel, toAnimeEpisodeItem, toTvEpisodeItem, tvEpisodeWatchState, tvRuntimeText,
  type TvEpisodeWatchState,
} from './episodeItems';
export { useTvShowDetails } from './useTvShowDetails';
export { useTvEpisodeLists, type TvAvailableEpisode } from './useTvEpisodeLists';
export { useTvWatchStatus, type TvWatchStatus } from './useTvWatchStatus';
export { useTvResume } from './useTvResume';
export { useTvAnime } from './useTvAnime';
export { useTvImagesAndTrailer, useTvMultiLangVideos } from './useTvMedia';
