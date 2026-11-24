// src/components/watch/loading/WatchLoadingScreen.tsx
//
// Écran de chargement des pages Watch (maquette « Chargement du lecteur »,
// version A avec le radar en liste de la version B).
//
// - La grande image du titre, floue, avec la lueur de sa couleur.
// - Un cadre 16:9 net entre les crochets [ ] de Movix : c'est la place du
//   lecteur. Quand le chargement finit, les crochets s'écartent et le cadre
//   grandit jusqu'à couvrir l'écran, puis s'efface sur le vrai lecteur.
// - Le radar (films et séries) : chaque site et chaque lecteur, en direct, et
//   « Lancer maintenant » pour partir avec ce qui est prêt. Sans radar (anime :
//   une seule source), le cadre reste seul, avec le titre de l'épisode.
//
// L'écran se pose par-dessus la page (`fixed`) : la page peut monter son
// lecteur dessous pendant que les crochets s'ouvrent.
//
// Pour le regarder tranquillement : `?chargement=10` dans l'URL le garde au
// moins 10 secondes (120 au plus). « Lancer maintenant » l'ouvre quand même.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Check, Link2, Loader2, ShieldCheck, Star, X } from 'lucide-react';

import { useMediaColor } from '@/hooks/useMediaColor';
import { cn } from '@/lib/utils';
import { formatDetailsRating } from '@/components/details/format';
import { countPlayable, type RadarPlayer, type RadarSite, type SourceRadar } from './sourceRadar';
import { useRadarSnapshot } from './useSourceRadar';
import Bracket from './Bracket';

interface WatchLoadingScreenProps {
  /** Passe à `false` : les crochets s'ouvrent, puis l'écran disparaît. */
  loading: boolean;
  backdropUrl?: string | null;
  logoUrl?: string | null;
  title: string;
  /** « 2024 · 2 h 46 », « Saison 1 · Épisode 4 »… */
  meta?: string | null;
  /** Titre de l'épisode (séries, anime). */
  subtitle?: string | null;
  /** Genres TMDB, deux au plus affichés (cachés sur téléphone). */
  genres?: string[] | null;
  /** Note TMDB sur 10 ; la page ne la passe que si assez de votes. */
  rating?: number | null;
  /** Phrase d'accroche (films) ; dès 768 px, sous la ligne d'infos. */
  tagline?: string | null;
  /** Message ponctuel de la page (nouvel essai VIP…). */
  statusText?: string | null;
  /** Absent : pas de radar (anime). */
  radar?: SourceRadar;
  onBack?: () => void;
  /**
   * L'écran est-il encore là (crochets compris) ? La page s'en sert pour ne
   * pas ouvrir sa popup pub par-dessus.
   */
  onVisibleChange?: (visible: boolean) => void;
}

type Phase = 'loading' | 'opening' | 'leaving' | 'gone';

const OPEN_MS = 1000;
const LEAVE_MS = 380;
const EASE_OPEN = 'cubic-bezier(.75,0,.2,1)';

/** Durée minimale demandée par `?chargement=<secondes>`, en millisecondes. */
function readHoldMs(): number {
  try {
    const raw = new URLSearchParams(window.location.search).get('chargement');
    const seconds = raw ? Number(raw) : 0;
    return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 120) * 1000 : 0;
  } catch {
    return 0;
  }
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Liste qui défile sans barre de défilement : un fondu en haut et en bas dit
 * qu'il y a plus, seulement du côté où il reste quelque chose à voir.
 * Les fondus passent par des variables CSS posées à la main : pas de rendu
 * React à chaque cran de molette.
 */
const RadarScroll: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const update = () => {
      const top = el.scrollTop > 2;
      const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
      el.style.setProperty('--fade-top', top ? '28px' : '0px');
      el.style.setProperty('--fade-bottom', bottom ? '36px' : '0px');
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    // La liste grandit au fil des réponses des sites.
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    observer?.observe(el);
    if (el.firstElementChild) observer?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, []);

  return (
    <div
      ref={scrollRef}
      className="scrollbar-hide min-h-0 flex-1 overflow-y-auto overscroll-contain [mask-image:linear-gradient(to_bottom,transparent,#000_var(--fade-top,0px),#000_calc(100%_-_var(--fade-bottom,0px)),transparent)]"
    >
      {children}
    </div>
  );
};

const PlayerIcon: React.FC<{ state: RadarPlayer['state'] }> = ({ state }) => {
  switch (state) {
    case 'ready':
      return <Check className="h-3.5 w-3.5 shrink-0 text-emerald-300" strokeWidth={3} aria-hidden="true" />;
    case 'embed':
      return <Link2 className="h-3.5 w-3.5 shrink-0 text-stone-300" strokeWidth={2.2} aria-hidden="true" />;
    case 'failed':
      return <X className="h-3.5 w-3.5 shrink-0 text-stone-500" strokeWidth={2.6} aria-hidden="true" />;
    case 'verifying':
      return <ShieldCheck className="h-3.5 w-3.5 shrink-0 animate-pulse-soft text-stone-200" strokeWidth={2.2} aria-hidden="true" />;
    default:
      return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-stone-200" strokeWidth={2.6} aria-hidden="true" />;
  }
};

interface SiteGroup {
  site: RadarSite;
  players: RadarPlayer[];
}

const RadarList: React.FC<{ groups: SiteGroup[] }> = ({ groups }) => {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-col gap-0.5 text-[13px]">
      {groups.map(({ site, players }) => {
        const found = players.length > 0;
        const empty = site.answered && !found;
        return (
          <li key={site.id} className="mt-2 first:mt-0">
            <div className={cn('flex h-[30px] items-center gap-2.5 transition-opacity duration-300', empty && 'opacity-45')}>
              <span
                aria-hidden="true"
                className={cn('h-2 w-2 shrink-0 rounded-full', !site.answered && 'animate-pulse-soft')}
                style={found
                  ? { background: 'var(--radar-accent)' }
                  : { boxShadow: `inset 0 0 0 1.5px ${site.answered ? '#78716c' : '#e7e5e4'}` }}
              />
              <span className="font-semibold text-stone-50">{site.label}</span>
              {site.admin && <span className="text-[11px] font-semibold text-red-300">{t('watch.loadingScreen.ourLinks')}</span>}
              <span className="ml-auto tabular-nums text-stone-400">
                {!site.answered && !found
                  ? '…'
                  : players.length > 0 ? players.length : t('watch.loadingScreen.nothing')}
              </span>
            </div>
            {found && (
              <ul className="ml-[3px] flex flex-col border-l border-white/10">
                {players.map((player) => (
                  <li
                    key={player.key}
                    className={cn(
                      'flex h-7 items-center gap-2.5 pl-[18px] transition-opacity duration-300 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-left-1',
                      player.state === 'failed' && 'opacity-40',
                    )}
                  >
                    <PlayerIcon state={player.state} />
                    {/* Nom et langue sur la même ligne de base : centrés chacun
                        dans la rangée, « VF » tombait un peu plus bas que le nom. */}
                    <span className="flex min-w-0 items-baseline gap-2.5">
                      <span className={cn('truncate font-medium text-stone-100', player.state === 'failed' && 'line-through')}>{player.host}</span>
                      {player.lang && <span className="shrink-0 text-stone-400">{player.lang}</span>}
                    </span>
                    <span className="ml-auto shrink-0 pl-2 text-xs text-stone-400">
                      {player.state === 'ready' ? '' : t(`watch.loadingScreen.state.${player.state}`)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
};

const WatchLoadingScreen: React.FC<WatchLoadingScreenProps> = ({
  loading, backdropUrl, logoUrl, title, meta, subtitle, genres, rating, tagline, statusText, radar, onBack, onVisibleChange,
}) => {
  const { t, i18n } = useTranslation();
  const [holdMs] = useState(readHoldMs);
  const [held, setHeld] = useState(holdMs > 0);
  const holdTimerRef = useRef<number | null>(null);
  const [phase, setPhase] = useState<Phase>(loading || holdMs > 0 ? 'loading' : 'gone');
  const [frameTransform, setFrameTransform] = useState<string | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const snapshot = useRadarSnapshot(radar);
  const palette = useMediaColor('hero', backdropUrl ?? null, Boolean(backdropUrl), true);
  const accent = palette?.color ?? '#a8a29e';

  useEffect(() => { setLogoFailed(false); }, [logoUrl]);

  // `?chargement=10` : chaque nouveau chargement relance les 10 secondes.
  useEffect(() => {
    if (!holdMs || !loading) return;
    setHeld(true);
    if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current);
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null;
      setHeld(false);
    }, holdMs);
  }, [holdMs, loading]);
  useEffect(() => () => {
    if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current);
  }, []);

  const showLoading = loading || (held && !snapshot.cutoff);

  // Nouveau chargement (épisode suivant…) : l'écran revient, fermé.
  useLayoutEffect(() => {
    if (showLoading) {
      setPhase('loading');
      setFrameTransform(null);
    }
  }, [showLoading]);

  // Fin du chargement : le cadre grandit jusqu'à couvrir l'écran (FLIP).
  useLayoutEffect(() => {
    if (showLoading || phase !== 'loading') return;
    const reduced = prefersReducedMotion();
    const frame = frameRef.current;
    if (frame && !reduced) {
      const rect = frame.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const scale = Math.max(vw / rect.width, vh / rect.height);
        const dx = vw / 2 - (rect.left + rect.width / 2);
        const dy = vh / 2 - (rect.top + rect.height / 2);
        setFrameTransform(`translate3d(${dx}px, ${dy}px, 0) scale(${scale})`);
      }
    }
    setPhase(reduced ? 'leaving' : 'opening');
  }, [showLoading, phase]);

  useEffect(() => {
    if (phase !== 'opening' && phase !== 'leaving') return undefined;
    const delay = phase === 'opening' ? OPEN_MS : LEAVE_MS;
    const timer = window.setTimeout(() => setPhase(phase === 'opening' ? 'leaving' : 'gone'), delay);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    onVisibleChange?.(phase !== 'gone');
  }, [onVisibleChange, phase]);

  const groups = useMemo<SiteGroup[]>(() => snapshot.sites.map((site) => ({
    site,
    players: snapshot.players.filter((player) => player.site === site.id),
  })), [snapshot]);

  if (phase === 'gone') return null;

  const closed = phase === 'loading';
  const playable = countPlayable(snapshot.players);
  const searchingSites = snapshot.sites.filter((site) => !site.answered).length;
  const preparing = snapshot.players.filter((player) => player.state === 'extracting' || player.state === 'verifying').length;
  const allAnswered = snapshot.sites.length > 0 && searchingSites === 0;

  let summary: string;
  if (searchingSites > 0) {
    summary = `${t('watch.loadingScreen.found', { count: snapshot.players.length })} · ${t('watch.loadingScreen.sitesSearching', { count: searchingSites })}`;
  } else if (preparing > 0) {
    summary = `${t('watch.loadingScreen.found', { count: snapshot.players.length })} · ${t('watch.loadingScreen.preparing', { count: preparing })}`;
  } else if (allAnswered && playable === 0) {
    summary = t('watch.loadingScreen.noneFound');
  } else {
    summary = t('watch.loadingScreen.done');
  }

  const canLaunch = !!radar && playable > 0 && !snapshot.cutoff && closed;
  const bracketMove = (side: 'left' | 'right'): React.CSSProperties => ({
    transform: closed ? 'translate3d(0,0,0)' : `translate3d(${side === 'left' ? '-50vw' : '50vw'},0,0)`,
    opacity: closed ? 1 : 0,
    transition: `transform 900ms ${EASE_OPEN}, opacity 600ms ease`,
  });
  const showLogo = Boolean(logoUrl) && !logoFailed;
  const shownGenres = (genres ?? []).filter(Boolean).slice(0, 2);
  const ratingLabel = rating && rating > 0 ? formatDetailsRating(rating, i18n.language) : null;
  const hasInfoLine = Boolean(meta || shownGenres.length > 0 || ratingLabel);

  const frame = (
    <div className="relative w-full self-center">
      <Bracket side="left" style={bracketMove('left')} />
      <Bracket side="right" style={bracketMove('right')} />
      <div
        ref={frameRef}
        className="relative aspect-video w-full overflow-hidden bg-black will-change-transform"
        style={{
          borderRadius: closed ? 16 : 0,
          transform: frameTransform ?? undefined,
          transformOrigin: '50% 50%',
          transition: `transform ${OPEN_MS}ms ${EASE_OPEN}, border-radius ${OPEN_MS}ms ease`,
          boxShadow: closed ? `0 30px 80px -24px ${accent}66, 0 0 0 1px rgba(255,255,255,.08)` : 'none',
        }}
      >
        {backdropUrl && (
          <img
            src={backdropUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            style={{ filter: `brightness(${closed ? 0.5 : 1})`, transition: 'filter 900ms ease' }}
          />
        )}
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center md:gap-4"
          style={{ opacity: closed ? 1 : 0, transition: 'opacity 300ms ease' }}
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-[20%] left-0 h-[140%] w-[38%] motion-reduce:hidden"
            style={{
              background: 'linear-gradient(90deg, transparent, rgba(255,245,230,.10), transparent)',
              animation: 'watch-loading-sweep 3.2s cubic-bezier(.45,0,.2,1) infinite',
            }}
          />
          {showLogo ? (
            <img
              src={logoUrl ?? undefined}
              alt={title}
              onError={() => setLogoFailed(true)}
              className="max-h-[42%] w-auto max-w-[62%] object-contain drop-shadow-[0_4px_24px_rgba(0,0,0,.6)]"
            />
          ) : (
            <span className="text-balance text-2xl font-semibold tracking-tight text-stone-50 md:text-4xl">{title}</span>
          )}
          {radar && hasInfoLine && (
            // Année et durée (ou saison et épisode), genres, puis la note en pastille.
            <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-stone-200 md:text-[13px]">
              {meta && <span>{meta}</span>}
              {shownGenres.length > 0 && (
                <span className="hidden sm:inline">
                  {meta && <span aria-hidden="true" className="mr-2 opacity-50">·</span>}
                  {shownGenres.join(', ')}
                </span>
              )}
              {ratingLabel && (
                <span
                  title={t('details.ratingLabel')}
                  className="inline-flex h-5 items-center gap-1 rounded-full bg-black/40 px-2 font-semibold tabular-nums text-stone-50 ring-1 ring-white/15 md:h-6 md:px-2.5"
                >
                  <Star className="h-3 w-3 fill-amber-300 text-amber-300" aria-hidden="true" />
                  {ratingLabel}
                </span>
              )}
            </div>
          )}
          {subtitle && radar && <span className="line-clamp-1 text-sm font-medium text-stone-100 md:text-base">{subtitle}</span>}
          {tagline && radar && (
            <span className="hidden max-w-[70%] text-balance text-[13px] italic leading-snug text-stone-300 md:line-clamp-2">
              {tagline}
            </span>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-[70] overflow-hidden bg-black text-stone-50"
      style={{
        opacity: phase === 'leaving' ? 0 : 1,
        transition: `opacity ${LEAVE_MS}ms ease`,
        pointerEvents: closed ? 'auto' : 'none',
        ['--radar-accent' as string]: accent,
      }}
    >
      {/* Fond : l'image floue, puis la lueur, puis un voile qui finit en noir franc. */}
      <div aria-hidden="true" className="absolute inset-0" style={{ opacity: closed ? 1 : 0, transition: 'opacity 700ms ease' }}>
        {backdropUrl && (
          <img src={backdropUrl} alt="" className="absolute -inset-16 h-[calc(100%+8rem)] w-[calc(100%+8rem)] max-w-none object-cover opacity-40 blur-3xl saturate-150" />
        )}
        <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse 55% 50% at ${radar ? '36%' : '50%'} 38%, ${accent}55, transparent 70%)` }} />
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 80% 75% at 45% 40%, transparent 30%, #000 92%)' }} />
      </div>

      <div className="relative flex h-full flex-col overflow-y-auto">
        <div className="flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))] md:px-10 md:pt-7" style={{ opacity: closed ? 1 : 0, transition: 'opacity 300ms ease' }}>
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="flex h-11 items-center gap-2 rounded-xl border border-white/10 bg-black/35 px-3 text-sm font-medium text-stone-50 transition-colors hover:bg-white/10 active:scale-[.98] md:pr-4"
            >
              <ArrowLeft className="h-[18px] w-[18px]" aria-hidden="true" />
              <span className="hidden md:inline">{t('watch.loadingScreen.back')}</span>
              <span className="sr-only md:hidden">{t('watch.loadingScreen.back')}</span>
            </button>
          ) : <span />}
        </div>

        {radar ? (
          <div className="mx-auto grid w-full max-w-[1320px] flex-1 grid-cols-1 content-start gap-7 px-[44px] pb-[calc(6.5rem+env(safe-area-inset-bottom))] pt-6 md:px-[84px] lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)] lg:content-center lg:gap-x-24 lg:gap-y-14 lg:pb-10 lg:pt-4">
            {frame}
            <div
              className="-mx-7 flex min-h-0 flex-col gap-5 md:mx-0 lg:max-h-[min(640px,calc(100dvh-140px))]"
              style={{ opacity: closed ? 1 : 0, transform: closed ? 'none' : 'translateY(16px)', transition: 'opacity 350ms ease, transform 500ms ease' }}
            >
              <div role="status" aria-live="polite" className="flex flex-col gap-1">
                <div className="flex items-baseline gap-2.5">
                  <span className="text-[40px] font-semibold leading-none tracking-tight tabular-nums md:text-5xl">{playable}</span>
                  <span className="text-[15px] font-medium text-stone-200 md:text-base">
                    {t('watch.loadingScreen.ready', { count: playable })}
                  </span>
                </div>
                <div className="text-[13px] text-stone-400 tabular-nums">{summary}</div>
                {statusText && <div className="text-[13px] text-amber-200/90">{statusText}</div>}
              </div>
              <RadarScroll>
                <RadarList groups={groups} />
              </RadarScroll>
              <div className="fixed inset-x-4 bottom-[max(1.25rem,env(safe-area-inset-bottom))] lg:static">
                <button
                  type="button"
                  disabled={!canLaunch}
                  onClick={() => radar.triggerCutoff()}
                  className={cn(
                    'flex h-14 w-full items-center justify-between gap-3 rounded-[14px] px-[18px] text-left transition-[background-color,color,transform] duration-200 active:scale-[.98] lg:h-[52px] lg:rounded-xl',
                    canLaunch ? 'bg-stone-50 text-neutral-950 hover:bg-white' : 'bg-white/[.08] text-stone-500',
                  )}
                >
                  <span className="text-[15px] font-semibold">
                    {snapshot.cutoff ? t('watch.loadingScreen.launching') : t('watch.loadingScreen.launchNow')}
                  </span>
                  <span className="truncate text-xs font-medium opacity-65">
                    {playable > 0 ? t('watch.loadingScreen.launchSub', { count: playable }) : t('watch.loadingScreen.launchWaiting')}
                  </span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-[880px] flex-1 flex-col justify-center gap-8 px-[44px] pb-10 md:px-[84px]">
            {frame}
            <div
              className="flex flex-col items-center gap-2 text-center"
              style={{ opacity: closed ? 1 : 0, transition: 'opacity 300ms ease' }}
            >
              {meta && <div className="text-[13px] font-medium tracking-wide text-stone-400">{meta}</div>}
              {subtitle && <div className="text-balance text-xl font-semibold tracking-tight md:text-[26px]">{subtitle}</div>}
              <div role="status" aria-live="polite" className="mt-2 flex items-center gap-2 text-[13px] text-stone-300">
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.6} aria-hidden="true" />
                {statusText || t('watch.loadingScreen.preparingEpisode')}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default WatchLoadingScreen;
