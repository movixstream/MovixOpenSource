'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createCoflixProxyPolicy } = require('../coflixProxyPolicy');
const { createSourceCircuitBreaker } = require('../sourceCircuitBreaker');

// Exécute le vrai makeCoflixRequest avec un faux CycleTLS (url, options, method) -> {status, body}.
function fixture(cycleTLS, policyOptions, proxies = [{ host: 'proxy.test', port: 8080 }, { host: 'backup.test', port: 8080 }]) {
  const filename = path.resolve(__dirname, '../proxyManager.js');
  const code = fs.readFileSync(filename, 'utf8');
  const start = code.indexOf('async function makeCoflixRequest(');
  const end = code.indexOf('// Fonction pour faire une requete LecteurVideo', start);
  assert.ok(start > 0 && end > start);
  const context = vm.createContext({
    coflixCircuit: createSourceCircuitBreaker({
      name: 'Coflix', neutralCodes: ['COFLIX_PROXIES_UNAVAILABLE'], logger: { log() {}, warn() {} },
    }),
    coflixProxyPolicy: createCoflixProxyPolicy(policyOptions),
    pickProxyscrapeCandidates: (available = () => true) => ({ proxies: proxies.filter(proxy => available(proxy, false)), useSocks: false, totalAvailable: proxies.length }),
    getCycleTLS: async () => cycleTLS,
    CHROME_JA3: 'ja3-test',
    CHROME_UA: 'ua-test',
  });
  vm.runInContext(code.slice(start, end) + '\nglobalThis.request = makeCoflixRequest;', context, { filename });
  return { request: context.request };
}

test('passe par CycleTLS avec le JA3 Chrome, le proxy et un timeout en secondes', async () => {
  const calls = [];
  const f = fixture(async (url, options, method) => {
    calls.push({ url, options, method });
    return { status: 200, body: '<html>ok</html>' };
  });
  const response = await f.request(' https://coflix.example/?s=x ', {
    timeout: 7000,
    headers: { 'User-Agent': 'autre', Referer: 'https://coflix.example', 'X-Forwarded-For': '1.2.3.4' },
  });
  assert.equal(response.data, '<html>ok</html>');
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  const [{ url, options, method }] = calls;
  assert.equal(url, 'https://coflix.example/?s=x');
  assert.equal(method, 'get');
  assert.equal(options.ja3, 'ja3-test');
  assert.equal(options.userAgent, 'ua-test');
  assert.equal(options.proxy, 'http://proxy.test:8080');
  assert.equal(options.timeout, 7);
  assert.equal(options.headers.Referer, 'https://coflix.example');
  assert.equal(options.headers['User-Agent'], undefined);
  assert.equal(options.headers['X-Forwarded-For'], undefined);
});

test('la rotation sur HTTP 429 reste active', async () => {
  const used = [];
  const f = fixture(async (url, options) => {
    used.push(options.proxy);
    return used.length === 1 ? { status: 429, body: 'limited' } : { status: 200, body: 'OK' };
  });
  assert.equal((await f.request('https://coflix.example/')).data, 'OK');
  assert.deepEqual(used, ['http://proxy.test:8080', 'http://backup.test:8080']);
});

test('un 404 lève une erreur façon Axios sans essayer un autre proxy', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return { status: 404, body: 'absent' }; });
  await assert.rejects(f.request('https://coflix.example/x'), error =>
    error.response.status === 404 && error.response.data === 'absent' && error.coflixProxy === 'proxy.test:8080');
  assert.equal(calls, 1);
});

test('le dernier proxy bloqué transmet son erreur 403 à l’appelant', async () => {
  const f = fixture(async (url, options) => ({ status: 403, body: options.proxy }));
  await assert.rejects(f.request('https://coflix.example/'), error =>
    error.response.status === 403 && error.response.data === 'http://backup.test:8080');
});

test('un délai CycleTLS (408 synthétique) met le proxy en quarantaine puis il redevient éligible', async () => {
  let now = 0;
  const used = [];
  const f = fixture(async (url, options) => {
    used.push(options.proxy);
    return used.length === 1 ? { status: 408, body: 'timeout' } : { status: 200, body: 'OK' };
  }, { now: () => now, cooldownMs: 30000 });
  await f.request('https://coflix.example/?s=serie');
  await f.request('https://coflix.example/?s=autre');
  now = 30001;
  await f.request('https://coflix.example/?s=encore');
  assert.deepEqual(used, ['http://proxy.test:8080', 'http://backup.test:8080',
    'http://backup.test:8080', 'http://proxy.test:8080']);
});

test('la quarantaine de tout le pool ne provoque aucun accès direct au site', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return { status: 403, body: 'blocked' }; });
  await assert.rejects(f.request('https://coflix.example/'));
  await assert.rejects(f.request('https://coflix.example/'), { code: 'COFLIX_PROXIES_UNAVAILABLE' });
  assert.equal(calls, 2);
});

test('trois délais Coflix d’affilée mettent la source en pause sans nouvel appel CycleTLS', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return { status: 408, body: 'timeout' }; }, { cooldownMs: 0 });
  for (let i = 0; i < 3; i++) {
    await assert.rejects(f.request('https://coflix.example/?s=x'), { code: 'ETIMEDOUT' });
  }
  assert.equal(calls, 6);
  await assert.rejects(f.request('https://coflix.example/?s=y'), error =>
    error.code === 'SOURCE_CIRCUIT_OPEN' && error.isSourceCircuitOpen === true);
  assert.equal(calls, 6);
});

test('des 404 Coflix ne mettent pas la source en pause', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return { status: 404, body: 'absent' }; });
  for (let i = 0; i < 4; i++) {
    await assert.rejects(f.request('https://coflix.example/x'), error => error.response.status === 404);
  }
  assert.equal(calls, 4);
});

test('sans pool de proxys, une seule tentative directe via CycleTLS', async () => {
  const calls = [];
  const f = fixture(async (url, options) => { calls.push(options); return { status: 200, body: 'direct' }; }, undefined, []);
  assert.equal((await f.request('https://coflix.example/')).data, 'direct');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].proxy, undefined);
});
