const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

test('TMDB movie alternative titles use the movie endpoint and cache namespace', async () => {
  const axiosCalls = [];
  const redisWrites = [];
  const redisDouble = {
    status: 'ready',
    async get() { return null; },
    async set(...args) { redisWrites.push(args); return 'OK'; },
  };
  const payload = { id: 9910, titles: [{ title: 'Movie Alias', iso_3166_1: 'US' }] };
  const axiosDouble = {
    async get(url, options) {
      axiosCalls.push([url, options]);
      return { data: payload };
    },
  };
  const originalLoad = Module._load;
  const tmdbPath = path.resolve(__dirname, '../../../utils/tmdbCache.js');
  delete require.cache[tmdbPath];
  Module._load = function load(request, parent, isMain) {
    if (request === 'axios') return axiosDouble;
    if (request === '../config/redis' && parent?.filename === tmdbPath) return { redis: redisDouble };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const { fetchTmdbAlternativeTitles, TTL_STABLE } = require(tmdbPath);
    assert.deepEqual(
      await fetchTmdbAlternativeTitles('https://api.themoviedb.org/3', 'test-key', 9910, 'movie'),
      payload,
    );
    assert.deepEqual(axiosCalls, [[
      'https://api.themoviedb.org/3/movie/9910/alternative_titles',
      { params: { api_key: 'test-key' }, timeout: 10_000 },
    ]]);
    // Titres quasi immuables : 30 jours, avec ±15 % d'écart par clé.
    const [[key, value, mode, ttl]] = redisWrites;
    assert.deepEqual([key, value, mode], [
      'tmdb:alternative_titles:movie:9910',
      JSON.stringify(payload),
      'EX',
    ]);
    assert.ok(ttl >= TTL_STABLE * 0.85 && ttl <= TTL_STABLE * 1.15);
  } finally {
    Module._load = originalLoad;
    delete require.cache[tmdbPath];
  }
});
