import type { HeroPromoImagePosition } from '@/services/heroPromoService';

// Petites règles d'affichage des slides promo, partagées par le carrousel et
// l'aperçu de l'admin.

/** Cadrage CSS (`object-position`) de l'image de fond. */
export const HERO_PROMO_OBJECT_POSITIONS: Record<HeroPromoImagePosition, string> = {
  top: 'center top',
  center: 'center center',
  bottom: 'center bottom'
};

/**
 * Même cadrage pour l'effet de transition WebGL (MorphBackdrop) : part de la
 * hauteur gardée en haut, de 0 (haut) à 1 (bas).
 */
export const HERO_PROMO_FOCUS_Y: Record<HeroPromoImagePosition, number> = {
  top: 0,
  center: 0.5,
  bottom: 1
};

/** Texte noir ou blanc selon la clarté de la couleur du bouton. */
export function getReadableTextColor(hex: string): string {
  const value = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#ef4444';
  const channel = (offset: number) => {
    const c = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance > 0.36 ? '#000000' : '#ffffff';
}
