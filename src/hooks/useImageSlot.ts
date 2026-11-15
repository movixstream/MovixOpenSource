import { useLayoutEffect, useState, type RefObject } from 'react';

type Slot = { width: number; height: number };
const listeners = new Map<Element, (slot: Slot) => void>();
let observer: ResizeObserver | undefined;

// A shared observer also handles custom search-grid densities and settings
// previews without adding one window resize handler for every poster.
export function useImageSlot(ref: RefObject<HTMLElement>, enabled = true): Slot {
  const [slot, setSlot] = useState<Slot>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;
    const update = ({ width, height }: Slot) => {
      const next = { width: Math.ceil(width), height: Math.ceil(height) };
      setSlot((previous) => previous.width === next.width && previous.height === next.height ? previous : next);
    };
    update(element.getBoundingClientRect());
    if (typeof ResizeObserver === 'undefined') {
      const resize = () => update(element.getBoundingClientRect());
      window.addEventListener('resize', resize);
      return () => window.removeEventListener('resize', resize);
    }
    observer ??= new ResizeObserver((entries) => {
      for (const entry of entries) listeners.get(entry.target)?.(entry.contentRect);
    });
    listeners.set(element, update);
    observer.observe(element);
    return () => {
      listeners.delete(element);
      observer?.unobserve(element);
      if (!listeners.size) { observer?.disconnect(); observer = undefined; }
    };
  }, [ref, enabled]);
  return slot;
}
