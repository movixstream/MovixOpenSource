import { MAIN_API } from '../config/runtime';

// Onglet « IA » de la modération des commentaires : réglages du fournisseur
// (Claude Platform, OpenRouter ou aucun) et essai sur un texte. Les clés ne
// reviennent jamais en clair : seulement leur source et leurs 4 derniers
// caractères.

export type CommentsAiProvider = 'claude' | 'openrouter' | 'off';
export type CommentsAiTestProvider = Exclude<CommentsAiProvider, 'off'>;

export interface CommentsAiKeyStatus {
  set: boolean;
  /** `admin` : saisie dans ce panneau ; `env` : lue dans le .env du serveur. */
  source: 'admin' | 'env' | null;
  hint: string | null;
  /** La clé enregistrée ne se déchiffre plus (JWT_SECRET changé ?). */
  unreadable: boolean;
}

export interface CommentsAiProviderSettings {
  model: string;
  effort: string;
  key: CommentsAiKeyStatus;
}

export interface CommentsAiSettings {
  provider: CommentsAiProvider;
  spoilerDetection: boolean;
  fallbackToOpenRouter: boolean;
  claude: CommentsAiProviderSettings;
  openrouter: CommentsAiProviderSettings;
}

export interface CommentsAiModelChoice {
  id: string;
  label: string;
  /** Coût d'un commentaire, consigne déjà en cache (dollars). */
  perComment: number | null;
  /** Coût du premier commentaire après une heure sans appel (dollars). */
  firstOfHour: number | null;
}

export interface CommentsAiOptions {
  claudeModels: CommentsAiModelChoice[];
  claudeEfforts: string[];
  openrouterEfforts: string[];
  claudeSdkInstalled: boolean;
}

export interface CommentsAiPayload {
  settings: CommentsAiSettings;
  options: CommentsAiOptions;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** Modifs envoyées au serveur : une clé absente reste telle quelle. */
export interface CommentsAiProviderInput {
  model?: string;
  effort?: string;
  apiKey?: string;
  clearApiKey?: boolean;
}

export interface CommentsAiSettingsInput {
  provider?: CommentsAiProvider;
  spoilerDetection?: boolean;
  fallbackToOpenRouter?: boolean;
  claude?: CommentsAiProviderInput;
  openrouter?: CommentsAiProviderInput;
}

export interface CommentsAiDecision {
  flagged: boolean;
  reason: string | null;
  details: string;
  spoiler: boolean;
}

export interface CommentsAiTestResult {
  provider: CommentsAiTestProvider | null;
  model: string | null;
  decision: CommentsAiDecision | null;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number } | null;
  costUsd: number | null;
  durationMs: number | null;
  stopReason: string | null;
  error: string | null;
}

type ApiError = Error & { statusCode?: number };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createApiError(message: string, statusCode?: number): ApiError {
  const error = new Error(message) as ApiError;
  if (statusCode !== undefined) error.statusCode = statusCode;
  return error;
}

async function requestAdminJson(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const token = localStorage.getItem('auth_token');
  if (!token) throw createApiError('Token admin manquant');

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${MAIN_API}${path}`, { cache: 'no-store', ...init, headers });
  const data: unknown = await response.json().catch(() => ({}));
  const body = isPlainObject(data) ? data : {};
  if (!response.ok) {
    throw createApiError(typeof body.error === 'string' && body.error ? body.error : 'Erreur réseau', response.status);
  }
  return body;
}

function toPayload(body: Record<string, unknown>): CommentsAiPayload {
  if (!isPlainObject(body.settings) || !isPlainObject(body.options)) {
    throw createApiError('Réponse inattendue du serveur');
  }
  return {
    settings: body.settings as unknown as CommentsAiSettings,
    options: body.options as unknown as CommentsAiOptions,
    updatedAt: typeof body.updatedAt === 'string' ? body.updatedAt : null,
    updatedBy: typeof body.updatedBy === 'string' ? body.updatedBy : null
  };
}

export async function getCommentsAiSettings(): Promise<CommentsAiPayload> {
  return toPayload(await requestAdminJson('/api/admin/comments-ai'));
}

export async function updateCommentsAiSettings(settings: CommentsAiSettingsInput): Promise<CommentsAiPayload> {
  return toPayload(await requestAdminJson('/api/admin/comments-ai', {
    method: 'PUT',
    body: JSON.stringify({ settings })
  }));
}

/** Analyse un texte avec les réglages enregistrés, sans rien écrire. Facturé comme un commentaire. */
export async function testCommentsAi(input: {
  content: string;
  provider: CommentsAiTestProvider;
  mediaType?: 'movie' | 'tv';
  mediaId?: string;
}): Promise<CommentsAiTestResult> {
  const body = await requestAdminJson('/api/admin/comments-ai/test', {
    method: 'POST',
    body: JSON.stringify(input)
  });
  if (!isPlainObject(body.result)) throw createApiError('Réponse inattendue du serveur');
  return body.result as unknown as CommentsAiTestResult;
}
