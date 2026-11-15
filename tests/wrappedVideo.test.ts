import assert from 'node:assert/strict';
import test from 'node:test';
import { drawWrappedVideoFrame } from '../src/utils/wrappedVideo.ts';
import { filmCounter } from '../src/utils/wrappedFilmDrawing.ts';
import { WRAPPED_THEMES } from '../src/utils/wrappedTheme.ts';
import { buildWrappedVideoTimeline, DEFAULT_WRAPPED_VIDEO_OPTIONS, getEffectiveWrappedVideoOptions, getWrappedVideoBeatAt, getWrappedVideoProgress, normalizeWrappedVideoOptions, WRAPPED_VIDEO_DURATION, WRAPPED_VIDEO_FINAL_MIN_DURATION, type WrappedVideoOptions } from '../src/utils/wrappedVideoTimeline.ts';

type CanvasTrace = { drawn: string[]; operations: Array<{ name: string; values: number[] }>; fills: string[] };

/**
 * Contexte 2D enregistreur : toute méthode non simulée est tracée avec ses arguments
 * numériques, les textes peints (remplis ou en contour) sont relevés pour les exclusions.
 */
function mockCanvas(): { ctx: CanvasRenderingContext2D; trace: CanvasTrace } {
    const trace: CanvasTrace = { drawn: [], operations: [], fills: [] };
    const states: Array<{ globalAlpha: number }> = [];
    const record = (name: string) => (...values: unknown[]) => trace.operations.push({ name, values: values.filter((value): value is number => typeof value === 'number') });
    const gradient = () => ({ addColorStop(offset: number) { trace.operations.push({ name: 'addColorStop', values: [offset] }); } });
    const context: Record<string | symbol, unknown> = {
        fillStyle: '', strokeStyle: '', globalAlpha: 1, font: '', lineWidth: 1, globalCompositeOperation: 'source-over',
        textAlign: 'left', textBaseline: 'alphabetic', shadowColor: '', shadowBlur: 0, shadowOffsetY: 0,
        fillRect(this: { fillStyle: unknown }, ...values: number[]) { trace.fills.push(String(this.fillStyle)); trace.operations.push({ name: 'fillRect', values }); },
        save(this: { globalAlpha: number }) { states.push({ globalAlpha: this.globalAlpha }); trace.operations.push({ name: 'save', values: [] }); },
        restore(this: { globalAlpha: number }) { const state = states.pop(); if (state) this.globalAlpha = state.globalAlpha; trace.operations.push({ name: 'restore', values: [] }); },
        fillText(value: string, x: number, y: number) { trace.drawn.push(value); trace.operations.push({ name: 'fillText', values: [x, y] }); },
        strokeText(value: string, x: number, y: number) { trace.drawn.push(value); trace.operations.push({ name: 'strokeText', values: [x, y] }); },
        measureText(value: string) { return { width: Array.from(value).length * 7 }; },
        createRadialGradient(...values: number[]) { trace.operations.push({ name: 'createRadialGradient', values }); return gradient(); },
        createLinearGradient(...values: number[]) { trace.operations.push({ name: 'createLinearGradient', values }); return gradient(); },
        createPattern() { return null; },
    };
    const ctx = new Proxy(context, { get: (target, property) => property in target ? target[property] : typeof property === 'string' ? record(property) : undefined });
    return { ctx: ctx as unknown as CanvasRenderingContext2D, trace };
}

const data = {
    year: 2026,
    domain: 'movix.test',
    watchTime: 'WATCH_TIME_FACT',
    watchTimeParts: ['WATCH_TIME_FACT'],
    titleCount: 'TITLE_COUNT_FACT',
    persona: 'PERSONA_FACT',
    traits: [
        { label: 'TRAIT_ONE', evidence: 'EVIDENCE_NEVER_DRAWN' },
        { label: 'TRAIT_TWO', evidence: 'SECOND_EVIDENCE_NEVER_DRAWN' },
    ],
    signature: [1, 4, 2, 6, 3, 7, 5, 8, 4, 9, 6, 10],
    signatureCaption: 'SIGNATURE_CAPTION',
    signatureFutureFrom: null,
    monthLabels: ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'],
    items: [
        { title: 'FAVORITE_FACT', posterUrl: null, duration: 'FAVORITE_DURATION_FACT', minutes: 600 },
        { title: 'SECOND_TITLE_FACT', posterUrl: null, duration: 'SECOND_DURATION', minutes: 300 },
    ],
    signatureScene: {
        kind: 'genres' as const, title: 'SIGNATURE_TITLE', label: 'SIGNATURE_LABEL', value: 'SIGNATURE_VALUE', caption: 'SIGNATURE_SCENE_CAPTION',
        rows: [{ label: 'SIGNATURE_ROW', value: 'SIGNATURE_ROW_VALUE', share: 0.6 }, { label: 'SIGNATURE_ROW_TWO', value: 'SIGNATURE_ROW_VALUE_TWO', share: 0.3 }], peak: 0,
    },
    labels: { heading: '', favorite: '', watchTime: '', titles: '', persona: '', topFive: '', ticket: '', imageUnavailable: '', signature: '' },
};
const SIGNATURE_FACTS = ['SIGNATURE_LABEL', 'SIGNATURE_VALUE', 'SIGNATURE_SCENE_CAPTION', 'SIGNATURE_ROW', 'SIGNATURE_TITLE'];

const texts = {
    intro: 'INTRO_LABEL', time: 'TIME_LABEL', titles: 'TITLE_LABEL', favorite: 'FAVORITE_LABEL',
    portrait: 'PORTRAIT_LABEL', final: 'FINAL_LABEL', missingPoster: 'MISSING_POSTER',
};

const WRAPPED_SCORE_BPM = 114;
const BEAT_SECONDS = 60 / WRAPPED_SCORE_BPM;
const closeToBeat = (time: number) => Math.abs(time / BEAT_SECONDS - Math.round(time / BEAT_SECONDS)) < 1e-8;

function optionCombinations(): WrappedVideoOptions[] {
    return Array.from({ length: 32 }, (_, mask) => ({
        watchTime: Boolean(mask & 1),
        titleCount: Boolean(mask & 2),
        favorite: Boolean(mask & 4),
        portrait: Boolean(mask & 8),
        signature: Boolean(mask & 16),
        sound: false,
    }));
}

const none = { watchTime: false, titleCount: false, favorite: false, portrait: false, signature: false, sound: false };

test('le film garde exactement 18 secondes et cale ses plans sur la bande-son à 114 BPM', () => {
    const timeline = buildWrappedVideoTimeline(DEFAULT_WRAPPED_VIDEO_OPTIONS);
    assert.deepEqual(timeline.map(beat => beat.scene), ['intro', 'watchTime', 'signature', 'favorite', 'portrait', 'final']);
    assert.deepEqual(timeline.map(beat => beat.start), [0, 6, 14, 18, 22, 26].map(beat => beat * BEAT_SECONDS));
    assert.equal(timeline.at(-1)?.end, WRAPPED_VIDEO_DURATION);
    const final = timeline.at(-1)!;
    assert.equal(final.scene, 'final');
    assert.ok(final.end - final.start >= WRAPPED_VIDEO_FINAL_MIN_DURATION);
    assert.ok(timeline.every((beat, index) => index === 0 || beat.start === timeline[index - 1].end));
});

test('chaque frontière disponible reste un multiple entier du temps musical', () => {
    for (const options of optionCombinations()) {
        const timeline = buildWrappedVideoTimeline(options);
        const boundaries = timeline.length === 1 ? [] : timeline.slice(0, -1).map(beat => beat.end);
        assert.ok(boundaries.every(closeToBeat), { options, boundaries });
    }
});

test('les statistiques cochées sont groupées dans un même plan', () => {
    const both = buildWrappedVideoTimeline({ ...none, watchTime: true, titleCount: true });
    assert.deepEqual(both.map(beat => beat.scene), ['intro', 'watchTime', 'final']);
    assert.equal(both[1].start, 6 * BEAT_SECONDS);
    assert.equal(both[1].end, 26 * BEAT_SECONDS);

    const titlesOnly = buildWrappedVideoTimeline({ ...none, titleCount: true });
    assert.deepEqual(titlesOnly.map(beat => beat.scene), ['intro', 'titleCount', 'final']);
});

test('avec quatre plans, les statistiques gardent huit temps et les autres quatre', () => {
    const timeline = buildWrappedVideoTimeline(DEFAULT_WRAPPED_VIDEO_OPTIONS);
    const lengths = timeline.slice(1, -1).map(beat => Math.round((beat.end - beat.start) / BEAT_SECONDS));
    assert.deepEqual(lengths, [8, 4, 4, 4]);
    const withoutSignature = buildWrappedVideoTimeline({ ...DEFAULT_WRAPPED_VIDEO_OPTIONS, signature: false });
    assert.deepEqual(withoutSignature.map(beat => beat.start), [0, 6, 14, 20, 26].map(beat => beat * BEAT_SECONDS));
});

test('les options exclues ne produisent aucune scène, y compris les affiches de l’intro', () => {
    const timeline = buildWrappedVideoTimeline({ ...none, watchTime: true });
    assert.deepEqual(timeline.map(beat => beat.scene), ['intro', 'watchTime', 'final']);
    assert.equal(timeline.at(-1)?.start, 26 * BEAT_SECONDS);
});

test('un seul choix remplit proprement le calendrier et les bords choisissent la bonne scène', () => {
    const timeline = buildWrappedVideoTimeline({ ...none, favorite: true });
    const introEnd = timeline[0].end;
    assert.deepEqual(timeline.map(beat => beat.scene), ['intro', 'favorite', 'final']);
    assert.equal(getWrappedVideoBeatAt(0, timeline).scene, 'intro');
    assert.equal(getWrappedVideoBeatAt(introEnd - 0.001, timeline).scene, 'intro');
    assert.equal(getWrappedVideoBeatAt(introEnd, timeline).scene, 'favorite');
    assert.equal(getWrappedVideoBeatAt(18, timeline).scene, 'final');
    assert.equal(getWrappedVideoProgress(99, timeline.at(-1)!), 1);
});

test('sans sélection, le calendrier ne crée aucune scène d’information', () => {
    const timeline = buildWrappedVideoTimeline(none);
    assert.deepEqual(timeline, [{ scene: 'final', start: 0, end: 18 }]);
});

test('sans titre disponible, le numéro 1 et ses affiches sont exclus du film', () => {
    const options = getEffectiveWrappedVideoOptions(DEFAULT_WRAPPED_VIDEO_OPTIONS, 0, true);
    assert.equal(options.favorite, false);
    assert.ok(!buildWrappedVideoTimeline(options).some(beat => beat.scene === 'favorite'));
});

test('sans plan signature pour ce profil, l’option n’ajoute aucune scène', () => {
    const options = getEffectiveWrappedVideoOptions(DEFAULT_WRAPPED_VIDEO_OPTIONS, 3, false);
    assert.equal(options.signature, false);
    assert.ok(!buildWrappedVideoTimeline(options).some(beat => beat.scene === 'signature'));
});

test('la disparition du seul numéro 1 rétablit un portrait lisible', () => {
    const options = normalizeWrappedVideoOptions({ ...none, favorite: true }, 0);
    assert.equal(options.favorite, false);
    assert.equal(options.portrait, true);
    const signatureOnly = normalizeWrappedVideoOptions({ ...none, signature: true }, 3, false);
    assert.equal(signatureOnly.portrait, true);
});

test('aucun fait décoché ni preuve de trait ne traverse un plan ou un raccord', () => {
    for (const options of optionCombinations()) {
        const timeline = buildWrappedVideoTimeline(options);
        for (let frame = 0; frame <= WRAPPED_VIDEO_DURATION * 30; frame += 1) {
            const { ctx, trace } = mockCanvas();
            drawWrappedVideoFrame(ctx, data, options, texts, new Map(), frame / 30, timeline);
            const output = trace.drawn.join(' ');
            assert.ok(!output.includes('EVIDENCE_NEVER_DRAWN'), { options, frame });
            assert.ok(!output.includes('SECOND_EVIDENCE_NEVER_DRAWN'), { options, frame });
            if (!options.watchTime) {
                assert.ok(!output.includes('WATCH_TIME_FACT'), { options, frame });
                assert.ok(!output.includes('FAVORITE_DURATION_FACT'), { options, frame });
                assert.ok(!output.includes('TIME_LABEL'), { options, frame });
                assert.ok(!output.includes('SIGNATURE_CAPTION'), { options, frame });
            }
            if (!options.titleCount) {
                assert.ok(!output.includes('TITLE_COUNT_FACT'), { options, frame });
                assert.ok(!output.includes('TITLE_LABEL'), { options, frame });
            }
            if (!options.favorite) {
                assert.ok(!output.includes('FAVORITE_FACT'), { options, frame });
                assert.ok(!output.includes('FAVORITE_LABEL'), { options, frame });
                assert.ok(!output.includes('SECOND_TITLE_FACT'), { options, frame });
            }
            if (!options.portrait) {
                assert.ok(!output.includes('PERSONA_FACT'), { options, frame });
                assert.ok(!output.includes('TRAIT_ONE'), { options, frame });
                assert.ok(!output.includes('TRAIT_TWO'), { options, frame });
                assert.ok(!output.includes('PORTRAIT_LABEL'), { options, frame });
            }
            if (!options.signature) for (const fact of SIGNATURE_FACTS) assert.ok(!output.includes(fact), { options, frame, fact });
            // Le nom court sert à la case à cocher, jamais à l'image.
            assert.ok(!output.includes('SIGNATURE_TITLE'), { options, frame });
        }
    }
});

test('les raccords conservent un temps local continu de part et d’autre du bord, pour chaque sélection', () => {
    // Un saut ne dépend pas de l'écart choisi : 10 µs suffisent à le distinguer d'un volet rapide.
    for (const options of optionCombinations()) {
        const timeline = buildWrappedVideoTimeline(options);
        for (const boundary of timeline.slice(1)) {
            const before = mockCanvas();
            const after = mockCanvas();
            drawWrappedVideoFrame(before.ctx, data, options, texts, new Map(), boundary.start - 0.00001, timeline);
            drawWrappedVideoFrame(after.ctx, data, options, texts, new Map(), boundary.start + 0.00001, timeline);
            assert.deepEqual(after.trace.operations.map(operation => operation.name), before.trace.operations.map(operation => operation.name), { options, boundary });
            before.trace.operations.forEach((operation, index) => {
                operation.values.forEach((value, valueIndex) => {
                    const delta = Math.abs(value - after.trace.operations[index].values[valueIndex]);
                    assert.ok(delta < 1, `saut de ${delta} au raccord ${boundary.scene} (${operation.name})`);
                });
            });
        }
    }
});

test('le même instant produit exactement la même image, pour l’aperçu comme pour l’export', () => {
    const timeline = buildWrappedVideoTimeline(DEFAULT_WRAPPED_VIDEO_OPTIONS);
    for (const time of [0, 0.8, 1.7, 3.16, 5.3, 7.37, 9.1, 10.53, 13.68, 16.9, 18]) {
        const first = mockCanvas(), second = mockCanvas();
        drawWrappedVideoFrame(first.ctx, data, DEFAULT_WRAPPED_VIDEO_OPTIONS, texts, new Map(), time, timeline);
        drawWrappedVideoFrame(second.ctx, data, DEFAULT_WRAPPED_VIDEO_OPTIONS, texts, new Map(), time, timeline);
        assert.deepEqual(first.trace, second.trace, `image différente à ${time} s`);
    }
});

test('les compteurs se posent sur la valeur exacte et comptent chaque nombre séparément', () => {
    const settled = mockCanvas();
    filmCounter(settled.ctx, '1 234 h 30 min', 0, 0, { size: 100, progress: 1 });
    assert.equal(settled.trace.drawn.join(''), '1 234 h 30 min');
    for (const progress of [-1, 0, 0.1, 0.35, 0.5, 0.8, 0.99]) {
        const { ctx, trace } = mockCanvas();
        filmCounter(ctx, '373 h 30 min', 0, 0, { size: 100, progress });
        const text = trace.drawn.join('');
        const [hours, minutes] = (text.match(/\d+/g) || []).map(Number);
        assert.ok(hours <= 373 && minutes <= 30, text);
        assert.ok(text.includes(' h ') && text.endsWith(' min'), text);
    }
    // Séparateur de milliers français (espace fine insécable) : un seul nombre, jamais deux.
    const french = mockCanvas();
    filmCounter(french.ctx, `1${String.fromCharCode(0x202f)}234 h`, 0, 0, { size: 100, progress: 0.3 });
    const counted = Number(french.trace.drawn.join('').replace(/\D/g, ''));
    assert.ok(counted > 0 && counted <= 1234, french.trace.drawn.join(''));
    const text = mockCanvas();
    filmCounter(text.ctx, 'WATCH_TIME_FACT', 0, 0, { size: 100, progress: 0.4 });
    assert.deepEqual(text.trace.drawn, ['WATCH_TIME_FACT']);
});

test('les titres très longs restent bornés sans interrompre le rendu', () => {
    const longData = {
        ...data,
        persona: 'Le cinéphile qui traverse les époques, les genres et les nuits sans jamais perdre le fil de son année',
        items: [{ ...data.items[0], title: 'L’extraordinaire chronique cinématographique des voyageurs de la constellation aux cent vingt-sept étoiles' }],
    };
    for (const options of optionCombinations()) {
        const timeline = buildWrappedVideoTimeline(options);
        for (const beat of timeline) {
            const { ctx } = mockCanvas();
            assert.doesNotThrow(() => drawWrappedVideoFrame(ctx, longData, options, texts, new Map(), (beat.start + beat.end) / 2, timeline));
        }
    }
});

test('chaque image prend la palette de son ambiance, sans garder celle de l’image précédente', () => {
    const timeline = buildWrappedVideoTimeline(DEFAULT_WRAPPED_VIDEO_OPTIONS);
    const hours = timeline[1].start + 1;
    const thrill = mockCanvas();
    drawWrappedVideoFrame(thrill.ctx, { ...data, theme: 'thrill' as const }, DEFAULT_WRAPPED_VIDEO_OPTIONS, texts, new Map(), hours, timeline);
    assert.equal(thrill.trace.fills[0], WRAPPED_THEMES.thrill.primary);
    const neutral = mockCanvas();
    drawWrappedVideoFrame(neutral.ctx, data, DEFAULT_WRAPPED_VIDEO_OPTIONS, texts, new Map(), hours, timeline);
    assert.equal(neutral.trace.fills[0], WRAPPED_THEMES.electric.primary);
});

test('chaque plan signature se dessine, valeurs vides et grandes séries comprises', () => {
    const timeline = buildWrappedVideoTimeline(DEFAULT_WRAPPED_VIDEO_OPTIONS);
    const signature = timeline.find(beat => beat.scene === 'signature')!;
    const hours = Array.from({ length: 24 }, (_, hour) => ({ label: `H${hour}`, value: '', share: hour / 23 }));
    const scenes = [
        { kind: 'clock' as const, title: 'T', label: 'CLOCK_LABEL', value: '21 h', caption: 'CLOCK_CAPTION', rows: hours, peak: 21 },
        { kind: 'streak' as const, title: 'T', label: 'STREAK_LABEL', value: '9', unit: 'jours', caption: 'STREAK_CAPTION', rows: [] },
        { kind: 'streak' as const, title: 'T', label: 'STREAK_LABEL', value: '365', unit: 'jours', rows: [] },
        { kind: 'community' as const, title: 'T', label: 'VOICE_LABEL', value: '75', unit: 'contributions', rows: [{ label: 'A', value: '48', share: 1 }, { label: 'B', value: '27', share: 0.56 }], peak: 0 },
        { kind: 'formats' as const, title: 'T', label: 'FORMAT_LABEL', value: 'Films', rows: [{ label: 'Films', value: '47 %', share: 0.47 }], peak: 0 },
    ];
    for (const scene of scenes) {
        for (const time of [signature.start + 0.05, (signature.start + signature.end) / 2, signature.end - 0.05]) {
            const { ctx, trace } = mockCanvas();
            drawWrappedVideoFrame(ctx, { ...data, signatureScene: scene }, DEFAULT_WRAPPED_VIDEO_OPTIONS, texts, new Map(), time, timeline);
            if (time > signature.start + 0.5 && time < signature.end - 0.5) assert.ok(trace.drawn.some(value => value.includes(scene.label)), scene.kind);
        }
    }
});
