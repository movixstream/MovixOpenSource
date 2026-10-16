import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { isPathTvExcluded, matchesRoutePattern } from '../src/routing/tvScope.ts';

test('matchesRoutePattern : segments fixes, :param et joker final', () => {
  assert.equal(matchesRoutePattern('/vip', '/vip'), true);
  assert.equal(matchesRoutePattern('/vip', '/vip/'), true);
  assert.equal(matchesRoutePattern('/vip', '/vip/don'), false);
  assert.equal(matchesRoutePattern('/vip/don', '/vip'), false);
  assert.equal(matchesRoutePattern('/watchparty/join/:code', '/watchparty/join/AB12'), true);
  assert.equal(matchesRoutePattern('/watchparty/join/:code', '/watchparty/join'), false);
  assert.equal(matchesRoutePattern('/help/*', '/help'), true);
  assert.equal(matchesRoutePattern('/help/*', '/help/vip/faq'), true);
  assert.equal(matchesRoutePattern('/help/*', '/helpers'), false);
});

const ROUTES = [
  { path: '/movies' },
  { path: '/vip', tvExcluded: true },
  { path: '/vip/invoice/:publicId', tvExcluded: true },
  { path: '/watchparty/create', tvExcluded: true },
];

test('isPathTvExcluded : seules les routes marquées tvExcluded sont concernées', () => {
  assert.equal(isPathTvExcluded(ROUTES, '/vip'), true);
  assert.equal(isPathTvExcluded(ROUTES, '/vip/invoice/42'), true);
  assert.equal(isPathTvExcluded(ROUTES, '/watchparty/create'), true);
  assert.equal(isPathTvExcluded(ROUTES, '/movies'), false);
  // Route inconnue du registry : on ne masque pas à l'aveugle.
  assert.equal(isPathTvExcluded(ROUTES, '/vipx'), false);
});

test('isPathTvExcluded : query, fragment et liens externes', () => {
  assert.equal(isPathTvExcluded(ROUTES, '/vip?from=menu'), true);
  assert.equal(isPathTvExcluded(ROUTES, '/vip#faq'), true);
  assert.equal(isPathTvExcluded(ROUTES, 'https://github.com/movixcorp/MovixOpenSource'), false);
  assert.equal(isPathTvExcluded(ROUTES, 'https://movix.online/vip'), false);
});

// Les composants sont du TSX : on vérifie le branchement dans la source,
// comme tvRouteScope.test.ts le fait pour App.tsx.
test('les menus et le lecteur masquent les entrées hors périmètre TV', async () => {
  const read = (p: string) => readFile(new URL(`../src/${p}`, import.meta.url), 'utf8');

  const header = await read('components/Header.tsx');
  assert.match(header, /items: g\.items\.filter\(item => !isHiddenOnTv\(item\.path\)\)/);

  const profileMenu = await read('components/ProfileMenu.tsx');
  assert.match(profileMenu, /canAccessAdminPanel && !isHiddenOnTv\('\/admin'\)/);
  assert.match(profileMenu, /const showVipButton = isVip \|\| !isHiddenOnTv\('\/vip'\)/);
  assert.equal(profileMenu.match(/\{showVipButton && \(/g)?.length, 2);

  const player = await read('components/HLSPlayer.tsx');
  assert.match(player, /\{!isHiddenOnTv\('\/watchparty\/create'\) && \(\s*<div[^>]*>\s*<button\s*onClick=\{toggleWatchParty\}/);
});
