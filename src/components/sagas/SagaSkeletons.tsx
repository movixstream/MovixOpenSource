import React from 'react';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/utils';
import type { SagaViewMode } from './types';

/** Mêmes colonnes que la grille des collections, pour que rien ne saute. */
export const SAGA_GRID_CLASS =
  'grid grid-cols-2 gap-x-3 gap-y-5 md:grid-cols-[repeat(auto-fill,minmax(280px,1fr))] md:gap-5 2xl:grid-cols-[repeat(auto-fill,minmax(300px,1fr))] 2xl:gap-6';

export const SAGA_LIST_CLASS = 'flex flex-col gap-3';

/*
 * Même rendu que les skeletons de l'accueil : le reflet qui glisse de
 * `Skeleton` (#1a1a1a → #2a2a2a, coupé si l'animation de chargement est
 * désactivée) et le fondu d'entrée `animate-skeleton-fade`. Pas de
 * `animate-pulse` : son clignotement donnait l'impression que les cartes
 * grossissaient puis rapetissaient.
 *
 * Chaque carte fantôme reprend les cadres, les marges et la hauteur de ligne
 * de `SagaCard` : le contenu prend exactement la place du skeleton.
 */

/** Fond des cartes : même voile que les vraies images. */
const CARD_GRADIENT = 'pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent';
/** Boutons ronds fantômes, comme ceux de `MediaCardSkeleton`. */
const ROUND = 'h-10 w-10 flex-none rounded-full bg-[#2a2a2a]';

/** Une ligne de texte : la hauteur de ligne réelle, une barre centrée dedans. */
const TextLine: React.FC<{ slot: string; bar: string; width: string }> = ({ slot, bar, width }) => (
  <div className={cn('flex items-center', slot)}>
    <Skeleton variant="text" width={width} className={bar} containerClassName="w-full" />
  </div>
);

/** Les trois boutons d'action, ou le seul « ⋯ » au doigt (`SagaActions`). */
const ActionsSkeleton: React.FC<{ compact: boolean; className?: string }> = ({ compact, className }) =>
  compact ? (
    <div className={cn('flex h-11 w-11 flex-none items-center justify-center', className)}>
      <div className={ROUND} />
    </div>
  ) : (
    <div className={cn('flex gap-1.5', className)}>
      <div className={ROUND} />
      <div className={ROUND} />
      <div className={ROUND} />
    </div>
  );

/** Carte `grid` : image puis texte sur téléphone, texte posé dessus dès `md`. */
const GridCardSkeleton: React.FC<{ compactActions: boolean }> = ({ compactActions }) => (
  <div className="relative min-w-0 md:aspect-video md:overflow-hidden md:rounded-[14px] md:border md:border-white/10 md:bg-white/5">
    <div className="relative block aspect-[16/10] overflow-hidden rounded-xl border border-white/10 bg-white/5 md:absolute md:inset-0 md:aspect-auto md:rounded-none md:border-0 md:bg-transparent">
      <div className="absolute inset-0">
        <Skeleton width="100%" height="100%" className="!rounded-none" />
      </div>
      <div className={cn(CARD_GRADIENT, 'hidden from-[34%] to-black/[0.87] md:block')} />
      <div className="absolute inset-x-0 bottom-0 hidden flex-col gap-0.5 p-4 md:flex">
        <TextLine slot="h-[21.25px] 2xl:h-[23.75px]" bar="h-4 2xl:h-[18px]" width="70%" />
        <TextLine slot="h-[19.5px]" bar="h-3" width="45%" />
      </div>
    </div>
    <div className="mt-[9px] md:hidden">
      <TextLine slot="h-[18.2px]" bar="h-3.5" width="75%" />
      <TextLine slot="h-[18px]" bar="h-3" width="50%" />
    </div>
    {/* Hors du mode tactile, les boutons n'apparaissent qu'au survol. */}
    {compactActions && (
      <ActionsSkeleton compact className="absolute right-0.5 top-0.5 md:right-2 md:top-2" />
    )}
  </div>
);

/** Grande carte : deux colonnes sur deux rangées, titre, chiffres et résumé. */
const FeaturedCardSkeleton: React.FC<{ compactActions: boolean }> = ({ compactActions }) => (
  <div className="relative col-span-2 h-[250px] min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-white/5 md:row-span-2 md:h-auto md:min-h-[330px] md:rounded-[14px]">
    <div className="absolute inset-0">
      <Skeleton width="100%" height="100%" className="!rounded-none" />
    </div>
    <div className={cn(CARD_GRADIENT, 'from-30% to-black/[0.88] md:from-[34%] md:to-black/[0.87]')} />
    <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 p-[18px] md:max-w-[600px] md:gap-1.5 md:p-7">
      <TextLine
        slot="h-[28.6px] md:h-[32.4px] lg:h-[38.88px] 2xl:h-[47.52px]"
        bar="h-[22px] md:h-[26px] lg:h-[30px] 2xl:h-9"
        width="65%"
      />
      <TextLine slot="h-[19.5px] md:h-[22.5px]" bar="h-3 md:h-3.5" width="35%" />
      <div className="mt-1.5 hidden md:block">
        <TextLine slot="h-[22.5px]" bar="h-3.5" width="100%" />
        <TextLine slot="h-[22.5px]" bar="h-3.5" width="80%" />
      </div>
    </div>
    <ActionsSkeleton
      compact={compactActions}
      className={compactActions ? 'absolute right-2 top-2' : 'absolute right-2.5 top-2.5'}
    />
  </div>
);

/** Ligne du mode liste : affiche, titre, chiffres, résumé et actions. */
const ListRowSkeleton: React.FC<{ compactActions: boolean }> = ({ compactActions }) => (
  <div className="flex min-w-0 items-center gap-2 overflow-hidden rounded-[14px] border border-white/10 bg-white/5 p-3 md:gap-4 md:p-4">
    <div className="flex min-w-0 flex-1 items-center gap-3 md:gap-5">
      <div className="relative aspect-[2/3] w-[70px] flex-none overflow-hidden rounded-[9px] border border-white/10 md:w-20">
        <div className="absolute inset-0">
          <Skeleton width="100%" height="100%" className="!rounded-none" />
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <TextLine slot="h-[19.5px] md:h-[22.1px]" bar="h-4" width="45%" />
        <TextLine slot="mt-0.5 h-[18px] md:h-[19.5px]" bar="h-3" width="25%" />
        <div className="mt-2">
          <TextLine slot="h-[19.5px] md:h-[21px]" bar="h-3" width="90%" />
          <TextLine slot="h-[19.5px] md:h-[21px]" bar="h-3" width="65%" />
        </div>
      </div>
    </div>
    <ActionsSkeleton compact={compactActions} />
  </div>
);

interface SagaGridSkeletonProps {
  mode: SagaViewMode;
  /** Première carte en grand, comme dans la grille chargée. */
  featured?: boolean;
  count?: number;
  /** Même valeur que les cartes (`useCompactSagaActions`) : « ⋯ » ou trois boutons. */
  compactActions?: boolean;
}

/** Cartes fantômes affichées pendant le chargement des collections. */
export const SagaGridSkeleton: React.FC<SagaGridSkeletonProps> = ({
  mode,
  featured = false,
  count = 9,
  compactActions = false,
}) => {
  if (mode === 'list') {
    return (
      <div className={cn(SAGA_LIST_CLASS, 'animate-skeleton-fade')} aria-hidden="true">
        {Array.from({ length: Math.min(count, 6) }, (_, index) => (
          <ListRowSkeleton key={index} compactActions={compactActions} />
        ))}
      </div>
    );
  }

  return (
    <div className={cn(SAGA_GRID_CLASS, 'animate-skeleton-fade')} aria-hidden="true">
      {Array.from({ length: count }, (_, index) =>
        featured && index === 0 ? (
          <FeaturedCardSkeleton key={index} compactActions={compactActions} />
        ) : (
          <GridCardSkeleton key={index} compactActions={compactActions} />
        ),
      )}
    </div>
  );
};

interface SagaLoadingCellProps {
  mode: SagaViewMode;
  label: string;
}

/** Case en pointillés affichée pendant que la suite des collections arrive. */
export const SagaLoadingCell: React.FC<SagaLoadingCellProps> = ({ mode, label }) => (
  <div
    role="status"
    className={cn(
      'flex items-center justify-center border border-dashed border-white/[0.18] p-2 text-center text-[13px] text-white/60 md:text-[14px]',
      mode === 'list'
        ? 'min-h-[88px] rounded-[14px]'
        : 'aspect-[16/10] rounded-xl md:aspect-video md:rounded-[14px]',
    )}
  >
    {label}
  </div>
);

/** Fantôme de la page d'une collection, sans image : il garde la marge du haut. */
export const SagaDetailSkeleton: React.FC<{ label: string }> = ({ label }) => (
  <div
    className="mx-auto min-h-screen max-w-[1920px] animate-skeleton-fade px-3 pb-24 pt-20 sm:px-6 md:px-12 lg:px-20"
    role="status"
    aria-label={label}
  >
    <div className="flex flex-col gap-4 pt-10 md:pt-24">
      <Skeleton width={144} height={16} />
      <Skeleton variant="pill" width={96} height={28} />
      <Skeleton width="80%" className="!h-12 max-w-[560px] !rounded-lg md:!h-20" />
      <Skeleton width="60%" height={16} className="max-w-[360px]" />
      <Skeleton width="100%" height={56} className="max-w-[320px] !rounded-[14px]" />
    </div>
    <div className="mt-12 grid grid-cols-3 gap-3 md:mt-16 md:grid-cols-4 md:gap-4 lg:grid-cols-8">
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="overflow-hidden rounded-xl border border-white/10 bg-white/5">
          <Skeleton variant="poster" className="!rounded-none" />
        </div>
      ))}
    </div>
  </div>
);
