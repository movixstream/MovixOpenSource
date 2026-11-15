import { MAIN_API } from '../config/runtime';

// Réglages des pubs pilotées depuis l'admin (onglet « Publicités »).
// Mêmes formes que `API/Mainapi/utils/monetizationSettings.js` : le serveur
// revalide tout à l'enregistrement, ce module se contente de transporter.

export type PlacementId = 'player' | 'download' | 'livetv' | 'swiftflux';
export type RotationMode = 'sequence' | 'random';
export type SequenceScope = 'global' | 'visitor';
export type MonetizationAudience = 'all' | 'adult' | 'sfw';
export type MonetizationDevice = 'mobile' | 'tablet' | 'desktop';
export type MonetizationOs = 'android' | 'ios' | 'windows' | 'mac' | 'linux' | 'other';
export type MonetizationCountriesMode = 'all' | 'include' | 'exclude';

export const MONETIZATION_PLACEMENT_IDS: readonly PlacementId[] = ['player', 'download', 'livetv', 'swiftflux'];
// Une ancienne valeur inconnue du serveur (ex. « priority », retiré) est lue
// comme « sequence » par normalizeMonetizationSettings.
export const MONETIZATION_ROTATION_MODES: readonly RotationMode[] = ['sequence', 'random'];
export const MONETIZATION_SEQUENCE_SCOPES: readonly SequenceScope[] = ['global', 'visitor'];
export const MONETIZATION_AUDIENCES: readonly MonetizationAudience[] = ['all', 'adult', 'sfw'];
export const MONETIZATION_DEVICES: readonly MonetizationDevice[] = ['mobile', 'tablet', 'desktop'];
export const MONETIZATION_OS_IDS: readonly MonetizationOs[] = ['android', 'ios', 'windows', 'mac', 'linux', 'other'];
export const MONETIZATION_COUNTRIES_MODES: readonly MonetizationCountriesMode[] = ['all', 'include', 'exclude'];

export interface MonetizationPlacement {
  enabled: boolean;
  rotation: RotationMode;
  sequenceScope: SequenceScope;
  windowsPerClick: number;
  fallbackUrl: string;
}

export interface MonetizationAdSchedule {
  startAt: string | null;
  endAt: string | null;
  days: number[];
  hours: { from: number; to: number } | null;
}

export interface MonetizationAdTargeting {
  devices: MonetizationDevice[];
  os: MonetizationOs[];
  countriesMode: MonetizationCountriesMode;
  countries: string[];
}

export interface MonetizationAd {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  placements: PlacementId[];
  audience: MonetizationAudience;
  weight: number;
  schedule: MonetizationAdSchedule;
  targeting: MonetizationAdTargeting;
  caps: { perVisitorPerDay: number; globalPerDay: number };
  note: string;
}

export interface MonetizationSettings {
  enabled: boolean;
  adultDefault: boolean;
  placements: Record<PlacementId, MonetizationPlacement>;
  ads: MonetizationAd[];
}

export interface MonetizationSettingsPayload {
  settings: MonetizationSettings;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface MonetizationPreviewProfile {
  sfw: boolean;
  device: MonetizationDevice;
  os: MonetizationOs;
  country: string | null;
}

export interface MonetizationPreviewOpening {
  adId: string | null;
  name: string | null;
}

export interface MonetizationStatsDay {
  date: string;
  // Clé `<idPub>|<emplacement>`, ou `none|<emplacement>` quand rien n'était éligible.
  counts: Record<string, number>;
}

export type MonetizationApiError = Error & { statusCode?: number };

const DEFAULT_PLACEMENT: MonetizationPlacement = {
  enabled: true,
  rotation: 'sequence',
  sequenceScope: 'global',
  windowsPerClick: 1,
  fallbackUrl: ''
};

export const DEFAULT_MONETIZATION_SETTINGS: MonetizationSettings = {
  enabled: true,
  adultDefault: true,
  placements: {
    player: { ...DEFAULT_PLACEMENT },
    download: { ...DEFAULT_PLACEMENT },
    livetv: { ...DEFAULT_PLACEMENT },
    swiftflux: { ...DEFAULT_PLACEMENT }
  },
  ads: []
};

// Identifiant de 10 caractères hexadécimaux, comme ceux créés par le serveur.
export function generateMonetizationAdId(): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function createEmptyAd(): MonetizationAd {
  return {
    id: generateMonetizationAdId(),
    name: '',
    url: '',
    enabled: true,
    placements: ['player'],
    audience: 'all',
    weight: 1,
    schedule: { startAt: null, endAt: null, days: [], hours: null },
    targeting: { devices: [], os: [], countriesMode: 'all', countries: [] },
    caps: { perVisitorPerDay: 0, globalPerDay: 0 },
    note: ''
  };
}

// ─── Lecture tolérante des réponses du serveur ─────────────────────────────

const isPlainObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);
const pickBoolean = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
const pickNumber = (value: unknown, fallback: number) => (
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
);
const pickString = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback);
const pickEnum = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (
  allowed.includes(value as T) ? value as T : fallback
);
const pickEnumList = <T extends string>(value: unknown, allowed: readonly T[]): T[] => (
  Array.isArray(value) ? value.filter((entry): entry is T => allowed.includes(entry as T)) : []
);
const pickNullableString = (value: unknown) => (typeof value === 'string' && value ? value : null);

function normalizePlacement(raw: unknown): MonetizationPlacement {
  const source = isPlainObject(raw) ? raw : {};
  return {
    enabled: pickBoolean(source.enabled, DEFAULT_PLACEMENT.enabled),
    rotation: pickEnum(source.rotation, MONETIZATION_ROTATION_MODES, DEFAULT_PLACEMENT.rotation),
    sequenceScope: pickEnum(source.sequenceScope, MONETIZATION_SEQUENCE_SCOPES, DEFAULT_PLACEMENT.sequenceScope),
    windowsPerClick: pickNumber(source.windowsPerClick, DEFAULT_PLACEMENT.windowsPerClick),
    fallbackUrl: pickString(source.fallbackUrl, DEFAULT_PLACEMENT.fallbackUrl)
  };
}

function normalizeAd(raw: unknown): MonetizationAd | null {
  if (!isPlainObject(raw) || typeof raw.id !== 'string' || !raw.id) {
    return null;
  }

  const empty = createEmptyAd();
  const schedule = isPlainObject(raw.schedule) ? raw.schedule : {};
  const targeting = isPlainObject(raw.targeting) ? raw.targeting : {};
  const caps = isPlainObject(raw.caps) ? raw.caps : {};
  const hours = isPlainObject(schedule.hours)
    && typeof schedule.hours.from === 'number'
    && typeof schedule.hours.to === 'number'
    ? { from: schedule.hours.from, to: schedule.hours.to }
    : null;

  return {
    id: raw.id,
    name: pickString(raw.name, empty.name),
    url: pickString(raw.url, empty.url),
    enabled: pickBoolean(raw.enabled, empty.enabled),
    placements: pickEnumList(raw.placements, MONETIZATION_PLACEMENT_IDS),
    audience: pickEnum(raw.audience, MONETIZATION_AUDIENCES, empty.audience),
    weight: pickNumber(raw.weight, empty.weight),
    schedule: {
      startAt: pickNullableString(schedule.startAt),
      endAt: pickNullableString(schedule.endAt),
      days: Array.isArray(schedule.days)
        ? schedule.days.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6)
        : [],
      hours
    },
    targeting: {
      devices: pickEnumList(targeting.devices, MONETIZATION_DEVICES),
      os: pickEnumList(targeting.os, MONETIZATION_OS_IDS),
      countriesMode: pickEnum(targeting.countriesMode, MONETIZATION_COUNTRIES_MODES, empty.targeting.countriesMode),
      countries: Array.isArray(targeting.countries)
        ? targeting.countries.filter((code): code is string => typeof code === 'string')
        : []
    },
    caps: {
      perVisitorPerDay: pickNumber(caps.perVisitorPerDay, 0),
      globalPerDay: pickNumber(caps.globalPerDay, 0)
    },
    note: pickString(raw.note, empty.note)
  };
}

// Complète une réponse partielle avec les valeurs par défaut, champ par champ,
// pour qu'un serveur plus ancien ou un champ manquant ne casse pas la page.
export function normalizeMonetizationSettings(raw: unknown): MonetizationSettings {
  const source = isPlainObject(raw) ? raw : {};
  const rawPlacements = isPlainObject(source.placements) ? source.placements : {};
  const placements = Object.fromEntries(
    MONETIZATION_PLACEMENT_IDS.map((id) => [id, normalizePlacement(rawPlacements[id])])
  ) as Record<PlacementId, MonetizationPlacement>;
  const ads = Array.isArray(source.ads)
    ? source.ads.map(normalizeAd).filter((ad): ad is MonetizationAd => ad !== null)
    : [];

  return {
    enabled: pickBoolean(source.enabled, DEFAULT_MONETIZATION_SETTINGS.enabled),
    adultDefault: pickBoolean(source.adultDefault, DEFAULT_MONETIZATION_SETTINGS.adultDefault),
    placements,
    ads
  };
}

function normalizePayload(data: unknown): MonetizationSettingsPayload {
  const source = isPlainObject(data) ? data : {};
  return {
    settings: normalizeMonetizationSettings(source.settings),
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : null,
    updatedBy: typeof source.updatedBy === 'string' ? source.updatedBy : null
  };
}

// ─── Appels admin ──────────────────────────────────────────────────────────

function createApiError(message: string, statusCode?: number): MonetizationApiError {
  const error = new Error(message) as MonetizationApiError;
  if (statusCode !== undefined) {
    error.statusCode = statusCode;
  }
  return error;
}

function getAdminToken(): string {
  const token = localStorage.getItem('auth_token');
  if (!token) {
    throw createApiError('Token admin manquant');
  }
  return token;
}

async function requestAdminJson(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${getAdminToken()}`);
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

export async function getAdminMonetizationSettings(): Promise<MonetizationSettingsPayload> {
  return normalizePayload(await requestAdminJson('/api/admin/monetization'));
}

export async function updateAdminMonetizationSettings(
  settings: MonetizationSettings
): Promise<MonetizationSettingsPayload> {
  const data = await requestAdminJson('/api/admin/monetization', {
    method: 'PUT',
    body: JSON.stringify({ settings })
  });
  return normalizePayload(data);
}

// Simule les prochaines ouvertures d'un emplacement sur le brouillon, sans
// toucher aux compteurs. Un brouillon refusé renvoie une erreur `statusCode` 400.
export async function previewMonetization(options: {
  settings: MonetizationSettings;
  placement: PlacementId;
  profile: MonetizationPreviewProfile;
  count: number;
  signal?: AbortSignal;
}): Promise<MonetizationPreviewOpening[]> {
  const { settings, placement, profile, count, signal } = options;
  const data = await requestAdminJson('/api/admin/monetization/preview', {
    method: 'POST',
    body: JSON.stringify({ settings, placement, profile, count }),
    signal
  });

  if (!Array.isArray(data.openings)) {
    return [];
  }

  return data.openings.map((entry) => {
    const opening = isPlainObject(entry) ? entry : {};
    return {
      adId: typeof opening.adId === 'string' && opening.adId ? opening.adId : null,
      name: typeof opening.name === 'string' && opening.name ? opening.name : null
    };
  });
}

export interface MonetizationStatsRange {
  from: string;
  to: string;
}

export interface MonetizationStatsResult {
  // Chaque jour de `from` à `to`, du plus ancien au plus récent.
  days: MonetizationStatsDay[];
  from: string | null;
  to: string | null;
  // Jour de Paris vu par le serveur, et premier jour en base (null si aucun).
  // Un serveur plus ancien ne les renvoie pas : null aussi.
  today: string | null;
  firstDate: string | null;
}

const STATS_MAX_DAYS = 1100;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const pickDateKey = (value: unknown) => (typeof value === 'string' && DATE_KEY_PATTERN.test(value) ? value : null);

// Ouvertures par jour entre `from` et `to` (jours de Paris). Un nombre garde
// l'ancien paramètre `?days=N` (les N derniers jours).
export async function getMonetizationStats(
  range: MonetizationStatsRange | number,
  options: { signal?: AbortSignal } = {}
): Promise<MonetizationStatsResult> {
  const query = typeof range === 'number'
    ? `days=${Math.min(STATS_MAX_DAYS, Math.max(1, Math.floor(range) || 1))}`
    : `from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
  const data = await requestAdminJson(`/api/admin/monetization/stats?${query}`, { signal: options.signal });

  const days = (Array.isArray(data.days) ? data.days : [])
    .map((entry): MonetizationStatsDay | null => {
      if (!isPlainObject(entry) || typeof entry.date !== 'string') {
        return null;
      }
      const rawCounts = isPlainObject(entry.counts) ? entry.counts : {};
      const counts: Record<string, number> = {};
      for (const [key, value] of Object.entries(rawCounts)) {
        const count = Number(value);
        if (Number.isFinite(count) && count > 0) {
          counts[key] = count;
        }
      }
      return { date: entry.date, counts };
    })
    .filter((entry): entry is MonetizationStatsDay => entry !== null)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // Bornes absentes (ancien serveur) : celles demandées, sinon celles des jours reçus.
  const requested = typeof range === 'number' ? null : range;
  return {
    days,
    from: pickDateKey(data.from) ?? requested?.from ?? days[0]?.date ?? null,
    to: pickDateKey(data.to) ?? requested?.to ?? days[days.length - 1]?.date ?? null,
    today: pickDateKey(data.today),
    firstDate: pickDateKey(data.firstDate)
  };
}
