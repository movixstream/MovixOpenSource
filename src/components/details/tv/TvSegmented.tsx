import { useId } from 'react';
import type { LucideIcon } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';

/** Glissement de la pastille active : rapide, sans rebond. */
const PILL_SPRING = { type: 'spring', stiffness: 520, damping: 40, mass: 0.7 } as const;

export interface TvSegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Icône lucide montrée à la place du libellé, qui devient le nom accessible. */
  icon?: LucideIcon;
}

export interface TvSegmentedProps<T extends string> {
  options: ReadonlyArray<TvSegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** Nom accessible du groupe. */
  ariaLabel: string;
  /** Bascule en attente (chargement) : les boutons ne répondent pas. */
  disabled?: boolean;
  /** `accent` : bascule teintée, pour un choix qu'on doit repérer d'un coup d'œil (mode anime). */
  tone?: 'neutral' | 'accent';
  className?: string;
}

/** Bascule à deux ou trois choix de la barre d'outils des épisodes (TMDB | TVmaze, grille | liste…). */
export function TvSegmented<T extends string>({ options, value, onChange, ariaLabel, disabled = false, tone = 'neutral', className }: TvSegmentedProps<T>) {
  const accent = tone === 'accent';
  // Un layoutId par bascule : deux bascules de la page ne s'échangent pas leur pastille.
  const pillId = useId();
  const reduceMotion = useReducedMotion();
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex flex-none rounded-[10px] border p-[3px] transition-opacity duration-200 motion-reduce:transition-none',
        accent ? 'border-violet-400/40 bg-violet-500/[.14]' : 'border-white/10 bg-white/[.08]',
        disabled && 'opacity-60',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            aria-label={Icon ? option.label : undefined}
            title={Icon ? option.label : undefined}
            disabled={disabled}
            onClick={() => { if (!active) onChange(option.value); }}
            className={cn(
              'group relative inline-flex h-[38px] min-w-[42px] items-center justify-center whitespace-nowrap rounded-[7px] px-3 text-[13px] font-semibold md:h-[34px] md:min-w-[38px]',
              // Zone tactile de 44 px sans grossir le bouton.
              "before:absolute before:inset-x-0 before:-inset-y-[3px] before:content-[''] md:before:-inset-y-[5px]",
              'transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white motion-reduce:transition-none disabled:cursor-wait',
              active ? 'text-white' : cn(accent ? 'text-violet-100/80' : 'text-white/70', 'hover:text-white active:bg-white/10'),
            )}
          >
            {active && (
              <motion.span
                aria-hidden="true"
                layoutId={pillId}
                transition={reduceMotion ? { duration: 0 } : PILL_SPRING}
                className={cn(
                  'absolute inset-0 rounded-[7px]',
                  accent ? 'bg-violet-500 shadow-[0_0_14px_rgba(139,92,246,.45)]' : 'bg-white/[.18]',
                )}
              />
            )}
            {Icon ? (
              <Icon
                aria-hidden="true"
                className={cn(
                  'relative size-4 text-white transition-opacity duration-200 motion-reduce:transition-none',
                  active ? 'opacity-100' : 'opacity-70 group-hover:opacity-100',
                )}
              />
            ) : <span className="relative">{option.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

export default TvSegmented;
