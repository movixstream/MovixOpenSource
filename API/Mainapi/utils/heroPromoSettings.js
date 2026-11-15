'use strict';

const crypto = require('node:crypto');

const { getParisDateKey, shiftDateKey } = require('./monetizationStats');

// Promos du grand carrousel (bannière du haut des pages Accueil, Films, Séries,
// Plateformes et Animés), réglées depuis l'admin (onglet « Promos du carrousel ») et
// rangées dans une seule ligne MySQL (id = 1). Le frontend dépend de cette
// forme exacte : types de src/services/heroPromoService.ts.

const HERO_PROMO_SETTINGS_ROW_ID = 1;
const HERO_PROMO_SETTINGS_CACHE_TTL_MS = 10 * 1000;
const HERO_PROMO_SETTINGS_ERROR_CODE = 'HERO_PROMO_SETTINGS_INVALID';
const HERO_PROMO_IMAGE_ERROR_CODE = 'HERO_PROMO_IMAGE_INVALID';

const HERO_PROMO_PAGES = Object.freeze(['home', 'movies', 'tv', 'providers', 'anime']);
const HERO_PROMO_LANGUAGES = Object.freeze(['fr', 'en']);
const HERO_PROMO_IMAGE_POSITIONS = Object.freeze(['top', 'center', 'bottom']);
const HERO_PROMO_AD_LABEL_POSITIONS = Object.freeze(['top-left', 'top-right']);
// Mêmes paliers que les profils (ProfileManagement) : 0 = tout public.
const HERO_PROMO_MIN_AGES = Object.freeze([0, 7, 12, 16, 18]);
const HERO_PROMO_TEXT_LIMITS = Object.freeze({
  badge: 30,
  tagline: 100,
  title: 80,
  description: 320,
  ctaLabel: 30,
  adLabel: 20
});
const HERO_PROMO_TEXT_KEYS = Object.freeze(Object.keys(HERO_PROMO_TEXT_LIMITS));
const MAX_HERO_PROMOS = 10;
const MAX_HERO_PROMO_POSITION = 6;
// Promos montrées au plus dans un même carrousel, réglable page par page.
const MAX_PROMOS_PER_CAROUSEL = 5;
const DEFAULT_PROMOS_PER_CAROUSEL = 3;
const NAME_MAX_LENGTH = 80;
const URL_MAX_LENGTH = 1000;
const DEFAULT_ACCENT_COLOR = '#ef4444';

// Images : 2,5 Mo au plus une fois décodées (le navigateur de l'admin les
// réduit et les convertit avant l'envoi), servies depuis la base.
const MAX_HERO_PROMO_IMAGE_BYTES = Math.floor(2.5 * 1024 * 1024);
const HERO_PROMO_IMAGE_PATH_PREFIX = '/api/hero-promos/images/';
const HERO_PROMO_IMAGE_MIME_TYPES = Object.freeze({
  'image/webp': 'webp',
  'image/png': 'png',
  'image/jpeg': 'jpg'
});
// Une image envoyée mais jamais enregistrée dans une promo est effacée au
// bout de 2 jours (au prochain enregistrement des réglages).
const ORPHAN_IMAGE_GRACE_DAYS = 2;
const IMAGE_CACHE_MAX_ENTRIES = 12;

const PROMO_ID_PATTERN = /^[a-f0-9]{10}$/;
const IMAGE_ID_PATTERN = /^[a-f0-9]{16}$/;
const IMAGE_PATH_PATTERN = /^\/api\/hero-promos\/images\/([a-f0-9]{16})\.(webp|png|jpg)$/;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
// Lien interne du site : chemin absolu, pas d'URL « //hôte » ni d'espace.
const INTERNAL_LINK_PATTERN = /^\/(?!\/)[^\s\\]*$/;
// Caractères de contrôle retirés des textes (le saut de ligne reste permis).
const CONTROL_CHARS_PATTERN = /[\u0000-\u0009\u000B-\u001F\u007F]/g;

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

// Chaque carrousel (Accueil, Films, Séries, Plateformes, Animés) se règle à
// part : promos affichées ou non, et combien au plus.
const DEFAULT_HERO_PROMO_SETTINGS = deepFreeze({
  enabled: true,
  carousels: Object.fromEntries(HERO_PROMO_PAGES.map((page) => [
    page,
    { enabled: true, maxPromos: DEFAULT_PROMOS_PER_CAROUSEL }
  ])),
  promos: []
});

function getDefaultHeroPromoSettings() {
  return structuredClone(DEFAULT_HERO_PROMO_SETTINGS);
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwnValue(source, key) {
  return isPlainObject(source)
    && Object.prototype.hasOwnProperty.call(source, key)
    && source[key] !== undefined;
}

function cleanText(value) {
  return typeof value === 'string' ? value.replace(CONTROL_CHARS_PATTERN, '').trim() : '';
}

function isHttpUrl(value) {
  if (typeof value !== 'string' || !value || value.length > URL_MAX_LENGTH) return false;
  if (!/^https?:\/\/\S+$/i.test(value)) return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && Boolean(parsed.hostname)
      && !parsed.username
      && !parsed.password;
  } catch {
    return false;
  }
}

// Image : envoyée depuis l'admin (chemin de cette API) ou lien https. Le site
// est servi en https : une image en http serait bloquée par le navigateur.
function isImageRef(value) {
  if (typeof value !== 'string' || !value) return false;
  if (IMAGE_PATH_PATTERN.test(value)) return true;
  return isHttpUrl(value) && value.toLowerCase().startsWith('https://');
}

// Lien d'ouverture : http(s) ou page du site (« /vip », « /movie/... »).
function isLinkRef(value) {
  if (typeof value !== 'string' || !value || value.length > URL_MAX_LENGTH) return false;
  if (INTERNAL_LINK_PATTERN.test(value)) return true;
  return isHttpUrl(value);
}

function toIsoOrNull(value) {
  if (typeof value !== 'string' || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getImageIdFromRef(value) {
  const match = typeof value === 'string' ? IMAGE_PATH_PATTERN.exec(value) : null;
  return match ? match[1] : null;
}

function emptyTexts() {
  return Object.fromEntries(HERO_PROMO_TEXT_KEYS.map((key) => [key, '']));
}

// ---------------------------------------------------------------------------
// Lecture tolérante d'une ligne stockée
// ---------------------------------------------------------------------------

function mergeStoredTexts(raw) {
  const source = isPlainObject(raw) ? raw : {};
  return Object.fromEntries(HERO_PROMO_TEXT_KEYS.map((key) => (
    [key, cleanText(source[key]).slice(0, HERO_PROMO_TEXT_LIMITS[key])]
  )));
}

function mergeStoredPromo(raw) {
  if (!isPlainObject(raw) || typeof raw.id !== 'string' || !PROMO_ID_PATTERN.test(raw.id)) {
    return null;
  }

  const pages = Array.isArray(raw.pages)
    ? HERO_PROMO_PAGES.filter((page) => raw.pages.includes(page))
    : [];
  const position = Number.isInteger(raw.position)
    && raw.position >= 1
    && raw.position <= MAX_HERO_PROMO_POSITION
    ? raw.position
    : 1;
  const adLabel = isPlainObject(raw.adLabel) ? raw.adLabel : {};
  const texts = isPlainObject(raw.texts) ? raw.texts : {};
  const imageUrl = typeof raw.imageUrl === 'string' && isImageRef(raw.imageUrl) ? raw.imageUrl : '';
  const linkUrl = typeof raw.linkUrl === 'string' && isLinkRef(raw.linkUrl) ? raw.linkUrl : '';

  return {
    id: raw.id,
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : false,
    name: cleanText(raw.name).slice(0, NAME_MAX_LENGTH),
    pages: pages.length > 0 ? pages : ['home'],
    position,
    startAt: toIsoOrNull(raw.startAt),
    endAt: toIsoOrNull(raw.endAt),
    minAge: HERO_PROMO_MIN_AGES.includes(raw.minAge) ? raw.minAge : 0,
    imageUrl,
    mobileImageUrl: isImageRef(raw.mobileImageUrl) ? raw.mobileImageUrl : '',
    imagePosition: HERO_PROMO_IMAGE_POSITIONS.includes(raw.imagePosition) ? raw.imagePosition : 'center',
    logoUrl: isImageRef(raw.logoUrl) ? raw.logoUrl : '',
    linkUrl,
    openInNewTab: typeof raw.openInNewTab === 'boolean' ? raw.openInNewTab : true,
    accentColor: typeof raw.accentColor === 'string' && COLOR_PATTERN.test(raw.accentColor)
      ? raw.accentColor.toLowerCase()
      : DEFAULT_ACCENT_COLOR,
    adLabel: {
      show: typeof adLabel.show === 'boolean' ? adLabel.show : true,
      position: HERO_PROMO_AD_LABEL_POSITIONS.includes(adLabel.position) ? adLabel.position : 'top-right'
    },
    texts: Object.fromEntries(HERO_PROMO_LANGUAGES.map((language) => [language, mergeStoredTexts(texts[language])]))
  };
}

function isCarouselMax(value) {
  return Number.isInteger(value) && value >= 1 && value <= MAX_PROMOS_PER_CAROUSEL;
}

function mergeStoredCarousels(raw) {
  const source = isPlainObject(raw) ? raw : {};
  return Object.fromEntries(HERO_PROMO_PAGES.map((page) => {
    const entry = isPlainObject(source[page]) ? source[page] : {};
    const defaults = DEFAULT_HERO_PROMO_SETTINGS.carousels[page];
    return [page, {
      enabled: typeof entry.enabled === 'boolean' ? entry.enabled : defaults.enabled,
      maxPromos: isCarouselMax(entry.maxPromos) ? entry.maxPromos : defaults.maxPromos
    }];
  }));
}

// Chaque champ absent ou mal typé reprend sa valeur par défaut ; une promo
// sans identifiant valable est ignorée. Ne lève jamais.
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
  const seen = new Set();
  const promos = [];
  for (const entry of Array.isArray(stored.promos) ? stored.promos : []) {
    const promo = mergeStoredPromo(entry);
    if (!promo || seen.has(promo.id)) continue;
    seen.add(promo.id);
    promos.push(promo);
    if (promos.length >= MAX_HERO_PROMOS) break;
  }
  return {
    enabled: typeof stored.enabled === 'boolean' ? stored.enabled : DEFAULT_HERO_PROMO_SETTINGS.enabled,
    carousels: mergeStoredCarousels(stored.carousels),
    promos
  };
}

// ---------------------------------------------------------------------------
// Validation stricte d'un enregistrement admin
// ---------------------------------------------------------------------------

function createSettingsError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = HERO_PROMO_SETTINGS_ERROR_CODE;
  return error;
}

function requireBoolean(value, label) {
  if (typeof value !== 'boolean') {
    throw createSettingsError(`Réglage invalide : « ${label} » doit valoir true ou false.`);
  }
  return value;
}

function requireText(value, label, maxLength) {
  if (typeof value !== 'string') {
    throw createSettingsError(`Réglage invalide : « ${label} » doit être un texte.`);
  }
  const text = cleanText(value);
  if (text.length > maxLength) {
    throw createSettingsError(`« ${label} » ne doit pas dépasser ${maxLength} caractères.`);
  }
  return text;
}

function requireDateOrNull(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const iso = toIsoOrNull(value);
  if (!iso) {
    throw createSettingsError(`Réglage invalide : « ${label} » doit être une date.`);
  }
  return iso;
}

function validatePromoInput(raw, index) {
  if (!isPlainObject(raw)) {
    throw createSettingsError(`Promo n° ${index + 1} : un objet JSON est attendu.`);
  }
  const rawName = typeof raw.name === 'string' ? cleanText(raw.name) : '';
  const prefix = `Promo n° ${index + 1}${rawName ? ` (« ${rawName.slice(0, 40)} »)` : ''}`;
  const label = (field) => `${prefix} — ${field}`;

  if (typeof raw.id !== 'string' || !PROMO_ID_PATTERN.test(raw.id)) {
    throw createSettingsError(`${prefix} : identifiant invalide.`);
  }

  const enabled = requireBoolean(raw.enabled, label('Active'));
  const name = requireText(raw.name ?? '', label('Nom'), NAME_MAX_LENGTH);

  if (!Array.isArray(raw.pages) || raw.pages.some((page) => !HERO_PROMO_PAGES.includes(page))) {
    throw createSettingsError(`${prefix} : pages inconnues.`);
  }
  const pages = HERO_PROMO_PAGES.filter((page) => raw.pages.includes(page));
  if (pages.length === 0) {
    throw createSettingsError(`${prefix} : choisis au moins une page.`);
  }

  if (!Number.isInteger(raw.position) || raw.position < 1 || raw.position > MAX_HERO_PROMO_POSITION) {
    throw createSettingsError(`${prefix} : la place dans le carrousel doit être un entier de 1 à ${MAX_HERO_PROMO_POSITION}.`);
  }

  const startAt = requireDateOrNull(raw.startAt, label('Début'));
  const endAt = requireDateOrNull(raw.endAt, label('Fin'));
  if (startAt && endAt && new Date(endAt).getTime() <= new Date(startAt).getTime()) {
    throw createSettingsError(`${prefix} : la fin doit venir après le début.`);
  }

  if (!HERO_PROMO_MIN_AGES.includes(raw.minAge)) {
    throw createSettingsError(`${prefix} : âge minimum inconnu.`);
  }

  const imageUrl = requireText(raw.imageUrl ?? '', label('Image'), URL_MAX_LENGTH);
  if (imageUrl && !isImageRef(imageUrl)) {
    throw createSettingsError(`${prefix} : l'image doit être envoyée depuis l'admin ou être un lien https://.`);
  }
  const mobileImageUrl = requireText(raw.mobileImageUrl ?? '', label('Image mobile'), URL_MAX_LENGTH);
  if (mobileImageUrl && !isImageRef(mobileImageUrl)) {
    throw createSettingsError(`${prefix} : l'image mobile doit être envoyée depuis l'admin ou être un lien https://.`);
  }
  const logoUrl = requireText(raw.logoUrl ?? '', label('Logo'), URL_MAX_LENGTH);
  if (logoUrl && !isImageRef(logoUrl)) {
    throw createSettingsError(`${prefix} : le logo doit être envoyé depuis l'admin ou être un lien https://.`);
  }
  if (!HERO_PROMO_IMAGE_POSITIONS.includes(raw.imagePosition)) {
    throw createSettingsError(`${prefix} : cadrage de l'image inconnu.`);
  }

  const linkUrl = requireText(raw.linkUrl ?? '', label('Lien'), URL_MAX_LENGTH);
  if (linkUrl && !isLinkRef(linkUrl)) {
    throw createSettingsError(`${prefix} : le lien doit commencer par https:// (ou / pour une page du site).`);
  }
  const openInNewTab = requireBoolean(raw.openInNewTab, label('Nouvel onglet'));

  if (typeof raw.accentColor !== 'string' || !COLOR_PATTERN.test(raw.accentColor)) {
    throw createSettingsError(`${prefix} : la couleur doit être au format #rrggbb.`);
  }

  if (!isPlainObject(raw.adLabel)) {
    throw createSettingsError(`${prefix} : réglage de la mention « Pub » manquant.`);
  }
  const adLabel = {
    show: requireBoolean(raw.adLabel.show, label('Afficher la mention')),
    position: raw.adLabel.position
  };
  if (!HERO_PROMO_AD_LABEL_POSITIONS.includes(adLabel.position)) {
    throw createSettingsError(`${prefix} : place de la mention « Pub » inconnue.`);
  }

  if (!isPlainObject(raw.texts)) {
    throw createSettingsError(`${prefix} : textes manquants.`);
  }
  const texts = {};
  for (const language of HERO_PROMO_LANGUAGES) {
    const source = hasOwnValue(raw.texts, language) ? raw.texts[language] : {};
    if (!isPlainObject(source)) {
      throw createSettingsError(`${prefix} : textes « ${language} » invalides.`);
    }
    texts[language] = emptyTexts();
    for (const key of HERO_PROMO_TEXT_KEYS) {
      texts[language][key] = requireText(source[key] ?? '', label(`${key} (${language})`), HERO_PROMO_TEXT_LIMITS[key]);
    }
  }

  // Une promo en pause peut rester incomplète (brouillon) ; une promo active
  // doit pouvoir s'afficher.
  if (enabled) {
    if (!imageUrl) throw createSettingsError(`${prefix} : ajoute une image avant de l'activer.`);
    if (!linkUrl) throw createSettingsError(`${prefix} : ajoute un lien avant de l'activer.`);
    if (!texts.fr.title) throw createSettingsError(`${prefix} : ajoute un titre en français avant de l'activer.`);
  }

  return {
    id: raw.id,
    enabled,
    name,
    pages,
    position: raw.position,
    startAt,
    endAt,
    minAge: raw.minAge,
    imageUrl,
    mobileImageUrl,
    imagePosition: raw.imagePosition,
    logoUrl,
    linkUrl,
    openInNewTab,
    accentColor: raw.accentColor.toLowerCase(),
    adLabel,
    texts
  };
}

// L'entrée peut omettre `enabled`, `carousels` (ou un carrousel) ou `promos` :
// la valeur actuelle est gardée. La liste des promos, elle, est toujours
// remplacée en entier.
function validateSettingsInput(input, currentSettings = DEFAULT_HERO_PROMO_SETTINGS) {
  if (!isPlainObject(input)) {
    throw createSettingsError('Réglages invalides : un objet JSON est attendu.');
  }
  const current = mergeStoredSettings(currentSettings);
  const enabled = requireBoolean(hasOwnValue(input, 'enabled') ? input.enabled : current.enabled, 'Promos activées');

  const carouselsInput = hasOwnValue(input, 'carousels') ? input.carousels : {};
  if (!isPlainObject(carouselsInput)) {
    throw createSettingsError('Réglage invalide : « carousels » doit être un objet.');
  }
  const carousels = {};
  for (const page of HERO_PROMO_PAGES) {
    const entry = hasOwnValue(carouselsInput, page) ? carouselsInput[page] : current.carousels[page];
    if (!isPlainObject(entry)) {
      throw createSettingsError(`Réglage invalide : carrousel « ${page} ».`);
    }
    const carouselEnabled = requireBoolean(
      hasOwnValue(entry, 'enabled') ? entry.enabled : current.carousels[page].enabled,
      `Carrousel « ${page} » activé`
    );
    const maxPromos = hasOwnValue(entry, 'maxPromos') ? entry.maxPromos : current.carousels[page].maxPromos;
    if (!isCarouselMax(maxPromos)) {
      throw createSettingsError(`Carrousel « ${page} » : de 1 à ${MAX_PROMOS_PER_CAROUSEL} promos au plus.`);
    }
    carousels[page] = { enabled: carouselEnabled, maxPromos };
  }

  const rawPromos = hasOwnValue(input, 'promos') ? input.promos : current.promos;
  if (!Array.isArray(rawPromos)) {
    throw createSettingsError('Réglage invalide : « promos » doit être une liste.');
  }
  if (rawPromos.length > MAX_HERO_PROMOS) {
    throw createSettingsError(`${MAX_HERO_PROMOS} promos au plus.`);
  }
  const promos = rawPromos.map((promo, index) => validatePromoInput(promo, index));
  const ids = new Set(promos.map((promo) => promo.id));
  if (ids.size !== promos.length) {
    throw createSettingsError('Deux promos portent le même identifiant.');
  }
  return { enabled, carousels, promos };
}

// ---------------------------------------------------------------------------
// Vue publique
// ---------------------------------------------------------------------------

// Promos actives et pas encore finies. Celles qui commencent plus tard sont
// gardées : le site les montre à l'heure dite sans attendre sa prochaine
// lecture. Le nom interne n'est pas publié.
function buildPublicHeroPromos(settings, now = new Date()) {
  const source = mergeStoredSettings(settings);
  if (!source.enabled) return [];
  const nowMs = now.getTime();
  return source.promos
    .filter((promo) => (
      promo.enabled
      && promo.imageUrl
      && promo.linkUrl
      && promo.texts.fr.title
      && (!promo.endAt || new Date(promo.endAt).getTime() > nowMs)
    ))
    .map(({ enabled: _enabled, name: _name, ...rest }) => rest);
}

// Réponse de GET /api/hero-promos : réglage de chaque carrousel et promos.
function buildPublicHeroPromoConfig(settings, now = new Date()) {
  const source = mergeStoredSettings(settings);
  return {
    carousels: source.carousels,
    promos: buildPublicHeroPromos(source, now)
  };
}

// Promo d'un clic (route de redirection). Une promo coupée ou finie depuis
// la dernière lecture du site garde son lien : le visiteur arrive quand même
// à destination, mais le clic n'est compté que si elle est encore en service.
function findHeroPromoForClick(settings, promoId, now = new Date()) {
  const source = mergeStoredSettings(settings);
  const promo = source.promos.find((entry) => entry.id === promoId && entry.linkUrl);
  if (!promo) return null;
  const live = buildPublicHeroPromos(source, now).some((entry) => entry.id === promoId);
  return { linkUrl: promo.linkUrl, countable: live };
}

// ---------------------------------------------------------------------------
// Lecture et écriture des réglages
// ---------------------------------------------------------------------------

function toIsoString(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function readSettingsRow(pool) {
  const [rows] = await pool.execute(
    'SELECT settings_json, updated_by, updated_at FROM hero_promo_settings WHERE id = ? LIMIT 1',
    [HERO_PROMO_SETTINGS_ROW_ID]
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    return { settings: getDefaultHeroPromoSettings(), updatedAt: null, updatedBy: null };
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

function resetHeroPromoSettingsCache() {
  settingsCache = null;
  settingsGeneration += 1;
}

function cloneLoaded(value) {
  return {
    settings: structuredClone(value.settings),
    updatedAt: value.updatedAt,
    updatedBy: value.updatedBy
  };
}

async function loadHeroPromoSettings(pool, { fresh = false } = {}) {
  if (!fresh && settingsCache && settingsCache.expiresAt > Date.now()) {
    return cloneLoaded(settingsCache.value);
  }
  const generation = settingsGeneration;
  try {
    const value = await readSettingsRow(pool);
    if (generation === settingsGeneration) {
      settingsCache = { value, expiresAt: Date.now() + HERO_PROMO_SETTINGS_CACHE_TTL_MS };
    }
    return cloneLoaded(value);
  } catch (error) {
    // Base en panne : la dernière version connue sert encore 10 s.
    if (!fresh && settingsCache) {
      settingsCache = { ...settingsCache, expiresAt: Date.now() + HERO_PROMO_SETTINGS_CACHE_TTL_MS };
      console.warn('[Promos carrousel] Réglages illisibles, dernière version connue conservée :', error?.message || error);
      return cloneLoaded(settingsCache.value);
    }
    throw error;
  }
}

async function saveHeroPromoSettings(pool, settings, adminId = null) {
  const validated = validateSettingsInput(settings);
  const updatedBy = adminId === null || adminId === undefined || adminId === ''
    ? null
    : String(adminId).slice(0, 255);

  await pool.execute(
    `INSERT INTO hero_promo_settings (id, settings_json, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        settings_json = VALUES(settings_json),
        updated_by = VALUES(updated_by),
        updated_at = NOW()`,
    [HERO_PROMO_SETTINGS_ROW_ID, JSON.stringify(validated), updatedBy]
  );

  let saved;
  try {
    saved = await readSettingsRow(pool);
  } catch {
    saved = { settings: validated, updatedAt: new Date().toISOString(), updatedBy };
  }
  settingsGeneration += 1;
  settingsCache = { value: saved, expiresAt: Date.now() + HERO_PROMO_SETTINGS_CACHE_TTL_MS };
  return cloneLoaded(saved);
}

// ---------------------------------------------------------------------------
// Clics
// ---------------------------------------------------------------------------

async function recordHeroPromoClick(pool, promoId, now = new Date()) {
  await pool.execute(
    `INSERT INTO hero_promo_daily_clicks (day, promo_id, clicks) VALUES (?, ?, 1)
      ON DUPLICATE KEY UPDATE clicks = clicks + 1`,
    [getParisDateKey(now), promoId]
  );
}

function toCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

// Clics par promo : aujourd'hui, 7 et 30 derniers jours (aujourd'hui compris),
// et depuis le début. Jours de Paris.
async function readHeroPromoClickStats(pool, now = new Date()) {
  const today = getParisDateKey(now);
  const weekStart = shiftDateKey(today, -6);
  const monthStart = shiftDateKey(today, -29);
  const [rows] = await pool.execute(
    `SELECT promo_id,
        SUM(CASE WHEN day = ? THEN clicks ELSE 0 END) AS today,
        SUM(CASE WHEN day >= ? THEN clicks ELSE 0 END) AS week,
        SUM(CASE WHEN day >= ? THEN clicks ELSE 0 END) AS month,
        SUM(clicks) AS total
      FROM hero_promo_daily_clicks
      GROUP BY promo_id`,
    [today, weekStart, monthStart]
  );
  const stats = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    stats[String(row.promo_id)] = {
      today: toCount(row.today),
      week: toCount(row.week),
      month: toCount(row.month),
      total: toCount(row.total)
    };
  }
  return stats;
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

function createImageError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = HERO_PROMO_IMAGE_ERROR_CODE;
  return error;
}

function detectImageExtension(buffer) {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (
    buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) return 'webp';
  return null;
}

// Corps JSON { mimeType, dataBase64 } : le type annoncé doit correspondre au
// contenu réel du fichier.
function parseImageUpload(body) {
  const mimeType = String(body?.mimeType || '').trim().toLowerCase();
  const extension = HERO_PROMO_IMAGE_MIME_TYPES[mimeType];
  if (!extension) {
    throw createImageError('Format non pris en charge : WebP, PNG ou JPEG.');
  }
  const dataBase64 = typeof body?.dataBase64 === 'string' ? body.dataBase64 : '';
  if (!dataBase64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(dataBase64)) {
    throw createImageError('Fichier illisible.');
  }
  const buffer = Buffer.from(dataBase64, 'base64');
  if (buffer.length === 0) {
    throw createImageError('Fichier vide.');
  }
  if (buffer.length > MAX_HERO_PROMO_IMAGE_BYTES) {
    throw createImageError(`Image trop lourde : ${Math.round(MAX_HERO_PROMO_IMAGE_BYTES / 1024)} Ko au plus.`);
  }
  if (detectImageExtension(buffer) !== extension) {
    throw createImageError('Le contenu du fichier ne correspond pas à son format.');
  }
  return { mimeType, extension, buffer };
}

async function saveHeroPromoImage(pool, { mimeType, extension, buffer }, adminId = null) {
  const id = crypto.randomBytes(8).toString('hex');
  await pool.execute(
    'INSERT INTO hero_promo_images (id, mime_type, byte_size, data, created_by) VALUES (?, ?, ?, ?, ?)',
    [id, mimeType, buffer.length, buffer, adminId === null || adminId === undefined ? null : String(adminId).slice(0, 255)]
  );
  return { id, path: `${HERO_PROMO_IMAGE_PATH_PREFIX}${id}.${extension}`, byteSize: buffer.length };
}

// Petit cache par worker : les images sont immuables (un nouvel envoi crée
// un nouvel identifiant), le navigateur et le CDN les gardent ensuite.
const imageCache = new Map();

async function readHeroPromoImage(pool, id) {
  if (!IMAGE_ID_PATTERN.test(String(id))) return null;
  const cached = imageCache.get(id);
  if (cached) {
    imageCache.delete(id);
    imageCache.set(id, cached);
    return cached;
  }
  const [rows] = await pool.execute(
    'SELECT mime_type, data FROM hero_promo_images WHERE id = ? LIMIT 1',
    [id]
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return null;
  const image = { mimeType: String(row.mime_type), data: Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data) };
  imageCache.set(id, image);
  while (imageCache.size > IMAGE_CACHE_MAX_ENTRIES) {
    imageCache.delete(imageCache.keys().next().value);
  }
  return image;
}

// Efface les images qu'aucune promo n'utilise plus, après un délai de grâce
// pour ne pas perdre celle d'un brouillon pas encore enregistré.
async function pruneHeroPromoImages(pool, settings) {
  const used = new Set();
  for (const promo of mergeStoredSettings(settings).promos) {
    for (const ref of [promo.imageUrl, promo.mobileImageUrl, promo.logoUrl]) {
      const id = getImageIdFromRef(ref);
      if (id) used.add(id);
    }
  }
  const ids = [...used];
  const keep = ids.length > 0 ? ` AND id NOT IN (${ids.map(() => '?').join(', ')})` : '';
  const [result] = await pool.execute(
    `DELETE FROM hero_promo_images
      WHERE created_at < (NOW() - INTERVAL ${ORPHAN_IMAGE_GRACE_DAYS} DAY)${keep}`,
    ids
  );
  for (const id of [...imageCache.keys()]) {
    if (!used.has(id)) imageCache.delete(id);
  }
  return Number(result?.affectedRows) || 0;
}

module.exports = {
  DEFAULT_HERO_PROMO_SETTINGS,
  HERO_PROMO_SETTINGS_ERROR_CODE,
  HERO_PROMO_IMAGE_ERROR_CODE,
  HERO_PROMO_PAGES,
  HERO_PROMO_LANGUAGES,
  HERO_PROMO_MIN_AGES,
  HERO_PROMO_TEXT_LIMITS,
  MAX_HERO_PROMOS,
  MAX_HERO_PROMO_POSITION,
  MAX_PROMOS_PER_CAROUSEL,
  MAX_HERO_PROMO_IMAGE_BYTES,
  PROMO_ID_PATTERN,
  getDefaultHeroPromoSettings,
  mergeStoredSettings,
  validateSettingsInput,
  buildPublicHeroPromos,
  buildPublicHeroPromoConfig,
  findHeroPromoForClick,
  loadHeroPromoSettings,
  saveHeroPromoSettings,
  resetHeroPromoSettingsCache,
  recordHeroPromoClick,
  readHeroPromoClickStats,
  parseImageUpload,
  saveHeroPromoImage,
  readHeroPromoImage,
  pruneHeroPromoImages
};
