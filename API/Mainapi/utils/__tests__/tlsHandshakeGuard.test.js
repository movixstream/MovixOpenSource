'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const tls = require('node:tls');
const https = require('node:https');
const v8 = require('node:v8');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { installTlsHandshakeGuard } = require('../tlsHandshakeGuard');

v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc');

// Serveur qui coupe dès le ClientHello, comme frenchcloud.cam.
async function resettingServer(onConnection = (socket) => socket.once('data', () => socket.destroy())) {
  const server = net.createServer((socket) => { socket.on('error', () => {}); onConnection(socket); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

function get(url, agent) {
  return new Promise((resolve) => {
    https.get(url, { agent }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', (error) => resolve(error.code));
  });
}

test('une coupure pendant la négociation TLS ne laisse plus de TLSSocket en mémoire', async () => {
  class GuardedAgent extends https.Agent {}
  assert.equal(installTlsHandshakeGuard({ Agent: GuardedAgent }), true);
  assert.equal(installTlsHandshakeGuard({ Agent: GuardedAgent }), false);
  const server = await resettingServer();
  const agent = new GuardedAgent({ keepAlive: true });
  const url = `https://localhost:${server.address().port}/x`;
  try {
    for (let round = 0; round < 6; round++) {
      const codes = await Promise.all(Array.from({ length: 25 }, () => get(url, agent)));
      assert.ok(codes.every((code) => code === 'ECONNRESET'), codes.join(','));
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    gc(); gc();
    const alive = v8.queryObjects(tls.TLSSocket, { format: 'count' });
    assert.ok(alive < 5, `${alive} TLSSocket encore vivants après 150 échecs`);
  } finally {
    agent.destroy();
    server.close();
  }
});

test('une négociation qui ne répond jamais échoue après le délai', async () => {
  class SlowAgent extends https.Agent {}
  installTlsHandshakeGuard({ Agent: SlowAgent, handshakeTimeoutMs: 150 });
  const server = await resettingServer(() => {});
  const agent = new SlowAgent();
  try {
    const started = Date.now();
    assert.equal(await get(`https://localhost:${server.address().port}/x`, agent), 'ETIMEDOUT');
    assert.ok(Date.now() - started < 2000);
  } finally {
    agent.destroy();
    server.close();
  }
});

function fakeAgent() {
  const socket = Object.assign(new EventEmitter(), { destroy(error) { if (error) this.emit('error', error); this.emit('close'); } });
  class FakeAgent { createConnection() { return socket; } }
  installTlsHandshakeGuard({ Agent: FakeAgent, handshakeTimeoutMs: 1000 });
  return { agent: new FakeAgent(), socket };
}

test('la socket est remise à la requête après secureConnect, et les appels directs gardent le retour de Node', async () => {
  const direct = fakeAgent();
  assert.equal(direct.agent.createConnection({}), direct.socket);

  const { agent, socket } = fakeAgent();
  const calls = [];
  assert.equal(agent.createConnection({}, (error, s) => calls.push([error, s])), undefined);
  assert.deepEqual(calls, []);
  socket.emit('secureConnect');
  assert.deepEqual(calls, [[null, socket]]);
  // Après la remise, les écouteurs du garde sont partis : une erreur tardive
  // appartient à la requête, plus au rappel.
  assert.equal(socket.listenerCount('error'), 0);
  assert.equal(socket.listenerCount('close'), 0);
});

test('une fermeture sans erreur avant la négociation rend une erreur au lieu de bloquer la requête', () => {
  const { agent, socket } = fakeAgent();
  const calls = [];
  agent.createConnection({}, (error) => calls.push(error?.code));
  socket.emit('close');
  socket.emit('secureConnect');
  assert.deepEqual(calls, ['ECONNRESET']);
});
