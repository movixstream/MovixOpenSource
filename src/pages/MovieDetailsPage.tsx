import { lazy, Suspense } from 'react';
import MovieDetails from './MovieDetails';
import { lazyWithRetry } from '@/routing/lazyWithRetry';
import DetailsRouteSkeleton from '@/components/skeletons/DetailsRouteSkeleton';
import { useDetailsPageStyle } from '@/utils/detailsPageStyle';

// L'ancienne fiche n'est téléchargée que par ceux qui l'ont choisie.
const MovieDetailsLegacy = lazy(() =>
  lazyWithRetry(() => import('./legacy/MovieDetailsLegacy'), { routeKey: '/movie/:id' }),
);

/** Fiche film : nouveau style par défaut, ancien style si choisi dans les paramètres. */
const MovieDetailsPage = () => {
  const style = useDetailsPageStyle();
  if (style !== 'classic') return <MovieDetails />;
  return (
    <Suspense fallback={<DetailsRouteSkeleton />}>
      {/* L'application ne pose plus la marge du haut sur /movie/ : l'ancienne fiche la remet. */}
      <div className="pt-20">
        <MovieDetailsLegacy />
      </div>
    </Suspense>
  );
};

export default MovieDetailsPage;
