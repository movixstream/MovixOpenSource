import { useEffect, useRef, type CSSProperties } from 'react';

/**
 * Lampe torche de la rangée « Spécial Halloween » : quand la souris survole
 * les cartes, la rangée s'assombrit et un cercle de lumière chaude suit le
 * pointeur (au clavier, il se pose sur la carte qui reçoit le focus). Le
 * calque ne capte aucun clic.
 *
 * Coût : le dégradé est peint une seule fois, sur un calque deux fois plus
 * grand que la rangée, puis seulement déplacé (`transform`) : la carte
 * graphique suit la souris sans rien repeindre. La position de la rangée est
 * mesurée à l'entrée de la souris, et de nouveau après un défilement.
 */
const HalloweenFlashlight = ({ darkness, flicker }: { darkness: number; flicker: boolean }) => {
  const overlayRef = useRef<HTMLDivElement>(null);
  const beamRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const overlay = overlayRef.current;
    const beam = beamRef.current;
    const area = overlay?.parentElement;
    if (!overlay || !beam || !area) return;

    let frame = 0;
    let x = 0;
    let y = 0;
    let rect: DOMRect | null = null;
    let pointerInside = false;

    const apply = () => {
      frame = 0;
      beam.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    };
    const aim = (clientX: number, clientY: number) => {
      rect ??= overlay.getBoundingClientRect();
      x = clientX - rect.left;
      y = clientY - rect.top;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const light = (on: boolean) => {
      overlay.dataset.lit = on ? 'true' : 'false';
    };
    const forgetRect = () => {
      rect = null;
    };

    const onEnter = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      pointerInside = true;
      rect = null;
      aim(event.clientX, event.clientY);
      light(true);
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') aim(event.clientX, event.clientY);
    };
    const onLeave = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      pointerInside = false;
      light(false);
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement;
      let keyboard = true;
      try {
        keyboard = target.matches(':focus-visible');
      } catch {
        // Navigateur sans :focus-visible : on éclaire quand même.
      }
      if (!keyboard) return;
      const box = target.getBoundingClientRect();
      rect = null;
      aim(box.left + box.width / 2, box.top + box.height / 2);
      light(true);
    };
    const onFocusOut = () => {
      if (!pointerInside) light(false);
    };

    area.addEventListener('pointerenter', onEnter);
    area.addEventListener('pointermove', onMove, { passive: true });
    area.addEventListener('pointerleave', onLeave);
    area.addEventListener('focusin', onFocusIn);
    area.addEventListener('focusout', onFocusOut);
    window.addEventListener('scroll', forgetRect, { passive: true });
    window.addEventListener('resize', forgetRect, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      area.removeEventListener('pointerenter', onEnter);
      area.removeEventListener('pointermove', onMove);
      area.removeEventListener('pointerleave', onLeave);
      area.removeEventListener('focusin', onFocusIn);
      area.removeEventListener('focusout', onFocusOut);
      window.removeEventListener('scroll', forgetRect);
      window.removeEventListener('resize', forgetRect);
    };
  }, []);

  return (
    <div
      ref={overlayRef}
      className="halloween-flashlight"
      data-lit="false"
      data-flicker={flicker}
      style={{ '--halloween-darkness': darkness } as CSSProperties}
      aria-hidden="true"
    >
      <div ref={beamRef} className="halloween-flashlight-beam" />
      <div className="halloween-flashlight-blackout" />
    </div>
  );
};

export default HalloweenFlashlight;
