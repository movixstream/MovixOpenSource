import type { CinemaMotif, CinemaMotifId } from '@/types/cinemaMotifs';
import popcorn from '@/assets/cinema/popcorn.svg';
import camera from '@/assets/cinema/camera.svg';
import clapperboard from '@/assets/cinema/clapperboard.svg';
import reel from '@/assets/cinema/reel.svg';
import ticket from '@/assets/cinema/ticket.svg';
import star from '@/assets/cinema/star.svg';
import projector from '@/assets/cinema/projector.svg';
import filmstrip from '@/assets/cinema/filmstrip.svg';
import glasses from '@/assets/cinema/glasses.svg';
import seat from '@/assets/cinema/seat.svg';
import screen from '@/assets/cinema/screen.svg';
import soda from '@/assets/cinema/soda.svg';
import trophy from '@/assets/cinema/trophy.svg';
import comedy from '@/assets/cinema/comedy.svg';
import tragedy from '@/assets/cinema/tragedy.svg';
import projectorBeam from '@/assets/cinema/projector-beam.svg';

export const CINEMA_MOTIFS: readonly CinemaMotif[] = [
  { id: 'popcorn', image: popcorn, sizeRange: [20, 29], weight: 7 },
  { id: 'camera', image: camera, sizeRange: [26, 34], weight: 6 },
  { id: 'clapperboard', image: clapperboard, sizeRange: [23, 31], weight: 5 },
  { id: 'reel', image: reel, sizeRange: [22, 29], weight: 3 },
  { id: 'ticket', image: ticket, sizeRange: [22, 29], weight: 2 },
  { id: 'star', image: star, sizeRange: [15, 21], weight: 1 },
  {
    id: 'projector', image: projector, sizeRange: [29, 36], weight: 2,
    projection: { image: projectorBeam, origin: [16 / 24, 14 / 24], length: 3.3, halfWidth: 0.75 },
  },
  { id: 'filmstrip', image: filmstrip, sizeRange: [22, 30], weight: 2 },
  { id: 'glasses', image: glasses, sizeRange: [25, 32], weight: 2 },
  { id: 'seat', image: seat, sizeRange: [23, 30], weight: 1 },
  { id: 'screen', image: screen, sizeRange: [25, 32], weight: 1 },
  { id: 'soda', image: soda, sizeRange: [22, 29], weight: 1 },
  { id: 'trophy', image: trophy, sizeRange: [23, 31], weight: 1 },
  { id: 'comedy', image: comedy, sizeRange: [22, 30], weight: 1 },
  { id: 'tragedy', image: tragedy, sizeRange: [22, 30], weight: 1 },
];

const PRIORITY_MOTIFS: readonly CinemaMotifId[] = [
  'popcorn', 'popcorn', 'popcorn', 'popcorn', 'popcorn',
  'camera', 'camera', 'camera', 'camera',
  'clapperboard', 'clapperboard', 'clapperboard', 'projector',
];

/** Catalogue de la pluie : motifs, et ceux qui doivent dominer. */
export interface CinemaMotifCatalog {
  motifs: readonly CinemaMotif[];
  priority: readonly CinemaMotif['id'][];
}

export const CINEMA_CATALOG: CinemaMotifCatalog = { motifs: CINEMA_MOTIFS, priority: PRIORITY_MOTIFS };

/** Une collection variée à chaque ouverture, avec les motifs dominants du catalogue. */
export const createCinemaMotifSequence = (
  count: number,
  random = Math.random,
  { motifs, priority }: CinemaMotifCatalog = CINEMA_CATALOG,
): CinemaMotif[] => {
  const sequence = [...motifs];
  for (const id of priority) {
    const motif = motifs.find(item => item.id === id);
    if (motif) sequence.push(motif);
  }
  const totalWeight = motifs.reduce((total, motif) => total + motif.weight, 0);
  while (sequence.length < count) {
    let choice = random() * totalWeight;
    const motif = motifs.find(item => {
      choice -= item.weight;
      return choice < 0;
    }) ?? motifs[motifs.length - 1];
    sequence.push(motif);
  }
  sequence.length = Math.max(0, Math.floor(count));
  for (let i = sequence.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [sequence[i], sequence[j]] = [sequence[j], sequence[i]];
  }
  return sequence;
};
