/**
 * Historique et progression côté serveur (tables watch_history / watch_progress).
 * Montage : app.use('/api', router), dans `appReady` une fois les tables créées.
 *
 * - GET    /history/continue?profileId=&language=        → { items, complete }
 * - GET    /history/title?profileId=&type=&id=&language=     → { complete, title }
 * - DELETE /history/title/:type/:id?profileId=           → 204 (suppression définitive)
 * - GET    /history/list?profileId=&language=&status=&page=&pageSize=
 *                                                         → { items, page, pageSize, total, counts, stats, complete }
 * - GET    /history/progress?profileId=&type=&id=        → { items }
 * - POST   /history/progress { profileId, type, id, season?, episode?, position, duration } → 204
 * - DELETE /history/continue?profileId=                   → 204 (toutes les cartes)
 * - DELETE /history/continue/:type/:id?profileId=        → 204
 *
 * Comptes `oauth` et `bip39` seulement : les invités gardent leur localStorage.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

const { getAuthIfValid } = require('../middleware/auth');
const { getPool } = require('../mysqlPool');
const { createRedisRateLimitStore } = require('../utils/redisRateLimitStore');
const { ensureImported } = require('../utils/historyImport');
const {
  ALLOWED_SYNC_USER_TYPES,
  SyncPolicyError,
  ensureSafeProfileId,
  ensureSafeUserId,
  getOwnedProfile,
} = require('../utils/syncPolicy');

const router = express.Router();

const LANGUAGES = ['fr-FR', 'en-US'];
const DEFAULT_LANGUAGE = 'fr-FR';
const MEDIA_TYPES = ['movie', 'tv'];
// Bornes des colonnes : `tmdb_id INT`, `season`/`episode SMALLINT`.
const MAX_TMDB_ID = 2147483647;
const MAX_EPISODE_NUMBER = 32767;
// Onglet « Historique » du profil.
const HISTORY_STATUSES = ['in_progress', 'finished', 'not_started'];
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

// Import paresseux : routes/sync.js construit le magasin d'historique une
// seule fois par processus ; le même est réutilisé ici.
let _syncModule = null;
function getSyncModule() {
  if (!_syncModule) _syncModule = require('./sync');
  return _syncModule;
}

const historyRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  store: createRedisRateLimitStore({ prefix: 'rate-limit:history:' }),
  passOnStoreError: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Trop de requêtes sur l’historique. Réessayez dans une minute.'
  },
  keyGenerator: (req) => req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']?.split(',')[0].trim() || ipKeyGenerator(req.ip),
  validate: { xForwardedForHeader: false, ip: false }
});

function badRequest(message, code) {
  return new SyncPolicyError(message, 400, code);
}

function parseMediaType(value) {
  if (!MEDIA_TYPES.includes(value)) throw badRequest('Type invalide (movie ou tv)', 'INVALID_MEDIA_TYPE');
  return value;
}

function isPositiveInteger(value, max) {
  return Number.isSafeInteger(value) && value > 0 && value <= max;
}

// Identifiant TMDB : entier positif, en nombre (corps JSON) ou en texte
// décimal strict (query, paramètre d'URL).
function parseTmdbId(value) {
  const number = typeof value === 'string' && /^\d{1,10}$/.test(value) ? Number(value) : value;
  if (!isPositiveInteger(number, MAX_TMDB_ID)) throw badRequest('Identifiant invalide', 'INVALID_MEDIA_ID');
  return number;
}

function parseSeconds(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw badRequest(`${label} invalide`, 'INVALID_PROGRESS');
  }
  return value;
}

function isAbsent(value) {
  return value === undefined || value === null;
}

function parseLanguage(value) {
  return LANGUAGES.includes(value) ? value : DEFAULT_LANGUAGE;
}

function parseHistoryStatus(value) {
  if (!HISTORY_STATUSES.includes(value)) {
    throw badRequest('Statut invalide (in_progress, finished ou not_started)', 'INVALID_HISTORY_STATUS');
  }
  return value;
}

// Entier décimal strict de la query ; absent ou invalide → null.
function queryInteger(value) {
  return typeof value === 'string' && /^-?\d{1,9}$/.test(value) ? Number(value) : null;
}

// Page ≥ 1 (défaut 1), taille 1-50 (défaut 20, plafonnée à 50).
function parsePage(value) {
  const page = queryInteger(value);
  return page !== null && page >= 1 ? page : 1;
}

function parsePageSize(value) {
  const size = queryInteger(value);
  if (size === null || size < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(size, MAX_PAGE_SIZE);
}

/**
 * Authentifie la requête et vérifie que le profil appartient au compte.
 * @returns {Promise<{ userType: string, userId: string, profileId: string } | null>}
 *   null : non authentifié (la réponse 401 est déjà envoyée).
 */
async function resolveOwner(req, res, rawProfileId) {
  const auth = await getAuthIfValid(req);
  if (!auth || !ALLOWED_SYNC_USER_TYPES.includes(auth.userType)) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }

  const userType = auth.userType;
  const userId = ensureSafeUserId(auth.userId);
  const profileId = ensureSafeProfileId(rawProfileId);
  const userData = await getSyncModule().readUserData(userType, userId);
  getOwnedProfile(userData, profileId);
  return { userType, userId, profileId };
}

// Après un import fait ici, les marques « Déjà vu » sont relues dans le
// fichier sous le verrou de synchro (routes/sync.js).
function importOptions() {
  const { resyncProfileMarks } = getSyncModule();
  return typeof resyncProfileMarks === 'function' ? { afterImport: resyncProfileMarks } : {};
}

// Enveloppe commune : SyncPolicyError → son statut, le reste → 500.
function handle(label, handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error instanceof SyncPolicyError) {
        return res.status(error.status).json({ success: false, error: error.message, code: error.code });
      }
      console.error(`[HISTORY] ${label}:`, error && error.message ? error.message : error);
      return res.status(500).json({ error: 'History request failed' });
    }
  };
}

// GET /history/continue : rangée « Reprendre » toute prête. Importe d'abord
// les anciennes données du profil ; `complete` dit si la liste du serveur est
// fiable (import fait ou déjà fait) ou si le client doit garder la sienne.
router.get('/history/continue', historyRateLimit, handle('lecture de « Reprendre »', async (req, res) => {
  const owner = await resolveOwner(req, res, req.query.profileId);
  if (!owner) return;

  const { getHistoryStore, readProfileData, readProfileImportData } = getSyncModule();
  // Historique désactivé dans les réglages : rangée vide pour tous les
  // clients, même si une progression recopiée a fait revenir un titre.
  const profileData = await readProfileData(owner.userType, owner.userId, owner.profileId);
  if (profileData && profileData.settings_disable_history === 'true') {
    return res.status(200).json({ items: [], complete: true });
  }

  const historyStore = getHistoryStore();
  const status = await ensureImported(getPool(), historyStore, owner, readProfileImportData, importOptions());
  const items = await historyStore.listContinue(owner, parseLanguage(req.query.language));
  return res.status(200).json({ items, complete: status === 'imported' || status === 'already' });
}));

/**
 * Avant de lire le classement (onglet et fiche) : import des anciennes
 * données, puis marques « Déjà vu » recalées sur le fichier si ce worker ne
 * l'a pas encore fait. Import pas fait → données partielles, jamais gardées
 * en mémoire ; recalage raté (logué) → pas gardées non plus, retenté au
 * prochain appel.
 * @returns {Promise<{ complete: boolean, cache: boolean }>}
 */
async function prepareOverview(historyStore, owner, readProfileImportData) {
  const importStatus = await ensureImported(getPool(), historyStore, owner, readProfileImportData, importOptions());
  const complete = importStatus === 'imported' || importStatus === 'already';
  let cache = complete;
  if (complete) {
    const { ensureProfileMarks } = getSyncModule();
    if (typeof ensureProfileMarks === 'function' && !(await ensureProfileMarks(owner))) cache = false;
  }
  return { complete, cache };
}

// GET /history/title : fiche film ou série (MovieDetails, TVDetails), tirée
// du même classement que l'onglet « Historique ». Titre absent → null.
router.get('/history/title', historyRateLimit, handle('lecture de la fiche', async (req, res) => {
  const owner = await resolveOwner(req, res, req.query.profileId);
  if (!owner) return;

  const mediaType = parseMediaType(req.query.type);
  const tmdbId = parseTmdbId(req.query.id);
  const language = parseLanguage(req.query.language);

  const { getHistoryStore, readProfileData, readProfileImportData } = getSyncModule();
  const profileData = await readProfileData(owner.userType, owner.userId, owner.profileId);
  if (profileData && profileData.settings_disable_history === 'true') {
    return res.status(200).json({ complete: true, title: null });
  }

  const historyStore = getHistoryStore();
  const { complete, cache } = await prepareOverview(historyStore, owner, readProfileImportData);
  const title = await historyStore.getTitle(owner, { mediaType, tmdbId, language, cache });
  return res.status(200).json({ complete, title });
}));

// DELETE /history/title/:type/:id : « Supprimer de l'historique », définitif
// (fichier du profil, tables de l'historique, temps du lecteur web), sous le
// verrou de synchro du profil. Différent de DELETE /history/continue/:type/:id,
// qui ne fait que masquer la carte « Reprendre ».
router.delete('/history/title/:type/:id', historyRateLimit, handle('suppression d’un titre', async (req, res) => {
  const owner = await resolveOwner(req, res, req.query.profileId);
  if (!owner) return;

  const mediaType = parseMediaType(req.params.type);
  const tmdbId = parseTmdbId(req.params.id);
  await getSyncModule().deleteTitleFromProfile(owner, mediaType, tmdbId);
  return res.status(204).end();
}));

// GET /history/list : onglet « Historique » du profil, une page de titres d'un
// statut plus les compteurs et statistiques. Même import et même réglage
// « historique désactivé » que GET /history/continue.
router.get('/history/list', historyRateLimit, handle('lecture de l’historique', async (req, res) => {
  const owner = await resolveOwner(req, res, req.query.profileId);
  if (!owner) return;

  const status = parseHistoryStatus(req.query.status);
  const language = parseLanguage(req.query.language);
  const page = parsePage(req.query.page);
  const pageSize = parsePageSize(req.query.pageSize);

  const { getHistoryStore, readProfileData, readProfileImportData } = getSyncModule();
  const profileData = await readProfileData(owner.userType, owner.userId, owner.profileId);
  if (profileData && profileData.settings_disable_history === 'true') {
    return res.status(200).json({
      items: [],
      page,
      pageSize,
      total: 0,
      counts: { inProgress: 0, finished: 0, notStarted: 0 },
      stats: { watchedSeconds: 0, trackedSeconds: 0, moviesFinished: 0, episodesFinished: 0 },
      complete: true,
    });
  }

  const historyStore = getHistoryStore();
  const { complete, cache } = await prepareOverview(historyStore, owner, readProfileImportData);
  const result = await historyStore.listHistory(owner, { status, language, page, pageSize, cache });
  return res.status(200).json({
    items: result.items,
    page,
    pageSize,
    total: result.total,
    counts: result.counts,
    stats: result.stats,
    complete,
  });
}));

// GET /history/progress : positions de chaque épisode (ou du film) d'un titre.
router.get('/history/progress', historyRateLimit, handle('lecture de la progression', async (req, res) => {
  const owner = await resolveOwner(req, res, req.query.profileId);
  if (!owner) return;

  const mediaType = parseMediaType(req.query.type);
  const tmdbId = parseTmdbId(req.query.id);
  const items = await getSyncModule().getHistoryStore().listProgress(owner, mediaType, tmdbId);
  return res.status(200).json({ items });
}));

// POST /history/progress : position envoyée directement par un client.
router.post('/history/progress', historyRateLimit, handle('écriture de la progression', async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const owner = await resolveOwner(req, res, body.profileId);
  if (!owner) return;

  const mediaType = parseMediaType(body.type);
  const tmdbId = parseTmdbId(body.id);
  let season = 0;
  let episode = 0;
  if (mediaType === 'tv') {
    if (!isPositiveInteger(body.season, MAX_EPISODE_NUMBER) || !isPositiveInteger(body.episode, MAX_EPISODE_NUMBER)) {
      throw badRequest('Saison et épisode requis (entiers positifs)', 'INVALID_EPISODE');
    }
    season = body.season;
    episode = body.episode;
  } else if (!isAbsent(body.season) || !isAbsent(body.episode)) {
    throw badRequest('Pas de saison ni d’épisode pour un film', 'INVALID_EPISODE');
  }
  const position = parseSeconds(body.position, 'Position');
  const duration = parseSeconds(body.duration, 'Durée');

  await getSyncModule().getHistoryStore().recordProgress(owner, {
    mediaType, tmdbId, season, episode, position, duration, updatedAt: new Date(),
  });
  return res.status(204).end();
}));

// DELETE /history/continue : « Tout retirer », toutes les cartes du profil en
// une seule requête (une par titre buterait sur la limite de débit). Pas de
// conflit avec la route suivante : Express exige ici le chemin exact.
router.delete('/history/continue', historyRateLimit, handle('vidage de « Reprendre »', async (req, res) => {
  const owner = await resolveOwner(req, res, req.query.profileId);
  if (!owner) return;

  await getSyncModule().getHistoryStore().hideAll(owner);
  return res.status(204).end();
}));

// DELETE /history/continue/:type/:id : retire le titre de « Reprendre ».
router.delete('/history/continue/:type/:id', historyRateLimit, handle('retrait de « Reprendre »', async (req, res) => {
  const owner = await resolveOwner(req, res, req.query.profileId);
  if (!owner) return;

  const mediaType = parseMediaType(req.params.type);
  const tmdbId = parseTmdbId(req.params.id);
  await getSyncModule().getHistoryStore().hide(owner, mediaType, tmdbId);
  return res.status(204).end();
}));

module.exports = router;
