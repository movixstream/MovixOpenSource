import { Check, Film, Tv } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useImageQuality } from '@/hooks/useImageQuality';
import type { SagaFilmProgress } from '@/hooks/useSagaProgress';
import { getTmdbImageProps } from '@/utils/tmdbImages';
import { DETAILS_IMAGE_EDGE } from '../layout';
import type { PersonCredit } from './personCredits';

export interface PersonPosterProps {
  credit: PersonCredit;
  /** Largeur affichée, pour choisir la taille de l'image (`sizes`). */
  sizes: string;
  /** État de visionnage d'un film (historique et stockage local) ; absent pour une série. */
  progress?: SagaFilmProgress;
  /** `card` : pastille « Vu » écrite ; `row` : coche seule, l'affiche est petite. */
  variant: 'card' | 'row';
  className?: string;
}

/** Affiche 2:3 d'un titre de la filmographie, avec son état « vu » ou « en cours ». */
export function PersonPoster({ credit, sizes, progress, variant, className }: PersonPosterProps) {
  const { t } = useTranslation();
  const { effectiveImageQuality } = useImageQuality();
  const image = credit.posterPath
    ? getTmdbImageProps(credit.posterPath, { kind: 'poster', quality: effectiveImageQuality, sizes })
    : null;
  const watched = progress?.status === 'watched' || progress?.status === 'estimated';
  const ratio = progress?.status === 'in_progress' && progress.ratio !== null ? Math.min(1, Math.max(0, progress.ratio)) : null;
  const Placeholder = credit.media_type === 'tv' ? Tv : Film;

  return (
    <span className={cn('relative block aspect-[2/3] overflow-hidden bg-white/[.06]', DETAILS_IMAGE_EDGE, className)}>
      {image ? (
        <img
          {...image}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className={cn('h-full w-full object-cover', watched && 'opacity-55')}
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center">
          <Placeholder className={cn('text-white opacity-30', variant === 'card' ? 'size-8' : 'size-4')} aria-hidden="true" />
        </span>
      )}
      {watched && (variant === 'card' ? (
        <span className="absolute left-1.5 top-1.5 inline-flex h-[22px] items-center gap-1 rounded-full bg-black/[.78] px-2 text-[11px] font-bold leading-none text-white">
          <Check className="size-3 text-white" strokeWidth={3} aria-hidden="true" />
          {t('collections.statusWatched')}
        </span>
      ) : (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex size-6 items-center justify-center rounded-full bg-black/[.78]">
            <Check className="size-3.5 text-white" strokeWidth={3} aria-hidden="true" />
          </span>
          <span className="sr-only">{t('collections.statusWatched')}</span>
        </span>
      ))}
      {ratio !== null && (
        <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1 bg-white/25">
          <span className="block h-full bg-red-600" style={{ width: `${Math.max(4, ratio * 100)}%` }} />
        </span>
      )}
    </span>
  );
}

export default PersonPoster;
