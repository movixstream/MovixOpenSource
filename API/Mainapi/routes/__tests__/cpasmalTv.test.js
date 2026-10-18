const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cheerio = require('cheerio');
const { createSourceRefresh } = require('../../utils/sourceRefresh');

const base = 'https://cpasmal.test';
const seriesUrl = `${base}/1417-chicago-fire.html`;
const episodeUrl = `${base}/1417-chicago-fire/14-saison/5-episode.html`;
// Fragments du balisage Cpasmal constaté le 20 septembre 2026, sans jetons de page.
const searchHtml = `<div class="thumb">
  <a class="th-img" href="${seriesUrl}"><span class="th-Serie">Serie</span></a>
  <div class="th-desc"><a class="th-capt">Chicago Fire</a><div class="th-year">2012</div></div>
</div>`;
const season = number => `<a href="${base}/1417-chicago-fire/${number}-saison.html">
  <div class="th-seas"><div class="th-count">saison ${number}</div></div>
</a>`;
const seriesHtml = `<article><ul><li><span class="info">Date de sortie :</span>
  <span class="infos">2012</span></li></ul></article>${season(14)}`;
const episodeHtml = `<div class="liens-c">
  <div class="lien" onclick="getxfield(this, '136435', 'voe_vf', 'serial'); return false;">voe</div>
  <div class="lien" onclick='getxfield ( this, "136435", "uqload_vostfr", "serial", event )'>uqload</div>
  <div class="lien" onclick="getxfield(this, '136435', 'voe_vf', 'serial'); return false;">voe</div>
</div><script>function getxfield() { turnstile.render('#xf_lock', {}); }</script>`;

function harness({ cached = null, request, tmdb = { name: 'Chicago Fire', first_air_date: '2012-10-10' }, stale = false, alternativeTitles = [] } = {}) {
  const cache = new Map();
  const writes = [];
  const requests = [];
  const logs = [];
  const routes = new Map();
  const router = { get: (route, handler) => routes.set(route, handler) };
  const module = { exports: {} };
  const stubs = {
    express: { Router: () => router }, cheerio, path, axios: {},
    'write-file-atomic': async (_file, json) => writes.push(JSON.parse(json)),
    fs: { promises: {
      writeFile: async (_file, json) => writes.push(JSON.parse(json)),
      stat: async () => ({ mtime: new Date() }), utimes: async () => {},
    } },
    '../utils/cacheManager': { CACHE_DIR: { CPASMAL: '/fixture/cpasmal' }, generateCacheKey: value => value },
    '../config/redis': { memoryCache: { set: async (key, value) => { cache.set(key.split(':').at(-1), value); } } },
    '../utils/embedExtraction': { respondWithResolvedSources: async (_req, res, data) => res.json(data) },
    '../utils/tmdbCache': { fetchTmdbDetails: async () => tmdb,
      fetchTmdbAlternativeTitles: async () => ({ titles: alternativeTitles }) },
    '../utils/sourceIdentity': require('../../utils/sourceIdentity'),
    '../utils/redisLock': { acquireRedisLock: async () => ({ release: async () => {} }) },
    '../utils/sourceRefresh': { createSourceRefresh },
    '../utils/sharedSourceWork': require('../../utils/sharedSourceWork'),
    '../utils/concurrency': require('../../utils/concurrency'),
    '../utils/sourceRefreshTelemetry': { reportRefreshFailure() {} },
  };
  const filename = path.resolve(__dirname, '../cpasmal.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, URL, URLSearchParams, Date,
    process: { env: {} }, console: { log: message => logs.push(message), warn() {} },
    require(name) {
      assert.ok(Object.hasOwn(stubs, name), `Dépendance inattendue : ${name}`);
      return stubs[name];
    },
  }, { filename });
  // Exécuter le branchement de production : une injection manuelle masquerait
  // un client HTTP manquant dans app.js, même si l'extracteur fonctionne seul.
  const appFilename = path.resolve(__dirname, '../../app.js');
  const appSource = fs.readFileSync(appFilename, 'utf8');
  const configuration = appSource.match(/cpasmalRouter\.configure\(\{[\s\S]*?\}\);/)?.[0];
  assert.ok(configuration, 'configuration Cpasmal de Main API présente');
  vm.runInNewContext(configuration, {
    cpasmalRouter: router,
    CPASMAL_BASE_URL: base,
    TMDB_API_URL: 'https://tmdb.test/3',
    TMDB_API_KEY: 'fixture',
    getFromCacheNoExpiration: async (_dir, key) => cache.get(key) ?? cached,
    shouldUpdateCache: async () => stale,
    require(name) {
      assert.equal(name, './utils/proxyManager');
      return {
        makeCpasmalRequest: async (url, options) => {
          requests.push({ url, options });
          return request(url, options);
        },
      };
    },
  }, { filename: appFilename });
  return {
    writes, requests, logs,
    async call(seasonNumber = '14', episodeNumber = '5') {
      const res = {
        statusCode: 200,
        setHeader() {},
        status(code) { this.statusCode = code; return this; },
        json(data) { this.body = JSON.parse(JSON.stringify(data)); return this; },
      };
      await routes.get('/tv/:tmdbid/:season/:episode')({
        params: { tmdbid: '44006', season: seasonNumber, episode: episodeNumber }, query: {},
      }, res);
      return res;
    },
    async callMovie(tmdbid = '1229906') {
      const res = {
        statusCode: 200,
        setHeader() {},
        status(code) { this.statusCode = code; return this; },
        json(data) { this.body = JSON.parse(JSON.stringify(data)); return this; },
      };
      await routes.get('/movie/:tmdbid')({ params: { tmdbid }, query: {} }, res);
      return res;
    },
    async retrieve(seasonNumber, episodeNumber) {
      assert.equal((await this.call(seasonNumber, episodeNumber)).statusCode, 202);
      for (let i = 0; i < 20; i++) {
        await new Promise(setImmediate);
        const res = await this.call(seasonNumber, episodeNumber);
        if (res.statusCode !== 202) return res;
      }
      assert.fail('La récupération simulée doit finir et être lisible au prochain appel');
    },
  };
}

test('Chicago Fire S14E05 : le vieux faux 404 est remplacé par les lecteurs VF et VOSTFR sans captcha', async () => {
  const h = harness({
    cached: { notFound: true, tmdbId: '44006', season: '14', episode: '5' },
    request: async (url, options) => {
      if (url === `${base}/index.php`) return { status: 200, data: searchHtml };
      if (url === seriesUrl) return { status: 200, data: seriesHtml };
      if (url === episodeUrl) return { status: 200, data: episodeHtml };
      const xfield = url.endsWith('/voe_vf') ? 'voe_vf' : 'uqload_vostfr';
      assert.equal(url, `${base}/episode/136435/${xfield}`);
      assert.equal(options.method, 'post');
      assert.equal(options.disableRedirect, true);
      assert.equal(options.headers.Referer, url);
      assert.deepEqual(Object.fromEntries(new URLSearchParams(options.body)), { episode_id: '136435', xfield, range: '100' });
      return { status: 302, headers: { Location: `https://player.test/${xfield}` }, data: '' };
    },
  });
  const first = await h.retrieve();
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.body.links, {
    vf: [{ server: 'voe', url: 'https://player.test/voe_vf' }],
    vostfr: [{ server: 'uqload', url: 'https://player.test/uqload_vostfr' }],
  });
  assert.equal(h.writes.length, 1);
  assert.equal(h.requests.filter(r => r.url.includes('/episode/136435/')).length, 2);
  const requestCount = h.requests.length;
  assert.deepEqual((await h.call()).body.links, first.body.links);
  assert.equal(h.requests.length, requestCount, 'les lecteurs sont servis depuis le cache corrigé');
});

test('un refus HTTP pendant la recherche ne devient pas un résultat introuvable en cache', async () => {
  const h = harness({ request: async () => ({ status: 403, data: '<html>Cloudflare challenge</html>',
    cpasmalProxy: 'socks5h://proxy.test:1080', cpasmalUrl: `${base}/index.php` }) });
  assert.equal((await h.retrieve()).statusCode, 503);
  assert.equal((await h.call()).statusCode, 503);
  assert.equal(h.writes.length, 0);
  assert.equal(h.requests.length, 1);
  assert.ok(h.logs.some(line => line.includes(`proxy=socks5h://proxy.test:1080 | url=${base}/index.php`)));
});

test('un échec de la dernière recherche ne devient pas un résultat introuvable en cache', async () => {
  const h = harness({ request: async (_url, options) => ({
    status: new URLSearchParams(options.body).get('full_search') === '1' ? 503 : 200,
    data: '<div class="search-page">Aucun résultat</div>',
  }) });
  assert.equal((await h.retrieve()).statusCode, 503);
  assert.equal(h.writes.length, 0);
});

test('la saison 1 ne sélectionne pas la saison 10 et les anciens lecteurs restent extraits', async () => {
  const h = harness({ request: async (url, options) => {
    if (url === `${base}/index.php`) return { status: 200, data: searchHtml };
    if (url === seriesUrl) return { status: 200, data: season(1) + season(14) + season(10) };
    if (url.endsWith('/Season.php')) {
      assert.equal(new URLSearchParams(options.body).get('id'), 'episode-1-5');
      return { status: 200, data: '<iframe src="https://player.test/episode-1-5"></iframe>' };
    }
    assert.equal(url, `${base}/1417-chicago-fire/1-saison/5-episode.html`);
    return { status: 200, data: `<div class="liens-c"><div class="lien"
      onclick="playEpisode(this, 'episode-1-5', 'voe_vf')"></div></div>` };
  } });
  const res = await h.retrieve('1');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.links.vf, [{ server: 'voe', url: 'https://player.test/episode-1-5' }]);
});

test('une recherche réellement vide reste un 404 mis en cache et réutilisé', async () => {
  const h = harness({ request: async () => ({ status: 200, data: '<div class="search-page">Aucun résultat</div>' }) });
  assert.equal((await h.retrieve()).statusCode, 404);
  assert.equal(h.writes.length, 1);
  const requestCount = h.requests.length;
  assert.equal((await h.call()).statusCode, 404);
  assert.equal(h.requests.length, requestCount);
});

test('une fausse redirection ou une page catalogue ne deviennent pas des lecteurs en cache', async () => {
  for (const response of [
    { status: 302, headers: {} },
    { status: 302, headers: { location: 'javascript:alert(1)' } },
    { status: 302, headers: { location: `${base}/` } },
    { status: 302, headers: { location: '/catalogue' } },
    { status: 200, headers: { location: 'https://player.test/voe_vf' }, data: '<html>Catalogue</html>' },
  ]) {
    const h = harness({ request: async url => {
      if (url === `${base}/index.php`) return { status: 200, data: searchHtml };
      if (url === seriesUrl) return { status: 200, data: seriesHtml };
      if (url === episodeUrl) return { status: 200, data: episodeHtml };
      return response;
    } });
    assert.equal((await h.retrieve()).statusCode, 503);
    assert.equal((await h.call()).statusCode, 503);
    assert.equal(h.writes.length, 0);
  }
});

test('Nord et Sud 1985 ne conserve pas un ancien cache pointant vers la série de 2004', async () => {
  const h = harness({
    tmdb: { name: 'Nord et Sud', first_air_date: '1985-11-03' },
    cached: { title: 'Nord et Sud', year: '1985', cpasmalUrl: `${base}/2318-nord-et-sud.html`,
      links: { vf: [{ server: 'voe', url: 'https://player.test/wrong-series' }], vostfr: [] } },
    request: async url => {
      assert.equal(url, `${base}/index.php`);
      return { status: 200, data: searchHtml.replaceAll('Chicago Fire', 'Nord et Sud').replace('2012', '2004') };
    },
  });
  assert.equal((await h.retrieve()).statusCode, 404);
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].notFound, true);
  assert.equal((await h.call()).statusCode, 404);
});

test('la seconde fiche proposée doit aussi correspondre à l’année TMDB', async () => {
  const h = harness({
    tmdb: { name: 'Nord et Sud', first_air_date: '1985-11-03' },
    request: async (url, options) => {
      if (url === `${base}/index.php`) {
        const query = new URLSearchParams(options.body).get('story');
        const data = searchHtml.replaceAll('Chicago Fire', 'Nord et Sud').replace('2012', '');
        return { status: 200, data: query.includes('1985') ? data.replace(seriesUrl, `${base}/alternate.html`) : data };
      }
      assert.ok([seriesUrl, `${base}/alternate.html`].includes(url), 'aucun épisode de la mauvaise série ne doit être extrait');
      return { status: 200, data: seriesHtml.replace('2012', '2004') };
    },
  });
  assert.equal((await h.retrieve()).statusCode, 404);
  assert.equal(h.writes[0].notFound, true);
});

test('deux épisodes réutilisent la recherche et la fiche série validée', async () => {
  const h = harness({ request: async url => {
    if (url === `${base}/index.php`) return { status: 200, data: searchHtml };
    if (url === seriesUrl) return { status: 200, data: seriesHtml };
    if (url.endsWith('-episode.html')) return { status: 200, data: episodeHtml };
    return { status: 302, headers: { location: `https://player.test/${url.split('/').at(-1)}` } };
  } });
  assert.equal((await h.retrieve('14', '5')).statusCode, 200);
  assert.equal((await h.retrieve('14', '6')).statusCode, 200);
  assert.equal(h.requests.filter(r => r.url === `${base}/index.php`).length, 1);
  assert.equal(h.requests.filter(r => r.url === seriesUrl).length, 1);
  assert.equal(h.requests.filter(r => r.url.endsWith('-episode.html')).length, 2);
});

test('un lecteur prioritaire est lisible pendant les autres extractions, bornées à trois', async () => {
  let release, active = 0, peak = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const started = [];
  const fields = ['dood_vf', 'vidzy_vf', 'uqload_vostfr', 'voe_vf', 'netu_vf'];
  const html = `<div class="liens-c">${fields.map(field =>
    `<div class="lien" onclick="getxfield(this, '136435', '${field}', 'serial')"></div>`).join('')}</div>`;
  const h = harness({ request: async url => {
    if (url === `${base}/index.php`) return { status: 200, data: searchHtml };
    if (url === seriesUrl) return { status: 200, data: seriesHtml };
    if (url === episodeUrl) return { status: 200, data: html };
    const field = url.split('/').at(-1);
    started.push(field);
    peak = Math.max(peak, ++active);
    try {
      if (field !== 'voe_vf') await gate;
      return { status: 302, headers: { location: `https://player.test/${field}` } };
    } finally { active--; }
  } });
  try {
    const partial = await h.retrieve();
    assert.equal(partial.statusCode, 200);
    assert.deepEqual(partial.body.links.vf, [{ server: 'voe', url: 'https://player.test/voe_vf' }]);
    assert.equal(active, 3, 'les autres hébergeurs restent en cours pendant la lecture du cache');
    assert.deepEqual(started.slice(0, 2), ['voe_vf', 'uqload_vostfr']);
  } finally { release(); }
  for (let i = 0; i < 20 && h.writes.length < 2; i++) await new Promise(setImmediate);
  const complete = await h.call();
  assert.equal(peak, 3);
  assert.equal(complete.body.links.vf.length, 4);
  assert.equal(complete.body.links.vostfr.length, 1);
  assert.equal(complete.body._cpasmalPartial, undefined);
  assert.equal(h.writes.length, 2, 'une publication anticipée, puis la liste complète');
});

const familyTmdb = { id: 1229906, title: 'Family', original_title: 'Family', release_date: '2026-09-25' };
const rentalFamilyUrl = `${base}/22399-rental-family.html`;
const moviePage = title => `<h1>${title} <span>streaming</span></h1>
  <article><ul><li><span class="info">Date de sortie :</span><span class="infos">2026</span></li></ul></article>
  <div class="liens-c"><div class="lien" onclick="getxfield('22399', 'voe_vf', 'jeton')"></div></div>`;
const movieCard = caption => `<div class="thumb">
  <a class="th-img" href="${rentalFamilyUrl}"><span class="th-Film">Film</span></a>
  <div class="th-desc"><a class="th-capt">${caption}</a><div class="th-year">2026</div></div>
</div>`;
const retrieveMovie = async h => {
  for (let i = 0; i < 20; i++) {
    const res = await h.callMovie();
    if (res.statusCode !== 202) return res;
    await new Promise(setImmediate);
  }
  assert.fail('La récupération simulée doit finir');
};

test('« Family » ne reçoit pas les lecteurs de la fiche « Rental Family »', async () => {
  const h = harness({ tmdb: familyTmdb, request: async url => {
    if (url === `${base}/index.php`) return { status: 200, data: movieCard('Family') };
    assert.equal(url, rentalFamilyUrl, 'aucun lecteur de la mauvaise fiche ne doit être extrait');
    return { status: 200, data: moviePage('Rental Family') };
  } });
  assert.equal((await retrieveMovie(h)).statusCode, 404);
  assert.equal(h.writes[0].notFound, true);
});

test('un ancien cache « Rental Family » est remplacé pour « Family »', async () => {
  const h = harness({
    tmdb: familyTmdb, stale: true,
    cached: { title: 'Family', year: '2026', cpasmalUrl: rentalFamilyUrl,
      links: { vf: [{ server: 'voe', url: 'https://player.test/wrong-film' }], vostfr: [] } },
    request: async url => {
      if (url === `${base}/index.php`) return { status: 200, data: movieCard('Rental Family') };
      assert.equal(url, rentalFamilyUrl);
      return { status: 200, data: moviePage('Rental Family') };
    },
  });
  // Le cache est servi, puis l'actualisation en arrière-plan le réfute.
  assert.equal((await h.callMovie()).statusCode, 200);
  for (let i = 0; i < 20 && !h.writes.length; i++) await new Promise(setImmediate);
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].notFound, true);
  assert.equal((await h.callMovie()).statusCode, 404);
});

test('un titre alternatif TMDB suffit à valider la fiche', async () => {
  const h = harness({
    tmdb: familyTmdb, alternativeTitles: [{ iso_3166_1: 'FR', title: 'La Famille' }],
    request: async url => {
      if (url === `${base}/index.php`) return { status: 200, data: movieCard('Family') };
      if (url === rentalFamilyUrl) return { status: 200, data: moviePage('La Famille') };
      return { status: 200, data: '<iframe src="https://player.test/voe"></iframe>' };
    },
  });
  const res = await retrieveMovie(h);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.links.vf, [{ server: 'voe', url: 'https://player.test/voe' }]);
});
