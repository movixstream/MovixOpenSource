import type { ReactNode } from 'react';

/** Pastille de saison : numéro passé au gestionnaire, nom et nombre d'épisodes. */
export interface TvSeasonOption {
  number: number;
  name: string;
  episodeCount: number;
  /** Nombre d'épisodes en toutes lettres (« 9 épisodes »), pour les lecteurs d'écran. */
  episodeCountLabel: string;
}

/** Affichage de la liste d'épisodes. `grid` n'existe pas sous 768 px. */
export type TvEpisodeView = 'grid' | 'list' | 'dropdown';

/**
 * Épisode prêt à afficher : la page y a déjà appliqué l'anti-spoil, les dates
 * de diffusion et l'historique (local, puis serveur).
 */
export interface TvEpisodeItem {
  /** Clé stable (« s1e4 »). */
  key: string;
  /** Numéro passé aux gestionnaires. */
  number: number;
  /** Titre affiché (« 4. Nom », ou nom masqué). */
  title: string;
  /** Sans vignette ni suivi (épisode anime) : nom et pastilles seulement. */
  compact?: boolean;
  /** Vignette déjà dimensionnée ; `null` s'il n'y en a pas. */
  imageUrl?: string | null;
  /** Vignette masquée par l'anti-spoil. */
  imageHidden?: boolean;
  /** Pastilles sobres (langues d'un épisode anime : VF, VOSTFR…). */
  tags?: string[];
  /** État de diffusion affiché sur la vignette. */
  airing?: 'aired' | 'upcoming' | null;
  /** Infos sous le titre : durée, date. */
  meta?: string[];
  /** Infos ajoutées à la suite dès 768 px, faute de place avant (note de l'épisode). */
  metaWide?: string[];
  /** Résumé, déjà masqué si l'anti-spoil le demande. */
  overview?: string | null;
  /** Avancement de 0 à 100. */
  progress?: number;
  /** `seen` : vignette atténuée et coche. `current` : contour rouge et barre. */
  status?: 'seen' | 'current' | null;
  /** Épisode sélectionné (URL, dernier clic) : même contour que l'épisode en cours. */
  selected?: boolean;
  /** Coche « vu » allumée : la marque de cet appareil. */
  watched?: boolean;
  /** Vu d'après le serveur seulement : pastille à côté de la coche. */
  serverWatched?: 'estimated' | 'otherDevice' | null;
  /** Dans la liste « à voir » des épisodes. */
  inWatchlist?: boolean;
  /** Cloche d'alerte d'un épisode à venir (`AlertButton`). */
  alert?: ReactNode;
}
