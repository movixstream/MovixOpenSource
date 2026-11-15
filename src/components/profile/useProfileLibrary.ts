// Données des listes « À voir », « Favoris » et « Déjà vu » du profil actif.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { autoMarkWatched } from './autoMarkWatched';
import {
  LIVE_TV_FAVORITES_STORAGE_KEY,
  SHARED_LIST_FAVORITES_STORAGE_KEY,
  enrichMissingMetadata,
  readMainList,
  removeFromMainListStorage,
} from './storage';
import type { MainListType, WatchItem } from './types';

/** Préfixes des clés qui touchent une liste principale (pour savoir quand relire). */
const LIBRARY_KEY_PATTERN = /^(watchlist|watched)_|^favorites?_|^watched_episodes_tv_/;
const EXTRA_KEYS = new Set([SHARED_LIST_FAVORITES_STORAGE_KEY, LIVE_TV_FAVORITES_STORAGE_KEY]);

export function useProfileLibrary() {
  const { t } = useTranslation();
  const [lists, setLists] = useState<Record<MainListType, WatchItem[]>>({ watchlist: [], favorites: [], watched: [] });
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const current = ++generation.current;
    // Lecture locale d'abord : la page s'affiche tout de suite.
    const local = {
      watchlist: readMainList('watchlist'),
      favorites: readMainList('favorites'),
      watched: readMainList('watched'),
    };
    setLists(local);
    setLoading(false);

    // Puis les titres et affiches manquants des anciennes séries.
    const [watchlist, favorites, watched] = await Promise.all([
      enrichMissingMetadata(local.watchlist),
      enrichMissingMetadata(local.favorites),
      enrichMissingMetadata(local.watched),
    ]);
    if (current === generation.current) setLists({ watchlist, favorites, watched });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void reload();
    autoMarkWatched({
      movie: t('profilePage.collectionNames.unknownMovie'),
      series: t('profilePage.collectionNames.unknownSeries'),
    }).then((changed) => {
      if (changed && !cancelled) void reload();
    });
    return () => {
      cancelled = true;
    };
    // t change avec la langue ; la passe automatique ne doit tourner qu'une fois.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);

  // Relit quand un autre onglet ou la synchro serveur modifie la bibliothèque.
  useEffect(() => {
    let timer: number | undefined;
    const schedule = (event?: Event) => {
      const key = event instanceof StorageEvent ? event.key : null;
      if (key && !LIBRARY_KEY_PATTERN.test(key) && !EXTRA_KEYS.has(key)) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void reload(), 150);
    };
    window.addEventListener('storage', schedule);
    window.addEventListener('sync_storage_updated', schedule);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('storage', schedule);
      window.removeEventListener('sync_storage_updated', schedule);
    };
  }, [reload]);

  /** Retire un élément ; renvoie une fonction qui annule le retrait. */
  const removeItem = useCallback((item: WatchItem, listType: MainListType) => {
    const snapshot = new Map<string, string | null>();
    // Sauvegarde des clés touchées pour pouvoir annuler.
    const touched = [
      'favorite_movie', 'favorites_tv', 'favorite_collections',
      SHARED_LIST_FAVORITES_STORAGE_KEY, LIVE_TV_FAVORITES_STORAGE_KEY,
      `${listType}_movie`, `${listType}_tv`, `${listType}_collections`,
      `${listType}_tv_episodes`, `${listType}_episodes_tv_${item.id}`,
    ];
    touched.forEach((key) => snapshot.set(key, localStorage.getItem(key)));

    removeFromMainListStorage(item, listType);
    setLists((prev) => ({
      ...prev,
      [listType]: prev[listType].filter((entry) => !(entry.id === item.id && entry.type === item.type)),
    }));

    return () => {
      snapshot.forEach((value, key) => {
        if (value === null) {
          if (localStorage.getItem(key) !== null) localStorage.removeItem(key);
        } else if (localStorage.getItem(key) !== value) {
          localStorage.setItem(key, value);
        }
      });
      void reload();
    };
  }, [reload]);

  return { ...lists, loading, reload, removeItem };
}
