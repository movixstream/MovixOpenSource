import AsyncStorage from '@react-native-async-storage/async-storage';
import { UPDATE_CHECK, FALLBACK_CONFIG } from '../config';

export type AddressConfig = {
  primaryUrl: string;
  mirrors: string[];
  githubUrl: string;
  telegramUrl: string;
};

type RawMirror = { url?: unknown };
type RawAddressJson = {
  primary?: { url?: unknown };
  active?: unknown[];
  github?: unknown;
  telegram?: unknown;
  matrix?: unknown;
};

const HOSTNAME_RE =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    });
  } finally {
    clearTimeout(timer);
  }
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isValidHostname(host: string): boolean {
  if (!HOSTNAME_RE.test(host)) return false;
  if (host === 'rentry.co') return false;
  if (host.endsWith('.rentry.co')) return false;
  return true;
}

// Replicates the SW's parseConfig (public/sw.js) — supports two formats:
// - JSON: {"mirrors": ["host", ...]}
// - HTML: rendered rentry page; extract <a href> hosts inside the first <article>
function parseRentry(text: string): string | null {
  // Try JSON first.
  try {
    const parsed = JSON.parse(text) as { mirrors?: unknown };
    if (Array.isArray(parsed.mirrors)) {
      for (const m of parsed.mirrors) {
        if (typeof m === 'string') {
          const host = m.trim().toLowerCase();
          if (isValidHostname(host)) return host;
        }
      }
      return null;
    }
  } catch {
    // Fall through to HTML parsing.
  }

  // HTML path: scope to the first <article> if present.
  const articleMatch = text.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  const scope = articleMatch ? articleMatch[1] : text;
  const hrefRe = /href=["']https?:\/\/([^/"'\s?#]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefRe.exec(scope)) !== null) {
    const host = match[1].trim().toLowerCase();
    if (isValidHostname(host)) return host;
  }
  return null;
}

function normalizeAddressJson(raw: RawAddressJson): AddressConfig | null {
  const primaryUrl = raw.primary?.url;
  if (!isString(primaryUrl)) return null;
  // `telegram` a été remplacé par `matrix` dans address.json : ni l'un ni
  // l'autre n'est obligatoire, sinon tout le fichier serait rejeté.
  const githubUrl = isString(raw.github) ? raw.github : FALLBACK_CONFIG.GITHUB_URL;
  const telegramUrl = isString(raw.matrix)
    ? raw.matrix
    : isString(raw.telegram)
      ? raw.telegram
      : FALLBACK_CONFIG.TELEGRAM_URL;

  const active = Array.isArray(raw.active) ? raw.active : [];
  const mirrors: string[] = [];
  for (const m of active) {
    const url = (m as RawMirror)?.url;
    if (isString(url) && url !== primaryUrl) {
      mirrors.push(url);
    }
  }

  return {
    primaryUrl,
    mirrors,
    githubUrl,
    telegramUrl,
  };
}

const HARDCODED_FALLBACK: AddressConfig = {
  primaryUrl: FALLBACK_CONFIG.PRIMARY_URL,
  mirrors: FALLBACK_CONFIG.MIRRORS,
  githubUrl: FALLBACK_CONFIG.GITHUB_URL,
  telegramUrl: FALLBACK_CONFIG.TELEGRAM_URL,
};

async function fetchRentryHost(): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(
      `${UPDATE_CHECK.RENTRY_URL}?_=${Date.now()}`,
      UPDATE_CHECK.TIMEOUT_MS,
    );
    if (!res.ok) throw new Error(`rentry status ${res.status}`);
    const host = parseRentry(await res.text());
    if (!host) throw new Error('rentry: no valid hostname');
    return host;
  } catch (err) {
    console.warn('[addressResolver] rentry fetch failed', err);
    return null;
  }
}

async function fetchAddressJson(host: string): Promise<AddressConfig | null> {
  try {
    const res = await fetchWithTimeout(
      `https://${host}/address.json?_=${Date.now()}`,
      UPDATE_CHECK.TIMEOUT_MS,
    );
    if (!res.ok) throw new Error(`address.json status ${res.status}`);
    const json = (await res.json()) as RawAddressJson;
    const normalized = normalizeAddressJson(json);
    if (!normalized) throw new Error('address.json: invalid shape');
    return normalized;
  } catch (err) {
    console.warn('[addressResolver] address.json fetch failed on', host, err);
    return null;
  }
}

async function readCachedConfig(): Promise<AddressConfig | null> {
  try {
    const raw = await AsyncStorage.getItem(FALLBACK_CONFIG.CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AddressConfig>;
    if (!isString(parsed.primaryUrl) || !Array.isArray(parsed.mirrors)) return null;
    if (!isString(parsed.githubUrl) || !isString(parsed.telegramUrl)) return null;
    return {
      primaryUrl: parsed.primaryUrl,
      mirrors: parsed.mirrors.filter(isString),
      githubUrl: parsed.githubUrl,
      telegramUrl: parsed.telegramUrl,
    };
  } catch {
    return null;
  }
}

// Ajoute à la fin de la chaîne les miroirs connus absents de la config, pour
// qu'une config en cache périmée garde toujours des domaines de secours.
function withKnownMirrors(config: AddressConfig): AddressConfig {
  const seen = new Set([config.primaryUrl, ...config.mirrors]);
  const extra = [FALLBACK_CONFIG.PRIMARY_URL, ...FALLBACK_CONFIG.MIRRORS].filter(
    url => !seen.has(url),
  );
  return { ...config, mirrors: [...config.mirrors, ...extra] };
}

export async function resolveAddressConfig(): Promise<AddressConfig> {
  // Derrière un VPN, rentry ou le résolveur peuvent renvoyer un défi
  // Cloudflare : on essaie alors les résolveurs connus, puis la dernière
  // config valide, puis la liste codée en dur.
  const rentryHost = await fetchRentryHost();
  const hosts = [rentryHost, ...FALLBACK_CONFIG.RESOLVER_HOSTS].filter(
    (host, i, all): host is string => !!host && all.indexOf(host) === i,
  );

  for (const host of hosts) {
    const config = await fetchAddressJson(host);
    if (config) {
      AsyncStorage.setItem(FALLBACK_CONFIG.CACHE_KEY, JSON.stringify(config)).catch(
        () => {},
      );
      return config;
    }
  }

  const cached = await readCachedConfig();
  return withKnownMirrors(cached ?? HARDCODED_FALLBACK);
}
