import { useSyncExternalStore } from 'react';
import { readLocalStorage, writeLocalStorage } from '@/utils/browserStorage';

/**
 * Thème Halloween (Paramètres > Apparence, et citrouille de l'en-tête).
 *
 * Désactivé par défaut, sauf la dernière semaine d'octobre tant que la personne n'a rien choisi : un choix
 * explicite (« 1 » ou « 0 ») l'emporte toute l'année.
 *
 * La classe `halloween-theme` sur <html> redéfinit les variables de couleur
 * lues par Tailwind (voir `tailwind.config.js` et `src/styles/halloween.css`).
 * `main.tsx` la pose avant le premier rendu pour éviter un flash rouge, puis
 * `HalloweenAtmosphere` la tient à jour et la retire sur les lecteurs.
 *
 * Seules ces couleurs sont chargées avec l'application. L'habillage de
 * l'interface et sa police (utils/halloweenThemeAssets.ts) et le décor plein
 * écran ne sont téléchargés que si le thème est actif.
 *
 * Préfixe `settings_` : la préférence suit le compte via /api/sync.
 */
export const HALLOWEEN_THEME_STORAGE_KEY = 'settings_halloween_theme';
export const HALLOWEEN_THEME_CLASS = 'halloween-theme';
/**
 * Posé dès que le réglage est activé, y compris sur les lecteurs où la
 * classe ci-dessus est retirée (pour ne pas teinter le contour des vidéos).
 * Sert à ce qui doit rester habillé là aussi, comme la popup pub.
 */
export const HALLOWEEN_ENABLED_ATTR = 'data-halloween-enabled';
const HALLOWEEN_THEME_EVENT = 'movix:halloween-theme-changed';

/** Octobre, en heure locale : citrouille de l'en-tête et rangée « Spécial Halloween ». */
export const isHalloweenSeason = (date = new Date()): boolean => date.getMonth() === 9;

/** Dernière semaine d'octobre (25 au 31), en heure locale : le thème s'allume tout seul. */
export const isHalloweenWeek = (date = new Date()): boolean =>
  isHalloweenSeason(date) && date.getDate() >= 25;

// Stockage bloqué : le choix reste actif jusqu'au rechargement.
let memoryValue: boolean | null = null;

export const readHalloweenTheme = (): boolean => {
  const stored = readLocalStorage(HALLOWEEN_THEME_STORAGE_KEY);
  if (stored !== null) return stored === '1';
  return memoryValue ?? isHalloweenWeek();
};

export const setHalloweenTheme = (enabled: boolean): void => {
  memoryValue = enabled;
  writeLocalStorage(HALLOWEEN_THEME_STORAGE_KEY, enabled ? '1' : '0');
  window.dispatchEvent(new Event(HALLOWEEN_THEME_EVENT));
};

const subscribe = (sync: () => void) => {
  window.addEventListener('storage', sync);
  window.addEventListener('sync_storage_updated', sync);
  window.addEventListener(HALLOWEEN_THEME_EVENT, sync);
  return () => {
    window.removeEventListener('storage', sync);
    window.removeEventListener('sync_storage_updated', sync);
    window.removeEventListener(HALLOWEEN_THEME_EVENT, sync);
  };
};

export const useHalloweenTheme = () => useSyncExternalStore(subscribe, readHalloweenTheme, () => false);
