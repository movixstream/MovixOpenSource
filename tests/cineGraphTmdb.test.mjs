// Couche réseau du CinéGraph (src/services/cineGraph/tmdb.ts), empaquetée avec
// un faux axios : cache partagé, annulations, échecs principaux et secondaires.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(join(repo, 'package.json'));
const work = mkdtempSync(join(tmpdir(), 'movix-cinegraph-tmdb-'));
after(() => rmSync(work, { recursive: true, force: true }));

// Faux axios : compte les appels, répond après un court délai, respecte l'AbortSignal.
writeFileSync(join(work, 'axios.mjs'), `
export const calls = [];
let handler = () => ({});
export function setHandler(fn) { handler = fn; }
const canceled = () => Object.assign(new Error('canceled'), { __CANCEL__: true, name: 'CanceledError' });
function get(url, config = {}) {
  const call = { url, params: config.params, aborted: false };
  calls.push(call);
  const { signal } = config;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { call.aborted = true; reject(canceled()); return; }
    const onAbort = () => { call.aborted = true; reject(canceled()); };
    signal?.addEventListener('abort', onAbort, { once: true });
    setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      if (call.aborted) return;
      try { resolve({ data: handler(url, config.params) }); } catch (error) { reject(error); }
    }, 20);
  });
}
export default { get, isCancel: (error) => Boolean(error && error.__CANCEL__) };
`);
writeFileSync(join(work, 'config.mjs'), `
export const TMDB_API_KEY = 'cle-factice';
export const TMDB_API_URL = 'https://api.test/3';
export const TMDB_IMAGE_URL = 'https://img.test/t/p';
`);
writeFileSync(join(work, 'i18n.mjs'), "export const getTmdbLanguage = () => 'fr-FR';\n");

const axiosUrl = pathToFileURL(join(work, 'axios.mjs')).href;
await require('esbuild').build({
  entryPoints: [join(repo, 'src/services/cineGraph/tmdb.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: join(work, 'tmdb.mjs'),
  logLevel: 'warning',
  plugins: [{
    name: 'stubs',
    setup(build) {
      build.onResolve({ filter: /^axios$/ }, () => ({ path: axiosUrl, external: true }));
      build.onResolve({ filter: /^@\/config\/config$/ }, () => ({ path: join(work, 'config.mjs') }));
      build.onResolve({ filter: /^@\/i18n$/ }, () => ({ path: join(work, 'i18n.mjs') }));
    },
  }],
});
const { calls, setHandler } = await import(axiosUrl);
const tmdb = await import(pathToFileURL(join(work, 'tmdb.mjs')).href);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate) {
  for (let i = 0; i < 500 && !predicate(); i++) await wait(1);
}

function captureWarnings() {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args[0]);
  return { warnings, restore: () => { console.warn = original; } };
}

test('requêtes identiques simultanées : un seul appel réseau, puis cache instantané', async () => {
  setHandler((url) => (url.endsWith('/trending/all/week')
    ? { results: [{ id: 1, media_type: 'movie', title: 'A', vote_count: 10 }, { id: 2, media_type: 'person', name: 'P' }] }
    : {}));
  const before = calls.length;
  const [a, b] = await Promise.all([tmdb.fetchTrending(), tmdb.fetchTrending()]);
  assert.equal(calls.length - before, 1);
  assert.deepEqual(a, b);
  assert.deepEqual(a.map((hit) => hit.type), ['movie']);
  await tmdb.fetchTrending();
  assert.equal(calls.length - before, 1);
  assert.equal(calls.at(-1).params.api_key, 'cle-factice');
  assert.equal(calls.at(-1).params.language, 'fr-FR');
  assert.equal(calls.at(-1).url, 'https://api.test/3/trending/all/week');
});

test('annuler un appelant ne casse pas ceux qui attendent la même requête', async () => {
  setHandler(() => ({ results: [{ id: 5, media_type: 'movie', title: 'Matrix', vote_count: 10 }] }));
  const before = calls.length;
  const controller = new AbortController();
  const first = tmdb.searchCineGraph('matrix', controller.signal);
  const second = tmdb.searchCineGraph('matrix');
  controller.abort();
  await assert.rejects(first, { name: 'AbortError' });
  assert.equal((await second)[0].title, 'Matrix');
  assert.equal(calls.length - before, 1);
  assert.equal(calls.at(-1).aborted, false);
});

test('annuler puis redemander aussitôt relance une vraie requête (double effet du StrictMode)', async () => {
  setHandler(() => ({ results: [{ id: 8, media_type: 'movie', title: 'Tenet', vote_count: 10 }] }));
  const before = calls.length;
  const first = new AbortController();
  const aborted = tmdb.searchCineGraph('tenet', first.signal);
  first.abort();
  // Même tick que l'annulation : le rejet d'axios n'est pas encore arrivé.
  const again = tmdb.searchCineGraph('tenet', new AbortController().signal);
  await assert.rejects(aborted, { name: 'AbortError' });
  assert.equal((await again)[0].title, 'Tenet');
  assert.equal(calls.length - before, 2);
  assert.equal(calls.at(-2).aborted, true);
  assert.equal(calls.at(-1).aborted, false);
});

test('plus personne n\'attend : axios est annulé et rien ne reste en cache', async () => {
  const before = calls.length;
  const controller = new AbortController();
  const pending = tmdb.searchCineGraph('dune', controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  await wait(5);
  assert.equal(calls.at(-1).aborted, true);
  setHandler(() => ({ results: [{ id: 7, media_type: 'movie', title: 'Dune', vote_count: 10 }] }));
  assert.equal((await tmdb.searchCineGraph('dune'))[0].title, 'Dune');
  assert.equal(calls.length - before, 2);
  // Signal déjà annulé : aucun appel réseau.
  await assert.rejects(tmdb.searchCineGraph('autre', AbortSignal.abort()), { name: 'AbortError' });
  assert.equal(calls.length - before, 2);
});

test('une erreur n\'est jamais gardée en cache ; recherche trop courte sans réseau', async () => {
  let fail = true;
  setHandler(() => {
    if (fail) throw new Error('500');
    return { results: [] };
  });
  const before = calls.length;
  await assert.rejects(tmdb.searchCineGraph('erreur'), /500/);
  fail = false;
  assert.deepEqual(await tmdb.searchCineGraph('erreur'), []);
  assert.equal(calls.length - before, 2);
  assert.deepEqual(await tmdb.searchCineGraph(' a '), []);
  assert.equal(calls.length - before, 2);
});

test('carte d\'œuvre : échec principal = rejet, échecs secondaires = infos sautées', async () => {
  setHandler((url, params) => {
    if (url.endsWith('/movie/42')) {
      if (params.language === 'en-US') return { id: 42, overview: 'English overview' };
      assert.equal(params.append_to_response, 'credits,keywords,similar,recommendations');
      return {
        id: 42,
        title: 'Quarante-deux',
        overview: '',
        genres: [{ id: 28, name: 'Action' }],
        belongs_to_collection: { id: 9, name: 'Saga' },
        credits: { cast: [{ id: 1, name: 'A', character: 'X', order: 0 }], crew: [{ id: 2, name: 'R', job: 'Director' }] },
        keywords: { keywords: [{ id: 5, name: 'heist' }] },
        recommendations: { results: [{ id: 43, media_type: 'movie', title: 'Quarante-trois', vote_count: 100, genre_ids: [28] }] },
        similar: { results: [] },
      };
    }
    if (url.endsWith('/collection/9')) throw new Error('collection en panne');
    if (url.endsWith('/person/1/combined_credits')) {
      return { cast: [{ id: 44, media_type: 'movie', title: 'Quarante-quatre', character: 'Y', vote_count: 500, genre_ids: [28] }], crew: [] };
    }
    if (url.endsWith('/person/2/combined_credits')) throw new Error('filmographie en panne');
    if (url.endsWith('/movie/43/keywords')) {
      assert.equal(params.language, undefined);
      return { id: 43, keywords: [{ id: 5, name: 'heist' }] };
    }
    throw new Error(`inattendu ${url}`);
  });
  const { warnings, restore } = captureWarnings();
  try {
    const map = await tmdb.fetchWorkMap('movie', 42);
    assert.deepEqual(map.zones.map((zone) => zone.kind), ['team', 'cast', 'mood']);
    assert.equal(map.root.overview, 'English overview');
    assert.deepEqual(map.items['movie-43'].reasons[0], { type: 'themes', keywords: ['braquage'], genres: ['Action'] });
    assert.equal(warnings.length, 2);
  } finally {
    restore();
  }
  setHandler(() => {
    throw new Error('404');
  });
  await assert.rejects(tmdb.fetchWorkMap('movie', 4242), /404/);
});

test('annulation pendant la phase 2 : rejet AbortError, aucun avertissement', async () => {
  setHandler((url) => {
    if (url.endsWith('/person/77')) {
      return {
        id: 77,
        name: 'Star',
        known_for_department: 'Acting',
        biography: 'Bio',
        combined_credits: { cast: [{ id: 1, media_type: 'movie', title: 'Un', character: 'A', vote_count: 100, genre_ids: [18] }], crew: [] },
      };
    }
    return { cast: [], crew: [] };
  });
  const { warnings, restore } = captureWarnings();
  try {
    const controller = new AbortController();
    const pending = tmdb.fetchPersonMap(77, controller.signal);
    await until(() => calls.some((call) => call.url.endsWith('/movie/1/credits')));
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(warnings.length, 0);
  } finally {
    restore();
  }
  const map = await tmdb.fetchPersonMap(77);
  assert.equal(map.root.title, 'Star');
  assert.equal(map.root.overview, 'Bio');
});

test('cache limité à 300 entrées : les plus anciennes partent, les récentes restent', async () => {
  setHandler((url, params) => ({ results: [{ id: 1, media_type: 'movie', title: String(params.query), vote_count: 1 }] }));
  await tmdb.searchCineGraph('ancienne');
  for (let batch = 0; batch < 7; batch++) {
    await Promise.all(Array.from({ length: 50 }, (_, i) => tmdb.searchCineGraph(`requête ${batch * 50 + i}`)));
  }
  const before = calls.length;
  await tmdb.searchCineGraph('requête 349');
  assert.equal(calls.length, before);
  await tmdb.searchCineGraph('ancienne');
  assert.equal(calls.length, before + 1);
});
