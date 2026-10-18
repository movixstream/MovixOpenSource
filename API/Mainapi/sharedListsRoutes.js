const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const {
  getPool,
  SCHEMA_BOOTSTRAP_LOCK_NAME,
  withMysqlAdvisoryLock
} = require('./mysqlPool');
const { verifyAccessKey } = require('./checkVip');
const { verifyTurnstileFromRequest } = require('./utils/turnstile');
// Réutiliser l'instance Redis partagée au lieu d'en créer une nouvelle (évite les fuites mémoire)
const { redis } = require('./config/redis');

// === JWT_SECRET ===
const JWT_SECRET = process.env.JWT_SECRET;

// === MySQL pool caché ===
let _cachedPool = null;
let ensureSharedListsTablePromise = null;
function getCachedPool() {
  if (!_cachedPool) _cachedPool = getPool();
  return _cachedPool;
}

const SHARED_LIST_CACHE_TTL = 600; // 10 minutes
const USERS_DIR = path.join(__dirname, 'data', 'users');

// === OpenRouter Configuration for content moderation (Claude Haiku 5.5) ===
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = 'anthropic/claude-haiku-5.5';
const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL;

const SHARED_LIST_MODERATION_REASONS = ['INSULTES', 'EROTIQUE', 'PSEUDO_INAPPROPRIE', 'NOM_LISTE_INAPPROPRIE', 'CONTENU_INAPPROPRIE'];

// Schéma imposé à la réponse : flagged reste un vrai booléen, jamais une chaîne.
const SHARED_LIST_MODERATION_SCHEMA = {
  name: 'shared_list_moderation',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      flagged: { type: 'boolean' },
      reason: { anyOf: [{ type: 'string', enum: SHARED_LIST_MODERATION_REASONS }, { type: 'null' }] },
      details: { type: 'string' }
    },
    required: ['flagged', 'reason', 'details'],
    additionalProperties: false
  }
};

// Fonction de modération des listes partagées avec Claude Haiku 5.5 via OpenRouter (exécutée en background)
async function moderateSharedListWithAI(shareId, listName, items, username) {
  try {
    // Construire un résumé des items de la liste
    const itemsSummary = (items || []).slice(0, 30).map(i => `${i.title || i.name || 'Sans titre'} (${i.type || 'inconnu'})`).join(', ');

    const prompt = `Tu es un modérateur de contenu. Analyse le nom de la liste, le pseudo de l'utilisateur, et le contenu de la liste partagée suivants et réponds UNIQUEMENT par un JSON valide.

Pseudo de l'utilisateur: ${JSON.stringify(username)}
Nom de la liste: ${JSON.stringify(listName)}
Contenu de la liste (titres): ${JSON.stringify(itemsSummary)}

Critères de modération (s'appliquent au pseudo, au nom de la liste ET au contenu):
1. INSULTES: Le nom de la liste ou le pseudo contient des insultes, injures, propos haineux ou dégradants
2. EROTIQUE: Le nom de la liste ou le pseudo contient du contenu érotique, sexuel ou inapproprié
3. PSEUDO_INAPPROPRIE: Le pseudo contient des insultes, contenu érotique, ou est inapproprié
4. NOM_LISTE_INAPPROPRIE: Le nom de la liste est vulgaire, offensant ou inapproprié
5. CONTENU_INAPPROPRIE: La liste semble être une compilation de contenu à caractère pornographique ou extrêmement violent

Note: Les films et séries sont des contenus TMDB officiels, donc ils sont généralement acceptables. Ne flagge que si c'est CLAIREMENT inapproprié.

Réponds UNIQUEMENT avec ce format JSON (sans markdown, sans backticks):
{"flagged": true/false, "reason": "INSULTES" ou "EROTIQUE" ou "PSEUDO_INAPPROPRIE" ou "NOM_LISTE_INAPPROPRIE" ou "CONTENU_INAPPROPRIE" ou null, "details": "explication courte"}`;

    const response = await axios.post(
      OPENROUTER_API_URL,
      {
        model: OPENROUTER_MODEL,
        messages: [{ role: 'user', content: prompt }],
        // Le budget inclut le raisonnement. Pas de temperature : Haiku 5.5 la rejette (400).
        max_tokens: 2048,
        reasoning: { effort: 'low' },
        response_format: { type: 'json_schema', json_schema: SHARED_LIST_MODERATION_SCHEMA }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'HTTP-Referer': FRONTEND_BASE_URL,
          'X-Title': 'Movix Shared List Moderation'
        },
        timeout: 30000
      }
    ).catch((requestError) => {
      // OpenRouter filtre lui-même les entrées envoyées aux modèles Anthropic et
      // répond 403 avec les catégories détectées : ce refus vaut décision de modération.
      const blockReasons = requestError?.response?.data?.error?.metadata?.reasons;
      if (requestError?.response?.status !== 403 || !Array.isArray(blockReasons) || !blockReasons.length) throw requestError;
      return { blockReasons };
    });
    const responseText = response.data?.choices?.[0]?.message?.content || '';

    let moderationResult;
    if (response.blockReasons) {
      moderationResult = {
        flagged: true,
        reason: response.blockReasons.some(r => r.startsWith('sexual')) ? 'EROTIQUE' : 'INSULTES',
        details: `Bloqué par le filtre OpenRouter (${response.blockReasons.join(', ')}).`
      };
    } else {
      try {
        const cleanedResponse = responseText.replace(/```json\n?|```\n?/g, '').trim();
        moderationResult = JSON.parse(cleanedResponse);
      } catch (parseError) {
        console.error('❌ Erreur parsing réponse OpenRouter (shared list):', parseError, 'Response:', responseText);
        return { flagged: false };
      }
    }

    // Une réponse ambiguë ou mal formée ne doit pas retirer une liste du catalogue.
    if (
      !moderationResult ||
      typeof moderationResult.flagged !== 'boolean' ||
      (moderationResult.flagged && !SHARED_LIST_MODERATION_REASONS.includes(moderationResult.reason))
    ) {
      console.error('❌ Réponse de modération invalide (shared list, non bloquant):', responseText);
      return { flagged: false };
    }

    if (moderationResult.flagged) {
      console.log(`🚨 Liste partagée flaggée (ID: ${shareId}): ${moderationResult.reason} - ${moderationResult.details}`);

      // Marquer la liste comme modérée (retirer du catalogue)
      await dbRun(
        `UPDATE shared_lists SET is_public_in_catalog = 0, moderation_flagged = 1, moderation_reason = ?, moderation_details = ?, moderated_at = ? WHERE id = ?`,
        [moderationResult.reason, moderationResult.details, Date.now(), shareId]
      );

      // Invalider le cache Redis
      const row = await dbGet('SELECT share_code FROM shared_lists WHERE id = ?', [shareId]);
      if (row) {
        try { await redis.del(`sharedList:${row.share_code}`); } catch { /* ignore */ }
      }

      console.log(`✅ Liste partagée ID ${shareId} retirée du catalogue pour modération`);
    }

    return moderationResult;
  } catch (error) {
    console.error('❌ Erreur modération OpenRouter shared list (non bloquant):', error.message);
    return { flagged: false };
  }
}

// === Helper MySQL (même pattern que commentsRoutes.js) ===
async function ensureSharedListsTable() {
  if (ensureSharedListsTablePromise) {
    return ensureSharedListsTablePromise;
  }

  ensureSharedListsTablePromise = (async () => {
    const pool = getCachedPool();

    await withMysqlAdvisoryLock(pool, SCHEMA_BOOTSTRAP_LOCK_NAME, async () => {
      await pool.execute(`
        CREATE TABLE IF NOT EXISTS shared_lists (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id VARCHAR(255) NOT NULL,
          user_type VARCHAR(50) NOT NULL,
          profile_id VARCHAR(255) NOT NULL,
          list_id VARCHAR(255) NOT NULL,
          share_code VARCHAR(20) NOT NULL,
          is_public_in_catalog TINYINT(1) NOT NULL DEFAULT 0,
          moderation_flagged TINYINT(1) NOT NULL DEFAULT 0,
          moderation_reason VARCHAR(255),
          moderation_details TEXT,
          moderated_at BIGINT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL,
          UNIQUE KEY uq_share_code (share_code),
          UNIQUE KEY uq_user_list (user_id, user_type, profile_id, list_id),
          INDEX idx_shared_lists_share_code (share_code),
          INDEX idx_shared_lists_user_profile (user_id, user_type, profile_id),
          INDEX idx_shared_lists_moderation (moderation_flagged, is_public_in_catalog)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    });

    console.log('✅ Table MySQL shared_lists initialisée');
  })().catch((error) => {
    ensureSharedListsTablePromise = null;
    console.error('❌ Erreur initialisation table MySQL shared_lists:', error.message);
    throw error;
  });

  return ensureSharedListsTablePromise;
}

const dbRun = async (sql, params = []) => {
  await ensureSharedListsTable();
  const pool = getCachedPool();
  const [result] = await pool.execute(sql, params);
  return {
    lastID: result.insertId || 0,
    changes: result.affectedRows || 0
  };
};

const dbGet = async (sql, params = []) => {
  await ensureSharedListsTable();
  const pool = getCachedPool();
  const [rows] = await pool.execute(sql, params);
  return rows.length > 0 ? rows[0] : null;
};

const dbAll = async (sql, params = []) => {
  await ensureSharedListsTable();
  const pool = getCachedPool();
  const [rows] = await pool.execute(sql, params);
  return rows;
};

// === Auth middleware (comme commentsRoutes.js) ===
const requireAuth = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Non authentifié' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    const { sub: userId, userType, sessionId } = decoded;

    if (!['oauth', 'bip39'].includes(userType) || !userId || !sessionId) {
      return res.status(401).json({ error: 'Token invalide' });
    }

    // Vérifier la session en MySQL
    const pool = getCachedPool();
    const [rows] = await pool.execute(
      'SELECT id FROM user_sessions WHERE id = ? AND user_id = ? AND user_type = ?',
      [sessionId, userId, userType]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Session invalide ou expirée' });
    }

    req.user = { userId, userType, sessionId };
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ error: 'Token invalide' });
    }
    // MySQL indisponible (restart, queue limit…) : 503 plutôt que 401,
    // sinon le front déconnecte l'utilisateur.
    console.error('[sharedLists][requireAuth] Vérif session impossible:', error.message);
    return res.status(503).json({ error: 'Service temporairement indisponible' });
  }
};

// === Admin middleware — vérifie que l'utilisateur est admin via la table admins MySQL ===
const requireAdmin = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Non authentifié' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    const { sub: userId, userType, sessionId } = decoded;

    if (!['oauth', 'bip39'].includes(userType) || !userId || !sessionId) {
      return res.status(401).json({ error: 'Token invalide' });
    }

    const pool = getCachedPool();

    // Vérifier la session
    const [sessionRows] = await pool.execute(
      'SELECT id FROM user_sessions WHERE id = ? AND user_id = ? AND user_type = ?',
      [sessionId, userId, userType]
    );
    if (sessionRows.length === 0) {
      return res.status(401).json({ error: 'Session invalide ou expirée' });
    }

    // Vérifier le rôle admin
    const [adminRows] = await pool.execute(
      'SELECT * FROM admins WHERE user_id = ? AND auth_type = ?',
      [userId, userType === 'bip39' ? 'bip-39' : userType]
    );
    if (adminRows.length === 0) {
      return res.status(403).json({ error: 'Accès refusé - Droits admin requis' });
    }

    req.user = { userId, userType, sessionId };
    req.admin = { userId, userType, adminId: adminRows[0].id, role: adminRows[0].role || 'admin' };
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ error: 'Token invalide' });
    }
    // MySQL indisponible (restart, queue limit…) : 503 plutôt que 401,
    // sinon le front déconnecte l'utilisateur.
    console.error('[sharedLists][requireAdmin] Vérif session impossible:', error.message);
    return res.status(503).json({ error: 'Service temporairement indisponible' });
  }
};

// === Helper: vérifier que le profileId appartient bien à l'utilisateur ===
async function verifyProfileOwnership(userId, userType, profileId) {
  try {
    const safeUserId = String(userId).replace(/[^a-zA-Z0-9_\-]/g, '');
    const safeProfileId = String(profileId).replace(/[^a-zA-Z0-9_\-]/g, '');

    let userFilePath;
    if (userType === 'bip39') {
      userFilePath = path.join(USERS_DIR, `bip39-${safeUserId}.json`);
    } else {
      userFilePath = path.join(USERS_DIR, `${safeUserId}.json`);
    }

    const userFile = await fs.readFile(userFilePath, 'utf8');
    const user = JSON.parse(userFile);

    if (user.profiles) {
      return user.profiles.some(p => p.id === profileId);
    }
    return false;
  } catch {
    return false;
  }
}

// === Helper: récupérer les données utilisateur (username, avatar, isVip) depuis le profil ===
async function getUserProfileData(userId, userType, profileId) {
  try {
    const safeUserId = String(userId).replace(/[^a-zA-Z0-9_\-]/g, '');
    const safeProfileId = String(profileId).replace(/[^a-zA-Z0-9_\-]/g, '');
    const safeUserType = ['oauth', 'bip39'].includes(userType) ? userType : 'oauth';

    let userFilePath;
    if (userType === 'bip39') {
      userFilePath = path.join(USERS_DIR, `bip39-${safeUserId}.json`);
    } else {
      userFilePath = path.join(USERS_DIR, `${safeUserId}.json`);
    }

    let username = 'Utilisateur';
    let avatar = '/avatars/disney/disney_avatar_1.png';
    let isVip = false;

    try {
      const userFile = await fs.readFile(userFilePath, 'utf8');
      const user = JSON.parse(userFile);

      if (user.profiles) {
        const profile = user.profiles.find(p => p.id === profileId);
        if (profile) {
          username = profile.name || 'Utilisateur';
          avatar = (profile.avatar && profile.avatar.startsWith('/avatars/')) ? profile.avatar : '/avatars/disney/disney_avatar_1.png';
        }
      }
    } catch { /* fichier utilisateur introuvable */ }

    // Vérifier le statut VIP en lisant l'access_code depuis les données du profil
    try {
      const profileDataPath = path.join(USERS_DIR, 'profiles', safeUserType, safeUserId, `${safeProfileId}.json`);
      const profileData = JSON.parse(await fs.readFile(profileDataPath, 'utf8'));
      const storedAccessCode = profileData.access_code || null;
      if (storedAccessCode) {
        const vipStatus = await verifyAccessKey(storedAccessCode);
        isVip = vipStatus.vip;
      }
    } catch { /* pas de données de profil ou pas d'access_code */ }

    return { username, avatar, isVip };
  } catch {
    return { username: 'Utilisateur', avatar: '/avatars/disney/disney_avatar_1.png', isVip: false };
  }
}

// === Helper: récupérer la custom_lists depuis le fichier profil data ===
async function getProfileCustomLists(userId, userType, profileId) {
  try {
    const safeUserId = String(userId).replace(/[^a-zA-Z0-9_\-]/g, '');
    const safeProfileId = String(profileId).replace(/[^a-zA-Z0-9_\-]/g, '');
    const safeUserType = ['oauth', 'bip39'].includes(userType) ? userType : 'oauth';

    const profileDataPath = path.join(USERS_DIR, 'profiles', safeUserType, safeUserId, `${safeProfileId}.json`);
    const profileData = JSON.parse(await fs.readFile(profileDataPath, 'utf8'));

    const customListsRaw = profileData.custom_lists;
    if (!customListsRaw) return [];

    try {
      return JSON.parse(customListsRaw);
    } catch {
      return [];
    }
  } catch {
    return [];
  }
}

// === Helper: générer un code de partage unique ===
function generateShareCode() {
  return crypto.randomBytes(6).toString('base64url').slice(0, 10);
}

// === Helper: construire le cache de la liste partagée et le mettre dans Redis ===
async function buildAndCacheSharedList(shareCode, userId, userType, profileId, listId, isPublicInCatalog = false) {
  try {
    // Récupérer les données du profil (username, avatar)
    const profileData = await getUserProfileData(userId, userType, profileId);

    // Récupérer les listes personnalisées du profil
    const customLists = await getProfileCustomLists(userId, userType, profileId);

    // Trouver la liste spécifique
    const list = customLists.find(l => String(l.id) === String(listId));
    if (!list) {
      return null;
    }

    const cachedData = {
      shareCode,
      username: profileData.username,
      avatar: profileData.avatar,
      isVip: profileData.isVip,
      listName: list.name,
      items: list.items || [],
      itemCount: (list.items || []).length,
      isPublicInCatalog: !!isPublicInCatalog,
      cachedAt: Date.now()
    };

    // Mettre en cache dans Redis
    try {
      await redis.set(
        `sharedList:${shareCode}`,
        JSON.stringify(cachedData),
        'EX',
        SHARED_LIST_CACHE_TTL
      );
    } catch { /* Redis indisponible */ }

    return cachedData;
  } catch (error) {
    console.error('Erreur buildAndCacheSharedList:', error.message);
    return null;
  }
}


// ========================================
// ROUTES
// ========================================

// POST /share — Partager une liste
router.post('/share', requireAuth, async (req, res) => {
  try {
    const { profileId, listId, publishToCatalog, turnstileToken } = req.body;
    const { userId, userType } = req.user;
    const isPublicInCatalog = !!publishToCatalog;

    // Vérification Turnstile (managed captcha)
    const turnstileResult = await verifyTurnstileFromRequest(req, turnstileToken);
    if (!turnstileResult.valid) return res.status(turnstileResult.status).json({ error: turnstileResult.error });

    if (!profileId || !listId) {
      return res.status(400).json({ error: 'profileId et listId requis' });
    }

    // Vérifier que le profil appartient bien à l'utilisateur
    const isOwner = await verifyProfileOwnership(userId, userType, profileId);
    if (!isOwner) {
      return res.status(403).json({ error: 'Ce profil ne vous appartient pas' });
    }

    // Vérifier que la liste existe dans les données du profil
    const customLists = await getProfileCustomLists(userId, userType, profileId);
    const list = customLists.find(l => String(l.id) === String(listId));
    if (!list) {
      return res.status(404).json({ error: 'Liste non trouvée' });
    }

    // Vérifier si la liste est déjà partagée
    const existing = await dbGet(
      'SELECT share_code FROM shared_lists WHERE user_id = ? AND user_type = ? AND profile_id = ? AND list_id = ?',
      [userId, userType, profileId, String(listId)]
    );

    if (existing) {
      const now = Date.now();
      await dbRun(
        'UPDATE shared_lists SET is_public_in_catalog = ?, updated_at = ? WHERE user_id = ? AND user_type = ? AND profile_id = ? AND list_id = ?',
        [isPublicInCatalog ? 1 : 0, now, userId, userType, profileId, String(listId)]
      );

      // Si on publie au catalogue, reset le flag de modération et lancer modération IA en background
      if (isPublicInCatalog) {
        await dbRun(
          'UPDATE shared_lists SET moderation_flagged = 0, moderation_reason = NULL, moderation_details = NULL, moderated_at = NULL WHERE user_id = ? AND user_type = ? AND profile_id = ? AND list_id = ?',
          [userId, userType, profileId, String(listId)]
        );
        const existingRecord = await dbGet(
          'SELECT id FROM shared_lists WHERE user_id = ? AND user_type = ? AND profile_id = ? AND list_id = ?',
          [userId, userType, profileId, String(listId)]
        );
        const profileData = await getUserProfileData(userId, userType, profileId);
        moderateSharedListWithAI(existingRecord.id, list.name, list.items || [], profileData.username)
          .catch(err => console.error('Erreur modération IA liste (non bloquant):', err));
      }

      // Rafraîchir le cache et retourner le code existant
      await buildAndCacheSharedList(existing.share_code, userId, userType, profileId, listId, isPublicInCatalog);
      return res.json({ shareCode: existing.share_code, alreadyShared: true, isPublicInCatalog });
    }

    // Générer un code de partage unique
    let shareCode;
    let attempts = 0;
    do {
      shareCode = generateShareCode();
      const dup = await dbGet('SELECT id FROM shared_lists WHERE share_code = ?', [shareCode]);
      if (!dup) break;
      attempts++;
    } while (attempts < 10);

    if (attempts >= 10) {
      return res.status(500).json({ error: 'Impossible de générer un code unique' });
    }

    const now = Date.now();

    // Insérer dans MySQL (seulement la référence, pas les données)
    await dbRun(
      'INSERT INTO shared_lists (user_id, user_type, profile_id, list_id, share_code, is_public_in_catalog, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [userId, userType, profileId, String(listId), shareCode, isPublicInCatalog ? 1 : 0, now, now]
    );

    // Construire et mettre en cache la liste
    await buildAndCacheSharedList(shareCode, userId, userType, profileId, listId, isPublicInCatalog);

    // Si publié au catalogue, lancer modération IA en background
    if (isPublicInCatalog) {
      const insertedRecord = await dbGet(
        'SELECT id FROM shared_lists WHERE share_code = ?',
        [shareCode]
      );
      const profileData = await getUserProfileData(userId, userType, profileId);
      moderateSharedListWithAI(insertedRecord.id, list.name, list.items || [], profileData.username)
        .catch(err => console.error('Erreur modération IA liste (non bloquant):', err));
    }

    res.json({ shareCode, isPublicInCatalog });
  } catch (error) {
    console.error('Erreur POST /share:', error.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /share — Retirer le partage d'une liste
router.delete('/share', requireAuth, async (req, res) => {
  try {
    const { profileId, listId } = req.body;
    const { userId, userType } = req.user;

    if (!profileId || !listId) {
      return res.status(400).json({ error: 'profileId et listId requis' });
    }

    // Vérifier que le profil appartient bien à l'utilisateur
    const isOwner = await verifyProfileOwnership(userId, userType, profileId);
    if (!isOwner) {
      return res.status(403).json({ error: 'Ce profil ne vous appartient pas' });
    }

    // Récupérer le share_code pour invalider le cache
    const existing = await dbGet(
      'SELECT share_code FROM shared_lists WHERE user_id = ? AND user_type = ? AND profile_id = ? AND list_id = ?',
      [userId, userType, profileId, String(listId)]
    );

    if (!existing) {
      return res.status(404).json({ error: 'Partage non trouvé' });
    }

    // Supprimer de MySQL
    await dbRun(
      'DELETE FROM shared_lists WHERE user_id = ? AND user_type = ? AND profile_id = ? AND list_id = ?',
      [userId, userType, profileId, String(listId)]
    );

    // Invalider le cache Redis
    try {
      await redis.del(`sharedList:${existing.share_code}`);
    } catch { /* Redis indisponible */ }

    res.json({ success: true });
  } catch (error) {
    console.error('Erreur DELETE /share:', error.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /share/status — Obtenir le status de partage pour les listes d'un profil
router.get('/share/status', requireAuth, async (req, res) => {
  try {
    const { profileId } = req.query;
    const { userId, userType } = req.user;

    if (!profileId) {
      return res.status(400).json({ error: 'profileId requis' });
    }

    const shared = await dbAll(
      'SELECT list_id, share_code, created_at, is_public_in_catalog FROM shared_lists WHERE user_id = ? AND user_type = ? AND profile_id = ?',
      [userId, userType, profileId]
    );

    // Retourner un objet { listId: shareCode }
    const statusMap = {};
    for (const row of shared) {
      statusMap[row.list_id] = {
        shareCode: row.share_code,
        sharedAt: row.created_at,
        isPublicInCatalog: !!row.is_public_in_catalog
      };
    }

    res.json({ shared: statusMap });
  } catch (error) {
    console.error('Erreur GET /share/status:', error.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /list/:shareCode — Récupérer une liste partagée (route publique, pas besoin d'auth)
router.get('/list/:shareCode', async (req, res) => {
  try {
    const { shareCode } = req.params;

    if (!shareCode || shareCode.length > 20) {
      return res.status(400).json({ error: 'Code de partage invalide' });
    }

    // Vérifier le cache Redis d'abord
    try {
      const cached = await redis.get(`sharedList:${shareCode}`);
      if (cached) {
        return res.json(JSON.parse(cached));
      }
    } catch { /* Redis indisponible, on continue */ }

    // Pas de cache : chercher dans MySQL
    const shareRecord = await dbGet(
      'SELECT user_id, user_type, profile_id, list_id, is_public_in_catalog FROM shared_lists WHERE share_code = ?',
      [shareCode]
    );

    if (!shareRecord) {
      return res.status(404).json({ error: 'Liste partagée non trouvée ou expirée' });
    }

    // Reconstruire et mettre en cache
    const data = await buildAndCacheSharedList(
      shareCode,
      shareRecord.user_id,
      shareRecord.user_type,
      shareRecord.profile_id,
      shareRecord.list_id,
      !!shareRecord.is_public_in_catalog
    );

    if (!data) {
      return res.status(404).json({ error: 'Liste non trouvée dans les données du profil' });
    }

    res.json(data);
  } catch (error) {
    console.error('Erreur GET /list/:shareCode:', error.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /catalog — Récupérer les listes publiques du catalogue (route publique)
router.get('/catalog', async (req, res) => {
  try {
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, limitRaw)) : 50;

    const rows = await dbAll(
      'SELECT share_code, user_id, user_type, profile_id, list_id, created_at, updated_at, is_public_in_catalog FROM shared_lists WHERE is_public_in_catalog = 1 AND moderation_flagged = 0 ORDER BY updated_at DESC LIMIT ?',
      [limit]
    );

    const likeStatsByShareCode = new Map();
    if (rows.length > 0) {
      const shareCodes = rows.map((row) => row.share_code);
      const placeholders = shareCodes.map(() => '?').join(', ');
      const likeRows = await dbAll(
        `SELECT content_id,
                SUM(CASE WHEN vote_type = 'like' THEN 1 ELSE 0 END) AS likes_count,
                SUM(CASE WHEN vote_type = 'dislike' THEN 1 ELSE 0 END) AS dislikes_count
           FROM likes
          WHERE content_type = 'shared-list'
            AND content_id IN (${placeholders})
          GROUP BY content_id`,
        shareCodes
      );

      likeRows.forEach((row) => {
        likeStatsByShareCode.set(String(row.content_id), {
          likesCount: Number(row.likes_count) || 0,
          dislikesCount: Number(row.dislikes_count) || 0,
        });
      });
    }

    const lists = (await Promise.all(
      rows.map(async (row) => {
        const data = await buildAndCacheSharedList(
          row.share_code,
          row.user_id,
          row.user_type,
          row.profile_id,
          row.list_id,
          true
        );

        if (!data) return null;

        const likeStats = likeStatsByShareCode.get(String(row.share_code)) || {
          likesCount: 0,
          dislikesCount: 0
        };

        return {
          ...data,
          sharedAt: row.created_at,
          updatedAt: row.updated_at,
          likesCount: likeStats.likesCount,
          dislikesCount: likeStats.dislikesCount
        };
      })
    )).filter(Boolean);

    res.json({ lists, total: lists.length });
  } catch (error) {
    console.error('Erreur GET /catalog:', error.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});


// ========================================
// ADMIN ROUTES
// ========================================

// GET /admin/public — Lister toutes les listes publiques du catalogue (admin uniquement)
router.get('/admin/public', requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 50, search = '' } = req.query;
    const safePage = Math.max(1, parseInt(page) || 1);
    const safeLimit = Math.max(1, Math.min(parseInt(limit) || 50, 100));
    const offset = (safePage - 1) * safeLimit;

    const rows = await dbAll(
      'SELECT * FROM shared_lists WHERE is_public_in_catalog = 1 AND moderation_flagged = 0 ORDER BY updated_at DESC LIMIT ? OFFSET ?',
      [safeLimit, offset]
    );

    const totalResult = await dbGet(
      'SELECT COUNT(*) as total FROM shared_lists WHERE is_public_in_catalog = 1 AND moderation_flagged = 0'
    );

    // Enrichir avec les données utilisateur et la liste
    const enrichedLists = await Promise.all(rows.map(async (row) => {
      const data = await buildAndCacheSharedList(
        row.share_code, row.user_id, row.user_type, row.profile_id, row.list_id, true
      );
      return {
        id: row.id,
        shareCode: row.share_code,
        userId: row.user_id,
        userType: row.user_type,
        profileId: row.profile_id,
        listId: row.list_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        username: data?.username || 'Inconnu',
        avatar: data?.avatar || null,
        isVip: data?.isVip || false,
        listName: data?.listName || 'Sans nom',
        itemCount: data?.itemCount || 0,
        items: (data?.items || []).slice(0, 6) // max 6 items pour l'aperçu admin
      };
    }));

    // Stats globales
    const statsResult = await dbGet(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN is_public_in_catalog = 1 AND moderation_flagged = 0 THEN 1 ELSE 0 END) as public_count,
        SUM(CASE WHEN moderation_flagged = 1 THEN 1 ELSE 0 END) as moderated_count
      FROM shared_lists
    `);

    res.json({
      lists: enrichedLists,
      total: totalResult.total,
      stats: {
        total: statsResult.total,
        publicCount: statsResult.public_count,
        moderatedCount: statsResult.moderated_count
      },
      page: safePage,
      limit: safeLimit,
      hasMore: offset + enrichedLists.length < totalResult.total
    });
  } catch (error) {
    console.error('Erreur GET /admin/public:', error.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /admin/public/:id — Supprimer une liste publique (admin uniquement)
router.delete('/admin/public/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Récupérer le share_code pour invalider le cache
    const row = await dbGet('SELECT share_code FROM shared_lists WHERE id = ?', [id]);
    if (!row) {
      return res.status(404).json({ error: 'Liste non trouvée' });
    }

    // Supprimer de MySQL
    await dbRun('DELETE FROM shared_lists WHERE id = ?', [id]);

    // Invalider le cache Redis
    try { await redis.del(`sharedList:${row.share_code}`); } catch { /* ignore */ }

    console.log(`🗑️ Liste partagée ID ${id} supprimée par admin`);
    res.json({ success: true, message: 'Liste supprimée' });
  } catch (error) {
    console.error('Erreur DELETE /admin/public/:id:', error.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /admin/moderated — Lister les listes flaggées par l'IA (admin uniquement)
router.get('/admin/moderated', requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const safePage = Math.max(1, parseInt(page) || 1);
    const safeLimit = Math.max(1, Math.min(parseInt(limit) || 50, 100));
    const offset = (safePage - 1) * safeLimit;

    const rows = await dbAll(
      'SELECT * FROM shared_lists WHERE moderation_flagged = 1 ORDER BY moderated_at DESC LIMIT ? OFFSET ?',
      [safeLimit, offset]
    );

    const totalResult = await dbGet(
      'SELECT COUNT(*) as total FROM shared_lists WHERE moderation_flagged = 1'
    );

    // Enrichir avec les données utilisateur et la liste
    const enrichedLists = await Promise.all(rows.map(async (row) => {
      const profileData = await getUserProfileData(row.user_id, row.user_type, row.profile_id);
      const customLists = await getProfileCustomLists(row.user_id, row.user_type, row.profile_id);
      const list = customLists.find(l => String(l.id) === String(row.list_id));

      return {
        id: row.id,
        shareCode: row.share_code,
        userId: row.user_id,
        userType: row.user_type,
        profileId: row.profile_id,
        listId: row.list_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        moderatedAt: row.moderated_at,
        moderationReason: row.moderation_reason,
        moderationDetails: row.moderation_details,
        username: profileData.username,
        avatar: profileData.avatar,
        isVip: profileData.isVip,
        listName: list?.name || 'Liste supprimée',
        itemCount: list?.items?.length || 0,
        items: (list?.items || []).slice(0, 6)
      };
    }));

    res.json({
      lists: enrichedLists,
      total: totalResult.total,
      page: safePage,
      limit: safeLimit,
      hasMore: offset + enrichedLists.length < totalResult.total
    });
  } catch (error) {
    console.error('Erreur GET /admin/moderated:', error.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /admin/moderated/:id/approve — Approuver une liste modérée (remettre dans le catalogue)
router.put('/admin/moderated/:id/approve', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const row = await dbGet('SELECT share_code FROM shared_lists WHERE id = ? AND moderation_flagged = 1', [id]);
    if (!row) {
      return res.status(404).json({ error: 'Liste modérée non trouvée' });
    }

    // Remettre dans le catalogue et enlever le flag de modération
    await dbRun(
      'UPDATE shared_lists SET is_public_in_catalog = 1, moderation_flagged = 0 WHERE id = ?',
      [id]
    );

    // Invalider le cache Redis pour forcer un rafraîchissement
    try { await redis.del(`sharedList:${row.share_code}`); } catch { /* ignore */ }

    console.log(`✅ Liste partagée ID ${id} approuvée par admin (remise au catalogue)`);
    res.json({ success: true, message: 'Liste approuvée et remise au catalogue' });
  } catch (error) {
    console.error('Erreur PUT /admin/moderated/:id/approve:', error.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /admin/moderated/:id — Supprimer définitivement une liste modérée
router.delete('/admin/moderated/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const row = await dbGet('SELECT share_code FROM shared_lists WHERE id = ?', [id]);
    if (!row) {
      return res.status(404).json({ error: 'Liste non trouvée' });
    }

    await dbRun('DELETE FROM shared_lists WHERE id = ?', [id]);

    try { await redis.del(`sharedList:${row.share_code}`); } catch { /* ignore */ }

    console.log(`🗑️ Liste modérée ID ${id} supprimée définitivement par admin`);
    res.json({ success: true, message: 'Liste supprimée définitivement' });
  } catch (error) {
    console.error('Erreur DELETE /admin/moderated/:id:', error.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.initSharedListsTable = ensureSharedListsTable;

module.exports = router;
