// État de scroll partagé entre les carousels Embla.
//
// Chaque carousel signale son propre cycle scroll/settle via beginEmblaScroll/
// endEmblaScroll. Un compteur global maintient la classe `body.embla-scrolling`
// tant qu'au moins UN carousel est en mouvement. Cette classe sert de gate CSS
// pour `pointer-events: none` sur les slides — empêche les hover flips quand
// les cards défilent sous le curseur (chaque flip déclenchait un Layerize+Paint).
//
// Le clear est immédiat dès que tous les carousels ont fire leur event 'settle'
// (vélocité retombée à 0) → l'utilisateur peut hover instantanément à la fin
// du scroll, sans timer d'idle.
//
// Note : on n'utilise PAS la classe `body.is-scrolling` qui est gérée par
// SmoothScroll.tsx avec son propre timer pour le scroll vertical (wheel/touch/
// keydown). Les deux classes sont indépendantes — la règle CSS dans index.css
// matche les deux.

let activeEmblaCount = 0;

// Sur certains Chrome Windows (FRONTEND-F7/FD), `document.body.classList.add`
// n'est pas une fonction : une extension remplace le body ou son classList.
// La classe n'est qu'une optimisation de survol, elle ne doit jamais faire
// tomber le carrousel : on vérifie la méthode et on avale toute erreur.
const setEmblaScrollingClass = (active: boolean): void => {
  try {
    const classList = (document.body as HTMLElement | null | undefined)?.classList;
    const method = classList ? (active ? classList.add : classList.remove) : undefined;
    if (typeof method === 'function') method.call(classList, 'embla-scrolling');
  } catch {
    // body altéré : on renonce à la classe, le défilement reste fonctionnel.
  }
};

export const beginEmblaScroll = (): void => {
  if (typeof document === 'undefined') return;
  activeEmblaCount += 1;
  if (activeEmblaCount === 1) setEmblaScrollingClass(true);
};

export const endEmblaScroll = (): void => {
  if (typeof document === 'undefined') return;
  if (activeEmblaCount === 0) return;
  activeEmblaCount -= 1;
  if (activeEmblaCount === 0) setEmblaScrollingClass(false);
};
