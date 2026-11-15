import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useProfile } from '../context/ProfileContext';
import { isContentAllowedForAge } from '../utils/contentAgeFilter';
import {
  ensureHeroPromosFresh,
  getHeroPromoConfig,
  isHeroPromoLive,
  isInternalHeroPromoLink,
  pickHeroPromoTexts,
  resolveHeroPromoAsset,
  subscribeToHeroPromos,
  type HeroPromoAdLabelPosition,
  type HeroPromoImagePosition,
  type HeroPromoPage,
  type HeroPromoTexts,
  type PublicHeroPromo,
  type PublicHeroPromoConfig
} from '../services/heroPromoService';

/** Promo prête à afficher : textes dans la langue du site, images en URL complète. */
export interface HeroPromoDisplay {
  id: string;
  position: number;
  imageUrl: string;
  mobileImageUrl: string | null;
  imagePosition: HeroPromoImagePosition;
  logoUrl: string | null;
  linkUrl: string;
  internalLink: boolean;
  openInNewTab: boolean;
  accentColor: string;
  adLabel: { show: boolean; position: HeroPromoAdLabelPosition };
  texts: HeroPromoTexts;
}

export function toHeroPromoDisplay(promo: PublicHeroPromo, language: string): HeroPromoDisplay {
  return {
    id: promo.id,
    position: promo.position,
    imageUrl: resolveHeroPromoAsset(promo.imageUrl),
    mobileImageUrl: promo.mobileImageUrl ? resolveHeroPromoAsset(promo.mobileImageUrl) : null,
    imagePosition: promo.imagePosition,
    logoUrl: promo.logoUrl ? resolveHeroPromoAsset(promo.logoUrl) : null,
    linkUrl: promo.linkUrl,
    internalLink: isInternalHeroPromoLink(promo.linkUrl),
    openInNewTab: promo.openInNewTab,
    accentColor: promo.accentColor,
    adLabel: promo.adLabel,
    texts: pickHeroPromoTexts(promo, language)
  };
}

const SCHEDULE_TICK_MS = 60 * 1000;
const EMPTY_PROMOS: PublicHeroPromo[] = [];

/**
 * Promos à glisser dans le carrousel de `page` pour le profil courant : le
 * carrousel doit les accepter (réglage de l'admin, page par page), puis
 * chaque promo doit être en service et permise par la restriction d'âge du
 * profil. Le nombre maximum du carrousel est respecté, dans l'ordre de la
 * liste de l'admin. Sans `page`, aucune promo.
 */
export function useHeroPromos(page: HeroPromoPage | undefined): HeroPromoDisplay[] {
  const { i18n } = useTranslation();
  const { currentProfile } = useProfile();
  const ageRestriction = currentProfile?.ageRestriction || 0;
  const [config, setConfig] = useState<PublicHeroPromoConfig>(getHeroPromoConfig);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!page) return undefined;
    setConfig(getHeroPromoConfig());
    const unsubscribe = subscribeToHeroPromos(setConfig);
    ensureHeroPromosFresh();
    return unsubscribe;
  }, [page]);

  const carousel = page ? config.carousels[page] : null;
  const pagePromos = useMemo(
    () => (page && carousel?.enabled ? config.promos.filter((promo) => promo.pages.includes(page)) : EMPTY_PROMOS),
    [page, carousel?.enabled, config.promos]
  );

  // Début ou fin programmés : revérifier chaque minute.
  const hasSchedule = pagePromos.some((promo) => promo.startAt || promo.endAt);
  useEffect(() => {
    if (!hasSchedule) return undefined;
    const timer = setInterval(() => setNow(Date.now()), SCHEDULE_TICK_MS);
    return () => clearInterval(timer);
  }, [hasSchedule]);

  const language = i18n.language || 'fr';
  // Clé des promos visibles : le passage de chaque minute ne recrée pas la
  // liste (ni les textures du carrousel) tant que rien ne change.
  const visibleKey = pagePromos
    .filter((promo) => isHeroPromoLive(promo, now) && isContentAllowedForAge(promo.minAge, ageRestriction))
    .slice(0, carousel?.maxPromos ?? 0)
    .map((promo) => promo.id)
    .join(',');
  return useMemo(() => {
    const visibleIds = new Set(visibleKey ? visibleKey.split(',') : []);
    return pagePromos
      .filter((promo) => visibleIds.has(promo.id))
      .map((promo) => toHeroPromoDisplay(promo, language));
  }, [pagePromos, visibleKey, language]);
}
