import React, { useState, useEffect, useRef, useMemo } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import HeroSlider from '../components/HeroSlider';
import EmblaCarousel from '../components/EmblaCarousel';
import CatalogSkeleton from '../components/skeletons/CatalogSkeleton';
import EmblaCarouselGenres from '../components/EmblaCarouselGenres';
import LazySection from '../components/LazySection';
import CarouselTitle from '../components/CarouselTitle';
import { Flame, Compass } from 'lucide-react';

import TelegramPromotion from '../components/TelegramPromotion';
import { useWrappedTracker } from '../hooks/useWrappedTracker';
import { getTmdbLanguage } from '../i18n';
import { readSessionStorage, writeSessionStorage } from '../utils/browserStorage';
import { getMinimumCarouselCategoryItems, makeExclusiveCategories } from '../utils/exclusiveCategories';

// Nombre de sections à charger immédiatement
const IMMEDIATE_LOAD_COUNT = 2;

// Genre IDs from TMDB
const GENRES: Record<number, string> = {
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
  // TV specific genres
  10759: 'Action & Aventure',
  10762: 'Enfants',
  10763: 'Actualités',
  10764: 'Téléréalité',
  10765: 'Science-Fiction & Fantastique',
  10766: 'Feuilleton',
  10767: 'Talk-show',
  10768: 'Guerre & Politique'
};

// CSS pour l'animation du hero slider
const heroSliderStyles = `
@keyframes fadeInOut {
  0% { opacity: 0; transform: scale(1.05) translateX(-10%); }
  10% { opacity: 1; transform: scale(1) translateX(-5%); }
  90% { opacity: 1; transform: scale(1) translateX(5%); }
  100% { opacity: 0; transform: scale(1.05) translateX(10%); }
}

@keyframes slideInFromRight {
  0% { transform: translateX(50px); opacity: 0; }
  100% { transform: translateX(0); opacity: 1; }
}

@keyframes slideInFromLeft {
  0% { transform: translateX(-50px); opacity: 0; }
  100% { transform: translateX(0); opacity: 1; }
}

.poster-row.no-scroll {
  overflow: hidden !important;
}

.slide-in-right {
  animation: slideInFromRight 0.7s ease-out forwards;
}

.slide-in-left {
  animation: slideInFromLeft 0.7s ease-out forwards;
}

.section-title {
  font-size: 1.5rem;
  font-weight: 700;
  position: relative;
  background: linear-gradient(90deg, #ffffff, #e2e2e2);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  text-shadow: 0px 2px 4px rgba(0, 0, 0, 0.3);
  letter-spacing: 0.5px;
  padding-bottom: 0.5rem;
  text-transform: uppercase;
  display: inline-block;
  animation: fadeInTitle 0.8s ease-out forwards;
  transition: all 0.3s ease;
}

.section-title:hover {
  background: linear-gradient(90deg, #ff3333, #ff9999);
  -webkit-background-clip: text;
  background-clip: text;
  transform: translateY(-2px);
  text-shadow: 0px 4px 8px rgba(255, 51, 51, 0.4);
}

@keyframes fadeInTitle {
  0% { opacity: 0; transform: translateY(10px); }
  100% { opacity: 1; transform: translateY(0); }
}

.section-title::after {
  content: '';
  position: absolute;
  left: 0;
  bottom: 0;
  width: 40px;
  height: 3px;
  background: linear-gradient(90deg, #f11 0%, #f66 100%);
  border-radius: 3px;
  animation: expandWidth 0.6s ease-out forwards 0.3s;
  transform-origin: left;
  transition: all 0.3s ease;
}

.section-title:hover::after {
  width: 100%;
  background: linear-gradient(90deg, #ff3333, #ff9999);
}

@keyframes expandWidth {
  0% { width: 0; }
  100% { width: 40px; }
}

.content-row-container {
  padding: 5px 0px 40px 0px;
  margin-top: -30px;
  overflow: visible !important;
  position: relative;
  z-index: 1;
}

.poster-row {
  display: flex;
  gap: 10px;
  transition: transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  padding: 5rem 0.5rem;
  margin: -5rem -0.5rem;
  overflow-x: auto !important;
  overflow-y: visible !important;
  scrollbar-width: none;
  -ms-overflow-style: none;
  position: relative;
  z-index: 5;
}

.poster-row::-webkit-scrollbar {
  display: none;
}

.poster-container {
  position: relative;
  transition: transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  margin: 0;
  flex-shrink: 0;
  z-index: 10;
  overflow: visible;
  padding: 0;
}

.poster-container:hover {
  z-index: 50;
  overflow: visible;
  transform: translateZ(0);
}

.poster-container:hover ~ .poster-container {
  transform: translateX(0);
}

.poster-card {
  position: relative;
  transition: all 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  transform-origin: 0% 0%;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
  overflow: visible;
  cursor: pointer;
  z-index: 10;
  margin-bottom: 3rem;
  margin-top: 1rem;
}

.poster-card:hover {
  transform: scale(1.5);
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
  z-index: 100;
  overflow: visible;
  transform-style: preserve-3d;
  position: relative;
}

.poster-container:has(.poster-card:hover) ~ .poster-container {
  transform: translateX(100px);
}

.poster-container:hover ~ .poster-container {
  transition-delay: 0.12s;
  transform: translateX(100px);
}

.poster-card .hover-content {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #141414;
  opacity: 0;
  display: flex;
  flex-direction: column;
  border-radius: 8px;
  transition: opacity 0.3s ease;
  overflow: hidden;
}

.poster-card:hover .hover-content {
  opacity: 1;
}

.poster-card:hover img.poster {
  opacity: 0;
}

.card-buttons {
  display: flex;
  gap: 0.5rem;
  justify-content: center;
  align-items: center;
}

.card-buttons a {
  transition: transform 0.2s ease;
}

.card-buttons a:hover {
  transform: scale(1.2);
}

.top-content-row {
  margin-top: 10px;
  margin-bottom: 10px;
  padding-left: 64px;
  padding-right: 64px;
  gap: 15px;
}
`;

interface TVShow {
  id: number;
  name: string;
  poster_path: string;
  backdrop_path: string;
  overview: string;
  vote_average: number;
  first_air_date: string;
  genre_ids?: number[];
  media_type: 'tv';
}

interface Category {
  id: string;
  title: string;
  items: TVShow[];
}

const MAIN_API = import.meta.env.VITE_MAIN_API;
const BACKUP_API = import.meta.env.VITE_BACKUP_API;
const TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY || '';
const ITEMS_PER_PAGE = 100;
const ITEMS_PER_BATCH = 20;


const normalizeTVItem = <T extends { poster_path?: string | null; backdrop_path?: string | null; overview?: string | null }>(
  item: T
) => ({
  ...item,
  media_type: 'tv' as const,
  poster_path: item.poster_path || '',
  backdrop_path: item.backdrop_path || '',
  overview: item.overview || '',
});

const normalizeTVCategory = (category: Category): Category => ({
  ...category,
  items: category.items.map((item) => normalizeTVItem(item)) as any,
});

const TVShows: React.FC = () => {
  const { t } = useTranslation();
  const [tvShows, setTVShows] = useState<TVShow[]>([]);
  const [featuredShows, setFeaturedShows] = useState<TVShow[]>([]);
  const [topContent, setTopContent] = useState<TVShow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isTop10CardHovered, setIsTop10CardHovered] = useState(false);
  const top10RowRef = useRef<HTMLDivElement>(null);
  const [hoveredCardIndex, setHoveredCardIndex] = useState<number | null>(null);
  const [genreItems, setGenreItems] = useState<{ id: number; name: string; route: string; imageUrl?: string }[]>([
    { id: 10759, name: 'Action & Aventure', route: '/genre/tv/10759' },
    { id: 16, name: 'Animation', route: '/genre/tv/16' },
    { id: 35, name: 'Comédie', route: '/genre/tv/35' },
    { id: 80, name: 'Crime', route: '/genre/tv/80' },
    { id: 99, name: 'Documentaire', route: '/genre/tv/99' },
    { id: 18, name: 'Drame', route: '/genre/tv/18' },
    { id: 10751, name: 'Famille', route: '/genre/tv/10751' },
    { id: 10762, name: 'Enfants', route: '/genre/tv/10762' },
    { id: 9648, name: 'Mystère', route: '/genre/tv/9648' },
    { id: 10763, name: 'Actualités', route: '/genre/tv/10763' },
    { id: 10764, name: 'Téléréalité', route: '/genre/tv/10764' },
    { id: 10765, name: 'SF & Fantastique', route: '/genre/tv/10765' },
    { id: 10766, name: 'Feuilleton', route: '/genre/tv/10766' },
    { id: 10767, name: 'Talk-show', route: '/genre/tv/10767' },
    { id: 10768, name: 'Guerre & Politique', route: '/genre/tv/10768' },
  ]);

  // Track page visit for Movix Wrapped
  useWrappedTracker({
    mode: 'page',
    pageData: { pageName: 'tv-shows' },
  });

  // Organize content by genres
  const organizeContentByCategories = (items: TVShow[]) => {
    // Filter out items without overview or poster
    const filteredItems = items.filter(item => item.overview && item.poster_path);

    // Create genre-based categories
    const genreMap: Record<number, TVShow[]> = {};

    filteredItems.forEach(item => {
      if (item.genre_ids && item.genre_ids.length > 0) {
        item.genre_ids.forEach(genreId => {
          if (!genreMap[genreId]) {
            genreMap[genreId] = [];
          }
          // Only add if not already in the array
          if (!genreMap[genreId].some(show => show.id === item.id)) {
            genreMap[genreId].push(item);
          }
        });
      }
    });

    // Convert the genre map to categories array
    const genreCategories: Category[] = Object.entries(genreMap)
      .map(([genreId, items]) => ({
        id: genreId,
        title: GENRES[Number(genreId)] || `Category ${genreId}`,
        items: items.slice(0, 15) // Réduit de 100 à 15 pour de meilleures performances
      }))
      .filter(category => category.items.length >= 3) // Réduit le minimum requis à 3 items au lieu de 5
      .sort((a, b) => b.items.length - a.items.length) // Sort by number of items
      .slice(0, 10); // Réduit de 100 à 10 catégories pour de meilleures performances

    // Additional dynamic categories based on air date
    // First, deduplicate the items array by TV show ID
    const uniqueShows = filteredItems.reduce((unique: TVShow[], item) => {
      if (!unique.some(show => show.id === item.id)) {
        unique.push(item);
      }
      return unique;
    }, []);

    const recentShows = uniqueShows
      .filter(item => item.first_air_date)
      .sort((a, b) => {
        const dateA = a.first_air_date ? new Date(a.first_air_date).getTime() : 0;
        const dateB = b.first_air_date ? new Date(b.first_air_date).getTime() : 0;
        return dateB - dateA;
      })
      .slice(0, 15); // Réduit de 40 à 15 pour de meilleures performances

    const orderedCategories: Category[] = [];

    if (recentShows.length >= 5) {
      orderedCategories.push({
        id: 'recent-shows',
        title: t('home.recentShows'),
        items: recentShows
      });
    }

    orderedCategories.push(...genreCategories);

    setCategories((makeExclusiveCategories(orderedCategories, {
      minItems: getMinimumCarouselCategoryItems(),
      limit: 10,
      perCategoryLimit: 15
    })).map(normalizeTVCategory));
  };

  const fetchTVShows = async () => {
    try {
      setLoading(true);

      // Check for cached data first
      const cachedData = readSessionStorage('movix_tvshows_data');
      const cacheTimestamp = readSessionStorage('movix_tvshows_data_timestamp');

      // Use cache if it exists and is less than 15 minutes old
      if (cachedData && cacheTimestamp) {
        const isRecent = (Date.now() - parseInt(cacheTimestamp)) < 15 * 60 * 1000; // 15 minutes

        if (isRecent) {
          try {
            const parsedData = JSON.parse(cachedData);
            if (!Array.isArray(parsedData?.featuredShows)
              || !Array.isArray(parsedData?.topContent)
              || !Array.isArray(parsedData?.tvShows)) {
              throw new Error('Invalid TV shows cache');
            }
            setFeaturedShows(parsedData.featuredShows.map(normalizeTVItem) as any);
            setTopContent(parsedData.topContent.map(normalizeTVItem) as any);
            setTVShows(parsedData.tvShows);
            // Regenerate categories from cached TV shows
            if (parsedData.tvShows && parsedData.tvShows.length > 0) {
              organizeContentByCategories(parsedData.tvShows);
            }
            setLoading(false);
            return;
          } catch {
            // Cache illisible : les données réseau restent la source de repli.
          }
        }
      }

      // Obtenir les séries avec un focus sur celles avec production élevée / adaptations cinéma
      const tmdbResponse = await axios.get(`https://api.themoviedb.org/3/discover/tv`, {
        params: {
          api_key: TMDB_API_KEY,
          language: getTmdbLanguage(),
          page: 1,
          sort_by: 'popularity.desc',
          with_genres: '10759|18|10768', // Action & Adventure, Drama, War (genres souvent liés aux adaptations cinéma)
          'vote_average.gte': 7.0, // Filtre pour les séries mieux notées (souvent à plus grand budget)
          'vote_count.gte': 100, // Avoir un nombre minimum de votes
          include_adult: false
        }
      });

      // Obtenir plus de variété pour les genres
      const genreRequests = [
        // Séries comédie (pages 1-3)
        ...Array.from({ length: 3 }, (_, i) =>
          axios.get(`https://api.themoviedb.org/3/discover/tv`, {
            params: {
              api_key: TMDB_API_KEY,
              language: getTmdbLanguage(),
              page: i + 1,
              sort_by: 'popularity.desc',
              with_genres: '35', // Comédie
              include_adult: false
            }
          })
        ),
        // Séries science-fiction et fantastique (pages 1-3)
        ...Array.from({ length: 3 }, (_, i) =>
          axios.get(`https://api.themoviedb.org/3/discover/tv`, {
            params: {
              api_key: TMDB_API_KEY,
              language: getTmdbLanguage(),
              page: i + 1,
              sort_by: 'popularity.desc',
              with_genres: '10765', // Science-Fiction & Fantastique
              include_adult: false
            }
          })
        ),
        // Séries crime (pages 1-3)
        ...Array.from({ length: 3 }, (_, i) =>
          axios.get(`https://api.themoviedb.org/3/discover/tv`, {
            params: {
              api_key: TMDB_API_KEY,
              language: getTmdbLanguage(),
              page: i + 1,
              sort_by: 'popularity.desc',
              with_genres: '80', // Crime
              include_adult: false
            }
          })
        ),
        // Séries documentaires (pages 1-3)
        ...Array.from({ length: 3 }, (_, i) =>
          axios.get(`https://api.themoviedb.org/3/discover/tv`, {
            params: {
              api_key: TMDB_API_KEY,
              language: getTmdbLanguage(),
              page: i + 1,
              sort_by: 'popularity.desc',
              with_genres: '99', // Documentaire
              include_adult: false
            }
          })
        ),
        // Séries dramatiques (pages 1-3)
        ...Array.from({ length: 3 }, (_, i) =>
          axios.get(`https://api.themoviedb.org/3/discover/tv`, {
            params: {
              api_key: TMDB_API_KEY,
              language: getTmdbLanguage(),
              page: i + 1,
              sort_by: 'popularity.desc',
              with_genres: '18', // Drame
              include_adult: false
            }
          })
        ),
        // Séries mystère (pages 1-3)
        ...Array.from({ length: 3 }, (_, i) =>
          axios.get(`https://api.themoviedb.org/3/discover/tv`, {
            params: {
              api_key: TMDB_API_KEY,
              language: getTmdbLanguage(),
              page: i + 1,
              sort_by: 'popularity.desc',
              with_genres: '9648', // Mystère
              include_adult: false
            }
          })
        ),
      ];

      const genreResponses = await Promise.all(genreRequests);

      // Filter out shows without poster_path or overview
      const validShows = tmdbResponse.data.results.filter((show: TVShow) =>
        show.poster_path && show.overview && show.overview.trim() !== '').map((show: TVShow) => ({
          ...show,
          media_type: 'tv'
        }));

      // Extraire et ajouter les séries supplémentaires
      const additionalShows = genreResponses.flatMap(response =>
        response.data.results
          .filter((show: TVShow) => show.poster_path && show.overview && show.overview.trim() !== '')
          .map((show: TVShow) => ({
            ...show,
            media_type: 'tv'
          }))
      );

      // Combiner toutes les séries en évitant les doublons
      const allShows = [...validShows];

      additionalShows.forEach(newShow => {
        if (!allShows.some(show => show.id === newShow.id)) {
          allShows.push(newShow);
        }
      });

      if (allShows.length > 0) {
        // Sélectionner plusieurs séries pour le slider
        const heroShows = allShows
          .filter((show: TVShow) => show.backdrop_path && show.overview)
          .slice(0, 8); // Augmenté: de 5 à 8 séries dans le slider
        setFeaturedShows(heroShows.map(normalizeTVItem) as any);

        // Get trending TV shows for today
        try {
          const trendingResponse = await axios.get(`https://api.themoviedb.org/3/trending/tv/day`, {
            params: {
              api_key: TMDB_API_KEY,
              language: getTmdbLanguage()
            }
          });

          // Filtrer les séries pour exclure celles qui ne sont pas encore sorties et les séries chinoises
          const today = new Date();
          const trendingShows = trendingResponse.data.results
            .filter((show: TVShow) => {
              // Vérifier si la série est sortie
              if (!show.first_air_date) return false;
              const releaseDate = new Date(show.first_air_date);
              // Compare dates by setting time to midnight for accurate same-day comparison
              const releaseDateOnly = new Date(releaseDate.setHours(0, 0, 0, 0));
              const todayOnly = new Date(today.setHours(0, 0, 0, 0));
              if (releaseDateOnly > todayOnly) return false;

              // Vérifier si la série a une affiche et une description
              if (!show.poster_path || !show.overview) return false;

              // Vérifier si la série n'est pas chinoise (en excluant les séries avec des caractères chinois dans le titre)
              const hasChineseChars = /[\u4e00-\u9fff]/.test(show.name);
              if (hasChineseChars) return false;

              return true;
            })
            .slice(0, 10);

          setTopContent(trendingShows.map(normalizeTVItem) as any);
        } catch (error) {
          console.error('Error fetching trending TV shows:', error);
          // Fallback au tri par note moyenne si les séries tendances échouent
          const top10 = [...allShows]
            .sort((a, b) => b.vote_average - a.vote_average)
            .slice(0, 10);
          setTopContent(top10.map(normalizeTVItem) as any);
        }

        // Organize content by categories
        organizeContentByCategories(allShows);
      }

      setTVShows(allShows);

      // Cache the data
      const heroShows = allShows
        .filter((show: TVShow) => show.backdrop_path && show.overview)
        .slice(0, 8);

      // Get top content for cache
      let topContentCache: TVShow[] = [];
      try {
        const today = new Date();
        topContentCache = allShows
          .filter((show: TVShow) => {
            if (!show.first_air_date) return false;
            const releaseDate = new Date(show.first_air_date);
            const releaseDateOnly = new Date(releaseDate.setHours(0, 0, 0, 0));
            const todayOnly = new Date(new Date(today).setHours(0, 0, 0, 0));
            if (releaseDateOnly > todayOnly) return false;
            if (!show.poster_path || !show.overview) return false;
            const hasChineseChars = /[\u4e00-\u9fff]/.test(show.name);
            if (hasChineseChars) return false;
            return true;
          })
          .slice(0, 10);
      } catch {
        topContentCache = [...allShows]
          .sort((a, b) => b.vote_average - a.vote_average)
          .slice(0, 10);
      }

      const cacheData = {
        featuredShows: heroShows,
        topContent: topContentCache,
        tvShows: allShows,
        categories: [] // Categories will be regenerated from tvShows
      };

      if (writeSessionStorage('movix_tvshows_data', JSON.stringify(cacheData))) {
        writeSessionStorage('movix_tvshows_data_timestamp', Date.now().toString());
      }
    } catch (error) {
      console.error('Error fetching TV shows:', error);
      setError(t('home.errorLoadingData'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTVShows();
  }, []);

  // Fetch representative TMDB images for each TV genre and cache for 24h
  useEffect(() => {
    const cacheKey = 'movix_tv_genre_images';
    const cacheTsKey = 'movix_tv_genre_images_ts';
    const cached = readSessionStorage(cacheKey);
    const cachedTs = readSessionStorage(cacheTsKey);
    const oneDayMs = 24 * 60 * 60 * 1000;
    const load = async () => {
      if (cached && cachedTs && (Date.now() - parseInt(cachedTs)) < oneDayMs) {
        try {
          const parsed = JSON.parse(cached);
          if (!Array.isArray(parsed)) throw new Error('Invalid TV genre image cache');
          setGenreItems(parsed);
          return;
        } catch {
          // Cache illisible : récupérer de nouvelles images.
        }
      }

      try {
        const updated = await Promise.all(genreItems.map(async (g) => {
          try {
            const resp = await axios.get('https://api.themoviedb.org/3/discover/tv', {
              params: {
                api_key: TMDB_API_KEY,
                language: getTmdbLanguage(),
                with_genres: g.id,
                sort_by: 'popularity.desc',
                include_adult: false,
                page: 1
              }
            });
            const first = Array.isArray(resp.data?.results) ? resp.data.results.find((m: any) => m.backdrop_path || m.poster_path) : null;
            const path = first?.backdrop_path || first?.poster_path || '';
            const imageUrl = path ? `https://image.tmdb.org/t/p/w780${path}` : undefined;
            return { ...g, imageUrl };
          } catch (_) {
            return g;
          }
        }));
        setGenreItems(updated);
        if (writeSessionStorage(cacheKey, JSON.stringify(updated))) {
          writeSessionStorage(cacheTsKey, Date.now().toString());
        }
      } catch (_) {
        // ignore
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Simple title for TV Shows page
    document.title = `${t('tvShows.title')} - Movix`;
  }, []);





  useEffect(() => {
    const container = top10RowRef.current;
    if (!container) return;
    if (hoveredCardIndex === null) return;

    // Prevent horizontal scroll but allow vertical scroll
    const preventScroll = (e: Event) => {
      if (e instanceof WheelEvent && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    };
    // Prevent keyboard scroll
    const preventKey = (e: KeyboardEvent) => {
      const keys = ['ArrowLeft', 'ArrowRight', ' ', 'PageUp', 'PageDown', 'Home', 'End'];
      if (keys.includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    };
    container.addEventListener('wheel', preventScroll, { passive: false });
    container.addEventListener('keydown', preventKey, { passive: false });
    return () => {
      container.removeEventListener('wheel', preventScroll);
      container.removeEventListener('keydown', preventKey);
    };
  }, [hoveredCardIndex]);

  const trendingTitle = useMemo(
    () => <CarouselTitle icon={Flame} iconClass="text-red-600" label={t('home.trendingToday')} />,
    [t]
  );

  const categoryTitles = useMemo(
    () => categories.map((c) => <CarouselTitle label={typeof c.title === 'string' ? c.title : String(c.title)} />),
    [categories]
  );

  const genresTitle = useMemo(
    () => <CarouselTitle icon={Compass} iconClass="text-white" label={t('genres.findByGenre')} />,
    [t]
  );

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="bg-red-600/10 text-red-600 px-6 py-4 rounded-lg">
          {error}
        </div>
      </div>
    );
  }

  if (loading && tvShows.length === 0) {
    return (
      <CatalogSkeleton variant="tv" />
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <style>{heroSliderStyles}</style>

      {/* Hero Section */}
      <div className="relative w-full pt-16 md:pt-20 lg:pt-24">
        {featuredShows.length > 0 && (
          <HeroSlider items={featuredShows as any} />
        )}
      </div>

      {/* Section visuelle des genres */}
      <div className="w-full bg-black py-6 relative mt-8 z-[20] px-4 md:px-8">
        <EmblaCarouselGenres
          title={genresTitle}
          items={genreItems}
        />
      </div>

      {/* Content Sections */}
      <div className="pb-12 -mt-4 relative z-[20]">
        {/* Top 10 Section - Section prioritaire (index 0) */}
        {topContent.length > 0 && (
          <div className="px-4 md:px-8">
            <LazySection index={0} immediateLoadCount={IMMEDIATE_LOAD_COUNT}>
              <EmblaCarousel
                title={trendingTitle}
                items={topContent}
                mediaType="top10"
                showRanking={true}
              />
            </LazySection>
          </div>
        )}

        {/* Category Rows - Lazy loaded (index 1+) */}
        {categories.length > 0 && categories.map((category, catIndex) => (
          <div key={`wrap-${category.id}`} className="px-4 md:px-8">
            <LazySection key={`lazy-${category.id}`} index={1 + catIndex} immediateLoadCount={IMMEDIATE_LOAD_COUNT}>
              <EmblaCarousel
                key={category.id}
                title={categoryTitles[catIndex]}
                items={category.items}
                mediaType={category.id}
              />
            </LazySection>
          </div>
        ))}

        <TelegramPromotion />
      </div>

      {/* Spacer div to maintain structure */}
      <div></div>
    </div>
  );
};

export default TVShows;
