/**
 * Real React/Embla regression test for Hero logo metadata sharing.
 * No development server or production API is used.
 * Run: node tests/heroImages.browser.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const runtimeRequire = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ? createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'package.json'))
  : require;
const { chromium } = runtimeRequire('playwright');
const work = await mkdtemp(path.join(tmpdir(), 'movix-hero-images-'));

const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import HeroSlider from ${JSON.stringify(repo + '/src/components/HeroSlider')};
import {useTmdbImages} from ${JSON.stringify(repo + '/src/hooks/useTmdbImages')};

const items = [
  {id:42,title:'Film actif',poster_path:'/poster-active.svg',backdrop_path:'/backdrop-active.svg',overview:'Actif',vote_average:8,release_date:'2025-01-01',media_type:'movie'},
  {id:42,name:'Série homonyme',poster_path:'/poster-tv.svg',backdrop_path:'/backdrop-tv.svg',overview:'TV',vote_average:7,first_air_date:'2024-01-01',media_type:'tv'},
  {id:77,title:'Film lent',poster_path:'/poster-slow.svg',backdrop_path:'/backdrop-slow.svg',overview:'Lent',vote_average:6,release_date:'2023-01-01',media_type:'movie'},
];

function DuplicateCardConsumer() {
  const images = useTmdbImages('movie', 42);
  return <output id="duplicate-card">{JSON.stringify(images)}</output>;
}

function App() {
  return <><HeroSlider items={items}/><DuplicateCardConsumer/></>;
}

createRoot(document.getElementById('root')).render(<App/>);
`;

await writeFile(path.join(work, 'entry.tsx'), fixture);
await build({
  entryPoints: [path.join(work, 'entry.tsx')],
  outfile: path.join(work, 'app.js'),
  bundle: true,
  format: 'esm',
  target: 'es2020',
  jsx: 'automatic',
  nodePaths: [path.join(repo, 'node_modules')],
  alias: { '@': path.join(repo, 'src') },
  define: { 'import.meta.env': '{}' },
  plugins: [{
    name: 'hero-fixture',
    setup(builder) {
      builder.onResolve({
        filter: /useAgeRestrictedContent$|useHeroVisibility$|LightModeContext$|PrefetchLink$|shiny-text$|^\.\.\/i18n$|^react-i18next$/,
      }, ({ path: name }) => ({ path: name, namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: name }) => ({
        contents: name.endsWith('useAgeRestrictedContent')
          ? 'export const useAgeRestrictedContent=items=>({items});'
          : name.endsWith('useHeroVisibility')
            ? 'export const useHeroHidden=()=>false;'
            : name.endsWith('LightModeContext')
              ? "export const useLightMode=()=>({effectivePrefs:{transitions:false,carouselAutoplay:false,bgAnimations:false}});"
              : name.endsWith('PrefetchLink')
                ? "export const PrefetchLink=({children,...props})=><a {...props}>{children}</a>;"
                : name.endsWith('shiny-text')
                  ? 'export default ({text})=><span>{text}</span>;'
                  : name === 'react-i18next'
                    ? 'export const useTranslation=()=>({t:key=>key});'
                    : "export const getTmdbLanguage=()=> 'fr-FR';",
        loader: 'tsx',
        resolveDir: repo,
      }));
    },
  }],
});
await writeFile(
  path.join(work, 'index.html'),
  '<!doctype html><html><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>',
);

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: JSON.parse(process.env.CHROMIUM_ARGS || '[]'),
});
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const metadataRequests = [];
let releaseSlow;
const slowResponse = new Promise(resolve => { releaseSlow = resolve; });
let slowResolved = false;

await context.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.hostname === 'hero.test') {
    const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    await route.fulfill({
      contentType: name.endsWith('.js') ? 'text/javascript' : 'text/html',
      body: await readFile(path.join(work, name)),
    });
    return;
  }

  if (url.pathname.endsWith('/images')) {
    const match = url.pathname.match(/\/(movie|tv)\/(\d+)\/images$/);
    assert.ok(match, `route TMDB inattendue: ${url.pathname}`);
    const [, mediaType, id] = match;
    metadataRequests.push({ mediaType, id: Number(id), language: url.searchParams.get('include_image_language') });
    if (id === '77') {
      await slowResponse;
      slowResolved = true;
    } else {
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    await route.fulfill({
      headers: { 'access-control-allow-origin': '*' },
      json: {
        logos: [{ file_path: `/logo-${mediaType}-${id}.svg`, iso_639_1: 'fr' }],
        posters: [],
      },
    });
    return;
  }

  await route.fulfill({
    contentType: 'image/svg+xml',
    headers: { 'access-control-allow-origin': '*' },
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="200"><rect width="500" height="200" fill="red"/></svg>',
  });
});

const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));

try {
  await page.goto('http://hero.test/');
  await page.waitForFunction(() => document.querySelector('img[alt="Film actif"][src*="/w500/logo-movie-42.svg"]'));

  assert.equal(slowResolved, false, 'le logo actif a attendu la réponse lente d’une autre slide');
  await page.waitForFunction(() => document.querySelector('#duplicate-card')?.textContent?.includes('logo-movie-42.svg'));
  await page.waitForFunction(() => window.performance.now() > 0 && document.querySelectorAll('.embla__slide').length === 3);

  const movie42 = metadataRequests.filter(request => request.mediaType === 'movie' && request.id === 42);
  const tv42 = metadataRequests.filter(request => request.mediaType === 'tv' && request.id === 42);
  assert.equal(movie42.length, 1, 'Hero et carte n’ont pas joint la même requête movie/42');
  assert.equal(tv42.length, 1, 'movie/42 et tv/42 ont été confondus');
  assert.equal(movie42[0].language, 'fr,en,null', 'la priorité de langue partagée n’est pas respectée');
  assert.ok(metadataRequests.some(request => request.mediaType === 'movie' && request.id === 77), 'la slide lente n’a pas été préchauffée');
  assert.deepEqual(errors, []);

  console.log('✓ logo actif publié sans attendre les autres slides');
  console.log('✓ requête Hero/carte dédupliquée, clés movie/tv et langue préservées');
  console.log('✓ taille du logo Hero conservée en w500 et toutes les slides préchauffées');
} finally {
  releaseSlow();
  await context.close();
  await browser.close();
  await rm(work, { recursive: true, force: true });
}
