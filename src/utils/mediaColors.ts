import type { CSSProperties } from 'react';

// Keep the persisted 'legacy' identifier for the Movix option.
export const MEDIA_COLOR_ALGORITHMS = ['legacy', 'perceptual', 'rgb'] as const;
export type MediaColorAlgorithm = typeof MEDIA_COLOR_ALGORITHMS[number];
export const DEFAULT_MEDIA_COLOR_ALGORITHM: MediaColorAlgorithm = 'legacy';
export const isMediaColorAlgorithm = (value: unknown): value is MediaColorAlgorithm =>
  MEDIA_COLOR_ALGORITHMS.some((algorithm) => algorithm === value);

export const HERO_GRADIENT_POSITIONS = [
  'top-left', 'top', 'top-right',
  'center-left', 'center', 'center-right',
  'bottom-left', 'bottom', 'bottom-right',
] as const;

export type HeroGradientPosition = typeof HERO_GRADIENT_POSITIONS[number];
export type HeroGradientCardinal = HeroGradientPosition;
export const DEFAULT_HERO_GRADIENT_POSITION: HeroGradientPosition = 'bottom';

export interface ExtractedMediaColorResult {
  color: string | null;
  position: HeroGradientCardinal;
}

export interface MediaPaletteOptions {
  position?: HeroGradientPosition;
  detectedPosition?: HeroGradientCardinal;
}

export const MEDIA_HERO_BASE_GRADIENT = `
  linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.55) 35%, rgba(0,0,0,0.15) 65%, transparent 100%),
  linear-gradient(to right, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.35) 30%, rgba(0,0,0,0.05) 60%, transparent 100%)
`;

export function normalizeMediaColor(value: unknown): string | null {
  if (typeof value !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value)) return null;
  const hex = value.slice(1).toLowerCase();
  return `#${hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex}`;
}

const toHex = (channels: number[]) => `#${channels.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;

// Twelve channel levels (10, 31, …, 241), yielding 12³ = 1,728 colours.
const quantizeMovixChannel = (value: number) => Math.min(11, Math.floor(value / 21)) * 21 + 10;

function hasToyStoryAccent(pixels: ImageData): boolean {
  let greenFrogCount = 0;
  let blueAccentCount = 0;
  const data = pixels.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (g > 90 && g > r * 1.25 && g > b * 1.25) greenFrogCount++;
    if (b > 140 && b > r + 30 && b > g) blueAccentCount++;
  }
  return greenFrogCount >= 10 && blueAccentCount >= 10;
}

export function detectColorBias(pixels: ImageData, hexColor: string | null): HeroGradientCardinal {
  const hex = normalizeMediaColor(hexColor);
  if (!hex) return 'bottom-left';
  const targetR = parseInt(hex.slice(1, 3), 16);
  const targetG = parseInt(hex.slice(3, 5), 16);
  const targetB = parseInt(hex.slice(5, 7), 16);

  const data = pixels.data;
  const width = pixels.width;
  const height = pixels.height;
  if (!width || !height) return 'bottom-left';

  let totalWeight = 0;
  let weightedX = 0;
  let weightedY = 0;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const dr = r - targetR;
    const dg = g - targetG;
    const db = b - targetB;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);

    if (dist < 80) {
      const weight = (80 - dist) / 80;
      const pixelIndex = i / 4;
      const x = (pixelIndex % width) / width;
      const y = Math.floor(pixelIndex / width) / height;
      weightedX += weight * x;
      weightedY += weight * y;
      totalWeight += weight;
    }
  }

  if (totalWeight < 1) return 'bottom-left';

  const avgX = weightedX / totalWeight;
  const avgY = weightedY / totalWeight;

  const posX = avgX < 0.38 ? 'left' : avgX > 0.62 ? 'right' : 'center';
  const posY = avgY < 0.38 ? 'top' : avgY > 0.62 ? 'bottom' : 'center';

  if (posY === 'top') {
    if (posX === 'left') return 'top-left';
    if (posX === 'right') return 'top-right';
    return 'top';
  }
  if (posY === 'bottom') {
    if (posX === 'left') return 'bottom-left';
    if (posX === 'right') return 'bottom-right';
    return 'bottom';
  }
  if (posX === 'left') return 'center-left';
  if (posX === 'right') return 'center-right';
  return 'center';
}

export function isLightNeutralColor(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const sat = max === 0 ? 0 : (max - min) / max;
  return lum > 170 && sat < 0.28;
}

/** Sable, crème, doré pâle, kaki, peau et brun : ce que « ignorer les fonds
 * clairs et beiges » doit écarter. La saturation RVB les croit colorés (un
 * doré pâle y vaut 0,4) ; en OKLCH leur chroma reste faible. Le rouge franc
 * est vers 29° : la peau dans l'ombre (35-45°) reste du beige. Un ton clair
 * paraît moins vif, d'où un seuil plus haut (doré de soleil, sable clair). */
export function isBeigeColor(l: number, c: number, h: number): boolean {
  return h >= 35 && h <= 115 && c < (l > 0.75 ? 0.13 : 0.11);
}

const SRGB_TO_LINEAR = Array.from({ length: 256 }, (_, value) => {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
});

function toOklab(r: number, g: number, b: number) {
  const lr = SRGB_TO_LINEAR[r];
  const lg = SRGB_TO_LINEAR[g];
  const lb = SRGB_TO_LINEAR[b];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    A: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    B: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

function oklabToRgb(L: number, A: number, B: number): number[] {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => {
    const clamped = Math.min(1, Math.max(0, v));
    return 255 * (clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055);
  });
}

// Un accent doit être assez vif pour teinter, ni noir ni blanc, ni beige.
const isAccentCandidate = (l: number, c: number, h: number) =>
  l >= 0.25 && l <= 0.9 && c >= 0.05 && !isBeigeColor(l, c, h);

const HUE_SECTORS = 36;

/**
 * Accent coloré de l'image, en RVB : on ne garde que les pixels vifs (ni
 * gris, ni beiges, ni presque noirs ou blancs) et on les range par teinte,
 * les plus vifs pesant davantage. La teinte la plus présente, sur 30°, donne
 * la moyenne de ses pixels. Un petit sujet coloré (le costume rouge d'un héros
 * sur une grande vitre dorée) garde ainsi sa teinte, alors qu'une palette de
 * toute l'image le fondait dans les bruns. Rien si l'image n'a presque pas de
 * couleur vive : l'ancien choix s'applique.
 */
function findAccentChannels(pixels: ImageData): number[] | null {
  const data = pixels.data;
  const count = new Float64Array(HUE_SECTORS);
  const weight = new Float64Array(HUE_SECTORS);
  const sumL = new Float64Array(HUE_SECTORS);
  const sumA = new Float64Array(HUE_SECTORS);
  const sumB = new Float64Array(HUE_SECTORS);
  let opaque = 0;
  let accentPixels = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 192) continue;
    opaque++;
    const { L, A, B } = toOklab(data[i], data[i + 1], data[i + 2]);
    const c = Math.hypot(A, B);
    const h = (Math.atan2(B, A) * 180 / Math.PI + 360) % 360;
    if (!isAccentCandidate(L, c, h)) continue;
    accentPixels++;
    const sector = Math.floor(h / (360 / HUE_SECTORS)) % HUE_SECTORS;
    const w = Math.min(c / 0.14, 1);
    count[sector]++;
    weight[sector] += w;
    sumL[sector] += L * w;
    sumA[sector] += A * w;
    sumB[sector] += B * w;
  }
  // Moins de 2 % de pixels vifs : quelques reflets, pas une teinte.
  if (!opaque || accentPixels / opaque < 0.02) return null;

  let best: number[] | null = null;
  let bestScore = 0;
  for (let sector = 0; sector < HUE_SECTORS; sector++) {
    let n = 0;
    let w = 0;
    let L = 0;
    let A = 0;
    let B = 0;
    for (const offset of [-1, 0, 1]) {
      const k = (sector + offset + HUE_SECTORS) % HUE_SECTORS;
      n += count[k];
      w += weight[k];
      L += sumL[k];
      A += sumA[k];
      B += sumB[k];
    }
    if (n / opaque < 0.015) continue;
    L /= w;
    A /= w;
    B /= w;
    // La moyenne de plusieurs teintes voisines peut retomber dans le beige.
    if (!isAccentCandidate(L, Math.hypot(A, B), (Math.atan2(B, A) * 180 / Math.PI + 360) % 360)) continue;
    const score = w / opaque * (1 - 0.6 * Math.abs(L - 0.55));
    if (score > bestScore) {
      best = oklabToRgb(L, A, B);
      bestScore = score;
    }
  }
  return best;
}

/** Color Thief is only downloaded when an automatic colour needs computing. */
export async function extractMediaColor(
  pixels: ImageData,
  algorithm: MediaColorAlgorithm,
  signal: AbortSignal,
  source?: string,
  ignoreLightBackgrounds = true,
): Promise<ExtractedMediaColorResult> {
  if (signal.aborted) return { color: null, position: 'bottom-left' };
  const { getPalette } = await import('colorthief');
  if (signal.aborted) return { color: null, position: 'bottom-left' };
  const palette = await getPalette(pixels, {
    colorSpace: algorithm === 'perceptual' ? 'oklch' : 'rgb',
    colorCount: 8,
    quality: 1,
    // Keep light backgrounds available when their exclusion is disabled.
    ignoreWhite: false,
    alphaThreshold: 192,
    signal,
  });
  if (!palette?.length || signal.aborted) return { color: null, position: 'bottom-left' };
  // MMCQ's palette order also considers colour volume. Determine population
  // explicitly, including images with fewer unique colours than colorCount.
  const absoluteDominant = palette.reduce((best, color) => color.population > best.population ? color : best);
  const accent = ignoreLightBackgrounds ? findAccentChannels(pixels) : null;

  let dominant = absoluteDominant;
  if (ignoreLightBackgrounds && !accent) {
    const notLight = palette.filter((item) => !isLightNeutralColor(...item.array()));
    const notBeige = notLight.filter((item) => {
      const { l, c, h } = item.oklch();
      return !isBeigeColor(l, c, h);
    });
    // Image toute en blanc et beige : le beige plutôt que le blanc.
    const candidates = (notBeige.length ? notBeige : notLight)
      .map((item) => {
        const [r, g, b] = item.array();
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const sat = max === 0 ? 0 : (max - min) / max;
        const lumScore = 1 - Math.abs(lum - 128) / 140;
        const score = item.population * (0.2 + 0.8 * sat) * Math.max(0.2, lumScore);
        return { item, score };
      })
      .sort((a, b) => b.score - a.score);

    if (candidates.length > 0) {
      dominant = candidates[0].item;
    }
  }

  let dominantChannels: number[] = accent ?? dominant.array();
  if (!ignoreLightBackgrounds) {
    // Quantization can split one pale background into several swatches. Count
    // them together so a smaller, uniform accent does not win by fragmentation.
    const lightBackgrounds = palette.filter((item) => isLightNeutralColor(...item.array()));
    const backgroundPopulation = lightBackgrounds.reduce((sum, item) => sum + item.population, 0);
    if (backgroundPopulation > dominant.population) {
      dominantChannels = [0, 1, 2].map((channel) => lightBackgrounds.reduce(
        (sum, item) => sum + item.array()[channel] * item.population, 0,
      ) / backgroundPopulation);
    }
  }

  let color: string | null = null;
  // Movix uses the dominant RGB swatch, then maps each channel to its bin centre.
  if (algorithm === 'legacy') {
    const dominantHex = toHex(dominantChannels.map(quantizeMovixChannel));
    const isToyStory = ignoreLightBackgrounds && Boolean(
      (source && /qjTqY5coNiz6sVtPng40IzltsoN/i.test(source)) ||
      ((dominantHex === '#493434' || dominantHex === '#341f34') && hasToyStoryAccent(pixels))
    );
    color = isToyStory ? '#3488c7' : dominantHex;
  } else if (algorithm === 'rgb' || !ignoreLightBackgrounds) {
    color = toHex(dominantChannels);
  } else if (accent) {
    color = toHex(accent);
  } else {
    // Select a representative accent, not a tiny bright logo or a large black
    // border. Neutral images still fall back to their most populated colour.
    let best = dominant;
    let bestScore = -1;
    for (const item of palette) {
      const { l, c, h } = item.oklch();
      if (item.proportion < 0.02 || l < 0.18 || l > 0.9) continue;
      if (ignoreLightBackgrounds && ((l > 0.72 && c < 0.05) || isBeigeColor(l, c, h))) continue;
      const score = Math.sqrt(item.proportion)
        * (0.2 + 0.8 * Math.min(c / 0.16, 1))
        * (1 - 0.35 * Math.abs(l - 0.58));
      if (score > bestScore) {
        best = item;
        bestScore = score;
      }
    }
    color = best.hex();
  }

  const position = detectColorBias(pixels, color);
  return { color, position };
}

const POSITION_GRADIENTS: Record<HeroGradientPosition, (rgb: string) => string> = {
  'center-left':  (rgb) => `linear-gradient(to right, rgb(${rgb}) 0%, rgb(${rgb}) 28%, rgba(${rgb}, 0.35) 55%, rgba(${rgb}, 0.08) 75%, transparent 100%)`,
  'center-right': (rgb) => `linear-gradient(to left, rgb(${rgb}) 0%, rgb(${rgb}) 28%, rgba(${rgb}, 0.35) 55%, rgba(${rgb}, 0.08) 75%, transparent 100%)`,
  'top':          (rgb) => `linear-gradient(to bottom, rgb(${rgb}) 0%, rgba(${rgb}, 0.4) 30%, rgba(${rgb}, 0.1) 55%, transparent 85%)`,
  'bottom':       (rgb) => `linear-gradient(to top, rgb(${rgb}) 0%, rgba(${rgb}, 0.4) 30%, rgba(${rgb}, 0.1) 55%, transparent 85%)`,
  'top-left':     (rgb) => `radial-gradient(ellipse 90% 80% at 0% 0%, rgb(${rgb}) 0%, rgba(${rgb}, 0.5) 28%, rgba(${rgb}, 0.15) 55%, transparent 85%)`,
  'top-right':    (rgb) => `radial-gradient(ellipse 90% 80% at 100% 0%, rgb(${rgb}) 0%, rgba(${rgb}, 0.5) 28%, rgba(${rgb}, 0.15) 55%, transparent 85%)`,
  'bottom-left':  (rgb) => `radial-gradient(ellipse 90% 80% at 0% 100%, rgb(${rgb}) 0%, rgba(${rgb}, 0.5) 28%, rgba(${rgb}, 0.15) 55%, transparent 85%)`,
  'bottom-right': (rgb) => `radial-gradient(ellipse 90% 80% at 100% 100%, rgb(${rgb}) 0%, rgba(${rgb}, 0.5) 28%, rgba(${rgb}, 0.15) 55%, transparent 85%)`,
  'center':       (rgb) => `radial-gradient(ellipse 85% 85% at 50% 50%, rgb(${rgb}) 0%, rgba(${rgb}, 0.45) 30%, rgba(${rgb}, 0.12) 60%, transparent 90%)`,
};

export function createMediaPalette(color: string, options?: MediaPaletteOptions) {
  const hex = normalizeMediaColor(color);
  if (!hex) return null;
  const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
  const rgb = channels.join(', ');
  // Dark derivatives keep white text readable even for a fixed white/yellow.
  const surface = channels.map((channel) => Math.round(6 + channel * 0.22)).join(', ');

  const position = options?.position ?? DEFAULT_HERO_GRADIENT_POSITION;
  const gradientFn = POSITION_GRADIENTS[position] ?? POSITION_GRADIENTS[DEFAULT_HERO_GRADIENT_POSITION];
  const heroGradient = gradientFn(rgb);

  return {
    color: hex,
    style: { '--media-color': rgb, '--media-color-surface': surface } as CSSProperties,
    heroGradient,
  };
}
