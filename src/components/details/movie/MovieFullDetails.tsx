import type { ReactNode } from 'react';
import { Building, Calendar, CircleDollarSign, Languages, MapPin, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useImageQuality, useImageViewport } from '@/hooks/useImageQuality';
import { getTmdbImageUrl } from '@/utils/tmdbImages';
import { cn } from '@/lib/utils';
import { DetailsModeToggle } from '../DetailsModeToggle';
import { DetailsCollapse } from '../motion';
import { formatDetailsCountry, formatDetailsLanguage, formatDetailsMoney } from '../format';

/** Champs de la fiche TMDB d'un film lus par le bloc « Détails » déplié. */
export interface MovieFullDetailsSource {
  title: string;
  vote_average: number;
  release_date: string;
  genres?: { id: number; name: string }[];
  production_companies?: { id: number; name: string; logo_path: string | null }[];
  production_countries?: { iso_3166_1: string; name: string }[];
  spoken_languages?: { iso_639_1: string; name: string }[];
  belongs_to_collection?: unknown;
  budget?: number;
  revenue?: number;
  status?: string;
}

export interface MovieFullDetailsProps {
  movie: MovieFullDetailsSource;
  /** Libellé de la date (« Date de sortie » ou « Première sortie annoncée »). */
  releaseDateLabel: string;
  /** Date déjà mise en forme, ou le texte « date non disponible ». */
  releaseDate: string;
  /** Statut traduit (« Sorti », « En production »…), s'il est connu. */
  statusLabel?: string | null;
  financialStatsMode: 'simple' | 'advanced';
  onFinancialStatsModeChange: (mode: 'simple' | 'advanced') => void;
  className?: string;
}

const CARD = 'rounded-xl border border-white/10 bg-white/5 p-4';
const CHIP = 'inline-flex min-h-9 items-center rounded-full border border-white/[.18] px-3.5 text-sm font-medium text-white';

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
 * Contenu complet de la section Détails d'un film : sociétés, pays, langues,
 * date de sortie et statistiques financières (mode simple ou avancé).
 */
export function MovieFullDetails({
  movie, releaseDateLabel, releaseDate, statusLabel, financialStatsMode, onFinancialStatsModeChange, className,
}: MovieFullDetailsProps) {
  const { t, i18n } = useTranslation();
  const { effectiveImageQuality } = useImageQuality();
  const { dpr } = useImageViewport();
  const imageDpr = Math.min(dpr, effectiveImageQuality === 'high' ? 3 : 2);
  const money = (value: number) => formatDetailsMoney(value, i18n.language);
  const budget = movie.budget && movie.budget > 0 ? movie.budget : 0;
  const revenue = movie.revenue && movie.revenue > 0 ? movie.revenue : 0;
  const hasBoth = budget > 0 && revenue > 0;
  const roi = hasBoth ? Math.round((revenue / budget - 1) * 100) : null;
  const releaseTime = movie.release_date ? new Date(movie.release_date).getTime() : NaN;

  return (
    <div className={cn('space-y-8', className)}>
      {movie.production_companies && movie.production_companies.length > 0 && (
        <Block icon={Building} title={t('details.productionCompanies')}>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {movie.production_companies.map((company) => (
              <li key={company.id} className={cn(CARD, 'flex items-center gap-3 p-3')}>
                <span className="flex size-12 flex-none items-center justify-center rounded-lg bg-white/10">
                  {company.logo_path ? (
                    <img
                      src={getTmdbImageUrl(company.logo_path, {
                        kind: 'logo',
                        quality: effectiveImageQuality,
                        width: Math.ceil(40 * imageDpr),
                        role: 'card',
                      })}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="max-h-10 max-w-10"
                    />
                  ) : (
                    <Building aria-hidden="true" className="size-6 text-white opacity-50" />
                  )}
                </span>
                <span className="min-w-0 text-sm font-medium text-white">{company.name}</span>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {/* Pays, langues et date : petits blocs, côte à côte tant que la largeur le permet. */}
      <div className="flex flex-wrap gap-x-12 gap-y-6">
        {movie.production_countries && movie.production_countries.length > 0 && (
          <Block icon={MapPin} title={t('details.productionCountries')}>
            <ul className="flex flex-wrap gap-2">
              {movie.production_countries.map((country) => (
                <li key={country.iso_3166_1} className={CHIP}>{formatDetailsCountry(country.iso_3166_1, i18n.language, country.name)}</li>
              ))}
            </ul>
          </Block>
        )}

        {movie.spoken_languages && movie.spoken_languages.length > 0 && (
          <Block icon={Languages} title={t('details.languagesLabel')}>
            <ul className="flex flex-wrap gap-2">
              {movie.spoken_languages.map((language) => (
                <li key={language.iso_639_1} className={CHIP}>{formatDetailsLanguage(language.iso_639_1, i18n.language, language.name)}</li>
              ))}
            </ul>
          </Block>
        )}

        <Block icon={Calendar} title={releaseDateLabel}>
          <span className={CHIP}>{releaseDate}</span>
        </Block>
      </div>

      <Block
        icon={CircleDollarSign}
        title={t('details.financialStatsTitle')}
        aside={(
          <DetailsModeToggle value={financialStatsMode} onChange={onFinancialStatsModeChange} ariaLabel={t('details.financialStatsTitle')} />
        )}
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Stat label={t('details.budgetLabel')}>{budget > 0 ? money(budget) : t('details.notDisclosed')}</Stat>
          <Stat label={t('details.revenueLabel')}>{revenue > 0 ? money(revenue) : t('details.notDisclosed')}</Stat>

          {hasBoth && (
            <Stat label={t('details.profitLossLabel')} className="md:col-span-2">
              {money(revenue - budget)}
              <span className="ml-2 text-xs font-normal text-white/55">
                ({roi}% {revenue > budget ? t('details.profitPercent') : t('details.lossPercent')})
              </span>
            </Stat>
          )}

          {statusLabel && <Stat label={t('details.statusLabel')} className="md:col-span-2">{statusLabel}</Stat>}

          <DetailsCollapse open={financialStatsMode === 'advanced'} className="md:col-span-2">
            <div className={CARD}>
              <h4 className="mb-3 text-sm font-semibold text-white">{t('details.financialDetailsAdvanced')}</h4>

              {/* Sources de revenus */}
              <div className="mb-4">
                <p className="mb-2 text-sm text-white/80">
                  <span className="font-semibold text-white">{t('details.revenueSources')}</span> ({t('details.byImportanceOrder')}):
                </p>
                <ul className="list-disc space-y-1 pl-5 text-sm text-white/80">
                  <li>{t('details.boxOffice')}: <span className="text-white/55">~40-60% {t('details.ofTotalRevenue')}</span></li>
                  <li>{t('details.vodStreaming')}: <span className="text-white/55">~15-30% {t('details.ofTotalRevenue')}</span></li>
                  <li>{t('details.tvRights')}: <span className="text-white/55">~10-20% {t('details.ofTotalRevenue')}</span></li>
                  <li>{t('details.dvdBluRay')}: <span className="text-white/55">~5-15% {t('details.ofTotalRevenue')}</span></li>
                  <li>{t('details.merchandisingLabel')}: <span className="text-white/55">{movie.belongs_to_collection ? t('details.potentiallyVeryHigh') : t('details.variableByMovie')}</span></li>
                </ul>
              </div>

              {/* Analyse de rentabilité */}
              <div className="mb-4">
                <p className="mb-2 text-sm text-white/80">
                  <span className="font-semibold text-white">{t('details.profitabilityEstimate')}</span> {t('details.forMovie', { title: movie.title })}:
                </p>
                <dl className="space-y-1.5 rounded-lg bg-black/40 p-3 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-white/55">{t('details.breakEvenEstimate')}:</dt>
                    <dd className="font-semibold text-white tabular-nums">{budget > 0 ? `~${money(budget * 2.5)}` : t('details.notAvailableData')}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-white/55">{t('details.roiLabel')}:</dt>
                    <dd className="font-semibold text-white tabular-nums">{roi !== null ? `${roi}%` : t('details.notAvailableData')}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-white/55">{t('details.commercialClassification')}:</dt>
                    <dd className="font-semibold text-white">
                      {hasBoth ? (
                        revenue >= budget * 3 ? t('details.blockbuster')
                          : revenue >= budget * 2.5 ? t('details.commercialSuccess')
                            : revenue >= budget * 1.5 ? t('details.profitableMovie')
                              : revenue >= budget ? t('details.breakEvenStatus')
                                : t('details.commercialFailure')
                      ) : t('details.notAvailableData')}
                    </dd>
                  </div>
                </dl>
              </div>

              {/* Facteurs de succès */}
              <div>
                <p className="mb-2 text-sm font-semibold text-white">{t('details.factorsImpacting')}:</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="rounded-lg bg-black/40 p-3">
                    <h5 className="mb-1 text-xs font-semibold text-white">{t('details.positiveFactors')}</h5>
                    <ul className="list-disc space-y-0.5 pl-4 text-xs text-white/80">
                      {movie.vote_average >= 7 && <li>{t('details.highRating', { rating: movie.vote_average })}</li>}
                      {Boolean(movie.belongs_to_collection) && <li>{t('details.belongsToFranchise')}</li>}
                      {movie.genres?.some((genre) => ['Action', 'Adventure', 'Animation', 'Fantasy', 'Science Fiction'].includes(genre.name))
                        && <li>{t('details.popularGenre')}</li>}
                      {movie.production_companies?.some((company) => (
                        ['Walt Disney Pictures', 'Marvel Studios', 'Universal Pictures', 'Warner Bros.'].includes(company.name)
                      )) && <li>{t('details.majorStudio')}</li>}
                    </ul>
                  </div>
                  <div className="rounded-lg bg-black/40 p-3">
                    <h5 className="mb-1 text-xs font-semibold text-white">{t('details.limitingFactors')}</h5>
                    <ul className="list-disc space-y-0.5 pl-4 text-xs text-white/80">
                      {movie.vote_average < 6 && <li>{t('details.lowRating', { rating: movie.vote_average })}</li>}
                      {budget > 150000000 && <li>{t('details.veryHighBudget')}</li>}
                      {movie.production_countries?.every((country) => country.iso_3166_1 !== 'US')
                        && <li>{t('details.nonHollywood')}</li>}
                      {movie.genres?.some((genre) => ['Documentary', 'Foreign', 'History', 'War'].includes(genre.name))
                        && <li>{t('details.nicheGenre')}</li>}
                      {releaseTime > new Date(2020, 0, 1).getTime() && releaseTime < new Date(2022, 0, 1).getTime()
                        && <li>{t('details.pandemicRelease')}</li>}
                    </ul>
                  </div>
                </div>
              </div>

              <p className="mt-3 text-xs italic text-white/55">{t('details.financialNote')}</p>
            </div>
          </DetailsCollapse>
        </div>
      </Block>
    </div>
  );
}

export default MovieFullDetails;
