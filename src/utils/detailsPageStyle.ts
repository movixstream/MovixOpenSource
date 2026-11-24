import { useSyncExternalStore } from 'react';
import { readLocalStorage, writeLocalStorage } from './browserStorage';

/**
 * Style des fiches film et série, choisi dans les paramètres :
 * - `modern` : la fiche sur une seule page (grande image, sections) ;
 * - `classic` : l'ancienne fiche à onglets.
 */
export type DetailsPageStyle = 'modern' | 'classic';

export const DETAILS_PAGE_STYLE_KEY = 'settings_details_page_style';
const CHANGE_EVENT = 'details_page_style_changed';

export function getDetailsPageStyle(): DetailsPageStyle {
  return readLocalStorage(DETAILS_PAGE_STYLE_KEY) === 'classic' ? 'classic' : 'modern';
}

export function setDetailsPageStyle(style: DetailsPageStyle): void {
  writeLocalStorage(DETAILS_PAGE_STYLE_KEY, style);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

const subscribe = (onChange: () => void) => {
  const onStorage = (event: StorageEvent) => {
    if (event.key === DETAILS_PAGE_STYLE_KEY) onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
};

/** Style courant, mis à jour dès qu'il change (même onglet ou autre onglet). */
export function useDetailsPageStyle(): DetailsPageStyle {
  return useSyncExternalStore(subscribe, getDetailsPageStyle, () => 'modern');
}
