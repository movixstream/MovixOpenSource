const assert = require('node:assert/strict');
const test = require('node:test');

const proxyManager = require('../proxyManager');

test('CycleTLS assigns a distinct local port to every cluster worker', () => {
  assert.deepEqual(proxyManager.cycleTlsInitOptions(1), { port: 9120 });
  assert.deepEqual(proxyManager.cycleTlsInitOptions(2), { port: 9121 });
  assert.deepEqual(proxyManager.cycleTlsInitOptions(6), { port: 9125 });
});
