/**
 * Sprites du décor de la popup pub (AdPopupCinemaRain).
 *
 * Chaque SVG est décodé puis rastérisé une seule fois par session, pour tous
 * ses plans de profondeur. Le travail est fait avant la popup, par petites
 * tranches pendant les temps morts (`preloadCinemaRainSprites()`), afin que
 * le décor soit complet dès la première image de l'animation d'ouverture.
 * Si la popup s'ouvre avant la fin, `{ urgent: true }` termine tout d'un bloc
 * et le décor fait apparaître tous les motifs ensemble.
 *
 * Deux catalogues : cinéma (par défaut) et Halloween (thème actif). Chacun
 * n'est préparé que s'il sert.
 */
import { CINEMA_CATALOG, type CinemaMotifCatalog } from '@/data/cinemaMotifs';
import type { CinemaMotif } from '@/types/cinemaMotifs';

export const DEPTH_PLANES = [
  { scale: 0.76, speed: 0.72, opacity: 0.3, blur: 1.4, iconBoost: 1 },
  { scale: 1, speed: 1, opacity: 0.46, blur: 0.55, iconBoost: 1.2 },
  { scale: 1.1, speed: 1.12, opacity: 0.6, blur: 0, iconBoost: 1.25 },
] as const;

/** Un projecteur reste au premier plan ou au plan médian. */
export const cinemaMotifDepth = (motif: CinemaMotif, index: number) => (
  motif.projection ? 1 + index % 2 : index % DEPTH_PLANES.length
);

const MOTIF_DEPTHS = [0, 1, 2] as const;
const PROJECTOR_DEPTHS = [1, 2] as const;
const depthsOf = (motif: CinemaMotif) => (motif.projection ? PROJECTOR_DEPTHS : MOTIF_DEPTHS);

interface SpriteSource {
  url: string;
  motif?: CinemaMotif;
}

const sourcesCache = new Map<CinemaMotifCatalog, readonly SpriteSource[]>();

const sourcesOf = (catalog: CinemaMotifCatalog): readonly SpriteSource[] => {
  let sources = sourcesCache.get(catalog);
  if (!sources) {
    sources = [
      ...catalog.motifs.map(motif => ({ url: motif.image, motif })),
      ...catalog.motifs.flatMap(motif => (motif.projection ? [{ url: motif.projection.image }] : [])),
    ];
    sourcesCache.set(catalog, sources);
  }
  return sources;
};

const imageCache = new Map<string, HTMLImageElement>();
const spriteCache = new Map<string, HTMLCanvasElement[]>();
const beamCache = new Map<string, HTMLCanvasElement>();

export const getCinemaSprite = (url: string, depth: number): HTMLCanvasElement | undefined => (
  spriteCache.get(url)?.[depth]
);

export const getCinemaBeam = (url: string): HTMLCanvasElement | undefined => beamCache.get(url);

const isSourceReady = ({ url, motif }: SpriteSource) => (
  motif ? depthsOf(motif).every(depth => spriteCache.get(url)?.[depth]) : beamCache.has(url)
);

export const areCinemaRainSpritesReady = (catalog: CinemaMotifCatalog = CINEMA_CATALOG) => (
  sourcesOf(catalog).every(isSourceReady)
);

const loadImage = (url: string) => {
  let image = imageCache.get(url);
  if (!image) {
    image = new Image();
    image.decoding = 'async';
    image.src = url;
    imageCache.set(url, image);
  }
  return image;
};

// HTMLImageElement.decode manque avant Chrome 64 (WebView et TV anciennes,
// GlitchTip DK) : attendre alors le chargement classique de l'image.
const decodeImage = (image: HTMLImageElement): Promise<void> => {
  if (typeof image.decode === 'function') return image.decode();
  if (image.complete) {
    return image.naturalWidth > 0 ? Promise.resolve() : Promise.reject(new Error('Image indisponible'));
  }
  return new Promise((resolve, reject) => {
    image.addEventListener('load', () => resolve(), { once: true });
    image.addEventListener('error', () => reject(new Error('Image indisponible')), { once: true });
  });
};

const prepareBeamSprite = (url: string, image: HTMLImageElement) => {
  if (beamCache.has(url) || !image.naturalWidth) return;
  const sprite = document.createElement('canvas');
  sprite.width = 512;
  sprite.height = 256;
  sprite.dataset.cinemaBeam = 'true';
  const context = sprite.getContext('2d');
  if (!context) return;
  context.drawImage(image, 0, 0, 512, 256);
  beamCache.set(url, sprite);
};

// Tous les plans sont rastérisés, y compris le plan net : aucun SVG n'est
// redessiné pendant l'animation. La résolution couvre aussi les écrans 2x.
const prepareSprite = (motif: CinemaMotif, image: HTMLImageElement, depth: number) => {
  let planes = spriteCache.get(motif.image);
  if (!planes) {
    planes = [];
    spriteCache.set(motif.image, planes);
  }
  // Pas de contrôle de naturalWidth : les SVG Phosphor n'ont qu'un viewBox,
  // et certains moteurs leur donnent alors une taille intrinsèque nulle.
  if (planes[depth]) return;
  const sprite = document.createElement('canvas');
  sprite.width = 128;
  sprite.height = 128;
  sprite.dataset.cinemaMotif = motif.id;
  const context = sprite.getContext('2d');
  if (!context) return;
  context.filter = `blur(${DEPTH_PLANES[depth].blur * 2}px)`;
  context.drawImage(image, 16, 16, 96, 96);
  planes[depth] = sprite;
};

type IdleHandle = { cancel: () => void };

// Safari et les navigateurs TV n'ont pas requestIdleCallback : une tranche
// courte après un délai laisse alors passer les frames de la page.
const requestIdle = (callback: (deadline?: IdleDeadline) => void): IdleHandle => {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(callback, { timeout: 1000 });
    return { cancel: () => window.cancelIdleCallback?.(id) };
  }
  const id = window.setTimeout(() => callback(), 50);
  return { cancel: () => window.clearTimeout(id) };
};

const IDLE_SLICE_MS = 4;

// Un préchargement en cours par catalogue : demander les motifs Halloween
// pendant celui du cinéma ne doit pas renvoyer la promesse du cinéma.
const inFlight = new Map<CinemaMotifCatalog, { promise: Promise<void>; hurry: () => void }>();

const runPreload = (sources: readonly SpriteSource[], onHurry: (hurry: () => void) => void) => new Promise<void>((resolve) => {
  const jobs: Array<() => void> = [];
  let decoding = sources.length;
  let urgent = false;
  let idle: IdleHandle | null = null;

  const settle = () => {
    if (decoding === 0 && jobs.length === 0) resolve();
  };

  const runJobs = (deadline?: IdleDeadline) => {
    idle = null;
    // Sans temps mort réel (délai dépassé ou repli setTimeout), une tranche
    // fixe évite de ne préparer qu'un sprite par rappel.
    const sliceEnd = performance.now() + IDLE_SLICE_MS;
    const hasTime = deadline && !deadline.didTimeout
      ? () => deadline.timeRemaining() > 1
      : () => performance.now() < sliceEnd;
    do {
      try {
        jobs.shift()?.();
      } catch {
        // Un sprite impossible à dessiner ne bloque pas la suite de la file.
      }
    } while (jobs.length > 0 && (urgent || hasTime()));
    if (jobs.length > 0) idle = requestIdle(runJobs);
    else settle();
  };

  const schedule = () => {
    if (urgent) runJobs();
    else idle ??= requestIdle(runJobs);
  };

  onHurry(() => {
    if (urgent) return;
    urgent = true;
    idle?.cancel();
    idle = null;
    if (jobs.length > 0) runJobs();
  });

  // Les SVG sont de petites data URI : les décoder en parallèle ne coûte rien,
  // seule la rastérisation (flou compris) est découpée en tranches.
  for (const source of sources) {
    const image = loadImage(source.url);
    decodeImage(image).then(() => {
      const { motif } = source;
      if (motif) depthsOf(motif).forEach(depth => jobs.push(() => prepareSprite(motif, image, depth)));
      else jobs.push(() => prepareBeamSprite(source.url, image));
    }, () => {
      // Un asset indisponible n'empêche pas les autres motifs ; il sera
      // retenté au prochain préchargement.
      imageCache.delete(source.url);
    }).finally(() => {
      decoding -= 1;
      if (jobs.length > 0) schedule();
      else settle();
    });
  }
});

/**
 * Prépare tous les sprites d'un catalogue (cinéma par défaut). Sans option,
 * le travail se fait pendant les temps morts ; `urgent` termine
 * immédiatement un préchargement en cours. La promesse se résout quand
 * chaque SVG a été préparé ou a échoué.
 */
export const preloadCinemaRainSprites = (
  { urgent = false, catalog = CINEMA_CATALOG }: { urgent?: boolean; catalog?: CinemaMotifCatalog } = {},
): Promise<void> => {
  let run = inFlight.get(catalog);
  if (!run) {
    const missing = sourcesOf(catalog).filter(source => !isSourceReady(source));
    if (missing.length === 0) return Promise.resolve();
    let hurry: () => void = () => {};
    const promise = runPreload(missing, (callback) => { hurry = callback; }).finally(() => {
      inFlight.delete(catalog);
    });
    run = { promise, hurry: () => hurry() };
    inFlight.set(catalog, run);
  }
  if (urgent) run.hurry();
  return run.promise;
};
