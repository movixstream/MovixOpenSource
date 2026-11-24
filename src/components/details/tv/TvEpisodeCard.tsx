import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { Bookmark, Check, ChevronDown, EyeOff, Play, Tv } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { DETAILS_FOCUS, DETAILS_IMAGE_EDGE, DETAILS_PRESS } from '../layout';
import { DETAILS_EASE_OUT, DetailsCollapse, DetailsLabelSwap } from '../motion';
import type { TvEpisodeItem } from './types';

export interface TvEpisodeEntryProps {
  episode: TvEpisodeItem;
  /** Résumé déplié ; `undefined` tant que l'utilisateur n'a rien choisi. */
  expanded?: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onPlay: () => void;
  onToggleWatched: () => void;
  onToggleWatchlist: () => void;
}

/**
 * Gabarit d'un bouton à icône d'épisode : 44 px sous 768 px, 36 px au-delà
 * avec une zone tactile qui reste à 44 px. À passer aussi à `AlertButton`.
 */
export const TV_EPISODE_ACTION_CLASS = cn(
  'relative flex size-11 flex-none items-center justify-center rounded-lg md:size-9',
  "md:before:absolute md:before:-inset-1 md:before:content-['']",
  DETAILS_FOCUS,
);

/**
 * Contour rouge de l'épisode en cours ou sélectionné. Le style passe par une
 * propriété arbitraire : `cn` (tailwind-merge) retire la classe `outline`
 * quand `outline-2` la suit, et le contour ne s'affiche plus.
 */
const CURRENT_OUTLINE = '[outline-style:solid] outline-2 outline-red-600';

/**
 * Survol d'un épisode, en deux gestes qui partent ensemble : une plaque claire
 * grandit derrière tout l'épisode (`HoverPlate`, l'idée vient de Cinepulse) et
 * les crochets du logo se referment sur la vignette (`ThumbBracket`). Le `li`
 * porte ces classes : `isolate` fait passer la plaque sous le contenu.
 * Souris seulement : au doigt, l'état resterait allumé après l'appui. Sans
 * animations, un simple fondu. Couleur : `--episode-bracket` et
 * `--episode-plate`, posées par `TvEpisodeList` (blanc par défaut).
 */
const EPISODE_HOVER_HOST = 'group/episode relative isolate';

/**
 * Plaque du survol. Elle dépasse de l'épisode de 16 px sur les côtés : il faut
 * loger les crochets (9 px), coins compris, d'où un rayon de 12 px seulement.
 * En grille, il reste 4 px avant la carte voisine : ne pas l'agrandir.
 */
function HoverPlate({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute -z-10 rounded-xl bg-[color:var(--episode-plate,rgb(255_255_255/.08))] opacity-0',
        'transition-[transform,opacity] duration-200 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]',
        '[@media(hover:hover)_and_(pointer:fine)]:group-hover/episode:scale-100',
        '[@media(hover:hover)_and_(pointer:fine)]:group-hover/episode:opacity-100',
        className,
      )}
    />
  );
}

/**
 * Crochet du logo, posé de chaque côté de la vignette. Au survol, les deux
 * arrivent des côtés et se referment sur l'image, comme dans l'intro du site.
 * Ils s'arrêtent à 6 px de la vignette, hors du contour rouge de l'épisode en
 * cours, et gardent les proportions du logo (bras ≈ 37 % de la hauteur).
 */
function ThumbBracket({ side }: { side: 'left' | 'right' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute -inset-y-[9px] w-[22%] border-y-[3px] border-[color:var(--episode-bracket,#fff)] opacity-0',
        'transition-[transform,opacity] duration-200 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]',
        side === 'left'
          ? '-left-[9px] border-l-[3px] motion-safe:-translate-x-3'
          : '-right-[9px] border-r-[3px] motion-safe:translate-x-3',
        '[@media(hover:hover)_and_(pointer:fine)]:group-hover/episode:translate-x-0',
        '[@media(hover:hover)_and_(pointer:fine)]:group-hover/episode:opacity-100',
      )}
    />
  );
}

/** Pastille posée sur la vignette : état de lecture, état de diffusion. */
const THUMB_BADGE = 'absolute inline-flex h-5 items-center gap-1 rounded-full px-[7px] text-[10px] font-bold text-white md:h-6 md:gap-[5px] md:px-[9px] md:text-[11px] md:tracking-[0.04em]';

/** Pastille sobre : langue d'un épisode anime. */
const TAG = 'inline-flex h-6 items-center rounded-full border border-white/[.18] px-2 text-[11px] font-semibold text-white/80';

/**
 * Vignette 16:9 de l'épisode, cliquable. Elle double le titre pour la souris et
 * le doigt : le clavier et les lecteurs d'écran passent par le titre. Les
 * crochets du survol sont hors du bouton, qui coupe ce qui dépasse.
 */
function Thumb({ episode, onPlay }: { episode: TvEpisodeItem; onPlay: () => void }) {
  const { t } = useTranslation();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const imageUrl = episode.imageUrl ?? null;
  const showImage = imageUrl !== null && !episode.imageHidden && failedUrl !== imageUrl;
  const outlined = episode.status === 'current' || episode.selected;

  return (
    <div className="relative">
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onPlay}
        className={cn(
          'relative block aspect-video w-full overflow-hidden rounded-[10px] bg-gray-900 md:rounded-xl',
          DETAILS_IMAGE_EDGE,
          'transition-transform duration-200 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100',
          outlined && cn(CURRENT_OUTLINE, 'outline-offset-2 md:outline-offset-[3px]'),
        )}
      >
        {showImage ? (
          <img
            data-details-episode-still
            src={imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => setFailedUrl(imageUrl)}
            className={cn('block h-full w-full object-cover', episode.status === 'seen' && 'opacity-50')}
          />
        ) : (
          <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-[10px] text-white/60 md:gap-1.5 md:text-xs">
            {episode.imageHidden ? (
              <>
                <EyeOff aria-hidden="true" className="size-5 text-white opacity-50 md:size-6" />
                {t('details.imageMasked')}
              </>
            ) : (
              <Tv aria-hidden="true" className="size-7 text-white opacity-20" />
            )}
          </span>
        )}

        {episode.status === 'seen' && (
          <span title={t('details.alreadyWatched')} className={cn(THUMB_BADGE, 'left-1.5 top-1.5 bg-black/[.78] md:left-2.5 md:top-2.5')}>
            <Check aria-hidden="true" strokeWidth={3} className="size-[11px] md:size-[13px]" />
            {t('details.watchedBtn')}
          </span>
        )}
        {episode.status === 'current' && (
          <span title={t('details.currentlyWatching')} className={cn(THUMB_BADGE, 'left-1.5 top-1.5 bg-red-600 md:left-2.5 md:top-2.5')}>
            <Play aria-hidden="true" className="size-[11px] fill-current md:size-[13px]" />
            {t('details.inProgressShort')}
          </span>
        )}
        {/* État de diffusion : en bas à droite sous 768 px (la vignette est étroite), en haut à droite au-delà. */}
        {episode.airing && (
          <span className={cn(THUMB_BADGE, 'bottom-1.5 right-1.5 bg-black/[.78] md:bottom-auto md:right-2.5 md:top-2.5')}>
            {episode.airing === 'upcoming' && <span aria-hidden="true" className="size-1.5 flex-none rounded-full bg-yellow-400" />}
            {t(`details.airing.${episode.airing}`)}
          </span>
        )}

        {episode.status === 'current' && (episode.progress ?? 0) > 0 && (
          <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[3px] bg-white/25 md:h-1">
            <span className="block h-full bg-red-600" style={{ width: `${Math.min(100, episode.progress ?? 0)}%` }} />
          </span>
        )}
      </button>
      <ThumbBracket side="left" />
      <ThumbBracket side="right" />
    </div>
  );
}

/** Titre de l'épisode : c'est lui qui lance la lecture au clavier. */
function Title({ episode, onPlay, clamp = false, className }: {
  episode: TvEpisodeItem;
  onPlay: () => void;
  /** Coupe le titre à deux lignes (ligne de liste). */
  clamp?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <h3 className={className}>
      <button
        type="button"
        onClick={onPlay}
        className={cn('block max-w-full rounded-sm text-left', DETAILS_FOCUS)}
      >
        <span className={clamp ? 'line-clamp-2' : undefined}>{episode.title}</span>
        {episode.status === 'seen' && <span className="sr-only"> ({t('details.alreadyWatched')})</span>}
        {episode.status === 'current' && <span className="sr-only"> ({t('details.currentlyWatching')})</span>}
        {episode.airing === 'upcoming' && <span className="sr-only"> ({t('details.airing.upcoming')})</span>}
      </button>
    </h3>
  );
}

/** Coche « vu » : allumée par la marque de cet appareil. */
function WatchedButton({ episode, onToggle }: { episode: TvEpisodeItem; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      aria-pressed={Boolean(episode.watched)}
      aria-label={t('details.markAsWatched')}
      title={t('details.markAsWatched')}
      onClick={onToggle}
      className={cn('group/act hover:bg-white/10', TV_EPISODE_ACTION_CLASS, DETAILS_PRESS)}
    >
      <Check
        aria-hidden="true"
        className={cn(
          'size-5 transition-[color,opacity] duration-200 motion-reduce:transition-none md:size-[17px]',
          episode.watched ? 'text-green-400 opacity-100' : 'text-white opacity-60 group-hover/act:opacity-100 md:opacity-70',
        )}
      />
    </button>
  );
}

/** Actions secondaires : à voir, indication « vu ailleurs », cloche d'alerte. */
function ExtraActions({ episode, onToggleWatchlist }: { episode: TvEpisodeItem; onToggleWatchlist: () => void }) {
  const { t } = useTranslation();
  const serverLabel = episode.serverWatched === 'estimated'
    ? t('details.watchedEstimatedBtn', 'Vu (estimé)')
    : t('details.watchedOtherDevice', 'Vu sur un autre appareil');
  return (
    <>
      {episode.serverWatched && (
        // Indication, pas un bouton : cocher reste le geste qui marque pour de vrai.
        <span
          role="img"
          aria-label={serverLabel}
          title={serverLabel}
          className="mx-1 inline-flex h-7 flex-none items-center gap-1 rounded-full border border-dashed border-white/25 px-2 text-[11px] text-white/70"
        >
          <Check aria-hidden="true" className="size-3.5 text-white opacity-60" />
          {episode.serverWatched === 'estimated' ? t('details.estimatedShort', 'estimé') : t('details.otherDeviceShort', 'autre appareil')}
        </span>
      )}
      <button
        type="button"
        aria-pressed={Boolean(episode.inWatchlist)}
        aria-label={t('details.addToWatchlistTitle')}
        title={t('details.addToWatchlistTitle')}
        onClick={onToggleWatchlist}
        className={cn('group/act hover:bg-white/10', TV_EPISODE_ACTION_CLASS, DETAILS_PRESS)}
      >
        <Bookmark
          aria-hidden="true"
          className={cn(
            'size-5 transition-[color,opacity] duration-200 motion-reduce:transition-none md:size-[17px]',
            episode.inWatchlist ? 'fill-current text-red-500 opacity-100' : 'text-white opacity-60 group-hover/act:opacity-100 md:opacity-70',
          )}
        />
      </button>
      {episode.alert}
    </>
  );
}

/** Durée du dépliage du résumé : celle d'un menu déroulant. */
const OVERVIEW_DURATION = 250;

/**
 * Résumé replié sur deux lignes. « Voir plus » n'apparaît que si le texte
 * dépasse vraiment ces deux lignes (mesuré, pas deviné).
 *
 * Le dépliage anime la hauteur (WAAPI) : en ouvrant, la coupure à deux lignes
 * saute d'abord, puis la hauteur passe des deux lignes au texte entier ; en
 * fermant, la hauteur redescend à deux lignes et la coupure (avec ses points
 * de suspension) ne revient qu'à la fin, sinon le texte disparaîtrait avant
 * que le bloc ait rétréci. Un clic en plein mouvement repart de la hauteur
 * du moment.
 */
function Overview({ text, expanded, onExpandedChange, className }: {
  text: string;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const textRef = useRef<HTMLParagraphElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [clamped, setClamped] = useState(!expanded);
  const animationRef = useRef<Animation | null>(null);
  const pendingFromRef = useRef<number | null>(null);
  const firstRenderRef = useRef(true);
  const textId = useId();

  useEffect(() => {
    const element = textRef.current;
    if (!element || !clamped) return;
    const measure = () => setOverflowing(element.scrollHeight - element.clientHeight > 2);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text, clamped]);

  /**
   * `hold` garde la hauteur finale après la fin (fermeture) : sans ça, entre la
   * fin de l'animation et la remise de la coupure, une image montre le texte
   * entier, d'où le saut. L'animation tenue est retirée une fois la coupure
   * posée (étape 2).
   */
  const animateHeight = (from: number, to: number, onDone?: () => void, hold = false) => {
    const element = textRef.current;
    if (!element || typeof element.animate !== 'function') {
      onDone?.();
      return;
    }
    const animation = element.animate(
      [{ height: `${from}px`, overflow: 'hidden' }, { height: `${to}px`, overflow: 'hidden' }],
      { duration: OVERVIEW_DURATION, easing: `cubic-bezier(${DETAILS_EASE_OUT.join(',')})`, fill: hold ? 'forwards' : 'none' },
    );
    animationRef.current = animation;
    animation.onfinish = () => {
      if (animationRef.current !== animation) return;
      if (!hold) animationRef.current = null;
      onDone?.();
    };
  };

  // Étape 1 : le parent a basculé `expanded`.
  useLayoutEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    const element = textRef.current;
    if (!element) return;
    const from = element.getBoundingClientRect().height;
    animationRef.current?.cancel();
    animationRef.current = null;
    if (reduceMotion) {
      setClamped(!expanded);
      return;
    }
    if (expanded) {
      if (clamped) {
        // Il faut d'abord retirer la coupure pour connaître la hauteur finale.
        pendingFromRef.current = from;
        setClamped(false);
      } else {
        animateHeight(from, element.scrollHeight);
      }
      return;
    }
    const lineHeight = parseFloat(getComputedStyle(element).lineHeight) || 19.5;
    animateHeight(from, lineHeight * 2, () => setClamped(true), true);
    // `clamped` est lu, pas suivi : seul le clic relance cette étape.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  // Étape 2 : coupure retirée (hauteur finale connue) ou remise (fin de fermeture).
  useLayoutEffect(() => {
    if (clamped) {
      // Avant l'affichage : la coupure prend le relais de la hauteur tenue.
      animationRef.current?.cancel();
      animationRef.current = null;
      return;
    }
    const from = pendingFromRef.current;
    const element = textRef.current;
    if (from === null || !element) return;
    pendingFromRef.current = null;
    animateHeight(from, element.scrollHeight);
     
  }, [clamped]);

  useEffect(() => () => animationRef.current?.cancel(), []);

  return (
    <div className={className}>
      <p ref={textRef} id={textId} className={cn('text-[13px] leading-normal text-white/70', clamped && 'line-clamp-2')}>{text}</p>
      {(overflowing || expanded) && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={textId}
          onClick={() => onExpandedChange(!expanded)}
          className={cn(
            'relative mt-0.5 inline-flex h-7 items-center gap-1 rounded-sm text-xs font-semibold text-white transition-opacity duration-200 hover:opacity-80 motion-reduce:transition-none',
            "before:absolute before:-inset-x-2 before:-inset-y-2 before:content-['']",
            DETAILS_FOCUS,
          )}
        >
          <DetailsLabelSwap swapKey={expanded ? 'less' : 'more'}>
            {expanded ? t('details.seeLess') : t('details.seeMore')}
          </DetailsLabelSwap>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              'size-3.5 transition-transform duration-200 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none',
              expanded && 'rotate-180',
            )}
          />
        </button>
      )}
    </div>
  );
}

/** Ligne d'infos sous le titre : durée et date, puis la note dès 768 px. */
function Meta({ episode, className }: { episode: TvEpisodeItem; className?: string }) {
  const base = episode.meta ?? [];
  const wide = episode.metaWide ?? [];
  return (
    <p className={className}>
      {base.join(' · ')}
      {wide.length > 0 && <span className="hidden md:inline">{base.length > 0 && ' · '}{wide.join(' · ')}</span>}
    </p>
  );
}

const Tags = ({ tags, className }: { tags?: string[]; className?: string }) => (tags && tags.length > 0 ? (
  <span className={cn('flex flex-wrap gap-1.5', className)}>
    {tags.map((tag, index) => <span key={`${tag}-${index}`} className={TAG}>{tag}</span>)}
  </span>
) : null);

/** Carte d'épisode de la vue en grille : vignette, titre, infos, actions et résumé replié. */
export function TvEpisodeCard({ episode, expanded, onExpandedChange, onPlay, onToggleWatched, onToggleWatchlist }: TvEpisodeEntryProps) {
  if (episode.compact) {
    return (
      <li className="min-w-0">
        <button
          type="button"
          onClick={onPlay}
          className={cn(
            'flex h-full min-h-[76px] w-full flex-col justify-center gap-2 rounded-xl border border-white/10 bg-white/[.04] px-4 py-3 text-left hover:bg-white/10',
            episode.selected && cn(CURRENT_OUTLINE, 'outline-offset-[3px]'),
            DETAILS_PRESS,
            DETAILS_FOCUS,
          )}
        >
          <span className="text-[15px] font-semibold leading-[1.35] text-white">{episode.title}</span>
          <Tags tags={episode.tags} />
        </button>
      </li>
    );
  }

  return (
    <li className={cn(EPISODE_HOVER_HOST, 'min-w-0')}>
      <HoverPlate className="-inset-x-4 -bottom-3 -top-4 motion-safe:scale-75" />
      <Thumb episode={episode} onPlay={onPlay} />
      <Title episode={episode} onPlay={onPlay} className="mt-3 text-[15px] font-semibold leading-[1.35] text-white" />
      <div className="mt-0.5 flex min-h-9 items-center justify-between gap-2">
        <Meta episode={episode} className="min-w-0 text-[13px] text-white/55" />
        <div className="-mr-2 flex flex-none items-center">
          <WatchedButton episode={episode} onToggle={onToggleWatched} />
          <ExtraActions episode={episode} onToggleWatchlist={onToggleWatchlist} />
        </div>
      </div>
      <Tags tags={episode.tags} className="mt-1" />
      {episode.overview && (
        <Overview text={episode.overview} expanded={expanded ?? false} onExpandedChange={onExpandedChange} className="mt-0.5" />
      )}
    </li>
  );
}

/**
 * Ligne d'épisode de la vue en liste (la seule sous 768 px). Sous 768 px elle
 * reste compacte : coche et chevron s'empilent à droite, le chevron révèle le
 * résumé et les actions secondaires (déjà ouverts pour l'épisode en cours).
 * Sans résumé, le marque-page prend la place du chevron.
 */
export function TvEpisodeRow({ episode, expanded, onExpandedChange, onPlay, onToggleWatched, onToggleWatchlist }: TvEpisodeEntryProps) {
  const { t } = useTranslation();
  const panelId = useId();

  if (episode.compact) {
    return (
      <li className="border-b border-white/[.08]">
        <button
          type="button"
          onClick={onPlay}
          className={cn(
            'group/row flex min-h-14 w-full items-center gap-3 rounded-lg py-2 text-left hover:bg-white/5 active:bg-white/10',
            'transition-colors duration-200 motion-reduce:transition-none',
            episode.selected && CURRENT_OUTLINE,
            DETAILS_FOCUS,
          )}
        >
          <span className="flex size-9 flex-none items-center justify-center rounded-full border border-white/[.18]">
            <Play aria-hidden="true" className="size-4 fill-current text-white opacity-80 transition-opacity duration-200 group-hover/row:opacity-100 motion-reduce:transition-none" />
          </span>
          <span className="min-w-0 flex-1 text-sm font-semibold leading-[1.3] text-white md:text-[15px]">{episode.title}</span>
          <Tags tags={episode.tags} className="flex-none justify-end" />
        </button>
      </li>
    );
  }

  // Sous 768 px, le chevron ne sert que s'il y a plus qu'un marque-page à
  // montrer : sans résumé, alerte ni pastille « vu ailleurs », le marque-page
  // se range directement sous la coche.
  const phoneCollapsible = Boolean(episode.overview || episode.alert || episode.serverWatched);
  const phoneExpanded = phoneCollapsible && (expanded ?? episode.status === 'current');
  return (
    <li className={cn(EPISODE_HOVER_HOST, 'grid grid-cols-[132px_minmax(0,1fr)_44px] items-center gap-x-3 border-b border-white/[.08] py-[11px] md:grid-cols-[220px_minmax(0,1fr)_auto] md:gap-x-5 md:py-4')}>
      {/* Une ligne est large : partir de 75 % ferait courir la plaque sur des centaines de pixels. */}
      <HoverPlate className="-inset-x-3 -inset-y-1 motion-safe:scale-[0.97] md:-inset-x-4 md:inset-y-0" />
      <Thumb episode={episode} onPlay={onPlay} />
      <div className="min-w-0">
        <Title episode={episode} onPlay={onPlay} clamp className="text-sm font-semibold leading-[1.3] text-white md:text-[15px] md:leading-[1.35]" />
        <Meta episode={episode} className="mt-[3px] min-w-0 text-xs text-white/55 md:text-[13px]" />
        <Tags tags={episode.tags} className="mt-1.5" />
        {episode.overview && (
          <Overview
            text={episode.overview}
            expanded={expanded ?? false}
            onExpandedChange={onExpandedChange}
            className="mt-1.5 hidden max-w-[80ch] md:block"
          />
        )}
      </div>
      {/* Sous 768 px, les actions s'empilent dans la colonne de droite : coche, puis chevron ou marque-page. */}
      <div className="-my-1.5 flex flex-col items-center justify-center md:my-0 md:flex-row md:justify-end">
        <WatchedButton episode={episode} onToggle={onToggleWatched} />
        {phoneCollapsible ? (
          <button
            type="button"
            aria-expanded={phoneExpanded}
            aria-controls={panelId}
            aria-label={phoneExpanded ? t('details.seeLess') : t('details.seeMore')}
            onClick={() => onExpandedChange(!phoneExpanded)}
            className={cn(
              'group/more',
              TV_EPISODE_ACTION_CLASS,
              '[@media(hover:hover)_and_(pointer:fine)]:hover:bg-white/10 md:hidden',
              DETAILS_PRESS,
            )}
          >
            <ChevronDown
              aria-hidden="true"
              className={cn('size-5 text-white opacity-60 transition-transform duration-200 motion-reduce:transition-none', phoneExpanded && 'rotate-180')}
            />
          </button>
        ) : (
          <div className="flex md:hidden">
            <ExtraActions episode={episode} onToggleWatchlist={onToggleWatchlist} />
          </div>
        )}
        <div className="hidden items-center md:flex">
          <ExtraActions episode={episode} onToggleWatchlist={onToggleWatchlist} />
        </div>
      </div>
      {/* Le retrait passe par du padding : une marge ne suivrait pas la hauteur animée. */}
      {phoneCollapsible && (
        <DetailsCollapse open={phoneExpanded} className="col-span-full md:hidden">
          <div id={panelId} className="pt-2.5">
            {episode.overview && <p className="text-[13px] leading-normal text-white/70">{episode.overview}</p>}
            <div className="-mr-2.5 flex items-center justify-end">
              <ExtraActions episode={episode} onToggleWatchlist={onToggleWatchlist} />
            </div>
          </div>
        </DetailsCollapse>
      )}
    </li>
  );
}

export default TvEpisodeCard;
