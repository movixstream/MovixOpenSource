import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

type Saga = typeof import('../src/utils/sagaProgress.ts');
type TitleHistory = import('../src/services/historyService.ts').TitleHistory;

// Modules purs : transpilés et évalués sans Vite. Le calcul de la saga
// reprend les vraies règles de la fiche film (titleHistoryMerge), chargées
// de la même façon.
function loadModule<T>(file: string, modules: Record<string, unknown> = {}): T {
  const source = readFileSync(new URL(`../src/utils/${file}`, import.meta.url), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function('exports', 'require', js)(exports, (name: string) => {
    if (name in modules) return modules[name];
    throw new Error(`module inattendu : ${name}`);
  });
  return exports as T;
}

const saga = loadModule<Saga>('sagaProgress.ts', { './titleHistoryMerge': loadModule('titleHistoryMerge.ts') });

// Film tel que le rend GET /api/history/titles, complété par le service.
function server(tmdbId: number, overrides: Partial<TitleHistory> = {}): TitleHistory {
  return {
    mediaType: 'movie', tmdbId, status: 'not_started', markedWatched: false, animeMode: false, estimated: false,
    position: null, duration: null, season: null, episode: null, episodesWatched: null, episodesTotal: null, episodes: [],
    ...overrides,
  };
}

const titles = (...list: TitleHistory[]) => new Map(list.map((title): [number, TitleHistory] => [title.tmdbId, title]));
const progress = (position: number, duration: number) => JSON.stringify({ position, duration, timestamp: '2026-11-21T10:00:00.000Z' });
const marked = (...ids: number[]) => JSON.stringify(ids.map((id) => ({ id, type: 'movie', title: `Film ${id}`, poster_path: '', addedAt: '2026-11-21T10:00:00.000Z' })));

// Stockage local de l'appareil → état local de la saga, avec les clés de la fiche film.
function localOf(ids: number[], storage: Record<string, string> = {}) {
  return saga.readSagaLocal(ids, (key) => (key in storage ? storage[key] : null));
}

const WATCHED = { status: 'watched', ratio: null };
const ESTIMATED = { status: 'estimated', ratio: null };
const NOT_STARTED = { status: 'not_started', ratio: null };

const SAGA = [11, 1891, 1892, 1893, 1894, 1895, 140607, 181808];

test('local seul : coché « Vu », fini dans le lecteur, en cours avec son avancement ; 2 films vus sur 8', () => {
  const local = localOf(SAGA, {
    watched_movie: marked(11, 999),
    progress_1891: progress(7000, 7200), // 97 % : fini dans le lecteur
    progress_1892: progress(1800, 7200), // 25 % : en cours
    progress_1893: progress(20, 7200), // moins de 30 s : pas commencé
  });
  const result = saga.computeSagaProgress(SAGA, local, null, false);

  assert.equal(result.watchedCount, 2);
  assert.equal(result.total, 8);
  assert.equal(result.nextId, 1892);
  assert.equal(result.loading, false);
  assert.deepEqual(result.films.get(11), WATCHED);
  assert.deepEqual(result.films.get(1891), WATCHED);
  assert.deepEqual(result.films.get(1892), { status: 'in_progress', ratio: 0.25 });
  assert.deepEqual(result.films.get(1893), NOT_STARTED);
  assert.deepEqual(result.films.get(181808), NOT_STARTED);
  // Un état par film de la saga, pas pour les autres films cochés.
  assert.deepEqual([...result.films.keys()], SAGA);
});

test('serveur seul : vu sur un autre appareil, coché ailleurs, vu (estimé), en cours exact ou estimé', () => {
  const remote = titles(
    server(11, { status: 'finished', position: 7100, duration: 7200 }), // lecture finie sur un autre appareil
    server(1891, { status: 'finished', markedWatched: true }), // coché « Vu » ailleurs
    server(1892, { status: 'finished', estimated: true, position: 6912, duration: 7200 }), // vu (estimé)
    server(1893, { status: 'in_progress', position: 3600, duration: 7200 }),
    server(1894, { status: 'in_progress', estimated: true, position: 1800, duration: 7200 }),
    server(1895, { status: 'not_started', position: 20, duration: 7200 }),
  );
  const result = saga.computeSagaProgress(SAGA, localOf(SAGA), remote, false);

  assert.deepEqual(result.films.get(11), WATCHED);
  assert.deepEqual(result.films.get(1891), WATCHED);
  assert.deepEqual(result.films.get(1892), ESTIMATED);
  assert.deepEqual(result.films.get(1893), { status: 'in_progress', ratio: 0.5 });
  assert.deepEqual(result.films.get(1894), { status: 'in_progress', ratio: 0.25 });
  assert.deepEqual(result.films.get(1895), NOT_STARTED);
  // Film inconnu du serveur (absent de la réponse) : pas commencé.
  assert.deepEqual(result.films.get(140607), NOT_STARTED);
  // L'estimé compte comme vu.
  assert.equal(result.watchedCount, 3);
  assert.equal(result.nextId, 1893);
});

test('estimé : coché ou fini ici → « watched » ; marque du serveur avec un estimé → « watched »', () => {
  const estimated = server(11, { status: 'finished', estimated: true, position: 7000, duration: 7200 });
  assert.deepEqual(saga.sagaFilmProgress({ watched: false, progress: null }, estimated), ESTIMATED);
  assert.deepEqual(saga.sagaFilmProgress({ watched: true, progress: null }, estimated), WATCHED);
  assert.deepEqual(saga.sagaFilmProgress({ watched: false, progress: progress(7000, 7200) }, estimated), WATCHED);
  assert.deepEqual(saga.sagaFilmProgress({ watched: false, progress: null }, { ...estimated, markedWatched: true }), WATCHED);
  // Estimé pas fini : en cours, jamais « vu (estimé) ».
  assert.deepEqual(saga.sagaFilmProgress({ watched: false, progress: null }, { ...estimated, status: 'in_progress', position: 3600 }), { status: 'in_progress', ratio: 0.5 });
});

test('local et serveur se contredisent : le local gagne', () => {
  const film = (local: { watched?: boolean; progress?: string | null }, remote: TitleHistory | null) => (
    saga.sagaFilmProgress({ watched: local.watched ?? false, progress: local.progress ?? null }, remote)
  );
  // Coché ici, le serveur ne le sait pas encore.
  assert.deepEqual(film({ watched: true }, server(11, { status: 'not_started' })), WATCHED);
  assert.deepEqual(film({ watched: true }, server(11, { status: 'in_progress', position: 600, duration: 7200 })), WATCHED);
  // Fini ici, encore « en cours » sur le serveur.
  assert.deepEqual(film({ progress: progress(7000, 7200) }, server(11, { status: 'in_progress', position: 3600, duration: 7200 })), WATCHED);
  // Deux positions : celle de cet appareil.
  assert.deepEqual(film({ progress: progress(1800, 7200) }, server(11, { status: 'in_progress', position: 5400, duration: 7200 })), { status: 'in_progress', ratio: 0.25 });
  // Une clé locale trop courte ou illisible écarte quand même la position du
  // serveur, comme sur la fiche (bouton « Regarder », sans reprise).
  assert.deepEqual(film({ progress: progress(10, 7200) }, server(11, { status: 'in_progress', position: 3600, duration: 7200 })), NOT_STARTED);
  assert.deepEqual(film({ progress: '{abîmé' }, server(11, { status: 'in_progress', position: 3600, duration: 7200 })), NOT_STARTED);
  // En cours ici, terminé ailleurs : la fiche affiche « Vu sur un autre
  // appareil » à côté de la reprise ; la saga compte le film comme vu.
  assert.deepEqual(film({ progress: progress(1800, 7200) }, server(11, { status: 'finished', markedWatched: true })), WATCHED);
});

test('en cours : seuils de la fiche film (plus de 30 s, moins de 95 %), ratio borné', () => {
  const local = (position: number, duration: number) => saga.sagaFilmProgress({ watched: false, progress: progress(position, duration) }, null);
  assert.deepEqual(local(30, 7200), NOT_STARTED);
  assert.deepEqual(local(31, 6200), { status: 'in_progress', ratio: 0.005 });
  assert.deepEqual(local(6800, 7200).status, 'in_progress');
  assert.deepEqual(local(6840, 7200), WATCHED); // 95 %
  // Durée inconnue : ni fini ni en cours.
  assert.deepEqual(local(600, 0), NOT_STARTED);
  // Position lue en texte ou valeur d'une autre forme : pas une reprise.
  assert.deepEqual(saga.sagaFilmProgress({ watched: false, progress: JSON.stringify({ position: '600', duration: 7200 }) }, null), NOT_STARTED);
  assert.deepEqual(saga.sagaFilmProgress({ watched: false, progress: '[]' }, null), NOT_STARTED);
  // Film sans état local du tout (absent de la lecture).
  assert.deepEqual(saga.sagaFilmProgress(undefined, null), NOT_STARTED);
  assert.deepEqual(saga.sagaFilmProgress(undefined, server(11, { status: 'finished' })), WATCHED);
});

test('nextId : premier film ni vu ni vu (estimé), dans l’ordre reçu ; null si tout est vu', () => {
  const order = [3, 1, 2];
  const local = localOf(order, { watched_movie: marked(3) });
  const remote = titles(server(1, { status: 'finished', estimated: true }), server(2, { status: 'in_progress', position: 600, duration: 7200 }));
  assert.equal(saga.computeSagaProgress(order, local, remote, false).nextId, 2);
  assert.equal(saga.computeSagaProgress(order, local, null, false).nextId, 1);
  assert.equal(saga.computeSagaProgress([2, 1, 3], localOf([2, 1, 3], { watched_movie: marked(3) }), remote, false).nextId, 2);

  const all = saga.computeSagaProgress(order, localOf(order, { watched_movie: marked(1, 2, 3) }), null, false);
  assert.deepEqual([all.watchedCount, all.total, all.nextId], [3, 3, null]);
});

test('liste vide : rien de vu sur 0, pas de film suivant ; `loading` rendu tel quel', () => {
  const empty = saga.computeSagaProgress([], localOf([]), titles(server(11, { status: 'finished' })), false);
  assert.deepEqual([empty.films.size, empty.watchedCount, empty.total, empty.nextId, empty.loading], [0, 0, 0, null, false]);
  // Pendant le chargement du serveur : l'état local est déjà là.
  const loading = saga.computeSagaProgress([11, 12], localOf([11, 12], { watched_movie: marked(11) }), null, true);
  assert.deepEqual([loading.watchedCount, loading.total, loading.nextId, loading.loading], [1, 2, 12, true]);
});

test('identifiants : doublons et valeurs invalides écartés, ordre gardé', () => {
  assert.deepEqual(saga.uniqueMovieIds([11, 12, 11, 0, -3, 1.5, Number.NaN, '13', null, 12, 14]), [11, 12, 14]);
  const result = saga.computeSagaProgress([11, 12, 11, 0], localOf([11, 12], { watched_movie: marked(11) }), null, false);
  assert.deepEqual([result.watchedCount, result.total, result.nextId], [1, 2, 12]);
});

test('readSagaLocal : clés de la fiche film (`watched_movie`, `progress_<id>`), valeurs abîmées sans effet', () => {
  const reads: string[] = [];
  const storage: Record<string, string> = { watched_movie: marked(11), progress_12: progress(600, 7200), progress_tv_11_s1_e1: progress(600, 1400) };
  const local = saga.readSagaLocal([11, 12, 13], (key) => {
    reads.push(key);
    return key in storage ? storage[key] : null;
  });
  // La liste des films cochés est lue une seule fois pour toute la saga.
  assert.deepEqual(reads, ['watched_movie', 'progress_11', 'progress_12', 'progress_13']);
  assert.deepEqual(local.get(11), { watched: true, progress: null });
  assert.deepEqual(local.get(12), { watched: false, progress: storage.progress_12 });
  assert.deepEqual(local.get(13), { watched: false, progress: null });

  // Même comparaison stricte que la fiche : un identifiant en texte ne coche rien.
  for (const raw of ['{abîmé', '{"id":11}', 'null', JSON.stringify([{ id: '11' }, null, 11, 'texte'])]) {
    assert.equal(localOf([11], { watched_movie: raw }).get(11)?.watched, false, raw);
  }
});
