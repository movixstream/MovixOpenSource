import type { TFunction } from 'i18next';

import type {
  VipDonationAvailability,
  VipDonationContacts,
  VipDonationMethodId,
  VipDonationSettings
} from '@/services/vipDonationsService';
import {
  getVipDonationContactLinks,
  getVipDurationLabel,
  getVipMonthsForAmount
} from '@/utils/vipDonationsUi';

// Ordre d'affichage de la page de don, indépendant de l'ordre des réglages.
export const DONATION_METHOD_ORDER: readonly VipDonationMethodId[] = ['giftcard', 'cryptogate', 'btc', 'ltc'];

// Repli quand les réglages ne répondent pas : tout est proposé, le serveur
// refusera lui-même ce qu'il ne sait pas faire.
export const ALL_DONATION_METHODS_AVAILABLE: VipDonationAvailability = {
  cryptogate: true,
  giftcard: true,
  btc: true,
  ltc: true
};

export function getVisibleDonationMethods(
  settings: VipDonationSettings,
  availability: VipDonationAvailability
): VipDonationMethodId[] {
  return DONATION_METHOD_ORDER.filter((id) => settings.methods[id]?.enabled && availability[id]);
}

// Montants proposés, sans doublon (ils servent de clés React).
export function getDonationSuggestions(settings: VipDonationSettings): number[] {
  return Array.from(new Set(
    settings.suggestedAmounts.filter((amount) => Number.isFinite(amount) && amount > 0)
  ));
}

export function getInitialAmountState(
  settings: VipDonationSettings,
  suggestions: number[]
): { preset: number | null; custom: string } {
  const preferred = settings.defaultAmountEur;
  if (suggestions.includes(preferred)) {
    return { preset: preferred, custom: '' };
  }
  if (settings.freeAmountEnabled && Number.isFinite(preferred) && preferred > 0) {
    return { preset: null, custom: String(Math.round(preferred)) };
  }
  return { preset: suggestions[0] ?? null, custom: '' };
}

// Euros entiers sans centimes (« 10 € »), centimes seulement s'il y en a.
export function formatDonationAmount(locale: string, amount: number): string {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  const digits = Number.isInteger(safeAmount) ? 0 : 2;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    }).format(safeAmount);
  } catch {
    return `${safeAmount} €`;
  }
}

// Place du symbole € dans la langue courante (« 15 € » en français, « €15 » en
// anglais), pour l'afficher du bon côté du champ « Autre montant ».
export function getEuroAffix(locale: string): { symbol: string; before: boolean } {
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0
    }).formatToParts(1);
    const currencyIndex = parts.findIndex((part) => part.type === 'currency');
    const integerIndex = parts.findIndex((part) => part.type === 'integer');
    return {
      symbol: parts[currencyIndex]?.value || '€',
      before: currencyIndex !== -1 && currencyIndex < integerIndex
    };
  } catch {
    return { symbol: '€', before: false };
  }
}

// Durée offerte en remerciement (« 2 ans », « 17 mois »), ou null quand le
// montant ne donne aucun mois.
export function getVipDurationForAmount(t: TFunction, amountEur: number, eurosPerVipYear: number): string | null {
  const months = getVipMonthsForAmount(amountEur, eurosPerVipYear);
  return months > 0 ? getVipDurationLabel(t, months / 12, 'plain') : null;
}

// Règle affichée dans la pastille (« 5 € = 1 an de VIP »). Un tarif annuel en
// euros entiers donne une année ; sinon on part du don minimum, quitte à
// parler en mois.
export function getDonationRule(t: TFunction, locale: string, settings: VipDonationSettings): string | null {
  const rate = settings.eurosPerVipYear;
  if (!Number.isFinite(rate) || rate <= 0) {
    return null;
  }

  let amount = Number.isInteger(rate) ? rate : Math.max(1, Math.ceil(settings.minAmountEur));
  let months = getVipMonthsForAmount(amount, rate);
  if (months <= 0) {
    amount = rate;
    months = 12;
  }

  return t('vipDonations.donate.rule', {
    amount: formatDonationAmount(locale, amount),
    duration: getVipDurationLabel(t, months / 12, 'plain')
  });
}

export const isValidDonationEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

// Les liens viennent des réglages admin : seuls les liens web sont ouverts.
export const isSafeExternalUrl = (value: string | null | undefined): value is string => (
  typeof value === 'string' && /^https?:\/\/\S+$/i.test(value.trim())
);

// « https://matrix.to/#/%23groupe-ix:matrix.org » → « #groupe-ix:matrix.org ».
function getMatrixRoomLabel(value: string): string {
  const match = value.match(/matrix\.to\/#\/(.+)$/i);
  if (!match) {
    return value.replace(/^https?:\/\//i, '');
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function buildMailtoHref(mailto: string, subject: string, body: string): string {
  // RFC 6068 : les retours à la ligne du corps s'écrivent %0D%0A.
  const normalizedBody = body.replace(/\r?\n/g, '\r\n');
  return `${mailto}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(normalizedBody)}`;
}

export type DonationContactId = 'email' | 'discord' | 'telegram' | 'matrixUser' | 'matrixRoom';

export interface DonationContact {
  id: DonationContactId;
  // Ce qui est affiché et copié (adresse, pseudo, salon).
  value: string;
  href: string | null;
}

export function getDonationContacts(
  contacts: VipDonationContacts,
  mail: { subject: string; body: string }
): DonationContact[] {
  const links = getVipDonationContactLinks(contacts);
  const list: DonationContact[] = [];

  const email = contacts.email.trim();
  if (email && links.email) {
    list.push({ id: 'email', value: email, href: buildMailtoHref(links.email, mail.subject, mail.body) });
  }

  const discordHref = isSafeExternalUrl(links.discord) ? links.discord.trim() : null;
  const discordValue = contacts.discordUsername.trim() || discordHref;
  if (discordValue) {
    list.push({ id: 'discord', value: discordValue, href: discordHref });
  }

  const telegram = contacts.telegramUsername.trim().replace(/^@/, '');
  if (telegram) {
    list.push({ id: 'telegram', value: `@${telegram}`, href: links.telegram });
  }

  const matrixUser = contacts.matrixUserId.trim();
  if (matrixUser) {
    list.push({
      id: 'matrixUser',
      value: matrixUser.startsWith('@') ? matrixUser : `@${matrixUser}`,
      href: links.matrixUser
    });
  }

  const matrixRoom = contacts.matrixRoomUrl.trim();
  if (matrixRoom) {
    list.push({
      id: 'matrixRoom',
      value: getMatrixRoomLabel(matrixRoom),
      href: isSafeExternalUrl(matrixRoom) ? matrixRoom : null
    });
  }

  return list;
}

type LenisLike = {
  scrollTo: (target: number, options?: { immediate?: boolean; duration?: number }) => void;
};

// Hauteur de l'en-tête fixe du site (64 px) plus une petite marge.
const DONATION_SCROLL_OFFSET_PX = 88;

export function scrollToDonationCard(element: HTMLElement | null, smooth: boolean) {
  if (!element || typeof window === 'undefined') {
    return;
  }

  const { top } = element.getBoundingClientRect();
  // Déjà bien en vue (sur ordinateur, la carte est en haut de page) : on ne
  // fait pas bouger la page pour rien.
  if (top >= DONATION_SCROLL_OFFSET_PX - 16 && top <= window.innerHeight * 0.45) {
    return;
  }

  const target = Math.max(0, window.scrollY + top - DONATION_SCROLL_OFFSET_PX);
  // Lenis pilote le défilement quand il est actif : passer par lui évite
  // qu'il ne ramène la page à sa propre position.
  const lenis = (window as unknown as { lenis?: LenisLike }).lenis;
  if (lenis && typeof lenis.scrollTo === 'function') {
    lenis.scrollTo(target, { immediate: !smooth, duration: 0.7 });
    return;
  }

  window.scrollTo({ top: target, behavior: smooth ? 'smooth' : 'auto' });
}
