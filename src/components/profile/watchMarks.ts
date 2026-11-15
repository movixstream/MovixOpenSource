// Marques « Déjà vu » posées depuis l'onglet « Historique ». Mêmes clés et
// même forme que la fiche film (MovieDetails), la fiche série (TVDetails) et
// le panneau des épisodes (TvEpisodePanel) :
// - `watched_movie` / `watched_tv` : tableaux de { id, type, title,
//   poster_path, addedAt } ; une série dans `watched_tv` = série entière vue
//   (la fiche série n'y ajoute aucun épisode) ;
// - `watched_episodes_tv_<id>` : objet { "S1E3": true, … }.
// Ces clés partent sur /api/sync et le serveur les recopie dans watch_marks.
//
// Module pur : chaque marque rend les valeurs à écrire (`after`, par
// localStorage.setItem, intercepté par la synchro) et `undo`, l'opération
// inverse calculée sur le stockage AU MOMENT de l'annulation : elle ne
// retire que ce que cette action a ajouté (ou remet ce qu'elle a retiré),
// sans écraser les marques posées depuis. Testé par node --test.

export type ReadStorage = (key: string) => string | null;

/** Écritures d'une marque et son annulation (null = retirer la clé). */
export interface StorageChange {
  after: Record<string, string>;
  undo: (read: ReadStorage) => Record<string, string | null>;
}

export interface MarkedTitle {
  id: number;
  title: string;
  posterPath: string | null;
}

export interface EpisodeRef {
  season: number;
  episode: number;
}

const listKey = (type: 'movie' | 'tv') => (type === 'movie' ? 'watched_movie' : 'watched_tv');
const episodesKey = (showId: number) => `watched_episodes_tv_${showId}`;

function parseArray(raw: string | null): unknown[] {
  try {
    const value = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function parseRecord(raw: string | null): Record<string, unknown> {
  try {
    const value = raw ? JSON.parse(raw) : {};
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

const hasId = (entry: unknown, id: number) =>
  typeof entry === 'object' && entry !== null && (entry as { id?: unknown }).id === id;

/**
 * Film vu (en tête de `watched_movie`, comme la fiche film) ou série entière
 * vue (en fin de `watched_tv`, comme la fiche série).
 * @returns null si le titre est déjà marqué.
 */
export function markTitle(read: ReadStorage, type: 'movie' | 'tv', item: MarkedTitle, now: string): StorageChange | null {
  const key = listKey(type);
  const list = parseArray(read(key));
  if (list.some((entry) => hasId(entry, item.id))) return null;
  const entry = { id: item.id, type, title: item.title, poster_path: item.posterPath ?? '', addedAt: now };
  const next = type === 'movie' ? [entry, ...list] : [...list, entry];
  return {
    after: { [key]: JSON.stringify(next) },
    // Annuler : retirer ce titre de la liste telle qu'elle est maintenant.
    undo: (current) => ({ [key]: JSON.stringify(parseArray(current(key)).filter((value) => !hasId(value, item.id))) }),
  };
}

/** Retire un film ou une série entière de « Vu ». @returns null s'il n'y était pas. */
export function unmarkTitle(read: ReadStorage, type: 'movie' | 'tv', id: number): StorageChange | null {
  const key = listKey(type);
  const list = parseArray(read(key));
  const removed = list.map((entry, index) => ({ entry, index })).filter(({ entry }) => hasId(entry, id));
  if (removed.length === 0) return null;
  return {
    after: { [key]: JSON.stringify(list.filter((entry) => !hasId(entry, id))) },
    // Annuler : remettre l'entrée à son ancienne place, sauf si le titre est
    // déjà revenu (remarqué ailleurs entre-temps).
    undo: (current) => {
      const now = parseArray(current(key));
      if (now.some((entry) => hasId(entry, id))) return { [key]: JSON.stringify(now) };
      const restored = [...now];
      for (const { entry, index } of removed) restored.splice(Math.min(index, restored.length), 0, entry);
      return { [key]: JSON.stringify(restored) };
    },
  };
}

// Épisodes de l'ancien format `watched_tv_episodes` (tableau d'éléments avec
// episodeInfo), encore lu par le panneau des épisodes.
function legacyEpisodeNames(read: ReadStorage, showId: number): string[] {
  return parseArray(read('watched_tv_episodes')).flatMap((entry) => {
    if (!hasId(entry, showId)) return [];
    const info = (entry as { episodeInfo?: { season?: unknown; episode?: unknown } }).episodeInfo;
    return info && typeof info.season === 'number' && typeof info.episode === 'number' ? [`S${info.season}E${info.episode}`] : [];
  });
}

/**
 * Épisodes vus (`S1E3: true`). Un épisode déjà vu — clé de n'importe quelle
 * casse (« s1e3 » des anciennes versions) ou ancien tableau
 * `watched_tv_episodes` — n'est ni réécrit ni compté.
 */
export function markEpisodes(read: ReadStorage, showId: number, episodes: EpisodeRef[]): { change: StorageChange | null; added: number } {
  const key = episodesKey(showId);
  const record = parseRecord(read(key));
  const present = new Set([
    ...Object.keys(record).filter((name) => record[name]),
    ...legacyEpisodeNames(read, showId),
  ].map((name) => name.toUpperCase()));
  const next: Record<string, unknown> = { ...record };
  const created: string[] = [];
  for (const { season, episode } of episodes) {
    const name = `S${season}E${episode}`;
    if (present.has(name.toUpperCase())) continue;
    present.add(name.toUpperCase());
    next[name] = true;
    created.push(name);
  }
  if (created.length === 0) return { change: null, added: 0 };
  return {
    change: {
      after: { [key]: JSON.stringify(next) },
      // Annuler : retirer seulement les clés créées par cette action ; un
      // objet vide fait disparaître la clé.
      undo: (current) => {
        const now = parseRecord(current(key));
        for (const name of created) delete now[name];
        return { [key]: Object.keys(now).length > 0 ? JSON.stringify(now) : null };
      },
    },
    added: created.length,
  };
}

/** Épisodes d'une saison TMDB (`/tv/{id}/season/{n}`), triés, sans doublon. */
export function seasonEpisodes(season: number, data: unknown): EpisodeRef[] {
  const episodes = typeof data === 'object' && data !== null ? (data as { episodes?: unknown }).episodes : null;
  if (!Array.isArray(episodes)) return [];
  const numbers = new Set<number>();
  for (const entry of episodes) {
    const number = typeof entry === 'object' && entry !== null ? (entry as { episode_number?: unknown }).episode_number : null;
    if (typeof number === 'number' && Number.isInteger(number) && number >= 1) numbers.add(number);
  }
  return [...numbers].sort((a, b) => a - b).map((episode) => ({ season, episode }));
}

// --- « Supprimer de l'historique » ---------------------------------------------------

function entryId(entry: unknown): unknown {
  if (typeof entry === 'number' || typeof entry === 'string') return entry;
  return typeof entry === 'object' && entry !== null ? (entry as { id?: unknown }).id : undefined;
}

/**
 * Clés locales à effacer après une suppression acceptée par le serveur
 * (mêmes clés que celles qu'il retire du fichier du profil, sinon le
 * navigateur les renverrait) : film → `progress_<id>` ; série → toutes les
 * `progress_tv_<id>_s*_e*`, `watched_episodes_tv_<id>` et ses entrées de
 * l'ancien `watched_tv_episodes` ; les deux → l'entrée de `continueWatching`
 * et de `watched_movie` / `watched_tv`. Seules les clés qui changent sont
 * rendues ; une valeur abîmée n'est pas réécrite.
 * @param keys toutes les clés du stockage (pour trouver les épisodes).
 */
export function titleCleanup(keys: string[], read: ReadStorage, type: 'movie' | 'tv', id: number): Record<string, string | null> {
  const writes: Record<string, string | null> = {};
  if (type === 'movie') {
    if (keys.includes(`progress_${id}`)) writes[`progress_${id}`] = null;
  } else {
    const pattern = new RegExp(`^progress_tv_${id}_s\\d+_e\\d+$`);
    for (const key of keys) if (pattern.test(key)) writes[key] = null;
    if (keys.includes(episodesKey(id))) writes[episodesKey(id)] = null;
    const legacy = parseArray(read('watched_tv_episodes'));
    const keptLegacy = legacy.filter((entry) => !hasId(entry, id));
    if (keptLegacy.length !== legacy.length) writes.watched_tv_episodes = JSON.stringify(keptLegacy);
  }

  const list = parseArray(read(listKey(type)));
  const keptList = list.filter((entry) => !hasId(entry, id));
  if (keptList.length !== list.length) writes[listKey(type)] = JSON.stringify(keptList);

  const raw = read('continueWatching');
  if (raw) {
    const record = parseRecord(raw);
    const field = type === 'movie' ? 'movies' : 'tv';
    const entries = record[field];
    if (Array.isArray(entries)) {
      // Number() : les anciennes données ont parfois l'identifiant en chaîne (« 550 »).
      const kept = entries.filter((entry) => Number(entryId(entry)) !== id);
      if (kept.length !== entries.length) writes.continueWatching = JSON.stringify({ ...record, [field]: kept });
    }
  }
  return writes;
}

/** Écrit des valeurs (null = retirer la clé) : `after` pour marquer, `undo(read)` pour annuler. */
export function applyValues(
  storage: { setItem: (key: string, value: string) => void; removeItem: (key: string) => void },
  values: Record<string, string | null>,
): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  }
}

// --- Actions d'une ligne -----------------------------------------------------------

export type MarkAction = 'markMovie' | 'markEpisode' | 'markSeason' | 'markSeries' | 'unmark';

interface ActionTarget {
  mediaType: 'movie' | 'tv';
  season: number | null;
  episode: number | null;
  animeMode: boolean;
  markedWatched: boolean;
}

const isInteger = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);

/**
 * Actions du menu d'une ligne. Titre marqué → « Retirer de « Vu » ». Film →
 * « Marquer comme vu ». Série → épisode (s'il est connu), saison (sauf en
 * mode animé : la numérotation anime-sama ne suit pas les saisons TMDB),
 * série entière.
 */
export function rowActions(item: ActionTarget): MarkAction[] {
  if (item.markedWatched) return ['unmark'];
  if (item.mediaType === 'movie') return ['markMovie'];
  const seasonKnown = isInteger(item.season) && item.season >= 0;
  const episodeKnown = seasonKnown && isInteger(item.episode) && item.episode >= 1;
  const actions: MarkAction[] = [];
  if (episodeKnown) actions.push('markEpisode');
  if (seasonKnown && !item.animeMode) actions.push('markSeason');
  actions.push('markSeries');
  return actions;
}

// --- Mise à jour optimiste ---------------------------------------------------------

interface ListItemShape {
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  markedWatched?: boolean;
  episodesWatched?: number | null;
  episodesTotal?: number | null;
}

interface ListShape<T extends ListItemShape> {
  items: T[];
  total: number;
  counts: { inProgress: number; finished: number; notStarted: number };
  stats: { moviesFinished: number; episodesFinished: number };
}

export type ListStatus = 'in_progress' | 'finished' | 'not_started';
export type MarkEffect = { finished: true } | { episodesAdded: number } | { removed: true };

const COUNT_FIELD: Record<ListStatus, 'inProgress' | 'finished' | 'notStarted'> = {
  in_progress: 'inProgress',
  finished: 'finished',
  not_started: 'notStarted',
};

/**
 * Applique tout de suite l'effet d'une marque à la page affichée, en
 * attendant la relecture du serveur. Titre terminé : il quitte « En cours »
 * ou « Non démarrés » (compteurs mis à jour) ; déjà dans « Terminés », il
 * reste, marqué. Épisodes : leur nombre augmente, borné au total connu.
 */
export function optimisticUpdate<T extends ListItemShape, L extends ListShape<T>>(
  data: L,
  status: ListStatus,
  target: { mediaType: 'movie' | 'tv'; tmdbId: number },
  effect: MarkEffect,
): L {
  const same = (item: T) => item.mediaType === target.mediaType && item.tmdbId === target.tmdbId;
  const index = data.items.findIndex(same);
  if (index < 0) return data;
  const item = data.items[index];

  // Supprimé de l'historique : la ligne part, seul son statut perd un titre.
  if ('removed' in effect) {
    const field = COUNT_FIELD[status];
    return {
      ...data,
      items: data.items.filter((entry) => !same(entry)),
      total: Math.max(0, data.total - 1),
      counts: { ...data.counts, [field]: Math.max(0, data.counts[field] - 1) },
    };
  }

  if ('finished' in effect) {
    if (status === 'finished') {
      return { ...data, items: data.items.map((entry) => (same(entry) ? { ...entry, markedWatched: true } : entry)) };
    }
    const field = COUNT_FIELD[status];
    return {
      ...data,
      items: data.items.filter((entry) => !same(entry)),
      total: Math.max(0, data.total - 1),
      counts: { ...data.counts, [field]: Math.max(0, data.counts[field] - 1), finished: data.counts.finished + 1 },
      stats: { ...data.stats, moviesFinished: data.stats.moviesFinished + (item.mediaType === 'movie' ? 1 : 0) },
    };
  }

  const total = typeof item.episodesTotal === 'number' && item.episodesTotal > 0 ? item.episodesTotal : Infinity;
  const previous = typeof item.episodesWatched === 'number' ? item.episodesWatched : 0;
  const watched = Math.max(previous, Math.min(total, previous + effect.episodesAdded));
  return {
    ...data,
    items: data.items.map((entry) => (same(entry) ? { ...entry, episodesWatched: watched } : entry)),
    // Même hausse que la ligne : pas de dérive quand elle est bornée au total.
    stats: { ...data.stats, episodesFinished: data.stats.episodesFinished + (watched - previous) },
  };
}

/**
 * « Annuler » : défait tout de suite l'effet d'optimisticUpdate sur la page
 * affichée. `original` est la ligne telle qu'elle était avant l'action et
 * `index` sa place. Ligne déjà revenue (relecture entre-temps) : rien ne change.
 */
export function revertOptimistic<T extends ListItemShape, L extends ListShape<T>>(
  data: L,
  status: ListStatus,
  original: T,
  index: number,
  effect: MarkEffect,
): L {
  const same = (item: T) => item.mediaType === original.mediaType && item.tmdbId === original.tmdbId;
  const current = data.items.find(same);

  if ('finished' in effect) {
    if (status === 'finished') {
      if (!current) return data;
      return { ...data, items: data.items.map((entry) => (same(entry) ? { ...entry, markedWatched: original.markedWatched ?? false } : entry)) };
    }
    if (current) return data;
    const field = COUNT_FIELD[status];
    const items = [...data.items];
    items.splice(Math.min(index, items.length), 0, original);
    return {
      ...data,
      items,
      total: data.total + 1,
      counts: { ...data.counts, [field]: data.counts[field] + 1, finished: Math.max(0, data.counts.finished - 1) },
      stats: { ...data.stats, moviesFinished: Math.max(0, data.stats.moviesFinished - (original.mediaType === 'movie' ? 1 : 0)) },
    };
  }

  if (!current) return data;
  const before = typeof original.episodesWatched === 'number' ? original.episodesWatched : 0;
  const now = typeof current.episodesWatched === 'number' ? current.episodesWatched : 0;
  return {
    ...data,
    items: data.items.map((entry) => (same(entry) ? { ...entry, episodesWatched: original.episodesWatched ?? null } : entry)),
    stats: { ...data.stats, episodesFinished: Math.max(0, data.stats.episodesFinished - Math.max(0, now - before)) },
  };
}
