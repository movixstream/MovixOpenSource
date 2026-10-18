/**
 * Modèle de la « carte en zones » du CinéGraph.
 *
 * Une carte place une œuvre (film ou série) ou un artiste au centre, puis
 * range autour des zones. Chaque zone regroupe des éléments reliés au centre
 * pour UNE raison lisible (même réalisateur, mêmes acteurs…). Chaque élément
 * garde ses raisons détaillées : l'interface les traduit en puce courte sur
 * la carte et en phrases dans le panneau « Pourquoi c'est là ? ».
 */

export type MediaType = 'movie' | 'tv';
export type EntityType = MediaType | 'person';

/** Zones d'une carte centrée sur un film ou une série. */
export type WorkZoneKind = 'team' | 'saga' | 'director' | 'cast' | 'mood';
/** Zones d'une carte centrée sur un artiste. */
export type PersonZoneKind = 'roles' | 'crew' | 'partners' | 'directors';
export type ZoneKind = WorkZoneKind | PersonZoneKind;

/** Référence légère vers une personne (visage + nom). */
export interface PersonRef {
  id: number;
  name: string;
  img?: string;
}

/** Référence légère vers une œuvre. */
export interface WorkRef {
  key: string;
  type: MediaType;
  tmdbId: number;
  title: string;
  year?: string;
  img?: string;
}

export type CrewJob = 'director' | 'creator' | 'writer';

/**
 * Raison structurée d'un lien avec le centre de la carte.
 * Les textes sont produits par l'interface (i18n), jamais ici.
 */
export type Reason =
  /** Personne de l'équipe du centre : réalisation, création ou scénario. */
  | { type: 'crew'; job: CrewJob }
  /**
   * Rôle joué. Centre = œuvre : la personne joue `character` dans le centre.
   * Centre = artiste : l'artiste joue `character` dans cette œuvre.
   */
  | { type: 'plays'; character?: string }
  /** Œuvre où l'artiste central travaille derrière la caméra. */
  | { type: 'crewOn'; job: CrewJob }
  /** Autre volet de la même saga (collection TMDB). `part` commence à 1. */
  | { type: 'saga'; name: string; part?: number; parts?: number }
  /** Même réalisateur (film) ou même créateur (série) que le centre. */
  | { type: 'sameDirector'; people: PersonRef[]; job: CrewJob }
  /** Acteurs en commun avec le centre, du plus important au moins important. */
  | { type: 'sharedCast'; people: PersonRef[] }
  /** Thèmes (mots-clés déjà traduits) et genres (localisés) en commun avec le centre. */
  | { type: 'themes'; keywords: string[]; genres: string[] }
  /** Partenaire ou réalisateur fidèle : œuvres partagées avec l'artiste central. */
  | { type: 'together'; works: WorkRef[] };

export interface MapEntity {
  /** Clé unique dans la carte : `${type}-${tmdbId}`. */
  key: string;
  type: EntityType;
  tmdbId: number;
  title: string;
  /** Affiche (œuvre) ou portrait (personne), URL complète. */
  img?: string;
  /** Image large (œuvre seulement), URL complète. */
  backdrop?: string;
  year?: string;
  rating?: number;
  overview?: string;
}

export interface MapItem extends MapEntity {
  zone: ZoneKind;
  /** `reasons[0]` est la raison de la zone ; les suivantes sont des liens en plus. */
  reasons: Reason[];
  /**
   * Clés des autres éléments de la carte liés à celui-ci, dans les deux sens
   * (ex. un acteur de l'équipe et ses films présents dans d'autres zones).
   */
  related: string[];
}

export interface MapZone {
  kind: ZoneKind;
  /** Clés des éléments, du lien le plus fort au plus faible. */
  items: string[];
  /** Personnes qui expliquent la zone (ex. le réalisateur de « Même réalisateur »). */
  people?: PersonRef[];
  /** Métier de `people` pour la zone « director » (réalisation ou création). */
  job?: CrewJob;
  /** Nom de la saga pour la zone « saga ». */
  saga?: string;
}

export interface CineMapRoot extends MapEntity {
  /** Genres localisés de l'œuvre centrale. */
  genres?: string[];
  /** Métier principal d'un artiste (`known_for_department` de TMDB). */
  department?: string;
}

export interface CineMap {
  root: CineMapRoot;
  /** Zones dans l'ordre d'affichage ; une zone vide n'est pas présente. */
  zones: MapZone[];
  items: Record<string, MapItem>;
}

/** Résultat de recherche ou de tendance pour choisir le centre d'une carte. */
export interface SearchHit {
  type: EntityType;
  id: number;
  title: string;
  year?: string;
  img?: string;
  rating?: number;
  /** Artiste : quelques titres connus (« Inception, Titanic »). */
  knownFor?: string;
}
