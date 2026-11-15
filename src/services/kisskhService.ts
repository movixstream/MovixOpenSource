import { MAIN_API, PROXIES_EMBED_API } from '../config/runtime';
import { getVipHeaders } from '../utils/vipUtils';
import type {
  KisskhCipher,
  KisskhErrorCode,
  KisskhFallbackResult,
  KisskhFallbackTransport,
  KisskhMatch,
  KisskhResolution,
  KisskhSource,
  KisskhSubtitleFormat,
  KisskhSubtitleTrack,
  ResolveKisskhOptions,
} from '../types/kisskh';

const RESOLUTION_MAX_BYTES = 256 * 1024;
const ERROR_MAX_BYTES = 4 * 1024;
const KISSKH_SUBTITLE_MAX_BYTES = 2 * 1024 * 1024;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const ERROR_CODES = new Set<KisskhErrorCode>([
  'retrieval_in_progress',
  'not_found',
  'episode_missing',
  'provider_rate_limited',
  'provider_changed',
  'proxy_unavailable',
  'subtitle_unsupported',
  'subtitle_decrypt_failed',
  'upstream_unavailable',
]);
const SAFE_MESSAGES: Readonly<Record<KisskhErrorCode, string>> = Object.freeze({
  retrieval_in_progress: 'Récupération KissKH en cours',
  not_found: 'Serie KissKH introuvable',
  episode_missing: 'Episode KissKH indisponible',
  provider_rate_limited: 'KissKH est temporairement limite',
  provider_changed: 'KissKH a change de version',
  proxy_unavailable: 'Relais KissKH indisponible',
  subtitle_unsupported: 'Sous-titre KissKH non pris en charge',
  subtitle_decrypt_failed: 'Sous-titre KissKH illisible',
  upstream_unavailable: 'KissKH est temporairement indisponible',
});

export class KisskhServiceError extends Error {
  readonly code: KisskhErrorCode;

  constructor(code: KisskhErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = 'KisskhServiceError';
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function requireExactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isRecord(value) || !hasExactKeys(value, keys)) {
    throw new KisskhServiceError('upstream_unavailable');
  }
  return value;
}

function requireString(value: unknown, maxLength = 2048): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new KisskhServiceError('upstream_unavailable');
  }
  return value;
}

function requireInteger(value: unknown, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || Object.is(value, -0)) {
    throw new KisskhServiceError('upstream_unavailable');
  }
  return value as number;
}

function requireArgumentInteger(value: unknown, minimum: number, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || Object.is(value, -0)) {
    throw new TypeError(`${name} invalide`);
  }
  return value as number;
}

function decodedBase64Length(value: string): number {
  if (value.length === 0 || value.length % 4 !== 0 || !BASE64_PATTERN.test(value)) {
    throw new KisskhServiceError('upstream_unavailable');
  }
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

function decodeBase64(value: string, maxBytes: number): ArrayBuffer {
  const byteLength = decodedBase64Length(value);
  if (byteLength > maxBytes) throw new KisskhServiceError('upstream_unavailable');
  let decoded: string;
  try {
    decoded = atob(value);
  } catch {
    throw new KisskhServiceError('upstream_unavailable');
  }
  if (decoded.length !== byteLength || btoa(decoded) !== value) {
    throw new KisskhServiceError('upstream_unavailable');
  }
  const bytes = new Uint8Array(byteLength);
  for (let index = 0; index < byteLength; index += 1) bytes[index] = decoded.charCodeAt(index);
  return bytes.buffer;
}

function validateAesMaterial(value: string): string {
  if (decodeBase64(value, 16).byteLength !== 16) {
    throw new KisskhServiceError('upstream_unavailable');
  }
  return value;
}

function configuredProxyOrigin(): string {
  try {
    const configured = new URL(PROXIES_EMBED_API);
    if (
      !['http:', 'https:'].includes(configured.protocol)
      || configured.origin === 'null'
      || configured.username
      || configured.password
    ) {
      throw new Error('invalid origin');
    }
    return configured.origin;
  } catch {
    throw new KisskhServiceError('upstream_unavailable');
  }
}

function isLoopbackProxy(url: URL): boolean {
  return url.protocol === 'http:'
    && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

function validateTransportUrl(value: unknown): string {
  const raw = requireString(value, 8192);
  if (/[\r\n\0]/.test(raw)) throw new KisskhServiceError('upstream_unavailable');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new KisskhServiceError('upstream_unavailable');
  }
  if (
    !['http:', 'https:'].includes(url.protocol)
    || url.username
    || url.password
    || url.hash
    || (
      url.pathname === '/kisskh-proxy'
      && url.origin !== configuredProxyOrigin()
      && !isLoopbackProxy(url)
    )
  ) {
    throw new KisskhServiceError('upstream_unavailable');
  }
  return url.href;
}

function validateSubtitleSourceUrl(value: unknown): string {
  const raw = requireString(value, 8192);
  if (/[\r\n\0]/.test(raw)) throw new KisskhServiceError('upstream_unavailable');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new KisskhServiceError('upstream_unavailable');
  }
  if (
    !['http:', 'https:'].includes(url.protocol)
    || url.username
    || url.password
    || url.hash
  ) {
    throw new KisskhServiceError('upstream_unavailable');
  }
  return url.href;
}

function validateCipher(value: unknown): KisskhCipher {
  if (!isRecord(value) || typeof value.mode !== 'string') {
    throw new KisskhServiceError('upstream_unavailable');
  }
  if (value.mode === 'none') {
    requireExactRecord(value, ['mode']);
    return { mode: 'none' };
  }
  if (value.mode === 'aes-128-cbc') {
    const cipher = requireExactRecord(value, [
      'ivBase64', 'keyBase64', 'mode', 'padding', 'payloadEncoding',
    ]);
    if (cipher.payloadEncoding !== 'base64-per-cue' || cipher.padding !== 'pkcs7') {
      throw new KisskhServiceError('upstream_unavailable');
    }
    return {
      mode: 'aes-128-cbc',
      keyBase64: validateAesMaterial(requireString(cipher.keyBase64, 64)),
      ivBase64: validateAesMaterial(requireString(cipher.ivBase64, 64)),
      payloadEncoding: 'base64-per-cue',
      padding: 'pkcs7',
    };
  }
  if (value.mode === 'unsupported') {
    const cipher = requireExactRecord(value, ['mode', 'scheme']);
    if (cipher.scheme !== 'a2' && cipher.scheme !== 'a3') {
      throw new KisskhServiceError('upstream_unavailable');
    }
    return { mode: 'unsupported', scheme: cipher.scheme };
  }
  throw new KisskhServiceError('upstream_unavailable');
}

function validateFormatCipher(format: KisskhSubtitleFormat, cipher: KisskhCipher): void {
  const valid = (format === 'srt' && cipher.mode === 'none')
    || (format === 'txt' && cipher.mode === 'aes-128-cbc')
    || (format === 'txt1' && cipher.mode === 'unsupported' && cipher.scheme === 'a2')
    || (format === 'txt2' && cipher.mode === 'aes-128-cbc');
  if (!valid) throw new KisskhServiceError('upstream_unavailable');
}

function validateMatch(value: unknown, expected: Pick<KisskhMatch, 'tmdbId' | 'season' | 'episode'>): KisskhMatch {
  const match = requireExactRecord(value, [
    'episode', 'episodeId', 'kisskhDramaId', 'season', 'tmdbId',
  ]);
  const result = {
    tmdbId: requireInteger(match.tmdbId, 1),
    kisskhDramaId: requireInteger(match.kisskhDramaId, 1),
    episodeId: requireInteger(match.episodeId, 1),
    season: requireInteger(match.season, 0),
    episode: requireInteger(match.episode, 1),
  };
  if (
    result.tmdbId !== expected.tmdbId
    || result.season !== expected.season
    || result.episode !== expected.episode
  ) {
    throw new KisskhServiceError('upstream_unavailable');
  }
  return result;
}

function validateSource(value: unknown): KisskhSource {
  const source = requireExactRecord(value, ['fallbackToken', 'id', 'label', 'type', 'url']);
  if (source.type !== 'hls' && source.type !== 'mp4') {
    throw new KisskhServiceError('upstream_unavailable');
  }
  return {
    id: requireString(source.id, 256),
    label: requireString(source.label, 256),
    type: source.type,
    url: validateTransportUrl(source.url),
    fallbackToken: requireString(source.fallbackToken, 2048),
  };
}

function validateSubtitle(value: unknown): KisskhSubtitleTrack {
  const track = requireExactRecord(value, [
    'cipher', 'format', 'id', 'label', 'lang', 'proxyUrl', 'sourceUrl',
  ]);
  if (!['srt', 'txt', 'txt1', 'txt2'].includes(String(track.format))) {
    throw new KisskhServiceError('upstream_unavailable');
  }
  const format = track.format as KisskhSubtitleFormat;
  const cipher = validateCipher(track.cipher);
  validateFormatCipher(format, cipher);
  return {
    id: requireString(track.id, 256),
    lang: requireString(track.lang, 64),
    label: requireString(track.label, 256),
    format,
    sourceUrl: validateSubtitleSourceUrl(track.sourceUrl),
    proxyUrl: validateTransportUrl(track.proxyUrl),
    cipher,
  };
}

export function validateKisskhResolution(
  value: unknown,
  expected: Pick<KisskhMatch, 'tmdbId' | 'season' | 'episode'>,
): KisskhResolution {
  const result = requireExactRecord(value, ['match', 'sources', 'subtitles']);
  if (!Array.isArray(result.sources) || result.sources.length === 0 || result.sources.length > 8) {
    throw new KisskhServiceError('upstream_unavailable');
  }
  if (!Array.isArray(result.subtitles) || result.subtitles.length > 64) {
    throw new KisskhServiceError('upstream_unavailable');
  }
  return {
    match: validateMatch(result.match, expected),
    sources: result.sources.map(validateSource),
    subtitles: result.subtitles.map(validateSubtitle),
  };
}

async function readBoundedResponse(response: Response, maxBytes: number): Promise<ArrayBuffer> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null) {
    if (!/^(?:0|[1-9]\d*)$/.test(declaredLength) || Number(declaredLength) > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new KisskhServiceError('upstream_unavailable');
    }
  }
  if (!response.body) return new ArrayBuffer(0);

  const reader = response.body.getReader();
  // releaseLock rejette reader.closed même lorsque toutes les lectures sont
  // terminées. Certains Firefox remontent ce rejet si personne ne l'observe.
  void reader.closed.catch(() => undefined);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new KisskhServiceError('upstream_unavailable');
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new KisskhServiceError('upstream_unavailable');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output.buffer;
}

function decodeJson(raw: ArrayBuffer): unknown {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
    return JSON.parse(text) as unknown;
  } catch {
    throw new KisskhServiceError('upstream_unavailable');
  }
}

async function readErrorCode(response: Response): Promise<KisskhErrorCode> {
  try {
    const raw = await readBoundedResponse(response, ERROR_MAX_BYTES);
    const payload = decodeJson(raw);
    if (isRecord(payload)) {
      const candidate = typeof payload.code === 'string' ? payload.code : payload.error;
      if (typeof candidate === 'string' && ERROR_CODES.has(candidate as KisskhErrorCode)) {
        return candidate as KisskhErrorCode;
      }
    }
  } catch {
    // Deliberately discard untrusted upstream error bodies.
  }
  if (response.status === 404) return 'not_found';
  if (response.status === 429) return 'provider_rate_limited';
  return 'upstream_unavailable';
}

async function readKisskhResolution(
  response: Response,
  expected: Pick<KisskhMatch, 'tmdbId' | 'season' | 'episode'>,
): Promise<KisskhResolution> {
  if (response.status === 202) throw new KisskhServiceError('retrieval_in_progress');
  if (!response.ok) throw new KisskhServiceError(await readErrorCode(response));
  const payload = decodeJson(await readBoundedResponse(response, RESOLUTION_MAX_BYTES));
  return validateKisskhResolution(payload, expected);
}

async function requestKisskhResolution(
  endpoint: URL,
  expected: Pick<KisskhMatch, 'tmdbId' | 'season' | 'episode'>,
  options: ResolveKisskhOptions,
): Promise<KisskhResolution> {
  let response: Response;
  try {
    response = await fetch(endpoint.href, {
      method: 'GET',
      headers: getVipHeaders(),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new KisskhServiceError('upstream_unavailable');
  }
  return readKisskhResolution(response, expected);
}

export async function resolveKisskhTv(
  tmdbIdInput: number,
  seasonInput: number,
  episodeInput: number,
  options: ResolveKisskhOptions = {},
): Promise<KisskhResolution> {
  const tmdbId = requireArgumentInteger(tmdbIdInput, 1, 'tmdbId');
  const season = requireArgumentInteger(seasonInput, 0, 'season');
  const episode = requireArgumentInteger(episodeInput, 1, 'episode');
  let endpoint: URL;
  try {
    endpoint = new URL(`/api/kisskh/tv/${tmdbId}`, `${MAIN_API}/`);
  } catch {
    throw new KisskhServiceError('upstream_unavailable');
  }
  endpoint.searchParams.set('season', String(season));
  endpoint.searchParams.set('episode', String(episode));

  return requestKisskhResolution(endpoint, { tmdbId, season, episode }, options);
}

export async function resolveKisskhMovie(
  tmdbIdInput: number,
  options: ResolveKisskhOptions = {},
): Promise<KisskhResolution> {
  const tmdbId = requireArgumentInteger(tmdbIdInput, 1, 'tmdbId');
  let endpoint: URL;
  try {
    endpoint = new URL(`/api/kisskh/movie/${tmdbId}`, `${MAIN_API}/`);
  } catch {
    throw new KisskhServiceError('upstream_unavailable');
  }
  return requestKisskhResolution(endpoint, { tmdbId, season: 0, episode: 1 }, options);
}

function validateFallbackResult(value: KisskhFallbackResult | unknown): Extract<KisskhFallbackResult, {
  success: true;
  kind: 'subtitle';
}> {
  const result = requireExactRecord(value, [
    'bodyBase64', 'contentType', 'kind', 'status', 'success',
  ]);
  if (
    result.success !== true
    || result.kind !== 'subtitle'
    || !Number.isSafeInteger(result.status)
    || (result.status as number) < 200
    || (result.status as number) >= 300
  ) {
    throw new KisskhServiceError('upstream_unavailable');
  }
  const contentType = requireString(result.contentType, 256).toLowerCase();
  if (!contentType.startsWith('text/') && !contentType.startsWith('application/x-subrip')) {
    throw new KisskhServiceError('upstream_unavailable');
  }
  return {
    success: true,
    kind: 'subtitle',
    status: result.status as number,
    contentType,
    bodyBase64: requireString(result.bodyBase64, Math.ceil(KISSKH_SUBTITLE_MAX_BYTES / 3) * 4),
  };
}

async function fetchSubtitleFallback(
  track: KisskhSubtitleTrack,
  transport: KisskhFallbackTransport,
): Promise<ArrayBuffer> {
  let result: KisskhFallbackResult;
  try {
    result = await transport({ kind: 'subtitle', sourceUrl: track.sourceUrl });
  } catch {
    throw new KisskhServiceError('upstream_unavailable');
  }
  const subtitle = validateFallbackResult(result);
  return decodeBase64(subtitle.bodyBase64, KISSKH_SUBTITLE_MAX_BYTES);
}

export async function fetchKisskhSubtitle(
  trackInput: KisskhSubtitleTrack,
  transport: KisskhFallbackTransport,
): Promise<ArrayBuffer> {
  const track = validateSubtitle(trackInput);
  let response: Response;
  try {
    response = await fetch(track.proxyUrl, { method: 'GET' });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return fetchSubtitleFallback(track, transport);
  }

  if (response.ok) {
    try {
      return await readBoundedResponse(response, KISSKH_SUBTITLE_MAX_BYTES);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      if (error instanceof KisskhServiceError) throw error;
      await response.body?.cancel().catch(() => undefined);
      return fetchSubtitleFallback(track, transport);
    }
  }
  if (response.status >= 500 && response.status <= 599) {
    await response.body?.cancel().catch(() => undefined);
    return fetchSubtitleFallback(track, transport);
  }
  await response.body?.cancel().catch(() => undefined);
  throw new KisskhServiceError(response.status === 404 ? 'subtitle_unsupported' : 'proxy_unavailable');
}
