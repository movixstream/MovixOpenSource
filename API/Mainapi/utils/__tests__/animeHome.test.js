/**
 * Page Animes calculée par le serveur (utils/animeHome.js), contre un faux
 * TMDB, un faux Redis et un faux catalogue.
 *
 * Ce qui doit tenir :
 *  1. Les œuvres pour adultes (et celles dont l'âge est illisible) ne sortent jamais.
 *  2. Un visiteur ne déclenche pas de nouvel appel TMDB tant que la page est fraîche.
 *  3. Une page périmée est servie tout de suite et recalculée une seule fois.
 *  4. Une panne TMDB n'écrit rien et n'est pas réessayée à chaque visite.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAnimeHome, normalizeLanguage, ageOfRatings, FRESH_MS, COLD_WAIT_MS } = require('../animeHome');

const show = (id, extra = {}) => ({
  id,
  name: `Anime ${id}`,
  overview: `Résumé ${id}`,
  poster_path: `/p${id}.jpg`,
  backdrop_path: `/b${id}.jpg`,
  popularity: 1000 - id,
  vote_count: 100,
  vote_average: 8,
  first_air_date: '2024-01-01',
  genre_ids: [16],
  original_name: 'retiré du résultat',
  ...extra,
});

function createFakes({ ratings = {}, discoverFails = false, transientOnce = [] } = {}) {
  const calls = { keyword: 0, discover: 0, ratings: 0, details: 0 };
  const flaky = new Set(transientOnce);
  const transient = () => Object.assign(new Error('TMDB temporairement indisponible'), { transient: true });

  const tmdb = {
    async searchKeyword() {
      calls.keyword += 1;
      return { results: [{ id: 99, name: 'animation' }, { id: 210024, name: 'Anime' }] };
    },
    async discover(params) {
      calls.discover += 1;
      if (discoverFails) throw transient();
      assert.equal(params.with_keywords, '210024');
      if (params.with_genres === '16') {
        // Pages populaires : 1 à 3 sur la page 1, 4 sur la page 2, 10 à 19 sur la 3.
        const byPage = { 1: [show(1), show(2), show(3)], 2: [show(4)], 3: Array.from({ length: 10 }, (_, i) => show(10 + i)) };
        return { results: byPage[params.page] };
      }
      if (params.with_genres === '16,10759') return { results: [show(1), show(5), show(6, { overview: '  ' })] };
      return { results: [] };
    },
    async contentRatings(id) {
      calls.ratings += 1;
      if (flaky.delete(id)) throw transient();
      if (ratings[id] === 'fail') throw transient();
      return { results: ratings[id] ? [{ iso_3166_1: 'US', rating: ratings[id] }] : [] };
    },
    async details(id) {
      calls.details += 1;
      return { id, name: `Fiche ${id}`, overview: '', poster_path: `/f${id}.jpg`, popularity: id, genres: [{ id: 16 }] };
    },
  };

  const animeIndex = {
    async listTitles({ status, language }) {
      if (status === 'ongoing') return { items: [{ tmdb: { type: 'tv', id: 50 } }, { tmdb: { type: 'tv', id: 51 } }, { tmdb: null }] };
      if (language === 'vf') return { items: [{ tmdb: { type: 'tv', id: 51 } }, { tmdb: { type: 'movie', id: 52 } }] };
      return { items: [] };
    },
  };

  const storeData = new Map();
  const store = {
    writes: 0,
    async get(key) { return storeData.get(key) ?? null; },
    async set(key, value) { store.writes += 1; storeData.set(key, JSON.parse(JSON.stringify(value))); },
  };

  return { calls, tmdb, animeIndex, store, storeData };
}

// Les pauses entre deux essais passent tout de suite ; l'attente du premier
// calcul ne finit jamais, pour que la réponse dépende du calcul lui-même.
const noSleep = ms => (ms >= COLD_WAIT_MS ? new Promise(() => {}) : Promise.resolve());
const quietLog = { warn() {} };

test('écarte les œuvres pour adultes et celles dont l’âge est illisible', async () => {
  const fakes = createFakes({ ratings: { 2: 'TV-MA', 4: 'fail', 51: 'R' } });
  const home = createAnimeHome({ ...fakes, acquireLock: async () => ({}), sleep: noSleep, log: quietLog });

  const result = await home.read('fr-FR');
  assert.equal(result.status, 'ready');
  const { shows, genrePosters, siteRows } = result.data;

  // 2 (TV-MA) et 4 (âge illisible) sont écartés ; 6 n'a pas de résumé.
  assert.deepEqual(shows.map(item => item.id), [1, 3, 5, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  assert.equal(shows[0].original_name, undefined);
  assert.equal(shows[0].media_type, 'tv');

  // Genre 16 : 1 et 3 ; Action & Aventure : 1 déjà pris, donc 5 et 6 (une
  // tuile n'a besoin que de l'affiche, pas du résumé).
  assert.deepEqual(genrePosters[16], ['https://image.tmdb.org/t/p/w185/p1.jpg', 'https://image.tmdb.org/t/p/w185/p3.jpg']);
  assert.deepEqual(genrePosters[10759], ['https://image.tmdb.org/t/p/w185/p5.jpg', 'https://image.tmdb.org/t/p/w185/p6.jpg']);
  assert.deepEqual(genrePosters[35], []);

  // 51 est classé R : il manque aux deux rangées ; 52 est un film.
  assert.deepEqual(siteRows.airing.map(item => item.id), [50]);
  assert.equal(siteRows.airing[0].name, 'Fiche 50');
  assert.deepEqual(siteRows.dubbed, []);
  assert.equal(fakes.calls.details, 1);
  assert.equal(fakes.store.writes, 1);
});

test('une page fraîche ne redemande rien à TMDB', async () => {
  const fakes = createFakes();
  let clock = 1_000_000;
  const home = createAnimeHome({ ...fakes, acquireLock: async () => ({}), now: () => clock, sleep: noSleep, log: quietLog });

  await home.read('fr-FR');
  const after = { ...fakes.calls };
  clock += FRESH_MS - 1;
  const again = await home.read('fr-FR');
  assert.equal(again.status, 'ready');
  assert.deepEqual(fakes.calls, after);
});

test('une page périmée est servie tout de suite et recalculée une seule fois', async () => {
  const fakes = createFakes();
  let clock = 1_000_000;
  const home = createAnimeHome({ ...fakes, acquireLock: async () => ({}), now: () => clock, sleep: noSleep, log: quietLog });

  const first = await home.read('fr-FR');
  clock += FRESH_MS + 1;
  const discoverBefore = fakes.calls.discover;
  const [a, b] = await Promise.all([home.read('fr-FR'), home.read('fr-FR')]);
  assert.equal(a.data.updatedAt, first.data.updatedAt);
  assert.equal(b.data.updatedAt, first.data.updatedAt);

  // Laisser finir le recalcul lancé en arrière-plan.
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(fakes.calls.discover - discoverBefore, 10);
  assert.equal(fakes.store.writes, 2);
  const fresh = await home.read('fr-FR');
  assert.equal(fresh.data.updatedAt, clock);
});

test('un autre worker qui calcule déjà : réponse « en attente »', async () => {
  const fakes = createFakes();
  const home = createAnimeHome({ ...fakes, acquireLock: async () => null, sleep: noSleep, log: quietLog });

  assert.deepEqual(await home.read('en-US'), { status: 'pending' });
  assert.equal(fakes.calls.discover, 0);
});

test('une page calculée par un autre worker est lue dans Redis', async () => {
  const fakes = createFakes();
  const builder = createAnimeHome({ ...fakes, acquireLock: async () => ({}), sleep: noSleep, log: quietLog });
  await builder.read('fr-FR');
  const callsAfterBuild = { ...fakes.calls };

  const other = createAnimeHome({ ...fakes, acquireLock: async () => null, sleep: noSleep, log: quietLog });
  const result = await other.read('fr-FR');
  assert.equal(result.status, 'ready');
  assert.deepEqual(fakes.calls, callsAfterBuild);
});

test('une panne TMDB n’écrit rien et n’est pas réessayée à chaque visite', async () => {
  const fakes = createFakes({ discoverFails: true });
  let clock = 1_000_000;
  const home = createAnimeHome({ ...fakes, acquireLock: async () => ({}), now: () => clock, sleep: noSleep, log: quietLog });

  assert.deepEqual(await home.read('fr-FR'), { status: 'pending' });
  assert.equal(fakes.store.writes, 0);
  const discoverCalls = fakes.calls.discover;

  clock += 30_000;
  assert.deepEqual(await home.read('fr-FR'), { status: 'pending' });
  assert.equal(fakes.calls.discover, discoverCalls);

  clock += 31_000;
  await home.read('fr-FR');
  assert.ok(fakes.calls.discover > discoverCalls);
});

test('trop de classifications illisibles : rien n’est gardé', async () => {
  const fakes = createFakes({ ratings: { 1: 'fail', 2: 'fail', 3: 'fail' } });
  const home = createAnimeHome({ ...fakes, acquireLock: async () => ({}), sleep: noSleep, log: quietLog });

  assert.deepEqual(await home.read('fr-FR'), { status: 'pending' });
  assert.equal(fakes.store.writes, 0);
});

test('un échec temporaire de classification est réessayé', async () => {
  const fakes = createFakes({ transientOnce: [1] });
  const home = createAnimeHome({ ...fakes, acquireLock: async () => ({}), sleep: noSleep, log: quietLog });

  const { data } = await home.read('fr-FR');
  assert.ok(data.shows.some(item => item.id === 1));
});

test('langue inconnue : fr-FR ; âge lu par pays', () => {
  assert.equal(normalizeLanguage('xx-XX'), 'fr-FR');
  assert.equal(normalizeLanguage(undefined), 'fr-FR');
  assert.equal(normalizeLanguage('ja-JP'), 'ja-JP');
  assert.equal(ageOfRatings([{ iso_3166_1: 'JP', rating: 'R15+' }, { iso_3166_1: 'FR', rating: '10' }]), 10);
  assert.equal(ageOfRatings([{ iso_3166_1: 'DE', rating: 'TV-MA' }]), 17);
  assert.equal(ageOfRatings([]), 0);
});
