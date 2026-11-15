// Liaison d'une télé (appli Movix TV) au compte connecté sur le site.
// Contrat : app-tv/docs/plans/2026-10-15-phase4-liaison-compte.md
// - GET  /api/tv/link/info?code=K7P2Q            → { deviceName, expiresIn }
// - POST /api/tv/link/confirm { userCode, profileId } → { ok, deviceName }
// Les deux routes demandent le JWT du site (Bearer), comme les autres appels
// authentifiés.

const MAIN_API = import.meta.env.VITE_MAIN_API;

/** Alphabet des codes télé : pas de 0/O ni de 1/I/L, pour éviter les confusions. */
export const TV_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const TV_CODE_LENGTH = 5;

const TV_CODE_CHARS = new Set(TV_CODE_ALPHABET.split(''));

export type TvLinkErrorCode =
  | 'code_invalid'
  | 'profile_not_owned'
  | 'too_many_attempts'
  | 'unauthorized'
  | 'network'
  | 'unknown';

export class TvLinkError extends Error {
  code: TvLinkErrorCode;
  status?: number;

  constructor(code: TvLinkErrorCode, status?: number) {
    super(code);
    this.name = 'TvLinkError';
    this.code = code;
    this.status = status;
  }
}

export interface TvLinkInfo {
  deviceName: string;
  expiresIn: number;
}

export interface TvLinkConfirmResult {
  ok: true;
  deviceName: string;
}

/**
 * Garde seulement les caractères valides, en majuscules, coupés à 5.
 * Accepte aussi un lien complet collé (`…/tv?code=K7P2Q`).
 */
export function sanitizeTvCode(raw: string): string {
  if (!raw) return '';
  let source = raw;
  const fromUrl = raw.match(/[?&]code=([^&#\s]+)/i);
  if (fromUrl) source = fromUrl[1];
  let result = '';
  for (const char of source.toUpperCase()) {
    if (TV_CODE_CHARS.has(char)) {
      result += char;
      if (result.length === TV_CODE_LENGTH) break;
    }
  }
  return result;
}

export function isCompleteTvCode(code: string): boolean {
  return code.length === TV_CODE_LENGTH && sanitizeTvCode(code) === code;
}

function getAuthToken(): string | null {
  try {
    return localStorage.getItem('auth_token');
  } catch {
    return null;
  }
}

function toTvLinkError(status: number, payload: { error?: unknown } | null): TvLinkError {
  const apiError = typeof payload?.error === 'string' ? payload.error : '';
  if (status === 401) return new TvLinkError('unauthorized', status);
  if (status === 404 || apiError === 'code_invalid') return new TvLinkError('code_invalid', status);
  if (status === 403 || apiError === 'profile_not_owned') return new TvLinkError('profile_not_owned', status);
  if (status === 429) return new TvLinkError('too_many_attempts', status);
  return new TvLinkError('unknown', status);
}

async function requestTvLink<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  if (!token) throw new TvLinkError('unauthorized');

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${MAIN_API}${path}`, { ...init, headers });
  } catch {
    throw new TvLinkError('network');
  }

  const payload = await response.json().catch(() => null) as ({ error?: unknown } & Record<string, unknown>) | null;
  if (!response.ok) throw toTvLinkError(response.status, payload);
  return (payload ?? {}) as T;
}

export async function getTvLinkInfo(code: string, signal?: AbortSignal): Promise<TvLinkInfo> {
  const data = await requestTvLink<Partial<TvLinkInfo>>(
    `/api/tv/link/info?code=${encodeURIComponent(code)}`,
    { signal },
  );
  return {
    deviceName: typeof data.deviceName === 'string' && data.deviceName.trim() ? data.deviceName.trim() : '',
    expiresIn: typeof data.expiresIn === 'number' && Number.isFinite(data.expiresIn) ? data.expiresIn : 0,
  };
}

export async function confirmTvLink(userCode: string, profileId: string): Promise<TvLinkConfirmResult> {
  const data = await requestTvLink<Partial<TvLinkConfirmResult>>('/api/tv/link/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userCode, profileId }),
  });
  if (!data.ok) throw new TvLinkError('unknown');
  return {
    ok: true,
    deviceName: typeof data.deviceName === 'string' ? data.deviceName : '',
  };
}
