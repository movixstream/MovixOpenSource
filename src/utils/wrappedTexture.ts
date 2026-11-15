/**
 * Grain photographique partagé par le film et les images. La tuile est générée
 * une seule fois avec une suite déterministe ; hors navigateur (tests Node),
 * aucun grain n'est peint et le rendu reste identique d'une exécution à l'autre.
 */
const TILE = 256;
let tile: HTMLCanvasElement | null | undefined;
const patterns = new WeakMap<CanvasRenderingContext2D, CanvasPattern | null>();

function grainTile(): HTMLCanvasElement | null {
    if (tile !== undefined) return tile;
    if (typeof document === 'undefined') return (tile = null);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = TILE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return (tile = null);
    const image = ctx.createImageData(TILE, TILE);
    let seed = 0x2f6b1d;
    for (let index = 0; index < image.data.length; index += 4) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const value = 128 + ((seed >>> 24) - 128) * 0.9;
        image.data[index] = image.data[index + 1] = image.data[index + 2] = value;
        image.data[index + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    return (tile = canvas);
}

/** `seed` décale la tuile : une valeur par image anime le grain du film. */
export function drawWrappedGrain(ctx: CanvasRenderingContext2D, width: number, height: number, alpha = 0.08, seed = 0) {
    const source = grainTile();
    if (!source || typeof ctx.createPattern !== 'function') return;
    let pattern = patterns.get(ctx);
    if (pattern === undefined) {
        pattern = ctx.createPattern(source, 'repeat');
        patterns.set(ctx, pattern);
    }
    if (!pattern) return;
    const x = (seed * 97) % TILE, y = (seed * 61) % TILE;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = 'overlay';
    ctx.translate(-x, -y);
    ctx.fillStyle = pattern;
    ctx.fillRect(x, y, width, height);
    ctx.restore();
}
