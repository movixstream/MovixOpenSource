import type { TFunction } from 'i18next';
import type { MovieReleaseCatalog, MovieReleaseEntry, MovieReleaseType } from '@/types/movieRelease';

const RELEASE_ADVANCE_MS = 6 * 60 * 60_000;

const dateOnly = (value: unknown): string | null => {
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)
    || !Number.isFinite(Date.parse(value))) return null;
  // Les release_dates TMDB sont des jours, même lorsqu'ils sont encodés en ISO.
  const date = value.slice(0, 10);
  return new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date ? date : null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const parseMovieReleases = (data: unknown, primaryDate?: string | null): MovieReleaseCatalog => {
  const releases: MovieReleaseEntry[] = [];
  if (isRecord(data) && Array.isArray(data.results)) {
    for (const region of data.results) {
      if (!isRecord(region) || !Array.isArray(region.release_dates)) continue;
      const country = typeof region.iso_3166_1 === 'string' && /^[A-Z]{2}$/.test(region.iso_3166_1)
        ? region.iso_3166_1 : null;
      for (const release of region.release_dates) {
        if (!isRecord(release) || typeof release.type !== 'number' || !Number.isInteger(release.type)
          || release.type < 1 || release.type > 6) continue;
        const date = dateOnly(release.release_date);
        if (date) releases.push({ date, country, type: release.type as MovieReleaseType });
      }
    }
  }
  const regionPriority = (country: string | null) => country === 'FR' ? 0 : country === 'US' ? 1 : 2;
  releases.sort((a, b) => a.date.localeCompare(b.date) || regionPriority(a.country) - regionPriority(b.country));
  return {
    theatrical: releases.find(({ type }) => type === 2 || type === 3) ?? null,
    digital: releases.find(({ type }) => type === 4) ?? null,
    homeVideo: releases.find(({ type }) => type === 4 || type === 5 || type === 6) ?? null,
    referenceDate: dateOnly(primaryDate) ?? releases[0]?.date ?? null,
  };
};

/** Marge d'affichage de six heures avant le début local du jour annoncé. */
export const isMovieReleaseDatePending = (date: string | null, now = Date.now()): boolean => {
  const valid = dateOnly(date);
  if (!valid || !Number.isFinite(now)) return false;
  const releaseDayStart = new Date(`${valid}T00:00:00`).getTime();
  return now < releaseDayStart - RELEASE_ADVANCE_MS;
};

export const needsMovieReleaseWarning = (releases: MovieReleaseCatalog, now = Date.now()): boolean =>
  isMovieReleaseDatePending(releases.homeVideo?.date ?? releases.referenceDate, now);

export const formatMovieReleaseDate = (value: string | null | undefined, language: string): string | null => {
  const date = dateOnly(value);
  if (!date) return null;
  // Une langue vide ou inconnue, ou l'Intl incomplet d'une TV (GlitchTip CO),
  // fait jeter le formateur : retomber sur la locale par défaut, puis sur l'ISO.
  for (const locale of [language || undefined, undefined]) {
    try {
      return new Intl.DateTimeFormat(locale, {
        year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
      }).format(Date.parse(`${date}T00:00:00Z`));
    } catch {
      // Essayer la locale suivante.
    }
  }
  return date;
};

// Intl.DisplayNames manque sur les moteurs anciens et jette sur une langue
// vide : l'Intl partiel d'une TV LG l'a fait planter (GlitchTip CO). Le code
// pays brut reste lisible.
const countryLabel = (country: string, language: string): string => {
  try {
    return new Intl.DisplayNames([language || 'en'], { type: 'region' }).of(country) || country;
  } catch {
    return country;
  }
};

export const getMovieReleaseLabel = (
  release: MovieReleaseEntry | null,
  kind: 'digital' | 'theatrical' | 'homeVideo',
  t: TFunction,
  language: string,
  now = Date.now(),
): string => {
  if (!release) {
    const key = kind === 'homeVideo' ? 'details.movieRelease.unknownHomeVideo'
      : kind === 'digital' ? 'details.movieRelease.unknownDigital' : 'details.movieRelease.unknownTheatrical';
    return t(key);
  }
  const region = release.country ? countryLabel(release.country, language) : null;
  const country = region ? t('details.movieRelease.country', { country: region }) : '';
  const date = formatMovieReleaseDate(release.date, language);
  const format = kind === 'homeVideo' && release.type === 5 ? 'physical'
    : kind === 'homeVideo' && release.type === 6 ? 'television' : 'digital';
  const key = kind === 'theatrical' ? 'details.movieRelease.theatricalDate'
    : `details.movieRelease.${format}${isMovieReleaseDatePending(release.date, now) ? 'Scheduled' : 'Date'}`;
  return t(key, { date, country });
};
