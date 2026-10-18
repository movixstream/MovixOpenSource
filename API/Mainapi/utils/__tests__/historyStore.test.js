'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createHistoryStore } = require('../historyStore');
const { buildIndex, classify, titleDetails } = require('../historyOverview');
const { createFakeHistoryPool } = require('./helpers/fakeHistoryPool');

const OWNER = { userType: 'oauth', userId: 'u-1', profileId: 'p-1' };
const AT = new Date('2026-10-16T09:00:00.000Z');

function fakeMediaStore(mediaByKey = {}, episodesByKey = {}) {
  const calls = { getMany: [], getEpisodes: [], getEpisodeRuntimes: [] };
  return {
    calls,
    async getEpisodeRuntimes(seasons, language) {
      calls.getEpisodeRuntimes.push({ seasons, language });
      const result = new Map();
      for (const { tmdbId, season } of seasons) {
        const episodes = episodesByKey[`${tmdbId}:${season}`];
        if (episodes) result.set(`${tmdbId}:${season}`, new Map(Object.entries(episodes).map(([k, v]) => [Number(k), v.runtimeMinutes ?? null])));
      }
      return result;
    },
    async getMany(items, language) {
      calls.getMany.push({ items, language });
      const map = new Map();
      for (const item of items) {
        const key = `${item.mediaType}:${item.tmdbId}`;
        if (mediaByKey[key]) map.set(key, mediaByKey[key]);
      }
      return map;
    },
    async getEpisodes(tmdbId, season, language) {
      calls.getEpisodes.push({ tmdbId, season, language });
      return new Map(Object.entries(episodesByKey[`${tmdbId}:${season}`] || {}).map(([k, v]) => [Number(k), v]));
    },
  };
}

// Valeurs d'une requête INSERT, par nom de colonne.
function insertedValues(call) {
  const columns = /\(([^)]*)\) VALUES/.exec(call.sql)[1].split(',').map((name) => name.trim());
  const values = {};
  const placeholders = /VALUES \(([^)]*)\)/.exec(call.sql)[1].split(',').map((part) => part.trim());
  let index = 0;
  columns.forEach((column, position) => {
    values[column] = placeholders[position] === '?' ? call.params[index++] : Number(placeholders[position]);
  });
  return values;
}

test('recordProgress : film à 96 % → watch_history reçoit finished = 1', async () => {
  const fake = createFakeHistoryPool();
  const store = createHistoryStore({ pool: fake.pool, mediaStore: fakeMediaStore() });

  await store.recordProgress(OWNER, { mediaType: 'movie', tmdbId: 550, season: 0, episode: 0, position: 96, duration: 100, updatedAt: AT });

  const progress = fake.callsMatching('INSERT INTO watch_progress')[0];
  assert.match(progress.sql, /IF\(VALUES\(updated_at\) >= updated_at/);
  const progressValues = insertedValues(progress);
  assert.equal(progressValues.user_type, 'oauth');
  assert.equal(progressValues.season, 0);
  assert.equal(progressValues.episode, 0);
  assert.equal(progressValues.position_sec, 96);
  assert.equal(progressValues.updated_at, AT);

  const history = fake.callsMatching('INSERT INTO watch_history')[0];
  const values = insertedValues(history);
  assert.equal(values.finished, 1);
  assert.equal(values.season, null);
  assert.equal(values.episode, null);
  assert.equal(values.last_watched_at, AT);
  assert.match(history.sql, /last_watched_at = GREATEST\(last_watched_at, VALUES\(last_watched_at\)\)/);
});

test('listContinue : faux pool sans ligne → []', async () => {
  const fake = createFakeHistoryPool((sql) => (sql.startsWith('SELECT') ? [] : undefined));
  const media = fakeMediaStore();
  const store = createHistoryStore({ pool: fake.pool, mediaStore: media });

  assert.deepEqual(await store.listContinue(OWNER, 'fr-FR'), []);
});

test('recordProgress : S1E10 fini avec saisons [{1,10},{2,8}] → season = 2, episode = 1, finished = 0', async () => {
  const fake = createFakeHistoryPool();
  const media = fakeMediaStore({
    'tv:1399': { mediaType: 'tv', tmdbId: 1399, title: 'GoT', seasons: [{ season: 1, episodes: 10 }, { season: 2, episodes: 8 }] },
  });
  const store = createHistoryStore({ pool: fake.pool, mediaStore: media });

  await store.recordProgress(OWNER, { mediaType: 'tv', tmdbId: 1399, season: 1, episode: 10, position: 3000, duration: 3100, updatedAt: AT });

  assert.equal(media.calls.getMany[0].language, 'fr-FR');
  const progress = insertedValues(fake.callsMatching('INSERT INTO watch_progress')[0]);
  assert.equal(progress.season, 1);
  assert.equal(progress.episode, 10);

  const values = insertedValues(fake.callsMatching('INSERT INTO watch_history')[0]);
  assert.equal(values.season, 2);
  assert.equal(values.episode, 1);
  assert.equal(values.finished, 0);
});

test('recordProgress : mediaStore en panne → la carte reste sur l\'épisode fini, sans exception', async () => {
  const fake = createFakeHistoryPool();
  const store = createHistoryStore({
    pool: fake.pool,
    mediaStore: { async getMany() { throw new Error('base TMDB indisponible'); } },
  });

  await store.recordProgress(OWNER, { mediaType: 'tv', tmdbId: 1399, season: 1, episode: 3, position: 99, duration: 100, updatedAt: AT });

  const values = insertedValues(fake.callsMatching('INSERT INTO watch_history')[0]);
  assert.equal(values.season, 1);
  assert.equal(values.episode, 3);
  assert.equal(values.finished, 0);
});

test('listContinue : 2 lignes → ordre du SELECT, ORDER BY last_watched_at DESC, sans LIMIT', async () => {
  const older = new Date('2026-10-10T10:00:00.000Z');
  const fake = createFakeHistoryPool((sql) => {
    if (sql.includes('FROM watch_history')) {
      return [
        { media_type: 'tv', tmdb_id: 1399, season: 2, episode: 1, last_watched_at: AT },
        { media_type: 'movie', tmdb_id: 550, season: null, episode: null, last_watched_at: older },
      ];
    }
    if (sql.includes('FROM watch_progress')) {
      return [
        { media_type: 'tv', tmdb_id: 1399, season: 2, episode: 1, position_sec: 120, duration_sec: 3000 },
        { media_type: 'movie', tmdb_id: 550, season: 0, episode: 0, position_sec: 600, duration_sec: 8000 },
      ];
    }
    return undefined;
  });
  const media = fakeMediaStore(
    { 'tv:1399': { mediaType: 'tv', tmdbId: 1399, title: 'GoT', overview: 'Hiver.', posterPath: '/got.jpg', backdropPath: null, year: 2011, rating: 8.5, status: 'Ended', seasons: null } },
    { '1399:2': { 1: { episode: 1, name: 'Le Nord', overview: 'Suite.', stillPath: '/s2e1.jpg' } } },
  );
  const store = createHistoryStore({ pool: fake.pool, mediaStore: media });

  const items = await store.listContinue(OWNER, 'en-US');

  const select = fake.callsMatching('FROM watch_history')[0];
  assert.match(select.sql, /ORDER BY last_watched_at DESC/);
  assert.doesNotMatch(select.sql, /LIMIT/i);
  assert.match(select.sql, /finished = 0 AND hidden = 0/);
  assert.deepEqual(select.params, ['oauth', 'u-1', 'p-1']);

  // Égalité de date : ordre stable par type puis id, tout en DESC pour que
  // l'index idx_history_recent (qui se termine par la clé primaire) donne
  // l'ordre directement, sans tri.
  assert.match(select.sql, /ORDER BY last_watched_at DESC, media_type DESC, tmdb_id DESC$/);

  // Liste IN de longueur variable : `query` (pas une requête préparée par longueur).
  const progressSelect = fake.callsMatching('FROM watch_progress');
  assert.equal(progressSelect.length, 1);
  assert.equal(progressSelect[0].method, 'query');
  assert.match(progressSelect[0].sql, /IN \(\(\?, \?, \?, \?\), \(\?, \?, \?, \?\)\)/);
  assert.equal(media.calls.getMany.length, 1);
  assert.equal(media.calls.getMany[0].language, 'en-US');
  assert.deepEqual(media.calls.getEpisodes, [{ tmdbId: 1399, season: 2, language: 'en-US' }]);

  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    mediaType: 'tv', tmdbId: 1399, season: 2, episode: 1, position: 120, duration: 3000,
    lastWatchedAt: AT.toISOString(), title: 'GoT', overview: 'Hiver.', posterPath: '/got.jpg',
    backdropPath: null, year: 2011, rating: 8.5, episodeName: 'Le Nord', episodeOverview: 'Suite.', stillPath: '/s2e1.jpg',
    animeMode: false,
  });
  assert.equal(items[1].tmdbId, 550);
  assert.equal(items[1].title, null);
  assert.equal(items[1].position, 600);
  assert.equal(items[1].season, null);
  assert.equal(items[1].animeMode, false);
});

test('listContinue : mode anime (dernière ligne wrapped « anime ») → animeMode et infos d\'épisode TMDB à null, sans lecture d\'épisodes', async () => {
  const fake = createFakeHistoryPool((sql) => {
    if (sql.includes('FROM wrapped_viewing_data')) {
      return [
        { content_type: 'tv', content_id: '37854', season_number: 1, episode_number: 1, seconds: '600', last_at: new Date('2026-10-01T10:00:00Z') },
        { content_type: 'anime', content_id: '37854', season_number: 1, episode_number: 1000, seconds: '900', last_at: new Date('2026-10-15T10:00:00Z') },
        { content_type: 'anime', content_id: '1399', season_number: 1, episode_number: 1, seconds: '60', last_at: new Date('2026-10-01T10:00:00Z') },
        { content_type: 'tv', content_id: '1399', season_number: 1, episode_number: 1, seconds: '60', last_at: new Date('2026-10-15T10:00:00Z') },
      ];
    }
    if (sql.includes('FROM watch_history')) {
      return [
        { media_type: 'tv', tmdb_id: 37854, season: 1, episode: 1000, last_watched_at: AT },
        { media_type: 'tv', tmdb_id: 1399, season: 1, episode: 1, last_watched_at: AT },
        { media_type: 'tv', tmdb_id: 4242, season: 1, episode: 1, last_watched_at: AT },
      ];
    }
    if (sql.includes('FROM watch_progress')) {
      return [{ media_type: 'tv', tmdb_id: 37854, season: 1, episode: 1000, position_sec: 300, duration_sec: 1440 }];
    }
    return undefined;
  });
  const media = fakeMediaStore({}, {
    '37854:1': { 1000: { episode: 1000, name: 'Faux', overview: 'Faux', stillPath: '/faux.jpg' } },
    '1399:1': { 1: { episode: 1, name: 'L\'hiver vient', stillPath: '/s1e1.jpg' } },
  });
  const store = createHistoryStore({ pool: fake.pool, mediaStore: media });

  const items = await store.listContinue(OWNER, 'fr-FR');
  const byId = new Map(items.map((item) => [item.tmdbId, item]));

  // Dernière ligne « anime » : mode anime, numéros anime-sama gardés, infos TMDB nulles.
  assert.equal(byId.get(37854).animeMode, true);
  assert.deepEqual([byId.get(37854).season, byId.get(37854).episode, byId.get(37854).position], [1, 1000, 300]);
  assert.deepEqual([byId.get(37854).episodeName, byId.get(37854).episodeOverview, byId.get(37854).stillPath], [null, null, null]);
  // Dernière ligne « tv » → faux ; aucune ligne → faux.
  assert.equal(byId.get(1399).animeMode, false);
  assert.equal(byId.get(1399).episodeName, 'L\'hiver vient');
  assert.equal(byId.get(4242).animeMode, false);
  assert.equal(media.calls.getEpisodes.some((call) => call.tmdbId === 37854), false);
  // Même lecture wrapped que l'onglet, filtrée sur le propriétaire.
  assert.deepEqual(fake.callsMatching('FROM wrapped_viewing_data')[0].params, ['u-1', 'p-1']);
});

test('listContinue : lecture wrapped en panne → « Reprendre » servi, animeMode partout à false ; lectures lancées ensemble', async (t) => {
  t.mock.method(console, 'error', () => {});
  const order = [];
  const fake = createFakeHistoryPool((sql) => {
    if (sql.includes('FROM wrapped_viewing_data')) {
      order.push('wrapped');
      throw new Error("Table 'wrapped_viewing_data' doesn't exist");
    }
    if (sql.includes('FROM watch_history')) {
      // Réponse différée : en série, la lecture wrapped attendrait celle-ci.
      return new Promise((resolve) => setImmediate(() => {
        order.push('history');
        resolve([{ media_type: 'tv', tmdb_id: 37854, season: 1, episode: 1000, last_watched_at: AT }]);
      }));
    }
    if (sql.includes('FROM watch_progress')) return [];
    return undefined;
  });
  const store = createHistoryStore({ pool: fake.pool, mediaStore: fakeMediaStore() });

  const items = await store.listContinue(OWNER, 'fr-FR');

  assert.equal(items.length, 1);
  assert.equal(items[0].animeMode, false);
  // Les deux lectures partent ensemble : wrapped est lancée avant la réponse de l'historique.
  assert.deepEqual(order, ['wrapped', 'history']);
});

test('titre masqué : seule une écriture strictement plus récente le fait réapparaître', async () => {
  const fake = createFakeHistoryPool();
  const store = createHistoryStore({ pool: fake.pool, mediaStore: fakeMediaStore() });

  await store.recordProgress(OWNER, { mediaType: 'movie', tmdbId: 550, season: 0, episode: 0, position: 10, duration: 100, updatedAt: AT });
  await store.touch(OWNER, { mediaType: 'movie', tmdbId: 550, at: AT });

  const upserts = fake.callsMatching('INSERT INTO watch_history');
  assert.equal(upserts.length, 2);
  for (const call of upserts) {
    // Un renvoi au même horodatage (synchro d'une clé inchangée) ne démasque pas.
    assert.match(call.sql, /hidden = IF\(VALUES\(last_watched_at\) > last_watched_at, 0, hidden\)/);
    assert.doesNotMatch(call.sql, /hidden = IF\(VALUES\(last_watched_at\) >= /);
    // Le pointeur et `finished` gardent la règle « au moins aussi récent ».
    assert.match(call.sql, /season = IF\(VALUES\(last_watched_at\) >= last_watched_at/);
    assert.match(call.sql, /finished = IF\(VALUES\(last_watched_at\) >= last_watched_at/);
  }
});

test('touch, hide et listProgress : requêtes paramétrées par propriétaire', async () => {
  const fake = createFakeHistoryPool((sql) => {
    if (sql.includes('FROM watch_progress')) {
      return [{ season: 1, episode: 2, position_sec: 30, duration_sec: 60, updated_at: AT }];
    }
    return undefined;
  });
  const store = createHistoryStore({ pool: fake.pool, mediaStore: fakeMediaStore() });

  await store.touch(OWNER, { mediaType: 'tv', tmdbId: 1399, season: 1, episode: 2, at: AT });
  const touch = fake.callsMatching('INSERT INTO watch_history')[0];
  const values = insertedValues(touch);
  assert.equal(values.finished, 0);
  assert.equal(values.hidden, 0);
  assert.equal(values.season, 1);
  assert.match(touch.sql, /ON DUPLICATE KEY UPDATE/);

  await store.hide(OWNER, 'movie', 550);
  const hide = fake.callsMatching('UPDATE watch_history SET hidden = 1')[0];
  assert.deepEqual(hide.params, ['oauth', 'u-1', 'p-1', 'movie', 550]);

  const progress = await store.listProgress(OWNER, 'tv', 1399);
  assert.deepEqual(progress, [{ season: 1, episode: 2, position: 30, duration: 60, updatedAt: AT.toISOString() }]);
});

test('hideAll masque toutes les cartes visibles du profil en une seule requête', async () => {
  const fake = createFakeHistoryPool((sql) => (
    sql.includes('UPDATE watch_history SET hidden = 1') ? { affectedRows: 7 } : undefined
  ));
  const store = createHistoryStore({ pool: fake.pool, mediaStore: fakeMediaStore() });

  assert.equal(await store.hideAll(OWNER), 7);
  assert.equal(fake.calls.length, 1);
  const call = fake.calls[0];
  assert.equal(
    call.sql,
    'UPDATE watch_history SET hidden = 1 WHERE user_type = ? AND user_id = ? AND profile_id = ? AND hidden = 0',
  );
  assert.deepEqual(call.params, ['oauth', 'u-1', 'p-1']);
});

// --- Onglet « Historique » (listHistory, contrat v2) ---

// n minutes avant le 16 octobre 2026 à 12 h : dates distinctes, ordre connu.
const T = (minutes) => new Date(Date.UTC(2026, 9, 16, 12, 0, 0) - minutes * 60 * 1000);
const OLD = new Date('2026-10-01T00:00:00.000Z');
const hist = (mediaType, tmdbId, { season = null, episode = null, finished = 0, at = AT } = {}) => (
  { media_type: mediaType, tmdb_id: tmdbId, season, episode, finished, last_watched_at: at }
);
const prog = (mediaType, tmdbId, season, episode, position, duration) => (
  { media_type: mediaType, tmdb_id: tmdbId, season, episode, position_sec: position, duration_sec: duration }
);
const mark = (mediaType, tmdbId, season, episode, at = AT) => (
  { media_type: mediaType, tmdb_id: tmdbId, season, episode, marked_at: at }
);
// Ligne agrégée de wrapped_viewing_data (SUM → DECIMAL en texte, content_id en texte).
const view = (contentType, contentId, seconds, season = null, episode = null, lastAt = null) => (
  { content_type: contentType, content_id: String(contentId), season_number: season, episode_number: episode, seconds: String(seconds), last_at: lastAt }
);
const query = (status, extra = {}) => ({ status, language: 'fr-FR', page: 1, pageSize: 50, ...extra });
const pick = (item) => ({
  finished: item.finished, estimated: item.estimated, markedWatched: item.markedWatched, position: item.position, duration: item.duration,
});

// Faux pool de l'onglet : les 4 lectures du profil (historique, positions,
// marques, temps des lecteurs web) ; les écritures réussissent.
function overviewPool({ history = [], progress = [], marks = [], viewing = [], viewingError = null } = {}) {
  return createFakeHistoryPool((sql) => {
    if (!sql.startsWith('SELECT')) return undefined;
    if (sql.includes('FROM wrapped_viewing_data')) {
      if (viewingError) throw viewingError;
      return viewing;
    }
    if (sql.includes('FROM watch_marks')) return marks;
    if (sql.includes('FROM watch_history')) return history;
    if (sql.includes('FROM watch_progress')) return progress;
    return [];
  });
}

// Les trois onglets d'un coup : ids par statut, lignes par id, chiffres.
async function allTabs(store, owner = OWNER) {
  const tabs = {};
  const items = new Map();
  let last;
  for (const status of ['in_progress', 'finished', 'not_started']) {
    last = await store.listHistory(owner, query(status));
    tabs[status] = last.items.map((item) => item.tmdbId);
    assert.equal(last.total, last.items.length, status);
    for (const item of last.items) items.set(item.tmdbId, item);
  }
  return { tabs, items, counts: last.counts, stats: last.stats };
}

test('listHistory : films — exact, estimé (lecteur web) ou marqué « Déjà vu », seuils 5 % et 95 %', async () => {
  const fake = overviewPool({
    history: [
      hist('movie', 101, { at: T(1) }), hist('movie', 102, { at: T(2) }), hist('movie', 103, { at: T(3) }),
      hist('movie', 104, { at: T(4) }), hist('movie', 106, { at: T(6) }), hist('movie', 107, { at: T(7), finished: 1 }),
      hist('movie', 108, { at: T(8) }), hist('movie', 109, { at: T(9) }), hist('movie', 110, { at: T(10) }),
    ],
    progress: [
      prog('movie', 101, 0, 0, 3, 100), // exact 3 % → non démarré
      prog('movie', 102, 0, 0, 50, 100), // exact 50 % → en cours
      prog('movie', 106, 0, 0, 50, 100), // exact : l'estimé (97 %) ne sert pas
      prog('movie', 107, 0, 0, 30, 100), // finished = 1 dans l'historique
      prog('movie', 110, 0, 0, 0, 5000), // lancé puis arrêté à 0 s
    ],
    // « Déjà vu » sans historique ni progression.
    marks: [mark('movie', 105, 0, 0, T(5))],
    viewing: [
      view('movie', 103, 3600), // 50 % de 120 min → en cours, estimé
      view('movie', 104, 6912), // 96 % → terminé, estimé
      view('movie', 106, 7000),
      view('movie', 108, 216), // 3 % → non démarré
      view('movie', 109, 5000), // durée inconnue → rien à estimer
    ],
  });
  const movie = (tmdbId, runtimeMinutes) => ({ mediaType: 'movie', tmdbId, title: `Film ${tmdbId}`, runtimeMinutes, seasons: null });
  const media = fakeMediaStore({
    'movie:103': movie(103, 120), 'movie:104': movie(104, 120), 'movie:105': movie(105, 90), 'movie:106': movie(106, 120),
    'movie:108': movie(108, 120), 'movie:109': movie(109, null),
  });
  const store = createHistoryStore({ pool: fake.pool, mediaStore: media });

  const { tabs, items, counts, stats } = await allTabs(store);

  assert.deepEqual(tabs, {
    in_progress: [102, 103, 106],
    finished: [104, 105, 107],
    not_started: [101, 108, 109, 110],
  });
  // Un seul statut par titre : les compteurs font le nombre de titres.
  assert.deepEqual(counts, { inProgress: 3, finished: 3, notStarted: 4 });

  const none = { finished: false, estimated: false, markedWatched: false };
  assert.deepEqual(pick(items.get(101)), { ...none, position: 3, duration: 100 });
  assert.deepEqual(pick(items.get(102)), { ...none, position: 50, duration: 100 });
  assert.deepEqual(pick(items.get(103)), { ...none, estimated: true, position: 3600, duration: 7200 });
  assert.deepEqual(pick(items.get(104)), { ...none, finished: true, estimated: true, position: 6912, duration: 7200 });
  // Film marqué sans aucune progression : ni position ni durée.
  assert.deepEqual(pick(items.get(105)), { finished: true, estimated: false, markedWatched: true, position: null, duration: null });
  assert.equal(items.get(105).lastWatchedAt, T(5).toISOString());
  assert.equal(items.get(105).title, 'Film 105');
  assert.deepEqual(pick(items.get(106)), { ...none, position: 50, duration: 100 });
  assert.deepEqual(pick(items.get(107)), { ...none, finished: true, position: 30, duration: 100 });
  assert.deepEqual(pick(items.get(108)), { ...none, estimated: true, position: 216, duration: 7200 });
  assert.deepEqual(pick(items.get(109)), { ...none, position: 0, duration: 0 });
  assert.deepEqual(pick(items.get(110)), { ...none, position: 0, duration: 5000 });
  for (const item of items.values()) {
    assert.equal(item.episodesWatched, null);
    assert.equal(item.episodesTotal, null);
    assert.equal(item.season, null);
  }

  // Exact : 3 + 50 + 50 + 30 + 0 ; lecteur web sans exact : 3600 + 6912 + 216
  // + 5000 (durée inconnue : pas de borne).
  // Temps réel du lecteur web : 3600 + 6912 + 7000 + 216 + 5000 (exact ou non).
  assert.deepEqual(stats, { watchedSeconds: 15861, trackedSeconds: 22728, moviesFinished: 3, episodesFinished: 0 });

  // Classement : TMDB seulement pour les films à estimer, les plus récents d'abord.
  assert.deepEqual(media.calls.getMany[0].items.map((item) => item.tmdbId), [103, 104, 108, 109]);
});

test('listHistory : séries — épisode vu (exact > 85 %, marque, estimé ≥ 85 %), démarrée à 5 %, terminée', async () => {
  const fake = overviewPool({
    history: [
      hist('tv', 201, { season: 1, episode: 3, at: T(1) }),
      hist('tv', 203, { at: T(3) }),
      hist('tv', 204, { season: 1, episode: 2, at: T(4) }),
      hist('tv', 205, { season: 1, episode: 1, at: T(5) }),
      hist('tv', 207, { season: 2, episode: 3, finished: 1, at: T(8) }),
      hist('tv', 208, { season: 1, episode: 2, at: T(9) }),
      hist('tv', 209, { season: 1, episode: 1, at: T(10) }),
      hist('tv', 210, { season: 1, episode: 1, at: T(11) }),
      hist('tv', 211, { at: T(12) }),
    ],
    progress: [
      prog('tv', 201, 1, 3, 2900, 3000), // 96,7 % > 85 % → vu
      prog('tv', 205, 1, 1, 90, 3000), // 3 % → pas démarrée
      prog('tv', 208, 1, 1, 2580, 3000), // 86 % → vu
      prog('tv', 208, 1, 2, 2550, 3000), // 85 % pile : pas vu (> 85 % exigé), mais démarrée
    ],
    marks: [
      mark('tv', 201, 1, 1, T(40)),
      mark('tv', 202, 0, 0, T(2)), // série entière vue, sans historique
      mark('tv', 203, 0, 0, T(30)), // l'historique, plus récent, donne la date
      mark('tv', 206, 1, 1, T(7)), mark('tv', 206, 1, 2, T(6)), // marques seules
      mark('tv', 210, 0, 1, T(50)), mark('tv', 210, 1, 1, T(50)), // S0E1 : épisode spécial, hors compte
      mark('tv', 211, 1, 1, T(60)), mark('tv', 211, 1, 2, T(60)), mark('tv', 211, 1, 3, T(60)),
    ],
    viewing: [
      view('tv', 201, 2160, 1, 2), // 90 % de 40 min (durée de l'épisode) → vu
      view('tv', 204, 1200, 1, 2), // 50 % de 40 min (durée type de la série) → démarrée, estimé
      view('tv', 209, 2040, 1, 1), // 85 % pile → vu (estimé ≥ 85 %)
    ],
  });
  const show = (tmdbId, episodes, runtimeMinutes = null) => (
    { mediaType: 'tv', tmdbId, title: `Série ${tmdbId}`, runtimeMinutes, seasons: [{ season: 1, episodes }] }
  );
  const media = fakeMediaStore({
    'tv:201': show(201, 3), 'tv:202': show(202, 10), 'tv:204': show(204, 8, 40), 'tv:205': show(205, 8), 'tv:206': show(206, 8),
    'tv:207': show(207, 8), 'tv:208': show(208, 10), 'tv:209': show(209, 10, 40), 'tv:210': show(210, 5), 'tv:211': show(211, 2),
  }, {
    '201:1': {
      2: { episode: 2, name: 'Deux', runtimeMinutes: 40 },
      3: { episode: 3, name: 'Trois', overview: 'Fin.', stillPath: '/s1e3.jpg', runtimeMinutes: 40 },
    },
    '204:1': { 2: { episode: 2, name: 'Sans durée', runtimeMinutes: null } },
  });
  const store = createHistoryStore({ pool: fake.pool, mediaStore: media });

  const { tabs, items, counts, stats } = await allTabs(store);

  assert.deepEqual(tabs, {
    in_progress: [204, 206, 208, 209, 210],
    finished: [201, 202, 203, 207, 211],
    not_started: [205],
  });
  assert.deepEqual(counts, { inProgress: 5, finished: 5, notStarted: 1 });

  // Tous les épisodes vus (marque + estimé + exact) → terminée ; ligne
  // enrichie comme « Reprendre ».
  assert.deepEqual(items.get(201), {
    mediaType: 'tv', tmdbId: 201, season: 1, episode: 3, position: 2900, duration: 3000,
    lastWatchedAt: T(1).toISOString(), title: 'Série 201', overview: null, posterPath: null,
    backdropPath: null, year: null, rating: null, episodeName: 'Trois', episodeOverview: 'Fin.', stillPath: '/s1e3.jpg',
    finished: true, estimated: false, markedWatched: false, episodesWatched: 3, episodesTotal: 3, animeMode: false,
  });
  const series = (id) => {
    const item = items.get(id);
    return {
      season: item.season, episode: item.episode, position: item.position, duration: item.duration,
      estimated: item.estimated, markedWatched: item.markedWatched, episodesWatched: item.episodesWatched, episodesTotal: item.episodesTotal,
    };
  };
  // Marque « série entière vue » : terminée ; titre inconnu de TMDB gardé (title null).
  assert.equal(items.get(203).title, null);
  assert.equal(items.get(203).lastWatchedAt, T(3).toISOString());
  assert.deepEqual(series(203), { season: null, episode: null, position: 0, duration: 0, estimated: false, markedWatched: true, episodesWatched: 0, episodesTotal: null });
  // Épisode affiché estimé : durée de la série faute de durée d'épisode.
  assert.deepEqual(series(204), { season: 1, episode: 2, position: 1200, duration: 2400, estimated: true, markedWatched: false, episodesWatched: 0, episodesTotal: 8 });
  assert.deepEqual(series(205), { season: 1, episode: 1, position: 90, duration: 3000, estimated: false, markedWatched: false, episodesWatched: 0, episodesTotal: 8 });
  // Sans historique : date de la marque la plus récente, dernier épisode vu affiché.
  assert.equal(items.get(206).lastWatchedAt, T(6).toISOString());
  assert.deepEqual(series(206), { season: 1, episode: 2, position: 0, duration: 0, estimated: false, markedWatched: false, episodesWatched: 2, episodesTotal: 8 });
  assert.deepEqual(series(207), { season: 2, episode: 3, position: 0, duration: 0, estimated: false, markedWatched: false, episodesWatched: 0, episodesTotal: 8 });
  assert.deepEqual(series(208), { season: 1, episode: 2, position: 2550, duration: 3000, estimated: false, markedWatched: false, episodesWatched: 1, episodesTotal: 10 });
  assert.deepEqual(series(209), { season: 1, episode: 1, position: 2040, duration: 2400, estimated: true, markedWatched: false, episodesWatched: 1, episodesTotal: 10 });
  // Saison 0 hors compte ; vus au-delà du total : bornés au total.
  assert.equal(series(210).episodesWatched, 1);
  assert.deepEqual([series(211).episodesWatched, series(211).episodesTotal], [2, 2]);

  // Exact : 2900 + 90 + 2580 + 2550 ; lecteur web sans exact : 2160 + 1200 + 2040.
  // Épisodes : 3 + 10 (série marquée) + 2 + 1 + 1 + 1 + 2.
  assert.deepEqual(stats, { watchedSeconds: 13520, trackedSeconds: 5400, moviesFinished: 0, episodesFinished: 20 });

  // Durées d'épisodes : une seule lecture groupée des saisons à estimer,
  // séries les plus récentes d'abord.
  assert.deepEqual(media.calls.getEpisodeRuntimes, [{
    seasons: [{ tmdbId: 201, season: 1 }, { tmdbId: 204, season: 1 }, { tmdbId: 209, season: 1 }],
    language: 'fr-FR',
  }]);
});

test('listHistory : série marquée « Déjà vu » en entier → episodesWatched = episodesTotal (si connu), compté dans episodesFinished', async () => {
  const fake = overviewPool({
    history: [hist('tv', 1399, { season: 1, episode: 2, at: T(1) })],
    progress: [prog('tv', 1399, 1, 1, 2900, 3000)],
    marks: [mark('tv', 1399, 0, 0, T(5)), mark('tv', 4242, 0, 0, T(6)), mark('tv', 4242, 1, 1, T(7))],
  });
  const media = fakeMediaStore({
    'tv:1399': { mediaType: 'tv', tmdbId: 1399, title: 'GoT', seasons: [{ season: 1, episodes: 10 }, { season: 2, episodes: 8 }] },
  });
  const store = createHistoryStore({ pool: fake.pool, mediaStore: media });

  const { tabs, items, stats } = await allTabs(store);

  assert.deepEqual(tabs.finished, [1399, 4242]);
  // Total connu : toute la série compte comme vue.
  assert.deepEqual([items.get(1399).episodesWatched, items.get(1399).episodesTotal, items.get(1399).markedWatched], [18, 18, true]);
  // Total inconnu : seuls les épisodes vus comptent.
  assert.deepEqual([items.get(4242).episodesWatched, items.get(4242).episodesTotal, items.get(4242).markedWatched], [1, null, true]);
  assert.equal(stats.episodesFinished, 19);
});

test('listHistory : 4 lectures du profil, temps des lecteurs web filtré comme GET /api/wrapped/progress', async (t) => {
  t.mock.method(console, 'error', () => {});
  const fake = overviewPool({
    history: [hist('movie', 550)],
    viewing: [view('movie', 550, 600), view('movie', 'abc', 100), view('tv', 1399, 500), view('anime', 5, 100), view('live-tv', 9, 100)],
  });
  const media = fakeMediaStore({ 'movie:550': { mediaType: 'movie', tmdbId: 550, title: 'Fight Club', runtimeMinutes: 100, seasons: null } });
  const store = createHistoryStore({ pool: fake.pool, mediaStore: media });

  const result = await store.listHistory(OWNER, query('in_progress'));

  const selects = fake.calls.filter((call) => call.sql.startsWith('SELECT'));
  assert.deepEqual(selects.map((call) => call.sql), [
    'SELECT media_type, tmdb_id, season, episode, finished, last_watched_at FROM watch_history WHERE user_type = ? AND user_id = ? AND profile_id = ?',
    'SELECT media_type, tmdb_id, season, episode, position_sec, duration_sec FROM watch_progress WHERE user_type = ? AND user_id = ? AND profile_id = ?',
    'SELECT media_type, tmdb_id, season, episode, marked_at FROM watch_marks WHERE user_type = ? AND user_id = ? AND profile_id = ?',
    "SELECT content_type, content_id, season_number, episode_number, SUM(watch_duration) AS seconds, MAX(created_at) AS last_at FROM wrapped_viewing_data WHERE user_id = ? AND profile_id <=> ? AND content_type IN ('movie', 'tv', 'anime') GROUP BY content_type, content_id, season_number, episode_number",
  ]);
  for (const call of selects.slice(0, 3)) assert.deepEqual(call.params, ['oauth', 'u-1', 'p-1']);
  assert.deepEqual(selects[3].params, ['u-1', 'p-1']);
  // Masqués compris : aucune lecture ne filtre `hidden`.
  for (const call of selects) assert.doesNotMatch(call.sql, /hidden/);
  // 600 s sur 100 min = 10 % → en cours, estimé. Id illisible, série sans
  // épisode, autre type : ignorés.
  assert.deepEqual(pick(result.items[0]), { finished: false, estimated: true, markedWatched: false, position: 600, duration: 6000 });
  assert.equal(result.stats.watchedSeconds, 600);
  // Temps réel sur la page du lecteur : toutes les lignes film/série
  // (id illisible et série sans épisode compris), anime compté comme série,
  // jamais la télé en direct.
  assert.equal(result.stats.trackedSeconds, 1300);

  // Table wrapped absente ou en panne : pas d'estimation, pas d'erreur.
  const broken = overviewPool({ history: [hist('movie', 550)], viewingError: new Error("Table 'wrapped_viewing_data' doesn't exist") });
  const fallback = await createHistoryStore({ pool: broken.pool, mediaStore: media }).listHistory(OWNER, query('not_started'));
  assert.deepEqual(fallback.items.map((item) => item.tmdbId), [550]);
  assert.equal(fallback.stats.watchedSeconds, 0);
  assert.equal(fallback.stats.trackedSeconds, 0);
});

test('listHistory : mode anime — pas de total ni d\'infos d\'épisode TMDB, terminé seulement par marque ou fin, épisodes vus comptés sans plafond', async () => {
  const OLDER = new Date('2026-10-01T10:00:00Z');
  const NEWER = new Date('2026-10-15T10:00:00Z');
  const fake = overviewPool({
    history: [
      hist('tv', 37854, { season: 1, episode: 1000, at: T(1) }), // One Piece en numérotation absolue
      hist('tv', 1399, { season: 1, episode: 2, at: T(2) }),
      hist('tv', 500, { at: T(3) }),
      hist('tv', 501, { at: T(4) }),
    ],
    progress: [
      prog('tv', 37854, 1, 1000, 300, 1440), // 20 % → démarrée
      prog('tv', 1399, 1, 1, 2900, 3000),
      prog('tv', 1399, 1, 2, 2900, 3000),
    ],
    marks: [
      mark('tv', 37854, 1, 998, T(10)), mark('tv', 37854, 1, 999, T(10)), mark('tv', 37854, 0, 1, T(10)),
      mark('tv', 501, 0, 0, T(9)), // série entière marquée
    ],
    viewing: [
      view('tv', 37854, 600, 1, 1, OLDER), view('anime', 37854, 900, 1, 1000, NEWER),
      view('anime', 1399, 60, 1, 1, OLDER), view('tv', 1399, 60, 1, 1, NEWER),
      view('anime', 501, 60, 1, 1, NEWER),
    ],
  });
  const show = (tmdbId, episodes) => ({ mediaType: 'tv', tmdbId, title: `Série ${tmdbId}`, runtimeMinutes: 24, seasons: [{ season: 1, episodes }] });
  const media = fakeMediaStore(
    { 'tv:37854': show(37854, 2), 'tv:1399': show(1399, 2), 'tv:500': show(500, 8), 'tv:501': show(501, 10) },
    { '37854:1': { 1000: { episode: 1000, name: 'Faux', stillPath: '/faux.jpg', runtimeMinutes: 24 } }, '1399:1': { 2: { episode: 2, name: 'Deux', runtimeMinutes: 50 } } },
  );
  const store = createHistoryStore({ pool: fake.pool, mediaStore: media });

  const { tabs, items, stats } = await allTabs(store);

  // 37854 : 2 épisodes vus pour un total TMDB de 2, mais mode anime → pas
  // de fin par le compte ; démarrée par la position exacte.
  assert.deepEqual(tabs.in_progress, [37854]);
  assert.deepEqual(tabs.finished, [1399, 501]);
  assert.deepEqual(tabs.not_started, [500]);
  const anime = items.get(37854);
  assert.equal(anime.animeMode, true);
  assert.deepEqual([anime.season, anime.episode, anime.position, anime.duration], [1, 1000, 300, 1440]);
  assert.deepEqual([anime.episodeName, anime.episodeOverview, anime.stillPath, anime.episodesTotal], [null, null, null, null]);
  // Épisodes vus : marques 998 et 999 (S0E1 hors compte), sans plafond.
  assert.equal(anime.episodesWatched, 2);
  // Dernière ligne « tv » → mode normal ; aucune ligne → normal.
  assert.equal(items.get(1399).animeMode, false);
  assert.equal(items.get(1399).episodeName, 'Deux');
  assert.equal(items.get(500).animeMode, false);
  // Série entière marquée en mode anime : terminée, total inconnu.
  assert.deepEqual([items.get(501).animeMode, items.get(501).finished, items.get(501).episodesTotal], [true, true, null]);
  assert.equal(stats.episodesFinished, 2 + 2 + 0 + 0);
  // Aucune lecture TMDB de saison pour les titres en mode anime.
  for (const call of media.calls.getEpisodeRuntimes) {
    assert.equal(call.seasons.some((season) => season.tmdbId === 37854 || season.tmdbId === 501), false);
  }
  assert.equal(media.calls.getEpisodes.some((call) => call.tmdbId === 37854 || call.tmdbId === 501), false);
});

test('listHistory : numérotations jamais mêlées — épisodes estimés seulement avec les lignes du mode de la série (One Piece, dans les deux sens)', async () => {
  const OLDER = new Date('2026-10-01T10:00:00Z');
  const NEWER = new Date('2026-10-15T10:00:00Z');
  const show = (tmdbId, episodes) => ({ mediaType: 'tv', tmdbId, title: `Série ${tmdbId}`, runtimeMinutes: 24, seasons: [{ season: 1, episodes }] });

  // Mode anime (lignes anime plus récentes) : E1-E3 en numérotation
  // anime-sama ; une vieille ligne « tv » S1E5 (numérotation TMDB) est ignorée.
  const anime = overviewPool({
    history: [hist('tv', 37854, { season: 1, episode: 3, at: T(1) })],
    viewing: [
      view('anime', 37854, 1440, 1, 1, NEWER), view('anime', 37854, 1440, 1, 2, NEWER), view('anime', 37854, 1440, 1, 3, NEWER),
      view('tv', 37854, 1440, 1, 5, OLDER),
    ],
  });
  const animeTabs = await allTabs(createHistoryStore({ pool: anime.pool, mediaStore: fakeMediaStore({ 'tv:37854': show(37854, 1100) }) }));
  assert.equal(animeTabs.items.get(37854).animeMode, true);
  assert.equal(animeTabs.items.get(37854).episodesWatched, 3);
  // Toutes les lignes comptent dans le temps réel ; le temps vu suit les lignes utilisées.
  assert.equal(animeTabs.stats.trackedSeconds, 4 * 1440);
  assert.equal(animeTabs.stats.watchedSeconds, 3 * 1440);

  // Mode normal (ligne tv plus récente) : une vieille ligne anime S1E1000 ne
  // crée pas d'épisode TMDB fantôme ni de fin par le compte (total 2).
  const tv = overviewPool({
    history: [hist('tv', 37854, { season: 1, episode: 1, at: T(1) })],
    viewing: [view('tv', 37854, 1440, 1, 1, NEWER), view('anime', 37854, 1440, 1, 2, OLDER)],
  });
  const tvTabs = await allTabs(createHistoryStore({ pool: tv.pool, mediaStore: fakeMediaStore({ 'tv:37854': show(37854, 2) }) }));
  assert.equal(tvTabs.items.get(37854).animeMode, false);
  assert.deepEqual(tvTabs.tabs.in_progress, [37854]);
  assert.deepEqual([tvTabs.items.get(37854).episodesWatched, tvTabs.items.get(37854).episodesTotal], [1, 2]);
  assert.equal(tvTabs.stats.trackedSeconds, 2 * 1440);
  assert.equal(tvTabs.stats.watchedSeconds, 1440);
});

test('listHistory : tri date ↓ puis type ↓ puis id ↓, pagination en mémoire, statut inconnu refusé', async () => {
  const fake = overviewPool({ history: [hist('movie', 550), hist('tv', 100), hist('tv', 1399), hist('movie', 13, { at: OLD })] });
  const store = createHistoryStore({ pool: fake.pool, mediaStore: fakeMediaStore() });
  const ids = (result) => result.items.map((item) => `${item.mediaType}:${item.tmdbId}`);

  const first = await store.listHistory(OWNER, query('not_started', { pageSize: 2 }));
  assert.deepEqual(ids(first), ['tv:1399', 'tv:100']);
  assert.equal(first.total, 4);
  const second = await store.listHistory(OWNER, query('not_started', { page: 2, pageSize: 2 }));
  assert.deepEqual(ids(second), ['movie:550', 'movie:13']);
  const beyond = await store.listHistory(OWNER, query('not_started', { page: 3, pageSize: 2 }));
  assert.deepEqual([beyond.items, beyond.total], [[], 4]);
  // Un seul calcul pour les trois pages (mémoire de 30 s).
  assert.equal(fake.callsMatching(/^SELECT .* FROM watch_history/).length, 1);

  await assert.rejects(store.listHistory(OWNER, query('all')), /statut/i);
});

test('listHistory : classement gardé 30 s par profil et langue, oublié à chaque écriture du profil', async () => {
  let time = 1_000_000;
  const fake = overviewPool({ history: [hist('movie', 550)] });
  const store = createHistoryStore({ pool: fake.pool, mediaStore: fakeMediaStore(), now: () => time });
  const loads = () => fake.callsMatching(/^SELECT .* FROM watch_marks/).length;

  await store.listHistory(OWNER, query('not_started'));
  await store.listHistory(OWNER, query('finished', { page: 2 }));
  assert.equal(loads(), 1);
  await store.listHistory(OWNER, query('finished', { language: 'en-US' }));
  assert.equal(loads(), 2);

  // Un autre profil a son propre classement ; l'écrire n'oublie pas celui-ci.
  const other = { ...OWNER, profileId: 'p-2' };
  await store.listHistory(other, query('finished'));
  await store.hide(other, 'movie', 550);
  await store.listHistory(OWNER, query('finished'));
  assert.equal(loads(), 3);

  // Toute écriture du profil oublie son classement (les deux langues).
  const writes = {
    recordProgress: () => store.recordProgress(OWNER, { mediaType: 'movie', tmdbId: 550, season: 0, episode: 0, position: 10, duration: 100, updatedAt: AT }),
    touch: () => store.touch(OWNER, { mediaType: 'movie', tmdbId: 550, at: AT }),
    hide: () => store.hide(OWNER, 'movie', 550),
    hideAll: () => store.hideAll(OWNER),
    addMarks: () => store.addMarks(OWNER, [{ mediaType: 'movie', tmdbId: 550, season: 0, episode: 0, markedAt: AT }]),
    removeMarks: () => store.removeMarks(OWNER, [{ mediaType: 'movie', tmdbId: 550, season: 0, episode: 0 }]),
    deleteProfile: () => store.deleteProfile(OWNER),
  };
  let expected = loads();
  for (const [name, write] of Object.entries(writes)) {
    await write();
    await store.listHistory(OWNER, query('finished'));
    await store.listHistory(OWNER, query('finished', { language: 'en-US' }));
    expected += 2;
    assert.equal(loads(), expected, name);
  }

  // Encore valable juste avant 30 s, recalculé après.
  time += 30 * 1000 - 1;
  await store.listHistory(OWNER, query('finished'));
  assert.equal(loads(), expected);
  time += 2;
  await store.listHistory(OWNER, query('finished'));
  assert.equal(loads(), expected + 1);
});

test('listHistory : durées d\'épisodes en une lecture groupée, séries récentes d\'abord (budget TMDB dans mediaStore)', async () => {
  const history = [];
  const viewing = [];
  for (let id = 1; id <= 301; id++) {
    history.push(hist('tv', id, { at: T(id) })); // la série 1 est la plus récente
    viewing.push(view('tv', id, 100, 1, 1));
  }
  const fake = overviewPool({ history, viewing });
  const media = fakeMediaStore();
  const store = createHistoryStore({ pool: fake.pool, mediaStore: media });

  const result = await store.listHistory(OWNER, query('not_started', { pageSize: 1 }));

  assert.equal(result.total, 301);
  // Plus de 300 lectures séparées : un seul appel groupé, ordre récent → ancien.
  assert.equal(media.calls.getEpisodes.length, 0);
  assert.equal(media.calls.getEpisodeRuntimes.length, 1);
  const { seasons } = media.calls.getEpisodeRuntimes[0];
  assert.equal(seasons.length, 301);
  assert.deepEqual([seasons[0], seasons[300]], [{ tmdbId: 1, season: 1 }, { tmdbId: 301, season: 1 }]);
});

test('listHistory : profil vide → listes vides, compteurs et chiffres à 0, sans appel TMDB', async () => {
  const fake = overviewPool();
  const media = fakeMediaStore();
  const store = createHistoryStore({ pool: fake.pool, mediaStore: media });

  const result = await store.listHistory(OWNER, query('in_progress'));

  assert.deepEqual(result, {
    items: [],
    total: 0,
    counts: { inProgress: 0, finished: 0, notStarted: 0 },
    stats: { watchedSeconds: 0, trackedSeconds: 0, moviesFinished: 0, episodesFinished: 0 },
  });
  assert.equal(media.calls.getMany.length + media.calls.getEpisodes.length, 0);
});

// --- Fiche d'un titre (GET /history/title) ---

test('titleDetails (pur) : film exact, estimé, marqué ; titre absent → null', () => {
  const index = buildIndex({
    historyRows: [hist('movie', 550, { at: T(1) }), hist('movie', 13, { at: T(2) })],
    progressRows: [prog('movie', 550, 0, 0, 1556, 7200)],
    markRows: [mark('movie', 105, 0, 0, T(3))],
    viewingRows: [view('movie', 13, 7000)],
  });
  const overview = classify(index, { media: new Map([['movie:13', { runtimeMinutes: 120 }]]) });

  assert.deepEqual(titleDetails(overview, 'movie', 550), {
    mediaType: 'movie', tmdbId: 550, status: 'in_progress', markedWatched: false, animeMode: false, estimated: false,
    position: 1556, duration: 7200, season: null, episode: null, episodesWatched: null, episodesTotal: null, episodes: null,
  });
  // 7000 s sur 120 min = 97 % → terminé, estimé.
  assert.deepEqual([titleDetails(overview, 'movie', 13).status, titleDetails(overview, 'movie', 13).estimated], ['finished', true]);
  const marked = titleDetails(overview, 'movie', 105);
  assert.deepEqual([marked.status, marked.markedWatched, marked.position, marked.duration], ['finished', true, null, null]);
  assert.equal(titleDetails(overview, 'movie', 999), null);
  assert.equal(titleDetails(overview, 'tv', 550), null);
});

test('titleDetails (pur) : position inconnue → null (film sans exact ni estimé, série sans épisode courant) ; épisodes construits à la demande', () => {
  const index = buildIndex({
    historyRows: [hist('movie', 14, { at: T(1) }), hist('tv', 500, { at: T(2) }), hist('tv', 501, { season: 1, episode: 2, at: T(3) })],
    progressRows: [prog('movie', 14, 0, 0, 0, 7000), prog('tv', 501, 1, 1, 2900, 3000)],
  });
  const overview = classify(index);

  const movie = titleDetails(overview, 'movie', 14);
  assert.deepEqual([movie.position, movie.duration, movie.status], [null, null, 'not_started']);
  const noEpisode = titleDetails(overview, 'tv', 500);
  assert.deepEqual([noEpisode.season, noEpisode.position, noEpisode.duration, noEpisode.episodes], [null, null, null, []]);
  // Épisode courant sans progression : position inconnue aussi.
  const pointer = titleDetails(overview, 'tv', 501);
  assert.deepEqual([pointer.season, pointer.episode, pointer.position, pointer.duration], [1, 2, null, null]);
  // L'onglet garde 0/0 (contrat v1) ; le classement ne contient pas de liste d'épisodes toute faite.
  const listed = overview.titles.find((title) => title.tmdbId === 14);
  assert.deepEqual([listed.position, listed.duration], [0, 7000]);
  assert.equal(overview.titles.some((title) => Array.isArray(title.episodes)), false);
});

test('titleDetails (pur) : série — un épisode par progression exacte, estimé (durée connue) ou marque, triés', () => {
  const index = buildIndex({
    historyRows: [hist('tv', 42009, { season: 7, episode: 5, at: T(1) })],
    progressRows: [
      prog('tv', 42009, 7, 5, 1556, 2873), // exact, en cours
      prog('tv', 42009, 7, 6, 5147, 5426), // exact 95 % → vu
      prog('tv', 42009, 7, 9, 0, 3000), // position 0 : pas un épisode connu
    ],
    markRows: [mark('tv', 42009, 7, 1, T(5)), mark('tv', 42009, 7, 6, T(5))],
    viewingRows: [
      view('tv', 42009, 2100, 7, 2), // estimé 87,5 % → vu
      view('tv', 42009, 600, 7, 3), // estimé 25 %
      view('tv', 42009, 900, 6, 1), // durée inconnue (épisode et série) → absent
    ],
  });
  const overview = classify(index, {
    media: new Map([['tv:42009', { runtimeMinutes: null, seasons: [{ season: 7, episodes: 33 }] }]]),
    episodeRuntimes: new Map([['42009:7', new Map([[2, 40], [3, 40]])]]),
  });

  const details = titleDetails(overview, 'tv', 42009);
  assert.deepEqual(
    { ...details, episodes: undefined },
    {
      mediaType: 'tv', tmdbId: 42009, status: 'in_progress', markedWatched: false, animeMode: false, estimated: false,
      position: 1556, duration: 2873, season: 7, episode: 5, episodesWatched: 3, episodesTotal: 33, episodes: undefined,
    },
  );
  assert.deepEqual(details.episodes, [
    { season: 7, episode: 1, position: null, duration: null, estimated: false, watched: true, marked: true },
    { season: 7, episode: 2, position: 2100, duration: 2400, estimated: true, watched: true, marked: false },
    { season: 7, episode: 3, position: 600, duration: 2400, estimated: true, watched: false, marked: false },
    { season: 7, episode: 5, position: 1556, duration: 2873, estimated: false, watched: false, marked: false },
    { season: 7, episode: 6, position: 5147, duration: 5426, estimated: false, watched: true, marked: true },
  ]);
});

test('getTitle : même classement mémorisé que l\'onglet ; mode anime → numéros anime-sama tels quels, episodesTotal null', async () => {
  const fake = overviewPool({
    history: [hist('tv', 37854, { season: 1, episode: 1000, at: T(1) })],
    progress: [prog('tv', 37854, 1, 1000, 300, 1440)],
    marks: [mark('tv', 37854, 1, 999, T(5))],
    viewing: [view('anime', 37854, 1440, 1, 998, new Date('2026-10-15T10:00:00Z'))],
  });
  const media = fakeMediaStore({ 'tv:37854': { mediaType: 'tv', tmdbId: 37854, title: 'One Piece', runtimeMinutes: 24, seasons: [{ season: 1, episodes: 61 }] } });
  const store = createHistoryStore({ pool: fake.pool, mediaStore: media });

  const title = await store.getTitle(OWNER, { mediaType: 'tv', tmdbId: 37854, language: 'fr-FR' });

  assert.deepEqual([title.animeMode, title.status, title.season, title.episode, title.episodesTotal, title.episodesWatched], [true, 'in_progress', 1, 1000, null, 2]);
  assert.deepEqual(title.episodes.map((episode) => [episode.episode, episode.watched, episode.marked, episode.estimated]), [
    [998, true, false, true], [999, true, true, false], [1000, false, false, false],
  ]);
  // Titre absent → null ; l'onglet réutilise le même classement (une seule lecture).
  assert.equal(await store.getTitle(OWNER, { mediaType: 'movie', tmdbId: 550, language: 'fr-FR' }), null);
  await store.listHistory(OWNER, query('in_progress'));
  assert.equal(fake.callsMatching(/^SELECT .* FROM watch_marks/).length, 1);
  // Aucune lecture TMDB d'épisodes de plus pour la fiche.
  assert.equal(media.calls.getEpisodes.length + media.calls.getEpisodeRuntimes.length, 0);
  // cache: false → calcul à part.
  await store.getTitle(OWNER, { mediaType: 'tv', tmdbId: 37854, language: 'fr-FR', cache: false });
  assert.equal(fake.callsMatching(/^SELECT .* FROM watch_marks/).length, 2);
});

test('deleteTitle : 3 tables de l\'historique + temps du lecteur web du titre (film : movie ; série : tv et anime)', async () => {
  const fake = createFakeHistoryPool();
  const store = createHistoryStore({ pool: fake.pool, mediaStore: fakeMediaStore() });

  await store.deleteTitle(OWNER, 'tv', 1399);
  assert.deepEqual(fake.calls.map((call) => [call.sql, call.params]), [
    ['DELETE FROM watch_progress WHERE user_type = ? AND user_id = ? AND profile_id = ? AND media_type = ? AND tmdb_id = ?', ['oauth', 'u-1', 'p-1', 'tv', 1399]],
    ['DELETE FROM watch_history WHERE user_type = ? AND user_id = ? AND profile_id = ? AND media_type = ? AND tmdb_id = ?', ['oauth', 'u-1', 'p-1', 'tv', 1399]],
    ['DELETE FROM watch_marks WHERE user_type = ? AND user_id = ? AND profile_id = ? AND media_type = ? AND tmdb_id = ?', ['oauth', 'u-1', 'p-1', 'tv', 1399]],
    ["DELETE FROM wrapped_viewing_data WHERE user_id = ? AND profile_id <=> ? AND content_type IN ('tv', 'anime') AND content_id = ?", ['u-1', 'p-1', '1399']],
  ]);

  const movie = createFakeHistoryPool();
  await createHistoryStore({ pool: movie.pool, mediaStore: fakeMediaStore() }).deleteTitle(OWNER, 'movie', 550);
  assert.deepEqual(movie.calls.at(-1).sql, "DELETE FROM wrapped_viewing_data WHERE user_id = ? AND profile_id <=> ? AND content_type = 'movie' AND content_id = ?");
});

test('deleteTitle : panne de wrapped_viewing_data loguée, suppression réussie ; classement oublié', async (t) => {
  const errors = [];
  t.mock.method(console, 'error', (...args) => { errors.push(args.join(' ')); });
  const fake = overviewPool({ history: [hist('movie', 550)] });
  const failing = createFakeHistoryPool((sql) => {
    if (sql.startsWith('DELETE FROM wrapped_viewing_data')) throw new Error('table absente');
    return undefined;
  });
  const store = createHistoryStore({ pool: failing.pool, mediaStore: fakeMediaStore() });
  await assert.doesNotReject(store.deleteTitle(OWNER, 'movie', 550));
  assert.ok(errors.some((line) => line.includes('[HISTORY]')));

  // Mémo : l'écriture oublie le classement.
  const memoStore = createHistoryStore({ pool: fake.pool, mediaStore: fakeMediaStore() });
  await memoStore.listHistory(OWNER, query('not_started'));
  await memoStore.deleteTitle(OWNER, 'movie', 550);
  await memoStore.listHistory(OWNER, query('not_started'));
  assert.equal(fake.callsMatching(/^SELECT .* FROM watch_marks/).length, 2);
});

test('deleteProfile efface progression, historique et marque d\'import du propriétaire', async () => {
  const fake = createFakeHistoryPool();
  const store = createHistoryStore({ pool: fake.pool, mediaStore: fakeMediaStore() });

  await store.deleteProfile(OWNER);

  assert.deepEqual(fake.calls.map((call) => call.sql), [
    'DELETE FROM watch_progress WHERE user_type = ? AND user_id = ? AND profile_id = ?',
    'DELETE FROM watch_history WHERE user_type = ? AND user_id = ? AND profile_id = ?',
    'DELETE FROM watch_marks WHERE user_type = ? AND user_id = ? AND profile_id = ?',
    'DELETE FROM watch_history_imports WHERE user_type = ? AND user_id = ? AND profile_id = ?',
  ]);
  for (const call of fake.calls) assert.deepEqual(call.params, ['oauth', 'u-1', 'p-1']);
});

test('addMarks : INSERT IGNORE en une requête `query`, date de la marque ou heure de l\'insertion', async () => {
  const fake = createFakeHistoryPool((sql) => (sql.startsWith('INSERT IGNORE') ? { affectedRows: 1 } : undefined));
  // Horloge injectée : c'est elle qui date une marque sans `addedAt`.
  const clock = Date.UTC(2026, 9, 16, 15, 0, 0);
  const store = createHistoryStore({ pool: fake.pool, mediaStore: fakeMediaStore(), now: () => clock });

  const inserted = await store.addMarks(OWNER, [
    { mediaType: 'movie', tmdbId: 550, season: 0, episode: 0, markedAt: AT },
    { mediaType: 'tv', tmdbId: 1399, season: 1, episode: 2, markedAt: null },
  ]);

  assert.equal(inserted, 1);
  assert.equal(fake.calls.length, 1);
  const call = fake.calls[0];
  assert.equal(call.method, 'query');
  assert.equal(call.sql, 'INSERT IGNORE INTO watch_marks (user_type, user_id, profile_id, media_type, tmdb_id, season, episode, marked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?)');
  assert.deepEqual(call.params.slice(0, 8), ['oauth', 'u-1', 'p-1', 'movie', 550, 0, 0, AT]);
  assert.deepEqual(call.params.slice(8, 15), ['oauth', 'u-1', 'p-1', 'tv', 1399, 1, 2]);
  assert.deepEqual(call.params[15], new Date(clock));

  // Rien à ajouter : aucune requête.
  assert.equal(await store.addMarks(OWNER, []), 0);
  assert.equal(fake.calls.length, 1);
});

test('replaceMarks : aligne les marques du profil sur la liste (ajouts manquants, retraits du reste)', async () => {
  const fake = createFakeHistoryPool((sql) => {
    if (sql.startsWith('SELECT media_type, tmdb_id, season, episode FROM watch_marks')) {
      return [
        { media_type: 'movie', tmdb_id: 550, season: 0, episode: 0 },
        { media_type: 'tv', tmdb_id: 1399, season: 1, episode: 1 },
      ];
    }
    return { affectedRows: 1 };
  });
  const store = createHistoryStore({ pool: fake.pool, mediaStore: fakeMediaStore() });

  const result = await store.replaceMarks(OWNER, [
    { mediaType: 'tv', tmdbId: 1399, season: 1, episode: 1, markedAt: null },
    { mediaType: 'movie', tmdbId: 13, season: 0, episode: 0, markedAt: AT },
  ]);

  assert.deepEqual(result, { added: 1, removed: 1 });
  assert.deepEqual(fake.calls[0].params, ['oauth', 'u-1', 'p-1']);
  assert.deepEqual(fake.callsMatching('DELETE FROM watch_marks')[0].params, ['oauth', 'u-1', 'p-1', 'movie', 550, 0, 0]);
  const insert = fake.callsMatching('INSERT IGNORE INTO watch_marks')[0];
  assert.deepEqual(insert.params, ['oauth', 'u-1', 'p-1', 'movie', 13, 0, 0, AT]);
});

test('listHistory : un même calcul partagé par les appels simultanés ; un calcul raté n\'est pas gardé ; cache: false ne garde rien', async (t) => {
  t.mock.method(console, 'error', () => {});
  let failNext = false;
  const fake = createFakeHistoryPool((sql) => {
    if (!sql.startsWith('SELECT')) return undefined;
    if (sql.includes('FROM watch_history')) {
      if (failNext) {
        failNext = false;
        throw new Error('MySQL en panne');
      }
      return [hist('movie', 550)];
    }
    return [];
  });
  const store = createHistoryStore({ pool: fake.pool, mediaStore: fakeMediaStore() });
  const loads = () => fake.callsMatching(/^SELECT .* FROM watch_history/).length;

  // Deux appels en même temps : une seule lecture.
  await Promise.all([store.listHistory(OWNER, query('not_started')), store.listHistory(OWNER, query('finished'))]);
  assert.equal(loads(), 1);

  // Calcul raté : erreur rendue, rien de gardé, l'appel suivant recalcule.
  await store.hide(OWNER, 'movie', 550);
  failNext = true;
  await assert.rejects(store.listHistory(OWNER, query('not_started')), /MySQL en panne/);
  const retry = await store.listHistory(OWNER, query('not_started'));
  assert.deepEqual(retry.items.map((item) => item.tmdbId), [550]);
  assert.equal(loads(), 3);

  // Import pas fait (cache: false) : calcul à part, ni repris ni gardé.
  await store.listHistory(OWNER, query('not_started', { cache: false }));
  assert.equal(loads(), 4);
  await store.listHistory(OWNER, query('not_started'));
  assert.equal(loads(), 4);
});

test('listHistory : série au total connu de 0 épisode → pas « terminée » sans marque ni fin', async () => {
  const fake = overviewPool({ history: [hist('tv', 77, { at: T(1) })] });
  const media = fakeMediaStore({ 'tv:77': { mediaType: 'tv', tmdbId: 77, title: 'Annoncée', seasons: [{ season: 1, episodes: 0 }] } });
  const store = createHistoryStore({ pool: fake.pool, mediaStore: media });

  const { tabs, items } = await allTabs(store);

  assert.deepEqual(tabs, { in_progress: [], finished: [], not_started: [77] });
  assert.deepEqual([items.get(77).episodesWatched, items.get(77).episodesTotal], [0, 0]);
});

test('listHistory : position sans durée (duration 0) n\'est pas exacte → l\'estimé du lecteur web sert', async () => {
  const fake = overviewPool({
    history: [hist('movie', 550, { at: T(1) })],
    progress: [prog('movie', 550, 0, 0, 500, 0)],
    viewing: [view('movie', 550, 3600)],
  });
  const media = fakeMediaStore({ 'movie:550': { mediaType: 'movie', tmdbId: 550, title: 'Fight Club', runtimeMinutes: 120, seasons: null } });
  const store = createHistoryStore({ pool: fake.pool, mediaStore: media });

  const { tabs, items, stats } = await allTabs(store);

  assert.deepEqual(tabs.in_progress, [550]);
  assert.deepEqual(pick(items.get(550)), { finished: false, estimated: true, markedWatched: false, position: 3600, duration: 7200 });
  // Exact : LEAST(500, 0) = 0 ; lecteur web : 3600.
  assert.equal(stats.watchedSeconds, 3600);
});

test('removeMarks : DELETE du propriétaire, liste IN en `query`', async () => {
  const fake = createFakeHistoryPool((sql) => (sql.startsWith('DELETE') ? { affectedRows: 2 } : undefined));
  const store = createHistoryStore({ pool: fake.pool, mediaStore: fakeMediaStore() });

  const removed = await store.removeMarks(OWNER, [
    { mediaType: 'movie', tmdbId: 13, season: 0, episode: 0 },
    { mediaType: 'tv', tmdbId: 1399, season: 1, episode: 2 },
  ]);

  assert.equal(removed, 2);
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].method, 'query');
  assert.equal(fake.calls[0].sql, 'DELETE FROM watch_marks WHERE user_type = ? AND user_id = ? AND profile_id = ? AND (media_type, tmdb_id, season, episode) IN ((?, ?, ?, ?), (?, ?, ?, ?))');
  assert.deepEqual(fake.calls[0].params, ['oauth', 'u-1', 'p-1', 'movie', 13, 0, 0, 'tv', 1399, 1, 2]);

  assert.equal(await store.removeMarks(OWNER, []), 0);
  assert.equal(fake.calls.length, 1);
});
