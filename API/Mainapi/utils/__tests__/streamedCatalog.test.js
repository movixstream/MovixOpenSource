const assert = require('node:assert/strict');
const test = require('node:test');
const { createStreamedSource, STREAMED_CATALOGS } = require('../streamedCatalog');

function fixture() {
  let time = 1800000000000;
  const cache = new Map();
  const calls = [];
  const responses = new Map();
  const match = (id, category, date, sources = [{ source: 'admin', id }]) => ({
    id, title: `Match ${id}`, category, date, sources,
  });
  responses.set('/api/matches/all', [
    match('future', 'football', time + 3600000),
    match('finished', 'football', time - 4 * 3600000),
    match('started', 'football', time - 1800000),
    match('live', 'basketball', time - 4 * 3600000),
    match('empty', 'golf', time + 60000, []),
  ]);
  responses.set('/api/matches/live', [match('live', 'basketball', time - 4 * 3600000)]);
  const source = createStreamedSource({
    now: () => time,
    axios: { async get(url, options) {
      assert.equal(new URL(url).origin, 'https://streamed.pk');
      assert.ok(options.timeout > 0 && options.timeout <= 15000);
      const pathname = new URL(url).pathname;
      calls.push(pathname);
      const value = responses.get(pathname);
      if (value instanceof Error) throw value;
      assert.notEqual(value, undefined, `Appel inattendu : ${pathname}`);
      return { data: value };
    } },
    readCache: async (key, maxAge) => {
      const hit = cache.get(key);
      return hit && time - hit.time < maxAge ? hit.value : null;
    },
    writeCache: async (key, value) => { cache.set(key, { value, time }); return true; },
  });
  return { source, calls, responses, match, advance: ms => { time += ms; } };
}

test('catalogues Streamed : sports, statut amont, tri, absence de doublons et cache partagé', async () => {
  const f = fixture();
  assert.ok(STREAMED_CATALOGS.some(c => c.id === 'streamed_football'));
  assert.ok(STREAMED_CATALOGS.some(c => c.id === 'streamed_golf'));
  const results = await Promise.all(Array.from({ length: 20 }, () => f.source.getCatalog('streamed_all')));
  assert.deepEqual(results[0].map(m => m.id), ['streamed_live', 'streamed_started', 'streamed_empty', 'streamed_future']);
  assert.equal(results[0][0]._isLive, true);
  assert.equal(results[0][1]._isLive, false);
  assert.equal(results[0][2]._serverCount, 0);
  assert.equal(results[0][3]._timestamp, 1800003600000);
  assert.equal(results[0][0]._sportKey, 'basketball');
  assert.deepEqual((await f.source.getCatalog('streamed_football')).map(m => m.id), ['streamed_started', 'streamed_future']);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(await f.source.getCatalog('streamed_unknown'), []);
  assert.equal(f.calls.length, 2);
});

test('une réponse invalide conserve le catalogue précédent et espace les tentatives', async () => {
  const f = fixture();
  await f.source.getCatalog('streamed_all');
  f.advance(61000);
  f.responses.set('/api/matches/live', { error: 'upstream unavailable' });
  const stale = await f.source.getCatalog('streamed_all');
  assert.equal(stale[0].id, 'streamed_live');
  const attempts = f.calls.length;
  await f.source.getCatalog('streamed_all');
  assert.equal(f.calls.length, attempts);
  f.advance(15001);
  f.responses.set('/api/matches/live', []);
  const recovered = await f.source.getCatalog('streamed_all');
  assert.ok(recovered.every(m => !m._isLive));
  assert.ok(recovered.every(m => m.id !== 'streamed_live'));
});

test('lecture : ordre des flux conservé, doublons et URL invalides écartés', async () => {
  const f = fixture();
  f.responses.get('/api/matches/live')[0].sources = [
    { source: 'admin', id: 'live' }, { source: 'delta', id: 'other' }, { source: 'echo', id: 'offline' },
  ];
  const stream = (n, language, embedUrl) => ({ streamNo: n, language, hd: true, embedUrl });
  f.responses.set('/api/stream/admin/live', [
    stream(1, 'English', 'https://embed.st/embed/admin/live/1'),
    stream(2, 'French - Canal+', 'https://embed.st/embed/admin/live/2'),
    stream(3, 'French', 'javascript:alert(1)'),
    stream(4, 'French', 'https://127.0.0.1/private'),
  ]);
  f.responses.set('/api/stream/delta/other', [stream(1, 'English', 'https://embed.st/embed/admin/live/1')]);
  f.responses.set('/api/stream/echo/offline', new Error('indisponible'));
  const results = await Promise.all(Array.from({ length: 20 }, () => f.source.getStreams('streamed_live')));
  assert.equal(results[0].length, 2);
  assert.deepEqual(results[0].map(s => s.url), ['https://embed.st/embed/admin/live/1', 'https://embed.st/embed/admin/live/2']);
  assert.ok(results[0].every(s => s._isEmbed === true));
  assert.equal(f.calls.filter(c => c.startsWith('/api/stream/')).length, 3);
  await f.source.getStreams('streamed_live');
  assert.equal(f.calls.filter(c => c.startsWith('/api/stream/')).length, 3);
  assert.deepEqual(await f.source.getStreams('streamed_unknown'), []);
  assert.deepEqual(await f.source.getStreams('streamed_../../admin'), []);
});

test('Golf précède Foxtrot comme sur Streamed, avec les flux regroupés même en présence de français', async () => {
  const f = fixture();
  const refs = [
    { source: 'delta', id: 'other' },
    { source: 'foxtrot', id: 'atletico-madrid-vs-real-madrid' },
    { source: 'golf', id: '1485' },
    { source: 'admin', id: 'live' },
  ];
  f.responses.get('/api/matches/live')[0].sources = refs;
  const stream = (ref, streamNo, language, hd = true) => ({
    streamNo, language, hd, embedUrl: `https://embed.st/embed/${ref.source}/${ref.id}/${streamNo}`,
  });
  const delta = stream(refs[0], 1, 'French');
  const foxtrot = [stream(refs[1], 1, 'beIN Sports 2 Aussie'), stream(refs[1], 2, 'DAZN LaLiga'), stream(refs[1], 3, 'beIN Sports 1 MENA')];
  const golf = [stream(refs[2], 1, 'English'), stream(refs[2], 2, 'English', false)];
  const admin = stream(refs[3], 1, 'French');
  f.responses.set('/api/stream/delta/other', [delta]);
  f.responses.set('/api/stream/foxtrot/atletico-madrid-vs-real-madrid', foxtrot);
  f.responses.set('/api/stream/golf/1485', golf);
  f.responses.set('/api/stream/admin/live', [admin]);

  const streams = await f.source.getStreams('streamed_live');
  assert.deepEqual(streams.map(s => s.url), [...golf, ...foxtrot, delta, admin].map(s => s.embedUrl));
  assert.deepEqual(streams.slice(0, 5).map(s => s.title), [
    'golf · 1 · English · HD', 'golf · 2 · English · SD',
    'foxtrot · 1 · beIN Sports 2 Aussie · HD', 'foxtrot · 2 · DAZN LaLiga · HD', 'foxtrot · 3 · beIN Sports 1 MENA · HD',
  ]);
  assert.deepEqual(streams.slice(0, 5).map(s => s._streamedKey), [
    '3b3292e769fed5492830b68c', '1eeda36e3ade8ac5f15ea891',
    '6560d481b4bbe267780b32cd', 'd8f5c26cda4ab6ce8d471f08', '66eadba45e96ec3d6606d3e8',
  ]);
  assert.deepEqual(await f.source.getStreams('streamed_live'), streams);
  assert.equal(f.calls.filter(c => c.startsWith('/api/stream/')).length, 4);
  assert.deepEqual(refs.map(ref => ref.source), ['delta', 'foxtrot', 'golf', 'admin']);
});

test('une panne de tous les serveurs conserve les derniers lecteurs puis autorise la reprise', async () => {
  const f = fixture();
  const initial = [{ streamNo: 1, language: 'English', embedUrl: 'https://embed.st/embed/admin/live/1' }];
  f.responses.set('/api/stream/admin/live', initial);
  await f.source.getStreams('streamed_live');
  f.advance(31000);
  f.responses.set('/api/stream/admin/live', new Error('panne'));
  assert.equal((await f.source.getStreams('streamed_live')).length, 1);
  const attempts = f.calls.length;
  await f.source.getStreams('streamed_live');
  assert.equal(f.calls.length, attempts);
  f.advance(15001);
  f.responses.set('/api/stream/admin/live', []);
  assert.deepEqual(await f.source.getStreams('streamed_live'), []);
});
