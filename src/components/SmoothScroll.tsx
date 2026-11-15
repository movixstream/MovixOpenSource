import { useEffect } from 'react';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import { useLightMode } from '@/context/LightModeContext';
import { readLocalStorage } from '@/utils/browserStorage';
import { isTvPlatform } from '@/utils/tvPlatform';

/**
 * Presets de fluidité Lenis — configurables via
 * `localStorage.settings_smooth_scroll_intensity` dans l'onglet Apparence.
 *
 *   - lerp : interpolation par frame (plus bas = plus d'inertie, plus fluide)
 *   - duration : durée max d'un scrollTo programmatique (secondes)
 *   - wheelMultiplier : sensibilité molette (plus bas = moins agressif)
 *
 * `standard` = valeurs historiques du projet (rétrocompat).
 * `fluid` et `ultra` offrent progressivement plus d'inertie pour un feel
 * "buttery smooth" au prix d'un léger délai de réponse.
 */
export type SmoothScrollIntensity = 'standard' | 'fluid' | 'ultra';

interface LenisPreset {
  lerp: number;
  duration: number;
  wheelMultiplier: number;
}

export const SMOOTH_SCROLL_PRESETS: Record<SmoothScrollIntensity, LenisPreset> = {
  standard: { lerp: 0.12, duration: 0.6, wheelMultiplier: 1 },
  fluid:    { lerp: 0.08, duration: 0.9, wheelMultiplier: 0.9 },
  ultra:    { lerp: 0.05, duration: 1.2, wheelMultiplier: 0.8 },
};

const getSmoothScrollIntensity = (): SmoothScrollIntensity => {
  const v = typeof window !== 'undefined'
    ? readLocalStorage('settings_smooth_scroll_intensity')
    : null;
  if (v === 'fluid' || v === 'ultra') return v;
  return 'standard';
};

// Desktop non tactile avec des ressources correctes : seul profil où on active
// Lenis par défaut (absence de préférence explicite en localStorage). Sur
// mobile/tablette tactile ou machine faible, la boucle rAF main-thread de
// Lenis amplifie le jank au lieu de le masquer — on préfère le scroll natif
// tant que l'utilisateur n'a pas explicitement opté pour Lenis dans Apparence.
const isCapableNonTouchDesktop = (): boolean => {
  if (typeof navigator === 'undefined') return false;

  const nav = navigator as Navigator & { deviceMemory?: number };
  const maxTouchPoints = nav.maxTouchPoints ?? 0;
  const deviceMemory = nav.deviceMemory ?? 8;
  const hardwareConcurrency = nav.hardwareConcurrency ?? 8;

  return maxTouchPoints === 0 && deviceMemory > 4 && hardwareConcurrency > 4;
};

// Politique à 3 états sur `settings_smooth_scroll` :
//   - 'true'  → opt-in explicite (Paramètres) : Lenis activé.
//   - 'false' → opt-out explicite : Lenis désactivé.
//   - absent/autre → activé seulement sur desktop non tactile + machine
//     correcte, sinon scroll natif (même comportement que 'false').
const getSmoothScrollSetting = (): boolean => {
  // TV : jamais de Lenis, même si le profil synchronisé l'a activé sur un PC.
  // Le D-pad déplace le focus et `scrollIntoView` fait défiler — une boucle
  // rAF d'interpolation par-dessus ne fait que ramer sur le CPU d'une dalle.
  if (isTvPlatform()) return false;
  const v = typeof window !== 'undefined'
    ? readLocalStorage('settings_smooth_scroll')
    : null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return isCapableNonTouchDesktop();
};

const LENIS_BYPASS_SELECTOR = [
  '[data-lenis-prevent]',
  '[role="dialog"]',
  '[aria-modal="true"]',
  '[data-notifications-popup]',
  '[data-radix-popper-content-wrapper]',
  '[data-radix-scroll-area-viewport]',
].join(', ');

const hasScrollableOverflow = (value: string) =>
  value === 'auto' || value === 'scroll' || value === 'overlay';

const isScrollableElement = (node: HTMLElement) => {
  const style = window.getComputedStyle(node);

  return hasScrollableOverflow(style.overflowY) || hasScrollableOverflow(style.overflowX);
};

const isFloatingLayer = (node: HTMLElement) => {
  const style = window.getComputedStyle(node);

  if (style.position !== 'fixed' && style.position !== 'absolute') {
    return false;
  }

  const zIndex = Number.parseInt(style.zIndex || '', 10);

  return Number.isNaN(zIndex) || zIndex >= 40;
};

const hasFloatingLayerAncestor = (node: HTMLElement) => {
  let current: HTMLElement | null = node;

  while (current && current !== document.body && current !== document.documentElement) {
    if (isFloatingLayer(current)) {
      return true;
    }

    current = current.parentElement;
  }

  return false;
};

// Cache la décision pour éviter le coût de getComputedStyle × N ancêtres à
// chaque wheel event. WeakMap → entrées libérées quand le nœud sort du DOM.
const preventCache = new WeakMap<HTMLElement, boolean>();

const shouldPreventLenis = (node: HTMLElement) => {
  if (node === document.body || node === document.documentElement) {
    return false;
  }

  const cached = preventCache.get(node);
  if (cached !== undefined) {
    return cached;
  }

  let result = false;
  if (node.matches(LENIS_BYPASS_SELECTOR) || node.closest(LENIS_BYPASS_SELECTOR)) {
    result = true;
  } else if (isScrollableElement(node) && hasFloatingLayerAncestor(node)) {
    result = true;
  }

  preventCache.set(node, result);
  return result;
};

const SCROLL_KEYS = new Set([
  ' ', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End',
]);

const SmoothScroll = () => {
  const { effectivePrefs } = useLightMode();
  useEffect(() => {
    const body = document.body;
    if (!body) return;
    let lenis: Lenis | null = null;
    let rafId = 0;

    const stopRaf = () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    };

    // Idle-aware RAF : on coupe le RAF dès que Lenis n'a plus rien à interpoler
    // (velocity ≈ 0 et scroll === targetScroll). Sans ça, RAF tourne 60×/s en
    // permanence et déclenche un cycle Layerize/Commit/Paint à chaque frame
    // même quand la page est immobile — coût mesuré ~6s sur 51s de trace.
    const raf = (time: number) => {
      if (!lenis || document.hidden) {
        rafId = 0;
        return;
      }

      lenis.raf(time);

      const inst = lenis as unknown as {
        velocity?: number;
        targetScroll?: number;
        animatedScroll?: number;
        scroll?: number;
        isScrolling?: boolean | string;
      };
      const velocity = Math.abs(inst.velocity ?? 0);
      const target = inst.targetScroll ?? 0;
      const animated = inst.animatedScroll ?? inst.scroll ?? target;
      const isIdle = velocity < 0.01 && Math.abs(target - animated) < 0.5 && !inst.isScrolling;

      if (isIdle) {
        rafId = 0;
        return;
      }

      rafId = requestAnimationFrame(raf);
    };

    const startRaf = () => {
      if (!lenis || rafId || document.hidden) return;
      // La pause du RAF ne doit pas avancer la nouvelle animation d'un coup.
      // Lenis repart avec un delta nul à la première frame de chaque reprise.
      lenis.time = 0;
      rafId = requestAnimationFrame(raf);
    };

    // Pose une classe `is-scrolling` sur <body> pendant que Lenis scrolle
    // vraiment + 100ms d'idle après la dernière frame. Permet aux composants
    // (carousels) de désactiver les hover effects pendant le scroll vertical.
    //
    // Important : on s'abonne à `lenis.on('scroll')` plutôt qu'aux inputs
    // utilisateur (wheel/touch/keydown). Ça garantit que la classe n'est
    // posée QUE quand Lenis bouge effectivement — un wheel horizontal
    // (trackpad sur carousel) ne fait pas bouger Lenis, donc ne pose pas
    // `is-scrolling` et n'ajoute pas de tail de 100ms après le swipe.
    let scrollIdleTimeout: number | undefined;
    let lastScrollAt = 0;
    const SCROLL_IDLE_TAIL_MS = 100;

    // Self-rescheduling timer : un seul setTimeout en vol qui se replanifie
    // tant que le scroll est récent. Évite clearTimeout+setTimeout par frame
    // Lenis (60+/sec via lenis.on('scroll')).
    const checkScrollIdle = () => {
      const elapsed = performance.now() - lastScrollAt;
      if (elapsed >= SCROLL_IDLE_TAIL_MS) {
        body.classList.remove('is-scrolling');
        scrollIdleTimeout = undefined;
      } else {
        scrollIdleTimeout = window.setTimeout(checkScrollIdle, SCROLL_IDLE_TAIL_MS - elapsed);
      }
    };

    const setIsScrollingClass = () => {
      body.classList.add('is-scrolling');
      lastScrollAt = performance.now();
      if (scrollIdleTimeout === undefined) {
        scrollIdleTimeout = window.setTimeout(checkScrollIdle, SCROLL_IDLE_TAIL_MS);
      }
    };

    // Relance le RAF sur tout input susceptible de déclencher un scroll.
    // Pas de setIsScrollingClass ici : c'est Lenis qui décide quand il scrolle.
    const onUserScrollInput = () => {
      startRaf();
    };

    const onKeydown = (e: KeyboardEvent) => {
      if (SCROLL_KEYS.has(e.key)) {
        startRaf();
      }
    };

    const initLenis = () => {
      const userEnabled = getSmoothScrollSetting();
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      // Lenis instancie ResizeObserver en interne. Le bundle legacy fournit le
      // polyfill, mais si celui-ci n'a pas été chargé, conserver le scroll natif.
      const isEnabled = userEnabled
        && !reducedMotion
        && effectivePrefs.transitions
        && typeof ResizeObserver !== 'undefined';

      if (!isEnabled) {
        if (lenis) {
          stopRaf();
          lenis.destroy();
          lenis = null;
          delete (window as typeof window & { lenis?: Lenis }).lenis;
          document.documentElement.style.scrollBehavior = 'auto';
        }
        return;
      }

      if (lenis) return;

      document.documentElement.style.scrollBehavior = 'auto';

      const preset = SMOOTH_SCROLL_PRESETS[getSmoothScrollIntensity()];
      lenis = new Lenis({
        duration: preset.duration,
        lerp: preset.lerp,
        easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        orientation: 'vertical',
        gestureOrientation: 'vertical',
        smoothWheel: true,
        syncTouch: false,
        wheelMultiplier: preset.wheelMultiplier,
        touchMultiplier: 2,
        prevent: shouldPreventLenis,
        // Lenis 1.3 : stoppe l'inertie en cours quand l'utilisateur navigue
        // vers une nouvelle route. Évite qu'un scroll en cours sur Home
        // continue à défiler la nouvelle page après le pushState.
        stopInertiaOnNavigate: true,
      });

      // Wrap scrollTo pour relancer le RAF sur scroll programmatique.
      const originalScrollTo = lenis.scrollTo.bind(lenis);
      lenis.scrollTo = ((target: Parameters<Lenis['scrollTo']>[0], options?: Parameters<Lenis['scrollTo']>[1]) => {
        const result = originalScrollTo(target, options);
        startRaf();
        return result;
      }) as Lenis['scrollTo'];

      // Pose `is-scrolling` UNIQUEMENT quand Lenis bouge effectivement.
      // Lenis est vertical-only → un wheel/swipe horizontal (carousel) ne fire
      // pas cet event → pas de tail de 100ms qui bloquait le hover.
      lenis.on('scroll', setIsScrollingClass);

      startRaf();
      (window as typeof window & { lenis?: Lenis }).lenis = lenis;
    };

    initLenis();

    // Rebuild Lenis pour appliquer un nouveau preset / nouvel état OS :
    // destroy puis init.
    const rebuildLenis = () => {
      if (lenis) {
        stopRaf();
        lenis.destroy();
        lenis = null;
        delete (window as typeof window & { lenis?: Lenis }).lenis;
      }
      initLenis();
    };

    const handleStorageChange = (e: StorageEvent | CustomEvent) => {
      if (e instanceof StorageEvent
        && e.key !== 'settings_smooth_scroll'
        && e.key !== 'settings_smooth_scroll_intensity') return;
      rebuildLenis();
    };

    const handleVisibilityChange = () => {
      if (!lenis) return;

      if (document.hidden) {
        stopRaf();
        lenis.stop();
        return;
      }

      lenis.start();
      startRaf();
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('settings_smooth_scroll_changed', handleStorageChange as EventListener);
    window.addEventListener('settings_smooth_scroll_intensity_changed', handleStorageChange as EventListener);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Honore prefers-reduced-motion (a11y WCAG 2.3.3) : Lenis détruit/recréé
    // selon le toggle OS sans reload. Safari ≤13 ne supporte pas
    // addEventListener sur MediaQueryList (ajouté en Safari 14) — fallback
    // sur addListener/removeListener legacy.
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const legacyMql = reducedMotionQuery as MediaQueryList & {
      addListener?: (cb: (e: MediaQueryListEvent) => void) => void;
      removeListener?: (cb: (e: MediaQueryListEvent) => void) => void;
    };
    if (typeof reducedMotionQuery.addEventListener === 'function') {
      reducedMotionQuery.addEventListener('change', rebuildLenis);
    } else if (typeof legacyMql.addListener === 'function') {
      legacyMql.addListener(rebuildLenis);
    }
    // Capture: catch input avant que Lenis ne le consomme — on relance le RAF
    // dès qu'un input susceptible de déclencher un scroll arrive.
    window.addEventListener('wheel', onUserScrollInput, { passive: true, capture: true });
    window.addEventListener('touchmove', onUserScrollInput, { passive: true, capture: true });
    window.addEventListener('keydown', onKeydown, { passive: true, capture: true });

    return () => {
      stopRaf();

      if (scrollIdleTimeout !== undefined) {
        window.clearTimeout(scrollIdleTimeout);
        scrollIdleTimeout = undefined;
      }
      body.classList.remove('is-scrolling');

      if (lenis) {
        lenis.destroy();
        delete (window as typeof window & { lenis?: Lenis }).lenis;
      }

      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('settings_smooth_scroll_changed', handleStorageChange as EventListener);
      window.removeEventListener('settings_smooth_scroll_intensity_changed', handleStorageChange as EventListener);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (typeof reducedMotionQuery.removeEventListener === 'function') {
        reducedMotionQuery.removeEventListener('change', rebuildLenis);
      } else if (typeof legacyMql.removeListener === 'function') {
        legacyMql.removeListener(rebuildLenis);
      }
      window.removeEventListener('wheel', onUserScrollInput, { capture: true });
      window.removeEventListener('touchmove', onUserScrollInput, { capture: true });
      window.removeEventListener('keydown', onKeydown, { capture: true });
    };
  }, [effectivePrefs.transitions]);

  return null;
};

export default SmoothScroll;
