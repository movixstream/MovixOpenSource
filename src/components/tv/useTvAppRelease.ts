import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TV_APP_APK_URL, TV_APP_MANIFEST_URL, type TvAppManifest } from '@/config/tvApp';

export interface TvAppRelease {
  /** Adresse de l'APK : celle du manifeste si elle est sûre, sinon l'adresse fixe. */
  apkUrl: string;
  versionName: string | null;
  /** Taille lisible (« 6,2 Mo »), ou null si le manifeste ne la donne pas. */
  sizeLabel: string | null;
  /** Nouveautés dans la langue du site, ou null. */
  notes: string | null;
}

// Une seule lecture par chargement du site, partagée entre les montages de la page.
let manifestRequest: Promise<TvAppManifest | null> | null = null;

const isHttpsUrl = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

const cleanText = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : null;
};

function readManifest(): Promise<TvAppManifest | null> {
  if (!manifestRequest) {
    manifestRequest = fetch(TV_APP_MANIFEST_URL, { cache: 'no-cache' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: unknown) => (data && typeof data === 'object' ? (data as TvAppManifest) : null))
      .catch(() => {
        // Manifeste absent ou réseau coupé : la page garde l'adresse fixe, sans message.
        manifestRequest = null;
        return null;
      });
  }
  return manifestRequest;
}

/**
 * Lit le manifeste de l'appli télé (`tv/version.json`). Toute erreur est
 * silencieuse : la page affiche alors l'adresse fixe de l'APK, sans version.
 */
export function useTvAppRelease(): TvAppRelease {
  const { i18n } = useTranslation();
  const [manifest, setManifest] = useState<TvAppManifest | null>(null);

  useEffect(() => {
    let alive = true;
    readManifest().then((result) => {
      if (alive) setManifest(result);
    });
    return () => {
      alive = false;
    };
  }, []);

  const isFrench = (i18n.resolvedLanguage || i18n.language || 'fr').toLowerCase().startsWith('fr');
  const manifestApkUrl = manifest?.apkUrl;
  const apkSize = manifest?.apkSize;
  const sizeLabel = typeof apkSize === 'number' && Number.isFinite(apkSize) && apkSize > 0
    ? `${new Intl.NumberFormat(isFrench ? 'fr-FR' : 'en-US', { maximumFractionDigits: 1 }).format(apkSize / (1024 * 1024))} ${isFrench ? 'Mo' : 'MB'}`
    : null;

  return {
    apkUrl: isHttpsUrl(manifestApkUrl) ? manifestApkUrl : TV_APP_APK_URL,
    versionName: cleanText(manifest?.versionName, 24),
    sizeLabel,
    notes: cleanText(isFrench ? manifest?.notes?.fr : manifest?.notes?.en ?? manifest?.notes?.fr, 600),
  };
}
