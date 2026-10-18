import { useEffect } from 'react';
import {
  directionFromKey,
  getVisibleFocusables,
  isTvSpatialNavSuppressed,
  pickBestCandidate,
  TV_SCROLL_STEP_RATIO,
  type Direction,
} from '@/utils/tvSpatialNav';

/**
 * Amène l'élément focalisé à l'écran. En vertical on centre la rangée : avec
 * `nearest`, elle se collait au bord haut, sous le header fixe.
 */
function revealFocused(el: HTMLElement, direction: Direction | null): void {
  const vertical = direction === 'up' || direction === 'down';
  el.scrollIntoView({ block: vertical ? 'center' : 'nearest', inline: 'nearest' });
}

/**
 * Aucun élément atteignable : on fait défiler la page nous-mêmes. On ne compte
 * pas sur le scroll natif des flèches — il n'agit que sur le conteneur
 * scrollable de l'élément focalisé, et rien ne bouge quand ce n'est pas le
 * document (ou quand le focus est sur un élément sorti de l'écran).
 */
function scrollPage(direction: Direction): boolean {
  if (direction !== 'up' && direction !== 'down') return false;
  const step = window.innerHeight * TV_SCROLL_STEP_RATIO;
  window.scrollBy(0, direction === 'down' ? step : -step);
  return true;
}

/**
 * Branche la navigation directionnelle globale. Appelé une seule fois, depuis
 * `App.tsx`, avec `isTvPlatform()` : hors TV, aucun listener n'est posé.
 *
 * Le listener est en phase **capture** pour passer avant les handlers de page,
 * mais il sort immédiatement si un lecteur a réservé les flèches
 * (`suppressTvSpatialNav`) — l'événement remonte alors intact et le
 * comportement desktop/mobile existant n'est pas modifié.
 */
export function useTvSpatialNav(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (isTvSpatialNavSuppressed()) return;

      const direction = directionFromKey(event.key);
      if (!direction) return;

      const active = document.activeElement;

      // Champs de saisie et éléments à valeur : les flèches leur appartiennent
      // (curseur de texte, slider de volume, <select> ouvert).
      if (active instanceof HTMLElement) {
        const tag = active.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (active.isContentEditable) return;
      }

      const focusables = getVisibleFocusables();
      if (focusables.length === 0) {
        if (scrollPage(direction)) event.preventDefault();
        return;
      }

      // Aucun focus (arrivée sur une page, ou focus perdu après un démontage) :
      // on prend le premier candidat visible plutôt que de ne rien faire.
      if (!(active instanceof HTMLElement) || active === document.body) {
        event.preventDefault();
        focusables[0].el.focus();
        revealFocused(focusables[0].el, null);
        return;
      }

      const originRect = active.getBoundingClientRect();
      const candidates = focusables.filter((candidate) => candidate.el !== active);
      const best = pickBestCandidate(
        {
          left: originRect.left,
          top: originRect.top,
          right: originRect.right,
          bottom: originRect.bottom,
        },
        candidates,
        direction
      );

      if (!best) {
        // Bord de la zone de recherche (bas d'une longue page, bloc de texte
        // sans lien) : on défile pour faire apparaître la suite.
        if (scrollPage(direction)) event.preventDefault();
        return;
      }

      event.preventDefault();
      // `preventScroll` : sans lui, Chromium saute brutalement à l'élément
      // avant que `scrollIntoView` ne le recentre.
      best.el.focus({ preventScroll: true });
      revealFocused(best.el, direction);
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [enabled]);
}

export default useTvSpatialNav;
