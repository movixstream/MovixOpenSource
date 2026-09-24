const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fixture = require('./fixtures/kkey-v1.json');

test('kkey-v1 is deterministic, uppercase and context-separated', () => {
  const { computeKkey } = require('../kkey');
  const episodeA = computeKkey({ context: 'episode', episodeId: 86439, algorithm: fixture });
  const episodeB = computeKkey({ context: 'episode', episodeId: 86439, algorithm: fixture });
  const sub = computeKkey({ context: 'sub', episodeId: 86439, algorithm: fixture });
  assert.equal(episodeA, episodeB);
  assert.notEqual(episodeA, sub);
  assert.match(episodeA, /^[0-9A-F]+$/);
  assert.equal(episodeA.length, fixture.contexts.episode.expectedLength);
  assert.equal(sub.length, fixture.contexts.sub.expectedLength);
  assert.equal(crypto.createHash('sha256').update(episodeA).digest('hex'), fixture.contexts.episode.expectedSha256);
  assert.equal(crypto.createHash('sha256').update(sub).digest('hex'), fixture.contexts.sub.expectedSha256);
});

test('kkey rejects invalid identifiers and algorithms', () => {
  const { computeKkey } = require('../kkey');
  assert.throws(() => computeKkey({ context: 'episode', episodeId: 0, algorithm: fixture }), /episodeId/);
  assert.throws(() => computeKkey({ context: 'other', episodeId: 1, algorithm: fixture }), /context/);
  assert.throws(() => computeKkey({ context: 'sub', episodeId: 1, algorithm: { ...fixture, keyHex: '00' } }), /key/);
  assert.throws(() => computeKkey({ context: 'sub', episodeId: 1, algorithm: { ...fixture, fixedMarker: 'changed' } }), /fixedMarker/);
});

test('canonical payload preserves current field order and hash number semantics', () => {
  const { canonicalPayload, jsHashCode } = require('../kkey');
  const environmentFields = [
    'A'.repeat(52),
    'MiXeD' + 'B'.repeat(52),
    'C'.repeat(52),
    'four',
    'five',
    'six',
  ];
  const payload = canonicalPayload({
    episodeId: 86439,
    contextId: fixture.contexts.episode.contextId,
    fixedMarker: fixture.fixedMarker,
    appVersion: fixture.appVersion,
    platformVersion: fixture.platformVersion,
    environmentFields,
  });
  const parts = payload.split('|');
  assert.equal(parts.length, 16);
  assert.equal(parts[0], '');
  assert.equal(parts[2], '86439');
  assert.equal(parts[3], '');
  assert.equal(parts[4], 'mg3c3b04ba');
  assert.equal(parts[8], 'A'.repeat(48));
  assert.equal(parts[9], ('mixed' + 'b'.repeat(52)).slice(0, 48));
  assert.equal(parts[10], 'C'.repeat(48));
  assert.deepEqual(parts.slice(11, 14), ['four', 'five', 'six']);
  assert.equal(parts[14], '00');
  assert.equal(parts[15], '');

  const seed = ['', 86439, null, fixture.fixedMarker, fixture.appVersion,
    fixture.contexts.episode.contextId, fixture.platformVersion,
    'kisskh', 'kisskh', 'kisskh', 'kisskh', 'kisskh', 'kisskh', '00', '']
    .map((part) => part == null ? '' : String(part)).join('|');
  const uncoercedHash = jsHashCode(seed);
  assert.equal(uncoercedHash, -19078198906);
  assert.notEqual(uncoercedHash, uncoercedHash | 0);
});

test('canonical payload requires exactly six environment fields', () => {
  const { canonicalPayload } = require('../kkey');
  const base = {
    episodeId: 1,
    contextId: fixture.contexts.sub.contextId,
    fixedMarker: fixture.fixedMarker,
    appVersion: fixture.appVersion,
    platformVersion: fixture.platformVersion,
  };
  assert.throws(() => canonicalPayload({ ...base, environmentFields: ['kisskh'] }), /environmentFields/);
  assert.throws(() => canonicalPayload({ ...base, environmentFields: Array(7).fill('kisskh') }), /environmentFields/);
});

test('approved production record matches captured digests', () => {
  const production = require('./fixtures/approved-production-v1.json');
  const { APPROVED_ALGORITHMS } = require('../approvedAlgorithms');
  const { computeKkey } = require('../kkey');
  const algorithm = APPROVED_ALGORITHMS.get(production.bundleSha256);
  assert.ok(algorithm);
  for (const [context, digestField] of [['episode', 'episodeKkeySha256'], ['sub', 'subKkeySha256']]) {
    const value = computeKkey({ context, episodeId: production.episodeId, algorithm });
    assert.equal(value.length, production.lengths[context]);
    assert.equal(crypto.createHash('sha256').update(value).digest('hex'), production[digestField]);
  }
  assert.equal(algorithm.moduleSha256, production.moduleSha256);
  assert.equal(crypto.createHash('sha256').update(Buffer.from(algorithm.subtitleCiphers.a1.keyBase64, 'base64')).digest('hex'), production.subtitleA1KeySha256);
  assert.equal(crypto.createHash('sha256').update(Buffer.from(algorithm.subtitleCiphers.a1.ivBase64, 'base64')).digest('hex'), production.subtitleA1IvSha256);
  assert.equal(algorithm.subtitleCiphers.a2, undefined);
  assert.deepEqual(algorithm.subtitleCiphers.a3, {
    keyBase64: 'c1dPRFhYMDRRUlRrSGRsWg==',
    ivBase64: 'OHB3aGFwSmVDNGhyUzloTw==',
  });
  assert.equal(Buffer.from(algorithm.subtitleCiphers.a3.keyBase64, 'base64').length, 16);
  assert.equal(Buffer.from(algorithm.subtitleCiphers.a3.ivBase64, 'base64').length, 16);
});
