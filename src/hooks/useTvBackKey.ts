import { useEffect } from 'react';
import { isTvBackKey, resolveTvBackAction } from '@/utils/tvSpatialNav';

/**
 * Surfaces qui se ferment avec `Escape` : modales Radix/shadcn, menus,
 * listes déroulantes, popovers. Une modale maison sans rôle ARIA n'est pas
 * détectée — Retour fera alors « page précédente », ce qui la ferme aussi
 * puisqu'elle est démontée avec la page.
 */
const OPEN_SURFACE_SELECTOR = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[aria-modal="true"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[data-radix-popper-content-wrapper]',
].join(', ');

function hasOpenSurface(): boolean {
  const doc = document as Document & { webkitFullscreenElement?: Element | null };
  if (doc.fullscreenElement || doc.webkitFullscreenElement) return true;

  const surfaces = document.querySelectorAll<HTMLElement>(OPEN_SURFACE_SELECTOR);
  for (let i = 0; i < surfaces.length; i += 1) {
    const rect = surfaces[i].getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return true;
  }
  return false;
}

function isEditingText(active: Element | null): active is HTMLElement {
  if (!(active instanceof HTMLElement)) return false;
  const tag = active.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || active.isContentEditable;
}

/**
 * `BrowserRouter` (react-router 6) range l'index de l'entrée courante dans
 * `history.state.idx` : 0 = premier écran de la session, rien derrière. Le
 * chargeur webOS fait un `location.replace`, il n'occupe donc aucune entrée.
 */
function canGoBack(): boolean {
  const state = window.history.state as { idx?: unknown } | null;
  return typeof state?.idx === 'number' && state.idx > 0;
}

// Les `Escape` que l'on réémet repassent par notre propre listener (capture
// sur `document`) : on les marque pour ne pas les retraiter.
const synthesized = new WeakSet<Event>();

function dispatchEscape(): void {
  const synthetic = new KeyboardEvent('keydown', {
    key: 'Escape',
    code: 'Escape',
    bubbles: true,
    cancelable: true,
  });

  // `keyCode` n'est pas accepté par le constructeur (il est déprécié et
  // ignoré du dictionnaire d'init) alors que du code du repo le lit encore.
  // On le repose à la main pour que les deux styles de handler marchent.
  Object.defineProperty(synthetic, 'keyCode', { value: 27 });
  Object.defineProperty(synthetic, 'which', { value: 27 });

  synthesized.add(synthetic);
  (document.activeElement ?? document.body).dispatchEvent(synthetic);
}

/**
 * Touche Retour de la télécommande (webOS `keyCode 461`, Tizen `10009`, ou
 * `Escape` si le firmware traduit déjà).
 *
 * `appinfo.json` désactive la gestion native (`disableBackHistoryAPI`), donc
 * tout passe par ici : fermer la surface ouverte, sinon sortir du champ de
 * saisie, sinon page précédente, sinon quitter l'app (voir
 * `resolveTvBackAction`).
 */
export function useTvBackKey(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (synthesized.has(event)) return;
      if (!isTvBackKey(event)) return;

      const active = document.activeElement;
      const action = resolveTvBackAction({
        hasOpenSurface: hasOpenSurface(),
        isEditingText: isEditingText(active),
        canGoBack: canGoBack(),
      });

      if (action === 'escape') {
        // Un vrai `Escape` venu du firmware suit son cours jusqu'aux handlers.
        if (event.key === 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        dispatchEscape();
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (action === 'blur') {
        (active as HTMLElement).blur();
      } else if (action === 'back') {
        window.history.back();
      } else {
        // Ferme l'application web sur webOS ; sans effet dans un onglet de
        // navigateur ouvert à la main (dev avec `?platform=tv`).
        window.close();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [enabled]);
}

export default useTvBackKey;
