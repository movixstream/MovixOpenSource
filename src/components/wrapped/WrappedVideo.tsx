import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Download, Loader2, Pause, Play, Share2, Volume2, VolumeX, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useIsPresent } from 'framer-motion';
import { toast } from 'sonner';
import type { WrappedShareCardData, WrappedThemeId } from '@/types/wrapped';
import { Checkbox } from '@/components/ui/checkbox';
import WrappedThemePicker from './WrappedThemePicker';
import { SmoothRange } from '@/components/ui/SmoothRange';
import { prepareWrappedScore, startWrappedScore } from '@/utils/wrappedVideoAudio';
import { ensureShareFonts, loadCanvasImage } from '@/utils/wrappedCanvas';
import { drawWrappedVideoFrame, WRAPPED_VIDEO_SIZE, type WrappedVideoImages, type WrappedVideoTexts } from '@/utils/wrappedVideo';
import { buildWrappedVideoTimeline, DEFAULT_WRAPPED_VIDEO_OPTIONS, getEffectiveWrappedVideoOptions, normalizeWrappedVideoOptions, WRAPPED_VIDEO_DURATION, WRAPPED_VIDEO_FPS, type WrappedVideoOptions } from '@/utils/wrappedVideoTimeline';

type FinalVideo = { blob: Blob; url: string; mime: string };
type EncodeState = 'idle' | 'encoding' | 'cancelled' | 'error';

function getSupportedMime() {
    if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement === 'undefined' || typeof HTMLCanvasElement.prototype.captureStream !== 'function') return null;
    return ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus']
        .find(mime => MediaRecorder.isTypeSupported(mime)) || null;
}

function extensionFor(mime: string) { return mime.startsWith('video/mp4') ? 'mp4' : 'webm'; }

function download(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = name;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export default function WrappedVideo({ data, theme, autoTheme, onTheme }: {
    data: WrappedShareCardData; theme?: WrappedThemeId; autoTheme?: WrappedThemeId; onTheme?: (id: WrappedThemeId) => void;
}) {
    const { t } = useTranslation();
    const present = useIsPresent();
    const optionsId = useId();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const imagesRef = useRef<WrappedVideoImages>(new Map());
    const previewRaf = useRef<number | null>(null);
    const previewAudio = useRef<AudioContext | null>(null);
    const previewVisibility = useRef<(() => void) | null>(null);
    const encodingAbort = useRef<AbortController | null>(null);
    const mountedRef = useRef(true);
    const sessionRef = useRef(0);
    const renderRef = useRef<(time: number) => void>(() => undefined);
    const finalUrlRef = useRef<string | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const [options, setOptions] = useState<WrappedVideoOptions>(DEFAULT_WRAPPED_VIDEO_OPTIONS);
    const [position, setPosition] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [imagesReady, setImagesReady] = useState(false);
    const [encodeState, setEncodeState] = useState<EncodeState>('idle');
    const [progress, setProgress] = useState(0);
    const [finalVideo, setFinalVideo] = useState<FinalVideo | null>(null);
    const [retryHidden, setRetryHidden] = useState(false);
    const [score, setScore] = useState<AudioBuffer | null>(null);
    const [scoreError, setScoreError] = useState(false);
    const [scoreRetry, setScoreRetry] = useState(0);

    useEffect(() => {
        if (!options.sound || score) return;
        let active = true;
        setScoreError(false);
        void prepareWrappedScore().then(buffer => { if (active) setScore(buffer); }).catch(() => { if (active) setScoreError(true); });
        return () => { active = false; };
    }, [options.sound, score, scoreRetry]);

    const texts = useMemo<WrappedVideoTexts>(() => ({
        intro: t('wrappedVideo.intro'), time: t('wrappedVideo.time'), titles: t('wrappedVideo.titles'),
        favorite: t('wrappedVideo.favorite'), portrait: t('wrappedVideo.portrait'), final: t('wrappedVideo.final'), missingPoster: t('wrappedVideo.missingPoster'),
    }), [t]);
    const hasSignature = Boolean(data.signatureScene);
    const effectiveOptions = useMemo(() => getEffectiveWrappedVideoOptions(options, data.items.length, hasSignature), [data.items.length, hasSignature, options]);
    const timeline = useMemo(() => buildWrappedVideoTimeline(effectiveOptions), [effectiveOptions]);
    const mime = useMemo(getSupportedMime, []);

    const render = useCallback((time: number) => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (ctx) drawWrappedVideoFrame(ctx, data, effectiveOptions, texts, imagesRef.current, time, timeline);
    }, [data, effectiveOptions, texts, timeline]);
    renderRef.current = render;

    const stopPreview = useCallback(() => {
        if (previewRaf.current !== null) cancelAnimationFrame(previewRaf.current);
        previewRaf.current = null;
        if (previewVisibility.current) document.removeEventListener('visibilitychange', previewVisibility.current);
        previewVisibility.current = null;
        previewAudio.current?.close().catch(() => undefined);
        previewAudio.current = null;
        if (mountedRef.current) setPlaying(false);
    }, []);

    const cancelEncoding = useCallback(() => encodingAbort.current?.abort(), []);

    useEffect(() => {
        if (present) return;
        // La scène reste peinte pendant sa sortie, mais son audio et sa capture
        // s'arrêtent dès la navigation ou le changement de profil.
        stopPreview(); cancelEncoding(); videoRef.current?.pause();
    }, [present, stopPreview, cancelEncoding]);

    const resetPreview = useCallback(() => {
        stopPreview();
        setPosition(0);
        render(0);
    }, [render, stopPreview]);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    useEffect(() => {
        setOptions(current => normalizeWrappedVideoOptions(current, data.items.length, Boolean(data.signatureScene)));
    }, [data]);

    useEffect(() => {
        let active = true;
        imagesRef.current = new Map();
        setImagesReady(false);
        // Les trois affiches de l'ouverture et l'image de fond du numéro 1.
        const urls = [...data.items.slice(0, 3).map(item => item.posterUrl), data.backdropUrl];
        void Promise.all([ensureShareFonts(), ...urls.map(async url => {
            if (!url) return;
            imagesRef.current.set(url, await loadCanvasImage(url));
        })]).finally(() => { if (active && mountedRef.current) { setImagesReady(true); renderRef.current(0); } });
        return () => { active = false; };
    }, [data]);

    useEffect(() => {
        sessionRef.current += 1;
        cancelEncoding();
        resetPreview();
        setRetryHidden(false);
        setEncodeState('idle');
        setProgress(0);
        if (finalUrlRef.current) URL.revokeObjectURL(finalUrlRef.current);
        finalUrlRef.current = null;
        setFinalVideo(null);
    }, [data, options, cancelEncoding, resetPreview]);

    useEffect(() => () => {
        stopPreview(); cancelEncoding();
        if (finalUrlRef.current) URL.revokeObjectURL(finalUrlRef.current);
        finalUrlRef.current = null;
    }, [cancelEncoding, stopPreview]);

    const toggle = (key: keyof WrappedVideoOptions) => {
        if (key === 'sound') return setOptions(value => ({ ...value, sound: !value.sound }));
        setOptions(value => {
            const effective = getEffectiveWrappedVideoOptions(value, data.items.length, hasSignature);
            const selected = Object.entries(effective).filter(([name, enabled]) => name !== 'sound' && enabled).map(([name]) => name);
            if (effective[key] && selected.length === 1) return value;
            return { ...value, [key]: !effective[key] };
        });
    };

    const playPreview = async () => {
        if (playing) return stopPreview();
        if (options.sound && !score) return;
        const startPosition = position >= WRAPPED_VIDEO_DURATION ? 0 : position;
        if (startPosition !== position) { setPosition(0); render(0); }
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches && position === 0) {
            setPosition(0); render(0);
        }
        const session = sessionRef.current;
        setPlaying(true);
        if (options.sound && typeof AudioContext !== 'undefined') {
            const context = new AudioContext();
            previewAudio.current = context;
            try {
                await context.resume();
                if (previewAudio.current !== context || sessionRef.current !== session || !mountedRef.current) return;
                if (document.hidden) { stopPreview(); return; }
                startWrappedScore(context, context.createMediaStreamDestination(), score!, true, startPosition);
            } catch { stopPreview(); setScoreError(true); return; }
        }
        const started = performance.now() - startPosition * 1000;
        const audioStarted = previewAudio.current ? previewAudio.current.currentTime + 0.015 - startPosition : null;
        previewVisibility.current = () => { if (document.hidden) stopPreview(); };
        document.addEventListener('visibilitychange', previewVisibility.current);
        let lastFrame = -1, lastUiTime = -1;
        const tick = (now: number) => {
            const time = Math.max(0, Math.min(WRAPPED_VIDEO_DURATION, audioStarted !== null && previewAudio.current ? previewAudio.current.currentTime - audioStarted : (now - started) / 1000));
            const frame = Math.floor(time * WRAPPED_VIDEO_FPS);
            if (frame !== lastFrame) { render(time); lastFrame = frame; }
            if (time - lastUiTime >= 0.1 || time >= WRAPPED_VIDEO_DURATION) { setPosition(time); lastUiTime = time; }
            if (time >= WRAPPED_VIDEO_DURATION) { stopPreview(); return; }
            previewRaf.current = requestAnimationFrame(tick);
        };
        previewRaf.current = requestAnimationFrame(tick);
    };

    const encode = async () => {
        const canvas = canvasRef.current;
        if (!canvas || !mime || !('captureStream' in canvas)) { setEncodeState('error'); return; }
        if (options.sound && !score) return;
        if (document.hidden) { setRetryHidden(true); return; }
        cancelEncoding();
        const controller = new AbortController();
        const session = sessionRef.current;
        const belongsToSession = () => mountedRef.current && sessionRef.current === session;
        const isCurrent = () => belongsToSession() && !controller.signal.aborted;
        encodingAbort.current = controller;
        stopPreview(); setEncodeState('encoding'); setProgress(0); setRetryHidden(false);
        // Chaque plan est tracé une fois avant la capture : glyphes et images sont prêts,
        // le premier passage d'une scène ne coûte pas d'image au fichier.
        timeline.forEach(beat => { render((beat.start + beat.end) / 2); render(Math.min(WRAPPED_VIDEO_DURATION, beat.start + 0.05)); });
        render(0);
        let stream: MediaStream | null = null;
        let audioContext: AudioContext | null = null;
        let disconnectMusic: (() => void) | null = null;
        let startMusic: (() => void) | null = null;
        const chunks: BlobPart[] = [];
        let recorder: MediaRecorder | null = null;
        let watchdog: ReturnType<typeof setTimeout> | null = null;
        let raf: number | null = null;
        let abortListener: (() => void) | null = null;
        let visibilityListener: (() => void) | null = null;
        let cleaned = false;
        const cleanup = () => {
            if (cleaned) return;
            cleaned = true;
            if (watchdog) clearTimeout(watchdog);
            if (raf !== null) cancelAnimationFrame(raf);
            if (abortListener) controller.signal.removeEventListener('abort', abortListener);
            if (visibilityListener) document.removeEventListener('visibilitychange', visibilityListener);
            if (recorder) { recorder.ondataavailable = null; recorder.onerror = null; recorder.onstop = null; }
            stream?.getTracks().forEach(track => track.stop());
            disconnectMusic?.(); audioContext?.close().catch(() => undefined);
            if (encodingAbort.current === controller) encodingAbort.current = null;
        };
        try {
            const captureStream = canvas.captureStream(WRAPPED_VIDEO_FPS);
            stream = captureStream;
            if (options.sound && typeof AudioContext !== 'undefined') {
                audioContext = new AudioContext();
                const destination = audioContext.createMediaStreamDestination();
                destination.stream.getAudioTracks().forEach(track => captureStream.addTrack(track));
                const resumeGuard = new Promise<never>((_, reject) => {
                    abortListener = () => reject(new DOMException('Cancelled', 'AbortError'));
                    visibilityListener = () => {
                        if (!document.hidden) return;
                        if (isCurrent()) setRetryHidden(true);
                        reject(new Error('Hidden document'));
                    };
                    controller.signal.addEventListener('abort', abortListener, { once: true });
                    document.addEventListener('visibilitychange', visibilityListener);
                    watchdog = setTimeout(() => reject(new Error('Encoding timeout')), 24_000);
                });
                await Promise.race([audioContext.resume(), resumeGuard]);
                if (controller.signal.aborted || !belongsToSession()) throw new DOMException('Cancelled', 'AbortError');
                if (watchdog) clearTimeout(watchdog);
                if (abortListener) controller.signal.removeEventListener('abort', abortListener);
                if (visibilityListener) document.removeEventListener('visibilitychange', visibilityListener);
                watchdog = null; abortListener = null; visibilityListener = null;
                startMusic = () => { disconnectMusic = startWrappedScore(audioContext!, destination, score!); };
            }
            const blob = await new Promise<Blob>((resolve, reject) => {
                // Le grain et les volets rapides demandent un débit plus généreux qu'un plan fixe.
                const activeRecorder = new MediaRecorder(captureStream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
                recorder = activeRecorder;
                let settled = false;
                const finish = (error?: Error, result?: Blob) => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    if (error) reject(error);
                    else if (result) resolve(result);
                    else reject(new Error('Empty video'));
                };
                const fail = (reason: Error) => {
                    finish(reason);
                    if (activeRecorder.state !== 'inactive') { try { activeRecorder.stop(); } catch { /* recorder already stopping */ } }
                };
                activeRecorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
                activeRecorder.onerror = () => fail(new Error('MediaRecorder error'));
                activeRecorder.onstop = () => {
                    const result = new Blob(chunks, { type: mime });
                    finish(result.size ? undefined : new Error('Empty video'), result);
                };
                const started = performance.now();
                const audioStarted = audioContext ? audioContext.currentTime + 0.015 : null;
                let lastFrame = -1, lastUiTime = -1;
                const tick = (now: number) => {
                    if (controller.signal.aborted) return;
                    if (document.hidden) { if (isCurrent()) setRetryHidden(true); fail(new Error('Hidden document')); return; }
                    // Le montage suit l'horloge audio quand le son est actif : une
                    // frame lente ne doit ni décaler le temps musical ni tronquer la piste.
                    const time = Math.max(0, Math.min(WRAPPED_VIDEO_DURATION, audioStarted !== null && audioContext ? audioContext.currentTime - audioStarted : (now - started) / 1000));
                    const frame = Math.floor(time * WRAPPED_VIDEO_FPS);
                    if (frame !== lastFrame) { render(time); lastFrame = frame; }
                    if (isCurrent() && (time - lastUiTime >= 0.1 || time >= WRAPPED_VIDEO_DURATION)) { setProgress(time / WRAPPED_VIDEO_DURATION); lastUiTime = time; }
                    if (time >= WRAPPED_VIDEO_DURATION) { activeRecorder.stop(); return; }
                    raf = requestAnimationFrame(tick);
                };
                abortListener = () => fail(new DOMException('Cancelled', 'AbortError'));
                visibilityListener = () => { if (document.hidden) { if (isCurrent()) setRetryHidden(true); fail(new Error('Hidden document')); } };
                controller.signal.addEventListener('abort', abortListener, { once: true });
                document.addEventListener('visibilitychange', visibilityListener);
                watchdog = setTimeout(() => fail(new Error('Encoding timeout')), 24_000);
                render(0);
                startMusic?.();
                activeRecorder.start(250);
                raf = requestAnimationFrame(tick);
            });
            if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
            if (!isCurrent()) return;
            if (finalUrlRef.current) URL.revokeObjectURL(finalUrlRef.current);
            const url = URL.createObjectURL(blob);
            finalUrlRef.current = url;
            setFinalVideo({ blob, url, mime });
            setEncodeState('idle'); setProgress(1);
        } catch (error) {
            if (belongsToSession()) {
                setEncodeState(controller.signal.aborted ? 'cancelled' : 'error');
                if (!(error instanceof DOMException && error.name === 'AbortError')) toast.error(t('wrappedVideo.exportError'));
            }
        } finally {
            cleanup();
            if (mountedRef.current && sessionRef.current === session) { render(0); setPosition(0); }
        }
    };

    const share = async () => {
        if (!finalVideo) return;
        const file = new File([finalVideo.blob], `movix-wrapped-${data.year}.${extensionFor(finalVideo.mime)}`, { type: finalVideo.mime });
        try {
            if (navigator.canShare?.({ files: [file] }) && navigator.share) await navigator.share({ title: t('wrapped.shareTitle', { year: data.year }), files: [file] });
            else { download(finalVideo.blob, file.name); toast.success(t('wrapped.imageShareFallback')); }
        } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) toast.error(t('wrapped.shareError')); }
    };

    return <section className="mx-auto w-full max-w-5xl space-y-5" aria-labelledby="wrapped-video-title">
        <header className="space-y-2"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--wrapped-accent)]">MOVIX</p><h2 id="wrapped-video-title" className="font-['Archivo_Black'] text-3xl tracking-[-0.035em] sm:text-4xl">{t('wrappedVideo.title')}</h2><p className="max-w-xl text-sm text-white/65">{t('wrappedVideo.caption')}</p></header>
        <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
            <div className="relative mx-auto w-full max-w-[300px]">
                <canvas ref={canvasRef} width={WRAPPED_VIDEO_SIZE.width} height={WRAPPED_VIDEO_SIZE.height} className="w-full rounded-xl shadow-[0_20px_44px_rgba(0,0,0,0.4)]" aria-label={t('wrappedVideo.previewAlt', { year: data.year })} />
                {/* Raccourci au pointeur ; le clavier et les lecteurs d'écran utilisent le bouton Lire. */}
                {!playing && imagesReady && encodeState !== 'encoding' && !(options.sound && !score) && <button type="button" onClick={playPreview} aria-hidden="true" tabIndex={-1}
                    className="group/play absolute inset-0 flex items-center justify-center rounded-xl">
                    <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/90 text-[#101318] shadow-[0_12px_32px_rgba(0,0,0,0.45)] transition-transform duration-150 group-hover/play:scale-105 group-active/play:scale-95 motion-reduce:transition-none"><Play className="ml-1 h-7 w-7" fill="currentColor" aria-hidden="true" /></span>
                </button>}
            </div>
            <div className="space-y-4">
                {theme && onTheme && <fieldset disabled={encodeState === 'encoding'}><WrappedThemePicker value={theme} auto={autoTheme || theme} onChange={onTheme} /></fieldset>}
                <fieldset disabled={encodeState === 'encoding'} className="grid grid-cols-2 gap-2"><legend className="mb-2 text-sm font-semibold">{t('wrappedVideo.include')}</legend>{([
                    ['watchTime', t('wrappedVideo.time')], ['titleCount', t('wrappedVideo.titles')],
                    // Le plan signature n'est proposé que si le profil en fournit un.
                    ...(data.signatureScene ? [['signature', data.signatureScene.title] as const] : []),
                    ['favorite', t('wrappedVideo.favorite')], ['portrait', t('wrappedVideo.portrait')],
                ] as const).map(([key, name]) => <label key={key} htmlFor={`${optionsId}-${key}`} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg bg-white/5 px-3 text-sm"><Checkbox id={`${optionsId}-${key}`} aria-label={name} checked={key === 'favorite' || key === 'signature' ? effectiveOptions[key] : options[key]} disabled={encodeState === 'encoding' || (key === 'favorite' && !data.items.length)} onCheckedChange={() => toggle(key)} className="shadow-none aria-checked:border-[var(--wrapped-accent)] aria-checked:bg-[var(--wrapped-accent)] focus-visible:ring-[var(--wrapped-accent)]" />{name}</label>)}
                    <label htmlFor={`${optionsId}-sound`} className="col-span-2 flex min-h-11 cursor-pointer items-center gap-3 rounded-lg bg-white/5 px-3 text-sm"><Checkbox id={`${optionsId}-sound`} aria-label={t('wrappedVideo.sound')} checked={options.sound} disabled={encodeState === 'encoding'} onCheckedChange={() => toggle('sound')} className="shadow-none aria-checked:border-[var(--wrapped-accent)] aria-checked:bg-[var(--wrapped-accent)] focus-visible:ring-[var(--wrapped-accent)]" />{options.sound ? <Volume2 className="h-4 w-4" aria-hidden="true" /> : <VolumeX className="h-4 w-4" aria-hidden="true" />}{t('wrappedVideo.sound')}</label></fieldset>
                {options.sound && !score && !scoreError && <p className="text-xs text-white/70" role="status">{t('wrappedVideo.musicLoading')}</p>}
                {options.sound && scoreError && <p className="text-sm text-amber-200" role="alert">{t('wrappedVideo.musicError')} <button type="button" onClick={() => { setScore(null); setScoreRetry(value => value + 1); }} className="min-h-11 underline">{t('wrappedStory.retry')}</button></p>}
                <div className="flex items-center gap-2"><button type="button" onClick={playPreview} disabled={!imagesReady || encodeState === 'encoding' || (options.sound && !score)} className="flex min-h-11 items-center gap-2 rounded-full bg-[var(--wrapped-accent)] px-4 text-sm font-bold text-[#17121f] disabled:opacity-40">{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}{playing ? t('wrappedVideo.pause') : t('wrappedVideo.play')}</button><span className="text-xs text-white/55">{position.toFixed(1)} / {WRAPPED_VIDEO_DURATION}s</span></div>
                <SmoothRange label={t('wrappedVideo.timeline')} min={0} max={WRAPPED_VIDEO_DURATION} keyboardStep={0.1} step={0.1} value={position} animateExternalValue={false} accentColor="var(--wrapped-accent)" formatValue={value => `${value.toFixed(1)} / ${WRAPPED_VIDEO_DURATION} s`} disabled={encodeState === 'encoding' || !imagesReady} onPreview={value => { stopPreview(); setPosition(value); render(value); }} />
                {retryHidden && <p className="text-sm text-amber-200" role="alert">{t('wrappedVideo.hiddenRetry')}</p>}
                {!mime && <p className="text-sm text-amber-200" role="alert">{t('wrappedVideo.unsupported')}</p>}
                <div className="flex flex-wrap gap-2"><button type="button" onClick={() => void encode()} disabled={!imagesReady || !mime || encodeState === 'encoding' || (options.sound && !score)} className="flex min-h-11 items-center gap-2 rounded-full bg-white px-4 text-sm font-bold text-[#17121f] disabled:opacity-40">{encodeState === 'encoding' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}{encodeState === 'encoding' ? `${t('wrappedVideo.generating')} ${Math.round(progress * 100)}%` : t('wrappedVideo.generate')}</button>{encodeState === 'encoding' && <button type="button" onClick={cancelEncoding} className="flex min-h-11 items-center gap-2 rounded-full border border-white/20 px-4 text-sm"><X className="h-4 w-4" />{t('wrappedVideo.cancel')}</button>}</div>
                {encodeState === 'error' && <p className="text-sm text-red-200" role="alert">{t('wrappedVideo.exportError')}</p>}
                {finalVideo && <div className="space-y-3"><video ref={videoRef} src={finalVideo.url} controls playsInline className="w-full max-w-sm rounded-lg" /><div className="flex gap-2"><button type="button" onClick={share} className="flex min-h-11 items-center gap-2 rounded-full bg-[var(--wrapped-accent)] px-4 text-sm font-bold text-[#17121f]"><Share2 className="h-4 w-4" />{t('wrappedStory.share')}</button><button type="button" onClick={() => download(finalVideo.blob, `movix-wrapped-${data.year}.${extensionFor(finalVideo.mime)}`)} className="flex min-h-11 items-center gap-2 rounded-full border border-white/20 px-4 text-sm"><Download className="h-4 w-4" />{t('wrappedStory.download')}</button></div></div>}
            </div>
        </div>
    </section>;
}
