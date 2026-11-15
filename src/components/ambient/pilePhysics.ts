// Physique des tas (neige, feuilles, pétales), sans DOM : chaque surface (une
// card, le bas de l'écran) porte une carte des hauteurs, une colonne tous les
// ~3 px. Les hauteurs sont en pixels CSS, mesurées depuis le bord supérieur de
// la surface ; un volume est une hauteur multipliée par la largeur de colonne.

/** Largeur visée d'une colonne : assez fine pour un relief doux, assez large pour rester bon marché. */
export const COLUMN_WIDTH = 3;

export function columnCount(width: number): number {
  return Math.max(8, Math.min(160, Math.round(width / COLUMN_WIDTH)));
}

/**
 * Descente du bord supérieur d'une surface aux coins arrondis, à `x` px de
 * son bord gauche : 0 sur le plat, `radius` tout au bord.
 */
export function cornerDrop(x: number, width: number, radius: number): number {
  if (radius <= 0) return 0;
  const r = Math.min(radius, width / 2);
  const d = x < r ? r - x : x > width - r ? x - (width - r) : 0;
  if (d <= 0) return 0;
  return r - Math.sqrt(Math.max(0, r * r - d * d));
}

/**
 * Hauteur maximale de chaque colonne : pleine au milieu, presque nulle au bord,
 * parce que la neige ne tient pas sur l'arrondi d'un coin.
 */
export function capacityProfile(n: number, width: number, maxHeight: number, radius: number): Float32Array {
  const cap = new Float32Array(n);
  const colW = width / n;
  const taper = Math.max(radius, colW * 2);
  for (let i = 0; i < n; i++) {
    const x = (i + 0.5) * colW;
    const edge = Math.min(x, width - x);
    cap[i] = maxHeight * Math.min(1, 0.2 + 0.8 * Math.pow(Math.max(0, edge) / taper, 0.75));
  }
  return cap;
}

/** Ajoute `volume` (px²) autour de la colonne `center` (index fractionnaire), en cloche. */
export function deposit(h: Float32Array, center: number, volume: number, colW: number, spread = 1.4): void {
  const n = h.length;
  const reach = Math.max(1, Math.ceil(spread * 2));
  const c = Math.round(center);
  let total = 0;
  for (let k = -reach; k <= reach; k++) {
    const i = c + k;
    if (i < 0 || i >= n) continue;
    total += Math.exp(-((i - center) ** 2) / (2 * spread * spread));
  }
  if (total <= 0) return;
  const height = volume / colW / total;
  for (let k = -reach; k <= reach; k++) {
    const i = c + k;
    if (i < 0 || i >= n) continue;
    h[i] += height * Math.exp(-((i - center) ** 2) / (2 * spread * spread));
  }
}

export interface Spill { left: number; right: number }

/**
 * Éboule le tas jusqu'à la pente naturelle de la neige (`maxSlope`, en px de
 * hauteur par px de largeur). Ce qui dépasse la capacité d'une colonne ou glisse
 * par un bord tombe : le volume perdu (px²) est rendu par côté.
 */
export function relax(h: Float32Array, cap: Float32Array, colW: number, maxSlope: number, iterations = 2): Spill {
  const n = h.length;
  const maxDiff = maxSlope * colW;
  const spill = { left: 0, right: 0 };
  for (let it = 0; it < iterations; it++) {
    // Un sens puis l'autre : un seul sens pousserait toute la neige d'un côté.
    const forward = it % 2 === 0;
    for (let s = 0; s < n - 1; s++) {
      const i = forward ? s : n - 2 - s;
      const d = h[i] - h[i + 1];
      if (d > maxDiff) {
        const t = (d - maxDiff) * 0.5;
        h[i] -= t;
        h[i + 1] += t;
      } else if (d < -maxDiff) {
        const t = (-d - maxDiff) * 0.5;
        h[i + 1] -= t;
        h[i] += t;
      }
    }
  }
  // Au-delà du bord il n'y a rien : la colonne extrême ne garde qu'une marche.
  if (h[0] > maxDiff) {
    const t = (h[0] - maxDiff) * 0.5;
    h[0] -= t;
    spill.left += t * colW;
  }
  if (h[n - 1] > maxDiff) {
    const t = (h[n - 1] - maxDiff) * 0.5;
    h[n - 1] -= t;
    spill.right += t * colW;
  }
  for (let i = 0; i < n; i++) {
    if (h[i] <= cap[i]) continue;
    const excess = (h[i] - cap[i]) * colW;
    h[i] = cap[i];
    if (i < n / 2) spill.left += excess;
    else spill.right += excess;
  }
  return spill;
}

/**
 * Tassement : chaque colonne se rapproche de ses voisines (diffusion à volume
 * constant). Sans lui, chaque flocon laisse sa propre pointe et le tas fait des dents de scie.
 */
export function smooth(h: Float32Array, k: number, tmp: Float32Array): void {
  const n = h.length;
  if (n < 2 || k <= 0) return;
  const a = Math.min(0.25, k);
  for (let i = 0; i < n; i++) {
    const left = i > 0 ? h[i - 1] : h[i];
    const right = i < n - 1 ? h[i + 1] : h[i];
    tmp[i] = h[i] + a * (left + right - 2 * h[i]);
  }
  for (let i = 0; i < n; i++) h[i] = tmp[i];
}

/** Fonte : un léger fond constant plus une part proportionnelle, pour que les gros tas baissent plus vite. */
export function melt(h: Float32Array, dt: number, base: number, proportional: number): void {
  for (let i = 0; i < h.length; i++) {
    const v = h[i];
    if (v <= 0) continue;
    h[i] = Math.max(0, v - (base + proportional * v) * dt);
  }
}

/**
 * Retire la neige traversée par un disque (le curseur, une boule) et écrit le
 * volume enlevé par colonne dans `removed`. Repère local : `x` depuis le bord
 * gauche, `y` vers le bas depuis le bord supérieur ; la neige d'une colonne
 * occupe [base - h, base]. Ce qui était au-dessus du disque s'effondre.
 */
export function carveCircle(
  h: Float32Array,
  base: Float32Array,
  colW: number,
  cx: number,
  cy: number,
  r: number,
  removed: Float32Array,
): number {
  const n = h.length;
  let total = 0;
  const first = Math.max(0, Math.floor((cx - r) / colW));
  const last = Math.min(n - 1, Math.ceil((cx + r) / colW));
  for (let i = first; i <= last; i++) {
    removed[i] = 0;
    if (h[i] <= 0) continue;
    const dx = (i + 0.5) * colW - cx;
    if (Math.abs(dx) >= r) continue;
    const dy = Math.sqrt(r * r - dx * dx);
    const top = base[i] - h[i];
    const overlap = Math.min(base[i], cy + dy) - Math.max(top, cy - dy);
    if (overlap <= 0) continue;
    const cut = Math.min(h[i], overlap);
    h[i] -= cut;
    removed[i] = cut * colW;
    total += cut * colW;
  }
  return total;
}

/** Rééchantillonne une carte des hauteurs vers `n` colonnes (redimensionnement du bas de l'écran). */
export function resample(h: Float32Array, n: number): Float32Array {
  const out = new Float32Array(n);
  if (h.length === 0) return out;
  for (let i = 0; i < n; i++) {
    const p = ((i + 0.5) / n) * h.length - 0.5;
    const a = Math.max(0, Math.min(h.length - 1, Math.floor(p)));
    const b = Math.min(h.length - 1, a + 1);
    const t = Math.max(0, Math.min(1, p - a));
    out[i] = h[a] * (1 - t) + h[b] * t;
  }
  return out;
}

export function sum(h: Float32Array): number {
  let s = 0;
  for (let i = 0; i < h.length; i++) s += h[i];
  return s;
}
