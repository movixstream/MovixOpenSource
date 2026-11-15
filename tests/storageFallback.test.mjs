import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Le stockage de secours est un script classique d'index.html : on l'exécute
// tel quel contre une fausse fenêtre.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1])
  .find((body) => body.includes('__MOVIX_MEMORY_STORAGE__'));

const run = (win) => new Function('window', script)(win);

const deniedWindow = () => {
  const win = {};
  Object.defineProperty(win, 'localStorage', {
    configurable: true,
    enumerable: true,
    get() { throw new DOMException("Failed to read the 'localStorage' property from 'Window': Access is denied for this document.", 'SecurityError'); },
  });
  return win;
};

test('le script de secours existe et passe avant les scripts applicatifs', () => {
  assert.ok(script, 'script introuvable dans index.html');
  assert.ok(html.indexOf('__MOVIX_MEMORY_STORAGE__') < html.indexOf('/src/main.tsx'));
});

test('un localStorage refusé devient un stockage en mémoire utilisable', () => {
  const win = deniedWindow();
  win.sessionStorage = null;
  run(win);
  const storage = win.localStorage;
  assert.equal(storage.getItem('absent'), null);
  storage.setItem('watchlist_movie', '[1]');
  storage.setItem('volume', 0.5);
  assert.equal(storage.getItem('watchlist_movie'), '[1]');
  assert.equal(storage.getItem('volume'), '0.5');
  assert.equal(storage.length, 2);
  assert.deepEqual(Object.keys(storage).sort(), ['volume', 'watchlist_movie']);
  assert.equal(storage.key(0), 'watchlist_movie');
  storage.removeItem('volume');
  assert.equal(storage.getItem('volume'), null);
  storage.setItem('getItem', 'x');
  assert.equal(typeof storage.getItem, 'function', 'une clé ne masque pas les méthodes');
  assert.equal(storage.getItem('getItem'), 'x');
  storage.clear();
  assert.equal(storage.length, 0);
  assert.deepEqual(win.__MOVIX_MEMORY_STORAGE__, { localStorage: true, sessionStorage: true });
  assert.notEqual(win.sessionStorage, null, 'un sessionStorage null est remplacé aussi');
});

test('un stockage lisible est conservé, même plein', () => {
  const real = {
    getItem: () => '1',
    setItem() { throw new DOMException('Full', 'QuotaExceededError'); },
  };
  const win = { localStorage: real, sessionStorage: real };
  run(win);
  assert.equal(win.localStorage, real);
  assert.equal(win.sessionStorage, real);
  assert.equal(win.__MOVIX_MEMORY_STORAGE__, undefined);
});

test('une lecture qui jette (base Firefox corrompue) bascule aussi en mémoire', () => {
  const broken = { getItem() { throw new Error('NS_ERROR_FAILURE'); } };
  const win = { localStorage: broken, sessionStorage: broken };
  Object.defineProperty(win, 'localStorage', { value: broken, configurable: true, enumerable: true, writable: true });
  run(win);
  assert.notEqual(win.localStorage, broken);
  win.localStorage.setItem('a', 'b');
  assert.equal(win.localStorage.getItem('a'), 'b');
});
