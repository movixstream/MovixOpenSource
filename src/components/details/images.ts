import { useImageQuality, useImageViewport } from '@/hooks/useImageQuality';
import { getCoverImageWidth, getTmdbImageUrl } from '@/utils/tmdbImages';
import type { DetailsProfileUrl } from './credits';
import type { DetailsImageSet } from './DetailsImagesGallery';

/** Qualité et densité d'image d'une fiche, et les tailles qui en découlent. */
export function useDetailsImageSizing() {
  const { effectiveImageQuality: quality } = useImageQuality();
  const { width: viewportWidth, dpr } = useImageViewport();
  const imageDpr = Math.min(dpr, quality === 'high' ? 3 : 2);

  const profileUrl: DetailsProfileUrl = (path, cssWidth) => (path
    ? getTmdbImageUrl(path, { kind: 'profile', quality, width: Math.ceil(cssWidth * imageDpr), role: 'card' })
    : null);
  const cardBackdropUrl = (path: string | null | undefined, cssWidth: number) => (path
    ? getTmdbImageUrl(path, { kind: 'backdrop', quality, width: Math.ceil(cssWidth * imageDpr), role: 'card' })
    : null);

  return { quality, viewportWidth, imageDpr, profileUrl, cardBackdropUrl };
}

export type DetailsImageSizing = ReturnType<typeof useDetailsImageSizing>;

/**
 * Image du haut et logo du titre. L'arrière-plan principal de TMDB, à défaut
 * le plus grand de la galerie, à défaut l'affiche. Même règle de taille que
 * le HeroSlider.
 */
export function detailsHeroImages(
  sizing: DetailsImageSizing,
  paths: { backdrop?: string | null; bestBackdrop?: string | null; poster?: string | null; logo?: string | null },
) {
  const { quality, viewportWidth, imageDpr } = sizing;
  const heroHeight = viewportWidth < 768 ? 520
    : viewportWidth < 1280 ? 560
      : viewportWidth < 1440 ? 680
        : viewportWidth < 1536 ? 760
          : viewportWidth < 1700 ? 820 : 900;
  const heroBackdropPath = paths.backdrop || paths.bestBackdrop || null;
  const heroImagePath = heroBackdropPath || paths.poster || null;
  const backdropUrl = heroImagePath
    ? getTmdbImageUrl(heroImagePath, {
      kind: heroBackdropPath ? 'backdrop' : 'poster',
      quality,
      width: getCoverImageWidth(viewportWidth, heroHeight, heroBackdropPath ? 16 / 9 : 2 / 3, imageDpr),
      role: 'hero',
    })
    : null;
  const logoUrl = paths.logo
    ? getTmdbImageUrl(paths.logo, {
      kind: 'logo',
      quality,
      width: Math.ceil((viewportWidth < 768 ? 270 : viewportWidth < 1536 ? 440 : 560) * imageDpr),
      role: 'detail',
    })
    : null;
  return { heroBackdropPath, backdropUrl, logoUrl };
}

/** Nombre d'images de la galerie, au total et par sorte. */
export function detailsImageStats(images: DetailsImageSet | null, t: (key: string) => string) {
  const counts = images
    ? { backdrops: images.backdrops?.length ?? 0, posters: images.posters?.length ?? 0, logos: images.logos?.length ?? 0 }
    : null;
  const total = counts ? counts.backdrops + counts.posters + counts.logos : 0;
  const breakdown = counts
    ? [
      counts.backdrops > 0 && `${counts.backdrops} ${t('details.backgrounds').toLowerCase()}`,
      counts.posters > 0 && `${counts.posters} ${t('details.posters').toLowerCase()}`,
      counts.logos > 0 && `${counts.logos} ${t('details.logos').toLowerCase()}`,
    ].filter(Boolean).join(', ')
    : null;
  return { total, breakdown };
}
