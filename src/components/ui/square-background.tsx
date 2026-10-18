import React, { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { useBgPrefs, getBgAccentRgb } from '@/utils/bgPreferences';
import { useLightMode } from '@/context/LightModeContext';
import { useHalloweenTheme } from '@/hooks/useHalloweenTheme';
import { fitCanvasBitmapSize, isCanvasInvalidStateError } from '@/utils/canvasSizing';

// Grille gris brume du thème Halloween, au-dessus du réglage « Forcer la couleur ».
const HALLOWEEN_GRID_RGB = '130, 120, 150';

type BgMode = 'combined' | 'static' | 'animated';

interface SquareBackgroundProps extends React.HTMLAttributes<HTMLDivElement> {
    squareSize?: number;
    borderColor?: string;
    mode?: BgMode;
}

interface Neighbor {
    row: number;
    col: number;
    opacity: number;
}

function parseRGB(color: string): { r: number; g: number; b: number } {
    const match = color.match(/\d+/g);
    if (!match || match.length < 3) return { r: 239, g: 68, b: 68 };
    return { r: parseInt(match[0]), g: parseInt(match[1]), b: parseInt(match[2]) };
}

const DEFAULT_SQUARE_SIZE = 48;
const STARTING_ALPHA = 100;
const FADE_PER_FRAME = 8;
const NEIGHBOR_PROB = 0.5;
const EXPLOSION_RADIUS = 4;
const EXPLOSION_PARTICLES = 20;
const OFFSCREEN_COORD = -1000;
const HALO_SIZE = 400;
const HALO_HALF_SIZE = HALO_SIZE / 2;
const HALO_HIDDEN_TRANSLATE = -1200;
// Borne le backing store du canvas grille à N hauteurs de viewport au lieu de
// toute la hauteur scrollable du container (potentiellement plusieurs
// milliers de px sur une page comme Home). Le canvas est repositionné par
// translation CSS pendant le scroll (cf. updateCanvasWindow) ; la grille étant
// un motif périodique, un repositionnement aligné sur un multiple de la
// taille de cellule ne laisse aucune couture visible.
const CANVAS_HEIGHT_VIEWPORT_MULTIPLIER = 2;
const RESIZE_REDRAW_DEBOUNCE_MS = 150;

const normalizeSquareSize = (value: number) => (
    Number.isFinite(value) && value > 0
        ? Math.max(2, Math.min(512, Math.round(value)))
        : DEFAULT_SQUARE_SIZE
);

export const SquareBackground: React.FC<SquareBackgroundProps> = ({
    children,
    className,
    squareSize: propSquareSize = 48,
    borderColor: propBorderColor = 'rgba(239, 68, 68, 0.15)',
    mode = 'combined',
    ...props
}) => {
    // Overrides "Forcer cette couleur / taille" depuis SettingsPage. Quand
    // l'utilisateur active les flags, on ignore les valeurs hardcodées passées
    // par les pages (Search, Collections, etc.) et on applique le réglage user.
    const prefs = useBgPrefs();
    const halloween = useHalloweenTheme();
    const { isLightMode, effectivePrefs } = useLightMode();
    const squareSize = normalizeSquareSize(prefs.forceSquareSize ? prefs.squareSize : propSquareSize);
    const overrideRgb = halloween ? HALLOWEEN_GRID_RGB : prefs.forceColor ? getBgAccentRgb(prefs) : null;
    // Préserve l'alpha de la couleur originale (les pages utilisent 0.10/0.15…)
    // en ne remplaçant que la composante RGB.
    const borderColor = overrideRgb
        ? (() => {
            const alphaMatch = propBorderColor.match(/rgba?\([^)]*?,\s*([\d.]+)\s*\)$/);
            const alpha = alphaMatch ? alphaMatch[1] : '0.15';
            return `rgba(${overrideRgb}, ${alpha})`;
        })()
        : propBorderColor;

    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const haloRef = useRef<HTMLDivElement>(null);
    // squareSize stocké dans un ref pour être lu dans les callbacks/RAF sans
    // re-register les handlers à chaque changement de prop.
    const squareSizeRef = useRef(squareSize);
    squareSizeRef.current = squareSize;
    const stateRef = useRef({
        neighbors: [] as Neighbor[],
        currentRow: -2,
        currentCol: -2,
        mouseX: OFFSCREEN_COORD,
        mouseY: OFFSCREEN_COORD,
        animId: 0,
        isInViewport: true,
        isDocumentVisible: typeof document === 'undefined' ? true : !document.hidden,
        dirtyCells: [] as Array<{ col: number; row: number }>,
    });
    const gridCacheRef = useRef<{ canvas: HTMLCanvasElement | null; pattern: CanvasPattern | null; signature: string }>({
        canvas: null,
        pattern: null,
        signature: '',
    });
    const colorRef = useRef(parseRGB(borderColor));
    colorRef.current = parseRGB(borderColor);

    const showCssGrid = !isLightMode && (mode === 'static' || !effectivePrefs.bgAnimations);
    const supportsPointerHalo = typeof window === 'undefined'
        || typeof window.matchMedia !== 'function'
        || window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    // Halo : seulement quand le mode l'inclut ET que l'utilisateur ne l'a pas
    // explicitement désactivé dans Apparence → "Halo lumineux", et seulement
    // avec une souris : un swipe tactile ne doit pas animer le fond pendant le scroll.
    const showHalo = supportsPointerHalo && effectivePrefs.bgAnimations && effectivePrefs.blurEffects && (mode === 'static' || mode === 'combined') && prefs.haloEnabled;
    const showCanvas = effectivePrefs.bgAnimations && (mode === 'animated' || mode === 'combined');

    useEffect(() => {
        if (!showHalo) return;

        const container = containerRef.current;
        const halo = haloRef.current;
        if (!container || !halo) return;

        let rafId = 0;
        let isActive = false;
        let lastClientX = 0;
        let lastClientY = 0;

        const applyHaloPosition = () => {
            rafId = 0;

            if (!isActive) {
                halo.style.transform = `translate(${HALO_HIDDEN_TRANSLATE}px, ${HALO_HIDDEN_TRANSLATE}px)`;
                return;
            }

            const rect = container.getBoundingClientRect();
            const nextX = lastClientX - rect.left;
            const nextY = lastClientY - rect.top;
            halo.style.transform = `translate(${nextX - HALO_HALF_SIZE}px, ${nextY - HALO_HALF_SIZE}px)`;
        };

        const scheduleHaloUpdate = () => {
            if (!rafId) {
                rafId = requestAnimationFrame(applyHaloPosition);
            }
        };

        const handlePointerMove = (e: PointerEvent) => {
            if (e.pointerType !== 'mouse') {
                if (isActive) {
                    isActive = false;
                    scheduleHaloUpdate();
                }
                return;
            }
            lastClientX = e.clientX;
            lastClientY = e.clientY;
            isActive = true;
            scheduleHaloUpdate();
        };

        const handlePointerLeave = () => {
            isActive = false;
            scheduleHaloUpdate();
        };

        const handleViewportShift = () => {
            if (isActive) {
                scheduleHaloUpdate();
            }
        };

        container.addEventListener('pointermove', handlePointerMove, { passive: true });
        container.addEventListener('pointerleave', handlePointerLeave);
        container.addEventListener('pointercancel', handlePointerLeave);
        window.addEventListener('scroll', handleViewportShift, { passive: true });
        window.addEventListener('resize', handleViewportShift);

        return () => {
            if (rafId) {
                cancelAnimationFrame(rafId);
            }
            container.removeEventListener('pointermove', handlePointerMove);
            container.removeEventListener('pointerleave', handlePointerLeave);
            container.removeEventListener('pointercancel', handlePointerLeave);
            window.removeEventListener('scroll', handleViewportShift);
            window.removeEventListener('resize', handleViewportShift);
        };
    }, [showHalo]);

    useEffect(() => {
        if (!showCanvas) return;
        if (window.innerWidth < 768) return;

        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const state = stateRef.current;
        const gridCache = gridCacheRef.current;
        let canvasAvailable = true;
        let logicalWidth = 0;
        let logicalHeight = 0;
        let bitmapScaleX = 1;
        let bitmapScaleY = 1;

        const canRender = () => canvasAvailable && state.isInViewport && state.isDocumentVisible;

        const cancelScheduledFrame = () => {
            if (state.animId) {
                cancelAnimationFrame(state.animId);
                state.animId = 0;
            }
        };

        // Rect du container mis en cache : rafraîchi uniquement via scroll/resize
        // (rAF-throttlé plus bas), jamais lu directement dans handlePointerMove
        // (qui peut tirer des dizaines de fois/seconde) — évite un layout read
        // forcé à chaque mouvement de souris sur toute la page.
        let containerRect = { top: 0, left: 0, width: 0, height: 0 };
        const refreshContainerRect = () => {
            const r = container.getBoundingClientRect();
            containerRect = { top: r.top, left: r.left, width: r.width, height: r.height };
        };

        // Fenêtrage du canvas (cf. CANVAS_HEIGHT_VIEWPORT_MULTIPLIER) : le
        // backing store ne couvre qu'une portion de la hauteur totale du
        // container sur les pages très longues, et se déplace par translation
        // CSS pendant le scroll au lieu de couvrir toute la page.
        let windowTop = 0;
        let windowHeight = 0;

        const disableCanvas = () => {
            canvasAvailable = false;
            cancelScheduledFrame();
            canvas.width = 0;
            canvas.height = 0;
        };

        const computeWindowHeight = (containerHeight: number) => {
            const maxHeight = Math.max(1, Math.round(window.innerHeight * CANVAS_HEIGHT_VIEWPORT_MULTIPLIER));
            return Math.max(1, Math.min(Math.round(containerHeight), maxHeight));
        };

        const isWindowed = () => windowHeight < Math.round(containerRect.height);

        const applyCanvasTransform = () => {
            canvas.style.transform = windowTop ? `translateY(${windowTop}px)` : '';
        };

        const syncSize = () => {
            const nextWidth = Math.max(1, Math.round(containerRect.width));
            windowHeight = computeWindowHeight(containerRect.height);
            const nextHeight = windowHeight;
            const bitmapSize = fitCanvasBitmapSize(nextWidth, nextHeight);
            if (!bitmapSize) {
                disableCanvas();
                return;
            }

            if (
                canvas.width !== bitmapSize.width
                || canvas.height !== bitmapSize.height
                || logicalWidth !== nextWidth
                || logicalHeight !== nextHeight
            ) {
                logicalWidth = nextWidth;
                logicalHeight = nextHeight;
                bitmapScaleX = bitmapSize.scaleX;
                bitmapScaleY = bitmapSize.scaleY;
                canvas.style.width = `${nextWidth}px`;
                canvas.style.height = `${nextHeight}px`;
                try {
                    canvas.width = bitmapSize.width;
                    canvas.height = bitmapSize.height;
                    ctx.setTransform(bitmapScaleX, 0, 0, bitmapScaleY, 0, 0);
                } catch (error) {
                    if (!isCanvasInvalidStateError(error)) throw error;
                    disableCanvas();
                    return;
                }
                canvasAvailable = true;
                state.dirtyCells = [];
                // Paint grid once on resize so dirty-rect rendering has a clean base
                const cell = squareSizeRef.current;
                const pattern = drawBaseGrid(cell);
                if (pattern) {
                    ctx.fillStyle = pattern;
                    ctx.fillRect(0, 0, nextWidth, nextHeight);
                }
            }
        };

        // Repeint la fenêtre depuis le motif de base déjà en cache (pas de
        // régénération : dimensions/couleur inchangées, seule la position
        // affichée bouge) — utilisé après un repositionnement de fenêtre.
        const paintGridFromCache = () => {
            const width = logicalWidth;
            const height = logicalHeight;
            if (width <= 0 || height <= 0) return;
            const cell = squareSizeRef.current;
            const pattern = drawBaseGrid(cell);
            if (pattern) {
                ctx.clearRect(0, 0, width, height);
                ctx.fillStyle = pattern;
                ctx.fillRect(0, 0, width, height);
            }
            state.dirtyCells = [];
        };

        // Repositionne la fenêtre canvas pour qu'elle couvre le viewport
        // visible + marge, alignée sur un multiple de squareSize pour que la
        // grille (motif périodique) ne saute pas visuellement. Appelé au plus
        // une fois par frame (throttle rAF côté scroll/resize) et ne repeint
        // que quand un repositionnement est réellement nécessaire.
        const updateCanvasWindow = () => {
            if (!isWindowed()) {
                if (windowTop !== 0) {
                    windowTop = 0;
                    applyCanvasTransform();
                }
                return;
            }

            const cell = squareSizeRef.current;
            const containerHeight = containerRect.height;
            const viewportTopInContainer = -containerRect.top;
            const viewportBottomInContainer = viewportTopInContainer + window.innerHeight;
            const margin = window.innerHeight * 0.25;

            const withinWindow =
                viewportTopInContainer >= windowTop + margin &&
                viewportBottomInContainer <= windowTop + windowHeight - margin;

            if (withinWindow) return;

            const idealTop = viewportTopInContainer - (windowHeight - window.innerHeight) / 2;
            const maxTop = Math.max(0, containerHeight - windowHeight);
            const clampedTop = Math.min(maxTop, Math.max(0, idealTop));
            const nextWindowTop = Math.round(clampedTop / cell) * cell;

            if (nextWindowTop === windowTop) return;

            windowTop = nextWindowTop;
            applyCanvasTransform();

            // La grille de base est un motif périodique invariant par
            // translation : pas besoin de la régénérer. Les interactions en
            // cours (cellule survolée, particules en fondu) référencent des
            // coordonnées locales à l'ancienne fenêtre — on les réinitialise
            // plutôt que de les remapper (particules déjà en fondu, impact
            // visuel négligeable).
            state.neighbors = [];
            state.currentRow = -2;
            state.currentCol = -2;
            paintGridFromCache();
        };

        const getGridMetrics = () => {
            const width = logicalWidth;
            const height = logicalHeight;
            const cell = squareSizeRef.current;
            const numCols = Math.ceil(width / cell);
            const numRows = Math.ceil(height / cell);

            return {
                width,
                height,
                cell,
                numCols,
                numRows,
            };
        };

        const drawBaseGrid = (cell: number) => {
            const { r, g, b } = colorRef.current;
            // Cache one repeating cell, not a second viewport-sized bitmap.
            const signature = `${cell}:${r}:${g}:${b}`;
            if (gridCache.signature === signature && gridCache.pattern) {
                return gridCache.pattern;
            }

            if (!gridCache.canvas) {
                gridCache.canvas = document.createElement('canvas');
            }

            const gridCanvas = gridCache.canvas;
            gridCanvas.width = cell;
            gridCanvas.height = cell;

            const gridCtx = gridCanvas.getContext('2d');
            if (!gridCtx) return null;

            gridCtx.clearRect(0, 0, cell, cell);
            gridCtx.lineWidth = 1;
            gridCtx.strokeStyle = `rgba(${r},${g},${b},0.08)`;
            gridCtx.beginPath();

            // Include both edges to preserve the half-pixel antialiasing at
            // every seam when the cell is repeated.
            gridCtx.rect(0, 0, cell, cell);

            gridCtx.stroke();
            try {
                gridCache.pattern = ctx.createPattern(gridCanvas, 'repeat');
            } catch (error) {
                if (!isCanvasInvalidStateError(error)) throw error;
                disableCanvas();
                gridCache.pattern = null;
            }
            gridCache.signature = signature;
            return gridCache.pattern;
        };

        const getRandomNeighbors = (row: number, col: number, numRows: number, numCols: number): Neighbor[] => {
            const neighbors: Neighbor[] = [];

            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    if (dr === 0 && dc === 0) continue;
                    const nextRow = row + dr;
                    const nextCol = col + dc;

                    if (
                        nextRow >= 0 &&
                        nextRow < numRows &&
                        nextCol >= 0 &&
                        nextCol < numCols &&
                        Math.random() < NEIGHBOR_PROB
                    ) {
                        neighbors.push({ row: nextRow, col: nextCol, opacity: 255 });
                    }
                }
            }

            return neighbors;
        };

        const renderFrame = () => {
            state.animId = 0;

            if (!canRender()) {
                return;
            }

            const { width, height, cell, numCols, numRows } = getGridMetrics();

            const pattern = drawBaseGrid(cell);
            if (!pattern) return;
            ctx.fillStyle = pattern;

            // Dirty-rect restore: paint grid only under previously drawn cells
            // instead of clearing + drawImage the full canvas each frame.
            for (const { col, row } of state.dirtyCells) {
                const x = col * cell - 1;
                const y = row * cell - 1;
                const w = cell + 2;
                const h = cell + 2;
                ctx.clearRect(x, y, w, h);
                ctx.fillRect(x, y, w, h);
            }
            state.dirtyCells = [];

            const { r, g, b } = colorRef.current;
            const { mouseX, mouseY } = state;

            if (mouseX >= 0 && mouseX <= width && mouseY >= 0 && mouseY <= height) {
                const col = Math.max(0, Math.min(numCols - 1, Math.floor(mouseX / cell)));
                const row = Math.max(0, Math.min(numRows - 1, Math.floor(mouseY / cell)));

                if (row !== state.currentRow || col !== state.currentCol) {
                    state.currentRow = row;
                    state.currentCol = col;
                    state.neighbors.push(...getRandomNeighbors(row, col, numRows, numCols));
                }

                ctx.strokeStyle = `rgba(${r},${g},${b},${(STARTING_ALPHA / 255).toFixed(3)})`;
                ctx.strokeRect(col * cell, row * cell, cell, cell);
                state.dirtyCells.push({ col, row });
            }

            for (const neighbor of state.neighbors) {
                neighbor.opacity = Math.max(0, neighbor.opacity - FADE_PER_FRAME);
                if (neighbor.opacity > 0) {
                    ctx.strokeStyle = `rgba(${r},${g},${b},${(neighbor.opacity / 255).toFixed(3)})`;
                    ctx.strokeRect(neighbor.col * cell, neighbor.row * cell, cell, cell);
                    state.dirtyCells.push({ col: neighbor.col, row: neighbor.row });
                }
            }

            state.neighbors = state.neighbors.filter((neighbor) => neighbor.opacity > 0);

            if (state.neighbors.length > 0) {
                state.animId = requestAnimationFrame(renderFrame);
            }
        };

        const scheduleRender = () => {
            if (state.animId || !canRender()) return;
            state.animId = requestAnimationFrame(renderFrame);
        };

        const renderOnce = () => {
            cancelScheduledFrame();
            if (!canRender()) return;
            syncSize();
            renderFrame();
        };

        const handlePointerMove = (e: PointerEvent) => {
            // Rect en cache (cf. refreshContainerRect) au lieu d'un
            // getBoundingClientRect() par mouvement de souris : cet handler
            // peut tirer des dizaines de fois/seconde, un layout read à chaque
            // fois serait un forced reflow répété sur toute la page.
            state.mouseX = e.clientX - containerRect.left;
            state.mouseY = (e.clientY - containerRect.top) - windowTop;
            scheduleRender();
        };

        const handlePointerLeave = () => {
            state.mouseX = OFFSCREEN_COORD;
            state.mouseY = OFFSCREEN_COORD;
            state.currentRow = -2;
            state.currentCol = -2;
            renderOnce();
        };

        const handlePointerDown = (e: PointerEvent) => {
            if (e.button !== 0) return;

            const target = e.target as HTMLElement | null;
            if (
                target &&
                target !== container &&
                target.closest(
                    'a, button, input, textarea, select, label, canvas, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [role="checkbox"], [role="radio"], [role="switch"], [role="slider"], [contenteditable="true"], [data-interactive]',
                )
            ) {
                return;
            }

            // Rect en cache + compensation de la fenêtre canvas (cf.
            // handlePointerMove) plutôt qu'un getBoundingClientRect() direct.
            const mouseX = e.clientX - containerRect.left;
            const mouseY = (e.clientY - containerRect.top) - windowTop;
            if (mouseX < 0 || mouseX > logicalWidth || mouseY < 0 || mouseY > logicalHeight) return;

            const cell = squareSizeRef.current;
            const numCols = Math.ceil(logicalWidth / cell);
            const numRows = Math.ceil(logicalHeight / cell);
            const col = Math.max(0, Math.min(numCols - 1, Math.floor(mouseX / cell)));
            const row = Math.max(0, Math.min(numRows - 1, Math.floor(mouseY / cell)));

            for (let i = 0; i < EXPLOSION_PARTICLES; i++) {
                const angle = Math.random() * Math.PI * 2;
                const distance = Math.random() * (EXPLOSION_RADIUS - 1) + 1;
                const nextRow = Math.round(row + distance * Math.sin(angle));
                const nextCol = Math.round(col + distance * Math.cos(angle));

                if (nextRow >= 0 && nextRow < numRows && nextCol >= 0 && nextCol < numCols) {
                    state.neighbors.push({ row: nextRow, col: nextCol, opacity: 255 });
                }
            }

            state.mouseX = mouseX;
            state.mouseY = mouseY;
            scheduleRender();
        };

        const handleVisibilityChange = () => {
            state.isDocumentVisible = !document.hidden;

            if (state.isDocumentVisible) {
                renderOnce();
            } else {
                cancelScheduledFrame();
            }
        };

        const viewportObserver = typeof IntersectionObserver === 'undefined'
            ? null
            : new IntersectionObserver((entries) => {
                const entry = entries[0];
                if (!entry) return;

                state.isInViewport = entry.isIntersecting;
                if (state.isInViewport) {
                    renderOnce();
                } else {
                    cancelScheduledFrame();
                }
            }, { threshold: 0.01 });

        // rAF-throttle du rafraîchissement du rect : au plus une fois par
        // frame pendant un scroll/resize, jamais par event brut.
        let rectRafId = 0;
        const scheduleRectRefresh = () => {
            if (rectRafId) return;
            rectRafId = requestAnimationFrame(() => {
                rectRafId = 0;
                refreshContainerRect();
                // No-op si les dimensions n'ont pas changé (guard interne) :
                // couvre le cas resize fenêtre (innerHeight change le calcul du
                // cap) sans coût significatif pendant un simple scroll.
                syncSize();
                updateCanvasWindow();
            });
        };

        // Debounce (~150ms) : sur Home, les LazySection montent des rows en
        // rafale pendant le scroll, ce qui fait grandir le container et
        // déclenche le ResizeObserver en rafale. Sans debounce, chaque tick
        // relance un resize + repaint complet de la grille pendant le scroll —
        // exactement le moment où on veut le moins de travail main-thread.
        let resizeDebounceId: number | undefined;
        const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
            if (resizeDebounceId !== undefined) {
                window.clearTimeout(resizeDebounceId);
            }
            resizeDebounceId = window.setTimeout(() => {
                resizeDebounceId = undefined;
                refreshContainerRect();
                syncSize();
                updateCanvasWindow();
                renderOnce();
            }, RESIZE_REDRAW_DEBOUNCE_MS);
        });

        // Force un repaint complet de la grille au mount / quand l'effet
        // re-run (squareSize ou borderColor changés). syncSize ne repeint
        // que si les dimensions changent ; le rendu en dirty-rect ne couvre
        // que les cellules survolées. Sans ce paint forcé, un changement de
        // couleur ou de taille en live laisse l'ancienne grille à l'écran.
        const forceFullPaint = () => {
            const width = logicalWidth;
            const height = logicalHeight;
            if (width <= 0 || height <= 0) return;
            const cell = squareSizeRef.current;
            // Invalide le cache pour que drawBaseGrid utilise la nouvelle couleur.
            gridCache.signature = '';
            const pattern = drawBaseGrid(cell);
            if (pattern) {
                ctx.clearRect(0, 0, width, height);
                ctx.fillStyle = pattern;
                ctx.fillRect(0, 0, width, height);
            }
            state.dirtyCells = [];
        };

        refreshContainerRect();
        syncSize();
        updateCanvasWindow();
        forceFullPaint();
        renderOnce();

        resizeObserver?.observe(container);
        viewportObserver?.observe(container);
        container.addEventListener('pointermove', handlePointerMove, { passive: true });
        container.addEventListener('pointerleave', handlePointerLeave);
        container.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('visibilitychange', handleVisibilityChange);
        // Repositionne la fenêtre canvas pendant le scroll (throttlé rAF) ;
        // resize fenêtre = window.innerHeight change, ce qui affecte le calcul
        // de windowHeight/windowTop indépendamment du ResizeObserver (qui, lui,
        // observe la boîte du container, pas le viewport).
        window.addEventListener('scroll', scheduleRectRefresh, { passive: true });
        window.addEventListener('resize', scheduleRectRefresh, { passive: true });

        return () => {
            cancelScheduledFrame();
            if (rectRafId) {
                cancelAnimationFrame(rectRafId);
            }
            if (resizeDebounceId !== undefined) {
                window.clearTimeout(resizeDebounceId);
            }
            resizeObserver?.disconnect();
            viewportObserver?.disconnect();
            container.removeEventListener('pointermove', handlePointerMove);
            container.removeEventListener('pointerleave', handlePointerLeave);
            container.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('scroll', scheduleRectRefresh);
            window.removeEventListener('resize', scheduleRectRefresh);
            // Le mode léger doit aussi libérer les buffers conservés hors DOM.
            canvas.width = 0;
            canvas.height = 0;
            canvas.style.width = '';
            canvas.style.height = '';
            if (gridCache.canvas) {
                gridCache.canvas.width = 0;
                gridCache.canvas.height = 0;
            }
            gridCache.canvas = null;
            gridCache.pattern = null;
            gridCache.signature = '';
            state.neighbors = [];
            state.dirtyCells = [];
            state.currentRow = -2;
            state.currentCol = -2;
        };
    }, [showCanvas, squareSize, borderColor]);

    return (
        <div
            ref={containerRef}
            className={cn('relative overflow-hidden bg-black', className)}
            // Thème Halloween : fond rendu transparent (halloween-ui.css)
            // pour laisser voir le décor peint derrière le site.
            data-square-bg=""
            {...props}
        >
            {showCssGrid && (
                <div
                    className="absolute inset-0 z-0 pointer-events-none"
                    style={{
                        backgroundImage: `
                            linear-gradient(${borderColor} 1px, transparent 1px),
                            linear-gradient(to right, ${borderColor} 1px, transparent 1px)
                        `,
                        backgroundSize: `${squareSize}px ${squareSize}px`,
                    }}
                />
            )}

            {showCanvas && (
                <canvas
                    ref={canvasRef}
                    className="absolute inset-0 z-0 pointer-events-none"
                    style={{ opacity: 0.3 }}
                />
            )}

            {showHalo && (
                <div
                    ref={haloRef}
                    className="square-bg-halo absolute z-[1] pointer-events-none"
                    style={{
                        top: 0,
                        left: 0,
                        width: HALO_SIZE,
                        height: HALO_SIZE,
                        transform: `translate(${HALO_HIDDEN_TRANSLATE}px, ${HALO_HIDDEN_TRANSLATE}px)`,
                        background: `radial-gradient(circle at center, ${borderColor.replace(/[\d.]+\)$/, '0.15)')} 0%, transparent 70%)`,
                        willChange: 'transform',
                    }}
                />
            )}

            <div className="relative z-10 w-full h-full">
                {children}
            </div>
        </div>
    );
};
