/**
 * Wrapped 2026 Service
 * Fetches and manages Movix Wrapped data from the API
 */

import type { WrappedSession } from '@/types/wrapped';

const MAIN_API = import.meta.env.VITE_MAIN_API;

export interface WrappedSlide {
    // 'peak-month' n'est plus émis par le backend (remplacé par 'timeline') mais reste
    // renderable pour les payloads encore en cache Redis (TTL 10 min) — ne pas supprimer.
    type: 'intro' | 'top1' | 'top5' | 'top2-focus' | 'top3-focus' | 'persona' | 'peak-month' | 'top-genres' | 'listening-clock' | 'streak' | 'fun-fact' | 'closing' | 'detailed-stats' | 'session-summary' | 'watch-bookends' | 'timeline' | 'record-day' | 'rewatch' | 'watch-age' | 'pages-time' | 'quiz';
    title: string;
    subtitle?: string;
    text: string;
    highlight?: string;
    subtext?: string;
}

export interface WrappedPersona {
    id: string;
    title: string;
    emoji: string;
    subtitle: string;
    description: string;
    color: string;
}

export interface WrappedTopContent {
    rank: number;
    title: string;
    type: 'movie' | 'tv' | 'anime' | 'live-tv';
    minutes: number;
    hours: number;
    durationLabel?: string;
    tmdbId?: number;
    poster_path?: string;
    backdrop_path?: string | null;
    year?: number | null;
    vote_average?: number | null;
    genres?: string[];
}

export interface WrappedTypeStats {
    type: 'movie' | 'tv' | 'anime' | 'live-tv';
    minutes: number;
    count: number;
    percent: number;
}

export interface WrappedPeakMonth {
    month: number;
    name: string;
    minutes: number;
}

export interface WrappedStats {
    totalMinutes: number;
    totalHours: number;
    totalDays: number;
    uniqueTitles: number;
    totalSessions: number;
    avgSessionMinutes?: number;
    totalActiveDays?: number;
    longestStreak?: number;
    /** Part des membres qui ont regardé moins (1 à 99) ; null tant que le classement n'est pas calculé. */
    percentile?: number | null;
}

export interface WrappedGenre {
    name: string;
    minutes: number;
    percent: number;
}

export interface WrappedListeningClock {
    hour: number;
    minutes: number;
}

export interface WrappedFirstLastWatch {
    title: string;
    type: string;
    date: string;
    tmdbId?: number | null;
}

export interface WrappedData {
    year: number;
    /** Fixture frontend : simule une année terminée, sans modifier l'horloge réelle. */
    isDemo?: boolean;
    persona: WrappedPersona;
    slides: WrappedSlide[];
    stats: WrappedStats;
    topContent: WrappedTopContent[];
    byType: WrappedTypeStats[];
    topGenres?: WrappedGenre[];
    peakMonth: WrappedPeakMonth;
    monthlyGraph?: { month: number; minutes: number }[];
    listeningClock?: WrappedListeningClock[];
    peakHour?: number;
    firstWatch?: WrappedFirstLastWatch | null;
    lastWatch?: WrappedFirstLastWatch | null;
    topPages: { page: string; minutes: number }[];
    recordDay?: { date: string; minutes: number } | null;
    weekday?: { dow: number; minutes: number }[];
    rewatch?: { title: string; type: string; count: number } | null;
    watchAgeYear?: number | null;
    story?: import('@/types/wrappedStory').WrappedStoryData | null;
    community?: {
        commentsPosted: number;
        repliesPosted: number;
        discussedTitles: number;
        calendarTimezone: 'UTC';
        highlight?: import('@/types/wrappedStory').WrappedCommentHighlight | null;
        topTitles: { type: 'movie' | 'tv' | 'anime'; tmdbId: number; title: string; poster_path: string | null; contributions: number }[];
    } | null;
}

export interface WrappedProgress {
    isEligible: boolean;
    completionPercent: number;
    missingCriteriaCount: number;
    requirements: {
        minutes: number;
        uniqueTitles: number;
        sessions: number;
        activeDays: number;
    };
    current: {
        minutes: number;
        uniqueTitles: number;
        sessions: number;
        activeDays: number;
    };
    missing: {
        minutes: number;
        uniqueTitles: number;
        sessions: number;
        activeDays: number;
    };
}

export interface WrappedResponse {
    success: boolean;
    wrapped: WrappedData | null;
    progress?: WrappedProgress | null;
    message?: string;
    error?: string;
}

/**
 * Fetch Wrapped data for a specific year
 */
export async function fetchWrappedData(year: number, options: { signal?: AbortSignal; session?: WrappedSession } = {}): Promise<WrappedResponse> {
    const authToken = options.session ? options.session.token : localStorage.getItem('auth_token');
    const profileId = options.session ? options.session.profileId : localStorage.getItem('selected_profile_id');

    if (!authToken) {
        return {
            success: false,
            wrapped: null,
            error: 'Not authenticated'
        };
    }

    try {
        const headers: HeadersInit = {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json'
        };

        if (profileId) {
            headers['x-profile-id'] = profileId;
        }

        const response = await fetch(`${MAIN_API}/api/wrapped/generate/${year}`, {
            method: 'GET',
            headers,
            signal: options.signal,
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `HTTP ${response.status}`);
        }

        const data = await response.json();
        return data as WrappedResponse;
    } catch (error) {
        if (!options.signal?.aborted) console.error('[Wrapped] Error fetching data:', error);
        return {
            success: false,
            wrapped: null,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * Check if wrapped data is available for a year
 */
export async function checkWrappedAvailability(year: number): Promise<boolean> {
    const response = await fetchWrappedData(year);
    return response.success && response.wrapped !== null;
}
