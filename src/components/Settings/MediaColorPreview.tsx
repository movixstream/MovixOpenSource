import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CarouselCard, type Media } from '@/components/EmblaCarousel';
import { useExtractedMediaColor } from '@/hooks/useMediaColor';
import { useMediaColorSettings, type MediaColorMode, type MediaColorTarget } from '@/hooks/useMediaColorSettings';
import { getMediaColorSource } from '@/services/mediaColorService';
import { createMediaPalette, MEDIA_HERO_BASE_GRADIENT, type MediaColorAlgorithm } from '@/utils/mediaColors';
import { useImageQuality, useImageViewport } from '@/hooks/useImageQuality';
import { useImageSlot } from '@/hooks/useImageSlot';
import { useHeroSliderStyle } from '@/hooks/useHeroSliderStyle';
import { getCoverImageWidth, getTmdbImageUrl } from '@/utils/tmdbImages';

interface MediaColorPreviewProps {
  id: string;
  target: MediaColorTarget;
  mode: MediaColorMode;
  fixedColor: string;
  algorithm: MediaColorAlgorithm;
  image: string;
  title: string;
  item: Media;
  enabled: boolean;
  customImage: boolean;
  localImage: boolean;
  retryKey: number;
  align?: 'start' | 'center';
  detailsVisible?: boolean;
  announceResult?: boolean;
}

export function MediaColorPreview({
  id,
  target,
  mode,
  fixedColor,
  algorithm,
  image,
  title,
  item,
  enabled,
  customImage,
  localImage,
  retryKey,
  align = 'center',
  detailsVisible = false,
  announceResult = false,
}: MediaColorPreviewProps) {
  const { t } = useTranslation();
  const settings = useMediaColorSettings();
  const ignoreLightBackgrounds = target === 'hero'
    ? settings.heroIgnoreLightBackgrounds
    : settings.cardsIgnoreLightBackgrounds;
  const extractionEnabled = mode === 'auto' && enabled;
  // Use the catalogue's sample size, but keep retries in the preview cache.
  const extractionImage = customImage ? image : getMediaColorSource(image);
  const { color: extractedColor, position } = useExtractedMediaColor(
    mode === 'auto' ? extractionImage : null,
    algorithm,
    extractionEnabled,
    true,
    ignoreLightBackgrounds,
  );
  const color = mode === 'fixed' ? fixedColor : mode === 'auto' ? extractedColor : null;
  const isHero = target === 'hero';
  const { effectiveImageQuality } = useImageQuality();
  const { dpr } = useImageViewport();
  const sliderStyle = useHeroSliderStyle();
  const imageRef = useRef<HTMLDivElement>(null);
  const imageSlot = useImageSlot(imageRef, isHero);
  const imageDpr = Math.min(dpr, sliderStyle === 'morph' ? 1.5 : effectiveImageQuality === 'high' ? 3 : 2);
  const displayImage = isHero ? getTmdbImageUrl(image, {
    kind: 'backdrop', quality: effectiveImageQuality,
    role: sliderStyle === 'morph' ? 'morph' : 'hero',
    width: getCoverImageWidth(imageSlot.width || 320, imageSlot.height || 180, 16 / 9, imageDpr),
  }) : image;
  const palette = useMemo(() => color ? createMediaPalette(color, isHero ? {
    position: settings.heroGradientPosition,
    detectedPosition: position,
  } : undefined) : null, [color, isHero, position, settings.heroGradientPosition]);
  const requireImageCors = customImage && mode === 'auto';
  const imageKey = `${displayImage}-${effectiveImageQuality}-${requireImageCors}-${retryKey}`;
  const [failedImageKey, setFailedImageKey] = useState<string | null>(null);
  const imageFailed = failedImageKey === imageKey;

  const result = mode === 'off'
    ? t('settings.mediaColors.modes.offDescription')
    : mode === 'fixed'
      ? t('settings.mediaColors.previewColor', { color: fixedColor.toUpperCase() })
      : color
        ? t('settings.mediaColors.previewColor', { color: color.toUpperCase() })
        : t(color === undefined
          ? 'settings.mediaColors.previewLoading'
          : localImage
            ? 'settings.mediaColors.fileUnreadable'
            : customImage
              ? 'settings.mediaColors.customPreviewUnavailable'
              : 'settings.mediaColors.previewUnavailable');

  return (
    <div className={`min-w-0 ${isHero ? 'max-w-3xl' : `w-[144px] max-w-full md:w-[192px] ${align === 'center' ? 'mx-auto' : ''}`}`}>
      {!isHero && !imageFailed ? (
        <CarouselCard
          key={imageKey}
          item={item}
          preview={{
            posterSrc: image,
            palette,
            enabled,
            focused: detailsVisible,
            customImage,
            requireImageCors,
            onImageError: () => setFailedImageKey(imageKey),
          }}
        />
      ) : (
        <div
          ref={imageRef}
          style={palette?.style}
          className={`relative overflow-hidden rounded-xl bg-black ${isHero
            ? 'aspect-video w-full max-w-3xl border border-white/10'
            : 'mx-auto aspect-[2/3] w-[144px] max-w-full border border-white/10 md:w-[192px]'
          }`}
        >
          {imageFailed ? (
            <div className="absolute inset-0 flex items-center justify-center p-3 text-center text-xs text-gray-300">
              {t('settings.mediaColors.previewImageUnavailable')}
            </div>
          ) : (
            <img
              key={imageKey}
              src={displayImage}
              alt={title}
              loading="lazy"
              decoding="async"
              crossOrigin={requireImageCors ? 'anonymous' : undefined}
              referrerPolicy={customImage ? 'no-referrer' : undefined}
              onError={() => setFailedImageKey(imageKey)}
              className="absolute inset-0 h-full w-full object-cover"
              style={isHero ? { objectPosition: 'center 30%' } : undefined}
            />
          )}
          {!imageFailed && isHero && (
            <>
              {settings.heroBaseGradient && (
                <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ background: MEDIA_HERO_BASE_GRADIENT }} />
              )}
              {palette && (
                <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ background: palette.heroGradient }} />
              )}
              <div className="absolute inset-x-3 bottom-3 min-w-0 sm:inset-x-4 sm:bottom-4">
                <p className="truncate text-sm font-semibold text-white drop-shadow-md sm:text-base">{title}</p>
              </div>
            </>
          )}
        </div>
      )}
      <div
        id={`${id}-result`}
        role={announceResult ? 'status' : undefined}
        aria-live={announceResult ? 'polite' : undefined}
        aria-atomic={announceResult ? 'true' : undefined}
        className="mt-2 flex min-h-5 min-w-0 items-center gap-2 text-xs leading-relaxed text-gray-300"
      >
        {color && (
          <span aria-hidden="true" className="h-4 w-4 shrink-0 rounded border border-white/20" style={{ backgroundColor: color }} />
        )}
        <span className="min-w-0">{result}</span>
      </div>
    </div>
  );
}
