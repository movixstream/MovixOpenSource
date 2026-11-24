// Mise en forme partagée par les pages des collections : nom affiché, années,
// durées, montants. Rien ici ne lit le réseau ni le stockage.

import type { SagaProductionData } from './types';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Vrai si au moins une des quatre listes de production a du contenu. */
export const hasProductionData = (info: SagaProductionData): boolean =>
  info.productionCompanies.length > 0
  || info.productionCountries.length > 0
  || info.spokenLanguages.length > 0
  || info.genres.length > 0;

// Suffixe que TMDB ajoute au nom : « Harry Potter - Saga », « Alien – Saga »,
// « Harry Potter Collection », « Star Wars - Collection ».
const SAGA_NAME_SUFFIX = /\s*(?:[-–—:]\s*(?:saga|collection)|\s+collection)\s*$/i;

/**
 * Nom à afficher, sans le suffixe TMDB. Le nom complet reste celui du `alt`,
 * de la recherche et des listes enregistrées.
 */
export function stripSagaSuffix(name: string): string {
  const stripped = name.replace(SAGA_NAME_SUFFIX, '').trim();
  return stripped || name;
}

/** « 2001 – 2011 », « 2001 » pour une seule année, null sans date connue. */
export function getSagaYears(parts: ReadonlyArray<{ release_date?: string | null }>): string | null {
  const years = parts
    .map((part) => Number.parseInt((part.release_date || '').slice(0, 4), 10))
    .filter((year) => Number.isFinite(year) && year > 0);
  if (years.length === 0) return null;
  const first = Math.min(...years);
  const last = Math.max(...years);
  return first === last ? String(first) : `${first} – ${last}`;
}

/** Année d'une date TMDB (« 2004-05-31 »), null si elle manque. */
export function getYear(date: string | null | undefined): number | null {
  const year = Number.parseInt((date || '').slice(0, 4), 10);
  return Number.isFinite(year) && year > 0 ? year : null;
}

/** « 2 h 33 », « 45 min » ; null pour une durée inconnue. */
export function formatRuntime(minutes: number | null | undefined, t: Translate): string | null {
  if (!minutes || !Number.isFinite(minutes) || minutes <= 0) return null;
  const total = Math.round(minutes);
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return t('collections.durationMinutes', { minutes: rest });
  return t('collections.durationHours', { hours, minutes: String(rest).padStart(2, '0') });
}

/** « 7,8 » en français, « 7.8 » en anglais. */
export function formatRating(value: number, language: string): string {
  return value.toLocaleString(language, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** « 1,28 Md $ », « 160 M $ » : montant en dollars, abrégé. */
export function formatCompactMoney(value: number, language: string, signed = false): string {
  return new Intl.NumberFormat(language, {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'narrowSymbol',
    notation: 'compact',
    maximumSignificantDigits: 3,
    signDisplay: signed ? 'exceptZero' : 'auto',
  }).format(value);
}

/** « +506 % » : part du budget, toujours signée. */
export function formatSignedPercent(percent: number, language: string): string {
  return new Intl.NumberFormat(language, {
    style: 'percent',
    maximumFractionDigits: 0,
    signDisplay: 'exceptZero',
  }).format(percent / 100);
}

/**
 * Nom d'un pays ou d'une langue dans la langue du site. TMDB renvoie les pays
 * en anglais et les langues dans leur propre langue ; le code ISO permet de
 * les traduire. Sans traduction connue, on garde le nom de TMDB.
 */
export function localizeIsoName(
  type: 'region' | 'language',
  code: string,
  fallback: string,
  language: string,
): string {
  try {
    const name = new Intl.DisplayNames([language], { type }).of(code);
    if (!name || name.toLowerCase() === code.toLowerCase()) return fallback || code;
    return name.charAt(0).toLocaleUpperCase(language) + name.slice(1);
  } catch {
    return fallback || code;
  }
}
