import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

type Merge = typeof import('../src/utils/titleHistoryMerge.ts');

// Module pur (imports de types seulement) : transpilé et évalué sans Vite.
function loadMerge(): Merge {
  const source = readFileSync(new URL('../src/utils/titleHistoryMerge.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function('exports', 'require', js)(exports, (name: string) => {
    throw new Error(`module inattendu : ${name}`);
  });
  return exports as Merge;
}

const merge = loadMerge();

function server(overrides: Record<string, unknown> = {}) {
  return {
    mediaType: 'movie' as 'movie' | 'tv', tmdbId: 550, status: 'in_progress' as 'in_progress' | 'finished' | 'not_started',
    markedWatched: false, animeMode: false, estimated: false,
    position: null as number | null, duration: null as number | null,
    season: null as number | null, episode: null as number | null,
    episodesWatched: null as number | null, episodesTotal: null as number | null,
    episodes: [] as Array<{ season: number; episode: number; position: number | null; duration: number | null; estimated: boolean; watched: boolean; marked: boolean }>,
    ...overrides,
  };
}

// --- Film : « Vu » ---------------------------------------------------------------------

test('movieWatchedState : le bouton ne suit que la marque locale ; le serveur seul donne une indication à part', () => {
  assert.deepEqual(merge.movieWatchedState(true, false, null), { toggleOn: true, serverWatched: null });
  assert.deepEqual(merge.movieWatchedState(true, false, server({ status: 'finished', estimated: true })), { toggleOn: true, serverWatched: null });
  assert.deepEqual(merge.movieWatchedState(false, false, server({ status: 'finished', estimated: true })), { toggleOn: false, serverWatched: 'estimated' });
  assert.deepEqual(merge.movieWatchedState(false, false, server({ status: 'finished', markedWatched: true, estimated: true })), { toggleOn: false, serverWatched: 'otherDevice' });
  assert.deepEqual(merge.movieWatchedState(false, false, server({ status: 'finished' })), { toggleOn: false, serverWatched: 'otherDevice' });
  // Fini ici d'après la position locale : rien à signaler en plus.
  assert.deepEqual(merge.movieWatchedState(false, true, server({ status: 'finished' })), { toggleOn: false, serverWatched: null });
  assert.deepEqual(merge.movieWatchedState(false, false, server({ status: 'in_progress' })), { toggleOn: false, serverWatched: null });
  assert.deepEqual(merge.movieWatchedState(false, false, null), { toggleOn: false, serverWatched: null });
});

test('localProgressFinished : progress_ local à 95 % ou plus', () => {
  assert.equal(merge.localProgressFinished(JSON.stringify({ position: 5800, duration: 6000 })), true);
  assert.equal(merge.localProgressFinished(JSON.stringify({ position: 1200, duration: 6000 })), false);
  assert.equal(merge.localProgressFinished(JSON.stringify({ position: 10, duration: 0 })), false);
  assert.equal(merge.localProgressFinished('{abîmé'), false);
  assert.equal(merge.localProgressFinished(null), false);
});

// --- Film : reprise ----------------------------------------------------------------------

test('movieResume : position locale d’abord (mêmes seuils : > 30 s et < 95 %)', () => {
  const remote = server({ position: 4000, duration: 6000 });
  assert.deepEqual(merge.movieResume({ position: 1200, duration: 6000 }, remote), { position: 1200, duration: 6000, estimated: false, fromServer: false });
  // Locale finie : elle gagne, pas de reprise même si le serveur en a une.
  assert.equal(merge.movieResume({ position: 5900, duration: 6000 }, remote), null);
  assert.equal(merge.movieResume({ position: 10, duration: 6000 }, remote), null);
});

test('movieResume : sans position locale, celle du serveur (exacte ou estimée)', () => {
  assert.deepEqual(merge.movieResume(null, server({ position: 1556, duration: 6000 })), { position: 1556, duration: 6000, estimated: false, fromServer: true });
  assert.deepEqual(merge.movieResume(null, server({ position: 1556, duration: 6000, estimated: true })), { position: 1556, duration: 6000, estimated: true, fromServer: true });
  assert.equal(merge.movieResume(null, server({ position: 5800, duration: 6000 })), null);
  assert.equal(merge.movieResume(null, server({ position: 20, duration: 6000 })), null);
  assert.equal(merge.movieResume(null, server()), null);
  assert.equal(merge.movieResume(null, null), null);
});

// --- Série : épisodes ----------------------------------------------------------------------

const episode = (season: number, number: number, overrides: Record<string, unknown> = {}) => ({
  season, episode: number, position: null, duration: null, estimated: false, watched: false, marked: false, ...overrides,
});

test('serverEpisodeMap : épisodes du serveur par « saison:épisode », rien en mode animé', () => {
  const remote = server({ mediaType: 'tv', episodes: [episode(7, 5, { position: 1556, duration: 2873 }), episode(7, 6, { watched: true })] });
  const map = merge.serverEpisodeMap(remote);
  assert.equal(map.size, 2);
  assert.equal(map.get('7:6')?.watched, true);
  assert.equal(merge.serverEpisodeMap({ ...remote, animeMode: true }).size, 0);
  assert.equal(merge.serverEpisodeMap(null).size, 0);
});

test('mergeEpisode : progression locale d’abord, sinon serveur ; coche = marque locale seule', () => {
  assert.deepEqual(merge.mergeEpisode({ percent: 40, hasProgress: true, watched: false }, episode(1, 1, { position: 900, duration: 1000, watched: true })),
    { percent: 40, hasProgress: true, watched: false, serverWatched: 'otherDevice', estimated: false });
  assert.deepEqual(merge.mergeEpisode({ percent: 0, hasProgress: false, watched: false }, episode(1, 1, { position: 540, duration: 1000 })),
    { percent: 54, hasProgress: true, watched: false, serverWatched: null, estimated: false });
  assert.deepEqual(merge.mergeEpisode({ percent: 0, hasProgress: false, watched: false }, episode(1, 1, { position: 900, duration: 1000, estimated: true, watched: true })),
    { percent: 90, hasProgress: true, watched: false, serverWatched: 'estimated', estimated: true });
  assert.deepEqual(merge.mergeEpisode({ percent: 0, hasProgress: false, watched: true }, episode(1, 1, { watched: true })),
    { percent: 0, hasProgress: false, watched: true, serverWatched: null, estimated: false });
  // Vu ici d'après la progression locale : pas d'indication « autre appareil ».
  assert.deepEqual(merge.mergeEpisode({ percent: 92, hasProgress: true, watched: false }, episode(1, 1, { watched: true })),
    { percent: 92, hasProgress: true, watched: false, serverWatched: null, estimated: false });
  // Marque d'épisode sur le serveur (même avec un estimé) : autre appareil.
  assert.deepEqual(merge.mergeEpisode({ percent: 0, hasProgress: false, watched: false }, episode(1, 1, { watched: true, marked: true, estimated: true })).serverWatched, 'otherDevice');
});

test('série marquée « Déjà vu » en entier : chaque épisode affiché compte comme vu (hors animé)', () => {
  assert.equal(merge.seriesFullyMarked(server({ mediaType: 'tv', markedWatched: true })), true);
  assert.equal(merge.seriesFullyMarked(server({ mediaType: 'tv', markedWatched: true, animeMode: true })), false);
  assert.equal(merge.seriesFullyMarked(server({ mediaType: 'tv' })), false);
  assert.equal(merge.seriesFullyMarked(null), false);
  // Indication à part, la coche reste celle du stockage local.
  assert.deepEqual(merge.mergeEpisode({ percent: 20, hasProgress: true, watched: false }, undefined, true),
    { percent: 20, hasProgress: true, watched: false, serverWatched: 'otherDevice', estimated: false });
});

test('durée nulle ou négative = inconnue (cas 0/0 du serveur)', () => {
  assert.equal(merge.movieResume(null, server({ position: 1556, duration: 0 })), null);
  assert.deepEqual(merge.mergeEpisode({ percent: 0, hasProgress: false, watched: false }, episode(1, 1, { position: 0, duration: 0 })),
    { percent: 0, hasProgress: false, watched: false, serverWatched: null, estimated: false });
  const result = merge.seriesResume(noLocalResume(), server({ mediaType: 'tv', season: 1, episode: 2, position: 0, duration: 0 }), { pageAnimeMode: false, availableSeasons: [], defaultStartSeason: 1 });
  assert.equal(result.hasProgress, false);
  assert.equal(result.episodeNumber, 2);
});

function noLocalResume() {
  return { seasonNumber: 1, episodeNumber: 1, position: 0, duration: 0, hasProgress: false };
}

// --- Série : reprise -------------------------------------------------------------------------

const noLocal = { seasonNumber: 1, episodeNumber: 1, position: 0, duration: 0, hasProgress: false };
const context = { pageAnimeMode: false, availableSeasons: [1, 2, 7], defaultStartSeason: 1 };

test('seriesResume : reprise locale d’abord', () => {
  const local = { seasonNumber: 2, episodeNumber: 3, position: 100, duration: 2000, hasProgress: true };
  const result = merge.seriesResume(local, server({ mediaType: 'tv', season: 7, episode: 5, position: 1556, duration: 2873 }), context);
  assert.deepEqual(result, { ...local, estimated: false, fromServer: false });
});

test('seriesResume : sans reprise locale, l’épisode courant du serveur', () => {
  const result = merge.seriesResume(noLocal, server({ mediaType: 'tv', season: 7, episode: 5, position: 1556, duration: 2873, estimated: true }), context);
  assert.deepEqual(result, { seasonNumber: 7, episodeNumber: 5, position: 1556, duration: 2873, hasProgress: true, estimated: true, fromServer: true });
  // Épisode connu sans position (marque) : « Continuer S7E6 » sans temps.
  const marked = merge.seriesResume(noLocal, server({ mediaType: 'tv', season: 7, episode: 6 }), context);
  assert.deepEqual(marked, { seasonNumber: 7, episodeNumber: 6, position: 0, duration: 0, hasProgress: false, estimated: false, fromServer: true });
});

test('seriesResume : saison absente de la fiche ou numérotation animé différente → local inchangé', () => {
  const remote = server({ mediaType: 'tv', season: 9, episode: 1, position: 100, duration: 2000 });
  assert.deepEqual(merge.seriesResume(noLocal, remote, context), { ...noLocal, estimated: false, fromServer: false });
  const anime = server({ mediaType: 'tv', animeMode: true, season: 2, episode: 12, position: 100, duration: 1400 });
  assert.deepEqual(merge.seriesResume(noLocal, anime, context), { ...noLocal, estimated: false, fromServer: false });
  // Fiche en mode animé et serveur en mode animé : la reprise animé est gardée (saisons TMDB non vérifiées).
  assert.deepEqual(merge.seriesResume(noLocal, anime, { ...context, pageAnimeMode: true }),
    { seasonNumber: 2, episodeNumber: 12, position: 100, duration: 1400, hasProgress: true, estimated: false, fromServer: true });
});

// --- Écriture de la reprise du serveur dans le stockage local (le lecteur lit progress_*) -----

test('seedProgress : seulement une position exacte venue du serveur, au format du lecteur', () => {
  const now = '2026-10-16T12:00:00.000Z';
  assert.deepEqual(JSON.parse(merge.seedProgress({ position: 1556, duration: 2873, estimated: false, fromServer: true }, now)!),
    { position: 1556, timestamp: now, duration: 2873 });
  assert.equal(merge.seedProgress({ position: 1556, duration: 2873, estimated: true, fromServer: true }, now), null);
  assert.equal(merge.seedProgress({ position: 1556, duration: 2873, estimated: false, fromServer: false }, now), null);
  assert.equal(merge.seedProgress({ position: 0, duration: 2873, estimated: false, fromServer: true }, now), null);
});
