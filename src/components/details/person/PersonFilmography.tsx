import { useEffect, useMemo, useState } from 'react';
import { Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { cn } from '@/lib/utils';
import type { SagaFilmProgress } from '@/hooks/useSagaProgress';
import { DetailsButton } from '../DetailsButton';
import { formatDetailsRating } from '../format';
import { DETAILS_FOCUS } from '../layout';
import { TvSegmented, type TvSegmentedOption } from '../tv/TvSegmented';
import { scrollToDetailsSection } from '../useActiveSection';
import { PersonPoster } from './PersonPoster';
import { personCreditHref, personCreditRole, personDepartmentLabel } from './personLabels';
import {
  ACTING, compareByDateDesc, compareByPopularity, departmentsByCount, groupByYear, type PersonCredit,
} from './personCredits';

/** Lignes montrées avant « Tout afficher » : une longue carrière en compte des centaines. */
const PREVIEW_ROWS = 30;

/** Note affichée à partir de ce nombre de votes : en dessous, elle ne dit rien. */
const MIN_VOTES_FOR_RATING = 5;

type MediaFilter = 'all' | 'movie' | 'tv';
type SortOrder = 'date' | 'popular';

export interface PersonFilmographyProps {
  credits: readonly PersonCredit[];
  knownForDepartment: string | null;
  gender: number;
  /** État de visionnage des films, par identifiant TMDB. */
  progress: ReadonlyMap<number, SagaFilmProgress>;
  /** Total après filtres, pour le titre de la section. */
  onCountChange?: (count: number) => void;
  /** Ancre de la section : « Réduire » y remonte, la liste raccourcie laisserait sinon la page loin en bas. */
  sectionId?: string;
}

function FilmographyRow({ credit, gender, progress, showYear, revealIndex }: {
  credit: PersonCredit;
  gender: number;
  progress?: SagaFilmProgress;
  showYear: boolean;
  /** Rang parmi les lignes ajoutées par « Tout afficher » (-1 : ligne de l'aperçu). */
  revealIndex: number;
}) {
  const { t, i18n } = useTranslation();
  const role = personCreditRole(credit, gender, t);
  const typeLabel = t(credit.media_type === 'tv' ? 'search.serieLabel' : 'search.movieLabel');
  const rating = credit.voteAverage > 0 && credit.voteCount >= MIN_VOTES_FOR_RATING
    ? formatDetailsRating(credit.voteAverage, i18n.language)
    : null;
  return (
    <li
      className={cn(revealIndex >= 0 && 'details-rise-in')}
      style={revealIndex >= 0 ? { animationDelay: `${Math.min(revealIndex, 12) * 30}ms` } : undefined}
    >
      <Link
        to={personCreditHref(credit)}
        className={cn(
          'flex min-h-[76px] items-center gap-3 rounded-xl px-2 py-2 transition-colors duration-200 hover:bg-white/[.06] active:bg-white/10 motion-reduce:transition-none md:gap-4 md:px-3',
          DETAILS_FOCUS,
        )}
      >
        <PersonPoster
          credit={credit}
          variant="row"
          sizes="56px"
          progress={progress}
          className="w-12 flex-none rounded-lg md:w-14"
        />
        <span className="min-w-0 flex-1">
          <b className="block truncate text-[15px] font-semibold leading-snug text-white md:text-base">{credit.title}</b>
          <span className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-white/55 md:text-sm">
            <span className="sm:hidden">{typeLabel}{role ? ' · ' : ''}</span>
            {role}
          </span>
        </span>
        <span className="flex flex-none items-center gap-2.5 text-[13px] tabular-nums text-white/70 md:gap-4 md:text-sm">
          {showYear && credit.year !== null && <span>{credit.year}</span>}
          <span className="hidden h-6 items-center rounded-md border border-white/[.14] px-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-white/70 sm:inline-flex">
            {typeLabel}
          </span>
          {rating && (
            <span className="inline-flex w-[46px] items-center justify-end gap-1" title={t('details.ratingLabel')}>
              <Star className="size-3.5 flex-none fill-current text-yellow-400" aria-hidden="true" />
              {rating}
            </span>
          )}
          {!rating && <span aria-hidden="true" className="hidden w-[46px] sm:block" />}
        </span>
      </Link>
    </li>
  );
}

/**
 * Filmographie complète : filtres (films ou séries, métier), ordre par date
 * ou par notoriété, puis une ligne par titre. Par date, les lignes sont
 * groupées par année ; dès 768 px l'année reste collée à gauche pendant le
 * défilement de son groupe.
 */
export function PersonFilmography({ credits, knownForDepartment, gender, progress, onCountChange, sectionId }: PersonFilmographyProps) {
  const { t } = useTranslation();
  const [media, setMedia] = useState<MediaFilter>('all');
  const [department, setDepartment] = useState<string>('all');
  const [sort, setSort] = useState<SortOrder>('date');
  const [expanded, setExpanded] = useState(false);

  const hasMovies = credits.some((credit) => credit.media_type === 'movie');
  const hasSeries = credits.some((credit) => credit.media_type === 'tv');
  const departments = useMemo(() => departmentsByCount(credits, knownForDepartment), [credits, knownForDepartment]);

  const shown = useMemo(() => {
    const filtered = credits.filter((credit) => (media === 'all' || credit.media_type === media)
      && (department === 'all' || credit.departments.includes(department)));
    return filtered.sort(sort === 'date' ? compareByDateDesc : compareByPopularity(department === 'all' ? (knownForDepartment || ACTING) : department));
  }, [credits, media, department, sort, knownForDepartment]);

  useEffect(() => { onCountChange?.(shown.length); }, [shown.length, onCountChange]);
  // Autre filtre : on repart de l'aperçu.
  useEffect(() => { setExpanded(false); }, [media, department, sort]);

  const visible = expanded ? shown : shown.slice(0, PREVIEW_ROWS);
  const hiddenCount = shown.length - visible.length;

  const mediaOptions: TvSegmentedOption<MediaFilter>[] = [
    { value: 'all', label: t('details.person.filterAll') },
    { value: 'movie', label: t('details.person.filterMovies') },
    { value: 'tv', label: t('details.person.filterSeries') },
  ];
  const departmentOptions: TvSegmentedOption<string>[] = [
    { value: 'all', label: t('details.person.filterAllJobs') },
    ...departments.map(({ department: value }) => ({ value, label: personDepartmentLabel(value, t) })),
  ];
  const sortOptions: TvSegmentedOption<SortOrder>[] = [
    { value: 'date', label: t('details.person.sortDate') },
    { value: 'popular', label: t('details.person.sortPopular') },
  ];

  const rowProps = (credit: PersonCredit, index: number) => ({
    credit,
    gender,
    progress: credit.media_type === 'movie' ? progress.get(credit.id) : undefined,
    revealIndex: expanded ? index - PREVIEW_ROWS : -1,
  });

  let rowIndex = 0;
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2 md:mb-6 md:gap-3">
        {hasMovies && hasSeries && (
          <TvSegmented options={mediaOptions} value={media} onChange={setMedia} ariaLabel={t('details.person.filterMediaLabel')} />
        )}
        {departments.length > 1 && (
          // Une longue carrière a beaucoup de métiers : la bascule défile sur téléphone.
          <div className="-my-1 max-w-full overflow-x-auto py-1 scrollbar-hide">
            <TvSegmented options={departmentOptions} value={department} onChange={setDepartment} ariaLabel={t('details.person.filterJobLabel')} />
          </div>
        )}
        {shown.length > 1 && (
          <TvSegmented options={sortOptions} value={sort} onChange={setSort} ariaLabel={t('details.person.sortLabel')} className="md:ml-auto" />
        )}
      </div>

      {shown.length === 0 ? (
        <p className="border-t border-white/[.12] py-8 text-center text-sm text-white/55">{t('details.person.emptyFilter')}</p>
      ) : sort === 'date' ? (
        <div className="border-t border-white/[.12]">
          {groupByYear(visible).map((group) => (
            <section
              key={group.year ?? 'none'}
              className="border-b border-white/[.12] py-1.5 md:grid md:grid-cols-[104px_minmax(0,1fr)] md:py-2.5 2xl:grid-cols-[128px_minmax(0,1fr)]"
            >
              {/* Sous l'en-tête, la barre de sections et son bandeau (dès 768 px) : 176 px. */}
              <h3 className="px-2 pb-0.5 pt-2.5 text-sm font-bold tabular-nums text-white/55 md:sticky md:top-[192px] md:self-start md:px-0 md:pb-0 md:pt-[22px] md:text-[22px] md:leading-none md:tracking-[-0.01em] md:text-white/45">
                {group.year ?? t('details.person.noDate')}
              </h3>
              <ul>
                {group.credits.map((credit) => (
                  <FilmographyRow key={credit.key} {...rowProps(credit, rowIndex++)} showYear={false} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-white/[.08] border-y border-white/[.12]">
          {visible.map((credit) => (
            <FilmographyRow key={credit.key} {...rowProps(credit, rowIndex++)} showYear />
          ))}
        </ul>
      )}

      {(hiddenCount > 0 || (expanded && shown.length > PREVIEW_ROWS)) && (
        <div className="mt-6 flex justify-center">
          <DetailsButton
            size="compact"
            aria-expanded={expanded}
            onClick={() => {
              if (expanded && sectionId) scrollToDetailsSection(sectionId);
              setExpanded(!expanded);
            }}
          >
            {expanded ? t('details.collapse') : t('details.person.showAll', { count: shown.length })}
          </DetailsButton>
        </div>
      )}
    </div>
  );
}

export default PersonFilmography;
