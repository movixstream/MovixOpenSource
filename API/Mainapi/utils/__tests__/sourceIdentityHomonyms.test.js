'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// « Kraken » (2026) : film norvégien 1110034 et film français 1571766.
const tmdbCachePath = path.join(__dirname, '..', 'tmdbCache.js');
const movies = {
  1110034: { id: 1110034, title: 'Kraken', original_title: 'Kraken', release_date: '2026-02-06', poster_path: '/norvegien.jpg' },
  1571766: { id: 1571766, title: 'Kraken', original_title: 'Kraken', release_date: '2026-09-25', poster_path: '/francais.jpg' },
  27205: { id: 27205, title: 'Inception', original_title: 'Inception', release_date: '2010-07-15', poster_path: '/inception.jpg' },
};
require.cache[tmdbCachePath] = {
  id: tmdbCachePath, filename: tmdbCachePath, loaded: true,
  exports: {
    searchTmdb: async (_url, _key, _type, query, params) => ({
      results: Object.values(movies).filter(movie => movie.title === query
        && movie.release_date.startsWith(String(params.primary_release_year))),
    }),
    fetchTmdbImages: async (_url, _key, id) => ({
      posters: [{ file_path: id === 1110034 ? '/affiche-fr-norvegien.jpg' : `/autre-${id}.jpg` }], backdrops: [],
    }),
    fetchTmdbAlternativeTitles: async () => ({ titles: [] }),
    fetchTmdbCredits: async () => ({ cast: [], crew: [] }),
  },
};
const { createIdentityVerifier } = require('../sourceIdentity');

const verifier = id => createIdentityVerifier({ apiUrl: 'https://tmdb.test', apiKey: 'k', type: 'movie', details: movies[id] });
const norwegianPage = {
  titles: ['Kraken'], type: 'movie', year: 2026,
  posters: ['https://image.tmdb.org/t/p/w300/affiche-fr-norvegien.jpg'],
};

test('un homonyme de la même année désactive le raccourci titre + année', async () => {
  const result = await verifier(1571766).verify(norwegianPage, { enrich: false });
  assert.equal(result.accepted, false);
  assert.deepEqual(result.homonyms, [1110034]);
});

test('la fiche du film norvégien est refusée pour le film français', async () => {
  const result = await verifier(1571766).verify(norwegianPage);
  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'homonym_image');
});

test('la même fiche reste acceptée pour le film norvégien grâce à son affiche', async () => {
  const result = await verifier(1110034).verify(norwegianPage);
  assert.equal(result.accepted, true);
  assert.equal(result.reason, 'tmdb_image');
});

test('sans homonyme, titre + année suffisent toujours', async () => {
  const result = await verifier(27205).verify({ titles: ['Inception'], type: 'movie', year: 2010, posters: [] }, { enrich: false });
  assert.equal(result.accepted, true);
  assert.equal(result.reason, 'title_and_year');
});
