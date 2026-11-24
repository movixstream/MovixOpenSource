import { DETAILS_HERO_DRIP_SPLIT, DETAILS_HERO_DRIP_TINT, dripFadeOpacity } from './layout';

/**
 * Fin de la coulure peinte pixel par pixel (`drip` de `DetailsHeroBackdrop`).
 *
 * Un voile noir en CSS multiplie des couleurs déjà arrondies à l'entier. Tout
 * près du noir, il ne reste que les niveaux 3, 2, 1 puis 0 sur 255 : de
 * larges bandes, que l'on voit sur un écran OLED, où 0 éteint les pixels. Du
 * bruit posé sur le voile n'y change rien dès que le fond est sombre : il est
 * multiplié avec le reste et passe sous l'arrondi.
 *
 * Ici, le voile du bas de la coulure est un canevas dont on choisit chaque
 * pixel. On estime la couleur qui se trouve dessous (bas de l'image flouté,
 * calques de la page, haut du voile), on calcule le niveau voulu de chaque
 * couleur en nombres à virgule, on lui ajoute un bruit de moins d'un niveau
 * et on arrondit. Le pixel reçoit alors l'opacité la plus faible qui ne
 * laisse passer aucune couleur au-dessus de son niveau, et le canevas ajoute
 * lui-même le niveau qui manque aux autres (un ou deux sur 255 au plus).
 * Deux pixels voisins tombent ainsi sur deux niveaux voisins en proportion :
 * plus de bande, plus de ligne où tout s'éteint en même temps.
 *
 * L'estimation n'a pas à être exacte : le canevas reste presque un simple
 * voile, l'image vue est la vraie. Un écart ne fait que grossir un peu le
 * bruit. Sans estimation possible (image illisible, calque inconnu, mode
 * léger), on ne peint rien et le voile CSS reste en place.
 */

/** Haut du bord de la nappe des gouttes, en unités depuis le haut du dessin. */
const EDGE = 170;

/** Gouttes : centre et largeur (unités sur 1 000), longueur sous le bord (px). */
const DRIPS: ReadonlyArray<readonly [center: number, width: number, length: number]> = [
  [40, 44, 80], [104, 30, 150], [166, 56, 100], [243, 36, 170], [298, 24, 60],
  [360, 60, 125], [440, 34, 155], [500, 44, 85], [570, 32, 170], [632, 64, 110],
  [712, 38, 150], [770, 26, 65], [832, 52, 135], [905, 34, 165], [962, 44, 95],
];

/**
 * Nappe noire des gouttes (`DetailsHeroDrips`) : dessin de 1 000 unités de
 * large sur 480 de haut, chaque goutte creusée vers le bas, pointe arrondie.
 */
export const DRIP_CAP_PATH = [
  `M0 480 L0 ${EDGE}`,
  ...DRIPS.map(([center, width, length]) => {
    const radius = width / 2;
    const left = center - radius;
    const right = center + radius;
    const bottom = EDGE + length - radius;
    return `L${left} ${EDGE} L${left} ${bottom} A${radius} ${radius} 0 0 0 ${right} ${bottom} L${right} ${EDGE}`;
  }),
  `L1000 ${EDGE} L1000 480 Z`,
].join(' ');

/** Boîte de la nappe dans la page, comme les classes de `DetailsHeroDrips`. */
const CAP_BOX = { overflowRem: 4, heightRem: 30, blurPx: 24 } as const;

/** Pas de la grille d'estimation, marge de chaque côté et nombre de lignes. */
const STEP = 4;
const PAD = 32;
const ROWS = 8;
/** La nappe des gouttes est calculée au quart de la taille. */
const CAP_SCALE = 4;
/** Au-delà, le canevas pèserait trop lourd : on garde le voile CSS. */
const MAX_PIXELS = 12_000_000;

type Rgba = [number, number, number, number];

interface Gradient {
  /** Paliers, couleurs déjà multipliées par leur opacité (0 à 255, opacité 0 à 1). */
  stops: Array<{ at: number; color: Rgba }>;
  /** Position le long du dégradé d'un point de la boîte (0 = premier palier). */
  position: (x: number, y: number, width: number, height: number) => number;
}

interface Overlay {
  gradient: Gradient;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Coupe sur les virgules qui ne sont pas dans des parenthèses. */
function splitArguments(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === ',' && depth === 0) {
      parts.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts;
}

/**
 * Lit un dégradé tel que le navigateur le rend dans le style calculé :
 * linéaire vers un côté ou en degrés, ou ellipse en pourcentages. Tout autre
 * dessin rend `null`.
 */
function parseGradient(css: string): Gradient | null {
  const match = /^(linear|radial)-gradient\(([\s\S]*)\)$/.exec(css.trim());
  if (!match) return null;
  const parts = splitArguments(match[2]);
  const head = parts[0] ?? '';
  const startsWithColor = /^(?:rgba?\(|transparent)/.test(head);
  let position: Gradient['position'];
  if (match[1] === 'linear') {
    let angle = 180;
    if (!startsWithColor) {
      const sides: Record<string, number> = { 'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270 };
      const degrees = /^(-?[\d.]+)deg$/.exec(head);
      if (head in sides) angle = sides[head];
      else if (degrees) angle = Number(degrees[1]);
      else return null;
      parts.shift();
    }
    const sin = Math.sin(angle * Math.PI / 180);
    const cos = Math.cos(angle * Math.PI / 180);
    position = (x, y, width, height) => {
      const length = Math.abs(width * sin) + Math.abs(height * cos);
      return ((x - width / 2) * sin - (y - height / 2) * cos) / length + 0.5;
    };
  } else {
    const shape = /^(?:ellipse\s+)?([\d.]+)%\s+([\d.]+)%\s+at\s+(-?[\d.]+)%\s+(-?[\d.]+)%$/.exec(head);
    if (!shape) return null;
    parts.shift();
    const [radiusX, radiusY, centerX, centerY] = shape.slice(1).map((value) => Number(value) / 100);
    if (!radiusX || !radiusY) return null;
    position = (x, y, width, height) => Math.hypot(
      (x - centerX * width) / (radiusX * width),
      (y - centerY * height) / (radiusY * height),
    );
  }

  const stops: Array<{ at: number | null; color: Rgba }> = [];
  for (const part of parts) {
    const stop = /^(?:rgba?\(([^)]*)\)|(transparent))(?:\s+(-?[\d.]+)%)?$/.exec(part);
    if (!stop) return null;
    const values = stop[2] ? [0, 0, 0, 0] : (stop[1].match(/-?[\d.]+(?:e-?\d+)?/g) ?? []).map(Number);
    if (values.length < 3 || values.some((value) => !Number.isFinite(value))) return null;
    const alpha = Math.min(1, Math.max(0, values[3] ?? 1));
    stops.push({
      at: stop[3] === undefined ? null : Number(stop[3]) / 100,
      color: [values[0] * alpha, values[1] * alpha, values[2] * alpha, alpha],
    });
  }
  if (stops.length < 2) return null;
  // Paliers sans position : 0 au début, 1 à la fin, répartis entre leurs voisins.
  if (stops[0].at === null) stops[0].at = 0;
  if (stops[stops.length - 1].at === null) stops[stops.length - 1].at = 1;
  for (let index = 1; index < stops.length - 1; index++) {
    if (stops[index].at !== null) continue;
    let next = index + 1;
    while (stops[next].at === null) next++;
    const from = stops[index - 1].at as number;
    const to = stops[next].at as number;
    for (let fill = index; fill < next; fill++) stops[fill].at = from + (to - from) * (fill - index + 1) / (next - index + 1);
  }
  for (let index = 1; index < stops.length; index++) {
    stops[index].at = Math.max(stops[index].at as number, stops[index - 1].at as number);
  }
  return { stops: stops as Gradient['stops'], position };
}

/** Couleur du dégradé à la position `t`, mélangée entre ses deux paliers voisins. */
function gradientColor({ stops }: Gradient, t: number, out: Rgba) {
  let index = 0;
  while (index < stops.length - 1 && stops[index + 1].at <= t) index++;
  const from = stops[index];
  const to = stops[Math.min(index + 1, stops.length - 1)];
  const span = to.at - from.at;
  const mix = t <= from.at || span <= 0 ? 0 : Math.min(1, (t - from.at) / span);
  for (let channel = 0; channel < 4; channel++) out[channel] = from.color[channel] + (to.color[channel] - from.color[channel]) * mix;
}

/**
 * Calques de la page posés sur l'image (teinte, voile de gauche) : tout
 * enfant du fond qui n'est pas une de ses propres pièces. `null` si l'un
 * d'eux n'est pas un simple dégradé : on ne sait alors pas ce qu'il y a sous
 * le voile.
 */
function readOverlays(frame: HTMLElement): { overlays: Overlay[]; key: string } | null {
  const overlays: Overlay[] = [];
  let key = '';
  for (const element of Array.from(frame.children)) {
    if (!(element instanceof HTMLElement) || element.hasAttribute('data-details-hero-part')) continue;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const filled = !/^(?:transparent|rgba\(0, 0, 0, 0\))$/.test(style.backgroundColor);
    if (style.backgroundImage === 'none' && !filled && !element.childElementCount) continue;
    const gradient = parseGradient(style.backgroundImage);
    if (!gradient || filled || element.childElementCount || style.opacity !== '1' || style.mixBlendMode !== 'normal') return null;
    const overlay = { gradient, left: element.offsetLeft, top: element.offsetTop, width: element.offsetWidth, height: element.offsetHeight };
    if (!overlay.width || !overlay.height) continue;
    overlays.push(overlay);
    key += `${style.backgroundImage}@${overlay.left},${overlay.top},${overlay.width},${overlay.height};`;
  }
  return { overlays, key };
}

/** Trois passes de moyenne glissante sur chaque ligne : presque un flou gaussien. */
function blurRows(values: Float32Array, width: number, height: number, radii: readonly number[]) {
  const line = new Float32Array(width);
  for (const radius of radii) {
    for (let y = 0; y < height; y++) {
      const row = y * width;
      let sum = 0;
      for (let x = -radius; x <= radius; x++) sum += values[row + Math.min(width - 1, Math.max(0, x))];
      for (let x = 0; x < width; x++) {
        line[x] = sum / (2 * radius + 1);
        sum += values[row + Math.min(width - 1, x + radius + 1)] - values[row + Math.max(0, x - radius)];
      }
      values.set(line, row);
    }
  }
}

/** La même chose sur chaque colonne. */
function blurColumns(values: Float32Array, width: number, height: number, radii: readonly number[]) {
  const line = new Float32Array(height);
  for (const radius of radii) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let y = -radius; y <= radius; y++) sum += values[Math.min(height - 1, Math.max(0, y)) * width + x];
      for (let y = 0; y < height; y++) {
        line[y] = sum / (2 * radius + 1);
        sum += values[Math.min(height - 1, y + radius + 1) * width + x] - values[Math.max(0, y - radius) * width + x];
      }
      for (let y = 0; y < height; y++) values[y * width + x] = line[y];
    }
  }
}

/** Rayons de trois moyennes glissantes qui valent un flou gaussien d'écart `sigma`. */
function boxRadii(sigma: number): number[] {
  const ideal = (Math.sqrt(4 * sigma * sigma + 1) - 1) / 2;
  const low = Math.max(1, Math.floor(ideal));
  return [low, Math.max(1, Math.round(ideal)), low + 1];
}

/**
 * Image à lire pour estimer la couleur sous le voile : la petite taille TMDB
 * (lue avec CORS), ou l'image elle-même si elle vient de la page. `null` pour
 * toute autre adresse : ses pixels ne seraient pas lisibles.
 */
export function dripSampleSource(src: string): { url: string; cors: boolean } | null {
  if (src.startsWith('data:') || src.startsWith('blob:')) return { url: src, cors: false };
  try {
    const url = new URL(src, window.location.href);
    if (url.origin === window.location.origin) return { url: url.href, cors: false };
    if (url.origin !== 'https://image.tmdb.org' || !/^\/t\/p\/[^/]+\/[\w.-]+$/.test(url.pathname)) return null;
    url.pathname = url.pathname.replace(/^\/t\/p\/[^/]+\//, '/t/p/w300/');
    return { url: url.href, cors: true };
  } catch {
    return null;
  }
}

/**
 * Peint le voile tramé du bas de la coulure dans `canvas`, posé sur les
 * 40rem du bas du fond `frame`. `sample` est l'image lisible
 * (`dripSampleSource`). `tint` (0 à 255 par couleur) : la coulure est
 * multipliée par cette couleur (`dripColor` de `DetailsHeroBackdrop`). Rend une signature de ce qui a été peint, à
 * repasser au prochain appel pour ne rien refaire si rien n'a changé, ou
 * `null` si le canevas ne peut pas remplacer le voile CSS.
 */
export function paintDripDither(
  frame: HTMLElement, canvas: HTMLCanvasElement, sample: HTMLImageElement, last: string | null,
  tint?: DripTint | null,
): string | null {
  const root = document.documentElement;
  if (root.hasAttribute('data-no-blur')) return null;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return null;
  const read = readOverlays(frame);
  if (!read) return null;

  const ratio = window.devicePixelRatio || 1;
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (pixelWidth * pixelHeight > MAX_PIXELS) return null;
  const black = (getComputedStyle(frame).getPropertyValue('--movix-black').match(/[\d.]+/g) ?? [0, 0, 0])
    .slice(0, 3).map((value) => Math.min(255, Math.max(0, Math.round(Number(value)))));
  if (black.length !== 3) return null;
  const rem = parseFloat(getComputedStyle(root).fontSize) || 16;
  const top = canvas.offsetTop;
  const gridWidth = Math.ceil((width + 2 * PAD) / STEP);

  const sampled = sampleUnderVeil(
    frame, sample, width, height, top, gridWidth, [pixelWidth, pixelHeight, rem, black, read.key, tint ?? null], last,
  );
  if (!sampled) return null;
  if (typeof sampled === 'string') return sampled;
  const { signature, channels } = sampled;
  if (tint) {
    // Coulure multipliée par la teinte, qui arrive peu à peu
    // (`DETAILS_HERO_DRIP_TINT`, distances depuis le bas du fond).
    const from = DETAILS_HERO_DRIP_TINT.fromRem * rem;
    const to = DETAILS_HERO_DRIP_TINT.toRem * rem;
    for (let row = 0; row < ROWS; row++) {
      const fromBottom = height - (row + 0.5) * height / ROWS;
      const share = Math.min(1, Math.max(0, (from - fromBottom) / (from - to)));
      for (let channel = 0; channel < 3; channel++) {
        const factor = 1 - share + share * tint[channel] / 255;
        const values = channels[channel];
        for (let column = 0; column < gridWidth; column++) values[row * gridWidth + column] *= factor;
      }
    }
  }
  return paintChannels(canvas, channels, read.overlays, black, width, height, top, rem, gridWidth, pixelWidth, pixelHeight, signature);
}

/** Teinte de la coulure, 0 à 255 par couleur. */
export type DripTint = readonly [number, number, number];

/**
 * Couleur sous le voile quand la coulure est faite de l'image : ses lignes du
 * bas, étirées et floutées comme le CSS. Rend `last` si rien n'a changé.
 */
function sampleUnderVeil(
  frame: HTMLElement, sample: HTMLImageElement, width: number, height: number, top: number, gridWidth: number,
  extra: unknown[], last: string | null,
): { signature: string; channels: Float32Array[] } | string | null {
  const image = frame.querySelector<HTMLImageElement>('img[data-details-backdrop]');
  const smear = frame.querySelector<HTMLImageElement>('[data-details-hero-soft] img');
  if (!image || !smear || !sample.naturalWidth || !sample.naturalHeight) return null;
  const boxWidth = image.clientWidth;
  const boxHeight = image.clientHeight;
  if (!boxWidth || !boxHeight) return null;

  // Étirement de la coulure et cadrage de l'image, lus sur la page : les
  // classes de `layout.ts` restent la seule source.
  const smearStyle = getComputedStyle(smear);
  const stretch = new DOMMatrixReadOnly(smearStyle.transform === 'none' ? undefined : smearStyle.transform);
  const [originX, originY] = smearStyle.transformOrigin.split(' ').map(parseFloat);
  const objectPosition = getComputedStyle(image).objectPosition.split(' ');
  if (objectPosition.length !== 2 || objectPosition.some((value) => !value.endsWith('%'))) return null;
  const [focusX, focusY] = objectPosition.map((value) => parseFloat(value) / 100);
  if (!(stretch.a > 0) || !(stretch.d > 1) || !Number.isFinite(originX + originY + focusX + focusY)) return null;

  const signature = JSON.stringify([
    sample.src.length, sample.src.slice(-80), width, height, boxWidth, boxHeight, top,
    smearStyle.transform, smearStyle.transformOrigin, objectPosition, ...extra,
  ]);
  if (signature === last) return last;

  // ── Couleur sous le voile, sur une grille large ───────────────────────────
  // La coulure montre, étirées, quelques lignes du bas de l'image : on les
  // dessine à la taille de la grille, puis on les floute comme le CSS.
  const cover = Math.max(boxWidth / sample.naturalWidth, boxHeight / sample.naturalHeight);
  const offsetX = (boxWidth - sample.naturalWidth * cover) * focusX;
  const offsetY = (boxHeight - sample.naturalHeight * cover) * focusY;
  const sourceX = (x: number) => (originX + (x - originX) / stretch.a - offsetX) / cover;
  const sourceY = (y: number) => (originY + (y - originY) / stretch.d - offsetY) / cover;
  const grid = document.createElement('canvas');
  grid.width = gridWidth;
  grid.height = ROWS;
  const gridContext = grid.getContext('2d', { willReadFrequently: true });
  if (!gridContext) return null;
  gridContext.drawImage(
    sample,
    sourceX(-PAD), sourceY(top), sourceX(-PAD + gridWidth * STEP) - sourceX(-PAD), sourceY(top + height) - sourceY(top),
    0, 0, gridWidth, ROWS,
  );
  let sampled: Uint8ClampedArray;
  try {
    sampled = gridContext.getImageData(0, 0, gridWidth, ROWS).data;
  } catch {
    // Image lue sans CORS : ses pixels sont interdits.
    return null;
  }
  const blurValue = /blur\(([\d.]+)px\)/.exec(getComputedStyle(smear.parentElement ?? smear).filter);
  const smearRadii = boxRadii(Math.max(1, (blurValue ? Number(blurValue[1]) : 10) / STEP));
  const channels = [0, 1, 2].map((channel) => {
    const values = new Float32Array(gridWidth * ROWS);
    for (let index = 0; index < values.length; index++) values[index] = sampled[index * 4 + channel];
    blurRows(values, gridWidth, ROWS, smearRadii);
    return values;
  });
  return { signature, channels };
}

/**
 * Peinture du voile tramé, la couleur sous le voile (`channels`, grille large)
 * connue.
 */
function paintChannels(
  canvas: HTMLCanvasElement, channels: Float32Array[], overlays: Overlay[], black: number[],
  width: number, height: number, top: number, rem: number, gridWidth: number,
  pixelWidth: number, pixelHeight: number, signature: string,
): string | null {
  // Calques de la page par-dessus, puis ce que le haut du voile laisse
  // passer : niveaux au-dessus du noir de la page, pour chaque couleur.
  const keep = 1 - dripFadeOpacity(DETAILS_HERO_DRIP_SPLIT);
  const tint: Rgba = [0, 0, 0, 0];
  for (let row = 0; row < ROWS; row++) {
    const y = top + (row + 0.5) * height / ROWS;
    for (let column = 0; column < gridWidth; column++) {
      const x = -PAD + (column + 0.5) * STEP;
      const index = row * gridWidth + column;
      for (const overlay of overlays) {
        gradientColor(overlay.gradient, overlay.gradient.position(x - overlay.left, y - overlay.top, overlay.width, overlay.height), tint);
        for (let channel = 0; channel < 3; channel++) channels[channel][index] = channels[channel][index] * (1 - tint[3]) + tint[channel];
      }
      for (let channel = 0; channel < 3; channel++) channels[channel][index] = Math.max(0, channels[channel][index] - black[channel]) * keep;
    }
  }

  // ── Nappe des gouttes, floutée ────────────────────────────────────────────
  const capWidth = Math.ceil(width / CAP_SCALE) + 1;
  const capHeight = Math.ceil(height / CAP_SCALE) + 1;
  const capCanvas = document.createElement('canvas');
  capCanvas.width = capWidth;
  capCanvas.height = capHeight;
  const capContext = capCanvas.getContext('2d', { willReadFrequently: true });
  if (!capContext || typeof Path2D === 'undefined') return null;
  const capBoxWidth = width + 2 * CAP_BOX.overflowRem * rem;
  const capBoxHeight = CAP_BOX.heightRem * rem;
  capContext.setTransform(
    capBoxWidth / 1000 / CAP_SCALE, 0, 0, capBoxHeight / 480 / CAP_SCALE,
    -CAP_BOX.overflowRem * rem / CAP_SCALE, (height - capBoxHeight) / CAP_SCALE,
  );
  capContext.fill(new Path2D(DRIP_CAP_PATH));
  // Sous la boîte de la nappe, tout est couvert.
  capContext.fillRect(0, 479, 1000, 480);
  const capPixels = capContext.getImageData(0, 0, capWidth, capHeight).data;
  const cap = new Float32Array(capWidth * capHeight);
  for (let index = 0; index < cap.length; index++) cap[index] = capPixels[index * 4 + 3] / 255;
  const capRadii = boxRadii(CAP_BOX.blurPx / CAP_SCALE);
  blurRows(cap, capWidth, capHeight, capRadii);
  blurColumns(cap, capWidth, capHeight, capRadii);

  // ── Peinture ──────────────────────────────────────────────────────────────
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const output = context.createImageData(pixelWidth, pixelHeight);
  const pixels = new Uint32Array(output.data.buffer);
  const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
  const base = littleEndian
    ? (black[2] << 16) | (black[1] << 8) | black[0]
    : (black[0] << 24) | (black[1] << 16) | (black[2] << 8);

  // Pour chaque colonne de l'écran : case de gauche et part de la case de
  // droite, dans la grille d'estimation et dans celle de la nappe.
  const gridAt = new Int32Array(pixelWidth);
  const gridMix = new Float32Array(pixelWidth);
  const capAt = new Int32Array(pixelWidth);
  const capMix = new Float32Array(pixelWidth);
  for (let px = 0; px < pixelWidth; px++) {
    const x = (px + 0.5) * width / pixelWidth;
    const column = Math.min(gridWidth - 1.001, Math.max(0, (x + PAD) / STEP - 0.5));
    gridAt[px] = Math.floor(column);
    gridMix[px] = column - gridAt[px];
    const capColumn = Math.min(capWidth - 1.001, Math.max(0, x / CAP_SCALE - 0.5));
    capAt[px] = Math.floor(capColumn);
    capMix[px] = capColumn - capAt[px];
  }
  const [red, green, blue] = channels;
  const redRow = new Float32Array(gridWidth);
  const greenRow = new Float32Array(gridWidth);
  const blueRow = new Float32Array(gridWidth);
  const capRow = new Float32Array(capWidth);
  for (let py = 0; py < pixelHeight; py++) {
    const y = (py + 0.5) * height / pixelHeight;
    // Part de lumière que ce voile laisse encore, le haut du voile déjà compté.
    const light = (1 - dripFadeOpacity(DETAILS_HERO_DRIP_SPLIT + (1 - DETAILS_HERO_DRIP_SPLIT) * y / height)) / keep;
    const row = Math.min(ROWS - 1.001, Math.max(0, y / height * ROWS - 0.5));
    const rowAt = Math.floor(row) * gridWidth;
    const rowMix = row - Math.floor(row);
    for (let column = 0; column < gridWidth; column++) {
      const upper = rowAt + column;
      const lower = upper + gridWidth;
      redRow[column] = red[upper] + (red[lower] - red[upper]) * rowMix;
      greenRow[column] = green[upper] + (green[lower] - green[upper]) * rowMix;
      blueRow[column] = blue[upper] + (blue[lower] - blue[upper]) * rowMix;
    }
    const capLine = Math.min(capHeight - 1.001, Math.max(0, y / CAP_SCALE - 0.5));
    const capLineAt = Math.floor(capLine) * capWidth;
    const capLineMix = capLine - Math.floor(capLine);
    for (let column = 0; column < capWidth; column++) {
      capRow[column] = cap[capLineAt + column] * (1 - capLineMix) + cap[capLineAt + capWidth + column] * capLineMix;
    }
    const line = py * pixelWidth;
    for (let px = 0; px < pixelWidth; px++) {
      const at = gridAt[px];
      const mix = gridMix[px];
      const capIndex = capAt[px];
      const through = light * (1 - (capRow[capIndex] + (capRow[capIndex + 1] - capRow[capIndex]) * capMix[px]));
      // Couleur estimée sous le voile, puis niveau voulu de chaque couleur.
      const underRed = redRow[at] + (redRow[at + 1] - redRow[at]) * mix;
      const underGreen = greenRow[at] + (greenRow[at + 1] - greenRow[at]) * mix;
      const underBlue = blueRow[at] + (blueRow[at + 1] - blueRow[at]) * mix;
      // Bruit à gradient entrelacé : régulier, sans grumeaux. Décalé d'un
      // tiers d'une couleur à l'autre : elles ne changent pas de niveau au
      // même pixel, le grain de lumière est plus fin.
      const noise = (52.9829189 * ((0.06711056 * px + 0.00583715 * py) % 1)) % 1;
      const wantedRed = Math.floor(underRed * through + noise);
      const wantedGreen = Math.floor(underGreen * through + (noise + 0.3333333) % 1);
      const wantedBlue = Math.floor(underBlue * through + (noise + 0.6666667) % 1);
      if (wantedRed + wantedGreen + wantedBlue === 0) {
        // Noir de la page, plein : aucun pixel allumé par erreur.
        pixels[line + px] = littleEndian ? (0xff000000 | base) >>> 0 : (base | 0xff) >>> 0;
        continue;
      }
      // Part de l'image qui passe : la plus grande qui ne dépasse le niveau
      // voulu d'aucune couleur.
      let share = 1;
      if (underRed > 0.5) share = Math.min(share, (wantedRed + 0.49) / underRed);
      if (underGreen > 0.5) share = Math.min(share, (wantedGreen + 0.49) / underGreen);
      if (underBlue > 0.5) share = Math.min(share, (wantedBlue + 0.49) / underBlue);
      const passing = Math.floor(255 * share);
      const alpha = 255 - passing;
      if (alpha === 0) {
        pixels[line + px] = 0;
        continue;
      }
      // Ce qui manque à chaque couleur, ajouté par le canevas. `putImageData`
      // veut des couleurs non multipliées par l'opacité.
      const scale = 255 / alpha;
      const addRed = Math.min(alpha, Math.max(0, wantedRed - Math.round(underRed * passing / 255)));
      const addGreen = Math.min(alpha, Math.max(0, wantedGreen - Math.round(underGreen * passing / 255)));
      const addBlue = Math.min(alpha, Math.max(0, wantedBlue - Math.round(underBlue * passing / 255)));
      const outRed = Math.min(255, Math.round(black[0] + addRed * scale));
      const outGreen = Math.min(255, Math.round(black[1] + addGreen * scale));
      const outBlue = Math.min(255, Math.round(black[2] + addBlue * scale));
      pixels[line + px] = littleEndian
        ? ((alpha << 24) | (outBlue << 16) | (outGreen << 8) | outRed) >>> 0
        : ((outRed << 24) | (outGreen << 16) | (outBlue << 8) | alpha) >>> 0;
    }
  }
  context.putImageData(output, 0, 0);
  return signature;
}
