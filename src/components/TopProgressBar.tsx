import { useEffect, useRef, useState } from 'react';
import { getActiveChunkLoads } from '../routing/lazyWithRetry';
import { useLightMode } from '@/context/LightModeContext';
import { useTranslation } from 'react-i18next';

const SHOW_DELAY_MS = 120;
const COMPLETE_FILL_MS = 400;
const FADE_OUT_MS = 250;
const ASYMPTOTE_TAU_MS = 1200;
const ASYMPTOTE_LIMIT = 0.85;
// `--movix-accent` n'existe qu'avec le thème Halloween (orange).
const COLOR = 'rgb(var(--movix-accent, 229 9 20))';

type Phase = 'idle' | 'loading' | 'completing' | 'fading';

/**
 * YouTube-style top progress bar shown during interactive chunk loads.
 *
 * Listens for `chunk:load:start` / `chunk:load:end` window events emitted
 * by `lazyWithRetry`. The bar grows asymptotically toward 85 % during
 * load, then on end smoothly fills to 100 % (`completing`) before fading
 * out (`fading`) — no abrupt snap-and-fade. A 120 ms grace period
 * suppresses the bar entirely for cached/instant chunks.
 *
 * Mounted once at the App level; survives across route changes.
 */
const AnimatedTopProgressBar = () => {
  const [phase, setPhase] = useState<Phase>('idle');
  const startTimeRef = useRef<number>(0);
  const progressRef = useRef<number>(0);
  const barRef = useRef<HTMLDivElement | null>(null);
  const showTimerRef = useRef<number | null>(null);
  const fillTimerRef = useRef<number | null>(null);
  const fadeTimerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    // Writes the bar fill directly on the DOM node (scaleX = compositor-only)
    // instead of setState per rAF tick — no React re-render, no layout/paint.
    const updateProgress = (p: number) => {
      progressRef.current = p;
      const bar = barRef.current;
      if (bar) bar.style.transform = `scaleX(${p})`;
    };

    const startTick = () => {
      const tick = (now: number) => {
        const elapsed = now - startTimeRef.current;
        const next = ASYMPTOTE_LIMIT * (1 - Math.exp(-elapsed / ASYMPTOTE_TAU_MS));
        updateProgress(next);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    };

    const enterLoadingFresh = () => {
      startTimeRef.current = performance.now();
      updateProgress(0);
      setPhase('loading');
      startTick();
    };

    const enterLoadingResume = () => {
      const current = progressRef.current;
      // If we're already at/past the asymptote (mid-completing or mid-fading),
      // a smooth "resume" is impossible — reverse-animating from 100% to <85%
      // would look terrible. Reset cleanly instead.
      if (current >= ASYMPTOTE_LIMIT) {
        enterLoadingFresh();
        return;
      }
      const elapsedEquivalent =
        current > 0
          ? -ASYMPTOTE_TAU_MS * Math.log(1 - current / ASYMPTOTE_LIMIT)
          : 0;
      startTimeRef.current = performance.now() - elapsedEquivalent;
      setPhase('loading');
      startTick();
    };

    const cancelAllTimers = () => {
      if (showTimerRef.current !== null) {
        clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
      }
      if (fillTimerRef.current !== null) {
        clearTimeout(fillTimerRef.current);
        fillTimerRef.current = null;
      }
      if (fadeTimerRef.current !== null) {
        clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };

    const onStart = () => {
      // Restart-during-completion: cancel everything and resume from current progress
      if (fillTimerRef.current !== null || fadeTimerRef.current !== null) {
        cancelAllTimers();
        enterLoadingResume();
        return;
      }
      // Defensive: clear stale state from a previous incomplete cycle
      cancelAllTimers();
      // Wait the show delay before revealing the bar (suppresses flash on cached chunks)
      showTimerRef.current = window.setTimeout(() => {
        showTimerRef.current = null;
        enterLoadingFresh();
      }, SHOW_DELAY_MS);
    };

    const onEnd = () => {
      // If we never showed (chunk resolved before the delay), stay idle
      if (showTimerRef.current !== null) {
        clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
        setPhase('idle');
        updateProgress(0);
        return;
      }
      // Stop the asymptote animation
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      // Stage 1: smooth fill from current progress to 100% (opacity stays 1)
      setPhase('completing');
      updateProgress(1);
      fillTimerRef.current = window.setTimeout(() => {
        fillTimerRef.current = null;
        // Stage 2: fade the (now full) bar out
        setPhase('fading');
        fadeTimerRef.current = window.setTimeout(() => {
          fadeTimerRef.current = null;
          setPhase('idle');
          updateProgress(0);
        }, FADE_OUT_MS);
      }, COMPLETE_FILL_MS);
    };

    window.addEventListener('chunk:load:start', onStart);
    window.addEventListener('chunk:load:end', onEnd);

    // Cold-load handoff: a chunk may already be in flight when this effect
    // runs (event dispatched during render before the listener was attached).
    if (getActiveChunkLoads() > 0) {
      enterLoadingFresh();
    }

    return () => {
      window.removeEventListener('chunk:load:start', onStart);
      window.removeEventListener('chunk:load:end', onEnd);
      cancelAllTimers();
    };
  }, []);

  if (phase === 'idle') return null;

  const reduceMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const opacity = phase === 'fading' ? 0 : 1;

  // During `completing`, use the full fill duration as the CSS transition so
  // the catch-up to 100% interpolates smoothly. During `loading`, use a short
  // transition so the rAF-driven micro-updates blend without lag.
  const barTransition = reduceMotion
    ? 'none'
    : phase === 'completing'
      ? `transform ${COMPLETE_FILL_MS}ms ease-out`
      : 'transform 200ms ease-out';

  return (
    <div
      data-top-progress
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 3,
        zIndex: 2147483647,
        pointerEvents: 'none',
        opacity,
        transition: `opacity ${FADE_OUT_MS}ms ease-out`,
      }}
    >
      <div
        ref={barRef}
        style={{
          height: '100%',
          width: '100%',
          background: COLOR,
          boxShadow: `0 0 6px ${COLOR}, 0 0 3px ${COLOR}`,
          transform: `scaleX(${progressRef.current})`,
          transformOrigin: '0 50%',
          transition: barTransition,
          willChange: 'transform',
        }}
      />
    </div>
  );
};

const StaticTopProgressBar = () => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(() => getActiveChunkLoads() > 0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setLoading(true), SHOW_DELAY_MS);
    };
    const end = () => { clearTimeout(timer); setLoading(false); };
    window.addEventListener('chunk:load:start', start);
    window.addEventListener('chunk:load:end', end);
    if (getActiveChunkLoads() > 0) setLoading(true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('chunk:load:start', start);
      window.removeEventListener('chunk:load:end', end);
    };
  }, []);
  return loading ? (
    <div data-top-progress role="status" className="pointer-events-none fixed inset-x-0 top-0 z-[2147483647] h-0.5 bg-red-600">
      <span className="sr-only">{t('common.loading')}</span>
    </div>
  ) : null;
};

export const TopProgressBar = () => {
  const { effectivePrefs } = useLightMode();
  return effectivePrefs.loadingAnimations && effectivePrefs.transitions ? <AnimatedTopProgressBar /> : <StaticTopProgressBar />;
};
