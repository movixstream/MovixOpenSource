// Avancement d'une saga : pour chaque film, ce que l'utilisateur en a vu.
// Le stockage local gagne toujours (bouton « Vu », reprise du lecteur) ;
// l'historique du serveur comble ce qui manque (autre appareil, « vu
// (estimé) » calculé sur le temps passé sur la fiche).
//
// L'état local est là dès le premier rendu, puis vient le serveur : un appel
// pour toute la saga à l'arrivée, ensuite au plus un toutes les 30 s au
// retour de `sync_storage_updated`. Invité, historique coupé, route absente
// ou erreur : l'état local seul, sans message. Le calcul est dans
// `utils/sagaProgress.ts`, avec les règles de la fiche film.

import { useEffect, useMemo, useState } from 'react';
import { getTmdbLanguage } from '@/i18n';
import { fetchTitlesHistory, serverHistoryProfile, type TitleHistory } from '@/services/historyService';
import { readLocalStorage } from '@/utils/browserStorage';
import { computeSagaProgress, readSagaLocal, uniqueMovieIds, type SagaLocalFilm } from '@/utils/sagaProgress';

export type SagaFilmStatus = 'watched' | 'estimated' | 'in_progress' | 'not_started';

export interface SagaFilmProgress {
  status: SagaFilmStatus;
  /** Avancement de 0 à 1 pour un film en cours, sinon null. */
  ratio: number | null;
}

export interface SagaProgress {
  /** État par identifiant TMDB ; un film absent vaut « not_started ». */
  films: ReadonlyMap<number, SagaFilmProgress>;
  /** Films vus : cochés « Vu », finis, vus sur un autre appareil ou vus (estimé). */
  watchedCount: number;
  total: number;
  /** Premier film pas encore vu, dans l'ordre reçu ; null si tout est vu ou si la liste est vide. */
  nextId: number | null;
  /** Vrai tant que la réponse du serveur n'est pas arrivée (l'état local est déjà là). */
  loading: boolean;
}

const SYNC_REFRESH_MS = 30_000;

/** Clés qui changent le profil interrogé, ou le droit de l'interroger. */
const OWNER_KEYS = new Set(['auth_token', 'selected_profile_id', 'settings_disable_history']);

/** Ce que cet appareil sait de la saga à un instant donné. */
interface LocalSnapshot {
  idsKey: string;
  /** Profil à demander au serveur ; null : invité ou historique coupé. */
  profile: string | null;
  films: Map<number, SagaLocalFilm>;
  /** Tout ce qui a été lu : un nouveau rendu seulement si une valeur a changé. */
  signature: string;
}

function readSnapshot(ids: readonly number[], idsKey: string): LocalSnapshot {
  const profile = serverHistoryProfile();
  const films = readSagaLocal(ids, readLocalStorage);
  return { idsKey, profile, films, signature: JSON.stringify([profile, [...films.values()]]) };
}

// Écriture d'un autre onglet (`storage` avec sa clé) : seulement les clés
// lues ici. Événement du site sans clé (synchro, `storage` émis à la main
// après une écriture dans cet onglet) : on relit.
function concernsSaga(event: Event): boolean {
  const key = typeof StorageEvent !== 'undefined' && event instanceof StorageEvent ? event.key : null;
  if (key === null) return true;
  return key === 'watched_movie' || key.startsWith('progress_') || OWNER_KEYS.has(key);
}

/** Réponse du serveur pour un profil et une saga (`key`) ; `titles` null après un échec. */
interface ServerAnswer {
  key: string;
  titles: ReadonlyMap<number, TitleHistory> | null;
}

/**
 * @param movieIds identifiants TMDB des films, dans l'ordre de la saga.
 */
export function useSagaProgress(movieIds: readonly number[]): SagaProgress {
  // La page peut passer un nouveau tableau à chaque rendu : tout dépend du
  // contenu de la liste (`idsKey`), jamais de l'identité du tableau.
  const idsKey = uniqueMovieIds(movieIds).join(',');
  const ids = useMemo(() => (idsKey === '' ? [] : idsKey.split(',').map(Number)), [idsKey]);

  // État local, lu dès le premier rendu. Autre saga : relu pendant le rendu,
  // jamais l'état de la précédente.
  const [stored, setStored] = useState(() => readSnapshot(ids, idsKey));
  const local = stored.idsKey === idsKey ? stored : readSnapshot(ids, idsKey);
  if (local !== stored) setStored(local);

  // « Vu » coché ailleurs, lecture finie, profil changé : relecture locale à
  // chaque événement du site qui peut l'annoncer.
  useEffect(() => {
    const refresh = (event?: Event) => {
      if (event && !concernsSaga(event)) return;
      const next = readSnapshot(ids, idsKey);
      setStored((previous) => (
        previous.idsKey !== next.idsKey || previous.signature === next.signature ? previous : next
      ));
    };
    // Une écriture a pu passer entre le premier rendu et l'abonnement.
    refresh();
    window.addEventListener('storage', refresh);
    window.addEventListener('sync_storage_updated', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('sync_storage_updated', refresh);
    };
  }, [ids, idsKey]);

  // Serveur : une réponse ne vaut que pour ce profil et cette saga.
  const requestKey = local.profile !== null && ids.length > 0 ? `${local.profile}|${idsKey}` : null;
  const [server, setServer] = useState<ServerAnswer | null>(null);

  useEffect(() => {
    if (requestKey === null) return;
    let cancelled = false;
    let lastFetch = 0;
    const load = () => {
      lastFetch = Date.now();
      void fetchTitlesHistory({ type: 'movie', ids, language: getTmdbLanguage() }).then((result) => {
        if (cancelled) return;
        setServer((previous) => {
          if (result.ok) return { key: requestKey, titles: result.titles };
          // Relecture ratée : la dernière réponse de cette saga reste affichée.
          return previous !== null && previous.key === requestKey ? previous : { key: requestKey, titles: null };
        });
      });
    };
    const onSync = () => {
      if (Date.now() - lastFetch >= SYNC_REFRESH_MS) load();
    };
    load();
    window.addEventListener('sync_storage_updated', onSync);
    return () => {
      cancelled = true;
      window.removeEventListener('sync_storage_updated', onSync);
    };
  }, [requestKey, ids]);

  const answer = server !== null && server.key === requestKey ? server : null;
  const titles = answer ? answer.titles : null;
  const loading = requestKey !== null && answer === null;
  const localFilms = local.films;

  return useMemo(() => computeSagaProgress(ids, localFilms, titles, loading), [ids, localFilms, titles, loading]);
}
