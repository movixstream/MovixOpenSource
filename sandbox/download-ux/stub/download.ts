import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WriteStream } from 'node:fs';
import type {
  DownloadCandidate,
  DownloadOptions,
  DownloadProgress,
  DownloadResult,
  MediaRef,
  ResolveOptions,
} from './types.ts';
import { resolvePlayable } from './resolvePlayable.ts';

function writeChunk(stream: WriteStream, chunk: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(chunk, (err) => (err ? reject(err) : resolve()));
  });
}

function endStream(stream: WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.end((err?: Error | null) => (err ? reject(err) : resolve()));
  });
}

const DEFAULT_DEST_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'tmp-downloads',
);

function emitProgress(options: DownloadOptions, progress: DownloadProgress): void {
  options.onProgress?.(progress);
}

/** True for sandbox fake URLs — keep no-op / skip / fail stub semantics. */
export function isStubUrl(url: string): boolean {
  const lower = String(url || '').toLowerCase();
  if (!lower) return true;
  if (lower.includes('stub.local')) return true;
  try {
    const u = new URL(url);
    return u.hostname === 'stub.local' || u.protocol === 'stub:';
  } catch {
    return false;
  }
}

function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Safe filename from media title / tmdbId (+ season/episode). */
export function buildSafeFilename(candidate: DownloadCandidate): string {
  const media = candidate.media;
  const baseLabel =
    media.title ||
    (media.type === 'movie'
      ? `movie-${media.tmdbId}`
      : `tv-${media.tmdbId}-s${media.season ?? 0}-e${media.episode ?? 0}`);

  const cleaned = String(baseLabel)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_.-]+|[_.-]+$/g, '')
    .slice(0, 120) || `tmdb-${media.tmdbId}`;

  const quality =
    typeof candidate.quality === 'number' ? `_${candidate.quality}p` : '';
  const hoster = candidate.hoster
    ? `_${candidate.hoster.replace(/[^a-zA-Z0-9_-]+/g, '')}`
    : '';
  // Toujours .mp4 en sortie (HLS remuxé via ffmpeg).
  return `${cleaned}${quality}${hoster}.mp4`;
}

const DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin + '/';
  } catch {
    return undefined;
  }
}

function buildRequestHeaders(
  candidate: DownloadCandidate,
  currentUrl: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: '*/*',
    'User-Agent': DEFAULT_UA,
    ...(candidate.headers || {}),
  };
  if (!headers.Referer && !headers.referer) {
    headers.Referer =
      candidate.referer || originOf(currentUrl) || originOf(candidate.url) || '';
  }
  if (!headers.Referer) delete headers.Referer;
  return headers;
}

/**
 * Follow redirects manually so Referer survives cross-origin hops
 * (Node/undici fetch strips it; CDNs like zen-blk → falzey need it).
 */
async function fetchWithRefererRedirects(
  candidate: DownloadCandidate,
  options: DownloadOptions,
  maxRedirects = 12,
): Promise<Response> {
  let url = candidate.url;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (options.signal?.aborted) {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    }
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: options.signal,
      headers: buildRequestHeaders(candidate, url),
    });

    if (response.status >= 300 && response.status < 400) {
      const loc = response.headers.get('location');
      await response.body?.cancel().catch(() => undefined);
      if (!loc) {
        throw new Error(`redirect ${response.status} without Location`);
      }
      url = new URL(loc, url).href;
      continue;
    }

    return response;
  }
  throw new Error(`trop de redirections (>${maxRedirects})`);
}

function looksLikeHtml(contentType: string | null, head: Buffer): boolean {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('text/html') || ct.includes('application/xhtml')) return true;
  const start = head.subarray(0, Math.min(head.length, 64)).toString('utf8').trimStart();
  return start.startsWith('<!DOCTYPE') || start.startsWith('<html') || start.startsWith('<HTML');
}

async function downloadStub(
  candidate: DownloadCandidate,
  options: DownloadOptions,
): Promise<DownloadResult> {
  emitProgress(options, { phase: 'queued', percent: 0, message: 'queued' });
  emitProgress(options, {
    phase: 'fetching',
    percent: 10,
    message: `stub fetch ${candidate.source}/${candidate.hoster}`,
  });

  const url = candidate.url.toLowerCase();

  if (url.includes('fail')) {
    emitProgress(options, { phase: 'done', percent: null, message: 'failed' });
    return {
      ok: false,
      status: 'failed',
      candidateId: candidate.id,
      error: 'stub-fail: URL de test',
      message: 'échec simulé',
      attempts: 1,
    };
  }

  if (url.includes('skip')) {
    emitProgress(options, { phase: 'done', percent: 100, message: 'skipped' });
    return {
      ok: true,
      status: 'skipped',
      candidateId: candidate.id,
      skipped: true,
      message: 'déjà présent (stub)',
      attempts: 1,
    };
  }

  emitProgress(options, {
    phase: 'writing',
    percent: 80,
    bytesReceived: 800,
    bytesTotal: 1000,
    message: 'stub write (no-op)',
  });
  emitProgress(options, { phase: 'done', percent: 100, message: 'completed' });

  return {
    ok: true,
    status: 'completed',
    candidateId: candidate.id,
    message: `stub completed via ${candidate.source} (no file written)`,
    attempts: 1,
  };
}

async function downloadMp4ToDisk(
  candidate: DownloadCandidate,
  options: DownloadOptions,
): Promise<DownloadResult> {
  const destDir = options.destDir || DEFAULT_DEST_DIR;
  const maxBytes =
    typeof options.maxBytes === 'number' && options.maxBytes > 0
      ? options.maxBytes
      : undefined;
  let filename = buildSafeFilename(candidate);
  // Distinct path for capped smoke downloads so skipIfExists does not collide with a full file.
  if (maxBytes != null) {
    filename = filename.replace(/(\.[^.]+)?$/, `-smoke${maxBytes}$1`);
  }
  const destPath = join(destDir, filename);
  const partialPath = `${destPath}.partial`;
  const skipIfExists = options.skipIfExists !== false;

  await mkdir(destDir, { recursive: true });

  if (skipIfExists) {
    try {
      const existing = await stat(destPath);
      if (existing.isFile() && existing.size > 0) {
        emitProgress(options, {
          phase: 'done',
          percent: 100,
          bytesReceived: existing.size,
          bytesTotal: existing.size,
          message: 'skipped (exists)',
        });
        return {
          ok: true,
          status: 'skipped',
          candidateId: candidate.id,
          path: destPath,
          skipped: true,
          message: `déjà présent (${existing.size} bytes)`,
          attempts: 1,
        };
      }
    } catch {
      // missing → continue
    }
  }

  if (options.signal?.aborted) {
    return {
      ok: false,
      status: 'cancelled',
      candidateId: candidate.id,
      error: 'aborted',
      attempts: 1,
    };
  }

  emitProgress(options, { phase: 'queued', percent: 0, message: 'queued' });
  emitProgress(options, {
    phase: 'fetching',
    percent: 0,
    message: `fetch ${candidate.source}/${candidate.hoster}`,
  });

  let response: Response;
  try {
    response = await fetchWithRefererRedirects(candidate, options);
  } catch (err) {
    if (options.signal?.aborted || (err as Error)?.name === 'AbortError') {
      return {
        ok: false,
        status: 'cancelled',
        candidateId: candidate.id,
        error: 'aborted',
        attempts: 1,
      };
    }
    return {
      ok: false,
      status: 'failed',
      candidateId: candidate.id,
      error: `fetch failed: ${String((err as Error)?.message || err)}`,
      attempts: 1,
    };
  }

  if (!response.ok && response.status !== 206) {
    return {
      ok: false,
      status: 'failed',
      candidateId: candidate.id,
      error: `HTTP ${response.status} ${response.statusText || ''}`.trim(),
      attempts: 1,
    };
  }

  if (!response.body) {
    return {
      ok: false,
      status: 'failed',
      candidateId: candidate.id,
      error: 'réponse sans body',
      attempts: 1,
    };
  }

  const contentType = response.headers.get('content-type');
  const contentLengthRaw = response.headers.get('content-length');
  const bytesTotal =
    contentLengthRaw && Number.isFinite(Number(contentLengthRaw))
      ? Number(contentLengthRaw)
      : null;

  let bytesReceived = 0;
  let truncated = false;
  let htmlChecked = false;

  await unlink(partialPath).catch(() => undefined);
  const out = createWriteStream(partialPath);

  try {
    const reader = response.body.getReader();

    while (true) {
      if (options.signal?.aborted) {
        await reader.cancel().catch(() => undefined);
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      }

      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;

      let buf: Buffer = Buffer.from(value);

      if (!htmlChecked) {
        htmlChecked = true;
        if (looksLikeHtml(contentType, buf)) {
          await reader.cancel().catch(() => undefined);
          throw new Error(
            'réponse HTML au lieu d’un MP4 (Referer / CDN gate ?)',
          );
        }
      }

      if (maxBytes != null && bytesReceived + buf.length > maxBytes) {
        buf = buf.subarray(0, Math.max(0, maxBytes - bytesReceived));
        truncated = true;
      }

      if (buf.length > 0) {
        await writeChunk(out, buf);
        bytesReceived += buf.length;
      }

      const percent =
        bytesTotal && bytesTotal > 0
          ? Math.min(99, Math.round((bytesReceived / bytesTotal) * 100))
          : null;
      emitProgress(options, {
        phase: 'writing',
        bytesReceived,
        bytesTotal,
        percent,
        message: truncated ? 'smoke cap reached' : 'writing',
      });

      if (truncated) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }

    await endStream(out);

    if (bytesReceived <= 0) {
      await unlink(partialPath).catch(() => undefined);
      return {
        ok: false,
        status: 'failed',
        candidateId: candidate.id,
        error: '0 bytes reçus',
        attempts: 1,
      };
    }

    await rename(partialPath, destPath);

    emitProgress(options, {
      phase: 'done',
      percent: truncated ? null : 100,
      bytesReceived,
      bytesTotal,
      message: truncated ? 'completed (partial / smoke)' : 'completed',
    });

    return {
      ok: true,
      status: 'completed',
      candidateId: candidate.id,
      path: destPath,
      message: truncated
        ? `écrit ${bytesReceived} bytes (maxBytes=${maxBytes}, fichier partiel)`
        : `écrit ${bytesReceived} bytes → ${destPath}`,
      attempts: 1,
    };
  } catch (err) {
    out.destroy();
    await unlink(partialPath).catch(() => undefined);
    if (options.signal?.aborted || (err as Error)?.name === 'AbortError') {
      return {
        ok: false,
        status: 'cancelled',
        candidateId: candidate.id,
        error: 'aborted',
        attempts: 1,
      };
    }
    return {
      ok: false,
      status: 'failed',
      candidateId: candidate.id,
      error: `écriture échouée: ${String((err as Error)?.message || err)}`,
      attempts: 1,
    };
  }
}

/**
 * HLS → fichier via ffmpeg (copie flux). Smoke : `-fs maxBytes`.
 * Requiert `ffmpeg` sur PATH.
 */
async function downloadHlsWithFfmpeg(
  candidate: DownloadCandidate,
  options: DownloadOptions,
): Promise<DownloadResult> {
  const destDir = options.destDir || DEFAULT_DEST_DIR;
  const maxBytes =
    typeof options.maxBytes === 'number' && options.maxBytes > 0
      ? options.maxBytes
      : undefined;
  let filename = buildSafeFilename(candidate);
  if (maxBytes != null) {
    filename = filename.replace(/(\.[^.]+)?$/, `-smoke${maxBytes}$1`);
  }
  const destPath = join(destDir, filename);
  // ffmpeg needs a real muxer extension (`.partial` alone → "Unable to choose format").
  const partialPath = `${destPath}.partial.mp4`;
  const skipIfExists = options.skipIfExists !== false;

  await mkdir(destDir, { recursive: true });

  if (skipIfExists) {
    try {
      const existing = await stat(destPath);
      if (existing.isFile() && existing.size > 0) {
        return {
          ok: true,
          status: 'skipped',
          candidateId: candidate.id,
          path: destPath,
          skipped: true,
          message: `déjà présent (${existing.size} bytes)`,
          attempts: 1,
        };
      }
    } catch {
      /* continue */
    }
  }

  if (options.signal?.aborted) {
    return {
      ok: false,
      status: 'cancelled',
      candidateId: candidate.id,
      error: 'aborted',
      attempts: 1,
    };
  }

  const referer =
    candidate.referer ||
    candidate.headers?.Referer ||
    candidate.headers?.referer ||
    originOf(candidate.url) ||
    '';
  const headerLines = [
    `User-Agent: ${DEFAULT_UA}`,
    referer ? `Referer: ${referer}` : '',
  ]
    .filter(Boolean)
    .join('\r\n');

  // Proxiesembed signed URLs hide .ts/.m3u8 in ?url=… — ffmpeg 9 refuses
  // them unless extension checks are relaxed.
  const args = [
    '-y',
    '-loglevel',
    'error',
    '-headers',
    `${headerLines}\r\n`,
    '-allowed_extensions',
    'ALL',
    '-allowed_segment_extensions',
    'ALL',
    '-extension_picky',
    '0',
    '-i',
    candidate.url,
    '-c',
    'copy',
    '-bsf:a',
    'aac_adtstoasc',
    '-f',
    'mp4',
  ];
  if (maxBytes != null) {
    args.push('-fs', String(maxBytes));
  }
  args.push(partialPath);

  emitProgress(options, {
    phase: 'fetching',
    percent: 0,
    message: `ffmpeg hls ${candidate.source}/${candidate.hoster}`,
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let errBuf = '';
      child.stderr?.on('data', (chunk) => {
        errBuf += String(chunk);
        if (errBuf.length > 4000) errBuf = errBuf.slice(-2000);
      });
      const onAbort = () => {
        child.kill('SIGTERM');
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });
      child.on('error', (err) => {
        options.signal?.removeEventListener('abort', onAbort);
        reject(err);
      });
      child.on('close', (code) => {
        options.signal?.removeEventListener('abort', onAbort);
        // -fs may exit non-zero after hitting size; accept if file has bytes.
        if (code === 0 || maxBytes != null) resolve();
        else reject(new Error(errBuf.trim() || `ffmpeg exit ${code}`));
      });
    });

    if (options.signal?.aborted) {
      await unlink(partialPath).catch(() => undefined);
      return {
        ok: false,
        status: 'cancelled',
        candidateId: candidate.id,
        error: 'aborted',
        attempts: 1,
      };
    }

    let size = 0;
    try {
      size = (await stat(partialPath)).size;
    } catch {
      size = 0;
    }
    if (size <= 0) {
      await unlink(partialPath).catch(() => undefined);
      return {
        ok: false,
        status: 'failed',
        candidateId: candidate.id,
        error: 'ffmpeg: 0 bytes (clé VIP / signature m3u8 expirée ?)',
        attempts: 1,
      };
    }

    await rename(partialPath, destPath);
    emitProgress(options, {
      phase: 'done',
      percent: maxBytes != null ? null : 100,
      bytesReceived: size,
      message: maxBytes != null ? 'completed (hls smoke)' : 'completed (hls)',
    });
    return {
      ok: true,
      status: 'completed',
      candidateId: candidate.id,
      path: destPath,
      message:
        maxBytes != null
          ? `hls écrit ${size} bytes (maxBytes=${maxBytes}) → ${destPath}`
          : `hls écrit ${size} bytes → ${destPath}`,
      attempts: 1,
    };
  } catch (err) {
    await unlink(partialPath).catch(() => undefined);
    if (options.signal?.aborted || (err as Error)?.name === 'AbortError') {
      return {
        ok: false,
        status: 'cancelled',
        candidateId: candidate.id,
        error: 'aborted',
        attempts: 1,
      };
    }
    const msg = String((err as Error)?.message || err);
    const missing = /ENOENT|not found|ffmpeg/i.test(msg) && !msg.includes('exit');
    return {
      ok: false,
      status: 'failed',
      candidateId: candidate.id,
      error: missing
        ? `ffmpeg indisponible: ${msg}`
        : `hls/ffmpeg: ${msg.slice(0, 300)}`,
      attempts: 1,
    };
  }
}

async function downloadOne(
  candidate: DownloadCandidate,
  options: DownloadOptions,
): Promise<DownloadResult> {
  if (!candidate?.id || !candidate.url) {
    return {
      ok: false,
      status: 'failed',
      candidateId: candidate?.id || '',
      error: 'candidat invalide',
      attempts: 1,
    };
  }

  if (options.signal?.aborted) {
    return {
      ok: false,
      status: 'cancelled',
      candidateId: candidate.id,
      error: 'aborted',
      attempts: 1,
    };
  }

  if (isStubUrl(candidate.url)) {
    return downloadStub(candidate, options);
  }

  if (!isHttpUrl(candidate.url)) {
    return {
      ok: false,
      status: 'failed',
      candidateId: candidate.id,
      error: `URL non http(s): ${candidate.url.slice(0, 64)}`,
      attempts: 1,
    };
  }

  // Embeds non résolus : ne pas tenter un fetch HTML.
  if (candidate.kind === 'unknown') {
    const looksMp4 = /\.mp4(\?|$)/i.test(candidate.url);
    if (!looksMp4) {
      return {
        ok: false,
        status: 'failed',
        candidateId: candidate.id,
        error: 'embed non résolu (besoin VIP resolve=1 ou provider mp4)',
        attempts: 1,
      };
    }
  }

  if (candidate.kind === 'hls' || /\.m3u8(\?|$)/i.test(candidate.url)) {
    return downloadHlsWithFfmpeg(candidate, options);
  }

  return downloadMp4ToDisk(candidate, options);
}

/**
 * Télécharge un candidat (ou une liste rankée avec failover).
 * - `stub.local` / URLs de test → no-op stub (skip/fail/completed sans fichier)
 * - http(s) mp4 → fetch stream → disque sous destDir
 */
export async function download(
  candidate: DownloadCandidate | DownloadCandidate[],
  options: DownloadOptions = {},
): Promise<DownloadResult> {
  const list = Array.isArray(candidate) ? candidate : [candidate];
  if (list.length === 0) {
    return {
      ok: false,
      status: 'failed',
      candidateId: '',
      error: 'no candidates',
      attempts: 0,
    };
  }

  const failover = options.failover !== false;
  let attempts = 0;
  let last: DownloadResult | null = null;

  for (const item of list) {
    attempts += 1;
    last = await downloadOne(item, options);
    last.attempts = attempts;
    if (last.ok || last.status === 'cancelled' || last.status === 'skipped') {
      return last;
    }
    if (!failover) return last;
  }

  return (
    last ?? {
      ok: false,
      status: 'failed',
      candidateId: '',
      error: 'no candidates',
      attempts,
    }
  );
}

/** resolve (multi-sources + rank) puis download avec failover. */
export async function resolveAndDownloadFirst(
  media: MediaRef,
  resolveOptions?: ResolveOptions,
  downloadOptions?: DownloadOptions,
): Promise<DownloadResult> {
  const candidates = await resolvePlayable(media, resolveOptions);
  return download(candidates, downloadOptions);
}

export { DEFAULT_DEST_DIR };
