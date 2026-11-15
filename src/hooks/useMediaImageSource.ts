import { useCallback, useState, type SyntheticEvent } from 'react';
import { getMediaColorSource } from '@/services/mediaColorService';

/** Track the responsive image that actually loaded, including cache hits and
 * source changes. A placeholder must never trigger a colour request. */
export function useMediaImageSource(source: string) {
  const [loaded, setLoaded] = useState<{ requested: string; actual: string } | null>(null);
  const onSourceLoad = useCallback((actual: string) => {
    const asset = getMediaColorSource(actual);
    if (!asset || asset !== getMediaColorSource(source)) return;
    setLoaded((previous) => previous?.requested === source && previous.actual === actual
      ? previous : { requested: source, actual });
  }, [source]);
  const imageRef = useCallback((image: HTMLImageElement | null) => {
    if (image?.complete && image.naturalWidth) onSourceLoad(image.currentSrc || image.src);
  }, [onSourceLoad]);
  const onLoad = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    onSourceLoad(event.currentTarget.currentSrc || event.currentTarget.src);
  }, [onSourceLoad]);

  return { loadedSource: loaded?.requested === source ? loaded.actual : null, imageRef, onLoad, onSourceLoad };
}
