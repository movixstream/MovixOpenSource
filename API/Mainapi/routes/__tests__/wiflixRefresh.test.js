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
  let time = Date.now(), busy = false, calls = 0, writes = 0;
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
      acquireRedisLock: async () => {
        if (busy) return null;
        busy = true;
        return { renew: async () => true, release: async () => { busy = false; } };
      },
      getFromCacheNoExpiration: async (_dir, _key, bypassMemory) => { assert.equal(bypassMemory, true); return read(); },
      // Remplacés par les vraies fonctions quand la tranche les contient.
      fetchMovieData: scrape,
      fetchWiflixTvData: async (id, _season, previous) => scrape(id, previous),
      saveToCache: async (_dir, _key, data) => { writes++; await fs.writeFile(file, JSON.stringify(data)); return true; },
      reportRefreshFailure() {},
      redis: null,
      setInterval, clearInterval,
      console: { error() {} },
      ...globals,
    });
    vm.runInContext(source.slice(start, end) + '\nglobalThis.update = updateWiflixCache;', context, { filename });
    return (type = 'movie') => context.update(dir, 'key', type, '42', 1);
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
const timeout = () => Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED' });
const circuitOpen = () => Object.assign(new Error('Source Flemmix en pause'), {
  code: 'SOURCE_CIRCUIT_OPEN', isSourceCircuitOpen: true, httpStatus: 503,
});

// Chaîne réelle recherche → fiches → actualisation. Flemmix (recherche et
// fiches), TMDB, CineStream et la vérification d'identité sont simulés ; les
// appels sortants simulés sont comptés.
async function sourceFixture(t, { initial = good, search, page = () => '<h1>Fiche</h1>' }) {
  const calls = { search: [], page: [], aliases: 0 };
  const reports = [], steps = [], logs = [];
  const log = (...args) => logs.push(args.join(' '));
  const f = await fixture(t, null, {
    initial,
    from: '// === Utility Functions ===',
    globals: {
      cheerio, URL,
      WIFLIX_BASE_URL: base, TMDB_API_URL: 'https://tmdb.test', TMDB_API_KEY: '',
      fetchTmdbDetails: async (_url, _key, id) => ({ id: Number(id), title: 'Titre français', name: 'Titre français' }),
      fetchTmdbSeason: async () => ({ air_date: '2020-01-01' }),
      createIdentityVerifier: () => ({
        titles: ['Titre français', 'Original title'],
        aliases: async () => { calls.aliases++; return ['Titre alternatif']; },
        verify: async () => ({ accepted: false, reason: 'identity_unconfirmed' }),
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
      fetchCinestreamMovieData: async () => ({ success: false }),
      console: { log, info: log, warn: log, error: log },
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

test('la fraîcheur est recontrôlée sous verrou et un cache négatif conserve ses cinq minutes', async t => {
  const f = await fixture(t, async () => ({ success: false }), { initial: null });
  await f.createWorker()();
  f.advance(61_000);
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
      search: query => query.startsWith('Titre français') ? '<p>Aucun résultat</p>' : cards(query),
    });
    await f.createWorker()(type);
    assert.deepEqual(f.calls.search, ['Titre français', 'Original title', 'Titre alternatif'].map(q => q + suffix), type);
    assert.equal(f.calls.page.length, 4, type);
    assert.equal(f.calls.aliases, 1, type);
    assert.deepEqual(f.reports, ['content_not_found'], type);
    await assertDeferred(f, good, type);
  }
});
