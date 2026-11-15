/**
 * Versions alternatives d'un film (version longue, ressortie enrichie…).
 *
 * TMDB refuse les versions alternatives comme films séparés et supprime leurs
 * fiches. Une version vit donc ici, rattachée au film TMDB d'origine :
 * - `tmdbId` du film parent sert aux infos (titre, affiche, âge, historique) ;
 * - `linksId` est la clé de la ligne `films` de la base Movix qui garde les
 *   liens de cette version. C'est souvent l'ancien ID TMDB supprimé, conservé
 *   tel quel pour ne pas déplacer les liens déjà en base.
 *
 * Les sources scrapées (Coflix, FStream…) cherchent par ID TMDB : elles
 * rendraient la version cinéma. Une version ne lit donc que ses propres liens.
 */
export interface MovieVersion {
  /** Segment d'URL : /watch/movie/:id/version/:key */
  key: string;
  /** Film TMDB parent. */
  tmdbId: string;
  /** Clé `films.id` des liens de cette version dans la base Movix. */
  linksId: string;
  /** Clé i18n du nom de la version. */
  labelKey: string;
  /** Durée en minutes, quand elle diffère de la version cinéma. */
  runtime?: number;
}

const MOVIE_VERSIONS: MovieVersion[] = [
  {
    // Avengers Endgame: Encore (ressortie 2026). Fiche TMDB 1825463 supprimée
    // mi-novembre 2026 par la modération : « pas assez différente » de 299534.
    key: 'encore',
    tmdbId: '299534',
    linksId: '1825463',
    labelKey: 'movieVersions.encore',
    runtime: 184,
  },
];

/** Versions alternatives d'un film TMDB, dans l'ordre d'affichage. */
export function getMovieVersions(tmdbId: string | null | undefined): MovieVersion[] {
  if (!tmdbId) return [];
  return MOVIE_VERSIONS.filter((version) => version.tmdbId === tmdbId);
}

/** Une version précise d'un film, ou `null` si elle n'existe pas. */
export function getMovieVersion(
  tmdbId: string | null | undefined,
  key: string | null | undefined,
): MovieVersion | null {
  if (!tmdbId || !key) return null;
  return MOVIE_VERSIONS.find((version) => version.tmdbId === tmdbId && version.key === key) ?? null;
}

/**
 * Ancien ID TMDB supprimé → version qui le remplace. Sert à rediriger les
 * liens partagés, l'historique et les favoris qui pointent encore dessus.
 */
export function getVersionForRetiredId(tmdbId: string | null | undefined): MovieVersion | null {
  if (!tmdbId) return null;
  return MOVIE_VERSIONS.find((version) => version.linksId === tmdbId && version.linksId !== version.tmdbId) ?? null;
}

/** URL de lecture d'un film, avec ou sans version. */
export function buildWatchMoviePath(encodedId: string, versionKey?: string | null): string {
  return versionKey
    ? `/watch/movie/${encodedId}/version/${encodeURIComponent(versionKey)}`
    : `/watch/movie/${encodedId}`;
}
