import { useEffect } from 'react';
import type { EmblaCarouselType, EmblaOptionsType, EmblaPluginType } from 'embla-carousel';
import useEmblaCarousel, { type UseEmblaCarouselType } from 'embla-carousel-react';
import {
  FLEX_GAP_UPDATED_EVENT,
  getFlexGapLayoutRevision,
  type FlexGapUpdatedEventDetail,
} from '@/utils/flexGapSupport';

type FlexGapUpdatedEvent = CustomEvent<FlexGapUpdatedEventDetail>;

/**
 * Firefox peut conserver brièvement un wrapper DOM mort pendant un démontage,
 * tandis que ResizeObserver ou le repli de gap demandent encore un reInit.
 * Embla suppose alors que le viewport possède toujours son conteneur et lit
 * `querySelectorAll` sur `undefined`. Tous les accès restent dans le try : sur
 * Firefox, lire une propriété du wrapper détaché peut déjà lever une exception.
 */
export const isEmblaMounted = (emblaApi: EmblaCarouselType): boolean => {
  try {
    const root = emblaApi.rootNode();
    const container = emblaApi.containerNode();
    return Boolean(
      root?.isConnected
      && container?.isConnected
      && container.parentElement === root
    );
  } catch {
    return false;
  }
};

export const reInitMountedEmbla = (emblaApi: EmblaCarouselType): boolean => {
  if (!isEmblaMounted(emblaApi)) return false;
  try {
    emblaApi.reInit();
    return true;
  } catch (error) {
    // Le DOM peut être détaché entre la vérification et le reInit. Une erreur
    // sur un carrousel toujours monté reste une vraie erreur et doit remonter.
    if (isEmblaMounted(emblaApi)) throw error;
    return false;
  }
};

/**
 * reInit qui garde la position au pixel près. Le reInit d'Embla repart du cran
 * sélectionné : au bout d'une rangée en `containScroll`, les derniers crans
 * sont ramenés à la limite, et après l'ajout de cartes ce même cran se trouve
 * bien plus loin, ce qui téléportait la rangée sur les nouvelles cartes.
 */
export const reInitMountedEmblaKeepingLocation = (emblaApi: EmblaCarouselType): boolean => {
  if (!isEmblaMounted(emblaApi)) return false;
  const previous = emblaApi.internalEngine().location.get();
  if (!reInitMountedEmbla(emblaApi)) return false;
  const engine = emblaApi.internalEngine();
  const location = Math.min(engine.limit.max, Math.max(engine.limit.min, previous));
  for (const vector of [engine.location, engine.previousLocation, engine.offsetLocation, engine.target]) {
    vector.set(location);
  }
  engine.translate.to(location);
  let nearest = 0;
  engine.scrollSnapList.forEach((snap, index) => {
    if (Math.abs(snap - location) < Math.abs(engine.scrollSnapList[nearest] - location)) nearest = index;
  });
  engine.index.set(nearest);
  engine.indexPrevious.set(nearest);
  return true;
};

/** Callback stable pour remplacer le reInit automatique de ResizeObserver. */
export const watchMountedEmblaResize = (emblaApi: EmblaCarouselType): boolean =>
  isEmblaMounted(emblaApi);

/** Empêche MutationObserver de relancer Embla après le détachement du viewport. */
export const watchMountedEmblaSlides = (emblaApi: EmblaCarouselType): boolean =>
  isEmblaMounted(emblaApi);

/**
 * Garde les mesures d'Embla alignées sur les marges ajoutées par le repli de
 * `gap` des anciennes WebView. L'API reste identique à useEmblaCarousel.
 */
export default function useFlexGapEmblaCarousel(
  options?: EmblaOptionsType,
  plugins?: EmblaPluginType[],
): UseEmblaCarouselType {
  const guardedOptions: EmblaOptionsType = {
    ...options,
    // Conserver les callbacks personnalisés et les désactivations explicites.
    watchResize: options?.watchResize ?? watchMountedEmblaResize,
    watchSlides: options?.watchSlides ?? watchMountedEmblaSlides,
  };
  const embla = useEmblaCarousel(guardedOptions, plugins);
  const emblaApi = embla[1];

  useEffect(() => {
    if (!emblaApi || !document.documentElement.classList.contains('no-flex-gap')) {
      return undefined;
    }

    const container = emblaApi.containerNode();
    const handleFlexGapUpdated = (event: Event) => {
      const containers = (event as FlexGapUpdatedEvent).detail?.containers;
      if (!containers?.includes(container)) return;
      reInitMountedEmbla(emblaApi);
    };

    const revisionBeforeSubscription = getFlexGapLayoutRevision();
    window.addEventListener(FLEX_GAP_UPDATED_EVENT, handleFlexGapUpdated);
    const revisionAfterSubscription = getFlexGapLayoutRevision();

    // L'événement du premier rendu peut précéder la création de l'API Embla.
    // Une révision déjà publiée signifie que ses mesures doivent être relues.
    // Si le batch est encore en attente, son événement fera cette synchronisation.
    if (revisionBeforeSubscription > 0 || revisionAfterSubscription !== revisionBeforeSubscription) {
      reInitMountedEmbla(emblaApi);
    }

    return () => {
      window.removeEventListener(FLEX_GAP_UPDATED_EVENT, handleFlexGapUpdated);
    };
  }, [emblaApi]);

  return embla;
}
