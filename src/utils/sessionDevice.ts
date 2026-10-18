export type SessionDeviceType = 'desktop' | 'mobile' | 'tablet' | 'tv' | 'unknown';

export interface SessionDeviceInfo {
  version: 1;
  browser: string | null;
  browserVersion: string | null;
  operatingSystem: string | null;
  deviceType: SessionDeviceType;
  /** Nom donné par l'appareil lui-même (ex. « Android TV salon » pour l'appli télé). */
  name: string | null;
}

const DEVICE_TYPES = new Set<SessionDeviceType>(['desktop', 'mobile', 'tablet', 'tv', 'unknown']);
const MAX_DEVICE_NAME_LENGTH = 60;

/** Normalise la réponse de l'API pour garder les anciennes sessions affichables. */
export function normalizeSessionDeviceInfo(value: unknown): SessionDeviceInfo {
  if (!value || typeof value !== 'object') {
    return {
      version: 1,
      browser: null,
      browserVersion: null,
      operatingSystem: null,
      deviceType: 'unknown',
      name: null,
    };
  }

  const candidate = value as Partial<SessionDeviceInfo>;
  return {
    version: 1,
    browser: typeof candidate.browser === 'string' && candidate.browser.trim() ? candidate.browser : null,
    browserVersion: typeof candidate.browserVersion === 'string' && candidate.browserVersion.trim()
      ? candidate.browserVersion
      : null,
    operatingSystem: typeof candidate.operatingSystem === 'string' && candidate.operatingSystem.trim()
      ? candidate.operatingSystem
      : null,
    deviceType: DEVICE_TYPES.has(candidate.deviceType as SessionDeviceType)
      ? candidate.deviceType as SessionDeviceType
      : 'unknown',
    name: typeof candidate.name === 'string' && candidate.name.trim()
      ? candidate.name.trim().slice(0, MAX_DEVICE_NAME_LENGTH)
      : null,
  };
}

/**
 * Titre d'une session : le nom de l'appareil s'il en a un, sinon le navigateur.
 * Une télé sans nom ni navigateur prend `tvFallback` (« Télé ») plutôt que
 * « Navigateur inconnu ».
 */
export function getSessionBrowserLabel(device: SessionDeviceInfo, fallback: string, tvFallback?: string): string {
  if (device.name) return device.name;
  if (!device.browser) return device.deviceType === 'tv' && tvFallback ? tvFallback : fallback;
  return device.browserVersion ? `${device.browser} ${device.browserVersion}` : device.browser;
}
