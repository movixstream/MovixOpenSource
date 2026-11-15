import React, { useState, useCallback } from 'react';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { useTranslation } from 'react-i18next';
import { Star, Calendar } from 'lucide-react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';
import { encodeId } from '../utils/idEncoder';
import { useAgeRestrictedContent } from '../hooks/useAgeRestrictedContent';
import { useNearViewport } from '@/hooks/useNearViewport';
import { useMediaColor } from '@/hooks/useMediaColor';
import { useMediaImageSource } from '@/hooks/useMediaImageSource';
import { useMediaColorSettings } from '@/hooks/useMediaColorSettings';
import { useImageQuality } from '@/hooks/useImageQuality';
import { useImageSlot } from '@/hooks/useImageSlot';
import { getTmdbImageProps } from '@/utils/tmdbImages';

interface SearchResult {
    id: number;
    title?: string;
    name?: string;
    media_type: 'movie' | 'tv';
    poster_path: string;
    backdrop_path?: string;
    release_date?: string;
    first_air_date?: string;
    vote_average: number;
    overview?: string;
}

const POSTER_FALLBACK = `data:image/svg+xml,${encodeURIComponent('<svg width="500" height="750" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#111"/><text x="50%" y="50%" fill="#444" font-size="36" font-family="sans-serif" text-anchor="middle" dy=".3em">MOVIX</text></svg>')}`;

// Module-level watchlist id cache, keyed by media_type. Previously each
// SearchGridCard / SearchListCard ran `JSON.parse(localStorage[...])` inside
// its useState initializer on every mount — with 60 results × a 200-item
// watchlist that's ~12k operations during the initial paint of a search
// page, repeated every time `index` shifts in the React key. Now the parse
// happens at most once per media_type per browsing session (or after a
// toggle / cross-tab change). — perf
/*
 * `backdrop-blur` a été retiré des pastilles et du bouton watchlist de ces
 * cartes. Un flou d'arrière-plan force une couche de composition et un
 * repaint de la zone derrière l'élément ; multiplié par les deux ou trois
 * éléments de chaque carte et par les vingt cartes d'une grille, c'est ce qui
 * faisait ramer le défilement des pages de genre. Les fonds ont été assombris
 * d'autant : à l'œil, la différence ne se voit pas.
 */

/**
 * Nombre de cartes qui jouent l'animation d'apparition. Les grilles de genre et
 * de recherche en affichent une vingtaine d'un coup ; animer les dernières ne
 * se voit pas et coûte autant que d'animer les premières.
 */
const ANIMATED_CARD_COUNT = 12;

const watchlistCache: Record<string, Set<number> | undefined> = {};

const getWatchlistIds = (mediaType: 'movie' | 'tv'): Set<number> => {
    const cached = watchlistCache[mediaType];
    if (cached) return cached;
    try {
        const raw = localStorage.getItem(`watchlist_${mediaType}`) ?? '[]';
        const list = JSON.parse(raw);
        if (!Array.isArray(list)) return new Set<number>();
        const set = new Set<number>();
        for (const entry of list) {
            if (entry && typeof entry.id === 'number') set.add(entry.id);
        }
        watchlistCache[mediaType] = set;
        return set;
    } catch {
        // Ne pas mémoriser une liste vide après un refus temporaire de lecture.
        return new Set<number>();
    }
};

const invalidateWatchlistCache = (mediaType: 'movie' | 'tv') => {
    delete watchlistCache[mediaType];
};

const toggleStoredWatchlist = (item: SearchResult, title: string): boolean | null => {
    try {
        const storage = window.localStorage;
        const key = `watchlist_${item.media_type}`;
        const list = JSON.parse(storage.getItem(key) ?? '[]');
        // Une lecture refusée ou invalide ne doit jamais écraser la liste.
        if (!Array.isArray(list)) return null;
        const exists = list.some((entry) => entry?.id === item.id);
        const updatedList = exists
            ? list.filter((entry) => entry?.id !== item.id)
            : [...list, {
                id: item.id,
                type: item.media_type,
                title,
                poster_path: item.poster_path,
                addedAt: new Date().toISOString(),
            }];
        storage.setItem(key, JSON.stringify(updatedList));
        invalidateWatchlistCache(item.media_type);
        return !exists;
    } catch {
        return null;
    }
};

// Listen for cross-tab storage updates so the cache doesn't go stale.
type GlobalWithFlag = Window & { __movixWatchlistCacheRegistered?: boolean };
if (typeof window !== 'undefined') {
    const w = window as GlobalWithFlag;
    if (!w.__movixWatchlistCacheRegistered) {
        w.__movixWatchlistCacheRegistered = true;
        window.addEventListener('storage', (e) => {
            if (e.key === 'watchlist_movie') invalidateWatchlistCache('movie');
            else if (e.key === 'watchlist_tv') invalidateWatchlistCache('tv');
        });
    }
}

// ─── Grid Card ──────────────────────────────────────────────────────────────

interface GridCardProps {
    item: SearchResult;
    index: number;
    movieLabel: string;
    serieLabel: string;
    animateEntrance?: boolean;
}

export const SearchGridCard: React.FC<GridCardProps> = React.memo(({ item, index, movieLabel, serieLabel, animateEntrance = true }) => {
    const { t } = useTranslation();
    const { items: allowedItems } = useAgeRestrictedContent([item]);
    const [starred, setStarred] = useState(() => getWatchlistIds(item.media_type).has(item.id));
    const { ref: cardRef, isNearViewport, isInViewport } = useNearViewport<HTMLDivElement>(false, allowedItems.length > 0);
    const posterSrc = item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : POSTER_FALLBACK;
    const { loadedSource, imageRef, onLoad } = useMediaImageSource(posterSrc);
    const palette = useMediaColor('cards', posterSrc, isNearViewport && allowedItems.length > 0, isInViewport, loadedSource);
    const { cardsBaseGradient } = useMediaColorSettings();
    const { effectiveImageQuality } = useImageQuality();
    const imageSlot = useImageSlot(cardRef, allowedItems.length > 0);
    const posterImage = getTmdbImageProps(posterSrc, {
        kind: 'poster', quality: effectiveImageQuality,
        sizes: `auto, ${imageSlot.width || 240}px`,
    });

    const title = item.title || item.name || '';

    const toggle = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const nextStarred = toggleStoredWatchlist(item, title);
        if (nextStarred === null) {
            toast.error(t('lists.saveFailed'));
            return;
        }
        setStarred(nextStarred);
        toast.success(`${title} ${t(nextStarred ? 'lists.addedToList' : 'lists.removedFromList')}`, { duration: 2000 });
    }, [item, title, t]);

    if (allowedItems.length === 0) return null;

    return (
        <motion.div
            ref={cardRef}
            // Seules les premières cartes s'animent à l'apparition. Au-delà, on
            // faisait démarrer des dizaines d'animations simultanées pour des
            // vignettes hors écran — coût réel, effet invisible.
            initial={animateEntrance && index < ANIMATED_CARD_COUNT ? { opacity: 0, y: 20 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: Math.min(index * 0.03, 0.5) }}
            whileHover={{ scale: 1.05 }}
            className={`${palette ? 'media-color-card' : ''} relative group rounded-xl overflow-hidden bg-white/5 border border-white/10 hover:border-white/20 transition-colors`}
            style={palette?.style}
        >
            {/* Badge */}
            <span className="absolute top-2 left-2 z-10 px-2 py-1 rounded-lg bg-black/75 text-[10px] font-semibold uppercase tracking-wider text-white/80">
                {item.media_type === 'tv' ? serieLabel : movieLabel}
            </span>

            {/* Watchlist button */}
            <Tooltip>
                <TooltipTrigger asChild>
                    <motion.button
                        onClick={toggle}
                        whileTap={{ scale: 0.7 }}
                        className={`absolute top-2 right-2 z-20 p-2 rounded-full transition-all duration-200 md:opacity-0 md:group-hover:opacity-100 md:group-has-[:focus-visible]:opacity-100 ${starred ? 'bg-yellow-500/25 border border-yellow-400/30' : 'bg-black/55 hover:bg-black/70'}`}
                    >
                        <motion.div
                            key={starred ? 'on' : 'off'}
                            initial={{ scale: 0.3, rotate: -45 }}
                            animate={{ scale: 1, rotate: 0 }}
                            transition={{ type: 'spring', stiffness: 500, damping: 15 }}
                        >
                            <Star
                                className={`w-4 h-4 transition-colors duration-150 ${starred ? 'text-yellow-400' : 'text-white'}`}
                                fill={starred ? 'currentColor' : 'none'}
                            />
                        </motion.div>
                    </motion.button>
                </TooltipTrigger>
                <TooltipContent>
                    {starred ? t('profile.removeFromWatchlist') : t('profile.addToWatchlist')}
                </TooltipContent>
            </Tooltip>

            {/* La largeur mesurée suit aussi les densités de grille choisies
                par l'utilisateur ; les cartes hors écran restent différées. */}
            <img
                {...posterImage}
                ref={imageRef}
                onLoad={onLoad}
                alt={item.title || item.name}
                loading="lazy"
                decoding="async"
                className="w-full aspect-[2/3] object-cover"
                onError={(e) => { e.currentTarget.removeAttribute('srcset'); e.currentTarget.onerror = null; e.currentTarget.src = POSTER_FALLBACK; }}
            />

            {/* Voile sombre de survol (lisibilité) */}
            {cardsBaseGradient && (
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent md:opacity-0 md:group-hover:opacity-100 md:group-has-[:focus-visible]:opacity-100 transition-opacity duration-300 pointer-events-none" />
            )}

            {/* Garder les calques montés pour fondre la couleur même pendant le survol. */}
            <div aria-hidden="true" className="media-card-color-layers absolute inset-0 pointer-events-none">
                <div className="media-color-wash absolute inset-0" />
                <div className="media-card-color-overlay absolute inset-0 md:opacity-0 md:group-hover:opacity-100 md:group-has-[:focus-visible]:opacity-100 transition-opacity duration-300" />
            </div>

            {/* Survol ou focus clavier : un clic ne doit pas garder les détails ouverts. */}
            <div className="absolute bottom-0 left-0 right-0 p-3 md:opacity-0 md:group-hover:opacity-100 md:group-has-[:focus-visible]:opacity-100 md:translate-y-2 md:group-hover:translate-y-0 md:group-has-[:focus-visible]:translate-y-0 transition-all duration-300 pointer-events-none">
                <h3 className="text-sm font-bold text-white line-clamp-1 mb-1">
                    {item.title || item.name}
                </h3>
                <div className="flex items-center gap-2 mb-1">
                    <div className="flex items-center gap-1">
                        <Star className="w-3 h-3 text-yellow-400" />
                        <span className="text-xs text-white/80">
                            {item.vote_average ? item.vote_average.toFixed(1) : 'N/A'}
                        </span>
                    </div>
                    <span className="media-card-muted text-xs text-white/60">
                        {new Date(item.release_date || item.first_air_date || '').getFullYear()}
                    </span>
                </div>
                <p className="media-card-muted text-xs text-white/50 line-clamp-3">
                    {item.overview}
                </p>
            </div>

            {/* Main clickable area */}
            <Link to={`/${item.media_type}/${encodeId(item.id)}`} className="absolute inset-0 z-10">
                <span className="sr-only">{item.title || item.name}</span>
            </Link>
        </motion.div>
    );
});

SearchGridCard.displayName = 'SearchGridCard';

// ─── List Card ──────────────────────────────────────────────────────────────

interface ListCardProps {
    item: SearchResult;
    index: number;
    movieLabel: string;
    serieLabel: string;
    watchlistLabel: string;
    removeLabel: string;
    noDescLabel: string;
    animateEntrance?: boolean;
}

export const SearchListCard: React.FC<ListCardProps> = React.memo(({ item, index, movieLabel, serieLabel, watchlistLabel, removeLabel, noDescLabel, animateEntrance = true }) => {
    const { t } = useTranslation();
    const { items: allowedItems } = useAgeRestrictedContent([item]);
    const [starred, setStarred] = useState(() => getWatchlistIds(item.media_type).has(item.id));
    const { ref: cardRef, isNearViewport, isInViewport } = useNearViewport<HTMLDivElement>(false, allowedItems.length > 0);
    const posterSrc = item.poster_path ? `https://image.tmdb.org/t/p/w185${item.poster_path}` : POSTER_FALLBACK;
    const { loadedSource, imageRef, onLoad } = useMediaImageSource(posterSrc);
    const palette = useMediaColor('cards', posterSrc, isNearViewport && allowedItems.length > 0, isInViewport, loadedSource);
    const { effectiveImageQuality } = useImageQuality();
    const posterImage = getTmdbImageProps(posterSrc, {
        kind: 'poster', quality: effectiveImageQuality,
        sizes: '(min-width: 640px) 96px, 80px',
    });

    const title = item.title || item.name || '';

    const toggle = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const nextStarred = toggleStoredWatchlist(item, title);
        if (nextStarred === null) {
            toast.error(t('lists.saveFailed'));
            return;
        }
        setStarred(nextStarred);
        toast.success(`${title} ${t(nextStarred ? 'lists.addedToList' : 'lists.removedFromList')}`, { duration: 2000 });
    }, [item, title, t]);

    if (allowedItems.length === 0) return null;

    return (
        <motion.div
            ref={cardRef}
            initial={animateEntrance ? { opacity: 0, x: -20 } : false}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, delay: Math.min(index * 0.04, 0.6) }}
        >
            <Link
                to={`/${item.media_type}/${encodeId(item.id)}`}
                className={`${palette ? 'media-color-card' : ''} flex gap-4 p-4 rounded-xl bg-white/5 border border-white/10 hover:border-white/20 hover:bg-white/[0.08] transition-all group`}
                style={palette?.style}
            >
                <div className="relative flex-shrink-0">
                    <span className="absolute top-1 left-1 z-10 px-2 py-1 rounded-lg bg-black/75 text-[10px] font-semibold uppercase tracking-wider text-white/80">
                        {item.media_type === 'tv' ? serieLabel : movieLabel}
                    </span>
                    <img
                        className="w-20 h-28 sm:w-24 sm:h-36 rounded-lg object-cover"
                        {...posterImage}
                        ref={imageRef}
                        onLoad={onLoad}
                        alt={item.title || item.name}
                        loading="lazy"
                        decoding="async"
                        onError={(e) => { e.currentTarget.removeAttribute('srcset'); e.currentTarget.onerror = null; e.currentTarget.src = POSTER_FALLBACK; }}
                    />
                </div>
                <div className="flex-1 min-w-0 flex flex-col justify-between">
                    <div>
                        <h3 className={`font-semibold text-white line-clamp-1 ${palette ? '' : 'group-hover:text-red-400'} transition-colors`}>
                            {item.title || item.name}
                        </h3>
                        <div className="media-card-muted flex items-center gap-3 text-sm text-white/50 mt-1">
                            <div className="flex items-center gap-1">
                                <Star className="w-4 h-4 text-yellow-400" fill="currentColor" />
                                <span>{item.vote_average?.toFixed(1) || 'N/A'}</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <Calendar className="w-4 h-4 text-white opacity-30" />
                                <span>{new Date(item.release_date || item.first_air_date || '').getFullYear() || 'N/A'}</span>
                            </div>
                        </div>
                        <p className="media-card-muted text-sm text-white/40 line-clamp-2 mt-2">
                            {item.overview || noDescLabel}
                        </p>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <motion.button
                                    onClick={toggle}
                                    whileTap={{ scale: 0.85 }}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all duration-200 relative z-10 ${starred ? 'bg-yellow-500/10 border border-yellow-400/20' : 'bg-white/5 hover:bg-white/10'}`}
                                >
                                    <motion.div
                                        key={starred ? 'on' : 'off'}
                                        initial={{ scale: 0.3, rotate: -45 }}
                                        animate={{ scale: 1, rotate: 0 }}
                                        transition={{ type: 'spring', stiffness: 500, damping: 15 }}
                                    >
                                        <Star
                                            className={`w-4 h-4 transition-colors duration-150 ${starred ? 'text-yellow-400' : 'text-white opacity-60'}`}
                                            fill={starred ? 'currentColor' : 'none'}
                                        />
                                    </motion.div>
                                    <span className={`text-xs hidden md:inline transition-colors duration-150 ${starred ? 'text-yellow-400/80' : 'text-white/60'}`}>
                                        {starred ? removeLabel : watchlistLabel}
                                    </span>
                                </motion.button>
                            </TooltipTrigger>
                            <TooltipContent>
                                {starred ? t('profile.removeFromWatchlist') : t('profile.addToWatchlist')}
                            </TooltipContent>
                        </Tooltip>
                    </div>
                </div>
            </Link>
        </motion.div>
    );
});

SearchListCard.displayName = 'SearchListCard';
