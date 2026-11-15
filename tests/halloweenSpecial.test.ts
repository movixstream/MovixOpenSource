// Rangée « Spécial Halloween » : la règle des trois mois, le compte à rebours
// et le mélange du jour. Une date limite fausse proposerait des films encore
// introuvables ; un mélange instable changerait la rangée à chaque visite.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HALLOWEEN_MOODS,
  daysUntilHalloween,
  halloweenQuery,
  isHalloweenMood,
  releaseCutoff,
  seededShuffle,
  toHalloweenMovies,
} from '../src/utils/halloweenSpecial.ts';

test('la date limite recule de trois mois, sans déborder sur le mois suivant', () => {
  assert.equal(releaseCutoff(new Date(2026, 9, 8)), '2026-07-08');
  assert.equal(releaseCutoff(new Date(2026, 1, 15)), '2025-11-15');
  // 31 mai → février n'a pas de 31 : dernier jour de février, pas le 3 mars.
  assert.equal(releaseCutoff(new Date(2026, 4, 31)), '2026-02-28');
  assert.equal(releaseCutoff(new Date(2028, 4, 31)), '2028-02-29');
});

test('chaque humeur demande des films sortis avant la date limite, sans contenu adulte', () => {
  const now = new Date(2026, 9, 8);
  for (const mood of HALLOWEEN_MOODS) {
    const query = halloweenQuery(mood, 'fr-FR', 2, now);
    assert.equal(query['primary_release_date.lte'], '2026-07-08', mood);
    assert.equal(query.include_adult, 'false', mood);
    assert.equal(query.language, 'fr-FR', mood);
    assert.equal(query.page, 2, mood);
  }
  assert.equal(halloweenQuery('soft', 'fr-FR', 1, now)['certification.lte'], 'PG');
  assert.equal(halloweenQuery('terror', 'fr-FR', 1, now).with_genres, 27);
});

test('les humeurs inconnues sont refusées', () => {
  assert.equal(isHalloweenMood('chills'), true);
  assert.equal(isHalloweenMood('gore'), false);
  assert.equal(isHalloweenMood(null), false);
});

test('le compte à rebours tombe à zéro le 31 octobre', () => {
  assert.equal(daysUntilHalloween(new Date(2026, 9, 8, 23, 59)), 23);
  assert.equal(daysUntilHalloween(new Date(2026, 9, 31, 0, 1)), 0);
  assert.equal(daysUntilHalloween(new Date(2026, 10, 1)), -1);
  // Passage à l'heure d'hiver (25 octobre 2026) : toujours des jours entiers.
  assert.equal(daysUntilHalloween(new Date(2026, 9, 26)), 5);
});

test('le mélange est stable pour une graine, change avec elle et garde tout', () => {
  const items = Array.from({ length: 30 }, (_, i) => i);
  const a = seededShuffle(items, '2026-10-08:chills');
  assert.deepEqual(a, seededShuffle(items, '2026-10-08:chills'));
  assert.notDeepEqual(a, seededShuffle(items, '2026-10-09:chills'));
  assert.deepEqual([...a].sort((x, y) => x - y), items);
  assert.deepEqual(items, Array.from({ length: 30 }, (_, i) => i), 'l\'entrée ne doit pas bouger');
});

test('seuls les films affichables, uniques et assez anciens sont gardés', () => {
  const movies = toHalloweenMovies([
    { id: 1, title: 'Hocus Pocus', poster_path: '/a.jpg', overview: 'Sorcières.', release_date: '1993-07-16' },
    { id: 1, title: 'Hocus Pocus', poster_path: '/a.jpg', overview: 'Sorcières.', release_date: '1993-07-16' },
    { id: 2, title: 'Sans affiche', poster_path: null, overview: 'x', release_date: '2000-01-01' },
    { id: 3, title: 'Sans résumé', poster_path: '/c.jpg', overview: '  ', release_date: '2000-01-01' },
    { id: 4, title: 'Trop récent', poster_path: '/d.jpg', overview: 'x', release_date: '2026-09-01' },
    { id: 5, title: 'Sans date', poster_path: '/e.jpg', overview: 'x' },
  ], '2026-07-08');
  assert.deepEqual(movies.map((m) => m.id), [1]);
  assert.equal(movies[0].media_type, 'movie');
});
