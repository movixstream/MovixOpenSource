const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const { createStreamedTransport, createStreamedNativeService } = require('../streamedNative');

const embedUrl = 'https://embed.st/embed/admin/match/1';
const referer = 'https://embed.st/';
const publicAddress = { address: '93.184.216.34', family: 4 };
const proxies = [
  { host: '192.0.2.1', port: 1080, type: 'socks5', auth: 'user:secret:"\\end' },
  { host: '192.0.2.2', port: 1080, type: 'socks5', auth: 'user:other-secret' },
];
const curlResponse = (body, status = 200, redirect = '') => ({ stdout: Buffer.concat([
  Buffer.from(body), Buffer.from(`\nMOVIX_STATUS:${status}\nMOVIX_REDIRECT:${redirect}`),
]) });

function fixture(overrides = {}) {
  const calls = { selections: 0, dns: [], curl: [], requests: [], agents: [] };
  class FakeAgent {
    constructor(url) { this.url = url; this.destroyed = false; calls.agents.push(this); }
    destroy() { this.destroyed = true; }
  }
  const transport = createStreamedTransport({
    pickProxy: async () => proxies[calls.selections++ % proxies.length],
    lookupImpl: async host => { calls.dns.push(host); return [publicAddress]; },
    AgentClass: FakeAgent,
    requestImpl: (url, options, receive) => {
      const req = new EventEmitter();
      req.end = body => {
        calls.requests.push({ url, options, body });
        const response = Readable.from([Buffer.from([10, 3, 120, 121, 122])]);
        response.statusCode = 200;
        response.headers = { goat: 'NOSCRPS123456789012345678901234567' };
        receive(response);
      };
      return req;
    },
    execImpl: async (args, options, config) => {
      calls.curl.push({ args, options, config });
      return curlResponse(args.at(-1).endsWith('.png') ? Buffer.from([0x47, 1, 2]) : '#EXTM3U\nsegment.png\n');
    },
    ...overrides,
  });
  return { transport, calls };
}

test('extraction, playlists et segments choisissent chacun le proxy suivant sans transmettre ses identifiants au CDN', async () => {
  const { transport, calls } = fixture();
  const service = createStreamedNativeService({
    pull: transport.pull, fetchImpl: transport.fetch,
    unlock: async () => 'https://lb1.strmd.st/live.m3u8',
  });
  const stream = await service.resolve(embedUrl);
  assert.deepEqual(stream, { url: 'https://lb1.strmd.st/live.m3u8', referer });
  const post = calls.requests[0];
  assert.equal(post.options.agent.url.hostname, proxies[0].host);
  assert.equal(post.options.headers.Referer, embedUrl);
  assert.equal(post.options.headers['Proxy-Authorization'], undefined);
  assert.equal(post.body.toString('hex'), '0a0561646d696e12056d617463681a0131');
  assert.ok(post.options.signal instanceof AbortSignal);
  assert.equal(calls.agents[0].destroyed, true);
  post.options.lookup('embed.st', {}, (error, address, family) => {
    assert.equal(error, null); assert.equal(address, publicAddress.address); assert.equal(family, 4);
  });

  await service.pull(stream.url, referer);
  await service.pull('https://lb1.strmd.st/high/mono.m3u8', referer);
  await service.pull('https://p16-common-sign.tiktokcdn-eu.com/segment.png', referer);
  assert.equal(calls.selections, 4);
  assert.match(calls.curl[0].config, /socks5:\/\/192\.0\.2\.2:1080/);
  assert.match(calls.curl[1].config, /socks5:\/\/192\.0\.2\.1:1080/);
  assert.match(calls.curl[2].config, /socks5:\/\/192\.0\.2\.2:1080/);
  assert.ok(calls.curl[1].config.includes('proxy-user = "user:secret:\\"\\\\end"'));
  for (const call of calls.curl) {
    assert.equal(call.args[0], '--disable');
    assert.equal(call.args[call.args.indexOf('--config') + 1], '-');
    assert.equal(call.args[call.args.indexOf('--noproxy') + 1], '');
    assert.match(call.args[call.args.indexOf('--resolve') + 1], /:443:93\.184\.216\.34$/);
    assert.doesNotMatch(call.args.join(' '), /secret|proxy-user|socks5h/);
  }
});

test('les destinations Golf décodées avec atob passent aussi par la validation du transport', async () => {
  for (const target of ['https://127.0.0.1/private',
    'http://embed.st/embed/ingest/match/1', 'https://user@embed.st/embed/ingest/match/1', 'javascript:alert(1)']) {
    let pages = 0;
    const { transport, calls } = fixture({ execImpl: async () => {
      pages++;
      return curlResponse(`<script>f . src = atob ( '${Buffer.from(target).toString('base64')}' );</script>`);
    } });
    const service = createStreamedNativeService({ pull: transport.pull, fetchImpl: transport.fetch });
    await assert.rejects(service.resolve('https://embed.st/embed/golf/1485/1'), /URL Streamed invalide/);
    assert.equal(pages, 1);
    assert.equal(calls.selections, 1);
    assert.equal(calls.requests.length, 0);
  }
});

test('Golf suit le relais rockylive.st jusqu’au lecteur ingest', async () => {
  const ingest = 'https://embed.st/embed/ingest/streamedevent5/1';
  const pages = [];
  const { transport, calls } = fixture({ execImpl: async args => {
    const url = args.at(-1); pages.push(url);
    if (url.includes('/embed/golf/')) return curlResponse('<iframe src="https://rockylive.st/source/streamed1.php?hd=115&id=1863&no=1" frameborder="0"></iframe>');
    return curlResponse(`<script>playerFrame.src = atob("${Buffer.from(ingest).toString('base64')}");</script>`);
  } });
  const service = createStreamedNativeService({
    pull: transport.pull, fetchImpl: transport.fetch,
    unlock: async slot => { assert.equal(slot.path, 'ingest/streamedevent5/1'); return 'https://lb1.strmd.st/live.m3u8'; },
  });
  assert.deepEqual(await service.resolve('https://embed.st/embed/golf/1863/1'), { url: 'https://lb1.strmd.st/live.m3u8', referer });
  assert.deepEqual(pages, ['https://embed.st/embed/golf/1863/1', 'https://rockylive.st/source/streamed1.php?hd=115&id=1863&no=1']);
  assert.equal(calls.requests[0].options.headers.Referer, ingest);
});

test('une rafale identique partage une seule requête SOCKS5, le chargement suivant tourne encore', async () => {
  const { transport, calls } = fixture();
  const service = createStreamedNativeService({ pull: transport.pull });
  await Promise.all(Array.from({ length: 20 }, () => service.pull('https://lb1.strmd.st/live.m3u8', referer)));
  assert.equal(calls.selections, 1);
  assert.equal(calls.curl.length, 1);
  await service.pull('https://lb1.strmd.st/live.m3u8', referer);
  assert.equal(calls.selections, 2);
});

test('aucune sortie directe si le pool est vide et aucune sélection avant validation de la destination', async () => {
  const empty = fixture({ pickProxy: async () => null });
  await assert.rejects(empty.transport.pull('https://lb1.strmd.st/live.m3u8', referer), /SOCKS5 Streamed indisponible/);
  await assert.rejects(empty.transport.fetch('https://embed.st/fetch', { method: 'POST' }), /SOCKS5 Streamed indisponible/);
  assert.equal(empty.calls.curl.length, 0);
  assert.equal(empty.calls.agents.length, 0);
  const blocked = fixture({ lookupImpl: async () => [publicAddress, { address: '127.0.0.1', family: 4 }] });
  await assert.rejects(blocked.transport.pull('https://lb1.strmd.st/live.m3u8', referer), /non publique/);
  await assert.rejects(blocked.transport.fetch('https://embed.st/fetch', { method: 'POST' }), /non publique/);
  await assert.rejects(blocked.transport.fetch('https://unknown.test/fetch', { method: 'POST' }), /Lecteur Streamed invalide/);
  assert.equal(blocked.calls.selections, 0);
});

test('les redirections repassent par validation DNS et rotation, sans suivre une cible privée', async () => {
  let requests = 0;
  const f = fixture({
    lookupImpl: async host => [{ address: host === 'private.strmd.st' ? '10.0.0.1' : publicAddress.address, family: 4 }],
    execImpl: async () => {
      requests++;
      return requests === 1
        ? curlResponse('', 302, 'https://lb2.strmd.st/live.m3u8')
        : curlResponse('', 302, 'https://private.strmd.st/live.m3u8');
    },
  });
  await assert.rejects(f.transport.pull('https://lb1.strmd.st/live.m3u8', referer), /non publique/);
  assert.equal(requests, 2);
  assert.equal(f.calls.selections, 2);
});

test('le POST binaire borne la réponse, ne suit pas les redirections et ferme son agent après un échec', async () => {
  for (const status of [302, 403, 200]) {
    const f = fixture({ requestImpl: (_url, _options, receive) => {
      const req = new EventEmitter();
      req.end = () => {
        const response = Readable.from([Buffer.alloc(16001)]);
        response.statusCode = status; response.headers = {};
        receive(response);
      };
      return req;
    } });
    await assert.rejects(f.transport.fetch('https://embed.st/fetch', { method: 'POST' }),
      status === 200 ? /Réponse Streamed invalide/ : new RegExp(`Streamed HTTP ${status}`));
    assert.equal(f.calls.selections, 1);
    assert.equal(f.calls.agents[0].destroyed, true);
  }
});

test('une configuration proxy contenant une nouvelle ligne ne peut injecter une option curl', async () => {
  const f = fixture({ pickProxy: async () => ({ ...proxies[0], auth: 'user:password\nurl=https://private.test' }) });
  await assert.rejects(f.transport.pull('https://lb1.strmd.st/live.m3u8', referer), /Proxy SOCKS5 Streamed invalide/);
  assert.equal(f.calls.curl.length, 0);
});

test('une coupure ou annulation du POST ferme son agent sans nouvelle tentative directe', async () => {
  for (const code of ['ABORT_ERR', 'ECONNRESET']) {
    const f = fixture({ requestImpl: () => {
      const req = new EventEmitter();
      req.end = () => queueMicrotask(() => req.emit('error', Object.assign(new Error('transport'), { code })));
      return req;
    } });
    await assert.rejects(f.transport.fetch('https://embed.st/fetch', { method: 'POST' }), { code });
    assert.equal(f.calls.selections, 1);
    assert.equal(f.calls.agents[0].destroyed, true);
    assert.equal(f.calls.curl.length, 0);
  }
});
