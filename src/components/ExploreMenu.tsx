import React from 'react';
import { ArrowUpRight } from 'lucide-react';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { HoverHighlight, HoverHighlightItem } from './ui/hover-highlight';
import { LiquidDropdown, LiquidSheet } from './header/liquidMenu';

/* ─── Menu Explorer ──────────────────────────────────────────────────────────
   Le menu sort du bouton qui l'ouvre, comme un liquide : sur mobile, le rond
   du bouton s'étire jusqu'au panneau ; sur ordinateur, le bouton se remplit
   et coule dans le menu, auquel il reste collé. À la fermeture, tout rentre
   dans le bouton. Le moteur est partagé avec les menus profil et
   notifications (header/liquidMenu). Pas de grille, pas de halo, une seule
   couleur d'icône : le rouge du site ne marque que la page en cours. */

export interface ExploreItem {
  name: string;
  path: string;
  icon: React.ReactNode;
  desc: string;
  external?: boolean;
}

export interface ExploreGroup {
  title: string;
  items: ExploreItem[];
}

export interface ExploreMainItem {
  name: string;
  path: string;
  isActive: boolean;
}

const isActivePath = (pathname: string, item: ExploreItem) =>
  !item.external && (pathname === item.path || pathname.startsWith(`${item.path}/`));

/** Deux traits qui pivotent en croix : le bouton reste en place, seul le dessin change.
    L'opacité porte sur l'ensemble : des traits translucides éclairciraient leur croisement.
    Calques permanents (will-change) : leur rotation ne crée ni ne retire de calque dans
    l'en-tête, à l'ouverture comme à la fermeture du panneau. */
export const BurgerIcon: React.FC<{ open: boolean }> = ({ open }) => (
  <span aria-hidden="true" className="relative block h-3.5 w-5 opacity-80 transition-opacity group-hover:opacity-100">
    <span
      className={`absolute inset-x-0 top-[3px] h-[1.5px] rounded-full bg-current will-change-transform transition-transform duration-[250ms] ease-[cubic-bezier(0.77,0,0.175,1)] motion-reduce:transition-none ${
        open ? 'translate-y-[3.25px] rotate-45' : ''
      }`}
    />
    <span
      className={`absolute inset-x-0 bottom-[3px] h-[1.5px] rounded-full bg-current will-change-transform transition-transform duration-[250ms] ease-[cubic-bezier(0.77,0,0.175,1)] motion-reduce:transition-none ${
        open ? '-translate-y-[3.25px] -rotate-45' : ''
      }`}
    />
  </span>
);

interface ExploreRowProps {
  item: ExploreItem;
  active: boolean;
  onNavigate: () => void;
  /** Fond de survol, quand la liste n'a pas de HoverHighlight. */
  hoverClassName?: string;
}

const ExploreRow: React.FC<ExploreRowProps> = ({ item, active, onNavigate, hoverClassName = '' }) => {
  const className = `group flex items-center gap-3 rounded-xl px-3 py-2.5 outline-none transition-colors duration-150 active:bg-white/[0.07] focus-visible:ring-1 focus-visible:ring-white/25 ${hoverClassName} ${
    active ? 'bg-white/[0.04]' : ''
  }`;
  const body = (
    <>
      {/* Couleur pleine et opacité sur l'icône seule : une couleur translucide
          éclaircirait les croisements de ses tracés. Icône centrée sur le
          bloc titre + description, svg en bloc : en ligne, il se posait sur
          la ligne de base d'une ligne de texte invisible, qui le remontait. */}
      <span className={`flex shrink-0 items-center [&>svg]:block transition-[color,opacity] duration-150 ${active ? 'text-red-400' : 'text-white opacity-45 group-hover:opacity-90'}`}>
        {item.icon}
      </span>
      <span className="min-w-0">
        <span className={`flex items-center gap-1 text-[15px] font-medium leading-5 lg:text-sm ${active ? 'text-white' : 'text-white/85'}`}>
          {item.name}
          {item.external && <ArrowUpRight size={13} className="shrink-0 text-white opacity-30" />}
        </span>
        <span className="mt-0.5 block truncate text-[12.5px] leading-4 text-white/40 lg:text-xs">{item.desc}</span>
      </span>
    </>
  );

  if (item.external) {
    return (
      <a href={item.path} target="_blank" rel="noopener noreferrer" onClick={onNavigate} className={className}>
        {body}
      </a>
    );
  }
  return (
    <Link to={item.path} onClick={onNavigate} aria-current={active ? 'page' : undefined} className={className}>
      {body}
    </Link>
  );
};

interface ExploreDesktopPanelProps {
  groups: ExploreGroup[];
  pathname: string;
  label: string;
  triggerRef: React.RefObject<HTMLElement>;
  containerRef: React.RefObject<HTMLDivElement>;
  onNavigate: () => void;
}

/**
 * Menu déroulant d'ordinateur : le bouton Explorer se remplit et coule dans
 * un panneau aussi large que le cadre du HeroSlider. Doit rester sous un
 * AnimatePresence (voir LiquidDropdown).
 */
export const ExploreDesktopPanel: React.FC<ExploreDesktopPanelProps> = ({
  groups, pathname, label, triggerRef, containerRef, onNavigate,
}) => (
  // Coins du bouton : rounded-lg ; coins du panneau : rounded-3xl, comme le
  // cadre du HeroSlider.
  <LiquidDropdown data-explore-menu triggerRef={triggerRef} containerRef={containerRef} triggerRadius={8} panelRadius={24}>
    {/* Au survol, un même fond glisse de rangée en rangée, d'une colonne à
        l'autre, au lieu que chaque rangée s'allume seule. */}
    <HoverHighlight className="rounded-xl bg-white/[0.06]">
      <nav id="explore-menu" aria-label={label} className="grid grid-cols-5 gap-4 p-5 xl:gap-6 xl:p-6">
        {groups.map((group) => (
          <section key={group.title}>
            <h4 data-explore-group-title className="mb-1.5 px-3 text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">
              {group.title}
            </h4>
            <ul>
              {group.items.map((item) => (
                <HoverHighlightItem key={item.path} itemValue={item.path}>
                  <ExploreRow item={item} active={isActivePath(pathname, item)} onNavigate={onNavigate} />
                </HoverHighlightItem>
              ))}
            </ul>
          </section>
        ))}
      </nav>
    </HoverHighlight>
  </LiquidDropdown>
);

interface ExploreMobileSheetProps {
  groups: ExploreGroup[];
  mainItems: ExploreMainItem[];
  pathname: string;
  label: string;
  triggerRef: React.RefObject<HTMLElement>;
  rootRef: React.RefObject<HTMLDivElement>;
  scrollerRef: React.RefObject<HTMLDivElement>;
  onClose: () => void;
}

/**
 * Panneau mobile : le rond du bouton menu (36 px) s'étire en panneau plein
 * écran. Doit rester sous un AnimatePresence (voir LiquidSheet).
 */
export const ExploreMobileSheet: React.FC<ExploreMobileSheetProps> = ({
  groups, mainItems, pathname, label, triggerRef, rootRef, scrollerRef, onClose,
}) => (
  <LiquidSheet triggerRef={triggerRef} triggerRadius={18} rootRef={rootRef} scrollerRef={scrollerRef} onClose={onClose}>
    <nav id="explore-menu" aria-label={label}>
      <ul>
        {mainItems.map((item) => (
          <li key={item.path} data-sheet-item>
            <Link
              to={item.path}
              onClick={onClose}
              aria-current={item.isActive ? 'page' : undefined}
              className={`flex items-center gap-2.5 rounded-2xl px-3 text-[28px] font-semibold leading-[44px] tracking-[-0.02em] outline-none transition-colors duration-150 active:bg-white/[0.06] focus-visible:bg-white/[0.07] ${
                item.isActive ? 'text-white' : 'text-white/75'
              }`}
            >
              <span>{item.name}</span>
              {item.isActive && <span aria-hidden="true" className="h-2 w-2 rounded-full bg-red-500" />}
            </Link>
          </li>
        ))}
      </ul>
      <div data-sheet-item aria-hidden="true" className="mx-3 my-4 h-px bg-white/[0.07]" />
      {/* Deux colonnes dès que la largeur le permet (tablette). */}
      <div className="sm:grid sm:grid-cols-2 sm:gap-x-6">
        {groups.map((group) => (
          <section key={group.title} className="mb-4">
            <h3
              data-sheet-item
              data-explore-group-title
              className="px-3 pb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-white/35"
            >
              {group.title}
            </h3>
            <ul>
              {group.items.map((item) => (
                <li key={item.path} data-sheet-item>
                  {/* Panneau mobile : fond de survol simple, seulement avec
                      une souris (fenêtre étroite sur ordinateur). */}
                  <ExploreRow
                    item={item}
                    active={isActivePath(pathname, item)}
                    onNavigate={onClose}
                    hoverClassName="[@media(hover:hover)_and_(pointer:fine)]:hover:bg-white/[0.05]"
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </nav>
  </LiquidSheet>
);
