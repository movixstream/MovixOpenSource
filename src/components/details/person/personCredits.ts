/**
 * Filmographie d'une personne, à partir des `combined_credits` de TMDB.
 * Fonctions pures, sans React ni réseau : `tests/personCredits.test.ts`.
 *
 * TMDB rend une entrée par rôle et par métier : un film où la personne joue
 * et produit arrive deux fois, une série où elle tient deux rôles aussi. On
 * fusionne par titre : une ligne par film ou série, avec tous ses rôles.
 */

export type PersonMediaType = 'movie' | 'tv';

/** Entrée brute de `combined_credits.cast` ou `.crew`. */
export interface PersonCreditInput {
  id: number;
  media_type?: string;
  title?: string;
  name?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  vote_count?: number;
  popularity?: number;
  genre_ids?: number[];
  adult?: boolean;
  /** Distribution seulement. */
  character?: string;
  order?: number;
  /** Équipe seulement. */
  job?: string;
  department?: string;
  /** Séries seulement. */
  episode_count?: number;
}

/** Département de la distribution : celui que TMDB donne à `known_for_department` pour un acteur. */
export const ACTING = 'Acting';

/** Un film ou une série de la filmographie, tous rôles réunis. */
export interface PersonCredit {
  /** `movie-123` : un même identifiant TMDB peut être un film et une série. */
  key: string;
  id: number;
  /** Nom attendu par le filtre d'âge des profils (`AgeClassifiableContent`). */
  media_type: PersonMediaType;
  adult: boolean;
  title: string;
  posterPath: string | null;
  backdropPath: string | null;
  /** Date de sortie ou de première diffusion (`AAAA-MM-JJ`), null si inconnue. */
  date: string | null;
  year: number | null;
  voteAverage: number;
  voteCount: number;
  popularity: number;
  /** Personnages joués, sans doublon ni vide. */
  characters: string[];
  /** Métiers dans l'équipe (`Director`, `Producer`…), sans doublon. */
  jobs: string[];
  /** `Acting` pour un rôle, puis les départements de l'équipe. */
  departments: string[];
  /** Épisodes de la personne dans la série : ses personnages additionnés, ou son métier le plus long. */
  episodeCount: number | null;
  /** Meilleure place au générique (0 = tête d'affiche), null hors distribution. */
  order: number | null;
  /** Talk-show ou journal télévisé : apparitions « dans son propre rôle ». */
  isTalk: boolean;
  /** Toutes les apparitions sont « dans son propre rôle » (Self, Himself…). */
  isSelf: boolean;
}

/** Genres TMDB des émissions : talk-show (10767) et journal (10763). */
const TALK_GENRES = new Set([10767, 10763]);

/** « Self », « Himself », « Herself – Host », « Lui-même »… */
const SELF_ROLE = /^(self|himself|herself|themselves|themself|lui-m[eê]me|elle-m[eê]me|eux-m[eê]mes)\b/i;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const cleanDate = (value: string | undefined): string | null => (value && DATE.test(value) ? value : null);

const pushUnique = (list: string[], value: string | undefined) => {
  const text = value?.trim();
  if (text && !list.includes(text)) list.push(text);
};

/**
 * Réunit distribution et équipe : une entrée par film ou série. Les entrées
 * qui ne sont ni un film ni une série (rare, données abîmées) sont ignorées.
 */
export function mergePersonCredits(
  cast: readonly PersonCreditInput[] | null | undefined,
  crew: readonly PersonCreditInput[] | null | undefined,
): PersonCredit[] {
  const byKey = new Map<string, PersonCredit>();
  // Épisodes : ceux des personnages s'additionnent (une voix par épisode
  // dans une série animée), un métier compte pour sa plus grande valeur.
  const castEpisodes = new Map<string, number>();
  const crewEpisodes = new Map<string, number>();
  const add = (input: PersonCreditInput, kind: 'cast' | 'crew') => {
    const mediaType = input.media_type === 'movie' || input.media_type === 'tv' ? input.media_type : null;
    if (!mediaType || !Number.isInteger(input.id) || input.id <= 0) return;
    const key = `${mediaType}-${input.id}`;
    let credit = byKey.get(key);
    if (!credit) {
      const date = cleanDate(mediaType === 'movie' ? input.release_date : input.first_air_date);
      const genres = Array.isArray(input.genre_ids) ? input.genre_ids : [];
      credit = {
        key,
        id: input.id,
        media_type: mediaType,
        adult: input.adult === true,
        title: (mediaType === 'movie' ? input.title : input.name)?.trim() || input.title?.trim() || input.name?.trim() || '',
        posterPath: input.poster_path || null,
        backdropPath: input.backdrop_path || null,
        date,
        year: date ? Number(date.slice(0, 4)) : null,
        voteAverage: Number.isFinite(input.vote_average) ? Number(input.vote_average) : 0,
        voteCount: Number.isFinite(input.vote_count) ? Number(input.vote_count) : 0,
        popularity: Number.isFinite(input.popularity) ? Number(input.popularity) : 0,
        characters: [],
        jobs: [],
        departments: [],
        episodeCount: null,
        order: null,
        isTalk: genres.some((genre) => TALK_GENRES.has(genre)),
        isSelf: false,
      };
      byKey.set(key, credit);
    }
    if (kind === 'cast') {
      pushUnique(credit.departments, ACTING);
      pushUnique(credit.characters, input.character);
      if (Number.isInteger(input.order) && (credit.order === null || Number(input.order) < credit.order)) {
        credit.order = Number(input.order);
      }
    } else {
      pushUnique(credit.departments, input.department || 'Crew');
      pushUnique(credit.jobs, input.job);
    }
    const episodes = Number.isInteger(input.episode_count) ? Number(input.episode_count) : 0;
    if (episodes > 0) {
      if (kind === 'cast') castEpisodes.set(key, (castEpisodes.get(key) ?? 0) + episodes);
      else crewEpisodes.set(key, Math.max(crewEpisodes.get(key) ?? 0, episodes));
    }
  };
  (cast ?? []).forEach((input) => add(input, 'cast'));
  (crew ?? []).forEach((input) => add(input, 'crew'));

  for (const credit of byKey.values()) {
    const episodes = Math.max(castEpisodes.get(credit.key) ?? 0, crewEpisodes.get(credit.key) ?? 0);
    credit.episodeCount = episodes > 0 ? episodes : null;
    // « Dans son propre rôle » seulement s'il n'y a ni vrai personnage ni métier.
    credit.isSelf = credit.jobs.length === 0
      && credit.characters.length > 0
      && credit.characters.every((character) => SELF_ROLE.test(character));
  }
  return [...byKey.values()];
}

/** Nombre d'épisodes à partir duquel un rôle de série compte plein dans « Connu pour ». */
const FULL_ROLE_EPISODES = 12;

/**
 * Poids d'un titre pour « Connu pour » : son nombre de votes (ce qui a été
 * vu), baissé quand la personne n'y fait qu'un passage. La popularité TMDB
 * (ce qui se regarde cette semaine) ne départage que les égalités : une série
 * animée diffusée depuis 25 ans la gonfle sans dire qui on y voit.
 */
function knownForScore(credit: PersonCredit, department: string): number {
  let score = credit.voteCount;
  if (department === ACTING) {
    // Une série pèse selon les épisodes joués : quelques passages ne valent
    // pas un rôle principal (Malcolm, 151 épisodes, avant 3 épisodes d'une
    // série plus vue). Plein poids à partir de 12 épisodes.
    if (credit.media_type === 'tv' && credit.episodeCount !== null) {
      score *= Math.min(1, Math.max(0.1, credit.episodeCount / FULL_ROLE_EPISODES));
    }
    // Loin dans le générique d'un film : un second rôle.
    if (credit.media_type === 'movie' && credit.order !== null && credit.order > 12) score *= 0.4;
  }
  if (credit.isSelf) score *= 0.1;
  return score;
}

/**
 * Titres qui font connaître la personne, dans son métier principal
 * (`known_for_department`) : talk-shows et titres sans affiche écartés. Moins
 * de quatre titres dans ce métier : tous les métiers.
 */
export function pickKnownFor(credits: readonly PersonCredit[], knownForDepartment: string | null | undefined, limit = 8): PersonCredit[] {
  const department = knownForDepartment || ACTING;
  const usable = credits.filter((credit) => credit.posterPath && !credit.isTalk);
  const inDepartment = usable.filter((credit) => credit.departments.includes(department));
  const pool = inDepartment.length >= 4 ? inDepartment : usable;
  return [...pool]
    .map((credit) => ({ credit, score: knownForScore(credit, department) }))
    .sort((a, b) => b.score - a.score || b.credit.popularity - a.credit.popularity || compareByDateDesc(a.credit, b.credit))
    .slice(0, limit)
    .map(({ credit }) => credit);
}

/** Plus récent d'abord ; sans date en tête (projets annoncés). */
export function compareByDateDesc(a: PersonCredit, b: PersonCredit): number {
  if (a.date === b.date) return b.popularity - a.popularity;
  if (a.date === null) return -1;
  if (b.date === null) return 1;
  return a.date < b.date ? 1 : -1;
}

/** Plus connu d'abord (même poids que « Connu pour », sans écarter personne). */
export function compareByPopularity(department: string) {
  return (a: PersonCredit, b: PersonCredit) => knownForScore(b, department) - knownForScore(a, department)
    || b.popularity - a.popularity
    || compareByDateDesc(a, b);
}

export interface PersonYearGroup {
  /** null : titres sans date, posés en tête. */
  year: number | null;
  credits: PersonCredit[];
}

/** Groupes par année, du plus récent au plus ancien, à partir d'une liste déjà triée par date. */
export function groupByYear(credits: readonly PersonCredit[]): PersonYearGroup[] {
  const groups: PersonYearGroup[] = [];
  for (const credit of credits) {
    const last = groups[groups.length - 1];
    if (last && last.year === credit.year) last.credits.push(credit);
    else groups.push({ year: credit.year, credits: [credit] });
  }
  return groups;
}

/** Ordre des départements dans les filtres : le métier principal, puis les plus fournis. */
export function departmentsByCount(credits: readonly PersonCredit[], knownForDepartment: string | null | undefined): Array<{ department: string; count: number }> {
  const counts = new Map<string, number>();
  credits.forEach((credit) => credit.departments.forEach((department) => {
    counts.set(department, (counts.get(department) ?? 0) + 1);
  }));
  return [...counts.entries()]
    .map(([department, count]) => ({ department, count }))
    .sort((a, b) => {
      if (a.department === knownForDepartment) return -1;
      if (b.department === knownForDepartment) return 1;
      return b.count - a.count || a.department.localeCompare(b.department);
    });
}

/**
 * Âge en années pleines à une date donnée (aujourd'hui, ou le jour du décès).
 * null si la date de naissance est absente ou invalide.
 */
export function ageInYears(birthday: string | null | undefined, until: string | Date | null | undefined = new Date()): number | null {
  const birth = cleanDate(birthday ?? undefined);
  if (!birth) return null;
  const end = typeof until === 'string' ? cleanDate(until) : until instanceof Date ? until.toISOString().slice(0, 10) : null;
  if (!end) return null;
  const [by, bm, bd] = birth.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const age = ey - by - (em < bm || (em === bm && ed < bd) ? 1 : 0);
  return age >= 0 && age < 130 ? age : null;
}
