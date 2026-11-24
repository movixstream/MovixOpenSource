import React from 'react';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { Filter } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { genreSearchHref } from '@/utils/genreSearchLink';

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

// Images représentatives pour chaque genre
const GENRE_IMAGES: Record<number, string> = {
  28: '/genre-images/action.jpg',
  12: '/genre-images/adventure.jpg',
  16: '/genre-images/animation.jpg',
  35: '/genre-images/comedy.jpg',
  80: '/genre-images/crime.jpg',
  99: '/genre-images/documentary.jpg',
  18: '/genre-images/drama.jpg',
  10751: '/genre-images/family.jpg',
  14: '/genre-images/fantasy.jpg',
  36: '/genre-images/history.jpg',
  27: '/genre-images/horror.jpg',
  10402: '/genre-images/music.jpg',
  9648: '/genre-images/mystery.jpg',
  10749: '/genre-images/romance.jpg',
  878: '/genre-images/sci-fi.jpg',
  10770: '/genre-images/tv-movie.jpg',
  53: '/genre-images/thriller.jpg',
  10752: '/genre-images/war.jpg',
  37: '/genre-images/western.jpg',
  // TV specific genres
  10759: '/genre-images/action-adventure.jpg',
  10762: '/genre-images/kids.jpg',
  10763: '/genre-images/news.jpg',
  10764: '/genre-images/reality.jpg',
  10765: '/genre-images/sci-fi-fantasy.jpg',
  10766: '/genre-images/soap.jpg',
  10767: '/genre-images/talk.jpg',
  10768: '/genre-images/war-politics.jpg'
};

// Images de secours pour les genres qui n'ont pas d'image spécifique
const FALLBACK_IMAGES: Record<string, string> = {
  'movie': 'https://image.tmdb.org/t/p/original/vt5XUYVnU3LNubLPCQHGPbWGUa1.jpg', // Image d'action générique
  'tv': 'https://image.tmdb.org/t/p/original/56v2KjBlU4XaOv9rVYEQypROD7P.jpg' // Image de série générique
};

interface GenreFilterProps {
  mediaType: 'movie' | 'tv';
  onlyPopular?: boolean;
  visualMode?: boolean;
  className?: string;
}

const GenreFilter: React.FC<GenreFilterProps> = ({ 
  mediaType, 
  onlyPopular = false, 
  visualMode = false,
  className = ''
}) => {
  const { t } = useTranslation();
  const genresToShow = onlyPopular 
    ? getPopularGenres(mediaType)
    : Object.entries(GENRES)
        .filter(([_, name]) => name)
        .sort((a, b) => a[1].localeCompare(b[1]));
  
  // Si mode visuel, on n'affiche qu'une sélection limitée
  const displayGenres = visualMode 
    ? (onlyPopular ? genresToShow : genresToShow.slice(0, 8))
    : genresToShow;
  
  if (visualMode) {
    return (
      <div className={`mb-12 ${className}`}>
        <h2 className="text-2xl font-bold mb-6 px-4 md:px-8">
          {t('genres.findContentByGenre')}
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-8 gap-4 px-4 md:px-8">
          {displayGenres.map(([id, name]) => (
            <Link
              key={id}
              to={genreSearchHref(mediaType, id)}
              className="relative h-24 rounded-lg overflow-hidden group"
            >
              <div className="absolute inset-0 bg-black/30 group-hover:bg-black/40 transition-all z-10"></div>
              <img 
                src={getTMDBImageUrl(Number(id), mediaType)} 
                alt={name}
                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
              />
              <div className="absolute inset-0 flex items-center justify-center z-20">
                <h3 className="text-white font-semibold text-center text-sm">{name}</h3>
              </div>
            </Link>
          ))}
        </div>
      </div>
    );
  }
  
  return (
    <div className={`mb-8 ${className}`}>
      <div className="flex items-center mb-3 px-4 md:px-8">
        <Filter className="w-5 h-5 mr-2 text-primary" />
        <h2 className="text-lg font-semibold text-white">{t('genres.filterByGenre')}</h2>
      </div>
      
      <div className="flex flex-wrap gap-2 px-4 md:px-8">
        {displayGenres.map(([id, name]) => (
          <Link
            key={id}
            to={genreSearchHref(mediaType, id)}
            className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-full text-sm transition-colors"
          >
            {name}
          </Link>
        ))}
        
        {onlyPopular && (
          <Link
            to={`/${mediaType === 'movie' ? 'movies' : 'tv-shows'}#all-genres`}
            className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-full text-sm transition-colors text-primary"
          >
            {t('genres.seeAllGenres')}
          </Link>
        )}
      </div>
    </div>
  );
};

// Helper function to get popular genres based on media type
function getPopularGenres(mediaType: 'movie' | 'tv'): [string, string][] {
  const popularMovieGenres = [28, 12, 16, 35, 80, 18, 14, 27, 10749, 878, 53];
  const popularTVGenres = [10759, 16, 35, 80, 18, 10751, 10765, 10768, 9648];
  
  const popularGenres = mediaType === 'movie' ? popularMovieGenres : popularTVGenres;
  
  return popularGenres
    .filter(id => GENRES[id])
    .map(id => [id.toString(), GENRES[id]]);
}

// Function to get TMDB image URLs for genre backgrounds
function getTMDBImageUrl(genreId: number, mediaType: 'movie' | 'tv'): string {
  // Images fixes pour les genres spécifiques 
  const genreImageMap: Record<number, string> = {
    // Films
    28: 'https://image.tmdb.org/t/p/original/vJU3rXSP9hwUuLeq8IpfsJShLOk.jpg', // Action (Mad Max)
    12: 'https://image.tmdb.org/t/p/original/6NEJn9tGXgzVpHBwfVpEj6A3E1K.jpg', // Aventure (Indiana Jones) 
    16: 'https://image.tmdb.org/t/p/original/uXDfjJbdP4ijW5hWSBrPrlKpxab.jpg', // Animation (Toy Story)
    35: 'https://image.tmdb.org/t/p/original/ygmoiTM2aEgXqQxIzGEYJL52yEO.jpg', // Comédie (The Office)
    80: 'https://image.tmdb.org/t/p/original/eCWFJtYMJPUG4x6j9Qpbdwgo5wf.jpg', // Crime (Breaking Bad)
    99: 'https://image.tmdb.org/t/p/original/hEtNEj5i8mJqzNNUzYnwqkDdvZV.jpg', // Documentaire
    18: 'https://image.tmdb.org/t/p/original/iXXUZgBN6c4uANbY8CS1UYoADy3.jpg', // Drame (Joker)
    10751: 'https://image.tmdb.org/t/p/original/rKxpATRc3XjdSSaYEzbF8TQnMft.jpg', // Famille
    14: 'https://image.tmdb.org/t/p/original/kXfqcdQKsToO0OUXHcrrNCHDBzO.jpg', // Fantastique (Harry Potter)
    27: 'https://image.tmdb.org/t/p/original/r5LFxT6hpL8brSK8sb7isOxWbAd.jpg', // Horreur (The Conjuring)
    9648: 'https://image.tmdb.org/t/p/original/j1rZ5gSWZw9oVF7L0Qju6lqKYv0.jpg', // Mystère
    10749: 'https://image.tmdb.org/t/p/original/3CxUndGhUcZdt1Zggjdb2HkLLQX.jpg', // Romance
    878: 'https://image.tmdb.org/t/p/original/4m4S2HgwbJcjyo5VjZS3UQeJD4B.jpg', // Science-Fiction (Dune)
    53: 'https://image.tmdb.org/t/p/original/2QL5j6mB4ZpyBcVr0WO9H9MQGBu.jpg', // Thriller
    10752: 'https://image.tmdb.org/t/p/original/44sKJOGP3fTm4QXBcIuqu0RkdP7.jpg', // Guerre (1917)
    37: 'https://image.tmdb.org/t/p/original/ow3wq89wM8qd5X7hWKxiRfsFf9C.jpg', // Western
    
    // Séries TV
    10759: 'https://image.tmdb.org/t/p/original/56v2KjBlU4XaOv9rVYEQypROD7P.jpg', // Action & Aventure
    10765: 'https://image.tmdb.org/t/p/original/mEsoFzMxhJ7zIyYhb2hGYq2IpjZ.jpg', // Science-Fiction & Fantastique
    10768: 'https://image.tmdb.org/t/p/original/dA4dfdCmvZ1vmuFbqQiLMAJ8k5c.jpg', // Guerre & Politique
  };
  
  // Retourner l'image correspondante au genre ou une image de secours
  return genreImageMap[genreId] || FALLBACK_IMAGES[mediaType];
}

export default GenreFilter; 