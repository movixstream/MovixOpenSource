'use strict';

// La page anti-robot « Verification... » de French-Stream pose en JavaScript un
// cookie fsschal puis recharge. Sa valeur change de temps en temps (« 1 », puis
// « k7x2m9q4v3b8 » en octobre 2026) : la lire dans la page plutôt que la figer.
const CHALLENGE_COOKIE = /document\.cookie\s*=\s*["']fsschal=([^\s;"'\\,]{1,128})/;

function readFStreamChallengeCookie(body) {
  if (typeof body !== 'string' || !body.includes('fsschal=')) return null;
  return body.match(CHALLENGE_COOKIE)?.[1] || null;
}

// Garde la nouvelle valeur dans les cookies partagés. Vrai seulement si elle a
// changé : l'appelant renvoie alors sa requête une fois, sans boucler.
function adoptFStreamChallengeCookie(cookies, response) {
  const value = readFStreamChallengeCookie(response?.data);
  if (!value || !cookies || cookies.fsschal === value) return false;
  console.warn(`[FStream] Nouveau cookie anti-robot fsschal=${value}, requête renvoyée`);
  cookies.fsschal = value;
  return true;
}

module.exports = { readFStreamChallengeCookie, adoptFStreamChallengeCookie };
