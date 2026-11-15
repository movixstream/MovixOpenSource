const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cheerio = require('cheerio');

const filename = path.join(__dirname, '../frenchstream.js');
const source = fs.readFileSync(filename, 'utf8');

// `page` répond aux GET (page du lecteur), `api` aux POST /api/embed-links.
function harness({ page, api } = {}) {
  const requests = [];
  const module = { exports: {} };
  const reply = async (handler, url, body) => {
    const value = typeof handler === 'function' ? await handler(url, body) : handler;
    return { data: value };
  };
  vm.runInNewContext(source, {
    module, URL, console,
    require(name) {
      if (name === 'cheerio') return cheerio;
      if (name === 'axios') return {
        get: async (url, options) => { requests.push({ method: 'GET', url, options }); return reply(page, url); },
        post: async (url, body, options) => { requests.push({ method: 'POST', url, body, options }); return reply(api, url, body); },
      };
      throw new Error(`Dépendance inattendue : ${name}`);
    },
  }, { filename });
  return { api: module.exports, requests };
}

const playerPage = (type, id, token = 'bW92aWV8dHQx.abc123') => `<!doctype html><body class="embed-body">
  <div class="_player"></div>
  <script>fetch('/api/embed-links', { method: 'POST',
    body: JSON.stringify({ type: '${type}', id: "${id}", token: "${token}" }) });</script></body>`;
const missingPage = '<!doctype html><body class="embed-body"><div class="_player"></div></body>';

const movieSources = {
  ok: true,
  type: 'movie',
  sources: [
    { id: 'doodstream-com-6', name: 'doodstream.com', url: 'https://doodstream.com/e/abc', rank: 2 },
    { id: 'dropload-io-15', name: 'dropload.io', url: 'https://dr0pstream.com/e/xyz', rank: 1 },
    { id: 'doublon', name: 'dropload.io', url: 'https://dr0pstream.com/e/xyz', rank: 3 },
    { id: 'interne', name: 'frvideosrc', url: 'https://frvideosrc.co/film/1', rank: 4 },
    { id: 'invalide', name: 'x', url: 'javascript:void(0)', rank: 5 },
    { id: 'vide', name: 'y', url: '', rank: 6 },
  ],
};

test('les films lisent le jeton de /film puis demandent les lecteurs à /api/embed-links', async () => {
  for (const [id, expected] of [['tt27419466', '27419466'], ['27419466', '27419466'], ['tt0137523', '0137523']]) {
    const h = harness({ page: playerPage('movie', `tt${expected}`, 'tok.en-1_2'), api: movieSources });
    const result = await h.api.getFrenchStreamMovie(id);
    assert.equal(h.requests.length, 2);
    const [page, api] = h.requests;
    assert.equal(page.url, `https://frvideosrc.co/film/${expected}`);
    assert.equal(page.options.timeout, 15000);
    assert.equal(api.url, 'https://frvideosrc.co/api/embed-links');
    assert.deepEqual({ ...api.body }, { type: 'movie', id: `tt${expected}`, token: 'tok.en-1_2' });
    assert.equal(api.options.headers.Origin, 'https://frvideosrc.co');
    assert.equal(api.options.headers.Referer, page.url);
    assert.equal(result.iframe_src, page.url);
    assert.deepEqual(JSON.parse(JSON.stringify(result.player_links)), [
      { player: 'Dropload', link: 'https://dr0pstream.com/e/xyz', is_hd: false },
      { player: 'Doodstream', link: 'https://doodstream.com/e/abc', is_hd: false },
    ]);
  }
});

const tvSources = {
  ok: true,
  type: 'tv',
  tv: {
    title: 'All American',
    seasons: [
      { season_number: 2, episodes: [
        { episode_number: 1, title: '', sources: [{ name: 'dropload.io', url: 'https://video.example/s2e1', rank: 1 }] },
      ] },
      { season_number: 1, episodes: [
        { episode_number: 2, title: 'Le retour', sources: [{ name: 'dropload.io', url: 'https://video.example/s1e2', rank: 1 }] },
        { episode_number: 1, title: '', sources: [
          { name: 'mixdrop.co', url: 'https://mirror.example/s1e1', rank: 2 },
          { name: 'dropload.io', url: 'https://video.example/s1e1', rank: 1 },
        ] },
        { episode_number: 3, title: 'VOSTFR', sources: [{ name: 'dropload.io', url: 'https://original.example/s1e3', rank: 1 }] },
        { episode_number: 4, title: '', sources: [] },
      ] },
    ],
  },
};

test('les séries utilisent /serial et gardent les saisons, épisodes et versions attendus par Omega', async () => {
  const h = harness({ page: playerPage('tv', 'tt7414406'), api: tvSources });
  let metadataCalls = 0;
  h.api.configure({ findTvSeriesOnTMDB: async title => {
    metadataCalls++;
    assert.equal(title, 'All American');
    return { id: 82428, name: title };
  } });
  const result = await h.api.getFrenchStreamSeries('tt7414406');
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[0].url, 'https://frvideosrc.co/serial/7414406');
  assert.equal(h.requests[1].body.type, 'tv');
  assert.equal(metadataCalls, 1);
  const data = JSON.parse(JSON.stringify(h.api.cleanTvCacheData({ type: 'tv', series: result })));
  assert.equal(data.type, 'tv');
  assert.equal(data.series.length, 1);
  const series = data.series[0];
  assert.equal(series.title, 'All American');
  assert.equal(series.episode_count, 4);
  assert.equal(series.audio_type, 'VF / VOSTFR');
  assert.equal(series.tmdb_data.id, 82428);
  assert.deepEqual(series.seasons.map(season => season.number), [1, 2]);
  assert.deepEqual(series.seasons[0].episodes.map(episode => episode.number), ['1', '2', '3']);
  const first = series.seasons[0].episodes[0];
  assert.equal(first.versions.vf.title, 'Épisode 1');
  assert.deepEqual(first.versions.vf.players, [
    { name: 'video.example', link: 'https://video.example/s1e1' },
    { name: 'mirror.example', link: 'https://mirror.example/s1e1' },
  ]);
  assert.equal(series.seasons[0].episodes[1].versions.vf.title, 'Le retour');
  assert.equal(series.seasons[0].episodes[2].versions.vostfr.players[0].link, 'https://original.example/s1e3');
  assert.equal(series.seasons[1].episodes[0].versions.vf.players[0].link, 'https://video.example/s2e1');
});

test('un ancien lien frenchcloud.cam en cache est relu sur FrVideoSRC', async () => {
  const h = harness({ page: playerPage('tv', 'tt7414406'), api: tvSources });
  const details = await h.api.getFrenchStreamSeriesDetails('https://frenchcloud.cam/serial/7414406', 'All American');
  assert.equal(h.requests[0].url, 'https://frvideosrc.co/serial/7414406');
  assert.equal(details.seasons.length, 2);
});

test('les identifiants invalides ne déclenchent aucune requête amont', async () => {
  const h = harness({ page: playerPage('movie', 'tt1'), api: movieSources });
  for (const id of ['tt', '../27419466', 'tt27419466?other=1', null]) {
    assert.match((await h.api.getFrenchStreamMovie(id)).error, /Identifiant IMDb invalide/);
    assert.match((await h.api.getFrenchStreamSeries(id)).error, /Identifiant IMDb invalide/);
  }
  assert.equal(h.requests.length, 0);
});

test('un titre absent de FrVideoSRC reste distinct des erreurs temporaires et des pages inattendues', async () => {
  const absent = harness({ page: missingPage });
  assert.equal((await absent.api.getFrenchStreamMovie('tt27419466')).error, 'Movie not found on FrenchCloud');
  assert.match((await absent.api.getFrenchStreamSeries('tt7414406')).error, /404/);
  assert.equal(absent.requests.filter(request => request.method === 'POST').length, 0);
  const missing = harness({ page: () => { throw Object.assign(new Error('Not found'), { response: { status: 404 } }); } });
  assert.equal((await missing.api.getFrenchStreamMovie('tt27419466')).error, 'Movie not found on FrenchCloud');
  assert.match((await missing.api.getFrenchStreamSeries('tt7414406')).error, /404/);
  const failure = harness({ page: () => { throw new Error('timeout'); } });
  assert.match((await failure.api.getFrenchStreamMovie('tt27419466')).error, /timeout/);
  assert.match((await failure.api.getFrenchStreamSeries('tt7414406')).error, /timeout/);
  const unexpected = harness({ page: '<html><title>Service unavailable</title></html>' });
  assert.match((await unexpected.api.getFrenchStreamMovie('tt27419466')).error, /Page FrVideoSRC invalide/);
  assert.match((await unexpected.api.getFrenchStreamSeries('tt7414406')).error, /Page FrVideoSRC invalide/);
  const refused = harness({ page: playerPage('movie', 'tt27419466'), api: { ok: false, error: 'bad_token' } });
  assert.match((await refused.api.getFrenchStreamMovie('tt27419466')).error, /Réponse FrVideoSRC invalide \(bad_token\)/);
});

test('une série sans lien ne devient pas disponible à cause de ses épisodes vides', async () => {
  const h = harness({ page: playerPage('tv', 'tt7414406'), api: { ok: true, tv: { title: 'X', seasons: [
    { season_number: 1, episodes: [{ episode_number: 1, sources: [] }] },
  ] } } });
  assert.equal((await h.api.getFrenchStreamSeries('7414406')).length, 0);
  assert.equal(h.requests[0].url, 'https://frvideosrc.co/serial/7414406');
});
