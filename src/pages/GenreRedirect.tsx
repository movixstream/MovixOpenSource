import { Navigate, useParams } from 'react-router-dom';
import { genreSearchHref } from '@/utils/genreSearchLink';

/**
 * Ancienne adresse /genre/:mediaType/:genreId (favoris, liens partagés) :
 * renvoie vers la page recherche filtrée sur ce genre.
 */
export default function GenreRedirect(): JSX.Element {
  const { mediaType = 'movie', genreId = '' } = useParams<{ mediaType: string; genreId: string }>();
  return <Navigate replace to={genreSearchHref(mediaType, genreId)} />;
}
