'use strict';

// Parcours complet du parrainage sur une fausse base MySQL en mémoire :
// code du parrain, saisie par un nouveau compte, minutes de visionnage,
// jours VIP des deux côtés, prolongation d'une clé ou nouvelle clé, refus.
//
// Défaillances vues en production (audit du 15/11/2026) que ce fichier doit
// attraper, et qu'aucun scénario navigateur ne couvre (il faudrait plusieurs
// comptes, plusieurs jours et la vraie base) :
// - aucune récompense récupérée : la route lisait `access_keys.id`, colonne
//   absente de la vraie table (la fausse base l'acceptait à tort) ;
// - « 2 jours » obtenus en une soirée en passant minuit ;
// - boucle à trois comptes (A → B → C → A), chacun payé deux fois ;
// - parrain créé quelques minutes avant la saisie du code ;
// - code saisi par script, sans empreinte d'appareil, ou deux filleuls
//   créés depuis le même navigateur ;
// - parrainage validé impossible à annuler depuis l'admin.

const test = require('node:test');
const { beforeEach, after } = test;
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');

const DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Fausse base : tables en tableaux, requêtes reconnues par motif.
// ---------------------------------------------------------------------------

const db = {};
function resetDb() {
  db.settings = { enabled: true, rewardDays: 2, requiredMinutes: 2, requiredDays: 2, claimWindowDays: 7, maxRewardsPerMonth: 10 };
  db.sessions = [];
  db.history = [];
  db.codes = [];
  db.referrals = [];
  db.rewards = [];
  db.keys = [];
  db.userData = new Map();
  db.nextId = 1;
}

const same = (row, type, id) => row.user_type === type && String(row.user_id) === String(id);

function execute(sql, params = []) {
  const q = sql.replace(/\s+/g, ' ').trim();
  const now = new Date();
  const ok = (affectedRows = 1) => [{ affectedRows }];

  if (q.startsWith('SELECT settings_json')) {
    return [[{ settings_json: JSON.stringify(db.settings), updated_by: null, updated_at: now }]];
  }
  if (q.startsWith('SELECT MIN(created_at) AS first_at FROM user_sessions')) {
    const [userId, userType] = params;
    const dates = db.sessions.filter((s) => s.user_id === userId && s.user_type === userType).map((s) => s.created_at);
    return [[{ first_at: dates.length ? new Date(Math.min(...dates.map(Number))) : null }]];
  }
  if (q.startsWith('SELECT MIN(last_watched_at) AS first_at FROM watch_history')) {
    const [type, id] = params;
    const dates = db.history.filter((h) => same(h, type, id)).map((h) => h.last_watched_at);
    return [[{ first_at: dates.length ? new Date(Math.min(...dates.map(Number))) : null }]];
  }
  if (q.startsWith('SELECT code, last_ip_hash, last_client_hash, account_created_ms FROM referral_codes')) {
    return [db.codes.filter((c) => same(c, params[0], params[1]))];
  }
  if (q.startsWith('SELECT created_at, account_created_ms FROM referral_codes')) {
    return [db.codes.filter((c) => same(c, params[0], params[1]))];
  }
  if (q.startsWith('SELECT code FROM referral_codes')) {
    return [db.codes.filter((c) => same(c, params[0], params[1]))];
  }
  if (q.startsWith('UPDATE referral_codes SET last_ip_hash')) {
    const row = db.codes.find((c) => same(c, params[2], params[3]));
    Object.assign(row, { last_ip_hash: params[0], last_client_hash: params[1] });
    return ok();
  }
  if (q.startsWith('INSERT INTO referral_codes')) {
    const [user_type, user_id, code, last_ip_hash, last_client_hash, account_created_ms] = params;
    if (db.codes.some((c) => c.code === code || same(c, user_type, user_id))) {
      throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
    }
    db.codes.push({ user_type, user_id, code, last_ip_hash, last_client_hash, account_created_ms, created_at: now });
    return ok();
  }
  if (q.startsWith('SELECT user_type, user_id, last_ip_hash, last_client_hash, account_created_ms, created_at FROM referral_codes WHERE code')) {
    return [db.codes.filter((c) => c.code === params[0])];
  }
  if (q.startsWith('SELECT status, COUNT(*) AS total FROM referrals WHERE referrer_user_type')) {
    const counts = {};
    for (const r of db.referrals) {
      if (r.referrer_user_type === params[0] && r.referrer_user_id === params[1]) counts[r.status] = (counts[r.status] || 0) + 1;
    }
    return [Object.entries(counts).map(([status, total]) => ({ status, total }))];
  }
  if (q.startsWith('SELECT id, role, days, status FROM referral_rewards')) {
    return [db.rewards.filter((r) => same(r, params[0], params[1]))];
  }
  if (q.startsWith('SELECT id, status, watch_seconds')) {
    return [db.referrals.filter((r) => r.referee_user_type === params[0] && r.referee_user_id === params[1]).map((r) => ({ ...r }))];
  }
  if (q.startsWith('SELECT id FROM referrals WHERE referrer_user_type')) {
    return [db.referrals.filter((r) => r.referrer_user_type === params[0] && r.referrer_user_id === params[1])];
  }
  if (q.startsWith('SELECT id FROM referrals WHERE client_hash')) {
    return [db.referrals.filter((r) => r.client_hash === params[0])];
  }
  if (q.startsWith('SELECT COUNT(*) AS total FROM referrals WHERE ip_hash')) {
    return [[{ total: db.referrals.filter((r) => r.ip_hash === params[0] && now - r.created_at < 30 * DAY).length }]];
  }
  if (q.startsWith('INSERT INTO referrals')) {
    const [referrer_user_type, referrer_user_id, referee_user_type, referee_user_id, code, referrer_name, referee_name, ip_hash, client_hash] = params;
    if (db.referrals.some((r) => r.referee_user_type === referee_user_type && r.referee_user_id === referee_user_id)) {
      throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
    }
    db.referrals.push({
      id: db.nextId++, referrer_user_type, referrer_user_id, referee_user_type, referee_user_id, code,
      referrer_name, referee_name, ip_hash, client_hash, status: 'pending', watch_seconds: 0, watch_days: 0,
      last_watch_day: null, created_at: now
    });
    return ok();
  }
  if (q.startsWith('SELECT id, status FROM referrals WHERE referee_user_type')) {
    return [db.referrals.filter((r) => r.referee_user_type === params[0] && r.referee_user_id === params[1]).map((r) => ({ id: r.id, status: r.status }))];
  }
  // Ajout relatif de utils/referralProgress.js : IF(last_watch_day <=> ?, 0, 1).
  if (q.startsWith('UPDATE referrals SET watch_seconds = watch_seconds + ?')) {
    const [seconds, today, newDay, id] = params;
    const row = db.referrals.find((r) => r.id === id && r.status === 'pending');
    if (!row) return ok(0);
    row.watch_seconds += seconds;
    if (row.last_watch_day !== today) row.watch_days += 1;
    row.last_watch_day = newDay;
    return ok();
  }
  if (q.startsWith('SELECT status, watch_seconds, watch_days FROM referrals WHERE id')) {
    return [db.referrals.filter((r) => r.id === params[0]).map((r) => ({ ...r }))];
  }
  if (q.startsWith("UPDATE referrals SET status = 'rewarded'")) {
    const row = db.referrals.find((r) => r.id === params[0] && r.status === 'pending');
    if (!row) return ok(0);
    row.status = 'rewarded';
    return ok();
  }
  if (q.startsWith('SELECT status FROM referrals WHERE id')) {
    return [db.referrals.filter((r) => r.id === params[0]).map((r) => ({ status: r.status }))];
  }
  if (q.startsWith("UPDATE referrals SET status = 'cancelled'")) {
    const row = db.referrals.find((r) => r.id === params[1]);
    if (!row) return ok(0);
    row.status = 'cancelled';
    return ok();
  }
  if (q.startsWith('SELECT days, status, access_key FROM referral_rewards WHERE referral_id')) {
    return [db.rewards.filter((r) => r.referral_id === params[0]).map((r) => ({ ...r }))];
  }
  if (q.startsWith('DELETE FROM referral_rewards WHERE referral_id')) {
    const before = db.rewards.length;
    db.rewards = db.rewards.filter((r) => r.referral_id !== params[0]);
    return ok(before - db.rewards.length);
  }
  if (q.startsWith('SELECT referrer_user_type, referrer_user_id, referee_user_type, referee_user_id FROM referrals WHERE id')) {
    return [db.referrals.filter((r) => r.id === params[0])];
  }
  if (q.startsWith('INSERT INTO referral_rewards')) {
    const role = q.includes("'referee'") ? 'referee' : 'referrer';
    const [referral_id, user_type, user_id, days] = params;
    db.rewards.push({ id: db.nextId++, referral_id, role, user_type, user_id, days, status: 'available', access_key: null, created_at: now });
    return ok();
  }
  if (q.startsWith('SELECT COUNT(*) AS total FROM referral_rewards')) {
    return [[{ total: db.rewards.filter((r) => r.role === 'referrer' && same(r, params[0], params[1]) && now - r.created_at < 30 * DAY).length }]];
  }
  if (q.startsWith('SELECT id, days, status, access_key FROM referral_rewards')) {
    return [db.rewards.filter((r) => r.id === params[0] && same(r, params[1], params[2])).map((r) => ({ ...r }))];
  }
  // Vraie table `access_keys` : pas de colonne `id`. La fausse base répond
  // comme MariaDB.
  if (/^SELECT\b[^]*?\bid\b[^]*?FROM access_keys/.test(q)) {
    throw Object.assign(new Error("Unknown column 'id' in 'field list'"), { code: 'ER_BAD_FIELD_ERROR' });
  }
  if (q.startsWith('SELECT expires_at FROM access_keys') || q.startsWith('SELECT key_value, active, expires_at FROM access_keys') || q.startsWith('SELECT key_value FROM access_keys')) {
    return [db.keys.filter((k) => k.key_value === params[0]).map((k) => ({ ...k }))];
  }
  // Jours repris à l'annulation d'un parrainage validé (clé à vie : rien).
  if (q.startsWith('UPDATE access_keys SET expires_at = expires_at - ?')) {
    const key = db.keys.find((k) => k.key_value === params[1] && k.expires_at !== null && k.expires_at !== undefined);
    if (!key) return ok(0);
    key.expires_at -= params[0];
    return ok();
  }
  if (q.startsWith('UPDATE access_keys SET expires_at')) {
    db.keys.find((k) => k.key_value === params[1]).expires_at = params[0];
    return ok();
  }
  if (q.startsWith('INSERT INTO access_keys')) {
    db.keys.push({ key_value: params[0], active: 1, duree_validite: params[1], expires_at: params[2], source: q.includes("'referral'") ? 'referral' : null });
    return ok();
  }
  if (q.startsWith("UPDATE referral_rewards SET status = 'redeemed'")) {
    Object.assign(db.rewards.find((r) => r.id === params[1]), { status: 'redeemed', access_key: params[0] });
    return ok();
  }
  throw new Error(`Requête non prévue par le test : ${q}`);
}

const pool = {
  execute: async (sql, params) => execute(sql, params),
  getConnection: async () => ({
    execute: async (sql, params) => execute(sql, params),
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {}
  })
};

// ---------------------------------------------------------------------------
// Dépendances remplacées avant de charger la route.
// ---------------------------------------------------------------------------

function stub(relativePath, exports) {
  const filename = require.resolve(path.join(__dirname, relativePath));
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

stub('../../mysqlPool', { getPool: () => pool });
stub('../../middleware/auth', {
  getAuthIfValid: async (req) => {
    const raw = req.headers['x-test-user'];
    if (!raw) return null;
    const [userType, userId] = String(raw).split(':');
    return { userType, userId };
  },
  isAdmin: (req, res, next) => { req.admin = { userId: 'admin' }; next(); }
});
stub('../../utils/redisRateLimitStore', { createRedisRateLimitStore: () => undefined });
stub('../../checkVip', { invalidateVipCache: () => {} });
stub('../sync', { readUserData: async (type, id) => db.userData.get(`${type}:${id}`) || {} });

const { resetReferralSettingsCache } = require('../../utils/referralSettings');
const { creditRefereeWatch, resetReferralProgressCache } = require('../../utils/referralProgress');
const { router } = require('../referral');

const app = express();
app.use(express.json());
app.use('/api', router);
let server;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}/api`;
      resolve();
    });
  });
});
after(() => server?.close());

beforeEach(() => {
  resetDb();
  resetReferralSettingsCache();
  resetReferralProgressCache();
});

// Comme le site, chaque appel porte l'identifiant d'un navigateur (un nouveau
// à chaque fois, sauf `client` donné ; `client: null` = aucun, comme un script).
let ipCounter = 10;
async function call(method, route, { user, ip, client, body, accessKey } = {}) {
  const headers = { 'content-type': 'application/json', 'cf-connecting-ip': ip || `10.0.0.${ipCounter++}` };
  if (user) headers['x-test-user'] = user;
  const clientId = client === undefined ? crypto.randomUUID() : client;
  if (clientId) headers['x-movix-client-id'] = clientId;
  if (accessKey) headers['x-access-key'] = accessKey;
  const response = await fetch(`${baseUrl}${route}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() };
}

function addAccount(user, { ageDays = 0, name = user } = {}) {
  const [type, id] = user.split(':');
  const createdAt = new Date(Date.now() - ageDays * DAY);
  db.sessions.push({ user_type: type, user_id: id, created_at: createdAt });
  db.userData.set(user, { auth: JSON.stringify({ userProfile: { username: name, createdAt: createdAt.toISOString() } }) });
}

// Temps de visionnage tel que le Wrapped le transmet (déjà plafonné au temps réel).
const DAY1 = new Date('2026-11-07T20:00:00Z');
const DAY2 = new Date('2026-11-08T19:00:00Z');
function watch(user, seconds, at = DAY1) {
  const [userType, userId] = user.split(':');
  return creditRefereeWatch(pool, { userType, userId }, seconds, at);
}

async function setupReferral() {
  addAccount('oauth:parrain', { ageDays: 400, name: 'Parrain' });
  addAccount('bip39:filleul', { ageDays: 0, name: 'Filleul' });
  const me = await call('GET', '/referral/me', { user: 'oauth:parrain', ip: '1.1.1.1' });
  const claim = await call('POST', '/referral/claim', { user: 'bip39:filleul', ip: '2.2.2.2', body: { code: me.body.code.toLowerCase() } });
  return { code: me.body.code, me, claim };
}

// ---------------------------------------------------------------------------

test('config publique : coupée → seulement enabled: false', async () => {
  db.settings.enabled = false;
  const res = await call('GET', '/referral/config');
  assert.deepEqual(res.body, { success: true, enabled: false });
});

test('/referral/me : code créé une fois, ancien compte ne peut pas entrer de code', async () => {
  addAccount('oauth:parrain', { ageDays: 400 });
  const first = await call('GET', '/referral/me', { user: 'oauth:parrain' });
  const second = await call('GET', '/referral/me', { user: 'oauth:parrain' });
  assert.equal(first.status, 200);
  assert.match(first.body.code, /^[A-Z2-9]{8}$/);
  assert.equal(second.body.code, first.body.code);
  assert.equal(db.codes.length, 1);
  assert.equal(first.body.canEnterCode, false);
});

test('/referral/me : nouveau compte peut entrer un code, avec la date limite', async () => {
  addAccount('bip39:nouveau', { ageDays: 1 });
  const res = await call('GET', '/referral/me', { user: 'bip39:nouveau' });
  assert.equal(res.body.canEnterCode, true);
  assert.ok(Date.parse(res.body.claimDeadline) > Date.now());
});

test('/referral/me sans connexion → 401', async () => {
  const res = await call('GET', '/referral/me');
  assert.equal(res.status, 401);
});

test('parcours complet : saisie, temps du Wrapped sur 2 jours, jours VIP des deux côtés', async () => {
  const { claim } = await setupReferral();
  assert.equal(claim.status, 200);
  assert.equal(claim.body.referrerName, 'Parrain');

  // 2 minutes le même jour : temps atteint, mais un seul jour.
  assert.equal(await watch('bip39:filleul', 60), 'counted');
  assert.equal(await watch('bip39:filleul', 60), 'counted');
  const progress = await call('GET', '/referral/me', { user: 'bip39:filleul' });
  assert.deepEqual(progress.body.referee, { status: 'pending', watchMinutes: 2, watchDays: 1, requiredMinutes: 2, requiredDays: 2 });
  assert.equal(db.rewards.length, 0);

  // Le lendemain, le premier envoi termine l'objectif.
  assert.equal(await watch('bip39:filleul', 30, DAY2), 'rewarded');
  assert.deepEqual(db.rewards.map((r) => [r.role, r.user_id, r.days]).sort(), [['referee', 'filleul', 2], ['referrer', 'parrain', 2]]);
  // Plus rien n'est compté ensuite (et plus aucune lecture MySQL grâce au cache).
  assert.equal(await watch('bip39:filleul', 30, DAY2), 'ignored');

  const refereeMe = await call('GET', '/referral/me', { user: 'bip39:filleul' });
  assert.equal(refereeMe.body.rewards.length, 1);
  assert.equal(refereeMe.body.referee.status, 'rewarded');
  const referrerMe = await call('GET', '/referral/me', { user: 'oauth:parrain' });
  assert.deepEqual(referrerMe.body.stats, { invited: 1, pending: 0, rewarded: 1, daysEarned: 2 });
});

test('une soirée qui passe minuit compte un seul jour : il faut revenir le lendemain', async () => {
  await setupReferral();
  // 23 h 30 puis 0 h 30 à Paris (UTC+1) : assez de minutes, mais la même soirée.
  assert.equal(await watch('bip39:filleul', 120, new Date('2026-11-07T22:30:00Z')), 'counted');
  assert.equal(await watch('bip39:filleul', 60, new Date('2026-11-07T23:30:00Z')), 'counted');
  assert.equal(db.referrals[0].watch_days, 1);
  assert.equal(db.rewards.length, 0);
  // Le lendemain soir : deuxième jour, objectif atteint.
  assert.equal(await watch('bip39:filleul', 30, new Date('2026-11-08T19:00:00Z')), 'rewarded');
});

test('temps du Wrapped ignoré : compte non filleul, parrainage coupé, durée nulle', async () => {
  addAccount('oauth:seul', { ageDays: 0 });
  assert.equal(await watch('oauth:seul', 60), 'ignored');
  assert.equal(await watch('oauth:seul', 0), 'ignored');

  await setupReferral();
  db.settings.enabled = false;
  resetReferralSettingsCache();
  assert.equal(await watch('bip39:filleul', 60), 'ignored');
  assert.equal(db.referrals[0].watch_seconds, 0);
});

test('plafond du compte : le temps compté est rogné, et un compte non filleul ne le consomme pas', async () => {
  let capCalls = 0;
  const capped = (seconds, allowed) => creditRefereeWatch(pool, { userType: 'bip39', userId: 'filleul' }, seconds, DAY1, {
    capSeconds: async () => { capCalls += 1; return allowed; },
  });
  addAccount('bip39:filleul', { ageDays: 0 });
  assert.equal(await capped(60, 60), 'ignored');
  assert.equal(capCalls, 0);

  resetReferralProgressCache();
  await setupReferral();
  assert.equal(await capped(60, 20), 'counted');
  assert.equal(db.referrals[0].watch_seconds, 20);
  // Plus de temps réel disponible pour le compte : rien n'est ajouté.
  assert.equal(await capped(60, 0), 'ignored');
  assert.equal(db.referrals[0].watch_seconds, 20);
  // Un plafond plus large que le temps envoyé n'ajoute rien.
  assert.equal(await capped(30, 999), 'counted');
  assert.equal(db.referrals[0].watch_seconds, 50);
});

test('compte vu « pas filleul » puis qui entre un code : compté tout de suite sur ce worker', async () => {
  addAccount('oauth:parrain', { ageDays: 400 });
  addAccount('bip39:filleul', { ageDays: 0 });
  assert.equal(await watch('bip39:filleul', 60), 'ignored');
  const me = await call('GET', '/referral/me', { user: 'oauth:parrain' });
  await call('POST', '/referral/claim', { user: 'bip39:filleul', body: { code: me.body.code } });
  assert.equal(await watch('bip39:filleul', 60), 'counted');
  assert.equal(db.referrals[0].watch_seconds, 60);
});

test('récupération : sans clé → nouvelle clé de 2 jours taguée « referral », une 2e demande renvoie la même', async () => {
  await setupReferral();
  await watch('bip39:filleul', 120);
  await watch('bip39:filleul', 10, DAY2);
  const reward = db.rewards.find((r) => r.role === 'referee');
  assert.ok(reward, 'récompense du filleul créée');

  const before = Date.now();
  const first = await call('POST', `/referral/rewards/${reward.id}/redeem`, { user: 'bip39:filleul' });
  assert.equal(first.status, 200);
  assert.match(first.body.accessKey, /^VIP-[0-9A-F]{16}$/);
  assert.equal(first.body.extended, false);
  assert.ok(Math.abs(first.body.expiresAt - (before + 2 * DAY)) < 5000);
  assert.equal(db.keys[0].duree_validite, '2 jours (parrainage)');
  assert.equal(db.keys[0].source, 'referral');

  const again = await call('POST', `/referral/rewards/${reward.id}/redeem`, { user: 'bip39:filleul' });
  assert.equal(again.body.accessKey, first.body.accessKey);
  assert.equal(again.body.alreadyRedeemed, true);
  assert.equal(db.keys.length, 1);

  // La récompense d'un autre compte reste inaccessible.
  const stranger = await call('POST', `/referral/rewards/${reward.id}/redeem`, { user: 'oauth:parrain' });
  assert.equal(stranger.status, 404);
});

test('récupération : une clé VIP valable est prolongée au lieu d\'en créer une', async () => {
  const expires = Date.now() + 5 * DAY;
  db.keys.push({ key_value: 'CLE-PARRAIN', active: 1, expires_at: expires });
  db.rewards.push({ id: 99, referral_id: 1, role: 'referrer', user_type: 'oauth', user_id: 'parrain', days: 2, status: 'available', access_key: null, created_at: new Date() });
  const res = await call('POST', '/referral/rewards/99/redeem', { user: 'oauth:parrain', accessKey: 'CLE-PARRAIN' });
  assert.equal(res.body.accessKey, 'CLE-PARRAIN');
  assert.equal(res.body.extended, true);
  assert.equal(res.body.expiresAt, expires + 2 * DAY);
  assert.equal(db.keys.length, 1);
  // Clé achetée prolongée : son origine ne change pas.
  assert.equal(db.keys[0].source, undefined);
});

test('récupération : clé expirée → nouvelle clé', async () => {
  db.keys.push({ key_value: 'CLE-VIEILLE', active: 1, expires_at: Date.now() - DAY });
  db.rewards.push({ id: 98, referral_id: 1, role: 'referrer', user_type: 'oauth', user_id: 'parrain', days: 2, status: 'available', access_key: null, created_at: new Date() });
  const res = await call('POST', '/referral/rewards/98/redeem', { user: 'oauth:parrain', accessKey: 'CLE-VIEILLE' });
  assert.notEqual(res.body.accessKey, 'CLE-VIEILLE');
  assert.equal(db.keys.length, 2);
});

test('saisie refusée : propre code, déjà parrainé, compte trop ancien, même IP, parrainage coupé', async () => {
  const { code } = await setupReferral();

  const own = await call('POST', '/referral/claim', { user: 'oauth:parrain', body: { code } });
  assert.equal(own.body.code, 'OWN_CODE');

  const twice = await call('POST', '/referral/claim', { user: 'bip39:filleul', body: { code } });
  assert.equal(twice.body.code, 'ALREADY_REFERRED');

  addAccount('oauth:ancien', { ageDays: 30 });
  const old = await call('POST', '/referral/claim', { user: 'oauth:ancien', body: { code } });
  assert.equal(old.body.code, 'ACCOUNT_TOO_OLD');

  addAccount('oauth:voisin', { ageDays: 0 });
  const sameIp = await call('POST', '/referral/claim', { user: 'oauth:voisin', ip: '1.1.1.1', body: { code } });
  assert.equal(sameIp.body.code, 'SAME_PLACE');

  const unknown = await call('POST', '/referral/claim', { user: 'oauth:voisin', body: { code: 'ZZZZ2222' } });
  assert.equal(unknown.body.code, 'CODE_NOT_FOUND');

  const garbage = await call('POST', '/referral/claim', { user: 'oauth:voisin', body: { code: 'abc' } });
  assert.equal(garbage.body.code, 'INVALID_CODE');

  db.settings.enabled = false;
  resetReferralSettingsCache();
  const closed = await call('POST', '/referral/claim', { user: 'oauth:voisin', body: { code } });
  assert.equal(closed.body.code, 'REFERRAL_DISABLED');
});

test('saisie refusée : même appareil que le parrain', async () => {
  addAccount('oauth:parrain', { ageDays: 400 });
  addAccount('bip39:filleul', { ageDays: 0 });
  const client = '0f8fad5b-d9cb-469f-a165-70867728950e';
  const me = await call('GET', '/referral/me', { user: 'oauth:parrain', client });
  const res = await call('POST', '/referral/claim', { user: 'bip39:filleul', client, body: { code: me.body.code } });
  assert.equal(res.body.code, 'SAME_PLACE');
});

test('saisie refusée sans empreinte d\'appareil : le site l\'envoie toujours, un script non', async () => {
  addAccount('oauth:parrain', { ageDays: 400 });
  addAccount('bip39:filleul', { ageDays: 0 });
  const me = await call('GET', '/referral/me', { user: 'oauth:parrain' });
  const res = await call('POST', '/referral/claim', { user: 'bip39:filleul', client: null, body: { code: me.body.code } });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'CLIENT_REQUIRED');
  assert.equal(db.referrals.length, 0);
});

test('un navigateur ne sert qu\'à un seul filleul, même depuis une autre connexion', async () => {
  addAccount('oauth:parrain', { ageDays: 400 });
  addAccount('bip39:f1');
  addAccount('bip39:f2');
  const me = await call('GET', '/referral/me', { user: 'oauth:parrain' });
  const client = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
  assert.equal((await call('POST', '/referral/claim', { user: 'bip39:f1', client, body: { code: me.body.code } })).status, 200);
  const second = await call('POST', '/referral/claim', { user: 'bip39:f2', client, body: { code: me.body.code } });
  assert.equal(second.status, 403);
  assert.equal(second.body.code, 'DEVICE_ALREADY_USED');
  assert.equal(db.referrals.length, 1);
});

test('compte ancien d\'après son historique, même avec une session toute neuve', async () => {
  addAccount('oauth:parrain', { ageDays: 400 });
  addAccount('oauth:revenant', { ageDays: 0 });
  db.history.push({ user_type: 'oauth', user_id: 'revenant', last_watched_at: new Date(Date.now() - 90 * DAY) });
  const me = await call('GET', '/referral/me', { user: 'oauth:parrain' });
  const res = await call('POST', '/referral/claim', { user: 'oauth:revenant', body: { code: me.body.code } });
  assert.equal(res.body.code, 'ACCOUNT_TOO_OLD');
});

test('plafond : au-delà de maxRewardsPerMonth, seul le filleul gagne', async () => {
  db.settings.maxRewardsPerMonth = 1;
  db.settings.requiredMinutes = 1;
  db.settings.requiredDays = 1;
  addAccount('oauth:parrain', { ageDays: 400 });
  const me = await call('GET', '/referral/me', { user: 'oauth:parrain', ip: '1.1.1.1' });
  for (const user of ['bip39:f1', 'bip39:f2']) {
    addAccount(user);
    const claim = await call('POST', '/referral/claim', { user, body: { code: me.body.code } });
    assert.equal(claim.status, 200);
    assert.equal(await watch(user, 60), 'rewarded');
  }
  assert.equal(db.rewards.filter((r) => r.role === 'referee').length, 2);
  assert.equal(db.rewards.filter((r) => r.role === 'referrer').length, 1);
});

test('A parraine B, puis B ne peut pas parrainer A', async () => {
  addAccount('oauth:a', { ageDays: 5 });
  addAccount('oauth:b', { ageDays: 5 });
  const codeA = (await call('GET', '/referral/me', { user: 'oauth:a' })).body.code;
  const codeB = (await call('GET', '/referral/me', { user: 'oauth:b' })).body.code;
  assert.equal((await call('POST', '/referral/claim', { user: 'oauth:b', body: { code: codeA } })).status, 200);
  const back = await call('POST', '/referral/claim', { user: 'oauth:a', body: { code: codeB } });
  assert.equal(back.body.code, 'CIRCULAR');
});

test('parrain trop récent : son code ne marche qu\'après quelques jours', async () => {
  addAccount('oauth:jeune', { ageDays: 1 });
  addAccount('bip39:filleul', { ageDays: 0 });
  const me = await call('GET', '/referral/me', { user: 'oauth:jeune' });
  // Le parrain voit quand son code deviendra utilisable : 3 jours après l'inscription.
  const activeIn = Date.parse(me.body.codeActiveAt) - Date.now();
  assert.ok(activeIn > 1.9 * DAY && activeIn < 2.1 * DAY, `actif dans ${activeIn} ms`);
  const early = await call('POST', '/referral/claim', { user: 'bip39:filleul', body: { code: me.body.code } });
  assert.equal(early.status, 403);
  assert.equal(early.body.code, 'REFERRER_TOO_NEW');
  assert.equal(db.referrals.length, 0);

  // Réglage à 0 : plus d'ancienneté demandée.
  db.settings.minReferrerAccountDays = 0;
  resetReferralSettingsCache();
  const open = await call('POST', '/referral/claim', { user: 'bip39:filleul', body: { code: me.body.code } });
  assert.equal(open.status, 200);
});

test('parrain assez ancien : code actif tout de suite', async () => {
  addAccount('oauth:parrain', { ageDays: 4 });
  const me = await call('GET', '/referral/me', { user: 'oauth:parrain' });
  assert.equal(me.body.codeActiveAt, null);
});

test('boucle à trois : A → B → C, puis A ne peut pas devenir filleul de C', async () => {
  for (const user of ['oauth:a', 'oauth:b', 'oauth:c']) addAccount(user, { ageDays: 5 });
  const codeOf = async (user) => (await call('GET', '/referral/me', { user })).body.code;
  assert.equal((await call('POST', '/referral/claim', { user: 'oauth:b', body: { code: await codeOf('oauth:a') } })).status, 200);
  // Une chaîne reste permise : un filleul peut parrainer à son tour.
  assert.equal((await call('POST', '/referral/claim', { user: 'oauth:c', body: { code: await codeOf('oauth:b') } })).status, 200);
  const closing = await call('POST', '/referral/claim', { user: 'oauth:a', body: { code: await codeOf('oauth:c') } });
  assert.equal(closing.body.code, 'CIRCULAR');
  assert.equal(db.referrals.length, 2);
});

test('admin : annuler un parrainage en attente, une seule fois', async () => {
  await setupReferral();
  const cancel = await call('POST', `/admin/referral/${db.referrals[0].id}/cancel`, { user: 'oauth:admin' });
  assert.equal(cancel.status, 200);
  assert.equal(db.referrals[0].status, 'cancelled');
  const again = await call('POST', `/admin/referral/${db.referrals[0].id}/cancel`, { user: 'oauth:admin' });
  assert.equal(again.body.code, 'ALREADY_CANCELLED');
  assert.equal(await watch('bip39:filleul', 60), 'ignored');
  assert.equal(db.referrals[0].watch_seconds, 0);
  const unknown = await call('POST', '/admin/referral/999/cancel', { user: 'oauth:admin' });
  assert.equal(unknown.status, 404);
});

test('admin : annuler un parrainage validé avant la récupération efface les jours gagnés', async () => {
  await setupReferral();
  await watch('bip39:filleul', 120);
  await watch('bip39:filleul', 10, DAY2);
  const reward = db.rewards.find((r) => r.role === 'referee');
  assert.ok(reward, 'récompense du filleul créée');

  const cancel = await call('POST', `/admin/referral/${db.referrals[0].id}/cancel`, { user: 'oauth:admin' });
  assert.equal(cancel.status, 200);
  assert.equal(db.referrals[0].status, 'cancelled');
  // Plus rien à récupérer, ni pour le filleul ni pour le parrain.
  const redeem = await call('POST', `/referral/rewards/${reward.id}/redeem`, { user: 'bip39:filleul' });
  assert.equal(redeem.status, 404);
  assert.equal(db.keys.length, 0);
  const referrerMe = await call('GET', '/referral/me', { user: 'oauth:parrain' });
  assert.deepEqual(referrerMe.body.stats, { invited: 0, pending: 0, rewarded: 0, daysEarned: 0 });
  assert.deepEqual(referrerMe.body.rewards, []);
});

test('admin : annuler un parrainage validé après la récupération retire les jours des clés', async () => {
  await setupReferral();
  await watch('bip39:filleul', 120);
  await watch('bip39:filleul', 10, DAY2);
  const referral = db.referrals[0];
  const refereeReward = db.rewards.find((r) => r.role === 'referee');
  const referrerReward = db.rewards.find((r) => r.role === 'referrer');

  // Le filleul a reçu une nouvelle clé ; le parrain a prolongé sa clé achetée.
  const created = await call('POST', `/referral/rewards/${refereeReward.id}/redeem`, { user: 'bip39:filleul' });
  const boughtUntil = Date.now() + 30 * DAY;
  db.keys.push({ key_value: 'CLE-PARRAIN', active: 1, expires_at: boughtUntil });
  await call('POST', `/referral/rewards/${referrerReward.id}/redeem`, { user: 'oauth:parrain', accessKey: 'CLE-PARRAIN' });
  const keyOf = (value) => db.keys.find((k) => k.key_value === value);
  assert.equal(keyOf('CLE-PARRAIN').expires_at, boughtUntil + 2 * DAY);

  const cancel = await call('POST', `/admin/referral/${referral.id}/cancel`, { user: 'oauth:admin' });
  assert.equal(cancel.status, 200);
  assert.equal(referral.status, 'cancelled');
  assert.equal(db.rewards.length, 0);
  // La clé achetée retrouve sa fin d'origine ; la clé née du parrainage n'a plus de jours.
  assert.equal(keyOf('CLE-PARRAIN').expires_at, boughtUntil);
  assert.ok(keyOf(created.body.accessKey).expires_at <= Date.now());
  // Le filleul reste lié à ce parrainage annulé : il ne peut pas recommencer.
  const me = await call('GET', '/referral/me', { user: 'bip39:filleul' });
  assert.equal(me.body.referee.status, 'cancelled');
  assert.equal(me.body.canEnterCode, false);
});
