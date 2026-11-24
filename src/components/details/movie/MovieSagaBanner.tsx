import { useEffect, useMemo, useRef } from 'react';
import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SearchGridCard } from '@/components/SearchCard';
import { cn } from '@/lib/utils';
import { DetailsLinkButton } from '../DetailsButton';

export interface MovieSagaPart {
  id: number;
  title: string;
  poster_path: string | null;
  release_date: string;
  vote_average: number;
  overview?: string;
}

export interface MovieSagaBannerProps {
  /** Identifiant TMDB de la collection (lien vers `/collection/:id`). */
  collectionId: number;
  /** Nom de la saga, connu dès la fiche du film. */
  name: string;
  /** Films de la saga ; `null` tant qu'ils ne sont pas chargés. */
  parts: MovieSagaPart[] | null;
  loading: boolean;
  /** Film de la fiche courante, marqué « Actuel ». */
  currentId: number;
}

const releaseTime = (part: MovieSagaPart) => {
  const time = Date.parse(part.release_date);
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
};

/** Bandeau « Saga » de la fiche film : les films de la collection et le lien vers sa page. */
export function MovieSagaBanner({ collectionId, name, parts, loading, currentId }: MovieSagaBannerProps) {
  const { t } = useTranslation();
  const rowRef = useRef<HTMLUListElement>(null);
  // Ordre de sortie ; les films sans date ferment la marche.
  const sorted = useMemo(() => (parts ? [...parts].sort((a, b) => releaseTime(a) - releaseTime(b)) : []), [parts]);
  const position = sorted.findIndex((part) => part.id === currentId) + 1;

  // Longue saga : amener le film courant au milieu de la rangée, sans toucher
  // au défilement de la page.
  useEffect(() => {
    const row = rowRef.current;
    const current = row?.querySelector<HTMLElement>('[data-current="true"]');
    if (!row || !current || row.scrollWidth <= row.clientWidth) return;
    row.scrollLeft = Math.max(0, current.offsetLeft - row.offsetLeft - (row.clientWidth - current.offsetWidth) / 2);
  }, [sorted]);

  const ordinal = position > 0 ? t(`details.saga.ordinals.${position}`, { defaultValue: '' }) : '';
  const summary = sorted.length > 0
    ? [
      t('details.saga.films', { count: sorted.length }),
      position > 0 && (ordinal
        ? t('details.saga.position', { ordinal })
        : t('details.saga.positionNumber', { position })),
    ].filter(Boolean).join(' ')
    : null;

  const sagaLink = (className: string) => (
    <DetailsLinkButton
      to={`/collection/${collectionId}`}
      size="compact"
      className={className}
      trailingIcon={<ArrowRight aria-hidden="true" />}
    >
      {t('details.saga.view')}
    </DetailsLinkButton>
  );

  const posterSlot = 'w-[calc((100%-1.5rem)/3)] flex-none md:w-[118px] 2xl:w-[140px]';

  return (
    <div className="flex flex-col gap-4 rounded-[18px] border border-white/10 bg-white/5 p-[18px] md:flex-row md:flex-wrap md:items-center md:justify-between md:gap-x-10 md:gap-y-6 md:rounded-[20px] md:px-8 md:py-7">
      <div className="min-w-0">
        <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-red-400 md:text-xs">{t('details.sagaTab')}</span>
        <h3 className="mb-1 mt-1 text-[21px] font-bold leading-[1.2] tracking-[-0.01em] text-white md:mb-2 md:mt-1.5 md:text-[26px]">{name}</h3>
        {summary && <p className="text-sm text-white/70 md:text-[15px]">{summary}</p>}
        {sagaLink('mt-[18px] hidden md:inline-flex')}
      </div>

      {(loading || sorted.length > 0) && (
        <ul
          ref={rowRef}
          className="scrollbar-hide -mx-1.5 -my-2 flex max-w-[calc(100%+0.75rem)] gap-3 overflow-x-auto px-1.5 py-2 md:gap-[18px]"
        >
          {sorted.length === 0
            ? [0, 1, 2].map((index) => (
              <li key={index} aria-hidden="true" className={posterSlot}>
                <div className="aspect-[2/3] rounded-xl border border-white/10 bg-white/5" />
                {/* Place du titre et de l'année : la page ne saute pas à l'arrivée des cartes. */}
                <div className="mt-2 h-9 md:mt-2.5" />
              </li>
            ))
            : sorted.map((part, index) => {
              const isCurrent = part.id === currentId;
              const year = part.release_date ? part.release_date.slice(0, 4) : '';
              return (
                <li key={part.id} data-current={isCurrent} className={cn(posterSlot, 'min-w-0')}>
                  {/* Carte du site ; sur le film courant, sa pastille devient « Actuel » en rouge.
                      Sous 768 px la carte est trop étroite pour son résumé (toujours
                      visible sans survol) : on le masque, titre et année sont en dessous. */}
                  <div
                    className={cn(
                      'rounded-xl max-md:[&>div>div.pointer-events-none]:hidden',
                      isCurrent && 'outline outline-2 outline-offset-[3px] outline-red-600 [&>div>span:first-child]:bg-red-600 [&>div>span:first-child]:text-white',
                    )}
                  >
                    <SearchGridCard
                      item={{
                        id: part.id,
                        title: part.title,
                        media_type: 'movie',
                        poster_path: part.poster_path || '',
                        release_date: part.release_date,
                        vote_average: part.vote_average,
                        overview: part.overview,
                      }}
                      index={index}
                      movieLabel={isCurrent ? t('details.currentBadge') : t('search.movieLabel')}
                      serieLabel={t('search.serieLabel')}
                      animateEntrance={false}
                    />
                  </div>
                  <b className="mt-2 block text-xs font-semibold leading-[1.3] text-white md:mt-2.5 md:text-[13px]">{part.title}</b>
                  {year && <span className="block text-xs text-white/55">{year}</span>}
                </li>
              );
            })}
        </ul>
      )}

      {sagaLink('w-full md:hidden')}
    </div>
  );
}

export default MovieSagaBanner;
