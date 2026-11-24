import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { cn } from '@/lib/utils';
import { useMediaColor } from '@/hooks/useMediaColor';
import { DETAILS_GRID, DETAILS_HEADER_HEIGHT } from './layout';
import { sectionNavTint } from './sectionNavTint';
import { scrollToDetailsSection, useActiveSection } from './useActiveSection';

/** Largeur de base du trait ; `scaleX` l'étire à celle du lien. */
const INDICATOR_BASE_WIDTH = 100;

interface IndicatorBox {
  x: number;
  width: number;
  /** Faux à la première mesure et quand la mise en page bouge (fenêtre,
   *  pastille du nombre de commentaires) : le trait s'y place sans glisser. */
  animate: boolean;
}

/**
 * Position du trait sous la section courante, mesurée dans la piste (qui est
 * son `offsetParent`). Il glisse quand la section change, et suit sans
 * animation les changements de largeur des liens.
 */
function useSectionIndicator(track: RefObject<HTMLDivElement>, active: string | null, linksKey: string): IndicatorBox | null {
  const [box, setBox] = useState<IndicatorBox | null>(null);
  useLayoutEffect(() => {
    const element = track.current;
    if (!element) return;
    const measure = (animate: boolean) => {
      const link = element.querySelector<HTMLElement>('[aria-current]');
      setBox((previous) => {
        if (!link) return null;
        const x = link.offsetLeft;
        const width = link.offsetWidth;
        if (previous && previous.x === x && previous.width === width) return previous;
        return { x, width, animate: animate && previous !== null };
      });
    };
    measure(true);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measure(false));
    observer.observe(element);
    element.querySelectorAll('a').forEach((link) => observer.observe(link));
    return () => observer.disconnect();
  }, [track, active, linksKey]);
  return box;
}

/**
 * Vrai quand la barre est collée sous l'en-tête. On observe un repère posé
 * juste au-dessus d'elle : il passe sous l'en-tête dès que la barre le touche.
 *
 * La zone observée part du bas de l'en-tête et n'a pas de limite vers le bas :
 * le repère n'en sort que par le haut. Avec l'écran pour limite, un saut de
 * défilement (touche Fin) depuis le haut d'une fiche à grande image le ferait
 * passer de « sous l'écran » à « au-dessus » sans que l'observateur ne voie
 * rien changer.
 */
function useStuckUnderHeader(marker: RefObject<Element>): boolean {
  // Sans observateur, la barre reste noire : la page ne défile jamais dessous à découvert.
  const [stuck, setStuck] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const element = marker.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => setStuck(!entry.isIntersecting),
      { rootMargin: `-${DETAILS_HEADER_HEIGHT + 1}px 0px 100000px 0px`, threshold: 0 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [marker]);
  return stuck;
}

export interface DetailsSectionLink {
  /** Identifiant DOM de la section visée (celui passé à `DetailsSection`). */
  id: string;
  label: string;
  /** Libellé plus court sous 768 px. */
  shortLabel?: string;
  /** Nombre affiché en pastille après le libellé (commentaires), s'il est connu. */
  count?: number | null;
}

export interface DetailsSectionNavProps {
  /** Sections présentes sur la page, dans l'ordre. */
  sections: DetailsSectionLink[];
  /** Nom accessible de la barre. */
  ariaLabel: string;
  /** Appelé au clic, avant le défilement (ex. déplier une section). */
  onNavigate?: (id: string) => void;
  /** Image de la grande image (`DetailsHero`) : la barre en prend la teinte. */
  backdropUrl?: string | null;
  /** Bandeau qui descend au-dessus des onglets une fois la barre collée (dès 768 px). */
  banner?: DetailsSectionNavBanner;
  className?: string;
}

export interface DetailsSectionNavBanner {
  /** Titre du film ou de la série, coupé s'il est trop long. */
  title: string;
  /** Boutons à droite : `DetailsButton size="bar"`, `LikeDislikeButton compact`, `DetailsBarIconButton`. */
  actions: ReactNode;
}

/**
 * Courbe de tiroir de la descente du bandeau (h-14, onglets décalés de
 * `md:translate-y-14`). Écrite en propriété : avec `tailwindcss-animate`, les
 * classes `ease-[…]` et `duration-[…]` sont ambiguës et Tailwind n'en produit
 * aucune règle.
 */
const BANNER_EASE = '[transition-timing-function:cubic-bezier(0.32,0.72,0,1)]';

/**
 * Barre de sections collée sous l'en-tête. Ses liens sont des ancres : clic =
 * défilement doux, section courante soulignée par un trait qui glisse d'un
 * lien à l'autre. Elle défile à l'horizontale quand elle ne tient pas dans la
 * largeur.
 *
 * Couleur : le trait prend la teinte de la grande image (`sectionNavTint`),
 * avec les réglages Apparence → couleurs du hero ; sans couleur, il est rouge.
 * Fond du bloc collé (en-tête, bandeau, onglets) : l'image du film sous un
 * voile noir à 70 %. Sans image, la teinte sombre, ou du noir.
 *
 * L'en-tête du site est transparent en bas : une fois la barre collée, la page
 * défilait entre les deux. Un fond noir se pose alors derrière l'en-tête, qui
 * ne fait plus qu'un bloc avec la barre.
 *
 * Avant le collage, la barre n'a pas de fond : la grande image de
 * la fiche passe sous les onglets jusqu'au filet, et sa coulure continue
 * dessous (`drip` de `DetailsHeroBackdrop`). Le fond revient au
 * collage, en même temps que celui de l'en-tête.
 *
 * Bandeau (dès 768 px, comme celui de Cinepulse) : au collage, une bande de
 * la même teinte, avec le titre et les boutons principaux, descend de sous
 * l'en-tête et pousse les onglets de sa hauteur. Il est accroché au-dessus de
 * la barre (`bottom-full`) et descend avec elle : un `transform` sur la
 * barre, sans toucher à la mise en page. Les sections gardent leur titre
 * visible grâce à leur `scroll-margin-top` (`DetailsSection`). Sous 768 px,
 * la barre « Regarder » du bas (`DetailsStickyBar`) joue ce rôle.
 */
export function DetailsSectionNav({ sections, ariaLabel, onNavigate, backdropUrl, banner, className }: DetailsSectionNavProps) {
  const active = useActiveSection(sections.map((section) => section.id));
  const trackRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<HTMLDivElement>(null);
  const stuck = useStuckUnderHeader(markerRef);
  const linksKey = sections.map((section) => `${section.id}:${section.count ?? ''}`).join('|');
  const indicator = useSectionIndicator(trackRef, active, linksKey);
  // Mêmes arguments que `DetailsHero` : même calcul, partagé par le cache.
  const palette = useMediaColor('hero', backdropUrl ?? null, Boolean(backdropUrl), true);
  const tint = useMemo(() => sectionNavTint(palette?.color), [palette?.color]);

  // Garde le lien courant visible dans la barre. On ne déplace que la barre :
  // `scrollIntoView` ferait aussi défiler la page. La piste est positionnée :
  // `offsetLeft` du lien s'y mesure directement.
  useEffect(() => {
    const track = trackRef.current;
    const link = track?.querySelector<HTMLElement>('[aria-current]');
    if (!track || !link || track.scrollWidth <= track.clientWidth || typeof track.scrollTo !== 'function') return;
    const left = link.offsetLeft - (track.clientWidth - link.offsetWidth) / 2;
    track.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }, [active]);

  if (sections.length === 0) return null;

  return (
    <>
      {/* Repère du collage ; sous 768 px il porte aussi l'espace au-dessus de
          la barre, pour que son bas reste le haut de la barre. */}
      <div ref={markerRef} aria-hidden="true" className="h-[22px] md:h-0" />
      {/* Fond de l'en-tête : `fixed`, il ne suit pas la barre quand elle se
          décolle. Sous l'en-tête (z-11000), au-dessus de la page. */}
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none fixed inset-x-0 top-0 z-30 h-16 bg-black',
          'transition-opacity duration-200 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none',
          stuck ? 'opacity-100' : 'opacity-0',
        )}
        style={tint ? { backgroundColor: tint.surface } : undefined}
      />
      <nav
        aria-label={ariaLabel}
        className={cn(
          'sticky top-16 z-30 border-b border-white/[.12] bg-black',
          // Courbe de tiroir : le bandeau part vite et se pose en douceur.
          // Animations réduites : le fond change encore, les onglets sautent.
          `transition-[background-color,transform] duration-300 ${BANNER_EASE} motion-reduce:transition-[background-color]`,
          !stuck && 'bg-transparent',
          stuck && banner && 'md:translate-y-14',
          className,
        )}
        style={stuck && tint ? { backgroundColor: tint.surface } : undefined}
      >
        {backdropUrl && (
          // Fond du bloc collé : l'image du film sous un voile noir. Accroché
          // à la barre, il remonte jusqu'en haut de l'écran (en-tête, plus le
          // bandeau dès 768 px) et descend avec elle. Même adresse que la
          // grande image : déjà en cache. Peint avant le bandeau et la piste,
          // il reste dessous sans `z-index`.
          <div
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-x-0 -top-16 bottom-0 overflow-hidden',
              banner && 'md:-top-[120px]',
              'transition-opacity duration-200 motion-reduce:transition-none',
              stuck ? 'opacity-100' : 'opacity-0',
            )}
          >
            <img src={backdropUrl} alt="" decoding="async" className="absolute inset-0 h-full w-full object-cover object-[50%_22%]" />
            <div className="absolute inset-0 bg-black/70" />
          </div>
        )}
        {banner && (
          <div
            aria-hidden={!stuck}
            className={cn(
              // Filet du bas : sépare le titre et les boutons des onglets, comme
              // celui qui borde la barre.
              'absolute inset-x-0 bottom-full hidden h-14 border-b border-white/[.12] md:block',
              !backdropUrl && 'bg-black',
              'transition-[opacity,visibility] duration-200 motion-reduce:transition-none',
              stuck ? 'visible opacity-100' : 'invisible opacity-0',
            )}
            style={!backdropUrl && tint ? { backgroundColor: tint.surface } : undefined}
          >
            <div className={cn(DETAILS_GRID, 'flex h-full items-center gap-6')}>
              <p className="min-w-0 flex-1 truncate text-lg font-semibold text-white">{banner.title}</p>
              <div className="flex flex-none items-center gap-2">{banner.actions}</div>
            </div>
          </div>
        )}
        <div ref={trackRef} className={cn(DETAILS_GRID, 'scrollbar-hide relative flex gap-[22px] overflow-x-auto md:gap-6 lg:gap-8')}>
          {indicator && (
            // Un seul trait pour toute la barre : il glisse par `transform`
            // (pas de `left`/`width`, qui relanceraient la mise en page). Courbe
            // de sortie franche : pendant un défilement il change de cible
            // plusieurs fois, et doit repartir tout de suite à chaque fois.
            <span
              aria-hidden="true"
              className={cn(
                'pointer-events-none absolute bottom-0 left-0 h-0.5 origin-left',
                indicator.animate
                  ? 'transition-[transform,background-color] [transition-duration:250ms] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-[background-color]'
                  : 'transition-[background-color] duration-200',
              )}
              style={{
                width: INDICATOR_BASE_WIDTH,
                transform: `translateX(${indicator.x}px) scaleX(${indicator.width / INDICATOR_BASE_WIDTH})`,
                backgroundColor: tint?.line ?? '#dc2626',
              }}
            />
          )}
          {sections.map((section) => {
            const isActive = section.id === active;
            return (
              <a
                key={section.id}
                href={`#${section.id}`}
                aria-current={isActive ? 'location' : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  onNavigate?.(section.id);
                  scrollToDetailsSection(section.id);
                }}
                className={cn(
                  'inline-flex h-12 flex-none items-center gap-1.5 whitespace-nowrap border-b-2 text-sm font-medium transition-colors duration-200 motion-reduce:transition-none md:h-14 md:gap-2 md:text-[15px]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white',
                  // Bordure transparente : elle garde la hauteur du texte, le
                  // trait coloré est dessiné à part et glisse dessus.
                  'border-transparent',
                  isActive ? 'text-white' : 'text-white/60 hover:text-white',
                )}
              >
                {section.shortLabel ? (
                  <>
                    <span className="md:hidden">{section.shortLabel}</span>
                    <span className="hidden md:inline">{section.label}</span>
                  </>
                ) : section.label}
                {typeof section.count === 'number' && (
                  <span className="rounded-full bg-white/[.12] px-1.5 py-px text-[11px] text-white/80 md:px-[7px] md:text-xs">
                    {section.count}
                  </span>
                )}
              </a>
            );
          })}
        </div>
      </nav>
    </>
  );
}

export default DetailsSectionNav;
