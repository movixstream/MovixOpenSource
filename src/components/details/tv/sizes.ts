/** Espace entre deux cartes de la grille d'épisodes, en pixels (`gap-x-5`). */
const GRID_GAP = 20;

/**
 * Largeur d'une carte de la grille d'épisodes pour un conteneur donné : même
 * calcul que les colonnes CSS de `TvEpisodeList` (cartes d'au moins 270 px,
 * 320 px dès 1700 px d'écran), pour demander une vignette à la bonne taille.
 */
export function tvEpisodeCardWidth(containerWidth: number, viewportWidth: number): number {
  const minimum = viewportWidth >= 1700 ? 320 : 270;
  const columns = Math.max(1, Math.floor((containerWidth + GRID_GAP) / (minimum + GRID_GAP)));
  return Math.max(1, (containerWidth - GRID_GAP * (columns - 1)) / columns);
}

/** Largeur de la vignette d'une ligne de la liste d'épisodes (`TvEpisodeRow`). */
export const tvEpisodeRowThumbWidth = (viewportWidth: number): number => (viewportWidth < 768 ? 132 : 220);
