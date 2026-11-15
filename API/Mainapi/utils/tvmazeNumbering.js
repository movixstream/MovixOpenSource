/**
 * Numérotation TVmaze d'une série, pour les sources qui la suivent.
 *
 * Exemple : FStream range Lupin comme TVmaze (4 parties de 5 / 5 / 7 / 8
 * épisodes), TMDB en 3 saisons de 10 / 7 / 8. Le site demande toujours la
 * numérotation TMDB : on retrouve l'épisode par sa place dans la série, et
 * seulement si les deux bases comptent le même nombre d'épisodes.
 */

const axios = require('axios');
const { memoryCache } = require('../config/redis');
const { resolveImdbId } = require('../services/mediaSegments/identifiers');

const API_URL = 'https://api.tvmaze.com';
const CACHE_PREFIX = 'tvmaze:season-counts:v1:';
const TTL_FOUND = 12 * 3600;
const TTL_MISS = 6 * 3600;
const REQUEST_OPTIONS = { timeout: 5000, headers: { Accept: 'application/json' } };
const pending = new Map();

const isCount = value => Number.isSafeInteger(value) && value > 0;
const seasonsOf = counts => Object.keys(counts || {}).map(Number)
  .filter(season => season >= 1 && isCount(counts[season])).sort((a, b) => a - b);

/** Épisodes par saison (saisons ≥ 1) d'une fiche série TMDB. */
function tmdbSeasonCounts(details) {
  const counts = {};
  for (const season of Array.isArray(details?.seasons) ? details.seasons : []) {
    if (Number.isSafeInteger(season?.season_number) && season.season_number >= 1 && isCount(season.episode_count)) {
      counts[season.season_number] = season.episode_count;
    }
  }
  return counts;
}

/**
 * Épisodes TVmaze `{ season, episode }` de la saison TMDB `season`, dans
 * l'ordre (index 0 = épisode 1). `null` si le découpage est le même, ou si
 * les deux bases ne comptent pas le même nombre d'épisodes.
 */
function mapTmdbSeasonToTvmaze(tmdbCounts, tvmazeCounts, season) {
  const tmdbSeasons = seasonsOf(tmdbCounts);
  if (!tmdbSeasons.includes(season)) return null;
  const tvmazeEpisodes = seasonsOf(tvmazeCounts).flatMap(item =>
    Array.from({ length: tvmazeCounts[item] }, (_, index) => ({ season: item, episode: index + 1 })));
  const total = tmdbSeasons.reduce((sum, item) => sum + tmdbCounts[item], 0);
  if (total !== tvmazeEpisodes.length) return null;
  const start = tmdbSeasons.filter(item => item < season).reduce((sum, item) => sum + tmdbCounts[item], 0);
  const episodes = tvmazeEpisodes.slice(start, start + tmdbCounts[season]);
  return episodes.every((item, index) => item.season === season && item.episode === index + 1) ? null : episodes;
}

/**
 * La source suit TVmaze si sa saison `season` compte autant d'épisodes que
 * chez TVmaze, alors que TMDB en compte un autre nombre.
 */
function sourceFollowsTvmaze(sourceEpisodeCount, tmdbCounts, tvmazeCounts, season) {
  const expected = tvmazeCounts?.[season];
  return isCount(expected) && expected !== tmdbCounts?.[season] && sourceEpisodeCount === expected;
}

async function loadSeasonCounts(tmdbId) {
  const imdbId = await resolveImdbId('tv', tmdbId);
  // resolveImdbId mémorise déjà un vrai absent : sans identifiant, rien n'est gardé ici.
  if (!imdbId) throw new Error('Identifiant IMDb indisponible');
  let show;
  try {
    show = (await axios.get(`${API_URL}/lookup/shows`, { ...REQUEST_OPTIONS, params: { imdb: imdbId } })).data;
  } catch (error) {
    if (error?.response?.status === 404) return null;
    throw error;
  }
  if (!Number.isSafeInteger(show?.id) || show?.externals?.imdb !== imdbId) return null;
  const { data } = await axios.get(`${API_URL}/shows/${show.id}/episodes`, REQUEST_OPTIONS);
  if (!Array.isArray(data)) throw new Error('Liste d’épisodes TVmaze inattendue');
  const counts = {};
  for (const episode of data) {
    if (Number.isSafeInteger(episode?.season) && episode.season >= 1 && isCount(episode?.number)) {
      counts[episode.season] = (counts[episode.season] || 0) + 1;
    }
  }
  return seasonsOf(counts).length ? counts : null;
}

/**
 * Épisodes par saison chez TVmaze, ou `null` (série inconnue, TVmaze en
 * panne). Une réponse est gardée 12 h, un absent 6 h ; une panne ne l'est pas.
 */
async function fetchTvmazeSeasonCounts(tmdbId) {
  const key = `${CACHE_PREFIX}${tmdbId}`;
  const hit = await memoryCache.get(key);
  if (hit !== undefined) return hit;
  let request = pending.get(key);
  if (!request) {
    request = loadSeasonCounts(tmdbId)
      .then(async counts => {
        await memoryCache.set(key, counts, counts ? TTL_FOUND : TTL_MISS);
        return counts;
      }, () => null)
      .finally(() => pending.delete(key));
    pending.set(key, request);
  }
  return request;
}

module.exports = { tmdbSeasonCounts, mapTmdbSeasonToTvmaze, sourceFollowsTvmaze, fetchTvmazeSeasonCounts };
