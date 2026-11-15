/**
 * Wishboard / Greenlight API Routes
 * Content request management system
 * 
 * Uses MySQL database (same as the rest of the app)
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const fs = require('fs').promises;
const path = require('path');
const { verifyAccessKey } = require('./checkVip');
const { searchTmdb } = require('./utils/tmdbCache');
const { verifyTurnstileFromRequest } = require('./utils/turnstile');
const { resolveAdminIdentity } = require('./utils/adminIdentity');

const TURNSTILE_INVISIBLE_SECRETKEY = process.env.TURNSTILE_INVISIBLE_SECRETKEY;
const TMDB_API_URL = 'https://api.themoviedb.org/3';
// JWT Secret (same as commentsRoutes and server.js)
const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Search TMDB by name and return matching TMDB IDs.
 * Utilise searchTmdb centralisé (cache Redis partagé).
 */
async function searchTmdbIds(query) {
    try {
        const [movieData, tvData] = await Promise.all([
            searchTmdb(TMDB_API_URL, process.env.TMDB_API_KEY, 'movie', query, { page: 1 }).catch(() => null),
            searchTmdb(TMDB_API_URL, process.env.TMDB_API_KEY, 'tv', query, { page: 1 }).catch(() => null)
        ]);

        const movieIds = (movieData?.results || []).map(r => r.id);
        const tvIds = (tvData?.results || []).map(r => r.id);
        return [...new Set([...movieIds, ...tvIds])];
    } catch (error) {
        console.error('TMDB search error:', error.message);
        return [];
    }
}

function createWishboardRouter(mysqlPool, redis) {
    const router = express.Router();

    // Middleware to verify JWT token with MySQL session validation
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

            // Vérifier que la session existe en MySQL
            if (!mysqlPool) {
                return res.status(503).json({ error: 'Service temporairement indisponible' });
            }

            const [rows] = await mysqlPool.execute(
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
            console.error('[wishboard][requireAuth] Vérif session impossible:', error.message);
            return res.status(503).json({ error: 'Service temporairement indisponible' });
        }
    };

    // Middleware to check admin or uploader status (same pattern as server.js isUploaderOrAdmin)
    const requireUploaderOrAdmin = async (req, res, next) => {
        try {
            if (!mysqlPool) {
                return res.status(503).json({ error: 'Service temporairement indisponible' });
            }

            const authType = req.user.userType === 'bip39' ? 'bip-39' : req.user.userType;
            const [rows] = await mysqlPool.execute(
                'SELECT * FROM admins WHERE user_id = ? AND auth_type = ?',
                [req.user.userId, authType]
            );

            if (rows.length === 0) {
                return res.status(403).json({ error: 'Accès refusé - Droits requis' });
            }

            // Récupérer le rôle (par défaut 'admin' si non défini)
            const role = rows[0].role || 'admin';

            // Autoriser les rôles 'admin' et 'uploader'
            if (role !== 'admin' && role !== 'uploader') {
                return res.status(403).json({ error: 'Accès refusé - Droits insuffisants' });
            }

            req.admin = { userId: req.user.userId, userType: req.user.userType, role };
            next();
        } catch (error) {
            console.error('Admin/Uploader check error:', error);
            return res.status(500).json({ error: 'Erreur lors de la vérification des droits' });
        }
    };

    // Helper to get user data from JSON files (adapted from commentsRoutes.js)
    async function getUserData(userId, userType, profileId = null) {
        try {
            let userData = { username: 'Utilisateur', avatar: null, isVip: false, isAdmin: false };
            const safeUserId = String(userId).replace(/[^a-zA-Z0-9_\-]/g, '');
            const safeUserType = ['oauth', 'bip39'].includes(userType) ? userType : 'oauth';

            let userFilePath;
            if (userType === 'bip39') {
                userFilePath = path.join(__dirname, 'data', 'users', `bip39-${safeUserId}.json`);
            } else {
                userFilePath = path.join(__dirname, 'data', 'users', `${safeUserId}.json`);
            }

            try {
                const userFile = await fs.readFile(userFilePath, 'utf8');
                const user = JSON.parse(userFile);

                if (user.profiles && user.profiles.length > 0) {
                    let profile;
                    if (profileId) {
                        profile = user.profiles.find(p => p.id === profileId);
                    }
                    if (!profile) {
                        profile = user.profiles[0];
                    }
                    if (profile) {
                        userData.username = profile.name || 'Utilisateur';
                        userData.avatar = profile.avatar;
                    }
                }
            } catch (err) {
                console.error('Error reading user file:', err.message);
            }

            // Vérifier le statut VIP en lisant l'access_code depuis les données du profil
            if (profileId && safeUserId) {
                try {
                    const safeProfileId = String(profileId).replace(/[^a-zA-Z0-9_\-]/g, '');
                    const profileDataPath = path.join(__dirname, 'data', 'users', 'profiles', safeUserType, safeUserId, `${safeProfileId}.json`);
                    const profileData = JSON.parse(await fs.readFile(profileDataPath, 'utf8'));
                    const storedAccessCode = profileData.access_code || null;
                    if (storedAccessCode) {
                        const vipStatus = await verifyAccessKey(storedAccessCode);
                        userData.isVip = vipStatus.vip;
                    }
                } catch (err) {
                    // Pas de données de profil ou pas d'access_code — isVip reste false
                }
            }

            return userData;
        } catch (error) {
            console.error('Error getUserData:', error);
            return { isVip: false };
        }
    }

    // Check request limit helper
    const checkLimit = async (userId, userType, profileId, req) => {
        // Enforce limits: 1 per 48h for Free, 3 per 48h for VIP

        const [recentRequests] = await mysqlPool.execute(
            `SELECT COUNT(*) as count FROM wishboard_requests 
             WHERE profile_id = ? 
             AND created_at >= DATE_SUB(NOW(), INTERVAL 48 HOUR)`,
            [profileId]
        );

        const count = recentRequests[0].count;

        // Vérifier le statut VIP en lisant l'access_code depuis les données du profil
        let isVip = false;
        if (profileId && userId) {
            try {
                const safeUserId = String(userId).replace(/[^a-zA-Z0-9_\-]/g, '');
                const safeUserType = ['oauth', 'bip39'].includes(userType) ? userType : 'oauth';
                const safeProfileId = String(profileId).replace(/[^a-zA-Z0-9_\-]/g, '');
                const profileDataPath = path.join(__dirname, 'data', 'users', 'profiles', safeUserType, safeUserId, `${safeProfileId}.json`);
                const profileData = JSON.parse(await fs.readFile(profileDataPath, 'utf8'));
                const storedAccessCode = profileData.access_code || null;
                if (storedAccessCode) {
                    const vipStatus = await verifyAccessKey(storedAccessCode);
                    isVip = vipStatus.vip;
                }
            } catch (err) {
                // Pas de données de profil — isVip reste false
            }
        }

        const limit = isVip ? 3 : 1;
        const remaining = Math.max(0, limit - count);

        return { count, limit, remaining, isVip };
    };

    // Get profile ID from headers or body
    const getProfileId = (req) => {
        return req.headers['x-profile-id'] || req.body?.profileId || req.query?.profileId || null;
    };

    // Verify that the profileId belongs to the authenticated user
    async function verifyProfileOwnership(userId, userType, profileId) {
        try {
            const safeUserId = String(userId).replace(/[^a-zA-Z0-9_\-]/g, '');
            let userFilePath;
            if (userType === 'bip39') {
                userFilePath = path.join(__dirname, 'data', 'users', `bip39-${safeUserId}.json`);
            } else {
                userFilePath = path.join(__dirname, 'data', 'users', `${safeUserId}.json`);
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

    // Helper to record status change in history
    const recordStatusHistory = async (requestId, status, reason = null, adminId = null, adminAuthType = null) => {
        try {
            const [result] = await mysqlPool.execute(
                'INSERT INTO wishboard_status_history (request_id, status, reason, admin_id, admin_auth_type) VALUES (?, ?, ?, ?, ?)',
                [requestId, status, reason, adminId, adminAuthType]
            );
            return result.insertId;
        } catch (error) {
            console.error('Error recording status history:', error);
            return null;
        }
    };

    // =====================================
    // PUBLIC ENDPOINTS
    // =====================================

    /**
     * GET /api/wishboard
     * List all requests with filters and pagination
     */
    router.get('/', async (req, res) => {
        try {
            const { page = 1, limit = 20, search, media_type, status, sort = 'votes_desc' } = req.query;
            const offset = (parseInt(page) - 1) * parseInt(limit);
            const profileId = getProfileId(req);

            let whereConditions = ['1=1'];
            let whereParams = [];

            if (search) {
                const isNumericSearch = /^\d+$/.test(search.trim());
                if (isNumericSearch) {
                    // Direct TMDB ID search
                    whereConditions.push('tmdb_id = ?');
                    whereParams.push(parseInt(search));
                } else {
                    // Text search: query TMDB API to find matching IDs
                    const tmdbIds = await searchTmdbIds(search.trim());
                    if (tmdbIds.length > 0) {
                        whereConditions.push(`tmdb_id IN (${tmdbIds.map(() => '?').join(',')})`);
                        whereParams.push(...tmdbIds);
                    } else {
                        // No TMDB results found, return empty
                        return res.json({ requests: [], has_more: false, stats: { total: 0, pending: 0, added_this_month: 0, movies: 0, tv: 0 } });
                    }
                }
            }

            if (media_type && media_type !== 'all') {
                whereConditions.push('media_type = ?');
                whereParams.push(media_type);
            }

            if (status && status !== 'all') {
                whereConditions.push('status = ?');
                whereParams.push(status);
            }

            const whereClause = whereConditions.join(' AND ');

            // Determine sort order
            let orderBy = 'vote_count DESC';
            switch (sort) {
                case 'votes_asc':
                    orderBy = 'vote_count ASC';
                    break;
                case 'date_desc':
                    orderBy = 'created_at DESC';
                    break;
                case 'date_asc':
                    orderBy = 'created_at ASC';
                    break;
                default:
                    orderBy = 'vote_count DESC';
            }

            // Get requests
            const [requests] = await mysqlPool.execute(
                `SELECT * FROM wishboard_requests WHERE ${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
                [...whereParams, parseInt(limit), offset]
            );

            // Check vote status and get public notes for each request
            const requestsWithVotes = await Promise.all(requests.map(async (r) => {
                let hasVoted = false;
                if (profileId) {
                    const [voteRows] = await mysqlPool.execute(
                        'SELECT id FROM wishboard_votes WHERE request_id = ? AND profile_id = ?',
                        [r.id, profileId]
                    );
                    hasVoted = voteRows.length > 0;
                }

                // Get public notes
                const [notes] = await mysqlPool.execute(
                    'SELECT id, note, is_public, created_at FROM wishboard_notes WHERE request_id = ? AND is_public = 1 ORDER BY created_at DESC',
                    [r.id]
                );

                // Get status history
                const [statusHistory] = await mysqlPool.execute(
                    'SELECT status, reason, changed_at FROM wishboard_status_history WHERE request_id = ? ORDER BY changed_at ASC',
                    [r.id]
                );

                return { ...r, has_voted: hasVoted, notes, statusHistory };
            }));

            // Get total count
            const [countResult] = await mysqlPool.execute(
                `SELECT COUNT(*) as total FROM wishboard_requests WHERE ${whereClause}`,
                whereParams
            );

            // Get stats
            const [statsResult] = await mysqlPool.execute(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN status = 'added' AND updated_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) as added_this_month,
          SUM(CASE WHEN media_type = 'movie' THEN 1 ELSE 0 END) as movies,
          SUM(CASE WHEN media_type = 'tv' THEN 1 ELSE 0 END) as tv
        FROM wishboard_requests
      `);

            res.json({
                requests: requestsWithVotes,
                has_more: countResult[0].total > offset + requests.length,
                stats: {
                    total: statsResult[0].total || 0,
                    pending: statsResult[0].pending || 0,
                    added_this_month: statsResult[0].added_this_month || 0,
                    movies: statsResult[0].movies || 0,
                    tv: statsResult[0].tv || 0
                }
            });
        } catch (error) {
            console.error('Error fetching wishboard:', error);
            res.status(500).json({ error: 'Failed to fetch wishboard' });
        }
    });

    /**
     * POST /api/wishboard
     * Create a new content request
     */
    router.post('/', requireAuth, async (req, res) => {
        try {
            const { tmdb_id, media_type, season_number, season_numbers } = req.body;
            const userId = req.user.userId;
            const profileId = getProfileId(req);

            if (!tmdb_id || !media_type) {
                return res.status(400).json({ error: 'tmdb_id and media_type are required' });
            }

            if (!profileId) {
                return res.status(400).json({ error: 'Profile ID is required' });
            }

            const isOwner = await verifyProfileOwnership(userId, req.user.userType, profileId);
            if (!isOwner) {
                return res.status(403).json({ error: 'Ce profil ne vous appartient pas' });
            }

            // Check Limits
            const { remaining, limit } = await checkLimit(userId, req.user.userType, profileId, req);
            if (remaining <= 0) {
                return res.status(429).json({
                    error: `Limite atteinte. Vous avez droit à ${limit} demande(s) toutes les 48h.`,
                    limit_reached: true
                });
            }

            // Handle both old single season_number and new season_numbers array
            // Database column is INTEGER, so we store a single season number
            let seasonParam = null;
            if (season_numbers && Array.isArray(season_numbers) && season_numbers.length > 0) {
                // If array has one element, store just that number
                // If array has multiple elements, store the first one (or 0 for "all seasons")
                if (season_numbers.length === 1) {
                    seasonParam = parseInt(season_numbers[0], 10);
                } else {
                    // Multiple seasons requested - store 0 to indicate "all seasons" or first season
                    seasonParam = season_numbers.includes(0) ? 0 : parseInt(season_numbers[0], 10);
                }
            } else if (season_number !== undefined && season_number !== null) {
                // Backwards compatibility: single number
                seasonParam = parseInt(season_number, 10);
            }

            // Check if request already exists (check for exact match)
            let existingQuery;
            let existingParams;

            if (seasonParam === null) {
                existingQuery = 'SELECT id FROM wishboard_requests WHERE tmdb_id = ? AND media_type = ? AND season_number IS NULL';
                existingParams = [tmdb_id, media_type];
            } else {
                existingQuery = 'SELECT id FROM wishboard_requests WHERE tmdb_id = ? AND media_type = ? AND season_number = ?';
                existingParams = [tmdb_id, media_type, seasonParam];
            }

            const [existing] = await mysqlPool.execute(existingQuery, existingParams);

            if (existing.length > 0) {
                return res.status(409).json({
                    error: 'Cette demande existe déjà',
                    existing_id: existing[0].id
                });
            }

            // Insert new request
            const [result] = await mysqlPool.execute(
                'INSERT INTO wishboard_requests (user_id, profile_id, tmdb_id, media_type, season_number, status, vote_count) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [userId, profileId, tmdb_id, media_type, seasonParam, 'pending', 0]
            );

            const insertId = result.insertId;

            // Record initial status in history
            await recordStatusHistory(insertId, 'pending');

            res.status(201).json({
                id: insertId,
                message: 'Demande créée avec succès'
            });
        } catch (error) {
            console.error('Error creating wishboard request:', error);
            res.status(500).json({ error: 'Failed to create request' });
        }
    });

    /**
     * POST /api/wishboard/:id/vote
     * Vote for a request
     */
    router.post('/:id/vote', requireAuth, async (req, res) => {
        try {
            if (TURNSTILE_INVISIBLE_SECRETKEY) {
                const { turnstileToken } = req.body || {};
                const check = await verifyTurnstileFromRequest(req, turnstileToken, 'invisible');
                if (!check.valid) {
                    return res.status(check.status).json({ error: check.error });
                }
            }

            const requestId = req.params.id;
            const userId = req.user.userId;
            const profileId = getProfileId(req);

            if (!profileId) {
                return res.status(400).json({ error: 'Profile ID is required' });
            }

            const isOwner = await verifyProfileOwnership(userId, req.user.userType, profileId);
            if (!isOwner) {
                return res.status(403).json({ error: 'Ce profil ne vous appartient pas' });
            }

            // Check if already voted (dedup by user_id to prevent vote stuffing)
            const [existing] = await mysqlPool.execute(
                'SELECT id FROM wishboard_votes WHERE request_id = ? AND user_id = ?',
                [requestId, userId]
            );

            if (existing.length > 0) {
                return res.status(409).json({ error: 'Vous avez déjà voté pour cette demande' });
            }

            // Add vote
            await mysqlPool.execute(
                'INSERT INTO wishboard_votes (request_id, user_id, profile_id) VALUES (?, ?, ?)',
                [requestId, userId, profileId]
            );

            res.json({ message: 'Vote enregistré' });
        } catch (error) {
            console.error('Error voting:', error);
            res.status(500).json({ error: 'Failed to vote' });
        }
    });

    /**
     * DELETE /api/wishboard/:id/vote
     * Remove vote from a request
     */
    router.delete('/:id/vote', requireAuth, async (req, res) => {
        try {
            if (TURNSTILE_INVISIBLE_SECRETKEY) {
                const { turnstileToken } = req.body || {};
                const check = await verifyTurnstileFromRequest(req, turnstileToken, 'invisible');
                if (!check.valid) {
                    return res.status(check.status).json({ error: check.error });
                }
            }

            const requestId = req.params.id;
            const userId = req.user.userId;

            await mysqlPool.execute(
                'DELETE FROM wishboard_votes WHERE request_id = ? AND user_id = ?',
                [requestId, userId]
            );

            res.json({ message: 'Vote retiré' });
        } catch (error) {
            console.error('Error removing vote:', error);
            res.status(500).json({ error: 'Failed to remove vote' });
        }
    });

    /**
     * GET /api/wishboard/user/requests
     * Get current user's requests
     */
    router.get('/user/requests', requireAuth, async (req, res) => {
        try {
            const profileId = getProfileId(req);

            if (!profileId) {
                return res.status(400).json({ error: 'Profile ID is required' });
            }

            const isOwner = await verifyProfileOwnership(req.user.userId, req.user.userType, profileId);
            if (!isOwner) {
                return res.status(403).json({ error: 'Ce profil ne vous appartient pas' });
            }

            const [requests] = await mysqlPool.execute(
                'SELECT * FROM wishboard_requests WHERE profile_id = ? ORDER BY created_at DESC',
                [profileId]
            );

            // Get public notes and vote status for each request
            const requestsWithNotes = await Promise.all(requests.map(async (r) => {
                const [notes] = await mysqlPool.execute(
                    'SELECT id, note, is_public, created_at FROM wishboard_notes WHERE request_id = ? AND is_public = 1 ORDER BY created_at DESC',
                    [r.id]
                );

                const [voteRows] = await mysqlPool.execute(
                    'SELECT id FROM wishboard_votes WHERE request_id = ? AND profile_id = ?',
                    [r.id, profileId]
                );

                // Get status history
                const [statusHistory] = await mysqlPool.execute(
                    'SELECT status, reason, changed_at FROM wishboard_status_history WHERE request_id = ? ORDER BY changed_at ASC',
                    [r.id]
                );

                return { ...r, notes, has_voted: voteRows.length > 0, statusHistory };
            }));

            res.json({ requests: requestsWithNotes });
        } catch (error) {
            console.error('Error fetching user requests:', error);
            res.status(500).json({ error: 'Failed to fetch requests' });
        }
    });

    /**
     * GET /api/wishboard/user/votes
     * Get current user's voted requests
     */
    router.get('/user/votes', requireAuth, async (req, res) => {
        try {
            const profileId = getProfileId(req);

            if (!profileId) {
                return res.status(400).json({ error: 'Profile ID is required' });
            }

            const isOwner = await verifyProfileOwnership(req.user.userId, req.user.userType, profileId);
            if (!isOwner) {
                return res.status(403).json({ error: 'Ce profil ne vous appartient pas' });
            }

            const [requests] = await mysqlPool.execute(
                `SELECT r.* FROM wishboard_requests r
         INNER JOIN wishboard_votes v ON v.request_id = r.id
         WHERE v.profile_id = ? AND r.profile_id != ?
         ORDER BY v.created_at DESC`,
                [profileId, profileId]
            );

            const requestsWithVoted = await Promise.all(requests.map(async (r) => {
                // Get status history
                const [statusHistory] = await mysqlPool.execute(
                    'SELECT status, reason, changed_at FROM wishboard_status_history WHERE request_id = ? ORDER BY changed_at ASC',
                    [r.id]
                );
                return { ...r, has_voted: true, statusHistory };
            }));

            res.json({ requests: requestsWithVoted });
        } catch (error) {
            console.error('Error fetching voted requests:', error);
            res.status(500).json({ error: 'Failed to fetch votes' });
        }
    });

    // =====================================
    // LIMITS ENDPOINT
    // =====================================

    /**
     * GET /api/wishboard/limits
     * Get user's request limit status (quota)
     */
    router.get('/limits', requireAuth, async (req, res) => {
        try {
            const profileId = getProfileId(req);
            if (!profileId) {
                return res.status(400).json({ error: 'Profile ID is required' });
            }

            const isOwner = await verifyProfileOwnership(req.user.userId, req.user.userType, profileId);
            if (!isOwner) {
                return res.status(403).json({ error: 'Ce profil ne vous appartient pas' });
            }

            const limitStatus = await checkLimit(req.user.userId, req.user.userType, profileId, req);
            res.json(limitStatus);
        } catch (error) {
            console.error('Error fetching limits:', error);
            res.status(500).json({ error: 'Failed to fetch limits' });
        }
    });

    // =====================================
    // ADMIN ENDPOINTS
    // =====================================

    /**
     * GET /api/wishboard/admin
     * Admin list with all details
     */
    router.get('/admin', requireAuth, requireUploaderOrAdmin, async (req, res) => {
        try {
            const { search, media_type, status, vip_only, page = '1', limit = '50' } = req.query;
            const pageNum = Math.max(1, parseInt(page) || 1);
            const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
            const offset = (pageNum - 1) * limitNum;

            let whereConditions = ['1=1'];
            let whereParams = [];

            if (search) {
                const isNumericSearch = /^\d+$/.test(search.trim());
                if (isNumericSearch) {
                    // Direct TMDB ID or request ID search
                    const numSearch = parseInt(search);
                    whereConditions.push('(tmdb_id = ? OR id = ?)');
                    whereParams.push(numSearch, numSearch);
                } else {
                    // Text search: query TMDB API to find matching IDs
                    const tmdbIds = await searchTmdbIds(search.trim());
                    if (tmdbIds.length > 0) {
                        whereConditions.push(`tmdb_id IN (${tmdbIds.map(() => '?').join(',')})`);
                        whereParams.push(...tmdbIds);
                    } else {
                        // No TMDB results, return empty
                        return res.json({ requests: [], stats: { total: 0, pending: 0, added: 0, rejected: 0, not_found: 0 }, hasMore: false });
                    }
                }
            }

            if (media_type && media_type !== 'all') {
                whereConditions.push('media_type = ?');
                whereParams.push(media_type);
            }

            if (status && status !== 'all') {
                whereConditions.push('status = ?');
                whereParams.push(status);
            }

            const whereClause = whereConditions.join(' AND ');

            // Get requests with pagination (fetch one extra to check hasMore)
            const [requests] = await mysqlPool.execute(
                `SELECT * FROM wishboard_requests WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
                [...whereParams, String(limitNum + 1), String(offset)]
            );

            const hasMore = requests.length > limitNum;
            const paginatedRequests = hasMore ? requests.slice(0, limitNum) : requests;

            // Get notes for each request and user info
            const requestsWithNotes = await Promise.all(paginatedRequests.map(async (r) => {
                const [notes] = await mysqlPool.execute(
                    'SELECT id, admin_id, note, is_public, created_at FROM wishboard_notes WHERE request_id = ? ORDER BY created_at DESC',
                    [r.id]
                );
                // Get status history
                const [statusHistory] = await mysqlPool.execute(
                    'SELECT id, status, reason, changed_at FROM wishboard_status_history WHERE request_id = ? ORDER BY changed_at ASC',
                    [r.id]
                );

                // Get user info
                let user = { username: 'Inconnu', isVip: false };
                try {
                    // Determine user type (bip39 or oauth)
                    let userType = 'oauth'; // Default to oauth
                    try {
                        await fs.access(path.join(__dirname, 'data', 'users', `bip39-${r.user_id}.json`));
                        userType = 'bip39';
                    } catch {
                        // Keep oauth
                    }
                    user = await getUserData(r.user_id, userType, r.profile_id);
                } catch (e) {
                    // Ignore error, keep default
                }

                return { ...r, notes, statusHistory, user };
            }));

            // Filter VIP-only after fetching user data
            const filteredRequests = vip_only === 'true'
                ? requestsWithNotes.filter(r => r.user?.isVip)
                : requestsWithNotes;

            // Get stats
            const [statsResult] = await mysqlPool.execute(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN status = 'added' THEN 1 ELSE 0 END) as added,
          SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
          SUM(CASE WHEN status IN ('not_found', 'not_found_recent') THEN 1 ELSE 0 END) as not_found
        FROM wishboard_requests
      `);

            res.json({
                requests: filteredRequests,
                hasMore,
                stats: {
                    total: statsResult[0].total || 0,
                    pending: statsResult[0].pending || 0,
                    added: statsResult[0].added || 0,
                    rejected: statsResult[0].rejected || 0,
                    not_found: statsResult[0].not_found || 0
                }
            });
        } catch (error) {
            console.error('Error fetching admin wishboard:', error);
            res.status(500).json({ error: 'Failed to fetch admin wishboard' });
        }
    });

    /**
     * PUT /api/wishboard/admin/:id/status
     * Update request status
     */
    router.put('/admin/:id/status', requireAuth, requireUploaderOrAdmin, async (req, res) => {
        try {
            const requestId = req.params.id;
            const { status, reason } = req.body;

            const validStatuses = ['pending', 'not_found', 'not_found_recent', 'searching', 'added', 'rejected'];
            if (!validStatuses.includes(status)) {
                return res.status(400).json({ error: 'Invalid status' });
            }

            // Get admin info from middleware
            const adminId = req.admin ? req.admin.userId : null;
            const adminAuthType = req.admin ? (req.admin.userType === 'bip39' ? 'bip-39' : req.admin.userType) : null;

            await mysqlPool.execute(
                'UPDATE wishboard_requests SET status = ?, updated_at = NOW() WHERE id = ?',
                [status, requestId]
            );

            // Record status history with reason and admin info
            const historyId = await recordStatusHistory(requestId, status, reason, adminId, adminAuthType);

            res.json({ message: 'Statut mis à jour', historyId });
        } catch (error) {
            console.error('Error updating status:', error);
            res.status(500).json({ error: 'Failed to update status' });
        }
    });

    /**
     * PUT /api/wishboard/admin/history/:historyId
     * Update status history reason
     */
    router.put('/admin/history/:historyId', requireAuth, requireUploaderOrAdmin, async (req, res) => {
        try {
            const historyId = req.params.historyId;
            const { reason } = req.body;

            await mysqlPool.execute(
                'UPDATE wishboard_status_history SET reason = ? WHERE id = ?',
                [reason, historyId]
            );

            res.json({ message: 'Raison mise à jour' });
        } catch (error) {
            console.error('Error updating history reason:', error);
            res.status(500).json({ error: 'Failed to update reason' });
        }
    });

    /**
     * POST /api/wishboard/admin/:id/notes
     * Add note to request
     */
    router.post('/admin/:id/notes', requireAuth, requireUploaderOrAdmin, async (req, res) => {
        try {
            const requestId = req.params.id;
            const { note, is_public = true } = req.body;
            const adminId = req.user.userId;

            if (!note || !note.trim()) {
                return res.status(400).json({ error: 'Note content is required' });
            }

            // Check if note already exists for this request
            const [existing] = await mysqlPool.execute('SELECT id FROM wishboard_notes WHERE request_id = ?', [requestId]);

            let resultId;
            if (existing.length > 0) {
                // Update existing
                await mysqlPool.execute(
                    'UPDATE wishboard_notes SET note = ?, is_public = ?, admin_id = ?, updated_at = NOW() WHERE request_id = ?',
                    [note.trim(), is_public ? 1 : 0, adminId, requestId]
                );
                resultId = existing[0].id;
            } else {
                // Insert new
                const [result] = await mysqlPool.execute(
                    'INSERT INTO wishboard_notes (request_id, admin_id, note, is_public) VALUES (?, ?, ?, ?)',
                    [requestId, adminId, note.trim(), is_public ? 1 : 0]
                );
                resultId = result.insertId;
            }

            res.status(201).json({
                id: resultId,
                admin_id: adminId,
                note: note.trim(),
                is_public: is_public ? 1 : 0,
                created_at: new Date().toISOString()
            });
        } catch (error) {
            console.error('Error adding note:', error);
            res.status(500).json({ error: 'Failed to add note' });
        }
    });

    /**
     * GET /api/wishboard/admin/leaderboard
     * Get monthly leaderboard of admins/uploaders by greenlight count
     */
    router.get('/admin/leaderboard', requireAuth, requireUploaderOrAdmin, async (req, res) => {
        try {
            const monthParam = Array.isArray(req.query.month) ? req.query.month[0] : req.query.month;
            const monthMatch = typeof monthParam === 'string' && monthParam.trim()
                ? monthParam.trim().match(/^(\d{4})-(\d{2})$/)
                : null;

            if (monthParam && (!monthMatch || Number(monthMatch[2]) < 1 || Number(monthMatch[2]) > 12)) {
                return res.status(400).json({ error: 'Invalid month format. Expected YYYY-MM' });
            }

            const targetDate = monthMatch
                ? new Date(Number(monthMatch[1]), Number(monthMatch[2]) - 1, 1)
                : new Date();
            const periodStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1);
            const periodEnd = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 1);
            const formatSqlDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

            // Get all admins/uploaders who have greenlighted at least one request for the selected month
            const [rows] = await mysqlPool.execute(`
                SELECT
                    h.admin_id,
                    h.admin_auth_type,
                    COUNT(*) as greenlight_count,
                    MAX(h.changed_at) as last_greenlight_at
                FROM wishboard_status_history h
                WHERE h.status = 'added'
                    AND h.admin_id IS NOT NULL
                    AND h.changed_at >= ?
                    AND h.changed_at < ?
                GROUP BY h.admin_id, h.admin_auth_type
                ORDER BY greenlight_count DESC, last_greenlight_at DESC
            `, [formatSqlDate(periodStart), formatSqlDate(periodEnd)]);

            // Get admin roles from admins table
            const adminIds = rows.map(r => r.admin_id);
            let adminRoles = {};
            if (adminIds.length > 0) {
                const placeholders = adminIds.map(() => '?').join(',');
                const [roleRows] = await mysqlPool.execute(
                    `SELECT user_id, role FROM admins WHERE user_id IN (${placeholders})`,
                    adminIds
                );
                for (const r of roleRows) {
                    adminRoles[r.user_id] = r.role || 'admin';
                }
            }

            // Resolve user data (username, avatar) for each greenlighter via the
            // shared helper. Greenlight uses the user's FIRST Movix profile
            // (preferProfile) for pdp + username, not the OAuth/Discord identity.
            const leaderboard = await Promise.all(rows.map(async (row) => {
                const identity = await resolveAdminIdentity(row.admin_id, row.admin_auth_type, { preferProfile: true });
                return {
                    admin_id: row.admin_id,
                    admin_auth_type: row.admin_auth_type,
                    role: adminRoles[row.admin_id] || 'admin',
                    username: identity.username,
                    avatar: identity.avatar,
                    greenlight_count: row.greenlight_count,
                    last_greenlight_at: row.last_greenlight_at
                };
            }));

            res.json({
                leaderboard,
                month: `${periodStart.getFullYear()}-${String(periodStart.getMonth() + 1).padStart(2, '0')}`
            });
        } catch (error) {
            console.error('Error fetching leaderboard:', error);
            res.status(500).json({ error: 'Failed to fetch leaderboard' });
        }
    });

    /**
     * DELETE /api/wishboard/admin/:id
     * Delete a request
     */
    router.delete('/admin/:id', requireAuth, requireUploaderOrAdmin, async (req, res) => {
        try {
            const requestId = req.params.id;

            // Delete related votes first
            await mysqlPool.execute('DELETE FROM wishboard_votes WHERE request_id = ?', [requestId]);
            // Delete related notes
            await mysqlPool.execute('DELETE FROM wishboard_notes WHERE request_id = ?', [requestId]);
            // Delete request
            await mysqlPool.execute('DELETE FROM wishboard_requests WHERE id = ?', [requestId]);

            res.json({ message: 'Demande supprimée' });
        } catch (error) {
            console.error('Error deleting request:', error);
            res.status(500).json({ error: 'Failed to delete request' });
        }
    });

    return router;
}

module.exports = { createWishboardRouter };
