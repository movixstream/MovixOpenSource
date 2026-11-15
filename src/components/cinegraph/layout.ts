import type { CineMap, MapZone, ZoneKind } from '@/services/cineGraph/types';

/**
 * Mise en page fixe de la carte (vue grand écran). Rien ne flotte : chaque
 * zone a sa place, à gauche ou à droite du centre, et ses vignettes forment
 * une grille. Les tailles doivent rester alignées sur `cinegraph.css`.
 */
export const CARD_W = 112;
export const WORK_CARD_H = 236;
export const PERSON_CARD_H = 172;
export const CARD_GAP = 12;
export const ZONE_PAD_X = 16;
export const ZONE_HEADER_H = 84;
export const ZONE_PAD_BOTTOM = 16;
export const ZONE_MIN_W = 320;
/** Hauteur où le trait du centre entre dans la zone : au niveau de son icône. */
export const ZONE_ANCHOR_Y = 38;
export const ZONE_GAP = 44;
export const COLUMN_GAP = 150;
export const ROOT_W = 260;
export const ROOT_H_WORK = 470;
export const ROOT_H_PERSON = 380;
export const COLUMNS_PER_ZONE = 4;
/** Vignettes visibles avant « Voir plus ». */
export const VISIBLE_PER_ZONE = 4;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ItemBox extends Box {
  key: string;
}

export interface ZoneBox extends Box {
  kind: ZoneKind;
  zone: MapZone;
  side: 'left' | 'right';
  /** Positions relatives au cadre de la zone. */
  items: ItemBox[];
  /** Vignette « Voir plus / Voir moins », dans la grille après les éléments. */
  more?: Box;
  hiddenCount: number;
  expanded: boolean;
}

export interface MapLayout {
  root: Box;
  zones: ZoneBox[];
  width: number;
  height: number;
}

function cardHeight(map: CineMap, zone: MapZone): number {
  const first = zone.items[0] ? map.items[zone.items[0]] : undefined;
  return first?.type === 'person' ? PERSON_CARD_H : WORK_CARD_H;
}

function measureZone(map: CineMap, zone: MapZone, expanded: boolean) {
  // Au-delà de VISIBLE_PER_ZONE, la dernière case devient la vignette
  // « Voir plus » : la zone garde sa largeur, ouverte ou fermée.
  const hasMore = zone.items.length > VISIBLE_PER_ZONE;
  const keys = expanded || !hasMore ? zone.items : zone.items.slice(0, VISIBLE_PER_ZONE - 1);
  const slots = keys.length + (hasMore ? 1 : 0);
  const columns = Math.max(1, Math.min(slots, COLUMNS_PER_ZONE));
  const rows = Math.max(1, Math.ceil(slots / columns));
  const height = cardHeight(map, zone);
  const gridWidth = columns * CARD_W + (columns - 1) * CARD_GAP;
  const slot = (index: number): Box => ({
    x: ZONE_PAD_X + (index % columns) * (CARD_W + CARD_GAP),
    y: ZONE_HEADER_H + Math.floor(index / columns) * (height + CARD_GAP),
    w: CARD_W,
    h: height,
  });
  return {
    items: keys.map((key, index): ItemBox => ({ key, ...slot(index) })),
    more: hasMore ? slot(keys.length) : undefined,
    w: Math.max(ZONE_MIN_W, gridWidth + ZONE_PAD_X * 2),
    h: ZONE_HEADER_H + rows * height + (rows - 1) * CARD_GAP + ZONE_PAD_BOTTOM,
    hiddenCount: zone.items.length - keys.length,
  };
}

/**
 * Range les zones en deux colonnes autour du centre. Chaque zone va dans la
 * colonne la moins haute, pour garder une carte équilibrée et compacte.
 */
export function layoutMap(
  map: CineMap,
  hidden: ReadonlySet<ZoneKind>,
  expanded: ReadonlySet<ZoneKind>,
): MapLayout {
  const columns: Record<'left' | 'right', { zone: MapZone; size: ReturnType<typeof measureZone> }[]> = {
    left: [],
    right: [],
  };
  // Le côté de chaque zone se décide sur sa taille repliée : « Voir plus »
  // agrandit une zone sur place au lieu de faire changer les autres de côté.
  const balance = { left: 0, right: 0 };
  const columnHeight = { left: 0, right: 0 };
  for (const zone of map.zones) {
    if (hidden.has(zone.kind) || zone.items.length === 0) continue;
    const side = balance.left <= balance.right ? 'left' : 'right';
    const gap = columns[side].length > 0 ? ZONE_GAP : 0;
    const size = measureZone(map, zone, expanded.has(zone.kind));
    balance[side] += gap + measureZone(map, zone, false).h;
    columnHeight[side] += gap + size.h;
    columns[side].push({ zone, size });
  }

  const rootH = map.root.type === 'person' ? ROOT_H_PERSON : ROOT_H_WORK;
  const height = Math.max(columnHeight.left, columnHeight.right, rootH);
  const leftWidth = columns.left.length ? Math.max(...columns.left.map(({ size }) => size.w)) : 0;
  const rightWidth = columns.right.length ? Math.max(...columns.right.map(({ size }) => size.w)) : 0;
  const rootX = leftWidth ? leftWidth + COLUMN_GAP : 0;
  const rightX = rootX + ROOT_W + COLUMN_GAP;

  const zones: ZoneBox[] = [];
  (['left', 'right'] as const).forEach((side) => {
    // Une colonne plus courte que l'autre reste centrée en hauteur.
    let y = (height - columnHeight[side]) / 2;
    for (const { zone, size } of columns[side]) {
      zones.push({
        kind: zone.kind,
        zone,
        side,
        // À gauche, les zones s'alignent sur le bord tourné vers le centre.
        x: side === 'left' ? leftWidth - size.w : rightX,
        y,
        w: size.w,
        h: size.h,
        items: size.items,
        more: size.more,
        hiddenCount: size.hiddenCount,
        expanded: expanded.has(zone.kind),
      });
      y += size.h + ZONE_GAP;
    }
  });

  return {
    root: { x: rootX, y: (height - rootH) / 2, w: ROOT_W, h: rootH },
    zones,
    width: rightWidth ? rightX + rightWidth : rootX + ROOT_W,
    height,
  };
}
