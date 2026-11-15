/**
 * Variante A : snapshot frontend f1c90a390a97ac575542fd76e8011e269543eb89.
 * Adaptations : imports, données injectées/clonées et fermeture commune.
 * Authentification et chargement réseau du compte restent dans WrappedPage.
 * Conserver le rendu historique pour la comparaison A/B.
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence, PanInfo, useReducedMotion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { DEFAULT_PUBLIC_DOMAIN } from '@/i18n/currentDomain';
import { ChevronLeft, ChevronRight, Share2, X, Sparkles, Calendar, Trophy, BarChart3, Clock, Flame, Music, ImageIcon, Download, Copy, FileText, Loader2, TrendingUp, Repeat, Hourglass, MousePointerClick, HelpCircle } from 'lucide-react';
import { WrappedData, WrappedProgress, WrappedSlide, WrappedTopContent, WrappedResponse } from '@/services/wrappedService';
import { drawRoundedRectPath, wrapCanvasText, loadCanvasImage, ensureShareFonts, drawSeededStickers } from './wrappedCanvas';
import { generatePosterShareImage, generateTicketShareImage, WrappedShareCardData } from './wrappedShareCards';
import { SquareBackground } from '@/components/ui/square-background';
import AnimatedBorderCard from '@/components/ui/animated-border-card';
import ShinyText from '@/components/ui/shiny-text';
import axios from 'axios';
import { getTmdbLanguage } from '@/i18n';
import { toast } from 'sonner';
import { areSoundEffectsEnabled, SOUND_EFFECTS_CHANGED_EVENT } from '@/utils/soundSettings';
import { copyText } from '@/utils/clipboard';

const TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY || '';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

// ==========================================
// TMDB DATA INTERFACE
// ==========================================
interface TMDBData {
    id: number;
    title?: string;
    name?: string;
    poster_path: string | null;
    backdrop_path?: string | null;
    vote_average?: number;
    release_date?: string;
    first_air_date?: string;
    genres?: { id: number; name: string }[];
    trailerKey?: string | null;
}



// ==========================================
// DURATION FORMATTING HELPERS
// ==========================================
/** Shows "Xh" if >= 60 min, else "Xmin" */
function formatDurationShort(minutes: number): string {
    if (minutes >= 60) return `${Math.round(minutes / 60)}h`;
    return `${minutes}min`;
}

function formatCompactDuration(minutes: number, t: (key: string, options?: Record<string, unknown>) => string): string {
    const safeMinutes = Math.max(0, Math.round(minutes));

    if (safeMinutes >= 60) {
        const hours = Math.floor(safeMinutes / 60);
        const remainingMinutes = safeMinutes % 60;

        if (remainingMinutes === 0) {
            return `${hours}${t('wrapped.hoursShort')}`;
        }

        return `${hours}${t('wrapped.hoursShort')} ${remainingMinutes}${t('wrapped.minutesShort')}`;
    }

    return `${safeMinutes}${t('wrapped.minutesShort')}`;
}

function formatWrappedTypeLabel(
    type: WrappedTopContent['type'] | string,
    t: (key: string, options?: Record<string, unknown>) => string
): string {
    if (type === 'movie') return t('wrapped.movieType');
    if (type === 'tv') return t('wrapped.seriesSingular');
    if (type === 'anime') return t('wrapped.animeType');
    return t('wrapped.tvType');
}

const WRAPPED_SHARE_IMAGE_WIDTH = 1080;
const WRAPPED_SHARE_IMAGE_HEIGHT = 1920;


function downloadBlob(blob: Blob, filename: string) {
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(blobUrl);
}

function isShareAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
}

// ==========================================
// ANIMATED COUNTER
// ==========================================
const AnimatedCounter: React.FC<{ value: number; suffix?: string; className?: string; duration?: number }> = ({ value, suffix = '', className = '', duration = 2 }) => {
    const [count, setCount] = useState(0);

    useEffect(() => {
        const step = value / (duration * 60);
        let current = 0;
        const timer = setInterval(() => {
            current += step;
            if (current >= value) {
                setCount(value);
                clearInterval(timer);
            } else {
                setCount(Math.floor(current));
            }
        }, 1000 / 60);
        return () => clearInterval(timer);
    }, [value, duration]);

    return <span className={className}>{count.toLocaleString(i18n.language)}{suffix}</span>;
};

// ==========================================
// CASCADING TIME COUNTER - Shows time in different units
// ==========================================
type TimeUnit = 'seconds' | 'minutes' | 'hours' | 'days' | 'weeks' | 'months';

const timeUnits: { unit: TimeUnit; labelKey: string; labelPluralKey: string; divider: number }[] = [
    { unit: 'seconds', labelKey: 'wrapped.timeUnitSecondSingular', labelPluralKey: 'wrapped.timeUnitSecondPlural', divider: 1 },
    { unit: 'minutes', labelKey: 'wrapped.timeUnitMinuteSingular', labelPluralKey: 'wrapped.timeUnitMinutePlural', divider: 60 },
    { unit: 'hours', labelKey: 'wrapped.timeUnitHourSingular', labelPluralKey: 'wrapped.timeUnitHourPlural', divider: 3600 },
    { unit: 'days', labelKey: 'wrapped.timeUnitDaySingular', labelPluralKey: 'wrapped.timeUnitDayPlural', divider: 86400 },
    { unit: 'weeks', labelKey: 'wrapped.timeUnitWeekSingular', labelPluralKey: 'wrapped.timeUnitWeekPlural', divider: 604800 },
    { unit: 'months', labelKey: 'wrapped.timeUnitMonthSingular', labelPluralKey: 'wrapped.timeUnitMonthPlural', divider: 2592000 },
];

const CascadingTimeCounter: React.FC<{ totalMinutes: number; className?: string }> = ({ totalMinutes, className = '' }) => {
    const totalSeconds = totalMinutes * 60;
    const [currentUnitIndex, setCurrentUnitIndex] = useState(0);
    const [displayValue, setDisplayValue] = useState(0);
    const [isAnimating, setIsAnimating] = useState(true);

    // Determine the final unit based on the total time
    const getFinalUnitIndex = () => {
        const days = totalSeconds / 86400;
        if (days >= 30) return 5; // months
        if (days >= 7) return 4; // weeks
        return 3; // days
    };

    const finalUnitIndex = getFinalUnitIndex();

    useEffect(() => {
        const currentUnit = timeUnits[currentUnitIndex];
        const targetValue = totalSeconds / currentUnit.divider;
        const duration = currentUnitIndex === 0 ? 1500 : 1000; // Slower for seconds
        const startTime = Date.now();

        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);

            // Easing function for smooth animation
            const eased = 1 - Math.pow(1 - progress, 3);
            const currentValue = targetValue * eased;

            setDisplayValue(currentValue);

            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                // Animation complete, move to next unit after a delay
                if (currentUnitIndex < finalUnitIndex) {
                    setTimeout(() => {
                        setCurrentUnitIndex(prev => prev + 1);
                    }, 800);
                } else {
                    setIsAnimating(false);
                }
            }
        };

        setIsAnimating(true);
        requestAnimationFrame(animate);
    }, [currentUnitIndex, totalSeconds, finalUnitIndex]);

    const currentUnit = timeUnits[currentUnitIndex];
    const formattedValue = currentUnitIndex >= 3
        ? displayValue.toFixed(1)
        : Math.floor(displayValue).toLocaleString(i18n.language);
    const label = displayValue === 1 ? i18n.t(currentUnit.labelKey) : i18n.t(currentUnit.labelPluralKey);

    return (
        <div className={`relative ${className}`}>
            <AnimatePresence mode="wait">
                <motion.div
                    key={currentUnitIndex}
                    initial={{ opacity: 0, y: 30, scale: 0.8 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -30, scale: 0.8 }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                    className="flex flex-col items-center"
                >
                    <motion.span
                        className="text-5xl md:text-7xl font-black tabular-nums"
                        animate={isAnimating ? { scale: [1, 1.02, 1] } : {}}
                        transition={{ duration: 0.1, repeat: isAnimating ? Infinity : 0 }}
                    >
                        {formattedValue}
                    </motion.span>
                    <motion.span
                        className="text-2xl md:text-3xl text-white/70 font-medium mt-2"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.2 }}
                    >
                        {label}
                    </motion.span>
                </motion.div>
            </AnimatePresence>

            {/* Progress dots */}
            <div className="flex justify-center gap-2 mt-6">
                {timeUnits.slice(0, finalUnitIndex + 1).map((_, idx) => (
                    <motion.div
                        key={idx}
                        className={`w-2 h-2 rounded-full transition-colors duration-300 ${
                            idx <= currentUnitIndex ? 'bg-purple-400' : 'bg-white/20'
                        }`}
                        animate={idx === currentUnitIndex ? { scale: [1, 1.3, 1] } : {}}
                        transition={{ duration: 0.5, repeat: idx === currentUnitIndex ? Infinity : 0 }}
                    />
                ))}
            </div>
        </div>
    );
};

const wrappedSlideViewportStyle: React.CSSProperties = {
    paddingTop: 'max(6rem, calc(env(safe-area-inset-top) + 5rem))',
    paddingBottom: 'max(8rem, calc(env(safe-area-inset-bottom) + 7rem))',
};

const wrappedTopBarStyle: React.CSSProperties = {
    paddingTop: 'max(0.75rem, calc(env(safe-area-inset-top) + 0.75rem))',
};

const wrappedProgressBarStyle: React.CSSProperties = {
    top: 'max(4rem, calc(env(safe-area-inset-top) + 3.75rem))',
};

const wrappedNavigationStyle: React.CSSProperties = {
    bottom: 'max(1rem, calc(env(safe-area-inset-bottom) + 1rem))',
};

const wrappedHintStyle: React.CSSProperties = {
    bottom: 'max(4.75rem, calc(env(safe-area-inset-bottom) + 4.5rem))',
};

const wrappedStandaloneViewportStyle: React.CSSProperties = {
    paddingTop: 'max(1rem, calc(env(safe-area-inset-top) + 1rem))',
    paddingBottom: 'max(1.5rem, calc(env(safe-area-inset-bottom) + 1.5rem))',
};

const WrappedCenteredSlide: React.FC<{
    children: React.ReactNode;
    className?: string;
    contentClassName?: string;
}> = ({ children, className = '', contentClassName = '' }) => (
    <div
        className={`h-full w-full overflow-y-auto overscroll-y-contain px-4 sm:px-6 ${className}`}
        style={wrappedSlideViewportStyle}
        data-lenis-prevent
        onWheel={(e) => e.stopPropagation()}
    >
        <div
            className={`mx-auto flex min-h-full w-full flex-col items-center justify-start text-center lg:justify-center ${contentClassName}`}
        >
            {children}
        </div>
    </div>
);

const WrappedStandaloneShell: React.FC<{
    mode: React.ComponentProps<typeof SquareBackground>['mode'];
    children: React.ReactNode;
}> = ({ mode, children }) => (
    <SquareBackground mode={mode} borderColor="rgba(168, 85, 247, 0.15)" className="fixed inset-0 z-50 bg-black">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_24%,rgba(168,85,247,0.18),transparent_52%)]" />
        <div
            className="relative z-10 h-full overflow-y-auto overscroll-y-contain px-4 sm:px-6"
            style={wrappedStandaloneViewportStyle}
            data-lenis-prevent
            onWheel={(e) => e.stopPropagation()}
        >
            <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col">
                {children}
            </div>
        </div>
    </SquareBackground>
);

// ==========================================
// SLIDE COMPONENTS - New Design
// ==========================================

const SlideIntro: React.FC<{ slide: WrappedSlide; stats: WrappedData['stats'] }> = ({ slide, stats }) => (
    <WrappedCenteredSlide contentClassName="max-w-4xl">
        <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
            className="mb-5 sm:mb-6"
        >
            <div className="relative">
                <div
                    className="absolute inset-0 rounded-full pointer-events-none"
                    style={{ background: 'radial-gradient(circle, rgba(168, 85, 247, 0.45) 0%, transparent 70%)' }}
                />
                <span className="relative text-7xl md:text-8xl">🎬</span>
            </div>
        </motion.div>

        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
        >
            <h1 className="mb-3 px-2 text-3xl font-black leading-tight sm:text-4xl md:text-5xl">
                <ShinyText text={slide.title} speed={2} color="#ffffff" shineColor="#a855f7" className="max-w-full" />
            </h1>
        </motion.div>

        <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="mb-5 max-w-2xl text-base font-medium text-purple-300 sm:text-lg md:text-xl"
        >
            {slide.subtitle}
        </motion.p>

        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="w-full max-w-xl"
        >
            <AnimatedBorderCard
                highlightColor="168 85 247"
                backgroundColor="0 0 0"
                className="p-4 sm:p-6 md:p-8 backdrop-blur-md"
            >
                <p className="mb-5 text-sm leading-relaxed text-white/90 sm:text-base md:text-lg">
                    {i18n.t('wrapped.spentOnMovix')}
                </p>

                {/* Cascading Time Counter */}
                <CascadingTimeCounter
                    totalMinutes={stats.totalMinutes}
                    className="mb-4"
                />

                <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 8 }}
                    className="mt-4 text-xs text-purple-400/80 sm:text-sm"
                >
                    {i18n.t('wrapped.hopeYouHadSnacks')}
                </motion.p>
            </AnimatedBorderCard>
        </motion.div>
    </WrappedCenteredSlide>
);

const SlideTop1: React.FC<{ slide: WrappedSlide; topItem?: WrappedTopContent; tmdbData: Map<number, TMDBData> }> = ({ slide, topItem, tmdbData }) => {
    const tmdb = topItem?.tmdbId ? tmdbData.get(topItem.tmdbId) : null;
    const posterUrl = tmdb?.poster_path
        ? `${TMDB_IMAGE_BASE}${tmdb.poster_path}`
        : topItem?.poster_path
            ? `${TMDB_IMAGE_BASE}${topItem.poster_path}`
            : null;

    return (
        <WrappedCenteredSlide className="relative" contentClassName="max-w-3xl">
            {/* Content */}
            <div className="relative z-10 flex flex-col items-center">
                <motion.div
                    initial={{ scale: 0, rotate: -180 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: 'spring', duration: 0.8 }}
                    className="mb-4 sm:mb-6"
                >
                    <div className="relative">
                        <div
                            className="absolute inset-0 rounded-full scale-150 pointer-events-none"
                            style={{ background: 'radial-gradient(circle, rgba(245, 158, 11, 0.60) 0%, transparent 70%)' }}
                        />
                        {posterUrl ? (
                            <div className="relative h-36 w-24 overflow-hidden rounded-2xl shadow-2xl ring-4 ring-amber-400/50 sm:h-44 sm:w-32 md:h-56 md:w-40">
                                <img
                                    src={posterUrl}
                                    alt={topItem?.title || i18n.t('wrapped.topContentFallbackAlt')}
                                    className="w-full h-full object-cover"
                                />
                                {/* Trophy badge */}
                                <div className="absolute -right-2 -top-2 flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 via-orange-500 to-red-500 shadow-lg sm:-right-3 sm:-top-3 sm:h-12 sm:w-12">
                                    <Trophy className="h-5 w-5 text-white sm:h-6 sm:w-6" />
                                </div>
                            </div>
                        ) : (
                            <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 via-orange-500 to-red-500 shadow-2xl sm:h-32 sm:w-32 md:h-40 md:w-40">
                                <Trophy className="h-12 w-12 text-white sm:h-16 sm:w-16 md:h-20 md:w-20" />
                            </div>
                        )}
                    </div>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                >
                    <h2 className="mb-2 px-2 text-2xl font-black leading-tight sm:text-3xl md:text-4xl">
                        <ShinyText text={tmdb?.title || tmdb?.name || slide.title} speed={2} color="#fbbf24" shineColor="#ffffff" className="max-w-full" />
                    </h2>
                </motion.div>

                <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.5 }}
                    className="mb-5 text-base font-semibold text-amber-300 sm:text-lg md:text-xl"
                >
                    {slide.subtitle}
                </motion.p>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.7 }}
                    className="w-full max-w-xl"
                >
                    <AnimatedBorderCard
                        highlightColor="251 191 36"
                        backgroundColor="0 0 0"
                        className="p-4 sm:p-6 backdrop-blur-md"
                    >
                        <p className="text-sm leading-relaxed text-white/90 sm:text-base md:text-lg">
                            {slide.text}
                        </p>
                        {slide.subtext && (
                            <p className="mt-3 text-xs italic text-amber-400/80 sm:text-sm">{slide.subtext}</p>
                        )}
                    </AnimatedBorderCard>
                </motion.div>
            </div>
        </WrappedCenteredSlide>
    );
};

const SlideTopFocus: React.FC<{
    slide: WrappedSlide;
    item?: WrappedTopContent;
    tmdbData: Map<number, TMDBData>;
    rank: 2 | 3;
    hideBackdropImage?: boolean;
}> = ({ slide, item, tmdbData, rank, hideBackdropImage = false }) => {
    const tmdb = item?.tmdbId ? tmdbData.get(item.tmdbId) : null;
    const posterUrl = tmdb?.poster_path
        ? `${TMDB_IMAGE_BASE}${tmdb.poster_path}`
        : item?.poster_path
            ? `${TMDB_IMAGE_BASE}${item.poster_path}`
            : null;
    const backdropUrl = tmdb?.backdrop_path ? `${TMDB_IMAGE_BASE}${tmdb.backdrop_path}` : posterUrl;

    const accent = rank === 2
        ? {
            color: '#cbd5e1',
            soft: 'text-slate-300',
            glow: 'bg-slate-300/20',
            badge: 'from-slate-200 via-slate-300 to-slate-500 text-slate-900',
            ring: 'ring-slate-200/50',
            card: '203 213 225',
        }
        : {
            color: '#fb923c',
            soft: 'text-orange-300',
            glow: 'bg-orange-400/25',
            badge: 'from-orange-300 via-amber-500 to-orange-700 text-white',
            ring: 'ring-orange-300/50',
            card: '251 146 60',
        };

    return (
        <div className="relative h-full w-full overflow-hidden">
            {backdropUrl && !hideBackdropImage && (
                <div className="absolute inset-0">
                    <img
                        src={backdropUrl}
                        alt={item?.title || slide.title}
                        className="w-full h-full object-cover scale-110"
                    />
                    <div className="absolute inset-0 bg-black/65" />
                    <div className="absolute inset-0 bg-gradient-to-b from-black/75 via-black/35 to-black/85" />
                </div>
            )}

            <WrappedCenteredSlide className="relative z-10" contentClassName="max-w-3xl">
                <motion.div
                    initial={{ scale: 0.86, opacity: 0, y: 24 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    transition={{ type: 'spring', duration: 0.7 }}
                    className="mb-4 sm:mb-6"
                >
                    <div className="relative">
                        <div className={`absolute inset-0 blur-3xl rounded-full scale-150 ${accent.glow}`} />
                        {posterUrl ? (
                            <div className={`relative h-36 w-24 overflow-hidden rounded-2xl shadow-2xl ring-4 sm:h-44 sm:w-32 md:h-56 md:w-40 ${accent.ring}`}>
                                <img
                                    src={posterUrl}
                                    alt={item?.title || slide.title}
                                    className="w-full h-full object-cover"
                                />
                                <div className={`absolute -right-2 -top-2 flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br text-base font-black shadow-xl sm:-right-3 sm:-top-3 sm:h-12 sm:w-12 sm:text-lg ${accent.badge}`}>
                                    {rank}
                                </div>
                            </div>
                        ) : (
                            <div className={`relative flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br text-4xl font-black shadow-2xl sm:h-32 sm:w-32 sm:text-5xl md:h-40 md:w-40 ${accent.badge}`}>
                                {rank}
                            </div>
                        )}
                    </div>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 18 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                >
                    <h2 className="mb-2 px-2 text-2xl font-black leading-tight sm:text-3xl md:text-4xl">
                        <ShinyText text={tmdb?.title || tmdb?.name || item?.title || slide.title} speed={2} color={accent.color} shineColor="#ffffff" className="max-w-full" />
                    </h2>
                </motion.div>

                <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.35 }}
                    className={`mb-4 text-base font-semibold sm:text-lg md:text-xl ${accent.soft}`}
                >
                    {slide.subtitle}
                </motion.p>

                <motion.div
                    initial={{ opacity: 0, y: 18 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.45 }}
                    className="mb-4 w-full max-w-xl sm:mb-5"
                >
                    <AnimatedBorderCard
                        highlightColor={accent.card}
                        backgroundColor="0 0 0"
                        className="p-4 sm:p-6 backdrop-blur-md"
                    >
                        <p className="text-sm leading-relaxed text-white/90 sm:text-base md:text-lg">
                            {slide.text}
                        </p>
                        {slide.subtext && (
                            <p className={`mt-3 text-xs italic sm:text-sm ${accent.soft}`}>
                                {slide.subtext}
                            </p>
                        )}
                    </AnimatedBorderCard>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.6 }}
                    className="flex max-w-xl flex-wrap items-center justify-center gap-2 sm:gap-3"
                >
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/85 sm:px-4 sm:py-2 sm:text-sm">
                        {item ? formatWrappedTypeLabel(item.type, (key, options) => i18n.t(key, options)) : i18n.t('wrapped.movieType')}
                    </span>
                    {item?.durationLabel && (
                        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/85 sm:px-4 sm:py-2 sm:text-sm">
                            {item.durationLabel}
                        </span>
                    )}
                    {tmdb?.vote_average && (
                        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/85 sm:px-4 sm:py-2 sm:text-sm">
                            {i18n.t('wrapped.ratingLabel', { rating: tmdb.vote_average.toFixed(1) })}
                        </span>
                    )}
                </motion.div>
            </WrappedCenteredSlide>
        </div>
    );
};

const SlideTop5: React.FC<{ slide: WrappedSlide; topContent: WrappedData['topContent']; tmdbData: Map<number, TMDBData> }> = ({ slide, topContent, tmdbData }) => (
    <div
        className="relative z-10 flex h-full w-full flex-col items-center overflow-y-auto px-4 text-center scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent sm:px-6"
        style={wrappedSlideViewportStyle}
        data-lenis-prevent
        onWheel={(e) => e.stopPropagation()}
    >
        {/* Header */}
        <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 flex-shrink-0"
        >
            <h2 className="text-3xl md:text-5xl font-black mb-2">
                <ShinyText text={slide.title} speed={2} color="#fbbf24" shineColor="#ffffff" className="" />
            </h2>
            <p className="text-lg text-amber-200/80 font-medium">{slide.subtitle}</p>
        </motion.div>

        {/* List */}
        <div className="w-full max-w-lg flex flex-col gap-3 flex-1 pb-4">
            {topContent.slice(0, 5).map((item, index) => {
                const tmdb = item.tmdbId ? tmdbData.get(item.tmdbId) : null;
                const posterUrl = tmdb?.poster_path
                    ? `${TMDB_IMAGE_BASE}${tmdb.poster_path}`
                    : item.poster_path
                        ? `${TMDB_IMAGE_BASE}${item.poster_path}`
                        : null;

                const year = tmdb?.release_date ? new Date(tmdb.release_date).getFullYear() :
                             tmdb?.first_air_date ? new Date(tmdb.first_air_date).getFullYear() : null;

                const genres = tmdb?.genres?.slice(0, 2).map(g => g.name).join(' • ');

                return (
                    <motion.div
                        key={index}
                        initial={{ opacity: 0, x: -30 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.2 + index * 0.1 }}
                        className="w-full"
                    >
                        <AnimatedBorderCard
                            highlightColor={index === 0 ? "255 193 7" : index === 1 ? "148 163 184" : index === 2 ? "180 83 9" : "255 255 255"}
                            backgroundColor="0 0 0"
                            className={`flex items-center gap-4 p-3 bg-white/5 backdrop-blur-md w-full border border-white/5 transition-transform hover:scale-[1.02] ${index === 0 ? 'bg-amber-500/10 border-amber-500/30' : ''}`}
                        >
                             {/* Rank & Poster Container */}
                             <div className="relative">
                                <div className={`absolute -top-2 -left-2 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold shadow-lg z-10 ${
                                    index === 0 ? 'bg-gradient-to-br from-amber-300 to-orange-500 text-black border-2 border-amber-200' :
                                    index === 1 ? 'bg-gradient-to-br from-slate-200 to-slate-400 text-slate-800 border-2 border-slate-100' :
                                    index === 2 ? 'bg-gradient-to-br from-amber-600 to-amber-800 text-white border-2 border-amber-500' :
                                    'bg-white/10 text-white border border-white/20'
                                }`}>
                                    {index + 1}
                                </div>
                                <div className={`relative w-16 h-24 rounded-lg overflow-hidden flex-shrink-0 shadow-xl ${index === 0 ? 'w-20 h-28' : ''}`}>
                                    {posterUrl ? (
                                        <img
                                            src={posterUrl}
                                            alt={item.title}
                                            className="w-full h-full object-cover"
                                            loading="lazy"
                                        />
                                    ) : (
                                        <div className="w-full h-full bg-white/5 flex items-center justify-center text-lg">
                                            {item.type === 'anime' ? '⛩️' : item.type === 'movie' ? '🎬' : item.type === 'tv' ? '📺' : '📡'}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Metadata */}
                            <div className="flex-1 text-left min-w-0 flex flex-col justify-center h-full">
                                {/* Title */}
                                <p className={`font-bold text-white leading-tight truncate pr-2 ${index === 0 ? 'text-lg text-amber-100' : 'text-base'}`}>
                                    {tmdb?.title || tmdb?.name || item.title}
                                </p>

                                {/* Sub-info line 1: Type + Year */}
                                <div className="flex items-center gap-2 mt-1 text-xs text-white/50">
                                    <span className="uppercase tracking-wider font-medium text-[10px] bg-white/10 px-1.5 py-0.5 rounded">
                                        {item.type === 'movie' ? i18n.t('wrapped.filmType') : item.type === 'tv' ? i18n.t('wrapped.seriesType') : item.type === 'anime' ? i18n.t('wrapped.animeType') : i18n.t('wrapped.tvType')}
                                    </span>
                                    {year && <span>{year}</span>}
                                </div>

                                {/* Sub-info line 2: Genres or Rating */}
                                <div className="flex items-center gap-3 mt-1.5 h-4">
                                    {genres && (
                                        <p className="text-xs text-white/40 truncate max-w-[120px]">
                                            {genres}
                                        </p>
                                    )}
                                    {tmdb?.vote_average && (
                                        <div className="flex items-center gap-1 text-amber-400 text-xs font-medium ml-auto">
                                            <span>★</span>
                                            <span>{tmdb.vote_average.toFixed(1)}</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Hours Watched Badge */}
                            <div className="flex flex-col items-end justify-center pl-2 border-l border-white/5 min-w-[60px]">
                                <span className={`text-xl font-black ${index === 0 ? 'text-amber-400' : 'text-teal-400'}`}>
                                    {item.durationLabel || formatDurationShort(item.minutes)}
                                </span>
                            </div>
                        </AnimatedBorderCard>
                    </motion.div>
                );
            })}
        </div>

        {slide.highlight && (
            <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.8 }}
                className="mt-4 text-teal-400 font-medium text-sm"
            >
                {slide.highlight}
            </motion.p>
        )}
    </div>
);

const SlidePersona: React.FC<{ slide: WrappedSlide; persona: WrappedData['persona'] }> = ({ slide, persona }) => (
    <WrappedCenteredSlide contentClassName="max-w-4xl">
        <motion.div
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', duration: 1 }}
            className="mb-8"
        >
            <div className="relative">
                <div
                    className="absolute inset-0 rounded-full scale-150 pointer-events-none"
                    style={{ background: `radial-gradient(circle, ${persona.color}66 0%, transparent 70%)` }}
                />
                <div
                    className="relative w-36 h-36 md:w-44 md:h-44 rounded-full flex items-center justify-center text-7xl md:text-8xl"
                    style={{
                        background: `linear-gradient(135deg, ${persona.color}40, ${persona.color}20)`,
                        border: `3px solid ${persona.color}80`,
                    }}
                >
                    {persona.emoji}
                </div>
            </div>
        </motion.div>

        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
        >
            <h2 className="text-3xl md:text-5xl font-black mb-3">
                <ShinyText text={persona.title} speed={2} color={persona.color} shineColor="#ffffff" className="" />
            </h2>
        </motion.div>

        <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="text-xl md:text-2xl mb-8 font-medium"
            style={{ color: persona.color }}
        >
            {persona.subtitle}
        </motion.p>

        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7 }}
        >
            <AnimatedBorderCard
                highlightColor={persona.color.replace('#', '').match(/.{2}/g)?.map(hex => parseInt(hex, 16)).join(' ') || "255 152 0"}
                backgroundColor="0 0 0"
                className="p-8 max-w-xl backdrop-blur-md"
            >
                <p className="text-lg md:text-xl text-white/90 leading-relaxed">
                    {slide.text}
                </p>
                <p className="mt-4 text-white/60 italic">{persona.description}</p>
            </AnimatedBorderCard>
        </motion.div>
    </WrappedCenteredSlide>
);

const SlidePeakMonth: React.FC<{ slide: WrappedSlide; peakMonth: WrappedData['peakMonth'] }> = ({ slide }) => (
    <WrappedCenteredSlide contentClassName="max-w-4xl">
        <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', duration: 0.8 }}
            className="mb-8"
        >
            <div className="relative">
                <div
                    className="absolute inset-0 rounded-full scale-150 pointer-events-none"
                    style={{ background: 'radial-gradient(circle, rgba(99, 102, 241, 0.60) 0%, transparent 70%)' }}
                />
                <div className="relative w-28 h-28 md:w-36 md:h-36 rounded-3xl bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-600 flex items-center justify-center shadow-2xl rotate-3">
                    <Calendar className="w-14 h-14 md:w-16 md:h-16 text-white" />
                </div>
            </div>
        </motion.div>

        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
        >
            <h2 className="text-4xl md:text-6xl font-black mb-3">
                <ShinyText text={slide.title} speed={2} color="#818cf8" shineColor="#ffffff" className="" />
            </h2>
        </motion.div>

        <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="text-xl md:text-2xl text-indigo-300 mb-8 font-semibold"
        >
            {slide.subtitle}
        </motion.p>

        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
        >
            <AnimatedBorderCard
                highlightColor="129 140 248"
                backgroundColor="0 0 0"
                className="p-8 max-w-xl backdrop-blur-md"
            >
                <p className="text-lg md:text-xl text-white/90 leading-relaxed">
                    {slide.text}
                </p>
                {slide.subtext && (
                    <p className="mt-4 text-indigo-400/80 italic">{slide.subtext}</p>
                )}
            </AnimatedBorderCard>
        </motion.div>
    </WrappedCenteredSlide>
);

// ==========================================
// SLIDE: TOP GENRES
// ==========================================
const SlideTopGenres: React.FC<{ slide: WrappedSlide; topGenres?: WrappedData['topGenres'] }> = ({ slide, topGenres }) => (
    <WrappedCenteredSlide contentClassName="max-w-4xl">
        <motion.div
            initial={{ scale: 0, rotate: 20 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', duration: 0.8 }}
            className="mb-8"
        >
            <div className="relative">
                <div
                    className="absolute inset-0 rounded-full scale-150 pointer-events-none"
                    style={{ background: 'radial-gradient(circle, rgba(244, 63, 94, 0.45) 0%, transparent 70%)' }}
                />
                <div className="relative w-28 h-28 md:w-36 md:h-36 rounded-3xl bg-gradient-to-br from-rose-500 via-pink-500 to-fuchsia-600 flex items-center justify-center shadow-2xl -rotate-3">
                    <Music className="w-14 h-14 md:w-16 md:h-16 text-white" />
                </div>
            </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <h2 className="text-3xl md:text-5xl font-black mb-3">
                <ShinyText text={slide.title} speed={2} color="#f43f5e" shineColor="#ffffff" className="" />
            </h2>
        </motion.div>

        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="text-lg md:text-xl text-rose-300 mb-6 font-medium">
            {slide.subtitle}
        </motion.p>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="w-full max-w-md">
            {topGenres && topGenres.length > 0 && (
                <div className="space-y-3 mb-6">
                    {topGenres.slice(0, 5).map((genre, i) => (
                        <motion.div
                            key={genre.name}
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.6 + i * 0.1 }}
                            className="flex items-center gap-3"
                        >
                            <span className="text-sm text-white/60 w-8 text-right font-mono">{genre.percent}%</span>
                            <div className="flex-1 h-8 bg-white/5 rounded-lg overflow-hidden relative">
                                <motion.div
                                    initial={{ width: 0 }}
                                    animate={{ width: `${genre.percent}%` }}
                                    transition={{ duration: 1, delay: 0.7 + i * 0.1 }}
                                    className="h-full bg-gradient-to-r from-rose-500 to-pink-400 rounded-lg"
                                />
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white text-sm font-medium">{genre.name}</span>
                            </div>
                        </motion.div>
                    ))}
                </div>
            )}
        </motion.div>

        {/* Only show subtext if it mentions genres not already displayed in the bars (top 5) */}
        {slide.subtext && topGenres && topGenres.length > 5 && (
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2 }} className="text-rose-400/60 text-sm italic">
                {i18n.t('wrapped.andAlso')}{topGenres.slice(5).map(g => g.name).join(', ')}
            </motion.p>
        )}
    </WrappedCenteredSlide>
);

// ==========================================
// SLIDE: LISTENING CLOCK
// ==========================================
const SlideListeningClock: React.FC<{ slide: WrappedSlide; listeningClock?: WrappedData['listeningClock']; peakHour?: number; weekday?: WrappedData['weekday'] }> = ({ slide, listeningClock, peakHour, weekday }) => {
    const maxMinutes = listeningClock ? Math.max(...listeningClock.map(h => h.minutes)) : 1;
    const hourMarkers = [0, 6, 12, 18, 23];

    return (
        <WrappedCenteredSlide contentClassName="max-w-4xl">
            <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', duration: 0.8 }}
                className="mb-6"
            >
                <div className="relative">
                    <div
                        className="absolute inset-0 rounded-full scale-150 pointer-events-none"
                        style={{ background: 'radial-gradient(circle, rgba(14, 165, 233, 0.45) 0%, transparent 70%)' }}
                    />
                    <div className="relative w-28 h-28 md:w-36 md:h-36 rounded-full bg-gradient-to-br from-sky-500 via-blue-500 to-indigo-600 flex items-center justify-center shadow-2xl">
                        <Clock className="w-14 h-14 md:w-16 md:h-16 text-white" />
                    </div>
                </div>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                <h2 className="text-3xl md:text-5xl font-black mb-2">
                    <ShinyText text={slide.title} speed={2} color="#38bdf8" shineColor="#ffffff" className="" />
                </h2>
            </motion.div>

            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="text-lg text-sky-300 mb-6 font-medium">
                {slide.subtitle}
            </motion.p>

            {/* Clock visualization - 24h bar chart */}
            {listeningClock && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.5 }}
                    className="w-full max-w-md"
                >
                    <div className="flex items-end justify-center gap-[2px] h-32 mb-2">
                        {listeningClock.map((h, i) => {
                            const hasActivity = h.minutes > 0;
                            const heightPercent = hasActivity ? Math.max(8, (h.minutes / maxMinutes) * 100) : 0;
                            const isPeak = i === peakHour && hasActivity;
                            const isHigh = h.minutes > maxMinutes * 0.5;
                            const isMedium = h.minutes > maxMinutes * 0.2;

                            return (
                                <motion.div
                                    key={i}
                                    initial={{ height: 0 }}
                                    animate={{ height: hasActivity ? `${heightPercent}%` : '2px' }}
                                    transition={{ duration: 0.6, delay: 0.6 + i * 0.03, type: 'spring', bounce: 0.2 }}
                                    className={`w-2.5 md:w-3 rounded-t-sm transition-colors ${
                                        isPeak
                                            ? 'bg-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.6)]'
                                            : isHigh
                                                ? 'bg-sky-500/80'
                                                : isMedium
                                                    ? 'bg-sky-500/50'
                                                    : hasActivity
                                                        ? 'bg-sky-500/30'
                                                        : 'bg-white/5'
                                    }`}
                                    title={`${i}${i18n.t('wrapped.hoursShort')}: ${Math.round(h.minutes)}${i18n.t('wrapped.minutesShort')}`}
                                />
                            );
                        })}
                    </div>
                    <div className="flex justify-between text-[10px] text-white/40 px-1 font-mono">
                        {hourMarkers.map((hour) => (
                            <span key={hour}>{hour}{i18n.t('wrapped.hoursShort')}</span>
                        ))}
                    </div>
                    {weekday && weekday.some(d => d.minutes > 0) && (
                        <div className="mt-4">
                            <div className="flex items-end justify-center gap-1.5 h-12">
                                {/* dow MySQL : 1=dimanche … 7=samedi → on affiche Lun→Dim */}
                                {[2, 3, 4, 5, 6, 7, 1].map((dow) => {
                                    const entry = weekday.find(d => d.dow === dow);
                                    const minutes = entry?.minutes || 0;
                                    const maxW = Math.max(1, ...weekday.map(d => d.minutes));
                                    const isTop = minutes === maxW && minutes > 0;
                                    return (
                                        <div key={dow} className="flex flex-col items-center gap-1 flex-1 h-full justify-end">
                                            <motion.div
                                                initial={{ height: 0 }}
                                                animate={{ height: minutes > 0 ? `${Math.max(12, (minutes / maxW) * 100)}%` : '2px' }}
                                                transition={{ duration: 0.5, delay: 1.4 }}
                                                className={`w-full rounded-t-sm ${isTop ? 'bg-sky-400' : minutes > 0 ? 'bg-sky-500/40' : 'bg-white/5'}`}
                                            />
                                            <span className="text-[9px] text-white/40 font-mono">
                                                {new Intl.DateTimeFormat(i18n.language, { weekday: 'narrow' }).format(new Date(2026, 0, 3 + dow))}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </motion.div>
            )}

            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2 }} className="mt-4">
                <AnimatedBorderCard highlightColor="56 189 248" backgroundColor="0 0 0" className="p-4 max-w-md backdrop-blur-md">
                    <p className="text-sm md:text-base text-white/80">{slide.text}</p>
                </AnimatedBorderCard>
            </motion.div>
        </WrappedCenteredSlide>
    );
};

// ==========================================
// SLIDE: STREAK
// ==========================================
const SlideStreak: React.FC<{ slide: WrappedSlide; stats: WrappedData['stats'] }> = ({ slide, stats }) => (
    <WrappedCenteredSlide contentClassName="max-w-4xl">
        <motion.div
            initial={{ scale: 0, y: -50 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ type: 'spring', duration: 0.8, bounce: 0.4 }}
            className="mb-8"
        >
            <div className="relative">
                <div
                    className="absolute inset-0 rounded-full scale-150 pointer-events-none"
                    style={{ background: 'radial-gradient(circle, rgba(249, 115, 22, 0.60) 0%, transparent 70%)' }}
                />
                <div className="relative w-28 h-28 md:w-36 md:h-36 rounded-3xl bg-gradient-to-br from-orange-400 via-red-500 to-rose-600 flex items-center justify-center shadow-2xl">
                    <Flame className="w-16 h-16 md:w-20 md:h-20 text-white" />
                </div>
            </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
            <h2 className="text-3xl md:text-5xl font-black mb-2">
                <ShinyText text={slide.title} speed={2} color="#f97316" shineColor="#ffffff" className="" />
            </h2>
        </motion.div>

        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} className="text-lg md:text-xl text-orange-300 mb-6 font-medium">
            {slide.subtitle}
        </motion.p>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}>
            <AnimatedBorderCard highlightColor="249 115 22" backgroundColor="0 0 0" className="p-6 max-w-xl backdrop-blur-md">
                <p className="text-base md:text-lg text-white/90 leading-relaxed">{slide.text}</p>
                {slide.subtext && <p className="mt-3 text-orange-400/70 text-sm italic">{slide.subtext}</p>}
            </AnimatedBorderCard>
        </motion.div>

        {/* Mini stats row */}
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1 }}
            className="mt-6 flex flex-wrap justify-center gap-4 sm:gap-6 md:gap-8"
        >
            {stats.longestStreak && (
                <div className="text-center">
                    <p className="text-2xl font-black text-orange-400">{stats.longestStreak}</p>
                    <p className="text-[10px] text-white/40 uppercase">{i18n.t('wrapped.bestStreak')}</p>
                </div>
            )}
            {stats.totalActiveDays && (
                <div className="text-center">
                    <p className="text-2xl font-black text-white">{stats.totalActiveDays}</p>
                    <p className="text-[10px] text-white/40 uppercase">{i18n.t('wrapped.activeDays')}</p>
                </div>
            )}
            {stats.percentile && (
                <div className="text-center">
                    <p className="text-2xl font-black text-amber-400">Top {100 - stats.percentile}%</p>
                    <p className="text-[10px] text-white/40 uppercase">{i18n.t('wrapped.ofViewers')}</p>
                </div>
            )}
        </motion.div>
    </WrappedCenteredSlide>
);

const SlideFunFact: React.FC<{ slide: WrappedSlide }> = ({ slide }) => (
    <WrappedCenteredSlide contentClassName="max-w-4xl">
        <motion.div
            initial={{ rotate: -20, scale: 0 }}
            animate={{ rotate: 0, scale: 1 }}
            transition={{ type: 'spring', duration: 0.8 }}
            className="mb-8"
        >
            <div className="relative">
                <div
                    className="absolute inset-0 rounded-full scale-150 pointer-events-none"
                    style={{ background: 'radial-gradient(circle, rgba(16, 185, 129, 0.45) 0%, transparent 70%)' }}
                />
                <span className="relative text-8xl md:text-9xl">{slide.highlight || '💡'}</span>
            </div>
        </motion.div>

        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
        >
            <h2 className="text-3xl md:text-5xl font-black mb-4">
                <ShinyText text={slide.title} speed={2} color="#34d399" shineColor="#ffffff" className="" />
            </h2>
        </motion.div>

        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
        >
            <AnimatedBorderCard
                highlightColor="52 211 153"
                backgroundColor="0 0 0"
                className="p-8 max-w-xl backdrop-blur-md"
            >
                <p className="text-lg md:text-xl text-white/90 leading-relaxed">
                    {slide.text}
                </p>
                {slide.subtext && (
                    <p className="mt-4 text-emerald-400/80 italic">{slide.subtext}</p>
                )}
            </AnimatedBorderCard>
        </motion.div>
    </WrappedCenteredSlide>
);

const CreditsRoll: React.FC<{ topContent: WrappedData['topContent']; topGenres?: WrappedData['topGenres']; stats: WrappedData['stats'] }> = ({ topContent, topGenres, stats }) => {
    const { t } = useTranslation();
    const prefersReducedMotion = useReducedMotion();
    const lines: { label: string; value: string }[] = [
        { label: t('wrapped.creditsDirectedBy'), value: t('wrapped.creditsYou') },
        ...(topContent.length ? [{ label: t('wrapped.creditsStarring'), value: topContent.slice(0, 5).map(c => c.title).join(' · ') }] : []),
        ...(topGenres?.length ? [{ label: t('wrapped.creditsGenre'), value: topGenres[0].name }] : []),
        { label: t('wrapped.creditsRuntime'), value: formatCompactDuration(stats.totalMinutes, t) },
        { label: t('wrapped.creditsProducedBy'), value: 'MOVIX' },
        { label: '©', value: DEFAULT_PUBLIC_DOMAIN },
    ];

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }} className="mt-6 h-36 w-full max-w-md overflow-hidden relative" style={{ maskImage: 'linear-gradient(to bottom, transparent, black 18%, black 82%, transparent)' }}>
            <motion.div
                initial={{ y: prefersReducedMotion ? 0 : 144 }}
                animate={prefersReducedMotion ? { y: 0 } : { y: -lines.length * 44 }}
                transition={prefersReducedMotion ? undefined : { duration: lines.length * 2.2, ease: 'linear', repeat: Infinity, repeatDelay: 1.2 }}
                className="flex flex-col items-center gap-3"
            >
                {lines.map((line) => (
                    <div key={line.label + line.value} className="text-center">
                        <p className="text-[10px] uppercase tracking-[0.3em] text-white/40">{line.label}</p>
                        <p className="text-sm md:text-base font-bold text-white/90 max-w-sm">{line.value}</p>
                    </div>
                ))}
            </motion.div>
        </motion.div>
    );
};

const SlideClosing: React.FC<{
    slide: WrappedSlide;
    stats: WrappedData['stats'];
    topContent: WrappedData['topContent'];
    topGenres?: WrappedData['topGenres'];
    onShareImage: () => void;
    onDownloadImage: () => void;
    onShareText: () => void;
    onCopyText: () => void;
    isPreparingImage: boolean;
    shareFormat: 'story' | 'poster' | 'ticket';
    onFormatChange: (f: 'story' | 'poster' | 'ticket') => void;
    previewUrl: string | null;
    isGeneratingPreview: boolean;
}> = ({
    slide,
    stats,
    topContent,
    topGenres,
    onShareImage,
    onDownloadImage,
    onShareText,
    onCopyText,
    isPreparingImage,
    shareFormat,
    onFormatChange,
    previewUrl,
    isGeneratingPreview
}) => (
    <WrappedCenteredSlide contentClassName="max-w-4xl">
        <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', duration: 0.8 }}
            className="mb-6"
        >
            <motion.div
                animate={{ boxShadow: ['0 0 30px #e879f9', '0 0 60px #e879f9', '0 0 30px #e879f9'] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="relative w-28 h-28 md:w-36 md:h-36 rounded-full bg-gradient-to-br from-fuchsia-500 via-purple-500 to-violet-600 flex items-center justify-center"
            >
                <span className="text-5xl md:text-6xl">{slide.highlight || '💜'}</span>
            </motion.div>
        </motion.div>

        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
        >
            <h2 className="text-3xl md:text-5xl font-black mb-2">
                <ShinyText text={slide.title} speed={2} color="#e879f9" shineColor="#ffffff" className="" />
            </h2>
        </motion.div>

        <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="text-xl md:text-2xl text-fuchsia-300 mb-4 font-semibold"
        >
            {slide.subtitle}
        </motion.p>

        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
        >
            <AnimatedBorderCard
                highlightColor="232 121 249"
                backgroundColor="0 0 0"
                className="p-6 max-w-xl backdrop-blur-md"
            >
                <p className="text-base md:text-lg text-white/90 leading-relaxed">
                    {slide.text}
                </p>
                {slide.subtext && (
                    <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 1 }}
                        className="mt-4 text-lg text-fuchsia-400 font-medium"
                    >
                        {slide.subtext}
                    </motion.p>
                )}
            </AnimatedBorderCard>
        </motion.div>

        {/* Générique de fin */}
        <CreditsRoll topContent={topContent} topGenres={topGenres} stats={stats} />

        {/* Stats summary */}
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1 }}
            className="mt-6 flex flex-wrap justify-center gap-4 sm:gap-6 md:gap-8"
        >
            {[
                { value: stats.totalHours > 0 ? stats.totalHours : stats.totalMinutes, label: stats.totalHours > 0 ? i18n.t('wrapped.statHours') : i18n.t('wrapped.statMinutes') },
                { value: stats.uniqueTitles, label: i18n.t('wrapped.statTitles') },
                { value: stats.totalSessions, label: i18n.t('wrapped.statSessions') }
            ].map((stat, i) => (
                <motion.div
                    key={stat.label}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 1.2 + i * 0.1 }}
                    className="text-center"
                >
                    <p className="text-2xl md:text-3xl font-black text-white">
                        <AnimatedCounter value={stat.value} duration={1.5} />
                    </p>
                    <p className="text-fuchsia-400 text-xs">{stat.label}</p>
                </motion.div>
            ))}
        </motion.div>

        <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.5 }}
            className="mt-6 w-full max-w-xl"
        >
            <AnimatedBorderCard
                highlightColor="232 121 249"
                backgroundColor="0 0 0"
                className="p-4 md:p-5 backdrop-blur-md"
            >
                <div className="flex items-center justify-center gap-2 mb-2">
                    <Share2 className="w-4 h-4 text-fuchsia-300" />
                    <p className="text-sm md:text-base font-semibold text-white">
                        {i18n.t('wrapped.shareOptionsTitle')}
                    </p>
                </div>
                <p className="text-sm text-white/60 mb-4">
                    {i18n.t('wrapped.shareOptionsDesc')}
                </p>

                <div className="mb-3 flex items-center justify-center gap-2">
                    {([['story', i18n.t('wrapped.shareFormatStory')], ['poster', i18n.t('wrapped.shareFormatPoster')], ['ticket', i18n.t('wrapped.shareFormatTicket')]] as const).map(([fmt, label]) => (
                        <button
                            key={fmt}
                            onClick={() => onFormatChange(fmt)}
                            className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors border ${
                                shareFormat === fmt
                                    ? 'border-fuchsia-400/60 bg-fuchsia-500/25 text-white'
                                    : 'border-white/10 bg-white/[0.04] text-white/60 hover:text-white'
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                {/* Préviz du format sélectionné (cliquer = ouvrir en plein écran dans un nouvel onglet) */}
                <div className="mb-4 flex justify-center">
                    <button
                        type="button"
                        onClick={() => { if (previewUrl) window.open(previewUrl, '_blank', 'noopener'); }}
                        disabled={!previewUrl}
                        className={`relative h-48 overflow-hidden rounded-xl border border-white/10 bg-black/40 transition-transform hover:scale-[1.02] sm:h-56 ${shareFormat === 'poster' ? 'aspect-[2/3]' : 'aspect-[9/16]'}`}
                    >
                        {previewUrl ? (
                            <img
                                src={previewUrl}
                                alt={i18n.t('wrapped.shareFormatsTitle')}
                                className="h-full w-full object-cover"
                                draggable={false}
                            />
                        ) : (
                            <span className="flex h-full w-full items-center justify-center">
                        <Loader2 className="h-5 w-5 animate-spin text-white opacity-40" />
                            </span>
                        )}
                        {isGeneratingPreview && previewUrl && (
                            <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                      <Loader2 className="h-5 w-5 animate-spin text-white opacity-70" />
                            </span>
                        )}
                    </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={onShareImage}
                        disabled={isPreparingImage}
                        className="flex items-center justify-center gap-2 rounded-2xl border border-fuchsia-400/25 bg-gradient-to-r from-fuchsia-500/20 to-purple-500/20 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
                    >
                        {isPreparingImage ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
                        {isPreparingImage ? i18n.t('wrapped.generatingImage') : i18n.t('wrapped.shareAsImage')}
                    </motion.button>

                    <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={onDownloadImage}
                        disabled={isPreparingImage}
                        className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white/90 disabled:opacity-60"
                    >
                        <Download className="w-4 h-4 text-white opacity-90" />
                        {i18n.t('wrapped.downloadImage')}
                    </motion.button>

                    <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={onShareText}
                        className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white/90"
                    >
                        <FileText className="w-4 h-4 text-white opacity-90" />
                        {i18n.t('wrapped.shareAsText')}
                    </motion.button>

                    <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={onCopyText}
                        className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white/90"
                    >
                        <Copy className="w-4 h-4 text-white opacity-90" />
                        {i18n.t('wrapped.copyText')}
                    </motion.button>
                </div>
            </AnimatedBorderCard>
        </motion.div>
    </WrappedCenteredSlide>
);

// ==========================================
// SLIDE DETAILED STATS (Slide 8)
// ==========================================
const SlideDetailedStats: React.FC<{
    slide: WrappedSlide;
    data: WrappedData;
    tmdbData: Map<number, TMDBData>;
}> = ({ slide, data, tmdbData }) => (
    <div
        className="relative z-10 flex h-full w-full flex-col items-center overflow-y-auto px-4 text-center scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent sm:px-6"
        style={wrappedSlideViewportStyle}
        data-lenis-prevent
        onWheel={(e) => e.stopPropagation()}
    >
        {/* Header */}
        <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 flex-shrink-0"
        >
            <div className="flex items-center justify-center gap-3 mb-2">
                <BarChart3 className="w-8 h-8 text-cyan-400" />
                <h2 className="text-2xl md:text-3xl font-black">
                    <ShinyText text={slide.title} speed={2} color="#22d3ee" shineColor="#ffffff" className="" />
                </h2>
            </div>
            <p className="text-cyan-300/70">{slide.subtitle}</p>
        </motion.div>

        {/* Time Stats Grid */}
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="w-full max-w-lg mb-4"
        >
            <div className="grid grid-cols-4 gap-2">
                {[
                    { value: data.stats.totalMinutes.toLocaleString(i18n.language), label: i18n.t('wrapped.minutes') },
                    { value: data.stats.totalHours > 0 ? data.stats.totalHours.toLocaleString(i18n.language) : data.stats.totalMinutes.toLocaleString(i18n.language), label: data.stats.totalHours > 0 ? i18n.t('wrapped.hours') : i18n.t('wrapped.minutes') },
                    { value: data.stats.totalDays.toFixed(1), label: i18n.t('wrapped.days') },
                    { value: (data.stats.totalDays / 7).toFixed(1), label: i18n.t('wrapped.weeks') },
                ].map((stat, i) => (
                    <motion.div
                        key={stat.label}
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.2 + i * 0.05 }}
                        className="bg-white/10 rounded-xl p-2"
                    >
                        <p className="text-lg md:text-xl font-black text-white">{stat.value}</p>
                        <p className="text-[10px] text-cyan-400">{stat.label}</p>
                    </motion.div>
                ))}
            </div>
        </motion.div>

        {/* Content Type Breakdown */}
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="w-full max-w-lg mb-4"
        >
            <h3 className="text-sm font-semibold text-cyan-400 mb-2 text-left">📊 {i18n.t('wrapped.byType')}</h3>
            <div className="space-y-2">
                {data.byType.map((item, i) => (
                    <motion.div
                        key={item.type}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.3 + i * 0.05 }}
                        className="bg-white/10 rounded-lg p-2"
                    >
                        <div className="flex items-center justify-between mb-1">
                            <span className="text-white text-sm font-medium flex items-center gap-1.5">
                                {item.type === 'movie' && '🎬'}
                                {item.type === 'tv' && '📺'}
                                {item.type === 'anime' && '⛩️'}
                                {item.type === 'live-tv' && '📡'}
                                {item.type === 'movie' ? i18n.t('wrapped.moviesLabel') :
                                 item.type === 'tv' ? i18n.t('wrapped.seriesPlural') :
                                   item.type === 'anime' ? i18n.t('wrapped.animeType') : i18n.t('wrapped.liveTVLabel')}
                            </span>
                            <span className="text-white/50 text-xs">{item.count} • {Math.round(item.minutes / 60)}h</span>
                        </div>
                        <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                            <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${item.percent}%` }}
                                transition={{ duration: 1, delay: 0.4 + i * 0.1 }}
                                className="h-full bg-gradient-to-r from-cyan-500 to-teal-400"
                            />
                        </div>
                    </motion.div>
                ))}
            </div>
        </motion.div>

        {/* Top Content with TMDB Posters */}
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="w-full max-w-lg mb-4"
        >
            <h3 className="text-sm font-semibold text-cyan-400 mb-2 text-left">🏆 {i18n.t('wrapped.topContents')}</h3>
            <div className="space-y-2">
                {data.topContent.slice(0, 5).map((item, index) => {
                    const tmdb = item.tmdbId ? tmdbData.get(item.tmdbId) : null;
                    const posterUrl = tmdb?.poster_path
                        ? `${TMDB_IMAGE_BASE}${tmdb.poster_path}`
                        : item.poster_path
                            ? `${TMDB_IMAGE_BASE}${item.poster_path}`
                            : null;

                    return (
                        <motion.div
                            key={index}
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.5 + index * 0.05 }}
                            className="flex items-center gap-3 bg-white/10 rounded-xl p-2"
                        >
                            {/* Poster */}
                            <div className="relative w-12 h-16 rounded-lg overflow-hidden flex-shrink-0 bg-white/10">
                                {posterUrl ? (
                                    <img
                                        src={posterUrl}
                                        alt={item.title}
                                        className="w-full h-full object-cover"
                                        onError={(e) => {
                                            (e.target as HTMLImageElement).style.display = 'none';
                                        }}
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-2xl">
                                        {item.type === 'movie' ? '🎬' : item.type === 'tv' ? '📺' : item.type === 'anime' ? '⛩️' : '📡'}
                                    </div>
                                )}
                                {/* Rank Badge */}
                                <div className={`absolute -top-1 -left-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                                    index === 0 ? 'bg-gradient-to-br from-amber-400 to-orange-500 text-white' :
                                    index === 1 ? 'bg-gradient-to-br from-slate-300 to-slate-400 text-slate-800' :
                                    index === 2 ? 'bg-gradient-to-br from-amber-600 to-amber-700 text-white' :
                                    'bg-white/20 text-white/60'
                                }`}>
                                    {index + 1}
                                </div>
                            </div>

                            {/* Info */}
                            <div className="flex-1 min-w-0 text-left">
                                <p className="font-semibold text-white text-sm truncate">
                                    {tmdb?.title || tmdb?.name || item.title}
                                </p>
                                <div className="flex items-center gap-2 text-xs text-white/40">
                                    <span>
                                        {item.type === 'movie' ? i18n.t('wrapped.movieType') :
                                         item.type === 'tv' ? i18n.t('wrapped.seriesSingular') :
                                         item.type === 'anime' ? i18n.t('wrapped.animeType') : i18n.t('wrapped.tvType')}
                                    </span>
                                    {tmdb?.vote_average && (
                                        <span className="flex items-center gap-0.5">
                                            ⭐ {tmdb.vote_average.toFixed(1)}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Hours */}
                            <div className="text-right">
                                <p className="text-cyan-400 font-bold">{item.durationLabel || formatDurationShort(item.minutes)}</p>
                            </div>
                        </motion.div>
                    );
                })}
            </div>
        </motion.div>

        {/* Bottom Stats */}
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.7 }}
            className="w-full max-w-lg grid grid-cols-2 gap-2"
        >
            <div className="bg-white/10 rounded-xl p-3 text-center">
                <p className="text-2xl font-black text-white">{data.stats.uniqueTitles}</p>
                <p className="text-xs text-cyan-400">{i18n.t('wrapped.uniqueTitlesLabel')}</p>
            </div>
            <div className="bg-white/10 rounded-xl p-3 text-center">
                <p className="text-2xl font-black text-white">{data.stats.totalSessions}</p>
                <p className="text-xs text-cyan-400">{i18n.t('wrapped.sessionsLabel')}</p>
            </div>
        </motion.div>

        {/* Peak Month */}
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8 }}
            className="w-full max-w-lg mt-4"
        >
            <div className="bg-gradient-to-r from-cyan-500/20 to-teal-500/20 rounded-xl p-3 text-center">
                <p className="text-white/60 text-xs mb-1">{i18n.t('wrapped.mostActiveMonth')}</p>
                <p className="text-xl font-black text-white">{data.peakMonth.name}</p>
                <p className="text-cyan-400 text-sm">{Math.round(data.peakMonth.minutes / 60)} {i18n.t('wrapped.peakMonthHours')}</p>
            </div>
        </motion.div>
    </div>
);

const SlideSessionSummary: React.FC<{
    slide: WrappedSlide;
    stats: WrappedData['stats'];
}> = ({ slide, stats }) => (
    <WrappedCenteredSlide contentClassName="max-w-4xl">
        <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', duration: 0.7 }}
            className="mb-8"
        >
            <div className="relative">
                <div
                    className="absolute inset-0 rounded-full scale-150 pointer-events-none"
                    style={{ background: 'radial-gradient(circle, rgba(6, 182, 212, 0.38) 0%, transparent 70%)' }}
                />
                <div className="relative w-28 h-28 md:w-36 md:h-36 rounded-3xl bg-gradient-to-br from-cyan-500 via-sky-500 to-blue-600 flex items-center justify-center shadow-2xl">
                    <Clock className="w-14 h-14 md:w-16 md:h-16 text-white" />
                </div>
            </div>
        </motion.div>

        <motion.h2
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-3xl md:text-5xl font-black mb-3"
        >
            <ShinyText text={slide.title} speed={2} color="#22d3ee" shineColor="#ffffff" className="" />
        </motion.h2>

        <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.35 }}
            className="text-lg md:text-xl text-cyan-300 mb-6 font-medium"
        >
            {slide.subtitle}
        </motion.p>

        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45 }}
            className="w-full max-w-3xl grid grid-cols-2 gap-3 md:grid-cols-4"
        >
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-md">
                <p className="text-2xl md:text-3xl font-black text-white">
                    {stats.avgSessionMinutes ? formatCompactDuration(stats.avgSessionMinutes, (key, options) => i18n.t(key, options)) : '-'}
                </p>
                <p className="mt-1 text-xs text-cyan-300/80">{i18n.t('wrapped.avgSessionLabel')}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-md">
                <p className="text-2xl md:text-3xl font-black text-white">{stats.totalSessions.toLocaleString(i18n.language)}</p>
                <p className="mt-1 text-xs text-cyan-300/80">{i18n.t('wrapped.statSessions')}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-md">
                <p className="text-2xl md:text-3xl font-black text-white">{(stats.totalActiveDays || 0).toLocaleString(i18n.language)}</p>
                <p className="mt-1 text-xs text-cyan-300/80">{i18n.t('wrapped.activeDaysLabel')}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-md">
                <p className="text-2xl md:text-3xl font-black text-white">
                    {stats.percentile ? i18n.t('wrapped.percentileValue', { percent: Math.max(1, 100 - stats.percentile) }) : '-'}
                </p>
                <p className="mt-1 text-xs text-cyan-300/80">{i18n.t('wrapped.percentileLabel')}</p>
            </div>
        </motion.div>

        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.65 }}
            className="w-full max-w-xl mt-5"
        >
            <AnimatedBorderCard
                highlightColor="34 211 238"
                backgroundColor="0 0 0"
                className="p-6 backdrop-blur-md"
            >
                <p className="text-base md:text-lg text-white/90 leading-relaxed">{slide.text}</p>
            </AnimatedBorderCard>
        </motion.div>
    </WrappedCenteredSlide>
);

const SlideWatchBookends: React.FC<{
    slide: WrappedSlide;
    firstWatch?: WrappedData['firstWatch'];
    lastWatch?: WrappedData['lastWatch'];
}> = ({ slide, firstWatch, lastWatch }) => {
    const formatDateLabel = (date?: string | null) => {
        if (!date) return i18n.t('wrapped.unknownDate');

        try {
            return new Date(date).toLocaleDateString(i18n.language, {
                day: 'numeric',
                month: 'long',
            });
        } catch {
            return i18n.t('wrapped.unknownDate');
        }
    };

    const items = [
        {
            key: 'first',
            label: i18n.t('wrapped.firstWatchLabel'),
            title: firstWatch?.title || i18n.t('wrapped.unknownContent'),
            date: formatDateLabel(firstWatch?.date),
            accent: 'from-emerald-500/25 to-teal-500/10',
        },
        {
            key: 'last',
            label: i18n.t('wrapped.lastWatchLabel'),
            title: lastWatch?.title || i18n.t('wrapped.unknownContent'),
            date: formatDateLabel(lastWatch?.date),
            accent: 'from-fuchsia-500/25 to-purple-500/10',
        },
    ];

    return (
        <WrappedCenteredSlide contentClassName="max-w-4xl">
            <motion.div
                initial={{ scale: 0.82, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', duration: 0.7 }}
                className="mb-8"
            >
                <div className="relative">
                    <div
                        className="absolute inset-0 rounded-full scale-150 pointer-events-none"
                        style={{ background: 'radial-gradient(circle, rgba(16, 185, 129, 0.38) 0%, transparent 70%)' }}
                    />
                    <div className="relative w-28 h-28 md:w-36 md:h-36 rounded-3xl bg-gradient-to-br from-emerald-500 via-teal-500 to-fuchsia-500 flex items-center justify-center shadow-2xl">
                        <Calendar className="w-14 h-14 md:w-16 md:h-16 text-white" />
                    </div>
                </div>
            </motion.div>

            <motion.h2
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="text-3xl md:text-5xl font-black mb-3"
            >
                <ShinyText text={slide.title} speed={2} color="#34d399" shineColor="#ffffff" className="" />
            </motion.h2>

            <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.35 }}
                className="text-lg md:text-xl text-emerald-300 mb-6 font-medium"
            >
                {slide.subtitle}
            </motion.p>

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.45 }}
                className="w-full max-w-3xl grid gap-3 md:grid-cols-2"
            >
                {items.map((item, index) => (
                    <motion.div
                        key={item.key}
                        initial={{ opacity: 0, x: index === 0 ? -20 : 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.55 + index * 0.1 }}
                        className={`rounded-3xl border border-white/10 bg-gradient-to-br ${item.accent} p-5 text-left backdrop-blur-md`}
                    >
                        <p className="text-[11px] uppercase tracking-[0.18em] text-white/45 mb-3">{item.label}</p>
                        <p className="text-xl md:text-2xl font-black text-white leading-tight mb-2">{item.title}</p>
                        <p className="text-sm text-white/65">{item.date}</p>
                    </motion.div>
                ))}
            </motion.div>

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.8 }}
                className="w-full max-w-xl mt-5"
            >
                <AnimatedBorderCard
                    highlightColor="52 211 153"
                    backgroundColor="0 0 0"
                    className="p-6 backdrop-blur-md"
                >
                    <p className="text-base md:text-lg text-white/90 leading-relaxed">{slide.text}</p>
                </AnimatedBorderCard>
            </motion.div>
        </WrappedCenteredSlide>
    );
};

// ==========================================
// SLIDE: TIMELINE (12 mois)
// ==========================================
const SlideTimeline: React.FC<{ slide: WrappedSlide; monthlyGraph?: WrappedData['monthlyGraph']; peakMonth: WrappedData['peakMonth'] }> = ({ slide, monthlyGraph, peakMonth }) => {
    const maxMinutes = monthlyGraph && monthlyGraph.length ? Math.max(1, ...monthlyGraph.map(m => m.minutes)) : 1;
    const monthShort = (m: number) => new Intl.DateTimeFormat(i18n.language, { month: 'narrow' }).format(new Date(2026, m - 1, 1));

    return (
        <WrappedCenteredSlide contentClassName="max-w-4xl">
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', duration: 0.8 }} className="mb-6">
                <div className="relative">
                    <div className="absolute inset-0 rounded-full scale-150 pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(99, 102, 241, 0.55) 0%, transparent 70%)' }} />
                    <div className="relative w-28 h-28 md:w-36 md:h-36 rounded-3xl bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-600 flex items-center justify-center shadow-2xl rotate-3">
                        <TrendingUp className="w-14 h-14 md:w-16 md:h-16 text-white" />
                    </div>
                </div>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                <h2 className="text-3xl md:text-5xl font-black mb-2">
                    <ShinyText text={slide.title} speed={2} color="#818cf8" shineColor="#ffffff" className="" />
                </h2>
            </motion.div>

            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="text-lg text-indigo-300 mb-6 font-medium">
                {slide.subtitle}
            </motion.p>

            {monthlyGraph && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} className="w-full max-w-md">
                    <div className="flex items-end justify-center gap-1.5 h-32 mb-2">
                        {monthlyGraph.map((m) => {
                            const isPeak = m.month === peakMonth.month && m.minutes > 0;
                            const heightPercent = m.minutes > 0 ? Math.max(8, (m.minutes / maxMinutes) * 100) : 0;
                            return (
                                <div key={m.month} className="flex flex-col items-center gap-1 flex-1 h-full justify-end">
                                    <motion.div
                                        initial={{ height: 0 }}
                                        animate={{ height: m.minutes > 0 ? `${heightPercent}%` : '2px' }}
                                        transition={{ duration: 0.6, delay: 0.6 + m.month * 0.04, type: 'spring', bounce: 0.2 }}
                                        className={`w-full rounded-t-md ${isPeak ? 'bg-indigo-400 shadow-[0_0_12px_rgba(129,140,248,0.6)]' : m.minutes > 0 ? 'bg-indigo-500/60' : 'bg-white/5'}`}
                                    />
                                    <span className={`text-[10px] font-mono ${isPeak ? 'text-indigo-300' : 'text-white/40'}`}>{monthShort(m.month)}</span>
                                </div>
                            );
                        })}
                    </div>
                </motion.div>
            )}

            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.1 }} className="mt-4">
                <AnimatedBorderCard highlightColor="129 140 248" backgroundColor="0 0 0" className="p-4 max-w-md backdrop-blur-md">
                    <p className="text-sm md:text-base text-white/85">{slide.text}</p>
                    {slide.subtext && <p className="mt-2 text-indigo-400/80 italic text-sm">{slide.subtext}</p>}
                </AnimatedBorderCard>
            </motion.div>
        </WrappedCenteredSlide>
    );
};

// ==========================================
// SLIDE: RECORD DAY
// ==========================================
const SlideRecordDay: React.FC<{ slide: WrappedSlide }> = ({ slide }) => (
    <WrappedCenteredSlide contentClassName="max-w-4xl">
        <motion.div initial={{ scale: 0, rotate: -12 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', duration: 0.8 }} className="mb-8">
            <div className="relative">
                <div className="absolute inset-0 rounded-full scale-150 pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(245, 158, 11, 0.5) 0%, transparent 70%)' }} />
                <div className="relative w-28 h-28 md:w-36 md:h-36 rounded-3xl bg-gradient-to-br from-amber-500 via-orange-500 to-red-500 flex items-center justify-center shadow-2xl -rotate-3">
                    <Trophy className="w-14 h-14 md:w-16 md:h-16 text-white" />
                </div>
            </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <h2 className="text-4xl md:text-6xl font-black mb-3">
                <ShinyText text={slide.title} speed={2} color="#f59e0b" shineColor="#ffffff" className="" />
            </h2>
        </motion.div>

        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="text-xl md:text-2xl text-amber-300 mb-6 font-semibold">
            {slide.subtitle}
        </motion.p>

        {slide.highlight && (
            <motion.p initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.5, type: 'spring' }} className="text-5xl md:text-7xl font-black text-white mb-8">
                {slide.highlight}
            </motion.p>
        )}

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}>
            <AnimatedBorderCard highlightColor="245 158 11" backgroundColor="0 0 0" className="p-8 max-w-xl backdrop-blur-md">
                <p className="text-lg md:text-xl text-white/90 leading-relaxed">{slide.text}</p>
                {slide.subtext && <p className="mt-4 text-amber-400/80 italic">{slide.subtext}</p>}
            </AnimatedBorderCard>
        </motion.div>
    </WrappedCenteredSlide>
);

// ==========================================
// SLIDE: REWATCH
// ==========================================
const SlideRewatch: React.FC<{ slide: WrappedSlide }> = ({ slide }) => (
    <WrappedCenteredSlide contentClassName="max-w-4xl">
        <motion.div initial={{ scale: 0, rotate: 180 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', duration: 0.9 }} className="mb-8">
            <div className="relative">
                <div className="absolute inset-0 rounded-full scale-150 pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(16, 185, 129, 0.5) 0%, transparent 70%)' }} />
                <div className="relative w-28 h-28 md:w-36 md:h-36 rounded-3xl bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-600 flex items-center justify-center shadow-2xl rotate-3">
                    <Repeat className="w-14 h-14 md:w-16 md:h-16 text-white" />
                </div>
            </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <h2 className="text-4xl md:text-6xl font-black mb-3">
                <ShinyText text={slide.title} speed={2} color="#10b981" shineColor="#ffffff" className="" />
            </h2>
        </motion.div>

        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="text-xl md:text-2xl text-emerald-300 mb-6 font-semibold">
            {slide.subtitle}
        </motion.p>

        {slide.highlight && (
            <motion.p initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.5, type: 'spring' }} className="text-5xl md:text-7xl font-black text-white mb-8">
                {slide.highlight}
            </motion.p>
        )}

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}>
            <AnimatedBorderCard highlightColor="16 185 129" backgroundColor="0 0 0" className="p-8 max-w-xl backdrop-blur-md">
                <p className="text-lg md:text-xl text-white/90 leading-relaxed">{slide.text}</p>
                {slide.subtext && <p className="mt-4 text-emerald-400/80 italic">{slide.subtext}</p>}
            </AnimatedBorderCard>
        </motion.div>
    </WrappedCenteredSlide>
);

// ==========================================
// SLIDE: WATCH AGE (âge ciné)
// ==========================================
const SlideWatchAge: React.FC<{ slide: WrappedSlide }> = ({ slide }) => (
    <WrappedCenteredSlide contentClassName="max-w-4xl">
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', duration: 0.8 }} className="mb-8">
            <div className="relative">
                <div className="absolute inset-0 rounded-full scale-150 pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(168, 85, 247, 0.5) 0%, transparent 70%)' }} />
                <div className="relative w-28 h-28 md:w-36 md:h-36 rounded-3xl bg-gradient-to-br from-violet-500 via-purple-500 to-fuchsia-600 flex items-center justify-center shadow-2xl rotate-3">
                    <Hourglass className="w-14 h-14 md:w-16 md:h-16 text-white" />
                </div>
            </div>
        </motion.div>

        {slide.highlight && (
            <motion.p initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.3, type: 'spring' }} className="text-7xl md:text-9xl font-black text-white mb-4 tracking-tight">
                {slide.highlight}
            </motion.p>
        )}

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
            <h2 className="text-3xl md:text-5xl font-black mb-3">
                <ShinyText text={slide.title} speed={2} color="#a855f7" shineColor="#ffffff" className="" />
            </h2>
        </motion.div>

        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }} className="text-xl md:text-2xl text-purple-300 mb-8 font-semibold">
            {slide.subtitle}
        </motion.p>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }}>
            <AnimatedBorderCard highlightColor="168 85 247" backgroundColor="0 0 0" className="p-8 max-w-xl backdrop-blur-md">
                <p className="text-lg md:text-xl text-white/90 leading-relaxed">{slide.text}</p>
                {slide.subtext && <p className="mt-4 text-purple-400/80 italic">{slide.subtext}</p>}
            </AnimatedBorderCard>
        </motion.div>
    </WrappedCenteredSlide>
);

// ==========================================
// SLIDE: PAGES TIME (temps de navigation)
// ==========================================
const SlidePagesTime: React.FC<{ slide: WrappedSlide; topPages: WrappedData['topPages'] }> = ({ slide, topPages }) => {
    const { t } = useTranslation();
    const pages = (topPages || []).filter(p => p.page !== 'live-tv').slice(0, 5);
    const maxMinutes = pages.length ? Math.max(1, ...pages.map(p => p.minutes)) : 1;
    const pageLabel = (page: string) => {
        const key = `wrapped.pageNames.${page}`;
        const label = t(key);
        return label === key ? page : label;
    };

    return (
        <WrappedCenteredSlide contentClassName="max-w-4xl">
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', duration: 0.8 }} className="mb-6">
                <div className="relative">
                    <div className="absolute inset-0 rounded-full scale-150 pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(34, 211, 238, 0.45) 0%, transparent 70%)' }} />
                    <div className="relative w-28 h-28 md:w-36 md:h-36 rounded-3xl bg-gradient-to-br from-cyan-500 via-sky-500 to-blue-600 flex items-center justify-center shadow-2xl -rotate-3">
                        <MousePointerClick className="w-14 h-14 md:w-16 md:h-16 text-white" />
                    </div>
                </div>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                <h2 className="text-3xl md:text-5xl font-black mb-2">
                    <ShinyText text={slide.title} speed={2} color="#22d3ee" shineColor="#ffffff" className="" />
                </h2>
            </motion.div>

            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="text-lg text-cyan-300 mb-6 font-medium">
                {slide.subtitle}
            </motion.p>

            {pages.length > 0 && (
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="w-full max-w-md space-y-3 mb-6">
                    {pages.map((p, i) => (
                        <motion.div key={p.page} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.6 + i * 0.1 }} className="flex items-center gap-3">
                            <span className="text-sm text-white/60 w-16 text-right font-mono">{formatDurationShort(p.minutes)}</span>
                            <div className="flex-1 h-8 bg-white/5 rounded-lg overflow-hidden relative">
                                <motion.div
                                    initial={{ width: 0 }}
                                    animate={{ width: `${Math.max(10, (p.minutes / maxMinutes) * 100)}%` }}
                                    transition={{ duration: 1, delay: 0.7 + i * 0.1 }}
                                    className="h-full bg-gradient-to-r from-cyan-500 to-sky-400 rounded-lg"
                                />
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white text-sm font-medium capitalize">{pageLabel(p.page)}</span>
                            </div>
                        </motion.div>
                    ))}
                </motion.div>
            )}

            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2 }}>
                <AnimatedBorderCard highlightColor="34 211 238" backgroundColor="0 0 0" className="p-4 max-w-md backdrop-blur-md">
                    <p className="text-sm md:text-base text-white/85">{slide.text}</p>
                    {slide.subtext && <p className="mt-2 text-cyan-400/80 italic text-sm">{slide.subtext}</p>}
                </AnimatedBorderCard>
            </motion.div>
        </WrappedCenteredSlide>
    );
};

// ==========================================
// SLIDE: QUIZ — "Devine ton top 1"
// ==========================================
const SlideQuiz: React.FC<{ slide: WrappedSlide; topContent: WrappedData['topContent']; onContinue: () => void }> = ({ slide, topContent, onContinue }) => {
    const { t } = useTranslation();
    const [picked, setPicked] = useState<number | null>(null);
    // Ordre d'affichage déterministe : top 3 réordonné par (tmdbId % 3)
    const options = useMemo(() => {
        const top3 = topContent.slice(0, 3);
        const offset = (top3[0]?.tmdbId || 0) % 3;
        return top3.map((_, i) => top3[(i + offset) % 3]);
    }, [topContent]);
    const revealed = picked !== null;
    const isCorrect = revealed && options[picked!]?.rank === 1;

    return (
        <WrappedCenteredSlide contentClassName="max-w-4xl">
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', duration: 0.8 }} className="mb-6">
                <div className="relative">
                    <div className="absolute inset-0 rounded-full scale-150 pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(251, 191, 36, 0.5) 0%, transparent 70%)' }} />
                    <div className="relative w-24 h-24 md:w-32 md:h-32 rounded-3xl bg-gradient-to-br from-amber-400 via-orange-500 to-rose-500 flex items-center justify-center shadow-2xl rotate-3">
                        <HelpCircle className="w-12 h-12 md:w-16 md:h-16 text-white" />
                    </div>
                </div>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                <h2 className="text-3xl md:text-5xl font-black mb-2">
                    <ShinyText text={revealed ? (isCorrect ? t('wrapped.quizCorrect') : t('wrapped.quizWrong')) : slide.title} speed={2} color="#fbbf24" shineColor="#ffffff" className="" />
                </h2>
            </motion.div>

            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="text-lg md:text-xl text-amber-300 mb-8 font-medium">
                {revealed ? t('wrapped.quizRevealSubtitle') : slide.subtitle}
            </motion.p>

            <div className="flex items-center justify-center gap-3 md:gap-6 mb-8">
                {options.map((item, i) => {
                    const isTop1 = item.rank === 1;
                    const isPicked = picked === i;
                    return (
                        <motion.button
                            key={item.rank}
                            initial={{ opacity: 0, y: 30 }}
                            animate={{ opacity: 1, y: 0, scale: revealed && isTop1 ? 1.08 : revealed && isPicked && !isTop1 ? 0.94 : 1 }}
                            transition={{ delay: 0.5 + i * 0.15, type: 'spring' }}
                            whileHover={!revealed ? { scale: 1.05, rotate: i === 1 ? 0 : i === 0 ? -2 : 2 } : undefined}
                            onClick={() => { if (!revealed) setPicked(i); }}
                            disabled={revealed}
                            className={`relative w-24 md:w-40 aspect-[2/3] rounded-2xl overflow-hidden border-2 transition-colors ${
                                revealed && isTop1 ? 'border-amber-400 shadow-[0_0_30px_rgba(251,191,36,0.5)]'
                                : revealed && isPicked ? 'border-red-400/70'
                                : 'border-white/15'
                            }`}
                        >
                            {item.poster_path ? (
                                <img
                                    src={`${TMDB_IMAGE_BASE}${item.poster_path}`}
                                    alt=""
                                    className={`w-full h-full object-cover transition-all duration-700 ${revealed ? 'blur-0 scale-100' : 'blur-xl scale-110'}`}
                                    draggable={false}
                                />
                            ) : (
                                <div className="w-full h-full bg-gradient-to-br from-white/10 to-white/5 flex items-center justify-center text-3xl">🎬</div>
                            )}
                            {revealed && (
                                <div className="absolute inset-x-0 bottom-0 bg-black/80 px-2 py-1.5">
                                    <p className="text-[10px] md:text-xs text-white font-semibold truncate">#{item.rank} · {item.title}</p>
                                </div>
                            )}
                        </motion.button>
                    );
                })}
            </div>

            {!revealed ? (
                <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2 }} onClick={onContinue} className="text-sm text-white/50 underline underline-offset-4 hover:text-white/80 transition-colors">
                    {t('wrapped.quizSkip')}
                </motion.button>
            ) : (
                <motion.button
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}
                    onClick={onContinue}
                    className="rounded-2xl border border-amber-400/30 bg-gradient-to-r from-amber-500/20 to-orange-500/20 px-6 py-3 text-sm font-semibold text-white"
                >
                    {t('wrapped.quizContinue')}
                </motion.button>
            )}
        </WrappedCenteredSlide>
    );
};

// ==========================================
// SLIDE BACKGROUNDS
// ==========================================
const slideBackgrounds: Record<string, { color: string; gradient: string }> = {
    intro: { color: 'rgba(168, 85, 247, 0.15)', gradient: 'from-purple-500/20 via-transparent to-transparent' },
    top1: { color: 'rgba(251, 191, 36, 0.15)', gradient: 'from-amber-500/20 via-transparent to-transparent' },
    'top2-focus': { color: 'rgba(203, 213, 225, 0.15)', gradient: 'from-slate-300/20 via-transparent to-transparent' },
    'top3-focus': { color: 'rgba(251, 146, 60, 0.15)', gradient: 'from-orange-400/20 via-transparent to-transparent' },
    top5: { color: 'rgba(45, 212, 191, 0.15)', gradient: 'from-teal-500/20 via-transparent to-transparent' },
    persona: { color: 'rgba(255, 152, 0, 0.15)', gradient: 'from-orange-500/20 via-transparent to-transparent' },
    'peak-month': { color: 'rgba(129, 140, 248, 0.15)', gradient: 'from-indigo-500/20 via-transparent to-transparent' },
    'top-genres': { color: 'rgba(244, 63, 94, 0.15)', gradient: 'from-rose-500/20 via-transparent to-transparent' },
    'listening-clock': { color: 'rgba(56, 189, 248, 0.15)', gradient: 'from-sky-500/20 via-transparent to-transparent' },
    'streak': { color: 'rgba(249, 115, 22, 0.15)', gradient: 'from-orange-500/20 via-transparent to-transparent' },
    'fun-fact': { color: 'rgba(52, 211, 153, 0.15)', gradient: 'from-emerald-500/20 via-transparent to-transparent' },
    'session-summary': { color: 'rgba(34, 211, 238, 0.15)', gradient: 'from-cyan-500/20 via-transparent to-transparent' },
    'watch-bookends': { color: 'rgba(52, 211, 153, 0.15)', gradient: 'from-emerald-500/20 via-transparent to-transparent' },
    closing: { color: 'rgba(232, 121, 249, 0.15)', gradient: 'from-fuchsia-500/20 via-transparent to-transparent' },
    'detailed-stats': { color: 'rgba(34, 211, 238, 0.15)', gradient: 'from-cyan-500/20 via-transparent to-transparent' },
    timeline: { color: 'rgba(129, 140, 248, 0.15)', gradient: 'from-indigo-500/20 via-transparent to-transparent' },
    'record-day': { color: 'rgba(245, 158, 11, 0.15)', gradient: 'from-amber-500/20 via-transparent to-transparent' },
    rewatch: { color: 'rgba(16, 185, 129, 0.15)', gradient: 'from-emerald-500/20 via-transparent to-transparent' },
    'watch-age': { color: 'rgba(168, 85, 247, 0.15)', gradient: 'from-purple-500/20 via-transparent to-transparent' },
    'pages-time': { color: 'rgba(34, 211, 238, 0.15)', gradient: 'from-cyan-500/20 via-transparent to-transparent' },
    quiz: { color: 'rgba(251, 191, 36, 0.15)', gradient: 'from-amber-400/20 via-transparent to-transparent' },
};

// ==========================================
// MAIN WRAPPED PAGE COMPONENT
// ==========================================
const WrappedPage: React.FC<{ data: WrappedData; onClose: () => void }> = ({ data: sourceData, onClose }) => {
    const navigate = useNavigate();
    const { t } = useTranslation();
    const [wrappedData, setWrappedData] = useState<WrappedData | null>(null);
    const [loading, setLoading] = useState(true);
    const [currentSlide, setCurrentSlide] = useState(0);
    const [direction, setDirection] = useState(0);
    const [tmdbData, setTmdbData] = useState<Map<number, TMDBData>>(new Map());
    const [noData, setNoData] = useState(false);
    const [wrappedProgress, setWrappedProgress] = useState<WrappedProgress | null>(null);
    const [isPreparingShareImage, setIsPreparingShareImage] = useState(false);
    const [shareFormat, setShareFormat] = useState<'story' | 'poster' | 'ticket'>('story');
    const [isPodiumTrailerLoaded, setIsPodiumTrailerLoaded] = useState(false);
    const bgMode = (localStorage.getItem('settings_bg_mode') as 'combined' | 'static' | 'animated') || 'combined';

    const year = sourceData.year;
    const topWrappedItem = wrappedData?.topContent[0];
    const topWrappedGenre = wrappedData?.topGenres?.[0];
    const formattedShareWatchTime = wrappedData ? formatCompactDuration(wrappedData.stats.totalMinutes, t) : '';
    const [soundEffectsEnabled, setSoundEffectsEnabled] = useState(() => areSoundEffectsEnabled());
    const [hasWrappedInteraction, setHasWrappedInteraction] = useState(false);

    const wrappedShareText = useMemo(() => {
        if (!wrappedData) return '';

        return [
            t('wrapped.shareTitle', { year }),
            t('wrapped.shareSummaryLine', { watchTime: formattedShareWatchTime }),
            t('wrapped.shareTitlesLine', { count: wrappedData.stats.uniqueTitles }),
            topWrappedItem ? t('wrapped.shareTopContentLine', { title: topWrappedItem.title }) : null,
            topWrappedGenre ? t('wrapped.shareTopGenreLine', { genre: topWrappedGenre.name }) : null,
            wrappedData.persona?.title ? t('wrapped.sharePersonaLine', { persona: wrappedData.persona.title }) : null,
            t('wrapped.shareHashtag')
        ].filter(Boolean).join('\n');
    }, [formattedShareWatchTime, topWrappedGenre, topWrappedItem, wrappedData, t, year]);

    useEffect(() => {
        const syncSoundSetting = () => setSoundEffectsEnabled(areSoundEffectsEnabled());

        window.addEventListener(SOUND_EFFECTS_CHANGED_EVENT, syncSoundSetting as EventListener);
        window.addEventListener('storage', syncSoundSetting);

        return () => {
            window.removeEventListener(SOUND_EFFECTS_CHANGED_EVENT, syncSoundSetting as EventListener);
            window.removeEventListener('storage', syncSoundSetting);
        };
    }, []);

    useEffect(() => {
        if (hasWrappedInteraction) return;

        const markInteraction = () => setHasWrappedInteraction(true);

        window.addEventListener('pointerdown', markInteraction, { passive: true });
        window.addEventListener('keydown', markInteraction);

        return () => {
            window.removeEventListener('pointerdown', markInteraction);
            window.removeEventListener('keydown', markInteraction);
        };
    }, [hasWrappedInteraction]);

    // Le payload backend contient déjà poster/backdrop/year/vote — zéro re-fetch TMDB.
    const buildTmdbDataFromPayload = useCallback((topContent: WrappedTopContent[]) => {
        const map = new Map<number, TMDBData>();
        topContent.forEach((item) => {
            if (!item.tmdbId) return;
            map.set(item.tmdbId, {
                id: item.tmdbId,
                title: item.title,
                name: item.title,
                poster_path: item.poster_path ?? null,
                backdrop_path: item.backdrop_path ?? null,
                vote_average: item.vote_average ?? undefined,
                release_date: item.year ? `${item.year}-01-01` : undefined,
                genres: (item.genres || []).map((name, i) => ({ id: i, name })),
                // trailerKey: undefined = pas encore fetché (lazy au slide podium)
            });
        });
        setTmdbData(map);
    }, []);

    useEffect(() => {
        const loadWrapped = async () => {
            setLoading(true);

            const response: WrappedResponse = { success: true, wrapped: structuredClone(sourceData) };

            if (response?.success && response.wrapped) {
                // Hotfix: Ensure detailed-stats slide exists if backend doesn't send it yet
                const hasStats = response.wrapped.slides.some((s: WrappedSlide) => s.type === 'detailed-stats');
                if (!hasStats) {
                    const closingIndex = response.wrapped.slides.findIndex((s: WrappedSlide) => s.type === 'closing');
                    const statsSlide: WrappedSlide = {
                        type: "detailed-stats",
                        title: t('wrapped.yourStatistics'),
                        subtitle: t('wrapped.inDetail'),
                        text: t('wrapped.yearSummary'),
                        highlight: "📊",
                        subtext: ""
                    };

                    if (closingIndex !== -1) {
                        response.wrapped.slides.splice(closingIndex, 0, statsSlide);
                    } else {
                        response.wrapped.slides.push(statsSlide);
                    }
                }

                const top1Index = response.wrapped.slides.findIndex((s: WrappedSlide) => s.type === 'top1');
                const hasTop2Focus = response.wrapped.slides.some((s: WrappedSlide) => s.type === 'top2-focus');
                const hasTop3Focus = response.wrapped.slides.some((s: WrappedSlide) => s.type === 'top3-focus');
                const podiumSlides: WrappedSlide[] = [];

                if (!hasTop3Focus && response.wrapped.topContent[2]) {
                    const item = response.wrapped.topContent[2];
                    podiumSlides.push({
                        type: 'top3-focus',
                        title: item.title,
                        subtitle: t('wrapped.top3FocusSubtitle'),
                        text: t('wrapped.podiumFocusText', {
                            watchTime: formatCompactDuration(item.minutes, t),
                            type: formatWrappedTypeLabel(item.type, t),
                        }),
                        subtext: t('wrapped.top3FocusSubtext'),
                    });
                }

                if (!hasTop2Focus && response.wrapped.topContent[1]) {
                    const item = response.wrapped.topContent[1];
                    podiumSlides.push({
                        type: 'top2-focus',
                        title: item.title,
                        subtitle: t('wrapped.top2FocusSubtitle'),
                        text: t('wrapped.podiumFocusText', {
                            watchTime: formatCompactDuration(item.minutes, t),
                            type: formatWrappedTypeLabel(item.type, t),
                        }),
                        subtext: t('wrapped.top2FocusSubtext'),
                    });
                }

                if (podiumSlides.length > 0 && top1Index !== -1) {
                    response.wrapped.slides.splice(top1Index, 0, ...podiumSlides);
                }

                // Quiz "devine ton top 1" — avant le podium (3 titres avec posters requis)
                const hasQuiz = response.wrapped.slides.some((s: WrappedSlide) => s.type === 'quiz');
                const quizEligible = !hasQuiz && response.wrapped.topContent.slice(0, 3).filter((c: WrappedTopContent) => c.poster_path).length === 3;
                if (quizEligible) {
                    const firstPodiumIndex = response.wrapped.slides.findIndex((s: WrappedSlide) =>
                        s.type === 'top3-focus' || s.type === 'top2-focus' || s.type === 'top1');
                    if (firstPodiumIndex !== -1) {
                        response.wrapped.slides.splice(firstPodiumIndex, 0, {
                            type: 'quiz',
                            title: t('wrapped.quizTitle'),
                            subtitle: t('wrapped.quizSubtitle'),
                            text: ''
                        });
                    }
                }

                const bonusSlides: WrappedSlide[] = [];
                const hasSessionSummary = response.wrapped.slides.some((s: WrappedSlide) => s.type === 'session-summary');
                const hasWatchBookends = response.wrapped.slides.some((s: WrappedSlide) => s.type === 'watch-bookends');

                if (!hasSessionSummary) {
                    bonusSlides.push({
                        type: 'session-summary',
                        title: t('wrapped.sessionSummaryTitle'),
                        subtitle: t('wrapped.sessionSummarySubtitle'),
                        text: t('wrapped.sessionSummaryText', {
                            average: formatCompactDuration(response.wrapped.stats.avgSessionMinutes || 0, t),
                            activeDays: (response.wrapped.stats.totalActiveDays || 0).toLocaleString(i18n.language),
                        }),
                    });
                }

                if (!hasWatchBookends && (response.wrapped.firstWatch || response.wrapped.lastWatch)) {
                    bonusSlides.push({
                        type: 'watch-bookends',
                        title: t('wrapped.watchBookendsTitle'),
                        subtitle: t('wrapped.watchBookendsSubtitle'),
                        text: t('wrapped.watchBookendsText', {
                            first: response.wrapped.firstWatch?.title || t('wrapped.unknownContent'),
                            last: response.wrapped.lastWatch?.title || t('wrapped.unknownContent'),
                        }),
                    });
                }

                if (bonusSlides.length > 0) {
                    const recordDayIndex = response.wrapped.slides.findIndex((s: WrappedSlide) => s.type === 'record-day');
                    const rewatchIndex = response.wrapped.slides.findIndex((s: WrappedSlide) => s.type === 'rewatch');
                    const top5Index = response.wrapped.slides.findIndex((s: WrappedSlide) => s.type === 'top5');
                    const anchorIndex = recordDayIndex !== -1 ? recordDayIndex : rewatchIndex !== -1 ? rewatchIndex : top5Index;
                    const insertIndex = anchorIndex !== -1
                        ? anchorIndex + 1
                        : response.wrapped.slides.findIndex((s: WrappedSlide) => s.type === 'persona');

                    if (insertIndex !== -1) {
                        response.wrapped.slides.splice(insertIndex, 0, ...bonusSlides);
                    } else {
                        response.wrapped.slides.push(...bonusSlides);
                    }
                }

                setWrappedData(response.wrapped);
                setWrappedProgress(response.progress ?? null);
                setNoData(false);
                // Build TMDB data map from enriched backend payload (zero network)
                buildTmdbDataFromPayload(response.wrapped.topContent);
            } else {
                // No data available for this user/year
                setWrappedData(null);
                setWrappedProgress(response?.progress ?? null);
                setNoData(true);
            }

            setLoading(false);
        };

        loadWrapped();
    }, [year, sourceData, buildTmdbDataFromPayload, t]);

    const goToSlide = useCallback((index: number) => {
        if (!wrappedData) return;
        const newIndex = Math.max(0, Math.min(index, wrappedData.slides.length - 1));
        setDirection(newIndex > currentSlide ? 1 : -1);
        setCurrentSlide(newIndex);
    }, [currentSlide, wrappedData]);

    const nextSlide = useCallback(() => {
        if (!wrappedData) return;
        if (currentSlide < wrappedData.slides.length - 1) {
            setDirection(1);
            setCurrentSlide(prev => prev + 1);
        }
    }, [currentSlide, wrappedData]);

    const prevSlide = useCallback(() => {
        if (currentSlide > 0) {
            setDirection(-1);
            setCurrentSlide(prev => prev - 1);
        }
    }, [currentSlide]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'ArrowRight' || e.key === ' ') {
                e.preventDefault();
                nextSlide();
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                prevSlide();
            } else if (e.key === 'Escape') {
                onClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [nextSlide, prevSlide, onClose]);

    // Trailers : fetch lazy à l'arrivée sur une slide podium uniquement
    useEffect(() => {
        if (!wrappedData) return;
        const slideType = wrappedData.slides[currentSlide]?.type;
        const idx = slideType === 'top1' ? 0 : slideType === 'top2-focus' ? 1 : slideType === 'top3-focus' ? 2 : -1;
        if (idx === -1) return;
        const item = wrappedData.topContent[idx];
        if (!item?.tmdbId) return;
        const existing = tmdbData.get(item.tmdbId);
        if (existing && existing.trailerKey !== undefined) return; // déjà fetché

        let cancelled = false;
        (async () => {
            let trailerKey: string | null = null;
            try {
                const mediaType = item.type === 'tv' || item.type === 'anime' ? 'tv' : 'movie';
                const res = await axios.get(`https://api.themoviedb.org/3/${mediaType}/${item.tmdbId}/videos`, { params: { api_key: TMDB_API_KEY, language: getTmdbLanguage() } });
                let trailer = res.data.results?.find((v: { site: string; type: string; key: string }) => v.site === 'YouTube' && v.type === 'Trailer');
                if (!trailer) {
                    const resEN = await axios.get(`https://api.themoviedb.org/3/${mediaType}/${item.tmdbId}/videos`, { params: { api_key: TMDB_API_KEY, language: 'en-US' } });
                    trailer = resEN.data.results?.find((v: { site: string; type: string; key: string }) => v.site === 'YouTube' && v.type === 'Trailer')
                        || resEN.data.results?.find((v: { site: string; type: string; key: string }) => v.site === 'YouTube');
                }
                trailerKey = trailer?.key || null;
            } catch {
                trailerKey = null;
            }
            if (cancelled) return;
            setTmdbData(prev => {
                const next = new Map(prev);
                const cur = next.get(item.tmdbId!);
                if (cur) next.set(item.tmdbId!, { ...cur, trailerKey });
                return next;
            });
        })();
        return () => { cancelled = true; };
    }, [currentSlide, wrappedData, tmdbData]);

    const handleDragEnd = (_: unknown, info: PanInfo) => {
        const threshold = 50;
        if (info.offset.x < -threshold) nextSlide();
        else if (info.offset.x > threshold) prevSlide();
    };

    const generateWrappedShareImage = useCallback(async (): Promise<Blob | null> => {
        if (!wrappedData) return null;
        await ensureShareFonts();

        const canvas = document.createElement('canvas');
        canvas.width = WRAPPED_SHARE_IMAGE_WIDTH;
        canvas.height = WRAPPED_SHARE_IMAGE_HEIGHT;

        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        const width = canvas.width;
        const height = canvas.height;

        const exportTopItems = wrappedData.topContent.slice(0, 3);
        const exportTopAssets = await Promise.all(exportTopItems.map(async (item) => {
            const tmdb = item.tmdbId ? tmdbData.get(item.tmdbId) : null;
            const posterSource = tmdb?.poster_path
                ? `${TMDB_IMAGE_BASE}${tmdb.poster_path}`
                : item.poster_path
                    ? `${TMDB_IMAGE_BASE}${item.poster_path}`
                    : null;
            const backdropSource = tmdb?.backdrop_path
                ? `${TMDB_IMAGE_BASE}${tmdb.backdrop_path}`
                : null;

            return {
                item,
                tmdb,
                posterImage: posterSource ? await loadCanvasImage(posterSource) : null,
                backdropImage: backdropSource ? await loadCanvasImage(backdropSource) : null,
            };
        }));

        const topAsset = exportTopAssets[0] ?? null;
        const topItem = topAsset?.item || topWrappedItem;
        const posterImage = topAsset?.posterImage || null;
        const backdropImage = topAsset?.backdropImage || null;
        const topTypeLabel = topItem ? formatWrappedTypeLabel(topItem.type, t) : t('wrapped.movieType');

        const getTypeInitial = (type?: WrappedTopContent['type']) => {
            if (type === 'tv') return t('wrapped.seriesSingular').charAt(0).toUpperCase();
            if (type === 'anime') return t('wrapped.animeType').charAt(0).toUpperCase();
            return t('wrapped.movieType').charAt(0).toUpperCase();
        };

        const fillCenteredText = (text: string, y: number) => {
            ctx.fillText(text, (width - ctx.measureText(text).width) / 2, y);
        };

        const fillTextCenteredInArea = (text: string, x: number, areaWidth: number, y: number) => {
            ctx.fillText(text, x + (areaWidth - ctx.measureText(text).width) / 2, y);
        };

        const drawPill = (
            x: number,
            y: number,
            text: string,
            {
                fill,
                textColor,
                paddingX = 22,
                height: pillHeight = 42,
                font = '800 22px Inter, system-ui, sans-serif',
                stroke,
            }: {
                fill: string | CanvasGradient;
                textColor: string | CanvasGradient;
                paddingX?: number;
                height?: number;
                font?: string;
                stroke?: string;
            }
        ) => {
            ctx.save();
            ctx.font = font;
            const pillWidth = Math.ceil(ctx.measureText(text).width + paddingX * 2);
            drawRoundedRectPath(ctx, x, y, pillWidth, pillHeight, pillHeight / 2);
            ctx.fillStyle = fill;
            ctx.fill();
            if (stroke) {
                ctx.strokeStyle = stroke;
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
            ctx.fillStyle = textColor;
            ctx.fillText(text, x + paddingX, y + pillHeight - 13);
            ctx.restore();
            return pillWidth;
        };

        const drawPosterCard = ({
            x,
            y,
            w,
            h,
            rotation,
            image,
            fallbackLabel,
            rank,
            borderColor,
            chipFill,
            chipTextColor,
            withMeta,
        }: {
            x: number;
            y: number;
            w: number;
            h: number;
            rotation: number;
            image: HTMLImageElement | null;
            fallbackLabel: string;
            rank: string;
            borderColor: string;
            chipFill: string;
            chipTextColor: string;
            withMeta?: boolean;
        }) => {
            ctx.save();
            ctx.translate(x + w / 2, y + h / 2);
            ctx.rotate(rotation);

            ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
            ctx.shadowBlur = 48;
            ctx.shadowOffsetY = 24;
            drawRoundedRectPath(ctx, -w / 2, -h / 2, w, h, 34);
            ctx.fillStyle = 'rgba(14, 14, 18, 0.94)';
            ctx.fill();

            ctx.shadowColor = 'transparent';
            drawRoundedRectPath(ctx, -w / 2, -h / 2, w, h, 34);
            ctx.strokeStyle = borderColor;
            ctx.lineWidth = 3;
            ctx.stroke();

            if (image) {
                ctx.save();
                drawRoundedRectPath(ctx, -w / 2 + 10, -h / 2 + 10, w - 20, h - 20, 26);
                ctx.clip();
                ctx.drawImage(image, -w / 2 + 10, -h / 2 + 10, w - 20, h - 20);
                ctx.restore();

                const overlayGradient = ctx.createLinearGradient(0, h / 2 - 140, 0, h / 2);
                overlayGradient.addColorStop(0, 'rgba(0,0,0,0)');
                overlayGradient.addColorStop(1, 'rgba(0,0,0,0.85)');
                drawRoundedRectPath(ctx, -w / 2 + 10, -h / 2 + 10, w - 20, h - 20, 26);
                ctx.fillStyle = overlayGradient;
                ctx.fill();
            } else {
                const fallbackGradient = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
                fallbackGradient.addColorStop(0, 'rgba(255, 93, 93, 0.55)');
                fallbackGradient.addColorStop(0.5, 'rgba(255, 159, 67, 0.35)');
                fallbackGradient.addColorStop(1, 'rgba(78, 205, 196, 0.3)');
                drawRoundedRectPath(ctx, -w / 2 + 10, -h / 2 + 10, w - 20, h - 20, 26);
                ctx.fillStyle = fallbackGradient;
                ctx.fill();

                ctx.fillStyle = '#ffffff';
                ctx.font = `${withMeta ? '900 118px' : '900 68px'} Inter, system-ui, sans-serif`;
                const letterWidth = ctx.measureText(fallbackLabel).width;
                ctx.fillText(fallbackLabel, -letterWidth / 2, withMeta ? 34 : 24);
            }

            drawRoundedRectPath(ctx, -w / 2 + 18, -h / 2 + 18, 82, 42, 21);
            ctx.fillStyle = chipFill;
            ctx.fill();
            ctx.fillStyle = chipTextColor;
            ctx.font = '900 24px Inter, system-ui, sans-serif';
            ctx.fillText(rank, -w / 2 + 44, -h / 2 + 46);

            if (withMeta) {
                drawRoundedRectPath(ctx, -w / 2 + 20, h / 2 - 126, w - 40, 94, 24);
                ctx.fillStyle = 'rgba(10, 10, 12, 0.86)';
                ctx.fill();
                ctx.strokeStyle = 'rgba(255,255,255,0.08)';
                ctx.lineWidth = 1.5;
                ctx.stroke();

                ctx.fillStyle = 'rgba(255,255,255,0.82)';
                ctx.font = '700 20px Inter, system-ui, sans-serif';
                fillTextCenteredInArea(topTypeLabel, -w / 2 + 20, w - 40, h / 2 - 88);

                ctx.fillStyle = '#ffffff';
                ctx.font = '900 30px Inter, system-ui, sans-serif';
                fillTextCenteredInArea(topItem ? formatCompactDuration(topItem.minutes, t) : formattedShareWatchTime, -w / 2 + 20, w - 40, h / 2 - 46);
            }

            ctx.restore();
        };

        const accentGradient = ctx.createLinearGradient(0, 0, width, 0);
        accentGradient.addColorStop(0, '#ff5f56');
        accentGradient.addColorStop(0.5, '#ff7a59');
        accentGradient.addColorStop(1, '#f6c453');

        const titleGradient = ctx.createLinearGradient(100, 0, width - 100, 0);
        titleGradient.addColorStop(0, '#ffffff');
        titleGradient.addColorStop(0.35, '#ffd7d1');
        titleGradient.addColorStop(1, '#ff7a59');

        ctx.fillStyle = '#060606';
        ctx.fillRect(0, 0, width, height);

        if (backdropImage) {
            const targetHeight = 1100;
            const scale = Math.max(width / backdropImage.width, targetHeight / backdropImage.height);
            const drawWidth = backdropImage.width * scale;
            const drawHeight = backdropImage.height * scale;
            const drawX = (width - drawWidth) / 2;
            const drawY = 120;
            ctx.save();
            ctx.globalAlpha = 0.18;
            ctx.drawImage(backdropImage, drawX, drawY, drawWidth, drawHeight);
            ctx.restore();
        }

        const baseGradient = ctx.createLinearGradient(0, 0, width, height);
        baseGradient.addColorStop(0, '#0a0a0a');
        baseGradient.addColorStop(0.42, '#111112');
        baseGradient.addColorStop(1, '#090909');
        ctx.fillStyle = baseGradient;
        ctx.fillRect(0, 0, width, height);

        const topGlow = ctx.createRadialGradient(width * 0.5, 240, 20, width * 0.5, 240, 460);
        topGlow.addColorStop(0, 'rgba(255, 95, 86, 0.28)');
        topGlow.addColorStop(0.55, 'rgba(255, 95, 86, 0.12)');
        topGlow.addColorStop(1, 'rgba(255, 95, 86, 0)');
        ctx.fillStyle = topGlow;
        ctx.fillRect(0, 0, width, height);

        const sideGlow = ctx.createRadialGradient(width * 0.82, height * 0.78, 40, width * 0.82, height * 0.78, 440);
        sideGlow.addColorStop(0, 'rgba(78, 205, 196, 0.18)');
        sideGlow.addColorStop(1, 'rgba(78, 205, 196, 0)');
        ctx.fillStyle = sideGlow;
        ctx.fillRect(0, 0, width, height);

        const lowerGlow = ctx.createRadialGradient(width * 0.2, height * 0.82, 20, width * 0.2, height * 0.82, 360);
        lowerGlow.addColorStop(0, 'rgba(246, 196, 83, 0.14)');
        lowerGlow.addColorStop(1, 'rgba(246, 196, 83, 0)');
        ctx.fillStyle = lowerGlow;
        ctx.fillRect(0, 0, width, height);

        for (let i = 0; i < 7; i += 1) {
            const y = 214 + i * 196;
            ctx.strokeStyle = 'rgba(255,255,255,0.035)';
            ctx.lineWidth = 1.25;
            ctx.beginPath();
            ctx.moveTo(90, y);
            ctx.lineTo(width - 90, y);
            ctx.stroke();
        }

        for (let i = 0; i < 26; i += 1) {
            const dotX = 40 + ((i * 149) % (width - 80));
            const dotY = 60 + ((i * 211) % (height - 120));
            ctx.fillStyle = `rgba(255,255,255,${i % 5 === 0 ? 0.1 : 0.05})`;
            ctx.beginPath();
            ctx.arc(dotX, dotY, i % 4 === 0 ? 2 : 1.1, 0, Math.PI * 2);
            ctx.fill();
        }

        drawSeededStickers(ctx, width, height, (topItem?.tmdbId || 0) + year);

        const brandIconX = 280;
        const brandIconY = 226;
        ctx.strokeStyle = '#ff5f56';
        ctx.lineWidth = 7;
        drawRoundedRectPath(ctx, brandIconX, brandIconY, 54, 38, 12);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(297, brandIconY);
        ctx.lineTo(307, brandIconY - 10);
        ctx.moveTo(319, brandIconY);
        ctx.lineTo(307, brandIconY - 10);
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = '900 54px Inter, system-ui, sans-serif';
        ctx.fillText('MOVIX', 356, 262);
        ctx.fillStyle = accentGradient;
        ctx.fillText('Wrapped', 557, 262);

        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.07)';
        ctx.lineWidth = 3;
        ctx.font = '900 184px Inter, system-ui, sans-serif';
        ctx.strokeText(String(year), (width - ctx.measureText(String(year)).width) / 2, 396);
        ctx.restore();

        ctx.fillStyle = 'rgba(255,255,255,0.52)';
        ctx.font = '800 22px Inter, system-ui, sans-serif';
        fillCenteredText(`MOVIX WRAPPED ${year}`, 330);

        ctx.fillStyle = '#ffffff';
        ctx.font = '900 68px Inter, system-ui, sans-serif';
        fillCenteredText(`Ton top ${year}`, 404);

        ctx.fillStyle = titleGradient;
        ctx.font = '900 82px Inter, system-ui, sans-serif';
        const mainTitleLines = wrapCanvasText(ctx, topItem?.title || t('wrapped.title'), 860).slice(0, 2);
        mainTitleLines.forEach((line, index) => {
            fillCenteredText(line, 488 + index * 86);
        });

        const chips = [
            { text: topItem ? formatCompactDuration(topItem.minutes, t) : formattedShareWatchTime, fill: 'rgba(255,95,86,0.18)', textColor: '#ff9e94', stroke: 'rgba(255,95,86,0.35)' },
            { text: topTypeLabel, fill: 'rgba(255,255,255,0.08)', textColor: '#ffffff', stroke: 'rgba(255,255,255,0.12)' },
            { text: '#1', fill: 'rgba(246,196,83,0.2)', textColor: '#f6c453', stroke: 'rgba(246,196,83,0.35)' },
        ];

        ctx.font = '800 22px Inter, system-ui, sans-serif';
        const chipWidths = chips.map(({ text }) => Math.ceil(ctx.measureText(text).width + 44));
        const totalChipWidth = chipWidths.reduce((sum, item) => sum + item, 0) + (chips.length - 1) * 14;
        let chipX = (width - totalChipWidth) / 2;
        const chipY = 620;
        chips.forEach((chip, index) => {
            const usedWidth = drawPill(chipX, chipY, chip.text, {
                fill: chip.fill,
                textColor: chip.textColor,
                stroke: chip.stroke,
            });
            chipX += usedWidth + (index < chips.length - 1 ? 14 : 0);
        });

        drawPosterCard({ x: 222, y: 700, w: 210, h: 300, rotation: -0.14, image: exportTopAssets[1]?.posterImage || null, fallbackLabel: getTypeInitial(exportTopAssets[1]?.item.type), rank: '#2', borderColor: 'rgba(246,196,83,0.8)', chipFill: '#f6c453', chipTextColor: '#181818' });
        drawPosterCard({ x: 648, y: 700, w: 210, h: 300, rotation: 0.14, image: exportTopAssets[2]?.posterImage || null, fallbackLabel: getTypeInitial(exportTopAssets[2]?.item.type), rank: '#3', borderColor: 'rgba(78,205,196,0.78)', chipFill: '#4ecdc4', chipTextColor: '#0f1212' });
        drawPosterCard({ x: 345, y: 668, w: 390, h: 560, rotation: -0.035, image: posterImage, fallbackLabel: getTypeInitial(topItem?.type), rank: '#1', borderColor: 'rgba(255,122,89,0.96)', chipFill: '#ff7a59', chipTextColor: '#190d0b', withMeta: true });

        ctx.fillStyle = 'rgba(255,255,255,0.74)';
        ctx.font = '700 22px Inter, system-ui, sans-serif';
        fillCenteredText(t('wrapped.shareTop3Label'), 1268);

        const streakCount = wrappedData.stats.longestStreak || 0;
        const pctl = wrappedData.stats.percentile;
        const lastTile = (pctl != null && pctl >= 90)
            ? { label: t('wrapped.shareTopPercentLabel').toUpperCase(), value: `TOP ${100 - pctl}%`, accent: '#a78bfa' }
            : { label: t('wrapped.shareStreakLabel').toUpperCase(), value: t('wrapped.shareStreakValue', { days: streakCount }), accent: '#a78bfa' };

        const tiles = [
            { label: (wrappedData.stats.totalHours > 0 ? t('wrapped.statHours') : t('wrapped.statMinutes')).toUpperCase(), value: (wrappedData.stats.totalHours > 0 ? wrappedData.stats.totalHours : wrappedData.stats.totalMinutes).toLocaleString(i18n.language), accent: '#ff7a59' },
            { label: t('wrapped.statTitles').toUpperCase(), value: wrappedData.stats.uniqueTitles.toLocaleString(i18n.language), accent: '#f6c453' },
            { label: t('wrapped.statSessions').toUpperCase(), value: wrappedData.stats.totalSessions.toLocaleString(i18n.language), accent: '#4ecdc4' },
            { label: t('wrapped.sharePersonaLabel').toUpperCase(), value: `${wrappedData.persona.emoji} ${wrappedData.persona.title}`, accent: wrappedData.persona.color || '#ff7a59' },
            { label: t('wrapped.shareGenreLabel').toUpperCase(), value: topWrappedGenre?.name || t('wrapped.shareGenreFallback'), accent: '#f6c453' },
            lastTile,
        ];

        const tileW = 296, tileH = 130, tileGap = 16;
        tiles.forEach((tile, index) => {
            const col = index % 3;
            const row = Math.floor(index / 3);
            const tileX = 78 + col * (tileW + tileGap);
            const tileY = 1310 + row * (tileH + tileGap + 2);

            drawRoundedRectPath(ctx, tileX, tileY, tileW, tileH, 26);
            ctx.fillStyle = 'rgba(16,16,18,0.92)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.1)';
            ctx.lineWidth = 2;
            ctx.stroke();

            drawRoundedRectPath(ctx, tileX + 18, tileY + 16, 54, 7, 4);
            ctx.fillStyle = tile.accent;
            ctx.fill();

            ctx.fillStyle = 'rgba(255,255,255,0.48)';
            ctx.font = '800 15px Inter, system-ui, sans-serif';
            ctx.fillText(tile.label, tileX + 18, tileY + 48);

            ctx.fillStyle = '#ffffff';
            const isBigNumber = index < 3;
            ctx.font = isBigNumber ? '900 44px Inter, system-ui, sans-serif' : '800 23px Inter, system-ui, sans-serif';
            const tileLines = wrapCanvasText(ctx, tile.value, tileW - 36).slice(0, 2);
            tileLines.forEach((line, lineIndex) => {
                ctx.fillText(line, tileX + 18, tileY + (isBigNumber ? 102 : 82) + lineIndex * 27);
            });
        });

        // Barre des genres (top 3 empilés)
        if (wrappedData.topGenres && wrappedData.topGenres.length > 0) {
            const segs = wrappedData.topGenres.slice(0, 3);
            const segTotal = segs.reduce((s, g) => s + g.percent, 0) || 1;
            const segColors = ['#ff7a59', '#f6c453', '#4ecdc4'];
            const barX = 78, barW = width - 156, barY = 1638, barH = 34;

            ctx.save();
            drawRoundedRectPath(ctx, barX, barY, barW, barH, 17);
            ctx.clip();
            let segX = barX;
            segs.forEach((g, i) => {
                const w = barW * (g.percent / segTotal);
                ctx.fillStyle = segColors[i];
                ctx.fillRect(segX, barY, w, barH);
                if (w > 150) {
                    ctx.fillStyle = 'rgba(10,10,12,0.85)';
                    ctx.font = '800 17px Inter, system-ui, sans-serif';
                    ctx.fillText(`${g.name} ${g.percent}%`, segX + 14, barY + 23);
                }
                segX += w;
            });
            ctx.restore();
        }

        const footerDividerY = 1706;
        const footerTextY = 1748;

        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(78, footerDividerY);
        ctx.lineTo(width - 78, footerDividerY);
        ctx.stroke();

        ctx.fillStyle = 'rgba(255,255,255,0.76)';
        ctx.font = '800 26px Inter, system-ui, sans-serif';
        ctx.fillText(t('wrapped.shareFooterTag'), 78, footerTextY);

        ctx.fillStyle = 'rgba(255,255,255,0.36)';
        ctx.font = '600 26px Inter, system-ui, sans-serif';
        const domainLabel = DEFAULT_PUBLIC_DOMAIN;
        ctx.fillText(domainLabel, width - 78 - ctx.measureText(domainLabel).width, footerTextY);

        return new Promise((resolve) => {
            canvas.toBlob((blob) => resolve(blob), 'image/png');
        });
    }, [formattedShareWatchTime, t, tmdbData, topWrappedGenre?.name, topWrappedItem, wrappedData, year]);

    const buildShareCardData = useCallback((): WrappedShareCardData | null => {
        if (!wrappedData) return null;
        const top3 = wrappedData.topContent.slice(0, 3);
        const top1 = top3[0];
        const tmdb = top1?.tmdbId ? tmdbData.get(top1.tmdbId) : null;
        return {
            year,
            totalHours: wrappedData.stats.totalHours,
            totalMinutes: wrappedData.stats.totalMinutes,
            uniqueTitles: wrappedData.stats.uniqueTitles,
            totalSessions: wrappedData.stats.totalSessions,
            longestStreak: wrappedData.stats.longestStreak || 0,
            peakHour: wrappedData.peakHour ?? null,
            peakMonthName: wrappedData.peakMonth.name,
            peakMonthIndex: wrappedData.peakMonth.month,
            personaTitle: wrappedData.persona.title,
            personaEmoji: wrappedData.persona.emoji,
            personaColor: wrappedData.persona.color,
            topTitles: wrappedData.topContent.slice(0, 5).map(c => c.title),
            topGenreName: topWrappedGenre?.name || null,
            watchTimeLabel: formattedShareWatchTime,
            topPosterUrl: top1?.poster_path ? `${TMDB_IMAGE_BASE}${top1.poster_path}` : null,
            topBackdropUrl: (tmdb?.backdrop_path || top1?.backdrop_path) ? `https://image.tmdb.org/t/p/w1280${tmdb?.backdrop_path || top1?.backdrop_path}` : null,
            posterUrls: top3.map(c => (c.poster_path ? `${TMDB_IMAGE_BASE}${c.poster_path}` : null)),
            seed: (top1?.tmdbId || 0) + year,
        };
    }, [wrappedData, tmdbData, topWrappedGenre?.name, formattedShareWatchTime, year]);

    const generateShareBlob = useCallback(async (): Promise<Blob | null> => {
        if (shareFormat === 'story') return generateWrappedShareImage();
        const data = buildShareCardData();
        if (!data) return null;
        return shareFormat === 'poster' ? generatePosterShareImage(data) : generateTicketShareImage(data);
    }, [shareFormat, generateWrappedShareImage, buildShareCardData]);

    // Cache des blobs par format : partagé entre la préviz, le téléchargement et le partage
    // (une seule génération canvas par format et par session de slide).
    const shareBlobCacheRef = useRef<Partial<Record<'story' | 'poster' | 'ticket', Blob>>>({});
    const [sharePreviewUrl, setSharePreviewUrl] = useState<string | null>(null);
    const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);

    const getOrGenerateShareBlob = useCallback(async (): Promise<Blob | null> => {
        const cached = shareBlobCacheRef.current[shareFormat];
        if (cached) return cached;
        const blob = await generateShareBlob();
        if (blob) shareBlobCacheRef.current[shareFormat] = blob;
        return blob;
    }, [shareFormat, generateShareBlob]);

    // Préviz : générée à l'arrivée sur la slide finale et à chaque changement de format.
    const isClosingSlideActive = wrappedData?.slides[currentSlide]?.type === 'closing';
    useEffect(() => {
        if (!isClosingSlideActive || !wrappedData) return;
        let cancelled = false;
        (async () => {
            setIsGeneratingPreview(true);
            try {
                const blob = await getOrGenerateShareBlob();
                if (cancelled || !blob) return;
                const url = URL.createObjectURL(blob);
                setSharePreviewUrl(prev => {
                    if (prev) URL.revokeObjectURL(prev);
                    return url;
                });
            } catch (error) {
                console.error('[Wrapped] Unable to build share preview:', error);
            } finally {
                if (!cancelled) setIsGeneratingPreview(false);
            }
        })();
        return () => { cancelled = true; };
    }, [isClosingSlideActive, wrappedData, getOrGenerateShareBlob]);

    const handleDownloadShareImage = useCallback(async () => {
        if (!wrappedData) return;

        setIsPreparingShareImage(true);
        try {
            const blob = await getOrGenerateShareBlob();
            if (!blob) {
                toast.error(t('wrapped.shareError'));
                return;
            }

            downloadBlob(blob, `movix-wrapped-${year}-${shareFormat}.png`);
            toast.success(t('wrapped.imageDownloaded'));
        } catch (error) {
            console.error('[Wrapped] Unable to download share image:', error);
            toast.error(t('wrapped.shareError'));
        } finally {
            setIsPreparingShareImage(false);
        }
    }, [getOrGenerateShareBlob, shareFormat, t, wrappedData, year]);

    const handleShareImage = useCallback(async () => {
        if (!wrappedData) return;

        setIsPreparingShareImage(true);
        try {
            const blob = await getOrGenerateShareBlob();
            if (!blob) {
                toast.error(t('wrapped.shareError'));
                return;
            }

            const file = new File([blob], `movix-wrapped-${year}-${shareFormat}.png`, { type: 'image/png' });
            if (navigator.share && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
                await navigator.share({
                    title: t('wrapped.shareTitle', { year }),
                    text: wrappedShareText,
                    files: [file],
                });
                return;
            }

            downloadBlob(blob, `movix-wrapped-${year}-${shareFormat}.png`);
            toast.success(t('wrapped.imageShareFallback'));
        } catch (error) {
            if (!isShareAbortError(error)) {
                console.error('[Wrapped] Unable to share image:', error);
                toast.error(t('wrapped.shareError'));
            }
        } finally {
            setIsPreparingShareImage(false);
        }
    }, [getOrGenerateShareBlob, shareFormat, t, wrappedData, wrappedShareText, year]);

    const handleCopyShareText = useCallback(async () => {
        if (await copyText(wrappedShareText)) {
            toast.success(t('wrapped.textCopied'));
        } else {
            console.error('[Wrapped] Unable to copy share text');
            toast.error(t('wrapped.shareError'));
        }
    }, [t, wrappedShareText]);

    const handleShareText = useCallback(async () => {
        if (!wrappedData) return;

        try {
            if (navigator.share) {
                await navigator.share({
                    title: t('wrapped.shareTitle', { year }),
                    text: wrappedShareText,
                });
                return;
            }

            if (await copyText(wrappedShareText)) {
                toast.success(t('wrapped.textCopied'));
            } else {
                console.error('[Wrapped] Unable to share text: copy failed');
                toast.error(t('wrapped.shareError'));
            }
        } catch (error) {
            if (!isShareAbortError(error)) {
                console.error('[Wrapped] Unable to share text:', error);
                toast.error(t('wrapped.shareError'));
            }
        }
    }, [t, wrappedData, wrappedShareText, year]);

    const renderSlideContent = (slide: WrappedSlide) => {
        if (!wrappedData) return null;

        switch (slide.type) {
            case 'intro': return <SlideIntro slide={slide} stats={wrappedData.stats} />;
            case 'top1': return <SlideTop1 slide={slide} topItem={wrappedData.topContent[0]} tmdbData={tmdbData} />;
            case 'top2-focus': return <SlideTopFocus slide={slide} item={wrappedData.topContent[1]} tmdbData={tmdbData} rank={2} />;
            case 'top3-focus': return <SlideTopFocus slide={slide} item={wrappedData.topContent[2]} tmdbData={tmdbData} rank={3} />;
            case 'top5': return <SlideTop5 slide={slide} topContent={wrappedData.topContent} tmdbData={tmdbData} />;
            case 'persona': return <SlidePersona slide={slide} persona={wrappedData.persona} />;
            case 'peak-month': return <SlidePeakMonth slide={slide} peakMonth={wrappedData.peakMonth} />;
            case 'top-genres': return <SlideTopGenres slide={slide} topGenres={wrappedData.topGenres} />;
            case 'listening-clock': return <SlideListeningClock slide={slide} listeningClock={wrappedData.listeningClock} peakHour={wrappedData.peakHour} weekday={wrappedData.weekday} />;
            case 'streak': return <SlideStreak slide={slide} stats={wrappedData.stats} />;
            case 'fun-fact': return <SlideFunFact slide={slide} />;
            case 'session-summary': return <SlideSessionSummary slide={slide} stats={wrappedData.stats} />;
            case 'watch-bookends': return <SlideWatchBookends slide={slide} firstWatch={wrappedData.firstWatch} lastWatch={wrappedData.lastWatch} />;
            case 'closing': return (
                <SlideClosing
                    slide={slide}
                    stats={wrappedData.stats}
                    topContent={wrappedData.topContent}
                    topGenres={wrappedData.topGenres}
                    onShareImage={handleShareImage}
                    onDownloadImage={handleDownloadShareImage}
                    onShareText={handleShareText}
                    onCopyText={handleCopyShareText}
                    isPreparingImage={isPreparingShareImage}
                    shareFormat={shareFormat}
                    onFormatChange={setShareFormat}
                    previewUrl={sharePreviewUrl}
                    isGeneratingPreview={isGeneratingPreview}
                />
            );
            case 'detailed-stats': return <SlideDetailedStats slide={slide} data={wrappedData} tmdbData={tmdbData} />;
            case 'timeline': return <SlideTimeline slide={slide} monthlyGraph={wrappedData.monthlyGraph} peakMonth={wrappedData.peakMonth} />;
            case 'record-day': return <SlideRecordDay slide={slide} />;
            case 'rewatch': return <SlideRewatch slide={slide} />;
            case 'watch-age': return <SlideWatchAge slide={slide} />;
            case 'pages-time': return <SlidePagesTime slide={slide} topPages={wrappedData.topPages} />;
            case 'quiz': return <SlideQuiz slide={slide} topContent={wrappedData.topContent} onContinue={nextSlide} />;
            default: return null;
        }
    };

    const wrappedRequirementCards = wrappedProgress ? [
        {
            key: 'minutes',
            label: t('wrapped.requirementWatchTime'),
            current: formatCompactDuration(wrappedProgress.current.minutes, t),
            required: formatCompactDuration(wrappedProgress.requirements.minutes, t)
        },
        {
            key: 'uniqueTitles',
            label: t('wrapped.requirementTitles'),
            current: wrappedProgress.current.uniqueTitles.toLocaleString(i18n.language),
            required: wrappedProgress.requirements.uniqueTitles.toLocaleString(i18n.language)
        },
        {
            key: 'sessions',
            label: t('wrapped.requirementSessions'),
            current: wrappedProgress.current.sessions.toLocaleString(i18n.language),
            required: wrappedProgress.requirements.sessions.toLocaleString(i18n.language)
        },
        {
            key: 'activeDays',
            label: t('wrapped.requirementActiveDays'),
            current: wrappedProgress.current.activeDays.toLocaleString(i18n.language),
            required: wrappedProgress.requirements.activeDays.toLocaleString(i18n.language)
        }
    ] : [];

    const wrappedMissingItems = wrappedProgress ? [
        wrappedProgress.missing.minutes > 0
            ? t('wrapped.missingWatchTime', { value: formatCompactDuration(wrappedProgress.missing.minutes, t) })
            : null,
        wrappedProgress.missing.uniqueTitles > 0
            ? t('wrapped.missingTitles', { count: wrappedProgress.missing.uniqueTitles })
            : null,
        wrappedProgress.missing.sessions > 0
            ? t('wrapped.missingSessions', { count: wrappedProgress.missing.sessions })
            : null,
        wrappedProgress.missing.activeDays > 0
            ? t('wrapped.missingActiveDays', { count: wrappedProgress.missing.activeDays })
            : null
    ].filter(Boolean) as string[] : [];

    const currentSlideData = wrappedData?.slides[currentSlide];
    const bg = slideBackgrounds[currentSlideData?.type ?? 'intro'] || slideBackgrounds.intro;
    const podiumSlideIndex = currentSlideData?.type === 'top1'
        ? 0
        : currentSlideData?.type === 'top2-focus'
            ? 1
            : currentSlideData?.type === 'top3-focus'
                ? 2
                : -1;
    const isPodiumSlide = podiumSlideIndex !== -1;
    const shouldPlayWrappedTrailerSound = soundEffectsEnabled && hasWrappedInteraction && isPodiumSlide;

    // Get trailer key for the current podium content (used as full-page background on top1/top2/top3 slides)
    const podiumItem = isPodiumSlide && wrappedData ? wrappedData.topContent[podiumSlideIndex] : undefined;
    const podiumTmdb = podiumItem?.tmdbId ? tmdbData.get(podiumItem.tmdbId) : null;
    const fallbackTrailerKey = topWrappedItem?.tmdbId ? tmdbData.get(topWrappedItem.tmdbId)?.trailerKey : null;
    const trailerKey = podiumTmdb?.trailerKey || fallbackTrailerKey;

    useEffect(() => {
        setIsPodiumTrailerLoaded(false);
    }, [trailerKey, currentSlide]);

    // Loading state
    if (loading) {
        return (
            <SquareBackground mode={bgMode} borderColor="rgba(168, 85, 247, 0.15)" className="fixed inset-0 z-50 bg-black flex items-center justify-center">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(168,85,247,0.2),transparent_50%)]" />
                <div className="relative z-10 mx-auto flex w-full max-w-md flex-col items-center px-6 sm:px-0">
                    {/* Skeleton d'une slide : icône + titre + carte (largeurs relatives pour mobile) */}
                    <div className="mb-6 h-20 w-20 animate-pulse rounded-3xl bg-white/10 sm:mb-8 sm:h-28 sm:w-28 md:h-36 md:w-36" />
                    <div className="mb-3 h-7 w-3/5 max-w-[16rem] animate-pulse rounded-xl bg-white/10 sm:h-9" />
                    <div className="mb-6 h-4 w-2/5 max-w-[11rem] animate-pulse rounded-lg bg-white/5 sm:mb-8 sm:h-5" />
                    <div className="w-full space-y-3 rounded-[1.5rem] border border-white/10 bg-white/5 p-5 sm:p-6">
                        <div className="h-4 w-full animate-pulse rounded bg-white/10" />
                        <div className="h-4 w-5/6 animate-pulse rounded bg-white/10" />
                        <div className="h-4 w-2/3 animate-pulse rounded bg-white/10" />
                    </div>
                    <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="mt-8 text-sm font-medium text-purple-300">
                        {t('wrapped.analyzingYear')}
                    </motion.p>
                </div>
            </SquareBackground>
        );
    }

    // No data state — show a cool message
    if (!wrappedData || noData) {
        return (
            <WrappedStandaloneShell mode={bgMode}>
                <div className="mb-5 flex justify-start sm:mb-8">
                    <button
                        onClick={() => onClose()}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 backdrop-blur-lg transition-colors hover:bg-white/10"
                    >
                        <X className="w-5 h-5 text-white" />
                    </button>
                </div>

                <div className="flex flex-1 flex-col items-center justify-start pb-6 text-center md:justify-center">
                    <motion.div
                        initial={{ opacity: 0, scale: 0.5 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ type: 'spring', duration: 0.8 }}
                        className="mb-6 sm:mb-8"
                    >
                        <div className="relative">
                            <div
                                className="absolute inset-0 rounded-full scale-150 pointer-events-none"
                                style={{ background: 'radial-gradient(circle, rgba(168, 85, 247, 0.30) 0%, transparent 70%)' }}
                            />
                            <span className="relative text-8xl md:text-9xl">🍿</span>
                        </div>
                    </motion.div>

                    <motion.h1
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                        className="mb-4 text-3xl font-black sm:text-4xl md:text-5xl"
                    >
                        <ShinyText text={`Wrapped ${year}`} speed={2} color="#a855f7" shineColor="#ffffff" className="" />
                    </motion.h1>

                    <motion.p
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.4 }}
                        className="mb-3 max-w-xl text-lg font-semibold text-purple-300 sm:text-xl md:text-2xl"
                    >
                        {t('wrapped.notEnoughDataYet')}
                    </motion.p>

                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.6 }}
                        className="w-full max-w-3xl"
                    >
                        <AnimatedBorderCard
                            highlightColor="168 85 247"
                            backgroundColor="0 0 0"
                            className="w-full p-4 text-left backdrop-blur-md sm:p-6 md:p-8"
                        >
                            <p className="mb-4 text-sm leading-relaxed text-white/80 sm:text-base md:text-lg">
                                {t('wrapped.notEnoughDataForYear', { year })}
                            </p>
                            {wrappedProgress && (
                                <div className="mb-6 rounded-[1.5rem] border border-white/10 bg-white/5 p-4 sm:p-5">
                                    <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold text-white">{t('wrapped.unlockRequirementsTitle')}</p>
                                            <p className="mt-1 text-xs leading-relaxed text-white/60 sm:text-sm">
                                                {t('wrapped.unlockRequirementsDesc', {
                                                    time: formatCompactDuration(wrappedProgress.requirements.minutes, t),
                                                    titles: wrappedProgress.requirements.uniqueTitles,
                                                    sessions: wrappedProgress.requirements.sessions,
                                                    days: wrappedProgress.requirements.activeDays
                                                })}
                                            </p>
                                        </div>
                                        <div className="inline-flex self-start rounded-full border border-purple-400/20 bg-purple-500/10 px-3 py-1 text-xs font-semibold text-purple-200">
                                            {t('wrapped.progressPercent', { percent: wrappedProgress.completionPercent })}
                                        </div>
                                    </div>

                                    <div className="mb-4 grid gap-3 sm:grid-cols-2">
                                        {wrappedRequirementCards.map((item) => (
                                            <div key={item.key} className="rounded-xl border border-white/8 bg-black/20 p-3 sm:p-4">
                                                <p className="mb-1 text-[11px] uppercase tracking-[0.18em] text-white/40">{item.label}</p>
                                                <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-base font-bold text-white sm:text-lg">
                                                    <span>{item.current}</span>
                                                    <span className="text-sm font-medium text-white/45">/ {item.required}</span>
                                                </p>
                                            </div>
                                        ))}
                                    </div>

                                    <div className="rounded-xl border border-amber-400/15 bg-amber-500/5 p-3 sm:p-4">
                                        <p className="mb-2 text-sm font-medium text-amber-200">
                                            {t('wrapped.missingSummaryTitle', { count: wrappedProgress.missingCriteriaCount })}
                                        </p>
                                        <p className="mb-3 text-xs leading-relaxed text-white/65 sm:text-sm">
                                            {t('wrapped.missingTimeInfo', {
                                                current: formatCompactDuration(wrappedProgress.current.minutes, t),
                                                required: formatCompactDuration(wrappedProgress.requirements.minutes, t),
                                                remaining: formatCompactDuration(wrappedProgress.missing.minutes, t)
                                            })}
                                        </p>
                                        <div className="flex flex-wrap gap-2">
                                            {wrappedMissingItems.map((item) => (
                                                <span
                                                    key={item}
                                                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/75"
                                                >
                                                    {item}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                            <p className="mb-6 text-sm leading-relaxed text-white/60 sm:text-base">
                                {t('wrapped.keepWatching')}
                            </p>
                            <motion.button
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                onClick={() => navigate('/')}
                                className="w-full rounded-full bg-gradient-to-r from-purple-500 to-fuchsia-500 px-6 py-3.5 text-sm font-bold text-white transition-shadow hover:shadow-lg hover:shadow-purple-500/25 sm:w-auto"
                            >
                                {t('wrapped.backToHome')}
                            </motion.button>
                        </AnimatedBorderCard>
                    </motion.div>

                    <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 1 }}
                        className="mt-6 text-xs text-white/30 sm:mt-8 sm:text-sm"
                    >
                        {t('wrapped.wrappedWaiting')}
                    </motion.p>
                </div>
            </WrappedStandaloneShell>
        );
    }

    if (!currentSlideData) {
        return null;
    }

    return (
        <div className="fixed inset-0 z-50 bg-black text-white">
            {/* Full-screen trailer background for podium slides */}
            {trailerKey && isPodiumSlide && (
                <div
                    className="absolute inset-0 z-0 pointer-events-none overflow-hidden transition-opacity duration-700"
                    style={{ opacity: 1 }}
                >
                    <iframe
                        src={`https://www.youtube.com/embed/${trailerKey}?autoplay=1&mute=${shouldPlayWrappedTrailerSound ? 0 : 1}&controls=0&showinfo=0&rel=0&loop=1&playlist=${trailerKey}&modestbranding=1&playsinline=1&iv_load_policy=3&disablekb=1&fs=0&cc_load_policy=0&start=10&origin=${window.location.origin}`}
                        title="Trailer background"
                        allow="autoplay; encrypted-media"
                        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
                        style={{ border: 'none', width: '300vw', height: '300vh' }}
                        tabIndex={-1}
                        onLoad={() => setIsPodiumTrailerLoaded(true)}
                    />
                    {/* Dark overlays */}
                    <div className="absolute inset-0 bg-black/50" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-black/50" />
                    <div className="absolute top-0 left-0 right-0 h-28 bg-gradient-to-b from-black to-transparent" />
                    <div className="absolute bottom-0 left-0 right-0 h-28 bg-gradient-to-t from-black to-transparent" />
                </div>
            )}

            {/* SquareBackground + gradients — hidden when trailer is playing on a podium slide */}
            <div
                className="absolute inset-0 z-0 transition-opacity duration-700"
                style={{ opacity: isPodiumSlide && trailerKey && isPodiumTrailerLoaded ? 0 : 1 }}
            >
                <SquareBackground
                    mode={bgMode}
                    borderColor={bg.color}
                    className="absolute inset-0"
                />
            {/* Dynamic gradient based on slide */}
            <AnimatePresence mode="wait">
                <motion.div
                    key={currentSlide}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.5 }}
                    className={`absolute inset-0 bg-gradient-to-b ${bg.gradient}`}
                />
            </AnimatePresence>

            {/* Ambient glow — déjà un radial-gradient, on supprime juste le
                blur-[120px] qui s'appliquait par-dessus (double coût GPU pour
                aucun gain visuel — le gradient produit déjà la diffusion). */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] opacity-30 pointer-events-none"
                style={{ background: `radial-gradient(circle, ${bg.color.replace('0.15', '0.4')}, transparent)` }}
            />
            </div>

            {/* Top bar */}
            <div
                className="absolute left-0 right-0 top-0 z-20 flex items-center gap-2 px-3 sm:px-4"
                style={wrappedTopBarStyle}
            >
                <button
                    onClick={() => onClose()}
                    className="shrink-0 rounded-full border border-white/10 bg-white/5 p-2.5 backdrop-blur-lg transition-colors hover:bg-white/10 sm:p-3"
                >
                    <X className="w-5 h-5 text-white" />
                </button>

                <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5 px-2 sm:gap-2 sm:px-4">
                    <Sparkles className="hidden h-5 w-5 text-amber-400 sm:block" />
                    <ShinyText
                        text={t('wrapped.shareTitle', { year })}
                        speed={3}
                        color="#fbbf24"
                        shineColor="#ffffff"
                        className="max-w-full truncate text-sm font-bold sm:text-base"
                    />
                </div>

                <button
                    onClick={handleShareText}
                    className="shrink-0 rounded-full border border-white/10 bg-white/5 p-2.5 backdrop-blur-lg transition-colors hover:bg-white/10 sm:p-3"
                >
                    <Share2 className="w-5 h-5 text-white" />
                </button>
            </div>

            {/* Progress indicators */}
            <div
                className="absolute left-3 right-3 z-20 flex gap-1 sm:left-4 sm:right-4"
                style={wrappedProgressBarStyle}
            >
                {wrappedData.slides.map((_, index) => (
                    <button
                        key={index}
                        onClick={() => goToSlide(index)}
                        className="h-1 flex-1 overflow-hidden rounded-full bg-white/10 transition-colors hover:bg-white/20 sm:h-1.5"
                    >
                        <motion.div
                            initial={false}
                            animate={{ width: index <= currentSlide ? '100%' : '0%' }}
                            transition={{ duration: 0.3 }}
                            className="h-full bg-white"
                        />
                    </button>
                ))}
            </div>

            {/* Slide Content */}
            <div className="absolute inset-0" onClick={nextSlide}>
                <AnimatePresence mode="wait" custom={direction}>
                    <motion.div
                        key={currentSlide}
                        custom={direction}
                        initial={{ opacity: 0, x: direction * 100 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -direction * 100 }}
                        transition={{ duration: 0.3 }}
                        drag="x" // Enable drag for all slides
                        dragConstraints={{ left: 0, right: 0 }}
                        dragElastic={0.2}
                        onDragEnd={handleDragEnd}
                        className="absolute inset-0 flex items-stretch justify-center overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {currentSlideData.type === 'top2-focus' ? (
                            <SlideTopFocus
                                slide={currentSlideData}
                                item={wrappedData.topContent[1]}
                                tmdbData={tmdbData}
                                rank={2}
                                hideBackdropImage={isPodiumSlide && !!trailerKey && isPodiumTrailerLoaded}
                            />
                        ) : currentSlideData.type === 'top3-focus' ? (
                            <SlideTopFocus
                                slide={currentSlideData}
                                item={wrappedData.topContent[2]}
                                tmdbData={tmdbData}
                                rank={3}
                                hideBackdropImage={isPodiumSlide && !!trailerKey && isPodiumTrailerLoaded}
                            />
                        ) : (
                            renderSlideContent(currentSlideData)
                        )}
                    </motion.div>
                </AnimatePresence>
            </div>

            {/* Navigation arrows */}
            <div
                className="absolute left-3 right-3 z-20 flex items-center justify-between pointer-events-none sm:left-4 sm:right-4"
                style={wrappedNavigationStyle}
            >
                <button
                    onClick={(e) => { e.stopPropagation(); prevSlide(); }}
                    disabled={currentSlide === 0}
                    className={`pointer-events-auto rounded-full border border-white/10 bg-white/5 p-3 backdrop-blur-lg transition-all hover:bg-white/10 sm:p-4 ${
                        currentSlide === 0 ? 'opacity-30 cursor-not-allowed' : ''
                    }`}
                >
                    <ChevronLeft className="h-5 w-5 text-white sm:h-6 sm:w-6" />
                </button>

                <div className="flex items-center gap-2 text-xs text-white/40 sm:text-sm">
                    <span>{currentSlide + 1}</span>
                    <span>/</span>
                    <span>{wrappedData.slides.length}</span>
                </div>

                <button
                    onClick={(e) => { e.stopPropagation(); nextSlide(); }}
                    disabled={currentSlide === wrappedData.slides.length - 1}
                    className={`pointer-events-auto rounded-full border border-white/10 bg-white/5 p-3 backdrop-blur-lg transition-all hover:bg-white/10 sm:p-4 ${
                        currentSlide === wrappedData.slides.length - 1 ? 'opacity-30 cursor-not-allowed' : ''
                    }`}
                >
                    <ChevronRight className="h-5 w-5 text-white sm:h-6 sm:w-6" />
                </button>
            </div>

            {/* Tap hint */}
            <motion.div
                initial={{ opacity: 0.6 }}
                animate={{ opacity: 0 }}
                transition={{ delay: 3, duration: 1 }}
                className="pointer-events-none absolute left-0 right-0 text-center text-xs text-white/30 sm:text-sm"
                style={wrappedHintStyle}
            >
                {t('wrapped.tapOrSwipe')}
            </motion.div>
        </div>
    );
};

export default WrappedPage;
