import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

type Format = typeof import('../src/components/profile/historyFormat.ts');

// Module pur (aucun import) : transpilé et évalué sans Vite.
function loadFormat(): Format {
  const source = readFileSync(new URL('../src/components/profile/historyFormat.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function('exports', 'require', js)(exports, (name: string) => {
    throw new Error(`module inattendu : ${name}`);
  });
  return exports as Format;
}

const format = loadFormat();

test('formatHoursMinutes : « 12h27 », « 3h17 », minutes seules sous une heure', () => {
  assert.equal(format.formatHoursMinutes(44820), '12h27');
  assert.equal(format.formatHoursMinutes(11820), '3h17');
  assert.equal(format.formatHoursMinutes(3600), '1h00');
  assert.equal(format.formatHoursMinutes(2700), '45 min');
  assert.equal(format.formatHoursMinutes(0), '0 min');
  assert.equal(format.formatHoursMinutes(Number.NaN), '0 min');
  assert.equal(format.formatHoursMinutes(-5), '0 min');
});

test('formatHoursMinutes en anglais : « 12h 27m », « 1h », « 45m »', () => {
  assert.equal(format.formatHoursMinutes(44820, 'en-US'), '12h 27m');
  assert.equal(format.formatHoursMinutes(3900, 'en'), '1h 5m');
  assert.equal(format.formatHoursMinutes(3600, 'en-GB'), '1h');
  assert.equal(format.formatHoursMinutes(2700, 'en-US'), '45m');
  assert.equal(format.formatHoursMinutes(0, 'en-US'), '0m');
  // Toute autre langue garde la forme française.
  assert.equal(format.formatHoursMinutes(44820, 'fr-FR'), '12h27');
  assert.equal(format.formatHoursMinutes(44820, 'es'), '12h27');
});

test('watchedFigures : temps réel du lecteur en grand, temps d’après les positions en petit', () => {
  assert.deepEqual(format.watchedFigures({ watchedSeconds: 339720, trackedSeconds: 44820 }), { main: '12h27', fromPositions: '94h22' });
  assert.deepEqual(format.watchedFigures({ watchedSeconds: 339720, trackedSeconds: 44820 }, 'en-US'), { main: '12h 27m', fromPositions: '94h 22m' });
  assert.deepEqual(format.watchedFigures({ watchedSeconds: 0, trackedSeconds: 0 }), { main: '0 min', fromPositions: '0 min' });
});

test('watchedFigures : ancien serveur sans trackedSeconds → temps d’après les positions en grand, pas de ligne en plus', () => {
  assert.deepEqual(format.watchedFigures({ watchedSeconds: 44820, trackedSeconds: null }), { main: '12h27', fromPositions: null });
});

test('formatClock : « 27:52 » sous une heure, « 1:02:05 » au-delà', () => {
  assert.equal(format.formatClock(1672), '27:52');
  assert.equal(format.formatClock(5), '0:05');
  assert.equal(format.formatClock(3725), '1:02:05');
  assert.equal(format.formatClock(Number.NaN), '0:00');
});

test('formatProgress : « 27:52 / 3h17 », position seule si la durée est inconnue', () => {
  assert.equal(format.formatProgress(1672, 11820), '27:52 / 3h17');
  assert.equal(format.formatProgress(1549, 6540), '25:49 / 1h49');
  assert.equal(format.formatProgress(600, 0), '10:00');
  // Position au-delà de la durée (générique sauté, durée arrondie) : bornée.
  assert.equal(format.formatProgress(7000, 6540), '1:49:00 / 1h49');
  assert.equal(format.formatProgress(1672, 11820, 'en-US'), '27:52 / 3h 17m');
});

test('episodePercent : arrondi, borné à 0-100, null si total inconnu', () => {
  assert.equal(format.episodePercent(0, 1), 0);
  assert.equal(format.episodePercent(3, 10), 30);
  assert.equal(format.episodePercent(1, 3), 33);
  assert.equal(format.episodePercent(12, 10), 100);
  assert.equal(format.episodePercent(3, null), null);
  assert.equal(format.episodePercent(3, 0), null);
});

test('episodeCode : « S01E01 », null sans saison ni épisode valides', () => {
  assert.equal(format.episodeCode(1, 1), 'S01E01');
  assert.equal(format.episodeCode(12, 104), 'S12E104');
  assert.equal(format.episodeCode(null, 3), null);
  assert.equal(format.episodeCode(0, 0), null);
});

test('episodeCode : épisodes spéciaux (saison 0) gardés, « S00E03 »', () => {
  assert.equal(format.episodeCode(0, 3), 'S00E03');
  assert.equal(format.episodeCode(-1, 2), null);
  assert.equal(format.episodeCode(1, 0), null);
  assert.equal(format.episodeCode(1.5, 2), null);
});

// --- Lien de reprise (même chemin que le panneau « Reprendre ») -------------------

const encode = (id: number) => `x${id}`;
const target = (mediaType: 'movie' | 'tv', season: number | null, episode: number | null) =>
  ({ mediaType, tmdbId: 1399, season, episode });

test('watchPath : film → lecteur du film', () => {
  assert.equal(format.watchPath(target('movie', null, null), encode), '/watch/movie/x1399');
  assert.equal(format.watchPath(target('movie', 2, 5), encode), '/watch/movie/x1399');
});

test('watchPath : série → l’épisode indiqué', () => {
  assert.equal(format.watchPath(target('tv', 2, 5), encode), '/watch/tv/x1399/s/2/e/5');
});

test('watchPath : saison ou épisode absents → S1E1, ou l’épisode 1 de la saison connue', () => {
  assert.equal(format.watchPath(target('tv', null, null), encode), '/watch/tv/x1399/s/1/e/1');
  assert.equal(format.watchPath(target('tv', 2, null), encode), '/watch/tv/x1399/s/2/e/1');
  assert.equal(format.watchPath(target('tv', null, 4), encode), '/watch/tv/x1399/s/1/e/4');
  assert.equal(format.watchPath(target('tv', 1.5, 0), encode), '/watch/tv/x1399/s/1/e/1');
});

test('watchPath : épisode spécial S00E03 gardé, saison 0 sans épisode → S1E1', () => {
  assert.equal(format.watchPath(target('tv', 0, 3), encode), '/watch/tv/x1399/s/0/e/3');
  assert.equal(format.watchPath(target('tv', 0, null), encode), '/watch/tv/x1399/s/1/e/1');
});

// --- Animés (numérotation anime-sama, pas TMDB) ----------------------------------

test('watchPath : animé → lecteur animé /watch/anime/{id}/season/{s}/episode/{e}', () => {
  assert.equal(format.watchPath({ ...target('tv', 2, 12), animeMode: true }, encode), '/watch/anime/x1399/season/2/episode/12');
  assert.equal(format.watchPath({ ...target('tv', null, null), animeMode: true }, encode), '/watch/anime/x1399/season/1/episode/1');
  assert.equal(format.watchPath({ ...target('tv', 2, 12), animeMode: false }, encode), '/watch/tv/x1399/s/2/e/12');
});

const row = (overrides: Record<string, unknown> = {}) => ({
  mediaType: 'tv' as 'movie' | 'tv',
  animeMode: false,
  position: null as number | null,
  duration: null as number | null,
  estimated: false,
  markedWatched: false,
  episodesWatched: null as number | null,
  episodesTotal: null as number | null,
  ...overrides,
});

test('progressMeta : série TMDB → « 3/10 épisodes » ; animé → « 3 épisodes vus », jamais de total ni de pourcentage', () => {
  assert.deepEqual(format.progressMeta(row({ episodesWatched: 3, episodesTotal: 10 })), { kind: 'episodes', watched: 3, total: 10, percent: 30 });
  assert.deepEqual(format.progressMeta(row({ animeMode: true, episodesWatched: 3, episodesTotal: null })), { kind: 'count', watched: 3 });
  // Même si un total arrivait quand même, la numérotation anime-sama ne suit pas TMDB : pas de ratio.
  assert.deepEqual(format.progressMeta(row({ animeMode: true, episodesWatched: 3, episodesTotal: 10 })), { kind: 'count', watched: 3 });
  assert.deepEqual(format.progressMeta(row({ animeMode: true, episodesWatched: 1 })), { kind: 'count', watched: 1 });
  assert.deepEqual(format.progressMeta(row({ animeMode: true, markedWatched: true })), { kind: 'watched' });
  assert.deepEqual(format.progressMeta(row({ mediaType: 'movie', position: 1672, duration: 11820 })), { kind: 'progress', text: '27:52 / 3h17' });
});

// --- Avancement de l'épisode affiché (séries et animés) ------------------------------

test('episodeProgress : « 54 % » de l’épisode affiché, marqué estimé s’il vient d’un lecteur web', () => {
  assert.deepEqual(format.episodeProgress({ mediaType: 'tv', position: 1620, duration: 3000, estimated: false }), { percent: 54, estimated: false });
  assert.deepEqual(format.episodeProgress({ mediaType: 'tv', position: 1620, duration: 3000, estimated: true }), { percent: 54, estimated: true });
  assert.deepEqual(format.episodeProgress({ mediaType: 'tv', position: 4000, duration: 3000, estimated: false }), { percent: 100, estimated: false });
});

test('episodeProgress : rien sans position ou durée, ni pour un film (sa ligne a déjà son temps)', () => {
  assert.equal(format.episodeProgress({ mediaType: 'tv', position: null, duration: 3000, estimated: false }), null);
  assert.equal(format.episodeProgress({ mediaType: 'tv', position: 1620, duration: null, estimated: false }), null);
  assert.equal(format.episodeProgress({ mediaType: 'tv', position: 0, duration: 3000, estimated: false }), null);
  assert.equal(format.episodeProgress({ mediaType: 'movie', position: 1620, duration: 3000, estimated: false }), null);
});

// --- Ligne de date :« Dernière lecture · … » seulement pour une série lancée --------

test('isLastPlayedDate : série lancée → oui ; film, série jamais lancée ou seulement marquée → non', () => {
  assert.equal(format.isLastPlayedDate({ mediaType: 'tv', position: 1200 }), true);
  assert.equal(format.isLastPlayedDate({ mediaType: 'tv', position: 0 }), false);
  assert.equal(format.isLastPlayedDate({ mediaType: 'tv', position: null }), false);
  assert.equal(format.isLastPlayedDate({ mediaType: 'tv', position: Number.NaN }), false);
  assert.equal(format.isLastPlayedDate({ mediaType: 'movie', position: 1200 }), false);
});

// --- Avenant v2 : ligne d'un film (estimé, « Vu », temps) -------------------------

const movie = (overrides: Partial<Parameters<Format['movieMeta']>[0]> = {}) => ({
  position: null as number | null,
  duration: null as number | null,
  estimated: false,
  markedWatched: false,
  ...overrides,
});

test('movieMeta : lecteur web → pourcentage estimé arrondi et borné à 100', () => {
  assert.deepEqual(format.movieMeta(movie({ position: 2820, duration: 6000, estimated: true })), { kind: 'estimated', percent: 47 });
  assert.deepEqual(format.movieMeta(movie({ position: 9000, duration: 6000, estimated: true })), { kind: 'estimated', percent: 100 });
  // Estimé et marqué « Déjà vu » : c'est une progression, on la montre.
  assert.deepEqual(format.movieMeta(movie({ position: 600, duration: 6000, estimated: true, markedWatched: true })), { kind: 'estimated', percent: 10 });
});

test('movieMeta : estimé sans durée ni temps → pas de pourcentage inventé', () => {
  assert.deepEqual(format.movieMeta(movie({ position: 2820, duration: null, estimated: true })), { kind: 'none' });
  assert.deepEqual(format.movieMeta(movie({ position: 0, duration: 6000, estimated: true })), { kind: 'none' });
  assert.deepEqual(format.movieMeta(movie({ position: 2820, duration: 0, estimated: true, markedWatched: true })), { kind: 'watched' });
});

test('movieMeta : marqué « Déjà vu » sans progression → « Vu »', () => {
  assert.deepEqual(format.movieMeta(movie({ markedWatched: true })), { kind: 'watched' });
  assert.deepEqual(format.movieMeta(movie({ position: 0, duration: 6540, markedWatched: true })), { kind: 'watched' });
  assert.deepEqual(format.movieMeta(movie({ position: Number.NaN, duration: null, markedWatched: true })), { kind: 'watched' });
});

test('movieMeta : progression exacte → « 27:52 / 3h17 », même marqué', () => {
  assert.deepEqual(format.movieMeta(movie({ position: 1672, duration: 11820 })), { kind: 'progress', text: '27:52 / 3h17' });
  assert.deepEqual(format.movieMeta(movie({ position: 1672, duration: 11820, markedWatched: true })), { kind: 'progress', text: '27:52 / 3h17' });
  // Ouvert sans lecture : la durée seule reste utile (comme en v1).
  assert.deepEqual(format.movieMeta(movie({ position: 0, duration: 6540 })), { kind: 'progress', text: '0:00 / 1h49' });
  assert.deepEqual(format.movieMeta(movie({ position: 1672, duration: 11820 }), 'en-US'), { kind: 'progress', text: '27:52 / 3h 17m' });
});

test('movieMeta : rien de connu → rien', () => {
  assert.deepEqual(format.movieMeta(movie()), { kind: 'none' });
});

// --- Ligne d'une série : épisodes, ou « Vu » si marquée sans total connu ----------

const series = (overrides: Partial<Parameters<Format['seriesMeta']>[0]> = {}) => ({
  episodesWatched: null as number | null,
  episodesTotal: null as number | null,
  markedWatched: false,
  ...overrides,
});

test('seriesMeta : total connu → « 3/10 épisodes (30 %) », même marquée', () => {
  assert.deepEqual(format.seriesMeta(series({ episodesWatched: 3, episodesTotal: 10 })), { kind: 'episodes', watched: 3, total: 10, percent: 30 });
  assert.deepEqual(format.seriesMeta(series({ episodesWatched: null, episodesTotal: 1 })), { kind: 'episodes', watched: 0, total: 1, percent: 0 });
  // Le serveur met episodesWatched = episodesTotal pour une série marquée en entier.
  assert.deepEqual(format.seriesMeta(series({ episodesWatched: 62, episodesTotal: 62, markedWatched: true })), { kind: 'episodes', watched: 62, total: 62, percent: 100 });
});

test('seriesMeta : marquée « Déjà vu » sans total connu → « Vu » plutôt qu’un nombre d’épisodes', () => {
  assert.deepEqual(format.seriesMeta(series({ markedWatched: true })), { kind: 'watched' });
  assert.deepEqual(format.seriesMeta(series({ episodesWatched: 5, episodesTotal: null, markedWatched: true })), { kind: 'watched' });
  assert.deepEqual(format.seriesMeta(series({ episodesWatched: 0, episodesTotal: 0, markedWatched: true })), { kind: 'watched' });
});

test('seriesMeta : non marquée sans total connu → « 3 épisodes »', () => {
  assert.deepEqual(format.seriesMeta(series({ episodesWatched: 3 })), { kind: 'count', watched: 3 });
  assert.deepEqual(format.seriesMeta(series({ episodesWatched: Number.NaN })), { kind: 'count', watched: 0 });
});

test('pageCount : au moins une page', () => {
  assert.equal(format.pageCount(16, 10), 2);
  assert.equal(format.pageCount(20, 10), 2);
  assert.equal(format.pageCount(0, 10), 1);
  assert.equal(format.pageCount(5, 0), 1);
});
