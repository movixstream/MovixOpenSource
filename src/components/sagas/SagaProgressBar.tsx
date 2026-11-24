import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/** Au-delà, un segment par film devient illisible : une barre continue. */
const MAX_SEGMENTS = 12;

interface SagaProgressBarProps {
  watchedCount: number;
  total: number;
  /** Un booléen par film, dans l'ordre de la collection : vu ou non. */
  watched: readonly boolean[];
  className?: string;
}

/** « 2 films vus sur 8 » et sa barre. Rien n'est rendu pour une liste vide. */
export const SagaProgressBar: React.FC<SagaProgressBarProps> = ({ watchedCount, total, watched, className }) => {
  const { t } = useTranslation();
  if (total <= 0) return null;

  const countLabel = t('collections.watchedCount', { count: watchedCount });
  const totalLabel = t('collections.ofTotal', { total });
  const ratio = Math.min(1, Math.max(0, watchedCount / total));

  return (
    <div className={className}>
      <p className="mb-2.5 text-[14px] font-semibold leading-normal text-white">
        {countLabel} <span className="font-medium text-white/70">{totalLabel}</span>
      </p>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={watchedCount}
        aria-valuetext={`${countLabel} ${totalLabel}`}
      >
        {total <= MAX_SEGMENTS ? (
          <div
            className="grid gap-[5px]"
            // Nombre de colonnes égal au nombre de films : pas de classe possible.
            style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}
          >
            {watched.map((isWatched, index) => (
              <span
                key={index}
                className={cn(
                  'h-1.5 rounded-[3px] transition-colors duration-200 motion-reduce:transition-none',
                  isWatched ? 'bg-white' : 'bg-white/25',
                )}
              />
            ))}
          </div>
        ) : (
          <div className="h-1.5 overflow-hidden rounded-[3px] bg-white/25">
            <div
              className="h-full rounded-[3px] bg-white transition-transform duration-200 motion-reduce:transition-none"
              style={{ transform: `translateX(-${(1 - ratio) * 100}%)` }}
            />
          </div>
        )}
      </div>
    </div>
  );
};
