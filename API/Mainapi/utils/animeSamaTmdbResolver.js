'use strict';

/**
 * ID TMDB d'une œuvre d'anime-sama dont la fiche n'en publie pas.
 *
 * La fiche donne presque toujours l'ID AniList et l'ID MyAnimeList de l'œuvre.
 * ARM (arm.haglund.dev, à partir de Fribb/anime-lists) fait la correspondance
 * vers TMDB. Sa réponse est un seul nombre, sans dire s'il désigne une série ou
 * un film, alors que les ID des deux se recoupent sur TMDB. Le type est donc
 * déduit des autres champs, et un cas douteux reste sans lien : un mauvais lien
 * montre les épisodes d'une œuvre sur la fiche d'une autre, ce qui est pire que
 * pas de lien du tout.
 *
 *  - saison TMDB ≥ 1, ou œuvre de type « TV » : série ;
 *  - saison TMDB 0 : film ou OAV rangé comme « spécial » de sa série mère. Le
 *    relier donnerait la page de la série à ce film : pas de lien ;
 *  - ni saison TMDB ni fiche TheTVDB : film ;
 *  - le reste (un film qui a aussi une fiche TheTVDB…) : pas de lien.
 */

const ARM_IDS_URL = 'https://arm.haglund.dev/api/v2/ids';
const ARM_INCLUDE = 'themoviedb,themoviedb-season,thetvdb,media';
// ARM refuse (400) tout ID hors de ces bornes.
const ARM_MAX_ID = 50000000;
const USER_AGENT = 'Movix/1.0 (+https://movix.tax)';
const HOUR_MS = 60 * 60 * 1000;
const MAX_REMEMBERED = 5000;

const isSourceId = value => Number.isSafeInteger(value) && value >= 1 && value <= ARM_MAX_ID;

// Lien TMDB d'une réponse d'ARM, ou null quand elle n'en donne pas de sûr.
function tmdbOf(relation) {
  const id = relation.themoviedb;
  if (!Number.isSafeInteger(id) || id < 1) return null;
  const season = relation['themoviedb-season'];
  if (Number.isInteger(season)) return season >= 1 ? { type: 'tv', id } : null;
  if (relation.media === 'TV') return { type: 'tv', id };
  return relation.thetvdb ? null : { type: 'movie', id };
}

/**
 * Rend `resolveTmdb({ anilistId, malId })` : `{ type: 'tv' | 'movie', id }`, ou
 * null quand l'œuvre n'a pas de correspondance sûre. La fonction lève quand ARM
 * ne répond pas : l'appelant ne doit pas prendre une panne pour « aucune
 * correspondance ».
 *
 * `http` : client à la façon d'axios (`get(url, { params, timeout, headers })`).
 */
function createArmTmdbResolver({
  http = require('axios'),
  now = Date.now,
  timeoutMs = 6000,
  // Une correspondance connue est relue chaque semaine. Une œuvre inconnue est
  // redemandée deux fois par jour : ARM apprend les animes de la saison avec
  // quelques jours de retard.
  foundTtlMs = 7 * 24 * HOUR_MS,
  missTtlMs = 12 * HOUR_MS,
  // Après une panne, plus aucune requête pendant cette pause : les fiches
  // suivantes n'attendent pas chacune le délai de la requête.
  pauseMs = 10 * 60 * 1000,
} = {}) {
  // `anilist:207191` → { link, until }
  const remembered = new Map();
  let pausedUntil = 0;

  async function ask(source, id) {
    const key = `${source}:${id}`;
    const known = remembered.get(key);
    if (known && known.until > now()) return known.link;
    if (now() < pausedUntil) throw new Error('correspondance AniList/MAL vers TMDB en pause après une panne');

    let relation;
    try {
      const response = await http.get(ARM_IDS_URL, {
        params: { source, id, include: ARM_INCLUDE },
        timeout: timeoutMs,
        headers: { 'User-Agent': USER_AGENT },
      });
      relation = response?.data;
      // ARM répond un objet, ou `null` pour une œuvre inconnue. Le reste (page
      // de vérification, corps vide) n'est pas sa réponse.
      if (relation !== null && (typeof relation !== 'object' || Array.isArray(relation))) {
        throw new Error('réponse inattendue du service de correspondance');
      }
    } catch (error) {
      const status = Number(error?.response?.status) || 0;
      // 400 ou 404 : ARM ne veut pas de cet ID. Ce n'est pas une panne.
      if (status !== 400 && status !== 404) {
        pausedUntil = now() + pauseMs;
        throw error;
      }
      relation = null;
    }

    const link = relation ? tmdbOf(relation) : null;
    remembered.delete(key);
    if (remembered.size >= MAX_REMEMBERED) remembered.delete(remembered.keys().next().value);
    remembered.set(key, { link, until: now() + (link ? foundTtlMs : missTtlMs) });
    return link;
  }

  return async function resolveTmdb({ anilistId, malId } = {}) {
    for (const [source, id] of [['anilist', anilistId], ['myanimelist', malId]]) {
      if (!isSourceId(id)) continue;
      const link = await ask(source, id);
      if (link) return link;
    }
    return null;
  };
}

module.exports = { createArmTmdbResolver };
