import { useEffect, useRef, useCallback } from 'react';
import { getResolvedUserId } from '../utils/accountAuth';
import { createWrappedTracker, type WrappedTracker } from '../utils/wrappedTrackerCore';

const MAIN_API = import.meta.env.VITE_MAIN_API;

// Interval for sending data (30 seconds — reduced from 10s, 3x fewer network requests)
const SEND_INTERVAL_MS = 30_000;
const RETRY_DELAY_MS = 4_000;

interface ViewingData {
    contentType: 'movie' | 'tv' | 'anime' | 'live-tv';
    contentId: string;
    contentTitle?: string;
    seasonNumber?: number;
    episodeNumber?: number;
}

interface PageData {
    pageName: string;
    contentId?: string; // TMDB ID for detail pages (movie-details, tv-details)
    meta?: Record<string, unknown>;
}

type TrackerMode = 'viewing' | 'page';

type TrackerTarget =
    | { mode: 'viewing'; data: ViewingData }
    | { mode: 'page'; data: PageData };

interface UseWrappedTrackerOptions {
    mode: TrackerMode;
    viewingData?: ViewingData;
    pageData?: PageData;
    isActive?: boolean; // Control whether tracking is active (e.g., player is open)
}

/**
 * Hook to track viewing time and page visits for Movix Wrapped 2026.
 * Respects privacy_data_collection setting in localStorage.
 * Sends data every 30 seconds to minimize request spam.
 * Le cumul et les règles d'envoi sont dans utils/wrappedTrackerCore.ts.
 */
export function useWrappedTracker(options: UseWrappedTrackerOptions) {
    const { mode, isActive = true } = options;

    // Check if data collection is enabled
    const isDataCollectionEnabled = useCallback(() => {
        try {
            const setting = localStorage.getItem('privacy_data_collection');
            // Default to true, disable only if explicitly set to 'false'
            return setting !== 'false';
        } catch {
            // Pas de collecte si la préférence de confidentialité est illisible.
            return false;
        }
    }, []);

    // Get user and profile IDs
    // IMPORTANT: Priority must match the JWT token generation order in the server
    // The JWT 'sub' claim is set from OAuth provider IDs (Google/Discord), so we must prioritize those
    const getUserInfo = useCallback(() => {
        try {
            const authToken = localStorage.getItem('auth_token');
            const profileId = localStorage.getItem('selected_profile_id');
            let userId: string | null = getResolvedUserId();

            // Priority 5 (last resort): VIP Guest UUID
            if (!userId) {
                userId = localStorage.getItem('guest_uuid');
            }

            return { authToken, profileId, userId };
        } catch {
            // Firefox peut fermer le stockage avant le dernier tick (NS_ERROR_ABORT).
            return { authToken: null, profileId: null, userId: null };
        }
    }, []);

    // Envoie le temps d'une cible. `false` = à retenter (réseau, 429, 5xx) ;
    // sans compte ou sur un refus définitif (4xx), le temps est abandonné.
    const sendToApi = useCallback(async (target: TrackerTarget, seconds: number) => {
        const { authToken, profileId, userId } = getUserInfo();
        if (!authToken || !userId) return true;

        const now = new Date();
        const payload: Record<string, unknown> = {
            userId,
            profileId,
            type: target.mode,
            month: now.getMonth() + 1,
            year: now.getFullYear(),
            duration: seconds,
        };

        if (target.mode === 'viewing') {
            payload.contentType = target.data.contentType;
            payload.contentId = target.data.contentId;
            payload.contentTitle = target.data.contentTitle;
            payload.seasonNumber = target.data.seasonNumber;
            payload.episodeNumber = target.data.episodeNumber;
            payload.hourOfDay = now.getHours();
        } else {
            payload.pageName = target.data.pageName;
            payload.contentId = target.data.contentId;
            payload.meta = target.data.meta;
        }

        try {
            const response = await fetch(`${MAIN_API}/api/wrapped/track`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`,
                },
                body: JSON.stringify(payload),
                keepalive: true,
            });
            return response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429);
        } catch {
            // Silent fail — wrapped tracking is non-critical
            return false;
        }
    }, [getUserInfo]);

    const trackerRef = useRef<WrappedTracker<TrackerTarget> | null>(null);
    if (!trackerRef.current) {
        trackerRef.current = createWrappedTracker<TrackerTarget>({
            now: Date.now,
            collectionEnabled: isDataCollectionEnabled,
            send: sendToApi,
        });
    }
    const tracker = trackerRef.current;

    // La cible ne change que si le contenu change : un nouveau rendu du parent
    // ne doit ni relancer les envois ni couper le cumul en cours.
    const target: TrackerTarget | null = mode === 'viewing'
        ? (options.viewingData ? { mode, data: options.viewingData } : null)
        : (options.pageData ? { mode, data: options.pageData } : null);
    const targetKey = !target ? '' : target.mode === 'viewing'
        ? ['viewing', target.data.contentType, target.data.contentId, target.data.seasonNumber ?? '', target.data.episodeNumber ?? ''].join('|')
        : ['page', target.data.pageName, target.data.contentId ?? ''].join('|');
    const targetRef = useRef(target);
    targetRef.current = target;

    useEffect(() => {
        tracker.setActive(isActive);
    }, [tracker, isActive]);

    // Changement de contenu (film, épisode, chaîne) : le reste part à l'ancien.
    useEffect(() => {
        tracker.setTarget(targetRef.current);
    }, [tracker, targetKey]);

    useEffect(() => {
        const handleVisibilityChange = () => tracker.setVisible(!document.hidden);
        handleVisibilityChange();
        document.addEventListener('visibilitychange', handleVisibilityChange);
        // Envoi raté : un seul nouvel essai, vite. Le serveur ne crédite que le
        // temps réel des ~35 dernières secondes, attendre le cycle suivant
        // ferait perdre presque tout le temps de l'envoi raté.
        let retryTimer: ReturnType<typeof setTimeout> | undefined;
        const sendInterval = setInterval(() => {
            void tracker.tick().then((failed) => {
                if (!failed) return;
                clearTimeout(retryTimer);
                retryTimer = setTimeout(() => { void tracker.tick(); }, RETRY_DELAY_MS);
            });
        }, SEND_INTERVAL_MS);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            clearInterval(sendInterval);
            clearTimeout(retryTimer);
            // Démontage : envoie le reste de la cible en cours.
            tracker.setTarget(null);
        };
    }, [tracker]);

    return {
        isTracking: isActive && isDataCollectionEnabled(),
    };
}

export default useWrappedTracker;
