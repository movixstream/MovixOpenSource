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

  let dominant = absoluteDominant;
  if (ignoreLightBackgrounds) {
    const candidates = palette
      .filter((item) => {
        const [r, g, b] = item.array();
        return !isLightNeutralColor(r, g, b);
      })
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

  let dominantChannels: number[] = dominant.array();
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
  } else {
    // Select a representative accent, not a tiny bright logo or a large black
    // border. Neutral images still fall back to their most populated colour.
    let best = dominant;
    let bestScore = -1;
    for (const item of palette) {
      const { l, c } = item.oklch();
      if (item.proportion < 0.02 || l < 0.18 || l > 0.9) continue;
      if (ignoreLightBackgrounds && l > 0.72 && c < 0.05) continue;
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
