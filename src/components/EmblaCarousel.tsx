import { useLightMode } from '@/context/LightModeContext';
import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import useEmblaCarousel, {
  reInitMountedEmblaKeepingLocation,
  watchMountedEmblaResize,
} from '@/hooks/useFlexGapEmblaCarousel';
import { Star, Calendar, Trash, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { encodeId } from '../utils/idEncoder';
import { useTmdbImages } from '../hooks/useTmdbImages';
import { useNearViewport } from '../hooks/useNearViewport';
import { useMediaColor } from '@/hooks/useMediaColor';
import { useMediaImageSource } from '@/hooks/useMediaImageSource';
import { useMediaColorSettings } from '@/hooks/useMediaColorSettings';
import { useImageQuality } from '@/hooks/useImageQuality';
import { getTmdbImageProps } from '@/utils/tmdbImages';
import { useEmblaScrollSuppress } from '../hooks/useEmblaScrollSuppress';
import { useAgeRestrictedContent } from '../hooks/useAgeRestrictedContent';
import './EmblaCarousel.css';

const POSTER_FALLBACK = `data:image/svg+xml,${encodeURIComponent('<svg width="500" height="750" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#111"/><text x="50%" y="50%" fill="#444" font-size="36" font-family="sans-serif" text-anchor="middle" dy=".3em">MOVIX</text></svg>')}`;

// Stable frozen constant for non-history carousel items — prevents fresh object
// identity inside limitedItems.map() from defeating CarouselCard memo. — perf
const EMPTY_PROGRESS = Object.freeze({ percentage: 0, position: 0, duration: 0 });
// Cartes par carrousel. L'historique n'a pas de limite : une carte loin de
// l'écran n'est qu'une boîte vide (contenu rendu près du viewport seulement),
// et tout rendre d'un coup évite d'ajouter des cartes pendant le défilement.
const CAROUSEL_MAX_ITEMS = 30;

export interface Media {
  id: number;
  title?: string;
  name?: string;
  poster_path: string;
  backdrop_path: string;
  overview: string;
  vote_average: number;
  release_date?: string;
  first_air_date?: string;
  media_type: 'movie' | 'tv' | 'collection';
  genre_ids?: number[];
}

interface ContinueWatching {
  id: number;
  title?: string;
  name?: string;
  poster_path: string;
  media_type: 'movie' | 'tv';
  progress?: number;
  // Position et durée (secondes) fournies par le serveur ; sinon lues dans
  // les clés `progress_*` du localStorage.
  position?: number;
  duration?: number;
  lastWatched: string;
  overview?: string;
  backdrop_path?: string;
  vote_average?: number;
  release_date?: string;
  first_air_date?: string;
  currentEpisode?: {
    season: number;
    episode: number;
  };
}

interface EmblaCarouselProps {
  title: string | React.ReactNode;
  items: Media[] | ContinueWatching[];
  mediaType: string;
  isHistory?: boolean;
  onRemoveItem?: (itemId: number, mediaType: string) => void;
  onRemoveAll?: () => void;
  showRanking?: boolean;
  priorityZIndex?: boolean; // Pour les sections qui doivent être au-dessus des autres
  onViewAll?: () => void; // Callback pour le bouton "Voir tous"
  /** Outils posés après le titre (ex. frissomètre de la rangée Halloween). */
  headerExtra?: React.ReactNode;
  /** Calque posé sur les cartes, sous les flèches (ex. lampe torche). */
  overlay?: React.ReactNode;
}

interface LazyImageProps {
  src: string;
  srcSet?: string;
  sizes?: string;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
  onError?: () => void;
  placeholder?: string;
  draggable?: boolean;
  priority?: boolean;
  customImage?: boolean;
  requireImageCors?: boolean;
  onImageLoad?: (source: string) => void;
}

// Reserve the poster's aspect ratio and decode asynchronously. The requested
// TMDB image size, not these HTML dimensions, determines the decoded buffer.
const LazyImage: React.FC<LazyImageProps> = ({
  src,
  srcSet,
  sizes,
  alt,
  className = '',
  style,
  onError,
  placeholder = 'data:image/svg+xml;utf8,<svg width="342" height="513" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 342 513" preserveAspectRatio="xMidYMid meet"><rect width="100%" height="100%" fill="%23333"/><text x="50%" y="50%" fill="%23ccc" font-size="38" font-family="Arial, sans-serif" text-anchor="middle" dy=".3em">MOVIX</text></svg>',
  draggable = false,
  priority = false,
  customImage = false,
  requireImageCors = customImage,
  onImageLoad,
}) => {
  const imageRef = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    // A cached image may finish before the effect runs, notably on Safari.
    // Keep an already displayed poster visible while its localized replacement
    // loads: resetting opacity here caused a second flash after the first load.
    if (imageRef.current?.complete && imageRef.current.naturalWidth) {
      setLoaded(true);
      onImageLoad?.(imageRef.current.currentSrc || imageRef.current.src);
    }
    setErrored(false);
  }, [src, srcSet, onImageLoad]);

  const handleLoad = useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
    setLoaded(true);
    onImageLoad?.(event.currentTarget.currentSrc || event.currentTarget.src);
  }, [onImageLoad]);
  const handleError = useCallback(() => {
    setErrored(true);
    setLoaded(true);
    onError?.();
  }, [onError]);

  const roundedClass = className.includes('rounded')
    ? className.match(/rounded-\w+/)?.[0] || ''
    : '';

  return (
    <div className={`relative ${className}`} style={{
      width: '100%',
      height: '100%',
      ...style
    }}>
      <img
        ref={imageRef}
        src={errored ? placeholder : src}
        srcSet={errored ? undefined : srcSet}
        sizes={errored ? undefined : sizes}
        alt={alt}
        width={342}
        height={513}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        crossOrigin={requireImageCors ? 'anonymous' : undefined}
        referrerPolicy={customImage ? 'no-referrer' : undefined}
        {...{ fetchpriority: priority ? 'high' : 'auto' }}
        onLoad={handleLoad}
        onError={handleError}
        draggable={draggable}
        className={`w-full h-full object-cover transition-opacity duration-300 ${roundedClass} ${loaded ? 'opacity-100' : 'opacity-0'}`}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          ...style
        }}
      />
      {!loaded && (
        <div className="absolute inset-0 bg-gray-900" aria-hidden="true" />
      )}
    </div>
  );
};

// Memoized card — same visual language as SearchGridCard
export const CarouselCard = React.memo<{
  item: Media | ContinueWatching;
  index?: number;
  detailPath?: string;
  priority?: boolean;
  initialStarred?: boolean;
  progressData?: { percentage: number; position: number; duration: number };
  isHistory?: boolean;
  showRanking?: boolean;
  handleAuxOpen?: (e: React.MouseEvent, path: string) => void;
  onRemoveItem?: (itemId: number, mediaType: string) => void;
  /** Settings reuse the card without navigation or watchlist mutations. */
  preview?: {
    posterSrc: string;
    palette: ReturnType<typeof useMediaColor>;
    enabled: boolean;
    focused: boolean;
    customImage: boolean;
    requireImageCors?: boolean;
    onImageError: () => void;
  };
}>(({
  item,
  index = 0,
  detailPath = '',
  priority = false,
  initialStarred = false,
  progressData = EMPTY_PROGRESS,
  isHistory = false,
  showRanking = false,
  handleAuxOpen,
  onRemoveItem,
  preview,
}) => {
  const { t } = useTranslation();
  const [starred, setStarred] = useState(initialStarred);
  // Nombre d'ajouts faits depuis cette carte : le thème Halloween fait
  // descendre l'araignée du bouton à chaque ajout.
  const [spiderDrops, setSpiderDrops] = useState(0);
  const title = item.title || item.name || '';
  const isCollection = item.media_type === 'collection';

  // Prepare the visible cards and their neighbours; mounting a row must not
  // start 30 metadata requests and decode every offscreen poster at once.
  const { ref: cardRef, isNearViewport, isInViewport } = useNearViewport<HTMLDivElement>(priority, !preview);
  const [hasFocus, setHasFocus] = useState(false);
  const renderContent = Boolean(preview) || isNearViewport || hasFocus;
  const imagesMediaType = !preview?.customImage && !isCollection && (item.media_type === 'movie' || item.media_type === 'tv')
    ? item.media_type
    : undefined;
  const { logoUrl, posterUrl } = useTmdbImages(
    imagesMediaType,
    item.id,
    undefined,
    preview ? preview.enabled || preview.focused : renderContent,
  );
  const { loadedSource: loadedLogoSource, imageRef: logoRef, onLoad: onLogoLoad } = useMediaImageSource(logoUrl ?? '');
  const isLogoReady = Boolean(logoUrl && loadedLogoSource);

  // Poster localisé si dispo (TMDB renvoie souvent une affiche FR différente
  // pour les sorties FR), sinon le poster_path par défaut du payload de liste.
  // Le swap natif <img src> arrive sans flash si l'URL ne change pas
  // (cas fréquent : la liste retourne déjà le poster FR si la requête liste
  // était en `language=fr-FR`).
  const posterSrc = preview?.posterSrc ?? posterUrl ?? (item.poster_path
    ? `https://image.tmdb.org/t/p/w342${item.poster_path}`
    : POSTER_FALLBACK);
  const { loadedSource, onSourceLoad } = useMediaImageSource(posterSrc);
  const cataloguePalette = useMediaColor('cards', preview ? null : posterSrc, !preview && renderContent, isInViewport || hasFocus, loadedSource);
  const palette = preview ? preview.palette : cataloguePalette;
  const { cardsBaseGradient } = useMediaColorSettings();
  const { effectiveImageQuality } = useImageQuality();
  const posterImage = getTmdbImageProps(posterSrc, {
    kind: 'poster', quality: effectiveImageQuality,
    sizes: '(min-width: 768px) 192px, 144px',
  });
  const [rankingImage, setRankingImage] = useState<{ source: string; loaded: string } | null>(null);
  const handlePosterLoad = useCallback((loaded: string) => {
    onSourceLoad(loaded);
    if (showRanking) setRankingImage((previous) => previous?.source === posterSrc && previous.loaded === loaded
      ? previous : { source: posterSrc, loaded });
  }, [posterSrc, onSourceLoad, showRanking]);

  const toggleWatchlist = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const key = isCollection ? 'watchlist_collections' : `watchlist_${item.media_type}`;
    const list: Array<{ id: number }> = JSON.parse(localStorage.getItem(key) || '[]');
    const exists = list.some((m) => m.id === item.id);
    if (exists) {
      localStorage.setItem(key, JSON.stringify(list.filter((m) => m.id !== item.id)));
      setStarred(false);
      toast.success(`${title} ${t('lists.removedFromList')}`, { duration: 2000 });
    } else {
      const newItem = isCollection
        ? {
            id: item.id,
            name: item.name || title,
            poster_path: item.poster_path,
            backdrop_path: item.backdrop_path,
            overview: item.overview,
            type: 'collection',
            addedAt: new Date().toISOString(),
          }
        : {
            id: item.id,
            type: item.media_type,
            title,
            poster_path: item.poster_path,
            addedAt: new Date().toISOString(),
          };
      list.unshift(newItem);
      localStorage.setItem(key, JSON.stringify(list));
      setStarred(true);
      setSpiderDrops((count) => count + 1);
      toast.success(`${title} ${t('lists.addedToList')}`, { duration: 2000 });
    }
  }, [item, title, t, isCollection]);

  const releaseDate = item.release_date || item.first_air_date;
  const year = releaseDate
    ? new Date(releaseDate).getFullYear()
    : null;

  const typeLabel = item.media_type === 'tv'
    ? t('common.series')
    : item.media_type === 'collection'
      ? t('common.saga')
      : t('common.movie');
  const hoverVisibility = preview?.focused
    ? ''
    : 'md:opacity-0 md:group-hover:opacity-100 md:group-has-[:focus-visible]:opacity-100';
  const WatchlistAction = preview ? 'span' : 'button';

  return (
    <div
      ref={cardRef}
      className={preview
        ? 'relative mx-auto w-[144px] max-w-full md:w-[192px]'
        : 'embla-slide flex-none relative w-[144px] md:w-[192px]'}
      onFocusCapture={() => setHasFocus(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHasFocus(false);
      }}
    >
      <div
        className={`${renderContent ? 'carousel-card' : ''} ${palette ? 'media-color-card' : ''} h-full relative group rounded-xl overflow-hidden bg-white/5 border border-white/10 hover:border-white/20 transition-[transform,background-color,border-color] duration-200 ease-out`}
        style={palette?.style}
      >
        {renderContent && <>
        {/* Type badge */}
        {!preview?.customImage && <span data-card-type-badge className="absolute top-2 left-2 z-10 px-2 py-1 rounded-lg bg-black/75 text-[10px] font-semibold uppercase tracking-wider text-white/80">
          {typeLabel}
        </span>}

        {/* Episode badge for history TV items */}
        {isHistory && 'currentEpisode' in item && item.currentEpisode && item.media_type === 'tv' && (
          <span data-card-episode-badge className="absolute top-9 left-2 z-10 px-2 py-1 rounded-lg bg-red-600 text-[10px] font-semibold tracking-wider text-white">
            S{item.currentEpisode.season}:E{item.currentEpisode.episode}
          </span>
        )}

        {/* Top-right action: remove (history) or watchlist (normal) — natif <button>
            avec title= pour le tooltip (zéro overhead vs Radix Tooltip qui mountait
            un portal par card sur hover). active:scale-* remplace whileTap. */}
        {isHistory && onRemoveItem ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRemoveItem(item.id, item.media_type);
            }}
            title={t('common.deleteAll')}
            aria-label={t('common.deleteAll')}
            className="absolute top-2 right-2 z-20 p-2 rounded-full bg-red-600/95 hover:bg-red-600 active:scale-[0.85] text-white transition-[colors,transform] duration-150"
          >
            <Trash className="w-3.5 h-3.5" />
          </button>
        ) : (
          <WatchlistAction
            data-card-watchlist
            // Alterne entre deux valeurs pour relancer l'animation à chaque ajout.
            data-spider-drop={spiderDrops ? (spiderDrops % 2 ? 'a' : 'b') : undefined}
            // Remontée finie : l'araignée retourne au seul survol.
            onAnimationEnd={spiderDrops ? (e) => {
              if (e.animationName.startsWith('halloween-watchlist-spider')) setSpiderDrops(0);
            } : undefined}
            type={preview ? undefined : 'button'}
            onClick={preview ? undefined : toggleWatchlist}
            title={preview ? undefined : starred ? t('profile.removeFromWatchlist') : t('profile.addToWatchlist')}
            aria-label={preview ? undefined : starred ? t('profile.removeFromWatchlist') : t('profile.addToWatchlist')}
            aria-hidden={preview ? true : undefined}
            className={`absolute top-2 right-2 z-20 p-2 rounded-full active:scale-[0.7] transition-[opacity,background-color,transform] duration-200 ${hoverVisibility} ${starred ? 'bg-yellow-500/40 border border-yellow-400/50' : 'bg-black/65 hover:bg-black/80'}`}
          >
            {/* initial={false} : pas de spring au mount (jusqu'à 30 cards par row révélée
                au scroll) ; le pop ne joue qu'au passage à starred via les keyframes */}
            <motion.div
              initial={false}
              animate={starred ? { scale: [0.3, 1], rotate: [-45, 0] } : { scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 15 }}
            >
              <Star
                className={`w-4 h-4 transition-colors duration-150 ${starred ? 'text-yellow-400' : 'text-white'}`}
                fill={starred ? 'currentColor' : 'none'}
              />
            </motion.div>
          </WatchlistAction>
        )}

        {/* Le navigateur adapte la définition à la largeur de la carte et au
            DPR, en conservant l'affiche localisée choisie par le cache. */}
        <div className="w-full aspect-[2/3] relative">
          <LazyImage
            {...posterImage}
            alt={title || t('common.poster')}
            className="rounded-xl w-full h-full"
            placeholder={POSTER_FALLBACK}
            priority={priority}
            customImage={preview?.customImage}
            requireImageCors={preview?.requireImageCors}
            onError={preview?.onImageError}
            onImageLoad={handlePosterLoad}
          />
        </div>

        {/* Voile sombre de survol (lisibilité) */}
        {cardsBaseGradient && (
          <div className={`absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent ${hoverVisibility} transition-opacity duration-300 pointer-events-none`} />
        )}

        {/* Garder les calques montés pour fondre la couleur même pendant le survol. */}
        <div aria-hidden="true" className="media-card-color-layers absolute inset-0 pointer-events-none">
          <div className="media-color-wash absolute inset-0" />
          <div className={`media-card-color-overlay absolute inset-0 ${hoverVisibility} transition-opacity duration-300`} />
        </div>

        {/* Survol ou focus clavier : un clic/drag ne doit pas garder les détails ouverts. */}
        <div className={`absolute bottom-0 left-0 right-0 p-3 ${hoverVisibility} ${preview?.focused ? '' : 'md:translate-y-2 md:group-hover:translate-y-0 md:group-has-[:focus-visible]:translate-y-0'} transition-[opacity,transform] duration-300 pointer-events-none`}>
          {/* Le titre reste lisible pendant le chargement ou si le logo échoue. */}
          <div className="relative mb-1.5 h-7">
            <h3 className={`absolute bottom-0 left-0 w-full text-sm font-bold text-white line-clamp-1 transition-opacity duration-200 ease-[ease] ${isLogoReady ? 'opacity-0' : 'opacity-100'}`}>
              {title}
            </h3>
            <div aria-hidden="true" className={`absolute inset-0 flex items-end transition-opacity duration-200 ease-[ease] ${isLogoReady ? 'opacity-100' : 'opacity-0'}`}>
              {logoUrl && (
                <img
                  src={logoUrl}
                  ref={logoRef}
                  onLoad={onLogoLoad}
                  alt=""
                  className="max-h-full max-w-full object-contain object-left drop-shadow-md"
                  draggable={false}
                  loading="lazy"
                  decoding="async"
                />
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 mb-1">
            {item.vote_average ? (
              <div data-card-rating className="flex items-center gap-1">
                <Star className="w-3 h-3 text-yellow-400" />
                <span className="text-xs text-white/80">
                  {item.vote_average.toFixed(1)}
                </span>
              </div>
            ) : null}
            {year && (
              <div data-card-year className="flex items-center gap-1">
            <Calendar className="w-3 h-3 text-white opacity-60" />
                <span className="media-card-muted text-xs text-white/60">{year}</span>
              </div>
            )}
          </div>
          {item.overview && (
            <p className="media-card-muted text-xs text-white/50 line-clamp-3">
              {item.overview}
            </p>
          )}
        </div>

        {/* Progress bar for history items */}
        {isHistory && progressData.percentage > 0 && (
          <div className="absolute left-0 right-0 bottom-0 h-1 bg-black/50 overflow-hidden rounded-b-xl z-10">
            <div
              className="h-full bg-red-600"
              style={{ width: `${progressData.percentage}%` }}
            />
          </div>
        )}
        </>}

        {/* Keep the link mounted: keyboard focus lets Embla reveal even a
            distant slide and immediately restores its interactive contents. */}
        {!preview && <Link
          to={detailPath}
          onAuxClick={(e) => handleAuxOpen?.(e, detailPath)}
          className="absolute inset-0 z-[5]"
        >
          <span className="sr-only">{title}</span>
        </Link>}
      </div>

      {/* Réutiliser la variante réellement chargée évite de télécharger une
          seconde taille uniquement pour remplir le numéro du classement. */}
      {showRanking && renderContent && (
        <div
          className="ranking-number"
          style={rankingImage?.source === posterSrc ? { backgroundImage: `url(${rankingImage.loaded})` } : undefined}
        >
          {index + 1}
        </div>
      )}
    </div>
  );
});

CarouselCard.displayName = 'CarouselCard';

const EmblaCarousel: React.FC<EmblaCarouselProps> = ({
  title,
  items,
  mediaType: _mediaType,
  isHistory = false,
  onRemoveItem,
  onRemoveAll,
  showRanking = false,
  priorityZIndex: _priorityZIndex = false,
  onViewAll,
  headerExtra,
  overlay
}) => {
  const { t } = useTranslation();
  const { effectivePrefs } = useLightMode();
  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: 'start',
    dragFree: true,
    containScroll: 'keepSnaps',
    slidesToScroll: 1,
    skipSnaps: false,
    // P7 — 25 → 15 : snap plus rapide = moins de frames pendant lesquelles
    // le browser doit composer + react au scroll. Si le visuel devient trop
    // saccadé sur trackpad/molette, remonter à 20.
    duration: effectivePrefs.transitions ? 15 : 0,
    startIndex: 0,
    loop: false,
    slides: '.embla-slide',
    // Le MutationObserver interne peut être construit sur un wrapper Firefox
    // déjà mort pendant un changement de page. React connaît les changements
    // de cartes : l'effet ci-dessous resynchronise Embla de façon contrôlée.
    watchSlides: false,
    // ResizeObserver peut livrer son dernier batch après le démontage.
    watchResize: watchMountedEmblaResize,
  });
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);
  const { items: allowedItems } = useAgeRestrictedContent<Media | ContinueWatching>(items);

  // Retain only membership IDs, not a full copy of every watchlist per row.
  const starredItems = useMemo(() => {
    const ids = new Set<string>();
    for (const type of ['movie', 'tv', 'collection']) {
      try {
        const list = JSON.parse(localStorage.getItem(type === 'collection' ? 'watchlist_collections' : `watchlist_${type}`) || '[]');
        if (Array.isArray(list)) {
          for (const item of list) ids.add(`${type}-${item.id}`);
        }
      } catch { /* An unavailable or malformed watchlist must not hide the row. */ }
    }
    return ids;
  }, []);

  // Limite le nombre d'items pour éviter de surcharger le DOM, sauf l'historique.
  const limitedItems = useMemo(
    () => (isHistory ? allowedItems : allowedItems.slice(0, CAROUSEL_MAX_ITEMS)),
    [allowedItems, isHistory],
  );
  const slidesRevision = useMemo(
    () => limitedItems.map((item) => `${item.media_type}:${item.id}`).join('|'),
    [limitedItems],
  );
  const previousSlidesRevision = useRef(slidesRevision);

  useEffect(() => {
    if (!emblaApi) {
      previousSlidesRevision.current = slidesRevision;
      return;
    }
    if (previousSlidesRevision.current === slidesRevision) return;
    previousSlidesRevision.current = slidesRevision;
    reInitMountedEmblaKeepingLocation(emblaApi);
  }, [emblaApi, slidesRevision]);

  // `priority` cap statique : les N premières cards reçoivent
  // `loading="eager"` + `fetchpriority="high"` pour aider le LCP. Calculé une
  // fois au mount selon le viewport (= getStep + 2 buffer pour couvrir les
  // cards initiales partiellement visibles). Pas de mise à jour pendant scroll
  // Les autres cartes utilisent le chargement natif et un observer partagé.
  const priorityCount = useMemo(() => {
    const w = typeof window !== 'undefined' ? window.innerWidth : 1024;
    if (w >= 1536) return 10; // 2K+
    if (w >= 1280) return 8;  // xl
    if (w >= 1024) return 7;  // lg
    if (w >= 768) return 6;   // md
    return 4;                 // sm/xs
  }, []);

  // Embla owns the scroll limits; avoid forced DOM measurements on selection.
  useEffect(() => {
    if (!emblaApi) return;
    const updateArrows = () => {
      setCanScrollPrev(emblaApi.canScrollPrev());
      setCanScrollNext(emblaApi.canScrollNext());
    };
    updateArrows();
    emblaApi.on('select', updateArrows);
    emblaApi.on('reInit', updateArrows);
    return () => {
      emblaApi.off('select', updateArrows);
      emblaApi.off('reInit', updateArrows);
    };
  }, [emblaApi]);

  // Support molette horizontale (tilt wheel / trackpad) -> scroll du carousel
  useEffect(() => {
    if (!emblaApi) return;
    const rootNode = emblaApi.rootNode();
    if (!rootNode) return;

    let lastWheel = 0;
    const THROTTLE_MS = 90;

    const onWheel = (e: WheelEvent) => {
      const absX = Math.abs(e.deltaX);
      const absY = Math.abs(e.deltaY);
      if (absX <= absY || absX < 2) return;
      e.preventDefault();
      const now = performance.now();
      if (now - lastWheel < THROTTLE_MS) return;
      lastWheel = now;
      if (e.deltaX > 0) emblaApi.scrollNext(!effectivePrefs.transitions);
      else emblaApi.scrollPrev(!effectivePrefs.transitions);
    };

    rootNode.addEventListener('wheel', onWheel, { passive: false });
    return () => rootNode.removeEventListener('wheel', onWheel);
  }, [emblaApi, effectivePrefs.transitions]);

  // Suppression hover pendant scroll horizontal du carousel (drag pointerUp lift,
  // settle pour wheel/scrollPrev/Next). Pose body.embla-scrolling -> CSS rule
  // `body.embla-scrolling .embla-slide { pointer-events: none }` (src/index.css)
  // empêche les hover flips quand les cards défilent sous le curseur.
  useEmblaScrollSuppress(emblaApi);

  const getStep = useCallback(() => {
    const w = typeof window !== 'undefined' ? window.innerWidth : 1024;
    if (w >= 1536) return 8; // 2K+
    if (w >= 1280) return 6; // xl
    if (w >= 1024) return 5; // lg
    if (w >= 768) return 4;  // md
    return 2;                // sm/xs
  }, []);

  const handlePrev = useCallback((e?: React.MouseEvent) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (!emblaApi) return;
    try {
      const current = emblaApi.selectedScrollSnap();
      const target = Math.max(0, current - getStep());
      emblaApi.scrollTo(target, !effectivePrefs.transitions);
    } catch {
      emblaApi.scrollPrev(!effectivePrefs.transitions);
    }
  }, [emblaApi, getStep, effectivePrefs.transitions]);

  const handleNext = useCallback((e?: React.MouseEvent) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (!emblaApi) return;
    try {
      const current = emblaApi.selectedScrollSnap();
      const snaps = emblaApi.scrollSnapList().length;
      const target = Math.min(snaps - 1, current + getStep());
      emblaApi.scrollTo(target, !effectivePrefs.transitions);
    } catch {
      emblaApi.scrollNext(!effectivePrefs.transitions);
    }
  }, [emblaApi, getStep, effectivePrefs.transitions]);

  // Open in new tab on middle-click
  const handleAuxOpen = useCallback((e: React.MouseEvent, path: string) => {
    // Middle mouse button is button === 1
    if ((e as React.MouseEvent).button === 1) {
      e.preventDefault();
      e.stopPropagation();
      try {
        window.open(path, '_blank', 'noopener,noreferrer');
      } catch {
        // Fallback without features string
        window.open(path, '_blank');
      }
    }
  }, []);

  // Function to get movie progress data - memoized
  const getMovieProgress = useCallback((movieId: number): { percentage: number, position?: number, duration?: number } => {
    try {
      const progressKey = `progress_${movieId}`;
      const savedData = localStorage.getItem(progressKey);

      if (savedData) {
        const progressData = JSON.parse(savedData);
        if (progressData.position && progressData.duration) {
          return {
            percentage: Math.min((progressData.position / progressData.duration) * 100, 100),
            position: progressData.position,
            duration: progressData.duration
          };
        }
      }
      return { percentage: 0 };
    } catch (error) {
      console.error('Error getting movie progress:', error);
      return { percentage: 0 };
    }
  }, []);

  // Function to get episode progress data - memoized
  const getEpisodeProgress = useCallback((showId: number, seasonNumber: number, episodeNumber: number): { percentage: number, position?: number, duration?: number } => {
    try {
      const progressKey = `progress_tv_${showId}_s${seasonNumber}_e${episodeNumber}`;
      const savedData = localStorage.getItem(progressKey);

      if (savedData) {
        const progressData = JSON.parse(savedData);
        if (progressData.position && progressData.duration) {
          return {
            percentage: Math.min((progressData.position / progressData.duration) * 100, 100),
            position: progressData.position,
            duration: progressData.duration
          };
        }
      }
      return { percentage: 0 };
    } catch (error) {
      console.error('Error getting episode progress:', error);
      return { percentage: 0 };
    }
  }, []);

  // Pre-compute a map de progression : 1 lecture localStorage par item au lieu
  // de 1× par item × par render. Recomputed seulement quand limitedItems change.
  // Garde une identité stable pour progressData → CarouselCard memo respecté.
  // Pour les items non-history, on retombe sur EMPTY_PROGRESS.
  const progressMap = useMemo(() => {
    const map = new Map<string, { percentage: number; position: number; duration: number }>();
    if (!isHistory) return map;
    for (const item of limitedItems) {
      const h = item as ContinueWatching;
      const itemKey = `${h.id}-${h.media_type}`;
      if (typeof h.position === 'number' && typeof h.duration === 'number' && h.position > 0 && h.duration > 0) {
        map.set(itemKey, {
          percentage: Math.min((h.position / h.duration) * 100, 100),
          position: h.position,
          duration: h.duration,
        });
      } else if (h.media_type === 'tv' && h.currentEpisode) {
        const ep = getEpisodeProgress(h.id, h.currentEpisode.season, h.currentEpisode.episode);
        map.set(itemKey, {
          percentage: ep.percentage,
          position: ep.position || 0,
          duration: ep.duration || 0,
        });
      } else if (h.media_type === 'movie') {
        const mv = getMovieProgress(h.id);
        map.set(itemKey, {
          percentage: mv.percentage,
          position: mv.position || 0,
          duration: mv.duration || 0,
        });
      }
    }
    return map;
  }, [limitedItems, isHistory, getEpisodeProgress, getMovieProgress]);

  if (limitedItems.length === 0) return null;

  return (
    <div className="mb-4 content-row-container -mx-3 md:-mx-4 group/carousel" style={{ position: 'relative' }}>
        <div className="flex justify-between items-center mb-2 px-4 md:px-6 relative">
          <div className={`flex items-center gap-3 ${headerExtra ? 'flex-wrap gap-y-2' : ''}`}>
            <h2 className="section-title">{title}</h2>
            {onViewAll && (
              <button
                onClick={onViewAll}
                className="flex items-center gap-1 px-3 py-1 text-xs font-medium text-gray-300 hover:text-white bg-gray-800/50 hover:bg-gray-700/70 rounded-full transition-all duration-200 border border-gray-700/50 hover:border-gray-600"
              >
                <span>{t('common.viewAll')}</span>
                <ChevronRight className="w-3 h-3" />
              </button>
            )}
            {headerExtra}
          </div>
          {isHistory && onRemoveAll && limitedItems.length > 0 && (
            <button
              onClick={onRemoveAll}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-700/80 hover:bg-red-700 text-white text-xs font-medium rounded-full transition-colors"
              aria-label="Supprimer tout"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{t('common.deleteAll')}</span>
            </button>
          )}
        </div>

        <div className="relative w-full overflow-visible">
          <div className="overflow-visible" ref={emblaRef}>
            {/* `select-none` est ici et non sur toute la rangée : il n'existe
                que pour empêcher la sélection de texte pendant qu'on fait
                glisser le carrousel. Posé plus haut, il rendait aussi le titre
                de section et les boutons impossibles à sélectionner. */}
            <div
              className="flex gap-4 pr-4 md:pr-6 pl-4 md:pl-6 select-none touch-pan-y touch-pinch-zoom"
              style={{ overflow: 'visible' }}
            >
              {limitedItems.map((item, index) => {
                const itemId = `carousel-${item.id}-${item.media_type}`;
                const detailPath = item.media_type === 'collection' ? `/collection/${item.id}` : `/${item.media_type}/${encodeId(item.id)}`;
                const initialStarred = starredItems.has(`${item.media_type}-${item.id}`);

                // Lookup mémoïsé : progressMap pré-calculée 1× par changement
                // d'items. Sur un re-render non lié (canScrollNext flip, hover),
                // on récupère ici la même référence d'objet → CarouselCard memo
                // respecté.
                const progressData = progressMap.get(`${item.id}-${item.media_type}`) ?? EMPTY_PROGRESS;

                return (
                  <CarouselCard
                    key={itemId}
                    item={item}
                    index={index}
                    detailPath={detailPath}
                    priority={index < priorityCount}
                    initialStarred={initialStarred}
                    progressData={progressData}
                    isHistory={isHistory}
                    showRanking={showRanking}
                    handleAuxOpen={handleAuxOpen}
                    onRemoveItem={onRemoveItem}
                  />
                );
              })}
            </div>
          </div>
          {overlay}
          {/* Boutons de navigation - verticaux noirs avec slide-in au hover */}
          <button
            type="button"
            aria-label={t('common.previous')}
            disabled={!canScrollPrev}
            onClick={handlePrev}
            onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
            data-carousel-arrow="prev"
            className={`group/icon hidden md:flex absolute left-6 md:left-8 top-1/2 z-[950]
                     w-12 h-32 rounded-2xl items-center justify-center text-white/90 hover:text-white
                     bg-gradient-to-b from-neutral-900/95 via-black/95 to-neutral-900/95
                     ring-1 ring-white/10 hover:ring-red-500/40
                     shadow-2xl shadow-black/70
                     transition-all duration-300 ease-out
                     -translate-y-1/2
                     opacity-0 -translate-x-2
                     group-hover/carousel:opacity-100 group-hover/carousel:translate-x-0
                     ${!canScrollPrev ? 'pointer-events-none !opacity-0' : 'pointer-events-auto'}`}
          >
            <ChevronLeft className="w-7 h-7 text-white opacity-90 group-hover/icon:opacity-100 transition-opacity duration-300" strokeWidth={2.25} />
          </button>
          <button
            type="button"
            aria-label={t('common.next')}
            disabled={!canScrollNext}
            onClick={handleNext}
            onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
            data-carousel-arrow="next"
            className={`group/icon hidden md:flex absolute right-6 md:right-8 top-1/2 z-[950]
                     w-12 h-32 rounded-2xl items-center justify-center text-white/90 hover:text-white
                     bg-gradient-to-b from-neutral-900/95 via-black/95 to-neutral-900/95
                     ring-1 ring-white/10 hover:ring-red-500/40
                     shadow-2xl shadow-black/70
                     transition-all duration-300 ease-out
                     -translate-y-1/2
                     opacity-0 translate-x-2
                     group-hover/carousel:opacity-100 group-hover/carousel:translate-x-0
                     ${!canScrollNext ? 'pointer-events-none !opacity-0' : 'pointer-events-auto'}`}
          >
            <ChevronRight className="w-7 h-7 text-white opacity-90 group-hover/icon:opacity-100 transition-opacity duration-300" strokeWidth={2.25} />
          </button>
        </div>
      </div>
  );
};

export default React.memo(EmblaCarousel);
