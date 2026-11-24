import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { DetailsFalsy } from './layout';

export interface DetailsKeyFigure {
  key: string;
  label: string;
  /** Chiffre ou texte court mis en avant. */
  value: ReactNode;
  /** Précision sous la valeur (« +276 % du budget »). */
  hint?: ReactNode;
  /** Valeur en texte long (nom de société) : corps plus petit sous 768 px. */
  longText?: boolean;
  /** Classes de la case (ex. `hidden md:block`). */
  className?: string;
}

export interface DetailsKeyFiguresProps {
  items: Array<DetailsKeyFigure | DetailsFalsy>;
  className?: string;
}

/** Ligne de chiffres : budget, recettes, bénéfice, statut… Deux colonnes sous 768 px. */
export function DetailsKeyFigures({ items, className }: DetailsKeyFiguresProps) {
  const shown = items.filter((item): item is DetailsKeyFigure => Boolean(item));
  if (shown.length === 0) return null;
  return (
    <dl className={cn('grid grid-cols-2 gap-x-5 md:grid-cols-[repeat(auto-fit,minmax(170px,1fr))] md:gap-x-8', className)}>
      {shown.map((item) => (
        <div key={item.key} className={cn('min-w-0 border-t border-white/[.12] pb-4 pt-3 md:pb-5 md:pt-4', item.className)}>
          <dt className="mb-1 text-xs text-white/55 md:mb-1.5 md:text-[13px]">{item.label}</dt>
          <dd
            className={cn(
              'break-words font-bold leading-tight tracking-[-0.01em] text-white tabular-nums md:text-[22px]',
              item.longText ? 'text-base' : 'text-[19px]',
            )}
          >
            {item.value}
            {item.hint && (
              <small className="mt-0.5 block text-xs font-medium tracking-normal text-white/70 md:text-[13px]">{item.hint}</small>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default DetailsKeyFigures;
