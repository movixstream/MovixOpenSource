import { useMediaQuery } from '@/components/cinegraph/useMediaQuery';

/**
 * Vrai au doigt ou sous `md` : pas de survol, les trois actions d'une carte
 * passent dans un menu « ⋯ ». Faux à la souris sur un écran large : trois
 * boutons ronds, visibles au survol et au focus clavier.
 */
export function useCompactSagaActions(): boolean {
  return !useMediaQuery('(min-width: 768px) and (hover: hover) and (pointer: fine)');
}
