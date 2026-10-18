import { memo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import '@/styles/halloween-decor.css';
import fogBackUrl from '@/assets/halloween/fog-back.webp';
import fogMidUrl from '@/assets/halloween/fog-mid.webp';
import fogFrontUrl from '@/assets/halloween/fog-front.webp';
import {
  CANDY_KINDS,
  HalloweenCandy,
  HalloweenFlyingBat,
  HalloweenPumpkin,
  HalloweenSpider,
} from './HalloweenDecorArt';
import { HalloweenWitchFlight } from './HalloweenWitchFlight';

/**
 * Décor plein écran du thème Halloween, en trois calques comme sur les
 * maquettes :
 * - derrière le site : ciel de fumée, arbres morts et deux nappes de brume
 *   qui passent derrière le HeroSlider et les rangées ;
 * - devant : la grande branche de l'arbre de droite au-dessus du HeroSlider
 *   (accueil, en haut de page), bancs de fumée dans les coins bas,
 *   citrouilles éclairées, pluie de bonbons, sorcière et une nappe basse ;
 * - au-dessus de l'en-tête : toiles des coins, araignées et chauves-souris.
 * Module chargé à la demande par HalloweenAtmosphere : rien n'est téléchargé
 * tant que le thème est coupé.
 *
 * Toutes les animations ne touchent qu'à `transform` et `opacity` sur des
 * éléments HTML : la carte graphique les joue seule, sans recalcul de style
 * ni repeinture côté page.
 */

export type HalloweenPageKind = 'home' | 'details' | 'other';

type Rgb = readonly [number, number, number];

// Deux teintes de fumée par famille de pages : la brume glisse lentement de
// l'une à l'autre, et passe en 3 s à celles de la nouvelle page quand on
// navigue. Ce sont les tons du dessus éclairé des bouffées : le gris de la
// texture les assombrit dans les creux.
const FOG_COLORS: Record<HalloweenPageKind, readonly [Rgb, Rgb]> = {
  home: [[124, 138, 144], [132, 120, 152]],
  details: [[128, 116, 156], [112, 140, 132]],
  other: [[122, 126, 142], [136, 118, 150]],
};
const PAGE_FADE_MS = 3000;

// `phase` décale le cycle de couleur de chaque nappe (en secondes).
const FOG_LAYERS = [
  { name: 'back', src: fogBackUrl, phase: 0 },
  { name: 'mid', src: fogMidUrl, phase: 9 },
  { name: 'front', src: fogFrontUrl, phase: 17 },
] as const;

/**
 * Part de la seconde teinte à l'instant `t` (s) : 26 s dans un sens puis
 * 26 s dans l'autre, avec un palier de 30 % à chaque bout, jusqu'à 85 %.
 */
const SHIFT_PERIOD = 26;
const shiftAt = (t: number) => {
  const cycle = (t % (SHIFT_PERIOD * 2)) / SHIFT_PERIOD;
  const p = cycle <= 1 ? cycle : 2 - cycle;
  const k = Math.min(1, Math.max(0, (p - 0.3) / 0.4));
  return 0.85 * k * k * (3 - 2 * k);
};

const mix = (a: Rgb, b: Rgb, k: number): Rgb => [
  a[0] + (b[0] - a[0]) * k,
  a[1] + (b[1] - a[1]) * k,
  a[2] + (b[2] - a[2]) * k,
];
const css = ([r, g, b]: Rgb) => `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;

/** La brume ne change de teinte que sur grand écran, animations permises. */
const fogAnimates = () => !document.documentElement.hasAttribute('data-no-bg-anim')
  && !(typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 1023px), (pointer: coarse)').matches);

const textures = new Map<string, Promise<HTMLImageElement>>();

const loadTexture = (src: string) => {
  let texture = textures.get(src);
  if (!texture) {
    texture = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    });
    textures.set(src, texture);
  }
  return texture;
};

/**
 * Peint la texture de brume (fumée grise) en deux tuiles côte à côte,
 * teintée, puis la confie au canvas affiché. La teinte multiplie le gris de
 * la texture (le dessus éclairé des bouffées reste plus clair que les creux),
 * puis la transparence de la texture est rétablie. Avec le contexte
 * « bitmaprenderer », le navigateur garde l'image à sa taille propre
 * (2048 px de large) et la carte graphique l'étire sur la bande de deux
 * écrans : la mémoire ne dépend ni de la taille ni de la densité de l'écran,
 * et rien n'est repeint entre deux changements de teinte.
 */
const paintFog = async (canvas: HTMLCanvasElement, work: HTMLCanvasElement, image: HTMLImageElement, color: string) => {
  const width = image.naturalWidth * 2;
  if (work.width !== width) work.width = width;
  if (work.height !== image.naturalHeight) work.height = image.naturalHeight;
  const context = work.getContext('2d');
  if (!context) return;
  const tiles = () => {
    context.drawImage(image, 0, 0);
    context.drawImage(image, image.naturalWidth, 0);
  };
  context.globalCompositeOperation = 'source-over';
  context.clearRect(0, 0, work.width, work.height);
  tiles();
  context.globalCompositeOperation = 'multiply';
  context.fillStyle = color;
  context.fillRect(0, 0, work.width, work.height);
  context.globalCompositeOperation = 'destination-in';
  tiles();
  context.globalCompositeOperation = 'source-over';

  const renderer = typeof createImageBitmap === 'function' ? canvas.getContext('bitmaprenderer') : null;
  if (renderer) {
    renderer.transferFromImageBitmap(await createImageBitmap(work));
    return;
  }
  // Navigateur sans bitmaprenderer : copie dans le canvas affiché.
  if (canvas.width !== work.width) canvas.width = work.width;
  if (canvas.height !== work.height) canvas.height = work.height;
  const visible = canvas.getContext('2d');
  visible?.clearRect(0, 0, canvas.width, canvas.height);
  visible?.drawImage(work, 0, 0);
};

/**
 * Teinte des trois nappes de brume. Un seul canvas par nappe : la carte
 * graphique n'a que trois bandes à superposer à chaque image (au lieu de six
 * avec un fondu entre deux calques). La teinte est recalculée toutes les 2 s
 * (quatre fois par seconde pendant un changement de page), et seulement si
 * elle a changé : chaque passage coûte ~3 ms, et un écart de couleur de 2 s
 * reste invisible sur une brume à moitié transparente. Sur mobile ou
 * animations coupées, elle n'est peinte qu'au besoin.
 */
const useFogTint = (pageKind: HalloweenPageKind) => {
  const canvases = useRef<Record<string, HTMLCanvasElement | null>>({});
  const fade = useRef<{ from: readonly [Rgb, Rgb]; to: readonly [Rgb, Rgb]; start: number } | null>(null);

  useEffect(() => {
    const now = performance.now();
    const previous = fade.current;
    const current = previous ? pairAt(previous, now) : FOG_COLORS[pageKind];
    fade.current = { from: current, to: FOG_COLORS[pageKind], start: now };

    const works = new Map<string, HTMLCanvasElement>();
    const painted = new Map<string, string>();
    let timer = 0;
    let cancelled = false;

    const tick = async () => {
      const at = performance.now();
      const state = fade.current;
      if (!state) return;
      const pair = pairAt(state, at);
      const animate = fogAnimates();
      for (const layer of FOG_LAYERS) {
        const canvas = canvases.current[layer.name];
        if (!canvas) continue;
        let image: HTMLImageElement;
        try {
          image = await loadTexture(layer.src);
        } catch {
          continue; // Texture indisponible : cette nappe reste vide.
        }
        if (cancelled) return;
        const color = css(mix(pair[0], pair[1], animate ? shiftAt(at / 1000 + layer.phase) : 0));
        if (painted.get(layer.name) === color) continue;
        painted.set(layer.name, color);
        let work = works.get(layer.name);
        if (!work) {
          work = document.createElement('canvas');
          works.set(layer.name, work);
        }
        await paintFog(canvas, work, image, color);
        if (cancelled) return;
      }
      const fading = at - state.start < PAGE_FADE_MS;
      if (animate || fading) timer = window.setTimeout(tick, fading ? 250 : 2000);
    };
    void tick();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      works.forEach((work) => { work.width = 0; work.height = 0; });
    };
  }, [pageKind]);

  return canvases;
};

function pairAt(fade: { from: readonly [Rgb, Rgb]; to: readonly [Rgb, Rgb]; start: number }, now: number): readonly [Rgb, Rgb] {
  const k = Math.min(1, Math.max(0, (now - fade.start) / PAGE_FADE_MS));
  return [mix(fade.from[0], fade.to[0], k), mix(fade.from[1], fade.to[1], k)];
}

const FogLayer = ({ name, canvases }: { name: string; canvases: { current: Record<string, HTMLCanvasElement | null> } }) => (
  <div className={`halloween-fog halloween-fog-${name}`}>
    <canvas ref={(canvas) => { canvases.current[name] = canvas; }} className="halloween-fog-tint" />
  </div>
);

// Chauves-souris qui traversent le haut de l'écran l'une après l'autre,
// dans les deux sens ; hors de l'écran le reste du cycle.
const BATS = [
  { top: '10%', size: 40, duration: '24s', delay: '-3s', reverse: false },
  { top: '18%', size: 28, duration: '31s', delay: '-17s', reverse: true },
  { top: '6%', size: 34, duration: '38s', delay: '-29s', reverse: false },
];

// Pluie de bonbons : positions, tailles et vitesses fixes (pas de
// Math.random au rendu). Douze bonbons : chaque animation en plus se paie à
// chaque image calculée par la page.
const CANDY_DROPS = Array.from({ length: 12 }, (_, i) => ({
  kind: i % CANDY_KINDS,
  left: `${(i * 41 + 9) % 97}%`,
  size: 24 + (i * 7) % 12,
  duration: `${13 + (i * 5) % 9}s`,
  delay: `-${(i * 17) % 21}s`,
  drift: `${(i % 3 ? 1 : -1) * (25 + (i * 13) % 45)}px`,
  spin: `${(i % 2 ? 1 : -1) * (200 + (i * 53) % 300)}deg`,
}));

/** Posé sur <html> en haut d'une page à HeroSlider (halloween-ui.css). */
const TOP_OF_PAGE_ATTR = 'data-halloween-top';
/**
 * Posé sur <html> tant que le décor est monté : sur mobile, les toiles des
 * coins sont dessinées dans l'en-tête (halloween-decor.css), et la feuille
 * reste chargée après le passage en mode léger ou sur un lecteur.
 */
const DECOR_ATTR = 'data-halloween-decor';

/**
 * Haut d'une page à HeroSlider. L'arbre de droite y passe devant le site :
 * sa grande branche couvre le HeroSlider, comme sur la maquette. Une copie
 * identique, à la même place, reste derrière le site : passé le haut de
 * page, celle de devant s'efface et l'arbre semble repasser derrière les
 * rangées au lieu de couvrir les affiches. L'en-tête, lui, n'allège son
 * dégradé qu'en haut de page, quand rien ne défile encore dessous. Écoute
 * passive, une mesure par image au plus, et rien ne change entre deux
 * passages du seuil.
 */
const useTopOfPage = (tree: { current: HTMLElement | null }, enabled: boolean) => {
  useEffect(() => {
    const element = tree.current;
    if (!enabled || !element) return;
    const root = document.documentElement;
    let frame = 0;
    let behind: boolean | null = null;
    const update = () => {
      frame = 0;
      const next = window.scrollY > window.innerHeight * 0.3;
      if (next === behind) return;
      behind = next;
      element.classList.toggle('is-behind', next);
      // Pas de toggleAttribute : absent avant Chrome 69 (Android 8 et
      // vieilles WebView), il faisait planter tout le décor.
      if (next) root.removeAttribute(TOP_OF_PAGE_ATTR);
      else root.setAttribute(TOP_OF_PAGE_ATTR, '');
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
      root.removeAttribute(TOP_OF_PAGE_ATTR);
    };
  }, [tree, enabled]);
};

const HalloweenDecor = ({ pageKind }: { pageKind: HalloweenPageKind }) => {
  const fog = useFogTint(pageKind);
  const frontTree = useRef<HTMLDivElement>(null);
  // Accueil et catalogues : la page s'ouvre sur un HeroSlider.
  const heroPage = pageKind === 'home';
  useTopOfPage(frontTree, heroPage);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute(DECOR_ATTR, '');
    return () => root.removeAttribute(DECOR_ATTR);
  }, []);

  // Portée dans <body> : en plein écran, seul l'élément plein écran est
  // peint, le décor s'efface de lui-même.
  return createPortal(
    <>
      {/* Derrière le site (z-index négatif) : visible dans les marges, entre
          les rangées et autour du HeroSlider, dont le fond est opaque. Comme
          sur la maquette, les arbres se détachent sur la grande nappe et la
          nappe du milieu passe devant eux. */}
      <div className="halloween-backdrop" aria-hidden="true">
        <FogLayer name={FOG_LAYERS[0].name} canvases={fog} />
        <div className="halloween-tree halloween-tree-left" />
        <div className="halloween-tree halloween-tree-right" />
        <FogLayer name={FOG_LAYERS[1].name} canvases={fog} />
        {/* Pendue à la branche basse de l'arbre de gauche, devant la brume. */}
        <HalloweenSpider className="halloween-spider halloween-spider-tree" thread="2.4vh" />
      </div>
      <div className="halloween-atmosphere" aria-hidden="true">
        {heroPage && <div ref={frontTree} className="halloween-tree halloween-tree-right halloween-tree-front" />}
        <span className="halloween-smoke halloween-smoke-left" />
        <span className="halloween-smoke halloween-smoke-right" />
        {/* La petite, sans visage, attend derrière la grande. */}
        <HalloweenPumpkin className="halloween-pumpkin halloween-pumpkin-small" />
        <HalloweenPumpkin className="halloween-pumpkin halloween-pumpkin-left" face="grin" />
        <HalloweenPumpkin className="halloween-pumpkin halloween-pumpkin-right" face="sly" />
        <div className="halloween-particles">
          {CANDY_DROPS.map((drop, i) => (
            <span
              key={i}
              className="halloween-candy"
              style={{
                left: drop.left,
                width: drop.size,
                height: drop.size,
                animationDuration: drop.duration,
                animationDelay: drop.delay,
                ['--drift' as string]: drop.drift,
                ['--spin' as string]: drop.spin,
              }}
            >
              <HalloweenCandy kind={drop.kind} />
            </span>
          ))}
        </div>
        {/* Traverse le ciel de gauche à droite, puis environ 5 s d'absence ;
            sur mobile, un passage sur deux lignes toutes les 30 s. Attrapée
            au vol, elle lâche des bonbons et file, vexée. */}
        <HalloweenWitchFlight />
        <FogLayer name={FOG_LAYERS[2].name} canvases={fog} />
      </div>
      <div className="halloween-overhead" aria-hidden="true">
        <div className="halloween-web halloween-web-left" />
        <div className="halloween-web halloween-web-right" />
        {/* Chacune pend à une jonction de fils de sa toile : braise orange à
            gauche, lavande à droite, comme sur la maquette. */}
        <HalloweenSpider className="halloween-spider halloween-spider-left" tone="ember" thread="calc(var(--web-w) * 1.25)" />
        <HalloweenSpider className="halloween-spider halloween-spider-right" tone="ghost" thread="calc(var(--web-w) * 1.09)" />
        {BATS.map((bat, i) => (
          <span
            key={i}
            className="halloween-bat"
            style={{
              top: bat.top,
              width: bat.size,
              animationDuration: bat.duration,
              animationDelay: bat.delay,
              animationDirection: bat.reverse ? 'reverse' : 'normal',
            }}
          >
            <HalloweenFlyingBat />
          </span>
        ))}
      </div>
    </>,
    document.body,
  );
};

// Ne se redessine que si la famille de pages change (couleur de la brume).
export default memo(HalloweenDecor);
