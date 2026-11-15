import { useEffect, useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import type { WrappedData } from '@/services/wrappedService';
import { wrappedRaceFrames } from '@/utils/wrappedStory';
import { formatWrappedDuration, wrappedMediaKey, wrappedMonth } from '@/utils/wrappedPresentation';
import { WRAPPED_EASE_MORPH, WRAPPED_FRAME_ANIMATION } from '@/utils/wrappedMotion';
import WrappedPoster from './WrappedPoster';
import WrappedReveal from './WrappedReveal';
import { SmoothRange } from '@/components/ui/SmoothRange';

const COLORS = ['#deff91', '#d7c5ff', '#ffb196', '#c6fbeb', '#f4efe6'];
// Comme le « Top Artist Sprint » de Spotify : la course part seule, laisse le titre apparaître, puis avance d'un mois à la fois.
const START_DELAY = 900;
const STEP = 850;

export default function WrappedRace({ data, onExplore }: { data: WrappedData; onExplore: (active: boolean) => void }) {
    const { t, i18n } = useTranslation();
    const reduced = useReducedMotion();
    const frames = useMemo(() => wrappedRaceFrames(data).filter(frame => frame.entries[0]?.minutes > 0), [data]);
    // Sans animation, on montre directement l'arrivée.
    const [index, setIndex] = useState(() => reduced ? Math.max(0, frames.length - 1) : 0);
    const [manual, setManual] = useState(false);
    const last = frames.length - 1;
    const finished = manual || index >= last;
    const current = frames[Math.min(index, last)];
    useEffect(() => {
        if (reduced || manual || index >= last) return;
        const timer = setTimeout(() => setIndex(value => value + 1), index === 0 ? START_DELAY + STEP : STEP);
        return () => clearTimeout(timer);
    }, [reduced, manual, index, last]);
    if (!current) return null;
    const max = Math.max(1, ...current.entries.map(entry => entry.minutes));
    const select = (value: number) => { setIndex(Math.max(0, Math.min(last, value))); setManual(true); onExplore(true); };
    const replay = () => { setIndex(0); setManual(false); onExplore(false); };
    const crowned = index >= last && !manual;

    return <section className="mx-auto w-full max-w-[1000px] space-y-5" data-wrapped-interactive>
        <WrappedReveal axis="x" distance={-24} delay={0.2}><header className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-xl space-y-3"><h2 className="font-['Archivo_Black'] text-3xl leading-tight tracking-tight lg:text-5xl">{t('wrappedMotion.raceTitle')}</h2><p className="text-sm leading-relaxed text-white/70">{t('wrappedMotion.raceCaption')}</p></div>
            <motion.output key={current.month} initial={reduced ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : 0.3 }} className="font-['Archivo_Black'] text-3xl capitalize text-[var(--wrapped-accent)]" aria-live={finished ? 'polite' : 'off'}>{wrappedMonth(current.month, i18n.language)}</motion.output>
        </header></WrappedReveal>
        <div className="relative" style={{ height: current.entries.length * 64 }} role="list" aria-label={t('wrappedMotion.raceRanking')}>
            {current.entries.map((entry, rank) => {
                const winner = crowned && rank === 0;
                return <motion.div {...WRAPPED_FRAME_ANIMATION} key={wrappedMediaKey(entry.item)} role="listitem" className="absolute left-0 top-0 flex h-[58px] w-full items-center gap-3 sm:gap-5"
                    initial={false} animate={{ transform: `translateY(${rank * 64}px)` }} transition={{ duration: reduced ? 0 : 0.65, ease: [...WRAPPED_EASE_MORPH] }}>
                    <span className="w-5 shrink-0 text-sm tabular-nums text-white/65">{rank + 1}</span>
                    <motion.div className="w-9 shrink-0 rounded-md" initial={false} animate={{ scale: winner && !reduced ? 1.12 : 1, boxShadow: winner ? '0 0 0 2px var(--wrapped-accent)' : '0 0 0 0px transparent' }} transition={{ duration: reduced ? 0 : 0.4 }}><WrappedPoster item={entry.item} className="w-9" /></motion.div>
                    <div className="min-w-0 flex-1"><div className="mb-2 flex items-baseline justify-between gap-3"><p className="truncate text-sm font-semibold sm:text-base">{entry.item.title}{winner && <motion.span initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} className="ml-2 text-xs font-normal text-[var(--wrapped-accent)]">{t('wrappedMotion.raceWinner')}</motion.span>}</p><span className="shrink-0 text-xs tabular-nums text-white/75">{formatWrappedDuration(entry.minutes, i18n.language)}</span></div>
                        <div className="h-3 overflow-hidden rounded-full bg-white/10"><motion.div {...WRAPPED_FRAME_ANIMATION} className="h-full origin-left rounded-full" style={{ backgroundColor: COLORS[entry.index % COLORS.length] }} initial={reduced ? false : { transform: 'scaleX(0)' }} animate={{ transform: `scaleX(${entry.minutes / max})` }} transition={{ duration: reduced ? 0 : 0.65, ease: [...WRAPPED_EASE_MORPH] }} /></div>
                    </div>
                </motion.div>;
            })}
        </div>
        {finished ? <div className="space-y-2">
            <p className="text-xs text-white/75">{t('wrappedMotion.scrubRace')}</p>
            <SmoothRange label={t('wrappedMotion.scrubRace')} min={0} max={last} keyboardStep={1} step={1} value={index} animateExternalValue={false} accentColor="var(--wrapped-accent)" formatValue={value => wrappedMonth(frames[Math.round(value)]?.month || current.month, i18n.language)} onPreview={select} onFocus={() => onExplore(true)} onBlur={() => onExplore(false)} />
            <div className="flex justify-between text-xs capitalize text-white/60"><span>{wrappedMonth(frames[0].month, i18n.language)}</span><span>{wrappedMonth(frames[last].month, i18n.language)}</span></div>
            {!reduced && <button type="button" onClick={replay} className="min-h-11 text-sm underline underline-offset-4">{t('wrappedMotion.replayRace')}</button>}
        </div> : <div className="h-1 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
            <motion.div className="h-full origin-left rounded-full bg-[var(--wrapped-accent)]" initial={false} animate={{ transform: `scaleX(${last > 0 ? index / last : 1})` }} transition={{ duration: STEP / 1000, ease: 'linear' }} />
        </div>}
    </section>;
}
