export type {
  MediaType,
  MediaRef,
  ResolveMode,
  ResolveOptions,
  StreamKind,
  QualityHint,
  DownloadCandidate,
  DownloadProgress,
  DownloadOptions,
  DownloadStatus,
  DownloadResult,
  SourceProvider,
} from './types.ts';

export { assertMediaRef } from './validateMedia.ts';
export { resolvePlayable } from './resolvePlayable.ts';
export {
  download,
  resolveAndDownloadFirst,
  isStubUrl,
  buildSafeFilename,
  DEFAULT_DEST_DIR,
} from './download.ts';
export { listProviders, getProvider, selectProviders } from './providers/registry.ts';
export { rankCandidates, scoreCandidate, dedupeCandidates } from './providers/rank.ts';
export { watchCatalogProvider, WATCH_CATALOG_IDS } from './providers/watchCatalog.ts';
