import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

type Service = typeof import('../src/services/monetizationConfig.ts');

interface FakeResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

interface FakeAnchor {
  href: string;
  target: string;
  rel: string;
  clicked: boolean;
  click: () => void;
}

interface LoadOptions {
  stored?: string | null;
  adult?: boolean;
  mobile?: boolean;
  inApp?: boolean;
  language?: string;
  fetchImpl?: (url: string) => Promise<FakeResponse>;
}

const API = 'https://api.test';

const placement = (active: boolean, adultCount: number, sfwCount: number, windowsPerClick: number) => ({
  active, adultCount, sfwCount, windowsPerClick,
});

const config = (
  enabled: boolean,
  player = placement(true, 1, 1, 1),
  extra: Record<string, ReturnType<typeof placement>> = {},
) => ({
  enabled,
  adultDefault: true,
  placements: {
    player,
    download: placement(true, 1, 1, 1),
    livetv: placement(true, 1, 1, 1),
    swiftflux: placement(true, 1, 1, 1),
    ...extra,
  },
});

const okResponse = (body: unknown): FakeResponse => ({ ok: true, status: 200, json: async () => body });

function loadService(options: LoadOptions = {}) {
  const storage = new Map<string, string>();
  if (options.stored != null) storage.set('go_settings_cache', options.stored);
  const fakeLocalStorage = {
    getItem: (key: string) => (storage.has(key) ? storage.get(key) ?? null : null),
    setItem: (key: string, value: string) => { storage.set(key, String(value)); },
    removeItem: (key: string) => { storage.delete(key); },
  };

  const anchors: FakeAnchor[] = [];
  const fakeDocument = {
    createElement: (tag: string) => {
      assert.equal(tag, 'a');
      const anchor: FakeAnchor = {
        href: '', target: '', rel: '', clicked: false,
        click() { anchor.clicked = true; },
      };
      anchors.push(anchor);
      return anchor;
    },
    body: { appendChild: () => undefined, removeChild: () => undefined },
  };

  const fetchCalls: string[] = [];
  const fakeFetch = async (url: string) => {
    fetchCalls.push(url);
    if (!options.fetchImpl) throw new Error('fetch inattendu');
    return options.fetchImpl(url);
  };

  const adult = { value: options.adult ?? true };
  const modules: Record<string, unknown> = {
    '../utils/adAdultMode': { isAdultAdsEnabled: () => adult.value },
    '../utils/deviceDetection': { isMobileOrTabletDevice: () => options.mobile ?? false },
    '../utils/wrappedShareFile': { isMovixAppWebView: () => options.inApp ?? false },
    i18next: { language: options.language ?? 'fr-FR' },
  };

  const source = readFileSync(new URL('../src/services/monetizationConfig.ts', import.meta.url), 'utf8')
    .replaceAll('import.meta.env.VITE_MAIN_API', JSON.stringify(API));
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const exports = {};
  new Function('exports', 'require', 'localStorage', 'fetch', 'document', js)(
    exports,
    (name: string) => {
      assert.ok(Object.hasOwn(modules, name), `module inattendu : ${name}`);
      return modules[name];
    },
    fakeLocalStorage,
    fakeFetch,
    fakeDocument,
  );
  return { service: exports as Service, storage, anchors, fetchCalls, adult };
}

test('normalizePublicConfig rejette un objet sans placements et borne windowsPerClick à 1..3', () => {
  const { service } = loadService();
  assert.equal(service.normalizePublicConfig(null), null);
  assert.equal(service.normalizePublicConfig('oui'), null);
  assert.equal(service.normalizePublicConfig({ enabled: true, adultDefault: true }), null);
  assert.equal(service.normalizePublicConfig({ enabled: true, placements: 'player' }), null);

  const normalized = service.normalizePublicConfig({
    success: true,
    enabled: true,
    adultDefault: false,
    updatedAt: '2026-10-23T10:00:00.000Z',
    placements: {
      player: { active: true, adultCount: 2, sfwCount: -4, windowsPerClick: 9 },
      download: { active: true, adultCount: 1, sfwCount: 1, windowsPerClick: 0 },
      livetv: { active: 'oui', adultCount: 'x', sfwCount: 1.7, windowsPerClick: 2.9 },
    },
  });
  assert.deepEqual(normalized, {
    enabled: true,
    adultDefault: false,
    placements: {
      player: { active: true, adultCount: 2, sfwCount: 0, windowsPerClick: 3 },
      download: { active: true, adultCount: 1, sfwCount: 1, windowsPerClick: 1 },
      livetv: { active: false, adultCount: 0, sfwCount: 1, windowsPerClick: 2 },
      // Emplacement absent de la réponse : rien à ouvrir ici.
      swiftflux: { active: false, adultCount: 0, sfwCount: 0, windowsPerClick: 1 },
    },
  });
});

test('getAdWindowCount : adult 3 / sfw 1 / windowsPerClick 3 → 3 en +18, 1 en SFW ; sfwCount 0 → 0 ; enabled false → 0', () => {
  const { service } = loadService();
  const threeWindows = config(true, placement(true, 3, 1, 3));
  assert.equal(service.getAdWindowCount('player', true, threeWindows), 3);
  assert.equal(service.getAdWindowCount('player', false, threeWindows), 1);
  assert.equal(service.getAdWindowCount('player', true, config(true, placement(true, 3, 1, 1))), 1);
  assert.equal(service.getAdWindowCount('player', false, config(true, placement(true, 2, 0, 3))), 0);
  assert.equal(service.getAdWindowCount('player', true, config(false, placement(true, 3, 1, 3))), 0);
  assert.equal(service.getAdWindowCount('player', true, config(true, placement(false, 3, 1, 3))), 0);
});

test('hasAdToOpen suit le choix +18 du visiteur : seulement des pubs adult et +18 coupé → rien', () => {
  const stored = JSON.stringify(config(true, placement(true, 2, 0, 1)));
  const { service, adult } = loadService({ stored, adult: true });
  assert.equal(service.hasAdToOpen('player'), true);
  adult.value = false;
  assert.equal(service.hasAdToOpen('player'), false);
  assert.equal(service.hasAdToOpen('download'), true);
});

test('hasAdToOpen : jamais de popup pub dans les applications mobiles', () => {
  const stored = JSON.stringify(config(true, placement(true, 2, 2, 1)));
  const { service } = loadService({ stored, inApp: true });
  for (const id of service.MONETIZATION_PLACEMENT_IDS) {
    assert.equal(service.hasAdToOpen(id), false, id);
  }
});

test('buildGoUrls : 2 URLs avec le même g, w=0 puis w=1, n=2, sfw=1, encodage de lang', () => {
  const { service } = loadService();
  const twoWindows = config(true, placement(true, 2, 2, 2));
  const urls = service.buildGoUrls(
    'player',
    { adultEnabled: false, device: 'mobile', lang: 'f&r', gesture: 'abc123def456' },
    twoWindows,
  );
  assert.deepEqual(urls, [
    `${API}/api/go/player?g=abc123def456&w=0&n=2&sfw=1&d=mobile&lang=f%26r`,
    `${API}/api/go/player?g=abc123def456&w=1&n=2&sfw=1&d=mobile&lang=f%26r`,
  ]);

  // Sans geste fourni : un identifiant de 12 caractères partagé par les fenêtres.
  const generated = service.buildGoUrls('player', { adultEnabled: true }, twoWindows).map((url) => new URL(url));
  const gesture = generated[0].searchParams.get('g') ?? '';
  assert.match(gesture, /^[a-z0-9]{12}$/);
  assert.equal(generated[1].searchParams.get('g'), gesture);
  assert.equal(generated[0].searchParams.get('sfw'), '0');
  assert.equal(generated[0].searchParams.has('d'), false);
  assert.equal(generated[0].searchParams.has('lang'), false);

  // Aucune pub pour l'audience du visiteur : aucune URL.
  assert.deepEqual(service.buildGoUrls('player', { adultEnabled: false }, config(true, placement(true, 2, 0, 2))), []);
});

test('refreshMonetizationConfig : 404 → plus aucune pub ; erreur réseau → config précédente gardée', async () => {
  const outdatedApi = loadService({ fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }) });
  assert.equal(outdatedApi.service.hasAdToOpen('player'), true);
  const noAds = await outdatedApi.service.refreshMonetizationConfig();
  assert.equal(outdatedApi.fetchCalls[0], `${API}/api/go-settings`);
  assert.equal(noAds.enabled, false);
  assert.equal(outdatedApi.service.getMonetizationConfig().enabled, false);
  assert.equal(outdatedApi.service.hasAdToOpen('player'), false);
  assert.equal(JSON.parse(outdatedApi.storage.get('go_settings_cache') ?? '{}').enabled, false);

  let failure: 'network' | 'server' | null = null;
  const flaky = loadService({
    fetchImpl: async () => {
      if (failure === 'network') throw new TypeError('Failed to fetch');
      if (failure === 'server') return { ok: false, status: 502, json: async () => ({}) };
      return okResponse({ success: true, ...config(true, placement(true, 3, 1, 3)), updatedAt: null });
    },
  });
  const seen: number[] = [];
  const unsubscribe = flaky.service.subscribeToMonetizationConfig((next) => {
    seen.push(next.placements.player.windowsPerClick);
  });
  await flaky.service.refreshMonetizationConfig();
  assert.equal(flaky.service.getAdWindowCount('player', true), 3);
  // Même réponse : pas de nouvelle notification.
  await flaky.service.refreshMonetizationConfig();
  assert.deepEqual(seen, [3]);

  failure = 'network';
  const kept = await flaky.service.refreshMonetizationConfig();
  assert.equal(kept.placements.player.windowsPerClick, 3);
  assert.equal(flaky.service.getAdWindowCount('player', true), 3);
  failure = 'server';
  await flaky.service.refreshMonetizationConfig();
  assert.equal(flaky.service.getAdWindowCount('player', true), 3);
  assert.deepEqual(seen, [3]);
  unsubscribe();
});

test('getMonetizationConfig relit la copie localStorage au démarrage', () => {
  const stored = JSON.stringify({
    ...config(true, placement(true, 1, 1, 1), { download: placement(true, 3, 2, 3) }),
    adultDefault: false,
  });
  const fromCopy = loadService({ stored });
  const current = fromCopy.service.getMonetizationConfig();
  assert.equal(current.adultDefault, false);
  assert.equal(current.placements.download.windowsPerClick, 3);
  assert.equal(fromCopy.fetchCalls.length, 0);

  // Copie absente ou corrompue : emplacements supposés actifs, une fenêtre.
  for (const broken of [null, '{pas du json', JSON.stringify({ enabled: true })]) {
    const { service } = loadService({ stored: broken });
    assert.deepEqual(service.getMonetizationConfig(), service.FALLBACK_PUBLIC_CONFIG);
  }
  const { service } = loadService();
  assert.equal(service.FALLBACK_PUBLIC_CONFIG.enabled, true);
  assert.equal(service.FALLBACK_PUBLIC_CONFIG.adultDefault, true);
  assert.deepEqual(service.FALLBACK_PUBLIC_CONFIG.placements.swiftflux, placement(true, 1, 1, 1));
  assert.equal(service.NO_ADS_PUBLIC_CONFIG.enabled, false);
  assert.deepEqual(service.NO_ADS_PUBLIC_CONFIG.placements.player, placement(false, 0, 0, 1));
});

test('openGoLinks ouvre une ancre par fenêtre, target _blank et rel noopener sans noreferrer', () => {
  const stored = JSON.stringify(config(true, placement(true, 2, 1, 2), { livetv: placement(false, 1, 1, 1) }));
  const { service, anchors } = loadService({ stored, adult: true, mobile: true, language: 'en-US' });
  assert.equal(service.openGoLinks('player'), 2);
  assert.equal(anchors.length, 2);
  const urls = anchors.map((anchor) => new URL(anchor.href));
  for (const anchor of anchors) {
    assert.equal(anchor.target, '_blank');
    assert.equal(anchor.rel, 'noopener');
    assert.equal(anchor.clicked, true);
  }
  assert.equal(urls[0].origin + urls[0].pathname, `${API}/api/go/player`);
  assert.deepEqual(urls.map((url) => url.searchParams.get('w')), ['0', '1']);
  assert.equal(urls[0].searchParams.get('d'), 'mobile');
  assert.equal(urls[0].searchParams.get('lang'), 'en');
  assert.equal(urls[0].searchParams.get('sfw'), '0');

  // Emplacement inactif : rien d'ouvert.
  assert.equal(service.openGoLinks('livetv'), 0);
  assert.equal(anchors.length, 2);
});

test('startMonetizationConfigSync est idempotent', async () => {
  const { service, fetchCalls } = loadService({ fetchImpl: async () => okResponse({ success: true, ...config(true) }) });
  const stopFirst = service.startMonetizationConfigSync();
  const stopSecond = service.startMonetizationConfigSync();
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(fetchCalls.length, 1);
  } finally {
    stopFirst();
    stopSecond();
  }
});
