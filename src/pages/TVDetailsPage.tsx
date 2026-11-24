import { lazy, Suspense } from 'react';
import TVDetails from './TVDetails';
import { lazyWithRetry } from '@/routing/lazyWithRetry';
import DetailsRouteSkeleton from '@/components/skeletons/DetailsRouteSkeleton';
import { useDetailsPageStyle } from '@/utils/detailsPageStyle';

// L'ancienne fiche n'est téléchargée que par ceux qui l'ont choisie.
const TVDetailsLegacy = lazy(() =>
  lazyWithRetry(() => import('./legacy/TVDetailsLegacy'), { routeKey: '/tv/:id' }),
);

/** Fiche série : nouveau style par défaut, ancien style si choisi dans les paramètres. */
const TVDetailsPage = () => {
  const style = useDetailsPageStyle();
  if (style !== 'classic') return <TVDetails />;
  return (
    <Suspense fallback={<DetailsRouteSkeleton mediaType="tv" />}>
      {/* L'application ne pose plus la marge du haut sur /tv/ : l'ancienne fiche la remet. */}
      <div className="pt-20">
        <TVDetailsLegacy />
      </div>
    </Suspense>
  );
};

export default TVDetailsPage;
