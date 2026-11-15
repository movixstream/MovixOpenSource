'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createMediaStore } = require('../mediaStore');
const { createFakeHistoryPool } = require('./helpers/fakeHistoryPool');

const NOW = new Date('2026-10-16T12:00:00.000Z');

const TV_DETAILS = {
  id: 94605,
  name: 'Arcane',
  original_name: 'Arcane',
  overview: 'Piltover et Zaun.',
  poster_path: '/arcane.jpg',
  backdrop_path: '/arcane-bg.jpg',
  first_air_date: '2021-11-06',
  vote_average: 8.75,
  episode_run_time: [40],
  status: 'Ended',
  seasons: [
    { season_number: 0, episode_count: 3 },
    { season_number: 1, episode_count: 9 },
    { season_number: 2, episode_count: 9 },
  ],
};

const MOVIE_DETAILS = {
  id: 550,
  title: 'Fight Club',
  original_title: 'Fight Club',
  overview: 'Un employé de bureau insomniaque.',
  poster_path: '/fc.jpg',
  backdrop_path: '/fc-bg.jpg',
  release_date: '1999-10-15',
  vote_average: 8.4,
  runtime: 139,
  status: 'Released',
};

function emptySelects(sql) {
  if (sql.startsWith('SELECT')) return [];
  return undefined;
}

test('getMany : deux demandes du même titre → un seul fetchDetails', async () => {
  const fake = createFakeHistoryPool(emptySelects);
  const fetched = [];
  const store = createMediaStore({
    pool: fake.pool,
    fetchDetails: async (type, id, language) => {
      fetched.push([type, id, language]);
      return MOVIE_DETAILS;
    },
    fetchSeason: async () => null,
    now: () => NOW,
  });

  const [first, second] = await Promise.all([
    store.getMany([{ mediaType: 'movie', tmdbId: 550 }, { mediaType: 'movie', tmdbId: 550 }], 'fr-FR'),
    store.getMany([{ mediaType: 'movie', tmdbId: 550 }], 'fr-FR'),
  ]);

  assert.equal(fetched.length, 1);
  assert.deepEqual(fetched[0], ['movie', 550, 'fr-FR']);
  assert.equal(first.get('movie:550').title, 'Fight Club');
  assert.equal(first.get('movie:550').year, 1999);
  assert.equal(second.get('movie:550').title, 'Fight Club');

  const selects = fake.callsMatching('FROM tmdb_media');
  assert.ok(selects.length >= 1);
  // Liste IN de longueur variable : `query`, jamais une requête préparée par longueur.
  assert.ok(selects.every((call) => call.method === 'query'));
  assert.match(selects[0].sql, /WHERE \(media_type, tmdb_id\) IN \(\(\?, \?\)\) AND language = \?/);
  assert.deepEqual(selects[0].params, ['movie', 550, 'fr-FR']);

  const inserts = fake.callsMatching('INSERT INTO tmdb_media');
  assert.equal(inserts.length, 1);
  assert.match(inserts[0].sql, /ON DUPLICATE KEY UPDATE/);
});

test('getMany : fetchDetails qui lève → Map sans ce titre, sans exception', async () => {
  const fake = createFakeHistoryPool(emptySelects);
  const store = createMediaStore({
    pool: fake.pool,
    fetchDetails: async (type, id) => {
      if (id === 404) throw new Error('TMDB en panne');
      return MOVIE_DETAILS;
    },
    fetchSeason: async () => null,
    now: () => NOW,
  });

  const result = await store.getMany([
    { mediaType: 'movie', tmdbId: 404 },
    { mediaType: 'movie', tmdbId: 550 },
  ], 'fr-FR');

  assert.equal(result.has('movie:404'), false);
  assert.equal(result.has('movie:550'), true);
});

test('getMany : seasons_json d\'une série exclut la saison 0', async () => {
  const fake = createFakeHistoryPool(emptySelects);
  const store = createMediaStore({
    pool: fake.pool,
    fetchDetails: async () => TV_DETAILS,
    fetchSeason: async () => null,
    now: () => NOW,
  });

  const result = await store.getMany([{ mediaType: 'tv', tmdbId: 94605 }], 'en-US');
  const media = result.get('tv:94605');
  assert.deepEqual(media.seasons, [{ season: 1, episodes: 9 }, { season: 2, episodes: 9 }]);
  assert.equal(media.title, 'Arcane');
  assert.equal(media.rating, 8.8);

  const insert = fake.callsMatching('INSERT INTO tmdb_media')[0];
  const seasonsJson = insert.params.find((value) => typeof value === 'string' && value.startsWith('[{'));
  assert.deepEqual(JSON.parse(seasonsJson), [{ season: 1, episodes: 9 }, { season: 2, episodes: 9 }]);
  assert.ok(insert.params.includes('en-US'));
});

test('getMany : ligne en base récente → aucun appel TMDB ; ligne de plus de 7 jours → renvoyée puis rafraîchie', async () => {
  const fresh = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
  const stale = new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000);
  const fake = createFakeHistoryPool((sql) => {
    if (sql.includes('FROM tmdb_media')) {
      return [
        { media_type: 'movie', tmdb_id: 550, title: 'Fight Club', overview: null, poster_path: '/fc.jpg', backdrop_path: null, release_year: 1999, vote_average: '8.4', status: 'Released', seasons_json: null, fetched_at: fresh },
        { media_type: 'tv', tmdb_id: 94605, title: 'Arcane', overview: null, poster_path: null, backdrop_path: null, release_year: 2021, vote_average: '8.8', status: 'Ended', seasons_json: '[{"season":1,"episodes":9}]', fetched_at: stale },
      ];
    }
    return undefined;
  });
  const fetched = [];
  let resolveRefresh;
  const refreshed = new Promise((resolve) => { resolveRefresh = resolve; });
  const store = createMediaStore({
    pool: fake.pool,
    fetchDetails: async (type, id) => {
      fetched.push(`${type}:${id}`);
      resolveRefresh();
      return TV_DETAILS;
    },
    fetchSeason: async () => null,
    now: () => NOW,
  });

  const result = await store.getMany([
    { mediaType: 'movie', tmdbId: 550 },
    { mediaType: 'tv', tmdbId: 94605 },
  ], 'fr-FR');

  assert.equal(result.get('movie:550').rating, 8.4);
  assert.deepEqual(result.get('tv:94605').seasons, [{ season: 1, episodes: 9 }]);
  await refreshed;
  assert.deepEqual(fetched, ['tv:94605']);
});

test('getMany : rafraîchissement en arrière-plan qui échoue → jamais d\'exception', async () => {
  const stale = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000);
  const fake = createFakeHistoryPool((sql) => {
    if (sql.includes('FROM tmdb_media')) {
      return [{ media_type: 'movie', tmdb_id: 550, title: 'Fight Club', overview: null, poster_path: null, backdrop_path: null, release_year: 1999, vote_average: null, status: null, seasons_json: null, fetched_at: stale }];
    }
    return undefined;
  });
  let failed;
  const done = new Promise((resolve) => { failed = resolve; });
  const store = createMediaStore({
    pool: fake.pool,
    fetchDetails: async () => {
      setImmediate(failed);
      throw new Error('TMDB en panne');
    },
    fetchSeason: async () => null,
    now: () => NOW,
  });

  const result = await store.getMany([{ mediaType: 'movie', tmdbId: 550 }], 'fr-FR');
  assert.equal(result.get('movie:550').title, 'Fight Club');
  await done;
});

test('getEpisodes : table vide → fetchSeason puis insertion de toute la saison', async () => {
  const fake = createFakeHistoryPool(emptySelects);
  const store = createMediaStore({
    pool: fake.pool,
    fetchDetails: async () => null,
    fetchSeason: async (tvId, season, language) => {
      assert.deepEqual([tvId, season, language], [94605, 1, 'fr-FR']);
      return {
        episodes: [
          { episode_number: 1, name: 'Bienvenue', overview: 'Début.', still_path: '/e1.jpg', runtime: 41 },
          { episode_number: 2, name: 'Suite', overview: null, still_path: null, runtime: null },
        ],
      };
    },
    now: () => NOW,
  });

  const episodes = await store.getEpisodes(94605, 1, 'fr-FR');
  assert.deepEqual(episodes.get(1), { episode: 1, name: 'Bienvenue', overview: 'Début.', stillPath: '/e1.jpg', runtimeMinutes: 41 });
  assert.equal(episodes.get(2).runtimeMinutes, null);
  assert.equal(episodes.size, 2);

  const select = fake.callsMatching('FROM tmdb_episodes')[0];
  assert.deepEqual(select.params, [94605, 1, 'fr-FR']);
  const insert = fake.callsMatching('INSERT INTO tmdb_episodes')[0];
  assert.match(insert.sql, /ON DUPLICATE KEY UPDATE/);
  assert.equal(insert.method, 'query');
  assert.equal(insert.params.length, 2 * 9);
});

test('getEpisodes : saison en base → pas de fetchSeason', async () => {
  const fake = createFakeHistoryPool((sql) => {
    if (sql.includes('FROM tmdb_episodes')) {
      return [
        { episode: 3, name: 'Trois', overview: null, still_path: '/e3.jpg', runtime_minutes: 24 },
        { episode: 4, name: 'Quatre', overview: null, still_path: null, runtime_minutes: null },
      ];
    }
    return undefined;
  });
  const store = createMediaStore({
    pool: fake.pool,
    fetchDetails: async () => null,
    fetchSeason: async () => { throw new Error('ne doit pas être appelé'); },
    now: () => NOW,
  });

  const episodes = await store.getEpisodes(94605, 2, 'fr-FR');
  assert.deepEqual(episodes.get(3), { episode: 3, name: 'Trois', overview: null, stillPath: '/e3.jpg', runtimeMinutes: 24 });
  assert.equal(episodes.get(4).runtimeMinutes, null);
  // La durée de l'épisode est lue avec le reste (estimations des lecteurs web).
  assert.match(fake.callsMatching('FROM tmdb_episodes')[0].sql, /SELECT episode, name, overview, still_path, runtime_minutes FROM tmdb_episodes/);
});

test('getMany : durée en minutes (film : runtime, série : durée d\'épisode), en base comme depuis TMDB', async () => {
  const fresh = new Date(NOW.getTime() - 60 * 1000);
  const fake = createFakeHistoryPool((sql) => {
    if (sql.includes('FROM tmdb_media')) {
      return [
        { media_type: 'movie', tmdb_id: 13, title: 'Forrest Gump', overview: null, poster_path: null, backdrop_path: null, release_year: 1994, vote_average: '8.5', runtime_minutes: 142, status: 'Released', seasons_json: null, fetched_at: fresh },
        { media_type: 'movie', tmdb_id: 14, title: 'Sans durée', overview: null, poster_path: null, backdrop_path: null, release_year: 2000, vote_average: null, runtime_minutes: null, status: null, seasons_json: null, fetched_at: fresh },
      ];
    }
    return undefined;
  });
  const store = createMediaStore({
    pool: fake.pool,
    fetchDetails: async (type) => (type === 'movie' ? MOVIE_DETAILS : TV_DETAILS),
    fetchSeason: async () => null,
    now: () => NOW,
  });

  const result = await store.getMany([
    { mediaType: 'movie', tmdbId: 13 },
    { mediaType: 'movie', tmdbId: 14 },
    { mediaType: 'movie', tmdbId: 550 },
    { mediaType: 'tv', tmdbId: 94605 },
  ], 'fr-FR');

  assert.equal(result.get('movie:13').runtimeMinutes, 142);
  assert.equal(result.get('movie:14').runtimeMinutes, null);
  assert.equal(result.get('movie:550').runtimeMinutes, 139);
  assert.equal(result.get('tv:94605').runtimeMinutes, 40);
  assert.match(fake.callsMatching('FROM tmdb_media')[0].sql, /vote_average, runtime_minutes, status, seasons_json, fetched_at FROM tmdb_media/);
});

test('MAX_TMDB_FETCHES_PER_CALL est exporté (budget TMDB réutilisé par l\'historique)', () => {
  const { MAX_TMDB_FETCHES_PER_CALL } = require('../mediaStore');
  assert.equal(MAX_TMDB_FETCHES_PER_CALL, 300);
});

test('getEpisodeRuntimes : une lecture groupée du cache, TMDB seulement pour les saisons absentes', async () => {
  const fake = createFakeHistoryPool((sql) => {
    if (sql.includes('FROM tmdb_episodes')) {
      return [
        { tmdb_id: 94605, season: 1, episode: 1, runtime_minutes: 41 },
        { tmdb_id: 94605, season: 1, episode: 2, runtime_minutes: null },
      ];
    }
    return undefined;
  });
  const fetched = [];
  const store = createMediaStore({
    pool: fake.pool,
    fetchDetails: async () => null,
    fetchSeason: async (tvId, season) => {
      fetched.push(`${tvId}:${season}`);
      return { episodes: [{ episode_number: 1, name: 'Un', runtime: 24 }] };
    },
    now: () => NOW,
  });

  const runtimes = await store.getEpisodeRuntimes([
    { tmdbId: 94605, season: 1 }, { tmdbId: 1399, season: 2 }, { tmdbId: 94605, season: 1 }, { tmdbId: 0, season: 1 },
  ], 'en-US');

  const selects = fake.callsMatching('FROM tmdb_episodes');
  assert.equal(selects.length, 1);
  assert.equal(selects[0].method, 'query');
  assert.match(selects[0].sql, /WHERE language = \? AND \(tmdb_id, season\) IN \(\(\?, \?\), \(\?, \?\)\)$/);
  assert.deepEqual(selects[0].params, ['en-US', 94605, 1, 1399, 2]);
  assert.deepEqual(fetched, ['1399:2']);
  assert.deepEqual([...runtimes.get('94605:1')], [[1, 41], [2, null]]);
  assert.deepEqual([...runtimes.get('1399:2')], [[1, 24]]);
});

test('getEpisodeRuntimes : au plus 300 saisons demandées à TMDB par appel', async () => {
  const fake = createFakeHistoryPool(emptySelects);
  let fetches = 0;
  const store = createMediaStore({
    pool: fake.pool,
    fetchDetails: async () => null,
    fetchSeason: async () => { fetches++; return { episodes: [{ episode_number: 1, runtime: 30 }] }; },
    now: () => NOW,
  });
  const seasons = Array.from({ length: 301 }, (_, index) => ({ tmdbId: index + 1, season: 1 }));

  const runtimes = await store.getEpisodeRuntimes(seasons, 'fr-FR');

  assert.equal(fetches, 300);
  assert.equal(runtimes.has('1:1'), true);
  assert.equal(runtimes.has('301:1'), false);
});

test('saison en échec gardée en mémoire : 404 → 1 jour, panne → 10 minutes, sans redemande entre-temps', async (t) => {
  t.mock.method(console, 'error', () => {});
  let time = NOW.getTime();
  const fetched = [];
  const store = createMediaStore({
    pool: createFakeHistoryPool(emptySelects).pool,
    fetchDetails: async () => null,
    fetchSeason: async (tvId, season) => {
      fetched.push(`${tvId}:${season}`);
      if (tvId === 404) throw notFound();
      throw new Error('TMDB en panne');
    },
    now: () => new Date(time),
  });
  const ask = () => store.getEpisodeRuntimes([{ tmdbId: 404, season: 9 }, { tmdbId: 500, season: 1 }], 'fr-FR');

  await ask();
  assert.deepEqual(fetched, ['404:9', '500:1']);
  // getEpisodes respecte la même mémoire.
  assert.equal((await store.getEpisodes(500, 1, 'fr-FR')).size, 0);
  await ask();
  assert.equal(fetched.length, 2);

  time += 10 * 60 * 1000 + 1;
  await ask();
  assert.deepEqual(fetched.slice(2), ['500:1']);

  time += 24 * 60 * 60 * 1000;
  await ask();
  assert.deepEqual(fetched.slice(3).sort(), ['404:9', '500:1']);
});

function notFound() {
  return Object.assign(new Error('Request failed with status code 404'), { response: { status: 404 } });
}

// Base en mémoire pour tmdb_media : les INSERT y sont gardés et relus.
function memoryMediaPool() {
  const rows = new Map();
  const fake = createFakeHistoryPool((sql, params) => {
    if (sql.startsWith('INSERT INTO tmdb_media')) {
      const [media_type, tmdb_id, language, title, , overview, poster_path, backdrop_path, release_year, vote_average, , status, seasons_json, fetched_at] = params;
      rows.set(`${media_type}:${tmdb_id}:${language}`, { media_type, tmdb_id, title, overview, poster_path, backdrop_path, release_year, vote_average, status, seasons_json, fetched_at });
      return undefined;
    }
    if (sql.includes('FROM tmdb_media')) {
      const language = params[params.length - 1];
      const found = [];
      for (let i = 0; i < params.length - 1; i += 2) {
        const row = rows.get(`${params[i]}:${params[i + 1]}:${language}`);
        if (row) found.push(row);
      }
      return found;
    }
    return emptySelects(sql);
  });
  return { ...fake, rows };
}

test('getMany : un 404 TMDB est gardé comme titre inconnu et redemandé seulement après 1 jour', async () => {
  const db = memoryMediaPool();
  let clock = NOW.getTime();
  const fetched = [];
  const store = createMediaStore({
    pool: db.pool,
    fetchDetails: async (type, id) => { fetched.push(`${type}:${id}`); throw notFound(); },
    fetchSeason: async () => null,
    now: () => new Date(clock),
  });

  const first = await store.getMany([{ mediaType: 'movie', tmdbId: 999 }], 'fr-FR');
  assert.equal(first.has('movie:999'), false);
  // Ligne « inconnue » : titre vide, date de la demande.
  const tombstone = db.rows.get('movie:999:fr-FR');
  assert.equal(tombstone.title, '');
  assert.equal(tombstone.fetched_at.getTime(), NOW.getTime());

  clock += 23 * 60 * 60 * 1000;
  const second = await store.getMany([{ mediaType: 'movie', tmdbId: 999 }], 'fr-FR');
  assert.equal(second.has('movie:999'), false);
  assert.deepEqual(fetched, ['movie:999']);

  clock += 2 * 60 * 60 * 1000;
  await store.getMany([{ mediaType: 'movie', tmdbId: 999 }], 'fr-FR');
  assert.deepEqual(fetched, ['movie:999', 'movie:999']);
});

test('getMany : une réponse TMDB sans id compte aussi comme titre inconnu', async () => {
  const db = memoryMediaPool();
  const store = createMediaStore({
    pool: db.pool,
    fetchDetails: async () => ({ success: false, status_code: 34 }),
    fetchSeason: async () => null,
    now: () => NOW,
  });

  const result = await store.getMany([{ mediaType: 'tv', tmdbId: 123 }], 'fr-FR');
  assert.equal(result.has('tv:123'), false);
  assert.equal(db.rows.get('tv:123:fr-FR').title, '');
});

test('getMany : panne TMDB (délai, 5xx) → 10 minutes sans redemander, rien en base', async () => {
  const db = memoryMediaPool();
  let clock = NOW.getTime();
  let calls = 0;
  const store = createMediaStore({
    pool: db.pool,
    fetchDetails: async () => { calls++; throw Object.assign(new Error('timeout of 10000ms exceeded'), { code: 'ECONNABORTED' }); },
    fetchSeason: async () => null,
    now: () => new Date(clock),
  });
  const quiet = console.error;
  console.error = () => {};
  try {
    await store.getMany([{ mediaType: 'movie', tmdbId: 77 }], 'fr-FR');
    clock += 9 * 60 * 1000;
    await store.getMany([{ mediaType: 'movie', tmdbId: 77 }], 'fr-FR');
    assert.equal(calls, 1);
    // Autre langue : clé différente.
    await store.getMany([{ mediaType: 'movie', tmdbId: 77 }], 'en-US');
    assert.equal(calls, 2);
    clock += 2 * 60 * 1000;
    await store.getMany([{ mediaType: 'movie', tmdbId: 77 }], 'fr-FR');
    assert.equal(calls, 3);
  } finally {
    console.error = quiet;
  }
  assert.equal(db.rows.size, 0);
});

test('getMany : 183 titres sans cache arrivent tous dès le premier appel', async () => {
  const db = memoryMediaPool();
  const fetched = [];
  const store = createMediaStore({
    pool: db.pool,
    fetchDetails: async (type, id) => { fetched.push(id); return { ...MOVIE_DETAILS, id }; },
    fetchSeason: async () => null,
    now: () => NOW,
  });
  const items = Array.from({ length: 183 }, (_, i) => ({ mediaType: 'movie', tmdbId: i + 1 }));

  const result = await store.getMany(items, 'fr-FR');
  assert.equal(fetched.length, 183);
  assert.equal(result.size, 183);
});

test('getMany : au plus 300 demandes TMDB par appel, le reste au prochain appel', async () => {
  const db = memoryMediaPool();
  const fetched = [];
  const store = createMediaStore({
    pool: db.pool,
    fetchDetails: async (type, id) => { fetched.push(id); return { ...MOVIE_DETAILS, id }; },
    fetchSeason: async () => null,
    now: () => NOW,
  });
  const items = Array.from({ length: 310 }, (_, i) => ({ mediaType: 'movie', tmdbId: i + 1 }));

  const first = await store.getMany(items, 'fr-FR');
  assert.equal(fetched.length, 300);
  assert.equal(first.size, 300);
  // Les premiers de la liste (les plus récents) passent d'abord.
  assert.ok(first.has('movie:1'));
  assert.equal(first.has('movie:301'), false);

  const second = await store.getMany(items, 'fr-FR');
  assert.equal(fetched.length, 310);
  assert.equal(second.size, 310);
});
