const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// Module réel, chargé avec un environnement donné et un siteverify simulé.
function load(env, { admin = false } = {}) {
  const filename = path.resolve(__dirname, '../turnstile.js');
  const localRequire = createRequire(filename);
  const checks = [];
  const warnings = [];
  const dependencies = {
    '../middleware/auth': { isAdminRequest: async () => admin },
    axios: { async post(url, body) {
      checks.push(body);
      return { data: { success: body.response === 'valid-token' } };
    } },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, URL,
    process: { env },
    console: { log() {}, warn: message => warnings.push(message), error() {} },
    require: name => name in dependencies ? dependencies[name] : localRequire(name),
  }, { filename });
  return { turnstile: module.exports, checks, warnings };
}

const ENV = {
  TURNSTILE_SECRET_KEY: 'secret-1',
  TURNSTILE_INVISIBLE_SECRETKEY: 'invisible-1',
  TURNSTILE_DOMAINS_2: 'movix.new, https://Other.Mirror/',
  TURNSTILE_SECRET_KEY_2: 'secret-2',
  TURNSTILE_INVISIBLE_SECRETKEY_2: 'invisible-2',
};

const from = (origin) => ({ headers: origin ? { origin } : {}, ip: '192.0.2.1' });

test('le groupe 1 sert les domaines qu\'aucun groupe ne revendique', () => {
  const { turnstile } = load(ENV);
  for (const origin of ['https://movix.site', 'https://notmovix.new', 'null', undefined]) {
    assert.equal(turnstile.turnstileSecretFor(from(origin)), 'secret-1');
    assert.equal(turnstile.turnstileSecretFor(from(origin), 'invisible'), 'invisible-1');
  }
});

test('un domaine listé et ses sous-domaines prennent les clés de leur groupe', () => {
  const { turnstile } = load(ENV);
  for (const origin of ['https://movix.new', 'https://www.movix.new', 'https://other.mirror:8443']) {
    assert.equal(turnstile.turnstileSecretFor(from(origin)), 'secret-2');
    assert.equal(turnstile.turnstileSecretFor(from(origin), 'invisible'), 'invisible-2');
  }
});

test('le Referer prend le relais quand l\'Origin manque', () => {
  const { turnstile } = load(ENV);
  const req = { headers: { referer: 'https://movix.new/watch/42' } };
  assert.equal(turnstile.turnstileSecretFor(req), 'secret-2');
});

test('une clé absente d\'un groupe retombe sur le groupe 1, sans sauter la vérification', () => {
  const { turnstile, warnings } = load({
    ...ENV,
    TURNSTILE_DOMAINS_10: 'partial.mirror',
    TURNSTILE_SECRET_KEY_10: 'secret-10',
  });
  assert.equal(turnstile.turnstileSecretFor(from('https://partial.mirror')), 'secret-10');
  assert.equal(turnstile.turnstileSecretFor(from('https://partial.mirror'), 'invisible'), 'invisible-1');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Groupe 10/);
});

test('les groupes au-delà de 10 sont ignorés', () => {
  const { turnstile } = load({ ...ENV, TURNSTILE_DOMAINS_11: 'far.mirror', TURNSTILE_SECRET_KEY_11: 'secret-11' });
  assert.equal(turnstile.turnstileSecretFor(from('https://far.mirror')), 'secret-1');
});

test('verifyTurnstileFromRequest vérifie avec la clé du groupe et du type de widget', async () => {
  const { turnstile, checks } = load(ENV);
  // Objets du contexte vm : on les recopie pour comparer sans leur prototype.
  const result = await turnstile.verifyTurnstileFromRequest(from('https://movix.new'), 'valid-token', 'invisible');
  assert.deepEqual({ ...result }, { valid: true });
  assert.equal(checks[0].secret, 'invisible-2');

  const refused = await turnstile.verifyTurnstileFromRequest(from('https://movix.new'), 'wrong-token');
  assert.equal(refused.status, 403);
  assert.equal(checks[1].secret, 'secret-2');
});

test('sans clé au groupe 1, la vérification reste désactivée même avec d\'autres groupes', async () => {
  const { turnstile, checks } = load({
    TURNSTILE_DOMAINS_2: 'movix.new',
    TURNSTILE_SECRET_KEY_2: 'secret-2',
    TURNSTILE_INVISIBLE_SECRETKEY_2: 'invisible-2',
  });
  assert.deepEqual({ ...await turnstile.verifyTurnstileFromRequest(from('https://movix.new'), undefined) }, { valid: true });
  assert.equal(checks.length, 0);
});

test('la dispense admin s\'applique aussi aux autres groupes', async () => {
  const { turnstile, checks } = load(ENV, { admin: true });
  const result = await turnstile.verifyTurnstileFromRequest(from('https://movix.new'), undefined, 'invisible');
  assert.deepEqual({ ...result }, { valid: true, bypassed: true });
  assert.equal(checks.length, 0);
});

test('parseTurnstileDomains tolère les URLs, majuscules, jokers et séparateurs variés', () => {
  const { turnstile } = load(ENV);
  assert.deepEqual(
    [...turnstile.parseTurnstileDomains(' https://A.tld/path ; *.b.tld\nc.tld.,, ')],
    ['a.tld', 'b.tld', 'c.tld'],
  );
  assert.deepEqual([...turnstile.parseTurnstileDomains(undefined)], []);
});
