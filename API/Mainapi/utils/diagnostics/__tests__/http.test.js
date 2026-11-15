'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { gzipSync } = require('node:zlib');
const { once } = require('node:events');
const { createCollector } = require('../collector');
const { instrumentHttp, inboundMiddleware } = require('../http');

async function fixture(t, listener) {
  const server = http.createServer(listener);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}
function collect(url, options = {}, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ body: Buffer.concat(chunks), status: res.statusCode }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(body);
  });
}
function observe(t) {
  const collector = createCollector();
  const undo = instrumentHttp(collector);
  t.after(() => { collector.stop(); undo(); });
  return { collector, undo };
}

test('native requests preserve callbacks, UTF-8 writes, keepalive and encoded response bytes', async (t) => {
  const zip = gzipSync('large response'.repeat(2000));
  let uploaded = 0;
  const url = await fixture(t, (req, res) => {
    req.on('data', (chunk) => { uploaded += chunk.length; });
    req.on('end', () => { res.writeHead(200, { 'content-encoding': 'gzip' }); res.end(zip); });
  });
  const { collector } = observe(t);
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  t.after(() => agent.destroy());
  for (let i = 0; i < 3; i++) {
    const response = await collect(`${url}/api/items/123`, { method: 'POST', agent }, 'éabc');
    assert.deepEqual(response.body, zip);
  }
  const snapshot = collector.snapshot();
  const row = snapshot.groups.find((group) => group.kind === 'http');
  assert.equal(row.started, 3); assert.equal(row.completed, 3); assert.equal(row.failed, 0);
  assert.equal(row.sentBytes, uploaded); assert.equal(uploaded, 15);
  assert.equal(row.receivedBytes, 3 * zip.length);
  assert.equal(snapshot.sockets[0].connections, 1);
  assert.ok(snapshot.sockets[0].receivedBytes >= row.receivedBytes);
});

test('get preserves a paused response and write/end return values', async (t) => {
  const url = await fixture(t, (req, res) => { req.resume(); res.end('unchanged response'); });
  const { collector } = observe(t);
  const result = await new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      assert.equal(res.readableFlowing, null);
      setTimeout(async () => {
        try {
          assert.equal(res.readableFlowing, null);
          const chunks = []; for await (const chunk of res) chunks.push(chunk);
          resolve(Buffer.concat(chunks).toString());
        } catch (error) { reject(error); }
      }, 15);
    });
    req.once('error', reject);
    assert.ok(req instanceof http.ClientRequest);
  });
  assert.equal(result, 'unchanged response');
  assert.equal(collector.snapshot().groups[0].receivedBytes, Buffer.byteLength(result));
});

test('refused connections and aborted responses finish once as errors', async (t) => {
  const url = await fixture(t, (req, res) => {
    res.writeHead(200, { 'content-length': 2000 }); res.write('partial');
    setTimeout(() => res.destroy(), 10);
  });
  const { collector } = observe(t);
  await assert.rejects(collect(url));
  // Reserve then close a fixture port to get a deterministic local refusal.
  const closed = http.createServer(); closed.listen(0, '127.0.0.1'); await once(closed, 'listening');
  const port = closed.address().port; await new Promise((resolve) => closed.close(resolve));
  await assert.rejects(collect(`http://127.0.0.1:${port}/refused`));
  const groups = collector.snapshot().groups;
  assert.equal(groups.reduce((sum, row) => sum + row.completed, 0), 2);
  assert.equal(groups.reduce((sum, row) => sum + row.failed, 0), 2);
  assert.equal(collector.snapshot().openSpans, 0);
});

test('Axios redirect chains are counted as redirects, while the final HTTP failure stays an error', async (t) => {
  const axios = require('axios');
  const url = await fixture(t, (req, res) => {
    const index = Number(req.url.slice(1));
    if (index < 5) { res.writeHead([301, 302, 303, 307, 308][index], { location: `/${index + 1}` }); res.end('moved'); }
    else { res.statusCode = 500; res.end('final failure'); }
  });
  const { collector } = observe(t);
  await assert.rejects(axios.get(`${url}/0`, { proxy: false }), (error) => error.response?.status === 500);
  await new Promise((resolve) => setImmediate(resolve));
  const groups = collector.snapshot().groups;
  assert.equal(groups.reduce((sum, row) => sum + row.started, 0), 6);
  assert.equal(groups.reduce((sum, row) => sum + row.completed, 0), 6);
  assert.equal(groups.reduce((sum, row) => sum + row.failed, 0), 1);
  for (const status of [301, 302, 303, 307, 308, 500]) assert.equal(groups.reduce((sum, row) => sum + (row.statuses[status] || 0), 0), 1);
  assert.equal(collector.snapshot().openSpans, 0);
});

test('truncated redirect bodies remain errors when the client has not discarded them', async (t) => {
  const url = await fixture(t, (_req, res) => {
    res.writeHead(301, { 'content-length': 2000, location: '/target' }); res.write('partial');
    setTimeout(() => res.destroy(), 10);
  });
  const { collector } = observe(t);
  await assert.rejects(collect(url));
  assert.equal(collector.snapshot().groups[0].failed, 1);
  assert.equal(collector.snapshot().groups[0].statuses['301'], 1);
});

test('fetch uses Undici events without altering response decoding', async (t) => {
  const content = 'content from fetch'.repeat(3000), zip = gzipSync(content);
  const url = await fixture(t, (req, res) => { req.resume(); res.setHeader('content-encoding', 'gzip'); res.end(zip); });
  const { collector } = observe(t);
  const response = await fetch(url, { method: 'POST', body: 'hello' });
  assert.equal(await response.text(), content);
  const row = collector.snapshot().groups.find((entry) => entry.kind === 'fetch');
  assert.equal(row.completed, 1); assert.equal(row.failed, 0);
  if (row.byteMode === 'encoded-body') {
    assert.equal(row.receivedBytes, zip.length);
    assert.equal(row.sentBytes, 5);
  } else assert.equal(row.byteMode, 'unavailable');
});

test('inbound route context labels outgoing calls and compression counts wire body', async (t) => {
  const content = 'uncompressed text'.repeat(1000);
  const upstream = await fixture(t, (_req, res) => res.end('upstream'));
  const collector = createCollector();
  const originalRequest = http.request;
  const undo = instrumentHttp(collector);
  t.after(() => { collector.stop(); undo(); });
  const express = require('express'), compression = require('compression');
  const app = express(); app.use(inboundMiddleware(collector)); app.use(compression());
  app.get('/api/kisskh/tv/:id', async (_req, res) => {
    await collect(upstream); res.type('text/plain').send(content);
  });
  const url = await fixture(t, app);
  const response = await new Promise((resolve, reject) => {
    const req = originalRequest(`${url}/api/kisskh/tv/123`, { headers: { 'accept-encoding': 'gzip' } }, (res) => {
      const chunks = []; res.on('data', (chunk) => chunks.push(chunk)); res.on('end', () => resolve(Buffer.concat(chunks)));
    }); req.on('error', reject); req.end();
  });
  const snapshot = collector.snapshot();
  const inbound = snapshot.groups.find((group) => group.kind === 'inbound');
  const outgoing = snapshot.groups.find((group) => group.kind === 'http');
  assert.equal(inbound.sentBytes, response.length);
  assert.ok(response.length < Buffer.byteLength(content));
  assert.equal(outgoing.source, 'route GET /api/kisskh/tv/:id');
});

test('un rafraîchissement lancé après la réponse compressée est libellé comme travail détaché', async (t) => {
  const upstream = await fixture(t, (_req, res) => res.end('upstream'));
  const collector = createCollector();
  const originalRequest = http.request;
  const undo = instrumentHttp(collector);
  t.after(() => { collector.stop(); undo(); });
  const express = require('express'), compression = require('compression');
  const app = express(); app.use(inboundMiddleware(collector)); app.use(compression());
  let refreshed;
  const refresh = new Promise((resolve) => { refreshed = resolve; });
  app.get('/api/wiflix/movie/:id', async (_req, res) => {
    await collect(upstream);
    res.status(202).json({ status: 'pending', padding: 'x'.repeat(4000) });
    // Comme updateWiflixCache : lancé sans attente, juste après la réponse.
    collect(upstream).then(refreshed, refreshed);
  });
  const url = await fixture(t, app);
  await new Promise((resolve, reject) => {
    const req = originalRequest(`${url}/api/wiflix/movie/550`, { headers: { 'accept-encoding': 'gzip' } }, (res) => { res.resume(); res.on('end', resolve); });
    req.on('error', reject); req.end();
  });
  await refresh;
  const sources = collector.snapshot().groups.filter((group) => group.kind === 'http').map((group) => group.source).sort();
  assert.deepEqual(sources, ['background after route GET /api/wiflix/movie/:id', 'route GET /api/wiflix/movie/:id']);
});

test('pendant la chauffe, ni contexte de route ni enveloppe de requête, mais la socket reste suivie', async (t) => {
  const url = await fixture(t, (req, res) => { req.resume(); res.end('ok'); });
  const collector = createCollector({ paused: true });
  const undo = instrumentHttp(collector);
  t.after(() => { collector.stop(); undo(); });
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  t.after(() => agent.destroy());
  const warm = await new Promise((resolve, reject) => {
    const req = http.request(`${url}/warmup`, { agent }, (res) => { res.resume(); res.on('end', () => resolve(req)); });
    req.on('error', reject); req.end();
  });
  assert.equal(Object.hasOwn(warm, 'write'), false, 'aucune enveloppe write/end pendant la chauffe');
  let store = 'unset';
  inboundMiddleware(collector)({ originalUrl: '/api/x', method: 'GET' }, { once() {} }, () => { store = 'next'; });
  assert.equal(store, 'next');
  collector.begin();
  await collect(`${url}/measured`, { agent });
  const snapshot = collector.snapshot();
  assert.equal(snapshot.groups.length, 1);
  assert.equal(snapshot.groups[0].started, 1);
  assert.equal(snapshot.sockets[0].connections, 1, 'la socket keep-alive ouverte pendant la chauffe est comptée une fois');
});

test('undo detaches active request wrappers without cancelling the request', async (t) => {
  let respond;
  const waiting = new Promise((resolve) => { respond = resolve; });
  const url = await fixture(t, async (_req, res) => { await waiting; res.end('still succeeds'); });
  const original = http.request;
  const { collector, undo } = observe(t);
  const promise = collect(url);
  collector.stop(); undo();
  assert.equal(http.request, original);
  respond();
  assert.equal((await promise).body.toString(), 'still succeeds');
  assert.equal(collector.snapshot().groups[0].completed, 0);
});

test('Undici without body events reports unknown bytes instead of an observed zero', (t) => {
  const { collector } = observe(t);
  const channel = require('node:diagnostics_channel');
  const request = { origin: 'https://fixture.test', path: '/old-undici', method: 'GET' };
  channel.channel('undici:request:create').publish({ request });
  channel.channel('undici:request:headers').publish({ request, response: { statusCode: 200 } });
  channel.channel('undici:request:trailers').publish({ request });
  const group = collector.snapshot().groups[0];
  assert.equal(group.completed, 1);
  assert.equal(group.unknownResponses, 1);
});
