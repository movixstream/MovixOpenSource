/** Contrat sandbox download-ux — types only. Pas d’import Movix. */

export type MediaType = 'movie' | 'tv';

export type MediaRef = {
  type: MediaType;
  tmdbId: number;
  season?: number;
  episode?: number;
  title?: string;
};

export type ResolveMode = 'stub-ok' | 'stub-empty' | 'stub-fail';

export type ResolveOptions = {
  /** Limit to these provider ids (e.g. ['swiftflow'] for first real test). */
  providers?: string[];
  sourcePrefer?: string;
  hosterPrefer?: string;
  /** Minimum quality ladder step if known (e.g. 720). */
  minQuality?: number;
  /** Base URL Main API (sandbox / CLI). Falls back to env MOVIX_MAIN_API. */
  mainApiBase?: string;
  /** Turnstile token for web `POST .../mp4/resolve` (SwiftFlow). */
  turnstileToken?: string;
  /** Optional VIP access key header. */
  accessKey?: string;
  /**
   * Use `POST /api/swiftflow/tv/mp4/resolve` (no Turnstile) for sandbox tests.
   * Default false — production web path uses Turnstile.
   */
  useTvMp4Resolve?: boolean;
  /** Stub only — ignored by a future real provider. */
  mode?: ResolveMode;
};

export type StreamKind = 'mp4' | 'hls' | 'unknown';

/** Height-like hint when known (2160, 1080, 720…); omit if unknown. */
export type QualityHint = number;

export type DownloadCandidate = {
  id: string;
  media: MediaRef;
  hoster: string;
  source: string;
  kind: StreamKind;
  url: string;
  quality?: QualityHint;
  /** Filled by ranker after merge; higher is better. */
  score?: number;
  referer?: string;
  headers?: Record<string, string>;
  expiresAt?: number;
  raw?: unknown;
};

export type DownloadProgress = {
  phase: 'queued' | 'fetching' | 'writing' | 'done';
  bytesReceived?: number;
  bytesTotal?: number | null;
  percent?: number | null;
  message?: string;
};

export type DownloadOptions = {
  /** Destination directory. Default: sandbox/download-ux/tmp-downloads/ */
  destDir?: string;
  /** Skip when a non-empty file already exists at the target path. Default true. */
  skipIfExists?: boolean;
  /** Try next ranked candidate on failure (ksama-like failover). Default true. */
  failover?: boolean;
  /**
   * Cap bytes written (smoke / verification). When hit, status is `completed`
   * with a truncated file and message noting partial download.
   */
  maxBytes?: number;
  signal?: AbortSignal;
  onProgress?: (progress: DownloadProgress) => void;
};

export type DownloadStatus = 'completed' | 'skipped' | 'failed' | 'cancelled';

export type DownloadResult = {
  ok: boolean;
  status: DownloadStatus;
  candidateId: string;
  path?: string;
  skipped?: boolean;
  error?: string;
  message?: string;
  /** How many candidates were tried (failover). */
  attempts?: number;
};

export type SourceProvider = {
  id: string;
  /** Human label for docs / logs. */
  label: string;
  enabled: boolean;
  supports: (media: MediaRef) => boolean;
  resolve: (media: MediaRef, options?: ResolveOptions) => Promise<DownloadCandidate[]>;
};
