import React from 'react';
import { useTranslation } from 'react-i18next';
import { Bookmark, Heart, ListPlus, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { stripSagaSuffix } from './sagaFormat';
import type { SagaSummary } from './types';

export interface SagaActionHandlers {
  onToggleWatchlist: (saga: SagaSummary) => void;
  onToggleFavorite: (saga: SagaSummary) => void;
  onAddToList: (saga: SagaSummary) => void;
}

interface SagaActionsProps extends SagaActionHandlers {
  saga: SagaSummary;
  inWatchlist: boolean;
  isFavorite: boolean;
  /** Tactile ou écran étroit : un seul bouton « ⋯ » qui ouvre un menu. */
  compact: boolean;
  /** Boutons ronds visibles sans survol (grande carte, mode liste). */
  alwaysVisible?: boolean;
  className?: string;
}

const ROUND_BUTTON =
  'inline-flex h-10 w-10 flex-none items-center justify-center rounded-full border transition-[background-color,border-color,transform] duration-200 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none';
const ROUND_BUTTON_OFF = 'border-white/20 bg-black/65 hover:border-white/45 hover:bg-black/85';
const ROUND_BUTTON_ON = 'border-white bg-white hover:bg-white/90';

/**
 * Les trois actions d'une collection : à voir (watchlist), favoris, ajouter à
 * une liste. Trois boutons ronds à la souris, un menu « ⋯ » au doigt. Toujours
 * posé à côté du lien de la carte, jamais dedans.
 */
export const SagaActions: React.FC<SagaActionsProps> = ({
  saga,
  inWatchlist,
  isFavorite,
  onToggleWatchlist,
  onToggleFavorite,
  onAddToList,
  compact,
  alwaysVisible = false,
  className,
}) => {
  const { t } = useTranslation();

  if (compact) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t('collections.moreActions', { name: stripSagaSuffix(saga.name) })}
            className={cn(
              'group/more inline-flex h-11 w-11 flex-none items-center justify-center rounded-full outline-none',
              className,
            )}
          >
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/65 transition-[background-color,transform] duration-200 group-active/more:scale-95 group-focus-visible/more:outline group-focus-visible/more:outline-2 group-focus-visible/more:outline-offset-2 group-focus-visible/more:outline-white group-data-[state=open]/more:bg-black/85 motion-reduce:transition-none">
              <MoreHorizontal className="h-5 w-5 text-white" aria-hidden="true" />
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[13rem]">
          {/* Le menu reste ouvert après une coche : on voit l'état changer. */}
          <DropdownMenuCheckboxItem
            checked={inWatchlist}
            onCheckedChange={() => onToggleWatchlist(saga)}
            onSelect={(event) => event.preventDefault()}
            className="min-h-11"
          >
            {t('collections.actionWatchlist')}
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={isFavorite}
            onCheckedChange={() => onToggleFavorite(saga)}
            onSelect={(event) => event.preventDefault()}
            className="min-h-11"
          >
            {t('collections.favorites')}
          </DropdownMenuCheckboxItem>
          <DropdownMenuItem inset className="min-h-11" onSelect={() => onAddToList(saga)}>
            {t('collections.addToList')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <div
      className={cn(
        'flex gap-1.5',
        !alwaysVisible &&
          'opacity-0 transition-opacity duration-200 group-hover/saga:opacity-100 group-has-[:focus-visible]/saga:opacity-100 motion-reduce:transition-none',
        className,
      )}
    >
      <button
        type="button"
        aria-label={t('collections.actionWatchlist')}
        title={t('collections.actionWatchlist')}
        aria-pressed={inWatchlist}
        onClick={() => onToggleWatchlist(saga)}
        className={cn(ROUND_BUTTON, inWatchlist ? ROUND_BUTTON_ON : ROUND_BUTTON_OFF)}
      >
        <Bookmark
          className={cn('h-[17px] w-[17px]', inWatchlist ? 'fill-current text-black' : 'text-white')}
          aria-hidden="true"
        />
      </button>
      <button
        type="button"
        aria-label={t('collections.favorites')}
        title={t('collections.favorites')}
        aria-pressed={isFavorite}
        onClick={() => onToggleFavorite(saga)}
        className={cn(ROUND_BUTTON, isFavorite ? ROUND_BUTTON_ON : ROUND_BUTTON_OFF)}
      >
        <Heart
          className={cn('h-[17px] w-[17px]', isFavorite ? 'fill-current text-black' : 'text-white')}
          aria-hidden="true"
        />
      </button>
      <button
        type="button"
        aria-label={t('collections.addToList')}
        title={t('collections.addToList')}
        onClick={() => onAddToList(saga)}
        className={cn(ROUND_BUTTON, ROUND_BUTTON_OFF)}
      >
        <ListPlus className="h-[17px] w-[17px] text-white" aria-hidden="true" />
      </button>
    </div>
  );
};
