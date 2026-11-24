// Formes communes aux pages « Collections » (liste) et « Collection » (détail).

export interface SagaPart {
  id: number;
  title: string;
  release_date?: string;
  poster_path: string | null;
  vote_average?: number;
}

export interface SagaSummary {
  id: number;
  name: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  parts: SagaPart[];
}

export type SagaViewMode = 'grid' | 'list';

/** Sociétés, pays, langues et genres d'une collection, avec le nombre de films. */
export interface SagaProductionData {
  productionCompanies: { id: number; name: string; count: number }[];
  productionCountries: { code: string; name: string; count: number }[];
  spokenLanguages: { code: string; name: string; count: number }[];
  genres: { id: number; name: string; count: number }[];
}
