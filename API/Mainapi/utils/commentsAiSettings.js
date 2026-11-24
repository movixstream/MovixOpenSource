'use strict';

const crypto = require('node:crypto');
const { getTable, renderCreateTable } = require('../db/schema');

// Réglages de l'IA des commentaires (modération et spoilers), modifiés depuis
// l'onglet « IA » de la modération des commentaires et rangés dans une seule
// ligne MySQL (id = 1). Sans ligne en base, les variables d'environnement
// servent de réglages. Le frontend dépend de la forme renvoyée par
// `toAdminView` : type `CommentsAiSettings` de src/services/commentsAiAdminService.ts.
//
// Les clés API sont chiffrées en base (AES-256-GCM, clé tirée de JWT_SECRET)
// et ne sortent jamais en clair : l'admin n'en voit que les 4 derniers signes.

const COMMENTS_AI_SETTINGS_TABLE = 'comments_ai_settings';
const ROW_ID = 1;
const CACHE_TTL_MS = 10 * 1000;

const PROVIDERS = Object.freeze(['claude', 'openrouter', 'off']);
const CLAUDE_EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);
const OPENROUTER_EFFORTS = Object.freeze(['low', 'medium', 'high']);
const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';
const DEFAULT_CLAUDE_EFFORT = 'medium';
const DEFAULT_OPENROUTER_MODEL = 'anthropic/claude-haiku-5.5';
const DEFAULT_OPENROUTER_EFFORT = 'low';
const MODEL_PATTERN = /^[a-z0-9][a-z0-9._:/-]{1,99}$/i;
const API_KEY_PATTERN = /^sk-[A-Za-z0-9_-]{16,300}$/;
const ENCRYPTED_PREFIX = 'v1:';

const COMMENTS_AI_ERROR_CODES = Object.freeze({ settingsInvalid: 'COMMENTS_AI_SETTINGS_INVALID' });

function invalid(message) {
  const error = new Error(message);
  error.code = COMMENTS_AI_ERROR_CODES.settingsInvalid;
  return error;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function pickModel(value, fallback) {
  return typeof value === 'string' && MODEL_PATTERN.test(value.trim()) ? value.trim() : fallback;
}

// ─── Chiffrement des clés ──────────────────────────────────────────────────

function encryptionKey(env) {
  const secret = env.COMMENTS_AI_SECRET || env.JWT_SECRET;
  if (!secret) return null;
  return crypto.createHash('sha256').update(`movix-comments-ai:${secret}`).digest();
}

function encryptApiKey(plain, env = process.env) {
  const key = encryptionKey(env);
  if (!key) throw invalid('Secret serveur absent (JWT_SECRET) : impossible de ranger une clé.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ENCRYPTED_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

// null si la valeur est absente ou illisible (JWT_SECRET changé depuis).
function decryptApiKey(stored, env = process.env) {
  if (typeof stored !== 'string' || !stored.startsWith(ENCRYPTED_PREFIX)) return null;
  const key = encryptionKey(env);
  if (!key) return null;
  try {
    const raw = Buffer.from(stored.slice(ENCRYPTED_PREFIX.length), 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

// ─── Formes ────────────────────────────────────────────────────────────────

// Réglages par défaut tirés de l'environnement (aucune clé rangée en base).
function getDefaultCommentsAiSettings(env = process.env) {
  return {
    provider: env.ANTHROPIC_API_KEY ? 'claude' : env.OPENROUTER_API_KEY ? 'openrouter' : 'off',
    spoilerDetection: true,
    fallbackToOpenRouter: true,
    claude: {
      model: pickModel(env.COMMENTS_AI_MODEL, DEFAULT_CLAUDE_MODEL),
      effort: pick(env.COMMENTS_AI_EFFORT, CLAUDE_EFFORTS, DEFAULT_CLAUDE_EFFORT),
      apiKey: null
    },
    openrouter: {
      model: DEFAULT_OPENROUTER_MODEL,
      effort: DEFAULT_OPENROUTER_EFFORT,
      apiKey: null
    }
  };
}

// Relit une ligne stockée en complétant ce qui manque par les défauts.
function mergeStoredSettings(raw, env = process.env) {
  let source = raw;
  if (typeof raw === 'string') {
    try { source = JSON.parse(raw); } catch { source = null; }
  }
  const defaults = getDefaultCommentsAiSettings(env);
  if (!isPlainObject(source)) return defaults;
  const claude = isPlainObject(source.claude) ? source.claude : {};
  const openrouter = isPlainObject(source.openrouter) ? source.openrouter : {};
  return {
    provider: pick(source.provider, PROVIDERS, defaults.provider),
    spoilerDetection: typeof source.spoilerDetection === 'boolean' ? source.spoilerDetection : defaults.spoilerDetection,
    fallbackToOpenRouter: typeof source.fallbackToOpenRouter === 'boolean' ? source.fallbackToOpenRouter : defaults.fallbackToOpenRouter,
    claude: {
      model: pickModel(claude.model, defaults.claude.model),
      effort: pick(claude.effort, CLAUDE_EFFORTS, defaults.claude.effort),
      apiKey: typeof claude.apiKey === 'string' ? claude.apiKey : null
    },
    openrouter: {
      model: pickModel(openrouter.model, defaults.openrouter.model),
      effort: pick(openrouter.effort, OPENROUTER_EFFORTS, defaults.openrouter.effort),
      apiKey: typeof openrouter.apiKey === 'string' ? openrouter.apiKey : null
    }
  };
}

function validateProviderInput(input, current, efforts, label, env) {
  const source = isPlainObject(input) ? input : {};
  const next = { ...current };
  if (source.model !== undefined) {
    if (typeof source.model !== 'string' || !MODEL_PATTERN.test(source.model.trim())) {
      throw invalid(`${label} : nom de modèle invalide.`);
    }
    next.model = source.model.trim();
  }
  if (source.effort !== undefined) {
    if (!efforts.includes(source.effort)) throw invalid(`${label} : effort invalide.`);
    next.effort = source.effort;
  }
  if (source.clearApiKey === true) {
    next.apiKey = null;
  } else if (typeof source.apiKey === 'string' && source.apiKey.trim()) {
    const apiKey = source.apiKey.trim();
    if (!API_KEY_PATTERN.test(apiKey)) throw invalid(`${label} : la clé API doit commencer par « sk- ».`);
    next.apiKey = encryptApiKey(apiKey, env);
  }
  return next;
}

// Applique un brouillon admin sur les réglages stockés. Une clé absente du
// brouillon reste celle déjà rangée ; `clearApiKey: true` la retire.
function validateSettingsInput(input, current, env = process.env) {
  if (!isPlainObject(input)) throw invalid('Réglages manquants.');
  const base = current || getDefaultCommentsAiSettings(env);
  if (input.provider !== undefined && !PROVIDERS.includes(input.provider)) {
    throw invalid('Fournisseur inconnu.');
  }
  for (const field of ['spoilerDetection', 'fallbackToOpenRouter']) {
    if (input[field] !== undefined && typeof input[field] !== 'boolean') throw invalid(`${field} doit être vrai ou faux.`);
  }
  return {
    provider: input.provider ?? base.provider,
    spoilerDetection: input.spoilerDetection ?? base.spoilerDetection,
    fallbackToOpenRouter: input.fallbackToOpenRouter ?? base.fallbackToOpenRouter,
    claude: validateProviderInput(input.claude, base.claude, CLAUDE_EFFORTS, 'Claude Platform', env),
    openrouter: validateProviderInput(input.openrouter, base.openrouter, OPENROUTER_EFFORTS, 'OpenRouter', env)
  };
}

function resolveKey(stored, envValue, env) {
  if (stored) {
    const plain = decryptApiKey(stored, env);
    if (plain) return { apiKey: plain, source: 'admin', unreadable: false };
    if (envValue) return { apiKey: envValue, source: 'env', unreadable: true };
    return { apiKey: null, source: null, unreadable: true };
  }
  return envValue ? { apiKey: envValue, source: 'env', unreadable: false } : { apiKey: null, source: null, unreadable: false };
}

// Réglages prêts à l'emploi pour la modération : clés en clair, panel d'abord,
// puis .env.
function resolveCommentsAiConfig(settings, env = process.env) {
  return {
    provider: settings.provider,
    spoilerDetection: settings.spoilerDetection,
    fallbackToOpenRouter: settings.fallbackToOpenRouter,
    claude: { ...settings.claude, apiKey: resolveKey(settings.claude.apiKey, env.ANTHROPIC_API_KEY, env).apiKey },
    openrouter: { ...settings.openrouter, apiKey: resolveKey(settings.openrouter.apiKey, env.OPENROUTER_API_KEY, env).apiKey }
  };
}

function keyView(stored, envValue, env) {
  const { apiKey, source, unreadable } = resolveKey(stored, envValue, env);
  return { set: Boolean(apiKey), source, hint: apiKey ? `…${apiKey.slice(-4)}` : null, unreadable };
}

// Forme envoyée à l'admin : jamais de clé en clair.
function toAdminView(settings, env = process.env) {
  return {
    provider: settings.provider,
    spoilerDetection: settings.spoilerDetection,
    fallbackToOpenRouter: settings.fallbackToOpenRouter,
    claude: {
      model: settings.claude.model,
      effort: settings.claude.effort,
      key: keyView(settings.claude.apiKey, env.ANTHROPIC_API_KEY, env)
    },
    openrouter: {
      model: settings.openrouter.model,
      effort: settings.openrouter.effort,
      key: keyView(settings.openrouter.apiKey, env.OPENROUTER_API_KEY, env)
    }
  };
}

// ─── Base ──────────────────────────────────────────────────────────────────

async function ensureCommentsAiSettingsTable(pool) {
  const table = getTable(COMMENTS_AI_SETTINGS_TABLE);
  if (!table) throw new Error(`Table ${COMMENTS_AI_SETTINGS_TABLE} absente du schéma déclaratif`);
  await pool.execute(renderCreateTable(table));
}

function toIsoString(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function readRow(pool, env) {
  const [rows] = await pool.execute(
    `SELECT settings_json, updated_by, updated_at FROM ${COMMENTS_AI_SETTINGS_TABLE} WHERE id = ? LIMIT 1`,
    [ROW_ID]
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return { settings: getDefaultCommentsAiSettings(env), updatedAt: null, updatedBy: null };
  return {
    settings: mergeStoredSettings(row.settings_json, env),
    updatedAt: toIsoString(row.updated_at),
    updatedBy: row.updated_by == null ? null : String(row.updated_by)
  };
}

// Cache propre à chaque worker : un enregistrement est vu tout de suite par le
// worker qui l'a fait, et par les autres en 10 s au plus.
let cache = null;
let generation = 0;

function resetCommentsAiSettingsCache() {
  cache = null;
  generation += 1;
}

async function loadCommentsAiSettings(pool, { fresh = false, env = process.env } = {}) {
  if (!fresh && cache && cache.expiresAt > Date.now()) return structuredClone(cache.value);
  const startedAt = generation;
  const value = await readRow(pool, env);
  if (startedAt === generation) cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return structuredClone(value);
}

// Pour la modération : ne lève jamais. Base en panne ou table absente →
// dernière version connue, sinon les variables d'environnement.
async function loadCommentsAiConfig(pool, { env = process.env } = {}) {
  try {
    const { settings } = await loadCommentsAiSettings(pool, { env });
    return resolveCommentsAiConfig(settings, env);
  } catch (error) {
    if (cache) {
      cache = { ...cache, expiresAt: Date.now() + CACHE_TTL_MS };
      return resolveCommentsAiConfig(structuredClone(cache.value.settings), env);
    }
    return resolveCommentsAiConfig(getDefaultCommentsAiSettings(env), env);
  }
}

async function saveCommentsAiSettings(pool, settings, adminId = null, { env = process.env } = {}) {
  const updatedBy = adminId == null || adminId === '' ? null : String(adminId).slice(0, 255);
  await pool.execute(
    `INSERT INTO ${COMMENTS_AI_SETTINGS_TABLE} (id, settings_json, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, NOW(), NOW())
      ON DUPLICATE KEY UPDATE settings_json = VALUES(settings_json), updated_by = VALUES(updated_by), updated_at = NOW()`,
    [ROW_ID, JSON.stringify(settings), updatedBy]
  );
  generation += 1;
  const saved = await readRow(pool, env).catch(() => ({ settings, updatedAt: new Date().toISOString(), updatedBy }));
  cache = { value: saved, expiresAt: Date.now() + CACHE_TTL_MS };
  return structuredClone(saved);
}

module.exports = {
  COMMENTS_AI_SETTINGS_TABLE,
  COMMENTS_AI_ERROR_CODES,
  PROVIDERS,
  CLAUDE_EFFORTS,
  OPENROUTER_EFFORTS,
  getDefaultCommentsAiSettings,
  mergeStoredSettings,
  validateSettingsInput,
  resolveCommentsAiConfig,
  toAdminView,
  encryptApiKey,
  decryptApiKey,
  ensureCommentsAiSettingsTable,
  loadCommentsAiSettings,
  loadCommentsAiConfig,
  saveCommentsAiSettings,
  resetCommentsAiSettingsCache
};
