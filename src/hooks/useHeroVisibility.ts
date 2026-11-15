import { useSyncExternalStore } from 'react';

const readHidden = () => {
  try { return localStorage.getItem('settings_hide_hero') === 'true'; } catch { return false; }
};

const subscribe = (sync: () => void) => {
  window.addEventListener('storage', sync);
  window.addEventListener('sync_storage_updated', sync);
  window.addEventListener('hero_visibility_changed', sync);
  return () => {
    window.removeEventListener('storage', sync);
    window.removeEventListener('sync_storage_updated', sync);
    window.removeEventListener('hero_visibility_changed', sync);
  };
};

export const useHeroHidden = () => useSyncExternalStore(subscribe, readHidden, () => false);
