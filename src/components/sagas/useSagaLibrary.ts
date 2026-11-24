// Watchlist et favoris des collections, lus dans le stockage local.
//
// L'état est lu dès le montage, sans attendre que les collections soient
// chargées : une carte sait donc tout de suite si sa collection est déjà
// enregistrée, qu'elle vienne du cache, de l'API, du défilement ou de la
// recherche.

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { SagaSummary } from './types';

const WATCHLIST_KEY = 'watchlist_collections';
const FAVORITES_KEY = 'favorite_collections';

type StoredSaga = { id?: unknown } | null;

const readList = (key: string): StoredSaga[] | null => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? (parsed as StoredSaga[]) : null;
  } catch {
    return null;
  }
};

const readIds = (key: string): Set<number> => {
  const ids = new Set<number>();
  for (const entry of readList(key) ?? []) {
    if (entry && typeof entry.id === 'number') ids.add(entry.id);
  }
  return ids;
};

/** Ajoute ou retire la collection ; null si le stockage a refusé. */
const toggleStored = (key: string, saga: SagaSummary): boolean | null => {
  const list = readList(key);
  // Une lecture refusée ou invalide ne doit jamais écraser la liste.
  if (!list) return null;
  const exists = list.some((entry) => entry?.id === saga.id);
  const nextList = exists
    ? list.filter((entry) => entry?.id !== saga.id)
    : [{
        id: saga.id,
        name: saga.name,
        poster_path: saga.poster_path,
        backdrop_path: saga.backdrop_path,
        overview: saga.overview,
        type: 'collection',
        addedAt: new Date().toISOString(),
      }, ...list];
  try {
    localStorage.setItem(key, JSON.stringify(nextList));
  } catch {
    return null;
  }
  return !exists;
};

export interface SagaLibrary {
  watchlist: ReadonlySet<number>;
  favorites: ReadonlySet<number>;
  toggleWatchlist: (saga: SagaSummary) => void;
  toggleFavorite: (saga: SagaSummary) => void;
}

export function useSagaLibrary(): SagaLibrary {
  const { t } = useTranslation();
  const [watchlist, setWatchlist] = useState(() => readIds(WATCHLIST_KEY));
  const [favorites, setFavorites] = useState(() => readIds(FAVORITES_KEY));

  // Autre onglet (`storage` avec sa clé), ou événement du site sans clé :
  // synchronisation du compte qui vient de réécrire le stockage.
  useEffect(() => {
    const onStorage = (event: Event) => {
      const key = (event as StorageEvent).key ?? null;
      if (key === null || key === WATCHLIST_KEY) setWatchlist(readIds(WATCHLIST_KEY));
      if (key === null || key === FAVORITES_KEY) setFavorites(readIds(FAVORITES_KEY));
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('sync_storage_updated', onStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('sync_storage_updated', onStorage);
    };
  }, []);

  const toggleWatchlist = useCallback((saga: SagaSummary) => {
    if (toggleStored(WATCHLIST_KEY, saga) === null) {
      toast.error(t('lists.saveFailed'));
      return;
    }
    setWatchlist(readIds(WATCHLIST_KEY));
  }, [t]);

  const toggleFavorite = useCallback((saga: SagaSummary) => {
    if (toggleStored(FAVORITES_KEY, saga) === null) {
      toast.error(t('lists.saveFailed'));
      return;
    }
    setFavorites(readIds(FAVORITES_KEY));
  }, [t]);

  return { watchlist, favorites, toggleWatchlist, toggleFavorite };
}
