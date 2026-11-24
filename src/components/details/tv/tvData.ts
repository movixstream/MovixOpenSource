import axios from 'axios';
import { getTmdbLanguage } from '@/i18n';
import type { TvExternalIds } from '@/types/tvAiring';
import type { AnimeSamaCandidate } from '@/utils/animeMatcher';
import type { TmdbKeywordsResponse } from '@/utils/animeSignals';
import type { DetailsCertifications } from '../certification';
import type { DetailsVideo } from '../videos';

const TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY || '';

/** Épisode d'une saison : celui de TMDB, ou celui de TVmaze mis au même format. */
export interface TvEpisode {
  episode_number: number;
  season_number?: number;
  name: string;
  overview?: string;
  air_date?: string | null;
  runtime?: number | null;
  still_path?: string | null;
  /** Image TVmaze complète (listes TVmaze et Netflix), à la place de `still_path`. */
  still_url?: string | null;
  vote_average?: number;
}

/** Saison : son résumé dans la fiche TMDB, ou son détail avec les épisodes. */
export interface TvSeason {
  season_number: number;
  name?: string;
  poster_path?: string | null;
  air_date?: string | null;
  episode_count?: number;
  episodes?: TvEpisode[];
}

export interface TVShow {
  id?: string | number;
  name: string;
  original_name?: string;
  original_language?: string;
  tagline?: string;
  overview: string;
  poster_path: string;
  backdrop_path: string;
  first_air_date: string;
  external_ids?: TvExternalIds;
  vote_average: number;
  vote_count?: number;
  genres: { id: number; name: string }[];
  created_by?: { id: number; name: string }[];
  number_of_seasons?: number;
  number_of_episodes?: number;
  seasons?: TvSeason[];
  status?: string;
  type?: string;
  episode_run_time?: number[];
  networks?: { id: number; name: string; logo_path: string | null }[];
  production_companies?: { id: number; name: string; logo_path: string | null }[];
  origin_country?: string[];
  spoken_languages?: { iso_639_1: string; name: string }[];
  popularity?: number;
  in_production?: boolean;
  last_air_date?: string;
  last_episode_to_air?: {
    air_date: string;
    episode_number: number;
    season_number: number;
    name: string;
  };
  next_episode_to_air?: {
    air_date: string;
    episode_number: number;
    season_number: number;
    name: string;
  } | null;
}

/** Épisode Anime-Sama : son rang, son nom (« Episode 62 ») et ses lecteurs par langue. */
export interface AnimeEpisode {
  index: number;
  name?: string;
  streaming_links: { language: string }[];
}

export interface AnimeSeason {
  number?: number;
  name: string;
  episodes: AnimeEpisode[];
}

/** Œuvre Anime-Sama retenue pour la série, avec ses saisons. */
export interface AnimeData extends AnimeSamaCandidate {
  seasons: AnimeSeason[];
}

/** Numéro d'une saison Anime-Sama : le sien, sinon son rang dans la liste. */
export const animeSeasonNumber = (season: AnimeSeason, index: number): number => season.number || index + 1;

// Sur certains réseaux (proxy FAI / cache CloudFront), la réponse fr-FR d'une
// saison arrive corrompue : le corps n'est ni du JSON ni du gzip valide, donc
// `episodes` est absent (symptôme : "Pas d'épisodes" sur PC, OK sur mobile).
// On bascule alors sur l'objet en-US — clé de cache CDN différente, donc
// généralement saine. Numéros d'épisode et dates sont indépendants de la langue.
export const fetchSeasonDetails = async (
  showId: string | number | null | undefined,
  season: number,
): Promise<TvSeason | null> => {
  const base = `https://api.themoviedb.org/3/tv/${showId}/season/${season}?api_key=${TMDB_API_KEY}`;
  const langs = [...new Set([getTmdbLanguage(), 'en-US'])];
  for (const lang of langs) {
    try {
      const { data } = await axios.get(`${base}&language=${lang}`);
      if (data && Array.isArray(data.episodes)) return data;
    } catch {
      // erreur réseau / décodage : on tente la langue suivante
    }
  }
  return null;
};

/** Classification française, à défaut américaine (`/content_ratings`). */
async function fetchTvCertifications(id: string): Promise<DetailsCertifications> {
  try {
    const response = await axios.get(`https://api.themoviedb.org/3/tv/${id}/content_ratings?api_key=${TMDB_API_KEY}`);
    const ratings: Array<{ iso_3166_1: string; rating?: string }> = response.data.results;
    const certifications: DetailsCertifications = {};
    const fr = ratings.find((entry) => entry.iso_3166_1 === 'FR');
    if (fr?.rating) certifications['FR'] = fr.rating;
    if (!certifications['FR']) {
      const us = ratings.find((entry) => entry.iso_3166_1 === 'US');
      if (us?.rating) certifications['US'] = us.rating;
    }
    return certifications;
  } catch (error) {
    console.error('Error fetching content ratings:', error);
    return {};
  }
}

/** Vidéos générales, dans la langue du site, à défaut en anglais. */
async function fetchTvVideos(id: string): Promise<DetailsVideo[]> {
  try {
    const url = `https://api.themoviedb.org/3/tv/${id}/videos`;
    const response = await axios.get(url, { params: { api_key: TMDB_API_KEY, language: getTmdbLanguage() } });
    const results: DetailsVideo[] = response.data.results || [];
    if (results.length > 0) return results;
    const en = await axios.get(url, { params: { api_key: TMDB_API_KEY, language: 'en-US' } });
    return en.data.results || [];
  } catch (error) {
    console.error('Error fetching general videos:', error);
    return [];
  }
}

/**
 * Vidéos d'une saison dans la langue du site ; à défaut, toutes langues
 * confondues (`multiLang` vrai : la vue multi-langues s'ouvre d'office).
 */
async function fetchTvSeasonVideos(id: string, season: number): Promise<{ videos: DetailsVideo[]; multiLang: boolean }> {
  try {
    const url = `https://api.themoviedb.org/3/tv/${id}/season/${season}/videos`;
    const response = await axios.get(url, { params: { api_key: TMDB_API_KEY, language: getTmdbLanguage() } });
    const localized: DetailsVideo[] = response.data.results || [];
    if (localized.length > 0) return { videos: localized, multiLang: false };
    const all = await axios.get(url, { params: { api_key: TMDB_API_KEY } });
    const results: DetailsVideo[] = all.data.results || [];
    return { videos: results, multiLang: results.length > 0 };
  } catch (error) {
    console.error(`Error fetching videos for season ${season}:`, error);
    return { videos: [], multiLang: false };
  }
}

export interface TvShowData {
  /** Fiche TMDB avec `credits`, `keywords`, `alternative_titles` et `external_ids`. */
  show: TVShow & {
    credits?: { cast?: Array<{ id: number; name: string; character?: string; profile_path?: string | null }> };
    keywords?: TmdbKeywordsResponse | null;
    alternative_titles?: { results?: Array<{ iso_3166_1?: string; title?: string }> };
  };
  certifications: DetailsCertifications;
  videos: DetailsVideo[];
  /** Détail TMDB de chaque saison, épisodes compris (saison 0 incluse). */
  seasonsDetails: Record<number, TvSeason>;
  seasonVideos: Record<number, DetailsVideo[]>;
  /** Saisons sans vidéo dans la langue du site : leurs vidéos toutes langues. */
  seasonMultiLangVideos: Record<number, DetailsVideo[]>;
}

/** Tout ce que la fiche série attend avant de s'afficher. */
export async function fetchTvShowData(id: string): Promise<TvShowData> {
  const response = await axios.get(`https://api.themoviedb.org/3/tv/${id}`, {
    params: {
      api_key: TMDB_API_KEY,
      language: getTmdbLanguage(),
      append_to_response: 'credits,keywords,alternative_titles,external_ids',
    },
  });
  const show: TvShowData['show'] = response.data;
  const certifications = await fetchTvCertifications(id);
  const videos = await fetchTvVideos(id);

  const seasonsDetails: Record<number, TvSeason> = {};
  const seasonVideos: Record<number, DetailsVideo[]> = {};
  const seasonMultiLangVideos: Record<number, DetailsVideo[]> = {};
  // Saisons 0 (épisodes spéciaux) à N.
  const seasonCount = show.number_of_seasons;
  await Promise.all(Array.from({ length: seasonCount == null ? 0 : seasonCount + 1 }, async (_, season) => {
    // Bascule sur en-US si la réponse dans la langue du site est corrompue.
    const details = await fetchSeasonDetails(id, season);
    if (details) seasonsDetails[season] = details;
    const { videos: found, multiLang } = await fetchTvSeasonVideos(id, season);
    seasonVideos[season] = found;
    if (multiLang) seasonMultiLangVideos[season] = found;
  }));

  return { show, certifications, videos, seasonsDetails, seasonVideos, seasonMultiLangVideos };
}
