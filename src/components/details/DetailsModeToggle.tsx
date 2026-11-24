import { useId } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export type DetailsStatsMode = 'simple' | 'advanced';

/**
 * Bascule « Simple | Avancé » des statistiques financières. La pastille rouge
 * glisse d'un choix à l'autre, comme les onglets de la galerie d'images.
 */
export function DetailsModeToggle({ value, onChange, ariaLabel }: {
  value: DetailsStatsMode;
  onChange: (mode: DetailsStatsMode) => void;
  ariaLabel: string;
}) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const pillId = useId();
  return (
    <div role="group" aria-label={ariaLabel} className="flex rounded-[10px] border border-white/[.18] p-0.5">
      {(['simple', 'advanced'] as const).map((mode) => {
        const active = value === mode;
        return (
          <button
            key={mode}
            type="button"
            aria-pressed={active}
            onClick={() => { if (!active) onChange(mode); }}
            className={cn(
              'relative min-h-10 rounded-lg px-3 text-sm font-medium transition-[color,transform] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100',
              active ? 'text-white' : 'text-white/60 hover:text-white',
            )}
          >
            {active && (
              <motion.span
                layoutId={pillId}
                aria-hidden="true"
                className="absolute inset-0 rounded-lg bg-red-600"
                transition={reduceMotion ? { duration: 0 } : { type: 'spring', bounce: 0.15, duration: 0.4 }}
              />
            )}
            <span className="relative">{t(mode === 'simple' ? 'details.simpleMode' : 'details.advancedMode')}</span>
          </button>
        );
      })}
    </div>
  );
}

export default DetailsModeToggle;
