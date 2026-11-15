/**
 * Accès réseau du CinéGraph : requêtes TMDB par phases parallèles, cache
 * mémoire partagé, puis construction pure de la carte (build.ts).
 *
 * Phase 1 : la fiche du centre, indispensable (un échec rejette la promesse).
 * Phase 2 : tout le reste en parallèle ; un échec ne retire qu'une info.
 */
import axios from 'axios';
import { TMDB_API_KEY, TMDB_API_URL, TMDB_IMAGE_URL } from '@/config/config';
import { getTmdbLanguage } from '@/i18n';
import {
  buildPersonMap,
  buildWorkMap,
  pickMoodCandidates,
  pickPersonSources,
  pickWorkTeam,
  toSearchHits,
} from './build.ts';
import type {
  BuildOptions,
  RawCollection,
  RawCredits,
  RawKeyword,
  RawKeywords,
  RawPersonCredits,
  RawPersonDetails,
  RawSearchResult,
  RawWorkDetails,
} from './build.ts';
import type { CineMap, MediaType, SearchHit } from './types.ts';

const CACHE_LIMIT = 300;
const SEARCH_LIMIT = 12;
const TRENDING_LIMIT = 20;

// ─── Cache mémoire des GET ───────────────────────────────────────────────────

type Params = Record<string, string | number>;

interface CacheEntry {
  key: string;
  promise: Promise<unknown>;
  /** Annule la requête axios quand plus aucun appelant ne l'attend. */
  controller: AbortController;
  /** Appelants qui attendent encore la réponse. */
  waiting: number;
  settled: boolean;
}

/**
 * Réponses déjà reçues et requêtes en vol, par chemin + paramètres. Revenir
 * en arrière dans l'exploration redemande les mêmes chemins : la carte se
 * reconstruit sans réseau. Les plus anciennes entrées partent d'abord.
 */
const cache = new Map<string, CacheEntry>();

function cacheKey(path: string, params: Params): string {
  const query = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return `${path}?${query}`;
}

function abortError(): DOMException {
  return new DOMException('Requête CinéGraph annulée', 'AbortError');
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted) || axios.isCancel(error) || (error instanceof Error && error.name === 'AbortError');
}

function trimCache(): void {
  for (const [key, entry] of cache) {
    if (cache.size <= CACHE_LIMIT) return;
    // Une requête en vol reste : quelqu'un l'attend encore.
    if (entry.settled) cache.delete(key);
  }
}

function startRequest(key: string, path: string, params: Params): CacheEntry {
  const controller = new AbortController();
  const request = axios.get<unknown>(`${TMDB_API_URL}${path}`, {
    params: { ...params, api_key: TMDB_API_KEY },
    signal: controller.signal,
  });
  const entry: CacheEntry = { key, promise: request, controller, waiting: 0, settled: false };
  entry.promise = request.then(
    (response) => {
      entry.settled = true;
      return response.data;
    },
    (error: unknown) => {
      entry.settled = true;
      // Jamais d'erreur en cache : la prochaine demande retentera.
      if (cache.get(key) === entry) cache.delete(key);
      throw error;
    },
  );
  cache.set(key, entry);
  trimCache();
  return entry;
}

/**
 * Suit une requête partagée avec son propre signal. Annuler un appelant ne
 * casse pas les autres : la requête axios n'est coupée que lorsque plus
 * personne ne l'attend.
 */
function follow(entry: CacheEntry, signal?: AbortSignal): Promise<unknown> {
  entry.waiting += 1;
  return new Promise((resolve, reject) => {
    let done = false;
    const onAbort = (): void => {
      if (!release()) return;
      if (entry.waiting === 0 && !entry.settled) {
        // La requête coupée quitte le cache tout de suite : le rejet d'axios
        // n'arrive qu'après, et un appel immédiat (double effet du StrictMode,
        // retour rapide sur la même carte) recevrait sinon cette annulation.
        if (cache.get(entry.key) === entry) cache.delete(entry.key);
        entry.controller.abort();
      }
      reject(abortError());
    };
    const release = (): boolean => {
      if (done) return false;
      done = true;
      entry.waiting -= 1;
      signal?.removeEventListener('abort', onAbort);
      return true;
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    entry.promise.then(
      (data) => {
        if (release()) resolve(data);
      },
      (error: unknown) => {
        if (release()) reject(error);
      },
    );
  });
}

function tmdbGet<T>(path: string, params: Params, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(abortError());
  const key = cacheKey(path, params);
  let entry = cache.get(key);
  // Une requête déjà coupée ne doit jamais servir un nouvel appel.
  if (entry && !entry.settled && entry.controller.signal.aborted) entry = undefined;
  if (entry) {
    // Remise en fin de file : une entrée relue reste plus longtemps.
    cache.delete(key);
    cache.set(key, entry);
  } else {
    entry = startRequest(key, path, params);
  }
  return (entry.settled ? entry.promise : follow(entry, signal)) as Promise<T>;
}

/** Requête secondaire : en cas d'échec, on saute l'info et la carte s'affiche quand même. */
function optional<T>(request: Promise<T>, label: string, signal?: AbortSignal): Promise<T | undefined> {
  return request.catch((error: unknown) => {
    if (!isAbort(error, signal)) console.warn(`[CinéGraph] ${label} indisponible`, error);
    return undefined;
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

/** TMDB n'a souvent pas de texte français : on reprend alors l'anglais. */
function needsEnglish(text: string | undefined, language: string): boolean {
  return !text && !language.toLowerCase().startsWith('en');
}

function buildOptions(lang: string): BuildOptions {
  return { lang, imageBase: TMDB_IMAGE_URL };
}

// ─── Cartes ──────────────────────────────────────────────────────────────────

/** Carte centrée sur un film ou une série. Rejette si la fiche est introuvable. */
export async function fetchWorkMap(type: MediaType, id: number, signal?: AbortSignal): Promise<CineMap> {
  const language = getTmdbLanguage();
  const credits = type === 'movie' ? 'credits' : 'aggregate_credits';
  const details = await tmdbGet<RawWorkDetails>(`/${type}/${id}`, {
    language,
    append_to_response: `${credits},keywords,similar,recommendations`,
  }, signal);

  const team = pickWorkTeam(type, details);
  const peopleIds = [...new Set([...team.directors, ...team.actors].map((person) => person.id))];
  // Mots-clés lus pour tous les candidats (20 au plus) dans cette même phase :
  // ceux qui finiront dans une zone plus forte sont écartés à la construction,
  // ce qui évite une troisième phase de requêtes.
  const candidates = pickMoodCandidates(type, details);
  const collectionId = type === 'movie' ? details.belongs_to_collection?.id : undefined;
  const [collection, filmographies, keywordLists, english] = await Promise.all([
    collectionId
      ? optional(tmdbGet<RawCollection>(`/collection/${collectionId}`, { language }, signal), 'saga', signal)
      : Promise.resolve(undefined),
    Promise.all(peopleIds.map((personId) => optional(
      tmdbGet<RawPersonCredits>(`/person/${personId}/combined_credits`, { language }, signal),
      `filmographie ${personId}`,
      signal,
    ))),
    // Les mots-clés ne sont jamais traduits par TMDB : sans langue, le cache
    // sert toutes les langues de l'interface.
    Promise.all(candidates.map((candidate) => optional(
      tmdbGet<RawKeywords>(`/${candidate.type}/${candidate.raw.id}/keywords`, {}, signal),
      `mots-clés ${candidate.key}`,
      signal,
    ))),
    needsEnglish(details.overview, language)
      ? optional(tmdbGet<RawWorkDetails>(`/${type}/${id}`, { language: 'en-US' }, signal), 'résumé anglais', signal)
      : Promise.resolve(undefined),
  ]);
  throwIfAborted(signal);

  const personCredits: Record<number, RawPersonCredits | undefined> = {};
  peopleIds.forEach((personId, index) => {
    personCredits[personId] = filmographies[index];
  });
  const candidateKeywords: Record<string, RawKeyword[] | undefined> = {};
  candidates.forEach((candidate, index) => {
    const list = keywordLists[index];
    if (list) candidateKeywords[candidate.key] = list.keywords ?? list.results ?? [];
  });
  return buildWorkMap({
    type,
    details: english?.overview ? { ...details, overview: english.overview } : details,
    collection,
    personCredits,
    candidateKeywords,
  }, buildOptions(language));
}

/** Carte centrée sur un artiste. Rejette si la fiche est introuvable. */
export async function fetchPersonMap(id: number, signal?: AbortSignal): Promise<CineMap> {
  const language = getTmdbLanguage();
  const person = await tmdbGet<RawPersonDetails>(`/person/${id}`, {
    language,
    append_to_response: 'combined_credits',
  }, signal);

  const sources = pickPersonSources(person);
  const [castings, english] = await Promise.all([
    // Le casting ne dépend pas de la langue : cache commun à toutes.
    Promise.all(sources.map((source) => optional(
      tmdbGet<RawCredits>(
        source.type === 'movie' ? `/movie/${source.id}/credits` : `/tv/${source.id}/aggregate_credits`,
        {},
        signal,
      ),
      `casting ${source.key}`,
      signal,
    ))),
    needsEnglish(person.biography, language)
      ? optional(tmdbGet<RawPersonDetails>(`/person/${id}`, { language: 'en-US' }, signal), 'biographie anglaise', signal)
      : Promise.resolve(undefined),
  ]);
  throwIfAborted(signal);

  const workCredits: Record<string, RawCredits | undefined> = {};
  sources.forEach((source, index) => {
    workCredits[source.key] = castings[index];
  });
  return buildPersonMap({
    person: english?.biography ? { ...person, biography: english.biography } : person,
    workCredits,
  }, buildOptions(language));
}

// ─── Recherche et tendances ──────────────────────────────────────────────────

/** Films, séries et artistes pour choisir un centre (2 caractères minimum). */
export async function searchCineGraph(query: string, signal?: AbortSignal): Promise<SearchHit[]> {
  const text = query.trim();
  if (text.length < 2) return [];
  const language = getTmdbLanguage();
  const data = await tmdbGet<{ results?: RawSearchResult[] }>('/search/multi', {
    language,
    query: text,
    include_adult: 'false',
  }, signal);
  return toSearchHits(data.results ?? [], buildOptions(language)).slice(0, SEARCH_LIMIT);
}

/** Films et séries de la semaine, pour proposer un premier centre. */
export async function fetchTrending(signal?: AbortSignal): Promise<SearchHit[]> {
  const language = getTmdbLanguage();
  const data = await tmdbGet<{ results?: RawSearchResult[] }>('/trending/all/week', { language }, signal);
  return toSearchHits(data.results ?? [], buildOptions(language))
    .filter((hit) => hit.type !== 'person')
    .slice(0, TRENDING_LIMIT);
}
