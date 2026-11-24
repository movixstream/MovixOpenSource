import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { DETAILS_FOCUS, DETAILS_PRESS } from './layout';
import { DetailsSectionHeader } from './DetailsSection';

type DetailsMediaType = 'movie' | 'tv';
/** La note TMDB sert aussi à la page d'une personne. */
type DetailsTmdbNoteType = DetailsMediaType | 'person';

export interface DetailsTmdbNoteProps {
  mediaType: DetailsTmdbNoteType;
  id: string | null;
  className?: string;
}

/**
 * « Données fournies par TMDB ». Le bloc garde `data-halloween-parchment` : le
 * thème Halloween en fait un parchemin et colore ses descendants (d'où le <p>
 * à l'intérieur).
 */
export function DetailsTmdbNote({ mediaType, id, className }: DetailsTmdbNoteProps): JSX.Element {
  const { t } = useTranslation();
  return (
    <div data-halloween-parchment className={className}>
      <p className="text-xs text-white/55 md:text-[13px]">
        {t(mediaType === 'tv' ? 'details.tmdbNoteStartTv' : 'details.tmdbNoteStart')}{' '}
        <a
          href={`https://www.themoviedb.org/${mediaType}/${id}`}
          target="_blank"
          rel="noopener noreferrer"
          className={`rounded-sm text-white underline underline-offset-4 hover:text-red-400 ${DETAILS_FOCUS}`}
        >
          TMDB
        </a>
        . {t('details.tmdbNoteEnd')}
      </p>
    </div>
  );
}

export interface DetailsInlineLink {
  id: number | string;
  name: string;
  to: string;
}

/** Liens séparés par des virgules (réalisateurs, créateurs, genres…). */
export function DetailsInlineLinks({ links }: { links: DetailsInlineLink[] }): JSX.Element {
  return (
    <>
      {links.map((link, index) => (
        <span key={link.id}>
          {index > 0 && ', '}
          <Link to={link.to} className={`rounded-sm underline-offset-4 hover:underline ${DETAILS_FOCUS}`}>{link.name}</Link>
        </span>
      ))}
    </>
  );
}

export interface DetailsSynopsisBlockProps {
  mediaType: DetailsMediaType;
  id: string | null;
  tagline?: string;
  text: string;
}

/**
 * Synopsis de la section Aperçu, avec la note TMDB. Les genres se cliquent
 * dans la ligne d'infos du haut. Sous 768 px le synopsis se lit dans l'image
 * du haut (« Lire la suite ») : le bloc est masqué.
 */
export function DetailsSynopsisBlock({ mediaType, id, tagline, text }: DetailsSynopsisBlockProps): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="hidden md:block">
      <DetailsSectionHeader title={t('details.synopsisTitle')} />
      {tagline && <p className="mb-3 text-[19px] italic text-white/70">{tagline}</p>}
      <p className="max-w-[66ch] text-pretty text-[17px] leading-[1.65] text-white/[.88] 2xl:text-[19px]">
        {text}
      </p>
      <DetailsTmdbNote mediaType={mediaType} id={id} className="mt-5" />
    </div>
  );
}

export interface DetailsMovixRatingValueProps {
  /** Note Movix déjà mise en forme. */
  rating: string;
  onInfo: () => void;
}

/** Valeur « Note Movix » des faits, avec le bouton qui explique son calcul. */
export function DetailsMovixRatingValue({ rating, onInfo }: DetailsMovixRatingValueProps): JSX.Element {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-0.5">
      <button
        type="button"
        onClick={onInfo}
        aria-label={t('details.movixRatingInfoButtonLabel')}
        title={t('details.movixRatingInfoButtonLabel')}
        aria-haspopup="dialog"
        className={`group -my-3 flex size-11 items-center justify-center rounded-full hover:bg-white/10 ${DETAILS_PRESS} ${DETAILS_FOCUS}`}
      >
        <Info aria-hidden="true" className="size-4 text-white opacity-60 transition-opacity duration-200 group-hover:opacity-100" />
      </button>
      {rating} / 10
    </span>
  );
}
