import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Film, Star } from 'lucide-react';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { SearchGridCard, SearchListCard } from '@/components/SearchCard';
import { cn } from '@/lib/utils';
import { encodeId } from '@/utils/idEncoder';
import { useImageQuality } from '@/hooks/useImageQuality';
import { getTmdbImageProps } from '@/utils/tmdbImages';
import type { SagaFilmProgress } from '@/hooks/useSagaProgress';
import { formatRating, formatRuntime, getYear } from './sagaFormat';
import type { SagaViewMode } from './types';

export interface SagaFilm {
  id: number;
  title: string;
  overview?: string;
  poster_path: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  vote_average: number;
  /** Durée en minutes, connue une fois le détail du film chargé. */
  runtime?: number | null;
}

interface SagaFilmsProps {
  /** Films affichés, dans l'ordre de la collection. */
  films: readonly SagaFilm[];
  viewMode: SagaViewMode;
  /** Vrai à partir de `md`. Dessous, la liste passe en lignes numérotées. */
  wide: boolean;
  /** État par film ; un film absent n'est pas commencé. */
  progress: ReadonlyMap<number, SagaFilmProgress>;
  /** Film à suivre : pastille et contour rouges. */
  nextId: number | null;
}

/** « 2004 · 2 h 22 · ★ 8,0 » : seules les parties connues sont écrites. */
const FilmMeta: React.FC<{ film: SagaFilm; className: string }> = ({ film, className }) => {
  const { t, i18n } = useTranslation();
  const year = getYear(film.release_date);
  const runtime = formatRuntime(film.runtime, t);
  const rating = film.vote_average > 0 ? formatRating(film.vote_average, i18n.language) : null;

  const parts: React.ReactNode[] = [];
  if (year) parts.push(year);
  if (runtime) parts.push(runtime);
  if (rating) {
    parts.push(
      <>
        <Star
          className="mr-[3px] inline h-[0.85em] w-[0.85em] -translate-y-px fill-current text-white opacity-55"
          aria-hidden="true"
        />
        {rating}
      </>,
    );
  }
  if (parts.length === 0) return null;

  return (
    <p className={className}>
      {parts.map((part, index) => (
        <React.Fragment key={index}>
          {index > 0 && ' · '}
          {part}
        </React.Fragment>
      ))}
    </p>
  );
};

/** Pastille « Vu » ou « À suivre ». */
const StatusBadge: React.FC<{ watched: boolean; isNext: boolean; className?: string }> = ({
  watched,
  isNext,
  className,
}) => {
  const { t } = useTranslation();
  if (!watched && !isNext) return null;
  return (
    <span
      className={cn(
        'pointer-events-none inline-flex h-[22px] items-center gap-1 rounded-full px-2 text-[11px] font-bold leading-none text-white',
        isNext ? 'bg-red-600' : 'bg-black/[0.78]',
        className,
      )}
    >
      {!isNext && <Check className="h-3 w-3 text-white" strokeWidth={3} aria-hidden="true" />}
      {t(isNext ? 'collections.statusNext' : 'collections.statusWatched')}
    </span>
  );
};

/** Ligne numérotée de la liste sur téléphone. */
const SagaFilmRow: React.FC<{ film: SagaFilm; index: number; watched: boolean; isNext: boolean }> = ({
  film,
  index,
  watched,
  isNext,
}) => {
  const { t } = useTranslation();
  const { effectiveImageQuality } = useImageQuality();
  const poster = film.poster_path
    ? getTmdbImageProps(film.poster_path, { kind: 'poster', quality: effectiveImageQuality, sizes: '70px' })
    : null;

  return (
    <article className="grid grid-cols-[22px_70px_minmax(0,1fr)_44px] items-center gap-3 border-b border-white/[0.08] py-3">
      <span
        aria-hidden="true"
        className={cn('text-center text-[17px] font-bold tabular-nums', isNext ? 'text-white' : 'text-white/55')}
      >
        {index + 1}
      </span>
      {/* Un seul lien pour l'affiche et le texte : même fiche que les cartes. */}
      <Link
        to={`/movie/${encodeId(film.id)}`}
        className="col-span-2 grid grid-cols-[70px_minmax(0,1fr)] items-center gap-3 rounded-[9px] outline-none transition-transform duration-200 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white motion-reduce:transition-none motion-reduce:active:scale-100"
      >
        <span
          className={cn(
            'relative block aspect-[2/3] overflow-hidden rounded-[9px] border border-white/10 bg-gray-900',
            isNext && 'outline outline-2 outline-offset-2 outline-red-600',
          )}
        >
          {poster ? (
            <img
              {...poster}
              alt=""
              loading="lazy"
              decoding="async"
              className={cn('h-full w-full object-cover', watched && 'opacity-55')}
            />
          ) : (
            <span className="absolute inset-0 flex items-center justify-center">
              <Film className="h-5 w-5 text-white opacity-30" aria-hidden="true" />
            </span>
          )}
        </span>
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold leading-[1.3] text-white">
            <span className="sr-only">{`${index + 1}. `}</span>
            {film.title}
          </h3>
          <FilmMeta film={film} className="mt-[3px] text-[12px] leading-normal tabular-nums text-white/55" />
          {isNext && (
            <span className="mt-1.5 inline-flex h-5 items-center rounded-full bg-red-600 px-2 text-[10px] font-bold leading-none text-white">
              {t('collections.statusNext')}
            </span>
          )}
        </div>
      </Link>
      <span className="flex h-11 w-11 items-center justify-center">
        {watched && (
          <>
            <Check className="h-5 w-5 text-white" aria-hidden="true" />
            <span className="sr-only">{t('collections.statusWatched')}</span>
          </>
        )}
      </span>
    </article>
  );
};

/**
 * Les films d'une collection, dans l'ordre. Grille : l'affiche seule, la carte
 * du site et son badge « #N » (titre et chiffres au survol, comme partout).
 * Liste : la carte liste du site à partir de `md`, des lignes numérotées dessous.
 */
export const SagaFilms: React.FC<SagaFilmsProps> = ({ films, viewMode, wide, progress, nextId }) => {
  const { t } = useTranslation();

  // Même forme que les résultats de recherche ; objets stables pour que les
  // cartes mémoïsées ne se redessinent pas à chaque rendu de la page.
  const cards = useMemo(
    () => films.map((film) => ({
      id: film.id,
      title: film.title,
      media_type: 'movie' as const,
      poster_path: film.poster_path || '',
      backdrop_path: film.backdrop_path || undefined,
      release_date: film.release_date,
      vote_average: film.vote_average,
      overview: film.overview,
    })),
    [films],
  );

  const statusOf = (id: number) => {
    const status = progress.get(id)?.status;
    const isNext = id === nextId;
    return { watched: !isNext && (status === 'watched' || status === 'estimated'), isNext };
  };

  if (viewMode === 'list' && !wide) {
    return (
      <div>
        {films.map((film, index) => (
          <SagaFilmRow key={film.id} film={film} index={index} {...statusOf(film.id)} />
        ))}
      </div>
    );
  }

  if (viewMode === 'list') {
    return (
      <div className="flex flex-col gap-3">
        {films.map((film, index) => {
          const { watched, isNext } = statusOf(film.id);
          return (
            <div
              key={film.id}
              className={cn(
                'relative',
                watched && '[&_img]:opacity-55',
                isNext && '[&_img]:outline [&_img]:outline-2 [&_img]:outline-offset-2 [&_img]:outline-red-600',
              )}
            >
              <SearchListCard
                item={cards[index]}
                index={index}
                movieLabel={`#${index + 1}`}
                serieLabel={`#${index + 1}`}
                watchlistLabel={t('profile.addToWatchlist')}
                removeLabel={t('genres.remove')}
                noDescLabel={t('genres.noContent')}
              />
              <StatusBadge watched={watched} isNext={isNext} className="absolute right-4 top-4" />
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-[repeat(auto-fill,minmax(max(140px,(100%-112px)/8),1fr))] md:gap-4">
      {films.map((film, index) => {
        const { watched, isNext } = statusOf(film.id);
        return (
          <article
            key={film.id}
            className={cn(
              'group/film relative min-w-0',
              // La carte du site est le premier enfant : on atténue son affiche
              // ou on l'entoure sans toucher au composant partagé.
              watched && '[&>div:first-child_img]:opacity-55',
              isNext &&
                '[&>div:first-child]:outline [&>div:first-child]:outline-2 [&>div:first-child]:outline-offset-[3px] [&>div:first-child]:outline-red-600',
            )}
          >
            {/* Le badge garde l'ordre du film dans la collection. */}
            <SearchGridCard
              item={cards[index]}
              index={index}
              movieLabel={`#${index + 1}`}
              serieLabel={`#${index + 1}`}
            />
            {/* Le bouton watchlist de la carte occupe le coin haut droit :
                toujours là sous `md` (la pastille se décale), au survol
                au-dessus (la pastille s'efface). */}
            <StatusBadge
              watched={watched}
              isNext={isNext}
              className="absolute right-12 top-2 z-10 transition-opacity duration-200 motion-reduce:transition-none md:right-2 md:group-hover/film:opacity-0 md:group-has-[:focus-visible]/film:opacity-0"
            />
          </article>
        );
      })}
    </div>
  );
};
