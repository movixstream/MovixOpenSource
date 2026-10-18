// Listes perso du profil : lecture du stockage, nombre de films des sagas
// (calculé via TMDB, jamais écrit) et sauvegarde.

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchTmdb, readCustomLists, writeCustomLists } from './storage';
import type { CustomList } from './types';

interface TmdbCollection {
  parts?: unknown[];
}

/** Pose les nombres de films déjà connus sur les sagas des listes. */
function applyCounts(lists: CustomList[], counts: Map<number, number>): CustomList[] {
  return lists.map((list) => ({
    ...list,
    items: list.items.map((item) => {
      if (item.type !== 'collection') return item;
      const count = counts.get(item.id);
      return count === undefined ? item : { ...item, movieCount: count };
    }),
  }));
}

export function useCustomLists(): {
  lists: CustomList[];
  saveLists: (next: CustomList[]) => void;
  loading: boolean;
} {
  const [lists, setLists] = useState<CustomList[]>([]);
  const [loading, setLoading] = useState(true);
  // Nombre de films par saga, gardé entre deux relectures du stockage.
  const countsRef = useRef(new Map<number, number>());
  // Chaque lecture ou sauvegarde invalide les enrichissements encore en vol :
  // une réponse TMDB tardive ne doit pas écraser une liste plus récente.
  const generationRef = useRef(0);

  const load = useCallback(async () => {
    const generation = ++generationRef.current;
    const stored = readCustomLists();
    const counts = countsRef.current;

    // Affichage immédiat avec les nombres déjà connus, sauf au premier
    // chargement où l'on attend les nombres pour ne pas afficher « 0 ».
    const missing = Array.from(new Set(
      stored.flatMap((list) => list.items)
        .filter((item) => item.type === 'collection' && !counts.has(item.id))
        .map((item) => item.id),
    ));

    if (missing.length === 0) {
      setLists(applyCounts(stored, counts));
      setLoading(false);
      return;
    }
    setLists((previous) => (previous.length > 0 ? applyCounts(stored, counts) : previous));

    // Toutes les sagas en parallèle (fetchTmdb met chaque chemin en cache).
    const fetched = await Promise.all(missing.map(async (id) => {
      const data = await fetchTmdb<TmdbCollection>(`/collection/${id}`);
      return [id, Array.isArray(data?.parts) ? data.parts.length : null] as const;
    }));
    fetched.forEach(([id, count]) => {
      if (count !== null) counts.set(id, count);
    });

    if (generation !== generationRef.current) return;
    setLists(applyCounts(stored, counts));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();

    const onStorage = (event: StorageEvent) => {
      if (event.key === 'custom_lists' || event.key === null) void load();
    };
    const onSync = () => { void load(); };

    window.addEventListener('storage', onStorage);
    window.addEventListener('sync_storage_updated', onSync);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('sync_storage_updated', onSync);
      generationRef.current += 1;
    };
  }, [load]);

  const saveLists = useCallback((next: CustomList[]) => {
    generationRef.current += 1;
    setLists(next);
    setLoading(false);
    writeCustomLists(next);
  }, []);

  return { lists, saveLists, loading };
}

export default useCustomLists;
