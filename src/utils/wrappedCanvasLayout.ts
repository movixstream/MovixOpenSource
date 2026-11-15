export const FONT_STACK = 'Inter, system-ui, sans-serif';
export const DISPLAY_FONT = '"Archivo Black", Inter, system-ui, sans-serif';

export function drawRoundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
    ctx.beginPath();
    // roundRect manque avant Safari 16, Chrome 99 et Firefox 112. Sans repli,
    // l'appel lève une erreur et l'image de partage ne se génère jamais.
    if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y, width, height, r);
        return;
    }
    const right = x + width, bottom = y + height;
    ctx.moveTo(x + r, y);
    ctx.arcTo(right, y, right, bottom, r);
    ctx.arcTo(right, bottom, x, bottom, r);
    ctx.arcTo(x, bottom, x, y, r);
    ctx.arcTo(x, y, right, y, r);
    ctx.closePath();
}

export function wrapCanvasText(ctx: Pick<CanvasRenderingContext2D, 'measureText'>, text: string, maxWidth: number): string[] {
    if (!text.trim()) return [''];
    const lines: string[] = [];
    let line = '';
    for (const word of text.trim().split(/\s+/)) {
        if (ctx.measureText(line ? `${line} ${word}` : word).width <= maxWidth) {
            line = line ? `${line} ${word}` : word;
            continue;
        }
        if (line) lines.push(line);
        line = '';
        for (const char of Array.from(word)) {
            if (line && ctx.measureText(line + char).width > maxWidth) {
                lines.push(line);
                line = '';
            }
            line += char;
        }
    }
    if (line) lines.push(line);
    return lines;
}

export function fitCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number, size: number, minSize = 36, display = false, weight = 800) {
    let lines: string[];
    do {
        ctx.font = `${display ? 400 : weight} ${size}px ${display ? DISPLAY_FONT : FONT_STACK}`;
        lines = wrapCanvasText(ctx, text, maxWidth);
        if (lines.length <= maxLines || size <= minSize) break;
        size = Math.max(minSize, size - 2);
    } while (lines.length > maxLines);
    if (lines.length > maxLines) {
        lines = lines.slice(0, maxLines);
        let last = lines[maxLines - 1];
        while (last && ctx.measureText(`${last}…`).width > maxWidth) last = Array.from(last).slice(0, -1).join('');
        lines[maxLines - 1] = `${last}…`;
    }
    return { lines, size, lineHeight: Math.ceil(size * 1.18) };
}

export function drawFittedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, size: number, maxLines = 2, display = false, weight = 800): number {
    const layout = fitCanvasText(ctx, text, width, maxLines, size, Math.min(size, 36), display, weight);
    layout.lines.forEach((line, i) => ctx.fillText(line, x, y + layout.lineHeight * i));
    return layout.lines.length * layout.lineHeight;
}

/** Cadrage uniforme, sans déformation. Les affiches utilisent contain. */
export function drawCanvasImage(ctx: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number, fit: 'cover' | 'contain' = 'contain') {
    const iw = image.naturalWidth || image.width;
    const ih = image.naturalHeight || image.height;
    if (!iw || !ih || width <= 0 || height <= 0) return;
    const scale = fit === 'cover' ? Math.max(width / iw, height / ih) : Math.min(width / iw, height / ih);
    const sw = Math.min(iw, width / scale), sh = Math.min(ih, height / scale);
    const dw = sw * scale, dh = sh * scale;
    ctx.drawImage(image, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x + (width - dw) / 2, y + (height - dh) / 2, dw, dh);
}
