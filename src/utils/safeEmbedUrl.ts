/**
 * URL d'embed sûre pour un `<iframe src>` : rend l'URL telle quelle si elle
 * est en http(s), une chaîne vide sinon.
 *
 * React 18 ne bloque pas `javascript:` dans `src` : un lien communautaire ou
 * scrapé de cette forme s'exécuterait sur l'origine du site, avec accès à la
 * session du visiteur. L'analyse passe par `URL`, comme le navigateur, pour
 * que les espaces et retours à la ligne glissés dans le schéma ne trompent
 * pas le contrôle.
 */
export const safeEmbedUrl = (rawUrl: string | null | undefined): string => {
  if (!rawUrl) return '';
  try {
    const { protocol } = new URL(rawUrl, window.location.href);
    return protocol === 'https:' || protocol === 'http:' ? rawUrl : '';
  } catch {
    return '';
  }
};
