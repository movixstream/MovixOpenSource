import { useLightMode } from '@/context/LightModeContext';
import React, { useCallback, useEffect, useState } from 'react';
import useEmblaCarousel from '@/hooks/useFlexGapEmblaCarousel';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { useTranslation } from 'react-i18next';

interface PlatformItem {
  id: number;
  src: string;
  alt: string;
  video?: string;
  route: string;
  label?: string;
}

interface EmblaCarouselPlatformsProps {
  title?: string | React.ReactNode;
  items: PlatformItem[];
}

const EmblaCarouselPlatforms: React.FC<EmblaCarouselPlatformsProps> = ({ title, items }) => {
  const { t } = useTranslation();
  const { effectivePrefs } = useLightMode();
  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: 'start',
    dragFree: true,
    containScroll: 'keepSnaps',
    slidesToScroll: 1,
    skipSnaps: false,
    duration: effectivePrefs.transitions ? 25 : 0,
    loop: false
  });
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);

  useEffect(() => {
    if (!emblaApi) return;
    const updateArrows = () => {
      try {
        setCanScrollPrev(emblaApi.canScrollPrev());
        setCanScrollNext(emblaApi.canScrollNext());
      } catch (_) {
        // noop
      }
    };
    updateArrows();
    emblaApi.on('select', updateArrows);
    emblaApi.on('reInit', updateArrows);
    return () => {
      emblaApi.off('select', updateArrows);
      emblaApi.off('reInit', updateArrows);
    };
  }, [emblaApi]);

  const getStep = useCallback(() => {
    const w = typeof window !== 'undefined' ? window.innerWidth : 1024;
    if (w >= 1536) return 4; // Larger items, fewer per step
    if (w >= 1280) return 3;
    if (w >= 1024) return 3;
    if (w >= 768) return 2;
    return 1;
  }, []);

  const handlePrev = useCallback((e?: React.MouseEvent) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (!emblaApi) return;
    try {
      const current = emblaApi.selectedScrollSnap();
      const target = Math.max(0, current - getStep());
      emblaApi.scrollTo(target, !effectivePrefs.transitions);
    } catch (_) {
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
    } catch (_) {
      emblaApi.scrollNext(!effectivePrefs.transitions);
    }
  }, [emblaApi, getStep, effectivePrefs.transitions]);

  return (
    <div className="w-full relative group/carousel -mx-3 md:-mx-4">
      {title && (
        <div className="flex justify-between items-center mb-2 px-4 md:px-6 relative z-10">
          <h2 className="section-title">{title}</h2>
        </div>
      )}
      <div className="relative w-full">
        <div className="overflow-visible" ref={emblaRef}>
          <div className="flex gap-6 pr-8 md:pr-16 py-8 pl-4 md:pl-6 touch-pan-y touch-pinch-zoom">
            {items.map((platform) => (
              <div key={platform.id} className="flex-none">
                <Link to={platform.route} className="platform-link block w-[250px] h-[150px] group select-none">
                  <div
                    className="w-full h-full relative bg-white rounded-xl"
                    onMouseEnter={() => {
                      if (!effectivePrefs.bgAnimations) return;
                      if (!platform.video?.endsWith('.gif')) {
                        const video = document.getElementById(`video-${platform.id}`) as HTMLVideoElement | null;
                        if (video) {
                          try {
                            // preload="none" : rien n'est téléchargé au mount (~2,4 Mo
                            // économisés sur la Home). On ne déclenche le chargement
                            // qu'au tout premier survol, une seule fois (dataset flag
                            // pour ne pas relancer un fetch réseau aux survols suivants).
                            if (!video.dataset.loaded) {
                              video.dataset.loaded = 'true';
                              video.load();
                            }
                            video.currentTime = 0;
                            video.play().catch(() => {});
                          } catch (_) {}
                        }
                      }
                    }}
                    onMouseLeave={() => {
                      if (!platform.video?.endsWith('.gif')) {
                        const video = document.getElementById(`video-${platform.id}`) as HTMLVideoElement | null;
                        if (video) {
                          try { video.pause(); video.currentTime = 0; } catch (_) {}
                        }
                      }
                    }}
                  >
                    <img
                      src={platform.src}
                      alt={platform.alt}
                      className={`w-full h-full object-contain p-8 ${effectivePrefs.bgAnimations && platform.video ? 'group-hover:opacity-0 transition-opacity duration-300' : ''}`}
                      draggable="false"
                      loading="lazy"
                      decoding="async"
                    />
                    {platform.label && (
                      <p className="absolute bottom-2 left-0 right-0 text-center text-white text-xs font-bold bg-black/60 py-1 px-2 mx-4 rounded-lg">
                        {platform.label}
                      </p>
                    )}
                    {effectivePrefs.bgAnimations && platform.video && (
                      platform.video.endsWith('.gif') ? (
                        <img
                          id={`video-${platform.id}`}
                          src={platform.video}
                          alt={platform.alt}
                          className="absolute inset-0 w-full h-full object-cover opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-xl"
                        />
                      ) : (
                        <video
                          id={`video-${platform.id}`}
                          className="absolute inset-0 w-full h-full object-cover opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-xl"
                          loop
                          muted
                          playsInline
                          preload="none"
                        >
                          <source src={platform.video} type="video/mp4" />
                        </video>
                      )
                    )}
                  </div>
                </Link>
              </div>
            ))}
            <div className="flex-none w-8 md:w-24" aria-hidden="true" />
          </div>
        </div>
        <button
          type="button"
          aria-label={t('common.previous')}
          onClick={handlePrev}
          onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
          data-carousel-arrow="prev"
          className={`group/icon hidden md:flex absolute left-6 md:left-8 top-1/2 z-20
                     w-12 h-32 rounded-2xl items-center justify-center text-white/90 hover:text-white
                     bg-gradient-to-b from-neutral-900/70 via-black/80 to-neutral-900/70 backdrop-blur-md
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
          onClick={handleNext}
          onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
          data-carousel-arrow="next"
          className={`group/icon hidden md:flex absolute right-6 md:right-8 top-1/2 z-20
                     w-12 h-32 rounded-2xl items-center justify-center text-white/90 hover:text-white
                     bg-gradient-to-b from-neutral-900/70 via-black/80 to-neutral-900/70 backdrop-blur-md
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

export default React.memo(EmblaCarouselPlatforms);

