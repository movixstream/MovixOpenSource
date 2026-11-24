/**
 * Tuiles de genre (rangée « Parcourir par genre » des pages Films, Séries et
 * Anime) : une couleur fixe par genre TMDB et deux affiches penchées.
 *
 * Les couleurs sont assez sombres pour qu'un nom blanc reste lisible
 * (contraste ≥ 4,5:1) et deux genres voisins dans les listes ne partagent
 * jamais la même teinte.
 */

const GENRE_TILE_COLORS: Record<number, string> = {
  // Films
  28: '#b3261e', // Action
  12: '#c2410c', // Aventure
  16: '#0e7490', // Animation
  35: '#b45309', // Comédie
  80: '#334155', // Crime
  99: '#4d7c0f', // Documentaire
  18: '#6d28d9', // Drame
  10751: '#be185d', // Famille
  14: '#4338ca', // Fantastique
  36: '#92400e', // Histoire
  27: '#166534', // Horreur
  10402: '#a21caf', // Musique
  9648: '#1e3a8a', // Mystère
  10749: '#be123c', // Romance
  878: '#1d4ed8', // Science-fiction
  10770: '#475569', // Téléfilm
  53: '#7f1d1d', // Thriller
  10752: '#5b6236', // Guerre
  37: '#9a3412', // Western
  // Séries
  10759: '#b3261e', // Action & Aventure
  10762: '#0f766e', // Enfants
  10763: '#374151', // Actualités
  10764: '#a21caf', // Téléréalité
  10765: '#4338ca', // SF & Fantastique
  10766: '#9d174d', // Feuilleton
  10767: '#b45309', // Talk-show
  10768: '#5b6236', // Guerre & Politique
};

const FALLBACK_TILE_COLOR = '#3f3f46';

type Rgb = [number, number, number];

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];

const hexToRgb = (hex: string): Rgb => {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

const mix = (from: Rgb, to: Rgb, amount: number): Rgb =>
  from.map((channel, index) => Math.round(channel + (to[index] - channel) * amount)) as Rgb;

// Virgules plutôt que color-mix() : les WebView des téléviseurs sont anciennes.
const rgba = ([r, g, b]: Rgb, alpha = 1) => `rgba(${r}, ${g}, ${b}, ${alpha})`;

export interface GenreTileTones {
  /** Fond : couleur du genre en haut à gauche, presque noir en bas à droite. */
  background: string;
  /** Halo posé derrière les affiches, comme une lampe dans le coin. */
  halo: string;
}

/**
 * Tons d'une tuile à partir de la couleur du genre. Le haut reste proche de
 * la couleur d'origine pour que le nom blanc garde son contraste.
 */
export const genreTileTones = (genreId: number | string): GenreTileTones => {
  const base = hexToRgb(GENRE_TILE_COLORS[Number(genreId)] ?? FALLBACK_TILE_COLOR);
  const top = mix(base, WHITE, 0.06);
  const middle = mix(base, BLACK, 0.45);
  const end = mix(base, BLACK, 0.86);
  const glow = mix(base, WHITE, 0.4);

  return {
    background: `linear-gradient(135deg, ${rgba(top)} 0%, ${rgba(middle)} 55%, ${rgba(end)} 100%)`,
    halo: `radial-gradient(circle at 86% 92%, ${rgba(glow, 0.55)} 0%, ${rgba(glow, 0)} 58%)`,
  };
};

export const GENRE_TILE_POSTERS = 2;

interface PosterCandidate {
  id: number;
  poster_path?: string | null;
}

/**
 * Choisit les affiches de chaque genre, dans l'ordre de la rangée, sans
 * jamais reprendre un titre déjà montré par un genre précédent : sinon le
 * même film populaire (classé Action et Aventure) apparaît deux fois.
 */
export const pickGenrePosters = (
  candidatesByGenre: PosterCandidate[][],
  perGenre = GENRE_TILE_POSTERS,
): string[][] => {
  const used = new Set<number>();

  return candidatesByGenre.map((candidates) => {
    const posters: string[] = [];
    for (const candidate of candidates) {
      if (posters.length >= perGenre) break;
      if (!candidate.poster_path || used.has(candidate.id)) continue;
      used.add(candidate.id);
      posters.push(`https://image.tmdb.org/t/p/w185${candidate.poster_path}`);
    }
    return posters;
  });
};
