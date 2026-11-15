'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const { Agent } = require('agent-base');
const { isSecureEndpoint } = require('../agentBaseFastProtocol');

// Agent qui note ce que Node lui demande, sans ouvrir de connexion.
class RecordingAgent extends Agent {
  constructor() {
    super();
    this.seen = [];
  }
  async connect(req, options) {
    this.seen.push({ secureEndpoint: options.secureEndpoint, port: options.port });
    throw Object.assign(new Error('pas de réseau dans ce test'), { code: 'TEST_NO_NETWORK' });
  }
}

function send(mod, agent, options = {}) {
  return new Promise((resolve) => {
    const req = mod.request({ host: 'example.invalid', path: '/', agent, ...options });
    req.on('error', (error) => resolve(error));
    req.end();
  });
}

test('le prototype d’agent-base utilise la détection sans pile formatée', () => {
  assert.equal(Agent.prototype.isSecureEndpoint, isSecureEndpoint);
});

test('https.request sans protocole ni port : https et port 443 devinés', async () => {
  const agent = new RecordingAgent();
  assert.equal(agent.protocol, 'http:', 'hors de https.request, c’est http');
  const error = await send(https, agent);
  assert.equal(error.code, 'TEST_NO_NETWORK');
  assert.deepEqual(agent.seen, [{ secureEndpoint: true, port: 443 }]);
});

test('http.request sans protocole ni port : http et port 80 devinés', async () => {
  const agent = new RecordingAgent();
  const error = await send(http, agent);
  assert.equal(error.code, 'TEST_NO_NETWORK');
  assert.deepEqual(agent.seen, [{ secureEndpoint: false, port: 80 }]);
});

test('protocole explicite ou secureEndpoint transmis : aucune pile lue', () => {
  const prepare = Error.prepareStackTrace;
  let formatted = 0;
  Error.prepareStackTrace = (error, sites) => { formatted++; return prepare ? prepare(error, sites) : String(error); };
  try {
    assert.equal(isSecureEndpoint({ protocol: 'https:' }), true);
    assert.equal(isSecureEndpoint({ protocol: 'http:' }), false);
    assert.equal(isSecureEndpoint({ secureEndpoint: true, protocol: 'http:' }), true);
    assert.equal(formatted, 0);
    // La détection par la pile ne passe pas non plus par le formateur installé.
    assert.equal(isSecureEndpoint(), false);
    assert.equal(formatted, 0);
  } finally {
    Error.prepareStackTrace = prepare;
  }
});

test('la limite et le formateur de pile sont restaurés', () => {
  const limit = Error.stackTraceLimit;
  const formatter = (error) => `formaté:${error.message}`;
  Error.prepareStackTrace = formatter;
  try {
    isSecureEndpoint();
    assert.equal(Error.stackTraceLimit, limit);
    assert.equal(Error.prepareStackTrace, formatter);
    assert.equal(new Error('x').stack, 'formaté:x');
  } finally {
    Error.prepareStackTrace = undefined;
  }
});
