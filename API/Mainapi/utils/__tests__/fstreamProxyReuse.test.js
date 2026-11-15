'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const { once } = require('node:events');
const axios = require('axios');
const { HttpProxyAgent } = require('http-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { createProxyAgentPool } = require('../proxyAgentPool');

function fixture() {
  const filename = path.resolve(__dirname, '../proxyManager.js');
  const source = fs.readFileSync(filename, 'utf8');
  const fragment = (begin, end) => {
    const start = source.indexOf(begin), stop = source.indexOf(end, start);
    assert.ok(start > 0 && stop > start);
    return source.slice(start, stop);
  };
  const code = fragment('const fstreamAgentPool =', 'const fstreamAgentSweep =')
    + fragment('function normalizeProxyType(', 'function updateArrayInPlace(')
    + fragment('function acquireFStreamProxy(', '// Fonction utilitaire pour cr\\u00e9er un agent proxy SOCKS5');
  const context = vm.createContext({ HttpProxyAgent, HttpsProxyAgent, SocksProxyAgent, createProxyAgentPool });
  vm.runInContext(code + '\nglobalThis.api = { withFStreamProxy, acquireFStreamProxy, pool: fstreamAgentPool };', context, { filename });
  return context.api;
}

test('vingt requêtes FStream passent de vingt connexions à une sur un proxy HTTP local', async t => {
  let connections = 0;
  const proxy = http.createServer((_req, res) => res.end('HTML fixture'));
  proxy.on('connection', () => connections++);
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');
  const f = fixture();
  const baseline = new HttpProxyAgent(`http://127.0.0.1:${proxy.address().port}`);
  t.after(async () => { baseline.destroy(); f.pool.clear(); proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); });
  const config = { url: 'http://fixture.invalid/search', proxy: false, timeout: 2000 };
  for (let i = 0; i < 20; i++) await axios({ ...config, httpAgent: baseline });
  const before = connections;
  const entry = { type: 'darkino', proxy: { host: '127.0.0.1', port: proxy.address().port } };
  for (let i = 0; i < 20; i++) {
    const result = await f.withFStreamProxy(entry, agents => {
      assert.equal(agents.httpAgent.keepAlive, true);
      assert.equal(agents.httpsAgent.keepAlive, true);
      assert.equal(agents.httpsAgent.maxTotalSockets, 16);
      return axios({ ...config, httpAgent: agents.httpAgent, httpsAgent: agents.httpsAgent });
    });
    assert.equal(result.data, 'HTML fixture');
  }
  assert.equal(before, 20);
  assert.equal(connections - before, 1);
  t.diagnostic(`20 appels séquentiels au même proxy : ${before} connexions avant, ${connections - before} après`);
});

test('un échec retire l’agent sans interrompre un autre appel actif ; SOCKS reste réutilisable', async () => {
  const f = fixture();
  const entry = { type: 'socks5', proxy: { host: '127.0.0.1', port: 9 } };
  try {
    const active = f.acquireFStreamProxy(entry);
    assert.equal(active.httpAgent, active.httpsAgent);
    assert.equal(active.httpAgent.keepAlive, true);
    let destroyed = 0;
    active.httpAgent.destroy = () => { destroyed++; };
    await assert.rejects(f.withFStreamProxy(entry, async () => { throw new Error('timeout'); }), /timeout/);
    assert.equal(destroyed, 0);
    const replacement = f.acquireFStreamProxy(entry);
    assert.notEqual(replacement.httpAgent, active.httpAgent);
    replacement.release();
    active.release();
    assert.equal(destroyed, 1);
  } finally { f.pool.clear(); }
});
