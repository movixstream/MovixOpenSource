import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/components/ui/Skeleton';
import MediaCardSkeleton from './MediaCardSkeleton';

interface GridSkeletonProps {
  count?: number;
  gridClassName?: string;
  viewType?: 'grid' | 'list';
}

const GridSkeleton = ({
  count = 20,
  gridClassName = 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6',
  viewType = 'grid',
}: GridSkeletonProps) => {
  const { t } = useTranslation();
  return (
    <div
      className={cn('animate-skeleton-fade', viewType === 'grid' ? `grid ${gridClassName} gap-3` : 'flex flex-col gap-3')}
      aria-hidden="true"
    >
      {Array.from({ length: count }, (_, index) => viewType === 'grid' ? (
        <MediaCardSkeleton key={index} />
      ) : (
        <div key={index} className="flex gap-4 p-4 rounded-xl bg-white/5 border border-white/10">
          <div className="relative flex-shrink-0 w-20 h-28 sm:w-24 sm:h-36">
            <Skeleton height="100%" className="!rounded-lg" />
            <div className="absolute top-1 left-1"><Skeleton width={40} height={23} baseColor="#2a2a2a" /></div>
          </div>
          <div className="flex-1 min-w-0 flex flex-col justify-between">
            <div>
              <Skeleton height={24} width="65%" />
              <div className="flex items-center gap-3 mt-1">
                <Skeleton width={44} height={20} />
                <Skeleton width={48} height={20} />
              </div>
              <div className="mt-2 space-y-1 py-0.5">
                <Skeleton height={16} />
                <Skeleton height={16} width="85%" />
              </div>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <div className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg">
                <span className="invisible w-4 h-4" />
                <span className="invisible text-xs hidden md:inline">{t('search.watchlist')}</span>
                <div className="absolute inset-0"><Skeleton height="100%" className="!rounded-lg" /></div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default GridSkeleton;
