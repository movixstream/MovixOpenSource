/**
 * Détection de la plateforme TV.
 *
 * Le chargeur webOS (`webos/index.html`) ouvre le site avec
 * `?platform=tv&tvsrc=webos-ipk`. Ce paramètre disparaît dès la première
 * navigation SPA, d'où la persistance en `localStorage` : le marqueur doit
 * survivre à un `navigate()` comme à un rechargement.
 *
 * L'UA sert de filet de sécurité (navigateur intégré de la TV ouvert à la main,
 * localStorage vidé, autre constructeur), mais le paramètre reste la source de
 * vérité quand il est présent.
 */

export type TvPlatform = 'webos' | 'tizen' | 'generic';

const STORAGE_KEY = 'movix_tv_platform';

const TV_PLATFORMS: readonly TvPlatform[] = ['webos', 'tizen', 'generic'];

/**
 * UA des téléviseurs et boîtiers, pour le seul cas où le marqueur d'URL est
 * absent. À ne pas confondre avec la regex de `utils/animationPreferences.ts` :
 * celle-ci répond « est-ce une TV ? » (layout 10-foot, périmètre V1), l'autre
 * « ce matériel est-il faible ? » (mode léger) — un mobile d'entrée de gamme
 * coche la seconde sans cocher la première.
 */
const TV_UA_RE =
  /Tizen|WebOS|Web0S|SmartTV|Smart-TV|SMART-TV|GoogleTV|AndroidTV|HbbTV|NetCast|NetTV|VIDAA|AppleTV|Roku|FireTV|PhilipsTV|BRAVIA|Hisense|Aquos/i;

let cached: TvPlatform | null | undefined;

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // localStorage indisponible (navigation privée, TV avec stockage bloqué).
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* idem — on retombera sur le filet UA */
  }
}

function isTvPlatformValue(value: string | null): value is TvPlatform {
  return value !== null && (TV_PLATFORMS as readonly string[]).includes(value);
}

function platformFromUserAgent(ua: string): TvPlatform | null {
  if (!TV_UA_RE.test(ua)) return null;
  if (/WebOS|Web0S|NetCast/i.test(ua)) return 'webos';
  if (/Tizen/i.test(ua)) return 'tizen';
  return 'generic';
}

function platformFromSearch(search: string): TvPlatform | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return null;
  }
  if (params.get('platform') !== 'tv') return null;

  // `tvsrc` précise la provenance ('webos-ipk'), mais on ne fait confiance
  // qu'au préfixe : un futur 'tizen-wgt' doit marcher sans changer ce module.
  const src = params.get('tvsrc') ?? '';
  if (src.startsWith('webos')) return 'webos';
  if (src.startsWith('tizen')) return 'tizen';
  return 'generic';
}

/**
 * À appeler une fois dans `main.tsx`, avant le premier render : lit le
 * paramètre d'URL et le persiste. Sans effet hors contexte TV.
 */
export function persistTvPlatformFromUrl(search?: string): TvPlatform | null {
  if (typeof window === 'undefined') return null;
  const fromUrl = platformFromSearch(search ?? window.location.search);
  if (!fromUrl) return getTvPlatform();
  writeStorage(STORAGE_KEY, fromUrl);
  cached = fromUrl;
  return fromUrl;
}

/** Plateforme TV courante, ou `null` sur desktop/mobile. */
export function getTvPlatform(): TvPlatform | null {
  if (cached !== undefined) return cached;
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return null;
  }

  const stored = readStorage(STORAGE_KEY);
  if (isTvPlatformValue(stored)) {
    cached = stored;
    return cached;
  }

  cached = platformFromUserAgent(navigator.userAgent || '');
  return cached;
}


/** Raccourci : sommes-nous sur une TV, quelle que soit la plateforme ? */
export function isTvPlatform(): boolean {
  return getTvPlatform() !== null;
}

/** Tests uniquement : vide le cache mémoire entre deux scénarios. */
export function __resetTvPlatformCache(): void {
  cached = undefined;
}
