const assert = require('node:assert/strict');
const test = require('node:test');
const { createStreamedSource, STREAMED_CATALOGS } = require('../streamedCatalog');

function fixture() {
  let time = 1800000000000;
  const cache = new Map();
  const calls = [];
  const s = () => time / 1000;
  const item = (id, category, start, end, extra = {}) => ({
    id, name: `Équipe ${id} vs. Rival ${id}`, category_name: category, starts_at: start, ends_at: end,
    always_live: 0, locale: 'en', source_tag: 'HD | Sky Sports', poster: 'https://static.ppvservices.st/thumb.jpg',
    iframe: `https://embed.example/${id}`, substreams: [], ...extra,
  });
  let response = {
    success: true,
    streams: [
      { category: 'Football', always_live: false, streams: [
        item(1, 'Football', s() + 3600, s() + 9000),
        item(2, 'Football', s() - 9000, s() - 60),
        item(3, 'Football', s() - 1800, s() + 3600),
      ] },
      { category: 'Ice Hockey', always_live: false, streams: [item(4, 'Ice Hockey', s() - 600, s() + 600)] },
      { category: '24/7 Streams', always_live: true, streams: [item(5, 'American Football', 0, 0, { always_live: 1 })] },
    ],
  };
  const source = createStreamedSource({
    now: () => time,
    axios: { async get(url, options) {
      assert.equal(url, 'https://api.ppv.st/api/streams');
      assert.ok(options.timeout > 0 && options.timeout <= 15000);
      calls.push(url);
      if (response instanceof Error) throw response;
      return { data: response };
    } },
    readCache: async (key, maxAge) => {
      const hit = cache.get(key);
      return hit && time - hit.time < maxAge ? hit.value : null;
    },
    writeCache: async (key, value) => { cache.set(key, { value, time }); return true; },
  });
  return { source, calls, item, s, set: value => { response = value; }, advance: ms => { time += ms; } };
}

test('catalogues PPV : sports, statut horaire, tri, chaînes 24/7 écartées et cache partagé', async () => {
  const f = fixture();
  assert.ok(STREAMED_CATALOGS.some(c => c.id === 'streamed_football'));
  const results = await Promise.all(Array.from({ length: 20 }, () => f.source.getCatalog('streamed_all')));
  assert.deepEqual(results[0].map(m => m.id), ['streamed_3', 'streamed_4', 'streamed_1']);
  assert.deepEqual(results[0].map(m => m._isLive), [true, true, false]);
  assert.equal(results[0][1]._sportKey, 'hockey');
  assert.equal(results[0][2]._timestamp, 1800003600000);
  assert.equal(results[0][0]._homeTeam, 'Équipe 3');
  assert.equal(results[0][0]._awayTeam, 'Rival 3');
  assert.deepEqual((await f.source.getCatalog('streamed_football')).map(m => m.id), ['streamed_3', 'streamed_1']);
  assert.deepEqual(await f.source.getCatalog('streamed_unknown'), []);
  assert.equal(f.calls.length, 1);
});

test('une réponse invalide conserve le catalogue précédent et espace les tentatives', async () => {
  const f = fixture();
  await f.source.getCatalog('streamed_all');
  f.advance(61000);
  f.set({ success: false, error: 'API endpoint not found.' });
  assert.equal((await f.source.getCatalog('streamed_all'))[0].id, 'streamed_3');
  const attempts = f.calls.length;
  await f.source.getCatalog('streamed_all');
  assert.equal(f.calls.length, attempts);
  f.advance(15001);
  f.set({ success: true, streams: [] });
  assert.deepEqual(await f.source.getCatalog('streamed_all'), []);
});

test('lecture : flux principal puis variantes, doublons et URL invalides écartés, sans appel en plus', async () => {
  const f = fixture();
  f.set({ success: true, streams: [{ category: 'Football', streams: [f.item(7, 'Football', f.s() - 60, f.s() + 60, {
    substreams: [
      { locale: 'en', source_tag: 'SD | Sky Sports', iframe: 'https://embed.example/7_540p' },
      { iframe: 'https://embed.example/7' },
      { iframe: 'javascript:alert(1)' },
      { iframe: 'https://127.0.0.1/private' },
    ],
  })] }] });
  const streams = await f.source.getStreams('streamed_7');
  assert.deepEqual(streams.map(s => s.url), ['https://embed.example/7', 'https://embed.example/7_540p']);
  assert.deepEqual(streams.map(s => s.title), ['HD | Sky Sports · en', 'SD | Sky Sports · en']);
  assert.ok(streams.every(s => s._isEmbed === true && !s._streamedKey));
  assert.equal(f.calls.length, 1);
  assert.deepEqual(await f.source.getStreams('streamed_99'), []);
  assert.deepEqual(await f.source.getStreams('streamed_../../admin'), []);
});
