// Types partagés par la page profil (/profile) et ses onglets.

export type ProfileMediaItemType = 'movie' | 'tv' | 'collection';
export type ProfileExtraFavoriteType = 'shared-list' | 'live-tv';
export type ProfileItemType = ProfileMediaItemType | ProfileExtraFavoriteType;

/** Onglets accessibles par `?tab=…` (sessions reste caché, lien direct seulement). */
export type ProfileTabId =
  | 'watchlist'
  | 'favorites'
  | 'watched'
  | 'history'
  | 'alerts'
  | 'custom-lists'
  | 'sessions';

export type MainListType = 'watchlist' | 'favorites' | 'watched';

export interface WatchItem {
  id: number | string;
  type: ProfileItemType;
  title: string;
  /** Les collections TMDB utilisent `name` au lieu de `title`. */
  name?: string;
  poster_path: string;
  searchText?: string;
  episodeInfo?: {
    season: number;
    episode: number;
  };
  addedAt: string;
  backdrop_path?: string | null;
  overview?: string;
  shareCode?: string;
  username?: string;
  itemCount?: number;
  isVip?: boolean;
  source?: string;
  liveTvKind?: 'channel' | 'iptv';
  liveTvTargetId?: string;
  liveTvCatalogId?: string;
  liveTvCategoryId?: string;
}

export interface CustomListItem {
  id: number;
  type: ProfileMediaItemType;
  title: string;
  name?: string;
  poster_path: string;
  addedAt: string;
  backdrop_path?: string | null;
  overview?: string;
  /** Nombre de films d'une saga, ajouté au chargement (jamais écrit en stockage). */
  movieCount?: number;
}

export interface CustomList {
  id: number;
  name: string;
  items: CustomListItem[];
}

export interface SharedListStatus {
  shareCode: string;
  sharedAt: number;
  isPublicInCatalog: boolean;
}

export interface LiveTVFavorite {
  key: string;
  source: string;
  id: string;
  name: string;
  poster?: string | null;
  addedAt: string;
  kind: 'channel' | 'iptv';
  catalogId?: string;
  categoryId?: string;
}
