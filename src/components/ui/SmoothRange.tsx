import React, { useCallback, useEffect, useImperativeHandle, useRef } from 'react';

const clampValue = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export interface SmoothRangeProps {
  label: string;
  min: number;
  max: number;
  keyboardStep: number;
  step?: number;
  value: number;
  outputRef?: { current: HTMLElement | null };
  formatValue?: (value: number) => string;
  animateExternalValue?: boolean;
  disabled?: boolean;
  accentColor?: string;
  onFocus?: React.FocusEventHandler<HTMLDivElement>;
  onBlur?: React.FocusEventHandler<HTMLDivElement>;
  onPreview: (value: number) => void;
  onCommit?: () => void;
}

export interface SmoothRangeHandle {
  animateTo: (value: number) => void;
}

export const SmoothRange = React.forwardRef<SmoothRangeHandle, SmoothRangeProps>(({
  label,
  min,
  max,
  keyboardStep,
  step,
  value,
  outputRef,
  formatValue = String,
  animateExternalValue = true,
  disabled = false,
  accentColor = '#dc2626',
  onFocus,
  onBlur,
  onPreview,
  onCommit,
}, forwardedRef) => {
  const sliderRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const currentValueRef = useRef(value);
  const visualValueRef = useRef(value);
  // React ne doit pas replacer le curseur sur un cran lors des rendus de l'aperçu.
  const initialProgressRef = useRef(max === min ? 0 : ((clampValue(value, min, max) - min) / (max - min)) * 100);
  const pendingClientXRef = useRef<number | null>(null);
  const sliderBoundsRef = useRef({ left: 0, width: 1 });
  const frameRef = useRef<number | null>(null);
  const externalAnimationFrameRef = useRef<number | null>(null);
  const externalTargetValueRef = useRef(value);
  const externalAnimationTimestampRef = useRef<number | null>(null);
  const interactingRef = useRef(false);

  const normalizeInteraction = useCallback((next: number) => {
    const bounded = clampValue(next, min, max);
    return step && step > 0 ? clampValue(Number((min + Math.round((bounded - min) / step) * step).toFixed(8)), min, max) : bounded;
  }, [min, max, step]);

  const applyVisualValue = useCallback((next: number) => {
    const normalized = clampValue(next, min, max);
    const progress = max === min ? 0 : ((normalized - min) / (max - min)) * 100;
    visualValueRef.current = normalized;
    if (fillRef.current) fillRef.current.style.transform = `scaleX(${progress / 100})`;
    if (thumbRef.current) thumbRef.current.style.transform = `translate3d(${progress}%, 0, 0)`;
  }, [max, min]);

  const applyValue = useCallback((next: number) => {
    const normalized = clampValue(next, min, max);
    currentValueRef.current = normalized;
    sliderRef.current?.setAttribute('aria-valuenow', normalized.toFixed(2));
    sliderRef.current?.setAttribute('aria-valuetext', formatValue(normalized));
    if (outputRef?.current instanceof HTMLInputElement) {
      outputRef.current.value = formatValue(normalized);
      outputRef.current.setAttribute('aria-valuenow', normalized.toFixed(2));
    } else if (outputRef?.current) {
      outputRef.current.textContent = formatValue(normalized);
    }
  }, [formatValue, max, min, outputRef]);

  const animateTo = useCallback((nextValue: number) => {
    const target = clampValue(nextValue, min, max);
    applyValue(target);
    externalTargetValueRef.current = target;
    const visualEpsilon = Math.max((max - min) * 0.001, Number.EPSILON);
    if (!animateExternalValue || window.matchMedia('(prefers-reduced-motion: reduce)').matches || Math.abs(target - visualValueRef.current) < visualEpsilon) {
      if (externalAnimationFrameRef.current !== null) window.cancelAnimationFrame(externalAnimationFrameRef.current);
      externalAnimationFrameRef.current = null;
      externalAnimationTimestampRef.current = null;
      applyVisualValue(target);
      return;
    }
    if (externalAnimationFrameRef.current !== null) return;

    const animate = (timestamp: number) => {
      const previousTimestamp = externalAnimationTimestampRef.current;
      const elapsedMs = previousTimestamp === null
        ? 1000 / 60
        : Math.min(34, Math.max(0, timestamp - previousTimestamp));
      externalAnimationTimestampRef.current = timestamp;
      const liveTarget = externalTargetValueRef.current;
      const smoothing = 1 - Math.exp(-elapsedMs / 72);
      const next = visualValueRef.current + (liveTarget - visualValueRef.current) * smoothing;

      if (Math.abs(liveTarget - next) < visualEpsilon) {
        applyVisualValue(liveTarget);
        externalAnimationFrameRef.current = null;
        externalAnimationTimestampRef.current = null;
        return;
      }

      applyVisualValue(next);
      externalAnimationFrameRef.current = window.requestAnimationFrame(animate);
    };
    externalAnimationTimestampRef.current = null;
    externalAnimationFrameRef.current = window.requestAnimationFrame(animate);
  }, [animateExternalValue, applyValue, applyVisualValue, max, min]);

  useImperativeHandle(forwardedRef, () => ({ animateTo }), [animateTo]);

  useEffect(() => {
    if (!interactingRef.current) animateTo(value);
  }, [animateTo, value]);

  useEffect(() => () => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    if (externalAnimationFrameRef.current !== null) window.cancelAnimationFrame(externalAnimationFrameRef.current);
  }, []);

  const applyPendingPoint = useCallback(() => {
    frameRef.current = null;
    const clientX = pendingClientXRef.current;
    // Une frame déjà en attente ne doit plus modifier un contrôle désactivé.
    if (clientX === null || sliderRef.current?.getAttribute('aria-disabled') === 'true') return;
    const { left, width } = sliderBoundsRef.current;
    const ratio = clampValue((clientX - left) / width, 0, 1);
    const next = min + ratio * (max - min);
    // Le curseur suit le pointeur en continu, la valeur garde les crans autorisés.
    applyVisualValue(next);
    const selected = normalizeInteraction(next);
    applyValue(selected);
    onPreview(selected);
  }, [applyValue, applyVisualValue, max, min, normalizeInteraction, onPreview]);

  const schedulePoint = useCallback((clientX: number) => {
    pendingClientXRef.current = clientX;
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(applyPendingPoint);
  }, [applyPendingPoint]);

  const flushPoint = useCallback(() => {
    if (frameRef.current === null) return;
    window.cancelAnimationFrame(frameRef.current);
    applyPendingPoint();
  }, [applyPendingPoint]);

  const finishInteraction = useCallback((event: React.PointerEvent<HTMLDivElement>, applyFinalPoint = true) => {
    if (!interactingRef.current) return;
    if (applyFinalPoint) schedulePoint(event.clientX);
    flushPoint();
    pendingClientXRef.current = null;
    interactingRef.current = false;
    sliderRef.current?.removeAttribute('data-dragging');
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    animateTo(currentValueRef.current);
    onCommit?.();
  }, [animateTo, flushPoint, onCommit, schedulePoint]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    let next = currentValueRef.current;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next -= keyboardStep;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next += keyboardStep;
    else if (event.key === 'Home') next = min;
    else if (event.key === 'End') next = max;
    else return;
    event.preventDefault();
    const selected = normalizeInteraction(next);
    animateTo(selected);
    onPreview(selected);
    onCommit?.();
  }, [animateTo, disabled, keyboardStep, max, min, normalizeInteraction, onCommit, onPreview]);

  return (
    <div
      ref={sliderRef}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={formatValue(value)}
      onFocus={onFocus}
      onBlur={onBlur}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0 || !event.isPrimary) return;
        if (externalAnimationFrameRef.current !== null) {
          window.cancelAnimationFrame(externalAnimationFrameRef.current);
          externalAnimationFrameRef.current = null;
        }
        externalAnimationTimestampRef.current = null;
        externalTargetValueRef.current = currentValueRef.current;
        const rect = event.currentTarget.getBoundingClientRect();
        sliderBoundsRef.current = { left: rect.left, width: Math.max(rect.width, 1) };
        interactingRef.current = true;
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.setAttribute('data-dragging', 'true');
        schedulePoint(event.clientX);
      }}
      onPointerMove={(event) => !disabled && interactingRef.current && schedulePoint(event.clientX)}
      onPointerUp={(event) => finishInteraction(event)}
      onPointerCancel={(event) => finishInteraction(event, false)}
      onLostPointerCapture={(event) => finishInteraction(event, false)}
      onKeyDown={handleKeyDown}
      className={`group relative flex h-11 w-full touch-none items-center outline-none focus-visible:ring-2 focus-visible:ring-[var(--smooth-range-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950 ${disabled ? 'cursor-default opacity-60' : 'cursor-pointer'}`}
      style={{ '--smooth-range-accent': accentColor } as React.CSSProperties}
    >
      <div className="pointer-events-none relative h-1.5 w-full overflow-hidden rounded-full bg-white/15">
        <div
          ref={fillRef}
          className="absolute inset-0 origin-left rounded-full bg-[var(--smooth-range-accent)] will-change-transform"
          style={{ transform: `scaleX(${initialProgressRef.current / 100})` }}
        />
      </div>
      <div
        ref={thumbRef}
        className="pointer-events-none absolute inset-x-0 top-1/2 h-0 will-change-transform"
        style={{ transform: `translate3d(${initialProgressRef.current}%, 0, 0)` }}
      >
        <div className="absolute left-0 top-0 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--smooth-range-accent)] shadow-lg shadow-black/40 transition-[transform,box-shadow] duration-150 motion-reduce:transition-none [@media(hover:hover)]:group-hover:scale-125 group-data-[dragging=true]:scale-[1.4]" />
      </div>
    </div>
  );
});
SmoothRange.displayName = 'SmoothRange';
