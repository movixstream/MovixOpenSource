'use strict';

/**
 * Parrainage. Montage : app.use('/api', router).
 *
 * - GET  /referral/config                 → { enabled } (public)
 * - GET  /referral/me                     → code, compteurs, progression du filleul, jours à récupérer
 * - POST /referral/claim { code }         → le compte récent devient filleul du code
 * - POST /referral/rewards/:id/redeem     → jours ajoutés à la clé VIP (en-tête x-access-key) ou nouvelle clé
 * - GET/PUT /admin/referral, GET /admin/referral/list, POST /admin/referral/:id/cancel
 *
 * Le filleul gagne ses jours, et le parrain les siens, quand le filleul a
 * regardé `requiredMinutes` minutes sur `requiredDays` jours différents. Ce
 * temps est celui du Wrapped (wrappedRoutes.js → utils/referralProgress.js).
 * Comptes `oauth` et `bip39` seulement.
 *
 * Garde-fous de la saisie d'un code : compte du parrain vieux d'au moins
 * `minReferrerAccountDays` jours, filleul récent, parrain et filleul à des
 * endroits différents, identifiant de navigateur obligatoire et jamais déjà
 * servi à un autre filleul, pas de filleul qui a déjà un filleul (boucles),
 * 3 filleuls au plus par IP sur 30 jours. Un jour de visionnage commence à
 * 5 h (heure de Paris) : une soirée qui passe minuit compte pour un seul.
 * L'admin peut annuler un parrainage, même validé : les jours sont repris.
 */

const crypto = require('node:crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

const { getPool } = require('../mysqlPool');
const { getAuthIfValid, isAdmin } = require('../middleware/auth');
const { createRedisRateLimitStore } = require('../utils/redisRateLimitStore');
const { invalidateVipCache } = require('../checkVip');
const {
  REFERRAL_SETTINGS_ERROR_CODE,
  loadReferralSettings,
  saveReferralSettings,
  validateSettingsInput
} = require('../utils/referralSettings');
const rules = require('../utils/referralRules');
const { forgetReferralCache } = require('../utils/referralProgress');

const router = express.Router();

const ACCOUNT_TYPES = ['oauth', 'bip39'];
const CLIENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Plusieurs filleuls derrière une même IP restent possibles (box familiale,
// réseau mobile partagé), mais pas une série de faux comptes.
const MAX_CLAIMS_PER_IP = 3;
const IP_WINDOW_DAYS = 30;
const MAX_NAME_LENGTH = 64;
const ADMIN_LIST_MAX = 100;

let _syncModule = null;
function getSyncModule() {
  if (!_syncModule) _syncModule = require('./sync');
  return _syncModule;
}

function clientIpKey(req) {
  return req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']?.split(',')[0].trim() || ipKeyGenerator(req.ip);
}

function createLimiter(prefix, max, windowMs) {
  return rateLimit({
    windowMs,
    max,
    store: createRedisRateLimitStore({ prefix: `rate-limit:referral:${prefix}:` }),
    passOnStoreError: true,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Trop de requêtes. Réessayez dans un instant.', code: 'RATE_LIMITED' },
    keyGenerator: clientIpKey,
    validate: { xForwardedForHeader: false, ip: false }
  });
}

const readLimiter = createLimiter('read', 60, 60 * 1000);
const claimLimiter = createLimiter('claim', 10, 15 * 60 * 1000);

const setNoStore = (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  return next();
};

function fail(res, status, code, error) {
  return res.status(status).json({ success: false, code, error });
}

function hashForReferral(value) {
  if (!value) return null;
  const secret = process.env.JWT_SECRET || 'movix-referral';
  return crypto.createHmac('sha256', secret).update(`referral:${value}`).digest('hex');
}

function getIpHash(req) {
  const ip = req.headers['cf-connecting-ip']
    || req.headers['x-forwarded-for']?.split(',')[0].trim()
    || req.ip
    || null;
  return hashForReferral(ip);
}

function getClientHash(req) {
  const clientId = String(req.get('x-movix-client-id') || '').trim().toLowerCase();
  return CLIENT_ID_PATTERN.test(clientId) ? hashForReferral(clientId) : null;
}

// Même correction que checkVip.js : un en-tête HTTP transporte les octets en
// Latin-1, une clé avec accents doit être relue en UTF-8.
function readAccessKeyHeader(req) {
  const raw = String(req.headers['x-access-key'] || '').trim();
  if (!raw || raw.length > 255) return null;
  try {
    const decoded = Buffer.from(raw, 'latin1').toString('utf8');
    return decoded.includes('�') ? raw : decoded;
  } catch {
    return raw;
  }
}

async function requireAccount(req, res) {
  const auth = await getAuthIfValid(req);
  if (!auth || !ACCOUNT_TYPES.includes(auth.userType) || !auth.userId) {
    fail(res, 401, 'UNAUTHORIZED', 'Connexion requise');
    return null;
  }
  return { userType: auth.userType, userId: String(auth.userId) };
}

function requirePool(res) {
  const pool = getPool();
  if (!pool) {
    fail(res, 503, 'UNAVAILABLE', 'Service temporairement indisponible');
    return null;
  }
  return pool;
}

function sameAccount(a, b) {
  return a.userType === b.userType && a.userId === b.userId;
}

// Pseudo et dates connues du compte, lus dans son fichier de données.
async function readAccountFacts(account) {
  try {
    const userData = await getSyncModule().readUserData(account.userType, account.userId);
    let profile = null;
    try {
      profile = typeof userData?.auth === 'string' ? JSON.parse(userData.auth)?.userProfile : null;
    } catch {
      profile = null;
    }
    const profileDates = Array.isArray(userData?.profiles)
      ? userData.profiles.map((item) => item?.createdAt).filter(Boolean)
      : [];
    const name = typeof profile?.username === 'string' ? profile.username.trim().slice(0, MAX_NAME_LENGTH) : null;
    return { name: name || null, dates: [profile?.createdAt, ...profileDates] };
  } catch (error) {
    console.warn('[Parrainage] Données du compte illisibles :', error?.message || error);
    return { name: null, dates: [] };
  }
}

// Création du compte = la plus ancienne trace connue : profil d'origine,
// profils Movix, première session, premier titre de l'historique, code de
// parrainage déjà ouvert. Plus ancien = plus sûr : un vieux compte ne passe
// jamais pour un nouveau.
async function getAccountCreatedAt(pool, account, facts) {
  const [sessions] = await pool.execute(
    'SELECT MIN(created_at) AS first_at FROM user_sessions WHERE user_id = ? AND user_type = ?',
    [account.userId, account.userType]
  );
  const [history] = await pool.execute(
    'SELECT MIN(last_watched_at) AS first_at FROM watch_history WHERE user_type = ? AND user_id = ?',
    [account.userType, account.userId]
  ).catch(() => [[]]);
  const [codes] = await pool.execute(
    'SELECT created_at, account_created_ms FROM referral_codes WHERE user_type = ? AND user_id = ? LIMIT 1',
    [account.userType, account.userId]
  );
  const storedMs = codes?.[0]?.account_created_ms;
  return rules.resolveAccountCreatedAt(
    ...facts.dates,
    sessions?.[0]?.first_at,
    history?.[0]?.first_at,
    codes?.[0]?.created_at,
    storedMs === null || storedMs === undefined ? null : Number(storedMs)
  );
}

// Code du compte, créé à la première demande avec la date de création du
// compte. La dernière IP et le dernier appareil du parrain sont gardés
// (empreintes) pour refuser un filleul qui serait au même endroit.
async function ensureReferralCode(pool, account, req) {
  const ipHash = getIpHash(req);
  const clientHash = getClientHash(req);
  const [rows] = await pool.execute(
    `SELECT code, last_ip_hash, last_client_hash, account_created_ms
      FROM referral_codes WHERE user_type = ? AND user_id = ? LIMIT 1`,
    [account.userType, account.userId]
  );
  const existing = rows?.[0];
  if (existing) {
    const nextIp = ipHash || existing.last_ip_hash;
    const nextClient = clientHash || existing.last_client_hash;
    if (nextIp !== existing.last_ip_hash || nextClient !== existing.last_client_hash) {
      await pool.execute(
        'UPDATE referral_codes SET last_ip_hash = ?, last_client_hash = ? WHERE user_type = ? AND user_id = ?',
        [nextIp, nextClient, account.userType, account.userId]
      );
    }
    const storedMs = existing.account_created_ms;
    return {
      code: existing.code,
      accountCreatedAt: storedMs === null || storedMs === undefined ? null : new Date(Number(storedMs))
    };
  }

  const createdAt = await getAccountCreatedAt(pool, account, await readAccountFacts(account));
  const createdMs = createdAt ? createdAt.getTime() : null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = rules.generateReferralCode();
    try {
      await pool.execute(
        `INSERT INTO referral_codes (user_type, user_id, code, last_ip_hash, last_client_hash, account_created_ms, created_at)
          VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [account.userType, account.userId, code, ipHash, clientHash, createdMs]
      );
      return { code, accountCreatedAt: createdAt };
    } catch (error) {
      if (error?.code !== 'ER_DUP_ENTRY') throw error;
      // Deux requêtes du même compte en même temps : l'autre a gagné.
      const [again] = await pool.execute(
        'SELECT code FROM referral_codes WHERE user_type = ? AND user_id = ? LIMIT 1',
        [account.userType, account.userId]
      );
      if (again?.[0]?.code) return { code: again[0].code, accountCreatedAt: createdAt };
      // Sinon le code tiré existait déjà : on en tire un autre.
    }
  }
  throw new Error('Impossible de créer un code de parrainage unique');
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildProgress(row, settings) {
  return {
    status: row.status,
    watchMinutes: Math.floor(toNumber(row.watch_seconds) / 60),
    watchDays: toNumber(row.watch_days),
    requiredMinutes: settings.requiredMinutes,
    requiredDays: settings.requiredDays
  };
}

async function readRefereeRow(pool, account) {
  const [rows] = await pool.execute(
    `SELECT id, status, watch_seconds, watch_days
      FROM referrals WHERE referee_user_type = ? AND referee_user_id = ? LIMIT 1`,
    [account.userType, account.userId]
  );
  return rows?.[0] || null;
}

// La vraie table `access_keys` n'a pas de colonne `id` : on lit `key_value`,
// comme utils/vipDonations.js.
async function generateUniqueVipKey(connection) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = `VIP-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
    const [rows] = await connection.execute('SELECT key_value FROM access_keys WHERE key_value = ? LIMIT 1', [candidate]);
    if (!rows.length) return candidate;
  }
  throw new Error('Impossible de générer une clé VIP unique');
}

function handle(label, handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      console.error(`[Parrainage] ${label} :`, error?.message || error);
      if (!res.headersSent) fail(res, 500, 'SERVER_ERROR', 'Erreur du parrainage, réessayez plus tard');
    }
  };
}

// ---------------------------------------------------------------------------
// Routes publiques et du compte
// ---------------------------------------------------------------------------

router.get('/referral/config', handle('config publique', async (req, res) => {
  const pool = getPool();
  let settings = null;
  if (pool) {
    try {
      ({ settings } = await loadReferralSettings(pool));
    } catch {
      settings = null;
    }
  }
  res.set('Cache-Control', 'public, max-age=60');
  if (!settings?.enabled) return res.json({ success: true, enabled: false });
  return res.json({
    success: true,
    enabled: true,
    rewardDays: settings.rewardDays,
    requiredMinutes: settings.requiredMinutes,
    requiredDays: settings.requiredDays
  });
}));

router.get('/referral/me', setNoStore, readLimiter, handle('lecture du compte', async (req, res) => {
  const account = await requireAccount(req, res);
  if (!account) return;
  const pool = requirePool(res);
  if (!pool) return;

  const { settings } = await loadReferralSettings(pool);
  if (!settings.enabled) return res.json({ success: true, enabled: false });

  const { code, accountCreatedAt } = await ensureReferralCode(pool, account, req);
  const [countRows] = await pool.execute(
    `SELECT status, COUNT(*) AS total FROM referrals
      WHERE referrer_user_type = ? AND referrer_user_id = ? GROUP BY status`,
    [account.userType, account.userId]
  );
  const counts = { pending: 0, rewarded: 0 };
  for (const row of countRows) {
    if (row.status in counts) counts[row.status] = toNumber(row.total);
  }
  const [rewardRows] = await pool.execute(
    `SELECT id, role, days, status FROM referral_rewards
      WHERE user_type = ? AND user_id = ? ORDER BY id ASC`,
    [account.userType, account.userId]
  );
  const daysEarned = rewardRows.reduce((sum, row) => sum + toNumber(row.days), 0);
  const rewards = rewardRows
    .filter((row) => row.status === 'available')
    .map((row) => ({ id: toNumber(row.id), role: row.role, days: toNumber(row.days) }));

  // Date gardée avec le code : la saisie la recalcule de toute façon.
  const referee = await readRefereeRow(pool, account);
  let canEnterCode = false;
  let claimDeadline = null;
  if (!referee) {
    const deadline = rules.getClaimDeadline(accountCreatedAt, settings.claimWindowDays);
    if (deadline && Date.now() <= deadline.getTime()) {
      canEnterCode = true;
      claimDeadline = deadline.toISOString();
    }
  }

  // Compte du parrain trop récent : son code ne marche pas encore.
  const codeActiveAt = rules.getCodeActiveAt(accountCreatedAt, settings.minReferrerAccountDays);

  return res.json({
    success: true,
    enabled: true,
    code,
    codeActiveAt: codeActiveAt && codeActiveAt.getTime() > Date.now() ? codeActiveAt.toISOString() : null,
    rewardDays: settings.rewardDays,
    requiredMinutes: settings.requiredMinutes,
    requiredDays: settings.requiredDays,
    stats: { invited: counts.pending + counts.rewarded, pending: counts.pending, rewarded: counts.rewarded, daysEarned },
    referee: referee ? buildProgress(referee, settings) : null,
    canEnterCode,
    claimDeadline,
    rewards
  });
}));

router.post('/referral/claim', setNoStore, claimLimiter, handle('saisie d’un code', async (req, res) => {
  const account = await requireAccount(req, res);
  if (!account) return;
  const pool = requirePool(res);
  if (!pool) return;

  const { settings } = await loadReferralSettings(pool);
  if (!settings.enabled) return fail(res, 403, 'REFERRAL_DISABLED', 'Le parrainage est fermé pour le moment');

  const code = rules.normalizeReferralCode(req.body?.code);
  if (!code) return fail(res, 400, 'INVALID_CODE', 'Ce code de parrainage n’est pas valide');

  if (await readRefereeRow(pool, account)) {
    return fail(res, 409, 'ALREADY_REFERRED', 'Ce compte a déjà un parrain');
  }

  const [ownerRows] = await pool.execute(
    `SELECT user_type, user_id, last_ip_hash, last_client_hash, account_created_ms, created_at
      FROM referral_codes WHERE code = ? LIMIT 1`,
    [code]
  );
  const owner = ownerRows?.[0];
  if (!owner) return fail(res, 404, 'CODE_NOT_FOUND', 'Ce code de parrainage n’existe pas');
  const referrer = { userType: owner.user_type, userId: String(owner.user_id) };
  if (sameAccount(referrer, account)) {
    return fail(res, 400, 'OWN_CODE', 'Tu ne peux pas utiliser ton propre code');
  }

  // Le parrain doit être un membre installé, pas un compte créé pour
  // l'occasion : son code ne marche qu'après quelques jours.
  const ownerCreatedMs = owner.account_created_ms;
  const referrerActiveAt = rules.getCodeActiveAt(
    rules.resolveAccountCreatedAt(
      ownerCreatedMs === null || ownerCreatedMs === undefined ? null : Number(ownerCreatedMs),
      owner.created_at
    ),
    settings.minReferrerAccountDays
  );
  if (!referrerActiveAt || referrerActiveAt.getTime() > Date.now()) {
    const days = settings.minReferrerAccountDays;
    return fail(res, 403, 'REFERRER_TOO_NEW', `Ce code ne marche pas encore : le compte de ton parrain doit avoir au moins ${days} jour${days > 1 ? 's' : ''}`);
  }

  const facts = await readAccountFacts(account);
  const createdAt = await getAccountCreatedAt(pool, account, facts);
  if (!rules.isWithinClaimWindow(createdAt, new Date(), settings.claimWindowDays)) {
    return fail(res, 403, 'ACCOUNT_TOO_OLD', `Un code se rentre dans les ${settings.claimWindowDays} jours qui suivent l’inscription`);
  }

  const ipHash = getIpHash(req);
  const clientHash = getClientHash(req);
  // Le site envoie toujours l'identifiant du navigateur : sans lui, la
  // demande ne vient pas du site.
  if (!clientHash) {
    return fail(res, 400, 'CLIENT_REQUIRED', 'Appareil non reconnu : recharge la page puis réessaie');
  }
  if ((ipHash && ipHash === owner.last_ip_hash) || clientHash === owner.last_client_hash) {
    return fail(res, 403, 'SAME_PLACE', 'Ton parrain et toi devez utiliser des appareils et des connexions différents');
  }

  // Un navigateur ne sert qu'à un seul filleul : pas de série de comptes
  // créés au même endroit, même en changeant de connexion.
  const [deviceRows] = await pool.execute(
    'SELECT id FROM referrals WHERE client_hash = ? LIMIT 1',
    [clientHash]
  );
  if (deviceRows.length) {
    return fail(res, 403, 'DEVICE_ALREADY_USED', 'Un code de parrainage a déjà été utilisé sur cet appareil');
  }

  // Un compte qui a déjà un filleul ne peut plus en devenir un. Cela ferme
  // toutes les boucles (A → B → A, A → B → C → A…) : le compte qui referme
  // la boucle est toujours déjà parrain. Une chaîne reste permise : un
  // filleul peut parrainer à son tour.
  const [circular] = await pool.execute(
    'SELECT id FROM referrals WHERE referrer_user_type = ? AND referrer_user_id = ? LIMIT 1',
    [account.userType, account.userId]
  );
  if (circular.length) return fail(res, 400, 'CIRCULAR', 'Tu as déjà un filleul : tu ne peux plus entrer de code');

  if (ipHash) {
    const [ipRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM referrals
        WHERE ip_hash = ? AND created_at > (NOW() - INTERVAL ${IP_WINDOW_DAYS} DAY)`,
      [ipHash]
    );
    if (toNumber(ipRows?.[0]?.total) >= MAX_CLAIMS_PER_IP) {
      return fail(res, 429, 'IP_LIMIT', 'Trop de parrainages depuis cette connexion');
    }
  }

  const referrerFacts = await readAccountFacts(referrer);
  try {
    await pool.execute(
      `INSERT INTO referrals
        (referrer_user_type, referrer_user_id, referee_user_type, referee_user_id, code,
          referrer_name, referee_name, ip_hash, client_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        referrer.userType, referrer.userId, account.userType, account.userId, code,
        referrerFacts.name, facts.name, ipHash, clientHash
      ]
    );
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') return fail(res, 409, 'ALREADY_REFERRED', 'Ce compte a déjà un parrain');
    throw error;
  }
  // Ce worker compte les minutes du Wrapped tout de suite (les autres en 2 min au plus).
  forgetReferralCache(account);

  return res.json({
    success: true,
    referrerName: referrerFacts.name,
    rewardDays: settings.rewardDays,
    requiredMinutes: settings.requiredMinutes,
    requiredDays: settings.requiredDays
  });
}));

router.post('/referral/rewards/:id/redeem', setNoStore, readLimiter, handle('récupération des jours', async (req, res) => {
  const account = await requireAccount(req, res);
  if (!account) return;
  const pool = requirePool(res);
  if (!pool) return;

  const rewardId = /^\d{1,10}$/.test(String(req.params.id)) ? Number(req.params.id) : null;
  if (!rewardId) return fail(res, 400, 'INVALID_REWARD', 'Récompense inconnue');

  const connection = await pool.getConnection();
  let result;
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT id, days, status, access_key FROM referral_rewards
        WHERE id = ? AND user_type = ? AND user_id = ? LIMIT 1 FOR UPDATE`,
      [rewardId, account.userType, account.userId]
    );
    const reward = rows[0];
    if (!reward) {
      await connection.rollback();
      return fail(res, 404, 'INVALID_REWARD', 'Récompense inconnue');
    }

    if (reward.status === 'redeemed') {
      // Déjà récupérée (autre onglet, autre appareil) : on renvoie la clé.
      const [keyRows] = await connection.execute(
        'SELECT expires_at FROM access_keys WHERE key_value = ? LIMIT 1',
        [reward.access_key]
      );
      await connection.commit();
      const expires = keyRows?.[0]?.expires_at;
      result = {
        accessKey: reward.access_key,
        expiresAt: expires === null || expires === undefined ? null : toNumber(expires),
        extended: true,
        alreadyRedeemed: true
      };
    } else {
      const days = toNumber(reward.days);
      const nowMs = Date.now();
      let keyValue = null;
      let expiresAt = null;
      let extended = false;

      const providedKey = readAccessKeyHeader(req);
      if (providedKey) {
        const [keyRows] = await connection.execute(
          'SELECT key_value, active, expires_at FROM access_keys WHERE key_value = ? LIMIT 1 FOR UPDATE',
          [providedKey]
        );
        const key = keyRows[0];
        const keyExpires = key?.expires_at === null || key?.expires_at === undefined ? null : toNumber(key.expires_at);
        if (key && key.active && (keyExpires === null || keyExpires > nowMs)) {
          keyValue = key.key_value;
          extended = true;
          // Clé à vie : rien à ajouter.
          if (keyExpires !== null) {
            expiresAt = rules.extendExpiry(keyExpires, nowMs, days);
            await connection.execute(
              'UPDATE access_keys SET expires_at = ?, updated_at = NOW() WHERE key_value = ?',
              [expiresAt, keyValue]
            );
          }
        }
      }

      if (!keyValue) {
        keyValue = await generateUniqueVipKey(connection);
        expiresAt = nowMs + days * rules.DAY_MS;
        // Clé taguée `referral` (colonne `source`, ajoutée au démarrage).
        await connection.execute(
          `INSERT INTO access_keys (key_value, active, used, duree_validite, expires_at, source, created_at, updated_at)
            VALUES (?, 1, 0, ?, ?, 'referral', NOW(), NOW())`,
          [keyValue, rules.buildDurationLabel(days), expiresAt]
        );
      }

      await connection.execute(
        "UPDATE referral_rewards SET status = 'redeemed', access_key = ?, redeemed_at = NOW() WHERE id = ?",
        [keyValue, reward.id]
      );
      await connection.commit();
      result = { accessKey: keyValue, expiresAt, extended, days };
    }
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }

  invalidateVipCache(result.accessKey);
  return res.json({ success: true, ...result });
}));

// ---------------------------------------------------------------------------
// Routes admin
// ---------------------------------------------------------------------------

async function readAdminStats(pool) {
  const [statusRows] = await pool.execute('SELECT status, COUNT(*) AS total FROM referrals GROUP BY status');
  const counts = { pending: 0, rewarded: 0, cancelled: 0 };
  for (const row of statusRows) {
    if (row.status in counts) counts[row.status] = toNumber(row.total);
  }
  const [rewardRows] = await pool.execute(
    'SELECT status, COALESCE(SUM(days), 0) AS days FROM referral_rewards GROUP BY status'
  );
  const days = { available: 0, redeemed: 0 };
  for (const row of rewardRows) {
    if (row.status in days) days[row.status] = toNumber(row.days);
  }
  return { ...counts, daysGranted: days.available + days.redeemed, daysRedeemed: days.redeemed };
}

router.get('/admin/referral', setNoStore, isAdmin, handle('lecture admin', async (req, res) => {
  const pool = requirePool(res);
  if (!pool) return;
  const { settings, updatedAt, updatedBy } = await loadReferralSettings(pool, { fresh: true });
  const stats = await readAdminStats(pool);
  return res.json({ success: true, settings, updatedAt, updatedBy, stats });
}));

router.put('/admin/referral', setNoStore, isAdmin, async (req, res) => {
  try {
    const pool = requirePool(res);
    if (!pool) return undefined;
    const current = await loadReferralSettings(pool, { fresh: true });
    const settings = validateSettingsInput(req.body?.settings, current.settings);
    const saved = await saveReferralSettings(pool, settings, req.admin?.userId || null);
    return res.json({ success: true, settings: saved.settings, updatedAt: saved.updatedAt, updatedBy: saved.updatedBy });
  } catch (error) {
    if (error?.code === REFERRAL_SETTINGS_ERROR_CODE) return fail(res, 400, error.code, error.message);
    console.error('[Parrainage] Enregistrement des réglages impossible :', error?.message || error);
    return fail(res, 500, 'SERVER_ERROR', 'Impossible d’enregistrer les réglages du parrainage');
  }
});

router.get('/admin/referral/list', setNoStore, isAdmin, handle('liste admin', async (req, res) => {
  const pool = requirePool(res);
  if (!pool) return;
  const status = ['pending', 'rewarded', 'cancelled'].includes(req.query.status) ? req.query.status : null;
  const rawLimit = Number(req.query.limit);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, ADMIN_LIST_MAX) : 50;
  const { settings } = await loadReferralSettings(pool);

  // LIMIT en entier validé ci-dessus : mysql2 refuse un LIMIT en paramètre lié.
  const [rows] = await pool.execute(
    `SELECT id, referrer_user_type, referrer_user_id, referrer_name, referee_user_type, referee_user_id,
        referee_name, code, status, watch_seconds, watch_days, created_at, rewarded_at, cancelled_at
      FROM referrals ${status ? 'WHERE status = ?' : ''} ORDER BY id DESC LIMIT ${limit}`,
    status ? [status] : []
  );
  return res.json({
    success: true,
    items: rows.map((row) => ({
      id: toNumber(row.id),
      code: row.code,
      status: row.status,
      referrer: { userType: row.referrer_user_type, userId: String(row.referrer_user_id), name: row.referrer_name || null },
      referee: { userType: row.referee_user_type, userId: String(row.referee_user_id), name: row.referee_name || null },
      watchMinutes: Math.floor(toNumber(row.watch_seconds) / 60),
      watchDays: toNumber(row.watch_days),
      requiredMinutes: settings.requiredMinutes,
      requiredDays: settings.requiredDays,
      createdAt: toIso(row.created_at),
      rewardedAt: toIso(row.rewarded_at),
      cancelledAt: toIso(row.cancelled_at)
    }))
  });
}));

// Annule un parrainage en attente ou déjà validé. Le filleul reste lié à ce
// parrainage : il ne peut pas recommencer avec un autre code. Pour un
// parrainage validé, les jours gagnés sont repris des deux côtés : les
// récompenses pas encore récupérées sont effacées, les jours déjà ajoutés
// sont retirés de la clé VIP.
router.post('/admin/referral/:id/cancel', setNoStore, isAdmin, handle('annulation admin', async (req, res) => {
  const pool = requirePool(res);
  if (!pool) return;
  const id = /^\d{1,10}$/.test(String(req.params.id)) ? Number(req.params.id) : null;
  if (!id) return fail(res, 400, 'INVALID_REFERRAL', 'Parrainage inconnu');

  const cancelledBy = req.admin?.userId ? String(req.admin.userId).slice(0, 255) : null;
  const shortenedKeys = [];
  let removedDays = 0;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT status FROM referrals WHERE id = ? LIMIT 1 FOR UPDATE', [id]);
    const referral = rows[0];
    if (!referral || referral.status === 'cancelled') {
      await connection.rollback();
      return referral
        ? fail(res, 409, 'ALREADY_CANCELLED', 'Ce parrainage est déjà annulé')
        : fail(res, 404, 'INVALID_REFERRAL', 'Parrainage inconnu');
    }

    const [rewards] = await connection.execute(
      'SELECT days, status, access_key FROM referral_rewards WHERE referral_id = ? FOR UPDATE',
      [id]
    );
    for (const reward of rewards) {
      const days = toNumber(reward.days);
      removedDays += days;
      if (reward.status !== 'redeemed' || !reward.access_key) continue;
      // Clé à vie (expires_at NULL) : aucun jour n'avait été ajouté.
      await connection.execute(
        'UPDATE access_keys SET expires_at = expires_at - ?, updated_at = NOW() WHERE key_value = ? AND expires_at IS NOT NULL',
        [days * rules.DAY_MS, reward.access_key]
      );
      shortenedKeys.push(reward.access_key);
    }
    await connection.execute('DELETE FROM referral_rewards WHERE referral_id = ?', [id]);
    await connection.execute(
      "UPDATE referrals SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = ? WHERE id = ?",
      [cancelledBy, id]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }

  for (const key of shortenedKeys) invalidateVipCache(key);
  return res.json({ success: true, removedDays });
}));

module.exports = { router };
