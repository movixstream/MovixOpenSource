/**
 * Authentication middleware and helpers.
 * Extracted from server.js -- JWT setup, admin checks, session validation.
 */

const path = require('path');
const jwt = require('jsonwebtoken');
const { createSecretKey } = require('node:crypto');
const { getPool } = require('../mysqlPool');
const { redis } = require('../config/redis');
const { readAccountData } = require('../utils/accountDataCache');
const { createSessionActivityUpdater } = require('../utils/sessionActivity');
const { getUserDataFilePath } = require('../utils/syncPolicy');
// 'tv' : session ouverte par la liaison d'une TV (routes/tvLink.js). Elle ne
// compte comme aucun fournisseur, donc ne peut pas gérer les liaisons du
// compte (sinon un jeton TV volé permettait de lier son propre Discord).
const AUTH_METHODS = ['discord', 'google', 'bip39', 'tv'];
const TV_SESSION_USER_AGENT = 'Movix TV';
// Une session inutilisée pendant un an n'est plus acceptée : le JWT n'a pas
// d'expiration propre, c'est la session qui en porte une.
const SESSION_MAX_IDLE_DAYS = 365;
const USER_DATA_DIR = path.join(__dirname, '..', 'data');
const GUESTS_DIR = path.join(USER_DATA_DIR, 'guests');
const USERS_DIR = path.join(USER_DATA_DIR, 'users');

// Lazy pool getter -- avoids requiring the pool at module load time
let _pool = null;
function getDbPool() {
  if (!_pool) _pool = getPool();
  return _pool;
}

// === JWT Setup ===
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("FATAL: JWT_SECRET is not defined in .env");
  process.exit(1);
}
// La valeur d'exemple de .env.example est publique : avec elle, n'importe qui
// pourrait signer un jeton.
if (/^YOUR_/i.test(JWT_SECRET.trim())) {
  console.error("FATAL: JWT_SECRET garde la valeur d'exemple de .env.example");
  process.exit(1);
}
if (JWT_SECRET.length < 32) {
  console.warn('[AUTH] JWT_SECRET fait moins de 32 caractères : utilisez une valeur aléatoire plus longue.');
}

function issueJwt(userType, userId, sessionId, authMethod = null) {
  // Issue a token without expiration (no exp claim)
  const payload = { sub: userId, userType, sessionId };
  if (AUTH_METHODS.includes(authMethod)) {
    payload.authMethod = authMethod;
  }
  return jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256' });
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

async function readStoredAccountData(userType, userId) {
  try {
    const filePath = getUserDataFilePath(
      { usersDir: USERS_DIR, guestsDir: GUESTS_DIR },
      userType,
      String(userId)
    );
    return await readAccountData(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }

    console.error('[AUTH] Failed to read stored account data:', error.message || error);
    return undefined;
  }
}

function hasStoredAccountIdentity(userType, userData) {
  if (!userData || typeof userData !== 'object') {
    return false;
  }

  const storedAuth = parseStoredAuth(userData.auth);
  if (storedAuth?.userProfile && typeof storedAuth.userProfile === 'object') {
    return true;
  }

  if (Array.isArray(userData.profiles)) {
    return true;
  }

  if (userType === 'bip39') {
    return userData.bip39_auth === 'true';
  }

  return typeof userData.oauth_provider === 'string' && userData.oauth_provider.trim().length > 0;
}

async function validateBackingAccount(userType, userId) {
  if (!['oauth', 'bip39'].includes(userType) || !userId) {
    return false;
  }

  const userData = await readStoredAccountData(userType, userId);
  if (userData === undefined) {
    return null;
  }

  return hasStoredAccountIdentity(userType, userData);
}

// Erreurs "infrastructure" (MySQL down/restart, pool saturé) — à distinguer
// d'une vraie réponse de la DB. Ne doivent JAMAIS produire un 401 (le front
// déconnecte l'utilisateur sur 401).
const DB_UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'EPIPE', 'EHOSTUNREACH', 'ENOTFOUND',
  'PROTOCOL_CONNECTION_LOST', 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR', 'POOL_CLOSED',
  'ER_CON_COUNT_ERROR', 'ER_SERVER_SHUTDOWN', 'ER_TOO_MANY_USER_CONNECTIONS'
]);

function isDbUnavailableError(error) {
  if (!error) return false;
  if (DB_UNAVAILABLE_CODES.has(error.code)) return true;
  // mysql2 queueLimit atteint : Error sans code, message "Queue limit reached."
  return typeof error.message === 'string' && error.message.includes('Queue limit reached');
}

function purgeSessionRecord(sessionId, userId, userType) {
  try {
    const pool = getDbPool();
    if (!pool || !sessionId || !userId || !userType) {
      return;
    }

    pool.execute(
      'DELETE FROM user_sessions WHERE id = ? AND user_id = ? AND user_type = ?',
      [sessionId, userId, userType]
    ).catch((error) => {
      console.error('[AUTH] Failed to purge orphan session:', error.message || error);
    });
  } catch (error) {
    console.error('[AUTH] Failed to schedule orphan session purge:', error.message || error);
  }
}

// === Auth validation ===

const requestAuth = new WeakMap();

function getAuthIfValid(req) {
  if (!req || typeof req !== 'object') return Promise.resolve(null);
  const header = req.headers?.authorization || req.headers?.Authorization;
  const cached = requestAuth.get(req);
  if (cached && cached.header === header) return cached.promise;
  const promise = validateAuthRequest(req);
  requestAuth.set(req, { header, promise });
  return promise;
}
const JWT_SIGNING_KEY = createSecretKey(JWT_SECRET, 'utf8');

async function validateAuthRequest(req) {
  try {
    const authHeader = req.headers['authorization'] || req.headers['Authorization'];
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) return null;
    const token = authHeader.split(' ')[1];
    const payload = jwt.verify(token, JWT_SIGNING_KEY, { algorithms: ['HS256'] });
    const { userType, sub: userId, sessionId } = payload;
    let authMethod = AUTH_METHODS.includes(payload?.authMethod)
      ? payload.authMethod
      : (userType === 'bip39' ? 'bip39' : null);
    if (!['oauth', 'bip39'].includes(userType) || !userId || !sessionId) return null;

    // Vérification de session via MySQL avec 3 tentatives
    let hasSession = false;
    // true dès qu'une requête aboutit (même avec 0 ligne) : on a une vraie
    // réponse de la DB. false si toutes les tentatives ont échoué (MySQL
    // down/restart, queue limit) → réponse indéterminée.
    let dbAnswered = false;
    const pool = getDbPool();

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        if (!pool) {
          console.warn('[AUTH] MySQL pool not ready, attempt', attempt);
          if (attempt < 3) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
          continue;
        }

        const [rows] = await pool.execute(
          `SELECT id, user_agent FROM user_sessions
            WHERE id = ? AND user_id = ? AND user_type = ?
              AND accessed_at > (NOW() - INTERVAL ${SESSION_MAX_IDLE_DAYS} DAY)`,
          [sessionId, userId, userType]
        );
        dbAnswered = true;
        hasSession = rows.length > 0;
        // Les jetons TV émis avant le marqueur 'tv' n'ont pas d'authMethod et
        // passaient pour une connexion bip39 : on les reconnaît par la session.
        if (hasSession && rows[0].user_agent === TV_SESSION_USER_AGENT) {
          authMethod = 'tv';
        }

        if (hasSession) {
          break; // Session trouvée, sortir de la boucle
        }

        if (attempt < 3) {
          console.log(`[AUTH] Tentative ${attempt}/3 échouée pour userType=${userType}, userId=${userId}, sessionId=${sessionId} - nouvelle tentative dans 0.5s`);
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (error) {
        console.error(`[AUTH] Erreur lors de la tentative ${attempt}/3:`, error.message);
        if (attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    }

    if (!hasSession) {
      if (!dbAnswered) {
        // MySQL n'a jamais répondu (restart, queue limit…) : fail-open sur le
        // JWT (signature déjà vérifiée) plutôt que 401 — un 401 déconnecte
        // l'utilisateur côté front. Seul le contrôle de révocation de session
        // est sauté, le temps de l'indisponibilité. Le compte est encore
        // validé sur disque juste en dessous (validateBackingAccount).
        console.warn(`[AUTH] MySQL indisponible, fail-open JWT pour userType=${userType}, userId=${userId}, sessionId=${sessionId}`);
      } else {
        console.warn(`[AUTH] Session manquante après 3 tentatives pour userType=${userType}, userId=${userId}, sessionId=${sessionId}`);
        return null;
      }
    }

    const hasBackingAccount = await validateBackingAccount(userType, userId);
    if (hasBackingAccount === false) {
      console.warn(`[AUTH] Account backing data missing for userType=${userType}, userId=${userId}. Purging session ${sessionId}.`);
      purgeSessionRecord(sessionId, userId, userType);
      return null;
    }

    // Update last access as activity signal (fire-and-forget, pas de await)
    updateSessionAccess(userType, userId, sessionId);
    return { userType, userId, sessionId, authMethod };
  } catch {
    return null;
  }
}

// === Session access updater (fire-and-forget) ===

const updateSessionAccess = createSessionActivityUpdater({
  redis,
  getPool: getDbPool,
  intervalMs: Number(process.env.SESSION_ACTIVITY_UPDATE_MS || 60_000),
});

// === Admin middleware ===

// Middleware pour vérifier si l'utilisateur est admin
async function isAdmin(req, res, next) {
  try {
    const pool = getDbPool();
    // Vérifier si le pool MySQL est initialisé
    if (!pool) {
      console.error('❌ MySQL pool not initialized');
      return res.status(503).json({ success: false, error: 'Service temporairement indisponible - Base de données en cours d\'initialisation' });
    }

    // Vérifier le JWT
    const auth = await getAuthIfValid(req);
    if (!auth) {
      return res.status(401).json({ success: false, error: 'Non autorisé - Token invalide' });
    }

    const { userId, userType } = auth;

    // Vérifier si l'utilisateur est dans la table admins
    const [rows] = await pool.execute(
      'SELECT * FROM admins WHERE user_id = ? AND auth_type = ?',
      [userId, userType === 'bip39' ? 'bip-39' : userType]
    );

    if (rows.length === 0) {
      return res.status(403).json({ success: false, error: 'Accès refusé - Droits admin requis' });
    }

    // Récupérer le rôle (par défaut 'admin' si non défini — lignes legacy
    // créées avant l'ajout de la colonne `role`).
    const role = rows[0].role || 'admin';

    // Les uploaders sont aussi dans la table `admins` (role='uploader') mais ne
    // doivent PAS franchir `isAdmin` : ces routes (clés VIP, factures, OAuth apps,
    // stats, gestion d'équipe…) sont réservées aux admins. Les routes ouvertes
    // aux uploaders utilisent `isUploaderOrAdmin`. Sans ce contrôle, n'importe
    // quel uploader pouvait appeler directement les API admin-only.
    if (role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Accès refusé - Droits admin requis' });
    }

    // Ajouter les infos admin à la requête (avec le rôle). `isOwner` vient de
    // la colonne `is_owner` (absente sur une base pas encore migrée → false).
    req.admin = { userId, userType, adminId: rows[0].id, role, isOwner: role === 'admin' && Number(rows[0].is_owner) === 1 };
    next();
  } catch (error) {
    console.error('❌ Admin verification error:', error);
    if (isDbUnavailableError(error)) {
      return res.status(503).json({ success: false, error: 'Service temporairement indisponible - Base de données injoignable' });
    }
    return res.status(500).json({ success: false, error: 'Erreur lors de la vérification admin' });
  }
}

/**
 * `true` si la requête est portée par un admin authentifié.
 *
 * Ce n'est pas un middleware : il ne répond rien et ne coupe pas la chaîne. Il
 * sert là où être admin *assouplit* un contrôle sans le conditionner — la
 * dispense de Turnstile, par exemple.
 *
 * La décision se prend sur le JWT vérifié côté serveur et la table `admins`,
 * jamais sur une affirmation du client : un visiteur qui se déclarerait admin
 * repasse par le contrôle ordinaire. En cas de doute — base injoignable, jeton
 * illisible — on refuse la dispense plutôt que de l'accorder à l'aveugle.
 *
 * Les uploaders (`role = 'uploader'`) n'en bénéficient pas, comme pour
 * `isAdmin`.
 */
async function isAdminRequest(req) {
  try {
    const auth = await getAuthIfValid(req);
    if (!auth) return false;

    const pool = getDbPool();
    if (!pool) return false;

    const { userId, userType } = auth;
    const [rows] = await pool.execute(
      'SELECT role FROM admins WHERE user_id = ? AND auth_type = ?',
      [userId, userType === 'bip39' ? 'bip-39' : userType]
    );

    if (rows.length === 0) return false;

    // `role` absent : lignes legacy créées avant l'ajout de la colonne.
    return (rows[0].role || 'admin') === 'admin';
  } catch (error) {
    console.error('❌ Admin request check error:', error.message);
    return false;
  }
}

// Middleware pour vérifier si l'utilisateur est uploader ou admin (pour les liens de streaming)
async function isUploaderOrAdmin(req, res, next) {
  try {
    const pool = getDbPool();
    // Vérifier si le pool MySQL est initialisé
    if (!pool) {
      console.error('❌ MySQL pool not initialized');
      return res.status(503).json({ success: false, error: 'Service temporairement indisponible - Base de données en cours d\'initialisation' });
    }

    // Vérifier le JWT
    const auth = await getAuthIfValid(req);
    if (!auth) {
      return res.status(401).json({ success: false, error: 'Non autorisé - Token invalide' });
    }

    const { userId, userType } = auth;

    // Vérifier si l'utilisateur est dans la table admins (admin ou uploader)
    const [rows] = await pool.execute(
      'SELECT * FROM admins WHERE user_id = ? AND auth_type = ?',
      [userId, userType === 'bip39' ? 'bip-39' : userType]
    );

    if (rows.length === 0) {
      return res.status(403).json({ success: false, error: 'Accès refusé - Droits requis' });
    }

    // Récupérer le rôle (par défaut 'admin' si non défini)
    const role = rows[0].role || 'admin';

    // Autoriser les rôles 'admin' et 'uploader'
    if (role !== 'admin' && role !== 'uploader') {
      return res.status(403).json({ success: false, error: 'Accès refusé - Droits insuffisants' });
    }

    // Ajouter les infos admin à la requête (avec le rôle)
    req.admin = { userId, userType, adminId: rows[0].id, role, isOwner: role === 'admin' && Number(rows[0].is_owner) === 1 };
    next();
  } catch (error) {
    console.error('❌ Admin/Uploader verification error:', error);
    if (isDbUnavailableError(error)) {
      return res.status(503).json({ success: false, error: 'Service temporairement indisponible - Base de données injoignable' });
    }
    return res.status(500).json({ success: false, error: 'Erreur lors de la vérification des droits' });
  }
}

module.exports = {
  JWT_SECRET,
  issueJwt,
  isAdmin,
  isAdminRequest,
  isUploaderOrAdmin,
  getAuthIfValid,
  updateSessionAccess
};
