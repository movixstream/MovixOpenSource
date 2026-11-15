'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const cheerio = require('cheerio');
const { createWiflixRefreshState } = require('../../utils/wiflixRefreshState');
const good = { success: true, players: { vf: [{ url: 'https://cached.test/embed' }] } };

// `from` désigne la première section réelle de wiflix.js exécutée ; ce qui la
// précède et les autres modules sont simulés par le contexte et `globals`.
async function fixture(t, fetcher, { initial = good, from = '// === Background Cache Update ===', globals = {} } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wiflix-refresh-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'key.json');
  if (initial) {
    await fs.writeFile(file, JSON.stringify(initial));
    const old = new Date(Date.now() - 4 * 60 * 60 * 1000);
    await fs.utimes(file, old, old);
  }
  let time = Date.now(), calls = 0, writes = 0;
  const busy = new Set();
  const filename = path.resolve(__dirname, '../wiflix.js');
  const source = await fs.readFile(filename, 'utf8');
  const start = source.indexOf(from);
  const end = source.indexOf('// === Routes ===', start);
  assert.ok(start > 0 && end > start);
  const read = async () => { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; } };
  const scrape = async (_id, previous) => { calls++; return fetcher(previous); };
  const createWorker = () => {
    const context = vm.createContext({
      refreshState: createWiflixRefreshState({ now: () => time }),
      acquireRedisLock: async (name) => {
        if (busy.has(name)) return null;
        busy.add(name);
        return { renew: async () => true, release: async () => { busy.delete(name); } };
      },
      getFromCacheNoExpiration: async () => read(),
      // Priorité du débit global Flemmix : sans effet ici.
      runWithWiflixPriority: (_priority, work) => work(),
      isWiflixRateLimited: error => error?.code === 'WIFLIX_RATE_LIMITED',
      // Remplacés par les vraies fonctions quand la tranche les contient.
      fetchMovieData: scrape,
      fetchWiflixTvData: async (id, _season, previous) => scrape(id, previous),
      saveToCache: async (_dir, _key, data) => { writes++; await fs.writeFile(file, JSON.stringify(data)); return true; },
      reportRefreshFailure() {},
      redis: null,
      process: { env: {} },
      setInterval, clearInterval, setTimeout,
      console: { error() {}, warn() {} },
      ...globals,
    });
    vm.runInContext(source.slice(start, end) + '\nglobalThis.update = updateWiflixCache;', context, { filename });
    return (type = 'movie', key = 'key', options) => context.update(dir, key, type, '42', 1, options);
  };
  return { dir, file, read, createWorker, advance: ms => { time += ms; },
    counts: () => ({ calls, writes }), state: createWiflixRefreshState({ now: () => time }) };
}

const base = 'https://source.test';
const card = (title, href, season) => `<div class="mov"><a class="mov-t" href="${href}">${title}</a>${
  season ? `<div class="block-sai">Saison ${season}\n French</div>` : ''}</div>`;
// Deux fiches au titre exact de la requête (saison 1 pour une série).
function cards(query) {
  const title = query.replace(/ saison \d+$/, '');
  const slug = title.toLowerCase().replace(/\W+/g, '-');
  const season = title === query ? null : 1;
  return card(title, `/${slug}-a.html`, season) + card(`${title} (2020)`, `/${slug}-b.html`, season);
}
// Page de recherche du site sans résultat (formulaire du gabarit compris).
const emptySearch = '<form id="quicksearch" method="post"><input name="story"></form><p>Aucun résultat</p>';
const timeout = () => Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED' });
const circuitOpen = () => Object.assign(new Error('Source Flemmix en pause'), {
  code: 'SOURCE_CIRCUIT_OPEN', isSourceCircuitOpen: true, httpStatus: 503,
});

// Décodage des liens de lecteurs : défini avant les sections exécutées.
const linkHelpers = (() => {
  const source = require('node:fs').readFileSync(path.resolve(__dirname, '../wiflix.js'), 'utf8');
  const start = source.indexOf('function decodeWiflixStream');
  const end = source.indexOf('// === Cache helpers', start);
  assert.ok(start > 0 && end > start);
  const context = vm.createContext({ Buffer });
  vm.runInContext(source.slice(start, end)
    + '\nglobalThis.helpers = { decodeWiflixStream, wiflixLinkUrl, isSkippedWiflixHost };', context);
  return context.helpers;
})();

// Fraîcheur selon l'âge de la sortie et reconnaissance d'une page du site :
// définies en tête de wiflix.js.
const { wiflixFreshnessMs, isWiflixSitePage } = (() => {
  const source = require('node:fs').readFileSync(path.resolve(__dirname, '../wiflix.js'), 'utf8');
  const start = source.indexOf('const WIFLIX_NEGATIVE_REFRESH_MS');
  const end = source.indexOf('const refreshState', start);
  assert.ok(start > 0 && end > start);
  const context = vm.createContext({});
  vm.runInContext(source.slice(start, end)
    + '\nglobalThis.helpers = { wiflixFreshnessMs, isWiflixSitePage };', context);
  return context.helpers;
})();

// Chaîne réelle recherche → fiches → actualisation. Flemmix (recherche et
// fiches), TMDB, CineStream et la vérification d'identité sont simulés ; les
// appels sortants simulés sont comptés.
async function sourceFixture(t, { initial = good, search, page = () => '<h1>Fiche</h1>',
  verify = async () => ({ accepted: false, reason: 'identity_unconfirmed' }),
  cinestream = async () => ({ success: false }), globals = {} }) {
  const calls = { search: [], page: [], aliases: 0, verify: [] };
  const reports = [], steps = [], logs = [];
  const log = (...args) => logs.push(args.join(' '));
  const f = await fixture(t, null, {
    initial,
    from: '// === Utility Functions ===',
    globals: {
      cheerio, URL, ...linkHelpers, wiflixFreshnessMs, isWiflixSitePage,
      WIFLIX_BASE_URL: base, TMDB_API_URL: 'https://tmdb.test', TMDB_API_KEY: '',
      fetchTmdbDetails: async (_url, _key, id) => ({ id: Number(id), title: 'Titre français', name: 'Titre français' }),
      fetchTmdbSeason: async () => ({ air_date: '2020-01-01' }),
      createIdentityVerifier: () => ({
        titles: ['Titre français', 'Original title'],
        aliases: async () => { calls.aliases++; return ['Titre alternatif']; },
        verify: async (identity, options) => { calls.verify.push(options); return verify(identity, options); },
      }),
      searchTitles: titles => [...new Set(titles)],
      parseSourceIdentity: () => ({ titles: ['Titre français'], year: 2020 }),
      makeWiflixSearchRequest: async (_home, _url, options) => {
        const query = new URLSearchParams(options.data).get('story');
        calls.search.push(query);
        return { data: search(query) };
      },
      makeWiflixRequest: async url => { calls.page.push(url); return { data: page(url) }; },
      refreshStep: (stage, _details, error) => steps.push(`${stage}${error ? ` ${error.code}` : ''}`),
      reportRefreshFailure: reason => reports.push(reason),
      withRefreshDiagnostics: (_details, _redis, work) => work(),
      fetchCinestreamMovieData: cinestream,
      console: { log, info: log, warn: log, error: log },
      ...globals,
    },
  });
  return { ...f, calls, reports, steps, logs };
}

// Ancien cache intact (ou toujours absent), rien d'écrit, reprise différée.
async function assertDeferred(f, initial, label) {
  assert.deepEqual(await f.read(), initial, label);
  assert.equal(f.counts().writes, 0, label);
  assert.ok(await f.state.remaining(f.dir, 'key', initial) > 0, label);
}

test('un échec sur ancien succès ne relance pas un scrape dans un autre worker avant 60 secondes', async t => {
  const f = await fixture(t, async () => ({ success: false }));
  const before = (await fs.stat(f.file)).mtimeMs;
  const first = f.createWorker(), second = f.createWorker();
  await first();
  await second();
  assert.deepEqual(f.counts(), { calls: 1, writes: 0 });
  assert.deepEqual(await f.read(), good);
  assert.equal((await fs.stat(f.file)).mtimeMs, before);
  assert.ok(await f.state.remaining(f.dir, 'key', good) > 0);
  f.advance(61_000);
  await second();
  assert.deepEqual(f.counts(), { calls: 2, writes: 0 });
});

test('les exceptions et le repli sur le même objet conservent les liens et le délai', async t => {
  for (const fetcher of [async () => { throw new Error('timeout'); }, async previous => previous]) {
    const f = await fixture(t, fetcher);
    await f.createWorker()('tv');
    await f.createWorker()('tv');
    assert.deepEqual(f.counts(), { calls: 1, writes: 0 });
    assert.deepEqual(await f.read(), good);
  }
});

test('un succès après reprise supprime le délai et les lecteurs suivants ne rescrapent pas', async t => {
  let fail = true;
  const updated = { success: true, players: { vf: [{ url: 'https://new.test/embed' }] } };
  const f = await fixture(t, async () => fail ? { success: false } : updated);
  await f.createWorker()();
  f.advance(61_000);
  fail = false;
  await f.createWorker()();
  await f.createWorker()();
  assert.deepEqual(f.counts(), { calls: 2, writes: 1 });
  assert.deepEqual(await f.read(), updated);
  await assert.rejects(fs.stat(path.join(f.dir, 'key.retry')), { code: 'ENOENT' });
});

test('la fraîcheur est recontrôlée sous verrou et un cache négatif conserve ses trente minutes', async t => {
  const f = await fixture(t, async () => ({ success: false }), { initial: null });
  await f.createWorker()();
  // 20 min : avant 27 min (30 min − 10 %), le négatif est encore frais.
  f.advance(20 * 60 * 1000);
  await f.createWorker()();
  assert.deepEqual(f.counts(), { calls: 1, writes: 1 });
  await fs.writeFile(f.file, JSON.stringify(good));
  await f.createWorker()();
  assert.deepEqual(f.counts(), { calls: 1, writes: 1 });
});

test('deux workers concurrents ne lancent qu’un scrape', async t => {
  let release, started;
  const ready = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, async () => { started(); await gate; return { success: false }; });
  const first = f.createWorker()();
  await ready;
  await f.createWorker()();
  release();
  await first;
  assert.deepEqual(f.counts(), { calls: 1, writes: 0 });
});

test('une recherche en échec arrête l’examen : ni autre titre, ni alias, ni fiche', async t => {
  for (const type of ['movie', 'tv']) {
    const f = await sourceFixture(t, { search: () => { throw timeout(); } });
    await f.createWorker()(type);
    assert.equal(f.calls.search.length, 1, type);
    assert.equal(f.calls.page.length, 0, type);
    assert.equal(f.calls.aliases, 0, type);
    assert.ok(!f.reports.includes('content_not_found'), type);
    await assertDeferred(f, good, type);
  }
});

test('une fiche impossible à charger arrête l’examen des autres candidats et titres', async t => {
  for (const type of ['movie', 'tv']) {
    const f = await sourceFixture(t, { search: cards, page: () => { throw timeout(); } });
    await f.createWorker()(type);
    assert.equal(f.calls.search.length, 1, type);
    assert.equal(f.calls.page.length, 1, type);
    assert.equal(f.calls.aliases, 0, type);
    assert.ok(f.steps.includes('candidate_fetch_failed'), type);
    assert.ok(!f.reports.includes('content_not_found'), type);
    await assertDeferred(f, good, type);
  }
});

test('le coupe-circuit Flemmix reste une indisponibilité : reprise différée, jamais de cache négatif', async t => {
  for (const type of ['movie', 'tv']) {
    for (const initial of [good, null]) {
      const label = `${type} ${initial ? 'avec' : 'sans'} cache`;
      const f = await sourceFixture(t, { initial, search: () => { throw circuitOpen(); } });
      await f.createWorker()(type);
      assert.equal(f.calls.search.length, 1, label);
      assert.equal(f.calls.page.length, 0, label);
      assert.ok(f.steps.includes('search_error SOURCE_CIRCUIT_OPEN'), label);
      assert.ok(!f.reports.includes('content_not_found'), label);
      assert.ok(!f.logs.some(line => /WIFLIX (SEARCH|PLAYERS)/.test(line)), label);
      await assertDeferred(f, initial, label);
    }
    // Coupe-circuit ouvert entre la recherche et le chargement de la fiche.
    const f = await sourceFixture(t, { search: cards, page: () => { throw circuitOpen(); } });
    await f.createWorker()(type);
    assert.equal(f.calls.search.length, 1, type);
    assert.equal(f.calls.page.length, 1, type);
    assert.ok(!f.reports.includes('content_not_found'), type);
    assert.ok(!f.logs.some(line => line.includes('[WIFLIX PLAYERS] Echec')), type);
    await assertDeferred(f, good, type);
  }
});

test('une source qui répond sans fiche confirmée poursuit l’examen et signale content_not_found', async t => {
  for (const type of ['movie', 'tv']) {
    const suffix = type === 'tv' ? ' saison 1' : '';
    // Premier titre sans résultat, puis deux fiches refusées par titre.
    const f = await sourceFixture(t, {
      search: query => query.startsWith('Titre français') ? emptySearch : cards(query),
    });
    await f.createWorker()(type);
    assert.deepEqual(f.calls.search, ['Titre français', 'Original title', 'Titre alternatif'].map(q => q + suffix), type);
    assert.equal(f.calls.page.length, 4, type);
    assert.equal(f.calls.aliases, 1, type);
    assert.deepEqual(f.reports, ['content_not_found'], type);
    await assertDeferred(f, good, type);
  }
});

test('des échecs successifs espacent les reprises du même titre', async t => {
  const f = await fixture(t, async () => ({ success: false }));
  const worker = f.createWorker();
  await worker(); // Premier échec : reprise après 1 min.
  f.advance(61_000);
  await worker(); // Deuxième échec : reprise après 2 min.
  f.advance(61_000);
  await worker();
  assert.equal(f.counts().calls, 2);
  f.advance(60_000);
  await worker();
  assert.deepEqual(f.counts(), { calls: 3, writes: 0 });
  assert.deepEqual(await f.read(), good);
});

// Fiche Flemmix déjà confirmée : relue seule, sans recherche.
const knownUrl = `${base}/known.html`;
const daysAgo = days => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
// Un lecteur par fiche, à une adresse dérivée de celle de la fiche.
const playerPage = type => url => {
  const link = `<a data-v="https://player.test${new URL(url).pathname}"><span>Lecteur</span></a>`;
  return type === 'tv' ? `<div class="ep1vf">${link}</div>` : `<div class="tabs-sel">${link}</div>`;
};
const knownCache = (type, extra = {}) => ({
  success: true, wiflix_url: knownUrl, cache_timestamp: daysAgo(1), searched_at: daysAgo(2),
  ...(type === 'tv' ? { season: 1, episodes: { 1: { vf: [{ url: 'https://cached.test/e1' }], vostfr: [] } } }
    : { source: 'flemmix', players: good.players }),
  ...extra,
});
const accept = async () => ({ accepted: true, reason: 'identity_confirmed' });
const pageNotFound = shape => Object.assign(new Error('Request failed with status code 404'),
  shape === 'page' ? { response: { status: 404 } } : { wiflixStatus: 404 });
const savedPlayer = (saved, type) => (type === 'tv' ? saved.episodes[1] : saved.players).vf[0].url;

test('un succès Flemmix relit sa fiche connue sans recherche et conserve searched_at', async t => {
  for (const type of ['movie', 'tv']) {
    for (const legacy of [false, true]) {
      const label = `${type}${legacy ? ' (ancien cache sans searched_at)' : ''}`;
      const initial = knownCache(type, legacy ? { searched_at: undefined } : {});
      const f = await sourceFixture(t, { initial, search: cards, page: playerPage(type), verify: accept });
      await f.createWorker()(type);
      assert.deepEqual(f.calls.search, [], label);
      assert.deepEqual(f.calls.page, [knownUrl], label);
      assert.equal(f.calls.aliases, 0, label);
      const saved = await f.read();
      assert.equal(saved.wiflix_url, knownUrl, label);
      assert.equal(savedPlayer(saved, type), 'https://player.test/known.html', label);
      assert.equal(saved.searched_at, legacy ? initial.cache_timestamp : initial.searched_at, label);
      assert.ok(Date.parse(saved.cache_timestamp) > Date.parse(initial.cache_timestamp), label);
      if (type === 'tv') assert.equal(f.calls.verify[0]?.season, 1, label);
      else assert.equal(saved.source, 'flemmix', label);
      await assert.rejects(fs.stat(path.join(f.dir, 'key.retry')), { code: 'ENOENT' });
    }
  }
});

test('une fiche connue refusée, sans lecteur ou disparue repasse par la recherche complète', async t => {
  const variants = {
    'identité refusée': type => url => playerPage(type)(url) + (url === knownUrl ? '<i>autre-film</i>' : ''),
    'sans lecteur': type => url => url === knownUrl ? '<h1>Fiche vide</h1>' : playerPage(type)(url),
    '404 de la page': type => url => { if (url === knownUrl) throw pageNotFound('page'); return playerPage(type)(url); },
    '404 du proxy': type => url => { if (url === knownUrl) throw pageNotFound('proxy'); return playerPage(type)(url); },
  };
  for (const type of ['movie', 'tv']) {
    for (const [name, page] of Object.entries(variants)) {
      const label = `${type} ${name}`;
      const startedAt = Date.now();
      const f = await sourceFixture(t, {
        initial: knownCache(type), search: cards, page: page(type),
        verify: async identity => ({ accepted: identity.titles[0] === 'Titre français' }),
        // La route passe le DOM déjà chargé, pas la chaîne HTML.
        globals: { parseSourceIdentity: $ => ({
          titles: [$.html().includes('autre-film') ? 'Autre film' : 'Titre français'], year: 2020 }) },
      });
      await f.createWorker()(type);
      assert.equal(f.calls.search.length, 1, label);
      // La fiche connue n'est pas relue une seconde fois pendant la recherche.
      assert.deepEqual(f.calls.page.filter(url => url === knownUrl), [knownUrl], label);
      assert.equal(f.calls.page.length, 2, label);
      const saved = await f.read();
      assert.equal(saved.success, true, label);
      assert.equal(saved.wiflix_url, f.calls.page[1], label);
      assert.ok(Date.parse(saved.searched_at) >= startedAt, label);
      assert.ok(!f.logs.some(line => line.includes('[WIFLIX PLAYERS] Echec')), label);
    }
  }
});

test('une fiche connue en panne reste une indisponibilité : ni recherche, ni écriture', async t => {
  const transient = () => Object.assign(new Error('TMDB limité'), { code: 'TMDB_TRANSIENT' });
  for (const type of ['movie', 'tv']) {
    const variants = {
      'page en échec': { page: () => { throw timeout(); }, verify: accept },
      'coupe-circuit': { page: () => { throw circuitOpen(); }, verify: accept },
      'TMDB limité': { page: playerPage(type), verify: async () => { throw transient(); } },
    };
    for (const [name, options] of Object.entries(variants)) {
      const label = `${type} ${name}`;
      const initial = knownCache(type);
      const f = await sourceFixture(t, { initial, search: cards, ...options });
      await f.createWorker()(type);
      assert.deepEqual(f.calls.search, [], label);
      assert.deepEqual(f.calls.page, [knownUrl], label);
      assert.ok(!f.reports.includes('content_not_found'), label);
      await assertDeferred(f, initial, label);
    }
  }
});

test('une fiche connue trop ancienne, d’un autre domaine ou d’une autre source repasse par la recherche', async t => {
  const cases = [
    ['movie', 'recherche de plus de 7 jours', { searched_at: daysAgo(8) }],
    ['tv', 'recherche de plus de 7 jours', { searched_at: daysAgo(8) }],
    ['movie', 'ancien domaine', { wiflix_url: 'https://old.test/known.html' }],
    ['tv', 'ancien domaine', { wiflix_url: 'https://old.test/known.html' }],
    ['movie', 'cache CineStream seul', { source: 'cinestream' }],
  ];
  for (const [type, name, extra] of cases) {
    const label = `${type} ${name}`;
    const initial = knownCache(type, extra);
    const startedAt = Date.now();
    const f = await sourceFixture(t, { initial, search: cards, page: playerPage(type), verify: accept });
    await f.createWorker()(type);
    assert.equal(f.calls.search.length, 1, label);
    assert.ok(!f.calls.page.includes(initial.wiflix_url), label);
    const saved = await f.read();
    assert.equal(saved.wiflix_url, f.calls.page[0], label);
    assert.ok(Date.parse(saved.searched_at) >= startedAt, label);
  }
});

test('une pause CineStream n’empêche pas le cache négatif d’un film introuvable sur Flemmix', async t => {
  const cooldown = () => Object.assign(new Error('CineStream temporairement indisponible'), {
    code: 'CINESTREAM_COOLDOWN', httpStatus: 503,
  });
  const f = await sourceFixture(t, { initial: null, search: () => emptySearch,
    cinestream: async () => { throw cooldown(); } });
  await f.createWorker()('movie');
  const saved = await f.read();
  assert.equal(saved?.success, false);
  // La page de résultats vide n'est pas recopiée dans le négatif.
  assert.equal('debugHtml' in saved, false);
  assert.equal(f.counts().writes, 1);
  assert.deepEqual(f.reports, ['content_not_found']);
  assert.ok(!f.logs.some(line => line.includes('CineStream')));
  // Négatif frais : aucun nouvel examen avant son expiration.
  const searches = f.calls.search.length;
  f.advance(20 * 60 * 1000);
  await f.createWorker()('movie');
  assert.equal(f.calls.search.length, searches);
});

test('une vraie erreur CineStream reste une indisponibilité, sans cache négatif', async t => {
  const f = await sourceFixture(t, { initial: null, search: () => emptySearch,
    cinestream: async () => { throw new Error('réponse inattendue'); } });
  await f.createWorker()('movie');
  await assertDeferred(f, null, 'erreur CineStream');
  assert.ok(f.logs.some(line => line.includes('CineStream réponse inattendue')));
});

test('un ancien cache négatif rendu tel quel pendant une panne n’est pas republié', async t => {
  const negative = { success: false, error: 'Film non trouvé', tmdb_id: '42' };
  for (const type of ['movie', 'tv']) {
    const f = await fixture(t, async previous => previous, { initial: negative });
    const before = (await fs.stat(f.file)).mtimeMs;
    await f.createWorker()(type);
    assert.deepEqual(f.counts(), { calls: 1, writes: 0 }, type);
    assert.equal((await fs.stat(f.file)).mtimeMs, before, type);
    assert.ok(await f.state.remaining(f.dir, 'key', negative) > 0, type);
  }
});

test('aucune page HTML de diagnostic n’est enregistrée, même dans un cache négatif', async t => {
  const f = await fixture(t, async () => ({ success: false, error: 'introuvable', debugHtml: '<html>résultats</html>' }),
    { initial: null });
  await f.createWorker()();
  assert.deepEqual(await f.read(), { success: false, error: 'introuvable' });
});

const noResults = () => emptySearch;

test('une page d’accès servie en 200 n’est jamais un introuvable', async t => {
  const accessPage = '<!DOCTYPE html><html><head><title>Flemmix - Acces securise</title><script>'
    + 'window._isBot = function _isBot() { return false; };</script></head><body>'
    + '<a id="_btn" href="#" class="button">Accéder maintenant</a></body></html>';
  for (const type of ['movie', 'tv']) {
    for (const initial of [good, null]) {
      const label = `${type} ${initial ? 'avec' : 'sans'} cache`;
      const f = await sourceFixture(t, { initial, search: () => accessPage });
      await f.createWorker()(type);
      assert.equal(f.calls.search.length, 1, label);
      assert.ok(!f.reports.includes('content_not_found'), label);
      await assertDeferred(f, initial, label);
    }
  }
});
const verifierWith = (titles, aliases, counter = { aliases: 0 }) => () => ({
  titles,
  aliases: async () => { counter.aliases++; return aliases; },
  verify: async () => ({ accepted: false, reason: 'identity_unconfirmed' }),
});

test('une actualisation envoie au plus 6 recherches, dont 3 pour les alias, sans doublon ni titre illisible', async t => {
  for (const type of ['movie', 'tv']) {
    const suffix = type === 'tv' ? ' saison 1' : '';
    const counter = { aliases: 0 };
    const f = await sourceFixture(t, { initial: null, search: noResults, globals: {
      // Doublon à la casse et aux espaces près, titre coréen, titre cyrillique.
      createIdentityVerifier: verifierWith(['Titre français', 'TITRE  français', '기생충', 'Original title'],
        ['Titre français', 'Alias 1', 'Брат', 'Alias 2', 'Alias 3', 'Alias 4'], counter),
    } });
    await f.createWorker()(type);
    assert.deepEqual(f.calls.search,
      ['Titre français', 'Original title', 'Alias 1', 'Alias 2', 'Alias 3'].map(q => q + suffix), type);
    assert.equal(counter.aliases, 1, type);
    const saved = await f.read();
    assert.equal(saved.success, false, type);
    assert.deepEqual(saved.titles_tried, ['Titre français', 'Original title', 'Alias 1', 'Alias 2', 'Alias 3'], type);
  }
  // Six titres principaux : plafond atteint, la passe des alias n'a pas lieu.
  const counter = { aliases: 0 };
  const titles = ['Un', 'Deux', 'Trois', 'Quatre', 'Cinq', 'Six', 'Sept'];
  const f = await sourceFixture(t, { initial: null, search: noResults,
    globals: { createIdentityVerifier: verifierWith(titles, ['Alias'], counter) } });
  await f.createWorker()('movie');
  assert.deepEqual(f.calls.search, titles.slice(0, 6));
  assert.equal(counter.aliases, 0);
});

test('un refus du débit global diffère l’actualisation sans rapport d’échec ni journal', async t => {
  const limited = () => Object.assign(new Error('Flemmix : débit global atteint'), { code: 'WIFLIX_RATE_LIMITED' });
  for (const type of ['movie', 'tv']) {
    for (const initial of [good, null]) {
      const label = `${type} ${initial ? 'avec' : 'sans'} cache`;
      const f = await sourceFixture(t, { initial, search: () => { throw limited(); } });
      await f.createWorker()(type);
      assert.equal(f.calls.search.length, 1, label);
      assert.deepEqual(f.reports, [], label);
      assert.ok(!f.logs.some(line => /Echec|WIFLIX UPDATE/.test(line)), label);
      await assertDeferred(f, initial, label);
    }
    // Refus sur la fiche d'un candidat, puis sur la relecture d'une fiche connue.
    for (const initial of [good, knownCache(type)]) {
      const f = await sourceFixture(t, { initial, search: cards, page: () => { throw limited(); }, verify: accept });
      await f.createWorker()(type);
      assert.equal(f.calls.page.length, 1, type);
      assert.deepEqual(f.reports, [], type);
      assert.ok(!f.logs.some(line => /Echec|WIFLIX UPDATE/.test(line)), type);
      await assertDeferred(f, initial, type);
    }
  }
});

test('le cache garde la date de sortie qui règle sa fraîcheur', async t => {
  const tmdb = async (_url, _key, id) => ({ id: Number(id), title: 'Titre français', name: 'Titre français',
    release_date: '2001-05-16' });
  const episodes = dates => async () => ({ air_date: '2020-01-01', episodes: dates.map(air_date => ({ air_date })) });
  const cases = [
    ['movie', 'trouvé', { search: cards, page: playerPage('movie'), verify: accept }, '2001-05-16'],
    ['movie', 'introuvable', { search: noResults }, '2001-05-16'],
    ['tv', 'dernier épisode', { search: cards, page: playerPage('tv'), verify: accept,
      season: episodes(['2020-01-01', '2020-03-04', '2020-02-01']) }, '2020-03-04'],
    ['tv', 'épisode sans date', { search: noResults, season: episodes(['2026-10-01', null]) }, null],
    ['tv', 'saison sans épisodes', { search: noResults, season: async () => ({ air_date: '2019-09-09' }) }, '2019-09-09'],
  ];
  for (const [type, name, { season, ...options }, expected] of cases) {
    const f = await sourceFixture(t, { initial: null, ...options,
      globals: { fetchTmdbDetails: tmdb, ...(season ? { fetchTmdbSeason: season } : {}) } });
    await f.createWorker()(type);
    assert.equal((await f.read()).release_date, expected, `${type} ${name}`);
  }
});

test('la fraîcheur suit l’âge de la sortie', () => {
  const now = Date.parse('2026-10-19T12:00:00Z');
  const hour = 60 * 60 * 1000, day = 24 * hour;
  const at = days => new Date(now - days * day).toISOString().slice(0, 10);
  const missing = { success: false, search_page_checked: true };
  const cases = [
    [{ success: true }, 3 * hour], [missing, 6 * hour],
    [{ success: true, release_date: at(30) }, 3 * hour], [{ ...missing, release_date: at(30) }, 6 * hour],
    [{ ...missing, release_date: at(-10) }, 6 * hour], [{ ...missing, release_date: null }, 6 * hour],
    [{ success: true, release_date: at(200) }, 12 * hour], [{ ...missing, release_date: at(200) }, day],
    [{ success: true, release_date: at(800) }, 12 * hour], [{ ...missing, release_date: at(800) }, 3 * day],
    // Introuvable non vérifié : réexaminé tout de suite, sauf s'il garde une
    // vraie page de résultats (ancien format).
    [{ success: false, release_date: at(800) }, 0],
    [{ success: false, debugHtml: '<title>Flemmix - Acces securise</title>' }, 0],
    [{ success: false, debugHtml: '<form id="quicksearch"><input name="story"></form>' }, 6 * hour],
  ];
  for (const [data, expected] of cases) assert.equal(wiflixFreshnessMs(data, now), expected, JSON.stringify(data));
});

test('un film présent sur CineStream seul n’est recherché sur Flemmix qu’au rythme d’un introuvable', async t => {
  const cine = { success: true, source: 'cinestream', players: { vf: [{ url: 'https://cine.test/1' }], vostfr: [] } };
  let cinestream = async () => cine;
  const tmdb = async (_url, _key, id) => ({ id: Number(id), title: 'Titre français', release_date: '2001-05-16' });
  const f = await sourceFixture(t, { initial: null, search: noResults,
    cinestream: (...args) => cinestream(...args), globals: { fetchTmdbDetails: tmdb } });
  await f.createWorker()('movie');
  const first = await f.read();
  assert.equal(first.success, true);
  assert.equal(first.source, 'cinestream');
  assert.equal(first.release_date, '2001-05-16');
  assert.ok(Date.parse(first.flemmix_missing_at) <= Date.now());
  const searches = f.calls.search.length;
  assert.ok(searches > 0);

  // Succès ancien périmé (12 h) : CineStream relu, Flemmix laissé de côté.
  f.advance(13 * 60 * 60 * 1000);
  await f.createWorker()('movie');
  assert.equal(f.calls.search.length, searches);
  const second = await f.read();
  assert.equal(second.flemmix_missing_at, first.flemmix_missing_at);
  assert.ok(Date.parse(second.cache_timestamp) >= Date.parse(first.cache_timestamp));

  // Sans le film sur CineStream, Flemmix est examiné malgré tout.
  cinestream = async () => ({ success: false });
  f.advance(13 * 60 * 60 * 1000);
  await f.createWorker()('movie');
  assert.ok(f.calls.search.length > searches);

  // Trois jours plus tard (sortie de plus d'un an), Flemmix est réexaminé.
  cinestream = async () => cine;
  const old = { ...(await f.read()), flemmix_missing_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString() };
  await fs.writeFile(f.file, JSON.stringify({ ...old, success: true, source: 'cinestream', players: cine.players }));
  const before = f.calls.search.length;
  f.advance(13 * 60 * 60 * 1000);
  await f.createWorker()('movie');
  assert.ok(f.calls.search.length > before);
  assert.ok(Date.parse((await f.read()).flemmix_missing_at) > Date.parse(old.flemmix_missing_at));
});

test('le cache est lu dans son seul fichier, sans copie Redis', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wiflix-memory-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, 'key.json'), JSON.stringify(good));
  const filename = path.resolve(__dirname, '../wiflix.js');
  const source = await fs.readFile(filename, 'utf8');
  const start = source.indexOf('// === Cache helpers');
  const end = source.indexOf('// === Utility Functions ===', start);
  assert.ok(start > 0 && end > start);
  // Un accès à memoryCache lèverait une ReferenceError.
  const context = vm.createContext({ path, fsp: fs, console });
  vm.runInContext(source.slice(start, end) + '\nglobalThis.read = getFromCacheNoExpiration;', context, { filename });
  assert.equal(JSON.stringify(await context.read(dir, 'key')), JSON.stringify(good));
  assert.equal(await context.read(dir, 'absent'), null);
});
