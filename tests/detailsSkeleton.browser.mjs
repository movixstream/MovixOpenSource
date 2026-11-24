// Squelette des fiches film et série, comparé à la vraie page dans un vrai
// navigateur.
//
// Le squelette (`DetailsSkeleton`) recopie les classes de la page : quand l'une
// change sans l'autre, tout saute à l'arrivée des données. Ce banc rend les
// vraies briques de la fiche (`DetailsHero`, `DetailsSectionNav`,
// `DetailsFacts`, `DetailsPeopleRow`, `TvSeasonPills`, `TvEpisodeList`…) avec
// des données types, puis le squelette, à plusieurs largeurs, et compare la
// position et la taille de chaque libellé connu d'avance (boutons, onglets,
// titres, faits), de la fin de l'image, des portraits et des vignettes.
//
// Exécution : node tests/detailsSkeleton.browser.mjs
//             DETAILS_SKELETON_SHOTS=<dossier> pour garder les captures (page,
//             squelette, et les deux superposés)
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

const work = mkdtempSync(path.join(os.tmpdir(), 'movix-details-skeleton-'));
const shotsDir = process.env.DETAILS_SKELETON_SHOTS || null;
if (shotsDir) mkdirSync(shotsDir, { recursive: true });

const src = (file) => path.join(repo, 'src', file);

// ── Page : la vraie fiche avec des données types, ou le squelette ────────────

const page = `
import React, { useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { Bookmark, Check, Download, EyeOff, Heart, ListPlus, Play, Share, Star, Video } from 'lucide-react';
import i18n from ${JSON.stringify(src('i18n/index.ts'))};
import { LightModeProvider } from ${JSON.stringify(src('context/LightModeContext.tsx'))};
import Counter from ${JSON.stringify(src('components/ui/counter.tsx'))};
import { DETAILS_GRID } from ${JSON.stringify(src('components/details/layout.ts'))};
import { DetailsHero } from ${JSON.stringify(src('components/details/DetailsHero.tsx'))};
import { DetailsPill } from ${JSON.stringify(src('components/details/DetailsPill.tsx'))};
import { DetailsTitle } from ${JSON.stringify(src('components/details/DetailsTitle.tsx'))};
import { DetailsMetaLine } from ${JSON.stringify(src('components/details/DetailsMetaLine.tsx'))};
import { DetailsSynopsis } from ${JSON.stringify(src('components/details/DetailsSynopsis.tsx'))};
import { DetailsButton } from ${JSON.stringify(src('components/details/DetailsButton.tsx'))};
import { DetailsActionButton, DetailsActionRow } from ${JSON.stringify(src('components/details/DetailsActionButton.tsx'))};
import { DetailsSectionNav } from ${JSON.stringify(src('components/details/DetailsSectionNav.tsx'))};
import { DetailsSection, DetailsSectionHeader } from ${JSON.stringify(src('components/details/DetailsSection.tsx'))};
import { DetailsFacts } from ${JSON.stringify(src('components/details/DetailsFacts.tsx'))};
import { DetailsInlineLinks, DetailsSynopsisBlock, DetailsTmdbNote } from ${JSON.stringify(src('components/details/DetailsOverview.tsx'))};
import { DetailsPeopleRow } from ${JSON.stringify(src('components/details/DetailsPeopleRow.tsx'))};
import { TvSeasonPills } from ${JSON.stringify(src('components/details/tv/TvSeasonPills.tsx'))};
import { TvEpisodesToolbar, TvEpisodeViewSwitch } from ${JSON.stringify(src('components/details/tv/TvEpisodesToolbar.tsx'))};
import { TvEpisodeList } from ${JSON.stringify(src('components/details/tv/TvEpisodeList.tsx'))};
import DetailsSkeleton from ${JSON.stringify(src('components/skeletons/DetailsSkeleton.tsx'))};
import DetailsRouteSkeleton from ${JSON.stringify(src('components/skeletons/DetailsRouteSkeleton.tsx'))};
import { setDetailsPageStyle } from ${JSON.stringify(src('utils/detailsPageStyle.ts'))};

const t = (key, options) => i18n.t(key, options);

// Logo TMDB type : 3,125 fois plus large que haut, il touche les deux limites
// de taille de \`DetailsTitle\`, comme le bloc du squelette.
const logo = (() => {
  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  canvas.height = 320;
  const context = canvas.getContext('2d');
  context.fillStyle = '#ddd';
  context.fillRect(0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
})();

const SYNOPSIS = "Dans un futur proche, la Terre se meurt. Un groupe d'explorateurs part à travers un trou de ver, aux confins de la galaxie, pour trouver une planète où l'humanité pourrait recommencer, au risque de ne jamais revoir ceux qu'ils aiment restés sur Terre.";

// Même structure que \`LikeDislikeButton\` (qui appelle l'API) : deux boutons, icône et compteur.
const places = (value) => {
  if (value === 0) return [1];
  const digits = Math.floor(Math.log10(Math.max(1, value))) + 1;
  return Array.from({ length: digits }, (_, index) => Math.pow(10, digits - 1 - index));
};
const Votes = () => (
  <div className="flex flex-col items-start gap-2">
    <div className="flex items-center gap-3">
      {[12, 3].map((value) => (
        <button key={value} type="button" className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 text-gray-300">
          <svg width="20" height="20" viewBox="0 0 24 24" className="w-5 h-5" />
          <div className="relative overflow-hidden flex items-center justify-center" style={{ minWidth: '2ch' }}>
            <Counter value={value} fontSize={14} padding={0} places={places(value)} gap={0} borderRadius={0} horizontalPadding={0} textColor="currentColor" fontWeight="500" gradientHeight={0} />
          </div>
        </button>
      ))}
    </div>
  </div>
);

const people = [
  'Matthew McConaughey', 'Anne Hathaway', 'Jessica Chastain', 'Michael Caine',
  'Casey Affleck', 'Wes Bentley', 'Topher Grace', 'Mackenzie Foy',
].map((name, index) => ({ id: index + 1, name, role: index % 2 ? 'Brand' : 'Cooper', to: '/person/' + (index + 1) }));

const link = (name) => [{ id: name, name, to: '/x' }];

const Actions = ({ isTV }) => (
  <div className="flex flex-col gap-2.5 md:flex-row md:flex-wrap md:gap-3">
    <DetailsButton variant="primary" size="hero" icon={<Play aria-hidden="true" className="fill-current" />} className="w-full md:w-auto">
      {t('details.watchBtn')}
    </DetailsButton>
    <div className="grid gap-2.5 md:contents grid-cols-2">
      <DetailsButton icon={<Video aria-hidden="true" />}>{t('details.bandeAnnonce')}</DetailsButton>
      <DetailsButton icon={<Download aria-hidden="true" />}>{t('details.downloadBtn')}</DetailsButton>
    </div>
  </div>
);

const SecondaryActions = ({ isTV }) => (
  <DetailsActionRow columns={isTV ? 6 : 5}>
    <DetailsActionButton icon={Bookmark} label={t('details.toWatchBtn')} />
    <DetailsActionButton icon={Heart} label={t('details.favoritesBtn')} />
    <DetailsActionButton icon={Check} label={t('details.watchedBtn')} />
    <DetailsActionButton icon={ListPlus} label={t(isTV ? 'details.addToAList' : 'lists.addToList')} shortLabel={t('details.listShort')} />
    {isTV && <DetailsActionButton icon={EyeOff} label={t('details.antiSpoil')} />}
    <DetailsActionButton icon={Share} label={t('common.share')} />
  </DetailsActionRow>
);

function Movie() {
  return (
    <div className="relative min-h-screen bg-black pb-24 text-white">
      <DetailsHero
        backdropUrl={null}
        pills={(
          <>
            <DetailsPill uppercase>{t('search.movieLabel')}</DetailsPill>
            <DetailsPill>2014</DetailsPill>
            <DetailsPill tone="rating" icon={<Star aria-hidden="true" className="fill-current" />}>8,4<span className="hidden md:inline">&nbsp;TMDB</span></DetailsPill>
            <DetailsPill dot="on">{t('details.releasedBadge')}</DetailsPill>
          </>
        )}
        title={<DetailsTitle title="Interstellar" logoUrl={logo} />}
        meta={(
          <DetailsMetaLine items={[
            { key: 'runtime', content: '2 h 49' },
            { key: 'genres', content: 'Aventure, Drame, Science-Fiction' },
            { key: 'director', content: 'Christopher Nolan', desktopOnly: true },
          ]} />
        )}
        synopsis={<DetailsSynopsis text={SYNOPSIS} moreLabel={t('details.readMore')} lessLabel={t('details.collapse')} />}
        actions={<Actions />}
        secondaryActions={<SecondaryActions />}
        votes={<Votes />}
      />
      <DetailsSectionNav
        ariaLabel="Sections"
        sections={[
          { id: 'apercu', label: t('details.overviewTab') },
          { id: 'distribution', label: t('details.castTab') },
          { id: 'videos', label: t('details.mediaSection'), shortLabel: t('details.videosTab') },
          { id: 'details', label: t('details.detailsTab') },
          { id: 'commentaires', label: t('details.commentsTab') },
        ]}
      />
      <div className={DETAILS_GRID}>
        <DetailsSection id="apercu" className="pt-[22px]">
          <div className="grid gap-9 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:items-start lg:gap-[72px]">
            <DetailsSynopsisBlock mediaType="movie" id="157336" text={SYNOPSIS} genres={[{ id: 12, name: 'Aventure' }, { id: 18, name: 'Drame' }, { id: 878, name: 'Science-Fiction' }]} />
            <div>
              <DetailsFacts items={[
                { key: 'direction', label: t('details.directionLabel'), value: <DetailsInlineLinks links={link('Christopher Nolan')} /> },
                { key: 'screenplay', label: t('details.screenplayLabel'), value: <DetailsInlineLinks links={link('Jonathan Nolan, Christopher Nolan')} /> },
                { key: 'genres', label: t('details.genresLabel'), className: 'md:hidden', value: 'Aventure, Drame, Science-Fiction' },
                { key: 'runtime', label: t('details.durationLabel'), className: 'hidden md:flex', value: '2 h 49 (169 min)' },
                { key: 'release', label: t('details.releaseShort'), value: '5 novembre 2014' },
                { key: 'classification', label: t('details.classificationLabel'), value: 'Tous publics' },
                { key: 'tmdb', label: t('details.ratingLabel'), value: '8,4 / 10 · 37 k votes' },
              ]} />
              <DetailsTmdbNote mediaType="movie" id="157336" className="mt-3 md:hidden" />
            </div>
          </div>
        </DetailsSection>
        <Cast />
      </div>
    </div>
  );
}

function Cast() {
  return (
    <DetailsSection id="distribution">
      <DetailsSectionHeader title={t('details.castTab')} onToggle={() => {}} moreLabel={t('details.castMore')} />
      <DetailsPeopleRow people={people} />
    </DetailsSection>
  );
}

function Show() {
  const phone = window.innerWidth < 768;
  // Saison de huit épisodes, comme le squelette.
  const episodes = Array.from({ length: 8 }, (_, index) => ({
    key: 's1e' + (index + 1),
    number: index + 1,
    title: (index + 1) + '. ' + ['Chute libre', 'Le Choix', 'Le Cancer'][index % 3],
    imageUrl: null,
    meta: ['58 min', '20 janv. 2008'],
    metaWide: ['8,2'],
    overview: "Walter White, professeur de chimie dans un lycée, apprend qu'il est atteint d'un cancer. Pour assurer l'avenir de sa famille, il décide de fabriquer de la méthamphétamine avec un ancien élève.",
  }));
  const viewOptions = phone ? ['list', 'dropdown'] : ['grid', 'list', 'dropdown'];
  const view = phone ? 'list' : 'grid';
  return (
    <div className="relative min-h-screen bg-black pb-24 text-white">
      <DetailsHero
        backdropUrl={null}
        pills={(
          <>
            <DetailsPill uppercase>{t('search.serieLabel')}</DetailsPill>
            <DetailsPill>2008 – 2013</DetailsPill>
            <DetailsPill className="hidden sm:inline-flex">16+</DetailsPill>
            <DetailsPill tone="rating" icon={<Star aria-hidden="true" className="fill-current" />}>8,9<span className="hidden md:inline">&nbsp;TMDB</span></DetailsPill>
            <DetailsPill dot="on" className="h-auto min-h-[26px] whitespace-normal rounded-xl py-1 md:h-auto md:min-h-7">{t('details.ended')}</DetailsPill>
          </>
        )}
        title={<DetailsTitle title="Breaking Bad" logoUrl={logo} />}
        meta={(
          <DetailsMetaLine items={[
            { key: 'seasons', content: t('details.seasonsCount', { count: 5 }) },
            { key: 'episodes', content: t('details.episodesCount', { count: 62 }) },
            { key: 'genres', content: 'Drame, Crime', desktopOnly: true },
            { key: 'network', content: 'AMC', desktopOnly: true },
            { key: 'status', content: t('details.ended'), phoneOnly: true },
          ]} />
        )}
        synopsis={<DetailsSynopsis text={SYNOPSIS} moreLabel={t('details.readMore')} lessLabel={t('details.collapse')} />}
        actions={<Actions isTV />}
        secondaryActions={<SecondaryActions isTV />}
        votes={<Votes />}
      />
      <DetailsSectionNav
        ariaLabel="Sections"
        sections={[
          { id: 'episodes', label: t('details.episodesLabel') },
          { id: 'apercu', label: t('details.overviewTab') },
          { id: 'distribution', label: t('details.castTab') },
          { id: 'videos', label: t('details.mediaSection'), shortLabel: t('details.videosTab') },
          { id: 'details', label: t('details.detailsTab') },
          { id: 'commentaires', label: t('details.commentsTab') },
        ]}
      />
      <div className={DETAILS_GRID}>
        <DetailsSection id="episodes" className="pt-5 md:scroll-mt-24 md:pt-9 2xl:scroll-mt-24 2xl:pt-9">
          <div>
            <h2 className="sr-only">{t('details.episodesLabel')}</h2>
            <div className="md:mb-3 md:flex md:flex-wrap md:items-center md:justify-between md:gap-4">
              <TvSeasonPills
                seasons={[10, 13, 13].map((count, index) => ({ number: index + 1, name: t('details.seasonNumber', { number: index + 1 }), episodeCount: count, episodeCountLabel: '' }))}
                selected={1}
                onSelect={() => {}}
                ariaLabel="Saisons"
              />
              <TvEpisodesToolbar className="mt-3.5 md:mt-0" view={{ options: viewOptions, value: view, onChange: () => {} }} />
            </div>
            <div className="mb-1 mt-3.5 flex items-center justify-between gap-3 md:mb-[22px] md:mt-0">
              <p className="min-w-0 text-[13px] text-white/55 md:text-sm">{t('details.seasonNumber', { number: 1 })} · 2008 · {t('details.episodesCount', { count: 10 })}</p>
              <TvEpisodeViewSwitch className="md:hidden" options={viewOptions} value={view} onChange={() => {}} />
            </div>
            <TvEpisodeList view={view} episodes={episodes} expanded={{}} onExpandedChange={() => {}} onPlay={() => {}} onToggleWatched={() => {}} onToggleWatchlist={() => {}} />
          </div>
        </DetailsSection>
        <DetailsSection id="apercu">
          <div className="grid gap-9 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:items-start lg:gap-[72px]">
            <DetailsSynopsisBlock mediaType="tv" id="1396" text={SYNOPSIS} genres={[{ id: 18, name: 'Drame' }, { id: 80, name: 'Crime' }]} />
            <div>
              <DetailsSectionHeader title={t('details.overviewTab')} className="md:hidden" />
              <DetailsFacts items={[
                { key: 'creation', label: t('details.creationLabel'), value: <DetailsInlineLinks links={link('Vince Gilligan')} /> },
                { key: 'genres', label: t('details.genresLabel'), className: 'md:hidden', value: 'Drame, Crime' },
                { key: 'network', label: t('details.broadcasterLabel'), value: 'AMC' },
                { key: 'firstAir', label: t('details.firstAirDate'), value: '20 janvier 2008' },
                { key: 'status', label: t('details.statusLabel'), value: t('details.ended') },
                { key: 'seasons', label: t('details.seasonsLabel'), value: 5 },
                { key: 'episodes', label: t('details.episodesLabel'), value: 62 },
                { key: 'classification', label: t('details.classificationLabel'), value: 'Déconseillé -16' },
                { key: 'tmdb', label: t('details.ratingLabel'), value: '8,9 / 10 · 15 k votes' },
              ]} />
              <DetailsTmdbNote mediaType="tv" id="1396" className="mt-3 md:hidden" />
            </div>
          </div>
        </DetailsSection>
        <Cast />
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById('root'));
const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
const settle = async () => {
  await Promise.all(Array.from(document.images, (img) => img.decode().catch(() => {})));
  for (let index = 0; index < 6; index++) await frame();
};

const rect = (box) => {
  const { x, y, width, height } = box.getBoundingClientRect();
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, w: Math.round(width * 10) / 10, h: Math.round(height * 10) / 10 };
};
const visible = (element) => element.getBoundingClientRect().width > 0;

/** Rend un cas et relève les boîtes à comparer. */
window.showCase = async ({ mediaType, skeleton, overlay, language }) => {
  if (i18n.language !== language) await i18n.changeLanguage(language);
  // L'anglais arrive après coup (\`loadEnglishBundle\`) : l'attendre, sinon la
  // page s'écrirait encore en français.
  for (let attempt = 0; attempt < 100 && !i18n.hasResourceBundle(language, 'translation'); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const content = mediaType === 'tv' ? <Show /> : <Movie />;
  const skeletonView = <DetailsSkeleton mediaType={mediaType} />;
  flushSync(() => root.render(
    <MemoryRouter>
      <LightModeProvider>
        {overlay ? (
          <div style={{ position: 'relative' }}>
            {content}
            <div className="overlay" style={{ position: 'absolute', inset: 0, opacity: 0.75, pointerEvents: 'none' }}>{skeletonView}</div>
          </div>
        ) : skeleton ? skeletonView : content}
      </LightModeProvider>
    </MemoryRouter>,
  ));
  await settle();
  const view = document.getElementById('root');

  // Place du texte lui-même : écrit en invisible dans le squelette, il y est
  // mis en page comme dans la page. Les compteurs des pouces (chiffres qui
  // défilent) et les titres réservés aux lecteurs d'écran sont laissés de côté.
  const labels = {};
  const walker = document.createTreeWalker(view, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const text = walker.currentNode.textContent.replace(/\\u00a0/g, ' ').trim();
    if (!text || /^\\d+$/.test(text)) continue;
    if (walker.currentNode.parentElement.closest('.sr-only')) continue;
    const range = document.createRange();
    range.selectNodeContents(walker.currentNode);
    const box = rect(range);
    if (box.w <= 1 || box.h <= 1) continue;
    (labels[text] ??= []).push(box);
  }
  const first = (selector) => {
    const element = Array.from(view.querySelectorAll(selector)).find(visible);
    return element ? rect(element) : null;
  };
  return {
    labels,
    hero: rect(view.querySelector('section')),
    // Pouces : dernier bloc de l'image du haut.
    votes: rect(view.querySelector('section > div:last-child > div:last-child')),
    portrait: first('[class*="aspect-[4/5]"]'),
    thumbs: Array.from(view.querySelectorAll('[class*="aspect-video"]')).filter(visible).slice(0, 4).map(rect),
    height: view.scrollHeight,
  };
};
// Squelette de la route selon le style choisi dans les paramètres : le
// nouveau a la grande image (\`section\`), l'ancien garde la marge du haut.
window.routeSkeleton = async ({ style, mediaType }) => {
  setDetailsPageStyle(style);
  flushSync(() => root.render(
    <MemoryRouter>
      <LightModeProvider>
        <DetailsRouteSkeleton mediaType={mediaType} />
      </LightModeProvider>
    </MemoryRouter>,
  ));
  await settle();
  const view = document.getElementById('root');
  const result = {
    hero: Boolean(view.querySelector('section')),
    legacyMargin: view.firstElementChild?.classList.contains('pt-20') ?? false,
  };
  setDetailsPageStyle('modern');
  return result;
};
window.ready = true;
`;
writeFileSync(path.join(work, 'page.tsx'), page);

// Le préchargement des routes tirerait toute l'application : un simple lien suffit ici.
writeFileSync(path.join(work, 'PrefetchLink.tsx'), "export { Link as PrefetchLink, Link as default } from 'react-router-dom';\n");

await require('esbuild').build({
  entryPoints: [path.join(work, 'page.tsx')],
  outfile: path.join(work, 'page.js'),
  bundle: true, format: 'esm', target: 'es2022', jsx: 'automatic', logLevel: 'warning',
  nodePaths: [path.join(repo, 'node_modules')],
  alias: { '@': path.join(repo, 'src') },
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{"DEV":false,"PROD":true,"VITE_SITE_URL":"https://banc.test"}' },
  loader: { '.png': 'dataurl', '.svg': 'dataurl', '.webp': 'dataurl' },
  plugins: [{
    name: 'prefetch-link',
    setup(build) {
      build.onResolve({ filter: /routing\/PrefetchLink$/ }, () => ({ path: path.join(work, 'PrefetchLink.tsx') }));
    },
  }],
});

// Le CSS du site pour ces fichiers : Tailwind avec la configuration du dépôt,
// la police du site et la feuille de react-loading-skeleton.
const tailwindConfig = require('tailwindcss/loadConfig')(path.join(repo, 'tailwind.config.js'));
const compiled = await require('postcss')([
  require('tailwindcss')({
    ...tailwindConfig,
    content: [
      path.join(work, 'page.tsx'),
      src('components/skeletons/DetailsSkeleton.tsx'),
      src('components/details/*.{ts,tsx}'),
      src('components/details/tv/*.{ts,tsx}'),
      src('components/ui/counter.tsx'),
    ],
  }),
]).process('@tailwind base; @tailwind utilities;', { from: undefined });
const css = [
  compiled.css,
  readFileSync(require.resolve('react-loading-skeleton/dist/skeleton.css'), 'utf8'),
  'body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }',
  // Captures : sans le fondu d'entrée ; superposé, le squelette laisse voir la page.
  '.animate-skeleton-fade { animation: none !important; }',
  '.overlay > div { background: transparent !important; }',
].join('\n');

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://banc');
  if (url.pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/page.css">'
      + '<body style="margin:0;background:#000"><div id="root"></div><script type="module" src="/page.js"></script>');
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
  const logs = [];
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') logs.push(message.params.exceptionDetails?.exception?.description ?? 'exception');
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
    if (attempt === 99) throw new Error(`la page du banc ne démarre pas ${logs.join(' | ')}`);
    await sleep(150);
  }

  const shoot = async (name, size, options) => {
    await send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: 1, mobile: false });
    const info = await evaluate(`window.showCase(${JSON.stringify(options)})`);
    if (shotsDir) {
      const { data } = await send('Page.captureScreenshot', {
        format: 'png', captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: size.width, height: Math.min(info.height, size.height * 2.2), scale: 1 },
      });
      writeFileSync(path.join(shotsDir, `${name}.png`), Buffer.from(data, 'base64'));
    }
    return info;
  };

  // Libellés connus d'avance : le squelette les écrit en invisible, ils doivent
  // tomber au pixel près (une marge de 1,5 px pour l'arrondi des polices).
  const LABEL_TOLERANCE = 1.5;
  const SIZES = [
    { name: 'telephone', width: 375, height: 812 },
    { name: 'tablette', width: 768, height: 1024 },
    { name: 'portable', width: 1280, height: 800 },
    { name: 'ordinateur', width: 1920, height: 1080 },
  ];

  for (const language of ['fr', 'en']) {
    for (const mediaType of ['movie', 'tv']) {
      for (const size of SIZES) {
        if (language === 'en' && size.name !== 'telephone' && size.name !== 'ordinateur') continue;
        const tag = `${mediaType === 'tv' ? 'serie' : 'film'}-${size.name}-${language}`;
        const real = await shoot(`${tag}-page`, size, { mediaType, skeleton: false, language });
        const bones = await shoot(`${tag}-squelette`, size, { mediaType, skeleton: true, language });
        if (shotsDir) await shoot(`${tag}-superpose`, size, { mediaType, overlay: true, language });

        // Image du haut : même hauteur, donc la barre de sections au même endroit.
        check(`${tag} : fin de l'image du haut`, Math.abs(real.hero.h - bones.hero.h) <= LABEL_TOLERANCE,
          `page ${real.hero.h} px, squelette ${bones.hero.h} px`);

        const votesDelta = Math.max(...['x', 'y', 'w', 'h'].map((key) => Math.abs(real.votes[key] - bones.votes[key])));
        check(`${tag} : pouces`, votesDelta <= LABEL_TOLERANCE,
          `squelette ${bones.votes.x},${bones.votes.y} ${bones.votes.w}×${bones.votes.h} / page ${real.votes.x},${real.votes.y} ${real.votes.w}×${real.votes.h}`);

        // Chaque libellé présent des deux côtés, dans l'ordre où il apparaît.
        const misses = [];
        let compared = 0;
        for (const [text, boxes] of Object.entries(bones.labels)) {
          const targets = real.labels[text];
          if (!targets) continue;
          boxes.forEach((box, index) => {
            const other = targets[index];
            if (!other) return;
            compared++;
            const delta = Math.max(Math.abs(box.x - other.x), Math.abs(box.y - other.y), Math.abs(box.w - other.w), Math.abs(box.h - other.h));
            if (delta > LABEL_TOLERANCE) {
              misses.push(`« ${text} » #${index + 1} : squelette ${box.x},${box.y} ${box.w}×${box.h} / page ${other.x},${other.y} ${other.w}×${other.h}`);
            }
          });
        }
        check(`${tag} : libellés à leur place (${compared} comparés)`, compared >= 10 && misses.length === 0,
          misses.length ? `\n      ${misses.join('\n      ')}` : 'tous au pixel près');

        if (real.portrait && bones.portrait) {
          const delta = Math.max(Math.abs(real.portrait.x - bones.portrait.x), Math.abs(real.portrait.w - bones.portrait.w), Math.abs(real.portrait.h - bones.portrait.h));
          check(`${tag} : portraits de la distribution`, delta <= LABEL_TOLERANCE,
            `squelette ${bones.portrait.w}×${bones.portrait.h} à x=${bones.portrait.x}, page ${real.portrait.w}×${real.portrait.h} à x=${real.portrait.x}`);
        }
        if (mediaType === 'tv') {
          const pairs = bones.thumbs.map((box, index) => [box, real.thumbs[index]]).filter(([, other]) => other);
          const worst = Math.max(0, ...pairs.map(([box, other]) => Math.max(Math.abs(box.x - other.x), Math.abs(box.y - other.y), Math.abs(box.w - other.w), Math.abs(box.h - other.h))));
          check(`${tag} : vignettes des épisodes`, pairs.length > 0 && worst <= LABEL_TOLERANCE,
            pairs.length ? `écart le plus grand ${worst.toFixed(1)} px sur ${pairs.length} vignettes` : 'aucune vignette comparée');
        }
      }
    }
  }
  // Ancien style : la route garde l'ancien squelette, avec sa marge du haut.
  for (const mediaType of ['movie', 'tv']) {
    const modern = await evaluate(`window.routeSkeleton(${JSON.stringify({ style: 'modern', mediaType })})`);
    const classic = await evaluate(`window.routeSkeleton(${JSON.stringify({ style: 'classic', mediaType })})`);
    check(`route ${mediaType} : squelette selon le style des fiches`, modern.hero && !modern.legacyMargin && !classic.hero && classic.legacyMargin,
      `nouveau style : ${modern.hero ? 'grande image' : 'pas de grande image'} ; ancien style : ${classic.legacyMargin ? 'ancien squelette (marge du haut)' : 'mauvais squelette'}`);
  }
  if (logs.length) check('aucune erreur dans la page', false, logs.join(' | '));
} catch (error) {
  check('exécution du banc', false, error.message);
} finally {
  cleanUp();
}

const failed = results.filter(result => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} réussis`);
setTimeout(() => process.exit(failed || !results.length ? 1 : 0), 700);
