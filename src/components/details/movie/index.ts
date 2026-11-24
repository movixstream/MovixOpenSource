/**
 * Ce qui est propre à la fiche film (`/movie/:id`) ; le reste vient des
 * briques communes de `@/components/details`.
 *
 *   useMovieDetails(id)        fiche, générique, sorties, similaires, personnages
 *   useMovieWatchState(id, m)  listes locales, reprise, historique serveur
 *   useMovieVideos / useMovieImages / useMovieCollection   chargés à la demande
 *   <MovieSagaBanner/>  <MovieFullDetails/>
 */
export { MovieFullDetails } from './MovieFullDetails';
export { MovieSagaBanner } from './MovieSagaBanner';
export { useMovieDetails, type MovieExtended, type RecommendedMovie } from './useMovieDetails';
export { useMovieCollection, useMovieImages, useMovieVideos, type MovieCollection } from './useMovieMedia';
export { useMovieWatchState, type MovieWatchStatus } from './useMovieWatchState';
export { useReleaseNow } from './useReleaseNow';
