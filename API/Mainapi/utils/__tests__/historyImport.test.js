const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  ensureImported,
  importProfile,
  mirrorSyncOps,
  pruneProgressKeys,
  applyMarkOps,
  marksOfProfile,
  touchesMarks,
} = require('../historyImport');
const { removeTitleFromProfile } = require('../historyRules');

const owner = { userType: 'oauth', userId: 'user', profileId: 'profile-one' };

function progress(position, duration, timestamp) {
  return JSON.stringify({ position, duration, timestamp });
}

// Marque « Déjà vu » → `type:id:saison:épisode` (date à part).
const markKey = (mark) => `${mark.mediaType}:${mark.tmdbId}:${mark.season}:${mark.episode}`;

function fakeStore({ failWith = null } = {}) {
  const calls = { recordProgress: [], touch: [], hide: [], hideAll: 0, addMarks: [], removeMarks: [], order: [] };
  return {
    calls,
    async addMarks(who, marks) {
      if (failWith) throw failWith;
      calls.addMarks.push(...marks);
      calls.order.push(`addMarks:${marks.length}`);
      return marks.length;
    },
    async removeMarks(who, marks) {
      if (failWith) throw failWith;
      calls.removeMarks.push(...marks);
      calls.order.push(`removeMarks:${marks.length}`);
      return marks.length;
    },
    async recordProgress(who, entry) {
      if (failWith) throw failWith;
      calls.recordProgress.push({ who, entry });
      calls.order.push(`record:${entry.mediaType}:${entry.tmdbId}`);
    },
    async touch(who, entry) {
      if (failWith) throw failWith;
      calls.touch.push({ who, entry });
      calls.order.push(`touch:${entry.mediaType}:${entry.tmdbId}`);
    },
    async hide(who, mediaType, tmdbId) {
      if (failWith) throw failWith;
      calls.hide.push(`${mediaType}:${tmdbId}`);
      calls.order.push(`hide:${mediaType}:${tmdbId}`);
    },
    async hideAll() {
      if (failWith) throw failWith;
      calls.hideAll++;
      calls.order.push('hideAll');
      return 2;
    },
  };
}

// Faux pool : enregistre [sql, params] ; la table des imports est un Set.
function fakePool({ imported = false } = {}) {
  const calls = [];
  let marked = imported;
  return {
    calls,
    isMarked: () => marked,
    async execute(sql, params) {
      calls.push([sql, params]);
      if (/^\s*SELECT/i.test(sql) && /watch_history_imports/.test(sql)) return [marked ? [{ found: 1 }] : []];
      if (/^\s*INSERT INTO watch_history_imports/i.test(sql)) { marked = true; return [{ affectedRows: 1 }]; }
      throw new Error(`requête inattendue : ${sql}`);
    },
  };
}

function quietWarnings(t) {
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'log', () => {});
}

test('pruneProgressKeys : 610 clés dont 560 progress_* → 550 clés, les plus vieilles supprimées', () => {
  const data = {};
  for (let i = 0; i < 50; i++) data[`setting_${i}`] = 'x';
  // progress_1 est la plus vieille, progress_560 la plus récente.
  for (let i = 1; i <= 560; i++) data[`progress_${i}`] = progress(10, 100, 1_700_000_000_000 + i * 1000);

  const removed = pruneProgressKeys(data, 600);

  assert.equal(Object.keys(data).length, 550);
  assert.equal(removed.length, 60);
  assert.deepEqual(
    [...removed].sort(),
    Array.from({ length: 60 }, (_, i) => `progress_${i + 1}`).sort(),
  );
  for (let i = 0; i < 50; i++) assert.equal(data[`setting_${i}`], 'x');
  assert.ok(data.progress_61);
  assert.ok(data.progress_560);
});

test('pruneProgressKeys : les valeurs illisibles partent en premier, rien sous la limite', () => {
  const data = { progress_1: 'oups', progress_tv_9_s1_e1: progress(1, 2, 1_700_000_000_000) };
  for (let i = 2; i <= 5; i++) data[`progress_${i}`] = progress(1, 2, 1_800_000_000_000 + i);
  assert.deepEqual(pruneProgressKeys({ ...data }, 10), []);

  // 6 clés pour 5 autorisées : la cible (5 - 50) est négative, toutes les
  // progress_* partent, de la plus vieille à la plus récente.
  const copy = { ...data };
  const removed = pruneProgressKeys(copy, 5);
  assert.equal(Object.keys(copy).length, 0);
  assert.equal(removed.length, 6);
  assert.equal(removed[0], 'progress_1');
  assert.equal(removed[1], 'progress_tv_9_s1_e1');
});

test('pruneProgressKeys : sans progress_* à retirer, rien ne bouge', () => {
  const data = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`k${i}`, 'v']));
  assert.deepEqual(pruneProgressKeys(data, 10), []);
  assert.equal(Object.keys(data).length, 12);
});

test('importProfile : 3 recordProgress et aucun touch en double pour la série déjà importée', async (t) => {
  quietWarnings(t);
  const store = fakeStore();
  const result = await importProfile(store, owner, {
    progress_550: progress(30, 100, '2026-10-10T10:00:00.000Z'),
    progress_tv_1_s1_e2: progress(1200, 1300, '2026-10-11T10:00:00.000Z'),
    progress_tv_1_s1_e3: progress(60, 1300, '2026-10-12T10:00:00.000Z'),
    user_language: 'fr',
    continueWatching: JSON.stringify({ tv: [{ id: 1, currentEpisode: { season: 1, episode: 3 } }] }),
  });

  assert.equal(store.calls.recordProgress.length, 3);
  assert.deepEqual(store.calls.recordProgress.map(({ entry }) => `${entry.mediaType}:${entry.tmdbId}:${entry.season}:${entry.episode}`).sort(), [
    'movie:550:0:0',
    'tv:1:1:2',
    'tv:1:1:3',
  ]);
  assert.equal(store.calls.touch.filter(({ entry }) => entry.mediaType === 'tv' && entry.tmdbId === 1).length, 0);
  // continueWatching lisible sans le film 550 non fini : retiré par l'utilisateur.
  assert.deepEqual(store.calls.hide, ['movie:550']);
  assert.deepEqual(result, { progress: 3, titles: 2, hidden: 1 });
});

test('marksOfProfile lit toutes les marques ; importProfile ne les écrit pas (relues sous le verrou après l\'import)', async (t) => {
  quietWarnings(t);
  const data = {
    progress_550: progress(30, 100, '2026-10-10T10:00:00.000Z'),
    watched_movie: JSON.stringify([
      { id: 13, type: 'movie', title: 'Forrest Gump', poster_path: '/fg.jpg', addedAt: '2026-10-01T08:00:00.000Z' },
      { id: 'abc' },
    ]),
    watched_tv: JSON.stringify([{ id: 1399, type: 'tv', title: 'GoT', poster_path: '', addedAt: 'pas une date' }]),
    watched_episodes_tv_94605: JSON.stringify({ S1E1: true, S1E2: false, s2e3: true, S0E1: true, oups: true }),
    watched_episodes_tv_0: JSON.stringify({ S1E1: true }),
  };

  const { marks, complete } = marksOfProfile(data);
  assert.equal(complete, true);
  assert.deepEqual(marks.map(markKey).sort(), ['movie:13:0:0', 'tv:1399:0:0', 'tv:94605:0:1', 'tv:94605:1:1', 'tv:94605:2:3']);
  assert.deepEqual(marks.find((mark) => mark.mediaType === 'movie').markedAt, new Date('2026-10-01T08:00:00.000Z'));
  // Date absente ou invalide : null, le magasin met l'heure de l'insertion.
  assert.equal(marks.find((mark) => mark.tmdbId === 1399).markedAt, null);
  // Clé illisible : marques inconnues → incomplet (rien ne sera retiré).
  assert.equal(marksOfProfile({ ...data, watched_episodes_tv_77: 'pas du json' }).complete, false);

  const store = fakeStore();
  await importProfile(store, owner, data);
  assert.equal(store.calls.addMarks.length + store.calls.removeMarks.length, 0);
});

// Ancienne clé du site : une entrée par épisode vu, toutes séries confondues.
const legacyEpisode = (id, season, episode, addedAt = '2026-01-10T20:00:00.000Z') => (
  { id, type: 'tv', title: `Série ${id}`, poster_path: '/p.jpg', episodeInfo: { season, episode }, addedAt }
);

test('marksOfProfile : watched_tv_episodes (ancienne clé) → marques d\'épisodes, unies à watched_episodes_tv_*', () => {
  const { marks, complete } = marksOfProfile({
    watched_tv_episodes: JSON.stringify([
      legacyEpisode(1399, 1, 1),
      legacyEpisode(1399, 1, 2, '2026-01-12T20:00:00.000Z'),
      legacyEpisode(94605, 2, 3),
      { id: 77, type: 'tv', title: 'Sans épisode' },
      { id: 78, type: 'tv', episodeInfo: { season: 1, episode: 0 } },
      { id: 'abc', episodeInfo: { season: 1, episode: 1 } },
    ]),
    watched_episodes_tv_1399: JSON.stringify({ S1E2: true, S1E3: true }),
  });

  assert.equal(complete, true);
  assert.deepEqual([...new Set(marks.map(markKey))].sort(), ['tv:1399:1:1', 'tv:1399:1:2', 'tv:1399:1:3', 'tv:94605:2:3']);
  const legacy = marks.find((mark) => markKey(mark) === 'tv:1399:1:1');
  assert.deepEqual(legacy.markedAt, new Date('2026-01-10T20:00:00.000Z'));
  // Valeur illisible : marques inconnues.
  assert.equal(marksOfProfile({ watched_tv_episodes: 'oups' }).complete, false);
});

test('applyMarkOps : arrayAdd / arrayRemove sur watched_tv_episodes ; un épisode encore marqué ailleurs n\'est pas retiré', async (t) => {
  quietWarnings(t);
  const before = JSON.stringify([legacyEpisode(1399, 1, 1), legacyEpisode(1399, 1, 2)]);

  const added = fakeStore();
  const afterAdd = JSON.stringify([legacyEpisode(1399, 1, 1), legacyEpisode(1399, 1, 2), legacyEpisode(1399, 1, 3)]);
  await applyMarkOps(added, owner, [{ op: 'arrayAdd', key: 'watched_tv_episodes', value: legacyEpisode(1399, 1, 3) }],
    { watched_tv_episodes: afterAdd }, new Map([['watched_tv_episodes', before]]));
  assert.deepEqual(added.calls.addMarks.map(markKey), ['tv:1399:1:3']);

  // S1E1 retiré de l'ancienne clé mais toujours dans watched_episodes_tv_1399 :
  // la marque reste ; S1E2 retiré partout : la marque part.
  const removed = fakeStore();
  const serverData = {
    watched_tv_episodes: '[]',
    watched_episodes_tv_1399: JSON.stringify({ S1E1: true }),
  };
  await applyMarkOps(removed, owner, [
    { op: 'arrayRemove', key: 'watched_tv_episodes', value: legacyEpisode(1399, 1, 1) },
    { op: 'arrayRemove', key: 'watched_tv_episodes', value: legacyEpisode(1399, 1, 2) },
  ], serverData, new Map([['watched_tv_episodes', before]]));
  assert.deepEqual(removed.calls.removeMarks.map(markKey), ['tv:1399:1:2']);

  // Et dans l'autre sens : retrait de watched_episodes_tv_1399, encore dans l'ancienne clé.
  const other = fakeStore();
  await applyMarkOps(other, owner, [{ op: 'objPatch', key: 'watched_episodes_tv_1399', delta: {} }], {
    watched_tv_episodes: JSON.stringify([legacyEpisode(1399, 1, 1)]),
    watched_episodes_tv_1399: '{}',
  }, new Map([['watched_episodes_tv_1399', JSON.stringify({ S1E1: true })]]));
  assert.equal(other.calls.removeMarks.length, 0);
});

test('removeTitleFromProfile : film — progress_<id>, continueWatching, watched_movie ; autres titres intacts', () => {
  const data = {
    progress_550: progress(30, 100, '2026-10-10T10:00:00.000Z'),
    progress_5500: progress(30, 100, '2026-10-10T10:00:00.000Z'),
    progress_tv_550_s1_e1: progress(30, 100, '2026-10-10T10:00:00.000Z'),
    continueWatching: JSON.stringify({ movies: [{ id: 550 }, 13, '550'], tv: [{ id: 550, currentEpisode: { season: 1, episode: 1 } }] }),
    watched_movie: JSON.stringify([{ id: 550, type: 'movie' }, { id: 13, type: 'movie' }]),
    watched_tv: JSON.stringify([{ id: 550, type: 'tv' }]),
    user_language: 'fr',
  };

  assert.equal(removeTitleFromProfile(data, 'movie', 550), true);
  assert.deepEqual(Object.keys(data).sort(), ['continueWatching', 'progress_5500', 'progress_tv_550_s1_e1', 'user_language', 'watched_movie', 'watched_tv']);
  assert.deepEqual(JSON.parse(data.continueWatching), { movies: [13], tv: [{ id: 550, currentEpisode: { season: 1, episode: 1 } }] });
  assert.deepEqual(JSON.parse(data.watched_movie), [{ id: 13, type: 'movie' }]);
  // Rien à retirer : faux, rien ne change.
  const before = JSON.stringify(data);
  assert.equal(removeTitleFromProfile(data, 'movie', 550), false);
  assert.equal(JSON.stringify(data), before);
});

test('removeTitleFromProfile : série — progress_tv_<id>_*, continueWatching, watched_tv, watched_episodes_tv_<id>, ancienne clé ; valeurs illisibles intactes', () => {
  const data = {
    progress_tv_1399_s1_e1: '{}',
    progress_tv_1399_s10_e12: '{}',
    progress_tv_13990_s1_e1: '{}',
    progress_1399: progress(1, 2, '2026-10-10T10:00:00.000Z'),
    continueWatching: JSON.stringify([{ id: 1399, media_type: 'tv' }, { id: 1399, media_type: 'movie' }]),
    watched_tv: JSON.stringify([{ id: '1399', type: 'tv' }, { id: 1, type: 'tv' }]),
    watched_episodes_tv_1399: JSON.stringify({ S1E1: true }),
    watched_episodes_tv_13990: JSON.stringify({ S1E1: true }),
    watched_tv_episodes: JSON.stringify([
      { id: 1399, type: 'tv', episodeInfo: { season: 1, episode: 1 } },
      { id: 94605, type: 'tv', episodeInfo: { season: 1, episode: 1 } },
    ]),
    watched_movie: 'oups',
  };

  assert.equal(removeTitleFromProfile(data, 'tv', 1399), true);
  assert.deepEqual(Object.keys(data).sort(), [
    'continueWatching', 'progress_1399', 'progress_tv_13990_s1_e1', 'watched_episodes_tv_13990', 'watched_movie', 'watched_tv', 'watched_tv_episodes',
  ]);
  // Ancien format plat : seule l'entrée série part, le film de même id reste.
  assert.deepEqual(JSON.parse(data.continueWatching), [{ id: 1399, media_type: 'movie' }]);
  assert.deepEqual(JSON.parse(data.watched_tv), [{ id: 1, type: 'tv' }]);
  assert.deepEqual(JSON.parse(data.watched_tv_episodes).map((entry) => entry.id), [94605]);
  assert.equal(data.watched_movie, 'oups');
});

test('ensureImported : afterImport lancé après un import fait, jamais pour « déjà importé »', async (t) => {
  quietWarnings(t);
  const after = [];
  const withLock = async (_pool, _name, task) => task();
  const read = async () => ({ progress_550: progress(30, 100, '2026-10-10T10:00:00.000Z') });
  const who = { ...owner, profileId: 'profile-after-1' };

  assert.equal(await ensureImported(fakePool(), fakeStore(), who, read, { withLock, afterImport: async (o) => { after.push(o); } }), 'imported');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(after, [who]);

  const done = { ...owner, profileId: 'profile-after-2' };
  assert.equal(await ensureImported(fakePool({ imported: true }), fakeStore(), done, read, { withLock, afterImport: async (o) => { after.push(o); } }), 'already');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(after.length, 1);
});

test('importProfile : titres absents de continueWatching importés masqués, sauf film fini', async (t) => {
  quietWarnings(t);
  const store = fakeStore();
  const result = await importProfile(store, owner, {
    progress_550: progress(30, 100, '2026-10-10T10:00:00.000Z'),
    progress_13: progress(98, 100, '2026-10-10T10:00:00.000Z'),
    progress_tv_7_s1_e1: progress(98, 100, '2026-10-10T10:00:00.000Z'),
    progress_27205: progress(10, 100, '2026-10-10T10:00:00.000Z'),
    continueWatching: JSON.stringify({ movies: [{ id: 27205 }], tv: [] }),
  });

  assert.deepEqual([...store.calls.hide].sort(), ['movie:550', 'tv:7']);
  assert.equal(result.hidden, 2);
  // Masqué après sa progression, sinon recordProgress le ferait revenir.
  assert.ok(store.calls.order.indexOf('hide:movie:550') > store.calls.order.indexOf('record:movie:550'));
});

test('importProfile : liste vide → tout masqué ; clé absente ou illisible → tout visible', async (t) => {
  quietWarnings(t);
  const data = { progress_550: progress(30, 100, '2026-10-10T10:00:00.000Z') };

  const empty = fakeStore();
  await importProfile(empty, owner, { ...data, continueWatching: '[]' });
  assert.deepEqual(empty.calls.hide, ['movie:550']);

  const absent = fakeStore();
  await importProfile(absent, owner, data);
  assert.deepEqual(absent.calls.hide, []);

  const broken = fakeStore();
  await importProfile(broken, owner, { ...data, continueWatching: 'oups' });
  assert.deepEqual(broken.calls.hide, []);
});

test('importProfile : entrées continueWatching dédoublonnées, date de repli 1970 sans progression', async (t) => {
  quietWarnings(t);
  const store = fakeStore();
  await importProfile(store, owner, {
    progress_550: progress(30, 100, '2026-10-10T10:00:00.000Z'),
    continueWatching: JSON.stringify({
      movies: [
        27205,
        { id: 27205, lastAccessed: '2026-10-01T00:00:00.000Z' },
        { id: 550, lastAccessed: '2026-10-15T00:00:00.000Z' },
        { id: 550, lastAccessed: '2026-10-09T00:00:00.000Z' },
        13,
      ],
    }),
  });

  const touches = store.calls.touch.map(({ entry }) => [`${entry.mediaType}:${entry.tmdbId}`, entry.at.toISOString()]);
  assert.deepEqual(touches.sort(), [
    ['movie:13', '1970-01-01T00:00:00.000Z'],
    ['movie:27205', '2026-10-01T00:00:00.000Z'],
    // Plus récent que sa progression : la carte remonte.
    ['movie:550', '2026-10-15T00:00:00.000Z'],
  ]);
});

test('ensureImported : importe une seule fois, marque après succès, verrou au bon nom', async (t) => {
  quietWarnings(t);
  const store = fakeStore();
  const pool = fakePool();
  const locks = [];
  const withLock = async (_pool, name, task) => { locks.push(name); return task(); };
  const who = { ...owner, profileId: 'profile-ensure-1' };
  let reads = 0;
  const read = async (userType, userId, profileId) => {
    reads++;
    assert.deepEqual([userType, userId, profileId], [who.userType, who.userId, who.profileId]);
    return { progress_550: progress(30, 100, '2026-10-10T10:00:00.000Z') };
  };

  assert.equal(await ensureImported(pool, store, who, read, { withLock }), 'imported');
  assert.equal(await ensureImported(pool, store, who, read, { withLock }), 'already');

  const digest = crypto.createHash('sha1').update(`${who.userType}:${who.userId}:${who.profileId}`).digest('hex');
  assert.deepEqual(locks, [`mainapi:history-import:${digest}`]);
  assert.equal(reads, 1);
  assert.equal(store.calls.recordProgress.length, 1);
  assert.ok(pool.isMarked());
  const insert = pool.calls.find(([sql]) => /INSERT INTO watch_history_imports/.test(sql));
  assert.deepEqual(insert[1].slice(0, 3), [who.userType, who.userId, who.profileId]);
});

test('ensureImported : profil déjà marqué → aucun import', async (t) => {
  quietWarnings(t);
  const store = fakeStore();
  const pool = fakePool({ imported: true });
  const status = await ensureImported(pool, store, { ...owner, profileId: 'profile-ensure-2' }, async () => { throw new Error('ne doit pas lire'); }, {
    withLock: async () => { throw new Error('ne doit pas verrouiller'); },
  });
  assert.equal(status, 'already');
  assert.equal(store.calls.recordProgress.length, 0);
});

test('ensureImported : un import en échec renvoie failed, ne marque pas, puis attend avant de réessayer', async (t) => {
  quietWarnings(t);
  const store = fakeStore({ failWith: new Error('SQL en panne') });
  const pool = fakePool();
  const who = { ...owner, profileId: 'profile-ensure-3' };
  const read = async () => ({ progress_550: progress(30, 100, '2026-10-10T10:00:00.000Z') });
  const withLock = async (_pool, _name, task) => task();

  assert.equal(await ensureImported(pool, store, who, read, { withLock }), 'failed');
  assert.equal(pool.isMarked(), false);
  assert.equal(await ensureImported(pool, store, who, read, { withLock }), 'deferred');
});

test('ensureImported : au plus 2 imports à la fois, le 3e est remis à plus tard', async (t) => {
  quietWarnings(t);
  const store = fakeStore();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let entered = 0;
  const withLock = async (_pool, _name, task) => { entered++; await gate; return task(); };
  const read = async () => ({ progress_550: progress(30, 100, '2026-10-10T10:00:00.000Z') });
  const who = (n) => ({ ...owner, profileId: `profile-limit-${n}` });

  const first = ensureImported(fakePool(), store, who(1), read, { withLock });
  const second = ensureImported(fakePool(), store, who(2), read, { withLock });
  await new Promise((resolve) => setImmediate(resolve));
  const thirdPool = fakePool();
  assert.equal(await ensureImported(thirdPool, store, who(3), read, { withLock }), 'deferred');
  assert.equal(entered, 2);

  release();
  assert.deepEqual(await Promise.all([first, second]), ['imported', 'imported']);
  // Une place est libre : le 3e passe au prochain appel, sans délai d'attente.
  assert.equal(await ensureImported(thirdPool, store, who(3), read, { withLock }), 'imported');
});

test('mirrorSyncOps : recopie les progress_* modifiées et les ouvertures plus récentes', async (t) => {
  quietWarnings(t);
  const store = fakeStore();
  const previous = new Map([
    ['progress_550', progress(10, 100, '2026-10-10T10:00:00.000Z')],
    ['progress_13', progress(10, 100, '2026-10-10T10:00:00.000Z')],
    ['continueWatching', JSON.stringify({ movies: [{ id: 550, lastAccessed: '2026-10-10T10:00:00.000Z' }, { id: 13, lastAccessed: '2026-10-10T10:00:00.000Z' }] })],
  ]);
  const serverData = {
    progress_550: progress(20, 100, '2026-10-16T10:00:00.000Z'),
    progress_13: progress(10, 100, '2026-10-10T10:00:00.000Z'),
    progress_abc: progress(10, 100, '2026-10-16T10:00:00.000Z'),
    progress_tv_5_s1_e1: 'pas du json',
    continueWatching: JSON.stringify({ movies: [{ id: 550, lastAccessed: '2026-10-16T10:00:00.000Z' }, { id: 13, lastAccessed: '2026-10-10T10:00:00.000Z' }, 77] }),
  };
  const ops = [
    { op: 'set', key: 'progress_550', value: serverData.progress_550 },
    { op: 'set', key: 'progress_550', value: serverData.progress_550 },
    { op: 'set', key: 'progress_13', value: serverData.progress_13 },
    { op: 'set', key: 'progress_abc', value: serverData.progress_abc },
    { op: 'set', key: 'progress_tv_5_s1_e1', value: serverData.progress_tv_5_s1_e1 },
    { op: 'remove', key: 'progress_99' },
    { op: 'objPatch', key: 'continueWatching', delta: {} },
  ];

  await mirrorSyncOps(store, owner, ops, serverData, previous);

  assert.equal(store.calls.recordProgress.length, 1);
  assert.deepEqual(store.calls.recordProgress[0].entry, {
    mediaType: 'movie', tmdbId: 550, season: 0, episode: 0,
    position: 20, duration: 100, updatedAt: new Date('2026-10-16T10:00:00.000Z'),
  });
  assert.deepEqual(store.calls.touch.map(({ entry }) => entry.tmdbId), [550]);
});

test('mirrorSyncOps : une entrée retirée de continueWatching masque le titre', async (t) => {
  quietWarnings(t);
  const store = fakeStore();
  const before = JSON.stringify({ movies: [{ id: 550 }, { id: 13 }], tv: [{ id: 1, currentEpisode: { season: 1, episode: 2 } }] });
  const after = JSON.stringify({ movies: [{ id: 13 }], tv: [] });
  const op = [{ op: 'set', key: 'continueWatching', value: after }];

  await mirrorSyncOps(store, owner, op, { continueWatching: after }, new Map([['continueWatching', before]]));
  assert.deepEqual([...store.calls.hide].sort(), ['movie:550', 'tv:1']);

  // Nouvelle valeur illisible : rien n'est masqué.
  const broken = fakeStore();
  await mirrorSyncOps(broken, owner, op, { continueWatching: 'oups' }, new Map([['continueWatching', before]]));
  assert.deepEqual(broken.calls.hide, []);
});

test('mirrorSyncOps : une erreur du magasin est loguée, jamais propagée', async (t) => {
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => { warnings.push(args.join(' ')); });
  const store = fakeStore({ failWith: new Error('SQL en panne') });
  await mirrorSyncOps(store, owner, [{ op: 'set', key: 'progress_550', value: 'x' }], {
    progress_550: progress(20, 100, '2026-10-16T10:00:00.000Z'),
  });
  assert.ok(warnings.some((line) => line.includes('[HISTORY]')));
});

test('mirrorSyncOps : `remove` de continueWatching vide toute la rangée « Reprendre »', async (t) => {
  quietWarnings(t);
  const store = fakeStore();
  const before = JSON.stringify({ movies: [{ id: 550 }] });
  await mirrorSyncOps(store, owner, [{ op: 'remove', key: 'continueWatching' }], { continueWatching: undefined }, new Map([['continueWatching', before]]));
  assert.equal(store.calls.hideAll, 1);

  // Retirée puis remise dans le même envoi : la valeur finale existe, pas de hideAll.
  const readded = fakeStore();
  const after = JSON.stringify({ movies: [{ id: 550 }] });
  await mirrorSyncOps(readded, owner, [
    { op: 'remove', key: 'continueWatching' },
    { op: 'set', key: 'continueWatching', value: after },
  ], { continueWatching: after }, new Map([['continueWatching', before]]));
  assert.equal(readded.calls.hideAll, 0);
});

test('mirrorSyncOps : historique désactivé (`settings_disable_history` → true) vide la rangée', async (t) => {
  quietWarnings(t);
  const store = fakeStore();
  await mirrorSyncOps(store, owner, [
    { op: 'set', key: 'settings_disable_history', value: 'true' },
    { op: 'set', key: 'progress_550', value: progress(20, 100, '2026-10-16T10:00:00.000Z') },
  ], {
    settings_disable_history: 'true',
    progress_550: progress(20, 100, '2026-10-16T10:00:00.000Z'),
  }, new Map([['settings_disable_history', 'false']]));
  assert.equal(store.calls.hideAll, 1);
  // Masqué en dernier : la progression recopiée ne fait pas revenir le titre.
  assert.equal(store.calls.order.at(-1), 'hideAll');

  // Réactivé, ou renvoi de la même valeur : rien n'est masqué.
  const enabled = fakeStore();
  await mirrorSyncOps(enabled, owner, [{ op: 'set', key: 'settings_disable_history', value: 'false' }],
    { settings_disable_history: 'false' }, new Map([['settings_disable_history', 'true']]));
  const same = fakeStore();
  await mirrorSyncOps(same, owner, [{ op: 'set', key: 'settings_disable_history', value: 'true' }],
    { settings_disable_history: 'true' }, new Map([['settings_disable_history', 'true']]));
  assert.equal(enabled.calls.hideAll + same.calls.hideAll, 0);
});

test('mirrorSyncOps : les clés de marques ne passent plus par le miroir (écrites sous le verrou)', async (t) => {
  quietWarnings(t);
  const store = fakeStore();
  await mirrorSyncOps(store, owner, [
    { op: 'set', key: 'watched_movie', value: JSON.stringify([{ id: 550 }]) },
    { op: 'remove', key: 'watched_episodes_tv_1399' },
  ], { watched_movie: JSON.stringify([{ id: 550 }]) }, new Map([['watched_movie', '[]'], ['watched_episodes_tv_1399', '{"S1E1":true}']]));
  assert.equal(store.calls.order.length, 0);
  assert.equal(touchesMarks([{ op: 'arrayAdd', key: 'watched_tv' }]), true);
  assert.equal(touchesMarks([{ op: 'set', key: 'progress_550' }]), false);
});

test('applyMarkOps : watched_movie / watched_tv → marques ajoutées et retirées selon la différence', async (t) => {
  quietWarnings(t);
  const store = fakeStore();
  const previous = new Map([
    ['watched_movie', JSON.stringify([
      { id: 550, type: 'movie', addedAt: '2026-10-01T08:00:00.000Z' },
      { id: 13, type: 'movie', addedAt: '2026-10-02T08:00:00.000Z' },
    ])],
    ['watched_tv', undefined],
  ]);
  const serverData = {
    watched_movie: JSON.stringify([
      { id: 27205, type: 'movie', title: 'Inception', poster_path: '/i.jpg', addedAt: '2026-10-16T08:00:00.000Z' },
      { id: 550, type: 'movie', addedAt: '2026-10-01T08:00:00.000Z' },
    ]),
    watched_tv: JSON.stringify([{ id: 1399, type: 'tv', addedAt: '2026-10-16T09:00:00.000Z' }]),
  };

  await applyMarkOps(store, owner, [
    { op: 'set', key: 'watched_movie', value: serverData.watched_movie },
    { op: 'set', key: 'watched_tv', value: serverData.watched_tv },
  ], serverData, previous);

  assert.deepEqual(store.calls.addMarks.map(markKey).sort(), ['movie:27205:0:0', 'tv:1399:0:0']);
  assert.deepEqual(store.calls.addMarks.find((mark) => mark.tmdbId === 27205).markedAt, new Date('2026-10-16T08:00:00.000Z'));
  assert.deepEqual(store.calls.removeMarks.map(markKey), ['movie:13:0:0']);
  // Une marque ne touche ni l'historique ni « Reprendre ».
  assert.equal(store.calls.recordProgress.length + store.calls.touch.length + store.calls.hide.length + store.calls.hideAll, 0);
});

test('applyMarkOps : watched_episodes_tv_* → une marque par épisode à true ; clé retirée → toutes ses marques retirées', async (t) => {
  quietWarnings(t);
  const store = fakeStore();
  const before = JSON.stringify({ S1E1: true, S1E2: true, S1E3: false });
  const after = JSON.stringify({ S1E1: true, S1E3: true, s2e1: true, S1E4: false, oups: true });

  await applyMarkOps(store, owner, [{ op: 'objPatch', key: 'watched_episodes_tv_1399', delta: {} }],
    { watched_episodes_tv_1399: after }, new Map([['watched_episodes_tv_1399', before]]));

  assert.deepEqual(store.calls.addMarks.map(markKey).sort(), ['tv:1399:1:3', 'tv:1399:2:1']);
  assert.deepEqual(store.calls.removeMarks.map(markKey), ['tv:1399:1:2']);

  const removed = fakeStore();
  await applyMarkOps(removed, owner, [{ op: 'remove', key: 'watched_episodes_tv_1399' }],
    { watched_episodes_tv_1399: undefined }, new Map([['watched_episodes_tv_1399', after]]));
  assert.deepEqual(removed.calls.removeMarks.map(markKey).sort(), ['tv:1399:1:1', 'tv:1399:1:3', 'tv:1399:2:1']);
  assert.equal(removed.calls.addMarks.length, 0);

  // Valeur renvoyée telle quelle : rien à faire.
  const same = fakeStore();
  await applyMarkOps(same, owner, [{ op: 'set', key: 'watched_episodes_tv_1399', value: after }],
    { watched_episodes_tv_1399: after }, new Map([['watched_episodes_tv_1399', after]]));
  assert.equal(same.calls.order.length, 0);
});

test('applyMarkOps : arrayAdd / arrayRemove / arrayClear sur une liste de marques comptent aussi', async (t) => {
  quietWarnings(t);
  const before = JSON.stringify([{ id: 13, type: 'movie' }]);
  const after = JSON.stringify([{ id: 13, type: 'movie' }, { id: 550, type: 'movie' }]);

  const added = fakeStore();
  await applyMarkOps(added, owner, [{ op: 'arrayAdd', key: 'watched_movie', value: { id: 550, type: 'movie' } }],
    { watched_movie: after }, new Map([['watched_movie', before]]));
  assert.deepEqual(added.calls.addMarks.map(markKey), ['movie:550:0:0']);
  assert.equal(added.calls.removeMarks.length, 0);

  const cleared = fakeStore();
  await applyMarkOps(cleared, owner, [{ op: 'arrayClear', key: 'watched_tv' }],
    { watched_tv: '[]' }, new Map([['watched_tv', JSON.stringify([{ id: 1399, type: 'tv' }])]]));
  assert.deepEqual(cleared.calls.removeMarks.map(markKey), ['tv:1399:0:0']);

  // Une autre clé en arrayAdd (pas une marque) reste ignorée, comme avant.
  const other = fakeStore();
  await applyMarkOps(other, owner, [{ op: 'arrayAdd', key: 'watchlist_movie', value: { id: 1 } }],
    { watchlist_movie: '[{"id":1}]' }, new Map([['watchlist_movie', '[]']]));
  assert.equal(other.calls.order.length, 0);
});

test('applyMarkOps : marques illisibles ou ancienne valeur inconnue → rien n’est retiré', async (t) => {
  quietWarnings(t);
  const before = JSON.stringify([{ id: 550 }, { id: 13 }]);

  // Nouvelle valeur illisible : on ne touche à rien.
  const broken = fakeStore();
  await applyMarkOps(broken, owner, [{ op: 'set', key: 'watched_movie', value: 'oups' }],
    { watched_movie: 'oups' }, new Map([['watched_movie', before]]));
  assert.equal(broken.calls.order.length, 0);

  // Sans valeurs précédentes : ajouts seulement.
  const unknown = fakeStore();
  await applyMarkOps(unknown, owner, [{ op: 'set', key: 'watched_movie', value: JSON.stringify([{ id: 550 }]) }],
    { watched_movie: JSON.stringify([{ id: 550 }]) });
  assert.deepEqual(unknown.calls.addMarks.map(markKey), ['movie:550:0:0']);
  assert.equal(unknown.calls.removeMarks.length, 0);

  // Ancienne valeur illisible : ajouts seulement aussi.
  const oldBroken = fakeStore();
  await applyMarkOps(oldBroken, owner, [{ op: 'set', key: 'watched_movie', value: '[]' }],
    { watched_movie: '[]' }, new Map([['watched_movie', 'oups']]));
  assert.equal(oldBroken.calls.order.length, 0);

  // Une erreur du magasin est loguée, jamais propagée.
  const failing = fakeStore({ failWith: new Error('SQL en panne') });
  await assert.doesNotReject(applyMarkOps(failing, owner, [{ op: 'set', key: 'watched_movie', value: '[]' }],
    { watched_movie: '[]' }, new Map([['watched_movie', before]])));
});

test('importProfile : historique désactivé → tout est importé puis masqué', async (t) => {
  quietWarnings(t);
  const store = fakeStore();
  const result = await importProfile(store, owner, {
    progress_550: progress(30, 100, '2026-10-10T10:00:00.000Z'),
    settings_disable_history: 'true',
  });
  // La progression est gardée, mais rien ne reste dans « Reprendre ».
  assert.equal(store.calls.recordProgress.length, 1);
  assert.equal(store.calls.hideAll, 1);
  assert.equal(store.calls.order.at(-1), 'hideAll');
  assert.equal(result.hidden, 2);

  const enabled = fakeStore();
  await importProfile(enabled, owner, { progress_550: progress(30, 100, '2026-10-10T10:00:00.000Z'), settings_disable_history: 'false' });
  assert.equal(enabled.calls.hideAll, 0);
});
