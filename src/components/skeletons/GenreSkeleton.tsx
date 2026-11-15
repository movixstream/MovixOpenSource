import React from 'react';
import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/components/ui/Skeleton';

// Même ordre que les genres du catalogue. La recherche exclut les genres TV
// spécifiques et Documentaire (SearchContext), ce qui laisse sept pastilles.
const MOVIE_GENRE_IDS = [28, 12, 16, 35, 80, 99, 18, 10751, 14, 36, 27, 10402, 9648, 10749, 878, 10770, 53, 10752, 37];
const TV_GENRE_IDS = [16, 35, 80, 18, 10751, 9648, 37];

const GenreSkeleton: React.FC<{ mediaType?: 'all' | 'movie' | 'tv' }> = ({ mediaType = 'all' }) => {
  const { t } = useTranslation();
  const genreIds = mediaType === 'tv' ? TV_GENRE_IDS : MOVIE_GENRE_IDS;
  return (
    <div className="flex flex-wrap gap-2 animate-skeleton-fade" aria-hidden="true">
      {genreIds.map(id => (
        <div key={id} className="relative px-4 py-2 rounded-full text-sm font-medium border border-white/10">
          <span className="invisible">{t(`genres.id_${id}`)}</span>
          <div className="absolute inset-0"><Skeleton variant="pill" height="100%" /></div>
        </div>
      ))}
    </div>
  );
};

export default GenreSkeleton;
