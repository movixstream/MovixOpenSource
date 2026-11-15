import { TMDB_IMAGE_URL } from '@/config/config';

export type ImageQuality = 'auto' | 'economy' | 'high';
export type TmdbImageKind = 'poster' | 'backdrop' | 'profile' | 'still' | 'logo';
export type TmdbImageRole = 'card' | 'detail' | 'hero' | 'background' | 'morph';

const WIDTHS = {
  poster: [92, 154, 185, 342, 500, 780],
  backdrop: [300, 780, 1280],
  logo: [45, 92, 154, 185, 300, 500],
  still: [92, 185, 300],
  profile: [45, 185],
} as const;

type ImageOptions = {
  kind: TmdbImageKind;
  quality: ImageQuality;
  role?: TmdbImageRole;
  fallback?: string;
};

// Only rewrite TMDB assets. Uploaded previews, data URLs and other providers
// keep their own image URL and must never receive a fabricated srcset.
function tmdbPath(source: string): string | null {
  if (/^\/[\w.-]+\.(?:jpg|jpeg|png|webp|svg)$/i.test(source)) return source;
  return source.match(/^https:\/\/image\.tmdb\.org\/t\/p\/[^/]+(\/[\w.-]+\.(?:jpg|jpeg|png|webp|svg))$/i)?.[1] ?? null;
}

function widthLimit({ kind, quality, role = 'card' }: ImageOptions): number {
  if (role === 'morph') return kind === 'poster'
    ? (quality === 'economy' ? 500 : 780) : (quality === 'economy' ? 780 : 1280);
  if (role === 'background' && kind === 'poster' && quality !== 'high') return quality === 'economy' ? 500 : 780;
  if (kind === 'logo') return quality === 'economy' ? 300 : 500;
  if (kind === 'profile') return quality === 'economy' ? 185 : Infinity;
  if (kind === 'still') return quality === 'economy' ? 300 : Infinity;
  if (kind === 'backdrop') {
    if (quality === 'economy') return role === 'hero' ? 1280 : 780;
    if (role === 'background' && quality === 'auto') return 1280;
    return role === 'card' ? 1280 : Infinity;
  }
  if (quality === 'economy') return role === 'detail' ? 500 : 342;
  return role === 'card' ? 780 : Infinity;
}

export function getCoverImageWidth(width: number, height: number, ratio: number, dpr = 1): number {
  return Math.ceil(Math.max(width, height * (ratio > 0 ? ratio : 16 / 9)) * Math.max(1, dpr));
}

export function getTmdbImageSize(options: ImageOptions & { width: number }): string {
  const requested = Number.isFinite(options.width) ? Math.max(1, options.width) : 1280;
  const target = Math.min(requested, widthLimit(options));
  const width = WIDTHS[options.kind].find((candidate) => candidate >= target);
  return width ? `w${width}` : options.kind === 'profile' ? 'h632' : 'original';
}

/** Pick an official size without inventing a width descriptor for original. */
export function getTmdbImageUrl(source: string | null | undefined, options: ImageOptions & { width: number }): string {
  if (!source) return options.fallback ?? '';
  const path = tmdbPath(source);
  if (!path) return source;
  const size = /\.svg$/i.test(path) ? 'original' : getTmdbImageSize(options);
  return `${TMDB_IMAGE_URL}/${size}${path}`;
}

export function getTmdbImageProps(source: string | null | undefined, options: ImageOptions & {
  kind: 'poster' | 'backdrop';
  sizes: string;
  originalWidth?: number;
}): { src: string; srcSet?: string; sizes?: string } {
  if (!source) return { src: options.fallback ?? '' };
  const path = tmdbPath(source);
  if (!path) return { src: source };
  if (/\.svg$/i.test(path)) return { src: `${TMDB_IMAGE_URL}/original${path}` };
  const limit = widthLimit(options);
  const widths = WIDTHS[options.kind].filter((width) => width <= limit
    && (!options.originalWidth || width < options.originalWidth));
  const candidates = widths.map((width) => `${TMDB_IMAGE_URL}/w${width}${path} ${width}w`);
  if (options.originalWidth && Number.isFinite(options.originalWidth) && options.originalWidth > 0
    && (options.originalWidth <= limit || limit === Infinity)) {
    candidates.push(`${TMDB_IMAGE_URL}/original${path} ${options.originalWidth}w`);
  }
  return {
    src: getTmdbImageUrl(source, { ...options, width: options.kind === 'poster' ? 342 : 780 }),
    srcSet: candidates.length ? candidates.join(', ') : undefined,
    sizes: candidates.length ? options.sizes : undefined,
  };
}
