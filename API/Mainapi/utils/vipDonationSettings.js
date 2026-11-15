'use strict';

const { getTable, renderCreateTable } = require('../db/schema');

// Réglages des dons VIP, modifiés depuis l'admin et rangés dans une seule
// ligne MySQL (id = 1). Le frontend dépend de cette forme exacte : type
// `VipDonationSettings` de src/services/vipDonationsService.ts.

const VIP_DONATION_METHOD_IDS = Object.freeze(['cryptogate', 'giftcard', 'btc', 'ltc']);
const VIP_GIFT_CARD_IDS = Object.freeze(['google_play', 'amazon', 'paysafecard', 'eneba']);
const VIP_DONATION_CONTACT_KEYS = Object.freeze([
  'email',
  'discordUsername',
  'discordUrl',
  'telegramUsername',
  'matrixUserId',
  'matrixRoomUrl'
]);
const CONTACT_URL_KEYS = new Set(['discordUrl', 'matrixRoomUrl']);

const VIP_DONATION_ERROR_CODES = Object.freeze({
  paused: 'VIP_DONATIONS_PAUSED',
  methodDisabled: 'VIP_METHOD_DISABLED',
  giftOptionDisabled: 'VIP_GIFT_OPTION_DISABLED',
  amountInvalid: 'VIP_DONATION_AMOUNT_INVALID',
  settingsUnavailable: 'VIP_DONATION_SETTINGS_UNAVAILABLE',
  settingsInvalid: 'VIP_DONATION_SETTINGS_INVALID'
});

const VIP_DONATION_SETTINGS_TABLE = 'vip_donation_settings';
const VIP_DONATION_SETTINGS_ROW_ID = 1;
const VIP_DONATION_SETTINGS_CACHE_TTL_MS = 10 * 1000;
const AMOUNT_CEILING_EUR = 1000;
const MAX_SUGGESTED_AMOUNTS = 6;
const PAUSED_MESSAGE_MAX_LENGTH = 500;
const GIFT_CARD_URL_MAX_LENGTH = 500;
const CONTACT_MAX_LENGTH = 200;
// vip_invoices.vip_years est un DECIMAL(5,2) : 999,99 ans, soit 11 999 mois au plus.
const MAX_VIP_MONTHS = 11999;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DONATION_AMOUNT_PATTERN = /^\s*\d+(?:\.\d+)?\s*$/;

const FIELD_LABELS = Object.freeze({
  donationsEnabled: 'Dons activés',
  pausedMessage: 'Message de pause',
  giftOptionEnabled: 'Option pour offrir',
  freeAmountEnabled: 'Montant libre',
  minAmountEur: 'Montant minimum',
  maxAmountEur: 'Montant maximum',
  eurosPerVipYear: 'Euros pour 12 mois de VIP',
  suggestedAmounts: 'Montants suggérés',
  defaultAmountEur: 'Montant par défaut',
  methods: 'Moyens de paiement',
  giftCards: 'Cartes cadeaux',
  contacts: 'Contacts'
});
const METHOD_LABELS = Object.freeze({
  cryptogate: 'CryptoGate',
  giftcard: 'Carte cadeau',
  btc: 'Bitcoin',
  ltc: 'Litecoin'
});
const GIFT_CARD_LABELS = Object.freeze({
  google_play: 'Google Play',
  amazon: 'Amazon',
  paysafecard: 'Paysafecard',
  eneba: 'Eneba'
});
const CONTACT_LABELS = Object.freeze({
  email: 'E-mail',
  discordUsername: 'Pseudo Discord',
  discordUrl: 'Lien Discord',
  telegramUsername: 'Pseudo Telegram',
  matrixUserId: 'Identifiant Matrix',
  matrixRoomUrl: 'Lien du salon Matrix'
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

const DEFAULT_VIP_DONATION_SETTINGS = deepFreeze({
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
  // Liens d'achat des cartes. Amazon.fr ne vend ni Paysafecard ni Eneba :
  // liens officiels pour ces deux-là.
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
});

function getDefaultVipDonationSettings() {
  return structuredClone(DEFAULT_VIP_DONATION_SETTINGS);
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwnValue(source, key) {
  return isPlainObject(source)
    && Object.prototype.hasOwnProperty.call(source, key)
    && source[key] !== undefined;
}

function isHttpUrlOrEmpty(value, maxLength) {
  if (typeof value !== 'string' || value.length > maxLength) return false;
  if (value === '') return true;
  if (!/^https?:\/\/\S+$/i.test(value)) return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function isValidContactValue(key, value) {
  if (value.length > CONTACT_MAX_LENGTH) return false;
  if (key === 'email') return value === '' || EMAIL_PATTERN.test(value);
  if (CONTACT_URL_KEYS.has(key)) return isHttpUrlOrEmpty(value, CONTACT_MAX_LENGTH);
  return true;
}

// Même calcul que le frontend (src/utils/vipDonationsUi.ts) : `eurosPerVipYear` €
// = 12 mois, arrondi au mois supérieur (7 € à 5 €/an = 17 mois). La marge de
// 1e-9 garde un résultat exact entier : 12,000000000000002 donne 12, pas 13.
function getVipMonthsForAmount(amountEur, eurosPerVipYear) {
  if (
    !Number.isFinite(amountEur)
    || !Number.isFinite(eurosPerVipYear)
    || amountEur <= 0
    || eurosPerVipYear <= 0
  ) {
    return 0;
  }
  return Math.ceil((amountEur * 12) / eurosPerVipYear - 1e-9);
}

// Lecture tolérante d'une ligne stockée (éventuellement écrite par une version
// plus ancienne) : chaque champ absent, inconnu ou mal typé reprend sa valeur
// par défaut. Ne lève jamais.
function mergeStoredSettings(raw) {
  let source = raw;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch {
      source = null;
    }
  }

  const stored = isPlainObject(source) ? source : {};
  const defaults = DEFAULT_VIP_DONATION_SETTINGS;
  const pickBoolean = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
  const pickAmount = (value, fallback) => (
    Number.isInteger(value) && value >= 1 && value <= AMOUNT_CEILING_EUR ? value : fallback
  );

  let minAmountEur = pickAmount(stored.minAmountEur, defaults.minAmountEur);
  let maxAmountEur = pickAmount(stored.maxAmountEur, defaults.maxAmountEur);
  if (minAmountEur > maxAmountEur) {
    minAmountEur = defaults.minAmountEur;
    maxAmountEur = defaults.maxAmountEur;
  }
  const isInRange = (value) => Number.isInteger(value) && value >= minAmountEur && value <= maxAmountEur;
  const freeAmountEnabled = pickBoolean(stored.freeAmountEnabled, defaults.freeAmountEnabled);

  let suggestedAmounts = Array.isArray(stored.suggestedAmounts)
    ? [...new Set(stored.suggestedAmounts.filter(isInRange))]
      .sort((left, right) => left - right)
      .slice(0, MAX_SUGGESTED_AMOUNTS)
    : [];
  if (suggestedAmounts.length === 0) {
    suggestedAmounts = defaults.suggestedAmounts.filter(isInRange);
  }
  if (suggestedAmounts.length === 0) {
    suggestedAmounts = [minAmountEur];
  }

  const isUsableDefaultAmount = (value) => (
    isInRange(value) && (freeAmountEnabled || suggestedAmounts.includes(value))
  );
  const defaultAmountEur = [stored.defaultAmountEur, defaults.defaultAmountEur]
    .find(isUsableDefaultAmount) ?? suggestedAmounts[0];

  const storedMethods = isPlainObject(stored.methods) ? stored.methods : {};
  const storedGiftCards = isPlainObject(stored.giftCards) ? stored.giftCards : {};
  const storedContacts = isPlainObject(stored.contacts) ? stored.contacts : {};

  return {
    donationsEnabled: pickBoolean(stored.donationsEnabled, defaults.donationsEnabled),
    pausedMessage: typeof stored.pausedMessage === 'string'
      ? stored.pausedMessage.trim().slice(0, PAUSED_MESSAGE_MAX_LENGTH)
      : defaults.pausedMessage,
    giftOptionEnabled: pickBoolean(stored.giftOptionEnabled, defaults.giftOptionEnabled),
    freeAmountEnabled,
    minAmountEur,
    maxAmountEur,
    eurosPerVipYear: pickAmount(stored.eurosPerVipYear, defaults.eurosPerVipYear),
    suggestedAmounts,
    defaultAmountEur,
    defaultMethod: VIP_DONATION_METHOD_IDS.includes(stored.defaultMethod)
      ? stored.defaultMethod
      : defaults.defaultMethod,
    methods: Object.fromEntries(VIP_DONATION_METHOD_IDS.map((id) => {
      const entry = isPlainObject(storedMethods[id]) ? storedMethods[id] : {};
      return [id, { enabled: pickBoolean(entry.enabled, defaults.methods[id].enabled) }];
    })),
    giftCards: Object.fromEntries(VIP_GIFT_CARD_IDS.map((id) => {
      const entry = isPlainObject(storedGiftCards[id]) ? storedGiftCards[id] : {};
      const url = typeof entry.url === 'string' ? entry.url.trim() : null;
      return [id, {
        enabled: pickBoolean(entry.enabled, defaults.giftCards[id].enabled),
        url: url !== null && isHttpUrlOrEmpty(url, GIFT_CARD_URL_MAX_LENGTH)
          ? url
          : defaults.giftCards[id].url
      }];
    })),
    contacts: Object.fromEntries(VIP_DONATION_CONTACT_KEYS.map((key) => {
      const value = typeof storedContacts[key] === 'string' ? storedContacts[key].trim() : null;
      return [key, value !== null && isValidContactValue(key, value) ? value : defaults.contacts[key]];
    }))
  };
}

function createSettingsError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = VIP_DONATION_ERROR_CODES.settingsInvalid;
  return error;
}

function pickInput(input, current, key) {
  return hasOwnValue(input, key) ? input[key] : current[key];
}

function requireBoolean(value, label) {
  if (typeof value !== 'boolean') {
    throw createSettingsError(`Réglage invalide : « ${label} » doit valoir true ou false.`);
  }
  return value;
}

function requireInteger(value, label) {
  if (!Number.isInteger(value)) {
    throw createSettingsError(`Réglage invalide : « ${label} » doit être un nombre entier.`);
  }
  return value;
}

function requireText(value, label) {
  if (typeof value !== 'string') {
    throw createSettingsError(`Réglage invalide : « ${label} » doit être un texte.`);
  }
  return value.trim();
}

function requireNestedInput(input, key, label) {
  if (!hasOwnValue(input, key)) return {};
  if (!isPlainObject(input[key])) {
    throw createSettingsError(`Réglage invalide : « ${label} » doit être un objet.`);
  }
  return input[key];
}

// Validation stricte d'un enregistrement admin. L'entrée peut être partielle :
// chaque clé absente reprend la valeur actuelle, puis l'objet complet est
// contrôlé. Renvoie les réglages normalisés ou lève une erreur 400.
function validateSettingsInput(input, currentSettings = DEFAULT_VIP_DONATION_SETTINGS) {
  if (!isPlainObject(input)) {
    throw createSettingsError('Réglages invalides : un objet JSON est attendu.');
  }

  const current = mergeStoredSettings(currentSettings);

  const donationsEnabled = requireBoolean(
    pickInput(input, current, 'donationsEnabled'),
    FIELD_LABELS.donationsEnabled
  );
  const pausedMessage = requireText(pickInput(input, current, 'pausedMessage'), FIELD_LABELS.pausedMessage);
  if (pausedMessage.length > PAUSED_MESSAGE_MAX_LENGTH) {
    throw createSettingsError(
      `Le message de pause ne doit pas dépasser ${PAUSED_MESSAGE_MAX_LENGTH} caractères.`
    );
  }
  const giftOptionEnabled = requireBoolean(
    pickInput(input, current, 'giftOptionEnabled'),
    FIELD_LABELS.giftOptionEnabled
  );
  const freeAmountEnabled = requireBoolean(
    pickInput(input, current, 'freeAmountEnabled'),
    FIELD_LABELS.freeAmountEnabled
  );

  const minAmountEur = requireInteger(pickInput(input, current, 'minAmountEur'), FIELD_LABELS.minAmountEur);
  const maxAmountEur = requireInteger(pickInput(input, current, 'maxAmountEur'), FIELD_LABELS.maxAmountEur);
  const eurosPerVipYear = requireInteger(
    pickInput(input, current, 'eurosPerVipYear'),
    FIELD_LABELS.eurosPerVipYear
  );
  if (minAmountEur < 1 || minAmountEur > AMOUNT_CEILING_EUR) {
    throw createSettingsError(`Le montant minimum doit être compris entre 1 € et ${AMOUNT_CEILING_EUR} €.`);
  }
  if (maxAmountEur < 1 || maxAmountEur > AMOUNT_CEILING_EUR) {
    throw createSettingsError(`Le montant maximum doit être compris entre 1 € et ${AMOUNT_CEILING_EUR} €.`);
  }
  if (minAmountEur > maxAmountEur) {
    throw createSettingsError('Le montant minimum ne peut pas dépasser le montant maximum.');
  }
  if (eurosPerVipYear < 1 || eurosPerVipYear > AMOUNT_CEILING_EUR) {
    throw createSettingsError(
      `Le nombre d'euros pour 12 mois de VIP doit être compris entre 1 € et ${AMOUNT_CEILING_EUR} €.`
    );
  }
  // Avec l'arrondi au mois supérieur, un minimum d'au moins 1 € donne déjà
  // 1 mois à tout taux permis : simple garde-fou si la règle de calcul change.
  if (getVipMonthsForAmount(minAmountEur, eurosPerVipYear) < 1) {
    throw createSettingsError(
      `À ${eurosPerVipYear} € les 12 mois, le montant minimum doit donner au moins 1 mois de VIP.`
    );
  }

  const rawSuggestedAmounts = pickInput(input, current, 'suggestedAmounts');
  if (!Array.isArray(rawSuggestedAmounts)) {
    throw createSettingsError(`Réglage invalide : « ${FIELD_LABELS.suggestedAmounts} » doit être une liste.`);
  }
  if (rawSuggestedAmounts.length < 1 || rawSuggestedAmounts.length > MAX_SUGGESTED_AMOUNTS) {
    throw createSettingsError(`Indique entre 1 et ${MAX_SUGGESTED_AMOUNTS} montants suggérés.`);
  }
  if (!rawSuggestedAmounts.every((value) => Number.isInteger(value))) {
    throw createSettingsError('Les montants suggérés doivent être des nombres entiers.');
  }
  if (rawSuggestedAmounts.some((value) => value < minAmountEur || value > maxAmountEur)) {
    throw createSettingsError(
      `Les montants suggérés doivent être compris entre ${minAmountEur} € et ${maxAmountEur} €.`
    );
  }
  const suggestedAmounts = [...new Set(rawSuggestedAmounts)].sort((left, right) => left - right);
  if (suggestedAmounts.length !== rawSuggestedAmounts.length) {
    throw createSettingsError('Les montants suggérés ne doivent pas contenir de doublon.');
  }

  const defaultAmountEur = requireInteger(
    pickInput(input, current, 'defaultAmountEur'),
    FIELD_LABELS.defaultAmountEur
  );
  if (defaultAmountEur < minAmountEur || defaultAmountEur > maxAmountEur) {
    throw createSettingsError(
      `Le montant par défaut doit être compris entre ${minAmountEur} € et ${maxAmountEur} €.`
    );
  }
  if (!freeAmountEnabled && !suggestedAmounts.includes(defaultAmountEur)) {
    throw createSettingsError(
      'Sans montant libre, le montant par défaut doit faire partie des montants suggérés.'
    );
  }

  const defaultMethod = pickInput(input, current, 'defaultMethod');
  if (!VIP_DONATION_METHOD_IDS.includes(defaultMethod)) {
    throw createSettingsError('Le moyen de paiement par défaut est inconnu.');
  }

  const methodsInput = requireNestedInput(input, 'methods', FIELD_LABELS.methods);
  const methods = {};
  for (const id of VIP_DONATION_METHOD_IDS) {
    const label = `Moyen ${METHOD_LABELS[id]}`;
    const entry = requireNestedInput(methodsInput, id, label);
    methods[id] = { enabled: requireBoolean(pickInput(entry, current.methods[id], 'enabled'), label) };
  }

  const giftCardsInput = requireNestedInput(input, 'giftCards', FIELD_LABELS.giftCards);
  const giftCards = {};
  for (const id of VIP_GIFT_CARD_IDS) {
    const name = GIFT_CARD_LABELS[id];
    const entry = requireNestedInput(giftCardsInput, id, `Carte ${name}`);
    const enabled = requireBoolean(pickInput(entry, current.giftCards[id], 'enabled'), `Carte ${name}`);
    const url = requireText(pickInput(entry, current.giftCards[id], 'url'), `Lien d'achat ${name}`);
    if (!isHttpUrlOrEmpty(url, GIFT_CARD_URL_MAX_LENGTH)) {
      throw createSettingsError(
        `Le lien d'achat de la carte ${name} doit être vide ou commencer par http:// ou https:// (${GIFT_CARD_URL_MAX_LENGTH} caractères au plus).`
      );
    }
    giftCards[id] = { enabled, url };
  }

  const contactsInput = requireNestedInput(input, 'contacts', FIELD_LABELS.contacts);
  const contacts = {};
  for (const key of VIP_DONATION_CONTACT_KEYS) {
    const label = CONTACT_LABELS[key];
    const value = pickInput(contactsInput, current.contacts, key);
    if (typeof value !== 'string' || value.trim().length > CONTACT_MAX_LENGTH) {
      throw createSettingsError(
        `Le contact « ${label} » doit être un texte de ${CONTACT_MAX_LENGTH} caractères au plus.`
      );
    }
    const trimmed = value.trim();
    if (key === 'email' && trimmed !== '' && !EMAIL_PATTERN.test(trimmed)) {
      throw createSettingsError('L\'adresse e-mail de contact est invalide.');
    }
    if (CONTACT_URL_KEYS.has(key) && !isHttpUrlOrEmpty(trimmed, CONTACT_MAX_LENGTH)) {
      throw createSettingsError(`Le contact « ${label} » doit être vide ou un lien http:// ou https://.`);
    }
    contacts[key] = trimmed;
  }

  return {
    donationsEnabled,
    pausedMessage,
    giftOptionEnabled,
    freeAmountEnabled,
    minAmountEur,
    maxAmountEur,
    eurosPerVipYear,
    suggestedAmounts,
    defaultAmountEur,
    defaultMethod,
    methods,
    giftCards,
    contacts
  };
}

function createAmountError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = VIP_DONATION_ERROR_CODES.amountInvalid;
  return error;
}

function parseDonationAmount(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && DONATION_AMOUNT_PATTERN.test(value)) return Number(value);
  return Number.NaN;
}

// Montant d'un don et durée VIP offerte en remerciement. `vipYears` tient dans
// le DECIMAL(5,2) de vip_invoices et redonne exactement `vipMonths` via le
// Math.round(vipYears * 12) de la livraison.
function resolveDonationAmount(amountInput, settings) {
  const source = settings || DEFAULT_VIP_DONATION_SETTINGS;
  const amountEur = parseDonationAmount(amountInput);
  if (!Number.isFinite(amountEur) || !Number.isInteger(amountEur)) {
    throw createAmountError('Montant invalide : le don doit être un nombre entier d\'euros.');
  }

  if (source.freeAmountEnabled) {
    if (amountEur < source.minAmountEur || amountEur > source.maxAmountEur) {
      throw createAmountError(
        `Montant invalide : choisis un montant entre ${source.minAmountEur} € et ${source.maxAmountEur} €.`
      );
    }
  } else if (!source.suggestedAmounts.includes(amountEur)) {
    const choices = source.suggestedAmounts.map((value) => `${value} €`).join(', ');
    throw createAmountError(`Montant invalide : choisis l'un des montants proposés (${choices}).`);
  }

  const vipMonths = getVipMonthsForAmount(amountEur, source.eurosPerVipYear);
  if (vipMonths < 1) {
    throw createAmountError('Montant invalide : ce don est trop petit pour offrir au moins 1 mois de VIP.');
  }
  if (vipMonths > MAX_VIP_MONTHS) {
    throw createAmountError('Montant invalide : ce don dépasse la durée VIP maximale.');
  }

  return {
    amountEur,
    vipMonths,
    vipYears: Math.round((vipMonths / 12) * 100) / 100
  };
}

function isTruthyFlag(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || 'false').trim().toLowerCase());
}

function hasEnvValue(name) {
  return String(process.env[name] || '').trim() !== '';
}

function isCryptoGateEnabled() {
  return isTruthyFlag(process.env.VIP_CRYPTOGATE_ENABLED);
}

// Ce que le serveur sait faire d'après son environnement, indépendamment des
// réglages admin : mêmes contrôles que createCryptoGateVipInvoice et
// derivePaymentAddress (utils/vipDonations.js).
function getVipDonationAvailability() {
  return {
    cryptogate: isCryptoGateEnabled()
      && hasEnvValue('VIP_CRYPTOGATE_API_KEY')
      && hasEnvValue('VIP_CRYPTOGATE_WEBHOOK_SECRET'),
    giftcard: true,
    btc: hasEnvValue('VIP_BTC_XPUB'),
    ltc: hasEnvValue('VIP_LTC_XPUB')
  };
}

// La table est décrite dans db/schema/vip.js : la créer depuis cette définition
// garde le démarrage et le planificateur de schéma alignés.
async function ensureVipDonationSettingsTable(pool) {
  const table = getTable(VIP_DONATION_SETTINGS_TABLE);
  if (!table) {
    throw new Error(`Table ${VIP_DONATION_SETTINGS_TABLE} absente du schéma déclaratif`);
  }
  await pool.execute(renderCreateTable(table));
}

function toIsoString(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function readVipDonationSettingsRow(pool) {
  const [rows] = await pool.execute(
    `SELECT settings_json, updated_by, updated_at
      FROM vip_donation_settings
      WHERE id = ?
      LIMIT 1`,
    [VIP_DONATION_SETTINGS_ROW_ID]
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    return { settings: getDefaultVipDonationSettings(), updatedAt: null, updatedBy: null };
  }

  return {
    settings: mergeStoredSettings(row.settings_json),
    updatedAt: toIsoString(row.updated_at),
    updatedBy: row.updated_by === null || row.updated_by === undefined ? null : String(row.updated_by)
  };
}

// Cache propre à chaque worker du cluster : un enregistrement admin est vu tout
// de suite par le worker qui l'a fait, et par les autres en 10 s au plus.
let settingsCache = null;
let settingsGeneration = 0;
let pendingSettingsRead = null;

function cloneLoadedSettings(value) {
  return {
    settings: structuredClone(value.settings),
    updatedAt: value.updatedAt,
    updatedBy: value.updatedBy
  };
}

function resetVipDonationSettingsCache() {
  settingsCache = null;
  pendingSettingsRead = null;
  settingsGeneration += 1;
}

async function loadVipDonationSettings(pool, { fresh = false } = {}) {
  if (!fresh && settingsCache && settingsCache.expiresAt > Date.now()) {
    return cloneLoadedSettings(settingsCache.value);
  }

  const generation = settingsGeneration;
  let read = !fresh && pendingSettingsRead?.generation === generation ? pendingSettingsRead : null;
  if (!read) {
    read = { generation, promise: readVipDonationSettingsRow(pool) };
    if (!fresh) pendingSettingsRead = read;
  }

  try {
    const value = await read.promise;
    // Une lecture lancée avant un enregistrement ne doit pas écraser le cache.
    if (generation === settingsGeneration) {
      settingsCache = { value, expiresAt: Date.now() + VIP_DONATION_SETTINGS_CACHE_TTL_MS };
    }
    return cloneLoadedSettings(value);
  } catch (error) {
    if (!fresh && settingsCache) {
      // Base en panne : on garde la dernière version connue et on ne réessaie
      // qu'au bout d'un nouveau délai, plutôt qu'à chaque requête.
      if (generation === settingsGeneration) {
        settingsCache = { ...settingsCache, expiresAt: Date.now() + VIP_DONATION_SETTINGS_CACHE_TTL_MS };
      }
      console.warn(
        '[VIP] Réglages des dons illisibles, dernière version connue conservée :',
        error?.message || error
      );
      return cloneLoadedSettings(settingsCache.value);
    }
    throw error;
  } finally {
    if (pendingSettingsRead === read) pendingSettingsRead = null;
  }
}

async function saveVipDonationSettings(pool, settings, adminId = null) {
  const validated = validateSettingsInput(settings);
  const updatedBy = adminId === null || adminId === undefined || adminId === ''
    ? null
    : String(adminId).slice(0, 255);

  await pool.execute(
    `INSERT INTO vip_donation_settings (id, settings_json, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        settings_json = VALUES(settings_json),
        updated_by = VALUES(updated_by),
        updated_at = NOW()`,
    [VIP_DONATION_SETTINGS_ROW_ID, JSON.stringify(validated), updatedBy]
  );

  let saved;
  try {
    saved = await readVipDonationSettingsRow(pool);
  } catch (error) {
    console.warn('[VIP] Relecture des réglages des dons impossible après enregistrement :', error?.message || error);
    saved = { settings: validated, updatedAt: new Date().toISOString(), updatedBy };
  }

  settingsGeneration += 1;
  settingsCache = { value: saved, expiresAt: Date.now() + VIP_DONATION_SETTINGS_CACHE_TTL_MS };
  return cloneLoadedSettings(saved);
}

module.exports = {
  DEFAULT_VIP_DONATION_SETTINGS,
  VIP_DONATION_METHOD_IDS,
  VIP_GIFT_CARD_IDS,
  VIP_DONATION_CONTACT_KEYS,
  VIP_DONATION_ERROR_CODES,
  VIP_DONATION_SETTINGS_TABLE,
  VIP_DONATION_SETTINGS_CACHE_TTL_MS,
  MAX_VIP_MONTHS,
  getDefaultVipDonationSettings,
  mergeStoredSettings,
  validateSettingsInput,
  getVipMonthsForAmount,
  resolveDonationAmount,
  isCryptoGateEnabled,
  getVipDonationAvailability,
  ensureVipDonationSettingsTable,
  loadVipDonationSettings,
  saveVipDonationSettings,
  resetVipDonationSettingsCache
};
