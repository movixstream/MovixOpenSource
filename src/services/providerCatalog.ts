import axios from 'axios';

const TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY || '';
const TMDB_DISCOVER_URL = 'https://api.themoviedb.org/3/discover';
const CACHE_TTL_MS = 3 * 60 * 1000;
const CACHE_MAX_ENTRIES = 30;

export type CatalogMediaType = 'movie' | 'tv';

export interface CatalogFilters {
  sort: string;
  year: string;
  rating: string;
  votes: string;
  language: string;
  runtime: string;
  region: string;
  offer: string;
}

export const DEFAULT_CATALOG_FILTERS: CatalogFilters = {
  sort: 'popularity.desc',
  year: '',
  rating: '',
  votes: '5',
  language: '',
  runtime: '',
  region: 'FR',
  offer: '',
};

export const PROVIDER_NAMES: Record<number, string> = {
  8: 'Netflix',
  119: 'Prime Video',
  531: 'Paramount+',
  337: 'Disney+',
  338: 'Marvel Studios',
  350: 'Apple TV+',
  355: 'Warner Bros',
  356: 'DC Comics',
  357: 'OCS',
  384: 'HBO MAX',
};

export interface CatalogStudio {
  name: string;
  tmdbId: number;
}

export const STUDIOS: Record<number, CatalogStudio> = {
  338: { name: 'Marvel Studios', tmdbId: 420 },
  356: { name: 'DC Comics', tmdbId: 9993 },
  355: { name: 'Warner Bros', tmdbId: 174 },
  357: { name: 'OCS', tmdbId: 792 },
};

export const GENRE_IDS: Record<CatalogMediaType, number[]> = {
  movie: [
    28, 12, 16, 35, 80, 99, 18, 10751, 14, 36, 27, 10402, 9648, 10749,
    878, 10770, 53, 10752, 37,
  ],
  tv: [
    10759, 16, 35, 80, 99, 18, 10751, 10762, 9648, 10763, 10764, 10765,
    10766, 10767, 10768, 37,
  ],
};

export interface CatalogItem {
  id: number;
  title?: string;
  name?: string;
  poster_path: string;
  backdrop_path?: string;
  overview?: string;
  vote_average: number;
  release_date?: string;
  first_air_date?: string;
  genre_ids?: number[];
  media_type: CatalogMediaType;
}

export interface CatalogResult {
  items: CatalogItem[];
  totalPages: number;
  totalResults: number;
}

const SORT_VALUES = new Set([
  'popularity.desc',
  'popularity.asc',
  'vote_average.desc',
  'vote_average.asc',
  'release_date.desc',
  'release_date.asc',
  'vote_count.desc',
  'vote_count.asc',
  'title.asc',
  'title.desc',
]);

const RUNTIME_VALUES = new Set(['', 'short', 'medium', 'long']);
const OFFER_VALUES = new Set(['', 'flatrate', 'free', 'ads', 'rent', 'buy']);
const ISO_2_PATTERN = /^[a-z]{2}$/i;

const readBoundedNumber = (
  value: string | null,
  fallback: string,
  min: number,
  max: number,
  integer: boolean,
): string => {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  if (integer ? !/^\d+$/.test(trimmed) : !/^\d+(?:\.\d+)?$/.test(trimmed)) {
    return fallback;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return String(parsed);
};

export const readCatalogFilters = (params: URLSearchParams): CatalogFilters => {
  const sort = params.get('sort') || '';
  const runtime = params.get('runtime') || '';
  const offer = params.get('offer') || '';
  const language = (params.get('language') || '').trim();
  const region = (params.get('region') || '').trim();
  const currentYear = new Date().getFullYear();

  return {
    sort: SORT_VALUES.has(sort) ? sort : DEFAULT_CATALOG_FILTERS.sort,
    year: readBoundedNumber(params.get('year'), DEFAULT_CATALOG_FILTERS.year, 1870, currentYear, true),
    rating: readBoundedNumber(params.get('rating'), DEFAULT_CATALOG_FILTERS.rating, 0, 10, false),
    votes: readBoundedNumber(params.get('votes'), DEFAULT_CATALOG_FILTERS.votes, 0, 100000, true),
    language: ISO_2_PATTERN.test(language) ? language.toLowerCase() : DEFAULT_CATALOG_FILTERS.language,
    runtime: RUNTIME_VALUES.has(runtime) ? runtime : DEFAULT_CATALOG_FILTERS.runtime,
    region: ISO_2_PATTERN.test(region) ? region.toUpperCase() : DEFAULT_CATALOG_FILTERS.region,
    offer: OFFER_VALUES.has(offer) ? offer : DEFAULT_CATALOG_FILTERS.offer,
  };
};

const MOVIE_TO_TV_GENRES: Record<number, number> = {
  28: 10759,
  12: 10759,
  14: 10765,
  878: 10765,
  10752: 10768,
};

const TV_TO_MOVIE_GENRES: Record<number, number> = {
  10759: 28,
  10765: 878,
  10768: 10752,
};

export const getCatalogGenre = (
  genreId: string | undefined,
  mediaType: CatalogMediaType,
): string => {
  const normalized = genreId?.trim() || '';
  if (!/^\d+$/.test(normalized)) return '';

  const numericId = Number(normalized);
  if (GENRE_IDS[mediaType].includes(numericId)) return String(numericId);

  const mappedId = mediaType === 'tv'
    ? MOVIE_TO_TV_GENRES[numericId]
    : TV_TO_MOVIE_GENRES[numericId];
  return mappedId ? String(mappedId) : '';
};

interface TmdbCatalogItem {
  id: number;
  title?: string | null;
  name?: string | null;
  poster_path?: string | null;
  backdrop_path?: string | null;
  overview?: string | null;
  vote_average?: number;
  release_date?: string | null;
  first_air_date?: string | null;
  genre_ids?: number[];
}

interface TmdbCatalogResponse {
  results?: TmdbCatalogItem[];
  total_pages?: number;
  total_results?: number;
}

interface CacheEntry {
  expiresAt: number;
  result: CatalogResult;
}

const resultCache = new Map<string, CacheEntry>();

const getCachedResult = (key: string): CatalogResult | undefined => {
  const entry = resultCache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    resultCache.delete(key);
    return undefined;
  }

  resultCache.delete(key);
  resultCache.set(key, entry);
  return entry.result;
};

const cacheResult = (key: string, result: CatalogResult): void => {
  resultCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, result });
  while (resultCache.size > CACHE_MAX_ENTRIES) {
    const oldestKey = resultCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    resultCache.delete(oldestKey);
  }
};

const getSortValue = (sort: string, mediaType: CatalogMediaType): string => {
  const [field, direction] = sort.split('.');
  if (field === 'release_date') {
    return `${mediaType === 'movie' ? 'primary_release_date' : 'first_air_date'}.${direction}`;
  }
  if (field === 'title') {
    return `${mediaType === 'movie' ? 'title' : 'name'}.${direction}`;
  }
  return sort;
};

const addRuntimeParams = (
  params: Record<string, string | number | boolean>,
  runtime: string,
  mediaType: CatalogMediaType,
): void => {
  const limits = mediaType === 'movie'
    ? { shortMax: 90, mediumMin: 91, mediumMax: 120, longMin: 121 }
    : { shortMax: 30, mediumMin: 31, mediumMax: 50, longMin: 51 };

  if (runtime === 'short') {
    params['with_runtime.lte'] = limits.shortMax;
  } else if (runtime === 'medium') {
    params['with_runtime.gte'] = limits.mediumMin;
    params['with_runtime.lte'] = limits.mediumMax;
  } else if (runtime === 'long') {
    params['with_runtime.gte'] = limits.longMin;
  }
};

export const fetchProviderCatalog = async (
  {
    providerId,
    mediaType,
    genre,
    page,
    filters,
    language,
  }: {
    providerId: string;
    mediaType: CatalogMediaType;
    genre: string;
    page: number;
    filters: CatalogFilters;
    language: string;
  },
  signal: AbortSignal,
): Promise<CatalogResult> => {
  const normalizedFilters = readCatalogFilters(new URLSearchParams(Object.entries(filters)));
  const today = new Date().toISOString().slice(0, 10);
  const normalizedPage = Math.min(500, Math.max(1, Math.trunc(page) || 1));
  const params: Record<string, string | number | boolean> = {
    api_key: TMDB_API_KEY,
    language,
    page: normalizedPage,
    sort_by: getSortValue(normalizedFilters.sort, mediaType),
    include_adult: false,
    'vote_count.gte': normalizedFilters.votes,
  };

  params[mediaType === 'movie' ? 'primary_release_date.lte' : 'first_air_date.lte'] = today;

  const catalogGenre = getCatalogGenre(genre, mediaType);
  if (catalogGenre) params.with_genres = catalogGenre;
  if (normalizedFilters.year) {
    params[mediaType === 'movie' ? 'primary_release_year' : 'first_air_date_year'] = normalizedFilters.year;
  }
  if (normalizedFilters.rating) params['vote_average.gte'] = normalizedFilters.rating;
  if (normalizedFilters.language) params.with_original_language = normalizedFilters.language;
  addRuntimeParams(params, normalizedFilters.runtime, mediaType);

  const studio = STUDIOS[Number(providerId)];
  if (studio) {
    params.with_companies = studio.tmdbId;
  } else {
    params.with_watch_providers = providerId;
    params.watch_region = normalizedFilters.region;
    if (normalizedFilters.offer) {
      params.with_watch_monetization_types = normalizedFilters.offer;
    }
  }

  const cacheParams = new URLSearchParams();
  Object.entries(params)
    .filter(([key]) => key !== 'api_key')
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([key, value]) => cacheParams.set(key, String(value)));
  const cacheKey = `${mediaType}?${cacheParams.toString()}`;
  const cached = getCachedResult(cacheKey);
  if (cached) return cached;

  const response = await axios.get<TmdbCatalogResponse>(`${TMDB_DISCOVER_URL}/${mediaType}`, {
    params,
    signal,
    timeout: 15000,
  });

  const items = (response.data.results || [])
    .filter((item) => Boolean(item.poster_path && item.overview?.trim()))
    .map<CatalogItem>((item) => ({
      id: item.id,
      title: item.title || undefined,
      name: item.name || undefined,
      poster_path: item.poster_path as string,
      backdrop_path: item.backdrop_path || undefined,
      overview: item.overview || undefined,
      vote_average: item.vote_average || 0,
      release_date: item.release_date || undefined,
      first_air_date: item.first_air_date || undefined,
      genre_ids: item.genre_ids,
      media_type: mediaType,
    }));

  const result: CatalogResult = {
    items,
    totalPages: Math.min(500, Math.max(1, response.data.total_pages || 1)),
    totalResults: Math.max(0, response.data.total_results || 0),
  };
  cacheResult(cacheKey, result);
  return result;
};
