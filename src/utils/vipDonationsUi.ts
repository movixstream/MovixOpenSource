import type { TFunction } from 'i18next';

import type {
  VipCoin,
  VipDonationContacts,
  VipGiftCardId,
  VipInvoiceStatus,
  VipPaymentMethod
} from '../services/vipDonationsService';

export { TURNSTILE_SITE_KEY } from './turnstileKeys';
export type VipDisplayedPaymentMethod = VipPaymentMethod;

// Même calcul que le serveur : `eurosPerVipYear` € = 12 mois, arrondi au mois
// supérieur (7 € à 5 €/an = 17 mois).
export function getVipMonthsForAmount(amountEur: number, eurosPerVipYear: number): number {
  if (!Number.isFinite(amountEur) || !Number.isFinite(eurosPerVipYear) || amountEur <= 0 || eurosPerVipYear <= 0) {
    return 0;
  }
  return Math.ceil((amountEur * 12) / eurosPerVipYear - 1e-9);
}

export const VIP_GIFT_CARD_NAMES: Record<VipGiftCardId, string> = {
  google_play: 'Google Play',
  amazon: 'Amazon',
  paysafecard: 'Paysafecard',
  eneba: 'Eneba'
};

export interface VipDonationContactLinks {
  email: string | null;
  discord: string | null;
  telegram: string | null;
  matrixUser: string | null;
  matrixRoom: string | null;
}

export function getVipDonationContactLinks(contacts: VipDonationContacts): VipDonationContactLinks {
  const telegram = contacts.telegramUsername.trim().replace(/^@/, '');
  const matrixUser = contacts.matrixUserId.trim();

  return {
    email: contacts.email.trim() ? `mailto:${contacts.email.trim()}` : null,
    discord: contacts.discordUrl.trim() || null,
    telegram: telegram ? `https://t.me/${encodeURIComponent(telegram)}` : null,
    matrixUser: matrixUser
      ? `https://matrix.to/#/${matrixUser.startsWith('@') ? matrixUser : `@${matrixUser}`}`
      : null,
    matrixRoom: contacts.matrixRoomUrl.trim() || null
  };
}

export function getVipDurationLabel(
  t: TFunction,
  vipYears: number,
  variant: 'plain' | 'vip' = 'plain'
) {
  const safeYears = Number.isFinite(vipYears) && vipYears > 0 ? vipYears : 1;
  const totalMonths = Math.max(1, Math.round(safeYears * 12));

  if (totalMonths % 12 !== 0) {
    if (variant === 'vip') {
      return totalMonths === 1
        ? t('vipDonations.common.oneVipMonth')
        : t('vipDonations.common.manyVipMonths', { count: totalMonths });
    }

    return totalMonths === 1
      ? t('vipDonations.common.oneMonth')
      : t('vipDonations.common.manyMonths', { count: totalMonths });
  }

  const totalYears = totalMonths / 12;

  if (variant === 'vip') {
    return totalYears === 1
      ? t('vipDonations.common.oneVipYear')
      : t('vipDonations.common.manyVipYears', { count: totalYears });
  }

  return totalYears === 1
    ? t('vipDonations.common.oneYear')
    : t('vipDonations.common.manyYears', { count: totalYears });
}

export function getVipStatusMeta(t: TFunction, status: VipInvoiceStatus) {
  const prefix = `vipDonations.status.${status}`;

  return {
    label: t(`${prefix}.label`),
    hint: t(`${prefix}.hint`)
  };
}

export function getVipPaymentLabel(
  t: TFunction,
  paymentMethod: VipDisplayedPaymentMethod | null | undefined,
  coin: VipCoin | null | undefined = null
) {
  if (paymentMethod === 'cryptogate') {
    return t('vipDonations.payment.cryptogate');
  }
  if (paymentMethod === 'payblis') {
    return t('vipDonations.payment.payblis');
  }
  if (paymentMethod === 'paygate_hosted') {
    return t('vipDonations.payment.paygateHosted');
  }

  const effectiveCoin = coin || paymentMethod;
  if (effectiveCoin === 'ltc') {
    return t('vipDonations.payment.ltc');
  }

  if (effectiveCoin === 'btc') {
    return t('vipDonations.payment.btc');
  }

  return t('common.unknown');
}

export function getVipPaymentShortLabel(
  t: TFunction,
  paymentMethod: VipDisplayedPaymentMethod | null | undefined,
  coin: VipCoin | null | undefined = null
) {
  if (paymentMethod === 'cryptogate') {
    return t('vipDonations.payment.cryptogateShort');
  }
  if (paymentMethod === 'payblis') {
    return t('vipDonations.payment.payblisShort');
  }
  if (paymentMethod === 'paygate_hosted') {
    return t('vipDonations.payment.paygateShort');
  }

  const effectiveCoin = coin || paymentMethod;
  return typeof effectiveCoin === 'string'
    ? effectiveCoin.toUpperCase()
    : t('common.unknown');
}

export function formatVipFiat(locale: string, amount: number, currency: 'EUR' | 'USD') {
  const safeAmount = Number.isFinite(amount) ? amount : 0;

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(safeAmount);
}

export function formatVipCrypto(locale: string, amount: number) {
  const safeAmount = Number.isFinite(amount) ? amount : 0;

  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8
  }).format(safeAmount);
}

export function formatVipDateTime(locale: string, value: string | null) {
  if (!value) {
    return '-';
  }

  return new Date(value).toLocaleString(locale, {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}
