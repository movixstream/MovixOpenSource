import { useEffect } from 'react';
import { isTvBackKey } from '@/utils/tvSpatialNav';

/**
 * Polyfill de la touche Retour de la télécommande.
 *
 * `Escape` est déjà écouté partout dans le SPA (menus, lecteur, `ui/select`).
 * Plutôt que d'ajouter un point d'écoute par composant, on ré-émet un véritable
 * événement `Escape` quand la TV envoie autre chose (webOS `keyCode 461`,
 * Tizen `10009`) — tous les handlers existants fonctionnent alors sans
 * modification.
 *
 * Si le firmware traduit déjà en `Escape`, ce hook ne fait rien : `isTvBackKey`
 * reconnaît `Escape` mais on ne réémet que pour les autres codes, sinon on
 * bouclerait à l'infini.
 */
export function useTvBackKey(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') return; // déjà géré nativement
      if (!isTvBackKey(event)) return;

      event.preventDefault();
      event.stopPropagation();

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

      (document.activeElement ?? document.body).dispatchEvent(synthetic);
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [enabled]);
}

export default useTvBackKey;
