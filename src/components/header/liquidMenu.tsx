import React, { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { animate, cancelFrame, frame, MotionGlobalConfig, useMotionValue, usePresence, useReducedMotionConfig } from 'framer-motion';
import { cn } from '@/lib/utils';

/* ─── Menus liquides de l'en-tête ────────────────────────────────────────────
   Le moteur du menu Explorer, partagé avec les menus profil, connexion et
   notifications : chaque menu sort du bouton qui l'ouvre, comme un liquide.
   Sur ordinateur, le bouton se remplit et coule dans le menu, auquel il reste
   collé (LiquidDropdown) ; sur mobile, le rond du bouton s'étire jusqu'au
   panneau (LiquidSheet). À la fermeture, tout rentre dans le bouton. */

// Départ vif, arrivée douce : la courbe des entrées et des sorties.
const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const EASE_OUT_CSS = `cubic-bezier(${EASE_OUT.join(', ')})`;

// Arrondi au quart de pixel : des retraits fractionnaires faisaient créer et
// retirer par Chrome un calque-masque pour la découpe, image après image.
const quarter = (v: number) => Math.round(v * 4) / 4;

// Découpe inset() : retraits haut, droite, bas, gauche, puis rayon (en px).
type Inset = [number, number, number, number, number];

const insetCss = ([top, right, bottom, left, radius]: Inset) =>
  `inset(${top}px ${right}px ${bottom}px ${left}px round ${radius}px)`;

// Découpe qui épouse le bouton, dans le repère de `el`. Taille de mise en
// page du bouton, autour de son centre : enfoncé (whileTap, échelle 0,9), il
// donnait un rond trop petit au départ et à l'arrivée du panneau.
const insetAround =(el: HTMLElement, trigger: HTMLElement | null, radius: number): Inset | null => {
  if (!trigger) return null;
  const box = el.getBoundingClientRect();
  const r = trigger.getBoundingClientRect();
  if (!box.width || !r.width) return null;
  const w = trigger.offsetWidth || r.width;
  const h = trigger.offsetHeight || r.height;
  const cx = (r.left + r.right) / 2;
  const cy = (r.top + r.bottom) / 2;
  const top = quarter(cy - h / 2 - box.top);
  const right = quarter(box.right - (cx + w / 2));
  const bottom = quarter(box.bottom - (cy + h / 2));
  const left = quarter(cx - w / 2 - box.left);
  return [top, right, bottom, left, radius];
};

const insetAll =(inset: number, radius: number): Inset => [inset, inset, inset, inset, radius];

// Découpe en place sur chaque élément, telle qu'écrite par clipTo.
const clips = new WeakMap<HTMLElement, Inset>();
const clipTweens = new WeakMap<HTMLElement, ClipTween>();

interface ClipTween {
  stop: () => void;
  done: Promise<void>;
  readonly running: boolean;
}

const setClip = (el: HTMLElement, value: Inset) => {
  clips.set(el, value);
  el.style.clipPath = insetCss(value);
};

/**
 * Anime la découpe de `el` jusqu'à `to` avec un ressort (durée + rebond),
 * image par image depuis la page : chaque image écrit la découpe en style en
 * ligne, la dernière écrit `to`.
 *
 * Pas d'animation native ici. Chrome Android joue celles de clip-path sur le
 * GPU (avec un masque à part) ; à la fin, il repasse à la découpe ordinaire,
 * et pendant ce relais le fond du panneau disparaissait une ou deux images :
 * la page se voyait à travers le menu 500 ms après chaque ouverture. Ici, la
 * découpe est dessinée de la même façon du début à la fin.
 */
const clipTo = (
  el: HTMLElement,
  to: Inset,
  ms: number,
  bounce: number,
  { from, delay = 0 }: { from?: Inset; delay?: number } = {},
): ClipTween | null => {
  clipTweens.get(el)?.stop();
  const start = from ?? clips.get(el);
  if (!start || ms <= 0 || MotionGlobalConfig.skipAnimations || start.every((v, i) => v === to[i])) {
    setClip(el, to);
    return null;
  }
  // Départ posé tout de suite : la première image montre déjà la découpe.
  setClip(el, start);
  let running = true;
  let resolve = () => {};
  const done = new Promise<void>((r) => { resolve = r; });
  const finish = () => {
    if (!running) return;
    running = false;
    if (clipTweens.get(el) === tween) clipTweens.delete(el);
    resolve();
  };
  const controls = animate(0, 1, {
    type: 'spring',
    duration: ms / 1000,
    bounce,
    delay: delay / 1000,
    // Au quart de pixel, comme insetAround (calque-masque, voir quarter).
    onUpdate: (p) => setClip(el, start.map((v, i) => quarter(v + (to[i] - v) * p)) as Inset),
    onComplete: () => {
      setClip(el, to);
      finish();
    },
  });
  const tween: ClipTween = {
    stop: () => {
      controls.stop();
      finish();
    },
    done,
    get running() { return running; },
  };
  clipTweens.set(el, tween);
  return tween;
};

type AnimatedProp = 'opacity';
const running = new WeakMap<HTMLElement, Partial<Record<AnimatedProp, Animation>>>();

/**
 * Anime `prop` de sa valeur du moment (animation en cours comprise) jusqu'à
 * `to`, avec l'animation native du navigateur. La valeur finale est posée en
 * style en ligne AVANT de lancer l'animation : quand celle-ci se termine ou
 * qu'on la retire, l'élément est déjà dans son état final.
 *
 * Framer Motion fait l'inverse : il retire son animation, puis n'écrit la
 * valeur finale qu'à l'image suivante. Sur Chrome Android, le voile et le
 * panneau du menu réapparaissaient ainsi une image à la fin de la fermeture.
 *
 * L'animation garde aussi sa dernière image (`fill: 'both'`) jusqu'à ce que
 * la page la retire elle-même. Chrome la joue sur le GPU : arrivé au bout
 * pendant que la page est occupée, le GPU reprenait sans elle la valeur
 * qu'il avait reçue au départ, celle de la première image. Le voile, puis le
 * panneau, revenaient ainsi en entier une image après la fermeture.
 */
const playTo = (
  el: HTMLElement,
  prop: AnimatedProp,
  to: string,
  ms: number,
  easing: string,
  { from, delay = 0 }: { from?: string; delay?: number } = {},
): Animation | null => {
  const start = from ?? getComputedStyle(el)[prop];
  const current = running.get(el) ?? {};
  current[prop]?.cancel();
  delete current[prop];
  running.set(el, current);
  el.style[prop] = to;
  // Comparée aussi à la forme sérialisée : `inset(8px 8px 8px 8px …)` se lit
  // `inset(8px …)`, et une réouverture rejouait 500 ms d'animation à vide.
  if (start === to || start === el.style[prop] || ms <= 0 || MotionGlobalConfig.skipAnimations || typeof el.animate !== 'function') return null;
  const animation = el.animate([{ [prop]: start }, { [prop]: to }], { duration: ms, delay, easing, fill: 'both' });
  current[prop] = animation;
  animation.addEventListener('finish', () => {
    if (current[prop] !== animation) return;
    delete current[prop];
    retire(animation);
  });
  return animation;
};

// Retire une animation finie, depuis la page : le style en ligne, déjà à la
// valeur finale, prend le relais dans la même image (voir playTo).
const retire = (animation: Animation) => {
  if (animation.playState === 'finished') animation.cancel();
};

// Fin de toutes ces animations, qu'elles aillent au bout ou soient retirées.
const settled =(animations: (Animation | ClipTween | null)[]) => Promise.all(animations.map((animation) => animation
  && ('done' in animation ? animation.done : new Promise<void>((resolve) => {
    animation.addEventListener('finish', () => resolve());
    animation.addEventListener('cancel', () => resolve());
  }))));

// Ce que les ouvertures et fermetures attendent d'une animation : une
// animation Framer Motion, ou un fondu natif (fadeTo).
interface Playback {
  stop: () => void;
  then: (onResolve: () => void) => unknown;
}

// Fondu natif (voir playTo). `stop` ne fait rien : l'animation suivante
// repart d'elle-même de la valeur du moment.
const fadeTo = (el: HTMLElement, to: string, ms: number, from?: string): Playback => {
  const animation = playTo(el, 'opacity', to, ms, EASE_OUT_CSS, { from });
  return { stop: () => {}, then: (onResolve) => settled([animation]).then(onResolve) };
};

/* ─── Ordinateur : bouton et menu d'une seule coulée ─────────────────────────
   Le bouton se remplit, une goutte coule de son bas jusqu'au panneau, puis
   s'étale en flaque jusqu'à ses bords. Ouvert, bouton et panneau ne forment
   qu'une forme, reliés par une patte évasée à sa base. Cette forme est un
   seul tracé SVG (fond + liseré) ; une découpe faite de formes simples
   (niveau du bouton, filet, goutte, flaque) la dévoile image par image. Le
   texte ne bouge pas : la flaque le découvre.
   Ouverture : ~0,4 s avant que tout soit lisible ; fermeture : le texte part
   aussitôt, tout est rentré en ~0,4 s. */

// Le bouton se remplit à débit régulier ; la goutte tombe en accélérant ; la
// flaque s'étale vite puis se pose, et rentre dans la patte en accélérant
// puis en ralentissant.
const EASE_FILL = [0.45, 0, 0.55, 1] as const;
const EASE_FALL = [0.55, 0, 1, 0.45] as const;
const EASE_POOL = [0.16, 1, 0.3, 1] as const;
const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;

interface GooGeometry {
  // En pixels, dans le repère de l'en-tête.
  L: number; R: number; T: number; B: number; // bouton
  PL: number; PR: number; PT: number; PB: number; // panneau
  br: number; // rayon des coins hauts du bouton
  pr: number; // rayon des coins du panneau
  // Évasement de la patte de chaque côté, au contact du panneau. Un bouton
  // trop près d'un bord du panneau (le profil, au bout de la ligne) n'a pas
  // de place pour la patte et le coin de ce côté : son flanc descend tout
  // droit jusqu'au bas du panneau, comme un onglet.
  flareL: number; flareR: number;
  flushL: boolean; flushR: boolean;
  // Patte étroite (bouton rond : cloche, profil) : demi-largeur de la patte
  // et taille de l'arrondi qui la raccorde au bas du bouton. null : la patte
  // a la largeur du bouton (Explorer).
  neckHalf: number | null;
  joint: number;
  poolRadius: number; // demi-hauteur finale de la flaque
  poolAspect: number; // largeur / hauteur de la flaque
}

const px = (v: number) => String(Math.round(v * 100) / 100);

// Contour du bouton, de la patte et du panneau. Les côtés du bouton
// descendent tout droit et s'évasent en arrivant sur le panneau : la tangente
// finit horizontale, la patte se fond dans le bord du panneau.
const gooPath = (g: GooGeometry) => {
  const { L, R, T, B, PL, PR, PT, PB, br, pr, flareL, flareR } = g;
  const h = PT - B;
  const pinch = Math.min(4, (R - L) / 10);
  const d = [
    `M${px(L + br)} ${px(T)}`,
    `H${px(R - br)}`,
    `A${px(br)} ${px(br)} 0 0 1 ${px(R)} ${px(T + br)}`,
  ];
  if (g.flushR) {
    d.push(`V${px(PB - pr)}`);
  } else {
    d.push(
      `V${px(B)}`,
      `C${px(R)} ${px(B + h * 0.55)} ${px(R - pinch)} ${px(PT)} ${px(R + flareR)} ${px(PT)}`,
      `H${px(PR - pr)}`,
      `A${pr} ${pr} 0 0 1 ${px(PR)} ${px(PT + pr)}`,
      `V${px(PB - pr)}`,
    );
  }
  d.push(
    `A${pr} ${pr} 0 0 1 ${px(PR - pr)} ${px(PB)}`,
    `H${px(PL + pr)}`,
    `A${pr} ${pr} 0 0 1 ${px(PL)} ${px(PB - pr)}`,
  );
  if (g.flushL) {
    d.push(`V${px(T + br)}`);
  } else {
    d.push(
      `V${px(PT + pr)}`,
      `A${pr} ${pr} 0 0 1 ${px(PL + pr)} ${px(PT)}`,
      `H${px(L - flareL)}`,
      `C${px(L + pinch)} ${px(PT)} ${px(L)} ${px(B + h * 0.55)} ${px(L)} ${px(B)}`,
      `V${px(T + br)}`,
    );
  }
  d.push(`A${px(br)} ${px(br)} 0 0 1 ${px(L + br)} ${px(T)}`, 'Z');
  return d.join('');
};

// Point du bas du bouton où la patte étroite se détache, côté droit (1) ou
// gauche (-1) : sur le bord plat d'une pastille, ou dans l'arrondi d'un rond.
const bottomJoin = (g: GooGeometry, side: 1 | -1) => {
  const { L, R, B, br } = g;
  const x = (L + R) / 2 + side * ((g.neckHalf ?? 0) + g.joint);
  const flatEnd = side === 1 ? R - br : L + br;
  const beyond = side * (x - flatEnd);
  if (beyond <= 0) return { x, y: B, onArc: false };
  const dx = Math.min(br, beyond);
  return { x: flatEnd + side * dx, y: B - br + Math.sqrt(Math.max(0, br * br - dx * dx)), onArc: true };
};

// Bouton rond (cloche, profil) : il garde sa forme entière en se remplissant,
// et une patte plus étroite que lui coule de son centre, raccordée par deux
// petits arrondis, puis s'évase sur le panneau comme celle d'Explorer.
const dropPath = (g: GooGeometry) => {
  const { L, R, T, B, PL, PR, PT, PB, br, pr, flareL, flareR, joint: j } = g;
  const nh = g.neckHalf ?? 0;
  const cx = (L + R) / 2;
  const top = B + j;
  const h = PT - top;
  const pinch = Math.min(3, nh / 3);
  const right = bottomJoin(g, 1);
  const left = bottomJoin(g, -1);
  const d = [
    `M${px(L + br)} ${px(T)}`,
    `H${px(R - br)}`,
    `A${px(br)} ${px(br)} 0 0 1 ${px(R)} ${px(T + br)}`,
    `V${px(B - br)}`,
  ];
  if (right.onArc) d.push(`A${px(br)} ${px(br)} 0 0 1 ${px(right.x)} ${px(right.y)}`);
  else d.push(`A${px(br)} ${px(br)} 0 0 1 ${px(R - br)} ${px(B)}`, `H${px(right.x)}`);
  d.push(
    `Q${px(cx + nh)} ${px(B)} ${px(cx + nh)} ${px(top)}`,
    `C${px(cx + nh)} ${px(top + h * 0.55)} ${px(cx + nh - pinch)} ${px(PT)} ${px(cx + nh + flareR)} ${px(PT)}`,
    `H${px(PR - pr)}`,
    `A${pr} ${pr} 0 0 1 ${px(PR)} ${px(PT + pr)}`,
    `V${px(PB - pr)}`,
    `A${pr} ${pr} 0 0 1 ${px(PR - pr)} ${px(PB)}`,
    `H${px(PL + pr)}`,
    `A${pr} ${pr} 0 0 1 ${px(PL)} ${px(PB - pr)}`,
    `V${px(PT + pr)}`,
    `A${pr} ${pr} 0 0 1 ${px(PL + pr)} ${px(PT)}`,
    `H${px(cx - nh - flareL)}`,
    `C${px(cx - nh + pinch)} ${px(PT)} ${px(cx - nh)} ${px(top + h * 0.55)} ${px(cx - nh)} ${px(top)}`,
    `Q${px(cx - nh)} ${px(B)} ${px(left.x)} ${px(left.y)}`,
  );
  if (left.onArc) d.push(`A${px(br)} ${px(br)} 0 0 1 ${px(L)} ${px(B - br)}`);
  else d.push(`H${px(L + br)}`, `A${px(br)} ${px(br)} 0 0 1 ${px(L)} ${px(B - br)}`);
  d.push(`V${px(T + br)}`, `A${px(br)} ${px(br)} 0 0 1 ${px(L + br)} ${px(T)}`, 'Z');
  return d.join('');
};

const setRect =(el: SVGRectElement | null, x: number, y: number, width: number, height: number) => {
  if (!el) return;
  el.setAttribute('x', px(x));
  el.setAttribute('y', px(y));
  el.setAttribute('width', px(Math.max(0, width)));
  el.setAttribute('height', px(Math.max(0, height)));
};

const setEllipse = (el: SVGEllipseElement | null, cx: number, cy: number, rx: number, ry: number) => {
  if (!el) return;
  el.setAttribute('cx', px(cx));
  el.setAttribute('cy', px(cy));
  el.setAttribute('rx', px(Math.max(0, rx)));
  el.setAttribute('ry', px(Math.max(0, ry)));
};

type LiquidDropdownProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> & {
  /** Bouton d'où coule le menu. */
  triggerRef: React.RefObject<HTMLElement>;
  /** Racine du menu, pour reconnaître les clics à l'intérieur. */
  containerRef?: React.RefObject<HTMLDivElement>;
  /** Rayon des coins hauts du bouton. */
  triggerRadius: number;
  /** Rayon des coins du panneau. */
  panelRadius: number;
  /** Bouton rond (cloche, profil) : largeur de la patte étroite qui coule de
      son centre. Sans elle, la patte a la largeur du bouton (Explorer). */
  neckWidth?: number;
  /** Panneau sur toute la grille de l'en-tête, ou calé sur son bord droit. */
  align?: 'stretch' | 'end';
  /** Classes du panneau lui-même (largeur, hauteur maximale). */
  panelClassName?: string;
  children: React.ReactNode;
};

/**
 * Menu déroulant d'ordinateur. Rendu dans l'en-tête, sous sa ligne d'icônes
 * (z-index 5 contre 10) : le libellé du bouton reste lisible sur le liquide
 * qui le remplit. Doit rester sous un AnimatePresence, qui attend que le
 * liquide soit remonté dans le bouton avant de le démonter.
 */
export const LiquidDropdown: React.FC<LiquidDropdownProps> = ({
  triggerRef, containerRef, triggerRadius, panelRadius, neckWidth, align = 'stretch', panelClassName, className, children, ...rest
}) => {
  const clipId = `liquid-goo-${useId().replace(/:/g, '')}`;
  const ownRootRef = useRef<HTMLDivElement>(null);
  const rootRef = containerRef ?? ownRootRef;
  const svgRef = useRef<SVGSVGElement>(null);
  const fillRef = useRef<SVGPathElement>(null);
  const edgeRef = useRef<SVGPathElement>(null);
  const levelRef = useRef<SVGRectElement>(null);
  const streamRef = useRef<SVGRectElement>(null);
  const dropRef = useRef<SVGEllipseElement>(null);
  const bulgeRef = useRef<SVGEllipseElement>(null);
  const poolRef = useRef<SVGEllipseElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const geometryRef = useRef<GooGeometry | null>(null);
  // Quatre étapes, de 0 à 1 : niveau dans le bouton, coulée, flaque, texte.
  // Chacune a sa propre courbe ; à l'inverse, chacune repart d'où elle en est.
  const fill = useMotionValue(0);
  const drip = useMotionValue(0);
  const pool = useMotionValue(0);
  const shown = useMotionValue(0);
  const [isPresent, safeToRemove] = usePresence();
  const reduceMotion = useReducedMotionConfig();
  const closingRef = useRef(false);

  // Chaque étape attend la précédente, au prorata de ce qu'il lui reste à
  // faire : une réouverture en pleine fermeture enchaîne sans temps mort.
  const pour = (open: boolean) => {
    if (open) {
      const dripDelay = Math.max(0, 0.16 * (1 - fill.get()) - 0.04);
      const poolDelay = dripDelay + 0.1 * (1 - drip.get());
      const textDelay = poolDelay + 0.08 * (1 - pool.get());
      return [
        animate(fill, 1, { duration: 0.16, ease: EASE_FILL }),
        animate(drip, 1, { duration: 0.1, delay: dripDelay, ease: EASE_FALL }),
        animate(pool, 1, { duration: 0.42, delay: poolDelay, ease: EASE_POOL }),
        animate(shown, 1, { duration: 0.2, delay: textDelay, ease: EASE_OUT }),
      ];
    }
    // Le texte s'efface aussitôt, la flaque rentre dans la patte, la patte
    // dans le bouton, qui se vide.
    const poolDelay = 0.03 * shown.get();
    const dripDelay = poolDelay + 0.2 * pool.get();
    const fillDelay = dripDelay + 0.08 * drip.get();
    return [
      animate(shown, 0, { duration: 0.1, ease: EASE_OUT }),
      animate(pool, 0, { duration: 0.2, delay: poolDelay, ease: EASE_IN_OUT }),
      animate(drip, 0, { duration: 0.08, delay: dripDelay, ease: EASE_OUT }),
      animate(fill, 0, { duration: 0.1, delay: fillDelay, ease: EASE_OUT }),
    ];
  };

  useLayoutEffect(() => {
    const root = rootRef.current;
    const content = contentRef.current;
    if (!root || !content) return;

    const draw = () => {
      const g = geometryRef.current;
      if (!g) return;
      const cx = (g.L + g.R) / 2;
      // 1. Le bouton se remplit, du bas vers le haut.
      const level = g.B - (g.B - g.T + 2) * fill.get();
      setRect(levelRef.current, g.L - 2, level, g.R - g.L + 4, fill.get() > 0 ? g.B + 1 - level : 0);
      // 2. Une goutte se forme sous le bouton et coule jusqu'au panneau : un
      // filet étroit à tête ronde, qui s'élargit en patte quand la flaque
      // s'étale (et redevient filet quand elle rentre).
      const dripped = drip.get();
      const spread = pool.get();
      // Patte étroite : la goutte part de sa largeur, arrondis de raccord
      // compris, et s'élargit jusqu'à ses évasements.
      const neckHalf = (g.neckHalf ?? (g.R - g.L) / 2) + Math.max(g.flareL, g.flareR) + 2;
      const narrowHalf = g.neckHalf !== null ? g.neckHalf + g.joint + 1 : Math.max(6, (g.R - g.L) * 0.14);
      const streamHalf = narrowHalf + (neckHalf - narrowHalf) * Math.min(1, spread * 3);
      const front = g.B + (g.PT - g.B) * dripped;
      const dripping = dripped > 0;
      setRect(streamRef.current, cx - streamHalf, g.B - 1, streamHalf * 2, dripping ? front - g.B + 1 : 0);
      setEllipse(dropRef.current, cx, front, dripping ? streamHalf : 0, dripping ? Math.min(7, streamHalf) : 0);
      // Renflement sous le bouton : la goutte en reste attachée par un col
      // arrondi, pas par un angle droit.
      setEllipse(bulgeRef.current, cx, g.B, dripping ? streamHalf * 1.6 : 0, dripping ? 6 : 0);
      // 3. Elle s'étale en flaque jusqu'aux bords du panneau.
      const ry = g.poolRadius * spread;
      const rx = ry * g.poolAspect;
      setEllipse(poolRef.current, cx, g.PT, rx, ry);
      // Le contenu est découpé par la même flaque : il apparaît quand elle
      // passe, jamais en dehors.
      content.style.opacity = String(shown.get());
      content.style.clipPath = spread >= 1 ? '' : `ellipse(${px(rx)}px ${px(ry)}px at ${px(cx - g.PL)}px 0px)`;
    };

    const measure = () => {
      const origin = root.getBoundingClientRect();
      const box = content.getBoundingClientRect();
      const trigger = triggerRef.current?.getBoundingClientRect();
      const PL = box.left - origin.left;
      const PR = box.right - origin.left;
      const PT = box.top - origin.top;
      const PB = box.bottom - origin.top;
      // Sans bouton mesurable, la patte part du milieu du panneau.
      const hasTrigger = !!trigger && trigger.width > 0;
      let L = hasTrigger ? trigger.left - origin.left : (PL + PR) / 2 - 1;
      let R = hasTrigger ? trigger.right - origin.left : (PL + PR) / 2 + 1;
      const T = hasTrigger ? trigger.top - origin.top : PT - 2;
      const B = hasTrigger ? Math.min(trigger.bottom - origin.top, PT - 1) : PT - 1;
      const pr = Math.min(panelRadius, (PR - PL) / 2, (PB - PT) / 2);
      const reach = (PT - B) * 0.7;
      // Patte étroite : centrée sous le bouton, elle ne touche jamais un bord
      // du panneau. Patte pleine largeur : un bouton trop près d'un bord
      // descend tout droit de ce côté (voir GooGeometry).
      const neckHalf = hasTrigger && neckWidth ? Math.max(4, Math.min(neckWidth / 2, (R - L) / 2 - 2)) : null;
      const flushL = neckHalf === null && L - PL < pr + 2;
      const flushR = neckHalf === null && PR - R < pr + 2;
      if (flushL) L = PL;
      if (flushR) R = PR;
      const cx = (L + R) / 2;
      const sideL = neckHalf === null ? L : cx - neckHalf;
      const sideR = neckHalf === null ? R : cx + neckHalf;
      const flareL = flushL ? 0 : Math.max(0, Math.min(16, reach, sideL - (PL + pr)));
      const flareR = flushR ? 0 : Math.max(0, Math.min(16, reach, PR - pr - sideR));
      const halfWidth = Math.max(cx - PL, PR - cx);
      const height = Math.max(1, PB - PT);
      // Panneau haut et étroit (profil, notifications) : une flaque plus
      // large que haute couvre d'abord toute la largeur, puis descend. Ronde,
      // elle sortait en demi-disque, coupée net par le bord le plus proche.
      const poolAspect = Math.min(2.4, Math.max(neckHalf === null ? 1 : 1.8, halfWidth / height));
      const g: GooGeometry = {
        L, R, T, B, PL, PR, PT, PB,
        br: Math.max(0, Math.min(triggerRadius, (R - L) / 2, (B - T) / 2)),
        pr,
        flareL, flareR, flushL, flushR, poolAspect,
        neckHalf,
        joint: Math.max(2, Math.min(6, (PT - B) / 3)),
        // La flaque doit atteindre les coins du bas, liseré compris.
        poolRadius: Math.hypot(halfWidth / poolAspect, height) + 6,
      };
      // Contenu qui change de hauteur pendant que la flaque s'étale (liste des
      // notifications qui remplace le squelette) : la flaque garde sa taille
      // du moment et repart de là, au lieu de sauter en une image.
      const prev = geometryRef.current;
      const spread = pool.get();
      if (prev && !closingRef.current && spread > 0 && spread < 1 && g.poolRadius !== prev.poolRadius) {
        const keep = Math.min(1, (prev.poolRadius * spread) / g.poolRadius);
        pool.jump(keep);
        // Départ doux : la flaque presque posée ne repart pas d'un bond.
        animate(pool, 1, { duration: 0.3, ease: EASE_FILL });
      }
      geometryRef.current = g;
      svgRef.current?.setAttribute('width', px(Math.ceil(origin.width)));
      svgRef.current?.setAttribute('height', px(Math.ceil(PB + 8)));
      const d = neckHalf === null ? gooPath(g) : dropPath(g);
      fillRef.current?.setAttribute('d', d);
      edgeRef.current?.setAttribute('d', d);
      draw();
    };

    measure();
    // Un seul dessin par image, à l'étape de rendu de framer, même quand
    // plusieurs étapes changent dans la même image.
    const schedule = () => frame.render(draw);
    const unsubscribe = [fill, drip, pool, shown].map((value) => value.on('change', schedule));
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    if (triggerRef.current) observer.observe(triggerRef.current);
    window.addEventListener('resize', measure);

    // Animations réduites : tout est en place d'emblée, seul un fondu reste.
    if (reduceMotion) [fill, drip, pool, shown].forEach((value) => value.set(1));
    const opening: Playback[] = reduceMotion ? [fadeTo(root, '1', 150, '0')] : pour(true);
    return () => {
      opening.forEach((animation) => animation.stop());
      unsubscribe.forEach((stop) => stop());
      cancelFrame(draw);
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
    // Au montage seulement : la fermeture et la réouverture sont plus bas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // Pendant qu'il se vide, le menu ne reçoit plus ni clic ni focus : un clic
    // sur la page ne doit pas tomber sur un lien devenu invisible.
    if (contentRef.current) contentRef.current.inert = !isPresent;
    if (fillRef.current) fillRef.current.style.pointerEvents = isPresent ? '' : 'none';
    if (isPresent) {
      if (!closingRef.current) return;
      // Rouvert pendant qu'il se vidait : le liquide repart d'où il en est.
      closingRef.current = false;
      const reopening: Playback[] = reduceMotion ? [fadeTo(root, '1', 150)] : pour(true);
      return () => reopening.forEach((animation) => animation.stop());
    }
    closingRef.current = true;
    const closing: Playback[] = reduceMotion ? [fadeTo(root, '0', 120)] : pour(false);
    let cancelled = false;
    Promise.all(closing.map((animation) => new Promise<void>((resolve) => {
      animation.then(() => resolve());
    }))).then(() => {
      if (!cancelled) safeToRemove?.();
    });
    return () => {
      cancelled = true;
      closing.forEach((animation) => animation.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPresent]);

  return (
    <div {...rest} ref={rootRef} className={cn('pointer-events-none absolute inset-0 z-[5]', className)}>
      {/* Calque propre : le tracé, redessiné à chaque image, ne fait plus
          repeindre la ligne d'icônes de l'en-tête. */}
      <svg ref={svgRef} aria-hidden="true" className="absolute left-0 top-0 overflow-visible will-change-transform">
        <defs>
          <clipPath id={clipId}>
            <rect ref={levelRef} />
            <rect ref={streamRef} />
            <ellipse ref={dropRef} />
            <ellipse ref={bulgeRef} />
            <ellipse ref={poolRef} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          {/* Clics sur le liquide : dans le menu, il ne se referme pas. */}
          <path ref={fillRef} data-liquid-surface className="pointer-events-auto fill-[#121214]" />
          <path ref={edgeRef} data-liquid-edge className="fill-none stroke-white/[0.09]" strokeWidth={1} />
        </g>
      </svg>
      {/* Même base de largeur que la page : `body` fait 100vw (index.css), et
          selon le navigateur 100vw inclut la barre de défilement, que
          l'en-tête fixe, lui, exclut. Calé sur l'en-tête, le menu finissait
          ~10 px avant le HeroSlider à droite. */}
      <div className="absolute left-0 top-full w-screen">
        {/* Mêmes bords que le cadre du HeroSlider (lg:px-20 dans 1920 px au
            plus) : le menu s'ouvre par-dessus, leurs côtés se superposent. */}
        <div className={cn('mx-auto max-w-[1920px] px-20 pt-2', align === 'end' && 'flex justify-end')}>
          {/* Calque permanent (will-change) : le texte garde le même lissage
              pendant et après l'animation. Sans lui, Chrome sous Windows
              redessinait le texte à la fin de chaque fondu, d'où un léger
              scintillement. */}
          <div ref={contentRef} className={cn('pointer-events-auto will-change-transform', panelClassName)} style={{ opacity: 0 }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};

/* ─── Mobile : le rond du bouton s'étire en panneau ──────────────────────────
   Le voile fond sur la page, le rond du bouton s'étire jusqu'au panneau
   (ressort au léger rebond, qui fait gonfler la forme avant qu'elle se pose),
   puis les lignes entrent l'une après l'autre. Fermeture : les lignes
   s'effacent (100 ms), puis le panneau rentre dans le bouton, plus vite
   qu'il n'en est sorti et sans rebond.
   Les fondus sont natifs (playTo), la découpe est tracée depuis la page
   (clipTo) : à la fin de chacune, l'état final est déjà en place, jamais une
   image de l'état d'avant. */
const SHEET_INSET = 8;
const SHEET_RADIUS = 28;
const SHEET_OPEN_MS = 500;
const SHEET_CLOSE_MS = 300;
// Fondu du panneau autour du bouton : il n'apparaît ni ne disparaît d'un coup
// sur le rond du bouton.
const SHEET_EDGE_FADE_MS = 100;
const SHEET_ITEMS_STAGGER_MS = 20;
// Au-delà, les lignes suivantes entrent ensemble : la cascade reste courte.
const SHEET_ITEMS_MAX_STAGGER = 10;
// Durée pendant laquelle une ligne qui arrive entre encore comme à l'ouverture.
const SHEET_ITEMS_WATCH_MS = 1500;
// Marge entre le bord de la découpe et celui de la zone qui défile, au moment
// où les lignes peuvent entrer.
const SHEET_GATE_SLACK = 4;

// Calque permanent du voile et du panneau, du montage au démontage. Chrome
// Android leur donne un calque le temps d'une animation native, puis le
// retire à la fin : la page sous le menu, redessinée avec eux, n'était pas
// toujours prête à l'image suivante, et le voile et le fond du panneau
// disparaissaient une image (la page se voyait à travers le menu, juste après
// l'ouverture). Firefox n'a pas ce défaut.
const SHEET_LAYER = '[will-change:opacity,transform]';

// Retour arrière d'Android et Échap (Chrome ≥ 120) : ferme le panneau sans
// entrée d'historique. Absent du typage DOM de TypeScript.
type CloseWatcherLike = { onclose: (() => void) | null; destroy: () => void };
type CloseWatcherConstructor = new () => CloseWatcherLike;

type LiquidSheetProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> & {
  /** Bouton d'où sort le panneau. */
  triggerRef: React.RefObject<HTMLElement>;
  /** Rayon du bouton (un rond de 36 px : 18). */
  triggerRadius: number;
  rootRef?: React.RefObject<HTMLDivElement>;
  /** Zone qui défile, pour le verrouillage du défilement (useSheetScrollLock). */
  scrollerRef?: React.RefObject<HTMLDivElement>;
  onClose: () => void;
  /** Marges du contenu dans la zone qui défile. */
  contentClassName?: string;
  children: React.ReactNode;
};

/**
 * Panneau plein écran des téléphones et tablettes. Les éléments marqués
 * `data-sheet-item` entrent l'un après l'autre. Doit rester sous un
 * AnimatePresence, qui attend que le panneau soit rentré dans le bouton.
 */
export const LiquidSheet: React.FC<LiquidSheetProps> = ({
  triggerRef, triggerRadius, rootRef, scrollerRef, onClose, contentClassName = 'px-3', children, ...rest
}) => {
  const ownRootRef = useRef<HTMLDivElement>(null);
  const sheetRootRef = rootRef ?? ownRootRef;
  const ownScrollerRef = useRef<HTMLDivElement>(null);
  const sheetScrollerRef = scrollerRef ?? ownScrollerRef;
  const veilRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [isPresent, safeToRemove] = usePresence();
  const reduceMotion = useReducedMotionConfig();
  const closingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const entered = useRef(new WeakSet<HTMLElement>());
  // Découpe du panneau en cours d'ouverture, et porte des entrées : lignes et
  // contenu attendent, en pause, que la découpe ait couvert la zone qui
  // défile (voir watchGate).
  const clipRef = useRef<ClipTween | null>(null);
  const gateRef = useRef({ open: false, queued: 0, raf: 0, waiting: [] as Animation[] });
  const observerRef = useRef<MutationObserver | null>(null);

  // Les lignes défilent hors de la découpe du panneau (voir plus bas) : elles
  // ne doivent pas entrer avant qu'il les couvre. Le délai ne peut pas être
  // fixe : la découpe avance sur le fil principal (clipTo), les entrées sur
  // le compositeur. Au moindre blocage du fil (liste qui arrive, verrou du
  // défilement), les lignes s'affichaient en entier sur la page, avant le
  // panneau. La porte lit donc la découpe réelle, image par image.
  const gateReady = () => {
    const clip = clipRef.current;
    const panel = panelRef.current;
    const scroller = sheetScrollerRef.current;
    if (!clip || !clip.running || !panel || !scroller) return true;
    const sides = clips.get(panel);
    if (!sides) return true;
    const [, right, , left] = sides;
    const box = scroller.getBoundingClientRect();
    const panelBox = panel.getBoundingClientRect();
    return left <= box.left - panelBox.left + SHEET_GATE_SLACK
      && right <= panelBox.right - box.right + SHEET_GATE_SLACK;
  };

  const releaseGate = () => {
    const gate = gateRef.current;
    gate.open = true;
    gate.waiting.splice(0).forEach((animation) => animation.play());
  };

  const watchGate = () => {
    const gate = gateRef.current;
    cancelAnimationFrame(gate.raf);
    gate.open = false;
    const tick = () => {
      gate.raf = 0;
      if (closingRef.current) return;
      if (gateReady()) {
        releaseGate();
        return;
      }
      gate.raf = requestAnimationFrame(tick);
    };
    gate.raf = requestAnimationFrame(tick);
  };

  // Une animation d'entrée attend la porte, en pause sur sa première image.
  const hold = (animation: Animation | null) => {
    if (!animation || gateRef.current.open) return;
    animation.pause();
    gateRef.current.waiting.push(animation);
  };

  // Entrée d'une ligne, un peu après celle d'avant. Les lignes n'ont pas de
  // style en ligne : à la fin de leur entrée, elles sont dans leur état
  // normal. Même maintien de la dernière image que dans playTo, sinon une
  // ligne peut redevenir invisible une image.
  const enter = (item: HTMLElement, batchIndex: number) => {
    if (entered.current.has(item)) return;
    entered.current.add(item);
    if (closingRef.current || typeof item.animate !== 'function') return;
    const gate = gateRef.current;
    // Avant la porte, le rang compte depuis la première ligne en attente ;
    // après, depuis le début du lot.
    const index = Math.min(gate.open ? batchIndex : gate.queued++, SHEET_ITEMS_MAX_STAGGER);
    // Calque permanent : sur Chrome Android, une ligne qui perdait son calque
    // à la fin de son entrée disparaissait une image, le temps que le
    // contenu soit redessiné sans elle (voir le voile et le panneau).
    item.style.willChange = 'opacity';
    const entrance = item.animate(
      [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }],
      { duration: 320, delay: index * SHEET_ITEMS_STAGGER_MS, easing: EASE_OUT_CSS, fill: 'both' },
    );
    entrance.addEventListener('finish', () => retire(entrance));
    hold(entrance);
  };

  // Fait entrer les lignes visibles. Une ligne sous le bas de la zone qui
  // défile s'affiche telle quelle, sans animation ni calque : on ne la voit
  // pas entrer, et vingt calques de plus coûtent de la mémoire au GPU.
  const enterVisible = (items: HTMLElement[]) => {
    const fresh = items.filter((item) => !entered.current.has(item));
    if (!fresh.length) return;
    const limit = sheetScrollerRef.current?.getBoundingClientRect().bottom ?? Infinity;
    const tops = fresh.map((item) => item.getBoundingClientRect().top);
    let rank = 0;
    fresh.forEach((item, i) => {
      if (tops[i] >= limit) entered.current.add(item);
      else enter(item, rank++);
    });
  };

  // Ouverture, ou réouverture en pleine fermeture : chaque élément repart
  // alors de son état du moment, sans repasser par le bouton.
  const open = (first: boolean) => {
    const veil = veilRef.current;
    const panel = panelRef.current;
    const content = contentRef.current;
    if (!veil || !panel || !content) return;
    const shape = insetAll(SHEET_INSET, SHEET_RADIUS);
    playTo(veil, 'opacity', '1', 250, EASE_OUT_CSS, { from: first ? '0' : undefined });
    const from = first && !reduceMotion ? insetAround(panel, triggerRef.current, triggerRadius) : undefined;
    clipRef.current = null;
    if (reduceMotion || (first && !from)) {
      // Sans bouton mesurable ou avec animations réduites : un simple fondu.
      clipTo(panel, shape, 0, 0);
      playTo(panel, 'opacity', '1', 200, EASE_OUT_CSS, { from: first ? '0' : undefined });
    } else {
      playTo(panel, 'opacity', '1', first ? SHEET_EDGE_FADE_MS : 200, first ? 'linear' : EASE_OUT_CSS, { from: first ? '0' : undefined });
      clipRef.current = clipTo(panel, shape, SHEET_OPEN_MS, 0.15, { from: from ?? undefined });
    }
    watchGate();
    if (!first) {
      // Le contenu attend lui aussi que le panneau soit ressorti du bouton.
      hold(playTo(content, 'opacity', '1', 150, EASE_OUT_CSS));
      return;
    }
    if (MotionGlobalConfig.skipAnimations) {
      releaseGate();
      return;
    }
    if (reduceMotion) {
      // Un seul fondu pour tout le contenu, sans cascade ni déplacement.
      playTo(content, 'opacity', '1', 200, EASE_OUT_CSS, { from: '0' });
      content.querySelectorAll<HTMLElement>('[data-sheet-item]').forEach((item) => entered.current.add(item));
      return;
    }
    enterVisible([...content.querySelectorAll<HTMLElement>('[data-sheet-item]')]);
  };

  // Posé avant la première image : rien ne s'affiche d'abord en entier.
  useLayoutEffect(() => {
    open(true);
    const content = contentRef.current;
    const gate = gateRef.current;
    if (!content || MotionGlobalConfig.skipAnimations || reduceMotion || typeof MutationObserver === 'undefined') {
      return () => cancelAnimationFrame(gate.raf);
    }
    // Lignes rendues après l'ouverture (notifications chargées, squelette
    // remplacé, ligne admin) : sans leur propre entrée, elles s'affichaient
    // d'emblée, en entier, par-dessus la page, avant même que le panneau
    // sorte du bouton (la zone qui défile est hors de sa découpe). Elles
    // passent par la même porte que les autres. Après l'ouverture, une ligne
    // chargée en plus s'affiche telle quelle, dans le panneau.
    const observer = new MutationObserver((mutations) => {
      const added: HTMLElement[] = [];
      mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        if (node.matches('[data-sheet-item]')) added.push(node);
        added.push(...node.querySelectorAll<HTMLElement>('[data-sheet-item]'));
      }));
      enterVisible(added);
    });
    observer.observe(content, { childList: true, subtree: true });
    observerRef.current = observer;
    const stop = window.setTimeout(() => observer.disconnect(), SHEET_ITEMS_WATCH_MS);
    return () => {
      window.clearTimeout(stop);
      observer.disconnect();
      cancelAnimationFrame(gate.raf);
    };
    // Au montage seulement : la fermeture et la réouverture sont plus bas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Retour arrière d'Android (et Échap) : ferme le panneau au lieu de quitter
  // la page.
  useEffect(() => {
    if (!isPresent) return;
    const Watcher = (window as Window & { CloseWatcher?: CloseWatcherConstructor }).CloseWatcher;
    if (typeof Watcher !== 'function') return;
    let watcher: CloseWatcherLike;
    try {
      watcher = new Watcher();
    } catch {
      return;
    }
    watcher.onclose = () => onCloseRef.current();
    return () => watcher.destroy();
  }, [isPresent]);

  useEffect(() => {
    const root = sheetRootRef.current;
    const veil = veilRef.current;
    const panel = panelRef.current;
    const content = contentRef.current;
    if (!veil || !panel || !content) return;
    // Pendant la fermeture, le menu ne reçoit plus ni toucher ni focus : la
    // zone qui défile, devenue invisible, renvoyait encore un toucher sur la
    // page vers un lien du menu.
    if (root) root.inert = !isPresent;
    if (isPresent) {
      if (!closingRef.current) return;
      closingRef.current = false;
      open(false);
      return;
    }
    closingRef.current = true;
    cancelAnimationFrame(gateRef.current.raf);
    observerRef.current?.disconnect();
    const button = reduceMotion ? null : insetAround(panel, triggerRef.current, triggerRadius);
    const closing = [
      playTo(content, 'opacity', '0', 100, EASE_OUT_CSS),
      playTo(veil, 'opacity', '0', 250, EASE_OUT_CSS),
      ...(button
        ? [
          clipTo(panel, button, SHEET_CLOSE_MS, 0, { delay: 50 }),
          // Le rond rentré dans le bouton s'efface au lieu de disparaître
          // d'un coup. Fondu composé : même si la page est occupée après la
          // fermeture (navigation), le panneau ne reste pas figé en grand.
          playTo(panel, 'opacity', '0', SHEET_EDGE_FADE_MS, 'linear', { delay: 50 + SHEET_CLOSE_MS - SHEET_EDGE_FADE_MS }),
        ]
        : [playTo(panel, 'opacity', '0', 150, EASE_OUT_CSS)]),
    ];
    let cancelled = false;
    settled(closing).then(() => {
      if (!cancelled) safeToRemove?.();
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPresent]);

  return (
    <div {...rest} ref={sheetRootRef}>
      {/* Voile sur la page : il n'en reste qu'une marge de 8 px autour du
          panneau. Un toucher dessus referme le menu. */}
      <div ref={veilRef} aria-hidden="true" className={cn('fixed inset-0 z-[10999] bg-black/60', SHEET_LAYER)} onClick={onClose} />
      {/* Le panneau lui-même, qui sort du bouton. Il couvre l'en-tête : les
          icônes de l'en-tête, posées au-dessus, deviennent sa première ligne,
          et le bouton reste là où il était pour refermer. Seule sa découpe
          bouge (clip-path) : ni transform ni taille, rien à remettre en page. */}
      <div
        ref={panelRef}
        data-liquid-surface
        className={cn('pointer-events-none fixed inset-0 z-[10999] bg-[#141416]', SHEET_LAYER)}
      />
      {/* La zone qui défile reste hors de la découpe et ne bouge jamais : une
          transformation sur un défileur (ou son parent) pendant son montage
          laisse parfois WebKit iOS avec une zone tactile périmée, et le menu
          ne défile plus. Seul son contenu s'anime. Coins du bas arrondis comme
          le panneau, pour que rien ne dépasse en défilant. */}
      <div
        ref={sheetScrollerRef}
        data-lenis-prevent
        className="fixed inset-x-2 bottom-2 top-16 z-[10999] overflow-y-auto rounded-b-[28px]"
        style={{ touchAction: 'pan-y', overscrollBehavior: 'contain' }}
      >
        {/* Calque permanent (will-change), opacité comprise : chaque ligne
            garde le même lissage de texte pendant et après son entrée, et
            Chrome continue de peindre les lignes quand le contenu passe à 0
            (fermeture), au lieu de retirer puis recréer leurs calques. */}
        <div
          ref={contentRef}
          className={cn('pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-2 [will-change:transform,opacity]', contentClassName)}
        >
          {children}
        </div>
      </div>
    </div>
  );
};
