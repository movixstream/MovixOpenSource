import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowUpRight, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { WrappedData } from '@/services/wrappedService';
import type { WrappedScene } from '@/types/wrapped';
import { formatWrappedDuration, wrappedDate, wrappedMediaKey, wrappedPeriod, wrappedPersona, wrappedTraits, wrappedTypeLabel } from '@/utils/wrappedPresentation';
import { wrappedStoryMode } from '@/utils/wrappedStory';
import WrappedPosterGallery from './WrappedPosterGallery';
import WrappedTimeline from './charts/WrappedTimeline';
import WrappedFormats from './charts/WrappedFormats';
import WrappedGenres from './charts/WrappedGenres';
import WrappedClock from './charts/WrappedClock';
import WrappedSignature from './WrappedSignature';
import WrappedCommunity from './WrappedCommunity';
import WrappedTilt from './WrappedTilt';
import WrappedPoster from './WrappedPoster';
import WrappedPodium from './WrappedPodium';
import WrappedRace from './WrappedRace';
import WrappedEras from './WrappedEras';
import WrappedReveal from './WrappedReveal';
import WrappedCountUp from './WrappedCountUp';
import { WRAPPED_EASE_MORPH, WRAPPED_FRAME_ANIMATION } from '@/utils/wrappedMotion';

function SceneLayout({ children, visual, wide = false }: { children: ReactNode; visual: ReactNode; wide?: boolean }) {
    return <div className={`wrapped-scene-layout grid w-full items-center gap-5 lg:grid-cols-[0.9fr_1.1fr] ${wide ? '' : 'mx-auto max-w-[1160px]'}`}>
        <WrappedReveal className="wrapped-scene-copy min-w-0 space-y-4" delay={0.26}>{children}</WrappedReveal>
        <div className="min-w-0">{visual}</div>
    </div>;
}

export default function WrappedScenes({ scene, data, onStart, onNext, onExplore, picked, onPick, assembleQuiz = false }: {
    scene: WrappedScene;
    data: WrappedData;
    onStart: () => void;
    onNext: () => void;
    onExplore: (active: boolean) => void;
    picked: string | null;
    onPick: (key: string) => void;
    assembleQuiz?: boolean;
}) {
    const { t, i18n } = useTranslation();
    const reduced = useReducedMotion();
    const duration = (minutes: number) => formatWrappedDuration(minutes, i18n.language);
    const number = (value: number) => new Intl.NumberFormat(i18n.language).format(value);
    const top = data.topContent[0];
    const heading = "wrapped-heading font-['Archivo_Black'] leading-[1.06] tracking-[-0.035em] [overflow-wrap:anywhere]";
    const caption = 'max-w-md text-pretty text-sm leading-relaxed text-white/65 sm:text-base';
    const kicker = 'text-xs font-semibold uppercase tracking-[0.14em] text-[var(--wrapped-accent)]';
    const action = 'inline-flex min-h-12 items-center justify-center gap-3 rounded-full bg-[var(--wrapped-accent)] px-7 py-3 text-sm font-bold text-[#111014] transition-colors hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white';

    if (scene === 'intro') return (
        <SceneLayout visual={<div><WrappedPosterGallery items={data.topContent} /><p className="mt-2 text-center text-xs text-white/60">{t('wrappedCinema.yourSelection')}</p></div>}>
            <p className={kicker}>{t('wrappedStory.edition', { year: data.year })}</p>
            <h1 className={heading}>{t(`wrappedMotion.intro.${wrappedStoryMode(data)}`)}</h1>
            <p className={caption}>{t(`wrappedMotion.introCaption.${wrappedStoryMode(data)}`)}</p>
            <p className="text-xs text-white/70">{wrappedPeriod(data, i18n.language, t)}</p>
            <button type="button" onClick={onStart} className={action}>{t('wrappedStory.start')}<ArrowRight className="h-4 w-4" aria-hidden="true" /></button>
        </SceneLayout>
    );

    if (scene === 'race') return <WrappedRace data={data} onExplore={onExplore} />;
    if (scene === 'eras') return <WrappedEras data={data} />;
    if (scene === 'awards') return <WrappedPodium data={data} onExplore={onExplore} />;

    if (scene === 'time') {
        const total = Number.isFinite(data.stats.totalMinutes) ? Math.max(0, Math.round(data.stats.totalMinutes)) : 0;
        const hours = Math.floor(total / 60);
        const minutes = total % 60;
        return <div className="mx-auto w-full max-w-[1020px] space-y-3 lg:space-y-6">
            <header className="flex flex-wrap items-end justify-between gap-x-7 gap-y-4">
                <div className="max-w-sm space-y-4"><p className={kicker}>{t('wrappedCinema.timeKicker')}</p><h2 className="font-['Archivo_Black'] text-3xl leading-tight tracking-tight lg:text-4xl">{t('wrappedCinema.timeTitle')}</h2></div>
                <p className="flex flex-wrap items-baseline gap-x-4 text-[var(--wrapped-accent)]">
                    <span className="sr-only">{duration(data.stats.totalMinutes)}</span>
                    <span aria-hidden="true" className="whitespace-nowrap font-['Archivo_Black'] text-6xl leading-none tracking-tight lg:text-8xl"><WrappedCountUp value={hours || minutes} format={number} /><span className="ml-2 text-3xl lg:text-5xl">{hours ? 'h' : 'min'}</span></span>
                    {hours > 0 && minutes > 0 && <span aria-hidden="true" className="whitespace-nowrap text-2xl font-semibold lg:text-3xl"><WrappedCountUp value={minutes} format={number} delay={0.45} duration={1.2} /> min</span>}
                </p>
            </header>
            <WrappedFormats data={data} onExplore={onExplore} wide />
            <p className="text-center text-sm text-white/55">{t('wrappedCinema.timeCaption', { count: data.stats.uniqueTitles })}</p>
        </div>;
    }

    if (scene === 'timeline') return (
        <SceneLayout visual={<WrappedTimeline data={data} onExplore={onExplore} />}>
            <p className={kicker}>{t('wrappedCinema.timelineKicker')}</p>
            <h2 className={heading}>{t('wrappedCinema.timelineTitle')}</h2>
            <p className={caption}>{t('wrappedCinema.timelineCaption')}</p>
            <div className="hidden items-center gap-2 text-xs text-white/60 lg:flex"><ArrowUpRight className="h-4 w-4 text-white opacity-60" />{t('wrappedCinema.chartHint')}</div>
        </SceneLayout>
    );

    if (scene === 'genres') {
        const closePair = data.topGenres && data.topGenres.length > 1 && Math.abs(data.topGenres[0].percent - data.topGenres[1].percent) <= 2;
        return <div className="mx-auto w-full max-w-[1060px] space-y-4 lg:space-y-6">
            <header className="flex items-end justify-between gap-8">
                <div className="space-y-3"><p className={kicker}>{t('wrappedCinema.genresKicker')}</p><h2 className="font-['Archivo_Black'] text-3xl leading-tight tracking-tight lg:text-5xl">{t(closePair ? 'wrappedCinema.genresDuo' : 'wrappedCinema.genresTitle')}</h2></div>
                <p className={`${caption} hidden max-w-sm lg:block`}>{t(closePair ? 'wrappedCinema.genresDuoCaption' : 'wrappedCinema.genresCaption')}</p>
            </header>
            <WrappedGenres data={data} onExplore={onExplore} />
        </div>;
    }

    if (scene === 'quiz') {
        const options = [0, 1, 2].map((_, index) => data.topContent[(index + data.year) % 3]);
        return <SceneLayout visual={<div className="space-y-4" data-wrapped-interactive>
            <div className="wrapped-quiz-options grid grid-cols-3 items-start gap-3 sm:gap-5">
                {options.map((item, index) => {
                    const key = wrappedMediaKey(item);
                    const winner = key === wrappedMediaKey(top);
                    return <motion.button {...WRAPPED_FRAME_ANIMATION} key={key} type="button" disabled={picked !== null} aria-pressed={picked === key} onClick={() => onPick(key)}
                        initial={reduced || !assembleQuiz ? false : { opacity: 0, transform: `translateY(${50 + Math.abs(index - 1) * 25}px) rotate(${(index - 1) * 10}deg)` }}
                        animate={{ opacity: 1, transform: 'translateY(0px) rotate(0deg)' }}
                        transition={{ duration: reduced ? 0 : 0.58, delay: reduced || !assembleQuiz ? 0 : 0.1 + Math.abs(index - 1) * 0.06, ease: [0.23, 1, 0.32, 1] }}
                        className="min-w-0 space-y-3 rounded-xl text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
                        <div className={`wrapped-quiz-poster transition-opacity ${picked && !winner ? 'opacity-50' : ''}`}><WrappedPoster item={item} className={`w-full ${picked && winner ? 'ring-4 ring-[var(--wrapped-accent)]' : ''}`} /></div>
                        <span className="block break-words text-xs font-semibold leading-relaxed sm:text-sm">{item.title}</span>
                    </motion.button>;
                })}
            </div>
            {picked && <p role="status" className="text-base font-semibold leading-relaxed text-[var(--wrapped-accent)]">{t(picked === wrappedMediaKey(top) ? 'wrappedFinish.guessCorrect' : 'wrappedFinish.guessWrong', { title: top.title, duration: duration(top.minutes) })}</p>}
            <button type="button" onClick={onNext} className={picked ? action : 'min-h-11 text-sm text-white/75 underline underline-offset-4'}>{t(picked ? 'wrappedFinish.guessContinue' : 'wrappedFinish.guessSkip')}</button>
        </div>}>
            <p className={kicker}>{t('wrappedFinish.guessKicker')}</p>
            <h2 className={heading}>{t('wrappedFinish.guessTitle')}</h2>
            <p className={caption}>{t('wrappedFinish.guessCaption')}</p>
        </SceneLayout>;
    }

    if (scene === 'favorite' && top) return (
        <SceneLayout visual={<WrappedPosterGallery items={data.topContent} focused />}>
            <p className={kicker}>{t('wrappedStory.favoriteLabel')}</p>
            <h2 className={heading}>{top.title}</h2>
            <p className="text-sm text-white/65">{wrappedTypeLabel(top.type, t)}{top.year ? ` · ${top.year}` : ''}</p>
            <p className="text-4xl font-bold tracking-tight text-[var(--wrapped-accent)]">{duration(top.minutes)}</p>
            <p className={caption}>{t('wrappedCinema.favoriteCaption')}</p>
        </SceneLayout>
    );

    if (scene === 'top-five' && top) return <WrappedPodium data={data} onExplore={onExplore} />;

    if (scene === 'rhythm' && data.recordDay?.minutes) {
        const { recordDay } = data;
        return <SceneLayout visual={<div className="space-y-5 border-y border-white/20 py-5 sm:py-8">
            <p className="text-lg font-semibold">{wrappedDate(recordDay.date, i18n.language)}</p>
            <p className="font-['Archivo_Black'] text-[clamp(2.5rem,7vw,5rem)] leading-tight text-[var(--wrapped-accent)]">{duration(recordDay.minutes)}</p>
            <p className="text-sm text-white/75">{t('wrappedFinish.recordDayCaption')}</p>
            <p className="text-xs leading-relaxed text-white/65">{t('wrappedFinish.recordEstimate')}</p>
        </div>}>
            <p className={kicker}>{t('wrappedFinish.recordsKicker')}</p>
            <h2 className={heading}>{t('wrappedFinish.recordsTitle')}</h2>
            <p className={caption}>{t('wrappedFinish.recordsCaption')}</p>
        </SceneLayout>;
    }

    if (scene === 'rhythm') return (
        <SceneLayout visual={<WrappedClock data={data} onExplore={onExplore} />}>
            <p className={kicker}>{t('wrappedCinema.rhythmKicker')}</p>
            <h2 className={heading}>{t('wrappedCinema.rhythmTitle')}</h2>
            <div className="flex gap-8 pt-1">
                {data.peakHour != null && <div><p className="text-4xl font-bold tracking-tight text-[var(--wrapped-accent)]">{data.peakHour} h</p><p className="mt-2 text-xs text-white/70">{t('wrappedStory.peakHour')}</p></div>}
                <div><p className="text-4xl font-bold tracking-tight">{number(data.monthlyGraph?.filter(month => month.minutes > 0).length || 0)}</p><p className="mt-2 text-xs text-white/70">{t('wrappedMotion.activeMonths')}</p></div>
            </div>
            <p className={`${caption} hidden lg:block`}>{t('wrappedStory.rhythmCaption')}</p>
        </SceneLayout>
    );

    if (scene === 'community' && data.community) return <WrappedCommunity community={data.community} onExplore={onExplore} />;

    if (scene === 'persona') return (
        <SceneLayout visual={<WrappedTilt className="mx-auto w-full max-w-md p-3 sm:p-4">
            <motion.div {...WRAPPED_FRAME_ANIMATION} initial={reduced ? false : { clipPath: 'inset(0% 0% 100% 0%)' }} animate={{ clipPath: 'inset(0% 0% 0% 0%)' }} transition={{ duration: 0.76, ease: [...WRAPPED_EASE_MORPH] }} className="relative overflow-hidden rounded-2xl bg-[#e7f0ff] p-5 text-[#101c30] shadow-[0_24px_48px_rgba(0,0,0,0.3)] sm:p-8">
                <div className="flex items-center justify-between border-b border-[#172114]/20 pb-3 text-xs font-semibold"><span>MOVIX / {data.year}</span><span>{t('wrappedCinema.memberCard')}</span></div>
                <div className="mt-4 flex items-start gap-4"><p className="min-w-0 flex-1 font-['Archivo_Black'] text-2xl leading-tight tracking-tight sm:text-4xl">{wrappedPersona(data, t)}</p>{top && <WrappedPoster item={top} className="w-12 shrink-0 sm:w-16" />}</div>
                <div className="mt-3 space-y-2" data-wrapped-interactive>{wrappedTraits(data, t).map(trait => <details key={trait.label} onToggle={event => onExplore(Boolean(event.currentTarget.parentElement?.querySelector('details[open]')))} className="border-b border-[#172114]/20 pb-2"><summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">{trait.label}</summary><p className="pb-2 text-xs leading-relaxed">{trait.evidence}</p></details>)}</div>
                <p className="mt-3 text-sm">{t('wrappedCinema.registeredTitles', { count: data.stats.uniqueTitles })}</p>
                <WrappedSignature data={data} />
                <div className="mt-6 hidden justify-between border-t border-dashed border-[#172114]/30 pt-4 text-xs sm:flex"><span>{t('wrappedCinema.yourSignature')}</span><span>WRAPPED {data.year}</span></div>
            </motion.div>
        </WrappedTilt>}>
            <p className={kicker}>{t('wrappedCinema.personaKicker')}</p>
            <h2 className="text-balance font-['Archivo_Black'] text-3xl leading-tight tracking-tight lg:text-5xl">{t('wrappedCinema.personaTitle')}</h2>
            <p className={`${caption} hidden lg:block`}>{t('wrappedCinema.personaCaption')}</p>
        </SceneLayout>
    );
    return null;
}
