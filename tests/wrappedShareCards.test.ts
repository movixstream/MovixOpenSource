import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

// Le module de cartes s'importe tel quel : l'alias « @/ » pointe vers src et le
// chargement des polices et des images est remplacé par une doublure sans DOM.
// Une affiche « slow » arrive en retard, pour entrelacer deux exports concurrents.
const canvasStub = `data:text/javascript,${encodeURIComponent([
    'export const ensureShareFonts = async () => {};',
    'export const loadCanvasImage = async src => {',
    "    if (src.includes('slow')) await new Promise(done => setTimeout(done, 30));",
    "    return src.includes('fail') ? null : { src, naturalWidth: 500, naturalHeight: 750 };",
    '};',
].join('\n'))}`;
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === '@/utils/wrappedCanvas') return { url: canvasStub, shortCircuit: true };
        if (specifier.startsWith('@/')) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
        return nextResolve(specifier, context);
    },
});

/** Appel de dessin avec le style courant : remplissage, contour et ombre active. */
type Call = { name: string; args: unknown[]; fill: unknown; stroke: unknown; shadow: unknown };

/** Contexte 2D minimal qui enregistre chaque appel de dessin et chaque arrêt de dégradé. */
function recorder() {
    const calls: Call[] = [];
    const stops: unknown[] = [];
    const state: Record<string | symbol, unknown> = {
        font: '400 10px Inter', letterSpacing: '0px', fillStyle: '#000', strokeStyle: '#000', globalAlpha: 1, lineWidth: 1,
        textAlign: 'left', textBaseline: 'alphabetic', globalCompositeOperation: 'source-over', shadowColor: 'transparent',
        shadowBlur: 0, shadowOffsetY: 0, lineCap: 'butt', lineJoin: 'miter',
    };
    const saved: Array<Record<string | symbol, unknown>> = [];
    const fontSize = () => Number(String(state.font).match(/(\d+(?:\.\d+)?)px/)?.[1] ?? 10);
    const gradient = { addColorStop: (_offset: number, color: unknown) => { stops.push(color); } };
    const methods: Record<string, (...args: never[]) => unknown> = {
        save: () => { saved.push({ ...state }); },
        restore: () => { const previous = saved.pop(); if (previous) Object.assign(state, previous); },
        measureText: (text: string) => ({ width: Array.from(text).length * fontSize() * 0.55 }),
        createLinearGradient: () => gradient,
        createRadialGradient: () => gradient,
        createPattern: () => null,
        createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
    };
    const ctx = new Proxy(state, {
        get(target, key) {
            if (typeof key === 'string' && key in methods) return methods[key];
            if (key in target) return target[key];
            return (...args: unknown[]) => {
                const shadow = Number(target.shadowBlur) > 0 || Number(target.shadowOffsetY) > 0 ? target.shadowColor : null;
                calls.push({ name: String(key), args, fill: target.fillStyle, stroke: target.strokeStyle, shadow });
            };
        },
        set(target, key, value) { target[key] = value; return true; },
        has(target, key) { return key in target; },
    });
    return { ctx, calls, stops };
}

const canvases: Array<ReturnType<typeof recorder>> = [];
Object.assign(globalThis, {
    document: {
        createElement: () => {
            const record = recorder();
            canvases.push(record);
            return { width: 0, height: 0, getContext: () => record.ctx, toBlob: (done: (blob: Blob) => void) => done(new Blob(['png'], { type: 'image/png' })) };
        },
    },
});

const { generateWrappedShareCard, WRAPPED_SHARE_CARD_SIZES, WRAPPED_SHARE_POSTER_BOXES } = await import('../src/utils/wrappedShareCards.ts');
const { WRAPPED_THEMES, WRAPPED_THEME_IDS, wrappedContrast, wrappedRgb } = await import('../src/utils/wrappedTheme.ts');
type Data = Parameters<typeof generateWrappedShareCard>[0];
type Format = Parameters<typeof generateWrappedShareCard>[1];

const FORMATS: Format[] = ['story', 'top-five', 'poster', 'ticket'];
const POSTER_FORMATS = ['story', 'top-five', 'poster'] as const;
const FILLS = new Set(['fill', 'fillRect', 'fillText']);
const STROKES = new Set(['stroke', 'strokeText']);

/** Couleur CSS ramenée à « r,g,b » ; un dégradé ou un motif est ignoré, une autre écriture reste telle quelle. */
function rgb(color: unknown): string | null {
    if (typeof color !== 'string') return null;
    if (/^#[0-9a-f]{6}$/i.test(color)) return wrappedRgb(color);
    return /^rgba?\((\d+),(\d+),(\d+)/.exec(color.replace(/\s/g, ''))?.slice(1, 4).join(',') ?? color;
}

/** Couleurs réellement peintes : remplissages, contours, ombres et arrêts de dégradés. */
function painted({ calls, stops }: ReturnType<typeof recorder>): Set<string> {
    const colors = calls.flatMap(call => {
        const fill = FILLS.has(call.name), stroke = STROKES.has(call.name);
        return [fill ? call.fill : null, stroke ? call.stroke : null, fill || stroke ? call.shadow : null];
    });
    return new Set([...colors, ...stops].map(rgb).filter((color): color is string => color !== null));
}

function fixture(overrides: Partial<Data> = {}): Data {
    return {
        year: 2026, domain: 'movix.test', backdropUrl: null, period: 'PERIOD_LINE',
        watchTime: '373 h 30 min', watchTimeParts: ['373 h', '30 min'], titleCount: '96', persona: 'Le touche-à-tout',
        traits: [{ label: 'TRAIT_ONE', evidence: 'EVIDENCE_NEVER_DRAWN' }, { label: 'TRAIT_TWO', evidence: 'SECOND_EVIDENCE_NEVER_DRAWN' }],
        signature: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], signatureCaption: 'CAPTION', signatureFutureFrom: null,
        monthLabels: Array.from({ length: 12 }, (_, index) => `M${index + 1}`),
        items: ['Un', 'Deux', 'Trois', 'Quatre', 'Cinq'].map((title, index) => ({
            title, posterUrl: `https://image.test/${index}.jpg`, duration: `${10 - index} h`, minutes: (10 - index) * 60,
        })),
        labels: {
            heading: 'Mon année à l’écran', favorite: 'Le plus regardé', watchTime: 'Temps regardé', titles: 'Titres uniques',
            persona: 'Ta signature', topFive: 'Ton top 5', ticket: 'Une année de séances', imageUnavailable: 'Affiche indisponible',
            signature: 'Ton année en douze mois', presents: 'Movix présente', admit: 'Entrée · 1 spectateur',
        },
        ...overrides,
    };
}

async function render(data: Data, format: Format) {
    const start = canvases.length;
    const blob = await generateWrappedShareCard(data, format);
    const canvas = canvases[start];
    const { calls } = canvas;
    return { blob, calls, colors: painted(canvas), texts: calls.filter(call => call.name === 'fillText').map(call => String(call.args[0])) };
}

const destination = (call: Call) => call.args.slice(5, 9) as number[];

test('les rectangles d’affiche tiennent dans leur PNG, en 2:3 et en pixels entiers', () => {
    for (const format of POSTER_FORMATS) {
        const box = WRAPPED_SHARE_POSTER_BOXES[format];
        const size = WRAPPED_SHARE_CARD_SIZES[format];
        assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= size.width && box.y + box.height <= size.height, format);
        assert.equal(box.height, box.width * 1.5, format);
        assert.ok([box.x, box.y, box.width, box.height].every(Number.isInteger), format);
    }
});

test('l’affiche n°1 est peinte à plat dans son rectangle fixe, quelles que soient les données', async () => {
    const variants = [
        fixture(),
        fixture({ items: fixture().items.slice(0, 1) }),
        fixture({ persona: 'Une signature extrêmement longue '.repeat(6), items: fixture().items.map(item => ({ ...item, title: `${item.title} ${'très long titre '.repeat(8)}` })) }),
    ];
    for (const format of POSTER_FORMATS) {
        const box = WRAPPED_SHARE_POSTER_BOXES[format];
        for (const data of variants) {
            const { calls } = await render(data, format);
            const painted = calls.filter(call => call.name === 'drawImage' && (call.args[0] as { src?: string }).src === data.items[0].posterUrl);
            assert.equal(painted.length, 1, format);
            assert.deepEqual(destination(painted[0]), [box.x, box.y, box.width, box.height], format);
            assert.ok(calls.some(call => call.name === 'roundRect' && call.args.join() === [box.x, box.y, box.width, box.height, box.width * 0.06].join()), format);
            assert.ok(!calls.some(call => call.name === 'rotate'), format);
        }
    }
});

test('une affiche absente ou en échec garde la même place avec un repli typographique', async () => {
    const data = fixture({ items: fixture().items.map((item, index) => ({ ...item, posterUrl: index ? null : 'https://image.test/fail.jpg' })) });
    // Le repli écrit le titre dans l'affiche (en plus du titre sous l'affiche), ou son initiale en vignette.
    const fallback = { story: (texts: string[]) => texts.filter(text => text === 'Un').length === 2, poster: (texts: string[]) => texts.filter(text => text === 'Un').length === 1, 'top-five': (texts: string[]) => texts.includes('U') };
    for (const format of POSTER_FORMATS) {
        const box = WRAPPED_SHARE_POSTER_BOXES[format];
        const { calls, texts } = await render(data, format);
        assert.ok(!calls.some(call => call.name === 'drawImage'), format);
        assert.ok(calls.some(call => call.name === 'roundRect' && call.args.join() === [box.x, box.y, box.width, box.height, box.width * 0.06].join()), format);
        assert.ok(fallback[format](texts), format);
    }
});

test('seuls les libellés des traits sont dessinés, jamais leur preuve', async () => {
    for (const format of FORMATS) {
        const { texts } = await render(fixture(), format);
        const output = texts.join(' ');
        assert.ok(!output.includes('EVIDENCE'), format);
        assert.ok(output.includes('TRAIT_ONE'), format);
    }
});

test('les barres du top 5 suivent les minutes, à la même échelle que le n°1', async () => {
    const { calls } = await render(fixture(), 'top-five');
    const box = WRAPPED_SHARE_POSTER_BOXES['top-five'];
    const bars = calls.filter(call => call.name === 'roundRect' && call.args[0] === box.x + box.width + 32 && call.args[3] === 10).map(call => Number(call.args[2]));
    assert.equal(bars.length, 10);
    const ratios = Array.from({ length: 5 }, (_, index) => bars[index * 2 + 1] / bars[index * 2]);
    ratios.forEach((ratio, index) => assert.ok(Math.abs(ratio - (10 - index) / 10) < 1e-9, `rang ${index + 1}`));
});

test('les cas limites produisent une image complète sans erreur', async () => {
    const zero = fixture({ signature: Array(12).fill(0) });
    const cases: Data[] = [
        fixture({ items: [] }),
        fixture({ items: fixture().items.slice(0, 2), traits: [] }),
        fixture({ signatureFutureFrom: 11, signature: [5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 0, 0] }),
        fixture({ traits: undefined, monthLabels: undefined, labels: { ...fixture().labels, presents: undefined, admit: undefined } }),
        zero,
    ];
    for (const data of cases) {
        for (const format of FORMATS) {
            const { blob } = await render(data, format);
            assert.equal(blob.type, 'image/png');
        }
    }
    // Une signature toute à zéro ne dessine aucune barre ni initiale de mois.
    assert.ok(!(await render(zero, 'story')).texts.includes('M12'));
    assert.ok((await render(fixture(), 'story')).texts.includes('M12'));
});

test('le code-barres du billet est déterministe et dérivé des données', async () => {
    const bars = async (data: Data) => (await render(data, 'ticket')).calls.filter(call => call.name === 'fillRect').map(call => call.args.join()).join('|');
    assert.equal(await bars(fixture()), await bars(fixture()));
    assert.notEqual(await bars(fixture()), await bars(fixture({ titleCount: '97' })));
});

test('sans ambiance, les images gardent la palette électrique', async () => {
    for (const format of FORMATS) {
        assert.deepEqual([...(await render(fixture(), format)).colors].sort(), [...(await render(fixture({ theme: 'electric' }), format)).colors].sort(), format);
    }
});

test('chaque ambiance peint les quatre formats avec sa seule palette', async () => {
    const electric = WRAPPED_THEMES.electric;
    // Backdrop, affiches de repli et composition sans titre : chaque chemin de couleur est parcouru.
    const variants = (theme: NonNullable<Data['theme']>) => [
        fixture({ theme, backdropUrl: 'https://image.test/backdrop.jpg' }),
        fixture({ theme, items: fixture().items.map(item => ({ ...item, posterUrl: null })) }),
        fixture({ theme, items: [] }),
    ];
    const reference = new Map<string, Set<string>>();
    for (const [index, data] of variants('electric').entries()) {
        for (const format of FORMATS) reference.set(`${index} ${format}`, (await render(data, format)).colors);
    }
    for (const theme of WRAPPED_THEME_IDS) {
        const palette = WRAPPED_THEMES[theme];
        // Une couleur peinte à l'identique dans deux ambiances serait codée en dur, sauf si les deux palettes la partagent.
        const shared = new Set(Object.values(palette).filter(color => Object.values(electric).includes(color)).map(wrappedRgb));
        for (const [index, data] of variants(theme).entries()) {
            for (const format of FORMATS) {
                const { blob, colors } = await render(data, format);
                assert.equal(blob.type, 'image/png', `${theme} ${index} ${format}`);
                assert.ok(colors.has(wrappedRgb(palette.primary)), `${theme} ${index} ${format}`);
                if (theme === 'electric') continue;
                const leaked = [...colors].filter(color => reference.get(`${index} ${format}`)?.has(color) && !shared.has(color));
                assert.deepEqual(leaked, [], `${theme} ${index} ${format}`);
            }
        }
        // Repères : bandeau du billet dans la couleur vive, n°1 dans son accent, libellés dans la lumière.
        const ticket = await render(fixture({ theme }), 'ticket');
        assert.ok(ticket.calls.some(call => call.name === 'fillRect' && call.args.join() === '96,112,888,150' && call.fill === palette.primary), theme);
        const story = await render(fixture({ theme }), 'story');
        assert.ok(story.calls.some(call => call.name === 'fillText' && String(call.args[0]).startsWith('01 ·') && call.fill === palette.highlight), theme);
        assert.ok(story.calls.some(call => call.name === 'fillText' && call.args[0] === 'TEMPS REGARDÉ' && call.fill === palette.light), theme);
        const top = await render(fixture({ theme }), 'top-five');
        assert.ok(top.calls.some(call => call.name === 'fillText' && call.args[0] === '01' && call.fill === palette.highlight), theme);
    }
});

test('les barres des mois se lisent sur l’encre dans chaque ambiance', async () => {
    for (const theme of WRAPPED_THEME_IDS) {
        const { calls } = await render(fixture({ theme }), 'story');
        // Barres pleines de 16 px : la couleur est celle du premier remplissage qui suit leur tracé.
        const bars = calls.flatMap((call, index) => call.name === 'roundRect' && call.args[2] === 16 ? [String(calls.slice(index).find(next => next.name === 'fill')?.fill)] : []);
        assert.equal(bars.length, 12, theme);
        for (const color of bars) assert.ok(wrappedContrast(color, WRAPPED_THEMES[theme].ink) >= 3, `${theme} ${color}`);
    }
});

test('deux images générées en même temps gardent chacune leur ambiance', async () => {
    // Les affiches de la première arrivent en retard : la seconde est peinte pendant ce temps.
    const slow = fixture({ theme: 'thrill', domain: 'lent.test', items: fixture().items.map(item => ({ ...item, posterUrl: `${item.posterUrl}?slow` })) });
    const fast = fixture({ theme: 'cosmos', domain: 'rapide.test' });
    const start = canvases.length;
    await Promise.all(FORMATS.flatMap(format => [generateWrappedShareCard(slow, format), generateWrappedShareCard(fast, format)]));
    const drawn = canvases.slice(start);
    for (const [data, other] of [[slow, fast], [fast, slow]] as const) {
        const own = WRAPPED_THEMES[data.theme ?? 'electric'];
        const foreign = new Set(Object.values(WRAPPED_THEMES[other.theme ?? 'electric']).map(wrappedRgb));
        const mine = drawn.filter(({ calls }) => calls.some(call => call.name === 'fillText' && String(call.args[0]).toLowerCase() === data.domain));
        assert.equal(mine.length, FORMATS.length, data.domain);
        for (const canvas of mine) {
            const colors = painted(canvas);
            assert.ok(colors.has(wrappedRgb(own.primary)), data.domain);
            assert.deepEqual([...colors].filter(color => foreign.has(color)), [], data.domain);
        }
    }
});
