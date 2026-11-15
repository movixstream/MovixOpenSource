'use strict';

const crypto = require('node:crypto');
const express = require('express');

const { getPool } = require('../mysqlPool');
const { isAdmin } = require('../middleware/auth');
const { redis } = require('../config/redis');
const {
  MAX_STATS_SPAN_DAYS,
  createMonetizationStats,
  isDateKey,
  shiftDateKey,
  countDaysBetween
} = require('../utils/monetizationStats');
const {
  PLACEMENT_IDS,
  MONETIZATION_ERROR_CODES,
  getDefaultMonetizationSettings,
  loadMonetizationSettings,
  saveMonetizationSettings,
  validateSettingsInput,
  buildPublicConfig
} = require('../utils/monetizationSettings');
const {
  parseUserAgent,
  getParisClock,
  normalizeCountry,
  expandUrlMacros,
  rankAdsForOpening,
  simulateOpenings
} = require('../utils/monetizationPicker');

// Pubs pilotées depuis l'admin. Le site ouvre /api/go/<emplacement> : la route
// choisit la pub et renvoie une 302, c'est le navigateur du visiteur qui va
// chez la régie (vraie IP, vrai User-Agent). Aucune URL publique ne contient
// « ad », « ads » ni « pub » : les listes de blocage filtrent ces motifs.
//
// Charge Redis : réglages, compteur de séquence et limite par IP restent dans
// la mémoire du worker ; toutes les 10 s, les stats partent dans MySQL en une
// requête et les plafonds globaux dans Redis en un pipeline. Seul un geste à
// plusieurs fenêtres en portée `global` appelle Redis pendant le clic.

const router = express.Router();

// Une instance par worker, créée au chargement du module. Le pool MySQL est
// demandé à chaque envoi : il n'est pas encore prêt à ce moment-là.
const stats = createMonetizationStats({ redis, getPool });

const VISITOR_COOKIE = 'mvx_go';
const VISITOR_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const VISITOR_COOKIE_ATTRIBUTES = `Max-Age=${VISITOR_COOKIE_MAX_AGE_SECONDS}; Path=/api/go; HttpOnly; Secure; SameSite=Lax`;
const VISITOR_COOKIE_MAX_LENGTH = 4096;
const VISITOR_ID_PATTERN = /^[0-9a-f]{16}$/;
const AD_ID_PATTERN = /^[a-z0-9]{6,16}$/;
const GESTURE_PATTERN = /^[a-z0-9]{8,32}$/;
const LANG_PATTERN = /^[a-z]{2}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const DEVICES = new Set(['mobile', 'tablet', 'desktop']);
const OS_IDS = new Set(['android', 'ios', 'windows', 'mac', 'linux', 'other']);
// Aperçu admin sans système choisi : le plus courant pour l'appareil.
const DEFAULT_OS_BY_DEVICE = Object.freeze({ desktop: 'windows', mobile: 'android', tablet: 'android' });
const MAX_WINDOWS = 3;
const MAX_SEQUENCE_COUNTER = 1e12;
const IP_LIMIT_MAX = 30;
const IP_LIMIT_WINDOW_MS = 60 * 1000;
const IP_LIMIT_MAX_ENTRIES = 100000;
const DEFAULT_PREVIEW_COUNT = 12;
const MAX_PREVIEW_COUNT = 30;
const DEFAULT_STATS_DAYS = 30;
const MAX_STATS_DAYS = 60;

const REDIRECT_CACHE_CONTROL = 'no-store, no-cache, must-revalidate, private';
const ROBOTS_HEADER = 'noindex, nofollow';
// Préchargement : Chrome (Sec-Purpose), anciens navigateurs (Purpose),
// Firefox (X-Moz) et vignettes de Safari (X-Purpose: preview).
const PREFETCH_HEADERS = ['sec-purpose', 'purpose', 'x-purpose', 'x-moz'];
const PREFETCH_PATTERN = /prefetch|preview/i;

const CLOSE_PAGE_HTML = '<!doctype html><html lang="fr"><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width, initial-scale=1">'
  + '<meta name="robots" content="noindex, nofollow"><title>Movix</title>'
  + '<style>html,body{margin:0;height:100%;background:#0a0a0a;color:#a3a3a3;'
  + 'font:16px/1.5 system-ui,sans-serif}body{display:flex;align-items:center;'
  + 'justify-content:center;padding:16px;box-sizing:border-box;text-align:center}</style>'
  + '</head><body><p>Tu peux fermer cet onglet.</p><script>window.close()</script></body></html>';

const setNoStore = (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  return next();
};

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readHeader(req, name) {
  const value = req.headers?.[name];
  return typeof value === 'string' ? value.trim() : '';
}

function readQuery(query, key) {
  const value = query?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

// Même ordre que les autres routes : Cloudflare, puis le premier proxy.
function getClientIp(req) {
  return readHeader(req, 'cf-connecting-ip')
    || readHeader(req, 'x-forwarded-for').split(',')[0].trim()
    || req.ip
    || 'inconnue';
}

function isPrefetch(req) {
  return PREFETCH_HEADERS.some((name) => PREFETCH_PATTERN.test(readHeader(req, name)));
}

// ---------------------------------------------------------------------------
// Limite par IP : 30 ouvertures par minute, en mémoire du worker.
// ---------------------------------------------------------------------------

const ipOpenings = new Map();
let lastIpSweepAt = 0;

function sweepIpOpenings(nowMs) {
  for (const [ip, entry] of ipOpenings) {
    if (entry.resetAt <= nowMs) ipOpenings.delete(ip);
  }
  // Rafale d'IP différentes : on repart de zéro plutôt que de grossir.
  if (ipOpenings.size >= IP_LIMIT_MAX_ENTRIES) ipOpenings.clear();
  lastIpSweepAt = nowMs;
}

function isOverIpLimit(ip, nowMs) {
  if (nowMs - lastIpSweepAt >= IP_LIMIT_WINDOW_MS || ipOpenings.size >= IP_LIMIT_MAX_ENTRIES) {
    sweepIpOpenings(nowMs);
  }
  const entry = ipOpenings.get(ip);
  if (!entry || entry.resetAt <= nowMs) {
    ipOpenings.set(ip, { count: 1, resetAt: nowMs + IP_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > IP_LIMIT_MAX;
}

// ---------------------------------------------------------------------------
// Cookie visiteur mvx_go : identifiant aléatoire, cran du cycle par
// emplacement, ouvertures du jour par pub. Aucun suivi nominatif.
// ---------------------------------------------------------------------------

function readCookie(header, name) {
  if (typeof header !== 'string' || !header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

function decodeVisitorCookie(raw) {
  if (!raw || raw.length > VISITOR_COOKIE_MAX_LENGTH || !BASE64URL_PATTERN.test(raw)) return {};
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isCounter(value) {
  return Number.isSafeInteger(value) && value >= 0 && value < MAX_SEQUENCE_COUNTER;
}

// Cookie illisible ou falsifié : on garde ce qui est valable, le reste repart
// de zéro. `c` est remis à zéro quand le jour (Paris) a changé.
function readVisitorState(req, dateKey) {
  const source = decodeVisitorCookie(readCookie(req.headers?.cookie, VISITOR_COOKIE));
  const storedSequence = isPlainObject(source.s) ? source.s : {};
  const sequence = {};
  for (const placement of PLACEMENT_IDS) {
    sequence[placement] = isCounter(storedSequence[placement]) ? storedSequence[placement] : 0;
  }

  const counts = {};
  if (source.d === dateKey && isPlainObject(source.c)) {
    for (const [id, value] of Object.entries(source.c)) {
      if (AD_ID_PATTERN.test(id) && Number.isSafeInteger(value) && value > 0) counts[id] = value;
    }
  }

  // Dernier geste à plusieurs fenêtres : [emplacement, geste, cran de départ].
  const gesture = Array.isArray(source.g)
    && PLACEMENT_IDS.includes(source.g[0])
    && typeof source.g[1] === 'string'
    && GESTURE_PATTERN.test(source.g[1])
    && isCounter(source.g[2])
    ? source.g
    : null;

  return {
    v: typeof source.v === 'string' && VISITOR_ID_PATTERN.test(source.v)
      ? source.v
      : crypto.randomBytes(8).toString('hex'),
    s: sequence,
    d: dateKey,
    c: counts,
    g: gesture
  };
}

// Seules les pubs encore listées gardent un compteur : le cookie reste petit.
function buildVisitorCookie(visitor, settings) {
  const knownIds = new Set(settings.ads.map((ad) => ad.id));
  const counts = {};
  for (const [id, value] of Object.entries(visitor.c)) {
    if (knownIds.has(id)) counts[id] = value;
  }
  const payload = { v: visitor.v, s: visitor.s, d: visitor.d, c: counts };
  if (visitor.g) payload.g = visitor.g;
  const value = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${VISITOR_COOKIE}=${value}; ${VISITOR_COOKIE_ATTRIBUTES}`;
}

// ---------------------------------------------------------------------------
// Paramètres de /api/go : valeurs invalides ignorées, jamais d'erreur.
// ---------------------------------------------------------------------------

function parseGoQuery(query) {
  const gesture = GESTURE_PATTERN.test(readQuery(query, 'g')) ? readQuery(query, 'g') : null;
  const rawWindows = readQuery(query, 'n');
  const rawIndex = readQuery(query, 'w');
  let windows = /^[1-3]$/.test(rawWindows) ? Number(rawWindows) : 1;
  let index = /^[0-2]$/.test(rawIndex) ? Number(rawIndex) : 0;
  if (index >= windows) index = 0;
  // Sans identifiant de geste, les fenêtres ne peuvent pas se coordonner :
  // chacune est traitée comme un clic à une fenêtre.
  if (!gesture) {
    windows = 1;
    index = 0;
  }
  const lang = readQuery(query, 'lang').toLowerCase();
  const device = readQuery(query, 'd').toLowerCase();
  return {
    gesture,
    windows: Math.min(windows, MAX_WINDOWS),
    index,
    sfw: readQuery(query, 'sfw') === '1',
    device: DEVICES.has(device) ? device : null,
    lang: LANG_PATTERN.test(lang) ? lang : ''
  };
}

// Le site envoie `d=mobile` (téléphone ou tablette, vu au tactile) ou
// `d=desktop`. iPadOS se présente comme un Mac : tactile + « ordinateur »
// dans le User-Agent = tablette iOS.
function resolveDevice(siteDevice, agent) {
  if (siteDevice === 'desktop') return { device: 'desktop', os: agent.os };
  if (siteDevice === 'mobile' || siteDevice === 'tablet') {
    if (agent.device !== 'desktop') return { device: agent.device, os: agent.os };
    return { device: 'tablet', os: agent.os === 'mac' ? 'ios' : agent.os };
  }
  return { device: agent.device, os: agent.os };
}

// Cran de départ du cycle `sequence` pour ce geste. Toutes les fenêtres d'un
// geste partent du même cran (la fenêtre `w` prend la `w`-ième pub distincte),
// et le cycle avance d'un seul cran par geste : le navigateur bloque souvent
// les fenêtres suivantes, la 1re doit donc parcourir tout le cycle.
async function resolveSequenceBase({ placementSettings, placement, visitor, gesture, windows }) {
  if (placementSettings.rotation !== 'sequence') return 0;

  if (placementSettings.sequenceScope === 'visitor') {
    const remembered = windows > 1 && gesture && visitor.g
      && visitor.g[0] === placement && visitor.g[1] === gesture
      ? visitor.g[2]
      : null;
    const base = remembered ?? visitor.s[placement];
    const next = base + 1;
    visitor.s[placement] = next < MAX_SEQUENCE_COUNTER ? next : 0;
    // Une fenêtre qui arrive avec le cookie déjà réécrit retrouve le cran du geste.
    visitor.g = windows > 1 && gesture ? [placement, gesture, base] : null;
    return base;
  }

  if (windows > 1 && gesture) return stats.nextGestureBase({ placement, gesture, windows });
  return stats.nextLocalBase(placement);
}

// ---------------------------------------------------------------------------
// Part d'une IP dans les plafonds `globalPerDay` : 20 ouvertures par jour et
// par worker au plus. Au-delà, l'ouverture compte dans les stats mais plus
// dans le plafond : un seul visiteur ne peut pas couper une pub pour tout le
// monde. En mémoire, remis à zéro à chaque changement de jour (Paris).
// ---------------------------------------------------------------------------

const IP_CAP_SHARE_PER_DAY = 20;
const ipCapShares = new Map();
let ipCapSharesDay = '';

function takeIpCapShare(ip, dateKey) {
  if (dateKey !== ipCapSharesDay || ipCapShares.size >= IP_LIMIT_MAX_ENTRIES) {
    ipCapShares.clear();
    ipCapSharesDay = dateKey;
  }
  const used = (ipCapShares.get(ip) || 0) + 1;
  ipCapShares.set(ip, used);
  return used <= IP_CAP_SHARE_PER_DAY;
}

function toLocation(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

function sendNoContent(res) {
  res.set('Cache-Control', REDIRECT_CACHE_CONTROL);
  res.set('X-Robots-Tag', ROBOTS_HEADER);
  return res.status(204).end();
}

function sendClosePage(res) {
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', ROBOTS_HEADER);
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(CLOSE_PAGE_HTML);
}

// Chaque clic est réévalué : rien en cache, ni navigateur ni Cloudflare.
// La régie doit voir l'ouverture comme un lien normal du site : même règle de
// référent que la page (celle des navigateurs par défaut), donc le domaine
// Movix d'où vient le visiteur. Le navigateur garde le référent de la page
// d'origine à travers la redirection, pas l'adresse de l'API.
function sendRedirect(res, location) {
  res.set('Cache-Control', REDIRECT_CACHE_CONTROL);
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('X-Robots-Tag', ROBOTS_HEADER);
  res.set('Location', location);
  return res.status(302).end();
}

async function handleGo(req, res) {
  // 1. Préchargement, HEAD et robots : rien compté, le cycle ne bouge pas.
  const userAgent = readHeader(req, 'user-agent');
  const agent = parseUserAgent(userAgent);
  if (req.method === 'HEAD' || isPrefetch(req) || !userAgent || agent.isBot) {
    return sendNoContent(res);
  }

  // 2. Limite par IP.
  const clientIp = getClientIp(req);
  if (isOverIpLimit(clientIp, Date.now())) return sendClosePage(res);

  // 3. Emplacement inconnu, pubs coupées ou emplacement coupé.
  const placement = String(req.params?.placement || '');
  if (!PLACEMENT_IDS.includes(placement)) return sendClosePage(res);

  let settings;
  try {
    ({ settings } = await loadMonetizationSettings(getPool()));
  } catch (error) {
    console.error('[Pubs] Réglages illisibles, ouverture annulée :', error?.message || error);
    return sendClosePage(res);
  }
  const placementSettings = settings.placements?.[placement];
  if (!settings.enabled || !placementSettings?.enabled) return sendClosePage(res);

  // Le site peut garder quelques minutes une config qui ouvrait plus de
  // fenêtres : celles en trop se ferment.
  const query = parseGoQuery(req.query);
  const windows = Math.min(query.windows, placementSettings.windowsPerClick);
  if (query.index >= windows) return sendClosePage(res);

  // 4. Choix de la pub, avec le même classement que l'aperçu de l'admin.
  const now = new Date();
  const { dateKey } = getParisClock(now);
  const visitor = readVisitorState(req, dateKey);
  const { device, os } = resolveDevice(query.device, agent);
  const profile = { sfw: query.sfw, device, os, country: normalizeCountry(req.headers?.['cf-ipcountry']) };
  const base = await resolveSequenceBase({
    placementSettings,
    placement,
    visitor,
    gesture: query.gesture,
    windows
  });
  const ranked = rankAdsForOpening({
    settings,
    placement,
    profile,
    now,
    base,
    seed: query.gesture || crypto.randomBytes(8).toString('hex'),
    visitorCounts: visitor.c,
    globalCounts: stats.getGlobalCounts(dateKey)
  });
  const ad = ranked[query.index] || null;
  const location = ad
    ? toLocation(expandUrlMacros(ad.url, {
      placement,
      country: profile.country,
      device,
      os,
      lang: query.lang,
      visitor: visitor.v,
      rand: crypto.randomBytes(4).toString('hex'),
      ts: Date.now()
    }))
    : null;

  if (!ad || !location) {
    if (ad) console.warn('[Pubs] URL de pub illisible après les macros :', ad.id);
    res.set('Set-Cookie', buildVisitorCookie(visitor, settings));
    // Une seule stat « none » par geste ; la fenêtre en trop d'un geste (pas
    // assez de pubs différentes) se ferme sans compter.
    if (ranked.length === 0 && query.index === 0) {
      stats.recordOpening({ adId: null, placement });
      const fallback = toLocation(placementSettings.fallbackUrl);
      if (fallback) return sendRedirect(res, fallback);
    }
    return sendClosePage(res);
  }

  // 5. Redirection vers la pub, cookie et stat mis à jour. Les fenêtres d'un
  // même geste partent du même cookie : la dernière réécrite l'emporte, le
  // plafond par visiteur peut donc être dépassé d'une ou deux ouvertures.
  visitor.c[ad.id] = (visitor.c[ad.id] || 0) + 1;
  stats.recordOpening({ adId: ad.id, placement, countsTowardCap: takeIpCapShare(clientIp, dateKey) });
  res.set('Set-Cookie', buildVisitorCookie(visitor, settings));
  return sendRedirect(res, location);
}

router.get('/go/:placement', async (req, res) => {
  try {
    return await handleGo(req, res);
  } catch (error) {
    console.error('[Pubs] Ouverture impossible :', error?.message || error);
    if (res.headersSent) return undefined;
    return sendClosePage(res);
  }
});

router.get('/go-settings', async (req, res) => {
  try {
    const { settings, updatedAt } = await loadMonetizationSettings(getPool());
    res.set('Cache-Control', 'public, max-age=60');
    return res.json({ success: true, ...buildPublicConfig(settings), updatedAt });
  } catch (error) {
    // Base en panne : 503 sans cache. Le site garde sa dernière config au lieu
    // de couper les pubs pour tout le monde pendant plusieurs minutes.
    console.error('[Pubs] Config publique illisible :', error?.message || error);
    res.set('Cache-Control', 'no-store');
    return res.status(503).json({ success: false, error: 'Config des pubs indisponible' });
  }
});

// ---------------------------------------------------------------------------
// Routes admin
// ---------------------------------------------------------------------------

function normalizeBoundedInteger(value, fallback, max) {
  const number = Math.floor(Number(value));
  if (value === undefined || value === null || value === '' || !Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, 1), max);
}

function normalizePreviewProfile(profile) {
  const source = isPlainObject(profile) ? profile : {};
  const device = DEVICES.has(source.device) ? source.device : 'desktop';
  return {
    sfw: source.sfw === true,
    device,
    os: OS_IDS.has(source.os) ? source.os : DEFAULT_OS_BY_DEVICE[device],
    country: normalizeCountry(source.country)
  };
}

router.get('/admin/monetization', setNoStore, isAdmin, async (req, res) => {
  try {
    const { settings, updatedAt, updatedBy } = await loadMonetizationSettings(getPool(), { fresh: true });
    return res.json({ success: true, settings, updatedAt, updatedBy });
  } catch (error) {
    console.error('[Pubs] Lecture admin des réglages impossible :', error);
    return res.status(500).json({
      success: false,
      error: 'Impossible de récupérer les réglages des publicités'
    });
  }
});

router.put('/admin/monetization', setNoStore, isAdmin, async (req, res) => {
  try {
    const pool = getPool();
    const current = await loadMonetizationSettings(pool, { fresh: true });
    const settings = validateSettingsInput(req.body?.settings, current.settings);
    const saved = await saveMonetizationSettings(pool, settings, req.admin?.userId || null);
    return res.json({
      success: true,
      settings: saved.settings,
      updatedAt: saved.updatedAt,
      updatedBy: saved.updatedBy
    });
  } catch (error) {
    if (error?.code === MONETIZATION_ERROR_CODES.settingsInvalid) {
      return res.status(400).json({ success: false, error: error.message });
    }
    console.error('[Pubs] Enregistrement des réglages impossible :', error);
    return res.status(500).json({
      success: false,
      error: 'Impossible d\'enregistrer les réglages des publicités'
    });
  }
});

// Simule les prochaines ouvertures avec le brouillon envoyé, sans toucher aux
// compteurs réels ni à la base.
router.post('/admin/monetization/preview', setNoStore, isAdmin, async (req, res) => {
  try {
    const body = isPlainObject(req.body) ? req.body : {};
    if (!PLACEMENT_IDS.includes(body.placement)) {
      return res.status(400).json({ success: false, error: 'Emplacement inconnu.' });
    }

    let current;
    try {
      ({ settings: current } = await loadMonetizationSettings(getPool()));
    } catch {
      current = getDefaultMonetizationSettings();
    }
    const settings = validateSettingsInput(body.settings, current);
    const openings = simulateOpenings({
      settings,
      placement: body.placement,
      profile: normalizePreviewProfile(body.profile),
      count: normalizeBoundedInteger(body.count, DEFAULT_PREVIEW_COUNT, MAX_PREVIEW_COUNT),
      now: new Date()
    });
    return res.json({ success: true, openings });
  } catch (error) {
    if (error?.code === MONETIZATION_ERROR_CODES.settingsInvalid) {
      return res.status(400).json({ success: false, error: error.message });
    }
    console.error('[Pubs] Aperçu impossible :', error);
    return res.status(500).json({
      success: false,
      error: 'Impossible de calculer l\'aperçu'
    });
  }
});

const DATE_UNREADABLE_ERROR = 'Date illisible : utilise le format AAAA-MM-JJ.';

// Date de la requête : absente → null, illisible (format, 30 février,
// paramètre répété) → false.
function readDateParam(query, key) {
  const value = query?.[key];
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return isDateKey(trimmed) ? trimmed : false;
}

// Période des stats en jours de Paris. Sans `from` ni `to` : l'ancien `days`
// (30 par défaut, 60 au plus) jusqu'à aujourd'hui. Sinon `to` = aujourd'hui
// et `from` = `to` − 29 jours quand ils manquent.
function resolveStatsPeriod(query, today) {
  const rawFrom = readDateParam(query, 'from');
  const rawTo = readDateParam(query, 'to');
  if (rawFrom === null && rawTo === null) {
    const count = normalizeBoundedInteger(query?.days, DEFAULT_STATS_DAYS, MAX_STATS_DAYS);
    return { from: shiftDateKey(today, -(count - 1)), to: today };
  }
  if (rawFrom === false || rawTo === false) return { error: DATE_UNREADABLE_ERROR };

  const to = rawTo || today;
  const from = rawFrom || shiftDateKey(to, -(DEFAULT_STATS_DAYS - 1));
  if (!isDateKey(from)) return { error: DATE_UNREADABLE_ERROR };
  if (from > to) return { error: 'La date de début est après la date de fin.' };
  if (countDaysBetween(from, to) > MAX_STATS_SPAN_DAYS) {
    return { error: 'Période trop longue : 1 100 jours d\'écart au plus.' };
  }
  return { from, to };
}

router.get('/admin/monetization/stats', setNoStore, isAdmin, async (req, res) => {
  const { dateKey: today } = getParisClock(new Date());
  const period = resolveStatsPeriod(req.query, today);
  if (period.error) return res.status(400).json({ success: false, error: period.error });

  try {
    const days = await stats.readStats({ from: period.from, to: period.to });
    const firstDate = await stats.readFirstStatsDate();
    return res.json({ success: true, from: period.from, to: period.to, today, firstDate, days });
  } catch (error) {
    console.error('[Pubs] Lecture des statistiques impossible :', error?.message || error);
    return res.status(500).json({
      success: false,
      error: 'Impossible de lire les statistiques des publicités'
    });
  }
});

module.exports = { router };
