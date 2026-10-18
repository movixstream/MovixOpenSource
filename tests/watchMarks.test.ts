import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

type Marks = typeof import('../src/components/profile/watchMarks.ts');

// Module pur (imports de types seulement) : transpilé et évalué sans Vite.
function loadMarks(): Marks {
  const source = readFileSync(new URL('../src/components/profile/watchMarks.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function('exports', 'require', js)(exports, (name: string) => {
    throw new Error(`module inattendu : ${name}`);
  });
  return exports as Marks;
}

const marks = loadMarks();
const NOW = '2026-10-16T12:00:00.000Z';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    read: (key: string) => (data.has(key) ? (data.get(key) as string) : null),
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

// --- Films et séries entières : watched_movie / watched_tv ------------------------

test('markTitle film : ajouté en tête de watched_movie, même forme que la fiche film', () => {
  const store = memoryStorage({ watched_movie: JSON.stringify([{ id: 1, type: 'movie', title: 'A', poster_path: '/a.jpg', addedAt: 'x' }]) });
  const change = marks.markTitle(store.read, 'movie', { id: 550, title: 'Fight Club', posterPath: '/fc.jpg' }, NOW);
  assert.ok(change);
  assert.deepEqual(JSON.parse(change.after.watched_movie), [
    { id: 550, type: 'movie', title: 'Fight Club', poster_path: '/fc.jpg', addedAt: NOW },
    { id: 1, type: 'movie', title: 'A', poster_path: '/a.jpg', addedAt: 'x' },
  ]);
});

test('markTitle série entière : ajoutée en fin de watched_tv comme la fiche série, sans toucher aux épisodes', () => {
  const store = memoryStorage({ watched_tv: JSON.stringify([{ id: 1, type: 'tv', title: 'A', poster_path: '', addedAt: 'x' }]) });
  const change = marks.markTitle(store.read, 'tv', { id: 1399, title: 'Game of Thrones', posterPath: null }, NOW);
  assert.ok(change);
  assert.deepEqual(Object.keys(change.after), ['watched_tv']);
  assert.deepEqual(JSON.parse(change.after.watched_tv)[1], { id: 1399, type: 'tv', title: 'Game of Thrones', poster_path: '', addedAt: NOW });
});

test('markTitle : déjà marqué → null ; clé absente ou abîmée → nouvelle liste', () => {
  const marked = memoryStorage({ watched_movie: JSON.stringify([{ id: 550 }]) });
  assert.equal(marks.markTitle(marked.read, 'movie', { id: 550, title: 'X', posterPath: '' }, NOW), null);
  const broken = memoryStorage({ watched_movie: '{pas du json' });
  const change = marks.markTitle(broken.read, 'movie', { id: 550, title: 'X', posterPath: '' }, NOW);
  assert.equal(JSON.parse(change!.after.watched_movie).length, 1);
  assert.equal(JSON.parse(marks.markTitle(memoryStorage().read, 'tv', { id: 2, title: 'Y', posterPath: '' }, NOW)!.after.watched_tv).length, 1);
});

test('unmarkTitle : retire l’entrée, null si elle n’y est pas', () => {
  const store = memoryStorage({ watched_tv: JSON.stringify([{ id: 1 }, { id: 1399 }, null]) });
  const change = marks.unmarkTitle(store.read, 'tv', 1399);
  assert.deepEqual(JSON.parse(change!.after.watched_tv), [{ id: 1 }, null]);
  assert.equal(marks.unmarkTitle(store.read, 'movie', 1399), null);
});

// --- Épisodes : watched_episodes_tv_<id> ----------------------------------------------

test('markEpisodes : clés « S1E3 » ajoutées, déjà présentes (toute casse) ignorées', () => {
  const store = memoryStorage({ watched_episodes_tv_1399: JSON.stringify({ s1e1: true, S1E2: true }) });
  const result = marks.markEpisodes(store.read, 1399, [{ season: 1, episode: 1 }, { season: 1, episode: 3 }, { season: 1, episode: 3 }]);
  assert.equal(result.added, 1);
  assert.deepEqual(JSON.parse(result.change!.after.watched_episodes_tv_1399), { s1e1: true, S1E2: true, S1E3: true });
  const none = marks.markEpisodes(store.read, 1399, [{ season: 1, episode: 2 }]);
  assert.deepEqual(none, { change: null, added: 0 });
});

test('markEpisodes : un épisode de l’ancien tableau watched_tv_episodes compte comme déjà vu', () => {
  const store = memoryStorage({
    watched_tv_episodes: JSON.stringify([{ id: 1399, episodeInfo: { season: 1, episode: 2 } }, { id: 7, episodeInfo: { season: 1, episode: 1 } }]),
  });
  const result = marks.markEpisodes(store.read, 1399, [{ season: 1, episode: 1 }, { season: 1, episode: 2 }]);
  assert.equal(result.added, 1);
  assert.deepEqual(JSON.parse(result.change!.after.watched_episodes_tv_1399), { S1E1: true });
});

test('seasonEpisodes : épisodes d’une saison TMDB, triés, sans doublon ni valeur invalide', () => {
  const data = { episodes: [{ episode_number: 3 }, { episode_number: 1 }, { episode_number: 'x' }, { episode_number: 1 }, { episode_number: 0 }, {}] };
  assert.deepEqual(marks.seasonEpisodes(2, data), [{ season: 2, episode: 1 }, { season: 2, episode: 3 }]);
  assert.deepEqual(marks.seasonEpisodes(2, null), []);
  assert.deepEqual(marks.seasonEpisodes(2, { episodes: 'non' }), []);
});

// --- Annuler : l'opération inverse, appliquée au stockage du moment -------------------

const apply = (store: ReturnType<typeof memoryStorage>, change: { after: Record<string, string> }) => marks.applyValues(store, change.after);
const undo = (store: ReturnType<typeof memoryStorage>, change: { undo: (read: (key: string) => string | null) => Record<string, string | null> }) =>
  marks.applyValues(store, change.undo(store.read));

test('marquer une saison puis annuler rend le stockage d’avant (clé absente comprise)', () => {
  const store = memoryStorage({ watched_movie: '[]' });
  const result = marks.markEpisodes(store.read, 42, marks.seasonEpisodes(1, { episodes: [{ episode_number: 1 }, { episode_number: 2 }] }));
  apply(store, result.change!);
  assert.deepEqual(JSON.parse(store.read('watched_episodes_tv_42')!), { S1E1: true, S1E2: true });
  undo(store, result.change!);
  assert.equal(store.read('watched_episodes_tv_42'), null);
  assert.deepEqual([...store.data.keys()], ['watched_movie']);
});

test('annuler dans le désordre : film A puis film B, annuler A garde B', () => {
  const store = memoryStorage({ watched_movie: JSON.stringify([{ id: 1, type: 'movie', title: 'Ancien', poster_path: '', addedAt: 'x' }]) });
  const a = marks.markTitle(store.read, 'movie', { id: 2, title: 'A', posterPath: '' }, NOW)!;
  apply(store, a);
  const b = marks.markTitle(store.read, 'movie', { id: 3, title: 'B', posterPath: '' }, NOW)!;
  apply(store, b);
  undo(store, a);
  assert.deepEqual(JSON.parse(store.read('watched_movie')!).map((entry: { id: number }) => entry.id), [3, 1]);
  undo(store, b);
  assert.deepEqual(JSON.parse(store.read('watched_movie')!).map((entry: { id: number }) => entry.id), [1]);
});

test('annuler dans le désordre : épisode S1E3 puis saison 1, annuler l’épisode garde la saison', () => {
  const store = memoryStorage();
  const episode = marks.markEpisodes(store.read, 1399, [{ season: 1, episode: 3 }]).change!;
  apply(store, episode);
  const season = marks.markEpisodes(store.read, 1399, [1, 2, 3, 4].map((number) => ({ season: 1, episode: number }))).change!;
  apply(store, season);
  undo(store, episode);
  // Seules les clés créées par l'action annulée partent.
  assert.deepEqual(JSON.parse(store.read('watched_episodes_tv_1399')!), { S1E1: true, S1E2: true, S1E4: true });
  undo(store, season);
  assert.equal(store.read('watched_episodes_tv_1399'), null);
});

test('annuler après une écriture d’autoMarkWatched entre-temps : elle est gardée', () => {
  const store = memoryStorage({ watched_episodes_tv_7: JSON.stringify({ S1E1: true }) });
  const change = marks.markEpisodes(store.read, 7, [{ season: 1, episode: 2 }]).change!;
  apply(store, change);
  // Écriture extérieure (passe automatique, autre onglet) avant l'annulation.
  store.setItem('watched_episodes_tv_7', JSON.stringify({ ...JSON.parse(store.read('watched_episodes_tv_7')!), S2E1: true }));
  undo(store, change);
  assert.deepEqual(JSON.parse(store.read('watched_episodes_tv_7')!), { S1E1: true, S2E1: true });
});

test('annuler un retrait remet l’entrée à sa place, sans toucher aux ajouts faits depuis', () => {
  const store = memoryStorage({ watched_tv: JSON.stringify([{ id: 1 }, { id: 1399, title: 'GoT' }, { id: 5 }]) });
  const change = marks.unmarkTitle(store.read, 'tv', 1399)!;
  apply(store, change);
  const other = marks.markTitle(store.read, 'tv', { id: 9, title: 'Autre', posterPath: '' }, NOW)!;
  apply(store, other);
  undo(store, change);
  assert.deepEqual(JSON.parse(store.read('watched_tv')!).map((entry: { id: number }) => entry.id), [1, 1399, 5, 9]);
  // Déjà revenue (remarquée ailleurs) : pas de doublon.
  undo(store, change);
  assert.equal(JSON.parse(store.read('watched_tv')!).filter((entry: { id: number }) => entry.id === 1399).length, 1);
});

// --- « Supprimer de l'historique » : mêmes clés que le serveur efface ----------------

test('titleCleanup film : progress_<id>, continueWatching, watched_movie ; rien d’autre', () => {
  const store = memoryStorage({
    progress_550: '{"position":10}',
    progress_5500: '{"position":20}',
    continueWatching: JSON.stringify({ movies: [550, { id: 550 }, { id: 1 }], tv: [{ id: 550 }] }),
    watched_movie: JSON.stringify([{ id: 550 }, { id: 2 }]),
    watched_tv: JSON.stringify([{ id: 550 }]),
  });
  const writes = marks.titleCleanup([...store.data.keys()], store.read, 'movie', 550);
  marks.applyValues(store, writes);
  assert.equal(store.read('progress_550'), null);
  assert.equal(store.read('progress_5500'), '{"position":20}');
  assert.deepEqual(JSON.parse(store.read('continueWatching')!), { movies: [{ id: 1 }], tv: [{ id: 550 }] });
  assert.deepEqual(JSON.parse(store.read('watched_movie')!), [{ id: 2 }]);
  // La série du même numéro n'est pas touchée.
  assert.deepEqual(JSON.parse(store.read('watched_tv')!), [{ id: 550 }]);
});

test('titleCleanup série : progress_tv_<id>_s*_e*, continueWatching.tv, watched_tv, épisodes et ancien tableau', () => {
  const store = memoryStorage({
    progress_tv_1399_s1_e1: '{}',
    progress_tv_1399_s2_e10: '{}',
    progress_tv_13990_s1_e1: '{}',
    progress_1399: '{}',
    continueWatching: JSON.stringify({ movies: [], tv: [{ id: 1399, currentEpisode: { season: 2, episode: 10 } }, { id: 7 }] }),
    watched_tv: JSON.stringify([{ id: 1399 }]),
    watched_episodes_tv_1399: JSON.stringify({ S1E1: true }),
    watched_episodes_tv_13990: JSON.stringify({ S1E1: true }),
    watched_tv_episodes: JSON.stringify([{ id: 1399, episodeInfo: { season: 1, episode: 2 } }, { id: 7 }]),
  });
  marks.applyValues(store, marks.titleCleanup([...store.data.keys()], store.read, 'tv', 1399));
  assert.deepEqual([...store.data.keys()].sort(), [
    'continueWatching', 'progress_1399', 'progress_tv_13990_s1_e1', 'watched_episodes_tv_13990', 'watched_tv', 'watched_tv_episodes',
  ]);
  assert.deepEqual(JSON.parse(store.read('continueWatching')!), { movies: [], tv: [{ id: 7 }] });
  assert.deepEqual(JSON.parse(store.read('watched_tv')!), []);
  assert.deepEqual(JSON.parse(store.read('watched_tv_episodes')!), [{ id: 7 }]);
});

test('titleCleanup : identifiants en chaîne des anciennes données de continueWatching retirés aussi', () => {
  const store = memoryStorage({ continueWatching: JSON.stringify({ movies: ['550', { id: '550' }, { id: 1 }], tv: [{ id: '1399' }] }) });
  marks.applyValues(store, marks.titleCleanup([...store.data.keys()], store.read, 'movie', 550));
  assert.deepEqual(JSON.parse(store.read('continueWatching')!), { movies: [{ id: 1 }], tv: [{ id: '1399' }] });
  marks.applyValues(store, marks.titleCleanup([...store.data.keys()], store.read, 'tv', 1399));
  assert.deepEqual(JSON.parse(store.read('continueWatching')!).tv, []);
});

test('titleCleanup : clé inchangée ou abîmée → pas d’écriture', () => {
  const store = memoryStorage({ continueWatching: '{abîmé', watched_movie: JSON.stringify([{ id: 2 }]) });
  assert.deepEqual(marks.titleCleanup([...store.data.keys()], store.read, 'movie', 550), {});
});

// --- Actions proposées par ligne ------------------------------------------------------

const line = (overrides: Record<string, unknown> = {}) => ({
  mediaType: 'tv' as 'movie' | 'tv', season: 1 as number | null, episode: 3 as number | null, animeMode: false, markedWatched: false, ...overrides,
});

test('rowActions : film → marquer, ou retirer de « Vu » s’il est marqué', () => {
  assert.deepEqual(marks.rowActions(line({ mediaType: 'movie', season: null, episode: null })), ['markMovie']);
  assert.deepEqual(marks.rowActions(line({ mediaType: 'movie', markedWatched: true })), ['unmark']);
});

test('rowActions : série → épisode, saison, série ; sans épisode connu → saison/série ou série seule', () => {
  assert.deepEqual(marks.rowActions(line()), ['markEpisode', 'markSeason', 'markSeries']);
  assert.deepEqual(marks.rowActions(line({ season: 0, episode: 2 })), ['markEpisode', 'markSeason', 'markSeries']);
  assert.deepEqual(marks.rowActions(line({ season: 2, episode: null })), ['markSeason', 'markSeries']);
  assert.deepEqual(marks.rowActions(line({ season: null, episode: null })), ['markSeries']);
  assert.deepEqual(marks.rowActions(line({ markedWatched: true })), ['unmark']);
});

test('rowActions : animé → épisode et série, jamais de saison (numérotation anime-sama)', () => {
  assert.deepEqual(marks.rowActions(line({ animeMode: true })), ['markEpisode', 'markSeries']);
  assert.deepEqual(marks.rowActions(line({ animeMode: true, season: null, episode: null })), ['markSeries']);
});

// --- Mise à jour optimiste de la liste ----------------------------------------------------

function list(items: Array<Record<string, unknown>>) {
  return {
    items: items as never[],
    page: 1, pageSize: 10, total: items.length,
    counts: { inProgress: 5, finished: 2, notStarted: 1 },
    stats: { watchedSeconds: 0, trackedSeconds: null, moviesFinished: 2, episodesFinished: 10 },
    complete: true,
  };
}

test('optimisticUpdate : titre terminé → quitte « En cours », compteurs mis à jour', () => {
  const data = list([{ mediaType: 'movie', tmdbId: 550 }, { mediaType: 'tv', tmdbId: 1399 }]);
  const next = marks.optimisticUpdate(data, 'in_progress', { mediaType: 'movie', tmdbId: 550 }, { finished: true });
  assert.deepEqual(next.items.map((item: { tmdbId: number }) => item.tmdbId), [1399]);
  assert.equal(next.total, 1);
  assert.deepEqual(next.counts, { inProgress: 4, finished: 3, notStarted: 1 });
  assert.equal(next.stats.moviesFinished, 3);
  const fromNotStarted = marks.optimisticUpdate(data, 'not_started', { mediaType: 'tv', tmdbId: 1399 }, { finished: true });
  assert.deepEqual(fromNotStarted.counts, { inProgress: 5, finished: 3, notStarted: 0 });
  assert.equal(fromNotStarted.stats.moviesFinished, 2);
});

test('optimisticUpdate : déjà dans « Terminés » → la ligne reste, marquée', () => {
  const data = list([{ mediaType: 'movie', tmdbId: 550, markedWatched: false }]);
  const next = marks.optimisticUpdate(data, 'finished', { mediaType: 'movie', tmdbId: 550 }, { finished: true });
  assert.equal(next.items.length, 1);
  assert.equal((next.items[0] as { markedWatched: boolean }).markedWatched, true);
  assert.deepEqual(next.counts, data.counts);
});

test('optimisticUpdate : épisodes ajoutés → compte d’épisodes, borné au total', () => {
  const data = list([{ mediaType: 'tv', tmdbId: 1399, episodesWatched: 3, episodesTotal: 10 }, { mediaType: 'tv', tmdbId: 7, episodesWatched: null, episodesTotal: 2 }]);
  const next = marks.optimisticUpdate(data, 'in_progress', { mediaType: 'tv', tmdbId: 1399 }, { episodesAdded: 2 });
  assert.equal((next.items[0] as { episodesWatched: number }).episodesWatched, 5);
  assert.equal(next.stats.episodesFinished, 12);
  const capped = marks.optimisticUpdate(data, 'in_progress', { mediaType: 'tv', tmdbId: 7 }, { episodesAdded: 5 });
  assert.equal((capped.items[1] as { episodesWatched: number }).episodesWatched, 2);
  // Le chiffre « Épisodes vus » suit la ligne : +2, pas +5.
  assert.equal(capped.stats.episodesFinished, 12);
  assert.equal(next.items.length, 2);
});

test('optimisticUpdate : titre supprimé → la ligne part, son statut −1, « Terminés » inchangé', () => {
  const data = list([{ mediaType: 'movie', tmdbId: 550 }, { mediaType: 'tv', tmdbId: 1399 }]);
  const next = marks.optimisticUpdate(data, 'in_progress', { mediaType: 'tv', tmdbId: 1399 }, { removed: true });
  assert.deepEqual(next.items.map((item: { tmdbId: number }) => item.tmdbId), [550]);
  assert.equal(next.total, 1);
  assert.deepEqual(next.counts, { inProgress: 4, finished: 2, notStarted: 1 });
  const fromFinished = marks.optimisticUpdate(data, 'finished', { mediaType: 'movie', tmdbId: 550 }, { removed: true });
  assert.deepEqual(fromFinished.counts, { inProgress: 5, finished: 1, notStarted: 1 });
  assert.equal(fromFinished.items.length, 1);
});

test('revertOptimistic : « Annuler » remet la ligne retirée à sa place et les compteurs', () => {
  const data = list([{ mediaType: 'movie', tmdbId: 550 }, { mediaType: 'tv', tmdbId: 1399 }]);
  const removed = data.items[0];
  const after = marks.optimisticUpdate(data, 'in_progress', { mediaType: 'movie', tmdbId: 550 }, { finished: true });
  const back = marks.revertOptimistic(after, 'in_progress', removed, 0, { finished: true });
  assert.deepEqual(back.items.map((item: { tmdbId: number }) => item.tmdbId), [550, 1399]);
  assert.deepEqual(back.counts, data.counts);
  assert.equal(back.total, data.total);
  assert.equal(back.stats.moviesFinished, data.stats.moviesFinished);
  // Déjà revenue (relecture du serveur entre-temps) : pas de doublon.
  assert.equal(marks.revertOptimistic(back, 'in_progress', removed, 0, { finished: true }), back);
});

test('revertOptimistic : épisodes et ligne restée dans « Terminés »', () => {
  const data = list([{ mediaType: 'tv', tmdbId: 1399, episodesWatched: 9, episodesTotal: 10, markedWatched: false }]);
  const original = data.items[0];
  const after = marks.optimisticUpdate(data, 'in_progress', { mediaType: 'tv', tmdbId: 1399 }, { episodesAdded: 4 });
  const back = marks.revertOptimistic(after, 'in_progress', original, 0, { episodesAdded: 4 });
  assert.equal((back.items[0] as { episodesWatched: number }).episodesWatched, 9);
  assert.equal(back.stats.episodesFinished, data.stats.episodesFinished);
  const finished = marks.optimisticUpdate(data, 'finished', { mediaType: 'tv', tmdbId: 1399 }, { finished: true });
  const unfinished = marks.revertOptimistic(finished, 'finished', original, 0, { finished: true });
  assert.equal((unfinished.items[0] as { markedWatched: boolean }).markedWatched, false);
});
