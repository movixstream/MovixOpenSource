import type { TFunction } from 'i18next';
import { checkVipStatus } from '@/utils/vipUtils';
import { ReferralError, type RedeemResult } from '@/services/referralService';

// Erreurs dont le serveur donne la raison : on l'affiche dans la langue du site.
const KNOWN_ERROR_CODES = new Set([
  'INVALID_CODE',
  'CODE_NOT_FOUND',
  'OWN_CODE',
  'ALREADY_REFERRED',
  'ACCOUNT_TOO_OLD',
  'SAME_PLACE',
  'CIRCULAR',
  'REFERRER_TOO_NEW',
  'CLIENT_REQUIRED',
  'DEVICE_ALREADY_USED',
  'IP_LIMIT',
  'REFERRAL_DISABLED',
  'RATE_LIMITED'
]);

// Refus définitifs : garder le code en attente ne servirait à rien.
export const FINAL_CLAIM_ERRORS = new Set([
  'INVALID_CODE',
  'CODE_NOT_FOUND',
  'OWN_CODE',
  'ALREADY_REFERRED',
  'ACCOUNT_TOO_OLD',
  'SAME_PLACE',
  'CIRCULAR',
  'REFERRER_TOO_NEW',
  'DEVICE_ALREADY_USED',
  'IP_LIMIT',
  'REFERRAL_DISABLED'
]);

/** « 1 jour », « 2 jours » (accord fait par i18next). */
export function formatDays(t: TFunction, count: number): string {
  return t('referral.units.days', { count });
}

/** « 1 jour », « 2 jours différents » : jours de visionnage demandés. */
export function formatDistinctDays(t: TFunction, count: number): string {
  return t('referral.units.distinctDays', { count });
}

export function describeReferralError(t: TFunction, error: unknown): string {
  if (error instanceof ReferralError && KNOWN_ERROR_CODES.has(error.code)) {
    return t(`referral.errors.${error.code}`);
  }
  return t('referral.errors.default');
}

/**
 * Range la clé VIP renvoyée par le serveur dans le profil ouvert (mêmes clés
 * que la saisie d'un code VIP, synchronisées par /api/sync), puis prévient le
 * reste du site.
 */
export function applyRedeemedKey(result: RedeemResult): void {
  try {
    localStorage.setItem('access_code', result.accessKey);
    const expires = result.expiresAt === null ? null : new Date(result.expiresAt);
    localStorage.setItem(
      'access_code_expires',
      expires && !Number.isNaN(expires.getTime()) ? expires.toISOString() : 'never'
    );
    localStorage.setItem('is_vip', 'true');
  } catch {
    return;
  }
  window.dispatchEvent(new Event('storage'));
  window.dispatchEvent(new CustomEvent('vipStatusChanged', { detail: { vip: true } }));
  checkVipStatus(true).catch(() => { /* Vérifié à nouveau au prochain cycle. */ });
}

/** Demande au gestionnaire global de relire le parrainage (après une saisie de code). */
export function requestReferralRefresh(): void {
  window.dispatchEvent(new Event('referral-refresh'));
}
