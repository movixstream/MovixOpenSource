import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { DetailsFalsy } from './layout';

export interface DetailsMetaItem {
  key: string;
  content: ReactNode;
  /** Masqué sous 768 px (ex. le réalisateur). */
  desktopOnly?: boolean;
  /** Montré seulement sous 768 px (ex. le statut d'une série, en pastille au-delà). */
  phoneOnly?: boolean;
}

export interface DetailsMetaLineProps {
  /** Éléments séparés par un point médian ; les valeurs vides sont ignorées. */
  items: Array<DetailsMetaItem | DetailsFalsy>;
  className?: string;
}

/** Ligne d'infos sous le titre : durée · genres · réalisateur. */
export function DetailsMetaLine({ items, className }: DetailsMetaLineProps) {
  const shown = items.filter((item): item is DetailsMetaItem => Boolean(item && item.content));
  if (shown.length === 0) return null;
  return (
    <p className={cn('text-[13px] font-medium text-white/[.82] md:text-[15px]', className)}>
      {shown.map((item, index) => (
        <span key={item.key} className={item.desktopOnly ? 'hidden md:inline' : item.phoneOnly ? 'md:hidden' : undefined}>
          {index > 0 && <span aria-hidden="true" className="mx-1.5 opacity-50 md:mx-2">·</span>}
          {item.content}
        </span>
      ))}
    </p>
  );
}

export default DetailsMetaLine;
