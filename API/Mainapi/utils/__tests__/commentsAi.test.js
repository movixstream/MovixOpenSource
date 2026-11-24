const assert = require('node:assert/strict');
const test = require('node:test');
const { createCommentsAi, normalizeDecision, estimateClaudeCostUsd, typicalClaudeCosts } = require('../commentsAi');

const config = (overrides = {}) => ({
  provider: 'claude', spoilerDetection: true, fallbackToOpenRouter: true,
  claude: { model: 'claude-opus-5-5', effort: 'medium', apiKey: 'sk-ant-x' },
  openrouter: { model: 'anthropic/claude-haiku-5.5', effort: 'low', apiKey: 'sk-or-x' },
  ...overrides,
});

test('prix Claude Platform : Opus 5.5 à 4 $ / 20 $, cache lu à 0,20 $, écrit à 2 ×', () => {
  assert.equal(estimateClaudeCostUsd('claude-opus-5-5', { input: 1e6 }), 4);
  assert.equal(estimateClaudeCostUsd('claude-opus-5-5', { output: 1e6 }), 20);
  assert.equal(estimateClaudeCostUsd('claude-opus-5-5', { cacheRead: 1e6 }), 0.2);
  assert.equal(estimateClaudeCostUsd('claude-opus-5-5', { cacheWrite: 1e6 }), 8);
  assert.equal(estimateClaudeCostUsd('modele-inconnu', { input: 1 }), null);
  const { perComment, firstOfHour } = typicalClaudeCosts('claude-opus-5-5');
  assert.ok(perComment > 0.002 && perComment < 0.003, String(perComment));
  assert.ok(firstOfHour > 0.02 && firstOfHour < 0.03, String(firstOfHour));
});

test('une décision incomplète ou un spoiler sur un contenu supprimé ne passent pas', () => {
  assert.equal(normalizeDecision({ flagged: 'true' }), null);
  assert.equal(normalizeDecision({ flagged: true, reason: 'SPAM', details: 'x' }), null);
  assert.equal(normalizeDecision({ flagged: true, reason: 'INSULTES', details: 'x', spoiler: true }).spoiler, false);
  assert.equal(normalizeDecision({ flagged: false, reason: null, details: '', spoiler: 'oui' }).spoiler, false);
});

test("un essai sur un fournisseur imposé ne repasse pas par l'autre", async () => {
  const calls = [];
  const ai = createCommentsAi({
    env: {},
    Anthropic: class {
      beta = { messages: { create: async () => {
        calls.push('claude');
        throw Object.assign(new Error('clé refusée'), { status: 401 });
      } } };
    },
    axios: { post: async () => { calls.push('openrouter'); return { data: {} }; } },
  });
  const result = await ai.analyzeComment({ username: 'a', content: 'b' }, config(), { provider: 'claude' });
  assert.deepEqual(calls, ['claude']);
  assert.equal(result.decision, null);
  assert.match(result.error, /401 clé refusée/);
});

test('sans clé, aucun appel et un message clair', async () => {
  const ai = createCommentsAi({ env: {}, Anthropic: class { constructor() { throw new Error('ne doit pas être créé'); } } });
  const result = await ai.analyzeComment(
    { username: 'a', content: 'b' },
    config({ fallbackToOpenRouter: false, claude: { model: 'claude-opus-5-5', effort: 'medium', apiKey: null } }),
  );
  assert.equal(result.decision, null);
  assert.match(result.error, /aucune clé/);
});

test("le coût et les jetons d'un vrai appel remontent", async () => {
  const ai = createCommentsAi({
    env: {},
    Anthropic: class {
      beta = { messages: { create: async () => ({
        model: 'claude-opus-5-5',
        stop_reason: 'end_turn',
        usage: { input_tokens: 150, output_tokens: 70, cache_read_input_tokens: 2850, cache_creation_input_tokens: 0 },
        content: [{ type: 'text', text: '{"flagged":false,"reason":null,"details":"ok","spoiler":true}' }],
      }) } };
    },
  });
  const result = await ai.analyzeComment({ username: 'a', content: 'b' }, config());
  assert.equal(result.provider, 'claude');
  assert.equal(result.decision.spoiler, true);
  assert.equal(result.usage.cacheRead, 2850);
  assert.ok(Math.abs(result.costUsd - 0.00257) < 1e-5, String(result.costUsd));
});
