import { createContext } from 'react';

/** Ce que l'en-tête prête aux menus qui coulent de ses boutons. */
export interface HeaderPanels {
  /** Calque de l'en-tête où se rendent les menus déroulants d'ordinateur,
      sous la ligne d'icônes : le liquide passe sous le bouton qu'il remplit. */
  host: HTMLElement | null;
  /** Le menu profil signale son ouverture : sur mobile, l'en-tête efface son
      dégradé et fige le décor pendant que le panneau couvre la page. */
  onProfileOpenChange?: (open: boolean) => void;
}

export const HeaderPanelsContext = createContext<HeaderPanels>({ host: null });
