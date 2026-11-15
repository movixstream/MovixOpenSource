const assert = require('node:assert/strict');
const test = require('node:test');

const {
  getAllowedClientIds,
  verifyDiscordAccessToken,
  verifyGoogleAccessToken,
} = require('../oauthProviderTokens');

// Faux client HTTP : répond selon l'URL et garde la trace des appels.
function fakeHttp(replies) {
  const calls = [];
  return {
    calls,
    async get(url, config) {
      calls.push({ url, config });
      if (!(url in replies)) throw new Error(`appel inattendu : ${url}`);
      return { data: replies[url] };
    },
  };
}

const DISCORD_ME = 'https://discord.com/api/oauth2/@me';
const DISCORD_USER = 'https://discord.com/api/users/@me';
const GOOGLE_INFO = 'https://oauth2.googleapis.com/tokeninfo';
const GOOGLE_USER = 'https://www.googleapis.com/oauth2/v3/userinfo';

test('les identifiants par défaut cèdent la place à ceux de l\'environnement', () => {
  assert.deepEqual(getAllowedClientIds('discord', {}), ['1517232036425895996']);
  assert.deepEqual(
    getAllowedClientIds('discord', { DISCORD_CLIENT_ID: ' 111 , 222,' }),
    ['111', '222'],
  );
  assert.deepEqual(getAllowedClientIds('google', { GOOGLE_CLIENT_ID: 'app.example' }), ['app.example']);
  // Valeur d'exemple laissée telle quelle : on garde l'identifiant par défaut.
  assert.deepEqual(
    getAllowedClientIds('discord', { DISCORD_CLIENT_ID: 'YOUR_DISCORD_CLIENT_ID' }),
    ['1517232036425895996'],
  );
});

test('Discord : jeton de notre application accepté', async () => {
  const http = fakeHttp({
    [DISCORD_ME]: { application: { id: '111' } },
    [DISCORD_USER]: { id: '42', username: 'saba' },
  });
  const user = await verifyDiscordAccessToken('tok', { http, env: { DISCORD_CLIENT_ID: '111' } });
  assert.equal(user.id, '42');
  assert.equal(http.calls[0].config.headers.Authorization, 'Bearer tok');
});

test('Discord : jeton d\'une autre application refusé avant de lire le profil', async () => {
  const http = fakeHttp({
    [DISCORD_ME]: { application: { id: '999' } },
    [DISCORD_USER]: { id: '42' },
  });
  await assert.rejects(
    verifyDiscordAccessToken('tok', { http, env: { DISCORD_CLIENT_ID: '111' } }),
    { code: 'OAUTH_WRONG_APPLICATION' },
  );
  assert.deepEqual(http.calls.map((call) => call.url), [DISCORD_ME]);
});

test('Discord : réponse sans application refusée', async () => {
  const http = fakeHttp({ [DISCORD_ME]: {}, [DISCORD_USER]: { id: '42' } });
  await assert.rejects(
    verifyDiscordAccessToken('tok', { http, env: {} }),
    { code: 'OAUTH_WRONG_APPLICATION' },
  );
});

test('Google : audience de notre application acceptée (aud ou azp)', async () => {
  for (const info of [{ aud: 'app.example' }, { aud: 'autre', azp: 'app.example' }]) {
    const http = fakeHttp({ [GOOGLE_INFO]: info, [GOOGLE_USER]: { sub: '7', email: 'a@b.c' } });
    const user = await verifyGoogleAccessToken('tok', { http, env: { GOOGLE_CLIENT_ID: 'app.example' } });
    assert.equal(user.sub, '7');
    assert.equal(http.calls[0].config.params.access_token, 'tok');
  }
});

test('Google : jeton d\'une autre application refusé avant de lire le profil', async () => {
  const http = fakeHttp({ [GOOGLE_INFO]: { aud: 'evil.example' }, [GOOGLE_USER]: { sub: '7' } });
  await assert.rejects(
    verifyGoogleAccessToken('tok', { http, env: { GOOGLE_CLIENT_ID: 'app.example' } }),
    { code: 'OAUTH_WRONG_APPLICATION' },
  );
  assert.deepEqual(http.calls.map((call) => call.url), [GOOGLE_INFO]);
});

test('Google : audience absente refusée', async () => {
  const http = fakeHttp({ [GOOGLE_INFO]: {}, [GOOGLE_USER]: { sub: '7' } });
  await assert.rejects(
    verifyGoogleAccessToken('tok', { http, env: {} }),
    { code: 'OAUTH_WRONG_APPLICATION' },
  );
});
