export interface TvExternalIds {
  imdb_id?: string | null;
  tvdb_id?: number | null;
}

export interface TvEpisodeDate {
  season_number: number;
  episode_number: number;
  air_date?: string | null;
}

/** Épisode TVmaze, avec sa propre numérotation (parfois différente de TMDB). */
export interface TvmazeEpisode {
  id: number;
  season: number;
  number: number;
  name: string;
  airdate: string | null;
  runtime: number | null;
  image: string | null;
  summary: string;
}

export interface TvAiringSchedule {
  sourceUrl: string;
  episodeList: TvmazeEpisode[];
  /** Découpage de Netflix (liste alternative TVmaze), quand il existe. */
  netflixEpisodeList?: TvmazeEpisode[];
  /** TVmaze indique Netflix comme diffuseur de la série. */
  onNetflix?: boolean;
  episodes: Record<string, {
    date: string | null;
    /** Instant ISO avec fuseau, uniquement si TVmaze renseigne aussi airtime. */
    timestamp: string | null;
  }>;
}

export interface TvAiringStatus {
  kind: 'upcoming' | 'aired' | 'unconfirmed';
  /** Jour annoncé dans le pays de diffusion, sans conversion de fuseau. */
  date: string | null;
  timestamp: number | null;
  /** Avertissement avant l'heure précise, ou avant le jour local annoncé si l'heure manque. */
  needsWarning: boolean;
}
