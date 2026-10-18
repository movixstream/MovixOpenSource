import type { CSSProperties } from 'react';
import { motion, type Transition } from 'framer-motion';
import { cn } from '@/lib/utils';
import { PERFORATION_STYLE } from './focusBracketStyles';

// Crochets [ ] du logo Movix : c'est aussi le focus de l'appli télé. Ils se
// posent autour de l'élément parent (qui doit être en `position: relative`).
// Les tailles passent par des variables CSS, réglables par point de rupture :
//   --fb-gap : écart entre l'élément et les crochets
//   --fb-w   : épaisseur des barres
//   --fb-arm : longueur des branches horizontales

export type FocusBracketsSize = 'xs' | 'sm' | 'md' | 'lg';

const SIZE_CLASSES: Record<FocusBracketsSize, string> = {
  xs: '[--fb-gap:4px] [--fb-w:2px] [--fb-arm:6px]',
  sm: '[--fb-gap:5px] [--fb-w:3px] [--fb-arm:8px]',
  md: '[--fb-gap:7px] [--fb-w:4px] [--fb-arm:12px] sm:[--fb-gap:9px]',
  lg: '[--fb-gap:7px] [--fb-w:4px] [--fb-arm:16px] sm:[--fb-gap:14px] sm:[--fb-w:6px] sm:[--fb-arm:26px]',
};


const BAR_STYLE: CSSProperties = {
  width: 'var(--fb-arm)',
  borderWidth: 'var(--fb-w)',
};

interface FocusBracketsProps {
  size?: FocusBracketsSize;
  /** Trous de pellicule dans les barres, comme le logo et l'appli (par défaut). */
  perforated?: boolean;
  /** Identifiant partagé : les crochets glissent d'un élément à l'autre. */
  layoutId?: string;
  transition?: Transition;
  className?: string;
}

export function FocusBrackets({
  size = 'md',
  perforated = true,
  layoutId,
  transition,
  className,
}: FocusBracketsProps) {
  const bars = (
    <>
      <span
        className="absolute bottom-0 left-0 top-0 border-solid border-red-600 !border-r-0"
        style={BAR_STYLE}
      >
        {perforated && <span className="absolute" style={PERFORATION_STYLE} />}
      </span>
      <span
        className="absolute bottom-0 right-0 top-0 border-solid border-red-600 !border-l-0"
        style={BAR_STYLE}
      >
        {perforated && (
          <span
            className="absolute"
            style={{ ...PERFORATION_STYLE, left: 'auto', right: 'calc(var(--fb-w) * -0.75)' }}
          />
        )}
      </span>
    </>
  );

  const rootClass = cn('pointer-events-none absolute', SIZE_CLASSES[size], className);
  const rootStyle: CSSProperties = { inset: 'calc(var(--fb-gap) * -1)' };

  if (layoutId) {
    return (
      <motion.span
        aria-hidden="true"
        layoutId={layoutId}
        transition={transition}
        className={rootClass}
        style={rootStyle}
      >
        {bars}
      </motion.span>
    );
  }

  return (
    <span aria-hidden="true" className={rootClass} style={rootStyle}>
      {bars}
    </span>
  );
}

export default FocusBrackets;
