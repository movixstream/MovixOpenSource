'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const test = require('node:test');

const rot47 = value => [...value].map(c => {
  const n = c.charCodeAt(0);
  return n < 33 || n > 126 ? c : String.fromCharCode(33 + (n - 33 + 47) % 94);
}).join('');
const integer = (field, value) => Buffer.from([field * 8, value]);
function bytes(field, value) {
  const data = Buffer.from(value);
  assert.ok(data.length < 128);
  return Buffer.concat([Buffer.from([field * 8 + 2, data.length]), data]);
}

// Exact routes and parsers, fake clocks/transports/files; no app bootstrap or real service.
function fixture({ hubPages = null } = {}) {
  const base = path.resolve(__dirname, '../..');
  const filename = path.join(base, 'liveTvRoutes.js');
  const localRequire = createRequire(filename);
  let time = 1000000;
  let version = 0;
  let failCatalog = false;
  let failConfig = false;
  let failDetail = false;
  let failedPublication = null;
  const files = new Map();
  const counts = { posts: 0, writes: 0, reads: 0, hub: 0, front: 0, player: 0, bs: 0,
    sports: 0, detail: 0, match: 0, live: 0, playlist: 0, tokenChecks: 0, vavooStreams: 0,
    streamedMatches: 0, streamedStreams: 0 };
  const cachePath = key => path.join(base, 'cache/tvdirect', `${crypto.createHash('md5').update(key).digest('hex')}.json`);
  const seed = (key, value, age = 0) => files.set(cachePath(key), {
    text: JSON.stringify(value), time: time - age, ino: ++version,
  });
  const absent = () => Object.assign(new Error('absent'), { code: 'ENOENT' });
  const fakeFs = { promises: {
    async access() {}, async mkdir() {},
    async stat(name) {
      const f = files.get(name); if (!f) throw absent();
      return { size: Buffer.byteLength(f.text), mtimeMs: f.time, ino: f.ino };
    },
    async readFile(name) { counts.reads++; if (!files.has(name)) throw absent(); return files.get(name).text; },
    async writeFile(name, text) { counts.writes++; files.set(name, { text, time, ino: ++version }); },
    async rename(from, to) {
      if (failedPublication && to === cachePath(failedPublication)) throw new Error('publication indisponible');
      files.set(to, files.get(from)); files.delete(from);
    },
    async unlink(name) { if (!files.delete(name)) throw absent(); },
    async readdir() { return [...files.keys()].map(name => path.basename(name)); },
  } };
  const axios = {
    async get(url, config) {
      if (url === 'https://geil.to/live/catalog/live/channels.json') {
        assert.equal(config.params['filter[group]'], 'France');
        counts.posts++;
        if (failCatalog) throw new Error('catalogue indisponible');
        return { data: { items: [{ id: 'channel-1', name: 'Canal Test',
          url: 'https://geil.to/live/play/channel-1' }], nextCursor: null } };
      }
      if (url === 'https://api.ppv.st/api/streams') {
        counts.streamedMatches++;
        return { data: { success: true, streams: [{ category: 'Football', streams: [{
          id: 4242, name: 'Match PPV', category_name: 'Football', starts_at: time / 1000 - 60,
          ends_at: time / 1000 + 3600, locale: 'fr', source_tag: 'HD | Canal+',
          iframe: 'https://embed.example/fixture-live', substreams: [] }] }] } };
      }
      if (url.includes('hubu.ru')) {
        counts.hub++;
        if (failConfig) throw new Error('config indisponible');
        if (hubPages) return { data: hubPages[url] ?? '' };
        return { data: '<a href="https://fctv33hd.example">FCTV</a>' };
      }
      if (url === 'https://fctv33hd.example/fr') {
        counts.front++; return { data: 'https://apis-data-defra10.example' };
      }
      if (url.endsWith('/api/common/params')) {
        counts.player++; if (failConfig) throw new Error('config indisponible');
        return { data: rot47('{"iframePlayerDomains":["player.example"]}') };
      }
      if (url.endsWith('/api/common/bs')) {
        counts.bs++; if (failConfig) throw new Error('config indisponible');
        return { data: bytes(10, bytes(1, Buffer.concat([integer(1, 100), bytes(2, 'key')])) ) };
      }
      if (url.endsWith('/api/match/count')) {
        counts.sports++; if (failConfig) throw new Error('config indisponible');
        return { data: bytes(10, bytes(1, Buffer.concat([integer(1, 1), integer(2, 4)]))) };
      }
      if (url.endsWith('/api/match/live')) {
        counts.live++; if (failCatalog) throw new Error('catalogue indisponible');
        return { data: Buffer.alloc(0) };
      }
      if (url.endsWith('/api/match/detail')) {
        counts.match++; return { data: Buffer.alloc(0) };
      }
      if (url.endsWith('/api/stream/detail')) {
        counts.detail++;
        if (failDetail) throw new Error('résolution indisponible');
        return { data: bytes(10, bytes(4, rot47('12345678https://cdn.example/live.m3u8'))),
          headers: { 'rb-session': `session${counts.detail}` } };
      }
      if (url.startsWith('https://cdn.example/')) {
        counts.playlist++;
        return { status: 200, data: `#EXTM3U\n#EXTINF:6,\nsegment${counts.playlist}.ts\n` };
      }
      throw new Error(`GET inattendu ${url}`);
    },
  };
  const module = { exports: {} };
  const dependencies = {
    axios, fs: fakeFs,
    './checkVip': { verifyAccessKey: async () => ({ vip: false }), requireVip: (req, res, next) => next() },
    './utils/mediaSigning': {
      appendSignature: url => url, buildSignedProxyUrl: url => url, encodeSignedToken: () => 'unused',
      decodeSignedToken: (route, token) => { counts.tokenChecks++; return token; },
      signingConfigured: () => false, isPublicHttpUrl: () => true,
    },
    './utils/workerSlots': { isNorthliveRefreshOwner: () => false },
    './utils/northliveCatalog': {
      createNorthliveCatalog: () => ({ isOwner: false, getChannels: async () => [] }),
      publishNorthliveCatalog: () => { throw new Error('publication Northlive inattendue'); },
      scrapeNorthlivePages: () => { throw new Error('scraping Northlive inattendu'); },
    },
    './utils/vavooMetadata': {
      createVavooMetadataService: () => ({ getIndexForGroup: async () => new Map() }),
      findVavooMetadata: () => null, isHttpsArtworkUrl: () => false,
    },
    './utils/proxyManager': {
      pickVavooSocks5Proxy: async () => null, markVavooProxyAsHealthy() {}, markVavooProxyAsFailed() {},
      getProxyAgent() {},
    },
  };
  const context = vm.createContext({ module, exports: module.exports, __dirname: base, Buffer, URL, URLSearchParams,
    Date: class extends Date { static now() { return time; } }, setTimeout, clearTimeout,
    setInterval: () => ({ unref() {} }), console: { log() {}, error() {}, warn() {} },
    process: { env: { VAVOO_BASE_URL: 'https://geil.to' } },
    require: name => name in dependencies ? dependencies[name] : localRequire(name),
  });
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  context.resolveVavooFixture = async () => { counts.vavooStreams++; return 'https://stream.example/live.m3u8'; };
  vm.runInContext('resolveVavooStream = resolveVavooFixture;', context);
  const functions = vm.runInContext('({ getFctvApiBase, getFctvPlayerBaseUrl, fetchFctvBsKeys, getFctvAvailableSportTypes, fetchFctvMatchDetail, resolveFctvUpstreamPlaylist, fctvPlaylistTarget, proxifyFctvImage })', context);
  async function request(routePath = '/catalog/:type/:catalogId', { catalogId = 'vavoo_france', channelId = 'vavoo_one', query = {} } = {}) {
    const req = { params: { type: 'tv', catalogId, channelId }, query, headers: {}, protocol: 'https', get() {} };
    const res = { statusCode: 200, set() { return this; }, vary() { return this; }, setHeader() {},
      status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; },
      send(value) { this.body = value; return this; } };
    const router = module.exports;
    const route = router.stack.find(layer => layer.route?.path === routePath);
    assert.ok(route);
    for (const fn of [...router.stack.filter(layer => !layer.route).map(layer => layer.handle),
      ...route.route.stack.map(layer => layer.handle)]) {
      let next = false; await fn(req, res, () => { next = true; }); if (!next) break;
    }
    return res;
  }
  return { ...functions, request, counts, seed, advance: ms => { time += ms; }, files,
    failCatalog: value => { failCatalog = value; }, failConfig: value => { failConfig = value; },
    failDetail: value => { failDetail = value; },
    failPublication: key => { failedPublication = key; } };
}
const burst = task => Promise.all(Array.from({ length: 20 }, task));

test('Streamed reste à côté de FCTV dans le manifeste et sert catalogue et lecteurs sans VIP', async () => {
  const f = fixture();
  const manifest = await f.request('/manifest');
  assert.equal(manifest.statusCode, 200);
  assert.ok(manifest.body.catalogs.some(c => c.id === 'matches_all'));
  assert.ok(manifest.body.catalogs.some(c => c.id === 'streamed_all' && c._free));
  assert.equal(f.counts.streamedMatches, 0);
  const catalogs = await burst(() => f.request(undefined, { catalogId: 'streamed_football' }));
  assert.ok(catalogs.every(r => r.body.metas[0]?.id === 'streamed_4242'));
  assert.equal(f.counts.streamedMatches, 1);
  // Les lecteurs viennent de la même liste PPV : aucun appel amont en plus.
  const streams = await burst(() => f.request('/stream/:type/:channelId', { channelId: 'streamed_4242' }));
  assert.ok(streams.every(r => r.statusCode === 200 && r.body.streams[0]?._isEmbed));
  assert.equal(f.counts.streamedMatches, 1);
  f.advance(61000);
  await f.request('/stream/:type/:channelId', { channelId: 'streamed_4242' });
  assert.equal(f.counts.streamedMatches, 2);
});

test('salve Vavoo à froid : 20 réponses, un POST et trois publications ; frais sans travail amont', async () => {
  const f = fixture();
  const responses = await burst(() => f.request());
  assert.ok(responses.every(r => r.statusCode === 200 && r.body.metas.length === 1));
  assert.equal(f.counts.posts, 1); assert.equal(f.counts.writes, 3);
  await burst(() => f.request());
  assert.equal(f.counts.posts, 1); assert.equal(f.counts.writes, 3);
  f.advance(61000); await burst(() => f.request());
  assert.equal(f.counts.posts, 1); assert.equal(f.counts.writes, 4); // group is still fresh for 1h
});

test('catalogue périmé : un échec, aucune publication, anciennes données conservées et reprise espacée', async () => {
  const f = fixture();
  f.seed('catalog_tv_vavoo_france_v8', { metas: [{ id: 'old' }] }, 3600001);
  f.failCatalog(true);
  let responses = await burst(() => f.request());
  assert.ok(responses.every(r => r.body.metas[0].id === 'old'));
  assert.equal(f.counts.posts, 1); assert.equal(f.counts.writes, 0);
  await f.request(); assert.equal(f.counts.posts, 1);
  f.advance(15001); f.failCatalog(false);
  responses = await burst(() => f.request());
  assert.ok(responses.every(r => r.body.metas[0].id === 'vavoo_channel-1'));
  assert.equal(f.counts.posts, 2); assert.equal(f.counts.writes, 3);
});

test('cache absent et amont en panne : liste vide non publiée, reprise temporisée ; suppression disque détectée', async () => {
  const f = fixture(); f.failCatalog(true);
  const first = await f.request();
  assert.equal(first.statusCode, 200); assert.equal(first.body.metas.length, 0);
  assert.equal((await f.request()).statusCode, 200); assert.equal(f.counts.posts, 1);
  assert.equal(f.counts.writes, 0);
  f.advance(15001); f.failCatalog(false); await f.request();
  f.files.clear();
  assert.equal(f.files.size, 0);
  await f.request(); assert.equal(f.counts.posts, 3);
});

test('un catalogue FCTV périmé n’est pas remplacé par une liste vide sur panne réseau', async () => {
  const f = fixture();
  f.seed('catalog_tv_matches_all_v3', { metas: [{ id: 'old-match' }] }, 61000);
  f.failCatalog(true);
  const responses = await burst(() => f.request(undefined, { catalogId: 'matches_all' }));
  assert.ok(responses.every(r => r.body.metas[0].id === 'old-match'));
  assert.equal(f.counts.live, 1); assert.equal(f.counts.writes, 0);
});

test('FCTV configuration, clés par sport et sports : travail partagé, TTL et erreur avec reprise', async () => {
  const f = fixture();
  await burst(() => Promise.all([f.getFctvApiBase(), f.getFctvPlayerBaseUrl(), f.fetchFctvBsKeys(1), f.getFctvAvailableSportTypes()]));
  assert.equal(f.counts.hub, 1); assert.equal(f.counts.front, 1); assert.equal(f.counts.player, 1);
  assert.equal(f.counts.bs, 2); // sports/count uses sportType 0; key 1 is distinct
  assert.equal(f.counts.sports, 1);
  await f.fetchFctvBsKeys(1); assert.equal(f.counts.bs, 2);
  f.advance(5 * 60000 + 1); f.failConfig(true);
  await burst(() => f.fetchFctvBsKeys(1)); assert.equal(f.counts.bs, 3);
  await f.fetchFctvBsKeys(1); assert.equal(f.counts.bs, 3);
  f.advance(15001); f.failConfig(false);
  await f.fetchFctvBsKeys(1); assert.equal(f.counts.bs, 4);
});

test('FCTV résolution inclut le sport, partage le renouvellement forcé et respecte 20 secondes', async () => {
  const f = fixture();
  const resolve = (...extra) => f.resolveFctvUpstreamPlaylist('one', 3, 42, 1, ...extra);
  const initial = await burst(() => resolve());
  assert.ok(initial[0]?.playlistUrl); assert.ok(initial.every(value => value === initial[0]));
  assert.equal(f.counts.detail, 1);
  await f.resolveFctvUpstreamPlaylist('one', 3, 42, 2); assert.equal(f.counts.detail, 2);
  const renewed = await burst(() => resolve(true, initial[0]));
  assert.equal(f.counts.detail, 3); assert.notEqual(renewed[0].token, initial[0].token);
  assert.equal(await resolve(true, initial[0]), renewed[0]); // delayed rejection of same old token
  assert.equal(f.counts.detail, 3);
  f.advance(20001); const current = await resolve(); assert.equal(f.counts.detail, 4);
  f.advance(20001); f.failDetail(true);
  assert.equal(await resolve(), current);
  f.failDetail(false);
  assert.equal(await resolve(), current); assert.equal(f.counts.detail, 5);
  f.advance(15001);
  assert.notEqual((await resolve()).token, current.token); assert.equal(f.counts.detail, 6);
});

test('FCTV : la page bio-link relais est suivie et les logos suivent le domaine de l’API', async () => {
  const f = fixture({ hubPages: {
    'https://hubu.ru/fctvlink': '<a href="https://hubu.ru/">Hubu</a><a href="https://hubu.ru/fclink">🔗 FCTV33 - Pages</a>',
    'https://hubu.ru/fclink': '<a href="https://fctv33hd.example/">🔗Link - FCTV33</a>',
  } });
  assert.equal(await f.getFctvApiBase(), 'https://apis-data-defra10.example');
  assert.equal(f.counts.hub, 2);
  assert.equal(f.proxifyFctvImage('https://logos1.dead.cfd/aelogo/team.png!w80'),
    'https://logos1.example/aelogo/team.png!w80');
});

test('un catalogue FCTV de plus de 3 h n’est plus servi pendant une panne', async () => {
  const f = fixture();
  f.seed('catalog_tv_matches_all_v3', { metas: [{ id: 'old-match' }] }, 3 * 3600000 + 1);
  f.failCatalog(true);
  const response = await f.request(undefined, { catalogId: 'matches_all' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.metas.length, 0);
});

test('FCTV configuration indisponible à froid : fallback partagé puis reprise après 15 secondes', async () => {
  const f = fixture(); f.failConfig(true);
  await burst(() => Promise.all([f.getFctvApiBase(), f.getFctvPlayerBaseUrl(), f.getFctvAvailableSportTypes()]));
  assert.equal(f.counts.hub, 1); assert.equal(f.counts.player, 1); assert.equal(f.counts.sports, 1);
  await f.getFctvApiBase(); await f.getFctvPlayerBaseUrl(); await f.getFctvAvailableSportTypes();
  assert.equal(f.counts.hub, 1); assert.equal(f.counts.player, 1); assert.equal(f.counts.sports, 1);
  f.advance(15001); f.failConfig(false);
  assert.equal(await f.getFctvApiBase(), 'https://apis-data-defra10.example');
  assert.equal(await f.getFctvPlayerBaseUrl(), 'https://player.example');
  assert.ok((await f.getFctvAvailableSportTypes()).has(1));
  assert.equal(f.counts.hub, 2); assert.equal(f.counts.player, 2); assert.equal(f.counts.sports, 2);
  f.advance(30 * 60000 + 1);
  await burst(() => f.getFctvPlayerBaseUrl());
  assert.equal(f.counts.player, 3); assert.equal(f.counts.hub, 3);
});

test('un hit FCTV normal simultané ne doit pas absorber le renouvellement forcé', async () => {
  for (const yieldMicrotask of [false, true]) {
    const f = fixture();
    const resolve = (...extra) => f.resolveFctvUpstreamPlaylist('one', 3, 42, 1, ...extra);
    const old = await resolve();
    const normal = resolve();
    if (yieldMicrotask) await Promise.resolve();
    const forced = resolve(true, old);
    assert.equal(await normal, old);
    assert.notEqual((await forced).token, old.token);
    assert.equal(f.counts.detail, 2);
  }
});

test('un jeton FCTV rejeté ne sert plus de repli et sa panne est temporisée', async () => {
  const f = fixture();
  const resolve = (...extra) => f.resolveFctvUpstreamPlaylist('one', 3, 42, 1, ...extra);
  const old = await resolve(); f.failDetail(true);
  await assert.rejects(resolve(true, old), /indisponible/);
  await assert.rejects(resolve(), /indisponible/);
  await assert.rejects(resolve(true, old), /indisponible/);
  assert.equal(f.counts.detail, 2);
  f.failDetail(false); f.advance(15001);
  assert.notEqual((await resolve()).token, old.token); assert.equal(f.counts.detail, 3);
});

test('une panne FCTV à froid partage et temporise l’erreur sans bloquer une autre clé', async () => {
  const f = fixture(); f.failDetail(true);
  const resolve = () => f.resolveFctvUpstreamPlaylist('one', 3, 42, 1);
  const results = await Promise.allSettled(Array.from({ length: 20 }, resolve));
  assert.ok(results.every(result => result.status === 'rejected')); assert.equal(f.counts.detail, 1);
  await assert.rejects(resolve()); assert.equal(f.counts.detail, 1);
  f.failDetail(false);
  await f.resolveFctvUpstreamPlaylist('one', 3, 42, 2); assert.equal(f.counts.detail, 2);
  f.advance(15001); await resolve(); assert.equal(f.counts.detail, 3);
});

test('échec de publication du catalogue : ancien résultat conservé, scrape et écriture temporisés', async () => {
  const f = fixture(); const key = 'catalog_tv_matches_all_v3';
  f.seed(key, { metas: [{ id: 'old' }] }, 61000); f.failPublication(key);
  let result = await f.request(undefined, { catalogId: 'matches_all' });
  assert.equal(result.body.metas[0].id, 'old'); assert.equal(f.counts.live, 1); assert.equal(f.counts.writes, 1);
  await f.request(undefined, { catalogId: 'matches_all' });
  assert.equal(f.counts.live, 1); assert.equal(f.counts.writes, 1);
  f.failPublication(null); f.advance(15001);
  result = await f.request(undefined, { catalogId: 'matches_all' });
  assert.equal(result.body.metas.length, 0); assert.equal(f.counts.live, 2); assert.equal(f.counts.writes, 2);
});

test('publication impossible à froid : liste vide contractuelle sans nouveau scrape pendant le délai', async () => {
  const f = fixture(); f.failPublication('catalog_tv_matches_all_v3');
  const request = () => f.request(undefined, { catalogId: 'matches_all' });
  const first = await request();
  assert.equal(first.statusCode, 200); assert.equal(first.body.metas.length, 0);
  await request(); assert.equal(f.counts.live, 1); assert.equal(f.counts.writes, 1);
  assert.equal(f.files.size, 0);
});

test('échec de publication du groupe Vavoo : aucun catalogue partiel publié et reprise temporisée', async () => {
  const f = fixture(); const groupKey = 'vavoo_group_France_v5';
  f.seed('catalog_tv_vavoo_france_v8', { metas: [{ id: 'old' }] }, 3600001);
  f.failPublication(groupKey);
  assert.equal((await f.request()).body.metas[0].id, 'old');
  const writes = f.counts.writes;
  await f.request(); assert.equal(f.counts.posts, 1); assert.equal(f.counts.writes, writes);
  f.failPublication(null); f.advance(15001);
  assert.equal((await f.request()).body.metas[0].id, 'vavoo_channel-1'); assert.equal(f.counts.posts, 2);
});

test('échec de publication du flux Vavoo partagé : résolution temporisée et repli sur ancien flux', async () => {
  const f = fixture(); const key = 'vavoo_stream_vavoo_one_v1';
  f.seed(key, { streams: [{ url: 'https://stream.example/old.m3u8' }] }, 61000);
  f.failPublication(key);
  const request = () => f.request('/stream/:type/:channelId');
  const responses = await burst(request);
  assert.ok(responses.every(result => result.statusCode === 200 && result.body.streams[0].url.endsWith('old.m3u8')));
  assert.equal(f.counts.vavooStreams, 1); assert.equal(f.counts.writes, 1);
  await request(); assert.equal(f.counts.vavooStreams, 1); assert.equal(f.counts.writes, 1);
  f.failPublication(null); f.advance(15001);
  assert.ok((await request()).body.streams[0].url.endsWith('live.m3u8'));
  assert.equal(f.counts.vavooStreams, 2); assert.equal(f.counts.writes, 2);
});

test('chaque requête de playlist valide son jeton et télécharge le HLS vivant', async () => {
  const f = fixture();
  const query = { streamId: 'one', siteType: '3', matchId: '42', sportType: '1' };
  query.token = f.fctvPlaylistTarget(42, 'one', 3, 1);
  const first = await f.request('/fctv/playlist', { query });
  const next = await f.request('/fctv/playlist', { query });
  assert.equal(first.statusCode, 200); assert.equal(next.statusCode, 200);
  assert.notEqual(first.body, next.body); assert.equal(f.counts.playlist, 2); assert.equal(f.counts.detail, 1);
  const denied = await f.request('/fctv/playlist', { query: { ...query, sportType: '2' } });
  assert.equal(denied.statusCode, 403); assert.equal(f.counts.tokenChecks, 3);
  assert.equal(f.counts.playlist, 2);
});

test('les détails de match sont partagés avec isolation du sport', async () => {
  const f = fixture();
  await burst(() => f.fetchFctvMatchDetail(42, 1)); assert.equal(f.counts.match, 1);
  await f.fetchFctvMatchDetail(42, 2); assert.equal(f.counts.match, 2);
});
