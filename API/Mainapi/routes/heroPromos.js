'use strict';

/**
 * Promos du grand carrousel. Montage : app.use('/api', router).
 *
 * - GET  /hero-promos                   → réglage des carrousels + promos en service (public, 60 s de cache)
 * - GET  /hero-promos/:id/go            → compte le clic puis redirige vers le lien de la promo
 *                                         (comme /api/go pour les pubs : stats côté serveur)
 * - POST /hero-promos/:id/click         → +1 clic du jour, pour un lien vers une page du site
 * - GET  /hero-promos/images/:file      → image envoyée depuis l'admin (immuable)
 * - GET/PUT /admin/hero-promos          → réglages + clics par promo
 * - POST /admin/hero-promos/images      → envoi d'une image { mimeType, dataBase64 }
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

const { getPool } = require('../mysqlPool');
const { isAdmin } = require('../middleware/auth');
const { createRedisRateLimitStore } = require('../utils/redisRateLimitStore');
const { parseUserAgent } = require('../utils/monetizationPicker');
const {
  HERO_PROMO_IMAGE_ERROR_CODE,
  HERO_PROMO_SETTINGS_ERROR_CODE,
  PROMO_ID_PATTERN,
  buildPublicHeroPromoConfig,
  buildPublicHeroPromos,
  findHeroPromoForClick,
  loadHeroPromoSettings,
  parseImageUpload,
  pruneHeroPromoImages,
  readHeroPromoClickStats,
  readHeroPromoImage,
  recordHeroPromoClick,
  saveHeroPromoImage,
  saveHeroPromoSettings,
  validateSettingsInput
} = require('../utils/heroPromoSettings');

const router = express.Router();

const IMAGE_FILE_PATTERN = /^([a-f0-9]{16})\.(webp|png|jpg)$/;
const INTERNAL_LINK_PATTERN = /^\/(?!\/)/;
const REDIRECT_CACHE_CONTROL = 'no-store, no-cache, must-revalidate, private';
const ROBOTS_HEADER = 'noindex, nofollow';
// Préchargement : Chrome (Sec-Purpose), anciens navigateurs (Purpose),
// Firefox (X-Moz) et vignettes de Safari (X-Purpose: preview).
const PREFETCH_HEADERS = ['sec-purpose', 'purpose', 'x-purpose', 'x-moz'];
const PREFETCH_PATTERN = /prefetch|preview/i;
// Clics comptés par IP : 20 par tranche de 10 minutes et par worker. Au-delà,
// la redirection marche toujours, le clic n'est simplement plus compté.
const GO_COUNT_MAX = 20;
const GO_COUNT_WINDOW_MS = 10 * 60 * 1000;
const GO_COUNT_MAX_ENTRIES = 100000;

const GONE_PAGE_HTML = '<!doctype html><html lang="fr"><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width, initial-scale=1">'
  + '<meta name="robots" content="noindex, nofollow"><title>Movix</title>'
  + '<style>html,body{margin:0;height:100%;background:#0a0a0a;color:#a3a3a3;'
  + 'font:16px/1.5 system-ui,sans-serif}body{display:flex;align-items:center;'
  + 'justify-content:center;padding:16px;box-sizing:border-box;text-align:center}</style>'
  + '</head><body><p>Cette promo n’est plus disponible.</p></body></html>';

function readHeader(req, name) {
  const value = req.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function clientIpKey(req) {
  return req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']?.split(',')[0].trim() || ipKeyGenerator(req.ip);
}

function createLimiter(prefix, max, windowMs) {
  return rateLimit({
    windowMs,
    max,
    store: createRedisRateLimitStore({ prefix: `rate-limit:hero-promos:${prefix}:` }),
    passOnStoreError: true,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Trop de requêtes. Réessayez dans un instant.', code: 'RATE_LIMITED' },
    keyGenerator: clientIpKey,
    validate: { xForwardedForHeader: false, ip: false }
  });
}

const clickLimiter = createLimiter('click', 30, 10 * 60 * 1000);
const uploadLimiter = createLimiter('upload', 30, 10 * 60 * 1000);

const goCounts = new Map();
let lastGoSweepAt = 0;

// Vrai tant que cette IP n'a pas dépassé son quota de clics comptés.
function takeGoCount(ip, nowMs = Date.now()) {
  if (nowMs - lastGoSweepAt >= GO_COUNT_WINDOW_MS || goCounts.size >= GO_COUNT_MAX_ENTRIES) {
    for (const [key, entry] of goCounts) {
      if (entry.resetAt <= nowMs) goCounts.delete(key);
    }
    // Rafale d'IP différentes : on repart de zéro plutôt que de grossir.
    if (goCounts.size >= GO_COUNT_MAX_ENTRIES) goCounts.clear();
    lastGoSweepAt = nowMs;
  }
  const entry = goCounts.get(ip);
  if (!entry || entry.resetAt <= nowMs) {
    goCounts.set(ip, { count: 1, resetAt: nowMs + GO_COUNT_WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= GO_COUNT_MAX;
}

const setNoStore = (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  return next();
};

function fail(res, status, code, error) {
  return res.status(status).json({ success: false, code, error });
}

function requirePool(res) {
  const pool = getPool();
  if (!pool) {
    fail(res, 503, 'DB_UNAVAILABLE', 'Base de données indisponible, réessayez plus tard');
    return null;
  }
  return pool;
}

function handle(label, handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      console.error(`[Promos carrousel] ${label} :`, error?.message || error);
      if (!res.headersSent) fail(res, 500, 'SERVER_ERROR', 'Erreur des promos du carrousel, réessayez plus tard');
    }
  };
}

// ---------------------------------------------------------------------------
// Routes publiques
// ---------------------------------------------------------------------------

// Base indisponible : aucune promo plutôt qu'une erreur, le carrousel
// s'affiche alors sans promo.
router.get('/hero-promos', handle('liste publique', async (req, res) => {
  const pool = getPool();
  let config = buildPublicHeroPromoConfig(null);
  if (pool) {
    try {
      const { settings } = await loadHeroPromoSettings(pool);
      config = buildPublicHeroPromoConfig(settings);
    } catch {
      // Valeurs par défaut, sans promo.
    }
  }
  res.set('Cache-Control', 'public, max-age=60');
  return res.json({ success: true, ...config });
}));

// Chaque clic est réévalué : rien en cache, ni navigateur ni Cloudflare.
function sendRedirect(res, location) {
  res.set('Cache-Control', REDIRECT_CACHE_CONTROL);
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('X-Robots-Tag', ROBOTS_HEADER);
  res.set('Location', location);
  return res.status(302).end();
}

function sendGone(res) {
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', ROBOTS_HEADER);
  res.set('Content-Type', 'text/html; charset=utf-8');
  return res.status(404).send(GONE_PAGE_HTML);
}

// Lien vers une page du site : retour sur le site d'où vient le visiteur
// (en-tête Referer), sinon sur FRONTEND_BASE_URL.
function resolveLocation(req, linkUrl) {
  if (!INTERNAL_LINK_PATTERN.test(linkUrl)) return linkUrl;
  let base = '';
  try {
    base = new URL(readHeader(req, 'referer')).origin;
  } catch {
    base = '';
  }
  if (!base || base === 'null') base = String(process.env.FRONTEND_BASE_URL || '').trim().replace(/\/+$/, '');
  return base ? `${base}${linkUrl}` : null;
}

// Comme /api/go pour les pubs : le site ouvre cette adresse, le clic est
// compté ici puis le navigateur part vers le lien de la promo. Préchargement,
// HEAD, robots et rafales d'une même IP ne comptent pas.
router.get('/hero-promos/:id/go', async (req, res) => {
  try {
    const id = String(req.params.id || '');
    const pool = getPool();
    if (!PROMO_ID_PATTERN.test(id) || !pool) return sendGone(res);

    const { settings } = await loadHeroPromoSettings(pool);
    const promo = findHeroPromoForClick(settings, id);
    const location = promo ? resolveLocation(req, promo.linkUrl) : null;
    if (!promo || !location) return sendGone(res);

    const userAgent = readHeader(req, 'user-agent');
    const isPrefetch = PREFETCH_HEADERS.some((name) => PREFETCH_PATTERN.test(readHeader(req, name)));
    const countable = promo.countable
      && req.method === 'GET'
      && !isPrefetch
      && Boolean(userAgent)
      && !parseUserAgent(userAgent).isBot
      && takeGoCount(String(clientIpKey(req)));
    if (countable) {
      // La redirection n'attend pas la base : un clic perdu vaut mieux
      // qu'un visiteur bloqué.
      recordHeroPromoClick(pool, id).catch((error) => {
        console.warn('[Promos carrousel] Clic non compté :', error?.message || error);
      });
    }
    return sendRedirect(res, location);
  } catch (error) {
    console.error('[Promos carrousel] Redirection impossible :', error?.message || error);
    if (res.headersSent) return undefined;
    return sendGone(res);
  }
});

router.post('/hero-promos/:id/click', setNoStore, clickLimiter, handle('clic', async (req, res) => {
  const id = String(req.params.id || '');
  if (!PROMO_ID_PATTERN.test(id)) return res.status(204).end();
  const pool = getPool();
  if (!pool) return res.status(204).end();
  // Seules les promos en service comptent : pas de ligne pour un identifiant inventé.
  const { settings } = await loadHeroPromoSettings(pool);
  if (buildPublicHeroPromos(settings).some((promo) => promo.id === id)) {
    await recordHeroPromoClick(pool, id);
  }
  return res.status(204).end();
}));

router.get('/hero-promos/images/:file', handle('image', async (req, res) => {
  const match = IMAGE_FILE_PATTERN.exec(String(req.params.file || ''));
  if (!match) return res.status(404).end();
  const pool = requirePool(res);
  if (!pool) return undefined;
  const image = await readHeroPromoImage(pool, match[1]);
  if (!image) return res.status(404).end();
  res.set({
    'Content-Type': image.mimeType,
    'Content-Length': String(image.data.length),
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Cross-Origin-Resource-Policy': 'cross-origin'
  });
  return res.end(image.data);
}));

// ---------------------------------------------------------------------------
// Routes admin
// ---------------------------------------------------------------------------

async function readStatsSafely(pool) {
  try {
    return await readHeroPromoClickStats(pool);
  } catch (error) {
    console.warn('[Promos carrousel] Clics illisibles :', error?.message || error);
    return null;
  }
}

router.get('/admin/hero-promos', setNoStore, isAdmin, handle('lecture admin', async (req, res) => {
  const pool = requirePool(res);
  if (!pool) return;
  const { settings, updatedAt, updatedBy } = await loadHeroPromoSettings(pool, { fresh: true });
  const stats = await readStatsSafely(pool);
  return res.json({ success: true, settings, updatedAt, updatedBy, stats });
}));

router.put('/admin/hero-promos', setNoStore, isAdmin, async (req, res) => {
  try {
    const pool = requirePool(res);
    if (!pool) return undefined;
    const current = await loadHeroPromoSettings(pool, { fresh: true });
    const settings = validateSettingsInput(req.body?.settings, current.settings);
    const saved = await saveHeroPromoSettings(pool, settings, req.admin?.userId || null);
    try {
      await pruneHeroPromoImages(pool, saved.settings);
    } catch (error) {
      console.warn('[Promos carrousel] Nettoyage des images impossible :', error?.message || error);
    }
    const stats = await readStatsSafely(pool);
    return res.json({ success: true, settings: saved.settings, updatedAt: saved.updatedAt, updatedBy: saved.updatedBy, stats });
  } catch (error) {
    if (error?.code === HERO_PROMO_SETTINGS_ERROR_CODE) return fail(res, 400, error.code, error.message);
    console.error('[Promos carrousel] Enregistrement des réglages impossible :', error?.message || error);
    return fail(res, 500, 'SERVER_ERROR', 'Impossible d’enregistrer les promos du carrousel');
  }
});

router.post('/admin/hero-promos/images', setNoStore, isAdmin, uploadLimiter, async (req, res) => {
  try {
    const pool = requirePool(res);
    if (!pool) return undefined;
    const upload = parseImageUpload(req.body);
    const saved = await saveHeroPromoImage(pool, upload, req.admin?.userId || null);
    return res.json({ success: true, path: saved.path, byteSize: saved.byteSize });
  } catch (error) {
    if (error?.code === HERO_PROMO_IMAGE_ERROR_CODE) return fail(res, 400, error.code, error.message);
    console.error('[Promos carrousel] Envoi d’image impossible :', error?.message || error);
    return fail(res, 500, 'SERVER_ERROR', 'Impossible d’enregistrer l’image');
  }
});

module.exports = { router };
