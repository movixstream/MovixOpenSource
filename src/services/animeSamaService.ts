import axios from 'axios';
import { MAIN_API } from '../config/runtime';

// Source anime du Main API (`/anime`, routes/animeSama.js).
//
// Le serveur tient un index du catalogue d'anime-sama : chaque fiche y porte
// l'ID TMDB que le site publie. Une œuvre se retrouve donc par son ID TMDB,
// sans comparer de noms ; la recherche par nom reste le repli des œuvres sans
// ID (ou pas encore indexées).
//
// La liste d'une œuvre donne, par épisode et par langue, les adresses de
// lecteurs déjà connues (`players`) et le nombre de lecteurs dont l'adresse
// reste à demander (`pending`). Ces adresses se demandent au moment de lire
// l'épisode (`fetchAnimeEpisodeLinks`) : anime-sama limite ces demandes, le
// serveur ne les fait donc jamais d'avance.

export interface AnimeStreamingLink {
  language: string;
  players: string[];
  /** Lecteurs dont l'adresse reste à demander au serveur. Absent = aucun. */
  pending?: number;
}

export interface AnimeEpisodeLinks {
  slug: string;
  /** Chemin de la saison (`path` de la saison dans la liste de l'œuvre). */
  season: string;
  /** Rang de l'épisode sur le site (`index` de l'épisode). */
  index: number;
  streaming_links: AnimeStreamingLink[];
  /** Le serveur n'a pas pu demander toutes les adresses (quota, panne). */
  limited?: boolean;
  /** m3u8 extraits par le serveur (méthode serveur, compte VIP). */
  m3u8ByPlayer?: Record<string, string>;
}

export interface AnimeCatalogueItem {
  slug: string;
  name: string;
  altNames: string[];
  /** Affiche hébergée par anime-sama (URL complète), ou chaîne vide. */
  image: string;
  /** Chemin d'affiche TMDB (`/abc.jpg`), quand la fiche en porte un. */
  posterPath: string | null;
  tmdb: { type: 'tv' | 'movie'; id: number } | null;
  year: number | null;
  genres: string[];
  languages: string[];
  format: string;
  status: string;
  seasonCount: number;
}

export interface AnimeCataloguePage {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  items: AnimeCatalogueItem[];
}

export interface AnimeCatalogueQuery {
  page?: number;
  limit?: number;
  q?: string;
  genre?: string;
  lang?: string;
  type?: 'tv' | 'movie';
  status?: 'ongoing' | 'finished';
  sort?: 'recent' | 'name' | 'added';
  /** Seulement les œuvres qui ont une fiche TMDB (donc une page sur le site). */
  linked?: boolean;
}

export interface AnimePlanningEntry {
  /** Jour de sortie annoncé par le planning, `YYYY-MM-DD`. */
  day: string;
  slug: string;
  name: string;
  seasonPath: string;
  lang: string;
  /** Heure de sortie (secondes Unix), ou null si le planning n'en donne pas. */
  releaseAt: number | null;
  label: string;
  state: 'scheduled' | 'released' | 'delayed';
  tmdb: { type: 'tv' | 'movie'; id: number } | null;
  posterPath: string | null;
  image: string;
}

export interface AnimePlanning {
  from: string;
  to: string;
  updatedAt: number | null;
  entries: AnimePlanningEntry[];
}

interface RequestConfig {
  params?: Record<string, unknown>;
  headers?: Record<string, string>;
}

const isTmdbId = (value: unknown): boolean => /^[1-9]\d{0,9}$/.test(String(value ?? ''));

/**
 * Œuvre(s) d'anime-sama dont la fiche renvoie à cet ID TMDB, dans la même
 * forme que la recherche par nom. Liste vide quand aucune fiche ne porte cet
 * ID ou quand l'appel échoue : l'appelant passe alors à la recherche par nom.
 */
export const fetchAnimeByTmdb = async <T = unknown>(
  mediaType: 'tv' | 'movie',
  tmdbId: number | string | undefined | null,
  config: RequestConfig = {},
): Promise<T[]> => {
  if (!isTmdbId(tmdbId)) return [];
  try {
    const response = await axios.get(`${MAIN_API}/anime/tmdb/${mediaType}/${tmdbId}`, config);
    return Array.isArray(response.data) ? (response.data as T[]) : [];
  } catch {
    return [];
  }
};

/** Vrai si au moins un lecteur de l'épisode attend encore son adresse. */
export const hasPendingAnimeLinks = (
  episode: { streaming_links?: Array<{ pending?: number }> } | null | undefined,
): boolean => Boolean(episode?.streaming_links?.some((link) => (link.pending ?? 0) > 0));

/**
 * Adresses des lecteurs d'un épisode. `null` quand l'épisode est inconnu du
 * serveur ou que l'appel échoue : l'appelant garde alors les adresses de la liste.
 */
export const fetchAnimeEpisodeLinks = async (
  slug: string,
  seasonPath: string,
  index: number,
  config: RequestConfig = {},
): Promise<AnimeEpisodeLinks | null> => {
  try {
    const response = await axios.get(`${MAIN_API}/anime/episode/${encodeURIComponent(slug)}`, {
      ...config,
      params: { ...(config.params || {}), season: seasonPath, episode: index },
    });
    const data = response.data as AnimeEpisodeLinks | undefined;
    return data && Array.isArray(data.streaming_links) ? data : null;
  } catch {
    return null;
  }
};

const EMPTY_CATALOGUE: AnimeCataloguePage = { page: 1, limit: 0, total: 0, totalPages: 0, items: [] };

/** Page du catalogue d'animes indexé. Page vide si l'appel échoue. */
export const fetchAnimeCatalogue = async (query: AnimeCatalogueQuery = {}): Promise<AnimeCataloguePage> => {
  const { linked, ...rest } = query;
  try {
    const response = await axios.get(`${MAIN_API}/anime/catalogue`, {
      params: { ...rest, ...(linked ? { linked: 1 } : {}) },
    });
    const data = response.data as AnimeCataloguePage | undefined;
    return data && Array.isArray(data.items) ? data : EMPTY_CATALOGUE;
  } catch {
    return EMPTY_CATALOGUE;
  }
};

/** Genres du catalogue indexé, du plus fourni au moins fourni. */
export const fetchAnimeCatalogueGenres = async (): Promise<Array<{ name: string; count: number }>> => {
  try {
    const response = await axios.get(`${MAIN_API}/anime/catalogue/genres`);
    const genres = (response.data as { genres?: unknown } | undefined)?.genres;
    return Array.isArray(genres) ? (genres as Array<{ name: string; count: number }>) : [];
  } catch {
    return [];
  }
};

/**
 * Sorties d'animes annoncées par le planning, entre deux jours (`YYYY-MM-DD`).
 * `null` si l'appel échoue : l'appelant sait alors que la liste est lacunaire,
 * et ne la confond pas avec une période sans sortie.
 */
export const fetchAnimePlanning = async (from: string, to: string): Promise<AnimePlanningEntry[] | null> => {
  try {
    const response = await axios.get(`${MAIN_API}/anime/planning`, { params: { from, to } });
    const entries = (response.data as AnimePlanning | undefined)?.entries;
    return Array.isArray(entries) ? entries : null;
  } catch {
    return null;
  }
};
