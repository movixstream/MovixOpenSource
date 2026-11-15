/**
 * Vérification des jetons d'accès Discord et Google reçus à la connexion.
 *
 * Demander le profil avec le jeton ne suffit pas : n'importe quel site qui
 * propose « Se connecter avec Discord/Google » obtient un jeton valide pour
 * ses propres visiteurs, et pouvait le rejouer ici pour ouvrir leur compte
 * Movix. On exige donc que le jeton ait été émis pour l'application Movix
 * (`application.id` chez Discord, `aud`/`azp` chez Google).
 */

const axios = require('axios');

const REQUEST_TIMEOUT_MS = 10000;

// Identifiants publics de l'application (les mêmes que src/config/discord.ts
// et src/config/google.ts). DISCORD_CLIENT_ID / GOOGLE_CLIENT_ID les
// remplacent ; plusieurs valeurs séparées par des virgules sont acceptées.
const DEFAULT_CLIENT_IDS = {
  discord: ['1517232036425895996'],
  google: ['803260771655-6uk6p477ec6im3th4qe9mh8emakes0ja.apps.googleusercontent.com'],
};

const CLIENT_ID_ENV = {
  discord: 'DISCORD_CLIENT_ID',
  google: 'GOOGLE_CLIENT_ID',
};

function getAllowedClientIds(provider, env = process.env) {
  const configured = String(env[CLIENT_ID_ENV[provider]] || '')
    .split(',')
    .map((value) => value.trim())
    // Un `.env` copié tel quel depuis `.env.example` garde ses `YOUR_…`.
    .filter((value) => value && !value.startsWith('YOUR_'));
  return configured.length > 0 ? configured : DEFAULT_CLIENT_IDS[provider];
}

function wrongApplicationError(provider) {
  const error = new Error(`Jeton ${provider} émis pour une autre application`);
  error.code = 'OAUTH_WRONG_APPLICATION';
  return error;
}

async function verifyDiscordAccessToken(accessToken, { http = axios, env = process.env } = {}) {
  const requestConfig = {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: REQUEST_TIMEOUT_MS,
  };

  // L'application d'abord : aucun profil n'est lu pour un jeton étranger.
  const authorization = await http.get('https://discord.com/api/oauth2/@me', requestConfig);
  const applicationId = String(authorization.data?.application?.id || '');
  if (!applicationId || !getAllowedClientIds('discord', env).includes(applicationId)) {
    throw wrongApplicationError('Discord');
  }

  const resp = await http.get('https://discord.com/api/users/@me', requestConfig);
  const user = resp.data;
  if (!user || !user.id) {
    throw new Error('Token Discord invalide');
  }

  return user;
}

async function verifyGoogleAccessToken(accessToken, { http = axios, env = process.env } = {}) {
  const tokenInfo = await http.get('https://oauth2.googleapis.com/tokeninfo', {
    params: { access_token: accessToken },
    timeout: REQUEST_TIMEOUT_MS,
  });
  const allowed = getAllowedClientIds('google', env);
  const audience = String(tokenInfo.data?.aud || '');
  const authorizedParty = String(tokenInfo.data?.azp || '');
  if (!allowed.includes(audience) && !allowed.includes(authorizedParty)) {
    throw wrongApplicationError('Google');
  }

  const resp = await http.get('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: REQUEST_TIMEOUT_MS,
  });
  const user = resp.data;
  if (!user || !user.sub) {
    throw new Error('Token Google invalide');
  }

  return user;
}

module.exports = {
  getAllowedClientIds,
  verifyDiscordAccessToken,
  verifyGoogleAccessToken,
};
