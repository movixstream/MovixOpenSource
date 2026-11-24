import React from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutGrid, List } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SagaViewMode } from './types';

interface SagaViewToggleProps {
  value: SagaViewMode;
  onChange: (mode: SagaViewMode) => void;
  /** `lg` : bascule de la liste des collections, libellés à partir de `md`. */
  size?: 'lg' | 'sm';
  className?: string;
}

/** Bascule Grille / Liste. */
export const SagaViewToggle: React.FC<SagaViewToggleProps> = ({ value, onChange, size = 'sm', className }) => {
  const { t } = useTranslation();
  const large = size === 'lg';
  const options = [
    { mode: 'grid' as const, label: t('search.gridView'), Icon: LayoutGrid },
    { mode: 'list' as const, label: t('search.listView'), Icon: List },
  ];

  return (
    <div
      role="group"
      aria-label={t('collections.viewLabel')}
      className={cn(
        'inline-flex flex-none border border-white/10 bg-white/[0.08]',
        large ? 'rounded-[14px] p-1' : 'rounded-[10px] p-[3px]',
        className,
      )}
    >
      {options.map(({ mode, label, Icon }) => {
        const active = value === mode;
        return (
          <button
            key={mode}
            type="button"
            aria-pressed={active}
            aria-label={label}
            title={label}
            onClick={() => onChange(mode)}
            className={cn(
              // Le pseudo-élément agrandit la zone tactile jusqu'à 48 px de haut
              // sans changer la taille dessinée.
              'relative inline-flex items-center justify-center gap-2 font-semibold transition-[background-color,color,transform] duration-200 after:absolute after:inset-x-0 after:-inset-y-[5px] active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none',
              large
                ? 'h-[38px] w-11 rounded-[10px] text-[14px] md:h-10 md:w-auto md:px-3.5'
                : 'h-[38px] w-11 rounded-[7px] md:h-[34px] md:w-auto md:min-w-[38px] md:px-3',
              active ? 'bg-white/[0.18] text-white' : 'text-white/70 hover:text-white',
            )}
          >
            <Icon
              className={cn(
                'flex-none text-white',
                large ? 'h-[17px] w-[17px] md:h-4 md:w-4' : 'h-4 w-4',
                active ? 'opacity-100' : 'opacity-70',
              )}
              aria-hidden="true"
            />
            {large && <span className="hidden md:inline">{label}</span>}
          </button>
        );
      })}
    </div>
  );
};
