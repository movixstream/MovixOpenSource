/**
 * Vérifie les URLs TMDB réellement rendues par MovieDetails et TVDetails.
 *
 * Prérequis : Playwright/Chromium via le runtime Codex ou les dépendances du dépôt.
 * Relance :
 *   $env:CODEX_PRIMARY_RUNTIME_NODE_MODULES='<runtime-node_modules>'
 *   $env:DETAIL_IMAGE_QUALITY_ARTIFACT_DIR='<dossier hors dépôt>'
 *   node tests/detailImageQuality.browser.mjs
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const runtimeRequire = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ? createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'package.json'))
  : require;
const { chromium } = runtimeRequire('playwright');
const execFileAsync = promisify(execFile);
const artifactDir = process.env.DETAIL_IMAGE_QUALITY_ARTIFACT_DIR
  ? path.resolve(process.env.DETAIL_IMAGE_QUALITY_ARTIFACT_DIR)
  : await mkdtemp(path.join(tmpdir(), 'movix-detail-image-quality-artifacts-'));
const work = path.join(artifactDir, 'fixture');
await mkdir(artifactDir, { recursive: true });
await mkdir(work, { recursive: true });

const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import MovieDetails from ${JSON.stringify(repo + '/src/pages/MovieDetails')};
import TVDetails from ${JSON.stringify(repo + '/src/pages/TVDetails')};

const initialPath = new URLSearchParams(location.search).get('path') || '/movie/42';
createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={[initialPath]}>
    <Routes>
      <Route path="/movie/:id" element={<MovieDetails/>}/>
      <Route path="/tv/:id" element={<TVDetails/>}/>
    </Routes>
  </MemoryRouter>
);
`;

const stubSources = {
  PrefetchLink: `export const PrefetchLink=({to,children,...props})=><a href={typeof to==='string'?to:'#'} {...props}>{children}</a>;`,
  AdFreePopupContext: `export const useAdFreePopup=()=>({resetVipStatus:()=>{}});`,
  ProfileContext: `export const useProfile=()=>({currentProfile:null});`,
  LightModeContext: `export const useLightMode=()=>({isLightMode:false,effectivePrefs:{transitions:false,carouselAutoplay:false,bgAnimations:false}});`,
  reactI18next: `export const useTranslation=()=>({t:(key)=>key,i18n:{language:'fr-FR'}});`,
  i18n: `export const getTmdbLanguage=()=> 'fr-FR'; export default {language:'fr-FR'};`,
  AddToListButton: `export default ()=>null;`,
  AddToListMenu: `export default ()=>null;`,
  DetailsSkeleton: `export default ()=> <div data-testid="details-skeleton"/>;`,
  ShareButtons: `export default ()=>null;`,
  EmblaCarousel: `export default ()=>null;`,
  CommentsSection: `export default ()=>null;`,
  LikeDislikeButton: `export const calculateLikeDislikeRating=()=>null; export default ()=>null;`,
  MovixRatingInfoModal: `export default ()=>null;`,
  LazySection: `export default ({children})=><>{children}</>;`,
  SEO: `export default ()=>null;`,
  CharactersSection: `export default ()=>null;`,
  DetailExtraMetadata: `export default ()=>null;`,
  AlertButton: `export default ()=>null;`,
  AntiSpoilerSettings: `export default ()=>null;`,
  CustomDropdown: `export default ()=>null;`,
  useWrappedTracker: `export const useWrappedTracker=()=>{};`,
  useMovieReleaseWarnings: `export const useMovieReleaseWarnings=()=>false;`,
  useAntiSpoilerSettings: `export const useAntiSpoilerSettings=()=>({settings:{},updateSettings:()=>{},shouldHide:()=>false,getMaskedContent:(value)=>value,hasActiveSpoilerProtection:false});`,
  useTvAiringSchedule: `export const useTvAiringSchedule=()=>({schedule:null,now:Date.now()});`,
  detailCharacters: `export const loadDetailCharacters=async()=>({source:'tmdb',total:0,groups:[],themes:[]});`,
  dialog: `export const Dialog=({children})=><>{children}</>; export const DialogContent=({children})=><div>{children}</div>; export const DialogDescription=({children})=><p>{children}</p>; export const DialogTitle=({children})=><h2>{children}</h2>;`,
};

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
  define: {
    'import.meta.env': JSON.stringify({
      VITE_MAIN_API: 'https://main-api.test',
      VITE_TMDB_API_KEY: 'fixture-key',
      VITE_SITE_URL: 'https://movix.test',
    }),
  },
  plugins: [{
    name: 'detail-image-quality-fixture',
    setup(builder) {
      builder.onResolve({
        filter: /PrefetchLink$|AdFreePopupContext$|ProfileContext$|LightModeContext$|^react-i18next$|(?:^|\/)i18n$|AddToListButton$|AddToListMenu$|DetailsSkeleton$|ShareButtons$|EmblaCarousel$|CommentsSection$|LikeDislikeButton$|MovixRatingInfoModal$|LazySection$|(?:^|\/)SEO$|CharactersSection$|DetailExtraMetadata$|AlertButton$|AntiSpoilerSettings$|CustomDropdown$|useWrappedTracker$|useMovieReleaseWarnings$|useAntiSpoilerSettings$|useTvAiringSchedule$|detailCharacters$|components\/ui\/dialog$/,
      }, ({ path: name }) => {
        const key = name === 'react-i18next' ? 'reactI18next'
          : /components\/ui\/dialog$/.test(name) ? 'dialog'
          : /(?:^|\/)i18n$/.test(name) ? 'i18n'
          : Object.keys(stubSources)
            .sort((left, right) => right.length - left.length)
            .find(candidate => name.endsWith(candidate));
        return { path: key, namespace: 'fixture' };
      });
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: key }) => ({
        contents: stubSources[key],
        loader: 'tsx',
        resolveDir: repo,
      }));
    },
  }],
});
await execFileAsync(process.execPath, [
  require.resolve('tailwindcss/lib/cli/index.js'),
  '--config', path.join(repo, 'tailwind.config.js'),
  '--input', path.join(repo, 'src/index.css'),
  '--output', path.join(work, 'app.css'),
]);
await writeFile(
  path.join(work, 'index.html'),
  '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>',
);

const image = (width, height, fill) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${fill}"/></svg>`;
const movie = {
  id: 42,
  title: 'Dune 2 Fixture',
  original_title: 'Dune: Part Two',
  overview: 'Fixture qualité image.',
  poster_path: '/movie-poster.jpg',
  backdrop_path: '/movie-backdrop.jpg',
  release_date: '2024-03-01',
  vote_average: 8.5,
  genres: [{ id: 878, name: 'Science-fiction' }],
  runtime: 166,
  original_language: 'en',
  status: 'Released',
  production_companies: [{ id: 1, name: 'Legendary Fixture', logo_path: '/company-logo.jpg' }],
  production_countries: [],
  spoken_languages: [],
  keywords: { keywords: [] },
  alternative_titles: { titles: [] },
};
const tv = {
  id: 84,
  name: 'Dune Prophecy Fixture',
  original_name: 'Dune Prophecy',
  overview: 'Fixture qualité image.',
  poster_path: '/tv-poster.jpg',
  backdrop_path: '/tv-backdrop.jpg',
  first_air_date: '2024-11-17',
  vote_average: 7.5,
  genres: [{ id: 18, name: 'Drame' }],
  number_of_seasons: 1,
  number_of_episodes: 1,
  seasons: [{ season_number: 1, name: 'Saison 1 Fixture', poster_path: '/season-poster.jpg', air_date: '2024-11-17', episode_count: 1 }],
  status: 'Returning Series',
  type: 'Scripted',
  original_language: 'en',
  external_ids: {},
  networks: [{ id: 2, name: 'HBO Fixture', logo_path: '/network-logo.jpg' }],
  production_companies: [{ id: 1, name: 'Legendary Fixture', logo_path: '/company-logo.jpg' }],
  credits: {
    cast: [{ id: 1, name: 'Acteur Fixture', character: 'Personnage', profile_path: '/profile.jpg' }],
    crew: [{ id: 2, name: 'Équipe Fixture', job: 'Director', profile_path: '/profile.jpg' }],
  },
  keywords: { results: [] },
  alternative_titles: { results: [] },
};
const movieImages = {
  backdrops: [{ file_path: '/movie-backdrop.jpg', width: 3840, height: 2160, aspect_ratio: 16 / 9, iso_639_1: null, vote_average: 8, vote_count: 1 }],
  posters: [{ file_path: '/movie-gallery-poster.jpg', width: 2000, height: 3000, aspect_ratio: 2 / 3, iso_639_1: 'fr', vote_average: 8, vote_count: 1 }],
  logos: [{ file_path: '/movie-logo.jpg', width: 1600, height: 500, aspect_ratio: 3.2, iso_639_1: 'fr', vote_average: 8, vote_count: 1 }],
};
const tvImages = {
  backdrops: [{ file_path: '/tv-backdrop.jpg', width: 3840, height: 2160, aspect_ratio: 16 / 9, iso_639_1: null, vote_average: 8, vote_count: 1 }],
  posters: [{ file_path: '/tv-gallery-poster.jpg', width: 2000, height: 3000, aspect_ratio: 2 / 3, iso_639_1: 'fr', vote_average: 8, vote_count: 1 }],
  logos: [{ file_path: '/tv-logo.jpg', width: 1600, height: 500, aspect_ratio: 3.2, iso_639_1: 'fr', vote_average: 8, vote_count: 1 }],
};

function jsonFor(url) {
  const pathname = url.pathname;
  if (url.hostname === 'main-api.test') return {};
  if (/\/movie\/42\/credits$/.test(pathname)) return { cast: movie.credits?.cast ?? [], crew: [] };
  if (/\/movie\/42\/release_dates$/.test(pathname)) return { results: [] };
  if (/\/movie\/42\/images$/.test(pathname)) return movieImages;
  if (/\/movie\/42\/videos$/.test(pathname)) return { results: [] };
  if (/\/movie\/42\/recommendations$/.test(pathname)) return { results: [] };
  if (/\/movie\/42$/.test(pathname)) return movie;
  if (/\/tv\/84\/content_ratings$/.test(pathname)) return { results: [] };
  if (/\/tv\/84\/images$/.test(pathname)) return tvImages;
  if (/\/tv\/84\/videos$/.test(pathname)) return { results: [] };
  if (/\/tv\/84\/recommendations$/.test(pathname)) return { results: [] };
  if (/\/tv\/84\/season\/(\d+)\/videos$/.test(pathname)) return { results: [] };
  const season = pathname.match(/\/tv\/84\/season\/(\d+)$/)?.[1];
  if (season !== undefined) return {
    id: Number(season),
    season_number: Number(season),
    name: season === '1' ? 'Saison 1 Fixture' : 'Spéciaux Fixture',
    poster_path: season === '1' ? '/season-poster.jpg' : '/specials-poster.jpg',
    air_date: '2024-11-17',
    episode_count: season === '1' ? 1 : 0,
    episodes: season === '1' ? [{ episode_number: 1, season_number: 1, name: 'Épisode Fixture', overview: '', still_path: '/episode-still.jpg', air_date: '2024-11-17' }] : [],
  };
  if (/\/tv\/84$/.test(pathname)) return tv;
  return {};
}

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: JSON.parse(process.env.CHROMIUM_ARGS || '[]'),
});
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 3 });
await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
const imageRequests = [];
async function fulfillFixtureRoute(route) {
  const url = new URL(route.request().url());
  if (url.hostname === 'details.test') {
    const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    await route.fulfill({
      contentType: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html',
      body: await readFile(path.join(work, name)),
    });
    return;
  }
  if (url.hostname === 'image.tmdb.org') {
    imageRequests.push(url.href);
    const isPoster = /poster|profile/.test(url.pathname);
    await route.fulfill({
      contentType: 'image/svg+xml',
      headers: { 'access-control-allow-origin': '*' },
      body: image(isPoster ? 500 : 1280, isPoster ? 750 : 720, isPoster ? '#a0522d' : '#315d7d'),
    });
    return;
  }
  if (url.hostname === 'api.themoviedb.org' || url.hostname === 'main-api.test') {
    await route.fulfill({
      headers: { 'access-control-allow-origin': '*' },
      json: jsonFor(url),
    });
    return;
  }
  await route.fulfill({
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: '{}',
  });
}
await context.route('**/*', fulfillFixtureRoute);

const expected = {
  economy: { poster: '/w500/', backdrop: '/w780/' },
  auto: { poster: '/w780/', backdrop: '/w1280/' },
  high: { poster: '/original/', backdrop: '/original/' },
};
const observations = [];
const expectationFailures = [];

function expectIncludes(actual, expectedPart, label) {
  if (!actual?.includes(expectedPart)) expectationFailures.push(`${label}: attendu ${expectedPart}, observé ${actual}`);
}

async function openDetails(kind, mode) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(quality => localStorage.setItem('settings_image_quality', quality), mode);
  const routePath = kind === 'movie' ? '/movie/42' : '/tv/84';
  await page.goto(`http://details.test/?path=${encodeURIComponent(routePath)}`);
  const title = kind === 'movie' ? movie.title : tv.name;
  const posterPath = kind === 'movie' ? movie.poster_path : tv.poster_path;
  const poster = page.locator(`img[alt=${JSON.stringify(title)}]`).first();
  await poster.waitFor();
  await page.waitForFunction(selector => {
    const node = document.querySelector(selector);
    return node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0;
  }, `img[alt=${JSON.stringify(title)}]`);
  const posterUrl = await poster.getAttribute('src');
  const posterCssWidth = await poster.evaluate(node => node.getBoundingClientRect().width);
  const backdropStyle = await page.locator('div.fixed.inset-0[aria-hidden="true"]').first().getAttribute('style');
  assert.ok(posterUrl?.includes(expected[mode].poster), `${kind}/${mode}: poster ${posterUrl}`);
  assert.ok(posterUrl?.endsWith(posterPath), `${kind}/${mode}: chemin poster`);
  assert.ok(backdropStyle?.includes(expected[mode].backdrop), `${kind}/${mode}: fond ${backdropStyle}`);

  const row = { kind, mode, posterUrl, posterCssWidth, backdropStyle, errors };
  if (kind === 'movie') {
    const imageTab = page.getByRole('button', { name: 'details.imagesTab' }).first();
    await imageTab.click();
    await page.getByRole('tab', { name: /details\.posters/ }).click();
    const galleryPoster = page.locator('img[alt="posters 1"]').first();
    await galleryPoster.waitFor();
    await galleryPoster.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector('img[alt="posters 1"]')?.getAttribute('srcset'));
    row.galleryPoster = await galleryPoster.evaluate(node => ({
      src: node.getAttribute('src'),
      srcset: node.getAttribute('srcset'),
      sizes: node.getAttribute('sizes'),
      currentSrc: node.currentSrc,
    }));
  } else {
    const seasonPoster = page.locator('img[alt="Saison 1 Fixture"]').first();
    await seasonPoster.waitFor();
    row.seasonPosterUrl = await seasonPoster.getAttribute('src');
    row.seasonPosterCssWidth = await seasonPoster.evaluate(node => node.getBoundingClientRect().width);
    const expectedSeason = mode === 'high' ? '/w500/' : '/w342/';
    expectIncludes(row.seasonPosterUrl, expectedSeason, `tv/${mode}: poster de saison dimensionné sur le conteneur réel`);
  }

  const imageTabForLogo = page.getByRole('button', { name: 'details.imagesTab' }).first();
  if (kind === 'tv') await imageTabForLogo.click();
  await page.getByRole('tab', { name: /details\.logos/ }).click();
  const galleryLogo = page.locator('img[alt="logos 1"]').first();
  await galleryLogo.waitFor();
  await galleryLogo.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('img[alt="logos 1"]')?.complete);
  row.galleryLogo = await galleryLogo.evaluate(node => ({
    src: node.getAttribute('src'),
    cssWidth: node.getBoundingClientRect().width,
  }));
  const expectedLogo = mode === 'high' ? '/w500/' : '/w300/';
  expectIncludes(row.galleryLogo.src, expectedLogo, `${kind}/${mode}: logo galerie dimensionné sur son contenu réel`);
  assert.deepEqual(errors, [], `${kind}/${mode}: erreurs navigateur`);
  await page.screenshot({ path: path.join(artifactDir, `${kind}-${mode}.png`), fullPage: true });
  observations.push(row);
  await page.close();
}

async function observeTabletEpisode() {
  const tabletContext = await browser.newContext({ viewport: { width: 768, height: 800 }, deviceScaleFactor: 2 });
  await tabletContext.route('**/*', fulfillFixtureRoute);
  const page = await tabletContext.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('settings_image_quality', 'auto'));
  await page.goto('http://details.test/?path=%2Ftv%2F84');
  const seasonPoster = page.locator('img[alt="Saison 1 Fixture"]').first();
  await seasonPoster.waitFor();
  await seasonPoster.evaluate(node => node.closest('.cursor-pointer')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  const episodeImage = page.locator('img[alt="Épisode Fixture"]').first();
  await episodeImage.waitFor();
  await episodeImage.scrollIntoViewIfNeeded();
  const observation = await episodeImage.evaluate(node => ({
    src: node.getAttribute('src'),
    cssWidth: node.getBoundingClientRect().width,
  }));
  expectIncludes(observation.src, '/w300/', 'tv/auto tablette DPR2 : image épisode dimensionnée sur le conteneur réel');
  assert.deepEqual(errors, [], 'tv/auto tablette : erreurs navigateur');
  await page.screenshot({ path: path.join(artifactDir, 'tv-auto-tablet-episode.png'), fullPage: true });
  await tabletContext.close();
  return observation;
}

let tabletEpisode = null;
let runError = null;
let reportWritten = false;

async function writeAuditReport(status) {
  const variant = value => value?.match(/\/t\/p\/([^/]+)/)?.[1] || 'non observé';
  const summarizeDetails = kind => observations
    .filter(item => item.kind === kind)
    .map(item => {
      const geometry = kind === 'movie'
        ? `logo ${variant(item.galleryLogo?.src)} à ${item.galleryLogo?.cssWidth?.toFixed(2) ?? '?'} px CSS`
        : `logo ${variant(item.galleryLogo?.src)} à ${item.galleryLogo?.cssWidth?.toFixed(2) ?? '?'} px CSS, saison ${variant(item.seasonPosterUrl)} à ${item.seasonPosterCssWidth?.toFixed(2) ?? '?'} px CSS`;
      return `${item.mode}: poster ${variant(item.posterUrl)}, fond ${variant(item.backdropStyle)}, ${geometry}`;
    })
    .join(' ; ');
  const report = {
    status,
    runError,
    command: 'node tests/detailImageQuality.browser.mjs',
    prerequisites: {
      runtime: process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || 'node_modules du dépôt',
      browser: 'Chromium Playwright',
      viewport: '1280x800 DPR3, plus épisode 768x800 DPR2',
      stylesheet: 'Tailwind compilé depuis src/index.css et tailwind.config.js',
      server: 'aucun',
    },
    fixtureData: {
      movie: { id: movie.id, title: movie.title, poster: movie.poster_path, backdrop: movie.backdrop_path },
      tv: { id: tv.id, title: tv.name, poster: tv.poster_path, backdrop: tv.backdrop_path, seasonPoster: '/season-poster.jpg' },
    },
    expected: {
      primaryPoster: expected,
      galleryPoster: 'economy réduit le srcset; auto et high restent identiques',
      galleryLogo: { economy: 'w300', auto: 'w300', high: 'w500' },
      tvSeasonPoster: { economy: 'w342', auto: 'w342', high: 'w500' },
      tvEpisodeTabletAutoDpr2: 'w300',
    },
    observed: observations,
    tabletEpisode,
    expectationFailures,
    imageRequests,
  };
  await writeFile(path.join(artifactDir, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile(path.join(artifactDir, 'report.md'), [
    '# Vérification E2E — qualité des images des fiches',
    '',
    `- État : ${status}.`,
    `- Commande : \`${report.command}\``,
    '- Prérequis : Chromium Playwright, runtime indiqué dans `report.json`.',
    '- Données : fiches TMDB simulées Dune, réponses réseau interceptées, aucun serveur.',
    '- Rendu : vraies pages et vraie policy image ; `LightModeContext` et composants sans rapport sont stubés.',
    '- CSS : feuille Tailwind du projet compilée pour mesurer les conteneurs réels.',
    '- Attendu principal : poster/fond economy = w500/w780, auto = w780/w1280, high = original/original sur DPR 3.',
    '- Normal : le poster de galerie expose le même `srcset` en auto et high, car le plafond de carte est suffisant.',
    `- Observé Movie à 1280 px/DPR 3 : ${summarizeDetails('movie') || 'non observé'}.`,
    `- Observé TV à 1280 px/DPR 3 : ${summarizeDetails('tv') || 'non observé'}.`,
    `- Observé épisode TV à 768 px/DPR 2 : ${variant(tabletEpisode?.src)} à ${tabletEpisode?.cssWidth?.toFixed(2) ?? '?'} px CSS.`,
    `- Vérifications de dimension réelle : ${expectationFailures.length ? expectationFailures.join(' ; ') : 'logos de galerie, saisons et épisode tablette utilisent la taille attendue.'}`,
    runError ? `- Erreur d’exécution : ${runError}` : '- Erreur d’exécution : aucune.',
    '',
    'Les captures, le bundle autonome dans `fixture/` et `trace.zip` accompagnent ce rapport.',
  ].join('\n'));
  reportWritten = true;
}

try {
  for (const kind of ['movie', 'tv']) {
    for (const mode of ['economy', 'auto', 'high']) await openDetails(kind, mode);
  }

  const movieModes = Object.fromEntries(observations.filter(item => item.kind === 'movie').map(item => [item.mode, item]));
  assert.notEqual(movieModes.economy.galleryPoster.srcset, movieModes.auto.galleryPoster.srcset, 'economy réduit le srcset poster galerie');
  assert.equal(movieModes.auto.galleryPoster.srcset, movieModes.high.galleryPoster.srcset, 'high et auto exposent le même srcset poster galerie');
  assert.equal(movieModes.auto.galleryPoster.sizes, movieModes.high.galleryPoster.sizes);
  tabletEpisode = await observeTabletEpisode();
  const prematureSlotRequest = imageRequests.find(url => /\/w(?:45|92)\/(?:movie-logo|tv-logo|season-poster|episode-still)\.jpg$/.test(url));
  if (prematureSlotRequest) expectationFailures.push(`requête lancée avant mesure du conteneur : ${prematureSlotRequest}`);
  await writeAuditReport('terminé');
  console.log(JSON.stringify({ passed: observations.length + 1, artifactDir, expectationFailures, observations, tabletEpisode }, null, 2));
  assert.deepEqual(expectationFailures, [], 'les images doivent suivre la largeur CSS réelle de leur conteneur');
} catch (error) {
  runError = error instanceof Error ? error.stack || error.message : String(error);
  await writeAuditReport('échec');
  throw error;
} finally {
  if (!reportWritten) await writeAuditReport('interrompu');
  await context.tracing.stop({ path: path.join(artifactDir, 'trace.zip') });
  await context.close();
  await browser.close();
}
