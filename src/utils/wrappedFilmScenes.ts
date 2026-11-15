/**
 * THÈSE : un générique d'ouverture personnel, monté sur le tempo de la piste.
 * MONDE : encre, bleu électrique, papier ; l'or est réservé au numéro 1.
 * RÉCIT : marque, accroche, temps, titres, numéro 1, portrait, souvenir final.
 * FORME : plans reliés par des volets graphiques calés sur le temps et par une
 *         affiche persistante ; les informations décochées n'entrent jamais dans le film.
 */
import type { WrappedShareCardData, WrappedSignatureScene } from '../types/wrapped.ts';
import { drawCanvasImage } from './wrappedCanvasLayout.ts';
import { drawWrappedGrain } from './wrappedTexture.ts';
import { wrappedContrast, wrappedRgb, wrappedThemePalette } from './wrappedTheme.ts';
import { getWrappedVideoBeatAt, WRAPPED_VIDEO_BEAT_SECONDS as BEAT, WRAPPED_VIDEO_DURATION, WRAPPED_VIDEO_FPS, type WrappedVideoBeat, type WrappedVideoOptions, type WrappedVideoScene } from './wrappedVideoTimeline.ts';
import {
    FILM, filmBack, filmBars, filmClamp, filmCorners, filmCounter, filmDrop, filmExpo, filmExpoIn, filmFitSize, filmFont, filmGlow, filmHud,
    filmLayout, filmLine, filmMarquee, filmMix, filmPoster, filmPulse, filmQuintInOut, filmRoundRect, filmSeats, filmSmooth, filmText, filmUsePalette,
    filmVignette, filmWords,
} from './wrappedFilmDrawing.ts';

export const WRAPPED_VIDEO_SIZE = { width: FILM.width, height: FILM.height };
export type WrappedVideoTexts = { intro: string; time: string; titles: string; favorite: string; portrait: string; final: string; missingPoster: string };
export type WrappedVideoImages = Map<string, HTMLImageElement | null>;

const W = FILM.width, H = FILM.height, M = 48, CONTENT = W - M * 2;
/** Demi-durée des raccords : le passage le plus rapide tombe exactement sur le temps. */
const HALF = 0.34;
const beats = (count: number) => count * BEAT;

type Item = WrappedShareCardData['items'][number];
/** Position, largeur, rotation et ombre de l'affiche dans un plan. */
type Pose = { x: number; y: number; w: number; r: number; s: number };
type Shot = {
    data: WrappedShareCardData; options: WrappedVideoOptions; texts: WrappedVideoTexts; images: WrappedVideoImages;
    time: number; duration: number; start: number; omitFeatured: boolean;
};

const imageFor = (images: WrappedVideoImages, item: Item) => item.posterUrl ? images.get(item.posterUrl) : null;

/**
 * Temps local d'un plan court : la chorégraphie est écrite pour six temps et
 * s'accélère jusqu'à un tiers quand le montage ne lui en laisse que quatre.
 */
const paced = (shot: Shot) => shot.time / Math.max(0.62, Math.min(1, shot.duration / beats(6)));

function zoom(ctx: CanvasRenderingContext2D, scale: number, x = W / 2, y = H / 2) {
    ctx.translate(x, y); ctx.scale(scale, scale); ctx.translate(-x, -y);
}

function zoomPose(pose: Pose, scale: number): Pose {
    const cx = W / 2 + (pose.x + pose.w / 2 - W / 2) * scale, cy = H / 2 + (pose.y + pose.w * 0.75 - H / 2) * scale, w = pose.w * scale;
    return { ...pose, x: cx - w / 2, y: cy - w * 0.75, w };
}

function fill(ctx: CanvasRenderingContext2D, color: string) {
    ctx.fillStyle = color; ctx.fillRect(0, 0, W, H);
}

function kicker(ctx: CanvasRenderingContext2D, value: string, time: number, color: string, y = 190, align: 'left' | 'center' = 'left') {
    filmText(ctx, value, align === 'center' ? W / 2 : M, y, CONTENT, { size: 22, weight: 800, color, uppercase: true, tracking: 4, align, reveal: (time - beats(0.05)) / beats(0.8) });
}

/* ───────────── Ouverture : marque, accroche, affiches ───────────── */

const FAN: Pose[] = [{ x: 222, y: 440, w: 276, r: 0, s: 1 }, { x: 52, y: 520, w: 204, r: -9, s: 1 }, { x: 464, y: 520, w: 204, r: 9, s: 1 }];
const introCamera = (time: number) => 1 + 0.035 * filmExpoIn((time - beats(5)) / beats(1));

function fanPose(index: number, time: number): Pose {
    const base = FAN[index];
    // Les côtés arrivent d'abord, le numéro 1 se pose en dernier au centre.
    const order = index === 0 ? 2 : index - 1;
    const entrance = filmBack((time - beats(2) - order * beats(0.24)) / beats(1.1), 1.2);
    const drift = filmSmooth((time - beats(3)) / beats(3)) * (index === 0 ? 16 : 9);
    // Le rebond reste court : sur 980 px de course, un dépassement libre toucherait l'accroche.
    return { ...base, y: base.y + Math.max(-14, (1 - entrance) * 980) - drift, r: base.r * filmMix(2.6, 1, entrance) };
}

function logo(ctx: CanvasRenderingContext2D, year: number, time: number) {
    const out = filmExpoIn((time - beats(0.85)) / beats(0.85));
    if (out >= 1) return;
    ctx.save();
    // Lente poussée de caméra, puis traversée du logo sur le temps.
    zoom(ctx, 1 + 0.04 * filmSmooth(time / beats(1.6)) + out * 6, W / 2, 610);
    ctx.globalAlpha *= 1 - filmSmooth(out * 1.25);
    const bar = 0.42 + 0.58 * filmExpo(time / beats(0.9));
    // Reflet cyan qui traverse les lettres une fois, avant la traversée du logo.
    const sweep = filmMix(-260, W + 260, filmSmooth((time - beats(0.15)) / beats(1.1)));
    const shine = ctx.createLinearGradient(sweep - 150, 0, sweep + 150, 0);
    shine.addColorStop(0, FILM.paper); shine.addColorStop(0.5, FILM.light); shine.addColorStop(1, FILM.paper);
    filmText(ctx, 'MOVIX', W / 2, 500, 660, { size: 136, display: true, color: shine, align: 'center' });
    ctx.fillStyle = FILM.primary; ctx.fillRect(W / 2 - 170 * bar, 664, 340 * bar, 6);
    filmText(ctx, `WRAPPED ${year}`, W / 2, 694, 660, { size: 26, weight: 800, color: FILM.light, align: 'center', tracking: 10 });
    ctx.restore();
}

function intro(ctx: CanvasRenderingContext2D, shot: Shot) {
    const { data, options, texts, images, time } = shot;
    const posters = options.favorite && data.items.length > 0;
    fill(ctx, FILM.ink);
    filmGlow(ctx, W / 2, 900, 780, wrappedRgb(FILM.primary), 0.05 + 0.24 * filmSmooth(time / beats(5)));
    ctx.save();
    zoom(ctx, introCamera(time));
    const texture = filmSmooth((time - beats(1.2)) / beats(1.6));
    filmMarquee(ctx, String(data.year), posters ? 880 : 560, 230, time * 46, FILM.paper, 0.08 * texture);
    filmMarquee(ctx, String(data.year), posters ? 1100 : 806, 230, 140 - time * 46, FILM.paper, 0.05 * texture);
    logo(ctx, data.year, time);
    const paragraphs = Math.min(3, texts.intro.split('\n').length);
    filmWords(ctx, texts.intro, M, posters ? 182 : 280, CONTENT, {
        size: 112, minSize: 52, lines: Math.max(2, paragraphs), display: true, leading: 1.02, colors: [FILM.paper, FILM.light, FILM.paper],
        time: time - beats(1.25), stagger: beats(0.3), duration: beats(0.9),
    });
    if (posters) {
        const items = data.items.slice(0, 3);
        [2, 1, 0].filter(index => index < items.length).forEach(index => {
            if (index === 0 && shot.omitFeatured) return;
            const pose = fanPose(index, time);
            if (pose.y > H) return;
            filmPoster(ctx, items[index], imageFor(images, items[index]), pose.x, pose.y, pose.w, { rotation: pose.r });
        });
    } else {
        const year = String(data.year);
        const size = filmFitSize(ctx, year, CONTENT, 300, 120);
        filmDrop(ctx, year, M, 590, { size, color: FILM.primary, time: time - beats(2.1), stagger: beats(0.18), duration: beats(0.8) });
    }
    ctx.restore();
}

/* ───────────── Statistiques : temps, puis titres ───────────── */

function hours(ctx: CanvasRenderingContext2D, shot: Shot, time: number) {
    const { data, texts } = shot;
    fill(ctx, FILM.primary);
    filmGlow(ctx, 640, 120, 640, wrappedRgb(FILM.light), 0.3);
    kicker(ctx, texts.time, time, FILM.paper);
    const parts = data.watchTimeParts.length ? data.watchTimeParts : [data.watchTime];
    // Le nombre occupe tout le cadre ; l'unité reste posée à côté pendant qu'il monte.
    // `\s` couvre aussi les espaces insécables des milliers en français.
    const match = /^([\d\s.,']*\d)\s*(.*)$/.exec(parts[0]);
    let y = 232;
    if (match) {
        const [, number, unit] = match;
        // Largeur à 100 px : nombre, espace et unité au tiers environ de la taille.
        ctx.font = filmFont(100, true);
        const numberWidth = ctx.measureText(number).width;
        ctx.font = filmFont(42, true);
        const unitWidth = unit ? ctx.measureText(unit).width + 12 : 0;
        const size = Math.max(96, Math.min(250, CONTENT * 100 / Math.max(1, numberWidth + unitWidth)));
        const width = filmCounter(ctx, number, M, y, { size, display: true, color: FILM.paper, progress: (time - beats(0.25)) / beats(2.4) });
        if (unit) filmText(ctx, unit, M + width + size * 0.12, y + size * 0.8 * (1 - 0.42), Math.max(60, CONTENT - width - size * 0.12), { size: size * 0.42, minSize: 28, display: true, color: FILM.light, alpha: filmClamp((time - beats(0.3)) / beats(0.4)) });
        y += size * 1.02;
    } else {
        const size = filmFitSize(ctx, parts[0], CONTENT, 200, 64);
        filmCounter(ctx, parts[0], M, y, { size, display: true, color: FILM.paper, progress: (time - beats(0.25)) / beats(2.4) });
        y += size * 1.02;
    }
    if (parts[1]) {
        const size = filmFitSize(ctx, parts[1], CONTENT, 84, 40);
        // Encre sur les couleurs vives claires, lumière sur les plus sombres (indigo de la nuit).
        const color = wrappedContrast(FILM.ink, FILM.primary) >= 3 ? FILM.ink : FILM.light;
        filmCounter(ctx, parts[1], M, y, { size, display: true, color, progress: (time - beats(0.7)) / beats(2.2), alpha: filmClamp((time - beats(0.6)) / beats(0.3)) });
        y += size * 1.05;
    }
    if (data.signature.some(value => Number.isFinite(value) && value > 0)) {
        const bottom = 936, height = Math.max(120, Math.min(300, bottom - y - 70));
        filmBars(ctx, data.signature, { x: M, bottom, width: CONTENT, height, time: time - beats(0.9), futureFrom: data.signatureFutureFrom, labels: data.monthLabels, color: FILM.paper, peakColor: FILM.paper, labelColor: FILM.paper });
        filmText(ctx, data.signatureCaption, M, 990, CONTENT, { size: 18, weight: 600, color: FILM.paper, lines: 2, alpha: 0.8 * filmClamp((time - beats(1.8)) / beats(0.6)) });
    }
}

function titles(ctx: CanvasRenderingContext2D, shot: Shot, time: number) {
    const { data, texts } = shot;
    fill(ctx, FILM.deep);
    filmGlow(ctx, 80, 1180, 760, wrappedRgb(FILM.primary), 0.55);
    kicker(ctx, texts.titles, time, FILM.light);
    const size = filmFitSize(ctx, data.titleCount, CONTENT, 300, 96);
    filmCounter(ctx, data.titleCount, M, 232, { size, display: true, color: FILM.paper, progress: (time - beats(0.25)) / beats(2.2) });
    const count = Number(String(data.titleCount).replace(/\D/g, ''));
    const top = 232 + size * 1.02 + 46;
    // Une place par titre tant que la grille reste lisible ; au-delà, une texture neutre.
    if (count > 0 && count <= 400) filmSeats(ctx, count, { x: M, y: top, width: CONTENT, height: 1010 - top }, time - beats(0.45), { color: FILM.paper, accent: FILM.light, duration: beats(2.2) });
    else filmMarquee(ctx, data.titleCount, top + 40, 180, time * 60, FILM.paper, 0.18 * filmClamp(time / beats(1)));
}

function statistics(ctx: CanvasRenderingContext2D, shot: Shot) {
    const { options, time, duration } = shot;
    if (!(options.watchTime && options.titleCount)) {
        if (options.watchTime) hours(ctx, shot, time); else titles(ctx, shot, time);
        return;
    }
    const split = Math.max(beats(2), Math.round(duration / BEAT / 2) * BEAT);
    const raw = filmClamp((time - split + 0.26) / 0.52);
    if (raw <= 0) { hours(ctx, shot, time); return; }
    if (raw >= 1) { titles(ctx, shot, time - split); return; }
    // Coupe interne sur le temps : le panneau des titres monte et pousse le compteur d'heures.
    const p = filmQuintInOut(raw), edge = H * (1 - p);
    ctx.save(); ctx.translate(0, -p * H * 0.45); hours(ctx, shot, time); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(0, edge, W, H - edge); ctx.clip(); ctx.translate(0, edge * 0.35); titles(ctx, shot, Math.max(0, time - split)); ctx.restore();
    ctx.fillStyle = FILM.light; ctx.fillRect(0, edge - 4, W, 4);
}

/* ───────────── Numéro 1 ───────────── */

const HERO: Pose = { x: 208, y: 300, w: 304, r: 0, s: 1 };

function heroPose(time: number): Pose {
    const scale = filmMix(1.08, 1, filmExpo(time / beats(1.8)));
    const w = HERO.w * scale;
    return { ...HERO, x: W / 2 - w / 2, y: HERO.y + HERO.w * 0.75 - w * 0.75, w };
}

/** Rayons de projecteur très doux, qui s'éteignent avec la distance. */
function rays(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, alpha: number) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(time * 0.08);
    const light = ctx.createRadialGradient(0, 0, 60, 0, 0, 760), rgb = wrappedRgb(FILM.highlight);
    light.addColorStop(0, `rgba(${rgb},1)`); light.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = light; ctx.globalAlpha *= alpha;
    for (let index = 0; index < 14; index += 1) {
        ctx.rotate(Math.PI * 2 / 14);
        ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(-74, -900); ctx.lineTo(74, -900); ctx.lineTo(4, 0); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
}

function favorite(ctx: CanvasRenderingContext2D, shot: Shot) {
    const { data, options, texts, images, duration } = shot;
    const time = paced(shot);
    const item = data.items[0];
    fill(ctx, FILM.stage);
    const backdrop = data.backdropUrl ? images.get(data.backdropUrl) : null;
    if (backdrop) {
        ctx.save(); ctx.globalAlpha = 0.34; zoom(ctx, filmMix(1.14, 1, filmSmooth(shot.time / Math.max(1, duration))));
        drawCanvasImage(ctx, backdrop, 0, 0, W, H, 'cover'); ctx.restore();
        const shade = ctx.createLinearGradient(0, 0, 0, H);
        const stage = wrappedRgb(FILM.stage);
        shade.addColorStop(0, `rgba(${stage},0.25)`); shade.addColorStop(0.55, `rgba(${stage},0.7)`); shade.addColorStop(1, FILM.stage);
        ctx.fillStyle = shade; ctx.fillRect(0, 0, W, H);
    }
    if (!item) return;
    const center = HERO.y + HERO.w * 0.75;
    rays(ctx, W / 2, center, time, 0.07 + 0.05 * filmExpo(time / beats(1.5)));
    filmGlow(ctx, W / 2, center, 470, wrappedRgb(FILM.highlight), 0.22);
    kicker(ctx, texts.favorite, time, FILM.highlight, HERO.y - 64, 'center');
    const pose = heroPose(time);
    if (!shot.omitFeatured) filmPoster(ctx, item, imageFor(images, item), pose.x, pose.y, pose.w, { shine: (time - beats(1.3)) / beats(1.5) });
    filmCorners(ctx, HERO.x - 16, HERO.y - 16, HERO.w + 32, HERO.w * 1.5 + 32, FILM.highlight, filmExpo((time - beats(0.6)) / beats(0.8)), 30, 2);
    const top = HERO.y + HERO.w * 1.5 + 46;
    const title = filmWords(ctx, item.title, W / 2, top, CONTENT, {
        size: 64, minSize: 32, display: true, lines: 3, align: 'center', leading: 1.02, color: FILM.paper,
        time: time - beats(0.8), stagger: beats(0.12), duration: beats(0.9),
    });
    if (options.watchTime) filmCounter(ctx, item.duration, W / 2, top + title.height + 20, { size: 40, weight: 800, color: FILM.highlight, align: 'center', progress: (time - beats(1.5)) / beats(2), alpha: filmClamp((time - beats(1.4)) / beats(0.3)) });
    // Plan long (peu d'informations retenues) : le reste du podium entre en second temps.
    if (duration >= beats(10)) {
        const podium = data.items.slice(1, 3);
        const base = top + title.height + (options.watchTime ? 92 : 40);
        podium.forEach((other, rank) => {
            const appear = filmExpo((time - beats(5 + rank * 0.5)) / beats(0.9));
            filmText(ctx, `0${rank + 2}  ${other.title}`, W / 2, base + rank * 38 + (1 - appear) * 16, CONTENT, { size: 22, weight: 600, color: FILM.paper, align: 'center', alpha: 0.78 * appear });
        });
    }
}

/* ───────────── Portrait ───────────── */

const BADGE: Pose = { x: 548, y: 146, w: 124, r: 0, s: 0 };

/**
 * Bloc justifié : coupe aux espaces et après les traits d'union, puis chaque ligne
 * grandit jusqu'à la largeur utile, dans une limite qui garde les mots courts lisibles.
 */
function stackRows(ctx: CanvasRenderingContext2D, value: string, width: number) {
    // Découpe manuelle (sans assertion arrière) pour rester lisible par les anciens Safari.
    const tokens = value.trim().split(/\s+/).filter(Boolean).flatMap(word => {
        const pieces: string[] = [];
        let piece = '';
        for (const glyph of Array.from(word)) {
            piece += glyph;
            if (glyph === '-') { pieces.push(piece); piece = ''; }
        }
        if (piece) pieces.push(piece);
        return pieces.map((text, index) => ({ text, glued: index > 0 }));
    });
    let base = 110, rows: string[] = [];
    for (let guard = 0; guard < 40; guard += 1) {
        ctx.font = filmFont(base, true);
        rows = [];
        let line = '';
        for (const token of tokens) {
            const candidate = line ? `${line}${token.glued ? '' : ' '}${token.text}` : token.text;
            if (!line || ctx.measureText(candidate).width <= width) line = candidate;
            else { rows.push(line); line = token.text; }
        }
        if (line) rows.push(line);
        if ((rows.length <= 4 && rows.every(row => ctx.measureText(row).width <= width)) || base <= 40) break;
        base -= 6;
    }
    // Au-delà de quatre lignes, la dernière se termine par une ellipse lisible.
    if (rows.length > 4) rows = [...rows.slice(0, 3), `${rows.slice(3).join(' ').slice(0, 14).trim()}…`];
    return rows.map(row => {
        ctx.font = filmFont(base, true);
        return { row, size: Math.max(28, Math.min(172, base * 1.7, base * width / Math.max(1, ctx.measureText(row).width))) };
    });
}

function portrait(ctx: CanvasRenderingContext2D, shot: Shot) {
    const { data, options, texts, images } = shot;
    const time = paced(shot);
    fill(ctx, FILM.paper);
    const sweep = filmExpo((time - beats(0.1)) / beats(1.2));
    ctx.fillStyle = FILM.primary; ctx.fillRect(0, 0, 14 * sweep, H);
    // Le portrait défile en contour au pied du cadre : la pose reste vivante.
    filmMarquee(ctx, data.persona.toLocaleUpperCase(), 1056, 132, 60 + time * 38, FILM.primary, 0.1 * filmSmooth((time - beats(1.5)) / beats(1.5)));
    kicker(ctx, texts.portrait, time, FILM.primary, 196);
    if (options.favorite && data.items[0] && !shot.omitFeatured) filmPoster(ctx, data.items[0], imageFor(images, data.items[0]), BADGE.x, BADGE.y, BADGE.w, { shadow: BADGE.s });
    const rows = stackRows(ctx, data.persona.toLocaleUpperCase(), CONTENT);
    const traits = (data.traits || []).slice(0, 2);
    const block = rows.reduce((sum, row) => sum + row.size * 0.94, 0);
    const total = block + (traits.length ? 60 + traits.length * 96 : 0);
    let y = 300 + Math.max(0, (1050 - 300 - total) / 2);
    ctx.save();
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    rows.forEach(({ row, size }, index) => {
        // Les lignes entrent en alternance depuis les deux bords du cadre.
        const arrival = filmExpo((time - beats(0.35) - index * beats(0.3)) / beats(1.05));
        const direction = index % 2 ? 1 : -1;
        ctx.font = filmFont(size, true);
        ctx.fillStyle = index % 2 ? FILM.primary : FILM.ink;
        ctx.fillText(row, M + direction * (1 - arrival) * (W + 40), y + size * 0.8);
        y += size * 0.94;
    });
    ctx.restore();
    y += 60;
    traits.forEach((trait, index) => {
        const arrival = filmExpo((time - beats(1.9 + index * 0.9)) / beats(0.9));
        filmLine(ctx, M, y, filmMix(M, W - M, arrival), y, FILM.ink, 0.22, 2);
        filmText(ctx, `0${index + 1}`, M, y + 24, 80, { size: 34, display: true, color: FILM.primary, alpha: arrival });
        const text = filmText(ctx, trait.label, M + 96, y + 28 + (1 - arrival) * 18, CONTENT - 96, { size: 34, minSize: 24, weight: 600, color: FILM.ink, lines: 2, alpha: arrival });
        y += Math.max(84, text.height + 52);
    });
}

/* ───────────── Souvenir final ───────────── */

type FinaleLayout = { poster: Pose | null; blocks: { kind: 'favorite' | 'stats' | 'persona'; y: number; height: number }[]; footer: number; stats: number; persona: number };

function finaleLayout(ctx: CanvasRenderingContext2D, data: WrappedShareCardData, options: WrappedVideoOptions): FinaleLayout {
    const favoriteItem = options.favorite ? data.items[0] : undefined;
    const hasStats = options.watchTime || options.titleCount;
    const roomy = !favoriteItem;
    const statsSize = roomy ? (options.watchTime && options.titleCount ? 76 : 104) : 52;
    const personaSize = roomy ? 64 : 44;
    const blocks: FinaleLayout['blocks'] = [];
    let y = 392;
    if (favoriteItem) { blocks.push({ kind: 'favorite', y, height: 312 }); y += 312 + 64; }
    if (hasStats) { const height = statsSize * 1.05 + 40; blocks.push({ kind: 'stats', y, height }); y += height + 64; }
    if (options.portrait) {
        const persona = filmLayout(ctx, data.persona, CONTENT, { size: personaSize, minSize: 28, lines: roomy ? 3 : 2, display: true });
        const traits = data.traits?.length ? 70 : 0;
        const height = 34 + persona.rows.length * persona.lineHeight + traits;
        blocks.push({ kind: 'persona', y, height }); y += height + 64;
    }
    // Sans affiche, la composition typographique se centre dans l'espace libre.
    const free = 1060 - (y - 64);
    if (roomy && free > 0) blocks.forEach(block => { block.y += free / 2; });
    return { poster: favoriteItem ? { x: M, y: 392, w: 208, r: 0, s: 0 } : null, blocks, footer: 1092, stats: statsSize, persona: personaSize };
}

function finale(ctx: CanvasRenderingContext2D, shot: Shot) {
    const { data, options, texts, images } = shot;
    // Un film réduit au seul souvenir commence quand même par la marque.
    const opening = shot.start === 0 ? beats(2.5) : 0;
    const time = shot.time - opening;
    fill(ctx, FILM.ink);
    filmGlow(ctx, 90, 1210, 820, wrappedRgb(FILM.primary), 0.34);
    filmGlow(ctx, 680, 110, 520, wrappedRgb(FILM.light), 0.1);
    if (opening && shot.time < opening + beats(0.5)) logo(ctx, data.year, shot.time);
    if (time < 0) return;
    const layout = finaleLayout(ctx, data, options);
    const reveal = (index: number) => filmExpo((time - beats(0.15 + index * 0.4)) / beats(0.85));
    filmCounter(ctx, String(data.year), M - 4, 128, { size: 168, display: true, color: FILM.light, progress: 1, alpha: reveal(0) });
    filmText(ctx, texts.intro.replace(/\s*\n\s*/g, ' '), M, 312, CONTENT, { size: 24, weight: 600, color: FILM.paper, alpha: 0.72 * reveal(0) });
    filmLine(ctx, M, 360, filmMix(M, W - M, reveal(0)), 360, FILM.paper, 0.22);
    layout.blocks.forEach((block, index) => {
        const appear = reveal(index + 1), y = block.y + (1 - appear) * 36;
        if (index) filmLine(ctx, M, block.y - 32, filmMix(M, W - M, appear), block.y - 32, FILM.paper, 0.18);
        const poster = layout.poster;
        if (block.kind === 'favorite' && poster) {
            const item = data.items[0];
            if (!shot.omitFeatured) filmPoster(ctx, item, imageFor(images, item), poster.x, poster.y, poster.w, { shadow: poster.s });
            const x = M + poster.w + 32, width = CONTENT - poster.w - 32;
            filmText(ctx, texts.favorite, x, y + 4, width, { size: 17, weight: 800, color: FILM.highlight, uppercase: true, tracking: 3, alpha: appear });
            const title = filmText(ctx, item.title, x, y + 40, width, { size: 46, minSize: 26, display: true, color: FILM.paper, lines: 3, leading: 1.02, alpha: appear });
            if (options.watchTime) filmText(ctx, item.duration, x, y + 56 + title.height, width, { size: 30, weight: 800, color: FILM.highlight, alpha: appear });
            // Les deux titres suivants complètent le podium, au pied de l'affiche.
            const podium = data.items.slice(1, 3);
            podium.forEach((other, rank) => {
                const rowY = poster.y + poster.w * 1.5 - (podium.length - rank) * 36 + 6;
                const rowAppear = reveal(index + 1.5 + rank * 0.4);
                filmText(ctx, `0${rank + 2}`, x, rowY, 44, { size: 18, weight: 800, color: FILM.light, alpha: rowAppear });
                filmText(ctx, other.title, x + 44, rowY, width - 44, { size: 20, weight: 600, color: FILM.paper, alpha: 0.82 * rowAppear });
            });
        } else if (block.kind === 'stats') {
            const stats = [options.watchTime && { label: texts.time, value: data.watchTime, share: 0.64 }, options.titleCount && { label: texts.titles, value: data.titleCount, share: 0.36 }].filter(Boolean) as { label: string; value: string; share: number }[];
            let x = M;
            stats.forEach((stat, column) => {
                // La durée, plus longue à écrire, reçoit davantage de largeur que le nombre de titres.
                const width = stats.length === 2 ? (CONTENT - 32) * stat.share : CONTENT;
                if (column) filmLine(ctx, x - 16, y, x - 16, y + layout.stats * 1.05 + 30, FILM.paper, 0.18 * appear);
                const size = filmFitSize(ctx, stat.value, width, layout.stats, 26);
                // Les valeurs partagent leur ligne de base, même quand l'une est réduite.
                filmCounter(ctx, stat.value, x, y + (layout.stats - size) * 0.8, { size, display: true, color: FILM.paper, progress: (time - beats(0.55 + index * 0.4)) / beats(1.6), alpha: appear });
                filmText(ctx, stat.label, x, y + layout.stats * 0.98 + 10, width, { size: 18, weight: 600, color: FILM.muted, alpha: appear });
                x += width + 32;
            });
        } else if (block.kind === 'persona') {
            filmText(ctx, texts.portrait, M, y, CONTENT, { size: 17, weight: 800, color: FILM.light, uppercase: true, tracking: 3, alpha: appear });
            const persona = filmText(ctx, data.persona, M, y + 34, CONTENT, { size: layout.persona, minSize: 28, display: true, color: FILM.paper, lines: layout.persona > 50 ? 3 : 2, leading: 1.02, alpha: appear });
            const traits = (data.traits || []).slice(0, 2).map(trait => trait.label).join('  ·  ');
            if (traits) filmText(ctx, traits, M, y + 50 + persona.height, CONTENT, { size: 22, weight: 600, color: FILM.paper, lines: 2, alpha: 0.78 * appear });
        }
    });
    const end = reveal(layout.blocks.length + 1);
    filmLine(ctx, M, layout.footer, filmMix(M, W - M, end), layout.footer, FILM.paper, 0.22);
    filmText(ctx, texts.final, M, layout.footer + 26, 470, { size: 26, weight: 800, color: FILM.paper, alpha: end });
    filmText(ctx, data.domain, M, layout.footer + 66, 470, { size: 19, weight: 600, color: FILM.light, alpha: end });
    filmText(ctx, 'MOVIX', W - M, layout.footer + 30, 200, { size: 30, display: true, color: FILM.paper, align: 'right', alpha: end });
    // Retour harmonique de la piste : un reflet traverse le souvenir une seule fois.
    const shine = (time - beats(6)) / beats(1.4);
    if (shine > 0 && shine < 1) {
        const x = filmMix(-W * 0.6, W * 1.6, filmSmooth(shine));
        const light = ctx.createLinearGradient(x - 220, 0, x + 220, H * 0.3);
        light.addColorStop(0, 'rgba(255,255,255,0)'); light.addColorStop(0.5, 'rgba(255,255,255,0.1)'); light.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.save(); ctx.fillStyle = light; ctx.fillRect(0, 0, W, H); ctx.restore();
    }
}

/* ───────────── Signature : une habitude du profil ───────────── */

/** Lignes à barres (genres, formats, voix) : libellé, valeur et part, l'accent sur le rang choisi. */
function signatureRows(ctx: CanvasRenderingContext2D, scene: WrappedSignatureScene, top: number, time: number) {
    scene.rows.slice(0, 4).forEach((row, index) => {
        const arrival = filmExpo((time - beats(0.7 + index * 0.25)) / beats(0.9));
        const accent = index === (scene.peak ?? 0) ? FILM.highlight : FILM.primary;
        const y = top + index * 116 + (1 - arrival) * 18;
        filmText(ctx, row.label, M, y, CONTENT - 170, { size: 30, minSize: 22, weight: 800, color: FILM.paper, alpha: arrival });
        filmText(ctx, row.value, W - M, y, 170, { size: 30, minSize: 22, weight: 800, color: accent, align: 'right', alpha: arrival });
        ctx.save();
        ctx.globalAlpha *= 0.14 * arrival; ctx.fillStyle = FILM.paper;
        filmRoundRect(ctx, M, y + 52, CONTENT, 14, 7); ctx.fill();
        ctx.globalAlpha = arrival; ctx.fillStyle = accent;
        filmRoundRect(ctx, M, y + 52, Math.max(0.01, CONTENT * row.share * filmExpo((time - beats(0.85 + index * 0.25)) / beats(1))), 14, 7); ctx.fill();
        ctx.restore();
    });
}

/** Horloge de 24 heures : une barre par heure, l'aiguille rejoint l'heure de pointe. */
function signatureClock(ctx: CanvasRenderingContext2D, scene: WrappedSignatureScene, time: number) {
    const cx = W / 2, cy = 700, inner = 118, reach = 158, peak = scene.peak ?? 0;
    const angle = (hour: number) => hour / 24 * Math.PI * 2 - Math.PI / 2;
    ctx.save();
    ctx.globalAlpha = 0.16 * filmClamp(time / beats(0.4)); ctx.strokeStyle = FILM.paper; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, inner - 22, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    scene.rows.slice(0, 24).forEach((hour, index) => {
        const grow = filmExpo((time - beats(0.3) - index * beats(0.035)) / beats(0.8));
        const length = (6 + reach * hour.share) * grow, a = angle(index);
        ctx.save();
        ctx.lineCap = 'round'; ctx.lineWidth = 15; ctx.strokeStyle = index === peak ? FILM.highlight : FILM.primary;
        ctx.globalAlpha = (index === peak ? 1 : 0.9) * filmClamp(grow * 3);
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
        ctx.lineTo(cx + Math.cos(a) * (inner + length), cy + Math.sin(a) * (inner + length)); ctx.stroke();
        ctx.restore();
    });
    [0, 6, 12, 18].forEach(index => {
        const a = angle(index), radius = inner + reach + 34;
        filmText(ctx, scene.rows[index]?.label || '', cx + Math.cos(a) * radius, cy + Math.sin(a) * radius - 12, 140, { size: 18, weight: 800, color: FILM.muted, align: 'center', alpha: filmClamp((time - beats(0.5)) / beats(0.5)) });
    });
    // L'aiguille balaie le cadran depuis minuit jusqu'à l'heure de pointe.
    const sweep = angle(peak * filmExpo((time - beats(0.9)) / beats(1.2)));
    ctx.save();
    ctx.globalAlpha = filmClamp((time - beats(0.8)) / beats(0.3)); ctx.strokeStyle = FILM.highlight; ctx.fillStyle = FILM.highlight;
    ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(sweep) * (inner - 34), cy + Math.sin(sweep) * (inner - 34)); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
}

function signature(ctx: CanvasRenderingContext2D, shot: Shot) {
    const scene = shot.data.signatureScene;
    const time = paced(shot);
    fill(ctx, FILM.ink);
    filmGlow(ctx, 640, 160, 700, wrappedRgb(FILM.primary), 0.42);
    filmGlow(ctx, 60, 1180, 640, wrappedRgb(FILM.light), 0.12);
    if (!scene) return;
    kicker(ctx, scene.label, time, FILM.light);
    // La phrase de contexte suit le contenu ; l'horloge, plus haute, la garde en bas du cadre.
    let captionTop = 1056;
    if (scene.kind === 'clock') {
        const size = filmFitSize(ctx, scene.value, CONTENT, 116, 56);
        filmWords(ctx, scene.value, M, 236, CONTENT, { size, display: true, color: FILM.paper, time: time - beats(0.2), stagger: beats(0.15), duration: beats(0.8) });
        signatureClock(ctx, scene, time);
    } else if (scene.kind === 'streak') {
        const size = filmFitSize(ctx, scene.value, CONTENT, 300, 120);
        filmCounter(ctx, scene.value, M, 232, { size, display: true, color: FILM.paper, progress: (time - beats(0.2)) / beats(1.6) });
        const unit = filmText(ctx, scene.unit || '', M, 232 + size * 1.02, CONTENT, { size: 46, minSize: 28, display: true, color: FILM.light, lines: 2, reveal: (time - beats(0.4)) / beats(0.8) });
        // Une case par jour de la série tant que la grille reste lisible.
        const days = Number(scene.value.replace(/\D/g, ''));
        const top = 232 + size * 1.02 + unit.height + 56;
        const height = days > 0 && days <= 70 ? filmSeats(ctx, days, { x: M, y: top, width: CONTENT, height: Math.min(380, 1000 - top) }, time - beats(0.6), { color: FILM.primary, accent: FILM.highlight, duration: beats(1.4) }) : 0;
        captionTop = Math.min(1056, top + height + 48);
    } else {
        // Genres, formats ou voix : un mot (ou un nombre) en tête, puis les barres.
        filmMarquee(ctx, scene.value.toLocaleUpperCase(), 1070, 150, 40 + time * 36, FILM.light, 0.07 * filmSmooth((time - beats(1)) / beats(1.5)));
        let top = 236;
        if (scene.kind === 'community') {
            const size = filmFitSize(ctx, scene.value, CONTENT, 220, 96);
            filmCounter(ctx, scene.value, M, top, { size, display: true, color: FILM.paper, progress: (time - beats(0.2)) / beats(1.6) });
            top += size * 1.02;
            top += filmText(ctx, scene.unit || '', M, top, CONTENT, { size: 40, minSize: 26, display: true, color: FILM.light, lines: 2, reveal: (time - beats(0.4)) / beats(0.8) }).height;
        } else {
            const size = filmFitSize(ctx, scene.value.toLocaleUpperCase(), CONTENT, 124, 52);
            top += filmWords(ctx, scene.value, M, top, CONTENT, { size, minSize: 52, display: true, uppercase: true, lines: 2, leading: 0.98, color: FILM.paper, time: time - beats(0.2), stagger: beats(0.15), duration: beats(0.8) }).height;
        }
        signatureRows(ctx, scene, top + 70, time);
        captionTop = Math.min(1056, top + 70 + Math.min(4, scene.rows.length) * 116 + 24);
    }
    if (scene.caption) filmText(ctx, scene.caption, M, captionTop, CONTENT, { size: 20, weight: 600, color: FILM.paper, lines: 2, alpha: 0.78 * filmClamp((time - beats(1.6)) / beats(0.6)) });
}

/* ───────────── Montage ───────────── */

const PULSE: Record<WrappedVideoScene, (time: number) => number> = {
    intro: time => 0.008 * filmClamp((time - beats(2)) / beats(1)),
    watchTime: () => 0.012, titleCount: () => 0.012, signature: () => 0.01, favorite: () => 0.008, portrait: () => 0.012,
    final: time => 0.006 * (1 - filmClamp((time - beats(3)) / beats(1))),
};
const LIGHT: Record<WrappedVideoScene, number> = { intro: 0, watchTime: 0, titleCount: 0, signature: 0, favorite: 0, portrait: 1, final: 0 };

function drawScene(ctx: CanvasRenderingContext2D, scene: WrappedVideoScene, shot: Shot) {
    ctx.save();
    // Les plans respirent sur la grosse caisse, d'une impulsion continue.
    zoom(ctx, 1 + PULSE[scene](shot.time) * filmPulse(shot.start + shot.time, BEAT));
    if (scene === 'intro') intro(ctx, shot);
    else if (scene === 'watchTime' || scene === 'titleCount') statistics(ctx, shot);
    else if (scene === 'signature') signature(ctx, shot);
    else if (scene === 'favorite') favorite(ctx, shot);
    else if (scene === 'portrait') portrait(ctx, shot);
    else finale(ctx, shot);
    ctx.restore();
}

function featuredPose(ctx: CanvasRenderingContext2D, scene: WrappedVideoScene, shot: Shot): Pose | null {
    if (scene === 'intro') return zoomPose(fanPose(0, shot.time), introCamera(shot.time));
    if (scene === 'favorite') return heroPose(paced(shot));
    if (scene === 'portrait') return BADGE;
    if (scene === 'final') return finaleLayout(ctx, shot.data, shot.options).poster;
    return null;
}

type Wipe = 'rise' | 'split' | 'iris' | 'stripes' | 'slash';
const WIPES: Record<WrappedVideoScene, Wipe> = { intro: 'rise', watchTime: 'rise', titleCount: 'rise', signature: 'split', favorite: 'iris', portrait: 'stripes', final: 'slash' };

/** Volets graphiques : chaque destination a son geste, centré sur le temps musical. */
function wipe(ctx: CanvasRenderingContext2D, kind: Wipe, raw: number, before: () => void, after: () => void) {
    const p = filmQuintInOut(raw), flash = Math.sin(raw * Math.PI);
    if (kind === 'split') {
        // Le plan sortant s'ouvre en deux par le milieu ; le suivant avance derrière lui.
        const gap = p * H / 2;
        ctx.save(); zoom(ctx, filmMix(1.12, 1, p)); after(); ctx.restore();
        ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, Math.max(0, H / 2 - gap)); ctx.clip(); ctx.translate(0, -gap); before(); ctx.restore();
        ctx.save(); ctx.beginPath(); ctx.rect(0, H / 2 + gap, W, Math.max(0, H / 2 - gap)); ctx.clip(); ctx.translate(0, gap); before(); ctx.restore();
        ctx.save(); ctx.globalAlpha = flash; ctx.fillStyle = FILM.light;
        ctx.fillRect(0, H / 2 - gap - 3, W, 3); ctx.fillRect(0, H / 2 + gap, W, 3);
        ctx.restore();
    } else if (kind === 'rise') {
        const edge = H * (1 - p);
        ctx.save(); ctx.translate(0, -p * H * 0.3); before(); ctx.restore();
        ctx.save(); ctx.fillStyle = `rgba(0,0,0,${0.4 * p})`; ctx.fillRect(0, 0, W, H); ctx.restore();
        ctx.save(); ctx.beginPath(); ctx.rect(0, edge, W, H - edge); ctx.clip(); ctx.translate(0, edge * 0.35); after(); ctx.restore();
        ctx.save(); ctx.globalAlpha = flash; ctx.fillStyle = FILM.light; ctx.fillRect(0, edge - 6, W, 6); ctx.restore();
    } else if (kind === 'iris') {
        const cx = W / 2, cy = HERO.y + HERO.w * 0.75, radius = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy)) + 24;
        ctx.save(); zoom(ctx, 1 + 0.14 * p, cx, cy); before(); ctx.restore();
        ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, Math.max(0.5, radius * p), 0, Math.PI * 2); ctx.clip();
        zoom(ctx, filmMix(1.18, 1, p), cx, cy); after(); ctx.restore();
        ctx.save(); ctx.globalAlpha = flash; ctx.strokeStyle = FILM.highlight; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(cx, cy, Math.max(0.5, radius * p), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    } else if (kind === 'stripes') {
        const bands = 6, height = H / bands;
        ctx.save(); ctx.translate(-p * W * 0.18, 0); before(); ctx.restore();
        ctx.save(); ctx.beginPath();
        const edges: number[] = [];
        for (let index = 0; index < bands; index += 1) {
            const local = filmQuintInOut((raw - index * 0.05) / (1 - 0.05 * (bands - 1)));
            const x = W * (1 - local);
            edges.push(x);
            ctx.rect(x, index * height - 0.5, W - x + 1, height + 1);
        }
        ctx.clip(); after(); ctx.restore();
        ctx.save(); ctx.globalAlpha = flash; ctx.fillStyle = FILM.primary;
        edges.forEach((x, index) => ctx.fillRect(x - 5, index * height, 5, height));
        ctx.restore();
    } else {
        // Diagonale qui balaie du coin inférieur gauche vers le coin supérieur droit.
        const sweep = p * (W + H), far = 4000;
        ctx.save(); zoom(ctx, filmMix(1, 0.94, p)); before(); ctx.restore();
        ctx.save(); ctx.beginPath();
        ctx.moveTo(-far, -far + H - sweep); ctx.lineTo(W + far, W + far + H - sweep); ctx.lineTo(W + far, H + far * 3); ctx.lineTo(-far, H + far * 3); ctx.closePath(); ctx.clip();
        zoom(ctx, filmMix(1.1, 1, p)); after(); ctx.restore();
        ctx.save(); ctx.globalAlpha = flash; ctx.strokeStyle = FILM.primary; ctx.lineWidth = 10;
        ctx.beginPath(); ctx.moveTo(-far, -far + H - sweep); ctx.lineTo(W + far, W + far + H - sweep); ctx.stroke(); ctx.restore();
    }
}

function hudAlpha(scene: WrappedVideoScene, time: number, start: number) {
    const opening = scene === 'intro' || (scene === 'final' && start === 0) ? filmSmooth((time - beats(1.3)) / beats(0.7)) : 1;
    return { top: opening, bottom: scene === 'final' ? 0 : opening };
}

/** Les plans sortant et entrant coexistent ; la caméra ne montre jamais un cadre vide. */
export function drawWrappedVideoFrame(ctx: CanvasRenderingContext2D, data: WrappedShareCardData, options: WrappedVideoOptions, texts: WrappedVideoTexts, images: WrappedVideoImages, time: number, timeline: WrappedVideoBeat[]) {
    const safe = Number.isFinite(time) ? Math.max(0, Math.min(WRAPPED_VIDEO_DURATION, time)) : 0;
    // Toute l'image est peinte dans l'ambiance du profil, choisie avant le premier tracé.
    filmUsePalette(wrappedThemePalette(data.theme));
    const beat = getWrappedVideoBeatAt(safe, timeline);
    const shot = (entry: WrappedVideoBeat, local: number, omitFeatured = false): Shot => ({ data, options, texts, images, time: local, duration: entry.end - entry.start, start: entry.start, omitFeatured });
    const boundary = timeline.slice(1).find(next => safe >= next.start - HALF && safe < next.start + HALF);
    const chapter = (entry: WrappedVideoBeat) => `${String(timeline.indexOf(entry) + 1).padStart(2, '0')} / ${String(timeline.length).padStart(2, '0')}`;
    let light: number, top: number, bottom: number, label: string;
    ctx.save();
    if (boundary) {
        const previous = timeline[timeline.indexOf(boundary) - 1];
        const raw = filmClamp((safe - boundary.start + HALF) / (HALF * 2)), p = filmQuintInOut(raw);
        const prevShot = shot(previous, safe - previous.start), nextShot = shot(boundary, Math.max(0, safe - boundary.start));
        const from = options.favorite && data.items[0] ? featuredPose(ctx, previous.scene, prevShot) : null;
        const to = from ? featuredPose(ctx, boundary.scene, nextShot) : null;
        const persist = Boolean(from && to);
        wipe(ctx, WIPES[boundary.scene], raw,
            () => drawScene(ctx, previous.scene, { ...prevShot, omitFeatured: persist }),
            () => drawScene(ctx, boundary.scene, { ...nextShot, omitFeatured: persist }));
        if (from && to) {
            // Une seule affiche traverse le raccord et change de rôle, sans double exposition.
            const item = data.items[0];
            const lift = Math.sin(raw * Math.PI);
            filmPoster(ctx, item, imageFor(images, item), filmMix(from.x, to.x, p), filmMix(from.y, to.y, p) - lift * 18, filmMix(from.w, to.w, p), { rotation: filmMix(from.r, to.r, p) + lift * -3, shadow: filmMix(from.s, to.s, p) + lift * 0.7 });
        }
        const a = hudAlpha(previous.scene, prevShot.time, previous.start), b = hudAlpha(boundary.scene, nextShot.time, boundary.start);
        light = filmMix(LIGHT[previous.scene], LIGHT[boundary.scene], p);
        top = filmMix(a.top, b.top, p); bottom = filmMix(a.bottom, b.bottom, p);
        label = chapter(p < 0.5 ? previous : boundary);
    } else {
        const current = shot(beat, safe - beat.start);
        drawScene(ctx, beat.scene, current);
        ({ top, bottom } = hudAlpha(beat.scene, current.time, beat.start));
        light = LIGHT[beat.scene];
        label = chapter(beat);
    }
    filmVignette(ctx, filmMix(0.42, 0.1, light));
    drawWrappedGrain(ctx, W, H, filmMix(0.075, 0.05, light), Math.floor(safe * WRAPPED_VIDEO_FPS));
    const hud = { year: data.year, domain: data.domain, chapter: label };
    if (light <= 0.001 || light >= 0.999) filmHud(ctx, { ...hud, color: light > 0.5 ? FILM.ink : FILM.paper, top, bottom });
    else {
        filmHud(ctx, { ...hud, color: FILM.paper, top: top * (1 - light), bottom: bottom * (1 - light) });
        filmHud(ctx, { ...hud, color: FILM.ink, top: top * light, bottom: bottom * light });
    }
    ctx.restore();
}
