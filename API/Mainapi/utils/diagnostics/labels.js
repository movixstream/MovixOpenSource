'use strict';

const net = require('node:net');

const MAX_LABEL = 240;
const MAX_EXAMPLE = 512;
const SENSITIVE_QUERY = /^(?:access_?token|api_?key|auth(?:orization)?|cookie|key|password|secret|signature|sig|token)$/i;
const SELECTOR_QUERY = new Set(['action', 'route', 'order', 'type']);
// Adresses de clients : jamais dans un libellé, ni sur disque ni sur Discord.
const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4 = new RegExp(`(?<!\\d\\.?)${OCTET}(?:\\.${OCTET}){3}(?!\\.?\\d)`, 'g');
const IPV6_CANDIDATE = new RegExp(`(?<![0-9a-z])(?:[0-9a-f]{0,4}:){2,7}(?:${OCTET}(?:\\.${OCTET}){3}|[0-9a-f]{0,4})(?:/\\d{1,3})?(?![0-9a-z])`, 'gi');
const IP_MARK = '\u0001';
const IP_MARKS = /\u0001/g;
const SCRIPT_COMMANDS = /^(?:EVAL|EVAL_RO|EVALSHA|EVALSHA_RO|FCALL|FCALL_RO)$/;
const MAX_SCRIPT_LABELS = 64;
const scriptLabels = new Map();

function bounded(value, limit = MAX_LABEL) {
  const text = String(value == null ? '' : value).replace(/[\r\n\t]+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1))}…` : text;
}

function maskAddresses(text) {
  let masked = text;
  // Pré-test bon marché : une IPv6 avec chiffre a « :: » ou un bloc à chiffre suivi de « : ».
  if (/::|[0-9][a-f]{0,3}:/i.test(masked)) {
    masked = masked.replace(IPV6_CANDIDATE, (match) => {
      const address = match.replace(/\/\d{1,3}$/, '');
      // Les adresses publiques IPv6 commencent par 2 ou 3 : exiger un chiffre évite les mots hexadécimaux.
      return /\d/.test(address) && net.isIPv6(address) ? IP_MARK : match;
    });
  }
  return /\d\.\d/.test(masked) ? masked.replace(IPV4, IP_MARK) : masked;
}

function normalizePart(part) {
  const raw = String(part);
  const value = (raw.includes('%') ? decodeSafe(raw) : raw).toLowerCase();
  if (!value) return '';
  // Chemin rapide : un mot sans chiffre ni séparateur d'adresse n'a rien à masquer
  // (sauf un long hachage ou UUID fait seulement des lettres a à f).
  if (value.length <= 80 && /^[a-z_.-]+$/.test(value) && !/^[a-f-]{16,}$/.test(value)) return value;
  if (/^\d+$/.test(value)) return ':id';
  if (value === IP_MARK || ((value.includes('.') || value.includes(':')) && net.isIP(value.replace(/\/\d{1,3}$/, '')))) return ':ip';
  if (/^tt\d{5,}$/.test(value)) return ':imdb';
  if (/^[0-9a-f]{8}-[0-9a-f-]{12,}$/i.test(value)) return ':id';
  if (/^[0-9a-f]{16,}$/i.test(value)) return ':hash';
  // movie-142143, primary_release_year=2020 : un groupe par préfixe, pas par nombre.
  const prefixed = /^([a-z_]+)[=-]\d+$/.exec(value);
  if (prefixed) return bounded(`${prefixed[1]}-:n`, 80);
  // 14088-solo.html, 217318.png : une fiche ou une image par identifiant.
  const slug = /^\d+-[a-z0-9-]+?(\.[a-z0-9]{2,5})?$/.exec(value);
  if (slug) return `:id-slug${slug[1] || ''}`;
  const file = /^\d+(\.(?:png|jpe?g|webp|gif|avif|svg|m3u8|ts|mp4|vtt|srt|js|json|html?))$/.exec(value);
  if (file) return `:id${file[1]}`;
  if (/^[a-z0-9_-]{24,}$/i.test(value) && /\d/.test(value)) return ':id';
  const text = maskAddresses(value).replace(IP_MARKS, 'ip').replace(/[^a-z0-9._-]+/g, '-').replace(/\b([a-z_]+)-\d+\b/g, '$1-:n');
  return bounded(text, 80) || ':value';
}

function decodeSafe(value) {
  try { return decodeURIComponent(String(value)); } catch { return String(value); }
}

// Codes de partage courts et aléatoires (ex. /api/likes/shared-list/epnfcks4).
function isShareCode(raw, index) {
  const previous = raw[index - 1];
  if (!previous || !/^(?:shared-list|lists?)$/i.test(previous)) return false;
  if (/^list$/i.test(previous) && !/^shared-lists$/i.test(raw[index - 2] || '')) return false;
  const value = decodeSafe(raw[index]);
  return /^[a-z0-9_-]{4,32}$/i.test(value) && !/^\d+$/.test(value);
}

function normalizedPath(pathname) {
  const raw = String(pathname || '/').split('/').filter(Boolean);
  // These path components are credentials, and also create one group per user/key.
  const vip = raw.findIndex((part) => decodeSafe(part).toLowerCase() === 'vip-keys');
  if (vip >= 0 && raw[vip + 1]) raw[vip + 1] = ':key';
  const webhook = raw.findIndex((part) => part.toLowerCase() === 'webhooks');
  if (webhook >= 0 && raw[webhook + 2]) raw[webhook + 2] = ':token';
  if (/^(live|movie|series)$/i.test(raw[0] || '') && raw.length >= 4) {
    raw[1] = ':user'; raw[2] = ':password';
  }
  const parts = raw.map((part, index) => /^:(key|token|user|password)$/.test(part) ? part
    : isShareCode(raw, index) ? ':code' : normalizePart(part));
  return `/${parts.join('/')}`.replace(/\/$/, '') || '/';
}

function headerValue(input, name) {
  try {
    const got = input?.getHeader?.(name);
    if (got != null) return Array.isArray(got) ? got[0] : got;
  } catch { /* diagnostics must not affect requests */ }
  const headers = input?.headers;
  if (headers && typeof headers === 'object') {
    const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
    if (key && headers[key] != null) return Array.isArray(headers[key]) ? headers[key][0] : headers[key];
  }
  return undefined;
}

function hostOnly(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try { return new URL(text.includes('://') ? text : `http://${text}`).host.toLowerCase(); } catch {
    return text.replace(/^\[|\]$/g, '').split('/')[0].toLowerCase();
  }
}

function parseHttpInput(input) {
  const object = input && typeof input === 'object' ? input : null;
  const raw = typeof input === 'string' || input instanceof URL ? String(input) :
    (object?.href || object?.url || object?.path || object?.pathname || '/');
  let url;
  try {
    url = new URL(raw, 'http://diagnostic.invalid');
  } catch { url = new URL('http://diagnostic.invalid/'); }
  const logicalHost = hostOnly(headerValue(object, 'host')) || hostOnly(object?.servername) ||
    hostOnly(object?.hostname) || hostOnly(object?.host) ||
    (url.hostname !== 'diagnostic.invalid' ? url.host.toLowerCase() : 'unknown');
  return { object, url, logicalHost };
}

function httpLabel(input, method = 'GET') {
  try {
    const { object, url, logicalHost } = parseHttpInput(input);
    const actualMethod = bounded(object?.method || object?.options?.method || method || 'GET', 16).toUpperCase();
    const selectors = [];
    for (const [key, value] of url.searchParams) {
      if (SELECTOR_QUERY.has(key.toLowerCase())) {
        // Small query enums (e.g. KissKH order=1/2) carry meaning; numeric path
        // IDs, including seasons/episodes 1..9, do not need separate groups.
        const selector = /^\d$/.test(value) ? value : normalizePart(value);
        selectors.push(`${key.toLowerCase()}=${selector}`);
      }
    }
    const selectorText = selectors.length ? `?${selectors.slice(0, 4).join('&')}` : '';
    const operation = bounded(`${actualMethod} ${logicalHost}${normalizedPath(url.pathname)}${selectorText}`);
    const safeQuery = [];
    for (const [key, value] of url.searchParams) {
      if (!SENSITIVE_QUERY.test(key) && (SELECTOR_QUERY.has(key.toLowerCase()) || /^(?:page|size|limit|offset)$/i.test(key))) {
        // La valeur brute de l'exemple ne doit pas non plus garder une adresse IP.
        safeQuery.push(`${encodeURIComponent(key)}=${encodeURIComponent(maskAddresses(value).replace(IP_MARKS, ':ip'))}`);
      }
    }
    const protocol = url.protocol === 'http:' || url.protocol === 'https:' ? url.protocol : 'https:';
    const example = bounded(`${protocol}//${logicalHost}${normalizedPath(url.pathname)}${safeQuery.length ? `?${safeQuery.join('&')}` : ''}`, MAX_EXAMPLE);
    return { operation, destination: bounded(logicalHost, 180) || 'unknown', example };
  } catch {
    return { operation: 'GET unknown/', destination: 'unknown', example: 'unknown' };
  }
}

function redisKeyFamily(key) {
  // Masquer sur la clé entière : une IPv6 contient elle-même des « : ».
  const value = maskAddresses(String(key == null ? '' : key).replace(/\\/g, '/').trim());
  if (!value) return 'none';
  const raw = value.split(/[:/]+/).filter(Boolean);
  if (/^rate-limit$/i.test(raw[0] || '')) {
    // Après la portée (rate-limit:sync:post:), la fin désigne toujours un client : IP ou compte.
    const scope = [];
    for (const part of raw) { if (scope.length >= 4 || !/^[a-z][a-z_-]*$/i.test(part)) break; scope.push(part.toLowerCase()); }
    return bounded([...scope, ':client'].join(':'), 160);
  }
  if (/^tmdb$/i.test(raw[0] || '') && /^search$/i.test(raw[1] || '') && raw.length > 3) {
    // tmdb:search:{type}:{requête}:{paramètres}:{langue} : la requête tapée (qui peut contenir « : »)
    // ne doit pas créer un groupe par recherche.
    const tail = [];
    let end = raw.length;
    if (end > 4 && /^[a-z]{2,3}(?:-[a-z]{2,4})?$/i.test(raw[end - 1])) tail.unshift(normalizePart(raw[--end]));
    if (end > 4 && raw[end - 1].includes('=')) tail.unshift(normalizePart(raw[--end]));
    return bounded(['tmdb', 'search', normalizePart(raw[2]), ':query', ...tail].join(':'), 160);
  }
  const pieces = raw.slice(0, 6).map((part, index) => isShareCode(raw, index) ? ':code' : normalizePart(part));
  return bounded(pieces.join(':') || 'value', 160);
}

function scriptLabel(script) {
  const text = typeof script === 'string' ? script : String(script ?? '');
  let label = scriptLabels.get(text);
  if (label) return label;
  const words = (text.match(/[a-z_][a-z0-9_]*/gi) || []).slice(0, 4).join('-').toLowerCase();
  label = bounded(`script:${text.length}:${words || 'vide'}`, 64);
  // Le texte du script sert de clé : V8 garde son hachage, sans recalcul à chaque appel.
  if (scriptLabels.size < MAX_SCRIPT_LABELS) scriptLabels.set(text, label);
  return label;
}

function redisLabel(command) {
  const name = bounded(command?.name || command?.command || (Array.isArray(command) ? command[0] : command) || 'unknown', 48).toUpperCase();
  const args = command?.args || (Array.isArray(command) ? command.slice(1) : []);
  const list = Array.isArray(args) ? args : [];
  let operation;
  if (SCRIPT_COMMANDS.test(name)) {
    // EVAL script numkeys KEYS[1]… : le script n'est pas une clé, KEYS[1] donne la famille.
    const firstKey = Number(list[1]) > 0 ? redisKeyFamily(list[2]) : 'none';
    const sha = String(list[0] ?? '');
    const script = name.startsWith('EVALSHA') ? (/^[0-9a-f]{40}$/i.test(sha) ? `script:${sha.slice(0, 8).toLowerCase()}` : ':hash')
      : name.startsWith('FCALL') ? normalizePart(sha) : scriptLabel(list[0]);
    operation = `${name} ${script} ${firstKey}`;
  } else {
    const key = list.length ? list[0] : '';
    const family = /^(AUTH|HELLO|QUIT|PING|INFO|CLIENT|SELECT)$/i.test(name) ? 'control' : redisKeyFamily(key);
    operation = `${name} ${family}`;
  }
  return {
    operation: bounded(operation),
    destination: 'redis',
    example: bounded(operation, MAX_EXAMPLE)
  };
}

// Destination seule, sans analyser le chemin : suffit pour suivre une socket pendant la chauffe.
function httpDestination(input) {
  try {
    const object = input && typeof input === 'object' ? input : null;
    const host = hostOnly(headerValue(object, 'host')) || hostOnly(object?.servername) ||
      hostOnly(object?.hostname) || hostOnly(object?.host) || parseHttpInput(input).logicalHost;
    return bounded(host, 180) || 'unknown';
  } catch { return 'unknown'; }
}

function sqlFingerprint(sql) {
  let text = String(sql == null ? '' : sql)
    .replace(/'(?:''|\\.|[^'])*'/g, '?')
    .replace(/"(?:""|\\.|[^"])*"/g, '?')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\r\n]*/g, ' ')
    .replace(/#[^\r\n]*/g, ' ')
    .replace(/\b(?:0x[0-9a-f]+|\d+(?:\.\d+)?)\b/gi, '?')
    .replace(/\s+/g, ' ').trim();
  if (!text) text = 'UNKNOWN';
  return bounded(text, MAX_EXAMPLE);
}

function sqlLabel(sql) {
  const fingerprint = sqlFingerprint(sql);
  const keyword = (fingerprint.match(/^[A-Z]+/i)?.[0] || 'SQL').toUpperCase();
  return { operation: bounded(`${keyword} ${fingerprint}`, MAX_LABEL), destination: 'mysql', example: fingerprint };
}

module.exports = { httpLabel, httpDestination, redisLabel, sqlLabel, sqlFingerprint };
