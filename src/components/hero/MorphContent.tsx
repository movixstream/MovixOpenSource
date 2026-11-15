import { useId, useLayoutEffect, useRef, type ReactElement } from 'react';
import type { MotionValue } from 'framer-motion';

export interface MorphFrame {
  from: number;
  to: number;
  progress: number;
}

interface MorphContentProps {
  frame: MotionValue<MorphFrame>;
  blurEnabled: boolean;
  warpEnabled: boolean;
  children: ReactElement[];
}

/** Keep the real links and text in the DOM, while melting both content layers
 * with the backdrop's clock. No React renders or independent timers per frame. */
export function MorphContent({ frame, blurEnabled, warpEnabled, children }: MorphContentProps) {
  const id = useId().replace(/:/g, '');
  const layers = useRef<(HTMLDivElement | null)[]>([]);
  const outgoingWarp = useRef<SVGFEDisplacementMapElement>(null);
  const incomingWarp = useRef<SVGFEDisplacementMapElement>(null);
  const outgoingBlur = useRef<SVGFEGaussianBlurElement>(null);
  const incomingBlur = useRef<SVGFEGaussianBlurElement>(null);

  useLayoutEffect(() => {
    const content = layers.current.map((layer) => layer?.querySelector<HTMLElement>('[data-hero-content]'));
    const render = ({ from, to, progress }: MorphFrame) => {
      const p = Math.max(0, Math.min(progress, 1));
      const moving = from !== to && p > 0 && p < 1;
      const envelope = moving ? Math.sin(p * Math.PI) : 0;
      const mix = p * p * (3 - 2 * p);
      if (warpEnabled) {
        outgoingWarp.current?.setAttribute('scale', String(64 * envelope * p));
        incomingWarp.current?.setAttribute('scale', String(-64 * envelope * (1 - p)));
        outgoingBlur.current?.setAttribute('stdDeviation', String(blurEnabled ? 7 * envelope * p : 0));
        incomingBlur.current?.setAttribute('stdDeviation', String(blurEnabled ? 7 * envelope * (1 - p) : 0));
      }

      layers.current.forEach((layer, index) => {
        if (!layer) return;
        const opacity = from === to ? Number(index === to) : index === to ? mix : index === from ? 1 - mix : 0;
        const interactive = index === to && (from === to || p >= 0.5);
        const visibility = opacity > 0 ? 'visible' : 'hidden';
        const opacityValue = String(opacity);
        const pointerEvents = interactive ? 'auto' : 'none';
        const willChange = moving && opacity > 0 ? 'opacity' : '';
        if (layer.style.visibility !== visibility) layer.style.visibility = visibility;
        if (layer.style.opacity !== opacityValue) layer.style.opacity = opacityValue;
        if (layer.style.willChange !== willChange) layer.style.willChange = willChange;
        if (layer.style.pointerEvents !== pointerEvents) {
          layer.style.pointerEvents = pointerEvents;
          layer.inert = !interactive;
          layer.setAttribute('aria-hidden', String(!interactive));
        }
        const target = content[index];
        if (target) {
          // Mobile keeps the shared fade clock without rerasterizing two SVG
          // turbulence/displacement/blur surfaces on every animation frame.
          const filter = warpEnabled && moving && opacity > 0 ? `url(#${id}-${index === from ? 'out' : 'in'})` : 'none';
          if (target.style.filter !== filter) target.style.filter = filter;
        }
      });
    };

    render(frame.get());
    return frame.on('change', render);
  }, [frame, id, blurEnabled, warpEnabled, children]);

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {warpEnabled && <svg aria-hidden="true" focusable="false" width="0" height="0" className="absolute">
        <defs>
          <filter id={`${id}-out`} x="-15%" y="-25%" width="130%" height="150%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.008 0.014" numOctaves="2" seed="11" result="noise" />
            <feDisplacementMap ref={outgoingWarp} in="SourceGraphic" in2="noise" scale="0" xChannelSelector="R" yChannelSelector="G" />
            <feGaussianBlur ref={outgoingBlur} stdDeviation="0" />
          </filter>
          <filter id={`${id}-in`} x="-15%" y="-25%" width="130%" height="150%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.008 0.014" numOctaves="2" seed="11" result="noise" />
            <feDisplacementMap ref={incomingWarp} in="SourceGraphic" in2="noise" scale="0" xChannelSelector="R" yChannelSelector="G" />
            <feGaussianBlur ref={incomingBlur} stdDeviation="0" />
          </filter>
        </defs>
      </svg>}
      {children.map((child, index) => (
        <div
          key={child.key}
          ref={(layer) => { layers.current[index] = layer; }}
          aria-hidden="true"
          className="absolute inset-0"
          style={{ visibility: 'hidden' }}
        >
          {child}
        </div>
      ))}
    </div>
  );
}
