/**
 * Link Submissions API Routes
 * System for users to propose streaming links for movies/episodes/seasons
 * Links must be approved by staff before being added
 * 
 * Encourages usage of https://uqload.vc/ as a preferred source
 * 
 * Uses MySQL database (same as the rest of the app)
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const fs = require('fs').promises;
const path = require('path');
const { verifyAccessKey } = require('./checkVip');

const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Creates and returns the link submissions router
 * @param {Object} mysqlPool - MySQL connection pool from server.js
 * @param {Object} redis - Redis client instance from server.js
 * @returns {express.Router} Express router with link submission routes
 */
function createLinkSubmissionsRouter(mysqlPool, redis) {
    const router = express.Router();

    // =====================================
    // MIDDLEWARE
    // =====================================

    // Verify JWT token with MySQL session validation (same as wishboardRoutes)
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

            req.user = { userId, userType, sessionId };
            next();
        } catch (error) {
            if (error instanceof jwt.JsonWebTokenError) {
                return res.status(401).json({ error: 'Token invalide' });
            }
            // MySQL indisponible (restart, queue limit…) : 503 plutôt que 401,
            // sinon le front déconnecte l'utilisateur.
            console.error('[linkSubmissions][requireAuth] Vérif session impossible:', error.message);
            return res.status(503).json({ error: 'Service temporairement indisponible' });
        }
    };

    // Check admin or uploader status
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

            const role = rows[0].role || 'admin';
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

    // Get user data from JSON files
    async function getUserData(userId, userType, profileId = null) {
        try {
            let userData = { username: 'Utilisateur', avatar: null, isVip: false };
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
                if (profileId && user.profiles) {
                    const profile = user.profiles.find(p => p.id === profileId);
                    if (profile) {
                        userData.username = profile.name || 'Utilisateur';
                        userData.avatar = profile.avatar;
                    }
                }
            } catch (err) {
                // File not found — keep defaults
            }

            return userData;
        } catch (error) {
            return { username: 'Utilisateur', avatar: null, isVip: false };
        }
    }

    // Rate limiting: check submission count (15 movies, 10 unique series per 24h)
    const checkSubmissionLimit = async (profileId) => {
        // Count movies submitted in last 24h
        const [movieResult] = await mysqlPool.execute(
            `SELECT COUNT(*) as count FROM link_submissions 
             WHERE profile_id = ? AND media_type = 'movie'
             AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
            [profileId]
        );
        // Count unique series (by tmdb_id) submitted in last 24h
        const [seriesResult] = await mysqlPool.execute(
            `SELECT COUNT(DISTINCT tmdb_id) as count FROM link_submissions 
             WHERE profile_id = ? AND media_type = 'tv'
             AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
            [profileId]
        );
        const movieCount = movieResult[0].count;
        const seriesCount = seriesResult[0].count;
        const movieLimit = 15;
        const seriesLimit = 10;
        return {
            movies: { count: movieCount, limit: movieLimit, remaining: Math.max(0, movieLimit - movieCount) },
            series: { count: seriesCount, limit: seriesLimit, remaining: Math.max(0, seriesLimit - seriesCount) },
        };
    };

    // Check if a specific series tmdb_id was already counted in the 24h window
    const isSeriesAlreadyCounted = async (profileId, tmdbId) => {
        const [result] = await mysqlPool.execute(
            `SELECT COUNT(*) as count FROM link_submissions 
             WHERE profile_id = ? AND media_type = 'tv' AND tmdb_id = ?
             AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
            [profileId, tmdbId]
        );
        return result[0].count > 0;
    };

    // =====================================
    // USER ENDPOINTS
    // =====================================

    /**
     * POST /api/link-submissions
     * Submit a new link for a movie/episode/season
     */
    router.post('/', requireAuth, async (req, res) => {
        try {
            const { tmdb_id, media_type, season_number, episode_number, url, source_name } = req.body;
            const userId = req.user.userId;
            const profileId = getProfileId(req);

            if (!profileId) {
                return res.status(400).json({ error: 'Profile ID requis' });
            }

            const isOwner = await verifyProfileOwnership(userId, req.user.userType, profileId);
            if (!isOwner) {
                return res.status(403).json({ error: 'Ce profil ne vous appartient pas' });
            }

            if (!tmdb_id || !media_type || !url) {
                return res.status(400).json({ error: 'tmdb_id, media_type et url sont requis' });
            }

            if (!['movie', 'tv'].includes(media_type)) {
                return res.status(400).json({ error: 'media_type doit être movie ou tv' });
            }

            // Validate URL format
            try {
                new URL(url);
            } catch {
                return res.status(400).json({ error: 'URL invalide' });
            }

            // Basic URL sanitization
            const cleanUrl = url.trim();
            if (cleanUrl.length > 2048) {
                return res.status(400).json({ error: 'URL trop longue' });
            }

            // Check rate limit based on media type
            const limits = await checkSubmissionLimit(profileId);
            if (media_type === 'movie') {
                if (limits.movies.remaining <= 0) {
                    return res.status(429).json({
                        error: 'Limite de films atteinte (15 films/24h).',
                        limit_reached: true
                    });
                }
            } else {
                // For TV: only count against limit if it's a NEW series
                const alreadyCounted = await isSeriesAlreadyCounted(profileId, tmdb_id);
                if (!alreadyCounted && limits.series.remaining <= 0) {
                    return res.status(429).json({
                        error: 'Limite de séries atteinte (10 séries/24h).',
                        limit_reached: true
                    });
                }
            }

            // Check for duplicate (same URL for same content)
            const [existing] = await mysqlPool.execute(
                `SELECT id FROM link_submissions WHERE tmdb_id = ? AND media_type = ? AND url = ? AND status != 'rejected'`,
                [tmdb_id, media_type, cleanUrl]
            );

            if (existing.length > 0) {
                return res.status(409).json({ error: 'Ce lien a déjà été soumis pour ce contenu' });
            }

            // Insert submission
            const seasonNum = (media_type === 'tv' && season_number !== undefined && season_number !== null) ? parseInt(season_number, 10) : null;
            const episodeNum = (media_type === 'tv' && episode_number !== undefined && episode_number !== null) ? parseInt(episode_number, 10) : null;
            const sourceName = source_name ? source_name.trim().substring(0, 100) : null;

            const [result] = await mysqlPool.execute(
                `INSERT INTO link_submissions 
                 (user_id, profile_id, tmdb_id, media_type, season_number, episode_number, url, source_name, status) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
                [userId, profileId, tmdb_id, media_type, seasonNum, episodeNum, cleanUrl, sourceName]
            );

            res.status(201).json({
                id: result.insertId,
                message: 'Lien soumis avec succès ! Il sera examiné par notre équipe.'
            });
        } catch (error) {
            console.error('Error creating link submission:', error);
            res.status(500).json({ error: 'Erreur lors de la soumission du lien' });
        }
    });

    /**
     * GET /api/link-submissions/my
     * Get current user's submissions
     */
    router.get('/my', requireAuth, async (req, res) => {
        try {
            const profileId = getProfileId(req);
            if (!profileId) {
                return res.status(400).json({ error: 'Profile ID requis' });
            }

            const isOwner = await verifyProfileOwnership(req.user.userId, req.user.userType, profileId);
            if (!isOwner) {
                return res.status(403).json({ error: 'Ce profil ne vous appartient pas' });
            }

            const [submissions] = await mysqlPool.execute(
                `SELECT * FROM link_submissions WHERE profile_id = ? ORDER BY created_at DESC LIMIT 50`,
                [profileId]
            );

            res.json({ submissions });
        } catch (error) {
            console.error('Error fetching user submissions:', error);
            res.status(500).json({ error: 'Erreur lors de la récupération des soumissions' });
        }
    });

    /**
     * GET /api/link-submissions/limits
     * Get user's submission rate limit status
     */
    router.get('/limits', requireAuth, async (req, res) => {
        try {
            const profileId = getProfileId(req);
            if (!profileId) {
                return res.status(400).json({ error: 'Profile ID requis' });
            }

            const isOwner = await verifyProfileOwnership(req.user.userId, req.user.userType, profileId);
            if (!isOwner) {
                return res.status(403).json({ error: 'Ce profil ne vous appartient pas' });
            }

            const limitStatus = await checkSubmissionLimit(profileId);
            res.json(limitStatus);
        } catch (error) {
            console.error('Error fetching limits:', error);
            res.status(500).json({ error: 'Erreur lors de la récupération des limites' });
        }
    });

    /**
     * POST /api/link-submissions/bulk
     * Submit links for multiple episodes at once (same series, same URL pattern)
     */
    router.post('/bulk', requireAuth, async (req, res) => {
        try {
            const { tmdb_id, media_type, season_number, episode_urls, source_name } = req.body;
            const userId = req.user.userId;
            const profileId = getProfileId(req);

            if (!profileId) return res.status(400).json({ error: 'Profile ID requis' });

            const isOwner = await verifyProfileOwnership(userId, req.user.userType, profileId);
            if (!isOwner) {
                return res.status(403).json({ error: 'Ce profil ne vous appartient pas' });
            }

            if (!tmdb_id || media_type !== 'tv') return res.status(400).json({ error: 'tmdb_id et media_type=tv sont requis' });
            if (!episode_urls || typeof episode_urls !== 'object' || Object.keys(episode_urls).length === 0) return res.status(400).json({ error: 'episode_urls requis (objet {episode_number: url})' });
            if (season_number === undefined || season_number === null) return res.status(400).json({ error: 'season_number requis' });

            // Validate all URLs
            for (const [ep, url] of Object.entries(episode_urls)) {
                if (!url || typeof url !== 'string' || !url.trim()) return res.status(400).json({ error: `URL manquante pour l'épisode ${ep}` });
                try { new URL(url.trim()); } catch { return res.status(400).json({ error: `URL invalide pour l'épisode ${ep}` }); }
                if (url.trim().length > 2048) return res.status(400).json({ error: `URL trop longue pour l'épisode ${ep}` });
            }

            // Check rate limit (counts as 1 series if not already counted)
            const limits = await checkSubmissionLimit(profileId);
            const alreadyCounted = await isSeriesAlreadyCounted(profileId, tmdb_id);
            if (!alreadyCounted && limits.series.remaining <= 0) {
                return res.status(429).json({ error: 'Limite de séries atteinte (10 séries/24h).', limit_reached: true });
            }

            const seasonNum = parseInt(season_number, 10);
            const sourceName = source_name ? source_name.trim().substring(0, 100) : null;
            let inserted = 0;
            let duplicates = 0;

            for (const [epNumStr, epUrl] of Object.entries(episode_urls)) {
                const episodeNum = parseInt(epNumStr, 10);
                const cleanUrl = String(epUrl).trim();
                // Check duplicate
                const [existing] = await mysqlPool.execute(
                    `SELECT id FROM link_submissions WHERE tmdb_id = ? AND media_type = 'tv' AND season_number = ? AND episode_number = ? AND url = ? AND status != 'rejected'`,
                    [tmdb_id, seasonNum, episodeNum, cleanUrl]
                );
                if (existing.length > 0) { duplicates++; continue; }

                await mysqlPool.execute(
                    `INSERT INTO link_submissions (user_id, profile_id, tmdb_id, media_type, season_number, episode_number, url, source_name, status) VALUES (?, ?, ?, 'tv', ?, ?, ?, ?, 'pending')`,
                    [userId, profileId, tmdb_id, seasonNum, episodeNum, cleanUrl, sourceName]
                );
                inserted++;
            }

            res.status(201).json({ message: `${inserted} épisode(s) soumis`, inserted, duplicates });
        } catch (error) {
            console.error('Error bulk submitting:', error);
            res.status(500).json({ error: 'Erreur lors de la soumission en masse' });
        }
    });

    /**
     * DELETE /api/link-submissions/:id
     * User can delete their own pending submission
     */
    router.delete('/:id', requireAuth, async (req, res) => {
        try {
            const submissionId = req.params.id;
            const profileId = getProfileId(req);

            if (!profileId) {
                return res.status(400).json({ error: 'Profile ID requis' });
            }

            const isOwner = await verifyProfileOwnership(req.user.userId, req.user.userType, profileId);
            if (!isOwner) {
                return res.status(403).json({ error: 'Ce profil ne vous appartient pas' });
            }

            // Only allow deleting own submissions that are still pending
            const [result] = await mysqlPool.execute(
                `DELETE FROM link_submissions WHERE id = ? AND profile_id = ? AND status = 'pending'`,
                [submissionId, profileId]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({ error: 'Soumission non trouvée ou déjà traitée' });
            }

            res.json({ message: 'Soumission supprimée' });
        } catch (error) {
            console.error('Error deleting submission:', error);
            res.status(500).json({ error: 'Erreur lors de la suppression' });
        }
    });

    // =====================================
    // ADMIN ENDPOINTS
    // =====================================

    /**
     * GET /api/link-submissions/admin
     * Admin: list all submissions with filters
     */
    router.get('/admin', requireAuth, requireUploaderOrAdmin, async (req, res) => {
        try {
            const { status = 'pending', media_type, search, page = 1, limit = 50 } = req.query;
            const offset = (parseInt(page) - 1) * parseInt(limit);

            let whereConditions = ['1=1'];
            let whereParams = [];

            if (status && status !== 'all') {
                whereConditions.push('ls.status = ?');
                whereParams.push(status);
            }

            if (media_type && media_type !== 'all') {
                whereConditions.push('ls.media_type = ?');
                whereParams.push(media_type);
            }

            if (search) {
                const numSearch = parseInt(search);
                if (!isNaN(numSearch)) {
                    whereConditions.push('(ls.tmdb_id = ? OR ls.id = ?)');
                    whereParams.push(numSearch, numSearch);
                } else {
                    whereConditions.push('(ls.url LIKE ? OR ls.source_name LIKE ?)');
                    whereParams.push(`%${search}%`, `%${search}%`);
                }
            }

            const whereClause = whereConditions.join(' AND ');

            const [submissions] = await mysqlPool.execute(
                `SELECT ls.* FROM link_submissions ls
                 WHERE ${whereClause}
                 ORDER BY ls.created_at DESC
                 LIMIT ? OFFSET ?`,
                [...whereParams, parseInt(limit), offset]
            );

            // Enrich with user data
            const enriched = await Promise.all(submissions.map(async (sub) => {
                let user = { username: 'Inconnu', avatar: null };
                try {
                    let userType = 'oauth';
                    try {
                        await fs.access(path.join(__dirname, 'data', 'users', `bip39-${sub.user_id}.json`));
                        userType = 'bip39';
                    } catch { /* keep oauth */ }
                    user = await getUserData(sub.user_id, userType, sub.profile_id);
                } catch { /* ignore */ }
                return { ...sub, user };
            }));

            // Get stats
            const [statsResult] = await mysqlPool.execute(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
                    SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
                    SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected
                FROM link_submissions
            `);

            // Get total count for pagination
            const [countResult] = await mysqlPool.execute(
                `SELECT COUNT(*) as total FROM link_submissions ls WHERE ${whereClause}`,
                whereParams
            );

            res.json({
                submissions: enriched,
                has_more: countResult[0].total > offset + submissions.length,
                stats: {
                    total: statsResult[0].total || 0,
                    pending: statsResult[0].pending || 0,
                    approved: statsResult[0].approved || 0,
                    rejected: statsResult[0].rejected || 0
                }
            });
        } catch (error) {
            console.error('Error fetching admin submissions:', error);
            res.status(500).json({ error: 'Erreur lors de la récupération des soumissions' });
        }
    });

    /**
     * PUT /api/link-submissions/admin/:id/approve
     * Admin: approve a submission and add the link to films/series table
     */
    router.put('/admin/:id/approve', requireAuth, requireUploaderOrAdmin, async (req, res) => {
        try {
            const submissionId = req.params.id;

            // Get the submission
            const [submissions] = await mysqlPool.execute(
                'SELECT * FROM link_submissions WHERE id = ?',
                [submissionId]
            );

            if (submissions.length === 0) {
                return res.status(404).json({ error: 'Soumission non trouvée' });
            }

            const sub = submissions[0];

            if (sub.status !== 'pending') {
                return res.status(400).json({ error: 'Cette soumission a déjà été traitée' });
            }

            // Add the link to the appropriate table
            if (sub.media_type === 'movie') {
                // Check if film exists
                const [existing] = await mysqlPool.execute('SELECT id, links FROM films WHERE id = ?', [sub.tmdb_id]);

                if (existing.length > 0) {
                    // Merge link
                    let currentLinks = [];
                    try {
                        currentLinks = JSON.parse(existing[0].links || '[]');
                    } catch { currentLinks = []; }

                    if (!currentLinks.includes(sub.url)) {
                        currentLinks.push(sub.url);
                    }

                    await mysqlPool.execute(
                        'UPDATE films SET links = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                        [JSON.stringify(currentLinks), sub.tmdb_id]
                    );
                } else {
                    // Create new entry
                    await mysqlPool.execute(
                        'INSERT INTO films (id, links) VALUES (?, ?)',
                        [sub.tmdb_id, JSON.stringify([sub.url])]
                    );
                }
            } else if (sub.media_type === 'tv') {
                const seasonNum = sub.season_number;
                const episodeNum = sub.episode_number;

                if (seasonNum !== null && episodeNum !== null) {
                    // Specific episode
                    const [existing] = await mysqlPool.execute(
                        'SELECT id, links FROM series WHERE series_id = ? AND season_number = ? AND episode_number = ?',
                        [sub.tmdb_id, seasonNum, episodeNum]
                    );

                    if (existing.length > 0) {
                        let currentLinks = [];
                        try {
                            currentLinks = JSON.parse(existing[0].links || '[]');
                        } catch { currentLinks = []; }

                        if (!currentLinks.includes(sub.url)) {
                            currentLinks.push(sub.url);
                        }

                        await mysqlPool.execute(
                            'UPDATE series SET links = ? WHERE series_id = ? AND season_number = ? AND episode_number = ?',
                            [JSON.stringify(currentLinks), sub.tmdb_id, seasonNum, episodeNum]
                        );
                    } else {
                        await mysqlPool.execute(
                            'INSERT INTO series (series_id, season_number, episode_number, links) VALUES (?, ?, ?, ?)',
                            [sub.tmdb_id, seasonNum, episodeNum, JSON.stringify([sub.url])]
                        );
                    }
                }
            }

            // Update submission status
            await mysqlPool.execute(
                `UPDATE link_submissions SET status = 'approved', reviewed_by = ?, reviewed_at = NOW() WHERE id = ?`,
                [req.admin.userId, submissionId]
            );

            res.json({ message: 'Lien approuvé et ajouté avec succès' });
        } catch (error) {
            console.error('Error approving submission:', error);
            res.status(500).json({ error: 'Erreur lors de l\'approbation' });
        }
    });

    /**
     * PUT /api/link-submissions/admin/:id/reject
     * Admin: reject a submission with optional reason
     */
    router.put('/admin/:id/reject', requireAuth, requireUploaderOrAdmin, async (req, res) => {
        try {
            const submissionId = req.params.id;
            const { reason } = req.body;

            const [submissions] = await mysqlPool.execute(
                'SELECT * FROM link_submissions WHERE id = ?',
                [submissionId]
            );

            if (submissions.length === 0) {
                return res.status(404).json({ error: 'Soumission non trouvée' });
            }

            if (submissions[0].status !== 'pending') {
                return res.status(400).json({ error: 'Cette soumission a déjà été traitée' });
            }

            await mysqlPool.execute(
                `UPDATE link_submissions SET status = 'rejected', rejection_reason = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?`,
                [reason || null, req.admin.userId, submissionId]
            );

            res.json({ message: 'Soumission rejetée' });
        } catch (error) {
            console.error('Error rejecting submission:', error);
            res.status(500).json({ error: 'Erreur lors du rejet' });
        }
    });

    /**
     * PUT /api/link-submissions/admin/bulk-approve
     * Admin: approve multiple submissions at once
     */
    router.put('/admin/bulk-approve', requireAuth, requireUploaderOrAdmin, async (req, res) => {
        try {
            const { ids } = req.body;
            if (!ids || !Array.isArray(ids) || ids.length === 0) {
                return res.status(400).json({ error: 'IDs requis' });
            }

            let approved = 0;
            let errors = 0;

            for (const id of ids) {
                try {
                    const [submissions] = await mysqlPool.execute(
                        'SELECT * FROM link_submissions WHERE id = ? AND status = ?',
                        [id, 'pending']
                    );

                    if (submissions.length === 0) {
                        errors++;
                        continue;
                    }

                    const sub = submissions[0];

                    // Add link to appropriate table
                    if (sub.media_type === 'movie') {
                        const [existing] = await mysqlPool.execute('SELECT id, links FROM films WHERE id = ?', [sub.tmdb_id]);
                        if (existing.length > 0) {
                            let currentLinks = [];
                            try { currentLinks = JSON.parse(existing[0].links || '[]'); } catch { currentLinks = []; }
                            if (!currentLinks.includes(sub.url)) currentLinks.push(sub.url);
                            await mysqlPool.execute('UPDATE films SET links = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [JSON.stringify(currentLinks), sub.tmdb_id]);
                        } else {
                            await mysqlPool.execute('INSERT INTO films (id, links) VALUES (?, ?)', [sub.tmdb_id, JSON.stringify([sub.url])]);
                        }
                    } else if (sub.media_type === 'tv' && sub.season_number !== null && sub.episode_number !== null) {
                        const [existing] = await mysqlPool.execute('SELECT id, links FROM series WHERE series_id = ? AND season_number = ? AND episode_number = ?', [sub.tmdb_id, sub.season_number, sub.episode_number]);
                        if (existing.length > 0) {
                            let currentLinks = [];
                            try { currentLinks = JSON.parse(existing[0].links || '[]'); } catch { currentLinks = []; }
                            if (!currentLinks.includes(sub.url)) currentLinks.push(sub.url);
                            await mysqlPool.execute('UPDATE series SET links = ? WHERE series_id = ? AND season_number = ? AND episode_number = ?', [JSON.stringify(currentLinks), sub.tmdb_id, sub.season_number, sub.episode_number]);
                        } else {
                            await mysqlPool.execute('INSERT INTO series (series_id, season_number, episode_number, links) VALUES (?, ?, ?, ?)', [sub.tmdb_id, sub.season_number, sub.episode_number, JSON.stringify([sub.url])]);
                        }
                    }

                    await mysqlPool.execute(
                        `UPDATE link_submissions SET status = 'approved', reviewed_by = ?, reviewed_at = NOW() WHERE id = ?`,
                        [req.admin.userId, id]
                    );
                    approved++;
                } catch (err) {
                    console.error(`Error approving submission ${id}:`, err);
                    errors++;
                }
            }

            res.json({ message: `${approved} lien(s) approuvé(s)`, approved, errors });
        } catch (error) {
            console.error('Error bulk approving:', error);
            res.status(500).json({ error: 'Erreur lors de l\'approbation en masse' });
        }
    });

    /**
     * PUT /api/link-submissions/admin/bulk-reject
     * Admin: reject multiple submissions at once
     */
    router.put('/admin/bulk-reject', requireAuth, requireUploaderOrAdmin, async (req, res) => {
        try {
            const { ids, reason } = req.body;
            if (!ids || !Array.isArray(ids) || ids.length === 0) {
                return res.status(400).json({ error: 'IDs requis' });
            }

            const placeholders = ids.map(() => '?').join(',');
            await mysqlPool.execute(
                `UPDATE link_submissions SET status = 'rejected', rejection_reason = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id IN (${placeholders}) AND status = 'pending'`,
                [reason || null, req.admin.userId, ...ids]
            );

            res.json({ message: `${ids.length} soumission(s) rejetée(s)` });
        } catch (error) {
            console.error('Error bulk rejecting:', error);
            res.status(500).json({ error: 'Erreur lors du rejet en masse' });
        }
    });

    /**
     * DELETE /api/link-submissions/admin/:id
     * Admin: permanently delete a submission
     */
    router.delete('/admin/:id', requireAuth, requireUploaderOrAdmin, async (req, res) => {
        try {
            const submissionId = req.params.id;
            await mysqlPool.execute('DELETE FROM link_submissions WHERE id = ?', [submissionId]);
            res.json({ message: 'Soumission supprimée' });
        } catch (error) {
            console.error('Error deleting submission:', error);
            res.status(500).json({ error: 'Erreur lors de la suppression' });
        }
    });

    return router;
}

module.exports = { createLinkSubmissionsRouter };
