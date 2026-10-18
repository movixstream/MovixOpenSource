'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cheerio = require('cheerio');
const { createFStreamSearchCache } = require('../../utils/fstreamSearchCache');
const { canonicalFStreamUrl } = require('../../config/fstream');
const filename = path.resolve(__dirname, '../fstream.js');
const source = fs.readFileSync(filename, 'utf8');
const fragment = (begin, end) => {
  const start = source.indexOf(begin), stop = source.indexOf(end, start);
  assert.ok(start > 0 && stop > start);
  return source.slice(start, stop);
};

test('les titres courts FStream acceptent les variantes TMDB exactes sans accepter une autre série', () => {
  const context = vm.createContext({});
  vm.runInContext(fragment('function normalizeFStreamBaseTitle(', '// === Search Functions ===')
    + '\nglobalThis.validate = isFStreamCachedSelectionValid;', context, { filename });
  const selection = (tmdb, title, seasonNumber) => ({
    tmdb, search: { bestMatch: { title, originalTitle: title, seasonNumber } },
  });
  const mentalist = { id: 5920, title: 'Mentalist', original_title: 'The Mentalist' };
  const jackal = { id: 222766, title: 'Chacal', name_no_lang: 'The Day of the Jackal' };
  assert.equal(context.validate(selection(mentalist, 'The Mentalist - Saison 6', 6), '6'), true);
  assert.equal(context.validate(selection(jackal, 'The Day of the Jackal (2024) - Saison 1', 1), '1'), true);
  assert.equal(context.validate(selection(mentalist, 'Mentalist - Saison 6', 6), '6'), true);
  assert.equal(context.validate(selection(mentalist, 'The Mentalist - Saison 5', 5), '6'), false);
  assert.equal(context.validate(selection(mentalist, 'The Mentalist Returns - Saison 6', 6), '6'), false);
  assert.equal(context.validate(selection(jackal, 'The Day of the Jackal Returns - Saison 1', 1), '1'), false);
  assert.equal(context.validate(selection({ title: 'FROM', original_title: 'FROM' }, 'From Me to You Kimi ni Todoke - Saison 1', 1), '1'), false);
});

test('les titres FStream échappés « L\\\'Arène » retrouvent leur apostrophe', () => {
  const context = vm.createContext({});
  vm.runInContext(fragment('function repairFStreamSearchHtml(', '// get_seasons.php (ajax')
    + '\nglobalThis.repair = repairFStreamSearchHtml;', context, { filename });
  const item = (path, alt, title) => `<div class='search-item' onclick="location.href='/${path}'"><div class='search-poster'>`
    + `<img src='https://image.tmdb.org/t/p/w500/x.jpg' alt='${alt}' loading='lazy'></div>`
    + `<div class='search-info'><div class='search-title'>${title}</div></div></div>`;
  const html = item('15139977-larne-saison-1-2026.html', "L\\'Arène - Saison 1", "L\\'Arène - Saison 1")
    + item('15130792-bugs-bunny-dans-l-arene.html', "Bugs Bunny dans l'arène", "Bugs Bunny dans l'arène (1955)")
    + item('15131436-arenes-sanglantes.html', 'Arènes sanglantes', 'Arènes sanglantes (1941)');
  const $ = cheerio.load(context.repair(html));
  const rows = $('div.search-item').map((_, node) => ({
    title: $(node).find('.search-title').text().trim(),
    src: $(node).find('img').attr('src'),
  })).get();
  assert.deepEqual(rows.map(row => row.title),
    ["L'Arène - Saison 1", "Bugs Bunny dans l'arène (1955)", 'Arènes sanglantes (1941)']);
  assert.ok(rows.every(row => row.src === 'https://image.tmdb.org/t/p/w500/x.jpg'));
});

test('les recherches FStream se mutualisent en préservant la variante AJAX sans pagination', async () => {
  let calls = 0;
  const html = '<div class="search-item" onclick="location.href=\'/42-serie-test.html\'"><div class="search-title">Serie Test - Saison 1</div></div>';
  const context = vm.createContext({
    searchCache: createFStreamSearchCache(), FSTREAM_BASE_URL: 'https://source.test',
    FSTREAM_SEARCH_URL: 'https://source.test/engine/ajax/search.php', URLSearchParams, cheerio,
    axiosFStreamRequest: async config => {
      calls++;
      assert.equal(config.data.get('query'), 'Serie Test');
      if (config.data.get('page') === null) {
        assert.equal(config.headers['X-Requested-With'], 'XMLHttpRequest');
        assert.equal(config.timeout, 6000);
      } else {
        assert.equal(config.data.get('page'), '1');
        assert.equal(config.headers['X-Requested-With'], undefined);
      }
      await new Promise(resolve => setImmediate(resolve));
      return { status: 200, data: html };
    },
    console,
  });
  vm.runInContext(fragment('async function searchFStream(', '// get_seasons.php (ajax')
    + '\nglobalThis.api = { searchFStream, searchFStreamDirect, fetchFStreamSeasonSearchResults };', context, { filename });
  const result = await Promise.all([
    context.api.searchFStream('Serie Test'),
    context.api.searchFStreamDirect('Serie Test'),
    context.api.fetchFStreamSeasonSearchResults(42, 'Serie Test'),
    context.api.fetchFStreamSeasonSearchResults(42, 'Serie Test'),
  ]);
  assert.equal(calls, 2);
  assert.equal(result[0], html);
  assert.equal(result[1], html);
  assert.equal(result[2][0].seasonNumber, 1);
  assert.equal(result[2][0].link, 'https://source.test/42-serie-test.html');
  assert.equal(result[3][0].seasonNumber, 1);
});

test('les données statiques gardent leur version pendant 30 secondes puis voient les nouveaux épisodes', async () => {
  let time = 10_000;
  const urls = [];
  const context = vm.createContext({
    Date: { now: () => time },
    canonicalFStreamUrl,
    extractPageIdFromUrl: () => '42', extractBaseUrlFromLink: () => 'https://source.test',
    getShuffledAllProxies: () => [{ type: 'socks5' }],
    withFStreamProxy: (_entry, request) => request({}),
    buildFStreamCookieHeader: () => '', parseEpisodesPayload: value => value,
    axios: async config => { urls.push(config.url); return { status: 200, data: { episodes: time >= 30_000 ? [1, 2] : [1] } }; },
    console,
  });
  vm.runInContext(fragment('async function fetchEpisodesFromStaticJs(', 'async function fetchEpisodesFromApi(')
    + '\nglobalThis.request = fetchEpisodesFromStaticJs;', context, { filename });
  await context.request('https://source.test/42-serie.html');
  time = 29_999;
  await context.request('https://source.test/42-serie.html');
  time = 30_000;
  const result = await context.request('https://source.test/42-serie.html');
  assert.equal(urls[0], 'https://source.test/static/series/42.js?v=0');
  assert.equal(urls[0], urls[1]);
  assert.equal(urls[2], 'https://source.test/static/series/42.js?v=1');
  assert.deepEqual(result.episodes, [1, 2]);
});
