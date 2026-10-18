import type { TvAiringSchedule, TvExternalIds, TvmazeEpisode } from '@/types/tvAiring';

const API_URL = 'https://api.tvmaze.com';
const CACHE_TTL_MS = 15 * 60_000;
const FAILURE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 100;
const cache = new Map<string, { expires: number; value: TvAiringSchedule | null }>();
const pending = new Map<string, Promise<TvAiringSchedule | null>>();

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const getJson = async (path: string): Promise<unknown> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`${API_URL}${path}`, {
      signal: controller.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json' },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`TVmaze HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
};

const parseEpisode = (
  episode: Record<string, unknown>,
  season: number,
  number: number,
  airdate: unknown,
): TvmazeEpisode => {
  const image = record(episode.image) ? episode.image.original ?? episode.image.medium : null;
  return {
    id: Number.isSafeInteger(episode.id) ? Number(episode.id) : 0,
    season,
    number,
    name: typeof episode.name === 'string' ? episode.name : '',
    airdate: typeof airdate === 'string' && airdate ? airdate : null,
    runtime: Number.isFinite(episode.runtime) ? Number(episode.runtime) : null,
    image: typeof image === 'string' && /^https:\/\//.test(image) ? image : null,
    // TVmaze renvoie du HTML : on ne garde que le texte.
    summary: typeof episode.summary === 'string' ? episode.summary.replace(/<[^>]*>/g, '').trim() : '',
  };
};

/**
 * Ordre Netflix publié par TVmaze (ex. La Casa de Papel : 5 parties chez
 * Netflix, 4 saisons à la diffusion espagnole). Une erreur ici n'empêche
 * pas d'utiliser la liste normale.
 */
const fetchNetflixList = async (showId: number): Promise<TvmazeEpisode[] | undefined> => {
  try {
    const lists = await getJson(`/shows/${showId}/alternatelists`);
    if (!Array.isArray(lists)) return undefined;
    const netflix = lists.filter((list): list is Record<string, unknown> => record(list)
      && Number.isSafeInteger(list.id) && record(list.webChannel) && list.webChannel.name === 'Netflix');
    // La liste de mise en ligne d'abord, sinon une autre liste Netflix (ex. version anglaise).
    const list = netflix.find((item) => item.streaming_premiere === true) ?? netflix[0];
    if (!list) return undefined;
    const data = await getJson(`/alternatelists/${list.id}/alternateepisodes?embed=episodes`);
    if (!Array.isArray(data)) return undefined;
    const episodes: TvmazeEpisode[] = [];
    for (const item of data) {
      if (!record(item) || !Number.isSafeInteger(item.season) || Number(item.season) < 1
        || !Number.isSafeInteger(item.number) || Number(item.number) < 1) continue;
      // Le titre, le résumé et l'image viennent de l'épisode d'origine ; la
      // date reste celle de la mise en ligne sur Netflix.
      const embedded = record(item._embedded) && Array.isArray(item._embedded.episodes)
        ? item._embedded.episodes.find(record) : null;
      episodes.push(parseEpisode(embedded ?? item, Number(item.season), Number(item.number), item.airdate));
    }
    return episodes.length ? episodes : undefined;
  } catch {
    return undefined;
  }
};

const fetchSchedule = async (lookups: Array<[string, string]>): Promise<TvAiringSchedule | null> => {
  for (const [kind, id] of lookups) {
    const show = await getJson(`/lookup/shows?${kind}=${encodeURIComponent(id)}`);
    if (show === null) continue;
    if (!record(show) || !Number.isSafeInteger(show.id) || Number(show.id) <= 0
      || !record(show.externals) || String(show.externals[kind]) !== id) return null;

    const [data, netflixEpisodeList] = await Promise.all([
      getJson(`/shows/${show.id}/episodes`),
      fetchNetflixList(Number(show.id)),
    ]);
    if (!Array.isArray(data)) return null;
    const episodes: TvAiringSchedule['episodes'] = {};
    const episodeList: TvAiringSchedule['episodeList'] = [];
    for (const episode of data) {
      if (!record(episode) || !Number.isSafeInteger(episode.season) || Number(episode.season) < 1
        || !Number.isSafeInteger(episode.number) || Number(episode.number) < 1) continue;
      // TVmaze peut fournir un airstamp par défaut même lorsque airtime est vide.
      const hasTime = typeof episode.airtime === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(episode.airtime);
      const stamp = hasTime && typeof episode.airstamp === 'string'
        && /T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:\d{2})$/.test(episode.airstamp)
        && Number.isFinite(Date.parse(episode.airstamp)) ? episode.airstamp : null;
      episodes[`${episode.season}:${episode.number}`] = {
        date: typeof episode.airdate === 'string' ? episode.airdate : null,
        timestamp: stamp,
      };
      episodeList.push(parseEpisode(episode, Number(episode.season), Number(episode.number), episode.airdate));
    }
    const onNetflix = [show.webChannel, show.network].some((channel) => record(channel) && channel.name === 'Netflix');
    return {
      sourceUrl: `https://www.tvmaze.com/shows/${show.id}`,
      episodes,
      episodeList,
      ...(netflixEpisodeList ? { netflixEpisodeList } : {}),
      ...(onNetflix ? { onNetflix } : {}),
    };
  }
  return null;
};

/** Données publiques uniquement. Une panne TVmaze laisse la fiche TMDB utilisable. */
export const getTvAiringSchedule = async (ids?: TvExternalIds): Promise<TvAiringSchedule | null> => {
  const lookups: Array<[string, string]> = [];
  if (typeof ids?.imdb_id === 'string' && /^tt\d+$/.test(ids.imdb_id)) lookups.push(['imdb', ids.imdb_id]);
  if (Number.isSafeInteger(ids?.tvdb_id) && Number(ids?.tvdb_id) > 0) lookups.push(['thetvdb', String(ids!.tvdb_id)]);
  if (!lookups.length) return null;
  const key = JSON.stringify(lookups);
  const saved = cache.get(key);
  if (saved && saved.expires > Date.now()) return saved.value;
  const existing = pending.get(key);
  if (existing) return existing;

  const request = fetchSchedule(lookups).catch(() => null).then((value) => {
    cache.delete(key);
    cache.set(key, { value, expires: Date.now() + (value ? CACHE_TTL_MS : FAILURE_TTL_MS) });
    if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
    return value;
  }).finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
};
