const crypto = require('crypto');
const { getPool } = require('../mysqlPool');
const { ensureTableGroup } = require('../db/runtimeEnsure');

const AUTHORIZATION_REQUEST_TTL_MS = 10 * 60 * 1000;
const AUTHORIZATION_CODE_TTL_MS = 10 * 60 * 1000;
const ACCESS_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function createOAuthStorageError(message, statusCode = 400, oauthError = 'invalid_request') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.oauthError = oauthError;
  return error;
}

function toBase64Url(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function generateOpaqueToken(prefix) {
  return `${prefix}_${toBase64Url(crypto.randomBytes(32))}`;
}

function hashOpaqueToken(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function serializeScopes(scopes) {
  return JSON.stringify(Array.isArray(scopes) ? scopes : []);
}

function normalizeAuthorizationRequest(payload = {}) {
  const clientId = String(payload.clientId || payload.client_id || '').trim();
  const redirectUri = String(payload.redirectUri || payload.redirect_uri || '').trim();
  const responseType = String(payload.responseType || payload.response_type || 'code').trim() || 'code';
  const state = typeof payload.state === 'string'
    ? payload.state
    : payload.state != null
      ? String(payload.state)
      : '';
  const scopes = Array.isArray(payload.scopes)
    ? payload.scopes.map((scope) => String(scope || '').trim()).filter(Boolean).sort()
    : [];
  const codeChallenge = typeof payload.codeChallenge === 'string' && payload.codeChallenge.trim()
    ? payload.codeChallenge.trim()
    : null;
  const codeChallengeMethod = typeof payload.codeChallengeMethod === 'string' && payload.codeChallengeMethod.trim()
    ? payload.codeChallengeMethod.trim().toUpperCase()
    : null;

  return {
    clientId,
    redirectUri,
    responseType,
    scopes,
    state,
    codeChallenge,
    codeChallengeMethod,
  };
}

function hashAuthorizationRequest(payload = {}) {
  const normalized = normalizeAuthorizationRequest(payload);
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function parseScopes(rawScopes) {
  if (!rawScopes) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawScopes);
    return Array.isArray(parsed)
      ? parsed.map((scope) => String(scope || '').trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function normalizeDate(value) {
  if (value == null) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function mapAuthorizationCodeRow(row) {
  if (!row) {
    return null;
  }

  return {
    codeHash: row.code_hash,
    clientId: row.client_id,
    userId: row.user_id,
    userType: row.user_type,
    sessionId: row.session_id,
    scopes: parseScopes(row.scopes),
    redirectUri: row.redirect_uri,
    codeChallenge: row.code_challenge || null,
    codeChallengeMethod: row.code_challenge_method || null,
    expiresAt: normalizeDate(row.expires_at),
    usedAt: normalizeDate(row.used_at),
    createdAt: normalizeDate(row.created_at),
  };
}

function mapAuthorizationRequestRow(row) {
  if (!row) {
    return null;
  }

  return {
    requestHash: row.request_hash,
    clientId: row.client_id,
    redirectUri: row.redirect_uri,
    responseType: row.response_type,
    scopes: parseScopes(row.scopes),
    state: row.state || '',
    codeChallenge: row.code_challenge || null,
    codeChallengeMethod: row.code_challenge_method || null,
    expiresAt: normalizeDate(row.expires_at),
    consumedAt: normalizeDate(row.consumed_at),
    decision: row.decision || null,
    createdAt: normalizeDate(row.created_at),
    lastSeenAt: normalizeDate(row.last_seen_at),
  };
}

function mapAccessTokenRow(row) {
  if (!row) {
    return null;
  }

  return {
    tokenHash: row.token_hash,
    clientId: row.client_id,
    userId: row.user_id,
    userType: row.user_type,
    sessionId: row.session_id,
    scopes: parseScopes(row.scopes),
    expiresAt: normalizeDate(row.expires_at),
    revokedAt: normalizeDate(row.revoked_at),
    createdAt: normalizeDate(row.created_at),
    lastUsedAt: normalizeDate(row.last_used_at),
    authorizationCodeHash: row.authorization_code_hash || null,
  };
}

async function ensureOAuthStorage(pool = getPool()) {
  if (!pool) {
    throw new Error('MySQL pool not ready for OAuth storage');
  }
  await ensureTableGroup(pool, 'oauth');
}

async function registerAuthorizationRequest(pool, payload) {
  if (!pool || typeof pool.execute !== 'function') {
    throw new Error('MySQL pool not ready for OAuth authorization request registration');
  }

  const normalized = normalizeAuthorizationRequest(payload);
  const requestHash = hashAuthorizationRequest(normalized);
  const expiresAt = new Date(Date.now() + AUTHORIZATION_REQUEST_TTL_MS);

  await pool.execute(
    `INSERT INTO oauth_authorization_requests
      (request_hash, client_id, redirect_uri, response_type, scopes, state, code_challenge, code_challenge_method, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      client_id = VALUES(client_id),
      redirect_uri = VALUES(redirect_uri),
      response_type = VALUES(response_type),
      scopes = VALUES(scopes),
      state = VALUES(state),
      code_challenge = VALUES(code_challenge),
      code_challenge_method = VALUES(code_challenge_method),
      expires_at = VALUES(expires_at),
      last_seen_at = NOW()`,
    [
      requestHash,
      normalized.clientId,
      normalized.redirectUri,
      normalized.responseType,
      serializeScopes(normalized.scopes),
      normalized.state,
      normalized.codeChallenge,
      normalized.codeChallengeMethod,
      expiresAt,
    ]
  );

  return getAuthorizationRequestRecord(pool, normalized);
}

async function getAuthorizationRequestRecord(pool, payload) {
  if (!pool || !payload) {
    return null;
  }

  const requestHash = hashAuthorizationRequest(payload);
  const [rows] = await pool.execute(
    'SELECT * FROM oauth_authorization_requests WHERE request_hash = ? LIMIT 1',
    [requestHash]
  );

  return mapAuthorizationRequestRow(rows[0] || null);
}

async function claimAuthorizationRequest(connection, payload, decision) {
  if (!connection || typeof connection.execute !== 'function') {
    throw new Error('MySQL connection not ready for OAuth authorization request claim');
  }

  const normalized = normalizeAuthorizationRequest(payload);
  const requestHash = hashAuthorizationRequest(normalized);
  const [rows] = await connection.execute(
    'SELECT * FROM oauth_authorization_requests WHERE request_hash = ? LIMIT 1 FOR UPDATE',
    [requestHash]
  );

  const requestRecord = mapAuthorizationRequestRow(rows[0] || null);
  if (!requestRecord) {
    throw createOAuthStorageError('Demande OAuth introuvable', 400, 'invalid_request');
  }

  if (!requestRecord.expiresAt || requestRecord.expiresAt.getTime() <= Date.now()) {
    throw createOAuthStorageError('Cette demande OAuth a expiré', 400, 'invalid_request');
  }

  if (requestRecord.consumedAt) {
    throw createOAuthStorageError('Cette demande OAuth a déjà été utilisée. Regénérez une nouvelle demande depuis Movix Translate.', 400, 'invalid_grant');
  }

  const [updateResult] = await connection.execute(
    'UPDATE oauth_authorization_requests SET consumed_at = NOW(), decision = ?, last_seen_at = NOW() WHERE request_hash = ? AND consumed_at IS NULL',
    [decision, requestHash]
  );

  if (!updateResult || updateResult.affectedRows !== 1) {
    throw createOAuthStorageError('Cette demande OAuth a déjà été utilisée. Regénérez une nouvelle demande depuis Movix Translate.', 400, 'invalid_grant');
  }

  return requestRecord;
}

async function createAuthorizationCode(pool, payload) {
  if (!pool) {
    throw new Error('MySQL pool not ready for OAuth authorization code creation');
  }

  const code = generateOpaqueToken('movix_code');
  const codeHash = hashOpaqueToken(code);
  const expiresAt = new Date(Date.now() + AUTHORIZATION_CODE_TTL_MS);

  await pool.execute(
    `INSERT INTO oauth_authorization_codes
      (code_hash, client_id, user_id, user_type, session_id, scopes, redirect_uri, code_challenge, code_challenge_method, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      codeHash,
      payload.clientId,
      payload.userId,
      payload.userType,
      payload.sessionId || null,
      serializeScopes(payload.scopes),
      payload.redirectUri,
      payload.codeChallenge || null,
      payload.codeChallengeMethod || null,
      expiresAt,
    ]
  );

  return {
    code,
    codeHash,
    expiresAt,
  };
}

async function exchangeAuthorizationCode(pool, payload) {
  if (!pool) {
    throw new Error('MySQL pool not ready for OAuth token exchange');
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const codeHash = hashOpaqueToken(payload.code);
    const [rows] = await connection.execute(
      'SELECT * FROM oauth_authorization_codes WHERE code_hash = ? LIMIT 1 FOR UPDATE',
      [codeHash]
    );

    const authorizationCode = mapAuthorizationCodeRow(rows[0] || null);
    if (!authorizationCode) {
      throw createOAuthStorageError('Code d’autorisation invalide', 400, 'invalid_grant');
    }

    if (authorizationCode.clientId !== payload.clientId) {
      throw createOAuthStorageError('Client OAuth invalide pour ce code', 400, 'invalid_grant');
    }

    if (authorizationCode.redirectUri !== payload.redirectUri) {
      throw createOAuthStorageError('redirect_uri invalide pour ce code', 400, 'invalid_grant');
    }

    if (authorizationCode.usedAt) {
      throw createOAuthStorageError('Code d’autorisation déjà utilisé', 400, 'invalid_grant');
    }

    if (!authorizationCode.expiresAt || authorizationCode.expiresAt.getTime() <= Date.now()) {
      throw createOAuthStorageError('Code d’autorisation expiré', 400, 'invalid_grant');
    }

    await connection.execute(
      'UPDATE oauth_authorization_codes SET used_at = NOW() WHERE code_hash = ? AND used_at IS NULL',
      [authorizationCode.codeHash]
    );

    const accessToken = generateOpaqueToken('movix_oat');
    const tokenHash = hashOpaqueToken(accessToken);
    const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_MS);

    await connection.execute(
      `INSERT INTO oauth_access_tokens
        (token_hash, client_id, user_id, user_type, session_id, scopes, expires_at, authorization_code_hash, created_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        tokenHash,
        authorizationCode.clientId,
        authorizationCode.userId,
        authorizationCode.userType,
        authorizationCode.sessionId || null,
        serializeScopes(authorizationCode.scopes),
        expiresAt,
        authorizationCode.codeHash,
      ]
    );

    await connection.commit();

    return {
      accessToken,
      accessTokenHash: tokenHash,
      expiresAt,
      scopes: authorizationCode.scopes,
      clientId: authorizationCode.clientId,
      userId: authorizationCode.userId,
      userType: authorizationCode.userType,
      sessionId: authorizationCode.sessionId,
      authorizationCode,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function getAccessTokenRecord(pool, accessToken, options = {}) {
  if (!pool || !accessToken) {
    return null;
  }

  const tokenHash = hashOpaqueToken(accessToken);
  // Un jeton lié à une session du site meurt avec elle : supprimer la
  // session (déconnexion, « supprimer cet appareil ») coupe aussi les apps
  // autorisées depuis cette session.
  const [rows] = await pool.execute(
    `SELECT t.* FROM oauth_access_tokens t
      WHERE t.token_hash = ?
        AND (t.session_id IS NULL OR EXISTS (
          SELECT 1 FROM user_sessions s
            WHERE s.id = t.session_id AND s.user_id = t.user_id AND s.user_type = t.user_type
        ))
      LIMIT 1`,
    [tokenHash]
  );

  const record = mapAccessTokenRow(rows[0] || null);
  if (!record) {
    return null;
  }

  if (record.revokedAt) {
    return null;
  }

  if (!record.expiresAt || record.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  if (options.touch === true) {
    pool.execute(
      'UPDATE oauth_access_tokens SET last_used_at = NOW() WHERE token_hash = ?',
      [tokenHash]
    ).catch((error) => {
      console.error('[OAuth Storage] Failed to update token usage:', error.message || error);
    });
  }

  return record;
}

/** Révoque tous les jetons encore actifs d'une app (app supprimée). */
async function revokeClientAccessTokens(pool, clientId) {
  if (!pool || !clientId) return 0;
  const [result] = await pool.execute(
    'UPDATE oauth_access_tokens SET revoked_at = NOW() WHERE client_id = ? AND revoked_at IS NULL',
    [String(clientId)]
  );
  return result?.affectedRows || 0;
}

module.exports = {
  revokeClientAccessTokens,
  AUTHORIZATION_REQUEST_TTL_MS,
  AUTHORIZATION_CODE_TTL_MS,
  ACCESS_TOKEN_TTL_MS,
  createOAuthStorageError,
  hashOpaqueToken,
  hashAuthorizationRequest,
  ensureOAuthStorage,
  registerAuthorizationRequest,
  getAuthorizationRequestRecord,
  claimAuthorizationRequest,
  createAuthorizationCode,
  exchangeAuthorizationCode,
  getAccessTokenRecord,
};
