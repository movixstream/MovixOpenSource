import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COLUMN_GAP,
  ROOT_W,
  VISIBLE_PER_ZONE,
  layoutMap,
} from '../src/components/cinegraph/layout.ts';
import type { CineMap, MapItem, ZoneKind } from '../src/services/cineGraph/types.ts';

function item(key: string, zone: ZoneKind): MapItem {
  const [type, id] = key.split('-');
  return { key, type: type as MapItem['type'], tmdbId: Number(id), title: key, zone, reasons: [], related: [] };
}

function map(zones: Array<[ZoneKind, number]>): CineMap {
  const items: Record<string, MapItem> = {};
  let next = 1;
  const built = zones.map(([kind, count]) => {
    const keys = Array.from({ length: count }, () => `${kind === 'team' ? 'person' : 'movie'}-${next++}`);
    for (const key of keys) items[key] = item(key, kind);
    return { kind, items: keys };
  });
  return { root: { key: 'movie-0', type: 'movie', tmdbId: 0, title: 'Centre' }, zones: built, items };
}

const none = new Set<ZoneKind>();

test('les zones se répartissent des deux côtés du centre, sans se chevaucher', () => {
  const layout = layoutMap(map([['team', 5], ['director', 6], ['cast', 3], ['mood', 2]]), none, none);
  assert.deepEqual(Object.fromEntries(layout.zones.map((zone) => [zone.kind, zone.side])), {
    team: 'left', director: 'right', cast: 'left', mood: 'right',
  });
  for (const zone of layout.zones) {
    if (zone.side === 'left') assert.ok(zone.x + zone.w <= layout.root.x - COLUMN_GAP + 0.001);
    else assert.ok(zone.x >= layout.root.x + ROOT_W + COLUMN_GAP - 0.001);
  }
  for (const side of ['left', 'right'] as const) {
    const column = layout.zones.filter((zone) => zone.side === side);
    for (let index = 1; index < column.length; index++) {
      assert.ok(column[index].y >= column[index - 1].y + column[index - 1].h);
    }
  }
});

test('une zone trop remplie garde trois vignettes et finit par la case « Voir plus »', () => {
  const closed = layoutMap(map([['director', 7]]), none, none).zones[0];
  assert.equal(closed.items.length, VISIBLE_PER_ZONE - 1);
  assert.equal(closed.hiddenCount, 4);
  assert.ok(closed.more, 'case « Voir plus »');
  assert.equal(closed.more.x, closed.items[2].x + closed.items[2].w + 12);
  assert.equal(closed.more.y, closed.items[2].y);

  const open = layoutMap(map([['director', 7]]), none, new Set<ZoneKind>(['director'])).zones[0];
  assert.equal(open.items.length, 7);
  assert.equal(open.hiddenCount, 0);
  assert.ok(open.more, 'case « Voir moins » après le dernier élément');
  assert.equal(open.w, closed.w, 'la zone garde sa largeur');

  const full = layoutMap(map([['director', VISIBLE_PER_ZONE]]), none, none).zones[0];
  assert.equal(full.items.length, VISIBLE_PER_ZONE);
  assert.equal(full.more, undefined, 'rien à cacher, pas de case en plus');
});

test('« Voir plus » agrandit la zone sans faire changer les autres de côté', () => {
  const source = map([['team', 8], ['director', 2], ['cast', 8], ['mood', 2], ['saga', 2]]);
  const closed = layoutMap(source, none, none);
  const open = layoutMap(source, none, new Set<ZoneKind>(['team', 'cast']));
  const sides = (layout: typeof closed) => Object.fromEntries(layout.zones.map((zone) => [zone.kind, zone.side]));
  assert.deepEqual(sides(open), sides(closed));
  assert.ok(open.height > closed.height);
});

test('les zones masquées ou vides disparaissent de la carte', () => {
  const layout = layoutMap(map([['team', 3], ['saga', 0], ['cast', 2]]), new Set<ZoneKind>(['cast']), none);
  assert.deepEqual(layout.zones.map((zone) => zone.kind), ['team']);
});
