import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { Film, ArrowLeft, ChevronRight, Eye, EyeOff } from 'lucide-react';
import AddToListMenu from '../components/AddToListMenu';
import { getTmdbLanguage } from '../i18n';
import { useAgeRestrictedContent } from '../hooks/useAgeRestrictedContent';
import { useSagaProgress } from '@/hooks/useSagaProgress';
import { useMediaQuery } from '@/components/cinegraph/useMediaQuery';
import { cn } from '@/lib/utils';
import { encodeId } from '@/utils/idEncoder';
import { SagaCard } from '@/components/sagas/SagaCard';
import { SagaFilms } from '@/components/sagas/SagaFilms';
import { SagaHero, type SagaHeroCta } from '@/components/sagas/SagaHero';
import { SagaProduction } from '@/components/sagas/SagaProduction';
import { SagaSection } from '@/components/sagas/SagaSection';
import { SagaDetailSkeleton } from '@/components/sagas/SagaSkeletons';
import { SagaStats } from '@/components/sagas/SagaStats';
import { SagaViewToggle } from '@/components/sagas/SagaViewToggle';
import { getSagaYears, hasProductionData } from '@/components/sagas/sagaFormat';
import { useCompactSagaActions } from '@/components/sagas/useCompactSagaActions';
import { useSagaLibrary } from '@/components/sagas/useSagaLibrary';
import type { SagaSummary, SagaViewMode } from '@/components/sagas/types';

interface Movie {
  id: number;
  title: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string;
  vote_average: number;
  budget?: number;
  revenue?: number;
  runtime?: number;
  production_companies?: { id: number; name: string; logo_path: string | null }[];
  production_countries?: { iso_3166_1: string; name: string }[];
  spoken_languages?: { iso_639_1: string; name: string }[];
  genres?: { id: number; name: string }[];
}

interface Collection {
  id: number;
  name: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  parts: Movie[];
}

interface SimilarCollection {
  id: number;
  name: string;
  poster_path: string | null;
  backdrop_path: string | null;
  overview: string;
  parts: Movie[];
}

interface CollectionStats {
  totalBudget: number;
  totalRevenue: number;
  averageRating: number;
  totalRuntime: number;
  totalMovies: number;
  ratedMovies: number;
  averageBudget: number;
  averageRevenue: number;
  profitMargin: number;
}

interface ProductionInfo {
  productionCompanies: { id: number; name: string; count: number }[];
  productionCountries: { code: string; name: string; count: number }[];
  spokenLanguages: { code: string; name: string; count: number }[];
  genres: { id: number; name: string; count: number }[];
}

// Sous `md`, la liste numérotée est la vue par défaut ; au-dessus, la grille.
const WIDE_QUERY = '(min-width: 768px)';
const getDefaultViewMode = (): SagaViewMode =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && !window.matchMedia(WIDE_QUERY).matches
    ? 'list'
    : 'grid';

const CollectionDetails: React.FC = () => {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const [collection, setCollection] = useState<Collection | null>(null);
  const [similarCollections, setSimilarCollections] = useState<SimilarCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingSimilar, setLoadingSimilar] = useState(false);
  const [error, setError] = useState(false);
  const [viewMode, setViewMode] = useState<SagaViewMode>(getDefaultViewMode);
  const [showMoviesWithoutImages, setShowMoviesWithoutImages] = useState(false);

  // Nouveaux états pour les informations détaillées
  const [collectionStats, setCollectionStats] = useState<CollectionStats | null>(null);
  const [productionInfo, setProductionInfo] = useState<ProductionInfo | null>(null);

  const [detailedMovies, setDetailedMovies] = useState<Movie[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Nouveaux états pour les listes
  const [showAddToListMenu, setShowAddToListMenu] = useState(false);
  const [selectedCollection, setSelectedCollection] = useState<SagaSummary | null>(null);

  // Watchlist et favoris, pour cette collection comme pour les similaires :
  // lus dans le stockage dès le montage.
  const { watchlist, favorites, toggleWatchlist: toggleSagaWatchlist, toggleFavorite: toggleSagaFavorite } = useSagaLibrary();
  const compactActions = useCompactSagaActions();
  const isWide = useMediaQuery(WIDE_QUERY);

  const API_KEY = import.meta.env.VITE_TMDB_API_KEY || '';
  const BASE_URL = 'https://api.themoviedb.org/3';

  // Tableau stable : le filtre d'âge relance sa vérification, et rend une
  // nouvelle liste, quand celle qu'il reçoit change d'identité.
  const collectionParts = useMemo(
    () => (collection?.parts || []).map((movie) => ({ ...movie, media_type: 'movie' as const })),
    [collection],
  );
  const { items: ageAllowedCollectionMovies, isFiltering: isFilteringCollectionMoviesByAge } = useAgeRestrictedContent(collectionParts);

  // Trier les films par date de sortie et filtrer selon les préférences
  const allMovies = useMemo(
    () => [...ageAllowedCollectionMovies].sort((a, b) =>
      new Date(a.release_date || '1900-01-01').getTime() - new Date(b.release_date || '1900-01-01').getTime()
    ),
    [ageAllowedCollectionMovies],
  );
  const moviesWithImages = useMemo(() => allMovies.filter(movie => movie.poster_path), [allMovies]);
  const moviesWithoutImagesCount = allMovies.length - moviesWithImages.length;
  const displayedMovies = showMoviesWithoutImages ? allMovies : moviesWithImages;

  // Durée de chaque film, connue une fois son détail chargé.
  const runtimeById = useMemo(
    () => new Map(detailedMovies.map((movie) => [movie.id, movie.runtime])),
    [detailedMovies],
  );
  const displayedFilms = useMemo(
    () => displayedMovies.map((movie) => ({ ...movie, runtime: runtimeById.get(movie.id) })),
    [displayedMovies, runtimeById],
  );

  // Avancement : les films réellement affichés, dans l'ordre de la collection.
  const movieIds = useMemo(() => displayedMovies.map((movie) => movie.id), [displayedMovies]);
  const progress = useSagaProgress(movieIds);

  // Fonction pour récupérer les détails complets des films
  const fetchDetailedMovies = async (movies: Movie[]) => {
    setLoadingDetails(true);
    try {
      const detailedMoviesData: Movie[] = [];

      // Récupérer les détails de chaque film par lots pour éviter trop de requêtes
      const batchSize = 5;
      for (let i = 0; i < movies.length; i += batchSize) {
        const batch = movies.slice(i, i + batchSize);

        await Promise.all(batch.map(async (movie) => {
          try {
            const response = await fetch(
              `${BASE_URL}/movie/${movie.id}?api_key=${API_KEY}&language=${getTmdbLanguage()}&append_to_response=credits`
            );

            if (response.ok) {
              const movieDetails = await response.json();
              detailedMoviesData.push({
                ...movie,
                budget: movieDetails.budget,
                revenue: movieDetails.revenue,
                runtime: movieDetails.runtime,
                production_companies: movieDetails.production_companies,
                production_countries: movieDetails.production_countries,
                spoken_languages: movieDetails.spoken_languages,
                genres: movieDetails.genres
              });
            } else {
              detailedMoviesData.push(movie);
            }
          } catch (error) {
            console.error(`Erreur lors de la récupération des détails du film ${movie.id}:`, error);
            detailedMoviesData.push(movie);
          }
        }));
      }

      setDetailedMovies(detailedMoviesData);

      // Calculer les statistiques
      calculateCollectionStats(detailedMoviesData);
      calculateProductionInfo(detailedMoviesData);

    } catch (error) {
      console.error('Erreur lors de la récupération des détails des films:', error);
    } finally {
      setLoadingDetails(false);
    }
  };

  // Fonction pour calculer les statistiques de la collection
  const calculateCollectionStats = (movies: Movie[]) => {
    const moviesWithData = movies.filter(movie => movie.budget !== undefined || movie.revenue !== undefined);

    const totalBudget = moviesWithData.reduce((sum, movie) => sum + (movie.budget || 0), 0);
    const totalRevenue = moviesWithData.reduce((sum, movie) => sum + (movie.revenue || 0), 0);
    const totalRuntime = movies.reduce((sum, movie) => sum + (movie.runtime || 0), 0);

    // Une moyenne ne compte que les films qui ont la donnée : un film pas
    // encore sorti (note, budget et recettes à 0) ne doit pas la tirer vers le bas.
    const ratedMovies = movies.filter(movie => movie.vote_average > 0);
    const totalRating = ratedMovies.reduce((sum, movie) => sum + movie.vote_average, 0);
    const moviesWithBudget = moviesWithData.filter(movie => (movie.budget || 0) > 0).length;
    const moviesWithRevenue = moviesWithData.filter(movie => (movie.revenue || 0) > 0).length;

    const stats: CollectionStats = {
      totalBudget,
      totalRevenue,
      averageRating: ratedMovies.length > 0 ? totalRating / ratedMovies.length : 0,
      totalRuntime,
      totalMovies: movies.length,
      ratedMovies: ratedMovies.length,
      averageBudget: moviesWithBudget > 0 ? totalBudget / moviesWithBudget : 0,
      averageRevenue: moviesWithRevenue > 0 ? totalRevenue / moviesWithRevenue : 0,
      profitMargin: totalBudget > 0 ? ((totalRevenue - totalBudget) / totalBudget) * 100 : 0
    };

    setCollectionStats(stats);
  };

  // Fonction pour calculer les informations de production
  const calculateProductionInfo = (movies: Movie[]) => {
    const companiesMap = new Map<number, { id: number; name: string; count: number }>();
    const countriesMap = new Map<string, { code: string; name: string; count: number }>();
    const languagesMap = new Map<string, { code: string; name: string; count: number }>();
    const genresMap = new Map<number, { id: number; name: string; count: number }>();

    movies.forEach(movie => {
      // Compter les sociétés de production
      movie.production_companies?.forEach(company => {
        const existing = companiesMap.get(company.id);
        if (existing) {
          existing.count++;
        } else {
          companiesMap.set(company.id, { id: company.id, name: company.name, count: 1 });
        }
      });

      // Compter les pays de production
      movie.production_countries?.forEach(country => {
        const existing = countriesMap.get(country.iso_3166_1);
        if (existing) {
          existing.count++;
        } else {
          countriesMap.set(country.iso_3166_1, { code: country.iso_3166_1, name: country.name, count: 1 });
        }
      });

      // Compter les langues
      movie.spoken_languages?.forEach(language => {
        const existing = languagesMap.get(language.iso_639_1);
        if (existing) {
          existing.count++;
        } else {
          languagesMap.set(language.iso_639_1, { code: language.iso_639_1, name: language.name, count: 1 });
        }
      });

      // Compter les genres
      movie.genres?.forEach(genre => {
        const existing = genresMap.get(genre.id);
        if (existing) {
          existing.count++;
        } else {
          genresMap.set(genre.id, { id: genre.id, name: genre.name, count: 1 });
        }
      });
    });

    const productionInfo: ProductionInfo = {
      productionCompanies: Array.from(companiesMap.values()).sort((a, b) => b.count - a.count).slice(0, 10),
      productionCountries: Array.from(countriesMap.values()).sort((a, b) => b.count - a.count),
      spokenLanguages: Array.from(languagesMap.values()).sort((a, b) => b.count - a.count),
      genres: Array.from(genresMap.values()).sort((a, b) => b.count - a.count).slice(0, 10)
    };

    setProductionInfo(productionInfo);
  };

  // Fonction pour récupérer les collections similaires
  const fetchSimilarCollections = async (movies: Movie[]) => {
    if (movies.length === 0) return;

    setLoadingSimilar(true);
    try {
      const similarCollectionsSet = new Set<number>();
      const similarCollectionsData: SimilarCollection[] = [];

      // Prendre les 3 premiers films de la collection pour chercher des films similaires
      const moviesToCheck = movies.slice(0, 3);

      for (const movie of moviesToCheck) {
        // Récupérer les films similaires
        const similarResponse = await fetch(
          `${BASE_URL}/movie/${movie.id}/similar?api_key=${API_KEY}&language=${getTmdbLanguage()}&page=1`
        );

        if (similarResponse.ok) {
          const similarData = await similarResponse.json();
          const similarMovies = similarData.results.slice(0, 5); // Prendre les 5 premiers

          // Pour chaque film similaire, vérifier s'il appartient à une collection
          for (const similarMovie of similarMovies) {
            const movieDetailsResponse = await fetch(
              `${BASE_URL}/movie/${similarMovie.id}?api_key=${API_KEY}&language=${getTmdbLanguage()}`
            );

            if (movieDetailsResponse.ok) {
              const movieDetails = await movieDetailsResponse.json();

              // Si le film appartient à une collection et que ce n'est pas la collection actuelle
              if (movieDetails.belongs_to_collection &&
                  movieDetails.belongs_to_collection.id !== parseInt(id || '0') &&
                  !similarCollectionsSet.has(movieDetails.belongs_to_collection.id)) {

                similarCollectionsSet.add(movieDetails.belongs_to_collection.id);

                // Récupérer les détails de la collection
                const collectionResponse = await fetch(
                  `${BASE_URL}/collection/${movieDetails.belongs_to_collection.id}?api_key=${API_KEY}&language=${getTmdbLanguage()}`
                );

                if (collectionResponse.ok) {
                  const collectionData = await collectionResponse.json();
                  similarCollectionsData.push(collectionData);
                }
              }
            }
          }
        }
      }

      // Limiter à 6 collections similaires maximum
      setSimilarCollections(similarCollectionsData.slice(0, 6));
    } catch (error) {
      console.error('Erreur lors de la récupération des collections similaires:', error);
    } finally {
      setLoadingSimilar(false);
    }
  };

  // Fonction pour ajouter/retirer de la watchlist
  const toggleWatchlist = () => {
    if (!collection) return;
    toggleSagaWatchlist(collection);
  };

  // Fonction pour ajouter/retirer des favoris
  const toggleFavorites = () => {
    if (!collection) return;
    toggleSagaFavorite(collection);
  };

  // Fonction pour ouvrir le menu d'ajout à une liste (cette collection)
  const openAddToListMenu = () => {
    setSelectedCollection(null);
    setShowAddToListMenu(true);
  };

  // Même menu pour une collection similaire
  const openAddToListMenuFor = useCallback((saga: SagaSummary) => {
    setSelectedCollection(saga);
    setShowAddToListMenu(true);
  }, []);

  // Fonction pour fermer le menu d'ajout à une liste
  const closeAddToListMenu = () => {
    setShowAddToListMenu(false);
    setSelectedCollection(null);
  };

  useEffect(() => {
    const fetchCollectionDetails = async () => {
      if (!id) return;

      try {
        setLoading(true);
        // D'une collection à l'autre (collections similaires), la page reste
        // montée : on repart de zéro pour ne pas afficher les chiffres, les
        // similaires ou l'erreur de la collection précédente.
        setError(false);
        setCollectionStats(null);
        setProductionInfo(null);
        setDetailedMovies([]);
        setSimilarCollections([]);
        setShowMoviesWithoutImages(false);

        const response = await fetch(
          `${BASE_URL}/collection/${id}?api_key=${API_KEY}&language=${getTmdbLanguage()}`
        );

        if (!response.ok) {
          throw new Error('Collection non trouvée');
        }

        const data = await response.json();
        setCollection(data);

        // Récupérer les détails des films et les collections similaires
        if (data.parts && data.parts.length > 0) {
          fetchDetailedMovies(data.parts);
          fetchSimilarCollections(data.parts);
        }
      } catch (error) {
        console.error('Erreur lors de la récupération de la collection:', error);
        setError(true);
      } finally {
        setLoading(false);
      }
    };

    fetchCollectionDetails();
  }, [id, API_KEY]);

  // Les écrans sans grande image ajoutent eux-mêmes la marge sous l'en-tête
  // fixe : la route n'en a plus (App.tsx, `isHeroHeaderPage`).
  if (loading) {
    return (
      <div data-square-bg="" className="bg-black text-white">
        <SagaDetailSkeleton label={t('collections.loadingCollection')} />
      </div>
    );
  }

  if (error || !collection) {
    return (
      <div data-square-bg="" className="min-h-screen bg-black px-3 pb-24 pt-20 text-white sm:px-6">
        <div className="mx-auto max-w-[480px] py-20 text-center">
          <Film className="mx-auto mb-4 h-16 w-16 text-white opacity-40" aria-hidden="true" />
          <h1 className="mb-3 text-2xl font-bold">{t('collections.notFound')}</h1>
          <p className="mb-8 text-white/60">{t('collections.notAvailable')}</p>
          <Link
            to="/collections"
            className="inline-flex h-12 items-center gap-2 rounded-[14px] bg-red-600 px-5 font-semibold text-white outline-none transition-[background-color,transform] duration-200 hover:bg-red-700 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none"
          >
            <ArrowLeft className="h-5 w-5 text-white" aria-hidden="true" />
            {t('collections.backToCollections')}
          </Link>
        </div>
      </div>
    );
  }

  if (collection.parts.length > 0 && isFilteringCollectionMoviesByAge) {
    return (
      <div data-square-bg="" className="bg-black text-white">
        <SagaDetailSkeleton label={t('collections.loadingCollection')} />
      </div>
    );
  }

  if (collection.parts.length > 0 && ageAllowedCollectionMovies.length === 0) return null;

  // Bouton rouge : il mène à la fiche du film (même lien que les cartes), pas
  // au lecteur. Rien de vu ni d'entamé : le premier film. Tout vu : revoir le
  // premier. Sinon : le film à suivre, avec son numéro et son titre.
  const firstMovie = displayedMovies[0];
  const nextIndex = progress.nextId === null
    ? -1
    : displayedMovies.findIndex((movie) => movie.id === progress.nextId);
  const nextMovie = nextIndex >= 0 ? displayedMovies[nextIndex] : null;
  const hasStarted = progress.watchedCount > 0
    || (nextMovie !== null && progress.films.get(nextMovie.id)?.status === 'in_progress');
  let cta: SagaHeroCta | null = null;
  if (firstMovie && progress.total > 0) {
    if (!nextMovie) {
      cta = { href: `/movie/${encodeId(firstMovie.id)}`, label: t('collections.rewatchFirst') };
    } else if (!hasStarted) {
      cta = { href: `/movie/${encodeId(nextMovie.id)}`, label: t('collections.startFirst') };
    } else {
      cta = {
        href: `/movie/${encodeId(nextMovie.id)}`,
        label: t('collections.continueWith', { number: nextIndex + 1 }),
        caption: nextMovie.title,
      };
    }
  }

  const heroProgress = progress.total > 0
    ? {
        watchedCount: progress.watchedCount,
        total: progress.total,
        watched: displayedMovies.map((movie) => {
          const status = progress.films.get(movie.id)?.status;
          return status === 'watched' || status === 'estimated';
        }),
      }
    : null;

  const menuCollection = selectedCollection || collection;

  return (
    // `data-square-bg` : le thème Halloween rend ce fond transparent pour
    // laisser voir son décor, comme sur les autres pages.
    <div data-square-bg="" className="min-h-screen bg-black pb-10 text-white md:pb-24">
      <SagaHero
        name={collection.name}
        backdropPath={collection.backdrop_path}
        overview={collection.overview}
        filmCount={displayedMovies.length}
        years={getSagaYears(displayedMovies)}
        totalRuntime={collectionStats && collectionStats.totalRuntime > 0 ? collectionStats.totalRuntime : null}
        averageRating={collectionStats && collectionStats.ratedMovies > 0 ? collectionStats.averageRating : null}
        cta={cta}
        progress={heroProgress}
        inWatchlist={watchlist.has(collection.id)}
        isFavorite={favorites.has(collection.id)}
        onToggleWatchlist={toggleWatchlist}
        onToggleFavorite={toggleFavorites}
        onAddToList={openAddToListMenu}
      />

      {/* Positionné : passe au-dessus de la coulure de la grande image, qui sort de `SagaHero`. */}
      <div className="relative mx-auto max-w-[1920px] px-3 sm:px-6 md:px-12 lg:px-20">
        {/* Films de la collection */}
        <SagaSection
          first
          title={displayedMovies.length > 1
            ? t('collections.filmsInOrder', { count: displayedMovies.length })
            : t('collections.movies')}
          aside={
            <div className="flex items-center gap-2 md:gap-3">
              {/* Toggle films sans images */}
              {moviesWithoutImagesCount > 0 && (
                <button
                  type="button"
                  aria-pressed={showMoviesWithoutImages}
                  onClick={() => setShowMoviesWithoutImages(!showMoviesWithoutImages)}
                  className={cn(
                    'inline-flex h-[46px] items-center gap-2 rounded-[10px] border border-white/10 px-3 text-[13px] font-medium transition-[background-color,color,transform] duration-200 hover:text-white active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none md:h-[42px] md:text-[14px]',
                    showMoviesWithoutImages ? 'bg-white/[0.18] text-white' : 'bg-white/[0.08] text-white/70',
                  )}
                >
                  {showMoviesWithoutImages
                    ? <EyeOff className="h-4 w-4 flex-none text-white" aria-hidden="true" />
                    : <Eye className="h-4 w-4 flex-none text-white opacity-70" aria-hidden="true" />}
                  {showMoviesWithoutImages ? t('collections.hideWithoutImages') : t('collections.showWithoutImages')}
                </button>
              )}

              {/* Mode d'affichage */}
              <SagaViewToggle value={viewMode} onChange={setViewMode} />
            </div>
          }
        >
          <SagaFilms
            films={displayedFilms}
            viewMode={viewMode}
            wide={isWide}
            progress={progress.films}
            nextId={progress.nextId}
          />
        </SagaSection>

        {/* La collection en chiffres */}
        {(collectionStats || loadingDetails) && (
          <SagaSection title={t('collections.byTheNumbers')}>
            <SagaStats stats={collectionStats} />
          </SagaSection>
        )}

        {/* Production */}
        {productionInfo && hasProductionData(productionInfo) && (
          <SagaSection title={t('collections.production')}>
            <SagaProduction info={productionInfo} />
          </SagaSection>
        )}

        {/* Collections similaires */}
        {(loadingSimilar || similarCollections.length > 0) && (
          <SagaSection
            title={t('collections.similarCollections')}
            aside={
              <Link
                to="/collections"
                className="relative inline-flex min-h-8 items-center gap-1 whitespace-nowrap rounded-md text-[13px] font-medium text-white/70 outline-none transition-colors duration-200 after:absolute after:inset-x-0 after:-inset-y-1.5 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none md:gap-1.5 md:text-[14px]"
              >
                <span className="md:hidden">{t('collections.seeAll')}</span>
                <span className="hidden md:inline">{t('collections.allCollections')}</span>
                <ChevronRight className="h-[15px] w-[15px] text-white opacity-70 md:h-4 md:w-4" aria-hidden="true" />
              </Link>
            }
          >
            {/* Bande à faire défiler sur téléphone, grille à partir de `md`. */}
            <div className="scrollbar-hide -mx-3 flex snap-x gap-3 overflow-x-auto px-3 sm:-mx-6 sm:px-6 md:mx-0 md:grid md:grid-cols-[repeat(auto-fill,minmax(280px,1fr))] md:gap-5 md:overflow-visible md:px-0">
              {similarCollections.length > 0
                ? similarCollections.map((similarCollection) => (
                    <SagaCard
                      key={similarCollection.id}
                      saga={similarCollection}
                      variant="overlay"
                      inWatchlist={watchlist.has(similarCollection.id)}
                      isFavorite={favorites.has(similarCollection.id)}
                      onToggleWatchlist={toggleSagaWatchlist}
                      onToggleFavorite={toggleSagaFavorite}
                      onAddToList={openAddToListMenuFor}
                      compactActions={compactActions}
                      className="w-[252px] flex-none snap-start md:w-auto"
                    />
                  ))
                : Array.from({ length: 4 }, (_, index) => (
                    <div
                      key={index}
                      aria-hidden="true"
                      className="aspect-video w-[252px] flex-none animate-pulse-soft rounded-xl border border-white/10 bg-white/5 motion-reduce:animate-none md:w-auto md:rounded-[14px]"
                    />
                  ))}
            </div>
          </SagaSection>
        )}
      </div>

      {/* Menu d'ajout à une liste */}
      {showAddToListMenu && (
        <AddToListMenu
          mediaId={menuCollection.id}
          mediaType="collection"
          title={menuCollection.name}
          posterPath={menuCollection.poster_path || ''}
          movieCount={menuCollection.parts?.length || 0}
          onClose={closeAddToListMenu}
        />
      )}
    </div>
  );
};

export default CollectionDetails;
