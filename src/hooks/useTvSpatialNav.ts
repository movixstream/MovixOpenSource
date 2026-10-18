import { useEffect } from 'react';
import {
  directionFromKey,
  getVisibleFocusables,
  isTvSpatialNavSuppressed,
  pickBestCandidate,
} from '@/utils/tvSpatialNav';

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
      if (focusables.length === 0) return;

      // Aucun focus (arrivée sur une page, ou focus perdu après un démontage) :
      // on prend le premier candidat visible plutôt que de ne rien faire.
      if (!(active instanceof HTMLElement) || active === document.body) {
        event.preventDefault();
        focusables[0].el.focus();
        focusables[0].el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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

      if (!best) return; // Bord de l'écran : on laisse le scroll natif agir.

      event.preventDefault();
      best.el.focus();
      best.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [enabled]);
}

export default useTvSpatialNav;
