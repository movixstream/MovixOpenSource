import { extractMediaColor, HERO_GRADIENT_POSITIONS, isMediaColorAlgorithm, MEDIA_COLOR_ALGORITHMS, normalizeMediaColor, type HeroGradientCardinal, type MediaColorAlgorithm } from '@/utils/mediaColors';

const CACHE_KEY = 'movix_media_colors_v8';
const CACHE_LIMIT = 256;

export interface MediaColorCacheEntry {
  color: string | null;
  position: HeroGradientCardinal;
  expires: number;
  persist: boolean;
}

const cache = new Map<string, MediaColorCacheEntry>();
let hydrated = false;
let persistTimer: ReturnType<typeof setTimeout> | undefined;
const cacheKey = (source: string, algorithm: MediaColorAlgorithm, ignoreLightBackgrounds = true, preview = false) =>
  `${preview ? 'preview|' : ''}${algorithm}|${ignoreLightBackgrounds ? 'vibrant|' : 'raw|'}${source}`;
const localPreviews = new Set<string>();

export interface MediaColorPreviewImage {
  url: string;
  fileName?: string;
}

export function createMediaColorFilePreview(file: File): MediaColorPreviewImage {
  const url = URL.createObjectURL(file);
  localPreviews.add(url);
  return { url, fileName: file.name };
}

export function releaseMediaColorFilePreview(source: string) {
  if (!localPreviews.delete(source)) return;
  clearMediaColorPreviewCache(source);
  URL.revokeObjectURL(source);
}

/** Custom examples are fetched by the browser, with CORS, never by a proxy.
 * Preserve the exact asset URL (including signed query parameters/crops). */
export function getMediaColorPreviewSource(image: string | null | undefined, allowLocal = false): string | null {
  if (!image || image.length > 4096) return null;
  // Only accept object URLs created for a file selected in this settings UI.
  // The URL input keeps its HTTPS-only validation.
  if (allowLocal && localPreviews.has(image)) return image;
  try {
    const url = new URL(image.trim());
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function clearMediaColorPreviewCache(source: string) {
  for (const algorithm of MEDIA_COLOR_ALGORITHMS) {
    for (const ignoreLight of [true, false]) {
      const key = cacheKey(source, algorithm, ignoreLight, true);
      const job = jobs.get(key);
      if (job) cancelJob(job);
      cache.delete(key);
    }
  }
}

/** Preserve the actual responsive URL: different JPEG sizes may have different
 * palettes. Only public TMDB artwork is eligible for the shared worker cache. */
export function getMediaImageSource(image: string | null | undefined): string | null {
  if (!image) return null;
  try {
    const url = new URL(image.startsWith('/') ? `https://image.tmdb.org/t/p/w92${image}` : image);
    if (url.origin !== 'https://image.tmdb.org' || url.username || url.password || url.search || url.hash
      || !/^\/t\/p\/(?:w\d+|h\d+|original)\/[\w.-]+$/.test(url.pathname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Small standalone sample for hero artwork and for browsers without a usable SW. */
export function getMediaColorSource(image: string | null | undefined): string | null {
  return getMediaImageSource(image)?.replace(/\/t\/p\/[^/]+\//, '/t/p/w92/') ?? null;
}

function trimCache() {
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
}

function hydrateCache() {
  if (hydrated) return;
  hydrated = true;
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(CACHE_KEY) || '[]');
    if (!Array.isArray(saved)) return;
    for (const entry of saved.slice(-CACHE_LIMIT)) {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string') continue;
      const parts = entry[0].split('|');
      if (parts.length < 3) continue;
      const [algorithm, mode, image] = parts;
      const source = getMediaImageSource(image);
      const color = normalizeMediaColor(entry[1]);
      const position: HeroGradientCardinal = HERO_GRADIENT_POSITIONS.includes(entry[2] as HeroGradientCardinal)
        ? (entry[2] as HeroGradientCardinal)
        : 'bottom-left';
      if (source && color && isMediaColorAlgorithm(algorithm)) {
        cache.set(cacheKey(source, algorithm, mode === 'vibrant'), { color, position, expires: Infinity, persist: true });
      }
    }
  } catch { /* Storage is optional; memory caching still works. */ }
}

export function readMediaColorEntry(
  source: string,
  algorithm: MediaColorAlgorithm,
  preview = false,
  ignoreLightBackgrounds = true,
): { color: string | null; position: HeroGradientCardinal } | undefined {
  hydrateCache();
  const key = cacheKey(source, algorithm, ignoreLightBackgrounds, preview);
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expires < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  cache.delete(key);
  cache.set(key, entry);
  return { color: entry.color, position: entry.position };
}

export function readMediaColor(
  source: string,
  algorithm: MediaColorAlgorithm,
  preview = false,
  ignoreLightBackgrounds = true,
): string | null | undefined {
  return readMediaColorEntry(source, algorithm, preview, ignoreLightBackgrounds)?.color;
}

function cacheColor(key: string, color: string | null, position: HeroGradientCardinal, persist: boolean) {
  cache.delete(key);
  cache.set(key, { color, position, expires: color ? Infinity : Date.now() + 60_000, persist });
  trimCache();
  if (!persist || !color || persistTimer !== undefined) return;
  persistTimer = setTimeout(() => {
    persistTimer = undefined;
    try {
      // Custom URLs may contain signed queries; keep them in memory only.
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(
        [...cache].filter(([, entry]) => entry.persist && entry.color).map(([key, entry]) => [key, entry.color, entry.position]),
      ));
    } catch { /* Full/private storage must not affect the catalogue. */ }
  }, 1000);
}

export type MediaColorResult = { color: string | null; position: HeroGradientCardinal };
export type MediaColorListener = (result: MediaColorResult) => void;
type Job = {
  key: string;
  source: string;
  algorithm: MediaColorAlgorithm;
  ignoreLightBackgrounds: boolean;
  preview: boolean;
  reuseImage: boolean;
  priority: boolean;
  listeners: Map<MediaColorListener, boolean>;
  cancel?: () => void;
  promote?: () => void;
};
const jobs = new Map<string, Job>();
const queue: Job[] = [];
let activeJobs = 0;
let pumpScheduled = false;

function cancelJob(job: Job) {
  if (job.cancel) job.cancel();
  else {
    jobs.delete(job.key);
    const index = queue.indexOf(job);
    if (index >= 0) queue.splice(index, 1);
  }
}

function scheduleQueue() {
  if (pumpScheduled) return;
  pumpScheduled = true;
  // Let all effect cleanups cancel their subscriptions first. Switching to
  // off/fixed must not start the next queued request during each cleanup.
  queueMicrotask(() => {
    pumpScheduled = false;
    pumpQueue();
  });
}

const unresponsiveWorkers = new WeakSet<ServiceWorker>();
const responsiveWorkers = new WeakSet<ServiceWorker>();

/** The worker only reads an already downloaded image. An old worker, private
 * browsing or a cache miss must still leave the standalone sample available. */
function readWorkerColor(job: Job, signal: AbortSignal): Promise<MediaColorResult | undefined> {
  const worker = job.reuseImage && !job.preview && 'serviceWorker' in navigator ? navigator.serviceWorker.controller : null;
  if (!worker || unresponsiveWorkers.has(worker) || signal.aborted) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    let settled = false;
    let acknowledged = responsiveWorkers.has(worker);
    const finish = (result?: MediaColorResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      channel.port1.close();
      channel.port2.close();
      resolve(result);
    };
    const onAbort = () => {
      channel.port1.postMessage({ type: 'cancel' });
      finish();
    };
    const onTimeout = () => {
      // Older deployed workers do not know this message. Retry after the
      // controller changes, not on every card during the same navigation.
      if (!acknowledged) unresponsiveWorkers.add(worker);
      onAbort();
    };
    let timeout = setTimeout(onTimeout, acknowledged ? 6000 : 1800);
    signal.addEventListener('abort', onAbort, { once: true });
    channel.port1.onmessage = ({ data }) => {
      responsiveWorkers.add(worker);
      if (data?.pending === true) {
        if (!acknowledged) {
          acknowledged = true;
          clearTimeout(timeout);
          timeout = setTimeout(onTimeout, 6000);
        }
        return;
      }
      const color = normalizeMediaColor(data?.color);
      const position = data?.position;
      finish(color && HERO_GRADIENT_POSITIONS.includes(position) ? { color, position } : undefined);
    };
    channel.port1.onmessageerror = () => finish();
    try {
      worker.postMessage({
        type: 'MOVIX_MEDIA_COLOR', source: job.source,
        algorithm: job.algorithm, ignoreLightBackgrounds: job.ignoreLightBackgrounds,
      }, [channel.port2]);
    } catch { finish(); }
  });
}

function startJob(job: Job) {
  activeJobs++;
  const image = new Image();
  const controller = new AbortController();
  let settled = false;
  let loaded = false;
  let sampling = false;
  let idle: number | undefined;
  let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const finish = (result: MediaColorResult, cancelled = false) => {
    if (settled) return;
    settled = true;
    controller.abort();
    clearTimeout(timeout);
    if (idle !== undefined) window.cancelIdleCallback?.(idle);
    if (fallbackTimer !== undefined) clearTimeout(fallbackTimer);
    image.onload = image.onerror = null;
    image.removeAttribute('src');
    jobs.delete(job.key);
    activeJobs--;
    if (!cancelled) {
      cacheColor(job.key, result.color, result.position, !job.preview);
      job.listeners.forEach((_priority, listener) => listener(result));
    }
    scheduleQueue();
  };
  job.cancel = () => finish({ color: null, position: 'bottom-left' }, true);
  image.crossOrigin = 'anonymous';
  if (job.preview) image.referrerPolicy = 'no-referrer';
  image.decoding = 'async';
  image.fetchPriority = job.priority ? 'high' : 'low';
  image.onerror = () => finish({ color: null, position: 'bottom-left' });
  const sample = async () => {
    if (settled || sampling) return;
    sampling = true;
    if (idle !== undefined) window.cancelIdleCallback?.(idle);
    if (fallbackTimer !== undefined) clearTimeout(fallbackTimer);
    try {
      const scale = Math.min(1, 64 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return finish({ color: null, position: 'bottom-left' });
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      finish(await extractMediaColor(pixels, job.algorithm, controller.signal, job.source, job.ignoreLightBackgrounds));
    } catch { finish({ color: null, position: 'bottom-left' }); }
  };
  job.promote = () => {
    image.fetchPriority = 'high';
    if (loaded) void sample();
  };
  image.onload = () => {
    loaded = true;
    if (job.priority) void sample();
    else if (typeof window.requestIdleCallback === 'function') idle = window.requestIdleCallback(sample, { timeout: 700 });
    else fallbackTimer = setTimeout(sample, 0);
  };
  const loadSample = () => {
    if (settled) return;
    timeout = setTimeout(() => finish({ color: null, position: 'bottom-left' }), 8000);
    // The UI never downloads Color Thief when the worker supplies the colour.
    void import('colorthief').catch(() => {});
    image.src = job.preview ? job.source : getMediaColorSource(job.source)!;
  };
  void readWorkerColor(job, controller.signal).then((result) => {
    if (settled) return;
    if (result) finish(result);
    else loadSample();
  });
}

function pumpQueue() {
  while (queue.length) {
    const priorityIndex = queue.findIndex((job) => job.priority);
    // Two background requests may stay in flight while visible cards use
    // the remaining slots. Never let a preload backlog block those cards.
    if (activeJobs >= (priorityIndex >= 0 ? 4 : 2)) break;
    const [job] = queue.splice(priorityIndex >= 0 ? priorityIndex : 0, 1);
    if (job.listeners.size) startJob(job);
  }
}

/** Deduplicate work and cancel queued/in-flight samples as soon as their last
 * consumer disappears (offscreen card, disabled setting, route/profile change). */
export function subscribeMediaColor(
  source: string,
  algorithm: MediaColorAlgorithm,
  listener: MediaColorListener,
  preview = false,
  ignoreLightBackgrounds = true,
  priority = false,
  reuseImage = false,
): () => void {
  const cached = readMediaColorEntry(source, algorithm, preview, ignoreLightBackgrounds);
  if (cached !== undefined) {
    listener(cached);
    return () => {};
  }
  const key = cacheKey(source, algorithm, ignoreLightBackgrounds, preview);
  let job = jobs.get(key);
  if (!job) {
    job = { key, source, algorithm, ignoreLightBackgrounds, preview, reuseImage, priority, listeners: new Map() };
    jobs.set(key, job);
    queue.push(job);
  }
  const currentJob = job;
  currentJob.listeners.set(listener, priority);
  const wasPriority = currentJob.priority;
  currentJob.priority = [...currentJob.listeners.values()].some(Boolean);
  if (currentJob.priority && !wasPriority) currentJob.promote?.();
  scheduleQueue();
  return () => {
    currentJob.listeners.delete(listener);
    // Entering the viewport changes subscription priority. Let the new
    // effect reuse and promote its request before considering cancellation.
    queueMicrotask(() => {
      if (jobs.get(key) !== currentJob) return;
      if (!currentJob.listeners.size) cancelJob(currentJob);
      else currentJob.priority = [...currentJob.listeners.values()].some(Boolean);
    });
  };
}
