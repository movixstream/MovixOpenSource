/**
 * Source anime-sama du Main API : lecture des saisons, adresses des vidéos,
 * cache par œuvre et recherche par ID TMDB.
 *
 * Depuis le 2026-11-12, anime-sama ne publie plus `episodes.js` : la page de
 * saison liste des repères `lien:<n°>` et l'adresse de chaque vidéo se demande
 * à `/api/lien.php` avec le jeton de la page. Ce point d'entrée limite le
 * débit par IP (environ 300 demandes par tranche de 10 minutes, mesuré le
 * 2026-11-15) : les adresses ne sont donc demandées que pour l'épisode qu'un
 * visiteur va lire, jamais d'avance pour toute une œuvre.
 *
 * Modes de défaillance couverts ici. Le scénario de bout en bout
 * (`scripts/e2e/animeSamaLive.js`) lit le vrai site : il prouve que le format
 * du jour est compris, mais il ne peut ni provoquer une panne d'anime-sama, ni
 * épuiser exprès son quota, ni rejouer deux actualisations à une heure
 * d'écart, ni faire tourner deux workers. Ces cas-là sont joués ici contre un
 * faux site.
 *
 *  1. L'actualisation d'une œuvre demande des adresses à `/api/lien.php` : une
 *     seule grosse œuvre épuise le quota de tout le site.
 *  2. Un épisode dont les adresses restent à demander disparaît de la liste
 *     (les rangs des épisodes se décalent chez le client).
 *  3. Les adresses d'un épisode sont redemandées à chaque lecture, ou une fois
 *     par visiteur quand plusieurs l'ouvrent en même temps.
 *  4. Une vidéo supprimée, un hébergeur hors service ou une case vide coûtent
 *     une requête, ou décalent les lecteurs d'un épisode.
 *  5. Un jeton expiré, un lien inconnu, un quota dépassé ou une panne de
 *     `/api/lien.php` perdent les adresses déjà reçues, ouvrent le disjoncteur
 *     alors que le site répond, ou laissent partir d'autres demandes pendant
 *     le blocage.
 *  6. `/api/lien.php` est appelé avec les en-têtes d'une navigation
 *     (`Sec-Fetch-Site: none`) : le site répond 403 « origine ».
 *  7. Les caches d'avant le 12/11, qui portent déjà les adresses, les perdent
 *     au passage au nouveau format : tout le catalogue serait à redemander.
 *  8. Une fiche sans anime (saisons masquées, scans seuls) ou une saison vidée
 *     par le site logguent un échec à chaque recherche et gardent des lecteurs
 *     retirés ; à l'inverse une page cassée vide un cache encore bon.
 *  9. Une saison illisible bloque l'actualisation de toutes les autres.
 * 10. Deux workers actualisent la même œuvre en même temps.
 * 11. Le même anime a deux caches selon l'écriture de son nom dans la
 *     recherche (`l'` ou `l&#039;`) ; le cache d'avant n'est plus servi.
 * 12. La recherche par ID TMDB rend une autre œuvre, ou rien pour un titre
 *     jamais ouvert.
 * 13. Une lecture d'épisode pendant une actualisation perd des adresses du
 *     carnet (deux écritures croisées du même fichier).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROUTE = path.join(__dirname, '../animeSama.js');
const CACHE_DIR = '/fixture/anime';
const SITE = 'https://anime-sama.invalid/';
const HOUR = 60 * 60 * 1000;
let now = 1800000000000;
class Clock extends Date { static now() { return now; } }

// La mémoire d'échec de 60 s de sourceRefresh suit la même horloge que la route.
const refreshModule = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../utils/sourceRefresh.js'), 'utf8'), {
  module: refreshModule, Date: Clock, setTimeout, clearTimeout,
  require(name) {
    if (name === './singleFlight') return require('../../utils/singleFlight');
    if (name === './refreshError') return require('../../utils/refreshError');
    throw new Error(`Dépendance inattendue : ${name}`);
  },
});
const realBreaker = require('../../utils/sourceCircuitBreaker');

const tick = () => new Promise(setImmediate);
async function settle() { for (let i = 0; i < 80; i++) await tick(); }
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const httpError = (status, data = '') => Object.assign(new Error(`[ANIMESAMA CYCLETLS] status ${status}`), { response: { status, data } });
const timeoutError = () => Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
const clone = value => JSON.parse(JSON.stringify(value));
const hostOf = url => new URL(url).hostname;

/**
 * Faux anime-sama : une fiche, des pages de saison et `/api/lien.php`, servis
 * dans le format du site. Tout est modifiable entre deux actualisations.
 *
 *   site.fiche                    lignes du <script> des saisons, ou HTML entier
 *   site.pages['saison1/vostfr']  { langs, eps: [[eps1…], [eps2…]], token, removed, infos, list }
 *   site.links[n°]                adresse rendue par /api/lien.php
 *   site.fail(kind, key)          → erreur à lever (kind : 'fiche' | 'page' | 'link')
 */
function createSite() {
  const site = {
    fiche: ['panneauAnime("Saison 1", "saison1/vostfr");'],
    pages: {},
    links: {},
    fail: () => null,
    pageReads: {},
  };

  const ficheHtml = () => (typeof site.fiche === 'string' ? site.fiche : [
    '<h1 id="titreOeuvre" class="oe-titre">Example</h1>',
    '<script>',
    '/* panneauAnime("nom", "saison1/vostfr"); panneauScan("nom", "scan/vf"); */',
    'var OE_BASE = "\\/catalogue\\/example\\/";',
    'function panneauAnime(nom, url) { oePanneau(nom, url, false); }',
    '</script>',
    '<script>',
    ...site.fiche,
    '</script>',
  ].join('\n'));

  const pageHtml = (page) => {
    if (typeof page.html === 'string') return page.html;
    const ids = (page.eps || []).flat().filter(item => item.startsWith('lien:')).map(item => item.slice(5));
    const meta = {};
    for (const id of ids) {
      const host = page.hosts?.[id] || (site.links[id] ? hostOf(site.links[id]) : 'inconnu.invalid');
      meta[id] = page.removed?.[id] ? [host, page.removed[id]] : [host];
    }
    return [
      '<h1 id="titreOeuvre" class="ct-titre">Example</h1>',
      (page.eps || []).length ? [
        `<script data-source="bdd">${page.eps.map((list, rank) => `var eps${rank + 1} = ${JSON.stringify(list)};`).join('\n')}`,
        `var epsMeta = ${JSON.stringify(meta)};`,
        `var epsJeton = ${JSON.stringify(page.token)};`,
        'var epsOrdreFinal = true;',
        '</script>',
      ].join('\n') : '',
      '<script>',
      page.langs ? `var languesDispo = ${JSON.stringify(page.langs)};` : '',
      page.infos ? `var lecteursInfos = ${JSON.stringify(page.infos)};` : '',
      '</script>',
      page.list || '',
    ].join('\n');
  };

  site.respond = async (url) => {
    const { pathname, searchParams } = new URL(url);
    if (pathname === '/api/lien.php') {
      const id = searchParams.get('l');
      const failure = await site.fail('link', id);
      if (failure) throw failure;
      const page = Object.values(site.pages).find(candidate => (candidate.accepts || [candidate.token]).includes(searchParams.get('j')));
      if (!page) throw httpError(403, '{"erreur":"expire"}');
      const listed = (page.eps || []).flat().includes(`lien:${id}`);
      if (!listed || !site.links[id]) throw httpError(404, '{"erreur":"absent"}');
      return { status: 200, data: JSON.stringify({ u: site.links[id] }) };
    }
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length === 2) {
      const failure = await site.fail('fiche', parts[1]);
      if (failure) throw failure;
      return { status: 200, data: ficheHtml() };
    }
    const key = parts.slice(2).join('/');
    site.pageReads[key] = (site.pageReads[key] || 0) + 1;
    const failure = await site.fail('page', key);
    if (failure) throw failure;
    if (!site.pages[key]) throw httpError(404, '<!doctype html><title>Page introuvable</title>');
    return { status: 200, data: pageHtml(site.pages[key]) };
  };
  return site;
}

// Une saison simple : `count` épisodes, un lecteur par épisode et par langue.
function simpleSeason(site, pathName, langs, count, { firstId = 1, host = 'a.invalid' } = {}) {
  let id = firstId;
  for (const lang of langs) {
    const list = [];
    for (let episode = 1; episode <= count; episode++) {
      site.links[id] = `https://${host}/${pathName}/${lang}/${episode}`;
      list.push(`lien:${id}`);
      id += 1;
    }
    site.pages[`${pathName}/${lang}`] = { langs, eps: [list], token: `jeton-${pathName}-${lang}` };
  }
  return id;
}

const relative = file => String(file).replace(/\\/g, '/').replace(`${CACHE_DIR}/`, '');
const TITLE_DIR = 'oeuvres';
const LINKS_DIR = 'liens';

function loadAnimeSama({ site = createSite(), animes = ['Example'], files = {}, deadPlayers = false, lock = null, index = null, firstScanWaitMs } = {}) {
  const routes = new Map();
  const router = {};
  for (const method of ['get', 'post', 'use']) router[method] = (url, ...handlers) => routes.set(`${method} ${url}`, handlers.at(-1));
  const store = new Map(Object.entries(files).map(([name, entry]) => [name, {
    raw: typeof entry.raw === 'string' ? entry.raw : JSON.stringify(entry.data ?? entry),
    mtime: entry.mtime ?? now - 2 * HOUR,
  }]));
  const fileOf = (file) => {
    const entry = store.get(relative(file));
    if (!entry) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return entry;
  };
  const writes = [], touches = [], unlinks = [];
  const calls = [], configs = [], logs = [];
  const record = (...args) => logs.push(args.join(' '));
  const stubs = {
    express: { Router: () => router }, path, axios: {},
    fs: { promises: {
      readdir: async () => [...store.keys()].filter(name => !name.includes('/')),
      readFile: async file => fileOf(file).raw,
      stat: async file => ({ mtime: new Date(fileOf(file).mtime) }),
      utimes: async (file, _atime, checkedAt) => { touches.push(relative(file)); fileOf(file).mtime = checkedAt.getTime(); },
      unlink: async (file) => { fileOf(file); unlinks.push(relative(file)); store.delete(relative(file)); },
      mkdir: async () => {},
    } },
    'write-file-atomic': async (file, value) => { writes.push(relative(file)); store.set(relative(file), { raw: value, mtime: now }); },
    '../utils/sourceRefresh': refreshModule.exports,
    '../utils/sourceCircuitBreaker': {
      ...realBreaker,
      createSourceCircuitBreaker: options => realBreaker.createSourceCircuitBreaker({ ...options, now: () => now }),
    },
    '../utils/cacheManager': { ANIME_SAMA_CACHE_DIR: CACHE_DIR, generateCacheKey: () => 'fixture-key' },
    '../config/redis': { memoryCache: { get: async () => undefined, set: async () => {} } },
    '../utils/embedExtraction': { buildM3u8Map: async () => ({}) },
    '../utils/animeSamaDeadPlayers': require('../../utils/animeSamaDeadPlayers'),
    '../utils/animeSamaPages': require('../../utils/animeSamaPages'),
    '../utils/animeSamaLinks': require('../../utils/animeSamaLinks'),
    '../utils/concurrency': require('../../utils/concurrency'),
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(ROUTE, 'utf8') +
    '\nmodule.exports.audit = { Season, Catalogue, seasonCircuit: animeSamaSeasonCircuit, animeRefresh, guardAnimeRefresh };', {
    require(name) {
      if (Object.hasOwn(stubs, name)) return stubs[name];
      throw new Error(`Dépendance non simulée : ${name}`);
    },
    module, exports: module.exports, __filename: ROUTE, __dirname: path.dirname(ROUTE),
    process: { env: {}, pid: 12345 }, console: { log: record, warn: record, error: record },
    Date: Clock, URL, URLSearchParams, Buffer, structuredClone, setTimeout, clearTimeout,
    setInterval: () => ({ unref() {} }), clearInterval() {},
  }, { filename: ROUTE, timeout: 5000 });
  const request = async (config) => { calls.push(config.url); configs.push(config); return site.respond(config.url); };
  const nameSlug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  module.exports.configure({
    ANIME_SAMA_URL: SITE,
    getFromCacheNoExpiration: async () => animes.map(entry => (typeof entry === 'string'
      ? { name: entry, url: `${SITE}catalogue/${nameSlug(entry)}/` }
      : entry)),
    axiosAnimeSamaRequest: request,
    cleanupOldCacheFiles: async () => {},
    migrateOldCacheFiles: async () => {},
    ...(deadPlayers ? { deadPlayerList: stubs['../utils/animeSamaDeadPlayers'].createDeadPlayerList({ request, now: () => now, logger: null }) } : {}),
    ...(lock ? { acquireRefreshLock: lock } : {}),
    ...(index ? { animeIndex: index } : {}),
    ...(firstScanWaitMs !== undefined ? { firstScanWaitMs } : {}),
  });
  const call = async (route, req) => {
    const res = { statusCode: 200, headers: {}, set(name, value) { this.headers[name.toLowerCase()] = value; return this; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = clone(body); return this; } };
    await routes.get(route)({ params: {}, query: {}, headers: {}, ...req }, res);
    return res;
  };
  const isLink = url => url.includes('/api/lien.php');
  const isFiche = url => /\/catalogue\/[^/]+\/$/.test(url);
  return {
    site, audit: module.exports.audit, calls, configs, logs, writes, touches, unlinks, store,
    search: () => call('get /search/:query', { params: { query: 'example' } }),
    byTmdb: (type, id, query = {}) => call('get /tmdb/:type/:id', { params: { type, id: String(id) }, query }),
    // Adresses d'un épisode, comme le site les demande au moment de la lecture.
    episode: (season, index, slug = 'example') => call('get /episode/:slug', { params: { slug }, query: { season, episode: String(index) } }),
    // Une actualisation complète : recherche, puis travail de fond terminé.
    async refresh() { const res = await this.search(); await settle(); return res; },
    linkCalls: () => calls.filter(isLink).map(url => new URL(url).searchParams.get('l')),
    pageCalls: () => calls.filter(url => !isLink(url) && !isFiche(url)).map(url => new URL(url).pathname.split('/').slice(3, 5).join('/')),
    ficheCalls: () => calls.filter(isFiche),
    title: slug => (store.has(`${TITLE_DIR}/${slug}.json`) ? JSON.parse(store.get(`${TITLE_DIR}/${slug}.json`).raw) : null),
    linkBook: slug => (store.has(`${LINKS_DIR}/${slug}.json`) ? JSON.parse(store.get(`${LINKS_DIR}/${slug}.json`).raw) : null),
    failures: () => logs.filter(line => line.includes('échouée')),
    forget() { calls.length = 0; configs.length = 0; writes.length = 0; touches.length = 0; unlinks.length = 0; logs.length = 0; },
  };
}

// Par épisode et par langue : [langue, lecteurs en attente d'adresse, ...adresses connues].
const linksView = links => links.map(link => [link.language, link.pending || 0, ...link.players]);
const view = seasons => seasons.map(season => season.episodes.map(episode => linksView(episode.streaming_links)));
const playersOf = seasons => seasons.map(season => season.episodes.map(episode => episode.streaming_links.map(link => [link.language, ...link.players])));
// Cache d'une œuvre déjà actualisée.
const titleFile = (seasons, { ageMs = 2 * HOUR } = {}) => ({ data: { timestamp: now - ageMs, lastCheckedAt: now - ageMs, seasons }, mtime: now - ageMs });
const episodeOf = (index, links) => ({ name: `Episode ${index}`, serie_name: 'Example', season_name: 'Saison 1', index, streaming_links: links });

test('une œuvre jamais vue : la fiche et une page par saison et par langue, aucune adresse demandée ; chaque épisode est listé', async () => {
  const site = createSite();
  site.fiche = ['panneauAnime("Saison 1", "saison1/vostfr");', 'panneauAnime("Films", "film/vf");'];
  site.links = {
    1: 'https://ansembed.invalid/embed-1.html', 2: 'https://uqload.invalid/embed-2.html', 3: 'https://ansembed.invalid/embed-3.html',
    4: 'https://sendvid.invalid/embed/4', 11: 'https://ansembed.invalid/embed-vf1.html', 21: 'https://ansembed.invalid/film.html',
    9: 'https://supprimee.invalid/9',
  };
  // eps1 = lecteur 1 de chaque épisode, eps2 = lecteur 2… ; une case vide = pas de lecteur.
  site.pages['saison1/vostfr'] = { langs: ['vostfr', 'vf'], token: 'j-vostfr', eps: [['lien:1', 'lien:3'], ['lien:2', 'lien:9'], ['', 'lien:4']], removed: { 9: 2 } };
  site.pages['saison1/vf'] = { langs: ['vostfr', 'vf'], token: 'j-vf', eps: [['lien:11']] };
  site.pages['film/vf'] = { langs: ['vf'], token: 'j-film', eps: [['lien:21']] };
  const h = loadAnimeSama({ site });

  assert.deepEqual((await h.search()).body[0].seasons, [], 'rien en cache : la première réponse est vide');
  await settle();

  assert.deepEqual(h.ficheCalls(), [`${SITE}catalogue/example/`]);
  assert.deepEqual(h.pageCalls(), ['saison1/vostfr', 'saison1/vf', 'film/vf'], 'langue annoncée, puis les autres langues publiées');
  assert.deepEqual(h.linkCalls(), [], 'aucune adresse demandée pendant l’actualisation');
  assert.deepEqual(h.failures(), []);

  const { body } = await h.search(); await settle();
  assert.equal(body[0].slug, 'example');
  assert.deepEqual(body[0].seasons.map(season => [season.name, season.path]), [['Saison 1', 'saison1'], ['Films', 'film']]);
  // Le lien supprimé (9) et la case vide ne comptent pas ; aucun épisode ne manque.
  assert.deepEqual(view(body[0].seasons), [
    [[['vostfr', 2], ['vf', 1]], [['vostfr', 2]]],
    [[['vf', 1]]],
  ]);
  assert.deepEqual(body[0].seasons[0].episodes.map(episode => [episode.index, episode.name]), [[1, 'Episode 1'], [2, 'Episode 2']]);
});

test('lecture d’un épisode : ses adresses sont demandées une fois, comme le fait le lecteur du site, puis servies sans requête', async () => {
  const site = createSite();
  site.links = {
    1: 'https://ansembed.invalid/embed-1.html', 2: 'https://uqload.invalid/embed-2.html', 3: 'https://ansembed.invalid/embed-3.html',
    4: 'https://sendvid.invalid/embed/4', 11: 'https://ansembed.invalid/embed-vf1.html',
  };
  site.pages['saison1/vostfr'] = { langs: ['vostfr', 'vf'], token: 'j-vostfr', eps: [['lien:1', 'lien:3'], ['lien:2', 'lien:4']] };
  site.pages['saison1/vf'] = { langs: ['vostfr', 'vf'], token: 'j-vf', eps: [['lien:11']] };
  const h = loadAnimeSama({ site });
  await h.refresh();
  h.forget();

  const first = await h.episode('saison1', 1);
  assert.equal(first.statusCode, 200);
  assert.deepEqual(linksView(first.body.streaming_links), [
    ['vostfr', 0, 'https://ansembed.invalid/embed-1.html', 'https://uqload.invalid/embed-2.html'],
    ['vf', 0, 'https://ansembed.invalid/embed-vf1.html'],
  ], 'lecteurs dans l’ordre du site');
  assert.equal(first.body.limited, undefined);
  assert.deepEqual(h.linkCalls().sort(), ['1', '11', '2'], 'seulement les liens de cet épisode');
  // Sans ces en-têtes, /api/lien.php répond 403 {"erreur":"origine"}.
  const linkCall = h.configs.find(config => config.url.includes('l=11'));
  assert.equal(new URL(linkCall.url).searchParams.get('j'), 'j-vf', 'le jeton de la page qui liste le lien');
  assert.equal(linkCall.headers.Referer, `${SITE}catalogue/example/saison1/vf/`);
  assert.equal(linkCall.headers['Sec-Fetch-Site'], 'same-origin');
  assert.notEqual(linkCall.headers['Sec-Fetch-Mode'], 'navigate');

  // Deuxième lecture, puis la liste : plus aucune requête vers anime-sama.
  h.forget();
  assert.deepEqual((await h.episode('saison1', 1)).body.streaming_links, first.body.streaming_links);
  assert.deepEqual(view((await h.search()).body[0].seasons), [[
    [['vostfr', 0, 'https://ansembed.invalid/embed-1.html', 'https://uqload.invalid/embed-2.html'], ['vf', 0, 'https://ansembed.invalid/embed-vf1.html']],
    [['vostfr', 2]],
  ]]);
  await settle();
  assert.deepEqual(h.calls, []);

  // Deux visiteurs ouvrent le même épisode en même temps : une seule demande par lien.
  const [a, b] = await Promise.all([h.episode('saison1', 2), h.episode('saison1', 2)]);
  assert.deepEqual(h.linkCalls().sort(), ['3', '4']);
  assert.deepEqual(a.body.streaming_links, b.body.streaming_links);
  assert.deepEqual(linksView(a.body.streaming_links), [['vostfr', 0, 'https://ansembed.invalid/embed-3.html', 'https://sendvid.invalid/embed/4']]);

  // Épisode, saison ou œuvre inconnus du cache : 404 sans rien demander au site.
  h.forget();
  for (const [season, index, slug] of [['saison1', 9], ['saison9', 1], ['saison1', 1, 'inconnue']]) {
    assert.equal((await h.episode(season, index, slug)).statusCode, 404, `${slug || 'example'}/${season}/${index}`);
  }
  for (const [season, index, slug] of [['../saison1', 1], ['saison1', 0], ['saison1', 'abc'], ['saison1', 1, '../etc'], ['', 1]]) {
    assert.equal((await h.episode(season, index, slug)).statusCode, 400, `${slug || 'example'}/${season}/${index}`);
  }
  assert.deepEqual(h.calls, []);
});

test('l’heure d’après : les pages sont relues, aucune adresse n’est demandée, rien n’est réécrit ; un nouvel épisode arrive en attente', async () => {
  const site = createSite();
  simpleSeason(site, 'saison1', ['vostfr', 'vf'], 3);
  const h = loadAnimeSama({ site });
  await h.refresh();
  await h.episode('saison1', 1);

  // Rien de neuf sur le site.
  now += 2 * HOUR; h.forget();
  await h.refresh();
  assert.equal(h.ficheCalls().length, 1);
  assert.deepEqual(h.pageCalls(), ['saison1/vostfr', 'saison1/vf']);
  assert.deepEqual(h.linkCalls(), []);
  assert.deepEqual(h.writes, [], 'ni le cache ni le carnet de liens ne sont réécrits');
  assert.equal(h.touches.length, 1, 'seule la date de vérification avance');

  // Avant l'heure : aucune requête du tout.
  now += 10 * 60 * 1000; h.forget();
  await h.refresh();
  assert.deepEqual(h.calls, []);

  // Un épisode sort en VOSTFR : listé tout de suite, son adresse reste à demander.
  now += 2 * HOUR; h.forget();
  site.links[50] = 'https://a.invalid/saison1/vostfr/4';
  site.pages['saison1/vostfr'].eps[0].push('lien:50');
  await h.refresh();
  assert.deepEqual(h.linkCalls(), []);
  const { body } = await h.search(); await settle();
  assert.equal(body[0].seasons[0].episodes.length, 4);
  assert.deepEqual(linksView(body[0].seasons[0].episodes[3].streaming_links), [['vostfr', 1]]);
  assert.deepEqual(linksView(body[0].seasons[0].episodes[0].streaming_links), [
    ['vostfr', 0, 'https://a.invalid/saison1/vostfr/1'], ['vf', 0, 'https://a.invalid/saison1/vf/1'],
  ], 'les adresses déjà connues restent servies');
});

test('une vidéo supprimée puis remise, ou déplacée chez un autre hébergeur, est demandée de nouveau', async () => {
  const site = createSite();
  site.links = { 1: 'https://a.invalid/1', 2: 'https://b.invalid/2' };
  site.pages['saison1/vostfr'] = { langs: ['vostfr'], token: 'j', eps: [['lien:1'], ['lien:2']], removed: { 2: 1 } };
  const h = loadAnimeSama({ site });
  await h.refresh();
  assert.deepEqual(linksView((await h.episode('saison1', 1)).body.streaming_links), [['vostfr', 0, 'https://a.invalid/1']]);
  assert.deepEqual(h.linkCalls(), ['1'], 'la vidéo supprimée n’est pas demandée');

  // La vidéo 2 est remise en ligne ; la vidéo 1 change d'hébergeur sans changer de n°.
  now += 2 * HOUR; h.forget();
  delete site.pages['saison1/vostfr'].removed;
  site.links[1] = 'https://c.invalid/1-bis';
  await h.refresh();
  assert.deepEqual(view((await h.search()).body[0].seasons), [[[['vostfr', 2]]]], 'l’ancienne adresse n’est plus servie');
  await settle();
  assert.deepEqual(linksView((await h.episode('saison1', 1)).body.streaming_links), [['vostfr', 0, 'https://c.invalid/1-bis', 'https://b.invalid/2']]);
  assert.deepEqual(h.linkCalls().sort(), ['1', '2']);
});

test('un cache d’avant le 12/11 garde ses adresses sans rien redemander ; seuls les lecteurs nouveaux restent à demander', async () => {
  const site = createSite();
  site.links = { 1: 'https://a.invalid/v1', 2: 'https://video.b.invalid/v2', 3: 'https://c.invalid/v3', 4: 'https://a.invalid/v4' };
  // Épisode 1 : lecteurs 1, 2 et 3 (le 3 est nouveau). Épisode 2 : lecteur 4.
  site.pages['saison1/vostfr'] = { langs: ['vostfr'], token: 'j', eps: [['lien:1', 'lien:4'], ['lien:2'], ['lien:3']], hosts: { 2: 'b.invalid' } };
  // Même œuvre, nom écrit comme la recherche d'anime-sama le rend (entité HTML).
  const animes = [{ name: 'L&#039;Example', url: `${SITE}catalogue/example` }];
  const legacy = { timestamp: now - 2 * HOUR, seasons: { 'Saison 1': { timestamp: now - 2 * HOUR, episodes: [
    episodeOf(1, [{ language: 'vostfr', players: ['https://a.invalid/ancien1', 'https://video.b.invalid/ancien2'] }]),
    episodeOf(2, [{ language: 'vostfr', players: ['https://a.invalid/ancien4'] }]),
  ] } } };
  const h = loadAnimeSama({ site, animes, files: { 'L039Example.json': { data: legacy } } });

  const first = await h.search();
  assert.equal(first.body[0].seasons[0].episodes.length, 2, 'le cache d’avant est servi tout de suite');
  await settle();
  assert.deepEqual(h.linkCalls(), [], 'aucune adresse redemandée');
  assert.equal(h.title('example').seasons['Saison 1'].episodes.length, 2);
  assert.deepEqual(h.unlinks, ['L039Example.json'], 'l’ancien fichier, rangé par nom, est retiré');
  assert.deepEqual(h.failures(), []);

  const second = await h.search(); await settle();
  assert.deepEqual(view(second.body[0].seasons), [[
    [['vostfr', 1, 'https://a.invalid/ancien1', 'https://video.b.invalid/ancien2']],
    [['vostfr', 0, 'https://a.invalid/ancien4']],
  ]]);

  h.forget();
  assert.deepEqual(linksView((await h.episode('saison1', 1)).body.streaming_links), [
    ['vostfr', 0, 'https://a.invalid/ancien1', 'https://video.b.invalid/ancien2', 'https://c.invalid/v3'],
  ]);
  assert.deepEqual(h.linkCalls(), ['3']);
});

test('un lien inconnu du site est laissé de côté sans rien casser', async () => {
  const site = createSite();
  site.links = { 1: 'https://a.invalid/1' };
  site.pages['saison1/vostfr'] = { langs: ['vostfr'], token: 'j', eps: [['lien:1'], ['lien:404']], hosts: { 404: 'b.invalid' } };
  const h = loadAnimeSama({ site });
  await h.refresh();
  const res = await h.episode('saison1', 1);
  assert.deepEqual(linksView(res.body.streaming_links), [['vostfr', 1, 'https://a.invalid/1']]);
  assert.equal(res.body.limited, undefined);
  assert.deepEqual(h.logs.filter(line => /échou|Adresses de/.test(line)), []);
  assert.equal(h.audit.seasonCircuit.snapshot().failures, 0, 'un 404 de lien.php est une réponse, pas une panne');
});

test('jeton refusé : la page est relue une fois pour en prendre un neuf ; refusé encore, la lecture répond quand même', async () => {
  const site = createSite();
  simpleSeason(site, 'saison1', ['vostfr'], 3);
  const page = site.pages['saison1/vostfr'];
  // La page sert un jeton que lien.php refuse, puis un jeton valable à la relecture.
  page.token = 'perime'; page.accepts = ['neuf'];
  site.fail = (kind, key) => { if (kind === 'page' && site.pageReads[key] >= 3) page.token = 'neuf'; return null; };
  const h = loadAnimeSama({ site });
  await h.refresh();
  const res = await h.episode('saison1', 1);
  assert.equal(site.pageReads['saison1/vostfr'], 3, 'l’actualisation, la lecture, puis une seule relecture');
  assert.deepEqual(linksView(res.body.streaming_links), [['vostfr', 0, 'https://a.invalid/saison1/vostfr/1']]);
  assert.equal(h.audit.seasonCircuit.isOpen(), false, 'un jeton refusé n’ouvre pas le disjoncteur');

  // Jeton toujours refusé : l'épisode reste listé, ses adresses restent à demander.
  const stuck = createSite();
  simpleSeason(stuck, 'saison1', ['vostfr'], 3);
  stuck.pages['saison1/vostfr'].accepts = ['jamais'];
  const kept = loadAnimeSama({ site: stuck });
  await kept.refresh();
  const refused = await kept.episode('saison1', 1);
  assert.equal(refused.statusCode, 200);
  assert.equal(stuck.pageReads['saison1/vostfr'], 3);
  assert.deepEqual(linksView(refused.body.streaming_links), [['vostfr', 1]]);
  assert.equal(refused.body.limited, true);
  assert.equal(kept.audit.seasonCircuit.snapshot().failures, 0);
});

test('quota de lien.php dépassé : les adresses reçues sont gardées, plus aucune demande pendant la pause, reprise ensuite', async () => {
  const site = createSite();
  site.links = { 1: 'https://a.invalid/1', 2: 'https://b.invalid/2', 3: 'https://c.invalid/3', 4: 'https://a.invalid/4', 5: 'https://b.invalid/5' };
  site.pages['saison1/vostfr'] = { langs: ['vostfr'], token: 'j', eps: [['lien:1', 'lien:4'], ['lien:2', 'lien:5'], ['lien:3']] };
  const h = loadAnimeSama({ site });
  await h.refresh();
  site.fail = (kind, key) => (kind === 'link' && key === '2' ? httpError(429, '{"erreur":"trop"}') : null);

  const cut = await h.episode('saison1', 1);
  assert.equal(cut.statusCode, 200);
  assert.equal(cut.body.limited, true);
  assert.deepEqual(linksView(cut.body.streaming_links), [['vostfr', 1, 'https://a.invalid/1', 'https://c.invalid/3']]);
  assert.deepEqual(Object.keys(h.linkBook('example')).sort(), ['1', '3'], 'les adresses reçues avant le refus sont notées');
  assert.equal(h.audit.seasonCircuit.snapshot().failures, 0, 'le site répond : ce n’est pas une panne');
  assert.equal(h.logs.filter(line => line.includes('limite le débit')).length, 1);

  // Pendant la pause : aucune requête, même pour un autre épisode.
  h.forget();
  const paused = await h.episode('saison1', 2);
  assert.equal(paused.body.limited, true);
  assert.deepEqual(linksView(paused.body.streaming_links), [['vostfr', 2]]);
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.logs, []);

  // Une minute plus tard : seul ce qui manquait est demandé.
  now += 60001; site.fail = () => null;
  const back = await h.episode('saison1', 1);
  assert.equal(back.body.limited, undefined);
  assert.deepEqual(linksView(back.body.streaming_links), [['vostfr', 0, 'https://a.invalid/1', 'https://b.invalid/2', 'https://c.invalid/3']]);
  assert.deepEqual(h.linkCalls(), ['2']);
});

test('panne de lien.php pendant une lecture : adresses reçues gardées, réponse servie, essai suivant sans attendre', async () => {
  const site = createSite();
  site.links = { 1: 'https://a.invalid/1', 2: 'https://b.invalid/2' };
  site.pages['saison1/vostfr'] = { langs: ['vostfr'], token: 'j', eps: [['lien:1'], ['lien:2']] };
  const h = loadAnimeSama({ site });
  await h.refresh();
  site.fail = (kind, key) => (kind === 'link' && key === '2' ? httpError(503, '<html>Service Unavailable</html>') : null);

  const res = await h.episode('saison1', 1);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.limited, true);
  assert.deepEqual(linksView(res.body.streaming_links), [['vostfr', 1, 'https://a.invalid/1']]);
  assert.equal(h.logs.filter(line => line.includes('HTTP 503')).length, 1);
  assert.equal(h.audit.seasonCircuit.snapshot().failures, 1, 'une vraie panne compte pour le disjoncteur');

  h.forget(); site.fail = () => null;
  assert.deepEqual(linksView((await h.episode('saison1', 1)).body.streaming_links), [['vostfr', 0, 'https://a.invalid/1', 'https://b.invalid/2']]);
  assert.deepEqual(h.linkCalls(), ['2']);
});

test('une lecture d’épisode pendant une actualisation ne perd aucune adresse du carnet', async () => {
  const site = createSite();
  simpleSeason(site, 'saison1', ['vostfr'], 2);
  const h = loadAnimeSama({ site });
  await h.refresh();

  // L'actualisation suivante reste bloquée sur la fiche pendant qu'un visiteur lit l'épisode 1.
  now += 2 * HOUR;
  const gate = deferred();
  site.fail = async (kind) => { if (kind === 'fiche') await gate.promise; return null; };
  await h.search(); await settle();
  assert.deepEqual(linksView((await h.episode('saison1', 1)).body.streaming_links), [['vostfr', 0, 'https://a.invalid/saison1/vostfr/1']]);
  gate.resolve(); await settle();

  assert.deepEqual(Object.keys(h.linkBook('example')), ['1']);
  h.forget();
  assert.deepEqual(view((await h.search()).body[0].seasons), [[[['vostfr', 0, 'https://a.invalid/saison1/vostfr/1']], [['vostfr', 1]]]]);
  await settle();
  assert.deepEqual(h.linkCalls(), []);
});

test('trois pannes d’affilée mettent la source en pause : plus aucune requête, aucun échec rejoué, cache servi', async () => {
  const site = createSite();
  simpleSeason(site, 'saison1', ['vostfr'], 1);
  site.fail = kind => (kind === 'page' ? httpError(403, '<html class="cf-wrapper">Just a moment...</html>') : null);
  const animes = ['Anime A', 'Anime B', 'Anime C', 'Anime D'];
  const cached = { 'Saison 1': { timestamp: now, episodes: [episodeOf(1, [{ language: 'vostfr', players: ['https://ancien.invalid/1'] }])] } };
  const files = Object.fromEntries(animes.map(name => [`${TITLE_DIR}/${name.toLowerCase().replace(' ', '-')}.json`, titleFile(cached)]));
  const h = loadAnimeSama({ site, animes, files });

  const { body } = await h.search(); await settle();
  assert.equal(body.length, 4);
  assert(body.every(anime => anime.seasons[0].episodes.length === 1), 'le cache reste servi');
  assert.equal(h.ficheCalls().length, 3, 'la quatrième œuvre ne lit même pas sa fiche');
  assert.deepEqual(h.pageCalls(), ['saison1/vostfr', 'saison1/vostfr', 'saison1/vostfr'], 'une seule page lue par œuvre bloquée');
  assert.equal(h.audit.seasonCircuit.isOpen(), true);
  assert.equal(h.failures().length, 3);
  assert.deepEqual(h.writes, []);
  assert.deepEqual(h.touches, []);

  // Pendant la pause : ni requête ni nouveau log.
  now += 60001; h.forget();
  await h.refresh();
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.logs, []);

  // La source répond de nouveau : chaque œuvre est revérifiée.
  now += 5 * 60 * 1000; site.fail = () => null;
  await h.refresh();
  assert.equal(h.ficheCalls().length, 4);
  assert.equal(h.audit.seasonCircuit.isOpen(), false);
  assert.deepEqual(h.failures(), []);
});

test('langues : la langue annoncée d’abord, puis celles que la page publie et celles du cache ; un échec passager n’en retire aucune', async () => {
  const site = createSite();
  site.fiche = ['panneauAnime("Saison 1", "saison1/vf");'];
  site.links = { 1: 'https://a.invalid/vf', 2: 'https://a.invalid/vostfr', 3: 'https://a.invalid/vj' };
  // Table en retard sur le site : la VJ, pourtant en cache, n'y figure pas ;
  // « vqc » est une langue que Movix ne connaît pas.
  for (const [lang, id] of [['vf', 1], ['vostfr', 2], ['vj', 3]]) {
    site.pages[`saison1/${lang}`] = { langs: ['vf', 'vostfr', 'vqc'], token: `j-${lang}`, eps: [[`lien:${id}`]] };
  }
  const cached = { 'Saison 1': { timestamp: now, episodes: [episodeOf(1, [
    { language: 'vostfr', players: ['https://a.invalid/vostfr'] },
    { language: 'vf', players: ['https://a.invalid/vf'] },
    { language: 'vj', players: ['https://a.invalid/vj'] },
  ])] } };
  const h = loadAnimeSama({ site, files: { [`${TITLE_DIR}/example.json`]: titleFile(cached) } });
  const gate = deferred();
  site.fail = async (kind, key) => { if (kind === 'page' && key === 'saison1/vf') await gate.promise; return null; };

  await h.search(); await settle();
  assert.deepEqual(h.pageCalls(), ['saison1/vf'], 'la langue annoncée est lue seule : un blocage arrête tout');
  gate.resolve(); await settle();
  assert.deepEqual(h.pageCalls().slice(1).sort(), ['saison1/vj', 'saison1/vostfr']);
  assert.deepEqual(playersOf((await h.search()).body[0].seasons), [[[
    ['vostfr', 'https://a.invalid/vostfr'], ['vf', 'https://a.invalid/vf'], ['vj', 'https://a.invalid/vj'],
  ]]], 'les langues sortent dans l’ordre habituel');
  await settle();

  // La page VJ ne répond plus (délai) : l'actualisation échoue, la VJ reste.
  now += 2 * HOUR; h.forget();
  site.fail = (kind, key) => (kind === 'page' && key === 'saison1/vj' ? timeoutError() : null);
  await h.refresh();
  assert.equal(h.failures().length, 1);
  assert.deepEqual(h.writes, []);
  assert.equal((await h.search()).body[0].seasons[0].episodes[0].streaming_links.length, 3);
  await settle();
});

test('une saison vidée par le site quitte le cache ; une saison illisible garde le sien sans bloquer les autres', async () => {
  const site = createSite();
  site.fiche = ['panneauAnime("Saison 1", "saison1/vostfr");', 'panneauAnime("Saison 2", "saison2/vostfr");', 'panneauAnime("Saison 3", "saison3/vostfr");'];
  // Saison 1 : la page existe mais n'a plus aucun épisode (saison masquée,
  // « Bientôt de retour »). Saison 2 : page introuvable. Saison 3 : normale.
  site.pages['saison1/vostfr'] = { langs: ['vostfr'], token: null, eps: [] };
  simpleSeason(site, 'saison3', ['vostfr'], 2, { firstId: 30 });
  const old = name => ({ timestamp: now, episodes: [{ name: 'Episode 1', serie_name: 'Example', season_name: name, index: 1, streaming_links: [{ language: 'vostfr', players: [`https://ancien.invalid/${name}`] }] }] });
  const h = loadAnimeSama({ site, files: { [`${TITLE_DIR}/example.json`]: titleFile({ 'Saison 1': old('Saison 1'), 'Saison 2': old('Saison 2'), 'Saison 3': old('Saison 3') }) } });

  await h.refresh();
  assert.deepEqual(h.failures(), [], 'aucun échec journalisé');
  assert(h.logs.some(line => line.includes('Saison 1') && line.includes('vidée par anime-sama')));
  assert(h.logs.some(line => line.includes('Saison 2') && line.includes('illisible')));
  const { body } = await h.search(); await settle();
  assert.deepEqual(body[0].seasons.map(season => [season.name, season.episodes.length]), [['Saison 2', 1], ['Saison 3', 2]]);
  assert.deepEqual(body[0].seasons[0].episodes[0].streaming_links[0].players, ['https://ancien.invalid/Saison 2']);

  // Une page de saison qui n'en est pas une (erreur servie en 200) ne vide rien non plus.
  now += 2 * HOUR; h.forget();
  site.pages['saison3/vostfr'] = { html: '<!doctype html><html><title>Erreur</title></html>' };
  await h.refresh();
  assert.deepEqual(h.failures(), []);
  assert.deepEqual((await h.search()).body[0].seasons.map(season => [season.name, season.episodes.length]), [['Saison 2', 1], ['Saison 3', 2]]);
  await settle();
});

test('fiche sans anime (saisons masquées, scans seuls) : le cache est vidé sans échec ; fiche cassée : il est gardé', async () => {
  const cached = { 'Saison 1': { timestamp: now, episodes: [episodeOf(1, [{ language: 'vostfr', players: ['https://ancien.invalid/1'] }])] } };
  const seeded = () => ({ [`${TITLE_DIR}/example.json`]: titleFile(cached) });
  const cases = [
    // Danshi Koukousei no Nichijou : la seule saison est en commentaire.
    ['saison masquée', ['<!--panneauAnime("Saison 1", "saison1/vostfr");-->']],
    // The Gamer : une œuvre en scans, sans anime.
    ['scans seuls', ['panneauScan("Scans", "scan/vf");']],
  ];
  for (const [label, fiche] of cases) {
    const site = createSite();
    site.fiche = fiche;
    const h = loadAnimeSama({ site, files: seeded() });
    await h.refresh();
    assert.deepEqual(h.failures(), [], `${label} : aucun échec journalisé`);
    assert.deepEqual(h.pageCalls(), [], `${label} : aucune page de saison lue`);
    assert.deepEqual((await h.search()).body[0].seasons, [], `${label} : plus rien n’est servi`);
    await settle();

    // Les recherches suivantes ne relisent rien avant une heure, et ne logguent plus rien.
    h.forget();
    await h.refresh();
    assert.deepEqual(h.calls, [], label);
    assert.deepEqual(h.logs, [], label);
  }

  for (const [label, page] of [
    ['page introuvable servie en 200', '<!doctype html><html><title>Page introuvable</title></html>'],
    ['page de vérification', '<html><body class="cf-wrapper">Just a moment...</body></html>'],
  ]) {
    const site = createSite();
    site.fiche = page;
    const h = loadAnimeSama({ site, files: seeded() });
    await h.refresh();
    assert.equal(h.failures().length, 1, `${label} : l’échec est journalisé`);
    assert.deepEqual(h.writes, [], label);
    assert.equal((await h.search()).body[0].seasons[0].episodes.length, 1, `${label} : le cache reste servi`);
    await settle();
  }
});

test('un hébergeur marqué hors service n’est ni demandé, ni servi, ni compté en attente', async () => {
  const site = createSite();
  site.links = { 1: 'https://video.sibnet.ru/shell.php?videoid=1', 2: 'https://ansembed.invalid/embed-a.html', 3: 'https://lecteur.mort.invalid/e/3', 4: 'https://ansembed.invalid/embed-b.html' };
  // Sibnet vient du relevé de secours ; mort.invalid seulement de la table de la page.
  const infos = { 'ansembed.invalid': { nom: 'Vidmoly' }, 'mort.invalid': { nom: 'Mort', mort: true }, 'sibnet.ru': { nom: 'Sibnet', mort: true } };
  site.pages['saison1/vostfr'] = { langs: ['vostfr'], token: 'j', infos, eps: [['lien:1', 'lien:3'], ['lien:2', 'lien:4']] };
  const h = loadAnimeSama({ site, deadPlayers: true });
  await h.refresh();
  assert.deepEqual(view((await h.search()).body[0].seasons), [[[['vostfr', 1]], [['vostfr', 1]]]]);
  await settle();
  assert.deepEqual(linksView((await h.episode('saison1', 1)).body.streaming_links), [['vostfr', 0, 'https://ansembed.invalid/embed-a.html']]);
  assert.deepEqual(linksView((await h.episode('saison1', 2)).body.streaming_links), [['vostfr', 0, 'https://ansembed.invalid/embed-b.html']]);
  assert.deepEqual(h.linkCalls().sort(), ['2', '4']);

  // Cache écrit avant ce filtre : servi sans ses lecteurs hors service, et une
  // langue sans lecteur vivant disparaît.
  const cached = { 'Saison 1': { timestamp: now, episodes: [
    episodeOf(1, [{ language: 'vostfr', players: ['https://video.sibnet.ru/shell.php?videoid=1', 'https://ansembed.invalid/embed-a.html'] }, { language: 'vf', players: ['https://oneupload.to/embed-x.html'] }]),
    episodeOf(2, [{ language: 'vostfr', players: ['https://video.sibnet.ru/shell.php?videoid=2'] }]),
  ] } };
  const served = loadAnimeSama({ site, files: { [`${TITLE_DIR}/example.json`]: titleFile(cached, { ageMs: 1000 }) } });
  assert.deepEqual(playersOf((await served.search()).body[0].seasons), [[[['vostfr', 'https://ansembed.invalid/embed-a.html']]]]);
  await settle();
});

test('les épisodes prennent les numéros affichés par le site', async () => {
  const site = createSite();
  simpleSeason(site, 'saison1', ['vostfr'], 3);
  // Extrait de la page One Piece saison 2 : un modèle par défaut, le mode
  // d'emploi en commentaire, puis la vraie liste.
  site.pages['saison1/vostfr'].list = [
    '<script>$(document).ready(function(){',
    '  resetListe();',
    '  finirListe(1);',
    '});</script>',
    '<script>$(document).ready(function(){',
    '  /*',
    '  resetListe(); toujours au debut en premier',
    "  creerListe(debut, fin);newSP(special); on en met autant qu'on veut",
    '  */',
    '  resetListe();',
    '  creerListe(62, 64);',
    '});</script>',
  ].join('\n');
  const h = loadAnimeSama({ site });
  await h.refresh();
  assert.deepEqual((await h.search()).body[0].seasons[0].episodes.map(episode => [episode.index, episode.name]), [[1, 'Episode 62'], [2, 'Episode 63'], [3, 'Episode 64']]);
  await settle();
});

test('une œuvre déjà en cours d’actualisation par un autre worker n’est pas relue ; le verrou rendu, elle l’est', async () => {
  const site = createSite();
  simpleSeason(site, 'saison1', ['vostfr'], 2);
  const lockKeys = [];
  let held = true;
  let released = 0;
  const lock = async (key) => { lockKeys.push(key); return held ? null : { renew: async () => true, release: async () => { released += 1; } }; };
  const h = loadAnimeSama({ site, lock });

  await h.refresh();
  assert.deepEqual(h.calls, [], 'aucune requête vers anime-sama');
  assert.deepEqual(h.failures(), []);
  assert.equal(lockKeys.length, 1);
  assert(lockKeys[0].includes('example'), 'un verrou par œuvre');

  // Pas mémorisé comme « vérifié » : la recherche suivante réessaie aussitôt.
  held = false;
  await h.refresh();
  assert.deepEqual(h.pageCalls(), ['saison1/vostfr']);
  assert.equal(released, 1, 'le verrou est rendu à la fin');

  // Rendu aussi quand l'actualisation échoue.
  now += 2 * HOUR; site.fail = kind => (kind === 'fiche' ? timeoutError() : null);
  await h.refresh();
  assert.equal(h.failures().length, 1);
  assert.equal(released, 2);
});

test('recherche par ID TMDB : l’œuvre que la fiche d’anime-sama relie à cet ID, avec son cache', async () => {
  const site = createSite();
  simpleSeason(site, 'saison1', ['vostfr'], 2);
  const asked = [];
  const index = { findByTmdb: async (type, id) => {
    asked.push([type, id]);
    return type === 'tv' && id === 320909 ? [{ slug: 'example', name: 'Example', altNames: ['Autre nom', 'Encore'], image: 'https://img.invalid/example.jpg' }] : [];
  } };
  // Une œuvre jamais ouverte : la réponse attend la première lecture du site.
  const h = loadAnimeSama({ site, index, firstScanWaitMs: 5000 });

  const found = await h.byTmdb('tv', 320909);
  assert.equal(found.statusCode, 200);
  assert.deepEqual(asked, [['tv', 320909]]);
  assert.equal(found.body.length, 1);
  assert.equal(found.body[0].name, 'Example');
  assert.equal(found.body[0].slug, 'example');
  assert.equal(found.body[0].url, `${SITE}catalogue/example/`);
  assert.deepEqual(found.body[0].alternative_names, ['Autre nom', 'Encore']);
  assert.deepEqual(view(found.body[0].seasons), [[[['vostfr', 1]], [['vostfr', 1]]]]);
  await settle();

  // Même cache que la recherche par nom : rien n'est relu ni redemandé.
  h.forget();
  assert.equal((await h.search()).body[0].seasons[0].episodes.length, 2);
  await settle();
  assert.deepEqual(h.calls, []);

  assert.deepEqual((await h.byTmdb('tv', 1)).body, [], 'ID inconnu de l’index : liste vide');
  assert.deepEqual((await h.byTmdb('movie', 320909)).body, [], 'le type compte');
  for (const [type, id] of [['person', 1], ['tv', 'abc'], ['tv', '0'], ['tv', '12.5'], ['tv', '-3']]) {
    assert.equal((await h.byTmdb(type, id)).statusCode, 400, `${type}/${id}`);
  }
  await settle();
});

test('recherche par ID TMDB : sans index, index en panne ou slug douteux, la réponse est une liste vide', async () => {
  const none = loadAnimeSama({});
  assert.deepEqual((await none.byTmdb('tv', 5)).body, []);

  const down = loadAnimeSama({ index: { findByTmdb: async () => { throw new Error('ECONNREFUSED'); } } });
  const res = await down.byTmdb('tv', 5);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, []);

  // Un slug ne sort jamais du dossier du cache.
  const odd = loadAnimeSama({ index: { findByTmdb: async () => [{ slug: '../../etc/passwd', name: 'X' }, { slug: '', name: 'Y' }] }, firstScanWaitMs: 0 });
  assert.deepEqual((await odd.byTmdb('tv', 5)).body, []);
  await settle();
  assert.deepEqual(odd.calls, []);
});
