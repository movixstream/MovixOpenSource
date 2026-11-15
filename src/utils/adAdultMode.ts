// Réglage « Publicités +18 » du visiteur : il décide si `/api/go` peut lui
// servir une pub +18 ou seulement une pub SFW (paramètre `sfw=1`). Les URLs des
// régies ne sont plus dans le site : le Main API choisit la pub (onglet
// « Publicités » de l'admin, voir services/monetizationConfig).
//
// Le choix est écrit explicitement ('true' / 'false') pour survivre à un
// changement du défaut. Clé absente = défaut de l'admin (`adultDefault` de la
// config publique).
import { getMonetizationConfig, subscribeToMonetizationConfig } from '../services/monetizationConfig';

export const AD_POPUP_ADULT_KEY = 'settings_ad_popup_adult';
export const AD_POPUP_ADULT_CHANGED_EVENT = 'ad_popup_adult_changed';

export const isAdultAdsEnabled = (): boolean => {
  try {
    const stored = localStorage.getItem(AD_POPUP_ADULT_KEY);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
  } catch { /* localStorage indisponible (navigation privée) : défaut de l'admin. */ }
  return getMonetizationConfig().adultDefault;
};

export const setAdultAdsEnabled = (enabled: boolean): void => {
  try {
    localStorage.setItem(AD_POPUP_ADULT_KEY, enabled ? 'true' : 'false');
    window.dispatchEvent(new CustomEvent(AD_POPUP_ADULT_CHANGED_EVENT, { detail: { enabled } }));
  } catch { /* noop */ }
};

export const subscribeToAdultAdsChanges = (cb: (enabled: boolean) => void): (() => void) => {
  const onCustom = () => cb(isAdultAdsEnabled());
  const onStorage = (e: StorageEvent) => {
    if (e.key === AD_POPUP_ADULT_KEY) cb(isAdultAdsEnabled());
  };
  window.addEventListener(AD_POPUP_ADULT_CHANGED_EVENT, onCustom);
  window.addEventListener('storage', onStorage);
  // Le défaut de l'admin peut changer pendant la visite (config rafraîchie).
  const unsubscribeConfig = subscribeToMonetizationConfig(onCustom);
  return () => {
    window.removeEventListener(AD_POPUP_ADULT_CHANGED_EVENT, onCustom);
    window.removeEventListener('storage', onStorage);
    unsubscribeConfig();
  };
};
