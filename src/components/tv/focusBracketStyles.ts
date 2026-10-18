import type { CSSProperties } from 'react';

// Perforations de pellicule des crochets [ ], aux proportions de l'appli télé
// (Focus.kt, bracketPath) et du logo : trous de 0,5 × 0,56 fois l'épaisseur
// `--fb-w`, un tous les 1,4 épaisseur, à partir de 2 épaisseurs des bras.
export const PERFORATION_STYLE: CSSProperties = {
  left: 'calc(var(--fb-w) * -0.75)',
  width: 'calc(var(--fb-w) * 0.5)',
  top: 'calc(var(--fb-w) * 2)',
  bottom: 'calc(var(--fb-w) * 2)',
  backgroundImage:
    'repeating-linear-gradient(to bottom, rgb(10 10 10 / 0.9) 0, rgb(10 10 10 / 0.9) calc(var(--fb-w) * 0.56), transparent calc(var(--fb-w) * 0.56), transparent calc(var(--fb-w) * 1.4))',
};
