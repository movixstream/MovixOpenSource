// Historique serveur d'un titre pour sa fiche (film ou série). Un appel à
// l'ouverture de la fiche, puis au plus un toutes les 30 s au retour de
// `sync_storage_updated`. Invité, route absente, erreur ou import pas fini :
// null, la fiche garde son comportement local, sans message.

import { useEffect, useState } from 'react';
import { getTmdbLanguage } from '@/i18n';
import { fetchTitleHistory, type TitleHistory } from '@/services/historyService';

const SYNC_REFRESH_MS = 30_000;

export function useTitleHistory(type: 'movie' | 'tv', id: string | number | null | undefined): TitleHistory | null {
  const [state, setState] = useState<{ key: string; title: TitleHistory | null } | null>(null);
  const tmdbId = Number(id);
  const key = `${type}:${tmdbId}`;

  useEffect(() => {
    if (!Number.isInteger(tmdbId) || tmdbId <= 0) return;
    let cancelled = false;
    let lastFetch = 0;
    const load = () => {
      lastFetch = Date.now();
      void fetchTitleHistory({ type, id: tmdbId, language: getTmdbLanguage() }).then((result) => {
        if (!cancelled) setState({ key, title: result.ok ? result.title : null });
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
  }, [type, tmdbId, key]);

  // Jamais les données d'un autre titre pendant le chargement du suivant.
  return state && state.key === key ? state.title : null;
}
