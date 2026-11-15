import { MAIN_API } from '../config/runtime';
import { getSessionClientId } from '../utils/sessionClientId';
import { getAccessKey } from '../utils/vipUtils';

// Parrainage : appels à /api/referral/* et /api/admin/referral*, plus le code
// gardé en attente dans ce navigateur jusqu'à la connexion. Mêmes formes que
// API/Mainapi/routes/referral.js et utils/referralSettings.js.

export type ReferralStatus = 'pending' | 'rewarded' | 'cancelled';

export interface ReferralProgress {
  status: ReferralStatus;
  watchMinutes: number;
  watchDays: number;
  requiredMinutes: number;
  requiredDays: number;
}

export interface ReferralReward {
  id: number;
  role: 'referrer' | 'referee';
  days: number;
}

export interface ReferralAccount {
  enabled: true;
  code: string;
  /** Compte trop récent pour parrainer : date à partir de laquelle le code marche (null = déjà actif). */
  codeActiveAt?: string | null;
  rewardDays: number;
  requiredMinutes: number;
  requiredDays: number;
  stats: { invited: number; pending: number; rewarded: number; daysEarned: number };
  referee: ReferralProgress | null;
  canEnterCode: boolean;
  claimDeadline: string | null;
  rewards: ReferralReward[];
}

export type ReferralMe = ReferralAccount | { enabled: false };

export interface ReferralSettings {
  enabled: boolean;
  rewardDays: number;
  requiredMinutes: number;
  requiredDays: number;
  claimWindowDays: number;
  maxRewardsPerMonth: number;
  /** Âge minimal du compte du parrain, en jours (0 = aucun). */
  minReferrerAccountDays: number;
}

export interface ReferralAdminStats {
  pending: number;
  rewarded: number;
  cancelled: number;
  daysGranted: number;
  daysRedeemed: number;
}

export interface ReferralAdminPayload {
  settings: ReferralSettings;
  updatedAt: string | null;
  updatedBy: string | null;
  stats?: ReferralAdminStats;
}

export interface ReferralAdminItem {
  id: number;
  code: string;
  status: ReferralStatus;
  referrer: { userType: string; userId: string; name: string | null };
  referee: { userType: string; userId: string; name: string | null };
  watchMinutes: number;
  watchDays: number;
  requiredMinutes: number;
  requiredDays: number;
  createdAt: string | null;
  rewardedAt: string | null;
  cancelledAt: string | null;
}

export interface RedeemResult {
  accessKey: string;
  expiresAt: number | null;
  extended: boolean;
  days?: number;
  alreadyRedeemed?: boolean;
}

/** Erreur d'API avec le code machine renvoyé par le serveur (INVALID_CODE, ACCOUNT_TOO_OLD…). */
export class ReferralError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'ReferralError';
    this.code = code;
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Code en attente : lien ?ref= ou champ du menu de connexion, gardé jusqu'à
// ce qu'un compte soit connecté. Expire au bout de 30 jours.
// ---------------------------------------------------------------------------

const PENDING_CODE_KEY = 'movix_referral_code';
const PENDING_CODE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;

/** Même règle que le serveur : minuscules, espaces et tirets acceptés, ou lien collé. */
export function normalizeReferralCode(input: string): string | null {
  let value = String(input || '').trim();
  if (!value || value.length > 300) return null;
  const fromLink = /[?&#]ref=([^&#\s]+)/i.exec(value);
  if (fromLink) {
    try {
      value = decodeURIComponent(fromLink[1]);
    } catch {
      return null;
    }
  }
  const cleaned = value.toUpperCase().replace(/[\s-]+/g, '');
  return CODE_PATTERN.test(cleaned) ? cleaned : null;
}

/** `link` : venu d'un lien ?ref= ; `field` : tapé par la personne. */
export type PendingCodeSource = 'link' | 'field';

export interface PendingReferralCode {
  code: string;
  source: PendingCodeSource;
}

export function getPendingReferralCode(): PendingReferralCode | null {
  try {
    const raw = localStorage.getItem(PENDING_CODE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { code?: string; savedAt?: number; source?: string };
    if (!parsed?.code || typeof parsed.savedAt !== 'number' || Date.now() - parsed.savedAt > PENDING_CODE_TTL_MS) {
      localStorage.removeItem(PENDING_CODE_KEY);
      return null;
    }
    const code = normalizeReferralCode(parsed.code);
    return code ? { code, source: parsed.source === 'link' ? 'link' : 'field' } : null;
  } catch {
    return null;
  }
}

/** Garde le code (valide) ; une valeur vide ou invalide efface le code en attente. */
export function setPendingReferralCode(input: string, source: PendingCodeSource = 'field'): string | null {
  const code = normalizeReferralCode(input);
  try {
    if (code) {
      localStorage.setItem(PENDING_CODE_KEY, JSON.stringify({ code, savedAt: Date.now(), source }));
    } else {
      localStorage.removeItem(PENDING_CODE_KEY);
    }
    window.dispatchEvent(new Event('referral-code-changed'));
  } catch {
    // Stockage fermé : le code reste à entrer sur la page profil.
  }
  return code;
}

export function clearPendingReferralCode(): void {
  try {
    localStorage.removeItem(PENDING_CODE_KEY);
  } catch {
    // Rien à faire.
  }
}

/**
 * Lit `?ref=CODE` dans l'adresse, le garde et le retire de la barre
 * d'adresse (le lien reste propre si on le partage à nouveau).
 */
export function captureReferralCodeFromUrl(): string | null {
  try {
    const url = new URL(window.location.href);
    const raw = url.searchParams.get('ref');
    if (!raw) return null;
    const code = setPendingReferralCode(raw, 'link');
    url.searchParams.delete('ref');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    return code;
  } catch {
    return null;
  }
}

/**
 * Même règle que le Wrapped (hooks/useWrappedTracker.ts), qui fournit le
 * temps de visionnage du parrainage : la collecte est permise sauf si le
 * réglage « Collecte de données » vaut 'false', et refusée si le stockage est
 * illisible. Coupée → le Wrapped n'envoie rien, le filleul n'avance pas.
 */
export function isDataCollectionAllowed(): boolean {
  try {
    return localStorage.getItem('privacy_data_collection') !== 'false';
  } catch {
    return false;
  }
}

export function buildReferralLink(code: string): string {
  return `${window.location.origin}/?ref=${encodeURIComponent(code)}`;
}

// ---------------------------------------------------------------------------
// Appels HTTP
// ---------------------------------------------------------------------------

function readAuthToken(): string | null {
  try {
    return localStorage.getItem('auth_token');
  } catch {
    return null;
  }
}

export function hasAccountSession(): boolean {
  return Boolean(readAuthToken());
}

function readClientId(): string | null {
  try {
    return getSessionClientId();
  } catch {
    return null;
  }
}

async function requestJson<T>(path: string, init: RequestInit = {}, { auth = true } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (auth) {
    const token = readAuthToken();
    if (!token) throw new ReferralError('Connexion requise', 'UNAUTHORIZED', 401);
    headers.set('Authorization', `Bearer ${token}`);
    const clientId = readClientId();
    if (clientId) headers.set('X-Movix-Client-Id', clientId);
  }
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${MAIN_API}${path}`, { ...init, headers });
  let data: Record<string, unknown> = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok || data.success === false) {
    throw new ReferralError(
      typeof data.error === 'string' ? data.error : 'Erreur du parrainage',
      typeof data.code === 'string' ? data.code : 'SERVER_ERROR',
      response.status
    );
  }
  return data as T;
}

export interface ReferralPublicConfig {
  enabled: boolean;
  rewardDays: number;
  requiredMinutes: number;
  requiredDays: number;
}

let configRequest: Promise<ReferralPublicConfig> | null = null;

/** Config publique, demandée une fois par chargement de page. */
export function getReferralConfig(): Promise<ReferralPublicConfig> {
  if (!configRequest) {
    configRequest = requestJson<Partial<ReferralPublicConfig>>('/api/referral/config', {}, { auth: false })
      .then((data) => ({
        enabled: data.enabled === true,
        rewardDays: Number(data.rewardDays) || 2,
        requiredMinutes: Number(data.requiredMinutes) || 60,
        requiredDays: Number(data.requiredDays) || 2
      }))
      .catch(() => {
        configRequest = null;
        return { enabled: false, rewardDays: 2, requiredMinutes: 60, requiredDays: 2 };
      });
  }
  return configRequest;
}

/** « 1 h », « 1 h 30 », « 45 min ». */
export function formatWatchDuration(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  if (safe < 60) return `${safe} min`;
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  return rest ? `${hours} h ${String(rest).padStart(2, '0')}` : `${hours} h`;
}

export async function getReferralMe(): Promise<ReferralMe> {
  return requestJson<ReferralMe>('/api/referral/me');
}

export async function claimReferralCode(code: string): Promise<{ referrerName: string | null; rewardDays: number; requiredMinutes: number; requiredDays: number }> {
  return requestJson('/api/referral/claim', { method: 'POST', body: JSON.stringify({ code }) });
}

/** Ajoute les jours à la clé VIP de ce profil (envoyée en en-tête) ou en crée une. */
export async function redeemReferralReward(rewardId: number): Promise<RedeemResult> {
  const accessKey = getAccessKey();
  return requestJson<RedeemResult>(`/api/referral/rewards/${rewardId}/redeem`, {
    method: 'POST',
    body: '{}',
    headers: accessKey ? { 'x-access-key': accessKey } : undefined
  });
}

export async function getAdminReferral(): Promise<ReferralAdminPayload> {
  return requestJson<ReferralAdminPayload>('/api/admin/referral');
}

export async function updateAdminReferral(settings: ReferralSettings): Promise<ReferralAdminPayload> {
  return requestJson<ReferralAdminPayload>('/api/admin/referral', {
    method: 'PUT',
    body: JSON.stringify({ settings })
  });
}

export async function listAdminReferrals(status: ReferralStatus | 'all' = 'all'): Promise<ReferralAdminItem[]> {
  const query = status === 'all' ? '' : `?status=${status}`;
  const data = await requestJson<{ items?: ReferralAdminItem[] }>(`/api/admin/referral/list${query}`);
  return Array.isArray(data.items) ? data.items : [];
}

export async function cancelAdminReferral(id: number): Promise<void> {
  await requestJson(`/api/admin/referral/${id}/cancel`, { method: 'POST', body: '{}' });
}
