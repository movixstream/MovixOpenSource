/*
 * Fond de survol qui glisse d'un élément à l'autre d'une liste.
 *
 * Adapté de « Highlight » d'Animate UI (mode « children »),
 * https://animate-ui.com — Copyright (c) 2025 Elliot Sutton.
 * Licence MIT + Commons Clause : usage permis dans une application ; vendre
 * ou redistribuer les composants eux-mêmes, seuls ou en lot, est interdit.
 * Texte complet : https://github.com/imskyleen/animate-ui/blob/main/LICENSE.md
 *
 * Changements : framer-motion au lieu de motion/react, survol seulement (ni
 * mode « parent » ni clic), suit aussi le focus clavier, et ne s'active
 * qu'avec une souris : au toucher, un survol simulé resterait accroché à
 * l'élément touché.
 */
import React, { createContext, useContext, useId, useState, useSyncExternalStore } from 'react';
import { AnimatePresence, motion, type Transition } from 'framer-motion';
import { cn } from '@/lib/utils';

const POINTER_QUERY = '(hover: hover) and (pointer: fine)';

const subscribePointer = (onChange: () => void) => {
  const query = window.matchMedia(POINTER_QUERY);
  // Safari 13 et plus anciens ne connaissent que addListener.
  if (typeof query.addEventListener === 'function') query.addEventListener('change', onChange);
  else query.addListener(onChange);
  return () => {
    if (typeof query.removeEventListener === 'function') query.removeEventListener('change', onChange);
    else query.removeListener(onChange);
  };
};

const useFinePointer = () => useSyncExternalStore(
  subscribePointer,
  () => window.matchMedia(POINTER_QUERY).matches,
  () => false,
);

// Ressort par défaut d'Animate UI : rapide, presque sans rebond.
const DEFAULT_TRANSITION: Transition = { type: 'spring', stiffness: 350, damping: 35 };

interface HoverHighlightContextValue {
  activeValue: string | null;
  setActiveValue: (value: string | null) => void;
  layoutId: string;
  className?: string;
  transition: Transition;
  enabled: boolean;
}

const HoverHighlightContext = createContext<HoverHighlightContextValue | null>(null);

interface HoverHighlightProps {
  children: React.ReactNode;
  /** Classes du fond qui glisse : forme et couleur. */
  className?: string;
  transition?: Transition;
}

/** Délimite les éléments entre lesquels le fond glisse. */
export const HoverHighlight: React.FC<HoverHighlightProps> = ({
  children, className, transition = DEFAULT_TRANSITION,
}) => {
  const [activeValue, setActiveValue] = useState<string | null>(null);
  const layoutId = `hover-highlight-${useId()}`;
  const enabled = useFinePointer();
  return (
    <HoverHighlightContext.Provider value={{ activeValue, setActiveValue, layoutId, className, transition, enabled }}>
      {children}
    </HoverHighlightContext.Provider>
  );
};

interface HoverHighlightItemProps extends React.LiHTMLAttributes<HTMLLIElement> {
  /** Identifiant unique de l'élément dans son HoverHighlight. */
  itemValue: string;
}

/**
 * Élément de liste qui reçoit le fond au survol ou au focus. Le fond est un
 * calque sous le contenu, partagé (layoutId) : en passant d'un élément à
 * l'autre, Framer Motion le déplace au lieu d'en faire apparaître un second.
 */
export const HoverHighlightItem: React.FC<HoverHighlightItemProps> = ({
  itemValue, className, children, onMouseEnter, onMouseLeave, onFocus, onBlur, ...rest
}) => {
  const context = useContext(HoverHighlightContext);
  if (!context) throw new Error('HoverHighlightItem doit être placé dans un HoverHighlight');
  const { activeValue, setActiveValue, layoutId, className: highlightClassName, transition, enabled } = context;
  const active = enabled && activeValue === itemValue;

  return (
    <li
      {...rest}
      className={cn('relative', className)}
      onMouseEnter={(event) => {
        if (enabled) setActiveValue(itemValue);
        onMouseEnter?.(event);
      }}
      onMouseLeave={(event) => {
        if (enabled) setActiveValue(null);
        onMouseLeave?.(event);
      }}
      onFocus={(event) => {
        if (enabled) setActiveValue(itemValue);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        if (enabled) setActiveValue(null);
        onBlur?.(event);
      }}
    >
      <AnimatePresence initial={false}>
        {active && (
          <motion.span
            layoutId={layoutId}
            aria-hidden="true"
            className={cn('pointer-events-none absolute inset-0 z-0', highlightClassName)}
            transition={transition}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            // Sortie retardée : en traversant un interstice entre deux
            // éléments, le fond reste et repart de là où il était.
            exit={{ opacity: 0, transition: { ...transition, delay: 0.2 } }}
          />
        )}
      </AnimatePresence>
      <div className="relative z-[1]">{children}</div>
    </li>
  );
};
