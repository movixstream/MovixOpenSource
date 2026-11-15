#!/usr/bin/env node
'use strict';

/**
 * Scénario de bout en bout de la source anime-sama, contre le VRAI site et une
 * vraie base MySQL de test.
 *
 * Ce qui tourne pour de vrai : la route `/anime` (routes/animeSama.js), la
 * lecture des pages, `/api/lien.php`, l'index du catalogue et ses requêtes
 * SQL, le schéma créé par `ensureTableGroup`, et la correspondance AniList/MAL
 * vers TMDB demandée au vrai service ARM (arm.haglund.dev).
 * Ce qui est remplacé : Redis (aucun), le dossier de cache (dossier
 * temporaire), l'extraction m3u8, et le transport — le Main API passe par
 * CycleTLS et des proxys, ce script par axios avec les mêmes en-têtes.
 *
 * Prérequis :
 *   - accès à https://anime-sama.to et à https://arm.haglund.dev ;
 *   - une base MySQL jetable dont le nom finit par `_test`, par exemple :
 *       docker run -d --name movix-as-mysql -e MYSQL_ROOT_PASSWORD=<mdp> \
 *         -e MYSQL_DATABASE=movix_test -p 127.0.0.1:33407:3306 mysql:8.0
 *   - les dépendances du Main API (`npm ci` dans API/Mainapi, ou NODE_PATH).
 *
 * Relance :
 *   ANIME_SAMA_E2E_MYSQL=mysql://root:<mdp>@127.0.0.1:33407/movix_test \
 *     node API/Mainapi/scripts/e2e/animeSamaLive.js [dossier du rapport]
 *
 * Le rapport (report.md, report.json, réponses, journal des requêtes, cache
 * produit) est écrit dans le dossier donné, ou dans un dossier temporaire. Il
 * ne contient ni mot de passe ni jeton. Code de sortie 1 si un contrôle échoue.
 */

const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');

const ROOT = path.join(__dirname, '..', '..');
const SITE = 'https://anime-sama.to/';
const OUT_DIR = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'movix-e2e', `anime-sama-live-${Date.now()}`));
const CACHE_DIR = path.join(OUT_DIR, 'cache');
const MYSQL_URL = process.env.ANIME_SAMA_E2E_MYSQL || '';

// Œuvres du scénario : une petite série en cours, une grosse, une saison
// masquée par le site, une œuvre en scans seulement.
const SMALL = { query: 'Firefly Wedding', slug: 'firefly-wedding', tmdb: ['tv', 320909] };
const BIG = { query: 'Les Carnets de l\'Apothicaire', slug: 'les-carnets-de-lapothicaire' };
const HIDDEN = { query: 'Danshi Koukousei no Nichijou', slug: 'danshi-koukousei-no-nichijou' };
const SCANS_ONLY = { query: 'The Gamer', slug: 'the-gamer' };
// Fiche qui ne publie pas d'ID TMDB (relevé le 15/11/2026) mais donne son ID
// AniList ; `tmdb` est sa fiche TMDB, vérifiée à la main.
const UNLINKED = { query: 'Doumo, Sukina Hito ni Horegusuri wo Irai Sareta Majo Desu', slug: 'doumo-sukina-hito-ni-horegusuri-wo-irai-sareta-majo-desu', keyword: 'horegusuri', tmdb: ['tv', 313068] };
// Fiche sans ID TMDB dont l'ID AniList est celui de la série mère, que le site
// relie déjà à `holder`.
const GUARDED = { slug: 'sasuke-retsuden', holder: 'naruto', tmdb: ['tv', 46260] };

const checks = [];
const logs = [];
const requests = [];
// Demandes au service de correspondance ARM : `{ source, id, status, themoviedb }`.
const armCalls = [];
const sleep = ms => new Promise((resolve) => { setTimeout(resolve, ms); });

function check(name, expected, observed, pass) {
  checks.push({ name, expected, observed: typeof observed === 'string' ? observed : JSON.stringify(observed), pass: Boolean(pass) });
  process.stdout.write(`${pass ? 'OK  ' : 'ÉCHEC'} ${name} — attendu : ${expected} ; observé : ${typeof observed === 'string' ? observed : JSON.stringify(observed)}\n`);
}

// Module remplacé avant le chargement de la route (Redis, cache, extraction).
function stubModule(relativePath, exports) {
  const filename = require.resolve(path.join(ROOT, relativePath));
  require.cache[filename] = { id: filename, filename, loaded: true, exports, children: [], paths: [] };
}

// En-têtes posés par `axiosAnimeSamaRequest` (utils/axiosHelpers.js) : ceux
// d'une navigation, sur lesquels s'ajoutent ceux de l'appelant.
const MAIN_API_HEADERS = {
  'Accept-Language': 'fr-FR,fr;q=0.6',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
  Priority: 'u=0, i',
  'Sec-CH-UA': '"Chromium";v="142", "Brave";v="142", "Not_A Brand";v="99"',
  'Sec-CH-UA-Mobile': '?0',
  'Sec-CH-UA-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Sec-GPC': '1',
  'Upgrade-Insecure-Requests': '1',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
};

let inFlight = 0;
let lastRequestAt = 0;

function createTransport(axios) {
  return async function request(config) {
    const started = Date.now();
    inFlight += 1;
    const url = new URL(config.url);
    const entry = { method: String(config.method || 'get').toUpperCase(), path: url.pathname + (url.searchParams.has('l') ? `?l=${url.searchParams.get('l')}` : ''), status: 0, ms: 0 };
    try {
      const response = await axios({
        method: config.method || 'get',
        url: config.url,
        data: config.data,
        timeout: 30000,
        headers: { ...MAIN_API_HEADERS, ...(config.headers || {}) },
        responseType: 'text',
        transformResponse: [body => body],
        proxy: false,
      });
      entry.status = response.status;
      return { data: response.data, status: response.status, headers: response.headers, statusText: '', config };
    } catch (error) {
      entry.status = error?.response?.status || String(error?.code || 'erreur');
      throw error;
    } finally {
      entry.ms = Date.now() - started;
      requests.push(entry);
      inFlight -= 1;
      lastRequestAt = Date.now();
    }
  };
}

// Client du service ARM, à la façon d'axios : vraies requêtes, notées au rapport.
function createArmClient(axios) {
  return {
    async get(url, config = {}) {
      const entry = { source: config.params?.source, id: config.params?.id, status: 0, themoviedb: null };
      armCalls.push(entry);
      try {
        const response = await axios.get(url, { ...config, proxy: false });
        entry.status = response.status;
        entry.themoviedb = response.data?.themoviedb ?? null;
        return response;
      } catch (error) {
        entry.status = error?.response?.status || String(error?.code || 'erreur');
        throw error;
      }
    },
  };
}

// Le travail de fond d'une recherche est fini quand plus rien ne part vers le site.
async function waitIdle(maxMs = 180000) {
  const deadline = Date.now() + maxMs;
  await sleep(800);
  while (Date.now() < deadline) {
    if (inFlight === 0 && Date.now() - lastRequestAt > 2500) return true;
    await sleep(250);
  }
  return false;
}

function getJson(port, pathname) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: pathname }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); } catch (error) { reject(error); }
      });
    }).on('error', reject);
  });
}

const saveResponse = (name, value) => fsp.writeFile(path.join(OUT_DIR, 'responses', `${name}.json`), JSON.stringify(value, null, 2));
const linkCalls = () => requests.filter(entry => entry.path.startsWith('/api/lien.php'));
const titleOf = (list, slug) => (Array.isArray(list) ? list.find(item => String(item.url || '').includes(`/catalogue/${slug}`)) : null);

async function main() {
  const database = (() => { try { return new URL(MYSQL_URL).pathname.slice(1); } catch { return ''; } })();
  if (!database.endsWith('_test')) {
    process.stderr.write('ANIME_SAMA_E2E_MYSQL doit désigner une base de test (nom fini par `_test`).\n');
    process.exit(2);
  }
  await fsp.mkdir(path.join(OUT_DIR, 'responses'), { recursive: true });
  await fsp.mkdir(CACHE_DIR, { recursive: true });

  for (const level of ['log', 'warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => { logs.push(`[${level}] ${args.map(String).join(' ')}`); if (process.env.E2E_VERBOSE) original(...args); };
  }

  const cacheKey = text => crypto.createHash('md5').update(String(text).toLowerCase()).digest('hex');
  stubModule('utils/cacheManager.js', { ANIME_SAMA_CACHE_DIR: CACHE_DIR, generateCacheKey: cacheKey });
  stubModule('config/redis.js', { redis: null, memoryCache: { get: async () => undefined, set: async () => {} } });
  stubModule('utils/embedExtraction.js', { buildM3u8Map: async () => ({}) });

  const axios = require('axios');
  const express = require('express');
  const mysql = require('mysql2/promise');
  const { ensureTableGroup } = require(path.join(ROOT, 'db/runtimeEnsure'));
  const { createAnimeSamaIndex, createAnimeSamaStore } = require(path.join(ROOT, 'utils/animeSamaIndex'));
  const { createArmTmdbResolver } = require(path.join(ROOT, 'utils/animeSamaTmdbResolver'));
  const { parseTitlePage } = require(path.join(ROOT, 'utils/animeSamaPages'));
  const { createDeadPlayerList } = require(path.join(ROOT, 'utils/animeSamaDeadPlayers'));
  const animeSamaRouter = require(path.join(ROOT, 'routes/animeSama'));

  // ---- Base : tables créées par le vrai schéma, vidées pour un essai rejouable.
  const pool = mysql.createPool({ uri: MYSQL_URL, connectionLimit: 4, charset: 'utf8mb4' });
  await pool.query('DROP TABLE IF EXISTS anime_sama_planning, anime_sama_titles');
  await ensureTableGroup(pool, 'animeSama');
  await ensureTableGroup(pool, 'animeSama');
  const [tables] = await pool.query("SHOW TABLES LIKE 'anime\\_sama\\_%'");
  check('schéma : les deux tables sont créées, deux fois de suite sans erreur', '2 tables', `${tables.length} tables`, tables.length === 2);

  const request = createTransport(axios);
  const store = createAnimeSamaStore({ getPool: () => pool });
  const index = createAnimeSamaIndex({
    store,
    resolveTmdb: createArmTmdbResolver({ http: createArmClient(axios) }),
    request,
    siteUrl: SITE,
    pauseMs: 250,
    maxTitlesPerPass: 25,
  });
  const searchFile = key => path.join(CACHE_DIR, `${key}.json`);
  animeSamaRouter.configure({
    ANIME_SAMA_URL: SITE,
    axiosAnimeSamaRequest: request,
    getFromCacheNoExpiration: async (_dir, key) => { try { return JSON.parse(await fsp.readFile(searchFile(key), 'utf8')); } catch { return null; } },
    saveToCache: async (_dir, key, value) => { await fsp.writeFile(searchFile(key), JSON.stringify(value)); return true; },
    cleanupOldCacheFiles: async () => {},
    migrateOldCacheFiles: async () => {},
    deadPlayerList: createDeadPlayerList({ request }),
    animeIndex: index,
  });

  const app = express();
  app.use('/anime', animeSamaRouter);
  const server = await new Promise((resolve) => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  const { port } = server.address();
  const search = query => getJson(port, `/anime/search/${encodeURIComponent(query)}`);

  try {
    // ---- 1. Fiche par ID TMDB avant toute lecture : rien.
    const before = await getJson(port, `/anime/tmdb/${SMALL.tmdb[0]}/${SMALL.tmdb[1]}`);
    check('ID TMDB inconnu de l’index : liste vide, le site retombe sur la recherche par nom', '200 []', `${before.status} ${JSON.stringify(before.body)}`, before.status === 200 && Array.isArray(before.body) && before.body.length === 0);

    // ---- 2. Petite série : recherche par nom, puis lecture de fond (sans adresse).
    const first = await search(SMALL.query);
    check('recherche par nom : l’œuvre est trouvée', `une entrée /catalogue/${SMALL.slug}/`, titleOf(first.body, SMALL.slug)?.name || 'absente', Boolean(titleOf(first.body, SMALL.slug)));
    const idle = await waitIdle();
    check('la lecture de fond se termine', 'moins de 3 min', idle ? 'terminée' : 'toujours en cours', idle);
    check('l’actualisation ne demande aucune adresse à /api/lien.php', '0 appel', `${linkCalls().length} appel(s)`, linkCalls().length === 0);

    // Nombre d'épisodes lu sur la page elle-même, sans passer par le Main API.
    const seasonPage = await axios.get(`${SITE}catalogue/${SMALL.slug}/saison1/vostfr/`, { headers: { 'User-Agent': MAIN_API_HEADERS['User-Agent'] }, responseType: 'text', timeout: 20000 });
    const expectedEpisodes = Math.max(0, ...[...String(seasonPage.data).matchAll(/var eps\d+\s*=\s*\[([^\]]*)\]/g)].map(match => (match[1].match(/"[^"]*"/g) || []).length));

    const second = await search(SMALL.query);
    await saveResponse('recherche-firefly-wedding', second.body);
    const small = titleOf(second.body, SMALL.slug);
    const smallSeason = small?.seasons?.[0];
    const smallEpisodes = smallSeason?.episodes || [];
    check('épisodes lus sur le nouveau format', `${expectedEpisodes} épisodes en saison 1 (comptés sur la page)`, `${smallEpisodes.length} épisodes, ${small?.seasons?.length || 0} saison(s)`, expectedEpisodes > 0 && smallEpisodes.length === expectedEpisodes);
    const pendingOf = episode => (episode?.streaming_links || []).reduce((sum, link) => sum + (link.pending || 0), 0);
    check('chaque épisode est listé avec ses lecteurs à demander', 'slug, chemin de saison, et au moins un lecteur en attente par épisode', `slug ${small?.slug}, saison ${smallSeason?.path}, ${smallEpisodes.filter(episode => pendingOf(episode) > 0).length}/${smallEpisodes.length} épisodes en attente`, small?.slug === SMALL.slug && smallSeason?.path === 'saison1' && smallEpisodes.length > 0 && smallEpisodes.every(episode => pendingOf(episode) > 0));

    // ---- 2 bis. Lecture d'un épisode : ses adresses, et seulement les siennes.
    const wanted = pendingOf(smallEpisodes[0]);
    const played = await getJson(port, `/anime/episode/${SMALL.slug}?season=${smallSeason?.path}&episode=${smallEpisodes[0]?.index}`);
    await saveResponse('episode-firefly-wedding-1', played.body);
    const smallPlayers = (played.body.streaming_links || []).flatMap(link => link.players || []);
    const badPlayers = smallPlayers.filter(url => !/^https?:\/\/[^/\s]+\.[^/\s]+\//.test(url) || url.includes('lien:') || url.includes('anime-sama.'));
    check('lecture d’un épisode : chaque lecteur est une vraie adresse d’hébergeur', `${wanted} adresses, aucun repère \`lien:\` ni adresse anime-sama, plus rien en attente`, `${played.status} ; ${smallPlayers.length} lecteurs, ${badPlayers.length} incorrects, ${pendingOf(played.body)} en attente${played.body.limited ? ', limité' : ''}`, played.status === 200 && smallPlayers.length === wanted && badPlayers.length === 0 && pendingOf(played.body) === 0 && !played.body.limited);
    const smallLinkCalls = linkCalls();
    check('/api/lien.php répond aux en-têtes du Main API, pour ce seul épisode', `${wanted} appels, que des 200`, `${smallLinkCalls.length} appels, statuts ${[...new Set(smallLinkCalls.map(entry => entry.status))].join(', ') || 'aucun'}`, smallLinkCalls.length === wanted && smallLinkCalls.every(entry => entry.status === 200));

    const requestsBefore = requests.length;
    const replayed = await getJson(port, `/anime/episode/${SMALL.slug}?season=${smallSeason?.path}&episode=${smallEpisodes[0]?.index}`);
    check('deuxième lecture du même épisode : aucune requête vers anime-sama', '0 requête, mêmes lecteurs', `${requests.length - requestsBefore} requête(s), ${(replayed.body.streaming_links || []).flatMap(link => link.players).length} lecteurs`, requests.length === requestsBefore && JSON.stringify(replayed.body.streaming_links) === JSON.stringify(played.body.streaming_links));
    const missing = await getJson(port, `/anime/episode/${SMALL.slug}?season=saison99&episode=1`);
    const invalidEpisode = await getJson(port, `/anime/episode/${SMALL.slug}?season=..%2Fx&episode=1`);
    check('épisode inconnu et paramètres invalides', '404 et 400, sans requête', `${missing.status} et ${invalidEpisode.status}, ${requests.length - requestsBefore} requête(s)`, missing.status === 404 && invalidEpisode.status === 400 && requests.length === requestsBefore);

    // L'adresse rendue mène bien à une page de lecteur (aucune lecture lancée).
    let embedStatus = 'aucun lecteur';
    if (smallPlayers[0]) {
      try {
        const embed = await axios.get(smallPlayers[0], { timeout: 20000, headers: { 'User-Agent': MAIN_API_HEADERS['User-Agent'], Referer: SITE }, responseType: 'text', validateStatus: () => true, maxContentLength: 5e6 });
        embedStatus = `HTTP ${embed.status} (${new URL(smallPlayers[0]).hostname})`;
      } catch (error) {
        embedStatus = `erreur ${error.code || error.message}`;
      }
    }
    check('le premier lecteur répond chez son hébergeur', 'HTTP 200', embedStatus, embedStatus.startsWith('HTTP 200'));

    const cacheFiles = await fsp.readdir(path.join(CACHE_DIR, 'oeuvres')).catch(() => []);
    const linkBook = JSON.parse(await fsp.readFile(path.join(CACHE_DIR, 'liens', `${SMALL.slug}.json`), 'utf8').catch(() => '{}'));
    check('cache rangé par slug, avec son carnet de liens', `oeuvres/${SMALL.slug}.json + autant d’adresses que d’appels`, `${cacheFiles.join(', ') || 'aucun fichier'} ; ${Object.keys(linkBook).length} adresses pour ${smallLinkCalls.length} appels`, cacheFiles.includes(`${SMALL.slug}.json`) && Object.keys(linkBook).length === smallLinkCalls.length);

    const third = await search(SMALL.query);
    const listed = titleOf(third.body, SMALL.slug)?.seasons?.[0]?.episodes?.[0];
    check('la liste sert ensuite les adresses de l’épisode lu', `${wanted} lecteurs, rien en attente pour l’épisode 1`, `${(listed?.streaming_links || []).flatMap(link => link.players).length} lecteurs, ${pendingOf(listed)} en attente`, (listed?.streaming_links || []).flatMap(link => link.players).length === wanted && pendingOf(listed) === 0);

    // ---- 3. Même œuvre par son ID TMDB (la fiche lue a nourri l'index).
    const byTmdb = await getJson(port, `/anime/tmdb/${SMALL.tmdb[0]}/${SMALL.tmdb[1]}`);
    await saveResponse('tmdb-320909', byTmdb.body);
    const linked = titleOf(byTmdb.body, SMALL.slug);
    check('fiche par ID TMDB : la même œuvre, avec ses épisodes', `${SMALL.slug}, ${smallEpisodes.length} épisodes`, `${byTmdb.body.length} œuvre(s), ${linked?.seasons?.[0]?.episodes?.length || 0} épisodes`, byTmdb.body.length === 1 && linked?.seasons?.[0]?.episodes?.length === smallEpisodes.length);
    const unknown = await getJson(port, '/anime/tmdb/tv/999999999');
    const invalid = await getJson(port, '/anime/tmdb/person/12');
    check('ID TMDB sans fiche et type invalide', '200 [] et 400', `${unknown.status} ${JSON.stringify(unknown.body)} et ${invalid.status}`, unknown.status === 200 && unknown.body.length === 0 && invalid.status === 400);

    // ---- 4. Saison masquée et scans seuls : plus d'échec dans les logs.
    const logMark = logs.length;
    for (const title of [HIDDEN, SCANS_ONLY]) {
      await search(title.query);
      await waitIdle();
      const again = await search(title.query);
      await saveResponse(`recherche-${title.slug}`, again.body);
      const entry = titleOf(again.body, title.slug);
      check(`${title.query} : œuvre trouvée, sans épisode d’anime servi`, '0 saison', entry ? `${entry.seasons.length} saison(s)` : 'œuvre absente de la recherche', Boolean(entry) && entry.seasons.length === 0);
    }
    const failures = logs.slice(logMark).filter(line => line.includes('échouée'));
    check('aucun log « Actualisation … échouée » pour ces deux œuvres', '0 ligne', `${failures.length} ligne(s)${failures[0] ? ` : ${failures[0]}` : ''}`, failures.length === 0);

    // ---- 5. Grosse série : toutes les saisons listées sans une seule demande d'adresse.
    const bigMark = requests.length;
    const bigStart = Date.now();
    await search(BIG.query);
    const bigIdle = await waitIdle(300000);
    const bigSeconds = Math.round((Date.now() - bigStart) / 1000);
    const bigResult = await search(BIG.query);
    await saveResponse(`recherche-${BIG.slug}`, bigResult.body);
    const big = titleOf(bigResult.body, BIG.slug);
    const bigRequests = requests.slice(bigMark);
    const bigLinks = bigRequests.filter(entry => entry.path.startsWith('/api/lien.php'));
    const seasonSummary = (big?.seasons || []).map(season => `${season.name}: ${season.episodes.length}`).join(' ; ');
    check('grosse série : au moins 2 saisons avec des épisodes', '≥ 2 saisons, chacune ≥ 1 épisode', seasonSummary || 'aucune saison', bigIdle && (big?.seasons?.length || 0) >= 2 && big.seasons.every(season => season.episodes.length > 0));
    check('grosse série : lue sans toucher au quota de /api/lien.php', '0 appel à lien.php', `${bigRequests.length} requêtes de pages en ${bigSeconds} s, ${bigLinks.length} appel(s) à lien.php`, bigLinks.length === 0 && bigRequests.every(entry => entry.status === 200 || entry.status === 404));
    const lastSeason = big?.seasons?.[big.seasons.length - 1];
    const lastEpisode = lastSeason?.episodes?.[lastSeason.episodes.length - 1];
    const bigPlayed = lastEpisode ? await getJson(port, `/anime/episode/${BIG.slug}?season=${encodeURIComponent(lastSeason.path)}&episode=${lastEpisode.index}`) : { status: 0, body: {} };
    await saveResponse(`episode-${BIG.slug}-dernier`, bigPlayed.body);
    const bigPlayers = (bigPlayed.body.streaming_links || []).flatMap(link => link.players || []);
    check('grosse série : le dernier épisode de la dernière saison se lit', '≥ 1 lecteur, rien en attente', `${lastSeason?.name} épisode ${lastEpisode?.index} : ${bigPlayers.length} lecteurs dans ${(bigPlayed.body.streaming_links || []).map(link => link.language).join('+') || 'aucune langue'}, ${pendingOf(bigPlayed.body)} en attente`, bigPlayed.status === 200 && bigPlayers.length >= 1 && pendingOf(bigPlayed.body) === 0);
    check('tout le scénario reste loin du quota (300 demandes par 10 min)', '< 60 appels à lien.php en tout', `${linkCalls().length} appels`, linkCalls().length < 60);

    // ---- 5 bis. Fiche sans ID TMDB : reliée par son ID AniList (vrai service ARM).
    const rowOf = async slug => (await pool.query('SELECT tmdb_type, tmdb_id, anilist_id, mal_id FROM anime_sama_titles WHERE slug = ?', [slug]))[0][0] || null;
    const linkOf = row => (row?.tmdb_id ? `${row.tmdb_type}/${row.tmdb_id}` : 'aucun');
    const pageOf = async slug => String((await request({ method: 'get', url: `${SITE}catalogue/${slug}/` })).data);
    const publishesTmdb = html => /themoviedb\.org\/(?:tv|movie)\/\d+/i.test(html);
    const wantedLink = UNLINKED.tmdb.join('/');

    const unlinkedPage = await pageOf(UNLINKED.slug);
    const sitePublishes = publishesTmdb(unlinkedPage);
    const unlinkedBefore = await getJson(port, `/anime/tmdb/${wantedLink}`);
    check('fiche sans ID TMDB : inconnue par ID avant sa lecture', '200 []', `${unlinkedBefore.status} ${JSON.stringify(unlinkedBefore.body).slice(0, 80)}`, unlinkedBefore.status === 200 && unlinkedBefore.body.length === 0);

    const armMark = armCalls.length;
    await search(UNLINKED.query);
    await waitIdle();
    let unlinkedRow = null;
    for (let attempt = 0; attempt < 40 && !unlinkedRow?.tmdb_id; attempt++) {
      await sleep(500);
      unlinkedRow = await rowOf(UNLINKED.slug);
    }
    const asked = armCalls.slice(armMark);
    const askedText = asked.map(call => `${call.source}:${call.id} → ${call.status}, TMDB ${call.themoviedb}`).join(' ; ') || 'aucune demande';
    check('fiche sans ID TMDB : reliée par son ID AniList ou MAL', `${UNLINKED.slug} → ${wantedLink}, après une demande à ARM`, `base : ${linkOf(unlinkedRow)} (AniList ${unlinkedRow?.anilist_id ?? '∅'}, MAL ${unlinkedRow?.mal_id ?? '∅'}) ; ${sitePublishes ? 'la fiche publie désormais son ID TMDB, ARM sans objet' : `ARM : ${askedText}`}`, linkOf(unlinkedRow) === wantedLink && (sitePublishes || asked.some(call => call.status === 200 && call.themoviedb === UNLINKED.tmdb[1])));

    const derived = await getJson(port, `/anime/tmdb/${wantedLink}`);
    await saveResponse(`tmdb-${UNLINKED.tmdb[1]}`, derived.body);
    const derivedEpisodes = titleOf(derived.body, UNLINKED.slug)?.seasons?.[0]?.episodes?.length || 0;
    check('fiche par ID TMDB déduit : l’œuvre, avec ses épisodes', `${UNLINKED.slug}, ≥ 1 épisode`, `${derived.body.length} œuvre(s), ${derivedEpisodes} épisodes`, derived.body.length === 1 && derivedEpisodes >= 1);
    const derivedListed = await getJson(port, `/anime/catalogue?linked=1&q=${UNLINKED.keyword}`);
    check('catalogue : l’œuvre compte parmi celles « avec fiche TMDB »', `${UNLINKED.slug} avec tmdb ${wantedLink}`, derivedListed.body.items.map(item => `${item.slug}:${item.tmdb?.type}/${item.tmdb?.id}`).join(', ') || 'vide', derivedListed.body.items.some(item => item.slug === UNLINKED.slug && item.tmdb?.type === UNLINKED.tmdb[0] && item.tmdb?.id === UNLINKED.tmdb[1]));

    const unlinkedFiche = parseTitlePage(unlinkedPage, { slug: UNLINKED.slug });
    const replayMark = armCalls.length;
    await index.recordTitle(UNLINKED.slug, unlinkedFiche);
    check('relecture de la fiche : ARM n’est pas redemandé', '0 demande, lien inchangé', `${armCalls.length - replayMark} demande(s), base : ${linkOf(await rowOf(UNLINKED.slug))}`, armCalls.length === replayMark && linkOf(await rowOf(UNLINKED.slug)) === wantedLink);

    // ARM en panne, simulée à la frontière HTTP : le lien rangé en base reste.
    const offline = createAnimeSamaIndex({
      store,
      request,
      siteUrl: SITE,
      resolveTmdb: createArmTmdbResolver({ http: { get: async () => { throw Object.assign(new Error('timeout of 6000ms exceeded'), { code: 'ECONNABORTED' }); } } }),
    });
    const savedOffline = await offline.recordTitle(UNLINKED.slug, unlinkedFiche);
    check('ARM en panne : la fiche est rangée et son lien reste', `rangée, ${wantedLink}`, `${savedOffline ? 'rangée' : 'refusée'}, base : ${linkOf(await rowOf(UNLINKED.slug))}`, savedOffline === true && linkOf(await rowOf(UNLINKED.slug)) === wantedLink);

    // Une fiche dont l'ID AniList mène à la page d'une autre œuvre ne la lui prend pas.
    const holderFiche = parseTitlePage(await pageOf(GUARDED.holder), { slug: GUARDED.holder });
    const guardedFiche = parseTitlePage(await pageOf(GUARDED.slug), { slug: GUARDED.slug });
    await index.recordTitle(GUARDED.holder, holderFiche);
    const guardMark = armCalls.length;
    await index.recordTitle(GUARDED.slug, guardedFiche);
    const guardLink = GUARDED.tmdb.join('/');
    const guardApplies = linkOf(await rowOf(GUARDED.holder)) === guardLink && !guardedFiche.tmdb && armCalls.slice(guardMark).some(call => call.themoviedb === GUARDED.tmdb[1]);
    check('une fiche déduite ne prend pas la page d’une œuvre que le site relie déjà', `${GUARDED.holder} garde ${guardLink}, ${GUARDED.slug} reste sans lien`, guardApplies ? `${GUARDED.holder} : ${linkOf(await rowOf(GUARDED.holder))} ; ${GUARDED.slug} : ${linkOf(await rowOf(GUARDED.slug))}` : `sans objet : les fiches du site ont changé (${GUARDED.holder} ${linkOf(await rowOf(GUARDED.holder))}, ${GUARDED.slug} publie ${guardedFiche.tmdb ? 'son ID TMDB' : 'un autre ID AniList'})`, !guardApplies || linkOf(await rowOf(GUARDED.slug)) === 'aucun');

    // ---- 6. Index du catalogue : un passage borné à 25 fiches, plus le planning.
    const report = await index.runOnce();
    check('passage de l’index : sitemap lu, fiches rangées, planning lu', '≥ 2000 fiches au sitemap, ≥ 20 rangées, planning ≥ 1 jour', report, Boolean(report) && report.listed >= 2000 && report.saved >= 20 && report.planning?.days >= 1 && report.planning.entries >= 1);

    const [[stats]] = await pool.query('SELECT COUNT(*) AS total, SUM(tmdb_id IS NOT NULL) AS linked, SUM(season_count > 0) AS anime FROM anime_sama_titles');
    check('base : fiches rangées avec ID TMDB', '≥ 20 fiches, majorité avec ID TMDB parmi celles qui ont un anime', stats, Number(stats.total) >= 20 && Number(stats.linked) >= Number(stats.anime) * 0.6);

    const catalogue = await getJson(port, '/anime/catalogue?limit=10');
    await saveResponse('catalogue', catalogue.body);
    check('catalogue : page de 10 œuvres qui ont toutes un anime', '10 éléments, seasonCount ≥ 1', `${catalogue.body.items.length} éléments sur ${catalogue.body.total}`, catalogue.body.items.length === 10 && catalogue.body.items.every(item => item.seasonCount >= 1 && item.slug && item.name));
    const byName = await getJson(port, '/anime/catalogue?q=firefly');
    check('catalogue : recherche par nom', `contient ${SMALL.slug} avec tmdb ${SMALL.tmdb.join('/')}`, byName.body.items.map(item => `${item.slug}:${item.tmdb?.type}/${item.tmdb?.id}`).join(', ') || 'vide', byName.body.items.some(item => item.slug === SMALL.slug && item.tmdb?.id === SMALL.tmdb[1]));
    const wildcard = await getJson(port, '/anime/catalogue?q=%25');
    check('catalogue : « % » n’est pas un joker', '0 élément', `${wildcard.body.total} élément(s)`, wildcard.body.total === 0);
    const linkedOnly = await getJson(port, '/anime/catalogue?linked=1&limit=60');
    check('catalogue : filtre « avec fiche TMDB »', 'toutes les œuvres ont un ID TMDB', `${linkedOnly.body.items.filter(item => item.tmdb).length}/${linkedOnly.body.items.length}`, linkedOnly.body.items.length > 0 && linkedOnly.body.items.every(item => item.tmdb && item.tmdb.id > 0));
    const genres = await getJson(port, '/anime/catalogue/genres');
    const genre = genres.body.genres?.[0]?.name;
    const byGenre = genre ? await getJson(port, `/anime/catalogue?limit=60&genre=${encodeURIComponent(genre)}`) : { body: { items: [] } };
    check('catalogue : liste des genres et filtre par genre', 'genres non vides ; le filtre ne rend que ce genre', `${genres.body.genres?.length || 0} genres ; « ${genre} » : ${byGenre.body.items.length} œuvres`, Boolean(genre) && byGenre.body.items.length === genres.body.genres[0].count && byGenre.body.items.every(item => item.genres.includes(genre)));
    const pageTwo = await getJson(port, '/anime/catalogue?limit=5&page=2&sort=name');
    const pageOne = await getJson(port, '/anime/catalogue?limit=5&page=1&sort=name');
    check('catalogue : pagination sans doublon', 'pages 1 et 2 disjointes, triées par nom', `${pageOne.body.items.map(item => item.slug).join(',')} | ${pageTwo.body.items.map(item => item.slug).join(',')}`, pageOne.body.items.length === 5 && pageTwo.body.items.length > 0 && pageTwo.body.items.every(item => !pageOne.body.items.some(other => other.slug === item.slug)));

    const planning = await getJson(port, '/anime/planning');
    await saveResponse('planning', planning.body);
    const entries = planning.body.entries || [];
    const wellFormed = entries.filter(entry => /^\d{4}-\d{2}-\d{2}$/.test(entry.day) && entry.slug && entry.lang && entry.name);
    check('planning : sorties de la semaine', '≥ 20 sorties bien formées, dont certaines avec une heure', `${entries.length} sorties, ${wellFormed.length} bien formées, ${entries.filter(entry => entry.releaseAt).length} avec heure`, entries.length >= 20 && wellFormed.length === entries.length && entries.some(entry => entry.releaseAt));
    const smallInPlanning = entries.find(entry => entry.slug === SMALL.slug);
    check('planning : une sortie d’une œuvre indexée porte son ID TMDB', `${SMALL.slug} → tv/${SMALL.tmdb[1]}`, smallInPlanning ? `${smallInPlanning.day} ${smallInPlanning.lang} tmdb ${smallInPlanning.tmdb?.type}/${smallInPlanning.tmdb?.id}` : `${SMALL.slug} absent du planning de la semaine`, !smallInPlanning || smallInPlanning.tmdb?.id === SMALL.tmdb[1]);
    const outside = await getJson(port, '/anime/planning?from=2001-01-01&to=2001-01-31');
    check('planning : hors période, rien', '0 sortie', `${outside.body.entries.length} sortie(s)`, outside.body.entries.length === 0);
  } finally {
    server.close();
    await pool.end().catch(() => {});
  }
}

async function writeReport(fatal) {
  const failed = checks.filter(item => !item.pass);
  const statuses = {};
  for (const entry of requests) statuses[entry.status] = (statuses[entry.status] || 0) + 1;
  const armStatuses = {};
  for (const entry of armCalls) armStatuses[entry.status] = (armStatuses[entry.status] || 0) + 1;
  const summary = {
    date: new Date().toISOString(),
    site: SITE,
    command: 'ANIME_SAMA_E2E_MYSQL=mysql://<utilisateur>:<mdp>@<hôte>:<port>/<base>_test node API/Mainapi/scripts/e2e/animeSamaLive.js [dossier]',
    node: process.version,
    passed: checks.length - failed.length,
    failed: failed.length,
    fatal: fatal ? String(fatal.stack || fatal) : null,
    requests: { total: requests.length, byStatus: statuses, linkCalls: requests.filter(entry => entry.path.startsWith('/api/lien.php')).length },
    arm: { total: armCalls.length, byStatus: armStatuses },
    checks,
  };
  await fsp.mkdir(OUT_DIR, { recursive: true });
  await fsp.writeFile(path.join(OUT_DIR, 'report.json'), JSON.stringify(summary, null, 2));
  await fsp.writeFile(path.join(OUT_DIR, 'requests.jsonl'), requests.map(entry => JSON.stringify(entry)).join('\n'));
  await fsp.writeFile(path.join(OUT_DIR, 'arm.jsonl'), armCalls.map(entry => JSON.stringify(entry)).join('\n'));
  await fsp.writeFile(path.join(OUT_DIR, 'logs.txt'), logs.join('\n'));
  const lines = [
    '# Source anime-sama — scénario de bout en bout (site réel)',
    '',
    `- Date : ${summary.date}`,
    `- Site : ${SITE}`,
    `- Node : ${process.version}`,
    `- Résultat : **${summary.passed}/${checks.length} contrôles réussis**${fatal ? ' — arrêt sur erreur' : ''}`,
    `- Requêtes vers le site : ${summary.requests.total} (dont ${summary.requests.linkCalls} à /api/lien.php) ; statuts : ${Object.entries(statuses).map(([status, count]) => `${status} × ${count}`).join(', ')}`,
    `- Demandes au service ARM : ${armCalls.length} ; statuts : ${Object.entries(armStatuses).map(([status, count]) => `${status} × ${count}`).join(', ') || 'aucune'}`,
    '',
    '## Relance',
    '',
    '```bash',
    summary.command,
    '```',
    '',
    'Prérequis : accès à anime-sama.to et à arm.haglund.dev, base MySQL jetable (nom fini par `_test`), dépendances du Main API.',
    `Données : ${[SMALL, BIG, HIDDEN, SCANS_ONLY].map(title => title.slug).join(', ')} ; ID TMDB ${SMALL.tmdb.join('/')}. Sans ID TMDB sur le site : ${UNLINKED.slug} (attendu ${UNLINKED.tmdb.join('/')}), ${GUARDED.slug} (page ${GUARDED.tmdb.join('/')} déjà tenue par ${GUARDED.holder}).`,
    'Remplacé pour l’essai : Redis, dossier de cache, extraction m3u8, transport (axios direct au lieu de CycleTLS + proxys, mêmes en-têtes). Le service ARM est le vrai, sauf pour la panne, simulée.',
    '',
    '## Contrôles',
    '',
    '| | Contrôle | Attendu | Observé |',
    '| --- | --- | --- | --- |',
    ...checks.map(item => `| ${item.pass ? '✅' : '❌'} | ${item.name} | ${item.expected} | ${String(item.observed).replace(/\|/g, '\\|').slice(0, 400)} |`),
    '',
    fatal ? `## Erreur\n\n\`\`\`\n${String(fatal.stack || fatal)}\n\`\`\`\n` : '',
    'Fichiers joints : `report.json`, `requests.jsonl` (sans jeton), `arm.jsonl`, `logs.txt`, `responses/*.json`.',
    '',
  ];
  await fsp.writeFile(path.join(OUT_DIR, 'report.md'), lines.join('\n'));
  process.stdout.write(`\nRapport : ${path.join(OUT_DIR, 'report.md')}\n${summary.passed}/${checks.length} contrôles réussis\n`);
  return failed.length === 0 && !fatal;
}

main()
  .then(() => writeReport(null))
  .catch(async (error) => { process.stderr.write(`${error.stack || error}\n`); return writeReport(error); })
  .then((ok) => { process.exit(ok ? 0 : 1); });
