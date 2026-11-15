const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createSourceCircuitBreaker, isSourceDownStatus } = require('../sourceCircuitBreaker');

const httpProxy = { host: 'http-proxy.test', port: 8080, auth: 'user:secret' };
const socksProxy = { host: 'socks-proxy.test', port: 1080, auth: 'user:secret' };

function fixture({ dedicated = [], shared = [httpProxy], transport }) {
  const filename = path.resolve(__dirname, '../proxyManager.js');
  const source = fs.readFileSync(filename, 'utf8');
  const start = source.indexOf('async function makeCpasmalRequest(');
  const end = source.indexOf('// Fonction AnimeSama', start);
  const calls = [];
  const context = {
    URL,
    cpasmalProxyCooldowns: new Map(),
    cpasmalCircuit: createSourceCircuitBreaker({
      name: 'Cpasmal', neutralCodes: ['CPASMAL_PROXY_COOLDOWN'], logger: { log() {}, warn() {} },
    }),
    isSourceDownStatus,
    CHROME_JA3: 'fixture', CHROME_UA: 'fixture',
    MAX_PROXYSCRAPE_PROXY_ATTEMPTS: 2,
    DEDICATED_SOCKS5_PROXIES: dedicated,
    pickProxyscrapeCandidates: () => ({ proxies: typeof shared === 'function' ? shared() : shared, useSocks: false }),
    getCycleTLS: async () => async (url, options, method) => {
      calls.push({ url, options, method });
      return transport(url, options, method);
    },
  };
  vm.runInNewContext(source.slice(start, end) + '\nthis.request = makeCpasmalRequest;', context, { filename });
  return { request: context.request, calls };
}

test('Cpasmal utilise les SOCKS5 dédiés lorsque les proxys HTTP sont bloqués', async () => {
  const f = fixture({ dedicated: [socksProxy], transport: async (_url, options) =>
    options.proxy.startsWith('socks5h:')
      ? { status: 200, body: '<div>Chicago Fire</div>' }
      : { status: 403, body: 'Cloudflare blocked' },
  });
  const result = await f.request('https://cpasmal.test/index.php', { method: 'post', body: 'story=Chicago+Fire' });
  assert.equal(result.status, 200);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].method, 'post');
  assert.equal(f.calls[0].options.body, 'story=Chicago+Fire');
});

test('un SOCKS5 refusé sans HTML Cloudflare permet le repli HTTP et conserve la redirection du lecteur', async () => {
  const f = fixture({ dedicated: [socksProxy], transport: async (_url, options) =>
    options.proxy.startsWith('socks5h:')
      ? { status: 403, body: 'Forbidden' }
      : { status: 302, body: '', headers: { Location: 'https://player.test/embed/episode' } },
  });
  const result = await f.request('https://cpasmal.test/episode/136435/voe_vf', { disableRedirect: true });
  assert.equal(result.status, 302);
  assert.equal(result.headers.Location, 'https://player.test/embed/episode');
  assert.deepEqual(f.calls.map(call => new URL(call.options.proxy).protocol), ['socks5h:', 'http:']);
  assert.ok(f.calls.every(call => call.options.disableRedirect === true));
});

test('la rotation sur un 403 sans signature Cloudflare conserve un diagnostic sans secrets', async () => {
  const backup = { host: 'backup.test', port: 8080, auth: 'other:hidden' };
  const f = fixture({ shared: [httpProxy, backup], transport: async () => ({ status: 403, body: 'Forbidden' }) });
  const result = await f.request('https://cpasmal.test/index.php?token=private-page-token');
  assert.equal(f.calls.length, 2);
  assert.equal(result.status, 403);
  assert.equal(result.cpasmalProxy, 'http://backup.test:8080');
  assert.equal(result.cpasmalUrl, 'https://cpasmal.test/index.php');
  assert.doesNotMatch(JSON.stringify(result), /secret|hidden|private-page-token/);
});

test('trois refus 403 d’affilée mettent Cpasmal en pause sans nouvel appel CycleTLS', async () => {
  let next = 0;
  const f = fixture({
    shared: () => [{ host: `proxy-${next++}.test`, port: 8080 }],
    transport: async () => ({ status: 403, body: 'Forbidden' }),
  });
  for (let i = 0; i < 3; i++) assert.equal((await f.request('https://cpasmal.test/index.php')).status, 403);
  assert.equal(f.calls.length, 3);
  await assert.rejects(f.request('https://cpasmal.test/index.php'), { code: 'SOURCE_CIRCUIT_OPEN' });
  assert.equal(f.calls.length, 3);
});

test('une page Cpasmal servie remet le compteur de refus à zéro', async () => {
  let next = 0;
  const statuses = [403, 403, 200, 403, 403];
  const f = fixture({
    shared: () => [{ host: `proxy-${next++}.test`, port: 8080 }],
    transport: async () => ({ status: statuses.shift(), body: '<html></html>' }),
  });
  for (let i = 0; i < 5; i++) await f.request('https://cpasmal.test/index.php');
  assert.equal(f.calls.length, 5);
});

test('sans proxy configuré, Cpasmal garde un seul essai direct et identifie ce chemin', async () => {
  const f = fixture({ shared: [], transport: async () => ({ status: 403, body: 'Forbidden' }) });
  const result = await f.request('https://cpasmal.test/index.php');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].options.proxy, undefined);
  assert.equal(result.cpasmalProxy, 'direct');
  assert.equal(result.cpasmalUrl, 'https://cpasmal.test/index.php');
});
