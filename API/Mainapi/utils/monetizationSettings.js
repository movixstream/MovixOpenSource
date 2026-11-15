'use strict';

const crypto = require('node:crypto');
const { getTable, renderCreateTable } = require('../db/schema');

// Réglages des pubs, modifiés depuis l'onglet « Publicités » de l'admin et
// rangés dans une seule ligne MySQL (id = 1), comme les réglages des dons VIP.
// Le frontend dépend de cette forme exacte : type `MonetizationSettings` de
// src/services/monetizationAdminService.ts.

const PLACEMENT_IDS = Object.freeze(['player', 'download', 'livetv', 'swiftflux']);
const ROTATION_MODES = Object.freeze(['sequence', 'random']);
const SEQUENCE_SCOPES = Object.freeze(['global', 'visitor']);
const AUDIENCES = Object.freeze(['all', 'adult', 'sfw']);
const DEVICES = Object.freeze(['mobile', 'tablet', 'desktop']);
const OS_IDS = Object.freeze(['android', 'ios', 'windows', 'mac', 'linux', 'other']);
const COUNTRIES_MODES = Object.freeze(['all', 'include', 'exclude']);

const MONETIZATION_ERROR_CODES = Object.freeze({
  settingsInvalid: 'MONETIZATION_SETTINGS_INVALID'
});

const MONETIZATION_SETTINGS_TABLE = 'monetization_settings';
const MONETIZATION_SETTINGS_ROW_ID = 1;
const MONETIZATION_SETTINGS_CACHE_TTL_MS = 10 * 1000;
const MAX_ADS = 50;
const MAX_WINDOWS_PER_CLICK = 3;
const URL_MAX_LENGTH = 2000;
const AD_NAME_MAX_LENGTH = 80;
const AD_NOTE_MAX_LENGTH = 500;
const MAX_AD_WEIGHT = 100;
const MAX_DAILY_CAP = 1000000;
const MAX_COUNTRIES = 250;
const AD_ID_PATTERN = /^[a-z0-9]{6,16}$/;
const COUNTRY_PATTERN = /^[A-Z]{2}$/;
// Date ISO complète avec son fuseau : sans fuseau, elle dépendrait de l'heure
// locale du serveur.
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i;

const FIELD_LABELS = Object.freeze({
  enabled: 'Pubs activées',
  adultDefault: 'Pubs +18 par défaut',
  placements: 'Emplacements',
  ads: 'Pubs'
});
const PLACEMENT_LABELS = Object.freeze({
  player: 'Lecteur',
  download: 'Téléchargement',
  livetv: 'TV en direct',
  swiftflux: 'SwiftFlux'
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

const DEFAULT_MONETIZATION_SETTINGS = deepFreeze({
  enabled: true,
  adultDefault: true,
  placements: Object.fromEntries(PLACEMENT_IDS.map((id) => [id, {
    enabled: true,
    rotation: 'sequence',
    sequenceScope: 'global',
    windowsPerClick: 1,
    fallbackUrl: ''
  }])),
  ads: []
});

function getDefaultMonetizationSettings() {
  return structuredClone(DEFAULT_MONETIZATION_SETTINGS);
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwnValue(source, key) {
  return isPlainObject(source)
    && Object.prototype.hasOwnProperty.call(source, key)
    && source[key] !== undefined;
}

function isHttpUrl(value) {
  if (typeof value !== 'string' || value === '' || value.length > URL_MAX_LENGTH) return false;
  if (!/^https?:\/\/\S+$/i.test(value)) return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function isHttpUrlOrEmpty(value) {
  return value === '' || isHttpUrl(value);
}

function isIntegerBetween(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function createSettingsError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = MONETIZATION_ERROR_CODES.settingsInvalid;
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

function requireNestedInput(input, key, label) {
  if (!hasOwnValue(input, key)) return {};
  if (!isPlainObject(input[key])) {
    throw createSettingsError(`Réglage invalide : « ${label} » doit être un objet.`);
  }
  return input[key];
}

// Nom de la pub dans les messages d'erreur : son nom s'il est lisible, sinon
// sa place dans la liste.
function getAdLabel(raw, index) {
  const name = isPlainObject(raw) && typeof raw.name === 'string' ? raw.name.trim() : '';
  return name && name.length <= AD_NAME_MAX_LENGTH ? `Pub « ${name} »` : `Pub n° ${index + 1}`;
}

function generateAdId(usedIds) {
  let id;
  do {
    id = crypto.randomBytes(5).toString('hex');
  } while (usedIds.has(id));
  return id;
}

// Liste de valeurs connues, sans doublon, dans l'ordre reçu.
function requireKnownList(value, allowed, fail, failItem) {
  if (!Array.isArray(value)) fail();
  for (const item of value) {
    if (!allowed.includes(item)) failItem(item);
  }
  return [...new Set(value)];
}

function parseScheduleDate(value, fail) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value.trim())) fail();
  const time = Date.parse(value.trim());
  if (!Number.isFinite(time)) fail();
  return new Date(time).toISOString();
}

// Validation stricte d'une pub. Les champs facultatifs absents prennent leur
// valeur par défaut ; un champ présent mais faux lève une erreur 400. L'id
// absent reste à null : la liste le crée ensuite.
function validateAd(raw, index) {
  const label = getAdLabel(raw, index);
  const fail = (message) => {
    throw createSettingsError(`${label} : ${message}`);
  };
  if (!isPlainObject(raw)) fail('un objet est attendu.');
  const pick = (source, key, fallback) => (hasOwnValue(source, key) ? source[key] : fallback);

  let id = null;
  if (raw.id !== undefined && raw.id !== null && raw.id !== '') {
    if (typeof raw.id !== 'string' || !AD_ID_PATTERN.test(raw.id)) {
      fail('identifiant invalide (6 à 16 lettres minuscules ou chiffres).');
    }
    id = raw.id;
  }

  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (name.length < 1 || name.length > AD_NAME_MAX_LENGTH) {
    fail(`le nom doit faire entre 1 et ${AD_NAME_MAX_LENGTH} caractères.`);
  }

  const url = typeof raw.url === 'string' ? raw.url.trim() : '';
  if (!isHttpUrl(url)) {
    fail(`URL invalide (http:// ou https://, ${URL_MAX_LENGTH} caractères au plus).`);
  }

  const enabled = pick(raw, 'enabled', true);
  if (typeof enabled !== 'boolean') fail('« active » doit valoir true ou false.');

  if (!Array.isArray(raw.placements) || raw.placements.length === 0) {
    fail('choisis au moins un emplacement.');
  }
  const placements = [];
  for (const placement of raw.placements) {
    if (!PLACEMENT_IDS.includes(placement)) fail(`emplacement « ${String(placement)} » inconnu.`);
    if (placements.includes(placement)) fail(`emplacement « ${placement} » en double.`);
    placements.push(placement);
  }

  const audience = pick(raw, 'audience', 'all');
  if (!AUDIENCES.includes(audience)) fail('public inconnu (all, adult ou sfw).');

  const weight = pick(raw, 'weight', 1);
  if (!isIntegerBetween(weight, 1, MAX_AD_WEIGHT)) {
    fail(`le poids doit être un nombre entier entre 1 et ${MAX_AD_WEIGHT}.`);
  }

  const scheduleInput = pick(raw, 'schedule', {});
  if (!isPlainObject(scheduleInput)) fail('le créneau doit être un objet.');
  const startAt = parseScheduleDate(
    scheduleInput.startAt,
    () => fail('date de début invalide (date ISO avec fuseau attendue).')
  );
  const endAt = parseScheduleDate(
    scheduleInput.endAt,
    () => fail('date de fin invalide (date ISO avec fuseau attendue).')
  );
  if (startAt && endAt && Date.parse(endAt) <= Date.parse(startAt)) {
    fail('la date de fin doit être après la date de début.');
  }
  const rawDays = pick(scheduleInput, 'days', []);
  if (!Array.isArray(rawDays) || !rawDays.every((day) => isIntegerBetween(day, 0, 6))) {
    fail('jours invalides (0 = dimanche … 6 = samedi).');
  }
  const days = [...new Set(rawDays)].sort((left, right) => left - right);
  // Plage horaire à Paris ; from > to passe minuit (22 → 2).
  const rawHours = pick(scheduleInput, 'hours', null);
  let hours = null;
  if (rawHours !== null) {
    if (
      !isPlainObject(rawHours)
      || !isIntegerBetween(rawHours.from, 0, 23)
      || !isIntegerBetween(rawHours.to, 1, 24)
      || rawHours.from === rawHours.to
    ) {
      fail('plage horaire invalide (début de 0 à 23 h, fin de 1 à 24 h, début et fin différents).');
    }
    hours = { from: rawHours.from, to: rawHours.to };
  }

  const targetingInput = pick(raw, 'targeting', {});
  if (!isPlainObject(targetingInput)) fail('le ciblage doit être un objet.');
  const devices = requireKnownList(
    pick(targetingInput, 'devices', []),
    DEVICES,
    () => fail('la liste des appareils est invalide.'),
    (item) => fail(`appareil « ${String(item)} » inconnu.`)
  );
  const os = requireKnownList(
    pick(targetingInput, 'os', []),
    OS_IDS,
    () => fail('la liste des systèmes est invalide.'),
    (item) => fail(`système « ${String(item)} » inconnu.`)
  );
  const countriesMode = pick(targetingInput, 'countriesMode', 'all');
  if (!COUNTRIES_MODES.includes(countriesMode)) fail('mode des pays inconnu (all, include ou exclude).');
  const rawCountries = pick(targetingInput, 'countries', []);
  if (!Array.isArray(rawCountries)) fail('la liste des pays est invalide.');
  const countries = [];
  for (const value of rawCountries) {
    const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
    if (!COUNTRY_PATTERN.test(code)) {
      fail(`pays « ${String(value).trim()} » invalide (code ISO à 2 lettres attendu).`);
    }
    if (!countries.includes(code)) countries.push(code);
  }
  if (countries.length > MAX_COUNTRIES) fail(`${MAX_COUNTRIES} pays au plus.`);

  const capsInput = pick(raw, 'caps', {});
  if (!isPlainObject(capsInput)) fail('les plafonds doivent être un objet.');
  const perVisitorPerDay = pick(capsInput, 'perVisitorPerDay', 0);
  const globalPerDay = pick(capsInput, 'globalPerDay', 0);
  if (!isIntegerBetween(perVisitorPerDay, 0, MAX_DAILY_CAP)) {
    fail('plafond par visiteur invalide (entier de 0 à 1 000 000, 0 = illimité).');
  }
  if (!isIntegerBetween(globalPerDay, 0, MAX_DAILY_CAP)) {
    fail('plafond global invalide (entier de 0 à 1 000 000, 0 = illimité).');
  }

  const rawNote = pick(raw, 'note', '');
  if (typeof rawNote !== 'string') fail('la note doit être un texte.');
  const note = rawNote.trim();
  if (note.length > AD_NOTE_MAX_LENGTH) fail(`la note ne doit pas dépasser ${AD_NOTE_MAX_LENGTH} caractères.`);

  return {
    id,
    name,
    url,
    enabled,
    placements,
    audience,
    weight,
    schedule: { startAt, endAt, days, hours },
    targeting: { devices, os, countriesMode, countries },
    caps: { perVisitorPerDay, globalPerDay },
    note
  };
}

function validateAdList(rawAds) {
  if (!Array.isArray(rawAds)) {
    throw createSettingsError(`Réglage invalide : « ${FIELD_LABELS.ads} » doit être une liste.`);
  }
  if (rawAds.length > MAX_ADS) {
    throw createSettingsError(`Trop de pubs : ${MAX_ADS} pubs au plus.`);
  }

  const usedIds = new Set();
  const ads = rawAds.map((raw, index) => {
    const ad = validateAd(raw, index);
    if (ad.id !== null) {
      if (usedIds.has(ad.id)) {
        throw createSettingsError(
          `${getAdLabel(raw, index)} : l'identifiant « ${ad.id} » est déjà utilisé par une autre pub.`
        );
      }
      usedIds.add(ad.id);
    }
    return ad;
  });
  // Les identifiants manquants sont créés une fois toute la liste lue, pour ne
  // jamais reprendre celui d'une pub placée plus bas.
  for (const ad of ads) {
    if (ad.id === null) {
      ad.id = generateAdId(usedIds);
      usedIds.add(ad.id);
    }
  }
  return ads;
}

function validatePlacement(entry, current, id) {
  const label = `Emplacement « ${PLACEMENT_LABELS[id]} »`;
  const fail = (message) => {
    throw createSettingsError(`${label} : ${message}`);
  };

  const enabled = pickInput(entry, current, 'enabled');
  if (typeof enabled !== 'boolean') fail('« actif » doit valoir true ou false.');
  const rotation = pickInput(entry, current, 'rotation');
  if (!ROTATION_MODES.includes(rotation)) fail('rotation inconnue (sequence ou random).');
  const sequenceScope = pickInput(entry, current, 'sequenceScope');
  if (!SEQUENCE_SCOPES.includes(sequenceScope)) fail('portée de la séquence inconnue (global ou visitor).');
  const windowsPerClick = pickInput(entry, current, 'windowsPerClick');
  if (!isIntegerBetween(windowsPerClick, 1, MAX_WINDOWS_PER_CLICK)) {
    fail(`le nombre de fenêtres par clic doit être un entier entre 1 et ${MAX_WINDOWS_PER_CLICK}.`);
  }
  const rawFallbackUrl = pickInput(entry, current, 'fallbackUrl');
  const fallbackUrl = typeof rawFallbackUrl === 'string' ? rawFallbackUrl.trim() : null;
  if (fallbackUrl === null || !isHttpUrlOrEmpty(fallbackUrl)) {
    fail(`URL de secours invalide (vide, ou http:// ou https://, ${URL_MAX_LENGTH} caractères au plus).`);
  }

  return { enabled, rotation, sequenceScope, windowsPerClick, fallbackUrl };
}

function mergeStoredPlacement(raw, defaults) {
  const entry = isPlainObject(raw) ? raw : {};
  const fallbackUrl = typeof entry.fallbackUrl === 'string' ? entry.fallbackUrl.trim() : null;
  return {
    enabled: typeof entry.enabled === 'boolean' ? entry.enabled : defaults.enabled,
    rotation: ROTATION_MODES.includes(entry.rotation) ? entry.rotation : defaults.rotation,
    sequenceScope: SEQUENCE_SCOPES.includes(entry.sequenceScope) ? entry.sequenceScope : defaults.sequenceScope,
    windowsPerClick: isIntegerBetween(entry.windowsPerClick, 1, MAX_WINDOWS_PER_CLICK)
      ? entry.windowsPerClick
      : defaults.windowsPerClick,
    fallbackUrl: fallbackUrl !== null && isHttpUrlOrEmpty(fallbackUrl) ? fallbackUrl : defaults.fallbackUrl
  };
}

function mergeStoredAds(value) {
  if (!Array.isArray(value)) return [];
  const ads = [];
  const usedIds = new Set();
  for (const [index, raw] of value.entries()) {
    if (ads.length >= MAX_ADS) break;
    // Pas d'identifiant créé à la lecture : il changerait à chaque fois et
    // casserait les statistiques de la pub. Sans id valable, elle est écartée.
    if (!isPlainObject(raw) || typeof raw.id !== 'string' || !AD_ID_PATTERN.test(raw.id) || usedIds.has(raw.id)) {
      continue;
    }
    try {
      const ad = validateAd(raw, index);
      usedIds.add(ad.id);
      ads.push(ad);
    } catch {
      // Pub invalide (sans URL, emplacement ou public inconnu…) : écartée, les
      // autres restent servies.
    }
  }
  return ads;
}

// Lecture tolérante d'une ligne stockée : chaque champ général ou d'emplacement
// absent, inconnu ou mal typé reprend sa valeur par défaut, et chaque pub
// invalide est écartée. Ne lève jamais.
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
  const defaults = DEFAULT_MONETIZATION_SETTINGS;
  const storedPlacements = isPlainObject(stored.placements) ? stored.placements : {};

  return {
    enabled: typeof stored.enabled === 'boolean' ? stored.enabled : defaults.enabled,
    adultDefault: typeof stored.adultDefault === 'boolean' ? stored.adultDefault : defaults.adultDefault,
    placements: Object.fromEntries(PLACEMENT_IDS.map((id) => [
      id,
      mergeStoredPlacement(storedPlacements[id], defaults.placements[id])
    ])),
    ads: mergeStoredAds(stored.ads)
  };
}

// Validation stricte d'un enregistrement admin. Les clés de premier niveau et
// les champs d'emplacement absents reprennent la valeur actuelle ; `ads`, s'il
// est fourni, remplace toute la liste. Renvoie les réglages normalisés ou lève
// une erreur 400.
function validateSettingsInput(input, currentSettings = DEFAULT_MONETIZATION_SETTINGS) {
  if (!isPlainObject(input)) {
    throw createSettingsError('Réglages invalides : un objet JSON est attendu.');
  }

  const current = mergeStoredSettings(currentSettings);

  const enabled = requireBoolean(pickInput(input, current, 'enabled'), FIELD_LABELS.enabled);
  const adultDefault = requireBoolean(pickInput(input, current, 'adultDefault'), FIELD_LABELS.adultDefault);

  const placementsInput = requireNestedInput(input, 'placements', FIELD_LABELS.placements);
  const placements = {};
  for (const id of PLACEMENT_IDS) {
    const entry = requireNestedInput(placementsInput, id, `Emplacement ${PLACEMENT_LABELS[id]}`);
    placements[id] = validatePlacement(entry, current.placements[id], id);
  }

  const ads = hasOwnValue(input, 'ads') ? validateAdList(input.ads) : current.ads;

  return { enabled, adultDefault, placements, ads };
}

function parseInstant(value) {
  if (value === null || value === undefined || value === '') return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

// Pub « active » : en marche et dans sa fenêtre startAt (inclus) / endAt
// (exclu). Mêmes bornes que isAdEligible (utils/monetizationPicker.js), pour
// que la config publique ne contredise jamais le choix de /api/go. Les jours,
// heures et ciblages sont vérifiés à chaque ouverture, pas ici.
function isAdLiveNow(ad, now = new Date()) {
  if (!isPlainObject(ad) || ad.enabled !== true) return false;
  const date = now instanceof Date ? now : new Date(now ?? Date.now());
  const time = Number.isNaN(date.getTime()) ? Date.now() : date.getTime();
  const schedule = isPlainObject(ad.schedule) ? ad.schedule : {};
  const startAt = parseInstant(schedule.startAt);
  const endAt = parseInstant(schedule.endAt);
  if (startAt !== null && time < startAt) return false;
  if (endAt !== null && time >= endAt) return false;
  return true;
}

// Config publique lue par le site (/api/go-settings) : jamais d'URL, ni de
// nom ou d'identifiant de pub. Un emplacement coupé compte 0 pub.
function buildPublicConfig(settings, now = new Date()) {
  const source = isPlainObject(settings) ? settings : {};
  const defaults = DEFAULT_MONETIZATION_SETTINGS;
  const enabled = typeof source.enabled === 'boolean' ? source.enabled : defaults.enabled;
  const adultDefault = typeof source.adultDefault === 'boolean' ? source.adultDefault : defaults.adultDefault;
  const storedPlacements = isPlainObject(source.placements) ? source.placements : {};
  const liveAds = (Array.isArray(source.ads) ? source.ads : []).filter((ad) => isAdLiveNow(ad, now));

  const placements = {};
  for (const id of PLACEMENT_IDS) {
    const placement = isPlainObject(storedPlacements[id]) ? storedPlacements[id] : defaults.placements[id];
    const open = enabled && placement.enabled === true;
    const here = open
      ? liveAds.filter((ad) => Array.isArray(ad.placements) && ad.placements.includes(id))
      : [];
    placements[id] = {
      active: here.length > 0,
      adultCount: here.filter((ad) => ad.audience === 'all' || ad.audience === 'adult').length,
      sfwCount: here.filter((ad) => ad.audience === 'all' || ad.audience === 'sfw').length,
      windowsPerClick: isIntegerBetween(placement.windowsPerClick, 1, MAX_WINDOWS_PER_CLICK)
        ? placement.windowsPerClick
        : defaults.placements[id].windowsPerClick
    };
  }

  return { enabled, adultDefault, placements };
}

// La table est décrite dans db/schema/monetization.js : la créer depuis cette
// définition garde le démarrage et le planificateur de schéma alignés.
async function ensureMonetizationSettingsTable(pool) {
  const table = getTable(MONETIZATION_SETTINGS_TABLE);
  if (!table) {
    throw new Error(`Table ${MONETIZATION_SETTINGS_TABLE} absente du schéma déclaratif`);
  }
  await pool.execute(renderCreateTable(table));
}

function toIsoString(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function readMonetizationSettingsRow(pool) {
  const [rows] = await pool.execute(
    `SELECT settings_json, updated_by, updated_at
      FROM monetization_settings
      WHERE id = ?
      LIMIT 1`,
    [MONETIZATION_SETTINGS_ROW_ID]
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    return { settings: getDefaultMonetizationSettings(), updatedAt: null, updatedBy: null };
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

function resetMonetizationSettingsCache() {
  settingsCache = null;
  pendingSettingsRead = null;
  settingsGeneration += 1;
}

async function loadMonetizationSettings(pool, { fresh = false } = {}) {
  if (!fresh && settingsCache && settingsCache.expiresAt > Date.now()) {
    return cloneLoadedSettings(settingsCache.value);
  }

  const generation = settingsGeneration;
  let read = !fresh && pendingSettingsRead?.generation === generation ? pendingSettingsRead : null;
  if (!read) {
    read = { generation, promise: readMonetizationSettingsRow(pool) };
    if (!fresh) pendingSettingsRead = read;
  }

  try {
    const value = await read.promise;
    // Une lecture lancée avant un enregistrement ne doit pas écraser le cache.
    if (generation === settingsGeneration) {
      settingsCache = { value, expiresAt: Date.now() + MONETIZATION_SETTINGS_CACHE_TTL_MS };
    }
    return cloneLoadedSettings(value);
  } catch (error) {
    if (!fresh && settingsCache) {
      // Base en panne : on garde la dernière version connue et on ne réessaie
      // qu'au bout d'un nouveau délai, plutôt qu'à chaque requête.
      if (generation === settingsGeneration) {
        settingsCache = { ...settingsCache, expiresAt: Date.now() + MONETIZATION_SETTINGS_CACHE_TTL_MS };
      }
      console.warn(
        '[Pubs] Réglages des pubs illisibles, dernière version connue conservée :',
        error?.message || error
      );
      return cloneLoadedSettings(settingsCache.value);
    }
    throw error;
  } finally {
    if (pendingSettingsRead === read) pendingSettingsRead = null;
  }
}

async function saveMonetizationSettings(pool, settings, adminId = null) {
  const validated = validateSettingsInput(settings);
  const updatedBy = adminId === null || adminId === undefined || adminId === ''
    ? null
    : String(adminId).slice(0, 255);

  await pool.execute(
    `INSERT INTO monetization_settings (id, settings_json, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        settings_json = VALUES(settings_json),
        updated_by = VALUES(updated_by),
        updated_at = NOW()`,
    [MONETIZATION_SETTINGS_ROW_ID, JSON.stringify(validated), updatedBy]
  );

  let saved;
  try {
    saved = await readMonetizationSettingsRow(pool);
  } catch (error) {
    console.warn('[Pubs] Relecture des réglages des pubs impossible après enregistrement :', error?.message || error);
    saved = { settings: validated, updatedAt: new Date().toISOString(), updatedBy };
  }

  settingsGeneration += 1;
  settingsCache = { value: saved, expiresAt: Date.now() + MONETIZATION_SETTINGS_CACHE_TTL_MS };
  return cloneLoadedSettings(saved);
}

module.exports = {
  PLACEMENT_IDS,
  MAX_ADS,
  MONETIZATION_ERROR_CODES,
  MONETIZATION_SETTINGS_TABLE,
  MONETIZATION_SETTINGS_CACHE_TTL_MS,
  DEFAULT_MONETIZATION_SETTINGS,
  getDefaultMonetizationSettings,
  mergeStoredSettings,
  validateSettingsInput,
  isAdLiveNow,
  buildPublicConfig,
  ensureMonetizationSettingsTable,
  loadMonetizationSettings,
  saveMonetizationSettings,
  resetMonetizationSettingsCache
};
