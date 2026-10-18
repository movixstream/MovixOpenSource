import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const load = (globals = {}) => {
  const js = ts.transpileModule(readFileSync('src/utils/tvmazeEpisodes.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', ...Object.keys(globals), js)(
    require, mod, mod.exports, ...Object.values(globals),
  );
  return mod.exports;
};
const episodes = (season, count) => Array.from({ length: count }, (_, i) => ({
  id: season * 100 + i + 1, season, number: i + 1, name: `E${i + 1}`,
  airdate: '2026-10-02', runtime: 15, image: null, summary: '',
}));

test('Coven Academy : 21 chapitres TVmaze face à 10 épisodes TMDB', () => {
  const { isTvmazeListCompatible, groupTvmazeSeasons } = load();
  const list = episodes(1, 21);
  assert.equal(isTvmazeListCompatible({ 0: 2, 1: 10 }, list), true);
  const seasons = groupTvmazeSeasons(list);
  assert.equal(seasons[1].length, 21);
  assert.equal(seasons[1][14].episode_number, 15);
  assert.equal(seasons[1][14].still_path, null);
});

test('TMDB est gardé quand TVmaze n’apporte rien ou découpe autrement', () => {
  const { isTvmazeListCompatible } = load();
  // Même nombre d'épisodes : rien à gagner.
  assert.equal(isTvmazeListCompatible({ 1: 10 }, episodes(1, 10)), false);
  // Anime en numérotation absolue : une saison TVmaze contre trois TMDB.
  assert.equal(isTvmazeListCompatible({ 1: 24, 2: 24, 3: 24 }, episodes(1, 72)), false);
  // Une saison TVmaze plus courte : découpage incompatible.
  assert.equal(isTvmazeListCompatible({ 1: 10, 2: 10 }, [...episodes(1, 21), ...episodes(2, 8)]), false);
  // Saison annoncée sur TVmaze seulement.
  assert.equal(isTvmazeListCompatible({ 1: 10 }, [...episodes(1, 21), ...episodes(2, 3)]), false);
  assert.equal(isTvmazeListCompatible({ 1: 10 }, []), false);
});

test('sans filtre : toujours TVmaze quand il connaît la série', () => {
  const { shouldUseTvmazeList } = load();
  const absolute = episodes(1, 72);
  const tmdb = { 1: 24, 2: 24, 3: 24 };
  assert.equal(shouldUseTvmazeList('tvmaze', tmdb, absolute), false);
  assert.equal(shouldUseTvmazeList('tvmaze_all', tmdb, absolute), true);
  assert.equal(shouldUseTvmazeList('tmdb', { 1: 10 }, episodes(1, 21)), false);
  assert.equal(shouldUseTvmazeList('tvmaze_all', { 1: 10 }, episodes(1, 10)), true);
  // TVmaze ne connaît pas la série : TMDB reste la seule liste.
  assert.equal(shouldUseTvmazeList('tvmaze_all', { 1: 10 }, []), false);
});

test('choix global TVmaze par défaut, exception par série', () => {
  const store = new Map();
  const window = {
    localStorage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value),
      removeItem: (key) => store.delete(key),
    },
    dispatchEvent: () => true,
  };
  const api = load({ window, CustomEvent: class { constructor(type) { this.type = type; } } });
  assert.equal(api.getEpisodeListSource(298505), 'tvmaze');
  api.setEpisodeListSource(298505, 'tmdb');
  assert.equal(api.getEpisodeListSource(298505), 'tmdb');
  assert.equal(api.getEpisodeListSource(1), 'tvmaze');
  // Revenir au choix global supprime l'exception.
  api.setEpisodeListSource(298505, null);
  assert.equal(store.has('settings_episode_list_source_tv_298505'), false);
  api.setDefaultEpisodeListSource('tmdb');
  assert.equal(api.getEpisodeListSource(1), 'tmdb');
});

test('La Casa de Papel : découpage Netflix d’office, TVmaze et TMDB au choix', () => {
  const store = new Map();
  const window = {
    localStorage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value),
      removeItem: (key) => store.delete(key),
    },
    dispatchEvent: () => true,
  };
  const api = load({ window, CustomEvent: class { constructor(type) { this.type = type; } } });
  const lists = {
    tmdbCounts: { 0: 22, 1: 15, 2: 16, 3: 10 },
    tvmaze: [...episodes(1, 15), ...episodes(3, 8), ...episodes(4, 8), ...episodes(5, 10)],
    netflix: [...episodes(1, 13), ...episodes(2, 9), ...episodes(3, 8), ...episodes(4, 8), ...episodes(5, 10)],
    onNetflix: true,
  };
  assert.equal(api.getShowEpisodeList(71446, lists), 'netflix');
  // Pas une série Netflix : la liste Netflix ne s'impose pas.
  assert.equal(api.getShowEpisodeList(71446, { ...lists, onNetflix: false }), 'tmdb');

  api.setEpisodeListSource(71446, api.episodeListChoice('tvmaze', lists));
  assert.equal(api.getShowEpisodeList(71446, lists), 'tvmaze');
  api.setEpisodeListSource(71446, api.episodeListChoice('tmdb', lists));
  assert.equal(api.getShowEpisodeList(71446, lists), 'tmdb');
  api.setEpisodeListSource(71446, api.episodeListChoice('netflix', lists));
  assert.equal(store.has('settings_episode_list_source_tv_71446'), false);

  // Choix global « sans filtre » : choisir TVmaze sur une série Netflix reste enregistré.
  api.setDefaultEpisodeListSource('tvmaze_all');
  api.setEpisodeListSource(71446, api.episodeListChoice('tvmaze', lists));
  assert.equal(api.getShowEpisodeList(71446, lists), 'tvmaze');

  // Choix global TMDB : pas de Netflix d'office, mais toujours possible à la main.
  store.clear();
  api.setDefaultEpisodeListSource('tmdb');
  assert.equal(api.getShowEpisodeList(71446, lists), 'tmdb');
  api.setEpisodeListSource(71446, api.episodeListChoice('netflix', lists));
  assert.equal(api.getShowEpisodeList(71446, lists), 'netflix');
});
