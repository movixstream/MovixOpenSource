import {
  extractMediaColor,
  HERO_GRADIENT_POSITIONS,
  isMediaColorAlgorithm,
  normalizeMediaColor,
  type ExtractedMediaColorResult,
  type MediaColorAlgorithm,
} from '@/utils/mediaColors'

export const TMDB_IMAGE_CACHE_NAME = 'movix-tmdb-images-v3'
export const MEDIA_COLOR_CACHE_NAME = 'movix-media-colors-v1'

const TMDB_IMAGE_HOST = 'image.tmdb.org'
const TMDB_IMAGE_PATH_RE = /^\/t\/p\/[^/]+\/[^/]+$/
const MAX_CONCURRENT_IMAGE_FETCHES = 6
const IMAGE_CACHE_MAX_ENTRIES = 600
const IMAGE_CACHE_TRIM_SAMPLE_RATE = 1 / 20
const MEDIA_COLOR_CACHE_MAX_ENTRIES = 256
const MEDIA_COLOR_CACHE_VERSION = 'v1'
const MAX_COLOR_SOURCE_SIZE = 64
const MAX_PENDING_COLOR_EXTRACTIONS = 32
const CORS_FAILURE_RETRY_MS = 5 * 60 * 1000

interface MediaColorRequest {
  type: 'MOVIX_MEDIA_COLOR'
  source: string
  algorithm: MediaColorAlgorithm
  ignoreLightBackgrounds: boolean
}

interface ExtendableMessageEventLike extends MessageEvent<unknown> {
  waitUntil?: (promise: Promise<unknown>) => void
}

interface ReadableImageWork {
  response: Promise<Response>
  cacheWritten: Promise<void>
}

const imageFetchQueue: Array<() => void> = []
const readableImageWork = new Map<string, ReadableImageWork>()
const opaqueImageFetches = new Map<string, Promise<Response>>()
const imageCacheWrites = new Map<string, Promise<void>>()
const corsFailures = new Map<string, number>()
const colorExtractions = new Map<string, Promise<ExtractedMediaColorResult>>()
const colorConsumers = new Map<string, number>()
let activeImageFetches = 0
let pendingColorExtractions = 0
let colorExtractionTail = Promise.resolve()

function parseTmdbImageSource(value: unknown): URL | null {
  if (typeof value !== 'string') return null

  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:'
      || url.hostname !== TMDB_IMAGE_HOST
      || url.port
      || url.username
      || url.password
      || url.search
      || url.hash
      || !TMDB_IMAGE_PATH_RE.test(url.pathname)
    ) {
      return null
    }
    return url
  } catch {
    return null
  }
}

function parseMediaColorRequest(value: unknown): MediaColorRequest | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<MediaColorRequest>
  const source = parseTmdbImageSource(candidate.source)
  if (
    candidate.type !== 'MOVIX_MEDIA_COLOR'
    || !source
    || !isMediaColorAlgorithm(candidate.algorithm)
    || typeof candidate.ignoreLightBackgrounds !== 'boolean'
  ) {
    return null
  }

  return {
    type: candidate.type,
    source: source.href,
    algorithm: candidate.algorithm,
    ignoreLightBackgrounds: candidate.ignoreLightBackgrounds,
  }
}

async function trimCache(cache: Cache, maxEntries: number): Promise<void> {
  const keys = await cache.keys()
  if (keys.length <= maxEntries) return
  await Promise.all(keys.slice(0, keys.length - maxEntries).map((key) => cache.delete(key)))
}

function acquireImageFetchSlot(): Promise<void> {
  return new Promise((resolve) => {
    if (activeImageFetches < MAX_CONCURRENT_IMAGE_FETCHES) {
      activeImageFetches++
      resolve()
      return
    }
    imageFetchQueue.push(resolve)
  })
}

function releaseImageFetchSlot(): void {
  const next = imageFetchQueue.shift()
  if (next) {
    next()
    return
  }
  activeImageFetches = Math.max(0, activeImageFetches - 1)
}

function writeImageResponse(source: string, response: Response): Promise<void> {
  // La réponse remise à respondWith peut être verrouillée dès le prochain tour
  // de microtask : la copie destinée au cache doit être créée immédiatement.
  const responseForCache = response.clone()
  const previous = imageCacheWrites.get(source) ?? Promise.resolve()
  const write = previous
    .then(async () => {
      const cache = await caches.open(TMDB_IMAGE_CACHE_NAME)
      const cached = await cache.match(source)
      // Une réponse opaque de repli ne doit jamais remplacer une réponse CORS
      // lisible obtenue en parallèle pour la même image.
      if (response.type === 'opaque' && cached && cached.type !== 'opaque') return
      await cache.put(source, responseForCache)
      if (Math.random() < IMAGE_CACHE_TRIM_SAMPLE_RATE) {
        await trimCache(cache, IMAGE_CACHE_MAX_ENTRIES)
      }
    })
    .catch(() => {
      // Le quota CacheStorage ne doit pas casser l'affichage de l'image.
    })

  imageCacheWrites.set(source, write)
  void write.finally(() => {
    if (imageCacheWrites.get(source) === write) imageCacheWrites.delete(source)
  })
  return write
}

function startReadableImageFetch(request: Request): ReadableImageWork {
  const source = request.url
  const existing = readableImageWork.get(source)
  if (existing) return existing

  let resolveCacheWritten: () => void = () => {}
  const cacheWritten = new Promise<void>((resolve) => {
    resolveCacheWritten = resolve
  })
  const response = (async () => {
    await acquireImageFetchSlot()
    let releaseAfterCacheWrite = false
    try {
      const fetched = await fetch(request, { mode: 'cors', credentials: 'omit' })
      corsFailures.delete(source)
      if (fetched.ok) {
        const write = writeImageResponse(source, fetched)
        releaseAfterCacheWrite = true
        void write.finally(() => {
          resolveCacheWritten()
          releaseImageFetchSlot()
        })
      } else {
        resolveCacheWritten()
      }
      return fetched
    } catch (error) {
      corsFailures.set(source, Date.now())
      if (corsFailures.size > IMAGE_CACHE_MAX_ENTRIES) {
        corsFailures.delete(corsFailures.keys().next().value as string)
      }
      resolveCacheWritten()
      throw error
    } finally {
      if (!releaseAfterCacheWrite) releaseImageFetchSlot()
    }
  })()

  const work = { response, cacheWritten }
  readableImageWork.set(source, work)
  void cacheWritten.finally(() => {
    if (readableImageWork.get(source) === work) readableImageWork.delete(source)
  })
  return work
}

function recentlyFailedCors(source: string): boolean {
  const failedAt = corsFailures.get(source)
  if (failedAt === undefined) return false
  if (Date.now() - failedAt < CORS_FAILURE_RETRY_MS) return true
  corsFailures.delete(source)
  return false
}

function fetchOpaqueFallback(request: Request): Promise<Response> {
  const source = request.url
  const existing = opaqueImageFetches.get(source)
  if (existing) return existing

  const fetchPromise = (async () => {
    await acquireImageFetchSlot()
    let releaseAfterCacheWrite = false
    try {
      const response = await fetch(request)
      if (response.ok || response.type === 'opaque') {
        releaseAfterCacheWrite = true
        void writeImageResponse(source, response).finally(releaseImageFetchSlot)
      }
      return response
    } finally {
      if (!releaseAfterCacheWrite) releaseImageFetchSlot()
    }
  })()
  opaqueImageFetches.set(source, fetchPromise)
  const cacheComplete = fetchPromise
    .then(() => imageCacheWrites.get(source))
    .then(() => undefined)
    .catch(() => {})
  void cacheComplete.finally(() => {
    if (opaqueImageFetches.get(source) === fetchPromise) opaqueImageFetches.delete(source)
  })
  return fetchPromise
}

export async function handleTmdbImage(
  request: Request,
  waitUntil?: (promise: Promise<unknown>) => void,
): Promise<Response> {
  const source = parseTmdbImageSource(request.url)
  if (!source) return fetch(request)

  const cache = await caches.open(TMDB_IMAGE_CACHE_NAME)
  const cached = await cache.match(source.href)
  const opaqueForCors = cached?.type === 'opaque' && request.mode !== 'no-cors'
  if (cached && cached.type !== 'opaque') return cached
  if (cached && !opaqueForCors && recentlyFailedCors(source.href)) return cached
  if (!cached && request.mode === 'no-cors' && recentlyFailedCors(source.href)) {
    const fallback = fetchOpaqueFallback(request)
    const pendingWrite = fallback
      .then(() => imageCacheWrites.get(source.href))
      .then(() => undefined)
      .catch(() => {})
    waitUntil?.(pendingWrite)
    return (await fallback).clone()
  }

  const readableWork = startReadableImageFetch(request)
  waitUntil?.(readableWork.cacheWritten)
  try {
    return (await readableWork.response).clone()
  } catch (error) {
    if (request.mode !== 'no-cors') throw error
    // Si l'image opaque existe déjà, elle reste un repli d'affichage immédiat
    // après l'unique tentative de mise à niveau CORS.
    if (cached) return cached
    const fallback = fetchOpaqueFallback(request)
    const pendingWrite = fallback
      .then(() => imageCacheWrites.get(source.href))
      .then(() => undefined)
      .catch(() => {})
    waitUntil?.(pendingWrite)
    return (await fallback).clone()
  }
}

function mediaColorCacheKey(request: MediaColorRequest): string {
  const cacheUrl = new URL('/__movix-media-color__', self.location.origin)
  cacheUrl.searchParams.set('v', MEDIA_COLOR_CACHE_VERSION)
  cacheUrl.searchParams.set('source', request.source)
  cacheUrl.searchParams.set('algorithm', request.algorithm)
  cacheUrl.searchParams.set('ignoreLightBackgrounds', request.ignoreLightBackgrounds ? '1' : '0')
  return cacheUrl.href
}

function retainColorConsumer(cacheKey: string): () => void {
  colorConsumers.set(cacheKey, (colorConsumers.get(cacheKey) ?? 0) + 1)
  let retained = true
  return () => {
    if (!retained) return
    retained = false
    const remaining = (colorConsumers.get(cacheKey) ?? 1) - 1
    if (remaining > 0) colorConsumers.set(cacheKey, remaining)
    else colorConsumers.delete(cacheKey)
  }
}

async function readCachedColor(cacheKey: string): Promise<ExtractedMediaColorResult | null> {
  const response = await (await caches.open(MEDIA_COLOR_CACHE_NAME)).match(cacheKey)
  if (!response?.ok) return null
  try {
    const value = await response.json() as Partial<ExtractedMediaColorResult>
    const color = normalizeMediaColor(value.color)
    if (color && HERO_GRADIENT_POSITIONS.includes(value.position as ExtractedMediaColorResult['position'])) {
      return { color, position: value.position as ExtractedMediaColorResult['position'] }
    }
  } catch {
    // Une entrée illisible est simplement recalculée.
  }
  return null
}

async function persistColor(cacheKey: string, result: ExtractedMediaColorResult): Promise<void> {
  const color = normalizeMediaColor(result.color)
  if (!color || !HERO_GRADIENT_POSITIONS.includes(result.position)) return
  try {
    const cache = await caches.open(MEDIA_COLOR_CACHE_NAME)
    await cache.put(cacheKey, new Response(JSON.stringify({ color, position: result.position }), {
      headers: { 'Content-Type': 'application/json' },
    }))
    await trimCache(cache, MEDIA_COLOR_CACHE_MAX_ENTRIES)
  } catch {
    // Une couleur calculée reste utilisable même si le quota est plein.
  }
}

async function waitForReadableImage(source: string): Promise<Response | null> {
  const work = readableImageWork.get(source)
  if (work) await work.cacheWritten
  const pendingWrite = imageCacheWrites.get(source)
  if (pendingWrite) await pendingWrite

  const response = await (await caches.open(TMDB_IMAGE_CACHE_NAME)).match(source)
  if (!response || !response.ok || response.type === 'opaque') return null
  return response
}

async function imageDataFromResponse(response: Response): Promise<ImageData> {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
    throw new Error('Image decoding is unavailable in this service worker')
  }

  const bitmap = await createImageBitmap(await response.blob())
  try {
    if (!bitmap.width || !bitmap.height) throw new Error('Empty image')
    const scale = Math.min(1, MAX_COLOR_SOURCE_SIZE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('2D canvas is unavailable')
    context.drawImage(bitmap, 0, 0, width, height)
    return context.getImageData(0, 0, width, height)
  } finally {
    bitmap.close()
  }
}

function scheduleColorExtraction<T>(task: () => Promise<T>): Promise<T> {
  const scheduled = colorExtractionTail.then(task, task)
  colorExtractionTail = scheduled.then(() => undefined, () => undefined)
  return scheduled
}

async function getMediaColor(request: MediaColorRequest): Promise<ExtractedMediaColorResult | null> {
  const cacheKey = mediaColorCacheKey(request)
  const cached = await readCachedColor(cacheKey)
  if (cached) return cached

  const existing = colorExtractions.get(cacheKey)
  if (existing) return existing
  if (pendingColorExtractions >= MAX_PENDING_COLOR_EXTRACTIONS) {
    throw new Error('Media color extraction queue is full')
  }

  pendingColorExtractions++
  const extraction = scheduleColorExtraction(async () => {
    // Un composant disparu pendant l'attente ne doit pas déclencher un nouveau
    // décodage. Un calcul déjà commencé se termine et alimente le cache.
    if (!colorConsumers.has(cacheKey)) throw new Error('Media color request was cancelled')
    const response = await waitForReadableImage(request.source)
    if (!response) throw new Error('Readable image response is unavailable')
    const pixels = await imageDataFromResponse(response)
    const result = await extractMediaColor(
      pixels,
      request.algorithm,
      new AbortController().signal,
      request.source,
      request.ignoreLightBackgrounds,
    )
    await persistColor(cacheKey, result)
    return result
  })
  colorExtractions.set(cacheKey, extraction)
  void extraction.finally(() => {
    pendingColorExtractions = Math.max(0, pendingColorExtractions - 1)
    if (colorExtractions.get(cacheKey) === extraction) colorExtractions.delete(cacheKey)
  }).catch(() => {})
  return extraction
}

async function answerMediaColorMessage(event: ExtendableMessageEventLike): Promise<void> {
  const port = event.ports[0]
  if (!port) return
  const request = parseMediaColorRequest(event.data)
  if (!request) {
    port.postMessage({ unavailable: true })
    port.close()
    return
  }
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
    port.postMessage({ unavailable: true })
    port.close()
    return
  }

  port.postMessage({ pending: true })

  const cacheKey = mediaColorCacheKey(request)
  const releaseConsumer = retainColorConsumer(cacheKey)
  let active = true
  port.onmessage = (message) => {
    if (!message.data || message.data.type !== 'cancel') return
    active = false
    releaseConsumer()
  }
  port.start()

  try {
    const result = await getMediaColor(request)
    if (!active) return
    if (!result) {
      port.postMessage({ unavailable: true })
      return
    }
    port.postMessage(result)
  } catch {
    if (active) port.postMessage({ unavailable: true })
  } finally {
    active = false
    releaseConsumer()
    port.close()
  }
}

export function installMediaColorServiceWorker(): void {
  self.addEventListener('message', ((event: ExtendableMessageEventLike) => {
    if (!event.data || (event.data as { type?: unknown }).type !== 'MOVIX_MEDIA_COLOR') return
    if (event.origin !== self.location.origin) return
    const source = event.source as { url?: unknown } | null
    if (!source || typeof source.url !== 'string') return
    try {
      if (new URL(source.url).origin !== self.location.origin) return
    } catch {
      return
    }
    const answer = answerMediaColorMessage(event)
    event.waitUntil?.(answer)
  }) as EventListener)
}
