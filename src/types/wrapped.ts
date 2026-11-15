import type { WrappedTopContent } from '@/services/wrappedService';

export type WrappedScene = 'intro' | 'time' | 'timeline' | 'genres' | 'quiz' | 'favorite' | 'top-five' | 'rhythm' | 'community' | 'persona' | 'closing' | 'race' | 'eras' | 'awards';
export type WrappedVersion = 'A' | 'B';
export type WrappedShareFormat = 'story' | 'top-five' | 'poster' | 'ticket';
export type WrappedThemeId = 'electric' | 'thrill' | 'rush' | 'heart' | 'cosmos' | 'neon' | 'sun' | 'night';
export type WrappedSignatureKind = 'clock' | 'streak' | 'genres' | 'formats' | 'community';

/** Plan d'habitude choisi d'après le profil ; textes déjà localisés, parts entre 0 et 1. */
export interface WrappedSignatureScene {
    kind: WrappedSignatureKind;
    /** Nom court de l'option dans le film (« Ton horloge »). */
    title: string;
    label: string;
    value: string;
    unit?: string;
    caption?: string;
    rows: { label: string; value: string; share: number }[];
    /** Rang mis en avant dans `rows` (heure de pointe, format dominant…). */
    peak?: number;
}

export interface WrappedShareCardData {
    year: number;
    domain: string;
    /** Ambiance du film et des images, d'après le profil ou choisie par l'utilisateur. */
    theme?: WrappedThemeId;
    signatureScene?: WrappedSignatureScene | null;
    backdropUrl?: string | null;
    period?: string;
    watchTime: string;
    watchTimeParts: string[];
    titleCount: string;
    persona: string;
    traits?: { label: string; evidence: string }[];
    signature: number[];
    signatureCaption: string;
    signatureFutureFrom: number | null;
    /** Initiales localisées des douze mois, dans l'ordre du calendrier. */
    monthLabels?: string[];
    items: Array<Pick<WrappedTopContent, 'title'> & { posterUrl: string | null; duration: string; minutes?: number }>;
    labels: {
        heading: string;
        favorite: string;
        watchTime: string;
        titles: string;
        persona: string;
        topFive: string;
        ticket: string;
        imageUnavailable: string;
        signature: string;
        presents?: string;
        admit?: string;
    };
}

export interface WrappedSession {
    token: string | null;
    profileId: string | null;
    collectionEnabled: boolean;
}
