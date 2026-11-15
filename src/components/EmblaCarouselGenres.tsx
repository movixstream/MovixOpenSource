import { useLightMode } from '@/context/LightModeContext';
import React, { useCallback, useEffect, useState } from 'react';
import useEmblaCarousel from '@/hooks/useFlexGapEmblaCarousel';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { useTranslation } from 'react-i18next';

interface GenreItem {
  id: number | string;
  name: string;
  route: string;
  imageUrl?: string;
}

interface EmblaCarouselGenresProps {
  title?: string | React.ReactNode;
  items: GenreItem[];
}

const EmblaCarouselGenres: React.FC<EmblaCarouselGenresProps> = ({ title, items }) => {
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

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    try {
      setCanScrollPrev(Boolean((emblaApi as any).canScrollPrev && emblaApi.canScrollPrev()));
      setCanScrollNext(Boolean((emblaApi as any).canScrollNext && emblaApi.canScrollNext()));
    } catch (_) {
      // noop
    }
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    onSelect();
    emblaApi.on('select', onSelect);
    emblaApi.on('reInit', onSelect);
    return () => {
      emblaApi.off('select', onSelect);
      emblaApi.off('reInit', onSelect);
    };
  }, [emblaApi, onSelect]);

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
    <div className="w-full relative">
      {title && (
        <div className="flex justify-between items-center mb-2 px-4 md:px-6 relative z-10">
          <h2 className="section-title">{title}</h2>
        </div>
      )}
      <div className="relative w-full">
        <div className="overflow-visible" ref={emblaRef}>
          <div className="flex gap-4 md:gap-6 pr-4 md:pr-6 py-4 pl-4 md:pl-6">
            {items.map((genre) => (
              <div key={genre.id} className="flex-none">
                <Link to={genre.route} className="block w-[180px] h-[100px] md:w-[220px] md:h-[120px] group select-none">
                  <div className="w-full h-full relative rounded-xl overflow-hidden bg-gradient-to-br from-red-600/20 to-red-400/10 ring-1 ring-white/10">
                    {genre.imageUrl && (
                      <img
                        src={genre.imageUrl}
                        alt={genre.name}
                        className="absolute inset-0 w-full h-full object-cover opacity-40 group-hover:opacity-50 transition-opacity duration-300"
                        loading="lazy"
                        decoding="async"
                        draggable={false}
                      />
                    )}
                    <div className="absolute inset-0 bg-black/5 group-hover:bg-black/0 transition-colors" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-white font-semibold text-base md:text-lg tracking-wide drop-shadow-md">
                        {genre.name}
                      </span>
                    </div>
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
          className={`absolute left-0 inset-y-0 z-[10000] rounded-none bg-black/40 hover:bg-black/50 text-white transition-colors shadow-lg
                     w-10 md:w-12 h-full flex items-center justify-center ${!canScrollPrev ? 'opacity-60' : ''}`}
          style={{ pointerEvents: 'auto' }}
        >
          <ChevronLeft className="w-5 h-5 md:w-6 md:h-6" />
        </button>
        <button
          type="button"
          aria-label={t('common.next')}
          onClick={handleNext}
          onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
          className={`absolute right-0 inset-y-0 z-[10000] rounded-none bg-black/40 hover:bg-black/50 text-white transition-colors shadow-lg
                     w-10 md:w-12 h-full flex items-center justify-center ${!canScrollNext ? 'opacity-60' : ''}`}
          style={{ pointerEvents: 'auto' }}
        >
          <ChevronRight className="w-5 h-5 md:w-6 md:h-6" />
        </button>
      </div>
    </div>
  );
};

export default React.memo(EmblaCarouselGenres);
