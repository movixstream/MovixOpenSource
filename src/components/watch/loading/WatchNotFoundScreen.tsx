// src/components/watch/loading/WatchNotFoundScreen.tsx
//
// Écran « pas de version française » des pages Watch, dans le style de
// l'écran de chargement : même fond (image floue + lueur de sa couleur), même
// cadre 16:9 entre les crochets, mais l'image est éteinte. À droite (en
// dessous sur téléphone), ce qui se passe et le bouton vers les lecteurs VO.
//
// L'écran remplit son parent : la page garde son menu des sources par-dessus.
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, AlertTriangle, Star } from 'lucide-react';

import { useMediaColor } from '@/hooks/useMediaColor';
import { formatDetailsRating } from '@/components/details/format';
import Bracket from './Bracket';

interface WatchNotFoundScreenProps {
  kind: 'movie' | 'episode';
  backdropUrl?: string | null;
  logoUrl?: string | null;
  title: string;
  /** « 2024 · 2 h 46 », « Saison 1 · Épisode 4 »… */
  meta?: string | null;
  /** Titre de l'épisode (séries). */
  subtitle?: string | null;
  genres?: string[] | null;
  rating?: number | null;
  onBack: () => void;
  onChooseVo: () => void;
}

const WatchNotFoundScreen: React.FC<WatchNotFoundScreenProps> = ({
  kind, backdropUrl, logoUrl, title, meta, subtitle, genres, rating, onBack, onChooseVo,
}) => {
  const { t, i18n } = useTranslation();
  const [logoFailed, setLogoFailed] = useState(false);
  const palette = useMediaColor('hero', backdropUrl ?? null, Boolean(backdropUrl), true);
  const accent = palette?.color ?? '#a8a29e';

  useEffect(() => { setLogoFailed(false); }, [logoUrl]);

  const showLogo = Boolean(logoUrl) && !logoFailed;
  const shownGenres = (genres ?? []).filter(Boolean).slice(0, 2);
  const ratingLabel = rating && rating > 0 ? formatDetailsRating(rating, i18n.language) : null;
  const hasInfoLine = Boolean(meta || shownGenres.length > 0 || ratingLabel);

  return (
    <div className="relative h-full w-full overflow-hidden bg-black text-stone-50">
      {/* Fond : l'image floue, la lueur, puis un voile qui finit en noir franc. */}
      <div aria-hidden="true" className="absolute inset-0 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-700">
        {backdropUrl && (
          <img src={backdropUrl} alt="" className="absolute -inset-16 h-[calc(100%+8rem)] w-[calc(100%+8rem)] max-w-none object-cover opacity-30 blur-3xl saturate-[.8]" />
        )}
        <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse 55% 50% at 36% 38%, ${accent}40, transparent 70%)` }} />
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 80% 75% at 45% 40%, transparent 30%, #000 92%)' }} />
      </div>

      <div className="relative flex h-full flex-col overflow-y-auto">
        <div className="flex items-center px-4 pt-[max(1rem,env(safe-area-inset-top))] md:px-10 md:pt-7">
          <button
            type="button"
            onClick={onBack}
            className="flex h-11 items-center gap-2 rounded-xl border border-white/10 bg-black/35 px-3 text-sm font-medium text-stone-50 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 active:scale-[.98] md:pr-4"
          >
            <ArrowLeft className="h-[18px] w-[18px]" aria-hidden="true" />
            <span className="hidden md:inline">{t('watch.loadingScreen.back')}</span>
            <span className="sr-only md:hidden">{t('watch.loadingScreen.back')}</span>
          </button>
        </div>

        <div className="mx-auto grid w-full max-w-[1320px] flex-1 grid-cols-1 content-start gap-9 px-[44px] pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-6 md:px-[84px] lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)] lg:content-center lg:gap-x-24 lg:pb-10 lg:pt-4">
          {/* Le cadre du lecteur, vide : l'image éteinte entre les crochets. */}
          <div className="relative w-full self-center motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-[.97] motion-safe:duration-500">
            <Bracket side="left" style={{ opacity: 0.55 }} />
            <Bracket side="right" style={{ opacity: 0.55 }} />
            <div
              className="relative aspect-video w-full overflow-hidden rounded-2xl bg-neutral-950"
              style={{ boxShadow: `0 30px 80px -24px ${accent}40, 0 0 0 1px rgba(255,255,255,.08)` }}
            >
              {backdropUrl && (
                <img
                  src={backdropUrl}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                  style={{ filter: 'brightness(.32) saturate(.35)' }}
                />
              )}
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center md:gap-4">
                {showLogo ? (
                  <img
                    src={logoUrl ?? undefined}
                    alt={title}
                    onError={() => setLogoFailed(true)}
                    className="max-h-[42%] w-auto max-w-[62%] object-contain opacity-90 drop-shadow-[0_4px_24px_rgba(0,0,0,.6)]"
                  />
                ) : (
                  <span className="text-balance text-2xl font-semibold tracking-tight text-stone-100 md:text-4xl">{title}</span>
                )}
                {hasInfoLine && (
                  <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-stone-300 md:text-[13px]">
                    {meta && <span>{meta}</span>}
                    {shownGenres.length > 0 && (
                      <span className="hidden sm:inline">
                        {meta && <span aria-hidden="true" className="mr-2 opacity-50">·</span>}
                        {shownGenres.join(', ')}
                      </span>
                    )}
                    {ratingLabel && (
                      <span
                        title={t('details.ratingLabel')}
                        className="inline-flex h-5 items-center gap-1 rounded-full bg-black/40 px-2 font-semibold tabular-nums text-stone-50 ring-1 ring-white/15 md:h-6 md:px-2.5"
                      >
                        <Star className="h-3 w-3 fill-amber-300 text-amber-300" aria-hidden="true" />
                        {ratingLabel}
                      </span>
                    )}
                  </div>
                )}
                {subtitle && <span className="line-clamp-1 text-sm font-medium text-stone-200 md:text-base">{subtitle}</span>}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-3 motion-safe:fill-mode-both motion-safe:delay-150 motion-safe:duration-500">
            <div role="status" className="flex flex-col gap-3">
              <div className="flex items-center gap-2.5 text-[13px] font-medium text-stone-400">
                <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full shadow-[inset_0_0_0_1.5px_#78716c]" />
                {t('watch.loadingScreen.notFound.kicker')}
              </div>
              <h2 className="text-balance text-[28px] font-semibold leading-[1.1] tracking-tight md:text-[34px]">
                {t('watch.loadingScreen.notFound.title')}
              </h2>
              <p className="max-w-[44ch] text-pretty text-[15px] leading-relaxed text-stone-300">
                {t(kind === 'movie' ? 'watch.loadingScreen.notFound.movieDesc' : 'watch.loadingScreen.notFound.episodeDesc')}
              </p>
            </div>

            <div className="flex gap-2.5 rounded-xl bg-amber-300/[.07] px-3.5 py-3 text-[13px] leading-snug text-amber-100/90 ring-1 ring-inset ring-amber-200/15">
              <AlertTriangle className="mt-px h-4 w-4 shrink-0 text-amber-300" strokeWidth={2.2} aria-hidden="true" />
              <span className="text-pretty">{t('watch.loadingScreen.notFound.warning')}</span>
            </div>

            <button
              type="button"
              onClick={onChooseVo}
              className="group mt-1 flex h-14 w-full items-center justify-between gap-3 rounded-[14px] bg-stone-50 px-[18px] text-left text-neutral-950 transition-[background-color,transform] duration-200 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black active:scale-[.98] lg:h-[52px] lg:rounded-xl"
            >
              <span className="text-[15px] font-semibold">{t('watch.loadingScreen.notFound.cta')}</span>
              <span className="flex items-center gap-1.5 truncate text-xs font-medium opacity-65">
                {t('watch.loadingScreen.notFound.ctaSub')}
                <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WatchNotFoundScreen;
