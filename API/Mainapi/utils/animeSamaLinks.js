'use strict';

/**
 * Adresse des vidéos d'anime-sama.
 *
 * Depuis le 2026-11-12, la page d'une saison ne donne plus que des repères
 * `lien:<n°>`. L'adresse de chaque vidéo se demande à
 * `GET /api/lien.php?j=<jeton de la page>&l=<n°>`, qui répond `{"u": "…"}` ou
 * `{"erreur": "…"}` :
 *
 *  - `absent`  (404) : ce n° n'appartient pas à la page du jeton ;
 *  - `jeton`, `expire` (403) : jeton faux ou vieux de plus de 24 h — il faut
 *    relire la page ;
 *  - `origine` (403) : la requête ne ressemble pas à celle du lecteur du site
 *    (`Sec-Fetch-Site: none` ou Referer d'un autre site) ;
 *  - `trop` (429) : trop de demandes depuis cette IP. Mesuré le 2026-11-15 :
 *    300 demandes passent, puis tout est refusé jusqu'à la fin de la tranche
 *    de 10 minutes. Les pages du site, elles, restent servies.
 *
 * Ces réponses viennent du site lui-même : elles ne comptent jamais comme une
 * panne pour le disjoncteur, au contraire d'un 403 de la bordure, d'un 5xx ou
 * d'un délai.
 */

const { createConcurrencyLimiter } = require('./concurrency');

const LINK_TOKEN_ERROR = 'ANIME_SAMA_LINK_TOKEN';
const LINK_RATE_ERROR = 'ANIME_SAMA_LINK_RATE';
const isLinkTokenError = error => error?.code === LINK_TOKEN_ERROR;
const isLinkRateError = error => error?.code === LINK_RATE_ERROR;

// En-têtes du `fetch()` que fait le lecteur d'anime-sama depuis la page de la
// saison. Ils remplacent ceux d'une navigation, que le site refuse ici.
const linkHeaders = pageUrl => ({
  Referer: pageUrl,
  Accept: '*/*',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
});

// Corps de /api/lien.php : texte JSON (requête par proxy) ou objet déjà lu.
function readLinkBody(data) {
  if (data && typeof data === 'object' && !Array.isArray(data)) return data;
  if (typeof data !== 'string') return null;
  try {
    const parsed = JSON.parse(data);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const isPlayableUrl = url => typeof url === 'string' && /^https?:\/\/[^/\s]+\.[^/\s]+/i.test(url.trim());

/**
 * `resolve({ pageUrl, token, ids, onLink })` demande l'adresse de chaque n°,
 * au plus `concurrency` à la fois, et appelle `onLink(n°, adresse)` au fur et
 * à mesure : une panne en route ne perd pas les adresses déjà reçues.
 *
 * Un n° inconnu du site (`absent`) est sauté. Un jeton refusé lève une erreur
 * `isLinkTokenError`, un débit dépassé une erreur `isLinkRateError` ; toute
 * autre erreur est une panne et remonte telle quelle. Dès la première erreur,
 * plus aucune nouvelle demande ne part.
 */
function createLinkResolver({ request, circuit = null, budget = null, concurrency = 4 }) {
  const limit = createConcurrencyLimiter(Math.max(1, Math.floor(Number(concurrency) || 1)));

  async function fetchLink(pageUrl, token, id) {
    const url = new URL('/api/lien.php', pageUrl);
    url.searchParams.set('j', token);
    url.searchParams.set('l', id);
    const ask = async () => {
      try {
        const response = await request({ method: 'get', url: url.href, timeout: 10000, headers: linkHeaders(pageUrl) });
        return { body: readLinkBody(response?.data) };
      } catch (error) {
        const body = readLinkBody(error?.response?.data);
        if (body && typeof body.erreur === 'string') return { body };
        throw error;
      }
    };
    if (budget) await budget.take();
    const { body } = circuit ? await circuit.run(ask) : await ask();

    if (isPlayableUrl(body?.u)) return body.u.trim();
    const answer = typeof body?.erreur === 'string' ? body.erreur : '';
    if (answer === 'absent') return null;
    if (answer === 'jeton' || answer === 'expire') {
      throw Object.assign(new Error(`Jeton AnimeSama refusé (${answer})`), { code: LINK_TOKEN_ERROR });
    }
    if (answer === 'trop') {
      throw Object.assign(new Error('Débit de /api/lien.php dépassé (trop)'), { code: LINK_RATE_ERROR });
    }
    throw new Error(answer ? `Lien AnimeSama refusé (${answer})` : 'Réponse /api/lien.php illisible');
  }

  async function resolve({ pageUrl, token, ids, onLink }) {
    let failure = null;
    await Promise.all(ids.map(id => limit(async () => {
      if (failure) return;
      try {
        const url = await fetchLink(pageUrl, token, id);
        if (url) onLink(id, url);
      } catch (error) {
        failure = failure || error;
      }
    })));
    if (failure) throw failure;
  }

  return { resolve };
}

module.exports = { createLinkResolver, isLinkTokenError, isLinkRateError, linkHeaders };
