'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { instrumentRedis, instrumentMysqlPool, wrapCycleTLS, observeTextRequest } = require('../clients');

function flush() { return new Promise((resolve) => setImmediate(resolve)); }
function collector() {
  const spans = [];
  const sockets = [];
  const warnings = [];
  return {
    active: true, spans, sockets, warnings,
    start(input) {
      const span = { input, sent: 0, received: 0, finishes: [], send(n) { this.sent += n; }, receive(n) { this.received += n; }, finish(value = {}) { this.finishes.push(value); } };
      spans.push(span); return span;
    },
    trackSocket(socket, label) { sockets.push([socket, label]); },
    warn(code) { warnings.push(code); }
  };
}

test('Redis instrumentation keeps original return identity, handles retry once, sockets and undo', async () => {
  const client = new EventEmitter();
  const socket = {};
  client.connector = { stream: socket };
  let returned;
  client.sendCommand = function sendCommand(command) { assert.equal(this, client); returned = command.promise; return returned; };
  const c = collector();
  const undo = instrumentRedis(client, c);
  const command = { name: 'GET', args: ['cache:user:12345'], promise: Promise.resolve(Buffer.from('ok')) };
  assert.equal(client.sendCommand(command), command.promise);
  client.sendCommand(command); // ioredis can resend a command after reconnecting.
  await command.promise; await flush();
  assert.equal(c.spans.length, 1);
  assert.equal(c.spans[0].finishes.length, 1);
  assert.equal(c.spans[0].received, 2);
  assert.deepEqual(c.sockets, [[socket, 'redis']]);
  undo();
  assert.equal(client.sendCommand.name, 'sendCommand');
});

test('Redis rejected commands retain their rejection and diagnostic callback is handled', async () => {
  const client = new EventEmitter();
  client.sendCommand = (command) => command.promise;
  const c = collector();
  instrumentRedis(client, c);
  const failure = new Error('unavailable');
  const command = { name: 'AUTH', args: ['credential'], promise: Promise.reject(failure) };
  await assert.rejects(client.sendCommand(command), failure);
  await flush();
  assert.equal(c.spans[0].finishes[0].error, failure);
  assert.doesNotMatch(c.spans[0].input.example, /credential/);
});

test('MySQL pool and leased connections observe rows without serializing them and undo cleanly', async () => {
  const pool = new EventEmitter();
  const rows = [{ private: 'do-not-stringify' }, { private: 'still-private' }];
  const queryResult = Promise.resolve([rows, []]);
  pool.query = function query(sql) { assert.equal(this, pool); return queryResult; };
  pool.execute = () => Promise.resolve([{ affectedRows: 3 }, []]);
  const leased = { stream: {} };
  leased.query = () => Promise.resolve([[{ id: 1 }], []]);
  leased.execute = () => Promise.resolve([[{ id: 2 }], []]);
  const leasedQuery = leased.query;
  pool.getConnection = () => Promise.resolve(leased);
  const c = collector();
  const undo = instrumentMysqlPool(pool, c);
  const promise = pool.query("SELECT * FROM user WHERE password = 'never recorded'");
  assert.equal(promise, queryResult);
  assert.equal((await promise)[0], rows);
  const connection = await pool.getConnection(); await flush();
  await connection.query('SELECT 1'); await flush();
  assert.equal(c.spans[0].finishes[0].rows, 2);
  assert.doesNotMatch(c.spans[0].input.example, /never recorded/);
  assert.ok(c.sockets.some(([, label]) => label === 'mysql'));
  undo();
  assert.equal(pool.query.name, 'query');
  assert.equal(leased.query, leasedQuery);
});

test('CycleTLS proxy preserves callable properties and original promise; text observer does not consume streams', async () => {
  const c = collector();
  const exit = () => 'closed';
  const result = Promise.resolve({ status: 201, body: 'réponse' });
  function cycle(url, options) { assert.equal(this.marker, 1); assert.equal(url, 'https://a.example/item'); assert.equal(options.body, 'request'); return result; }
  cycle.exit = exit;
  const wrapped = wrapCycleTLS(cycle, c);
  assert.equal(wrapped.exit, exit);
  assert.equal(wrapped.call({ marker: 1 }, 'https://a.example/item', { body: 'request' }, 'post'), result);
  await result; await flush();
  assert.equal(c.spans[0].input.byteMode, 'decoded-body');
  assert.match(c.spans[0].input.operation, /^POST /);
  assert.equal(c.spans[0].received, Buffer.byteLength('réponse'));
  const impitResult = Promise.resolve({ statusCode: 200, body: 'text' });
  assert.equal(observeTextRequest(c, 'impit', 'https://b.example/', {}, () => impitResult), impitResult);
  await impitResult; await flush();
  assert.equal(c.spans[1].input.kind, 'impit');
});

test('pendant la chauffe aucun libellé ni span n’est calculé, et les réponses entières sont mesurées', async () => {
  const client = new EventEmitter();
  client.sendCommand = (command) => command.promise;
  const c = collector();
  c.recording = false;
  instrumentRedis(client, c);
  const warm = { name: 'INCR', args: ['rate-limit:sync:post:198.51.100.189'], promise: Promise.resolve(41) };
  await client.sendCommand(warm); await flush();
  assert.equal(c.spans.length, 0, 'la chauffe est exclue : pas de travail de sonde');
  c.recording = true;
  const measured = { name: 'INCR', args: ['rate-limit:sync:post:198.51.100.189'], promise: Promise.resolve(42) };
  await client.sendCommand(measured); await flush();
  assert.equal(c.spans.length, 1);
  assert.equal(c.spans[0].received, 2);
  assert.deepEqual(c.warnings, [], 'un entier n’est pas une réponse « non mesurée »');
  c.recording = false;
  const cycle = wrapCycleTLS(() => Promise.resolve({ status: 200, body: 'x' }), c);
  await cycle('https://a.example/'); await flush();
  assert.equal(observeTextRequest(c, 'impit', 'https://b.example/', {}, () => 'direct'), 'direct');
  assert.equal(c.spans.length, 1);
});

test('inactive collectors install no wrappers', () => {
  const redis = { sendCommand() {} };
  const mysql = { query() {} };
  const redisOriginal = redis.sendCommand;
  const mysqlOriginal = mysql.query;
  assert.equal(wrapCycleTLS(() => {}, { active: false }).name, '');
  instrumentRedis(redis, { active: false });
  instrumentMysqlPool(mysql, { active: false });
  assert.equal(redis.sendCommand, redisOriginal);
  assert.equal(mysql.query, mysqlOriginal);
});
