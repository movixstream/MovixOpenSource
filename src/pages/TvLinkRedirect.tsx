import { Navigate, useLocation } from 'react-router-dom';

/**
 * `/tv?code=K7P2Q` : adresse du QR affiché par l'appli télé. On garde la
 * recherche (le code) et on vise la section de liaison de la page Appli TV.
 * Les fiches séries restent sur `/tv/:id`.
 */
const TvLinkRedirect = () => {
  const { search } = useLocation();
  return <Navigate to={{ pathname: '/app-tv', search, hash: '#relier' }} replace />;
};

export default TvLinkRedirect;
