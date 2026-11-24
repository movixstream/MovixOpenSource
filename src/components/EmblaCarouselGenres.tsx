import { useLightMode } from '@/context/LightModeContext';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import useEmblaCarousel from '@/hooks/useFlexGapEmblaCarousel';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { useTranslation } from 'react-i18next';
import { genreTileTones } from '@/utils/genreTiles';

interface GenreItem {
  id: number | string;
  name: string;
  route: string;
  /** Affiches choisies par pickGenrePosters (deux au plus). */
  posters?: string[];
}

// Courbe de sortie franche pour l'appui sur la tuile.
const PRESS_EASE = '[transition-timing-function:cubic-bezier(0.23,1,0.32,1)]';

// Les deux affiches partent du même coin ; seule la place « arrière » est
// décalée vers la gauche (--fan-x, posé sur la tuile). Au survol, elles
// échangent leur place : déplacement à l'écran, donc ease-in-out, et le
// z-index ne bascule qu'à mi-course pour qu'elles se croisent proprement.
const POSTER_SWAP =
  '[transition:transform_300ms_cubic-bezier(0.77,0,0.175,1),z-index_0s_linear_150ms] motion-reduce:transition-none';
const POSTER_BACK = 'z-0 translate-x-[var(--fan-x)] translate-y-0.5 -rotate-[10deg]';
const POSTER_FRONT = 'z-10 translate-x-0 translate-y-0 rotate-[14deg]';
const POSTER_SLOTS = [
  `${POSTER_BACK} group-hover:z-10 group-hover:translate-x-0 group-hover:translate-y-0 group-hover:rotate-[14deg]`,
  `${POSTER_FRONT} group-hover:z-0 group-hover:translate-x-[var(--fan-x)] group-hover:translate-y-0.5 group-hover:-rotate-[10deg]`,
];

const hidePoster = (e: React.SyntheticEvent<HTMLImageElement>) => {
  e.currentTarget.style.display = 'none';
};

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

  const tileTones = useMemo(() => items.map((genre) => genreTileTones(genre.id)), [items]);

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
            {items.map((genre, genreIndex) => (
              <div key={genre.id} className="flex-none">
                <Link
                  to={genre.route}
                  className={`block w-[180px] h-[100px] md:w-[220px] md:h-[120px] group select-none rounded-xl
                             transition-transform duration-150 ${PRESS_EASE} active:scale-[0.97]
                             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70`}
                >
                  <div
                    data-ambient-surface
                    className="w-full h-full relative rounded-xl overflow-hidden ring-1 ring-inset ring-white/10
                               shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] [--fan-x:-42px] md:[--fan-x:-48px]"
                    style={{ background: tileTones[genreIndex].background }}
                  >
                    {/* Halo derrière les affiches ; il s'allume un peu au survol. */}
                    <div
                      className="absolute inset-0 opacity-80 transition-opacity duration-200 ease-out group-hover:opacity-100"
                      style={{ background: tileTones[genreIndex].halo }}
                      aria-hidden="true"
                    />
                    {genre.posters?.slice(0, POSTER_SLOTS.length).map((poster, index, shown) => (
                      <img
                        key={poster}
                        src={poster}
                        alt=""
                        aria-hidden="true"
                        className={`absolute -right-2 -bottom-2.5 w-[50px] h-[75px] md:w-[58px] md:h-[87px] rounded-md object-cover
                                   shadow-[0_6px_16px_rgba(0,0,0,0.45)] ring-1 ring-white/15
                                   ${POSTER_SWAP} ${shown.length > 1 ? POSTER_SLOTS[index] : POSTER_FRONT}`}
                        loading="lazy"
                        decoding="async"
                        draggable={false}
                        onError={hidePoster}
                      />
                    ))}
                    <span className="absolute z-20 left-3 top-2.5 md:left-3.5 md:top-3 max-w-[58%] text-white font-bold text-base md:text-lg leading-tight [text-wrap:balance] drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]">
                      {genre.name}
                    </span>
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
