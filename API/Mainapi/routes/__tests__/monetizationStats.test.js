'use strict';

const test = require('node:test');
const { mock } = test;
const assert = require('node:assert/strict');

// Avertissements attendus quand le faux Redis ou la fausse base sont en panne.
for (const level of ['log', 'warn', 'error']) {
  const original = console[level].bind(console);
  mock.method(console, level, (...args) => {
    if (String(args[0] ?? '').startsWith('[Pubs]')) return;
    original(...args);
  });
}

const {
  createMonetizationStats,
  ensureMonetizationDailyStatsTable,
  importLegacyRedisStats,
  getParisDateKey,
  shiftDateKey,
  isDateKey,
  CAP_TTL_SECONDS,
  GESTURE_TTL_SECONDS,
  LEGACY_IMPORT_FLAG_KEY,
  LEGACY_IMPORT_DAYS,
  MAX_PENDING_STATS_FIELDS,
  MAX_ROWS_PER_INSERT,
  MAX_STATS_SPAN_DAYS
} = require('../../utils/monetizationStats');
const { getTable, renderCreateTable } = require('../../db/schema');
const { planSchema } = require('../../db/schemaPlanner');
const {
  loadSchemaMetadata,
  LOWER_CASE_TABLE_NAMES_SQL,
  TABLES_SQL,
  COLUMNS_SQL,
  INDEXES_SQL,
  FOREIGN_KEYS_SQL
} = require('../../db/schemaMetadata');

// 2026-10-23 12:00 à Paris (UTC+2 en heure d'été).
const NOON_PARIS = new Date('2026-10-23T10:00:00Z');

const SELECT_SQL = 'SELECT day, ad_id, placement, openings FROM monetization_daily_stats WHERE day BETWEEN ? AND ?';
const FIRST_DAY_SQL = 'SELECT MIN(day) AS first_day FROM monetization_daily_stats';

function upsertSql(rowCount) {
  return 'INSERT INTO monetization_daily_stats (day, ad_id, placement, openings) VALUES '
    + new Array(rowCount).fill('(?, ?, ?, ?)').join(', ')
    + ' ON DUPLICATE KEY UPDATE openings = openings + VALUES(openings)';
}

function warnings(pattern) {
  return console.warn.mock.calls.filter((call) => pattern.test(String(call.arguments[0] ?? '')));
}

// ---------------------------------------------------------------------------
// Faux Redis en mémoire : hashes, chaînes, pipeline() et journal des appels.
// ---------------------------------------------------------------------------

function createFakeRedis() {
  const hashes = new Map();
  const strings = new Map();
  const ttls = new Map();
  const state = { pipelines: [], commands: [], failPipeline: false, failCommands: false };

  const ops = {
    hincrby(key, field, amount) {
      const hash = hashes.get(key) || new Map();
      hashes.set(key, hash);
      const next = (hash.get(field) || 0) + Number(amount);
      hash.set(field, next);
      return next;
    },
    expire(key, seconds) {
      ttls.set(key, Number(seconds));
      return 1;
    },
    hgetall(key) {
      const hash = hashes.get(key);
      return hash ? Object.fromEntries([...hash].map(([field, value]) => [field, String(value)])) : {};
    },
    get(key) {
      return strings.has(key) ? strings.get(key) : null;
    },
    incrby(key, amount) {
      const next = Number(strings.get(key) || 0) + Number(amount);
      strings.set(key, String(next));
      return next;
    },
    set(key, value, ...args) {
      if (args.includes('NX') && strings.has(key)) return null;
      strings.set(key, String(value));
      const exIndex = args.indexOf('EX');
      if (exIndex >= 0) ttls.set(key, Number(args[exIndex + 1]));
      return 'OK';
    },
    del(key) {
      const existed = strings.delete(key) || hashes.delete(key);
      ttls.delete(key);
      return existed ? 1 : 0;
    },
    // Même effet que GESTURE_BASE_SCRIPT, d'un bloc comme dans Redis.
    eval(_script, _numKeys, gestureKey, sequenceKey, ttl) {
      if (strings.has(gestureKey)) return Number(strings.get(gestureKey));
      const counter = Number(strings.get(sequenceKey) || 0) + 1;
      strings.set(sequenceKey, String(counter));
      strings.set(gestureKey, String(counter - 1));
      ttls.set(gestureKey, Number(ttl));
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
        if (state.failPipeline) throw new Error('Redis indisponible');
        return queued.map(([name, ...args]) => [null, ops[name](...args)]);
      };
      return chain;
    }
  };
  for (const name of ['get', 'incrby', 'set', 'del', 'eval']) {
    redis[name] = async (...args) => {
      // Le texte du script n'aide pas à lire le journal : on garde clés et TTL.
      state.commands.push(name === 'eval' ? [name, ...args.slice(2)] : [name, ...args]);
      if (state.failCommands) throw new Error('Redis indisponible');
      return ops[name](...args);
    };
  }

  return { redis, state, hashes, strings, ttls };
}

// ---------------------------------------------------------------------------
// Fausse base MySQL : table monetization_daily_stats en mémoire.
// `dayAs: 'date'` imite mysql2 par défaut (DATE → Date à minuit, heure
// locale) ; `dayAs: 'string'` imite l'option dateStrings.
// ---------------------------------------------------------------------------

function createFakePool({ dayAs = 'date' } = {}) {
  // Clé `<jour>|<pub>|<emplacement>` → ouvertures.
  const rows = new Map();
  const state = { queries: [], ddl: [], inserts: 0, failInserts: new Set(), failAllInserts: false, failReads: false };

  function toDay(day) {
    if (dayAs === 'string') return day;
    const [year, month, date] = day.split('-').map(Number);
    return new Date(year, month - 1, date);
  }

  async function run(sql, params = []) {
    state.queries.push({ sql, params: [...params] });
    if (/^\s*CREATE TABLE/i.test(sql)) {
      state.ddl.push(sql);
      return [{}, []];
    }
    if (/^INSERT INTO monetization_daily_stats/.test(sql)) {
      state.inserts += 1;
      if (state.failAllInserts || state.failInserts.has(state.inserts)) throw new Error('MySQL indisponible');
      assert.equal(params.length % 4, 0);
      assert.equal(sql, upsertSql(params.length / 4));
      for (let index = 0; index < params.length; index += 4) {
        const [day, adId, placement, openings] = params.slice(index, index + 4);
        assert.ok(isDateKey(day), `jour envoyé tel quel : ${day}`);
        assert.ok(Number.isSafeInteger(openings) && openings > 0);
        const key = `${day}|${adId}|${placement}`;
        rows.set(key, (rows.get(key) || 0) + openings);
      }
      return [{ affectedRows: params.length / 4 }, []];
    }
    if (sql === SELECT_SQL) {
      if (state.failReads) throw new Error('MySQL indisponible');
      const [from, to] = params;
      const found = [];
      for (const [key, openings] of rows) {
        const [day, adId, placement] = key.split('|');
        if (day >= from && day <= to) found.push({ day: toDay(day), ad_id: adId, placement, openings });
      }
      return [found, []];
    }
    if (sql === FIRST_DAY_SQL) {
      if (state.failReads) throw new Error('MySQL indisponible');
      const days = [...rows.keys()].map((key) => key.split('|')[0]).sort();
      return [[{ first_day: days.length ? toDay(days[0]) : null }], []];
    }
    throw new Error(`Requête inattendue : ${sql}`);
  }

  return { pool: { query: run, execute: run }, state, rows };
}

function insertsOf(state) {
  return state.queries.filter(({ sql }) => sql.startsWith('INSERT'));
}

function createStats(redis, { at = NOON_PARIS, pool = createFakePool().pool } = {}) {
  const clock = { now: at };
  const stats = createMonetizationStats({ redis, pool, flushIntervalMs: 0, now: () => clock.now });
  return { stats, clock };
}

// ---------------------------------------------------------------------------
// Jour à Paris et dates
// ---------------------------------------------------------------------------

test('getParisDateKey suit le jour de Paris, pas celui d\'UTC', () => {
  assert.equal(getParisDateKey(NOON_PARIS), '2026-10-23');
  // 22 h 30 UTC = 0 h 30 le lendemain à Paris.
  assert.equal(getParisDateKey(new Date('2026-10-23T22:30:00Z')), '2026-10-24');
  // Hiver (UTC+1) : 23 h 30 UTC = 0 h 30 à Paris.
  assert.equal(getParisDateKey(new Date('2026-12-31T23:30:00Z')), '2027-01-01');
});

test('isDateKey n\'accepte que de vraies dates du calendrier', () => {
  for (const value of ['2026-10-23', '2024-02-29', '1000-01-01', '9999-12-31']) {
    assert.equal(isDateKey(value), true, value);
  }
  for (const value of ['2026-02-29', '2026-13-01', '2026-04-31', '2026-1-5', '0999-12-31', '20261023', '', null, 20261023]) {
    assert.equal(isDateKey(value), false, String(value));
  }
  assert.equal(shiftDateKey('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftDateKey('2025-12-31', 1), '2026-01-01');
});

// ---------------------------------------------------------------------------
// Ouvertures et envoi groupé
// ---------------------------------------------------------------------------

test('flush : une seule requête INSERT pour toutes les stats, go:cap dans Redis, plus aucun go:stats', async () => {
  const { redis, state, hashes, ttls } = createFakeRedis();
  const { pool, state: db, rows } = createFakePool();
  const { stats } = createStats(redis, { pool });

  for (let i = 0; i < 3; i += 1) stats.recordOpening({ adId: 'regie1', placement: 'player' });
  stats.recordOpening({ adId: null, placement: 'download' });
  stats.recordOpening({ adId: 'regie2', placement: 'download' });
  assert.equal(state.pipelines.length, 0, 'rien ne part vers Redis au clic');
  assert.equal(db.queries.length, 0, 'rien ne part vers MySQL au clic');

  await stats.flush();
  assert.deepEqual(db.queries, [{
    sql: upsertSql(3),
    params: [
      '2026-10-23', 'regie1', 'player', 3,
      '2026-10-23', 'none', 'download', 1,
      '2026-10-23', 'regie2', 'download', 1
    ]
  }]);
  assert.equal(rows.get('2026-10-23|regie1|player'), 3);
  assert.equal(state.pipelines.length, 1);
  assert.deepEqual(state.pipelines[0], [
    ['hincrby', 'go:cap:2026-10-23', 'regie1', 3],
    ['hincrby', 'go:cap:2026-10-23', 'regie2', 1],
    ['expire', 'go:cap:2026-10-23', CAP_TTL_SECONDS]
  ]);
  assert.equal(CAP_TTL_SECONDS, 259200);
  assert.equal([...hashes.keys(), ...ttls.keys()].some((key) => key.startsWith('go:stats:')), false);
  assert.equal(state.commands.length, 0);

  await stats.flush();
  assert.equal(state.pipelines.length, 1, 'rien en attente → aucun appel Redis');
  assert.equal(db.queries.length, 1, 'rien en attente → aucune requête MySQL');
});

test('une ouverture sans pub part dans MySQL (« none ») sans aucun appel Redis', async () => {
  const { redis, state } = createFakeRedis();
  const { pool, rows } = createFakePool();
  const { stats } = createStats(redis, { pool });

  stats.recordOpening({ adId: null, placement: 'download' });
  await stats.flush();
  assert.equal(state.pipelines.length, 0);
  assert.deepEqual([...rows], [['2026-10-23|none|download', 1]]);
  assert.deepEqual(stats.getGlobalCounts('2026-10-23'), {});
});

test('les ouvertures de deux jours partent dans le même INSERT, chacune à son jour', async () => {
  const { pool, state: db, rows } = createFakePool();
  const { stats, clock } = createStats(createFakeRedis().redis, { pool });

  clock.now = new Date('2026-10-23T21:59:00Z'); // 23 h 59 à Paris
  stats.recordOpening({ adId: 'regie1', placement: 'player' });
  clock.now = new Date('2026-10-23T22:01:00Z'); // 0 h 01 le lendemain
  stats.recordOpening({ adId: 'regie1', placement: 'player' });
  await stats.flush();

  assert.equal(insertsOf(db).length, 1);
  assert.deepEqual([...rows], [['2026-10-23|regie1|player', 1], ['2026-10-24|regie1|player', 1]]);
});

test('getGlobalCounts additionne les totaux de Redis (autres workers) et l\'attente locale', async () => {
  const { redis, hashes } = createFakeRedis();
  // Un autre worker a déjà servi 5 fois cette pub aujourd'hui.
  hashes.set('go:cap:2026-10-23', new Map([['regie1', 5]]));
  const { stats } = createStats(redis);

  stats.recordOpening({ adId: 'regie1', placement: 'player' });
  assert.deepEqual(stats.getGlobalCounts('2026-10-23'), { regie1: 1 }, 'avant le flush, seule l\'attente est connue');

  await stats.flush();
  assert.deepEqual(stats.getGlobalCounts('2026-10-23'), { regie1: 6 });

  stats.recordOpening({ adId: 'regie1', placement: 'swiftflux' });
  assert.deepEqual(stats.getGlobalCounts('2026-10-23'), { regie1: 7 });
  assert.deepEqual(stats.getGlobalCounts('2026-10-22'), {});
});

test('Redis en panne : le plafond local tient toujours, les stats partent quand même dans MySQL', async () => {
  const { redis, state, hashes } = createFakeRedis();
  const { pool, rows } = createFakePool();
  const { stats } = createStats(redis, { pool });
  state.failPipeline = true;

  stats.recordOpening({ adId: 'regie1', placement: 'player' });
  stats.recordOpening({ adId: 'regie1', placement: 'player' });
  await stats.flush();
  assert.equal(state.pipelines.length, 1);
  assert.equal(hashes.size, 0);
  assert.deepEqual(stats.getGlobalCounts('2026-10-23'), { regie1: 2 });
  assert.equal(rows.get('2026-10-23|regie1|player'), 2);

  // Redis revient : seules les nouvelles ouvertures partent, rien n'est renvoyé deux fois.
  state.failPipeline = false;
  stats.recordOpening({ adId: 'regie1', placement: 'player' });
  await stats.flush();
  assert.deepEqual(state.pipelines[1][0], ['hincrby', 'go:cap:2026-10-23', 'regie1', 1]);
  assert.deepEqual(stats.getGlobalCounts('2026-10-23'), { regie1: 3 }, 'les ouvertures perdues comptent encore');
  assert.equal(rows.get('2026-10-23|regie1|player'), 3);
});

test('MySQL en erreur : les compteurs restent en attente et repartent, additionnés, au flush suivant', async () => {
  const { redis, state } = createFakeRedis();
  const { pool, state: db, rows } = createFakePool();
  const { stats } = createStats(redis, { pool });
  db.failAllInserts = true;

  stats.recordOpening({ adId: 'regie1', placement: 'player' });
  stats.recordOpening({ adId: 'regie1', placement: 'player' });
  await stats.flush();
  assert.equal(insertsOf(db).length, 1);
  assert.equal(rows.size, 0);
  assert.equal(state.pipelines.length, 1, 'le plafond part dans Redis sans attendre MySQL');
  assert.ok(warnings(/MySQL/).length > 0);

  db.failAllInserts = false;
  stats.recordOpening({ adId: 'regie1', placement: 'player' });
  await stats.flush();
  const inserts = insertsOf(db);
  assert.equal(inserts.length, 2);
  assert.deepEqual(inserts[1].params, ['2026-10-23', 'regie1', 'player', 3]);
  assert.equal(rows.get('2026-10-23|regie1|player'), 3);

  await stats.flush();
  assert.equal(insertsOf(db).length, 2, 'plus rien en attente');
});

test('MySQL en panne longtemps : au-delà du plafond de champs en attente, le surplus est perdu avec un avertissement', async () => {
  const { pool, state: db, rows } = createFakePool();
  const { stats } = createStats(createFakeRedis().redis, { pool });
  assert.equal(MAX_PENDING_STATS_FIELDS, 5000);
  assert.equal(MAX_ROWS_PER_INSERT, 500);
  db.failAllInserts = true;

  const extra = 120;
  for (let i = 0; i < MAX_PENDING_STATS_FIELDS + extra; i += 1) {
    stats.recordOpening({ adId: `regie${i}`, placement: 'player', countsTowardCap: false });
  }
  const before = warnings(/perdu/).length;
  await stats.flush();
  assert.equal(warnings(/perdu/).length, before + 1);

  db.failAllInserts = false;
  await stats.flush();
  assert.equal(rows.size, MAX_PENDING_STATS_FIELDS);
  // 1 essai raté découpé dès le 1er morceau, puis 10 morceaux de 500 lignes.
  const sent = insertsOf(db).slice(1);
  assert.equal(sent.length, MAX_PENDING_STATS_FIELDS / MAX_ROWS_PER_INSERT);
  for (const { params } of sent) assert.ok(params.length / 4 <= MAX_ROWS_PER_INSERT);
});

test('envoi découpé en échec au milieu : seuls les morceaux non écrits repartent, rien n\'est compté deux fois', async () => {
  const { pool, state: db, rows } = createFakePool();
  const { stats } = createStats(createFakeRedis().redis, { pool });
  db.failInserts.add(2);

  const total = MAX_ROWS_PER_INSERT + 100;
  for (let i = 0; i < total; i += 1) {
    stats.recordOpening({ adId: `regie${i}`, placement: 'player', countsTowardCap: false });
  }
  await stats.flush();
  assert.equal(rows.size, MAX_ROWS_PER_INSERT, '1er morceau écrit');

  await stats.flush();
  assert.equal(rows.size, total);
  assert.ok([...rows.values()].every((openings) => openings === 1));
  assert.equal(insertsOf(db)[2].params.length / 4, 100);
});

test('sans client Redis, tout continue : plafond en mémoire, stats dans MySQL', async () => {
  const { pool, rows } = createFakePool();
  const { stats } = createStats(null, { pool });
  stats.recordOpening({ adId: 'regie1', placement: 'player' });
  await stats.flush();
  assert.deepEqual(stats.getGlobalCounts('2026-10-23'), { regie1: 1 });
  assert.equal(rows.get('2026-10-23|regie1|player'), 1);
  assert.equal(stats.nextLocalBase('player'), 0);
  assert.equal(await stats.nextGestureBase({ placement: 'player', gesture: 'geste0001', windows: 2 }), 1);
  const days = await stats.readStats({ from: '2026-10-23', to: '2026-10-23' });
  assert.deepEqual(days, [{ date: '2026-10-23', counts: { 'regie1|player': 1 } }]);
});

test('sans base MySQL : les stats restent en attente, la lecture échoue', async () => {
  const { redis } = createFakeRedis();
  const stats = createMonetizationStats({ redis, flushIntervalMs: 0, now: () => NOON_PARIS });
  stats.recordOpening({ adId: 'regie1', placement: 'player' });
  await stats.flush();
  assert.deepEqual(stats.getGlobalCounts('2026-10-23'), { regie1: 1 });
  await assert.rejects(stats.readStats({ from: '2026-10-23', to: '2026-10-23' }), /MySQL absent/);
  await assert.rejects(stats.readFirstStatsDate(), /MySQL absent/);
});

test('getPool est appelé au moment de l\'envoi, pas à la création', async () => {
  const { pool, rows } = createFakePool();
  let ready = null;
  const stats = createMonetizationStats({
    redis: null,
    getPool: () => ready,
    flushIntervalMs: 0,
    now: () => NOON_PARIS
  });
  ready = pool;
  stats.recordOpening({ adId: 'regie1', placement: 'player' });
  await stats.flush();
  assert.equal(rows.get('2026-10-23|regie1|player'), 1);
});

test('identifiant ou emplacement plus longs que les colonnes : ouverture ignorée', async () => {
  const { pool, state: db } = createFakePool();
  const { stats } = createStats(createFakeRedis().redis, { pool });
  stats.recordOpening({ adId: 'a'.repeat(17), placement: 'player' });
  stats.recordOpening({ adId: 'regie1', placement: 'p'.repeat(17) });
  await stats.flush();
  assert.equal(db.queries.length, 0);
});

test('les plafonds connus des jours passés sont oubliés', async () => {
  const { redis } = createFakeRedis();
  const { stats, clock } = createStats(redis);

  stats.recordOpening({ adId: 'regie1', placement: 'player' });
  await stats.flush();
  assert.deepEqual(stats.getGlobalCounts('2026-10-23'), { regie1: 1 });

  clock.now = new Date('2026-10-24T10:00:00Z');
  stats.recordOpening({ adId: 'regie1', placement: 'player' });
  await stats.flush();
  assert.deepEqual(stats.getGlobalCounts('2026-10-24'), { regie1: 1 });
  assert.deepEqual(stats.getGlobalCounts('2026-10-23'), {});
});

test('la minuterie envoie les compteurs toute seule', async (t) => {
  const { redis, state } = createFakeRedis();
  const { pool, state: db } = createFakePool();
  const stats = createMonetizationStats({ redis, pool, flushIntervalMs: 10, now: () => NOON_PARIS });
  t.after(() => stats.stop());

  stats.recordOpening({ adId: 'regie1', placement: 'player' });
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(state.pipelines.length, 1);
  assert.equal(insertsOf(db).length, 1);
});

// ---------------------------------------------------------------------------
// Séquence globale
// ---------------------------------------------------------------------------

test('nextLocalBase avance d\'un cran par geste, par emplacement, sans Redis', () => {
  const { redis, state } = createFakeRedis();
  const { stats } = createStats(redis);

  assert.equal(stats.nextLocalBase('player'), 0);
  assert.equal(stats.nextLocalBase('player'), 1);
  assert.equal(stats.nextLocalBase('player'), 2);
  assert.equal(stats.nextLocalBase('download'), 0);
  assert.equal(state.commands.length, 0);
  assert.equal(state.pipelines.length, 0);
});

test('nextGestureBase : toutes les fenêtres d\'un geste partent du même point, un seul script Redis', async () => {
  const { redis, state, strings, ttls } = createFakeRedis();
  const first = createStats(redis).stats;
  const second = createStats(redis).stats; // un autre worker

  const base = await first.nextGestureBase({ placement: 'player', gesture: 'gesteabc1', windows: 2 });
  assert.equal(base, 0);
  assert.deepEqual(state.commands, [['eval', 'go:g:gesteabc1', 'go:seq:player', GESTURE_TTL_SECONDS]]);
  assert.equal(ttls.get('go:g:gesteabc1'), 60);

  // Fenêtre 2 du même geste sur un autre worker : relit la valeur.
  assert.equal(await second.nextGestureBase({ placement: 'player', gesture: 'gesteabc1', windows: 2 }), 0);
  // Fenêtre 2 sur le même worker : mémoire locale, pas de Redis.
  const commandsBefore = state.commands.length;
  assert.equal(await first.nextGestureBase({ placement: 'player', gesture: 'gesteabc1', windows: 2 }), 0);
  assert.equal(state.commands.length, commandsBefore);

  // Geste suivant : le compteur commun n'a avancé que d'un cran.
  assert.equal(await second.nextGestureBase({ placement: 'player', gesture: 'gestedef2', windows: 2 }), 1);
  assert.equal(strings.get('go:seq:player'), '2');
});

test('nextGestureBase : deux workers en même temps sur le même geste n\'avancent le cycle qu\'une fois', async () => {
  const { redis, strings } = createFakeRedis();
  const workers = [createStats(redis).stats, createStats(redis).stats];

  const bases = await Promise.all(workers.map((stats) => (
    stats.nextGestureBase({ placement: 'player', gesture: 'gesterace', windows: 2 })
  )));
  assert.deepEqual(bases, [0, 0]);
  assert.equal(strings.get('go:seq:player'), '1');
});

test('nextGestureBase : fenêtres simultanées sur le même worker → un seul aller-retour Redis', async () => {
  const { redis, state } = createFakeRedis();
  const { stats } = createStats(redis);

  const bases = await Promise.all([0, 1, 2].map(() => (
    stats.nextGestureBase({ placement: 'player', gesture: 'gestesimu', windows: 3 })
  )));
  assert.deepEqual(bases, [0, 0, 0]);
  assert.equal(state.commands.filter(([name]) => name === 'eval').length, 1);
});

test('nextGestureBase : Redis en erreur → compteur local, stable pour le même geste', async () => {
  const { redis, state } = createFakeRedis();
  const { stats } = createStats(redis);
  state.failCommands = true;

  assert.equal(await stats.nextGestureBase({ placement: 'player', gesture: 'gestepann', windows: 2 }), 0);
  assert.equal(await stats.nextGestureBase({ placement: 'player', gesture: 'gestepann', windows: 2 }), 0);
  assert.equal(await stats.nextGestureBase({ placement: 'player', gesture: 'gestesuiv', windows: 2 }), 1);
  assert.equal(stats.nextLocalBase('player'), 2);
});

test('recordOpening sans part de plafond : compté dans les stats, pas dans le plafond', async () => {
  const { redis, state } = createFakeRedis();
  const { pool, rows } = createFakePool();
  const { stats } = createStats(redis, { pool });

  stats.recordOpening({ adId: 'regie1', placement: 'player' });
  stats.recordOpening({ adId: 'regie1', placement: 'player', countsTowardCap: false });
  assert.deepEqual(stats.getGlobalCounts('2026-10-23'), { regie1: 1 });
  await stats.flush();
  assert.equal(rows.get('2026-10-23|regie1|player'), 2);
  assert.deepEqual(state.pipelines[0][0], ['hincrby', 'go:cap:2026-10-23', 'regie1', 1]);
});

test('nextGestureBase avec une seule fenêtre ou sans geste ne touche pas Redis', async () => {
  const { redis, state } = createFakeRedis();
  const { stats } = createStats(redis);

  assert.equal(await stats.nextGestureBase({ placement: 'player', gesture: 'geste0001', windows: 1 }), 0);
  assert.equal(await stats.nextGestureBase({ placement: 'player', gesture: '', windows: 2 }), 1);
  assert.equal(state.commands.length, 0);
});

// ---------------------------------------------------------------------------
// Lecture des stats
// ---------------------------------------------------------------------------

test('readStats envoie l\'attente puis lit la période dans MySQL : chaque jour, du plus ancien au plus récent', async () => {
  const { redis, state } = createFakeRedis();
  const { pool, state: db, rows } = createFakePool();
  rows.set('2026-10-21|regie1|player', 4);
  rows.set('2026-10-21|none|player', 1);
  rows.set('2026-10-20|regie1|player', 9); // hors période
  const { stats } = createStats(redis, { pool });
  stats.recordOpening({ adId: 'regie1', placement: 'player' });

  const days = await stats.readStats({ from: '2026-10-21', to: '2026-10-23' });
  assert.deepEqual(days, [
    { date: '2026-10-21', counts: { 'regie1|player': 4, 'none|player': 1 } },
    { date: '2026-10-22', counts: {} },
    { date: '2026-10-23', counts: { 'regie1|player': 1 } }
  ]);
  assert.deepEqual(db.queries.map(({ sql }) => sql), [upsertSql(1), SELECT_SQL]);
  assert.deepEqual(db.queries[1].params, ['2026-10-21', '2026-10-23']);
  assert.equal(state.pipelines.filter((pipeline) => pipeline.some(([name]) => name === 'hgetall')).length, 0, 'Redis n\'est plus lu');
});

test('readStats couvre les changements de mois et d\'année ; un seul jour possible', async () => {
  const { pool, rows } = createFakePool();
  rows.set('2026-01-01|regie1|download', 2);
  const { stats } = createStats(createFakeRedis().redis, { pool });

  const days = await stats.readStats({ from: '2025-12-30', to: '2026-01-02' });
  assert.deepEqual(days.map(({ date }) => date), ['2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02']);
  assert.deepEqual(days[2].counts, { 'regie1|download': 2 });

  const leap = await stats.readStats({ from: '2024-02-28', to: '2024-03-01' });
  assert.deepEqual(leap.map(({ date }) => date), ['2024-02-28', '2024-02-29', '2024-03-01']);
  assert.deepEqual(await stats.readStats({ from: '2026-01-01', to: '2026-01-01' }), [
    { date: '2026-01-01', counts: { 'regie1|download': 2 } }
  ]);
});

test('readStats et readFirstStatsDate : jour reçu en Date (mysql2) ou en chaîne, jamais décalé par le fuseau', async (t) => {
  const originalTz = process.env.TZ;
  t.after(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  for (const tz of ['Pacific/Kiritimati', 'America/Los_Angeles', 'UTC', 'Europe/Paris']) {
    process.env.TZ = tz;
    for (const dayAs of ['date', 'string']) {
      const { pool, rows } = createFakePool({ dayAs });
      rows.set('2026-10-22|regie1|player', 2);
      rows.set('2026-10-01|none|player', 1);
      const { stats } = createStats(createFakeRedis().redis, { pool });

      assert.deepEqual(await stats.readStats({ from: '2026-10-21', to: '2026-10-23' }), [
        { date: '2026-10-21', counts: {} },
        { date: '2026-10-22', counts: { 'regie1|player': 2 } },
        { date: '2026-10-23', counts: {} }
      ], `${tz} / ${dayAs}`);
      assert.equal(await stats.readFirstStatsDate(), '2026-10-01', `${tz} / ${dayAs}`);
    }
  }
});

test('readFirstStatsDate : null quand la table est vide', async () => {
  const { pool, state: db } = createFakePool();
  const { stats } = createStats(createFakeRedis().redis, { pool });
  assert.equal(await stats.readFirstStatsDate(), null);
  assert.deepEqual(db.queries.map(({ sql }) => sql), [FIRST_DAY_SQL]);
});

test('readStats refuse une période illisible, à l\'envers ou trop longue, sans requête', async () => {
  const { pool, state: db } = createFakePool();
  const { stats } = createStats(createFakeRedis().redis, { pool });
  assert.equal(MAX_STATS_SPAN_DAYS, 1100);

  for (const period of [
    {},
    { from: '2026-10-23' },
    { from: '2026-02-30', to: '2026-03-01' },
    { from: '2026-10-24', to: '2026-10-23' },
    { from: '2023-01-01', to: shiftDateKey('2023-01-01', MAX_STATS_SPAN_DAYS + 1) }
  ]) {
    await assert.rejects(stats.readStats(period), /Période/);
  }
  assert.equal(db.queries.length, 0);
  const longest = await stats.readStats({ from: '2023-01-01', to: shiftDateKey('2023-01-01', MAX_STATS_SPAN_DAYS) });
  assert.equal(longest.length, MAX_STATS_SPAN_DAYS + 1);
});

test('readStats lance une erreur si MySQL est en panne', async () => {
  const { pool, state: db } = createFakePool();
  const { stats } = createStats(createFakeRedis().redis, { pool });
  db.failReads = true;
  await assert.rejects(stats.readStats({ from: '2026-10-17', to: '2026-10-23' }), /MySQL indisponible/);
});

// ---------------------------------------------------------------------------
// Reprise unique des stats Redis
// ---------------------------------------------------------------------------

test('reprise unique : les go:stats des 120 derniers jours sont ajoutés dans MySQL, une seule fois pour le cluster', async () => {
  const { redis, state, hashes, strings, ttls } = createFakeRedis();
  hashes.set('go:stats:2026-10-23', new Map([['regie1|player', 4], ['none|player', 1]]));
  hashes.set('go:stats:2026-06-25', new Map([['regie2|download', 7]]));
  hashes.set('go:stats:2026-06-24', new Map([['regie2|download', 50]])); // expirée depuis
  // Valeurs illisibles ignorées.
  hashes.set('go:stats:2026-09-01', new Map([['sansseparateur', 3], ['regie3|player', 'abc'], ['regie3|livetv', 0], ['regie4|player', 2]]));
  const { pool, rows } = createFakePool();
  // Ajout, pas remplacement : un worker a déjà écrit dans la table aujourd'hui.
  rows.set('2026-10-23|regie1|player', 2);

  const result = await importLegacyRedisStats({ redis, pool, now: () => NOON_PARIS });
  assert.deepEqual(result, { imported: true, rows: 4 });
  assert.equal(LEGACY_IMPORT_FLAG_KEY, 'go:stats:imported');
  assert.deepEqual(state.commands[0], ['set', 'go:stats:imported', '1', 'NX']);
  assert.equal(strings.get('go:stats:imported'), '1');
  assert.equal(ttls.has('go:stats:imported'), false, 'drapeau sans expiration');

  assert.equal(state.pipelines.length, 1);
  assert.equal(state.pipelines[0].length, LEGACY_IMPORT_DAYS);
  assert.deepEqual(state.pipelines[0][0], ['hgetall', 'go:stats:2026-06-25']);
  assert.deepEqual(state.pipelines[0].at(-1), ['hgetall', 'go:stats:2026-10-23']);

  assert.deepEqual(Object.fromEntries(rows), {
    '2026-10-23|regie1|player': 6,
    '2026-10-23|none|player': 1,
    '2026-06-25|regie2|download': 7,
    '2026-09-01|regie4|player': 2
  });

  // Deuxième démarrage (ou autre worker) : rien n'est relu ni recopié.
  const again = await importLegacyRedisStats({ redis, pool, now: () => NOON_PARIS });
  assert.equal(again.imported, false);
  assert.equal(state.pipelines.length, 1);
  assert.equal(rows.get('2026-10-23|regie1|player'), 6);
});

test('reprise : Redis ou MySQL absents → rien, sans erreur ni drapeau posé', async () => {
  const { redis, state, strings } = createFakeRedis();
  const { pool, state: db } = createFakePool();

  assert.equal((await importLegacyRedisStats({ redis: null, pool })).imported, false);
  assert.equal((await importLegacyRedisStats({ redis, pool: null })).imported, false);
  assert.equal(state.commands.length, 0);
  assert.equal(strings.has('go:stats:imported'), false);
  assert.equal(db.queries.length, 0);
});

test('reprise : MySQL en erreur → journalisé sans exception, drapeau rendu pour le prochain démarrage', async () => {
  const { redis, hashes, strings } = createFakeRedis();
  hashes.set('go:stats:2026-10-22', new Map([['regie1|player', 4]]));
  const { pool, state: db, rows } = createFakePool();
  db.failAllInserts = true;
  const errorsBefore = console.error.mock.calls.length;

  const result = await importLegacyRedisStats({ redis, pool, now: () => NOON_PARIS });
  assert.equal(result.imported, false);
  assert.ok(console.error.mock.calls.length > errorsBefore);
  assert.equal(strings.has('go:stats:imported'), false);

  db.failAllInserts = false;
  assert.deepEqual(await importLegacyRedisStats({ redis, pool, now: () => NOON_PARIS }), { imported: true, rows: 1 });
  assert.equal(rows.get('2026-10-22|regie1|player'), 4);
});

test('reprise : Redis en erreur → journalisé sans exception', async () => {
  const { redis, state, strings } = createFakeRedis();
  state.failPipeline = true;
  const { pool, state: db } = createFakePool();

  const result = await importLegacyRedisStats({ redis, pool, now: () => NOON_PARIS });
  assert.equal(result.imported, false);
  assert.equal(db.queries.length, 0);
  assert.equal(strings.has('go:stats:imported'), false);

  state.failCommands = true;
  assert.equal((await importLegacyRedisStats({ redis, pool, now: () => NOON_PARIS })).imported, false);
});

// ---------------------------------------------------------------------------
// Table MySQL
// ---------------------------------------------------------------------------

test('la table monetization_daily_stats est déclarée dans le schéma et créée depuis cette définition', async () => {
  const table = getTable('monetization_daily_stats');
  assert.ok(table);
  assert.equal(table.group, 'monetization');
  assert.equal(table.wrapped, false);
  assert.deepEqual(table.primaryKey, ['day', 'ad_id', 'placement']);
  assert.deepEqual(table.indexes, []);
  assert.deepEqual(table.foreignKeys, []);
  assert.equal(table.options, 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
  assert.deepEqual(table.columns.map((column) => [column.name, column.definition]), [
    ['day', 'DATE NOT NULL'],
    ['ad_id', 'VARCHAR(16) NOT NULL'],
    ['placement', 'VARCHAR(16) NOT NULL'],
    ['openings', 'INT UNSIGNED NOT NULL DEFAULT 0']
  ]);

  const { pool, state } = createFakePool();
  await ensureMonetizationDailyStatsTable(pool);
  assert.deepEqual(state.ddl, [renderCreateTable(table)]);
});

test('le planificateur ne voit aucune dérive sur monetization_daily_stats telle que MySQL la décrit', async () => {
  const table = getTable('monetization_daily_stats');
  const columnRow = (name, type, defaultValue, characterSet = null, collation = null) => ({
    TABLE_NAME: 'monetization_daily_stats',
    COLUMN_NAME: name,
    COLUMN_TYPE: type,
    IS_NULLABLE: 'NO',
    COLUMN_DEFAULT: defaultValue,
    EXTRA: '',
    CHARACTER_SET_NAME: characterSet,
    COLLATION_NAME: collation
  });
  const primaryRow = (column, position) => ({
    TABLE_NAME: 'monetization_daily_stats',
    INDEX_NAME: 'PRIMARY',
    NON_UNIQUE: 0,
    COLUMN_NAME: column,
    EXPRESSION: null,
    SUB_PART: null,
    COLLATION: 'A',
    INDEX_TYPE: 'BTREE',
    IS_VISIBLE: 'YES',
    SEQ_IN_INDEX: position
  });
  // Réponses d'INFORMATION_SCHEMA d'un MySQL 8 après le CREATE TABLE du démarrage.
  const rowsBySql = new Map([
    [LOWER_CASE_TABLE_NAMES_SQL, [{ LOWER_CASE_TABLE_NAMES: 0 }]],
    [TABLES_SQL, [{
      TABLE_NAME: 'monetization_daily_stats',
      ENGINE: 'InnoDB',
      CHARACTER_SET_NAME: 'utf8mb4',
      TABLE_COLLATION: 'utf8mb4_unicode_ci'
    }]],
    [COLUMNS_SQL, [
      columnRow('day', 'date', null),
      columnRow('ad_id', 'varchar(16)', null, 'utf8mb4', 'utf8mb4_unicode_ci'),
      columnRow('placement', 'varchar(16)', null, 'utf8mb4', 'utf8mb4_unicode_ci'),
      columnRow('openings', 'int unsigned', '0')
    ]],
    [INDEXES_SQL, [primaryRow('day', 1), primaryRow('ad_id', 2), primaryRow('placement', 3)]],
    [FOREIGN_KEYS_SQL, []]
  ]);
  const metadata = await loadSchemaMetadata({
    async execute(sql) {
      assert.ok(rowsBySql.has(sql), 'requête de métadonnées inattendue');
      return [rowsBySql.get(sql), []];
    }
  });

  assert.deepEqual(planSchema([table], metadata), { operations: [], drift: [] });
});
