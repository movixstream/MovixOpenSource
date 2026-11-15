'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { httpLabel, redisLabel, sqlLabel } = require('../labels');

test('http labels keep logical host, group identifiers and omit credentials', () => {
  const label = httpLabel({
    protocol: 'https:', hostname: '203.0.113.8', path: '/shows/12345678/550e8400-e29b-41d4-a716-446655440000?token=secret&action=search&page=2',
    getHeader(name) { return name === 'host' ? 'catalog.example.test' : undefined; }
  }, 'post');
  assert.equal(label.destination, 'catalog.example.test');
  assert.match(label.operation, /^POST catalog\.example\.test\/shows\/:id\/:id\?action=search$/);
  assert.doesNotMatch(label.example, /secret|token/i);
  assert.match(label.example, /page=2/);
});

test('labels are bounded and survive malformed targets', () => {
  const label = httpLabel('%%%'.repeat(500));
  assert.ok(label.operation.length <= 240);
  assert.ok(label.example.length <= 512);
  const redis = redisLabel({ name: 'GET', args: ['/var/cache/movix/user/12345678901234567890/abcdef0123456789abcdef0123456789'] });
  assert.match(redis.operation, /var:cache:movix:user::id::hash/);
});

test('SQL labels fingerprint statements without comments or literal values', () => {
  const label = sqlLabel("/* private */ SELECT * FROM users WHERE email = 'user@example.test' AND id = 42 -- secret");
  assert.equal(label.destination, 'mysql');
  assert.match(label.example, /^SELECT \* FROM users WHERE email = \? AND id = \?$/);
  assert.doesNotMatch(label.example, /user@example|private|secret/);
});

test('credential-bearing paths are grouped without recording each secret', () => {
  for (const pathname of ['/admin/vip-keys/fixture-premium-key', '/api/webhooks/123/fixture-webhook-token', '/live/fixture-user/fixture-pass/123.ts']) {
    assert.doesNotMatch(JSON.stringify(httpLabel(`https://example.test${pathname}`)), /fixture-/);
  }
});

const IPV4 = /\d{1,3}\.\d{1,3}\.\d{1,3}/;
// Blocs des adresses IPv6 utilisées ci-dessous : aucun ne doit survivre au masquage.
const IPV6 = /2a01|e0a|5600|db8|beef|ffff|2001|:42\b/i;

test('aucune adresse IP de client dans les libellés Redis ou HTTP, même IPv6 coupée par les « : »', () => {
  const keys = [
    'rate-limit:sync:post:198.51.100.189', 'rate-limit:history:2a01:e0a:1234:5600::/56', 'rate-limit:segments:2001:db8::42',
    'rate-limit:sync:post:dead:beef::1', 'rate-limit:comments:write:u:oauth:1234', 'rate-limit:sync:post:::ffff:10.0.0.7',
    'session:user-198.51.100.189:views', 'blocked:2a01:e0a:1234:5600:1:2:3:4', 'cache:ip:203.0.113.8',
  ];
  for (const key of keys) for (const command of ['INCR', 'PTTL', 'PEXPIRE']) {
    const label = redisLabel({ name: command, args: [key, '60000'] });
    for (const field of [label.operation, label.example]) {
      assert.doesNotMatch(field, IPV4, `${key} -> ${field}`);
      assert.doesNotMatch(field, IPV6, `${key} -> ${field}`);
    }
  }
  // Un seul groupe par portée de limitation, quel que soit le client.
  assert.equal(redisLabel({ name: 'INCR', args: ['rate-limit:sync:post:198.51.100.189'] }).operation, 'INCR rate-limit:sync:post::client');
  assert.equal(redisLabel({ name: 'INCR', args: ['rate-limit:sync:post:2a01:e0a:1234:5600::/56'] }).operation, 'INCR rate-limit:sync:post::client');
  assert.equal(redisLabel({ name: 'INCR', args: ['rate-limit:sync:post:dead:beef::1'] }).operation, 'INCR rate-limit:sync:post::client');
  assert.equal(redisLabel({ name: 'GET', args: ['cache:ip:203.0.113.8'] }).operation, 'GET cache:ip::ip');
  // Les mots hexadécimaux d'une clé ordinaire ne sont pas pris pour une IPv6.
  assert.equal(redisLabel({ name: 'GET', args: ['feed:ad:cafe'] }).operation, 'GET feed:ad:cafe');
  for (const target of ['https://api.test/admin/ip/198.51.100.189', 'https://api.test/admin/ip/2a01%3Ae0a%3A%3A1/ban', 'https://api.test/u/user-10.1.2.3',
    'https://api.test/geo?action=198.51.100.189&page=2', 'https://api.test/geo?type=2a01:e0a::1']) {
    const label = httpLabel(target);
    assert.doesNotMatch(`${label.operation} ${label.example}`, IPV4);
    assert.doesNotMatch(`${label.operation} ${label.example}`, IPV6);
  }
  assert.match(httpLabel('https://api.test/admin/ip/198.51.100.189').operation, /\/admin\/ip\/:ip$/);
});

test('identifiants composés, IMDb, codes de partage et recherches TMDB partagent un groupe', () => {
  const same = (a, b) => assert.equal(a.operation, b.operation);
  same(redisLabel({ name: 'GET', args: ['home:container:cache:swiftflow:movie-142143'] }), redisLabel({ name: 'GET', args: ['home:container:cache:swiftflow:movie-7'] }));
  assert.equal(redisLabel({ name: 'GET', args: ['home:container:cache:swiftflow:tv-246246'] }).operation, 'GET home:container:cache:swiftflow:tv-:n');
  const search = redisLabel({ name: 'GET', args: ['tmdb:search:movie:wir-eltern:primary_release_year=2020:fr-FR'] });
  assert.equal(search.operation, 'GET tmdb:search:movie::query:primary_release_year-:n:fr-fr');
  same(search, redisLabel({ name: 'GET', args: ['tmdb:search:movie:Star Wars: Episode I/II:primary_release_year=1999:fr-FR'] }));
  assert.equal(redisLabel({ name: 'GET', args: ['tmdb:search:tv:dune::en-US'] }).operation, 'GET tmdb:search:tv::query:en-us');
  same(httpLabel('https://blinkflux.lol/api/v1/index.php?route=movies-12'), httpLabel('https://blinkflux.lol/api/v1/index.php?route=movies-999'));
  same(httpLabel('https://flemmix.land/film-ancien/14088-solo.html'), httpLabel('https://flemmix.land/film-ancien/15139513-eyes-wide-open.html'));
  same(httpLabel('https://kisskh.test/api/episode/217318.png'), httpLabel('https://kisskh.test/api/episode/4.png'));
  // Les sources (routes entrantes) suivent la même normalisation.
  const inbound = (url) => httpLabel({ path: url, hostname: 'mainapi', method: 'GET' }).operation;
  assert.equal(inbound('/api/imdb/movie/tt35538033'), 'GET mainapi/api/imdb/movie/:imdb');
  assert.equal(inbound('/api/imdb/tv/tt14218830'), inbound('/api/imdb/tv/tt0903747'));
  assert.equal(inbound('/api/likes/shared-list/epnfcks4'), 'GET mainapi/api/likes/shared-list/:code');
  assert.equal(inbound('/api/shared-lists/list/AbC123xy'), 'GET mainapi/api/shared-lists/list/:code');
  // Les morceaux ordinaires gardent leur sens.
  assert.equal(inbound('/api/shared-lists/catalog'), 'GET mainapi/api/shared-lists/catalog');
  assert.match(httpLabel('https://cdn.test/v1/video.mp4').operation, /\/v1\/video\.mp4$/);
});

test('EVAL est libellé par script et famille de KEYS[1], sans découper le texte du script', () => {
  const script = `local picked = redis.call('GET', KEYS[1])\n${'-- commentaire\n'.repeat(400)}return picked`;
  const first = redisLabel({ name: 'EVAL', args: [script, '1', 'proxyscrape:rate-limit:v1:WIFLIX:' + 'a'.repeat(64), '5'] });
  const second = redisLabel({ name: 'EVAL', args: [script, 1, 'proxyscrape:rate-limit:v1:WIFLIX:' + 'b'.repeat(64), '9'] });
  assert.equal(first.operation, `EVAL script:${script.length}:local-picked-redis-call proxyscrape:rate-limit:v1:wiflix::hash`);
  assert.equal(second.operation, first.operation);
  assert.ok(first.operation.length < 120);
  assert.equal(redisLabel({ name: 'EVAL', args: ['return 1', '0'] }).operation, 'EVAL script:8:return none');
  assert.equal(redisLabel({ name: 'evalsha', args: ['0123456789abcdef0123456789abcdef01234567', '1', 'swiftflow:rl:12'] }).operation,
    'EVALSHA script:01234567 swiftflow:rl::id');
});

test('single-digit seasons and episodes share a group while query enums remain distinct', () => {
  const one = httpLabel('https://source.test/api/tv/123/season/1/episode/2?order=1');
  const two = httpLabel('https://source.test/api/tv/456/season/2/episode/19?order=1');
  assert.equal(one.operation, two.operation);
  assert.match(one.operation, /\/season\/:id\/episode\/:id\?order=1$/);
  assert.notEqual(one.operation, httpLabel('https://source.test/api/tv/123/season/1/episode/2?order=2').operation);
});
