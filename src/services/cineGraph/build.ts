/**
 * Construction des cartes du CinéGraph, sans aucun accès réseau.
 *
 * tmdb.ts récupère les réponses brutes de TMDB ; ce module les range en
 * zones et attache à chaque élément la RAISON de sa présence (même
 * réalisateur, acteurs en commun, thèmes partagés…). Tout est pur pour être
 * testé avec de petites fixtures (tests/cineGraphMap.test.ts).
 */
import { isMetaKeyword, keywordLabel } from './keywords.ts';
import type {
  CineMap,
  CineMapRoot,
  CrewJob,
  MapEntity,
  MapItem,
  MapZone,
  MediaType,
  PersonRef,
  Reason,
  SearchHit,
  WorkRef,
  ZoneKind,
} from './types.ts';

// ─── Réponses TMDB brutes (seulement les champs utilisés) ───────────────────

export interface RawGenre {
  id: number;
  name: string;
}

export interface RawKeyword {
  id: number;
  name: string;
}

/** Films : `keywords.keywords` ; séries : `keywords.results`. */
export interface RawKeywords {
  keywords?: RawKeyword[];
  results?: RawKeyword[];
}

/** Œuvre telle que TMDB la renvoie dans une liste, un crédit ou une collection. */
export interface RawWork {
  id: number;
  /** Absent des listes `similar` : c'est alors le type du centre. */
  media_type?: string;
  title?: string;
  name?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  vote_count?: number;
  overview?: string;
  genre_ids?: number[];
  adult?: boolean;
}

/** Rôle d'une personne (`combined_credits.cast`). */
export interface RawCastCredit extends RawWork {
  character?: string;
  /** Rang à l'affiche (films seulement). */
  order?: number;
  /** Séries seulement. */
  episode_count?: number;
}

/** Métier d'une personne (`combined_credits.crew`). */
export interface RawCrewCredit extends RawWork {
  job?: string;
  department?: string;
  episode_count?: number;
}

export interface RawPersonCredits {
  cast?: RawCastCredit[];
  crew?: RawCrewCredit[];
}

/** Membre du casting d'une œuvre (`credits` d'un film, `aggregate_credits` d'une série). */
export interface RawCastMember {
  id: number;
  name: string;
  profile_path?: string | null;
  popularity?: number;
  character?: string;
  order?: number;
  /** Séries : un rôle par personnage, avec son nombre d'épisodes. */
  roles?: { character?: string; episode_count?: number }[];
}

export interface RawCrewMember {
  id: number;
  name: string;
  profile_path?: string | null;
  popularity?: number;
  job?: string;
}

export interface RawCredits {
  cast?: RawCastMember[];
  crew?: RawCrewMember[];
}

export interface RawCreator {
  id: number;
  name: string;
  profile_path?: string | null;
}

/** `/{type}/{id}` avec credits (ou aggregate_credits), keywords, similar, recommendations. */
export interface RawWorkDetails extends RawWork {
  genres?: RawGenre[];
  belongs_to_collection?: { id: number; name: string } | null;
  credits?: RawCredits;
  aggregate_credits?: RawCredits;
  created_by?: RawCreator[];
  keywords?: RawKeywords;
  similar?: { results?: RawWork[] };
  recommendations?: { results?: RawWork[] };
}

export interface RawCollection {
  id: number;
  name: string;
  parts?: RawWork[];
}

/** `/person/{id}` avec `combined_credits`. */
export interface RawPersonDetails {
  id: number;
  name: string;
  profile_path?: string | null;
  biography?: string;
  known_for_department?: string;
  combined_credits?: RawPersonCredits;
}

/** Résultat de `/search/multi` ou `/trending/all/week`. */
export interface RawSearchResult extends RawWork {
  profile_path?: string | null;
  known_for?: RawWork[];
}

// ─── Entrées et options ──────────────────────────────────────────────────────

export interface WorkMapInput {
  type: MediaType;
  details: RawWorkDetails;
  collection?: RawCollection;
  /** `combined_credits` des personnes de pickWorkTeam, par id TMDB. */
  personCredits: Record<number, RawPersonCredits | undefined>;
  /** Mots-clés des candidats de pickMoodCandidates, par clé `${type}-${id}`. */
  candidateKeywords: Record<string, RawKeyword[] | undefined>;
}

export interface PersonMapInput {
  person: RawPersonDetails;
  /** Casting des œuvres de pickPersonSources, par clé `${type}-${id}`. */
  workCredits: Record<string, RawCredits | undefined>;
}

export interface BuildOptions {
  /** Langue TMDB de l'interface ('fr-FR', 'en-US'…), pour traduire les mots-clés. */
  lang: string;
  /** Base des images TMDB sans taille, ex. 'https://image.tmdb.org/t/p'. */
  imageBase: string;
}

// ─── Réglages ────────────────────────────────────────────────────────────────

const LIMITS: Record<ZoneKind, number> = {
  team: 8,
  saga: 10,
  director: 10,
  cast: 10,
  mood: 8,
  roles: 10,
  crew: 8,
  partners: 8,
  directors: 6,
};
const TEAM_DIRECTORS = 2;
const TEAM_ACTORS = 6;
/**
 * Candidats « ambiance » pris dans chaque liste TMDB. Les recommandations
 * ne partagent souvent que des genres (Inception : 20 films « Action,
 * Science-Fiction ») ; les similaires partagent un mot-clé. Dix de chaque
 * côté, tous comparés : les liens expliqués par un thème passent devant.
 */
const MOOD_PER_LIST = 10;
/** Œuvres dont on lit le casting pour trouver partenaires et réalisateurs. */
const PERSON_SOURCES = 12;
/** Talk-shows, actualités, télé-réalité, documentaires : on y joue son propre rôle. */
const NON_FICTION_GENRES = new Set([10767, 10763, 10764, 99]);
/** Pour les métiers, un documentaire réalisé reste une vraie œuvre. */
const TALK_GENRES = new Set([10767, 10763, 10764]);
/**
 * En dessous, l'œuvre est trop confidentielle pour la carte (les listes
 * « similaires » de TMDB remontent des films à 0 vote).
 */
const MIN_VOTES = 50;
/** Partenaires : têtes d'affiche seulement, pas la figuration. */
const PARTNER_BILLING = 15;
/** Artistes dont le métier principal est derrière la caméra. */
const CREW_DEPARTMENTS = new Set(['Directing', 'Writing', 'Creator']);

/**
 * Vrai pour un artiste surtout derrière la caméra : ses « partenaires » sont
 * alors les acteurs qu'il dirige, et l'interface doit le dire ainsi.
 */
export function isCrewDepartment(department?: string): boolean {
  return CREW_DEPARTMENTS.has(department ?? '');
}

const CARD_SIZE = 'w185';
const CENTER_SIZE = 'w342';
const BACKDROP_SIZE = 'w780';

// ─── Petits outils ───────────────────────────────────────────────────────────

interface PersonLike {
  id: number;
  name: string;
  profile_path?: string | null;
}

function entityKey(type: MediaType | 'person', id: number): string {
  return `${type}-${id}`;
}

function imageUrl(options: BuildOptions, size: string, path?: string | null): string | undefined {
  return path ? `${options.imageBase}/${size}${path}` : undefined;
}

function mediaTypeOf(raw: RawWork, fallback?: MediaType): MediaType | undefined {
  const type = raw.media_type ?? fallback;
  return type === 'movie' || type === 'tv' ? type : undefined;
}

function votes(raw: RawWork): number {
  return raw.vote_count ?? 0;
}

function byVotes(a: RawWork, b: RawWork): number {
  return votes(b) - votes(a);
}

/** Projet annoncé, sans date ni vote (« Untitled … ») : pas encore une œuvre. */
function isAnnounced(raw: RawWork): boolean {
  return !raw.release_date && !raw.first_air_date && !votes(raw);
}

function uniqueBy<T>(list: readonly T[], keyOf: (item: T) => string | number): T[] {
  const seen = new Set<string | number>();
  return list.filter((item) => {
    const key = keyOf(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function workTitle(raw: RawWork, type: MediaType): string {
  return (type === 'movie' ? raw.title || raw.name : raw.name || raw.title) || '';
}

function workYear(raw: RawWork): string | undefined {
  const date = raw.release_date || raw.first_air_date;
  return date && date.length >= 4 ? date.slice(0, 4) : undefined;
}

function workEntity(raw: RawWork, type: MediaType, options: BuildOptions, posterSize = CARD_SIZE): MapEntity {
  return {
    key: entityKey(type, raw.id),
    type,
    tmdbId: raw.id,
    title: workTitle(raw, type),
    img: imageUrl(options, posterSize, raw.poster_path),
    backdrop: imageUrl(options, BACKDROP_SIZE, raw.backdrop_path),
    year: workYear(raw),
    // Sans vote, TMDB renvoie 0 : mieux vaut ne rien afficher.
    rating: raw.vote_average || undefined,
    overview: raw.overview || undefined,
  };
}

function workRef(raw: RawWork, type: MediaType, options: BuildOptions): WorkRef {
  return {
    key: entityKey(type, raw.id),
    type,
    tmdbId: raw.id,
    title: workTitle(raw, type),
    year: workYear(raw),
    img: imageUrl(options, CARD_SIZE, raw.poster_path),
  };
}

function personRef(person: PersonLike, options: BuildOptions): PersonRef {
  return { id: person.id, name: person.name, img: imageUrl(options, CARD_SIZE, person.profile_path) };
}

function personEntity(person: PersonLike, options: BuildOptions): MapEntity {
  return {
    key: entityKey('person', person.id),
    type: 'person',
    tmdbId: person.id,
    title: person.name,
    img: imageUrl(options, CARD_SIZE, person.profile_path),
  };
}

/** Personnes de `members` (dans leur ordre) dont l'id figure dans `ids`. */
function refsOf(ids: readonly number[], members: readonly PersonLike[], options: BuildOptions): PersonRef[] {
  return members.filter((member) => ids.includes(member.id)).map((member) => personRef(member, options));
}

function plays(character?: string): Reason {
  return character ? { type: 'plays', character } : { type: 'plays' };
}

function keywordList(keywords?: RawKeywords): RawKeyword[] {
  return keywords?.keywords ?? keywords?.results ?? [];
}

// ─── Rôles ───────────────────────────────────────────────────────────────────

const SELF_ROLES = new Set([
  'self', 'himself', 'herself', 'themselves', 'themself', 'myself', 'yourself',
  'host', 'co-host', 'guest', 'guest host', 'presenter', 'interviewee', 'contestant',
  'lui-même', 'elle-même', 'eux-mêmes', 'elles-mêmes', 'soi-même',
  'présentateur', 'présentatrice', 'invité', 'invitée',
]);
const NARRATOR_ROLES = new Set(['narrator', 'narration', 'narrateur', 'narratrice']);
/** Apparitions qui ne sont pas un rôle : non créditées, images d'archives, caméos. */
const NOT_A_ROLE = /uncredited|non crédité|archive footage|archival footage|archive sound|\(archive\)|images d'archives?|\bcameo\b/i;
const VOICE = /\b(?:voice|voix)\b/i;

/**
 * Vrai quand le « personnage » n'en est pas un : la personne joue son propre
 * rôle (Self, Himself, son propre nom), présente, raconte hors champ, ou
 * n'apparaît qu'en caméo non crédité ou en images d'archives.
 */
export function isNotARole(character: string | undefined, personName?: string, order?: number): boolean {
  if (!character) return false;
  if (NOT_A_ROLE.test(character)) return true;
  const name = personName?.trim().toLowerCase();
  const segments = character
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s+[-–—]\s+|\s*[/:]\s*/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  return segments.some((segment) => {
    if (SELF_ROLES.has(segment) || segment === name) return true;
    // Un narrateur hors champ ne joue pas… sauf le héros qui raconte en tête
    // d'affiche (le « Narrator » d'Edward Norton dans Fight Club).
    if (NARRATOR_ROLES.has(segment)) return VOICE.test(character) || order === undefined || order > 2;
    return false;
  });
}

/** Personnage affichable, sans la mention « (voice) » ; rien pour un faux rôle. */
function characterLabel(character: string | undefined, personName?: string, order?: number): string | undefined {
  if (!character || isNotARole(character, personName, order)) return undefined;
  return character.replace(/\s*\((?:voice|voix)\)/gi, '').trim() || undefined;
}

/** Un vrai rôle de fiction : ni talk-show ni documentaire, ni simple passage. */
function isRealRole(credit: RawCastCredit, type: MediaType, personName?: string): boolean {
  if (credit.adult) return false;
  if (credit.genre_ids?.some((genre) => NON_FICTION_GENRES.has(genre))) return false;
  if (type === 'tv') {
    // Un seul épisode = rôle invité, pas un lien avec la série.
    if ((credit.episode_count ?? 0) < 2) return false;
    // Série sans aucun genre : cérémonie ou émission spéciale (Oscars,
    // Emmys…), où Tom Hanks « joue » Woody le temps d'un sketch.
    if (credit.genre_ids?.length === 0) return false;
  }
  return !isNotARole(credit.character, personName, credit.order);
}

/** Rôle principal d'un membre de casting agrégé : le personnage aux plus d'épisodes. */
function mainRole(member: RawCastMember): { character?: string; episode_count?: number } | undefined {
  let best: { character?: string; episode_count?: number } | undefined;
  for (const role of member.roles ?? []) {
    if (!best || (role.episode_count ?? 0) > (best.episode_count ?? 0)) best = role;
  }
  return best;
}

/**
 * Métier retenu derrière la caméra. Films : réalisation et scénario. Séries :
 * création, et réalisation d'au moins deux épisodes (un seul épisode n'est
 * qu'une participation, comme un rôle invité).
 */
function crewJobOf(credit: RawCrewCredit, type: MediaType): CrewJob | undefined {
  if (type === 'movie') {
    if (credit.job === 'Director') return 'director';
    if (credit.job === 'Writer' || credit.job === 'Screenplay') return 'writer';
    return undefined;
  }
  if (credit.job === 'Creator') return 'creator';
  if (credit.job === 'Director' && (credit.episode_count ?? 0) >= 2) return 'director';
  return undefined;
}

/**
 * Même métier que l'équipe du centre. Film : réaliser un autre film (un
 * épisode de série réalisé ne fait pas de la série une œuvre du cinéaste).
 * Série : dans combined_credits, les créateurs ont department ET job
 * « Creator » (vérifié sur Vince Gilligan, David Simon, Eric Kripke…) ;
 * « Original Series Creator » désigne un dérivé et ne compte pas.
 */
function isSameCrewJob(credit: RawCrewCredit, workType: MediaType, centerType: MediaType): boolean {
  return centerType === 'movie'
    ? credit.job === 'Director' && workType === 'movie'
    : credit.job === 'Creator';
}

// ─── Choix faits avant les requêtes secondaires (partagés avec tmdb.ts) ─────

interface TeamActor extends PersonLike {
  character?: string;
  order?: number;
}

export interface WorkTeam {
  /** Réalisateurs (film) ou créateurs (série), deux au plus. */
  directors: PersonLike[];
  /** Acteurs principaux dans l'ordre d'affiche, six au plus. */
  actors: TeamActor[];
  /** Métier commun des `directors`. */
  job: CrewJob;
}

/** Équipe du centre : décide aussi quelles filmographies tmdb.ts récupère. */
export function pickWorkTeam(type: MediaType, details: RawWorkDetails): WorkTeam {
  const directors: PersonLike[] = type === 'movie'
    ? (details.credits?.crew ?? []).filter((member) => member.job === 'Director')
    : details.created_by ?? [];
  const cast: RawCastMember[] = type === 'movie'
    ? [...(details.credits?.cast ?? [])].sort(
      (a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER),
    )
    // Séries : le tableau est trié par présence à l'écran ; `order` y reflète
    // la première saison (Sean Bean resterait en tête de Game of Thrones).
    : details.aggregate_credits?.cast ?? [];
  return {
    directors: uniqueBy(directors, (member) => member.id)
      .slice(0, TEAM_DIRECTORS)
      .map(({ id, name, profile_path }) => ({ id, name, profile_path })),
    actors: uniqueBy(cast, (member) => member.id)
      .slice(0, TEAM_ACTORS)
      .map((member) => ({
        id: member.id,
        name: member.name,
        profile_path: member.profile_path,
        character: type === 'movie' ? member.character : mainRole(member)?.character,
        order: type === 'movie' ? member.order : undefined,
      })),
    job: type === 'movie' ? 'director' : 'creator',
  };
}

export interface MoodCandidate {
  key: string;
  type: MediaType;
  raw: RawWork;
}

/**
 * Candidats « ambiance » : dix recommandations puis dix œuvres similaires,
 * sans doublon ni œuvre confidentielle. tmdb.ts récupère leurs mots-clés ;
 * la construction écarte ensuite ceux déjà placés dans une zone plus forte.
 */
export function pickMoodCandidates(type: MediaType, details: RawWorkDetails): MoodCandidate[] {
  const seen = new Set([entityKey(type, details.id)]);
  const candidates: MoodCandidate[] = [];
  for (const list of [details.recommendations?.results, details.similar?.results]) {
    let taken = 0;
    for (const raw of list ?? []) {
      if (taken >= MOOD_PER_LIST) break;
      // `similar` n'indique pas le type : c'est celui du centre.
      const candidateType = mediaTypeOf(raw, type);
      if (!candidateType || raw.adult || votes(raw) < MIN_VOTES) continue;
      const key = entityKey(candidateType, raw.id);
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ key, type: candidateType, raw });
      taken += 1;
    }
  }
  return candidates;
}

interface RoleEntry {
  key: string;
  type: MediaType;
  raw: RawWork;
  characters: string[];
}

interface CrewEntry {
  key: string;
  type: MediaType;
  raw: RawWork;
  job: CrewJob;
}

interface Career {
  roles: RoleEntry[];
  crew: CrewEntry[];
  /** Métier principal derrière la caméra (réalisation, scénario, création). */
  crewFirst: boolean;
}

/** Rang des métiers, plus petit = plus fort. Série : créer compte plus que réaliser des épisodes. */
const JOB_RANK: Record<MediaType, Partial<Record<CrewJob, number>>> = {
  movie: { director: 0, writer: 1 },
  tv: { creator: 0, director: 1 },
};

/** Rôles et métiers d'un artiste, dédoublonnés et triés par notoriété (vote_count). */
function careerOf(person: RawPersonDetails): Career {
  const roles = new Map<string, RoleEntry>();
  for (const credit of person.combined_credits?.cast ?? []) {
    const type = mediaTypeOf(credit);
    if (!type || isAnnounced(credit) || !isRealRole(credit, type, person.name)) continue;
    const key = entityKey(type, credit.id);
    const character = characterLabel(credit.character, person.name, credit.order);
    const entry = roles.get(key);
    if (!entry) {
      roles.set(key, { key, type, raw: credit, characters: character ? [character] : [] });
    } else if (character && !entry.characters.includes(character)) {
      entry.characters.push(character);
    }
  }
  const crew = new Map<string, CrewEntry>();
  for (const credit of person.combined_credits?.crew ?? []) {
    const type = mediaTypeOf(credit);
    if (!type || credit.adult || isAnnounced(credit)) continue;
    if (credit.genre_ids?.some((genre) => TALK_GENRES.has(genre))) continue;
    const job = crewJobOf(credit, type);
    if (!job) continue;
    const key = entityKey(type, credit.id);
    const entry = crew.get(key);
    if (entry && (JOB_RANK[type][entry.job] ?? 9) <= (JOB_RANK[type][job] ?? 9)) continue;
    crew.set(key, { key, type, raw: credit, job });
  }
  return {
    roles: [...roles.values()].sort((a, b) => byVotes(a.raw, b.raw)),
    crew: [...crew.values()].sort((a, b) => byVotes(a.raw, b.raw)),
    crewFirst: isCrewDepartment(person.known_for_department),
  };
}

interface SourceWork {
  key: string;
  type: MediaType;
  raw: RawWork;
}

/**
 * Œuvres les plus connues de l'artiste, dont on lit le casting : ses rôles,
 * ou ses œuvres derrière la caméra si c'est son métier principal (un
 * cinéaste joue peu ; ses acteurs fidèles sont alors ses partenaires).
 */
function sourcesOf(career: Career): SourceWork[] {
  const primary = career.crewFirst ? career.crew : career.roles;
  const secondary = career.crewFirst ? career.roles : career.crew;
  return (primary.length ? primary : secondary)
    .slice(0, PERSON_SOURCES)
    .map(({ key, type, raw }) => ({ key, type, raw }));
}

export interface PersonSource {
  key: string;
  type: MediaType;
  id: number;
}

/** Œuvres dont tmdb.ts doit récupérer le casting pour la carte d'un artiste. */
export function pickPersonSources(person: RawPersonDetails): PersonSource[] {
  return sourcesOf(careerOf(person)).map(({ key, type, raw }) => ({ key, type, id: raw.id }));
}

// ─── Carte centrée sur une œuvre ─────────────────────────────────────────────

interface CollectedWork {
  raw: RawWork;
  type: MediaType;
  /** Personnes de l'équipe liées à l'œuvre, dans l'ordre de l'équipe. */
  people: number[];
}

function collect(map: Map<string, CollectedWork>, raw: RawWork, type: MediaType, personId: number): void {
  const key = entityKey(type, raw.id);
  const entry = map.get(key);
  if (!entry) {
    map.set(key, { raw, type, people: [personId] });
  } else if (!entry.people.includes(personId)) {
    entry.people.push(personId);
  }
}

function compareReleaseDates(a: RawWork, b: RawWork): number {
  // Volet annoncé sans date : en dernier.
  const left = a.release_date || '9999';
  const right = b.release_date || '9999';
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Libellés de mots-clés traduits, sans doublon (« dream » et « dreams »), trois au plus. */
function keywordLabels(keywords: RawKeyword[], lang: string): string[] {
  return uniqueBy(keywords.map((keyword) => keywordLabel(keyword.name, lang)), (label) => label.toLowerCase())
    .slice(0, 3);
}

/** Œuvres jouées (vrai rôle) ou réalisées / créées par une personne. */
function linkedWorks(credits: RawPersonCredits | undefined, name: string): Set<string> {
  const keys = new Set<string>();
  for (const credit of credits?.cast ?? []) {
    const type = mediaTypeOf(credit);
    if (type && isRealRole(credit, type, name)) keys.add(entityKey(type, credit.id));
  }
  for (const credit of credits?.crew ?? []) {
    const type = mediaTypeOf(credit);
    const job = type && crewJobOf(credit, type);
    if (type && (job === 'director' || job === 'creator')) keys.add(entityKey(type, credit.id));
  }
  return keys;
}

/**
 * Carte d'un film ou d'une série : équipe, saga, même réalisateur, mêmes
 * acteurs, ambiance. Chaque œuvre n'apparaît qu'une fois, dans la zone la
 * plus forte ; les autres liens deviennent des raisons en plus.
 */
export function buildWorkMap(input: WorkMapInput, options: BuildOptions): CineMap {
  const { type, details } = input;
  const team = pickWorkTeam(type, details);
  const items: Record<string, MapItem> = {};
  const zones: MapZone[] = [];
  const placed = new Set([entityKey(type, details.id)]);

  const addZone = (zone: MapZone) => {
    if (zone.items.length) zones.push(zone);
  };
  const addWork = (raw: RawWork, workType: MediaType, zone: ZoneKind, reason: Reason): string => {
    const key = entityKey(workType, raw.id);
    items[key] = { ...workEntity(raw, workType, options), zone, reasons: [reason], related: [] };
    placed.add(key);
    return key;
  };

  // Équipe : réalisateurs ou créateurs, puis têtes d'affiche.
  const teamKeys: string[] = [];
  for (const director of team.directors) {
    const key = entityKey('person', director.id);
    items[key] = { ...personEntity(director, options), zone: 'team', reasons: [{ type: 'crew', job: team.job }], related: [] };
    teamKeys.push(key);
  }
  for (const actor of team.actors) {
    const key = entityKey('person', actor.id);
    const reason = plays(characterLabel(actor.character, actor.name, actor.order));
    // Réalisateur qui joue aussi dans son film : une seule fiche, deux raisons.
    if (items[key]) {
      items[key].reasons.push(reason);
      continue;
    }
    items[key] = { ...personEntity(actor, options), zone: 'team', reasons: [reason], related: [] };
    teamKeys.push(key);
  }
  addZone({ kind: 'team', items: teamKeys.slice(0, LIMITS.team) });

  // Saga : les autres volets de la collection, dans l'ordre de sortie.
  const collection = type === 'movie' ? input.collection : undefined;
  if (collection?.parts?.length) {
    const parts = uniqueBy(
      collection.parts.filter((part) => !part.adult && mediaTypeOf(part, 'movie') === 'movie'),
      (part) => part.id,
    );
    if (!parts.some((part) => part.id === details.id)) parts.push(details);
    const sorted = [...parts].sort(compareReleaseDates);
    const sagaKeys: string[] = [];
    sorted.forEach((part, index) => {
      if (part.id === details.id || sagaKeys.length >= LIMITS.saga) return;
      const reason: Reason = { type: 'saga', name: collection.name, part: index + 1, parts: sorted.length };
      sagaKeys.push(addWork(part, 'movie', 'saga', reason));
    });
    addZone({ kind: 'saga', items: sagaKeys, saga: collection.name });
  }

  // Même réalisateur / créateur, même métier que pour le centre.
  const directorWorks = new Map<string, CollectedWork>();
  for (const director of team.directors) {
    for (const credit of input.personCredits[director.id]?.crew ?? []) {
      const workType = mediaTypeOf(credit);
      if (!workType || credit.adult || isAnnounced(credit) || !isSameCrewJob(credit, workType, type)) continue;
      collect(directorWorks, credit, workType, director.id);
    }
  }
  const directorKeys = [...directorWorks.entries()]
    .filter(([key]) => !placed.has(key))
    .sort(([, a], [, b]) => byVotes(a.raw, b.raw))
    .slice(0, LIMITS.director)
    .map(([, work]) => addWork(work.raw, work.type, 'director', {
      type: 'sameDirector',
      people: refsOf(work.people, team.directors, options),
      job: team.job,
    }));
  const zoneDirectors = team.directors.filter((director) =>
    directorKeys.some((key) => directorWorks.get(key)?.people.includes(director.id)));
  addZone({
    kind: 'director',
    items: directorKeys,
    people: zoneDirectors.map((director) => personRef(director, options)),
    job: team.job,
  });

  // Mêmes acteurs : vrais rôles des six têtes d'affiche.
  const actorWorks = new Map<string, CollectedWork>();
  for (const actor of team.actors) {
    for (const credit of input.personCredits[actor.id]?.cast ?? []) {
      const workType = mediaTypeOf(credit);
      if (!workType || !isRealRole(credit, workType, actor.name)) continue;
      collect(actorWorks, credit, workType, actor.id);
    }
  }
  const castKeys = [...actorWorks.entries()]
    .filter(([key, work]) => !placed.has(key) && votes(work.raw) >= MIN_VOTES)
    .sort(([, a], [, b]) => b.people.length - a.people.length || byVotes(a.raw, b.raw))
    .slice(0, LIMITS.cast)
    .map(([, work]) => addWork(work.raw, work.type, 'cast', {
      type: 'sharedCast',
      people: refsOf(work.people, team.actors, options),
    }));
  addZone({ kind: 'cast', items: castKeys });

  // Ambiance : mots-clés thématiques et genres partagés, jamais un simple
  // « similaire » sans explication.
  const centerGenres = details.genres ?? [];
  const centerKeywords = uniqueBy(
    keywordList(details.keywords).filter((keyword) => !isMetaKeyword(keyword.name)),
    (keyword) => keyword.id,
  );
  const moodKeys = pickMoodCandidates(type, details)
    .filter((candidate) => !placed.has(candidate.key) && input.candidateKeywords[candidate.key] !== undefined)
    .map((candidate, index) => {
      const ids = new Set((input.candidateKeywords[candidate.key] ?? []).map((keyword) => keyword.id));
      const genreIds = new Set(candidate.raw.genre_ids ?? []);
      const keywords = centerKeywords.filter((keyword) => ids.has(keyword.id));
      const genres = centerGenres.filter((genre) => genreIds.has(genre.id));
      return { candidate, index, keywords, genres, score: 3 * keywords.length + genres.length };
    })
    .filter((match) => match.keywords.length >= 1 || match.genres.length >= 2)
    // À score égal, l'œuvre connue d'abord : l'ordre des « similaires » de
    // TMDB mettait un film de 1951 à 50 votes devant Vanilla Sky.
    .sort((a, b) => b.score - a.score || byVotes(a.candidate.raw, b.candidate.raw) || a.index - b.index)
    .slice(0, LIMITS.mood)
    .map((match) => addWork(match.candidate.raw, match.candidate.type, 'mood', {
      type: 'themes',
      keywords: keywordLabels(match.keywords, options.lang),
      genres: match.genres.slice(0, 3).map((genre) => genre.name),
    }));
  addZone({ kind: 'mood', items: moodKeys });

  // Raisons en plus : le même réalisateur ou des acteurs du centre, quelle
  // que soit la zone qui a gardé l'œuvre.
  const workKeys = zones.filter((zone) => zone.kind !== 'team').flatMap((zone) => zone.items);
  for (const key of workKeys) {
    const item = items[key];
    const madeBy = directorWorks.get(key)?.people ?? [];
    if (madeBy.length && item.reasons[0].type !== 'sameDirector') {
      item.reasons.push({ type: 'sameDirector', people: refsOf(madeBy, team.directors, options), job: team.job });
    }
    const playedBy = actorWorks.get(key)?.people ?? [];
    if (playedBy.length && item.reasons[0].type !== 'sharedCast') {
      item.reasons.push({ type: 'sharedCast', people: refsOf(playedBy, team.actors, options) });
    }
  }

  // Liens dans les deux sens : une personne de l'équipe et les œuvres de la
  // carte où elle joue ou qu'elle a réalisées.
  for (const member of uniqueBy([...team.directors, ...team.actors], (person) => person.id)) {
    const personKey = entityKey('person', member.id);
    if (!items[personKey]) continue;
    const linked = linkedWorks(input.personCredits[member.id], member.name);
    for (const key of workKeys) {
      if (!linked.has(key)) continue;
      items[personKey].related.push(key);
      items[key].related.push(personKey);
    }
  }

  const root: CineMapRoot = {
    ...workEntity(details, type, options, CENTER_SIZE),
    genres: centerGenres.map((genre) => genre.name),
  };
  return { root, zones, items };
}

// ─── Carte centrée sur un artiste ────────────────────────────────────────────

interface SharedWorks {
  person: PersonLike & { popularity?: number };
  works: SourceWork[];
}

function share(map: Map<number, SharedWorks>, person: SharedWorks['person'], work: SourceWork): void {
  const entry = map.get(person.id);
  if (!entry) {
    map.set(person.id, { person, works: [work] });
  } else if (!entry.works.some((known) => known.key === work.key)) {
    entry.works.push(work);
  }
}

/** Au moins deux œuvres en commun, du lien le plus fréquent au moins fréquent. */
function faithful(map: Map<number, SharedWorks>): SharedWorks[] {
  return [...map.values()]
    .filter((entry) => entry.works.length >= 2)
    .sort((a, b) => b.works.length - a.works.length || (b.person.popularity ?? 0) - (a.person.popularity ?? 0));
}

/**
 * Carte d'un artiste : ses rôles, ses œuvres derrière la caméra, ses
 * partenaires et ses réalisateurs fidèles (au moins deux œuvres ensemble).
 */
export function buildPersonMap(input: PersonMapInput, options: BuildOptions): CineMap {
  const { person } = input;
  const career = careerOf(person);
  const items: Record<string, MapItem> = {};
  const zones: MapZone[] = [];
  const rolesByKey = new Map(career.roles.map((role) => [role.key, role]));
  const crewByKey = new Map(career.crew.map((entry) => [entry.key, entry]));

  const addRole = (role: RoleEntry): string => {
    const reasons: Reason[] = [plays(role.characters.join(' / '))];
    const job = crewByKey.get(role.key)?.job;
    if (job) reasons.push({ type: 'crewOn', job });
    items[role.key] = { ...workEntity(role.raw, role.type, options), zone: 'roles', reasons, related: [] };
    return role.key;
  };
  const addCrew = (entry: CrewEntry): string => {
    const reasons: Reason[] = [{ type: 'crewOn', job: entry.job }];
    const role = rolesByKey.get(entry.key);
    if (role) reasons.push(plays(role.characters.join(' / ')));
    items[entry.key] = { ...workEntity(entry.raw, entry.type, options), zone: 'crew', reasons, related: [] };
    return entry.key;
  };

  // Une œuvre jouée ET réalisée ou écrite va d'abord dans la zone du métier
  // principal ; l'autre lien devient une raison en plus. Le métier
  // secondaire ne garde que des œuvres connues : sans ce seuil, la carte de
  // Christopher Nolan montrait deux courts métrages obscurs « joués ».
  const secondary = (raw: RawWork, key: string) => !items[key] && votes(raw) >= MIN_VOTES;
  let roleKeys: string[];
  let crewKeys: string[];
  if (career.crewFirst) {
    crewKeys = career.crew.slice(0, LIMITS.crew).map(addCrew);
    roleKeys = career.roles.filter((role) => secondary(role.raw, role.key)).slice(0, LIMITS.roles).map(addRole);
  } else {
    roleKeys = career.roles.slice(0, LIMITS.roles).map(addRole);
    crewKeys = career.crew.filter((entry) => secondary(entry.raw, entry.key)).slice(0, LIMITS.crew).map(addCrew);
  }
  // Le métier principal ouvre la carte : un cinéaste commence par ses films.
  if (career.crewFirst) zones.push({ kind: 'crew', items: crewKeys }, { kind: 'roles', items: roleKeys });
  else zones.push({ kind: 'roles', items: roleKeys }, { kind: 'crew', items: crewKeys });

  // Partenaires et réalisateurs : lus dans le casting des œuvres sources.
  const partners = new Map<number, SharedWorks>();
  const directors = new Map<number, SharedWorks>();
  for (const source of sourcesOf(career)) {
    const credits = input.workCredits[source.key];
    if (!credits) continue;
    const cast = source.type === 'movie'
      ? (credits.cast ?? []).filter((member, index) => (member.order ?? index) < PARTNER_BILLING)
      : (credits.cast ?? []).slice(0, PARTNER_BILLING);
    for (const member of cast) {
      if (member.id === person.id) continue;
      const character = source.type === 'movie' ? member.character : mainRole(member)?.character;
      if (isNotARole(character, member.name, source.type === 'movie' ? member.order : undefined)) continue;
      share(partners, member, source);
    }
    if (source.type !== 'movie') continue;
    for (const member of credits.crew ?? []) {
      if (member.job === 'Director' && member.id !== person.id) share(directors, member, source);
    }
  }
  const addPeople = (entries: SharedWorks[], zone: ZoneKind, limit: number): string[] => entries
    // Une même personne ne figure qu'une fois : partenaire avant réalisateur.
    .filter((entry) => !items[entityKey('person', entry.person.id)])
    .slice(0, limit)
    .map((entry) => {
      const key = entityKey('person', entry.person.id);
      const works = [...entry.works].sort((a, b) => byVotes(a.raw, b.raw));
      items[key] = {
        ...personEntity(entry.person, options),
        zone,
        reasons: [{ type: 'together', works: works.map((work) => workRef(work.raw, work.type, options)) }],
        related: [],
      };
      // Liens vers les œuvres partagées présentes dans les zones de rôles ou de métiers.
      for (const work of works) {
        if (!items[work.key]) continue;
        items[key].related.push(work.key);
        items[work.key].related.push(key);
      }
      return key;
    });
  const partnerKeys = addPeople(faithful(partners), 'partners', LIMITS.partners);
  const directorKeys = addPeople(faithful(directors), 'directors', LIMITS.directors);
  zones.push({ kind: 'partners', items: partnerKeys }, { kind: 'directors', items: directorKeys });

  // Fond du centre : l'œuvre la plus connue du métier principal.
  const mainKeys = career.crewFirst ? [...crewKeys, ...roleKeys] : [...roleKeys, ...crewKeys];
  const root: CineMapRoot = {
    key: entityKey('person', person.id),
    type: 'person',
    tmdbId: person.id,
    title: person.name,
    img: imageUrl(options, CENTER_SIZE, person.profile_path),
    backdrop: mainKeys.map((key) => items[key].backdrop).find(Boolean),
    overview: person.biography || undefined,
    department: person.known_for_department || undefined,
  };
  return { root, zones: zones.filter((zone) => zone.items.length > 0), items };
}

// ─── Recherche et tendances ──────────────────────────────────────────────────

/** Résultats TMDB → choix d'un centre de carte (œuvres et artistes). */
export function toSearchHits(results: RawSearchResult[], options: BuildOptions): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const result of results) {
    if (result.adult) continue;
    if (result.media_type === 'person') {
      const knownFor = (result.known_for ?? [])
        .map((work) => workTitle(work, mediaTypeOf(work) ?? 'movie'))
        .filter(Boolean)
        .slice(0, 2)
        .join(', ');
      hits.push({
        type: 'person',
        id: result.id,
        title: result.name || '',
        img: imageUrl(options, CARD_SIZE, result.profile_path),
        knownFor: knownFor || undefined,
      });
      continue;
    }
    const type = mediaTypeOf(result);
    if (!type) continue;
    hits.push({
      type,
      id: result.id,
      title: workTitle(result, type),
      year: workYear(result),
      img: imageUrl(options, CARD_SIZE, result.poster_path),
      rating: result.vote_average || undefined,
    });
  }
  return hits;
}
