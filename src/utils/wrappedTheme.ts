/**
 * Ambiances du film et des images récap : une palette par grand profil de spectateur.
 * Toutes gardent la même grammaire (encre, papier, couleur vive, lumière, accent du n°1)
 * pour que chaque plan reste lisible ; les contrastes sont vérifiés par les tests.
 */
import type { WrappedData } from '../services/wrappedService';
import type { WrappedThemeId } from '../types/wrapped';
import { wrappedGenreKey, wrappedTraitFacts } from './wrappedStory.ts';

export type WrappedPalette = {
    /** Fond principal, très sombre. */
    ink: string;
    /** Fond secondaire sombre (cartes, panneaux). */
    night: string;
    /** Texte clair et fond clair du portrait. */
    paper: string;
    /** Couleur vive : fonds pleins, barres, accents ; porte du texte clair. */
    primary: string;
    /** Version profonde de la couleur vive. */
    deep: string;
    /** Lumière sur fond sombre : libellés, rayons, accents fins. */
    light: string;
    /** Accent réservé au numéro 1. */
    highlight: string;
    /** Fond sombre et chaud du plan du numéro 1. */
    stage: string;
    /** Texte secondaire sur fond sombre. */
    muted: string;
};

export const WRAPPED_THEME_IDS: readonly WrappedThemeId[] = ['electric', 'thrill', 'rush', 'heart', 'cosmos', 'neon', 'sun', 'night'];

export const WRAPPED_THEMES: Readonly<Record<WrappedThemeId, Readonly<WrappedPalette>>> = {
    electric: { ink: '#0b0d12', night: '#131925', paper: '#f4f6fa', primary: '#176bff', deep: '#0b3fb3', light: '#a9dfff', highlight: '#f4cc83', stage: '#15120d', muted: '#8b95a7' },
    thrill: { ink: '#0d0909', night: '#1c1012', paper: '#f7f1ee', primary: '#c4122f', deep: '#650a16', light: '#ffa596', highlight: '#f2d9a6', stage: '#140b0b', muted: '#a8918f' },
    rush: { ink: '#0e0b08', night: '#1d1510', paper: '#f8f3ec', primary: '#c2400b', deep: '#6b2105', light: '#ffc58f', highlight: '#ffe08a', stage: '#150e09', muted: '#a8978a' },
    heart: { ink: '#110a0d', night: '#211119', paper: '#fbf2f5', primary: '#c2275f', deep: '#661030', light: '#ffb8cf', highlight: '#f4cc83', stage: '#170c11', muted: '#ad939d' },
    cosmos: { ink: '#0a0a16', night: '#151433', paper: '#f3f3fb', primary: '#6a3df0', deep: '#2d1a8a', light: '#8ff0ff', highlight: '#f4cc83', stage: '#0e0c1a', muted: '#9493b8' },
    neon: { ink: '#0e0912', night: '#1d1029', paper: '#fbf3fb', primary: '#c3177e', deep: '#56128a', light: '#7ef9d8', highlight: '#ffe45c', stage: '#130b19', muted: '#a998b6' },
    // Ciel turquoise et soleil jaune : distinct de l'orange d'Adrénaline.
    sun: { ink: '#071012', night: '#0e1d21', paper: '#f5faf9', primary: '#0f7a8a', deep: '#064954', light: '#ffd86b', highlight: '#ffb347', stage: '#0c1312', muted: '#8fa3a6' },
    // Indigo profond et lumière lunaire ; l'ambre de la lampe reste réservé au numéro 1.
    night: { ink: '#06080f', night: '#0f1428', paper: '#f2f4fa', primary: '#2b318f', deep: '#12164d', light: '#b8c2ff', highlight: '#ffcf7a', stage: '#0b0d1a', muted: '#8d94b3' },
};

export function isWrappedThemeId(value: unknown): value is WrappedThemeId {
    return typeof value === 'string' && (WRAPPED_THEME_IDS as readonly string[]).includes(value);
}

export function wrappedThemePalette(id?: string | null): Readonly<WrappedPalette> {
    return WRAPPED_THEMES[isWrappedThemeId(id) ? id : 'electric'];
}

const PERSONA_THEMES: Partial<Record<string, WrappedThemeId>> = {
    horror: 'thrill', thriller: 'thrill',
    action: 'rush',
    romance: 'heart', drama: 'heart',
    scifi: 'cosmos', explorer: 'cosmos', 'explorer-elite': 'cosmos',
    'anime-fan': 'neon', 'weeb-supreme': 'neon', otaku: 'neon', animation: 'neon',
    comedy: 'sun', 'early-bird': 'sun',
    'night-owl': 'night',
};

const GENRE_THEMES: Partial<Record<string, WrappedThemeId>> = {
    horror: 'thrill', thriller: 'thrill', crime: 'thrill', mystery: 'thrill',
    action: 'rush', adventure: 'rush', war: 'rush', western: 'rush', actionAdventure: 'rush', warPolitics: 'rush',
    romance: 'heart', drama: 'heart', soap: 'heart',
    scifi: 'cosmos', fantasy: 'cosmos', scifiFantasy: 'cosmos',
    animation: 'neon', kids: 'neon',
    comedy: 'sun', family: 'sun', music: 'sun', reality: 'sun', talk: 'sun',
};

/** Ambiance d'après le profil : persona, puis place de l'anime, genre principal, horaires. */
export function wrappedThemeFor(data: WrappedData): WrappedThemeId {
    const persona = PERSONA_THEMES[data.persona?.id || ''];
    if (persona) return persona;
    if (data.byType.some(item => item.type === 'anime' && item.minutes > 0 && item.percent >= 40)) return 'neon';
    const genre = data.topGenres?.find(item => item.minutes > 0);
    const byGenre = genre ? GENRE_THEMES[wrappedGenreKey(genre.name) || ''] : undefined;
    if (byGenre) return byGenre;
    if (wrappedTraitFacts(data).some(trait => trait.id === 'night')) return 'night';
    return 'electric';
}

/** « r,g,b » pour composer des rgba() et des dégradés à partir d'une couleur de palette. */
export function wrappedRgb(hex: string): string {
    const value = parseInt(hex.slice(1), 16);
    return `${(value >> 16) & 255},${(value >> 8) & 255},${value & 255}`;
}

/** Rapport de contraste WCAG 2 entre deux couleurs #rrggbb. */
export function wrappedContrast(first: string, second: string): number {
    const luminance = (hex: string) => wrappedRgb(hex).split(',').map(Number).map(channel => {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
    return (light + 0.05) / (dark + 0.05);
}
