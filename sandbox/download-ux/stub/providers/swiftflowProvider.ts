import type { DownloadCandidate, MediaRef, ResolveOptions, SourceProvider } from '../types.ts';
import { fetchJson, joinUrl } from './httpJson.ts';

type Mp4Entry = {
  index: number;
  label?: string;
  quality?: string | null;
  size?: string | null;
  language?: string;
};

type CatalogMovie = {
  success?: boolean;
  mp4?: { available?: boolean; entries?: Mp4Entry[] };
  title?: string;
};

type CatalogTv = CatalogMovie & {
  season?: number;
  episodes?: Record<string, unknown>;
};

type ResolveBody = {
  success?: boolean;
  url?: string;
  index?: number;
  label?: string;
  quality?: string | null;
  size?: string | null;
  language?: string;
  error?: string;
};

function mainApi(options: ResolveOptions): string | null {
  const base = (options.mainApiBase || process.env.MOVIX_MAIN_API || '').trim();
  return base || null;
}

/** Parse "1080p", "1080", "Full HD" → number or undefined. */
export function parseQualityHint(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined;
  const m = String(raw).match(/(\d{3,4})\s*p?/i);
  if (m) return Number(m[1]);
  const lower = String(raw).toLowerCase();
  if (lower.includes('4k') || lower.includes('uhd')) return 2160;
  if (lower.includes('full hd') || lower.includes('fhd')) return 1080;
  if (lower.includes('hd')) return 720;
  return undefined;
}

function authHeaders(options: ResolveOptions): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.accessKey) headers['x-access-key'] = options.accessKey;
  return headers;
}

async function fetchCatalog(
  base: string,
  media: MediaRef,
  options: ResolveOptions,
): Promise<{ entries: Mp4Entry[]; title?: string }> {
  if (media.type === 'movie') {
    const url = joinUrl(base, `/api/swiftflow/movie/${media.tmdbId}`);
    const { ok, data } = await fetchJson<CatalogMovie>(url, { headers: authHeaders(options) });
    if (!ok || !data?.success) return { entries: [] };
    const entries = data.mp4?.available ? data.mp4.entries || [] : [];
    return { entries, title: data.title };
  }

  if (media.season == null || media.episode == null) {
    // MP4 SwiftFlow est porté à l’épisode ; pas de fichier saison unique.
    return { entries: [] };
  }

  const url = joinUrl(
    base,
    `/api/swiftflow/tv/${media.tmdbId}/season/${media.season}?episode=${media.episode}`,
  );
  const { ok, data } = await fetchJson<CatalogTv>(url, { headers: authHeaders(options) });
  if (!ok || !data?.success) return { entries: [] };
  const entries = data.mp4?.available ? data.mp4.entries || [] : [];
  return { entries, title: data.title };
}

async function resolveMp4Url(
  base: string,
  media: MediaRef,
  index: number,
  options: ResolveOptions,
): Promise<ResolveBody | null> {
  const kind = media.type === 'movie' ? 'movie' : 'tv';
  const body: Record<string, unknown> = {
    kind,
    tmdbId: media.tmdbId,
    index,
  };
  if (kind === 'tv') {
    body.season = media.season;
    body.episode = media.episode;
  }

  const useTv = options.useTvMp4Resolve === true;
  if (!useTv) {
    if (!options.turnstileToken && process.env.TURNSTILE_SECRET_KEY) {
      // Sans token, le serveur web refuse — on ne spam pas.
    }
    body.turnstileToken = options.turnstileToken || process.env.MOVIX_TURNSTILE_TOKEN || '';
  }

  const path = useTv ? '/api/swiftflow/tv/mp4/resolve' : '/api/swiftflow/mp4/resolve';
  const { ok, data } = await fetchJson<ResolveBody>(joinUrl(base, path), {
    method: 'POST',
    headers: {
      ...authHeaders(options),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!ok || !data?.success || !data.url) return null;
  return data;
}

/**
 * Provider P0 : même pipeline que la lecture SwiftFlow / SwiftFlux (MP4),
 * pas le parcours `/download` DDL.
 *
 * Activé si `MOVIX_MAIN_API` (ou options.mainApiBase) est défini.
 * Resolve URL : Turnstile web par défaut, ou `useTvMp4Resolve` pour tests sandbox.
 */
export const swiftflowProvider: SourceProvider = {
  id: 'swiftflow',
  label: 'SwiftFlow / SwiftFlux MP4 (visionnage)',
  get enabled() {
    return Boolean((process.env.MOVIX_MAIN_API || '').trim());
  },
  supports(media: MediaRef) {
    if (media.type === 'movie') return true;
    return media.season != null && media.episode != null;
  },
  async resolve(media: MediaRef, options: ResolveOptions = {}): Promise<DownloadCandidate[]> {
    const base = mainApi(options);
    if (!base) return [];
    if (!this.supports(media)) return [];

    const { entries, title } = await fetchCatalog(base, media, options);
    if (!entries.length) return [];

    const mediaOut: MediaRef = {
      ...media,
      title: media.title || title,
    };

    const candidates: DownloadCandidate[] = [];

    for (const entry of entries) {
      const resolved = await resolveMp4Url(base, media, entry.index, options);
      if (!resolved?.url) continue;

      const quality = parseQualityHint(resolved.quality ?? entry.quality);
      let referer: string | undefined;
      try {
        referer = new URL(resolved.url).origin + '/';
      } catch {
        referer = undefined;
      }

      candidates.push({
        id: `swiftflow-${media.type}-${media.tmdbId}-${media.season ?? 0}-${media.episode ?? 0}-${entry.index}`,
        media: mediaOut,
        hoster: 'swiftflow-mp4',
        source: 'swiftflow',
        kind: 'mp4',
        quality,
        url: resolved.url,
        referer,
        raw: {
          label: resolved.label ?? entry.label,
          size: resolved.size ?? entry.size,
          language: resolved.language ?? entry.language,
          index: entry.index,
        },
      });
    }

    return candidates;
  },
};
