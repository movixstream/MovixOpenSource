import { Skeleton } from '@/components/ui/Skeleton';
import HeroSkeleton from './HeroSkeleton';
import ContentRowSkeleton from './ContentRowSkeleton';

type CatalogVariant = 'home' | 'movies' | 'tv' | 'anime';

interface CatalogSkeletonProps {
  variant?: CatalogVariant;
  showPlatforms?: boolean;
}

const DiscoveryRowSkeleton = ({ platforms = false }: { platforms?: boolean }) => (
  <div className={`relative w-full ${platforms ? '-mx-3 md:-mx-4' : ''}`}>
    <div className="mb-2 px-4 md:px-6 h-11 flex items-start pt-1.5 pb-2">
      <Skeleton width={224} height={28} />
    </div>
    <div className="overflow-hidden">
      <div className={`flex pl-4 md:pl-6 ${platforms ? 'gap-6 pr-8 md:pr-16 py-8' : 'gap-4 md:gap-6 pr-4 md:pr-6 py-4'}`}>
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className={`flex-none relative rounded-xl overflow-hidden ${platforms ? 'w-[250px] h-[150px]' : 'w-[180px] h-[100px] md:w-[220px] md:h-[120px]'}`}>
            <Skeleton height="100%" className="!rounded-xl" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Skeleton width={platforms ? 110 : 90} height={platforms ? 40 : 24} baseColor="#2a2a2a" highlightColor="#333" />
            </div>
            {platforms && <div className="absolute bottom-2 inset-x-4"><Skeleton height={24} className="!rounded-lg" baseColor="#2a2a2a" highlightColor="#333" /></div>}
          </div>
        ))}
      </div>
    </div>
  </div>
);

const CatalogSkeleton = ({ variant = 'movies', showPlatforms = true }: CatalogSkeletonProps) => {
  const isHome = variant === 'home';
  // Les pages Films/Séries ont encore ce rythme propre à leur carrousel.
  // Le style explicite garde aussi le fallback de route identique, avant que
  // les styles de la page différée soient montés.
  const rowStyle = variant === 'movies' || variant === 'tv'
    ? { padding: '5px 0 40px', marginTop: -30 }
    : { padding: 0, marginTop: 0 };
  const rows = Array.from({ length: 3 }, (_, index) => (
    <div
      key={index}
      className={`px-4 md:px-8 ${isHome ? 'home-section mt-12 max-[900px]:mt-9 max-[640px]:mt-4' : ''}`}
    >
      <div style={{ contain: 'layout style' }}>
        <ContentRowSkeleton style={rowStyle} showRanking={!isHome && index === 0} />
      </div>
    </div>
  ));

  return (
    <div className={`w-full min-h-screen text-white overflow-hidden ${isHome ? 'relative z-10' : 'bg-black'}`} aria-hidden="true">
      <div className="relative w-full pt-16 md:pt-20 lg:pt-24"><HeroSkeleton /></div>
      {isHome ? (
        <>
          {showPlatforms && (
            <div className="home-section mt-12 max-[900px]:mt-9 max-[640px]:mt-4 w-full relative px-4 md:px-8">
              <div className="w-full overflow-hidden"><DiscoveryRowSkeleton platforms /></div>
            </div>
          )}
          {rows}
        </>
      ) : variant === 'movies' ? (
        <div className="pb-12 mt-8 relative">
          <div className="w-full py-6 relative px-4 md:px-8"><DiscoveryRowSkeleton /></div>
          {rows}
        </div>
      ) : (
        <>
          <div className="w-full py-6 relative mt-8 px-4 md:px-8"><DiscoveryRowSkeleton /></div>
          <div className="pb-12 -mt-4 relative">{rows}</div>
        </>
      )}
    </div>
  );
};

export default CatalogSkeleton;
