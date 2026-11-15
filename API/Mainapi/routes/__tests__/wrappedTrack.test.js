const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const jwt = require('jsonwebtoken');
const { createRequire } = require('node:module');

const SECRET = 'secret-de-test';
// Le serveur n'accepte l'année et le mois du client que s'ils collent à sa date.
const NOW = new Date();

// Faux pool : lignes de wrapped_viewing_data / wrapped_pages_data par clé de
// recherche (paramètres du WHERE), comme le ferait MySQL avec FOUND_ROWS.
function fakePool() {
  const rows = new Map();
  const queries = [];
  const inserts = [];
  const statements = [];
  return {
    rows,
    queries,
    inserts,
    statements,
    async execute(sql, params) {
      const kind = sql.trim().split(/\s+/)[0];
      statements.push(sql.replace(/\s+/g, ' ').trim());
      queries.push(kind === 'UPDATE' || kind === 'INSERT' ? `${kind} ${/(wrapped_\w+)/.exec(sql)[1]}` : kind);
      // Copie : les paramètres viennent du contexte vm, deepEqual les refuserait.
      if (kind === 'INSERT') inserts.push([...params]);
      if (kind === 'UPDATE') {
        const [added, ...where] = params;
        const key = JSON.stringify(where);
        if (!rows.has(key)) return [{ affectedRows: 0 }];
        rows.set(key, rows.get(key) + added);
        return [{ affectedRows: 1 }];
      }
      if (kind === 'INSERT' && sql.includes('wrapped_viewing_data')) {
        const [userId, profileId, contentType, contentId, , season, episode, duration, hour, month, year] = params;
        rows.set(JSON.stringify([userId, profileId, contentType, contentId, month, year, hour, season, episode]), duration);
        return [{ affectedRows: 1 }];
      }
      if (kind === 'INSERT') {
        const [userId, profileId, pageName, duration, , month, year] = params;
        rows.set(JSON.stringify([userId, profileId, pageName, month, year]), duration);
        return [{ affectedRows: 1 }];
      }
      throw new Error(`requête inattendue : ${sql}`);
    },
  };
}

// `realBudget` : vrai plafond au temps réel (utils/wrappedTimeBudget.js, sans
// Redis) ; sinon toute durée annoncée est acceptée, pour tester le SQL seul.
async function fixture({ profiles = [{ id: 'profile-one' }], realBudget = false, redis = null } = {}) {
  const filename = path.resolve(__dirname, '../../wrappedRoutes.js');
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  const accountReads = [];
  const referralCredits = [];
  const budgetModule = localRequire('./utils/wrappedTimeBudget');
  budgetModule.resetWrappedTimeBudgetMemory();
  const stubs = {
    './utils/wrappedTimeBudget': realBudget
      ? budgetModule
      : { takeWrappedTime: async ({ requestedSeconds }) => requestedSeconds },
    './utils/referralProgress': {
      // Comme le vrai : le plafond du compte s'applique avant de compter.
      async creditRefereeWatch(pool, account, seconds, now, options = {}) {
        const counted = options.capSeconds ? await options.capSeconds(seconds) : seconds;
        if (counted > 0) referralCredits.push({ ...account, seconds: counted });
        return 'ignored';
      },
    },
    './utils/tmdbCache': { fetchTmdbDetails: async () => null },
    './utils/wrappedCommunity': { fetchWrappedCommunity: async () => null },
    './utils/wrappedStory': { buildRace: () => null, buildFormatWinners: () => null, buildEras: () => null },
    './utils/wrappedEnrichment': { runBudgetedBatches: async () => [] },
    './routes/sync': {
      async readAccountProfiles(userType, userId) {
        accountReads.push(`${userType}:${userId}`);
        return profiles;
      },
    },
  };
  vm.runInNewContext(await fs.readFile(filename, 'utf8'), {
    module, exports: module.exports, __dirname: path.dirname(filename),
    require: request => request in stubs ? stubs[request] : localRequire(request),
    Buffer, setTimeout, clearTimeout, setInterval, clearInterval, AbortController,
    process: { env: { JWT_SECRET: SECRET } },
    console: { log() {}, warn() {}, error() {} },
  }, { filename });
  const pool = fakePool();
  module.exports.initWrappedRoutes(pool, redis);
  const route = module.exports.router.stack.find(layer => layer.route?.path === '/track' && layer.route.methods.post);
  const token = jwt.sign({ sub: 'user', userType: 'oauth', sessionId: 's' }, SECRET, { algorithm: 'HS256' });

  async function track(body) {
    const req = { headers: { authorization: `Bearer ${token}` }, body: { userId: 'user', profileId: 'profile-one', month: NOW.getMonth() + 1, year: NOW.getFullYear(), ...body } };
    const res = {
      statusCode: 200,
      set() { return this; },
      status(code) { this.statusCode = code; return this; },
      json(data) { this.body = data; return this; },
    };
    for (const layer of route.route.stack) {
      let next = false;
      await layer.handle(req, res, () => { next = true; });
      if (!next) break;
    }
    return res;
  }
  return { pool, track, accountReads, referralCredits };
}

test('wrapped/track : une seule requête SQL par envoi une fois la ligne créée, durées cumulées', async () => {
  const f = await fixture();
  const viewing = { type: 'viewing', contentType: 'tv', contentId: '1399', seasonNumber: 1, episodeNumber: 2, hourOfDay: 21 };

  assert.equal((await f.track({ ...viewing, duration: 60 })).statusCode, 200);
  assert.equal((await f.track({ ...viewing, duration: 45 })).statusCode, 200);
  assert.equal((await f.track({ ...viewing, duration: 30 })).statusCode, 200);

  assert.deepEqual(f.pool.queries, [
    'UPDATE wrapped_viewing_data', 'INSERT wrapped_viewing_data',
    'UPDATE wrapped_viewing_data',
    'UPDATE wrapped_viewing_data',
  ]);
  assert.deepEqual([...f.pool.rows.values()], [135]);
  assert.deepEqual(f.accountReads, ['oauth:user', 'oauth:user', 'oauth:user']);
});

test('wrapped/track : pages cumulées de la même façon, une heure différente crée une autre ligne', async () => {
  const f = await fixture();
  await f.track({ type: 'page', pageName: 'home', duration: 20 });
  await f.track({ type: 'page', pageName: 'home', duration: 20 });
  await f.track({ type: 'viewing', contentType: 'movie', contentId: '550', hourOfDay: 20, duration: 10 });
  await f.track({ type: 'viewing', contentType: 'movie', contentId: '550', hourOfDay: 21, duration: 10 });

  assert.deepEqual(f.pool.queries, [
    'UPDATE wrapped_pages_data', 'INSERT wrapped_pages_data',
    'UPDATE wrapped_pages_data',
    'UPDATE wrapped_viewing_data', 'INSERT wrapped_viewing_data',
    'UPDATE wrapped_viewing_data', 'INSERT wrapped_viewing_data',
  ]);
  assert.deepEqual([...f.pool.rows.values()], [40, 10, 10]);
});

test('wrapped/track : contrôles inchangés (profil d’un autre compte, durée hors bornes, durée lue comme entier)', async () => {
  const other = await fixture({ profiles: [{ id: 'another' }] });
  assert.equal((await other.track({ type: 'page', pageName: 'home', duration: 20 })).statusCode, 403);
  assert.deepEqual(other.pool.queries, []);

  const f = await fixture();
  assert.equal((await f.track({ type: 'page', pageName: 'home', duration: 61 })).statusCode, 400);
  assert.equal((await f.track({ type: 'page', pageName: 'home', duration: -1 })).statusCode, 400);
  assert.equal((await f.track({ type: 'page', pageName: 'home', userId: 'someone-else', duration: 5 })).statusCode, 403);
  assert.deepEqual(f.pool.queries, []);

  // « 1e3 » passe la validation comme 1 : c'est 1 qui est enregistré, pas 1000.
  assert.equal((await f.track({ type: 'page', pageName: 'home', duration: '1e3' })).statusCode, 200);
  assert.deepEqual([...f.pool.rows.values()], [1]);
});

test('wrapped/track : la durée annoncée est rognée au temps réel, un envoi à 0 s n’écrit rien', async () => {
  const f = await fixture({ realBudget: true });
  const viewing = { type: 'viewing', contentType: 'movie', contentId: '550', hourOfDay: 21 };

  // 1er envoi : au plus 35 s ; 2e envoi immédiat : plus rien à créditer.
  assert.equal((await f.track({ ...viewing, duration: 60 })).statusCode, 200);
  assert.equal((await f.track({ ...viewing, duration: 60 })).statusCode, 200);
  assert.deepEqual([...f.pool.rows.values()], [35]);
  assert.deepEqual(f.pool.queries, ['UPDATE wrapped_viewing_data', 'INSERT wrapped_viewing_data']);
});

test('wrapped/track : le temps de visionnage crédité part au parrainage, pas celui des pages', async () => {
  const f = await fixture({ realBudget: true });
  await f.track({ type: 'viewing', contentType: 'tv', contentId: '1399', seasonNumber: 1, episodeNumber: 1, hourOfDay: 21, duration: 60 });
  await f.track({ type: 'page', pageName: 'home', duration: 20 });
  // Envoi rogné à 0 s : rien pour le parrainage non plus.
  await f.track({ type: 'viewing', contentType: 'tv', contentId: '1399', seasonNumber: 1, episodeNumber: 1, hourOfDay: 21, duration: 60 });

  assert.deepEqual(f.referralCredits, [{ userType: 'oauth', userId: 'user', seconds: 35 }]);
});

test('wrapped/track : deux profils du même compte ne comptent pas deux fois pour le parrainage', async () => {
  const f = await fixture({ realBudget: true, profiles: [{ id: 'profile-one' }, { id: 'profile-two' }] });
  const viewing = { type: 'viewing', contentType: 'movie', contentId: '550', hourOfDay: 21, duration: 60 };
  await f.track({ ...viewing, profileId: 'profile-one' });
  await f.track({ ...viewing, profileId: 'profile-two' });
  await new Promise(resolve => setImmediate(resolve));

  // Chaque profil garde son temps pour son Wrapped…
  assert.deepEqual([...f.pool.rows.values()], [35, 35]);
  // … mais le compte n'avance qu'au rythme du temps réel pour le parrainage.
  assert.deepEqual(f.referralCredits, [{ userType: 'oauth', userId: 'user', seconds: 35 }]);
});

test('wrapped/track : contenu refusé s’il n’a pas la forme attendue', async () => {
  const f = await fixture();
  const base = { type: 'viewing', hourOfDay: 21, duration: 10 };
  assert.equal((await f.track({ ...base, contentType: 'podcast', contentId: '550' })).statusCode, 400);
  assert.equal((await f.track({ ...base, contentType: 'movie', contentId: 'abc' })).statusCode, 400);
  assert.equal((await f.track({ ...base, contentType: 'tv', contentId: '1399; DROP' })).statusCode, 400);
  assert.equal((await f.track({ ...base, contentType: 'movie' })).statusCode, 400);
  assert.equal((await f.track({ ...base, contentType: 'live-tv', contentId: 'x'.repeat(121) })).statusCode, 400);
  assert.equal((await f.track({ type: 'page', pageName: 'Home <script>', duration: 10 })).statusCode, 400);
  assert.equal((await f.track({ type: 'page', pageName: 'p'.repeat(51), duration: 10 })).statusCode, 400);
  assert.deepEqual(f.pool.queries, []);
});

test('wrapped/track : titre gardé pour la TV en direct seulement, heure et numéros bornés', async () => {
  const f = await fixture();
  await f.track({ type: 'viewing', contentType: 'movie', contentId: 550, contentTitle: 'Titre libre', hourOfDay: 99, seasonNumber: 'x', episodeNumber: -3, duration: 10 });
  await f.track({ type: 'viewing', contentType: 'live-tv', contentId: 'tf1.fr', contentTitle: '  TF1\u0000  ', hourOfDay: 7, duration: 10 });

  const [movie, live] = f.pool.inserts;
  // (user, profil, type, id, titre, saison, épisode, durée, heure, mois, année)
  assert.deepEqual(movie.slice(2, 8), ['movie', '550', null, null, null, 10]);
  assert.ok(Number.isInteger(movie[8]) && movie[8] >= 0 && movie[8] <= 23);
  assert.deepEqual(live.slice(2, 9), ['live-tv', 'tf1.fr', 'TF1', null, null, 10, 7]);
});

test('wrapped/track : année ou mois hors de la date du serveur → ceux du serveur', async () => {
  const f = await fixture();
  await f.track({ type: 'viewing', contentType: 'movie', contentId: '550', hourOfDay: 21, duration: 10, year: 2024, month: 3 });
  await f.track({ type: 'page', pageName: 'home', duration: 10, year: NOW.getFullYear() + 3, month: 1 });
  await f.track({ type: 'page', pageName: 'movies', duration: 10, meta: { a: 'x'.repeat(2000) } });

  const [movie, page, big] = f.pool.inserts;
  const serverPeriods = [-14, 0, 14].map(hours => {
    const date = new Date(Date.now() + hours * 3600 * 1000);
    return `${date.getFullYear()}-${date.getMonth() + 1}`;
  });
  assert.ok(serverPeriods.includes(`${movie[10]}-${movie[9]}`));
  assert.ok(serverPeriods.includes(`${page[6]}-${page[5]}`));
  assert.notEqual(movie[10], 2024);
  // Métadonnées trop lourdes : la page est comptée, sans elles.
  assert.equal(big[4], null);
});

test('wrapped/track : le visionnage se cumule dans la ligne du jour, les pages dans celle du mois', async () => {
  const f = await fixture();
  await f.track({ type: 'viewing', contentType: 'live-tv', contentId: 'tf1.fr', hourOfDay: 20, duration: 10 });
  await f.track({ type: 'page', pageName: 'home', duration: 10 });

  const [viewingUpdate, , pageUpdate] = f.pool.statements;
  // Sans cette condition, la ligne du mois gardait la date de son premier
  // envoi : jours actifs, série et jour record étaient faux.
  assert.match(viewingUpdate, /^UPDATE wrapped_viewing_data .* AND created_at >= CURDATE\(\) LIMIT 1$/);
  assert.match(pageUpdate, /^UPDATE wrapped_pages_data /);
  assert.doesNotMatch(pageUpdate, /created_at/);
});

test('wrapped/track : la limite de requêtes suit le compte, pas le profil envoyé', async () => {
  const counters = new Map();
  const redis = {
    status: 'ready',
    async eval(script, keyCount, key) {
      counters.set(key, (counters.get(key) || 0) + 1);
      return counters.get(key);
    },
    async ttl() { return 42; },
  };
  const f = await fixture({ redis });
  // 120 envois avec des profils inventés : refusés (403), mais tous comptés
  // sur le même compteur ; le suivant est bloqué.
  for (let i = 0; i < 120; i += 1) {
    assert.equal((await f.track({ type: 'page', pageName: 'home', duration: 5, profileId: `invente-${i}` })).statusCode, 403);
  }
  assert.equal((await f.track({ type: 'page', pageName: 'home', duration: 5 })).statusCode, 429);
  assert.deepEqual([...counters.keys()], ['wrapped:rl:track:oauth:user']);
});
