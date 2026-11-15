/**
 * ID TMDB d'une œuvre d'anime-sama à partir de son ID AniList ou MyAnimeList
 * (utils/animeSamaTmdbResolver.js), demandé au service ARM (arm.haglund.dev).
 *
 * Modes de défaillance couverts ici. Le scénario de bout en bout
 * (`scripts/e2e/animeSamaLive.js`) interroge le vrai service pour une vraie
 * fiche sans ID TMDB : il prouve que la réponse du jour est comprise et que le
 * lien arrive en base. Il ne peut ni faire répondre au service un cas piégé, ni
 * le mettre en panne à la demande, ni avancer l'horloge. Ces cas-là sont joués
 * ici contre un faux service.
 *
 *  1. Le service rend un seul nombre pour une série et pour un film, alors que
 *     les ID des séries et des films se recoupent sur TMDB : un type mal déduit
 *     relie l'œuvre à la fiche TMDB d'une autre œuvre.
 *  2. Un film ou un OAV rangé comme « spécial » de sa série mère (saison 0)
 *     prend la page de la série.
 *  3. Une entrée dont le type ne se déduit pas est reliée au hasard au lieu
 *     d'être laissée sans lien.
 *  4. Une panne du service (délai dépassé, 429, 5xx, page de vérification à la
 *     place du JSON) passe pour « aucune correspondance » : l'index efface
 *     alors un lien qu'il connaissait.
 *  5. Service en panne : chaque fiche attend le délai de la requête, et le
 *     passage de l'index perd des minutes.
 *  6. Le service est redemandé à chaque relecture de la même fiche (une fiche
 *     est relue chaque fois qu'un visiteur l'ouvre).
 *  7. Une œuvre inconnue du service aujourd'hui (anime de la saison) le reste
 *     pour toujours ; une correspondance corrigée par le service n'arrive jamais.
 *  8. Un ID hors bornes (0, texte, nombre énorme) déclenche une erreur 400 qui
 *     passe pour une panne et met le service en pause.
 *  9. L'ID AniList est inconnu du service alors que l'ID MyAnimeList l'est.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { createArmTmdbResolver } = require('../animeSamaTmdbResolver');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const httpError = status => Object.assign(new Error(`HTTP ${status}`), { response: { status, data: {} } });
const timeout = () => Object.assign(new Error('timeout of 6000ms exceeded'), { code: 'ECONNABORTED' });

// Réponses du vrai service, relevées le 15/11/2026.
const SERIES = { themoviedb: 313068, 'themoviedb-season': 1, thetvdb: 473460, media: 'TV' };
const FILM = { themoviedb: 372058, 'themoviedb-season': null, thetvdb: null, media: 'MOVIE' };
const FILM_IN_PARENT_SERIES = { themoviedb: 62564, 'themoviedb-season': 0, thetvdb: 289884, media: 'MOVIE' };
const FILM_WITH_TVDB_ENTRY = { themoviedb: 9463, 'themoviedb-season': null, thetvdb: 79042, media: 'MOVIE' };
const KNOWN_WITHOUT_TMDB = { themoviedb: null, 'themoviedb-season': null, thetvdb: null, media: 'ONA' };

// `answers` : { 'anilist:207191': relation | null | Error }. Un ID absent répond `null`.
function setup(answers = {}) {
  const clock = { now: Date.UTC(2026, 10, 15, 12, 0, 0) };
  const service = { answers, calls: [] };
  const http = {
    async get(url, config = {}) {
      const { source, id } = config.params || {};
      service.calls.push(`${source}:${id}`);
      const answer = service.answers[`${source}:${id}`];
      if (answer instanceof Error) throw answer;
      return { status: 200, data: answer === undefined ? null : answer };
    },
  };
  const resolve = createArmTmdbResolver({ http, now: () => clock.now });
  return { resolve, service, clock, forget() { service.calls.length = 0; } };
}

test('série : reliée à la fiche TMDB de la série', async () => {
  const h = setup({
    'anilist:207191': SERIES,
    'anilist:11665': { themoviedb: 69500, 'themoviedb-season': 4, thetvdb: 82788, media: 'TV' },
    'anilist:209463': { themoviedb: 329096, 'themoviedb-season': null, thetvdb: 475628, media: 'TV' },
  });
  assert.deepEqual(await h.resolve({ anilistId: 207191, malId: 63409 }), { type: 'tv', id: 313068 });
  assert.deepEqual(await h.resolve({ anilistId: 11665, malId: null }), { type: 'tv', id: 69500 }, 'une saison suivante mène à la même série');
  assert.deepEqual(await h.resolve({ anilistId: 209463, malId: null }), { type: 'tv', id: 329096 }, 'série sans numéro de saison TMDB');
});

test('film, ou OAV sorti comme un film : relié à la fiche TMDB du film', async () => {
  const h = setup({
    'anilist:21519': FILM,
    'anilist:108354': { themoviedb: 587873, 'themoviedb-season': null, thetvdb: null, media: 'OVA' },
  });
  assert.deepEqual(await h.resolve({ anilistId: 21519, malId: null }), { type: 'movie', id: 372058 });
  assert.deepEqual(await h.resolve({ anilistId: 108354, malId: null }), { type: 'movie', id: 587873 });
});

test('film rangé comme spécial de sa série mère, ou type indéterminable : aucun lien', async () => {
  const h = setup({
    'anilist:100178': FILM_IN_PARENT_SERIES,
    'myanimelist:35677': FILM_IN_PARENT_SERIES,
    'anilist:732': FILM_WITH_TVDB_ENTRY,
    'myanimelist:732': FILM_WITH_TVDB_ENTRY,
  });
  assert.equal(await h.resolve({ anilistId: 100178, malId: 35677 }), null, 'le film ne prend pas la page de la série');
  assert.equal(await h.resolve({ anilistId: 732, malId: 732 }), null, 'ni série ni film avec certitude');
});

test('œuvre inconnue du service, ou connue sans ID TMDB : aucun lien, sans erreur', async () => {
  const h = setup({ 'anilist:132467': KNOWN_WITHOUT_TMDB });
  assert.equal(await h.resolve({ anilistId: 132467, malId: null }), null);
  assert.equal(await h.resolve({ anilistId: 4242, malId: 4343 }), null);
  assert.equal(await h.resolve({ anilistId: null, malId: null }), null);
  assert.equal(await h.resolve({}), null);
});

test('ID AniList inconnu du service : l’ID MyAnimeList est essayé ; sinon il n’est pas demandé', async () => {
  const h = setup({ 'myanimelist:63409': SERIES, 'anilist:21519': FILM });
  assert.deepEqual(await h.resolve({ anilistId: 999, malId: 63409 }), { type: 'tv', id: 313068 });
  assert.deepEqual(h.service.calls, ['anilist:999', 'myanimelist:63409']);

  h.forget();
  assert.deepEqual(await h.resolve({ anilistId: null, malId: 63409 }), { type: 'tv', id: 313068 });
  assert.deepEqual(await h.resolve({ anilistId: 21519, malId: 32281 }), { type: 'movie', id: 372058 });
  assert.equal(h.service.calls.includes('myanimelist:32281'), false, 'AniList a répondu : MyAnimeList n’est pas demandé');
});

test('la même œuvre n’est pas redemandée à chaque relecture de sa fiche', async () => {
  const h = setup({ 'anilist:207191': SERIES });
  for (let read = 0; read < 20; read++) {
    assert.deepEqual(await h.resolve({ anilistId: 207191, malId: 63409 }), { type: 'tv', id: 313068 });
    assert.equal(await h.resolve({ anilistId: 4242, malId: null }), null);
    h.clock.now += 10 * 60 * 1000;
  }
  assert.deepEqual(h.service.calls.sort(), ['anilist:207191', 'anilist:4242']);
});

test('une œuvre inconnue est redemandée le lendemain ; une correspondance connue finit par être relue', async () => {
  const h = setup({ 'anilist:207191': SERIES });
  await h.resolve({ anilistId: 207191, malId: null });
  assert.equal(await h.resolve({ anilistId: 4242, malId: null }), null);

  // Le lendemain, le service a appris l'anime de la saison.
  h.clock.now += DAY; h.forget();
  h.service.answers['anilist:4242'] = FILM;
  assert.deepEqual(await h.resolve({ anilistId: 4242, malId: null }), { type: 'movie', id: 372058 });
  await h.resolve({ anilistId: 207191, malId: null });
  assert.deepEqual(h.service.calls, ['anilist:4242'], 'la correspondance connue n’est pas redemandée chaque jour');

  // Un mois plus tard, une correspondance corrigée par le service est prise.
  h.clock.now += 30 * DAY; h.forget();
  h.service.answers['anilist:207191'] = { ...SERIES, themoviedb: 555 };
  assert.deepEqual(await h.resolve({ anilistId: 207191, malId: null }), { type: 'tv', id: 555 });
});

test('panne du service : une erreur, jamais « aucune correspondance »', async () => {
  for (const failure of [timeout(), httpError(503), httpError(429), new Error('getaddrinfo ENOTFOUND')]) {
    const h = setup({ 'anilist:207191': failure });
    await assert.rejects(h.resolve({ anilistId: 207191, malId: 63409 }));
  }
});

test('service en panne : les œuvres suivantes ne l’attendent pas, puis il est réessayé', async () => {
  const h = setup({ 'anilist:1': httpError(503), 'anilist:2': SERIES });
  await assert.rejects(h.resolve({ anilistId: 1, malId: null }));

  h.forget();
  for (let rank = 0; rank < 50; rank++) await assert.rejects(h.resolve({ anilistId: 100 + rank, malId: 200 + rank }));
  await assert.rejects(h.resolve({ anilistId: 2, malId: null }));
  assert.deepEqual(h.service.calls, [], 'aucune requête pendant la pause');

  h.clock.now += HOUR;
  assert.deepEqual(await h.resolve({ anilistId: 2, malId: null }), { type: 'tv', id: 313068 });
  // La panne n'a rien fait retenir : l'œuvre qui a échoué est redemandée.
  h.service.answers['anilist:1'] = FILM;
  assert.deepEqual(await h.resolve({ anilistId: 1, malId: null }), { type: 'movie', id: 372058 });
});

test('ID hors bornes : aucun lien, aucune requête ; une erreur 400 ne met pas le service en pause', async () => {
  const h = setup({ 'anilist:7': httpError(400), 'anilist:8': SERIES });
  for (const bad of [0, -5, 1.5, 60000000, '207191', NaN, undefined]) {
    assert.equal(await h.resolve({ anilistId: bad, malId: bad }), null);
  }
  assert.deepEqual(h.service.calls, []);

  assert.equal(await h.resolve({ anilistId: 7, malId: null }), null);
  assert.deepEqual(await h.resolve({ anilistId: 8, malId: null }), { type: 'tv', id: 313068 });
});

test('une réponse qui n’est pas celle du service est une panne, pas « aucune correspondance »', async () => {
  for (const body of ['<html>Un instant…</html>', [SERIES], 42, '']) {
    const h = setup({ 'anilist:1': body });
    await assert.rejects(h.resolve({ anilistId: 1, malId: null }), `réponse ${JSON.stringify(body)}`);
  }
});

test('un ID TMDB qui n’en est pas un ne relie rien', async () => {
  const h = setup({
    'anilist:2': { themoviedb: '313068', 'themoviedb-season': 1, thetvdb: 1, media: 'TV' },
    'anilist:3': { themoviedb: -4, 'themoviedb-season': 1, thetvdb: 1, media: 'TV' },
    'anilist:4': { themoviedb: 0, 'themoviedb-season': null, thetvdb: null, media: 'MOVIE' },
    'anilist:5': { themoviedb: 1.5, 'themoviedb-season': null, thetvdb: null, media: 'MOVIE' },
  });
  for (const id of [2, 3, 4, 5]) assert.equal(await h.resolve({ anilistId: id, malId: null }), null);
});
