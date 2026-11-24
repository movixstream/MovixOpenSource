/**
 * Teintes de la barre de sections, tirées de la couleur de la fiche
 * (`useMediaColor('hero', …)`, la même que la lueur de la grande image).
 *
 * Comme le bandeau collé de Cinepulse : un fond sombre de la teinte du film
 * quand la barre est collée sous l'en-tête, et un trait clair de la même
 * teinte sous la section courante. Le calcul se fait en OKLCH : seules la
 * clarté et la saturation bougent, la teinte reste celle de l'image. Une
 * couleur presque grise ne donne rien : la barre garde son noir et son rouge.
 */

export interface SectionNavTint {
  /** Trait sous la section courante : clair, lisible sur le noir. */
  line: string;
  /** Fond de la barre collée et de l'en-tête : sombre, texte blanc lisible. */
  surface: string;
}

/** En dessous, la couleur est un gris : pas de teinte. */
const MIN_CHROMA = 0.03;
const LINE_LIGHTNESS = 0.66;
const LINE_CHROMA = { min: 0.11, max: 0.2 };
const SURFACE_MAX_LIGHTNESS = 0.25;
const SURFACE_MAX_CHROMA = 0.075;

type Oklch = { l: number; c: number; h: number };

const toLinear = (value: number) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
const fromLinear = (value: number) => (value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055);

function hexToOklch(hex: string): Oklch | null {
  const match = /^#?([\da-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const [r, g, b] = [0, 2, 4].map((offset) => toLinear(parseInt(match[1].slice(offset, offset + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B), h: Math.atan2(B, A) };
}

/** Canaux sRGB linéaires (0-1 dans le gamut) d'une couleur OKLCH. */
function oklchToLinearRgb({ l, c, h }: Oklch): [number, number, number] {
  const A = c * Math.cos(h);
  const B = c * Math.sin(h);
  const L = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const M = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const S = (l - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
}

const inGamut = (channels: number[]) => channels.every((value) => value >= -1e-4 && value <= 1 + 1e-4);

/** Couleur OKLCH en hex ; la saturation baisse jusqu'à entrer dans le sRGB. */
function oklchToHex(color: Oklch): string {
  let channels = oklchToLinearRgb(color);
  if (!inGamut(channels)) {
    let low = 0;
    let high = color.c;
    for (let step = 0; step < 20; step += 1) {
      const mid = (low + high) / 2;
      if (inGamut(oklchToLinearRgb({ ...color, c: mid }))) low = mid;
      else high = mid;
    }
    channels = oklchToLinearRgb({ ...color, c: low });
  }
  return `#${channels
    .map((value) => Math.round(Math.min(1, Math.max(0, fromLinear(Math.min(1, Math.max(0, value))))) * 255).toString(16).padStart(2, '0'))
    .join('')}`;
}

export function sectionNavTint(hex: string | null | undefined): SectionNavTint | null {
  const color = hex ? hexToOklch(hex) : null;
  if (!color || color.c < MIN_CHROMA) return null;
  return {
    line: oklchToHex({
      l: LINE_LIGHTNESS,
      c: Math.min(LINE_CHROMA.max, Math.max(LINE_CHROMA.min, color.c)),
      h: color.h,
    }),
    surface: oklchToHex({
      l: Math.min(color.l, SURFACE_MAX_LIGHTNESS),
      c: Math.min(color.c, SURFACE_MAX_CHROMA),
      h: color.h,
    }),
  };
}
