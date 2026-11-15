import { useLightMode } from '@/context/LightModeContext';
import { LightweightLoading } from '@/components/LightweightLoading';

/**
 * Top-of-page progress bar shown while a route chunk is loading.
 *
 * Used as the Suspense fallback for routes that don't have a matching
 * skeleton (auth, settings, help, etc.). CSS-only animation, no JS state.
 */
export const RouteProgressBar = () => {
  const { effectivePrefs } = useLightMode();
  if (!effectivePrefs.loadingAnimations || !effectivePrefs.transitions) return <LightweightLoading />;
  return (
  <div
    aria-hidden
    style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      height: 3,
      zIndex: 9999,
      pointerEvents: 'none',
      overflow: 'hidden',
      background: 'transparent',
    }}
  >
    <div
      style={{
        height: '100%',
        width: '40%',
        background: 'linear-gradient(90deg, transparent, rgb(var(--movix-accent, 229 9 20)), transparent)',
        animation: 'movix-route-progress 1.2s ease-in-out infinite',
        willChange: 'transform',
      }}
    />
    <style>{`
      @keyframes movix-route-progress {
        0%   { transform: translateX(-100%); }
        100% { transform: translateX(350%); }
      }
    `}</style>
  </div>
  );
};
