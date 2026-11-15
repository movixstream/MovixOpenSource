'use strict';

const test = require('node:test');
const { mock, beforeEach } = test;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const express = require('express');

// Journaux attendus pendant ces tests (replis des réglages, Redis en panne).
for (const level of ['log', 'warn', 'error']) {
  const original = console[level].bind(console);
  mock.method(console, level, (...args) => {
    if (String(args[0] ?? '').startsWith('[Pubs]')) return;
    original(...args);
  });
}

const settingsModule = require('../../utils/monetizationSettings');
const pickerModule = require('../../utils/monetizationPicker');
const statsModule = require('../../utils/monetizationStats');

const SAVED_AT = '2026-10-23T08:30:00.000Z';
const CHROME_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
// iPadOS en mode « site pour ordinateur » : il se présente comme un Mac.
const SAFARI_IPADOS = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const NO_STORE_302 = 'no-store, no-cache, must-revalidate, private';

beforeEach(() => {
  settingsModule.resetMonetizationSettingsCache();
});

// ---------------------------------------------------------------------------
// Faux Redis en mémoire : hashes, chaînes, pipeline() et journal des appels.
// ---------------------------------------------------------------------------

function createFakeRedis() {
  const hashes = new Map();
  const strings = new Map();
  const state = { pipelines: [], commands: [] };
  const ops = {
    hincrby(key, field, amount) {
      const hash = hashes.get(key) || new Map();
      hashes.set(key, hash);
      const next = (hash.get(field) || 0) + Number(amount);
      hash.set(field, next);
      return next;
    },
    expire: () => 1,
    hgetall(key) {
      const hash = hashes.get(key);
      return hash ? Object.fromEntries([...hash].map(([field, value]) => [field, String(value)])) : {};
    },
    get: (key) => (strings.has(key) ? strings.get(key) : null),
    incrby(key, amount) {
      const next = Number(strings.get(key) || 0) + Number(amount);
      strings.set(key, String(next));
      return next;
    },
    set(key, value, ...args) {
      if (args.includes('NX') && strings.has(key)) return null;
      strings.set(key, String(value));
      return 'OK';
    },
    // Même effet que le script du point de départ d'un geste (monetizationStats).
    eval(_script, _numKeys, gestureKey, sequenceKey) {
      if (strings.has(gestureKey)) return Number(strings.get(gestureKey));
      const counter = Number(strings.get(sequenceKey) || 0) + 1;
      strings.set(sequenceKey, String(counter));
      strings.set(gestureKey, String(counter - 1));
      return counter - 1;
    }
  };
  const redis = {
    pipeline() {
      const queued = [];
      const chain = {};
      for (const name of ['hincrby', 'expire', 'hgetall']) {
        chain[name] = (...args) => {
          queued.push([name, ...args]);
          return chain;
        };
      }
      chain.exec = async () => {
        state.pipelines.push(queued.map((command) => [...command]));
        return queued.map(([name, ...args]) => [null, ops[name](...args)]);
      };
      return chain;
    }
  };
  for (const name of ['get', 'incrby', 'set', 'eval']) {
    redis[name] = async (...args) => {
      state.commands.push(name === 'eval' ? [name, ...args.slice(2)] : [name, ...args]);
      return ops[name](...args);
    };
  }
  return { redis, state, hashes };
}

// ---------------------------------------------------------------------------
// Pool MySQL factice : une ligne monetization_settings et la table
// monetization_daily_stats en mémoire (clé `<jour>|<pub>|<emplacement>`).
// ---------------------------------------------------------------------------

function createSettingsPool({ settings = null } = {}) {
  const state = {
    row: settings
      ? { settings_json: JSON.stringify(settings), updated_by: 'admin-1', updated_at: new Date(SAVED_AT) }
      : null,
    selects: 0,
    writes: [],
    failSelect: null,
    statsRows: new Map(),
    statsQueries: [],
    failStats: null
  };

  function runStats(sql, params) {
    state.statsQueries.push({ sql, params: [...params] });
    if (state.failStats) throw state.failStats;
    if (/^\s*INSERT/i.test(sql)) {
      for (let index = 0; index < params.length; index += 4) {
        const [day, adId, placement, openings] = params.slice(index, index + 4);
        const key = `${day}|${adId}|${placement}`;
        state.statsRows.set(key, (state.statsRows.get(key) || 0) + openings);
      }
      return [{ affectedRows: params.length / 4 }, []];
    }
    if (/MIN\(day\)/.test(sql)) {
      const days = [...state.statsRows.keys()].map((key) => key.split('|')[0]).sort();
      return [[{ first_day: days[0] || null }], []];
    }
    if (/^\s*SELECT day, ad_id, placement, openings/.test(sql)) {
      const [from, to] = params;
      const rows = [];
      for (const [key, openings] of state.statsRows) {
        const [day, adId, placement] = key.split('|');
        if (day >= from && day <= to) rows.push({ day, ad_id: adId, placement, openings });
      }
      return [rows, []];
    }
    throw new Error(`Requête inattendue : ${sql}`);
  }

  async function run(sql, params = []) {
    if (/monetization_daily_stats/.test(sql)) return runStats(sql, params);
    if (/^\s*SELECT/i.test(sql)) {
      state.selects += 1;
      if (state.failSelect) throw state.failSelect;
      return [state.row ? [state.row] : [], []];
    }
    if (/^\s*INSERT/i.test(sql)) {
      state.writes.push(params);
      state.row = { settings_json: params[1], updated_by: params[2], updated_at: new Date(SAVED_AT) };
      return [{ affectedRows: 1 }, []];
    }
    throw new Error(`Requête inattendue : ${sql}`);
  }

  return { pool: { execute: run, query: run }, state };
}

function makeAd(id, overrides = {}) {
  return {
    id,
    name: `Régie ${id}`,
    url: `https://${id}.example/go`,
    enabled: true,
    placements: ['player'],
    audience: 'all',
    weight: 1,
    schedule: { startAt: null, endAt: null, days: [], hours: null },
    targeting: { devices: [], os: [], countriesMode: 'all', countries: [] },
    caps: { perVisitorPerDay: 0, globalPerDay: 0 },
    note: '',
    ...overrides
  };
}

function makeSettings({ ads = [], placements = {}, ...rest } = {}) {
  return settingsModule.validateSettingsInput(
    { ...rest, ads, placements },
    settingsModule.getDefaultMonetizationSettings()
  );
}

// ---------------------------------------------------------------------------
// Routeur réel chargé dans un vm, dépendances isolées.
// ---------------------------------------------------------------------------

function loadRouter({ pool, admin = true, redis = createFakeRedis().redis } = {}) {
  const filename = path.resolve(__dirname, '../monetization.js');
  let stats = null;
  const isAdmin = (req, res, next) => {
    if (!admin) {
      return res.status(403).json({ success: false, error: 'Accès refusé - Droits admin requis' });
    }
    req.admin = { userId: 'admin-42', userType: 'oauth', role: 'admin' };
    return next();
  };
  const dependencies = {
    'node:crypto': crypto,
    express,
    '../mysqlPool': { getPool: () => pool },
    '../middleware/auth': { isAdmin },
    '../config/redis': { redis },
    '../utils/monetizationSettings': settingsModule,
    '../utils/monetizationPicker': pickerModule,
    '../utils/monetizationStats': {
      ...statsModule,
      // Pas de minuterie pendant les tests : le flush est appelé à la main.
      createMonetizationStats: (options) => {
        stats = statsModule.createMonetizationStats({ ...options, flushIntervalMs: 0 });
        return stats;
      }
    }
  };
  const sandboxModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: sandboxModule,
    exports: sandboxModule.exports,
    Buffer,
    URL,
    Date,
    Set,
    Map,
    console: { log() {}, warn() {}, error() {} },
    require(name) {
      assert.ok(name in dependencies, `Dépendance non isolée : ${name}`);
      return dependencies[name];
    }
  }, { filename });
  assert.ok(stats, 'le routeur crée son instance de statistiques au chargement');
  return { router: sandboxModule.exports.router, isAdmin, stats };
}

async function callRoute(router, method, routePath, {
  body = {},
  query = {},
  params = {},
  headers = {},
  ip = '203.0.113.7',
  requestMethod = method.toUpperCase()
} = {}) {
  const layer = router.stack.find((entry) => entry.route?.path === routePath && entry.route.methods[method]);
  assert.ok(layer, `Route absente : ${method.toUpperCase()} ${routePath}`);
  const req = {
    method: requestMethod,
    body,
    query,
    params,
    headers: { 'user-agent': CHROME_WINDOWS, ...headers },
    ip,
    protocol: 'https',
    get(name) {
      return this.headers[String(name).toLowerCase()];
    }
  };
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
    set(name, value) {
      this.headers[String(name).toLowerCase()] = value;
      return this;
    },
    setHeader(name, value) {
      return this.set(name, value);
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      // Copie dans ce contexte : le module tourne dans un autre contexte vm.
      this.body = JSON.parse(JSON.stringify(payload));
      this.ended = true;
      return this;
    },
    send(payload) {
      this.body = payload;
      this.ended = true;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    }
  };
  for (const handlerLayer of layer.route.stack) {
    let proceed = false;
    await handlerLayer.handle(req, res, () => {
      proceed = true;
    });
    if (!proceed) break;
  }
  assert.ok(res.ended, 'la route a répondu');
  return { res, handlers: layer.route.stack.map((entry) => entry.handle) };
}

async function go(router, placement, { query = {}, headers = {}, ip } = {}) {
  const { res } = await callRoute(router, 'get', '/go/:placement', { params: { placement }, query, headers, ip });
  return res;
}

function readSetCookie(res) {
  const header = res.headers['set-cookie'];
  assert.equal(typeof header, 'string', 'Set-Cookie attendu');
  return header;
}

function decodeVisitorCookie(res) {
  const pair = readSetCookie(res).split(';')[0];
  assert.ok(pair.startsWith('mvx_go='));
  return JSON.parse(Buffer.from(pair.slice('mvx_go='.length), 'base64url').toString('utf8'));
}

function cookieFrom(res) {
  return readSetCookie(res).split(';')[0];
}

function isClosePage(res) {
  return res.statusCode === 200
    && typeof res.body === 'string'
    && res.body.includes('Tu peux fermer cet onglet.')
    && res.body.includes('window.close()');
}

function todayKey() {
  return pickerModule.getParisClock(new Date()).dateKey;
}

// Ouvertures enregistrées dans la fausse table, tous jours confondus.
async function flushedStats(stats, poolState) {
  await stats.flush();
  const counts = {};
  for (const [key, openings] of poolState.statsRows) {
    const field = key.split('|').slice(1).join('|');
    counts[field] = (counts[field] || 0) + openings;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// GET /go/:placement
// ---------------------------------------------------------------------------

test('GET /go/player redirige en 302 vers la pub avec Cache-Control no-store, référent d\'un lien normal, X-Robots-Tag et Set-Cookie mvx_go', async () => {
  const { pool } = createSettingsPool({ settings: makeSettings({ ads: [makeAd('regie1')] }) });
  const { router } = loadRouter({ pool });

  const res = await go(router, 'player');
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, 'https://regie1.example/go');
  assert.equal(res.headers['cache-control'], NO_STORE_302);
  assert.equal(res.headers.pragma, 'no-cache');
  assert.equal(res.headers.expires, '0');
  assert.equal(res.headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.equal(res.headers['x-robots-tag'], 'noindex, nofollow');

  const setCookie = readSetCookie(res);
  assert.match(setCookie, /^mvx_go=[A-Za-z0-9_-]+; Max-Age=2592000; Path=\/api\/go; HttpOnly; Secure; SameSite=Lax$/);
  const visitor = decodeVisitorCookie(res);
  assert.match(visitor.v, /^[0-9a-f]{16}$/);
  assert.equal(visitor.d, todayKey());
  assert.deepEqual(visitor.c, { regie1: 1 });
  assert.equal(typeof visitor.s, 'object');
});

test('un ancien réglage « referrer » stocké ne change plus rien : référent d\'un lien normal', async () => {
  const { pool } = createSettingsPool({ settings: makeSettings({ ads: [makeAd('regie1', { referrer: 'none' })] }) });
  const { router } = loadRouter({ pool });

  const res = await go(router, 'player');
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers['referrer-policy'], 'strict-origin-when-cross-origin');
});

test('Sec-Purpose: prefetch → 204, pas de stat, la séquence n\'avance pas', async () => {
  const { pool, state } = createSettingsPool({ settings: makeSettings({ ads: [makeAd('regiea'), makeAd('regieb')] }) });
  const { router, stats } = loadRouter({ pool });

  for (const headers of [{ 'sec-purpose': 'prefetch' }, { 'sec-purpose': 'prefetch;prerender' }, { purpose: 'prefetch' }]) {
    const res = await go(router, 'player', { headers });
    assert.equal(res.statusCode, 204);
    assert.equal(res.headers['set-cookie'], undefined);
    assert.equal(res.headers['cache-control'], NO_STORE_302);
  }
  // Un HEAD (vérificateur de liens) passe par la route GET mais ne compte pas.
  const { res: head } = await callRoute(router, 'get', '/go/:placement', {
    params: { placement: 'player' },
    requestMethod: 'HEAD'
  });
  assert.equal(head.statusCode, 204);

  const real = await go(router, 'player');
  assert.equal(real.statusCode, 302, 'contrôle : un vrai GET compte');
  assert.equal(real.headers.location, 'https://regiea.example/go', 'la séquence part toujours de A');
  assert.deepEqual(await flushedStats(stats, state), { 'regiea|player': 1 });
});

test('User-Agent Googlebot → 204 ; User-Agent vide → 204', async () => {
  const { pool, state } = createSettingsPool({ settings: makeSettings({ ads: [makeAd('regie1')] }) });
  const { router, stats } = loadRouter({ pool });

  assert.equal((await go(router, 'player', { headers: { 'user-agent': GOOGLEBOT } })).statusCode, 204);
  assert.equal((await go(router, 'player', { headers: { 'user-agent': '' } })).statusCode, 204);
  assert.deepEqual(await flushedStats(stats, state), {});
});

test('aucune pub éligible → 302 vers fallbackUrl ; sans fallbackUrl → page HTML qui se ferme ; stat none|player', async () => {
  const { redis } = createFakeRedis();
  const ads = [
    makeAd('regiebe', { targeting: { devices: [], os: [], countriesMode: 'include', countries: ['BE'] } }),
    makeAd('regiefin', { schedule: { startAt: null, endAt: '2020-01-01T00:00:00Z', days: [], hours: null } })
  ];
  const withFallback = createSettingsPool({
    settings: makeSettings({ ads, placements: { player: { fallbackUrl: 'https://secours.example/' } } })
  });
  const first = loadRouter({ pool: withFallback.pool, redis });

  const redirected = await go(first.router, 'player', { headers: { 'cf-ipcountry': 'FR' } });
  assert.equal(redirected.statusCode, 302);
  assert.equal(redirected.headers.location, 'https://secours.example/');
  assert.equal(redirected.headers['cache-control'], NO_STORE_302);
  assert.equal(redirected.headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.deepEqual(await flushedStats(first.stats, withFallback.state), { 'none|player': 1 });

  settingsModule.resetMonetizationSettingsCache();
  const withoutFallback = createSettingsPool({ settings: makeSettings({ ads }) });
  const second = loadRouter({ pool: withoutFallback.pool, redis });
  const closed = await go(second.router, 'player', { headers: { 'cf-ipcountry': 'FR' } });
  assert.ok(isClosePage(closed));
  assert.equal(closed.headers['cache-control'], 'no-store');
  assert.equal(closed.headers['x-robots-tag'], 'noindex, nofollow');
  assert.match(closed.headers['content-type'], /^text\/html/);
  assert.match(closed.body, /#0a0a0a/);
  assert.deepEqual(await flushedStats(second.stats, withoutFallback.state), { 'none|player': 1 });
});

test('emplacement inconnu ou pubs coupées → page qui se ferme', async () => {
  const { redis } = createFakeRedis();
  const ads = [makeAd('regie1', { placements: ['player', 'download'] })];

  const open = createSettingsPool({ settings: makeSettings({ ads }) });
  const openRouter = loadRouter({ pool: open.pool, redis });
  assert.ok(isClosePage(await go(openRouter.router, 'banniere')));

  settingsModule.resetMonetizationSettingsCache();
  const off = createSettingsPool({ settings: makeSettings({ ads, enabled: false }) });
  const offRouter = loadRouter({ pool: off.pool, redis });
  assert.ok(isClosePage(await go(offRouter.router, 'player')));

  settingsModule.resetMonetizationSettingsCache();
  const placementOff = createSettingsPool({ settings: makeSettings({ ads, placements: { player: { enabled: false } } }) });
  const placementRouter = loadRouter({ pool: placementOff.pool, redis });
  assert.ok(isClosePage(await go(placementRouter.router, 'player')));
  assert.equal((await go(placementRouter.router, 'download')).statusCode, 302, 'les autres emplacements tournent');

  settingsModule.resetMonetizationSettingsCache();
  const broken = createSettingsPool({ settings: makeSettings({ ads }) });
  broken.state.failSelect = new Error('MySQL indisponible');
  const brokenRouter = loadRouter({ pool: broken.pool, redis });
  assert.ok(isClosePage(await go(brokenRouter.router, 'player')), 'base en panne sans cache → page qui se ferme');

  assert.deepEqual(await flushedStats(openRouter.stats, open.state), {});
  assert.deepEqual(await flushedStats(offRouter.stats, off.state), {});
  assert.deepEqual(await flushedStats(placementRouter.stats, placementOff.state), { 'regie1|download': 1 });
});

test('sequence global A(1) B(1) : deux appels successifs → A puis B', async () => {
  const { redis, state } = createFakeRedis();
  const { pool } = createSettingsPool({ settings: makeSettings({ ads: [makeAd('regiea'), makeAd('regieb')] }) });
  const { router } = loadRouter({ pool, redis });

  const locations = [];
  for (let i = 0; i < 4; i += 1) {
    // Visiteurs différents (sans cookie) : la séquence est celle du site.
    locations.push((await go(router, 'player', { ip: `198.51.100.${i}` })).headers.location);
  }
  assert.deepEqual(locations, [
    'https://regiea.example/go',
    'https://regieb.example/go',
    'https://regiea.example/go',
    'https://regieb.example/go'
  ]);
  assert.equal(state.commands.length, 0, 'une fenêtre par clic : aucun appel Redis');
  assert.equal(state.pipelines.length, 0);
});

test('sequence global A(2) B(1) donne A A B A', async () => {
  const { pool } = createSettingsPool({ settings: makeSettings({ ads: [makeAd('regiea', { weight: 2 }), makeAd('regieb')] }) });
  const { router } = loadRouter({ pool });

  const names = [];
  for (let i = 0; i < 4; i += 1) names.push(new URL((await go(router, 'player')).headers.location).hostname);
  assert.deepEqual(names, ['regiea.example', 'regiea.example', 'regieb.example', 'regiea.example']);
});

test('sequence visitor : le cookie renvoyé fait avancer le visiteur', async () => {
  const { pool } = createSettingsPool({
    settings: makeSettings({
      ads: [makeAd('regiea'), makeAd('regieb'), makeAd('regiec')],
      placements: { player: { sequenceScope: 'visitor' } }
    })
  });
  const { router } = loadRouter({ pool });

  const first = await go(router, 'player');
  assert.equal(first.headers.location, 'https://regiea.example/go');
  assert.equal(decodeVisitorCookie(first).s.player, 1);

  const second = await go(router, 'player', { headers: { cookie: `theme=dark; ${cookieFrom(first)}` } });
  assert.equal(second.headers.location, 'https://regieb.example/go');
  const visitor = decodeVisitorCookie(second);
  assert.equal(visitor.s.player, 2);
  assert.equal(visitor.v, decodeVisitorCookie(first).v, 'le visiteur garde son identifiant');
  assert.deepEqual(visitor.c, { regiea: 1, regieb: 1 });

  // Un autre visiteur commence son propre cycle.
  assert.equal((await go(router, 'player')).headers.location, 'https://regiea.example/go');
  // Cookie illisible : nouveau visiteur, sans erreur.
  const garbage = await go(router, 'player', { headers: { cookie: 'mvx_go=%%%pas-du-base64' } });
  assert.equal(garbage.headers.location, 'https://regiea.example/go');
});

test('plafond par visiteur : le cookie du jour bloque la pub, un cookie de la veille non', async () => {
  const { pool } = createSettingsPool({
    settings: makeSettings({
      // A sort 3 fois sur 4 : seul le plafond peut lui faire céder la 2e case.
      ads: [makeAd('regiea', { weight: 3, caps: { perVisitorPerDay: 1, globalPerDay: 0 } }), makeAd('regieb')],
      placements: { player: { rotation: 'sequence' } }
    })
  });
  const { router } = loadRouter({ pool });

  const first = await go(router, 'player');
  assert.equal(first.headers.location, 'https://regiea.example/go');
  const second = await go(router, 'player', { headers: { cookie: cookieFrom(first) } });
  assert.equal(second.headers.location, 'https://regieb.example/go');

  const yesterday = { ...decodeVisitorCookie(second), d: '2000-01-01' };
  const oldCookie = `mvx_go=${Buffer.from(JSON.stringify(yesterday)).toString('base64url')}`;
  const nextDay = await go(router, 'player', { headers: { cookie: oldCookie } });
  assert.equal(nextDay.headers.location, 'https://regiea.example/go');
  assert.deepEqual(decodeVisitorCookie(nextDay).c, { regiea: 1 });
});

test('plafond global : compté en mémoire avant même le flush', async () => {
  const { pool } = createSettingsPool({
    settings: makeSettings({
      // A sort 3 fois sur 4 : la 3e case revient à B à cause du plafond.
      ads: [makeAd('regiea', { weight: 3, caps: { perVisitorPerDay: 0, globalPerDay: 2 } }), makeAd('regieb')],
      placements: { player: { rotation: 'sequence' } }
    })
  });
  const { router } = loadRouter({ pool });

  const hosts = [];
  for (let i = 0; i < 3; i += 1) hosts.push(new URL((await go(router, 'player')).headers.location).hostname);
  assert.deepEqual(hosts, ['regiea.example', 'regiea.example', 'regieb.example']);
});

test('sfw=1 n\'envoie jamais une pub adult', async () => {
  const { pool } = createSettingsPool({
    settings: makeSettings({
      ads: [makeAd('regieadult', { audience: 'adult' }), makeAd('regiesfw', { audience: 'sfw' })],
      placements: { player: { rotation: 'random' } }
    })
  });
  const { router } = loadRouter({ pool });

  for (let i = 0; i < 12; i += 1) {
    assert.equal((await go(router, 'player', { query: { sfw: '1' } })).headers.location, 'https://regiesfw.example/go');
  }
  assert.equal((await go(router, 'player')).headers.location, 'https://regieadult.example/go');
});

test('macros {placement} et {country} remplacées (en-tête cf-ipcountry)', async () => {
  const { pool } = createSettingsPool({
    settings: makeSettings({
      ads: [makeAd('regie1', {
        placements: ['download'],
        url: 'https://regie1.example/c?sub={placement}&geo={country}&v={visitor}&l={lang}&r={rand}&t={ts}'
      })]
    })
  });
  const { router } = loadRouter({ pool });

  const res = await go(router, 'download', { headers: { 'cf-ipcountry': 'fr' }, query: { lang: 'EN' } });
  const location = new URL(res.headers.location);
  assert.equal(location.searchParams.get('sub'), 'download');
  assert.equal(location.searchParams.get('geo'), 'FR');
  assert.equal(location.searchParams.get('v'), decodeVisitorCookie(res).v);
  assert.equal(location.searchParams.get('l'), 'en');
  assert.match(location.searchParams.get('r'), /^[0-9a-f]+$/);
  assert.match(location.searchParams.get('t'), /^\d{13}$/);

  // Pays inconnu pour Cloudflare (XX) ou Tor (T1) : macro vide.
  for (const country of ['XX', 'T1']) {
    const unknown = await go(router, 'download', { headers: { 'cf-ipcountry': country } });
    assert.equal(new URL(unknown.headers.location).searchParams.get('geo'), '');
  }
});

test('appareil : d=mobile sur un User-Agent de Mac (iPadOS) → tablette iOS', async () => {
  const { pool } = createSettingsPool({
    settings: makeSettings({ ads: [makeAd('regie1', { url: 'https://regie1.example/?d={device}&o={os}' })] })
  });
  const { router } = loadRouter({ pool });
  const read = async (userAgent, d) => {
    const res = await go(router, 'player', { headers: { 'user-agent': userAgent }, query: d ? { d } : {} });
    const location = new URL(res.headers.location);
    return `${location.searchParams.get('d')}/${location.searchParams.get('o')}`;
  };

  assert.equal(await read(SAFARI_IPADOS, 'mobile'), 'tablet/ios');
  assert.equal(await read(SAFARI_IPADOS), 'desktop/mac');
  assert.equal(await read(CHROME_ANDROID, 'mobile'), 'mobile/android');
  assert.equal(await read(CHROME_ANDROID, 'desktop'), 'desktop/android');
  assert.equal(await read(CHROME_WINDOWS, 'tablette'), 'desktop/windows', 'valeur inconnue ignorée');
});

test('31e ouverture de la même IP dans la minute → page qui se ferme', async () => {
  const { pool, state } = createSettingsPool({ settings: makeSettings({ ads: [makeAd('regie1')] }) });
  const { router, stats } = loadRouter({ pool });
  const headers = { 'cf-connecting-ip': '192.0.2.10', 'x-forwarded-for': '10.0.0.1' };

  for (let i = 0; i < 30; i += 1) {
    assert.equal((await go(router, 'player', { headers })).statusCode, 302);
  }
  const blocked = await go(router, 'player', { headers });
  assert.ok(isClosePage(blocked));
  assert.equal(blocked.headers['set-cookie'], undefined);

  // Autre IP (x-forwarded-for puis req.ip) : non concernée.
  assert.equal((await go(router, 'player', { headers: { 'x-forwarded-for': '192.0.2.11, 10.0.0.1' } })).statusCode, 302);
  assert.equal((await go(router, 'player', { ip: '192.0.2.12' })).statusCode, 302);
  assert.deepEqual(await flushedStats(stats, state), { 'regie1|player': 32 });
});

test('plusieurs fenêtres en sequence global : même point de départ via Redis, pubs différentes', async () => {
  const { redis, state } = createFakeRedis();
  const { pool } = createSettingsPool({
    settings: makeSettings({
      ads: [makeAd('regiea'), makeAd('regieb'), makeAd('regiec')],
      placements: { player: { windowsPerClick: 2 } }
    })
  });
  const { router } = loadRouter({ pool, redis });
  const open = async (gesture, w) => (await go(router, 'player', { query: { g: gesture, w: String(w), n: '2' } })).headers.location;

  assert.deepEqual([await open('geste00001', 0), await open('geste00001', 1)], [
    'https://regiea.example/go',
    'https://regieb.example/go'
  ]);
  // Le cycle n'avance que d'un cran par geste : la 1re fenêtre (la seule que
  // le navigateur laisse souvent passer) voit A, puis B, puis C.
  assert.deepEqual([await open('geste00002', 1), await open('geste00002', 0)], [
    'https://regiec.example/go',
    'https://regieb.example/go'
  ]);
  assert.equal(await open('geste00003', 0), 'https://regiec.example/go');
  assert.equal(state.commands.filter(([name]) => name === 'eval').length, 3, 'un script Redis par geste');
});

test('fenêtre en trop (pas assez de pubs, ou au-delà de windowsPerClick) → page qui se ferme sans stat', async () => {
  const { pool, state } = createSettingsPool({
    settings: makeSettings({ ads: [makeAd('regiea')], placements: { player: { windowsPerClick: 2 } } })
  });
  const { router, stats } = loadRouter({ pool });

  assert.equal((await go(router, 'player', { query: { g: 'gesteseul1', w: '0', n: '2' } })).statusCode, 302);
  assert.ok(isClosePage(await go(router, 'player', { query: { g: 'gesteseul1', w: '1', n: '2' } })));
  // Le site a encore l'ancienne config (3 fenêtres) : la 3e se ferme.
  assert.ok(isClosePage(await go(router, 'player', { query: { g: 'gestetrois', w: '2', n: '3' } })));
  assert.deepEqual(await flushedStats(stats, state), { 'regiea|player': 1 });
});

test('plusieurs fenêtres en sequence visitor : toutes partent du même cran du cookie', async () => {
  const { redis, state } = createFakeRedis();
  const { pool } = createSettingsPool({
    settings: makeSettings({
      ads: [makeAd('regiea'), makeAd('regieb'), makeAd('regiec')],
      placements: { player: { sequenceScope: 'visitor', windowsPerClick: 2 } }
    })
  });
  const { router } = loadRouter({ pool, redis });

  const w0 = await go(router, 'player', { query: { g: 'gestevisit', w: '0', n: '2' } });
  // La 2e fenêtre arrive avec le cookie déjà mis à jour par la 1re.
  const w1 = await go(router, 'player', { query: { g: 'gestevisit', w: '1', n: '2' }, headers: { cookie: cookieFrom(w0) } });
  assert.equal(w0.headers.location, 'https://regiea.example/go');
  assert.equal(w1.headers.location, 'https://regieb.example/go');
  assert.equal(decodeVisitorCookie(w1).s.player, 1, 'le geste avance le cycle d\'un cran, pas de 2');

  const next = await go(router, 'player', { query: { g: 'gestesuite', w: '0', n: '2' }, headers: { cookie: cookieFrom(w1) } });
  assert.equal(next.headers.location, 'https://regieb.example/go');
  assert.equal(state.commands.length, 0, 'portée visitor : pas de Redis');
});

test('stats : 3 ouvertures → au flush, 1 INSERT MySQL et 1 pipeline Redis pour le plafond seul', async () => {
  const { redis, state } = createFakeRedis();
  const { pool, state: poolState } = createSettingsPool({ settings: makeSettings({ ads: [makeAd('regie1')] }) });
  const { router, stats } = loadRouter({ pool, redis });

  for (let i = 0; i < 3; i += 1) assert.equal((await go(router, 'player')).statusCode, 302);
  assert.equal(state.pipelines.length, 0);
  assert.equal(state.commands.length, 0);
  assert.equal(poolState.statsQueries.length, 0, 'aucune requête MySQL au clic');

  await stats.flush();
  const date = todayKey();
  assert.equal(state.pipelines.length, 1);
  assert.deepEqual(state.pipelines[0], [
    ['hincrby', `go:cap:${date}`, 'regie1', 3],
    ['expire', `go:cap:${date}`, statsModule.CAP_TTL_SECONDS]
  ]);
  assert.equal(poolState.statsQueries.length, 1);
  assert.match(poolState.statsQueries[0].sql, /^INSERT INTO monetization_daily_stats .* ON DUPLICATE KEY UPDATE openings = openings \+ VALUES\(openings\)$/);
  assert.deepEqual(poolState.statsQueries[0].params, [date, 'regie1', 'player', 3]);
});

test('les réglages sont lus une fois puis servis depuis la mémoire du worker', async () => {
  const { pool, state } = createSettingsPool({ settings: makeSettings({ ads: [makeAd('regie1')] }) });
  const { router } = loadRouter({ pool });

  for (let i = 0; i < 5; i += 1) await go(router, 'player');
  await callRoute(router, 'get', '/go-settings');
  assert.equal(state.selects, 1);
});

// ---------------------------------------------------------------------------
// GET /go-settings
// ---------------------------------------------------------------------------

test('GET /go-settings : Cache-Control public, max-age=60, aucune URL', async () => {
  const { pool } = createSettingsPool({
    settings: makeSettings({
      ads: [
        makeAd('regiea', { audience: 'adult', placements: ['player', 'download'] }),
        makeAd('regieb', { audience: 'sfw' })
      ],
      placements: { player: { windowsPerClick: 2, fallbackUrl: 'https://secours.example/' } }
    })
  });
  const { router } = loadRouter({ pool });

  const { res } = await callRoute(router, 'get', '/go-settings');
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'public, max-age=60');
  assert.equal(res.body.success, true);
  assert.equal(res.body.enabled, true);
  assert.equal(res.body.adultDefault, true);
  assert.equal(res.body.updatedAt, SAVED_AT);
  assert.deepEqual(res.body.placements.player, { active: true, adultCount: 1, sfwCount: 1, windowsPerClick: 2 });
  assert.deepEqual(res.body.placements.download, { active: true, adultCount: 1, sfwCount: 0, windowsPerClick: 1 });
  assert.equal(res.body.placements.livetv.active, false);
  assert.doesNotMatch(JSON.stringify(res.body), /https?:|regie/);
});

test('GET /go-settings répond 503 sans cache si la base échoue (le site garde sa config)', async () => {
  const { pool, state } = createSettingsPool();
  state.failSelect = new Error('MySQL indisponible');
  const { router } = loadRouter({ pool });

  const { res } = await callRoute(router, 'get', '/go-settings');
  assert.equal(res.statusCode, 503);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.body.success, false);
  assert.equal(Object.hasOwn(res.body, 'placements'), false);
});

test('une même IP ne compte que 20 ouvertures par jour dans le plafond global', async () => {
  const { pool, state } = createSettingsPool({
    settings: makeSettings({ ads: [makeAd('regiea', { caps: { perVisitorPerDay: 0, globalPerDay: 25 } })] })
  });
  const { redis, state: redisState } = createFakeRedis();
  const { router, stats } = loadRouter({ pool, redis });

  // 26 ouvertures servies, mais seules 20 entament le plafond : une seule IP
  // ne peut pas couper la pub pour tout le monde.
  for (let i = 0; i < 26; i += 1) {
    assert.equal((await go(router, 'player', { ip: '198.51.100.21' })).statusCode, 302);
  }
  assert.equal(stats.getGlobalCounts(todayKey()).regiea, 20);
  // Une autre IP compte de nouveau ; les stats, elles, gardent tout.
  assert.equal((await go(router, 'player', { ip: '198.51.100.22' })).statusCode, 302);
  assert.equal(stats.getGlobalCounts(todayKey()).regiea, 21);
  assert.deepEqual(await flushedStats(stats, state), { 'regiea|player': 27 });
  assert.deepEqual(redisState.pipelines.at(-1)[0], ['hincrby', `go:cap:${todayKey()}`, 'regiea', 21]);
  assert.equal(state.selects, 1);
});

// ---------------------------------------------------------------------------
// Routes admin
// ---------------------------------------------------------------------------

const ADMIN_ROUTES = [
  ['get', '/admin/monetization'],
  ['put', '/admin/monetization'],
  ['post', '/admin/monetization/preview'],
  ['get', '/admin/monetization/stats']
];

test('admin : 403 sans droits, sur toutes les routes, sans toucher à la base ni à Redis', async () => {
  const { redis, state: redisState } = createFakeRedis();
  const { pool, state } = createSettingsPool({ settings: makeSettings() });
  const { router, isAdmin } = loadRouter({ pool, admin: false, redis });

  for (const [method, routePath] of ADMIN_ROUTES) {
    const { res, handlers } = await callRoute(router, method, routePath, { body: { settings: {} } });
    assert.ok(handlers.includes(isAdmin), `${method.toUpperCase()} ${routePath} sans isAdmin`);
    assert.equal(res.statusCode, 403);
    assert.equal(res.headers['cache-control'], 'no-store');
  }
  assert.equal(state.selects, 0);
  assert.equal(state.writes.length, 0);
  assert.equal(state.statsQueries.length, 0);
  assert.equal(redisState.pipelines.length, 0);
});

test('GET /admin/monetization relit la base (fresh) et expose l\'auteur ; 500 si la base échoue', async () => {
  const settings = makeSettings({ ads: [makeAd('regie1')] });
  const { pool, state } = createSettingsPool({ settings });
  const { router } = loadRouter({ pool });

  await callRoute(router, 'get', '/go-settings');
  const { res } = await callRoute(router, 'get', '/admin/monetization');
  assert.equal(state.selects, 2, 'lecture fraîche malgré le cache');
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(res.body, {
    success: true,
    settings: JSON.parse(JSON.stringify(settings)),
    updatedAt: SAVED_AT,
    updatedBy: 'admin-1'
  });

  state.failSelect = new Error('MySQL indisponible');
  const failed = await callRoute(router, 'get', '/admin/monetization');
  assert.equal(failed.res.statusCode, 500);
  assert.equal(failed.res.body.success, false);
});

test('PUT /admin/monetization invalide → 400 et rien écrit', async () => {
  const { pool, state } = createSettingsPool({ settings: makeSettings() });
  const { router } = loadRouter({ pool });

  const { res } = await callRoute(router, 'put', '/admin/monetization', {
    body: { settings: { ads: [makeAd('regie1', { url: 'ftp://regie.example/' })] } }
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.match(res.body.error, /Pub « Régie regie1 » : URL invalide/);
  assert.equal(state.writes.length, 0);

  const missing = await callRoute(router, 'put', '/admin/monetization', { body: {} });
  assert.equal(missing.res.statusCode, 400);
  assert.equal(state.writes.length, 0);
});

test('PUT /admin/monetization valide → enregistré par l\'admin puis relu', async () => {
  const { pool, state } = createSettingsPool({ settings: makeSettings() });
  const { router } = loadRouter({ pool });
  const draft = { ...makeAd('x'), id: undefined, name: 'Nouvelle régie' };
  delete draft.id;

  const { res } = await callRoute(router, 'put', '/admin/monetization', {
    body: { settings: { adultDefault: false, ads: [draft] } }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(state.writes.length, 1);
  assert.equal(state.writes[0][2], 'admin-42');
  assert.equal(res.body.success, true);
  assert.equal(res.body.updatedBy, 'admin-42');
  assert.equal(res.body.settings.adultDefault, false);
  assert.match(res.body.settings.ads[0].id, /^[0-9a-f]{10}$/);

  const reread = await callRoute(router, 'get', '/admin/monetization');
  assert.deepEqual(reread.res.body.settings, res.body.settings);
  // Le worker qui enregistre sert tout de suite la nouvelle pub.
  assert.equal((await go(router, 'player')).headers.location, 'https://x.example/go');
});

test('POST /admin/monetization/preview rend 12 ouvertures du brouillon, sans toucher aux compteurs', async () => {
  const { redis, state: redisState } = createFakeRedis();
  const { pool, state } = createSettingsPool({ settings: makeSettings({ ads: [makeAd('enbase')] }) });
  const { router, stats } = loadRouter({ pool, redis });

  const { res } = await callRoute(router, 'post', '/admin/monetization/preview', {
    body: {
      settings: { ads: [makeAd('regiea', { weight: 2 }), makeAd('regieb')] },
      placement: 'player',
      profile: { sfw: false, device: 'desktop', country: 'FR' }
    }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.body.success, true);
  assert.equal(res.body.openings.length, 12);
  assert.deepEqual(
    res.body.openings.slice(0, 6).map((opening) => opening.adId),
    ['regiea', 'regiea', 'regieb', 'regiea', 'regiea', 'regieb']
  );
  assert.equal(res.body.openings[0].name, 'Régie regiea');
  assert.equal(state.writes.length, 0);
  assert.deepEqual(await flushedStats(stats, state), {});
  assert.equal(redisState.pipelines.length, 0);
  assert.equal((await go(router, 'player')).headers.location, 'https://enbase.example/go', 'la vraie séquence n\'a pas bougé');

  const count = await callRoute(router, 'post', '/admin/monetization/preview', {
    body: { settings: { ads: [makeAd('regiea')] }, placement: 'player', count: 99 }
  });
  assert.equal(count.res.body.openings.length, 30, 'au plus 30 ouvertures');
});

test('POST /admin/monetization/preview refuse un emplacement inconnu ou un brouillon invalide (400)', async () => {
  const { pool } = createSettingsPool({ settings: makeSettings() });
  const { router } = loadRouter({ pool });

  const unknown = await callRoute(router, 'post', '/admin/monetization/preview', {
    body: { settings: {}, placement: 'banniere' }
  });
  assert.equal(unknown.res.statusCode, 400);
  assert.equal(unknown.res.body.success, false);

  const invalid = await callRoute(router, 'post', '/admin/monetization/preview', {
    body: { settings: { ads: [makeAd('regie1', { weight: 0 })] }, placement: 'player' }
  });
  assert.equal(invalid.res.statusCode, 400);
  assert.match(invalid.res.body.error, /poids/);
});

const STATS_ROUTE = '/admin/monetization/stats';
const { shiftDateKey } = statsModule;

async function readStatsRoute(router, query) {
  return (await callRoute(router, 'get', STATS_ROUTE, { query })).res;
}

test('GET /admin/monetization/stats lit MySQL entre from et to : chaque jour, today et firstDate', async () => {
  const { redis, state: redisState } = createFakeRedis();
  const { pool, state } = createSettingsPool({ settings: makeSettings({ ads: [makeAd('regie1')] }) });
  state.statsRows.set('2026-09-30|regie1|player', 4);
  state.statsRows.set('2026-10-02|none|player', 2);
  state.statsRows.set('2026-03-14|regie1|download', 1);
  const { router } = loadRouter({ pool, redis });

  const res = await readStatsRoute(router, { from: '2026-09-29', to: '2026-10-02' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(res.body, {
    success: true,
    from: '2026-09-29',
    to: '2026-10-02',
    today: todayKey(),
    firstDate: '2026-03-14',
    days: [
      { date: '2026-09-29', counts: {} },
      { date: '2026-09-30', counts: { 'regie1|player': 4 } },
      { date: '2026-10-01', counts: {} },
      { date: '2026-10-02', counts: { 'none|player': 2 } }
    ]
  });
  assert.equal(redisState.pipelines.length, 0, 'la lecture ne touche pas Redis');
});

test('GET /admin/monetization/stats envoie les ouvertures en attente du worker avant de lire', async () => {
  const { pool } = createSettingsPool({ settings: makeSettings({ ads: [makeAd('regie1')] }) });
  const { router } = loadRouter({ pool });
  await go(router, 'player');

  const date = todayKey();
  const res = await readStatsRoute(router, { from: date, to: date });
  assert.deepEqual(res.body.days, [{ date, counts: { 'regie1|player': 1 } }]);
  assert.equal(res.body.firstDate, date);
});

test('GET /admin/monetization/stats : sans période, les 30 derniers jours jusqu\'à aujourd\'hui (Paris)', async () => {
  const { pool } = createSettingsPool({ settings: makeSettings() });
  const { router } = loadRouter({ pool });
  const today = todayKey();

  const res = await readStatsRoute(router, {});
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.to, today);
  assert.equal(res.body.today, today);
  assert.equal(res.body.from, shiftDateKey(today, -29));
  assert.equal(res.body.firstDate, null);
  assert.equal(res.body.days.length, 30);
  assert.equal(res.body.days[0].date, res.body.from);
  assert.equal(res.body.days.at(-1).date, today);

  // Une seule borne : l'autre prend sa valeur par défaut.
  const onlyTo = await readStatsRoute(router, { to: '2026-03-31' });
  assert.equal(onlyTo.body.from, '2026-03-02');
  assert.equal(onlyTo.body.days.length, 30);
  const onlyFrom = await readStatsRoute(router, { from: shiftDateKey(today, -6) });
  assert.equal(onlyFrom.body.to, today);
  assert.equal(onlyFrom.body.days.length, 7);
});

test('GET /admin/monetization/stats : l\'ancien ?days=N reste accepté sans from/to, borné à 1..60', async () => {
  const { pool } = createSettingsPool({ settings: makeSettings() });
  const { router } = loadRouter({ pool });
  const today = todayKey();

  const two = await readStatsRoute(router, { days: '2' });
  assert.equal(two.body.from, shiftDateKey(today, -1));
  assert.equal(two.body.to, today);
  assert.equal(two.body.days.length, 2);
  assert.equal((await readStatsRoute(router, { days: '500' })).body.days.length, 60);
  assert.equal((await readStatsRoute(router, { days: '0' })).body.days.length, 1);
  assert.equal((await readStatsRoute(router, { days: 'abc' })).body.days.length, 30);
  // from/to présents : days est ignoré.
  assert.equal((await readStatsRoute(router, { days: '2', from: '2026-01-01', to: '2026-01-10' })).body.days.length, 10);
});

test('GET /admin/monetization/stats → 400 pour une date illisible, à l\'envers ou une période trop longue', async () => {
  const { pool, state } = createSettingsPool({ settings: makeSettings() });
  const { router } = loadRouter({ pool });

  for (const query of [
    { from: 'hier' },
    { from: '2026-02-30', to: '2026-03-10' },
    { to: '2026-13-01' },
    { from: '2026-1-5', to: '2026-01-10' },
    { from: ['2026-01-01', '2026-01-02'] },
    { from: '2026-10-24', to: '2026-10-23' },
    { from: '2023-01-01', to: shiftDateKey('2023-01-01', 1101) }
  ]) {
    const res = await readStatsRoute(router, query);
    assert.equal(res.statusCode, 400, JSON.stringify(query));
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.body.success, false);
    assert.equal(typeof res.body.error, 'string');
    assert.match(res.body.error, /[éèà]|jours|date/i, 'message en français');
  }
  assert.equal(state.statsQueries.length, 0, 'rien n\'est lu pour une période refusée');

  // 1 100 jours d'écart : la limite est encore acceptée.
  const longest = await readStatsRoute(router, { from: '2023-01-01', to: shiftDateKey('2023-01-01', 1100) });
  assert.equal(longest.statusCode, 200);
  assert.equal(longest.body.days.length, 1101);
});

test('GET /admin/monetization/stats → 500 si MySQL est en panne', async () => {
  const { pool, state } = createSettingsPool({ settings: makeSettings() });
  state.failStats = new Error('MySQL indisponible');
  const { router } = loadRouter({ pool });

  const res = await readStatsRoute(router, {});
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.success, false);
});
