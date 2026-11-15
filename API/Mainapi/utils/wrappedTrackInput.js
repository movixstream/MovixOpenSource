'use strict';

// Contrôle de ce que POST /api/wrapped/track reçoit du navigateur. Tout vient
// du client : rien n'est écrit en base sans passer par ici.
//
// - type de contenu : seulement ceux de la colonne ENUM (sinon MySQL répondait
//   par une erreur 500) ;
// - identifiant : un id TMDB pour film, série et anime ; une chaîne courte pour
//   la TV en direct ;
// - titre : gardé pour la TV en direct seulement. Les autres titres viennent de
//   TMDB, et un titre libre se retrouvait en repli dans le Top 10 public ;
// - heure : 0 à 23, sinon l'heure du serveur (une heure hors bornes cassait
//   l'horloge du récap) ;
// - année et mois : ceux du client tant qu'ils collent à la date du serveur à
//   un fuseau près, sinon ceux du serveur. Une horloge déréglée ou une requête
//   forgée ne peut plus écrire dans une année terminée, et le 1er janvier un
//   client en avance sur le serveur n'est plus refusé.

const CONTENT_TYPES = Object.freeze(['movie', 'tv', 'anime', 'live-tv']);
const TMDB_ID_PATTERN = /^\d{1,10}$/;
const PAGE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,49}$/;
const LIVE_ID_MAX_LENGTH = 120;
const TITLE_MAX_LENGTH = 255;
const META_MAX_LENGTH = 1024;
const NUMBER_MAX = 100000;
// Écart maximal entre l'heure locale d'un client et celle du serveur (UTC+14).
const CLOCK_SLACK_MS = 14 * 60 * 60 * 1000;

function integerInRange(value, min, max) {
  // Nombre ou texte seulement : Number([]) et Number(' ') valent 0.
  if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : null;
}

function cleanText(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  // eslint-disable-next-line no-control-regex
  return String(value).replace(/[\u0000-\u001f\u007f]/g, '').trim();
}

/**
 * @returns {{ error: string } | { contentType: string, contentId: string, contentTitle: string|null, seasonNumber: number|null, episodeNumber: number|null, hourOfDay: number }}
 */
function normalizeViewing(body, serverHour) {
  const contentType = body?.contentType;
  if (!contentType || body?.contentId === undefined || body?.contentId === null || body?.contentId === '') {
    return { error: 'Missing required fields for viewing: contentType, contentId' };
  }
  if (!CONTENT_TYPES.includes(contentType)) {
    return { error: 'Invalid contentType' };
  }
  const contentId = cleanText(body.contentId);
  const validId = contentType === 'live-tv'
    ? contentId.length > 0 && contentId.length <= LIVE_ID_MAX_LENGTH
    : TMDB_ID_PATTERN.test(contentId);
  if (!validId) return { error: 'Invalid contentId' };

  const title = contentType === 'live-tv' ? cleanText(body.contentTitle).slice(0, TITLE_MAX_LENGTH) : '';
  const hour = integerInRange(body.hourOfDay, 0, 23);
  return {
    contentType,
    contentId,
    contentTitle: title || null,
    seasonNumber: integerInRange(body.seasonNumber, 1, NUMBER_MAX),
    episodeNumber: integerInRange(body.episodeNumber, 1, NUMBER_MAX),
    hourOfDay: hour === null ? serverHour : hour,
  };
}

/**
 * @returns {{ error: string } | { pageName: string, meta: string|null }}
 */
function normalizePage(body) {
  if (!body?.pageName) return { error: 'Missing required field for page: pageName' };
  if (typeof body.pageName !== 'string' || !PAGE_NAME_PATTERN.test(body.pageName)) {
    return { error: 'Invalid pageName' };
  }
  let meta = null;
  if (body.meta && typeof body.meta === 'object' && !Array.isArray(body.meta)) {
    try {
      const serialized = JSON.stringify(body.meta);
      if (serialized.length <= META_MAX_LENGTH) meta = serialized;
    } catch {
      meta = null;
    }
  }
  return { pageName: body.pageName, meta };
}

/**
 * Année et mois à enregistrer : ceux du client s'ils correspondent à la date
 * du serveur 14 h plus tôt, maintenant ou 14 h plus tard, sinon ceux du serveur.
 * @returns {{ year: number, month: number }}
 */
function resolveTrackPeriod(clientYear, clientMonth, now = new Date()) {
  const nowMs = now.getTime();
  for (const offset of [0, -CLOCK_SLACK_MS, CLOCK_SLACK_MS]) {
    const date = new Date(nowMs + offset);
    if (date.getFullYear() === clientYear && date.getMonth() + 1 === clientMonth) {
      return { year: clientYear, month: clientMonth };
    }
  }
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

module.exports = {
  CONTENT_TYPES,
  integerInRange,
  normalizeViewing,
  normalizePage,
  resolveTrackPeriod,
};
