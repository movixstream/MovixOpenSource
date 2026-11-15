'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const vm = require('node:vm');

const filename = path.join(__dirname, '..', 'fstream.js');
const source = fs.readFileSync(filename, 'utf8');
const fragment = (begin, end) => {
  const start = source.indexOf(begin), stop = source.indexOf(end, start);
  assert.ok(start > 0 && stop > start);
  return source.slice(start, stop);
};

// Fonctions pures du module, sans Redis ni réseau.
const numberingPath = path.resolve(__dirname, '../../utils/tvmazeNumbering.js');
const numbering = (() => {
  const originalLoad = Module._load;
  delete require.cache[numberingPath];
  Module._load = function stub(request, parent, isMain) {
    if (parent?.filename === numberingPath && request === '../config/redis') return { memoryCache: {} };
    if (parent?.filename === numberingPath && request === '../services/mediaSegments/identifiers') return {};
    return originalLoad.call(this, request, parent, isMain);
  };
  try { return require(numberingPath); } finally {
    Module._load = originalLoad;
    delete require.cache[numberingPath];
  }
})();

const TMDB = { 1: 10, 2: 7, 3: 8 };
const TVMAZE = { 1: 5, 2: 5, 3: 7, 4: 8 };
const player = (season, number) => ({ url: `https://player.test/s${season}e${number}`, type: 'embed', quality: 'HD', player: 'Test' });
// Saison FStream « telle quelle » : épisodes 1..count, un lecteur VF chacun.
const fstreamSeason = (season, count) => ({
  data: {
    success: true, source: 'FStream', type: 'tv', tmdb: { id: 96677 }, total: count,
    search: { bestMatch: { seasonNumber: season } },
    metadata: { season, extractedAt: 'x' },
    episodes: Object.fromEntries(Array.from({ length: count }, (_, i) => [i + 1, {
      number: i + 1, title: `Episode ${i + 1}`, languages: { VF: [player(season, i + 1)], VOSTFR: [], VOENG: [], Default: [] },
    }])),
  },
  revalidate: null,
});

function load({ fstream = {}, tmdb = TMDB, tvmaze = TVMAZE } = {}) {
  const seasonCalls = [], tvmazeCalls = [];
  const context = vm.createContext({
    TMDB_API_URL: 'https://tmdb.test', TMDB_API_KEY: 'key',
    fetchTmdbDetails: async () => ({ seasons: Object.entries(tmdb).map(([n, c]) => ({ season_number: Number(n), episode_count: c })) }),
    fetchTvmazeSeasonCounts: async id => { tvmazeCalls.push(id); return tvmaze; },
    getFStreamSeason: async (type, id, season, episode) => {
      seasonCalls.push([type, id, season, episode]);
      const value = fstream[season];
      if (value instanceof Error) throw value;
      return value ?? { data: null, revalidate: null };
    },
    uncachedFStreamResponse: (status, body) => ({ __fstreamResponse: true, status, body }),
    tmdbSeasonCounts: numbering.tmdbSeasonCounts,
    mapTmdbSeasonToTvmaze: numbering.mapTmdbSeasonToTvmaze,
    sourceFollowsTvmaze: numbering.sourceFollowsTvmaze,
  });
  vm.runInContext(`${fragment('const lastEpisodeNumber', 'async function serveFStream(')}
globalThis.getTvmazeNumberedSeason = getTvmazeNumberedSeason;`, context, { filename });
  return { get: context.getTvmazeNumberedSeason, seasonCalls, tvmazeCalls };
}
const url = episode => episode?.languages.VF[0].url;

test('Lupin saison 1 TMDB : épisodes 1-5 de la saison 1 FStream, puis 1-5 de la saison 2', async () => {
  const api = load({ fstream: { 2: fstreamSeason(2, 5) } });
  const result = await api.get('96677', 1, fstreamSeason(1, 5));
  assert.deepEqual(api.seasonCalls, [['tv', '96677', '2', null]]);
  const { episodes, total, metadata } = result.data;
  assert.equal(Object.keys(episodes).length, 10);
  assert.equal(total, 10);
  assert.equal(url(episodes[5]), 'https://player.test/s1e5');
  assert.equal(url(episodes[6]), 'https://player.test/s2e1');
  assert.equal(url(episodes[10]), 'https://player.test/s2e5');
  assert.equal(episodes[6].number, 6);
  assert.equal(episodes[6].title, 'Episode 6');
  assert.deepEqual(JSON.parse(JSON.stringify(metadata)), { season: 1, extractedAt: 'x', numbering: 'tvmaze', fstreamSeasons: [1, 2] });
});

test('Lupin saison 3 TMDB (partie 4) : saison 4 FStream, même en cours de mise en ligne', async () => {
  const api = load({ fstream: { 4: fstreamSeason(4, 3) } });
  // La saison 3 FStream (partie 3, 7 épisodes) prouve la numérotation TVmaze.
  const result = await api.get('96677', 3, fstreamSeason(3, 7));
  assert.deepEqual(api.seasonCalls, [['tv', '96677', '4', null]]);
  assert.deepEqual(Object.keys(result.data.episodes), ['1', '2', '3']);
  assert.equal(url(result.data.episodes[1]), 'https://player.test/s4e1');
});

test('FStream qui suit TMDB : rien ne change et TVmaze n’est pas consulté', async () => {
  const api = load();
  assert.equal(await api.get('96677', 1, fstreamSeason(1, 10)), null);
  assert.deepEqual(api.tvmazeCalls, []);
  assert.deepEqual(api.seasonCalls, []);
});

test('saison partielle, TVmaze inconnu ou même découpage : pas de conversion', async () => {
  // 7 épisodes sur 10 : ni TMDB ni TVmaze, FStream met la saison en ligne.
  assert.equal(await load().get('96677', 1, fstreamSeason(1, 7)), null);
  assert.equal(await load({ tvmaze: null }).get('96677', 1, fstreamSeason(1, 5)), null);
  assert.equal(await load({ tvmaze: TMDB }).get('96677', 1, fstreamSeason(1, 5)), null);
  // Saison FStream introuvable : aucune preuve, la réponse d'origine reste.
  assert.equal(await load().get('96677', 1, { data: null, revalidate: null }), null);
});

test('saisons FStream manquantes : 404 si absentes, échec passager si l’une ne répond pas', async () => {
  const absent = { data: { __fstreamResponse: true, status: 404, body: {} }, revalidate: null };
  const missing = await load({ fstream: { 4: absent } }).get('96677', 3, fstreamSeason(3, 7));
  assert.equal(missing.data.status, 404);
  assert.equal(missing.data.body.code, 'content_not_found');

  const down = await load({ fstream: { 4: new Error('timeout of 8000ms exceeded') } }).get('96677', 3, fstreamSeason(3, 7));
  assert.equal(down.data, null);
});

test('les caches vieillis de chaque saison FStream sont rafraîchis', async () => {
  const revalidated = [];
  const stale = (season, count) => ({ ...fstreamSeason(season, count), revalidate: () => revalidated.push(season) });
  const result = await load({ fstream: { 2: stale(2, 5) } }).get('96677', 1, stale(1, 5));
  result.revalidates.forEach(revalidate => revalidate());
  assert.deepEqual(revalidated.sort(), [1, 2]);
});
