import type { DownloadCandidate, StreamKind } from '../types.ts';

const KIND_SCORE: Record<StreamKind, number> = {
  mp4: 3000,
  hls: 1000,
  unknown: 0,
};

/** Higher score = preferred for a clean download. */
export function scoreCandidate(c: DownloadCandidate): number {
  const kind = KIND_SCORE[c.kind] ?? 0;
  const quality = typeof c.quality === 'number' && c.quality > 0 ? c.quality : 0;
  return kind + quality;
}

export function rankCandidates(candidates: DownloadCandidate[]): DownloadCandidate[] {
  return [...candidates]
    .map((c) => ({ ...c, score: scoreCandidate(c) }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

/** Drop exact url duplicates, keep highest score. */
export function dedupeCandidates(candidates: DownloadCandidate[]): DownloadCandidate[] {
  const byUrl = new Map<string, DownloadCandidate>();
  for (const c of candidates) {
    const key = c.url;
    const prev = byUrl.get(key);
    if (!prev || (c.score ?? scoreCandidate(c)) > (prev.score ?? scoreCandidate(prev))) {
      byUrl.set(key, c);
    }
  }
  return [...byUrl.values()];
}
