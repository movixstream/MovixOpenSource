import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { AnimatePresence, LayoutGroup, motion, useMotionValue, useReducedMotion } from 'framer-motion';
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, Pause, Play, RotateCcw, Share2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { WrappedData } from '@/services/wrappedService';
import { DEFAULT_PUBLIC_DOMAIN } from '@/i18n/currentDomain';
import { buildWrappedShareData, getWrappedScenes, wrappedGesture, wrappedImageUrl } from '@/utils/wrappedPresentation';
import WrappedDetails from './WrappedDetails';
import WrappedSceneViewport from './WrappedSceneViewport';
import WrappedScenes from './WrappedScenes';
import WrappedShare from './WrappedShare';
import WrappedTransitionLayer from './WrappedTransitionLayer';
import WrappedPosterFlights from './WrappedPosterFlights';
import { wrappedTransition, wrappedTransitionDuration } from '@/utils/wrappedMotion';
import { generateWrappedShareCard } from '@/utils/wrappedShareCards';
import type { WrappedShareCardData, WrappedThemeId } from '@/types/wrapped';
import '@fontsource/archivo-black/latin-400.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-600.css';
import './wrapped.css';

const SCENE_TONES: Record<string, { background: string; accent: string }> = {
    intro: { background: '#101318', accent: '#a9dfff' },
    time: { background: '#101620', accent: '#9fcaff' },
    timeline: { background: '#101620', accent: '#a9dfff' },
    genres: { background: '#11151c', accent: '#c0d9ff' },
    quiz: { background: '#181714', accent: '#f4cc83' },
    favorite: { background: '#181714', accent: '#f4cc83' },
    'top-five': { background: '#101318', accent: '#a9dfff' },
    rhythm: { background: '#101620', accent: '#a9dfff' },
    community: { background: '#101620', accent: '#c0d9ff' },
    persona: { background: '#101318', accent: '#a9dfff' },
    closing: { background: '#181714', accent: '#f4cc83' },
    race: { background: '#101318', accent: '#a9dfff' },
    eras: { background: '#11151c', accent: '#c0d9ff' },
    awards: { background: '#101318', accent: '#a9dfff' },
};

export default function WrappedExperience({ data, onClose }: { data: WrappedData; onClose: () => void }) {
    const { t, i18n } = useTranslation();
    const reducedMotion = useReducedMotion();
    const mainRef = useRef<HTMLElement | null>(null);
    const scenes = useMemo(() => getWrappedScenes(data), [data]);
    const [index, setIndex] = useState(0);
    const [direction, setDirection] = useState(1);
    const [picked, setPicked] = useState<string | null>(null);
    const [preparedStory, setPreparedStory] = useState<{ data: WrappedShareCardData; blob: Blob } | null>(null);
    const [transitioning, setTransitioning] = useState(false);
    const [navigation, setNavigation] = useState({ id: 0, from: 'intro', to: 'intro', direction: 1 });
    const currentIndex = useRef(0);
    const requestedIndex = useRef(0);
    const busy = useRef(false);
    const layoutId = useId();
    const [playing, setPlaying] = useState(false);
    const [holding, setHolding] = useState(false);
    const [details, setDetails] = useState(false);
    const [exploring, setExploring] = useState(false);
    const [overflowing, setOverflowing] = useState(false);
    const [moreBelow, setMoreBelow] = useState(false);
    const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
    const elapsed = useRef(0);
    const gesture = useRef<{ id: number; x: number; y: number; started: number } | null>(null);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const progress = useMotionValue(0);
    const scene = scenes[index] || scenes[0];
    const activeScene = useRef(scene);
    activeScene.current = scene;
    const duration = scene === 'race' ? 14000 : ['top-five', 'timeline', 'time', 'genres', 'rhythm', 'eras', 'community'].includes(scene) ? 10000 : 7000;
    const automatic = playing && visible && !holding && !details && !exploring && !overflowing && !transitioning && !['intro', 'quiz', 'closing'].includes(scene);
    const transitionKind = wrappedTransition(navigation.from, navigation.to, navigation.direction);
    const tone = SCENE_TONES[scene] || SCENE_TONES.intro;
    const profileShareData = useMemo(() => buildWrappedShareData(data, i18n.language, t, DEFAULT_PUBLIC_DOMAIN), [data, i18n.language, t]);
    // L'ambiance vient du profil ; un choix explicite la remplace pour le film et les images.
    const [themeChoice, setThemeChoice] = useState<WrappedThemeId | null>(null);
    const autoTheme = profileShareData.theme || 'electric';
    const shareData = useMemo(() => themeChoice && themeChoice !== profileShareData.theme ? { ...profileShareData, theme: themeChoice } : profileShareData, [profileShareData, themeChoice]);
    const iconButton = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-30';

    useEffect(() => {
        const main = mainRef.current;
        if (!main) return;
        const previousFocus = document.activeElement as HTMLElement | null;
        const outside: [HTMLElement, boolean][] = [];
        for (let element: HTMLElement | null = main; element?.parentElement && element !== document.body; element = element.parentElement) {
            for (const sibling of element.parentElement.children) {
                if (sibling !== element && sibling instanceof HTMLElement && !['SCRIPT', 'STYLE'].includes(sibling.tagName)) {
                    outside.push([sibling, sibling.inert]);
                    sibling.inert = true;
                }
            }
        }
        const overflow = document.documentElement.style.overflow;
        document.documentElement.style.overflow = 'hidden';
        main.focus({ preventScroll: true });
        const containFocus = (event: KeyboardEvent) => {
            if (event.key !== 'Tab') return;
            const focusable = [...main.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), summary, [tabindex="0"]')]
                .filter(element => !element.closest('[inert]') && element.getClientRects().length > 0);
            const first = focusable[0], last = focusable[focusable.length - 1];
            if (event.shiftKey && (document.activeElement === first || document.activeElement === main)) {
                event.preventDefault(); last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault(); first?.focus();
            }
        };
        main.addEventListener('keydown', containFocus);
        return () => {
            main.removeEventListener('keydown', containFocus);
            outside.forEach(([element, inert]) => { element.inert = inert; });
            document.documentElement.style.overflow = overflow;
            if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
        };
    }, []);

    useEffect(() => {
        let active = true;
        setPreparedStory(null);
        void generateWrappedShareCard(shareData, 'story').then(blob => { if (active) setPreparedStory({ data: shareData, blob }); }).catch(() => undefined);
        return () => { active = false; };
    }, [shareData]);

    const startTransition = useCallback((next: number) => {
        const previous = currentIndex.current;
        if (previous === next) return;
        const way = next > previous ? 1 : -1;
        busy.current = true;
        setTransitioning(true);
        setDirection(way);
        setNavigation(current => ({ id: current.id + 1, from: scenes[previous], to: scenes[next], direction: way }));
        currentIndex.current = next;
        setIndex(next);
    }, [scenes]);

    const requestIndex = useCallback((next: number) => {
        requestedIndex.current = Math.max(0, Math.min(scenes.length - 1, next));
        if (!busy.current) startTransition(requestedIndex.current);
    }, [scenes.length, startTransition]);

    const move = useCallback((step: number) => {
        requestIndex(requestedIndex.current + step);
    }, [requestIndex]);

    useEffect(() => {
        if (!navigation.id) return;
        const timer = setTimeout(() => {
            busy.current = false;
            setTransitioning(false);
            if (requestedIndex.current !== currentIndex.current) startTransition(requestedIndex.current);
        }, wrappedTransitionDuration(transitionKind, Boolean(reducedMotion)) * 1000 + 30);
        return () => clearTimeout(timer);
    }, [navigation.id, transitionKind, reducedMotion, startTransition]);

    useEffect(() => {
        currentIndex.current = 0;
        requestedIndex.current = 0;
        busy.current = false;
        setIndex(0); setPicked(null); setPlaying(false); setDetails(false); setTransitioning(false); setThemeChoice(null);
        setNavigation({ id: 0, from: 'intro', to: 'intro', direction: 1 });
    }, [data]);

    useEffect(() => {
        const changed = () => setVisible(document.visibilityState !== 'hidden');
        document.addEventListener('visibilitychange', changed);
        return () => document.removeEventListener('visibilitychange', changed);
    }, []);

    useEffect(() => {
        elapsed.current = 0;
        progress.set(0);
        setHolding(false);
        gesture.current = null;
        scrollRef.current?.scrollTo({ top: 0, behavior: 'instant' });
    }, [scene, progress, details]);

    const attachViewport = useCallback((viewport: HTMLDivElement) => {
        scrollRef.current = viewport;
        setExploring(false);
    }, []);
    const measureViewport = useCallback((viewport: HTMLDivElement, contentHeight: number) => {
        if (scrollRef.current !== viewport) return;
        setOverflowing(contentHeight > viewport.clientHeight + 8);
        setMoreBelow(contentHeight - viewport.clientHeight - viewport.scrollTop > 8);
    }, []);
    const reportExploration = useCallback((key: string, active: boolean) => {
        if (activeScene.current === key) setExploring(active);
    }, []);

    useEffect(() => {
        if (overflowing) setPlaying(false);
    }, [overflowing]);

    useEffect(() => {
        if (!automatic) return;
        let frame = 0;
        let last = performance.now();
        const tick = (now: number) => {
            elapsed.current += now - last;
            last = now;
            progress.set(Math.min(1, elapsed.current / duration));
            if (elapsed.current >= duration) move(1);
            else frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [automatic, duration, move, progress, scene]);

    useEffect(() => {
        if (reducedMotion) setPlaying(false);
    }, [reducedMotion]);

    useEffect(() => {
        // Les métadonnées restent attachées à leur entrée, sans Map partagée entre médias.
        const images = [
            ...data.topContent.slice(0, 5).map(item => wrappedImageUrl(item.poster_path)),
            ...(data.community?.topTitles || []).map(item => wrappedImageUrl(item.poster_path)),
            wrappedImageUrl(data.topContent[0]?.backdrop_path, 'w1280'),
        ];
        const preload = images.filter((src): src is string => Boolean(src)).map(src => {
            const image = new Image();
            image.decoding = 'async';
            image.src = src;
            return image;
        });
        return () => preload.forEach(image => image.removeAttribute('src'));
    }, [data]);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            if (event.repeat || event.defaultPrevented) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                if (details) setDetails(false); else onClose();
                return;
            }
            if (target?.closest('input,textarea,select,[contenteditable="true"],[data-wrapped-interactive]')) return;
            if (!details && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
                event.preventDefault();
                move(event.key === 'ArrowRight' ? 1 : -1);
            } else if (!details && event.key === ' ' && !target?.closest('button,a')) {
                event.preventDefault();
                if (scene === 'intro') move(1);
                setPlaying(value => !value);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [details, move, onClose, scene]);

    const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
        if (details || scene === 'closing' || scene === 'quiz' || event.button !== 0 || !event.isPrimary) return;
        if (event.target instanceof Element && event.target.closest('button,a,input,select,textarea,[data-wrapped-interactive]')) return;
        gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, started: performance.now() };
        setHolding(true);
        event.currentTarget.setPointerCapture(event.pointerId);
    };
    const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
        const start = gesture.current;
        gesture.current = null;
        setHolding(false);
        if (!start || start.id !== event.pointerId) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const step = wrappedGesture(event.clientX - start.x, event.clientY - start.y, performance.now() - start.started, (event.clientX - bounds.left) / bounds.width);
        if (step) move(step);
    };
    const cancelGesture = () => { gesture.current = null; setHolding(false); };
    const backdrop = scene === 'favorite' ? wrappedImageUrl(data.topContent[0]?.backdrop_path, 'w1280') : null;

    return (
        <LayoutGroup id={layoutId}><main ref={mainRef} tabIndex={-1} data-wrapped-experience data-lenis-prevent className="fixed inset-0 z-50 flex h-[100dvh] items-center justify-center bg-[#080a0b] font-[Inter,Arial,sans-serif] text-[#f4efe6] outline-none sm:p-2 xl:p-3">
            <div className="relative flex h-full w-full max-w-[1440px] flex-col overflow-hidden transition-colors duration-500 sm:rounded-2xl motion-reduce:transition-none"
                style={{ '--wrapped-accent': tone.accent, '--wrapped-background': tone.background, backgroundColor: tone.background } as CSSProperties}>
                <header className="relative z-10 flex shrink-0 items-center justify-between gap-2 px-3 pt-[max(0.5rem,env(safe-area-inset-top))] lg:px-7 lg:pt-5">
                    <button type="button" onClick={details ? () => setDetails(false) : onClose} className={iconButton} aria-label={t(details ? 'wrappedStory.backToStory' : 'wrappedStory.close')}>
                        {details ? <ArrowLeft className="h-5 w-5 text-white opacity-90" /> : <X className="h-5 w-5 text-white opacity-90" />}
                    </button>
                    <p className="flex items-center gap-3 text-sm font-bold tracking-tight"><span className="font-['Archivo_Black']">MOVIX</span><span className="h-3 w-px bg-white/25" aria-hidden="true" /><span className="font-normal text-white/60">Wrapped {data.year}</span></p>
                    <button type="button" className={iconButton} aria-label={t('wrapped.shareWrapped')} onClick={() => { setDetails(false); requestIndex(scenes.length - 1); }}><Share2 className="h-5 w-5 text-white opacity-90" /></button>
                </header>
                {!details && <div className="relative z-10 flex shrink-0 gap-1.5 px-6 py-3 lg:px-10 lg:py-4" role="progressbar" aria-label={t('wrappedStory.progress')} aria-valuemin={1} aria-valuemax={scenes.length} aria-valuenow={index + 1}>
                    {scenes.map((item, i) => <div key={item} className={`h-[3px] flex-1 overflow-hidden rounded-full ${i === index ? 'bg-white/30' : 'bg-white/10'}`}><motion.div className="h-full origin-left bg-[var(--wrapped-accent)]" style={{ scaleX: i < index ? 1 : i === index ? progress : 0 }} /></div>)}
                </div>}
                <div className="sr-only" aria-live="polite" aria-atomic="true">{!details && t('wrappedStory.sceneAnnouncement', { current: index + 1, total: scenes.length, scene: t(`wrappedStory.scenes.${scene}`) })}</div>
                <div className="relative z-10 min-h-0 flex-1 overflow-hidden" onPointerDown={pointerDown} onPointerUp={pointerUp} onPointerCancel={cancelGesture} onLostPointerCapture={cancelGesture}>
                    {navigation.id > 0 && transitioning && <WrappedTransitionLayer key={navigation.id} kind={transitionKind} direction={direction} accent={tone.accent} reduced={Boolean(reducedMotion)} />}
                    <AnimatePresence mode="sync" initial={false} custom={{ direction, transitionKind: details ? 'fade' : transitionKind, reducedMotion: Boolean(reducedMotion) }}>
                        <WrappedSceneViewport key={details ? 'details' : scene} scene={details ? 'details' : scene} transitionKind={details ? 'fade' : transitionKind} direction={direction} reducedMotion={Boolean(reducedMotion)} tone={tone} backdrop={details ? null : backdrop} onViewport={attachViewport} onMeasure={measureViewport}>
                            {details ? <div className="mx-auto w-full max-w-3xl py-4"><WrappedDetails data={data} /></div> : scene === 'closing' ? <WrappedShare data={shareData} preparedStory={preparedStory?.data === shareData ? preparedStory.blob : undefined} favorite={data.topContent[0]} onDetails={() => setDetails(true)} theme={shareData.theme || autoTheme} autoTheme={autoTheme} onTheme={setThemeChoice} /> : <WrappedScenes scene={scene} data={data} picked={picked} onPick={setPicked} assembleQuiz={transitionKind === 'gallery'} onExplore={active => reportExploration(scene, active)} onNext={() => move(1)} onStart={() => { setPlaying(!reducedMotion); move(1); }} />}
                        </WrappedSceneViewport>
                    </AnimatePresence>
                    {navigation.id > 0 && transitioning && !details && <WrappedPosterFlights key={navigation.id} from={navigation.from} to={navigation.to} kind={transitionKind} reduced={Boolean(reducedMotion)} />}
                </div>
                <footer className="relative z-10 flex shrink-0 items-center justify-between gap-3 px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 lg:px-7 lg:pb-5">
                    {details ? <button type="button" onClick={() => setDetails(false)} className="min-h-11 px-2 text-sm underline underline-offset-4">{t('wrappedStory.backToStory')}</button> : <>
                        <button type="button" className={iconButton} disabled={index === 0} onClick={() => move(-1)} aria-label={t('wrappedStory.previous')}><ChevronLeft className="h-6 w-6 text-white opacity-90" /></button>
                        {overflowing && moreBelow ? <button type="button" className="flex min-h-11 items-center gap-2 text-xs text-white/70 sm:text-sm" onClick={() => scrollRef.current?.scrollBy({ top: scrollRef.current.clientHeight * 0.65, behavior: reducedMotion ? 'instant' : 'smooth' })}><ChevronDown className="h-4 w-4 text-white opacity-70" aria-hidden="true" />{t('wrappedCinema.scrollForMore')}</button> : scene === 'closing' ? <button type="button" className="flex min-h-11 items-center gap-2 text-sm" onClick={() => { setPicked(null); requestIndex(0); setPlaying(false); }}><RotateCcw className="h-4 w-4" aria-hidden="true" />{t('wrappedStory.replay')}</button> : <button type="button" className="flex min-h-11 items-center gap-2 px-3 text-xs text-white/70 sm:text-sm" aria-pressed={playing} disabled={scene === 'quiz' || overflowing} onClick={() => { if (scene === 'intro') move(1); setPlaying(value => !value); }}>
                            {scene !== 'quiz' && (playing ? <Pause className="h-4 w-4 text-white opacity-70" aria-hidden="true" /> : <Play className="h-4 w-4 text-white opacity-70" aria-hidden="true" />)}{t(scene === 'quiz' ? picked ? 'wrappedFinish.guessAnswered' : 'wrappedStory.quizPaused' : overflowing ? 'wrappedCinema.manualPlayback' : exploring && playing ? 'wrappedCinema.exploring' : playing ? 'wrappedStory.pause' : 'wrappedStory.play')}
                        </button>}
                        <span className="hidden text-xs tabular-nums text-white/60 lg:block">{String(index + 1).padStart(2, '0')} / {String(scenes.length).padStart(2, '0')}</span>
                        <button type="button" className={iconButton} disabled={index === scenes.length - 1} onClick={() => move(1)} aria-label={t('wrappedStory.next')}><ChevronRight className="h-6 w-6 text-white opacity-90" /></button>
                    </>}
                </footer>
            </div>
        </main></LayoutGroup>
    );
}
