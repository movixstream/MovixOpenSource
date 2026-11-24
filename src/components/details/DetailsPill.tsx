import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface DetailsPillProps extends HTMLAttributes<HTMLSpanElement> {
  /** `rating` : pastille jaune de la note TMDB, comme dans le HeroSlider. */
  tone?: 'neutral' | 'rating';
  /** Majuscules espacées (type de contenu : Film, Série). */
  uppercase?: boolean;
  /** Icône lucide placée avant le texte ; sa taille est fixée par la pastille. */
  icon?: ReactNode;
  /** Point d'état avant le texte : vert (`on`) ou jaune (`pending`). */
  dot?: 'on' | 'pending';
  children: ReactNode;
}

/** Pastille de l'image du haut : type, année, classification, notes, état. */
export function DetailsPill({ tone = 'neutral', uppercase, icon, dot, className, children, ...rest }: DetailsPillProps) {
  return (
    <span
      className={cn(
        'inline-flex h-[26px] max-w-full items-center gap-[5px] rounded-full border px-2.5 text-[11px] font-semibold md:h-7 md:gap-1.5 md:px-3 md:text-xs',
        '[&>svg]:size-3 [&>svg]:flex-none md:[&>svg]:size-[13px]',
        tone === 'rating'
          ? 'border-yellow-500/30 bg-yellow-500/25 text-yellow-300'
          : 'border-white/[.18] bg-white/[.14] text-white',
        uppercase && 'uppercase tracking-[0.08em]',
        className,
      )}
      {...rest}
    >
      {dot && (
        <span
          aria-hidden="true"
          className={cn('size-1.5 flex-none rounded-full md:size-[7px]', dot === 'on' ? 'bg-green-400' : 'bg-yellow-400')}
        />
      )}
      {icon}
      {children}
    </span>
  );
}

export default DetailsPill;
