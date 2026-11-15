import assert from 'node:assert/strict';
import test from 'node:test';
import { drawCanvasImage, drawRoundedRectPath, fitCanvasText, wrapCanvasText } from '../src/utils/wrappedCanvasLayout.ts';

test('sans roundRect (Safari 15, vieux Chrome), le rectangle arrondi est tracé à la main', () => {
    const calls: [string, ...number[]][] = [];
    const record = (name: string) => (...args: number[]) => { calls.push([name, ...args]); };
    // Contexte strict : une méthode absente lève une erreur, comme dans un vrai navigateur.
    const old = { beginPath: record('beginPath'), moveTo: record('moveTo'), arcTo: record('arcTo'), closePath: record('closePath') };
    assert.doesNotThrow(() => drawRoundedRectPath(old as unknown as CanvasRenderingContext2D, 10, 20, 200, 100, 30));
    assert.deepEqual(calls, [
        ['beginPath'],
        ['moveTo', 40, 20],
        ['arcTo', 210, 20, 210, 120, 30],
        ['arcTo', 210, 120, 10, 120, 30],
        ['arcTo', 10, 120, 10, 20, 30],
        ['arcTo', 10, 20, 210, 20, 30],
        ['closePath'],
    ]);

    // Navigateur récent : la méthode native, avec le rayon borné à la demi-hauteur.
    const modern: [string, ...number[]][] = [];
    drawRoundedRectPath({ beginPath() {}, roundRect: (...args: number[]) => { modern.push(['roundRect', ...args]); } } as unknown as CanvasRenderingContext2D, 0, 0, 100, 40, 99);
    assert.deepEqual(modern, [['roundRect', 0, 0, 100, 40, 20]]);
});

function textContext() {
    const ctx = { font: '800 40px Inter', measureText(value: string) { return { width: Array.from(value).length * Number(this.font.match(/(\d+)px/)?.[1] || 40) * 0.5 }; } };
    return ctx as unknown as CanvasRenderingContext2D;
}

test('les mots sans espaces et les caractères hors BMP se répartissent sans déborder', () => {
    const ctx = textContext();
    const text = 'UnTrèsLongTitreSansEspaces🎬🎬🎬';
    const lines = wrapCanvasText(ctx, text, 140);
    assert.equal(lines.join(''), text);
    assert.ok(lines.every(line => ctx.measureText(line).width <= 140));
    assert.deepEqual(wrapCanvasText(ctx, '', 140), ['']);
});

test('un titre long se réduit puis se termine par une ellipse dans la zone réservée', () => {
    const ctx = textContext();
    const layout = fitCanvasText(ctx, 'Une histoire vraiment très longue avec plusieurs sous-titres et beaucoup de personnages'.repeat(3), 400, 2, 74);
    assert.equal(layout.lines.length, 2);
    assert.ok(layout.size >= 36);
    assert.ok(layout.lines[1].endsWith('…'));
    assert.ok(layout.lines.every(line => ctx.measureText(line).width <= 400));
});

test('un titre court garde sa taille de départ', () => {
    const ctx = textContext();
    const result = fitCanvasText(ctx, 'Dune', 936, 2, 74);
    assert.equal(result.size, 74);
    assert.deepEqual(result.lines, ['Dune']);
});

test('une annotation légère garde sa graisse et ses limites de ligne', () => {
    const ctx = textContext();
    const result = fitCanvasText(ctx, 'Jan – Sep in progress, Oct – Dec coming up', 600, 2, 32, 32, false, 400);
    assert.ok(ctx.font.startsWith('400 '));
    assert.ok(result.lines.length <= 2);
    assert.ok(result.lines.every(line => ctx.measureText(line).width <= 600));
});

test('une image paysage dans une affiche conserve son ratio et reste entièrement visible', () => {
    let args: unknown[] = [];
    const ctx = { drawImage: (...values: unknown[]) => { args = values; } } as unknown as CanvasRenderingContext2D;
    const image = { naturalWidth: 600, naturalHeight: 400 } as HTMLImageElement;
    drawCanvasImage(ctx, image, 10, 20, 200, 300);
    const [, sx, sy, sw, sh, dx, dy, dw, dh] = args as [unknown, number, number, number, number, number, number, number, number];
    assert.equal(sx, 0); assert.equal(sy, 0); assert.equal(sw, 600); assert.equal(sh, 400);
    assert.equal(dx, 10); assert.ok(dy > 20);
    assert.ok(Math.abs(dw / dh - 1.5) < 0.0001);
    assert.ok(dw <= 200 && dh <= 300);
});

test('un backdrop en cover remplit la zone avec un recadrage centré, sans étirement', () => {
    let args: unknown[] = [];
    const ctx = { drawImage: (...values: unknown[]) => { args = values; } } as unknown as CanvasRenderingContext2D;
    drawCanvasImage(ctx, { width: 600, height: 400 } as HTMLImageElement, 0, 0, 200, 300, 'cover');
    const [, sx, sy, sw, sh, dx, dy, dw, dh] = args as [unknown, number, number, number, number, number, number, number, number];
    assert.ok(sx > 0); assert.equal(sy, 0); assert.equal(dx, 0); assert.equal(dy, 0);
    assert.equal(dw, 200); assert.equal(dh, 300);
    assert.ok(Math.abs(sw / sh - dw / dh) < 0.0001);
});
