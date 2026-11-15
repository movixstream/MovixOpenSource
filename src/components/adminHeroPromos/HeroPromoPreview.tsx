import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImageOff } from 'lucide-react';

import { cn } from '@/lib/utils';
import { toHeroPromoDisplay } from '@/hooks/useHeroPromos';
import { MEDIA_HERO_BASE_GRADIENT } from '@/utils/mediaColors';
import type { HeroPromo, HeroPromoLanguage } from '../../services/heroPromoService';
import { HeroPromoContent } from '../hero/HeroPromoContent';
import { HERO_PROMO_OBJECT_POSITIONS } from '../hero/heroPromoStyle';

// Aperçu de la slide telle qu'elle s'affiche sur un écran 1920 × 1080 : le
// carrousel y fait toute la largeur pour 55 % de la hauteur, soit environ
// 1840 × 594. C'est là qu'il recadre le plus une image 16:9. Rendu à cette
// taille puis réduit à la largeur disponible, pour garder la mise en page réelle.
const FRAME_WIDTH = 1840;
const FRAME_HEIGHT = 594;

interface HeroPromoPreviewProps {
  promo: HeroPromo;
  language: HeroPromoLanguage;
}

const HeroPromoPreview: React.FC<HeroPromoPreviewProps> = ({ promo, language }) => {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const display = useMemo(() => toHeroPromoDisplay(promo, language), [promo, language]);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const imageFailed = failedImage === display.imageUrl;

  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;
    const update = () => setScale(Math.max(0.1, node.clientWidth / FRAME_WIDTH));
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="w-full">
      <div
        className="relative overflow-hidden rounded-xl border border-white/10 bg-neutral-950"
        style={{ height: FRAME_HEIGHT * scale }}
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{ width: FRAME_WIDTH, height: FRAME_HEIGHT, transform: `scale(${scale})` }}
        >
          {display.imageUrl && !imageFailed ? (
            <img
              src={display.imageUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              style={{ objectPosition: HERO_PROMO_OBJECT_POSITIONS[display.imagePosition] }}
              onError={() => setFailedImage(display.imageUrl)}
              draggable={false}
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/30">
              <ImageOff className="h-16 w-16 text-white opacity-30" aria-hidden="true" />
              <span className="text-2xl">{t('heroPromo.admin.preview.noImage')}</span>
            </div>
          )}
          <div className="pointer-events-none absolute inset-0 z-10" style={{ background: MEDIA_HERO_BASE_GRADIENT }} />
          <div className={cn('absolute inset-0', !display.texts.title && 'opacity-60')}>
            <HeroPromoContent
              promo={{ ...display, texts: { ...display.texts, title: display.texts.title || t('heroPromo.admin.promo.unnamed') } }}
              isActive
              isMorph={false}
              frozen={false}
              preview
            />
          </div>
        </div>
      </div>
      <p className="mt-1.5 text-xs leading-5 text-white/40">{t('heroPromo.admin.preview.hint')}</p>
    </div>
  );
};

export default HeroPromoPreview;
