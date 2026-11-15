const assert = require('node:assert/strict');
const test = require('node:test');

const {
  FALLBACK_HOST_STATUS,
  parseHostStatus,
  isDeadPlayerUrl,
  createDeadPlayerList,
} = require('../animeSamaDeadPlayers');

// Extrait d'une page de saison d'anime-sama (2026-10-19).
const seasonPage = (infos) => [
  '<script>var ctSaisonSuivante = {"nom":"Films","url":"/catalogue/one-piece/film/vostfr/"};</script>',
  '<script>',
  'var languesDispo = ["vostfr"];',
  `var lecteursInfos = ${JSON.stringify(infos)};`,
  '</script>',
].join('\n');

const SITE_INFOS = {
  'ansembed.net': { nom: 'Vidmoly', pub: 1, hd: true },
  'sibnet.ru': { nom: 'Sibnet', pub: 0, hd: false, mort: true },
  'embed4me.com': { nom: 'Embed4me', pub: 2, hd: true, mort: true },
  'player.vimeo.com': { nom: 'Vimeo' },
  'vimeo.com': { nom: 'Vimeo (ancien)', mort: true },
};

test('AnimeSama : la table lecteursInfos donne les hébergeurs hors service', () => {
  const status = parseHostStatus(seasonPage(SITE_INFOS));
  assert.deepEqual([...status], [
    ['ansembed.net', false],
    ['sibnet.ru', true],
    ['embed4me.com', true],
    ['player.vimeo.com', false],
    ['vimeo.com', true],
  ]);
  assert.equal(parseHostStatus('<html>sans table</html>'), null);
  assert.equal(parseHostStatus('var lecteursInfos = {cassé};'), null);
  assert.equal(parseHostStatus(undefined), null);
});

test('AnimeSama : un lien est jugé comme sur le site, domaine exact puis domaine parent', () => {
  const status = parseHostStatus(seasonPage(SITE_INFOS));
  assert.equal(isDeadPlayerUrl('https://video.sibnet.ru/shell.php?videoid=1', status), true);
  assert.equal(isDeadPlayerUrl('https://lpayer.embed4me.com/#oever', status), true);
  assert.equal(isDeadPlayerUrl('https://www.ansembed.net/embed-a.html', status), false);
  // L'entrée la plus précise décide : player.vimeo.com est en service.
  assert.equal(isDeadPlayerUrl('https://player.vimeo.com/video/1', status), false);
  assert.equal(isDeadPlayerUrl('https://vimeo.com/1', status), true);
  // Hébergeur inconnu de la table, ou lien illisible : jamais retiré.
  assert.equal(isDeadPlayerUrl('https://minochinos.com/embed/x', status), false);
  assert.equal(isDeadPlayerUrl('pas une url', status), false);
  assert.equal(isDeadPlayerUrl('https://video.sibnet.ru/x', null), false);
});

test('AnimeSama : le relevé de secours couvre les lecteurs hors service connus', () => {
  for (const url of [
    'https://video.sibnet.ru/shell.php?videoid=1',
    'https://oneupload.to/embed-x.html',
    'https://lpayer.embed4me.com/#a',
    'https://x.player4me.com/#a',
    'https://4meplayer.com/#a',
    'https://myvi.top/embed/a',
  ]) assert.equal(isDeadPlayerUrl(url, FALLBACK_HOST_STATUS), true, url);
  assert.equal(isDeadPlayerUrl('https://ansembed.net/embed-a.html', FALLBACK_HOST_STATUS), false);
});

test('AnimeSama : la table est relue au plus une fois par heure, une seule lecture pour les appels simultanés', async () => {
  let now = 1_000_000;
  const urls = [];
  let infos = SITE_INFOS;
  const list = createDeadPlayerList({
    now: () => now,
    logger: null,
    request: async ({ url }) => { urls.push(url); return { status: 200, data: seasonPage(infos) }; },
  });
  assert.equal(list.current(), FALLBACK_HOST_STATUS, 'relevé de secours avant toute lecture');

  const page = 'https://anime-sama.invalid/catalogue/one-piece/saison12/vostfr/';
  const [first, second] = await Promise.all([list.refresh(page), list.refresh(page)]);
  assert.equal(first, second);
  assert.deepEqual(urls, [page]);
  assert.equal(isDeadPlayerUrl('https://vimeo.com/1', list.current()), true);

  now += 59 * 60 * 1000;
  await list.refresh(page);
  assert.equal(urls.length, 1, 'encore frais');

  // Anime-sama remet Sibnet en service : la table suivante le reprend.
  infos = { ...SITE_INFOS, 'sibnet.ru': { nom: 'Sibnet' } };
  now += 2 * 60 * 1000;
  await list.refresh(page);
  assert.equal(urls.length, 2);
  assert.equal(isDeadPlayerUrl('https://video.sibnet.ru/shell.php?videoid=1', list.current()), false);
});

test('AnimeSama : une lecture ratée garde la table connue et réessaie après 5 min', async () => {
  let now = 1_000_000;
  let fail = true;
  let calls = 0;
  const warnings = [];
  const list = createDeadPlayerList({
    now: () => now,
    logger: { warn: message => warnings.push(message) },
    request: async () => {
      calls++;
      if (fail) throw new Error('HTTP 403');
      return { status: 200, data: seasonPage(SITE_INFOS) };
    },
  });
  const page = 'https://anime-sama.invalid/catalogue/x/saison1/vostfr/';

  assert.equal(await list.refresh(page), FALLBACK_HOST_STATUS);
  assert.equal(warnings.length, 1);
  now += 4 * 60 * 1000;
  await list.refresh(page);
  assert.equal(calls, 1, 'pas de nouvel essai avant 5 min');

  now += 60 * 1000 + 1;
  fail = false;
  await list.refresh(page);
  assert.equal(calls, 2);
  assert.equal(isDeadPlayerUrl('https://vimeo.com/1', list.current()), true);

  // Une page sans table (refonte, page d'erreur) ne vide pas la table connue.
  const known = list.current();
  now += 61 * 60 * 1000;
  const empty = createDeadPlayerList({ now: () => now, logger: null, request: async () => ({ status: 200, data: '<html></html>' }) });
  assert.equal(await empty.refresh(page), FALLBACK_HOST_STATUS);
  assert.equal(list.current(), known);
});

test('AnimeSama : une page de saison déjà lue ailleurs remplace la table sans nouvelle requête', async () => {
  let now = 1_000_000;
  const urls = [];
  const list = createDeadPlayerList({
    now: () => now,
    logger: null,
    request: async ({ url }) => { urls.push(url); return { status: 200, data: seasonPage(SITE_INFOS) }; },
  });
  const page = 'https://anime-sama.invalid/catalogue/x/saison1/vostfr/';

  assert.equal(list.learn('<html>sans table</html>'), false);
  assert.equal(list.current(), FALLBACK_HOST_STATUS, 'une page sans table ne change rien');
  assert.equal(list.learn(seasonPage(SITE_INFOS)), true);
  assert.equal(isDeadPlayerUrl('https://vimeo.com/1', list.current()), true);

  // La table apprise compte comme une lecture : rien n'est relu pendant 1 h.
  now += 59 * 60 * 1000;
  await list.refresh(page);
  assert.deepEqual(urls, []);
  now += 2 * 60 * 1000;
  await list.refresh(page);
  assert.deepEqual(urls, [page]);
});

test('AnimeSama : sans requête configurée, aucun appel réseau et seul le relevé de secours sert', async () => {
  const list = createDeadPlayerList();
  assert.equal(await list.refresh('https://anime-sama.invalid/catalogue/x/saison1/vostfr/'), FALLBACK_HOST_STATUS);
});
