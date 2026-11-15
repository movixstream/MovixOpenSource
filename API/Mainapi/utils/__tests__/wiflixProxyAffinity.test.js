const assert = require('node:assert/strict');
const test = require('node:test');
const http = require('node:http');
const net = require('node:net');
const { once } = require('node:events');
const axios = require('axios');

const {
  WIFLIX_AGENT_SOCKET_TIMEOUT_MS,
  WIFLIX_DEAD_PROXY_BLOCKED_MS,
  WIFLIX_DEAD_PROXY_TRANSPORT_MS,
  WIFLIX_PROXY_REDIS_TTL_SECONDS,
  classifyWiflixProxyFailure,
  createWiflixDeadProxies,
  createWiflixProxyAffinity,
  createWiflixProxyAgents,
  hasFreeWiflixSocket,
  isSocksWiflixProxyUrl,
  isValidWiflixProxyUrl,
  isWiflixSocketReset,
  mergeWiflixProxySources,
  redactWiflixProxyUrl,
  runWiflixProxyAttempts,
  runWithWiflixDeadline,
} = require('../wiflixProxyAffinity');

class InMemoryRedis {
  constructor() {
    this.values = new Map();
    this.setCalls = [];
  }

  async get(key) {
    return this.values.get(key) || null;
  }

  async set(key, value, ...args) {
    this.values.set(key, value);
    this.setCalls.push([key, value, ...args]);
    return 'OK';
  }

  async eval(_script, _keyCount, key, expectedValue) {
    if (this.values.get(key) !== expectedValue) return 0;
    this.values.delete(key);
    return 1;
  }
}

test('a successful Wiflix proxy is retained in Redis for 24 hours', async () => {
  const redis = new InMemoryRedis();
  const affinity = createWiflixProxyAffinity({ redis });
  const proxyUrl = 'http://198.51.100.10:8080';

  assert.equal(await affinity.remember(proxyUrl), true);
  assert.equal(await affinity.getPreferred(), proxyUrl);
  assert.deepEqual(
    redis.setCalls.at(-1).slice(2),
    ['EX', WIFLIX_PROXY_REDIS_TTL_SECONDS],
  );
});

test('the retained Wiflix proxy is tried first, evicted on failure, then replaced by a success', async () => {
  const redis = new InMemoryRedis();
  const affinity = createWiflixProxyAffinity({ redis });
  const retained = 'http://198.51.100.10:8080';
  const replacement = 'http://198.51.100.11:8080';
  const unused = 'http://198.51.100.12:8080';
  const attempted = [];
  const deadProxies = new Set();

  await affinity.remember(retained);

  const outcome = await runWiflixProxyAttempts({
    affinity,
    proxies: [unused, replacement, retained],
    deadProxies,
    maxAttempts: 3,
    attempt: async (proxyUrl) => {
      attempted.push(proxyUrl);
      if (proxyUrl === retained) throw new Error('HTTP 429');
      if (proxyUrl === replacement) return { status: 200, data: '<html>ok</html>' };
      throw new Error('timeout');
    },
  });

  assert.deepEqual(attempted, [retained, unused, replacement]);
  assert.equal(outcome.proxyUrl, replacement);
  assert.equal(outcome.response.status, 200);
  assert.equal(deadProxies.has(retained), true);
  assert.equal(deadProxies.has(unused), true);
  assert.equal(await affinity.getPreferred(), replacement);
});

test('Redis failures never prevent Wiflix from trying local proxies', async () => {
  const unavailableAffinity = {
    async getPreferred() { throw new Error('Redis unavailable'); },
    async remember() { throw new Error('Redis unavailable'); },
    async forget() { throw new Error('Redis unavailable'); },
  };
  const localProxy = 'http://203.0.113.20:3128';

  const outcome = await runWiflixProxyAttempts({
    affinity: unavailableAffinity,
    proxies: [localProxy],
    deadProxies: new Set(),
    maxAttempts: 3,
    attempt: async () => ({ status: 200, data: '<html>ok</html>' }),
  });

  assert.equal(outcome.proxyUrl, localProxy);
  assert.equal(outcome.response.status, 200);
});

test('authenticated SOCKS5 proxies are valid Wiflix candidates', async () => {
  const socksProxy = 'socks5h://user:password@147.135.138.207:10041';

  assert.equal(isValidWiflixProxyUrl(socksProxy), true);
  assert.equal(isSocksWiflixProxyUrl(socksProxy), true);

  const attempted = [];
  const outcome = await runWiflixProxyAttempts({
    affinity: createWiflixProxyAffinity({ redis: new InMemoryRedis() }),
    proxies: [socksProxy],
    deadProxies: new Set(),
    maxAttempts: 1,
    attempt: async (proxyUrl) => {
      attempted.push(proxyUrl);
      return { status: 200, data: '<html>ok</html>' };
    },
  });

  assert.deepEqual(attempted, [socksProxy]);
  assert.equal(outcome.proxyUrl, socksProxy);
});

test('configured SOCKS5 proxies stay ahead of fetched Wiflix proxies without duplicates', () => {
  const configured = [
    'socks5h://user:password@147.135.138.207:10041',
    'socks5h://user:password@147.135.138.207:10042',
  ];
  const fetched = [
    configured[1],
    'http://198.51.100.10:8080',
  ];

  assert.deepEqual(
    mergeWiflixProxySources(configured, fetched),
    [configured[0], configured[1], fetched[1]],
  );
});

test('Wiflix logs never expose proxy credentials', () => {
  assert.equal(
    redactWiflixProxyUrl('socks5h://user:password@147.135.138.207:10041'),
    'socks5h://147.135.138.207:10041',
  );
});

test('configured Wiflix proxies take priority over an older Redis affinity', async () => {
  const redis = new InMemoryRedis();
  const affinity = createWiflixProxyAffinity({ redis });
  const retained = 'http://198.51.100.10:8080';
  const configured = 'socks5h://user:password@147.135.138.207:10041';
  const attempted = [];

  await affinity.remember(retained);

  const outcome = await runWiflixProxyAttempts({
    affinity,
    priorityProxies: [configured],
    proxies: [retained, configured],
    deadProxies: new Set(),
    maxAttempts: 2,
    attempt: async (proxyUrl) => {
      attempted.push(proxyUrl);
      return { status: 200, data: '<html>ok</html>' };
    },
  });

  assert.deepEqual(attempted, [configured]);
  assert.equal(outcome.proxyUrl, configured);
  assert.equal(await affinity.getPreferred(), configured);
});

const httpError = status => Object.assign(new Error(`HTTP ${status}`), { response: { status } });
const A = 'http://198.51.100.21:8080';
const B = 'http://198.51.100.22:8080';
const C = 'http://198.51.100.23:8080';

test('verdicts Wiflix : 404 arrête, 503 garde le proxy, blocage 2 min, panne réseau 30 s', () => {
  assert.deepEqual(classifyWiflixProxyFailure(httpError(404)), { dead: false, stop: true });
  assert.deepEqual(classifyWiflixProxyFailure({ wiflixStatus: 404 }), { dead: false, stop: true });
  assert.deepEqual(classifyWiflixProxyFailure(httpError(503)), { dead: false });
  assert.deepEqual(classifyWiflixProxyFailure(httpError(403)), { dead: true, ttlMs: WIFLIX_DEAD_PROXY_BLOCKED_MS });
  assert.deepEqual(
    classifyWiflixProxyFailure({ wiflixStatus: 200, wiflixShield: true }),
    { dead: true, ttlMs: WIFLIX_DEAD_PROXY_BLOCKED_MS },
  );
  assert.deepEqual(
    classifyWiflixProxyFailure({ code: 'ECONNABORTED' }),
    { dead: true, ttlMs: WIFLIX_DEAD_PROXY_TRANSPORT_MS },
  );
  assert.equal(isWiflixSocketReset({ code: 'ECONNRESET' }), true);
  assert.equal(isWiflixSocketReset({ code: 'ECONNRESET', response: { status: 502 } }), false);
  assert.equal(isWiflixSocketReset({ code: 'ECONNABORTED' }), false);
});

test('un proxy écarté revient seul à son échéance, sans vidage de la liste', () => {
  let clock = 1000;
  const dead = createWiflixDeadProxies({ now: () => clock });
  dead.add(A, WIFLIX_DEAD_PROXY_BLOCKED_MS);
  dead.add(B); // 30 s par défaut
  assert.equal(dead.size, 2);
  clock += WIFLIX_DEAD_PROXY_TRANSPORT_MS;
  assert.equal(dead.has(B), false);
  assert.equal(dead.has(A), true);
  const remaining = WIFLIX_DEAD_PROXY_BLOCKED_MS - WIFLIX_DEAD_PROXY_TRANSPORT_MS;
  assert.equal(dead.remainingMs(A), remaining);
  // Un délai dépassé ne raccourcit pas l'exclusion d'un proxy bloqué.
  dead.add(A, WIFLIX_DEAD_PROXY_TRANSPORT_MS);
  assert.equal(dead.remainingMs(A), remaining);
  clock += remaining;
  assert.equal(dead.size, 0);
  assert.equal(dead.remainingMs(A), 0);
  dead.add(A);
  assert.equal(dead.delete(A), true);
  assert.equal(dead.has(A), false);
  dead.add(A);
  dead.clear();
  assert.equal(dead.size, 0);
});

test('la liste des proxys écartés reste bornée', () => {
  const dead = createWiflixDeadProxies({ now: () => 0, maxEntries: 3 });
  for (let i = 1; i <= 5; i++) dead.add(`http://198.51.100.${i}:8080`);
  assert.equal(dead.size, 3);
  assert.equal(dead.has('http://198.51.100.1:8080'), false);
  assert.equal(dead.has('http://198.51.100.5:8080'), true);
});

test('des 503 comptent des essais sans écarter les proxys ni oublier le préféré', async () => {
  const redis = new InMemoryRedis();
  const affinity = createWiflixProxyAffinity({ redis });
  const deadProxies = createWiflixDeadProxies();
  await affinity.remember(A);

  const outcome = await runWiflixProxyAttempts({
    affinity,
    proxies: [B],
    deadProxies,
    maxAttempts: 2,
    classifyFailure: classifyWiflixProxyFailure,
    attempt: async () => { throw httpError(503); },
  });

  assert.equal(outcome.response, null);
  assert.equal(outcome.attemptedCount, 2);
  assert.equal(outcome.lastError.response.status, 503);
  assert.equal(outcome.stopped, undefined);
  assert.equal(deadProxies.size, 0);
  assert.equal(await affinity.getPreferred(), A);
});

test('un 404 arrête les essais et rend cette erreur, sans écarter le proxy', async () => {
  const deadProxies = createWiflixDeadProxies();
  const notFound = httpError(404);
  const attempted = [];
  const outcome = await runWiflixProxyAttempts({
    proxies: [A, B, C],
    deadProxies,
    maxAttempts: 3,
    classifyFailure: classifyWiflixProxyFailure,
    attempt: async (proxyUrl) => { attempted.push(proxyUrl); throw notFound; },
  });
  assert.deepEqual(attempted, [A]);
  assert.equal(outcome.lastError, notFound);
  assert.equal(outcome.stopped, true);
  assert.equal(outcome.attemptedCount, 1);
  assert.equal(deadProxies.size, 0);
});

test('chaque proxy écarté reçoit la durée de son verdict', async () => {
  let clock = 0;
  const deadProxies = createWiflixDeadProxies({ now: () => clock });
  await runWiflixProxyAttempts({
    proxies: [A, B],
    deadProxies,
    maxAttempts: 2,
    classifyFailure: classifyWiflixProxyFailure,
    attempt: async (proxyUrl) => {
      throw proxyUrl === A ? httpError(403) : Object.assign(new Error('timeout'), { code: 'ECONNABORTED' });
    },
  });
  assert.equal(deadProxies.remainingMs(A), WIFLIX_DEAD_PROXY_BLOCKED_MS);
  assert.equal(deadProxies.remainingMs(B), WIFLIX_DEAD_PROXY_TRANSPORT_MS);
  clock += WIFLIX_DEAD_PROXY_TRANSPORT_MS;
  assert.equal(deadProxies.has(B), false);
  assert.equal(deadProxies.has(A), true);
});

test('le délai dur rejette à temps et lève le signal, même si le transport l’ignore', { timeout: 2000 }, async () => {
  let seen;
  const started = Date.now();
  await assert.rejects(
    runWithWiflixDeadline((signal) => { seen = signal; return new Promise(() => {}); }, 40),
    { code: 'ECONNABORTED', wiflixDeadline: true },
  );
  assert.ok(Date.now() - started < 1000);
  assert.equal(seen.aborted, true);
  assert.equal(await runWithWiflixDeadline(async () => 'ok', 40), 'ok');
});

test('agents Wiflix keep-alive : 4 sockets par proxy, 1 libre, fermé après 15 s', () => {
  const agents = createWiflixProxyAgents('http://198.51.100.10:8080');
  for (const agent of [agents.httpAgent, agents.httpsAgent]) {
    assert.equal(agent.keepAlive, true);
    assert.equal(agent.maxSockets, 4);
    assert.equal(agent.maxFreeSockets, 1);
    assert.equal(agent.options.timeout, WIFLIX_AGENT_SOCKET_TIMEOUT_MS);
  }
  agents.destroy();

  const socks = createWiflixProxyAgents('socks5h://user:password@147.135.138.207:10041');
  assert.equal(socks.httpAgent, socks.httpsAgent);
  assert.equal(socks.httpAgent.keepAlive, true);
  assert.equal(socks.httpAgent.maxSockets, 4);
  assert.equal(socks.httpAgent.timeout, WIFLIX_AGENT_SOCKET_TIMEOUT_MS);
  socks.destroy();

  // Pool d'agents plein : agent ponctuel, sans keep-alive.
  const oneOff = createWiflixProxyAgents('http://198.51.100.10:8080', { keepAlive: false });
  assert.equal(oneOff.httpAgent.keepAlive, false);
  oneOff.destroy();
});

test('le GET d’accueil et le POST d’un essai passent par une seule connexion au proxy', async (t) => {
  let connections = 0;
  const proxy = http.createServer((req, res) => { req.resume(); req.on('end', () => res.end('<html>ok</html>')); });
  proxy.on('connection', () => connections++);
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');
  // Délai de connexion très court : il doit être désarmé une fois connecté.
  const agents = createWiflixProxyAgents(`http://127.0.0.1:${proxy.address().port}`, { connectDeadlineMs: 50 });
  t.after(async () => {
    agents.destroy();
    proxy.closeAllConnections();
    await new Promise(resolve => proxy.close(resolve));
  });
  const config = {
    url: 'http://flemmix.test/', proxy: false, timeout: 2000,
    httpAgent: agents.httpAgent, httpsAgent: agents.httpsAgent,
  };

  assert.equal(hasFreeWiflixSocket(agents), false);
  assert.equal((await axios({ ...config, method: 'GET' })).data, '<html>ok</html>');
  assert.equal(hasFreeWiflixSocket(agents), true);
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal((await axios({ ...config, method: 'POST', data: 'do=search' })).data, '<html>ok</html>');
  assert.equal(connections, 1);
});

test('un proxy muet au CONNECT est coupé au délai, socket compris', { timeout: 5000 }, async (t) => {
  // Lit le CONNECT sans jamais répondre.
  const accepted = [];
  const silent = net.createServer((socket) => { accepted.push(socket); socket.on('error', () => {}).resume(); });
  const closed = new Promise(resolve => silent.once('connection', socket => socket.once('close', resolve)));
  silent.listen(0, '127.0.0.1');
  await once(silent, 'listening');
  const agents = createWiflixProxyAgents(`http://127.0.0.1:${silent.address().port}`, { connectDeadlineMs: 100 });
  t.after(async () => {
    agents.destroy();
    for (const socket of accepted) socket.destroy();
    await new Promise(resolve => silent.close(resolve));
  });

  // Le délai d'axios (3 s) ne s'arme qu'une fois le socket remis : sans le
  // délai de connexion, cette requête resterait pendue.
  const started = Date.now();
  await assert.rejects(axios({
    url: 'https://flemmix.test/', proxy: false, timeout: 3000,
    httpAgent: agents.httpAgent, httpsAgent: agents.httpsAgent,
  }));
  assert.ok(Date.now() - started < 2000);
  // Le proxy voit la connexion se fermer : aucun socket orphelin.
  await closed;
});
