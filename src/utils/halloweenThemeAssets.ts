/**
 * Chargement à la demande de l'habillage du thème Halloween : la feuille
 * halloween-ui.css (cadres, en-tête, titres…) et la police des titres.
 *
 * Module à part du hook useHalloweenTheme, que l'en-tête et les fonds
 * importent : eux n'ont besoin que de savoir si le thème est actif, pas
 * d'embarquer ce chargement ni la feuille qu'il désigne.
 */
const FONT_LINK_ID = 'halloween-font';
const FONT_URL = 'https://fonts.googleapis.com/css2?family=Creepster&display=swap';

let requested = false;

/**
 * Lance, une seule fois, le chargement de l'habillage et de la police.
 * Appelé au démarrage si le thème est déjà actif (en parallèle du reste de
 * l'application), ou quand on l'active.
 */
export const loadHalloweenTheme = (): void => {
  if (requested) return;
  requested = true;
  import('@/styles/halloween-ui.css').catch(() => {
    // Réseau coupé : on retentera à la prochaine activation.
    requested = false;
  });
  if (!document.getElementById(FONT_LINK_ID)) {
    const link = document.createElement('link');
    link.id = FONT_LINK_ID;
    link.rel = 'stylesheet';
    link.href = FONT_URL;
    document.head.appendChild(link);
  }
};
