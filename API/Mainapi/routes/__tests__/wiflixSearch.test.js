'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cheerio = require('cheerio');

const filename = path.resolve(__dirname, '../wiflix.js');
const source = fs.readFileSync(filename, 'utf8');
const start = source.indexOf('const normalizeString =');
// Recherche et extraction des fiches, jusqu'au chargement des données.
const end = source.indexOf('// === Data Fetching ===', start);
assert.ok(start > 0 && end > start);
// Lecture des liens de lecteur (data-v, hébergeurs sautés), avant les caches.
const linkStart = source.indexOf('function decodeWiflixStream');
const linkEnd = source.indexOf('// === Cache helpers', linkStart);
assert.ok(linkStart > 0 && linkEnd > linkStart && linkEnd < start);
const searchSource = source.slice(linkStart, linkEnd) + source.slice(start, end)
  + '\nglobalThis.search = searchWiflixMovie;\nglobalThis.extract = extractWiflixPlayers;'
  + '\nglobalThis.fragment = wiflixResultsFragment;\nglobalThis.complete = completeWiflixPlayers;';
const base = 'https://source.test';

function card(title, href, season = null) {
  return `<div class="mov"><a class="mov-t" href="${href}">${title}</a>${
    season === null ? '' : `<div class="block-sai">Saison ${season}\n French</div>`
  }</div>`;
}

function load(globals) {
  const context = vm.createContext({
    cheerio, URL, URLSearchParams, Buffer,
    WIFLIX_BASE_URL: base,
    refreshStep() {},
    console: { log() {}, error() {} },
    ...globals,
  });
  vm.runInContext(searchSource, context, { filename });
  return context;
}

async function search(title, html) {
  return load({
    makeWiflixSearchRequest: async (_home, _url, options) => {
      assert.equal(new URLSearchParams(options.data).get('story'), title);
      return { data: html };
    },
  }).search(title);
}

test('From (2022) est reconnu parmi ses autres saisons et les titres contenant From', async () => {
  const html = card('From (2022)', '/from-s4.html', 4)
    + card('Diarra From Detroit', '/diarra.html', 1)
    + card('From (2022)', '/saison-complete/23591-from-2022.html', 1)
    + card('Tales from the Void', '/tales.html', 1);
  const result = await search('From saison 1', html);
  assert.equal(result.url, `${base}/saison-complete/23591-from-2022.html`);
  assert.equal(result.debugHtml, null);
});

test('House of the Dragon accepte le préfixe du site et sélectionne la saison demandée', async () => {
  const title = 'Game Of Thrones: House of the Dragon';
  const html = card(title, '/dragon-s2.html', 2)
    + card('The House That Dragons Built', '/documentary.html', 3)
    + card(title, '/serie-en-streaming/36342-game-of-thrones-house-of-the-dragon-saison-3.html', 3);
  assert.equal((await search('House of the Dragon saison 3', html)).url,
    `${base}/serie-en-streaming/36342-game-of-thrones-house-of-the-dragon-saison-3.html`);
});

test('Breaking Bad et la saison inscrite dans le titre restent reconnus', async () => {
  assert.equal((await search('Breaking Bad saison 1',
    card('Breaking Bad saison 1', '/vf/16249-breaking-bad-saison-1.html'))).url,
  `${base}/vf/16249-breaking-bad-saison-1.html`);
});

test('un titre complet exact passe avant une variante préfixée', async () => {
  const html = card('Game Of Thrones: House of the Dragon', '/prefixed.html', 3)
    + card('House of the Dragon', '/exact.html', 3);
  assert.equal((await search('House of the Dragon saison 3', html)).url, `${base}/exact.html`);
});

test('From ne correspond ni à un fragment de titre ni à un suffixe court après deux-points', async () => {
  const html = card('Diarra From Detroit', '/diarra.html', 1)
    + card('Tales from the Void', '/tales.html', 1)
    + card('Stories: From', '/stories.html', 1);
  assert.equal((await search('From saison 1', html)).url, null);
});

test('House of the Dragon ne correspond pas au documentaire ou à la série Game of Thrones', async () => {
  const html = card('The House That Dragons Built', '/documentary.html', 3)
    + card('Game of Thrones', '/thrones.html', 3);
  assert.equal((await search('House of the Dragon saison 3', html)).url, null);
});

test('chercher Game of Thrones ne sélectionne pas son spin-off', async () => {
  assert.equal((await search('Game of Thrones saison 3',
    card('Game Of Thrones: House of the Dragon', '/dragon.html', 3))).url, null);
});

test('le suffixe préfixé doit correspondre entièrement au titre demandé', async () => {
  assert.equal((await search('House of the Dragon saison 3',
    card('Game Of Thrones: House of the Dragon Documentary', '/documentary.html', 3))).url, null);
});

test('une année entre crochets est ignorée, mais deux années explicites différentes sont rejetées', async () => {
  assert.equal((await search('From saison 1', card('From [2022]', '/from.html', 1))).url, `${base}/from.html`);
  assert.equal((await search('From (2022) saison 1', card('From (2023)', '/other.html', 1))).url, null);
});

test('les nombres qui constituent le titre ne sont pas retirés', async () => {
  for (const title of ['1899', '1923', '1984', '2001 : L’Odyssée de l’espace']) {
    assert.equal((await search(`${title} saison 1`, card(`${title} (2022)`, '/numeric.html', 1))).url,
      `${base}/numeric.html`, title);
  }
  assert.equal((await search('1899 saison 1', card('1923', '/other.html', 1))).url, null);
});

test('les accents, apostrophes et articles restent normalisés', async () => {
  assert.equal((await search('L’Été où je suis devenue jolie saison 1',
    card('L Ete ou je suis devenue jolie', '/summer.html', 1))).url, `${base}/summer.html`);
  assert.equal((await search('The Walking Dead saison 1',
    card('Walking Dead', '/walking.html', 1))).url, `${base}/walking.html`);
});

test('une saison absente ou différente reste rejetée après normalisation du titre', async () => {
  const html = card('From (2022)', '/wrong.html', 2)
    + card('From (2022)', '/serie-en-streaming/unknown.html')
    + card('From (2022) saison 2', '/title.html')
    + card('From (2022)', '/serie-en-streaming/from-saison-2.html');
  assert.equal((await search('From saison 1', html)).url, null);
});

test('la saison peut toujours être extraite de l’URL', async () => {
  assert.equal((await search('From saison 1',
    card('From (2022)', '/serie-en-streaming/from-saison-1.html'))).url,
  `${base}/serie-en-streaming/from-saison-1.html`);
});

test('un film ne remplace pas une série, et inversement', async () => {
  assert.equal((await search('From saison 1', card('From (2022)', '/film/from.html'))).url, null);
  assert.equal((await search('From', card('From (2022)', '/series/from.html', 1))).url, null);
});

test('les recommandations populaires ne sont pas des résultats de recherche', async () => {
  const html = `<div id="no-results-rec">${card('From (2022)', '/recommendation.html', 1)}</div>`;
  assert.equal((await search('From saison 1', html)).url, null);
});

// Page de résultats sur le modèle du site : en-tête avec un gabarit de bloc
// dans un script, résultats, bloc « Populaires », fin du contenu, barre latérale.
function resultsPage({ results = '', recommendations = '', head = '', sidebar = '', end = '<!-- end content -->' } = {}) {
  return `<!DOCTYPE html><html lang="fr"><head><title>Flemmix</title>
<script>const tpl = '<div class="mov"><a class="mov-t" href="/piege.html">From (2022)</a></div>';</script>
<style>.mov-m:empty{display:none}</style>${head}</head><body>
<header><ul class="menu"><li><a href="/serie-en-streaming/" class="full-link">Séries</a></li></ul></header>
<div class="content"><div class="block-main">
${results}
<div id="no-results-rec" style="display:none"><div class="block-title">Populaires</div>${recommendations}</div>
</div>${end}
<aside class="sidebar"><a class="mov-side" href="/side.html"><div class="mov-side-title">From (2022)</div></a>${sidebar}</aside>
</div><footer>Flemmix</footer></body></html>`;
}

test('les résultats ne sont analysés que dans le contenu, avec les mêmes blocs retenus', async () => {
  const html = resultsPage({
    results: card('From (2022)', '/saison-complete/23591-from-2022.html', 1) + card('Tales from the Void', '/tales.html', 1),
    recommendations: card('From (2022)', '/recommendation.html', 1),
  });
  const { fragment } = load({});
  const part = fragment(html);
  assert.ok(part.startsWith('<div class="mov">'));
  assert.ok(part.length < html.length / 2);
  assert.ok(!part.includes('mov-side') && !part.includes('piege'));
  assert.ok(part.includes('id="no-results-rec"'));
  const result = await search('From saison 1', html);
  assert.equal(result.url, `${base}/saison-complete/23591-from-2022.html`);
  assert.deepEqual(Array.from(result.candidates, c => c.url), [`${base}/saison-complete/23591-from-2022.html`]);
  // Sans résultat : seul le bloc « Populaires », toujours exclu.
  const empty = resultsPage({ recommendations: card('From (2022)', '/recommendation.html', 1) });
  assert.ok(fragment(empty).startsWith('<div id="no-results-rec"'));
  assert.equal((await search('From saison 1', empty)).url, null);
});

test('un bloc en commentaire ou en texte brut n’ouvre pas le fragment, et au moindre doute on garde la suite', async () => {
  const { fragment } = load({});
  const results = card('From (2022)', '/from.html', 1);
  // Les blocs d'un commentaire ou d'un <noscript> ne sont pas des éléments.
  for (const head of ['<!-- <div class="mov"><a class="mov-t" href="/c.html">From</a></div> -->',
    '<noscript><div class="mov"><a class="mov-t" href="/n.html">From</a></div></noscript>']) {
    const html = resultsPage({ results, head });
    assert.ok(fragment(html).startsWith('<div class="mov"><a class="mov-t" href="/from.html">'), head);
    assert.deepEqual(Array.from((await search('From saison 1', html)).candidates, c => c.url), [`${base}/from.html`], head);
  }
  // Commentaire jamais fermé : aucun élément après lui, page entière.
  const unclosed = resultsPage({ results, head: '<!-- ' });
  assert.equal(fragment(unclosed), unclosed);
  // Bloc de résultat après la fin du contenu : rien n'est coupé après elle.
  const late = resultsPage({ results, sidebar: card('From (2022)', '/late.html', 1) });
  assert.ok(fragment(late).endsWith('</html>'));
  assert.deepEqual(Array.from((await search('From saison 1', late)).candidates, c => c.url).sort(),
    [`${base}/from.html`, `${base}/late.html`]);
  // Sans repère de fin de contenu : jusqu'au bout de la page.
  const noEnd = resultsPage({ results, end: '' });
  assert.ok(fragment(noEnd).endsWith('</html>'));
  // Sans aucun bloc : page entière.
  const none = '<html><body><p>Aucun résultat</p></body></html>';
  assert.equal(fragment(none), none);
});

test('le coupe-circuit Flemmix reste une indisponibilité, sans journal à chaque appel', async () => {
  const logs = [], steps = [];
  const capture = { log: (...args) => logs.push(args.join(' ')), error: (...args) => logs.push(args.join(' ')) };
  const failWith = error => async () => { throw error; };
  const circuitOpen = Object.assign(new Error('Source Flemmix en pause'), {
    code: 'SOURCE_CIRCUIT_OPEN', isSourceCircuitOpen: true, httpStatus: 503,
  });
  const paused = load({
    makeWiflixSearchRequest: failWith(circuitOpen), makeWiflixRequest: failWith(circuitOpen),
    refreshStep: (stage, details, error) => steps.push(`${stage} ${details.query} ${error?.code}`),
    console: capture,
  });
  const result = await paused.search('From saison 1');
  // Indisponible, et non « aucun résultat » : pas de liste de candidats vide.
  assert.equal(result.unavailable, true);
  assert.equal(result.url, null);
  assert.equal(result.candidates, undefined);
  assert.deepEqual(steps, ['search_error From saison 1 SOURCE_CIRCUIT_OPEN']);
  // Fiche non chargée : sans identité, la boucle la traite comme une panne.
  const page = await paused.extract(`${base}/from.html`);
  assert.equal(page.identity, undefined);
  assert.equal(page.players.length, 0);
  assert.deepEqual(logs, []);

  // Les autres échecs restent journalisés.
  const timeout = Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED' });
  const failing = load({
    makeWiflixSearchRequest: failWith(timeout), makeWiflixRequest: failWith(timeout), console: capture,
  });
  assert.equal((await failing.search('From saison 1')).unavailable, true);
  assert.equal((await failing.extract(`${base}/from.html`)).identity, undefined);
  assert.deepEqual(logs, [
    '[WIFLIX SEARCH] Echec: timeout of 15000ms exceeded',
    '[WIFLIX PLAYERS] Echec: timeout of 15000ms exceeded',
  ]);
});

// Fiche au format du 2026-11-22 : jetons « fx1_ », hébergeur en base64 dans
// data-n, clé de page dans un tableau XOR.
const b64 = (text) => Buffer.from(text).toString('base64');
const keyScript = (key, mask = 65) => `<script>(function(){var _a=[${
  [...`${key}|sl`].map((c) => c.charCodeAt(0) ^ mask).join(',')}],_m=${mask},_in=1;})();</script>`;
const tokenPage = keyScript('cle42')
  + '<div class="tabs-sel linkstab">'
  + `<a data-v="fx1_aaa" onclick="playSafe(this)"><span data-n="${b64('Vidara')}">Lecteur HD</span></a>`
  + `<a data-v="fx1_bbb" onclick="playSafe(this)"><span data-n="${b64('Voe')}">Lecteur HD</span></a>`
  + `<a data-v="https://direct.test/e/1"><span>Direct</span></a>`
  + `<a data-v="fx1_ccc" onclick="playSafe(this)"><span data-n="${b64('Swish')}">Lecteur HD</span></a>`
  + '</div>';

function tokenSource(resolve) {
  const calls = [];
  const context = load({
    parseSourceIdentity: () => ({ year: 2026 }),
    makeWiflixRequest: async (url, options = {}) => {
      if (!options.method) return { data: tokenPage };
      const params = new URLSearchParams(options.data);
      calls.push({ url, referer: options.headers.Referer, v: params.get('v'), k: params.get('k'), b: params.get('b') });
      return { data: await resolve(params.get('v')) };
    },
  });
  return { context, calls };
}

test('les jetons fx1_ sont échangés après coup, dans l’ordre de la fiche', async () => {
  const urls = { fx1_aaa: 'https://vidara.to/e/A', fx1_bbb: 'https://lancewhosedifficult.com/e/B' };
  const { context, calls } = tokenSource(async (token) => (urls[token]
    ? JSON.stringify({ u: urls[token] }) : '{"e":"expired"}'));
  const pageUrl = `${base}/film-en-streaming/1-film.html`;
  const extraction = await context.extract(pageUrl);
  // Avant l'échange : seul le lien lisible, aucune requête de jeton.
  assert.equal(extraction.tokenCount, 3);
  assert.deepEqual(Array.from(extraction.players, (p) => p.url), ['https://direct.test/e/1']);
  assert.equal(calls.length, 0);

  assert.deepEqual({ ...await context.complete(extraction) }, { ok: true });
  assert.deepEqual(Array.from(extraction.players, (p) => [p.name, p.url]), [
    ['vidara.to', 'https://vidara.to/e/A'],
    // Nom « Voe » lu dans data-n : domaine miroir réécrit comme avant.
    ['voe.sx', 'https://voe.sx/e/B'],
    ['direct.test', 'https://direct.test/e/1'],
  ]);
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.url, `${base}/ajax_player.php`);
    assert.equal(call.referer, pageUrl);
    assert.equal(call.k, 'cle42');
    assert.equal(call.b, '1');
  }
  // Déjà complétée : rien à refaire.
  assert.deepEqual({ ...await context.complete(extraction) }, { ok: true });
  assert.equal(calls.length, 3);
});

test('débit global atteint ou aucun jeton échangé : panne, jamais un introuvable', async () => {
  const limited = tokenSource(async () => {
    throw Object.assign(new Error('Débit global'), { code: 'WIFLIX_RATE_LIMITED' });
  });
  const first = await limited.context.extract(`${base}/a.html`);
  assert.deepEqual({ ...await limited.context.complete(first) }, { ok: false, rateLimited: true });

  const onlyTokens = tokenPage.replace(/<a data-v="https:[^]*?<\/a>/, '');
  const refused = load({
    parseSourceIdentity: () => ({ year: null }),
    makeWiflixRequest: async (_url, options = {}) => ({ data: options.method ? '{"e":"expired"}' : onlyTokens }),
  });
  const second = await refused.extract(`${base}/b.html`);
  assert.equal(second.players.length, 0);
  assert.deepEqual({ ...await refused.complete(second) }, { ok: false });
});
