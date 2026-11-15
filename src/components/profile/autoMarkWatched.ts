// Marque automatiquement comme vu un épisode regardé à plus de 85 %, et un
// film à 95 % ou plus (en dessous, il reste dans l'onglet « En cours »).
//
// Repris de l'ancienne page profil, avec deux différences voulues : la passe
// ne tourne qu'une fois par session de navigation (avant : à chaque montage,
// et à chaque ouverture de l'éditeur de nom), et les appels TMDB passent par
// fetchTmdb, mis en cache et lancés en parallèle.

import { fetchTmdb, readJson, readStoredArray, readStoredRecord } from './storage';

const DONE_FLAG = 'profile_auto_mark_done';
const WATCHED_THRESHOLD = 85;
// Même seuil que « Terminé » de l'historique serveur (film à 95 % ou plus).
const MOVIE_WATCHED_THRESHOLD = 95;

interface ProgressData {
  position?: number;
  duration?: number;
}

const percentOf = (key: string): number => {
  const progress = readJson<ProgressData | null>(key, null);
  if (!progress?.position || !progress?.duration) return 0;
  return (progress.position / progress.duration) * 100;
};

interface StoredItem {
  id?: unknown;
  type?: string;
  title?: string;
  poster_path?: string;
  addedAt?: string;
}

interface UnknownTitles {
  movie: string;
  series: string;
}

export async function autoMarkWatched(unknown: UnknownTitles, force = false): Promise<boolean> {
  try {
    if (!force && sessionStorage.getItem(DONE_FLAG) === '1') return false;
    sessionStorage.setItem(DONE_FLAG, '1');
  } catch {
    // sessionStorage indisponible : on fait la passe quand même.
  }

  let changed = false;
  const watchedMovies = readStoredArray<StoredItem | null>('watched_movie');
  const continueWatching = readJson<{ movies?: unknown[] }>('continueWatching', {});

  // Films : continueWatching.movies contient des id (ancien format) ou des objets.
  const movieIds = (Array.isArray(continueWatching.movies) ? continueWatching.movies : [])
    .map((entry) => (typeof entry === 'object' && entry ? (entry as { id?: unknown }).id : entry))
    .filter((id): id is number => typeof id === 'number')
    .filter((id) => !watchedMovies.some((item) => item?.id === id) && percentOf(`progress_${id}`) >= MOVIE_WATCHED_THRESHOLD);

  const movies = await Promise.all(movieIds.map(async (id) => ({ id, data: await fetchTmdb(`/movie/${id}`) })));
  movies.forEach(({ id, data }) => {
    if (!data) return;
    watchedMovies.unshift({
      id,
      type: 'movie',
      title: data.title || unknown.movie,
      poster_path: data.poster_path || '',
      addedAt: new Date().toISOString(),
    });
    changed = true;
  });
  if (movies.some(({ data }) => data)) {
    localStorage.setItem('watched_movie', JSON.stringify(watchedMovies));
  }

  // Épisodes : toute clé progress_tv_{id}_s{s}_e{e} au-delà du seuil.
  const showsWithEpisodes = new Set<number>();
  const pendingEpisodes = new Map<number, Record<string, boolean>>();
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    const progressMatch = key.match(/^progress_tv_(\d+)_s(\d+)_e(\d+)$/);
    if (progressMatch) {
      const showId = Number(progressMatch[1]);
      showsWithEpisodes.add(showId);
      if (percentOf(key) > WATCHED_THRESHOLD) {
        const episodeKey = `S${Number(progressMatch[2])}E${Number(progressMatch[3])}`;
        const episodes = pendingEpisodes.get(showId) ?? readStoredRecord(`watched_episodes_tv_${showId}`);
        if (!episodes[episodeKey]) {
          episodes[episodeKey] = true;
          pendingEpisodes.set(showId, episodes);
        }
      }
      continue;
    }
    const watchedMatch = key.match(/^watched_episodes_tv_(\d+)$/);
    if (watchedMatch) showsWithEpisodes.add(Number(watchedMatch[1]));
  }
  pendingEpisodes.forEach((episodes, showId) => {
    localStorage.setItem(`watched_episodes_tv_${showId}`, JSON.stringify(episodes));
    changed = true;
  });

  // Séries entières : tous les épisodes vus → ajout à watched_tv.
  const watchedTv = readStoredArray<StoredItem | null>('watched_tv');
  const candidates = [...showsWithEpisodes].filter((id) => !watchedTv.some((item) => item?.id === id));
  const shows = await Promise.all(candidates.map(async (id) => ({ id, data: await fetchTmdb(`/tv/${id}`) })));
  let tvChanged = false;
  shows.forEach(({ id, data }) => {
    const total = data?.number_of_episodes || 0;
    const seen = Object.keys(readStoredRecord(`watched_episodes_tv_${id}`)).length;
    if (!data || total <= 0 || seen < total) return;
    watchedTv.unshift({
      id,
      type: 'tv',
      title: data.name || unknown.series,
      poster_path: data.poster_path || '',
      addedAt: new Date().toISOString(),
    });
    tvChanged = true;
  });
  if (tvChanged) {
    localStorage.setItem('watched_tv', JSON.stringify(watchedTv));
    changed = true;
  }

  return changed;
}
