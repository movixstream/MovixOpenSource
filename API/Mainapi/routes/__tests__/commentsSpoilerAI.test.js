const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const express = require('express');
const jwt = require('jsonwebtoken');
const { createCommentsAi } = require('../../utils/commentsAi');
const commentsAiSettings = require('../../utils/commentsAiSettings');

// Modération IA à l'édition d'un commentaire : les vraies routes et les vrais
// modules d'IA tournent sur SQLite, avec de faux Claude Platform, OpenRouter et TMDB.
function fixture(t, { answer, onCreate, openRouterAnswer, hasSpoilerAuto = true, isSpoiler = 0, adminSettings = null } = {}) {
  commentsAiSettings.resetCommentsAiSettingsCache();
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  if (adminSettings) {
    db.exec('CREATE TABLE comments_ai_settings (id INTEGER, settings_json TEXT, updated_by TEXT, updated_at TEXT)');
    db.prepare('INSERT INTO comments_ai_settings VALUES (1, ?, NULL, NULL)').run(JSON.stringify(adminSettings));
  }
  db.exec(`
    CREATE TABLE user_sessions (id TEXT, user_id TEXT, user_type TEXT);
    CREATE TABLE banned_users (
      id INTEGER, ban_type TEXT, ban_value TEXT, user_type TEXT, reason TEXT,
      banned_by TEXT, banned_at INTEGER, expires_at INTEGER, username TEXT
    );
    CREATE TABLE comments (
      id INTEGER, content_type TEXT, content_id TEXT, user_id TEXT, user_type TEXT,
      profile_id TEXT, username TEXT, content TEXT, is_spoiler INTEGER, is_edited INTEGER,
      updated_at INTEGER, deleted INTEGER, moderation_reason TEXT, moderation_details TEXT,
      moderated_at INTEGER${hasSpoilerAuto ? ', spoiler_auto INTEGER DEFAULT 0' : ''}
    );
    CREATE TABLE comment_replies (
      id INTEGER, comment_id INTEGER, user_id TEXT, user_type TEXT, profile_id TEXT,
      username TEXT, content TEXT, is_spoiler INTEGER, is_edited INTEGER, updated_at INTEGER,
      deleted INTEGER, moderation_reason TEXT, moderation_details TEXT, moderated_at INTEGER${hasSpoilerAuto ? ', spoiler_auto INTEGER DEFAULT 0' : ''}
    );
  `);
  db.prepare('INSERT INTO user_sessions VALUES (?, ?, ?)').run('session', 'author', 'oauth');
  db.prepare(`INSERT INTO comments (id, content_type, content_id, user_id, user_type, profile_id, username,
    content, is_spoiler, is_edited, deleted) VALUES (1, 'movie', '745', 'author', 'oauth', 'profile', 'Lou', 'Avant', ?, 0, 0)`)
    .run(isSpoiler);
  db.prepare(`INSERT INTO comment_replies (id, comment_id, user_id, user_type, profile_id, username,
    content, is_spoiler, is_edited, deleted) VALUES (2, 1, 'author', 'oauth', 'profile', 'Lou', 'Avant', 0, 0, 0)`).run();

  const pool = { async execute(sql, params = []) {
    if (/information_schema\.COLUMNS/.test(sql)) return [[{ present: hasSpoilerAuto ? 1 : 0 }]];
    if (/^\s*ALTER TABLE/.test(sql)) throw new Error('ALTER refusé');
    const statement = db.prepare(sql);
    if (/^\s*SELECT/i.test(sql)) return [statement.all(...params)];
    const info = statement.run(...params);
    return [{ affectedRows: Number(info.changes), insertId: Number(info.lastInsertRowid) }];
  } };

  const claudeCalls = [];
  const openRouterCalls = [];
  let pending = 0;
  class FakeAnthropic {
    constructor(options) { this.options = options; }
    beta = { messages: { create: async (body) => {
      claudeCalls.push(body);
      pending += 1;
      try {
        if (onCreate) await onCreate(db, body);
        if (answer instanceof Error) throw answer;
        if (answer?.stop_reason) return { stop_reason: answer.stop_reason, stop_details: { category: 'cyber' }, content: [] };
        return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(answer) }] };
      } finally { pending -= 1; }
    } } };
  }
  const axios = { async post(url, body) {
    openRouterCalls.push({ url, body });
    return { data: { choices: [{ message: { content: JSON.stringify(openRouterAnswer) } }] } };
  } };

  const rateLimit = () => (_req, _res, next) => next();
  rateLimit.ipKeyGenerator = ip => ip;
  const secret = 'comments-spoiler-test';
  const env = {
    JWT_SECRET: secret, ANTHROPIC_API_KEY: 'sk-ant-test', TMDB_API_KEY: 'tmdb-test',
    ...(openRouterAnswer ? { OPENROUTER_API_KEY: 'sk-or-test' } : {}),
  };
  const commentsAi = createCommentsAi({
    env, axios, Anthropic: FakeAnthropic,
    fetchTmdbDetails: async (_url, _key, id, type) => (
      id === '745' && type === 'movie'
        ? { title: 'Sixième Sens', original_title: 'The Sixth Sense', release_date: '1999-08-06', overview: 'Un psychologue suit un enfant qui dit voir des morts.' }
        : null
    ),
  });
  const dependencies = {
    express, path, jsonwebtoken: jwt, fs: { promises: {} }, axios,
    'web-push': {}, 'express-rate-limit': rateLimit,
    './mysqlPool': { getPool: () => pool },
    './checkVip': { verifyAccessKey: async () => ({ vip: false }) },
    './config/redis': { redis: { get: async () => null, set: async () => {} } },
    './utils/redisRateLimitStore': { createRedisRateLimitStore: () => ({}) },
    './utils/turnstile': {}, './services/mediaSegments/communityStore': {},
    './utils/commentsAi': commentsAi,
    './utils/commentsAiSettings': commentsAiSettings,
  };
  const filename = path.resolve(__dirname, '../../commentsRoutes.js');
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, __dirname: path.dirname(filename),
    process: { env },
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, setImmediate,
    require(name) {
      assert.ok(name in dependencies, `Dépendance non isolée : ${name}`);
      return dependencies[name];
    },
  }, { filename });
  const token = jwt.sign({ sub: 'author', userType: 'oauth', sessionId: 'session' }, secret);

  async function request(routePath, { method = 'put', params = {}, body = {} } = {}) {
    const route = module.exports.stack.find(layer => layer.route?.path === routePath && layer.route.methods[method])?.route;
    assert.ok(route, `Route absente : ${method} ${routePath}`);
    const req = { params, query: {}, body, headers: { authorization: `Bearer ${token}` } };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; },
    };
    for (const layer of route.stack) {
      let proceed = false;
      await layer.handle(req, res, () => { proceed = true; });
      if (!proceed) break;
    }
    // La modération part en arrière-plan : attendre qu'elle ait tout écrit.
    for (let i = 0; i < 200; i += 1) {
      await new Promise(resolve => setImmediate(resolve));
      if (claudeCalls.length + openRouterCalls.length > 0 && pending === 0 && i > 20) break;
    }
    return res;
  }

  return {
    db, claudeCalls, openRouterCalls,
    editComment: (content, isSpoiler = false) => request('/:id', {
      params: { id: '1' }, body: { content, isSpoiler, profileId: 'profile' },
    }),
    editReply: (content, isSpoiler = false) => request('/replies/:id', {
      params: { id: '2' }, body: { content, isSpoiler, profileId: 'profile' },
    }),
    comment: () => db.prepare('SELECT * FROM comments WHERE id = 1').get(),
    reply: () => db.prepare('SELECT * FROM comment_replies WHERE id = 2').get(),
  };
}

const SPOILER = 'Bruce Willis est mort depuis le début, quelle claque';
const CLEAN = { flagged: false, reason: null, details: 'Rien à signaler.', spoiler: false };
const SPOILER_ANSWER = { ...CLEAN, details: 'Dévoile la fin.', spoiler: true };

test("un spoiler non coché est flouté et marqué comme détecté par l'IA", async t => {
  const f = fixture(t, { answer: SPOILER_ANSWER });
  const res = await f.editComment(SPOILER);
  assert.equal(res.statusCode, 200);
  assert.equal(f.comment().is_spoiler, 1);
  assert.equal(f.comment().spoiler_auto, 1);
  assert.equal(f.comment().deleted, 0);
});

test("la requête Claude Platform suit le modèle, l'effort et le cache voulus", async t => {
  const f = fixture(t, { answer: SPOILER_ANSWER });
  await f.editComment(SPOILER);
  assert.equal(f.claudeCalls.length, 1);
  const body = f.claudeCalls[0];
  assert.equal(body.model, 'claude-opus-5-5');
  assert.equal(body.output_config.effort, 'medium');
  assert.equal(body.output_config.format.type, 'json_schema');
  assert.ok(body.output_config.format.schema.required.includes('spoiler'));
  // Objets nés dans le contexte vm : comparer leur JSON, pas leurs prototypes.
  assert.equal(JSON.stringify(body.betas), '["server-side-fallback-2026-07-01"]');
  assert.equal(body.fallbacks, 'default');
  assert.equal(body.thinking, undefined);
  assert.equal(JSON.stringify(body.system[0].cache_control), '{"type":"ephemeral","ttl":"1h"}');
  const payload = JSON.parse(body.messages[0].content);
  assert.equal(payload.content, SPOILER);
  assert.equal(payload.username, 'Lou');
  assert.deepEqual(payload.work, {
    type: 'film', title: 'Sixième Sens', original_title: 'The Sixth Sense', year: 1999,
    synopsis: 'Un psychologue suit un enfant qui dit voir des morts.',
  });
  assert.equal(f.openRouterCalls.length, 0);
});

test("une réponse éditée est relue avec l'œuvre de son commentaire", async t => {
  const f = fixture(t, { answer: SPOILER_ANSWER });
  await f.editReply(SPOILER);
  assert.equal(f.reply().is_spoiler, 1);
  assert.equal(f.reply().spoiler_auto, 1);
  assert.equal(JSON.parse(f.claudeCalls[0].messages[0].content).work.title, 'Sixième Sens');
});

test("un spoiler déjà coché par l'auteur ne porte pas la mention IA", async t => {
  const f = fixture(t, { answer: SPOILER_ANSWER });
  await f.editComment(SPOILER, true);
  assert.equal(f.comment().is_spoiler, 1);
  assert.equal(f.comment().spoiler_auto, 0);
});

test("l'édition efface la mention IA quand l'IA ne voit plus de spoiler", async t => {
  const f = fixture(t, { answer: CLEAN, isSpoiler: 1 });
  f.db.prepare('UPDATE comments SET spoiler_auto = 1').run();
  await f.editComment('Film génial, foncez');
  assert.equal(f.comment().is_spoiler, 0);
  assert.equal(f.comment().spoiler_auto, 0);
});

test("un texte modifié pendant l'analyse n'est pas flouté sur l'ancien avis", async t => {
  const f = fixture(t, {
    answer: SPOILER_ANSWER,
    onCreate: db => db.prepare("UPDATE comments SET content = 'Texte plus récent'").run(),
  });
  await f.editComment(SPOILER);
  assert.equal(f.comment().is_spoiler, 0);
});

test('une violation supprime le commentaire au lieu de le flouter', async t => {
  const f = fixture(t, { answer: { flagged: true, reason: 'INSULTES', details: 'Menace.', spoiler: false } });
  await f.editComment('Je vais te retrouver');
  assert.equal(f.comment().deleted, 1);
  assert.equal(f.comment().moderation_reason, 'INSULTES');
  assert.equal(f.comment().is_spoiler, 0);
});

test('un refus des filtres de sécurité ne touche pas au commentaire', async t => {
  const f = fixture(t, { answer: { stop_reason: 'refusal' } });
  await f.editComment(SPOILER);
  assert.equal(f.comment().is_spoiler, 0);
  assert.equal(f.comment().deleted, 0);
});

test('Claude Platform en panne : repli sur OpenRouter', async t => {
  const f = fixture(t, { answer: new Error('503'), openRouterAnswer: SPOILER_ANSWER });
  await f.editComment(SPOILER);
  assert.equal(f.openRouterCalls.length, 1);
  assert.equal(f.comment().is_spoiler, 1);
});

test('sans colonne spoiler_auto, le spoiler est quand même flouté', async t => {
  const f = fixture(t, { answer: SPOILER_ANSWER, hasSpoilerAuto: false });
  const res = await f.editComment(SPOILER);
  assert.equal(res.statusCode, 200);
  assert.equal(f.comment().is_spoiler, 1);
});

test("les réglages de l'admin passent avant le .env : OpenRouter choisi", async t => {
  const f = fixture(t, {
    answer: SPOILER_ANSWER,
    openRouterAnswer: SPOILER_ANSWER,
    adminSettings: { provider: 'openrouter', openrouter: { model: 'anthropic/claude-haiku-5.5', effort: 'low' } },
  });
  await f.editComment(SPOILER);
  assert.equal(f.claudeCalls.length, 0);
  assert.equal(f.openRouterCalls.length, 1);
  assert.equal(f.openRouterCalls[0].body.model, 'anthropic/claude-haiku-5.5');
  assert.equal(f.comment().is_spoiler, 1);
});

test("IA coupée dans l'admin : aucun appel, rien ne change", async t => {
  const f = fixture(t, { answer: SPOILER_ANSWER, adminSettings: { provider: 'off' } });
  await f.editComment(SPOILER);
  assert.equal(f.claudeCalls.length, 0);
  assert.equal(f.comment().is_spoiler, 0);
});

test('détection des spoilers coupée : la modération continue sans flouter', async t => {
  const f = fixture(t, { answer: SPOILER_ANSWER, adminSettings: { provider: 'claude', spoilerDetection: false } });
  await f.editComment(SPOILER);
  assert.equal(f.claudeCalls.length, 1);
  assert.equal(JSON.parse(f.claudeCalls[0].messages[0].content).work, undefined);
  assert.equal(f.comment().is_spoiler, 0);
});

test("modèle et effort choisis dans l'admin", async t => {
  const f = fixture(t, {
    answer: SPOILER_ANSWER,
    adminSettings: { provider: 'claude', claude: { model: 'claude-haiku-5-5', effort: 'low' } },
  });
  await f.editComment(SPOILER);
  assert.equal(f.claudeCalls[0].model, 'claude-haiku-5-5');
  assert.equal(f.claudeCalls[0].output_config.effort, 'low');
  // Pas de repli serveur pour Haiku : le paramètre y est refusé.
  assert.equal(f.claudeCalls[0].fallbacks, undefined);
  assert.equal(f.claudeCalls[0].betas, undefined);
});

test('un compte banni ne peut plus modifier ses anciens messages', async t => {
  const f = fixture(t, { answer: CLEAN });
  f.db.prepare(`INSERT INTO banned_users (id, ban_type, ban_value, user_type, reason, expires_at)
    VALUES (1, 'user', 'author', 'oauth', 'Spam', NULL)`).run();
  for (const edit of [f.editComment, f.editReply]) {
    const res = await edit('Nouveau texte');
    assert.equal(res.statusCode, 403);
  }
  assert.equal(f.comment().content, 'Avant');
  assert.equal(f.reply().content, 'Avant');
  assert.equal(f.claudeCalls.length + f.openRouterCalls.length, 0);
});
