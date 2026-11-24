// Gabarits de chargement des commentaires, mesurés dans un vrai navigateur.
//
// Un gabarit réussi ne fait rien bouger quand les commentaires arrivent. Ce
// banc rend les vrais composants des deux habillages (`DetailsComments` des
// nouvelles fiches, `CommentsSection` des anciennes) avec le CSS Tailwind du
// dépôt et un faux `axios` qui retient les réponses : il mesure la section en
// attente, libère les réponses, puis compare chaque ligne au pixel près. Pour
// les nouvelles fiches, il compare aussi le gabarit d'avant chargement
// (`DetailsCommentsPlaceholder`) à la section en attente.
//
// Exécution : node tests/commentsSkeleton.browser.mjs
//             COMMENTS_SKELETON_SHOTS=<dossier> pour garder les captures
// Nécessite les dépendances npm, Node 22 ou plus, et Chrome ou Edge (chemin
// dans BROWSER sinon). Le navigateur tourne sans fenêtre et sans son ; aucun
// accès réseau.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.dirname(here);
const require = createRequire(path.join(repo, 'package.json'));

const browserPath = [
  process.env.BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/microsoft-edge',
].find(candidate => candidate && existsSync(candidate));
if (!browserPath) {
  console.error('Chrome ou Edge introuvable : donner son chemin dans la variable BROWSER.');
  process.exit(2);
}

const work = mkdtempSync(path.join(os.tmpdir(), 'movix-comments-skeleton-'));
const shotsDir = process.env.COMMENTS_SKELETON_SHOTS || null;
if (shotsDir) mkdirSync(shotsDir, { recursive: true });

// ── Faux axios : les réponses attendent que le banc les libère ───────────────

const fakeAxios = `
const held = [];
const hold = (data) => new Promise(resolve => held.push(() => resolve({ data })));
const refuse = () => Promise.reject(new Error('hors banc'));
const axios = {
  get(url) {
    if (url.includes('/api/comments/limits')) return hold(window.bench.limits);
    if (url.includes('/api/comments/subscriptions')) return Promise.resolve({ data: { following: false } });
    if (/\\/api\\/comments\\/(movie|tv)\\//.test(url)) return hold(window.bench.comments);
    return refuse();
  },
  post: refuse, put: refuse, delete: refuse, patch: refuse, request: refuse,
  isAxiosError: () => false,
  create: () => axios,
  defaults: { headers: { common: {} } },
  interceptors: { request: { use() {}, eject() {} }, response: { use() {}, eject() {} } },
};
window.releaseResponses = () => held.splice(0).forEach(resolve => resolve());
export const isAxiosError = axios.isAxiosError;
export default axios;
`;
writeFileSync(path.join(work, 'fake-axios.js'), fakeAxios);

// ── Page : les vrais composants ──────────────────────────────────────────────

const src = (file) => JSON.stringify(path.join(repo, 'src', file));
const page = `
import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import ${src('i18n/index.ts')};
import { LightModeProvider } from ${src('context/LightModeContext.tsx')};
import { DetailsComments, DetailsCommentsPlaceholder } from ${src('components/details/comments/index.ts')};
import CommentsSection from ${src('components/CommentsSection.tsx')};

const nextFrames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Commentaires de la longueur des gabarits : une ligne courte par ligne de gabarit. */
const comment = (id, lines, replies) => ({
  id, content_type: 'movie', content_id: '1', user_id: 'u' + id, user_type: 'oauth', profile_id: 'autre-' + id,
  username: ['Camille', 'Noé', 'Alexandra', 'Sacha'][id % 4], avatar: null,
  content: Array.from({ length: lines }, (_, index) => 'Ligne ' + (index + 1)).join('  \\n'),
  is_spoiler: 0, is_vip: 0, is_admin: 0, is_edited: 0, created_at: Date.now() - 3 * 86400000, deleted: 0,
  repliesCount: replies ? 2 : 0, reactions: 3, userReaction: false,
});
const SHAPES = {
  // Mêmes formes que les gabarits de chaque habillage.
  details: [[2, true], [1, false], [3, true], [2, false]],
  legacy: [[2, true], [1, false], [3, true]],
};

let root = null;
const mount = (node) => flushSync(() => root.render(
  <LightModeProvider><MemoryRouter>{node}</MemoryRouter></LightModeProvider>,
));

const box = (element, base) => {
  const a = element.getBoundingClientRect();
  const b = base.getBoundingClientRect();
  return { top: Math.round((a.top - b.top) * 100) / 100, height: Math.round(a.height * 100) / 100 };
};

/** Une ligne de la liste : la ligne entière, sa vignette, puis auteur, texte et actions. */
const measureRow = (row, flex, base) => ({
  ...box(row, base),
  avatar: box(flex.children[0], row),
  parts: [...flex.children[1].children].slice(0, 3).map(part => box(part, row)),
});

const measureDetails = () => {
  const host = document.getElementById('root');
  const header = host.querySelector('h2').parentElement;
  const grid = header.nextElementSibling;
  const [form, list] = grid.children;
  return {
    header: box(header, host),
    form: box(form, grid),
    list: box(list, grid),
    rows: [...list.querySelectorAll('li')].map(row => measureRow(row, row.firstElementChild, list)),
  };
};

const measureLegacy = () => {
  const host = document.getElementById('root');
  const list = host.querySelector('.space-y-4');
  let cards = [...list.children];
  if (cards[0]?.classList.contains('space-y-4')) cards = [...cards[0].children];
  cards = cards.filter(card => card.className.includes('bg-gray-800/70'));
  const form = host.querySelector('.mb-8') ?? host.querySelector('.text-center');
  return {
    form: box(form, host),
    list: box(list, host),
    rows: cards.map(card => measureRow(card, card.querySelector(':scope > .flex'), list)),
  };
};

window.runCase = async ({ skin, signedIn }) => {
  root?.unmount();
  root = createRoot(document.getElementById('root'));
  localStorage.clear();
  if (signedIn) {
    localStorage.setItem('auth_token', 'banc');
    localStorage.setItem('selected_profile_id', 'moi');
  }
  const shapes = SHAPES[skin];
  window.bench = {
    comments: { comments: shapes.map(([lines, replies], index) => comment(index + 1, lines, replies)), hasMore: false, total: shapes.length },
    limits: { movieCount: 0, hourCount: 1, movieLimit: 3, hourLimit: 10, isAdmin: false },
  };
  const result = {};
  if (skin === 'details') {
    mount(<DetailsCommentsPlaceholder title="Commentaires" />);
    await nextFrames();
    result.placeholder = measureDetails();
    mount(<DetailsComments contentType="movie" contentId="1" title="Commentaires" />);
    await nextFrames();
    result.waiting = measureDetails();
    await sleep(400);
    window.releaseResponses();
    await sleep(500);
    result.loaded = measureDetails();
  } else {
    mount(<CommentsSection contentType="movie" contentId="1" />);
    // Les blocs de l'ancien habillage entrent en glissant : attendre qu'ils soient posés.
    await sleep(900);
    result.waiting = measureLegacy();
    window.releaseResponses();
    await sleep(1400);
    result.loaded = measureLegacy();
  }
  return result;
};
window.ready = true;
`;
writeFileSync(path.join(work, 'page.tsx'), page);

await require('esbuild').build({
  entryPoints: [path.join(work, 'page.tsx')],
  outfile: path.join(work, 'page.js'),
  bundle: true, format: 'esm', target: 'es2022', jsx: 'automatic', logLevel: 'error',
  nodePaths: [path.join(repo, 'node_modules')],
  alias: { '@': path.join(repo, 'src'), axios: path.join(work, 'fake-axios.js') },
  // Polices, sons et images des modules voisins : inutiles aux mesures.
  loader: Object.fromEntries(['.woff2', '.woff', '.ttf', '.mp3', '.mp4', '.webm', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif', '.wasm']
    .map(extension => [extension, 'empty'])),
  define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.env': JSON.stringify({ VITE_MAIN_API: 'http://banc.invalid', VITE_SITE_URL: 'https://banc.invalid', MODE: 'production', PROD: true, DEV: false }),
  },
});

// Le CSS du site pour les commentaires : Tailwind avec la configuration du dépôt.
const tailwindConfig = require('tailwindcss/loadConfig')(path.join(repo, 'tailwind.config.js'));
const compiled = await require('postcss')([
  require('tailwindcss')({
    ...tailwindConfig,
    content: [
      path.join(repo, 'src/components/details/**/*.{ts,tsx}'),
      path.join(repo, 'src/components/CommentsSection.tsx'),
      path.join(repo, 'src/components/MarkdownToolbar.tsx'),
      path.join(repo, 'src/components/ui/Skeleton.tsx'),
    ],
  }),
]).process('@tailwind base; @tailwind utilities;', { from: undefined });
const bundledCss = existsSync(path.join(work, 'page.css')) ? readFileSync(path.join(work, 'page.css'), 'utf8') : '';
const css = `${compiled.css}\n${bundledCss}`;

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://banc');
  if (url.pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/page.css">'
      + '<body style="margin:0;padding:16px;background:rgb(var(--movix-black));color:#fff"><div id="root"></div><script type="module" src="/page.js"></script>');
  } else if (url.pathname === '/page.js') {
    response.writeHead(200, { 'content-type': 'text/javascript' });
    response.end(readFileSync(path.join(work, 'page.js')));
  } else if (url.pathname === '/page.css') {
    response.writeHead(200, { 'content-type': 'text/css' });
    response.end(css);
  } else {
    response.writeHead(404).end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

// ── Navigateur, piloté par le protocole DevTools ─────────────────────────────

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const profile = path.join(work, 'profile');
const browser = spawn(browserPath, [
  '--headless=new', '--mute-audio', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
  '--force-device-scale-factor=1', '--lang=fr-FR', `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank',
], { stdio: 'ignore' });

let socket = null;
const cleanUp = () => {
  try { socket?.close(); } catch { /* déjà fermé */ }
  browser.kill();
  server.close();
  server.closeAllConnections();
  setTimeout(() => {
    try { rmSync(work, { recursive: true, force: true }); } catch { /* nettoyé au prochain démarrage du système */ }
  }, 500);
};

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${detail ? ` — ${detail}` : ''}`);
};

/** Écarts de plus d'un demi-pixel entre deux mesures, avec leur chemin. */
const differences = (a, b, where = '') => {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) > 0.5 ? [`${where} ${a} ≠ ${b}`] : [];
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return [`${where} ${a.length} lignes ≠ ${b.length}`];
    return a.flatMap((item, index) => differences(item, b[index], `${where}[${index}]`));
  }
  if (a && b && typeof a === 'object') return Object.keys(a).flatMap(key => differences(a[key], b[key], where ? `${where}.${key}` : key));
  return a === b ? [] : [`${where} ${a} ≠ ${b}`];
};

try {
  let target = null;
  for (let attempt = 0; attempt < 100 && !target; attempt++) {
    await sleep(150);
    try {
      const port = readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim();
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find(entry => entry.type === 'page') ?? null;
    } catch { /* le navigateur démarre */ }
  }
  if (!target) throw new Error('le navigateur ne répond pas sur son port de débogage');

  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(new Error('connexion DevTools refusée')); });
  let nextId = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    // Erreur de la page : la montrer, sinon le banc échoue sans dire pourquoi.
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      console.error('Erreur de la page :', details.exception?.description ?? details.text);
    }
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  // Les gabarits respirent : une page en arrière-plan doit quand même dessiner.
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate('window.ready === true').catch(() => false)) break;
    if (attempt === 99) throw new Error('la page du banc ne démarre pas');
    await sleep(150);
  }

  const shot = async (name) => {
    if (!shotsDir) return;
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(path.join(shotsDir, `${name}.png`), Buffer.from(data, 'base64'));
  };

  for (const width of [375, 1280]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 2200, deviceScaleFactor: 1, mobile: false });
    for (const skin of ['details', 'legacy']) {
      for (const signedIn of [true, false]) {
        const label = `${skin === 'details' ? 'nouvelles fiches' : 'anciennes fiches'}, ${signedIn ? 'connecté' : 'sans compte'}, ${width} px`;
        const run = evaluate(`window.runCase(${JSON.stringify({ skin, signedIn })})`);
        // Capture pendant l'attente, avant que le banc libère les réponses.
        await sleep(skin === 'details' ? 250 : 700);
        await shot(`${skin}-${signedIn ? 'connecte' : 'anonyme'}-${width}-attente`);
        const result = await run;
        await shot(`${skin}-${signedIn ? 'connecte' : 'anonyme'}-${width}-charge`);

        const expected = skin === 'details' ? 4 : 3;
        check(`${label} : ${expected} lignes de gabarit`, result.waiting.rows.length === expected, `${result.waiting.rows.length} trouvées`);
        const shift = differences(result.waiting, result.loaded);
        check(`${label} : rien ne bouge à l'arrivée des commentaires`, shift.length === 0, shift.slice(0, 4).join(' ; '));
        if (result.placeholder) {
          const swap = differences(result.placeholder, result.waiting);
          check(`${label} : gabarit d'avant chargement identique`, swap.length === 0, swap.slice(0, 4).join(' ; '));
        }
      }
    }
  }
} catch (error) {
  console.error(error);
  results.push({ name: 'banc', ok: false });
} finally {
  cleanUp();
}

const failed = results.filter(result => !result.ok).length;
console.log(failed ? `\n${failed} contrôle(s) en échec sur ${results.length}` : `\n${results.length} contrôles réussis`);
process.exitCode = failed ? 1 : 0;
