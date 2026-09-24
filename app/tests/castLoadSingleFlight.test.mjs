import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import vm from 'node:vm';

async function loadHelper() {
  let source;
  try {
    source = await readFile(
      new URL('../src/services/castLoadSingleFlight.ts', import.meta.url),
      'utf8',
    );
  } catch (error) {
    assert.fail(`cast load single-flight helper must exist: ${error.message}`);
  }
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(`(function(module,exports){${output}\n})`, {})(
    module,
    module.exports,
  );
  return module.exports;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

function identity(exact, logical = exact) {
  return { exact, logical };
}

const baseSource = {
  url: 'https://cdn.example/master.m3u8',
  headers: { Referer: 'https://player.example/', Accept: 'application/m3u8' },
  contentType: 'application/vnd.apple.mpegurl',
  protocolVersion: 1,
  tracks: [{
    url: 'https://cdn.example/fr.vtt',
    headers: { Referer: 'https://player.example/' },
    contentType: 'text/vtt',
    protocolVersion: 1,
    language: 'fr',
    name: 'Fran\u00e7ais',
    active: true,
  }],
};

test('concurrent calls with one identity share the exact pending promise', async () => {
  const { createCastLoadSingleFlight } = await loadHelper();
  const flight = createCastLoadSingleFlight();
  const pending = deferred();
  let calls = 0;
  const first = flight.run(identity('same'), () => {
    calls += 1;
    return pending.promise;
  });
  const second = flight.run(identity('same'), () => {
    calls += 1;
    return Promise.resolve('unexpected');
  });

  assert.equal(calls, 1);
  assert.equal(first.coalesced, false);
  assert.equal(second.coalesced, true);
  assert.equal(first.promise, second.promise);
  pending.resolve('loaded');
  assert.equal(await second.promise, 'loaded');
});

test('successful calls are coalesced for three seconds and then expire', async () => {
  const { createCastLoadSingleFlight } = await loadHelper();
  let now = 10_000;
  const flight = createCastLoadSingleFlight({ clock: () => now });
  let calls = 0;
  const first = flight.run(identity('same'), async () => ++calls);
  assert.equal(await first.promise, 1);

  now += 3_000;
  const recent = flight.run(identity('same'), async () => ++calls);
  assert.equal(recent.coalesced, true);
  assert.equal(recent.promise, first.promise);
  assert.equal(await recent.promise, 1);

  now += 1;
  const expired = flight.run(identity('same'), async () => ++calls);
  assert.equal(expired.coalesced, false);
  assert.equal(await expired.promise, 2);
});

test('a failure clears immediately so the same identity can retry', async () => {
  const { createCastLoadSingleFlight } = await loadHelper();
  const flight = createCastLoadSingleFlight();
  let calls = 0;
  const failed = flight.run(identity('same'), async () => {
    calls += 1;
    throw new Error('native load failed');
  });
  await assert.rejects(failed.promise, /native load failed/);

  const retry = flight.run(identity('same'), async () => ++calls);
  assert.equal(retry.coalesced, false);
  assert.equal(await retry.promise, 2);
});

test('a different identity replaces active state without stale settlement erasing it', async () => {
  const { createCastLoadSingleFlight } = await loadHelper();
  const flight = createCastLoadSingleFlight();
  const firstPending = deferred();
  const secondPending = deferred();
  const first = flight.run(identity('first'), () => firstPending.promise);
  const second = flight.run(identity('second'), () => secondPending.promise);
  const repeatSecond = flight.run(identity('second'), () => Promise.resolve('unexpected'));

  assert.equal(second.coalesced, false);
  assert.equal(repeatSecond.coalesced, true);
  assert.equal(repeatSecond.promise, second.promise);
  firstPending.resolve('first result');
  await first.promise;
  const stillSecond = flight.run(identity('second'), () => Promise.resolve('unexpected'));
  assert.equal(stillSecond.coalesced, true);
  assert.equal(stillSecond.promise, second.promise);
  secondPending.resolve('second result');
  assert.equal(await second.promise, 'second result');
});

test('a stale rejection from a replaced load does not erase the active replacement', async () => {
  const { createCastLoadSingleFlight } = await loadHelper();
  const flight = createCastLoadSingleFlight();
  const firstPending = deferred();
  const secondPending = deferred();
  const first = flight.run(identity('first'), () => firstPending.promise);
  const second = flight.run(identity('second'), () => secondPending.promise);

  firstPending.reject(new Error('first load failed late'));
  await assert.rejects(first.promise, /first load failed late/);
  const repeatedSecond = flight.run(identity('second'), () => Promise.resolve('unexpected'));
  assert.equal(repeatedSecond.coalesced, true);
  assert.equal(repeatedSecond.promise, second.promise);

  secondPending.resolve('second result');
  assert.equal(await second.promise, 'second result');
});

test('exact identity deterministically normalizes headers but preserves source, track, and native metadata differences', async () => {
  const { createCastLoadIdentity } = await loadHelper();
  const normalized = createCastLoadIdentity(baseSource, {
    title: 'Film',
    poster: 'https://images.example/poster.jpg',
  });
  const reordered = createCastLoadIdentity({
    ...baseSource,
    headers: { accept: 'application/m3u8', referer: 'https://player.example/' },
  }, {
    title: 'Film',
    poster: 'https://images.example/poster.jpg',
  });
  assert.equal(normalized.exact, reordered.exact);
  assert.equal(
    normalized.exact,
    createCastLoadIdentity(baseSource, {
      title: 'Film',
      poster: 'https://images.example/poster.jpg',
      currentTime: 91,
    }).exact,
    'start time remains outside the identity API',
  );

  const variants = [
    [{ ...baseSource, url: 'https://cdn.example/other.m3u8' }, { title: 'Film', poster: 'https://images.example/poster.jpg' }],
    [{ ...baseSource, contentType: 'video/mp4' }, { title: 'Film', poster: 'https://images.example/poster.jpg' }],
    [{ ...baseSource, headers: { Referer: 'https://other.example/' } }, { title: 'Film', poster: 'https://images.example/poster.jpg' }],
    [{ ...baseSource, tracks: [{ ...baseSource.tracks[0], name: 'English' }] }, { title: 'Film', poster: 'https://images.example/poster.jpg' }],
    [{
      ...baseSource,
      tracks: [
        ...baseSource.tracks,
        {
          ...baseSource.tracks[0],
          url: 'https://cdn.example/en.vtt',
          language: 'en',
          name: 'English',
        },
      ].reverse(),
    }, { title: 'Film', poster: 'https://images.example/poster.jpg' }],
    [baseSource, { title: 'Other film', poster: 'https://images.example/poster.jpg' }],
    [baseSource, { title: 'Film', poster: 'https://images.example/other.jpg' }],
  ];
  for (const [source, metadata] of variants) {
    assert.notEqual(normalized.exact, createCastLoadIdentity(source, metadata).exact);
  }
});

test('logical identity ignores resolved URLs, headers, and start time', async () => {
  const { createCastLoadIdentity } = await loadHelper();
  const initial = createCastLoadIdentity(baseSource, {
    title: 'Film',
    poster: 'https://images.example/poster.jpg',
    currentTime: 12,
  });
  const resolvedVariant = createCastLoadIdentity({
    ...baseSource,
    url: 'https://relay.example/stream/final.m3u8',
    headers: { Authorization: 'Bearer other-token' },
    tracks: [{
      ...baseSource.tracks[0],
      url: 'https://relay.example/track/fr.vtt',
      headers: { Cookie: 'session=other' },
    }],
  }, {
    title: 'Film',
    poster: 'https://images.example/poster.jpg',
    currentTime: 98,
  });

  assert.notEqual(initial.exact, resolvedVariant.exact);
  assert.equal(initial.logical, resolvedVariant.logical);
});

test('logical identity changes with presentation metadata and track order', async () => {
  const { createCastLoadIdentity } = await loadHelper();
  const original = createCastLoadIdentity(baseSource, {
    title: 'Film',
    poster: 'https://images.example/poster.jpg',
  });
  const variants = [
    [{ ...baseSource }, { title: 'Other film', poster: 'https://images.example/poster.jpg' }],
    [{ ...baseSource }, { title: 'Film', poster: 'https://images.example/other.jpg' }],
    [{ ...baseSource, contentType: 'video/mp4' }, { title: 'Film', poster: 'https://images.example/poster.jpg' }],
    [{ ...baseSource, tracks: [{ ...baseSource.tracks[0], contentType: 'application/ttml+xml' }] }, { title: 'Film', poster: 'https://images.example/poster.jpg' }],
    [{ ...baseSource, tracks: [{ ...baseSource.tracks[0], language: 'en' }] }, { title: 'Film', poster: 'https://images.example/poster.jpg' }],
    [{ ...baseSource, tracks: [{ ...baseSource.tracks[0], name: 'English' }] }, { title: 'Film', poster: 'https://images.example/poster.jpg' }],
    [{ ...baseSource, tracks: [{ ...baseSource.tracks[0], active: false }] }, { title: 'Film', poster: 'https://images.example/poster.jpg' }],
  ];
  for (const [source, metadata] of variants) {
    assert.notEqual(original.logical, createCastLoadIdentity(source, metadata).logical);
  }

  const twoTracks = {
    ...baseSource,
    tracks: [
      baseSource.tracks[0],
      { ...baseSource.tracks[0], language: 'en', name: 'English' },
    ],
  };
  const ordered = createCastLoadIdentity(twoTracks, {
    title: 'Film',
    poster: 'https://images.example/poster.jpg',
  });
  const reversed = createCastLoadIdentity({
    ...twoTracks,
    tracks: [...twoTracks.tracks].reverse(),
  }, {
    title: 'Film',
    poster: 'https://images.example/poster.jpg',
  });
  assert.notEqual(ordered.logical, reversed.logical);
});

test('different exact loads with the same logical media are not coalesced while pending', async () => {
  const { createCastLoadIdentity, createCastLoadSingleFlight } = await loadHelper();
  const flight = createCastLoadSingleFlight();
  const firstPending = deferred();
  const secondPending = deferred();
  const firstIdentity = createCastLoadIdentity(baseSource, { title: 'Film' });
  const secondIdentity = createCastLoadIdentity({ ...baseSource, url: 'https://cdn.example/final.m3u8' }, { title: 'Film' });
  const first = flight.run(firstIdentity, () => firstPending.promise);
  const second = flight.run(secondIdentity, () => secondPending.promise);

  assert.equal(second.coalesced, false);
  firstPending.resolve('first');
  secondPending.resolve('second');
  assert.equal(await first.promise, 'first');
  assert.equal(await second.promise, 'second');
});

test('successful different exact loads with the same logical media coalesce for two seconds', async () => {
  const { createCastLoadIdentity, createCastLoadSingleFlight } = await loadHelper();
  let now = 10_000;
  const flight = createCastLoadSingleFlight({ clock: () => now });
  const firstIdentity = createCastLoadIdentity(baseSource, { title: 'Film' });
  const resolvedIdentity = createCastLoadIdentity({ ...baseSource, url: 'https://cdn.example/final.m3u8' }, { title: 'Film' });
  let calls = 0;
  const first = flight.run(firstIdentity, async () => ++calls);
  assert.equal(await first.promise, 1);

  now += 2_000;
  const coalesced = flight.run(resolvedIdentity, async () => ++calls);
  assert.equal(coalesced.coalesced, true);
  assert.equal(coalesced.promise, first.promise);

  now += 1;
  const expired = flight.run(resolvedIdentity, async () => ++calls);
  assert.equal(expired.coalesced, false);
  assert.equal(await expired.promise, 2);
});

test('different logical media are not coalesced after a successful load', async () => {
  const { createCastLoadIdentity, createCastLoadSingleFlight } = await loadHelper();
  const flight = createCastLoadSingleFlight();
  const first = flight.run(createCastLoadIdentity(baseSource, { title: 'Film' }), async () => 'first');
  await first.promise;
  const different = flight.run(createCastLoadIdentity({ ...baseSource, url: 'https://cdn.example/final.m3u8' }, { title: 'Other film' }), async () => 'second');
  assert.equal(different.coalesced, false);
  assert.equal(await different.promise, 'second');
});
