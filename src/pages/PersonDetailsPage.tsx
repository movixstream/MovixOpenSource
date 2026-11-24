import { lazy, Suspense } from 'react';
import { useParams } from 'react-router-dom';
import PersonDetails from './PersonDetails';
import { lazyWithRetry } from '@/routing/lazyWithRetry';
import { useDetailsPageStyle } from '@/utils/detailsPageStyle';

// L'ancienne page n'est téléchargée que par ceux qui ont choisi l'ancien style.
const PersonDetailsLegacy = lazy(() =>
  lazyWithRetry(() => import('./legacy/PersonDetailsLegacy'), { routeKey: '/person/:id' }),
);

/**
 * Page d'une personne : nouveau style par défaut, ancienne frise si l'ancien
 * style des fiches est choisi dans les paramètres. Une clé par personne : d'un
 * lien « Connu pour » à l'autre, filtres et biographie repartent de zéro.
 */
const PersonDetailsPage = () => {
  const style = useDetailsPageStyle();
  const { id } = useParams<{ id: string }>();
  if (style !== 'classic') return <PersonDetails key={id} />;
  return (
    <Suspense fallback={<div className="min-h-screen pt-20" />}>
      {/* L'application ne pose plus la marge du haut sur /person/ : l'ancienne page la remet. */}
      <div className="pt-20">
        <PersonDetailsLegacy />
      </div>
    </Suspense>
  );
};

export default PersonDetailsPage;
