import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { CANDY_KINDS, HalloweenCandy, HalloweenWitch } from './HalloweenDecorArt';

/**
 * Sorcière du décor Halloween, et ce qui arrive quand on l'attrape au vol :
 * elle s'arrête et secoue son balai, une poignée de bonbons s'échappe là où
 * on a cliqué ; puis, vexée, elle relève le nez, fait demi-tour et file hors
 * de l'écran, son chat cramponné au balai. Elle revient au passage suivant.
 *
 * Le vol reste l'animation CSS de halloween-decor.css, jamais arrêtée ni
 * relancée : l'arrêt et la fuite sont des animations posées par-dessus (Web
 * Animations), retirées une fois la sorcière hors champ. Son cycle reste
 * ainsi calé sur les 3,6 s des autres animations du décor (voir les
 * citrouilles). Seul son dessin se clique, pas le cadre autour : elle ne
 * vole aucun clic au site qu'elle survole.
 *
 * Sur mobile et écran tactile, pas de vol en boucle : il ferait travailler
 * l'écran sans arrêt. Elle passe toutes les 30 s, sur deux lignes : vers la
 * droite sous l'en-tête, demi-tour hors champ, puis vers la gauche plus bas.
 * Entre deux passages, elle est retirée de l'affichage et rien ne bouge.
 */

// halloween-witch-fly : cycle de 10,8 s, dont les premiers 55,5 % à l'écran.
const FLY_ANIMATION = 'halloween-witch-fly';
const FLY_CYCLE_MS = 10800;
const FLY_ON_SCREEN = 0.555;

// Mobile : même requête que halloween-decor.css, qui n'affiche la sorcière
// que pendant un passage (attribut posé ici).
const MOBILE_QUERY = '(max-width: 1023px), (pointer: coarse)';
const FLYING_ATTR = 'data-flying';
const MOBILE_FIRST_MS = 3600;
const MOBILE_EVERY_MS = 30000;
const MOBILE_LINE_MS = 4500;
const MOBILE_TURN_MS = 700;
// Pendant un passage, les citrouilles s'agitent (halloween-decor.css), le
// temps de trois vacillements de leurs visages : posé sur le calque du
// décor, retiré une fois leurs animations finies, même si on l'attrape.
const PASS_ATTR = 'data-witch-pass';
const PUMPKINS_EXCITED_MS = 10800;

// Balancement le long d'une ligne : [part de la ligne, hauteur (px), angle].
const MOBILE_WAVES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, -3], [0.17, -10, 2], [0.33, 4, -3], [0.5, -8, 2], [0.67, 5, -3], [0.83, -6, 1], [1, 0, -3],
];

// Déroulé après le clic, en ms : elle secoue son balai (les bonbons
// tombent), relève le nez, fait demi-tour, recule un peu pour prendre son
// élan, puis file.
const SHAKE_MS = 420;
const HUFF_MS = 220;
const TURN_MS = 200;
const TURNED_MS = SHAKE_MS + HUFF_MS + TURN_MS;
const POSE_MS = TURNED_MS + 160;
const WINDUP_MS = 140;

const pose = (y: number, angle: number, scaleX: number, scaleY: number) =>
  `translate3d(0, ${y}px, 0) rotate(${angle}deg) scale(${scaleX}, ${scaleY})`;
const poseAt = (ms: number) => ms / POSE_MS;

// Attitude de la sorcière, autour du milieu de son corps. Retournée par
// scale(-1, 1), elle regarde à gauche : un angle positif lui relève alors le
// nez, comme un angle négatif avant le demi-tour.
const VEXED_POSE: Keyframe[] = [
  { offset: 0, transform: pose(0, 0, 1, 1) },
  { offset: poseAt(70), transform: pose(-3, -9, 1, 1) },
  { offset: poseAt(140), transform: pose(2, 8, 1, 1) },
  { offset: poseAt(210), transform: pose(-3, -7, 1, 1) },
  { offset: poseAt(280), transform: pose(2, 6, 1, 1) },
  { offset: poseAt(350), transform: pose(-1, -3, 1, 1) },
  { offset: poseAt(SHAKE_MS), transform: pose(0, 0, 1, 1), easing: 'ease-out' },
  { offset: poseAt(SHAKE_MS + 120), transform: pose(-6, -11, 1, 1) },
  { offset: poseAt(SHAKE_MS + HUFF_MS), transform: pose(-6, -11, 1, 1), easing: 'ease-in' },
  // Demi-tour : le dessin se retourne sur place, vu par la tranche à mi-course.
  { offset: poseAt(SHAKE_MS + HUFF_MS + TURN_MS / 2), transform: pose(-4, -4, 0, 1.06), easing: 'ease-out' },
  { offset: poseAt(TURNED_MS), transform: pose(-2, 4, -1, 1) },
  // Étirée par la vitesse.
  { offset: 1, transform: pose(0, 7, -1.07, 0.95) },
];

/**
 * Le chat, autour de ses pattes : soufflé vers l'arrière, il bat au vent
 * jusqu'à la sortie de l'écran.
 */
const clingingCat = (duration: number): Keyframe[] => {
  const frames: Keyframe[] = [{ offset: 0, transform: 'rotate(0deg)' }];
  for (let t = 120, i = 0; t < duration; t += 90, i += 1) {
    frames.push({ offset: t / duration, transform: `rotate(${i % 2 ? -40 : -56}deg)` });
  }
  frames.push({ offset: 1, transform: 'rotate(-48deg)' });
  return frames;
};

const translate = (x: number, y: number) => `translate3d(${x}px, ${y}px, 0)`;

// ─── Passage sur mobile ──────────────────────────────────────────────────────

/** Retournée (facing −1), elle regarde à gauche : ses angles s'inversent. */
const bobPose = (y: number, angle: number, facing: 1 | -1) =>
  `translate3d(0, ${y}px, 0) rotate(${angle * facing}deg) scale(${facing}, 1)`;

/**
 * Vagues sur chaque ligne ; entre les deux, hors champ, elle se retourne
 * pour repartir vers la gauche.
 */
const mobileWaves = (lineEnd: number, lineStart: number): Keyframe[] => {
  const line = (from: number, to: number, facing: 1 | -1) => MOBILE_WAVES.map(([at, y, angle]): Keyframe => ({
    offset: from + (to - from) * at,
    transform: bobPose(y, angle, facing),
    easing: 'ease-in-out',
  }));
  return [...line(0, lineEnd, 1), ...line(lineStart, 1, -1)];
};

type MobileFlight = { animations: Animation[]; turnAt: number; total: number };

/**
 * Lance un passage : la sorcière doit déjà être affichée (ses mesures en
 * dépendent). Positions dans le calque du décor : calé par le bas, son haut
 * passe sous la barre d'adresse quand elle est visible, d'où le décalage.
 */
const startMobileFlight = (fly: HTMLElement, bob: HTMLElement): MobileFlight | null => {
  const box = (fly.offsetParent as HTMLElement | null)?.getBoundingClientRect();
  if (!box) return null;
  const width = fly.offsetWidth;
  const view = window.innerHeight;
  // Première ligne juste sous l'en-tête, seconde un cinquième d'écran plus bas.
  const y1 = Math.max(0, -box.top) + Math.max(76, view * 0.15);
  const y2 = y1 + Math.max(100, view * 0.2);
  // Hors champ, paillettes comprises : elles traînent derrière le balai.
  const outLeft = -1.4 * width;
  const outRight = box.width + 0.35 * width;
  const total = 2 * MOBILE_LINE_MS + MOBILE_TURN_MS;
  const lineEnd = MOBILE_LINE_MS / total;
  const lineStart = (MOBILE_LINE_MS + MOBILE_TURN_MS) / total;
  const timing: KeyframeAnimationOptions = { duration: total, easing: 'linear' };
  return {
    animations: [
      fly.animate([
        { offset: 0, transform: translate(outLeft, y1 + view * 0.025) },
        { offset: lineEnd, transform: translate(outRight, y1 - view * 0.02) },
        { offset: lineStart, transform: translate(outRight, y2) },
        { offset: 1, transform: translate(outLeft, y2 + view * 0.03) },
      ], timing),
      bob.animate(mobileWaves(lineEnd, lineStart), timing),
    ],
    turnAt: (lineEnd + lineStart) / 2,
    total,
  };
};

// ─── Bonbons lâchés ──────────────────────────────────────────────────────────

type BurstCandy = {
  kind: number;
  size: number;
  /** Coin haut gauche, autour du point du clic. */
  left: number;
  top: number;
  /** Montée jusqu'au sommet, puis chute jusque sous l'écran (px). */
  rise: number;
  drop: number;
  /** Part de la durée passée à monter. */
  apex: number;
  drift: number;
  spin: number;
  duration: number;
  delay: number;
};

type CandyBurstData = { id: number; x: number; y: number; candies: BurstCandy[] };

const BURST_CANDIES = 16;
// Chute libre exacte : une montée qui ralentit (y = 1 − (1 − t)²), puis une
// descente qui accélère (y = t²). Le glissement de côté, lui, est constant.
const RISE_EASING = 'cubic-bezier(0.333, 0.667, 0.667, 1)';
const FALL_EASING = 'cubic-bezier(0.333, 0, 0.667, 0.333)';

/**
 * Poignée de bonbons qui jaillit de (x ; y), deux de chaque sorte. Le point
 * est compté dans le calque du décor, dont `bottom` est le bas.
 */
const makeBurst = (id: number, x: number, y: number, bottom: number): CandyBurstData => {
  const height = window.innerHeight;
  // Pesanteur à l'échelle de l'écran : la chute dure autant partout.
  const gravity = 1.6 * height;
  const firstKind = Math.floor(Math.random() * CANDY_KINDS);
  const candies = Array.from({ length: BURST_CANDIES }, (_, i): BurstCandy => {
    const size = 22 + Math.random() * 12;
    const up = (0.18 + Math.random() * 0.34) * height;
    const across = (Math.random() * 2 - 1) * 0.3 * height;
    const rise = (up * up) / (2 * gravity);
    const drop = bottom - y + size + 20;
    const upSeconds = up / gravity;
    const seconds = upSeconds + Math.sqrt((2 * (rise + drop)) / gravity);
    return {
      kind: (firstKind + i) % CANDY_KINDS,
      size,
      left: (Math.random() * 2 - 1) * 8 - size / 2,
      top: (Math.random() * 2 - 1) * 8 - size / 2,
      rise,
      drop,
      apex: upSeconds / seconds,
      drift: across * seconds,
      spin: (Math.random() < 0.5 ? -1 : 1) * (300 + Math.random() * 420) * seconds,
      duration: seconds * 1000,
      // Ils sortent pendant qu'elle secoue son balai, pas tous d'un coup.
      delay: Math.random() * 200,
    };
  });
  return { id, x, y, candies };
};

/**
 * Bonbons d'un clic. Chacun a deux <span> animés : la chute (verticale) et,
 * dedans, le glissement de côté avec la rotation, pour que chaque mouvement
 * garde sa propre courbe. Invisibles hors de leur animation, retirés quand
 * le dernier est tombé.
 */
const CandyBurst = memo(function CandyBurst({ burst, onDone }: { burst: CandyBurstData; onDone: (id: number) => void }) {
  const root = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const element = root.current;
    if (!element || typeof element.animate !== 'function') return undefined;
    const animations = burst.candies.flatMap((candy, i) => {
      const fall = element.children[i] as HTMLElement;
      const spin = fall.firstElementChild as HTMLElement;
      const timing: KeyframeAnimationOptions = { duration: candy.duration, delay: candy.delay, fill: 'backwards' };
      // Il sort petit et grossit en 140 ms, comme éjecté.
      const pop = Math.min(0.12, 140 / candy.duration);
      return [
        fall.animate([
          { offset: 0, transform: 'translate3d(0, 0, 0)', easing: RISE_EASING },
          { offset: candy.apex, transform: `translate3d(0, ${-candy.rise}px, 0)`, easing: FALL_EASING },
          { offset: 1, transform: `translate3d(0, ${candy.drop}px, 0)` },
        ], timing),
        spin.animate([
          { offset: 0, opacity: 0, transform: 'translate3d(0, 0, 0) rotate(0deg) scale(0.35)' },
          { offset: pop, opacity: 1, transform: `translate3d(${candy.drift * pop}px, 0, 0) rotate(${candy.spin * pop}deg) scale(1)` },
          { offset: 1, opacity: 1, transform: `translate3d(${candy.drift}px, 0, 0) rotate(${candy.spin}deg) scale(1)` },
        ], timing),
      ];
    });
    let live = true;
    void Promise.all(animations.map((animation) => animation.finished)).then(
      () => { if (live) onDone(burst.id); },
      () => undefined,
    );
    return () => {
      live = false;
      animations.forEach((animation) => animation.cancel());
    };
  }, [burst, onDone]);

  return (
    <span ref={root} className="halloween-candy-burst" style={{ left: burst.x, top: burst.y }}>
      {burst.candies.map((candy, i) => (
        <span
          key={i}
          className="halloween-candy-burst-fall"
          style={{ left: candy.left, top: candy.top, width: candy.size, height: candy.size }}
        >
          <span className="halloween-candy-burst-spin">
            <HalloweenCandy kind={candy.kind} />
          </span>
        </span>
      ))}
    </span>
  );
});

// Le dessin ne change jamais : rien à refaire quand les bonbons arrivent.
const Witch = memo(HalloweenWitch);

type MobileState = {
  flight: MobileFlight | null;
  timer: number;
  /** Calque où les citrouilles s'agitent, et la fin de leur agitation. */
  excited: HTMLElement | null;
  calm: number;
  /** Arrête le passage en cours et retire la sorcière de l'affichage. */
  land: () => void;
  /** Prochain passage dans `ms`, si l'écran est toujours en mode mobile. */
  later: (ms: number) => void;
};

export const HalloweenWitchFlight = memo(function HalloweenWitchFlight() {
  const flyRef = useRef<HTMLSpanElement>(null);
  const bobRef = useRef<HTMLSpanElement>(null);
  const poseRef = useRef<HTMLSpanElement>(null);
  // Scène en cours : animations posées sur le vol, minuterie de fin.
  const scene = useRef({ active: false, timer: 0, animations: [] as Animation[] });
  const mobile = useRef<MobileState>({
    flight: null,
    timer: 0,
    excited: null,
    calm: 0,
    land: () => undefined,
    later: () => undefined,
  });
  const nextBurst = useRef(0);
  const [bursts, setBursts] = useState<CandyBurstData[]>([]);

  useEffect(() => {
    const current = scene.current;
    return () => {
      window.clearTimeout(current.timer);
      current.animations.forEach((animation) => animation.cancel());
    };
  }, []);

  // Passages sur mobile. Décor figé ou caché (animations coupées, menu
  // ouvert, onglet en arrière-plan) : elle repasse plus tard.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(MOBILE_QUERY);
    const state = mobile.current;
    let enabled = false;

    function land() {
      state.flight?.animations.forEach((animation) => animation.cancel());
      state.flight = null;
      flyRef.current?.removeAttribute(FLYING_ATTR);
    }
    function calmDown() {
      window.clearTimeout(state.calm);
      state.excited?.removeAttribute(PASS_ATTR);
      state.excited = null;
    }
    function later(ms: number) {
      window.clearTimeout(state.timer);
      if (enabled) state.timer = window.setTimeout(takeOff, ms);
    }
    function takeOff() {
      const fly = flyRef.current;
      const bob = bobRef.current;
      const root = document.documentElement;
      if (!fly || !bob || typeof fly.animate !== 'function') return;
      if (document.hidden || root.hasAttribute('data-no-bg-anim') || root.hasAttribute('data-explore-open')) {
        later(MOBILE_EVERY_MS);
        return;
      }
      fly.setAttribute(FLYING_ATTR, '');
      const flight = startMobileFlight(fly, bob);
      state.flight = flight;
      if (!flight) {
        fly.removeAttribute(FLYING_ATTR);
        return;
      }
      calmDown();
      state.excited = fly.parentElement;
      state.excited?.setAttribute(PASS_ATTR, '');
      state.calm = window.setTimeout(calmDown, PUMPKINS_EXCITED_MS);
      // Attrapée en route, c'est la fuite (onPointerDown) qui la retire.
      flight.animations[0].finished.then(() => {
        if (state.flight !== flight) return;
        land();
        later(MOBILE_EVERY_MS - flight.total);
      }, () => undefined);
    }
    const apply = () => {
      land();
      calmDown();
      enabled = query.matches;
      later(MOBILE_FIRST_MS);
    };

    state.land = land;
    state.later = later;
    apply();
    query.addEventListener?.('change', apply);
    return () => {
      query.removeEventListener?.('change', apply);
      enabled = false;
      window.clearTimeout(state.timer);
      land();
      calmDown();
    };
  }, []);

  const dropBurst = useCallback((id: number) => {
    setBursts((list) => list.filter((burst) => burst.id !== id));
  }, []);

  // Au moment où l'on appuie, pas au relâchement : elle vole, et serait
  // déjà plus loin.
  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLSpanElement>) => {
    const fly = flyRef.current;
    const body = poseRef.current;
    const current = scene.current;
    if (event.button !== 0 || current.active || !fly || !body) return;
    if (typeof fly.animate !== 'function' || typeof fly.getAnimations !== 'function') return;
    // Sur mobile, le passage en cours ; sinon, le vol CSS en boucle.
    const passage = mobile.current.flight;
    const flight = passage
      ? undefined
      : fly.getAnimations().find((animation) => (animation as CSSAnimation).animationName === FLY_ANIMATION);
    if (!passage && !flight) return;
    current.active = true;

    // Sur la seconde ligne du mobile, elle vole vers la gauche : sa fuite
    // part vers la droite. Le passage s'arrête là où on l'a attrapée.
    let backwards = false;
    if (passage) {
      backwards = (passage.animations[0].effect?.getComputedTiming().progress ?? 0) > passage.turnAt;
      passage.animations.forEach((animation) => animation.pause());
    }

    // Coordonnées dans le calque du décor : calé par le bas, son haut passe
    // sous la barre d'adresse du mobile quand elle est visible.
    const box = (fly.offsetParent as HTMLElement | null)?.getBoundingClientRect();
    const burst = makeBurst(
      nextBurst.current++,
      event.clientX - (box?.left ?? 0),
      event.clientY - (box?.top ?? 0),
      box?.height ?? window.innerHeight,
    );
    setBursts((list) => [...list, burst]);

    // Figée là où on l'a attrapée, puis la fuite à l'opposé de sa course, en
    // montant un peu. Retournée vers la gauche, sa paille et ses paillettes
    // dépassent de son cadre à droite : elle n'est hors champ qu'une fois son
    // cadre passé de 1,6 fois sa largeur. Vers la droite, elles traînent à
    // gauche du cadre.
    const start = new DOMMatrixReadOnly(getComputedStyle(fly).transform);
    const x = start.m41;
    const y = start.m42;
    const width = fly.offsetWidth;
    const endX = backwards ? (box?.width ?? window.innerWidth) + 0.4 * width + 24 : -1.6 * width - 24;
    const endY = y - window.innerHeight * 0.05;
    const runMs = Math.round(Math.min(1150, Math.max(420, 260 + Math.abs(x - endX) * 0.42)));
    const total = TURNED_MS + WINDUP_MS + runMs;
    const windup = Math.round(width * 0.09) * (backwards ? -1 : 1);
    const animations = [
      fly.animate([
        { offset: 0, transform: translate(x, y) },
        { offset: TURNED_MS / total, transform: translate(x, y), easing: 'ease-out' },
        { offset: (TURNED_MS + WINDUP_MS) / total, transform: translate(x + windup, y + 2), easing: 'cubic-bezier(0.45, 0, 0.8, 0.5)' },
        { offset: 1, transform: translate(endX, endY) },
      ], { duration: total, fill: 'forwards' }),
      body.animate(VEXED_POSE, { duration: POSE_MS, fill: 'forwards' }),
    ];
    const cat = body.querySelector<HTMLElement>('.halloween-witch-cat');
    if (cat) {
      const catDelay = TURNED_MS + WINDUP_MS / 2;
      animations.push(cat.animate(clingingCat(total - catDelay), { duration: total - catDelay, delay: catDelay, fill: 'forwards' }));
    }
    current.animations = animations;

    // Sur mobile, le passage s'arrête avec la fuite : une fois hors champ,
    // la sorcière est retirée et repasse 30 s plus tard.
    if (passage) {
      current.timer = window.setTimeout(() => {
        mobile.current.land();
        current.animations.forEach((animation) => animation.cancel());
        current.animations = [];
        current.active = false;
        mobile.current.later(MOBILE_EVERY_MS);
      }, total);
      return;
    }

    // Une fois le vol CSS hors champ à droite (fin de son cycle), la fuite
    // est retirée sans saut visible et le passage suivant se fait comme
    // d'habitude. Décor figé (menu Explorer ouvert) : on repasse plus tard.
    const settle = () => {
      const progress = flight?.effect?.getComputedTiming().progress ?? 1;
      const wait = (FLY_ON_SCREEN - progress) * FLY_CYCLE_MS;
      if (wait <= 0) {
        current.animations.forEach((animation) => animation.cancel());
        current.animations = [];
        current.active = false;
        return;
      }
      current.timer = window.setTimeout(settle, flight?.playState === 'running' ? wait + 40 : 1000);
    };
    current.timer = window.setTimeout(settle, total);
  }, []);

  return (
    <>
      <span ref={flyRef} className="halloween-witch" onPointerDown={onPointerDown}>
        <span ref={bobRef} className="halloween-witch-bob">
          <span ref={poseRef} className="halloween-witch-pose">
            <Witch />
          </span>
        </span>
      </span>
      {bursts.map((burst) => <CandyBurst key={burst.id} burst={burst} onDone={dropBurst} />)}
    </>
  );
});
