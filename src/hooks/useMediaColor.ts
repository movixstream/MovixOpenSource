import { useEffect, useMemo, useState } from 'react';
import { useMediaColorSettings, type MediaColorTarget } from './useMediaColorSettings';
import { getMediaColorPreviewSource, getMediaColorSource, getMediaImageSource, readMediaColor, readMediaColorEntry, subscribeMediaColor } from '@/services/mediaColorService';
import { createMediaPalette, type HeroGradientCardinal, type MediaColorAlgorithm } from '@/utils/mediaColors';

export interface ExtractedColorState {
  color: string | null | undefined;
  position: HeroGradientCardinal;
}

/** Shared by catalogue artwork and settings examples so previews show the
 * exact result of the selected algorithm, including loading/failure states. */
export function useExtractedMediaColor(
  image: string | null | undefined,
  algorithm: MediaColorAlgorithm,
  enabled = true,
  preview = false,
  ignoreLightBackgrounds = true,
  priority = false,
  displayedImage?: string | null,
): ExtractedColorState {
  const source = preview ? getMediaColorPreviewSource(image, true)
    : displayedImage === undefined ? getMediaColorSource(image) : getMediaImageSource(displayedImage ?? image);
  const ready = enabled && displayedImage !== null;
  const reuseImage = displayedImage !== undefined;
  const [entry, setEntry] = useState<{ source: string | null; algorithm: MediaColorAlgorithm; preview: boolean; ignoreLightBackgrounds: boolean; color: string | null | undefined; position: HeroGradientCardinal }>(() => {
    const cached = source ? readMediaColorEntry(source, algorithm, preview, ignoreLightBackgrounds) : null;
    return {
      source,
      algorithm,
      preview,
      ignoreLightBackgrounds,
      color: cached ? cached.color : source ? readMediaColor(source, algorithm, preview, ignoreLightBackgrounds) : null,
      position: cached ? cached.position : 'bottom-left',
    };
  });

  useEffect(() => {
    if (!source || !ready) return;
    return subscribeMediaColor(source, algorithm, (res) => setEntry({
      source,
      algorithm,
      preview,
      ignoreLightBackgrounds,
      color: res.color,
      position: res.position,
    }), preview, ignoreLightBackgrounds, priority || preview, reuseImage);
  }, [source, algorithm, ready, preview, ignoreLightBackgrounds, priority, reuseImage]);

  if (!source) return { color: null, position: 'bottom-left' };
  if (entry.source === source && entry.algorithm === algorithm && entry.preview === preview && entry.ignoreLightBackgrounds === ignoreLightBackgrounds) {
    return { color: entry.color, position: entry.position };
  }
  const cached = readMediaColorEntry(source, algorithm, preview, ignoreLightBackgrounds);
  return {
    color: cached ? cached.color : undefined,
    position: cached ? cached.position : 'bottom-left',
  };
}

export function useMediaColor(target: MediaColorTarget, image: string | null | undefined, enabled = true, priority = false, displayedImage?: string | null) {
  const settings = useMediaColorSettings();
  const mode = target === 'hero' ? settings.heroMode : settings.cardsMode;
  const fixedColor = target === 'hero' ? settings.heroColor : settings.cardsColor;
  const algorithm = target === 'hero' ? settings.heroAlgorithm : settings.cardsAlgorithm;
  const ignoreLightBackgrounds = target === 'hero' ? settings.heroIgnoreLightBackgrounds : settings.cardsIgnoreLightBackgrounds;
  const extracted = useExtractedMediaColor(mode === 'auto' ? image : null, algorithm, enabled && mode === 'auto', false, ignoreLightBackgrounds, priority, mode === 'auto' ? displayedImage : undefined);
  const color = mode === 'fixed' ? fixedColor : mode === 'auto' ? extracted.color : null;
  const position = extracted.position;

  return useMemo(() => {
    if (!color) return null;
    return createMediaPalette(color, target === 'hero' ? {
      position: settings.heroGradientPosition,
      detectedPosition: position,
    } : undefined);
  }, [color, target, settings.heroGradientPosition, position]);
}
