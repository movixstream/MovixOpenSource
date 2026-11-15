const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const jwt = require('jsonwebtoken');
const { createRequire } = require('node:module');

const SECRET = 'secret-de-test';
const THIS_YEAR = new Date().getFullYear();

// Faux pool : répond selon la requête, avec un petit délai pour mesurer
// combien de requêtes tournent en même temps.
function fakePool({ minutes = 600, titles = 4, sessions = 9, days = 5, recordMinutes = 5000 } = {}) {
  const state = { running: 0, peak: 0, labels: [] };
  const answers = [
    ['total_duration', 'viewingStats', () => [{ total_duration: minutes, unique_titles: titles, total_sessions: sessions }]],
    ['as watch_date', 'dailyActivity', () => Array.from({ length: days }, (_, i) => ({ watch_date: `${THIS_YEAR}-03-0${i + 1}` }))],
    ['GROUP BY content_type ORDER BY duration', 'typeStats', () => [{ content_type: 'movie', duration: minutes, count: titles }]],
    ['raw_seconds', 'topContent', () => [{ content_title: null, content_id: '550', content_type: 'movie', duration: minutes, raw_seconds: minutes * 60 }]],
    ['GROUP BY month ORDER BY duration', 'monthlyStats', () => [{ month: 3, duration: minutes }]],
    ['as day,', 'recordDay', () => [{ day: `${THIS_YEAR}-03-01`, minutes: recordMinutes }]],
  ];
  return {
    state,
    async execute(sql) {
      const text = sql.replace(/\s+/g, ' ');
      const answer = answers.find(([marker]) => text.includes(marker));
      state.labels.push(answer ? answer[1] : 'autre');
      state.running += 1;
      state.peak = Math.max(state.peak, state.running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      state.running -= 1;
      return [answer ? answer[2]() : []];
    },
  };
}

function fakeRedis() {
  const store = new Map();
  const sets = [];
  return {
    status: 'ready',
    store,
    sets,
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async set(key, value, ...options) {
      if (options.includes('NX') && store.has(key)) return null;
      store.set(key, value);
      sets.push([key, ...options]);
      return 'OK';
    },
    async mget(...keys) { return keys.map(() => null); },
    async eval() { return 1; },
    async ttl() { return 30; },
  };
}

async function fixture({ pool = fakePool(), redis = fakeRedis(), profiles = [{ id: 'profile-one' }], tmdb = true } = {}) {
  const filename = path.resolve(__dirname, '../../wrappedRoutes.js');
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  localRequire('./utils/wrappedPercentile').resetWrappedPercentileMemory();
  const stubs = {
    './utils/referralProgress': { creditRefereeWatch: async () => 'ignored' },
    './utils/tmdbCache': {
      fetchTmdbDetails: async () => (tmdb ? { title: 'Fight Club', poster_path: '/p.jpg', genres: [{ name: 'Drame' }], release_date: '1999-10-15' } : null),
    },
    './utils/wrappedCommunity': { fetchWrappedCommunity: async () => null },
    './utils/wrappedStory': { buildRace: () => null, buildFormatWinners: () => [], buildEras: () => [] },
    './routes/sync': { readAccountProfiles: async () => profiles },
  };
  vm.runInNewContext(await fs.readFile(filename, 'utf8'), {
    module, exports: module.exports, __dirname: path.dirname(filename),
    require: request => request in stubs ? stubs[request] : localRequire(request),
    Buffer, setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, AbortController,
    process: { env: { JWT_SECRET: SECRET } },
    console: { log() {}, warn() {}, error() {} },
  }, { filename });
  module.exports.initWrappedRoutes(pool, redis);
  const route = module.exports.router.stack.find(layer => layer.route?.path === '/generate/:year' && layer.route.methods.get);
  const token = jwt.sign({ sub: 'user', userType: 'oauth', sessionId: 's' }, SECRET, { algorithm: 'HS256' });

  async function generate({ year = THIS_YEAR, profileId = 'profile-one', query = {} } = {}) {
    const req = { headers: { authorization: `Bearer ${token}`, ...(profileId ? { 'x-profile-id': profileId } : {}) }, params: { year: String(year) }, query };
    const res = {
      statusCode: 200,
      set() { return this; },
      status(code) { this.statusCode = code; return this; },
      json(data) { this.body = JSON.parse(JSON.stringify(data)); return this; },
    };
    for (const layer of route.route.stack) {
      let next = false;
      await layer.handle(req, res, () => { next = true; });
      if (!next) break;
    }
    return res;
  }
  return { pool, redis, generate };
}

// Résumé de l'année déjà calculé : 100 comptes de 200 à 299 minutes.
function seedPercentile(redis, year) {
  const cuts = Array.from({ length: 100 }, (_, i) => 200 + i);
  redis.store.set(`wrapped:pctile:v2:${year}`, JSON.stringify({ builtAt: Date.now(), count: 100, cuts }));
}

test('wrapped/generate : profil d’un autre compte → « pas assez de données », aucune requête', async () => {
  const f = await fixture();
  const res = await f.generate({ profileId: 'profil-invente' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.wrapped, null);
  assert.equal(res.body.progress.completionPercent, 0);
  assert.deepEqual(f.pool.state.labels, []);
  assert.deepEqual(f.redis.sets, []);
});

test('wrapped/generate : pas assez de données → 2 requêtes seulement, réponse gardée 60 s', async () => {
  const f = await fixture({ pool: fakePool({ minutes: 30, titles: 1, sessions: 1, days: 1 }) });
  const first = await f.generate();
  assert.equal(first.body.wrapped, null);
  assert.equal(first.body.progress.isEligible, false);
  assert.deepEqual([...f.pool.state.labels].sort(), ['dailyActivity', 'viewingStats']);
  assert.deepEqual(f.redis.sets, [[`wrapped:gen:v4:oauth:user-profile-one-${THIS_YEAR}`, 'EX', 60]]);

  // 2e ouverture : servie par le cache.
  const second = await f.generate();
  assert.deepEqual(second.body, first.body);
  assert.equal(f.pool.state.labels.length, 2);
});

test('wrapped/generate : jamais plus de 4 requêtes à la fois, stats par jour bornées', async () => {
  const f = await fixture();
  seedPercentile(f.redis, THIS_YEAR);
  const res = await f.generate();
  assert.equal(res.statusCode, 200);
  assert.ok(f.pool.state.labels.length >= 14);
  assert.ok(f.pool.state.peak <= 4, `pic de ${f.pool.state.peak} requêtes`);

  const { stats, recordDay, topContent } = res.body.wrapped;
  assert.equal(stats.totalMinutes, 600);
  assert.equal(stats.uniqueTitles, 4);
  assert.equal(stats.totalSessions, 9);
  assert.equal(stats.totalActiveDays, 5);
  assert.equal(stats.longestStreak, 5);
  // 600 minutes dépassent les 100 comptes du résumé.
  assert.equal(stats.percentile, 99);
  // Une journée ne dépasse jamais 24 h, même avec d'anciennes lignes cumulées.
  assert.equal(recordDay.minutes, 1440);
  assert.equal(topContent[0].title, 'Fight Club');
  // Année en cours, récap complet : 10 minutes.
  assert.deepEqual(f.redis.sets.at(-1), [`wrapped:gen:v4:oauth:user-profile-one-${THIS_YEAR}`, 'EX', 600]);
});

test('wrapped/generate : année terminée gardée 6 h ; récap incomplet gardé 60 s', async () => {
  const closed = await fixture();
  seedPercentile(closed.redis, THIS_YEAR - 1);
  await closed.generate({ year: THIS_YEAR - 1 });
  assert.deepEqual(closed.redis.sets.at(-1), [`wrapped:gen:v4:oauth:user-profile-one-${THIS_YEAR - 1}`, 'EX', 6 * 60 * 60]);

  // TMDB ne répond pas : le titre du top reste « movie #550 », à ne pas figer.
  const degraded = await fixture({ tmdb: false });
  seedPercentile(degraded.redis, THIS_YEAR);
  const res = await degraded.generate();
  assert.equal(res.body.wrapped.topContent[0].title, 'movie #550');
  assert.deepEqual(degraded.redis.sets.at(-1), [`wrapped:gen:v4:oauth:user-profile-one-${THIS_YEAR}`, 'EX', 60]);

  // Classement pas encore calculé : valeur absente, garde courte aussi.
  const cold = await fixture();
  const coldRes = await cold.generate();
  assert.equal(coldRes.body.wrapped.stats.percentile, null);
  assert.deepEqual(cold.redis.sets.find(([key]) => key.startsWith('wrapped:gen:')), [`wrapped:gen:v4:oauth:user-profile-one-${THIS_YEAR}`, 'EX', 60]);
});

test('wrapped/generate : deux ouvertures en même temps partagent un seul calcul', async () => {
  const f = await fixture();
  seedPercentile(f.redis, THIS_YEAR);
  const [a, b] = await Promise.all([f.generate(), f.generate()]);
  assert.deepEqual(a.body, b.body);
  assert.equal(f.pool.state.labels.filter(label => label === 'viewingStats').length, 1);

  // ?fresh=1 refait le calcul.
  await f.generate({ query: { fresh: '1' } });
  assert.equal(f.pool.state.labels.filter(label => label === 'viewingStats').length, 2);
});

test('wrapped/generate : année hors bornes → 400', async () => {
  const f = await fixture();
  assert.equal((await f.generate({ year: 2023 })).statusCode, 400);
  assert.equal((await f.generate({ year: THIS_YEAR + 1 })).statusCode, 400);
  assert.equal((await f.generate({ year: 'abc' })).statusCode, 400);
});
