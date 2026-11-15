'use strict';

// Un ID inconnu de TMDB (404) devient un mapping négatif PurStream : la visite
// suivante ne redemande ni TMDB ni la recherche PurStream. Un échec temporaire
// de TMDB (TMDB_TRANSIENT) ne doit jamais être gravé comme absent.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const { createWiflixRefreshState } = require('../../utils/wiflixRefreshState');

const routePath = path.join(__dirname, '..', 'purstream.js');
const routeSource = fs.readFileSync(routePath, 'utf8');

function createFixture(t, tmdbDetails, { missing = true } = {}) {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'purstream-tmdb-'));
  t.after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));

  const calls = { tmdb: [], axios: [], failures: [] };
  const modules = {
    express,
    axios: async ({ url }) => {
      calls.axios.push(url);
      if (url.endsWith('/api/status')) return { data: { domain: 'purstream.test' } };
      return { data: { type: 'success', data: { items: { movies: { items: [] } } } } };
    },
    '../utils/cacheManager': { CACHE_DIR: { PURSTREAM: cacheDir }, generateCacheKey: key => key },
    '../utils/tmdbCache': {
      fetchTmdbDetails: async (...args) => { calls.tmdb.push(args); return tmdbDetails(); },
      fetchTmdbImages: async () => null,
      // Marqueur 404 posé par fetchTmdbDetails ; faux pour un refus 401/403.
      isTmdbDetailsMissing: async () => missing,
    },
    '../utils/proxyManager': { pickRandomProxy: () => null, getProxyAgent: () => null },
    '../utils/mediaSigning': { buildSignedProxyUrl: url => url, signingConfigured: () => false },
    '../utils/wiflixRefreshState': { createWiflixRefreshState },
    '../utils/sourceRefreshTelemetry': {
      reportRefreshFailure: (reason, error) => calls.failures.push([reason, error?.code]),
    },
    '../config/redis': { redis: { status: 'end' } },
  };
  const routeModule = { exports: {} };
  const quiet = { ...console, warn: () => {}, error: () => {} };
  vm.compileFunction(routeSource, ['require', 'module', 'console'], { filename: routePath })((request) => {
    assert.ok(Object.hasOwn(modules, request), `Dépendance non simulée : ${request}`);
    return modules[request];
  }, routeModule, quiet);

  const router = routeModule.exports;
  router.configure({
    TMDB_API_URL: 'https://tmdb.test/3',
    TMDB_API_KEY: 'cle-test',
    getFromCacheNoExpiration: async (dir, key) => {
      try { return JSON.parse(fs.readFileSync(path.join(dir, `${key}.json`), 'utf8')); }
      catch { return null; }
    },
    saveToCache: async (dir, key, value) => {
      fs.writeFileSync(path.join(dir, `${key}.json`), JSON.stringify(value));
    },
  });

  const mapping = type => {
    try { return JSON.parse(fs.readFileSync(path.join(cacheDir, `purstream_map_${type}_1399.json`), 'utf8')); }
    catch { return null; }
  };
  const request = async (type) => {
    const handler = router.stack.find(layer => layer.route?.path === `/${type}/:tmdbId/stream`).route.stack[0].handle;
    const response = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    await handler({ params: { tmdbId: '1399' }, query: { season: '1', episode: '2' }, headers: {} }, response);
    return response;
  };
  return { calls, mapping, request };
}

for (const type of ['tv', 'movie']) {
  test(`${type} : un 404 TMDB devient un mapping négatif, sans nouvel appel TMDB ni alerte`, async (t) => {
    const fixture = createFixture(t, async () => null);

    const first = await fixture.request(type);
    assert.equal(first.statusCode, 404);
    assert.equal(fixture.calls.tmdb.length, 1);
    assert.deepEqual(fixture.calls.tmdb[0].slice(2), ['1399', type, 'fr-FR', { strict: true }],
      'PurStream demande le mode strict pour distinguer l’absent du temporaire');
    assert.deepEqual(fixture.mapping(type), { __not_found: true });
    assert.deepEqual(fixture.calls.failures, [], 'un ID inconnu n’est pas un échec d’actualisation');

    const second = await fixture.request(type);
    assert.equal(second.statusCode, 404);
    assert.equal(second.body.error, first.body.error, 'même réponse qu’avant');
    assert.equal(fixture.calls.tmdb.length, 1, 'la visite suivante ne redemande pas TMDB');
    assert.equal(fixture.calls.axios.filter(url => url.includes('/search-bar/')).length, 0,
      'aucune recherche PurStream pour un ID inconnu de TMDB');
  });

  test(`${type} : un refus TMDB qui n’est pas un 404 (clé API) n’écrit aucun négatif`, async (t) => {
    const fixture = createFixture(t, async () => null, { missing: false });

    const response = await fixture.request(type);
    assert.equal(response.statusCode, 404);
    assert.equal(fixture.mapping(type), null, 'pas de mapping négatif pour un 401/403');
    assert.equal(fixture.calls.failures.length, 1);
    assert.equal(fixture.calls.failures[0][0], 'mapping_refresh_failed');
  });

  test(`${type} : un échec temporaire de TMDB n’écrit aucun négatif`, async (t) => {
    const fixture = createFixture(t, async () => {
      throw Object.assign(new Error('TMDB temporairement indisponible (timeout)'), { code: 'TMDB_TRANSIENT', transient: true });
    });

    const response = await fixture.request(type);
    assert.equal(response.statusCode, 404);
    assert.equal(fixture.mapping(type), null, 'pas de mapping négatif pour une panne');
    assert.deepEqual(fixture.calls.failures, [['mapping_refresh_failed', 'TMDB_TRANSIENT']]);
  });
}
