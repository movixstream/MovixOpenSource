import type { ReactNode } from 'react';
import { Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DETAILS_FOCUS, DETAILS_IMAGE_EDGE, DETAILS_PHONE_SCROLL } from './layout';

export interface DetailsVideoTileProps {
  /** Titre sous la vignette. */
  title: string;
  /** Ligne grise sous le titre (« Bande-annonce · FR »). */
  subtitle?: string | null;
  /** Vignette 16:9. */
  imageUrl?: string | null;
  /**
   * Remplace le bouton de lecture par un voile avec un gros titre : tuile
   * « 320 images » qui ouvre la galerie.
   */
  overlay?: { headline: string; text?: string | null };
  onClick: () => void;
  className?: string;
}

/** Tuile vidéo : vignette 16:9 avec bouton de lecture, titre et type en dessous. */
export function DetailsVideoTile({ title, subtitle, imageUrl, overlay, onClick, className }: DetailsVideoTileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('group block min-w-0 rounded-xl text-left', DETAILS_FOCUS, className)}
    >
      <span className={cn('relative block aspect-video overflow-hidden rounded-xl bg-gray-900', DETAILS_IMAGE_EDGE)}>
        {imageUrl && (
          <img
            src={imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="block h-full w-full object-cover transition-opacity duration-200 group-hover:opacity-80 group-active:opacity-70 motion-reduce:transition-none"
          />
        )}
        {overlay ? (
          <span className="absolute inset-0 flex flex-col justify-end bg-black/65 p-3.5 text-xs text-white/[.82] md:p-4 md:text-[13px]">
            <strong className="text-[19px] font-bold leading-[1.2] text-white md:text-[22px]">{overlay.headline}</strong>
            {overlay.text}
          </span>
        ) : (
          <span className="absolute bottom-2.5 left-2.5 flex size-11 items-center justify-center rounded-full border border-white/30 bg-black/70 md:bottom-3 md:left-3">
            <Play aria-hidden="true" className="size-5 fill-current text-white" />
          </span>
        )}
      </span>
      <b className="mt-2 block truncate text-[13px] font-semibold text-white md:mt-2.5 md:text-sm">{title}</b>
      {subtitle && <span className="block truncate text-xs text-white/55 md:text-[13px]">{subtitle}</span>}
    </button>
  );
}

export interface DetailsMediaRowProps {
  /** `row` : rangée qui défile sous 768 px. `grid` : grille à toutes les largeurs. */
  layout?: 'row' | 'grid';
  className?: string;
  children: ReactNode;
}

/**
 * Conteneur des tuiles vidéo : colonnes d'au moins 250 px dès 768 px. En
 * `row`, donner aux tuiles `w-[252px] flex-none md:w-auto`.
 */
export function DetailsMediaRow({ layout = 'row', className, children }: DetailsMediaRowProps) {
  const columns = 'md:grid-cols-[repeat(auto-fill,minmax(250px,1fr))] md:gap-x-5 md:gap-y-[22px]';
  return (
    <div
      data-reveal-grid
      className={cn(
        layout === 'row' ? cn(DETAILS_PHONE_SCROLL, 'md:grid') : 'grid grid-cols-1 gap-x-3 gap-y-5 sm:grid-cols-2',
        columns,
        className,
      )}
    >
      {children}
    </div>
  );
}

export default DetailsVideoTile;
