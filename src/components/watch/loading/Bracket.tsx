// src/components/watch/loading/Bracket.tsx
//
// Crochet [ ] de Movix autour du cadre du lecteur (écran de chargement et
// écran « pas en français »). Le parent doit être `relative`.
import React from 'react';

import { cn } from '@/lib/utils';

/** Crochet de Movix, perforations de pellicule comprises. */
const Bracket: React.FC<{ side: 'left' | 'right'; style?: React.CSSProperties }> = ({ side, style }) => (
  <div
    aria-hidden="true"
    className={cn(
      'pointer-events-none absolute -bottom-2.5 -top-2.5 w-5 md:-bottom-3 md:-top-3 md:w-8',
      side === 'left' ? '-left-7 md:-left-[42px]' : '-right-7 md:-right-[42px]',
    )}
    style={style}
  >
    <div className={cn('absolute inset-y-0 w-[7px] bg-red-600 md:w-[13px]', side === 'left' ? 'left-0' : 'right-0')}>
      <div
        className="absolute inset-x-[2px] bottom-6 top-6 md:inset-x-1 md:bottom-9 md:top-9"
        // Un trou de 9 px au milieu d'une tuile de 22 px, répétée en `space` :
        // seulement des trous entiers, l'écart s'ajuste à la hauteur du cadre.
        // Un motif qui se répète tout bête coupait le dernier trou en un trait.
        style={{
          backgroundImage: 'linear-gradient(to bottom, transparent 6.5px, #000 6.5px 15.5px, transparent 15.5px)',
          backgroundSize: '100% 22px',
          backgroundRepeat: 'no-repeat space',
        }}
      />
    </div>
    <div className={cn('absolute top-0 h-[7px] w-full bg-red-600 md:h-[13px]', side === 'left' ? 'left-0' : 'right-0')} />
    <div className={cn('absolute bottom-0 h-[7px] w-full bg-red-600 md:h-[13px]', side === 'left' ? 'left-0' : 'right-0')} />
  </div>
);

export default Bracket;
