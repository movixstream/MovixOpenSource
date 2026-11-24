// Filmographie de la page d'une personne : fusion des rôles par titre,
// « Connu pour », groupes par année et âge.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACTING, ageInYears, compareByDateDesc, departmentsByCount, groupByYear, mergePersonCredits, pickKnownFor,
  type PersonCreditInput,
} from '../src/components/details/person/personCredits.ts';

const movie = (id: number, extra: Partial<PersonCreditInput> = {}): PersonCreditInput => ({
  id, media_type: 'movie', title: `Film ${id}`, poster_path: `/p${id}.jpg`, release_date: '2010-05-01', vote_count: 100, ...extra,
});
const series = (id: number, extra: Partial<PersonCreditInput> = {}): PersonCreditInput => ({
  id, media_type: 'tv', name: `Série ${id}`, poster_path: `/s${id}.jpg`, first_air_date: '2015-01-01', vote_count: 100, ...extra,
});

test('un titre joué et produit ne fait qu\'une ligne, avec ses rôles et métiers', () => {
  const credits = mergePersonCredits(
    [movie(1, { character: 'Tony Stark', order: 0 }), movie(1, { character: 'Iron Man', order: 3 })],
    [movie(1, { job: 'Executive Producer', department: 'Production' }), movie(1, { job: 'Executive Producer', department: 'Production' })],
  );
  assert.equal(credits.length, 1);
  assert.deepEqual(credits[0].characters, ['Tony Stark', 'Iron Man']);
  assert.deepEqual(credits[0].jobs, ['Executive Producer']);
  assert.deepEqual(credits[0].departments, [ACTING, 'Production']);
  assert.equal(credits[0].order, 0);
});

test('un film et une série au même identifiant TMDB restent distincts', () => {
  const credits = mergePersonCredits([movie(7), series(7)], []);
  assert.deepEqual(credits.map((credit) => credit.key).sort(), ['movie-7', 'tv-7']);
  assert.equal(credits.find((credit) => credit.media_type === 'tv')?.title, 'Série 7');
});

test('dates abîmées ignorées, entrées sans type écartées', () => {
  const credits = mergePersonCredits([movie(2, { release_date: '' }), { id: 3, title: 'Sans type' }], []);
  assert.equal(credits.length, 1);
  assert.equal(credits[0].date, null);
  assert.equal(credits[0].year, null);
});

test('« Connu pour » écarte talk-shows et passages d\'un épisode', () => {
  const credits = mergePersonCredits([
    series(10, { character: 'Self', genre_ids: [10767], vote_count: 9000, episode_count: 40 }),
    series(11, { character: 'Guest', vote_count: 5000, episode_count: 1 }),
    movie(12, { character: 'Lead', vote_count: 2000, order: 0 }),
    movie(13, { character: 'Lead', vote_count: 1500, order: 1 }),
    movie(14, { character: 'Lead', vote_count: 1200, order: 0 }),
    movie(15, { character: 'Lead', vote_count: 1000, order: 2 }),
  ], []);
  const known = pickKnownFor(credits, ACTING, 4).map((credit) => credit.key);
  assert.deepEqual(known, ['movie-12', 'movie-13', 'movie-14', 'movie-15']);
  assert.ok(!known.includes('tv-10'));
});

test('« Connu pour » d\'un réalisateur : ses films réalisés d\'abord', () => {
  const credits = mergePersonCredits(
    [movie(20, { character: 'Cameo', vote_count: 9000 })],
    [21, 22, 23, 24].map((id) => movie(id, { job: 'Director', department: 'Directing', vote_count: 1000 + id })),
  );
  const known = pickKnownFor(credits, 'Directing', 4).map((credit) => credit.id);
  assert.deepEqual(known, [24, 23, 22, 21]);
});

test('« Connu pour » : un rôle principal de série passe avant quelques épisodes d’une série plus vue', () => {
  const credits = mergePersonCredits([
    series(50, { character: 'Hal', vote_count: 1200, episode_count: 151 }),
    series(51, { character: 'Guest', vote_count: 4000, episode_count: 3 }),
  ], []);
  assert.deepEqual(pickKnownFor(credits, ACTING, 2).map((credit) => credit.id), [50, 51]);
});

test('plusieurs personnages d’une même série : leurs épisodes s’additionnent', () => {
  const credits = mergePersonCredits([
    series(60, { character: 'Bert (voice)', episode_count: 4 }),
    series(60, { character: 'Dr. Jewish (voice)', episode_count: 1 }),
  ], [series(60, { job: 'Producer', department: 'Production', episode_count: 2 })]);
  assert.equal(credits[0].episodeCount, 5);
});

test('groupes par année, sans date en tête', () => {
  const credits = mergePersonCredits([
    movie(30, { release_date: '2001-03-01' }), movie(31, { release_date: '2020-02-01' }),
    movie(32, { release_date: '' }), movie(33, { release_date: '2020-11-01' }),
  ], []).sort(compareByDateDesc);
  assert.deepEqual(groupByYear(credits).map((group) => [group.year, group.credits.map((credit) => credit.id)]), [
    [null, [32]], [2020, [33, 31]], [2001, [30]],
  ]);
});

test('départements : le métier principal d\'abord, puis les plus fournis', () => {
  const credits = mergePersonCredits(
    [movie(40), movie(41)],
    [movie(42, { department: 'Writing', job: 'Writer' }), movie(43, { department: 'Writing', job: 'Writer' }), movie(44, { department: 'Writing', job: 'Story' }), movie(45, { department: 'Directing', job: 'Director' })],
  );
  assert.deepEqual(departmentsByCount(credits, 'Directing').map((entry) => entry.department), ['Directing', 'Writing', ACTING]);
});

test('âge en années pleines, à aujourd\'hui ou au décès', () => {
  assert.equal(ageInYears('1965-04-04', '2026-04-03'), 60);
  assert.equal(ageInYears('1965-04-04', '2026-04-04'), 61);
  assert.equal(ageInYears('1930-08-25', '2020-10-31'), 90);
  assert.equal(ageInYears(null, '2026-01-01'), null);
  assert.equal(ageInYears('pas une date', '2026-01-01'), null);
});
