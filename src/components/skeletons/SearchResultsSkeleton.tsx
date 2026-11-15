import { Skeleton } from '@/components/ui/Skeleton';
import GridSkeleton from './GridSkeleton';

interface SearchResultsSkeletonProps {
  gridClassName: string;
  viewType: 'grid' | 'list';
  count?: number;
}

const PaginationSkeleton = () => (
  <div className="flex justify-center items-center gap-1.5 flex-wrap my-6">
    {Array.from({ length: 7 }, (_, index) => <Skeleton key={index} variant="circle" width={40} height={40} />)}
  </div>
);

const SearchResultsSkeleton = ({ gridClassName, viewType, count }: SearchResultsSkeletonProps) => (
  <div aria-hidden="true">
    <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
      <Skeleton width={220} height={20} />
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1">
          <Skeleton width={34} height={34} className="!rounded-xl" />
          <Skeleton width={34} height={34} className="!rounded-xl" />
        </div>
        {viewType === 'grid' && <Skeleton width={140} height={38} className="!rounded-lg" />}
      </div>
    </div>
    <PaginationSkeleton />
    <GridSkeleton gridClassName={gridClassName} viewType={viewType} count={count} />
    <div className="mt-8">
      <Skeleton width={120} height={20} containerClassName="flex justify-center mb-2" />
      <PaginationSkeleton />
    </div>
  </div>
);

export default SearchResultsSkeleton;
