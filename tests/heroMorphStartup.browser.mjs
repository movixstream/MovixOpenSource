/**
 * Movies-page browser regression for Morph's first transitions on touch.
 * Run: node tests/heroMorphStartup.browser.mjs
 * Requires npm dependencies, Playwright + Chromium. No server/account/network.
 * Optional: CODEX_PRIMARY_RUNTIME_NODE_MODULES, CHROMIUM_EXECUTABLE_PATH,
 * MORPH_REPORT_DIR, MORPH_SCENARIOS (comma-separated scenario names).
 * Reports, screenshots and traces are retained outside the repository.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const runtimeRequire = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ? createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'package.json')) : require;
const { chromium } = runtimeRequire('playwright');
const work = process.env.MORPH_REPORT_DIR || await mkdtemp(path.join(tmpdir(), 'movix-morph-startup-'));
await mkdir(work, { recursive: true });
const source = (name) => JSON.stringify(path.join(repo, 'src', name));
const items = Array.from({ length: 8 }, (_, index) => ({
  id: index + 1, title: `Film ${index + 1}`, poster_path: `/poster-${index + 1}.jpg`,
  backdrop_path: `/backdrop-${index + 1}.jpg`, overview: `Synopsis du film ${index + 1}.`,
  vote_average: 8, release_date: '2024-01-01', genre_ids: [28], media_type: 'movie',
}));
await writeFile(path.join(work, 'entry.tsx'), `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import i18next from 'i18next';
import {I18nextProvider} from 'react-i18next';
import fr from ${source('i18n/locales/fr.json')};
import {LightModeProvider} from ${source('context/LightModeContext')};
import Movies from ${source('pages/Movies')};
await i18next.init({lng:'fr',resources:{fr:{translation:fr}},interpolation:{escapeValue:false}});
createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/movies']}><I18nextProvider i18n={i18next}><LightModeProvider><Movies/></LightModeProvider></I18nextProvider></MemoryRouter>);
`);
await build({
  entryPoints: [path.join(work, 'entry.tsx')], outdir: work, entryNames: 'app',
  bundle: true, splitting: true, format: 'esm', target: 'es2022', jsx: 'automatic',
  nodePaths: [path.join(repo, 'node_modules')], alias: { '@': path.join(repo, 'src') },
  define: { 'import.meta.env': '{}' },
  plugins: [{ name: 'unrelated-contexts', setup(builder) {
    builder.onResolve({ filter: /useAgeRestrictedContent$|PrefetchLink$|\/i18n$|useWrappedTracker$/ }, ({ path: name }) => ({ path: name, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: name }) => ({
      contents: name.endsWith('useAgeRestrictedContent') ? 'export const useAgeRestrictedContent=items=>({items});'
        : name.endsWith('PrefetchLink') ? "export {Link as PrefetchLink} from 'react-router-dom';"
        : name.endsWith('useWrappedTracker') ? 'export const useWrappedTracker=()=>({});'
        : "export const getTmdbLanguage=()=> 'fr-FR';",
      resolveDir: repo,
    }));
  } }],
});
await writeFile(path.join(work, 'base.css'), '@tailwind base;\n@tailwind components;\n@tailwind utilities;');
execFileSync(process.execPath, [path.join(repo, 'node_modules/tailwindcss/lib/cli.js'),
  '-c', path.join(repo, 'tailwind.config.js'), '-i', path.join(work, 'base.css'), '-o', path.join(work, 'ui.css'),
  '--content', 'src/pages/Movies.tsx,src/components/{HeroSlider,EmblaCarousel,EmblaCarouselGenres,TelegramPromotion,LazySection}.tsx,src/components/heroLayout.ts,src/components/hero/*.tsx,src/components/skeletons/*.tsx',
], { cwd: repo, stdio: 'pipe' });
await writeFile(path.join(work, 'index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/ui.css"><link rel="stylesheet" href="/app.css"></head><body style="background:black;color:white;overflow-x:hidden"><div id="root"></div><script type="module" src="/app.js"></script></body></html>');

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
const results = [];
const selected = process.env.MORPH_SCENARIOS?.split(',');

async function scenario(name, options, verify) {
  if (selected && !selected.includes(name)) return;
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  let releaseTextures;
  const textureGate = options.cold ? new Promise((resolve) => { releaseTextures = resolve; }) : Promise.resolve();
  const requests = [];
  const errors = [];
  await context.addInitScript(({ autoplay, noWebgl }) => {
    localStorage.setItem('settings_light_mode', 'off');
    localStorage.setItem('settings_hero_slider_style', 'morph');
    localStorage.setItem('settings_hero_morph_speed', '1');
    localStorage.setItem('settings_anim_carousel', String(Boolean(autoplay)));
    localStorage.setItem('settings_media_colors', JSON.stringify({ heroMode: 'off', cardsMode: 'off' }));
    if (noWebgl) {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
        return kind === 'webgl' || kind === 'webgl2' ? null : getContext.call(this, kind, ...args);
      };
    }
    window.heroSamples = [];
    const sample = () => {
      const visible = [...document.querySelectorAll('[data-hero-content]')].flatMap((content) => {
        const layer = content.closest('[aria-hidden]');
        if (!layer) return [];
        const style = getComputedStyle(layer);
        const opacity = Number(style.opacity);
        return style.visibility === 'visible' && opacity > 0
          ? [{ title: content.querySelector('h1')?.textContent, opacity }] : [];
      });
      if (visible.length && window.heroSamples.length < 5000) window.heroSamples.push({ time: performance.now(), visible });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, options);
  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.hostname === 'morph.test') {
      const file = url.pathname === '/movies' ? 'index.html' : url.pathname.slice(1);
      if (options.noChunk && file.startsWith('MorphBackdrop-')) return route.abort();
      await route.fulfill({ contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html', body: await readFile(path.join(work, file)) });
    } else if (url.hostname === 'image.tmdb.org') {
      const headers = await req.allHeaders();
      const cors = Boolean(headers.origin);
      requests.push({ url: url.href, cors });
      if (options.noCors && cors && url.pathname.includes('/backdrop-')) return route.abort();
      if (url.pathname.includes('/backdrop-') && cors) await textureGate;
      const index = Number(url.pathname.match(/-(\d+)\./)?.[1] || 1);
      const color = ['#c62828', '#1565c0', '#2e7d32', '#ef6c00', '#6a1b9a', '#00695c', '#ad1457', '#4527a0'][(index - 1) % 8];
      await route.fulfill({ contentType: 'image/svg+xml', headers: { 'access-control-allow-origin': '*' },
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="${color}"/><circle cx="${220 + index * 80}" cy="240" r="180" fill="#e6ddc4"/><path d="M0 720L640 280L1280 720" fill="#15171c"/></svg>` });
    } else if (url.hostname === 'api.themoviedb.org') {
      await route.fulfill({ json: url.pathname.endsWith('/images') ? { posters: [], logos: [] } : { results: items, page: 1, total_pages: 1 }, headers: { 'access-control-allow-origin': '*' } });
    } else await route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  const snapshot = (label) => page.screenshot({ path: path.join(work, `${name}-${label}.png`) });
  const dots = () => page.getByRole('button', { name: /^Afficher la diapositive/ });
  const revealTextures = () => releaseTextures?.();
  const resetSamples = () => page.evaluate(() => { window.heroSamples = []; });
  const waitForMix = async (from, to) => {
    await page.waitForFunction(({ from, to }) => window.heroSamples.some(({ visible }) =>
      visible.some(({ title, opacity }) => title === from && opacity > 0.02 && opacity < 0.98)
      && visible.some(({ title, opacity }) => title === to && opacity > 0.02 && opacity < 0.98)), { from, to }, { timeout: 5000 });
    await snapshot(`transition-${from.slice(-1)}-${to.slice(-1)}`);
    await page.waitForFunction((title) => window.heroSamples.at(-1)?.visible.some((layer) => layer.title === title && layer.opacity === 1), to);
  };
  const swipe = async () => {
    const hero = page.locator('[data-hero-slider-style="morph"] .embla__viewport');
    const rect = await hero.boundingBox();
    assert.ok(rect, 'bandeau visible');
    const cdp = await context.newCDPSession(page);
    const y = Math.round(rect.y + 70);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 340, y }] });
    for (const x of [300, 250, 200, 140, 70]) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
      await page.waitForTimeout(25);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  };
  let status = 'passed';
  let error;
  try {
    await page.goto('http://morph.test/movies', { waitUntil: 'domcontentloaded' });
    await dots().first().waitFor();
    await page.waitForFunction(() => window.heroSamples.at(-1)?.visible.some((layer) => layer.title === 'Film 1' && layer.opacity === 1));
    await snapshot('initial');
    await verify({ page, dots, snapshot, revealTextures, resetSamples, waitForMix, swipe });
    assert.deepEqual(errors, [], 'aucune erreur JavaScript');
    await snapshot('final');
  } catch (failure) {
    status = 'failed';
    error = failure.message;
    await snapshot('failed').catch(() => {});
  } finally {
    revealTextures();
    const samples = await page.evaluate(() => window.heroSamples).catch(() => []);
    try {
      await context.tracing.stop({ path: path.join(work, `${name}.trace.zip`) });
    } catch (failure) {
      status = 'failed';
      error = `${error ? `${error}\n` : ''}Échec de sauvegarde de la trace : ${failure.message}`;
    }
    await context.close();
    results.push({ name, status, error, errors, requests, samples });
    console.log(`${name}: ${status}${error ? ` — ${error}` : ''}`);
  }
}

try {
  for (const gesture of ['dots', 'swipe']) {
    await scenario(`cold-${gesture}`, { cold: true }, async ({ page, dots, revealTextures, resetSamples, waitForMix, swipe }) => {
      await resetSamples();
      if (gesture === 'dots') await dots().nth(1).tap();
      else await swipe();
      await page.waitForFunction(() => document.querySelectorAll('button[aria-label^="Afficher la diapositive"]')[1]?.getAttribute('aria-current') === 'true');
      revealTextures();
      await waitForMix('Film 1', 'Film 2');
      for (let index = 2; index <= 3; index++) {
        await resetSamples();
        if (gesture === 'dots') await dots().nth(index).tap();
        else await swipe();
        await waitForMix(`Film ${index}`, `Film ${index + 1}`);
      }
    });
  }
  await scenario('warm-first-three', {}, async ({ page, dots, resetSamples, waitForMix }) => {
    await page.waitForFunction(() => document.querySelector('[data-hero-slider-style="morph"] canvas')?.style.visibility === 'visible');
    for (let index = 1; index <= 3; index++) {
      await resetSamples();
      await dots().nth(index).tap();
      await waitForMix(`Film ${index}`, `Film ${index + 1}`);
    }
  });
  await scenario('cold-latest-selection', { cold: true }, async ({ dots, revealTextures, resetSamples, waitForMix }) => {
    await resetSamples();
    for (const index of [1, 2, 3]) await dots().nth(index).tap();
    revealTextures();
    await waitForMix('Film 1', 'Film 4');
    await resetSamples();
    await dots().first().tap();
    await waitForMix('Film 4', 'Film 1');
  });
  await scenario('autoplay-startup', { cold: true, autoplay: true }, async ({ page, dots, revealTextures, waitForMix }) => {
    await page.waitForTimeout(6500);
    assert.equal(await dots().first().getAttribute('aria-current'), 'true', 'le premier film reste sélectionné pendant la préparation graphique');
    revealTextures();
    await page.waitForFunction(() => document.querySelector('[data-hero-slider-style="morph"] canvas')?.style.visibility === 'visible');
    await page.waitForTimeout(5000);
    await waitForMix('Film 1', 'Film 2');
  });
  for (const [name, failure] of [
    ['unavailable-fallback', { noWebgl: true }],
    ['chunk-fallback', { noChunk: true }],
    ['cors-fallback', { noCors: true }],
  ]) {
    await scenario(name, { ...failure, autoplay: true }, async ({ page, dots }) => {
      await dots().nth(1).tap();
      await page.waitForFunction(() => window.heroSamples.at(-1)?.visible.some((layer) => layer.title === 'Film 2' && layer.opacity === 1));
      await page.waitForFunction(() => [...document.querySelectorAll('[data-hero-slider-style="morph"] img')].some((image) => image.src.includes('/backdrop-2.') && image.naturalWidth > 0 && getComputedStyle(image).visibility === 'visible'));
      await page.waitForFunction(() => document.querySelectorAll('button[aria-label^="Afficher la diapositive"]')[2]?.getAttribute('aria-current') === 'true', null, { timeout: 8500 });
    });
  }
} finally {
  await browser.close();
  await writeFile(path.join(work, 'results.json'), JSON.stringify(results, null, 2));
  await writeFile(path.join(work, 'REPORT.md'), `# Démarrage du Morph sur la page Films

Commande : \`node tests/heroMorphStartup.browser.mjs\`

Prérequis : dépendances npm, Playwright et Chromium ; CODEX_PRIMARY_RUNTIME_NODE_MODULES et CHROMIUM_EXECUTABLE_PATH permettent de désigner une installation existante. MORPH_REPORT_DIR conserve les artefacts au chemin choisi ; MORPH_SCENARIOS filtre les scénarios.

Environnement observé : Node ${process.version}, Chromium ${browser.version()}, ${process.platform}. Filtre : ${selected?.join(',') || 'tous les scénarios'}.

La vraie page Movies, HeroSlider, MorphBackdrop, MorphContent, Embla et les styles du projet sont montés. Les réponses TMDB utilisent huit films déterministes et des images SVG. Les restrictions d’âge, le préchargement des routes, la langue API et la télémétrie sont remplacés. Aucun serveur, compte ou accès réseau externe.

Viewport tactile 412 × 915, DPR 3. Les scénarios à froid retiennent les réponses CORS des backdrops jusqu’après la première interaction. Attendu : les deux contenus ont des opacités intermédiaires pendant chacune des trois premières transitions, au toucher et par swipe ; une sélection rapide de 2, 3 puis 4 morph du premier au quatrième film ; l’autoplay attend la disponibilité du moteur. Le repli doit afficher l’image sélectionnée et conserver l’autoplay si WebGL, le module ou le chargement CORS est indisponible.

Les captures montrent les états initial, intermédiaires et final ; les traces et [results.json](results.json) contiennent les observations de rendu et requêtes. Pour ouvrir une trace : \`npx playwright show-trace <scénario>.trace.zip\`.

Limites : Chromium de bureau en émulation mobile, sans service worker ; ce scénario ne mesure pas le GPU physique du S26 Ultra ni le réseau de production.

Résultats : ${results.filter((result) => result.status === 'passed').length}/${results.length}.

${results.map((result) => `- ${result.name} : ${result.status}${result.error ? ` — ${result.error}` : ''} — [trace](${result.name}.trace.zip)`).join('\n')}
`);
}
console.log(JSON.stringify({ artifact: work, passed: results.filter((result) => result.status === 'passed').length, total: results.length }));
if (results.some((result) => result.status === 'failed')) process.exitCode = 1;
