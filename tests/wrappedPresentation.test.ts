import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import i18next from 'i18next';
import type { WrappedData } from '../src/services/wrappedService.ts';
import { buildWrappedShareData, formatWrappedDuration, formatWrappedDurationParts, wrappedGesture, wrappedImageUrl, wrappedMediaKey, wrappedMonth, wrappedQuizOptions, wrappedTopPercent } from '../src/utils/wrappedPresentation.ts';

test('devinette : la place de la bonne réponse dépend des titres, pas de l’année', () => {
    const top = (ids: number[]) => ids.map((tmdbId, index) => ({ type: 'movie' as const, tmdbId, title: `Titre ${tmdbId}`, rank: index + 1 }));
    const positions = new Set<number>();
    for (let seed = 1; seed <= 60; seed += 1) {
        const items = top([seed * 7, seed * 13 + 1, seed * 29 + 2]);
        const options = wrappedQuizOptions(items);
        // Toujours les trois mêmes titres, chacun une fois, et le même ordre à chaque appel.
        assert.deepEqual([...options].sort((a, b) => a.rank - b.rank), items);
        assert.deepEqual(wrappedQuizOptions(items), options);
        positions.add(options.indexOf(items[0]));
    }
    // Sur 60 profils, la bonne réponse occupe les trois places.
    assert.deepEqual([...positions].sort(), [0, 1, 2]);
    // Moins de trois titres : rien à mélanger, rien d'inventé.
    assert.deepEqual(wrappedQuizOptions(top([1, 2])), top([1, 2]));
});

test('le « top X % » ne s’affiche que s’il est connu et flatteur', () => {
    assert.equal(wrappedTopPercent(99), 1);
    assert.equal(wrappedTopPercent(97), 3);
    assert.equal(wrappedTopPercent(88), 12);
    assert.equal(wrappedTopPercent(50), 50);
    // Jamais « top 0 % », même si l'API renvoyait 100.
    assert.equal(wrappedTopPercent(100), 1);
    // Moitié basse, classement pas encore calculé ou valeur illisible : rien.
    for (const value of [49, 12, 1, null, undefined, Number.NaN]) assert.equal(wrappedTopPercent(value), null);
});

test('le texte du « top X % » existe dans les deux langues', () => {
    for (const locale of ['fr', 'en']) {
        const messages = JSON.parse(readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8'));
        assert.match(messages.wrappedCinema.topPercent, /\{\{percent\}\}/);
        assert.match(messages.wrappedCinema.topPercent, /Movix/);
    }
});

test('le bouton vers l’année passée a son texte dans les deux langues', () => {
    for (const locale of ['fr', 'en']) {
        const messages = JSON.parse(readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8'));
        assert.match(messages.wrapped.viewPreviousYear, /\{\{year\}\}/);
    }
    // La page ne propose pas d'année antérieure à la première année de collecte.
    const page = readFileSync(new URL('../src/pages/WrappedPage.tsx', import.meta.url), 'utf8');
    assert.ok(page.includes('{year - 1 >= 2024 && <button'));
    assert.ok(page.includes('navigate(`/wrapped/${year - 1}`)'));
    assert.ok(page.includes("t('wrapped.viewPreviousYear', { year: year - 1 })"));
});

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
