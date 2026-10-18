import type { CinemaMotifCatalog } from '@/data/cinemaMotifs';
import type { CinemaMotif } from '@/types/cinemaMotifs';
import candyCorn from '@/assets/halloween/motifs/candy-corn.svg';
import candyOrange from '@/assets/halloween/motifs/candy-orange.svg';
import candyPurple from '@/assets/halloween/motifs/candy-purple.svg';
import lollipop from '@/assets/halloween/motifs/lollipop.svg';
import mint from '@/assets/halloween/motifs/mint.svg';
import eyeball from '@/assets/halloween/motifs/eyeball.svg';
import worm from '@/assets/halloween/motifs/worm.svg';
import pumpkinCandy from '@/assets/halloween/motifs/pumpkin-candy.svg';
import bat from '@/assets/halloween/motifs/bat.svg';
import spider from '@/assets/halloween/motifs/spider.svg';
import jackOLantern from '@/assets/halloween/motifs/jack-o-lantern.svg';
import lantern from '@/assets/halloween/motifs/lantern.svg';
import lanternGlow from '@/assets/halloween/motifs/lantern-glow.svg';

/**
 * Pluie de la popup pub pendant le thème Halloween : les bonbons du décor,
 * chauves-souris et araignées claires (lisibles sur le fond sombre de la
 * popup), citrouilles et une lanterne. La lanterne remplace le projecteur :
 * son « faisceau » est une lueur orange centrée sur sa vitre (origine
 * décalée de la moitié de la longueur, voir AdPopupCinemaRain). Tous les
 * SVG ont un cadre carré, comme le catalogue cinéma.
 */
const HALLOWEEN_MOTIFS: readonly CinemaMotif[] = [
  { id: 'candy-corn', image: candyCorn, sizeRange: [20, 27], weight: 4 },
  { id: 'candy-orange', image: candyOrange, sizeRange: [22, 29], weight: 3 },
  { id: 'candy-purple', image: candyPurple, sizeRange: [22, 29], weight: 3 },
  { id: 'lollipop', image: lollipop, sizeRange: [22, 29], weight: 3 },
  { id: 'mint', image: mint, sizeRange: [19, 25], weight: 2 },
  { id: 'eyeball', image: eyeball, sizeRange: [19, 25], weight: 2 },
  { id: 'worm', image: worm, sizeRange: [22, 28], weight: 2 },
  { id: 'pumpkin-candy', image: pumpkinCandy, sizeRange: [20, 26], weight: 2 },
  { id: 'bat', image: bat, sizeRange: [27, 35], weight: 4 },
  { id: 'spider', image: spider, sizeRange: [21, 27], weight: 2 },
  { id: 'jack-o-lantern', image: jackOLantern, sizeRange: [26, 33], weight: 3 },
  {
    id: 'lantern', image: lantern, sizeRange: [27, 33], weight: 2,
    projection: { image: lanternGlow, origin: [0.5 - 0.9, 0.5], length: 1.8, halfWidth: 0.9 },
  },
];

export const HALLOWEEN_CATALOG: CinemaMotifCatalog = {
  motifs: HALLOWEEN_MOTIFS,
  priority: [
    'candy-corn', 'candy-corn', 'bat', 'bat', 'bat',
    'jack-o-lantern', 'jack-o-lantern', 'candy-orange', 'lollipop', 'lantern',
  ],
};
