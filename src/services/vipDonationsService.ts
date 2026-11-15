import { MAIN_API } from '../config/runtime';

export type VipInvoiceStatus =
  | 'awaiting_payment'
  | 'partial_payment'
  | 'confirming'
  | 'paid'
  | 'delivered'
  | 'expired'
  | 'cancelled';

export type VipPaymentMethod = 'btc' | 'ltc' | 'cryptogate' | 'paygate_hosted' | 'payblis';
export type VipCoin = Extract<VipPaymentMethod, 'btc' | 'ltc'>;
export type VipRecipientMode = 'self' | 'gift';

export interface VipInvoice {
  publicId: string;
  status: VipInvoiceStatus;
  paymentMethod: VipPaymentMethod | null;
  coin: VipCoin | null;
  packEur: number;
  amountEur: number;
  amountUsd: number;
  amountCryptoExpected: number | null;
  amountCryptoReceived: number | null;
  vipYears: number;
  durationLabel: string;
  recipientMode: VipRecipientMode;
  paymentAddress: string | null;
  trackingAddress: string | null;
  checkoutUrl: string | null;
  addressType: string | null;
  confirmations: number | null;
  requiredConfirmations: number | null;
  expiresAt: string | null;
  paidAt: string | null;
  deliveredAt: string | null;
  createdAt: string | null;
  qrPayload: string | null;
  invoicePath: string;
  invoiceUrl: string;
  giftPath: string | null;
  giftUrl: string | null;
  vipKey: string | null;
  externalOrderId: string | null;
  externalGateway: string | null;
  externalAmount: number | null;
  externalCurrency: string | null;
  supportTelegramUrl: string;
}

export interface VipGift {
  giftToken: string;
  status: 'sealed' | 'unsealed';
  invoiceStatus: VipInvoiceStatus;
  vipYears: number;
  durationLabel: string;
  createdAt: string | null;
  unsealedAt: string | null;
  vipKey: string | null;
  supportTelegramUrl: string;
}

export interface VipAdminInvoice extends VipInvoice {
  id: number;
  derivationIndex: number | null;
  txHash: string | null;
  giftToken: string | null;
  giftSealed: boolean;
  giftUnsealedAt: string | null;
  giftUnsealCount: number;
  createdByUserId: string | null;
  createdByUserType: string | null;
  createdBySessionId: string | null;
  createdIpHash: string | null;
  payerEmail: string | null;
  temporaryWalletAddress: string | null;
  callbackUrl: string | null;
  paidCoin: string | null;
  paidValue: number | null;
  paidTxid: string | null;
  externalOrderId: string | null;
  externalProductId: string | null;
  externalGateway: string | null;
  externalCurrency: string | null;
  externalAmount: number | null;
  reason: string | null;
}

export interface VipInvoiceEvent {
  id: number;
  eventType: string;
  actorType: string | null;
  actorId: string | null;
  message: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string | null;
}

// Moyens proposés sur la page de don. `giftcard` ne crée pas d'invoice :
// le donateur envoie le code de sa carte et l'équipe répond avec une clé.
export type VipDonationMethodId = 'cryptogate' | 'giftcard' | 'btc' | 'ltc';
export type VipGiftCardId = 'google_play' | 'amazon' | 'paysafecard' | 'eneba';

export const VIP_DONATION_METHOD_IDS: readonly VipDonationMethodId[] = ['giftcard', 'cryptogate', 'btc', 'ltc'];
export const VIP_GIFT_CARD_IDS: readonly VipGiftCardId[] = ['google_play', 'amazon', 'paysafecard', 'eneba'];

export interface VipDonationContacts {
  email: string;
  discordUsername: string;
  discordUrl: string;
  telegramUsername: string;
  matrixUserId: string;
  matrixRoomUrl: string;
}

export interface VipDonationSettings {
  donationsEnabled: boolean;
  pausedMessage: string;
  giftOptionEnabled: boolean;
  freeAmountEnabled: boolean;
  minAmountEur: number;
  maxAmountEur: number;
  eurosPerVipYear: number;
  suggestedAmounts: number[];
  defaultAmountEur: number;
  defaultMethod: VipDonationMethodId;
  methods: Record<VipDonationMethodId, { enabled: boolean }>;
  giftCards: Record<VipGiftCardId, { enabled: boolean; url: string }>;
  contacts: VipDonationContacts;
}

// Ce que le serveur sait faire, indépendamment des réglages admin
// (ex. CryptoGate sans clé API configurée).
export type VipDonationAvailability = Record<VipDonationMethodId, boolean>;

export interface VipDonationSettingsPayload {
  settings: VipDonationSettings;
  availability: VipDonationAvailability;
  updatedAt: string | null;
  updatedBy: string | null;
}

// Copie des valeurs par défaut du serveur : sert seulement si l'API ne répond
// pas, pour que le don par carte cadeau reste possible.
export const DEFAULT_VIP_DONATION_SETTINGS: VipDonationSettings = {
  donationsEnabled: true,
  pausedMessage: '',
  giftOptionEnabled: true,
  freeAmountEnabled: true,
  minAmountEur: 5,
  maxAmountEur: 500,
  eurosPerVipYear: 5,
  suggestedAmounts: [5, 10, 20],
  defaultAmountEur: 5,
  defaultMethod: 'cryptogate',
  methods: {
    cryptogate: { enabled: true },
    giftcard: { enabled: true },
    btc: { enabled: true },
    ltc: { enabled: true }
  },
  // Amazon.fr ne vend ni Paysafecard ni Eneba : liens officiels pour ces deux-là.
  giftCards: {
    google_play: { enabled: true, url: 'https://www.amazon.fr/dp/B0FTV4P7FZ' },
    amazon: { enabled: true, url: 'https://www.amazon.fr/dp/B07S2GM42J' },
    paysafecard: { enabled: true, url: 'https://www.paysafecard.com/fr-fr/trouver-un-point-de-vente/' },
    eneba: { enabled: true, url: 'https://www.eneba.com/fr/store/eneba-gift-cards' }
  },
  contacts: {
    email: 'movixstreaming@gmail.com',
    discordUsername: 'mysticsaba_alt',
    discordUrl: 'https://discord.com/users/1516102413835305021',
    telegramUsername: 'MysticSaba',
    matrixUserId: '@mysticsaba:matrix.org',
    matrixRoomUrl: 'https://matrix.to/#/%23groupe-ix:matrix.org'
  }
};

const DEFAULT_VIP_DONATION_AVAILABILITY: VipDonationAvailability = {
  cryptogate: true,
  giftcard: true,
  btc: true,
  ltc: true
};

interface JsonResponse<T> {
  success: boolean;
  error?: string;
  invoice?: T;
  gift?: T;
  invoices?: T[];
}

const getAuthToken = () => localStorage.getItem('auth_token');

type ApiError = Error & {
  statusCode?: number;
};

function normalizeVipCoin(value: unknown): VipCoin | null {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return normalized === 'btc' || normalized === 'ltc' ? normalized : null;
}

function normalizeVipPaymentMethod(value: unknown, fallbackCoin: unknown = null): VipPaymentMethod | null {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (
    normalized === 'btc'
    || normalized === 'ltc'
    || normalized === 'cryptogate'
    || normalized === 'paygate_hosted'
    || normalized === 'payblis'
  ) {
    return normalized;
  }

  return normalizeVipCoin(fallbackCoin);
}

function normalizeVipInvoice<T extends VipInvoice>(invoice: T): T {
  const normalizedCoin = normalizeVipCoin(invoice.coin);

  return {
    ...invoice,
    paymentMethod: normalizeVipPaymentMethod(invoice.paymentMethod, normalizedCoin),
    coin: normalizedCoin
  } as T;
}

function mergeRequestHeaders(headers?: HeadersInit, options: { includeAuth?: boolean } = {}) {
  const mergedHeaders = new Headers(headers);
  const token = options.includeAuth ? getAuthToken() : null;

  if (token && !mergedHeaders.has('Authorization')) {
    mergedHeaders.set('Authorization', `Bearer ${token}`);
  }

  return mergedHeaders;
}

function createApiError(message: string, statusCode?: number): ApiError {
  const error = new Error(message) as ApiError;
  if (statusCode !== undefined) {
    error.statusCode = statusCode;
  }
  return error;
}

async function requestJson<T>(path: string, init?: RequestInit, options: { includeAuth?: boolean } = {}): Promise<T> {
  const response = await fetch(`${MAIN_API}${path}`, {
    ...init,
    headers: mergeRequestHeaders(init?.headers, options)
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error || 'Erreur réseau');
  }

  return data as T;
}

export async function createVipInvoice(
  amountEur: number,
  paymentMethod: VipPaymentMethod,
  recipientMode: VipRecipientMode,
  options: {
    payerEmail?: string;
    turnstileToken?: string;
  } = {}
): Promise<VipInvoice> {
  const token = getAuthToken();
  const data = await requestJson<JsonResponse<VipInvoice>>('/api/vip/invoices', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({
      amount_eur: amountEur,
      // Ancien nom du champ, gardé tant qu'un serveur sans montant libre peut répondre.
      pack_eur: amountEur,
      payment_method: paymentMethod,
      coin: paymentMethod === 'btc' || paymentMethod === 'ltc' ? paymentMethod : null,
      recipient_mode: recipientMode,
      payer_email: options.payerEmail || null,
      turnstileToken: options.turnstileToken
    })
  });

  if (!data.invoice) {
    throw new Error('Invoice invalide');
  }

  return normalizeVipInvoice(data.invoice);
}

export async function getVipInvoice(publicId: string): Promise<VipInvoice> {
  const data = await requestJson<JsonResponse<VipInvoice>>(
    `/api/vip/invoices/${encodeURIComponent(publicId)}`,
    undefined,
    { includeAuth: true }
  );
  if (!data.invoice) {
    throw createApiError('Invoice introuvable', 404);
  }
  return normalizeVipInvoice(data.invoice);
}

export async function listMyVipInvoices(limit = 30): Promise<VipInvoice[]> {
  const token = getAuthToken();
  if (!token) {
    return [];
  }

  const query = new URLSearchParams({
    limit: String(limit)
  });

  const data = await requestJson<JsonResponse<VipInvoice>>(
    `/api/vip/invoices/mine?${query.toString()}`,
    undefined,
    { includeAuth: true }
  );

  return Array.isArray(data.invoices)
    ? data.invoices.map((invoice) => normalizeVipInvoice(invoice))
    : [];
}

export async function checkVipInvoice(publicId: string): Promise<VipInvoice> {
  const response = await fetch(`${MAIN_API}/api/vip/invoices/${encodeURIComponent(publicId)}/check`, {
    method: 'POST',
    headers: mergeRequestHeaders(undefined, { includeAuth: true })
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok && !data?.invoice) {
    throw new Error(data?.error || 'Vérification indisponible');
  }

  if (!data.invoice) {
    throw createApiError('Invoice introuvable', 404);
  }

  return normalizeVipInvoice(data.invoice as VipInvoice);
}

export async function getVipGift(giftToken: string): Promise<VipGift> {
  const data = await requestJson<JsonResponse<VipGift>>(`/api/vip/gifts/${encodeURIComponent(giftToken)}`);
  if (!data.gift) {
    throw new Error('Cadeau introuvable');
  }
  return data.gift;
}

export async function unsealVipGift(giftToken: string, turnstileToken?: string): Promise<VipGift> {
  const data = await requestJson<JsonResponse<VipGift>>(`/api/vip/gifts/${encodeURIComponent(giftToken)}/unseal`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      turnstileToken
    })
  });
  if (!data.gift) {
    throw new Error('Cadeau introuvable');
  }
  return data.gift;
}

export async function listVipInvoices(params: {
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
} = {}): Promise<{
  invoices: VipAdminInvoice[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}> {
  const token = getAuthToken();
  if (!token) {
    throw new Error('Token admin manquant');
  }

  const query = new URLSearchParams();
  if (params.status && params.status !== 'all') query.set('status', params.status);
  if (params.search?.trim()) query.set('search', params.search.trim());
  query.set('page', String(params.page || 1));
  query.set('limit', String(params.limit || 30));

  const data = await requestJson<{
    invoices: VipAdminInvoice[];
    total: number;
    page: number;
    limit: number;
    hasMore: boolean;
  }>(`/api/admin/vip-invoices?${query.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  return {
    ...data,
    invoices: data.invoices.map(normalizeVipInvoice)
  };
}

export async function getVipInvoiceDetails(invoiceId: number): Promise<{
  invoice: VipAdminInvoice;
  events: VipInvoiceEvent[];
}> {
  const token = getAuthToken();
  if (!token) {
    throw new Error('Token admin manquant');
  }

  const data = await requestJson<{
    invoice: VipAdminInvoice;
    events: VipInvoiceEvent[];
  }>(`/api/admin/vip-invoices/${invoiceId}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  return {
    ...data,
    invoice: normalizeVipInvoice(data.invoice)
  };
}

export async function adminCheckVipInvoice(invoiceId: number): Promise<VipAdminInvoice> {
  const token = getAuthToken();
  if (!token) {
    throw new Error('Token admin manquant');
  }

  const data = await requestJson<JsonResponse<VipAdminInvoice>>(`/api/admin/vip-invoices/${invoiceId}/check`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!data.invoice) {
    throw new Error('Invoice introuvable');
  }

  return normalizeVipInvoice(data.invoice);
}

export async function adminValidateVipInvoice(invoiceId: number): Promise<VipAdminInvoice> {
  const token = getAuthToken();
  if (!token) {
    throw new Error('Token admin manquant');
  }

  const data = await requestJson<JsonResponse<VipAdminInvoice>>(`/api/admin/vip-invoices/${invoiceId}/validate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!data.invoice) {
    throw new Error('Invoice introuvable');
  }

  return normalizeVipInvoice(data.invoice);
}

export async function adminCancelVipInvoice(invoiceId: number): Promise<VipAdminInvoice> {
  const token = getAuthToken();
  if (!token) {
    throw new Error('Token admin manquant');
  }

  const data = await requestJson<JsonResponse<VipAdminInvoice>>(`/api/admin/vip-invoices/${invoiceId}/cancel`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!data.invoice) {
    throw new Error('Invoice introuvable');
  }

  return normalizeVipInvoice(data.invoice);
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

// Complète une réponse partielle avec les valeurs par défaut, champ par champ,
// pour qu'un serveur plus ancien ou un champ manquant ne casse pas la page.
function normalizeVipDonationSettings(raw: unknown): VipDonationSettings {
  const source = isPlainObject(raw) ? raw : {};
  const defaults = DEFAULT_VIP_DONATION_SETTINGS;
  const pickBoolean = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
  const pickNumber = (value: unknown, fallback: number) => (
    typeof value === 'number' && Number.isFinite(value) ? value : fallback
  );
  const pickString = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback);

  const rawMethods = isPlainObject(source.methods) ? source.methods : {};
  const methods = Object.fromEntries(VIP_DONATION_METHOD_IDS.map((id) => {
    const entry = isPlainObject(rawMethods[id]) ? rawMethods[id] : {};
    return [id, { enabled: pickBoolean(entry.enabled, defaults.methods[id].enabled) }];
  })) as VipDonationSettings['methods'];

  const rawGiftCards = isPlainObject(source.giftCards) ? source.giftCards : {};
  const giftCards = Object.fromEntries(VIP_GIFT_CARD_IDS.map((id) => {
    const entry = isPlainObject(rawGiftCards[id]) ? rawGiftCards[id] : {};
    return [id, {
      enabled: pickBoolean(entry.enabled, defaults.giftCards[id].enabled),
      url: pickString(entry.url, defaults.giftCards[id].url)
    }];
  })) as VipDonationSettings['giftCards'];

  const rawContacts = isPlainObject(source.contacts) ? source.contacts : {};
  const contacts = Object.fromEntries(
    (Object.keys(defaults.contacts) as Array<keyof VipDonationContacts>).map((key) => [
      key,
      pickString(rawContacts[key], defaults.contacts[key])
    ])
  ) as unknown as VipDonationContacts;

  const suggestedAmounts = Array.isArray(source.suggestedAmounts)
    ? source.suggestedAmounts.filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)
    : [];
  const defaultMethod = VIP_DONATION_METHOD_IDS.includes(source.defaultMethod as VipDonationMethodId)
    ? source.defaultMethod as VipDonationMethodId
    : defaults.defaultMethod;

  return {
    donationsEnabled: pickBoolean(source.donationsEnabled, defaults.donationsEnabled),
    pausedMessage: pickString(source.pausedMessage, defaults.pausedMessage),
    giftOptionEnabled: pickBoolean(source.giftOptionEnabled, defaults.giftOptionEnabled),
    freeAmountEnabled: pickBoolean(source.freeAmountEnabled, defaults.freeAmountEnabled),
    minAmountEur: pickNumber(source.minAmountEur, defaults.minAmountEur),
    maxAmountEur: pickNumber(source.maxAmountEur, defaults.maxAmountEur),
    eurosPerVipYear: pickNumber(source.eurosPerVipYear, defaults.eurosPerVipYear),
    suggestedAmounts: suggestedAmounts.length > 0 ? suggestedAmounts : [...defaults.suggestedAmounts],
    defaultAmountEur: pickNumber(source.defaultAmountEur, defaults.defaultAmountEur),
    defaultMethod,
    methods,
    giftCards,
    contacts
  };
}

function normalizeVipDonationSettingsPayload(data: unknown): VipDonationSettingsPayload {
  const source = isPlainObject(data) ? data : {};
  const rawAvailability = isPlainObject(source.availability) ? source.availability : {};
  const availability = Object.fromEntries(VIP_DONATION_METHOD_IDS.map((id) => [
    id,
    typeof rawAvailability[id] === 'boolean'
      ? rawAvailability[id] as boolean
      : DEFAULT_VIP_DONATION_AVAILABILITY[id]
  ])) as VipDonationAvailability;

  return {
    settings: normalizeVipDonationSettings(source.settings),
    availability,
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : null,
    updatedBy: typeof source.updatedBy === 'string' ? source.updatedBy : null
  };
}

export async function getVipDonationSettings(): Promise<VipDonationSettingsPayload> {
  const data = await requestJson<unknown>('/api/vip/donation-settings', { cache: 'no-store' });
  return normalizeVipDonationSettingsPayload(data);
}

export async function getAdminVipDonationSettings(): Promise<VipDonationSettingsPayload> {
  const token = getAuthToken();
  if (!token) {
    throw new Error('Token admin manquant');
  }

  const data = await requestJson<unknown>('/api/admin/vip-donation-settings', {
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  return normalizeVipDonationSettingsPayload(data);
}

export async function updateAdminVipDonationSettings(
  settings: VipDonationSettings
): Promise<VipDonationSettingsPayload> {
  const token = getAuthToken();
  if (!token) {
    throw new Error('Token admin manquant');
  }

  const data = await requestJson<unknown>('/api/admin/vip-donation-settings', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ settings })
  });
  return normalizeVipDonationSettingsPayload(data);
}

// Libellé lu par `buildAccessKeyExpiryFromDuration` côté serveur
// (« 16 mois », « 1 an », « 2 ans »).
export function buildVipKeyDurationLabel(months: number): string {
  const safeMonths = Math.max(1, Math.floor(months));
  if (safeMonths % 12 === 0) {
    const years = safeMonths / 12;
    return `${years} ${years > 1 ? 'ans' : 'an'}`;
  }
  return `${safeMonths} mois`;
}

function generateVipKeyValue(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `VIP-${hex.toUpperCase()}`;
}

// Clé offerte à la main après un don par carte cadeau : même format que les
// clés livrées par les invoices, créée via la route admin des clés VIP.
export async function adminCreateVipThankYouKey(months: number): Promise<{ key: string; durationLabel: string }> {
  const token = getAuthToken();
  if (!token) {
    throw new Error('Token admin manquant');
  }

  const durationLabel = buildVipKeyDurationLabel(months);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const key = generateVipKeyValue();
    const response = await fetch(`${MAIN_API}/api/admin/vip-keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ key, duree_validite: durationLabel })
    });

    // 409 : la clé tirée existe déjà, on en tire une autre.
    if (response.status === 409) {
      continue;
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || 'Erreur réseau');
    }

    return { key, durationLabel };
  }

  throw new Error('Impossible de générer une clé VIP unique');
}
