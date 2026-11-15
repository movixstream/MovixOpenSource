'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture() {
  let clients = [];
  let parsedUrls = 0;
  const env = {};
  class CountedURL extends URL { constructor(...args) { super(...args); parsedUrls++; } }
  const module = { exports: {} };
  const filename = path.join(__dirname, '../oauthClients.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, process: { env }, URL: CountedURL, console: { error() {}, log() {} },
    require(name) {
      assert.equal(name, './oauthClientsDb');
      return { getCachedClients: () => clients };
    },
  }, { filename });
  return { api: module.exports, env, update(value) { clients = value; }, parsedUrls: () => parsedUrls };
}
const client = (id = 'test', origin = 'https://client.example') => ({
  clientId: id, clientName: 'Test', redirectUris: [origin + '/callback'],
  allowedScopes: ['profile.read'], publicClient: true,
});

test('une liste inchangée est normalisée une seule fois pour CORS et les recherches', () => {
  const f = fixture();
  f.update(Array.from({ length: 100 }, (_, i) => client(String(i))));
  assert.equal(f.api.isOAuthCorsOriginAllowed('https://client.example'), true);
  const initialParses = f.parsedUrls();
  assert.ok(initialParses > 0);
  for (let i = 0; i < 20; i++) {
    assert.equal(f.api.isOAuthCorsOriginAllowed('https://client.example'), true);
    assert.equal(f.api.getOAuthClient('42').clientId, '42');
  }
  assert.equal(f.parsedUrls(), initialParses);
});

test('la révocation ou modification de la liste et les overrides invalident immédiatement', () => {
  const f = fixture();
  f.update([client()]);
  assert.equal(f.api.isOAuthCorsOriginAllowed('https://client.example'), true);
  f.update([client('test', 'https://new.example')]);
  assert.equal(f.api.isOAuthCorsOriginAllowed('https://client.example'), false);
  assert.equal(f.api.isOAuthCorsOriginAllowed('https://new.example'), true);
  f.env.MOVIX_OAUTH_CLIENTS_JSON = JSON.stringify([client('test', 'https://override.example')]);
  assert.equal(f.api.isOAuthCorsOriginAllowed('https://new.example'), false);
  assert.equal(f.api.isOAuthCorsOriginAllowed('https://override.example'), true);
  delete f.env.MOVIX_OAUTH_CLIENTS_JSON;
  f.update([]);
  assert.equal(f.api.getOAuthClient('test'), null);
  assert.equal(f.api.isOAuthCorsOriginAllowed('https://override.example'), false);
});

test('vip.grant est refusé à un client public et accordé à un client confidentiel', () => {
  const f = fixture();
  const scopes = ['profile.read', 'vip.grant'];
  f.update([
    { ...client('public'), allowedScopes: scopes },
    { ...client('confidentiel'), allowedScopes: scopes, publicClient: false, clientSecret: 's'.repeat(64) },
  ]);
  const publicClient = f.api.getOAuthClient('public');
  const confidentialClient = f.api.getOAuthClient('confidentiel');
  assert.equal(publicClient.publicClient, true);
  assert.equal(confidentialClient.publicClient, false);

  // Un client public s'approuverait lui-même : la permission lui est refusée.
  assert.throws(
    () => f.api.normalizeRequestedScopes('vip.grant', publicClient),
    (error) => error.oauthError === 'invalid_scope',
  );
  assert.deepEqual(Array.from(f.api.normalizeRequestedScopes('profile.read', publicClient)), ['profile.read']);
  assert.deepEqual(
    Array.from(f.api.normalizeRequestedScopes('profile.read vip.grant', confidentialClient)).sort(),
    scopes,
  );

  assert.equal(f.api.requiresClientAuthentication(['profile.read', 'vip.manage']), false);
  assert.equal(f.api.requiresClientAuthentication(['profile.read', 'vip.grant']), true);
  assert.equal(f.api.requiresClientAuthentication(null), false);
});

test('les mutations des retours ne modifient ni clients ni scopes ni origines internes', () => {
  const f = fixture();
  f.update([client()]);
  const result = f.api.getOAuthClient('test');
  result.allowedScopes.push('vip.manage');
  result.redirectUris.push('https://untrusted.example/callback');
  result.clientName = 'Changed';
  f.api.loadOAuthClients().pop();
  f.api.getOAuthAllowedCorsOrigins().push('https://untrusted.example');
  assert.equal(f.api.getOAuthClient('test').clientName, 'Test');
  assert.equal(f.api.getOAuthClient('test').allowedScopes.length, 1);
  assert.equal(f.api.getOAuthClient('test').redirectUris.length, 1);
  assert.equal(f.api.isOAuthCorsOriginAllowed('https://untrusted.example'), false);
  assert.equal(f.api.loadOAuthClients().length, 1);
});
