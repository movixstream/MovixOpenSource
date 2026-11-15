const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { readFStreamChallengeCookie, adoptFStreamChallengeCookie } = require('../fstreamChallenge');

function fixture() {
  const filename = path.join(__dirname, '..', 'cacheManager.js');
  const source = fs.readFileSync(filename, 'utf8');
  // Isolate the request coordinator without loading Redis or creating caches.
  const section = source.slice(source.indexOf('const ongoingFStreamRequests'), source.indexOf('const generateFStreamCacheKey'));
  const timers = new Set();
  const context = {
    setTimeout(callback, delay) {
      const timer = { callback, delay };
      timers.add(timer);
      return timer;
    },
    clearTimeout(timer) { timers.delete(timer); },
  };
  vm.runInNewContext(`${section}\nthis.request = getOrCreateFStreamRequest;`, context, { filename });
  return { request: context.request, timers };
}

test('FStream limits caller waits to 8 seconds without starting a duplicate scrape', async () => {
  const { request, timers } = fixture();
  let finish, calls = 0;
  const gate = new Promise(resolve => { finish = resolve; });
  const scrape = async () => { calls++; return gate; };
  const first = request('key', scrape);
  try {
    assert.equal(timers.size, 1, 'the HTTP caller must have a deadline');
    const timer = [...timers][0];
    assert.equal(timer.delay, 8000);
    const rejected = assert.rejects(first, /timeout of 8000ms exceeded/);
    timer.callback();
    await rejected;
    assert.equal(timers.size, 0);

    const second = request('key', scrape);
    finish('ready');
    assert.equal(await second, 'ready');
    assert.equal(calls, 1, 'a timed-out waiter must not forget the active scrape');
    assert.equal(timers.size, 0);
  } finally {
    finish('ready');
    await first.catch(() => {});
  }
});

test('FStream clears its deadline and in-flight entry after completion', async () => {
  const { request, timers } = fixture();
  let calls = 0;
  const scrape = async () => ++calls;
  assert.equal(await request('key', scrape), 1);
  assert.equal(await request('key', scrape), 2);
  assert.equal(timers.size, 0);
});

test('les POST FrenchStream hérités ciblent directement le domaine canonique sans perdre leur formulaire', async () => {
  const filename = path.join(__dirname, '..', 'axiosHelpers.js');
  const source = fs.readFileSync(filename, 'utf8');
  const section = source.slice(source.indexOf('function withOptionalFStreamCookies('), source.indexOf('function isAnimeSamaRetriableError('));
  const { canonicalFStreamUrl, FSTREAM_BASE_URL } = require('../../config/fstream');
  const sent = [];
  const context = {
    canonicalFStreamUrl, URL, ENABLE_FSTREAM_PROXY: false, adoptFStreamChallengeCookie,
    deps: { FSTREAM_BASE_URL, fstreamCookies: {}, ensureFStreamSession: async () => {},
      incrementFstreamRequestCounter() {}, axiosFStream: async config => { sent.push(config); return { status: 200 }; } },
  };
  vm.runInNewContext(`${section}\nthis.request = axiosFStreamRequest;`, context, { filename });
  const data = new URLSearchParams({ query: 'Chicago Fire', page: '1' });
  const legacy = { method: 'post', url: 'https://french-stream.one/engine/ajax/search.php', data,
    headers: { Origin: 'https://french-stream.one', Referer: 'https://french-stream.one/s-tv/', 'Content-Type': 'application/x-www-form-urlencoded' } };
  await context.request(legacy);
  assert.equal(sent[0].url, `${FSTREAM_BASE_URL}/engine/ajax/search.php`);
  assert.equal(sent[0].method, 'post');
  assert.equal(sent[0].data.toString(), 'query=Chicago+Fire&page=1');
  assert.equal(sent[0].headers.Referer, `${FSTREAM_BASE_URL}/s-tv/`);
  assert.equal(sent[0].headers.Origin, FSTREAM_BASE_URL);
  assert.equal(legacy.url, 'https://french-stream.one/engine/ajax/search.php', 'ne pas modifier la configuration partagée de l’appelant');
  await context.request({ url: '/films/', baseURL: 'https://french-stream.one/' });
  assert.equal(sent[1].baseURL, `${FSTREAM_BASE_URL}/`);
  await context.request({ url: 'https://player.test/embed/video' });
  assert.equal(sent[2].url, 'https://player.test/embed/video');
});

// Extrait de la page servie par French-Stream le 2026-10-19.
const CHALLENGE = '<!doctype html><html lang="fr"><head><title>Verification...</title></head><body>'
  + '<h2>Verification de votre navigateur...</h2><script>(function(){function sc(){try{var d=new Date();'
  + 'd.setTime(d.getTime()+86400000);document.cookie="fsschal=k7x2m9q4v3b8; path=/; expires="+d.toUTCString();'
  + 'document.cookie="fsschal=k7x2m9q4v3b8; path=/; max-age=86400";}catch(e){}}sc();})();</script></body></html>';

test('la valeur du cookie anti-robot se lit dans la page du challenge, et nulle part ailleurs', () => {
  assert.equal(readFStreamChallengeCookie(CHALLENGE), 'k7x2m9q4v3b8');
  assert.equal(readFStreamChallengeCookie('<div class="search-item">fsschal=1</div>'), null);
  assert.equal(readFStreamChallengeCookie({ players: {} }), null);
  assert.equal(readFStreamChallengeCookie('document.cookie="fsschal=a\r\nX-Injected: 1"'), 'a');

  const cookies = { fsschal: '1' };
  assert.equal(adoptFStreamChallengeCookie(cookies, { data: CHALLENGE }), true);
  assert.equal(cookies.fsschal, 'k7x2m9q4v3b8');
  assert.equal(adoptFStreamChallengeCookie(cookies, { data: CHALLENGE }), false, 'même valeur : pas de renvoi en boucle');
});

test('axiosFStreamRequest renvoie la requête une fois avec le nouveau cookie fsschal', async () => {
  const filename = path.join(__dirname, '..', 'axiosHelpers.js');
  const source = fs.readFileSync(filename, 'utf8');
  const section = source.slice(source.indexOf('function withOptionalFStreamCookies('), source.indexOf('function isAnimeSamaRetriableError('));
  const { FSTREAM_BASE_URL } = require('../../config/fstream');
  const sent = [];
  const fstreamCookies = { dle_skin: 'VFV25', fsschal: '1' };
  let counted = 0;
  const context = {
    canonicalFStreamUrl: value => value, URL, ENABLE_FSTREAM_PROXY: false, adoptFStreamChallengeCookie,
    console: { warn() {} },
    deps: { FSTREAM_BASE_URL, fstreamCookies, ensureFStreamSession: async () => {},
      incrementFstreamRequestCounter() { counted++; },
      axiosFStream: async config => {
        sent.push(config.headers.Cookie);
        return { status: 200, data: config.headers.Cookie.includes('fsschal=k7x2m9q4v3b8') ? '<div class="search-item"></div>' : CHALLENGE };
      } },
  };
  vm.runInNewContext(`${section}\nthis.request = axiosFStreamRequest;`, context, { filename });
  const response = await context.request({ method: 'post', url: `${FSTREAM_BASE_URL}/engine/ajax/search.php` });
  assert.equal(response.data, '<div class="search-item"></div>');
  assert.deepEqual(sent, ['dle_skin=VFV25; fsschal=1', 'dle_skin=VFV25; fsschal=k7x2m9q4v3b8']);
  assert.equal(counted, 1);
  await context.request({ method: 'get', url: `${FSTREAM_BASE_URL}/films/` });
  assert.equal(sent.length, 3, 'les requêtes suivantes partent directement avec la bonne valeur');
});
