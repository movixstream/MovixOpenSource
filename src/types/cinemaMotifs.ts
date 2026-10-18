export type CinemaMotifId =
  | 'popcorn' | 'camera' | 'clapperboard' | 'reel' | 'ticket'
  | 'star' | 'projector' | 'filmstrip' | 'glasses' | 'seat'
  | 'screen' | 'soda' | 'trophy' | 'comedy' | 'tragedy';

/** Motifs de la pluie quand le thème Halloween est actif. */
export type HalloweenMotifId =
  | 'candy-corn' | 'candy-orange' | 'candy-purple' | 'lollipop' | 'mint'
  | 'eyeball' | 'worm' | 'pumpkin-candy' | 'bat' | 'spider'
  | 'jack-o-lantern' | 'lantern';

export interface CinemaProjection {
  image: string;
  /** Position normalisée de la sortie de l'objectif dans le SVG carré. */
  origin: readonly [number, number];
  /** Dimensions du cône en multiples de la largeur du motif. */
  length: number;
  halfWidth: number;
}

export interface CinemaMotif {
  id: CinemaMotifId | HalloweenMotifId;
  image: string;
  sizeRange: readonly [number, number];
  weight: number;
  projection?: CinemaProjection;
}
