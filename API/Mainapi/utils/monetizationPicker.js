'use strict';

// Choix de la pub servie par /api/go/:emplacement. Logique pure, sans I/O : les
// réglages arrivent déjà validés (utils/monetizationSettings.js) et les
// compteurs (séquence, plafonds) sont fournis par l'appelant. Jours, heures et
// date des plafonds : ceux de Paris, quel que soit le fuseau du serveur.

const PARIS_TIME_ZONE = 'Europe/Paris';
const WEEKDAY_INDEX = Object.freeze({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 });
const MAX_WEIGHT = 100;
const USER_AGENT_MAX_LENGTH = 1000;
const DEFAULT_PREVIEW_COUNT = 12;
const MAX_PREVIEW_COUNT = 1000;
const COUNTRY_PATTERN = /^[A-Z]{2}$/;
// « XX » = pays inconnu pour Cloudflare.
const UNKNOWN_COUNTRY = 'XX';
const URL_MACRO_PATTERN = /\{(placement|country|device|os|lang|visitor|rand|ts)\}/gi;

// Robots connus : moteurs, aperçus de liens, IA, navigateurs sans écran et
// outils en ligne de commande. Pas de motif « bot » générique : il attraperait
// des téléphones (Cubot). « compatible; …bot » et « +http » couvrent les robots
// qui se déclarent comme le demandent les moteurs.
const BOT_PATTERN = new RegExp([
  'googlebot', 'adsbot', 'mediapartners-google', 'google-inspectiontool', 'googleother',
  'storebot-google', 'apis-google', 'feedfetcher', 'bingbot', 'bingpreview', 'yandex(?:bot|images)',
  'baiduspider', 'duckduckbot', 'applebot', 'facebookexternalhit', 'facebot', 'meta-externalagent',
  'twitterbot', 'slackbot', 'discordbot', 'telegrambot', 'whatsapp', 'linkedinbot', 'pinterestbot',
  'redditbot', 'embedly', 'skypeuripreview', 'semrushbot', 'ahrefsbot', 'mj12bot', 'dotbot',
  'petalbot', 'bytespider', 'gptbot', 'chatgpt-user', 'oai-searchbot', 'claudebot', 'claude-web',
  'anthropic-ai', 'ccbot', 'perplexitybot', 'amazonbot', 'seznambot', 'sogou', 'exabot',
  'headlesschrome', 'phantomjs', 'lighthouse', 'pagespeed', 'curl\\/', 'wget\\/', 'python-requests',
  'python-urllib', 'go-http-client', 'libwww-perl', 'scrapy', 'crawler', 'spider',
  'compatible;[^;)]*bot', '\\+https?:\\/\\/'
].join('|'), 'i');

const PARIS_CLOCK_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: PARIS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
  weekday: 'short'
});

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toValidDate(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function readCount(counts, id) {
  if (!isPlainObject(counts) || !Object.prototype.hasOwnProperty.call(counts, id)) return 0;
  const value = Number(counts[id]);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function normalizeWeight(weight) {
  const value = Math.floor(Number(weight));
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.min(value, MAX_WEIGHT);
}

// Modulo toujours positif : un compteur négatif ou énorme reste dans le cycle.
function positiveModulo(value, length) {
  const number = Math.floor(Number(value));
  const safe = Number.isFinite(number) ? number : 0;
  return ((safe % length) + length) % length;
}

function parseInstant(value) {
  if (value === null || value === undefined || value === '') return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

function detectOs(ua) {
  // L'iPhone annonce aussi « like Mac OS X » : iOS avant macOS.
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  if (/android/i.test(ua)) return 'android';
  if (/windows/i.test(ua)) return 'windows';
  if (/macintosh|mac os x/i.test(ua)) return 'mac';
  // ChromeOS annonce « X11 » comme Linux, mais ce n'en est pas un pour les régies.
  if (/\bcros\b/i.test(ua)) return 'other';
  if (/linux|x11/i.test(ua)) return 'linux';
  return 'other';
}

function detectDevice(ua) {
  // L'iPad annonce « Mobile/… » et une tablette Android n'a pas « Mobile » :
  // tablette avant mobile.
  if (/ipad|tablet|kindle|silk\//i.test(ua)) return 'tablet';
  if (/android/i.test(ua) && !/mobi/i.test(ua)) return 'tablet';
  if (/mobi|iphone|ipod|phone/i.test(ua)) return 'mobile';
  return 'desktop';
}

function parseUserAgent(ua) {
  const text = typeof ua === 'string' ? ua.slice(0, USER_AGENT_MAX_LENGTH) : '';
  return { device: detectDevice(text), os: detectOs(text), isBot: BOT_PATTERN.test(text) };
}

function getParisClock(date) {
  const parts = {};
  for (const part of PARIS_CLOCK_FORMAT.formatToParts(toValidDate(date))) {
    parts[part.type] = part.value;
  }
  return {
    day: WEEKDAY_INDEX[parts.weekday],
    hour: Number(parts.hour) % 24,
    dateKey: `${parts.year}-${parts.month}-${parts.day}`
  };
}

// Code pays ISO alpha-2 en majuscules, ou null (absent, « XX », Tor « T1 »…).
function normalizeCountry(value) {
  if (typeof value !== 'string') return null;
  const country = value.trim().toUpperCase();
  return COUNTRY_PATTERN.test(country) && country !== UNKNOWN_COUNTRY ? country : null;
}

function matchesList(list, value) {
  return !Array.isArray(list) || list.length === 0 || list.includes(value);
}

function matchesCountry(targeting, country) {
  const list = Array.isArray(targeting.countries) ? targeting.countries : [];
  if (targeting.countriesMode === 'include') return country !== null && list.includes(country);
  if (targeting.countriesMode === 'exclude') return country === null || !list.includes(country);
  return true;
}

// Règles qui ne bougent pas d'une ouverture à l'autre pour un même visiteur :
// pub active, emplacement, audience, dates de début et de fin, appareil, OS,
// pays. Elles décident des pubs qui forment le cycle de séquence.
function matchesVisitor(ad, ctx) {
  if (!isPlainObject(ad) || ad.enabled !== true || typeof ad.id !== 'string') return false;
  if (!Array.isArray(ad.placements) || !ad.placements.includes(ctx.placement)) return false;
  if (ad.audience !== 'all' && ad.audience !== (ctx.sfw === true ? 'sfw' : 'adult')) return false;

  const schedule = isPlainObject(ad.schedule) ? ad.schedule : {};
  const now = toValidDate(ctx.now).getTime();
  const startAt = parseInstant(schedule.startAt);
  const endAt = parseInstant(schedule.endAt);
  if (startAt !== null && now < startAt) return false;
  if (endAt !== null && now >= endAt) return false;

  const targeting = isPlainObject(ad.targeting) ? ad.targeting : {};
  return matchesList(targeting.devices, ctx.device)
    && matchesList(targeting.os, ctx.os)
    && matchesCountry(targeting, normalizeCountry(ctx.country));
}

// Jours et plage horaire à Paris. `from > to` passe minuit : 22 → 2 couvre
// 22 h, 23 h, 0 h et 1 h. `to` est exclu.
function isInDailySlot(schedule, clock) {
  if (!isPlainObject(schedule)) return true;
  if (Array.isArray(schedule.days) && schedule.days.length > 0 && !schedule.days.includes(clock.day)) {
    return false;
  }
  const hours = schedule.hours;
  if (!isPlainObject(hours) || !Number.isInteger(hours.from) || !Number.isInteger(hours.to)) return true;
  if (hours.from === hours.to) return true;
  if (hours.from < hours.to) return clock.hour >= hours.from && clock.hour < hours.to;
  return clock.hour >= hours.from || clock.hour < hours.to;
}

// Plafonds du jour : 0 = illimité.
function isUnderCaps(ad, ctx) {
  const caps = isPlainObject(ad.caps) ? ad.caps : {};
  const perVisitor = Number(caps.perVisitorPerDay) || 0;
  const global = Number(caps.globalPerDay) || 0;
  if (perVisitor > 0 && readCount(ctx.visitorCounts, ad.id) >= perVisitor) return false;
  if (global > 0 && readCount(ctx.globalCounts, ad.id) >= global) return false;
  return true;
}

// `ctx.clock` (résultat de getParisClock) est facultatif : l'appelant qui teste
// plusieurs pubs pour la même ouverture le calcule une seule fois.
function isAdEligible(ad, ctx) {
  if (!isPlainObject(ctx) || !matchesVisitor(ad, ctx)) return false;
  const clock = isPlainObject(ctx.clock) ? ctx.clock : getParisClock(ctx.now);
  return isInDailySlot(ad.schedule, clock) && isUnderCaps(ad, ctx);
}

function buildSequenceCycle(candidates) {
  const cycle = [];
  for (const ad of Array.isArray(candidates) ? candidates : []) {
    if (!isPlainObject(ad) || typeof ad.id !== 'string') continue;
    const weight = normalizeWeight(ad.weight);
    for (let index = 0; index < weight; index += 1) cycle.push(ad.id);
  }
  return cycle;
}

// Graine texte (identifiant de geste) → entier 32 bits : FNV-1a puis le
// mélange final de MurmurHash3, pour que deux gestes voisins divergent.
function hashSeed(seed) {
  const text = String(seed ?? '');
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

// mulberry32 : même graine, même suite. Toutes les fenêtres d'un geste tirent
// donc le même ordre et prennent chacune une pub différente.
function createSeededRandom(seed) {
  let state = hashSeed(seed);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

// Tirage pondéré sans remise : l'ordre complet des pubs pour ce geste.
function weightedShuffle(ads, random) {
  const pool = ads.slice();
  const ordered = [];
  while (pool.length > 0) {
    let total = 0;
    for (const ad of pool) total += normalizeWeight(ad.weight);
    let target = random() * total;
    let picked = pool.length - 1;
    for (let index = 0; index < pool.length; index += 1) {
      target -= normalizeWeight(pool[index].weight);
      if (target < 0) {
        picked = index;
        break;
      }
    }
    ordered.push(pool.splice(picked, 1)[0]);
  }
  return ordered;
}

// Un tour complet du cycle depuis la case `base` : chaque pub éligible est
// gardée à sa première rencontre, les cases des autres sont sautées.
function walkSequence(cycle, eligibleById, base) {
  const ordered = [];
  const seen = new Set();
  const start = positiveModulo(base, cycle.length);
  for (let step = 0; step < cycle.length && ordered.length < eligibleById.size; step += 1) {
    const id = cycle[(start + step) % cycle.length];
    if (seen.has(id) || !eligibleById.has(id)) continue;
    seen.add(id);
    ordered.push(eligibleById.get(id));
  }
  return ordered;
}

// Pubs distinctes dans l'ordre où les fenêtres d'un geste les prennent : la
// fenêtre `w` sert la `w`-ième, rien au-delà de la liste. Rotation inconnue =
// `sequence`.
function orderAdsForGesture({ candidates, eligibleIds, rotation, base = 0, seed = '' } = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  const eligible = eligibleIds instanceof Set ? eligibleIds : new Set(Array.isArray(eligibleIds) ? eligibleIds : []);
  const eligibleById = new Map();
  for (const ad of list) {
    if (isPlainObject(ad) && eligible.has(ad.id) && !eligibleById.has(ad.id)) {
      eligibleById.set(ad.id, ad);
    }
  }
  if (eligibleById.size === 0) return [];
  if (rotation === 'random') return weightedShuffle([...eligibleById.values()], createSeededRandom(seed));
  return walkSequence(buildSequenceCycle(list), eligibleById, base);
}

function expandUrlMacros(url, values) {
  if (typeof url !== 'string') return '';
  const source = isPlainObject(values) ? values : {};
  return url.replace(URL_MACRO_PATTERN, (_macro, name) => {
    const value = source[name.toLowerCase()];
    return value === undefined || value === null ? '' : encodeURIComponent(String(value));
  });
}

function buildVisitorContext({ placement, profile, now }) {
  const visitor = isPlainObject(profile) ? profile : {};
  return {
    placement,
    sfw: visitor.sfw === true,
    device: visitor.device ?? null,
    os: visitor.os ?? null,
    country: normalizeCountry(visitor.country),
    now: toValidDate(now)
  };
}

// Pubs qui forment le cycle d'un emplacement pour ce visiteur. Le cycle ne
// garde que son audience et son ciblage : avec A (+18), B (SFW) et C (tous),
// un adulte tourne sur A C A C au lieu de A C C A (la case de B donnée à C).
// Jours, heures et plafonds varient d'une ouverture à l'autre : leurs cases
// restent dans le cycle et sont sautées.
function getPlacementCandidates({ settings, placement, profile, now } = {}) {
  const ads = Array.isArray(settings?.ads) ? settings.ads : [];
  const ctx = buildVisitorContext({ placement, profile, now });
  return ads.filter((ad) => matchesVisitor(ad, ctx));
}

// Ordre des pubs pour une ouverture, utilisé par la route et par l'aperçu de
// l'admin pour qu'ils tournent de la même façon. Ne regarde pas les
// interrupteurs général et d'emplacement : l'appelant les contrôle avant.
function rankAdsForOpening({
  settings,
  placement,
  profile,
  now,
  base = 0,
  seed = '',
  visitorCounts = {},
  globalCounts = {}
} = {}) {
  const ctx = { ...buildVisitorContext({ placement, profile, now }), visitorCounts, globalCounts };
  ctx.clock = getParisClock(ctx.now);
  const candidates = getPlacementCandidates({ settings, placement, profile, now: ctx.now });
  const eligibleIds = new Set(candidates.filter((ad) => isAdEligible(ad, ctx)).map((ad) => ad.id));
  const rotation = settings?.placements?.[placement]?.rotation;
  return orderAdsForGesture({ candidates, eligibleIds, rotation, base, seed });
}

function normalizePreviewCount(count) {
  const value = Math.floor(Number(count));
  if (!Number.isFinite(value)) return DEFAULT_PREVIEW_COUNT;
  return Math.min(Math.max(value, 0), MAX_PREVIEW_COUNT);
}

// Aperçu de l'admin : une fenêtre par ouverture, bases 0, 1, 2… (même résultat
// en portée `global` et `visitor`), plafonds comptés en mémoire. Ne touche à
// aucun compteur réel.
function simulateOpenings({ settings, placement, profile, count = DEFAULT_PREVIEW_COUNT, now = new Date() } = {}) {
  const total = normalizePreviewCount(count);
  const placementSettings = settings?.placements?.[placement];
  const active = isPlainObject(settings)
    && settings.enabled !== false
    && isPlainObject(placementSettings)
    && placementSettings.enabled !== false;
  const visitorCounts = {};
  const globalCounts = {};
  const openings = [];

  for (let index = 0; index < total; index += 1) {
    const ad = active
      ? rankAdsForOpening({
        settings,
        placement,
        profile,
        now,
        base: index,
        seed: `preview-${index}`,
        visitorCounts,
        globalCounts
      })[0]
      : undefined;
    if (!ad) {
      openings.push({ adId: null, name: null });
      continue;
    }
    visitorCounts[ad.id] = readCount(visitorCounts, ad.id) + 1;
    globalCounts[ad.id] = readCount(globalCounts, ad.id) + 1;
    openings.push({ adId: ad.id, name: typeof ad.name === 'string' ? ad.name : null });
  }
  return openings;
}

module.exports = {
  parseUserAgent,
  getParisClock,
  normalizeCountry,
  isAdEligible,
  buildSequenceCycle,
  orderAdsForGesture,
  expandUrlMacros,
  getPlacementCandidates,
  rankAdsForOpening,
  simulateOpenings
};
