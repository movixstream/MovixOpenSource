import { useEffect } from 'react';
import type { EmblaCarouselType } from 'embla-carousel';
import { beginEmblaScroll, endEmblaScroll } from '../utils/scrollingState';

/**
 * Pose `body.embla-scrolling` pendant que le carousel scrolle activement.
 *
 * Détection 100% basée sur le delta de `offsetLocation` entre frames
 * (approche cinepulse). Pas de release-on-pointerUp : si l'utilisateur
 * "balance" en drag-free, la momentum continue et les cards bougent encore.
 * Le hover ne doit revenir que quand le delta tombe sous le seuil — i.e.
 * quand les cards ralentissent réellement, pas à la release du drag.
 *
 * Sources de suppression :
 *  - Wheel horizontal sur le rootNode : suppress préemptive (avant qu'embla
 *    ne bouge la frame 1, sinon ~16ms de fenêtre où le hover peut flipper).
 *  - Scroll event d'embla : suppress dès que delta > 0.5 px/frame.
 *
 * Sources de release :
 *  - Scroll event avec delta < 0.2 px/frame (cards quasi-immobiles).
 *  - Settle (safety net à vélocité 0).
 *
 * Hystérésis :
 *  - delta > 0.5 px/frame : suppress  (cards défilent visiblement)
 *  - delta < 0.2 px/frame : release   (cards quasi-immobiles, hover OK)
 *  - entre les deux       : pas de changement (anti-flicker)
 */
const DELTA_SUPPRESS = 0.5;
const DELTA_RELEASE = 0.2;

export const useEmblaScrollSuppress = (
  emblaApi: EmblaCarouselType | undefined,
): void => {
  useEffect(() => {
    if (!emblaApi) return;

    let suppressed = false;
    let lastLocation = 0;
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;

    const suppress = () => {
      clearTimeout(releaseTimer);
      // A wheel at a boundary, a jump without transitions or a reInit may
      // produce no settle event. Never leave every carousel unclickable.
      releaseTimer = setTimeout(release, 180);
      if (suppressed) return;
      suppressed = true;
      beginEmblaScroll();
    };
    const release = () => {
      clearTimeout(releaseTimer);
      releaseTimer = undefined;
      if (!suppressed) return;
      suppressed = false;
      endEmblaScroll();
    };

    const readLocation = (): number => {
      try {
        const engine = (
          emblaApi as unknown as {
            internalEngine: () => { offsetLocation: { get: () => number } };
          }
        ).internalEngine();
        return Number(engine.offsetLocation.get().toFixed(2));
      } catch {
        return lastLocation;
      }
    };

    const onScroll = () => {
      const loc = readLocation();
      const delta = Math.abs(loc - lastLocation);
      lastLocation = loc;
      if (delta > DELTA_SUPPRESS) {
        suppress();
      } else if (suppressed && delta < DELTA_RELEASE) {
        release();
      }
    };
    const onSettle = () => {
      lastLocation = readLocation();
      release();
    };

    // Suppress préemptive sur wheel HORIZONTAL : sinon le scroll event ne
    // fire qu'à la frame 1 (après ~16ms), pendant lesquelles le :hover peut
    // flipper sur la card sous le curseur.
    const rootNode = emblaApi.rootNode();
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 1) {
        if (e.deltaX > 0 ? !emblaApi.canScrollNext() : !emblaApi.canScrollPrev()) return;
        suppress();
        // refresh lastLocation pour que le delta du premier scroll suivant
        // soit calculé correctement (sinon delta = abs(loc - stale_value)).
        lastLocation = readLocation();
      }
    };
    rootNode?.addEventListener('wheel', onWheel, { passive: true });

    lastLocation = readLocation();

    emblaApi.on('scroll', onScroll);
    emblaApi.on('settle', onSettle);

    return () => {
      rootNode?.removeEventListener('wheel', onWheel);
      emblaApi.off('scroll', onScroll);
      emblaApi.off('settle', onSettle);
      release();
    };
  }, [emblaApi]);
};
