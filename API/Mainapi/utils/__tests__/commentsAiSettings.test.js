const assert = require('node:assert/strict');
const test = require('node:test');
const store = require('../commentsAiSettings');

const env = { JWT_SECRET: 'secret-de-test', ANTHROPIC_API_KEY: 'sk-ant-env-0000000000000000ENV1' };
const PANEL_KEY = 'sk-ant-panel-1111111111111111PNL2';

test('sans ligne en base, le .env donne les réglages', () => {
  const settings = store.getDefaultCommentsAiSettings(env);
  assert.equal(settings.provider, 'claude');
  assert.equal(settings.claude.model, 'claude-opus-5-5');
  assert.equal(settings.claude.effort, 'medium');
  assert.equal(store.getDefaultCommentsAiSettings({}).provider, 'off');
});

test('une clé saisie est chiffrée, jamais rendue en clair, et prime sur le .env', () => {
  const saved = store.validateSettingsInput({ claude: { apiKey: PANEL_KEY } }, null, env);
  assert.ok(saved.claude.apiKey.startsWith('v1:'));
  assert.ok(!JSON.stringify(saved).includes(PANEL_KEY));
  assert.equal(store.decryptApiKey(saved.claude.apiKey, env), PANEL_KEY);

  const view = store.toAdminView(saved, env);
  assert.ok(!JSON.stringify(view).includes(PANEL_KEY));
  assert.deepEqual(view.claude.key, { set: true, source: 'admin', hint: '…PNL2', unreadable: false });
  assert.equal(store.resolveCommentsAiConfig(saved, env).claude.apiKey, PANEL_KEY);
});

test('une clé absente du brouillon reste, clearApiKey la retire au profit du .env', () => {
  const withKey = store.validateSettingsInput({ claude: { apiKey: PANEL_KEY } }, null, env);
  const kept = store.validateSettingsInput({ provider: 'claude', claude: { effort: 'high' } }, withKey, env);
  assert.equal(kept.claude.apiKey, withKey.claude.apiKey);
  assert.equal(kept.claude.effort, 'high');
  const cleared = store.validateSettingsInput({ claude: { clearApiKey: true } }, withKey, env);
  assert.equal(cleared.claude.apiKey, null);
  assert.equal(store.toAdminView(cleared, env).claude.key.source, 'env');
});

test('valeurs refusées', () => {
  assert.throws(() => store.validateSettingsInput({ provider: 'gemini' }, null, env), /Fournisseur/);
  assert.throws(() => store.validateSettingsInput({ claude: { effort: 'turbo' } }, null, env), /effort/);
  assert.throws(() => store.validateSettingsInput({ openrouter: { effort: 'max' } }, null, env), /effort/);
  assert.throws(() => store.validateSettingsInput({ claude: { apiKey: 'pas-une-cle' } }, null, env), /sk-/);
  assert.throws(() => store.validateSettingsInput({ claude: { model: 'x y' } }, null, env), /modèle/);
  assert.throws(() => store.validateSettingsInput({ spoilerDetection: 'oui' }, null, env), /vrai ou faux/);
});

test('JWT_SECRET changé : la clé du panel est signalée illisible et le .env reprend', () => {
  const saved = store.validateSettingsInput({ claude: { apiKey: PANEL_KEY } }, null, env);
  const otherEnv = { ...env, JWT_SECRET: 'autre-secret' };
  assert.equal(store.decryptApiKey(saved.claude.apiKey, otherEnv), null);
  assert.equal(store.toAdminView(saved, otherEnv).claude.key.unreadable, true);
  assert.equal(store.resolveCommentsAiConfig(saved, otherEnv).claude.apiKey, env.ANTHROPIC_API_KEY);
});

test('base en panne : la modération suit le .env sans lever', async () => {
  store.resetCommentsAiSettingsCache();
  const pool = { execute: async () => { throw new Error('MySQL indisponible'); } };
  const config = await store.loadCommentsAiConfig(pool, { env });
  assert.equal(config.provider, 'claude');
  assert.equal(config.claude.apiKey, env.ANTHROPIC_API_KEY);
});
