// Moteur des effets d'ambiance : un seul canvas plein écran, sans événement
// souris (pointer-events: none). Plusieurs effets tournent ensemble : neige,
// feuilles d'automne, pluie, fleurs de cerisier, pop-corn, Halloween (neige de
// bonbons, citrouilles, fantômes et chauves-souris du thème Halloween de Movix). Ce
// qui tombe vit dans le repère de l'écran ; ce qui se pose est attaché aux
// cards (`.carousel-card` ou `[data-ambient-surface]`) et au bas de l'écran.
// Le curseur creuse la neige et fait voler feuilles et bonbons, un appui sur
// un tas de neige forme une boule qu'on lance. Physique des tas : voir
// pilePhysics.ts ; dessins : voir ambientSprites.ts et ambientHalloweenArt.ts.
import {
  capacityProfile, carveCircle, columnCount, cornerDrop, deposit, melt, relax, resample, smooth,
} from './pilePhysics';
import type { AmbientIntensity, AmbientOptions } from './ambientOptions';
import {
  LEAF_COLORS, LEAF_DRAW, LEAF_SHAPES, PETAL_DRAW, PETAL_TINTS, POPCORN_SHAPES, buildSprites, type Sprites,
} from './ambientSprites';
// Type seul : les dessins d'Halloween ne se chargent que si l'effet est coché.
import type { HalloweenArt } from './ambientHalloweenArt';

const SURFACE_SELECTOR = '.carousel-card, [data-ambient-surface]';
const HEADER_SELECTOR = '[data-site-header]';

const GRAVITY = 980;
/** Volume d'un grain projeté ou qui glisse d'un bord (px²). */
const GRAIN_VOLUME = 2.2;
/** Un flocon posé compte plus que sa surface réelle, sinon il faudrait des minutes pour voir un tas. */
const DEPOSIT_GAIN = 4.5;
/**
 * Ce qui croise une card ne s'y pose qu'une fois sur deux : le reste passe
 * devant. Sans ça, la première rangée abrite toutes celles du dessous.
 */
const LANDING_CHANCE = 0.55;
/** Neige fine que l'on ne voit pas tomber (px de hauteur par seconde, intensité normale) : toutes les cards blanchissent. */
const HAZE_RATE = 0.07;
const HAZE_DROP = 5;
/** Vitesse de tassement des tas de neige (diffusion, par seconde). */
const SETTLE_RATE = 2.5;
const MAX_GRAINS = 900;
const MAX_FLUTTERS = 900;
const MAX_RIPPLES = 70;
const BALL_MAX_VOLUME = Math.PI * 11 * 11;
const CURSOR_RADIUS = { mouse: 13, touch: 18 };
const INTENSITY: Record<Exclude<AmbientIntensity, 'variable'>, number> = { light: 0.5, normal: 1, heavy: 1.86 };
/** Éléments à l'écran pour 2 Mpx (≈ 1920 × 1080), à intensité normale. */
const DENSITY = { snow: 140, leaves: 24, petals: 42, rain: 120, candies: 22, popcorn: 36 };
/** Flocons — lointain, moyen, proche : seuls les deux derniers se posent. */
const LAYERS = [
  { weight: 0.35, r: [0.6, 1.1], vy: [22, 36], alpha: 0.4, wind: 0.5 },
  { weight: 0.4, r: [1.1, 1.9], vy: [38, 58], alpha: 0.72, wind: 0.8 },
  { weight: 0.25, r: [1.9, 3.1], vy: [56, 84], alpha: 0.95, wind: 1 },
] as const;
/** Pluie — lointaine, moyenne, proche : seules les deux dernières éclaboussent. */
const RAIN_LAYERS = [
  { weight: 0.4, vy: [620, 760], len: [9, 13], alpha: 0.2, width: 1, wind: 0.7 },
  { weight: 0.38, vy: [860, 1040], len: [14, 20], alpha: 0.32, width: 1.1, wind: 0.85 },
  { weight: 0.22, vy: [1150, 1400], len: [20, 28], alpha: 0.48, width: 1.4, wind: 1 },
] as const;
/** La pluie tombe toujours un peu de biais (px/s), le vent fait le reste. */
const RAIN_SLANT = 60;
/** Feuilles et pétales prennent le vent bien plus que les flocons ; un bonbon, à peine. */
const FLUTTER_WIND = 2.2;
const CANDY_WIND = 0.7;
const POPCORN_WIND = 1.2;
/** Volume d'une feuille de demi-longueur 12 px dans son tas (px²) ; un pétale de 5 px ; une fleur ; un bonbon de 12 px. */
const LEAF_VOLUME = 70;
const PETAL_VOLUME = 26;
const FLOWER_VOLUME = 60;
const CANDY_VOLUME = 64;
/** Un grain de pop-corn de demi-taille 8 px. */
const POPCORN_VOLUME = 44;
/** Durée du fondu d'une feuille fanée qui disparaît (s). */
const LITTER_FADE = 2.5;

const TAU = Math.PI * 2;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Étalement, en colonnes, de la place que prend une feuille dans son tas. */
const litterSpread = (size: number, colW: number) => Math.max(1, (size * 0.8) / colW);

/** Les effets qui font tomber quelque chose ; pour Halloween, des bonbons. */
type Falling = 'snow' | 'leaves' | 'petals' | 'rain' | 'popcorn' | 'halloween';
const FALLING: Falling[] = ['snow', 'leaves', 'petals', 'rain', 'popcorn', 'halloween'];

interface Flake {
  x: number; y: number; prevY: number; r: number; vy: number; layer: number;
  phase: number; freq: number; amp: number;
}

const FlutterKind = { Leaf: 0, Petal: 1, Flower: 2, Candy: 3, Popcorn: 4 } as const;
type FlutterKind = (typeof FlutterKind)[keyof typeof FlutterKind];
/** Bonbon ou pop-corn : un objet plein, qui tourne sans se retourner et ne se fane pas. */
const isSolid = (kind: FlutterKind) => kind === FlutterKind.Candy || kind === FlutterKind.Popcorn;

/** Feuille, pétale ou fleur qui virevolte en tombant ; bonbon qui tombe en tournant. */
interface Flutter {
  kind: FlutterKind; variant: number;
  x: number; y: number; prevY: number; size: number; vy: number;
  /** Balancement : phase, fréquence (rad/s), amplitude (px/s). */
  phase: number; freq: number; amp: number;
  rot: number; spin: number; flip: number; flipSpeed: number;
  /** Élan reçu du curseur ou d'une card qui glisse, vite amorti. */
  kx: number; ky: number;
  /** Temps restant avant de s'effacer (balayage), sinon -1. */
  fade: number;
  /** 0 = fraîche, 1 = sèche : gardé quand une feuille posée s'envole. */
  dry: number;
  /** Chassée d'un tas : en plus du compte, elle n'est pas remplacée une fois sortie de l'écran. */
  loose: boolean;
}

/** Feuille, pétale ou fleur posés sur une surface. */
interface Litter {
  kind: FlutterKind; variant: number;
  /** Abscisse depuis le bord gauche de la surface (px). */
  x: number;
  /** Rang dans l'épaisseur du tas : 0 tout en bas, 1 au sommet. */
  depth: number;
  rot: number; size: number;
  /** Écrasement à plat, et celui qu'elle avait en touchant le tas. */
  squash: number; from: number;
  /** Temps depuis l'atterrissage, borné à 1 : la feuille finit de se coucher. */
  t: number;
  age: number; life: number; vol: number; expiring: boolean;
}

interface Drop { x: number; y: number; prevY: number; vy: number; len: number; layer: number }

/** Goutte qui coule par à-coups sur une affiche, suivie de sa traînée. */
interface Bead {
  x: number; y: number; r: number; v: number; target: number;
  wait: number; run: number; tail: number; phase: number;
}

/** Goutte pendue sous le bord d'une card : elle grossit puis tombe. */
interface Drip { x: number; r: number; max: number; rate: number }

interface Ripple { x: number; y: number; age: number; life: number; w: number }

/** Grain : neige qui se reposera ; bloc : éclate en touchant ; poudre : décor qui s'efface ; goutte : éclabousse. */
const GrainKind = { Grain: 0, Lump: 1, Powder: 2, Drop: 3 } as const;
type GrainKind = (typeof GrainKind)[keyof typeof GrainKind];

interface Grain {
  x: number; y: number; prevY: number; vx: number; vy: number; r: number; vol: number;
  kind: GrainKind; life: number; maxLife: number; water: boolean;
  /** Surface quittée à l'instant : on ne s'y repose pas tout de suite. */
  skip: Surface | null; skipFor: number;
  /** Temps pendant lequel le grain ne se pose sur aucune card (blocs d'une card retirée). */
  cardsOff: number;
}

interface Splat { x: number; y: number; age: number; life: number; blobs: number[] }

interface Surface {
  el: Element | null;
  ground: boolean;
  n: number;
  /** Neige. */
  h: Float32Array;
  /** Feuilles et pétales : hauteur réelle du tas, et celle qu'on dessine (elle la rattrape en douceur). */
  lh: Float32Array;
  lhShown: Float32Array;
  cap: Float32Array;
  /** Descente du bord arrondi sous chaque colonne (px, repère local). */
  base: Float32Array;
  layoutWidth: number;
  radius: number;
  maxH: number;
  left: number; top: number; width: number; height: number;
  prevLeft: number; vx: number;
  clipEl: Element | null; clipL: number; clipR: number;
  visible: boolean; onScreen: boolean; occluded: boolean; alpha: number;
  peak: number;
  spillL: number; spillR: number;
  haze: number;
  splats: Splat[];
  litter: Litter[]; maxLitter: number; litterDirty: boolean;
  beads: Bead[]; drips: Drip[]; beadIn: number; wet: number;
}

interface Landing { s: Surface; col: number; y: number }

interface Ball {
  x: number; y: number; vx: number; vy: number; r: number; vol: number;
  held: boolean; flight: number; origin: Surface | null;
}

interface Pumpkin { at: number; size: number; phase: number }

/** Fantôme de brume : il sort du bas de l'écran, monte et se dissipe. */
interface Ghost { x: number; age: number; life: number; size: number; phase: number }

/** Chauve-souris qui traverse le haut de l'écran en ondulant. */
interface Bat { x: number; y: number; vx: number; size: number; phase: number; age: number }

export class AmbientEngine {
  private ctx: CanvasRenderingContext2D;
  private options: AmbientOptions;
  private sprites: Sprites;
  private W = 0;
  private H = 0;
  private dpr = 1;
  private raf = 0;
  private last = 0;
  private time = 0;
  private master = 0;
  private started = false;
  private fx = { snow: false, leaves: false, petals: false, rain: false, popcorn: false, halloween: false };
  /** Fondu de chaque effet : il entre et sort en douceur quand on le coche. */
  private presence: Record<Falling, number> = { snow: 1, leaves: 1, petals: 1, rain: 1, popcorn: 1, halloween: 1 };
  /** Part de chaque effet quand plusieurs tombent ensemble, pour ne pas saturer l'écran. */
  private share = 1;
  private settleCards = true;
  private settleGround = true;
  private densityRatio = 1;
  private flakes: Flake[] = [];
  private leaves: Flutter[] = [];
  private petals: Flutter[] = [];
  private candies: Flutter[] = [];
  private popcorn: Flutter[] = [];
  private drops: Drop[] = [];
  private grains: Grain[] = [];
  private ripples: Ripple[] = [];
  private glints: Array<{ s: Surface; col: number; life: number }> = [];
  /** Dessins du thème Halloween, absents tant que l'effet n'a jamais été coché. */
  private art: HalloweenArt | null = null;
  private artAsked = false;
  private pumpkins: Pumpkin[] = [];
  private ghosts: Ghost[] = [];
  private bats: Bat[] = [];
  private nextGhost = 3;
  private nextBat = 2;
  private rainVx = RAIN_SLANT;
  private surfaces = new Map<Element, Surface>();
  private active: Surface[] = [];
  private observed = new WeakSet<Element>();
  private ground: Surface;
  private io: IntersectionObserver;
  private scanTimer = 0;
  private header: Element | null = null;
  private clipTop = 0;
  private scrollX = 0;
  private occlusionCursor = 0;
  private light = false;
  private reduced = false;
  private reducedQuery: MediaQueryList | null = null;
  private quality = 1;
  private slowFor = 0;
  private fastFor = 0;
  private avgDt = 1 / 60;
  private scratch = new Float32Array(512);
  private tmp = new Float32Array(512);
  private capTmp = new Float32Array(512);
  private pointer = { x: -999, y: -999, vx: 0, vy: 0, active: false, touch: false, t: 0 };
  private history: Array<{ x: number; y: number; t: number }> = [];
  private ball: Ball | null = null;
  private suppressClick = false;
  private cursor = '';
  private frame = 0;

  constructor(private canvas: HTMLCanvasElement, options: AmbientOptions) {
    this.ctx = canvas.getContext('2d')!;
    this.options = options;
    this.sprites = buildSprites();
    this.ground = this.makeSurface(null, 0);
    this.io = new IntersectionObserver(this.onIntersect, { rootMargin: '80px 0px' });
    this.applyOptions();
    for (const effect of FALLING) this.presence[effect] = this.fx[effect] ? 1 : 0;
  }

  start(): void {
    this.reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reduced = this.reducedQuery.matches;
    this.reducedQuery.addEventListener('change', this.onReducedChange);
    this.resize();
    this.scan();
    this.scanTimer = window.setInterval(this.scan, 1200);
    window.addEventListener('resize', this.resize);
    window.addEventListener('pointermove', this.onPointerMove, { passive: true, capture: true });
    window.addEventListener('pointerdown', this.onPointerDown, { capture: true });
    window.addEventListener('pointerup', this.onPointerUp, { capture: true });
    window.addEventListener('pointercancel', this.onPointerUp, { capture: true });
    window.addEventListener('click', this.onClick, { capture: true });
    window.addEventListener('dragstart', this.onHeldGuard, { capture: true });
    window.addEventListener('selectstart', this.onHeldGuard, { capture: true });
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('pointerout', this.onPointerOut, { passive: true });
    window.addEventListener('touchstart', this.onTouchStart, { passive: true });
    window.addEventListener('touchmove', this.onTouchMove, { passive: true });
    window.addEventListener('touchend', this.onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', this.onTouchEnd, { passive: true });
    // Le ciel n'est pas vide au départ : tout est déjà réparti, puis apparaît en fondu.
    this.updateDensity();
    for (const effect of FALLING) if (this.fx[effect]) this.prefill(effect);
    this.started = true;
    this.raf = requestAnimationFrame(this.tick);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    window.clearInterval(this.scanTimer);
    this.io.disconnect();
    this.reducedQuery?.removeEventListener('change', this.onReducedChange);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('pointermove', this.onPointerMove, { capture: true });
    window.removeEventListener('pointerdown', this.onPointerDown, { capture: true });
    window.removeEventListener('pointerup', this.onPointerUp, { capture: true });
    window.removeEventListener('pointercancel', this.onPointerUp, { capture: true });
    window.removeEventListener('click', this.onClick, { capture: true });
    window.removeEventListener('dragstart', this.onHeldGuard, { capture: true });
    window.removeEventListener('selectstart', this.onHeldGuard, { capture: true });
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('pointerout', this.onPointerOut);
    window.removeEventListener('touchstart', this.onTouchStart);
    window.removeEventListener('touchmove', this.onTouchMove);
    window.removeEventListener('touchend', this.onTouchEnd);
    window.removeEventListener('touchcancel', this.onTouchEnd);
    this.setCursor('');
    this.surfaces.clear();
  }

  setOptions(options: AmbientOptions): void {
    const before = { ...this.fx };
    this.options = options;
    this.applyOptions();
    if (!this.started) return;
    // Un effet qu'on vient de cocher arrive déjà réparti sur l'écran, en fondu.
    for (const effect of FALLING) {
      if (!this.fx[effect] || before[effect]) continue;
      if (this.presence[effect] <= 0) this.prefill(effect);
    }
  }

  /** Balaie tout ce qui est posé : la neige part en poudre, feuilles, pétales et bonbons s'envolent. */
  clear(): void {
    for (const s of [...this.surfaces.values(), this.ground]) {
      const shown = s.onScreen || s.ground;
      if (shown) {
        this.burst(s);
        for (let i = s.litter.length - 1; i >= 0; i--) this.kick(s, i, rand(-120, 120), -rand(140, 320), rand(0.5, 0.9));
      }
      s.litter.length = 0;
      s.litterDirty = false;
      s.h.fill(0);
      s.lh.fill(0);
      s.lhShown.fill(0);
      s.peak = 0;
      s.splats.length = 0;
      s.beads.length = 0;
      s.drips.length = 0;
    }
    this.glints.length = 0;
  }

  private applyOptions(): void {
    const { effects, settle, opacity } = this.options;
    this.fx = {
      snow: effects.includes('snow'),
      leaves: effects.includes('leaves'),
      petals: effects.includes('petals'),
      rain: effects.includes('rain'),
      popcorn: effects.includes('popcorn'),
      halloween: effects.includes('halloween'),
    };
    const falling = FALLING.filter((effect) => this.fx[effect]).length;
    this.share = falling > 1 ? 1 / Math.sqrt(falling) : 1;
    this.settleCards = settle === 'all' || settle === 'cards';
    this.settleGround = settle === 'all' || settle === 'ground';
    this.canvas.style.opacity = String(clamp(opacity, 0.2, 1));
    if (!this.fx.halloween) return;
    if (this.pumpkins.length === 0 && this.W > 0) this.placePumpkins();
    if (this.artAsked) return;
    this.artAsked = true;
    // Sans ses dessins, l'effet Halloween ne montre rien : il attend, le reste tourne.
    import('./ambientHalloweenArt')
      .then((module) => module.loadHalloweenArt())
      .then((art) => { this.art = art; })
      .catch(() => { this.artAsked = false; });
  }

  // ---------------------------------------------------------------- Surfaces

  private makeSurface(el: Element | null, width: number): Surface {
    let radius = 0;
    let clipEl: Element | null = null;
    if (el) {
      radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
      // La rangée d'un carrousel coupe ses cards à gauche et à droite : les tas aussi.
      for (let p = el.parentElement, depth = 0; p && depth < 8; p = p.parentElement, depth++) {
        const overflow = getComputedStyle(p).overflowX;
        if (overflow !== 'visible') { clipEl = p; break; }
      }
    }
    const n = el ? columnCount(Math.max(width, 24)) : 8;
    return {
      el, ground: !el, n,
      h: new Float32Array(n), lh: new Float32Array(n), lhShown: new Float32Array(n),
      cap: new Float32Array(n), base: new Float32Array(n),
      layoutWidth: -1, radius, maxH: 0,
      left: 0, top: 0, width: 0, height: 0, prevLeft: NaN, vx: 0,
      clipEl, clipL: 0, clipR: 0,
      visible: !el, onScreen: !el, occluded: false, alpha: el ? 0 : 1,
      peak: 0, spillL: 0, spillR: 0, haze: Math.random() * HAZE_DROP, splats: [],
      litter: [], maxLitter: 0, litterDirty: false,
      beads: [], drips: [], beadIn: rand(0.2, 1.5), wet: 0,
    };
  }

  private shape(s: Surface, width: number): void {
    s.layoutWidth = width;
    s.maxH = s.ground ? clamp(this.H * 0.024, 12, 24) : clamp(width * 0.075, 5, 15);
    s.cap = capacityProfile(s.n, width, s.maxH, s.radius);
    s.maxLitter = s.ground ? clamp(Math.round(width / 3.6), 60, 520) : clamp(Math.round(width / 5), 10, 46);
    const colW = width / s.n;
    for (let i = 0; i < s.n; i++) s.base[i] = cornerDrop((i + 0.5) * colW, width, s.radius);
    if (s.litter.length > 0) s.litterDirty = true;
  }

  private onIntersect = (entries: IntersectionObserverEntry[]) => {
    for (const entry of entries) {
      let s = this.surfaces.get(entry.target);
      if (entry.isIntersecting) {
        if (!s) {
          s = this.makeSurface(entry.target, entry.boundingClientRect.width);
          this.surfaces.set(entry.target, s);
        }
        s.visible = true;
      } else if (s) {
        s.visible = false;
        s.onScreen = false;
        s.prevLeft = NaN;
        if (s.peak <= 0.05 && s.splats.length === 0 && s.litter.length === 0) this.surfaces.delete(entry.target);
      }
    }
  };

  private scan = () => {
    const nodes = document.querySelectorAll(SURFACE_SELECTOR);
    for (const el of nodes) {
      if (this.observed.has(el)) continue;
      this.observed.add(el);
      this.io.observe(el);
    }
    this.header = document.querySelector(HEADER_SELECTOR);
    this.light = document.documentElement.getAttribute('data-light-mode') === 'true';
  };

  private resize = () => {
    const W = document.documentElement.clientWidth || window.innerWidth;
    const H = window.innerHeight;
    const mobile = W < 768;
    this.dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2);
    this.W = W;
    this.H = H;
    this.canvas.width = Math.round(W * this.dpr);
    this.canvas.height = Math.round(H * this.dpr);
    this.canvas.style.width = `${W}px`;
    this.canvas.style.height = `${H}px`;
    const g = this.ground;
    const n = clamp(Math.round(W / 5), 8, 400);
    if (n !== g.n) {
      g.h = resample(g.h, n);
      g.lhShown = resample(g.lhShown, n);
      g.lh = new Float32Array(n);
      g.n = n;
      g.base = new Float32Array(n);
    }
    g.left = 0;
    g.top = H;
    g.width = W;
    g.clipL = 0;
    g.clipR = W;
    // Ce qui était posé au-delà du nouveau bord droit n'existe plus.
    for (let i = g.litter.length - 1; i >= 0; i--) if (g.litter[i].x > W) g.litter.splice(i, 1);
    g.litterDirty = true;
    this.shape(g, W);
    if (this.fx.halloween && this.pumpkins.length !== this.pumpkinCount()) this.placePumpkins();
  };

  /** Positions des surfaces visibles, lues une fois par image. */
  private layout(dt: number): void {
    const header = this.header?.isConnected ? this.header.getBoundingClientRect() : null;
    this.clipTop = header && header.height > 0 ? clamp(header.bottom, 0, this.H) : 0;
    const scrollX = window.scrollX;
    const scrollDx = scrollX - this.scrollX;
    this.scrollX = scrollX;
    const clips = new Map<Element, DOMRect>();
    this.active.length = 0;
    for (const [el, s] of this.surfaces) {
      if (!el.isConnected) {
        // Card retirée (changement de page, rangée rechargée) : ce qu'elle portait tombe d'un bloc.
        if (s.onScreen && (s.peak > 0.3 || s.litter.length > 0)) this.dropAll(s);
        this.surfaces.delete(el);
        this.io.unobserve(el);
        this.observed.delete(el);
        continue;
      }
      if (!s.visible) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) { s.onScreen = false; continue; }
      if (Math.abs(r.width - s.layoutWidth) > 0.5) this.shape(s, r.width);
      // Vitesse propre de la card (glissement du carrousel), sans le défilement de la page.
      const dx = Number.isNaN(s.prevLeft) ? 0 : r.left - s.prevLeft + scrollDx;
      // Un saut de mise en page n'est pas un mouvement : rien ne tombe pour autant.
      const inst = Math.abs(dx) > 80 ? 0 : dx / Math.max(dt, 1e-3);
      s.vx = s.vx * 0.6 + inst * 0.4;
      s.prevLeft = r.left;
      s.left = r.left;
      s.top = r.top;
      s.width = r.width;
      s.height = r.height;
      let clipL = r.left;
      let clipR = r.right;
      if (s.clipEl) {
        let c = clips.get(s.clipEl);
        if (!c) { c = s.clipEl.getBoundingClientRect(); clips.set(s.clipEl, c); }
        clipL = Math.max(clipL, c.left);
        clipR = Math.min(clipR, c.right);
      }
      s.clipL = Math.max(0, clipL);
      s.clipR = Math.min(this.W, clipR);
      s.onScreen = s.clipR - s.clipL > 1 && r.top - s.maxH * 2 < this.H && r.bottom + 8 > this.clipTop;
      if (s.onScreen) this.active.push(s);
    }
    this.checkOcclusion();
    for (const s of this.active) {
      const target = s.occluded ? 0 : 1;
      s.alpha += (target - s.alpha) * Math.min(1, dt * 10);
    }
  }

  /**
   * Une fenêtre, un menu ou le header peut passer devant une card : on teste
   * quelques cards par image, en trois points de leur bord haut. Un seul point
   * couvert suffit à cacher le tas, pour ne jamais dessiner par-dessus une fenêtre.
   */
  private checkOcclusion(): void {
    const list = this.active;
    if (list.length === 0) return;
    const count = Math.min(list.length, 4);
    for (let k = 0; k < count; k++) {
      const s = list[(this.occlusionCursor + k) % list.length];
      const y = Math.max(s.top + 6, this.clipTop + 2);
      if (y > s.top + s.height || y >= this.H) { s.occluded = true; continue; }
      let occluded = false;
      for (const f of [0.12, 0.5, 0.88]) {
        const x = clamp(s.left + s.width * f, s.clipL + 2, s.clipR - 2);
        const hit = document.elementFromPoint(x, y);
        if (hit && hit !== document.documentElement && hit !== document.body
          && !s.el!.contains(hit) && !hit.contains(s.el!)) { occluded = true; break; }
      }
      s.occluded = occluded;
    }
    this.occlusionCursor = (this.occlusionCursor + count) % list.length;
  }

  // ------------------------------------------------------------------ Boucle

  private tick = (now: number) => {
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    this.step(dt);
    this.draw();
    this.raf = requestAnimationFrame(this.tick);
  };

  private step(dt: number): void {
    this.time += dt;
    this.frame++;
    this.master = Math.min(1, this.master + dt / 0.8);
    this.govern(dt);
    this.updateDensity();
    this.updatePresence(dt);
    this.layout(dt);
    const wind = this.wind();
    this.updateFlakes(dt, wind);
    this.updateFlutters(this.leaves, this.fx.leaves ? this.count(DENSITY.leaves, 4, 70) : 0, this.spawnLeaf, dt, wind * FLUTTER_WIND);
    this.updateFlutters(this.petals, this.fx.petals ? this.count(DENSITY.petals, 6, 120) : 0, this.spawnPetal, dt, wind * FLUTTER_WIND);
    this.updateFlutters(this.candies, this.fx.halloween && this.art ? this.count(DENSITY.candies, 4, 60) : 0, this.spawnCandy, dt, wind * CANDY_WIND);
    this.updateFlutters(this.popcorn, this.fx.popcorn ? this.count(DENSITY.popcorn, 6, 100) : 0, this.spawnPopcorn, dt, wind * POPCORN_WIND);
    this.updateRain(dt, wind);
    this.updatePointer(dt);
    this.updateBall(dt);
    this.updateGrains(dt);
    this.updateSurfaces(dt);
    this.updateRipples(dt);
    this.updateHalloween(dt);
    if (this.frame % 6 === 0) this.updateCursor();
  }

  /** Si les images ralentissent, moins d'éléments ; ils reviennent quand tout va mieux. */
  private govern(dt: number): void {
    this.avgDt = this.avgDt * 0.95 + dt * 0.05;
    if (this.avgDt > 1 / 40) { this.slowFor += dt; this.fastFor = 0; } else if (this.avgDt < 1 / 55) { this.fastFor += dt; this.slowFor = 0; }
    if (this.slowFor > 2) { this.quality = Math.max(0.4, this.quality * 0.8); this.slowFor = 0; }
    if (this.fastFor > 5) { this.quality = Math.min(1, this.quality * 1.1); this.fastFor = 0; }
  }

  private updateDensity(): void {
    const { intensity } = this.options;
    // « Variable » monte et retombe sur quelques minutes, jamais tout à fait à zéro.
    this.densityRatio = intensity === 'variable'
      ? Math.max(0.1, 0.85 + 0.75 * Math.sin(this.time / 38) * Math.sin(this.time / 97 + 1.3))
      : INTENSITY[intensity];
  }

  private updatePresence(dt: number): void {
    for (const effect of FALLING) {
      const target = this.fx[effect] ? 1 : 0;
      const p = this.presence[effect];
      if (p === target) continue;
      const next = clamp(p + (target > p ? dt : -dt) / 0.9, 0, 1);
      this.presence[effect] = next;
      if (next > 0) continue;
      if (effect === 'snow') this.flakes.length = 0;
      else if (effect === 'leaves') this.leaves.length = 0;
      else if (effect === 'petals') this.petals.length = 0;
      else if (effect === 'rain') this.drops.length = 0;
      else if (effect === 'popcorn') this.popcorn.length = 0;
      else {
        this.candies.length = 0;
        this.ghosts.length = 0;
        this.bats.length = 0;
      }
    }
  }

  /** Nombre d'éléments à l'écran pour une densité de base, bornée avant la mise à l'échelle. */
  private count(base: number, min: number, max: number): number {
    // Un téléphone n'a qu'un sixième de la surface d'un écran de bureau : sans plancher, il ne tomberait presque rien.
    const area = Math.max(0.35, (this.W * this.H) / 2_073_600);
    const mobile = this.W < 768 ? 0.75 : 1;
    const reduced = this.reduced ? 0.4 : 1;
    return Math.round(clamp(base * this.densityRatio, min, max) * area * mobile * reduced * this.quality * this.share);
  }

  private wind(): number {
    const t = this.time;
    return 14 * Math.sin(t * 0.11) + 7 * Math.sin(t * 0.37 + 1.3);
  }

  /** Remplit l'écran d'un effet d'un coup, réparti sur toute la hauteur. */
  private prefill(effect: Falling): void {
    const y = () => rand(-40, this.H);
    if (effect === 'snow') {
      for (let i = this.flakes.length, n = this.count(DENSITY.snow, 15, 400); i < n; i++) this.flakes.push(this.spawnFlake(y()));
    } else if (effect === 'leaves') {
      for (let i = this.leaves.length, n = this.count(DENSITY.leaves, 4, 70); i < n; i++) this.leaves.push(this.spawnLeaf(y()));
    } else if (effect === 'petals') {
      for (let i = this.petals.length, n = this.count(DENSITY.petals, 6, 120); i < n; i++) this.petals.push(this.spawnPetal(y()));
    } else if (effect === 'rain') {
      for (let i = this.drops.length, n = this.count(DENSITY.rain, 20, 420); i < n; i++) this.drops.push(this.spawnDrop(y()));
    } else if (effect === 'popcorn') {
      for (let i = this.popcorn.length, n = this.count(DENSITY.popcorn, 6, 100); i < n; i++) this.popcorn.push(this.spawnPopcorn(y()));
    } else if (this.art) {
      for (let i = this.candies.length, n = this.count(DENSITY.candies, 4, 60); i < n; i++) this.candies.push(this.spawnCandy(y()));
    }
    if (this.started) this.presence[effect] = 0;
  }

  // -------------------------------------------------------------------- Neige

  private spawnFlake(y: number): Flake {
    const pick = Math.random();
    const layer = pick < LAYERS[0].weight ? 0 : pick < LAYERS[0].weight + LAYERS[1].weight ? 1 : 2;
    const L = LAYERS[layer];
    return {
      x: rand(-20, this.W + 20), y, prevY: y,
      r: rand(L.r[0], L.r[1]), vy: rand(L.vy[0], L.vy[1]), layer,
      phase: rand(0, TAU), freq: rand(0.6, 1.6), amp: rand(6, 22),
    };
  }

  private updateFlakes(dt: number, wind: number): void {
    const flakes = this.flakes;
    const target = this.fx.snow ? this.count(DENSITY.snow, 15, 400) : 0;
    if (flakes.length === 0 && target === 0) return;
    const speed = this.reduced ? 0.6 : 1;
    for (let i = flakes.length - 1; i >= 0; i--) {
      const f = flakes[i];
      f.prevY = f.y;
      f.y += f.vy * speed * dt;
      f.x += (wind * LAYERS[f.layer].wind + Math.sin(f.phase + this.time * f.freq) * f.amp) * speed * dt;
      if (f.x < -30) f.x += this.W + 60;
      else if (f.x > this.W + 30) f.x -= this.W + 60;
      let gone = f.y > this.H + 10;
      if (!gone && f.layer > 0) {
        const hit = this.findLanding(f.x, f.prevY, f.y, null);
        if (hit && (hit.s.ground || Math.random() < LANDING_CHANCE)) {
          this.land(hit, f.x, Math.PI * f.r * f.r * DEPOSIT_GAIN, 2.2);
          gone = true;
        }
      }
      if (gone) {
        if (flakes.length > target) {
          flakes[i] = flakes[flakes.length - 1];
          flakes.pop();
        } else {
          flakes[i] = this.spawnFlake(rand(-30, -4));
        }
      }
    }
    // Monte en douceur vers la cible au lieu d'une averse d'un coup.
    const missing = target - flakes.length;
    if (missing > 0) {
      const add = Math.min(missing, Math.max(1, Math.ceil(target * dt * 0.6)));
      for (let k = 0; k < add; k++) flakes.push(this.spawnFlake(rand(-30, -4)));
    }
  }

  /**
   * Premier tas croisé entre `y0` et `y1` à l'abscisse `x`, sinon le sol, sinon
   * rien. `anyGround` : la pluie éclabousse le bas de l'écran même quand rien ne s'y pose.
   */
  private findLanding(x: number, y0: number, y1: number, skip: Surface | null, cardsOff = false, anyGround = false): Landing | null {
    if (this.settleCards && !cardsOff) {
      let best: Landing | null = null;
      for (const s of this.active) {
        if (s === skip || s.occluded || s.alpha < 0.5) continue;
        if (x < s.clipL || x >= s.clipR) continue;
        const colW = s.width / s.n;
        const col = Math.min(s.n - 1, Math.max(0, Math.floor((x - s.left) / colW)));
        const y = s.top + s.base[col] - s.h[col] - s.lh[col];
        if (y < this.clipTop || y0 > y || y1 < y) continue;
        if (!best || y < best.y) best = { s, col, y };
      }
      if (best) return best;
    }
    if (!this.settleGround && !anyGround) return null;
    const g = this.ground;
    if (skip === g || x < 0 || x >= this.W) return null;
    const col = Math.min(g.n - 1, Math.max(0, Math.floor(x / (this.W / g.n))));
    const y = this.H - g.h[col] - g.lh[col];
    return y1 >= y ? { s: g, col, y } : null;
  }

  private land(hit: Landing, x: number, volume: number, spread: number): void {
    const s = hit.s;
    const colW = s.width / s.n;
    deposit(s.h, (x - s.left) / colW - 0.5, volume, colW, spread);
  }

  // ---------------------------------------------- Feuilles, pétales, bonbons

  private spawnLeaf = (y: number): Flutter => {
    const size = rand(8, 15) * (this.W < 768 ? 0.85 : 1);
    return {
      kind: FlutterKind.Leaf, variant: Math.floor(Math.random() * LEAF_SHAPES * LEAF_COLORS),
      x: rand(-20, this.W + 20), y, prevY: y, size, vy: rand(48, 82) * (0.7 + size / 30),
      phase: rand(0, TAU), freq: rand(1.1, 2.1), amp: rand(38, 85),
      rot: rand(0, TAU), spin: rand(-0.5, 0.5), flip: rand(0, TAU), flipSpeed: rand(1.2, 3.2),
      kx: 0, ky: 0, fade: -1, dry: 0, loose: false,
    };
  };

  private spawnPetal = (y: number): Flutter => {
    // De temps en temps, une fleur entière descend en tournant sur sa tige.
    const flower = Math.random() < 0.035;
    return {
      kind: flower ? FlutterKind.Flower : FlutterKind.Petal,
      variant: flower ? 0 : Math.floor(Math.random() * PETAL_TINTS),
      x: rand(-20, this.W + 20), y, prevY: y,
      size: flower ? rand(8, 11) : rand(3.6, 6.4), vy: flower ? rand(62, 88) : rand(34, 60),
      phase: rand(0, TAU), freq: rand(0.9, 1.9), amp: flower ? rand(10, 22) : rand(24, 58),
      rot: rand(0, TAU), spin: flower ? rand(1.6, 3) * (Math.random() < 0.5 ? -1 : 1) : rand(-0.9, 0.9),
      flip: rand(0, TAU), flipSpeed: flower ? rand(0.5, 1) : rand(2, 4.6),
      kx: 0, ky: 0, fade: -1, dry: 0, loose: false,
    };
  };

  /** Neige de bonbons : chute lente, léger balancement, chacun tourne à son rythme. */
  private spawnCandy = (y: number): Flutter => {
    const kinds = this.art ? this.art.candies.length : 1;
    return {
      kind: FlutterKind.Candy, variant: Math.floor(Math.random() * kinds),
      x: rand(-20, this.W + 20), y, prevY: y, size: rand(9.5, 14) * (this.W < 768 ? 0.85 : 1), vy: rand(52, 92),
      phase: rand(0, TAU), freq: rand(0.7, 1.5), amp: rand(10, 28),
      rot: rand(0, TAU), spin: rand(0.5, 1.7) * (Math.random() < 0.5 ? -1 : 1), flip: 0, flipSpeed: 0,
      kx: 0, ky: 0, fade: -1, dry: 0, loose: false,
    };
  };

  /** Pop-corn : léger, il culbute vite et dérive un peu plus qu'un bonbon. */
  private spawnPopcorn = (y: number): Flutter => ({
    kind: FlutterKind.Popcorn, variant: Math.floor(Math.random() * POPCORN_SHAPES),
    x: rand(-20, this.W + 20), y, prevY: y, size: rand(6, 9.5) * (this.W < 768 ? 0.9 : 1), vy: rand(58, 104),
    phase: rand(0, TAU), freq: rand(0.8, 1.7), amp: rand(8, 24),
    rot: rand(0, TAU), spin: rand(1.4, 3.8) * (Math.random() < 0.5 ? -1 : 1), flip: 0, flipSpeed: 0,
    kx: 0, ky: 0, fade: -1, dry: 0, loose: false,
  });

  private updateFlutters(list: Flutter[], target: number, spawn: (y: number) => Flutter, dt: number, wind: number): void {
    if (list.length === 0 && target === 0) return;
    const speed = this.reduced ? 0.6 : 1;
    const damp = Math.exp(-dt * 2.6);
    for (let i = list.length - 1; i >= 0; i--) {
      const f = list[i];
      // Balancement de pendule : la feuille ralentit sa chute au bout de chaque aller.
      const swing = Math.cos(f.phase + this.time * f.freq);
      f.prevY = f.y;
      f.x += ((wind + swing * f.amp) * speed + f.kx) * dt;
      f.y += (f.vy * (0.72 + 0.28 * Math.abs(swing)) * speed + f.ky) * dt;
      f.kx *= damp;
      f.ky *= damp;
      f.rot += f.spin * dt;
      f.flip += f.flipSpeed * dt;
      if (f.x < -40) f.x += this.W + 80;
      else if (f.x > this.W + 40) f.x -= this.W + 80;
      let gone = f.y > this.H + 24;
      if (f.fade >= 0) {
        f.fade -= dt;
        if (f.fade <= 0) gone = true;
      } else if (!gone && f.y > f.prevY) {
        const hit = this.findLanding(f.x, f.prevY, f.y, null);
        // Le sol répond à chaque image une fois atteint : on n'y pose la feuille qu'au passage.
        if (hit && f.prevY <= hit.y && this.settle(hit, f)) gone = true;
      }
      if (!gone) continue;
      if (list.length > target || f.fade >= 0 || f.loose) {
        list[i] = list[list.length - 1];
        list.pop();
      } else {
        list[i] = spawn(rand(-40, -10));
      }
    }
    const missing = target - list.length;
    if (missing > 0) {
      const add = Math.min(missing, Math.max(1, Math.ceil(target * dt * 0.6)));
      for (let k = 0; k < add; k++) list.push(spawn(rand(-40, -10)));
    }
  }

  /** Angle et écrasement d'une feuille en vol à cet instant. */
  private pose(f: Flutter): { rot: number; flipY: number; glint: number } {
    if (isSolid(f.kind)) return { rot: f.rot, flipY: 1, glint: 0 };
    const c = Math.abs(Math.cos(f.flip));
    if (f.kind === FlutterKind.Flower) return { rot: f.rot, flipY: 0.78 + 0.22 * c, glint: 0 };
    const sway = Math.sin(f.phase + this.time * f.freq);
    if (f.kind === FlutterKind.Leaf) return { rot: f.rot + sway * 0.65, flipY: Math.max(0.14, c), glint: 0 };
    // Un pétale accroche la lumière un instant en se retournant.
    return { rot: f.rot + sway * 0.5, flipY: Math.max(0.14, c), glint: Math.max(0, 1 - Math.abs(c - 0.35) / 0.2) * 0.55 };
  }

  /** Pose une feuille ou un pétale sur le tas touché ; faux s'il n'y a pas de place. */
  private settle(hit: Landing, f: Flutter): boolean {
    const s = hit.s;
    if (!s.ground && Math.random() > LANDING_CHANCE) return false;
    if (s.h[hit.col] + s.lh[hit.col] >= s.cap[hit.col]) return false;
    if (s.litter.length >= s.maxLitter) {
      // Tas complet : la plus ancienne s'efface pour laisser la place.
      for (const it of s.litter) {
        if (it.expiring) continue;
        it.expiring = true;
        it.age = Math.max(it.age, it.life - LITTER_FADE);
        break;
      }
      if (s.litter.length >= s.maxLitter * 1.15) return false;
    }
    const colW = s.width / s.n;
    const leaf = f.kind === FlutterKind.Leaf;
    const solid = isSolid(f.kind);
    const vol = leaf ? LEAF_VOLUME * (f.size / 12) ** 2
      : f.kind === FlutterKind.Candy ? CANDY_VOLUME * (f.size / 12) ** 2
        : f.kind === FlutterKind.Popcorn ? POPCORN_VOLUME * (f.size / 8) ** 2
          : f.kind === FlutterKind.Flower ? FLOWER_VOLUME : PETAL_VOLUME * (f.size / 5) ** 2;
    const x = f.x - s.left;
    deposit(s.lh, x / colW - 0.5, vol, colW, litterSpread(f.size, colW));
    const pose = this.pose(f);
    const life = leaf || solid ? rand(45, 80) : rand(35, 60);
    s.litter.push({
      kind: f.kind, variant: f.variant, x, depth: rand(0.3, 1), rot: pose.rot, size: f.size,
      // Une feuille se couche à plat ; un bonbon ou un pop-corn reste comme il est tombé.
      squash: solid ? 1 : rand(0.45, 0.9), from: pose.flipY, t: 0,
      // Une feuille déjà sèche le reste.
      age: f.dry > 0 ? life * (0.35 + 0.45 * f.dry) : 0, life, vol, expiring: false,
    });
    return true;
  }

  private litterY(s: Surface, it: Litter, col: number): number {
    return s.top + s.base[col] - s.h[col] - s.lhShown[col] * it.depth - it.size * 0.3 * it.squash;
  }

  /** 0 = frais, 1 = sec. Bonbons et pop-corn ne se fanent pas : ils s'effacent seulement en fin de vie. */
  private litterDry(it: Litter): number {
    return isSolid(it.kind) ? 0 : smoothstep(0.35, 0.8, it.age / it.life);
  }

  /** L'effet auquel appartient ce qui est posé est-il encore coché ? */
  private litterOn(kind: FlutterKind): boolean {
    if (kind === FlutterKind.Leaf) return this.fx.leaves;
    if (kind === FlutterKind.Candy) return this.fx.halloween;
    if (kind === FlutterKind.Popcorn) return this.fx.popcorn;
    return this.fx.petals;
  }

  /** Liste des éléments en vol d'une sorte donnée. */
  private flyers(kind: FlutterKind): Flutter[] {
    if (kind === FlutterKind.Leaf) return this.leaves;
    if (kind === FlutterKind.Candy) return this.candies;
    if (kind === FlutterKind.Popcorn) return this.popcorn;
    return this.petals;
  }

  /** Une feuille posée s'envole avec l'élan donné ; `fade` ≥ 0 : elle s'efface en vol. */
  private kick(s: Surface, index: number, vx: number, vy: number, fade = -1): void {
    const it = s.litter[index];
    const colW = s.width / s.n;
    const col = clamp(Math.floor(it.x / colW), 0, s.n - 1);
    const y = this.litterY(s, it, col) - 2;
    s.litter.splice(index, 1);
    s.litterDirty = true;
    const leaf = it.kind === FlutterKind.Leaf;
    const solid = isSolid(it.kind);
    const list = this.flyers(it.kind);
    if (list.length >= MAX_FLUTTERS) return;
    const calm = this.reduced ? 0.4 : 1;
    list.push({
      kind: it.kind, variant: it.variant, x: s.left + it.x, y, prevY: y, size: it.size,
      vy: leaf ? rand(48, 82) : solid ? rand(55, 98) : rand(34, 60),
      phase: rand(0, TAU), freq: leaf ? rand(1.1, 2.1) : rand(0.9, 1.9),
      amp: leaf ? rand(38, 85) : solid ? rand(10, 26) : rand(24, 58),
      rot: it.rot, spin: rand(-2.5, 2.5), flip: rand(0, TAU), flipSpeed: leaf ? rand(2, 4.5) : rand(2.5, 5),
      kx: vx * calm, ky: vy * calm, fade, dry: this.litterDry(it), loose: true,
    });
  }

  /** Feuilles et pétales sous le curseur : chassés de côté et vers le haut. */
  private scatterLitter(s: Surface, x: number, y: number, r: number, vx: number, vy: number): void {
    if (s.litter.length === 0 || s.occluded) return;
    const colW = s.width / s.n;
    const push = 70 + Math.min(Math.hypot(vx, vy), 900) * 0.3;
    for (let i = s.litter.length - 1; i >= 0; i--) {
      const it = s.litter[i];
      const dx = s.left + it.x - x;
      if (Math.abs(dx) > r + it.size) continue;
      const dy = this.litterY(s, it, clamp(Math.floor(it.x / colW), 0, s.n - 1)) - y;
      const reach = r + it.size * 0.5;
      const d2 = dx * dx + dy * dy;
      if (d2 > reach * reach) continue;
      const d = Math.sqrt(d2) || 1;
      let ky = (dy / d) * push * 0.5 + Math.min(vy, 0) * 0.3 - rand(60, 150);
      // En bas de l'écran il n'y a rien dessous : poussée vers le bas, elle disparaîtrait.
      if (s.ground) ky = Math.min(ky, -50);
      this.kick(s, i, (dx / d) * push + vx * 0.3 + rand(-30, 30), ky);
    }
  }

  /** La hauteur du tas de feuilles est toujours la somme de celles qui s'y trouvent. */
  private rebuildLitter(s: Surface): void {
    s.litterDirty = false;
    s.lh.fill(0);
    if (s.litter.length === 0 || s.layoutWidth <= 0) return;
    const colW = s.layoutWidth / s.n;
    for (const it of s.litter) deposit(s.lh, it.x / colW - 0.5, it.vol, colW, litterSpread(it.size, colW));
  }

  private ageLitter(s: Surface, dt: number): void {
    const list = s.litter;
    const allowed = s.ground ? this.settleGround : this.settleCards;
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      if (it.t < 1) it.t = Math.min(1, it.t + dt * 3.5);
      // Un effet qu'on vient de couper ne laisse pas ses tas : ils se fanent vite.
      const on = allowed && this.litterOn(it.kind);
      const rate = !on ? 14 : this.options.fade || it.expiring ? 1 : 0;
      if (rate === 0) continue;
      it.age += dt * rate;
      if (it.age >= it.life) {
        list.splice(i, 1);
        s.litterDirty = true;
      }
    }
  }

  // -------------------------------------------------------------------- Pluie

  private spawnDrop(y: number): Drop {
    const pick = Math.random();
    const layer = pick < RAIN_LAYERS[0].weight ? 0 : pick < RAIN_LAYERS[0].weight + RAIN_LAYERS[1].weight ? 1 : 2;
    const L = RAIN_LAYERS[layer];
    return { x: rand(-60, this.W + 60), y, prevY: y, vy: rand(L.vy[0], L.vy[1]), len: rand(L.len[0], L.len[1]), layer };
  }

  private updateRain(dt: number, wind: number): void {
    const drops = this.drops;
    const target = this.fx.rain ? this.count(DENSITY.rain, 20, 420) : 0;
    if (drops.length === 0 && target === 0) return;
    const speed = this.reduced ? 0.6 : 1;
    const vx = RAIN_SLANT + wind * 5;
    this.rainVx = vx;
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.prevY = d.y;
      d.y += d.vy * speed * dt;
      d.x += vx * RAIN_LAYERS[d.layer].wind * speed * dt;
      if (d.x < -70) d.x += this.W + 140;
      else if (d.x > this.W + 70) d.x -= this.W + 140;
      let gone = d.y - d.len > this.H;
      if (!gone && d.layer > 0) {
        const hit = this.findLanding(d.x, d.prevY, d.y, null, false, true);
        if (hit && (hit.s.ground || Math.random() < LANDING_CHANCE)) {
          this.splash(d.x, hit.y, d.layer === 2);
          gone = true;
        }
      }
      if (gone) {
        if (drops.length > target) {
          drops[i] = drops[drops.length - 1];
          drops.pop();
        } else {
          drops[i] = this.spawnDrop(rand(-80, -10));
        }
      }
    }
    const missing = target - drops.length;
    if (missing > 0) {
      const add = Math.min(missing, Math.max(2, Math.ceil(target * dt * 2)));
      for (let k = 0; k < add; k++) drops.push(this.spawnDrop(rand(-80, -10)));
    }
  }

  /** Une goutte s'écrase : un rond qui s'élargit et quelques gouttelettes qui sautent. */
  private splash(x: number, y: number, big: boolean): void {
    if (this.ripples.length < MAX_RIPPLES) {
      this.ripples.push({ x, y, age: 0, life: rand(0.25, 0.4), w: big ? rand(7, 11) : rand(4, 7) });
    }
    if (this.reduced || this.grains.length > MAX_GRAINS - 120) return;
    const count = big ? 3 : Math.random() < 0.6 ? 2 : 1;
    for (let k = 0; k < count; k++) {
      this.addGrain({
        x, y: y - 1, vx: rand(-70, 70), vy: -rand(60, big ? 190 : 130),
        r: rand(0.5, 0.9), vol: 0, kind: GrainKind.Powder, life: rand(0.2, 0.4), skip: null, water: true,
      });
    }
  }

  private updateRipples(dt: number): void {
    const ripples = this.ripples;
    for (let i = ripples.length - 1; i >= 0; i--) {
      ripples[i].age += dt;
      if (ripples[i].age >= ripples[i].life) {
        ripples[i] = ripples[ripples.length - 1];
        ripples.pop();
      }
    }
  }

  /** Gouttes qui coulent sur l'affiche et pendent sous son bord. */
  private updateBeads(s: Surface, dt: number): void {
    const raining = this.fx.rain && this.settleCards && !s.occluded;
    if (!raining && s.wet <= 0 && s.beads.length === 0 && s.drips.length === 0) return;
    s.wet = clamp(s.wet + (raining ? dt / 2.5 : -dt / 5), 0, 1);
    if (raining && !this.reduced && s.height > 40) {
      s.beadIn -= dt * this.densityRatio * clamp(s.width / 180, 0.5, 2);
      if (s.beadIn <= 0) {
        s.beadIn = rand(0.5, 1.6);
        if (s.beads.length < (this.W < 768 ? 3 : 5)) {
          const y = rand(6, s.height * 0.5);
          s.beads.push({
            x: rand(8, Math.max(9, s.width - 8)), y, r: rand(1.3, 2.4), v: 0, target: rand(50, 150),
            wait: rand(0.3, 2.4), run: rand(18, 90), tail: y, phase: rand(0, TAU),
          });
        }
      }
    }
    for (let i = s.beads.length - 1; i >= 0; i--) {
      const b = s.beads[i];
      if (b.wait > 0) {
        // À l'arrêt, la traînée sèche et remonte vers la goutte.
        b.wait -= dt;
        b.tail += (b.y - b.tail) * Math.min(1, dt * 0.9);
      } else {
        b.v += (b.target - b.v) * Math.min(1, dt * 7);
        const dy = b.v * dt;
        b.y += dy;
        b.run -= dy;
        b.x = clamp(b.x + Math.sin(b.phase + b.y * 0.11) * 7 * dt, 3, Math.max(3, s.width - 3));
        b.tail = Math.max(b.tail + (b.y - b.tail) * Math.min(1, dt * 0.6), b.y - 26);
        if (b.run <= 0) {
          b.wait = rand(0.4, 2.2);
          b.run = rand(18, 90);
          b.v = 0;
          b.target = rand(50, 150);
        }
      }
      if (b.y < s.height - 1.5) continue;
      if (s.drips.length < 5) s.drips.push({ x: b.x, r: b.r * 0.55, max: rand(2.3, 3.3), rate: rand(0.7, 2) });
      s.beads.splice(i, 1);
    }
    for (let i = s.drips.length - 1; i >= 0; i--) {
      const d = s.drips[i];
      d.r += d.rate * dt;
      if (d.r < d.max) continue;
      // Assez lourde : elle se détache et éclaboussera plus bas.
      this.addGrain({
        x: s.left + d.x, y: s.top + s.height + d.r, vx: s.vx * 0.2, vy: 20,
        r: d.r * 0.8, vol: 0, kind: GrainKind.Drop, skip: s, water: true,
      });
      s.drips.splice(i, 1);
    }
  }

  // ------------------------------------------------------------------ Grains

  private addGrain(g: Omit<Grain, 'prevY' | 'life' | 'maxLife' | 'skipFor' | 'cardsOff' | 'water'> & {
    life?: number; skipFor?: number; cardsOff?: number; water?: boolean;
  }): void {
    if (this.grains.length >= MAX_GRAINS) return;
    const life = g.life ?? 0;
    this.grains.push({
      ...g, prevY: g.y, life, maxLife: life, skipFor: g.skipFor ?? 0.25, cardsOff: g.cardsOff ?? 0, water: g.water ?? false,
    });
  }

  private powder(x: number, y: number, count: number, spread: number, upward: number): void {
    for (let k = 0; k < count; k++) {
      const life = rand(0.35, 0.8);
      this.addGrain({
        x: x + rand(-2, 2), y: y + rand(-1, 1), vx: rand(-spread, spread), vy: -rand(upward * 0.3, upward),
        r: rand(0.5, 1.1), vol: 0, kind: GrainKind.Powder, life, skip: null,
      });
    }
  }

  private updateGrains(dt: number): void {
    const grains = this.grains;
    for (let i = grains.length - 1; i >= 0; i--) {
      const g = grains[i];
      let dead = false;
      if (g.kind === GrainKind.Powder) {
        // La poudre de neige flotte ; une gouttelette retombe franchement.
        const float = g.water ? 1 : 0.3;
        const drag = g.water ? 0.6 : 2.5;
        g.vy += GRAVITY * float * dt;
        g.vx *= 1 - drag * dt;
        g.vy *= 1 - drag * dt;
        g.x += g.vx * dt;
        g.y += g.vy * dt;
        g.life -= dt;
        dead = g.life <= 0;
      } else {
        g.vy += GRAVITY * dt;
        g.vx *= 1 - 1.2 * dt;
        g.vy *= 1 - 0.4 * dt;
        g.prevY = g.y;
        g.x += g.vx * dt;
        g.y += g.vy * dt;
        g.skipFor -= dt;
        g.cardsOff -= dt;
        if (g.vy > 0) {
          const drop = g.kind === GrainKind.Drop;
          const hit = this.findLanding(g.x, g.prevY, g.y, g.skipFor > 0 ? g.skip : null, g.cardsOff > 0, drop);
          if (hit) {
            if (drop) {
              this.splash(g.x, hit.y, true);
            } else {
              const colW = hit.s.width / hit.s.n;
              this.land(hit, g.x, g.vol, g.kind === GrainKind.Lump ? Math.max(1.8, (g.r * 1.5) / colW) : 1);
              // Un bloc éclate en poudre en touchant le sol ou un tas.
              if (g.kind === GrainKind.Lump) this.powder(g.x, hit.y, 4 + Math.round(g.r), 70, 110);
            }
            dead = true;
          }
        }
        if (g.y > this.H + 20 || g.x < -60 || g.x > this.W + 60) dead = true;
      }
      if (dead) {
        grains[i] = grains[grains.length - 1];
        grains.pop();
      }
    }
  }

  /** Tout ce que portait une surface tombe : la neige en blocs, les feuilles en vrac (card retirée de la page). */
  private dropAll(s: Surface): void {
    for (let i = s.litter.length - 1; i >= 0; i--) this.kick(s, i, rand(-40, 40), rand(-60, 10));
    const colW = s.width / s.n;
    const minChunk = Math.max(2, Math.ceil(s.n / 30));
    // Des blocs de tailles inégales, qui ne partent pas tous à la même hauteur.
    for (let i = 0; i < s.n;) {
      const chunk = minChunk + Math.floor(Math.random() * minChunk * 2);
      let vol = 0;
      let peak = 0;
      for (let j = i; j < Math.min(s.n, i + chunk); j++) { vol += s.h[j] * colW; peak = Math.max(peak, s.h[j]); }
      const x = s.left + (i + chunk / 2) * colW;
      const col = Math.min(s.n - 1, i);
      i += chunk;
      if (vol < 0.6) continue;
      this.addGrain({
        x, y: s.top + s.base[col] - peak * rand(0.2, 0.9), vx: rand(-40, 40), vy: rand(-30, 60),
        r: clamp(Math.sqrt(vol / Math.PI) * rand(0.8, 1.1), 1.4, 5), vol, kind: GrainKind.Lump, skip: s,
        // La page change souvent d'un coup : les blocs tombent un peu avant de pouvoir se poser.
        cardsOff: 0.22,
      });
    }
    s.h.fill(0);
    s.peak = 0;
  }

  /** Poudre sans dépôt : « Tout balayer » dans les réglages. */
  private burst(s: Surface): void {
    const colW = s.width / s.n;
    const step = Math.max(1, Math.round(6 / colW));
    for (let i = 0; i < s.n; i += step) {
      if (s.h[i] < 0.4) continue;
      const y = s.ground ? this.H - s.h[i] : s.top + s.base[i] - s.h[i];
      if (!s.ground && y < this.clipTop) continue;
      this.powder(s.left + (i + 0.5) * colW, y, 1 + Math.round(s.h[i] / 4), 50, 220);
    }
  }

  // ---------------------------------------------------------------- Surfaces

  private updateSurfaces(dt: number): void {
    // Hors de l'écran, les tas ne font que fondre et se faner, une image sur dix.
    const offscreenTick = this.frame % 10 === 0;
    for (const s of this.surfaces.values()) {
      if (s.onScreen) this.updateSurface(s, dt);
      else if (offscreenTick && (s.peak > 0 || s.litter.length > 0)) this.idleSurface(s, dt * 10);
    }
    this.updateSurface(this.ground, dt);
    this.updateGlints(dt);
  }

  private snowAllowed(s: Surface): boolean {
    return this.fx.snow && (s.ground ? this.settleGround : this.settleCards);
  }

  private idleSurface(s: Surface, dt: number): void {
    this.applyMelt(s, dt);
    let peak = 0;
    for (let i = 0; i < s.n; i++) if (s.h[i] > peak) peak = s.h[i];
    s.peak = peak;
    s.beads.length = 0;
    s.drips.length = 0;
    s.wet = 0;
    if (s.litter.length === 0) return;
    this.ageLitter(s, dt);
    if (s.litterDirty) {
      this.rebuildLitter(s);
      s.lhShown.set(s.lh);
    }
  }

  private applyMelt(s: Surface, dt: number): void {
    // La neige qui n'a plus le droit de tenir fond vite ; sinon lentement, et la pluie la fait fondre plus vite encore.
    if (!this.snowAllowed(s)) {
      melt(s.h, dt, 0.8, 0.25);
      return;
    }
    const k = (this.options.fade ? 1 : 0) + (this.fx.rain ? 3 : 0);
    if (k > 0) melt(s.h, dt, (s.ground ? 0.05 : 0.02) * k, (s.ground ? 0.012 : 0.006) * k);
  }

  /** Capacité en neige d'une surface : un tas de feuilles en prend une partie. */
  private snowCap(s: Surface): Float32Array {
    if (s.litter.length === 0) return s.cap;
    if (this.capTmp.length < s.n) this.capTmp = new Float32Array(s.n);
    const out = this.capTmp;
    for (let i = 0; i < s.n; i++) out[i] = Math.max(s.cap[i] * 0.4, s.cap[i] - s.lh[i]);
    return out;
  }

  private updateSurface(s: Surface, dt: number): void {
    if (s.layoutWidth < 0) return;
    const colW = s.layoutWidth / s.n;
    const card = !s.ground && s.onScreen;
    if (card && Math.abs(s.vx) > 450) this.shed(s, dt, colW);
    if (this.tmp.length < s.n) this.tmp = new Float32Array(s.n);
    const snow = this.snowAllowed(s);
    if (snow || s.peak > 0) {
      this.applyMelt(s, dt);
      if (snow && !s.occluded) {
        s.haze += s.layoutWidth * HAZE_RATE * this.densityRatio * this.share * dt;
        while (s.haze > HAZE_DROP) {
          s.haze -= HAZE_DROP;
          deposit(s.h, Math.random() * s.n - 0.5, HAZE_DROP, colW, 2.2);
        }
      }
      smooth(s.h, SETTLE_RATE * dt, this.tmp);
      const spill = relax(s.h, this.snowCap(s), colW, s.ground ? 0.5 : 0.65, 2);
      let peak = 0;
      for (let i = 0; i < s.n; i++) if (s.h[i] > peak) peak = s.h[i];
      s.peak = peak;
      if (card) {
        s.spillL += spill.left;
        s.spillR += spill.right;
        // Ce qui glisse par un bord tombe en grains le long de l'arrondi.
        while (s.spillL > GRAIN_VOLUME) {
          s.spillL -= GRAIN_VOLUME;
          this.addGrain({
            x: s.left - 0.5, y: s.top + s.radius * 0.4, vx: -rand(4, 22), vy: rand(5, 35),
            r: rand(0.8, 1.3), vol: GRAIN_VOLUME, kind: GrainKind.Grain, skip: s,
          });
        }
        while (s.spillR > GRAIN_VOLUME) {
          s.spillR -= GRAIN_VOLUME;
          this.addGrain({
            x: s.left + s.width + 0.5, y: s.top + s.radius * 0.4, vx: rand(4, 22), vy: rand(5, 35),
            r: rand(0.8, 1.3), vol: GRAIN_VOLUME, kind: GrainKind.Grain, skip: s,
          });
        }
      }
    }
    if (card) {
      for (let k = s.splats.length - 1; k >= 0; k--) {
        const p = s.splats[k];
        p.age += dt;
        // La neige collée tient un instant puis glisse le long de l'affiche.
        if (p.age > 1.2) p.y += 5 * dt;
        if (p.age >= p.life) s.splats.splice(k, 1);
      }
      this.updateBeads(s, dt);
    }
    if (s.litter.length > 0) this.ageLitter(s, dt);
    if (s.litterDirty) this.rebuildLitter(s);
    // Le tas dessiné rattrape le vrai en douceur : rien ne saute quand une feuille arrive ou s'en va.
    const ease = Math.min(1, dt * 7);
    for (let i = 0; i < s.n; i++) {
      const d = s.lh[i] - s.lhShown[i];
      if (d !== 0) s.lhShown[i] = Math.abs(d) < 0.01 ? s.lh[i] : s.lhShown[i] + d * ease;
    }
  }

  /** Une card qui glisse vite (carrousel) perd ce qu'elle porte, emporté dans son élan. */
  private shed(s: Surface, dt: number, colW: number): void {
    const frac = Math.min(0.6, (Math.abs(s.vx) - 450) / 1800) * dt * 6;
    if (frac <= 0) return;
    const loose = Math.min(1, frac * 2.5);
    for (let i = s.litter.length - 1; i >= 0; i--) {
      if (Math.random() < loose) this.kick(s, i, s.vx * rand(0.3, 0.6) + rand(-30, 30), -rand(20, 110));
    }
    if (s.peak <= 0) return;
    const chunk = 3;
    for (let i = 0; i < s.n; i += chunk) {
      let vol = 0;
      for (let j = i; j < Math.min(s.n, i + chunk); j++) {
        const take = s.h[j] * frac;
        s.h[j] -= take;
        vol += take * colW;
      }
      if (vol < 0.4) continue;
      const x = s.left + (i + chunk / 2) * colW;
      if (x < s.clipL || x > s.clipR) continue;
      this.addGrain({
        x, y: s.top + s.base[i] - s.h[i] * rand(0.2, 1), vx: s.vx * rand(0.35, 0.7) + rand(-30, 30), vy: rand(-90, 30),
        r: clamp(Math.sqrt(vol / Math.PI) * 1.1, 0.9, 3), vol, kind: vol > 6 ? GrainKind.Lump : GrainKind.Grain, skip: s,
      });
    }
  }

  private updateGlints(dt: number): void {
    for (let i = this.glints.length - 1; i >= 0; i--) {
      const g = this.glints[i];
      g.life -= dt;
      if (g.life <= 0 || !g.s.onScreen) this.glints.splice(i, 1);
    }
    if (this.reduced || this.glints.length > 40) return;
    for (const s of this.active) {
      if (s.peak < 2 || s.occluded || Math.random() > dt * 0.8) continue;
      const col = Math.floor(Math.random() * s.n);
      if (s.h[col] > 1.5) this.glints.push({ s, col, life: 0.6 });
    }
  }

  // ---------------------------------------------------------------- Halloween

  private pumpkinCount(): number {
    return clamp(Math.round(this.W / 420), 2, 5);
  }

  /** Les citrouilles gardent leur place tant que la largeur de l'écran ne change pas de classe. */
  private placePumpkins(): void {
    const count = this.pumpkinCount();
    const mobile = this.W < 768;
    this.pumpkins = Array.from({ length: count }, (_, i) => ({
      at: clamp((i + 0.5 + rand(-0.28, 0.28)) / count, 0.05, 0.95),
      size: mobile ? rand(34, 44) : rand(46, 64),
      phase: rand(0, TAU),
    }));
  }

  private updateHalloween(dt: number): void {
    if (this.presence.halloween <= 0 || !this.art) return;
    const mobile = this.W < 768;
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      g.age += dt;
      if (g.age >= g.life) this.ghosts.splice(i, 1);
    }
    for (let i = this.bats.length - 1; i >= 0; i--) {
      const b = this.bats[i];
      b.age += dt;
      b.x += b.vx * dt;
      if (b.x < -80 || b.x > this.W + 80) this.bats.splice(i, 1);
    }
    if (!this.fx.halloween) return;
    const pace = Math.max(0.6, Math.sqrt(this.densityRatio));
    this.nextGhost -= dt;
    if (this.nextGhost <= 0) {
      this.nextGhost = rand(7, 15) / pace;
      if (this.ghosts.length < (mobile ? 1 : 2)) {
        this.ghosts.push({
          x: this.W < 200 ? this.W / 2 : rand(70, this.W - 70), age: 0, life: rand(7, 9.5),
          size: mobile ? rand(84, 104) : rand(110, 150), phase: rand(0, TAU),
        });
      }
    }
    this.nextBat -= dt;
    if (this.nextBat <= 0) {
      this.nextBat = rand(4, 10) / pace;
      // Sans mouvement (réglage du système), pas de chauve-souris : elle n'est que mouvement.
      if (!this.reduced && this.bats.length < (mobile ? 2 : 3)) {
        const fromLeft = Math.random() < 0.5;
        this.bats.push({
          x: fromLeft ? -60 : this.W + 60, y: rand(0.06, 0.42) * this.H,
          vx: rand(95, 165) * (fromLeft ? 1 : -1), size: mobile ? rand(26, 34) : rand(32, 46),
          phase: rand(0, TAU), age: 0,
        });
      }
    }
  }

  // ----------------------------------------------------------------- Curseur

  /** Neige sous le point, assez épaisse pour en faire une boule. */
  private snowAt(x: number, y: number): Landing | null {
    for (const s of this.active) {
      if (s.occluded || s.alpha < 0.5 || x < s.clipL || x >= s.clipR || y < this.clipTop) continue;
      if (y < s.top - s.maxH - 8 || y > s.top + s.radius + 4) continue;
      const colW = s.width / s.n;
      const at = Math.floor((x - s.left) / colW);
      // Le plus haut des colonnes proches : viser un creux à côté d'un tas suffit.
      let col = -1;
      for (let i = Math.max(0, at - 3); i <= Math.min(s.n - 1, at + 3); i++) if (col < 0 || s.h[i] > s.h[col]) col = i;
      if (col < 0) continue;
      const top = s.top + s.base[col] - s.h[col];
      if (s.h[col] >= 1.5 && y >= top - 6 && y <= s.top + s.base[col] + 3) return { s, col, y: top };
    }
    const g = this.ground;
    const col = Math.min(g.n - 1, Math.max(0, Math.floor(x / (this.W / g.n))));
    if (g.h[col] >= 2 && y >= this.H - g.h[col] - 6) return { s: g, col, y: this.H - g.h[col] };
    return null;
  }

  private surfacesNear(x: number, y: number, r: number, fn: (s: Surface) => void): void {
    for (const s of this.active) {
      if (s.occluded || (s.peak <= 0 && s.litter.length === 0)) continue;
      if (x < s.left - r || x > s.left + s.width + r) continue;
      if (y < s.top - s.maxH * 2 - r || y > s.top + s.radius + r) continue;
      fn(s);
    }
    const g = this.ground;
    if ((g.peak > 0 || g.litter.length > 0) && y > this.H - g.maxH * 2 - r) fn(g);
  }

  /** Creuse un disque dans la neige d'une surface ; rend le volume par colonne dans `this.scratch`. */
  private carve(s: Surface, x: number, y: number, r: number): number {
    if (this.scratch.length < s.n) this.scratch = new Float32Array(s.n);
    const colW = s.width / s.n;
    return carveCircle(s.h, s.base, colW, x - s.left, y - s.top, r, this.scratch);
  }

  private updatePointer(dt: number): void {
    const p = this.pointer;
    const decay = Math.exp(-dt * 10);
    p.vx *= decay;
    p.vy *= decay;
    if (!p.active || this.ball?.held) return;
    const r = p.touch ? CURSOR_RADIUS.touch : CURSOR_RADIUS.mouse;
    this.surfacesNear(p.x, p.y, r, (s) => {
      if (s.peak > 0 && this.carve(s, p.x, p.y, r) > 0) this.scatter(s, p.x, r, p.vx, p.vy);
      this.scatterLitter(s, p.x, p.y, r, p.vx, p.vy);
    });
  }

  /**
   * Neige retirée par le curseur : poussée sur le côté quand il avance
   * doucement (il écarte la neige), projetée quand il va vite.
   */
  private scatter(s: Surface, cx: number, r: number, vx: number, vy: number): void {
    const colW = s.width / s.n;
    const speed = Math.hypot(vx, vy);
    const pushShare = this.reduced ? 1 : speed < 120 ? 0.85 : speed < 450 ? 0.45 : 0.12;
    const removed = this.scratch;
    const first = Math.max(0, Math.floor((cx - s.left - r) / colW));
    const last = Math.min(s.n - 1, Math.ceil((cx - s.left + r) / colW));
    let spray = 0;
    let sprayX = 0;
    for (let i = first; i <= last; i++) {
      const vol = removed[i];
      if (vol <= 0) continue;
      removed[i] = 0;
      const x = s.left + (i + 0.5) * colW;
      const side = x < cx ? -1 : 1;
      const pushed = vol * pushShare;
      const tx = cx + side * (r + colW) - s.left;
      if (tx >= 0 && tx < s.width) deposit(s.h, tx / colW - 0.5, pushed, colW, 1);
      else if (!s.ground) {
        if (side < 0) s.spillL += pushed;
        else s.spillR += pushed;
      }
      spray += vol - pushed;
      sprayX = x;
      if (spray >= GRAIN_VOLUME && !this.reduced) {
        const count = Math.min(6, Math.floor(spray / GRAIN_VOLUME));
        spray -= count * GRAIN_VOLUME;
        const y = s.ground ? this.H - s.h[i] - 2 : s.top + s.base[i] - s.h[i] - 2;
        for (let k = 0; k < count; k++) {
          this.addGrain({
            x: sprayX + rand(-2, 2), y,
            vx: vx * rand(0.25, 0.7) + side * rand(20, 90), vy: Math.min(vy * 0.4, 0) - rand(90, 260),
            r: rand(0.8, 1.4), vol: GRAIN_VOLUME, kind: GrainKind.Grain, skip: s, skipFor: 0.12,
          });
        }
      }
    }
  }

  private updateCursor(): void {
    const p = this.pointer;
    let cursor = '';
    if (this.ball?.held) cursor = 'grabbing';
    else if (p.active && !p.touch && this.snowAt(p.x, p.y)) cursor = 'grab';
    this.setCursor(cursor);
  }

  /** Change le curseur seulement au passage : écrire sur <html> recalcule toute la page. */
  private setCursor(cursor: string): void {
    if (cursor === this.cursor) return;
    this.cursor = cursor;
    document.documentElement.style.cursor = cursor;
  }

  private onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    this.movePointer(e.clientX, e.clientY, e.timeStamp, false);
  };

  private movePointer(x: number, y: number, t: number, touch: boolean): void {
    const p = this.pointer;
    const dt = (t - p.t) / 1000;
    if (p.active && dt > 0 && dt < 0.2) {
      p.vx = p.vx * 0.5 + ((x - p.x) / dt) * 0.5;
      p.vy = p.vy * 0.5 + ((y - p.y) / dt) * 0.5;
    }
    p.x = x;
    p.y = y;
    p.t = t;
    p.active = true;
    p.touch = touch;
    this.history.push({ x, y, t });
    while (this.history.length > 8 || (this.history.length > 1 && t - this.history[0].t > 100)) this.history.shift();
  }

  private onPointerOut = (e: PointerEvent) => {
    if (!e.relatedTarget && e.pointerType !== 'touch') this.pointer.active = false;
  };

  private onPointerDown = (e: PointerEvent) => {
    this.suppressClick = false;
    if (e.pointerType !== 'mouse' || e.button !== 0 || this.ball) return;
    const hit = this.snowAt(e.clientX, e.clientY);
    if (!hit) return;
    const s = hit.s;
    let vol = this.carve(s, e.clientX, e.clientY, 14);
    this.scratch.fill(0, 0, s.n);
    if (vol < 8) {
      this.land(hit, e.clientX, vol, 1.2);
      return;
    }
    if (vol > BALL_MAX_VOLUME) {
      this.land(hit, e.clientX, vol - BALL_MAX_VOLUME, 2);
      vol = BALL_MAX_VOLUME;
    }
    // L'appui sert à prendre la neige : la card dessous ne doit ni s'ouvrir ni glisser.
    e.preventDefault();
    e.stopPropagation();
    this.suppressClick = true;
    this.movePointer(e.clientX, e.clientY, e.timeStamp, false);
    this.history.length = 0;
    this.ball = {
      x: e.clientX, y: e.clientY, vx: 0, vy: 0, r: this.ballRadius(vol), vol,
      held: true, flight: 0, origin: s,
    };
    this.powder(e.clientX, hit.y, 5, 40, 80);
    this.setCursor('grabbing');
  };

  private onPointerUp = (e: PointerEvent) => {
    const ball = this.ball;
    if (!ball?.held || e.pointerType !== 'mouse') return;
    e.preventDefault();
    e.stopPropagation();
    this.release(ball);
  };

  private release(ball: Ball): void {
    const h = this.history;
    let vx = 0;
    let vy = 0;
    if (h.length >= 2) {
      const a = h[0];
      const b = h[h.length - 1];
      const dt = (b.t - a.t) / 1000;
      if (dt > 0.008 && performance.now() - b.t < 120) {
        vx = (b.x - a.x) / dt;
        vy = (b.y - a.y) / dt;
      }
    }
    const speed = Math.hypot(vx, vy);
    if (speed > 2600) { vx *= 2600 / speed; vy *= 2600 / speed; }
    ball.vx = vx;
    ball.vy = vy;
    ball.held = false;
    ball.flight = 0;
    this.setCursor('');
  }

  private onClick = (e: MouseEvent) => {
    if (!this.suppressClick) return;
    this.suppressClick = false;
    e.preventDefault();
    e.stopPropagation();
  };

  private onHeldGuard = (e: Event) => {
    if (this.ball?.held) e.preventDefault();
  };

  private onBlur = () => {
    this.pointer.active = false;
    if (this.ball?.held) this.release(this.ball);
  };

  private onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    this.movePointer(t.clientX, t.clientY, e.timeStamp, true);
    this.pointer.vx = 0;
    this.pointer.vy = 0;
    if (this.reduced) return;
    // Un tap sur un tas le fait voler (pas de boule au doigt : le geste sert à défiler).
    const r = CURSOR_RADIUS.touch + 4;
    this.surfacesNear(t.clientX, t.clientY, r, (s) => this.scatterLitter(s, t.clientX, t.clientY, r, rand(-60, 60), -420));
    const hit = this.snowAt(t.clientX, t.clientY);
    if (!hit) return;
    if (this.carve(hit.s, t.clientX, t.clientY, r) > 0) this.scatter(hit.s, t.clientX, r, rand(-60, 60), -420);
  };

  private onTouchMove = (e: TouchEvent) => {
    const t = e.touches[0];
    if (t) this.movePointer(t.clientX, t.clientY, e.timeStamp, true);
  };

  private onTouchEnd = (e: TouchEvent) => {
    if (e.touches.length === 0) this.pointer.active = false;
  };

  private onReducedChange = (e: MediaQueryListEvent) => {
    this.reduced = e.matches;
  };

  // ------------------------------------------------------------ Boule de neige

  private ballRadius(vol: number): number {
    return clamp(Math.sqrt(vol / Math.PI) * 0.95, 3.5, 11);
  }

  private updateBall(dt: number): void {
    const ball = this.ball;
    if (!ball) return;
    if (ball.held) {
      const p = this.pointer;
      ball.x = p.x;
      ball.y = p.y;
      // Rouler la boule dans d'autres tas la fait grossir.
      if (ball.vol < BALL_MAX_VOLUME) {
        this.surfacesNear(ball.x, ball.y, ball.r + 1, (s) => {
          const got = this.carve(s, ball.x, ball.y, ball.r + 1);
          this.scratch.fill(0, 0, s.n);
          ball.vol = Math.min(BALL_MAX_VOLUME, ball.vol + got);
        });
        ball.r += (this.ballRadius(ball.vol) - ball.r) * Math.min(1, dt * 12);
      }
      return;
    }
    ball.flight += dt;
    ball.vy += GRAVITY * dt;
    ball.vx *= 1 - 0.15 * dt;
    const y0 = ball.y;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    const grace = ball.flight < 0.06;
    // Une card touchée de face garde une tache de neige.
    for (const s of this.active) {
      if (s.occluded || (grace && s === ball.origin)) continue;
      if (ball.x < s.clipL || ball.x > s.clipR || ball.y < s.top + 2 || ball.y > s.top + s.height || ball.y < this.clipTop) continue;
      this.splat(s, ball);
      return;
    }
    if (ball.vy > 0) {
      const hit = this.findLanding(ball.x, y0 - ball.r, ball.y + ball.r * 0.3, grace ? ball.origin : null);
      if (hit) {
        this.land(hit, ball.x, ball.vol, Math.max(1.5, ball.r / (hit.s.width / hit.s.n)));
        this.powder(ball.x, hit.y, 8 + Math.round(ball.r), 90, 160);
        // Une boule qui tombe dans un tas de feuilles les fait voler.
        this.scatterLitter(hit.s, ball.x, hit.y, ball.r + 10, ball.vx * 0.3, -200);
        this.ball = null;
        return;
      }
    }
    if (ball.x < -80 || ball.x > this.W + 80 || ball.y > this.H + 80 || ball.y < -800) this.ball = null;
  }

  private splat(s: Surface, ball: Ball): void {
    const x = ball.x - s.left;
    const y = ball.y - s.top;
    const blobs: number[] = [];
    const r = ball.r;
    blobs.push(0, 0, r * 1.35);
    const count = 8 + Math.round(r / 2);
    const dir = Math.atan2(ball.vy, ball.vx);
    for (let k = 0; k < count; k++) {
      // Les éclats partent surtout dans le sens du lancer.
      const a = dir + rand(-1.7, 1.7);
      const d = r * rand(0.8, 2.6);
      blobs.push(Math.cos(a) * d, Math.sin(a) * d, r * rand(0.2, 0.6));
    }
    s.splats.push({ x, y, age: 0, life: 6, blobs });
    if (s.splats.length > 6) s.splats.shift();
    this.powder(ball.x, ball.y, 10 + Math.round(r), 160, 140);
    this.ball = null;
  }

  // ------------------------------------------------------------------ Dessin

  private draw(): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    if (this.master <= 0) return;
    for (const s of this.active) this.drawFace(s);
    for (const s of this.active) {
      this.drawPile(s);
      this.drawLitter(s);
    }
    // Les citrouilles sont prises dans le tas du bas de l'écran ; leur lueur passe par-dessus.
    this.drawPumpkins(false);
    this.drawPile(this.ground);
    this.drawLitter(this.ground);
    this.drawPumpkins(true);
    this.drawGlints();
    this.drawGhosts();
    this.drawParticles();
    this.drawRain();
    this.drawBall();
    ctx.globalAlpha = 1;
  }

  private pilePath(s: Surface, dy: number): void {
    const ctx = this.ctx;
    const { n, h, base } = s;
    const colW = s.width / n;
    const left = s.left;
    const top = s.top + dy;
    const edge = s.ground ? 0 : Math.min(s.radius, s.width / 2);
    ctx.beginPath();
    ctx.moveTo(left, top + edge);
    let px = left + 0.5 * colW;
    let py = top + base[0] - h[0];
    ctx.lineTo(px, py);
    for (let i = 1; i < n; i++) {
      const x = left + (i + 0.5) * colW;
      const y = top + base[i] - h[i];
      ctx.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);
      px = x;
      py = y;
    }
    ctx.lineTo(px, py);
    ctx.lineTo(left + s.width, top + edge);
    // Retour le long du bord de la card : là où il n'y a pas de neige, l'aire est nulle.
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(left + (i + 0.5) * colW, top + base[i]);
    ctx.closePath();
  }

  private drawPile(s: Surface): void {
    if (s.peak < 0.15 || s.alpha < 0.02) return;
    const ctx = this.ctx;
    ctx.save();
    if (!s.ground) {
      ctx.beginPath();
      ctx.rect(s.clipL, this.clipTop, s.clipR - s.clipL, this.H - this.clipTop);
      ctx.clip();
    }
    ctx.globalAlpha = this.master * s.alpha;
    // Ombre portée sous la neige, puis la neige, plus claire en haut.
    this.pilePath(s, 1.6);
    ctx.fillStyle = this.light ? 'rgba(60,80,110,0.22)' : 'rgba(6,12,24,0.35)';
    ctx.fill();
    this.pilePath(s, 0);
    const grad = ctx.createLinearGradient(0, s.top - s.peak, 0, s.top + (s.ground ? 0 : 3));
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, this.light ? '#c4d3e6' : '#d3e0ef');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  }

  /** Colle un dessin de feuille, de pétale ou de fleur : tourné, écrasé, plus ou moins sec. */
  private stamp(
    kind: FlutterKind, variant: number, x: number, y: number, rot: number, flipY: number,
    size: number, alpha: number, dry: number, glint: number,
  ): void {
    const ctx = this.ctx;
    const k = this.dpr;
    const cos = Math.cos(rot) * k;
    const sin = Math.sin(rot) * k;
    ctx.setTransform(cos, sin, -sin * flipY, cos * flipY, x * k, y * k);
    if (isSolid(kind)) {
      // Bonbons du thème Halloween ou grains de pop-corn : un seul dessin, qui ne se fane pas.
      const art = kind === FlutterKind.Candy ? this.art?.candies[variant] : this.sprites.popcorn[variant];
      if (!art) return;
      ctx.globalAlpha = alpha;
      ctx.drawImage(art, -size, -size, size * 2, size * 2);
      return;
    }
    const sp = this.sprites;
    let fresh: HTMLCanvasElement;
    let dried: HTMLCanvasElement;
    let d: number;
    if (kind === FlutterKind.Leaf) {
      fresh = sp.leaves[variant];
      dried = sp.leavesDry[Math.floor(variant / LEAF_COLORS)];
      d = size * LEAF_DRAW;
    } else if (kind === FlutterKind.Petal) {
      fresh = sp.petals[variant];
      dried = sp.petalDry;
      d = size * PETAL_DRAW;
    } else {
      fresh = sp.flower;
      dried = sp.flowerDry;
      d = size * PETAL_DRAW;
    }
    const o = -d / 2;
    if (dry < 1) {
      ctx.globalAlpha = alpha;
      ctx.drawImage(fresh, o, o, d, d);
    }
    if (dry > 0) {
      ctx.globalAlpha = alpha * dry;
      ctx.drawImage(dried, o, o, d, d);
    }
    if (glint > 0.02) {
      ctx.globalAlpha = alpha * glint;
      ctx.drawImage(sp.petalGlint, o, o, d, d);
    }
  }

  private drawLitter(s: Surface): void {
    const list = s.litter;
    if (list.length === 0 || s.alpha < 0.02) return;
    const ctx = this.ctx;
    ctx.save();
    if (!s.ground) {
      ctx.beginPath();
      ctx.rect(s.clipL, this.clipTop, s.clipR - s.clipL, this.H - this.clipTop);
      ctx.clip();
    }
    const colW = s.width / s.n;
    const base = this.master * s.alpha;
    for (const it of list) {
      const col = clamp(Math.floor(it.x / colW), 0, s.n - 1);
      const dry = this.litterDry(it);
      // Elle finit de se coucher, puis se recroqueville en séchant et s'efface.
      const squash = (it.from + (it.squash - it.from) * easeOut(it.t)) * (1 - 0.2 * dry);
      const alpha = base * clamp((it.life - it.age) / LITTER_FADE, 0, 1);
      this.stamp(it.kind, it.variant, s.left + it.x, this.litterY(s, it, col), it.rot, squash, it.size, alpha, dry, 0);
    }
    ctx.restore();
  }

  private drawFlutters(list: Flutter[], presence: number): void {
    if (list.length === 0 || presence <= 0) return;
    const base = this.master * presence;
    for (const f of list) {
      const pose = this.pose(f);
      const alpha = base * (f.fade >= 0 ? Math.min(1, f.fade / 0.4) : 1);
      this.stamp(f.kind, f.variant, f.x, f.y, pose.rot, pose.flipY, f.size, alpha, f.dry, pose.glint);
    }
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /** Ce qui se voit sur la face d'une card : taches de neige, film d'eau, gouttes qui coulent et qui pendent. */
  private drawFace(s: Surface): void {
    if (s.occluded || s.alpha < 0.02) return;
    const wet = s.wet > 0.01 || s.beads.length > 0;
    if (!wet && s.splats.length === 0 && s.drips.length === 0) return;
    const ctx = this.ctx;
    const base = this.master * s.alpha;
    const top = Math.max(s.top, this.clipTop);
    const water = this.light ? '96,126,168' : '205,226,250';
    if (s.top + s.height > top && (wet || s.splats.length > 0)) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(s.clipL, top, s.clipR - s.clipL, s.top + s.height - top);
      ctx.clip();
      if (s.wet > 0.01) {
        // Film d'eau : un reflet qui s'éteint en descendant du bord haut.
        const depth = Math.min(s.height, 30);
        const grad = ctx.createLinearGradient(0, s.top, 0, s.top + depth);
        grad.addColorStop(0, `rgba(${water},${(0.16 * s.wet).toFixed(3)})`);
        grad.addColorStop(1, `rgba(${water},0)`);
        ctx.globalAlpha = base;
        ctx.fillStyle = grad;
        ctx.fillRect(s.left, s.top, s.width, depth);
      }
      if (s.beads.length > 0) {
        ctx.lineCap = 'round';
        ctx.strokeStyle = `rgb(${water})`;
        for (const b of s.beads) {
          const x = s.left + b.x;
          const y = s.top + b.y;
          if (b.y - b.tail > 1.5) {
            ctx.globalAlpha = base * 0.13;
            ctx.lineWidth = b.r;
            ctx.beginPath();
            ctx.moveTo(x, s.top + b.tail);
            ctx.lineTo(x, y - b.r);
            ctx.stroke();
          }
          ctx.globalAlpha = base * 0.6;
          ctx.fillStyle = `rgb(${water})`;
          ctx.beginPath();
          ctx.ellipse(x, y, b.r * 0.85, b.r * 1.15, 0, 0, TAU);
          ctx.fill();
          ctx.globalAlpha = base * 0.9;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(x - b.r * 0.45, y - b.r * 0.6, b.r * 0.5, b.r * 0.5);
        }
      }
      if (s.splats.length > 0) {
        ctx.fillStyle = '#f2f7ff';
        for (const p of s.splats) {
          const fadeIn = Math.min(1, p.age / 0.08);
          const fadeOut = Math.min(1, (p.life - p.age) / 2);
          ctx.globalAlpha = base * 0.92 * fadeIn * fadeOut;
          ctx.beginPath();
          for (let k = 0; k < p.blobs.length; k += 3) {
            const x = s.left + p.x + p.blobs[k];
            const y = s.top + p.y + p.blobs[k + 1];
            ctx.moveTo(x + p.blobs[k + 2], y);
            ctx.arc(x, y, p.blobs[k + 2], 0, TAU);
          }
          ctx.fill();
        }
      }
      ctx.restore();
    }
    const bottom = s.top + s.height;
    if (s.drips.length === 0 || bottom < this.clipTop || bottom > this.H) return;
    ctx.fillStyle = `rgb(${water})`;
    for (const d of s.drips) {
      const x = s.left + d.x;
      if (x < s.clipL || x > s.clipR) continue;
      ctx.globalAlpha = base * 0.65;
      ctx.beginPath();
      ctx.ellipse(x, bottom + d.r * 0.8, d.r * 0.8, d.r, 0, 0, TAU);
      ctx.fill();
    }
  }

  private drawGlints(): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#ffffff';
    for (const g of this.glints) {
      const s = g.s;
      if (s.occluded) continue;
      const colW = s.width / s.n;
      const x = s.left + (g.col + 0.5) * colW;
      const y = s.top + s.base[g.col] - s.h[g.col] + 1.2;
      if (y < this.clipTop || x < s.clipL || x > s.clipR) continue;
      const a = Math.sin((g.life / 0.6) * Math.PI);
      ctx.globalAlpha = this.master * s.alpha * a;
      ctx.fillRect(x - 0.6, y - 0.6, 1.2, 1.2);
      ctx.globalAlpha = this.master * s.alpha * a * 0.5;
      ctx.fillRect(x - 2, y - 0.25, 4, 0.5);
      ctx.fillRect(x - 0.25, y - 2, 0.5, 4);
    }
  }

  private drawParticles(): void {
    const ctx = this.ctx;
    const sp = this.sprites;
    const snow = this.light ? sp.snowLight : sp.snow;
    const water = this.light ? sp.waterLight : sp.water;
    const snowAlpha = this.master * this.presence.snow;
    if (snowAlpha > 0) {
      for (const f of this.flakes) {
        const size = f.r * 3;
        ctx.globalAlpha = snowAlpha * LAYERS[f.layer].alpha;
        ctx.drawImage(snow, f.x - size / 2, f.y - size / 2, size, size);
      }
    }
    this.drawFlutters(this.leaves, this.presence.leaves);
    this.drawFlutters(this.petals, this.presence.petals);
    this.drawFlutters(this.candies, this.presence.halloween);
    this.drawFlutters(this.popcorn, this.presence.popcorn);
    this.drawBats();
    let lumps = 0;
    for (const g of this.grains) {
      if (g.kind === GrainKind.Lump) { lumps++; continue; }
      const size = g.r * 2.8;
      ctx.globalAlpha = this.master * (g.kind === GrainKind.Powder ? Math.max(0, g.life / g.maxLife) * 0.8 : 0.95);
      ctx.drawImage(g.water ? water : snow, g.x - size / 2, g.y - size / 2, size, size);
    }
    if (lumps === 0) return;
    // Les blocs sont des mottes pleines, pas des flocons flous.
    ctx.globalAlpha = this.master;
    ctx.fillStyle = this.light ? '#e3ebf5' : '#eef4fb';
    ctx.beginPath();
    for (const g of this.grains) {
      if (g.kind !== GrainKind.Lump) continue;
      ctx.moveTo(g.x + g.r, g.y);
      ctx.arc(g.x, g.y, g.r, 0, TAU);
      ctx.moveTo(g.x + g.r * 0.3 + g.r * 0.65, g.y - g.r * 0.4);
      ctx.arc(g.x + g.r * 0.3, g.y - g.r * 0.4, g.r * 0.65, 0, TAU);
    }
    ctx.fill();
  }

  private drawRain(): void {
    const ctx = this.ctx;
    const color = this.light ? 'rgb(74,104,146)' : 'rgb(196,220,248)';
    const base = this.master * this.presence.rain;
    if (this.drops.length > 0 && base > 0) {
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      // Un seul tracé par plan : des centaines de traits ne coûtent que trois appels.
      for (let layer = 0; layer < RAIN_LAYERS.length; layer++) {
        const L = RAIN_LAYERS[layer];
        const vx = this.rainVx * L.wind;
        ctx.beginPath();
        for (const d of this.drops) {
          if (d.layer !== layer) continue;
          ctx.moveTo(d.x, d.y);
          ctx.lineTo(d.x - (vx / d.vy) * d.len, d.y - d.len);
        }
        ctx.globalAlpha = base * L.alpha;
        ctx.lineWidth = L.width;
        ctx.stroke();
      }
    }
    if (this.ripples.length === 0) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    for (const r of this.ripples) {
      const t = r.age / r.life;
      const w = r.w * (0.3 + 0.7 * t);
      ctx.globalAlpha = this.master * (1 - t) * 0.5;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y - 0.5, w, w * 0.32, 0, 0, TAU);
      ctx.stroke();
    }
  }

  /** Hauteur du haut du tas, tout en bas de l'écran, à l'abscisse `x`. */
  private groundY(x: number): number {
    const g = this.ground;
    const col = clamp(Math.floor(x / (this.W / g.n)), 0, g.n - 1);
    return this.H - g.h[col] - g.lhShown[col];
  }

  /** Citrouilles du thème, posées en bas de l'écran ; `glow` : la lueur de leur bougie. */
  private drawPumpkins(glow: boolean): void {
    const art = this.art;
    const presence = this.presence.halloween;
    if (!art || presence <= 0.01 || this.pumpkins.length === 0) return;
    const ctx = this.ctx;
    const rise = easeOut(presence);
    const t = this.time;
    for (const p of this.pumpkins) {
      const x = p.at * this.W;
      const size = p.size;
      // Le pied pris dans le tas ; elle sort du sol quand l'effet s'allume.
      const foot = this.H - (this.H - this.groundY(x)) * 0.7 + size * 0.04 + (1 - rise) * size * 1.2;
      const top = foot - size * art.pumpkinFoot;
      if (!glow) {
        ctx.globalAlpha = this.master;
        ctx.drawImage(art.pumpkin, x - size / 2, top, size, size);
        continue;
      }
      // Bougie : la lueur vacille sans rythme régulier.
      const flicker = this.reduced
        ? 0.8
        : 0.7 + 0.22 * Math.sin(t * 7.3 + p.phase) * Math.sin(t * 3.1 + p.phase * 2) + 0.08 * Math.sin(t * 17 + p.phase);
      const side = size * 2.1;
      ctx.globalAlpha = this.master * rise * flicker * 0.5;
      ctx.drawImage(this.sprites.ember, x - side / 2, top + size * art.pumpkinCenter - side / 2, side, side);
    }
  }

  /** Fantôme de brume du thème : il sort du tas du bas de l'écran, monte en se balançant et se dissipe. */
  private drawGhosts(): void {
    const art = this.art;
    if (!art || this.ghosts.length === 0 || this.presence.halloween <= 0.01) return;
    const ctx = this.ctx;
    for (const gh of this.ghosts) {
      const t = gh.age;
      const alpha = this.master * this.presence.halloween * Math.min(1, t / 0.8) * Math.min(1, (gh.life - t) / 2) * 0.85;
      if (alpha <= 0.01) continue;
      const rise = this.reduced ? 1 : easeOut(Math.min(1, t / 1.8));
      const sway = this.reduced ? 0 : Math.sin(t * 1.1 + gh.phase);
      const h = gh.size;
      const w = h * art.ghostRatio;
      const ground = this.groundY(gh.x);
      const top = ground - rise * h * 0.95 - (this.reduced ? 0 : Math.max(0, t - 1.8) * 14);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, this.W, ground + 1);
      ctx.clip();
      ctx.globalAlpha = alpha;
      ctx.drawImage(art.ghost, gh.x + sway * 12 * rise - w / 2, top, w, h);
      ctx.restore();
    }
  }

  /** Chauves-souris du thème : elles traversent en ondulant, les ailes battent. */
  private drawBats(): void {
    const art = this.art;
    if (!art || this.bats.length === 0) return;
    const ctx = this.ctx;
    const k = this.dpr;
    const base = this.master * this.presence.halloween;
    for (const b of this.bats) {
      const y = b.y + Math.sin(b.age * 1.7 + b.phase) * 20;
      // Battement : les ailes se referment (dessin resserré) puis s'ouvrent, le corps monte et descend avec elles.
      const beat = Math.sin(b.age * 13 + b.phase);
      const fold = 0.72 + 0.28 * Math.abs(beat);
      const tilt = Math.cos(b.age * 1.7 + b.phase) * 0.12 * Math.sign(b.vx);
      const cos = Math.cos(tilt) * k;
      const sin = Math.sin(tilt) * k;
      ctx.setTransform(cos * fold, sin * fold, -sin, cos, b.x * k, (y + beat * 2) * k);
      ctx.globalAlpha = base * Math.min(1, b.age / 0.4) * 0.9;
      ctx.drawImage(art.bat, -b.size / 2, -b.size * art.batCenter, b.size, b.size);
    }
    ctx.setTransform(k, 0, 0, k, 0, 0);
  }

  private drawBall(): void {
    const ball = this.ball;
    if (!ball) return;
    const ctx = this.ctx;
    const { x, y, r } = ball;
    ctx.globalAlpha = this.master;
    ctx.fillStyle = 'rgba(6,12,24,0.3)';
    ctx.beginPath();
    ctx.arc(x + r * 0.15, y + r * 0.25, r, 0, TAU);
    ctx.fill();
    const grad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.7, '#eef4fb');
    grad.addColorStop(1, '#bccbdd');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
}
