// Lecture et écriture des clés localStorage de la bibliothèque du profil.
//
// Les écritures passent toujours par localStorage.setItem/removeItem : App.tsx
// les intercepte pour les envoyer à /api/sync. Les noms de clés, y compris
// l'incohérence historique favorite_movie / favorites_tv, ne doivent pas
// changer (voir src/utils/syncStorage.ts).

import { TMDB_API_KEY, TMDB_API_URL } from '@/config/config';
import { getTmdbLanguage } from '@/i18n';
import { getTmdbImageUrl } from '@/utils/tmdbImages';
import {
  SHARED_LIST_FAVORITES_STORAGE_KEY,
  readSharedListFavorites,
  type SharedListFavorite,
} from '@/utils/sharedListFavorites';
import type {
  CustomList,
  CustomListItem,
  LiveTVFavorite,
  MainListType,
  ProfileMediaItemType,
  WatchItem,
} from './types';

export const LIVE_TV_FAVORITES_STORAGE_KEY = 'live_tv_favorite_channels';
export { SHARED_LIST_FAVORITES_STORAGE_KEY };

/** JSON.parse qui ne lève jamais : un stockage abîmé ne doit pas casser la page. */
export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export function readStoredArray<T>(key: string): T[] {
  const value = readJson<unknown>(key, []);
  return Array.isArray(value) ? (value as T[]) : [];
}

export function readStoredRecord(key: string): Record<string, boolean> {
  const value = readJson<unknown>(key, {});
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, boolean>)
    : {};
}

export const isTmdbWatchItem = (item: WatchItem): item is WatchItem & { id: number; type: ProfileMediaItemType } =>
  typeof item.id === 'number' && (item.type === 'movie' || item.type === 'tv' || item.type === 'collection');

export const isTvWatchItem = (item: WatchItem): item is WatchItem & { id: number; type: 'tv' } =>
  typeof item.id === 'number' && item.type === 'tv';

export const getWatchItemKey = (item: Pick<WatchItem, 'id' | 'type'>) => `${item.type}-${String(item.id)}`;

export const getWatchItemTitle = (item: Pick<WatchItem, 'type' | 'title' | 'name'>) =>
  (item.type === 'collection' ? item.name || item.title : item.title) || item.name || '';

/** Affiche TMDB à la bonne taille ; les URL complètes (avatars, chaînes) restent telles quelles. */
export function posterUrl(path: string | null | undefined, width = 342): string {
  if (!path || path === '/placeholder.jpg') return '';
  if (/^https?:\/\//i.test(path)) return path;
  return getTmdbImageUrl(path, { kind: 'poster', quality: 'auto', width });
}

export function backdropUrl(path: string | null | undefined, width = 1280): string {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return getTmdbImageUrl(path, { kind: 'backdrop', quality: 'auto', role: 'hero', width });
}

// --- TMDB --------------------------------------------------------------------

/** Champs TMDB lus par la page profil (films, séries, sagas). */
export interface TmdbDetails {
  id?: number;
  title?: string;
  name?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  overview?: string;
  number_of_episodes?: number;
  release_date?: string;
  first_air_date?: string;
  parts?: TmdbDetails[];
  [key: string]: unknown;
}

const tmdbCache = new Map<string, Promise<unknown>>();

/** GET TMDB mis en cache pour la session (une requête par chemin et par langue). */
export function fetchTmdb<T = TmdbDetails>(path: string): Promise<T | null> {
  const language = getTmdbLanguage();
  const cacheKey = `${language}:${path}`;
  const cached = tmdbCache.get(cacheKey);
  if (cached) return cached as Promise<T | null>;

  const separator = path.includes('?') ? '&' : '?';
  const request = fetch(`${TMDB_API_URL}${path}${separator}api_key=${TMDB_API_KEY}&language=${language}`)
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  tmdbCache.set(cacheKey, request);
  request.then((data) => {
    if (data === null) tmdbCache.delete(cacheKey);
  });
  return request as Promise<T | null>;
}

// --- Listes principales -------------------------------------------------------

const isLiveTVFavorite = (value: unknown): value is LiveTVFavorite => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<LiveTVFavorite>;
  return (
    typeof candidate.key === 'string' &&
    typeof candidate.source === 'string' &&
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.addedAt === 'string' &&
    (candidate.kind === 'channel' || candidate.kind === 'iptv')
  );
};

const readLiveTvFavorites = () => readStoredArray<unknown>(LIVE_TV_FAVORITES_STORAGE_KEY).filter(isLiveTVFavorite);

function sourceKeys(type: MainListType) {
  if (type === 'favorites') {
    return { movie: 'favorite_movie', tv: 'favorites_tv', collection: 'favorite_collections' };
  }
  return { movie: `${type}_movie`, tv: `${type}_tv`, collection: `${type}_collections` };
}

/** Lit une liste principale telle qu'elle est stockée, sans appel réseau. */
export function readMainList(type: MainListType): WatchItem[] {
  const keys = sourceKeys(type);
  const tvItems = readStoredArray<WatchItem>(keys.tv);
  let allItems: WatchItem[] = [
    ...readStoredArray<WatchItem>(keys.movie),
    ...tvItems,
    ...readStoredArray<WatchItem>(keys.collection),
  ];

  if (type === 'favorites') {
    const sharedLists: WatchItem[] = readSharedListFavorites().map((favorite: SharedListFavorite) => ({
      id: favorite.shareCode,
      type: 'shared-list',
      title: favorite.listName,
      poster_path: favorite.avatar || '',
      addedAt: favorite.addedAt,
      shareCode: favorite.shareCode,
      username: favorite.username,
      itemCount: favorite.itemCount,
      isVip: favorite.isVip,
      searchText: `${favorite.listName} ${favorite.username} ${favorite.shareCode}`,
    }));
    const liveTv: WatchItem[] = readLiveTvFavorites().map((favorite) => ({
      id: favorite.key,
      type: 'live-tv',
      title: favorite.name,
      poster_path: favorite.poster || '',
      addedAt: favorite.addedAt,
      source: favorite.source,
      liveTvKind: favorite.kind,
      liveTvTargetId: favorite.id,
      liveTvCatalogId: favorite.catalogId,
      liveTvCategoryId: favorite.categoryId,
      searchText: `${favorite.name} ${favorite.source} ${favorite.kind}`,
    }));
    allItems = [...allItems, ...sharedLists, ...liveTv];
  } else {
    // Anciens formats : `*_tv_episodes` (tableau) et `*_episodes_tv_{id}` (objet).
    const inMainList = new Set(tvItems.map((item) => item.id));
    const legacyShows = new Map<number, WatchItem>();
    readStoredArray<WatchItem>(`${type}_tv_episodes`).forEach((episode) => {
      if (typeof episode?.id !== 'number' || inMainList.has(episode.id)) return;
      const known = legacyShows.get(episode.id);
      if (!known || new Date(episode.addedAt) > new Date(known.addedAt)) {
        legacyShows.set(episode.id, {
          id: episode.id,
          type: 'tv',
          title: episode.title || '',
          poster_path: episode.poster_path || '',
          addedAt: episode.addedAt,
        });
      }
    });
    Object.keys(localStorage)
      .filter((key) => key.startsWith(`${type}_episodes_tv_`))
      .forEach((key) => {
        const showId = Number.parseInt(key.replace(`${type}_episodes_tv_`, ''), 10);
        if (!Number.isFinite(showId) || inMainList.has(showId) || legacyShows.has(showId)) return;
        if (Object.keys(readStoredRecord(key)).length === 0) return;
        legacyShows.set(showId, { id: showId, type: 'tv', title: '', poster_path: '', addedAt: new Date(0).toISOString() });
      });
    allItems = [...allItems, ...legacyShows.values()];
  }

  const unique = Array.from(new Map(allItems.filter(Boolean).map((item) => [getWatchItemKey(item), item])).values());
  return unique.sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime());
}

/** Complète titre et affiche des séries enregistrées sans métadonnées. */
export async function enrichMissingMetadata(items: WatchItem[]): Promise<WatchItem[]> {
  const missing = items.filter((item) => isTvWatchItem(item) && (!item.title || !item.poster_path));
  if (missing.length === 0) return items;
  const fetched = await Promise.all(missing.map(async (item) => {
    const data = await fetchTmdb<{ name?: string; poster_path?: string }>(`/tv/${item.id}`);
    return [getWatchItemKey(item), data] as const;
  }));
  const byKey = new Map(fetched);
  return items.map((item) => {
    const data = byKey.get(getWatchItemKey(item));
    if (!data) return item;
    return { ...item, title: item.title || data.name || '', poster_path: item.poster_path || data.poster_path || '' };
  });
}

/** Retire un élément d'une liste principale (et ses épisodes pour une série). */
export function removeFromMainListStorage(item: Pick<WatchItem, 'id' | 'type'>, listType: MainListType) {
  let key: string;
  if (listType === 'favorites') {
    key = item.type === 'movie' ? 'favorite_movie'
      : item.type === 'tv' ? 'favorites_tv'
        : item.type === 'shared-list' ? SHARED_LIST_FAVORITES_STORAGE_KEY
          : item.type === 'live-tv' ? LIVE_TV_FAVORITES_STORAGE_KEY
            : 'favorite_collections';
  } else {
    key = item.type === 'collection' ? `${listType}_collections` : `${listType}_${item.type}`;
  }

  const kept = readStoredArray<{ id?: unknown; key?: unknown; shareCode?: unknown } | null>(key).filter((entry) => {
    if (item.type === 'shared-list') return entry?.shareCode !== item.id;
    if (item.type === 'live-tv') return entry?.key !== item.id;
    return entry?.id !== item.id;
  });
  localStorage.setItem(key, JSON.stringify(kept));

  if (item.type === 'tv' && listType !== 'favorites') {
    const episodesKey = `${listType}_tv_episodes`;
    const episodes = readStoredArray<WatchItem>(episodesKey).filter((episode) => episode?.id !== item.id);
    localStorage.setItem(episodesKey, JSON.stringify(episodes));
    localStorage.removeItem(`${listType}_episodes_tv_${item.id}`);
  }
}

// --- Listes perso -------------------------------------------------------------

export function readCustomLists(): CustomList[] {
  const parsed = readJson<unknown>('custom_lists', []);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((list): list is CustomList =>
      list != null && typeof list === 'object' &&
      (typeof list.id === 'number' || typeof list.id === 'string') &&
      Number.isFinite(Number(list.id)) && typeof list.name === 'string')
    .map((list) => ({
      ...list,
      // AddToListMenu crée des identifiants Date.now() en chaîne.
      id: Number(list.id),
      items: Array.isArray(list.items)
        ? list.items.filter((item): item is CustomListItem =>
          item != null && typeof item === 'object' &&
          typeof item.id === 'number' && ['movie', 'tv', 'collection'].includes(item.type))
        : [],
    }));
}

/** Écrit les listes sans le champ calculé movieCount. */
export function writeCustomLists(lists: CustomList[]) {
  const clean = lists.map((list) => ({
    ...list,
    items: list.items.map(({ movieCount: _movieCount, ...item }) => item),
  }));
  localStorage.setItem('custom_lists', JSON.stringify(clean));
}
