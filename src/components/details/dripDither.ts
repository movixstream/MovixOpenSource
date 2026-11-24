import type { CSSProperties } from 'react';

/** Côté de la tuile de bruit, en pixels de l'écran. */
const TILE = 128;
/** Plus forte éclaircie du voile : 4/255 de son opacité. */
const DEPTH = 4;

let cached: CSSProperties | null | undefined;

/**
 * Tramage de la fin de la coulure, à poser sur son voile
 * (`DETAILS_HERO_DRIP_FADE`).
 *
 * L'écran n'affiche que des couleurs entières. Tout près du noir, la coulure
 * finit donc par des marches : une bande au niveau 1 sur 255, puis 0. Sur un
 * écran OLED, 0 éteint les pixels : la ligne où ils s'éteignent se voit, quelle
 * que soit la courbe du voile.
 *
 * Le masque éclaircit le voile de 0 à 4/255 de son opacité, au hasard d'un
 * pixel à l'autre. C'est fait avant que l'écran n'arrondisse : chaque pixel
 * passe d'une marche à la suivante un peu plus haut ou plus bas que ses
 * voisins, et la ligne devient un passage en pointillés. L'effet suit
 * l'opacité du voile : nul en haut, sur l'image, plein dans la coulure. Un
 * dégradé ajouté au masque l'éteint sur les 100 derniers pixels, pour que le
 * bas reste noir franc.
 *
 * Bruit à gradient entrelacé : réparti plus régulièrement qu'un tirage au
 * hasard, il ne forme pas de grumeaux. Une tuile par pixel de l'écran ; rien
 * hors du navigateur.
 */
export function dripDitherMask(): CSSProperties | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (typeof document === 'undefined') return cached;
  const canvas = document.createElement('canvas');
  canvas.width = TILE;
  canvas.height = TILE;
  const context = canvas.getContext('2d');
  if (!context) return cached;
  const pixels = context.createImageData(TILE, TILE);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const noise = (52.9829189 * ((0.06711056 * x + 0.00583715 * y) % 1)) % 1;
      // Noir opaque, moins 0 à 4/255 : seul l'alpha compte dans un masque.
      pixels.data[(y * TILE + x) * 4 + 3] = 255 - Math.min(DEPTH, Math.floor(noise * (DEPTH + 1)));
    }
  }
  context.putImageData(pixels, 0, 0);
  const tile = `${TILE / (window.devicePixelRatio || 1)}px`;
  // Calques fusionnés par `add` (source-over) : masque = 1 - bruit × (1 - dégradé).
  // Le dégradé monte jusqu'au plein sur les 100 derniers pixels : le bruit y
  // décroît jusqu'à rien.
  const image = `url(${canvas.toDataURL('image/png')}), linear-gradient(to bottom, transparent calc(100% - 100px), #000 100%)`;
  cached = {
    maskImage: image,
    WebkitMaskImage: image,
    maskSize: `${tile} ${tile}, 100% 100%`,
    WebkitMaskSize: `${tile} ${tile}, 100% 100%`,
    maskRepeat: 'repeat, no-repeat',
    WebkitMaskRepeat: 'repeat, no-repeat',
  };
  return cached;
}
