import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { dripSampleSource, paintDripDither, type DripTint } from './dripCanvas';

/**
 * Branche le voile tramé de la coulure (`dripCanvas.ts`) sur le fond d'une
 * grande image. Rend `true` une fois le canevas peint : le fond doit alors
 * lui laisser la fin du voile et retirer la nappe des gouttes, qu'il porte
 * lui-même. Tant que c'est `false` (image pas encore lue, mode léger, calque
 * inconnu), le voile CSS fait tout le travail.
 *
 * `tintColor` (`#rrggbb`) : la coulure est teintée de cette couleur
 * (`dripColor` de `DetailsHeroBackdrop`) ; le canevas fait de même.
 *
 * Repeint quand le fond change de taille, et à chaque rendu où `watched`
 * (les calques de la page) a changé : la teinte de l'image arrive après coup.
 * Si rien n'a bougé, la peinture n'est pas refaite.
 */
export function useDripDither(
  frameRef: RefObject<HTMLElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  src: string | null,
  watched: unknown,
  tintColor?: string | null,
): boolean {
  const [loaded, setLoaded] = useState<{ src: string; sample: HTMLImageElement } | null>(null);
  const [painted, setPainted] = useState<string | null>(null);
  const signature = useRef<string | null>(null);
  const timer = useRef(0);
  const tint = useMemo<DripTint | null>(() => {
    const hex = tintColor ? /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(tintColor) : null;
    return hex ? [parseInt(hex[1], 16), parseInt(hex[2], 16), parseInt(hex[3], 16)] : null;
  }, [tintColor]);
  const sample = loaded && loaded.src === src ? loaded.sample : null;

  // Petite copie lisible de l'image.
  useEffect(() => {
    const readable = src ? dripSampleSource(src) : null;
    if (!src || !readable) return;
    const image = new Image();
    if (readable.cors) image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => setLoaded({ src, sample: image });
    image.src = readable.url;
    return () => { image.onload = null; };
  }, [src]);

  const schedule = useCallback(() => {
    if (timer.current) return;
    timer.current = window.setTimeout(() => {
      timer.current = 0;
      const frame = frameRef.current;
      const canvas = canvasRef.current;
      signature.current = frame && canvas && sample ? paintDripDither(frame, canvas, sample, signature.current, tint) : null;
      setPainted(signature.current && src);
    }, 50);
  }, [frameRef, canvasRef, sample, src, tint]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !sample || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(schedule);
    observer.observe(frame);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer.current);
      timer.current = 0;
      signature.current = null;
    };
  }, [frameRef, sample, schedule]);

  useEffect(() => {
    if (sample) schedule();
  }, [sample, schedule, watched]);

  return Boolean(src) && painted === src;
}
