/**
 * Resolve « général » sur les catalogues de *visionnage* (pas `/download` DDL).
 *
 * - Sans VIP : récupère les embeds (inventaire) — pas encore téléchargeables tels quels.
 * - Avec `accessKey` + `?resolve=1` : récupère `m3u8Url` quand le serveur les joint.
 * - SwiftFlow MP4 reste le meilleur chemin fichier (provider dédié).
 */
import type { DownloadCandidate, MediaRef, ResolveOptions, SourceProvider } from '../types.ts';
import { fetchJson, joinUrl } from './httpJson.ts';

export type CatalogSourceId =
  | 'wiflix'
  | 'fstream'
  | 'j1f'
  | 'coflix'
  | 'cpasmal'
  | 'swiftflow-catalog';

type CatalogDef = {
  id: CatalogSourceId;
  /** Build path for movie / tv episode. */
  path: (media: MediaRef) => string | null;
  /** Where players live in the JSON (best-effort). */
  extract: (data: unknown, media: MediaRef) => Array<{
    hoster: string;
    embedUrl?: string;
    m3u8Url?: string;
    label?: string;
  }>;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function playerName(p: Record<string, unknown>): string {
  return String(p.name || p.hoster || p.type || 'embed');
}

function collectLangMaps(
  container: unknown,
): Array<{ hoster: string; embedUrl?: string; m3u8Url?: string; label?: string }> {
  const out: Array<{ hoster: string; embedUrl?: string; m3u8Url?: string; label?: string }> = [];
  const root = asRecord(container);
  if (!root) return out;

  const pushPlayer = (p: unknown) => {
    const pl = asRecord(p);
    if (!pl) return;
    const embedUrl = typeof pl.url === 'string' ? pl.url : undefined;
    const m3u8Url = typeof pl.m3u8Url === 'string' ? pl.m3u8Url : undefined;
    if (!embedUrl && !m3u8Url) return;
    out.push({
      hoster: playerName(pl),
      embedUrl,
      m3u8Url,
      label: typeof pl.label === 'string' ? pl.label : undefined,
    });
  };

  // { vf: [...], vostfr: [...] }
  for (const key of ['vf', 'vostfr', 'VF', 'VOSTFR']) {
    const arr = root[key];
    if (Array.isArray(arr)) arr.forEach(pushPlayer);
  }

  // flat array of players
  if (Array.isArray(container)) container.forEach(pushPlayer);

  // { players: { vf, vostfr } } or { players: [...] }
  if (root.players) {
    out.push(...collectLangMaps(root.players));
  }
  if (root.links) {
    out.push(...collectLangMaps(root.links));
  }
  if (root.organized) {
    out.push(...collectLangMaps(root.organized));
  }

  return out;
}

function extractEpisodeBucket(data: unknown, episode: number) {
  const root = asRecord(data);
  if (!root) return null;
  const episodes = asRecord(root.episodes);
  if (!episodes) return null;
  return episodes[String(episode)] ?? episodes[episode] ?? null;
}

const CATALOGS: CatalogDef[] = [
  {
    id: 'wiflix',
    path: (m) =>
      m.type === 'movie'
        ? `/api/wiflix/movie/${m.tmdbId}`
        : m.season != null
          ? `/api/wiflix/tv/${m.tmdbId}/${m.season}`
          : null,
    extract: (data, m) => {
      if (m.type === 'tv' && m.episode != null) {
        const ep = extractEpisodeBucket(data, m.episode);
        return collectLangMaps(ep);
      }
      const root = asRecord(data);
      return collectLangMaps(root?.players ?? data);
    },
  },
  {
    id: 'fstream',
    path: (m) =>
      m.type === 'movie'
        ? `/api/fstream/movie/${m.tmdbId}`
        : m.season != null && m.episode != null
          ? `/api/fstream/tv/${m.tmdbId}/season/${m.season}?episode=${m.episode}`
          : null,
    extract: (data, m) => {
      if (m.type === 'tv' && m.episode != null) {
        return collectLangMaps(extractEpisodeBucket(data, m.episode));
      }
      const root = asRecord(data);
      return collectLangMaps(root?.players ?? root?.organized ?? data);
    },
  },
  {
    id: 'j1f',
    path: (m) =>
      m.type === 'movie'
        ? `/api/j1f/movie/${m.tmdbId}`
        : m.season != null && m.episode != null
          ? `/api/j1f/tv/${m.tmdbId}/season/${m.season}?episode=${m.episode}`
          : null,
    extract: (data, m) => {
      if (m.type === 'tv' && m.episode != null) {
        return collectLangMaps(extractEpisodeBucket(data, m.episode));
      }
      const root = asRecord(data);
      return collectLangMaps(root?.players ?? data);
    },
  },
  {
    id: 'coflix',
    path: (m) =>
      m.type === 'movie'
        ? `/api/tmdb/movie/${m.tmdbId}`
        : m.season != null
          ? `/api/tmdb/tv/${m.tmdbId}?season=${m.season}${m.episode != null ? `&episode=${m.episode}` : ''}`
          : null,
    extract: (data, m) => {
      if (m.type === 'tv' && m.episode != null) {
        return collectLangMaps(extractEpisodeBucket(data, m.episode));
      }
      return collectLangMaps(asRecord(data)?.players ?? data);
    },
  },
  {
    id: 'swiftflow-catalog',
    path: (m) =>
      m.type === 'movie'
        ? `/api/swiftflow/movie/${m.tmdbId}`
        : m.season != null
          ? `/api/swiftflow/tv/${m.tmdbId}/season/${m.season}${m.episode != null ? `?episode=${m.episode}` : ''}`
          : null,
    extract: (data, m) => {
      // Iframe players only here — MP4 URLs viennent du provider swiftflow dédié.
      if (m.type === 'tv' && m.episode != null) {
        return collectLangMaps(extractEpisodeBucket(data, m.episode));
      }
      return collectLangMaps(asRecord(data)?.players ?? data);
    },
  },
];

function mainApi(options: ResolveOptions): string | null {
  const base = (options.mainApiBase || process.env.MOVIX_MAIN_API || '').trim();
  return base || null;
}

function authHeaders(options: ResolveOptions): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.accessKey) headers['x-access-key'] = options.accessKey;
  return headers;
}

async function resolveOneCatalog(
  def: CatalogDef,
  media: MediaRef,
  options: ResolveOptions,
  base: string,
): Promise<DownloadCandidate[]> {
  const path = def.path(media);
  if (!path) return [];

  const wantResolve = Boolean(options.accessKey);
  const url = joinUrl(base, wantResolve ? `${path}${path.includes('?') ? '&' : '?'}resolve=1` : path);
  const { ok, data } = await fetchJson<unknown>(url, { headers: authHeaders(options) });
  if (!ok) return [];

  const items = def.extract(data, media);
  const out: DownloadCandidate[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.m3u8Url) {
      let referer: string | undefined;
      try {
        referer = new URL(item.m3u8Url).origin + '/';
      } catch {
        referer = undefined;
      }
      out.push({
        id: `${def.id}-hls-${media.tmdbId}-${i}`,
        media: { ...media },
        hoster: item.hoster,
        source: def.id,
        kind: 'hls',
        url: item.m3u8Url,
        referer,
        raw: { label: item.label, embedUrl: item.embedUrl, resolved: true },
      });
      continue;
    }
    if (item.embedUrl) {
      // Inventaire visionnage : pas encore un flux fichier.
      out.push({
        id: `${def.id}-embed-${media.tmdbId}-${i}`,
        media: { ...media },
        hoster: item.hoster,
        source: def.id,
        kind: 'unknown',
        url: item.embedUrl,
        raw: {
          label: item.label,
          needsServerResolve: true,
          note: 'Embed lecture — passer accessKey + resolve=1 pour m3u8, ou provider swiftflow pour MP4',
        },
      });
    }
  }

  return out;
}

/**
 * Meta-provider : fan-out sur plusieurs catalogues de visionnage.
 * Activé dès que MAIN_API est défini.
 */
export const watchCatalogProvider: SourceProvider = {
  id: 'watch-catalog',
  label: 'Catalogues visionnage (wiflix/fstream/j1f/… + resolve=1 si VIP)',
  get enabled() {
    return Boolean((process.env.MOVIX_MAIN_API || '').trim());
  },
  supports(media) {
    return media.type === 'movie' || (media.season != null && media.episode != null) || media.season != null;
  },
  async resolve(media, options = {}) {
    const base = mainApi(options);
    if (!base) return [];

    const filter = options.providers?.filter((id) => id !== 'watch-catalog' && id !== 'stub' && id !== 'swiftflow');
    const defs = filter?.length
      ? CATALOGS.filter((c) => filter.includes(c.id))
      : CATALOGS;

    const chunks = await Promise.all(
      defs.map((def) =>
        resolveOneCatalog(def, media, options, base).catch((err) => {
          console.warn(`[watch-catalog] ${def.id}:`, err);
          return [] as DownloadCandidate[];
        }),
      ),
    );
    return chunks.flat();
  },
};

export const WATCH_CATALOG_IDS = CATALOGS.map((c) => c.id);
