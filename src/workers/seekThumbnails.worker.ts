/// <reference lib="webworker" />

/**
 * Worker des miniatures de la barre de progression.
 *
 * Pour chaque demande : lire le strict nécessaire de la vidéo (le début d'un
 * segment HLS, ou les octets d'une image clé d'un MP4), en sortir une image
 * clé, la décoder avec WebCodecs et la rendre réduite. Rien n'est joué, donc
 * aucun son, et la page ne fait aucun de ces calculs.
 */
import { createCbcDecryptor, type CbcDecryptor } from '../services/seekThumbnails/aesCbc.ts';
import type { EncodedKeyframe } from '../services/seekThumbnails/media.ts';
import {
  findFirstFragmentSample,
  findKeyframe,
  locateMoov,
  looksLikeMp4,
  parseInitSegment,
  parseMoov,
  type MoovInfo,
  type MoovLocation,
  type VideoTrack,
} from '../services/seekThumbnails/mp4Keyframe.ts';
import type {
  SegmentRef,
  ThumbnailFailure,
  ThumbnailJob,
  ThumbnailRequest,
  ThumbnailResponse,
  ThumbnailSpan,
} from '../services/seekThumbnails/protocol.ts';
import { scanTsKeyframe } from '../services/seekThumbnails/tsKeyframe.ts';

declare const self: DedicatedWorkerGlobalScope;

/** Une image clé dépasse rarement quelques centaines de Ko ; au-delà, on renonce. */
const MAX_SEGMENT_BYTES = 6 * 1024 * 1024;
const MAX_INIT_BYTES = 2 * 1024 * 1024;
/** La table d'un long film pèse quelques Mo. */
const MAX_MOOV_BYTES = 24 * 1024 * 1024;
const MAX_SAMPLE_BYTES = 8 * 1024 * 1024;
/** Quantité de données nouvelles avant de relancer l'analyse du segment. */
const PARSE_STEP = 32 * 1024;
const MAX_CACHED = 8;

const EMPTY = new Uint8Array(0);

class ThumbnailError extends Error {
  failure: ThumbnailFailure;
  status?: number;

  constructor(failure: ThumbnailFailure, reason: string, status?: number) {
    super(reason);
    this.failure = failure;
    this.status = status;
  }
}

const unsupported = (reason: string) => new ThumbnailError('unsupported', reason);

/** Les lecteurs de conteneurs lèvent de simples erreurs : format non géré. */
const parsing = <T>(read: () => T): T => {
  try {
    return read();
  } catch (error) {
    throw unsupported(error instanceof Error ? error.message : String(error));
  }
};

class ByteBuffer {
  private data = new Uint8Array(128 * 1024);
  length = 0;

  append(chunk: Uint8Array): void {
    const needed = this.length + chunk.length;
    if (needed > this.data.length) {
      const grown = new Uint8Array(Math.max(needed, this.data.length * 2));
      grown.set(this.data.subarray(0, this.length));
      this.data = grown;
    }
    this.data.set(chunk, this.length);
    this.length = needed;
  }

  view(): Uint8Array {
    return this.data.subarray(0, this.length);
  }
}

const remember = <T>(cache: Map<string, T>, key: string, value: T): void => {
  cache.set(key, value);
  if (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
};

// ---------------------------------------------------------------------------
// Réseau
// ---------------------------------------------------------------------------

/** Coupé à chaque changement de source : annule les chargements partagés. */
let session = new AbortController();

/** Délai accordé à ce qui sert à plusieurs miniatures : clé, init, table. */
const SHARED_TIMEOUT_MS = 20_000;

/**
 * Lance un chargement partagé entre plusieurs demandes. Il ne dépend d'aucune
 * d'elles : seuls le changement de source et le délai l'arrêtent.
 */
const shared = async <T>(load: (signal: AbortSignal) => Promise<T>): Promise<T> => {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const owner = session.signal;
  if (owner.aborted) controller.abort();
  owner.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, SHARED_TIMEOUT_MS);
  try {
    return await load(controller.signal);
  } finally {
    clearTimeout(timer);
    owner.removeEventListener('abort', abort);
  }
};

/**
 * Attend un chargement partagé sans y rester suspendu : une demande annulée
 * rend la main tout de suite, le chargement continue pour les suivantes.
 */
const unlessAborted = <T>(pending: Promise<T>, signal: AbortSignal): Promise<T> => (
  new Promise<T>((resolve, reject) => {
    const abort = () => reject(new ThumbnailError('aborted', 'annulé'));
    if (signal.aborted) abort();
    signal.addEventListener('abort', abort, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  })
);

type StreamOptions = {
  /** Plage [start, end) ; sans `end`, jusqu'à la fin du fichier. */
  start?: number;
  end?: number;
  maxBytes: number;
  signal: AbortSignal;
};

/**
 * Lit `url` morceau par morceau. `onChunk` rend `true` dès qu'il a ce qu'il
 * lui faut : le téléchargement est alors coupé net. Sans plage demandée,
 * aucun en-tête `Range` n'est envoyé, ce qui évite une pré-requête CORS.
 */
const streamBytes = async (
  url: string,
  options: StreamOptions,
  onChunk: (chunk: Uint8Array, final: boolean) => boolean | Promise<boolean>,
): Promise<void> => {
  const { start = 0, end, signal } = options;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal.aborted) controller.abort();
  signal.addEventListener('abort', abort, { once: true });

  const failure = (error: unknown) => (
    signal.aborted
      ? new ThumbnailError('aborted', 'annulé')
      : new ThumbnailError('network', error instanceof Error ? error.message : String(error))
  );

  try {
    const ranged = start > 0 || end !== undefined;
    let response: Response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: ranged ? { Range: `bytes=${start}-${end !== undefined ? end - 1 : ''}` } : undefined,
      });
    } catch (error) {
      throw failure(error);
    }
    if (!response.ok) throw new ThumbnailError('http', `HTTP ${response.status}`, response.status);
    // Un serveur sourd à Range renverrait le fichier depuis son premier octet.
    if (start > 0 && response.status !== 206) throw unsupported('en-tête Range ignoré par le serveur');

    const reader = response.body?.getReader();
    if (!reader) throw unsupported('réponse sans flux lisible');

    let total = 0;
    for (;;) {
      let step: ReadableStreamReadResult<Uint8Array>;
      try {
        step = await reader.read();
      } catch (error) {
        throw failure(error);
      }
      if (step.done) {
        await onChunk(EMPTY, true);
        return;
      }
      total += step.value.length;
      if (await onChunk(step.value, false)) return;
      if (total >= options.maxBytes) throw unsupported('rien de décodable dans la limite de lecture');
    }
  } finally {
    signal.removeEventListener('abort', abort);
    // Coupe le téléchargement s'il court encore ; sans effet s'il est fini.
    controller.abort();
  }
};

const keys = new Map<string, Promise<Uint8Array>>();

const loadKey = (url: string): Promise<Uint8Array> => {
  let pending = keys.get(url);
  if (!pending) {
    pending = shared(async (signal) => {
      const response = await fetch(url, { signal });
      if (!response.ok) throw new ThumbnailError('http', `clé : HTTP ${response.status}`, response.status);
      return new Uint8Array(await response.arrayBuffer());
    });
    pending.catch(() => keys.delete(url));
    remember(keys, url, pending);
  }
  return pending;
};

const decryptorFor = async (
  segment: SegmentRef,
  signal: AbortSignal,
): Promise<CbcDecryptor | null> => {
  const { aes } = segment;
  if (!aes) return null;
  let key: Uint8Array;
  try {
    key = aes.key ?? await unlessAborted(loadKey(aes.keyUrl), signal);
  } catch (error) {
    throw error instanceof ThumbnailError ? error : new ThumbnailError('network', String(error));
  }
  try {
    return await createCbcDecryptor(key, aes.iv);
  } catch (error) {
    throw unsupported(error instanceof Error ? error.message : String(error));
  }
};

// ---------------------------------------------------------------------------
// HLS
// ---------------------------------------------------------------------------

const inits = new Map<string, Promise<VideoTrack>>();

const loadInit = (init: SegmentRef): Promise<VideoTrack> => {
  const cacheKey = `${init.url}|${init.range?.join('-') ?? ''}`;
  let pending = inits.get(cacheKey);
  if (!pending) {
    pending = shared(async (signal) => {
      const decrypt = await decryptorFor(init, signal);
      const buffer = new ByteBuffer();
      await streamBytes(
        init.url,
        { start: init.range?.[0], end: init.range?.[1], maxBytes: MAX_INIT_BYTES, signal },
        async (chunk, final) => {
          buffer.append(decrypt ? await decrypt(chunk, final) : chunk);
          return false;
        },
      );
      return parsing(() => parseInitSegment(buffer.view()));
    });
    pending.catch(() => inits.delete(cacheKey));
    remember(inits, cacheKey, pending);
  }
  return pending;
};

/** Segment fMP4 sans EXT-X-MAP : il porte lui-même son `moov`. */
const selfInit = (bytes: Uint8Array, final: boolean): VideoTrack | null => {
  const location = locateMoov(bytes);
  if (location.status === 'found') return parsing(() => parseMoov(bytes, location.start, location.end).track);
  if (!final && (location.status === 'need-more' || location.status === 'partial')) return null;
  throw unsupported('segment fMP4 sans initialisation');
};

const hlsKeyframe = async (
  job: Extract<ThumbnailJob, { kind: 'hls' }>,
  signal: AbortSignal,
): Promise<EncodedKeyframe> => {
  const { segment } = job;
  const decrypt = await decryptorFor(segment, signal);
  const buffer = new ByteBuffer();
  const result: { keyframe: EncodedKeyframe | null; track: VideoTrack | null } = {
    keyframe: null,
    track: null,
  };
  let parsedAt = 0;

  await streamBytes(
    segment.url,
    { start: segment.range?.[0], end: segment.range?.[1], maxBytes: MAX_SEGMENT_BYTES, signal },
    async (chunk, final) => {
      buffer.append(decrypt ? await decrypt(chunk, final) : chunk);
      // Reprendre l'analyse à chaque paquet réseau coûterait cher pour rien.
      if (!final && buffer.length - parsedAt < PARSE_STEP) return false;
      parsedAt = buffer.length;
      const bytes = buffer.view();

      if (!looksLikeMp4(bytes)) {
        const scan = scanTsKeyframe(bytes, final);
        if (scan.status === 'unsupported') throw unsupported(scan.reason);
        if (scan.status === 'need-more') return false;
        result.keyframe = scan.keyframe;
        return true;
      }

      result.track ??= job.init
        ? await unlessAborted(loadInit(job.init), signal)
        : selfInit(bytes, final);
      const track = result.track;
      if (!track) return false;

      const sample = findFirstFragmentSample(bytes, track, final, segment.range?.[0] ?? 0);
      if (sample.status === 'unsupported') throw unsupported(sample.reason);
      if (sample.status === 'need-more') return false;
      if (sample.offset < 0 || sample.size > MAX_SAMPLE_BYTES) throw unsupported('fragment incohérent');
      if (sample.offset + sample.size > bytes.length) {
        if (final) throw unsupported('segment plus court que sa première image');
        return false;
      }
      result.keyframe = {
        codec: track.codec,
        description: track.description,
        data: bytes.slice(sample.offset, sample.offset + sample.size),
      };
      return true;
    },
  );

  if (!result.keyframe) throw unsupported('aucune image clé');
  return result.keyframe;
};

// ---------------------------------------------------------------------------
// MP4 direct
// ---------------------------------------------------------------------------

const indexes = new Map<string, Promise<MoovInfo>>();

/**
 * Charge la table des images clés. `moov` est d'ordinaire au début du
 * fichier ; quand il est à la fin, la taille de `mdat` dit où reprendre.
 */
const fetchMoov = async (url: string, signal: AbortSignal): Promise<MoovInfo> => {
  let offset = 0;
  for (let hop = 0; hop < 4; hop++) {
    const buffer = new ByteBuffer();
    const state: { location: MoovLocation | null } = { location: null };
    const base = offset;
    await streamBytes(url, { start: base, maxBytes: MAX_MOOV_BYTES, signal }, (chunk, final) => {
      buffer.append(chunk);
      const location = locateMoov(buffer.view(), base);
      if (location.status === 'unsupported') throw unsupported(location.reason);
      if (location.status === 'found' || location.status === 'elsewhere') {
        state.location = location;
        return true;
      }
      if (final) throw unsupported('boîte moov introuvable');
      return false;
    });

    const { location } = state;
    if (location?.status === 'found') {
      return parsing(() => parseMoov(buffer.view(), location.start, location.end));
    }
    if (location?.status !== 'elsewhere') break;
    offset = location.offset;
  }
  throw unsupported('boîte moov introuvable');
};

const loadIndex = (url: string): Promise<MoovInfo> => {
  let pending = indexes.get(url);
  if (!pending) {
    pending = shared(signal => fetchMoov(url, signal));
    pending.catch(() => indexes.delete(url));
    remember(indexes, url, pending);
  }
  return pending;
};

const mp4Keyframe = async (
  job: Extract<ThumbnailJob, { kind: 'mp4' }>,
  signal: AbortSignal,
): Promise<{ keyframe: EncodedKeyframe; span: ThumbnailSpan }> => {
  const { track, keyframes } = await unlessAborted(loadIndex(job.url), signal);
  const ref = findKeyframe(keyframes, job.time);
  // Un MP4 fragmenté servi d'un bloc a un `moov` sans table d'échantillons.
  if (!ref) throw unsupported('MP4 sans table d\'images clés');
  if (!ref.size || ref.size > MAX_SAMPLE_BYTES) throw unsupported('image clé de taille incohérente');

  const buffer = new ByteBuffer();
  await streamBytes(
    job.url,
    { start: ref.offset, end: ref.offset + ref.size, maxBytes: ref.size + 1, signal },
    (chunk) => {
      buffer.append(chunk);
      return buffer.length >= ref.size;
    },
  );
  if (buffer.length < ref.size) throw new ThumbnailError('network', 'image clé tronquée');

  return {
    keyframe: {
      codec: track.codec,
      description: track.description,
      data: buffer.view().slice(0, ref.size),
    },
    span: { from: ref.from, to: ref.to },
  };
};

// ---------------------------------------------------------------------------
// Décodage
// ---------------------------------------------------------------------------

type Settle = { resolve: (frame: VideoFrame) => void; reject: (error: unknown) => void };

let decoder: VideoDecoder | null = null;
let decoderKey = '';
let settle: Settle | null = null;

const closeDecoder = (): void => {
  try {
    if (decoder && decoder.state !== 'closed') decoder.close();
  } catch {
    /* déjà fermé */
  }
  decoder = null;
  decoderKey = '';
};

/** Le décodeur est gardé d'une miniature à l'autre tant que le flux ne change pas. */
const decoderFor = async (keyframe: EncodedKeyframe): Promise<VideoDecoder> => {
  const signature = keyframe.description
    ? Array.from(keyframe.description.subarray(0, 64)).join('.')
    : '';
  const key = `${keyframe.codec}|${signature}`;
  if (decoder && decoder.state === 'configured' && decoderKey === key) return decoder;

  closeDecoder();
  const config: VideoDecoderConfig = { codec: keyframe.codec, optimizeForLatency: true };
  if (keyframe.description) config.description = keyframe.description as BufferSource;

  let supported = false;
  try {
    supported = (await VideoDecoder.isConfigSupported(config)).supported === true;
  } catch {
    supported = false;
  }
  if (!supported) throw unsupported(`codec non décodable ici : ${keyframe.codec}`);

  const created: VideoDecoder = new VideoDecoder({
    output: (frame) => {
      const waiting = settle;
      settle = null;
      if (waiting) waiting.resolve(frame);
      else frame.close();
    },
    error: (error) => {
      const waiting = settle;
      settle = null;
      if (decoder === created) closeDecoder();
      waiting?.reject(error);
    },
  });
  created.configure(config);
  decoder = created;
  decoderKey = key;
  return created;
};

const decodeKeyframe = async (keyframe: EncodedKeyframe): Promise<VideoFrame> => {
  const active = await decoderFor(keyframe);
  try {
    return await new Promise<VideoFrame>((resolve, reject) => {
      const mine: Settle = { resolve, reject };
      settle = mine;
      active.decode(new EncodedVideoChunk({
        type: 'key',
        timestamp: 0,
        data: keyframe.data as BufferSource,
      }));
      // `flush` force la sortie de l'image, que le décodeur garderait sinon
      // en attendant la suite du flux.
      active.flush().then(
        () => {
          if (settle !== mine) return;
          settle = null;
          reject(new Error('aucune image décodée'));
        },
        (error) => {
          if (settle !== mine) return;
          settle = null;
          reject(error);
        },
      );
    });
  } catch (error) {
    closeDecoder();
    throw error instanceof ThumbnailError
      ? error
      : new ThumbnailError('decode', error instanceof Error ? error.message : String(error));
  }
};

let canvas: OffscreenCanvas | null = null;

const toBitmap = (frame: VideoFrame, maxWidth: number): ImageBitmap => {
  try {
    const scale = Math.min(1, maxWidth / frame.displayWidth);
    const width = Math.max(2, Math.round(frame.displayWidth * scale));
    const height = Math.max(2, Math.round(frame.displayHeight * scale));
    if (!canvas || canvas.width !== width || canvas.height !== height) {
      canvas = new OffscreenCanvas(width, height);
    }
    const context = canvas.getContext('2d');
    if (!context) throw new ThumbnailError('decode', 'canvas 2D indisponible');
    context.imageSmoothingQuality = 'high';
    context.drawImage(frame, 0, 0, width, height);
    return canvas.transferToImageBitmap();
  } finally {
    frame.close();
  }
};

// ---------------------------------------------------------------------------
// File des demandes
// ---------------------------------------------------------------------------

const controllers = new Map<number, AbortController>();
let chain: Promise<void> = Promise.resolve();

const run = async (
  request: Extract<ThumbnailRequest, { type: 'thumbnail' }>,
  signal: AbortSignal,
): Promise<void> => {
  const { id, job } = request;
  try {
    if (signal.aborted) throw new ThumbnailError('aborted', 'annulé');
    let keyframe: EncodedKeyframe;
    let span: ThumbnailSpan | undefined;
    if (job.kind === 'hls') {
      keyframe = await hlsKeyframe(job, signal);
    } else {
      ({ keyframe, span } = await mp4Keyframe(job, signal));
    }
    if (signal.aborted) throw new ThumbnailError('aborted', 'annulé');

    const bitmap = toBitmap(await decodeKeyframe(keyframe), request.maxWidth);
    const response: ThumbnailResponse = { type: 'thumbnail', id, bitmap, span };
    self.postMessage(response, [bitmap]);
  } catch (error) {
    const known = error instanceof ThumbnailError
      ? error
      : new ThumbnailError(
        signal.aborted || session.signal.aborted ? 'aborted' : 'decode',
        error instanceof Error ? error.message : String(error),
      );
    const response: ThumbnailResponse = {
      type: 'failed',
      id,
      failure: known.failure,
      status: known.status,
      reason: known.message,
    };
    self.postMessage(response);
  }
};

self.onmessage = (event: MessageEvent<ThumbnailRequest>) => {
  const message = event.data;
  if (message.type === 'cancel') {
    controllers.get(message.id)?.abort();
    return;
  }
  if (message.type === 'reset') {
    session.abort();
    session = new AbortController();
    controllers.forEach(controller => controller.abort());
    keys.clear();
    inits.clear();
    indexes.clear();
    closeDecoder();
    return;
  }

  const controller = new AbortController();
  controllers.set(message.id, controller);
  chain = chain
    .then(() => run(message, controller.signal))
    .finally(() => controllers.delete(message.id));
};
