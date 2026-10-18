/**
 * Correspondance entre un lien de navigation et le périmètre TV du registry.
 *
 * Module pur (aucun import React) pour rester testable sous `node --test` :
 * le registry, lui, est du TSX qui charge des composants.
 */

/** Sous-ensemble de `RouteEntry` utile ici. */
export type ScopedRoute = { path: string; tvExcluded?: boolean };

/**
 * Vrai si `pathname` (un chemin concret, ex. `/watchparty/join/AB12`) satisfait
 * le motif de route `pattern` (ex. `/watchparty/join/:code`). Gère les segments
 * `:param` et le joker final `/*`, soit tout ce qu'utilise le registry.
 */
export function matchesRoutePattern(pattern: string, pathname: string): boolean {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean);

  const hasWildcard = patternParts[patternParts.length - 1] === '*';
  if (hasWildcard) patternParts.pop();

  if (hasWildcard ? pathParts.length < patternParts.length : pathParts.length !== patternParts.length) {
    return false;
  }
  return patternParts.every((part, i) => part.startsWith(':') || part === pathParts[i]);
}

/**
 * Vrai si le lien `href` mène à une route marquée `tvExcluded`. Les liens
 * externes ne sont jamais concernés ; query string et fragment sont ignorés.
 */
export function isPathTvExcluded(routes: readonly ScopedRoute[], href: string): boolean {
  if (!href.startsWith('/')) return false;
  const pathname = href.split(/[?#]/)[0];
  return routes.some((route) => route.tvExcluded === true && matchesRoutePattern(route.path, pathname));
}
