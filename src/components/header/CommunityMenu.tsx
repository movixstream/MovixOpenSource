import React, { useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { useLocation } from 'react-router-dom';
import { Globe, MessagesSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IX_MATRIX_URL, MOVIX_ONLINE_URL } from '@/config/community';
import { getOverlayPortalRoot } from '@/utils/overlayPortal';
import { useIsDesktopNav } from '@/hooks/useIsDesktopNav';
import { HoverHighlight, HoverHighlightItem } from '../ui/hover-highlight';
import { ExploreRow, type ExploreItem } from '../ExploreMenu';
import { MatrixIcon } from '../brand/MatrixIcon';
import { LiquidDropdown, LiquidSheet } from './liquidMenu';
import { useSheetScrollLock } from './useSheetScrollLock';
import { HeaderPanelsContext } from './headerPanels';

/* ─── Menu des canaux officiels ──────────────────────────────────────────────
   Le bouton à côté du logo ouvre un petit menu : Matrix (discussion et
   annonces) et movix.online (adresses à jour). Même liquide que les autres
   menus de l'en-tête, mêmes lignes que le menu Explorer : sur ordinateur, le
   rond du bouton se remplit et coule dans le menu ; sur mobile, il s'étire
   en panneau plein écran. */

// Fond de survol simple du panneau mobile, seulement avec une souris.
const SHEET_HOVER = '[@media(hover:hover)_and_(pointer:fine)]:hover:bg-white/[0.05]';

const CommunityMenu: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const isDesktopNav = useIsDesktopNav();
  const { host: panelHost, onCommunityOpenChange } = useContext(HeaderPanelsContext);
  const menuId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const label = t('header.officialChannels');

  const channels = useMemo<ExploreItem[]>(() => [
    { name: 'Matrix', path: IX_MATRIX_URL, icon: <MatrixIcon className="h-[18px] w-[18px]" />, desc: t('telegram.announcementMatrixDesc'), external: true },
    { name: 'movix.online', path: MOVIX_ONLINE_URL, icon: <Globe className="h-[18px] w-[18px]" />, desc: t('telegram.announcementSiteDesc'), external: true },
  ], [t]);

  const close = useCallback(() => setIsOpen(false), []);

  // Une autre page referme le menu.
  useEffect(() => {
    setIsOpen(false);
  }, [location.pathname]);

  // L'en-tête suit l'ouverture (dégradé et décor, sur mobile) dans la même
  // image que le panneau, comme pour le profil.
  useLayoutEffect(() => {
    onCommunityOpenChange?.(isOpen);
  }, [isOpen, onCommunityOpenChange]);
  useEffect(() => () => onCommunityOpenChange?.(false), [onCommunityOpenChange]);

  // Clic ailleurs : le menu se referme ; Échap le referme et rend le focus au
  // bouton. Menu et panneau sont rendus en portail : leurs clics restent
  // intérieurs.
  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target) || sheetRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setIsOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  useSheetScrollLock(isOpen && !isDesktopNav, scrollerRef);

  return (
    <>
      {/* Rond de 36 px, comme la cloche : le liquide en prend la forme. Sur
          ordinateur, pas d'enfoncement au clic, qui fausserait sa mesure. */}
      <motion.button
        ref={triggerRef}
        type="button"
        data-community-trigger
        aria-label={label}
        title={label}
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        whileTap={isDesktopNav ? undefined : { scale: 0.9 }}
        onClick={() => setIsOpen((open) => !open)}
        className="group pointer-events-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      >
        {/* Couleur pleine et opacité sur l'icône seule : une couleur
            translucide éclaircirait le croisement de ses tracés. */}
        <MessagesSquare
          aria-hidden="true"
          className={cn('h-5 w-5 transition-opacity duration-150 motion-reduce:transition-none', isOpen ? 'opacity-100' : 'opacity-80 group-hover:opacity-100')}
        />
      </motion.button>

      {/* Ordinateur : le menu coule du bouton, dans le calque de l'en-tête,
          calé à gauche de la grille comme le logo. */}
      {panelHost && createPortal(
        <AnimatePresence>
          {isOpen && isDesktopNav && (
            <LiquidDropdown
              key="community-menu"
              id={menuId}
              data-community-menu
              triggerRef={triggerRef}
              containerRef={panelRef}
              triggerRadius={18}
              panelRadius={20}
              neckWidth={16}
              panelClassName="w-72"
            >
              <HoverHighlight className="rounded-xl bg-white/[0.06]">
                <nav aria-label={label} className="p-2">
                  <h4 className="px-3 pb-1.5 pt-2 text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">{label}</h4>
                  <ul>
                    {channels.map((item) => (
                      <HoverHighlightItem key={item.path} itemValue={item.path}>
                        <ExploreRow item={item} active={false} onNavigate={close} />
                      </HoverHighlightItem>
                    ))}
                  </ul>
                </nav>
              </HoverHighlight>
            </LiquidDropdown>
          )}
        </AnimatePresence>,
        panelHost,
      )}

      {/* Mobile et tablette : le rond du bouton s'étire en panneau, porté dans
          la racine des surcouches comme les autres menus. */}
      {createPortal(
        <AnimatePresence>
          {isOpen && !isDesktopNav && (
            <LiquidSheet
              key="community-sheet"
              id={menuId}
              data-community-sheet
              triggerRef={triggerRef}
              triggerRadius={18}
              rootRef={sheetRef}
              scrollerRef={scrollerRef}
              onClose={close}
            >
              <nav aria-label={label}>
                <h3 data-sheet-item className="px-3 pb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">{label}</h3>
                <ul>
                  {channels.map((item) => (
                    <li key={item.path} data-sheet-item>
                      <ExploreRow item={item} active={false} onNavigate={close} hoverClassName={SHEET_HOVER} />
                    </li>
                  ))}
                </ul>
              </nav>
            </LiquidSheet>
          )}
        </AnimatePresence>,
        getOverlayPortalRoot(),
      )}
    </>
  );
};

export default CommunityMenu;
