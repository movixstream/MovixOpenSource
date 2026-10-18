/**
 * Liaison d'une télé à un compte par code à 5 caractères.
 * Mount point: app.use('/api/tv/link', router)
 *
 * Contrat : app-tv/docs/plans/2026-10-15-phase4-liaison-compte.md (section API).
 *
 * Parcours :
 *  1. la télé appelle POST /start et affiche `userCode` (+ QR) ;
 *  2. le site (utilisateur connecté) lit GET /info puis POST /confirm avec un
 *     profil : une vraie ligne `user_sessions` (deviceType 'tv') est créée et un
 *     JWT Movix normal est émis ;
 *  3. la télé interroge POST /poll et reçoit ce JWT une seule fois.
 *
 * Tout l'état vit dans Redis (12 workers recyclés : rien en mémoire de worker).
 * Sans Redis, les routes répondent 503.
 *
 * Clés :
 *  - tvlink:dev:<sha256(deviceCode)>  JSON de la liaison (TTL 600 s, puis 120 s une fois approuvée)
 *  - tvlink:code:<userCode>           sha256(deviceCode) (TTL 600 s, supprimée à la confirmation)
 *  - tvlink:poll:<sha256(deviceCode)> dernier appel accepté de /poll (PX 4000) : sert au slow_down
 *  - tvlink:fail:<userType>:<userId>  codes faux de l'utilisateur (TTL 600 s)
 *
 * Le `deviceCode` n'est jamais stocké en clair et aucun code ni jeton n'est journalisé.
 */

const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

const { issueJwt, getAuthIfValid } = require('../middleware/auth');
const { redis } = require('../config/redis');
const { createRedisRateLimitStore } = require('../utils/redisRateLimitStore');
const { ensureSafeProfileId, getOwnedProfile, SyncPolicyError } = require('../utils/syncPolicy');

const router = express.Router();

// Modules voisins chargés à la demande (évite les dépendances circulaires au montage).
let _syncModule = null;
let _authRoutes = null;
let _oauthModule = null;
const getSyncModule = () => (_syncModule ||= require('./sync'));
const getAuthRoutes = () => (_authRoutes ||= require('./authRoutes'));
const getOauthModule = () => (_oauthModule ||= require('./oauth'));

// === Constantes du contrat ===

const LINK_TTL_SECONDS = 600;
const APPROVED_TTL_MS = 120_000;
const POLL_INTERVAL_SECONDS = 5;
const SLOW_DOWN_MS = 4000;
const USER_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const USER_CODE_LENGTH = 5;
const USER_CODE_PATTERN = new RegExp(`^[${USER_CODE_ALPHABET}]{${USER_CODE_LENGTH}}$`);
const USER_CODE_ATTEMPTS = 8;
const DEVICE_CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CLIENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEVICE_NAME_MAX = 40;
const DEFAULT_DEVICE_NAME = 'Movix TV';
const MAX_WRONG_CODES = 5;
const WRONG_CODE_WINDOW_SECONDS = 600;
const DEFAULT_PUBLIC_SITE_URL = 'https://movix.luxe';

const KEY_DEV = (hash) => `tvlink:dev:${hash}`;
const KEY_CODE = (code) => `tvlink:code:${code}`;
const KEY_POLL = (hash) => `tvlink:poll:${hash}`;
const KEY_FAIL = (userType, userId) => `tvlink:fail:${userType}:${userId}`;

// Caractères de contrôle, invisibles, de direction et séparateurs de ligne :
// retirés du nom affiché sur le site.
const UNSAFE_NAME_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

// === Limites par IP (même générateur que authRoutes / sync) ===

const clientIpKey = (req) => req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']?.split(',')[0].trim() || ipKeyGenerator(req.ip);

function createLimiter(prefix, windowMs, max) {
  return rateLimit({
    windowMs,
    max,
    store: createRedisRateLimitStore({ prefix: `rate-limit:tvlink:${prefix}:`, windowMs }),
    passOnStoreError: true,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'rate_limited' },
    keyGenerator: clientIpKey,
    validate: { xForwardedForHeader: false, ip: false }
  });
}

const startRateLimit = createLimiter('start', 10 * 60 * 1000, 10);
const pollRateLimit = createLimiter('poll', 60 * 1000, 40);
// Garde-fou par IP en plus du compteur de codes faux par utilisateur.
const siteRateLimit = createLimiter('site', 10 * 60 * 1000, 60);

// === Redis ===

class TvLinkUnavailableError extends Error {}

function getRedis() {
  if (!redis || (redis.status !== undefined && redis.status !== 'ready')) {
    throw new TvLinkUnavailableError('redis_unavailable');
  }
  return redis;
}

async function withRedis(task) {
  const client = getRedis();
  try {
    return await task(client);
  } catch {
    throw new TvLinkUnavailableError('redis_unavailable');
  }
}

// GET puis DEL dans une même transaction MULTI : un seul appelant obtient la valeur.
async function takeKey(key) {
  return withRedis(async (client) => {
    const results = await client.multi().get(key).del(key).exec();
    if (!Array.isArray(results) || results[0]?.[0]) throw new Error('multi_failed');
    return results[0][1] || null;
  });
}

// === Utilitaires ===

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function generateUserCode() {
  let code = '';
  for (let i = 0; i < USER_CODE_LENGTH; i++) {
    code += USER_CODE_ALPHABET[crypto.randomInt(USER_CODE_ALPHABET.length)];
  }
  return code;
}

function parseEntry(raw) {
  if (typeof raw !== 'string') return null;
  try {
    const entry = JSON.parse(raw);
    return entry && typeof entry === 'object' ? entry : null;
  } catch {
    return null;
  }
}

function normalizeDeviceName(value) {
  if (value === undefined || value === null) return { ok: true, name: DEFAULT_DEVICE_NAME };
  if (typeof value !== 'string') return { ok: false };
  const name = value.replace(UNSAFE_NAME_CHARS, '').replace(/\s+/g, ' ').trim();
  if (Array.from(name).length > DEVICE_NAME_MAX) return { ok: false };
  return { ok: true, name: name || DEFAULT_DEVICE_NAME };
}

function normalizeUserCode(value) {
  if (typeof value !== 'string' || value.length > 16) return null;
  const code = value.trim().toUpperCase();
  return USER_CODE_PATTERN.test(code) ? code : null;
}

function getPublicSiteUrl() {
  const raw = String(process.env.PUBLIC_SITE_URL || '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\s]+$/i.test(raw) ? raw : DEFAULT_PUBLIC_SITE_URL;
}

function sendError(res, error, scope) {
  if (error instanceof TvLinkUnavailableError) {
    return res.status(503).json({ error: 'service_unavailable' });
  }
  console.error(`[TV-LINK] ${scope} :`, error?.message || 'erreur inconnue');
  return res.status(500).json({ error: 'internal_error' });
}

async function requireSiteAuth(req, res) {
  const auth = await getAuthIfValid(req);
  if (!auth || !['oauth', 'bip39'].includes(auth.userType)) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  return auth;
}

async function isWrongCodeLimited(auth) {
  const count = await withRedis((client) => client.get(KEY_FAIL(auth.userType, auth.userId)));
  return Number(count || 0) >= MAX_WRONG_CODES;
}

async function recordWrongCode(auth) {
  const key = KEY_FAIL(auth.userType, auth.userId);
  await withRedis(async (client) => {
    const count = Number(await client.incr(key));
    if (count === 1) {
      await client.expire(key, WRONG_CODE_WINDOW_SECONDS);
    } else if (Number(await client.ttl(key)) < 0) {
      await client.expire(key, WRONG_CODE_WINDOW_SECONDS);
    }
  });
}

/**
 * Retrouve une liaison en attente à partir du code affiché.
 * Renvoie null si le code est inconnu, expiré ou déjà confirmé.
 */
async function findPendingLink(userCode) {
  return withRedis(async (client) => {
    const codeKey = KEY_CODE(userCode);
    const hash = await client.get(codeKey);
    if (!hash) return null;
    const entry = parseEntry(await client.get(KEY_DEV(hash)));
    if (!entry || entry.status !== 'pending' || entry.userCode !== userCode) return null;
    const ttlMs = Number(await client.pttl(codeKey));
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) return null;
    return { hash, entry, ttlMs };
  });
}

/**
 * `access_keys.expires_at` est un BIGINT en millisecondes : la télé attend une
 * date ISO (chaîne). Un nombre fait échouer sa lecture de /poll, et comme la
 * réponse « approved » n'est remise qu'une fois, la liaison est perdue.
 */
function toIsoDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const asNumber = typeof value === 'number' ? value : (/^\d+$/.test(String(value)) ? Number(value) : NaN);
  const date = Number.isFinite(asNumber) ? new Date(asNumber) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Clé VIP du profil choisi, revérifiée comme `buildVipIdentity` (oauth.js) :
 * seule `access_code` compte, contrôlée par `verifyAccessKey`, jamais `is_vip`.
 */
async function resolveProfileVip(profileData) {
  const { buildVipIdentity, extractStringField } = getOauthModule();
  const identity = await buildVipIdentity(null, profileData || null);
  const active = identity?.active === true;
  return {
    active,
    expiresAt: active ? toIsoDate(identity.expiresAt) : null,
    accessKey: active ? (extractStringField(profileData, 'access_code') || null) : null,
  };
}

// === Routes ===

// POST /start — télé, sans compte
router.post('/start', startRateLimit, async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const deviceName = normalizeDeviceName(body.deviceName);
    const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : '';
    if (!deviceName.ok || !CLIENT_ID_PATTERN.test(clientId)) {
      return res.status(400).json({ error: 'invalid_request' });
    }

    const deviceCode = crypto.randomBytes(32).toString('base64url');
    const hash = sha256(deviceCode);
    const entry = {
      userCode: null,
      deviceName: deviceName.name,
      clientId: clientId.toLowerCase(),
      status: 'pending',
      createdAt: Date.now(),
      // Champ du contrat laissé à null : le dernier appel vit dans tvlink:poll:<hash>
      // (voir /poll), pour ne jamais réécrire l'entrée en même temps que /confirm.
      lastPollAt: null,
    };

    const userCode = await withRedis(async (client) => {
      for (let attempt = 0; attempt < USER_CODE_ATTEMPTS; attempt++) {
        const candidate = generateUserCode();
        // SET NX : le code reste unique parmi les liaisons vivantes.
        const reserved = await client.set(KEY_CODE(candidate), hash, 'EX', LINK_TTL_SECONDS, 'NX');
        if (reserved === 'OK') {
          entry.userCode = candidate;
          await client.set(KEY_DEV(hash), JSON.stringify(entry), 'EX', LINK_TTL_SECONDS);
          return candidate;
        }
      }
      return null;
    });

    if (!userCode) {
      console.error('[TV-LINK] start : aucun code libre après plusieurs essais');
      return res.status(503).json({ error: 'service_unavailable' });
    }

    return res.status(200).json({
      deviceCode,
      userCode,
      verificationUrl: `${getPublicSiteUrl()}/tv?code=${userCode}`,
      expiresIn: LINK_TTL_SECONDS,
      interval: POLL_INTERVAL_SECONDS,
    });
  } catch (error) {
    return sendError(res, error, 'start');
  }
});

// GET /info?code=K7P2Q — site, connecté
router.get('/info', siteRateLimit, async (req, res) => {
  try {
    const auth = await requireSiteAuth(req, res);
    if (!auth) return undefined;
    if (await isWrongCodeLimited(auth)) return res.status(429).json({ error: 'too_many_attempts' });

    const userCode = normalizeUserCode(req.query?.code);
    const link = userCode ? await findPendingLink(userCode) : null;
    if (!link) {
      await recordWrongCode(auth);
      return res.status(404).json({ error: 'code_invalid' });
    }

    return res.status(200).json({
      deviceName: link.entry.deviceName || DEFAULT_DEVICE_NAME,
      expiresIn: Math.ceil(link.ttlMs / 1000),
    });
  } catch (error) {
    return sendError(res, error, 'info');
  }
});

// POST /confirm — site, connecté
router.post('/confirm', siteRateLimit, async (req, res) => {
  try {
    const auth = await requireSiteAuth(req, res);
    if (!auth) return undefined;
    if (await isWrongCodeLimited(auth)) return res.status(429).json({ error: 'too_many_attempts' });

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const userCode = normalizeUserCode(body.userCode);
    const link = userCode ? await findPendingLink(userCode) : null;
    if (!link) {
      await recordWrongCode(auth);
      return res.status(404).json({ error: 'code_invalid' });
    }

    let profileId;
    try {
      profileId = ensureSafeProfileId(body.profileId);
    } catch {
      return res.status(400).json({ error: 'invalid_request' });
    }

    const sync = getSyncModule();
    let profile;
    try {
      const userData = await sync.readUserData(auth.userType, auth.userId);
      profile = getOwnedProfile(userData, profileId);
    } catch (error) {
      if (error instanceof SyncPolicyError || error?.name === 'SyncPolicyError') {
        return res.status(403).json({ error: 'profile_not_owned' });
      }
      throw error;
    }

    // Réservation atomique du code : deux confirmations simultanées ne créent
    // pas deux sessions, et le code ne sert qu'une fois.
    const claimedHash = await takeKey(KEY_CODE(userCode));
    if (claimedHash !== link.hash) {
      return res.status(404).json({ error: 'code_invalid' });
    }

    const releaseCode = async () => {
      try {
        await withRedis((client) => client.set(KEY_CODE(userCode), link.hash, 'PX', link.ttlMs, 'NX'));
      } catch { /* la liaison expirera d'elle-même */ }
    };

    const deviceName = link.entry.deviceName || DEFAULT_DEVICE_NAME;
    const sessionId = await getAuthRoutes().createUserSession(auth.userType, auth.userId, req, {
      userAgent: 'Movix TV',
      clientId: link.entry.clientId,
      device: {
        version: 1,
        browser: null,
        browserVersion: null,
        operatingSystem: null,
        deviceType: 'tv',
        name: deviceName,
      },
    });
    if (!sessionId) {
      await releaseCode();
      return res.status(503).json({ error: 'service_unavailable' });
    }

    const token = issueJwt(auth.userType, auth.userId, sessionId, 'tv');

    let profileData = null;
    try {
      profileData = await sync.readProfileData(auth.userType, auth.userId, profileId);
    } catch {
      profileData = null;
    }
    const vip = await resolveProfileVip(profileData);

    const approved = {
      ...link.entry,
      status: 'approved',
      token,
      userType: auth.userType,
      userId: String(auth.userId),
      profileId,
      profile: {
        id: profile.id,
        name: typeof profile.name === 'string' ? profile.name : '',
        avatar: typeof profile.avatar === 'string' ? profile.avatar : null,
        ageRestriction: Number.isFinite(Number(profile.ageRestriction)) ? Number(profile.ageRestriction) : 0,
      },
      vip,
    };
    await withRedis((client) => client.set(KEY_DEV(link.hash), JSON.stringify(approved), 'PX', APPROVED_TTL_MS));

    return res.status(200).json({ ok: true, deviceName });
  } catch (error) {
    return sendError(res, error, 'confirm');
  }
});

// POST /poll — télé
router.post('/poll', pollRateLimit, async (req, res) => {
  try {
    const deviceCode = req.body && typeof req.body === 'object' ? req.body.deviceCode : undefined;
    if (typeof deviceCode !== 'string' || !DEVICE_CODE_PATTERN.test(deviceCode)) {
      return res.status(400).json({ error: 'invalid_request' });
    }
    const hash = sha256(deviceCode);

    const entry = parseEntry(await withRedis((client) => client.get(KEY_DEV(hash))));
    if (!entry) return res.status(200).json({ status: 'expired' });

    if (entry.status === 'approved') {
      // Remise unique : récupérer et supprimer en une seule transaction.
      const delivered = parseEntry(await takeKey(KEY_DEV(hash)));
      if (!delivered || delivered.status !== 'approved') {
        return res.status(200).json({ status: 'expired' });
      }
      await withRedis((client) => client.del(KEY_POLL(hash))).catch(() => {});
      return res.status(200).json({
        status: 'approved',
        token: delivered.token,
        userType: delivered.userType,
        userId: delivered.userId,
        profileId: delivered.profileId,
        profile: delivered.profile,
        vip: delivered.vip,
      });
    }

    if (entry.status !== 'pending') return res.status(200).json({ status: 'expired' });

    // Le dernier appel accepté vit dans sa propre clé (SET NX PX) : réécrire
    // l'entrée pour noter `lastPollAt` pourrait écraser une confirmation
    // arrivée entre-temps.
    const accepted = await withRedis((client) => client.set(KEY_POLL(hash), String(Date.now()), 'PX', SLOW_DOWN_MS, 'NX'));
    return res.status(200).json({ status: accepted === 'OK' ? 'pending' : 'slow_down' });
  } catch (error) {
    return sendError(res, error, 'poll');
  }
});

module.exports = router;
