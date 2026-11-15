import type { TFunction } from 'i18next';
import type { WrappedData, WrappedTopContent } from '@/services/wrappedService';
import type { WrappedScene, WrappedShareCardData, WrappedSignatureScene } from '@/types/wrapped';
import { selectWrappedScenes, wrappedGenreKey, wrappedSignatureKind, wrappedTraitFacts } from './wrappedStory.ts';
import { wrappedThemeFor } from './wrappedTheme.ts';

// Les formateurs Intl sont coûteux à créer pendant un survol de graphique.
// Cache borné : aucun stockage de données personnelles ni de libellés utilisateur.
const numberFormatters = new Map<string, Intl.NumberFormat>();
const monthFormatters = new Map<string, Intl.DateTimeFormat>();

function numberFormatter(locale: string) {
    let formatter = numberFormatters.get(locale);
    if (!formatter) {
        formatter = new Intl.NumberFormat(locale);
        if (numberFormatters.size >= 12) numberFormatters.delete(numberFormatters.keys().next().value!);
        numberFormatters.set(locale, formatter);
    }
    return formatter;
}

export function getWrappedScenes(data: WrappedData): WrappedScene[] {
    return selectWrappedScenes(data);
}

export function wrappedMediaKey(item: Pick<WrappedTopContent, 'type' | 'tmdbId' | 'title'>): string {
    return `${item.type}:${item.tmdbId ?? item.title}`;
}

/** Le backend fournit normalement un chemin TMDB ; accepter aussi ses URLs complètes. */
export function wrappedImageUrl(path: string | null | undefined, size: 'w500' | 'w1280' = 'w500'): string | null {
    if (!path?.trim()) return null;
    if (path.startsWith('/') && !path.startsWith('//')) return `https://image.tmdb.org/t/p/${size}${path}`;
    try {
        const url = new URL(path);
        return url.protocol === 'https:' && url.hostname === 'image.tmdb.org' ? url.href : null;
    } catch {
        return null;
    }
}

export function formatWrappedDuration(minutes: number, locale: string): string {
    return formatWrappedDurationParts(minutes, locale).join(' ');
}

export function formatWrappedDurationParts(minutes: number, locale: string): string[] {
    const safe = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0;
    const hours = Math.floor(safe / 60);
    const remaining = safe % 60;
    const number = numberFormatter(locale);
    return hours ? [`${number.format(hours)} h`, ...(remaining ? [`${number.format(remaining)} min`] : [])] : [`${number.format(safe)} min`];
}

export function wrappedSignaturePeriod(year: number, locale: string, t: TFunction, now = new Date()): string {
    const month = now.getMonth() + 1;
    const values = { start: wrappedMonth(1, locale, true), month: wrappedMonth(month, locale, true), end: wrappedMonth(12, locale, true), next: wrappedMonth(Math.min(12, month + 1), locale, true) };
    return t(year === now.getFullYear() ? (month < 12 ? 'wrappedCinema.signaturePeriodCurrent' : 'wrappedCinema.signaturePeriodDecember') : 'wrappedCinema.signaturePeriodComplete', values);
}

export function wrappedMonth(month: number, locale: string, short = false): string {
    if (!Number.isInteger(month) || month < 1 || month > 12) return '—';
    const key = `${locale}:${short}`;
    let formatter = monthFormatters.get(key);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat(locale, { month: short ? 'short' : 'long', timeZone: 'UTC' });
        if (monthFormatters.size >= 24) monthFormatters.delete(monthFormatters.keys().next().value!);
        monthFormatters.set(key, formatter);
    }
    return formatter.format(new Date(Date.UTC(2024, month - 1, 1)));
}

/** Initiale de mois pour les petites légendes (J, F, M…), sans dépendre du nom complet. */
export function wrappedMonthInitial(month: number, locale: string): string {
    if (!Number.isInteger(month) || month < 1 || month > 12) return '—';
    try {
        return new Intl.DateTimeFormat(locale, { month: 'narrow', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, month - 1, 1))).toLocaleUpperCase(locale);
    } catch {
        return String(month);
    }
}

export function wrappedDate(value: string | undefined, locale: string): string {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(date);
}

export function wrappedPeriod(data: WrappedData, locale: string, t: TFunction, now = new Date()): string {
    if (data.isDemo || data.year < now.getFullYear()) return t('wrappedFinish.fullYear', { year: data.year });
    return t('wrappedFinish.yearToDate', { date: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(now) });
}

export function wrappedTypeLabel(type: string, t: TFunction): string {
    if (type === 'anime') return t('wrappedCinema.animeType');
    const keys: Record<string, string> = { movie: 'movieType', tv: 'seriesSingular', anime: 'animeType', 'live-tv': 'liveTVLabel' };
    return t(`wrapped.${keys[type] || 'unknownContent'}`);
}

export function wrappedGenre(name: string, t: TFunction): string {
    const key = wrappedGenreKey(name);
    return key ? t(`wrappedStory.genres.${key}`) : name;
}

export function wrappedPersona(data: WrappedData, t: TFunction): string {
    return t(`wrappedStory.personas.${data.persona.id}`, { defaultValue: t('wrappedStory.personas.default') });
}

export function wrappedTraits(data: WrappedData, t: TFunction): { label: string; evidence: string }[] {
    return wrappedTraitFacts(data).map(trait => ({
        label: trait.id === 'format' ? t(`wrappedMotion.formatTraits.${trait.type}`, { defaultValue: wrappedTypeLabel(trait.type || '', t) }) : t(`wrappedMotion.traits.${trait.id}`),
        evidence: t(`wrappedMotion.evidence.${trait.id}`, { count: trait.count, percent: trait.percent, type: trait.type ? wrappedTypeLabel(trait.type, t) : '' }),
    }));
}

const share = (value: number, total: number) => total > 0 && Number.isFinite(value) ? Math.max(0, Math.min(1, value / total)) : 0;

/** Contenu du plan signature du film, déjà localisé ; null quand aucun fait ne le justifie. */
export function wrappedSignatureScene(data: WrappedData, locale: string, t: TFunction): WrappedSignatureScene | null {
    const kind = wrappedSignatureKind(data);
    if (!kind) return null;
    const title = t(`wrappedVideo.signature.${kind}`);
    const number = numberFormatter(locale);
    const percent = (value: number) => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(Math.max(0, value) / 100);
    if (kind === 'clock') {
        const clock = Array.from({ length: 24 }, (_, hour) => Math.max(0, data.listeningClock?.find(item => item.hour === hour)?.minutes || 0));
        const maximum = Math.max(...clock), total = clock.reduce((sum, value) => sum + value, 0);
        const peak = data.peakHour != null && data.peakHour >= 0 && data.peakHour < 24 ? data.peakHour : clock.indexOf(maximum);
        const hour = (value: number) => new Intl.DateTimeFormat(locale, { hour: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1, value)));
        const habit = wrappedTraitFacts(data).find(trait => trait.id === 'night' || trait.id === 'early');
        return {
            kind, title, label: t('wrappedStory.peakHour'), value: hour(peak), peak,
            caption: habit ? t(`wrappedMotion.evidence.${habit.id}`, { percent: habit.percent }) : t('wrappedVideo.signatureClockCaption', { percent: Math.round(share(clock[peak], total) * 100) }),
            rows: clock.map((minutes, index) => ({ label: hour(index), value: formatWrappedDuration(minutes, locale), share: share(minutes, maximum) })),
        };
    }
    if (kind === 'streak') {
        const days = Math.max(0, Math.round(data.stats.longestStreak || 0)), active = Math.max(0, Math.round(data.stats.totalActiveDays || 0));
        return {
            kind, title, label: t('wrappedVideo.signatureStreakLabel'), value: number.format(days), unit: t('wrappedStory.consecutiveDays'),
            caption: active ? t('wrappedVideo.signatureActiveDays', { count: active }) : undefined, rows: [],
        };
    }
    if (kind === 'community' && data.community) {
        const { commentsPosted, repliesPosted, discussedTitles } = data.community;
        const total = Math.max(0, commentsPosted) + Math.max(0, repliesPosted);
        const values = [commentsPosted, repliesPosted, discussedTitles].map(value => Math.max(0, value || 0));
        const maximum = Math.max(...values);
        return {
            kind, title, label: t('wrappedCinema.communityKicker'), value: number.format(total), unit: t('wrappedCinema.spokenContributions', { count: total }),
            caption: t('wrappedCinema.communityStoryHint'), peak: values.indexOf(maximum),
            rows: ['comments', 'replies', 'discussedTitles'].map((key, index) => ({ label: t(`wrappedCinema.${key}`), value: number.format(values[index]), share: share(values[index], maximum) })),
        };
    }
    if (kind === 'formats') {
        const formats = data.byType.filter(item => item.minutes > 0).sort((a, b) => b.minutes - a.minutes);
        return {
            kind, title, label: t('wrappedVideo.signatureFormatsLabel'), value: wrappedTypeLabel(formats[0].type, t), peak: 0,
            caption: t('wrappedMotion.evidence.format', { percent: formats[0].percent }),
            rows: formats.map(item => ({ label: wrappedTypeLabel(item.type, t), value: percent(item.percent), share: share(item.percent, 100) })),
        };
    }
    // Genres : parts indépendantes, car un titre peut avoir plusieurs genres.
    const genres = (data.topGenres || []).filter(item => item.minutes > 0).slice(0, 4);
    if (!genres.length) return null;
    return {
        kind: 'genres', title, label: t('wrappedCinema.genresKicker'), value: wrappedGenre(genres[0].name, t), peak: 0,
        caption: t('wrappedCinema.overlappingGenres'),
        rows: genres.map(item => ({ label: wrappedGenre(item.name, t), value: percent(item.percent), share: share(item.percent, 100) })),
    };
}

export function buildWrappedShareData(data: WrappedData, locale: string, t: TFunction, domain: string): WrappedShareCardData {
    const now = data.isDemo ? new Date(data.year + 1, 0, 1) : new Date();
    return {
        year: data.year,
        domain,
        theme: wrappedThemeFor(data),
        signatureScene: wrappedSignatureScene(data, locale, t),
        backdropUrl: wrappedImageUrl(data.topContent[0]?.backdrop_path, 'w1280'),
        period: wrappedPeriod(data, locale, t, now),
        watchTime: formatWrappedDuration(data.stats.totalMinutes, locale),
        watchTimeParts: formatWrappedDurationParts(data.stats.totalMinutes, locale),
        titleCount: new Intl.NumberFormat(locale).format(data.stats.uniqueTitles),
        persona: wrappedPersona(data, t),
        traits: wrappedTraits(data, t),
        signature: Array.from({ length: 12 }, (_, i) => {
            const value = data.monthlyGraph?.find(month => month.month === i + 1)?.minutes || 0;
            return Number.isFinite(value) ? Math.max(0, value) : 0;
        }),
        signatureCaption: wrappedSignaturePeriod(data.year, locale, t, now),
        signatureFutureFrom: data.year === now.getFullYear() && now.getMonth() < 11 ? now.getMonth() + 2 : null,
        monthLabels: Array.from({ length: 12 }, (_, i) => wrappedMonthInitial(i + 1, locale)),
        items: data.topContent.slice(0, 5).map(item => ({
            title: item.title,
            posterUrl: wrappedImageUrl(item.poster_path),
            duration: formatWrappedDuration(item.minutes, locale),
            minutes: Number.isFinite(item.minutes) ? Math.max(0, item.minutes) : 0,
        })),
        labels: {
            heading: t('wrappedStory.exportHeading'), favorite: t('wrappedStory.favoriteLabel'),
            watchTime: t('wrapped.shareWatchTimeLabel'), titles: t('wrapped.uniqueTitlesLabel'),
            persona: t('wrappedStory.personaLabel'), topFive: t('wrappedStory.topFiveTitle'),
            ticket: t('wrappedStory.ticketHeading'), imageUnavailable: t('wrappedStory.imageUnavailable'),
            signature: t('wrappedCinema.signatureLabel'),
            presents: t('wrappedStory.presents'), admit: t('wrappedStory.admitOne'),
        },
    };
}

/** Un maintien ne navigue pas ; un mouvement vertical reste un défilement. */
export function wrappedGesture(dx: number, dy: number, elapsedMs: number, position: number): -1 | 0 | 1 {
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) return dx < 0 ? 1 : -1;
    if (Math.abs(dx) <= 8 && Math.abs(dy) <= 8 && elapsedMs < 300) return position < 0.35 ? -1 : 1;
    return 0;
}
