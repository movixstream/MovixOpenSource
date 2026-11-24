import { useEffect, useState } from 'react';
import type { DetailsStoredMedia } from '../storedLists';

export interface TvWatchStatus {
  watchlist: boolean;
  favorite: boolean;
  watched: boolean;
  /** Épisodes marqués, par clé `s1e1`. */
  episodeWatchlist: Record<string, boolean>;
  episodeWatched: Record<string, boolean>;
}

type SeriesStatus = 'watchlist' | 'favorite' | 'watched';
type EpisodeStatus = 'episodeWatchlist' | 'episodeWatched';

/** Listes locales de la série (les favoris s'écrivent `favorites_tv`). */
const SERIES_KEYS: Record<SeriesStatus, string> = {
  watchlist: 'watchlist_tv',
  favorite: 'favorites_tv',
  watched: 'watched_tv',
};

const EMPTY_STATUS: TvWatchStatus = { watchlist: false, favorite: false, watched: false, episodeWatchlist: {}, episodeWatched: {} };

/** Le stockage écrit les épisodes `S1E1`, la page les lit `s1e1`. */
const lowerCaseKeys = (episodes: Record<string, boolean>) => {
  const result: Record<string, boolean> = {};
  for (const key of Object.keys(episodes)) result[key.toLowerCase()] = episodes[key];
  return result;
};

function readTvWatchStatus(id: string): TvWatchStatus {
  const status: TvWatchStatus = { ...EMPTY_STATUS };
  try {
    const has = (key: string) => (JSON.parse(localStorage.getItem(key) || '[]') as DetailsStoredMedia[])
      .some((item) => item.id === Number(id));
    status.watchlist = has(SERIES_KEYS.watchlist);
    status.favorite = has(SERIES_KEYS.favorite);
    status.watched = has(SERIES_KEYS.watched);
    status.episodeWatchlist = lowerCaseKeys(JSON.parse(localStorage.getItem(`watchlist_episodes_tv_${id}`) || '{}'));
    status.episodeWatched = lowerCaseKeys(JSON.parse(localStorage.getItem(`watched_episodes_tv_${id}`) || '{}'));
  } catch (error) {
    console.error('Error loading watch status from localStorage:', error);
  }
  return status;
}

/** Marque ou démarque un épisode (`s1e1`) dans le stockage local. */
function persistEpisode(id: string, type: EpisodeStatus, episodeKey: string, value: boolean): boolean {
  const [season, episode] = episodeKey.replace('s', '').split('e');
  const storageEpisodeKey = `S${parseInt(season, 10)}E${parseInt(episode, 10)}`;
  const storageKey = `${type === 'episodeWatchlist' ? 'watchlist' : 'watched'}_episodes_tv_${id}`;
  try {
    const episodes = JSON.parse(localStorage.getItem(storageKey) || '{}');
    // Seul l'épisode est marqué : la série n'est pas ajoutée d'office à la
    // liste principale, pour garder la distinction entre « série entière
    // marquée » et « quelques épisodes marqués ».
    if (value) episodes[storageEpisodeKey] = true;
    else delete episodes[storageEpisodeKey];
    localStorage.setItem(storageKey, JSON.stringify(episodes));
    return true;
  } catch (error) {
    console.error(`Error updating ${type} in localStorage:`, error);
    return false;
  }
}

/** Ajoute ou retire la série d'une liste locale. */
function persistSeries(id: string, show: { name: string; poster_path: string }, type: SeriesStatus, value: boolean): boolean {
  const storageKey = SERIES_KEYS[type];
  try {
    let list = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (!Array.isArray(list)) list = [];
    if (value) {
      if (!list.some((media: DetailsStoredMedia) => media.id === Number(id))) {
        list.push({ id: Number(id), type: 'tv', title: show.name, poster_path: show.poster_path, addedAt: new Date().toISOString() });
        localStorage.setItem(storageKey, JSON.stringify(list));
      }
    } else {
      localStorage.setItem(storageKey, JSON.stringify(list.filter((media: DetailsStoredMedia) => media.id !== Number(id))));
    }
    return true;
  } catch (error) {
    console.error(`Error updating ${type} in localStorage:`, error);
    return false;
  }
}

/** Listes locales de la série et de ses épisodes (à voir, favoris, vus). */
export function useTvWatchStatus(id: string | null, tvShow: { name: string; poster_path: string } | null) {
  const [watchStatus, setWatchStatus] = useState<TvWatchStatus>(EMPTY_STATUS);

  useEffect(() => {
    if (id) setWatchStatus(readTvWatchStatus(id));
  }, [id]);

  const toggleSeries = (type: SeriesStatus) => {
    setWatchStatus((previous) => {
      const value = !previous[type];
      // Fiche pas encore chargée : l'état seul change.
      const persisted = id && tvShow ? persistSeries(id, tvShow, type, value) : true;
      return persisted ? { ...previous, [type]: value } : previous;
    });
  };

  const toggleEpisode = (type: EpisodeStatus, episodeKey: string) => {
    setWatchStatus((previous) => {
      const value = !previous[type][episodeKey];
      const persisted = id ? persistEpisode(id, type, episodeKey, value) : true;
      return persisted ? { ...previous, [type]: { ...previous[type], [episodeKey]: value } } : previous;
    });
  };

  return { watchStatus, toggleSeries, toggleEpisode };
}
