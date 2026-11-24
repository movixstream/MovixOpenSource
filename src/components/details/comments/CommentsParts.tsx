import { ArrowRight, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IX_MATRIX_URL } from '@/config/community';
import { cn } from '@/lib/utils';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { DetailsLinkButton } from '../DetailsButton';

/*
 * Morceaux des commentaires des fiches qui ne dépendent d'aucune donnée : la
 * section chargée (`DetailsComments`) et son gabarit d'attente
 * (`DetailsCommentsPlaceholder`) les dessinent à l'identique.
 */

/** Champ de saisie à gauche et liste à droite dès 1024 px, l'un sous l'autre avant. */
export const COMMENTS_GRID = 'grid gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:items-start lg:gap-14';

/**
 * Colonne du champ : elle reste sous l'en-tête et la barre de sections pendant
 * qu'on lit la liste. Une fois collée, la barre descend sous le bandeau du
 * titre : en-tête 64 + bandeau 56 + barre ≈ 178 px, plus un peu d'air.
 */
export const COMMENTS_FORM_COLUMN = 'min-w-0 lg:sticky lg:top-[200px]';

/** Lien dans une phrase de la note. */
const INLINE_LINK = cn(
  'rounded-sm font-medium text-white/80 underline decoration-white/30 underline-offset-2',
  'transition-colors duration-200 hover:text-white hover:decoration-white motion-reduce:transition-none',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white',
);

/** Encadré qui remplace la section quand les commentaires sont masqués dans les réglages. */
export function CommentsHiddenNotice() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4 rounded-[18px] border border-white/10 bg-white/5 p-[18px] md:flex-row md:items-center md:justify-between md:gap-10 md:rounded-[20px] md:px-8 md:py-7">
      <div className="min-w-0">
        <h3 className="text-[17px] font-semibold leading-[1.3] text-white md:text-lg">{t('comments.sectionDisabledTitle')}</h3>
        <p className="mt-1 text-sm text-white/70 md:text-[15px]">{t('comments.sectionDisabledDesc')}</p>
      </div>
      <DetailsLinkButton to="/settings" size="compact" className="flex-none" trailingIcon={<ArrowRight aria-hidden="true" />}>
        {t('nav.settings')}
      </DetailsLinkButton>
    </div>
  );
}

/** À la place du champ, sans compte : un message et le bouton « Se connecter ». */
export function CommentsLoginCard() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-2xl border border-white/[.12] bg-white/[.04] p-3.5 md:p-4">
      <p className="text-[15px] text-white/70">{t('comments.loginToComment')}</p>
      <DetailsLinkButton
        to="/login-bip39"
        size="compact"
        className="h-11 rounded-xl px-[18px] text-sm md:h-10 md:rounded-[10px] md:px-[18px] md:text-sm"
      >
        {t('nav.login')}
      </DetailsLinkButton>
    </div>
  );
}

/** Note sous le champ : les demandes d'ajout se font ailleurs. */
export function CommentsNote() {
  const { t } = useTranslation();
  return (
    <p className="mt-4 text-[13px] leading-relaxed text-white/55">
      <span className="font-semibold text-white/80">{t('comments.noteTitle')}</span> {t('comments.noteContent')}{' '}
      <Link to="/wishboard" className={INLINE_LINK}>{t('comments.requestPage')}</Link>
      <span aria-hidden="true"> · </span>
      <a href={IX_MATRIX_URL} target="_blank" rel="noopener noreferrer" className={cn(INLINE_LINK, 'inline-flex items-center gap-1')}>
        Matrix
        <ExternalLink aria-hidden="true" className="size-3 text-white opacity-80" />
      </a>
    </p>
  );
}
