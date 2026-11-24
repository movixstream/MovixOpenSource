export type GenreSearchMediaType = 'movie' | 'tv' | 'anime';

/** Genre « Animation » de TMDB : socle de tout lien anime. */
const ANIMATION_GENRE_ID = 16;

/**
 * Lien vers la page recherche, filtrée sur un genre et un type (film, série
 * ou anime). Lu par `src/pages/Search.tsx`, qui pose les filtres puis lance
 * la recherche. L'anime = série japonaise en japonais, genre Animation en plus
 * (comme le préréglage « Anime » de la recherche).
 */
export function genreSearchHref(mediaType: GenreSearchMediaType | string, genreId: number | string): string {
  const id = Number(genreId);
  if (mediaType === 'anime') {
    const ids = id === ANIMATION_GENRE_ID || !Number.isInteger(id) || id <= 0
      ? [ANIMATION_GENRE_ID]
      : [ANIMATION_GENRE_ID, id];
    return `/search?type=tv&genre=${ids.join(',')}&lang=ja&country=JP`;
  }
  const type = mediaType === 'tv' ? 'tv' : 'movie';
  if (!Number.isInteger(id) || id <= 0) return `/search?type=${type}`;
  return `/search?type=${type}&genre=${id}`;
}
