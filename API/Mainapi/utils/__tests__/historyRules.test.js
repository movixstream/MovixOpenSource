const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseProgressKey,
  parseProgressValue,
  parseContinueWatching,
  isFinished,
  nextPointer,
} = require('../historyRules');

const SEASONS = [{ season: 1, episodes: 10 }, { season: 2, episodes: 8 }];

test('parseProgressKey lit les clés de film et d’épisode', () => {
  assert.deepEqual(parseProgressKey('progress_550'), { mediaType: 'movie', tmdbId: 550, season: 0, episode: 0 });
  assert.deepEqual(parseProgressKey('progress_tv_94997_s2_e3'), { mediaType: 'tv', tmdbId: 94997, season: 2, episode: 3 });
});

test('parseProgressKey refuse les autres clés', () => {
  assert.equal(parseProgressKey('progress_abc'), null);
  assert.equal(parseProgressKey('progress_0'), null);
  assert.equal(parseProgressKey('progress_tv_94997'), null);
  assert.equal(parseProgressKey('progress_tv_94997_s2_e3_x'), null);
  assert.equal(parseProgressKey('continueWatching'), null);
  assert.equal(parseProgressKey(null), null);
  assert.equal(parseProgressKey(550), null);
});

test('parseProgressValue lit position, durée et date', () => {
  assert.deepEqual(
    parseProgressValue('{"position":600,"duration":3600,"timestamp":"2026-10-15T10:00:00.000Z"}'),
    { position: 600, duration: 3600, updatedAt: new Date('2026-10-15T10:00:00.000Z') },
  );
});

test('parseProgressValue refuse les valeurs invalides', () => {
  assert.equal(parseProgressValue('oups'), null);
  assert.equal(parseProgressValue('null'), null);
  assert.equal(parseProgressValue('{"position":-1,"duration":3600,"timestamp":"2026-10-15T10:00:00.000Z"}'), null);
  assert.equal(parseProgressValue('{"position":"abc","duration":3600,"timestamp":"2026-10-15T10:00:00.000Z"}'), null);
  assert.equal(parseProgressValue('{"position":600,"duration":-5,"timestamp":"2026-10-15T10:00:00.000Z"}'), null);
  assert.equal(parseProgressValue('{"position":600,"duration":3600}'), null);
  assert.equal(parseProgressValue('{"position":600,"duration":3600,"timestamp":"pas une date"}'), null);
});

test('parseContinueWatching lit le format {movies,tv} avec nombres seuls', () => {
  const entries = parseContinueWatching('{"movies":[{"id":550,"lastAccessed":"2026-10-16T09:00:00.000Z"},27205],"tv":[{"id":125988,"currentEpisode":{"season":1,"episode":4}}]}');
  assert.equal(entries.length, 3);
  assert.deepEqual(entries[0], { mediaType: 'movie', tmdbId: 550, season: null, episode: null, lastAccessed: new Date('2026-10-16T09:00:00.000Z') });
  assert.deepEqual(entries[1], { mediaType: 'movie', tmdbId: 27205, season: null, episode: null, lastAccessed: null });
  assert.deepEqual(entries[2], { mediaType: 'tv', tmdbId: 125988, season: 1, episode: 4, lastAccessed: null });
});

test('parseContinueWatching refuse le JSON invalide', () => {
  assert.deepEqual(parseContinueWatching('oups'), []);
  assert.deepEqual(parseContinueWatching('null'), []);
  assert.deepEqual(parseContinueWatching('42'), []);
});

test('parseContinueWatching lit l’ancien tableau plat', () => {
  const entries = parseContinueWatching(JSON.stringify([
    { id: 550, media_type: 'movie' },
    { id: '1399', type: 'tv', currentEpisode: { season: '2', episode: 5 }, lastAccessed: '2026-10-01T00:00:00.000Z' },
    { id: 12, media_type: 'person' },
    { id: -3, media_type: 'movie' },
    { id: '12abc', media_type: 'movie' },
  ]));
  assert.deepEqual(entries, [
    { mediaType: 'movie', tmdbId: 550, season: null, episode: null, lastAccessed: null },
    { mediaType: 'tv', tmdbId: 1399, season: 2, episode: 5, lastAccessed: new Date('2026-10-01T00:00:00.000Z') },
  ]);
});

test('parseContinueWatching ignore les entrées cassées sans planter', () => {
  const entries = parseContinueWatching('{"movies":[null,"abc",{"id":"27205","lastAccessed":"n’importe quoi"}],"tv":[{"id":1},{"id":2,"currentEpisode":{"season":0,"episode":-1}},7]}');
  assert.deepEqual(entries, [
    { mediaType: 'movie', tmdbId: 27205, season: null, episode: null, lastAccessed: null },
    { mediaType: 'tv', tmdbId: 1, season: null, episode: null, lastAccessed: null },
    { mediaType: 'tv', tmdbId: 2, season: null, episode: null, lastAccessed: null },
    { mediaType: 'tv', tmdbId: 7, season: null, episode: null, lastAccessed: null },
  ]);
});

test('isFinished applique le seuil de 95 %', () => {
  assert.equal(isFinished(95, 100), true);
  assert.equal(isFinished(94.9, 100), false);
  assert.equal(isFinished(10, 0), false);
});

test('nextPointer : film tel quel', () => {
  assert.deepEqual(nextPointer({ mediaType: 'movie', season: 0, episode: 0, finished: true, seasons: null }), { season: 0, episode: 0, finished: true });
  assert.deepEqual(nextPointer({ mediaType: 'movie', season: 0, episode: 0, finished: false, seasons: null }), { season: 0, episode: 0, finished: false });
});

test('nextPointer : épisode non fini garde le pointeur', () => {
  assert.deepEqual(nextPointer({ mediaType: 'tv', season: 1, episode: 3, finished: false, seasons: SEASONS }), { season: 1, episode: 3, finished: false });
});

test('nextPointer : épisode suivant dans la saison', () => {
  assert.deepEqual(nextPointer({ mediaType: 'tv', season: 1, episode: 3, finished: true, seasons: SEASONS }), { season: 1, episode: 4, finished: false });
});

test('nextPointer : fin de saison → épisode 1 de la saison suivante', () => {
  assert.deepEqual(
    nextPointer({ mediaType: 'tv', season: 1, episode: 10, finished: true, seasons: SEASONS }),
    { season: 2, episode: 1, finished: false },
  );
});

test('nextPointer : saute une saison absente', () => {
  assert.deepEqual(
    nextPointer({ mediaType: 'tv', season: 1, episode: 10, finished: true, seasons: [{ season: 3, episodes: 6 }, { season: 1, episodes: 10 }] }),
    { season: 3, episode: 1, finished: false },
  );
});

test('nextPointer : dernier épisode de la dernière saison → fini', () => {
  assert.deepEqual(
    nextPointer({ mediaType: 'tv', season: 2, episode: 8, finished: true, seasons: SEASONS }),
    { season: 2, episode: 8, finished: true },
  );
});

test('nextPointer : sans infos TMDB, la carte reste sur l’épisode fini', () => {
  assert.deepEqual(
    nextPointer({ mediaType: 'tv', season: 1, episode: 3, finished: true, seasons: null }),
    { season: 1, episode: 3, finished: false },
  );
});
