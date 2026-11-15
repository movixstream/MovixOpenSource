import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

type Service = typeof import('../src/services/historyService.ts');
type ContinueItem = import('../src/services/historyService.ts').ContinueItem;

interface Call { method: 'get' | 'delete'; url: string; config: { params?: Record<string, unknown>; headers?: Record<string, string>; timeout?: number } }

// Charge le service transpilé avec un faux axios, un faux MAIN_API et un faux
// localStorage : pas de navigateur ni de Vite dans `node --test`.
type Answer = { status: number; data?: unknown } | Error | (() => Promise<{ status: number; data?: unknown }>);

// `response` sert aux deux méthodes ; `deleteResponse` remplace celle du DELETE.
function loadService(storage: Record<string, string>, response: Answer = { status: 200, data: { items: [], complete: true } }, deleteResponse?: Answer) {
  const calls: Call[] = [];
  const answer = async (value: Answer) => {
    if (value instanceof Error) throw value;
    if (typeof value === 'function') return value();
    return value;
  };
  const axios = {
    async get(url: string, config: Call['config']) { calls.push({ method: 'get', url, config }); return answer(response); },
    async delete(url: string, config: Call['config']) { calls.push({ method: 'delete', url, config }); return answer(deleteResponse ?? response); },
  };
  const source = readFileSync(new URL('../src/services/historyService.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const exports = {};
  const localStorage = { getItem: (key: string) => (key in storage ? storage[key] : null) };
  new Function('exports', 'require', 'localStorage', js)(exports, (name: string) => {
    if (name === 'axios') return axios;
    if (name === '../config/runtime') return { MAIN_API: 'https://api.test' };
    throw new Error(`module inattendu : ${name}`);
  }, localStorage);
  return { service: exports as Service, calls };
}

const LOGGED_IN = { auth_token: 'jeton', selected_profile_id: 'profil-1' };

function continueItem(overrides: Partial<ContinueItem> = {}): ContinueItem {
  return {
    mediaType: 'tv',
    tmdbId: 1399,
    season: 2,
    episode: 1,
    position: 600,
    duration: 3000,
    lastWatchedAt: '2026-10-16T10:00:00.000Z',
    title: 'Game of Thrones',
    overview: 'Résumé',
    posterPath: '/poster.jpg',
    backdropPath: '/fond.jpg',
    year: 2011,
    rating: 8.4,
    episodeName: 'Le Nord se souvient',
    episodeOverview: null,
    stillPath: null,
    ...overrides,
  };
}

test('toHomeItem garde l’épisode S2E1 d’une série', () => {
  const { service } = loadService({});
  const item = service.toHomeItem(continueItem());
  assert.ok(item);
  assert.deepEqual(item.currentEpisode, { season: 2, episode: 1 });
  assert.equal(item.id, 1399);
  assert.equal(item.media_type, 'tv');
  assert.equal(item.title, 'Game of Thrones');
  assert.equal(item.name, 'Game of Thrones');
  assert.equal(item.poster_path, '/poster.jpg');
  assert.equal(item.backdrop_path, '/fond.jpg');
  assert.equal(item.vote_average, 8.4);
  assert.equal(item.position, 600);
  assert.equal(item.duration, 3000);
  assert.equal(item.progress, 20);
  assert.equal(item.lastAccessed, '2026-10-16T10:00:00.000Z');
  assert.equal(new Date(item.first_air_date as string).getFullYear(), 2011);
});

test('toHomeItem d’un film n’a pas d’épisode', () => {
  const { service } = loadService({});
  const item = service.toHomeItem(continueItem({ mediaType: 'movie', tmdbId: 27205, season: 0, episode: 0, title: 'Inception', year: 2010 }));
  assert.ok(item);
  assert.equal(item.media_type, 'movie');
  assert.equal(item.currentEpisode, undefined);
  assert.equal(item.name, undefined);
  assert.equal(new Date(item.release_date as string).getFullYear(), 2010);
});

test('toHomeItem écarte un élément sans titre (TMDB inconnu)', () => {
  const { service } = loadService({});
  assert.equal(service.toHomeItem(continueItem({ title: null })), null);
});

test('fetchContinueWatching sans auth_token → null sans requête', async () => {
  const { service, calls } = loadService({ selected_profile_id: 'profil-1' });
  assert.equal(await service.fetchContinueWatching('fr-FR'), null);
  assert.equal(calls.length, 0);
});

test('fetchContinueWatching sans profil → null sans requête', async () => {
  const { service, calls } = loadService({ auth_token: 'jeton' });
  assert.equal(await service.fetchContinueWatching('fr-FR'), null);
  assert.equal(calls.length, 0);
});

test('fetchContinueWatching historique désactivé → null sans requête (rangée locale vide)', async () => {
  const { service, calls } = loadService({ ...LOGGED_IN, settings_disable_history: 'true' });
  assert.equal(await service.fetchContinueWatching('fr-FR'), null);
  assert.equal(calls.length, 0);
});

test('fetchContinueWatching envoie profil, langue et jeton, renvoie la liste complète', async () => {
  const items = [continueItem()];
  const { service, calls } = loadService(LOGGED_IN, { status: 200, data: { items, complete: true } });
  assert.deepEqual(await service.fetchContinueWatching('en-US'), items);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.test/api/history/continue');
  assert.deepEqual(calls[0].config.params, { profileId: 'profil-1', language: 'en-US' });
  assert.equal(calls[0].config.headers?.Authorization, 'Bearer jeton');
  // Lecture courte : une API injoignable rend vite la main à la rangée locale.
  assert.equal(calls[0].config.timeout, 5000);
});

test('fetchContinueWatching ramène une langue inconnue à fr-FR', async () => {
  const { service, calls } = loadService(LOGGED_IN);
  await service.fetchContinueWatching('de-DE');
  assert.equal(calls[0].config.params?.language, 'fr-FR');
});

test('fetchContinueWatching → null si la liste du serveur n’est pas complète', async () => {
  const { service } = loadService(LOGGED_IN, { status: 200, data: { items: [continueItem()], complete: false } });
  assert.equal(await service.fetchContinueWatching('fr-FR'), null);
});

test('fetchContinueWatching → null sur erreur réseau ou 404 (API pas encore déployée)', async () => {
  const { service } = loadService(LOGGED_IN, Object.assign(new Error('404'), { response: { status: 404 } }));
  assert.equal(await service.fetchContinueWatching('fr-FR'), null);
});

test('hideContinueWatching envoie DELETE avec le profil', async () => {
  const { service, calls } = loadService(LOGGED_IN, { status: 204 });
  assert.equal(await service.hideContinueWatching('tv', 1399), true);
  assert.equal(calls[0].method, 'delete');
  assert.equal(calls[0].url, 'https://api.test/api/history/continue/tv/1399');
  assert.deepEqual(calls[0].config.params, { profileId: 'profil-1' });
  assert.equal(calls[0].config.headers?.Authorization, 'Bearer jeton');
  assert.equal(calls[0].config.timeout, 15000);
});

test('hideAllContinueWatching : un seul DELETE sans type ni id', async () => {
  const { service, calls } = loadService(LOGGED_IN, { status: 204 });
  assert.equal(await service.hideAllContinueWatching(), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'delete');
  assert.equal(calls[0].url, 'https://api.test/api/history/continue');
  assert.deepEqual(calls[0].config.params, { profileId: 'profil-1' });
  assert.equal(calls[0].config.headers?.Authorization, 'Bearer jeton');
  assert.equal(calls[0].config.timeout, 15000);
});

test('hideAllContinueWatching invité → false sans requête, erreur → false', async () => {
  const guest = loadService({});
  assert.equal(await guest.service.hideAllContinueWatching(), false);
  assert.equal(guest.calls.length, 0);
  const failing = loadService(LOGGED_IN, new Error('réseau'));
  assert.equal(await failing.service.hideAllContinueWatching(), false);
});

test('un titre retiré ne revient pas dans la liste du serveur, même si le DELETE a échoué', async () => {
  const items = [continueItem(), continueItem({ mediaType: 'movie', tmdbId: 550, season: 0, episode: 0, title: 'Fight Club' })];
  const { service } = loadService(LOGGED_IN, { status: 200, data: { items, complete: true } }, new Error('429'));
  await service.hideContinueWatching('tv', 1399);
  const result = await service.fetchContinueWatching('fr-FR');
  assert.deepEqual(result?.map((item) => item.tmdbId), [550]);
});

test('un titre retiré puis relancé plus tard revient', async () => {
  const later = new Date(Date.now() + 60_000).toISOString();
  const { service } = loadService(LOGGED_IN, { status: 200, data: { items: [continueItem({ lastWatchedAt: later })], complete: true } }, { status: 204 });
  await service.hideContinueWatching('tv', 1399);
  const result = await service.fetchContinueWatching('fr-FR');
  assert.deepEqual(result?.map((item) => item.tmdbId), [1399]);
});

test('après « Tout retirer », toutes les cartes affichées sont filtrées', async () => {
  const items = [continueItem(), continueItem({ mediaType: 'movie', tmdbId: 550, season: 0, episode: 0, title: 'Fight Club' })];
  const { service } = loadService(LOGGED_IN, { status: 200, data: { items, complete: true } }, new Error('réseau'));
  await service.hideAllContinueWatching([{ mediaType: 'tv', id: 1399 }, { mediaType: 'movie', id: 550 }]);
  assert.deepEqual(await service.fetchContinueWatching('fr-FR'), []);
});

test('la lecture attend la fin d’un retrait en cours avant de partir', async () => {
  let releaseDelete: () => void = () => {};
  const deleteDone = new Promise<{ status: number }>((resolve) => { releaseDelete = () => resolve({ status: 204 }); });
  const { service, calls } = loadService(LOGGED_IN, { status: 200, data: { items: [], complete: true } }, () => deleteDone);
  const hiding = service.hideContinueWatching('movie', 550);
  const reading = service.fetchContinueWatching('fr-FR');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(calls.map((call) => call.method), ['delete']);
  releaseDelete();
  await hiding;
  await reading;
  assert.deepEqual(calls.map((call) => call.method), ['delete', 'get']);
});

// --- Onglet « Historique » du profil -------------------------------------------

function listResponse(overrides: Record<string, unknown> = {}) {
  return {
    items: [{ ...continueItem(), finished: false, episodesWatched: 0, episodesTotal: 1 }],
    page: 1,
    pageSize: 20,
    total: 16,
    counts: { inProgress: 16, finished: 0, notStarted: 2 },
    stats: { watchedSeconds: 44820, moviesFinished: 0, episodesFinished: 0 },
    complete: true,
    ...overrides,
  };
}

const FIRST_PAGE = { status: 'in_progress', page: 1, pageSize: 20, language: 'fr-FR' } as const;

async function failureOf(answer: Answer) {
  const { service } = loadService(LOGGED_IN, answer);
  const result = await service.fetchHistoryList(FIRST_PAGE);
  assert.equal(result.ok, false);
  return result.ok ? null : result.reason;
}

const httpError = (status: number, data?: unknown) => Object.assign(new Error(String(status)), { response: { status, data } });

test('fetchHistoryList invité ou sans profil → « unauthenticated » sans requête', async () => {
  for (const storage of [{}, { auth_token: 'jeton' }, { selected_profile_id: 'profil-1' }]) {
    const { service, calls } = loadService(storage);
    assert.deepEqual(await service.fetchHistoryList(FIRST_PAGE), { ok: false, reason: 'unauthenticated' });
    assert.equal(calls.length, 0);
  }
});

test('fetchHistoryList envoie profil, langue, statut, page et jeton', async () => {
  const data = listResponse();
  const { service, calls } = loadService(LOGGED_IN, { status: 200, data });
  // Réponse v1 (sans les champs v2) : estimated / markedWatched complétés à false.
  const expected = {
    ...data,
    items: data.items.map((item) => ({ ...item, estimated: false, markedWatched: false, animeMode: false })),
    stats: { ...data.stats, trackedSeconds: null },
  };
  assert.deepEqual(await service.fetchHistoryList({ status: 'finished', page: 3, pageSize: 10, language: 'en-US' }), { ok: true, data: expected });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'get');
  assert.equal(calls[0].url, 'https://api.test/api/history/list');
  assert.deepEqual(calls[0].config.params, { profileId: 'profil-1', language: 'en-US', status: 'finished', page: 3, pageSize: 10 });
  assert.equal(calls[0].config.headers?.Authorization, 'Bearer jeton');
  assert.equal(calls[0].config.timeout, 5000);
});

test('fetchHistoryList ramène langue, statut, page et taille hors limites aux valeurs sûres', async () => {
  const { service, calls } = loadService(LOGGED_IN, { status: 200, data: listResponse() });
  await service.fetchHistoryList({ status: 'nimporte' as never, page: 0, pageSize: 500, language: 'de-DE' });
  assert.deepEqual(calls[0].config.params, { profileId: 'profil-1', language: 'fr-FR', status: 'in_progress', page: 1, pageSize: 50 });
  await service.fetchHistoryList({ status: 'not_started', page: 2.7, pageSize: 0, language: 'fr-FR' });
  assert.deepEqual(calls[1].config.params, { profileId: 'profil-1', language: 'fr-FR', status: 'not_started', page: 2, pageSize: 20 });
});

test('fetchHistoryList : import pas fini (complete:false) → « incomplete »', async () => {
  assert.equal(await failureOf({ status: 200, data: listResponse({ complete: false }) }), 'incomplete');
  assert.equal(await failureOf({ status: 200, data: { complete: false } }), 'incomplete');
});

test('fetchHistoryList : route absente (404), erreur serveur ou réponse mal formée → « unavailable »', async () => {
  assert.equal(await failureOf(httpError(404)), 'unavailable');
  assert.equal(await failureOf(httpError(404, '<html>Cannot GET</html>')), 'unavailable');
  assert.equal(await failureOf(httpError(500)), 'unavailable');
  assert.equal(await failureOf(httpError(429)), 'unavailable');
  for (const data of [null, '<html></html>', { items: 'non' }, listResponse({ counts: null }), listResponse({ stats: undefined }), listResponse({ complete: undefined })]) {
    assert.equal(await failureOf({ status: 200, data }), 'unavailable');
  }
});

test('fetchHistoryList : pas de réponse du serveur (réseau, délai) → « network »', async () => {
  assert.equal(await failureOf(new Error('réseau')), 'network');
  assert.equal(await failureOf(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' })), 'network');
});

test('fetchHistoryList : session refusée ou profil inconnu du compte → « unauthenticated »', async () => {
  assert.equal(await failureOf(httpError(401)), 'unauthenticated');
  assert.equal(await failureOf(httpError(403)), 'unauthenticated');
  assert.equal(await failureOf(httpError(404, { success: false, code: 'PROFILE_NOT_FOUND' })), 'unauthenticated');
});

// --- Avenant v2 : lecteurs web (estimé) et « Déjà vu » ----------------------------

async function readList(data: unknown) {
  const { service } = loadService(LOGGED_IN, { status: 200, data });
  const result = await service.fetchHistoryList(FIRST_PAGE);
  return result.ok ? result.data : null;
}

test('fetchHistoryList v2 garde estimated, markedWatched et un film marqué sans progression (null)', async () => {
  const marked = { ...continueItem({ mediaType: 'movie', tmdbId: 550, season: null, episode: null }), position: null, duration: null, finished: true, episodesWatched: null, episodesTotal: null, estimated: false, markedWatched: true, animeMode: false };
  const estimated = { ...continueItem({ mediaType: 'movie', tmdbId: 27205, season: null, episode: null, position: 2820, duration: 6000 }), finished: false, episodesWatched: null, episodesTotal: null, estimated: true, markedWatched: false, animeMode: false };
  const result = await readList(listResponse({ items: [marked, estimated] }));
  assert.deepEqual(result?.items, [marked, estimated]);
});

test('fetchHistoryList complète les champs absents ou abîmés (serveur pas encore à jour)', async () => {
  const raw = {
    ...continueItem({ mediaType: 'movie', tmdbId: 550, season: null, episode: null }),
    position: 'douze', duration: undefined, finished: 'oui', estimated: 'oui', markedWatched: 1,
    episodesWatched: Number.NaN, episodesTotal: '10',
  };
  const result = await readList(listResponse({ items: [raw] }));
  const item = result?.items[0];
  assert.ok(item);
  assert.equal(item.position, null);
  assert.equal(item.duration, null);
  assert.equal(item.finished, false);
  assert.equal(item.estimated, false);
  assert.equal(item.markedWatched, false);
  assert.equal(item.episodesWatched, null);
  assert.equal(item.episodesTotal, null);
  assert.equal(item.title, 'Game of Thrones');
});

test('fetchHistoryList écarte les lignes sans type ou identifiant TMDB valide', async () => {
  const good = { ...continueItem(), finished: false, episodesWatched: 1, episodesTotal: 10, estimated: false, markedWatched: false, animeMode: false };
  const result = await readList(listResponse({
    items: [null, 'texte', { ...good, mediaType: 'anime' }, { ...good, tmdbId: 'x' }, { ...good, tmdbId: 0 }, good],
  }));
  assert.deepEqual(result?.items, [good]);
});

test('fetchHistoryList met à 0 les compteurs et chiffres absents', async () => {
  const result = await readList(listResponse({ total: 'beaucoup', counts: { inProgress: 3 }, stats: { watchedSeconds: -4 } }));
  assert.equal(result?.total, 0);
  assert.deepEqual(result?.counts, { inProgress: 3, finished: 0, notStarted: 0 });
  assert.deepEqual(result?.stats, { watchedSeconds: 0, trackedSeconds: null, moviesFinished: 0, episodesFinished: 0 });
  assert.equal(result?.complete, true);
});

test('fetchHistoryList garde stats.trackedSeconds, null s’il est absent ou abîmé (ancien serveur)', async () => {
  const stats = { watchedSeconds: 339720, moviesFinished: 1, episodesFinished: 2 };
  assert.equal((await readList(listResponse({ stats: { ...stats, trackedSeconds: 44820 } })))?.stats.trackedSeconds, 44820);
  assert.equal((await readList(listResponse({ stats: { ...stats, trackedSeconds: 0 } })))?.stats.trackedSeconds, 0);
  assert.equal((await readList(listResponse({ stats })))?.stats.trackedSeconds, null);
  assert.equal((await readList(listResponse({ stats: { ...stats, trackedSeconds: 'x' } })))?.stats.trackedSeconds, null);
  assert.equal((await readList(listResponse({ stats: { ...stats, trackedSeconds: -3 } })))?.stats.trackedSeconds, null);
});

test('fetchHistoryList : animeMode gardé s’il vaut true, false sinon (ancien serveur ou valeur abîmée)', async () => {
  const base = { ...continueItem(), finished: false, episodesWatched: null, episodesTotal: null, estimated: false, markedWatched: false };
  const result = await readList(listResponse({ items: [{ ...base, animeMode: true }, { ...base, tmdbId: 2 }, { ...base, tmdbId: 3, animeMode: 'oui' }] }));
  assert.deepEqual(result?.items.map((item) => item.animeMode), [true, false, false]);
});

test('toHomeItem passe animeMode à la carte « Reprendre » (false par défaut)', () => {
  const { service } = loadService({});
  assert.equal(service.toHomeItem({ ...continueItem(), animeMode: true })?.animeMode, true);
  assert.equal(service.toHomeItem(continueItem())?.animeMode, false);
});

// --- Fiches film et série : GET /api/history/title ----------------------------------

function titleResponse(overrides: Record<string, unknown> = {}) {
  return {
    complete: true,
    title: {
      mediaType: 'tv', tmdbId: 42009, status: 'in_progress', markedWatched: false, animeMode: false, estimated: false,
      position: 1556, duration: 2873, season: 7, episode: 5, episodesWatched: 3, episodesTotal: 33,
      episodes: [
        { season: 7, episode: 5, position: 1556, duration: 2873, estimated: false, watched: false, marked: false },
        { season: 7, episode: 6, position: 5147, duration: 5426, estimated: false, watched: true, marked: false },
      ],
      ...overrides,
    },
  };
}

const TITLE_QUERY = { type: 'tv', id: 42009, language: 'fr-FR' } as const;

test('fetchTitleHistory envoie profil, type, id, langue et jeton ; rend le titre', async () => {
  const data = titleResponse();
  const { service, calls } = loadService(LOGGED_IN, { status: 200, data });
  const result = await service.fetchTitleHistory({ ...TITLE_QUERY, language: 'en-US' });
  assert.deepEqual(result, { ok: true, title: data.title });
  assert.equal(calls[0].url, 'https://api.test/api/history/title');
  assert.deepEqual(calls[0].config.params, { profileId: 'profil-1', type: 'tv', id: 42009, language: 'en-US' });
  assert.equal(calls[0].config.headers?.Authorization, 'Bearer jeton');
  assert.equal(calls[0].config.timeout, 5000);
});

test('fetchTitleHistory : titre inconnu du serveur → title null ; historique coupé → title null sans requête', async () => {
  const unknown = loadService(LOGGED_IN, { status: 200, data: { complete: true, title: null } });
  assert.deepEqual(await unknown.service.fetchTitleHistory(TITLE_QUERY), { ok: true, title: null });
  const disabled = loadService({ ...LOGGED_IN, settings_disable_history: 'true' });
  assert.deepEqual(await disabled.service.fetchTitleHistory(TITLE_QUERY), { ok: true, title: null });
  assert.equal(disabled.calls.length, 0);
});

test('fetchTitleHistory : mêmes raisons d’échec que la liste (invité, 404, réseau, incomplet)', async () => {
  const guest = loadService({});
  assert.deepEqual(await guest.service.fetchTitleHistory(TITLE_QUERY), { ok: false, reason: 'unauthenticated' });
  assert.equal(guest.calls.length, 0);
  const reason = async (answer: Answer) => {
    const result = await loadService(LOGGED_IN, answer).service.fetchTitleHistory(TITLE_QUERY);
    return result.ok ? null : result.reason;
  };
  assert.equal(await reason(httpError(404)), 'unavailable');
  assert.equal(await reason(new Error('réseau')), 'network');
  assert.equal(await reason({ status: 200, data: { ...titleResponse(), complete: false } }), 'incomplete');
  assert.equal(await reason({ status: 200, data: '<html>' }), 'unavailable');
});

test('fetchTitleHistory nettoie le titre : champs absents → false/null, épisodes invalides écartés', async () => {
  const data = titleResponse({
    status: 'bizarre', markedWatched: 'oui', animeMode: undefined, position: 'x', season: 1.5,
    episodes: [null, { season: 7, episode: 0 }, { season: 0, episode: 2, position: 60, duration: 'x', watched: 1 }, 'non'],
  });
  const result = await loadService(LOGGED_IN, { status: 200, data }).service.fetchTitleHistory(TITLE_QUERY);
  assert.ok(result.ok && result.title);
  const { title } = result;
  assert.equal(title.status, 'not_started');
  assert.equal(title.markedWatched, false);
  assert.equal(title.animeMode, false);
  assert.equal(title.position, null);
  assert.equal(title.season, null);
  assert.deepEqual(title.episodes, [{ season: 0, episode: 2, position: 60, duration: null, estimated: false, watched: false, marked: false }]);
  const notTitle = await loadService(LOGGED_IN, { status: 200, data: { complete: true, title: { mediaType: 'anime', tmdbId: 1 } } }).service.fetchTitleHistory(TITLE_QUERY);
  assert.deepEqual(notTitle, { ok: true, title: null });
});

test('deleteTitleHistory : DELETE /api/history/title/{type}/{id} avec le profil ; false si invité ou erreur', async () => {
  const { service, calls } = loadService(LOGGED_IN, { status: 204 });
  assert.equal(await service.deleteTitleHistory('tv', 1399), true);
  assert.equal(calls[0].method, 'delete');
  assert.equal(calls[0].url, 'https://api.test/api/history/title/tv/1399');
  assert.deepEqual(calls[0].config.params, { profileId: 'profil-1' });
  assert.equal(calls[0].config.headers?.Authorization, 'Bearer jeton');
  const guest = loadService({});
  assert.equal(await guest.service.deleteTitleHistory('movie', 550), false);
  assert.equal(guest.calls.length, 0);
  assert.equal(await loadService(LOGGED_IN, httpError(404)).service.deleteTitleHistory('movie', 550), false);
});

test('isHistoryDisabled suit le réglage settings_disable_history', () => {
  assert.equal(loadService({ settings_disable_history: 'true' }).service.isHistoryDisabled(), true);
  assert.equal(loadService({}).service.isHistoryDisabled(), false);
});

test('hideContinueWatching invité → false sans requête, erreur → false', async () => {
  const guest = loadService({});
  assert.equal(await guest.service.hideContinueWatching('movie', 1), false);
  assert.equal(guest.calls.length, 0);
  const failing = loadService(LOGGED_IN, new Error('réseau'));
  assert.equal(await failing.service.hideContinueWatching('movie', 1), false);
});
