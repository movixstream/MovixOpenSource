// Petits dessins du thème Halloween utilisés par l'en-tête et le lecteur
// (chargés avec l'application, donc gardés légers). Le décor plein écran a les
// siens dans HalloweenDecorArt.tsx, chargé seulement quand le thème est actif.

// Chauve-souris vue de face, ailes levées en V (viewBox 0 0 100 38) : bord
// d'attaque qui monte jusqu'à la pointe, bord de fuite festonné entre les
// doigts, tête à oreilles pointues. Les ailes sont séparées du corps pour
// pouvoir battre autour de l'épaule.
export const BAT_WING_LEFT = 'M47 18C36 8 16 2 3 1Q11 7 12 16Q18 12 23 20Q30 16 35 26Q41 22 45 30Z';
export const BAT_WING_RIGHT = 'M53 18C64 8 84 2 97 1Q89 7 88 16Q82 12 77 20Q70 16 65 26Q59 22 55 30Z';
export const BAT_BODY = 'M44.8 25a5.2 8.5 0 1 0 10.4 0a5.2 8.5 0 1 0-10.4 0ZM45.6 15.5a4.4 4.4 0 1 0 8.8 0a4.4 4.4 0 1 0-8.8 0ZM46.4 13.2L45.2 6.6L49 11.6ZM53.6 13.2L54.8 6.6L51 11.6Z';
export const BAT_PATH = BAT_WING_LEFT + BAT_WING_RIGHT + BAT_BODY;

export const Pumpkin = ({ className, face = '#fde047' }: { className?: string; face?: string }) => (
  <svg className={className} viewBox="0 0 120 100" aria-hidden="true">
    <path d="M58 14c0-8 4-12 10-13l2 4c-5 1-7 4-7 10z" fill="#3f5a1e" />
    <ellipse cx="60" cy="58" rx="56" ry="40" fill="#c2410c" />
    <ellipse cx="38" cy="58" rx="22" ry="38" fill="#ea580c" />
    <ellipse cx="82" cy="58" rx="22" ry="38" fill="#ea580c" />
    <ellipse cx="60" cy="58" rx="20" ry="40" fill="#f97316" />
    <path d="M30 46l14-12 8 16zM90 46l-14-12-8 16zM54 58l6-9 6 9z" fill={face} />
    <path d="M26 66q34 26 68 0l-6 4-5-6-6 8-7-7-6 8-6-8-7 7-6-8-5 6z" fill={face} />
  </svg>
);

/** Citrouille de 16 px qui remplace l'icône du bouton Explorer. */
export const HalloweenPumpkinIcon = () => <Pumpkin className="h-4 w-[19px] drop-shadow-[0_0_4px_rgba(249,115,22,0.8)]" />;

/**
 * Citrouille qui remplace la boule de la barre de progression du lecteur,
 * placée à `left` (l'avancement). Le corps est centré sur la barre (son centre
 * est à 58 % de la hauteur du dessin) et la tige dépasse au-dessus.
 */
export const HalloweenProgressPumpkin = ({ left }: { left: string }) => (
  <span className="absolute top-1/2 h-6 w-[29px] -translate-x-1/2 -translate-y-[58%]" style={{ left }}>
    <Pumpkin className="h-full w-full drop-shadow-[0_0_4px_rgba(249,115,22,0.8)]" />
  </span>
);

/**
 * Citrouille du bouton de l'en-tête qui allume ou éteint le thème : visage
 * allumé et lueur quand il est actif, grise et visage éteint sinon (elle
 * reprend ses couleurs au survol du bouton, qui porte la classe `group`).
 */
export const HalloweenThemeToggleIcon = ({ lit }: { lit: boolean }) => (
  <Pumpkin
    face={lit ? '#fde047' : '#431407'}
    className={`h-[18px] w-[22px] transition-[filter,opacity] duration-200 motion-reduce:transition-none ${
      lit
        ? 'drop-shadow-[0_0_5px_rgba(249,115,22,0.85)]'
        : 'opacity-60 grayscale group-hover:opacity-100 group-hover:grayscale-0 group-focus-visible:opacity-100 group-focus-visible:grayscale-0'
    }`}
  />
);

/** Chauve-souris qui remplace la flèche du bouton Explorer. */
export const HalloweenBatIcon = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 100 38" className={`h-[10px] w-[26px] fill-[#fb923c] ${className}`} aria-hidden="true">
    <path d={BAT_PATH} />
  </svg>
);

/** Lanterne suspendue sous la cloche des notifications. */
export const HalloweenLantern = ({ className = '' }: { className?: string }) => (
  <svg
    viewBox="0 0 24 44"
    className={`pointer-events-none absolute left-1/2 top-[28px] h-[40px] w-[22px] -translate-x-1/2 drop-shadow-[0_0_10px_rgba(249,115,22,0.95)] ${className}`}
    aria-hidden="true"
  >
    <path d="M12 0v8" stroke="#3a2a1c" strokeWidth="1.5" />
    <path d="M7 8h10l2 4H5z" fill="#2b1d12" />
    <rect x="6" y="12" width="12" height="20" rx="3" fill="#f59e0b" opacity="0.9" />
    <rect x="9" y="15" width="6" height="14" rx="2" fill="#fde68a" />
    <path d="M5 12h14M5 32h14M12 12v20" stroke="#2b1d12" strokeWidth="1.6" />
    <path d="M7 32h10l-1 4H8z" fill="#2b1d12" />
  </svg>
);
