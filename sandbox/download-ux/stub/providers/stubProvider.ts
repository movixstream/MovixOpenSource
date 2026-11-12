import type { DownloadCandidate, MediaRef, ResolveOptions, SourceProvider } from '../types.ts';

/** Provider de test actif — aucun réseau. */
export const stubProvider: SourceProvider = {
  id: 'stub',
  label: 'Stub (local test)',
  enabled: true,
  supports: () => true,
  async resolve(media: MediaRef, options: ResolveOptions = {}): Promise<DownloadCandidate[]> {
    const mode = options.mode ?? 'stub-ok';
    if (mode === 'stub-fail') {
      throw new Error('stub-fail: resolvePlayable a simulé une panne infra');
    }
    if (mode === 'stub-empty') return [];

    const label =
      media.title ||
      (media.type === 'movie'
        ? `movie/${media.tmdbId}`
        : `tv/${media.tmdbId}/s${media.season ?? '?'}/e${media.episode ?? '?'}`);

    return [
      {
        id: `stub-${media.type}-${media.tmdbId}-${media.season ?? 0}-${media.episode ?? 0}`,
        media: { ...media },
        hoster: options.hosterPrefer || 'stub',
        source: 'stub',
        kind: 'mp4',
        quality: 1080,
        url: `https://stub.local/playable/${encodeURIComponent(label)}.mp4`,
        expiresAt: Date.now() + 60 * 60 * 1000,
        raw: { stub: true, mode },
      },
    ];
  },
};
