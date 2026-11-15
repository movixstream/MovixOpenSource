import { useSyncExternalStore } from 'react';
import {
  DEFAULT_HERO_GRADIENT_POSITION,
  DEFAULT_MEDIA_COLOR_ALGORITHM,
  HERO_GRADIENT_POSITIONS,
  isMediaColorAlgorithm,
  normalizeMediaColor,
  type HeroGradientPosition,
  type MediaColorAlgorithm,
} from '@/utils/mediaColors';

export type MediaColorMode = 'off' | 'auto' | 'fixed';
export type MediaColorTarget = 'hero' | 'cards';
export interface MediaColorSettings {
  heroMode: MediaColorMode;
  cardsMode: MediaColorMode;
  heroAlgorithm: MediaColorAlgorithm;
  cardsAlgorithm: MediaColorAlgorithm;
  heroColor: string;
  cardsColor: string;
  sharedFixedColor: boolean;
  heroGradientPosition: HeroGradientPosition;
  heroBaseGradient: boolean;
  cardsBaseGradient: boolean;
  heroIgnoreLightBackgrounds: boolean;
  cardsIgnoreLightBackgrounds: boolean;
}

const STORAGE_KEY = 'settings_media_colors';
const CHANGE_EVENT = 'media_colors_changed';
const DEFAULTS: MediaColorSettings = Object.freeze({
  heroMode: 'auto', cardsMode: 'auto',
  heroAlgorithm: DEFAULT_MEDIA_COLOR_ALGORITHM, cardsAlgorithm: DEFAULT_MEDIA_COLOR_ALGORITHM,
  heroColor: '#b33838', cardsColor: '#b33838', sharedFixedColor: false,
  heroGradientPosition: DEFAULT_HERO_GRADIENT_POSITION,
  heroBaseGradient: true,
  cardsBaseGradient: true,
  heroIgnoreLightBackgrounds: true,
  cardsIgnoreLightBackgrounds: true,
});
const getDefaults = () => DEFAULTS;
let lastRaw: string | null | undefined;
let snapshot = DEFAULTS;

const normalizeMode = (value: unknown, fallback: MediaColorMode): MediaColorMode =>
  value === 'off' || value === 'auto' || value === 'fixed' ? value : fallback;

const normalizeHeroGradientPosition = (value: unknown): HeroGradientPosition =>
  typeof value === 'string' && (HERO_GRADIENT_POSITIONS as readonly string[]).includes(value)
    ? (value as HeroGradientPosition)
    : DEFAULTS.heroGradientPosition;

function normalizeSettings(value: unknown): MediaColorSettings {
  if (!value || typeof value !== 'object') return DEFAULTS;
  const raw = value as Partial<MediaColorSettings>;
  const heroColor = normalizeMediaColor(raw.heroColor) ?? DEFAULTS.heroColor;
  const sharedFixedColor = raw.sharedFixedColor === true;
  return {
    heroMode: sharedFixedColor ? 'fixed' : normalizeMode(raw.heroMode, DEFAULTS.heroMode),
    cardsMode: sharedFixedColor ? 'fixed' : normalizeMode(raw.cardsMode, DEFAULTS.cardsMode),
    heroAlgorithm: isMediaColorAlgorithm(raw.heroAlgorithm) ? raw.heroAlgorithm : DEFAULTS.heroAlgorithm,
    cardsAlgorithm: isMediaColorAlgorithm(raw.cardsAlgorithm) ? raw.cardsAlgorithm : DEFAULTS.cardsAlgorithm,
    heroColor,
    cardsColor: sharedFixedColor ? heroColor : normalizeMediaColor(raw.cardsColor) ?? DEFAULTS.cardsColor,
    sharedFixedColor,
    heroGradientPosition: normalizeHeroGradientPosition(raw.heroGradientPosition),
    heroBaseGradient: raw.heroBaseGradient !== false,
    cardsBaseGradient: raw.cardsBaseGradient !== false,
    heroIgnoreLightBackgrounds: raw.heroIgnoreLightBackgrounds !== false,
    cardsIgnoreLightBackgrounds: raw.cardsIgnoreLightBackgrounds !== false,
  };
}

function readSettings(): MediaColorSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== lastRaw) {
      lastRaw = raw;
      snapshot = DEFAULTS;
      if (raw) snapshot = normalizeSettings(JSON.parse(raw));
    }
    return snapshot;
  } catch {
    return DEFAULTS;
  }
}

export function setMediaColorSettings(patch: Partial<MediaColorSettings>): boolean {
  try {
    const next = normalizeSettings({ ...readSettings(), ...patch });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(CHANGE_EVENT));
    return true;
  } catch {
    return false;
  }
}

// A single set of DOM listeners even when hundreds of cards subscribe.
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const onStorage = (event: StorageEvent) => {
  if (event.key === STORAGE_KEY || event.key === null) notify();
};
function subscribe(listener: () => void) {
  if (!listeners.size) {
    window.addEventListener('storage', onStorage);
    window.addEventListener('sync_storage_updated', notify);
    window.addEventListener(CHANGE_EVENT, notify);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('sync_storage_updated', notify);
      window.removeEventListener(CHANGE_EVENT, notify);
    }
  };
}

export const useMediaColorSettings = () => useSyncExternalStore(subscribe, readSettings, getDefaults);
