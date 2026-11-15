import type { TFunction } from 'i18next';

import {
  MONETIZATION_PLACEMENT_IDS,
  MONETIZATION_ROTATION_MODES,
  type MonetizationAd,
  type MonetizationSettings,
  type MonetizationStatsDay,
  type PlacementId,
  type RotationMode
} from '../../services/monetizationAdminService';

// Mêmes limites que la validation du serveur : l'interface les applique pour
// un retour immédiat, le serveur revalide de toute façon à l'enregistrement.
export const MONETIZATION_MAX_ADS = 50;
export const AD_NAME_MAX_LENGTH = 80;
export const AD_URL_MAX_LENGTH = 2000;
export const AD_NOTE_MAX_LENGTH = 500;
export const AD_WEIGHT_MIN = 1;
export const AD_WEIGHT_MAX = 100;
export const AD_CAP_MAX = 1000000;
export const AD_COUNTRIES_MAX = 250;
export const WINDOWS_PER_CLICK_MAX = 3;
export const PREVIEW_OPENINGS_COUNT = 12;

// Macros remplacées par le serveur à chaque ouverture (valeurs encodées).
export const MONETIZATION_URL_MACROS = ['placement', 'country', 'device', 'os', 'lang', 'visitor', 'rand', 'ts'] as const;

export type MonetizationIssueCode =
  | 'required'
  | 'tooLong'
  | 'invalidUrl'
  | 'integerRange'
  | 'placementsRequired'
  | 'hoursSame'
  | 'hoursRange'
  | 'invalidDate'
  | 'endBeforeStart'
  | 'invalidCountry'
  | 'tooManyCountries'
  | 'tooManyAds'
  | 'duplicateId';

export interface MonetizationIssue {
  code: MonetizationIssueCode;
  params?: Record<string, string | number>;
}

export type MonetizationAdField =
  | 'name'
  | 'url'
  | 'placements'
  | 'weight'
  | 'startAt'
  | 'endAt'
  | 'hours'
  | 'countries'
  | 'perVisitorPerDay'
  | 'globalPerDay'
  | 'note';

export type MonetizationPlacementField = 'windowsPerClick' | 'fallbackUrl';

// Clés : `ads` (liste entière), `ads.<id>.<champ>`, `placements.<id>.<champ>`.
export type MonetizationErrors = Partial<Record<string, MonetizationIssue>>;

export type MonetizationSectionId = 'general' | 'placements' | 'ads';

export const adFieldKey = (adId: string, field: MonetizationAdField) => `ads.${adId}.${field}`;
export const placementFieldKey = (id: PlacementId, field: MonetizationPlacementField) => `placements.${id}.${field}`;

export function countAdErrors(errors: MonetizationErrors, adId: string): number {
  const prefix = `ads.${adId}.`;
  return Object.keys(errors).filter((key) => key.startsWith(prefix)).length;
}

// ─── Copie et normalisation ────────────────────────────────────────────────

export function cloneMonetizationAd(ad: MonetizationAd): MonetizationAd {
  return {
    ...ad,
    placements: [...ad.placements],
    schedule: {
      ...ad.schedule,
      days: [...ad.schedule.days],
      hours: ad.schedule.hours ? { ...ad.schedule.hours } : null
    },
    targeting: {
      ...ad.targeting,
      devices: [...ad.targeting.devices],
      os: [...ad.targeting.os],
      countries: [...ad.targeting.countries]
    },
    caps: { ...ad.caps }
  };
}

export function cloneMonetizationSettings(settings: MonetizationSettings): MonetizationSettings {
  return {
    enabled: settings.enabled,
    adultDefault: settings.adultDefault,
    placements: Object.fromEntries(
      MONETIZATION_PLACEMENT_IDS.map((id) => [id, { ...settings.placements[id] }])
    ) as MonetizationSettings['placements'],
    ads: settings.ads.map(cloneMonetizationAd)
  };
}

const unique = <T,>(values: T[]): T[] => Array.from(new Set(values));

// Version envoyée au serveur : textes sans espaces superflus, pays en
// majuscules, listes sans doublon. Le brouillon d'origine reste intact.
export function normalizeMonetizationForSave(settings: MonetizationSettings): MonetizationSettings {
  const copy = cloneMonetizationSettings(settings);

  for (const id of MONETIZATION_PLACEMENT_IDS) {
    const placement = copy.placements[id];
    placement.fallbackUrl = placement.fallbackUrl.trim();
    // Rotation inconnue (ex. l'ancien « priority ») : le serveur la refuserait.
    if (!MONETIZATION_ROTATION_MODES.includes(placement.rotation)) {
      placement.rotation = 'sequence';
    }
  }

  copy.ads = copy.ads.map((ad) => ({
    ...ad,
    name: ad.name.trim(),
    url: ad.url.trim(),
    note: ad.note.trim(),
    placements: unique(ad.placements.filter((id) => MONETIZATION_PLACEMENT_IDS.includes(id))),
    schedule: {
      ...ad.schedule,
      days: unique(ad.schedule.days).sort((a, b) => a - b)
    },
    targeting: {
      ...ad.targeting,
      devices: unique(ad.targeting.devices),
      os: unique(ad.targeting.os),
      countries: unique(ad.targeting.countries.map((code) => code.trim().toUpperCase()).filter(Boolean))
    }
  }));

  return copy;
}

// ─── Validation ────────────────────────────────────────────────────────────

const MACRO_PATTERN = new RegExp(`\\{(${MONETIZATION_URL_MACROS.join('|')})\\}`, 'g');

// Même contrôle que le serveur (utils/monetizationSettings.js) : les macros
// sont analysées telles quelles, sans remplacement.
export function isHttpUrl(value: string): boolean {
  if (!/^https?:\/\/\S+$/i.test(value)) {
    return false;
  }

  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0;
  } catch {
    return false;
  }
}

const isIntegerBetween = (value: number, min: number, max: number) => (
  Number.isInteger(value) && value >= min && value <= max
);

const checkUrl = (value: string, required: boolean): MonetizationIssue | null => {
  if (!value) {
    return required ? { code: 'required' } : null;
  }
  if (value.length > AD_URL_MAX_LENGTH) {
    return { code: 'tooLong', params: { limit: AD_URL_MAX_LENGTH } };
  }
  return isHttpUrl(value) ? null : { code: 'invalidUrl' };
};

// Date ISO complète avec son fuseau, comme l'exige le serveur (une valeur
// `datetime-local` brute, sans fuseau, serait refusée).
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i;

// null : pas de date ; NaN : date invalide.
const parseDate = (value: string | null): number | null => {
  if (!value) {
    return null;
  }
  if (!ISO_DATE_PATTERN.test(value.trim())) {
    return Number.NaN;
  }
  const time = Date.parse(value.trim());
  return Number.isNaN(time) ? Number.NaN : time;
};

function validateAd(ad: MonetizationAd, errors: MonetizationErrors) {
  const set = (field: MonetizationAdField, issue: MonetizationIssue | null) => {
    if (issue) {
      errors[adFieldKey(ad.id, field)] = issue;
    }
  };
  const name = ad.name.trim();

  set('name', !name
    ? { code: 'required' }
    : name.length > AD_NAME_MAX_LENGTH ? { code: 'tooLong', params: { limit: AD_NAME_MAX_LENGTH } } : null);
  set('url', checkUrl(ad.url.trim(), true));
  set('placements', ad.placements.length === 0 || ad.placements.some((id) => !MONETIZATION_PLACEMENT_IDS.includes(id))
    ? { code: 'placementsRequired' }
    : null);
  set('weight', isIntegerBetween(ad.weight, AD_WEIGHT_MIN, AD_WEIGHT_MAX)
    ? null
    : { code: 'integerRange', params: { min: AD_WEIGHT_MIN, max: AD_WEIGHT_MAX } });

  const { hours, startAt, endAt } = ad.schedule;
  if (hours) {
    if (!isIntegerBetween(hours.from, 0, 23) || !isIntegerBetween(hours.to, 1, 24)) {
      set('hours', { code: 'hoursRange' });
    } else if (hours.from === hours.to) {
      set('hours', { code: 'hoursSame' });
    }
  }

  const start = parseDate(startAt);
  const end = parseDate(endAt);
  if (start !== null && Number.isNaN(start)) {
    set('startAt', { code: 'invalidDate' });
  }
  if (end !== null && Number.isNaN(end)) {
    set('endAt', { code: 'invalidDate' });
  } else if (start !== null && end !== null && !Number.isNaN(start) && end <= start) {
    set('endAt', { code: 'endBeforeStart' });
  }

  const { countries } = ad.targeting;
  const invalidCountry = countries.find((code) => !/^[A-Z]{2}$/.test(code.trim().toUpperCase()));
  if (invalidCountry !== undefined) {
    set('countries', { code: 'invalidCountry', params: { value: invalidCountry.trim() } });
  } else if (unique(countries.map((code) => code.trim().toUpperCase())).length > AD_COUNTRIES_MAX) {
    set('countries', { code: 'tooManyCountries', params: { limit: AD_COUNTRIES_MAX } });
  }

  const capIssue = (value: number): MonetizationIssue | null => (
    isIntegerBetween(value, 0, AD_CAP_MAX) ? null : { code: 'integerRange', params: { min: 0, max: AD_CAP_MAX } }
  );
  set('perVisitorPerDay', capIssue(ad.caps.perVisitorPerDay));
  set('globalPerDay', capIssue(ad.caps.globalPerDay));

  set('note', ad.note.trim().length > AD_NOTE_MAX_LENGTH
    ? { code: 'tooLong', params: { limit: AD_NOTE_MAX_LENGTH } }
    : null);
}

// Reprend les règles du serveur. À appeler de préférence sur la version normalisée.
export function validateMonetizationSettings(settings: MonetizationSettings): MonetizationErrors {
  const errors: MonetizationErrors = {};

  for (const id of MONETIZATION_PLACEMENT_IDS) {
    const placement = settings.placements[id];
    if (!isIntegerBetween(placement.windowsPerClick, 1, WINDOWS_PER_CLICK_MAX)) {
      errors[placementFieldKey(id, 'windowsPerClick')] = {
        code: 'integerRange',
        params: { min: 1, max: WINDOWS_PER_CLICK_MAX }
      };
    }
    const fallbackIssue = checkUrl(placement.fallbackUrl.trim(), false);
    if (fallbackIssue) {
      errors[placementFieldKey(id, 'fallbackUrl')] = fallbackIssue;
    }
  }

  if (settings.ads.length > MONETIZATION_MAX_ADS) {
    errors.ads = { code: 'tooManyAds', params: { limit: MONETIZATION_MAX_ADS } };
  } else if (unique(settings.ads.map((ad) => ad.id)).length !== settings.ads.length) {
    errors.ads = { code: 'duplicateId' };
  }

  for (const ad of settings.ads) {
    validateAd(ad, errors);
  }

  return errors;
}

export function formatMonetizationIssue(
  t: TFunction,
  issue: MonetizationIssue | undefined,
  locale?: string
): string | null {
  if (!issue) {
    return null;
  }

  // Nombres formatés selon la langue (« 1 000 000 » en français).
  const params = Object.fromEntries(Object.entries(issue.params ?? {}).map(([name, value]) => {
    if (typeof value !== 'number') {
      return [name, value];
    }
    try {
      return [name, new Intl.NumberFormat(locale).format(value)];
    } catch {
      return [name, String(value)];
    }
  }));

  return t(`admin.monetization.errors.${issue.code}`, params);
}

// ─── Sections modifiées ────────────────────────────────────────────────────

const SECTION_SNAPSHOTS: Record<MonetizationSectionId, (settings: MonetizationSettings) => unknown> = {
  general: (settings) => [settings.enabled, settings.adultDefault],
  placements: (settings) => MONETIZATION_PLACEMENT_IDS.map((id) => {
    const placement = settings.placements[id];
    return [placement.enabled, placement.rotation, placement.sequenceScope, placement.windowsPerClick, placement.fallbackUrl];
  }),
  ads: (settings) => settings.ads
};

const SECTION_IDS = Object.keys(SECTION_SNAPSHOTS) as MonetizationSectionId[];

// Sections qui diffèrent entre deux réglages (NaN d'un champ vide compte comme un écart).
export function getChangedMonetizationSections(
  current: MonetizationSettings,
  reference: MonetizationSettings
): MonetizationSectionId[] {
  return SECTION_IDS.filter((section) => (
    JSON.stringify(SECTION_SNAPSHOTS[section](current)) !== JSON.stringify(SECTION_SNAPSHOTS[section](reference))
  ));
}

// ─── État d'une pub ────────────────────────────────────────────────────────

export type MonetizationAdStatus = 'live' | 'paused' | 'scheduled' | 'ended';

export function getAdStatus(ad: MonetizationAd, now: Date = new Date()): MonetizationAdStatus {
  if (!ad.enabled) {
    return 'paused';
  }
  const start = parseDate(ad.schedule.startAt);
  const end = parseDate(ad.schedule.endAt);
  if (start !== null && !Number.isNaN(start) && start > now.getTime()) {
    return 'scheduled';
  }
  if (end !== null && !Number.isNaN(end) && end <= now.getTime()) {
    return 'ended';
  }
  return 'live';
}

// Pub « active » comme pour le serveur : allumée et dans sa fenêtre de dates
// (jours, heures et ciblage ne comptent pas).
export function countLiveAds(settings: MonetizationSettings, now: Date = new Date(), placement?: PlacementId): number {
  return settings.ads.filter((ad) => (
    getAdStatus(ad, now) === 'live' && (!placement || ad.placements.includes(placement))
  )).length;
}

// Sens du champ « poids » selon la rotation des emplacements de la pub.
export function getAdWeightMeaning(ad: MonetizationAd, settings: MonetizationSettings): RotationMode | 'mixed' {
  const rotations = unique(ad.placements
    .filter((id) => MONETIZATION_PLACEMENT_IDS.includes(id))
    .map((id) => (settings.placements[id].rotation === 'random' ? 'random' : 'sequence')));
  if (rotations.length === 0) {
    return 'sequence';
  }
  return rotations.length === 1 ? rotations[0] : 'mixed';
}

export function countAdvancedRules(ad: MonetizationAd): number {
  return [
    Boolean(ad.schedule.startAt || ad.schedule.endAt),
    ad.schedule.days.length > 0,
    ad.schedule.hours !== null,
    ad.targeting.devices.length > 0,
    ad.targeting.os.length > 0,
    ad.targeting.countriesMode !== 'all',
    ad.caps.perVisitorPerDay > 0 || ad.caps.globalPerDay > 0,
    ad.note.trim() !== ''
  ].filter(Boolean).length;
}

// Lettre affichée sur les pastilles de l'aperçu et des statistiques.
export function getAdLetter(index: number): string {
  return index >= 0 && index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) {
    return list;
  }
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

// ─── Champs particuliers ───────────────────────────────────────────────────

// « fr, be ch » → ['FR', 'BE', 'CH'] ; les codes invalides restent pour être signalés.
export function parseCountryList(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean);
}

export function formatCountryList(countries: string[]): string {
  return countries.join(', ');
}

const pad = (value: number) => String(value).padStart(2, '0');

// Date ISO → valeur d'un champ `datetime-local` (heure locale du navigateur).
export function toDateTimeLocalValue(iso: string | null): string {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromDateTimeLocalValue(value: string): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const SAMPLE_MACRO_VALUES: Record<(typeof MONETIZATION_URL_MACROS)[number], string> = {
  placement: 'player',
  country: 'FR',
  device: 'desktop',
  os: 'windows',
  lang: 'fr',
  visitor: 'test',
  rand: '123456',
  ts: '1700000000000'
};

// Lien de test : les macros reçoivent une valeur d'exemple.
export function buildTestAdUrl(url: string, placement?: PlacementId): string | null {
  const trimmed = url.trim();
  if (!trimmed || !isHttpUrl(trimmed)) {
    return null;
  }
  return trimmed.replace(MACRO_PATTERN, (_, macro: keyof typeof SAMPLE_MACRO_VALUES) => (
    macro === 'placement' && placement ? placement : SAMPLE_MACRO_VALUES[macro]
  ));
}

// ─── Statistiques ──────────────────────────────────────────────────────────

const PARIS_DATE_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

export function getParisDateKey(date: Date = new Date()): string {
  const parts = PARIS_DATE_FORMAT.formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function shiftDateKey(key: string, deltaDays: number): string {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + deltaDays)).toISOString().slice(0, 10);
}

export const STATS_CHART_DAYS = 14;
export const STATS_WEEK_DAYS = 7;
export const STATS_MONTH_DAYS = 30;

export interface MonetizationStatsSummary {
  todayKey: string;
  today: { served: number; none: number };
  // 14 derniers jours, du plus ancien au plus récent, jours vides compris.
  days: Array<{ date: string; served: number; none: number }>;
  perAd: Record<string, { today: number; week: number; month: number }>;
  perPlacement: Record<PlacementId, { served: number; none: number }>;
  month: { served: number; none: number };
}

export function summarizeMonetizationStats(days: MonetizationStatsDay[], now: Date = new Date()): MonetizationStatsSummary {
  const todayKey = getParisDateKey(now);
  const weekStart = shiftDateKey(todayKey, -(STATS_WEEK_DAYS - 1));
  const monthStart = shiftDateKey(todayKey, -(STATS_MONTH_DAYS - 1));
  const chartKeys = Array.from({ length: STATS_CHART_DAYS }, (_, index) => shiftDateKey(todayKey, index - (STATS_CHART_DAYS - 1)));
  const byDay = new Map(chartKeys.map((date) => [date, { date, served: 0, none: 0 }]));
  const perAd: MonetizationStatsSummary['perAd'] = {};
  const perPlacement = Object.fromEntries(
    MONETIZATION_PLACEMENT_IDS.map((id) => [id, { served: 0, none: 0 }])
  ) as MonetizationStatsSummary['perPlacement'];
  const month = { served: 0, none: 0 };

  for (const day of days) {
    if (day.date < monthStart || day.date > todayKey) {
      continue;
    }
    const isToday = day.date === todayKey;
    const inWeek = day.date >= weekStart;
    const chartDay = byDay.get(day.date);

    for (const [key, rawCount] of Object.entries(day.counts)) {
      const count = Number.isFinite(rawCount) ? rawCount : 0;
      const separator = key.lastIndexOf('|');
      if (separator <= 0 || count <= 0) {
        continue;
      }
      const adId = key.slice(0, separator);
      const placement = key.slice(separator + 1) as PlacementId;
      const isNone = adId === 'none';

      if (isNone) {
        month.none += count;
      } else {
        month.served += count;
        const entry = perAd[adId] ?? (perAd[adId] = { today: 0, week: 0, month: 0 });
        entry.month += count;
        if (inWeek) entry.week += count;
        if (isToday) entry.today += count;
      }
      if (perPlacement[placement]) {
        perPlacement[placement][isNone ? 'none' : 'served'] += count;
      }
      if (chartDay) {
        chartDay[isNone ? 'none' : 'served'] += count;
      }
    }
  }

  const todayEntry = byDay.get(todayKey) ?? { date: todayKey, served: 0, none: 0 };

  return {
    todayKey,
    today: { served: todayEntry.served, none: todayEntry.none },
    days: chartKeys.map((date) => byDay.get(date) ?? { date, served: 0, none: 0 }),
    perAd,
    perPlacement,
    month
  };
}

// ─── Périodes de la section Statistiques ───────────────────────────────────

export type StatsPeriodPreset =
  | 'today'
  | 'yesterday'
  | '7d'
  | '30d'
  | 'thisWeek'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisYear'
  | '90d'
  | '12m'
  | 'all';
// Raccourcis proposés à gauche du calendrier, dans cet ordre.
export const STATS_PERIOD_PRESETS: readonly StatsPeriodPreset[] = [
  'today',
  'yesterday',
  '7d',
  '30d',
  'thisWeek',
  'thisMonth',
  'lastMonth',
  'thisYear'
];
export const STATS_DEFAULT_PERIOD: StatsPeriodPreset = '30d';
export type StatsGranularity = 'day' | 'week' | 'month';
export const STATS_GRANULARITIES: readonly StatsGranularity[] = ['day', 'week', 'month'];
export type StatsPlacementFilter = PlacementId | 'all';

// Le serveur refuse plus de 1 100 jours d'écart entre `from` et `to`.
export const STATS_MAX_RANGE_DAYS = 1100;
// Jour interdit au-delà de 92 jours, semaine au-delà de 731 ; le mois reste toujours possible.
const STATS_DAY_MAX_SPAN = 92;
const STATS_WEEK_MAX_SPAN = 731;
// Choix automatique : jour jusqu'à 31 jours, semaine jusqu'à 92, mois au-delà.
const STATS_AUTO_DAY_SPAN = 31;
const STATS_AUTO_WEEK_SPAN = 92;

const ROLLING_PRESET_DAYS: Partial<Record<StatsPeriodPreset, number>> = { '7d': 7, '30d': 30, '90d': 90 };

export interface StatsPeriodRange {
  from: string;
  to: string;
  // Période de comparaison ; null pour « tout ».
  previousFrom: string | null;
  previousTo: string | null;
}

const DAY_MS = 86_400_000;

const dateKeyToUtc = (key: string) => {
  const [year, month, day] = key.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
};

const utcToDateKey = (time: number) => new Date(time).toISOString().slice(0, 10);

const minKey = (a: string, b: string) => (a < b ? a : b);
const maxKey = (a: string, b: string) => (a > b ? a : b);

// Nombre de jours de `from` à `to`, les deux compris.
export function countStatsDays(from: string, to: string): number {
  return Math.round((dateKeyToUtc(to) - dateKeyToUtc(from)) / DAY_MS) + 1;
}

const getMonthStart = (key: string) => `${key.slice(0, 7)}-01`;

const getMonthEnd = (key: string) => {
  const [year, month] = key.split('-').map(Number);
  return utcToDateKey(Date.UTC(year, month, 0));
};

// Lundi de la semaine ISO du jour donné.
export function getIsoWeekStart(key: string): string {
  const weekday = (new Date(dateKeyToUtc(key)).getUTCDay() + 6) % 7;
  return shiftDateKey(key, -weekday);
}

// Même jour `deltaMonths` mois plus tôt ou plus tard, ramené au dernier jour
// du mois s'il n'existe pas (31 mars − 1 mois = 28 ou 29 février).
export function shiftMonthKey(key: string, deltaMonths: number): string {
  const [year, month, day] = key.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month - 1 + deltaMonths + 1, 0)).getUTCDate();
  return utcToDateKey(Date.UTC(year, month - 1 + deltaMonths, Math.min(day, lastDay)));
}

// Bornes d'une période, en jours de Paris (`today` vient du serveur quand il
// l'a donné). Périodes glissantes : comparées aux N jours juste avant. Mois et
// 12 mois : comparés au même découpage un mois (ou un an) plus tôt, pour que
// « septembre » se compare à « août » ; les longueurs peuvent alors différer
// de quelques jours, d'où la variation de la moyenne par jour à côté de celle
// du total.
export function getStatsPeriodRange(
  preset: StatsPeriodPreset,
  { today, firstDate = null }: { today: string; firstDate?: string | null }
): StatsPeriodRange {
  const rollingDays = ROLLING_PRESET_DAYS[preset];
  if (rollingDays) {
    const from = shiftDateKey(today, -(rollingDays - 1));
    const previousTo = shiftDateKey(from, -1);
    return { from, to: today, previousFrom: shiftDateKey(previousTo, -(rollingDays - 1)), previousTo };
  }

  if (preset === 'today' || preset === 'yesterday') {
    const day = preset === 'today' ? today : shiftDateKey(today, -1);
    const previous = shiftDateKey(day, -1);
    return { from: day, to: day, previousFrom: previous, previousTo: previous };
  }

  // Semaine du lundi à aujourd'hui, comparée aux mêmes jours de la semaine d'avant.
  if (preset === 'thisWeek') {
    const from = getIsoWeekStart(today);
    return { from, to: today, previousFrom: shiftDateKey(from, -7), previousTo: shiftDateKey(today, -7) };
  }

  // Année du 1er janvier à aujourd'hui, comparée aux mêmes jours de l'an dernier.
  if (preset === 'thisYear') {
    const from = `${today.slice(0, 4)}-01-01`;
    return { from, to: today, previousFrom: shiftMonthKey(from, -12), previousTo: shiftMonthKey(today, -12) };
  }

  if (preset === 'thisMonth') {
    const from = getMonthStart(today);
    const previousFrom = getMonthStart(shiftMonthKey(today, -1));
    const previousTo = minKey(shiftDateKey(previousFrom, countStatsDays(from, today) - 1), getMonthEnd(previousFrom));
    return { from, to: today, previousFrom, previousTo };
  }

  if (preset === 'lastMonth') {
    const from = getMonthStart(shiftMonthKey(today, -1));
    const previousFrom = getMonthStart(shiftMonthKey(from, -1));
    return { from, to: getMonthEnd(from), previousFrom, previousTo: getMonthEnd(previousFrom) };
  }

  if (preset === '12m') {
    const from = getMonthStart(shiftMonthKey(today, -11));
    return { from, to: today, previousFrom: shiftMonthKey(from, -12), previousTo: shiftMonthKey(today, -12) };
  }

  // « Tout » : depuis le premier jour en base, borné à ce que le serveur accepte.
  const oldest = shiftDateKey(today, -(STATS_MAX_RANGE_DAYS - 1));
  const from = firstDate && /^\d{4}-\d{2}-\d{2}$/.test(firstDate) ? minKey(maxKey(firstDate, oldest), today) : today;
  return { from, to: today, previousFrom: null, previousTo: null };
}

// Dates choisies à la main dans le calendrier : remises dans l'ordre, écart
// ramené à ce que le serveur accepte (la fin est gardée), comparées aux N jours
// juste avant.
export function getStatsCustomRange(start: string, end: string): StatsPeriodRange {
  const to = maxKey(start, end);
  const from = maxKey(minKey(start, end), shiftDateKey(to, -(STATS_MAX_RANGE_DAYS - 1)));
  const days = countStatsDays(from, to);
  const previousTo = shiftDateKey(from, -1);
  return { from, to, previousFrom: shiftDateKey(previousTo, -(days - 1)), previousTo };
}

export function getAllowedStatsGranularities(from: string, to: string): StatsGranularity[] {
  const span = countStatsDays(from, to);
  return STATS_GRANULARITIES.filter((granularity) => (
    granularity === 'month'
    || (granularity === 'week' && span <= STATS_WEEK_MAX_SPAN)
    || (granularity === 'day' && span <= STATS_DAY_MAX_SPAN)
  ));
}

export function getDefaultStatsGranularity(from: string, to: string): StatsGranularity {
  const span = countStatsDays(from, to);
  if (span <= STATS_AUTO_DAY_SPAN) {
    return 'day';
  }
  return span <= STATS_AUTO_WEEK_SPAN ? 'week' : 'month';
}

// Choix de l'admin s'il est permis pour la période, sinon le choix automatique.
export function resolveStatsGranularity(choice: StatsGranularity | null, from: string, to: string): StatsGranularity {
  return choice && getAllowedStatsGranularities(from, to).includes(choice)
    ? choice
    : getDefaultStatsGranularity(from, to);
}

// Variation relative (0,5 = +50 %) ; null quand il n'y a rien à quoi comparer.
export function computeStatsChange(current: number, previous: number | null | undefined): number | null {
  if (previous === null || previous === undefined || !Number.isFinite(previous) || previous <= 0) {
    return null;
  }
  return (current - previous) / previous;
}

// ─── Vue de la section Statistiques ────────────────────────────────────────

export interface MonetizationStatsBucket {
  // Début théorique du groupe : le jour, le lundi de la semaine ou le 1er du mois.
  key: string;
  // Bornes réelles, coupées à la période (première et dernière semaine ou mois).
  from: string;
  to: string;
  days: number;
  partial: boolean;
  // Ouvertures par pub (id), puis celles où aucune pub n'était éligible.
  byAd: Record<string, number>;
  served: number;
  none: number;
  // Variation de la moyenne par jour par rapport au groupe d'avant (plus
  // ancien) : un groupe coupé se compare quand même équitablement.
  change: number | null;
}

export interface MonetizationStatsAggregate {
  from: string;
  to: string;
  days: number;
  served: number;
  none: number;
  average: number;
  bestDay: { date: string; count: number } | null;
}

export interface MonetizationPeriodStats {
  granularity: StatsGranularity;
  // Du plus ancien au plus récent, groupes vides compris.
  buckets: MonetizationStatsBucket[];
  current: MonetizationStatsAggregate;
  // `complete` faux quand la période précédente commence avant le premier jour en base.
  previous: (MonetizationStatsAggregate & { complete: boolean }) | null;
  // Variations des chiffres clés ; null sans période précédente comparable.
  changes: { served: number | null; average: number | null; bestDay: number | null; none: number | null };
  perAd: Record<string, { period: number; today: number }>;
  // Toujours sur tous les emplacements : c'est la ventilation qui sert de filtre.
  perPlacement: Record<PlacementId, { served: number; none: number }>;
  includesToday: boolean;
}

export interface MonetizationPeriodStatsOptions extends StatsPeriodRange {
  granularity: StatsGranularity;
  placement: StatsPlacementFilter;
  today: string;
  firstDate?: string | null;
}

const getBucketKey = (date: string, granularity: StatsGranularity) => {
  if (granularity === 'week') {
    return getIsoWeekStart(date);
  }
  return granularity === 'month' ? getMonthStart(date) : date;
};

function createBuckets(from: string, to: string, granularity: StatsGranularity): MonetizationStatsBucket[] {
  const buckets: MonetizationStatsBucket[] = [];
  let start = from;
  while (start <= to) {
    const key = getBucketKey(start, granularity);
    const naturalEnd = granularity === 'week'
      ? shiftDateKey(key, 6)
      : granularity === 'month' ? getMonthEnd(key) : key;
    const end = minKey(naturalEnd, to);
    buckets.push({
      key,
      from: start,
      to: end,
      days: countStatsDays(start, end),
      partial: start !== key || end !== naturalEnd,
      byAd: {},
      served: 0,
      none: 0,
      change: null
    });
    start = shiftDateKey(end, 1);
  }
  return buckets;
}

const createAggregate = (from: string, to: string): MonetizationStatsAggregate => ({
  from,
  to,
  days: countStatsDays(from, to),
  served: 0,
  none: 0,
  average: 0,
  bestDay: null
});

// Une seule passe sur les compteurs bruts du serveur (période précédente
// comprise, chargée dans le même appel), pour la période, le regroupement et
// l'emplacement choisis. Tout ce qui est affiché sous les filtres en sort,
// pour que les chiffres concordent partout.
export function buildMonetizationPeriodStats(
  days: MonetizationStatsDay[],
  options: MonetizationPeriodStatsOptions
): MonetizationPeriodStats {
  const { from, to, previousFrom, previousTo, granularity, placement, today, firstDate = null } = options;
  const buckets = createBuckets(from, to, granularity);
  const bucketByKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  const current = createAggregate(from, to);
  const hasPrevious = Boolean(previousFrom && previousTo && previousFrom <= previousTo);
  const previous = hasPrevious ? createAggregate(previousFrom!, previousTo!) : null;
  const perAd: MonetizationPeriodStats['perAd'] = {};
  const perPlacement = Object.fromEntries(
    MONETIZATION_PLACEMENT_IDS.map((id) => [id, { served: 0, none: 0 }])
  ) as MonetizationPeriodStats['perPlacement'];
  const servedByDay = new Map<string, number>();
  const previousServedByDay = new Map<string, number>();

  for (const day of days) {
    const inCurrent = day.date >= from && day.date <= to;
    const inPrevious = previous !== null && day.date >= previous.from && day.date <= previous.to;
    if (!inCurrent && !inPrevious) {
      continue;
    }
    const bucket = inCurrent ? bucketByKey.get(getBucketKey(day.date, granularity)) : undefined;

    for (const [key, rawCount] of Object.entries(day.counts)) {
      const count = Number.isFinite(rawCount) ? rawCount : 0;
      const separator = key.lastIndexOf('|');
      if (separator <= 0 || count <= 0) {
        continue;
      }
      const adId = key.slice(0, separator);
      const placementId = key.slice(separator + 1) as PlacementId;
      const isNone = adId === 'none';

      if (inCurrent && perPlacement[placementId]) {
        perPlacement[placementId][isNone ? 'none' : 'served'] += count;
      }
      if (placement !== 'all' && placementId !== placement) {
        continue;
      }

      if (inPrevious && previous) {
        if (isNone) {
          previous.none += count;
        } else {
          previous.served += count;
          previousServedByDay.set(day.date, (previousServedByDay.get(day.date) ?? 0) + count);
        }
      }
      if (!inCurrent) {
        continue;
      }
      if (isNone) {
        current.none += count;
        if (bucket) bucket.none += count;
        continue;
      }
      current.served += count;
      servedByDay.set(day.date, (servedByDay.get(day.date) ?? 0) + count);
      if (bucket) {
        bucket.served += count;
        bucket.byAd[adId] = (bucket.byAd[adId] ?? 0) + count;
      }
      const entry = perAd[adId] ?? (perAd[adId] = { period: 0, today: 0 });
      entry.period += count;
      if (day.date === today) {
        entry.today += count;
      }
    }
  }

  // Meilleure journée : le plus d'ouvertures ; à égalité, la plus récente.
  const findBestDay = (byDay: Map<string, number>) => {
    let best: { date: string; count: number } | null = null;
    for (const [date, count] of byDay) {
      if (count > 0 && (!best || count > best.count || (count === best.count && date > best.date))) {
        best = { date, count };
      }
    }
    return best;
  };

  current.average = current.days > 0 ? current.served / current.days : 0;
  current.bestDay = findBestDay(servedByDay);
  if (previous) {
    previous.average = previous.days > 0 ? previous.served / previous.days : 0;
    previous.bestDay = findBestDay(previousServedByDay);
  }

  buckets.forEach((bucket, index) => {
    const before = buckets[index - 1];
    bucket.change = before ? computeStatsChange(bucket.served / bucket.days, before.served / before.days) : null;
  });

  // Une période précédente qui commence avant le premier jour en base
  // compterait des jours sans données : pas de variation dans ce cas.
  const complete = previous !== null && (!firstDate || firstDate <= previous.from);
  const comparable = previous && complete ? previous : null;

  return {
    granularity,
    buckets,
    current,
    previous: previous ? { ...previous, complete } : null,
    changes: {
      served: comparable ? computeStatsChange(current.served, comparable.served) : null,
      average: comparable ? computeStatsChange(current.average, comparable.average) : null,
      bestDay: comparable ? computeStatsChange(current.bestDay?.count ?? 0, comparable.bestDay?.count ?? 0) : null,
      none: comparable ? computeStatsChange(current.none, comparable.none) : null
    },
    perAd,
    perPlacement,
    includesToday: today >= from && today <= to
  };
}
