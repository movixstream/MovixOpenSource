import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import useEmblaCarousel from '@/hooks/useFlexGapEmblaCarousel';
import type { EmblaOptionsType } from 'embla-carousel';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { Play, Info, Star, Calendar, Pause } from 'lucide-react';
import { motion, AnimatePresence, useMotionValue } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { encodeId } from '../utils/idEncoder';
import ShinyText from './ui/shiny-text';
import { useAgeRestrictedContent } from '../hooks/useAgeRestrictedContent';
import { useTmdbImages, withTmdbImageSize } from '../hooks/useTmdbImages';
import { useLightMode } from '@/context/LightModeContext';
import { useHeroHidden } from '@/hooks/useHeroVisibility';
import { useHeroSliderStyle, useHeroMorphSpeed } from '@/hooks/useHeroSliderStyle';
import { useMediaColor } from '@/hooks/useMediaColor';
import { useMediaColorSettings } from '@/hooks/useMediaColorSettings';
import { useImageQuality, useImageViewport } from '@/hooks/useImageQuality';
import { useImageSlot } from '@/hooks/useImageSlot';
import { getCoverImageWidth, getTmdbImageSize } from '@/utils/tmdbImages';
import { MEDIA_HERO_BASE_GRADIENT as HERO_GRADIENT } from '@/utils/mediaColors';
import { HERO_OVERVIEW_SLOT, HERO_TITLE_SLOT } from './heroLayout';
import { MorphContent, type MorphFrame } from './hero/MorphContent';
import type { MorphBackdropProps, MorphStatus } from './hero/MorphBackdrop';
import { HeroPromoContent } from './hero/HeroPromoContent';
import { HERO_PROMO_FOCUS_Y, HERO_PROMO_OBJECT_POSITIONS } from './hero/heroPromoStyle';
import { useHeroPromos, type HeroPromoDisplay } from '@/hooks/useHeroPromos';
import type { HeroPromoPage } from '@/services/heroPromoService';

const AUTO_SLIDE_MS = 6000;
// Keep WebGL out of the classic slider's bundle. The HTML backdrop also covers
// unavailable chunks (for example after a deployment while a tab stays open).
function UnavailableMorph({ onStatusChange }: MorphBackdropProps) {
  useEffect(() => { onStatusChange('unavailable'); }, [onStatusChange]);
  return null;
}
const MorphBackdrop = React.lazy(() => import('./hero/MorphBackdrop').catch(() => ({ default: UnavailableMorph })));

// Sur mobile, taper « Regarder » ratait une fois sur deux : Embla démarre son
// drag dès le premier `touchmove` et appelle `preventDefault()`, ce qui pousse
// Chrome/Safari à supprimer le `click` synthétisé. Un doigt qui glisse de 2-3px
// pendant le tap ne naviguait donc jamais. `watchDrag` sort les éléments
// interactifs du geste de drag : un tap dessus reste un vrai clic (on perd
// juste la possibilité de démarrer un swipe pile sur un bouton).
const isInteractiveTarget = (target: EventTarget | null): boolean =>
  target instanceof Element && !!target.closest('a, button, [role="button"]');

// Objet figé au niveau module : `useEmblaCarousel` compare les options (les
// fonctions via leur source) et re-init si elles changent — un littéral inline
// recréé à chaque render déclencherait des reInit inutiles.
const HERO_EMBLA_OPTIONS: EmblaOptionsType = {
  loop: true,
  duration: 40,
  watchDrag: (_emblaApi, evt) => !isInteractiveTarget(evt.target),
};

interface Media {
  id: number;
  title?: string;
  name?: string;
  poster_path: string;
  backdrop_path: string;
  overview: string;
  vote_average: number;
  release_date?: string;
  first_air_date?: string;
  media_type: 'movie' | 'tv';
  genre_ids?: number[];
}

interface HeroSliderProps {
  items: Media[];
  /** Page du carrousel : ses promos (réglées dans l'admin) s'y ajoutent. */
  promoPage?: HeroPromoPage;
}

interface HeroSliderInnerProps {
  items: Media[];
  promos: HeroPromoDisplay[];
}

type HeroSlide =
  | { kind: 'media'; key: string; item: Media }
  | { kind: 'promo'; key: string; promo: HeroPromoDisplay };

// Chaque promo prend la place demandée (1 = première slide). À place égale,
// l'ordre de la liste de l'admin est gardé ; au-delà de la fin, elle va en
// dernier.
const buildHeroSlides = (items: Media[], promos: HeroPromoDisplay[]): HeroSlide[] => {
  const slides: HeroSlide[] = items.map((item) => ({ kind: 'media', key: `${item.media_type}-${item.id}`, item }));
  let lastIndex = -1;
  [...promos]
    .sort((a, b) => a.position - b.position)
    .forEach((promo) => {
      const index = Math.min(Math.max(promo.position - 1, lastIndex + 1), slides.length);
      slides.splice(index, 0, { kind: 'promo', key: `promo-${promo.id}`, promo });
      lastIndex = index;
    });
  return slides;
};

const getSlideLabel = (slide: HeroSlide): string => (
  slide.kind === 'promo' ? slide.promo.texts.title : slide.item.title || slide.item.name || ''
);

const getSlideObjectPosition = (slide: HeroSlide): string => (
  slide.kind === 'promo' ? HERO_PROMO_OBJECT_POSITIONS[slide.promo.imagePosition] : 'center 30%'
);

interface HeroSlideMetadataProps {
  /** Absent pour une promo : pas de logo TMDB à chercher. */
  item?: Media;
  image: string;
  colorEnabled: boolean;
  colorPriority: boolean;
  preloadEnabled: boolean;
  children: (logoUrl: string | null) => React.ReactNode;
}

// Chaque slide souscrit au cache TMDB partagé, même lorsqu'elle n'est pas
// active : les logos restent préchauffés et le logo courant s'affiche dès
// que sa propre requête aboutit, sans attendre une slide plus lente.
const HeroSlideMetadata: React.FC<HeroSlideMetadataProps> = ({ item, image, colorEnabled, colorPriority, preloadEnabled, children }) => {
  const { logoUrl } = useTmdbImages(item?.media_type, item?.id);
  const palette = useMediaColor('hero', image, colorEnabled, colorPriority);
  const displayLogo = logoUrl ? withTmdbImageSize(logoUrl, 'w500') : null;
  useEffect(() => {
    // Classic content only mounts on selection. Warm the neighbouring logos
    // too, keeping the same URL and request mode as their eventual <img>.
    if (!preloadEnabled || !displayLogo) return;
    const logo = new Image();
    logo.decoding = 'async';
    logo.fetchPriority = 'low';
    logo.src = displayLogo;
    if (typeof logo.decode === 'function') void logo.decode().catch(() => {});
    return () => { logo.removeAttribute('src'); };
  }, [displayLogo, preloadEnabled]);
  return <>
    {/* MorphContent blends this tint with the same clock as its image/text.
        The permanent black gradients underneath still protect readability. */}
    {palette && <div aria-hidden="true" className="absolute inset-0 z-10 pointer-events-none" style={{ background: palette.heroGradient }} />}
    {children(displayLogo)}
  </>;
};

// Inner component holds the heavy logic (Embla, timers, image fetches). When
// the user disables the hero in Settings, the outer wrapper unmounts this
// entirely → 0 RAM, 0 CPU, no logo fetch, no images downloaded.
const HeroSliderInner: React.FC<HeroSliderInnerProps> = ({ items, promos }) => {
  const { t } = useTranslation();
  const slides = useMemo(() => buildHeroSlides(items, promos), [items, promos]);
  const slideCount = slides.length;
  const { effectivePrefs } = useLightMode();
  const { heroBaseGradient } = useMediaColorSettings();
  const sliderStyle = useHeroSliderStyle();
  const morphSpeed = useHeroMorphSpeed();
  const isMorph = sliderStyle === 'morph';
  const jumpSlides = isMorph || !effectivePrefs.transitions;
  const options = useMemo(() => ({ ...HERO_EMBLA_OPTIONS, duration: jumpSlides ? 0 : 40 }), [jumpSlides]);
  const [emblaRef, emblaApi] = useEmblaCarousel(options);
  const { effectiveImageQuality } = useImageQuality();
  const viewport = useImageViewport();
  const mobileMorph = viewport.width < 768 || window.matchMedia('(pointer: coarse)').matches;
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const imageSlot = useImageSlot(imageContainerRef);
  const horizontalPadding = viewport.width >= 1024 ? 160 : viewport.width >= 768 ? 96 : viewport.width >= 640 ? 48 : 24;
  const imageWidth = imageSlot.width || Math.min(viewport.width, 1920) - horizontalPadding;
  const imageHeight = imageSlot.height || Math.max(viewport.width >= 768 ? 480 : viewport.width >= 640 ? 400 : 340, Math.min(viewport.height * 0.55, 620));
  const imageRole = isMorph ? 'morph' : 'hero';
  const imageDpr = Math.min(viewport.dpr, isMorph ? (mobileMorph ? 1 : 1.5) : effectiveImageQuality === 'high' ? 3 : 2);
  const backdropSize = getTmdbImageSize({ kind: 'backdrop', quality: effectiveImageQuality, role: imageRole,
    width: getCoverImageWidth(imageWidth, imageHeight, 16 / 9, imageDpr) });
  const posterSize = getTmdbImageSize({ kind: 'poster', quality: effectiveImageQuality, role: imageRole,
    width: getCoverImageWidth(imageWidth, imageHeight, 2 / 3, imageDpr) });
  // Depend on size tiers, not every resize pixel: Morph retains its textures
  // until a different source is actually needed. Originals never enter Morph.
  // Une promo garde son image telle quelle (image mobile sur téléphone).
  const mobileLayout = viewport.width < 768;
  const morphImages = useMemo(() => slides.map((slide) => {
    if (slide.kind === 'promo') {
      return (mobileLayout && slide.promo.mobileImageUrl) || slide.promo.imageUrl;
    }
    const { item } = slide;
    return item.backdrop_path || item.poster_path
      ? `https://image.tmdb.org/t/p/${item.backdrop_path ? backdropSize : posterSize}${item.backdrop_path || item.poster_path}`
      : '';
  }), [slides, backdropSize, posterSize, mobileLayout]);
  // Cadrage vertical de chaque image pour l'effet de transition WebGL : celui
  // choisi dans l'admin pour une promo, `center 30%` pour un film ou une série.
  const morphFocus = useMemo(() => slides.map((slide) => (
    slide.kind === 'promo' ? HERO_PROMO_FOCUS_Y[slide.promo.imagePosition] : 0.3
  )), [slides]);
  const autoSlideInterval = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const backdropRefs = useRef<(HTMLImageElement | null)[]>([]);
  const morphFrame = useMotionValue<MorphFrame>({ from: 0, to: 0, progress: 1 });
  const [morphStatus, setMorphStatus] = useState<MorphStatus>('loading');
  const [userPaused, setUserPaused] = useState(false);
  const isPaused = userPaused || !effectivePrefs.carouselAutoplay || slideCount < 2;
  const [isVisible, setIsVisible] = useState(true);
  const [documentVisible, setDocumentVisible] = useState(() => !document.hidden);
  const morphLoading = isMorph && effectivePrefs.transitions && slideCount > 1 && morphStatus === 'loading';
  const frozen = isPaused || !isVisible || !documentVisible || morphLoading;
  const shouldPreload = (index: number) => isVisible && documentVisible && (
    index === selectedIndex || index === (selectedIndex + 1) % slideCount
    || index === (selectedIndex - 1 + slideCount) % slideCount
  );
  useEffect(() => {
    if ((isMorph && effectivePrefs.transitions) || !isVisible || !documentVisible) return;
    // Decode the actual DOM images before a swipe, including last → first.
    // Only the selected slide and its two neighbours are promoted from lazy.
    const indices = new Set([selectedIndex, (selectedIndex + 1) % slideCount,
      (selectedIndex - 1 + slideCount) % slideCount]);
    indices.forEach((index) => {
      const image = backdropRefs.current[index];
      if (image && morphImages[index] && typeof image.decode === 'function') void image.decode().catch(() => {});
    });
  }, [isMorph, effectivePrefs.transitions, isVisible, documentVisible, selectedIndex, slideCount, morphImages]);
  const progressStartRef = useRef<number>(performance.now());
  // Incrémenté à chaque redémarrage du cycle (changement de slide OU
  // interaction utilisateur). Sert de `key` à la barre de progression pour que
  // l'animation CSS et le timer JS repartent toujours ensemble.
  const [progressKey, setProgressKey] = useState(0);

  useLayoutEffect(() => {
    // A cold renderer must retain the outgoing content while it prepares both
    // textures. Only a real failure falls back to an immediate selection.
    if (!isMorph || morphStatus === 'unavailable' || !effectivePrefs.transitions || !isVisible || !documentVisible || slideCount < 2) {
      const index = Math.min(selectedIndex, slideCount - 1);
      morphFrame.set({ from: index, to: index, progress: 1 });
    }
  }, [isMorph, morphStatus, effectivePrefs.transitions, isVisible, documentVisible, slideCount, selectedIndex, morphFrame]);

  // Track pause timing so unpause resumes from where we left off
  const pausedAtRef = useRef<number | null>(null);
  const frozenRef = useRef(frozen);
  useEffect(() => { frozenRef.current = frozen; }, [frozen]);
  const restartCycle = useCallback(() => {
    progressStartRef.current = performance.now();
    pausedAtRef.current = frozenRef.current ? performance.now() : null;
    setProgressKey((k) => k + 1);
  }, []);

  // Track selected slide for UI state + reset progress on slide change
  // Only depends on emblaApi so the handler is NOT re-registered on pause toggle
  useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => {
      restartCycle();
      setSelectedIndex(emblaApi.selectedScrollSnap());
    };
    onSelect();
    emblaApi.on('select', onSelect);
    emblaApi.on('reInit', onSelect);
    return () => {
      emblaApi.off('select', onSelect);
      emblaApi.off('reInit', onSelect);
    };
  }, [emblaApi, restartCycle]);

  // Pause when the hero scrolls off-screen — saves the auto-slide timer +
  // progress animation when the user is browsing further down the page.
  useEffect(() => {
    if (!emblaApi) return;
    const root = emblaApi.rootNode();
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        setIsVisible(entry.intersectionRatio > 0);
      },
      { threshold: [0, 0.05] }
    );
    obs.observe(root);
    return () => obs.disconnect();
  }, [emblaApi]);

  useEffect(() => {
    const sync = () => setDocumentVisible(!document.hidden);
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  // Auto-slide timer + progress bar — resumes cleanly after pause
  useEffect(() => {
    if (!emblaApi) return;

    if (frozen) {
      // Freeze: remember when we paused
      if (pausedAtRef.current === null) {
        pausedAtRef.current = performance.now();
      }
      if (autoSlideInterval.current) clearTimeout(autoSlideInterval.current);
      return;
    }

    // Resume or start: shift progressStart by pause duration
    if (pausedAtRef.current !== null) {
      const pauseDuration = performance.now() - pausedAtRef.current;
      progressStartRef.current += pauseDuration;
      pausedAtRef.current = null;
    }

    // Schedule next slide for the REMAINING time, not full interval
    const scheduleNext = () => {
      if (autoSlideInterval.current) clearTimeout(autoSlideInterval.current);
      const elapsed = performance.now() - progressStartRef.current;
      const remaining = Math.max(AUTO_SLIDE_MS - elapsed, 50);
      autoSlideInterval.current = setTimeout(() => emblaApi.scrollNext(jumpSlides), remaining);
    };
    scheduleNext();

    // Drag pause/resume via Embla pointer events
    const pauseOnPointer = () => {
      if (autoSlideInterval.current) clearTimeout(autoSlideInterval.current);
    };
    emblaApi.on('pointerDown', pauseOnPointer);
    emblaApi.on('pointerUp', scheduleNext);

    // Embla n'émet plus `pointerDown` quand le doigt se pose sur un bouton
    // (cf. `watchDrag`) : sans ça, la slide pouvait tourner pile pendant le tap
    // et le CTA disparaissait sous le doigt. On écoute donc le DOM directement
    // et on redonne un cycle complet après chaque interaction.
    const root = emblaApi.rootNode();
    const onPointerDownDom = () => {
      if (autoSlideInterval.current) clearTimeout(autoSlideInterval.current);
    };
    root?.addEventListener('pointerdown', onPointerDownDom, { passive: true });
    root?.addEventListener('pointerup', restartCycle, { passive: true });
    root?.addEventListener('pointercancel', restartCycle, { passive: true });

    return () => {
      if (autoSlideInterval.current) clearTimeout(autoSlideInterval.current);
      emblaApi.off('pointerDown', pauseOnPointer);
      emblaApi.off('pointerUp', scheduleNext);
      root?.removeEventListener('pointerdown', onPointerDownDom);
      root?.removeEventListener('pointerup', restartCycle);
      root?.removeEventListener('pointercancel', restartCycle);
    };
  }, [emblaApi, frozen, jumpSlides, progressKey, restartCycle]);

  // Horizontal wheel support
  useEffect(() => {
    if (!emblaApi) return;
    const rootNode = emblaApi.rootNode();
    if (!rootNode) return;

    let lastWheel = 0;
    const THROTTLE_MS = 250;

    const onWheel = (e: WheelEvent) => {
      const absX = Math.abs(e.deltaX);
      const absY = Math.abs(e.deltaY);
      if (absX <= absY || absX < 2) return;
      e.preventDefault();
      const now = performance.now();
      if (now - lastWheel < THROTTLE_MS) return;
      lastWheel = now;
      progressStartRef.current = performance.now();
      if (e.deltaX > 0) emblaApi.scrollNext(jumpSlides);
      else emblaApi.scrollPrev(jumpSlides);
    };

    rootNode.addEventListener('wheel', onWheel, { passive: false });
    return () => rootNode.removeEventListener('wheel', onWheel);
  }, [emblaApi, jumpSlides]);

  const scrollTo = useCallback((idx: number) => {
    if (emblaApi) {
      restartCycle();
      emblaApi.scrollTo(idx, jumpSlides);
    }
  }, [emblaApi, jumpSlides, restartCycle]);

  const getYear = (item: Media) => {
    const date = item.release_date || item.first_air_date;
    return date ? new Date(date).getFullYear() : null;
  };

  const displayedFrame = morphFrame.get();
  const fallbackIndex = Math.min(morphLoading
    ? (displayedFrame.progress >= 0.5 ? displayedFrame.to : displayedFrame.from)
    : selectedIndex, slideCount - 1);

  const renderContent = (slide: HeroSlide, idx: number) => {
    const isActive = idx === selectedIndex;
    const colorEnabled = isVisible && documentVisible && (isActive || idx === (selectedIndex + 1) % slideCount);
    if (slide.kind === 'promo') {
      return (
        <HeroSlideMetadata
          key={slide.key}
          image={morphImages[idx]}
          colorEnabled={colorEnabled}
          colorPriority={isActive}
          preloadEnabled={shouldPreload(idx)}
        >
          {() => <HeroPromoContent promo={slide.promo} isActive={isActive} isMorph={isMorph} frozen={frozen} />}
        </HeroSlideMetadata>
      );
    }
    const { item } = slide;
    const year = getYear(item);
    const rating = item.vote_average ? item.vote_average.toFixed(1) : null;
    return (
      <HeroSlideMetadata
        key={slide.key}
        item={item}
        image={morphImages[idx]}
        colorEnabled={colorEnabled}
        colorPriority={isActive}
        preloadEnabled={shouldPreload(idx)}
      >
        {(logoUrl) => (
          <div className="absolute inset-0 flex items-end md:items-center z-20">
            <div className="w-full md:max-w-2xl px-4 sm:px-6 md:px-12 pb-20 md:pb-16">
              <AnimatePresence mode="wait">
                {(isMorph || isActive) && (
                  <motion.div
                    key={`content-${item.id}`}
                    initial={isMorph ? false : { opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={isMorph ? undefined : { opacity: 0 }}
                    transition={isMorph ? { duration: 0 } : { duration: 0.5, delay: 0.1 }}
                    data-hero-content
                    className="space-y-3 sm:space-y-5"
                  >
                    {/* Badges — backdrop-blur removed (was a per-frame
                        filter pass on each); slightly more opaque
                        solid bg keeps legibility against any backdrop. */}
                    <div className="flex flex-wrap gap-1.5 sm:gap-2 items-center">
                      <span className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded-full bg-white/15 border border-white/20 text-white/90 text-[10px] sm:text-xs font-medium uppercase tracking-wider">
                        {item.media_type === 'movie' ? t('search.movieLabel') : t('search.serieLabel')}
                      </span>
                      {year && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded-full bg-white/10 border border-white/10 text-white/80 text-[10px] sm:text-xs font-medium">
                          <Calendar className="w-3 h-3 text-white opacity-80" />
                          {year}
                        </span>
                      )}
                      {rating && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded-full bg-yellow-500/25 border border-yellow-500/30 text-yellow-300 text-[10px] sm:text-xs font-semibold">
                          <Star className="w-3 h-3 fill-current" />
                          {rating}
                        </span>
                      )}
                    </div>

                    {/* Title or logo */}
                    <div className={HERO_TITLE_SLOT}>
                      {logoUrl ? (
                        <img
                          src={logoUrl}
                          alt={item.title || item.name}
                          className="block object-contain object-left w-auto h-auto max-w-full max-h-[64px] sm:max-h-[80px] md:max-h-[110px] min-h-[40px] md:min-h-[56px]"
                          draggable={false}
                          loading={isActive ? 'eager' : 'lazy'}
                          decoding="async"
                        />
                      ) : (
                        <h1 className="text-2xl sm:text-3xl md:text-5xl lg:text-6xl font-bold leading-tight line-clamp-2">
                          <ShinyText
                            text={item.title || item.name || ''}
                            speed={4}
                            color="#ffffff"
                            shineColor="#ef4444"
                            disabled={!isActive || frozen}
                          />
                        </h1>
                      )}
                    </div>

                    {/* Overview */}
                    <p className={`${HERO_OVERVIEW_SLOT} text-white/80`}>
                      {item.overview}
                    </p>

                    {/* Buttons */}
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                      <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
                        <Link
                          to={`/${item.media_type}/${encodeId(item.id)}`}
                          data-hero-cta
                          className="inline-flex items-center justify-center gap-2 bg-white/15 hover:bg-white/25 text-white px-5 sm:px-6 md:px-7 py-3 sm:py-3 min-h-[48px] rounded-xl sm:rounded-2xl text-sm sm:text-base font-medium border border-white/20 transition-colors touch-manipulation"
                        >
                          <Info className="w-4 h-4 sm:w-5 sm:h-5" />
                          {t('home.hero.moreInfo')}
                        </Link>
                      </motion.div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </HeroSlideMetadata>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      className="embla relative w-full select-none px-3 sm:px-6 md:px-12 lg:px-20 mx-auto max-w-[1920px]"
      data-hero-slider-style={sliderStyle}
      style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
    >
      <style>
        {`
          @keyframes hero-progress {
            from { transform: scaleX(0); }
            to   { transform: scaleX(1); }
          }
          .hero-progress-fill {
            transform-origin: left;
            animation: hero-progress var(--hero-duration, 6000ms) linear forwards;
          }
          .hero-progress-fill.is-paused {
            animation-play-state: paused;
          }
        `}
      </style>
      {/* Garder une hauteur explicite en vh pour les WebView sans svh :
          min-height seul ne dimensionne pas les slides internes à h-full.
          Le clip-path arrondi et `isolate` coupent aussi les slides pendant
          le glissement : Embla les déplace par transform sur un calque GPU
          que overflow-hidden + border-radius seuls ne coupent pas (coins
          carrés visibles pendant le slide, surtout sur WebKit). */}
      {/* Lueur orange du thème Halloween, derrière le cadre (le clip-path du
          cadre couperait une ombre posée dessus). Masquée hors thème. */}
      <div
        aria-hidden="true"
        className="halloween-hero-glow pointer-events-none absolute inset-y-0 left-3 right-3 sm:left-6 sm:right-6 md:left-12 md:right-12 lg:left-20 lg:right-20 rounded-2xl sm:rounded-3xl"
      />
      <div
        ref={imageContainerRef}
        data-hero-frame
        className="relative isolate w-full h-[55vh] supports-[height:100svh]:h-[55svh] max-h-[620px] rounded-2xl sm:rounded-3xl overflow-hidden [clip-path:inset(0_round_1rem)] sm:[clip-path:inset(0_round_1.5rem)] border border-white/10 shadow-2xl min-h-[340px] sm:min-h-[400px] md:min-h-[480px]"
      >
        {isMorph && (
          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            {(morphStatus !== 'ready' || !effectivePrefs.transitions) && isVisible && documentVisible && slides.map((slide, idx) => {
              const isActive = idx === fallbackIndex;
              // Warm neighbours even before the lazy renderer arrives, using
              // the same CORS request as its textures. Keep a no-CORS fallback
              // if that request or the renderer is unavailable.
              if (!isActive && !shouldPreload(idx)) return null;
              return <img
                key={slide.key}
                ref={(image) => { backdropRefs.current[idx] = image; }}
                src={morphImages[idx] || undefined}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
                style={{ objectPosition: getSlideObjectPosition(slide), visibility: isActive ? 'visible' : 'hidden' }}
                draggable={false}
                crossOrigin={morphStatus === 'unavailable' ? undefined : 'anonymous'}
                decoding="async"
                {...{ fetchpriority: isActive ? 'high' : 'low' }}
              />;
            })}
            {effectivePrefs.transitions && slideCount > 1 && (
              <React.Suspense fallback={null}>
                <MorphBackdrop
                  images={morphImages}
                  focus={morphFocus}
                  selectedIndex={selectedIndex}
                  active={isVisible && documentVisible}
                  frame={morphFrame}
                  onStatusChange={setMorphStatus}
                  speed={morphSpeed}
                  mobile={mobileMorph}
                />
              </React.Suspense>
            )}
          </div>
        )}
        <div className="embla__viewport relative h-full w-full overflow-hidden rounded-[inherit] touch-pan-y touch-pinch-zoom" ref={emblaRef}>
          <div className="embla__container flex h-full w-full touch-pan-y touch-pinch-zoom">
            {slides.map((slide, idx) => {
              const isActive = idx === selectedIndex;

              return (
                <div
                  className="embla__slide h-full relative"
                  key={slide.key}
                  style={{ userSelect: 'none', flex: '0 0 100%', minWidth: 0 }}
                >
                  {/* La couverture tient compte de la hauteur sur mobile.
                      Les appareils en mode léger et Morph gardent leurs limites. */}
                  {!isMorph && (
                    <img
                      ref={(image) => { backdropRefs.current[idx] = image; }}
                      src={morphImages[idx] || undefined}
                      alt={getSlideLabel(slide)}
                      className="absolute inset-0 w-full h-full object-cover z-0"
                      style={{ objectPosition: getSlideObjectPosition(slide) }}
                      draggable={false}
                      loading={isActive || shouldPreload(idx) ? 'eager' : 'lazy'}
                      decoding="async"
                      {...{ fetchpriority: isActive ? 'high' : 'low' }}
                    />
                  )}

                  {!isMorph && (
                    <>
                      {heroBaseGradient && <div className="absolute inset-0 z-10 pointer-events-none" style={{ background: HERO_GRADIENT }} />}
                      {renderContent(slide, idx)}
                    </>
                  )}
                </div>
              );
            })}
          </div>
          {isMorph && (
            <>
              {heroBaseGradient && <div className="pointer-events-none absolute inset-0 z-10" style={{ background: HERO_GRADIENT }} />}
              <MorphContent frame={morphFrame} blurEnabled={effectivePrefs.blurEffects} warpEnabled={!mobileMorph}>
                {slides.map((slide, idx) => renderContent(slide, idx))}
              </MorphContent>
            </>
          )}
        </div>

        {/* Lueur intérieure du thème Halloween, sous le texte. Masquée hors thème. */}
        <div aria-hidden="true" className="halloween-hero-inner pointer-events-none absolute inset-0 z-[15]" />

        {/* Bottom controls: dots + progress bar + pause */}
        <div className="absolute bottom-3 sm:bottom-4 md:bottom-6 left-0 right-0 z-30 flex items-center justify-center gap-4 px-3 sm:px-6 pointer-events-none">
          <div className="flex items-center gap-2 sm:gap-3 bg-black/60 border border-white/10 rounded-full px-3 sm:px-4 py-1.5 sm:py-2 pointer-events-auto">
            {/* Dots — le point ne mesure que 6px : le bouton l'entoure d'une zone
                tactile de 14x30px via un padding réabsorbé par une marge
                négative — le rendu visuel de la barre reste identique. */}
            <div className="flex items-center gap-1.5">
              {slides.map((slide, idx) => (
                <button
                  key={slide.key}
                  type="button"
                  onClick={() => scrollTo(idx)}
                  aria-label={t('settings.carouselSlide', { position: idx + 1, total: slideCount })}
                  aria-current={idx === selectedIndex ? 'true' : undefined}
                  className="group flex items-center justify-center px-1 -mx-1 py-3 -my-3 touch-manipulation"
                >
                  <span
                    className={`block transition-all rounded-full ${
                      idx === selectedIndex
                        ? 'w-8 h-1.5 bg-white'
                        : 'w-1.5 h-1.5 bg-white/40 group-hover:bg-white/60'
                    }`}
                  />
                </button>
              ))}
            </div>

            {/* Divider */}
            {effectivePrefs.carouselAutoplay && slideCount > 1 && <div className="w-px h-4 bg-white/20" />}

            {/* Progress bar */}
            {effectivePrefs.carouselAutoplay && slideCount > 1 && <div className="w-12 sm:w-20 h-1 bg-white/15 rounded-full overflow-hidden">
              <div
                key={progressKey}
                className={`h-full w-full bg-red-500 rounded-full hero-progress-fill ${frozen ? 'is-paused' : ''}`}
                style={{ ['--hero-duration' as string]: `${AUTO_SLIDE_MS}ms` } as React.CSSProperties}
              />
            </div>}

            {/* Pause toggle */}
            {effectivePrefs.carouselAutoplay && slideCount > 1 && <button
              type="button"
              onClick={() => setUserPaused((p) => !p)}
              aria-label={t(isPaused ? 'settings.carouselResume' : 'settings.carouselPause')}
              className="flex items-center justify-center p-2 -m-2 text-white/70 hover:text-white transition-colors touch-manipulation group/icon"
            >
              {isPaused ? <Play className="w-3.5 h-3.5 fill-current text-white opacity-70 group-hover/icon:opacity-100 transition-[color,opacity]" /> : <Pause className="w-3.5 h-3.5 fill-current text-white opacity-70 group-hover/icon:opacity-100 transition-[color,opacity]" />}
            </button>}
          </div>
        </div>
      </div>
    </motion.div>
  );
};

// Outer wrapper — reads the visibility flag and unmounts the inner component
// entirely when the user disabled the hero in Settings. This is what saves
// the freeze: no inner = no Embla, no logo fetch, no images, no timers.
const HeroSlider: React.FC<HeroSliderProps> = ({ items, promoPage }) => {
  const { items: allowedItems } = useAgeRestrictedContent(items);
  const promos = useHeroPromos(promoPage);
  const isHidden = useHeroHidden();

  if (isHidden || allowedItems.length === 0) return null;
  return <HeroSliderInner items={allowedItems} promos={promos} />;
};

export default React.memo(HeroSlider);
