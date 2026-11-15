import assert from 'node:assert/strict';
import test from 'node:test';

// `src/utils/tvPlatform.ts` n'importe rien : on peut le charger tel quel dans
// Node, à condition de simuler les globals DOM qu'il lit.
type FakeStore = Map<string, string>;

function installDom(options: { userAgent: string; search?: string; store?: FakeStore }) {
  const store: FakeStore = options.store ?? new Map();
  // `navigator` est un getter en lecture seule sur le globalThis de Node
  // récent : passer par defineProperty, pas par affectation.
  const define = (name: string, value: unknown) => {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  };
  define('localStorage', {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  });
  define('navigator', { userAgent: options.userAgent, hardwareConcurrency: 8 });
  define('window', {
    location: { search: options.search ?? '' },
    matchMedia: () => ({ matches: false }),
  });
  return store;
}

async function freshModule() {
  const mod = await import('../src/utils/tvPlatform.ts');
  mod.__resetTvPlatformCache();
  return mod;
}

const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const WEBOS_UA =
  'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36 WebAppManager';

test('le paramètre ?platform=tv est persisté en localStorage', async () => {
  const store = installDom({ userAgent: DESKTOP_UA, search: '?platform=tv&tvsrc=webos-ipk' });
  const { persistTvPlatformFromUrl } = await freshModule();

  assert.equal(persistTvPlatformFromUrl(), 'webos');
  assert.equal(store.get('movix_tv_platform'), 'webos');
});

test('le marqueur persisté survit à la disparition du paramètre d’URL', async () => {
  const store = new Map([['movix_tv_platform', 'webos']]);
  // UA desktop : seul le localStorage peut encore dire que c'est une TV.
  installDom({ userAgent: DESKTOP_UA, search: '', store });
  const { getTvPlatform, isTvPlatform } = await freshModule();

  assert.equal(getTvPlatform(), 'webos');
  assert.equal(isTvPlatform(), true);
});

test('l’UA sert de filet quand le localStorage est vide', async () => {
  installDom({ userAgent: WEBOS_UA });
  const { getTvPlatform } = await freshModule();

  assert.equal(getTvPlatform(), 'webos');
});

test('un UA desktop sans marqueur ne déclenche pas le mode TV', async () => {
  installDom({ userAgent: DESKTOP_UA });
  const { getTvPlatform, isTvPlatform } = await freshModule();

  assert.equal(getTvPlatform(), null);
  assert.equal(isTvPlatform(), false);
});

test('une valeur inattendue en localStorage est ignorée', async () => {
  const store = new Map([['movix_tv_platform', 'oui']]);
  installDom({ userAgent: DESKTOP_UA, store });
  const { getTvPlatform } = await freshModule();

  assert.equal(getTvPlatform(), null);
});

