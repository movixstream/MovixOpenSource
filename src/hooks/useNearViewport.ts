import { useEffect, useRef, useState } from 'react';

// Keep only nearby card contents mounted. The slide shell stays in the track
// so Embla can measure it, and metadata remains in the shared image cache.
const callbacks = new Map<Element, (isNearViewport: boolean) => void>();
const visibleCallbacks = new Map<Element, (isInViewport: boolean) => void>();
let observer: IntersectionObserver | undefined;
let visibleObserver: IntersectionObserver | undefined;

// `enabled` also attaches the observer when a card mounts after age filtering.
export function useNearViewport<T extends Element>(initiallyVisible = false, enabled = true) {
  const ref = useRef<T>(null);
  const [isNearViewport, setIsNearViewport] = useState(initiallyVisible);
  const [isInViewport, setIsInViewport] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') {
      setIsNearViewport(true);
      setIsInViewport(true);
      return;
    }
    observer ??= new IntersectionObserver((entries) => {
      for (const entry of entries) {
        callbacks.get(entry.target)?.(entry.isIntersecting);
      }
    }, { rootMargin: '800px 400px', threshold: 0 });
    callbacks.set(element, setIsNearViewport);
    observer.observe(element);
    // The preload margin must not give offscreen samples the same priority
    // as colours already visible on touch screens.
    visibleObserver ??= new IntersectionObserver((entries) => {
      for (const entry of entries) {
        visibleCallbacks.get(entry.target)?.(entry.isIntersecting);
      }
    });
    visibleCallbacks.set(element, setIsInViewport);
    visibleObserver.observe(element);
    return () => {
      callbacks.delete(element);
      observer?.unobserve(element);
      visibleCallbacks.delete(element);
      visibleObserver?.unobserve(element);
      if (!callbacks.size) {
        observer?.disconnect();
        observer = undefined;
        visibleObserver?.disconnect();
        visibleObserver = undefined;
      }
    };
  }, [enabled]);

  return { ref, isNearViewport, isInViewport };
}
