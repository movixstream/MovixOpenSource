'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Faux tmdbCache : chaque test règle les réponses ; un appel strict peut lever TMDB_TRANSIENT.
const transient = () => Object.assign(new Error('TMDB temporairement indisponible (rate_limited)'),
  { code: 'TMDB_TRANSIENT', transient: true, reason: 'rate_limited' });
const calls = [];
let tmdb;
const respond = (name, id, options) => {
  calls.push([name, id, options]);
  const value = tmdb[name]?.(id);
  if (value === 'transient') return options?.strict ? Promise.reject(transient()) : Promise.resolve(null);
  return Promise.resolve(value ?? null);
};
const tmdbCachePath = path.join(__dirname, '..', 'tmdbCache.js');
require.cache[tmdbCachePath] = {
  id: tmdbCachePath, filename: tmdbCachePath, loaded: true,
  exports: {
    searchTmdb: async (_url, _key, _type, query) => {
      calls.push(['search', query]);
      if (tmdb.search === 'error') throw transient();
      return { results: tmdb.search || [] };
    },
    fetchTmdbImages: (_url, _key, id, _type, options) => respond('images', id, options),
    fetchTmdbAlternativeTitles: (_url, _key, id, _type, options) => respond('aliases', id, options),
    fetchTmdbCredits: (_url, _key, id, _type, options) => respond('credits', id, options),
  },
};
const { createIdentityVerifier } = require('../sourceIdentity');

const inception = { id: 27205, title: 'Inception', original_title: 'Inception', release_date: '2010-07-15', poster_path: '/inception.jpg' };
const verifier = (details = inception) => createIdentityVerifier({ apiUrl: 'https://tmdb.test', apiKey: 'k', type: 'movie', details });
const setup = (responses) => { tmdb = responses; calls.length = 0; };

test('aliases() rejette TMDB_TRANSIENT au lieu de rendre les seuls titres de base', async () => {
  setup({ aliases: () => 'transient' });
  await assert.rejects(verifier().aliases(), { code: 'TMDB_TRANSIENT' });
  assert.deepEqual(calls, [['aliases', 27205, { strict: true }]]);
});

test('verify() rejette TMDB_TRANSIENT quand les titres alternatifs sont indisponibles', async () => {
  setup({ aliases: () => 'transient' });
  // Bon titre, mauvaise année : il faut enrichir.
  await assert.rejects(verifier().verify({ titles: ['Inception'], type: 'movie', year: 2012, posters: [] }), { code: 'TMDB_TRANSIENT' });
});

test('verify() rejette TMDB_TRANSIENT quand les crédits sont indisponibles, au lieu d’un refus identity_unconfirmed', async () => {
  setup({ aliases: () => ({ titles: [] }), credits: () => 'transient' });
  await assert.rejects(verifier().verify({ titles: ['Inception'], type: 'movie', year: 2012, posters: [], cast: ['Leonardo DiCaprio'] }),
    { code: 'TMDB_TRANSIENT' });
  assert.deepEqual(calls.find(([name]) => name === 'credits'), ['credits', 27205, { strict: true }]);
});

test('verify() rejette TMDB_TRANSIENT quand les images sont indisponibles', async () => {
  setup({ images: () => 'transient' });
  const page = { titles: ['Inception'], type: 'movie', year: 2012, posters: ['https://image.tmdb.org/t/p/w300/autre.jpg'] };
  await assert.rejects(verifier().verify(page), { code: 'TMDB_TRANSIENT' });
  assert.deepEqual(calls.find(([name]) => name === 'images'), ['images', 27205, { strict: true }]);
});

test('verify() rejette TMDB_TRANSIENT quand les images d’un homonyme sont indisponibles', async () => {
  const homonym = { id: 999, title: 'Inception', release_date: '2010-01-01', poster_path: '/homonyme.jpg' };
  setup({ search: [homonym], images: id => id === 999 ? 'transient' : { posters: [], backdrops: [] } });
  const page = { titles: ['Inception'], type: 'movie', year: 2010, posters: ['https://image.tmdb.org/t/p/w300/autre.jpg'] };
  await assert.rejects(verifier().verify(page), { code: 'TMDB_TRANSIENT' });
});

test('une recherche d’homonymes en échec garde l’ancien comportement : titre + année suffisent', async () => {
  setup({ search: 'error' });
  const result = await verifier().verify({ titles: ['Inception'], type: 'movie', year: 2010, posters: [] }, { enrich: false });
  assert.equal(result.accepted, true);
  assert.equal(result.reason, 'title_and_year');
});

test('sans échec TMDB, verify() refuse toujours une fiche non corroborée', async () => {
  setup({ aliases: () => ({ titles: [] }), credits: () => ({ cast: [], crew: [] }) });
  const result = await verifier().verify({ titles: ['Inception'], type: 'movie', year: 2012, posters: [], cast: ['Inconnu'] });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'identity_unconfirmed');
});
