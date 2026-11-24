const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const express = require('express');
const jwt = require('jsonwebtoken');

// Exécuter les vraies routes et leurs requêtes SQL sur des comptes fictifs,
// sans connecter MySQL/Redis ni charger la configuration locale.
function fixture(t, { role = 'admin', userType = 'oauth', cachedAdmin } = {}) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE admins (user_id TEXT, auth_type TEXT, role TEXT);
    CREATE TABLE user_sessions (id TEXT, user_id TEXT, user_type TEXT);
    CREATE TABLE comments (
      id INTEGER, content_type TEXT, content_id TEXT, user_id TEXT,
      user_type TEXT, profile_id TEXT, content TEXT, created_at INTEGER,
      deleted INTEGER, is_admin INTEGER
    );
    CREATE TABLE comment_replies (
      id INTEGER, comment_id INTEGER, user_id TEXT, user_type TEXT,
      profile_id TEXT, content TEXT, hierarchical_path TEXT,
      deleted INTEGER, is_admin INTEGER
    );
    CREATE TABLE comment_reactions (
      target_type TEXT, target_id INTEGER, user_id TEXT, user_type TEXT, profile_id TEXT
    );
  `);
  const authType = userType === 'bip39' ? 'bip-39' : userType;
  db.prepare('INSERT INTO admins VALUES (?, ?, ?)').run('author', authType, role);
  db.prepare('INSERT INTO user_sessions VALUES (?, ?, ?)').run('session', 'author', userType);
  db.prepare('INSERT INTO comments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(1, 'movie', '42', 'author', userType, 'profile', 'Commentaire', Date.now(), 0, 1);
  db.prepare('INSERT INTO comment_replies VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(2, 1, 'author', userType, 'profile', 'Réponse', '000002', 0, 1);

  const cache = new Map();
  if (cachedAdmin !== undefined) {
    for (const profile of ['profile', 'default']) {
      cache.set(`userData:${userType}:author:${profile}`, JSON.stringify({
        username: 'Profil en cache', avatar: '/avatars/cached.png',
        isVip: true, isAdmin: cachedAdmin,
      }));
    }
  }

  let adminSqlUnavailable = false;
  const pool = { async execute(sql, params = []) {
    if (adminSqlUnavailable && /FROM admins\b/.test(sql)) throw new Error('SQL indisponible');
    return [db.prepare(sql).all(...params)];
  } };
  const rateLimit = () => (_req, _res, next) => next();
  rateLimit.ipKeyGenerator = ip => ip;
  const dependencies = {
    express, path, jsonwebtoken: jwt,
    fs: { promises: { async readFile() {
      return JSON.stringify({ profiles: [{ id: 'profile', name: 'Profil actuel', avatar: '/avatars/current.png' }] });
    } } },
    axios: {}, 'web-push': {}, 'express-rate-limit': rateLimit,
    './mysqlPool': { getPool: () => pool },
    './checkVip': { verifyAccessKey: async () => ({ vip: false }) },
    './config/redis': { redis: {
      get: async key => cache.get(key) ?? null,
      set: async (key, value) => { cache.set(key, value); },
    } },
    './utils/redisRateLimitStore': { createRedisRateLimitStore: () => ({}) },
    './utils/turnstile': {}, './services/mediaSegments/communityStore': {},
    './utils/commentsAi': { analyzeComment: async () => ({ decision: null }) },
    './utils/commentsAiSettings': { loadCommentsAiConfig: async () => ({ provider: 'off' }) },
  };
  const filename = path.resolve(__dirname, '../../commentsRoutes.js');
  const module = { exports: {} };
  const secret = 'comments-admin-test';
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, __dirname: path.dirname(filename),
    process: { env: { JWT_SECRET: secret } },
    console: { log() {}, warn() {}, error() {} },
    require(name) {
      assert.ok(name in dependencies, `Dépendance non isolée : ${name}`);
      return dependencies[name];
    },
  }, { filename });
  const token = jwt.sign({ sub: 'author', userType, sessionId: 'session' }, secret);

  async function request(routePath, { method = 'get', params = {}, query = {}, body = {} } = {}) {
    const route = module.exports.stack.find(layer => layer.route?.path === routePath && layer.route.methods[method])?.route;
    assert.ok(route, `Route absente : ${method} ${routePath}`);
    const req = { params, query, body, headers: { authorization: `Bearer ${token}` } };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    for (const layer of route.stack) {
      let proceed = false;
      await layer.handle(req, res, () => { proceed = true; });
      if (!proceed) break;
    }
    return res;
  }

  return {
    db, cache, request,
    failAdminSql: () => { adminSqlUnavailable = true; },
    comments: () => request('/:contentType/:contentId', { params: { contentType: 'movie', contentId: '42' } }),
    replies: () => request('/:commentId/replies', { params: { commentId: '1' } }),
    limits: () => request('/limits', { query: { contentType: 'movie', contentId: '42', profileId: 'profile' } }),
  };
}

for (const [label, role, expected] of [
  ['administrateur', 'admin', 1],
  ['uploader', 'uploader', 0],
  ['rôle inconnu', 'viewer', 0],
  ['ancien administrateur sans rôle', null, 1],
]) {
  test(`le badge des commentaires et réponses respecte le rôle : ${label}`, async t => {
    const f = fixture(t, { role });
    const comments = await f.comments();
    const replies = await f.replies();
    assert.equal(comments.statusCode, 200);
    assert.equal(replies.statusCode, 200);
    assert.equal(comments.body.comments[0].is_admin, expected);
    assert.equal(replies.body.replies[0].is_admin, expected);
  });
}

test('un uploader ne reçoit ni dispense de limite ni accès à la modération', async t => {
  const f = fixture(t, { role: 'uploader' });
  const limits = await f.limits();
  assert.equal(limits.statusCode, 200);
  assert.equal(limits.body.isAdmin, false);
  assert.equal(limits.body.movieLimit, 3);
  assert.equal(limits.body.hourLimit, 10);
  assert.equal((await f.request('/admin/ban', { method: 'post' })).statusCode, 403);
});

for (const revoke of ['DELETE FROM admins', "UPDATE admins SET role = 'uploader'"]) {
  test(`le retrait du grade prend effet dès la requête suivante : ${revoke}`, async t => {
    const f = fixture(t);
    assert.equal((await f.comments()).body.comments[0].is_admin, 1);
    assert.equal((await f.limits()).body.isAdmin, true);
    f.db.exec(revoke);
    assert.equal((await f.comments()).body.comments[0].is_admin, 0);
    assert.equal((await f.replies()).body.replies[0].is_admin, 0);
    assert.equal((await f.limits()).body.isAdmin, false);
    assert.equal((await f.request('/admin/ban', { method: 'post' })).statusCode, 403);
  });
}

test('un ancien cache admin ne rétablit pas le grade d’un uploader', async t => {
  const f = fixture(t, { role: 'uploader', cachedAdmin: true });
  const comment = (await f.comments()).body.comments[0];
  assert.equal(comment.is_admin, 0);
  assert.equal(comment.username, 'Profil en cache');
  assert.equal(comment.avatar, '/avatars/cached.png');
  assert.equal(comment.is_vip, 1);
  assert.equal((await f.request('/admin/ban', { method: 'post' })).statusCode, 403);
});

test('un vrai admin est reconnu même si le cache le déclarait non admin', async t => {
  const f = fixture(t, { cachedAdmin: false });
  assert.equal((await f.comments()).body.comments[0].is_admin, 1);
  const limits = await f.limits();
  assert.equal(limits.body.isAdmin, true);
  assert.equal(limits.body.movieLimit, null);
  assert.equal(limits.body.hourLimit, null);
});

test('une panne de vérification du rôle ne conserve aucun privilège en cache', async t => {
  const f = fixture(t, { cachedAdmin: true });
  f.failAdminSql();
  assert.equal((await f.comments()).body.comments[0].is_admin, 0);
  assert.equal((await f.limits()).body.isAdmin, false);
  assert.equal((await f.request('/admin/ban', { method: 'post' })).statusCode, 403);
});

test('les identités OAuth et BIP39 restent distinctes et le type BIP39 est normalisé', async t => {
  const f = fixture(t, { userType: 'bip39' });
  assert.equal((await f.comments()).body.comments[0].is_admin, 1);
  f.db.exec("UPDATE admins SET auth_type = 'oauth'");
  assert.equal((await f.comments()).body.comments[0].is_admin, 0);
});
