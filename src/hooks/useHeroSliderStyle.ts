import { useSyncExternalStore } from 'react';

export type HeroSliderStyle = 'classic' | 'morph';

const STORAGE_KEY = 'settings_hero_slider_style';
const CHANGE_EVENT = 'hero_slider_style_changed';
const SPEED_STORAGE_KEY = 'settings_hero_morph_speed';
const SPEED_CHANGE_EVENT = 'hero_morph_speed_changed';
export const MORPH_SPEED_MIN = 0.5;
export const MORPH_SPEED_MAX = 3;
export const MORPH_SPEED_STEP = 0.25;
const MORPH_SPEED_DEFAULT = 2;
const getDefaultStyle = (): HeroSliderStyle => 'classic';
const getDefaultSpeed = () => MORPH_SPEED_DEFAULT;

const normalizeSpeed = (speed: number) => Math.round(
  Math.max(MORPH_SPEED_MIN, Math.min(MORPH_SPEED_MAX, speed)) / MORPH_SPEED_STEP,
) * MORPH_SPEED_STEP;

const readSpeed = (): number => {
  try {
    const value = Number(localStorage.getItem(SPEED_STORAGE_KEY));
    return Number.isFinite(value) && value >= MORPH_SPEED_MIN && value <= MORPH_SPEED_MAX
      ? normalizeSpeed(value) : MORPH_SPEED_DEFAULT;
  } catch {
    return MORPH_SPEED_DEFAULT;
  }
};

export const setHeroMorphSpeed = (speed: number): boolean => {
  if (!Number.isFinite(speed)) return false;
  try {
    localStorage.setItem(SPEED_STORAGE_KEY, String(normalizeSpeed(speed)));
    window.dispatchEvent(new Event(SPEED_CHANGE_EVENT));
    return true;
  } catch {
    return false;
  }
};

const readStyle = (): HeroSliderStyle => {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'morph' ? 'morph' : 'classic';
  } catch {
    return 'classic';
  }
};

export const setHeroSliderStyle = (style: HeroSliderStyle): boolean => {
  try {
    localStorage.setItem(STORAGE_KEY, style);
    window.dispatchEvent(new Event(CHANGE_EVENT));
    return true;
  } catch {
    return false;
  }
};

const subscribe = (sync: () => void) => {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === SPEED_STORAGE_KEY || event.key === null) sync();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener('sync_storage_updated', sync);
  window.addEventListener(CHANGE_EVENT, sync);
  window.addEventListener(SPEED_CHANGE_EVENT, sync);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('sync_storage_updated', sync);
    window.removeEventListener(CHANGE_EVENT, sync);
    window.removeEventListener(SPEED_CHANGE_EVENT, sync);
  };
};

export const useHeroSliderStyle = () => useSyncExternalStore(subscribe, readStyle, getDefaultStyle);
export const useHeroMorphSpeed = () => useSyncExternalStore(subscribe, readSpeed, getDefaultSpeed);
