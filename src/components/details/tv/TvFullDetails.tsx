import type { ReactNode } from 'react';
import { BarChart3, Building, Calendar, CircleDollarSign, Languages, MapPin, Tv, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useImageQuality, useImageViewport } from '@/hooks/useImageQuality';
import { getTmdbImageUrl } from '@/utils/tmdbImages';
import { cn } from '@/lib/utils';
import { DetailsModeToggle } from '../DetailsModeToggle';
import { DetailsCollapse, DetailsSwap } from '../motion';
import { formatDetailsCount, formatDetailsCountry, formatDetailsLanguage, formatDetailsRating } from '../format';

interface TvOrganisation {
  id: number;
  name: string;
  logo_path: string | null;
}

/** Champs de la fiche TMDB d'une série lus par le bloc « Détails » déplié. */
export interface TvFullDetailsSource {
  name: string;
  vote_average: number;
  popularity?: number;
  type?: string;
  status?: string;
  in_production?: boolean;
  number_of_seasons?: number;
  number_of_episodes?: number;
  networks?: TvOrganisation[];
  production_companies?: TvOrganisation[];
  origin_country?: string[];
  spoken_languages?: { iso_639_1: string; name: string }[];
}

/** Ligne « dernier épisode » ou « prochain épisode » : libellé et valeur prêts à afficher. */
export interface TvFullDetailsEpisode {
  label: string;
  /** Valeur, déjà masquée par la page si l'anti-spoil le demande. */
  value: ReactNode;
}

export interface TvFullDetailsProps {
  show: TvFullDetailsSource;
  /** Date de première diffusion déjà mise en forme, ou le texte « date non disponible ». */
  firstAirDate: string;
  /** Durée moyenne d'un épisode déjà mise en forme, si elle est connue. */
  averageRuntime?: string | null;
  /** Statut traduit, avec sa précision de production. */
  statusLabel?: string | null;
  lastEpisode?: TvFullDetailsEpisode | null;
  nextEpisode?: TvFullDetailsEpisode | null;
  /** Saisons du tableau « Par saison » ; `episodeCount` vaut `null` si la saison n'est pas chargée. */
  seasons: Array<{ number: number; name: string; episodeCount: number | null }>;
  financialStatsMode: 'simple' | 'advanced';
  onFinancialStatsModeChange: (mode: 'simple' | 'advanced') => void;
  className?: string;
}

const CARD = 'rounded-xl border border-white/10 bg-white/5 p-4';
const CHIP = 'inline-flex min-h-9 items-center rounded-full border border-white/[.18] px-3.5 text-sm font-medium text-white';

/** Diffuseurs dont les séries ont les plus gros budgets. */
const PREMIUM_NETWORKS = ['HBO', 'Netflix', 'Amazon', 'Apple TV+', 'Disney+'];
/** Les mêmes sans Apple TV+, pour l'estimation des droits de diffusion. */
const RIGHTS_NETWORKS = ['HBO', 'Netflix', 'Amazon', 'Disney+'];
/** Grandes chaînes américaines financées par la publicité. */
const AD_NETWORKS = ['NBC', 'CBS', 'ABC', 'FOX'];

/** Répartition type du budget d'un épisode. */
const BUDGET_SHARES = [
  { key: 'details.productionAndFilming', range: '50-60%', width: '55%' },
  { key: 'details.actors', range: '20-30%', width: '25%' },
  { key: 'details.specialEffects', range: '5-15%', width: '10%' },
  { key: 'details.postProduction', range: '10-15%', width: '12%' },
] as const;

function Block({ icon: Icon, title, aside, children }: { icon: LucideIcon; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-base font-semibold text-white">
          <Icon aria-hidden="true" className="size-[18px] flex-none text-white opacity-70" />
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </div>
  );
}

function Stat({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn(CARD, className)}>
      <h4 className="mb-1 text-[13px] text-white/55">{label}</h4>
      <p className="font-semibold text-white tabular-nums">{children}</p>
    </div>
  );
}

/**
 * Contenu complet de la section Détails d'une série : sociétés, pays, langues,
 * première diffusion, statistiques, estimations financières (mode simple ou
 * avancé, avec les tableaux par saison et par épisode) et diffuseurs.
 */
export function TvFullDetails({
  show, firstAirDate, averageRuntime, statusLabel, lastEpisode, nextEpisode, seasons,
  financialStatsMode, onFinancialStatsModeChange, className,
}: TvFullDetailsProps) {
  const { t, i18n } = useTranslation();
  const { effectiveImageQuality } = useImageQuality();
  const { dpr } = useImageViewport();
  const imageDpr = Math.min(dpr, effectiveImageQuality === 'high' ? 3 : 2);
  const language = i18n.language;
  const count = (value: number) => formatDetailsCount(value, language);
  const onNetwork = (names: string[]) => Boolean(show.networks?.some((network) => names.includes(network.name)));

  const premium = onNetwork(PREMIUM_NETWORKS);
  // Budget estimé par épisode, en millions de dollars, selon le type de série.
  const millionsPerEpisode = show.type === 'Scripted' ? (premium ? 10 : 3) : show.type === 'Reality' ? 0.3 : null;
  const seasonCount = show.number_of_seasons ?? 0;
  const likelyProfitable = Boolean(seasonCount && show.vote_average) && (
    (show.vote_average >= 7.5 && seasonCount >= 1)
    || (show.vote_average >= 6.5 && seasonCount >= 2)
    || seasonCount >= 3
  );
  const profitability = likelyProfitable ? t('details.probablyProfitable') : t('details.uncertainProfitability');

  const logo = (path: string | null) => (path ? (
    <img
      src={getTmdbImageUrl(path, { kind: 'logo', quality: effectiveImageQuality, width: Math.ceil(40 * imageDpr), role: 'card' })}
      alt=""
      loading="lazy"
      decoding="async"
      className="max-h-10 max-w-10"
    />
  ) : (
    <Building aria-hidden="true" className="size-6 text-white opacity-50" />
  ));

  const organisations = (list: TvOrganisation[]) => (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {list.map((item) => (
        <li key={item.id} className={cn(CARD, 'flex items-center gap-3 p-3')}>
          <span className="flex size-12 flex-none items-center justify-center rounded-lg bg-white/10">{logo(item.logo_path)}</span>
          <span className="min-w-0 text-sm font-medium text-white">{item.name}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <div className={cn('space-y-8', className)}>
      <Block icon={Building} title={t('details.productionCompanies')}>
        {show.production_companies && show.production_companies.length > 0
          ? organisations(show.production_companies)
          : <p className="text-sm italic text-white/55">{t('details.noProductionCompany')}</p>}
      </Block>

      {/* Pays, langues et date : petits blocs, côte à côte tant que la largeur le permet. */}
      <div className="flex flex-wrap gap-x-12 gap-y-6">
        {show.origin_country && show.origin_country.length > 0 && (
          <Block icon={MapPin} title={t('details.originCountry')}>
            <ul className="flex flex-wrap gap-2">
              {show.origin_country.map((code) => <li key={code} className={CHIP}>{formatDetailsCountry(code, language)}</li>)}
            </ul>
          </Block>
        )}

        {show.spoken_languages && show.spoken_languages.length > 0 && (
          <Block icon={Languages} title={t('details.languagesLabel')}>
            <ul className="flex flex-wrap gap-2">
              {show.spoken_languages.map((item) => <li key={item.iso_639_1} className={CHIP}>{formatDetailsLanguage(item.iso_639_1, language, item.name)}</li>)}
            </ul>
          </Block>
        )}

        <Block icon={Calendar} title={t('details.firstAirDateLabel')}>
          <span className={CHIP}>{firstAirDate}</span>
        </Block>
      </div>

      <Block icon={BarChart3} title={t('details.statisticsTitle')}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Stat label={t('details.numberOfSeasons')}>{show.number_of_seasons || t('details.notAvailableData')}</Stat>
          <Stat label={t('details.numberOfEpisodes')}>{show.number_of_episodes || t('details.notAvailableData')}</Stat>
          {Boolean(show.popularity) && <Stat label={t('details.popularityLabel')}>{count(Math.round(show.popularity ?? 0))}</Stat>}
          {averageRuntime && <Stat label={t('details.averageDuration')}>{averageRuntime}</Stat>}
          {statusLabel && <Stat label={t('details.statusLabel')} className="md:col-span-2">{statusLabel}</Stat>}
          {lastEpisode && <Stat label={lastEpisode.label} className="md:col-span-2">{lastEpisode.value}</Stat>}
          {nextEpisode && <Stat label={nextEpisode.label} className="md:col-span-2">{nextEpisode.value}</Stat>}
        </div>
      </Block>

      <Block
        icon={CircleDollarSign}
        title={t('details.financialStatsTitle')}
        aside={(
          <DetailsModeToggle value={financialStatsMode} onChange={onFinancialStatsModeChange} ariaLabel={t('details.financialStatsTitle')} />
        )}
      >
        <h4 className="mb-2 text-sm font-semibold text-white">{t('details.globalLabel')}</h4>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Stat label={t('details.estimatedCostPerEpisode')}>
            {show.type === 'Scripted' ? t(premium ? 'details.costRange5to15M' : 'details.costRange1to5M')
              : show.type === 'Reality' ? t('details.costRange100Kto500K')
                : t('details.notAvailableData')}
          </Stat>
          <Stat label={t('details.estimatedTotalBudget')}>
            {millionsPerEpisode !== null && show.number_of_episodes
              ? `~ ${count(millionsPerEpisode * show.number_of_episodes)} millions USD`
              : t('details.notAvailableData')}
          </Stat>

          <div className={cn(CARD, 'md:col-span-2')}>
            <h4 className="mb-2 text-[13px] text-white/55">{t('details.revenueAndProfits')}</h4>
            <DetailsSwap swapKey={financialStatsMode}>
            {financialStatsMode === 'simple' ? (
              <div className="flex items-center justify-between gap-3 rounded-lg bg-black/40 p-3 text-sm">
                <span className="text-white/80">{t('details.profitabilityStatus')}</span>
                <span className="text-right font-semibold text-white">{profitability}</span>
              </div>
            ) : (
              <>
                {/* Sources de revenus */}
                <div className="mb-4">
                  <p className="mb-2 text-sm text-white/80">
                    <span className="font-semibold text-white">{t('details.revenueSources')}</span> {t('details.byImportanceOrder')}
                  </p>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-white/80">
                    <li>{t('details.broadcastingRightsInitial')} <span className="text-white/55">{t(onNetwork(RIGHTS_NETWORKS) ? 'details.tv.finance.budgetHigh' : 'details.tv.finance.budgetLow')}</span></li>
                    <li>{t('details.advertisingRevenue')} <span className="text-white/55">{t(onNetwork(AD_NETWORKS) ? 'details.tv.finance.adRevenueHigh' : 'details.tv.finance.adRevenueVariable')}</span></li>
                    <li>{t('details.internationalSales')} <span className="text-white/55">{t('details.tv.finance.marketing')}</span></li>
                    <li>{t('details.tv.finance.streamingLabel')} <span className="text-white/55">{t('details.tv.finance.streaming')}</span></li>
                    <li>{t('details.merchandisingLabel')} <span className="text-white/55">{t(show.popularity && show.popularity > 100 ? 'details.potentiallyVeryHigh' : 'details.limited')}</span></li>
                  </ul>
                </div>

                {/* Estimation de rentabilité */}
                <div className="mb-4">
                  <p className="mb-2 text-sm text-white/80">
                    <span className="font-semibold text-white">{t('details.profitabilityEstimate')}</span> {t('details.tv.finance.forShow', { name: show.name })}
                  </p>
                  <dl className="space-y-1.5 rounded-lg bg-black/40 p-3 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-white/55">{t('details.breakEvenEstimate')}</dt>
                      <dd className="font-semibold text-white">
                        {t(show.vote_average >= 7.5 ? 'details.breakEven1to2' : show.vote_average >= 6.5 ? 'details.breakEven2to3' : 'details.breakEven3plus')}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-white/55">{t('details.potentialROI')}</dt>
                      <dd className="font-semibold text-white tabular-nums">
                        {show.vote_average >= 8 ? '200-400%'
                          : show.vote_average >= 7 ? '100-200%'
                            : show.vote_average >= 6 ? '30-100%'
                              : t('details.uncertainRoi')}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-white/55">{t('details.currentProfitabilityStatus')}</dt>
                      <dd className="font-semibold text-white">{profitability}</dd>
                    </div>
                  </dl>
                </div>

                {/* Facteurs de succès */}
                <div>
                  <p className="mb-2 text-sm font-semibold text-white">{t('details.factorsImpacting')}</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="rounded-lg bg-black/40 p-3">
                      <h5 className="mb-1 text-xs font-semibold text-white">{t('details.positiveFactors')}</h5>
                      <ul className="list-disc space-y-0.5 pl-4 text-xs text-white/80">
                        <li>{t('details.highRating', { rating: formatDetailsRating(show.vote_average, language) })}</li>
                        <li>{t('details.popularityFactor', { value: count(Math.round(show.popularity ?? 0)) })}</li>
                        {premium && <li>{t('details.premiumBroadcaster')}</li>}
                        {show.in_production && <li>{t('details.stillInProduction')}</li>}
                      </ul>
                    </div>
                    <div className="rounded-lg bg-black/40 p-3">
                      <h5 className="mb-1 text-xs font-semibold text-white">{t('details.negativeFactors')}</h5>
                      <ul className="list-disc space-y-0.5 pl-4 text-xs text-white/80">
                        {!show.in_production && <li>{t('details.productionEndedFactor')}</li>}
                        {show.status === 'Canceled' && <li>{t('details.seriesCancelledFactor')}</li>}
                        {show.vote_average < 6.5 && <li>{t('details.lowAverageRating')}</li>}
                        {Boolean(show.popularity) && (show.popularity ?? 0) < 50 && <li>{t('details.limitedPopularity')}</li>}
                      </ul>
                    </div>
                  </div>
                  <p className="mt-3 text-xs italic text-white/55">{t('details.financialNote')}</p>
                </div>
              </>
            )}
            </DetailsSwap>
          </div>
        </div>

        <DetailsCollapse open={financialStatsMode === 'advanced'}>
            {/* Par saison */}
            <h4 className="mb-2 mt-6 text-sm font-semibold text-white">{t('details.perSeasonLabel')}</h4>
            <div className={CARD}>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-white/[.12] text-xs text-white/55">
                    <th scope="col" className="pb-2 font-normal">{t('details.seasonsLabel')}</th>
                    <th scope="col" className="pb-2 font-normal">{t('details.episodesLabel')}</th>
                    <th scope="col" className="pb-2 font-normal">{t('details.estimatedBudgetLabel')}</th>
                  </tr>
                </thead>
                <tbody className="text-white tabular-nums">
                  {seasons.map((season) => (
                    <tr key={season.number}>
                      <td className="pt-2">{season.name}</td>
                      <td className="pt-2">{season.episodeCount ?? 'N/A'}</td>
                      <td className="pt-2">
                        {millionsPerEpisode !== null ? `~${count(millionsPerEpisode * (season.episodeCount ?? 10))}M USD` : 'N/A'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs italic text-white/55">{t('details.seasonBudgetNote')}</p>
            </div>

            {/* Par épisode */}
            <h4 className="mb-2 mt-6 text-sm font-semibold text-white">{t('details.perEpisodeLabel')}</h4>
            <div className={CARD}>
              <h5 className="mb-3 text-[13px] text-white/55">{t('details.budgetBreakdownPerEpisode')}</h5>
              <ul className="space-y-3">
                {BUDGET_SHARES.map((share) => (
                  <li key={share.key}>
                    <div className="flex items-center justify-between gap-3 text-xs font-semibold text-white">
                      <span>{t(share.key)}</span>
                      <span className="tabular-nums">{share.range}</span>
                    </div>
                    <div aria-hidden="true" className="mt-1 h-2 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full bg-red-600" style={{ width: share.width }} />
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs italic text-white/55">{t('details.vfxNote')}</p>
            </div>
        </DetailsCollapse>
      </Block>

      {show.networks && show.networks.length > 0 && (
        <Block icon={Tv} title={t('details.broadcastNetworks')}>
          {organisations(show.networks)}
        </Block>
      )}
    </div>
  );
}

export default TvFullDetails;
