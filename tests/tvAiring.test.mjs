import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const load = (path, globals = {}) => {
  assert.ok(existsSync(path), `Module de diffusion à implémenter : ${path}`);
  const js = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', ...Object.keys(globals), js)(
    require, mod, mod.exports, ...Object.values(globals),
  );
  return mod.exports;
};
const utils = () => load('src/utils/tvAiring.ts');
const service = (globals) => load('src/services/tvAiringService.ts', globals);
const premiere = { season_number: 1, episode_number: 1, air_date: '2026-09-08' };
const stamp = '2026-09-09T01:00:00Z';
const schedule = {
  sourceUrl: 'https://www.tvmaze.com/shows/92751',
  episodes: { '1:1': { date: '2026-09-08', timestamp: stamp } },
  episodeList: [{ id: 0, season: 1, number: 1, name: '', airdate: '2026-09-08', runtime: null, image: null, summary: '' }],
};
const apiEpisode = {
  season: 1, number: 1, airdate: '2026-09-08', airtime: '21:00', airstamp: stamp,
};
const response = (data, status = 200) => new Response(JSON.stringify(data), { status });
const translator = (language) => {
  const strings = JSON.parse(readFileSync(`src/i18n/locales/${language}.json`, 'utf8'));
  return (key, values = {}) => {
    const text = key.split('.').reduce((value, part) => value?.[part], strings);
    assert.equal(typeof text, 'string', `Traduction manquante : ${key}`);
    return text.replace(/{{(\w+)}}/g, (_, name) => String(values[name]));
  };
};

test('The Drop reste à venir le 8 et après minuit en France le 9', () => {
  const { resolveEpisodeAiring } = utils();
  for (const now of ['2026-09-08T12:00:00Z', '2026-09-09T00:59:59Z']) {
    const result = resolveEpisodeAiring(premiere, schedule, Date.parse(now));
    assert.equal(result.kind, 'upcoming');
    assert.equal(result.needsWarning, true);
  }
});

test('le statut bascule exactement à la diffusion, indépendamment du fuseau du navigateur', () => {
  const { resolveEpisodeAiring } = utils();
  const result = resolveEpisodeAiring(premiere, schedule, Date.parse(stamp));
  assert.equal(result.kind, 'aired');
  assert.equal(result.needsWarning, false);
});

test('un offset explicite et son équivalent UTC désignent la même diffusion', () => {
  const { resolveEpisodeAiring } = utils();
  const localSchedule = { ...schedule, episodes: {
    '1:1': { date: '2026-09-08', timestamp: '2026-09-09T03:00:00+02:00' },
  } };
  assert.deepEqual(
    resolveEpisodeAiring(premiere, localSchedule, Date.parse(stamp)),
    resolveEpisodeAiring(premiere, schedule, Date.parse(stamp)),
  );
});

test('sans heure, le jour annoncé est diffusé et consultable sans avertissement', () => {
  const { resolveEpisodeAiring } = utils();
  for (const now of ['2026-09-08T20:00:00Z', '2026-09-09T00:30:00Z']) {
    const result = resolveEpisodeAiring(premiere, null, Date.parse(now));
    assert.equal(result.kind, 'aired');
    assert.equal(result.needsWarning, false);
    assert.equal(result.timestamp, null);
  }
});

test('les dates anciennes sans heure sont diffusées et consultables sans avertissement', () => {
  const result = utils().resolveEpisodeAiring(premiere, null, Date.parse('2026-10-01'));
  assert.equal(result.kind, 'aired');
  assert.equal(result.timestamp, null);
  assert.equal(result.needsWarning, false);
});

test('le repli sans heure bascule dès le début local du jour annoncé', () => {
  const { resolveEpisodeAiring } = utils();
  const start = new Date(2026, 8, 8).getTime();
  const before = resolveEpisodeAiring(premiere, null, start - 1);
  assert.equal(before.kind, 'unconfirmed');
  assert.equal(before.needsWarning, true);
  const after = resolveEpisodeAiring(premiere, null, start);
  assert.equal(after.kind, 'aired');
  assert.equal(after.needsWarning, false);
  assert.equal(after.timestamp, null);
});

test('Reacher et ses anciens épisodes affichent Diffusé même sans horaire TVmaze', () => {
  const { resolveShowAiring, resolveEpisodeAiring, getAiringLabel, formatAiringDate } = utils();
  const now = Date.parse('2026-09-08T12:00:00Z');
  const reacherSchedule = { sourceUrl: 'https://www.tvmaze.com/shows/43031', episodes: {
    '1:1': { date: '2022-02-04', timestamp: null },
    '2:4': { date: '2023-12-22', timestamp: null },
    '4:1': { date: '2026-08-12', timestamp: null },
    '4:4': { date: '2026-08-19', timestamp: null },
  } };
  const episodes = [
    { season_number: 2, episode_number: 4, air_date: '2023-12-21' },
    { season_number: 4, episode_number: 1, air_date: '2026-08-12' },
    { season_number: 4, episode_number: 4, air_date: '2026-08-19' },
  ];
  const statuses = [
    resolveShowAiring('2022-02-03', reacherSchedule, now),
    ...episodes.map(episode => resolveEpisodeAiring(episode, reacherSchedule, now)),
  ];
  for (const airing of statuses) {
    assert.equal(airing.kind, 'aired');
    assert.equal(airing.needsWarning, false);
    assert.equal(airing.timestamp, null);
    assert.equal(getAiringLabel(airing, translator('fr'), 'fr-FR', now, 'Europe/Paris'), 'Diffusé');
    assert.equal(getAiringLabel(airing, translator('en'), 'en-US', now, 'Europe/Paris'), 'Aired');
  }
  assert.equal(formatAiringDate(statuses[2], 'fr-FR', 'Europe/Paris'), '12 août 2026');
});

test('la saison 4 de Reacher distingue les six épisodes passés des deux épisodes à venir', () => {
  const { resolveEpisodeAiring, getEpisodeTimeline } = utils();
  const now = Date.parse('2026-09-08T12:00:00Z');
  const episodes = [
    '2026-08-12', '2026-08-12', '2026-08-12', '2026-08-19',
    '2026-08-26', '2026-09-02', '2026-09-09', '2026-09-16',
  ].map((air_date, index) => ({ season_number: 4, episode_number: index + 1, air_date }));
  for (const episode of episodes) {
    const airing = resolveEpisodeAiring(episode, null, now);
    assert.equal(airing.kind, episode.episode_number <= 6 ? 'aired' : 'unconfirmed');
    assert.equal(airing.needsWarning, episode.episode_number > 6);
  }
  const timeline = getEpisodeTimeline(episodes, null, now);
  assert.equal(timeline.last.episode_number, 6);
  assert.equal(timeline.next.episode_number, 7);
});

test('dates invalides, absentes et heures sans fuseau ne confirment aucune diffusion', () => {
  const { resolveEpisodeAiring } = utils();
  for (const air_date of [null, '', 'invalide', '2026-02-30']) {
    const result = resolveEpisodeAiring({ ...premiere, air_date }, null, Date.parse(stamp));
    assert.equal(result.kind, 'unconfirmed');
    assert.equal(result.date, null);
    assert.equal(result.needsWarning, false);
  }
  const noZone = { ...schedule, episodes: {
    '1:1': { date: '2026-09-08', timestamp: '2026-09-08T21:00:00' },
  } };
  const result = resolveEpisodeAiring(premiere, noZone, Date.parse(stamp));
  assert.equal(result.timestamp, null);
  assert.equal(result.needsWarning, false);
});

test('une numérotation divergente ne prête pas à un épisode l’heure d’un autre', () => {
  const result = utils().resolveEpisodeAiring({ ...premiere, air_date: '2026-10-01' }, schedule, Date.parse(stamp));
  assert.equal(result.timestamp, null);
  assert.equal(result.date, '2026-10-01');
  assert.equal(result.needsWarning, true);
});

test('le statut de la série utilise le premier épisode régulier, pas un spécial ou le prochain épisode', () => {
  const data = { ...schedule, episodes: {
    ...schedule.episodes,
    '0:1': { date: '2026-08-01', timestamp: '2026-08-01T00:00:00Z' },
    '1:2': { date: '2026-09-15', timestamp: '2026-09-16T01:00:00Z' },
  } };
  const { resolveShowAiring } = utils();
  assert.equal(resolveShowAiring('2026-09-08', data, Date.parse('2026-09-08T20:00:00Z')).kind, 'upcoming');
  assert.equal(resolveShowAiring('2026-09-08', data, Date.parse(stamp)).kind, 'aired');
});

test('le dernier épisode TMDB n’est pas annoncé comme diffusé avant son horaire réel', () => {
  const { getEpisodeTimeline } = utils();
  const episodes = [premiere, { ...premiere, episode_number: 2, air_date: '2026-09-15' }];
  const before = getEpisodeTimeline(episodes, schedule, Date.parse('2026-09-08T20:00:00Z'));
  assert.equal(before.last, null);
  assert.deepEqual(before.next, premiere);
  const after = getEpisodeTimeline(episodes, schedule, Date.parse(stamp));
  assert.deepEqual(after.last, premiere);
  assert.equal(after.next.episode_number, 2);
});

test('affichage français : demain à 03:00 à Paris, aujourd’hui à 21:00 à New York', () => {
  const { resolveEpisodeAiring, getAiringLabel } = utils();
  const now = Date.parse('2026-09-08T12:00:00Z');
  const airing = resolveEpisodeAiring(premiere, schedule, now);
  assert.match(getAiringLabel(airing, translator('fr'), 'fr-FR', now, 'Europe/Paris'), /demain.*03:00/i);
  assert.match(getAiringLabel(airing, translator('fr'), 'fr-FR', now, 'America/New_York'), /aujourd’hui.*21:00/i);
});

test('demain reste le bon jour pendant le changement d’heure', () => {
  const { getAiringLabel } = utils();
  const airing = { kind: 'upcoming', date: '2026-10-25', timestamp: Date.parse('2026-10-25T22:30:00Z'), needsWarning: true };
  assert.match(getAiringLabel(airing, translator('fr'), 'fr-FR', Date.parse('2026-10-24T22:30:00+02:00'), 'Europe/Paris'), /demain.*23:30/i);
});

test('le repli date seule garde le jour du calendrier sans mention d’incertitude', () => {
  const { resolveEpisodeAiring, getAiringLabel } = utils();
  const now = Date.parse('2026-09-07T12:00:00Z');
  const label = getAiringLabel(resolveEpisodeAiring(premiere, null, now), translator('en'), 'en-US', now, 'America/Los_Angeles');
  assert.equal(label, 'Scheduled for Sep 8, 2026');
});

test('sans heure, le jour annoncé affiche Diffusé et rejoint les épisodes sortis', () => {
  const { resolveEpisodeAiring, resolveShowAiring, getAiringLabel, getEpisodeTimeline } = utils();
  const episode = { season_number: 4, episode_number: 7, air_date: '2026-09-09' };
  const previous = { ...episode, episode_number: 6, air_date: '2026-09-02' };
  const next = { ...episode, episode_number: 8, air_date: '2026-09-16' };
  for (const [instant, kind, frLabel, enLabel, needsWarning, timeline] of [
    ['2026-09-08T12:00:00Z', 'unconfirmed', 'Diffusion prévue le 9 sept. 2026', 'Scheduled for Sep 9, 2026', true, { last: previous, next: episode }],
    ['2026-09-09T12:00:00Z', 'aired', 'Diffusé', 'Aired', false, { last: episode, next }],
    ['2026-09-10T00:30:00Z', 'aired', 'Diffusé', 'Aired', false, { last: episode, next }],
  ]) {
    const now = Date.parse(instant);
    const airing = resolveEpisodeAiring(episode, null, now);
    assert.equal(airing.kind, kind);
    assert.equal(airing.needsWarning, needsWarning);
    assert.equal(airing.timestamp, null);
    assert.equal(getAiringLabel(airing, translator('fr'), 'fr-FR', now, 'Europe/Paris'), frLabel);
    assert.equal(getAiringLabel(airing, translator('en'), 'en-US', now, 'Europe/Paris'), enLabel);
    assert.deepEqual(resolveShowAiring(episode.air_date, null, now), airing);
    assert.deepEqual(getEpisodeTimeline([next, episode, previous], null, now), timeline);
  }
});

test('sans heure, le statut et l’avertissement basculent à minuit dans le fuseau du visiteur', () => {
  const previousTimeZone = process.env.TZ;
  try {
    const { resolveEpisodeAiring, getAiringLabel } = utils();
    const episode = { ...premiere, air_date: '2026-09-09' };
    for (const [timeZone, localMidnight] of [
      ['Europe/Paris', '2026-09-08T22:00:00Z'],
      ['America/Los_Angeles', '2026-09-09T07:00:00Z'],
      ['Pacific/Kiritimati', '2026-09-08T10:00:00Z'],
      ['Etc/GMT+12', '2026-09-09T12:00:00Z'],
    ]) {
      process.env.TZ = timeZone;
      const now = Date.parse(localMidnight);
      const before = resolveEpisodeAiring(episode, null, now - 1);
      assert.equal(before.kind, 'unconfirmed', timeZone);
      assert.equal(before.needsWarning, true, timeZone);
      assert.equal(getAiringLabel(before, translator('fr'), 'fr-FR', now - 1), 'Diffusion prévue le 9 sept. 2026', timeZone);
      const after = resolveEpisodeAiring(episode, null, now);
      assert.equal(after.kind, 'aired', timeZone);
      assert.equal(after.needsWarning, false, timeZone);
      assert.equal(after.timestamp, null, timeZone);
      assert.equal(getAiringLabel(after, translator('fr'), 'fr-FR', now), 'Diffusé', timeZone);
    }
  } finally {
    if (previousTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimeZone;
  }
});

test('IMDb relie la série et deux consommateurs partagent les requêtes et le cache', async () => {
  const calls = [];
  const { getTvAiringSchedule } = service({ fetch: async (url, options) => {
    calls.push(url);
    assert.equal(options.credentials, 'omit');
    if (url.includes('/lookup/shows?imdb=tt1234567')) return response({ id: 92751, externals: { imdb: 'tt1234567' } });
    if (url.endsWith('/alternatelists')) return response([]);
    assert.equal(url, 'https://api.tvmaze.com/shows/92751/episodes');
    return response([apiEpisode]);
  } });
  const ids = { imdb_id: 'tt1234567' };
  const [first, second] = await Promise.all([getTvAiringSchedule(ids), getTvAiringSchedule(ids)]);
  assert.deepEqual(first, schedule);
  assert.deepEqual(second, schedule);
  assert.deepEqual(await getTvAiringSchedule(ids), schedule);
  assert.equal(calls.length, 3);
});

test('La Casa de Papel : la liste alternative Netflix donne le découpage en parties', async () => {
  const { getTvAiringSchedule } = service({ fetch: async (url) => {
    if (url.includes('/lookup/shows?imdb=')) {
      return response({ id: 27436, externals: { imdb: 'tt6468322' }, network: null, webChannel: { name: 'Netflix' } });
    }
    if (url.endsWith('/shows/27436/alternatelists')) {
      return response([{ id: 17, streaming_premiere: false, webChannel: { name: 'Netflix' } }]);
    }
    if (url.includes('/alternatelists/17/alternateepisodes')) {
      return response([{
        id: 293, name: 'Episode 1', season: 2, number: 1, airdate: '2018-04-06',
        _embedded: { episodes: [{ ...apiEpisode, id: 1150976, name: 'Vrai titre', season: 1, number: 14 }] },
      }]);
    }
    return response([apiEpisode]);
  } });
  const result = await getTvAiringSchedule({ imdb_id: 'tt6468322' });
  assert.equal(result.onNetflix, true);
  assert.equal(result.netflixEpisodeList.length, 1);
  assert.deepEqual(
    { ...result.netflixEpisodeList[0], summary: undefined, image: undefined, runtime: undefined },
    { id: 1150976, season: 2, number: 1, name: 'Vrai titre', airdate: '2018-04-06', summary: undefined, image: undefined, runtime: undefined },
  );
});

test('TVDB prend le relais lorsque l’identifiant IMDb est absent de TVmaze', async () => {
  const { getTvAiringSchedule } = service({ fetch: async (url) => {
    if (url.includes('?imdb=')) return response({}, 404);
    if (url.includes('?thetvdb=123')) return response({ id: 92751, externals: { thetvdb: 123 } });
    return response([apiEpisode]);
  } });
  assert.deepEqual(await getTvAiringSchedule({ imdb_id: 'tt1234567', tvdb_id: 123 }), schedule);
});

test('une erreur réseau ou un quota TVmaze indisponible rend la main sans bloquer la fiche', async () => {
  for (const fetch of [async () => { throw new Error('offline'); }, async () => response({}, 429)]) {
    const { getTvAiringSchedule } = service({ fetch });
    assert.equal(await getTvAiringSchedule({ imdb_id: 'tt1234567' }), null);
  }
});

test('le cache isole les séries et actualise un horaire modifié après expiration', async () => {
  let now = 0;
  let updated = false;
  const { getTvAiringSchedule } = service({
    Date: class extends Date { static now() { return now; } },
    fetch: async (url) => {
      if (url.includes('imdb=tt1234567')) return response({ id: 92751, externals: { imdb: 'tt1234567' } });
      if (url.includes('imdb=tt7654321')) return response({ id: 42, externals: { imdb: 'tt7654321' } });
      return response([{ ...apiEpisode, airstamp: url.includes('/42/') || updated ? '2026-09-10T01:00:00Z' : stamp }]);
    },
  });
  const ids = { imdb_id: 'tt1234567' };
  assert.equal((await getTvAiringSchedule(ids)).episodes['1:1'].timestamp, stamp);
  assert.equal((await getTvAiringSchedule({ imdb_id: 'tt7654321' })).episodes['1:1'].timestamp, '2026-09-10T01:00:00Z');
  updated = true;
  now = 16 * 60_000;
  assert.equal((await getTvAiringSchedule(ids)).episodes['1:1'].timestamp, '2026-09-10T01:00:00Z');
});

test('une requête TVmaze bloquée est annulée par le délai maximal', async () => {
  const { getTvAiringSchedule } = service({
    setTimeout: (callback, delay) => {
      assert.equal(delay, 5_000);
      return setTimeout(callback, 5);
    },
    fetch: async (_, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }),
  });
  assert.equal(await getTvAiringSchedule({ imdb_id: 'tt1234567' }), null);
});

test('aucune recherche par titre lorsque les identifiants manquent ou sont invalides', async () => {
  const { getTvAiringSchedule } = service({ fetch: async () => assert.fail('aucune requête attendue') });
  for (const ids of [undefined, {}, { imdb_id: '../unknown', tvdb_id: -1 }]) {
    assert.equal(await getTvAiringSchedule(ids), null);
  }
});

test('un identifiant renvoyé incohérent ne contamine pas les horaires de la série', async () => {
  const { getTvAiringSchedule } = service({ fetch: async () => response({ id: 1, externals: { imdb: 'tt9999999' } }) });
  assert.equal(await getTvAiringSchedule({ imdb_id: 'tt1234567' }), null);
});

test('une heure TVmaze vide ne transforme pas son airstamp de minuit en horaire confirmé', async () => {
  const { getTvAiringSchedule } = service({ fetch: async (url) => url.includes('/lookup/')
    ? response({ id: 92751, externals: { imdb: 'tt1234567' } })
    : response([{ ...apiEpisode, airtime: '', airstamp: '2026-09-08T00:00:00Z' }, { ...apiEpisode, number: null }]),
  });
  const result = await getTvAiringSchedule({ imdb_id: 'tt1234567' });
  assert.equal(result.episodes['1:1'].timestamp, null);
  assert.deepEqual(Object.keys(result.episodes), ['1:1']);
});
