import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Le registry est du TSX qui importe des composants React : on lit la source
// plutôt que de l'importer (même approche que settingsSearch.test.ts pour les
// contrats de composants).
const source = await readFile(new URL('../src/routing/registry.tsx', import.meta.url), 'utf8');

function isExcluded(path: string): boolean {
  const line = source
    .split('\n')
    .find((l) => l.includes(`{ path: '${path}',`));
  assert.ok(line, `route ${path} absente du registry`);
  return line.includes('tvExcluded: true');
}

test('le périmètre V1 exclut WatchParty, VIP, admin, Wrapped et CineGraph', () => {
  const excluded = [
    '/watchparty/list', '/watchparty/create', '/watchparty/room/:roomId',
    '/watchparty/join', '/watchparty/join/:code',
    '/vip', '/vip/don', '/vip/invoice/:publicId', '/vip/cadeau/:giftToken', '/vip/invoices',
    '/cinegraph', '/wrapped', '/wrapped/:year', '/admin',
  ];
  for (const path of excluded) {
    assert.equal(isExcluded(path), true, `${path} devrait être tvExcluded`);
  }
});

test('le cœur du produit reste accessible sur TV', () => {
  const included = [
    '/movies', '/tv-shows', '/anime', '/search', '/settings',
    '/movie/:id', '/tv/:id',
    '/watch/movie/:tmdbid', '/watch/tv/:tmdbid/s/:season/e/:episode',
    '/profile', '/profile-management',
  ];
  for (const path of included) {
    assert.equal(isExcluded(path), false, `${path} ne doit pas être exclu de la V1 TV`);
  }
});

test('App.tsx monte bien les routes filtrées et non ROUTES', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /VISIBLE_ROUTES\.map\(renderRouteEntry\)/);
  assert.doesNotMatch(app, /\{ROUTES\.map\(renderRouteEntry\)\}/);
  assert.match(app, /isTvPlatform\(\)\s*\n?\s*\?\s*ROUTES\.filter\(\(route\) => !route\.tvExcluded\)/);
});
