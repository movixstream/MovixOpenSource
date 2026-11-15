import { useReducedMotion } from 'framer-motion';
import { useLightMode } from '@/context/LightModeContext';

/** Courbe de sortie commune aux mouvements de la page (focus, fondus). */
export const TV_EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Vrai quand la page doit rester calme : mouvement réduit du système, mode
 * léger ou transitions coupées dans Apparence. Pas de lecture auto, pas de
 * focus qui voyage, pas de palettes qui tournent.
 */
export function useCalmMotion(): boolean {
  const reduce = useReducedMotion();
  const { effectivePrefs } = useLightMode();
  return Boolean(reduce) || !effectivePrefs.transitions;
}

type LenisLike = { scrollTo: (target: HTMLElement, options?: { immediate?: boolean; force?: boolean }) => void };

/**
 * Fait défiler jusqu'à une section de la page. Passe par Lenis quand le
 * défilement doux du site est actif (il lit `scroll-margin-top`), sinon par
 * le navigateur. Le focus suit, sans second défilement.
 */
export function scrollToSection(id: string, calm: boolean): void {
  const target = document.getElementById(id);
  if (!target) return;
  const lenis = (window as typeof window & { lenis?: LenisLike }).lenis;
  if (lenis?.scrollTo) {
    lenis.scrollTo(target, { immediate: calm, force: true });
  } else {
    target.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
  }
  const heading = target.querySelector<HTMLElement>('[data-section-heading]');
  if (heading) {
    heading.focus({ preventScroll: true });
  }
}
