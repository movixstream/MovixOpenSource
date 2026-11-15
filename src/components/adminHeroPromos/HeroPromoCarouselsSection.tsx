import React from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutTemplate } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  HERO_PROMO_PAGES,
  MAX_PROMOS_PER_CAROUSEL,
  type HeroPromoCarousel,
  type HeroPromoCarousels,
  type HeroPromoPage,
  type HeroPromoSettings
} from '../../services/heroPromoService';
import { SegmentedChoice } from '../adminMonetization/MonetizationUi';
import { SettingsSection } from '../adminVipDonations/SettingsUi';
import { Switch } from '../ui/switch';
import { getHeroPromoStatus } from './heroPromoForm';

// Section « Carrousels » : chaque page (Accueil, Films, Séries, Plateformes,
// Animés) accepte ou non les promos, et en montre au plus N.

const MAX_CHOICES = Array.from({ length: MAX_PROMOS_PER_CAROUSEL }, (_, index) => String(index + 1));

interface HeroPromoCarouselsSectionProps {
  draft: HeroPromoSettings;
  onChange: (carousels: HeroPromoCarousels) => void;
}

const HeroPromoCarouselsSection: React.FC<HeroPromoCarouselsSectionProps> = ({ draft, onChange }) => {
  const { t } = useTranslation();
  const now = Date.now();

  const update = (page: HeroPromoPage, patch: Partial<HeroPromoCarousel>) => {
    onChange({ ...draft.carousels, [page]: { ...draft.carousels[page], ...patch } });
  };

  return (
    <SettingsSection
      id="hero-promos-carousels"
      icon={LayoutTemplate}
      title={t('heroPromo.admin.carousels.title')}
      description={t('heroPromo.admin.carousels.hint')}
    >
      <ul className="space-y-2">
        {HERO_PROMO_PAGES.map((page) => {
          const carousel = draft.carousels[page];
          const switchId = `hero-promos-carousel-${page}`;
          const liveCount = draft.promos.filter(
            (promo) => promo.pages.includes(page) && getHeroPromoStatus(promo, now) === 'live'
          ).length;
          const shown = draft.enabled && carousel.enabled ? Math.min(liveCount, carousel.maxPromos) : 0;
          return (
            <li
              key={page}
              className={cn(
                'flex flex-col gap-3 rounded-xl border border-white/10 bg-black/20 p-4 sm:flex-row sm:items-center sm:justify-between',
                !carousel.enabled && 'border-white/5 bg-black/10'
              )}
            >
              <div className="flex min-w-0 items-start gap-3">
                <Switch
                  id={switchId}
                  checked={carousel.enabled}
                  onCheckedChange={(enabled) => update(page, { enabled })}
                  className="mt-0.5"
                />
                <div className="min-w-0">
                  <label htmlFor={switchId} className="cursor-pointer text-sm font-semibold text-white">
                    {t(`heroPromo.admin.fields.pageNames.${page}`)}
                  </label>
                  <p className="mt-0.5 text-xs text-white/50">
                    {carousel.enabled
                      ? t('heroPromo.admin.carousels.shown', { count: shown, max: carousel.maxPromos })
                      : t('heroPromo.admin.carousels.off')}
                  </p>
                </div>
              </div>
              <div
                className={cn(
                  'flex items-center gap-2 sm:shrink-0',
                  !carousel.enabled && 'pointer-events-none opacity-40'
                )}
                aria-disabled={!carousel.enabled || undefined}
              >
                <span className="text-xs text-white/45">{t('heroPromo.admin.carousels.max')}</span>
                <SegmentedChoice
                  ariaLabel={t('heroPromo.admin.carousels.maxAria', { page: t(`heroPromo.admin.fields.pageNames.${page}`) })}
                  value={String(carousel.maxPromos)}
                  onChange={(value) => update(page, { maxPromos: Number(value) })}
                  options={MAX_CHOICES.map((value) => ({ value, label: value, disabled: !carousel.enabled }))}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </SettingsSection>
  );
};

export default HeroPromoCarouselsSection;
