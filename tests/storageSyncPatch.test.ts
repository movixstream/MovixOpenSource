import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceEffect } from './helpers/sourceFunction.mjs';

// Reproduit le contrôle de marque des méthodes natives de Storage : appelées
// sur autre chose qu'un vrai Storage, elles lèvent « Illegal invocation ».
const createStorageClass = () => {
  const brand = new WeakSet<object>();
  const check = (target: unknown): Map<string, string> => {
    if (!target || typeof target !== 'object' || !brand.has(target)) throw new TypeError('Illegal invocation');
    return (target as { data: Map<string, string> }).data;
  };
  class FakeStorage {
    data = new Map<string, string>();
    constructor() { brand.add(this); }
    get length() { return check(this).size; }
    key(index: number) { return [...check(this).keys()][index] ?? null; }
    getItem(key: string) { return check(this).get(key) ?? null; }
    setItem(key: string, value: string) { check(this).set(key, String(value)); }
    removeItem(key: string) { check(this).delete(key); }
    clear() { check(this).clear(); }
  }
  return FakeStorage;
};

test('le patch de synchronisation écrit dans le vrai Storage quand une extension remplace localStorage', () => {
  const FakeStorage = createStorageClass();
  const real = new FakeStorage();
  real.setItem('pending_auth_action', 'login');
  real.setItem('theme', 'dark');

  // Le global `localStorage` est relu à chaque appel, comme dans le navigateur.
  let current: object = real;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => current });
  const noop = () => {};
  const listeners = { addEventListener: noop, removeEventListener: noop };
  try {
    const cleanup = sourceEffect('src/App.tsx', 'syncDiag.removeItemIntercepted', {
      window: { ...listeners, localStorage: real, dispatchEvent: noop },
      document: listeners,
      navigator: { userAgent: 'Mozilla/5.0 Chrome/154.0.0.0' },
      Storage: FakeStorage,
      BroadcastChannel: undefined,
      setInterval: () => 0,
      clearInterval: noop,
      isProfileDataLoadingRef: { current: true },
      debugAppLog: noop,
    })();

    // Extension installée après le patch : son objet délègue au vrai Storage
    // en rappelant les méthodes du prototype (GlitchTip FRONTEND-F1, F4).
    current = {
      getItem: (key: string) => FakeStorage.prototype.getItem.call(real, key),
      setItem: (key: string, value: string) => FakeStorage.prototype.setItem.call(real, key, value),
      removeItem: (key: string) => FakeStorage.prototype.removeItem.call(real, key),
      clear: () => FakeStorage.prototype.clear.call(real),
    };
    const extension = current as InstanceType<typeof FakeStorage>;

    assert.doesNotThrow(() => extension.removeItem('pending_auth_action'));
    assert.equal(real.getItem('pending_auth_action'), null);
    assert.doesNotThrow(() => extension.setItem('selected_profile_id', '42'));
    assert.equal(real.getItem('selected_profile_id'), '42');
    assert.doesNotThrow(() => extension.clear());
    assert.equal(real.length, 0);

    cleanup();
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});
