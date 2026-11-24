import DetailsSkeleton from './DetailsSkeleton';
import DetailsSkeletonLegacy from '@/pages/legacy/DetailsSkeletonLegacy';
import { useDetailsPageStyle } from '@/utils/detailsPageStyle';

/** Squelette de chargement d'une fiche, selon le style choisi dans les paramètres. */
const DetailsRouteSkeleton = ({ mediaType = 'movie' }: { mediaType?: 'movie' | 'tv' }) => {
  const style = useDetailsPageStyle();
  if (style === 'classic') {
    // L'ancienne fiche n'a pas d'image sous l'en-tête : elle garde la marge du haut.
    return (
      <div className="pt-20">
        <DetailsSkeletonLegacy mediaType={mediaType} />
      </div>
    );
  }
  return <DetailsSkeleton mediaType={mediaType} />;
};

export default DetailsRouteSkeleton;
