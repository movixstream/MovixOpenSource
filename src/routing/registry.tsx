import type { ComponentType, ReactNode } from 'react';
import { lazyWithRetry } from './lazyWithRetry';
import { isPathTvExcluded } from './tvScope';
import { isTvPlatform } from '../utils/tvPlatform';
import DetailsSkeleton from '../components/skeletons/DetailsSkeleton';
import CatalogSkeleton from '../components/skeletons/CatalogSkeleton';

export type RouteEntry = {
  path: string;
  loader: (opts?: { silent?: boolean; routeKey?: string }) => Promise<{ default: ComponentType<unknown> }>;
  fallback?: ReactNode;
  guard?: 'private';
  getComponentKey?: (pathname: string) => string;
  /**
   * Hors périmètre V1 sur TV : la route n'est pas montée quand
   * `isTvPlatform()` est vrai (voir le filtrage dans App.tsx). Un lien profond
   * vers une route exclue tombe sur <NotFound />, ce qui suffit en V1.
   */
  tvExcluded?: boolean;
};

const lz = <P extends object>(loader: () => Promise<{ default: ComponentType<P> }>) =>
  (opts?: { silent?: boolean; routeKey?: string }) => lazyWithRetry(loader, opts) as Promise<{ default: ComponentType<unknown> }>;

export const getProviderCatalogScope = (pathname: string): string | null => {
  const match = pathname.match(/^\/provider\/([^/]+)\/(?:movies|tv)(?:\/[^/]+)?\/?$/);
  return match ? `/provider/${match[1]}` : null;
};

export const ROUTES: RouteEntry[] = [
  // Les fallbacks partagent le chargement de leur page. Les autres routes
  // gardent RouteProgressBar pendant l'import, sans fausse grille d'affiches.
  // Catalog pages
  { path: '/movies',                  loader: lz(() => import('../pages/Movies')),                  fallback: <CatalogSkeleton variant="movies" /> },
  { path: '/anime',                   loader: lz(() => import('../pages/Anime')),                   fallback: <CatalogSkeleton variant="anime" /> },
  { path: '/tv-shows',                loader: lz(() => import('../pages/TVShows')),                 fallback: <CatalogSkeleton variant="tv" /> },
  { path: '/collections',             loader: lz(() => import('../pages/Collections')) },
  { path: '/list-catalog',            loader: lz(() => import('../pages/SharedListsCatalogPage')) },
  { path: '/watchparty/list',         loader: lz(() => import('../pages/WatchPartyList')), tvExcluded: true },
  { path: '/wishboard',               loader: lz(() => import('../pages/Greenlight/WishboardPage')) },
  { path: '/vip/invoices',            loader: lz(() => import('../pages/VipInvoicesPage')), tvExcluded: true },
  { path: '/ftv',                     loader: lz(() => import('../pages/FranceTV/FranceTVBrowse')) },
  { path: '/top10',                   loader: lz(() => import('../pages/Top10Page')) },
  { path: '/calendar',                loader: lz(() => import('../pages/CalendarPage')) },

  // Provider catalogs
  { path: '/provider/:providerId',                          loader: lz(() => import('../pages/ProviderContent')) },
  {
    path: '/provider/:providerId/:type/:genreId?',
    loader: lz(() => import('../pages/ProviderCatalogPage')),
    getComponentKey: (pathname) => getProviderCatalogScope(pathname) ?? pathname,
  },

  // Details pages
  { path: '/movie/:id',               loader: lz(() => import('../pages/MovieDetails')),            fallback: <DetailsSkeleton /> },
  { path: '/tv/:id',                  loader: lz(() => import('../pages/TVDetails')),               fallback: <DetailsSkeleton mediaType="tv" /> },
  { path: '/collection/:id',          loader: lz(() => import('../pages/CollectionDetails')) },
  { path: '/person/:id',              loader: lz(() => import('../pages/PersonDetails')) },
  { path: '/list/:shareCode',         loader: lz(() => import('../pages/SharedListPage')) },

  // Genre
  { path: '/genre/:mediaType/:genreId', loader: lz(() => import('../pages/GenrePage')) },

  // Search
  { path: '/search',                  loader: lz(() => import('../pages/Search')) },

  // Watch routes (no skeleton — RouteProgressBar fallback)
  { path: '/watch/movie/:tmdbid',                         loader: lz(() => import('../pages/Watch/WatchMovie')) },
  { path: '/watch/tv/:tmdbid/s/:season/e/:episode',       loader: lz(() => import('../pages/Watch/WatchTv')) },
  { path: '/watch/anime/:id/season/:season/episode/:episode', loader: lz(() => import('../pages/Watch/WatchAnime')) },
  { path: '/live-tv',                 loader: lz(() => import('../pages/LiveTV')) },
  { path: '/ftv/info/:encoded',       loader: lz(() => import('../pages/FranceTV/FranceTVInfo')) },
  { path: '/ftv/watch/:encoded',      loader: lz(() => import('../pages/FranceTV/FranceTVPlayer')) },

  // Watch party
  { path: '/watchparty/create',       loader: lz(() => import('../pages/WatchPartyCreate')), tvExcluded: true },
  { path: '/watchparty/room/:roomId', loader: lz(() => import('../pages/WatchPartyRoom')), tvExcluded: true },
  { path: '/watchparty/join',         loader: lz(() => import('../pages/WatchPartyJoin')), tvExcluded: true },
  { path: '/watchparty/join/:code',   loader: lz(() => import('../pages/WatchPartyJoin')), tvExcluded: true },

  // Auth & profile
  { path: '/auth',                    loader: lz(() => import('../components/DiscordAuth')) },
  { path: '/auth/google',             loader: lz(() => import('../components/GoogleAuth')) },
  { path: '/oauth/authorize',         loader: lz(() => import('../pages/OAuthAuthorizePage')) },
  // Lien du QR de l'appli télé (/tv?code=K7P2Q) : redirige vers /app-tv#relier
  // en gardant le code. Un seul segment : React Router la sépare de /tv/:id.
  { path: '/tv',                      loader: lz(() => import('../pages/TvLinkRedirect')) },
  { path: '/profile',                 loader: lz(() => import('../pages/Profile')), guard: 'private' },
  { path: '/profile-management',      loader: lz(() => import('../pages/ProfileManagement')) },
  { path: '/alerts',                  loader: lz(() => import('../pages/AlertsPage')) },

  // Greenlight
  { path: '/wishboard/new',           loader: lz(() => import('../pages/Greenlight/WishboardNewRequest')) },
  { path: '/wishboard/my-requests',   loader: lz(() => import('../pages/Greenlight/WishboardUserRequests')) },
  { path: '/wishboard/submit-link',   loader: lz(() => import('../pages/Greenlight/SubmitLinkPage')) },

  // VIP
  { path: '/vip',                     loader: lz(() => import('../pages/VipPage')), tvExcluded: true },
  { path: '/vip/don',                 loader: lz(() => import('../pages/VipDonatePage')), tvExcluded: true },
  { path: '/vip/invoice/:publicId',   loader: lz(() => import('../pages/VipInvoicePage')), tvExcluded: true },
  { path: '/vip/cadeau/:giftToken',   loader: lz(() => import('../pages/VipGiftPage')), tvExcluded: true },

  // Other
  { path: '/about',                   loader: lz(() => import('../pages/WhatIsMovixPage')) },
  { path: '/help/*',                  loader: lz(() => import('../pages/help/HelpRouter')) },
  { path: '/privacy',                 loader: lz(() => import('../pages/Privacy')) },
  { path: '/terms-of-service',        loader: lz(() => import('../pages/TermsOfService')) },
  { path: '/cinegraph',               loader: lz(() => import('../pages/CineGraph')), tvExcluded: true },
  { path: '/settings',                loader: lz(() => import('../pages/SettingsPage')) },
  { path: '/wrapped',                 loader: lz(() => import('../pages/WrappedPage')), tvExcluded: true },
  { path: '/wrapped/:year',           loader: lz(() => import('../pages/WrappedPage')), tvExcluded: true },
  { path: '/frais',                   loader: lz(() => import('../pages/CostsPage')) },
  { path: '/admin',                   loader: lz(() => import('../pages/AdminPage')), tvExcluded: true },
  { path: '/download/:type/:id',      loader: lz(() => import('../pages/DownloadPage')) },
  { path: '/debrid',                  loader: lz(() => import('../pages/DebridPage')) },
  { path: '/roulette',                loader: lz(() => import('../pages/RoulettePage')) },
  { path: '/suggestion',              loader: lz(() => import('../pages/SuggestionPage')) },
  { path: '/extension',               loader: lz(() => import('../pages/ExtensionPage')) },
  { path: '/app',                     loader: lz(() => import('../pages/AppDownloadPage')) },
  { path: '/app-tv',                  loader: lz(() => import('../pages/TvAppPage')) },
];

/**
 * Vrai sur TV si `href` pointe vers une route hors périmètre V1 : sert à
 * masquer les entrées de menu qui mèneraient sinon à <NotFound />.
 */
export function isHiddenOnTv(href: string): boolean {
  return isTvPlatform() && isPathTvExcluded(ROUTES, href);
}
