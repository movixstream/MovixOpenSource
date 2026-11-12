import type { DownloadCandidate, MediaRef, ResolveOptions } from './types.ts';
import { selectProviders } from './providers/registry.ts';
import { dedupeCandidates, rankCandidates } from './providers/rank.ts';
import { assertMediaRef } from './validateMedia.ts';

/**
 * Agrège les resolves de tous les providers actifs (ou filtrés),
 * déduplique et rank par qualité / kind — download ensuite indifférent à la source.
 */
export async function resolvePlayable(
  media: MediaRef,
  options: ResolveOptions = {},
): Promise<DownloadCandidate[]> {
  assertMediaRef(media);

  const selected = selectProviders(options.providers);
  if (selected.length === 0) {
    return [];
  }

  const chunks = await Promise.all(
    selected.map(async (provider) => {
      if (!provider.supports(media)) return [] as DownloadCandidate[];
      try {
        return await provider.resolve(media, options);
      } catch (err) {
        // Soft-fail : un provider cassé n’empêche pas les autres (sauf stub-fail seul).
        if (provider.id === 'stub' && options.mode === 'stub-fail') throw err;
        console.warn(`[resolvePlayable] provider ${provider.id} failed:`, err);
        return [];
      }
    }),
  );

  let merged = dedupeCandidates(chunks.flat());
  if (typeof options.minQuality === 'number') {
    merged = merged.filter(
      (c) => c.quality == null || c.quality >= options.minQuality!,
    );
  }
  if (options.sourcePrefer) {
    merged.sort((a, b) => {
      const ap = a.source === options.sourcePrefer ? 1 : 0;
      const bp = b.source === options.sourcePrefer ? 1 : 0;
      return bp - ap;
    });
  }
  return rankCandidates(merged);
}
