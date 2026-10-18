import type { TFunction } from 'i18next';

import {
  VIP_DONATION_METHOD_IDS,
  VIP_GIFT_CARD_IDS,
  type VipDonationAvailability,
  type VipDonationContacts,
  type VipDonationMethodId,
  type VipDonationSettings,
  type VipGiftCardId
} from '../../services/vipDonationsService';
import { getVipMonthsForAmount } from '../../utils/vipDonationsUi';

// Mêmes limites que la validation du serveur : l'interface les applique pour
// un retour immédiat, le serveur revalide de toute façon à l'enregistrement.
export const VIP_SETTINGS_AMOUNT_LIMIT = 1000;
export const VIP_SETTINGS_SUGGESTED_LIMIT = 6;
export const VIP_SETTINGS_CONTACT_MAX_LENGTH = 200;
export const VIP_SETTINGS_PAUSED_MESSAGE_MAX_LENGTH = 500;

export const VIP_CONTACT_FIELDS: readonly (keyof VipDonationContacts)[] = [
  'email',
  'discordUsername',
  'discordUrl',
  'telegramUsername',
  'matrixUserId',
  'matrixRoomUrl'
];

export type VipSettingsFieldKey =
  | 'pausedMessage'
  | 'eurosPerVipYear'
  | 'minAmountEur'
  | 'maxAmountEur'
  | 'suggestedAmounts'
  | 'defaultAmountEur'
  | `giftCards.${VipGiftCardId}`
  | `contacts.${keyof VipDonationContacts}`;

export type VipSettingsIssueCode =
  | 'integerRequired'
  | 'amountRange'
  | 'maxBelowMin'
  | 'minBelowOneMonth'
  | 'suggestedEmpty'
  | 'suggestedTooMany'
  | 'suggestedInvalid'
  | 'suggestedDuplicate'
  | 'suggestedOutOfRange'
  | 'defaultOutOfRange'
  | 'defaultNotSuggested'
  | 'tooLong'
  | 'invalidUrl'
  | 'invalidEmail';

export interface VipSettingsIssue {
  code: VipSettingsIssueCode;
  params?: Record<string, number>;
}

export type VipSettingsErrors = Partial<Record<VipSettingsFieldKey, VipSettingsIssue>>;

export type VipSettingsSectionId =
  | 'status'
  | 'rate'
  | 'amounts'
  | 'methods'
  | 'giftOption'
  | 'giftCards'
  | 'contacts';

export const giftCardFieldKey = (id: VipGiftCardId): VipSettingsFieldKey => `giftCards.${id}`;
export const contactFieldKey = (field: keyof VipDonationContacts): VipSettingsFieldKey => `contacts.${field}`;

const mapMethodIds = <T,>(build: (id: VipDonationMethodId) => T): Record<VipDonationMethodId, T> => (
  Object.fromEntries(VIP_DONATION_METHOD_IDS.map((id) => [id, build(id)])) as Record<VipDonationMethodId, T>
);

const mapGiftCardIds = <T,>(build: (id: VipGiftCardId) => T): Record<VipGiftCardId, T> => (
  Object.fromEntries(VIP_GIFT_CARD_IDS.map((id) => [id, build(id)])) as Record<VipGiftCardId, T>
);

export function cloneVipDonationSettings(settings: VipDonationSettings): VipDonationSettings {
  return {
    ...settings,
    suggestedAmounts: [...settings.suggestedAmounts],
    methods: mapMethodIds((id) => ({ ...settings.methods[id] })),
    giftCards: mapGiftCardIds((id) => ({ ...settings.giftCards[id] })),
    contacts: { ...settings.contacts }
  };
}

// Version envoyée au serveur : textes sans espaces superflus, montants triés.
export function normalizeVipSettingsForSave(settings: VipDonationSettings): VipDonationSettings {
  const { contacts } = settings;

  return {
    ...cloneVipDonationSettings(settings),
    pausedMessage: settings.pausedMessage.trim(),
    suggestedAmounts: [...settings.suggestedAmounts].sort((a, b) => a - b),
    giftCards: mapGiftCardIds((id) => ({ ...settings.giftCards[id], url: settings.giftCards[id].url.trim() })),
    contacts: {
      email: contacts.email.trim(),
      discordUsername: contacts.discordUsername.trim(),
      discordUrl: contacts.discordUrl.trim(),
      telegramUsername: contacts.telegramUsername.trim(),
      matrixUserId: contacts.matrixUserId.trim(),
      matrixRoomUrl: contacts.matrixRoomUrl.trim()
    }
  };
}

// Champ vide ou mal formé : NaN, que la validation signale comme « nombre entier ».
export function parseIntegerInput(raw: string): number {
  const trimmed = raw.trim();
  return /^\d{1,7}$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

// Montant d'une carte cadeau : accepte « 20 », « 12,50 », « 12.5 » ou « 20 € ».
// `\s` couvre aussi les espaces insécables d'un montant formaté collé tel quel.
export function parseEuroAmountInput(raw: string): number {
  const normalized = raw.replace(/[\s€]/g, '').replace(',', '.');
  return /^\d{1,7}(\.\d{1,2})?$/.test(normalized) ? Number(normalized) : Number.NaN;
}

export function isHttpUrl(value: string): boolean {
  if (!/^https?:\/\/\S+$/i.test(value)) {
    return false;
  }

  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0;
  } catch {
    return false;
  }
}

export function isValidEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// Fourchette [min, max] exploitable, ou null tant que min/max sont invalides.
export function getVipAmountRange(settings: VipDonationSettings): { min: number; max: number } | null {
  const { minAmountEur: min, maxAmountEur: max } = settings;
  const isBoundedAmount = (value: number) => Number.isInteger(value) && value >= 1 && value <= VIP_SETTINGS_AMOUNT_LIMIT;

  return isBoundedAmount(min) && isBoundedAmount(max) && min <= max ? { min, max } : null;
}

// Plus petit montant entier qui offre au moins un mois de VIP à ce tarif.
export function getMinimumAmountForOneMonth(eurosPerVipYear: number): number {
  let amount = Math.max(1, Math.ceil(eurosPerVipYear / 12));
  while (getVipMonthsForAmount(amount, eurosPerVipYear) < 1 && amount < VIP_SETTINGS_AMOUNT_LIMIT * 12) {
    amount += 1;
  }
  return amount;
}

const checkBoundedInteger = (value: number): VipSettingsIssue | null => {
  if (!Number.isInteger(value)) {
    return { code: 'integerRequired' };
  }
  if (value < 1 || value > VIP_SETTINGS_AMOUNT_LIMIT) {
    return { code: 'amountRange', params: { min: 1, max: VIP_SETTINGS_AMOUNT_LIMIT } };
  }
  return null;
};

// Reprend les règles du serveur. À appeler sur la version normalisée.
export function validateVipDonationSettings(settings: VipDonationSettings): VipSettingsErrors {
  const errors: VipSettingsErrors = {};
  const {
    minAmountEur: min,
    maxAmountEur: max,
    eurosPerVipYear: rate,
    suggestedAmounts,
    defaultAmountEur
  } = settings;

  const minIssue = checkBoundedInteger(min);
  const maxIssue = checkBoundedInteger(max);
  const rateIssue = checkBoundedInteger(rate);

  if (minIssue) {
    errors.minAmountEur = minIssue;
  }
  if (maxIssue) {
    errors.maxAmountEur = maxIssue;
  } else if (!minIssue && max < min) {
    errors.maxAmountEur = { code: 'maxBelowMin', params: { min } };
  }
  if (rateIssue) {
    errors.eurosPerVipYear = rateIssue;
  }
  if (!minIssue && !rateIssue && getVipMonthsForAmount(min, rate) < 1) {
    errors.minAmountEur = { code: 'minBelowOneMonth', params: { needed: getMinimumAmountForOneMonth(rate) } };
  }

  const range = getVipAmountRange(settings);

  if (suggestedAmounts.length === 0) {
    errors.suggestedAmounts = { code: 'suggestedEmpty' };
  } else if (suggestedAmounts.length > VIP_SETTINGS_SUGGESTED_LIMIT) {
    errors.suggestedAmounts = { code: 'suggestedTooMany', params: { limit: VIP_SETTINGS_SUGGESTED_LIMIT } };
  } else if (suggestedAmounts.some((amount) => checkBoundedInteger(amount) !== null)) {
    errors.suggestedAmounts = { code: 'suggestedInvalid', params: { min: 1, max: VIP_SETTINGS_AMOUNT_LIMIT } };
  } else if (new Set(suggestedAmounts).size !== suggestedAmounts.length) {
    errors.suggestedAmounts = { code: 'suggestedDuplicate' };
  } else if (range && suggestedAmounts.some((amount) => amount < range.min || amount > range.max)) {
    errors.suggestedAmounts = { code: 'suggestedOutOfRange', params: { min: range.min, max: range.max } };
  }

  const defaultIssue = checkBoundedInteger(defaultAmountEur);
  if (defaultIssue) {
    errors.defaultAmountEur = defaultIssue;
  } else if (range && (defaultAmountEur < range.min || defaultAmountEur > range.max)) {
    errors.defaultAmountEur = { code: 'defaultOutOfRange', params: { min: range.min, max: range.max } };
  } else if (!settings.freeAmountEnabled && !suggestedAmounts.includes(defaultAmountEur)) {
    errors.defaultAmountEur = { code: 'defaultNotSuggested' };
  }

  if (settings.pausedMessage.length > VIP_SETTINGS_PAUSED_MESSAGE_MAX_LENGTH) {
    errors.pausedMessage = { code: 'tooLong', params: { limit: VIP_SETTINGS_PAUSED_MESSAGE_MAX_LENGTH } };
  }

  for (const id of VIP_GIFT_CARD_IDS) {
    const url = settings.giftCards[id].url;
    if (url && !isHttpUrl(url)) {
      errors[giftCardFieldKey(id)] = { code: 'invalidUrl' };
    }
  }

  for (const field of VIP_CONTACT_FIELDS) {
    const value = settings.contacts[field];
    if (value.length > VIP_SETTINGS_CONTACT_MAX_LENGTH) {
      errors[contactFieldKey(field)] = { code: 'tooLong', params: { limit: VIP_SETTINGS_CONTACT_MAX_LENGTH } };
    } else if (field === 'email' && value && !isValidEmailAddress(value)) {
      errors[contactFieldKey(field)] = { code: 'invalidEmail' };
    } else if ((field === 'discordUrl' || field === 'matrixRoomUrl') && value && !isHttpUrl(value)) {
      errors[contactFieldKey(field)] = { code: 'invalidUrl' };
    }
  }

  return errors;
}

// Paramètres exprimés en euros : formatés selon la langue avant l'affichage.
const AMOUNT_PARAMS = new Set(['min', 'max', 'needed']);

export function formatVipSettingsIssue(t: TFunction, locale: string, issue: VipSettingsIssue | undefined): string | null {
  if (!issue) {
    return null;
  }

  const params = Object.fromEntries(
    Object.entries(issue.params ?? {}).map(([name, value]) => [
      name,
      AMOUNT_PARAMS.has(name) ? formatEuroAmount(locale, value) : String(value)
    ])
  );

  return t(`vipDonations.settings.errors.${issue.code}`, params);
}

export function formatEuroAmount(locale: string, amount: number): string {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  const fractionDigits = Number.isInteger(safeAmount) ? 0 : 2;

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits
    }).format(safeAmount);
  } catch {
    return `${safeAmount.toFixed(fractionDigits)} €`;
  }
}

// Moyens réellement proposés aux donateurs : activés ici ET configurés côté serveur.
export function getVisibleVipMethods(
  settings: VipDonationSettings,
  availability: VipDonationAvailability
): VipDonationMethodId[] {
  return VIP_DONATION_METHOD_IDS.filter((id) => settings.methods[id].enabled && availability[id] !== false);
}

// Montants montrés dans l'aperçu du tarif : bornes, montants suggérés et présélection.
export function getVipPreviewAmounts(settings: VipDonationSettings): number[] {
  const candidates = [
    settings.minAmountEur,
    ...settings.suggestedAmounts,
    settings.defaultAmountEur,
    settings.maxAmountEur
  ];

  return Array.from(new Set(candidates.filter((amount) => checkBoundedInteger(amount) === null)))
    .sort((a, b) => a - b);
}

const SECTION_SNAPSHOTS: Record<VipSettingsSectionId, (settings: VipDonationSettings) => unknown> = {
  status: (settings) => [settings.donationsEnabled, settings.pausedMessage],
  rate: (settings) => settings.eurosPerVipYear,
  amounts: (settings) => [
    settings.freeAmountEnabled,
    settings.minAmountEur,
    settings.maxAmountEur,
    [...settings.suggestedAmounts].sort((a, b) => a - b),
    settings.defaultAmountEur
  ],
  methods: (settings) => [settings.defaultMethod, VIP_DONATION_METHOD_IDS.map((id) => settings.methods[id].enabled)],
  giftOption: (settings) => settings.giftOptionEnabled,
  giftCards: (settings) => VIP_GIFT_CARD_IDS.map((id) => [settings.giftCards[id].enabled, settings.giftCards[id].url]),
  contacts: (settings) => VIP_CONTACT_FIELDS.map((field) => settings.contacts[field])
};

const SECTION_IDS = Object.keys(SECTION_SNAPSHOTS) as VipSettingsSectionId[];

// Sections qui diffèrent entre deux réglages (NaN d'un champ vide compte comme un écart).
export function getChangedVipSettingsSections(
  current: VipDonationSettings,
  reference: VipDonationSettings
): VipSettingsSectionId[] {
  return SECTION_IDS.filter((section) => (
    JSON.stringify(SECTION_SNAPSHOTS[section](current)) !== JSON.stringify(SECTION_SNAPSHOTS[section](reference))
  ));
}

export function buildThankYouMailto(email: string, subject: string, body: string): string {
  // `@` reste lisible : certains clients mail ne décodent pas %40 dans le destinataire.
  const recipient = encodeURIComponent(email.trim()).replace(/%40/g, '@');
  const query = [
    `subject=${encodeURIComponent(subject)}`,
    `body=${encodeURIComponent(body.replace(/\r?\n/g, '\r\n'))}`
  ].join('&');

  return `mailto:${recipient}?${query}`;
}
