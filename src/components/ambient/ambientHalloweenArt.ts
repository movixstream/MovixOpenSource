// Dessins du thème Halloween de Movix, repris tels quels pour l'effet
// d'ambiance : les bonbons du décor, la citrouille, la chauve-souris et le
// fantôme de brume. Module chargé à la demande, seulement quand l'effet
// Halloween est coché.
import candyCorn from '@/assets/halloween/motifs/candy-corn.svg';
import candyOrange from '@/assets/halloween/motifs/candy-orange.svg';
import candyPurple from '@/assets/halloween/motifs/candy-purple.svg';
import lollipop from '@/assets/halloween/motifs/lollipop.svg';
import mint from '@/assets/halloween/motifs/mint.svg';
import eyeball from '@/assets/halloween/motifs/eyeball.svg';
import worm from '@/assets/halloween/motifs/worm.svg';
import pumpkinCandy from '@/assets/halloween/motifs/pumpkin-candy.svg';
import jackOLantern from '@/assets/halloween/motifs/jack-o-lantern.svg';
import bat from '@/assets/halloween/motifs/bat.svg';
import ghost from '@/assets/halloween/ghost.webp';

export interface HalloweenArt {
  /** Un canvas carré par sorte de bonbon. */
  candies: HTMLCanvasElement[];
  pumpkin: HTMLCanvasElement;
  bat: HTMLCanvasElement;
  ghost: HTMLCanvasElement;
  /** Largeur du fantôme rapportée à sa hauteur. */
  ghostRatio: number;
  /** Place du corps de la citrouille dans son cadre carré : son centre et son pied, en part de la hauteur. */
  pumpkinCenter: number;
  pumpkinFoot: number;
  /** Hauteur du corps de la chauve-souris dans son cadre carré. */
  batCenter: number;
}

const CANDIES = [candyCorn, candyOrange, candyPurple, lollipop, mint, eyeball, worm, pumpkinCandy];

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image illisible : ${url.slice(0, 60)}`));
    img.src = url;
  });
}

/** Image collée une fois dans un canvas : un SVG n'est plus retracé à chaque image. */
async function raster(url: string, height: number): Promise<HTMLCanvasElement> {
  const img = await load(url);
  const ratio = img.naturalWidth > 0 && img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 1;
  const c = document.createElement('canvas');
  c.height = height;
  c.width = Math.round(height * ratio);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

export async function loadHalloweenArt(): Promise<HalloweenArt> {
  const [candies, pumpkin, batArt, ghostArt] = await Promise.all([
    Promise.all(CANDIES.map((url) => raster(url, 64))),
    raster(jackOLantern, 144),
    raster(bat, 96),
    raster(ghost, 320),
  ]);
  return {
    candies, pumpkin, bat: batArt, ghost: ghostArt, ghostRatio: ghostArt.width / ghostArt.height,
    pumpkinCenter: 0.567, pumpkinFoot: 0.9, batCenter: 0.49,
  };
}
