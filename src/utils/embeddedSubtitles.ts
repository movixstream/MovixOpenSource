import type { SubtitleTrack } from '@/services/subtitles/types';

/**
 * Sous-titres déclarés par le lecteur d'un hébergeur (aujourd'hui Uqload :
 * `jwplayer().setup({ tracks })`), renvoyés par l'extension ou le userscript
 * avec le résultat d'extraction.
 *
 * `content` porte le texte déjà téléchargé par l'extension : l'hébergeur ne
 * renvoie pas d'en-têtes CORS, le site ne pourrait pas lire le fichier seul.
 */
export interface EmbeddedSubtitle {
  url: string;
  label: string;
  lang: string;
  format: 'srt' | 'vtt';
  content?: string;
  default?: boolean;
}

export interface EmbeddedSubtitleTrack extends SubtitleTrack {
  isDefault: boolean;
}

const MAX_TRACKS_PER_MEDIA = 8;
const MAX_CONTENT_LENGTH = 2 * 1024 * 1024;
const MAX_REGISTERED_MEDIA = 50;

// Clé : URL média renvoyée par l'extraction, qui devient le `src` du lecteur.
const registry = new Map<string, EmbeddedSubtitleTrack[]>();
// Texte déjà téléchargé par l'extension, par id de piste. Pas de blob URL :
// une nouvelle extraction de la même source le révoquerait sous le lecteur.
const contents = new Map<string, string>();

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

/** Ne garde que des pistes bien formées : la réponse vient d'un script tiers. */
export function sanitizeEmbeddedSubtitles(raw: unknown): EmbeddedSubtitle[] {
  if (!Array.isArray(raw)) return [];
  const subtitles: EmbeddedSubtitle[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    if (!isHttpsUrl(record.url)) continue;
    const content =
      typeof record.content === 'string' && record.content.trim() && record.content.length <= MAX_CONTENT_LENGTH
        ? record.content
        : undefined;
    const lang = typeof record.lang === 'string' && /^[a-z]{2,3}$/i.test(record.lang) ? record.lang.toLowerCase() : 'und';
    const label = typeof record.label === 'string' && record.label.trim() ? record.label.trim().slice(0, 80) : lang.toUpperCase();
    subtitles.push({
      url: record.url,
      label,
      lang,
      format: record.format === 'srt' ? 'srt' : 'vtt',
      content,
      default: record.default === true,
    });
    if (subtitles.length >= MAX_TRACKS_PER_MEDIA) break;
  }
  return subtitles;
}

function releaseTracks(tracks: EmbeddedSubtitleTrack[] | undefined): void {
  tracks?.forEach((track) => contents.delete(track.id));
}

export function registerEmbeddedSubtitles(mediaUrl: string | undefined, provider: string, raw: unknown): void {
  if (!mediaUrl) return;
  const subtitles = sanitizeEmbeddedSubtitles(raw);
  if (!subtitles.length) return;

  const source = provider.charAt(0).toUpperCase() + provider.slice(1);
  const tracks = subtitles.map((subtitle, index): EmbeddedSubtitleTrack => ({
    id: `${provider}:${mediaUrl}#${index}`,
    provider,
    source,
    lang: subtitle.lang,
    label: subtitle.label,
    url: subtitle.url,
    format: subtitle.format,
    encoding: 'plain',
    isDefault: Boolean(subtitle.default),
  }));

  releaseTracks(registry.get(mediaUrl));
  registry.delete(mediaUrl);
  registry.set(mediaUrl, tracks);
  tracks.forEach((track, index) => {
    const content = subtitles[index].content;
    if (content) contents.set(track.id, content);
  });
  while (registry.size > MAX_REGISTERED_MEDIA) {
    const oldest = registry.keys().next().value as string;
    releaseTracks(registry.get(oldest));
    registry.delete(oldest);
  }
}

/** Texte déjà téléchargé pour cette piste, si l'extension l'a fourni. */
export function getEmbeddedSubtitleContent(trackId: string): string | undefined {
  return contents.get(trackId);
}

export function getEmbeddedSubtitleTracks(mediaUrl: string | undefined): EmbeddedSubtitleTrack[] {
  if (!mediaUrl) return [];
  return registry.get(mediaUrl) ?? [];
}
