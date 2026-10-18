const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

const { createRedisRateLimitStore } = require('../utils/redisRateLimitStore');
const { getAuthIfValid } = require('../middleware/auth');
const { getPool } = require('../mysqlPool');
const {
  getOAuthClient,
  getOAuthClientPublicMetadata,
  resolveClientRedirectUri,
  normalizeRequestedScopes,
} = require('../utils/oauthClients');
const {
  ensureOAuthStorage,
  createAuthorizationCode,
  exchangeAuthorizationCode,
  getAccessTokenRecord,
  registerAuthorizationRequest,
  claimAuthorizationRequest,
  AUTHORIZATION_CODE_TTL_MS,
  ACCESS_TOKEN_TTL_MS,
  createOAuthStorageError,
} = require('../utils/oauthStorage');
const {
  readUserData,
  writeUserData,
  readProfileData,
  readProfileImportData,
  writeProfileData,
  withProfileSyncLock,
  deleteProfileHistory,
  applyProfileMarkChanges,
} = require('./sync');
const { recordEvent: recordOAuthAppEvent, grantVip: grantVipFromAppBalance } = require('../utils/oauthClientsDb');
const { verifyAccessKey } = require('../checkVip');
const { ensureSafeProfileId, getProfileFilePath, validateProfileName, SyncPolicyError } = require('../utils/syncPolicy');
const { v4: uuidv4 } = require('uuid');
const {
  createVipInvoice,
  fetchInvoiceByPublicId,
  listUserVipInvoices,
  refreshInvoiceStatus,
  serializePublicInvoice,
} = require('../utils/vipDonations');

const router = express.Router();

const setNoStore = (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  return next();
};

// express-rate-limit v8 exige `ipKeyGenerator()` dans le fallback IPv6
// pour éviter qu'un user IPv6 contourne la limite. Sans ça : `ValidationError`
// au boot (warning, mais bruit dans les logs).
const oauthRateLimitKey = (req) =>
  req.headers['cf-connecting-ip']
    || req.headers['x-forwarded-for']?.split(',')[0].trim()
    || ipKeyGenerator(req.ip);

const oauthPreviewLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: oauthRateLimitKey,
  store: createRedisRateLimitStore({ prefix: 'rate-limit:oauth:preview:' }),
  passOnStoreError: true,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false, ip: false },
  message: { error: 'too_many_requests', error_description: 'Trop de requêtes OAuth, réessayez dans un instant.' },
});

const oauthTokenLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  keyGenerator: oauthRateLimitKey,
  store: createRedisRateLimitStore({ prefix: 'rate-limit:oauth:token:' }),
  passOnStoreError: true,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false, ip: false },
  message: { error: 'too_many_requests', error_description: 'Trop de requêtes de token, réessayez dans un instant.' },
});

const OAUTH_SCOPE_IMPLICATIONS = {
  'profile.list': ['profile.read'],
  'profile.manage': ['profile.read', 'profile.list'],
  'vip.manage': ['vip.read'],
  // Toute action d'écriture implique le read correspondant.
  'favorites.add': ['favorites.read'],
  'favorites.remove': ['favorites.read'],
  'lists.create': ['lists.read'],
  'lists.rename': ['lists.read'],
  'lists.delete': ['lists.read'],
  'lists.add-item': ['lists.read'],
  'lists.remove-item': ['lists.read'],
  'watchlist.add': ['watchlist.read'],
  'watchlist.remove': ['watchlist.read'],
  'history.add': ['history.read'],
  'history.remove': ['history.read'],
  'alerts.manage': ['alerts.read'],
  'ratings.manage': ['ratings.read'],
};
const OAUTH_DEBUG_ENABLED = process.env.MOVIX_OAUTH_DEBUG === 'true';

function logOauthDebug(message, payload) {
  if (!OAUTH_DEBUG_ENABLED) {
    return;
  }

  if (typeof payload === 'undefined') {
    console.log(`[OAuth Debug] ${message}`);
    return;
  }

  console.log(`[OAuth Debug] ${message}`, payload);
}

function sendOauthJsonError(res, statusCode, oauthError, description) {
  return res.status(statusCode).json({
    error: oauthError,
    error_description: description,
  });
}

function getAuthorizationBearerToken(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  if (!authHeader || typeof authHeader !== 'string' || !authHeader.toLowerCase().startsWith('bearer ')) {
    return null;
  }

  return authHeader.slice(7).trim() || null;
}

function normalizeCodeChallengeMethod(rawValue) {
  const method = String(rawValue || '').trim().toUpperCase();
  if (!method) {
    return null;
  }

  if (method === 'S256') {
    return method;
  }

  throw createOAuthStorageError('Méthode PKCE non supportée', 400, 'invalid_request');
}

function normalizeCodeChallenge(rawValue, method, required) {
  const value = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!value) {
    if (required) {
      throw createOAuthStorageError('code_challenge requis pour ce client', 400, 'invalid_request');
    }
    return null;
  }

  if (!method) {
    throw createOAuthStorageError('code_challenge_method requis quand code_challenge est fourni', 400, 'invalid_request');
  }

  if (value.length < 43 || value.length > 128) {
    throw createOAuthStorageError('code_challenge invalide', 400, 'invalid_request');
  }

  return value;
}

function parseAuthorizeRequest(rawValues = {}) {
  const clientId = String(rawValues.client_id || rawValues.clientId || '').trim();
  const responseType = String(rawValues.response_type || rawValues.responseType || '').trim() || 'code';
  const redirectUriInput = rawValues.redirect_uri || rawValues.redirectUri || '';
  const state = typeof rawValues.state === 'string' ? rawValues.state : rawValues.state != null ? String(rawValues.state) : '';

  if (state && (state.length < 8 || state.length > 512)) {
    throw createOAuthStorageError('state doit contenir entre 8 et 512 caractères', 400, 'invalid_request');
  }

  // SECURITY (audit P2) : `client_id` est strictement requis (RFC 6749 §4.1.1).
  // L'ancien fallback "1 seul client enregistré → on le devine" pouvait être
  // exploité dès qu'un opérateur retirait le client de dev — une page tierce
  // pouvait construire un /authorize sans connaître l'id, et le faire passer
  // pour le client enregistré.
  if (!clientId) {
    throw createOAuthStorageError('client_id requis', 400, 'invalid_request');
  }

  if (responseType !== 'code') {
    throw createOAuthStorageError('Seul response_type=code est supporté', 400, 'unsupported_response_type');
  }

  const client = getOAuthClient(clientId);
  if (!client) {
    throw createOAuthStorageError('Client OAuth inconnu', 400, 'invalid_client');
  }

  const resolvedClientId = client.clientId;

  const redirectUri = resolveClientRedirectUri(client, redirectUriInput);
  const scopes = normalizeRequestedScopes(rawValues.scope, client);
  const codeChallengeMethod = normalizeCodeChallengeMethod(rawValues.code_challenge_method || rawValues.codeChallengeMethod);
  const codeChallenge = normalizeCodeChallenge(rawValues.code_challenge || rawValues.codeChallenge, codeChallengeMethod, client.requirePkce);

  if ((codeChallenge || client.requirePkce) && !codeChallengeMethod) {
    throw createOAuthStorageError('code_challenge_method requis pour ce client', 400, 'invalid_request');
  }

  return {
    client,
    clientId: resolvedClientId,
    redirectUri,
    scopes,
    state,
    responseType,
    codeChallenge,
    codeChallengeMethod,
  };
}

function buildRedirectUri(redirectUri, queryParams) {
  const url = new URL(redirectUri);
  Object.entries(queryParams).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    url.searchParams.set(key, String(value));
  });
  return url.toString();
}

function hasScope(record, scope) {
  const directScopes = Array.isArray(record?.scopes) ? record.scopes : [];
  if (directScopes.includes(scope)) {
    return true;
  }

  return directScopes.some((grantedScope) => {
    const impliedScopes = OAUTH_SCOPE_IMPLICATIONS[grantedScope] || [];
    return impliedScopes.includes(scope);
  });
}

function parseStoredAuth(rawValue) {
  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function getDefaultProfile(profiles) {
  if (!Array.isArray(profiles) || profiles.length === 0) {
    return null;
  }

  return profiles.find((profile) => profile && profile.isDefault) || profiles[0] || null;
}

function sanitizeOauthString(value, maxLength) {
  if (typeof value !== 'string') return null;
  return value.trim().slice(0, maxLength).replace(/[<>"']/g, '') || null;
}

function sanitizeOauthAvatarUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();
  if (trimmed.startsWith('/avatars/')) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:') return parsed.toString();
  } catch { /* invalid URL */ }
  return null;
}

function buildUserIdentity(userType, userId, userData) {
  const storedAuth = parseStoredAuth(userData?.auth);
  const storedProfile = storedAuth?.userProfile && typeof storedAuth.userProfile === 'object'
    ? storedAuth.userProfile
    : null;
  const defaultProfile = getDefaultProfile(userData?.profiles);
  const fallbackName = userType === 'bip39'
    ? `Utilisateur-${String(userId).slice(0, 8)}`
    : `Movix-${String(userId).slice(0, 8)}`;
  const fallbackAvatar = 'https://as2.ftcdn.net/v2/jpg/05/89/93/27/1000_F_589932782_vQAEAZhHnq1QCGu5ikwrYaQD0Mmurm0N.webp';

  const rawUsername = storedProfile?.username || defaultProfile?.name || fallbackName;
  const rawAvatar = storedProfile?.avatar || defaultProfile?.avatar || fallbackAvatar;

  return {
    id: String(userId),
    username: sanitizeOauthString(rawUsername, 100) || fallbackName,
    avatar: sanitizeOauthAvatarUrl(rawAvatar) || fallbackAvatar,
    provider: storedProfile?.provider || storedAuth?.provider || userType,
  };
}

// Le frontend sérialise les valeurs (JSON.stringify) avant de les envoyer
// au /api/sync. Du coup `is_vip` peut être stocké comme `"true"` (avec
// guillemets) ou `true` (boolean) selon le path. On accepte les deux.
function extractStringField(source, key) {
  if (!source) return '';
  const raw = source[key];
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  // Tentative de parse JSON (cas où le frontend a fait JSON.stringify).
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === 'string' ? parsed.trim() : trimmed;
  } catch {
    return trimmed;
  }
}

function extractBooleanField(source, key) {
  if (!source) return false;
  const raw = source[key];
  if (raw === true) return true;
  if (typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (trimmed === 'true' || trimmed === '"true"') return true;
  try {
    return JSON.parse(trimmed) === true;
  } catch {
    return false;
  }
}

async function buildVipIdentity(userData, profileData) {
  // Le frontend stocke `access_code`, `is_vip`, `access_code_expires` dans le
  // PROFILE data via /api/sync (pas dans le user data global). On lit d'abord
  // le profile data, fallback sur userData pour compat.
  const sources = [
    { name: 'profileData', src: profileData },
    { name: 'userData', src: userData },
  ].filter((s) => s.src);

  // Debug : indique ce que chaque source contient pour le VIP, sans surfacer
  // la valeur réelle de la clé d'accès.
  if (OAUTH_DEBUG_ENABLED) {
    const inspect = sources.map(({ name, src }) => ({
      name,
      hasIsVip: 'is_vip' in (src || {}),
      isVipRaw: typeof src?.is_vip,
      hasAccessCode: 'access_code' in (src || {}),
      accessCodeLen: typeof src?.access_code === 'string' ? src.access_code.length : 0,
      keysSample: Object.keys(src || {}).filter((k) => /vip|access/i.test(k)),
    }));
    logOauthDebug('buildVipIdentity sources', inspect);
  }

  for (const { src } of sources) {
    const accessKey = extractStringField(src, 'access_code');
    if (accessKey) {
      const verified = await verifyAccessKey(accessKey);
      if (OAUTH_DEBUG_ENABLED) {
        logOauthDebug('buildVipIdentity verify', { vip: verified.vip, reason: verified.reason });
      }
      return {
        active: verified.vip === true,
        expiresAt: verified.expiresAt || null,
        duration: verified.duration || null,
      };
    }
  }

  // SECURITY (audit P0) : aucun fallback sur le flag `is_vip`. Cette clé est
  // syncable via /api/sync donc librement écrivable par n'importe quel user
  // → élévation VIP gratuite si on lui faisait confiance.
  // La seule source d'autorité est `verifyAccessKey()` contre la table MySQL
  // `access_keys`. Sans `access_code` valide, le compte n'est pas VIP.
  if (OAUTH_DEBUG_ENABLED) {
    logOauthDebug('buildVipIdentity no access_code → non-VIP', {});
  }
  return { active: false, expiresAt: null, duration: null };
}

async function getOauthAccountPayload(record) {
  const userData = await readUserData(record.userType, record.userId);
  const identity = buildUserIdentity(record.userType, record.userId, userData);

  // Charge le profile data du profil par défaut pour y chercher `access_code`,
  // `is_vip`, etc. Erreurs silencieuses : si pas de profil, on tombera sur
  // userData seul.
  let profileData = null;
  try {
    const profiles = Array.isArray(userData?.profiles) ? userData.profiles : [];
    const defaultProfile = profiles.find((p) => p && p.isDefault) || profiles[0];
    if (defaultProfile && defaultProfile.id) {
      profileData = await readProfileData(record.userType, record.userId, defaultProfile.id);
    }
  } catch (err) {
    // Silently ignore — fallback to userData-only VIP check.
    if (OAUTH_DEBUG_ENABLED) {
      logOauthDebug('buildVipIdentity profile load failed', { error: err?.message });
    }
  }

  const vip = await buildVipIdentity(userData, profileData);

  return {
    record,
    userData,
    identity,
    vip,
  };
}

function getRequestBaseUrl(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol || 'https';
  const host = forwardedHost || req.get('host') || '';

  return host ? `${protocol}://${host}`.replace(/\/+$/, '') : '';
}

function canAccessVipInvoice(invoice, tokenRecord) {
  if (!invoice || !tokenRecord) {
    return false;
  }

  return String(invoice.created_by_user_id || '') === String(tokenRecord.userId)
    && String(invoice.created_by_user_type || '') === String(tokenRecord.userType);
}

async function getOauthTokenAuth(req, requiredScopes = []) {
  const accessToken = getAuthorizationBearerToken(req);
  if (!accessToken) {
    throw createOAuthStorageError('Token OAuth requis', 401, 'invalid_token');
  }

  const pool = getPool();
  const tokenRecord = await getAccessTokenRecord(pool, accessToken, { touch: true });
  if (!tokenRecord) {
    throw createOAuthStorageError('Token OAuth invalide ou expiré', 401, 'invalid_token');
  }

  const missingScopes = requiredScopes.filter((scope) => !hasScope(tokenRecord, scope));
  if (missingScopes.length > 0) {
    const error = createOAuthStorageError(`Permission OAuth manquante: ${missingScopes.join(', ')}`, 403, 'insufficient_scope');
    error.missingScopes = missingScopes;
    throw error;
  }

  // Stats fire-and-forget : on n'attend pas l'INSERT pour répondre.
  // Une erreur DB ne doit pas faire échouer l'appel API.
  recordOAuthAppEvent(
    tokenRecord.clientId,
    'api_call',
    `${tokenRecord.userType}:${tokenRecord.userId}`,
    { path: req.path, method: req.method },
  ).catch(() => { /* swallow */ });

  return tokenRecord;
}

router.get('/authorize/preview', oauthPreviewLimiter, async (req, res) => {
  try {
    logOauthDebug('Received /authorize/preview request', {
      url: req.originalUrl,
      clientId: req.query?.client_id || req.query?.clientId || null,
      redirectUri: req.query?.redirect_uri || req.query?.redirectUri || null,
      responseType: req.query?.response_type || req.query?.responseType || null,
      scope: req.query?.scope || null,
      state: req.query?.state || null,
      codeChallengeMethod: req.query?.code_challenge_method || req.query?.codeChallengeMethod || null,
      hasCodeChallenge: Boolean(req.query?.code_challenge || req.query?.codeChallenge),
      origin: req.get('origin') || null,
      referer: req.get('referer') || null,
      userAgent: req.get('user-agent') || null,
    });

    const pool = getPool();
    await ensureOAuthStorage(pool);

    const authorizeRequest = parseAuthorizeRequest(req.query || {});
    logOauthDebug('Parsed authorize preview request', {
      clientId: authorizeRequest.clientId,
      redirectUri: authorizeRequest.redirectUri,
      scopes: authorizeRequest.scopes,
      responseType: authorizeRequest.responseType,
      statePresent: Boolean(authorizeRequest.state),
      codeChallengeMethod: authorizeRequest.codeChallengeMethod,
      hasCodeChallenge: Boolean(authorizeRequest.codeChallenge),
      clientRedirectUris: authorizeRequest.client.redirectUris,
    });

    const requestRecord = await registerAuthorizationRequest(pool, authorizeRequest);

    if (requestRecord?.consumedAt) {
      logOauthDebug('Authorize preview request already consumed', {
        clientId: authorizeRequest.clientId,
        redirectUri: authorizeRequest.redirectUri,
      });
      return res.status(400).json({
        success: false,
        error: 'invalid_grant',
        error_description: 'Cette demande OAuth a déjà été utilisée. Regénérez une nouvelle demande depuis Movix Translate.',
        client: getOAuthClientPublicMetadata(authorizeRequest.client),
      });
    }

    return res.json({
      success: true,
      client: getOAuthClientPublicMetadata(authorizeRequest.client),
      request: {
        clientId: authorizeRequest.clientId,
        redirectUri: authorizeRequest.redirectUri,
        scopes: authorizeRequest.scopes,
        state: authorizeRequest.state,
        requiresPkce: authorizeRequest.client.requirePkce,
        codeChallengeMethod: authorizeRequest.codeChallengeMethod,
        codeChallengeProvided: Boolean(authorizeRequest.codeChallenge),
        codeExpiresInMs: AUTHORIZATION_CODE_TTL_MS,
        accessTokenExpiresInMs: ACCESS_TOKEN_TTL_MS,
      },
    });
  } catch (error) {
    logOauthDebug('Authorize preview failed', {
      message: error.message,
      statusCode: error.statusCode || 400,
      oauthError: error.oauthError || 'invalid_request',
      clientId: req.query?.client_id || req.query?.clientId || null,
      redirectUri: req.query?.redirect_uri || req.query?.redirectUri || null,
      scope: req.query?.scope || null,
    });

    let clientMetadata = null;
    try {
      const clientId = String(req.query?.client_id || req.query?.clientId || '').trim();
      const client = getOAuthClient(clientId);
      if (client) {
        clientMetadata = getOAuthClientPublicMetadata(client);
      }
    } catch {
      // Ignore client resolution errors in error handler.
    }

    return res.status(error.statusCode || 400).json({
      success: false,
      error: error.oauthError || 'invalid_request',
      error_description: error.message || 'Requête OAuth invalide',
      ...(clientMetadata ? { client: clientMetadata } : {}),
    });
  }
});

router.post('/authorize/decision', oauthPreviewLimiter, async (req, res) => {
  let connection = null;
  try {
    const auth = await getAuthIfValid(req);
    if (!auth) {
      return sendOauthJsonError(res, 401, 'unauthorized', 'Authentification Movix requise');
    }

    const authorizeRequest = parseAuthorizeRequest(req.body || {});
    const approve = req.body?.approve === true || req.body?.approve === 'true' || req.body?.decision === 'approve';

    const pool = getPool();
    await ensureOAuthStorage(pool);
    await registerAuthorizationRequest(pool, authorizeRequest);

    connection = await pool.getConnection();
    await connection.beginTransaction();

    await claimAuthorizationRequest(connection, authorizeRequest, approve ? 'approved' : 'rejected');

    if (!approve) {
      await connection.commit();
      recordOAuthAppEvent(
        authorizeRequest.clientId,
        'authorize_denied',
        `${auth.userType}:${auth.userId}`,
        { scopes: authorizeRequest.scopes },
      ).catch(() => { /* swallow */ });
      return res.json({
        success: true,
        approved: false,
        redirectTo: buildRedirectUri(authorizeRequest.redirectUri, {
          error: 'access_denied',
          error_description: 'L’utilisateur a refusé la demande d’accès',
          state: authorizeRequest.state,
        }),
      });
    }

    const authorizationCode = await createAuthorizationCode(connection, {
      clientId: authorizeRequest.clientId,
      userId: auth.userId,
      userType: auth.userType,
      sessionId: auth.sessionId || null,
      scopes: authorizeRequest.scopes,
      redirectUri: authorizeRequest.redirectUri,
      codeChallenge: authorizeRequest.codeChallenge,
      codeChallengeMethod: authorizeRequest.codeChallengeMethod,
    });

    await connection.commit();

    recordOAuthAppEvent(
      authorizeRequest.clientId,
      'authorize_granted',
      `${auth.userType}:${auth.userId}`,
      { scopes: authorizeRequest.scopes },
    ).catch(() => { /* swallow */ });

    return res.json({
      success: true,
      approved: true,
      redirectTo: buildRedirectUri(authorizeRequest.redirectUri, {
        code: authorizationCode.code,
        state: authorizeRequest.state,
      }),
      expiresAt: authorizationCode.expiresAt,
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch {
        // Ignore rollback failures.
      }
    }

    return sendOauthJsonError(
      res,
      error.statusCode || 400,
      error.oauthError || 'invalid_request',
      error.message || 'Impossible de traiter la décision OAuth'
    );
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

router.post('/token', oauthTokenLimiter, async (req, res) => {
  try {
    const grantType = String(req.body?.grant_type || '').trim();
    if (grantType !== 'authorization_code') {
      return sendOauthJsonError(res, 400, 'unsupported_grant_type', 'Seul authorization_code est supporté');
    }

    const clientId = String(req.body?.client_id || '').trim();
    const code = String(req.body?.code || '').trim();
    if (!clientId || !code) {
      return sendOauthJsonError(res, 400, 'invalid_request', 'client_id et code sont requis');
    }

    const client = getOAuthClient(clientId);
    if (!client) {
      return sendOauthJsonError(res, 401, 'invalid_client', 'Client OAuth inconnu');
    }

    const redirectUri = resolveClientRedirectUri(client, req.body?.redirect_uri || '');
    const clientSecret = typeof req.body?.client_secret === 'string' ? req.body.client_secret : '';
    const codeVerifier = typeof req.body?.code_verifier === 'string' ? req.body.code_verifier.trim() : '';

    const pool = getPool();
    await ensureOAuthStorage(pool);

    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    const [rows] = await pool.execute(
      'SELECT * FROM oauth_authorization_codes WHERE code_hash = ? LIMIT 1',
      [codeHash]
    );
    if (!rows.length) {
      return sendOauthJsonError(res, 400, 'invalid_grant', 'Code d’autorisation invalide');
    }

    const storedChallenge = rows[0].code_challenge || null;
    const storedChallengeMethod = String(rows[0].code_challenge_method || '').trim().toUpperCase() || null;

    const verifyPkce = () => {
      if (!storedChallenge || storedChallengeMethod !== 'S256') {
        return false;
      }

      if (!codeVerifier || codeVerifier.length < 43 || codeVerifier.length > 128) {
        return false;
      }

      const digest = crypto.createHash('sha256').update(codeVerifier).digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');

      try {
        return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(storedChallenge));
      } catch {
        return false;
      }
    };

    const secretIsValid = (() => {
      if (!client.clientSecret || !clientSecret) {
        return false;
      }

      const provided = Buffer.from(clientSecret);
      const expected = Buffer.from(client.clientSecret);
      if (provided.length !== expected.length) {
        return false;
      }

      return crypto.timingSafeEqual(provided, expected);
    })();

    const pkceIsValid = verifyPkce();

    if (client.publicClient || client.requirePkce) {
      if (!pkceIsValid) {
        return sendOauthJsonError(res, 400, 'invalid_grant', 'code_verifier invalide');
      }
    } else if (!secretIsValid && !pkceIsValid) {
      return sendOauthJsonError(res, 401, 'invalid_client', 'client_secret ou PKCE invalide');
    }

    const tokenPayload = await exchangeAuthorizationCode(pool, {
      clientId,
      code,
      redirectUri,
    });

    recordOAuthAppEvent(
      clientId,
      'token_issued',
      tokenPayload.userType && tokenPayload.userId ? `${tokenPayload.userType}:${tokenPayload.userId}` : null,
      { scopes: tokenPayload.scopes },
    ).catch(() => { /* swallow */ });

    return res.json({
      access_token: tokenPayload.accessToken,
      token_type: 'Bearer',
      expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
      scope: tokenPayload.scopes.join(' '),
    });
  } catch (error) {
    return sendOauthJsonError(
      res,
      error.statusCode || 400,
      error.oauthError || 'invalid_request',
      error.message || 'Impossible d’échanger le code OAuth'
    );
  }
});

router.get('/userinfo', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req);
    const accountPayload = await getOauthAccountPayload(tokenRecord);
    const hasProfileRead = hasScope(tokenRecord, 'profile.read');
    const hasProfileList = hasScope(tokenRecord, 'profile.list');
    const hasProfileManage = hasScope(tokenRecord, 'profile.manage');
    const hasVipRead = hasScope(tokenRecord, 'vip.read');
    const hasVipManage = hasScope(tokenRecord, 'vip.manage');

    const response = {
      sub: `${tokenRecord.userType}:${tokenRecord.userId}`,
      user_type: tokenRecord.userType,
      user_id: tokenRecord.userId,
      client_id: tokenRecord.clientId,
      scope: tokenRecord.scopes.join(' '),
      scopes: [...tokenRecord.scopes],
      permissions: {
        profileRead: hasProfileRead,
        profileList: hasProfileList,
        profileManage: hasProfileManage,
        vipRead: hasVipRead,
        vipManage: hasVipManage,
      },
      capabilities: {
        canReadProfile: hasProfileRead,
        canListProfiles: hasProfileList || hasProfileManage,
        canManageProfiles: hasProfileManage,
        canReadVip: hasVipRead || hasVipManage,
        canManageVip: hasVipManage,
      },
    };

    if (hasProfileRead) {
      response.preferred_username = accountPayload.identity.username;
      response.picture = accountPayload.identity.avatar;
      response.name = accountPayload.identity.username;
      response.avatar = accountPayload.identity.avatar;
      response.profile = {
        username: accountPayload.identity.username,
        avatar: accountPayload.identity.avatar,
      };
    }

    if (hasProfileList || hasProfileManage) {
      const profiles = accountPayload.userData?.profiles || [];
      response.profiles = profiles.map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        ageRestriction: p.ageRestriction || 0,
        isDefault: p.isDefault || false,
      }));
    }

    if (hasVipRead || hasVipManage) {
      response.vip = accountPayload.vip;
    }

    return res.json(response);
  } catch (error) {
    return sendOauthJsonError(
      res,
      error.statusCode || 401,
      error.oauthError || 'invalid_token',
      error.message || 'Impossible de récupérer le profil OAuth'
    );
  }
});

router.get('/vip/status', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['vip.read']);
    const accountPayload = await getOauthAccountPayload(tokenRecord);
    return res.json({
      success: true,
      vip: accountPayload.vip,
    });
  } catch (error) {
    return sendOauthJsonError(
      res,
      error.statusCode || 401,
      error.oauthError || 'invalid_token',
      error.message || 'Impossible de récupérer le statut VIP'
    );
  }
});

router.get('/vip/invoices', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['vip.manage']);
    const pool = getPool();
    const invoices = await listUserVipInvoices(pool, tokenRecord, {
      limit: req.query?.limit,
    });

    return res.json({
      success: true,
      invoices,
    });
  } catch (error) {
    return sendOauthJsonError(
      res,
      error.statusCode || 401,
      error.oauthError || 'invalid_token',
      error.message || 'Impossible de récupérer les invoices VIP'
    );
  }
});

router.post('/vip/invoices', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['vip.manage']);
    const pool = getPool();
    const invoice = await createVipInvoice(
      pool,
      {
        packEur: req.body?.pack_eur || req.body?.packEur,
        paymentMethod: req.body?.payment_method || req.body?.paymentMethod,
        coin: req.body?.coin,
        recipientMode: req.body?.recipient_mode || req.body?.recipientMode,
        payerEmail: req.body?.payer_email || req.body?.payerEmail,
      },
      {
        auth: tokenRecord,
        ipAddress: req.ip || req.connection?.remoteAddress || null,
        callbackBaseUrl: getRequestBaseUrl(req),
      }
    );

    return res.status(201).json({
      success: true,
      invoice: serializePublicInvoice(invoice),
    });
  } catch (error) {
    return sendOauthJsonError(
      res,
      error.statusCode || 400,
      error.oauthError || 'invalid_request',
      error.message || 'Impossible de créer l’invoice VIP'
    );
  }
});

router.get('/vip/invoices/:publicId', setNoStore, async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['vip.manage']);
    const pool = getPool();
    const invoice = await fetchInvoiceByPublicId(pool, req.params.publicId);

    if (!canAccessVipInvoice(invoice, tokenRecord)) {
      return sendOauthJsonError(res, 404, 'not_found', 'Invoice introuvable');
    }

    return res.json({
      success: true,
      invoice: serializePublicInvoice(invoice),
    });
  } catch (error) {
    return sendOauthJsonError(
      res,
      error.statusCode || 401,
      error.oauthError || 'invalid_token',
      error.message || 'Impossible de récupérer cette invoice VIP'
    );
  }
});

router.post('/vip/invoices/:publicId/check', setNoStore, async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['vip.manage']);
    const pool = getPool();
    const invoice = await fetchInvoiceByPublicId(pool, req.params.publicId);

    if (!canAccessVipInvoice(invoice, tokenRecord)) {
      return sendOauthJsonError(res, 404, 'not_found', 'Invoice introuvable');
    }

    const refreshedInvoice = await refreshInvoiceStatus(pool, invoice, {
      actorType: 'oauth_app',
      actorId: tokenRecord.clientId,
    });

    return res.json({
      success: true,
      invoice: serializePublicInvoice(refreshedInvoice),
    });
  } catch (error) {
    return sendOauthJsonError(
      res,
      error.statusCode || 502,
      error.oauthError || 'server_error',
      error.message || 'Vérification de paiement indisponible temporairement'
    );
  }
});

// ---------------------------------------------------------------------------
// Profile endpoints (scopes: profile.list, profile.manage)
// ---------------------------------------------------------------------------

function serializeProfile(profile) {
  return {
    id: profile.id,
    name: profile.name,
    avatar: profile.avatar,
    ageRestriction: profile.ageRestriction || 0,
    isDefault: profile.isDefault || false,
    createdAt: profile.createdAt || null,
  };
}

router.get('/profiles', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['profile.list']);
    const userData = await readUserData(tokenRecord.userType, tokenRecord.userId);
    const profiles = (userData.profiles || []).map(serializeProfile);

    return res.json({ success: true, profiles });
  } catch (error) {
    return sendOauthJsonError(
      res,
      error.statusCode || 401,
      error.oauthError || 'invalid_token',
      error.message || 'Impossible de récupérer les profils'
    );
  }
});

router.get('/profiles/:profileId', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['profile.list']);
    const profileId = ensureSafeProfileId(req.params.profileId);
    const userData = await readUserData(tokenRecord.userType, tokenRecord.userId);
    const profiles = userData.profiles || [];
    const profile = profiles.find((p) => p.id === profileId);

    if (!profile) {
      return sendOauthJsonError(res, 404, 'not_found', 'Profil introuvable');
    }

    return res.json({ success: true, profile: serializeProfile(profile) });
  } catch (error) {
    return sendOauthJsonError(
      res,
      error.statusCode || 401,
      error.oauthError || 'invalid_token',
      error.message || 'Impossible de récupérer ce profil'
    );
  }
});

router.post('/profiles', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['profile.manage']);
    const rawName = typeof req.body?.name === 'string' ? req.body.name : '';
    const avatar = typeof req.body?.avatar === 'string' ? req.body.avatar.trim() : '';

    if (!rawName || !avatar) {
      return sendOauthJsonError(res, 400, 'invalid_request', 'name et avatar sont requis');
    }

    let safeName;
    try {
      safeName = validateProfileName(rawName);
    } catch (e) {
      if (e instanceof SyncPolicyError) {
        return sendOauthJsonError(res, e.status, 'invalid_request', e.message);
      }
      throw e;
    }

    if (!avatar.startsWith('/avatars/')) {
      return sendOauthJsonError(res, 400, 'invalid_request', 'avatar doit commencer par /avatars/');
    }

    const validAgeRestrictions = [0, 7, 12, 16, 18];
    const ageRestriction = validAgeRestrictions.includes(Number(req.body?.ageRestriction))
      ? Number(req.body.ageRestriction)
      : 0;

    const userData = await readUserData(tokenRecord.userType, tokenRecord.userId);
    const profiles = userData.profiles || [];

    if (profiles.length >= 5) {
      return sendOauthJsonError(res, 400, 'invalid_request', 'Maximum 5 profils autorisés');
    }

    const newProfile = {
      id: uuidv4(),
      name: safeName,
      avatar,
      ageRestriction,
      createdAt: new Date().toISOString(),
      isDefault: profiles.length === 0,
    };

    userData.profiles = [...profiles, newProfile];
    userData.lastUpdated = Date.now();

    const success = await writeUserData(tokenRecord.userType, tokenRecord.userId, userData);
    if (!success) {
      return sendOauthJsonError(res, 500, 'server_error', 'Impossible de créer le profil');
    }

    return res.status(201).json({ success: true, profile: serializeProfile(newProfile) });
  } catch (error) {
    return sendOauthJsonError(
      res,
      error.statusCode || 401,
      error.oauthError || 'invalid_token',
      error.message || 'Impossible de créer le profil'
    );
  }
});

router.put('/profiles/:profileId', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['profile.manage']);
    const profileId = ensureSafeProfileId(req.params.profileId);
    const rawName = typeof req.body?.name === 'string' ? req.body.name : '';
    const avatar = typeof req.body?.avatar === 'string' ? req.body.avatar.trim() : '';
    const ageRestriction = req.body?.ageRestriction;

    if (!rawName && !avatar && ageRestriction === undefined) {
      return sendOauthJsonError(res, 400, 'invalid_request', 'name, avatar ou ageRestriction requis');
    }

    if (avatar && !avatar.startsWith('/avatars/')) {
      return sendOauthJsonError(res, 400, 'invalid_request', 'avatar doit commencer par /avatars/');
    }

    let safeName = null;
    if (rawName) {
      try {
        safeName = validateProfileName(rawName);
      } catch (e) {
        if (e instanceof SyncPolicyError) {
          return sendOauthJsonError(res, e.status, 'invalid_request', e.message);
        }
        throw e;
      }
    }

    const userData = await readUserData(tokenRecord.userType, tokenRecord.userId);
    const profiles = userData.profiles || [];
    const profileIndex = profiles.findIndex((p) => p.id === profileId);

    if (profileIndex === -1) {
      return sendOauthJsonError(res, 404, 'not_found', 'Profil introuvable');
    }

    if (safeName) profiles[profileIndex].name = safeName;
    if (avatar) profiles[profileIndex].avatar = avatar;
    if (ageRestriction !== undefined) {
      const validAgeRestrictions = [0, 7, 12, 16, 18];
      profiles[profileIndex].ageRestriction = validAgeRestrictions.includes(Number(ageRestriction))
        ? Number(ageRestriction)
        : 0;
    }

    userData.profiles = profiles;
    userData.lastUpdated = Date.now();

    const success = await writeUserData(tokenRecord.userType, tokenRecord.userId, userData);
    if (!success) {
      return sendOauthJsonError(res, 500, 'server_error', 'Impossible de mettre à jour le profil');
    }

    return res.json({ success: true, profile: serializeProfile(profiles[profileIndex]) });
  } catch (error) {
    return sendOauthJsonError(
      res,
      error.statusCode || 401,
      error.oauthError || 'invalid_token',
      error.message || 'Impossible de mettre à jour ce profil'
    );
  }
});

router.delete('/profiles/:profileId', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['profile.manage']);
    const profileId = ensureSafeProfileId(req.params.profileId);
    const { USERS_DIR } = require('./sync');

    const userData = await readUserData(tokenRecord.userType, tokenRecord.userId);
    const profiles = userData.profiles || [];
    const profileIndex = profiles.findIndex((p) => p.id === profileId);

    if (profileIndex === -1) {
      return sendOauthJsonError(res, 404, 'not_found', 'Profil introuvable');
    }

    const isLastProfile = profiles.length <= 1;
    const wasDefault = profiles[profileIndex].isDefault;
    profiles.splice(profileIndex, 1);

    if (isLastProfile) {
      const newDefaultProfile = {
        id: uuidv4(),
        name: 'Profil',
        avatar: '/avatars/disney/disney_avatar_1.png',
        createdAt: new Date().toISOString(),
        isDefault: true,
      };
      profiles.push(newDefaultProfile);
    } else if (wasDefault && profiles.length > 0) {
      profiles[0].isDefault = true;
    }

    userData.profiles = profiles;
    userData.lastUpdated = Date.now();

    const success = await writeUserData(tokenRecord.userType, tokenRecord.userId, userData);
    if (!success) {
      return sendOauthJsonError(res, 500, 'server_error', 'Impossible de supprimer le profil');
    }

    // Supprimer le fichier de données du profil
    const fsp = require('fs').promises;
    const profilePath = getProfileFilePath(USERS_DIR, tokenRecord.userType, tokenRecord.userId, profileId);
    try { await fsp.unlink(profilePath); } catch { /* Fichier inexistant */ }

    // Historique et progression du profil (au mieux, ne lève jamais).
    await deleteProfileHistory(tokenRecord.userType, tokenRecord.userId, profileId);

    // Supprimer les votes associés
    try {
      const pool = getPool();
      if (pool) {
        await pool.execute(
          'DELETE FROM likes WHERE user_id = ? AND user_type = ? AND profile_id = ?',
          [tokenRecord.userId, tokenRecord.userType, profileId]
        );
      }
    } catch { /* Ignorer */ }

    return res.json({
      success: true,
      newDefaultProfile: isLastProfile ? serializeProfile(profiles[profiles.length - 1]) : null,
    });
  } catch (error) {
    return sendOauthJsonError(
      res,
      error.statusCode || 401,
      error.oauthError || 'invalid_token',
      error.message || 'Impossible de supprimer ce profil'
    );
  }
});

// ────────────────────────────────────────────────────────────────────────────
// FAVORITES (favorites.read / favorites.manage)
//
// Wrappers OAuth autour du système de sync. Les favoris vivent côté frontend
// dans les clés localStorage `favorite_movie` (films) et `favorites_tv`
// (séries). On les manipule directement dans le profile data côté serveur.
//
// Format d'un item :
//   { id: number, type: 'movie' | 'tv', title: string, poster_path: string, addedAt: ISO }
// ────────────────────────────────────────────────────────────────────────────

const FAVORITES_KEYS = {
  movie: 'favorite_movie',
  tv: 'favorites_tv',
};

function parseFavoriteArray(rawValue) {
  if (typeof rawValue !== 'string' || !rawValue.trim()) return [];
  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isValidFavoriteItem(item) {
  return (
    item &&
    typeof item === 'object' &&
    Number.isInteger(item.id) &&
    item.id > 0 &&
    (item.type === 'movie' || item.type === 'tv') &&
    typeof item.title === 'string'
  );
}

// Résout le profileId à utiliser. SECURITY (audit P1) : si un profileId est
// fourni explicitement, on vérifie qu'il appartient au compte du token —
// sinon n'importe quel MCP / app autorisé pourrait créer des profils-fantômes
// (`profiles/<userType>/<userId>/<random>.json`) qui polluent le disque sans
// jamais apparaître dans la liste de profils côté UI.
async function resolveFavoritesProfileId(tokenRecord, explicitProfileId) {
  const userData = await readUserData(tokenRecord.userType, tokenRecord.userId);
  const profiles = Array.isArray(userData?.profiles) ? userData.profiles : [];
  if (profiles.length === 0) {
    throw createOAuthStorageError('Aucun profil disponible pour ce compte', 404, 'not_found');
  }
  if (explicitProfileId) {
    const safeId = ensureSafeProfileId(explicitProfileId);
    if (!profiles.some((p) => p && p.id === safeId)) {
      throw createOAuthStorageError('Profil introuvable pour ce compte', 404, 'not_found');
    }
    return safeId;
  }
  const defaultProfile = profiles.find((p) => p && p.isDefault) || profiles[0];
  return defaultProfile.id;
}

// GET /api/oauth/favorites?profileId=<optional>
router.get('/favorites', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['favorites.read']);
    const profileId = await resolveFavoritesProfileId(tokenRecord, req.query?.profileId);
    const profileData = await readProfileData(tokenRecord.userType, tokenRecord.userId, profileId);

    const movies = parseFavoriteArray(profileData[FAVORITES_KEYS.movie]);
    const tv = parseFavoriteArray(profileData[FAVORITES_KEYS.tv]);

    return res.json({
      success: true,
      profileId,
      movies: movies.filter(isValidFavoriteItem),
      tv: tv.filter(isValidFavoriteItem),
    });
  } catch (error) {
    return sendOauthJsonError(
      res,
      error.statusCode || 401,
      error.oauthError || 'invalid_token',
      error.message || 'Impossible de récupérer les favoris'
    );
  }
});

// POST /api/oauth/favorites
// Body : { tmdb_id, media_type, title, poster_path?, profileId? }
router.post('/favorites', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['favorites.add']);

    const tmdbId = Number(req.body?.tmdb_id);
    const mediaType = String(req.body?.media_type || '').trim();
    const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 300) : '';
    const posterPath = typeof req.body?.poster_path === 'string' ? req.body.poster_path.trim().slice(0, 200) : '';

    if (!Number.isInteger(tmdbId) || tmdbId <= 0 || tmdbId > 10_000_000) {
      return sendOauthJsonError(res, 400, 'invalid_request', 'tmdb_id invalide');
    }
    if (mediaType !== 'movie' && mediaType !== 'tv') {
      return sendOauthJsonError(res, 400, 'invalid_request', 'media_type doit être "movie" ou "tv"');
    }
    if (!title) {
      return sendOauthJsonError(res, 400, 'invalid_request', 'title requis');
    }
    // poster_path doit être soit vide, soit un chemin TMDB plausible.
    if (posterPath && !posterPath.startsWith('/')) {
      return sendOauthJsonError(res, 400, 'invalid_request', 'poster_path invalide');
    }

    const profileId = await resolveFavoritesProfileId(tokenRecord, req.body?.profileId);
    const result = await withProfileMutation(tokenRecord, profileId, (profileData) => {
      const key = FAVORITES_KEYS[mediaType];
      const current = parseFavoriteArray(profileData[key]).filter(isValidFavoriteItem);

      // Déduplication : on retire d'abord toute occurrence du même id puis on
      // pousse en tête (le frontend Movix met les ajouts récents en haut).
      const filtered = current.filter((item) => item.id !== tmdbId);
      const newItem = {
        id: tmdbId,
        type: mediaType,
        title,
        poster_path: posterPath || '',
        addedAt: new Date().toISOString(),
      };
      const next = [newItem, ...filtered];

      profileData[key] = JSON.stringify(next);
      return { item: newItem, count: next.length };
    });

    return res.status(200).json({ success: true, profileId, ...result });
  } catch (error) {
    return sendOauthJsonError(
      res,
      error.statusCode || 401,
      error.oauthError || 'invalid_token',
      error.message || 'Impossible d\'ajouter le favori'
    );
  }
});

// DELETE /api/oauth/favorites/:mediaType/:tmdbId?profileId=<optional>
router.delete('/favorites/:mediaType/:tmdbId', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['favorites.remove']);

    const mediaType = String(req.params.mediaType || '').trim();
    if (mediaType !== 'movie' && mediaType !== 'tv') {
      return sendOauthJsonError(res, 400, 'invalid_request', 'mediaType doit être "movie" ou "tv"');
    }
    const tmdbId = Number(req.params.tmdbId);
    if (!Number.isInteger(tmdbId) || tmdbId <= 0 || tmdbId > 10_000_000) {
      return sendOauthJsonError(res, 400, 'invalid_request', 'tmdbId invalide');
    }

    const profileId = await resolveFavoritesProfileId(tokenRecord, req.query?.profileId);
    const result = await withProfileMutation(tokenRecord, profileId, (profileData) => {
      const key = FAVORITES_KEYS[mediaType];
      const current = parseFavoriteArray(profileData[key]).filter(isValidFavoriteItem);
      const next = current.filter((item) => item.id !== tmdbId);

      // Pas dans la liste — idempotent, on réécrit la même valeur.
      profileData[key] = JSON.stringify(next);
      return { removed: next.length < current.length, count: next.length };
    });

    return res.json({ success: true, profileId, ...result });
  } catch (error) {
    return sendOauthJsonError(
      res,
      error.statusCode || 401,
      error.oauthError || 'invalid_token',
      error.message || 'Impossible de retirer ce favori'
    );
  }
});

// ────────────────────────────────────────────────────────────────────────────
// LISTS (lists.read / lists.manage) + WATCHLIST (watchlist.read / watchlist.manage)
//
// Couvre :
//   - Custom lists (clé localStorage `custom_lists`) : listes nommées
//     contenant des items films/séries.       → scope `lists.*`
//   - Watchlist unifiée :                      → scope `watchlist.*`
//       * media_type "movie"       → `watchlist_movie`
//       * media_type "tv"          → `watchlist_tv`
//       * media_type "live-tv"     → `live_tv_favorite_channels`
//       * media_type "shared-list" → `shared_list_favorites`
//
// Toutes les routes manipulent le PROFILE data (par défaut le profil par défaut
// du compte, ou celui fourni en query/body `profileId`).
// ────────────────────────────────────────────────────────────────────────────

const WATCHLIST_KEYS = {
  movie: 'watchlist_movie',
  tv: 'watchlist_tv',
  'live-tv': 'live_tv_favorite_channels',
  'shared-list': 'shared_list_favorites',
};
const WATCHLIST_MEDIA_TYPES = Object.keys(WATCHLIST_KEYS);

function parseJsonArray(rawValue) {
  if (typeof rawValue !== 'string' || !rawValue.trim()) return [];
  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isValidListId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
}

function sanitizeListName(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 80).replace(/[\x00-\x1f\x7f]/g, '');
}

function sanitizeWatchlistItem(input) {
  if (!input || typeof input !== 'object') return null;
  const id = Number(input.id ?? input.tmdb_id);
  if (!Number.isInteger(id) || id <= 0 || id > 10_000_000) {
    // Les chaînes live-tv et shared-list peuvent avoir un id non-numérique.
    if (typeof input.id !== 'string' && typeof input.tmdb_id !== 'string') return null;
  }
  return {
    id: typeof input.id === 'string' ? input.id.slice(0, 128) : id,
    title: typeof input.title === 'string' ? input.title.slice(0, 300) : '',
    poster_path: typeof input.poster_path === 'string' ? input.poster_path.slice(0, 200) : '',
    addedAt: new Date().toISOString(),
  };
}

async function resolveLibraryProfileId(tokenRecord, explicitProfileId) {
  // SECURITY (audit P1) : valide l'ownership du profileId si fourni.
  const userData = await readUserData(tokenRecord.userType, tokenRecord.userId);
  const profiles = Array.isArray(userData?.profiles) ? userData.profiles : [];
  if (profiles.length === 0) {
    throw createOAuthStorageError('Aucun profil disponible pour ce compte', 404, 'not_found');
  }
  if (explicitProfileId) {
    const safeId = ensureSafeProfileId(explicitProfileId);
    if (!profiles.some((p) => p && p.id === safeId)) {
      throw createOAuthStorageError('Profil introuvable pour ce compte', 404, 'not_found');
    }
    return safeId;
  }
  const defaultProfile = profiles.find((p) => p && p.isDefault) || profiles[0];
  return defaultProfile.id;
}

// SECURITY (audit P1) : helper qui acquiert le lock MySQL sur le couple
// (userType, userId, profileId), lit le profile data, appelle `fn` qui
// modifie en place, écrit, et libère le lock. Garantit qu'aucune écriture
// concurrente (sync ou autre route OAuth) ne perd notre modif (lost-update).
// Lecture des données complètes du fichier (`readProfileImportData`) : au-delà
// de 600 clés, `readProfileData` rend une vue élaguée en mémoire qui ne doit
// jamais être écrite (progressions perdues). L'écriture est alors refusée,
// comme avant l'historique serveur.
async function withProfileMutation(tokenRecord, profileId, fn) {
  return withProfileSyncLock(tokenRecord.userType, tokenRecord.userId, profileId, async () => {
    const profileData = await readProfileImportData(tokenRecord.userType, tokenRecord.userId, profileId);
    const previousData = { ...profileData };
    const result = await fn(profileData);
    const success = await writeProfileData(tokenRecord.userType, tokenRecord.userId, profileId, profileData);
    if (!success) {
      throw createOAuthStorageError('Écriture profile data échouée', 500, 'server_error');
    }
    // Marques « Déjà vu » touchées (watched_*) : recopiées ici, sous le
    // verrou, comme pour /api/sync. Ne fait jamais échouer la requête.
    if (typeof applyProfileMarkChanges === 'function') {
      await applyProfileMarkChanges({ userType: tokenRecord.userType, userId: tokenRecord.userId, profileId }, previousData, profileData);
    }
    return result;
  });
}

// ─── Custom Lists ────────────────────────────────────────────────────────

// GET /api/oauth/lists
router.get('/lists', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['lists.read']);
    const profileId = await resolveLibraryProfileId(tokenRecord, req.query?.profileId);
    const profileData = await readProfileData(tokenRecord.userType, tokenRecord.userId, profileId);
    const lists = parseJsonArray(profileData.custom_lists);
    return res.json({ success: true, profileId, lists });
  } catch (error) {
    return sendOauthJsonError(
      res,
      error.statusCode || 401,
      error.oauthError || 'invalid_token',
      error.message || 'Impossible de récupérer les listes'
    );
  }
});

// POST /api/oauth/lists  body: { name, profileId? }
router.post('/lists', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['lists.create']);
    const name = sanitizeListName(req.body?.name);
    if (!name) return sendOauthJsonError(res, 400, 'invalid_request', 'name requis');

    const profileId = await resolveLibraryProfileId(tokenRecord, req.body?.profileId);
    const result = await withProfileMutation(tokenRecord, profileId, (profileData) => {
      const lists = parseJsonArray(profileData.custom_lists);

      if (lists.length >= 100) {
        throw createOAuthStorageError('Maximum 100 listes par profil', 400, 'invalid_request');
      }

      const newList = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        items: [],
        createdAt: new Date().toISOString(),
      };
      const next = [...lists, newList];
      profileData.custom_lists = JSON.stringify(next);
      return { list: newList };
    });

    return res.status(201).json({ success: true, profileId, ...result });
  } catch (error) {
    return sendOauthJsonError(
      res,
      error.statusCode || 401,
      error.oauthError || 'invalid_token',
      error.message || 'Impossible de créer la liste'
    );
  }
});

// PUT /api/oauth/lists/:listId  body: { name, profileId? }
router.put('/lists/:listId', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['lists.rename']);
    const listId = req.params.listId;
    if (!isValidListId(listId)) return sendOauthJsonError(res, 400, 'invalid_request', 'listId invalide');
    const name = sanitizeListName(req.body?.name);
    if (!name) return sendOauthJsonError(res, 400, 'invalid_request', 'name requis');

    const profileId = await resolveLibraryProfileId(tokenRecord, req.body?.profileId);
    const result = await withProfileMutation(tokenRecord, profileId, (profileData) => {
      const lists = parseJsonArray(profileData.custom_lists);
      const idx = lists.findIndex((l) => l && l.id === listId);
      if (idx === -1) throw createOAuthStorageError('Liste introuvable', 404, 'not_found');

      lists[idx] = { ...lists[idx], name };
      profileData.custom_lists = JSON.stringify(lists);
      return { list: lists[idx] };
    });

    return res.json({ success: true, profileId, ...result });
  } catch (error) {
    return sendOauthJsonError(
      res,
      error.statusCode || 401,
      error.oauthError || 'invalid_token',
      error.message || 'Impossible de renommer la liste'
    );
  }
});

// DELETE /api/oauth/lists/:listId
router.delete('/lists/:listId', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['lists.delete']);
    const listId = req.params.listId;
    if (!isValidListId(listId)) return sendOauthJsonError(res, 400, 'invalid_request', 'listId invalide');

    const profileId = await resolveLibraryProfileId(tokenRecord, req.query?.profileId);
    const result = await withProfileMutation(tokenRecord, profileId, (profileData) => {
      const lists = parseJsonArray(profileData.custom_lists);
      const next = lists.filter((l) => l && l.id !== listId);
      // Idempotent : réécrit même si rien retiré.
      profileData.custom_lists = JSON.stringify(next);
      return { removed: next.length < lists.length };
    });

    return res.json({ success: true, profileId, ...result });
  } catch (error) {
    return sendOauthJsonError(
      res,
      error.statusCode || 401,
      error.oauthError || 'invalid_token',
      error.message || 'Impossible de supprimer cette liste'
    );
  }
});

// POST /api/oauth/lists/:listId/items  body: { tmdb_id, media_type, title, poster_path, profileId? }
router.post('/lists/:listId/items', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['lists.add-item']);
    const listId = req.params.listId;
    if (!isValidListId(listId)) return sendOauthJsonError(res, 400, 'invalid_request', 'listId invalide');

    const mediaType = String(req.body?.media_type || '').trim();
    if (mediaType !== 'movie' && mediaType !== 'tv') {
      return sendOauthJsonError(res, 400, 'invalid_request', 'media_type doit être "movie" ou "tv"');
    }
    const tmdbId = Number(req.body?.tmdb_id);
    if (!Number.isInteger(tmdbId) || tmdbId <= 0 || tmdbId > 10_000_000) {
      return sendOauthJsonError(res, 400, 'invalid_request', 'tmdb_id invalide');
    }
    const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 300) : '';
    const posterPath = typeof req.body?.poster_path === 'string' ? req.body.poster_path.trim().slice(0, 200) : '';
    if (!title) return sendOauthJsonError(res, 400, 'invalid_request', 'title requis');
    if (posterPath && !posterPath.startsWith('/')) {
      return sendOauthJsonError(res, 400, 'invalid_request', 'poster_path invalide');
    }

    const profileId = await resolveLibraryProfileId(tokenRecord, req.body?.profileId);
    const result = await withProfileMutation(tokenRecord, profileId, (profileData) => {
      const lists = parseJsonArray(profileData.custom_lists);
      const idx = lists.findIndex((l) => l && l.id === listId);
      if (idx === -1) throw createOAuthStorageError('Liste introuvable', 404, 'not_found');

      const items = Array.isArray(lists[idx].items) ? lists[idx].items : [];
      if (items.some((it) => it && it.id === tmdbId && it.type === mediaType)) {
        // Déjà dans la liste — write redondant acceptable, pas de modif des données.
        return { list: lists[idx], added: false };
      }
      if (items.length >= 500) {
        throw createOAuthStorageError('Maximum 500 items par liste', 400, 'invalid_request');
      }
      const newItem = { id: tmdbId, type: mediaType, title, poster_path: posterPath, addedAt: new Date().toISOString() };
      lists[idx] = { ...lists[idx], items: [newItem, ...items] };
      profileData.custom_lists = JSON.stringify(lists);
      return { list: lists[idx], added: true };
    });

    return res.json({ success: true, profileId, ...result });
  } catch (error) {
    return sendOauthJsonError(
      res,
      error.statusCode || 401,
      error.oauthError || 'invalid_token',
      error.message || 'Impossible d\'ajouter cet item'
    );
  }
});

// DELETE /api/oauth/lists/:listId/items/:mediaType/:itemId
router.delete('/lists/:listId/items/:mediaType/:itemId', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['lists.remove-item']);
    const listId = req.params.listId;
    if (!isValidListId(listId)) return sendOauthJsonError(res, 400, 'invalid_request', 'listId invalide');
    const mediaType = String(req.params.mediaType || '').trim();
    if (mediaType !== 'movie' && mediaType !== 'tv') {
      return sendOauthJsonError(res, 400, 'invalid_request', 'mediaType doit être "movie" ou "tv"');
    }
    const tmdbId = Number(req.params.itemId);
    if (!Number.isInteger(tmdbId) || tmdbId <= 0 || tmdbId > 10_000_000) {
      return sendOauthJsonError(res, 400, 'invalid_request', 'itemId invalide');
    }

    const profileId = await resolveLibraryProfileId(tokenRecord, req.query?.profileId);
    const result = await withProfileMutation(tokenRecord, profileId, (profileData) => {
      const lists = parseJsonArray(profileData.custom_lists);
      const idx = lists.findIndex((l) => l && l.id === listId);
      if (idx === -1) throw createOAuthStorageError('Liste introuvable', 404, 'not_found');

      const items = Array.isArray(lists[idx].items) ? lists[idx].items : [];
      const nextItems = items.filter((it) => !(it && it.id === tmdbId && it.type === mediaType));
      // Idempotent : réécrit même si item absent.
      lists[idx] = { ...lists[idx], items: nextItems };
      profileData.custom_lists = JSON.stringify(lists);
      return { list: lists[idx], removed: nextItems.length < items.length };
    });

    return res.json({ success: true, profileId, ...result });
  } catch (error) {
    return sendOauthJsonError(
      res,
      error.statusCode || 401,
      error.oauthError || 'invalid_token',
      error.message || 'Impossible de retirer cet item'
    );
  }
});

// ─── Watchlist unifiée ───────────────────────────────────────────────────

// GET /api/oauth/watchlist
router.get('/watchlist', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['watchlist.read']);
    const profileId = await resolveLibraryProfileId(tokenRecord, req.query?.profileId);
    const profileData = await readProfileData(tokenRecord.userType, tokenRecord.userId, profileId);
    const out = {};
    for (const [type, key] of Object.entries(WATCHLIST_KEYS)) {
      out[type] = parseJsonArray(profileData[key]);
    }
    return res.json({ success: true, profileId, watchlist: out });
  } catch (error) {
    return sendOauthJsonError(
      res,
      error.statusCode || 401,
      error.oauthError || 'invalid_token',
      error.message || 'Impossible de récupérer la watchlist'
    );
  }
});

// POST /api/oauth/watchlist  body: { id, media_type, title?, poster_path?, profileId? }
router.post('/watchlist', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['watchlist.add']);
    const mediaType = String(req.body?.media_type || '').trim();
    if (!WATCHLIST_MEDIA_TYPES.includes(mediaType)) {
      return sendOauthJsonError(
        res,
        400,
        'invalid_request',
        `media_type doit être un de : ${WATCHLIST_MEDIA_TYPES.join(', ')}`
      );
    }
    const item = sanitizeWatchlistItem(req.body);
    if (!item || (typeof item.id !== 'number' && typeof item.id !== 'string')) {
      return sendOauthJsonError(res, 400, 'invalid_request', 'id invalide');
    }
    item.type = mediaType;

    const profileId = await resolveLibraryProfileId(tokenRecord, req.body?.profileId);
    const result = await withProfileMutation(tokenRecord, profileId, (profileData) => {
      const key = WATCHLIST_KEYS[mediaType];
      const current = parseJsonArray(profileData[key]);
      const filtered = current.filter((it) => !(it && it.id === item.id));
      const next = [item, ...filtered];
      profileData[key] = JSON.stringify(next);
      return { item, count: next.length };
    });

    return res.json({ success: true, profileId, ...result });
  } catch (error) {
    return sendOauthJsonError(
      res,
      error.statusCode || 401,
      error.oauthError || 'invalid_token',
      error.message || 'Impossible d\'ajouter à la watchlist'
    );
  }
});

// DELETE /api/oauth/watchlist/:mediaType/:itemId
router.delete('/watchlist/:mediaType/:itemId', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['watchlist.remove']);
    const mediaType = String(req.params.mediaType || '').trim();
    if (!WATCHLIST_MEDIA_TYPES.includes(mediaType)) {
      return sendOauthJsonError(
        res,
        400,
        'invalid_request',
        `mediaType doit être un de : ${WATCHLIST_MEDIA_TYPES.join(', ')}`
      );
    }
    const rawId = req.params.itemId;
    let parsedId = Number(rawId);
    if (!Number.isInteger(parsedId) || parsedId <= 0) {
      // Pour live-tv et shared-list, l'id peut être une string.
      parsedId = String(rawId);
    }

    const profileId = await resolveLibraryProfileId(tokenRecord, req.query?.profileId);
    const result = await withProfileMutation(tokenRecord, profileId, (profileData) => {
      const key = WATCHLIST_KEYS[mediaType];
      const current = parseJsonArray(profileData[key]);
      const next = current.filter((it) => !(it && String(it.id) === String(parsedId)));
      // Idempotent : réécrit même si item absent.
      profileData[key] = JSON.stringify(next);
      return { removed: next.length < current.length, count: next.length };
    });

    return res.json({ success: true, profileId, ...result });
  } catch (error) {
    return sendOauthJsonError(
      res,
      error.statusCode || 401,
      error.oauthError || 'invalid_token',
      error.message || 'Impossible de retirer cet item'
    );
  }
});

// ────────────────────────────────────────────────────────────────────────────
// HISTORY (history.read / history.add / history.remove)
// CONTINUE WATCHING (continue-watching.read)
//
// Couvre :
//   - `watched_movie` + `watched_tv` (clés localStorage côté frontend) →
//     liste unifiée des films et séries marqués comme vus.
//   - `continueWatching` (objet `{ movies, tv }`) → reprise en cours.
//
// Toutes les routes manipulent le PROFILE data (par défaut le profil par
// défaut, ou `profileId` fourni en query/body).
// ────────────────────────────────────────────────────────────────────────────

const HISTORY_KEYS = {
  movie: 'watched_movie',
  tv: 'watched_tv',
};

function parseContinueWatching(rawValue) {
  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    return { movies: [], tv: [] };
  }
  try {
    const parsed = JSON.parse(rawValue);
    return {
      movies: Array.isArray(parsed?.movies) ? parsed.movies : [],
      tv: Array.isArray(parsed?.tv) ? parsed.tv : [],
    };
  } catch {
    return { movies: [], tv: [] };
  }
}

// GET /api/oauth/history
router.get('/history', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['history.read']);
    const profileId = await resolveLibraryProfileId(tokenRecord, req.query?.profileId);
    const profileData = await readProfileData(tokenRecord.userType, tokenRecord.userId, profileId);

    const movies = parseJsonArray(profileData[HISTORY_KEYS.movie]).filter(isValidFavoriteItem);
    const tv = parseJsonArray(profileData[HISTORY_KEYS.tv]).filter(isValidFavoriteItem);
    return res.json({ success: true, profileId, movies, tv });
  } catch (error) {
    return sendOauthJsonError(
      res,
      error.statusCode || 401,
      error.oauthError || 'invalid_token',
      error.message || 'Impossible de récupérer l\'historique'
    );
  }
});

// POST /api/oauth/history  body: { tmdb_id, media_type, title, poster_path?, profileId? }
router.post('/history', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['history.add']);

    const tmdbId = Number(req.body?.tmdb_id);
    const mediaType = String(req.body?.media_type || '').trim();
    const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 300) : '';
    const posterPath = typeof req.body?.poster_path === 'string' ? req.body.poster_path.trim().slice(0, 200) : '';

    if (!Number.isInteger(tmdbId) || tmdbId <= 0 || tmdbId > 10_000_000) {
      return sendOauthJsonError(res, 400, 'invalid_request', 'tmdb_id invalide');
    }
    if (mediaType !== 'movie' && mediaType !== 'tv') {
      return sendOauthJsonError(res, 400, 'invalid_request', 'media_type doit être "movie" ou "tv"');
    }
    if (!title) return sendOauthJsonError(res, 400, 'invalid_request', 'title requis');
    if (posterPath && !posterPath.startsWith('/')) {
      return sendOauthJsonError(res, 400, 'invalid_request', 'poster_path invalide');
    }

    const profileId = await resolveLibraryProfileId(tokenRecord, req.body?.profileId);
    const result = await withProfileMutation(tokenRecord, profileId, (profileData) => {
      const key = HISTORY_KEYS[mediaType];
      const current = parseJsonArray(profileData[key]).filter(isValidFavoriteItem);

      const filtered = current.filter((it) => it.id !== tmdbId);
      const newItem = {
        id: tmdbId,
        type: mediaType,
        title,
        poster_path: posterPath || '',
        addedAt: new Date().toISOString(),
      };
      const next = [newItem, ...filtered];
      profileData[key] = JSON.stringify(next);
      return { item: newItem, count: next.length };
    });

    return res.json({ success: true, profileId, ...result });
  } catch (error) {
    return sendOauthJsonError(
      res,
      error.statusCode || 401,
      error.oauthError || 'invalid_token',
      error.message || 'Impossible de marquer comme vu'
    );
  }
});

// DELETE /api/oauth/history/:mediaType/:tmdbId
router.delete('/history/:mediaType/:tmdbId', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['history.remove']);

    const mediaType = String(req.params.mediaType || '').trim();
    if (mediaType !== 'movie' && mediaType !== 'tv') {
      return sendOauthJsonError(res, 400, 'invalid_request', 'mediaType doit être "movie" ou "tv"');
    }
    const tmdbId = Number(req.params.tmdbId);
    if (!Number.isInteger(tmdbId) || tmdbId <= 0 || tmdbId > 10_000_000) {
      return sendOauthJsonError(res, 400, 'invalid_request', 'tmdbId invalide');
    }

    const profileId = await resolveLibraryProfileId(tokenRecord, req.query?.profileId);
    const result = await withProfileMutation(tokenRecord, profileId, (profileData) => {
      const key = HISTORY_KEYS[mediaType];
      const current = parseJsonArray(profileData[key]).filter(isValidFavoriteItem);
      const next = current.filter((it) => it.id !== tmdbId);
      // Idempotent : réécrit même si item absent.
      profileData[key] = JSON.stringify(next);
      return { removed: next.length < current.length, count: next.length };
    });

    return res.json({ success: true, profileId, ...result });
  } catch (error) {
    return sendOauthJsonError(
      res,
      error.statusCode || 401,
      error.oauthError || 'invalid_token',
      error.message || 'Impossible de retirer cet item'
    );
  }
});

// GET /api/oauth/continue-watching
router.get('/continue-watching', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['continue-watching.read']);
    const profileId = await resolveLibraryProfileId(tokenRecord, req.query?.profileId);
    const profileData = await readProfileData(tokenRecord.userType, tokenRecord.userId, profileId);
    const cw = parseContinueWatching(profileData.continueWatching);
    return res.json({ success: true, profileId, continueWatching: cw });
  } catch (error) {
    return sendOauthJsonError(
      res,
      error.statusCode || 401,
      error.oauthError || 'invalid_token',
      error.message || 'Impossible de récupérer la reprise en cours'
    );
  }
});

// ────────────────────────────────────────────────────────────────────────────
// ALERTES — episodeReleaseAlerts (notifications nouvelles saisons / sorties)
//
// Stockées dans le profile data sous la clé `episodeReleaseAlerts` comme
// array d'objets `{ id, type, title, ...}`. On expose 3 routes :
//   GET    /alerts             → liste
//   POST   /alerts             → souscrit  body { tmdb_id, media_type, title? }
//   DELETE /alerts/:type/:id   → désabonne
// ────────────────────────────────────────────────────────────────────────────

router.get('/alerts', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['alerts.read']);
    const profileId = await resolveLibraryProfileId(tokenRecord, req.query?.profileId);
    const profileData = await readProfileData(tokenRecord.userType, tokenRecord.userId, profileId);
    const alerts = parseJsonArray(profileData.episodeReleaseAlerts);
    return res.json({ success: true, profileId, alerts });
  } catch (error) {
    return sendOauthJsonError(res, error.statusCode || 401, error.oauthError || 'invalid_token', error.message || 'Impossible de récupérer les alertes');
  }
});

router.post('/alerts', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['alerts.manage']);
    const tmdbId = Number(req.body?.tmdb_id);
    const mediaType = String(req.body?.media_type || '').trim();
    const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 300) : '';
    if (!Number.isInteger(tmdbId) || tmdbId <= 0 || tmdbId > 10_000_000) return sendOauthJsonError(res, 400, 'invalid_request', 'tmdb_id invalide');
    if (mediaType !== 'movie' && mediaType !== 'tv') return sendOauthJsonError(res, 400, 'invalid_request', 'media_type doit être "movie" ou "tv"');

    const profileId = await resolveLibraryProfileId(tokenRecord, req.body?.profileId);
    const result = await withProfileMutation(tokenRecord, profileId, (profileData) => {
      const current = parseJsonArray(profileData.episodeReleaseAlerts).filter((it) => it && typeof it === 'object');
      const filtered = current.filter((it) => !(it.id === tmdbId && it.type === mediaType));
      const newItem = { id: tmdbId, type: mediaType, title, addedAt: new Date().toISOString() };
      profileData.episodeReleaseAlerts = JSON.stringify([newItem, ...filtered]);
      return { item: newItem };
    });

    return res.json({ success: true, profileId, ...result });
  } catch (error) {
    return sendOauthJsonError(res, error.statusCode || 401, error.oauthError || 'invalid_token', error.message || 'Impossible de souscrire à l\'alerte');
  }
});

router.delete('/alerts/:mediaType/:tmdbId', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['alerts.manage']);
    const mediaType = String(req.params.mediaType || '').trim();
    if (mediaType !== 'movie' && mediaType !== 'tv') return sendOauthJsonError(res, 400, 'invalid_request', 'mediaType invalide');
    const tmdbId = Number(req.params.tmdbId);
    if (!Number.isInteger(tmdbId) || tmdbId <= 0 || tmdbId > 10_000_000) return sendOauthJsonError(res, 400, 'invalid_request', 'tmdbId invalide');
    const profileId = await resolveLibraryProfileId(tokenRecord, req.query?.profileId);
    const result = await withProfileMutation(tokenRecord, profileId, (profileData) => {
      const current = parseJsonArray(profileData.episodeReleaseAlerts).filter((it) => it && typeof it === 'object');
      const next = current.filter((it) => !(it.id === tmdbId && it.type === mediaType));
      // Idempotent : réécrit même si alerte absente.
      profileData.episodeReleaseAlerts = JSON.stringify(next);
      return { removed: next.length < current.length };
    });
    return res.json({ success: true, profileId, ...result });
  } catch (error) {
    return sendOauthJsonError(res, error.statusCode || 401, error.oauthError || 'invalid_token', error.message || 'Impossible de retirer cette alerte');
  }
});

// ────────────────────────────────────────────────────────────────────────────
// RATINGS — notes personnelles (1-10) + texte facultatif
//
// Stockés dans le profile data sous la clé `user_ratings` (créée par cette PR
// — pas de clé localStorage frontend existante, donc on l'introduit).
// Schema : array d'objets { id, type, rating, note?, addedAt }
// ────────────────────────────────────────────────────────────────────────────

router.get('/ratings', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['ratings.read']);
    const profileId = await resolveLibraryProfileId(tokenRecord, req.query?.profileId);
    const profileData = await readProfileData(tokenRecord.userType, tokenRecord.userId, profileId);
    const ratings = parseJsonArray(profileData.user_ratings);
    return res.json({ success: true, profileId, ratings });
  } catch (error) {
    return sendOauthJsonError(res, error.statusCode || 401, error.oauthError || 'invalid_token', error.message || 'Impossible de récupérer les notes');
  }
});

router.post('/ratings', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['ratings.manage']);
    const tmdbId = Number(req.body?.tmdb_id);
    const mediaType = String(req.body?.media_type || '').trim();
    const rating = Number(req.body?.rating);
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 2000) : '';
    if (!Number.isInteger(tmdbId) || tmdbId <= 0 || tmdbId > 10_000_000) return sendOauthJsonError(res, 400, 'invalid_request', 'tmdb_id invalide');
    if (mediaType !== 'movie' && mediaType !== 'tv') return sendOauthJsonError(res, 400, 'invalid_request', 'media_type invalide');
    if (!Number.isFinite(rating) || rating < 1 || rating > 10) return sendOauthJsonError(res, 400, 'invalid_request', 'rating doit être entre 1 et 10');

    const profileId = await resolveLibraryProfileId(tokenRecord, req.body?.profileId);
    const result = await withProfileMutation(tokenRecord, profileId, (profileData) => {
      const current = parseJsonArray(profileData.user_ratings).filter((it) => it && typeof it === 'object');
      const filtered = current.filter((it) => !(it.id === tmdbId && it.type === mediaType));
      const newItem = { id: tmdbId, type: mediaType, rating: Math.round(rating * 10) / 10, note, addedAt: new Date().toISOString() };
      profileData.user_ratings = JSON.stringify([newItem, ...filtered]);
      return { item: newItem };
    });

    return res.json({ success: true, profileId, ...result });
  } catch (error) {
    return sendOauthJsonError(res, error.statusCode || 401, error.oauthError || 'invalid_token', error.message || 'Impossible d\'enregistrer la note');
  }
});

router.delete('/ratings/:mediaType/:tmdbId', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['ratings.manage']);
    const mediaType = String(req.params.mediaType || '').trim();
    if (mediaType !== 'movie' && mediaType !== 'tv') return sendOauthJsonError(res, 400, 'invalid_request', 'mediaType invalide');
    const tmdbId = Number(req.params.tmdbId);
    if (!Number.isInteger(tmdbId) || tmdbId <= 0 || tmdbId > 10_000_000) return sendOauthJsonError(res, 400, 'invalid_request', 'tmdbId invalide');
    const profileId = await resolveLibraryProfileId(tokenRecord, req.query?.profileId);
    const result = await withProfileMutation(tokenRecord, profileId, (profileData) => {
      const current = parseJsonArray(profileData.user_ratings).filter((it) => it && typeof it === 'object');
      const next = current.filter((it) => !(it.id === tmdbId && it.type === mediaType));
      // Idempotent : réécrit même si note absente.
      profileData.user_ratings = JSON.stringify(next);
      return { removed: next.length < current.length };
    });
    return res.json({ success: true, profileId, ...result });
  } catch (error) {
    return sendOauthJsonError(res, error.statusCode || 401, error.oauthError || 'invalid_token', error.message || 'Impossible de retirer la note');
  }
});

// ─── VIP grant : l'app distribue des jours VIP depuis son balance admin-alimenté ────
// Scope requis : `vip.grant` (séparé de `vip.manage` qui parle DU vip de l'user lui-même).
// Cible TOUJOURS le porteur du token — pas de userId arbitraire dans le body.
// Permettre à l'app de cibler n'importe quel userId polluait l'audit log
// (`oauth_vip_grants.user_id_only`) puisqu'aucune ré-vérification ne valide
// que la cible a réellement consenti à recevoir un grant via cette app.
// L'access_key retournée appartient à l'app, qui la transmet à son utilisateur
// final ; le binding "user X a reçu cette clé" reste sous la responsabilité
// de l'app (et est traçable via le user du token utilisé).
router.post('/vip/grant', async (req, res) => {
  try {
    const tokenRecord = await getOauthTokenAuth(req, ['vip.grant']);
    const days = Number(req.body?.days);
    if (!Number.isInteger(days) || days <= 0 || days > 365) {
      return sendOauthJsonError(res, 400, 'invalid_request', 'days doit être un entier entre 1 et 365');
    }

    const targetUserType = String(tokenRecord.userType || '').trim();
    const targetUserId = String(tokenRecord.userId || '').trim();
    if (!targetUserType || !targetUserId) {
      return sendOauthJsonError(res, 401, 'invalid_token', 'Token OAuth incomplet');
    }
    if (targetUserType !== 'oauth' && targetUserType !== 'bip39') {
      return sendOauthJsonError(res, 401, 'invalid_token', 'userType du token invalide');
    }

    const grant = await grantVipFromAppBalance({
      clientId: tokenRecord.clientId,
      userType: targetUserType,
      userId: targetUserId,
      days,
    });

    recordOAuthAppEvent(
      tokenRecord.clientId,
      'vip_grant',
      `${targetUserType}:${targetUserId}`,
      { daysGranted: days, expiresAt: grant.expiresAt },
    ).catch(() => { /* swallow */ });

    return res.json({
      success: true,
      accessKey: grant.accessKey,
      expiresAt: grant.expiresAt,
      daysGranted: grant.daysGranted,
      remainingBalance: grant.remainingBalance,
    });
  } catch (error) {
    return sendOauthJsonError(
      res,
      error.statusCode || 400,
      error.oauthError || 'invalid_request',
      error.message || 'Impossible d\'attribuer des jours VIP',
    );
  }
});

module.exports = router;
// Réutilisés par la liaison télé (routes/tvLink.js) : même lecture de la clé VIP.
module.exports.buildVipIdentity = buildVipIdentity;
module.exports.extractStringField = extractStringField;
