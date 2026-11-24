import React, { createContext, useContext, useState, useEffect, useMemo, useRef, useCallback } from 'react';
import axios from 'axios';
import i18n from '../i18n';
import { searchIndexedMedia, type IndexedMedia } from '../utils/mediaSearchIndex';
import { getTmdbLanguage } from '../i18n';
import { TmdbKeyword, fetchTmdbMediaKeywordIds, searchTmdbKeywords } from '../utils/tmdbKeywords';
import { hasUsefulContent, isReleased } from '../utils/searchResultFilters';

const TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY || '';

// TMDB ne renvoie pas l'overview original en fallback : une fiche jamais
// traduite dans la langue d'interface arrive avec overview vide. On double
// donc chaque requête de recherche avec une langue secondaire (en-US quand
// l'interface est en français, fr-FR sinon) pour compléter les trous.
const getAltTmdbLanguage = () =>
  getTmdbLanguage().startsWith('en') ? 'fr-FR' : 'en-US';

// Requête identique dans la langue secondaire ; ne casse jamais la requête
// principale (un échec renvoie simplement une liste vide).
const fetchAltLanguageResults = async (url: string, params: Record<string, any>): Promise<any[]> => {
  try {
    const response = await axios.get(url, {
      params: { ...params, language: getAltTmdbLanguage() }
    });
    return response.data.results || [];
  } catch {
    return [];
  }
};

// Complète les overviews vides de la liste principale avec ceux de la langue
// secondaire (même id = même œuvre, seule la traduction change).
const mergeAltOverviews = (primary: any[], alt: any[]): any[] => {
  if (!alt.length) return primary;
  const altById = new Map(alt.map((item: any) => [item.id, item]));
  return primary.map((item: any) => {
    if (item.overview && item.overview.trim().length > 0) return item;
    const altItem = altById.get(item.id);
    return altItem?.overview ? { ...item, overview: altItem.overview } : item;
  });
};

// Une fiche « notée 10 » par un seul votant n'est pas bien notée. Dès que la
// note entre en jeu (filtre ou tri), on exige un minimum de votes : mesuré sur
// TMDB, « documentaires, note ≥ 8, français » renvoyait 187 pages dont la
// médiane était à 1 vote par fiche.
export const MIN_VOTE_COUNT_WHEN_RATING_MATTERS = 5;

// Une recherche texte combinée à des filtres (genre, note, langue, année,
// pays) ne peut pas être filtrée par TMDB : `search/*` n'accepte aucun de ces
// paramètres. On parcourt donc jusqu'à N pages TMDB d'un coup, on filtre, puis
// on pagine le résultat nous-mêmes.
const CLIENT_FILTERED_QUERY_MAX_PAGES = 10;
const RESULTS_PER_PAGE = 20;

const todayIsoDate = () => new Date().toISOString().slice(0, 10);

// Parcourt jusqu'à CLIENT_FILTERED_QUERY_MAX_PAGES pages d'un endpoint
// `search/*` (langue principale + secondaire pour les synopsis) et renvoie
// les résultats à plat. Une page qui échoue après la première est ignorée.
const fetchSearchPages = async (
  endpoint: 'search/movie' | 'search/tv',
  params: Record<string, string | number>,
  mediaType: 'movie' | 'tv',
) => {
  const url = `https://api.themoviedb.org/3/${endpoint}`;
  const fetchPage = async (page: number) => {
    const [response, alt] = await Promise.all([
      axios.get(url, { params: { ...params, page } }),
      fetchAltLanguageResults(url, { ...params, page }),
    ]);
    return {
      results: mergeAltOverviews(response.data.results || [], alt),
      totalPages: response.data.total_pages || 0,
    };
  };
  const first = await fetchPage(1);
  const pageCount = Math.min(first.totalPages, CLIENT_FILTERED_QUERY_MAX_PAGES);
  const others = await Promise.all(
    Array.from({ length: Math.max(pageCount - 1, 0) }, (_, index) =>
      fetchPage(index + 2).catch(() => ({ results: [], totalPages: 0 }))),
  );
  return [first, ...others]
    .flatMap((page) => page.results)
    .map((result) => ({ ...result, media_type: mediaType }));
};

export interface WatchProvider {
  provider_id: number;
  provider_name: string;
  logo_path: string;
  display_priority: number;
}

export type SortByOption = 'popularity.desc' | 'popularity.asc' | 'vote_average.desc' | 'vote_average.asc' | 'primary_release_date.desc' | 'primary_release_date.asc' | 'revenue.desc' | 'vote_count.desc';

export interface SearchResult { // Added export keyword
  id: number;
  title?: string;
  name?: string;
  media_type: 'movie' | 'tv';
  poster_path: string;
  backdrop_path?: string;
  release_date?: string;
  first_air_date?: string;
  vote_average: number;
  vote_count?: number;
  popularity?: number;
  genre_ids: number[];
  overview?: string;
  original_language?: string;
  origin_country?: string[];
}

interface PersonSuggestion {
  id: number;
  name: string;
  profile_path: string | null;
  known_for_department: string;
  popularity: number;
}

interface Genre {
  id: number;
  name: string;
}

interface SearchContextType {
  query: string;
  setQuery: (query: string) => void;
  results: SearchResult[];
  loading: boolean;
  error: string | null;
  genres: Genre[];
  selectedGenres: number[];
  toggleGenre: (genreId: number) => void;
  selectedType: 'all' | 'movie' | 'tv';
  setSelectedType: (type: 'all' | 'movie' | 'tv') => void;
  minRating: number;
  setMinRating: (rating: number) => void;
  hasMore: boolean;
  page: number;
  setPage: (page: number) => void;
  performSearch: (pageNum: number, isNewSearch?: boolean) => Promise<void>;
  loadingGenres: boolean;
  showFilters: boolean;
  setShowFilters: React.Dispatch<React.SetStateAction<boolean>>;
  isLoadingMore: boolean;
  totalPages: number;
  director: string;
  setDirector: (director: string) => void;
  actor: string;
  setActor: (actor: string) => void;
  year: string;
  setYear: (year: string) => void;
  directorSuggestions: PersonSuggestion[];
  actorSuggestions: PersonSuggestion[];
  loadingSuggestions: boolean;
  fetchPeopleSuggestions: (query: string, type: 'director' | 'actor') => Promise<void>;
  selectPerson: (person: PersonSuggestion, type: 'director' | 'actor') => void;
  clearSuggestions: () => void;
  autocompleteSuggestions: SearchResult[];
  loadingAutocomplete: boolean;
  fetchAutocompleteSuggestions: (query: string) => Promise<void>;
  clearAutocompleteSuggestions: () => void;
  selectedKeywords: TmdbKeyword[];
  addKeyword: (keyword: TmdbKeyword) => void;
  removeKeyword: (keywordId: number) => void;
  clearKeywords: () => void;
  keywordSuggestions: TmdbKeyword[];
  loadingKeywordSuggestions: boolean;
  fetchKeywordSuggestions: (query: string) => Promise<void>;
  clearKeywordSuggestions: () => void;
  selectedLanguage: string;
  setSelectedLanguage: (language: string) => void;
  selectedCountry: string;
  setSelectedCountry: (country: string) => void;
  selectedProviders: number[];
  toggleProvider: (providerId: number) => void;
  clearProviders: () => void;
  watchProvidersList: WatchProvider[];
  loadingProviders: boolean;
  sortBy: SortByOption;
  setSortBy: (sortBy: SortByOption) => void;
  /** Masquer les titres pas encore sortis (appliqué côté TMDB en mode filtres). */
  filterUnreleased: boolean;
  setFilterUnreleased: (value: boolean) => void;
  /** Masquer les titres sans synopsis. */
  filterNoContent: boolean;
  setFilterNoContent: (value: boolean) => void;
  /** Ignorer les notes portées par moins de MIN_VOTE_COUNT_WHEN_RATING_MATTERS votes. */
  filterLowVotes: boolean;
  setFilterLowVotes: (value: boolean) => void;
  /**
   * Déclenche le chargement (une seule fois) des genres + providers TMDB.
   * Appelé par la page Search au montage — perf : ces 4 requêtes ne partent
   * plus au boot de l'app pour tous les visiteurs.
   */
  ensureFiltersLoaded: () => void;
  /**
   * Remet les filtres à zéro puis ne garde que le type et les genres donnés
   * (lien « genre » d'une fiche : /search?type=movie&genre=878).
   */
  applyGenreFilter: (
    type: 'all' | 'movie' | 'tv',
    genreIds: number[],
    options?: { language?: string; country?: string },
  ) => void;
}

const SearchContext = createContext<SearchContextType | null>(null);

export const useSearch = () => {
  const context = useContext(SearchContext);
  if (!context) {
    throw new Error('useSearch must be used within a SearchProvider');
  }
  return context;
};

// Ajout du mapping statique des genres TMDB -> français
const GENRES_FR: Record<number, string> = {
  28: 'Action',
  12: 'Aventure',
  16: 'Animation',
  35: 'Comédie',
  80: 'Crime',
  99: 'Documentaire',
  18: 'Drame',
  10751: 'Famille',
  14: 'Fantastique',
  36: 'Histoire',
  27: 'Horreur',
  10402: 'Musique',
  9648: 'Mystère',
  10749: 'Romance',
  878: 'Science-Fiction',
  10770: 'Téléfilm',
  53: 'Thriller',
  10752: 'Guerre',
  37: 'Western',
  10759: 'Action & Aventure',
  10762: 'Enfants',
  10763: 'Actualités',
  10764: 'Téléréalité',
  10765: 'Science-Fiction & Fantastique',
  10766: 'Feuilleton',
  10767: 'Talk-show',
  10768: 'Guerre & Politique'
};

/** Une entrée du catalogue local, au format des résultats TMDB. */
const toSearchResult = (entry: IndexedMedia): SearchResult => ({
  id: entry.id,
  media_type: entry.mediaType,
  title: entry.mediaType === 'movie' ? entry.title : undefined,
  name: entry.mediaType === 'tv' ? entry.title : undefined,
  poster_path: entry.posterPath || '',
  backdrop_path: entry.backdropPath || undefined,
  release_date: entry.mediaType === 'movie' ? entry.date : undefined,
  first_air_date: entry.mediaType === 'tv' ? entry.date : undefined,
  vote_average: entry.voteAverage ?? 0,
  genre_ids: entry.genreIds ?? [],
  overview: entry.overview,
});

export const SearchProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [genres, setGenres] = useState<Genre[]>([]);
  const [selectedGenres, setSelectedGenres] = useState<number[]>([]);
  // Lu par le chargement des genres, qui ne doit pas perdre une sélection
  // posée juste avant (lien depuis une fiche).
  const selectedGenresRef = useRef<number[]>([]);
  selectedGenresRef.current = selectedGenres;
  const [selectedType, setSelectedType] = useState<'all' | 'movie' | 'tv'>('all');
  const [minRating, setMinRating] = useState<number>(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadingGenres, setLoadingGenres] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [director, setDirector] = useState<string>('');
  const [actor, setActor] = useState<string>('');
  const [year, setYear] = useState<string>('');
  const [directorSuggestions, setDirectorSuggestions] = useState<PersonSuggestion[]>([]);
  const [actorSuggestions, setActorSuggestions] = useState<PersonSuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [autocompleteSuggestions, setAutocompleteSuggestions] = useState<SearchResult[]>([]);
  const [loadingAutocomplete, setLoadingAutocomplete] = useState(false);
  const [selectedKeywords, setSelectedKeywords] = useState<TmdbKeyword[]>([]);
  const [keywordSuggestions, setKeywordSuggestions] = useState<TmdbKeyword[]>([]);
  const [loadingKeywordSuggestions, setLoadingKeywordSuggestions] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<string>('');
  const [selectedCountry, setSelectedCountry] = useState<string>('');
  const [selectedProviders, setSelectedProviders] = useState<number[]>([]);
  const [watchProvidersList, setWatchProvidersList] = useState<WatchProvider[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [sortBy, setSortBy] = useState<SortByOption>('popularity.desc');
  const [filterUnreleased, setFilterUnreleased] = useState(true);
  const [filterNoContent, setFilterNoContent] = useState(true);
  const [filterLowVotes, setFilterLowVotes] = useState(true);
  // Pool d'une recherche texte filtrée côté client (voir performSearch) :
  // conservé tant que la signature de la recherche ne change pas.
  const queryPoolRef = useRef<{ signature: string; items: SearchResult[] } | null>(null);

  const toggleProvider = (providerId: number) => {
    setSelectedProviders(prev =>
      prev.includes(providerId) ? prev.filter(id => id !== providerId) : [...prev, providerId]
    );
  };

  const clearProviders = () => {
    setSelectedProviders([]);
  };

  // Function to fetch people suggestions from TMDB
  const fetchPeopleSuggestions = async (searchQuery: string, type: 'director' | 'actor') => {
    if (!searchQuery || searchQuery.length < 2) {
      if (type === 'director') {
        setDirectorSuggestions([]);
      } else {
        setActorSuggestions([]);
      }
      return;
    }

    setLoadingSuggestions(true);

    try {
      const response = await axios.get(`https://api.themoviedb.org/3/search/person`, {
        params: {
          api_key: TMDB_API_KEY,
          query: searchQuery,
          language: getTmdbLanguage(),
          page: 1,
        }
      });

      const results = response.data.results
        .filter((person: any) => {
          // Vérifier que la personne a des œuvres connues
          if (!person.known_for || person.known_for.length === 0) {
            return false;
          }

          // Vérifier que les œuvres connues sont des films ou séries (pas des personnes)
          const validWorks = person.known_for.filter((work: any) =>
            work.media_type === 'movie' || work.media_type === 'tv'
          );

          if (validWorks.length === 0) {
            return false;
          }

          // Vérifier que la personne a au moins une œuvre avec une note décente ou récente
          const hasRelevantWork = validWorks.some((work: any) => {
            const releaseYear = work.release_date ? new Date(work.release_date).getFullYear() :
              work.first_air_date ? new Date(work.first_air_date).getFullYear() : 0;
            return work.vote_average >= 5.0 || releaseYear >= 2000;
          });

          if (!hasRelevantWork) {
            return false;
          }

          if (type === 'director') {
            return person.known_for_department === 'Directing' ||
              person.known_for_department === 'Production' ||
              person.known_for.some((work: any) => work.job === 'Director');
          } else {
            return person.known_for_department === 'Acting';
          }
        })
        .slice(0, 5); // Limit to 5 suggestions

      if (type === 'director') {
        setDirectorSuggestions(results);
      } else {
        setActorSuggestions(results);
      }
    } catch (error) {
      console.error(`Error fetching ${type} suggestions:`, error);
    } finally {
      setLoadingSuggestions(false);
    }
  };

  // Function to select a person from suggestions
  const selectPerson = (person: PersonSuggestion, type: 'director' | 'actor') => {
    if (type === 'director') {
      setDirector(person.name);
      setDirectorSuggestions([]);
    } else {
      setActor(person.name);
      setActorSuggestions([]);
    }
  };

  // Function to clear all suggestions
  const clearSuggestions = () => {
    setDirectorSuggestions([]);
    setActorSuggestions([]);
  };

  // Function to fetch autocomplete suggestions
  const fetchAutocompleteSuggestions = async (searchQuery: string) => {
    if (!searchQuery || searchQuery.length < 2) {
      setAutocompleteSuggestions([]);
      return;
    }

    setLoadingAutocomplete(true);
    try {
      const params = {
        api_key: TMDB_API_KEY,
        query: searchQuery,
        language: getTmdbLanguage(),
        page: 1,
        sort_by: 'popularity.desc'
      };

      const [response, altResults] = await Promise.all([
        axios.get(`https://api.themoviedb.org/3/search/multi`, { params }),
        fetchAltLanguageResults(`https://api.themoviedb.org/3/search/multi`, params)
      ]);

      let rawResults = mergeAltOverviews(response.data.results, altResults)
        .filter((item: any) => (item.media_type === 'movie' || item.media_type === 'tv') && item.poster_path);

      // Fallback : search/multi est plus strict que search/movie et search/tv
      // (ex. « Spider-Man 3 : Editor's Cut » ne sort qu'en search/movie).
      // Si multi ne trouve rien, on retente les deux endpoints dédiés.
      if (rawResults.length === 0) {
        const [movieResponse, tvResponse, movieAltResults, tvAltResults] = await Promise.allSettled([
          axios.get(`https://api.themoviedb.org/3/search/movie`, { params }),
          axios.get(`https://api.themoviedb.org/3/search/tv`, { params }),
          fetchAltLanguageResults(`https://api.themoviedb.org/3/search/movie`, params),
          fetchAltLanguageResults(`https://api.themoviedb.org/3/search/tv`, params)
        ]);
        const movieResults = movieResponse.status === 'fulfilled'
          ? mergeAltOverviews(
              movieResponse.value.data.results,
              movieAltResults.status === 'fulfilled' ? movieAltResults.value : []
            ).map((item: any) => ({ ...item, media_type: 'movie' }))
          : [];
        const tvResults = tvResponse.status === 'fulfilled'
          ? mergeAltOverviews(
              tvResponse.value.data.results,
              tvAltResults.status === 'fulfilled' ? tvAltResults.value : []
            ).map((item: any) => ({ ...item, media_type: 'tv' }))
          : [];
        rawResults = [...movieResults, ...tvResults].filter((item: any) => item.poster_path);
      }

      const suggestions = rawResults
        // Tri par popularité décroissante pour afficher d'abord les plus populaires
        .sort((a: any, b: any) => b.popularity - a.popularity)
        .slice(0, 5); // Limit to 5 suggestions

      setAutocompleteSuggestions(suggestions);
    } catch (error) {
      console.error('Error fetching autocomplete suggestions:', error);
      setAutocompleteSuggestions([]);
    } finally {
      setLoadingAutocomplete(false);
    }
  };

  const clearAutocompleteSuggestions = () => {
    setAutocompleteSuggestions([]);
  };

  const fetchKeywordSuggestions = async (searchQuery: string) => {
    if (!searchQuery || searchQuery.length < 2) {
      setKeywordSuggestions([]);
      return;
    }

    setLoadingKeywordSuggestions(true);

    try {
      const suggestions = await searchTmdbKeywords(searchQuery, getTmdbLanguage());
      setKeywordSuggestions(
        suggestions.filter((keyword) => !selectedKeywords.some((selectedKeyword) => selectedKeyword.id === keyword.id))
      );
    } catch (error) {
      console.error('Error fetching keyword suggestions:', error);
      setKeywordSuggestions([]);
    } finally {
      setLoadingKeywordSuggestions(false);
    }
  };

  const addKeyword = (keyword: TmdbKeyword) => {
    setSelectedKeywords((prev) => (
      prev.some((selectedKeyword) => selectedKeyword.id === keyword.id)
        ? prev
        : [...prev, keyword]
    ));
    setKeywordSuggestions((prev) => prev.filter((suggestion) => suggestion.id !== keyword.id));
  };

  const removeKeyword = (keywordId: number) => {
    setSelectedKeywords((prev) => prev.filter((keyword) => keyword.id !== keywordId));
  };

  const clearKeywords = () => {
    setSelectedKeywords([]);
    setKeywordSuggestions([]);
  };

  const clearKeywordSuggestions = () => {
    setKeywordSuggestions([]);
  };

  const filterResultsByKeywords = async (items: SearchResult[]) => {
    if (selectedKeywords.length === 0 || items.length === 0) {
      return items;
    }

    const selectedKeywordIds = selectedKeywords.map((keyword) => keyword.id);
    const itemMatches = await Promise.all(
      items.map(async (item) => {
        try {
          const itemKeywordIds = await fetchTmdbMediaKeywordIds(item.media_type, item.id);
          return selectedKeywordIds.every((keywordId) => itemKeywordIds.includes(keywordId));
        } catch (error) {
          console.error(`Error fetching keywords for ${item.media_type} ${item.id}:`, error);
          return false;
        }
      })
    );

    return items.filter((_item, index) => itemMatches[index]);
  };

  // TMDB search/* endpoints don't support with_watch_providers, so when a query
  // is combined with provider filters we must filter client-side via per-item
  // /watch/providers calls (region FR).
  const filterResultsByProviders = async (items: SearchResult[]) => {
    if (selectedProviders.length === 0 || items.length === 0) {
      return items;
    }

    const selectedSet = new Set(selectedProviders);
    const itemMatches = await Promise.all(
      items.map(async (item) => {
        try {
          const response = await axios.get(
            `https://api.themoviedb.org/3/${item.media_type}/${item.id}/watch/providers`,
            { params: { api_key: TMDB_API_KEY } }
          );
          const fr = response.data?.results?.FR;
          if (!fr) return false;
          const all = [
            ...(fr.flatrate || []),
            ...(fr.buy || []),
            ...(fr.rent || []),
            ...(fr.free || []),
            ...(fr.ads || []),
          ];
          return all.some((p: any) => selectedSet.has(p.provider_id));
        } catch (error) {
          console.error(`Error fetching providers for ${item.media_type} ${item.id}:`, error);
          return false;
        }
      })
    );

    return items.filter((_item, index) => itemMatches[index]);
  };

  const performSearch = async (pageNum: number, isNewSearch: boolean = false) => {
    // Modifier la définition de isGenreSearch pour ne pas dépendre de query
    const hasFilters = selectedGenres.length > 0 || selectedType !== 'all' || minRating > 0 || director || actor || year || selectedKeywords.length > 0 || selectedLanguage || selectedCountry || selectedProviders.length > 0;
    const isGenreSearch = hasFilters;

    if ((!hasMore && !isNewSearch && !isGenreSearch) || isLoading) return;

    if (!query && selectedGenres.length === 0 && selectedType === 'all' && minRating === 0 && !director && !actor && !year && selectedKeywords.length === 0 && !selectedLanguage && !selectedCountry && selectedProviders.length === 0) return;

    const loadingMore = !isNewSearch && isGenreSearch;

    if (isNewSearch) {
      setLoading(true);
      setPage(1); // Réinitialise la page pour une nouvelle recherche
      // Réinitialise les IDs pour une nouvelle recherche
    } else if (loadingMore) {
      setIsLoadingMore(true);
    }

    setIsLoading(true);
    setError(null);

    try {
      let searchResults: SearchResult[] = [];
      let tmdbInitialResults: any[] = [];
      let currentTotalPages = 0;

      // Filtres que TMDB n'applique pas sur `search/*` : vérifiés côté client.
      const matchesQueryFilters = (result: SearchResult): boolean => {
        if (!result.poster_path) return false;
        if (selectedLanguage && result.original_language !== selectedLanguage) return false;
        if (selectedGenres.length > 0
          && !(result.genre_ids || []).some((id: number) => selectedGenres.includes(id))) return false;
        if (minRating > 0) {
          if ((result.vote_average ?? 0) < minRating) return false;
          if (filterLowVotes && (result.vote_count ?? 0) < MIN_VOTE_COUNT_WHEN_RATING_MATTERS) return false;
        }
        if (year) {
          const date = result.release_date || result.first_air_date;
          if (!date || date.substring(0, 4) !== year) return false;
        }
        if (selectedCountry && !(result.origin_country || []).includes(selectedCountry)) return false;
        if (filterUnreleased && !isReleased(result)) return false;
        if (filterNoContent && !hasUsefulContent(result)) return false;
        return true;
      };
      const usesClientSideFilters = selectedGenres.length > 0 || minRating > 0
        || !!selectedLanguage || !!year || !!selectedCountry;

      if (query && usesClientSideFilters) {
        // `search/*` ignore genre, note, langue, année et pays. Paginer TMDB
        // puis filtrer chaque page annonçait des centaines de pages, presque
        // toutes vides ou à 1-2 fiches (mesuré : « guerre » + documentaire +
        // note ≥ 8 + français = 64 pages TMDB, 1 à 6 fiches par page). On
        // récupère donc d'un coup jusqu'à CLIENT_FILTERED_QUERY_MAX_PAGES
        // pages, on filtre, et on pagine ce pool nous-mêmes. Le pool survit
        // aux changements de page : naviguer ne refait aucune requête.
        const poolSignature = JSON.stringify({
          query, selectedType, selectedGenres, minRating, selectedLanguage, year,
          selectedCountry, filterUnreleased, filterNoContent, filterLowVotes, language: getTmdbLanguage(),
        });
        const cached = queryPoolRef.current;
        let pool = cached && cached.signature === poolSignature ? cached.items : null;
        if (!pool) {
          const searchParams = { api_key: TMDB_API_KEY, query, language: getTmdbLanguage() };
          const [movieResults, tvResults] = await Promise.all([
            selectedType === 'tv' ? [] : fetchSearchPages('search/movie', searchParams, 'movie'),
            selectedType === 'movie' ? [] : fetchSearchPages('search/tv', searchParams, 'tv'),
          ]);
          pool = [...movieResults, ...tvResults]
            .filter(matchesQueryFilters)
            .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
          queryPoolRef.current = { signature: poolSignature, items: pool };
        }
        currentTotalPages = Math.ceil(pool.length / RESULTS_PER_PAGE);
        setTotalPages(currentTotalPages);
        tmdbInitialResults = pool.slice((pageNum - 1) * RESULTS_PER_PAGE, pageNum * RESULTS_PER_PAGE);
      } else if (query) {
        try {
          console.log('Getting initial TMDB results for:', query);

          // Détermine s'il faut utiliser search ou discover (uniquement si pas de requête texte)
          const shouldUseDiscover = !query;

          // Paramètres de base communs
          const baseSearchParams: Record<string, any> = {
            api_key: TMDB_API_KEY,
            query: query,
            language: getTmdbLanguage(),
            page: pageNum,
            sort_by: 'popularity.desc',
          };

          // Ajout de filtres supplémentaires
          // Ajouter les paramètres spécifiques à discover
          if (shouldUseDiscover) {
            if (selectedGenres.length > 0) {
              baseSearchParams.with_genres = selectedGenres.join(',');
            }

            if (minRating > 0) {
              baseSearchParams['vote_average.gte'] = minRating;
            }

            if (director || actor) {
              // Obtenir les IDs est asynchrone, fait plus bas ou déjà fait ?
              // Le code original faisait await getPeopleIds ici, mais c'est mieux de le gérer proprement
            }
          }

          // Gestion spécifique Director/Actor pour discover (déplacé du bloc incorrect précédent)
          if (shouldUseDiscover && (director || actor)) {
            const peopleIds = await getPeopleIds(director, actor);
            if (peopleIds) {
              baseSearchParams.with_people = peopleIds;
            }
          }

          // Filter by language if selected
          if (shouldUseDiscover && selectedLanguage) {
            baseSearchParams.with_original_language = selectedLanguage;
          }

          // Filter by country if selected
          if (shouldUseDiscover && selectedCountry) {
            baseSearchParams.with_origin_country = selectedCountry;
          }

          let tvResults = [];
          let movieResults = [];

          // TV results
          if (selectedType === 'all' || selectedType === 'tv') {
            const tvEndpoint = shouldUseDiscover ? 'discover/tv' : 'search/tv';

            // Pour discover/tv, on ajuste certains paramètres spécifiques
            const tvParams = { ...baseSearchParams };
            if (tvEndpoint === 'discover/tv') {
              if (year) {
                delete tvParams.year; // Année n'est pas compatible avec discover/tv
                tvParams.first_air_date_year = year;
              }
            }

            const [tvResponse, tvAltResults] = await Promise.all([
              axios.get(`https://api.themoviedb.org/3/${tvEndpoint}`, { params: tvParams }),
              fetchAltLanguageResults(`https://api.themoviedb.org/3/${tvEndpoint}`, tvParams)
            ]);

            // Format TV results
            tvResults = mergeAltOverviews(tvResponse.data.results, tvAltResults)
              .filter((result: any) => {
                // Ne filtrer côté client que si on n'utilise pas discover
                if (!shouldUseDiscover && selectedGenres.length > 0) {
                  // Vérifier si au moins un des genres du résultat est dans selectedGenres
                  return result.genre_ids && result.genre_ids.some((genreId: number) =>
                    selectedGenres.includes(genreId)
                  );
                }
                return true;
              })
              .map((result: any) => ({
                ...result,
                media_type: 'tv'
              }));

            // Contribution à la pagination
            if (selectedType === 'tv') {
              currentTotalPages = tvResponse.data.total_pages || 0;
            }
          }

          // Movie results
          if (selectedType === 'all' || selectedType === 'movie') {
            const movieEndpoint = shouldUseDiscover ? 'discover/movie' : 'search/movie';

            // Pour discover/movie, on ajuste certains paramètres spécifiques
            const movieParams = { ...baseSearchParams };
            if (movieEndpoint === 'discover/movie') {
              if (year) {
                delete movieParams.year; // Année n'est pas compatible avec discover/movie
                movieParams.primary_release_year = year;
              }
            }

            const [movieResponse, movieAltResults] = await Promise.all([
              axios.get(`https://api.themoviedb.org/3/${movieEndpoint}`, { params: movieParams }),
              fetchAltLanguageResults(`https://api.themoviedb.org/3/${movieEndpoint}`, movieParams)
            ]);

            // Format movie results
            movieResults = mergeAltOverviews(movieResponse.data.results, movieAltResults)
              .filter((result: any) => {
                // Ne filtrer côté client que si on n'utilise pas discover
                if (!shouldUseDiscover && selectedGenres.length > 0) {
                  // Vérifier si au moins un des genres du résultat est dans selectedGenres
                  return result.genre_ids && result.genre_ids.some((genreId: number) =>
                    selectedGenres.includes(genreId)
                  );
                }
                return true;
              })
              .map((result: any) => ({
                ...result,
                media_type: 'movie'
              }));

            // Contribution à la pagination
            if (selectedType === 'movie') {
              currentTotalPages = movieResponse.data.total_pages || 0;
            } else if (selectedType === 'all') {
              // Update total pages (using maximum of both results)
              currentTotalPages = Math.max(currentTotalPages, movieResponse.data.total_pages || 0);
            }
          }

          // Mettre à jour le total de pages
          setTotalPages(currentTotalPages);

          // Combine results based on selected type
          if (selectedType === 'all') {
            // Combiner et trier par popularité décroissante
            tmdbInitialResults = [...tvResults, ...movieResults]
              .sort((a, b) => b.popularity - a.popularity);
          } else if (selectedType === 'tv') {
            tmdbInitialResults = tvResults;
          } else {
            tmdbInitialResults = movieResults;
          }

          console.log('Initial TMDB results count:', tmdbInitialResults.length);
        } catch (error) {
          console.error('Error getting initial TMDB results:', error);
        }

        tmdbInitialResults = tmdbInitialResults.filter(matchesQueryFilters);
      }

      // Mots-clés et plateformes se vérifient fiche par fiche (une requête
      // TMDB chacune) : uniquement sur la page affichée.
      if (query) {
        if (selectedKeywords.length > 0) {
          tmdbInitialResults = await filterResultsByKeywords(tmdbInitialResults);
        }
        if (selectedProviders.length > 0) {
          tmdbInitialResults = await filterResultsByProviders(tmdbInitialResults);
        }
      }

      // Recherche TMDB supplémentaire si nécessaire
      if (query && tmdbInitialResults.length > 0) {
        searchResults = tmdbInitialResults;
      }

      // Recherche par filtres uniquement (sans query)
      if (!query && (selectedGenres.length > 0 || selectedType !== 'all' || minRating > 0 || director || actor || year || selectedKeywords.length > 0 || selectedLanguage || selectedCountry || selectedProviders.length > 0)) {
        const baseParams: any = {
          api_key: TMDB_API_KEY,
          with_genres: selectedGenres.join(','),
          page: isGenreSearch ? pageNum : 1,
          language: getTmdbLanguage(),
          sort_by: sortBy
        };
        // TMDB attend `vote_average.gte` (avec un point). L'ancienne clé
        // `vote_average_gte` était ignorée : TMDB renvoyait jusqu'à 500 pages
        // non filtrées, puis le filtre client vidait la plupart des pages.
        if (minRating > 0) {
          baseParams['vote_average.gte'] = minRating;
        }
        // Sans minimum de votes, « note ≥ 8 » ou « tri par note » remonte
        // des fiches à un seul vote, sans affiche ni synopsis, que le filtre
        // client élimine ensuite page après page. Désactivable dans l'UI.
        if (filterLowVotes && (minRating > 0 || sortBy.startsWith('vote_average'))) {
          baseParams['vote_count.gte'] = MIN_VOTE_COUNT_WHEN_RATING_MATTERS;
        }
        if (selectedLanguage) {
          baseParams.with_original_language = selectedLanguage;
        }
        if (selectedCountry) {
          baseParams.with_origin_country = selectedCountry;
        }
        if (selectedProviders.length > 0) {
          baseParams.with_watch_providers = selectedProviders.join('|');
          baseParams.watch_region = 'FR';
        }
        if (selectedKeywords.length > 0) {
          baseParams.with_keywords = selectedKeywords.map((keyword) => keyword.id).join(',');
        }
        if (director || actor) {
          const peopleIds = await getPeopleIds(director, actor);
          if (peopleIds) baseParams.with_people = peopleIds;
        }
        // Paramètres propres à chaque endpoint : TMDB ignore en silence
        // `primary_release_year` et `with_release_type` sur discover/tv, donc
        // en mode « tout » les séries n'étaient pas filtrées par année.
        const movieParams: Record<string, unknown> = { ...baseParams, with_release_type: '2|3' };
        const tvParams: Record<string, unknown> = { ...baseParams };
        if (year) {
          movieParams.primary_release_year = year;
          tvParams.first_air_date_year = year;
        }
        // « Masquer les non sortis » côté TMDB : sinon un tri par date de
        // sortie remplit les premières pages de titres à venir, que le filtre
        // client vide ensuite entièrement (mesuré : 10 premières pages à 0).
        if (filterUnreleased) {
          movieParams['primary_release_date.lte'] = todayIsoDate();
          tvParams['first_air_date.lte'] = todayIsoDate();
        }
        if (sortBy.startsWith('primary_release_date')) {
          tvParams.sort_by = sortBy.replace('primary_release_date', 'first_air_date');
        }
        let endpoint = 'search/multi';
        const params: any = selectedType === 'tv' ? tvParams : movieParams;
        if (!query && isGenreSearch) {
          if (selectedType === 'all') {
            try {
              const [movieResponse, tvResponse, movieAltResults, tvAltResults] = await Promise.all([
                axios.get(`https://api.themoviedb.org/3/discover/movie`, { params: movieParams }),
                axios.get(`https://api.themoviedb.org/3/discover/tv`, { params: tvParams }),
                fetchAltLanguageResults(`https://api.themoviedb.org/3/discover/movie`, movieParams),
                fetchAltLanguageResults(`https://api.themoviedb.org/3/discover/tv`, tvParams)
              ]);
              const movieResults = mergeAltOverviews(movieResponse.data.results, movieAltResults)
                .map((result: any) => ({ ...result, media_type: 'movie' }));
              const tvResults = mergeAltOverviews(tvResponse.data.results, tvAltResults)
                .map((result: any) => ({ ...result, media_type: 'tv' }));
              const combinedResults = [...movieResults, ...tvResults].sort((a, b) => b.popularity - a.popularity);
              currentTotalPages = Math.max(movieResponse.data.total_pages || 0, tvResponse.data.total_pages || 0);
              setTotalPages(currentTotalPages);
              searchResults = combinedResults.filter((result: any) => {
                if (!result.poster_path) return false;
                return result.vote_average >= minRating;
              });
            } catch (error) {
              console.error('Error with dual API calls:', error);
              endpoint = 'discover/movie';
            }
          } else {
            endpoint = `discover/${selectedType}`;
          }
        } else if (query && isGenreSearch) {
          endpoint = 'search/multi';
          params.query = query;
          if (searchResults.length >= 20 && selectedType === 'all') {
            setResults(searchResults);
            setPage(pageNum);
            setHasMore(pageNum < currentTotalPages);
            setLoading(false);
            setIsLoading(false);
            setIsLoadingMore(false);
            return;
          }
        } else if (query) {
          endpoint = 'search/multi';
          params.query = query;
        }
        if (endpoint && endpoint.startsWith('discover')) {
          const [response, altResults] = await Promise.all([
            axios.get(`https://api.themoviedb.org/3/${endpoint}`, { params }),
            fetchAltLanguageResults(`https://api.themoviedb.org/3/${endpoint}`, params)
          ]);
          if (response.data.total_pages && (!currentTotalPages || isGenreSearch)) {
            currentTotalPages = response.data.total_pages;
            setTotalPages(currentTotalPages);
          }
          let tmdbResults = mergeAltOverviews(response.data.results, altResults).filter((result: any) => {
            if (!result.poster_path) return false;
            if (endpoint.includes('discover')) return result.vote_average >= minRating;
            return (result.media_type === 'movie' || result.media_type === 'tv') && result.vote_average >= minRating;
          });
          if (endpoint === 'discover/movie') tmdbResults = tmdbResults.map((result: any) => ({ ...result, media_type: 'movie' }));
          else if (endpoint === 'discover/tv') tmdbResults = tmdbResults.map((result: any) => ({ ...result, media_type: 'tv' }));
          searchResults = tmdbResults;
        }
      }

      // Le catalogue local prolonge TMDB là où il est aveugle : mots-clés,
      // titres alternatifs, thèmes et personnages des fiches déjà ouvertes.
      // Uniquement en première page, et derrière les résultats de TMDB — ce
      // sont des repêchages, pas des réponses plus pertinentes. (Chaque
      // changement de page passe par isNewSearch : tester le numéro de page.)
      if (pageNum === 1 && query) {
        const alreadyThere = new Set(searchResults.map((result) => `${result.media_type}:${result.id}`));
        const fromIndex = searchIndexedMedia(query)
          .filter((entry) => !alreadyThere.has(`${entry.mediaType}:${entry.id}`))
          .filter((entry) => selectedType === 'all' || entry.mediaType === selectedType)
          .filter((entry) => (entry.voteAverage ?? 0) >= minRating)
          .filter((entry) => selectedGenres.length === 0
            || (entry.genreIds ?? []).some((genreId) => selectedGenres.includes(genreId)))
          .map(toSearchResult);
        searchResults = [...searchResults, ...fromIndex];
      }

      if (isNewSearch) {
        setResults(searchResults);
      } else {
        setResults(prev => [...prev, ...searchResults]);
      }
      setPage(pageNum + 1);
      setHasMore(searchResults.length >= 20 || (pageNum < currentTotalPages));
    } catch (error) {
      console.error('Error searching:', error);
      setError(i18n.t('search.searchError'));
    } finally {
      setLoading(false);
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  };

  // Helper function to get people IDs for actors and directors from TMDB
  const getPeopleIds = async (directorName?: string, actorName?: string): Promise<string | undefined> => {
    if (!directorName && !actorName) return undefined;

    try {
      const peopleIds: number[] = [];

      // Search for director
      if (directorName) {
        const directorResponse = await axios.get(`https://api.themoviedb.org/3/search/person`, {
          params: {
            api_key: TMDB_API_KEY,
            query: directorName,
            language: getTmdbLanguage()
          }
        });

        const directors = directorResponse.data.results.filter((person: any) => {
          return person.known_for_department === 'Directing';
        });

        if (directors.length > 0) {
          peopleIds.push(directors[0].id);
        }
      }

      // Search for actor
      if (actorName) {
        const actorResponse = await axios.get(`https://api.themoviedb.org/3/search/person`, {
          params: {
            api_key: TMDB_API_KEY,
            query: actorName,
            language: getTmdbLanguage()
          }
        });

        const actors = actorResponse.data.results.filter((person: any) => {
          return person.known_for_department === 'Acting';
        });

        if (actors.length > 0) {
          peopleIds.push(actors[0].id);
        }
      }

      return peopleIds.length > 0 ? peopleIds.join('|') : undefined;
    } catch (error) {
      console.error('Error searching for people:', error);
      return undefined;
    }
  };

  const handleTypeChange = (newType: 'all' | 'movie' | 'tv') => {
    setSelectedType(newType);
    setPage(1); // Reset page when type changes
    // Reset existing IDs when type changes
    // Ne lance plus la recherche automatiquement
  };

  // Perf : les fetches genres/providers (4 requêtes TMDB) ne partent plus au boot
  // pour tous les visiteurs — ils sont déclenchés à la demande par la page Search
  // via ensureFiltersLoaded().
  const filtersRequestedRef = useRef(false);
  const [filtersRequested, setFiltersRequested] = useState(false);

  const ensureFiltersLoaded = useCallback(() => {
    if (!filtersRequestedRef.current) {
      filtersRequestedRef.current = true;
      setFiltersRequested(true);
    }
  }, []);

  useEffect(() => {
    if (!filtersRequested) return;

    const fetchGenres = async () => {
      setLoadingGenres(true);
      try {
        const [movieGenres, tvGenres] = await Promise.all([
          axios.get('https://api.themoviedb.org/3/genre/movie/list', {
            params: { api_key: TMDB_API_KEY, language: getTmdbLanguage() }
          }),
          axios.get('https://api.themoviedb.org/3/genre/tv/list', {
            params: { api_key: TMDB_API_KEY, language: getTmdbLanguage() }
          })
        ]);

        const excludedGenreIds = [
          99,
          10759,
          10762,
          10763,
          10764,
          10765,
          10766,
          10767,
          10768
        ];

        // Un genre exclu reste proposé s'il est déjà choisi (ex. « Action &
        // Aventure » d'une série, venu d'un lien de fiche).
        const keepTvGenre = (genre: Genre) =>
          !excludedGenreIds.includes(genre.id) || selectedGenresRef.current.includes(genre.id);

        let filteredGenres: Genre[];
        if (selectedType === 'movie') {
          filteredGenres = movieGenres.data.genres;
        } else if (selectedType === 'tv') {
          filteredGenres = tvGenres.data.genres.filter(keepTvGenre);
        } else {
          filteredGenres = Array.from(new Set([
            ...movieGenres.data.genres,
            ...tvGenres.data.genres.filter(keepTvGenre)
          ].map((genre) => JSON.stringify(genre))))
            .map((genre) => JSON.parse(genre));
        }

        // Remplacement des noms par les noms français
        setGenres(filteredGenres.map((genre: Genre) => ({
          ...genre,
          name: genre.name || GENRES_FR[genre.id] || ''
        })));
        // Garder les genres encore valables pour ce type au lieu de tout vider.
        const validIds = new Set(filteredGenres.map((genre) => genre.id));
        setSelectedGenres((prev) => prev.filter((id) => validIds.has(id)));
      } catch (error) {
        console.error('Error fetching genres:', error);
      } finally {
        setLoadingGenres(false);
      }
    };

    fetchGenres();
  }, [selectedType, filtersRequested]);

  // Fetch watch providers from TMDB — déclenché à la demande (perf)
  useEffect(() => {
    if (!filtersRequested) return;

    const fetchWatchProviders = async () => {
      setLoadingProviders(true);
      try {
        const [movieProviders, tvProviders] = await Promise.all([
          axios.get('https://api.themoviedb.org/3/watch/providers/movie', {
            params: { api_key: TMDB_API_KEY, watch_region: 'FR', language: getTmdbLanguage() }
          }),
          axios.get('https://api.themoviedb.org/3/watch/providers/tv', {
            params: { api_key: TMDB_API_KEY, watch_region: 'FR', language: getTmdbLanguage() }
          })
        ]);

        const providerMap = new Map<number, WatchProvider>();
        const addProviders = (results: any[]) => {
          for (const p of results) {
            if (!providerMap.has(p.provider_id)) {
              providerMap.set(p.provider_id, {
                provider_id: p.provider_id,
                provider_name: p.provider_name,
                logo_path: p.logo_path,
                display_priority: p.display_priorities?.FR ?? p.display_priority ?? 999,
              });
            }
          }
        };

        addProviders(movieProviders.data.results || []);
        addProviders(tvProviders.data.results || []);

        // Priorité manuelle : les plus connues en premier
        const PRIORITY_IDS = [
          8,    // Netflix
          119,  // Amazon Prime Video
          337,  // Disney+
          350,  // Apple TV+
          381,  // Canal+
          1899, // Max
          531,  // Paramount+
          283,  // Crunchyroll
          56,   // OCS
          467,  // ADN
          1716, // TF1+
          234,  // France TV
          324,  // Arte
          236,  // Canal+ Séries
          11,   // MUBI
          15,   // Hulu
          386,  // Peacock
          453,  // Discovery+
          35,   // Rakuten TV
          188,  // YouTube Premium
        ];

        const priorityIndex = new Map(PRIORITY_IDS.map((id, i) => [id, i]));

        const sorted = Array.from(providerMap.values())
          .sort((a, b) => {
            const aPri = priorityIndex.get(a.provider_id);
            const bPri = priorityIndex.get(b.provider_id);
            if (aPri !== undefined && bPri !== undefined) return aPri - bPri;
            if (aPri !== undefined) return -1;
            if (bPri !== undefined) return 1;
            return a.display_priority - b.display_priority;
          });

        setWatchProvidersList(sorted);
      } catch (error) {
        console.error('Error fetching watch providers:', error);
      } finally {
        setLoadingProviders(false);
      }
    };

    fetchWatchProviders();
  }, [filtersRequested]);

  const applyGenreFilter = (
    type: 'all' | 'movie' | 'tv',
    genreIds: number[],
    options: { language?: string; country?: string } = {},
  ) => {
    setQuery('');
    setMinRating(0);
    setDirector('');
    setActor('');
    setYear('');
    setSelectedKeywords([]);
    setSelectedLanguage(options.language ?? '');
    setSelectedCountry(options.country ?? '');
    setSelectedProviders([]);
    setSortBy('popularity.desc');
    setSelectedType(type);
    setSelectedGenres(genreIds);
    selectedGenresRef.current = genreIds;
    setShowFilters(true);
    setPage(1);
  };

  const toggleGenre = (genreId: number) => {
    setSelectedGenres(prev =>
      prev.includes(genreId)
        ? prev.filter(id => id !== genreId)
        : [...prev, genreId]
    );
    // Reset page and existingResultIds when genres change
    setPage(1);

  };

  // Reset page to 1 whenever any search filter changes.
  // Previously this was 7 separate useEffect hooks each calling setPage(1) on
  // a single dep — every keystroke fired both the setQuery render AND a second
  // render from the [query] effect's setPage call, doubling render work in the
  // hot path. Collapsed into one effect with a combined dep array so the same
  // commit triggers at most one extra setPage. — perf
  useEffect(() => {
    setPage(1);
  }, [minRating, query, selectedLanguage, selectedCountry, selectedProviders, sortBy, selectedKeywords, filterUnreleased, filterNoContent, filterLowVotes]);

  // Memoize the context value with state-only deps. The previous bare object
  // literal here meant every keystroke (which already setStates `query`) also
  // re-rendered Header — a top-level always-mounted consumer that rebuilds
  // i18n nav arrays each render — even though Header only reads `query`.
  // Worse, ANY parent re-render upstream cascaded into all consumers because
  // the value identity changed. The custom callbacks captured here close over
  // current state, so when state listed in deps changes we get a fresh value
  // with fresh closures; when only callback identities change (re-creation
  // each render) we keep the cached value, which is correct since those
  // callbacks would still see the same state. — perf
  const value = useMemo(() => ({
    query,
    setQuery,
    results,
    loading,
    error,
    genres,
    selectedGenres,
    toggleGenre,
    selectedType,
    setSelectedType: handleTypeChange,
    minRating,
    setMinRating,
    hasMore,
    page,
    setPage,
    performSearch,
    loadingGenres,
    showFilters,
    setShowFilters,
    isLoadingMore,
    totalPages,
    director,
    setDirector,
    actor,
    setActor,
    year,
    setYear,
    directorSuggestions,
    actorSuggestions,
    loadingSuggestions,
    fetchPeopleSuggestions,
    selectPerson,
    clearSuggestions,
    autocompleteSuggestions,
    loadingAutocomplete,
    fetchAutocompleteSuggestions,
    clearAutocompleteSuggestions,
    selectedKeywords,
    addKeyword,
    removeKeyword,
    clearKeywords,
    keywordSuggestions,
    loadingKeywordSuggestions,
    fetchKeywordSuggestions,
    clearKeywordSuggestions,
    selectedLanguage,
    setSelectedLanguage,
    selectedCountry,
    setSelectedCountry,
    selectedProviders,
    toggleProvider,
    clearProviders,
    watchProvidersList,
    loadingProviders,
    sortBy,
    setSortBy,
    filterUnreleased,
    setFilterUnreleased,
    filterNoContent,
    setFilterNoContent,
    filterLowVotes,
    setFilterLowVotes,
    ensureFiltersLoaded,
    applyGenreFilter,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [
    query, results, loading, error, genres, selectedGenres, selectedType,
    minRating, hasMore, page, loadingGenres, showFilters, isLoadingMore,
    totalPages, director, actor, year, directorSuggestions, actorSuggestions,
    loadingSuggestions, autocompleteSuggestions, loadingAutocomplete,
    selectedKeywords, keywordSuggestions, loadingKeywordSuggestions,
    selectedLanguage, selectedCountry, selectedProviders, watchProvidersList,
    loadingProviders, sortBy, filterUnreleased, filterNoContent, filterLowVotes
  ]);

  return (
    <SearchContext.Provider value={value}>
      {children}
    </SearchContext.Provider>
  );
};
