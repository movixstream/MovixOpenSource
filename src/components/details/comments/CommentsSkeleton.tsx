import { useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { readLocalStorage } from '@/utils/browserStorage';
import { DetailsSectionHeader } from '../DetailsSection';
import { COMMENTS_FORM_COLUMN, COMMENTS_GRID, CommentsHiddenNotice, CommentsLoginCard, CommentsNote } from './CommentsParts';

/*
 * Attente des commentaires des fiches. Chaque gabarit reprend les classes de
 * l'élément qu'il remplace (marges, interlignes, zones de 32 ou 44 px) : rien
 * ne bouge quand le vrai contenu arrive, seuls les traits deviennent du texte.
 */

/** Commentaires montrés avant le lien « Voir les autres commentaires ». */
export const COMMENTS_COLLAPSED_COUNT = 4;

/** Trait gris à la place d'un texte ou d'une icône. */
const BAR = 'rounded bg-white/[.08]';

/** Respiration lente des gabarits ; coupée en mode léger comme les autres `animate-pulse*`. */
const PULSE = 'animate-pulse-soft motion-reduce:animate-none';
const PULSE_MS = 1800;

/**
 * Cale la respiration sur l'horloge de la page : le gabarit de la section et
 * celui de la liste, montés l'un après l'autre, respirent ensemble au lieu de
 * repartir de zéro au remplacement.
 */
function usePulsePhase(): CSSProperties {
  const [delay] = useState(() => (typeof performance === 'undefined' ? 0 : Math.round(performance.now() % PULSE_MS)));
  return { animationDelay: `-${delay}ms` };
}

/**
 * Ligne de texte en attente : sa hauteur est celle de la vraie ligne (taille et
 * interligne du parent ou de `className`), le trait se pose sur le milieu du texte.
 */
function TextLine({ width, className }: { width: string; className?: string }) {
  return (
    <span className={cn('block whitespace-nowrap', className)}>
      <span className={cn(BAR, 'inline-block h-[.7em] max-w-full align-middle', width)} />
      {'​'}
    </span>
  );
}

/** Zone d'action sous un commentaire : 32 px de haut, comme les vrais boutons. */
function ActionSlot({ width }: { width: string }) {
  return (
    <span className="inline-flex h-8 items-center px-2">
      <span className={cn(BAR, 'h-[.7em]', width)} />
    </span>
  );
}

interface RowShape {
  /** Largeurs en `em` : elles suivent la taille du texte qu'elles remplacent. */
  name: string;
  date: string;
  /** Une largeur par ligne de texte. */
  lines: readonly string[];
  /** Lien « N réponses » présent. */
  replies: boolean;
}

/** Des commentaires de longueurs différentes : la liste ne ressemble pas à un motif répété. */
const ROWS: readonly RowShape[] = [
  { name: 'w-[7em]', date: 'w-[6.5em]', lines: ['w-full', 'w-4/5'], replies: true },
  { name: 'w-[5em]', date: 'w-[5.5em]', lines: ['w-3/5'], replies: false },
  { name: 'w-[6em]', date: 'w-[7em]', lines: ['w-full', 'w-full', 'w-2/5'], replies: true },
  { name: 'w-[8em]', date: 'w-[6em]', lines: ['w-11/12', 'w-1/2'], replies: false },
];

/** Gabarit d'un commentaire : mêmes classes que `CommentRow` et `Entry`. */
function SkeletonRow({ shape, signedIn }: { shape: RowShape; signedIn: boolean }) {
  return (
    <li className="border-b border-white/[.12] py-4 first:pt-0 last:border-b-0 last:pb-0 md:py-[18px]">
      <div className="flex gap-3 md:gap-3.5">
        <span className="size-9 flex-none rounded-[11px] bg-white/[.08] md:size-10 md:rounded-xl" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-x-2">
            <TextLine width={shape.name} className="text-sm leading-5" />
            <TextLine width={shape.date} className="text-xs md:text-[13px]" />
          </div>
          {/* `62ch` se mesure sur le bloc extérieur, sans taille de texte, comme dans `Entry`. */}
          <div className="mt-[3px] max-w-[62ch] md:mt-1">
            <div className="text-sm leading-[1.55] md:text-[15px]">
              {shape.lines.map((width, index) => <TextLine key={index} width={width} />)}
            </div>
          </div>
          {/* Cœur et compteur, « N réponses », puis « Répondre » et « Signaler » avec un compte. */}
          <div className="-ml-2 mt-1 flex items-center gap-x-0.5 text-xs md:mt-1.5 md:text-[13px]">
            <span className="inline-flex h-8 items-center gap-1.5 px-2">
              <span className="size-[15px] rounded-full bg-white/[.08]" />
              <span className={cn(BAR, 'h-[.7em] w-[.6em]')} />
            </span>
            {shape.replies && <ActionSlot width="w-[5.2em]" />}
            {signedIn && (
              <>
                <ActionSlot width="w-[4.6em]" />
                <ActionSlot width="w-[4em]" />
              </>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

/**
 * Liste en attente : les quatre commentaires montrés d'abord, avec leurs
 * filets, et les actions que la personne verra (connectée ou non).
 */
export function CommentRowsSkeleton({ signedIn }: { signedIn: boolean }) {
  const { t } = useTranslation();
  const phase = usePulsePhase();
  return (
    <div role="status" className={PULSE} style={phase}>
      <span className="sr-only">{t('common.loading')}</span>
      <ul aria-hidden="true">
        {ROWS.slice(0, COMMENTS_COLLAPSED_COUNT).map((shape, index) => (
          <SkeletonRow key={index} shape={shape} signedIn={signedIn} />
        ))}
      </ul>
    </div>
  );
}

/** Ligne des limites (« Limite : sur ce film 0/3 · cette heure 0/10 ») en attente. */
export function CommentLimitsSkeleton() {
  const phase = usePulsePhase();
  return (
    <div aria-hidden="true" className={cn('mt-3 text-[13px]', PULSE)} style={phase}>
      <TextLine width="w-[19em]" />
    </div>
  );
}

/** Lien « Me prévenir » de l'en-tête en attente : même zone de 44 px. */
function FollowSkeleton() {
  const phase = usePulsePhase();
  return (
    <span aria-hidden="true" className={cn('-my-2 inline-flex min-h-11 min-w-0 items-center gap-1.5 text-[13px] md:text-sm', PULSE)} style={phase}>
      <span className="size-[15px] flex-none rounded-full bg-white/[.08] md:size-4" />
      <span className={cn(BAR, 'h-[.7em] min-w-0 shrink w-[5.6em] md:w-[17.5em]')} />
    </span>
  );
}

/** Champ de saisie en attente : cadre, invite, barre de mise en forme et barre d'envoi de `CommentBox`. */
function CommentBoxSkeleton() {
  const phase = usePulsePhase();
  return (
    <div aria-hidden="true" className="rounded-2xl border border-white/[.12] bg-white/[.04] p-3.5 md:p-4">
      <div className={PULSE} style={phase}>
        <div className="h-[72px] text-base leading-normal md:h-24 md:text-[15px]">
          <TextLine width="w-3/5" />
        </div>
        {/* Huit boutons de mise en forme, le filet, « Aperçu » et l'aide. */}
        <div className="-ml-[7px] mt-1.5 flex items-center gap-0.5">
          {Array.from({ length: 8 }, (_, index) => (
            <span key={index} className="flex size-7 items-center justify-center">
              <span className="size-3.5 rounded-[3px] bg-white/[.08]" />
            </span>
          ))}
          <span className="mx-0.5 h-5 w-px bg-white/[.12]" />
          <span className="flex h-7 items-center gap-1.5 px-1.5 text-xs">
            <span className="size-3.5 rounded-[3px] bg-white/[.08]" />
            <span className={cn(BAR, 'hidden h-[.7em] w-[3.6em] sm:block')} />
          </span>
          <span className="flex h-7 items-center px-1.5">
            <span className="size-3.5 rounded-full bg-white/[.08]" />
          </span>
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3.5 gap-y-2 border-t border-white/[.12] pt-2.5 text-[13px] md:mt-3 md:gap-x-4 md:pt-3">
        <span className={cn('inline-flex min-h-11 items-center gap-2 md:min-h-0', PULSE)} style={phase}>
          <span className="size-[18px] flex-none rounded-[5px] bg-white/[.08]" />
          <span className={cn(BAR, 'h-[.7em] w-[3.4em]')} />
        </span>
        <span className={cn(BAR, PULSE, 'h-[.7em] w-[3.6em]')} style={phase} />
        <span className={cn(PULSE, 'ml-auto h-11 w-[88px] rounded-xl bg-white/[.08] md:h-10 md:rounded-[10px]')} style={phase} />
      </div>
    </div>
  );
}

/**
 * Section des commentaires avant son chargement (fiche encore loin, ou saut
 * direct par la barre de sections) : la même mise en page que
 * `DetailsComments`, selon le compte et le réglage qui masque la section.
 */
export function DetailsCommentsPlaceholder({ title }: { title: string }) {
  const [stored] = useState(() => ({
    hidden: readLocalStorage('settings_hide_comments_section') === 'true',
    signedIn: !!readLocalStorage('auth_token'),
    hasProfile: !!readLocalStorage('selected_profile_id'),
  }));

  if (stored.hidden) {
    return (
      <>
        <DetailsSectionHeader title={title} />
        <CommentsHiddenNotice />
      </>
    );
  }

  return (
    <div aria-busy="true">
      <DetailsSectionHeader title={title} action={stored.signedIn && stored.hasProfile ? <FollowSkeleton /> : undefined} />
      <div className={COMMENTS_GRID}>
        <div className={COMMENTS_FORM_COLUMN}>
          {stored.signedIn ? (
            <>
              <CommentBoxSkeleton />
              <CommentLimitsSkeleton />
            </>
          ) : <CommentsLoginCard />}
          <CommentsNote />
        </div>
        <div className="min-w-0">
          <CommentRowsSkeleton signedIn={stored.signedIn} />
        </div>
      </div>
    </div>
  );
}
