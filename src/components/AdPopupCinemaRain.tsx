/**
 * Particules adaptées de P-Stream / Lightbar.tsx, sous AGPL-3.0.
 * Source, licence et adaptations : @/assets/pstream-lightbar/CREDITS.md.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLightMode } from '@/context/LightModeContext';
import { CINEMA_CATALOG, createCinemaMotifSequence, type CinemaMotifCatalog } from "@/data/cinemaMotifs";
import { readHalloweenTheme } from '@/hooks/useHalloweenTheme';
import type { CinemaMotif } from "@/types/cinemaMotifs";
import { fitCanvasBitmapSize, isCanvasInvalidStateError } from '@/utils/canvasSizing';
import {
  DEPTH_PLANES,
  areCinemaRainSpritesReady,
  cinemaMotifDepth,
  getCinemaBeam,
  getCinemaSprite,
  preloadCinemaRainSprites,
} from '@/utils/cinemaRainSprites';

interface LightbarOptions {
  motif?: CinemaMotif;
  sizeRange?: readonly [number, number];
  depth?: number;
}

interface ReadableRegion {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const TEXT_REGION_OPACITY = 0.14;
const POINT_OPACITY_SCALE = 0.8;
// Fondu commun des motifs lorsque leurs sprites arrivent après l'ouverture.
const MOTIF_REVEAL_MS = 280;

const readabilityAt = (x: number, y: number, regions: ReadableRegion[], radius = 0) => {
  let opacity = 1;
  for (const region of regions) {
    const dx = Math.max(region.left - x, 0, x - region.right);
    const dy = Math.max(region.top - y, 0, y - region.bottom);
    const distance = Math.min(1, Math.max(0, Math.hypot(dx, dy) - radius) / 32);
    const falloff = distance * distance * (3 - 2 * distance);
    opacity = Math.min(opacity, TEXT_REGION_OPACITY + (1 - TEXT_REGION_OPACITY) * falloff);
  }
  return opacity;
};

// `width` est la largeur logique du champ : deux fois celle de la popup,
// comme le canvas d'origine. Seule sa moitié centrale est visible.
class Particle {
  x = 0;

  y = 0;

  radius = 0;

  direction = 0;

  speed = 0;

  lifetime = 0;

  ran = 0;

  size = 10;

  options: LightbarOptions;

  constructor(
    width: number,
    options: LightbarOptions = {
      sizeRange: [10, 15],
    },
  ) {
    this.options = options;

    this.reset(width);
    this.initialize(width);
  }

  reset(width: number) {
    this.x = Math.round((Math.random() * width) / 2 + width / 4);
    this.y = Math.random() * 100 + 5;

    this.radius = 1 + Math.floor(Math.random() * 0.5);
    this.direction = (Math.random() * Math.PI) / 2 + Math.PI / 4;
    const depth = DEPTH_PLANES[this.options.depth ?? 1];
    this.speed = (0.02 + Math.random() * 0.085) * depth.speed;

    const second = 65;
    this.lifetime = second * 3 + Math.random() * (second * 30);

    this.size = this.options.sizeRange
      ? Math.random() *
          (this.options.sizeRange[1] - this.options.sizeRange[0]) +
        this.options.sizeRange[0]
      : 10;
    this.size *= depth.scale;

    this.ran = 0;
  }

  initialize(width: number) {
    this.ran = Math.random() * this.lifetime;
    const baseSpeed = this.speed;
    this.speed = Math.random() * this.lifetime * baseSpeed;
    this.update(width);
    this.speed = baseSpeed;
  }

  rotation() {
    return this.direction - Math.PI + (this.options.motif?.projection ? Math.PI / 2 : 0);
  }

  visualCenter() {
    const offset = this.options.motif ? this.size * 1.5 : 0;
    return { x: this.x - Math.sin(this.rotation()) * offset, y: this.y + Math.cos(this.rotation()) * offset };
  }

  /** Espacement à la naissance seulement : aucune répulsion ni secousse pendant la chute. */
  avoidOverlap(width: number, particles: readonly Particle[], prefilled: boolean) {
    if (!this.options.motif) return;
    const neighbors = particles.filter(particle => particle !== this && particle.options.motif);
    if (neighbors.length === 0) return;
    const velocityX = this.speed * Math.cos(this.direction);
    const velocityY = this.speed * Math.sin(this.direction);
    const clearance = () => {
      const center = this.visualCenter();
      let nearest = Infinity;
      for (const other of neighbors) {
        const target = other.visualCenter();
        const dx = center.x - target.x, dy = center.y - target.y;
        const vx = velocityX - other.speed * Math.cos(other.direction);
        const vy = velocityY - other.speed * Math.sin(other.direction);
        // Anticipe le rapprochement pendant les quatre prochaines secondes,
        // ou jusqu'à la disparition de l'une des deux silhouettes.
        const horizon = Math.max(0, Math.min(240, this.lifetime - this.ran, other.lifetime - other.ran));
        const speedSquared = vx * vx + vy * vy;
        const time = speedSquared > 0 ? Math.max(0, Math.min(horizon, -(dx * vx + dy * vy) / speedSquared)) : 0;
        nearest = Math.min(nearest, Math.hypot(dx + vx * time, dy + vy * time) - (this.size + other.size) * 0.6 - 4);
      }
      return nearest;
    };
    let best = { x: this.x, y: this.y, clearance: clearance() };
    for (let attempt = 0; attempt < 16 && best.clearance < 0; attempt += 1) {
      const center = this.visualCenter();
      this.x += width / 4 + Math.random() * width / 2 - center.x;
      this.y += Math.random() * (prefilled ? 180 : 100) - center.y;
      const score = clearance();
      if (score > best.clearance) best = { x: this.x, y: this.y, clearance: score };
    }
    this.x = best.x;
    this.y = best.y;
  }

  update(width: number, delta = 1, particles: readonly Particle[] = []) {
    this.ran += delta;

    const addX = this.speed * Math.cos(this.direction);
    const addY = this.speed * Math.sin(this.direction);
    this.x += addX * delta;
    this.y += addY * delta;

    if (this.ran > this.lifetime) {
      this.reset(width);
      this.avoidOverlap(width, particles, false);
    }
  }

  render(ctx: CanvasRenderingContext2D, regions: ReadableRegion[], reveal: number) {
    const motif = this.options.motif;
    const depthIndex = this.options.depth ?? 1;
    const sprite = motif ? getCinemaSprite(motif.image, depthIndex) : undefined;
    // Les motifs attendent leur sprite et apparaissent tous ensemble ; les
    // points lumineux sont dessinés dès la première image.
    if (motif && (!sprite || reveal <= 0)) return;

    ctx.save();
    ctx.beginPath();

    const x = this.ran / this.lifetime;
    const o = (x - x * x) * 4;
    const depth = DEPTH_PLANES[depthIndex];
    // P-Stream dessine l'image sous son origine, puis la fait tourner : le
    // masque suit sa surface visible, pas seulement ce point d'ancrage.
    // Un projecteur reste proche de l'horizontale : sa lentille et son cône
    // sont reconnaissables, tout en suivant le même mouvement de chute.
    const rotation = this.rotation();
    const center = this.visualCenter();
    const baseOpacity = Math.max(0, o * 0.8) * depth.opacity * (motif ? reveal : 1);
    const visibility = readabilityAt(
      center.x,
      center.y,
      regions,
      motif ? this.size * Math.SQRT1_2 : this.radius * 1.5,
    );
    // Le renfort disparaît dans les zones de lecture : leur opacité reste identique.
    const iconBoost = 1 + (depth.iconBoost - 1) * (visibility - TEXT_REGION_OPACITY) / (1 - TEXT_REGION_OPACITY);
    ctx.globalAlpha = baseOpacity * visibility * (motif ? iconBoost : POINT_OPACITY_SCALE);

    if (sprite) {
      ctx.translate(this.x, this.y);
      const w = this.size;
      const h = w; // Les quinze motifs du catalogue ont un viewBox carré.
      ctx.rotate(rotation);
      const projection = this.options.motif?.projection;
      const beam = projection ? getCinemaBeam(projection.image) : undefined;
      if (projection && beam) {
        // Le cône partage exactement la transformation de l'objectif. Son
        // emprise est atténuée séparément lorsqu'il traverse une zone de texte.
        const originX = -w / 2 + projection.origin[0] * w;
        const originY = h + projection.origin[1] * w;
        const length = projection.length * w;
        const halfWidth = projection.halfWidth * w;
        const centerX = originX + length / 2;
        const centerY = originY;
        const visibility = readabilityAt(
          this.x + Math.cos(rotation) * centerX - Math.sin(rotation) * centerY,
          this.y + Math.sin(rotation) * centerX + Math.cos(rotation) * centerY,
          regions,
          Math.hypot(length / 2, halfWidth),
        );
        ctx.save();
        ctx.globalAlpha = baseOpacity * 0.85 * visibility;
        ctx.globalCompositeOperation = "screen";
        // Zone utile du SVG de lumière : x=24..488, y=128±104.
        ctx.drawImage(beam, originX - length * 24 / 464, originY - halfWidth * 128 / 104,
          length * 512 / 464, halfWidth * 256 / 104);
        ctx.restore();
      }
      const padding = w / 6;
      ctx.drawImage(sprite, -w / 2 - padding, h - padding, h + padding * 2, w + padding * 2);
    } else {
      ctx.ellipse(
        this.x,
        this.y,
        this.radius,
        this.radius * 1.5,
        this.direction,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = "white";
      ctx.fill();
    }
    ctx.restore();
  }
}

// Preset cinéma de P-Stream, réparti sur trois plans de profondeur.
const PARTICLE_COUNT = 265;
const IMAGE_PARTICLE_COUNT = Math.floor(PARTICLE_COUNT / 7.85) + 1;

// Thème Halloween : bonbons, chauves-souris, araignées et lanterne à la place
// des motifs cinéma. Le catalogue (et ses SVG) n'est téléchargé que si le
// thème est activé, puis gardé pour la session. On lit le réglage et non la
// classe du thème : celle-ci est retirée sur la page du lecteur, là même où
// la popup s'ouvre le plus souvent.
let halloweenCatalog: CinemaMotifCatalog | null = null;
const halloweenActive = readHalloweenTheme;

const AdPopupCinemaRain = ({ unlocked = false }: { unlocked?: boolean }) => {
  const { effectivePrefs } = useLightMode();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const measureRef = useRef<(() => void) | null>(null);
  const [catalogReady, setCatalogReady] = useState(() => !halloweenActive() || halloweenCatalog !== null);

  useLayoutEffect(() => { measureRef.current?.(); }, [unlocked]);

  useEffect(() => {
    if (catalogReady) return;
    let cancelled = false;
    import('@/data/halloweenMotifs')
      .then(({ HALLOWEEN_CATALOG }) => { halloweenCatalog = HALLOWEEN_CATALOG; })
      .catch(() => { /* Réseau coupé : pluie cinéma habituelle. */ })
      .finally(() => { if (!cancelled) setCatalogReady(true); });
    return () => { cancelled = true; };
  }, [catalogReady]);

  useEffect(() => {
    if (!effectivePrefs.bgAnimations || !catalogReady) return;
    const catalog = halloweenActive() && halloweenCatalog ? halloweenCatalog : CINEMA_CATALOG;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const particles: Particle[] = [];
    let frame: number | null = null;
    let previousTime = 0;
    let fieldWidth = 0;
    let canvasLayout = '';
    let measured = false;
    let regions: ReadableRegion[] = [];
    let disposed = false;
    let hasDrawn = false;
    // Sprites préchargés : motifs visibles dès la première image. Sinon, la
    // préparation est terminée d'un bloc et tous les motifs entrent ensemble.
    let motifsRevealedAt: number | null = areCinemaRainSpritesReady(catalog) ? -Infinity : null;
    let motifsRequested = false;
    const dialog = canvas.closest('[role="dialog"]');

    const measure = () => {
      if (reducedMotion.matches) return;
      const cssWidth = canvas.clientWidth;
      const cssHeight = canvas.clientHeight;
      const size = fitCanvasBitmapSize(cssWidth, cssHeight, Math.min(window.devicePixelRatio || 1, 2));
      if (!size) {
        measured = false;
        return;
      }
      // Grouper les lectures avant de redimensionner le canvas.
      const bounds = canvas.getBoundingClientRect();
      if (!bounds.width) {
        measured = false;
        return;
      }
      const scale = cssWidth / bounds.width;
      // Le canvas ne couvre que la moitié visible du champ logique : ses
      // coordonnées sont décalées d'une demi-largeur de popup.
      const offsetX = cssWidth / 2;
      regions = Array.from(dialog?.querySelectorAll('[data-ad-copy]') ?? []).map(element => {
        const rect = element.getBoundingClientRect();
        return {
          left: (rect.left - bounds.left) * scale + offsetX - 16,
          right: (rect.right - bounds.left) * scale + offsetX + 16,
          top: (rect.top - bounds.top) * scale - 20,
          bottom: (rect.bottom - bounds.top) * scale + 16,
        };
      });
      const nextFieldWidth = cssWidth * 2;
      const layout = `${size.width}x${size.height}:${cssWidth}x${cssHeight}`;
      if (layout !== canvasLayout) {
        if (fieldWidth > 0) {
          const scaleX = nextFieldWidth / fieldWidth;
          for (const particle of particles) particle.x *= scaleX;
        }
        try {
          canvas.width = size.width;
          canvas.height = size.height;
          const context = canvas.getContext('2d');
          context?.setTransform(size.scaleX, 0, 0, size.scaleY, -offsetX * size.scaleX, 0);
        } catch (error) {
          if (!isCanvasInvalidStateError(error)) throw error;
          canvas.width = 0;
          canvas.height = 0;
          canvasLayout = '';
          measured = false;
          return;
        }
        canvasLayout = layout;
      }
      fieldWidth = nextFieldWidth;
      measured = true;
    };
    measureRef.current = measure;

    const stop = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      previousTime = 0;
    };

    // Secours si la popup s'ouvre avant la fin du préchargement : le reste est
    // préparé tout de suite, puis les motifs entrent ensemble en fondu (sans
    // fondu si rien n'a encore été dessiné).
    const requestMotifs = () => {
      if (motifsRevealedAt !== null || motifsRequested) return;
      motifsRequested = true;
      void preloadCinemaRainSprites({ urgent: true, catalog }).then(() => {
        if (!disposed) motifsRevealedAt = hasDrawn ? performance.now() : -Infinity;
      });
    };

    const particlesLoop = (time: number) => {
      frame = null;
      if (!measured) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Le premier dessin est synchrone : la frame suivante peut porter un
      // horodatage antérieur, d'où le plancher à zéro.
      const delta = previousTime ? Math.max(0, Math.min((time - previousTime) / (1000 / 60), 3)) : 1;
      previousTime = time;
      const reveal = motifsRevealedAt === null
        ? 0
        : Math.min(1, Math.max(0, (time - motifsRevealedAt) / MOTIF_REVEAL_MS));
      try {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
        for (const particle of particles) {
          particle.update(fieldWidth, delta, particles);
          particle.render(ctx, regions, reveal);
        }
      } catch (error) {
        if (!isCanvasInvalidStateError(error)) throw error;
        canvas.width = 0;
        canvas.height = 0;
        canvasLayout = '';
        measured = false;
        return;
      }
      hasDrawn = true;
      frame = requestAnimationFrame(particlesLoop);
    };

    const syncActivity = () => {
      stop();
      if (!measured || document.hidden || reducedMotion.matches || !canvas.getContext("2d")) return;

      if (particles.length === 0) {
        const motifs = createCinemaMotifSequence(IMAGE_PARTICLE_COUNT, Math.random, catalog);
        for (let i = 0; i < PARTICLE_COUNT; i += 1) {
          const motif = motifs[i];
          const particle = new Particle(fieldWidth, {
            motif,
            sizeRange: motif?.sizeRange,
            depth: motif ? cinemaMotifDepth(motif, i) : i % DEPTH_PLANES.length,
          });
          particle.avoidOverlap(fieldWidth, particles, true);
          particles.push(particle);
        }
        particles.sort((a, b) => (a.options.depth ?? 1) - (b.options.depth ?? 1));
      }

      requestMotifs();
      // Appelé depuis le ResizeObserver, ce dessin entre dans la même frame
      // que le premier rendu de la popup : le décor est là dès l'ouverture.
      particlesLoop(performance.now());
    };

    const handleReducedMotionChange = () => {
      if (!reducedMotion.matches && !measured) measure();
      syncActivity();
    };

    document.addEventListener("visibilitychange", syncActivity);
    const legacyReducedMotion = reducedMotion as MediaQueryList & {
      addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
      removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
    };
    if (typeof reducedMotion.addEventListener === 'function') {
      reducedMotion.addEventListener("change", handleReducedMotionChange);
    } else {
      legacyReducedMotion.addListener?.(handleReducedMotionChange);
    }
    // La première mesure suit le layout natif via ResizeObserver. Une lecture
    // synchrone au montage forcerait le layout de la page derrière le dialog.
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
        measure();
        if (frame === null) syncActivity();
      });
    observer?.observe(canvas);
    if (dialog) observer?.observe(dialog);
    dialog?.querySelectorAll('[data-ad-copy]').forEach(element => observer?.observe(element));
    const handleWindowResize = () => {
      measure();
      if (frame === null) syncActivity();
    };
    if (!observer) {
      window.addEventListener('resize', handleWindowResize, { passive: true });
      measure();
    }
    syncActivity();

    return () => {
      disposed = true;
      stop();
      observer?.disconnect();
      window.removeEventListener('resize', handleWindowResize);
      measureRef.current = null;
      document.removeEventListener("visibilitychange", syncActivity);
      if (typeof reducedMotion.removeEventListener === 'function') {
        reducedMotion.removeEventListener("change", handleReducedMotionChange);
      } else {
        legacyReducedMotion.removeListener?.(handleReducedMotionChange);
      }
    };
  }, [effectivePrefs.bgAnimations, catalogReady]);

  if (!effectivePrefs.bgAnimations) return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 select-none overflow-hidden rounded-2xl"
    >
      <div
        data-cinema-lightbar
        className="absolute inset-x-0 top-0 h-48 bg-[radial-gradient(ellipse_85%_110%_at_50%_-25%,rgba(96,165,250,0.44),rgba(59,130,246,0.08)_50%,transparent_76%)]"
      />
      <div data-cinema-line className="absolute inset-x-[20%] top-0 h-px bg-gradient-to-r from-transparent via-blue-200/70 to-transparent" />
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-x-0 top-0 h-[300px] w-full motion-reduce:hidden" />
      {unlocked && (
        <div
          data-cinema-unlocked
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_5%,rgba(96,165,250,0.24),transparent_65%)] opacity-0 motion-safe:animate-ad-unlocked-glow"
        />
      )}
    </div>
  );
};

export default AdPopupCinemaRain;
