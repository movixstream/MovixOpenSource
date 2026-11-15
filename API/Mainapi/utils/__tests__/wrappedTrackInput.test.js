'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { integerInRange, normalizeViewing, normalizePage, resolveTrackPeriod } = require('../wrappedTrackInput');

test('integerInRange : entiers dans les bornes seulement', () => {
  assert.equal(integerInRange(5, 0, 23), 5);
  assert.equal(integerInRange('21', 0, 23), 21);
  assert.equal(integerInRange(0, 0, 23), 0);
  for (const value of [24, -1, 1.5, 'abc', '', null, undefined, true, NaN, {}, []]) {
    assert.equal(integerInRange(value, 0, 23), null);
  }
});

test('normalizeViewing : id TMDB pour film, série et anime', () => {
  assert.deepEqual(normalizeViewing({ contentType: 'tv', contentId: '1399', seasonNumber: 1, episodeNumber: 2, hourOfDay: 21 }, 3), {
    contentType: 'tv', contentId: '1399', contentTitle: null, seasonNumber: 1, episodeNumber: 2, hourOfDay: 21,
  });
  assert.equal(normalizeViewing({ contentType: 'anime', contentId: 37854 }, 3).contentId, '37854');
  for (const contentId of ['12a', '1.5', '-4', ' ', '12345678901']) {
    assert.deepEqual(normalizeViewing({ contentType: 'movie', contentId }, 3), { error: 'Invalid contentId' });
  }
  assert.deepEqual(normalizeViewing({ contentType: 'serie', contentId: '1' }, 3), { error: 'Invalid contentType' });
  assert.match(normalizeViewing({ contentId: '1' }, 3).error, /Missing required fields/);
  assert.match(normalizeViewing({ contentType: 'movie' }, 3).error, /Missing required fields/);
});

test('normalizeViewing : heure du serveur quand celle du client est absente ou hors bornes', () => {
  const base = { contentType: 'movie', contentId: '550' };
  assert.equal(normalizeViewing({ ...base, hourOfDay: 0 }, 13).hourOfDay, 0);
  assert.equal(normalizeViewing({ ...base, hourOfDay: 23 }, 13).hourOfDay, 23);
  for (const hourOfDay of [24, 99, -1, 'midi', null, undefined]) {
    assert.equal(normalizeViewing({ ...base, hourOfDay }, 13).hourOfDay, 13);
  }
});

test('normalizeViewing : saison et épisode sans valeur exploitable → null (comme avant pour 0)', () => {
  const base = { contentType: 'tv', contentId: '1399' };
  for (const value of [0, -1, 'x', 2.5, null, undefined, 100001]) {
    const result = normalizeViewing({ ...base, seasonNumber: value, episodeNumber: value }, 3);
    assert.equal(result.seasonNumber, null);
    assert.equal(result.episodeNumber, null);
  }
});

test('normalizeViewing : TV en direct, identifiant libre mais court, titre nettoyé et borné', () => {
  const live = normalizeViewing({ contentType: 'live-tv', contentId: ' canal+.fr ', contentTitle: `  ${'C'.repeat(300)}\n` }, 3);
  assert.equal(live.contentId, 'canal+.fr');
  assert.equal(live.contentTitle, 'C'.repeat(255));
  assert.equal(normalizeViewing({ contentType: 'live-tv', contentId: 'a', contentTitle: {} }, 3).contentTitle, null);
  assert.deepEqual(normalizeViewing({ contentType: 'live-tv', contentId: 'x'.repeat(121) }, 3), { error: 'Invalid contentId' });
  // Un titre envoyé pour un film n'est jamais gardé : il vient de TMDB.
  assert.equal(normalizeViewing({ contentType: 'movie', contentId: '550', contentTitle: 'Faux titre' }, 3).contentTitle, null);
});

test('normalizePage : nom de page en minuscules, chiffres et tirets ; métadonnées bornées', () => {
  for (const pageName of ['home', 'tv-shows', 'movie-details', 'watchparty', 'wishboard']) {
    assert.deepEqual(normalizePage({ pageName }), { pageName, meta: null });
  }
  for (const pageName of ['Home', 'a b', '-home', 'p'.repeat(51), 'é', 42, {}]) {
    assert.deepEqual(normalizePage({ pageName }), { error: 'Invalid pageName' });
  }
  assert.match(normalizePage({}).error, /Missing required field/);
  assert.equal(normalizePage({ pageName: 'home', meta: { tab: 'a' } }).meta, '{"tab":"a"}');
  assert.equal(normalizePage({ pageName: 'home', meta: { big: 'x'.repeat(2000) } }).meta, null);
  assert.equal(normalizePage({ pageName: 'home', meta: ['a'] }).meta, null);
  assert.equal(normalizePage({ pageName: 'home', meta: 'texte' }).meta, null);
});

test('resolveTrackPeriod : la date du client est gardée à un fuseau près, sinon celle du serveur', () => {
  // Heure locale du serveur : les dates sont construites en local, comme en production.
  const newYearEve = new Date(2026, 11, 31, 23, 30);
  // Client en avance (déjà le 1er janvier) : accepté, plus de 400 ni de temps perdu.
  assert.deepEqual(resolveTrackPeriod(2027, 1, newYearEve), { year: 2027, month: 1 });
  assert.deepEqual(resolveTrackPeriod(2026, 12, newYearEve), { year: 2026, month: 12 });
  // Client en retard juste après minuit.
  assert.deepEqual(resolveTrackPeriod(2026, 12, new Date(2027, 0, 1, 0, 30)), { year: 2026, month: 12 });

  const midNovember = new Date(2026, 10, 10, 12, 0);
  assert.deepEqual(resolveTrackPeriod(2026, 11, midNovember), { year: 2026, month: 11 });
  // Horloge déréglée ou requête forgée : année terminée, mois passé ou futur.
  for (const [year, month] of [[2024, 3], [2025, 11], [2026, 10], [2026, 12], [2027, 1], [2031, 11]]) {
    assert.deepEqual(resolveTrackPeriod(year, month, midNovember), { year: 2026, month: 11 });
  }
});
