import type { WrappedShareCardData, WrappedShareFormat } from '@/types/wrapped';
import { WRAPPED_DISPLAY_FONT, WRAPPED_TEXT_FONT } from '@/utils/wrappedBrand';
import { ensureShareFonts, loadCanvasImage } from '@/utils/wrappedCanvas';
import { drawCanvasImage, drawRoundedRectPath, fitCanvasText } from '@/utils/wrappedCanvasLayout';
import { WRAPPED_POSTER_RADIUS_RATIO } from '@/utils/wrappedPosterGeometry';
import { drawWrappedGrain } from '@/utils/wrappedTexture';
import { type WrappedPalette, wrappedContrast, wrappedRgb, wrappedThemePalette } from '@/utils/wrappedTheme';

/**
 * Images récap du Wrapped B, dans l'identité « générique de cinéma » du film :
 * encre profonde, grain, lueur de l'ambiance, Archivo Black pour les titres et
 * les chiffres, petites capitales espacées pour les libellés. Les couleurs
 * viennent de l'ambiance du profil (`data.theme`) ; l'accent `highlight` reste
 * réservé au n°1 et chaque format garde sa propre composition.
 */

type Box = { x: number; y: number; width: number; height: number };
type Item = WrappedShareCardData['items'][number];
type Picture = HTMLImageElement | null;
type Align = 'left' | 'center' | 'right';
type Paint = string | CanvasGradient;

export const WRAPPED_SHARE_CARD_SIZES: Readonly<Record<WrappedShareFormat, Readonly<{ width: number; height: number }>>> = {
    story: { width: 1080, height: 1920 },
    'top-five': { width: 1080, height: 1920 },
    poster: { width: 1080, height: 1620 },
    ticket: { width: 1080, height: 1920 },
};

/**
 * Rectangle fixe, en pixels du PNG, où l'affiche n°1 est peinte à plat. L'affiche
 * animée de l'app s'y pose exactement avant de révéler l'image : il ne dépend
 * donc jamais des données. Le billet n'a pas d'affiche.
 */
export const WRAPPED_SHARE_POSTER_BOXES: Readonly<Record<'story' | 'top-five' | 'poster', Readonly<Box>>> = {
    story: { x: 72, y: 184, width: 528, height: 792 },
    'top-five': { x: 72, y: 376, width: 216, height: 324 },
    poster: { x: 270, y: 140, width: 540, height: 810 },
};

const WIDTH = 1080;
const MARGIN = 72;
const CONTENT = WIDTH - MARGIN * 2;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const alpha = (hex: string, value: number) => `rgba(${wrappedRgb(hex)},${value})`;

/** Mélange deux couleurs #rrggbb : 0 garde la première, 1 donne la seconde. */
function mix(from: string, to: string, amount: number): string {
    const [a, b] = [from, to].map(hex => wrappedRgb(hex).split(',').map(Number));
    return `#${a.map((value, index) => Math.round(value + (b[index] - value) * amount).toString(16).padStart(2, '0')).join('')}`;
}

/** Éclaircit une couleur vers `toward` jusqu'au contraste voulu sur `ground`. */
function lift(color: string, toward: string, ground: string, ratio: number): string {
    let amount = 0;
    while (amount < 1 && wrappedContrast(mix(color, toward, amount), ground) < ratio) amount = Math.min(1, amount + 0.05);
    return mix(color, toward, amount);
}

/**
 * Palette de l'ambiance et teintes qui en dérivent. Elle est passée à chaque
 * tracé, jamais rangée dans le module : deux images générées en même temps
 * gardent chacune la leur.
 */
type Tone = WrappedPalette & {
    /** Barres des mois : la couleur vive, éclaircie si elle se perd sur l'encre. */
    bar: string;
    /** Haut du dégradé de l'affiche de repli. */
    fallback: string;
    /** Voile multiplié sur le backdrop monochrome. */
    veil: string;
    /** Papier chaud du billet, à peine teinté par l'accent du n°1. */
    ticketPaper: string;
    /** Texte secondaire du billet. */
    ticketMuted: string;
};

function toneFor(theme: WrappedShareCardData['theme']): Tone {
    const palette = wrappedThemePalette(theme);
    const ticketPaper = mix(palette.paper, palette.highlight, 0.22);
    return {
        ...palette,
        // 3:1, le minimum WCAG d'une marque graphique ; seule une couleur vive très sombre bouge.
        bar: lift(palette.primary, palette.paper, palette.ink, 3),
        fallback: mix(palette.night, palette.primary, 0.18),
        veil: mix(mix(palette.deep, palette.muted, 0.5), palette.ink, 0.4),
        ticketPaper,
        ticketMuted: mix(palette.stage, ticketPaper, 0.45),
    };
}

// ---------------------------------------------------------------------------
// Typographie : chaque bloc est mesuré avant d'être placé, pour empiler les
// éléments sans trou accidentel ni débordement.

type TextStyle = { size: number; min?: number; lines?: number; display?: boolean; weight?: number; leading?: number; tracking?: number; upper?: boolean };
type TextBlock = { lines: string[]; font: string; size: number; cap: number; pitch: number; height: number; width: number; tracking: number; whole: boolean };
type Piece = { width: number; height: number; draw: (x: number, top: number) => void };

const hasTracking = (ctx: CanvasRenderingContext2D) => 'letterSpacing' in ctx;
const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();

function setTracking(ctx: CanvasRenderingContext2D, value: number) {
    // Sans prise en charge, le texte reste simplement moins espacé.
    if (hasTracking(ctx)) ctx.letterSpacing = `${value}px`;
}

const smallCaps = (size: number, weight = 800): TextStyle => ({ size, weight, upper: true, tracking: Math.round(size * 0.2 * 10) / 10 });

function layout(ctx: CanvasRenderingContext2D, value: string, maxWidth: number, style: TextStyle): TextBlock {
    const { size, lines = 1, display = false, weight = 800, upper = false, tracking = 0 } = style;
    const leading = style.leading ?? (display ? 1.02 : 1.24);
    const source = upper ? value.toLocaleUpperCase() : value;
    ctx.save();
    ctx.textBaseline = 'alphabetic';
    setTracking(ctx, tracking);
    const fit = fitCanvasText(ctx, source, Math.max(1, maxWidth), lines, size, Math.min(style.min ?? size, size), display, weight);
    const ascent = ctx.measureText('H').actualBoundingBoxAscent;
    const cap = ascent > 0 ? ascent : fit.size * 0.72;
    // L'espacement s'ajoute aussi après la dernière lettre : il ne compte pas dans la largeur visible.
    const trailing = hasTracking(ctx) ? tracking : 0;
    const width = Math.max(0, ...fit.lines.map(line => ctx.measureText(line).width - trailing));
    const font = ctx.font;
    ctx.restore();
    const pitch = Math.round(fit.size * leading);
    return {
        lines: fit.lines, font, size: fit.size, cap, pitch, width, tracking,
        height: cap + (fit.lines.length - 1) * pitch,
        // Faux si le texte a été abrégé ou coupé au milieu d'un mot.
        whole: normalize(fit.lines.join(' ')) === normalize(source),
    };
}

/** Essaie chaque style dans l'ordre (une ligne d'abord) et garde le premier qui montre le texte entier. */
function firstWhole(ctx: CanvasRenderingContext2D, value: string, maxWidth: number, steps: [TextStyle, ...TextStyle[]]): TextBlock {
    for (const step of steps.slice(0, -1)) {
        const block = layout(ctx, value, maxWidth, step);
        if (block.whole) return block;
    }
    return layout(ctx, value, maxWidth, steps[steps.length - 1]);
}

/** `top` désigne le haut des capitales de la première ligne. */
function paint(ctx: CanvasRenderingContext2D, block: TextBlock, x: number, top: number, color: Paint, align: Align = 'left', stroke = 0) {
    ctx.save();
    ctx.font = block.font;
    setTracking(ctx, block.tracking);
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    const shift = hasTracking(ctx) ? (align === 'center' ? block.tracking / 2 : align === 'right' ? block.tracking : 0) : 0;
    block.lines.forEach((line, index) => {
        const y = top + block.cap + index * block.pitch;
        if (stroke) {
            ctx.strokeStyle = color;
            ctx.lineWidth = stroke;
            ctx.lineJoin = 'round';
            ctx.strokeText(line, x + shift, y);
        } else {
            ctx.fillStyle = color;
            ctx.fillText(line, x + shift, y);
        }
    });
    ctx.restore();
}

function piece(ctx: CanvasRenderingContext2D, block: TextBlock, color: Paint, align: Align = 'left'): Piece {
    return { width: block.width, height: block.height, draw: (x, top) => paint(ctx, block, x, top, color, align) };
}

/** Empile des éléments avec un écart propre à chacun ; les éléments absents disparaissent sans laisser de vide. */
function vstack(parts: Array<[Piece | null | undefined, number]>): Piece {
    const list = parts.filter((part): part is [Piece, number] => Boolean(part[0]));
    const height = list.reduce((sum, [part, gap], index) => sum + part.height + (index ? gap : 0), 0);
    return {
        width: Math.max(0, ...list.map(([part]) => part.width)),
        height,
        draw: (x, top) => {
            let y = top;
            list.forEach(([part, gap], index) => {
                if (index) y += gap;
                part.draw(x, y);
                y += part.height;
            });
        },
    };
}

function columns(left: Piece, right: Piece, offset: number): Piece {
    return {
        width: offset + right.width,
        height: Math.max(left.height, right.height),
        draw: (x, top) => {
            left.draw(x, top);
            right.draw(x + offset, top);
        },
    };
}

type Section = { piece: Piece; rule?: boolean };

function sections(list: Array<{ piece: Piece | null; rule?: boolean }>): Section[] {
    return list.filter((section): section is Section => Boolean(section.piece));
}

const stackHeight = (list: Section[], gap: number) => list.reduce((sum, section) => sum + section.piece.height, 0) + gap * Math.max(0, list.length - 1);

/**
 * Répartit les sections entre deux bornes : l'espace libre devient un rythme
 * régulier, jamais un trou. `top` garde la première section collée à ce qui la
 * précède et laisse le surplus en bas.
 */
function distribute(ctx: CanvasRenderingContext2D, tone: Tone, list: Section[], x: number, top: number, bottom: number, gaps: { min: number; max: number; anchor?: 'center' | 'top' }) {
    if (!list.length) return;
    const total = stackHeight(list, 0);
    const gap = list.length > 1 ? clamp((bottom - top - total) / (list.length - 1), gaps.min, gaps.max) : 0;
    const spare = Math.max(0, bottom - top - total - gap * (list.length - 1));
    let y = top + (gaps.anchor === 'top' ? 0 : spare / 2);
    list.forEach((section, index) => {
        if (index && section.rule) rule(ctx, MARGIN, WIDTH - MARGIN, Math.round(y - gap / 2), alpha(tone.light, 0.2));
        section.piece.draw(x, y);
        y += section.piece.height + gap;
    });
}

/** Ligne composée de plusieurs styles, centrée ; elle se réduit puis s'abrège au besoin. */
type Run = { text: string; size: number; weight?: number; display?: boolean; color: string; tracking?: number; upper?: boolean };

function runFont(run: Run, scale: number) {
    return run.display ? `400 ${run.size * scale}px ${WRAPPED_DISPLAY_FONT}` : `${run.weight ?? 800} ${run.size * scale}px ${WRAPPED_TEXT_FONT}`;
}

function prepareRuns(source: Run[]): Run[] {
    return source.filter(run => run.text.trim()).map(run => ({ ...run, text: run.upper ? run.text.toLocaleUpperCase() : run.text }));
}

function measureRun(ctx: CanvasRenderingContext2D, run: Run, scale: number) {
    ctx.font = runFont(run, scale);
    setTracking(ctx, (run.tracking ?? 0) * scale);
    return ctx.measureText(run.text).width;
}

/** Largeur naturelle d'une ligne composée, avant toute réduction. */
function runsWidth(ctx: CanvasRenderingContext2D, source: Run[]): number {
    ctx.save();
    const width = prepareRuns(source).reduce((sum, run) => sum + measureRun(ctx, run, 1), 0);
    ctx.restore();
    return width;
}

function runLine(ctx: CanvasRenderingContext2D, source: Run[], maxWidth: number, minScale = 0.62): Piece | null {
    const runs = prepareRuns(source);
    if (!runs.length) return null;
    const measure = (run: Run, scale: number) => measureRun(ctx, run, scale);
    ctx.save();
    let scale = 1;
    let widths = runs.map(run => measure(run, 1));
    const natural = widths.reduce((sum, width) => sum + width, 0);
    if (natural > maxWidth) {
        scale = Math.max(minScale, maxWidth / natural);
        widths = runs.map(run => measure(run, scale));
        const overflow = widths.reduce((sum, width) => sum + width, 0) - maxWidth;
        if (overflow > 0) {
            // Le dernier segment porte la donnée variable (portrait, traits) : c'est lui qu'on abrège.
            const last = runs.length - 1;
            const room = Math.max(40, widths[last] - overflow);
            let text = runs[last].text;
            measure(runs[last], scale);
            while (text.length > 1 && ctx.measureText(`${text}…`).width > room) text = Array.from(text).slice(0, -1).join('');
            runs[last] = { ...runs[last], text: `${text.trimEnd()}…` };
            widths[last] = measure(runs[last], scale);
        }
    }
    const caps = runs.map(run => {
        ctx.font = runFont(run, scale);
        const ascent = ctx.measureText('H').actualBoundingBoxAscent;
        return ascent > 0 ? ascent : run.size * scale * 0.72;
    });
    ctx.restore();
    const width = widths.reduce((sum, value) => sum + value, 0) - (hasTracking(ctx) ? (runs[runs.length - 1].tracking ?? 0) * scale : 0);
    const cap = Math.max(...caps);
    return {
        width,
        height: cap,
        draw: (centerX, top) => {
            ctx.save();
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            let x = centerX - width / 2;
            runs.forEach((run, index) => {
                ctx.font = runFont(run, scale);
                setTracking(ctx, (run.tracking ?? 0) * scale);
                ctx.fillStyle = run.color;
                ctx.fillText(run.text, x, top + cap);
                x += widths[index];
            });
            ctx.restore();
        },
    };
}

// ---------------------------------------------------------------------------
// Décor commun : encre, lueur de l'ambiance, vignettage, grain, filets et repères de caméra.

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, strength: number) {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, alpha(color, strength));
    gradient.addColorStop(0.45, alpha(color, strength * 0.4));
    gradient.addColorStop(1, alpha(color, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

function ground(ctx: CanvasRenderingContext2D, tone: Tone, width: number, height: number) {
    ctx.fillStyle = tone.ink;
    ctx.fillRect(0, 0, width, height);
}

function vignette(ctx: CanvasRenderingContext2D, tone: Tone, width: number, height: number) {
    const shade = ctx.createRadialGradient(width / 2, height * 0.45, Math.min(width, height) * 0.45, width / 2, height * 0.45, Math.hypot(width, height) * 0.62);
    shade.addColorStop(0, alpha(tone.ink, 0));
    shade.addColorStop(1, alpha(tone.ink, 0.5));
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, width, height);
}

function rule(ctx: CanvasRenderingContext2D, x1: number, x2: number, y: number, color: string, width = 2) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x1, y);
    ctx.lineTo(x2, y);
    ctx.stroke();
    ctx.restore();
}

/** Crochets de cadrage autour d'une zone, jamais par-dessus. */
function brackets(ctx: CanvasRenderingContext2D, box: Box, offset: number, length: number, color: string, width = 3) {
    const x0 = box.x - offset, y0 = box.y - offset, x1 = box.x + box.width + offset, y1 = box.y + box.height + offset;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'square';
    for (const [x, y, dx, dy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
        ctx.beginPath();
        ctx.moveTo(x, y + dy * length);
        ctx.lineTo(x, y);
        ctx.lineTo(x + dx * length, y);
        ctx.stroke();
    }
    ctx.restore();
}

/** Ligne centrée encadrée de deux filets, en tête ou en pied d'affiche. */
function flanked(ctx: CanvasRenderingContext2D, line: Piece, top: number, color: string, length = 76, gap = 28) {
    line.draw(WIDTH / 2, top);
    const y = Math.round(top + line.height / 2);
    rule(ctx, WIDTH / 2 - line.width / 2 - gap - length, WIDTH / 2 - line.width / 2 - gap, y, color);
    rule(ctx, WIDTH / 2 + line.width / 2 + gap, WIDTH / 2 + line.width / 2 + gap + length, y, color);
}

/** Grand millésime : remplissage de la couleur vive qui s'éteint vers le bas, contour net par-dessus. */
function bigYear(ctx: CanvasRenderingContext2D, tone: Tone, year: number, x: number, top: number, maxWidth: number, size: number, align: Align, strength = 1): TextBlock {
    const block = layout(ctx, String(year), maxWidth, { size, min: 96, display: true });
    const fill = ctx.createLinearGradient(0, top, 0, top + block.cap);
    fill.addColorStop(0, alpha(tone.primary, 0.42 * strength));
    fill.addColorStop(1, alpha(tone.primary, 0.04 * strength));
    paint(ctx, block, x, top, fill, align);
    paint(ctx, block, x, top, alpha(tone.light, 0.9 * strength), align, 3);
    return block;
}

/** Backdrop monochrome dans la teinte profonde de l'ambiance, fondu vers l'encre : du contraste, pas de gris. */
function cinematicBackdrop(ctx: CanvasRenderingContext2D, tone: Tone, image: HTMLImageElement, height: number) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, WIDTH, height);
    ctx.clip();
    drawCanvasImage(ctx, image, 0, 0, WIDTH, height, 'cover');
    ctx.globalCompositeOperation = 'color';
    ctx.fillStyle = tone.deep;
    ctx.fillRect(0, 0, WIDTH, height);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = tone.veil;
    ctx.fillRect(0, 0, WIDTH, height);
    ctx.restore();
    const fade = ctx.createLinearGradient(0, 0, 0, height);
    fade.addColorStop(0, alpha(tone.ink, 0.7));
    fade.addColorStop(0.3, alpha(tone.ink, 0.28));
    fade.addColorStop(0.68, alpha(tone.ink, 0.8));
    fade.addColorStop(1, tone.ink);
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, WIDTH, height);
}

function header(ctx: CanvasRenderingContext2D, tone: Tone, tag: string) {
    const mark = layout(ctx, 'MOVIX', 320, { size: 40, display: true });
    paint(ctx, mark, MARGIN, 76, tone.paper);
    const label = layout(ctx, tag, CONTENT - mark.width - 56, smallCaps(22));
    paint(ctx, label, WIDTH - MARGIN, 76 + mark.cap - label.cap, tone.light, 'right');
}

function footer(ctx: CanvasRenderingContext2D, tone: Tone, data: WrappedShareCardData, baseline: number) {
    const domain = layout(ctx, data.domain, 420, { size: 24, weight: 800, tracking: 1 });
    paint(ctx, domain, WIDTH - MARGIN, baseline - domain.cap, tone.paper, 'right');
    const period = layout(ctx, data.period || data.signatureCaption, CONTENT - domain.width - 40, { size: 24, weight: 400 });
    paint(ctx, period, MARGIN, baseline - period.cap, tone.muted);
}

// ---------------------------------------------------------------------------
// Affiches : image entière (contain) dans un 2:3 arrondi comme dans l'app, ou
// affiche typographique quand l'image manque.

function posterShadow(ctx: CanvasRenderingContext2D, tone: Tone, box: Box, strength = 0.55) {
    ctx.save();
    ctx.shadowColor = alpha(tone.ink, strength);
    ctx.shadowBlur = Math.max(12, box.width * 0.12);
    ctx.shadowOffsetY = Math.max(6, box.width * 0.04);
    drawRoundedRectPath(ctx, box.x, box.y, box.width, box.height, box.width * WRAPPED_POSTER_RADIUS_RATIO);
    ctx.fillStyle = tone.night;
    ctx.fill();
    ctx.restore();
}

function drawPoster(ctx: CanvasRenderingContext2D, tone: Tone, image: Picture, box: Box, title: string, year: number, rank: number) {
    ctx.save();
    drawRoundedRectPath(ctx, box.x, box.y, box.width, box.height, box.width * WRAPPED_POSTER_RADIUS_RATIO);
    ctx.fillStyle = tone.night;
    ctx.fill();
    ctx.clip();
    if (image) drawCanvasImage(ctx, image, box.x, box.y, box.width, box.height);
    else drawPosterFallback(ctx, tone, box, title, year, rank);
    ctx.restore();
}

function drawPosterFallback(ctx: CanvasRenderingContext2D, tone: Tone, box: Box, title: string, year: number, rank: number) {
    const { x, y, width: w, height: h } = box;
    const shade = ctx.createLinearGradient(x, y, x, y + h);
    shade.addColorStop(0, tone.fallback);
    shade.addColorStop(0.6, tone.night);
    shade.addColorStop(1, tone.ink);
    ctx.fillStyle = shade;
    ctx.fillRect(x, y, w, h);
    glow(ctx, x + w * 0.78, y + h * 0.1, w * 0.95, tone.primary, 0.4);
    const inset = Math.max(7, Math.round(w * 0.06));
    ctx.strokeStyle = alpha(tone.light, 0.3);
    ctx.lineWidth = Math.max(1.5, w * 0.004);
    drawRoundedRectPath(ctx, x + inset / 2, y + inset / 2, w - inset, h - inset, w * WRAPPED_POSTER_RADIUS_RATIO * 0.6);
    ctx.stroke();
    const accent = rank === 1 ? tone.highlight : tone.light;
    if (w < 240) {
        // Vignette : un monogramme lisible, le titre complet est écrit à côté.
        const initial = Array.from(title.trim())[0]?.toLocaleUpperCase() || String(rank);
        const mark = layout(ctx, initial, w - inset * 2, { size: w * 0.52, display: true });
        paint(ctx, mark, x + w / 2, y + (h - mark.cap) / 2, tone.paper, 'center');
        rule(ctx, x + w * 0.3, x + w * 0.7, y + h * 0.78, alpha(accent, 0.8), Math.max(2, w * 0.016));
        return;
    }
    const pad = inset * 1.8;
    const brand = layout(ctx, 'Movix', w * 0.5, smallCaps(Math.round(w * 0.04)));
    paint(ctx, brand, x + pad, y + pad, tone.light);
    const number = layout(ctx, String(rank).padStart(2, '0'), w * 0.3, { size: Math.round(w * 0.075), display: true });
    paint(ctx, number, x + w - pad, y + pad + brand.cap - number.cap, accent, 'right');
    const foot = layout(ctx, String(year), w * 0.5, smallCaps(Math.round(w * 0.036)));
    const footTop = y + h - pad - foot.cap;
    paint(ctx, foot, x + pad, footTop, alpha(tone.paper, 0.6));
    rule(ctx, x + pad, x + w - pad, footTop - pad * 0.7, alpha(accent, 0.7), Math.max(2, w * 0.005));
    const name = layout(ctx, title || '—', w - pad * 2, { size: Math.round(w * 0.13), min: Math.round(w * 0.065), lines: 5, display: true, leading: 1.04 });
    paint(ctx, name, x + pad, footTop - pad * 1.6 - name.height, tone.paper);
}

function thumbnail(ctx: CanvasRenderingContext2D, tone: Tone, image: Picture, box: Box, item: Item, year: number, rank: number) {
    posterShadow(ctx, tone, box, 0.5);
    drawPoster(ctx, tone, image, box, item.title, year, rank);
}

// ---------------------------------------------------------------------------
// Données : chiffres, traits et signature mensuelle.

function traitLabels(data: WrappedShareCardData) {
    return (data.traits ?? []).map(trait => trait.label.trim()).filter(Boolean).slice(0, 2);
}

/** Traits en pastilles sur une seule ligne ; seul le libellé est dessiné, jamais la preuve. */
function pills(ctx: CanvasRenderingContext2D, tone: Tone, labels: string[], maxWidth: number, options: { size?: number } = {}): Piece | null {
    if (!labels.length) return null;
    const gap = 14;
    let size = options.size ?? 26;
    const padding = () => Math.round(size * 0.78);
    const measure = (limit: number) => labels.map(label => layout(ctx, label, limit, { size, weight: 600 }));
    let blocks = measure(maxWidth);
    const total = () => blocks.reduce((sum, block) => sum + block.width + padding() * 2, 0) + gap * (blocks.length - 1);
    if (total() > maxWidth) {
        size = Math.max(21, Math.floor(size * maxWidth / total()));
        blocks = measure(maxWidth);
        if (total() > maxWidth) blocks = measure((maxWidth - gap * (labels.length - 1)) / labels.length - padding() * 2);
    }
    const height = Math.round(size * 1.95);
    return {
        width: total(),
        height,
        draw: (x, top) => {
            let left = x;
            blocks.forEach(block => {
                const width = block.width + padding() * 2;
                ctx.save();
                drawRoundedRectPath(ctx, left + 1, top + 1, width - 2, height - 2, height / 2);
                ctx.strokeStyle = alpha(tone.light, 0.55);
                ctx.lineWidth = 2;
                ctx.stroke();
                ctx.restore();
                paint(ctx, block, left + padding(), top + (height - block.cap) / 2, tone.paper);
                left += width + gap;
            });
        },
    };
}

/** Douze barres fines avec l'initiale des mois ; les mois à venir restent en contour. */
function months(ctx: CanvasRenderingContext2D, tone: Tone, data: WrappedShareCardData, width: number, options: { bar?: number; label?: string } = {}): Piece | null {
    const values = Array.from({ length: 12 }, (_, index) => Math.max(0, Number(data.signature[index]) || 0));
    const max = Math.max(...values);
    if (!(max > 0)) return null;
    const bar = options.bar ?? 100;
    const initials = data.monthLabels?.length === 12 ? data.monthLabels : null;
    const letters = initials?.map(initial => layout(ctx, initial, 40, { size: 20, weight: 800 }));
    const letterCap = letters ? Math.max(...letters.map(letter => letter.cap)) : 0;
    const future = data.signatureFutureFrom;
    const chart: Piece = {
        width,
        height: bar + (letters ? 18 + letterCap : 0),
        draw: (x, top) => {
            const step = width / 12;
            const barWidth = Math.min(16, step * 0.24);
            values.forEach((value, index) => {
                const center = x + step * (index + 0.5);
                const upcoming = future != null && index + 1 >= future && value === 0;
                ctx.save();
                if (upcoming) {
                    // Mois pas encore écoulé : un emplacement en pointillés, pas une chute à zéro.
                    const h = bar * 0.5;
                    drawRoundedRectPath(ctx, center - barWidth / 2 + 1, top + bar - h + 1, barWidth - 2, h - 2, barWidth / 2);
                    ctx.setLineDash([5, 5]);
                    ctx.strokeStyle = alpha(tone.light, 0.6);
                    ctx.lineWidth = 2;
                    ctx.stroke();
                } else {
                    const h = value > 0 ? Math.max(barWidth, (value / max) * bar) : 4;
                    drawRoundedRectPath(ctx, center - barWidth / 2, top + bar - h, barWidth, h, Math.min(barWidth / 2, h / 2));
                    ctx.fillStyle = value === max ? tone.light : tone.bar;
                    ctx.fill();
                }
                ctx.restore();
                const letter = letters?.[index];
                if (letter) paint(ctx, letter, center, top + bar + 18 + letterCap - letter.cap, upcoming ? alpha(tone.muted, 0.55) : tone.muted, 'center');
            });
        },
    };
    return options.label ? vstack([[piece(ctx, layout(ctx, options.label, width, smallCaps(20)), tone.muted), 0], [chart, 26]]) : chart;
}

/** Libellé en petites capitales suivi d'une valeur. */
function stat(ctx: CanvasRenderingContext2D, tone: Tone, label: string, value: Piece, width: number, size = 24, gap = 18): Piece {
    return vstack([[piece(ctx, layout(ctx, label, width, smallCaps(size)), tone.light), 0], [value, gap]]);
}

/** Temps regardé : les heures dominent, les minutes suivent en plus petit, sur la même ligne si possible. */
function watchTime(ctx: CanvasRenderingContext2D, tone: Tone, data: WrappedShareCardData, width: number, size: number, inline = false): Piece {
    const parts = data.watchTimeParts.length ? data.watchTimeParts : [data.watchTime];
    const main = layout(ctx, parts[0], width, { size, min: Math.round(size * 0.5), display: true });
    const rest = parts.slice(1).join(' ');
    if (!rest) return piece(ctx, main, tone.paper);
    const tailSize = Math.round(size * 0.44);
    const space = Math.round(size * 0.16);
    if (inline) {
        const tail = layout(ctx, rest, Math.max(1, width - main.width - space), { size: tailSize, display: true });
        if (tail.whole && main.width + space + tail.width <= width) {
            return {
                width: main.width + space + tail.width,
                height: main.height,
                draw: (x, top) => {
                    paint(ctx, main, x, top, tone.paper);
                    paint(ctx, tail, x + main.width + space, top + main.cap - tail.cap, alpha(tone.paper, 0.72));
                },
            };
        }
    }
    const tail = layout(ctx, rest, width, { size: tailSize, min: 24, display: true });
    return vstack([[piece(ctx, main, tone.paper), 0], [piece(ctx, tail, alpha(tone.paper, 0.72)), Math.round(size * 0.18)]]);
}

function number(ctx: CanvasRenderingContext2D, tone: Tone, value: string, width: number, size: number): Piece {
    return piece(ctx, layout(ctx, value, width, { size, min: Math.round(size * 0.5), display: true }), tone.paper);
}

function signatureSeed(data: WrappedShareCardData): number {
    const source = [data.year, data.domain, data.watchTime, data.titleCount, data.persona, ...data.items.map(item => item.title)].join('|');
    let hash = 0x811c9dc5;
    for (const char of source) {
        hash ^= char.codePointAt(0) ?? 0;
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
}

function random(seed: number) {
    let state = seed >>> 0 || 1;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ---------------------------------------------------------------------------
// 1. Story : l'affiche de l'année.

function drawStory(ctx: CanvasRenderingContext2D, tone: Tone, data: WrappedShareCardData, pictures: Picture[], backdrop: Picture) {
    const { height } = WRAPPED_SHARE_CARD_SIZES.story;
    const box = WRAPPED_SHARE_POSTER_BOXES.story;
    ground(ctx, tone, WIDTH, height);
    if (!data.items.length) return drawTypographic(ctx, tone, data, height, data.labels.heading, 5);
    if (backdrop) cinematicBackdrop(ctx, tone, backdrop, 1100);
    glow(ctx, box.x + box.width * 0.5, box.y + box.height * 0.45, 860, tone.primary, backdrop ? 0.24 : 0.36);
    glow(ctx, WIDTH - 40, height - 300, 760, tone.deep, 0.28);
    vignette(ctx, tone, WIDTH, height);
    drawWrappedGrain(ctx, WIDTH, height, 0.07, 5);
    header(ctx, tone, data.labels.heading);

    const [favorite, ...others] = data.items;
    brackets(ctx, box, 22, 48, tone.highlight, 3);
    posterShadow(ctx, tone, box);
    drawPoster(ctx, tone, pictures[0] ?? null, box, favorite.title, data.year, 1);

    // Colonne droite : millésime empilé, puis les deux chiffres de l'année calés sur le bas de l'affiche.
    const columnX = box.x + box.width + 48;
    const columnWidth = WIDTH - MARGIN - columnX;
    const figures = vstack([
        [stat(ctx, tone, data.labels.watchTime, watchTime(ctx, tone, data, columnWidth, 100), columnWidth), 0],
        [stat(ctx, tone, data.labels.titles, number(ctx, tone, data.titleCount, columnWidth, 100), columnWidth), 52],
    ]);
    const figuresTop = box.y + box.height - figures.height;
    figures.draw(columnX, figuresTop);
    yearStack(ctx, tone, data.year, columnX, box.y, columnWidth, figuresTop - 64 - box.y);

    // Sous l'affiche : le n°1, les seconds rôles, le portrait, l'année mois par mois.
    const duration = layout(ctx, favorite.duration, 300, { size: 26, weight: 800 });
    const tag = layout(ctx, `01 · ${data.labels.favorite}`, CONTENT - duration.width - 32, smallCaps(22));
    const title = firstWhole(ctx, favorite.title, CONTENT, [
        { size: 84, min: 64, display: true },
        { size: 62, min: 44, lines: 2, display: true, leading: 1.04 },
    ]);
    const lead: Piece = {
        width: CONTENT,
        height: tag.height + 24 + title.height,
        draw: (x, top) => {
            paint(ctx, tag, x, top, tone.highlight);
            paint(ctx, duration, WIDTH - MARGIN, top + tag.cap - duration.cap, tone.highlight, 'right');
            paint(ctx, title, x, top + tag.height + 24, tone.paper);
        },
    };
    const top = box.y + box.height + 64;
    const bottom = height - 124;
    const build = (compact: boolean) => sections([
        { piece: lead },
        { piece: supporting(ctx, tone, others.slice(0, 2), pictures.slice(1), data.year), rule: true },
        { piece: portrait(ctx, tone, data, compact ? 52 : 66), rule: true },
        { piece: months(ctx, tone, data, CONTENT, { bar: compact ? 84 : 104, label: compact ? undefined : data.labels.signature }) },
    ]);
    let list = build(false);
    if (stackHeight(list, 36) > bottom - top) list = build(true);
    // Le titre du n°1 reste collé à son affiche ; un portrait plus court libère de l'air en bas.
    distribute(ctx, tone, list, MARGIN, top, bottom, { min: 34, max: 120, anchor: 'top' });
    footer(ctx, tone, data, height - 64);
}

/** Portrait : libellé, persona sur une ligne si possible, puis les traits. */
function portrait(ctx: CanvasRenderingContext2D, tone: Tone, data: WrappedShareCardData, size: number): Piece {
    const persona = firstWhole(ctx, data.persona, CONTENT, [
        { size, min: Math.round(size * 0.8), display: true },
        { size: Math.round(size * 0.8), min: Math.round(size * 0.6), lines: 2, display: true, leading: 1.04 },
    ]);
    return vstack([
        [piece(ctx, layout(ctx, data.labels.persona, CONTENT, smallCaps(22)), tone.light), 0],
        [piece(ctx, persona, tone.paper), 22],
        [pills(ctx, tone, traitLabels(data), CONTENT), 26],
    ]);
}

/** Millésime en contour, coupé en deux lignes (20 / 26) pour tenir dans la colonne. */
function yearStack(ctx: CanvasRenderingContext2D, tone: Tone, year: number, x: number, top: number, width: number, available: number) {
    const value = String(year);
    const halves = value.length === 4 ? [value.slice(0, 2), value.slice(2)] : [value];
    let size = 320;
    let blocks: TextBlock[] = [];
    for (;;) {
        blocks = halves.map(half => layout(ctx, half, width, { size, min: 60, display: true }));
        const fitted = Math.min(...blocks.map(block => block.size));
        if (fitted < size) {
            size = fitted;
            blocks = halves.map(half => layout(ctx, half, width, { size, display: true }));
        }
        const total = blocks.reduce((sum, block) => sum + block.cap, 0) + Math.round(size * 0.1) * (blocks.length - 1);
        if (total <= available || size <= 60) break;
        size = Math.max(60, size - 6);
    }
    let y = top;
    blocks.forEach(block => {
        paint(ctx, block, x - 4, y, alpha(tone.light, 0.92), 'left', 3);
        y += block.cap + Math.round(size * 0.1);
    });
}

/** N°2 et n°3 en vignettes, rang et titre lisibles ; une seule cellule s'étale sur toute la largeur. */
function supporting(ctx: CanvasRenderingContext2D, tone: Tone, items: Item[], pictures: Picture[], year: number): Piece | null {
    if (!items.length) return null;
    const cellGap = 40;
    const cellWidth = items.length > 1 ? (CONTENT - cellGap) / 2 : CONTENT;
    const poster = { width: 108, height: 162 };
    const textWidth = cellWidth - poster.width - 26;
    const cells = items.map((item, index) => vstack([
        [piece(ctx, layout(ctx, String(index + 2).padStart(2, '0'), textWidth, smallCaps(22)), tone.light), 0],
        [piece(ctx, layout(ctx, item.title, textWidth, { size: 32, min: 26, lines: 2, weight: 800, leading: 1.14 }), tone.paper), 18],
        [piece(ctx, layout(ctx, item.duration, textWidth, { size: 24, weight: 600 }), tone.muted), 16],
    ]));
    return {
        width: CONTENT,
        height: poster.height,
        draw: (x, top) => {
            items.forEach((item, index) => {
                const left = x + index * (cellWidth + cellGap);
                thumbnail(ctx, tone, pictures[index] ?? null, { x: left, y: top, ...poster }, item, year, index + 2);
                cells[index].draw(left + poster.width + 26, top + (poster.height - cells[index].height) / 2);
            });
        },
    };
}

/** Sans aucun titre : une composition typographique complète, sans emplacement vide. */
function drawTypographic(ctx: CanvasRenderingContext2D, tone: Tone, data: WrappedShareCardData, height: number, tag: string, seed: number) {
    glow(ctx, WIDTH * 0.3, 420, 900, tone.primary, 0.34);
    glow(ctx, WIDTH - 40, height - 300, 760, tone.deep, 0.28);
    vignette(ctx, tone, WIDTH, height);
    drawWrappedGrain(ctx, WIDTH, height, 0.07, seed);
    header(ctx, tone, tag);
    const persona = firstWhole(ctx, data.persona, CONTENT, [
        { size: 124, min: 92, display: true },
        { size: 100, min: 72, lines: 2, display: true, leading: 1.0 },
        { size: 80, min: 56, lines: 3, display: true, leading: 1.0 },
    ]);
    const half = (CONTENT - 48) / 2;
    const yearSize = layout(ctx, String(data.year), CONTENT, { size: 340, min: 120, display: true });
    distribute(ctx, tone, sections([
        { piece: { width: CONTENT, height: yearSize.height, draw: (x, top) => bigYear(ctx, tone, data.year, x - 6, top, CONTENT, 340, 'left') } },
        { piece: vstack([
            [piece(ctx, layout(ctx, data.labels.persona, CONTENT, smallCaps(24)), tone.light), 0],
            [piece(ctx, persona, tone.paper), 28],
            [pills(ctx, tone, traitLabels(data), CONTENT, { size: 28 }), 32],
        ]) },
        { piece: columns(
            stat(ctx, tone, data.labels.watchTime, watchTime(ctx, tone, data, half, 104, true), half),
            stat(ctx, tone, data.labels.titles, number(ctx, tone, data.titleCount, half, 104), half),
            half + 48,
        ), rule: true },
        { piece: months(ctx, tone, data, CONTENT, { bar: 210, label: data.labels.signature }), rule: true },
    ]), MARGIN, 196, height - 132, { min: 64, max: 170 });
    footer(ctx, tone, data, height - 64);
}

// ---------------------------------------------------------------------------
// 2. Top 5 : le classement, avec une barre proportionnelle aux minutes.

function drawTopFive(ctx: CanvasRenderingContext2D, tone: Tone, data: WrappedShareCardData, pictures: Picture[]) {
    const { height } = WRAPPED_SHARE_CARD_SIZES['top-five'];
    const box = WRAPPED_SHARE_POSTER_BOXES['top-five'];
    ground(ctx, tone, WIDTH, height);
    if (!data.items.length) return drawTypographic(ctx, tone, data, height, `Wrapped ${data.year}`, 7);
    glow(ctx, box.x + 140, box.y + box.height / 2, 760, tone.primary, 0.32);
    glow(ctx, WIDTH - 60, height - 260, 700, tone.deep, 0.26);
    vignette(ctx, tone, WIDTH, height);
    drawWrappedGrain(ctx, WIDTH, height, 0.07, 7);
    header(ctx, tone, `Wrapped ${data.year}`);
    const heading = layout(ctx, data.labels.topFive, CONTENT, { size: 124, min: 72, display: true });
    paint(ctx, heading, MARGIN, 168, tone.paper);
    rule(ctx, MARGIN, WIDTH - MARGIN, 168 + heading.cap + 40, alpha(tone.light, 0.22));

    const items = data.items.slice(0, 5);
    const max = Math.max(0, ...items.map(item => Number(item.minutes) || 0));
    const textX = box.x + box.width + 32;
    const textWidth = WIDTH - MARGIN - textX;
    // Même origine et même échelle pour toutes les barres : le n°1 vaut la largeur entière.
    const bar = (top: number, minutes: number | undefined, color: string) => {
        if (!(max > 0)) return;
        ctx.save();
        drawRoundedRectPath(ctx, textX, top, textWidth, 10, 5);
        ctx.fillStyle = alpha(tone.paper, 0.09);
        ctx.fill();
        const share = Math.max(0, Number(minutes) || 0) / max;
        if (share > 0) {
            drawRoundedRectPath(ctx, textX, top, Math.max(10, textWidth * share), 10, 5);
            ctx.fillStyle = color;
            ctx.fill();
        }
        ctx.restore();
    };

    // Ligne n°1 : grande vignette, numéro, libellé et barre dans l'accent du n°1.
    const [favorite] = items;
    ctx.save();
    drawRoundedRectPath(ctx, MARGIN - 24, box.y - 24, CONTENT + 48, box.height + 48, 28);
    const panel = ctx.createLinearGradient(MARGIN, 0, WIDTH - MARGIN, 0);
    panel.addColorStop(0, alpha(tone.highlight, 0.13));
    panel.addColorStop(1, alpha(tone.highlight, 0.02));
    ctx.fillStyle = panel;
    ctx.fill();
    ctx.strokeStyle = alpha(tone.highlight, 0.28);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    posterShadow(ctx, tone, box);
    drawPoster(ctx, tone, pictures[0] ?? null, box, favorite.title, data.year, 1);
    const rank = layout(ctx, '01', textWidth, { size: 96, display: true });
    const tag = layout(ctx, data.labels.favorite, textWidth, smallCaps(22));
    const title = firstWhole(ctx, favorite.title, textWidth, [
        { size: 60, min: 48, display: true },
        { size: 48, min: 36, lines: 2, display: true, leading: 1.04 },
    ]);
    const minutes = layout(ctx, favorite.duration, textWidth, { size: 30, weight: 800 });
    const leadHeight = rank.height + 26 + tag.height + 20 + title.height + 28 + minutes.height + (max > 0 ? 18 + 10 : 0);
    let y = box.y + (box.height - leadHeight) / 2;
    paint(ctx, rank, textX, y, tone.highlight);
    y += rank.height + 26;
    paint(ctx, tag, textX, y, tone.highlight);
    y += tag.height + 20;
    paint(ctx, title, textX, y, tone.paper);
    y += title.height + 28;
    paint(ctx, minutes, textX, y, tone.highlight);
    bar(y + minutes.height + 18, favorite.minutes, tone.highlight);

    // Bas : chiffres et traits, calés au-dessus du pied de page.
    const half = (CONTENT - 48) / 2;
    const closing = vstack([
        [columns(
            stat(ctx, tone, data.labels.watchTime, watchTime(ctx, tone, data, half, 84, true), half),
            stat(ctx, tone, data.labels.titles, number(ctx, tone, data.titleCount, half, 84), half),
            half + 48,
        ), 0],
        [pills(ctx, tone, traitLabels(data), CONTENT), 36],
    ]);
    const closingTop = height - 128 - closing.height;
    const ruleY = closingTop - 52;

    // Lignes 2 à 5 : rang, vignette, titre, durée et barre sur la même échelle. Un
    // classement un peu court s'aère ; un classement très court laisse la place au millésime.
    const rest = items.slice(1);
    const rowHeight = 168;
    const thumb = { width: 112, height: rowHeight };
    const natural = rest.length ? 44 + rest.length * rowHeight + (rest.length - 1) * 28 : 0;
    const free = ruleY - 56 - (box.y + box.height + natural);
    const extra = rest.length && free > 0 && free <= 300 ? Math.min(64, free / rest.length) : 0;
    let rowsBottom = box.y + box.height;
    rest.forEach((item, offset) => {
        const index = offset + 1;
        const top = box.y + box.height + 44 + extra + offset * (rowHeight + 28 + extra);
        const position = layout(ctx, String(index + 1).padStart(2, '0'), 120, { size: 64, display: true });
        paint(ctx, position, MARGIN, top + (rowHeight - position.cap) / 2, alpha(tone.paper, 0.9));
        thumbnail(ctx, tone, pictures[index] ?? null, { x: box.x + box.width - thumb.width, y: top, ...thumb }, item, data.year, index + 1);
        const duration = layout(ctx, item.duration, 260, { size: 26, weight: 600 });
        const name = layout(ctx, item.title, textWidth - duration.width - 28, { size: 38, min: 30, lines: 2, weight: 800, leading: 1.14 });
        const blockHeight = name.height + (max > 0 ? 22 + 10 : 0);
        const textTop = top + (rowHeight - blockHeight) / 2;
        paint(ctx, name, textX, textTop, tone.paper);
        paint(ctx, duration, WIDTH - MARGIN, textTop + name.cap - duration.cap, tone.muted, 'right');
        bar(textTop + name.height + 22, item.minutes, tone.light);
        rowsBottom = top + rowHeight;
    });
    const band = ruleY - rowsBottom;
    if (band > 360) {
        const size = Math.min(340, band * 0.72);
        const probe = layout(ctx, String(data.year), CONTENT, { size, min: 96, display: true });
        bigYear(ctx, tone, data.year, WIDTH / 2, rowsBottom + (band - probe.cap) / 2, CONTENT, size, 'center', 0.85);
    }
    rule(ctx, MARGIN, WIDTH - MARGIN, ruleY, alpha(tone.light, 0.22));
    closing.draw(MARGIN, closingTop);
    footer(ctx, tone, data, height - 64);
}

// ---------------------------------------------------------------------------
// 3. Affiche : parodie d'affiche de film, titre géant et générique en bloc.

function drawPosterCard(ctx: CanvasRenderingContext2D, tone: Tone, data: WrappedShareCardData, pictures: Picture[]) {
    const { height } = WRAPPED_SHARE_CARD_SIZES.poster;
    const box = WRAPPED_SHARE_POSTER_BOXES.poster;
    const favorite = data.items[0];
    ground(ctx, tone, WIDTH, height);
    glow(ctx, WIDTH / 2, favorite ? box.y + box.height * 0.42 : 420, 860, tone.primary, 0.38);
    glow(ctx, WIDTH / 2, height + 160, 760, tone.deep, 0.32);
    vignette(ctx, tone, WIDTH, height);
    drawWrappedGrain(ctx, WIDTH, height, 0.07, 9);

    // « Movix présente » entre deux filets, en écho à la ligne de sortie en pied.
    const presents = runLine(ctx, [{ text: data.labels.presents || 'Movix', size: 24, weight: 800, color: tone.paper, tracking: 5.5, upper: true }], CONTENT - 240);
    if (presents) flanked(ctx, presents, 58, alpha(tone.paper, 0.45));

    // Bloc générique : petits mots discrets, grands noms en capitales.
    const small = (text: string): Run => ({ text: `${text}  `, size: 20, weight: 800, color: tone.muted, tracking: 3, upper: true });
    const big = (text: string): Run => ({ text, size: 40, weight: 900, color: tone.paper, tracking: 1.5, upper: true });
    const dot: Run = { text: '   ·   ', size: 32, weight: 800, color: alpha(tone.light, 0.8) };
    const traits = traitLabels(data);
    const signature = [small(data.labels.persona), big(data.persona)];
    // Une signature trop longue passe sous son libellé plutôt que de rapetisser toute la ligne.
    const persona = runsWidth(ctx, signature) * 0.86 <= CONTENT ? runLine(ctx, signature, CONTENT) : vstack([
        [runLine(ctx, [small(data.labels.persona)], CONTENT), 0],
        [piece(ctx, layout(ctx, data.persona, CONTENT, { size: 36, min: 26, lines: 2, weight: 900, upper: true, tracking: 1.5, leading: 1.18 }), tone.paper, 'center'), 16],
    ]);
    const billing = vstack([
        [runLine(ctx, [small(data.labels.watchTime), big(data.watchTime), dot, small(data.labels.titles), big(data.titleCount)], CONTENT), 0],
        [persona, 28],
        [runLine(ctx, [{ text: traits.join('  ·  '), size: 23, weight: 800, color: tone.light, tracking: 3.5, upper: true }], CONTENT), 28],
    ]);
    // Ligne de sortie : millésime et domaine, comme une date à l'affiche.
    const release = runLine(ctx, [
        { text: String(data.year), size: 52, display: true, color: tone.paper },
        { text: '   ·   ', size: 30, weight: 800, color: alpha(tone.light, 0.8) },
        { text: data.domain, size: 26, weight: 800, color: tone.light, tracking: 4, upper: true },
    ], CONTENT - 240);
    const releaseTop = height - 70 - (release?.height ?? 0);
    if (release) flanked(ctx, release, releaseTop, alpha(tone.paper, 0.45));

    if (favorite) {
        brackets(ctx, box, 22, 48, tone.highlight, 3);
        posterShadow(ctx, tone, box, 0.6);
        drawPoster(ctx, tone, pictures[0] ?? null, box, favorite.title, data.year, 1);
        const titleTop = box.y + box.height + 62;
        const title = firstWhole(ctx, favorite.title, CONTENT, [
            { size: 136, min: 92, display: true, upper: true },
            { size: 100, min: 56, lines: 2, display: true, upper: true, leading: 0.98 },
        ]);
        paint(ctx, title, WIDTH / 2, titleTop, tone.paper, 'center');
        const titleBottom = titleTop + title.height;
        billing.draw(WIDTH / 2, titleBottom + Math.max(44, (releaseTop - titleBottom - billing.height) / 2));
        return;
    }
    // Sans titre, l'année devient l'image et la phrase d'en-tête devient le titre du film.
    const year = layout(ctx, String(data.year), CONTENT, { size: 380, min: 120, display: true });
    const title = layout(ctx, data.labels.heading, CONTENT, { size: 116, min: 60, lines: 3, display: true, upper: true, leading: 0.98 });
    distribute(ctx, tone, sections([
        { piece: { width: CONTENT, height: year.height, draw: (_x, top) => bigYear(ctx, tone, data.year, WIDTH / 2, top, CONTENT, 380, 'center') } },
        { piece: piece(ctx, title, tone.paper, 'center') },
        { piece: billing },
    ]), WIDTH / 2, 150, releaseTop - 70, { min: 56, max: 130 });
}

// ---------------------------------------------------------------------------
// 4. Billet : un vrai ticket de cinéma, talon et code-barres compris.

function ticketPath(ctx: CanvasRenderingContext2D, box: Box, radius: number, notchY: number, notch: number) {
    const { x, y, width, height } = box;
    const right = x + width, bottom = y + height;
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(right - radius, y);
    ctx.arcTo(right, y, right, y + radius, radius);
    ctx.lineTo(right, notchY - notch);
    ctx.arc(right, notchY, notch, -Math.PI / 2, Math.PI / 2, true);
    ctx.lineTo(right, bottom - radius);
    ctx.arcTo(right, bottom, right - radius, bottom, radius);
    ctx.lineTo(x + radius, bottom);
    ctx.arcTo(x, bottom, x, bottom - radius, radius);
    ctx.lineTo(x, notchY + notch);
    ctx.arc(x, notchY, notch, Math.PI / 2, -Math.PI / 2, true);
    ctx.lineTo(x, y + radius);
    ctx.arcTo(x, y, x + radius, y, radius);
    ctx.closePath();
}

function barcode(ctx: CanvasRenderingContext2D, x: number, top: number, width: number, height: number, seed: number, color: string) {
    const next = random(seed);
    const unit = 4;
    ctx.fillStyle = color;
    const guard = (left: number) => {
        ctx.fillRect(left, top, unit, height + 16);
        ctx.fillRect(left + unit * 2, top, unit, height + 16);
    };
    guard(x);
    guard(x + width - unit * 3);
    let cursor = x + unit * 6;
    const end = x + width - unit * 6;
    while (cursor < end) {
        const bar = unit * (1 + Math.floor(next() * 3));
        if (cursor + bar > end) break;
        ctx.fillRect(cursor, top, bar, height);
        cursor += bar + unit * (1 + Math.floor(next() * 2));
    }
}

function drawTicket(ctx: CanvasRenderingContext2D, tone: Tone, data: WrappedShareCardData) {
    const { height } = WRAPPED_SHARE_CARD_SIZES.ticket;
    ground(ctx, tone, WIDTH, height);
    glow(ctx, 180, 260, 900, tone.primary, 0.34);
    glow(ctx, WIDTH - 80, height - 200, 800, tone.deep, 0.32);
    vignette(ctx, tone, WIDTH, height);
    drawWrappedGrain(ctx, WIDTH, height, 0.07, 13);

    const ticket = { x: 96, y: 112, width: WIDTH - 192, height: height - 224 };
    const notchY = ticket.y + 1236;
    const notch = 36;
    const inner = { x: ticket.x + 64, width: ticket.width - 128 };
    ctx.save();
    ctx.shadowColor = alpha(tone.ink, 0.55);
    ctx.shadowBlur = 70;
    ctx.shadowOffsetY = 30;
    ticketPath(ctx, ticket, 30, notchY, notch);
    ctx.fillStyle = tone.ticketPaper;
    ctx.fill();
    ctx.restore();

    ctx.save();
    ticketPath(ctx, ticket, 30, notchY, notch);
    ctx.clip();
    drawWrappedGrain(ctx, WIDTH, height, 0.1, 17);
    // Bandeau d'en-tête dans la couleur vive, comme l'entête imprimée d'un billet.
    const band = 150;
    ctx.fillStyle = tone.primary;
    ctx.fillRect(ticket.x, ticket.y, ticket.width, band);
    const mark = layout(ctx, 'MOVIX', 320, { size: 46, display: true });
    paint(ctx, mark, inner.x, ticket.y + (band - mark.cap) / 2, tone.paper);
    const tag = layout(ctx, `Wrapped ${data.year}`, inner.width - mark.width - 40, smallCaps(22));
    paint(ctx, tag, inner.x + inner.width, ticket.y + (band + mark.cap) / 2 - tag.cap, alpha(tone.paper, 0.86), 'right');
    ctx.restore();

    // Partie principale : intitulé, grand millésime puis grille de champs.
    const heading = layout(ctx, data.labels.ticket, inner.width, smallCaps(24));
    const year = layout(ctx, String(data.year), inner.width, { size: 300, min: 120, display: true });
    const favorite = data.items[0];
    const half = (inner.width - 2) / 2;
    const fieldPad = 26;
    const field = (label: string, value: Piece, width: number): Piece => vstack([
        [piece(ctx, layout(ctx, label, width - fieldPad, smallCaps(20)), tone.ticketMuted), 0],
        [value, 20],
    ]);
    const display = (text: string, width: number, size: number, lines = 1) => piece(ctx, layout(ctx, text, width, { size, min: Math.round(size * 0.6), lines, display: true, leading: 1.04 }), tone.stage);
    const rows: Piece[][] = [];
    if (favorite) {
        rows.push([field(data.labels.favorite, vstack([
            [display(favorite.title, inner.width, 64, 2), 0],
            [piece(ctx, layout(ctx, favorite.duration, inner.width, { size: 26, weight: 600 }), tone.ticketMuted), 18],
        ]), inner.width)]);
    }
    rows.push([
        field(data.labels.watchTime, display(data.watchTime, half - fieldPad, 54), half),
        field(data.labels.titles, display(data.titleCount, half - fieldPad, 54), half),
    ]);
    const traits = traitLabels(data);
    rows.push([field(data.labels.persona, vstack([
        [display(data.persona, inner.width, 56, 2), 0],
        [traits.length ? piece(ctx, layout(ctx, traits.join(' · '), inner.width, { size: 26, weight: 600 }), tone.ticketMuted) : null, 18],
    ]), inner.width)]);
    const cells = rows.map(row => Math.max(...row.map(cell => cell.height)));
    const top = ticket.y + band + 64;
    const bottom = notchY - 56;
    const lead = heading.height + 32 + year.height;
    const spare = bottom - top - lead - cells.reduce((sum, value) => sum + value, 0);
    // L'espace libre aère d'abord la grille, puis l'écart sous le millésime ; le reste centre l'ensemble.
    const rowPad = clamp((spare - 72) / (rows.length * 2), 26, 50);
    const gap = clamp(spare - rowPad * rows.length * 2, 52, 110);
    const used = lead + gap + cells.reduce((sum, value) => sum + value + rowPad * 2, 0);
    const start = top + Math.max(0, (bottom - top - used) / 2);
    paint(ctx, heading, inner.x, start, tone.ticketMuted);
    paint(ctx, year, inner.x - 6, start + heading.height + 32, tone.stage);
    let y = start + lead + gap;
    const line = alpha(tone.stage, 0.22);
    rule(ctx, inner.x, inner.x + inner.width, Math.round(y), line);
    rows.forEach((row, index) => {
        const rowHeight = cells[index] + rowPad * 2;
        row.forEach((cell, column) => {
            const cellX = inner.x + column * (half + 2);
            cell.draw(cellX + (column ? fieldPad : 0), y + rowPad);
            if (column) {
                ctx.fillStyle = line;
                ctx.fillRect(cellX - 2, y, 2, rowHeight);
            }
        });
        y += rowHeight;
        rule(ctx, inner.x, inner.x + inner.width, Math.round(y), line);
    });

    // Perforation entre les deux encoches.
    ctx.save();
    ctx.setLineDash([14, 12]);
    rule(ctx, ticket.x + notch + 18, ticket.x + ticket.width - notch - 18, notchY, alpha(tone.stage, 0.4), 3);
    ctx.restore();

    // Talon : entrée, code-barres dérivé des données, chiffres et domaine.
    const seed = signatureSeed(data);
    const admit = data.labels.admit ? layout(ctx, data.labels.admit, inner.width, { ...smallCaps(34, 900), tracking: 6 }) : null;
    const next = random(seed ^ 0x9e3779b9);
    const digits = Array.from({ length: 13 }, () => Math.floor(next() * 10)).join('');
    const code = layout(ctx, `${digits[0]} ${digits.slice(1, 7)} ${digits.slice(7)}`, inner.width / 2, { size: 22, weight: 600, tracking: 6 });
    const codeHeight = 150;
    const stub = (admit ? admit.height + 44 : 0) + codeHeight + 16 + 26 + code.height;
    let stubTop = notchY + (ticket.y + ticket.height - notchY - stub) / 2;
    if (admit) {
        paint(ctx, admit, inner.x, stubTop, tone.stage);
        stubTop += admit.height + 44;
    }
    barcode(ctx, inner.x, stubTop, inner.width, codeHeight, seed, tone.stage);
    const codeY = stubTop + codeHeight + 16 + 26;
    paint(ctx, code, inner.x, codeY, tone.ticketMuted);
    const domain = layout(ctx, data.domain, inner.width / 2, smallCaps(22));
    paint(ctx, domain, inner.x + inner.width, codeY + code.cap - domain.cap, tone.primary, 'right');
}

// ---------------------------------------------------------------------------

export async function generateWrappedShareCard(data: WrappedShareCardData, format: WrappedShareFormat): Promise<Blob> {
    await ensureShareFonts();
    const { width, height } = WRAPPED_SHARE_CARD_SIZES[format];
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    const count = format === 'ticket' ? 0 : format === 'top-five' ? 5 : format === 'story' ? 3 : 1;
    const [pictures, backdrop] = await Promise.all([
        Promise.all(data.items.slice(0, count).map(item => item.posterUrl ? loadCanvasImage(item.posterUrl) : null)),
        format === 'story' && data.backdropUrl && data.items.length ? loadCanvasImage(data.backdropUrl) : Promise.resolve(null),
    ]);
    // Palette propre à cet appel : un export lancé pendant les chargements garde la sienne.
    const tone = toneFor(data.theme);
    if (format === 'story') drawStory(ctx, tone, data, pictures, backdrop);
    else if (format === 'top-five') drawTopFive(ctx, tone, data, pictures);
    else if (format === 'poster') drawPosterCard(ctx, tone, data, pictures);
    else drawTicket(ctx, tone, data);
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Canvas export failed')), 'image/png'));
}
