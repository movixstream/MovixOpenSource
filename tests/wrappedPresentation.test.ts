import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import i18next from 'i18next';
import type { WrappedData } from '../src/services/wrappedService.ts';
import { buildWrappedShareData, formatWrappedDuration, formatWrappedDurationParts, wrappedGesture, wrappedImageUrl, wrappedMediaKey, wrappedMonth } from '../src/utils/wrappedPresentation.ts';

const fixture = (): WrappedData => ({
    year: 2026,
    persona: { id: 'cinephile', title: 'Le Cinéphile', description: '', subtitle: '', emoji: '🎬', color: '#000' },
    slides: [{ type: 'intro', title: 'Ancien texte', text: 'Ne pas modifier le payload' }],
    stats: { totalMinutes: 125, totalHours: 2, totalDays: 0, uniqueTitles: 3, totalSessions: 8, totalActiveDays: 4 },
    topContent: [
        { type: 'movie', tmdbId: 42, rank: 1, title: 'Un film', minutes: 80, hours: 1, poster_path: '/movie.jpg' },
        { type: 'tv', tmdbId: 42, rank: 2, title: 'Une série', minutes: 35, hours: 1, poster_path: '/series.jpg' },
        { type: 'live-tv', rank: 3, title: 'Une chaîne', minutes: 10, hours: 0 },
    ],
    byType: [], topPages: [], peakMonth: { month: 8, name: 'Août', minutes: 125 },
    monthlyGraph: [{ month: 8, minutes: 125 }], topGenres: [{ name: 'Comédie', minutes: 125, percent: 100 }],
});

test('les identifiants de films et de séries ne se confondent pas', () => {
    const [film, series] = fixture().topContent;
    assert.notEqual(wrappedMediaKey(film), wrappedMediaKey(series));
    assert.notEqual(wrappedMediaKey({ type: 'live-tv', title: 'A' }), wrappedMediaKey({ type: 'live-tv', title: 'B' }));
});

test('les URLs de posters sont normalisées sans doubler le préfixe', () => {
    assert.equal(wrappedImageUrl('/a.jpg'), 'https://image.tmdb.org/t/p/w500/a.jpg');
    assert.equal(wrappedImageUrl('/a.jpg', 'w1280'), 'https://image.tmdb.org/t/p/w1280/a.jpg');
    assert.equal(wrappedImageUrl('https://image.tmdb.org/t/p/w500/a.jpg'), 'https://image.tmdb.org/t/p/w500/a.jpg');
    for (const path of [null, '', '//example.com/a', 'javascript:alert(1)', 'https://example.com/a']) assert.equal(wrappedImageUrl(path), null);
});

test('les petites durées restent exactes et les valeurs invalides restent affichables', () => {
    assert.equal(formatWrappedDuration(59, 'fr'), '59 min');
    assert.equal(formatWrappedDuration(60, 'fr'), '1 h');
    assert.equal(formatWrappedDuration(125, 'en'), '2 h 5 min');
    assert.deepEqual(formatWrappedDurationParts(125, 'en'), ['2 h', '5 min']);
    assert.deepEqual(formatWrappedDurationParts(59, 'fr'), ['59 min']);
    for (const value of [-1, NaN, Infinity]) assert.equal(formatWrappedDuration(value, 'fr'), '0 min');
    assert.equal(wrappedMonth(8, 'en'), 'August');
    assert.equal(wrappedMonth(13, 'fr'), '—');
});

test('le maintien et le défilement vertical ne naviguent pas', () => {
    assert.equal(wrappedGesture(0, 0, 500, 0.8), 0);
    assert.equal(wrappedGesture(10, 120, 100, 0.8), 0);
    assert.equal(wrappedGesture(-70, 10, 450, 0.8), 1);
    assert.equal(wrappedGesture(70, 10, 450, 0.1), -1);
    assert.equal(wrappedGesture(1, 1, 100, 0.8), 1);
    assert.equal(wrappedGesture(1, 1, 100, 0.1), -1);
});

test('les médias exportés conservent les posters de chaque type', async () => {
    const translations = Object.fromEntries(['fr', 'en'].map(lang => [lang, { translation: JSON.parse(readFileSync(new URL(`../src/i18n/locales/${lang}.json`, import.meta.url), 'utf8')) }]));
    const instance = i18next.createInstance();
    await instance.init({ lng: 'en', fallbackLng: 'fr', resources: translations });
    const card = buildWrappedShareData(fixture(), 'en', instance.t, 'example.test');
    assert.equal(card.items[0].posterUrl, 'https://image.tmdb.org/t/p/w500/movie.jpg');
    assert.equal(card.items[1].posterUrl, 'https://image.tmdb.org/t/p/w500/series.jpg');
    assert.equal(card.items[2].posterUrl, null);
});
