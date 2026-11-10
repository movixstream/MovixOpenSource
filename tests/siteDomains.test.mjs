import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// La liste des domaines du site est lue sur movix.online (address.json) par
// l'extension et le userscript. Ces tests font tourner le bloc
// « SITE DOMAINS » de chaque fichier avec de faux navigateurs.

function readRepoFile(file) {
  return fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
}

function readBlock(file) {
  return readRepoFile(file)
    .split('// BEGIN SITE DOMAINS')[1]
    .split('// END SITE DOMAINS')[0];
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

// Les valeurs sorties d'un contexte vm ont d'autres prototypes : on les
// recopie avant de les comparer.
const plain = (value) => JSON.parse(JSON.stringify(value));

const ADDRESS_PAYLOAD = {
  active: [
    { url: 'https://movix.miami' },
    { url: 'https://movix.dog' },
    { url: 'https://Movix.Neuf/' },
    { url: 'http://movix.http' },
    { url: 'https://192.168.1.1' },
    { url: 'https://localhost' },
    { url: 'https://movix.port:8443' },
    { url: 'https://user:pass@movix.identifiants' },
    { url: 'pas une url' },
    {},
    null,
  ],
  blocked: [{ url: 'https://movix.club' }],
};
const REMOTE_DOMAINS = ['movix.miami', 'movix.dog', 'movix.neuf'];
const LOCAL_HOSTS = ['localhost', '127.0.0.1'];

// --- Extension -------------------------------------------------------------

async function startExtension(browser, { stored, respond }) {
  const storage = stored ? { siteDomains: stored } : {};
  const alarms = new Map();
  const state = {
    fetches: 0,
    scripts: [],
    rules: [
      {
        id: 1,
        priority: 1,
        action: { type: 'modifyHeaders' },
        condition: { urlFilter: '*', initiatorDomains: ['ancien.example'] },
      },
      { id: 100, priority: 2, condition: { urlFilter: '*lecture.example/*' } },
    ],
  };
  const api = {
    storage: {
      local: {
        get: async (key) => ({ [key]: storage[key] }),
        set: async (values) => {
          Object.assign(storage, values);
        },
      },
    },
    scripting: {
      getRegisteredContentScripts: async () => state.scripts,
      registerContentScripts: async (scripts) => {
        state.scripts = [...state.scripts, ...scripts];
      },
      unregisterContentScripts: async ({ ids }) => {
        state.scripts = state.scripts.filter((script) => !ids.includes(script.id));
      },
    },
    runtime: {
      getManifest: () => JSON.parse(readRepoFile(`extension/${browser}/manifest.json`)),
    },
    declarativeNetRequest: {
      getDynamicRules: async () => state.rules,
      updateDynamicRules: async ({ removeRuleIds = [], addRules = [] }) => {
        state.rules = state.rules
          .filter((rule) => !removeRuleIds.includes(rule.id))
          .concat(addRules);
      },
    },
    alarms: {
      get: async (name) => alarms.get(name),
      create: (name, info) => {
        alarms.set(name, info);
      },
      onAlarm: { addListener() {} },
    },
  };
  const context = vm.createContext({
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    chrome: api,
    browserAPI: api,
    fetch: async () => {
      state.fetches += 1;
      return respond();
    },
  });
  const site = vm.runInContext(
    `${readBlock(`extension/${browser}/background.js`)}
    ({
      ready: siteDomainsReady,
      refresh: refreshSiteDomains,
      domains: () => [...MOVIX_SITE_DOMAINS],
      queue: () => siteDomainsSyncQueue,
    });`,
    context,
  );
  await site.ready;
  await settle();
  await site.queue();
  return {
    site: { domains: () => plain(site.domains()) },
    state: {
      get fetches() {
        return state.fetches;
      },
      get scripts() {
        return plain(state.scripts);
      },
      get rules() {
        return plain(state.rules);
      },
    },
    storage: plain(storage),
    alarms,
  };
}

const jsonResponse = (payload) => () => new Response(JSON.stringify(payload));

for (const browser of ['Chrome', 'Firefox']) {
  test(`extension ${browser} : liste intégrée tant que movix.online ne répond pas`, async () => {
    const { site, state, storage } = await startExtension(browser, {
      respond: () => {
        throw new Error('hors ligne');
      },
    });

    assert.equal(state.fetches, 1);
    assert.deepEqual(site.domains().slice(0, 2), LOCAL_HOSTS);
    assert.ok(site.domains().includes('movix.miami'));
    assert.ok(site.domains().includes('movix.club'));
    assert.deepEqual(state.scripts, []);
    assert.deepEqual(state.rules[0].condition.initiatorDomains, ['ancien.example']);
    assert.equal(storage.siteDomains.domains, null);
    // Nouvel essai dans le quart d'heure, pas dans l'heure.
    const delay = storage.siteDomains.nextCheckAt - Date.now();
    assert.ok(delay > 10 * 60000 && delay <= 15 * 60000, String(delay));
  });

  test(`extension ${browser} : la liste de movix.online remplace la liste intégrée`, async () => {
    const { site, state, storage, alarms } = await startExtension(browser, {
      respond: jsonResponse(ADDRESS_PAYLOAD),
    });

    assert.deepEqual(site.domains(), [...LOCAL_HOSTS, ...REMOTE_DOMAINS]);
    assert.deepEqual(storage.siteDomains.domains, REMOTE_DOMAINS);
    // Seul le domaine absent du manifest est enregistré dynamiquement.
    assert.equal(state.scripts.length, 1);
    assert.deepEqual(
      [...state.scripts[0].matches],
      ['https://movix.neuf/*', 'https://*.movix.neuf/*'],
    );
    assert.deepEqual([...state.scripts[0].js], ['content.js']);
    assert.equal(state.scripts[0].runAt, 'document_start');
    // La règle CORS suit la liste, les autres règles restent en place.
    const corsRule = state.rules.find((rule) => rule.id === 1);
    assert.deepEqual([...corsRule.condition.initiatorDomains], site.domains());
    assert.equal(corsRule.condition.urlFilter, '*');
    assert.ok(state.rules.some((rule) => rule.id === 100));
    assert.equal(alarms.get('movix-site-domains').periodInMinutes, 60);
    const delay = storage.siteDomains.nextCheckAt - Date.now();
    assert.ok(delay > 55 * 60000 && delay <= 60 * 60000, String(delay));
  });

  test(`extension ${browser} : le cache est relu au démarrage, sans requête avant l'heure`, async () => {
    const { site, state } = await startExtension(browser, {
      stored: { domains: ['movix.neuf'], nextCheckAt: Date.now() + 30 * 60000 },
      respond: jsonResponse(ADDRESS_PAYLOAD),
    });

    assert.equal(state.fetches, 0);
    assert.deepEqual(site.domains(), [...LOCAL_HOSTS, 'movix.neuf']);
    assert.deepEqual(
      [...state.scripts[0].matches],
      ['https://movix.neuf/*', 'https://*.movix.neuf/*'],
    );
  });

  test(`extension ${browser} : une réponse illisible garde la liste en cache`, async () => {
    for (const payload of [{ active: [] }, { active: 'movix.pirate' }, null, 'texte']) {
      const { site, state, storage } = await startExtension(browser, {
        stored: { domains: ['movix.neuf'], nextCheckAt: 0 },
        respond: jsonResponse(payload),
      });

      assert.equal(state.fetches, 1);
      assert.deepEqual(site.domains(), [...LOCAL_HOSTS, 'movix.neuf']);
      assert.deepEqual(storage.siteDomains.domains, ['movix.neuf']);
    }
  });

  test(`extension ${browser} : un domaine repris par le manifest n'est plus enregistré deux fois`, async () => {
    const { site, state } = await startExtension(browser, {
      stored: { domains: ['movix.neuf'], nextCheckAt: 0 },
      respond: jsonResponse({ active: [{ url: 'https://movix.miami' }] }),
    });

    assert.deepEqual(site.domains(), [...LOCAL_HOSTS, 'movix.miami']);
    assert.deepEqual(state.scripts, []);
  });
}

// --- Userscript ------------------------------------------------------------

function startUserscript({ hostname, values = new Map(), payload, managed = true }) {
  const session = new Map();
  const state = { reloads: 0, requests: 0, values };
  const context = vm.createContext({
    URL,
    location: {
      hostname,
      reload() {
        state.reloads += 1;
      },
    },
    sessionStorage: {
      getItem: (key) => (session.has(key) ? session.get(key) : null),
      setItem: (key, value) => {
        session.set(key, value);
      },
    },
    GM_getValue: (key, fallback) => (values.has(key) ? values.get(key) : fallback),
    getGMRequest: () => (details) => {
      state.requests += 1;
      queueMicrotask(() => {
        if (payload === undefined) details.onerror({});
        else details.onload({ status: 200, responseText: JSON.stringify(payload) });
      });
    },
    gmSetValueCompat: async (key, value) => {
      values.set(key, value);
    },
    ...(managed ? { GM_info: { scriptHandler: 'Tampermonkey' } } : {}),
  });
  // Le bloc quitte le script par un `return` sur un domaine refusé : la
  // fonction rend alors undefined.
  state.started = vm.runInContext(
    `(() => {${readBlock('userscript/movix.user.js')}
      return { isSiteHost, domains: () => [...siteDomains] };
    })()`,
    context,
  );
  if (state.started) {
    const { isSiteHost, domains } = state.started;
    state.started = { isSiteHost, domains: () => plain(domains()) };
  }
  state.stored = () => plain(values.get('movix_site_domains'));
  return state;
}

test('userscript : démarre sur un domaine de la liste intégrée', async () => {
  const state = startUserscript({ hostname: 'movix.miami', payload: ADDRESS_PAYLOAD });
  assert.ok(state.started);
  assert.equal(state.started.isSiteHost('www.movix.miami'), true);
  assert.equal(state.started.isSiteHost('movix.miami.pirate.example'), false);

  await settle();
  assert.equal(state.requests, 1);
  assert.deepEqual(state.started.domains(), REMOTE_DOMAINS);
  assert.deepEqual(state.stored().domains, REMOTE_DOMAINS);
  assert.equal(state.reloads, 0);
});

test('userscript : un domaine tout neuf recharge la page une fois, puis démarre', async () => {
  const first = startUserscript({ hostname: 'movix.neuf', payload: ADDRESS_PAYLOAD });
  assert.equal(first.started, undefined);
  await settle();
  assert.equal(first.requests, 1);
  assert.equal(first.reloads, 1);

  const second = startUserscript({
    hostname: 'movix.neuf',
    values: first.values,
    payload: ADDRESS_PAYLOAD,
  });
  assert.ok(second.started);
  await settle();
  assert.equal(second.requests, 0);
  assert.equal(second.reloads, 0);
});

test('userscript : reste éteint sur un faux domaine, sans requête à chaque page', async () => {
  const first = startUserscript({ hostname: 'movix.bet', payload: ADDRESS_PAYLOAD });
  assert.equal(first.started, undefined);
  await settle();
  assert.equal(first.requests, 1);
  assert.equal(first.reloads, 0);

  const second = startUserscript({
    hostname: 'movix.bet',
    values: first.values,
    payload: ADDRESS_PAYLOAD,
  });
  assert.equal(second.started, undefined);
  await settle();
  assert.equal(second.requests, 0);
  assert.equal(second.reloads, 0);
});

test('userscript : un domaine retiré de movix.online n\'est plus servi', async () => {
  const values = new Map([
    ['movix_site_domains', { domains: ['movix.miami'], checkedAt: Date.now() }],
  ]);
  const state = startUserscript({ hostname: 'movix.club', values, payload: ADDRESS_PAYLOAD });
  assert.equal(state.started, undefined);
  await settle();
  assert.equal(state.reloads, 0);
});

test('userscript : movix.online injoignable garde la liste et réessaie plus tard', async () => {
  const state = startUserscript({ hostname: 'movix.miami' });
  assert.ok(state.started);
  await settle();
  assert.equal(state.requests, 1);
  assert.ok(state.started.domains().includes('movix.club'));
  const stored = state.stored();
  assert.equal(stored.domains, null);
  assert.equal(stored.failed, true);
});

test('userscript : dans l\'app (sans GM_info), aucun arrêt selon le domaine', async () => {
  const state = startUserscript({
    hostname: 'adresse.inconnue.example',
    payload: ADDRESS_PAYLOAD,
    managed: false,
  });
  assert.ok(state.started);
  await settle();
  assert.equal(state.reloads, 0);
});

test('userscript : l\'en-tête couvre tout movix.<extension>, et rien d\'autre', () => {
  const header = readRepoFile('userscript/movix.user.js').split('// ==/UserScript==')[0];
  const include = /^\/\/ @include\s+\/(.+)\/$/m.exec(header);
  assert.ok(include, 'ligne @include absente');
  const pattern = new RegExp(include[1]);
  for (const url of ['https://movix.neuf/', 'https://www.movix.miami/movie/1?x=1']) {
    assert.equal(pattern.test(url), true, url);
  }
  for (const url of [
    'http://movix.neuf/',
    'https://movix.pirate.example/',
    'https://pirate.example/https://movix.neuf/',
    'https://notmovix.neuf/',
    'https://movixtv.com/',
  ]) {
    assert.equal(pattern.test(url), false, url);
  }
});
