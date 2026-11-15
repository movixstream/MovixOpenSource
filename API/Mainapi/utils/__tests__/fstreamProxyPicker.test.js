'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const { once } = require('node:events');
const axios = require('axios');
const { HttpProxyAgent } = require('http-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { createProxyAgentPool } = require('../proxyAgentPool');
const { createFStreamProxyPicker, isFStreamProxyFault, isFStreamSocketReset } = require('../fstreamProxyPicker');
const { canonicalFStreamUrl } = require('../../config/fstream');
const { adoptFStreamChallengeCookie } = require('../fstreamChallenge');

// Hasard reproductible : les tirages du groupe sont les mêmes à chaque exécution.
function seeded(seed = 42) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}
const pool = count => Array.from({ length: count }, (_, i) => ({ host: `10.0.${i >> 8}.${i & 255}`, port: 1080, type: 'socks5' }));
const keyOf = entry => `${entry.type}:${entry.proxy.host}:${entry.proxy.port}`;

function picker({ list = pool(500), time = { now: 0 }, ...options } = {}) {
  return createFStreamProxyPicker({
    getPools: () => [{ list, type: 'socks5' }], size: 4, rotateMs: 1000,
    now: () => time.now, random: seeded(), ...options,
  });
}

test('le groupe garde 4 proxys sur 500 et les sert en tourniquet', () => {
  const group = picker();
  const used = Array.from({ length: 100 }, () => keyOf(group.next()));
  const counts = used.reduce((map, key) => map.set(key, (map.get(key) || 0) + 1), new Map());
  assert.equal(counts.size, 4);
  assert.deepEqual([...counts.values()], [25, 25, 25, 25]);
});

test('trois candidats distincts pour une requête et ses reprises', () => {
  const group = picker();
  const first = group.candidates(3).map(keyOf);
  const second = group.candidates(3).map(keyOf);
  assert.equal(new Set(first).size, 3);
  assert.equal(new Set(second).size, 3);
  assert.notEqual(first[0], second[0], 'le tourniquet avance d’une requête à l’autre');
});

test('chaque place est renouvelée après sa durée, avec des échéances étalées', () => {
  const time = { now: 0 };
  const group = picker({ time });
  const before = new Set(group.candidates(4).map(keyOf));
  time.now = 749;
  assert.deepEqual(new Set(group.candidates(4).map(keyOf)), before, 'aucune place ne tombe avant 0,75 × la durée');
  time.now = 1251;
  const after = new Set(group.candidates(4).map(keyOf));
  assert.equal(after.size, 4);
  assert.equal([...after].filter(key => before.has(key)).length, 0, 'toutes les places renouvelées après 1,25 × la durée');
});

test('un refus, une limite ou un délai écartent le proxy ; un 404 ou une socket fermée le gardent', () => {
  for (const error of [{ response: { status: 404 } }, { code: 'ECONNRESET' }, { code: 'EPIPE' }]) {
    const group = picker();
    const entry = group.next();
    entry.onFailure(error);
    assert.equal(group.size, 4, JSON.stringify(error));
    assert.ok(group.candidates(4).includes(entry));
  }
  for (const error of [{ response: { status: 429 } }, { response: { status: 403 } }, { response: { status: 407 } },
    { response: { status: 502 } }, { code: 'ECONNABORTED' }, { code: 'ETIMEDOUT' }, { code: 'ECONNREFUSED' }]) {
    const group = picker();
    const entry = group.next();
    entry.onFailure(error);
    const key = keyOf(entry);
    const later = Array.from({ length: 50 }, () => keyOf(group.next()));
    assert.ok(!later.includes(key), `${JSON.stringify(error)} : le proxy fautif ne revient pas`);
    assert.equal(group.size, 4, 'la place libérée est reprise par un autre proxy');
  }
  assert.equal(isFStreamProxyFault({ response: { status: 200 } }), false);
  assert.equal(isFStreamSocketReset({ code: 'ECONNRESET', response: { status: 502 } }), false);
});

test('un proxy au repos ne sert qu’à défaut d’autre : jamais d’accès direct imposé par le groupe', () => {
  const group = picker({ list: pool(1) });
  const entry = group.next();
  entry.onFailure({ code: 'ETIMEDOUT' });
  assert.equal(group.size, 0);
  assert.equal(keyOf(group.next()), keyOf(entry));
});

test('une IP donnée en SOCKS5 et en HTTP ne compte qu’une fois : groupe, plafond et repos', () => {
  const bothForms = ips => [
    { list: ips.map(proxy => ({ ...proxy, port: 1081 })), type: 'socks5' },
    { list: ips.map(proxy => ({ ...proxy, port: 3129, type: 'http' })), type: 'darkino' },
  ];
  const create = (ips, size) => createFStreamProxyPicker({
    getPools: () => bothForms(ips), size, rotateMs: 10 * 60_000, now: () => 0, random: seeded(),
  });

  const group = create(pool(3), 3);
  const hosts = group.candidates(3).map(entry => entry.proxy.host);
  assert.equal(new Set(hosts).size, 3, 'jamais les deux formes d’une même IP dans le groupe');
  const used = Array.from({ length: 61 }, () => group.nextSearch().proxy.host);
  const perIp = used.slice(0, 60).reduce((map, host) => map.set(host, (map.get(host) || 0) + 1), new Map());
  assert.deepEqual([...perIp.values()], [20, 20, 20]);
  assert.equal(group.size, 3, 'l’autre forme d’une IP au plafond ne rejoint pas le groupe');

  const resting = create(pool(4), 3);
  const limited = resting.next();
  limited.onFailure({ response: { status: 429 } });
  const later = Array.from({ length: 30 }, () => resting.next().proxy.host);
  assert.equal(resting.size, 3);
  assert.ok(!later.includes(limited.proxy.host), 'le 429 met l’IP au repos sous ses deux formes');
});

test('sans proxy configuré : aucun candidat, l’appel part en direct', () => {
  const group = picker({ list: [] });
  assert.equal(group.next(), null);
  assert.deepEqual(group.candidates(3), []);
});

test('le pool ProxyScrape rafraîchi sur place alimente les places suivantes', () => {
  const time = { now: 0 };
  const list = pool(10);
  const group = picker({ list, time });
  group.next();
  list.splice(0, list.length, ...pool(20).slice(10));
  time.now = 2000;
  const fresh = new Set(list.map(proxy => `socks5:${proxy.host}:${proxy.port}`));
  assert.ok(group.candidates(4).every(entry => fresh.has(keyOf(entry))));
});

test('recherches : 20 par minute et par proxy, puis un proxy de plus rejoint le groupe', () => {
  const time = { now: 0 };
  const group = picker({ time, rotateMs: 10 * 60_000 });
  const first = Array.from({ length: 80 }, () => keyOf(group.nextSearch()));
  const counts = first.reduce((map, key) => map.set(key, (map.get(key) || 0) + 1), new Map());
  assert.deepEqual([...counts.values()], [20, 20, 20, 20]);
  assert.equal(group.size, 4);

  const extra = keyOf(group.nextSearch());
  assert.ok(!counts.has(extra), 'la 81e recherche part sur un nouveau proxy');
  assert.equal(group.size, 5);

  // Les autres appels ne consomment pas le plafond de recherche.
  for (let i = 0; i < 50; i++) group.next();
  time.now = 30_000;
  for (let i = 0; i < 19; i++) assert.equal(keyOf(group.nextSearch()), extra);
  const sixth = keyOf(group.nextSearch());
  assert.ok(!counts.has(sixth) && sixth !== extra);
  assert.equal(group.size, 6);

  time.now = 60_001;
  const later = Array.from({ length: 20 }, () => keyOf(group.nextSearch()));
  assert.equal(new Set(later.filter(key => counts.has(key))).size, 4, 'une minute après, les premiers proxys reprennent');
  assert.equal(group.size, 6, 'aucun nouveau proxy tant qu’un plafond n’est pas atteint');
});

test('recherches : pool épuisé ou proxy au repos, le groupe ne s’agrandit pas', () => {
  const tight = picker({ list: pool(2), size: 2, rotateMs: 10 * 60_000 });
  const used = Array.from({ length: 41 }, () => keyOf(tight.nextSearch()));
  assert.equal(tight.size, 2, 'pool épuisé : pas de nouveau proxy');
  assert.equal(used[40], used[0], 'la 41e recherche va au proxy dont le plafond se libère le plus tôt');

  const resting = picker({ list: pool(3), size: 2, rotateMs: 10 * 60_000 });
  const members = resting.candidates(2);
  members[0].onFailure({ response: { status: 429 } });
  // La place libérée est reprise par le 3e proxy, puis le proxy limité reste au repos.
  resting.candidates(2);
  assert.equal(resting.size, 2);
  for (let i = 0; i < 40; i++) resting.nextSearch();
  assert.equal(resting.size, 2, 'le proxy au repos après son 429 ne rejoint pas le groupe');
  assert.ok(!resting.candidates(2).includes(members[0]));
});

// === Requêtes réelles : agents keep-alive de proxyManager, proxys HTTP locaux ===

function proxyFixture() {
  const filename = path.resolve(__dirname, '../proxyManager.js');
  const source = fs.readFileSync(filename, 'utf8');
  const fragment = (begin, end) => {
    const start = source.indexOf(begin), stop = source.indexOf(end, start);
    assert.ok(start > 0 && stop > start);
    return source.slice(start, stop);
  };
  const code = fragment('const fstreamAgentPool =', 'const fstreamAgentSweep =')
    + fragment('function normalizeProxyType(', 'function updateArrayInPlace(')
    + fragment('function acquireFStreamProxy(', '// Fonction utilitaire pour cr\\u00e9er un agent proxy SOCKS5');
  const context = vm.createContext({ HttpProxyAgent, HttpsProxyAgent, SocksProxyAgent, createProxyAgentPool });
  vm.runInContext(code + '\nglobalThis.api = { withFStreamProxy, acquireFStreamProxy, pool: fstreamAgentPool };', context, { filename });
  return context.api;
}

// axiosFStreamRequest réel, chemin proxy activé.
function requestFixture({ proxies, fstreamProxyPicker = null }) {
  const filename = path.resolve(__dirname, '../axiosHelpers.js');
  const source = fs.readFileSync(filename, 'utf8');
  const section = source.slice(source.indexOf('function withOptionalFStreamCookies('), source.indexOf('function isAnimeSamaRetriableError('));
  const context = vm.createContext({
    canonicalFStreamUrl, URL, console: { error() {}, log() {} }, ENABLE_FSTREAM_PROXY: true,
    PROXIES: [], DARKINO_PROXIES: proxies.entries, withFStreamProxy: proxies.agents.withFStreamProxy, isFStreamSocketReset,
    adoptFStreamChallengeCookie,
    deps: {
      FSTREAM_BASE_URL: 'http://fstream.test/', fstreamCookies: {}, fstreamProxyPicker,
      ensureFStreamSession: async () => {}, incrementFstreamRequestCounter() {},
      axiosFStream: axios.create({ baseURL: 'http://fstream.test/' }),
    },
  });
  vm.runInContext(`${section}\nthis.request = axiosFStreamRequest;`, context, { filename });
  return config => context.request({ method: 'get', url: 'http://fstream.test/films/', ...config });
}

async function localProxies(t, count, handler) {
  const servers = [];
  const state = { connections: 0 };
  // Une adresse de bouclage par proxy : le groupe distingue les proxys par IP.
  for (let index = 0; index < count; index++) {
    const server = http.createServer((req, res) => handler(index, req, res));
    server.on('connection', () => { state.connections++; });
    server.listen(0, `127.0.0.${index + 1}`);
    await once(server, 'listening');
    servers.push(server);
  }
  const agents = proxyFixture();
  t.after(async () => {
    agents.pool.clear();
    for (const server of servers) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
  return {
    state, agents,
    entries: servers.map(server => ({ host: server.address().address, port: server.address().port, type: 'http' })),
    groupPicker: (size, random = seeded()) => createFStreamProxyPicker({
      getPools: () => [{ list: servers.map(server => ({ host: server.address().address, port: server.address().port, type: 'http' })), type: 'darkino' }],
      size, rotateMs: 60_000, random,
    }),
  };
}

test('60 appels French-Stream sur 30 proxys : 2 connexions avec le groupe, une par proxy tiré sans lui', async t => {
  const proxies = await localProxies(t, 30, (index, _req, res) => res.end(`ok ${index}`));
  const grouped = requestFixture({ proxies, fstreamProxyPicker: proxies.groupPicker(2) });
  for (let i = 0; i < 60; i++) assert.match((await grouped()).data, /^ok \d+$/);
  const withGroup = proxies.state.connections;
  assert.equal(withGroup, 2);

  // Ancien comportement (un proxy au hasard à chaque appel), sur un pool d'agents neuf.
  const random = await localProxies(t, 30, (index, _req, res) => res.end(`ok ${index}`));
  const scattered = requestFixture({ proxies: random });
  for (let i = 0; i < 60; i++) await scattered();
  assert.ok(random.state.connections > 10, `${random.state.connections} connexions au hasard`);
  t.diagnostic(`60 appels : ${withGroup} connexions avec le groupe de 2, ${random.state.connections} au hasard sur 30 proxys`);
});

test('socket keep-alive coupée à sa reprise : un seul nouvel essai sur une connexion neuve, le proxy reste', async t => {
  const served = new WeakMap();
  let resets = 0;
  const proxies = await localProxies(t, 1, (_index, req, res) => {
    const count = (served.get(req.socket) || 0) + 1;
    served.set(req.socket, count);
    if (count === 2) { resets++; return req.socket.destroy(); }
    res.end('ok');
  });
  const group = proxies.groupPicker(1);
  const request = requestFixture({ proxies, fstreamProxyPicker: group });
  assert.equal((await request()).data, 'ok');
  assert.equal((await request()).data, 'ok', 'la coupure de la socket reprise est rattrapée');
  assert.equal(resets, 1, 'la deuxième requête a bien repris la socket keep-alive, coupée');
  assert.equal(proxies.state.connections, 2);
  assert.equal(group.size, 1, 'une socket fermée n’accuse pas le proxy');
});

test('60 recherches en rafale sur un groupe de 2 : jamais plus de 20 par proxy, les pages hors compte', async t => {
  const searches = new Map();
  const proxies = await localProxies(t, 10, (index, req, res) => {
    // Comme French-Stream : 429 au-delà de 22 recherches par minute et par IP.
    if (req.url.includes('/engine/ajax/search.php')) {
      searches.set(index, (searches.get(index) || 0) + 1);
      if (searches.get(index) > 22) res.statusCode = 429;
    }
    res.end(`proxy ${index}`);
  });
  const request = requestFixture({ proxies, fstreamProxyPicker: proxies.groupPicker(2) });
  for (let i = 0; i < 30; i++) await request();
  // Le choix du proxy ne dépend que de l'adresse : une recherche sans corps suffit ici.
  for (let i = 0; i < 60; i++) {
    const response = await request({ url: `http://fstream.test/engine/ajax/search.php?query=${i}` });
    assert.equal(response.status, 200);
  }
  assert.deepEqual([...searches.values()].sort(), [20, 20, 20]);
});

test('un 429 renvoyé par un proxy l’écarte du groupe sans détruire son agent', async t => {
  let blocked = null;
  const proxies = await localProxies(t, 2, (index, _req, res) => {
    blocked ??= index;
    res.statusCode = index === blocked ? 429 : 200;
    res.end(`proxy ${index}`);
  });
  const request = requestFixture({ proxies, fstreamProxyPicker: proxies.groupPicker(1) });
  await assert.rejects(request(), error => error.response?.status === 429);
  for (let i = 0; i < 10; i++) assert.equal((await request()).data, `proxy ${1 - blocked}`);

  const entry = { type: 'darkino', proxy: proxies.entries[0] };
  const kept = proxies.agents.acquireFStreamProxy(entry);
  kept.release();
  await assert.rejects(proxies.agents.withFStreamProxy(entry, async () => {
    throw Object.assign(new Error('Too Many Requests'), { response: { status: 429 } });
  }));
  const after = proxies.agents.acquireFStreamProxy(entry);
  after.release();
  assert.equal(after.httpAgent, kept.httpAgent, 'réponse HTTP : la connexion reste dans le pool');
  assert.equal(after.httpsAgent.options.timeout, 15000, 'les sockets libres HTTPS se ferment après 15 s d’inactivité');
});
