import { useSyncExternalStore } from 'react';
import { useLightMode } from '@/context/LightModeContext';
import type { ImageQuality } from '@/utils/tmdbImages';

export type { ImageQuality } from '@/utils/tmdbImages';
const STORAGE_KEY = 'settings_image_quality';
const PROFILE_STORAGE_KEY = 'selected_profile_id';
const CHANGE_EVENT = 'image_quality_changed';
let sessionQuality: ImageQuality | undefined;
let sessionProfileId: string | null | undefined;
let failedStorageValue: string | null | undefined;

function readProfileId(): string | null | undefined {
  try { return localStorage.getItem(PROFILE_STORAGE_KEY); }
  catch { return undefined; }
}

function clearSessionQuality() {
  sessionQuality = undefined;
  sessionProfileId = undefined;
  failedStorageValue = undefined;
}

function readQuality(): ImageQuality {
  if (sessionQuality && sessionProfileId === readProfileId()) return sessionQuality;
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'economy' || value === 'high' ? value : 'auto';
  } catch { return 'auto'; }
}

export function setImageQuality(value: ImageQuality): boolean {
  const profileId = readProfileId();
  let previousValue: string | null | undefined;
  let saved = false;
  try {
    previousValue = localStorage.getItem(STORAGE_KEY);
    localStorage.setItem(STORAGE_KEY, value);
    if (localStorage.getItem(STORAGE_KEY) === value) {
      clearSessionQuality();
      saved = true;
    } else {
      sessionQuality = value;
      sessionProfileId = profileId;
      failedStorageValue = previousValue;
    }
  } catch {
    sessionQuality = value;
    sessionProfileId = profileId;
    failedStorageValue = previousValue;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return saved;
}

type DataConnection = {
  saveData?: boolean;
  addEventListener?: EventTarget['addEventListener'];
  removeEventListener?: EventTarget['removeEventListener'];
};
const connection = () => typeof navigator === 'undefined' ? undefined
  : (navigator as Navigator & { connection?: DataConnection }).connection;
const dataSaving = () => connection()?.saveData === true;
const defaultQuality = (): ImageQuality => 'auto';

const qualityListeners = new Set<() => void>();
const notifyQuality = () => qualityListeners.forEach((sync) => sync());
const syncQuality = () => {
  if (sessionQuality && sessionProfileId !== readProfileId()) {
    clearSessionQuality();
    notifyQuality();
    return;
  }
  // A full quota can block writes while reads still work. An unrelated sync
  // must not discard the session choice; an actual persisted change can.
  try {
    if (localStorage.getItem(STORAGE_KEY) !== failedStorageValue) clearSessionQuality();
  } catch { /* keep the session choice */ }
  notifyQuality();
};
const onQualityStorage = (event: StorageEvent) => {
  if (event.key === STORAGE_KEY || event.key === PROFILE_STORAGE_KEY || event.key === null) syncQuality();
};
let subscribedConnection: DataConnection | undefined;

function subscribeQuality(sync: () => void) {
  if (!qualityListeners.size) {
    window.addEventListener('storage', onQualityStorage);
    window.addEventListener('sync_storage_updated', syncQuality);
    window.addEventListener(CHANGE_EVENT, notifyQuality);
    const currentConnection = connection();
    if (
      typeof currentConnection?.addEventListener === 'function'
      && typeof currentConnection.removeEventListener === 'function'
    ) {
      currentConnection.addEventListener('change', notifyQuality);
      subscribedConnection = currentConnection;
    }
  }
  qualityListeners.add(sync);
  return () => {
    qualityListeners.delete(sync);
    if (!qualityListeners.size) {
      window.removeEventListener('storage', onQualityStorage);
      window.removeEventListener('sync_storage_updated', syncQuality);
      window.removeEventListener(CHANGE_EVENT, notifyQuality);
      if (typeof subscribedConnection?.removeEventListener === 'function') {
        subscribedConnection.removeEventListener('change', notifyQuality);
      }
      subscribedConnection = undefined;
    }
  };
}

export function useImageQuality() {
  const imageQuality = useSyncExternalStore(subscribeQuality, readQuality, defaultQuality);
  const saveData = useSyncExternalStore(subscribeQuality, dataSaving, () => false);
  const { isLightMode } = useLightMode();
  const effectiveImageQuality: ImageQuality = imageQuality === 'auto' && (isLightMode || saveData) ? 'economy' : imageQuality;
  return { imageQuality, effectiveImageQuality };
}

type ImageViewport = { width: number; height: number; dpr: number };
const serverViewport: ImageViewport = { width: 1280, height: 720, dpr: 1 };
let viewport = serverViewport;
const viewportListeners = new Set<() => void>();
let densityQuery: MediaQueryList | undefined;

function readViewport(): ImageViewport {
  if (typeof window === 'undefined') return serverViewport;
  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;
  if (viewport.width !== width || viewport.height !== height || viewport.dpr !== dpr) viewport = { width, height, dpr };
  return viewport;
}

function watchDensity() {
  densityQuery?.removeEventListener?.('change', updateViewport);
  densityQuery = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
  densityQuery?.addEventListener?.('change', updateViewport);
}

function updateViewport() {
  readViewport();
  watchDensity();
  viewportListeners.forEach((sync) => sync());
}

function subscribeViewport(sync: () => void) {
  viewportListeners.add(sync);
  if (viewportListeners.size === 1) {
    window.addEventListener('resize', updateViewport);
    watchDensity();
  }
  return () => {
    viewportListeners.delete(sync);
    if (!viewportListeners.size) {
      window.removeEventListener('resize', updateViewport);
      densityQuery?.removeEventListener?.('change', updateViewport);
    }
  };
}

export const useImageViewport = () => useSyncExternalStore(subscribeViewport, readViewport, () => serverViewport);
