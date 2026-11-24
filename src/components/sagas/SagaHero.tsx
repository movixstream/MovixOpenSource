import React from 'react';
import { useTranslation } from 'react-i18next';
import { Bookmark, ChevronLeft, Heart, ListPlus, Play, Star, type LucideIcon } from 'lucide-react';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { cn } from '@/lib/utils';
import { useImageQuality } from '@/hooks/useImageQuality';
import { useMediaColor } from '@/hooks/useMediaColor';
import { getTmdbImageProps } from '@/utils/tmdbImages';
import { DetailsHeroBackdrop } from '@/components/details/DetailsHeroBackdrop';
import { SagaProgressBar } from './SagaProgressBar';
import { formatRating, formatRuntime, stripSagaSuffix } from './sagaFormat';

export interface SagaHeroCta {
  href: string;
  label: string;
  /** Titre du film visé, en petit à côté du libellé. */
  caption?: string;
}

interface SagaHeroProps {
  /** Nom complet de TMDB ; le suffixe « - Saga » est retiré à l'affichage. */
  name: string;
  backdropPath: string | null;
  overview: string;
  filmCount: number;
  years: string | null;
  /** Durée totale en minutes et note moyenne : null tant que le détail des films charge. */
  totalRuntime: number | null;
  averageRating: number | null;
  cta: SagaHeroCta | null;
  progress: { watchedCount: number; total: number; watched: readonly boolean[] } | null;
  inWatchlist: boolean;
  isFavorite: boolean;
  onToggleWatchlist: () => void;
  onToggleFavorite: () => void;
  onAddToList: () => void;
}

const FOCUS_RING =
  'outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';

const Separator: React.FC = () => (
  <span aria-hidden="true" className="mx-1.5 opacity-50 md:mx-2">·</span>
);

interface HeroActionProps {
  Icon: LucideIcon;
  label: string;
  pressed?: boolean;
  onClick: () => void;
}

/** Bouton discret avec libellé : icône au-dessus sur téléphone, à gauche à partir de `md`. */
const HeroAction: React.FC<HeroActionProps> = ({ Icon, label, pressed, onClick }) => (
  <button
    type="button"
    aria-pressed={pressed}
    onClick={onClick}
    className={cn(
      'flex min-h-[60px] flex-col items-center gap-1.5 rounded-[10px] px-1 py-2 text-center text-[12px] font-medium leading-tight text-white transition-[background-color,transform] duration-200 hover:bg-white/10 active:scale-[0.98] motion-reduce:transition-none md:h-11 md:min-h-0 md:flex-row md:gap-2 md:px-3 md:py-0 md:text-[14px]',
      FOCUS_RING,
    )}
  >
    <Icon
      className={cn(
        'h-[22px] w-[22px] flex-none text-white md:h-[18px] md:w-[18px]',
        pressed ? 'fill-current opacity-100' : 'opacity-85 md:opacity-75',
      )}
      aria-hidden="true"
    />
    {label}
  </button>
);

/**
 * Haut de la page d'une collection : grande image sous l'en-tête du site, nom,
 * chiffres, résumé, bouton rouge, actions et avancement.
 *
 * Un seul arbre pour les deux mises en page. À partir de `md`, tout tient dans
 * l'image et l'avancement passe à droite. Sur téléphone, l'image ne couvre que
 * le nom ; bouton, actions, avancement et résumé suivent dessous, dans cet
 * ordre (classes `order-*`, le bloc de gauche étant alors « transparent »).
 *
 * La coulure de l'image sort de la section et coule dans le haut
 * de la page (`drip` de `DetailsHeroBackdrop`) : la section ne coupe rien
 * de ce qui dépasse, et le contenu qui suit est positionné pour passer
 * au-dessus.
 */
export const SagaHero: React.FC<SagaHeroProps> = ({
  name,
  backdropPath,
  overview,
  filmCount,
  years,
  totalRuntime,
  averageRating,
  cta,
  progress,
  inWatchlist,
  isFavorite,
  onToggleWatchlist,
  onToggleFavorite,
  onAddToList,
}) => {
  const { t, i18n } = useTranslation();
  const { effectiveImageQuality } = useImageQuality();
  const backdrop = backdropPath
    ? getTmdbImageProps(backdropPath, {
        kind: 'backdrop',
        quality: effectiveImageQuality,
        role: 'hero',
        sizes: '100vw',
      })
    : null;
  // Couleur de l'image pour la coulure du téléphone, mêmes réglages que les
  // fiches (Apparence → couleurs du hero).
  const palette = useMediaColor('hero', backdrop?.src ?? null, Boolean(backdrop), true);
  const runtime = formatRuntime(totalRuntime, t);
  const rating = averageRating !== null && Number.isFinite(averageRating) && averageRating > 0
    ? formatRating(averageRating, i18n.language)
    : null;

  return (
    <section className="relative md:flex md:min-h-[clamp(520px,46vw,800px)] md:items-end">
      {/* Image et voiles, comme les fiches film et série. Sans image : fond
          noir, même mise en page. */}
      <DetailsHeroBackdrop
        image={backdrop}
        phoneHeight="460px"
        positionClass="object-[66%_20%] md:object-[60%_20%]"
        phoneFadeClass="h-[74%]"
        drip="section"
        dripColor={palette?.color}
      >
        {/* Écran étroit : voile de gauche plus large, le texte prend toute la largeur. */}
        <div className="absolute inset-0 hidden bg-gradient-to-r from-black/[0.85] via-black/50 via-60% to-black/30 md:block lg:hidden" />
        <div className="absolute inset-0 hidden bg-gradient-to-r from-black/[0.92] via-black/[0.66] via-[32%] to-transparent to-[64%] lg:block" />
      </DetailsHeroBackdrop>

      <div className="relative z-[1] mx-auto flex w-full max-w-[1920px] flex-col gap-2.5 px-3 sm:px-6 md:flex-row md:flex-wrap md:items-end md:justify-between md:gap-8 md:px-12 md:pb-10 md:pt-[110px] lg:px-20">
        <div className="contents md:flex md:min-w-0 md:max-w-full md:flex-col md:gap-4 lg:max-w-[660px] 2xl:max-w-[780px] 2xl:gap-5">
          {/* Dans l'image sur téléphone ; à partir de `md`, ses enfants rejoignent la colonne. */}
          <div className="order-1 flex min-h-[460px] flex-col justify-end gap-2.5 pb-0.5 pt-20 md:contents">
            <Link
              to="/collections"
              className={cn(
                // Le pseudo-élément porte la zone tactile à 44 px de haut.
                'relative inline-flex min-h-8 items-center gap-1 self-start rounded-md text-[13px] font-medium text-white/[0.78] transition-colors duration-200 after:absolute after:inset-x-0 after:-inset-y-1.5 hover:text-white motion-reduce:transition-none md:gap-1.5 md:text-[14px]',
                FOCUS_RING,
              )}
            >
              <ChevronLeft className="h-[15px] w-[15px] text-white opacity-80 md:h-4 md:w-4" aria-hidden="true" />
              {t('collections.allCollections')}
            </Link>
            <span className="inline-flex h-[26px] items-center self-start rounded-full border border-white/[0.18] bg-white/[0.14] px-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-white md:h-7 md:px-3 md:text-[12px]">
              {t('collections.label')}
            </span>
            <h1 className="text-[46px] font-extrabold leading-none tracking-[-0.035em] text-white md:text-[length:clamp(48px,5.4vw,88px)]">
              {stripSagaSuffix(name)}
            </h1>
            <p className="text-[13px] font-medium leading-normal text-white/[0.82] md:text-[15px]">
              {t('collections.filmCount', { count: filmCount })}
              {years && (
                <>
                  <Separator />
                  {years}
                </>
              )}
              {runtime && (
                <>
                  <Separator />
                  {runtime}
                  <span className="hidden md:inline"> {t('collections.totalSuffix')}</span>
                </>
              )}
              {rating && (
                <>
                  <Separator />
                  <Star
                    className="mr-1 inline h-[0.9em] w-[0.9em] -translate-y-px fill-current text-white opacity-80"
                    aria-hidden="true"
                  />
                  {rating}
                  <span className="hidden md:inline"> {t('collections.averageSuffix')}</span>
                </>
              )}
            </p>
          </div>

          {overview && (
            <p className="order-6 mt-3 text-[15px] leading-[1.6] text-white/[0.88] [text-wrap:pretty] md:order-none md:mt-0 md:max-w-[56ch] md:text-[17px] md:leading-[1.55] md:text-white/85 2xl:text-[19px]">
              {overview}
            </p>
          )}

          {cta && (
            <>
              <Link
                to={cta.href}
                className={cn(
                  'order-2 mt-1.5 inline-flex h-14 items-center justify-center gap-[9px] rounded-[14px] bg-red-600 px-3 text-[16px] font-semibold text-white transition-[background-color,transform] duration-200 hover:bg-red-700 active:scale-[0.98] motion-reduce:transition-none md:order-none md:h-[54px] md:justify-start md:gap-2.5 md:self-start md:px-[22px]',
                  FOCUS_RING,
                )}
              >
                <Play className="h-5 w-5 flex-none fill-current text-white" aria-hidden="true" />
                <span>{cta.label}</span>
                {cta.caption && (
                  <small className="ml-0.5 hidden max-w-[28ch] truncate border-l border-white/35 pl-3 text-[13px] font-medium opacity-90 md:block">
                    {cta.caption}
                  </small>
                )}
              </Link>
              {cta.caption && (
                <p className="order-3 text-center text-[13px] leading-normal text-white/70 md:hidden">
                  {cta.caption}
                </p>
              )}
            </>
          )}

          <div className="order-4 mt-0.5 grid grid-cols-3 md:order-none md:-ml-3 md:mt-0 md:flex md:flex-wrap md:gap-0.5">
            <HeroAction
              Icon={Bookmark}
              label={t('collections.actionWatchlist')}
              pressed={inWatchlist}
              onClick={onToggleWatchlist}
            />
            <HeroAction
              Icon={Heart}
              label={t('collections.favorites')}
              pressed={isFavorite}
              onClick={onToggleFavorite}
            />
            <HeroAction Icon={ListPlus} label={t('collections.addToList')} onClick={onAddToList} />
          </div>
        </div>

        {progress && (
          <SagaProgressBar
            watchedCount={progress.watchedCount}
            total={progress.total}
            watched={progress.watched}
            className="order-5 mt-1.5 md:order-none md:mb-1.5 md:mt-0 md:min-w-full lg:min-w-[260px]"
          />
        )}
      </div>
    </section>
  );
};
