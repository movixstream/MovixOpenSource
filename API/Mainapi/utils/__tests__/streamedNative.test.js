const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { parseStreamedEmbed, encodeStreamedRequest, mediaUrl, unwrapStreamedSegment, rewriteStreamedPlaylist,
  selectStreamedVariant, createStreamedNativeService, createStreamedWorkerDecoder } = require('../streamedNative');

test('la playlist maître ne permet plus le passage entre variantes aux horloges indépendantes', () => {
  const sd = '#EXT-X-STREAM-INF:BANDWIDTH=700000,RESOLUTION=960x540,NAME="540p"\nlow/mono.m3u8\n';
  const hd = '#EXT-X-STREAM-INF:RESOLUTION=1920x1080,BANDWIDTH=8000000,CODECS="avc1.640028,mp4a.40.2"\nhigh/mono.m3u8\n';
  const header = '#EXTM3U\n#EXT-X-INDEPENDENT-SEGMENTS\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",URI="audio.m3u8"\n';
  for (const variants of [sd + hd, hd + sd]) {
    const master = header + variants;
    assert.equal(selectStreamedVariant(master), header + hd);
    const urls = [];
    const rewritten = rewriteStreamedPlaylist(master, 'https://lb1.strmd.st/live/master.m3u8', url => {
      urls.push(url); return `signed:${urls.length}`;
    });
    assert.equal((rewritten.match(/#EXT-X-STREAM-INF:/g) || []).length, 1);
    assert.deepEqual(urls, ['https://lb1.strmd.st/live/audio.m3u8', 'https://lb1.strmd.st/live/high/mono.m3u8']);
  }
});

test('la sélection préserve les playlists média, les clés et les discontinuités', () => {
  for (const playlist of [
    '#EXTM3U\r\n#EXT-X-TARGETDURATION:6\r\n#EXT-X-MEDIA-SEQUENCE:25056\r\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\r\n#EXTINF:6,\r\na.ts\r\n#EXT-X-DISCONTINUITY\r\n#EXTINF:6,\r\nb.ts\r\n',
    '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=8000000\nhigh.m3u8\n',
  ]) assert.equal(selectStreamedVariant(playlist), playlist);
  const master = '#EXTM3U\r\n#EXT-X-STREAM-INF:BANDWIDTH=700000\r\nlow.m3u8\r\n#EXT-X-STREAM-INF:BANDWIDTH=8000000\r\n\r\n# Commentaire\r\nhigh.m3u8\r\n';
  assert.equal(selectStreamedVariant(master), '#EXTM3U\r\n#EXT-X-STREAM-INF:BANDWIDTH=8000000\r\n\r\n# Commentaire\r\nhigh.m3u8\r\n');
});

test('le protocole ne peut cibler que les lecteurs embed.st et encode les champs longs', () => {
  const slot = parseStreamedEmbed('https://embed.st/embed/admin/match-one/2');
  assert.equal(slot.source, 'admin');
  assert.equal(slot.id, 'match-one');
  assert.equal(slot.stream, '2');
  assert.equal(encodeStreamedRequest(slot).toString('hex'), '0a0561646d696e12096d617463682d6f6e651a0132');
  for (const url of ['http://embed.st/embed/a/b/1', 'https://embed.st.evil.test/embed/a/b/1',
    'https://user@embed.st/embed/a/b/1', 'https://embed.st:123/embed/a/b/1', 'https://embed.st/embed/a/../1']) {
    assert.throws(() => parseStreamedEmbed(url));
  }
});

test('les playlists réécrivent variantes, segments et URI ; seules les enveloppes PNG reconnues sont retirées', () => {
  const ts = Buffer.alloc(376); ts[0] = ts[188] = 0x47;
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('IEND0000'), ts]);
  assert.deepEqual(unwrapStreamedSegment(png), ts);
  const webp = Buffer.alloc(42 + ts.length); webp.write('RIFF'); webp.write('WEBP', 8); ts.copy(webp, 42);
  assert.deepEqual(unwrapStreamedSegment(webp), ts);
  const mp4 = Buffer.from('....ftyp....');
  assert.equal(unwrapStreamedSegment(mp4), mp4);
  const targets = [];
  const result = rewriteStreamedPlaylist('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n../stream.m3u8\n',
    'https://cdn.strmd.st/path/master.m3u8', target => { targets.push(target); return `signed:${targets.length}`; });
  assert.match(result, /URI="signed:1"/);
  assert.match(result, /signed:2/);
  assert.deepEqual(targets, ['https://cdn.strmd.st/path/key.bin', 'https://cdn.strmd.st/stream.m3u8']);
});

test('tout CDN https public est accepté, sans liste de domaines', () => {
  for (const url of ['https://p16-common-sign.tiktokcdn-eu.com/segment.png?signature=fixture',
    'https://cdn.new-host.example/live.m3u8']) assert.equal(mediaUrl(url), url);
  for (const blocked of ['https://127.0.0.1/segment.png', 'https://user@cdn.strmd.st/segment.png',
    'http://p16-common-sign.tiktokcdn-eu.com/segment.png']) {
    assert.throws(() => mediaUrl(blocked));
  }
});

test('décryptage borné et partagé ; aucune URL locale ou réponse malformée n’est acceptée', async () => {
  let calls = 0;
  const service = createStreamedNativeService({ unlock: async () => {
    calls++; return 'https://lb1.strmd.st/live.m3u8';
  } });
  const input = { embedUrl: 'https://embed.st/embed/admin/fixture/1', goat: 'NOSCRPS123456789012345678901234567', body: 'CgN4eXo=' };
  const results = await Promise.all(Array.from({ length: 20 }, () => service.decode(input)));
  assert.ok(results.every(r => r.url === 'https://lb1.strmd.st/live.m3u8'));
  assert.equal(calls, 1);
  await assert.rejects(service.decode({ ...input, body: '!' }));
  const blocked = createStreamedNativeService({ unlock: async () => 'https://127.0.0.1/private.m3u8' });
  await assert.rejects(blocked.decode(input));
});

test('une saturation publique ne consomme pas les deux places de décodage VIP', async () => {
  const workers = [];
  class FakeWorker extends EventEmitter {
    constructor() { super(); workers.push(this); }
    async terminate() {}
  }
  const decode = createStreamedWorkerDecoder({ WorkerClass: FakeWorker });
  const publicJob = decode({}, 'goat', Buffer.from([10]));
  await assert.rejects(decode({}, 'goat', Buffer.from([10])), /occupé/);
  const vipOne = decode({}, 'goat', Buffer.from([10]), 'vip');
  const vipTwo = decode({}, 'goat', Buffer.from([10]), 'vip');
  assert.equal(workers.length, 3);
  await assert.rejects(decode({}, 'goat', Buffer.from([10]), 'vip'), /occupé/);
  workers.forEach(worker => worker.emit('message', { ok: true, url: 'https://lb1.strmd.st/live.m3u8' }));
  await Promise.all([publicJob, vipOne, vipTwo]);
});

test('Golf : ancien lecteur fid, data-source et iframe créée par atob vers ingest', async () => {
  for (const format of ['legacy', 'data-source', 'script']) {
    const legacy = format === 'legacy';
    const embedUrl = `https://embed.st/embed/ingest/${format === 'script' ? 'nrealmadrid' : 'fixture'}/1`;
    const html = legacy ? 'fid="channel-key";' : format === 'script'
      ? readFileSync(resolve(__dirname, '../../../../tests/fixtures/streamed-golf-script.html'), 'utf8')
      : `<iframe data-source="${Buffer.from(embedUrl).toString('base64')}"></iframe>`;
    const requests = [];
    const service = createStreamedNativeService({
      pull: async (url, referer) => {
        requests.push(url);
        if (url.includes('/embed/golf/')) return { url, body: Buffer.from('<iframe src="https://rockystream.st/watch"></iframe>') };
        if (url.includes('rockystream.st')) {
          assert.equal(referer, 'https://embed.st/embed/golf/1485/1');
          return { url, body: Buffer.from(html) };
        }
        assert.ok(legacy && url.startsWith('https://exposestrat.com/maestrohd1.php?'));
        return { url, body: Buffer.from('return(["https://cdn.zohanayaan.com/","live.m3u8"].join(""));') };
      },
      fetchImpl: async (url, options) => {
        requests.push(url);
        assert.equal(legacy, false);
        assert.equal(url, 'https://embed.st/fetch');
        assert.equal(options.headers.Referer, embedUrl);
        assert.deepEqual(options.body, encodeStreamedRequest(parseStreamedEmbed(embedUrl)));
        return new Response(Buffer.from([10, 3, 120, 121, 122]), { headers: { goat: 'NOSCRPS123456789012345678901234567' } });
      },
      unlock: async (slot, _goat, _body, pool) => { assert.deepEqual(slot, parseStreamedEmbed(embedUrl)); assert.equal(pool, 'vip'); return 'https://lb1.strmd.st/live.m3u8'; },
    });
    const result = await service.resolve('https://embed.st/embed/golf/1485/1');
    assert.equal(result.referer, legacy ? 'https://exposestrat.com/' : 'https://embed.st/');
    assert.equal(requests.length, 3);
  }
});
