import type { CSSProperties, ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Skeleton } from '@/components/ui/Skeleton';
import MediaCardSkeleton from './MediaCardSkeleton';
import '../EmblaCarousel.css';

interface ContentRowSkeletonProps {
  title?: ReactNode;
  variant?: 'carousel' | 'posters';
  style?: CSSProperties;
  showRanking?: boolean;
  /** Réserver le gabarit d'une rangée encore éloignée sans monter ses skeletons. */
  reserveSpaceOnly?: boolean;
}

const ContentRowSkeleton = ({ title, variant = 'carousel', style, showRanking = false, reserveSpaceOnly = false }: ContentRowSkeletonProps) => {
  // ContentRow utilise encore des affiches de 150 × 225 ; les pages catalogue
  // et LazySection remplacent un EmblaCarousel (144 px, puis 192 px dès md).
  if (variant === 'posters') {
    return (
      <div className={`mb-8 ${reserveSpaceOnly ? '' : 'animate-skeleton-fade'}`} aria-hidden="true">
        <h2 className="text-2xl font-bold mb-4">{title ?? (reserveSpaceOnly ? <span className="block h-8" /> : <Skeleton width={192} height={32} />)}</h2>
        <div className="relative">
          <div className="flex overflow-hidden space-x-4">
            {reserveSpaceOnly ? <div className="h-[225px]" /> : Array.from({ length: 12 }, (_, index) => (
              <div key={index} className="flex-none w-[150px]">
                <Skeleton variant="poster" height={225} />
              </div>
            ))}
          </div>
          {!reserveSpaceOnly && <div className="absolute left-0 inset-y-0 hidden md:flex items-center justify-center w-16 bg-gradient-to-r from-black/50 to-transparent">
            <ChevronLeft className="w-8 h-8 text-white opacity-20" />
          </div>}
          {!reserveSpaceOnly && <div className="absolute right-0 inset-y-0 hidden md:flex items-center justify-center w-16 bg-gradient-to-l from-black/50 to-transparent">
            <ChevronRight className="w-8 h-8 text-white opacity-20" />
          </div>}
        </div>
      </div>
    );
  }

  return (
    <div className={`mb-4 content-row-container -mx-3 md:-mx-4 relative ${reserveSpaceOnly ? '' : 'animate-skeleton-fade'}`} style={style} aria-hidden="true">
      <div className="flex justify-between items-center mb-2 px-4 md:px-6 relative">
        {title ? <h2 className="section-title">{title}</h2> : (
          <div className="h-11 flex items-start pt-1.5 pb-2">
            {!reserveSpaceOnly && <Skeleton width={192} height={28} />}
          </div>
        )}
      </div>
      <div className={showRanking ? undefined : 'overflow-hidden'} style={showRanking ? { clipPath: 'inset(0 0 -12px 0)' } : undefined}>
        <div className="flex gap-4 px-4 md:px-6">
          {/* Même hauteur que l'affiche bordée : (largeur - 2px) × 3/2 + 2px.
              Les rangées éloignées n'ont besoin ni des 16 cartes ni de leurs animations. */}
          {reserveSpaceOnly ? <div className="h-[215px] md:h-[287px]" /> : Array.from({ length: 16 }, (_, index) => (
            <div key={index} className="flex-none relative w-[144px] md:w-[192px]">
              <MediaCardSkeleton />
              {showRanking && <div className="ranking-number" style={{ color: '#1a1a1a', WebkitTextStrokeColor: '#2a2a2a' }}>{index + 1}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ContentRowSkeleton;
