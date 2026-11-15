/**
 * TMDB / IMDB routes module.
 * Extracted from server.js -- handles TMDB lookups, IMDB/FrenchStream data,
 * and related cache management.
 *
 * Mounted at /api  (paths below are relative to that prefix).
 */

const express = require('express');
const router = express.Router();
const axios = require('axios');
const path = require('path');
const fsp = require('fs').promises;
const { CACHE_DIR, generateCacheKey } = require('../utils/cacheManager');
const { fetchTmdbDetails, searchTmdb, fetchTmdbImages } = require('../utils/tmdbCache');
const { acquireRedisLock } = require('../utils/redisLock');
const { createSourceRefresh } = require('../utils/sourceRefresh');
const omegaRefresh = createSourceRefresh();
const coflixCloneRefresh = createSourceRefresh();
const coflixRefresh = createSourceRefresh();
const COFLIX_CHECK_INTERVAL = 2 * 60 * 60 * 1000;
const { respondWithResolvedSources } = require('../utils/embedExtraction');

// Coflix et FrenchStream n'ont pas de routeur propre : leurs données sortent
// par /api/tmdb/:type/:id et /api/imdb/:type/:id. Ils rangent leurs lecteurs
// dans `player_links`, à un emplacement qui dépend du type de contenu.
//
// Coflix sert déjà UN épisode par appel (`?season=&episode=`), d'où le chemin
// `current_episode.player_links` côté série.
const respondWithCoflixSources = (req, res, payload, type) =>
  respondWithResolvedSources(req, res, payload, {
    movieMapKey: type === 'tv' ? 'current_episode.player_links' : 'player_links',
    label: 'COFLIX',
  });

// FrenchStream ne prend aucun paramètre d'épisode : sa réponse série porte
// TOUTES les saisons (`seasons[].episodes[].versions`). Résoudre là-dedans
// reviendrait à extraire une série entière pour une seule lecture — on s'en
// tient donc aux films, où `player_links` est à la racine.
const respondWithFrenchStreamSources = (req, res, payload, type) =>
  type === 'tv'
    ? res.json(payload)
    : respondWithResolvedSources(req, res, payload, {
        movieMapKey: 'player_links',
        label: 'FRENCHSTREAM',
      });
const { COFLIX_ENABLED } = require('./coflix');
const {
  applyCloneUrlsToPlayerLinks,
  syncCloneLinksForPlayerLinks
} = require('../utils/cloneLinks');

// ---------------------------------------------------------------------------
// Dependencies injected via configure()
// ---------------------------------------------------------------------------
let TMDB_API_KEY;
let TMDB_API_URL;
let getFromCacheNoExpiration;
let saveToCache;
let shouldUpdateCacheFrenchStream;
let shouldUpdateCacheLecteurVideo;
// Coflix helpers (from coflix.js)
let searchCoflixByTitle;
let getMovieDataFromCoflix;
let getTvDataFromCoflix;
let filterEmmmmbedReaders;

// FrenchStream helpers (from frenchstream.js)
let getFrenchStreamMovie;
let getFrenchStreamSeries;
let getFrenchStreamSeriesDetails;
let extractSeriesInfo;
let mergeSeriesParts;
let cleanTvCacheData;

/**
 * Inject runtime dependencies that still live in server.js or sibling modules.
 */
function configure(deps) {
  if (deps.TMDB_API_KEY) TMDB_API_KEY = deps.TMDB_API_KEY;
  if (deps.TMDB_API_URL) TMDB_API_URL = deps.TMDB_API_URL;
  if (deps.getFromCacheNoExpiration) getFromCacheNoExpiration = deps.getFromCacheNoExpiration;
  if (deps.saveToCache) saveToCache = deps.saveToCache;
  if (deps.shouldUpdateCacheFrenchStream) shouldUpdateCacheFrenchStream = deps.shouldUpdateCacheFrenchStream;
  if (deps.shouldUpdateCacheLecteurVideo) shouldUpdateCacheLecteurVideo = deps.shouldUpdateCacheLecteurVideo;
  // Coflix
  if (deps.searchCoflixByTitle) searchCoflixByTitle = deps.searchCoflixByTitle;
  if (deps.getMovieDataFromCoflix) getMovieDataFromCoflix = deps.getMovieDataFromCoflix;
  if (deps.getTvDataFromCoflix) getTvDataFromCoflix = deps.getTvDataFromCoflix;
  if (deps.filterEmmmmbedReaders) filterEmmmmbedReaders = deps.filterEmmmmbedReaders;

  // FrenchStream
  if (deps.getFrenchStreamMovie) getFrenchStreamMovie = deps.getFrenchStreamMovie;
  if (deps.getFrenchStreamSeries) getFrenchStreamSeries = deps.getFrenchStreamSeries;
  if (deps.getFrenchStreamSeriesDetails) getFrenchStreamSeriesDetails = deps.getFrenchStreamSeriesDetails;
  if (deps.extractSeriesInfo) extractSeriesInfo = deps.extractSeriesInfo;
  if (deps.mergeSeriesParts) mergeSeriesParts = deps.mergeSeriesParts;
  if (deps.cleanTvCacheData) cleanTvCacheData = deps.cleanTvCacheData;
}

function hasPlayableCoflixResult(data, type) {
  if (!data || typeof data !== 'object') return false;

  if (type === 'movie') {
    return Array.isArray(data.player_links) && data.player_links.length > 0;
  }

  if (type === 'tv') {
    return Array.isArray(data.current_episode?.player_links) &&
      data.current_episode.player_links.length > 0;
  }

  return false;
}

async function saveCoflixCachePreservingPlayable(cacheKey, type, candidate) {
  const candidateIsPlayable = hasPlayableCoflixResult(candidate, type);
  const shouldPreserveLatestCache = (latestCache) => {
    if (!hasPlayableCoflixResult(latestCache, type)) {
      return false;
    }

    if (!candidateIsPlayable) {
      return true;
    }

    const latestRefreshedAt = Number(latestCache._coflixRefreshedAt) || 0;
    const candidateRefreshedAt = Number(candidate?._coflixRefreshedAt) || 0;
    return latestRefreshedAt > candidateRefreshedAt;
  };
  const lock = await acquireRedisLock(`coflix-cache-write:${cacheKey}`, {
    ttl: 10,
    retries: 20,
    retryDelay: 50,
  });

  if (!lock) {
    console.warn(`[COFLIX CACHE] Ecriture ignoree sans verrou pour ${cacheKey}`);
    return false;
  }

  try {
    const latestCache = await getFromCacheNoExpiration(CACHE_DIR.COFLIX, cacheKey);
    if (shouldPreserveLatestCache(latestCache)) {
      return false;
    }

    await saveToCache(CACHE_DIR.COFLIX, cacheKey, candidate);
    return true;
  } finally {
    await lock.release();
  }
}

function getCloneScope(type, id, season, episode) {
  return {
    mediaType: type,
    tmdbId: Number(id) || 0,
    seasonNumber: type === 'tv' ? parseInt(season, 10) || 0 : 0,
    episodeNumber: type === 'tv' ? parseInt(episode, 10) || 0 : 0
  };
}

async function applyCloneUrlsToTmdbResult(result, type, id, season, episode) {
  if (!result || typeof result !== 'object') {
    return result;
  }

  const cloneScope = getCloneScope(type, id, season, episode);

  if (type === 'movie' && Array.isArray(result.player_links)) {
    return {
      ...result,
      player_links: await applyCloneUrlsToPlayerLinks({
        ...cloneScope,
        playerLinks: result.player_links
      })
    };
  }

  if (type === 'tv' && result.current_episode && Array.isArray(result.current_episode.player_links)) {
    return {
      ...result,
      current_episode: {
        ...result.current_episode,
        player_links: await applyCloneUrlsToPlayerLinks({
          ...cloneScope,
          playerLinks: result.current_episode.player_links
        })
      }
    };
  }

  return result;
}

async function syncCloneUrlsOnTmdbResult(result, type, id, season, episode) {
  if (!result || typeof result !== 'object') {
    return result;
  }

  const cloneScope = getCloneScope(type, id, season, episode);

  if (type === 'movie' && Array.isArray(result.player_links)) {
    return {
      ...result,
      player_links: await syncCloneLinksForPlayerLinks({
        ...cloneScope,
        playerLinks: result.player_links
      })
    };
  }

  if (type === 'tv' && result.current_episode && Array.isArray(result.current_episode.player_links)) {
    return {
      ...result,
      current_episode: {
        ...result.current_episode,
        player_links: await syncCloneLinksForPlayerLinks({
          ...cloneScope,
          playerLinks: result.current_episode.player_links
        })
      }
    };
  }

  return result;
}

// ---------------------------------------------------------------------------
// getTMDBDetails  -- fetch TMDB details for a given ID and type
// ---------------------------------------------------------------------------
async function getTMDBDetails(id, type) {
  try {
    const data = await fetchTmdbDetails(TMDB_API_URL, TMDB_API_KEY, id, type, 'fr-FR');
    if (!data) return null;

    return {
      id: data.id,
      title: type === 'movie' ? data.title : data.name,
      original_title: type === 'movie' ? data.original_title : data.original_name,
      release_date: type === 'movie' ? data.release_date : data.first_air_date,
      poster_path: data.poster_path,
      backdrop_path: data.backdrop_path,
      overview: data.overview,
      vote_average: data.vote_average
    };
  } catch (error) {
    console.error(`Erreur lors de la recuperation des details TMDB pour ${id} (${type}):`, error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// coflixPosterBelongsToOtherShow -- garde-fou contre les homonymes Coflix
// ---------------------------------------------------------------------------
// Les fiches series Coflix n'ont pas d'annee : « V » (1984, TMDB 75893) tombait
// sur la seule fiche « V » de Coflix, le remake de 2009 (TMDB 21494). L'affiche
// de la carte est une image TMDB : si elle n'appartient pas a la serie demandee
// mais a un homonyme TMDB, la fiche est rejetee. Sans preuve contraire (pas
// d'affiche, erreur TMDB, affiche inconnue), on garde le comportement actuel.
// Les films ont une annee, mais deux homonymes peuvent sortir la meme annee :
// « Kraken » 2026 (TMDB 1571766, francais) recevait le film norvegien 1110034.
async function coflixPosterBelongsToOtherShow(coflixResult, id, type) {
  const poster = coflixResult?.poster;
  if (!poster || (type === 'tv' && coflixResult.year != null)) return false;

  const hasPoster = (images) => Array.isArray(images?.posters) &&
    images.posters.some((p) => p.file_path === poster);

  try {
    const ownImages = await fetchTmdbImages(TMDB_API_URL, TMDB_API_KEY, id, type);
    if (hasPoster(ownImages)) return false;

    const search = await searchTmdb(TMDB_API_URL, TMDB_API_KEY, type, coflixResult.title,
      type === 'movie' && coflixResult.year ? { primary_release_year: coflixResult.year } : {});
    const homonyms = (search?.results || [])
      .filter((show) => String(show.id) !== String(id))
      .slice(0, 5);

    for (const show of homonyms) {
      if (show.poster_path === poster) return true;
      const images = await fetchTmdbImages(TMDB_API_URL, TMDB_API_KEY, show.id, type);
      if (hasPoster(images)) return true;
    }
  } catch (error) {
    console.warn(`[TMDB API] Verification d'affiche Coflix impossible pour ${id}: ${error.message}`);
  }
  return false;
}

// ---------------------------------------------------------------------------
// findTvSeriesOnTMDB  -- search TMDB for TV series and find the best match
// ---------------------------------------------------------------------------
async function findTvSeriesOnTMDB(title, releaseYear, overview) {
  try {
    // Variables pour stocker les informations de saison speciales
    let seasonOffset = 0;
    let isSeasonPart = false;
    let originalTitle = title;

    // Remove "- Saison X" from the title
    let cleanTitle = title.replace(/\s*-\s*Saison\s+\d+$/i, '');

    // Handle special case for series like "Les Simpson Part 2 (Saison 1 - 29) - Saison 8"
    const partMatch = cleanTitle.match(/Part\s+(\d+)\s*\(Saison\s+(\d+)\s*-\s*(\d+)\)/i);
    if (partMatch) {
      isSeasonPart = true;
      const partNumber = parseInt(partMatch[1]);
      const startSeason = parseInt(partMatch[2]);
      const endSeason = parseInt(partMatch[3]);

      // Si c'est la partie 2+, on doit calculer le numero de saison reel
      if (partNumber > 1) {
        // Chercher la saison mentionnee dans le titre
        const seasonMatch = title.match(/Saison\s+(\d+)$/i);
        if (seasonMatch) {
          // On calcule le decalage a partir des informations de saison
          seasonOffset = endSeason - startSeason + 1; // Nombre total de saisons dans la partie 1
        }
      }

      // Remove the part and season range info
      cleanTitle = cleanTitle.replace(/\s*Part\s+\d+\s*\(Saison\s+\d+\s*-\s*\d+\)/i, '');
    }

    // Clean up any remaining parentheses
    cleanTitle = cleanTitle.replace(/\([^)]*\)/g, '').trim();

    // Search for the TV series on TMDB (cached via Redis)
    const searchData = await searchTmdb(TMDB_API_URL, TMDB_API_KEY, 'tv', cleanTitle,
      releaseYear ? { first_air_date_year: releaseYear } : {});

    if (!searchData || !searchData.results || searchData.results.length === 0) {
      return null;
    }

    // Get the first few results
    const potentialMatches = searchData.results.slice(0, 5);

    // Function to calculate similarity between two strings
    const calculateSimilarity = (str1, str2) => {
      if (!str1 || !str2) return 0;

      const s1 = str1.toLowerCase();
      const s2 = str2.toLowerCase();

      // Calculate percentage match
      let matches = 0;
      const words1 = s1.split(/\s+/);
      const words2 = s2.split(/\s+/);

      words1.forEach(word => {
        if (words2.some(w => w.includes(word) || word.includes(w))) {
          matches++;
        }
      });

      return matches / Math.max(words1.length, 1);
    };

    // Find the best match by comparing title, release year, and overview
    let bestMatch = null;
    let highestScore = 0;

    for (const series of potentialMatches) {
      // Calculate match score based on title similarity
      const titleSimilarity = calculateSimilarity(cleanTitle, series.name);

      // Get detailed info for the series to compare overviews (cached via Redis)
      const seriesDetails = await fetchTmdbDetails(TMDB_API_URL, TMDB_API_KEY, series.id, 'tv', 'en-US');
      if (!seriesDetails) continue;

      const overviewSimilarity = overview && seriesDetails.overview
        ? calculateSimilarity(overview, seriesDetails.overview)
        : 0;

      // Year match (exact match gives bonus)
      const yearMatch = releaseYear && series.first_air_date ?
        (parseInt(series.first_air_date.split('-')[0]) === parseInt(releaseYear) ? 1 : 0) : 0;

      // Calculate total score (weighted)
      const totalScore = (titleSimilarity * 0.7) + (overviewSimilarity * 0.2) + (yearMatch * 0.1);

      if (totalScore > highestScore) {
        highestScore = totalScore;
        bestMatch = {
          ...seriesDetails,
          match_score: totalScore
        };
      }
    }

    // Si on a trouve une correspondance et qu'il s'agit d'une saison speciale
    if (bestMatch && isSeasonPart) {
      // Ajouter les informations relatives a la saison dans les donnees TMDB
      bestMatch.is_season_part = true;
      bestMatch.season_offset = seasonOffset;
      bestMatch.original_title = originalTitle;

      // Si nous avons une saison specifique dans le titre
      const seasonMatch = title.match(/Saison\s+(\d+)$/i);
      if (seasonMatch) {
        const titleSeason = parseInt(seasonMatch[1]);
        bestMatch.title_season = titleSeason;
        bestMatch.actual_season = seasonOffset + titleSeason - 1;
        console.log(`Serie en parties: La saison ${titleSeason} dans le titre correspond a la saison ${bestMatch.actual_season} de la serie`);
      }
    }

    // Consider it a match if score is above threshold
    return highestScore >= 0.3 ? bestMatch : null;
  } catch (error) {
    console.error('Error finding TV series on TMDB:', error);
    return null;
  }
}

// ===========================================================================
// ROUTES  (mounted at /api, so paths are relative)
// ===========================================================================

// ---------------------------------------------------------------------------
// GET /tmdb/:type/:id  -- retrieve Coflix links via TMDB ID
// ---------------------------------------------------------------------------
router.get('/tmdb/:type/:id', async (req, res) => {
  const { id, type } = req.params;

  // Bloquer certains IDs TMDB specifiques
  if (type === 'movie' && id === '771') {
    return res.status(404).json({ error: 'Not found' });
  }
  if (type === 'movie' && id === '1159559') {
    return res.status(200).json({ message: 'Contenu non disponible' });
  }
  const { season, episode } = req.query;
  const cacheKey = generateCacheKey(`tmdb_links_${type}_${id}_${season || ''}_${episode || ''}`);

  try {
    // 1. Verifier le cache sans expiration (stale-while-revalidate)
    const cachedData = await getFromCacheNoExpiration(CACHE_DIR.COFLIX, cacheKey);
    let dataReturned = false;
    if (cachedData) {
      await respondWithCoflixSources(req, res, filterEmmmmbedReaders(cachedData), type);
      dataReturned = true;
    }

    const syncCachedClones = () => coflixCloneRefresh.run(cacheKey, async () => {
      if (coflixCloneRefresh.recentlyChecked(cacheKey, COFLIX_CHECK_INTERVAL)) return;
      const latest = await getFromCacheNoExpiration(CACHE_DIR.COFLIX, cacheKey);
      if (!latest) return;
      const withClones = await applyCloneUrlsToTmdbResult(latest, type, id, season, episode);
      const synced = await syncCloneUrlsOnTmdbResult(withClones, type, id, season, episode);
      if (JSON.stringify(latest) !== JSON.stringify(synced)) {
        await saveCoflixCachePreservingPlayable(cacheKey, type, synced);
      }
      coflixCloneRefresh.markChecked(cacheKey);
    });

    // 3. Fonction pour recuperer les donnees fraiches et mettre a jour le cache
    const updateCache = () => coflixRefresh.run(cacheKey, async () => {
      try {
        const latest = await getFromCacheNoExpiration(CACHE_DIR.COFLIX, cacheKey);
        if (latest && (coflixRefresh.recentlyChecked(cacheKey, COFLIX_CHECK_INTERVAL) ||
            Date.now() - (Number(latest._coflixRefreshedAt) || 0) < COFLIX_CHECK_INTERVAL)) {
          return { status: 200, data: latest };
        }
        // Coflix desactive : pas de fetch frais, et on ne pollue pas le cache
        // avec des "Contenu non disponible" qui persisteraient au réveil.
        if (!COFLIX_ENABLED) {
          return { status: 200, data: { message: 'Contenu non disponible', tmdb_id: id } };
        }

        // Verifier que le type est valide
        if (type !== 'movie' && type !== 'tv') {
          return { status: 400, data: { message: 'Type de media non valide' } };
        }

        // Pour les series, verifier que la saison et l'episode sont fournis pour la mise a jour
        if (type === 'tv' && (!season || !episode)) {
          return { status: 400, data: { message: 'Parametres de saison/episode manquants' } };
        }

        // Recuperer les details TMDB
        const tmdbDetails = await getTMDBDetails(id, type);
        if (!tmdbDetails) {
          const error = new Error('Contenu non trouve sur TMDB');
          error.code = 'TMDB_DETAILS_UNAVAILABLE';
          error.httpStatus = 404;
          throw error;
        }

        // Extraire l'annee de la date de sortie
        const releaseYear = tmdbDetails.release_date ? parseInt(tmdbDetails.release_date.split('-')[0]) : null;

        // Rechercher sur Coflix avec le titre international d'abord
        let coflixResults = await searchCoflixByTitle(tmdbDetails.title, type, releaseYear);
        let bestResults = coflixResults;

        // Si aucun resultat trouve avec le titre principal, essayer avec le titre original
        if ((!coflixResults || !coflixResults.length || (coflixResults[0] && coflixResults[0].similarity < 0.8)) && tmdbDetails.original_title && tmdbDetails.original_title !== tmdbDetails.title) {
          const originalResults = await searchCoflixByTitle(tmdbDetails.original_title, type, releaseYear);

          if (originalResults && originalResults.length > 0) {
            if (!bestResults || !bestResults.length) {
              bestResults = originalResults;
            } else {
              const bestSimilarity = Math.max(
                bestResults[0]?.similarity || 0,
                originalResults[0]?.similarity || 0
              );
              if (bestSimilarity === (originalResults[0]?.similarity || 0)) {
                bestResults = originalResults;
              }
            }
          }
        }

        // Si toujours pas de bon resultat, essayer avec le titre francais localise
        if ((!bestResults || !bestResults.length || (bestResults[0] && bestResults[0].similarity < 0.8))) {
          try {
            const frenchData = await fetchTmdbDetails(TMDB_API_URL, TMDB_API_KEY, id, type, 'fr-FR');

            if (frenchData) {
              const frenchTitle = type === 'movie' ? frenchData.title : frenchData.name;
              if (frenchTitle && frenchTitle !== tmdbDetails.title && frenchTitle !== tmdbDetails.original_title) {
                const frenchResults = await searchCoflixByTitle(frenchTitle, type, releaseYear);

                if (frenchResults && frenchResults.length > 0) {
                  if (!bestResults || !bestResults.length) {
                    bestResults = frenchResults;
                  } else {
                    const bestSimilarity = Math.max(
                      bestResults[0]?.similarity || 0,
                      frenchResults[0]?.similarity || 0
                    );
                    if (bestSimilarity === (frenchResults[0]?.similarity || 0)) {
                      bestResults = frenchResults;
                    }
                  }
                }
              }
            }
          } catch (error) {
            console.log(`[TMDB API] Impossible de recuperer le titre francais pour ${id}`);
          }
        }

        // Utiliser les meilleurs resultats trouves
        coflixResults = bestResults;

        // Gerer le cas ou aucun resultat n'est trouve sur Coflix
        const similarityThreshold = 0.8;

        // Premiere fiche dont l'affiche n'appartient pas a un homonyme TMDB.
        let chosen = null;
        let wrongShow = false;
        for (const candidate of (coflixResults || []).filter((r) => r.similarity >= similarityThreshold)) {
          if (await coflixPosterBelongsToOtherShow(candidate, id, type)) {
            wrongShow = true;
            continue;
          }
          chosen = candidate;
          break;
        }
        if (chosen) wrongShow = false;

        if (!chosen) {
          const unavailableResult = {
            message: 'Contenu non disponible',
            tmdb_id: id,
            tmdb_details: tmdbDetails,
            _coflixRefreshedAt: Date.now(),
          };
          if (wrongShow) {
            // Le cache jouable pointe vers un homonyme : il doit etre remplace.
            await saveToCache(CACHE_DIR.COFLIX, cacheKey, unavailableResult);
          } else if (!hasPlayableCoflixResult(latest, type)) {
            await saveCoflixCachePreservingPlayable(cacheKey, type, unavailableResult);
          }
          coflixRefresh.markChecked(cacheKey);
          return { status: 200, data: unavailableResult };
        }

        // Utiliser le premier resultat trouve
        const coflixUrl = chosen.url;

        let result = {
          tmdb_details: tmdbDetails
        };

        // Recuperer les donnees specifiques selon le type
        if (type === 'movie') {
          const movieData = await getMovieDataFromCoflix(coflixUrl);
          result = {
            ...result,
            ...movieData
          };
        } else if (type === 'tv') {
          const seasonNum = parseInt(season);
          const episodeNum = parseInt(episode);
          const tvData = await getTvDataFromCoflix(coflixUrl, seasonNum, episodeNum);
          result = {
            ...result,
            ...tvData
          };
        }

        result = await syncCloneUrlsOnTmdbResult(result, type, id, season, episode);
        result._coflixRefreshedAt = Date.now();

        // 4. Verifier si les resultats sont valides avant de sauvegarder
        const isEmptyResult = (type === 'movie' && (!result.player_links || result.player_links.length === 0)) ||
          (type === 'tv' && (!result.seasons || result.seasons.length === 0));

        if (!isEmptyResult || !hasPlayableCoflixResult(latest, type)) {
          await saveCoflixCachePreservingPlayable(cacheKey, type, result);
        }

        coflixRefresh.markChecked(cacheKey);
        coflixCloneRefresh.markChecked(cacheKey);
        return { status: 200, data: result };

      } catch (updateError) {
        if (updateError?.code === 'TMDB_DETAILS_UNAVAILABLE') {
          // Détails TMDB indisponibles : le rejet sert seulement à espacer les tentatives.
          // Un résultat null peut aussi être temporaire ; ne pas publier de cache négatif.
        } else if (updateError && updateError.coflixSiteRateLimited) {
          // Coflix global 429 — announced once by the cooldown; stay silent here.
        } else if (updateError?.isSourceCircuitOpen) {
          // Coflix en pause : annoncé une fois par le disjoncteur, rien par titre.
        } else if (updateError && updateError.isAxiosError) {
          const url = updateError.config && updateError.config.url ? updateError.config.url : '';
          console.error(
            `Erreur lors de la mise a jour du cache TMDB ${id} (${type}): [AxiosError] ${updateError.code || ''} ${updateError.message} ${url}`
          );
        } else {
          const msg = updateError && updateError.message
            ? updateError.message
            : (typeof updateError === 'string'
              ? updateError
              : JSON.stringify(updateError));
          console.error(`Erreur lors de la mise a jour du cache TMDB ${id} (${type}): ${msg}`);
        }
        throw updateError;
      }
    });

    if (dataReturned) {
      void (async () => {
        await syncCachedClones();
        if (COFLIX_ENABLED) await updateCache();
      })().catch(() => {});
    } else {
      const result = await updateCache();
      if (result.status !== 200) return res.status(result.status).json(result.data);
      await respondWithCoflixSources(req, res, filterEmmmmbedReaders(result.data), type);
    }

  } catch (error) {
    if (error?.code !== 'TMDB_DETAILS_UNAVAILABLE' && !error?.isSourceCircuitOpen) {
      console.error(`Erreur lors de la recuperation des liens TMDB ${id} (${type}):`, error);
    }
    if (!res.headersSent) {
      if (error.httpStatus === 404) {
        return res.status(404).json({ message: 'Contenu non trouve sur TMDB' });
      }
      res.status(200).json({
        message: 'Contenu non disponible en raison d\'une erreur',
        tmdb_id: id
      });
    }
  }
});

// ---------------------------------------------------------------------------
// GET /imdb/:type/:id  -- IMDB / FrenchStream data route
// ---------------------------------------------------------------------------

// Cache directory for FrenchCloud data
const FRENCHCLOUD_CACHE_DIR = path.join(__dirname, '..', 'cache', 'frenchcloud');
(async () => {
  try {
    await fsp.access(FRENCHCLOUD_CACHE_DIR);
  } catch {
    await fsp.mkdir(FRENCHCLOUD_CACHE_DIR, { recursive: true });
  }
})();

// Consolidated cache directory for links
const LINK_CACHE_DIR = path.join(__dirname, '..', 'cache', 'links');
(async () => {
  try {
    await fsp.access(LINK_CACHE_DIR);
  } catch {
    await fsp.mkdir(LINK_CACHE_DIR, { recursive: true });
  }
})();
const CACHE_EXPIRATION_6H = 6 * 60 * 60 * 1000; // 6 hours in milliseconds

router.get('/imdb/:type/:id', async (req, res) => {
  const { id, type } = req.params;
  // Return 404 for specific blocked IMDB ids
  const blockedImdbIds = new Set([
    'tt7069210',
    'tt0325980',
    'tt0383574',
    'tt0449088',
    'tt1298650',
    'tt1790809',
    'tt0099785'
  ]);
  if (blockedImdbIds.has(id)) {
    return res.status(404).json({ error: 'Not found' });
  }
  const cacheKey = type === 'movie' ?
    generateCacheKey(`imdb_movie_${id}`) :
    generateCacheKey(`frenchstream_${id}`);
  const cacheDir = LINK_CACHE_DIR;

  try {
    // 1. Check cache without expiration
    const cachedData = await getFromCacheNoExpiration(cacheDir, cacheKey);
    let dataReturned = false;
    if (cachedData) {
      const dataToSend = type === 'tv' ? cleanTvCacheData(cachedData) : cachedData;
      await respondWithFrenchStreamSources(req, res, dataToSend, type);
      dataReturned = true;
    }

    // La tâche partagée ne capture jamais la réponse HTTP d'un appelant.
    const updateCache = () => omegaRefresh.run(cacheKey, async () => {
        const latest = await getFromCacheNoExpiration(cacheDir, cacheKey);
        if (latest && (omegaRefresh.recentlyChecked(cacheKey, 3 * 60 * 60 * 1000) ||
            !await shouldUpdateCacheFrenchStream(cacheDir, cacheKey))) return latest;
        let responseData = {};

        if (type === 'movie') {
          // --- Handle Movies (using FrenchStream scraping) ---
          const movieData = await getFrenchStreamMovie(id);
          if (movieData.error) {
            responseData = { message: 'Contenu non disponible', french_stream_id: id, details: movieData.error };
            if (!['Movie not found on FrenchCloud', 'Movie not found on FrenchStream', 'Iframe not found on movie page'].includes(movieData.error)) {
              const error = new Error(movieData.error);
              error.responseData = responseData;
              error.httpStatus = 200;
              throw error;
            }
          } else {
            responseData = {
              ...movieData
            };
          }

        } else if (type === 'tv') {
          // FrenchCloud fournit toutes les saisons à partir de l'identifiant IMDb.
          const frenchStreamId = id;
          const seriesList = await getFrenchStreamSeries(frenchStreamId);

          if (!seriesList || (Array.isArray(seriesList) && seriesList.length === 0)) {
            responseData = { message: 'Contenu non disponible', french_stream_id: frenchStreamId };
          } else if (seriesList.error) {
            if (seriesList.error.includes('404')) {
              responseData = { message: 'Contenu non disponible', french_stream_id: frenchStreamId };
            } else {
              const error = new Error(seriesList.error);
              error.responseData = { error: 'Failed to retrieve series list from FrenchStream', details: seriesList.error, french_stream_id: frenchStreamId };
              error.httpStatus = 500;
              throw error;
            }
          } else {
            const MAX_SERIES = 10;
            const seriesToProcess = seriesList.slice(0, MAX_SERIES);

            let detailsFailed = false;
            await Promise.all(seriesToProcess.map(async (series) => {
              if (series.link) {
                try {
                  const seriesDetails = series.seasons?.length
                    ? series
                    : await getFrenchStreamSeriesDetails(series.link, series.title);
                  if (!seriesDetails.error) {
                    series.seasons = seriesDetails.seasons;
                    series.release_date = seriesDetails.release_date;
                    series.summary = seriesDetails.summary;
                    series.tmdb_data = seriesDetails.tmdb_data;
                    const { baseName, partNumber } = extractSeriesInfo(series.title);
                    series.baseName = baseName;
                    series.partNumber = partNumber;
                  } else {
                    detailsFailed = true;
                    console.warn(`Could not fetch details for series: ${series.title} (${series.link}), Error: ${seriesDetails.error}`);
                    series.seasons = [];
                  }
                } catch (detailsError) {
                  detailsFailed = true;
                  console.error(`Exception fetching details for ${series.title} (${series.link}):`, detailsError);
                  series.seasons = [];
                }
              } else {
                series.seasons = [];
              }
            }));

            if (detailsFailed) throw new Error('FrenchStream series details unavailable');

            // Group and Merge Series Parts
            const seriesGroups = {};
            seriesToProcess.forEach(series => {
              if (series.baseName) {
                if (!seriesGroups[series.baseName]) {
                  seriesGroups[series.baseName] = [];
                }
                seriesGroups[series.baseName].push(series);
              }
            });

            const mergedSeriesList = [];
            for (const baseName in seriesGroups) {
              const merged = mergeSeriesParts(seriesGroups[baseName]);
              if (merged) {
                mergedSeriesList.push(merged);
              }
            }

            // Clean the merged list for the final result
            const cleanedSeries = cleanTvCacheData({ series: mergedSeriesList });

            responseData = {
              type: 'tv',
              series: cleanedSeries.series
            };
          }
        } else {
          console.error(`Type invalide pour la mise a jour du cache: ${type}`);
          return;
        }

        // Conserver les sources utilisables si le catalogue ne fournit plus de liens.
        const playable = type === 'movie'
          ? Array.isArray(responseData.player_links) && responseData.player_links.length > 0
          : Array.isArray(responseData.series) && responseData.series.length > 0;
        if (playable || !latest) await saveToCache(cacheDir, cacheKey, responseData);
        omegaRefresh.markChecked(cacheKey);
        return playable || !latest ? responseData : latest;
    });

    const finishUpdate = async () => {
      try {
        // Un cache frais a déjà été lu pour la réponse : ne pas le relire dans Redis.
        if (cachedData && (omegaRefresh.recentlyChecked(cacheKey, 3 * 60 * 60 * 1000) ||
            !await shouldUpdateCacheFrenchStream(cacheDir, cacheKey))) return;
        const responseData = await updateCache();
        if (!dataReturned) {
          if (responseData?.message === 'Contenu non disponible') res.status(200).json(responseData);
          else await respondWithFrenchStreamSources(req, res,
              type === 'tv' ? cleanTvCacheData(responseData) : responseData, type);
        }
      } catch (updateError) {
        if (!dataReturned && !res.headersSent) {
          if (updateError.responseData) {
            res.status(updateError.httpStatus).json(updateError.responseData);
          } else if (updateError.message && updateError.message.includes('404')) {
            res.status(200).json({ message: 'Contenu non disponible', french_stream_id: id });
          } else {
            res.status(500).json({ error: 'Erreur lors de la mise a jour du cache', details: updateError.message });
          }
        }
      }
    };
    if (dataReturned) void finishUpdate();
    else await finishUpdate();

  } catch (error) {
    console.error(`Erreur initiale dans /api/imdb/${type}/${id}:`, error);
    if (!res.headersSent) {
      if (error.message && error.message.includes('404')) {
        res.status(200).json({ message: 'Contenu non disponible', french_stream_id: id });
      } else {
        res.status(500).json({ error: 'Erreur serveur interne lors du traitement initial', details: error.message });
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = router;
module.exports.configure = configure;
module.exports.getTMDBDetails = getTMDBDetails;
module.exports.findTvSeriesOnTMDB = findTvSeriesOnTMDB;
module.exports.coflixPosterBelongsToOtherShow = coflixPosterBelongsToOtherShow;
