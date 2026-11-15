import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import i18next from 'i18next';
import type { WrappedData } from '../src/services/wrappedService.ts';
import { WRAPPED_THEME_IDS, WRAPPED_THEMES, wrappedContrast, wrappedThemeFor, wrappedThemePalette } from '../src/utils/wrappedTheme.ts';
import { wrappedSignatureKind } from '../src/utils/wrappedStory.ts';
import { buildWrappedShareData, wrappedSignatureScene } from '../src/utils/wrappedPresentation.ts';

const profile = (overrides: Partial<WrappedData> = {}): WrappedData => ({
    year: 2026,
    persona: { id: 'omnivore', title: '', description: '', subtitle: '', emoji: '', color: '' },
    slides: [],
    stats: { totalMinutes: 6000, totalHours: 100, totalDays: 4, uniqueTitles: 20, totalSessions: 80, totalActiveDays: 120, longestStreak: 4 },
    topContent: [{ type: 'movie', tmdbId: 1, rank: 1, title: 'Un film', minutes: 900, hours: 15 }],
    byType: [{ type: 'movie', minutes: 3000, count: 10, percent: 50 }, { type: 'tv', minutes: 3000, count: 10, percent: 50 }],
    topPages: [],
    peakMonth: { month: 3, name: 'Mars', minutes: 900 },
    topGenres: [{ name: 'Documentaire', minutes: 2000, percent: 33 }, { name: 'Histoire', minutes: 1000, percent: 17 }],
    listeningClock: Array.from({ length: 24 }, (_, hour) => ({ hour, minutes: hour >= 18 && hour <= 21 ? 1500 : 0 })),
    peakHour: 20,
    ...overrides,
});

test('chaque ambiance reste lisible : contrastes WCAG vérifiés sur tous les usages du film et des images', () => {
    // Texte clair sur la couleur vive : gros textes uniquement (≥ 3), marge prise à 4.
    const rules: [keyof typeof WRAPPED_THEMES.electric, keyof typeof WRAPPED_THEMES.electric, number][] = [
        ['paper', 'primary', 4], ['primary', 'paper', 4], ['paper', 'deep', 7], ['paper', 'ink', 12], ['paper', 'stage', 12],
        ['ink', 'paper', 12], ['light', 'ink', 7], ['light', 'night', 7], ['light', 'deep', 3], ['highlight', 'stage', 7],
        ['highlight', 'ink', 7], ['muted', 'ink', 4.5], ['muted', 'night', 4],
        // Unité et minutes posées sur la couleur vive (l'encre prend le relais si elle contraste mieux).
        ['light', 'primary', 3],
    ];
    for (const id of WRAPPED_THEME_IDS) {
        for (const [text, background, minimum] of rules) {
            const ratio = wrappedContrast(WRAPPED_THEMES[id][text], WRAPPED_THEMES[id][background]);
            assert.ok(ratio >= minimum, `${id} : ${text} sur ${background} = ${ratio.toFixed(2)} < ${minimum}`);
        }
    }
});

test('l’ambiance suit le profil : persona, anime, genre principal, nuit, puis défaut', () => {
    assert.equal(wrappedThemeFor(profile({ persona: { ...profile().persona, id: 'horror' } })), 'thrill');
    assert.equal(wrappedThemeFor(profile({ persona: { ...profile().persona, id: 'night-owl' } })), 'night');
    assert.equal(wrappedThemeFor(profile({ byType: [{ type: 'anime', minutes: 4000, count: 9, percent: 67 }, { type: 'movie', minutes: 2000, count: 4, percent: 33 }] })), 'neon');
    assert.equal(wrappedThemeFor(profile({ topGenres: [{ name: 'Science-fiction', minutes: 2000, percent: 40 }] })), 'cosmos');
    assert.equal(wrappedThemeFor(profile({ topGenres: [{ name: 'Sci-Fi & Fantasy', minutes: 2000, percent: 40 }] })), 'cosmos');
    assert.equal(wrappedThemeFor(profile({ topGenres: [{ name: 'Comédie', minutes: 2000, percent: 40 }] })), 'sun');
    assert.equal(wrappedThemeFor(profile({ topGenres: [{ name: 'Horreur', minutes: 0, percent: 0 }, { name: 'Romance', minutes: 900, percent: 20 }] })), 'heart');
    const nocturnal = profile({ listeningClock: Array.from({ length: 24 }, (_, hour) => ({ hour, minutes: hour >= 22 || hour < 2 ? 1500 : 0 })) });
    assert.equal(wrappedThemeFor(nocturnal), 'night');
    assert.equal(wrappedThemeFor(profile()), 'electric');
    assert.equal(wrappedThemePalette('inconnue'), WRAPPED_THEMES.electric);
});

test('le plan signature suit le profil et ne s’invente jamais', () => {
    assert.equal(wrappedSignatureKind(profile({ persona: { ...profile().persona, id: 'night-owl' } })), 'clock');
    assert.equal(wrappedSignatureKind(profile({ persona: { ...profile().persona, id: 'streak-machine' } })), 'streak');
    assert.equal(wrappedSignatureKind(profile({ persona: { ...profile().persona, id: 'binger' } })), 'formats');
    assert.equal(wrappedSignatureKind(profile()), 'genres');
    const community = profile({ community: { commentsPosted: 30, repliesPosted: 10, discussedTitles: 6, calendarTimezone: 'UTC', topTitles: [] } });
    assert.equal(wrappedSignatureKind(community), 'community');
    const empty = profile({ topGenres: [], listeningClock: [], peakHour: undefined, byType: [{ type: 'movie', minutes: 10, count: 1, percent: 100 }], stats: { ...profile().stats, longestStreak: 1 } });
    assert.equal(wrappedSignatureKind(empty), null);
});

test('le contenu du plan signature est localisé et ses parts restent entre 0 et 1', async () => {
    const translations = Object.fromEntries(['fr', 'en'].map(lang => [lang, { translation: JSON.parse(readFileSync(new URL(`../src/i18n/locales/${lang}.json`, import.meta.url), 'utf8')) }]));
    const instance = i18next.createInstance();
    await instance.init({ lng: 'fr', fallbackLng: 'fr', resources: translations });
    const clock = wrappedSignatureScene(profile({ persona: { ...profile().persona, id: 'night-owl' } }), 'fr', instance.t)!;
    assert.equal(clock.kind, 'clock');
    assert.equal(clock.title, 'Ton horloge');
    assert.equal(clock.rows.length, 24);
    assert.equal(clock.peak, 20);
    assert.match(clock.value, /20/);
    assert.ok(clock.rows.every(row => row.share >= 0 && row.share <= 1));
    const genres = wrappedSignatureScene(profile(), 'fr', instance.t)!;
    assert.equal(genres.kind, 'genres');
    assert.equal(genres.value, 'Documentaire');
    assert.ok(genres.rows.every(row => row.share >= 0 && row.share <= 1));
    await instance.changeLanguage('en');
    const english = wrappedSignatureScene(profile({ persona: { ...profile().persona, id: 'night-owl' } }), 'en', instance.t)!;
    assert.match(english.value, /PM/);
    const card = buildWrappedShareData(profile({ persona: { ...profile().persona, id: 'romance' } }), 'en', instance.t, 'example.test');
    assert.equal(card.theme, 'heart');
    assert.equal(card.signatureScene?.kind, 'genres');
});
