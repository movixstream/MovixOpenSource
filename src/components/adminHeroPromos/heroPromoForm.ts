import {
  HERO_PROMO_PAGES,
  isHeroPromoLive,
  type HeroPromo,
  type HeroPromoSettings
} from '../../services/heroPromoService';

// Contrôles du formulaire « Promos du carrousel ». Mêmes règles que
// validateSettingsInput (API/Mainapi/utils/heroPromoSettings.js), qui reste
// la référence : ici, elles servent à montrer l'erreur sous le bon champ.

export type HeroPromoField = 'pages' | 'endAt' | 'imageUrl' | 'mobileImageUrl' | 'logoUrl' | 'linkUrl' | 'title';
export type HeroPromoErrorCode =
  | 'pagesRequired'
  | 'endBeforeStart'
  | 'imageRequired'
  | 'imageInvalid'
  | 'linkRequired'
  | 'linkInvalid'
  | 'titleRequired';
export type HeroPromoErrors = Record<string, HeroPromoErrorCode>;
export type HeroPromoStatus = 'live' | 'paused' | 'scheduled' | 'ended';

export const heroPromoFieldKey = (id: string, field: HeroPromoField) => `${id}:${field}`;

const UPLOADED_IMAGE_PATTERN = /^\/api\/hero-promos\/images\/[a-f0-9]{16}\.(webp|png|jpg)$/;

function isHttpUrl(value: string, httpsOnly: boolean): boolean {
  if (!/^https?:\/\/\S+$/i.test(value) || value.length > 1000) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password || !url.hostname) return false;
    return httpsOnly ? url.protocol === 'https:' : url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function isHeroPromoImageRef(value: string): boolean {
  return UPLOADED_IMAGE_PATTERN.test(value) || isHttpUrl(value, true);
}

export function isHeroPromoLinkRef(value: string): boolean {
  return /^\/(?!\/)[^\s\\]*$/.test(value) || isHttpUrl(value, false);
}

// Espaces de début et de fin retirés, comme le fait le serveur.
export function normalizeHeroPromoForSave(settings: HeroPromoSettings): HeroPromoSettings {
  return {
    enabled: settings.enabled,
    carousels: settings.carousels,
    promos: settings.promos.map((promo) => ({
      ...promo,
      name: promo.name.trim(),
      imageUrl: promo.imageUrl.trim(),
      mobileImageUrl: promo.mobileImageUrl.trim(),
      logoUrl: promo.logoUrl.trim(),
      linkUrl: promo.linkUrl.trim(),
      texts: {
        fr: Object.fromEntries(Object.entries(promo.texts.fr).map(([key, value]) => [key, value.trim()])) as HeroPromo['texts']['fr'],
        en: Object.fromEntries(Object.entries(promo.texts.en).map(([key, value]) => [key, value.trim()])) as HeroPromo['texts']['en']
      }
    }))
  };
}

export function validateHeroPromoSettings(settings: HeroPromoSettings): HeroPromoErrors {
  const errors: HeroPromoErrors = {};
  for (const promo of settings.promos) {
    const set = (field: HeroPromoField, code: HeroPromoErrorCode) => {
      errors[heroPromoFieldKey(promo.id, field)] = code;
    };

    if (!promo.pages.some((page) => HERO_PROMO_PAGES.includes(page))) set('pages', 'pagesRequired');
    if (promo.startAt && promo.endAt && new Date(promo.endAt).getTime() <= new Date(promo.startAt).getTime()) {
      set('endAt', 'endBeforeStart');
    }

    if (promo.imageUrl && !isHeroPromoImageRef(promo.imageUrl)) set('imageUrl', 'imageInvalid');
    else if (!promo.imageUrl && promo.enabled) set('imageUrl', 'imageRequired');
    if (promo.mobileImageUrl && !isHeroPromoImageRef(promo.mobileImageUrl)) set('mobileImageUrl', 'imageInvalid');
    if (promo.logoUrl && !isHeroPromoImageRef(promo.logoUrl)) set('logoUrl', 'imageInvalid');

    if (promo.linkUrl && !isHeroPromoLinkRef(promo.linkUrl)) set('linkUrl', 'linkInvalid');
    else if (!promo.linkUrl && promo.enabled) set('linkUrl', 'linkRequired');

    if (!promo.texts.fr.title && promo.enabled) set('title', 'titleRequired');
  }
  return errors;
}

export function countHeroPromoErrors(errors: HeroPromoErrors, id: string): number {
  const prefix = `${id}:`;
  return Object.keys(errors).filter((key) => key.startsWith(prefix)).length;
}

export function getHeroPromoStatus(promo: HeroPromo, now = Date.now()): HeroPromoStatus {
  if (!promo.enabled) return 'paused';
  if (promo.endAt && new Date(promo.endAt).getTime() <= now) return 'ended';
  if (!isHeroPromoLive(promo, now)) return 'scheduled';
  return 'live';
}

export function countLiveHeroPromos(settings: HeroPromoSettings, now = Date.now()): number {
  if (!settings.enabled) return 0;
  return settings.promos.filter((promo) => getHeroPromoStatus(promo, now) === 'live').length;
}

export function cloneHeroPromoSettings(settings: HeroPromoSettings): HeroPromoSettings {
  return structuredClone(settings);
}

export function isSameHeroPromoSettings(a: HeroPromoSettings, b: HeroPromoSettings): boolean {
  return JSON.stringify(normalizeHeroPromoForSave(a)) === JSON.stringify(normalizeHeroPromoForSave(b));
}
