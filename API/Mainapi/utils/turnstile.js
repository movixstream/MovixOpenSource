/**
 * Utilitaire partagé pour la vérification Cloudflare Turnstile.
 *
 * ## Plusieurs paires de widgets
 *
 * Sur le plan gratuit, un widget n'accepte que 10 domaines (chacun couvre ses
 * sous-domaines). Au-delà, chaque nouvelle paire de widgets — un visible, un
 * invisible — forme un groupe numéroté, de 2 à 10 :
 *
 *   TURNSTILE_DOMAINS_2=miroir-a.tld,miroir-b.tld
 *   TURNSTILE_SECRET_KEY_2=…
 *   TURNSTILE_INVISIBLE_SECRETKEY_2=…
 *
 * La clé secrète suit le domaine d'où part la requête (`Origin`, à défaut
 * `Referer`). Le groupe 1 (`TURNSTILE_SECRET_KEY`,
 * `TURNSTILE_INVISIBLE_SECRETKEY`) sert tous les autres domaines, et c'est lui
 * qui active ou non la vérification. Le frontend choisit ses clés publiques
 * avec la même liste (`src/utils/turnstileKeys.ts`).
 *
 * Choisir le groupe sur un en-tête que le client peut forger n'ouvre rien : un
 * jeton ne passe qu'avec la clé secrète de son propre widget. Et une clé
 * absente d'un groupe retombe sur celle du groupe 1, jamais sur « pas de
 * vérification ».
 */

const axios = require('axios');
const { isAdminRequest } = require('../middleware/auth');

const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY;
const TURNSTILE_INVISIBLE_SECRETKEY = process.env.TURNSTILE_INVISIBLE_SECRETKEY;
// Le plan gratuit permet 20 widgets, soit 10 paires.
const MAX_TURNSTILE_GROUP = 10;

/**
 * `a.tld, https://B.tld/` → `['a.tld', 'b.tld']` : tolère une URL collée
 * telle quelle. Même règle que `parseTurnstileDomains` côté frontend.
 */
function parseTurnstileDomains(raw) {
  return String(raw || '')
    .trim()
    .split(/[\s,;]+/)
    .map((entry) => entry
      .toLowerCase()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
      .replace(/[/:?#].*$/, '')
      .replace(/^\*\./, '')
      .replace(/\.$/, ''))
    .filter(Boolean);
}

const TURNSTILE_GROUPS = [];
for (let group = 2; group <= MAX_TURNSTILE_GROUP; group += 1) {
  const domains = parseTurnstileDomains(process.env[`TURNSTILE_DOMAINS_${group}`]);
  if (domains.length === 0) continue;

  const secretKey = String(process.env[`TURNSTILE_SECRET_KEY_${group}`] || '').trim();
  const invisibleSecretKey = String(process.env[`TURNSTILE_INVISIBLE_SECRETKEY_${group}`] || '').trim();
  if (!secretKey || !invisibleSecretKey) {
    console.warn(`[Turnstile] Groupe ${group} incomplet : la clé manquante retombe sur celle du groupe 1.`);
  }
  TURNSTILE_GROUPS.push({ domains, secretKey, invisibleSecretKey });
}

function requestHostname(req) {
  const source = req?.headers?.origin || req?.headers?.referer;
  if (!source) return '';
  try {
    return new URL(source).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Clé secrète Turnstile du domaine d'origine de la requête.
 * Chaîne vide : Turnstile n'est pas configuré pour ce type de widget.
 *
 * @param {object} req - Express request
 * @param {'visible'|'invisible'} [kind='visible'] - Widget visible ou invisible
 */
function turnstileSecretFor(req, kind = 'visible') {
  const invisible = kind === 'invisible';
  const fallback = (invisible ? TURNSTILE_INVISIBLE_SECRETKEY : TURNSTILE_SECRET_KEY) || '';
  if (!fallback) return '';

  const host = requestHostname(req);
  const match = host && TURNSTILE_GROUPS.find(({ domains }) => domains.some((domain) => (
    host === domain || host.endsWith(`.${domain}`)
  )));
  if (!match) return fallback;

  return (invisible ? match.invisibleSecretKey : match.secretKey) || fallback;
}

async function verifyTurnstile(token, ip, secretKey) {
  try {
    const response = await axios.post('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      secret: secretKey || TURNSTILE_SECRET_KEY,
      response: token,
      remoteip: ip,
    }, { timeout: 10000 });
    return response.data.success === true;
  } catch (error) {
    console.error('Turnstile verification error:', error.message);
    return false;
  }
}

/**
 * Vérifie le token Turnstile à partir d'une requête Express.
 * Retourne { valid: true } si OK, ou { valid: false, status, error } si échec.
 * Si la clé du groupe 1 n'est pas configurée pour ce type de widget, la
 * vérification est ignorée.
 *
 * Les admins en sont dispensés. C'est **ici** que la dispense se décide, et
 * nulle part ailleurs : le point de passage étant unique, toute route protégée
 * — présente comme à venir — en hérite sans avoir à y penser. La décision se
 * prend sur le JWT vérifié côté serveur et la table `admins` (voir
 * `isAdminRequest`), jamais sur ce que raconte le client : le jeton qu'il
 * envoie n'entre pas en compte, et un visiteur qui se prétendrait admin
 * repasse par la vérification Cloudflare, qui échouera.
 *
 * Côté interface, la dispense n'est qu'un affichage en moins (voir
 * `src/utils/turnstileBypass.ts`) : elle n'ouvre aucun droit à elle seule.
 *
 * @param {object} req - Express request
 * @param {string} turnstileToken - Token du client
 * @param {'visible'|'invisible'} [kind='visible'] - Widget qui a produit le token
 */
async function verifyTurnstileFromRequest(req, turnstileToken, kind = 'visible') {
  const key = turnstileSecretFor(req, kind);
  if (!key) return { valid: true };

  if (await isAdminRequest(req)) return { valid: true, bypassed: true };

  if (!turnstileToken) {
    return { valid: false, status: 400, error: 'Vérification de sécurité requise' };
  }

  const ip = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
  const isValid = await verifyTurnstile(turnstileToken, ip, key);

  if (!isValid) {
    return { valid: false, status: 403, error: 'Vérification de sécurité échouée. Réessayez.' };
  }

  return { valid: true };
}

module.exports = { verifyTurnstile, verifyTurnstileFromRequest, turnstileSecretFor, parseTurnstileDomains };
