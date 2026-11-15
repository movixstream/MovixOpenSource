import { useEffect, useState } from 'react';
import axios from 'axios';
import { getTmdbLanguage } from '../i18n';

const TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY || '';
// v6 : retrait du champ `posterUrls: string[]` (cycling Top 10 supprimé).
// Bumper invalide les anciennes entrées v5 qui contenaient ce champ —
// pas strictement nécessaire pour la correctness (les champs en trop sont
// ignorés), mais évite de transporter du payload mort en sessionStorage.
const CACHE_KEY = 'movix_tmdb_images_cache_v7';
const CACHE_TIMESTAMP_KEY = 'movix_tmdb_images_cache_v7_timestamp';
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CACHE_ENTRIES = 500;

type ImageEntry = {
  logoUrl: string | null;
  posterUrl: string | null;
};

type HookEntry = {
  key: string | null;
  value: ImageEntry;
};

const EMPTY_IMAGE_ENTRY: ImageEntry = Object.freeze({ logoUrl: null, posterUrl: null });

// Normalise une entrée cache (potentiellement persistée par une version
// antérieure du schéma) → toujours retourner une ImageEntry complète. Évite
// les `undefined.x` côté consumer si on bump le format sans bumper la
// cache key, ou si une entrée corrompue traîne en sessionStorage.
function normalizeEntry(raw: unknown): ImageEntry {
  if (!raw || typeof raw !== 'object') {
    return { logoUrl: null, posterUrl: null };
  }
  const e = raw as Partial<ImageEntry>;
  return {
    logoUrl: typeof e.logoUrl === 'string' ? e.logoUrl : null,
    posterUrl: typeof e.posterUrl === 'string' ? e.posterUrl : null,
  };
}

// Copie mémoire du cache sessionStorage, tenue au niveau module (même pattern
// que le `inflight` Map ci-dessous). getCache() est appelé plusieurs dizaines
// de fois par row révélée au scroll (2× par mount de CarouselCard + 2× dans
// fetchAndCache) — sans ça, chaque appel refaisait un sessionStorage.getItem
// + JSON.parse du blob COMPLET. Hydratée depuis sessionStorage seulement au
// premier appel ou après expiration TTL ; setCache met à jour la copie
// mémoire et diffère la persistance. Best-effort multi-onglets : une divergence
// temporaire entre onglets (un autre onglet écrit pendant que le TTL courant
// est encore valide ici) est acceptable.
let memoryCache: Map<string, ImageEntry> | null = null;
let memoryCacheTimestamp = 0;

// Helper functions for sessionStorage cache
function trimCache(cache: Map<string, ImageEntry>): void {
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (oldestKey === undefined) return;
    cache.delete(oldestKey);
  }
}

function getCache(): Map<string, ImageEntry> {
  const now = Date.now();
  if (memoryCache && (now - memoryCacheTimestamp) < CACHE_DURATION_MS) {
    return memoryCache;
  }

  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    const timestamp = sessionStorage.getItem(CACHE_TIMESTAMP_KEY);

    if (cached && timestamp) {
      const parsedTimestamp = parseInt(timestamp);
      const isValid = (now - parsedTimestamp) < CACHE_DURATION_MS;
      if (isValid) {
        const parsed = JSON.parse(cached) as Record<string, unknown>;
        const normalized = new Map<string, ImageEntry>();
        for (const k of Object.keys(parsed)) {
          normalized.set(k, normalizeEntry(parsed[k]));
        }
        trimCache(normalized);
        memoryCache = normalized;
        memoryCacheTimestamp = parsedTimestamp;
        return memoryCache;
      }
    }
  } catch {
    // Ignore parse errors
  }

  memoryCache = new Map();
  memoryCacheTimestamp = now;
  return memoryCache;
}

function readCacheEntry(key: string): ImageEntry | undefined {
  const cache = getCache();
  const entry = cache.get(key);
  if (!entry) return undefined;

  // Map conserve l'ordre d'insertion : replacer une entrée lue en fin donne
  // un LRU simple sans compteur ni timestamp par carte.
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

let cacheWriteTimer: ReturnType<typeof setTimeout> | undefined;
let cacheWriteIdle: number | undefined;

function persistCache() {
  if (cacheWriteTimer !== undefined) clearTimeout(cacheWriteTimer);
  if (cacheWriteIdle !== undefined) window.cancelIdleCallback?.(cacheWriteIdle);
  cacheWriteTimer = cacheWriteIdle = undefined;
  if (!memoryCache) return;
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(memoryCache)));
    sessionStorage.setItem(CACHE_TIMESTAMP_KEY, memoryCacheTimestamp.toString());
  } catch {
    // Cache best-effort: private browsing and full storage must still work.
  }
}

function setCacheEntry(key: string, entry: ImageEntry) {
  const cache = getCache();
  cache.delete(key);
  cache.set(key, entry);
  trimCache(cache);
  memoryCache = cache;
  memoryCacheTimestamp = Date.now();
  // Updating React consumers only needs the memory cache. Coalesce the full
  // JSON serialization/storage write instead of doing it for every poster.
  if (cacheWriteTimer !== undefined || cacheWriteIdle !== undefined) return;
  cacheWriteTimer = setTimeout(() => {
    cacheWriteTimer = undefined;
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      cacheWriteIdle = window.requestIdleCallback(persistCache, { timeout: 2000 });
    } else {
      persistCache();
    }
  }, 1000);
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (cacheWriteTimer !== undefined || cacheWriteIdle !== undefined) persistCache();
  });
}

// Shared across every carousel and hook, also before the service worker has
// taken control. A per-row limit still multiplies the work by the row count.
const MAX_IMAGE_REQUESTS = 3;
let activeImageRequests = 0;
const pendingImageRequests: Array<() => void> = [];

function withImageRequestSlot<T>(request: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      activeImageRequests++;
      void Promise.resolve().then(request).then(resolve, reject).finally(() => {
        activeImageRequests--;
        pendingImageRequests.shift()?.();
      });
    };
    if (activeImageRequests < MAX_IMAGE_REQUESTS) run();
    else pendingImageRequests.push(run);
  });
}

// Pick the best image asset by language priority: interface lang > EN > untagged > any.
// IMPORTANT : sans le param API `include_image_language`, TMDB ne renvoie que
// `iso_639_1: 'en'` et `null` (untagged). On force `fr,en,null` pour avoir le
// jeu complet — sinon le find('fr') ne match JAMAIS.
type TmdbImage = { file_path: string; iso_639_1: string | null };

// Langue d'interface (2 lettres, ex. 'fr', 'tr', 'ar') — 'en' en dernier recours.
const getImageLanguage = (): string =>
  getTmdbLanguage().split('-')[0].toLowerCase() || 'en';

// Priorité : langue d'interface > EN > sans langue (untagged).
const getLanguagePriority = (preferredLanguage: string): Array<string | null> =>
  preferredLanguage === 'en' ? ['en', null] : [preferredLanguage, 'en', null];

const getCacheEntryKey = (mediaType: 'movie' | 'tv', id: number, language: string) =>
  `${mediaType}_${id}_${language}`;

/** Remplace la taille dans une URL image TMDB (ex. w342 → w500). */
export const withTmdbImageSize = (url: string, size: string): string =>
  url.replace(/\/t\/p\/[^/]+\//, `/t/p/${size}/`);

function pickBestImage(images: TmdbImage[], preferredLanguage: string): TmdbImage | null {
  if (!Array.isArray(images) || images.length === 0) return null;

  return (
    getLanguagePriority(preferredLanguage)
      .map((language) => images.find((image) => image.iso_639_1 === language))
      .find(Boolean) ||
    images[0] ||
    null
  );
}

// Promesses en vol partagées au scope module. Si plusieurs cards (même
// carousel ou carousels différents) demandent la même paire (mediaType, id)
// au même moment, elles JOIGNENT la même Promise au lieu de fire 30 requêtes
// redondantes pour le même item. Les requêtes en attente partagent aussi
// cette Promise, y compris entre prefetch et hooks.
type ImageRequest = {
  promise: Promise<ImageEntry>;
  consumers: Set<() => boolean>;
};
const inflight = new Map<string, ImageRequest>();

async function fetchAndCache(
  mediaType: 'movie' | 'tv',
  id: number,
  language: string,
  isNeeded: () => boolean = () => true,
): Promise<ImageEntry> {
  const key = getCacheEntryKey(mediaType, id, language);
  const cached = readCacheEntry(key);
  if (cached) return cached;
  const pending = inflight.get(key);
  if (pending) {
    pending.consumers.add(isNeeded);
    return pending.promise;
  }

  const consumers = new Set([isNeeded]);

  const promise = withImageRequestSlot(async () => {
    try {
      // A fast scroll can hide a card before it gets a network slot. Skip its
      // queued work unless another card (or an explicit prefetch) still needs
      // the same metadata. Do not cache a skipped request as a missing image.
      if (![...consumers].some((needed) => needed())) return EMPTY_IMAGE_ENTRY;

      // include_image_language=<lang>,en,null = langue d'interface + EN +
      // untagged (sinon TMDB n'expose que en+null par défaut, on perd toutes
      // les versions localisées).
      const includeImageLanguage = getLanguagePriority(language)
        .map((l) => l ?? 'null')
        .join(',');
      const res = await axios.get(`https://api.themoviedb.org/3/${mediaType}/${id}/images`, {
        params: {
          api_key: TMDB_API_KEY,
          include_image_language: includeImageLanguage,
        },
        timeout: 10000,
      });

      const logo = pickBestImage(res.data.logos || [], language);
      const poster = pickBestImage(res.data.posters || [], language);

      const result: ImageEntry = {
        logoUrl: logo ? `https://image.tmdb.org/t/p/w300${logo.file_path}` : null,
        posterUrl: poster ? `https://image.tmdb.org/t/p/w342${poster.file_path}` : null,
      };

      setCacheEntry(key, result);
      return result;
    } catch {
      // Cache empty result to avoid repeated failed requests
      const result: ImageEntry = { logoUrl: null, posterUrl: null };
      setCacheEntry(key, result);
      return result;
    } finally {
      inflight.delete(key);
    }
  });

  inflight.set(key, { promise, consumers });
  return promise;
}

/**
 * Prefetch & cache (logo + poster) sans souscrire à un état React.
 *
 * Joint l'inflight map si une requête est
 * déjà en vol pour la même paire (mediaType, id) → 0 doublon avec les
 * hooks `useTmdbImages` mountés sur les cards qui partagent le même item.
 */
export async function prefetchTmdbImages(mediaType: 'movie' | 'tv', id: number): Promise<void> {
  await fetchAndCache(mediaType, id, getImageLanguage());
}

/**
 * Fetches the best logo + poster (language-prioritized) for a movie or TV show.
 * Single TMDB API call → both URLs returned. Uses sessionStorage cache (24h
 * TTL) keyed by `${mediaType}_${id}`.
 *
 * Sizes :
 *  - logo  → w300 (~30-80 KB) — largement assez pour le display ~28-40px
 *  - poster → w342 (~50-80 KB) — match la taille des cards 192px CSS
 *
 * @param mediaType 'movie' | 'tv'
 * @param id TMDB ID
 * @param refreshKey Optional refresh key
 * @param enabled Fetch missing metadata only when the card is near the viewport
 * @returns { logoUrl, posterUrl } — null si non disponible
 */
export function useTmdbImages(
  mediaType: 'movie' | 'tv' | undefined,
  id: number | undefined,
  refreshKey?: number,
  enabled = true,
): ImageEntry {
  const imageLanguage = getImageLanguage();
  const currentKey = mediaType && id
    ? getCacheEntryKey(mediaType, id, imageLanguage)
    : null;

  // Init synchronously from cache : si l'entrée a déjà été fetchée par le
  // prefetch idle d'EmblaCarousel ou par un autre hook au mount précédent,
  // on retourne la valeur dès le premier render — 0 flicker.
  const [entry, setEntry] = useState<HookEntry>(() => {
    if (!currentKey) return { key: null, value: EMPTY_IMAGE_ENTRY };
    return {
      key: currentKey,
      value: readCacheEntry(currentKey) ?? EMPTY_IMAGE_ENTRY,
    };
  });

  useEffect(() => {
    if (!mediaType || !id || !currentKey) return;

    const cached = readCacheEntry(currentKey);

    if (cached) {
      setEntry(previous => previous.key === currentKey && previous.value === cached
        ? previous
        : { key: currentKey, value: cached });
      return;
    }

    // Ne pas vider une valeur déjà affichée pour cette même clé si son entrée
    // vient d'être évincée du LRU. Si la clé a changé, la garde du return plus
    // bas masque immédiatement l'ancienne valeur pendant ce render.
    if (!enabled) return;
    let cancelled = false;
    fetchAndCache(mediaType, id, imageLanguage, () => !cancelled).then((result) => {
      if (!cancelled) setEntry({ key: currentKey, value: result });
    });
    return () => { cancelled = true; };
  }, [mediaType, id, refreshKey, imageLanguage, currentKey, enabled]);

  if (!currentKey || entry.key !== currentKey) return EMPTY_IMAGE_ENTRY;
  return entry.value;
}

/**
 * Backwards-compat wrapper : `useTmdbLogo` returns just the logoUrl.
 * @deprecated Préférer `useTmdbImages` qui renvoie aussi le poster localisé.
 */
export function useTmdbLogo(
  mediaType: 'movie' | 'tv' | undefined,
  id: number | undefined,
  refreshKey?: number,
): string | null {
  return useTmdbImages(mediaType, id, refreshKey).logoUrl;
}
