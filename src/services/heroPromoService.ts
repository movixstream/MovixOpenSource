import { MAIN_API } from '../config/runtime';

// Promos du grand carrousel (slides ajoutées en haut des pages Accueil, Films,
// Séries et Animés), réglées dans l'admin (onglet « Promos du carrousel »).
// Mêmes formes que `API/Mainapi/utils/heroPromoSettings.js` : le serveur
// revalide tout à l'enregistrement.
//
// Côté visiteur, la liste publique est lue sur `GET /api/hero-promos`, gardée
// en mémoire et dans `localStorage` (affichage immédiat au chargement suivant),
// puis relue au plus toutes les 5 minutes.

export type HeroPromoPage = 'home' | 'movies' | 'tv' | 'providers' | 'anime';
export type HeroPromoLanguage = 'fr' | 'en';
export type HeroPromoImagePosition = 'top' | 'center' | 'bottom';
export type HeroPromoAdLabelPosition = 'top-left' | 'top-right';
export type HeroPromoImageKind = 'backdrop' | 'mobile' | 'logo';

export const HERO_PROMO_PAGES: readonly HeroPromoPage[] = ['home', 'movies', 'tv', 'providers', 'anime'];
export const HERO_PROMO_LANGUAGES: readonly HeroPromoLanguage[] = ['fr', 'en'];
export const HERO_PROMO_IMAGE_POSITIONS: readonly HeroPromoImagePosition[] = ['top', 'center', 'bottom'];
export const HERO_PROMO_AD_LABEL_POSITIONS: readonly HeroPromoAdLabelPosition[] = ['top-left', 'top-right'];
export const HERO_PROMO_MIN_AGES: readonly number[] = [0, 7, 12, 16, 18];
export const HERO_PROMO_TEXT_LIMITS = {
  badge: 30,
  tagline: 100,
  title: 80,
  description: 320,
  ctaLabel: 30,
  adLabel: 20
} as const;
export const MAX_HERO_PROMOS = 10;
export const MAX_HERO_PROMO_POSITION = 6;
export const HERO_PROMO_NAME_MAX_LENGTH = 80;
export const HERO_PROMO_URL_MAX_LENGTH = 1000;
export const MAX_HERO_PROMO_IMAGE_BYTES = Math.floor(2.5 * 1024 * 1024);
// Promos montrées au plus dans un carrousel, réglable page par page.
export const MAX_PROMOS_PER_CAROUSEL = 5;
export const DEFAULT_PROMOS_PER_CAROUSEL = 3;
export const DEFAULT_HERO_PROMO_ACCENT = '#ef4444';

export type HeroPromoTextKey = keyof typeof HERO_PROMO_TEXT_LIMITS;
export const HERO_PROMO_TEXT_KEYS = Object.keys(HERO_PROMO_TEXT_LIMITS) as HeroPromoTextKey[];
export type HeroPromoTexts = Record<HeroPromoTextKey, string>;

export interface HeroPromo {
  id: string;
  enabled: boolean;
  /** Nom interne, visible seulement dans l'admin. */
  name: string;
  pages: HeroPromoPage[];
  /** Place de la slide dans le carrousel, 1 = première. */
  position: number;
  startAt: string | null;
  endAt: string | null;
  /** 0 = tout public, sinon caché aux profils limités sous cet âge. */
  minAge: number;
  imageUrl: string;
  mobileImageUrl: string;
  imagePosition: HeroPromoImagePosition;
  logoUrl: string;
  /** Lien https:// ou page du site (« /vip »). */
  linkUrl: string;
  openInNewTab: boolean;
  accentColor: string;
  adLabel: { show: boolean; position: HeroPromoAdLabelPosition };
  texts: Record<HeroPromoLanguage, HeroPromoTexts>;
}

export type PublicHeroPromo = Omit<HeroPromo, 'enabled' | 'name'>;

/** Réglage d'un carrousel : promos affichées ou non, et combien au plus. */
export interface HeroPromoCarousel {
  enabled: boolean;
  maxPromos: number;
}

export type HeroPromoCarousels = Record<HeroPromoPage, HeroPromoCarousel>;

export interface HeroPromoSettings {
  enabled: boolean;
  carousels: HeroPromoCarousels;
  promos: HeroPromo[];
}

/** Réponse publique de `GET /api/hero-promos`. */
export interface PublicHeroPromoConfig {
  carousels: HeroPromoCarousels;
  promos: PublicHeroPromo[];
}

export interface HeroPromoClickStats {
  today: number;
  week: number;
  month: number;
  total: number;
}

export interface HeroPromoAdminPayload {
  settings: HeroPromoSettings;
  updatedAt: string | null;
  updatedBy: string | null;
  /** null si les clics n'ont pas pu être lus. */
  stats: Record<string, HeroPromoClickStats> | null;
}

// ─── Lecture tolérante ────────────────────────────────────────────────────

const isPlainObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);
const pickString = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);
const pickBoolean = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
const pickEnum = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (
  allowed.includes(value as T) ? value as T : fallback
);
const pickNullableDate = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value) return null;
  return Number.isNaN(new Date(value).getTime()) ? null : value;
};

export function createEmptyHeroPromoTexts(): HeroPromoTexts {
  return { badge: '', tagline: '', title: '', description: '', ctaLabel: '', adLabel: '' };
}

// Identifiant de 10 caractères hexadécimaux, comme ceux attendus par le serveur.
export function generateHeroPromoId(): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function createEmptyHeroPromo(): HeroPromo {
  return {
    id: generateHeroPromoId(),
    // Nouvelle promo en pause : elle ne part en ligne qu'une fois complète.
    enabled: false,
    name: '',
    pages: ['home'],
    position: 1,
    startAt: null,
    endAt: null,
    minAge: 0,
    imageUrl: '',
    mobileImageUrl: '',
    imagePosition: 'center',
    logoUrl: '',
    linkUrl: '',
    openInNewTab: true,
    accentColor: DEFAULT_HERO_PROMO_ACCENT,
    adLabel: { show: true, position: 'top-right' },
    texts: { fr: createEmptyHeroPromoTexts(), en: createEmptyHeroPromoTexts() }
  };
}

function normalizeTexts(raw: unknown): HeroPromoTexts {
  const source = isPlainObject(raw) ? raw : {};
  const texts = createEmptyHeroPromoTexts();
  for (const key of HERO_PROMO_TEXT_KEYS) {
    texts[key] = pickString(source[key]).slice(0, HERO_PROMO_TEXT_LIMITS[key]);
  }
  return texts;
}

function normalizePromo(raw: unknown): HeroPromo | null {
  if (!isPlainObject(raw) || typeof raw.id !== 'string' || !/^[a-f0-9]{10}$/.test(raw.id)) {
    return null;
  }
  const empty = createEmptyHeroPromo();
  const pages = Array.isArray(raw.pages)
    ? HERO_PROMO_PAGES.filter((page) => (raw.pages as unknown[]).includes(page))
    : [];
  const adLabel = isPlainObject(raw.adLabel) ? raw.adLabel : {};
  const texts = isPlainObject(raw.texts) ? raw.texts : {};
  const position = typeof raw.position === 'number' && Number.isInteger(raw.position)
    && raw.position >= 1 && raw.position <= MAX_HERO_PROMO_POSITION
    ? raw.position
    : 1;

  return {
    id: raw.id,
    enabled: pickBoolean(raw.enabled, true),
    name: pickString(raw.name),
    pages: pages.length > 0 ? pages : empty.pages,
    position,
    startAt: pickNullableDate(raw.startAt),
    endAt: pickNullableDate(raw.endAt),
    minAge: HERO_PROMO_MIN_AGES.includes(raw.minAge as number) ? raw.minAge as number : 0,
    imageUrl: pickString(raw.imageUrl),
    mobileImageUrl: pickString(raw.mobileImageUrl),
    imagePosition: pickEnum(raw.imagePosition, HERO_PROMO_IMAGE_POSITIONS, empty.imagePosition),
    logoUrl: pickString(raw.logoUrl),
    linkUrl: pickString(raw.linkUrl),
    openInNewTab: pickBoolean(raw.openInNewTab, true),
    accentColor: typeof raw.accentColor === 'string' && /^#[0-9a-f]{6}$/i.test(raw.accentColor)
      ? raw.accentColor.toLowerCase()
      : empty.accentColor,
    adLabel: {
      show: pickBoolean(adLabel.show, true),
      position: pickEnum(adLabel.position, HERO_PROMO_AD_LABEL_POSITIONS, empty.adLabel.position)
    },
    texts: { fr: normalizeTexts(texts.fr), en: normalizeTexts(texts.en) }
  };
}

function normalizePromoList(raw: unknown): HeroPromo[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const promos: HeroPromo[] = [];
  for (const entry of raw) {
    const promo = normalizePromo(entry);
    if (!promo || seen.has(promo.id)) continue;
    seen.add(promo.id);
    promos.push(promo);
  }
  return promos;
}

export function createDefaultHeroPromoCarousels(): HeroPromoCarousels {
  return Object.fromEntries(HERO_PROMO_PAGES.map((page) => [
    page,
    { enabled: true, maxPromos: DEFAULT_PROMOS_PER_CAROUSEL }
  ])) as HeroPromoCarousels;
}

function normalizeCarousels(raw: unknown): HeroPromoCarousels {
  const source = isPlainObject(raw) ? raw : {};
  const carousels = createDefaultHeroPromoCarousels();
  for (const page of HERO_PROMO_PAGES) {
    const entry = isPlainObject(source[page]) ? source[page] : {};
    const max = entry.maxPromos;
    carousels[page] = {
      enabled: pickBoolean(entry.enabled, true),
      maxPromos: typeof max === 'number' && Number.isInteger(max) && max >= 1 && max <= MAX_PROMOS_PER_CAROUSEL
        ? max
        : DEFAULT_PROMOS_PER_CAROUSEL
    };
  }
  return carousels;
}

export function normalizeHeroPromoSettings(raw: unknown): HeroPromoSettings {
  const source = isPlainObject(raw) ? raw : {};
  return {
    enabled: pickBoolean(source.enabled, true),
    carousels: normalizeCarousels(source.carousels),
    promos: normalizePromoList(source.promos)
  };
}

const toPublicPromo = ({ enabled: _enabled, name: _name, ...rest }: HeroPromo): PublicHeroPromo => rest;

// ─── Affichage ────────────────────────────────────────────────────────────

/** Chemin d'une image envoyée depuis l'admin → URL complète sur le Main API. */
export function resolveHeroPromoAsset(ref: string): string {
  if (!ref) return '';
  return ref.startsWith('/api/') ? `${MAIN_API}${ref}` : ref;
}

/** Page du site (« /vip ») plutôt que lien vers un autre site. */
export function isInternalHeroPromoLink(url: string): boolean {
  return /^\/(?!\/)/.test(url);
}

export function isHeroPromoLive(promo: Pick<HeroPromo, 'startAt' | 'endAt'>, now = Date.now()): boolean {
  if (promo.startAt && new Date(promo.startAt).getTime() > now) return false;
  if (promo.endAt && new Date(promo.endAt).getTime() <= now) return false;
  return true;
}

/** Texte anglais vide : le texte français est repris, champ par champ. */
export function pickHeroPromoTexts(promo: Pick<HeroPromo, 'texts'>, language: string): HeroPromoTexts {
  const lang: HeroPromoLanguage = language.toLowerCase().startsWith('en') ? 'en' : 'fr';
  const primary = promo.texts[lang];
  const fallback = promo.texts.fr;
  const texts = createEmptyHeroPromoTexts();
  for (const key of HERO_PROMO_TEXT_KEYS) {
    texts[key] = primary[key].trim() || fallback[key].trim();
  }
  return texts;
}

// ─── Liste publique ───────────────────────────────────────────────────────

const CACHE_KEY = 'hero_promos_cache';
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

const createEmptyPublicConfig = (): PublicHeroPromoConfig => ({
  carousels: createDefaultHeroPromoCarousels(),
  promos: []
});

function normalizePublicConfig(raw: unknown): PublicHeroPromoConfig | null {
  if (!isPlainObject(raw) || !Array.isArray(raw.promos)) return null;
  return {
    carousels: normalizeCarousels(raw.carousels),
    promos: normalizePromoList(raw.promos).map(toPublicPromo)
  };
}

let currentConfig: PublicHeroPromoConfig | null = null;
let currentSignature = '';
let lastFetchAt = 0;
let inflight: Promise<PublicHeroPromoConfig> | null = null;
const listeners = new Set<(config: PublicHeroPromoConfig) => void>();

const readStoredConfig = (): PublicHeroPromoConfig => {
  try {
    const stored = localStorage.getItem(CACHE_KEY);
    return (stored ? normalizePublicConfig(JSON.parse(stored)) : null) ?? createEmptyPublicConfig();
  } catch {
    // Stockage indisponible (navigation privée) ou copie corrompue.
    return createEmptyPublicConfig();
  }
};

/** Réglages des carrousels et promos connus tout de suite, sans réseau. */
export function getHeroPromoConfig(): PublicHeroPromoConfig {
  if (!currentConfig) {
    currentConfig = readStoredConfig();
    currentSignature = JSON.stringify(currentConfig);
  }
  return currentConfig;
}

function applyConfig(next: PublicHeroPromoConfig): PublicHeroPromoConfig {
  getHeroPromoConfig();
  const signature = JSON.stringify(next);
  try {
    localStorage.setItem(CACHE_KEY, signature);
  } catch { /* Stockage plein ou indisponible : la mémoire suffit. */ }
  if (signature === currentSignature) return currentConfig ?? next;
  currentConfig = next;
  currentSignature = signature;
  listeners.forEach((cb) => {
    try { cb(next); } catch { /* Un abonné en erreur ne bloque pas les autres. */ }
  });
  return next;
}

/**
 * Relit la config sur le Main API. 404 = API pas encore à jour : aucune promo.
 * Erreur réseau ou réponse illisible : la config déjà connue est gardée.
 */
export function refreshHeroPromos(): Promise<PublicHeroPromoConfig> {
  if (inflight) return inflight;
  inflight = (async () => {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
    try {
      const response = await fetch(`${MAIN_API}/api/hero-promos`, {
        credentials: 'omit',
        signal: controller?.signal
      });
      lastFetchAt = Date.now();
      if (response.status === 404) return applyConfig(createEmptyPublicConfig());
      if (!response.ok) return getHeroPromoConfig();
      const config = normalizePublicConfig(await response.json());
      return config ? applyConfig(config) : getHeroPromoConfig();
    } catch {
      return getHeroPromoConfig();
    } finally {
      if (timer !== null) clearTimeout(timer);
      inflight = null;
    }
  })();
  return inflight;
}

/** Relit la config si la dernière lecture date de plus de 5 minutes. */
export function ensureHeroPromosFresh(): void {
  if (Date.now() - lastFetchAt >= REFRESH_INTERVAL_MS) {
    void refreshHeroPromos();
  }
}

export function subscribeToHeroPromos(cb: (config: PublicHeroPromoConfig) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Adresse ouverte au clic sur un lien vers un autre site : le Main API compte
 * le clic puis redirige vers le lien de la promo (comme `/api/go` des pubs).
 */
export function getHeroPromoGoUrl(id: string): string | null {
  return MAIN_API && /^[a-f0-9]{10}$/.test(id) ? `${MAIN_API}/api/hero-promos/${id}/go` : null;
}

/** Compte le clic d'un lien vers une page du site, sans retarder la navigation. */
export function trackHeroPromoClick(id: string): void {
  if (!MAIN_API || !/^[a-f0-9]{10}$/.test(id)) return;
  const url = `${MAIN_API}/api/hero-promos/${id}/click`;
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(url)) {
      return;
    }
  } catch { /* sendBeacon refusé : repli sur fetch. */ }
  void fetch(url, { method: 'POST', keepalive: true, credentials: 'omit' }).catch(() => {});
}

// ─── Appels admin ─────────────────────────────────────────────────────────

export type HeroPromoApiError = Error & { statusCode?: number };

function createApiError(message: string, statusCode?: number): HeroPromoApiError {
  const error = new Error(message) as HeroPromoApiError;
  if (statusCode !== undefined) error.statusCode = statusCode;
  return error;
}

async function requestAdminJson(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const token = localStorage.getItem('auth_token');
  if (!token) throw createApiError('Token admin manquant');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(`${MAIN_API}${path}`, { cache: 'no-store', ...init, headers });
  const data: unknown = await response.json().catch(() => ({}));
  const body = isPlainObject(data) ? data : {};
  if (!response.ok) {
    throw createApiError(typeof body.error === 'string' && body.error ? body.error : 'Erreur réseau', response.status);
  }
  return body;
}

function normalizeStats(raw: unknown): Record<string, HeroPromoClickStats> | null {
  if (!isPlainObject(raw)) return null;
  const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
  const stats: Record<string, HeroPromoClickStats> = {};
  for (const [id, entry] of Object.entries(raw)) {
    const source = isPlainObject(entry) ? entry : {};
    stats[id] = { today: count(source.today), week: count(source.week), month: count(source.month), total: count(source.total) };
  }
  return stats;
}

function normalizeAdminPayload(data: Record<string, unknown>): HeroPromoAdminPayload {
  return {
    settings: normalizeHeroPromoSettings(data.settings),
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null,
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : null,
    stats: normalizeStats(data.stats)
  };
}

export async function getAdminHeroPromos(): Promise<HeroPromoAdminPayload> {
  return normalizeAdminPayload(await requestAdminJson('/api/admin/hero-promos'));
}

export async function updateAdminHeroPromos(settings: HeroPromoSettings): Promise<HeroPromoAdminPayload> {
  const payload = normalizeAdminPayload(await requestAdminJson('/api/admin/hero-promos', {
    method: 'PUT',
    body: JSON.stringify({ settings })
  }));
  // L'admin voit son changement tout de suite sur le site.
  void refreshHeroPromos();
  return payload;
}

// ─── Images ───────────────────────────────────────────────────────────────

const IMAGE_BOUNDS: Record<HeroPromoImageKind, { width: number; height: number }> = {
  backdrop: { width: 1920, height: 1200 },
  mobile: { width: 1080, height: 1920 },
  logo: { width: 1000, height: 500 }
};

const loadImageFile = (file: File): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(url);
    resolve(image);
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    reject(createApiError('Image illisible'));
  };
  image.src = url;
});

const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> => (
  new Promise((resolve) => canvas.toBlob(resolve, type, quality))
);

const blobToBase64 = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    const result = String(reader.result || '');
    resolve(result.slice(result.indexOf(',') + 1));
  };
  reader.onerror = () => reject(createApiError('Image illisible'));
  reader.readAsDataURL(blob);
});

/**
 * Réduit l'image à la taille utile et la convertit en WebP (repli JPEG, ou
 * PNG pour un logo transparent) avant l'envoi : une photo de 8 Mo passe sous
 * la limite du serveur. Renvoie le chemin à mettre dans la promo.
 */
export async function uploadHeroPromoImage(file: File, kind: HeroPromoImageKind): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw createApiError('Choisis un fichier image.');
  }
  const image = await loadImageFile(file);
  const bounds = IMAGE_BOUNDS[kind];
  const scale = Math.min(1, bounds.width / image.naturalWidth, bounds.height / image.naturalHeight);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw createApiError('Image illisible');
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, width, height);

  let blob = await canvasToBlob(canvas, 'image/webp', 0.86);
  if (!blob || blob.type !== 'image/webp') {
    // Navigateur sans encodeur WebP : PNG pour garder la transparence d'un logo.
    blob = kind === 'logo'
      ? await canvasToBlob(canvas, 'image/png', 1)
      : await canvasToBlob(canvas, 'image/jpeg', 0.88);
  }
  if (!blob) throw createApiError('Image illisible');
  if (blob.size > MAX_HERO_PROMO_IMAGE_BYTES) {
    throw createApiError(`Image trop lourde même après réduction (${Math.round(MAX_HERO_PROMO_IMAGE_BYTES / 1024)} Ko au plus).`);
  }

  const data = await requestAdminJson('/api/admin/hero-promos/images', {
    method: 'POST',
    body: JSON.stringify({ mimeType: blob.type, dataBase64: await blobToBase64(blob) })
  });
  if (typeof data.path !== 'string' || !data.path) {
    throw createApiError('Réponse du serveur illisible');
  }
  return data.path;
}
