// Réglages des effets d'ambiance (neige, feuilles, pluie, fleurs de cerisier,
// pop-corn, Halloween). L'interrupteur reste dans sessionStorage
// (`ambient_active`, lu par le Header) ; ces options-ci durent d'une visite à l'autre.

export type AmbientEffect = 'snow' | 'leaves' | 'rain' | 'petals' | 'popcorn' | 'halloween';
export type AmbientIntensity = 'light' | 'normal' | 'heavy' | 'variable';
/** Où ce qui tombe se pose : partout, sur les cards, en bas de l'écran, nulle part. */
export type AmbientSettle = 'all' | 'cards' | 'ground' | 'off';

export interface AmbientOptions {
  /** Effets actifs en même temps ; jamais vide. */
  effects: AmbientEffect[];
  intensity: AmbientIntensity;
  /** Opacité du calque entier, de `AMBIENT_MIN_OPACITY` à 1. */
  opacity: number;
  settle: AmbientSettle;
  /** La neige fond, feuilles et pétales se fanent, au lieu de rester au maximum. */
  fade: boolean;
}

export const AMBIENT_EFFECTS: AmbientEffect[] = ['snow', 'leaves', 'rain', 'petals', 'popcorn', 'halloween'];
export const AMBIENT_INTENSITIES: AmbientIntensity[] = ['light', 'normal', 'heavy', 'variable'];
export const AMBIENT_SETTLES: AmbientSettle[] = ['all', 'cards', 'ground', 'off'];
export const AMBIENT_MIN_OPACITY = 0.3;
export const DEFAULT_AMBIENT_OPTIONS: AmbientOptions = {
  effects: ['snow'], intensity: 'normal', opacity: 1, settle: 'all', fade: true,
};

const STORAGE_KEY = 'ambient_options';
const ACTIVE_KEY = 'ambient_active';
/** Clés de l'ancien mode neige, relues une fois pour ne pas perdre les réglages. */
const LEGACY_STORAGE_KEY = 'snowfall_options';
const LEGACY_ACTIVE_KEY = 'snowfall_active';

export const AMBIENT_TOGGLE_EVENT = 'ambient_toggled';
export const AMBIENT_OPTIONS_EVENT = 'ambient_options_changed';
export const AMBIENT_CLEAR_EVENT = 'ambient_clear';

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw => !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * Remet des réglages lus du stockage dans un état valide. `legacy` est l'ancien
 * format du mode neige (`{ intensity, accumulate, melt }`), utilisé quand il
 * n'y a pas encore de réglages au nouveau format.
 */
export function normalizeAmbientOptions(raw: unknown, legacy?: unknown): AmbientOptions {
  const base = DEFAULT_AMBIENT_OPTIONS;
  if (!isRecord(raw)) {
    if (!isRecord(legacy)) return base;
    return {
      ...base,
      intensity: AMBIENT_INTENSITIES.includes(legacy.intensity as AmbientIntensity) ? legacy.intensity as AmbientIntensity : base.intensity,
      settle: legacy.accumulate === false ? 'off' : 'all',
      fade: typeof legacy.melt === 'boolean' ? legacy.melt : base.fade,
    };
  }
  const effects = Array.isArray(raw.effects)
    ? AMBIENT_EFFECTS.filter((effect) => (raw.effects as unknown[]).includes(effect))
    : [];
  const opacity = typeof raw.opacity === 'number' && Number.isFinite(raw.opacity) ? raw.opacity : base.opacity;
  return {
    effects: effects.length > 0 ? effects : base.effects,
    intensity: AMBIENT_INTENSITIES.includes(raw.intensity as AmbientIntensity) ? raw.intensity as AmbientIntensity : base.intensity,
    opacity: Math.max(AMBIENT_MIN_OPACITY, Math.min(1, opacity)),
    settle: AMBIENT_SETTLES.includes(raw.settle as AmbientSettle) ? raw.settle as AmbientSettle : base.settle,
    fade: typeof raw.fade === 'boolean' ? raw.fade : base.fade,
  };
}

/** Active ou coupe un effet ; le dernier effet actif ne se coupe pas. */
export function toggleAmbientEffect(options: AmbientOptions, effect: AmbientEffect): AmbientOptions {
  const active = options.effects.includes(effect);
  if (active && options.effects.length === 1) return options;
  const effects = AMBIENT_EFFECTS.filter((e) => (e === effect ? !active : options.effects.includes(e)));
  return { ...options, effects };
}

const parse = (value: string | null): unknown => {
  try { return JSON.parse(value || 'null'); } catch { return null; }
};

export function readAmbientOptions(): AmbientOptions {
  try {
    return normalizeAmbientOptions(parse(localStorage.getItem(STORAGE_KEY)), parse(localStorage.getItem(LEGACY_STORAGE_KEY)));
  } catch {
    return DEFAULT_AMBIENT_OPTIONS;
  }
}

export function writeAmbientOptions(options: AmbientOptions): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(options)); } catch { /* Préférence facultative. */ }
  window.dispatchEvent(new CustomEvent(AMBIENT_OPTIONS_EVENT));
}

export function readAmbientActive(): boolean {
  try {
    const value = sessionStorage.getItem(ACTIVE_KEY) ?? sessionStorage.getItem(LEGACY_ACTIVE_KEY);
    return value === 'true';
  } catch {
    return false;
  }
}

export function writeAmbientActive(active: boolean): void {
  try {
    sessionStorage.setItem(ACTIVE_KEY, String(active));
    sessionStorage.removeItem(LEGACY_ACTIVE_KEY);
  } catch { /* Préférence facultative. */ }
  window.dispatchEvent(new CustomEvent(AMBIENT_TOGGLE_EVENT));
}

/** Balaie tout ce qui est posé : la neige part en poudre, feuilles et pétales s'envolent. */
export function clearAmbient(): void {
  window.dispatchEvent(new CustomEvent(AMBIENT_CLEAR_EVENT));
}
