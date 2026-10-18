'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createSourceCircuitBreaker } = require('../sourceCircuitBreaker');
const { runWiflixProxyAttempts, redactWiflixProxyUrl } = require('../wiflixProxyAffinity');

const silent = { log() {}, warn() {}, error() {} };
const page = '<html>' + 'x'.repeat(200) + '</html>';
const timeout = () => Object.assign(new Error('timeout of 5000ms exceeded'), { code: 'ECONNABORTED' });

// Exécute les vrais makeWiflixRequest / makeWiflixSearchRequest sans aucun
// relais Cloudflare défini : un appel à un relais lèverait une ReferenceError.
function fixture({ candidates = [], transport = async () => ({ status: 200, data: page }) } = {}) {
  const filename = path.resolve(__dirname, '../proxyManager.js');
  const code = fs.readFileSync(filename, 'utf8');
  const slice = (from, to) => {
    const start = code.indexOf(from);
    const end = code.indexOf(to, start);
    assert.ok(start > 0 && end > start, `repère introuvable : ${from}`);
    return code.slice(start, end);
  };
  const calls = [];
  const context = vm.createContext({
    console: silent,
    flemmixCircuit: createSourceCircuitBreaker({ name: 'Flemmix', neutralCodes: ['WIFLIX_NO_EGRESS'], logger: silent }),
    WIFLIX_H_CHECK: '25',
    WIFLIX_PROXY_MAX_ATTEMPTS: 4,
    WIFLIX_FREE_PROXY_TIMEOUT: 5000,
    runWiflixProxyAttempts,
    redactWiflixProxyUrl,
    wiflixCandidateAffinity: { getPreferred: async () => null, remember: async () => true, forget: async () => true },
    wiflixProxyCandidates: async () => (typeof candidates === 'function' ? candidates() : [...candidates]),
    wiflixDeadProxies: new Set(),
    wiflixProxyAgentCache: { delete() {} },
    getWiflixFreeProxyAgent: () => ({}),
    wiflixProxyTelemetry: { trackRequest: (_proxy, request) => request(), reportFailure: async () => ({}) },
    isWiflixShieldBody: body => /Bot shield active|Un instant, s.il vous pla[iî]t/i.test(body),
    axios: async config => { calls.push(config.url); return transport(config); },
    wiflixHandshake: async (_home, searchUrl) => { calls.push(searchUrl); return transport({ url: searchUrl }); },
  });
  vm.runInContext(slice('function wiflixProxiesExhausted(', '// Set-Cookie[] ->'), context, { filename });
  vm.runInContext(slice('async function makeWiflixSearchRequest(', '// Fetch initial + refresh 5 min'), context, { filename });
  return { calls, page: context.makeWiflixRequest, search: context.makeWiflixSearchRequest };
}

test('sans proxy disponible, une page Wiflix échoue tout de suite, sans relais', async () => {
  const f = fixture();
  await assert.rejects(f.page('https://flemmix.test/film.html'), { code: 'WIFLIX_NO_EGRESS' });
  assert.equal(f.calls.length, 0);
});

test('la recherche Wiflix sans proxy échoue tout de suite, sans relais', async () => {
  const f = fixture();
  await assert.rejects(f.search('https://flemmix.test/', 'https://flemmix.test/', { data: 'story=x' }),
    { code: 'WIFLIX_NO_EGRESS' });
  assert.equal(f.calls.length, 0);
});

test('des proxys en échec renvoient la dernière erreur au lieu d’un repli', async () => {
  const f = fixture({ candidates: ['http://198.51.100.1:8080', 'http://198.51.100.2:8080'], transport: async () => { throw timeout(); } });
  await assert.rejects(f.page('https://flemmix.test/film.html'), { code: 'ECONNABORTED' });
  assert.equal(f.calls.length, 2);
});

test('trois pages en échec d’affilée mettent Flemmix en pause', async () => {
  // Un proxy en échec passe en liste noire : chaque requête en tire un neuf.
  let next = 0;
  const f = fixture({ candidates: () => [`http://198.51.100.${++next}:8080`], transport: async () => { throw timeout(); } });
  for (let i = 0; i < 3; i++) await assert.rejects(f.page('https://flemmix.test/film.html'), { code: 'ECONNABORTED' });
  await assert.rejects(f.search('https://flemmix.test/', 'https://flemmix.test/', {}), { code: 'SOURCE_CIRCUIT_OPEN' });
  assert.equal(f.calls.length, 3);
});

test('un manque de proxy ne met pas Flemmix en pause', async () => {
  const f = fixture();
  for (let i = 0; i < 5; i++) await assert.rejects(f.page('https://flemmix.test/film.html'), { code: 'WIFLIX_NO_EGRESS' });
});

test('une page servie par un proxy est renvoyée telle quelle', async () => {
  const f = fixture({ candidates: ['http://198.51.100.1:8080'] });
  assert.equal((await f.page('https://flemmix.test/film.html')).data, page);
});
