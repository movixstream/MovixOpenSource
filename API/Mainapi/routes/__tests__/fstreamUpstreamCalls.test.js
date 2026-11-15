'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cheerio = require('cheerio');
const { canonicalFStreamUrl, FSTREAM_BASE_URL } = require('../../config/fstream');
const { baseTitle, yearOf, titleSimilarity } = require('../../utils/sourceIdentity');

const filename = path.resolve(__dirname, '../fstream.js');
const source = fs.readFileSync(filename, 'utf8');
const fragment = (begin, end) => {
  const start = source.indexOf(begin), stop = source.indexOf(end, start);
  assert.ok(start > 0 && stop > start, `${begin} … ${end}`);
  return source.slice(start, stop);
};
const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });
const timeout = () => Object.assign(new Error('timeout of 8000ms exceeded'), { code: 'ECONNABORTED' });
const PROXIES = [{ type: 'socks5' }, { type: 'socks5' }, { type: 'darkino' }];

function load(code, exportsList, context) {
  const sandbox = vm.createContext({
    canonicalFStreamUrl, URL, cheerio, FSTREAM_BASE_URL, console: { error() {}, log() {}, warn() {} },
    refreshStep: () => {}, buildFStreamCookieHeader: () => '', sendPastFStreamChallenge: send => send(),
    getShuffledAllProxies: () => PROXIES, withFStreamProxy: (_entry, request) => request({}),
    ...context,
  });
  vm.runInContext(`${code}\nglobalThis.api = { ${exportsList.join(', ')} };`, sandbox, { filename });
  return sandbox.api;
}

test('get_seasons : 404 définitif après un seul appel, échec de tous les proxys signalé par null', async () => {
  const calls = [];
  let answer;
  const { fetchFStreamSeasonsAjax } = load(fragment('async function fetchFStreamSeasonsAjax(', '// === Scraping Functions ==='),
    ['fetchFStreamSeasonsAjax'], { axios: async config => { calls.push(config.url); return answer(); } });

  answer = () => { throw httpError(404); };
  const none = await fetchFStreamSeasonsAjax(9, 5, FSTREAM_BASE_URL);
  assert.ok(Array.isArray(none) && none.length === 0, '404 : aucune autre saison, réponse définitive');
  assert.equal(calls.length, 1, 'un 404 n’est pas redemandé aux autres proxys');

  calls.length = 0;
  answer = () => { throw timeout(); };
  assert.equal(await fetchFStreamSeasonsAjax(9, 5, FSTREAM_BASE_URL), null, 'échec passager : null, pas une liste vide');
  assert.equal(calls.length, 3);

  answer = () => ({ status: 200, data: [{ title: 'Serie X - Saison 2', full_url: '/7-serie-x-saison-2.html' }] });
  const [season] = await fetchFStreamSeasonsAjax(9, 5, FSTREAM_BASE_URL);
  assert.equal(season.seasonNumber, 2);
});

function playerFunctions({ api, page }) {
  const calls = [];
  const functions = load(fragment('async function fetchEpisodesFromStaticJs(', '// === Filtering ==='),
    ['getMoviePlayersForUrl', 'getSeriesPlayersForUrl'], {
      Date,
      extractPageIdFromUrl: url => url.match(/\/(\d+)-[^/]+\.html/)?.[1] || null,
      extractBaseUrlFromLink: () => FSTREAM_BASE_URL,
      parseEpisodesPayload: value => value,
      axios: async config => { calls.push(new URL(config.url).pathname); return api(config.url); },
      axiosFStreamRequest: async config => { calls.push(`page ${new URL(config.url).pathname}`); return { status: 200, data: page }; },
    });
  return { ...functions, calls, count: name => calls.filter(call => call.includes(name)).length };
}

test('film : un 404 de film_api n’est demandé qu’une fois, et le repli HTML ne le redemande pas', async () => {
  const page = '<div id="film-data" data-premium="https://player.invalid/1" data-vidzyvostfr="https://vidzy.invalid/1"></div>';
  for (const [failure, expected] of [[() => { throw httpError(404); }, 1], [() => { throw timeout(); }, 3]]) {
    const f = playerFunctions({ api: failure, page });
    const result = await f.getMoviePlayersForUrl(`${FSTREAM_BASE_URL}/12-film.html`);
    assert.equal(result.total, 2, 'les lecteurs viennent du HTML');
    assert.equal(f.count('film_api.php'), expected, `film_api : ${expected} appel(s), aucun après le repli HTML`);
    assert.equal(f.count('page /12-film.html'), 1);
  }
});

test('film_api : la page anti-robot donne sa nouvelle valeur de fsschal et la requête repart une fois', async () => {
  const challenge = '<!doctype html><title>Verification...</title><script>function sc(){'
    + 'document.cookie="fsschal=n3wv4lue; path=/; max-age=86400";}</script>';
  const cookies = [];
  let blocked = false;
  // Vrais fstreamCookies, buildFStreamCookieHeader et sendPastFStreamChallenge.
  const { fetchMoviePlayersFromApi, fstreamCookies } = load(
    fragment('const fstreamCookies = {', 'let fstreamRequestCounter')
      + fragment('async function fetchMoviePlayersFromApi(', '// === High-level wrappers'),
    ['fetchMoviePlayersFromApi', 'fstreamCookies'], {
      process: { env: {} }, adoptFStreamChallengeCookie: require('../../utils/fstreamChallenge').adoptFStreamChallengeCookie,
      extractPageIdFromUrl: () => '12', extractBaseUrlFromLink: () => FSTREAM_BASE_URL,
      axios: async config => {
        cookies.push(config.headers.Cookie);
        return !blocked && config.headers.Cookie.includes('fsschal=n3wv4lue')
          ? { status: 200, data: { players: { vidzy: { vff: 'https://vidzy.invalid/1' } } } }
          : { status: 200, data: challenge };
      },
    });

  const players = await fetchMoviePlayersFromApi(`${FSTREAM_BASE_URL}/12-film.html`);
  assert.deepEqual(Array.from(players, player => player.url), ['https://vidzy.invalid/1']);
  assert.equal(cookies.length, 2, 'un seul renvoi');
  assert.doesNotMatch(cookies[0], /fsschal=n3wv4lue/);
  assert.match(cookies[1], /fsschal=n3wv4lue/);
  assert.equal(fstreamCookies.fsschal, 'n3wv4lue', 'la valeur sert aux requêtes suivantes');

  // Challenge toujours là avec la bonne valeur : pas de boucle, échec normal.
  cookies.length = 0;
  blocked = true;
  assert.equal(await fetchMoviePlayersFromApi(`${FSTREAM_BASE_URL}/12-film.html`), null);
  assert.equal(cookies.length, 3, 'un appel par proxy, sans renvoi');
});

test('série : fichier statique et episodes_p en 404 une fois chacun, pas de nouvel appel après le repli HTML', async () => {
  const page = '<div id="episodes-vf-data"><div data-ep="1" data-vidzy="https://vidzy.invalid/e1"></div></div>';
  const f = playerFunctions({ api: () => { throw httpError(404); }, page });
  const result = await f.getSeriesPlayersForUrl(`${FSTREAM_BASE_URL}/34-serie-x-saison-1.html`);
  assert.equal(result.total, 1);
  assert.equal(f.count('/static/series/'), 1);
  assert.equal(f.count('episodes_p.php'), 1);
  assert.equal(f.count('page /34-serie-x-saison-1.html'), 1);
});

test('série absente de la recherche : get_seasons en échec donne une erreur passagère, jamais un « absent »', async () => {
  let seasons;
  const { findValidatedFStream } = load(fragment('// === Filtering ===', 'async function loadFStreamContent('),
    ['findValidatedFStream'], {
      baseTitle, yearOf, titleSimilarity, repairFStreamSearchHtml: html => html,
      TMDB_API_URL: '', TMDB_API_KEY: '', Date,
      createIdentityVerifier: ({ details }) => ({
        titles: [details.title], aliases: async () => [details.title],
        verify: async () => ({ accepted: false, reason: 'identity_unconfirmed' }),
      }),
      searchTitles: titles => titles,
      // Seule la saison 1 sort dans la recherche : la saison 2 passe par get_seasons.
      searchFStreamDirect: async () => '<div class="search-item" onclick="location.href=\'/5-serie-x-saison-1.html\'">'
        + '<div class="search-title">Serie X - Saison 1</div></div>',
      extractPageIdFromUrl: url => url.match(/\/(\d+)-/)?.[1] || null,
      fetchFStreamSeasonsAjax: async () => seasons,
      findSeriesInRecentFStream: async () => null,
    });
  const tmdb = { id: 9, title: 'Serie X', release_date: '2001-01-01' };
  const seasonData = { air_date: '2003-01-01' };

  seasons = null;
  await assert.rejects(findValidatedFStream(tmdb, 'tv', '2', seasonData), error => error.code === 'UPSTREAM_UNAVAILABLE');

  seasons = [];
  const found = await findValidatedFStream(tmdb, 'tv', '2', seasonData);
  assert.equal(found.failureCode, 'content_not_found', 'une réponse get_seasons vide reste un vrai « absent »');
});

test('les helpers FStream tirent leurs proxys du groupe stable partagé avec axiosFStreamRequest', () => {
  assert.match(source, /function getShuffledAllProxies\(\) \{\s*return fstreamProxyPicker\.candidates\(3\);/);
  assert.match(source, /axiosHelpers\.configure\(\{[^}]*fstreamProxyPicker,/);
});
