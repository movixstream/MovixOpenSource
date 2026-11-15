/**
 * Primitives du film Wrapped : typographie cinétique, compteurs, affiches, repères
 * de caméra et lumière. Tout est fonction du temps : l'aperçu, le défilement et
 * l'export peignent exactement la même image.
 */
import type { WrappedShareCardData } from '../types/wrapped.ts';
import { drawCanvasImage } from './wrappedCanvasLayout.ts';
import { WRAPPED_POSTER_RADIUS_RATIO } from './wrappedPosterGeometry.ts';
import { WRAPPED_THEMES, wrappedRgb, type WrappedPalette } from './wrappedTheme.ts';

/**
 * Cadre et palette du film. Les couleurs suivent l'ambiance de l'image en cours :
 * `filmUsePalette` les remplace au début de chaque image, avant tout tracé synchrone.
 */
export const FILM: { width: number; height: number } & WrappedPalette = { width: 720, height: 1280, ...WRAPPED_THEMES.electric };

export function filmUsePalette(palette: Readonly<WrappedPalette>) {
    Object.assign(FILM, palette);
}
const DISPLAY = '"Archivo Black", Inter, Arial, sans-serif';
const TEXT = 'Inter, Arial, sans-serif';

export const filmClamp = (value: number) => Math.max(0, Math.min(1, value));
export const filmMix = (a: number, b: number, progress: number) => a + (b - a) * progress;
export const filmEase = (value: number) => 1 - Math.pow(1 - filmClamp(value), 4);
export const filmSmooth = (value: number) => { const x = filmClamp(value); return x * x * (3 - 2 * x); };
/** Attaque franche et arrivée longue : la courbe des titres cinétiques. */
export const filmExpo = (value: number) => { const x = filmClamp(value); return x >= 1 ? 1 : 1 - Math.pow(2, -10 * x); };
export const filmExpoIn = (value: number) => { const x = filmClamp(value); return x <= 0 ? 0 : Math.pow(2, 10 * x - 10); };
/** Volets et trajets d'affiche : départ et arrivée nets, passage lisible sur environ six images. */
export const filmQuintInOut = (value: number) => {
    const x = filmClamp(value);
    return x < 0.5 ? 16 * Math.pow(x, 5) : 1 - Math.pow(-2 * x + 2, 5) / 2;
};
/** Léger dépassement avant de se poser ; la valeur finale reste exacte. */
export const filmBack = (value: number, overshoot = 1.4) => {
    const x = filmClamp(value) - 1;
    return 1 + (overshoot + 1) * x * x * x + overshoot * x * x;
};

/** Impulsion continue sur chaque temps : nulle sur le temps, pic 70 ms après. */
export function filmPulse(time: number, beat: number, attack = 0.07) {
    if (!(time > 0)) return 0;
    const x = (time % beat) / attack;
    return x * Math.exp(1 - x);
}

export function filmFont(size: number, display = false, weight = 800) {
    return display ? `${size}px ${DISPLAY}` : `${weight} ${size}px ${TEXT}`;
}

function tracking(ctx: CanvasRenderingContext2D, value: number) {
    if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${value}px`;
}

export type FilmTextOptions = {
    size?: number; minSize?: number; weight?: number; display?: boolean; color?: string | CanvasGradient; lines?: number;
    align?: CanvasTextAlign; leading?: number; alpha?: number; balance?: boolean; reveal?: number; tracking?: number; uppercase?: boolean;
};
type FilmLayout = { size: number; rows: string[]; paragraphs: number[]; lineHeight: number };

/** Mise en page bornée : la taille baisse avant de couper un mot, l'ellipse ferme le bloc. */
export function filmLayout(ctx: CanvasRenderingContext2D, value: string, width: number, options: FilmTextOptions = {}): FilmLayout {
    const { size = 32, minSize = 22, weight = 400, display = false, lines = 1, leading = 1.06, balance = false, uppercase = false } = options;
    const normalized = (uppercase ? String(value).toLocaleUpperCase() : String(value)).trim();
    const minimum = Math.min(size, minSize);
    const maxLines = balance && normalized.length <= 22 && !normalized.includes('\n') ? 1 : lines;
    const layout = (fontSize: number) => {
        ctx.font = filmFont(fontSize, display, weight);
        const rows: string[] = [], paragraphs: number[] = [];
        normalized.split('\n').forEach((paragraph, paragraphIndex) => {
            let line = '';
            for (const word of paragraph.split(/\s+/).filter(Boolean)) {
                const candidate = line ? `${line} ${word}` : word;
                if (ctx.measureText(candidate).width <= width) { line = candidate; continue; }
                if (line) { rows.push(line); paragraphs.push(paragraphIndex); line = ''; }
                // Le découpage par caractère est réservé aux mots sans espace à la taille minimum.
                if (fontSize > minimum || ctx.measureText(word).width <= width) { line = word; continue; }
                for (const glyph of Array.from(word)) {
                    if (line && ctx.measureText(line + glyph).width > width) { rows.push(line); paragraphs.push(paragraphIndex); line = ''; }
                    line += glyph;
                }
            }
            rows.push(line); paragraphs.push(paragraphIndex);
        });
        return { rows, paragraphs };
    };
    let chosen = size;
    let result = layout(chosen);
    for (let guard = 0; guard < 80 && chosen > minimum; guard += 1) {
        if (result.rows.length <= maxLines && result.rows.every(row => ctx.measureText(row).width <= width)) break;
        chosen = Math.max(minimum, chosen - 2);
        result = layout(chosen);
    }
    let rows = result.rows.slice(0, maxLines);
    const paragraphs = result.paragraphs.slice(0, maxLines);
    if (result.rows.length > maxLines && rows.length) {
        let last = rows[rows.length - 1];
        while (last && ctx.measureText(`${last}…`).width > width) last = Array.from(last).slice(0, -1).join('');
        rows = [...rows.slice(0, -1), `${last}…`];
    }
    return { size: chosen, rows, paragraphs, lineHeight: chosen * leading };
}

/** Texte borné ; `reveal` fait monter chaque ligne derrière son propre masque. */
export function filmText(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, width: number, options: FilmTextOptions = {}) {
    const { weight = 400, display = false, color = FILM.paper, align = 'left', alpha = 1, reveal = 1 } = options;
    const layout = filmLayout(ctx, value, width, options);
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
    ctx.font = filmFont(layout.size, display, weight);
    tracking(ctx, options.tracking || 0);
    layout.rows.forEach((row, index) => {
        const progress = filmExpo((reveal - index * 0.14) / Math.max(0.3, 1 - (layout.rows.length - 1) * 0.14));
        const top = y + index * layout.lineHeight;
        ctx.save();
        if (progress < 1) {
            const left = align === 'right' ? x - width : align === 'center' ? x - width / 2 : x;
            ctx.beginPath(); ctx.rect(left - 4, top - layout.size * 0.2, width + 8, layout.size * 1.22); ctx.clip();
        }
        ctx.fillText(row, x, top + layout.size * 0.8 + (1 - progress) * layout.size * 1.15);
        ctx.restore();
    });
    ctx.restore();
    return { height: layout.rows.length * layout.lineHeight, size: layout.size, rows: layout.rows };
}

export type FilmWordsOptions = FilmTextOptions & { time: number; stagger?: number; duration?: number; colors?: string[]; slide?: 'up' | 'side' };

/** Titre cinétique : chaque mot sort de sous sa ligne, avec un décalage régulier. */
export function filmWords(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, width: number, options: FilmWordsOptions) {
    const { weight = 400, display = false, color = FILM.paper, align = 'left', alpha = 1, time, stagger = 0.12, duration = 0.5, colors, slide = 'up' } = options;
    const layout = filmLayout(ctx, value, width, options);
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = filmFont(layout.size, display, weight);
    tracking(ctx, options.tracking || 0);
    const space = ctx.measureText(' ').width;
    let order = 0;
    layout.rows.forEach((row, rowIndex) => {
        const top = y + rowIndex * layout.lineHeight;
        const words = row.split(' ').filter(Boolean);
        const rowWidth = ctx.measureText(row).width;
        let cursor = align === 'center' ? x - rowWidth / 2 : align === 'right' ? x - rowWidth : x;
        ctx.fillStyle = colors?.[layout.paragraphs[rowIndex] % colors.length] || color;
        ctx.save();
        // Masque de la ligne : accents et jambages inclus, mot suivant encore caché.
        ctx.beginPath(); ctx.rect(cursor - 6, top - layout.size * 0.2, rowWidth + 12, layout.size * 1.22); ctx.clip();
        for (const word of words) {
            const progress = filmExpo((time - order * stagger) / duration);
            const offset = (1 - progress) * layout.size * 1.5;
            ctx.fillText(word, cursor + (slide === 'side' ? -offset * 2 : 0), top + layout.size * 0.8 + (slide === 'up' ? offset : 0));
            cursor += ctx.measureText(word).width + space;
            order += 1;
        }
        ctx.restore();
    });
    ctx.restore();
    return { height: layout.rows.length * layout.lineHeight, size: layout.size, rows: layout.rows, words: order };
}

const isDigit = (glyph: string) => glyph >= '0' && glyph <= '9';

/**
 * Compteur sur une valeur déjà formatée par la langue : le nombre monte jusqu'à sa valeur
 * exacte, calé à droite dans sa largeur finale, sans jamais déplacer l'unité qui le suit.
 */
export function filmCounter(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, options: {
    size: number; display?: boolean; weight?: number; color?: string; align?: CanvasTextAlign; progress: number; alpha?: number;
}) {
    const { size, display = false, weight = 800, color = FILM.paper, align = 'left', progress, alpha = 1 } = options;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.font = filmFont(size, display, weight);
    ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    const glyphs = Array.from(String(value));
    const slots = glyphs.slice();
    if (filmClamp(progress) < 1) {
        // Chaque nombre compte séparément (« 373 h 30 min » : heures puis minutes). Ses
        // chiffres occupent les emplacements depuis la droite ; un séparateur de milliers
        // sans chiffre à sa gauche reste vide.
        const eased = filmExpo(progress);
        for (const group of glyphs.join('').matchAll(/\d+(?:[\s.,']\d+)*/g)) {
            const start = Array.from(glyphs.join('').slice(0, group.index)).length;
            const range = Array.from(group[0]);
            const target = Number(range.filter(isDigit).join(''));
            if (!Number.isSafeInteger(target)) continue;
            const shown = String(Math.floor(target * eased));
            let pointer = shown.length - 1;
            for (let offset = range.length - 1; offset >= 0; offset -= 1) {
                if (isDigit(range[offset])) slots[start + offset] = pointer >= 0 ? shown[pointer--] : '';
                else if (pointer < 0) slots[start + offset] = '';
            }
        }
    }
    const parts: { text: string; shown: string; digit: boolean; width: number }[] = [];
    glyphs.forEach((glyph, index) => {
        const digit = isDigit(glyph), last = parts[parts.length - 1];
        if (!digit && last && !last.digit) { last.text += glyph; last.shown += slots[index]; }
        else parts.push({ text: glyph, shown: slots[index], digit, width: 0 });
    });
    parts.forEach(part => { part.width = ctx.measureText(part.text).width; });
    const total = parts.reduce((sum, part) => sum + part.width, 0);
    let cursor = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
    const baseline = y + size * 0.8;
    for (const part of parts) {
        if (part.digit && part.shown && part.shown !== part.text) ctx.fillText(part.shown, cursor + (part.width - ctx.measureText(part.shown).width) / 2, baseline);
        else if (part.shown) ctx.fillText(part.shown, cursor, baseline);
        cursor += part.width;
    }
    ctx.restore();
    return total;
}

/** Chaque caractère tombe dans sa fenêtre, de gauche à droite : un millésime ne se compte pas. */
export function filmDrop(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, options: { size: number; time: number; stagger: number; duration: number; color: string }) {
    const { size, time, stagger, duration, color } = options;
    ctx.save();
    ctx.font = filmFont(size, true); ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    let cursor = x;
    Array.from(value).forEach((glyph, index) => {
        const width = ctx.measureText(glyph).width;
        const progress = filmExpo((time - index * stagger) / duration);
        ctx.save();
        ctx.beginPath(); ctx.rect(cursor - 6, y - size * 0.1, width + 12, size * 1.02); ctx.clip();
        ctx.fillText(glyph, cursor, y + size * 0.8 - (1 - progress) * size * 1.1);
        ctx.restore();
        cursor += width;
    });
    ctx.restore();
    return cursor - x;
}

export function filmFitSize(ctx: CanvasRenderingContext2D, value: string, width: number, size: number, minSize: number, display = true, weight = 800) {
    let chosen = size;
    for (let guard = 0; guard < 120 && chosen > minSize; guard += 1) {
        ctx.font = filmFont(chosen, display, weight);
        if (ctx.measureText(value).width <= width) break;
        chosen = Math.max(minSize, chosen - 4);
    }
    return chosen;
}

export function filmLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string = FILM.paper, alpha = 1, width = 1) {
    ctx.save(); ctx.strokeStyle = color; ctx.globalAlpha *= alpha; ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore();
}

export function filmGlow(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, rgb = wrappedRgb(FILM.primary), alpha = 0.2) {
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(0, `rgba(${rgb},${alpha})`); glow.addColorStop(1, `rgba(${rgb},0)`);
    ctx.save(); ctx.fillStyle = glow; ctx.fillRect(0, 0, FILM.width, FILM.height); ctx.restore();
}

/** Repères de caméra : quatre équerres fines, jamais un aplat sur le contenu. */
export function filmCorners(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, color: string = FILM.paper, alpha = 1, length = 26, lineWidth = 2) {
    if (alpha <= 0.001) return;
    const size = Math.min(length, width * 0.2, height * 0.2);
    ctx.save(); ctx.globalAlpha *= alpha; ctx.strokeStyle = color; ctx.lineWidth = lineWidth;
    for (const [cx, cy, dx, dy] of [[x, y, 1, 1], [x + width, y, -1, 1], [x, y + height, 1, -1], [x + width, y + height, -1, -1]]) {
        ctx.beginPath(); ctx.moveTo(cx, cy + dy * size); ctx.lineTo(cx, cy); ctx.lineTo(cx + dx * size, cy); ctx.stroke();
    }
    ctx.restore();
}

export function filmRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, width, height, Math.max(0, Math.min(radius, width / 2, height / 2)));
    else ctx.rect(x, y, width, height);
}

type FilmItem = WrappedShareCardData['items'][number];
/** `shadow` règle l'ombre portée de 0 à 1, pour qu'elle suive l'affiche d'un plan à l'autre. */
export type FilmPosterOptions = { rotation?: number; alpha?: number; shadow?: number; shine?: number; scale?: number };

/** Affiche 2:3 à coins proportionnels ; repli typographique quand l'image manque. */
export function filmPoster(ctx: CanvasRenderingContext2D, item: FilmItem, image: HTMLImageElement | null | undefined, x: number, y: number, width: number, options: FilmPosterOptions = {}) {
    const { rotation = 0, alpha = 1, shadow = 1, shine = -1, scale = 1 } = options;
    if (alpha <= 0.001 || width <= 0) return;
    const height = width * 1.5, radius = width * WRAPPED_POSTER_RADIUS_RATIO;
    ctx.save();
    ctx.translate(x + width / 2, y + height / 2); ctx.rotate(rotation * Math.PI / 180); ctx.scale(scale, scale);
    ctx.globalAlpha *= alpha;
    const depth = filmClamp(shadow);
    ctx.shadowColor = `rgba(0,0,0,${0.45 * depth})`; ctx.shadowBlur = 36 * depth; ctx.shadowOffsetY = 22 * depth;
    filmRoundRect(ctx, -width / 2, -height / 2, width, height, radius);
    ctx.fillStyle = image ? FILM.night : FILM.primary; ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.save();
    filmRoundRect(ctx, -width / 2, -height / 2, width, height, radius); ctx.clip();
    if (image) drawCanvasImage(ctx, image, -width / 2, -height / 2, width, height);
    else {
        const fill = ctx.createLinearGradient(0, -height / 2, 0, height / 2);
        fill.addColorStop(0, FILM.primary); fill.addColorStop(1, FILM.deep);
        ctx.fillStyle = fill; ctx.fillRect(-width / 2, -height / 2, width, height);
        filmText(ctx, 'MOVIX', -width / 2 + width * 0.09, -height / 2 + width * 0.09, width * 0.82, { size: Math.max(12, width * 0.07), display: true, color: FILM.paper });
        const words = item.title.trim().split(/\s+/);
        const title = words.length > 5 ? `${words.slice(0, 5).join(' ')}…` : item.title;
        filmText(ctx, title, -width / 2 + width * 0.09, -height * 0.1, width * 0.82, { size: Math.max(14, width * 0.11), minSize: Math.max(9, width * 0.05), display: true, color: FILM.paper, lines: 4, leading: 1.04 });
        filmLine(ctx, -width / 2 + width * 0.09, height / 2 - width * 0.14, width / 2 - width * 0.09, height / 2 - width * 0.14, FILM.paper, 0.5);
    }
    if (shine > 0 && shine < 1) {
        // Reflet balayé une fois, dans les limites de l'affiche.
        const band = width * 0.55, center = filmMix(-width - band, width + band, shine);
        const light = ctx.createLinearGradient(center - band, -height / 2, center + band, height / 2);
        light.addColorStop(0, 'rgba(255,255,255,0)'); light.addColorStop(0.5, 'rgba(255,255,255,0.32)'); light.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = light; ctx.fillRect(-width / 2, -height / 2, width, height);
    }
    ctx.restore();
    ctx.restore();
}

/** Barres mensuelles : la hauteur finale est exacte, les mois à venir restent en contour. */
export function filmBars(ctx: CanvasRenderingContext2D, values: number[], options: {
    x: number; bottom: number; width: number; height: number; time: number; futureFrom: number | null; labels?: string[];
    color: string; peakColor: string; labelColor: string; alpha?: number;
}) {
    const { x, bottom, width, height, time, futureFrom, labels, color, peakColor, labelColor, alpha = 0.42 } = options;
    const chart = values.slice(0, 12).map(value => Number.isFinite(value) && value > 0 ? value : 0);
    while (chart.length < 12) chart.push(0);
    const maximum = Math.max(1, ...chart), peak = chart.indexOf(Math.max(...chart));
    const slot = width / 12, bar = slot * 0.6;
    ctx.save();
    chart.forEach((value, index) => {
        const left = x + index * slot + (slot - bar) / 2;
        const rise = filmBack((time - index * 0.05) / 0.62, 1.1);
        if (futureFrom && index + 1 >= futureFrom && value === 0) {
            ctx.globalAlpha = 0.55 * filmClamp(rise);
            ctx.strokeStyle = color; ctx.lineWidth = 2;
            ctx.strokeRect(left + 1, bottom - 12, bar - 2, 11);
        } else {
            const barHeight = Math.max(3, value / maximum * height * rise);
            ctx.globalAlpha = index === peak ? 1 : alpha;
            ctx.fillStyle = index === peak ? peakColor : color;
            ctx.fillRect(left, bottom - barHeight, bar, barHeight);
        }
        if (labels?.[index]) {
            ctx.globalAlpha = (index === peak ? 1 : 0.7) * filmClamp(rise * 2);
            ctx.fillStyle = labelColor; ctx.font = filmFont(20, false, 800); ctx.textAlign = 'center';
            ctx.fillText(labels[index], left + bar / 2, bottom + 34);
        }
    });
    ctx.restore();
}

/** Une place par titre : la grille se remplit dans l'ordre, sans dépasser sa zone. */
export function filmSeats(ctx: CanvasRenderingContext2D, count: number, box: { x: number; y: number; width: number; height: number }, time: number, options: { color: string; accent: string; duration: number }) {
    const total = Math.max(0, Math.floor(count));
    if (!total) return 0;
    let columns = 1, cell = 0;
    for (let candidate = 1; candidate <= 40; candidate += 1) {
        const size = Math.min(box.width / candidate, box.height / Math.ceil(total / candidate));
        if (size > cell) { cell = size; columns = candidate; }
    }
    const rows = Math.ceil(total / columns), seat = cell * 0.7;
    const left = box.x + (box.width - columns * cell) / 2;
    ctx.save();
    for (let index = 0; index < total; index += 1) {
        const appear = filmBack((time - index / total * options.duration) / 0.2, 1.8);
        if (appear <= 0.001) continue;
        const column = index % columns, row = Math.floor(index / columns);
        const size = seat * appear, cx = left + column * cell + cell / 2, cy = box.y + row * cell + cell / 2;
        ctx.fillStyle = index === total - 1 ? options.accent : options.color;
        filmRoundRect(ctx, cx - size / 2, cy - size / 2, size, size, size * 0.24); ctx.fill();
    }
    ctx.restore();
    return rows * cell;
}

/** Rangée de texte en contour qui défile : une texture de générique. */
export function filmMarquee(ctx: CanvasRenderingContext2D, value: string, y: number, size: number, shift: number, color: string, alpha: number) {
    if (alpha <= 0.001) return;
    ctx.save();
    ctx.globalAlpha *= alpha; ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.font = filmFont(size, true); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    const unit = ctx.measureText(`${value} `).width + size * 0.2;
    if (unit > 0) {
        let cursor = -(((shift % unit) + unit) % unit) - unit;
        for (let guard = 0; guard < 24 && cursor < FILM.width + unit; guard += 1) {
            ctx.strokeText(value, cursor, y + size * 0.8);
            cursor += unit;
        }
    }
    ctx.restore();
}

export function filmVignette(ctx: CanvasRenderingContext2D, strength: number) {
    const shade = ctx.createRadialGradient(FILM.width / 2, FILM.height * 0.46, FILM.width * 0.42, FILM.width / 2, FILM.height * 0.46, FILM.height * 0.78);
    shade.addColorStop(0, 'rgba(0,0,0,0)'); shade.addColorStop(1, `rgba(0,0,0,${strength})`);
    ctx.save(); ctx.fillStyle = shade; ctx.fillRect(0, 0, FILM.width, FILM.height); ctx.restore();
}

/** Habillage du cadre : marque, édition, domaine et chapitre, avec équerres de visée. */
export function filmHud(ctx: CanvasRenderingContext2D, options: { year: number; domain: string; chapter: string; color: string; top: number; bottom: number }) {
    const { year, domain, chapter, color, top, bottom } = options;
    if (top > 0.001) {
        filmText(ctx, 'MOVIX', 52, 58, 220, { size: 24, display: true, color, alpha: top });
        filmText(ctx, `WRAPPED ${year}`, 668, 62, 320, { size: 15, weight: 800, color, align: 'right', alpha: top * 0.85, tracking: 3 });
    }
    if (bottom > 0.001) {
        filmText(ctx, domain, 52, 1210, 420, { size: 15, weight: 600, color, alpha: bottom * 0.7 });
        filmText(ctx, chapter, 668, 1210, 200, { size: 15, weight: 600, color, align: 'right', alpha: bottom * 0.7, tracking: 2 });
    }
    filmCorners(ctx, 26, 26, FILM.width - 52, FILM.height - 52, color, 0.38 * Math.max(top, bottom), 20, 2);
}
