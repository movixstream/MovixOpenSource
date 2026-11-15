/**
 * FrenchStream helper module.
 * Extracted from server.js -- retrieves Omega sources from FrVideoSRC (ex-FrenchCloud).
 * This is NOT an Express router; it exports plain functions used by tmdb.js.
 */

const cheerio = require('cheerio');
const axios = require('axios');

const FRENCHSTREAM_BASE_URL = 'https://frenchstream.food';
// FrenchCloud est devenu FrVideoSRC. La page /film/<imdb> ou /serial/<imdb>
// porte un jeton signé que /api/embed-links échange contre les lecteurs.
const FRVIDEOSRC_BASE_URL = 'https://frvideosrc.co';
const FRVIDEOSRC_HOSTS = ['frvideosrc.co', 'frenchcloud.cam'];
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';
// tmdb.js reconnaît ces messages comme « contenu absent », pas comme une panne.
const MOVIE_NOT_FOUND = 'Movie not found on FrenchCloud';
const SERIES_NOT_FOUND = 'Series not found on FrenchCloud (404)';

// ---------------------------------------------------------------------------
// Dependencies injected via configure()
// ---------------------------------------------------------------------------
let axiosFrenchStreamRequest;
let findTvSeriesOnTMDB;

/**
 * Inject runtime dependencies that still live in server.js.
 */
function configure(deps) {
  if (deps.axiosFrenchStreamRequest) axiosFrenchStreamRequest = deps.axiosFrenchStreamRequest;
  if (deps.findTvSeriesOnTMDB) findTvSeriesOnTMDB = deps.findTvSeriesOnTMDB;
}

function getFrVideoSrcUrl(type, imdbId) {
  // Conserver les zéros initiaux de l'identifiant IMDb.
  const id = String(imdbId).replace(/^tt/i, '');
  if (!/^\d+$/.test(id)) throw new Error('Identifiant IMDb invalide');
  return `${FRVIDEOSRC_BASE_URL}/${type}/${id}`;
}

// Le script de la page appelle l'API avec
// JSON.stringify({ type: 'movie', id: "tt…", token: "…" }).
function readEmbedRequest(html) {
  const match = String(html ?? '').match(
    /type:\s*['"](movie|tv)['"]\s*,\s*id:\s*['"](tt\d+)['"]\s*,\s*token:\s*['"]([\w.-]+)['"]/);
  return match ? { type: match[1], id: match[2], token: match[3] } : null;
}

// Renvoie null quand FrVideoSRC n'a pas le titre : la page du lecteur
// s'affiche alors sans jeton.
async function fetchFrVideoSrcLinks(pageUrl) {
  const page = await axios.get(pageUrl, {
    headers: { 'User-Agent': USER_AGENT, 'Referer': `${FRVIDEOSRC_BASE_URL}/` },
    timeout: 15000,
    decompress: true,
  });
  const payload = readEmbedRequest(page.data);
  if (!payload) {
    if (/class="embed-body"/.test(String(page.data ?? ''))) return null;
    throw new Error('Page FrVideoSRC invalide');
  }
  const response = await axios.post(`${FRVIDEOSRC_BASE_URL}/api/embed-links`, payload, {
    headers: {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/json',
      'Origin': FRVIDEOSRC_BASE_URL,
      'Referer': pageUrl,
    },
    timeout: 15000,
    decompress: true,
  });
  if (!response.data?.ok) {
    const code = response.data?.error ? ` (${response.data.error})` : '';
    throw new Error(`Réponse FrVideoSRC invalide${code}`);
  }
  return response.data;
}

function normalizeFrVideoSrcPlayerLink(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, FRVIDEOSRC_BASE_URL);
    if (!['http:', 'https:'].includes(url.protocol) ||
        FRVIDEOSRC_HOSTS.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return null;
    return url.href;
  } catch {
    return null;
  }
}

// Lecteurs dans l'ordre de FrVideoSRC (rank), sans doublon ni lien interne.
function toPlayers(sources) {
  const ranked = (Array.isArray(sources) ? sources : [])
    .filter(source => source && typeof source === 'object')
    .sort((a, b) => (Number(a.rank) || Infinity) - (Number(b.rank) || Infinity));
  const players = [];
  for (const source of ranked) {
    const link = normalizeFrVideoSrcPlayerLink(source.url);
    if (!link || players.some(player => player.link === link)) continue;
    const name = String(source.name || new URL(link).hostname).replace(/\.[a-z]{2,4}$/i, '');
    players.push({ name: name.charAt(0).toUpperCase() + name.slice(1), link });
  }
  return players;
}

// ---------------------------------------------------------------------------
// getFrenchStreamMovie
// ---------------------------------------------------------------------------
async function getFrenchStreamMovie(imdbId) {
  try {
    const iframeSrc = getFrVideoSrcUrl('film', imdbId);
    const data = await fetchFrVideoSrcLinks(iframeSrc);
    if (!data) return { error: MOVIE_NOT_FOUND };

    return {
      iframe_src: iframeSrc,
      player_links: toPlayers(data.sources).map(player => ({ player: player.name, link: player.link, is_hd: false })),
    };

  } catch (error) {
    if (error.response?.status === 404) return { error: MOVIE_NOT_FOUND };
    return { error: `Failed to fetch movie data: ${error.message}` };
  }
}

// ---------------------------------------------------------------------------
// getFrenchStreamSeries
// ---------------------------------------------------------------------------
async function getFrenchStreamSeries(id) {
  try {
    const link = getFrVideoSrcUrl('serial', id);
    const details = await getFrenchStreamSeriesDetails(link, id);
    if (details.error) return details;
    const episodeCount = details.seasons.reduce((count, season) => count + season.episodes.length, 0);
    if (!episodeCount) return [];

    const languages = new Set(details.seasons.flatMap(season =>
      season.episodes.flatMap(episode => Object.keys(episode.versions))));
    return [{
      ...details,
      link,
      poster: null,
      audio_type: [...languages].map(language => language.toUpperCase()).join(' / '),
      episode_count: episodeCount,
    }];
  } catch (error) {
    return { error: `Erreur lors de la recuperation des series: ${error.message}` };
  }
}

// ---------------------------------------------------------------------------
// getFrenchStreamSeriesDetails
// ---------------------------------------------------------------------------
async function getFrenchStreamSeriesDetails(seriesUrl, originalTitle) {
  try {
    // Les anciens liens en cache pointent encore sur frenchcloud.cam : seul le
    // chemin /serial/<imdb> est repris, toujours sur FrVideoSRC.
    const pageUrl = new URL(new URL(seriesUrl, FRVIDEOSRC_BASE_URL).pathname, FRVIDEOSRC_BASE_URL).href;
    const data = await fetchFrVideoSrcLinks(pageUrl);
    if (!data) return { error: SERIES_NOT_FOUND };
    if (!data.tv || !Array.isArray(data.tv.seasons)) throw new Error('Réponse FrVideoSRC invalide');

    const title = String(data.tv.title || '').trim() || originalTitle;
    const seasons = [];
    for (const season of data.tv.seasons) {
      const seasonNumber = Number(season?.season_number);
      if (!Number.isInteger(seasonNumber)) continue;

      const episodes = [];
      for (const episode of Array.isArray(season.episodes) ? season.episodes : []) {
        const episodeNumber = Number(episode?.episode_number);
        const players = toPlayers(episode?.sources);
        if (!Number.isInteger(episodeNumber) || !players.length) continue;
        const number = String(episodeNumber);
        const episodeTitle = String(episode.title || '').trim() || `Épisode ${number}`;
        // L'API ne donne pas la langue : VF sauf mention VOSTFR, comme avant.
        const language = /vostfr/i.test(`${episode.title || ''} ${episode.description || ''}`) ? 'vostfr' : 'vf';
        episodes.push({
          number,
          versions: {
            [language]: { title: episodeTitle, players: players.map(player => ({ name: new URL(player.link).hostname, link: player.link })) },
          },
        });
      }

      seasons.push({
        number: seasonNumber,
        title: `Saison ${seasonNumber}`,
        episodes: episodes.sort((a, b) => Number(a.number) - Number(b.number)),
      });
    }
    seasons.sort((a, b) => a.number - b.number);

    // L'embed ne fournit plus la date de sortie ni le synopsis de FrenchStream.
    const tmdbData = title && seasons.some(season => season.episodes.length) && findTvSeriesOnTMDB
      ? await findTvSeriesOnTMDB(title, null, null)
      : null;
    return {
      title,
      release_date: null,
      summary: null,
      tmdb_data: tmdbData,
      seasons,
    };
  } catch (error) {
    if (error.response?.status === 404) return { error: SERIES_NOT_FOUND };
    return { error: `Failed to fetch series details: ${error.message}` };
  }
}

// ---------------------------------------------------------------------------
// extractSeriesInfo  -- helper to extract base name and part number
// ---------------------------------------------------------------------------
const extractSeriesInfo = (title) => {
  let baseName = title;
  let partNumber = 1; // Default to part 1
  let seasonInfo = {}; // Store season range if present

  // Match "Part X (Saison Y - Z)"
  const partMatch = title.match(/\s*Part\s+(\d+)\s*\(Saison\s+(\d+)\s*-\s*(\d+)\)/i);
  if (partMatch) {
    partNumber = parseInt(partMatch[1]);
    seasonInfo = {
      part: partNumber,
      start: parseInt(partMatch[2]),
      end: parseInt(partMatch[3])
    };
    // Remove the Part info from the base name
    baseName = baseName.replace(/\s*Part\s+\d+\s*\(Saison\s+\d+\s*-\s*\d+\)/i, '');
  }

  // Remove trailing "- Saison X"
  baseName = baseName.replace(/\s*-\s*Saison\s+\d+$/i, '');

  // Remove potential year in parenthesis if not already removed by part info
  baseName = baseName.replace(/\s*\(\d{4}\)/, '');

  return { baseName: baseName.trim(), partNumber, seasonInfo };
};

// ---------------------------------------------------------------------------
// mergeSeriesParts  -- merge multiple parts of a series
// ---------------------------------------------------------------------------
const mergeSeriesParts = (parts) => {
  if (!parts || parts.length === 0) {
    return null;
  }
  if (parts.length === 1) {
    return parts[0]; // Nothing to merge
  }

  // Sort parts by partNumber (extracted during grouping)
  parts.sort((a, b) => a.partNumber - b.partNumber);

  const mainPart = parts[0];
  const mergedSeasons = [...(mainPart.seasons || [])]; // Start with seasons from part 1

  // Track the maximum season number added so far
  let maxSeasonNumberSoFar = 0;
  if (mergedSeasons.length > 0) {
    maxSeasonNumberSoFar = Math.max(...mergedSeasons.map(s => s.number));
  }

  for (let i = 1; i < parts.length; i++) {
    const currentPart = parts[i];

    // Calculate the adjustment based on the max season number from the *previous* merged parts
    const adjustment = maxSeasonNumberSoFar;

    if (!currentPart.seasons || currentPart.seasons.length === 0) {
      console.log(`    Part ${currentPart.partNumber} has no seasons to merge.`);
      continue;
    }

    console.log(`    Adjusting ${currentPart.seasons.length} season(s) for Part ${currentPart.partNumber}.`);

    let partMaxSeason = 0; // Track max season added *in this part*
    currentPart.seasons.forEach(season => {
      const originalSeasonNumber = season.number;
      // The adjusted season number is the previous max + the original number from this part
      const adjustedSeasonNumber = adjustment + originalSeasonNumber;
      console.log(`      Merging Season ${originalSeasonNumber} -> ${adjustedSeasonNumber}`);

      // Create a new season object to avoid modifying the original
      const adjustedSeason = {
        ...season,
        number: adjustedSeasonNumber,
        // Adjust title like "Saison X"
        title: `Saison ${adjustedSeasonNumber}`
      };
      mergedSeasons.push(adjustedSeason);
      if (adjustedSeasonNumber > partMaxSeason) {
        partMaxSeason = adjustedSeasonNumber;
      }
    });
    // Update the overall max season number
    maxSeasonNumberSoFar = partMaxSeason;
  }

  // Return the main part with merged seasons
  // Ensure seasons are sorted correctly after merging
  mergedSeasons.sort((a, b) => a.number - b.number);

  return {
    ...mainPart, // Use metadata from the main part
    seasons: mergedSeasons
  };
};

// ---------------------------------------------------------------------------
// cleanTvCacheData  -- helper to clean TV cache data before sending
// ---------------------------------------------------------------------------
const cleanTvCacheData = (cachedData) => {
  if (!cachedData || !cachedData.series) {
    return cachedData; // Return as is if structure is unexpected
  }
  return {
    type: cachedData.type || 'tv', // ensure type is present
    series: (cachedData.series || []).map(s => ({
      title: s.title || s.baseName, // Use baseName if available
      audio_type: s.audio_type,
      episode_count: s.episode_count,
      release_date: s.release_date,
      summary: s.summary,
      tmdb_data: s.tmdb_data ? {
        id: s.tmdb_data.id,
        name: s.tmdb_data.name,
        overview: s.tmdb_data.overview,
        first_air_date: s.tmdb_data.first_air_date,
        poster_path: s.tmdb_data.poster_path,
        backdrop_path: s.tmdb_data.backdrop_path,
        vote_average: s.tmdb_data.vote_average,
        match_score: s.tmdb_data.match_score,
        is_season_part: s.tmdb_data.is_season_part, // Include season part info
        season_offset: s.tmdb_data.season_offset
      } : null,
      seasons: s.seasons || []
    }))
  };
};

// ---------------------------------------------------------------------------
// checkFrenchStreamVersion
// ---------------------------------------------------------------------------
async function checkFrenchStreamVersion(imdbId) {
  try {
    const url = `${FRENCHSTREAM_BASE_URL}/xfsearch/${imdbId}`;
    const response = await axiosFrenchStreamRequest({ method: 'get', url });
    const $ = cheerio.load(response.data);

    // Recherche de la version du film avec le XPath fourni
    const versionElement = $('*[id="dle-content"] div div span:nth-child(2) a');
    const version = versionElement.text().trim();

    return {
      version: version || 'Unknown',
      url: versionElement.attr('href') || null
    };
  } catch (error) {
    return { version: 'Unknown', url: null };
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  configure,
  getFrenchStreamMovie,
  getFrenchStreamSeries,
  getFrenchStreamSeriesDetails,
  extractSeriesInfo,
  mergeSeriesParts,
  cleanTvCacheData,
  checkFrenchStreamVersion
};
