import axios from 'axios';
import { MAIN_API } from '../config/runtime';

// --- Types ---

/** Élément de la rangée « Reprendre » tel que renvoyé par `GET /api/history/continue`. */
export interface ContinueItem {
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  season: number | null;
  episode: number | null;
  position: number;
  duration: number;
  lastWatchedAt: string;
  title: string | null;
  overview: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  year: number | null;
  rating: number | null;
  episodeName: string | null;
  episodeOverview: string | null;
  stillPath: string | null;
  /**
   * Série lue en mode animé (anime-sama) : saison/épisode suivent anime-sama,
   * pas TMDB (nom, résumé et image d'épisode à null). Absent → false.
   */
  animeMode?: boolean;
}

/** Objet attendu par `EmblaCarousel isHistory` (mêmes champs que l'enrichissement local de Home). */
export interface HomeContinueItem {
  id: number;
  media_type: 'movie' | 'tv';
  title: string;
  name?: string;
  poster_path: string;
  backdrop_path?: string;
  overview?: string;
  vote_average?: number;
  release_date?: string;
  first_air_date?: string;
  currentEpisode?: { season: number; episode: number };
  progress: number;
  position: number;
  duration: number;
  lastAccessed: string;
  /** Épisode numéroté par anime-sama (voir ContinueItem.animeMode). */
  animeMode: boolean;
}

/** Onglets de l'historique du profil (`status` de `GET /api/history/list`). */
export type HistoryStatus = 'in_progress' | 'finished' | 'not_started';

/** Ligne de l'historique : un titre, avec son avancement de série. */
export interface HistoryListItem extends Omit<ContinueItem, 'position' | 'duration'> {
  /** Secondes ; null pour un film marqué « Déjà vu » sans aucune progression. */
  position: number | null;
  duration: number | null;
  finished: boolean;
  /** Position/durée (film) ou épisode affiché tirés du temps passé dans un lecteur web. */
  estimated: boolean;
  /** Titre marqué « Déjà vu » (film vu, série entière vue). */
  markedWatched: boolean;
  /** Série en mode animé : episodesTotal à null, lien vers le lecteur animé. */
  animeMode: boolean;
  /** Série : épisodes vus (progression, marque « Déjà vu » ou estimé). Film : null. */
  episodesWatched: number | null;
  /** Série : épisodes connus (saison 0 exclue), null si inconnu. Film : null. */
  episodesTotal: number | null;
}

/** Réponse de `GET /api/history/list`. */
export interface HistoryListResponse {
  items: HistoryListItem[];
  page: number;
  pageSize: number;
  total: number;
  counts: { inProgress: number; finished: number; notStarted: number };
  stats: {
    /** Somme des positions (où tu t'es arrêté dans chaque film/épisode). */
    watchedSeconds: number;
    /** Temps réel passé sur la page du lecteur (même source que Wrapped) ; null sur un ancien serveur. */
    trackedSeconds: number | null;
    moviesFinished: number;
    episodesFinished: number;
  };
  /** Toujours true dans un résultat `ok` (sinon la raison est « incomplete »). */
  complete: boolean;
}

/**
 * Pourquoi la liste n'a pas pu être lue ; la page a un message par raison.
 * - unauthenticated : invité, session refusée (401/403) ou profil inconnu du compte ;
 * - unavailable : route absente (404, pas encore déployée), erreur serveur, réponse mal formée ;
 * - network : aucune réponse (réseau coupé, blocage, délai dépassé) ;
 * - incomplete : l'import de l'historique local n'est pas fini (complete:false).
 */
export type HistoryListFailure = 'unauthenticated' | 'unavailable' | 'network' | 'incomplete';

export type HistoryListResult =
  | { ok: true; data: HistoryListResponse }
  | { ok: false; reason: HistoryListFailure };

export interface HistoryListQuery {
  status: HistoryStatus;
  page: number;
  pageSize: number;
  language: string;
}

// --- Helpers ---

const HISTORY_STATUSES: HistoryStatus[] = ['in_progress', 'finished', 'not_started'];
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

const LANGUAGES = ['fr-FR', 'en-US'];
const DEFAULT_LANGUAGE = 'fr-FR';
// Lecture courte : une API injoignable (blocage FAI) rend vite la main à la
// rangée locale. Les retraits gardent un délai plus long.
const READ_TIMEOUT_MS = 5000;
const WRITE_TIMEOUT_MS = 15000;

// Titres retirés pendant cette session (`type:id` → heure du retrait). Une
// lecture du serveur partie avant la fin du retrait, ou un retrait refusé
// (réseau, limite de débit), ne doit pas faire revenir la carte. Un titre
// relancé après le retrait (lastWatchedAt plus récent) revient normalement.
const recentlyHidden = new Map<string, number>();
// Retraits en cours : une lecture attend qu'ils soient finis avant de partir.
const pendingHides = new Set<Promise<boolean>>();

function hiddenKey(type: string, id: number): string {
  return `${type}:${id}`;
}

function markHidden(type: string, id: number, at: number): void {
  recentlyHidden.set(hiddenKey(type, id), at);
}

function isRecentlyHidden(item: ContinueItem): boolean {
  const hiddenAt = recentlyHidden.get(hiddenKey(item.mediaType, item.tmdbId));
  if (hiddenAt === undefined) return false;
  const watchedAt = Date.parse(item.lastWatchedAt);
  return !Number.isFinite(watchedAt) || watchedAt <= hiddenAt;
}

function trackHide(request: Promise<boolean>): Promise<boolean> {
  pendingHides.add(request);
  void request.finally(() => pendingHides.delete(request));
  return request;
}

// Lecture protégée : stockage refusé par le navigateur ou absent (tests Node).
function readStorage(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

// Jeton et profil : seuls les comptes connectés (oauth, bip39) ont un
// historique sur le serveur. Les invités n'ont pas de jeton.
function readOwner(): { token: string; profileId: string } | null {
  const token = readStorage('auth_token');
  const profileId = readStorage('selected_profile_id');
  if (!token || !profileId || !MAIN_API) return null;
  return { token, profileId };
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

// Date au milieu de l'année : la carte n'en affiche que l'année, et le
// 1er juillet ne bascule d'année dans aucun fuseau horaire.
function yearToDate(year: number | null): string | undefined {
  return isPositiveInteger(year) ? `${year}-07-01` : undefined;
}

// --- Public API ---

/**
 * Convertit un élément du serveur en carte de la rangée « Reprendre ».
 * @returns null si TMDB ne connaît pas le titre (pas de nom à afficher).
 */
export function toHomeItem(item: ContinueItem): HomeContinueItem | null {
  if (!item || !item.title) return null;
  const isTv = item.mediaType === 'tv';
  const position = Number.isFinite(item.position) ? item.position : 0;
  const duration = Number.isFinite(item.duration) ? item.duration : 0;
  const progress = duration > 0 ? Math.min((position / duration) * 100, 100) : 0;
  const date = yearToDate(item.year);

  return {
    id: item.tmdbId,
    media_type: isTv ? 'tv' : 'movie',
    title: item.title,
    name: isTv ? item.title : undefined,
    poster_path: item.posterPath || '',
    backdrop_path: item.backdropPath || undefined,
    overview: item.overview || undefined,
    vote_average: typeof item.rating === 'number' ? item.rating : undefined,
    release_date: isTv ? undefined : date,
    first_air_date: isTv ? date : undefined,
    currentEpisode: isTv && isPositiveInteger(item.season) && isPositiveInteger(item.episode)
      ? { season: item.season, episode: item.episode }
      : undefined,
    progress,
    position,
    duration,
    lastAccessed: item.lastWatchedAt,
    animeMode: item.animeMode === true,
  };
}

/**
 * Lit la rangée « Reprendre » du profil sur le serveur (déjà triée, sans limite).
 * @returns null si invité, sans profil, historique désactivé dans les
 *   réglages, liste incomplète (import pas fini) ou erreur (API injoignable,
 *   pas encore déployée) : l'appelant garde alors sa logique localStorage
 *   (vide quand l'historique est désactivé).
 */
export async function fetchContinueWatching(language: string): Promise<ContinueItem[] | null> {
  if (readStorage('settings_disable_history') === 'true') return null;
  const owner = readOwner();
  if (!owner) return null;
  // Un retrait en cours d'envoi passe avant : sinon la lecture pourrait
  // renvoyer la carte qu'on vient de retirer.
  if (pendingHides.size > 0) await Promise.allSettled([...pendingHides]);
  try {
    const response = await axios.get(`${MAIN_API}/api/history/continue`, {
      params: {
        profileId: owner.profileId,
        language: LANGUAGES.includes(language) ? language : DEFAULT_LANGUAGE,
      },
      headers: { Authorization: `Bearer ${owner.token}` },
      timeout: READ_TIMEOUT_MS,
    });
    const data = response?.data;
    if (!data || data.complete !== true || !Array.isArray(data.items)) return null;
    return (data.items as ContinueItem[]).filter((item) => !isRecentlyHidden(item));
  } catch {
    return null;
  }
}

/** true si l'utilisateur a coupé l'historique dans ses réglages. */
export function isHistoryDisabled(): boolean {
  return readStorage('settings_disable_history') === 'true';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const finiteOrNull = (value: unknown): number | null =>
  (typeof value === 'number' && Number.isFinite(value) ? value : null);

const countOf = (value: unknown): number =>
  (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);

// Le serveur et le site sont déployés séparément : un champ absent (serveur
// v1) ou abîmé prend une valeur neutre au lieu de casser la ligne.
function toHistoryItem(raw: unknown): HistoryListItem | null {
  if (!isObject(raw)) return null;
  if (raw.mediaType !== 'movie' && raw.mediaType !== 'tv') return null;
  if (!isPositiveInteger(raw.tmdbId)) return null;
  return {
    ...(raw as unknown as HistoryListItem),
    position: finiteOrNull(raw.position),
    duration: finiteOrNull(raw.duration),
    finished: raw.finished === true,
    estimated: raw.estimated === true,
    markedWatched: raw.markedWatched === true,
    animeMode: raw.animeMode === true,
    episodesWatched: finiteOrNull(raw.episodesWatched),
    episodesTotal: finiteOrNull(raw.episodesTotal),
  };
}

const failed = (reason: HistoryListFailure): HistoryListResult => ({ ok: false, reason });

// Erreur axios : sans réponse → réseau ; 401/403 ou profil inconnu du compte
// (404 JSON PROFILE_NOT_FOUND de resolveOwner) → session ; le reste → indisponible.
function failureOf(error: unknown): HistoryListFailure {
  const response = isObject(error) && isObject(error.response) ? error.response : null;
  if (!response) return 'network';
  const { status, data } = response;
  if (status === 401 || status === 403) return 'unauthenticated';
  if (status === 404 && isObject(data) && data.code === 'PROFILE_NOT_FOUND') return 'unauthenticated';
  return 'unavailable';
}

/**
 * Lit une page de l'historique complet du profil (onglet « Historique »).
 * Les valeurs hors limites sont ramenées aux défauts de la route.
 * @returns `{ ok: true, data }` avec la réponse nettoyée (champs absents →
 *   false / null / 0, lignes sans type ni identifiant TMDB écartées), sinon
 *   `{ ok: false, reason }` (voir HistoryListFailure).
 */
export async function fetchHistoryList(query: HistoryListQuery): Promise<HistoryListResult> {
  if (!MAIN_API) return failed('unavailable');
  const owner = readOwner();
  if (!owner) return failed('unauthenticated');
  const page = Number.isFinite(query.page) && query.page >= 1 ? Math.floor(query.page) : 1;
  const size = Number.isFinite(query.pageSize) && query.pageSize >= 1
    ? Math.min(Math.floor(query.pageSize), MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;
  try {
    const response = await axios.get(`${MAIN_API}/api/history/list`, {
      params: {
        profileId: owner.profileId,
        language: LANGUAGES.includes(query.language) ? query.language : DEFAULT_LANGUAGE,
        status: HISTORY_STATUSES.includes(query.status) ? query.status : 'in_progress',
        page,
        pageSize: size,
      },
      headers: { Authorization: `Bearer ${owner.token}` },
      timeout: READ_TIMEOUT_MS,
    });
    const data = response?.data;
    if (isObject(data) && data.complete === false) return failed('incomplete');
    if (!isObject(data) || data.complete !== true || !Array.isArray(data.items) || !isObject(data.counts) || !isObject(data.stats)) {
      return failed('unavailable');
    }
    const { counts, stats } = data;
    return {
      ok: true,
      data: {
        items: data.items.map(toHistoryItem).filter((item): item is HistoryListItem => item !== null),
        page: isPositiveInteger(data.page) ? data.page : page,
        pageSize: isPositiveInteger(data.pageSize) ? data.pageSize : size,
        total: countOf(data.total),
        counts: { inProgress: countOf(counts.inProgress), finished: countOf(counts.finished), notStarted: countOf(counts.notStarted) },
        stats: {
          watchedSeconds: countOf(stats.watchedSeconds),
          trackedSeconds: typeof stats.trackedSeconds === 'number' && Number.isFinite(stats.trackedSeconds) && stats.trackedSeconds >= 0
            ? stats.trackedSeconds
            : null,
          moviesFinished: countOf(stats.moviesFinished),
          episodesFinished: countOf(stats.episodesFinished),
        },
        complete: true,
      },
    };
  } catch (error) {
    return failed(failureOf(error));
  }
}

// --- Fiches film et série : GET /api/history/title ---------------------------------

/** Un épisode connu du profil (progression exacte, estimé de lecteur web ou marque). */
export interface TitleHistoryEpisode {
  season: number;
  episode: number;
  position: number | null;
  duration: number | null;
  estimated: boolean;
  /** Règle de l'onglet : exact > 85 %, marque, ou estimé ≥ 85 %. */
  watched: boolean;
  marked: boolean;
}

/** Ce que le serveur sait d'un titre, avec le même classement que l'onglet « Historique ». */
export interface TitleHistory {
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  status: HistoryStatus;
  markedWatched: boolean;
  animeMode: boolean;
  /** La position (film, ou épisode courant) vient d'un lecteur web. */
  estimated: boolean;
  position: number | null;
  duration: number | null;
  season: number | null;
  episode: number | null;
  episodesWatched: number | null;
  episodesTotal: number | null;
  /** Série : tous les épisodes connus ; en mode animé, numéros anime-sama. */
  episodes: TitleHistoryEpisode[];
}

export type TitleHistoryResult =
  | { ok: true; title: TitleHistory | null }
  | { ok: false; reason: HistoryListFailure };

const integerOrNull = (value: unknown): number | null =>
  (typeof value === 'number' && Number.isInteger(value) ? value : null);

function toTitleEpisode(raw: unknown): TitleHistoryEpisode | null {
  if (!isObject(raw)) return null;
  const season = integerOrNull(raw.season);
  const episode = integerOrNull(raw.episode);
  if (season === null || season < 0 || episode === null || episode < 1) return null;
  return {
    season,
    episode,
    position: finiteOrNull(raw.position),
    duration: finiteOrNull(raw.duration),
    estimated: raw.estimated === true,
    watched: raw.watched === true,
    marked: raw.marked === true,
  };
}

function toTitleHistory(raw: unknown): TitleHistory | null {
  if (!isObject(raw)) return null;
  if (raw.mediaType !== 'movie' && raw.mediaType !== 'tv') return null;
  if (!isPositiveInteger(raw.tmdbId)) return null;
  return {
    mediaType: raw.mediaType,
    tmdbId: raw.tmdbId,
    status: HISTORY_STATUSES.includes(raw.status as HistoryStatus) ? (raw.status as HistoryStatus) : 'not_started',
    markedWatched: raw.markedWatched === true,
    animeMode: raw.animeMode === true,
    estimated: raw.estimated === true,
    position: finiteOrNull(raw.position),
    duration: finiteOrNull(raw.duration),
    season: integerOrNull(raw.season),
    episode: integerOrNull(raw.episode),
    episodesWatched: finiteOrNull(raw.episodesWatched),
    episodesTotal: finiteOrNull(raw.episodesTotal),
    episodes: Array.isArray(raw.episodes)
      ? raw.episodes.map(toTitleEpisode).filter((entry): entry is TitleHistoryEpisode => entry !== null)
      : [],
  };
}

/**
 * Ce que le serveur sait d'un film ou d'une série, pour la fiche du titre.
 * Mêmes garde-fous que fetchHistoryList (jeton, profil, délai court, raisons
 * d'échec) ; historique coupé dans les réglages → `title: null` sans requête.
 * @returns `{ ok: true, title }` (null si le serveur ne connaît pas le titre)
 *   ou `{ ok: false, reason }` ; la fiche garde alors son stockage local seul.
 */
export async function fetchTitleHistory(query: { type: 'movie' | 'tv'; id: number; language: string }): Promise<TitleHistoryResult> {
  if (!MAIN_API) return { ok: false, reason: 'unavailable' };
  if (isHistoryDisabled()) return { ok: true, title: null };
  const owner = readOwner();
  if (!owner) return { ok: false, reason: 'unauthenticated' };
  try {
    const response = await axios.get(`${MAIN_API}/api/history/title`, {
      params: {
        profileId: owner.profileId,
        type: query.type,
        id: query.id,
        language: LANGUAGES.includes(query.language) ? query.language : DEFAULT_LANGUAGE,
      },
      headers: { Authorization: `Bearer ${owner.token}` },
      timeout: READ_TIMEOUT_MS,
    });
    const data = response?.data;
    if (!isObject(data)) return { ok: false, reason: 'unavailable' };
    if (data.complete === false) return { ok: false, reason: 'incomplete' };
    if (data.complete !== true) return { ok: false, reason: 'unavailable' };
    return { ok: true, title: toTitleHistory(data.title) };
  } catch (error) {
    return { ok: false, reason: failureOf(error) };
  }
}

async function sendDelete(path: string): Promise<boolean> {
  const owner = readOwner();
  if (!owner) return false;
  try {
    await axios.delete(`${MAIN_API}${path}`, {
      params: { profileId: owner.profileId },
      headers: { Authorization: `Bearer ${owner.token}` },
      timeout: WRITE_TIMEOUT_MS,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * « Supprimer de l'historique » : efface vraiment un titre côté serveur
 * (progression, historique, marques « Déjà vu », statistiques). Définitif.
 * @returns true si le serveur a accepté (204), false sinon (invité, erreur,
 *   route pas encore déployée) : l'appelant n'efface alors rien en local.
 */
export function deleteTitleHistory(type: 'movie' | 'tv', id: number): Promise<boolean> {
  return sendDelete(`/api/history/title/${type}/${id}`);
}

/**
 * Retire un titre de la rangée « Reprendre » côté serveur.
 * @returns true si le serveur a accepté, false sinon (invité, erreur).
 */
export function hideContinueWatching(type: 'movie' | 'tv', id: number): Promise<boolean> {
  markHidden(type, id, Date.now());
  return trackHide(sendDelete(`/api/history/continue/${type}/${id}`));
}

/**
 * « Tout retirer » : vide la rangée du profil côté serveur en une requête.
 * @param displayed cartes affichées au moment du retrait, filtrées des
 *   lectures suivantes de cette session.
 * @returns true si le serveur a accepté, false sinon (invité, erreur).
 */
export function hideAllContinueWatching(
  displayed: ReadonlyArray<{ mediaType: 'movie' | 'tv'; id: number }> = [],
): Promise<boolean> {
  const now = Date.now();
  for (const item of displayed) markHidden(item.mediaType, item.id, now);
  return trackHide(sendDelete('/api/history/continue'));
}
