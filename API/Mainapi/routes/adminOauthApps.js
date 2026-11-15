/**
 * Routes admin pour gérer les applications OAuth Movix.
 * Mount : `app.use('/api/admin/oauth-apps', adminOauthAppsRouter)`.
 *
 * Toutes les routes sont protégées par `isAdmin` (table `admins`).
 * Source de vérité : la table `oauth_clients` (alimentée au boot par
 * `oauthClientsDb.reloadCache()`). Toute mutation appelle
 * `reloadCacheAndBroadcast()` en fin de requête : recharge le cache du
 * worker courant ET publie sur Redis (canal `oauth:clients:changed`) pour
 * que tous les autres workers du cluster rechargent aussi.
 *
 * Sans ce broadcast, un worker dont le cache est stale rejette
 * indéfiniment les requêtes OAuth d'un client modifié après le boot
 * (ex. une redirect_uri ajoutée) — symptôme intermittent selon le worker
 * qui reçoit la requête.
 */

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

const { isAdmin } = require('../middleware/auth');
const { getPool } = require('../mysqlPool');
const oauthClientsDb = require('../utils/oauthClientsDb');
const { KNOWN_OAUTH_SCOPES, requiresClientAuthentication } = require('../utils/oauthClients');
const { createRedisRateLimitStore } = require('../utils/redisRateLimitStore');

const router = express.Router();

const ALLOWED_ICON_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
const MAX_ICON_SIZE_BYTES = 256 * 1024; // 256 KB

const CLIENT_ID_RE = /^[a-z0-9][a-z0-9-]{1,64}$/;
const PUBLIC_CLIENT_SCOPE_ERROR = 'vip.grant exige une application confidentielle (avec client_secret) : décochez « client public » ou retirez cette permission';

// Petit rate-limiter pour les routes admin OAuth (anti-bruteforce sur les secrets).
const adminOauthAppsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  store: createRedisRateLimitStore({ prefix: 'rate-limit:admin:oauth-apps:' }),
  passOnStoreError: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) =>
    req.headers['cf-connecting-ip']
      || req.headers['x-forwarded-for']?.split(',')[0].trim()
      || ipKeyGenerator(req.ip),
  validate: { xForwardedForHeader: false, ip: false },
});

router.use(adminOauthAppsLimiter);
router.use(isAdmin);

// ─── helpers ────────────────────────────────────────────────────────────

function badRequest(res, message) {
  return res.status(400).json({ success: false, error: message });
}

function notFound(res, message = 'Application OAuth introuvable') {
  return res.status(404).json({ success: false, error: message });
}

function serverError(res, error, message = 'Erreur serveur') {
  console.error('[adminOauthApps]', message, error?.message || error);
  return res.status(500).json({ success: false, error: message });
}

function sanitizeClientId(raw) {
  const value = String(raw || '').trim().toLowerCase();
  return CLIENT_ID_RE.test(value) ? value : null;
}

function sanitizeClientName(raw) {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().slice(0, 200);
  return value.length >= 2 ? value : null;
}

function sanitizeDescription(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string') return null;
  return raw.trim().slice(0, 2000) || null;
}

function sanitizeHttpUrl(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw.trim());
    // HTTPS only : le homepageUrl est rendu en lien cliquable sur la page
    // d'autorisation OAuth (boundary de confiance pour l'utilisateur).
    // Pas d'exception loopback ici — c'est pour le marketing, pas pour OAuth.
    if (url.protocol !== 'https:') return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function sanitizeRedirectUris(rawArray) {
  if (!Array.isArray(rawArray)) return null;
  const result = [];
  for (const raw of rawArray) {
    if (typeof raw !== 'string') continue;
    try {
      const url = new URL(raw.trim());
      const host = url.hostname.toLowerCase();
      const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost');
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
        continue;
      }
      url.hash = '';
      result.push(url.toString());
    } catch { /* skip */ }
  }
  return result.length > 0 ? Array.from(new Set(result)) : null;
}

function sanitizeScopes(rawArray) {
  if (!Array.isArray(rawArray)) return null;
  const result = Array.from(new Set(
    rawArray
      .map((s) => String(s || '').trim())
      .filter((s) => KNOWN_OAUTH_SCOPES.includes(s)),
  ));
  return result.length > 0 ? result : null;
}

function generateClientSecret() {
  // 64 chars hex = 256 bits — assez pour un secret OAuth.
  return crypto.randomBytes(32).toString('hex');
}

function serializeAppRow(row) {
  return {
    id: Number(row.id),
    clientId: row.client_id,
    clientName: row.client_name,
    description: row.description || null,
    homepageUrl: row.homepage_url || null,
    redirectUris: safeJsonParse(row.redirect_uris, []),
    allowedScopes: safeJsonParse(row.allowed_scopes, []),
    publicClient: row.public_client === 1 || row.public_client === true,
    requirePkce: row.require_pkce === 1 || row.require_pkce === true,
    hasClientSecret: !!row.client_secret,
    iconFilename: row.icon_filename || null,
    iconUrl: row.icon_filename ? `/oauth-icons/${row.icon_filename}` : null,
    vipDaysBalance: Number(row.vip_days_balance || 0),
    isActive: row.is_active === 1 || row.is_active === true,
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0),
  };
}

function safeJsonParse(raw, fallback) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return Array.isArray(raw) ? raw : fallback;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function fetchAppByClientId(pool, clientId) {
  const [rows] = await pool.execute(
    'SELECT * FROM oauth_clients WHERE client_id = ? LIMIT 1',
    [clientId],
  );
  return rows[0] || null;
}

async function removeIconFile(filename) {
  if (!filename) return;
  const target = path.join(oauthClientsDb.ICON_DIR, path.basename(filename));
  try {
    await fsp.unlink(target);
  } catch {
    /* swallow: déjà absent */
  }
}

// ─── routes ─────────────────────────────────────────────────────────────

router.get('/scopes', (req, res) => {
  res.json({ success: true, scopes: [...KNOWN_OAUTH_SCOPES] });
});

router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    const includeInactive = req.query?.inactive === '1' || req.query?.inactive === 'true';
    const whereSql = includeInactive ? '' : 'WHERE is_active = 1';
    const [rows] = await pool.execute(
      `SELECT * FROM oauth_clients ${whereSql} ORDER BY created_at DESC`,
    );

    // Stats compactes par app (30 derniers jours) pour l'affichage en liste.
    const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const [statsRows] = await pool.execute(
      `SELECT client_id, event_type, COUNT(*) AS n
         FROM oauth_app_stats
        WHERE created_at >= ?
        GROUP BY client_id, event_type`,
      [since],
    );
    const statsByClient = new Map();
    for (const r of statsRows) {
      if (!statsByClient.has(r.client_id)) statsByClient.set(r.client_id, {});
      statsByClient.get(r.client_id)[r.event_type] = Number(r.n);
    }

    const apps = rows.map((row) => ({
      ...serializeAppRow(row),
      stats30d: statsByClient.get(row.client_id) || {},
    }));
    return res.json({ success: true, apps });
  } catch (err) {
    return serverError(res, err, 'Impossible de lister les applications');
  }
});

router.get('/:clientId', async (req, res) => {
  try {
    const clientId = sanitizeClientId(req.params.clientId);
    if (!clientId) return badRequest(res, 'clientId invalide');
    const pool = getPool();
    const row = await fetchAppByClientId(pool, clientId);
    if (!row) return notFound(res);
    return res.json({ success: true, app: serializeAppRow(row) });
  } catch (err) {
    return serverError(res, err, 'Impossible de charger l\'application');
  }
});

router.post('/', async (req, res) => {
  try {
    const clientId = sanitizeClientId(req.body?.clientId);
    if (!clientId) return badRequest(res, 'clientId invalide (a-z, 0-9, -, 2 à 65 caractères)');
    const clientName = sanitizeClientName(req.body?.clientName);
    if (!clientName) return badRequest(res, 'clientName requis (≥2 caractères)');
    const redirectUris = sanitizeRedirectUris(req.body?.redirectUris);
    if (!redirectUris) return badRequest(res, 'redirectUris requis (≥1 URI HTTPS ou loopback http)');
    const allowedScopes = sanitizeScopes(req.body?.allowedScopes);
    if (!allowedScopes) return badRequest(res, 'allowedScopes requis (≥1 scope connu)');
    const description = sanitizeDescription(req.body?.description);
    const homepageUrl = sanitizeHttpUrl(req.body?.homepageUrl);
    const publicClient = req.body?.publicClient !== false;
    if (publicClient && requiresClientAuthentication(allowedScopes)) {
      return badRequest(res, PUBLIC_CLIENT_SCOPE_ERROR);
    }
    const requirePkce = publicClient ? true : req.body?.requirePkce === true;
    const generatedSecret = !publicClient ? generateClientSecret() : null;

    const pool = getPool();
    const existing = await fetchAppByClientId(pool, clientId);
    if (existing) return badRequest(res, 'Cet clientId existe déjà');

    const now = Date.now();
    await pool.execute(
      `INSERT INTO oauth_clients
        (client_id, client_name, description, homepage_url, redirect_uris,
         allowed_scopes, public_client, require_pkce, client_secret,
         is_active, vip_days_balance, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
      [
        clientId,
        clientName,
        description,
        homepageUrl,
        JSON.stringify(redirectUris),
        JSON.stringify(allowedScopes),
        publicClient ? 1 : 0,
        requirePkce ? 1 : 0,
        generatedSecret,
        now,
        now,
      ],
    );

    await oauthClientsDb.reloadCacheAndBroadcast();
    const row = await fetchAppByClientId(pool, clientId);
    const serialized = serializeAppRow(row);
    // Le secret n'est exposé qu'UNE fois (à la création) — l'admin doit le copier.
    return res.json({
      success: true,
      app: serialized,
      clientSecret: generatedSecret, // null pour les clients publics
    });
  } catch (err) {
    return serverError(res, err, 'Impossible de créer l\'application');
  }
});

router.put('/:clientId', async (req, res) => {
  try {
    const clientId = sanitizeClientId(req.params.clientId);
    if (!clientId) return badRequest(res, 'clientId invalide');

    const pool = getPool();
    const existing = await fetchAppByClientId(pool, clientId);
    if (!existing) return notFound(res);

    const updates = [];
    const params = [];

    // État après la mise à jour : un client public ne garde ni ne reçoit une
    // permission qui exige le `client_secret`.
    const nextPublicClient = req.body?.publicClient !== undefined
      ? req.body.publicClient === true
      : existing.public_client === 1 || existing.public_client === true;
    const nextScopes = req.body?.allowedScopes !== undefined
      ? sanitizeScopes(req.body.allowedScopes)
      : safeJsonParse(existing.allowed_scopes, []);
    if (nextPublicClient && requiresClientAuthentication(nextScopes)) {
      return badRequest(res, PUBLIC_CLIENT_SCOPE_ERROR);
    }

    if (req.body?.clientName !== undefined) {
      const v = sanitizeClientName(req.body.clientName);
      if (!v) return badRequest(res, 'clientName invalide');
      updates.push('client_name = ?'); params.push(v);
    }
    if (req.body?.description !== undefined) {
      updates.push('description = ?'); params.push(sanitizeDescription(req.body.description));
    }
    if (req.body?.homepageUrl !== undefined) {
      updates.push('homepage_url = ?'); params.push(sanitizeHttpUrl(req.body.homepageUrl));
    }
    if (req.body?.redirectUris !== undefined) {
      const v = sanitizeRedirectUris(req.body.redirectUris);
      if (!v) return badRequest(res, 'redirectUris invalide (≥1 URI HTTPS ou loopback http)');
      updates.push('redirect_uris = ?'); params.push(JSON.stringify(v));
    }
    if (req.body?.allowedScopes !== undefined) {
      const v = sanitizeScopes(req.body.allowedScopes);
      if (!v) return badRequest(res, 'allowedScopes invalide');
      updates.push('allowed_scopes = ?'); params.push(JSON.stringify(v));
    }
    if (req.body?.publicClient !== undefined) {
      const becomesPublic = req.body.publicClient === true;
      updates.push('public_client = ?'); params.push(becomesPublic ? 1 : 0);
      if (becomesPublic) {
        // Switch confidential → public : on force pkce et on supprime le secret.
        updates.push('require_pkce = 1');
        updates.push('client_secret = NULL');
      }
    }
    if (req.body?.requirePkce !== undefined) {
      updates.push('require_pkce = ?'); params.push(req.body.requirePkce === true ? 1 : 0);
    }
    if (req.body?.isActive !== undefined) {
      updates.push('is_active = ?'); params.push(req.body.isActive === true ? 1 : 0);
    }

    if (updates.length === 0) return badRequest(res, 'Aucun champ à mettre à jour');

    updates.push('updated_at = ?'); params.push(Date.now());
    params.push(clientId);

    await pool.execute(
      `UPDATE oauth_clients SET ${updates.join(', ')} WHERE client_id = ?`,
      params,
    );

    await oauthClientsDb.reloadCacheAndBroadcast();
    const row = await fetchAppByClientId(pool, clientId);
    return res.json({ success: true, app: serializeAppRow(row) });
  } catch (err) {
    return serverError(res, err, 'Impossible de mettre à jour l\'application');
  }
});

router.post('/:clientId/regenerate-secret', async (req, res) => {
  try {
    const clientId = sanitizeClientId(req.params.clientId);
    if (!clientId) return badRequest(res, 'clientId invalide');
    const pool = getPool();
    const existing = await fetchAppByClientId(pool, clientId);
    if (!existing) return notFound(res);
    if (existing.public_client === 1 || existing.public_client === true) {
      return badRequest(res, 'Les clients publics n\'utilisent pas de clientSecret');
    }
    const newSecret = generateClientSecret();
    await pool.execute(
      'UPDATE oauth_clients SET client_secret = ?, updated_at = ? WHERE client_id = ?',
      [newSecret, Date.now(), clientId],
    );
    await oauthClientsDb.reloadCacheAndBroadcast();
    return res.json({ success: true, clientSecret: newSecret });
  } catch (err) {
    return serverError(res, err, 'Impossible de régénérer le secret');
  }
});

router.delete('/:clientId', async (req, res) => {
  try {
    const clientId = sanitizeClientId(req.params.clientId);
    if (!clientId) return badRequest(res, 'clientId invalide');
    const pool = getPool();
    const existing = await fetchAppByClientId(pool, clientId);
    if (!existing) return notFound(res);
    // Hard delete : on supprime la ligne ; les stats et grants restent
    // (FK absente volontairement — historique d'audit).
    await pool.execute('DELETE FROM oauth_clients WHERE client_id = ?', [clientId]);
    // Cleanup icône si présente.
    if (existing.icon_filename) {
      await removeIconFile(existing.icon_filename);
    }
    await oauthClientsDb.reloadCacheAndBroadcast();
    return res.json({ success: true });
  } catch (err) {
    return serverError(res, err, 'Impossible de supprimer l\'application');
  }
});

// Upload icône : JSON body { mimeType, dataBase64 }
// On évite multer pour ne pas ajouter une dépendance ; les icônes sont
// petites (< 256KB) donc base64 dans le body JSON est OK.
router.post('/:clientId/icon', async (req, res) => {
  try {
    const clientId = sanitizeClientId(req.params.clientId);
    if (!clientId) return badRequest(res, 'clientId invalide');
    const mimeType = String(req.body?.mimeType || '').trim().toLowerCase();
    const ext = ALLOWED_ICON_MIME[mimeType];
    if (!ext) return badRequest(res, 'mimeType non supporté (png / jpeg / webp)');
    const dataBase64 = String(req.body?.dataBase64 || '');
    if (!dataBase64) return badRequest(res, 'dataBase64 requis');

    let buffer;
    try {
      buffer = Buffer.from(dataBase64, 'base64');
    } catch {
      return badRequest(res, 'dataBase64 invalide');
    }
    if (buffer.length === 0) return badRequest(res, 'Fichier vide');
    if (buffer.length > MAX_ICON_SIZE_BYTES) {
      return badRequest(res, `Fichier trop gros (max ${Math.round(MAX_ICON_SIZE_BYTES / 1024)} KB)`);
    }

    // Vérification rapide du magic number pour bloquer un PNG renommé en .jpg etc.
    const isPng = buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
    const isJpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const isWebp = buffer.length >= 12
      && buffer.slice(0, 4).toString('ascii') === 'RIFF'
      && buffer.slice(8, 12).toString('ascii') === 'WEBP';
    if ((ext === 'png' && !isPng) || (ext === 'jpg' && !isJpeg) || (ext === 'webp' && !isWebp)) {
      return badRequest(res, 'Le contenu ne correspond pas au mimeType déclaré');
    }

    const pool = getPool();
    const existing = await fetchAppByClientId(pool, clientId);
    if (!existing) return notFound(res);

    // Ensure dir exists (sécurité : ICON_DIR géré par ensureTables au boot).
    if (!fs.existsSync(oauthClientsDb.ICON_DIR)) {
      fs.mkdirSync(oauthClientsDb.ICON_DIR, { recursive: true, mode: 0o755 });
    }

    const filename = `${clientId}-${Date.now()}.${ext}`;
    const targetPath = path.join(oauthClientsDb.ICON_DIR, filename);
    await fsp.writeFile(targetPath, buffer, { mode: 0o644 });

    // Cleanup ancienne icône avant d'enregistrer la nouvelle.
    const previousFilename = existing.icon_filename;
    await pool.execute(
      'UPDATE oauth_clients SET icon_filename = ?, updated_at = ? WHERE client_id = ?',
      [filename, Date.now(), clientId],
    );
    if (previousFilename && previousFilename !== filename) {
      await removeIconFile(previousFilename);
    }

    await oauthClientsDb.reloadCacheAndBroadcast();
    return res.json({
      success: true,
      iconFilename: filename,
      iconUrl: `/oauth-icons/${filename}`,
    });
  } catch (err) {
    return serverError(res, err, 'Impossible d\'uploader l\'icône');
  }
});

router.delete('/:clientId/icon', async (req, res) => {
  try {
    const clientId = sanitizeClientId(req.params.clientId);
    if (!clientId) return badRequest(res, 'clientId invalide');
    const pool = getPool();
    const existing = await fetchAppByClientId(pool, clientId);
    if (!existing) return notFound(res);
    if (existing.icon_filename) {
      await removeIconFile(existing.icon_filename);
      await pool.execute(
        'UPDATE oauth_clients SET icon_filename = NULL, updated_at = ? WHERE client_id = ?',
        [Date.now(), clientId],
      );
      await oauthClientsDb.reloadCacheAndBroadcast();
    }
    return res.json({ success: true });
  } catch (err) {
    return serverError(res, err, 'Impossible de supprimer l\'icône');
  }
});

// Alimente le compteur de jours VIP que l'app peut distribuer.
// Body : { delta: number }  → positif (ajoute) ou négatif (retire, sans descendre sous 0).
router.post('/:clientId/vip-balance', async (req, res) => {
  try {
    const clientId = sanitizeClientId(req.params.clientId);
    if (!clientId) return badRequest(res, 'clientId invalide');
    const delta = Number(req.body?.delta);
    if (!Number.isInteger(delta) || delta === 0) {
      return badRequest(res, 'delta doit être un entier non nul');
    }
    if (Math.abs(delta) > 100000) {
      return badRequest(res, 'delta trop grand');
    }

    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.execute(
        'SELECT id, vip_days_balance FROM oauth_clients WHERE client_id = ? FOR UPDATE',
        [clientId],
      );
      if (rows.length === 0) {
        await conn.rollback();
        return notFound(res);
      }
      const current = Number(rows[0].vip_days_balance || 0);
      const next = Math.max(0, current + delta); // clamp à 0 pour éviter un balance négatif
      await conn.execute(
        'UPDATE oauth_clients SET vip_days_balance = ?, updated_at = ? WHERE id = ?',
        [next, Date.now(), rows[0].id],
      );
      await conn.commit();
      await oauthClientsDb.reloadCacheAndBroadcast();
      return res.json({
        success: true,
        previousBalance: current,
        newBalance: next,
        deltaApplied: next - current,
      });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    return serverError(res, err, 'Impossible de mettre à jour le balance VIP');
  }
});

router.get('/:clientId/stats', async (req, res) => {
  try {
    const clientId = sanitizeClientId(req.params.clientId);
    if (!clientId) return badRequest(res, 'clientId invalide');
    const sinceDays = Math.min(Math.max(Number(req.query?.sinceDays) || 30, 1), 365);
    const sinceMs = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
    const stats = await oauthClientsDb.getStats(clientId, sinceMs);
    if (!stats) return serverError(res, null, 'DB indisponible');
    return res.json({ success: true, sinceDays, ...stats });
  } catch (err) {
    return serverError(res, err, 'Impossible de récupérer les stats');
  }
});

router.get('/:clientId/grants', async (req, res) => {
  try {
    const clientId = sanitizeClientId(req.params.clientId);
    if (!clientId) return badRequest(res, 'clientId invalide');
    const limit = Math.min(Math.max(Number(req.query?.limit) || 50, 1), 500);
    const pool = getPool();
    const [rows] = await pool.execute(
      `SELECT id, client_id, user_id, user_type, user_id_only, days_granted,
              access_key_value, expires_at, granted_at, revoked_at
         FROM oauth_vip_grants
        WHERE client_id = ?
        ORDER BY granted_at DESC
        LIMIT ?`,
      [clientId, limit],
    );
    const grants = rows.map((row) => ({
      id: Number(row.id),
      clientId: row.client_id,
      userId: row.user_id,
      userType: row.user_type,
      userIdOnly: row.user_id_only,
      daysGranted: Number(row.days_granted),
      // accessKey n'est PAS retournée — c'est un secret porté à l'user.
      // On expose juste les 4 derniers chars pour identifier.
      accessKeyHint: typeof row.access_key_value === 'string' && row.access_key_value.length > 4
        ? `…${row.access_key_value.slice(-4)}`
        : null,
      expiresAt: row.expires_at,
      grantedAt: Number(row.granted_at),
      revokedAt: row.revoked_at ? Number(row.revoked_at) : null,
    }));
    return res.json({ success: true, grants });
  } catch (err) {
    return serverError(res, err, 'Impossible de récupérer les grants');
  }
});

module.exports = router;
