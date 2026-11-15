import React from 'react';
import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/components/ui/Skeleton';
import { useLightMode } from '@/context/LightModeContext';
import { useHeroHidden } from '@/hooks/useHeroVisibility';
import { HERO_OVERVIEW_SLOT, HERO_TITLE_SLOT } from '../heroLayout';

const HeroSkeleton: React.FC = () => {
  const { t } = useTranslation();
  const { effectivePrefs } = useLightMode();
  const isHidden = useHeroHidden();
  if (isHidden) return null;
  return (
    <div className="embla relative w-full select-none px-3 sm:px-6 md:px-12 lg:px-20 mx-auto max-w-[1920px] animate-skeleton-fade" aria-hidden="true">
      <div
        className="relative w-full h-[55vh] supports-[height:100svh]:h-[55svh] max-h-[620px] rounded-2xl sm:rounded-3xl overflow-hidden border border-white/10 shadow-2xl min-h-[340px] sm:min-h-[400px] md:min-h-[480px]"
      >
        {/* Backdrop skeleton */}
        <div className="absolute inset-0 z-0">
          <Skeleton width="100%" height="100%" />
        </div>

        {/* Static gradient overlays (chrome reproduced) */}
        <div
          className="absolute inset-0 z-10 pointer-events-none"
          style={{
            background: `
              linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.55) 35%, rgba(0,0,0,0.15) 65%, transparent 100%),
              linear-gradient(to right, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.35) 30%, rgba(0,0,0,0.05) 60%, transparent 100%)
            `,
          }}
        />

        {/* Content block */}
        <div className="absolute inset-0 flex items-end md:items-center z-20">
          <div className="w-full md:max-w-2xl px-4 sm:px-6 md:px-12 pb-20 md:pb-16">
            <div className="space-y-3 sm:space-y-5">
              <div className="flex flex-wrap gap-1.5 sm:gap-2 items-center">
                <Skeleton variant="pill" width={64} className="h-[25px] sm:h-[26px]" />
                <Skeleton variant="pill" width={70} className="h-[25px] sm:h-[26px]" />
                <Skeleton variant="pill" width={56} className="h-[25px] sm:h-[26px]" />
              </div>

              <div className={HERO_TITLE_SLOT}>
                <div className="w-2/3 h-full">
                  <Skeleton width="100%" height="100%" />
                </div>
              </div>

              <div className={HERO_OVERVIEW_SLOT}>
                {[100, 95, 70].map((width, index) => (
                  <div key={width} className={`${index === 2 ? 'hidden sm:flex' : 'flex'} h-[19.5px] sm:h-5 md:h-6 items-center`}>
                    <Skeleton variant="text" width={`${width}%`} containerClassName="w-full" />
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <div className="relative inline-flex items-center justify-center gap-2 px-5 sm:px-6 md:px-7 py-3 min-h-[48px] rounded-xl sm:rounded-2xl text-sm sm:text-base font-medium border border-transparent">
                  <span className="invisible w-4 h-4 sm:w-5 sm:h-5" />
                  <span className="invisible">{t('home.hero.moreInfo')}</span>
                  <div className="absolute inset-0"><Skeleton variant="button" height="100%" className="sm:!rounded-2xl" /></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom controls (dots + progress bar pill) */}
        <div className="absolute bottom-3 sm:bottom-4 md:bottom-6 left-0 right-0 z-30 flex items-center justify-center gap-4 px-3 sm:px-6 pointer-events-none">
          <div className="flex items-center gap-2 sm:gap-3 bg-black/60 border border-white/10 rounded-full px-3 sm:px-4 py-1.5 sm:py-2">
            <div className="flex items-center gap-1.5">
              {Array.from({ length: 5 }, (_, index) => <div key={index} className={`${index === 0 ? 'w-8' : 'w-1.5'} h-1.5 rounded-full bg-white/15`} />)}
            </div>
            {effectivePrefs.carouselAutoplay && <>
              <div className="w-px h-4 bg-white/20" />
              <div className="w-12 sm:w-20 h-1 bg-white/15 rounded-full" />
              <Skeleton width={14} height={14} />
            </>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default HeroSkeleton;
