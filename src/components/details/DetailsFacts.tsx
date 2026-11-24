import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { DetailsFalsy } from './layout';

export interface DetailsFact {
  key: string;
  label: string;
  /** Valeur ; une ligne dont la valeur est vide n'est pas affichée. */
  value: ReactNode;
  /** Classes de la ligne (ex. `hidden md:flex` pour la réserver à l'ordinateur). */
  className?: string;
}

export interface DetailsFactsProps {
  items: Array<DetailsFact | DetailsFalsy>;
  className?: string;
}

/** Fiche de faits : liste libellé / valeur séparée par des filets (réalisation, durée, sortie…). */
export function DetailsFacts({ items, className }: DetailsFactsProps) {
  const shown = items.filter((item): item is DetailsFact => {
    if (!item) return false;
    const { value } = item;
    return value !== null && value !== undefined && value !== '' && value !== false;
  });
  if (shown.length === 0) return null;
  return (
    <dl className={cn('border-t border-white/[.12]', className)}>
      {shown.map((item) => (
        <div
          key={item.key}
          className={cn('flex justify-between gap-5 border-b border-white/[.12] py-3 text-sm md:gap-6 md:py-[13px] md:text-[15px]', item.className)}
        >
          <dt className="whitespace-nowrap text-white/55">{item.label}</dt>
          <dd className="min-w-0 text-right font-medium text-white">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default DetailsFacts;
