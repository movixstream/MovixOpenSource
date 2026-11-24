import { useRef, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';

/** Sortie franche : démarre vite, se pose en douceur. */
export const DETAILS_EASE_OUT = [0.23, 1, 0.32, 1] as const;

/**
 * Remplace un contenu par un autre (aperçu ↔ section dépliée, vue normale ↔
 * multi-langues). L'ancien part tout de suite, sans image où les deux se
 * superposent ; le nouveau reçoit `details-reveal` (index.css) : ses blocs et
 * ses vignettes entrent en cascade. Le bloc lui-même ne fait qu'un fondu
 * court, pour ne pas ajouter un second déplacement à celui des vignettes.
 * Rien au premier affichage de la page.
 */
export function DetailsSwap({ swapKey, children, className }: {
  swapKey: string;
  children: ReactNode;
  className?: string;
}) {
  // Pas d'AnimatePresence : React retire l'ancien contenu dans le même rendu.
  const firstKey = useRef(swapKey);
  const changed = useRef(false);
  if (swapKey !== firstKey.current) changed.current = true;
  return (
    <motion.div
      key={swapKey}
      className={cn(changed.current && 'details-reveal', className)}
      initial={changed.current ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, ease: DETAILS_EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Bloc qui s'ouvre et se referme en hauteur. Fermé, il n'est pas rendu. Le
 * débordement n'est coupé que pendant le mouvement : ouvert, les anneaux de
 * focus et les menus qu'il contient dépassent normalement.
 */
export function DetailsCollapse({ open, children, className }: {
  open: boolean;
  children: ReactNode;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="collapse"
          className={className}
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0, overflow: 'hidden' }}
          animate={reduceMotion
            ? { opacity: 1 }
            : { opacity: 1, height: 'auto', transitionEnd: { overflow: 'visible' } }}
          exit={reduceMotion
            ? { opacity: 0, transition: { duration: 0.1 } }
            : { opacity: 0, height: 0, overflow: 'hidden', transition: { duration: 0.2, ease: DETAILS_EASE_OUT } }}
          transition={{ duration: reduceMotion ? 0.15 : 0.3, ease: DETAILS_EASE_OUT }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Libellé de bouton qui change (« Multi-langues » ↔ « Retour »). Le nouveau
 * arrive avec un léger flou : l'œil lit une seule transformation au lieu de
 * deux mots qui s'échangent.
 *
 * L'ancien libellé disparaît d'un coup : une sortie animée le sortirait du
 * flux (position absolue), où un libellé long se replie sur deux lignes et
 * déborde à côté du bouton. Le premier libellé n'anime pas.
 */
export function DetailsLabelSwap({ swapKey, children, className }: {
  swapKey: string;
  children: ReactNode;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const firstKey = useRef(swapKey);
  const changed = useRef(false);
  if (swapKey !== firstKey.current) changed.current = true;
  return (
    <motion.span
      key={swapKey}
      className={className}
      initial={!changed.current ? false : reduceMotion ? { opacity: 0 } : { opacity: 0, filter: 'blur(3px)', transform: 'translateY(3px)' }}
      animate={reduceMotion
        ? { opacity: 1 }
        : { opacity: 1, filter: 'blur(0px)', transform: 'translateY(0px)', transitionEnd: { filter: 'none', transform: 'none' } }}
      transition={{ duration: 0.2, ease: DETAILS_EASE_OUT }}
    >
      {children}
    </motion.span>
  );
}
