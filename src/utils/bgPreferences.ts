import { useEffect, useSyncExternalStore } from 'react';
import { readLocalStorage } from './browserStorage';

// ─── Presets de couleur accent ──────────────────────────────────────────
// Partagés entre SettingsPage (sélection) et SquareBackground (application
// quand l'utilisateur force la couleur globalement).
export const BG_ACCENT_PRESETS = {
  red:     { rgb: '239, 68, 68',    label: 'Rouge',    swatch: '#ef4444' },
  indigo:  { rgb: '99, 102, 241',   label: 'Indigo',   swatch: '#6366f1' },
  emerald: { rgb: '16, 185, 129',   label: 'Émeraude', swatch: '#10b981' },
  amber:   { rgb: '245, 158, 11',   label: 'Ambre',    swatch: '#f59e0b' },
  pink:    { rgb: '236, 72, 153',   label: 'Rose',     swatch: '#ec4899' },
  cyan:    { rgb: '6, 182, 212',    label: 'Cyan',     swatch: '#06b6d4' },
  violet:  { rgb: '168, 85, 247',   label: 'Violet',   swatch: '#a855f7' },
  slate:   { rgb: '148, 163, 184',  label: 'Ardoise',  swatch: '#94a3b8' },
} as const;

export type BgAccentKey = keyof typeof BG_ACCENT_PRESETS;
export type BgAccentValue = BgAccentKey | 'custom';

// ─── Storage keys ───────────────────────────────────────────────────────
export const BG_STORAGE_KEYS = {
  accent: 'settings_bg_accent',
  customHex: 'settings_bg_accent_custom',
  squareSize: 'settings_bg_square_size',
  forceColor: 'settings_bg_force_color',
  forceSquareSize: 'settings_bg_force_square_size',
  haloEnabled: 'settings_bg_halo',
} as const;

// ─── Event bus ──────────────────────────────────────────────────────────
// `storage` event ne fire que cross-tab. On ajoute un event custom pour
// notifier les composants montés dans la même page (SquareBackground sur
// chaque route) quand l'utilisateur change un réglage.
export const BG_PREFS_EVENT = 'movix:bg-prefs-changed';

export function notifyBgPrefsChanged() {
  window.dispatchEvent(new Event(BG_PREFS_EVENT));
}

// ─── Hex → "r, g, b" (format attendu par parseRGB côté SquareBackground) ─
export function hexToRgbString(hex: string): string {
  const cleaned = hex.replace('#', '').trim();
  const v = cleaned.length === 3
    ? cleaned.split('').map((c) => c + c).join('')
    : cleaned.padEnd(6, '0').slice(0, 6);
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return '239, 68, 68';
  return `${r}, ${g}, ${b}`;
}

// ─── Lecture des prefs depuis localStorage ──────────────────────────────
export interface BgPrefs {
  accent: BgAccentValue;
  customHex: string;
  squareSize: number;
  forceColor: boolean;
  forceSquareSize: boolean;
  haloEnabled: boolean;
}

export function readBgPrefs(): BgPrefs {
  const accentRaw = readLocalStorage(BG_STORAGE_KEYS.accent);
  const accent: BgAccentValue =
    accentRaw === 'custom'
      ? 'custom'
      : accentRaw && accentRaw in BG_ACCENT_PRESETS
        ? (accentRaw as BgAccentKey)
        : 'red';

  const customHex = readLocalStorage(BG_STORAGE_KEYS.customHex) || '#ef4444';

  const sizeRaw = parseInt(readLocalStorage(BG_STORAGE_KEYS.squareSize) || '48', 10);
  const squareSize = [32, 48, 64, 80].includes(sizeRaw) ? sizeRaw : 48;

  const forceColor = readLocalStorage(BG_STORAGE_KEYS.forceColor) === '1';
  const forceSquareSize = readLocalStorage(BG_STORAGE_KEYS.forceSquareSize) === '1';
  // Default true — le halo est activé par défaut. Désactivable depuis Apparence.
  const haloEnabled = readLocalStorage(BG_STORAGE_KEYS.haloEnabled) !== '0';

  return { accent, customHex, squareSize, forceColor, forceSquareSize, haloEnabled };
}

export function getBgAccentRgb(prefs: BgPrefs): string {
  return prefs.accent === 'custom'
    ? hexToRgbString(prefs.customHex)
    : BG_ACCENT_PRESETS[prefs.accent].rgb;
}

// ─── Subscribe (storage cross-tab + custom event same-tab) ──────────────
function subscribe(callback: () => void): () => void {
  const handler = () => callback();
  window.addEventListener('storage', handler);
  window.addEventListener(BG_PREFS_EVENT, handler);
  return () => {
    window.removeEventListener('storage', handler);
    window.removeEventListener(BG_PREFS_EVENT, handler);
  };
}

// useSyncExternalStore exige un snapshot stable. On cache la dernière
// valeur lue et on la ré-émet tant que `readBgPrefs()` retourne le même
// objet sérialisé — sinon React tombe en boucle infinie ("getSnapshot
// should be cached").
let cachedPrefs: BgPrefs | null = null;
let cachedKey = '';

function getSnapshot(): BgPrefs {
  const next = readBgPrefs();
  const key = `${next.accent}|${next.customHex}|${next.squareSize}|${next.forceColor}|${next.forceSquareSize}|${next.haloEnabled}`;
  if (cachedPrefs && key === cachedKey) return cachedPrefs;
  cachedPrefs = next;
  cachedKey = key;
  return next;
}

function getServerSnapshot(): BgPrefs {
  return {
    accent: 'red',
    customHex: '#ef4444',
    squareSize: 48,
    forceColor: false,
    forceSquareSize: false,
    haloEnabled: true,
  };
}

export function useBgPrefs(): BgPrefs {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// Hook minimal pour invalider le cache quand le composant remonte (sécurité).
export function useBgPrefsInvalidator() {
  useEffect(() => {
    cachedPrefs = null;
    cachedKey = '';
  }, []);
}
