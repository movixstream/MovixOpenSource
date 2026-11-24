import type { TFunction } from 'i18next';

/** Vidéo TMDB (`/videos`), réduite aux champs lus par les fiches. */
export interface DetailsVideo {
  id: string;
  key: string;
  name: string;
  type?: string;
  size?: number;
  iso_639_1?: string | null;
  /** Mise en ligne par le studio ou la chaîne. */
  official?: boolean;
  /** Date de publication (ISO 8601). */
  published_at?: string;
}

/** Ordre des types : ce qu'on vient voir d'abord. */
const VIDEO_TYPE_RANK: Record<string, number> = {
  Trailer: 0,
  Teaser: 1,
  Clip: 2,
  Featurette: 3,
  'Behind the Scenes': 4,
  'Opening Credits': 5,
  Bloopers: 6,
};

/**
 * Vidéos de la plus importante à la moins importante. TMDB ne donne pas le
 * nombre de vues : on s'en approche avec le type (bandes-annonces d'abord),
 * les vidéos officielles, la meilleure qualité, puis les plus récentes.
 * Renvoie une copie.
 */
export function sortDetailsVideos<T extends DetailsVideo>(videos: readonly T[]): T[] {
  const rank = (video: DetailsVideo) => VIDEO_TYPE_RANK[video.type ?? ''] ?? 7;
  const time = (video: DetailsVideo) => (video.published_at ? Date.parse(video.published_at) || 0 : 0);
  return [...videos].sort((a, b) => (
    rank(a) - rank(b)
    || Number(b.official === true) - Number(a.official === true)
    || (b.size ?? 0) - (a.size ?? 0)
    || time(b) - time(a)
  ));
}

const VIDEO_TYPE_KEYS: Record<string, string> = {
  Trailer: 'details.videoTrailer',
  Clip: 'details.videoClip',
  'Behind the Scenes': 'details.videoBehindScenes',
};

/** Ligne sous une tuile vidéo : type traduit et langue (« Bande-annonce · FR »). */
export function describeDetailsVideo(video: DetailsVideo, t: TFunction): string {
  const type = video.type ? (VIDEO_TYPE_KEYS[video.type] ? t(VIDEO_TYPE_KEYS[video.type]) : video.type) : '';
  const language = video.iso_639_1 ? video.iso_639_1.toUpperCase() : '';
  return [type, language].filter(Boolean).join(' · ');
}

/** Vignette YouTube 16:9 d'une vidéo TMDB. */
export const detailsVideoThumbnail = (video: DetailsVideo): string =>
  `https://img.youtube.com/vi/${video.key}/mqdefault.jpg`;
