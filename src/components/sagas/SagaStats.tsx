import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { formatCompactMoney, formatRating, formatRuntime, formatSignedPercent } from './sagaFormat';

export interface SagaStatsData {
  totalBudget: number;
  totalRevenue: number;
  averageRating: number;
  totalRuntime: number;
  totalMovies: number;
  /** Films qui ont une note : la moyenne ne compte qu'eux. */
  ratedMovies: number;
  averageBudget: number;
  averageRevenue: number;
  profitMargin: number;
}

interface SagaStatsProps {
  /** null pendant le chargement du détail des films. */
  stats: SagaStatsData | null;
}

const GRID = 'grid grid-cols-2 gap-x-5 md:grid-cols-[repeat(auto-fit,minmax(190px,1fr))] md:gap-x-8';
const CELL = 'border-t border-white/[0.12] pb-4 pt-3 md:pb-5 md:pt-4';

interface StatProps {
  label: string;
  /** null : la donnée manque, on écrit « Non disponible ». */
  value: string | null;
  detail?: string | null;
  /** Détail masqué sur téléphone, comme sur la maquette. */
  detailFromMd?: boolean;
  /** Toute la largeur sur téléphone. */
  wide?: boolean;
}

const Stat: React.FC<StatProps> = ({ label, value, detail, detailFromMd = false, wide = false }) => {
  const { t } = useTranslation();
  return (
    <div className={cn(CELL, wide && 'col-span-2 md:col-span-1')}>
      <dt className="mb-1 text-[12px] leading-normal text-white/55 md:mb-1.5 md:text-[13px]">{label}</dt>
      <dd
        className={cn(
          'font-bold tabular-nums',
          value === null
            ? 'text-[15px] leading-[1.4] text-white/55 md:text-[17px]'
            : 'text-[21px] leading-[1.25] tracking-[-0.01em] text-white md:text-[26px] md:leading-[1.2] md:tracking-[-0.015em]',
        )}
      >
        {value ?? t('collections.notAvailableData')}
        {value !== null && detail && (
          <small
            className={cn(
              'mt-0.5 text-[12px] font-medium leading-normal tracking-normal text-white/70 md:mt-1 md:text-[13px]',
              detailFromMd ? 'hidden md:block' : 'block',
            )}
          >
            {detail}
          </small>
        )}
      </dd>
    </div>
  );
};

/** « La collection en chiffres » : une ligne de chiffres, sans carte ni couleur. */
export const SagaStats: React.FC<SagaStatsProps> = ({ stats }) => {
  const { t, i18n } = useTranslation();
  const language = i18n.language;

  if (!stats) {
    return (
      <div className={GRID} aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className={CELL}>
            <div className="mb-2 h-3 w-20 animate-pulse-soft rounded bg-white/10 motion-reduce:animate-none" />
            <div className="h-7 w-28 animate-pulse-soft rounded bg-white/10 motion-reduce:animate-none" />
          </div>
        ))}
      </div>
    );
  }

  const average = (value: number) =>
    Number.isFinite(value) && value > 0
      ? t('collections.averageValue', { value: formatCompactMoney(value, language) })
      : null;
  const hasProfit = stats.totalBudget > 0 && stats.totalRevenue > 0;
  const profit = stats.totalRevenue - stats.totalBudget;

  return (
    <dl className={GRID}>
      <Stat
        label={t('collections.totalDuration')}
        value={formatRuntime(stats.totalRuntime, t)}
        detail={t('collections.filmCount', { count: stats.totalMovies })}
        detailFromMd
      />
      <Stat
        label={t('collections.averageRating')}
        value={
          stats.ratedMovies > 0 && Number.isFinite(stats.averageRating)
            ? t('collections.ratingOutOfTen', { rating: formatRating(stats.averageRating, language) })
            : null
        }
        detail={t('collections.moviesRated', { count: stats.ratedMovies })}
        detailFromMd
      />
      <Stat
        label={t('collections.totalBudget')}
        value={stats.totalBudget > 0 ? formatCompactMoney(stats.totalBudget, language) : null}
        detail={average(stats.averageBudget)}
      />
      <Stat
        label={t('collections.totalRevenue')}
        value={stats.totalRevenue > 0 ? formatCompactMoney(stats.totalRevenue, language) : null}
        detail={average(stats.averageRevenue)}
      />
      {/* Bénéfice ou perte : seulement quand budget et recettes sont connus. */}
      {hasProfit && (
        <Stat
          label={t(profit < 0 ? 'collections.loss' : 'collections.profit')}
          value={formatCompactMoney(profit, language, true)}
          detail={t('collections.ofBudget', { percent: formatSignedPercent(stats.profitMargin, language) })}
          wide
        />
      )}
    </dl>
  );
};
