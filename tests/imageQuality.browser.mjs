/**
 * Browser verification of the actual image-quality controls and catalogue UI.
 * No server, account or external network. Run: node tests/imageQuality.browser.mjs
 * Requires npm dependencies, Playwright + Chromium (optionally from
 * CODEX_PRIMARY_RUNTIME_NODE_MODULES). IMAGE_QUALITY_REPORT_DIR retains evidence.
 * Optional TMDB_IMAGE_FIXTURES: directory containing dune-2-{poster,backdrop}-SIZE.jpg.
 * Without it, deterministic SVG fixtures exercise source selection, not byte savings.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
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
const work = process.env.IMAGE_QUALITY_REPORT_DIR || await mkdtemp(path.join(tmpdir(), 'movix-image-quality-'));
await mkdir(work, { recursive: true });
const source = (file) => JSON.stringify(path.join(repo, 'src', file));
await writeFile(path.join(work, 'entry.tsx'), `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import i18next from 'i18next';
import {I18nextProvider} from 'react-i18next';
import fr from ${source('i18n/locales/fr.json')};
import {LightModeProvider} from ${source('context/LightModeContext')};
import {useImageQuality} from ${source('hooks/useImageQuality')};
import {PerformanceSettings} from ${source('components/Settings/PerformanceSettings')};
import {CarouselCard} from ${source('components/EmblaCarousel')};
import {SearchGridCard,SearchListCard} from ${source('components/SearchCard')};
import HeroSlider from ${source('components/HeroSlider')};
import {MediaColorAlgorithmSettings} from ${source('components/Settings/MediaColorAlgorithmSettings')};
import {TooltipProvider} from ${source('components/ui/tooltip')};
const item={id:42,title:'Film témoin',poster_path:'/poster.jpg',backdrop_path:'/backdrop.jpg',overview:'Image témoin',vote_average:8,release_date:'2024-01-01',media_type:'movie'};
const items=[item,{...item,id:43,title:'Voisin suivant',backdrop_path:'/backdrop-next.jpg'},{...item,id:44,title:'Voisin précédent',backdrop_path:'/backdrop-prev.jpg'}];
const surface=new URLSearchParams(location.search).get('surface')||'card';
function App(){
 const quality=useImageQuality();
 const [cardWidth,setCardWidth]=useState(240);
 window.resizeImageCard=setCardWidth;
 return <><output id="quality-state">{JSON.stringify(quality)}</output>
 <main data-surface={surface} style={{padding:12}}>
 {surface==='card'&&<CarouselCard item={item} priority/>}
 {surface==='search'&&<div style={{width:cardWidth}}><SearchGridCard item={item} index={0} movieLabel="Film" serieLabel="Série" animateEntrance={false}/></div>}
 {surface==='list'&&<SearchListCard item={item} index={0} movieLabel="Film" serieLabel="Série" watchlistLabel="Ajouter" removeLabel="Retirer" noDescLabel="Résumé" animateEntrance={false}/>}
 {surface==='hero'&&<HeroSlider items={items}/>}
 {surface.startsWith('preview')&&<MediaColorAlgorithmSettings target={surface==='preview-hero'?'hero':'cards'} mode="off" fixedColor="#000000" value="dominant" previewImage={{url:'https://image.tmdb.org/t/p/w500/'+(surface==='preview-hero'?'backdrop.jpg':'poster.jpg')}} onPreviewImageChange={()=>{}} onChange={()=>{}}/>}
 </main><PerformanceSettings/></>;
}
await i18next.init({lng:'fr',resources:{fr:{translation:fr}},interpolation:{escapeValue:false}});
createRoot(document.getElementById('root')).render(<MemoryRouter><I18nextProvider i18n={i18next}><LightModeProvider><TooltipProvider><App/></TooltipProvider></LightModeProvider></I18nextProvider></MemoryRouter>);
`);
await build({
  entryPoints: [path.join(work, 'entry.tsx')], outfile: path.join(work, 'app.js'), bundle: true,
  format: 'esm', target: 'es2022', jsx: 'automatic', nodePaths: [path.join(repo, 'node_modules')],
  alias: { '@': path.join(repo, 'src') }, define: { 'import.meta.env': '{}' },
  plugins: [{ name: 'unrelated-contexts', setup(builder) {
    builder.onResolve({ filter: /useAgeRestrictedContent$|PrefetchLink$|\/i18n$/ }, ({ path: name }) => ({ path: name, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: name }) => ({
      contents: name.endsWith('useAgeRestrictedContent') ? 'export const useAgeRestrictedContent=items=>({items});'
        : name.endsWith('PrefetchLink') ? "export {Link as PrefetchLink} from 'react-router-dom';"
        : "export const getTmdbLanguage=()=> 'fr-FR';",
      resolveDir: repo,
    }));
  } }],
});
await writeFile(path.join(work, 'base.css'), '@tailwind base;\n@tailwind components;\n@tailwind utilities;');
execFileSync(process.execPath, [path.join(repo, 'node_modules/tailwindcss/lib/cli.js'),
  '-c', path.join(repo, 'tailwind.config.js'), '-i', path.join(work, 'base.css'), '-o', path.join(work, 'ui.css'),
  '--content', 'src/components/{HeroSlider,EmblaCarousel,SearchCard}.tsx,src/components/Settings/{PerformanceSettings,MediaColorAlgorithmSettings,MediaColorPreview,SettingsDisclosure}.tsx',
], { cwd: repo, stdio: 'pipe' });
await writeFile(path.join(work, 'index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/ui.css"><link rel="stylesheet" href="/app.css"></head><body style="background:#111;color:white"><div id="root"></div><script type="module" src="/app.js"></script></body></html>');

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
const results = [];
const failures = [];
const imageFiles = new Map();
async function imageResponse(url) {
  const size = url.pathname.split('/')[3];
  const kind = url.pathname.includes('backdrop') ? 'backdrop' : 'poster';
  const key = `${kind}-${size}`;
  if (process.env.TMDB_IMAGE_FIXTURES) {
    if (!imageFiles.has(key)) imageFiles.set(key, await readFile(path.join(process.env.TMDB_IMAGE_FIXTURES, `dune-2-${key}.jpg`)));
    return { contentType: 'image/jpeg', body: imageFiles.get(key) };
  }
  const width = size === 'original' ? (kind === 'backdrop' ? 3840 : 2000) : Number(size.slice(1));
  const height = Math.round(width * (kind === 'backdrop' ? 9 / 16 : 3 / 2));
  return { contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#a53939"/></svg>` };
}
async function scenario(name, options, verify) {
  const context = await browser.newContext({ viewport: { width: options.width || 1280, height: options.height || 900 }, deviceScaleFactor: options.dpr || 1 });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const requests = [];
  const errors = [];
  await context.addInitScript((options) => {
    if (localStorage.getItem('settings_image_quality') === null) localStorage.setItem('settings_image_quality', options.quality || 'auto');
    localStorage.setItem('settings_light_mode', options.light || 'off');
    localStorage.setItem('settings_hero_slider_style', options.style || 'classic');
    localStorage.setItem('settings_anim_carousel', 'false');
    localStorage.setItem('settings_media_colors', JSON.stringify({ heroMode: 'off', cardsMode: 'off' }));
    const connection = new EventTarget();
    connection.saveData = !!options.saveData;
    Object.defineProperty(navigator, 'connection', { value: connection, configurable: true });
    window.toggleSaveData = (value) => { connection.saveData = value; connection.dispatchEvent(new Event('change')); };
  }, options);
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'quality.test') {
      const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      await route.fulfill({ contentType: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html', body: await readFile(path.join(work, name)) });
    } else if (url.hostname === 'image.tmdb.org') {
      const response = await imageResponse(url);
      requests.push({ url: url.href, bytes: Buffer.byteLength(response.body) });
      await route.fulfill({ ...response, headers: { 'access-control-allow-origin': '*' } });
    } else if (url.pathname.endsWith('/images')) {
      await route.fulfill({ json: { posters: [], logos: [] }, headers: { 'access-control-allow-origin': '*' } });
    } else await route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  const snapshots = [];
  const capture = async (label) => {
    const image = page.locator('[data-surface] img').first();
    await image.scrollIntoViewIfNeeded();
    await image.evaluate(async (image) => { await image.decode(); });
    const value = await image.evaluate((image) => ({
      source: image.currentSrc, src: image.getAttribute('src'), srcset: image.getAttribute('srcset'), sizes: image.getAttribute('sizes'),
      width: image.getBoundingClientRect().width, height: image.getBoundingClientRect().height,
      naturalWidth: image.naturalWidth, dpr: devicePixelRatio,
      quality: JSON.parse(document.querySelector('#quality-state').textContent),
    }));
    snapshots.push({ label, ...value });
    return value;
  };
  const choose = async (quality) => {
    await page.locator(`input[name="performance-image-quality"][value="${quality}"]`).check({ force: true });
    await page.waitForFunction((quality) => JSON.parse(document.querySelector('#quality-state').textContent).imageQuality === quality, quality, { timeout: 5000 });
  };
  try {
    await page.goto(`http://quality.test/?surface=${options.surface || 'card'}`);
    await page.locator('[data-surface] img').first().waitFor();
    await verify({ page, capture, choose, requests });
    assert.deepEqual(errors, [], 'erreur JavaScript dans les vrais composants');
    await page.screenshot({ path: path.join(work, `${name}.png`) });
    results.push({ name, options, status: 'passed', snapshots, requests });
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    await page.screenshot({ path: path.join(work, `${name}-failed.png`) }).catch(() => {});
    results.push({ name, options, status: 'failed', error: error.message, errors, snapshots, requests });
  } finally {
    await context.tracing.stop({ path: path.join(work, `${name}.trace.zip`) });
    await context.close();
  }
}
const sizeOf = (snapshot) => new URL(snapshot.source).pathname.split('/')[3];
try {
  for (const surface of ['card', 'search', 'list', 'preview-card', 'preview-hero', 'hero']) {
    for (const quality of ['auto', 'economy', 'high']) {
      await scenario(`${surface}-${quality}-retina`, { surface, quality, dpr: 2 }, async ({ capture }) => {
        const image = await capture('chargement neuf');
        assert.ok(image.source.includes('image.tmdb.org'), 'image TMDB non affichée');
        if (surface === 'preview-hero') {
          const required = Math.min(image.width * image.dpr, quality === 'economy' ? 1280 : Infinity);
          assert.ok(image.naturalWidth >= required, 'aperçu suffisamment défini pour sa taille affichée');
          if (quality === 'economy') assert.notEqual(sizeOf(image), 'original', 'plafond économie de l’aperçu');
          return;
        }
        const expected = surface === 'list' ? 'w342'
          : surface === 'hero' ? quality === 'economy' ? 'w1280' : 'original'
          : quality === 'economy' ? 'w342' : 'w500';
        assert.equal(sizeOf(image), expected, 'source adaptée au rendu de cette surface');
      });
    }
  }
  await scenario('phone-density', { width: 390, dpr: 3 }, async ({ capture }) => {
    assert.equal(sizeOf(await capture('144 px CSS sur écran 3×')), 'w500');
  });
  await scenario('desktop-standard', { width: 1280, dpr: 1 }, async ({ capture }) => {
    assert.equal(sizeOf(await capture('192 px CSS sur écran 1×')), 'w342');
  });
  await scenario('settings-live-and-persistence', { dpr: 2 }, async ({ page, choose, capture }) => {
    assert.equal(sizeOf(await capture('auto initial')), 'w500');
    await choose('economy');
    const economy = await capture('économie sans rechargement');
    assert.ok(!economy.srcset.includes('/w500/'), 'les grandes variantes sont retirées en économie');
    assert.equal(await page.evaluate(() => localStorage.getItem('settings_image_quality')), 'economy');
    await page.reload();
    assert.equal(sizeOf(await capture('économie au nouveau chargement')), 'w342');
    await choose('high');
    assert.equal(sizeOf(await capture('passage immédiat à élevée')), 'w500');
  });
  await scenario('auto-light-mode', { dpr: 2, light: 'on' }, async ({ capture, choose }) => {
    const image = await capture('automatique + mode léger');
    assert.equal(image.quality.effectiveImageQuality, 'economy');
    assert.equal(sizeOf(image), 'w342');
    await choose('high');
    assert.equal(sizeOf(await capture('choix explicite élevée')), 'w500');
  });
  await scenario('auto-save-data-live', { dpr: 2, saveData: true }, async ({ page, capture }) => {
    assert.equal(sizeOf(await capture('économiseur réseau actif')), 'w342');
    await page.evaluate(() => window.toggleSaveData(false));
    await page.waitForFunction(() => JSON.parse(document.querySelector('#quality-state').textContent).effectiveImageQuality === 'auto');
    assert.equal(sizeOf(await capture('économiseur réseau désactivé')), 'w500');
  });
  await scenario('search-density-resize', { surface: 'search', dpr: 2 }, async ({ page, capture }) => {
    assert.equal(sizeOf(await capture('carte de 240 px')), 'w500');
    await page.evaluate(() => window.resizeImageCard(370));
    await page.waitForFunction(() => document.querySelector('[data-surface] img').getBoundingClientRect().width > 360);
    assert.equal(sizeOf(await capture('carte élargie à 370 px')), 'w780');
  });
  await scenario('storage-silent-failure', { dpr: 2 }, async ({ page, capture, choose }) => {
    await capture('avant indisponibilité');
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (this === localStorage && key === 'settings_image_quality') return;
        return original.call(this, key, value);
      };
    });
    await choose('economy');
    assert.equal((await capture('choix conservé en session')).quality.imageQuality, 'economy');
    assert.equal(await page.evaluate(() => localStorage.getItem('settings_image_quality')), 'auto');
  });
  await scenario('storage-session-profile-isolation', { dpr: 2, quality: 'high' }, async ({ page, capture, choose }) => {
    await page.evaluate(() => {
      localStorage.setItem('selected_profile_id', 'profile-a');
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (this === localStorage && key === 'settings_image_quality') throw new DOMException('Fixture quota', 'QuotaExceededError');
        return original.call(this, key, value);
      };
    });
    await choose('economy');
    await page.evaluate(() => window.dispatchEvent(new Event('sync_storage_updated')));
    assert.equal((await capture('sync sans changement de profil')).quality.imageQuality, 'economy');
    await page.evaluate(() => {
      localStorage.setItem('selected_profile_id', 'profile-b');
      window.dispatchEvent(new Event('sync_storage_updated'));
    });
    assert.equal((await capture('autre profil avec même valeur persistée')).quality.imageQuality, 'high');
  });
  await scenario('morph-cap', { surface: 'hero', dpr: 3, style: 'morph', quality: 'high' }, async ({ page, requests }) => {
    await page.waitForFunction(() => document.querySelector('[data-surface] canvas')?.style.visibility === 'visible');
    assert.ok(requests.some(({ url }) => url.includes('/w1280/backdrop')));
    assert.ok(!requests.some(({ url }) => url.includes('/original/')), 'Morph ne télécharge pas de textures originales');
  });
} finally {
  await browser.close();
  await writeFile(path.join(work, 'results.json'), JSON.stringify({ fixtures: process.env.TMDB_IMAGE_FIXTURES || 'SVG déterministes', results, failures }, null, 2));
  const report = `# Vérification de la qualité des images\n\nCommande : \`node tests/imageQuality.browser.mjs\`\n\nPrérequis : dépendances npm, Playwright et Chromium. Aucun serveur ni compte, réseau entièrement intercepté.\n\nVariables facultatives : CODEX_PRIMARY_RUNTIME_NODE_MODULES, IMAGE_QUALITY_REPORT_DIR, TMDB_IMAGE_FIXTURES.\n\nLes vrais composants, hooks, styles Tailwind et contrôles sont utilisés. Seuls le contexte de restrictions d’âge, le préchargement des routes et les réponses réseau sont simulés. Cette fixture ne valide pas les API ni une navigation complète du site.\n\nImages : ${process.env.TMDB_IMAGE_FIXTURES || 'SVG déterministes, aucune mesure de poids réelle'}.\n\nAttendus : tailles adaptées aux dimensions CSS et à la densité, plafonds économie/Morph, changements immédiats via les contrôles, mode léger et Save-Data pris en compte.\n\nRésultats : ${results.filter(r => r.status === 'passed').length}/${results.length} scénarios réussis.\n\n${results.map(r => '- ' + r.name + ': ' + r.status + (r.error ? ' — ' + r.error : '')).join('\n')}\n\nLes URL réellement sélectionnées (currentSrc), tailles CSS, résolutions et octets des fixtures sont dans results.json ; chaque scénario possède une capture et une trace Playwright.\n`;
  await writeFile(path.join(work, 'REPORT.md'), report);
}
console.log(JSON.stringify({ artifact: work, passed: results.length - failures.length, total: results.length, failures }, null, 2));
if (failures.length) process.exitCode = 1;
