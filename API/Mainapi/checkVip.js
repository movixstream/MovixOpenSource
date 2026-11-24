/**
 * checkVip.js - Module centralisé de vérification VIP
 * 
 * Vérifie la validité d'une clé d'accès VIP en interrogeant la table `access_keys` MySQL.
 * Utilisé par : liveTvRoutes, wishboardRoutes, commentsRoutes, server.js (fstream), etc.
 * 
 * Le frontend envoie la clé via le header `x-access-key`.
 * Le serveur vérifie que la clé existe, est active et non expirée.
 */

const { getPool } = require('./mysqlPool');
const { LruMap } = require('./utils/lruMap');

// Cache en mémoire pour éviter de spammer MySQL à chaque requête
// TTL de 5 minutes — si une clé est révoquée, il faut max 5 min pour que ça prenne effet
// LRU-capped because the cache key is the user-supplied `x-access-key` header:
// without a cap, a spammer sending random header values could grow the map
// unboundedly within the 5-min cleanup window.
const VIP_CACHE_MAX_ENTRIES = 5000;
const vipCache = new LruMap({ max: VIP_CACHE_MAX_ENTRIES });
const VIP_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Vérifie si une clé d'accès est valide dans la table `access_keys` MySQL.
 * 
 * @param {string} accessKey - La clé d'accès à vérifier
 * @returns {Promise<{vip: boolean, expiresAt: string|null, duration: string|null}>}
 */
async function verifyAccessKey(accessKey) {
    // Pas de clé = pas VIP
    if (!accessKey || typeof accessKey !== 'string' || accessKey.trim() === '') {
        return { vip: false, expiresAt: null, duration: null };
    }

    const trimmedKey = accessKey.trim();

    // Fix encoding: HTTP headers carry non-ASCII bytes as Latin-1.
    // Node stores them as-is in the string, so 0xe9 (é) stays as \xe9.
    // Convert Latin-1 bytes → Buffer → UTF-8 string to recover proper Unicode.
    let fixedKey = trimmedKey;
    try {
        const buf = Buffer.from(trimmedKey, 'latin1');
        const decoded = buf.toString('utf8');
        // Only use the fixed version if it's valid UTF-8 (no replacement chars)
        if (!decoded.includes('\ufffd')) {
            fixedKey = decoded;
        }
    } catch (e) {
        // Encoding fix failed, use original
    }

    // Vérifier le cache d'abord
    const cached = vipCache.get(fixedKey);
    if (cached && (Date.now() - cached.timestamp < VIP_CACHE_TTL)) {
        return cached.result;
    }

    try {
        const pool = getPool();
        if (!pool) {
            console.warn('[checkVip] MySQL pool not available');
            return { vip: false, expiresAt: null, duration: null };
        }

        const [rows] = await pool.execute(
            'SELECT key_value, active, expires_at, duree_validite FROM access_keys WHERE key_value = ? LIMIT 1',
            [fixedKey]
        );

        if (rows.length === 0) {
            // Clé inexistante — mettre en cache le résultat négatif (durée plus courte: 1 min)
            const result = { vip: false, expiresAt: null, duration: null };
            vipCache.set(fixedKey, { result, timestamp: Date.now() });
            return result;
        }

        const keyData = rows[0];

        // Vérifier si la clé est active
        if (!keyData.active) {
            const result = { vip: false, expiresAt: null, duration: null, reason: 'key_inactive' };
            vipCache.set(fixedKey, { result, timestamp: Date.now() });
            return result;
        }

        // Vérifier si la clé a expiré
        if (keyData.expires_at && new Date() > new Date(keyData.expires_at)) {
            const result = { vip: false, expiresAt: keyData.expires_at, duration: keyData.duree_validite, reason: 'key_expired' };
            vipCache.set(fixedKey, { result, timestamp: Date.now() });
            return result;
        }

        // Clé valide !
        const result = {
            vip: true,
            expiresAt: keyData.expires_at || null,
            duration: keyData.duree_validite || null
        };
        vipCache.set(fixedKey, { result, timestamp: Date.now() });
        return result;

    } catch (error) {
        console.error('[checkVip] Error verifying access key:', error.message);
        // En cas d'erreur DB, ne pas bloquer — retourner non-VIP
        return { vip: false, expiresAt: null, duration: null };
    }
}

/**
 * Middleware Express qui extrait la clé du header `x-access-key`
 * et attache le résultat VIP à `req.vipStatus`.
 * 
 * Usage: router.get('/route', vipMiddleware, (req, res) => { ... })
 * Puis accéder à req.vipStatus.vip (boolean)
 */
async function vipMiddleware(req, res, next) {
    const accessKey = req.headers['x-access-key'] || null;
    req.vipStatus = await verifyAccessKey(accessKey);
    next();
}

/**
 * Middleware Express qui BLOQUE l'accès si l'utilisateur n'est pas VIP.
 * Renvoie 403 si la clé est absente ou invalide.
 * 
 * Usage: router.get('/vip-only-route', requireVip, (req, res) => { ... })
 */
async function requireVip(req, res, next) {
    const accessKey = req.headers['x-access-key'] || null;
    const vipStatus = await verifyAccessKey(accessKey);
    req.vipStatus = vipStatus;

    if (!vipStatus.vip) {
        return res.status(403).json({
            success: false,
            error: 'Accès réservé aux membres VIP',
            reason: vipStatus.reason || 'no_valid_key'
        });
    }
    next();
}

// Nettoyage périodique du cache VIP — supprime les entrées expirées pour éviter les fuites mémoire
setInterval(() => {
    const now = Date.now();
    for (const [key, cached] of vipCache) {
        if (now - cached.timestamp > VIP_CACHE_TTL) {
            vipCache.delete(key);
        }
    }
}, VIP_CACHE_TTL).unref(); // Nettoyage toutes les 5 minutes

/**
 * Invalider le cache pour une clé spécifique (utile quand un admin révoque une clé)
 * @param {string} accessKey
 */
function invalidateVipCache(accessKey) {
    if (accessKey) {
        vipCache.delete(accessKey.trim());
        publishVipCacheInvalidation(accessKey.trim());
    }
}

/**
 * Invalider tout le cache VIP (utile pour un flush global)
 */
function invalidateAllVipCache() {
    vipCache.clear();
    publishVipCacheInvalidation('*');
}

// ─── Invalidation entre processus du cluster (Redis pub/sub) ─────────────
// Chaque processus du cluster (server.js) a son propre cache. Sans diffusion,
// une clé révoquée restait acceptée jusqu'à 5 min par les autres processus.
// Redis est chargé à la demande : les tests chargent ce module sans Redis.
const VIP_CACHE_CHANNEL = 'vip:cache:invalidate';
let vipCacheSubscriber = null;

function getRedis() {
    try {
        return require('./config/redis').redis || null;
    } catch {
        return null;
    }
}

function publishVipCacheInvalidation(message) {
    // Rien à diffuser tant que l'abonné n'est pas lancé (tests, scripts).
    if (!vipCacheSubscriber) return;
    const redis = getRedis();
    if (!redis) return;
    Promise.resolve()
        .then(() => redis.publish(VIP_CACHE_CHANNEL, message))
        .catch((err) => console.warn("[checkVip] diffusion de l'invalidation impossible:", err.message));
}

/** À appeler une fois par processus au démarrage. */
function startVipCacheSubscriber() {
    if (vipCacheSubscriber) return;
    const redis = getRedis();
    if (!redis || typeof redis.duplicate !== 'function') return;
    vipCacheSubscriber = redis.duplicate();
    vipCacheSubscriber.on('error', (err) => {
        console.error('[checkVip] abonné du cache VIP en erreur:', err.message);
    });
    vipCacheSubscriber.on('message', (channel, message) => {
        if (channel !== VIP_CACHE_CHANNEL) return;
        if (message === '*') vipCache.clear();
        else vipCache.delete(message);
    });
    vipCacheSubscriber.subscribe(VIP_CACHE_CHANNEL, (err) => {
        if (err) console.error('[checkVip] abonnement au cache VIP impossible:', err.message);
    });
}

module.exports = {
    verifyAccessKey,
    vipMiddleware,
    requireVip,
    invalidateVipCache,
    invalidateAllVipCache,
    startVipCacheSubscriber
};
