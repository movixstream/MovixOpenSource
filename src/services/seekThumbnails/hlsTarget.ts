/**
 * Traduit un fragment de playlist hls.js en demande de miniature.
 *
 * Les types sont structurels : seuls les champs lus ici sont décrits, ce qui
 * garde ce fichier testable sans charger hls.js.
 */
import type { SegmentRef, ThumbnailJob, ThumbnailSpan } from './protocol.ts';

export type FragmentLike = {
  url: string;
  start: number;
  duration: number;
  byteRange?: readonly number[];
  initSegment?: FragmentLike | null;
  decryptdata?: {
    method: string;
    uri: string;
    iv: Uint8Array | null;
    key: Uint8Array | null;
  } | null;
  gap?: boolean;
};

export type ThumbnailTarget = { job: ThumbnailJob; span?: ThumbnailSpan };

/**
 * Fragment qui couvre `time`. Survoler le tout dernier pixel de la barre tombe
 * juste après la fin du dernier fragment : on rend alors celui-là.
 */
export const findFragmentAt = <T extends FragmentLike>(
  fragments: readonly T[],
  time: number,
): T | null => {
  if (!fragments.length || time < fragments[0].start) return fragments[0] ?? null;
  let low = 0;
  let high = fragments.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (fragments[middle].start <= time) low = middle;
    else high = middle - 1;
  }
  return fragments[low];
};

const segmentRef = (fragment: FragmentLike, baseUrl: string): SegmentRef | null => {
  let url: string;
  try {
    url = new URL(fragment.url, baseUrl).href;
  } catch {
    return null;
  }
  const ref: SegmentRef = { url };

  const range = fragment.byteRange;
  if (range && range.length === 2) ref.range = [range[0], range[1]];

  const keyInfo = fragment.decryptdata;
  if (keyInfo && keyInfo.method && keyInfo.method !== 'NONE') {
    // SAMPLE-AES et les DRM chiffrent chaque image : hors de portée ici.
    if (keyInfo.method !== 'AES-128' || !keyInfo.iv || keyInfo.iv.length !== 16 || !keyInfo.uri) {
      return null;
    }
    let keyUrl: string;
    try {
      keyUrl = new URL(keyInfo.uri, baseUrl).href;
    } catch {
      return null;
    }
    ref.aes = { iv: keyInfo.iv.slice(), keyUrl };
    if (keyInfo.key && keyInfo.key.length === 16) ref.aes.key = keyInfo.key.slice();
  }
  return ref;
};

/** `null` quand le fragment ne peut pas donner de miniature (trou, DRM). */
export const hlsThumbnailTarget = (
  fragment: FragmentLike,
  playlistUrl: string,
): ThumbnailTarget | null => {
  if (fragment.gap) return null;
  const segment = segmentRef(fragment, playlistUrl);
  if (!segment) return null;

  const job: ThumbnailJob = { kind: 'hls', segment };
  if (fragment.initSegment) {
    const init = segmentRef(fragment.initSegment, playlistUrl);
    if (!init) return null;
    job.init = init;
  }
  return { job, span: { from: fragment.start, to: fragment.start + fragment.duration } };
};
