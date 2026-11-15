export const WRAPPED_VIDEO_DURATION = 18;
export const WRAPPED_VIDEO_FPS = 30;
export const WRAPPED_VIDEO_FINAL_MIN_DURATION = 4;
/** Piste montée à son tempo natif : les changements de plan tombent sur le temps. */
export const WRAPPED_VIDEO_BEAT_SECONDS = 60 / 114;

export type WrappedVideoOptions = {
    watchTime: boolean;
    titleCount: boolean;
    favorite: boolean;
    portrait: boolean;
    /** Plan d'habitude choisi d'après le profil (horloge, série, genres…). */
    signature: boolean;
    sound: boolean;
};

export type WrappedVideoScene = 'intro' | 'watchTime' | 'titleCount' | 'signature' | 'favorite' | 'portrait' | 'final';

export type WrappedVideoBeat = { scene: WrappedVideoScene; start: number; end: number };

/** Le montage est calé sur la piste : la musique est proposée par défaut, toujours désactivable. */
export const DEFAULT_WRAPPED_VIDEO_OPTIONS: WrappedVideoOptions = {
    watchTime: true,
    titleCount: true,
    favorite: true,
    portrait: true,
    signature: true,
    sound: true,
};

export function hasWrappedVideoContent(options: Pick<WrappedVideoOptions, 'watchTime' | 'titleCount' | 'favorite' | 'portrait' | 'signature'>) {
    return options.watchTime || options.titleCount || options.favorite || options.portrait || options.signature;
}

/** Une option sans donnée (aucun titre, aucun plan signature) n'entre jamais dans le film. */
export function getEffectiveWrappedVideoOptions(options: WrappedVideoOptions, itemCount: number, hasSignature = false): WrappedVideoOptions {
    return { ...options, favorite: options.favorite && itemCount > 0, signature: options.signature && hasSignature };
}

/** Après un changement de profil, conserve toujours un contenu visible dans le film. */
export function normalizeWrappedVideoOptions(options: WrappedVideoOptions, itemCount: number, hasSignature = false): WrappedVideoOptions {
    const effective = getEffectiveWrappedVideoOptions(options, itemCount, hasSignature);
    if (hasWrappedVideoContent(effective)) return options;
    return { ...options, favorite: false, signature: false, portrait: true };
}

/**
 * Le générique reste à 18 secondes quelles que soient les cartes retenues.
 * L'introduction ne montre des affiches que lorsque le choix « numéro 1 » est actif.
 * Avec quatre plans, les statistiques gardent huit temps et les autres quatre chacun.
 */
export function buildWrappedVideoTimeline(options: WrappedVideoOptions): WrappedVideoBeat[] {
    const selected: WrappedVideoScene[] = [];
    if (options.watchTime) selected.push('watchTime');
    else if (options.titleCount) selected.push('titleCount');
    if (options.signature) selected.push('signature');
    if (options.favorite) selected.push('favorite');
    if (options.portrait) selected.push('portrait');
    if (!selected.length) return [{ scene: 'final', start: 0, end: WRAPPED_VIDEO_DURATION }];

    const introEnd = 6 * WRAPPED_VIDEO_BEAT_SECONDS;
    const finalStart = 26 * WRAPPED_VIDEO_BEAT_SECONDS;
    const compact = selected.length >= 4;
    const weights = selected.map(scene => scene === 'watchTime' || scene === 'titleCount' ? (compact ? 2 : 4) : (compact ? 1 : 3));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    let cursor = introEnd;
    let consumedWeight = 0;
    const beats: WrappedVideoBeat[] = [{ scene: 'intro', start: 0, end: introEnd }];
    selected.forEach((scene, index) => {
        const start = cursor;
        consumedWeight += weights[index];
        const end = index === selected.length - 1 ? finalStart : (6 + Math.round(10 * consumedWeight / totalWeight) * 2) * WRAPPED_VIDEO_BEAT_SECONDS;
        beats.push({ scene, start, end });
        cursor = end;
    });
    beats.push({ scene: 'final', start: finalStart, end: WRAPPED_VIDEO_DURATION });
    return beats;
}

export function getWrappedVideoBeatAt(time: number, timeline: WrappedVideoBeat[]): WrappedVideoBeat {
    const safeTime = Math.max(0, Math.min(WRAPPED_VIDEO_DURATION, time));
    return timeline.find(beat => safeTime >= beat.start && safeTime < beat.end) || timeline[timeline.length - 1];
}

export function getWrappedVideoProgress(time: number, beat: WrappedVideoBeat) {
    if (beat.end <= beat.start) return 1;
    return Math.max(0, Math.min(1, (time - beat.start) / (beat.end - beat.start)));
}
