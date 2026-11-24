// Skeleton de la liste des sagas, comparé aux vraies cartes dans un vrai
// navigateur.
//
// Le skeleton doit prendre exactement la place du contenu (rien ne grandit ni
// ne rétrécit quand les collections arrivent) et s'animer comme celui de
// l'accueil : le reflet de `Skeleton`, jamais `animate-pulse`. Ce banc rend
// `SagaGridSkeleton` et les vraies `SagaCard` dans la même grille, avec le CSS
// Tailwind du dépôt, puis compare chaque case, ses lignes de texte et ses
// boutons.
//
// Exécution : node tests/sagaSkeletons.browser.mjs
//             SAGA_SKELETON_SHOTS=<dossier> pour garder les captures
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

const work = mkdtempSync(path.join(os.tmpdir(), 'movix-saga-skeleton-'));
const shotsDir = process.env.SAGA_SKELETON_SHOTS || null;
if (shotsDir) mkdirSync(shotsDir, { recursive: true });

// ── Page : les vrais composants, sans contexte ni réseau ────────────────────

const sagas = path.join(repo, 'src/components/sagas');
// Les contextes du site (profil, mode léger, routeur, traductions) sont
// remplacés par leur valeur la plus simple : seule la géométrie compte ici.
const stubs = {
  '@/context/LightModeContext': `
    export const useLightMode = () => ({
      isLightMode: false,
      effectivePrefs: { loadingAnimations: true, carouselAutoplay: true },
    });`,
  '@/hooks/useAgeRestrictedContent': `
    export const useAgeRestrictedContent = (content) => ({ items: content ?? [], isFiltering: false });`,
  '@/routing/PrefetchLink': `
    import React from 'react';
    export const PrefetchLink = ({ to, ...rest }) => React.createElement('a', { href: to, ...rest });`,
  'react-i18next': `
    export const useTranslation = () => ({ t: (key) => key, i18n: { language: 'fr' } });`,
};
const stubPlugin = {
  name: 'stubs',
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => (args.path in stubs ? { path: args.path, namespace: 'stub' } : undefined));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
      contents: stubs[args.path],
      loader: 'jsx',
      resolveDir: repo,
    }));
  },
};

const page = `
import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { SagaCard } from ${JSON.stringify(path.join(sagas, 'SagaCard.tsx'))};
import { SagaGridSkeleton, SAGA_GRID_CLASS, SAGA_LIST_CLASS } from ${JSON.stringify(path.join(sagas, 'SagaSkeletons.tsx'))};

// Noms courts : une seule ligne, comme les barres du skeleton.
const SAGAS = Array.from({ length: 9 }, (_, index) => ({
  id: index + 1,
  name: 'Saga ' + (index + 1),
  overview: 'Une collection de films. '.repeat(12),
  poster_path: null,
  backdrop_path: null,
  parts: [],
}));
const noop = () => {};

const root = createRoot(document.getElementById('root'));
const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** Boîte d'un élément, relative à sa case. */
const box = (element, cell) => {
  const a = element.getBoundingClientRect();
  const b = cell.getBoundingClientRect();
  return { x: a.left - b.left, y: a.top - b.top, w: a.width, h: a.height };
};

window.showCase = async ({ mode, compact }) => {
  const list = mode === 'list';
  flushSync(() => root.render(
    <div style={{ padding: '0 24px' }}>
      <div id="skeleton"><SagaGridSkeleton mode={mode} featured={!list} count={list ? 6 : 9} compactActions={compact} /></div>
      <div id="cards" className={list ? SAGA_LIST_CLASS : SAGA_GRID_CLASS}>
        {SAGAS.slice(0, list ? 6 : 9).map((saga, index) => (
          <SagaCard
            key={saga.id}
            saga={saga}
            variant={list ? 'list' : index === 0 ? 'featured' : 'grid'}
            inWatchlist={false}
            isFavorite={false}
            onToggleWatchlist={noop}
            onToggleFavorite={noop}
            onAddToList={noop}
            compactActions={compact}
          />
        ))}
      </div>
    </div>,
  ));
  await frame();
  await frame();
  const skeletonCells = [...document.querySelector('#skeleton > div').children];
  const cardCells = [...document.getElementById('cards').children];
  const shown = (element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
  return {
    cells: cardCells.map((card, index) => {
      const ghost = skeletonCells[index];
      const cardBox = card.getBoundingClientRect();
      const ghostBox = ghost.getBoundingClientRect();
      // Lignes de texte : les vraies (un résumé sur deux lignes compte pour
      // deux), et les emplacements du skeleton, parents de chaque barre.
      const texts = [...card.querySelectorAll('b, a span')]
        .filter((element) => element.textContent && shown(element) && element.children.length === 0)
        .flatMap((element) => {
          const whole = box(element, card);
          const line = parseFloat(getComputedStyle(element).lineHeight);
          const count = Math.max(1, Math.round(whole.h / line));
          return Array.from({ length: count }, (_, index) => ({ ...whole, y: whole.y + index * line, h: line }));
        });
      const slots = [...new Set([...ghost.querySelectorAll('.react-loading-skeleton')]
        .map((bar) => bar.parentElement.parentElement))]
        .filter((element) => element.classList.contains('items-center') && shown(element))
        .map((element) => box(element, ghost));
      // Boutons ronds visibles (opacité > 0 : hors survol, ils sont cachés).
      const visible = (element) => {
        for (let node = element; node && node !== card.parentElement; node = node.parentElement) {
          if (getComputedStyle(node).opacity === '0') return false;
        }
        return shown(element);
      };
      const buttons = [...card.querySelectorAll('button')].filter(visible).map((element) => {
        const inner = element.querySelector('span.rounded-full') ?? element;
        return box(inner, card);
      });
      const circles = [...ghost.querySelectorAll('.rounded-full')].filter(shown).map((element) => box(element, ghost));
      return {
        card: { w: cardBox.width, h: cardBox.height, x: cardBox.left, y: cardBox.top - document.getElementById('cards').getBoundingClientRect().top },
        ghost: { w: ghostBox.width, h: ghostBox.height, x: ghostBox.left, y: ghostBox.top - document.querySelector('#skeleton > div').getBoundingClientRect().top },
        texts,
        slots,
        buttons,
        circles,
      };
    }),
    pulse: document.querySelectorAll('#skeleton .animate-pulse').length,
    shimmer: [...document.querySelectorAll('#skeleton .react-loading-skeleton')]
      .some((element) => getComputedStyle(element, '::after').animationName === 'react-loading-skeleton'),
    fade: getComputedStyle(document.querySelector('#skeleton > div')).animationName,
  };
};
window.ready = true;
`;
writeFileSync(path.join(work, 'page.tsx'), page);

await require('esbuild').build({
  entryPoints: [path.join(work, 'page.tsx')],
  outfile: path.join(work, 'page.js'),
  bundle: true, format: 'esm', target: 'es2022', jsx: 'automatic', logLevel: 'warning',
  nodePaths: [path.join(repo, 'node_modules')],
  alias: { '@': path.join(repo, 'src') },
  plugins: [stubPlugin],
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
});

const tailwindConfig = require('tailwindcss/loadConfig')(path.join(repo, 'tailwind.config.js'));
const compiled = await require('postcss')([
  require('tailwindcss')({
    ...tailwindConfig,
    content: [path.join(sagas, '*.tsx'), path.join(repo, 'src/components/ui/Skeleton.tsx')],
  }),
]).process('@tailwind base; @tailwind utilities;', { from: undefined });
// Le CSS de react-loading-skeleton, importé par `Skeleton`, sort à côté du JS.
const bundledCss = path.join(work, 'page.css');
const css = `${compiled.css}\n${existsSync(bundledCss) ? readFileSync(bundledCss, 'utf8') : ''}`;

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://banc');
  if (url.pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/page.css">'
      + '<body style="margin:0;background:#000;color:#fff"><div id="root"></div><script type="module" src="/page.js"></script>');
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

// ── Navigateur sans fenêtre, piloté par le protocole DevTools ───────────────

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const profile = path.join(work, 'profile');
const browser = spawn(browserPath, [
  '--headless=new', '--mute-audio', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
  '--force-device-scale-factor=1', `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank',
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
  console.log(`${ok ? 'OK ' : 'KO '} ${name} — ${detail}`);
};

/** Écart le plus grand entre deux listes de boîtes, `Infinity` si leur nombre diffère. */
const gap = (a, b) => {
  if (a.length !== b.length) return Infinity;
  return Math.max(0, ...a.flatMap((box, index) => [
    Math.abs(box.y - b[index].y), Math.abs(box.h - b[index].h),
  ]));
};
const gapWithX = (a, b) => {
  if (a.length !== b.length) return Infinity;
  return Math.max(0, ...a.flatMap((box, index) => [
    Math.abs(box.x - b[index].x), Math.abs(box.y - b[index].y), Math.abs(box.w - b[index].w), Math.abs(box.h - b[index].h),
  ]));
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
  await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate('window.ready === true').catch(() => false)) break;
    if (attempt === 99) throw new Error('la page du banc ne démarre pas');
    await sleep(150);
  }

  const SIZES = [['téléphone', 390], ['tablette', 900], ['ordinateur', 1440], ['grand écran', 2000]];
  for (const [label, width] of SIZES) {
    for (const mode of ['grid', 'list']) {
      for (const compact of [true, false]) {
        // Une souris sur un téléphone n'existe pas : « ⋯ » seulement sous `md`.
        if (width < 768 && !compact) continue;
        await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
        const shot = await evaluate(`window.showCase(${JSON.stringify({ mode, compact })})`);
        const name = `${label} ${width} px, ${mode === 'grid' ? 'grille' : 'liste'}, ${compact ? '« ⋯ »' : 'trois boutons'}`;
        if (shotsDir) {
          const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
          writeFileSync(path.join(shotsDir, `${width}-${mode}-${compact ? 'compact' : 'boutons'}.png`), Buffer.from(data, 'base64'));
        }

        const cellGap = Math.max(...shot.cells.flatMap(({ card, ghost }) => [
          Math.abs(card.w - ghost.w), Math.abs(card.h - ghost.h), Math.abs(card.x - ghost.x), Math.abs(card.y - ghost.y),
        ]));
        check(`${name} : cases à la même place`, cellGap <= 0.5,
          `écart max ${cellGap.toFixed(2)} px (0,5 au plus)`);

        const textGap = Math.max(...shot.cells.map(({ texts, slots }) => gap(texts, slots)));
        check(`${name} : lignes de texte à la même hauteur`, textGap <= 0.5,
          Number.isFinite(textGap) ? `écart max ${textGap.toFixed(2)} px` : `nombre de lignes différent (${shot.cells.map(c => `${c.texts.length}/${c.slots.length}`).join(' ')})`);

        const buttonGap = Math.max(...shot.cells.map(({ buttons, circles }) => gapWithX(buttons, circles)));
        check(`${name} : boutons à la même place`, buttonGap <= 0.5,
          Number.isFinite(buttonGap) ? `écart max ${buttonGap.toFixed(2)} px` : `nombre de boutons différent (${shot.cells.map(c => `${c.buttons.length}/${c.circles.length}`).join(' ')})`);

        check(`${name} : animation de l'accueil`, shot.pulse === 0 && shot.shimmer && shot.fade === 'skeletonFade',
          `${shot.pulse} animate-pulse, reflet ${shot.shimmer ? 'présent' : 'absent'}, fondu « ${shot.fade} »`);
      }
    }
  }
} catch (error) {
  console.error(error);
  results.push({ name: 'banc', ok: false });
} finally {
  cleanUp();
}

const failed = results.filter(result => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} contrôles réussis`);
process.exitCode = failed.length ? 1 : 0;
