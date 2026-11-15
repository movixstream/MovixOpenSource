/**
 * Rangée « Spécial Halloween » de l'accueil : humeurs du frissomètre,
 * requêtes TMDB et petits calculs de date. Sans dépendance, pour être testé
 * tel quel (tests/halloweenSpecial.test.ts).
 */

/** Niveaux du frissomètre, du plus doux au plus effrayant. */
export const HALLOWEEN_MOODS = ['soft', 'chills', 'terror'] as const;
export type HalloweenMood = typeof HALLOWEEN_MOODS[number];
export const DEFAULT_HALLOWEEN_MOOD: HalloweenMood = 'chills';

export const isHalloweenMood = (value: unknown): value is HalloweenMood =>
  (HALLOWEEN_MOODS as readonly unknown[]).includes(value);

// Identifiants TMDB des mots-clés et des genres utilisés.
const KEYWORDS = {
  halloween: 3335,
  trickOrTreating: 180193,
  pumpkin: 12198,
  hauntedHouse: 3358,
  vampire: 3133,
  werewolf: 12564,
  slasher: 12339,
  ghost: 162846,
  witch: 616,
  haunting: 10224,
  gore: 10292,
  splatter: 344603,
  torture: 13006,
  extremeViolence: 262404,
};
const GENRES = { horror: 27, family: 10751, animation: 16, comedy: 35 };

const anyOf = (...ids: number[]) => ids.join('|');

/**
 * Filtres TMDB (discover/movie) de chaque humeur, réglés sur les résultats :
 * - frisson doux : Halloween en famille (Jack, Coraline, Hocus Pocus,
 *   Casper…), classés au plus PG aux États-Unis. « Fantôme » et « sorcière »
 *   sont écartés : ils ramenaient les contes de Noël et les princesses ;
 * - chair de poule : soirs d'Halloween, maisons hantées et slashers, sans
 *   les films étiquetés gore ou torture ;
 * - terreur : les films d'horreur les mieux notés, sans comédie.
 */
const MOOD_FILTERS: Record<HalloweenMood, Record<string, string | number>> = {
  soft: {
    with_keywords: anyOf(KEYWORDS.halloween, KEYWORDS.trickOrTreating, KEYWORDS.pumpkin, KEYWORDS.hauntedHouse, KEYWORDS.vampire, KEYWORDS.werewolf),
    with_genres: anyOf(GENRES.family, GENRES.animation),
    certification_country: 'US',
    'certification.lte': 'PG',
    'vote_count.gte': 150,
  },
  chills: {
    with_genres: GENRES.horror,
    with_keywords: anyOf(KEYWORDS.halloween, KEYWORDS.trickOrTreating, KEYWORDS.slasher, KEYWORDS.hauntedHouse, KEYWORDS.ghost, KEYWORDS.witch, KEYWORDS.haunting),
    without_genres: anyOf(GENRES.family, GENRES.animation),
    without_keywords: anyOf(KEYWORDS.gore, KEYWORDS.splatter, KEYWORDS.torture, KEYWORDS.extremeViolence),
    'vote_count.gte': 500,
  },
  terror: {
    with_genres: GENRES.horror,
    without_genres: anyOf(GENRES.family, GENRES.animation, GENRES.comedy),
    'vote_count.gte': 1500,
    'vote_average.gte': 7,
  },
};

const pad = (n: number) => String(n).padStart(2, '0');

/** Date locale au format AAAA-MM-JJ. */
export const isoDay = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/**
 * Date de sortie la plus récente acceptée : trois mois avant aujourd'hui,
 * pour ne proposer que des films qu'on a des chances de trouver. Le jour est
 * ramené au dernier du mois si besoin (31 mai → 28 ou 29 février), jamais
 * reporté au mois suivant.
 */
export const releaseCutoff = (now = new Date()): string => {
  const target = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(now.getDate(), lastDay));
  return isoDay(target);
};

/** Paramètres TMDB d'une page de l'humeur (clé d'API à ajouter). */
export const halloweenQuery = (mood: HalloweenMood, language: string, page: number, now = new Date()) => ({
  language,
  page,
  include_adult: 'false',
  sort_by: 'popularity.desc',
  'primary_release_date.lte': releaseCutoff(now),
  ...MOOD_FILTERS[mood],
});

/** Jours avant le 31 octobre de l'année en cours (négatif une fois passé). */
export const daysUntilHalloween = (now = new Date()): number => {
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((Date.UTC(now.getFullYear(), 9, 31) - today) / 86_400_000);
};

/**
 * Mélange stable sur une graine : avec la date du jour, l'ordre change
 * chaque nuit et pas à chaque visite (mulberry32 sur un hachage de la graine).
 */
export const seededShuffle = <T>(items: readonly T[], seed: string): T[] => {
  let hash = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    hash = Math.imul(hash ^ seed.charCodeAt(i), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }
  let state = hash >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

export interface HalloweenMovie {
  id: number;
  title: string;
  poster_path: string;
  backdrop_path: string;
  overview: string;
  vote_average: number;
  release_date: string;
  media_type: 'movie';
  genre_ids?: number[];
}

export interface TmdbMovieResult {
  id: number;
  title?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  overview?: string;
  vote_average?: number;
  release_date?: string;
  genre_ids?: number[];
}

/**
 * Films affichables (affiche et résumé), sans doublon, au format des cartes.
 * La date est revérifiée : TMDB filtre déjà, mais un film sans date de
 * sortie connue ne doit pas passer.
 */
export const toHalloweenMovies = (results: readonly TmdbMovieResult[], cutoff: string): HalloweenMovie[] => {
  const seen = new Set<number>();
  const movies: HalloweenMovie[] = [];
  for (const movie of results) {
    if (!movie.poster_path || !movie.overview?.trim() || seen.has(movie.id)) continue;
    if (!movie.release_date || movie.release_date > cutoff) continue;
    seen.add(movie.id);
    movies.push({
      id: movie.id,
      title: movie.title ?? '',
      poster_path: movie.poster_path,
      backdrop_path: movie.backdrop_path ?? '',
      overview: movie.overview,
      vote_average: movie.vote_average ?? 0,
      release_date: movie.release_date,
      media_type: 'movie',
      genre_ids: movie.genre_ids,
    });
  }
  return movies;
};
