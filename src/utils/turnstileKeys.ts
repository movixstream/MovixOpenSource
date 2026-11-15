/**
 * Clés Turnstile publiques du domaine courant.
 *
 * Sur le plan gratuit, un widget Turnstile n'accepte que 10 domaines (chacun
 * couvre ses sous-domaines). Au-delà, on crée une nouvelle paire de widgets —
 * un visible, un invisible — et on la déclare comme groupe numéroté :
 *
 *   VITE_TURNSTILE_DOMAINS_2=miroir-a.tld,miroir-b.tld
 *   VITE_TURNSTILE_SITE_KEY_2=…
 *   VITE_TURNSTILE_INVISIBLE_SITEKEY_2=…
 *
 * Le groupe 1 reste `VITE_TURNSTILE_SITE_KEY` et
 * `VITE_TURNSTILE_INVISIBLE_SITEKEY`, sans liste : il sert tous les domaines
 * qu'aucun autre groupe ne revendique. L'API choisit la clé secrète de la même
 * façon, d'après l'en-tête `Origin` (`API/Mainapi/utils/turnstile.js`) : les
 * deux listes de domaines doivent rester identiques.
 *
 * Une clé absente d'un groupe retombe sur celle du groupe 1. Le widget échoue
 * alors sur ce domaine, et ça se voit : mieux qu'une protection qui saute.
 */

export interface TurnstileKeys {
  siteKey: string;
  invisibleSiteKey: string;
}

interface TurnstileKeyGroup extends TurnstileKeys {
  domains: string[];
}

// Noms écrits en toutes lettres : Vite ne remplace au build que ces accès
// statiques. Le plan gratuit permet 20 widgets, soit 10 paires.
const ENV_GROUPS: ReadonlyArray<readonly [unknown, unknown, unknown]> = [
  [import.meta.env.VITE_TURNSTILE_DOMAINS_2, import.meta.env.VITE_TURNSTILE_SITE_KEY_2, import.meta.env.VITE_TURNSTILE_INVISIBLE_SITEKEY_2],
  [import.meta.env.VITE_TURNSTILE_DOMAINS_3, import.meta.env.VITE_TURNSTILE_SITE_KEY_3, import.meta.env.VITE_TURNSTILE_INVISIBLE_SITEKEY_3],
  [import.meta.env.VITE_TURNSTILE_DOMAINS_4, import.meta.env.VITE_TURNSTILE_SITE_KEY_4, import.meta.env.VITE_TURNSTILE_INVISIBLE_SITEKEY_4],
  [import.meta.env.VITE_TURNSTILE_DOMAINS_5, import.meta.env.VITE_TURNSTILE_SITE_KEY_5, import.meta.env.VITE_TURNSTILE_INVISIBLE_SITEKEY_5],
  [import.meta.env.VITE_TURNSTILE_DOMAINS_6, import.meta.env.VITE_TURNSTILE_SITE_KEY_6, import.meta.env.VITE_TURNSTILE_INVISIBLE_SITEKEY_6],
  [import.meta.env.VITE_TURNSTILE_DOMAINS_7, import.meta.env.VITE_TURNSTILE_SITE_KEY_7, import.meta.env.VITE_TURNSTILE_INVISIBLE_SITEKEY_7],
  [import.meta.env.VITE_TURNSTILE_DOMAINS_8, import.meta.env.VITE_TURNSTILE_SITE_KEY_8, import.meta.env.VITE_TURNSTILE_INVISIBLE_SITEKEY_8],
  [import.meta.env.VITE_TURNSTILE_DOMAINS_9, import.meta.env.VITE_TURNSTILE_SITE_KEY_9, import.meta.env.VITE_TURNSTILE_INVISIBLE_SITEKEY_9],
  [import.meta.env.VITE_TURNSTILE_DOMAINS_10, import.meta.env.VITE_TURNSTILE_SITE_KEY_10, import.meta.env.VITE_TURNSTILE_INVISIBLE_SITEKEY_10],
];

const clean = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * `a.tld, https://B.tld/` → `['a.tld', 'b.tld']` : tolère une URL collée
 * telle quelle. Même règle que `parseTurnstileDomains` côté API.
 */
export function parseTurnstileDomains(raw: unknown): string[] {
  return clean(raw)
    .split(/[\s,;]+/)
    .map(entry => entry
      .toLowerCase()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
      .replace(/[/:?#].*$/, '')
      .replace(/^\*\./, '')
      .replace(/\.$/, ''))
    .filter(Boolean);
}

const DEFAULT_KEYS: TurnstileKeys = {
  siteKey: clean(import.meta.env.VITE_TURNSTILE_SITE_KEY),
  invisibleSiteKey: clean(import.meta.env.VITE_TURNSTILE_INVISIBLE_SITEKEY),
};

const GROUPS: TurnstileKeyGroup[] = ENV_GROUPS
  .map(([domains, siteKey, invisibleSiteKey]) => ({
    domains: parseTurnstileDomains(domains),
    siteKey: clean(siteKey) || DEFAULT_KEYS.siteKey,
    invisibleSiteKey: clean(invisibleSiteKey) || DEFAULT_KEYS.invisibleSiteKey,
  }))
  .filter(group => group.domains.length > 0);

/** Un domaine couvre ses sous-domaines, comme dans Turnstile et le CORS de l'API. */
const coversHost = (domain: string, hostname: string): boolean => (
  hostname === domain || hostname.endsWith(`.${domain}`)
);

/** Clés du premier groupe qui revendique `hostname`, sinon celles du groupe 1. */
export function resolveTurnstileKeys(hostname: string): TurnstileKeys {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  const group = host
    ? GROUPS.find(candidate => candidate.domains.some(domain => coversHost(domain, host)))
    : undefined;
  return group
    ? { siteKey: group.siteKey, invisibleSiteKey: group.invisibleSiteKey }
    : DEFAULT_KEYS;
}

const CURRENT_KEYS = resolveTurnstileKeys(typeof window === 'undefined' ? '' : window.location.hostname);

/** Widget visible de ce domaine. Vide : Turnstile désactivé. */
export const TURNSTILE_SITE_KEY = CURRENT_KEYS.siteKey;
/** Widget invisible de ce domaine (likes, votes…). Vide : désactivé. */
export const TURNSTILE_INVISIBLE_SITEKEY = CURRENT_KEYS.invisibleSiteKey;
