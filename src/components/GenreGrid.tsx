import React, { useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import axios from 'axios';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { getTmdbLanguage } from '../i18n';
import { genreSearchHref } from '@/utils/genreSearchLink';

// Genre IDs from TMDB
const GENRES: Record<number, string> = {
  28: 'Action',
  12: 'Aventure',
  16: 'Animation',
  35: 'Comédie',
  80: 'Crime',
  99: 'Documentaires',
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

// Genres à afficher (sélection fixe correspondant à l'image de référence)
const MOVIE_GRID_GENRES = [28, 12, 16, 35, 99, 18, 27, 10749, 878, 53, 14, 37, 80, 10752];
const TV_GRID_GENRES = [10759, 16, 35, 18, 10765, 99, 10749, 10768, 80, 9648, 10764];

// API Key pour TMDB
const TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY || '';

// Stocker les images déjà utilisées pour éviter les doublons
const usedImages = new Set<string>();

// Hoisted to module scope — pure constant, no closure over state/props. — perf
const cardVariants = {
  initial: { scale: 1 },
  hover: { scale: 1.05, transition: { duration: 0.3 } },
  tap: { scale: 0.95, transition: { duration: 0.1 } },
  selected: { scale: 1.1, brightness: 1.2, transition: { duration: 0.5 } }
};

// Hoisted to module scope — 30-line map recreated per getGenreImageUrl call otherwise. — perf
const FALLBACK_IMAGES: {
  movie: Record<number, string>;
  tv: Record<number, string>;
} = {
  movie: {
    28: 'https://image.tmdb.org/t/p/original/628Dep6AxEtDxjZoGP78TsOxYbK.jpg', // Action
    12: 'https://image.tmdb.org/t/p/original/bQXAqRx2Fgc46uCVWgoPz5L5Dtr.jpg', // Aventure
    16: 'https://image.tmdb.org/t/p/original/xLWYkefC1wjRlnLKrKvaD9s3DiL.jpg', // Animation
    35: 'https://image.tmdb.org/t/p/original/cGLL4SY6jFjjUZkz2eFxgtCtGgK.jpg', // Comédie
    99: 'https://image.tmdb.org/t/p/original/9MwZd8PKOkVYhIhkwjJ1Z6MPfvV.jpg', // Documentaire
    18: 'https://image.tmdb.org/t/p/original/tmU7GeKVybMWFButWEGl2M4GeiP.jpg', // Drame
    27: 'https://image.tmdb.org/t/p/original/bShgiZFaalQoKDY89L1CbgNc6ic.jpg', // Horreur
    10749: 'https://image.tmdb.org/t/p/original/5DUMPBSnHOZsbBv81GFXZXaKQRw.jpg', // Romance
    878: 'https://image.tmdb.org/t/p/original/rAiYTfKGqDCRIIqo664sY9XZIvQ.jpg', // Science-Fiction
    53: 'https://image.tmdb.org/t/p/original/7hN6WuQulU6UgOQrpgR4CbOCTfa.jpg', // Thriller
    14: 'https://image.tmdb.org/t/p/original/8YGXxUGDtZlqc2CcFvd9bGMXuXk.jpg', // Fantastique
    37: 'https://image.tmdb.org/t/p/original/iQ5ztdjvteGeboxtmRdXEChJOHh.jpg', // Western
    80: 'https://image.tmdb.org/t/p/original/mqDnpWQrt0TRz2u9HRjLuaTLjL5.jpg', // Crime
    10752: 'https://image.tmdb.org/t/p/original/zDlRxz2vXVs9YmOXN5zHHiY5Xrd.jpg', // Guerre
  },
  tv: {
    10759: 'https://image.tmdb.org/t/p/original/rGBhQ4P7R5B6U4h5Qr3NKUVmQY5.jpg', // Action & Aventure
    16: 'https://image.tmdb.org/t/p/original/3rsoG8HXQNJ2yyaZdxZ98uVzlBZ.jpg', // Animation
    35: 'https://image.tmdb.org/t/p/original/8Xs20y8gFR0W9u8Yy9NKdpZtSu7.jpg', // Comédie
    18: 'https://image.tmdb.org/t/p/original/7q448EVOnuE3gVAx24krzO7SNXM.jpg', // Drame
    10765: 'https://image.tmdb.org/t/p/original/iE3s0lG5QVdEHOEZnoAxjmMtvne.jpg', // Science-Fiction & Fantastique
    99: 'https://image.tmdb.org/t/p/original/b0WmHGc8LHTdGCVzxRb3IBMur57.jpg', // Documentaire
    10749: 'https://image.tmdb.org/t/p/original/7TdALqc9gJK96xCvKTN3RbucSPT.jpg', // Romance
    10768: 'https://image.tmdb.org/t/p/original/7FIKU4JSqIxmJGIXq0gAwCvnC9p.jpg', // Guerre & Politique
    80: 'https://image.tmdb.org/t/p/original/or0E36KfzJYZwqXeiCfm1JgepKF.jpg', // Crime
    9648: 'https://image.tmdb.org/t/p/original/lJA2RCMfsWCO3GutzLdaG2I7MOq.jpg', // Mystère
    10764: 'https://image.tmdb.org/t/p/original/75nWz57HcNcJ4SLQ3rKCLq5fMFQ.jpg', // Téléréalité
  }
};

interface GenrePoster {
  genreId: number;
  posterPath: string | null;
  backdropPath: string | null;
}

interface GenreGridProps {
  mediaType: 'movie' | 'tv';
  title?: string;
  className?: string;
}

const GenreGrid: React.FC<GenreGridProps> = ({ 
  mediaType, 
  title = 'Trouve ton contenu par genre',
  className = ''
}) => {
  const { t } = useTranslation();
  const genresToShow = mediaType === 'movie' ? MOVIE_GRID_GENRES : TV_GRID_GENRES;
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showLeftButton, setShowLeftButton] = useState(false);
  const [showRightButton, setShowRightButton] = useState(true);
  const [genrePosters, setGenrePosters] = useState<GenrePoster[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGenreId, setSelectedGenreId] = useState<number | null>(null);
  const navigate = useNavigate();

  // cardVariants hoisted to module scope — perf

  // Transition variants for page navigation
  const pageTransition = {
    type: "tween",
    ease: "anticipate",
    duration: 0.5
  };

  // Réinitialiser les images utilisées quand le type de média change
  useEffect(() => {
    usedImages.clear();
  }, [mediaType]);

  // Récupérer les posters pour chaque genre
  useEffect(() => {
    const fetchGenrePosters = async () => {
      setLoading(true);
      
      // Traiter les genres de manière séquentielle pour éviter les doublons
      const posters: GenrePoster[] = [];
      
      for (const [index, genreId] of genresToShow.entries()) {
        try {
          // Rechercher les films/séries populaires pour ce genre avec plus de résultats
          const response = await axios.get(`https://api.themoviedb.org/3/discover/${mediaType}`, {
            params: {
              api_key: TMDB_API_KEY,
              language: getTmdbLanguage(),
              with_genres: genreId,
              sort_by: 'popularity.desc',
              'vote_count.gte': 50, // Limiter aux contenus avec un minimum de votes
              page: 1,
              include_adult: false,
              'vote_average.gte': 6.0, // Limiter aux contenus bien notés
              include_video: false
            }
          });
          
          const results = response.data.results;
          
          if (results.length === 0) {
            posters.push({ genreId, posterPath: null, backdropPath: null });
            continue;
          }
          
          // Sélectionner une image qui n'a pas encore été utilisée
          let selectedResult = null;
          let attempts = 0;
          const maxAttempts = Math.min(30, results.length);
          
          while (!selectedResult && attempts < maxAttempts) {
            // Utiliser des offsets différents pour chaque genre pour augmenter la diversité
            const position = (index + attempts) % maxAttempts;
            const candidate = results[position];
            
            // Vérifier si cette image n'est pas déjà utilisée
            const posterKey = candidate.poster_path;
            const backdropKey = candidate.backdrop_path;
            
            if (posterKey && !usedImages.has(posterKey)) {
              selectedResult = candidate;
              usedImages.add(posterKey);
              break;
            } else if (backdropKey && !usedImages.has(backdropKey)) {
              selectedResult = candidate;
              usedImages.add(backdropKey);
              break;
            }
            
            attempts++;
          }
          
          // Si après plusieurs tentatives, on n'a pas trouvé d'image unique,
          // prendre la première disponible
          if (!selectedResult && results.length > 0) {
            selectedResult = results[0];
            if (selectedResult.poster_path) usedImages.add(selectedResult.poster_path);
            if (selectedResult.backdrop_path) usedImages.add(selectedResult.backdrop_path);
          }
          
          posters.push({
            genreId,
            posterPath: selectedResult?.poster_path || null,
            backdropPath: selectedResult?.backdrop_path || null
          });
          
        } catch (error) {
          console.error(`Erreur lors de la récupération des posters pour le genre ${genreId}:`, error);
          posters.push({ genreId, posterPath: null, backdropPath: null });
        }
      }
      
      setGenrePosters(posters);
      setLoading(false);
    };
    
    fetchGenrePosters();
  }, [genresToShow, mediaType]);

  const handleScroll = () => {
    if (scrollContainerRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current;
      setShowLeftButton(scrollLeft > 0);
      setShowRightButton(scrollLeft < scrollWidth - clientWidth - 10);
    }
  };

  const scroll = (direction: 'left' | 'right') => {
    if (scrollContainerRef.current) {
      const { clientWidth } = scrollContainerRef.current;
      const scrollAmount = direction === 'left' ? -clientWidth / 2 : clientWidth / 2;
      scrollContainerRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  // Obtenir l'URL d'image pour un genre donné
  const getGenreImageUrl = (genreId: number): string => {
    const genrePoster = genrePosters.find(poster => poster.genreId === genreId);
    
    if (genrePoster?.posterPath) {
      // Utiliser une image de meilleure qualité
      return `https://image.tmdb.org/t/p/w780${genrePoster.posterPath}`;
    } else if (genrePoster?.backdropPath) {
      // Utiliser une image de meilleure qualité
      return `https://image.tmdb.org/t/p/w1280${genrePoster.backdropPath}`;
    }
    
    // Utiliser l'image de secours correspondant au genre et au type de média
    // (FALLBACK_IMAGES is hoisted to module scope — perf)
    if (mediaType === 'movie' && genreId in FALLBACK_IMAGES.movie) {
      return FALLBACK_IMAGES.movie[genreId];
    } else if (mediaType === 'tv' && genreId in FALLBACK_IMAGES.tv) {
      return FALLBACK_IMAGES.tv[genreId];
    }
    
    // Image de secours par défaut si aucune correspondance
    return mediaType === 'movie' 
      ? 'https://image.tmdb.org/t/p/original/vt5XUYVnU3LNubLPCQHGPbWGUa1.jpg'
      : 'https://image.tmdb.org/t/p/original/56v2KjBlU4XaOv9rVYEQypROD7P.jpg';
  };
  
  // Gérer la sélection d'un genre avec animation
  const handleGenreSelect = (genreId: number) => {
    setSelectedGenreId(genreId);
    
    // Naviguer vers la page du genre après un court délai pour l'animation
    setTimeout(() => {
      navigate(genreSearchHref(mediaType, genreId));
    }, 300);
  };

  return (
    <motion.div 
      className={`my-8 ${className}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
    >
      <h2 className="text-2xl font-bold mb-6 px-4 md:px-8">{title || t('genres.findByGenre')}</h2>
      
      <div className="relative group">
        {showLeftButton && (
          <motion.button
            onClick={() => scroll('left')}
            className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-black to-transparent px-5 z-30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center h-full"
            aria-label={t('genres.scrollLeft')}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            <div className="bg-black/40 rounded-full p-2.5">
              <ChevronLeft className="w-6 h-6 text-white" />
            </div>
          </motion.button>
        )}

        <div 
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex gap-4 overflow-x-auto scrollbar-hide scroll-smooth px-4 md:px-8 pb-4"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {genresToShow.map((genreId) => (
            <motion.div
              key={genreId}
              className="flex-none relative h-36 w-64 rounded-lg overflow-hidden cursor-pointer"
              variants={cardVariants}
              initial="initial"
              whileHover="hover"
              whileTap="tap"
              animate={selectedGenreId === genreId ? "selected" : "initial"}
              onClick={() => handleGenreSelect(genreId)}
              layoutId={`genre-${genreId}`}
            >
              <div className="absolute inset-0 bg-black/50 group-hover:bg-black/40 transition-all z-10"></div>
              {loading ? (
                <div className="w-full h-full bg-gray-800">
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
                  </div>
                </div>
              ) : (
                <motion.img 
                  src={getGenreImageUrl(genreId)} 
                  alt={GENRES[genreId]}
                  className="w-full h-full object-cover"
                  initial={{ scale: 1 }}
                  animate={{ 
                    scale: selectedGenreId === genreId ? 1.1 : 1,
                    filter: selectedGenreId === genreId ? "brightness(1.3)" : "brightness(1)"
                  }}
                  transition={{ duration: 0.3 }}
                  onError={(e) => {
                    const fallbackImages: {
                      movie: Record<number, string>;
                      tv: Record<number, string>;
                    } = {
                      movie: {
                        28: 'https://image.tmdb.org/t/p/original/628Dep6AxEtDxjZoGP78TsOxYbK.jpg',
                        12: 'https://image.tmdb.org/t/p/original/bQXAqRx2Fgc46uCVWgoPz5L5Dtr.jpg',
                        16: 'https://image.tmdb.org/t/p/original/xLWYkefC1wjRlnLKrKvaD9s3DiL.jpg',
                        35: 'https://image.tmdb.org/t/p/original/cGLL4SY6jFjjUZkz2eFxgtCtGgK.jpg',
                        99: 'https://image.tmdb.org/t/p/original/9MwZd8PKOkVYhIhkwjJ1Z6MPfvV.jpg',
                        18: 'https://image.tmdb.org/t/p/original/tmU7GeKVybMWFButWEGl2M4GeiP.jpg',
                        27: 'https://image.tmdb.org/t/p/original/bShgiZFaalQoKDY89L1CbgNc6ic.jpg',
                        10749: 'https://image.tmdb.org/t/p/original/5DUMPBSnHOZsbBv81GFXZXaKQRw.jpg',
                        878: 'https://image.tmdb.org/t/p/original/rAiYTfKGqDCRIIqo664sY9XZIvQ.jpg',
                        53: 'https://image.tmdb.org/t/p/original/7hN6WuQulU6UgOQrpgR4CbOCTfa.jpg',
                        14: 'https://image.tmdb.org/t/p/original/8YGXxUGDtZlqc2CcFvd9bGMXuXk.jpg',
                        37: 'https://image.tmdb.org/t/p/original/iQ5ztdjvteGeboxtmRdXEChJOHh.jpg',
                        80: 'https://image.tmdb.org/t/p/original/mqDnpWQrt0TRz2u9HRjLuaTLjL5.jpg',
                        10752: 'https://image.tmdb.org/t/p/original/zDlRxz2vXVs9YmOXN5zHHiY5Xrd.jpg'
                      },
                      tv: {
                        10759: 'https://image.tmdb.org/t/p/original/rGBhQ4P7R5B6U4h5Qr3NKUVmQY5.jpg',
                        16: 'https://image.tmdb.org/t/p/original/3rsoG8HXQNJ2yyaZdxZ98uVzlBZ.jpg',
                        35: 'https://image.tmdb.org/t/p/original/8Xs20y8gFR0W9u8Yy9NKdpZtSu7.jpg',
                        18: 'https://image.tmdb.org/t/p/original/7q448EVOnuE3gVAx24krzO7SNXM.jpg',
                        10765: 'https://image.tmdb.org/t/p/original/iE3s0lG5QVdEHOEZnoAxjmMtvne.jpg',
                        99: 'https://image.tmdb.org/t/p/original/b0WmHGc8LHTdGCVzxRb3IBMur57.jpg',
                        10749: 'https://image.tmdb.org/t/p/original/7TdALqc9gJK96xCvKTN3RbucSPT.jpg',
                        10768: 'https://image.tmdb.org/t/p/original/7FIKU4JSqIxmJGIXq0gAwCvnC9p.jpg',
                        80: 'https://image.tmdb.org/t/p/original/or0E36KfzJYZwqXeiCfm1JgepKF.jpg',
                        9648: 'https://image.tmdb.org/t/p/original/lJA2RCMfsWCO3GutzLdaG2I7MOq.jpg',
                        10764: 'https://image.tmdb.org/t/p/original/75nWz57HcNcJ4SLQ3rKCLq5fMFQ.jpg'
                      }
                    };
                    
                    // Fallback en cas d'erreur de chargement d'image
                    if (mediaType === 'movie' && genreId in fallbackImages.movie) {
                      (e.target as HTMLImageElement).src = fallbackImages.movie[genreId];
                    } else if (mediaType === 'tv' && genreId in fallbackImages.tv) {
                      (e.target as HTMLImageElement).src = fallbackImages.tv[genreId];
                    } else {
                      (e.target as HTMLImageElement).src = mediaType === 'movie'
                        ? 'https://image.tmdb.org/t/p/original/vt5XUYVnU3LNubLPCQHGPbWGUa1.jpg'
                        : 'https://image.tmdb.org/t/p/original/56v2KjBlU4XaOv9rVYEQypROD7P.jpg';
                    }
                  }}
                />
              )}
              <div className="absolute inset-0 flex items-center justify-center z-20">
                <motion.h3 
                  className="text-white font-bold text-center text-lg md:text-xl px-2 py-1 rounded-md"
                  initial={{ y: 0 }}
                  animate={{ 
                    y: selectedGenreId === genreId ? -5 : 0,
                    textShadow: selectedGenreId === genreId ? "0 0 10px rgba(255,255,255,0.8)" : "none"
                  }}
                >
                  {GENRES[genreId]}
                </motion.h3>
              </div>
            </motion.div>
          ))}
        </div>

        {showRightButton && (
          <motion.button
            onClick={() => scroll('right')}
            className="absolute right-0 top-0 bottom-0 bg-gradient-to-l from-black to-transparent px-5 z-30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center h-full"
            aria-label={t('genres.scrollRight')}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            <div className="bg-black/40 rounded-full p-2.5">
              <ChevronRight className="w-6 h-6 text-white" />
            </div>
          </motion.button>
        )}
      </div>
    </motion.div>
  );
};

export default GenreGrid; 