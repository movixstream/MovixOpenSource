import { PersonDetailsSkeleton } from '@/components/details/person/PersonDetailsSkeleton';
import { useDetailsPageStyle } from '@/utils/detailsPageStyle';

/**
 * Attente du code de la page d'une personne, selon le style choisi dans les
 * paramètres. L'ancienne page a son propre rond de chargement : ici, un fond
 * vide avec sa marge du haut.
 */
const PersonRouteSkeleton = () => {
  const style = useDetailsPageStyle();
  if (style === 'classic') return <div className="min-h-screen pt-20" />;
  return <PersonDetailsSkeleton />;
};

export default PersonRouteSkeleton;
