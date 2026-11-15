#!/usr/bin/env node
'use strict';

/**
 * Scénario de bout en bout : une recherche anime-sama dont le cache garde une
 * entrée qui pointe sur une page de saison (`/catalogue/<œuvre>/saison2/vf/`)
 * au lieu de la fiche de l'œuvre.
 *
 * Panne observée en prod : `[ANIME-SAMA] Actualisation de vf échouée : Fiche
 * AnimeSama illisible`. Le nom « vf » est le dernier segment de l'adresse ; la
 * page de saison n'est pas une fiche, donc chaque actualisation échoue, et le
 * cache de recherche (jamais expiré) resservait cette entrée pour toujours.
 *
 * Ce qui tourne pour de vrai : la route `/anime` (routes/animeSama.js), la
 * lecture des pages et le vrai site anime-sama.to. Remplacé : Redis (aucun),
 * le dossier de cache (dossier temporaire), l'index MySQL (absent : la
 * recherche n'en dépend pas), l'extraction m3u8 et le transport (axios direct
 * avec les en-têtes du Main API, au lieu de CycleTLS + proxys).
 * Aucune demande à /api/lien.php (contrôlé).
 *
 * Relance :
 *   NODE_PATH=<dépendances du Main API>/node_modules \
 *     node API/Mainapi/scripts/e2e/animeSamaStaleSearchCache.js [dossier du rapport]
 *
 * Prérequis : accès à https://anime-sama.to. Environ 10 requêtes vers le site.
 * Code de sortie 1 si un contrôle échoue.
 */

const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');

const ROOT = path.join(__dirname, '..', '..');
const SITE = 'https://anime-sama.to/';
const OUT_DIR = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'movix-e2e', `anime-sama-stale-search-${Date.now()}`));
const CACHE_DIR = path.join(OUT_DIR, 'cache');

// Œuvre du scénario et entrée de cache telle qu'on la trouve en prod.
const TITLE = { query: 'A Couple of Cuckoos', slug: 'a-couple-of-cuckoos', name: 'A Couple of Cuckoos' };
const STALE_ENTRY = {
  url: `${SITE}catalogue/${TITLE.slug}/saison2/vf/`,
  name: 'vf',
  image: '',
  alternative_names: [],
  alternative_names_string: '',
};

const checks = [];
const logs = [];
const requests = [];
const sleep = ms => new Promise((resolve) => { setTimeout(resolve, ms); });

function check(name, expected, observed, pass) {
  const text = typeof observed === 'string' ? observed : JSON.stringify(observed);
  checks.push({ name, expected, observed: text, pass: Boolean(pass) });
  process.stdout.write(`${pass ? 'OK  ' : 'ÉCHEC'} ${name} — attendu : ${expected} ; observé : ${text}\n`);
}

function stubModule(relativePath, exports) {
  const filename = require.resolve(path.join(ROOT, relativePath));
  require.cache[filename] = { id: filename, filename, loaded: true, exports, children: [], paths: [] };
}

// En-têtes posés par `axiosAnimeSamaRequest` (utils/axiosHelpers.js).
const MAIN_API_HEADERS = {
  'Accept-Language': 'fr-FR,fr;q=0.6',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
};

let inFlight = 0;
let lastRequestAt = 0;

function createTransport(axios) {
  return async function request(config) {
    const started = Date.now();
    inFlight += 1;
    const entry = { method: String(config.method || 'get').toUpperCase(), path: new URL(config.url).pathname, status: 0, ms: 0 };
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

async function waitIdle(maxMs = 120000) {
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

const describe = list => (Array.isArray(list) ? list.map(item => `${item.name} <${item.url}>`).join(' ; ') : JSON.stringify(list));
const isSeasonUrl = url => /\/catalogue\/[^/?#]+\/[^/?#]+/.test(String(url || ''));

async function main() {
  await fsp.mkdir(path.join(OUT_DIR, 'responses'), { recursive: true });
  await fsp.mkdir(CACHE_DIR, { recursive: true });

  for (const level of ['log', 'warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => { logs.push(`[${level}] ${args.map(String).join(' ')}`); if (process.env.E2E_VERBOSE) original(...args); };
  }

  const cacheKey = text => crypto.createHash('md5').update(String(text)).digest('hex');
  stubModule('utils/cacheManager.js', { ANIME_SAMA_CACHE_DIR: CACHE_DIR, generateCacheKey: cacheKey });
  stubModule('config/redis.js', { redis: null, memoryCache: { get: async () => undefined, set: async () => {} } });
  stubModule('utils/embedExtraction.js', { buildM3u8Map: async () => ({}) });

  const axios = require('axios');
  const express = require('express');
  const { createDeadPlayerList } = require(path.join(ROOT, 'utils/animeSamaDeadPlayers'));
  const animeSamaRouter = require(path.join(ROOT, 'routes/animeSama'));

  const request = createTransport(axios);
  const searchFile = key => path.join(CACHE_DIR, `${key}.json`);
  animeSamaRouter.configure({
    ANIME_SAMA_URL: SITE,
    axiosAnimeSamaRequest: request,
    getFromCacheNoExpiration: async (_dir, key) => { try { return JSON.parse(await fsp.readFile(searchFile(key), 'utf8')); } catch { return null; } },
    saveToCache: async (_dir, key, value) => { await fsp.writeFile(searchFile(key), JSON.stringify(value)); return true; },
    cleanupOldCacheFiles: async () => {},
    migrateOldCacheFiles: async () => {},
    deadPlayerList: createDeadPlayerList({ request }),
  });

  // Cache de recherche tel qu'en prod : une seule entrée, la page de saison.
  const seeded = searchFile(cacheKey(TITLE.query));
  await fsp.writeFile(seeded, JSON.stringify([STALE_ENTRY]));

  const app = express();
  app.use('/anime', animeSamaRouter);
  const server = await new Promise((resolve) => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  const { port } = server.address();
  const search = query => getJson(port, `/anime/search/${encodeURIComponent(query)}`);

  try {
    const first = await search(TITLE.query);
    await fsp.writeFile(path.join(OUT_DIR, 'responses', 'recherche-1.json'), JSON.stringify(first.body, null, 2));
    const found = Array.isArray(first.body) ? first.body.find(item => item.slug === TITLE.slug) : null;
    check('la réponse donne l’œuvre sous son nom et l’adresse de sa fiche',
      `« ${TITLE.name} » <${SITE}catalogue/${TITLE.slug}/>`,
      `${first.status} ${describe(first.body)}`,
      first.status === 200 && found?.name === TITLE.name && found?.url === `${SITE}catalogue/${TITLE.slug}/`);
    check('aucune entrée de la réponse ne pointe sur une page de saison', '0 entrée',
      `${(first.body || []).filter(item => isSeasonUrl(item.url)).length} entrée(s)`,
      Array.isArray(first.body) && first.body.every(item => !isSeasonUrl(item.url)));

    const idle = await waitIdle();
    check('la lecture de fond se termine', 'moins de 2 min', idle ? 'terminée' : 'toujours en cours', idle);
    const failures = logs.filter(line => /échouée|illisible/i.test(line));
    check('aucun log « Actualisation … échouée » ni « Fiche AnimeSama illisible »', '0 ligne',
      `${failures.length} ligne(s)${failures[0] ? ` : ${failures[0]}` : ''}`, failures.length === 0);

    const ficheReads = requests.filter(entry => entry.method === 'GET' && entry.path === `/catalogue/${TITLE.slug}/`);
    const seasonAsFiche = requests.filter(entry => entry.method === 'GET' && entry.path === new URL(STALE_ENTRY.url).pathname);
    check('l’actualisation lit la fiche de l’œuvre', '≥ 1 lecture de la fiche',
      `${ficheReads.length} lecture(s) de /catalogue/${TITLE.slug}/`, ficheReads.length >= 1);

    const saved = JSON.parse(await fsp.readFile(seeded, 'utf8'));
    check('le cache de recherche est réparé', 'plus d’entrée vers une page de saison, l’œuvre sous son nom',
      describe(saved), Array.isArray(saved) && saved.every(item => !isSeasonUrl(item.url)) && saved.some(item => item.name === TITLE.name));

    const second = await search(TITLE.query);
    await fsp.writeFile(path.join(OUT_DIR, 'responses', 'recherche-2.json'), JSON.stringify(second.body, null, 2));
    const listed = (second.body || []).find(item => item.slug === TITLE.slug);
    const summary = (listed?.seasons || []).map(season => `${season.name}: ${season.episodes.length}`).join(' ; ');
    check('la recherche suivante sert les saisons de l’œuvre', '≥ 1 saison avec des épisodes',
      summary || 'aucune saison', (listed?.seasons || []).some(season => season.episodes.length > 0));

    const linkCalls = requests.filter(entry => entry.path.startsWith('/api/lien.php'));
    check('aucune demande à /api/lien.php', '0 appel', `${linkCalls.length} appel(s) ; ${requests.length} requêtes au site, ${seasonAsFiche.length} lecture(s) de la page de saison`, linkCalls.length === 0);
  } finally {
    server.close();
  }
}

async function writeReport(fatal) {
  const failed = checks.filter(item => !item.pass);
  const statuses = {};
  for (const entry of requests) statuses[entry.status] = (statuses[entry.status] || 0) + 1;
  const command = 'NODE_PATH=<dépendances du Main API>/node_modules node API/Mainapi/scripts/e2e/animeSamaStaleSearchCache.js [dossier]';
  await fsp.mkdir(OUT_DIR, { recursive: true });
  await fsp.writeFile(path.join(OUT_DIR, 'report.json'), JSON.stringify({
    date: new Date().toISOString(), site: SITE, command, node: process.version,
    passed: checks.length - failed.length, failed: failed.length, fatal: fatal ? String(fatal.stack || fatal) : null,
    requests: { total: requests.length, byStatus: statuses }, checks,
  }, null, 2));
  await fsp.writeFile(path.join(OUT_DIR, 'requests.jsonl'), requests.map(entry => JSON.stringify(entry)).join('\n'));
  await fsp.writeFile(path.join(OUT_DIR, 'logs.txt'), logs.join('\n'));
  const lines = [
    '# Anime-sama — cache de recherche qui pointe sur une page de saison (site réel)',
    '',
    `- Date : ${new Date().toISOString()}`,
    `- Site : ${SITE}`,
    `- Node : ${process.version}`,
    `- Résultat : **${checks.length - failed.length}/${checks.length} contrôles réussis**${fatal ? ' — arrêt sur erreur' : ''}`,
    `- Requêtes vers le site : ${requests.length} ; statuts : ${Object.entries(statuses).map(([status, count]) => `${status} × ${count}`).join(', ') || 'aucune'}`,
    '',
    '## Relance',
    '',
    '```bash',
    command,
    '```',
    '',
    `Données : recherche « ${TITLE.query} », cache de départ \`${JSON.stringify(STALE_ENTRY)}\`.`,
    'Remplacé pour l’essai : Redis, dossier de cache, index MySQL, extraction m3u8, transport (axios direct, mêmes en-têtes).',
    '',
    '## Contrôles',
    '',
    '| | Contrôle | Attendu | Observé |',
    '| --- | --- | --- | --- |',
    ...checks.map(item => `| ${item.pass ? '✅' : '❌'} | ${item.name} | ${item.expected} | ${String(item.observed).replace(/\|/g, '\\|').slice(0, 400)} |`),
    '',
    fatal ? `## Erreur\n\n\`\`\`\n${String(fatal.stack || fatal)}\n\`\`\`\n` : '',
    'Fichiers joints : `report.json`, `requests.jsonl`, `logs.txt`, `responses/*.json`.',
    '',
  ];
  await fsp.writeFile(path.join(OUT_DIR, 'report.md'), lines.join('\n'));
  process.stdout.write(`\nRapport : ${path.join(OUT_DIR, 'report.md')}\n${checks.length - failed.length}/${checks.length} contrôles réussis\n`);
  return failed.length === 0 && !fatal;
}

main()
  .then(() => writeReport(null))
  .catch(async (error) => { process.stderr.write(`${error.stack || error}\n`); return writeReport(error); })
  .then((ok) => { process.exit(ok ? 0 : 1); });
