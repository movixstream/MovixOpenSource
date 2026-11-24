// Avancement d'une saga : état de chaque film à partir du stockage local et
// de l'historique du serveur (GET /api/history/titles). Les décisions sont
// celles de la fiche film (`titleHistoryMerge`, mêmes clés de stockage), pour
// que les deux pages ne se contredisent jamais : le local gagne, le serveur
// comble ce qui manque.
// Module pur (types, et `titleHistoryMerge` qui l'est aussi), testé par node --test.

import type { SagaFilmProgress, SagaProgress } from '../hooks/useSagaProgress';
import type { TitleHistory } from '../services/historyService';
import { localProgressFinished, movieResume, movieWatchedState } from './titleHistoryMerge';

/** Ce que cet appareil sait d'un film : la marque « Vu » et la valeur brute de `progress_<id>`. */
export interface SagaLocalFilm {
  watched: boolean;
  progress: string | null;
}

/** Identifiants TMDB valides (entiers positifs) de la liste, sans doublon, dans l'ordre reçu. */
export function uniqueMovieIds(ids: readonly unknown[]): number[] {
  const unique = new Set<number>();
  for (const id of ids) {
    if (typeof id === 'number' && Number.isInteger(id) && id > 0) unique.add(id);
  }
  return [...unique];
}

// Films cochés « Vu » : entrées `{ id }` de `watched_movie`, avec la même
// comparaison stricte que la fiche film. Valeur abîmée → aucun film coché.
function markedMovieIds(raw: string | null): Set<number> {
  const marked = new Set<number>();
  try {
    const list: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(list)) return marked;
    for (const entry of list) {
      const id: unknown = typeof entry === 'object' && entry !== null ? (entry as { id?: unknown }).id : null;
      if (typeof id === 'number') marked.add(id);
    }
  } catch {
    // Illisible : comme sur la fiche, rien n'est coché.
  }
  return marked;
}

/**
 * État local des films d'une saga, avec les clés de la fiche film :
 * `watched_movie` (lue une fois) et `progress_<id>` pour chaque film.
 * @param read lecture du stockage (null si la clé est absente).
 */
export function readSagaLocal(ids: readonly number[], read: (key: string) => string | null): Map<number, SagaLocalFilm> {
  const marked = markedMovieIds(read('watched_movie'));
  const films = new Map<number, SagaLocalFilm>();
  for (const id of ids) films.set(id, { watched: marked.has(id), progress: read(`progress_${id}`) });
  return films;
}

// Position du lecteur lue dans `progress_<id>` ; illisible → null.
function localPosition(raw: string): { position: number; duration: number } | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const { position, duration } = value as { position?: unknown; duration?: unknown };
    return typeof position === 'number' && typeof duration === 'number' ? { position, duration } : null;
  } catch {
    return null;
  }
}

/**
 * État d'un film. Vu : coché « Vu » ou fini dans le lecteur sur cet appareil,
 * sinon terminé d'après le serveur (`estimated` si seul le temps passé dans un
 * lecteur web le dit, `watched` pour une marque ou une lecture d'un autre
 * appareil). En cours : la reprise que proposerait la fiche (plus de 30 s,
 * moins de 95 %) ; une clé `progress_<id>` locale, même illisible ou trop
 * courte, écarte la position du serveur.
 */
export function sagaFilmProgress(local: SagaLocalFilm | undefined, server: TitleHistory | null): SagaFilmProgress {
  const progress = local?.progress ?? null;
  const finishedHere = localProgressFinished(progress);
  const { toggleOn, serverWatched } = movieWatchedState(local?.watched === true, finishedHere, server);
  if (toggleOn || finishedHere || serverWatched === 'otherDevice') return { status: 'watched', ratio: null };
  if (serverWatched === 'estimated') return { status: 'estimated', ratio: null };

  const resume = progress ? movieResume(localPosition(progress), null) : movieResume(null, server);
  if (!resume) return { status: 'not_started', ratio: null };
  return { status: 'in_progress', ratio: Math.min(1, Math.max(0, resume.position / resume.duration)) };
}

/**
 * Avancement de la saga dans l'ordre reçu. Les identifiants invalides et les
 * doublons ne comptent pas (`total` = films distincts).
 * @param server réponse du serveur par identifiant ; null : pas (encore) de
 *   réponse, l'état local seul.
 */
export function computeSagaProgress(
  movieIds: readonly number[],
  local: ReadonlyMap<number, SagaLocalFilm>,
  server: ReadonlyMap<number, TitleHistory> | null,
  loading: boolean,
): SagaProgress {
  const films = new Map<number, SagaFilmProgress>();
  let watchedCount = 0;
  let nextId: number | null = null;
  for (const id of uniqueMovieIds(movieIds)) {
    const film = sagaFilmProgress(local.get(id), server?.get(id) ?? null);
    films.set(id, film);
    if (film.status === 'watched' || film.status === 'estimated') watchedCount++;
    else if (nextId === null) nextId = id;
  }
  return { films, watchedCount, total: films.size, nextId, loading };
}
