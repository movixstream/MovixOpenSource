import React from 'react';
import { AlertTriangle } from 'lucide-react';

import { cn } from '@/lib/utils';
import { getAdLetter } from './monetizationForm';
import { getAdColorStyle } from './monetizationUiHelpers';

// Composants partagés de l'onglet « Publicités » (les fonctions et hooks sont
// dans monetizationUiHelpers.ts).

export const AdBadge: React.FC<{ index: number; className?: string; size?: 'sm' | 'md' }> = ({
  index,
  className,
  size = 'md'
}) => (
  <span
    aria-hidden="true"
    style={getAdColorStyle(index)}
    className={cn(
      'inline-flex shrink-0 items-center justify-center rounded-lg font-bold tabular-nums',
      size === 'sm' ? 'h-5 min-w-5 px-1 text-[11px]' : 'h-8 min-w-8 px-1.5 text-sm',
      className
    )}
  >
    {index >= 0 ? getAdLetter(index) : '?'}
  </span>
);

const fieldLegendClass = 'mb-1.5 block text-xs font-semibold uppercase tracking-wider text-white/50';

interface FieldGroupProps {
  id: string;
  legend: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | null;
  warning?: string | null;
  children: React.ReactNode;
  className?: string;
}

// Groupe de choix (pastilles, cartes) : `fieldset` + `legend` au lieu d'un label.
// Le message porte l'id `${id}-message`.
export const FieldGroup: React.FC<FieldGroupProps> = ({ id, legend, hint, error, warning, children, className }) => {
  const message = error || warning || hint;

  return (
    <fieldset className={cn('min-w-0', className)} aria-describedby={message ? `${id}-message` : undefined}>
      <legend className={fieldLegendClass}>{legend}</legend>
      {children}
      {message && (
        <p
          id={`${id}-message`}
          className={cn(
            'mt-1.5 flex items-start gap-1.5 text-xs leading-5',
            error ? 'text-red-300' : warning ? 'text-amber-200/90' : 'text-white/40'
          )}
        >
          {(error || warning) && (
            <AlertTriangle
              className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', !error && 'text-amber-200 opacity-90')}
              aria-hidden="true"
            />
          )}
          <span className="min-w-0">{message}</span>
        </p>
      )}
    </fieldset>
  );
};

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  description?: string;
  // Pris en compte par SegmentedChoice : option visible mais non cliquable.
  disabled?: boolean;
}

const chipClass = (selected: boolean) => cn(
  'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50 disabled:pointer-events-none disabled:opacity-40',
  selected
    ? 'border-amber-300/50 bg-amber-300/15 font-medium text-amber-100'
    : 'border-white/10 text-white/60 hover:border-white/25 hover:text-white'
);

interface ChipMultiSelectProps<T extends string> {
  options: ChoiceOption<T>[];
  values: T[];
  onChange: (next: T[]) => void;
  invalid?: boolean;
}

// Plusieurs choix possibles : l'ordre des options est gardé dans la valeur.
export function ChipMultiSelect<T extends string>({ options, values, onChange, invalid }: ChipMultiSelectProps<T>) {
  return (
    <div className={cn('flex flex-wrap gap-1.5', invalid && 'rounded-xl ring-1 ring-red-400/40 ring-offset-4 ring-offset-transparent')}>
      {options.map((option) => {
        const selected = values.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            title={option.description}
            onClick={() => onChange(
              selected
                ? values.filter((value) => value !== option.value)
                : options.map((entry) => entry.value).filter((value) => value === option.value || values.includes(value))
            )}
            className={chipClass(selected)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

interface SegmentedChoiceProps<T extends string> {
  options: ChoiceOption<T>[];
  value: T;
  onChange: (next: T) => void;
  ariaLabel?: string;
}

// Un seul choix, en pastilles (petites listes : fenêtres, appareil, mode pays…).
export function SegmentedChoice<T extends string>({ options, value, onChange, ariaLabel }: SegmentedChoiceProps<T>) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            title={option.description}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={chipClass(selected)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

interface OptionCardsProps<T extends string> {
  name: string;
  options: ChoiceOption<T>[];
  value: T;
  onChange: (next: T) => void;
  className?: string;
}

// Un seul choix, avec une phrase d'explication sous chaque option.
export function OptionCards<T extends string>({ name, options, value, onChange, className }: OptionCardsProps<T>) {
  return (
    <div className={cn('grid gap-2', className)}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <label
            key={option.value}
            className={cn(
              'flex min-w-0 cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors',
              'focus-within:ring-2 focus-within:ring-amber-400/50',
              selected ? 'border-amber-300/45 bg-amber-300/[0.07]' : 'border-white/10 bg-black/20 hover:border-white/20'
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={selected}
              onChange={() => onChange(option.value)}
              className="mt-1 h-4 w-4 shrink-0 accent-amber-400"
            />
            <span className="min-w-0">
              <span className={cn('block text-sm font-semibold', selected ? 'text-amber-100' : 'text-white')}>
                {option.label}
              </span>
              {option.description && (
                <span className="mt-0.5 block text-xs leading-5 text-white/50">{option.description}</span>
              )}
            </span>
          </label>
        );
      })}
    </div>
  );
}
