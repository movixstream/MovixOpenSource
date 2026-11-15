import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { PERFORATION_STYLE } from './focusBracketStyles';

/*
 * Titre à focus mobile, adapté de « TrueFocus » de React Bits (David Haz,
 * https://github.com/DavidHDev/react-bits, public/r/TrueFocus-TS-TW.json,
 * commit 14330e69). Licence MIT + Commons Clause : usage libre dans un site,
 * pas de revente des composants eux-mêmes.
 *
 * Adaptations pour Movix :
 * - framer-motion 11 du projet au lieu de motion 12 (pas de nouvelle dépendance) ;
 * - quatre coins remplacés par les crochets [ ] perforés du logo, qui sont aussi
 *   le focus de l'appli télé ;
 * - pas de flou : les mots hors focus sont seulement atténués, le titre reste lisible ;
 * - pas de boucle infinie : le focus suit un trajet (par défaut « Movix » puis
 *   le dernier mot) et s'y arrête ; au survol, il suit la souris comme la
 *   télécommande, puis revient ;
 * - lecteurs d'écran : la phrase entière est lue une fois, les mots animés sont masqués.
 */

interface WordRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface BracketFocusTitleProps {
  /** Phrase lue par les lecteurs d'écran. */
  label: string;
  /** Mots affichés, dans l'ordre. */
  words: string[];
  /** Mot où le focus s'arrête (par défaut le dernier). */
  restIndex?: number;
  /** Mots visités avant l'arrêt, dans l'ordre. */
  path?: number[];
  /** Pas d'animation : le focus est posé directement sur le mot d'arrêt. */
  calm: boolean;
  className?: string;
}

const STEP_DELAY_MS = 1100;
const RETURN_DELAY_MS = 450;
const FOCUS_TRANSITION = { duration: 0.55, ease: [0.65, 0, 0.35, 1] as const };

export function BracketFocusTitle({
  label,
  words,
  restIndex,
  path,
  calm,
  className,
}: BracketFocusTitleProps) {
  const rest = Math.min(Math.max(restIndex ?? words.length - 1, 0), Math.max(words.length - 1, 0));
  const trail = path && path.length > 0 ? path : [0, rest];
  const [activeIndex, setActiveIndex] = useState(() => (calm ? rest : trail[0] ?? rest));
  const [rect, setRect] = useState<WordRect | null>(null);
  const containerRef = useRef<HTMLSpanElement>(null);
  const wordRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const returnTimer = useRef<number | null>(null);
  const travelDone = useRef(calm);

  // Trajet d'ouverture : un seul passage, puis le focus reste sur le mot d'arrêt.
  useEffect(() => {
    if (calm) {
      travelDone.current = true;
      setActiveIndex(rest);
      return undefined;
    }
    const timers = trail.slice(1).map((index, step) => window.setTimeout(() => {
      setActiveIndex(index);
      if (step === trail.length - 2) travelDone.current = true;
    }, STEP_DELAY_MS * (step + 1)));
    if (trail.length < 2) travelDone.current = true;
    return () => timers.forEach((timer) => window.clearTimeout(timer));
    // Le trajet ne se rejoue pas quand la langue change, seulement au montage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calm]);

  useEffect(() => () => {
    if (returnTimer.current) window.clearTimeout(returnTimer.current);
  }, []);

  // Mesure du mot actif, comme TrueFocus : positions relatives au conteneur.
  useLayoutEffect(() => {
    const container = containerRef.current;
    const word = wordRefs.current[activeIndex];
    if (!container || !word) return undefined;

    const measure = () => {
      const next = { x: word.offsetLeft, y: word.offsetTop, width: word.offsetWidth, height: word.offsetHeight };
      setRect((prev) => (
        prev && prev.x === next.x && prev.y === next.y && prev.width === next.width && prev.height === next.height
          ? prev
          : next
      ));
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    wordRefs.current.forEach((node) => node && observer.observe(node));
    return () => observer.disconnect();
  }, [activeIndex, words]);

  const focusWord = useCallback((index: number) => {
    if (!travelDone.current) return;
    if (returnTimer.current) {
      window.clearTimeout(returnTimer.current);
      returnTimer.current = null;
    }
    setActiveIndex(index);
  }, []);

  const backToRest = useCallback(() => {
    if (!travelDone.current) return;
    if (returnTimer.current) window.clearTimeout(returnTimer.current);
    returnTimer.current = window.setTimeout(() => setActiveIndex(rest), RETURN_DELAY_MS);
  }, [rest]);

  // Crochets proportionnels à la hauteur de ligne du mot.
  const metrics = rect && {
    gap: Math.round(rect.height * 0.1),
    bar: Math.max(3, Math.round(rect.height * 0.075)),
    arm: Math.max(8, Math.round(rect.height * 0.2)),
  };
  const transition = calm ? { duration: 0 } : FOCUS_TRANSITION;

  return (
    <h1 className={cn('relative', className)}>
      <span className="sr-only">{label}</span>
      <span
        ref={containerRef}
        aria-hidden="true"
        className="relative inline-flex flex-wrap items-baseline gap-x-[0.26em] gap-y-[0.08em]"
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') backToRest();
        }}
      >
        {words.map((word, index) => (
          <span
            key={`${word}-${index}`}
            ref={(node) => {
              wordRefs.current[index] = node;
            }}
            onPointerEnter={(event) => {
              // Souris seulement : au doigt, le focus garde son trajet.
              if (event.pointerType === 'mouse') focusWord(index);
            }}
            className="relative select-none transition-opacity duration-500 motion-reduce:transition-none"
            style={{ opacity: index === activeIndex ? 1 : 0.6 }}
          >
            {word}
          </span>
        ))}

        {rect && metrics && (
          <>
            <motion.span
              className="pointer-events-none absolute left-0 top-0 border-solid border-red-600 !border-r-0"
              style={{ borderWidth: metrics.bar, width: metrics.arm, ['--fb-w' as string]: `${metrics.bar}px` }}
              initial={{ x: rect.x - metrics.gap, y: rect.y, height: rect.height, opacity: 0 }}
              animate={{ x: rect.x - metrics.gap, y: rect.y, height: rect.height, opacity: 1 }}
              transition={transition}
            >
              <span className="absolute" style={PERFORATION_STYLE} />
            </motion.span>
            <motion.span
              className="pointer-events-none absolute left-0 top-0 border-solid border-red-600 !border-l-0"
              style={{ borderWidth: metrics.bar, width: metrics.arm, ['--fb-w' as string]: `${metrics.bar}px` }}
              initial={{ x: rect.x + rect.width + metrics.gap - metrics.arm, y: rect.y, height: rect.height, opacity: 0 }}
              animate={{ x: rect.x + rect.width + metrics.gap - metrics.arm, y: rect.y, height: rect.height, opacity: 1 }}
              transition={transition}
            >
              <span className="absolute" style={{ ...PERFORATION_STYLE, left: 'auto', right: `calc(var(--fb-w) * -0.75)` }} />
            </motion.span>
          </>
        )}
      </span>
    </h1>
  );
}

export default BracketFocusTitle;
