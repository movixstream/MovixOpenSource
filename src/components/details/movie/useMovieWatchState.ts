import { useEffect, useState } from 'react';
import { useTitleHistory } from '@/hooks/useTitleHistory';
import { readLocalStorage, writeLocalStorage } from '@/utils/browserStorage';
import { localProgressFinished, movieResume, movieWatchedState, seedProgress } from '@/utils/titleHistoryMerge';
import { readStoredMediaList, updateStoredMediaList } from '../storedLists';

export interface MovieWatchStatus {
  watchlist: boolean;
  favorite: boolean;
  watched: boolean;
}

/** Reprise locale : au moins 30 s vues et moins de 95 % du film. */
function readLocalResume(id: string): { position: number; duration: number } | null {
  const saved = readLocalStorage(`progress_${id}`);
  if (!saved) return null;
  try {
    const progress = JSON.parse(saved);
    if (!progress.position || !progress.duration) return null;
    const percentage = (progress.position / progress.duration) * 100;
    return progress.position > 30 && percentage < 95 ? { position: progress.position, duration: progress.duration } : null;
  } catch (error) {
    console.error('Error parsing progress data:', error);
    return null;
  }
}

/**
 * Listes locales (à voir, favoris, vus) et reprise du film. L'historique
 * serveur (autre appareil, lecteurs web, « Déjà vu ») comble ce que le
 * stockage local n'a pas ; le local gagne toujours.
 */
export function useMovieWatchState(id: string | null, movie: { title?: string; poster_path?: string } | null) {
  const [watchStatus, setWatchStatus] = useState<MovieWatchStatus>({ watchlist: false, favorite: false, watched: false });
  const [localResume, setLocalResume] = useState<{ position: number; duration: number } | null>(null);
  const titleHistory = useTitleHistory('movie', id);

  useEffect(() => {
    const has = (key: string) => (readStoredMediaList(key) ?? []).some((item) => item?.id === Number(id));
    setWatchStatus({ watchlist: has('watchlist_movie'), favorite: has('favorite_movie'), watched: has('watched_movie') });
    setLocalResume(id ? readLocalResume(id) : null);
  }, [id]);

  const toggleWatchStatus = (type: keyof MovieWatchStatus) => {
    setWatchStatus((previous) => {
      const value = !previous[type];
      const item = {
        id: Number(id),
        type: 'movie',
        title: movie?.title || '',
        poster_path: movie?.poster_path || '',
        addedAt: new Date().toISOString(),
      };
      const persisted = updateStoredMediaList(`${type}_movie`, (items) => (
        value
          ? [item, ...items.filter((entry) => entry?.id !== Number(id))]
          : items.filter((entry) => entry?.id !== Number(id))
      ));
      return persisted ? { ...previous, [type]: value } : previous;
    });
  };

  // Vu et reprise fusionnés avec le serveur. Une clé progress_ locale, même
  // finie, gagne : le serveur ne sert que s'il n'y en a pas.
  const watchedView = movieWatchedState(
    watchStatus.watched,
    id ? localProgressFinished(readLocalStorage(`progress_${id}`)) : false,
    titleHistory,
  );
  const serverResume = id && !localResume && !readLocalStorage(`progress_${id}`) ? movieResume(null, titleHistory) : null;

  /**
   * Reprise venue du serveur : le lecteur ne lit que progress_ local, on y
   * recopie la position exacte (jamais un estimé de lecteur web). Relu au
   * clic : une position locale apparue depuis le rendu gagne.
   */
  const seedServerResume = () => {
    if (!id) return;
    const seed = serverResume && !readLocalStorage(`progress_${id}`)
      ? seedProgress(serverResume, new Date().toISOString())
      : null;
    if (seed) writeLocalStorage(`progress_${id}`, seed);
  };

  return { watchStatus, toggleWatchStatus, localResume, serverResume, watchedView, seedServerResume };
}
