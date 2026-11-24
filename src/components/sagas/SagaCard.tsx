import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Film } from 'lucide-react';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { cn } from '@/lib/utils';
import { useAgeRestrictedContent } from '@/hooks/useAgeRestrictedContent';
import { useImageQuality } from '@/hooks/useImageQuality';
import { getTmdbImageProps } from '@/utils/tmdbImages';
import { SagaActions, type SagaActionHandlers } from './SagaActions';
import { getSagaYears, stripSagaSuffix } from './sagaFormat';
import type { SagaSummary } from './types';

/**
 * - `grid` : carte de la liste des collections. Image puis texte dessous sur
 *   téléphone, texte posé sur l'image à partir de `md`.
 * - `featured` : la grande carte, deux colonnes sur deux rangées, avec résumé.
 * - `overlay` : texte toujours posé sur l'image (collections similaires).
 * - `list` : ligne du mode liste, avec affiche et résumé.
 */
export type SagaCardVariant = 'grid' | 'featured' | 'overlay' | 'list';

interface SagaCardProps extends SagaActionHandlers {
  saga: SagaSummary;
  variant: SagaCardVariant;
  inWatchlist: boolean;
  isFavorite: boolean;
  /** Tactile ou écran étroit : les trois actions passent dans un menu « ⋯ ». */
  compactActions: boolean;
  /** Collection tout juste arrivée par le défilement : elle entre en fondu. */
  isNew?: boolean;
  className?: string;
}

const CARD_MOTION =
  'transition-[transform,border-color] duration-200 has-[a:active]:scale-[0.98] motion-reduce:transition-none motion-reduce:has-[a:active]:scale-100';
const CARD_FRAME = 'overflow-hidden border border-white/10 bg-white/5';
const CARD_FRAME_HOVER = 'hover:border-white/45 has-[a:focus-visible]:border-white/45';
const LINK_FOCUS =
  'outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-white';

interface SagaImageProps {
  saga: SagaSummary;
  kind: 'poster' | 'backdrop';
  sizes: string;
}

/** Image de la collection ; sans image, un fond neutre et une icône. */
const SagaImage: React.FC<SagaImageProps> = ({ saga, kind, sizes }) => {
  const { effectiveImageQuality } = useImageQuality();
  const preferred = kind === 'backdrop' ? saga.backdrop_path : saga.poster_path;
  const fallback = kind === 'backdrop' ? saga.poster_path : saga.backdrop_path;
  const path = preferred || fallback;

  if (!path) {
    return (
      <span className="absolute inset-0 flex items-center justify-center bg-gray-900">
        <Film className="h-8 w-8 text-white opacity-30" aria-hidden="true" />
      </span>
    );
  }

  const image = getTmdbImageProps(path, {
    kind: preferred ? kind : kind === 'backdrop' ? 'poster' : 'backdrop',
    quality: effectiveImageQuality,
    sizes,
  });

  return (
    <img
      {...image}
      // Le nom complet de TMDB reste dans le texte de remplacement.
      alt={saga.name}
      loading="lazy"
      decoding="async"
      className="absolute inset-0 h-full w-full object-cover"
    />
  );
};

export const SagaCard: React.FC<SagaCardProps> = React.memo(({
  saga,
  variant,
  inWatchlist,
  isFavorite,
  onToggleWatchlist,
  onToggleFavorite,
  onAddToList,
  compactActions,
  isNew = false,
  className,
}) => {
  const { t } = useTranslation();
  // Tableau stable : le filtre d'âge relance sa vérification quand la liste
  // reçue change d'identité.
  const parts = useMemo(
    () => (saga.parts || []).map((movie) => ({ ...movie, media_type: 'movie' as const })),
    [saga.parts],
  );
  const { items: ageAllowedParts } = useAgeRestrictedContent(parts);

  // Une collection dont tous les films dépassent l'âge du profil est masquée.
  if (parts.length > 0 && ageAllowedParts.length === 0) return null;

  const href = `/collection/${saga.id}`;
  const displayName = stripSagaSuffix(saga.name);
  const filmCount = ageAllowedParts.filter((movie) => movie.poster_path).length;
  const years = getSagaYears(ageAllowedParts);
  const meta = [t('collections.filmCount', { count: filmCount }), years].filter(Boolean).join(' · ');
  const overview = saga.overview || t('collections.discoverCollection');
  const entrance = isNew ? 'animate-card-enter motion-reduce:animate-none' : '';

  const actions = (actionsClassName: string, alwaysVisible: boolean) => (
    <SagaActions
      saga={saga}
      inWatchlist={inWatchlist}
      isFavorite={isFavorite}
      onToggleWatchlist={onToggleWatchlist}
      onToggleFavorite={onToggleFavorite}
      onAddToList={onAddToList}
      compact={compactActions}
      alwaysVisible={alwaysVisible}
      className={actionsClassName}
    />
  );

  if (variant === 'list') {
    return (
      <article
        className={cn(
          'group/saga relative flex min-w-0 items-center gap-2 rounded-[14px] p-3 md:gap-4 md:p-4',
          CARD_FRAME,
          CARD_FRAME_HOVER,
          CARD_MOTION,
          entrance,
          className,
        )}
      >
        <Link
          to={href}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-3 rounded-[9px] focus-visible:outline-offset-4 md:gap-5',
            LINK_FOCUS,
          )}
        >
          <span className="relative block aspect-[2/3] w-[70px] flex-none overflow-hidden rounded-[9px] border border-white/10 bg-gray-900 md:w-20">
            <SagaImage saga={saga} kind="poster" sizes="80px" />
          </span>
          <span className="block min-w-0 flex-1">
            <b className="block truncate text-[15px] font-bold leading-[1.3] tracking-[-0.01em] text-white md:text-[17px]">
              {displayName}
            </b>
            <span className="mt-0.5 block text-[12px] leading-normal text-white/55 md:text-[13px]">{meta}</span>
            <span className="mt-2 line-clamp-2 text-[13px] leading-normal text-white/70 md:text-[14px]">
              {overview}
            </span>
          </span>
        </Link>
        {actions('flex-none', true)}
      </article>
    );
  }

  if (variant === 'grid') {
    return (
      <article
        className={cn(
          'group/saga relative min-w-0 md:aspect-video md:overflow-hidden md:rounded-[14px] md:border md:border-white/10 md:bg-white/5 md:hover:border-white/45 md:has-[a:focus-visible]:border-white/45',
          CARD_MOTION,
          entrance,
          className,
        )}
      >
        <Link
          to={href}
          className={cn(
            'block rounded-xl focus-visible:outline-offset-2 md:absolute md:inset-0 md:rounded-[14px] md:focus-visible:-outline-offset-2',
            LINK_FOCUS,
          )}
        >
          <span className="relative block aspect-[16/10] overflow-hidden rounded-xl border border-white/10 bg-white/5 md:absolute md:inset-0 md:aspect-auto md:rounded-none md:border-0 md:bg-transparent">
            <SagaImage
              saga={saga}
              kind="backdrop"
              sizes="(min-width: 1536px) 20vw, (min-width: 1280px) 25vw, (min-width: 1100px) 33vw, 50vw"
            />
            <span
              aria-hidden="true"
              className="absolute inset-0 hidden bg-gradient-to-b from-transparent from-[34%] to-black/[0.87] md:block"
            />
          </span>
          <span className="mt-[9px] block md:absolute md:inset-x-0 md:bottom-0 md:mt-0 md:flex md:flex-col md:gap-0.5 md:p-4">
            <b className="block text-[14px] font-semibold leading-[1.3] text-white md:text-[17px] md:font-bold md:leading-tight md:tracking-[-0.01em] 2xl:text-[19px]">
              {displayName}
            </b>
            <span className="block text-[12px] leading-normal text-white/55 md:text-[13px] md:text-white/[0.78]">
              {meta}
            </span>
          </span>
        </Link>
        {actions(
          compactActions
            ? 'absolute right-0.5 top-0.5 z-[2] md:right-2 md:top-2'
            : 'absolute right-2.5 top-2.5 z-[2]',
          false,
        )}
      </article>
    );
  }

  const featured = variant === 'featured';

  return (
    <article
      className={cn(
        'group/saga relative min-w-0',
        CARD_FRAME,
        CARD_FRAME_HOVER,
        CARD_MOTION,
        featured
          ? 'col-span-2 h-[250px] rounded-2xl md:row-span-2 md:h-auto md:min-h-[330px] md:rounded-[14px]'
          : 'aspect-video rounded-xl md:rounded-[14px]',
        entrance,
        className,
      )}
    >
      <Link
        to={href}
        className={cn('absolute inset-0 block rounded-[inherit] focus-visible:-outline-offset-2', LINK_FOCUS)}
      >
        <SagaImage
          saga={saga}
          kind="backdrop"
          sizes={featured ? '(min-width: 768px) 50vw, 100vw' : '(min-width: 1024px) 25vw, (min-width: 768px) 50vw, 252px'}
        />
        <span
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-b from-transparent from-30% to-black/[0.88] md:from-[34%] md:to-black/[0.87]"
        />
        {featured ? (
          <span className="absolute inset-x-0 bottom-0 flex flex-col gap-1 p-[18px] md:max-w-[600px] md:gap-1.5 md:p-7">
            <b className="block text-[26px] font-bold leading-[1.1] tracking-[-0.02em] text-white md:text-[30px] md:leading-[1.08] md:tracking-[-0.025em] lg:text-[36px] 2xl:text-[44px]">
              {displayName}
            </b>
            <span className="block text-[13px] leading-normal text-white/[0.78] md:text-[15px]">{meta}</span>
            <span className="mt-1.5 hidden text-[15px] leading-normal text-white/85 md:line-clamp-2">
              {overview}
            </span>
          </span>
        ) : (
          <span className="absolute inset-x-0 bottom-0 flex flex-col gap-px p-3 md:gap-0.5 md:p-4">
            <b className="block text-[15px] font-bold leading-tight text-white md:text-[17px] md:tracking-[-0.01em] 2xl:text-[19px]">
              {displayName}
            </b>
            <span className="block text-[12px] leading-normal text-white/[0.78] md:text-[13px]">{meta}</span>
          </span>
        )}
      </Link>
      {actions(
        compactActions ? 'absolute right-2 top-2 z-[2]' : 'absolute right-2.5 top-2.5 z-[2]',
        featured,
      )}
    </article>
  );
});

SagaCard.displayName = 'SagaCard';
