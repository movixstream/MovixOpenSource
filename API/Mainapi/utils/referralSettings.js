'use strict';

// Réglages du parrainage, modifiés depuis l'admin et rangés dans une seule
// ligne MySQL (id = 1). Le frontend dépend de cette forme exacte : type
// `ReferralSettings` de src/services/referralService.ts.

const REFERRAL_SETTINGS_ROW_ID = 1;
const REFERRAL_SETTINGS_CACHE_TTL_MS = 10 * 1000;
const REFERRAL_SETTINGS_ERROR_CODE = 'REFERRAL_SETTINGS_INVALID';

// Coupé par défaut : l'admin l'allume quand il veut lancer le parrainage.
const DEFAULT_REFERRAL_SETTINGS = Object.freeze({
  enabled: false,
  rewardDays: 2,
  requiredMinutes: 60,
  requiredDays: 2,
  claimWindowDays: 7,
  maxRewardsPerMonth: 10,
  minReferrerAccountDays: 3
});

// Bornes de chaque nombre : [minimum, maximum, libellé de l'erreur].
const NUMBER_FIELDS = Object.freeze({
  rewardDays: [1, 30, 'Jours de VIP offerts'],
  requiredMinutes: [1, 600, 'Minutes de visionnage demandées'],
  requiredDays: [1, 14, 'Jours différents demandés'],
  claimWindowDays: [1, 30, 'Délai pour entrer un code'],
  maxRewardsPerMonth: [1, 100, 'Filleuls récompensés par mois'],
  // 0 = aucune ancienneté demandée.
  minReferrerAccountDays: [0, 90, 'Ancienneté du compte du parrain']
});

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getDefaultReferralSettings() {
  return { ...DEFAULT_REFERRAL_SETTINGS };
}

function isInBounds(key, value) {
  const [min, max] = NUMBER_FIELDS[key];
  return Number.isInteger(value) && value >= min && value <= max;
}

// Lecture tolérante d'une ligne stockée : chaque champ absent ou mal typé
// reprend sa valeur par défaut. Ne lève jamais.
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
  const merged = {
    enabled: typeof stored.enabled === 'boolean' ? stored.enabled : DEFAULT_REFERRAL_SETTINGS.enabled
  };
  for (const key of Object.keys(NUMBER_FIELDS)) {
    merged[key] = isInBounds(key, stored[key]) ? stored[key] : DEFAULT_REFERRAL_SETTINGS[key];
  }
  // Chaque jour demandé compte au moins une minute de visionnage.
  if (merged.requiredMinutes < merged.requiredDays) {
    merged.requiredMinutes = DEFAULT_REFERRAL_SETTINGS.requiredMinutes;
    merged.requiredDays = DEFAULT_REFERRAL_SETTINGS.requiredDays;
  }
  return merged;
}

function createSettingsError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = REFERRAL_SETTINGS_ERROR_CODE;
  return error;
}

// Validation stricte d'un enregistrement admin. L'entrée peut être partielle :
// chaque clé absente reprend la valeur actuelle. Lève une erreur 400.
function validateSettingsInput(input, currentSettings = DEFAULT_REFERRAL_SETTINGS) {
  if (!isPlainObject(input)) {
    throw createSettingsError('Réglages invalides : un objet JSON est attendu.');
  }
  const current = mergeStoredSettings(currentSettings);
  const pick = (key) => (Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined
    ? input[key]
    : current[key]);

  const enabled = pick('enabled');
  if (typeof enabled !== 'boolean') {
    throw createSettingsError('Réglage invalide : « Parrainage activé » doit valoir true ou false.');
  }

  const validated = { enabled };
  for (const [key, [min, max, label]] of Object.entries(NUMBER_FIELDS)) {
    const value = pick(key);
    if (!Number.isInteger(value) || value < min || value > max) {
      throw createSettingsError(`Réglage invalide : « ${label} » doit être un entier entre ${min} et ${max}.`);
    }
    validated[key] = value;
  }
  if (validated.requiredMinutes < validated.requiredDays) {
    throw createSettingsError('Il faut au moins une minute de visionnage par jour demandé.');
  }
  return validated;
}

function toIsoString(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function readSettingsRow(pool) {
  const [rows] = await pool.execute(
    'SELECT settings_json, updated_by, updated_at FROM referral_settings WHERE id = ? LIMIT 1',
    [REFERRAL_SETTINGS_ROW_ID]
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    return { settings: getDefaultReferralSettings(), updatedAt: null, updatedBy: null };
  }
  return {
    settings: mergeStoredSettings(row.settings_json),
    updatedAt: toIsoString(row.updated_at),
    updatedBy: row.updated_by === null || row.updated_by === undefined ? null : String(row.updated_by)
  };
}

// Cache propre à chaque worker : un enregistrement admin est vu tout de suite
// par le worker qui l'a fait, et par les autres en 10 s au plus.
let settingsCache = null;
let settingsGeneration = 0;

function resetReferralSettingsCache() {
  settingsCache = null;
  settingsGeneration += 1;
}

function cloneLoaded(value) {
  return { settings: { ...value.settings }, updatedAt: value.updatedAt, updatedBy: value.updatedBy };
}

async function loadReferralSettings(pool, { fresh = false } = {}) {
  if (!fresh && settingsCache && settingsCache.expiresAt > Date.now()) {
    return cloneLoaded(settingsCache.value);
  }
  const generation = settingsGeneration;
  try {
    const value = await readSettingsRow(pool);
    if (generation === settingsGeneration) {
      settingsCache = { value, expiresAt: Date.now() + REFERRAL_SETTINGS_CACHE_TTL_MS };
    }
    return cloneLoaded(value);
  } catch (error) {
    // Base en panne : la dernière version connue sert encore 10 s.
    if (!fresh && settingsCache) {
      settingsCache = { ...settingsCache, expiresAt: Date.now() + REFERRAL_SETTINGS_CACHE_TTL_MS };
      console.warn('[Parrainage] Réglages illisibles, dernière version connue conservée :', error?.message || error);
      return cloneLoaded(settingsCache.value);
    }
    throw error;
  }
}

async function saveReferralSettings(pool, settings, adminId = null) {
  const validated = validateSettingsInput(settings);
  const updatedBy = adminId === null || adminId === undefined || adminId === ''
    ? null
    : String(adminId).slice(0, 255);

  await pool.execute(
    `INSERT INTO referral_settings (id, settings_json, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        settings_json = VALUES(settings_json),
        updated_by = VALUES(updated_by),
        updated_at = NOW()`,
    [REFERRAL_SETTINGS_ROW_ID, JSON.stringify(validated), updatedBy]
  );

  let saved;
  try {
    saved = await readSettingsRow(pool);
  } catch {
    saved = { settings: validated, updatedAt: new Date().toISOString(), updatedBy };
  }
  settingsGeneration += 1;
  settingsCache = { value: saved, expiresAt: Date.now() + REFERRAL_SETTINGS_CACHE_TTL_MS };
  return cloneLoaded(saved);
}

module.exports = {
  DEFAULT_REFERRAL_SETTINGS,
  REFERRAL_SETTINGS_ERROR_CODE,
  getDefaultReferralSettings,
  mergeStoredSettings,
  validateSettingsInput,
  loadReferralSettings,
  saveReferralSettings,
  resetReferralSettingsCache
};
