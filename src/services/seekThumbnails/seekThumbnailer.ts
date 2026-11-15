/**
 * Miniatures de la barre de progression, côté page.
 *
 * Garde les images déjà calculées, n'envoie qu'une demande à la fois au
 * worker (la plus récente remplace celle qui attendait) et se met en retrait
 * quand une source ne s'y prête pas : le lecteur reprend alors son ancien
 * aperçu.
 */
import type { ThumbnailTarget } from './hlsTarget.ts';
import type { ThumbnailRequest, ThumbnailResponse, ThumbnailSpan } from './protocol.ts';

/** Environ 20 Mo d'images en 384 px de large. */
const MAX_CACHED = 96;
const JOB_TIMEOUT_MS = 8000;
/** Une demande en cours depuis plus longtemps est abandonnée au profit de la suivante. */
const STALE_AFTER_MS = 1200;
/** Pause après un « trop de requêtes » de l'hébergeur. */
const RATE_LIMIT_PAUSE_MS = 60_000;
const MAX_STRIKES = 3;

type Entry = ThumbnailSpan & { bitmap: ImageBitmap; used: number };

type Waiting = {
  target: ThumbnailTarget;
  time: number;
  promise: Promise<ImageBitmap | null>;
  resolve: (bitmap: ImageBitmap | null) => void;
};

type Active = Waiting & { id: number; startedAt: number; timer: ReturnType<typeof setTimeout> };

const sameTarget = (a: Waiting, target: ThumbnailTarget, time: number): boolean => {
  const first = a.target.job;
  const second = target.job;
  if (first.kind === 'hls' && second.kind === 'hls') {
    return first.segment.url === second.segment.url
      && first.segment.range?.[0] === second.segment.range?.[0];
  }
  return first.kind === second.kind && Math.abs(a.time - time) < 0.01;
};

export class SeekThumbnailer {
  /** WebCodecs dans un worker : Chrome, Edge, Firefox et Safari récents. */
  static isSupported(): boolean {
    return typeof Worker !== 'undefined'
      && typeof VideoDecoder !== 'undefined'
      && typeof EncodedVideoChunk !== 'undefined'
      && typeof OffscreenCanvas !== 'undefined';
  }

  private worker: Worker | null = null;
  private entries: Entry[] = [];
  private clock = 0;
  private nextId = 0;
  private active: Active | null = null;
  private queued: Waiting | null = null;
  private strikes = 0;
  private successes = 0;
  private gaveUp = false;
  private pausedUntil = 0;
  private maxWidth: number;

  constructor(maxWidth: number) {
    this.maxWidth = maxWidth;
  }

  /** La source ne s'y prête pas : à l'appelant de se rabattre sur autre chose. */
  get disabled(): boolean {
    return this.gaveUp;
  }

  /** L'hébergeur a demandé de ralentir : ne rien charger pour l'instant. */
  get paused(): boolean {
    return Date.now() < this.pausedUntil;
  }

  /** Miniature déjà en mémoire pour cet instant. */
  peek(time: number): ImageBitmap | null {
    for (const entry of this.entries) {
      if (time >= entry.from && time < entry.to) {
        entry.used = ++this.clock;
        return entry.bitmap;
      }
    }
    return null;
  }

  /** Rend la miniature de `time`, ou `null` si elle n'a pas pu être faite. */
  load(target: ThumbnailTarget, time: number): Promise<ImageBitmap | null> {
    if (this.gaveUp || this.paused) return Promise.resolve(null);
    const cached = this.peek(time);
    if (cached) return Promise.resolve(cached);
    if (this.active && sameTarget(this.active, target, time)) return this.active.promise;
    if (this.queued && sameTarget(this.queued, target, time)) return this.queued.promise;

    // Seule la dernière position survolée compte.
    this.queued?.resolve(null);
    let resolve!: (bitmap: ImageBitmap | null) => void;
    const promise = new Promise<ImageBitmap | null>((done) => { resolve = done; });
    this.queued = { target, time, promise, resolve };

    if (!this.active) {
      this.startNext();
    } else if (performance.now() - this.active.startedAt > STALE_AFTER_MS) {
      this.worker?.postMessage({ type: 'cancel', id: this.active.id } satisfies ThumbnailRequest);
    }
    return promise;
  }

  /** Changement de source : tout oublier. */
  reset(): void {
    this.finishActive(null);
    this.queued?.resolve(null);
    this.queued = null;
    this.worker?.postMessage({ type: 'reset' } satisfies ThumbnailRequest);
    for (const entry of this.entries) entry.bitmap.close();
    this.entries = [];
    this.strikes = 0;
    this.successes = 0;
    this.gaveUp = false;
    this.pausedUntil = 0;
  }

  dispose(): void {
    this.reset();
    this.worker?.terminate();
    this.worker = null;
  }

  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker;
    try {
      const worker = new Worker(
        new URL('../../workers/seekThumbnails.worker.ts', import.meta.url),
        { type: 'module' },
      );
      worker.onmessage = (event: MessageEvent<ThumbnailResponse>) => this.onResponse(event.data);
      worker.onerror = () => {
        // Le worker n'a pas démarré (navigateur trop ancien, script bloqué).
        this.gaveUp = true;
        this.finishActive(null);
        this.queued?.resolve(null);
        this.queued = null;
      };
      this.worker = worker;
    } catch {
      this.gaveUp = true;
    }
    return this.worker;
  }

  private startNext(): void {
    const next = this.queued;
    this.queued = null;
    if (!next) return;

    const worker = this.gaveUp || this.paused ? null : this.ensureWorker();
    if (!worker) {
      next.resolve(null);
      return;
    }

    const id = ++this.nextId;
    this.active = {
      ...next,
      id,
      startedAt: performance.now(),
      timer: setTimeout(() => this.onTimeout(id), JOB_TIMEOUT_MS),
    };
    worker.postMessage({
      type: 'thumbnail',
      id,
      job: next.target.job,
      maxWidth: this.maxWidth,
    } satisfies ThumbnailRequest);
  }

  private finishActive(bitmap: ImageBitmap | null): void {
    const active = this.active;
    if (!active) return;
    clearTimeout(active.timer);
    this.active = null;
    active.resolve(bitmap);
  }

  private onTimeout(id: number): void {
    if (this.active?.id !== id) return;
    this.worker?.postMessage({ type: 'cancel', id } satisfies ThumbnailRequest);
    this.strike();
    this.finishActive(null);
    this.startNext();
  }

  private onResponse(response: ThumbnailResponse): void {
    const active = this.active;
    if (!active || response.id !== active.id) {
      // Réponse d'une demande déjà abandonnée.
      if (response.type === 'thumbnail') response.bitmap.close();
      return;
    }

    if (response.type === 'thumbnail') {
      const span = response.span ?? active.target.span ?? { from: active.time, to: active.time + 1 };
      this.store(span, response.bitmap);
      this.strikes = 0;
      this.successes++;
      this.finishActive(response.bitmap);
    } else {
      if (response.failure === 'http' && response.status === 429) {
        this.pausedUntil = Date.now() + RATE_LIMIT_PAUSE_MS;
      } else if (response.failure !== 'aborted') {
        // Un refus franc alors que rien n'a jamais marché : inutile d'insister.
        const blunt = response.failure === 'unsupported'
          || response.failure === 'http'
          || (active.target.job.kind === 'mp4' && response.failure === 'network');
        if (blunt && this.successes === 0) this.gaveUp = true;
        else this.strike();
        console.debug(`[miniatures] ${response.failure} : ${response.reason}`);
      }
      this.finishActive(null);
    }
    this.startNext();
  }

  private strike(): void {
    if (++this.strikes >= MAX_STRIKES) this.gaveUp = true;
  }

  private store(span: ThumbnailSpan, bitmap: ImageBitmap): void {
    this.entries.push({ ...span, bitmap, used: ++this.clock });
    if (this.entries.length <= MAX_CACHED) return;
    let oldest = 0;
    for (let i = 1; i < this.entries.length; i++) {
      if (this.entries[i].used < this.entries[oldest].used) oldest = i;
    }
    this.entries.splice(oldest, 1)[0].bitmap.close();
  }
}
