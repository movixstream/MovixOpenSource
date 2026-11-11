import type { TFunction } from 'i18next';
import type { TvAiringSchedule, TvAiringStatus, TvEpisodeDate } from '@/types/tvAiring';
import { getNumericDateParts } from '@/utils/dateParts';

const DAY_MS = 86_400_000;

const validDate = (value: string | null | undefined): string | null => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
    ? value : null;
};

export const resolveEpisodeAiring = (
  episode: TvEpisodeDate,
  schedule: TvAiringSchedule | null,
  now = Date.now(),
): TvAiringStatus => {
  const tmdbDate = validDate(episode.air_date);
  const candidate = schedule?.episodes[`${episode.season_number}:${episode.episode_number}`];
  // Les découpages de saisons peuvent différer entre les deux catalogues.
  const match = candidate && (!tmdbDate || candidate.date === tmdbDate) ? candidate : null;
  const date = tmdbDate ?? validDate(match?.date);
  const stamp = match?.timestamp;
  const timestamp = stamp && /T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:\d{2})$/.test(stamp)
    ? Date.parse(stamp) : NaN;

  if (Number.isFinite(timestamp)) {
    const upcoming = now < timestamp;
    return { kind: upcoming ? 'upcoming' : 'aired', date, timestamp, needsWarning: upcoming };
  }

  // Sans heure précise, considérer la diffusion comme passée dès le jour local annoncé.
  const today = dateInZone(now);
  const hasAired = date !== null && date <= today;
  const needsWarning = date !== null && date > today;
  return { kind: hasAired ? 'aired' : 'unconfirmed', date, timestamp: null, needsWarning };
};

export const resolveShowAiring = (
  firstAirDate: string | null | undefined,
  schedule: TvAiringSchedule | null,
  now = Date.now(),
): TvAiringStatus => resolveEpisodeAiring({
  season_number: 1, episode_number: 1, air_date: firstAirDate,
}, schedule, now);

/** TMDB peut déjà ranger l'épisode du jour dans last_episode_to_air. */
export const getEpisodeTimeline = <T extends TvEpisodeDate>(
  episodes: T[], schedule: TvAiringSchedule | null, now = Date.now(),
): { last: T | null; next: T | null } => {
  const dated = episodes.filter((episode) => episode.season_number > 0).map((episode) => ({
    episode, airing: resolveEpisodeAiring(episode, schedule, now),
  })).filter(({ airing }) => airing.date !== null).sort((a, b) => {
    const time = (airing: TvAiringStatus) => airing.timestamp ?? Date.parse(`${airing.date}T00:00:00Z`);
    return time(a.airing) - time(b.airing);
  });
  const past = dated.filter(({ airing }) => airing.kind === 'aired');
  return {
    last: past[past.length - 1]?.episode ?? null,
    next: dated.find(({ airing }) => airing.kind !== 'aired')?.episode ?? null,
  };
};

const dateInZone = (timestamp: number, timeZone?: string): string => {
  const { year, month, day } = getNumericDateParts(new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone,
  }), timestamp);
  return `${year}-${month}-${day}`;
};

export const formatAiringDate = (
  airing: TvAiringStatus,
  language: string,
  timeZone?: string,
): string | null => {
  if (airing.timestamp !== null) {
    return new Intl.DateTimeFormat(language, {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      timeZoneName: 'short', timeZone,
    }).format(airing.timestamp);
  }
  return airing.date ? new Intl.DateTimeFormat(language, {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
  }).format(Date.parse(`${airing.date}T00:00:00Z`)) : null;
};

export const getAiringLabel = (
  airing: TvAiringStatus,
  t: TFunction,
  language: string,
  now = Date.now(),
  timeZone?: string,
): string => {
  if (airing.kind === 'aired') return t('details.airing.aired');
  const date = formatAiringDate(airing, language, timeZone);
  if (airing.timestamp === null) {
    if (!date) return t('details.airing.unknownDate');
    const past = airing.date! < dateInZone(now, timeZone);
    return t(past ? 'details.airing.announcedDate' : 'details.airing.scheduledDate', { date });
  }

  const today = dateInZone(now, timeZone);
  // Addition sur le calendrier civil, et non 24 h sur l'horloge locale (DST).
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
  const releaseDay = dateInZone(airing.timestamp, timeZone);
  const time = new Intl.DateTimeFormat(language, {
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short', timeZone,
  }).format(airing.timestamp);
  if (releaseDay === today) return t('details.airing.todayAt', { time });
  if (releaseDay === tomorrow) return t('details.airing.tomorrowAt', { time });
  return t('details.airing.scheduledAt', { date });
};
