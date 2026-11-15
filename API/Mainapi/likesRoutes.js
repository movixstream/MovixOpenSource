const express = require('express');
const router = express.Router();
const { getPool } = require('./mysqlPool');
const fs = require('fs').promises;
const path = require('path');
const { verifyTurnstileFromRequest } = require('./utils/turnstile');

const TURNSTILE_INVISIBLE_SECRETKEY = process.env.TURNSTILE_INVISIBLE_SECRETKEY;

// Helper to get user data (duplicated from commentsRoutes.js to avoid dependency issues)
async function getProfileIds(userId, userType) {
  try {
    // Sanitize userId to prevent path traversal
    const safeUserId = String(userId).replace(/[^a-zA-Z0-9_\-]/g, '');
    let userFilePath;
    if (userType === 'bip39') {
      userFilePath = path.join(__dirname, 'data', 'users', `bip39-${safeUserId}.json`);
    } else {
      userFilePath = path.join(__dirname, 'data', 'users', `${safeUserId}.json`);
    }

    try {
      const userFile = await fs.readFile(userFilePath, 'utf8');
      const user = JSON.parse(userFile);

      const profileIds = [];
      if (user.profiles) {
        user.profiles.forEach(p => profileIds.push(p.id));
      } else {
        // Fallback for old structure or default profile
        // Often default profile ID is same as user ID or specific generated one
        // We'll try to find it in the data structure
      }
      return profileIds;
    } catch (err) {
      if (err.code !== 'ENOENT') console.error('Error reading user file:', err);
      return [];
    }
  } catch (error) {
    console.error('Error getting profile IDs:', error);
    return [];
  }
}


// Fonctions helper MySQL pour remplacer SQLite
const dbRun = async (sql, params = []) => {
  const pool = getPool();
  const [result] = await pool.execute(sql, params);
  return {
    lastID: result.insertId || 0,
    changes: result.affectedRows || 0
  };
};

const dbGet = async (sql, params = []) => {
  const pool = getPool();
  const [rows] = await pool.execute(sql, params);
  return rows.length > 0 ? rows[0] : null;
};

const dbAll = async (sql, params = []) => {
  const pool = getPool();
  const [rows] = await pool.execute(sql, params);
  return rows;
};

// Middleware pour vérifier l'authentification (optionnel pour GET) avec validation session MySQL
const optionalAuth = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    req.user = null;
    return next();
  }

  const jwt = require('jsonwebtoken');
  const JWT_SECRET = process.env.JWT_SECRET;
  if (!JWT_SECRET) {
    req.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    const { sub: userId, userType, sessionId } = decoded;

    if (!['oauth', 'bip39'].includes(userType) || !userId || !sessionId) {
      req.user = null;
      return next();
    }

    // Vérifier que la session existe en MySQL
    const pool = getPool();
    const [rows] = await pool.execute(
      'SELECT id FROM user_sessions WHERE id = ? AND user_id = ? AND user_type = ?',
      [sessionId, userId, userType]
    );

    if (rows.length === 0) {
      req.user = null;
      return next();
    }

    req.user = {
      userId: userId,
      userType: userType,
      sessionId: sessionId
    };
    next();
  } catch (error) {
    req.user = null;
    next();
  }
};

// Middleware pour vérifier l'authentification (requis pour POST) avec validation session MySQL
const requireAuth = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Non authentifié' });
  }

  const jwt = require('jsonwebtoken');
  const JWT_SECRET = process.env.JWT_SECRET;
  if (!JWT_SECRET) return res.status(500).json({ error: 'Server misconfiguration' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    const { sub: userId, userType, sessionId } = decoded;

    if (!['oauth', 'bip39'].includes(userType) || !userId || !sessionId) {
      return res.status(401).json({ error: 'Token invalide' });
    }

    // Vérifier que la session existe en MySQL
    const pool = getPool();
    const [rows] = await pool.execute(
      'SELECT id FROM user_sessions WHERE id = ? AND user_id = ? AND user_type = ?',
      [sessionId, userId, userType]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Session invalide ou expirée' });
    }

    req.user = {
      userId: userId,
      userType: userType,
      sessionId: sessionId
    };
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ error: 'Token invalide' });
    }
    // MySQL indisponible (restart, queue limit…) : 503 plutôt que 401,
    // sinon le front déconnecte l'utilisateur.
    console.error('[likes][requireAuth] Vérif session impossible:', error.message);
    return res.status(503).json({ error: 'Service temporairement indisponible' });
  }
};

// GET /api/likes/:contentType/:contentId - Récupérer les statistiques de likes pour un contenu
router.get('/:contentType/:contentId', optionalAuth, async (req, res) => {
  try {
    const { contentType, contentId } = req.params;
    const profileId = req.query.profileId;

    // Compter les likes
    const likesCount = await dbGet(
      `SELECT COUNT(*) as count FROM likes
       WHERE content_type = ? AND content_id = ? AND vote_type = 'like'`,
      [contentType, contentId]
    );

    // Compter les dislikes
    const dislikesCount = await dbGet(
      `SELECT COUNT(*) as count FROM likes
       WHERE content_type = ? AND content_id = ? AND vote_type = 'dislike'`,
      [contentType, contentId]
    );

    const response = {
      likes: likesCount?.count || 0,
      dislikes: dislikesCount?.count || 0,
      userVote: null
    };

    // Si l'utilisateur est authentifié, vérifier s'il a voté (par userId, pas profileId)
    if (req.user) {
      const userVote = await dbGet(
        `SELECT vote_type FROM likes
         WHERE content_type = ? AND content_id = ?
         AND user_id = ? AND user_type = ?`,
        [contentType, contentId, req.user.userId, req.user.userType]
      );

      if (userVote) {
        response.userVote = userVote.vote_type;
      }
    }

    res.json(response);
  } catch (error) {
    console.error('Erreur lors de la récupération des likes:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/likes - Ajouter/modifier/supprimer un vote
router.post('/', requireAuth, async (req, res) => {
  try {
    const { contentType, contentId, voteType, profileId, turnstileToken } = req.body;

    // Verification Turnstile (invisible captcha)
    if (TURNSTILE_INVISIBLE_SECRETKEY) {
      const check = await verifyTurnstileFromRequest(req, turnstileToken, 'invisible');
      if (!check.valid) {
        return res.status(check.status).json({ error: check.error });
      }
    }

    // Validation
    if (!contentType || !contentId) {
      return res.status(400).json({ error: 'Données manquantes' });
    }

    // Whitelist contentType to prevent data pollution
    const allowedContentTypes = ['movie', 'tv', 'anime', 'live-tv', 'comment', 'reply', 'shared-list'];
    if (!allowedContentTypes.includes(contentType)) {
      return res.status(400).json({ error: 'Type de contenu invalide' });
    }

    if (voteType && !['like', 'dislike'].includes(voteType)) {
      return res.status(400).json({ error: 'Type de vote invalide' });
    }

    const userId = req.user.userId;
    const userType = req.user.userType;

    // Vérifier si l'utilisateur a déjà voté (par userId, pas profileId)
    const existingVote = await dbGet(
      `SELECT * FROM likes
       WHERE content_type = ? AND content_id = ?
       AND user_id = ? AND user_type = ?`,
      [contentType, contentId, userId, userType]
    );

    if (!voteType) {
      // Supprimer le vote si voteType est null ou undefined
      if (existingVote) {
        await dbRun(
          `DELETE FROM likes
           WHERE content_type = ? AND content_id = ?
           AND user_id = ? AND user_type = ?`,
          [contentType, contentId, userId, userType]
        );
      }
    } else if (existingVote) {
      // Si le vote est le même, on le supprime (toggle)
      if (existingVote.vote_type === voteType) {
        await dbRun(
          `DELETE FROM likes
           WHERE content_type = ? AND content_id = ?
           AND user_id = ? AND user_type = ?`,
          [contentType, contentId, userId, userType]
        );
      } else {
        // Sinon, on met à jour le vote
        await dbRun(
          `UPDATE likes
           SET vote_type = ?, updated_at = ?
           WHERE content_type = ? AND content_id = ?
           AND user_id = ? AND user_type = ?`,
          [voteType, Date.now(), contentType, contentId, userId, userType]
        );
      }
    } else {
      // Créer un nouveau vote
      await dbRun(
        `INSERT INTO likes (content_type, content_id, user_id, user_type, profile_id, vote_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [contentType, contentId, userId, userType, profileId || null, voteType, Date.now()]
      );
    }

    // Récupérer les nouvelles statistiques
    const likesCount = await dbGet(
      `SELECT COUNT(*) as count FROM likes
       WHERE content_type = ? AND content_id = ? AND vote_type = 'like'`,
      [contentType, contentId]
    );

    const dislikesCount = await dbGet(
      `SELECT COUNT(*) as count FROM likes
       WHERE content_type = ? AND content_id = ? AND vote_type = 'dislike'`,
      [contentType, contentId]
    );

    // Vérifier le vote actuel de l'utilisateur
    const currentVote = await dbGet(
      `SELECT vote_type FROM likes
       WHERE content_type = ? AND content_id = ?
       AND user_id = ? AND user_type = ?`,
      [contentType, contentId, userId, userType]
    );

    res.json({
      success: true,
      likes: likesCount?.count || 0,
      dislikes: dislikesCount?.count || 0,
      userVote: currentVote?.vote_type || null
    });
  } catch (error) {
    console.error('Erreur lors du vote:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;