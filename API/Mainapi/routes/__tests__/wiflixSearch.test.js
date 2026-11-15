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
const searchSource = source.slice(start, end)
  + '\nglobalThis.search = searchWiflixMovie;\nglobalThis.extract = extractWiflixPlayers;';
const base = 'https://source.test';

function card(title, href, season = null) {
  return `<div class="mov"><a class="mov-t" href="${href}">${title}</a>${
    season === null ? '' : `<div class="block-sai">Saison ${season}\n French</div>`
  }</div>`;
}

function load(globals) {
  const context = vm.createContext({
    cheerio, URL,
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
