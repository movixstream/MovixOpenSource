import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Film, Search } from 'lucide-react';
import AddToListMenu from '../components/AddToListMenu';
import { getTmdbLanguage } from '../i18n';
import { SagaCard } from '@/components/sagas/SagaCard';
import {
  SAGA_GRID_CLASS,
  SAGA_LIST_CLASS,
  SagaGridSkeleton,
  SagaLoadingCell,
} from '@/components/sagas/SagaSkeletons';
import { SagaViewToggle } from '@/components/sagas/SagaViewToggle';
import { useCompactSagaActions } from '@/components/sagas/useCompactSagaActions';
import { useSagaLibrary } from '@/components/sagas/useSagaLibrary';
import type { SagaSummary, SagaViewMode } from '@/components/sagas/types';

interface Collection {
  id: number;
  name: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  parts: Array<{
    id: number;
    title: string;
    release_date: string;
    poster_path: string | null;
    vote_average?: number;
  }>;
}

// Ce que la page lit dans les réponses de TMDB.
type TmdbMovieRef = { id: number };
type TmdbCollectionPart = Collection['parts'][number] & { adult?: boolean; genre_ids?: number[] };
type TmdbCollectionData = Omit<Collection, 'parts'> & { parts?: TmdbCollectionPart[] };

const Collections: React.FC = () => {
  const { t } = useTranslation();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [filteredCollections, setFilteredCollections] = useState<Collection[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchLoading, setSearchLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState('');
  const [hasMoreCollections, setHasMoreCollections] = useState(true);
  const [currentPage, setCurrentPage] = useState(3); // Commence à 4 car on a déjà chargé les pages 1-3
  const [newCollectionIds, setNewCollectionIds] = useState<Set<number>>(new Set()); // Pour tracker les nouvelles collections
  const [displayMode, setDisplayMode] = useState<'cards' | 'list'>('cards'); // Mode par défaut

  // Optimisation des performances avec debounce pour les changements de mode
  const [debouncedDisplayMode, setDebouncedDisplayMode] = useState(displayMode);

  // États pour le menu d'ajout à une liste
  const [showAddToListMenu, setShowAddToListMenu] = useState(false);
  const [selectedCollection, setSelectedCollection] = useState<SagaSummary | null>(null);

  // Watchlist et favoris : lus dans le stockage dès le montage, donc justes
  // aussi pour les collections du cache et les résultats de recherche.
  const { watchlist, favorites, toggleWatchlist, toggleFavorite } = useSagaLibrary();
  const compactActions = useCompactSagaActions();

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebouncedDisplayMode(displayMode);
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [displayMode]);



  const API_KEY = import.meta.env.VITE_TMDB_API_KEY || '';
  const BASE_URL = 'https://api.themoviedb.org/3';

  // Clés de cache pour le sessionStorage
  const CACHE_KEYS = {
    collections: 'tmdb_collections_cache',
    cacheTime: 'tmdb_collections_cache_time',
    lastPage: 'tmdb_collections_last_page',
    loadMoreDebounce: 'lastLoadMoreCall'
  };

  // Récupérer les films/séries populaires et extraire les collections
  useEffect(() => {
    const fetchPopularContentAndCollections = async () => {
      try {
        setLoading(true);

        // Vérifier la dernière page découverte dans le cache
        const cachedLastPage = sessionStorage.getItem(CACHE_KEYS.lastPage);
        const lastPage = cachedLastPage ? parseInt(cachedLastPage) : 3;

        // Réinitialiser l'état d'infinity scroll
        setHasMoreCollections(true);
        setCurrentPage(lastPage);
        setNewCollectionIds(new Set());

        // Vérifier le cache de session
        const cacheExpiration = 24 * 60 * 60 * 1000; // 24 heures

        const cachedData = sessionStorage.getItem(CACHE_KEYS.collections);
        const cacheTime = sessionStorage.getItem(CACHE_KEYS.cacheTime);

        if (cachedData && cacheTime) {
          const timeDiff = Date.now() - parseInt(cacheTime);
          if (timeDiff < cacheExpiration) {
            console.log('Utilisation du cache pour les collections');
            const cachedCollections = JSON.parse(cachedData);
            setCollections(cachedCollections);
            setFilteredCollections(cachedCollections);
            // Réinitialiser l'infinity scroll même avec le cache
            setHasMoreCollections(true);
            setCurrentPage(lastPage);
            setNewCollectionIds(new Set());
            setLoading(false);
            return;
          }
        }

        console.log('Récupération des collections depuis l\'API...');
        setLoadingProgress(t('collections.loadingPopularMovies'));
        const collectionsMap = new Map<number, Collection>();

        // Fonction pour traiter les films d'une page
        const processMoviesFromPage = async (page: number) => {
          const moviesResponse = await fetch(
            `${BASE_URL}/discover/movie?api_key=${API_KEY}&sort_by=popularity.desc&page=${page}&include_adult=false&language=${getTmdbLanguage()}&vote_count.gte=1000&vote_average.gte=6.0&with_original_language=en`
          );
          const moviesData = await moviesResponse.json();

          // Traiter les films par lots pour éviter trop de requêtes simultanées
          const batchSize = 5;
          for (let i = 0; i < moviesData.results.length; i += batchSize) {
            const batch = moviesData.results.slice(i, i + batchSize);

            await Promise.all(batch.map(async (movie: TmdbMovieRef) => {
              try {
                const movieDetailResponse = await fetch(
                  `${BASE_URL}/movie/${movie.id}?api_key=${API_KEY}&language=${getTmdbLanguage()}`
                );
                const movieDetail = await movieDetailResponse.json();

                if (movieDetail.belongs_to_collection && !collectionsMap.has(movieDetail.belongs_to_collection.id)) {
                  const collectionId = movieDetail.belongs_to_collection.id;

                  try {
                    const collectionResponse = await fetch(
                      `${BASE_URL}/collection/${collectionId}?api_key=${API_KEY}&language=${getTmdbLanguage()}`
                    );
                    const collectionData = await collectionResponse.json();

                    // Ne garder que les collections avec au moins 2 films, des images et pas de contenu adulte
                    const adultKeywords = ['365', 'fifty shades', 'nymphomaniac', 'love', 'erotic', 'sex', 'adult', 'xxx'];
                    const isAdultCollection = (collection: TmdbCollectionData) => {
                      const name = collection.name.toLowerCase();
                      const overview = (collection.overview || '').toLowerCase();
                      return adultKeywords.some(keyword =>
                        name.includes(keyword) || overview.includes(keyword)
                      ) || collection.parts?.some((movie) => movie.adult === true);
                    };

                    if (collectionData.parts &&
                        collectionData.parts.length >= 2 &&
                        (collectionData.backdrop_path || collectionData.poster_path) &&
                        !isAdultCollection(collectionData)) {
                      // Filtrer les films avec des images pour le comptage correct
                      const moviesWithImages = collectionData.parts.filter((movie: TmdbCollectionPart) => movie.poster_path);
                      if (moviesWithImages.length >= 2) {
                        collectionsMap.set(collectionId, {
                          ...collectionData,
                          parts: collectionData.parts // Garder tous les films pour l'instant
                        });
                      }
                    }
                  } catch (error) {
                    console.error(`Erreur lors de la récupération de la collection ${collectionId}:`, error);
                  }
                }
              } catch (error) {
                console.error(`Erreur lors de la récupération des détails du film ${movie.id}:`, error);
              }
            }));

            // Petite pause entre les lots pour éviter de surcharger l'API
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        };

        // Récupérer plusieurs pages pour avoir plus de collections
        await Promise.all([
          processMoviesFromPage(1),
          processMoviesFromPage(2),
          processMoviesFromPage(3)
        ]);

        setLoadingProgress(t('collections.addingPopularCollections'));
        // Ajouter quelques collections populaires manuellement si on en a pas assez
        const popularCollectionIds = [
          10, // Star Wars Collection
          1241, // Harry Potter Collection
          531241, // Spider-Man (Avengers) Collection
          623, // X-Men Collection
          2344, // The Matrix Collection
          8091, // Alien Collection
          8250, // Fast & Furious Collection
          9485, // The Fast and the Furious Collection
          86311, // The Avengers Collection
          131295, // Iron Man Collection
          131296, // Thor Collection
          131292, // Captain America Collection
          748, // The Lord of the Rings Collection
          121938, // The Hobbit Collection
          1570, // Die Hard Collection
          528, // The Terminator Collection
          945, // Jurassic Park Collection
          295, // Pirates of the Caribbean Collection
          87359, // Mission: Impossible Collection
          8917 // Shrek Collection
        ];

        // Ajouter les collections populaires manquantes
        for (const collectionId of popularCollectionIds) {
          if (!collectionsMap.has(collectionId)) {
            try {
              const collectionResponse = await fetch(
                `${BASE_URL}/collection/${collectionId}?api_key=${API_KEY}&language=${getTmdbLanguage()}`
              );
              if (collectionResponse.ok) {
                const collectionData = await collectionResponse.json();
                const adultKeywords = ['365', 'fifty shades', 'nymphomaniac', 'love', 'erotic', 'sex', 'adult', 'xxx'];
                const isAdultCollection = (collection: TmdbCollectionData) => {
                  const name = collection.name.toLowerCase();
                  const overview = (collection.overview || '').toLowerCase();
                  return adultKeywords.some(keyword =>
                    name.includes(keyword) || overview.includes(keyword)
                  ) || collection.parts?.some((movie) => movie.adult === true);
                };

                if (collectionData.parts &&
                    collectionData.parts.length >= 2 &&
                    (collectionData.backdrop_path || collectionData.poster_path) &&
                    !isAdultCollection(collectionData)) {
                  const moviesWithImages = collectionData.parts.filter((movie: TmdbCollectionPart) => movie.poster_path);
                  if (moviesWithImages.length >= 2) {
                    collectionsMap.set(collectionId, collectionData);
                  }
                }
              }
            } catch (error) {
              console.error(`Erreur lors de la récupération de la collection populaire ${collectionId}:`, error);
            }
          }
        }

        setLoadingProgress(t('collections.finalizing'));
        // Trier les collections par popularité (nombre de films et note moyenne)
        const sortedCollections = Array.from(collectionsMap.values()).sort((a, b) => {
          const scoreA = a.parts.length * (a.parts.reduce((sum, movie) => sum + (movie.vote_average || 0), 0) / a.parts.length || 0);
          const scoreB = b.parts.length * (b.parts.reduce((sum, movie) => sum + (movie.vote_average || 0), 0) / b.parts.length || 0);
          return scoreB - scoreA;
        });

        setCollections(sortedCollections);
        setFilteredCollections(sortedCollections);
        console.log(`${sortedCollections.length} collections récupérées`);

        // Sauvegarder dans le cache de session
        sessionStorage.setItem(CACHE_KEYS.collections, JSON.stringify(sortedCollections));
        sessionStorage.setItem(CACHE_KEYS.cacheTime, Date.now().toString());

      } catch (error) {
        console.error('Erreur lors de la récupération des données:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchPopularContentAndCollections();
  }, [API_KEY]);

  // Fonction pour charger plus de collections
  const loadMoreCollections = async () => {
    if (loadingMore || !hasMoreCollections) {
      return;
    }

    // Débounce pour éviter les appels trop fréquents
    const now = Date.now();
    const lastCall = parseInt(sessionStorage.getItem(CACHE_KEYS.loadMoreDebounce) || '0');
    if (now - lastCall < 2000) { // Minimum 2 secondes entre les appels
      return;
    }
    sessionStorage.setItem(CACHE_KEYS.loadMoreDebounce, now.toString());

    setLoadingMore(true);
    try {
      const nextPage = currentPage + 1;
      const collectionsMap = new Map<number, Collection>();

      // Ajouter les collections existantes dans la map
      collections.forEach(collection => {
        collectionsMap.set(collection.id, collection);
      });

      // Liste des mots-clés pour filtrer le contenu adulte
      const adultKeywords = ['365', 'fifty shades', 'nymphomaniac', 'love', 'erotic', 'sex', 'adult', 'xxx'];

      // Fonction pour vérifier si une collection est pour adultes
      const isAdultCollection = (collection: TmdbCollectionData) => {
        const name = collection.name.toLowerCase();
        const overview = (collection.overview || '').toLowerCase();
        return adultKeywords.some(keyword =>
          name.includes(keyword) || overview.includes(keyword)
        ) || collection.parts?.some((movie) =>
          movie.adult === true ||
          (movie.genre_ids && movie.genre_ids.includes(18)) // Genre documentaire parfois utilisé pour contenu adulte
        );
      };

      // Fonction pour traiter les films d'une page
      const processMoviesFromPage = async (page: number) => {
        const moviesResponse = await fetch(
          `${BASE_URL}/discover/movie?api_key=${API_KEY}&sort_by=popularity.desc&page=${page}&include_adult=false&language=${getTmdbLanguage()}&vote_count.gte=1000&vote_average.gte=6.0&with_original_language=en`
        );
        const moviesData = await moviesResponse.json();

        if (!moviesData.results || moviesData.results.length === 0) {
          setHasMoreCollections(false);
          return;
        }

        // Traiter les films par lots pour éviter trop de requêtes simultanées
        const batchSize = 3; // Réduire la taille du lot pour aller plus vite
        for (let i = 0; i < moviesData.results.length; i += batchSize) {
          const batch = moviesData.results.slice(i, i + batchSize);

          await Promise.all(batch.map(async (movie: TmdbMovieRef) => {
            try {
              const movieDetailResponse = await fetch(
                `${BASE_URL}/movie/${movie.id}?api_key=${API_KEY}&language=${getTmdbLanguage()}`
              );
              const movieDetail = await movieDetailResponse.json();

              if (movieDetail.belongs_to_collection && !collectionsMap.has(movieDetail.belongs_to_collection.id)) {
                const collectionId = movieDetail.belongs_to_collection.id;

                try {
                  const collectionResponse = await fetch(
                    `${BASE_URL}/collection/${collectionId}?api_key=${API_KEY}&language=${getTmdbLanguage()}`
                  );
                  const collectionData = await collectionResponse.json();

                  // Ne garder que les collections avec au moins 2 films, des images et pas de contenu adulte
                  if (collectionData.parts &&
                      collectionData.parts.length >= 2 &&
                      (collectionData.backdrop_path || collectionData.poster_path) &&
                      !isAdultCollection(collectionData)) {
                    // Filtrer les films avec des images pour le comptage correct
                    const moviesWithImages = collectionData.parts.filter((movie: TmdbCollectionPart) => movie.poster_path);
                    if (moviesWithImages.length >= 2) {
                      collectionsMap.set(collectionId, collectionData);
                    }
                  }
                } catch (error) {
                  console.error(`Erreur lors de la récupération de la collection ${collectionId}:`, error);
                }
              }
            } catch (error) {
              console.error(`Erreur lors de la récupération des détails du film ${movie.id}:`, error);
            }
          }));

          // Petite pause entre les lots
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      };

      // Charger 2 pages supplémentaires
      await Promise.all([
        processMoviesFromPage(nextPage),
        processMoviesFromPage(nextPage + 1)
      ]);

      // Conserver l'ordre existant et ajouter les nouveaux à la fin
      const existingCollectionIds = new Set(collections.map(c => c.id));
      const newCollections = Array.from(collectionsMap.values()).filter(c => !existingCollectionIds.has(c.id));

      // Trier seulement les nouvelles collections
      newCollections.sort((a, b) => {
        const scoreA = a.parts.length * (a.parts.reduce((sum, movie) => sum + (movie.vote_average || 0), 0) / a.parts.length || 0);
        const scoreB = b.parts.length * (b.parts.reduce((sum, movie) => sum + (movie.vote_average || 0), 0) / b.parts.length || 0);
        return scoreB - scoreA;
      });

      // Tracker les IDs des nouvelles collections pour les animations
      const newIds = new Set(newCollections.map(c => c.id));
      setNewCollectionIds(newIds);

      // Ajouter les nouvelles collections à la fin
      const allCollections = [...collections, ...newCollections];

      setCollections(allCollections);
      setFilteredCollections(allCollections);

      // Effacer les nouvelles IDs après un délai pour les futures animations
      setTimeout(() => {
        setNewCollectionIds(new Set());
      }, 2000);
      setCurrentPage(nextPage + 1);

      // Mettre à jour le cache de session
      sessionStorage.setItem(CACHE_KEYS.collections, JSON.stringify(allCollections));
      sessionStorage.setItem(CACHE_KEYS.cacheTime, Date.now().toString());
      sessionStorage.setItem(CACHE_KEYS.lastPage, nextPage.toString());

      const newCollectionCount = allCollections.length - collections.length;
      console.log(`${allCollections.length} collections au total (${newCollectionCount} nouvelles)`);

      // Si on n'a trouvé aucune nouvelle collection sur plusieurs pages, on arrête
      if (newCollectionCount === 0) {
        setHasMoreCollections(false);
        console.log('Aucune nouvelle collection trouvée, arrêt du chargement');
      } else {
        // Continuer à chercher plus de collections
        setHasMoreCollections(true);
      }

    } catch (error) {
      console.error('Erreur lors du chargement de collections supplémentaires:', error);
    } finally {
      setLoadingMore(false);
    }
  };

  // Fonctions pour gérer l'ajout à une liste
  const openAddToListMenu = useCallback((collection: SagaSummary) => {
    setSelectedCollection(collection);
    setShowAddToListMenu(true);
  }, []);

  const closeAddToListMenu = () => {
    setShowAddToListMenu(false);
    setSelectedCollection(null);
  };

  // Recherche de collections
  const handleSearch = async (query: string) => {
    if (query.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    setSearchLoading(true);
    try {
      const response = await fetch(
        `${BASE_URL}/search/collection?api_key=${API_KEY}&query=${encodeURIComponent(query)}&language=${getTmdbLanguage()}`
      );
      const data = await response.json();

      // Récupérer les détails complets de chaque collection trouvée
      const detailedResults = await Promise.all(
        (data.results || []).map(async (collection: TmdbMovieRef) => {
          try {
            const detailResponse = await fetch(
              `${BASE_URL}/collection/${collection.id}?api_key=${API_KEY}&language=${getTmdbLanguage()}`
            );
            if (detailResponse.ok) {
              const detailData = await detailResponse.json();
              // Filtrer seulement si on a des images et au moins 2 films avec images
              if ((detailData.backdrop_path || detailData.poster_path) &&
                  detailData.parts &&
                  detailData.parts.filter((movie: TmdbCollectionPart) => movie.poster_path).length >= 2) {
                return detailData;
              }
            }
            return null;
          } catch (error) {
            console.error(`Erreur lors de la récupération des détails de la collection ${collection.id}:`, error);
            return null;
          }
        })
      );

      // Filtrer les résultats null et trier
      const validResults = detailedResults.filter(result => result !== null);
      setSearchResults(validResults);
    } catch (error) {
      console.error('Erreur lors de la recherche de collections:', error);
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  };

  // Debounce pour la recherche
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      handleSearch(searchQuery);
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchQuery, API_KEY]);

  // Logique de filtrage des collections simplifiée
  useEffect(() => {
    // Afficher toutes les collections dans l'ordre de chargement
    setFilteredCollections(collections);
  }, [collections, searchQuery]);

  // Effet pour l'infinity scroll avec Intersection Observer
  useEffect(() => {
    if (searchQuery || loadingMore) return;

    // Utiliser l'Intersection Observer classique pour tous les modes
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting && !loadingMore && hasMoreCollections) {
          loadMoreCollections();
        }
      },
      {
        rootMargin: '300px',
        threshold: 0.1
      }
    );

    // Créer un élément déclencheur invisible
    const triggerElement = document.getElementById('infinity-scroll-trigger');
    if (triggerElement) {
      observer.observe(triggerElement);
    }

    return () => {
      if (triggerElement) {
        observer.unobserve(triggerElement);
      }
      observer.disconnect();
    };
  }, [searchQuery, loadingMore, hasMoreCollections, loadMoreCollections]);

  const viewMode: SagaViewMode = debouncedDisplayMode === 'list' ? 'list' : 'grid';
  const showLoadingCell = loadingMore && hasMoreCollections;

  // Mêmes cartes pour les collections populaires et pour la recherche ; seule
  // la liste populaire met sa première collection en grand.
  const renderCollections = (list: Collection[], popular: boolean) => (
    <div className={viewMode === 'list' ? SAGA_LIST_CLASS : SAGA_GRID_CLASS}>
      {list.map((collection, index) => (
        <SagaCard
          key={collection.id}
          saga={collection}
          variant={viewMode === 'list' ? 'list' : popular && index === 0 ? 'featured' : 'grid'}
          inWatchlist={watchlist.has(collection.id)}
          isFavorite={favorites.has(collection.id)}
          onToggleWatchlist={toggleWatchlist}
          onToggleFavorite={toggleFavorite}
          onAddToList={openAddToListMenu}
          compactActions={compactActions}
          isNew={popular && newCollectionIds.has(collection.id)}
        />
      ))}
      {popular && showLoadingCell && (
        <SagaLoadingCell mode={viewMode} label={t('collections.discovering')} />
      )}
    </div>
  );

  return (
    // `data-square-bg` : le thème Halloween rend ce fond transparent pour
    // laisser voir son décor, comme sur les autres pages.
    <div data-square-bg="" className="min-h-screen bg-black pb-10 text-white md:pb-24">
      <div className="mx-auto max-w-[1920px] px-3 sm:px-6 md:px-12 lg:px-20">
        {/* Titre, recherche et bascule d'affichage */}
        <div className="pb-[18px] pt-1 md:flex md:flex-wrap md:items-end md:justify-between md:gap-x-10 md:gap-y-7 md:pb-9 md:pt-5 lg:pt-10">
          <div>
            <h1 className="text-[46px] font-extrabold leading-none tracking-[-0.035em] md:text-[length:clamp(48px,5.4vw,84px)]">
              {t('collections.title')}
            </h1>
            <p className="mt-2.5 text-[15px] leading-normal text-white/70 md:mt-3.5 md:max-w-[44ch] md:text-[18px] 2xl:text-[20px]">
              {t('collections.tagline')}
            </p>
          </div>
          <div className="mt-[18px] flex items-center gap-2.5 md:mt-0 md:gap-3">
            <label className="relative block min-w-0 flex-1 md:w-[340px] md:max-w-[56vw] md:flex-none">
              <Search
                className="pointer-events-none absolute left-[15px] top-[14px] h-5 w-5 text-white opacity-60 md:left-4"
                aria-hidden="true"
              />
              <input
                type="text"
                enterKeyHint="search"
                placeholder={t('collections.searchPlaceholder')}
                aria-label={t('collections.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-12 w-full rounded-[14px] border border-white/[0.18] bg-white/5 pl-11 pr-3 text-[15px] text-white outline-none transition-colors duration-200 placeholder:text-white/50 hover:border-white/30 focus-visible:border-white/70 motion-reduce:transition-none md:pl-[46px] md:pr-3.5"
              />
            </label>
            <SagaViewToggle
              size="lg"
              value={displayMode === 'list' ? 'list' : 'grid'}
              onChange={(mode) => setDisplayMode(mode === 'list' ? 'list' : 'cards')}
            />
          </div>
        </div>

        {/* Résultats de recherche */}
        {searchQuery && (
          <section aria-busy={searchLoading}>
            <h2 className="mb-4 text-xl font-bold leading-tight tracking-[-0.01em] md:mb-5 md:text-2xl">
              {t('collections.searchResultsTitle')}
            </h2>
            {searchResults.length > 0 ? (
              renderCollections(searchResults, false)
            ) : searchLoading ? (
              <SagaGridSkeleton mode={viewMode} count={6} compactActions={compactActions} />
            ) : searchQuery.length >= 2 ? (
              <div className="py-12 text-center text-white/60">
                <Search className="mx-auto mb-4 h-12 w-12 text-white opacity-40" aria-hidden="true" />
                <p>{t('collections.noSearchResults', { query: searchQuery })}</p>
              </div>
            ) : null}
          </section>
        )}

        {/* Collections populaires */}
        {!searchQuery && (
          <section id="collections-grid" aria-busy={loading}>
            {loading ? (
              <>
                {/* Les étapes du premier chargement restent annoncées. */}
                <div role="status" className="mb-5 text-[14px] leading-normal text-white/60">
                  <p className="font-medium text-white/85">
                    {loadingProgress || t('collections.loadingCollections')}
                  </p>
                  <p className="mt-1 max-w-[60ch]">{t('collections.firstVisitMessage')}</p>
                </div>
                <SagaGridSkeleton mode={viewMode} featured compactActions={compactActions} />
              </>
            ) : filteredCollections.length > 0 ? (
              <>
                {renderCollections(filteredCollections, true)}

                <p className="mt-7 text-center text-[13px] leading-normal text-white/55 md:mt-9 md:text-[14px]">
                  {t('collections.shownCount', { count: filteredCollections.length })}
                  {hasMoreCollections && ` ${t('collections.moreOnScroll')}`}
                </p>

                {/* Élément déclencheur invisible pour l'Intersection Observer */}
                <div id="infinity-scroll-trigger" className="h-4" />
              </>
            ) : (
              <div className="py-12 text-center text-white/60">
                <Film className="mx-auto mb-4 h-12 w-12 text-white opacity-40" aria-hidden="true" />
                <p>{t('collections.noCollectionsAvailable')}</p>
              </div>
            )}
          </section>
        )}
      </div>

      {/* Menu d'ajout à une liste */}
      {showAddToListMenu && selectedCollection && (
        <AddToListMenu
          mediaId={selectedCollection.id}
          mediaType="collection"
          title={selectedCollection.name}
          posterPath={selectedCollection.poster_path || ''}
          movieCount={selectedCollection.parts?.length || 0}
          onClose={closeAddToListMenu}
        />
      )}
    </div>
  );
};

export default Collections;
