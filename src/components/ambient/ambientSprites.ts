// Dessins des effets d'ambiance, tracés une fois dans de petits canvas puis
// collés à chaque image. Chaque dessin est centré dans un carré : le moteur le
// tourne, l'écrase et le met à l'échelle.

export const LEAF_SHAPES = 3;
export const LEAF_COLORS = 4;
export const PETAL_TINTS = 2;
export const POPCORN_SHAPES = 4;
/** Côté du carré à dessiner pour une feuille de demi-longueur 1 (elle en occupe ~71 %). */
export const LEAF_DRAW = 2.8;
/** Idem pour un pétale ou une fleur de demi-taille 1. */
export const PETAL_DRAW = 2.55;

export interface Sprites {
  snow: HTMLCanvasElement;
  snowLight: HTMLCanvasElement;
  water: HTMLCanvasElement;
  waterLight: HTMLCanvasElement;
  /** Lueur de bougie des citrouilles. */
  ember: HTMLCanvasElement;
  /** Indice : forme × LEAF_COLORS + couleur. */
  leaves: HTMLCanvasElement[];
  /** Feuille sèche, une par forme. */
  leavesDry: HTMLCanvasElement[];
  petals: HTMLCanvasElement[];
  petalDry: HTMLCanvasElement;
  petalGlint: HTMLCanvasElement;
  flower: HTMLCanvasElement;
  flowerDry: HTMLCanvasElement;
  /** Grains de pop-corn éclatés, un par forme. */
  popcorn: HTMLCanvasElement[];
}

type Ctx = CanvasRenderingContext2D;

const TAU = Math.PI * 2;

/** Canvas carré de `size` px dont le repère, centré, fait `units` de côté. */
function canvasOf(size: number, units: number, paint: (g: Ctx) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.translate(size / 2, size / 2);
  g.scale(size / units, size / units);
  paint(g);
  return c;
}

function dot(color: string): HTMLCanvasElement {
  return canvasOf(32, 32, (g) => {
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, 16);
    grad.addColorStop(0, `rgba(${color},1)`);
    grad.addColorStop(0.35, `rgba(${color},0.9)`);
    grad.addColorStop(0.65, `rgba(${color},0.3)`);
    grad.addColorStop(1, `rgba(${color},0)`);
    g.fillStyle = grad;
    g.fillRect(-16, -16, 32, 32);
  });
}

// ----------------------------------------------------------------- Feuilles

/** Clair, foncé, nervure. */
const LEAF_TINTS: Array<[string, string, string]> = [
  ['#e2572f', '#a12c1a', '#6c1b10'],
  ['#f59a2e', '#c9641a', '#8a400e'],
  ['#f4cb3c', '#cf9a1e', '#916710'],
  ['#bb6a22', '#824512', '#552c0b'],
];
const LEAF_DRY: [string, string, string] = ['#927049', '#614627', '#3e2b16'];

/** Moitié droite d'une feuille d'érable, de la pointe à la queue. */
const MAPLE = [0, -21, 3.5, -13, 9, -15.5, 7.5, -8, 16, -9, 11.5, -1.5, 18, 3.5, 9.5, 5.5, 11, 12, 3, 9, 1.2, 17];
/** Moitié droite d'une feuille de chêne : le bord ondule entre ces points. */
const OAK = [0, -20, 6, -15, 3.5, -10, 9, -5, 4.5, 0, 10, 5, 5, 10, 6.5, 15, 0, 19];

/** Contour fermé et symétrique à partir de sa moitié droite (le premier et le dernier point sont sur l'axe). */
function mirrored(half: number[]): number[][] {
  const pts: number[][] = [];
  for (let i = 0; i < half.length; i += 2) pts.push([half[i], half[i + 1]]);
  for (let i = half.length - 4; i >= 2; i -= 2) pts.push([-half[i], half[i + 1]]);
  return pts;
}

function leafOutline(g: Ctx, shape: number): void {
  g.beginPath();
  if (shape === 0) {
    // Hêtre : ovale pointu.
    g.moveTo(0, -20);
    g.bezierCurveTo(13, -11, 12, 10, 0, 19);
    g.bezierCurveTo(-12, 10, -13, -11, 0, -20);
  } else if (shape === 1) {
    const pts = mirrored(MAPLE);
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  } else {
    const pts = mirrored(OAK);
    const n = pts.length;
    g.moveTo((pts[n - 1][0] + pts[0][0]) / 2, (pts[n - 1][1] + pts[0][1]) / 2);
    for (let i = 0; i < n; i++) {
      const next = pts[(i + 1) % n];
      g.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + next[0]) / 2, (pts[i][1] + next[1]) / 2);
    }
  }
  g.closePath();
}

function paintLeaf(g: Ctx, shape: number, [light, dark, vein]: [string, string, string]): void {
  leafOutline(g, shape);
  const grad = g.createLinearGradient(-8, -20, 8, 20);
  grad.addColorStop(0, light);
  grad.addColorStop(1, dark);
  g.fillStyle = grad;
  g.fill();
  g.strokeStyle = vein;
  g.lineCap = 'round';
  // Nervures secondaires, coupées au bord de la feuille.
  g.save();
  leafOutline(g, shape);
  g.clip();
  g.globalAlpha = 0.55;
  g.lineWidth = 0.7;
  g.beginPath();
  for (const y of [-8, -1, 6]) {
    g.moveTo(0, y + 4);
    g.lineTo(8, y - 2);
    g.moveTo(0, y + 4);
    g.lineTo(-8, y - 2);
  }
  g.stroke();
  g.restore();
  // Nervure centrale, prolongée par la queue.
  g.lineWidth = 1.3;
  g.beginPath();
  g.moveTo(0, -15);
  g.lineTo(0, 25);
  g.stroke();
}

// ------------------------------------------------------------------ Pétales

function petalOutline(g: Ctx): void {
  g.beginPath();
  g.moveTo(0, 11);
  g.bezierCurveTo(-10, 4, -9, -9, -2.2, -11);
  // L'encoche au bout du pétale de cerisier.
  g.quadraticCurveTo(0, -8, 2.2, -11);
  g.bezierCurveTo(9, -9, 10, 4, 0, 11);
  g.closePath();
}

/** Du cœur (où la lumière traverse) vers le bord. */
const PETAL_STOPS: string[][] = [
  ['#fff6f9', '#fcc9d9', '#f39ab8'],
  ['#ffeaf1', '#f8a9c4', '#e9739f'],
];
/** Pétale fané : il brunit par le bord. */
const PETAL_DRY = ['#e6b8c0', '#b58a73', '#7a5034'];

function paintPetal(g: Ctx, stops: string[]): void {
  petalOutline(g);
  const grad = g.createRadialGradient(0, 3, 1, 0, 0, 13);
  stops.forEach((color, i) => grad.addColorStop(i / (stops.length - 1), color));
  g.fillStyle = grad;
  g.fill();
}

function paintFlower(g: Ctx, stops: string[], stalk: string, heart: string): void {
  g.strokeStyle = stalk;
  g.lineWidth = 1.8;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(0, 0);
  g.quadraticCurveTo(3, 14, 7, 25);
  g.stroke();
  for (let k = 0; k < 5; k++) {
    g.save();
    g.rotate((k * TAU) / 5);
    g.translate(0, -11.5);
    paintPetal(g, stops);
    g.restore();
  }
  g.fillStyle = heart;
  g.beginPath();
  g.arc(0, 0, 3.2, 0, TAU);
  g.fill();
}

// ----------------------------------------------------------------- Pop-corn

/** Un grain éclaté est un bouquet de boules : x, y, rayon de chacune (repère de 32 de côté). */
const POPCORN_LOBES: number[][][] = [
  [[-5, -3, 7], [5, -4, 6.5], [-7, 5, 5], [7, 4, 5.5], [0, 5, 7.5]],
  [[-8, 2, 4.5], [-4, -5, 6.5], [7, 6, 4.5], [5, -2, 7.5], [-2, 5, 7]],
  [[0, -6, 6.5], [-6, 1, 7], [6, 1, 7], [0, 7, 6]],
  [[-6, -4, 6], [4, -6, 5.5], [7, 3, 6.5], [-3, 6, 7], [1, -1, 6]],
];

function paintPopcorn(g: Ctx, lobes: number[][]): void {
  // Liseré grillé : il borde le grain et le détache d'un fond clair.
  g.fillStyle = 'rgba(150,104,40,0.6)';
  g.beginPath();
  for (const [x, y, r] of lobes) {
    g.moveTo(x + r + 0.9, y);
    g.arc(x, y, r + 0.9, 0, TAU);
  }
  g.fill();
  // Boules crème, chacune éclairée d'en haut à gauche.
  for (const [x, y, r] of lobes) {
    const grad = g.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
    grad.addColorStop(0, '#fffef6');
    grad.addColorStop(0.6, '#fbf1cf');
    grad.addColorStop(1, '#efd9a0');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
  }
  // Reste de la coque du grain de maïs, au creux du bouquet.
  g.fillStyle = '#c98a2b';
  g.beginPath();
  g.ellipse(0.5, 1, 3.1, 2, 0.5, 0, TAU);
  g.fill();
  g.fillStyle = 'rgba(122,72,22,0.55)';
  g.beginPath();
  g.ellipse(1.1, 1.6, 1.7, 1, 0.5, 0, TAU);
  g.fill();
}

export function buildSprites(): Sprites {
  const leaves: HTMLCanvasElement[] = [];
  const leavesDry: HTMLCanvasElement[] = [];
  for (let shape = 0; shape < LEAF_SHAPES; shape++) {
    for (let color = 0; color < LEAF_COLORS; color++) {
      leaves.push(canvasOf(64, 56, (g) => paintLeaf(g, shape, LEAF_TINTS[color])));
    }
    leavesDry.push(canvasOf(64, 56, (g) => paintLeaf(g, shape, LEAF_DRY)));
  }
  return {
    snow: dot('255,255,255'),
    snowLight: dot('150,172,200'),
    water: dot('205,226,250'),
    waterLight: dot('96,126,168'),
    ember: dot('255,160,60'),
    leaves,
    leavesDry,
    petals: PETAL_STOPS.map((stops) => canvasOf(40, 28, (g) => paintPetal(g, stops))),
    petalDry: canvasOf(40, 28, (g) => paintPetal(g, PETAL_DRY)),
    petalGlint: canvasOf(40, 28, (g) => paintPetal(g, ['#ffffff', '#ffffff'])),
    flower: canvasOf(64, 56, (g) => paintFlower(g, PETAL_STOPS[0], '#6d8c3a', '#f3cf5a')),
    flowerDry: canvasOf(64, 56, (g) => paintFlower(g, PETAL_DRY, '#6b6a3a', '#a8843c')),
    popcorn: POPCORN_LOBES.map((lobes) => canvasOf(48, 32, (g) => paintPopcorn(g, lobes))),
  };
}
