import { useCallback, useEffect, useRef, useState } from 'react';
import { DETAILS_HEADER_HEIGHT } from './layout';
import { scrollToDetailsSection } from './useActiveSection';

/** Sections qui se déplient sur place avec « Tout voir ». */
export type DetailsExpandableSection = 'cast' | 'media' | 'details';

const ALL_FOLDED: Record<DetailsExpandableSection, boolean> = { cast: false, media: false, details: false };

/**
 * Haut de l'élément visible à l'écran, sous l'en-tête fixe et la barre de
 * sections (marge de 48 px pour cette barre).
 */
function isTopOnScreen(id: string): boolean {
  const element = document.getElementById(id);
  if (!element) return true;
  // Le titre commence sous l'espace du haut de la section.
  const top = element.getBoundingClientRect().top + (parseFloat(getComputedStyle(element).paddingTop) || 0);
  return top >= DETAILS_HEADER_HEIGHT && top <= window.innerHeight - 48;
}

/**
 * Une seule page : chaque section montre un aperçu et se déplie sur place.
 * La page ne défile que si l'ancre voulue est hors de l'écran une fois le
 * nouveau contenu rendu : déplier depuis le titre de la section garde la vue
 * en place, ouvrir les images (plus bas) ou replier une longue section
 * ramène à l'endroit voulu.
 */
export function useExpandableSections() {
  const [expanded, setExpanded] = useState(ALL_FOLDED);
  // Ancre à rejoindre une fois le contenu déplié rendu.
  const pendingScrollRef = useRef<string | null>(null);

  const setSectionExpanded = useCallback((section: DetailsExpandableSection, open: boolean, anchor: string) => {
    pendingScrollRef.current = anchor;
    setExpanded((previous) => ({ ...previous, [section]: open }));
  }, []);

  const foldAll = useCallback(() => setExpanded(ALL_FOLDED), []);

  useEffect(() => {
    const anchor = pendingScrollRef.current;
    if (!anchor) return;
    pendingScrollRef.current = null;
    if (!isTopOnScreen(anchor)) scrollToDetailsSection(anchor);
  }, [expanded]);

  return { expanded, setSectionExpanded, foldAll };
}
