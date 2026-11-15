'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');
const { once } = require('node:events');
const axios = require('axios');
const { createProxyAgentPool } = require('../proxyAgentPool');
const {
  WIFLIX_DEAD_PROXY_BLOCKED_MS,
  WIFLIX_DEAD_PROXY_TRANSPORT_MS,
  WIFLIX_RESPONSE_MAX_BYTES,
  classifyWiflixProxyFailure,
  createWiflixDeadProxies,
  createWiflixProxyAgents,
  createWiflixSessionCookies,
  hasFreeWiflixSocket,
  isWiflixRateLimited,
  isWiflixSocketReset,
  isWiflixTransportFailure,
  mergeWiflixProxySources,
  redactWiflixProxyUrl,
  runWiflixProxyAttempts,
  runWithWiflixDeadline,
  wiflixFailureStatus,
} = require('../wiflixProxyAffinity');

const silent = { log() {}, warn() {}, error() {} };
const page = '<html>' + 'x'.repeat(200) + '</html>';
const shieldPage = `<html><title>Un instant, s'il vous plaît…</title>${'.'.repeat(200)}</html>`;
const timeout = () => Object.assign(new Error('timeout of 5000ms exceeded'), { code: 'ECONNABORTED' });
const httpError = status => Object.assign(new Error(`Request failed with status code ${status}`), {
  response: { status, data: 'x'.repeat(2257) },
});
const P1 = 'http://198.51.100.1:8080';
const P2 = 'http://198.51.100.2:8080';

const filename = path.resolve(__dirname, '../proxyManager.js');
const code = fs.readFileSync(filename, 'utf8');
const slice = (from, to) => {
  const start = code.indexOf(from);
  const end = code.indexOf(to, start);
  assert.ok(start > 0 && end > start, `repère introuvable : ${from}`);
  return code.slice(start, end);
};

// Détection réelle des pages bouclier et d'accès de proxyManager.
const isWiflixShieldBody = vm.runInNewContext(
  `(${slice('function isWiflixShieldBody', '// Ordre : proxys au cookie').trim()})`);

test('les pages bouclier, d’attente et d’accès ne passent jamais pour une page du site', () => {
  for (const body of [
    '<p>Bot shield active.</p>',
    "<p>Un instant, s'il vous plaît…</p>",
    '<title>Flemmix - Acces securise</title><a id="_btn" class="button">Accéder maintenant</a>',
    '<script>window._isBot = function _isBot() { return false; }</script>',
  ]) assert.equal(isWiflixShieldBody(body), true, body);
  assert.equal(isWiflixShieldBody('<title>Flemmix</title><form id="quicksearch"><input name="story"></form>'), false);
});

// Faux pool d'agents : chaque bail porte l'URL du proxy, visible du faux axios.
function fakePool({ freeSocketFor = () => false } = {}) {
  const leases = [];
  return {
    leases,
    acquire(proxyUrl) {
      const free = freeSocketFor(proxyUrl, leases.filter(l => l.proxyUrl === proxyUrl).length);
      const agent = {
        httpAgent: { proxyUrl, freeSockets: free ? { 'flemmix.test:80:': [{}] } : {} },
        httpsAgent: { proxyUrl, freeSockets: {} },
      };
      const lease = { proxyUrl, agent, discard: null };
      leases.push(lease);
      return { agent, release(discard = false) { lease.discard = discard; } };
    },
  };
}

// Exécute les vrais makeWiflixRequest / makeWiflixSearchRequest sans aucun
// relais Cloudflare défini : un appel à un relais lèverait une ReferenceError.
// `realHandshake` charge aussi le vrai wiflixHandshake (GET d'accueil + POST).
// `gate` remplace la porte de débit globale (par défaut, créneau immédiat).
function fixture({
  candidates = [],
  transport = async () => ({ status: 200, data: page }),
  realHandshake = false,
  deadlineMs = 6000,
  pool = fakePool(),
  gate = { reserve: async () => 0 },
  sessions = createWiflixSessionCookies(),
} = {}) {
  const calls = [];
  const requests = [];
  const reports = [];
  const warmRequests = [];
  const deadProxies = createWiflixDeadProxies();
  const context = vm.createContext({
    console: silent,
    WIFLIX_H_CHECK: '25',
    WIFLIX_PROXY_MAX_ATTEMPTS: 4,
    WIFLIX_FREE_PROXY_TIMEOUT: 5000,
    WIFLIX_REQUEST_DEADLINE_MS: deadlineMs,
    WIFLIX_RESPONSE_MAX_BYTES,
    WIFLIX_WARM_PROXY_MAX: 2,
    runWiflixProxyAttempts,
    runWithWiflixDeadline,
    classifyWiflixProxyFailure,
    hasFreeWiflixSocket,
    isWiflixRateLimited,
    isWiflixSocketReset,
    isWiflixTransportFailure,
    redactWiflixProxyUrl,
    wiflixFailureStatus,
    wiflixGlobalGate: gate,
    wiflixSessionCookies: sessions,
    wiflixCandidateAffinity: { getPreferred: async () => null, remember: async () => true, forget: async () => true },
    wiflixProxyCandidates: async (_count, warm = []) => {
      warmRequests.push([...warm]);
      return typeof candidates === 'function' ? candidates() : [...candidates];
    },
    wiflixDeadProxies: deadProxies,
    wiflixProxyAgentPool: pool,
    wiflixProxyTelemetry: {
      trackRequest: (_proxy, request) => request(),
      reportFailure: async (proxyUrl, error) => { reports.push([proxyUrl, error.code]); return {}; },
    },
    isWiflixShieldBody,
    axios: async config => {
      calls.push(config.url);
      requests.push({ ...config, method: config.method || 'GET', proxyUrl: config.httpAgent?.proxyUrl });
      return transport(config, config.httpAgent?.proxyUrl);
    },
    wiflixHandshake: async (_home, searchUrl) => { calls.push(searchUrl); return transport({ url: searchUrl }); },
  });
  vm.runInContext(slice('// === Essais Wiflix par proxy', '// Set-Cookie[] ->'), context, { filename });
  if (realHandshake) {
    vm.runInContext(slice('// Set-Cookie[] ->', 'async function makeWiflixSearchRequest('), context, { filename });
  }
  vm.runInContext(slice('async function makeWiflixSearchRequest(', '// Fetch initial + refresh 5 min'), context, { filename });
  return {
    calls, requests, reports, warmRequests, deadProxies, pool, sessions,
    page: context.makeWiflixRequest, search: context.makeWiflixSearchRequest,
  };
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
  const f = fixture({ candidates: [P1, P2], transport: async () => { throw timeout(); } });
  await assert.rejects(f.page('https://flemmix.test/film.html'), { code: 'ECONNABORTED' });
  assert.equal(f.calls.length, 2);
});

test('des proxys en échec ne mettent pas Flemmix en pause : le proxy suivant sert', async () => {
  // Un proxy en échec passe en liste noire : chaque requête en tire un neuf.
  let next = 0;
  let failing = true;
  const f = fixture({
    candidates: () => [`http://198.51.100.${++next}:8080`],
    transport: async () => { if (failing) throw timeout(); return { status: 200, data: page }; },
  });
  for (let i = 0; i < 5; i++) await assert.rejects(f.page('https://flemmix.test/film.html'), { code: 'ECONNABORTED' });
  failing = false;
  assert.equal((await f.search('https://flemmix.test/', 'https://flemmix.test/', {})).data, page);
  assert.equal(f.calls.length, 6);
});

test('un manque de proxy échoue sans pause', async () => {
  const f = fixture();
  for (let i = 0; i < 5; i++) await assert.rejects(f.page('https://flemmix.test/film.html'), { code: 'WIFLIX_NO_EGRESS' });
});

test('une page servie par un proxy est renvoyée telle quelle', async () => {
  const f = fixture({ candidates: [P1] });
  assert.equal((await f.page('https://flemmix.test/film.html')).data, page);
  // Plafond de 4 Mio sur la réponse décompressée.
  assert.equal(f.requests[0].maxContentLength, 4 * 1024 * 1024);
});

test('une page d’attente à l’accueil n’est jamais suivie du POST de recherche', async () => {
  const f = fixture({
    candidates: [P1, P2],
    realHandshake: true,
    transport: async (config, proxyUrl) => {
      if (config.method === 'POST') return { status: 200, headers: {}, data: page };
      if (proxyUrl === P1) return { status: 200, headers: {}, data: shieldPage };
      return { status: 200, headers: { 'set-cookie': ['PHPSESSID=abc; path=/'] }, data: page };
    },
  });
  const res = await f.search('https://flemmix.test/', 'https://flemmix.test/', { data: 'story=x' });
  assert.equal(res.data, page);
  assert.deepEqual(f.requests.map(r => `${r.method} ${r.proxyUrl}`), [`GET ${P1}`, `GET ${P2}`, `POST ${P2}`]);
  // Le POST part sur le même proxy avec le cookie de session récolté.
  assert.match(f.requests[2].headers.cookie, /^PHPSESSID=abc; h_check=25$/);
  assert.ok(f.requests.every(r => r.maxContentLength === 4 * 1024 * 1024));
  // Page bouclier : proxy écarté 2 min, mais sa connexion est saine.
  assert.ok(f.deadProxies.remainingMs(P1) > WIFLIX_DEAD_PROXY_TRANSPORT_MS);
  assert.equal(f.deadProxies.has(P2), false);
  assert.deepEqual(f.pool.leases.map(l => l.discard), [false, false]);
});

test('sans accueil utilisable, la recherche échoue sans aucun POST', async () => {
  const f = fixture({
    candidates: [P1, P2],
    realHandshake: true,
    transport: async () => ({ status: 200, headers: {}, data: shieldPage }),
  });
  await assert.rejects(f.search('https://flemmix.test/', 'https://flemmix.test/', { data: 'story=x' }),
    { wiflixShield: true, wiflixStatus: 200 });
  assert.deepEqual(f.requests.map(r => r.method), ['GET', 'GET']);
});

// Faux Flemmix : l'accueil ouvre une session liée au proxy, le POST de
// recherche n'accepte qu'une session valide de ce même proxy.
function shieldedSite({ rejectSession = () => false } = {}) {
  let issued = 0;
  const sessions = new Map();
  return async (config, proxyUrl) => {
    if (config.method === 'GET') {
      const id = `s${++issued}`;
      sessions.set(id, proxyUrl);
      return { status: 200, headers: { 'set-cookie': [`PHPSESSID=${id}; path=/`] }, data: page };
    }
    const id = /PHPSESSID=(\w+)/.exec(config.headers.cookie || '')?.[1];
    if (!id || sessions.get(id) !== proxyUrl || rejectSession(id)) {
      return { status: 200, headers: {}, data: `<p>Bot shield active.</p>${'.'.repeat(200)}` };
    }
    return { status: 200, headers: {}, data: page };
  };
}
const search = f => f.search('https://flemmix.test/', 'https://flemmix.test/', { data: 'story=x' });
const trace = f => f.requests.map(r => `${r.method} ${r.proxyUrl}`);

test('un cookie de session connu évite le GET d’accueil sur le même proxy', async () => {
  const f = fixture({ candidates: [P1], realHandshake: true, transport: shieldedSite() });
  assert.equal((await search(f)).data, page);
  assert.equal((await search(f)).data, page);
  assert.deepEqual(trace(f), [`GET ${P1}`, `POST ${P1}`, `POST ${P1}`]);
  assert.match(f.requests[2].headers.cookie, /^PHPSESSID=s1; h_check=25$/);
  // Le proxy au cookie connu est proposé en tête de la recherche suivante.
  assert.deepEqual(f.warmRequests, [[], [P1]]);
});

test('un cookie refusé est oublié : poignée de main complète sur le même proxy, sans l’écarter', async () => {
  for (const variant of ['page bouclier', '403']) {
    let reject = false;
    const site = shieldedSite({ rejectSession: id => reject && id === 's1' });
    const f = fixture({
      candidates: [P1, P2],
      realHandshake: true,
      transport: async (config, proxyUrl) => {
        if (variant === '403' && reject && config.method === 'POST' && /s1/.test(config.headers.cookie)) {
          throw httpError(403);
        }
        return site(config, proxyUrl);
      },
    });
    await search(f);
    reject = true;
    assert.equal((await search(f)).data, page, variant);
    assert.deepEqual(trace(f), [`GET ${P1}`, `POST ${P1}`, `POST ${P1}`, `GET ${P1}`, `POST ${P1}`], variant);
    assert.match(f.requests[4].headers.cookie, /^PHPSESSID=s2; h_check=25$/, variant);
    assert.equal(f.deadProxies.has(P1), false, variant);
    assert.deepEqual(f.reports, [], variant);
    // Le nouveau cookie est repris ensuite.
    await search(f);
    assert.deepEqual(trace(f).slice(5), [`POST ${P1}`], variant);
  }
});

test('un proxy bloqué après un cookie refusé reste écarté comme avant', async () => {
  let blocked = false;
  const site = shieldedSite();
  const f = fixture({
    candidates: [P1, P2],
    realHandshake: true,
    transport: async (config, proxyUrl) => {
      if (blocked && proxyUrl === P1) throw httpError(403);
      return site(config, proxyUrl);
    },
  });
  await search(f);
  blocked = true;
  assert.equal((await search(f)).data, page);
  // Cookie refusé (403), accueil refusé (403) : P1 écarté 2 min, P2 sert.
  assert.deepEqual(trace(f).slice(2), [`POST ${P1}`, `GET ${P1}`, `GET ${P2}`, `POST ${P2}`]);
  assert.ok(f.deadProxies.remainingMs(P1) > WIFLIX_DEAD_PROXY_BLOCKED_MS - 1000);
  assert.equal(f.sessions.get(P1), null);
});

test('chaque requête vers Flemmix prend un créneau du débit global, essais sur un autre proxy compris', async () => {
  const slots = [];
  const gate = { reserve: async () => { slots.push(Date.now()); return 0; } };
  const f = fixture({
    candidates: [P1, P2],
    realHandshake: true,
    gate,
    transport: async (config, proxyUrl) => {
      if (proxyUrl === P1) return { status: 200, headers: {}, data: shieldPage };
      return { status: 200, headers: {}, data: page };
    },
  });
  await search(f);
  assert.deepEqual(trace(f), [`GET ${P1}`, `GET ${P2}`, `POST ${P2}`]);
  assert.equal(slots.length, 3);
  // Page de fiche : un créneau, pris avant le choix des proxys.
  await f.page('https://flemmix.test/film.html');
  assert.equal(slots.length, 4);
});

test('un refus du débit global avant le choix des proxys ne réserve aucun proxy', async () => {
  const limited = () => Object.assign(new Error('Flemmix : débit global atteint'), { code: 'WIFLIX_RATE_LIMITED' });
  let picked = 0;
  const f = fixture({
    candidates: () => { picked++; return [P1]; },
    realHandshake: true,
    gate: { reserve: async () => { throw limited(); } },
  });
  await assert.rejects(f.page('https://flemmix.test/film.html'), { code: 'WIFLIX_RATE_LIMITED' });
  await assert.rejects(search(f), { code: 'WIFLIX_RATE_LIMITED' });
  assert.equal(picked, 0);
  assert.equal(f.requests.length, 0);
});

test('un refus du débit global en cours d’essai n’est jamais compté contre le proxy', async () => {
  const limited = () => Object.assign(new Error('Flemmix : débit global atteint'), { code: 'WIFLIX_RATE_LIMITED' });
  let reservations = 0;
  // Le premier créneau (accueil) passe, celui du POST est refusé.
  const f = fixture({
    candidates: [P1, P2],
    realHandshake: true,
    gate: { reserve: async () => { if (++reservations > 1) throw limited(); return 0; } },
    transport: shieldedSite(),
  });
  await assert.rejects(search(f), { code: 'WIFLIX_RATE_LIMITED' });
  // Ni proxy suivant, ni liste noire, ni agent retiré, ni rapport de blocage.
  assert.deepEqual(trace(f), [`GET ${P1}`]);
  assert.equal(f.deadProxies.size, 0);
  assert.deepEqual(f.pool.leases.map(l => l.discard), [false]);
  assert.deepEqual(f.reports, []);
});

test('le délai dur borne un essai pendu, détruit sa requête et passe au proxy suivant', { timeout: 3000 }, async () => {
  const signals = [];
  const f = fixture({
    candidates: [P1, P2],
    deadlineMs: 50,
    // Comme axios : la requête ne finit que si son signal est levé.
    transport: (config, proxyUrl) => {
      signals.push(config.signal);
      if (proxyUrl === P2) return Promise.resolve({ status: 200, data: page });
      return new Promise((_, reject) => config.signal.addEventListener('abort', () =>
        reject(Object.assign(new Error('canceled'), { code: 'ERR_CANCELED' }))));
    },
  });
  const started = Date.now();
  assert.equal((await f.page('https://flemmix.test/film.html')).data, page);
  assert.ok(Date.now() - started < 1000);
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[1].aborted, false);
  // Délai dépassé : exclusion courte et agent retiré (panne de transport).
  const remaining = f.deadProxies.remainingMs(P1);
  assert.ok(remaining > 0 && remaining <= WIFLIX_DEAD_PROXY_TRANSPORT_MS);
  assert.deepEqual(f.pool.leases.map(l => l.discard), [true, false]);
});

test('un 503 de l’origine ne marque pas le proxy mort et laisse sa place au suivant', async () => {
  const f = fixture({
    candidates: [P1, P2],
    transport: async (_config, proxyUrl) => { if (proxyUrl === P1) throw httpError(503); return { status: 200, data: page }; },
  });
  assert.equal((await f.page('https://flemmix.test/film.html')).data, page);
  assert.equal(f.calls.length, 2);
  assert.equal(f.deadProxies.has(P1), false);
  assert.deepEqual(f.pool.leases.map(l => l.discard), [false, false]);
});

test('un 503 sur le POST de recherche compte un essai sans écarter le proxy', async () => {
  const f = fixture({
    candidates: [P1, P2],
    realHandshake: true,
    transport: async (config, proxyUrl) => {
      if (config.method === 'POST' && proxyUrl === P1) throw httpError(503);
      return { status: 200, headers: {}, data: page };
    },
  });
  assert.equal((await f.search('https://flemmix.test/', 'https://flemmix.test/', { data: 'story=x' })).data, page);
  assert.equal(f.requests.length, 4);
  assert.equal(f.deadProxies.size, 0);
});

test('un 404 arrête les essais et remonte tel quel, sans écarter le proxy', async () => {
  const f = fixture({ candidates: [P1, P2], transport: async () => { throw httpError(404); } });
  const error = await f.page('https://flemmix.test/film.html').catch(err => err);
  assert.equal(error.response.status, 404);
  assert.equal(f.calls.length, 1);
  assert.equal(f.deadProxies.size, 0);
});

test('un 403 écarte le proxy 2 min sans détruire son agent', async () => {
  const f = fixture({
    candidates: [P1, P2],
    transport: async (_config, proxyUrl) => { if (proxyUrl === P1) throw httpError(403); return { status: 200, data: page }; },
  });
  assert.equal((await f.page('https://flemmix.test/film.html')).data, page);
  assert.ok(f.deadProxies.remainingMs(P1) > WIFLIX_DEAD_PROXY_BLOCKED_MS - 1000);
  assert.deepEqual(f.pool.leases.map(l => l.discard), [false, false]);
});

test('un socket gardé ouvert coupé par le proxy est retenté une fois sur une connexion neuve', async () => {
  let resets = 0;
  const f = fixture({
    candidates: [P1, P2],
    pool: fakePool({ freeSocketFor: (_proxyUrl, previous) => previous === 0 }),
    transport: async () => {
      if (resets++ === 0) throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
      return { status: 200, data: page };
    },
  });
  assert.equal((await f.page('https://flemmix.test/film.html')).data, page);
  assert.deepEqual(f.requests.map(r => r.proxyUrl), [P1, P1]);
  assert.equal(f.deadProxies.has(P1), false);
  // L'agent au socket coupé est retiré, le neuf est gardé.
  assert.deepEqual(f.pool.leases.map(l => l.discard), [true, false]);
});

test('une connexion neuve coupée n’est pas retentée : le proxy est écarté 30 s', async () => {
  const f = fixture({
    candidates: [P1, P2],
    transport: async (_config, proxyUrl) => {
      if (proxyUrl === P1) throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
      return { status: 200, data: page };
    },
  });
  assert.equal((await f.page('https://flemmix.test/film.html')).data, page);
  assert.deepEqual(f.requests.map(r => r.proxyUrl), [P1, P2]);
  const remaining = f.deadProxies.remainingMs(P1);
  assert.ok(remaining > 0 && remaining <= WIFLIX_DEAD_PROXY_TRANSPORT_MS);
  assert.deepEqual(f.pool.leases.map(l => l.discard), [true, false]);
});

test('vrai pool d’agents : un même proxy garde sa connexion, et un socket coupé est repris', { timeout: 5000 }, async (t) => {
  let connections = 0;
  // Proxy HTTP local : sur demande (x-cut), il coupe un socket déjà servi.
  const server = http.createServer((req, res) => {
    req.socket.served = (req.socket.served || 0) + 1;
    if (req.headers['x-cut'] && req.socket.served > 1) return req.socket.destroy();
    return res.end(page);
  });
  server.on('connection', () => connections++);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const proxyUrl = `http://127.0.0.1:${server.address().port}`;
  const pool = createProxyAgentPool({
    maxEntries: 8,
    createAgent: (url, keepAlive) => createWiflixProxyAgents(url, { keepAlive }),
  });
  t.after(async () => {
    pool.clear();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const f = fixture({ candidates: [proxyUrl], pool, transport: config => axios({ ...config, proxy: false }) });

  assert.equal((await f.page('http://flemmix.test/a.html')).data, page);
  assert.equal((await f.page('http://flemmix.test/b.html')).data, page);
  assert.equal(connections, 1);
  assert.equal((await f.page('http://flemmix.test/c.html', { headers: { 'x-cut': '1' } })).data, page);
  assert.equal(connections, 2);
  assert.equal(f.deadProxies.has(proxyUrl), false);
});

// Réservation qui applique, comme le script Redis, le plafond de chaque groupe.
const cappedReserve = async (_name, entries, { maxTotal }) => {
  const counts = new Map();
  const picked = [];
  for (const entry of entries) {
    if (picked.length >= maxTotal) break;
    const used = counts.get(entry.group) || 0;
    if (used >= entry.cap) continue;
    counts.set(entry.group, used + 1);
    picked.push({ ...entry });
  }
  return picked;
};

// Vrai wiflixProxyCandidates, avec par défaut une réservation qui accepte tout.
function candidatesFixture({
  pool, now, start = 0,
  reserve = async (_name, entries, { maxTotal }) => entries.slice(0, maxTotal),
}) {
  const deadProxies = createWiflixDeadProxies({ now });
  const context = vm.createContext({
    URL,
    HTTP_PROXIES: pool,
    WIFLIX_PROXY_POOL_NAME: 'WIFLIX',
    WIFLIX_PROXYSCRAPE_SAMPLE: 3,
    WIFLIX_PROXY_MAX_ATTEMPTS: 4,
    WIFLIX_PROXY_MIN_INTERVAL_MS: 1000,
    WIFLIX_PROXY_SCAN_LIMIT: 50,
    WIFLIX_WARM_PROXY_MAX: 2,
    wiflixConfiguredProxies: [],
    wiflixFreeProxies: [],
    wiflixDeadProxies: deadProxies,
    wiflixProxyAffinity: { getPreferred: async () => null, forget: async () => true },
    mergeWiflixProxySources,
    proxyToUrl: (proxy, protocol) => `${protocol}://${proxy.host}:${proxy.port}`,
    reserveProxyWindow: async () => start,
    reserveRateLimitedProxyBatch: reserve,
  });
  vm.runInContext(slice('function wiflixProxyIdentity(', '// Le dernier proxy gagnant est déjà placé'), context, { filename });
  return { deadProxies, candidates: context.wiflixProxyCandidates };
}

const poolOf = count => Array.from({ length: count }, (_, i) => ({ type: 'http', host: `198.51.100.${i + 1}`, port: 8080 }));
const urlOf = i => `http://198.51.100.${i + 1}:8080`;

test('la liste noire n’est plus vidée d’un coup : chaque proxy garde son échéance', async () => {
  let clock = 0;
  // Fenêtre de rotation 50..99 sur un pool de 200 proxys.
  const f = candidatesFixture({ pool: poolOf(200), now: () => clock, start: 50 });
  // 70 proxys écartés (> max(50, 200/3)) : l'ancien code vidait toute la liste.
  for (let i = 0; i < 70; i++) f.deadProxies.add(urlOf(i), WIFLIX_DEAD_PROXY_BLOCKED_MS);
  assert.deepEqual(Array.from(await f.candidates(1)), [urlOf(70), urlOf(71), urlOf(72), urlOf(73)]);
  assert.equal(f.deadProxies.size, 70);
  // À l'échéance, les proxys écartés reviennent d'eux-mêmes.
  clock += WIFLIX_DEAD_PROXY_BLOCKED_MS;
  assert.deepEqual(Array.from(await f.candidates(1)), [urlOf(50), urlOf(51), urlOf(52), urlOf(53)]);
  assert.equal(f.deadProxies.size, 0);
});

test('plancher : un pool entièrement écarté rend les proxys dont l’exclusion finit le plus tôt', async () => {
  const f = candidatesFixture({ pool: poolOf(6), now: () => 0 });
  const ttls = [120_000, 30_000, 90_000, 45_000, 60_000, 100_000];
  ttls.forEach((ttl, i) => f.deadProxies.add(urlOf(i), ttl));
  const picked = Array.from(await f.candidates(1));
  assert.deepEqual(picked, [urlOf(1), urlOf(3), urlOf(4), urlOf(2)]);
  // Les proxys rendus sortent de la liste noire, les autres y restent.
  assert.equal(f.deadProxies.size, 2);
  assert.equal(f.deadProxies.has(urlOf(0)), true);
  assert.equal(f.deadProxies.has(urlOf(5)), true);
});

test('plancher : un proxy écarté que la réservation laisse de côté garde son échéance', async () => {
  // 3 proxys sains sur 10 : le plancher propose un proxy écarté, mais le
  // plafond ProxyScrape (3) est déjà atteint par les proxys sains.
  const f = candidatesFixture({ pool: poolOf(10), now: () => 0, reserve: cappedReserve });
  for (let i = 0; i < 7; i++) f.deadProxies.add(urlOf(i), WIFLIX_DEAD_PROXY_BLOCKED_MS);
  assert.deepEqual(Array.from(await f.candidates(1)), [urlOf(7), urlOf(8), urlOf(9)]);
  assert.equal(f.deadProxies.size, 7);
  for (let i = 0; i < 7; i++) assert.equal(f.deadProxies.has(urlOf(i)), true);
});

test('les proxys au cookie connu passent en tête, deux au plus', async () => {
  const f = candidatesFixture({ pool: poolOf(10), now: () => 0, reserve: cappedReserve });
  const warm = [urlOf(7), urlOf(8), urlOf(9)];
  assert.deepEqual(Array.from(await f.candidates(2, warm)), [urlOf(7), urlOf(8), urlOf(0), urlOf(1)]);
  // Un proxy au cookie connu mais écarté n'est pas proposé.
  f.deadProxies.add(urlOf(7), WIFLIX_DEAD_PROXY_BLOCKED_MS);
  assert.deepEqual(Array.from(await f.candidates(2, [urlOf(7)])), [urlOf(0), urlOf(1), urlOf(2)]);
});

test('plancher : des proxys sains suffisent, aucun proxy écarté n’est rendu', async () => {
  const f = candidatesFixture({ pool: poolOf(8), now: () => 0 });
  for (let i = 0; i < 4; i++) f.deadProxies.add(urlOf(i), 30_000);
  assert.deepEqual(Array.from(await f.candidates(1)), [urlOf(4), urlOf(5), urlOf(6), urlOf(7)]);
  assert.equal(f.deadProxies.size, 4);
});
