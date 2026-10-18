/*
 * Bouton qui se remplit d'un liquide au survol, comme le bouton Explorer.
 *
 * Idée reprise du « Liquid Button » d'Animate UI, https://animate-ui.com —
 * Copyright (c) 2025 Elliot Sutton. Licence MIT + Commons Clause : usage
 * permis dans une application ; vendre ou redistribuer les composants
 * eux-mêmes, seuls ou en lot, est interdit.
 * Texte complet : https://github.com/imskyleen/animate-ui/blob/main/LICENSE.md
 *
 * Changements : refait en CSS seul (ni motion/react ni class-variance-
 * authority), une vague à la surface du liquide, trois teintes, remplissage
 * au clavier et pendant l'appui au toucher, fondu avec animations réduites.
 */
import React from 'react';
import { cn } from '@/lib/utils';
import './liquid-button.css';

export type LiquidButtonTone = 'neutral' | 'gold' | 'light';

interface LiquidButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Couleur du liquide : gris, or (VIP) ou blanc (action principale). */
  tone?: LiquidButtonTone;
  size?: 'md' | 'sm';
}

export const LiquidButton = React.forwardRef<HTMLButtonElement, LiquidButtonProps>(({
  tone = 'neutral', size = 'md', type = 'button', className, children, ...rest
}, ref) => (
  <button
    {...rest}
    ref={ref}
    type={type}
    data-tone={tone}
    className={cn(
      'liquid-button',
      size === 'sm' ? 'h-8 gap-1.5 rounded-lg px-3.5 text-[13px]' : 'h-11 w-full gap-2.5 rounded-xl px-4 text-sm',
      className,
    )}
  >
    <span aria-hidden="true" className="liquid-button__fill" />
    {children}
  </button>
));

LiquidButton.displayName = 'LiquidButton';
