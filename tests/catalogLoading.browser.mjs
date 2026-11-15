/**
 * Real React/Embla regression tests, with local fixtures and mocked TMDB.
 * No development server or production API is used.
 * Run: node tests/catalogLoading.browser.mjs
 * Requires npm dependencies and Playwright with Chromium installed.
 * Optional: CHROMIUM_EXECUTABLE_PATH, CHROMIUM_ARGS (JSON array).
 * Regression check: TMDB_IMAGES_BASELINE_REF=HEAD loads useTmdbImages from Git.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const runtimeRequire = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ? createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'package.json')) : require;
const { chromium } = runtimeRequire('playwright');
const work = await mkdtemp(path.join(tmpdir(), 'movix-catalog-'));
const tmdbImagesBaseline = process.env.TMDB_IMAGES_BASELINE_REF
  ? execFileSync('git', ['show', `${process.env.TMDB_IMAGES_BASELINE_REF}:src/hooks/useTmdbImages.ts`], {
      cwd: repo,
      encoding: 'utf8',
    })
  : null;
const fixture = `
import React, {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {LightModeProvider,useLightMode} from ${JSON.stringify(repo + '/src/context/LightModeContext')};
import LazySection from ${JSON.stringify(repo + '/src/components/LazySection')};
import EmblaCarousel from ${JSON.stringify(repo + '/src/components/EmblaCarousel')};
import {useTmdbImages,prefetchTmdbImages} from ${JSON.stringify(repo + '/src/hooks/useTmdbImages')};
import {scheduleSectionLoad} from ${JSON.stringify(repo + '/src/utils/sectionLoadScheduler')};
import ${JSON.stringify(repo + '/src/styles/light-mode.css')};
window.loads={}; window.mounts={}; window.scheduleSectionLoad=scheduleSectionLoad;
const load=name=>async()=>{window.loads[name]=(window.loads[name]||0)+1;};
function Content({name}) {useEffect(()=>{window.mounts[name]=(window.mounts[name]||0)+1;},[]);return <div data-content={name} style={{height:300}}>{name}</div>;}
function RequestProbe(){
 const [enabled,setEnabled]=useState(false);
 const [refresh,setRefresh]=useState(0);
 window.enableImages=()=>setEnabled(true);
 window.changeLanguage=()=>{window.imageLanguage='en-US';setRefresh(n=>n+1);};
 const images=useTmdbImages('movie',999,refresh,enabled);
 window.runRequests=()=>Promise.all([...Array.from({length:13},(_,i)=>prefetchTmdbImages('movie',i+1)),prefetchTmdbImages('movie',1)]);
 return <output id="images">{JSON.stringify(images)}</output>;
}
function MetadataConsumer({id,enabled=true,name}){
 const images=useTmdbImages('movie',id,undefined,enabled);
 useEffect(()=>{window.queueEffects=(window.queueEffects||0)+1;},[]);
 return <output data-consumer={name} data-enabled={enabled}>{JSON.stringify(images)}</output>;
}
function QueuedRequestProbe(){
 const [queued,setQueued]=useState(false);
 const [obsoleteEnabled,setObsoleteEnabled]=useState(true);
 const [mountedObsolete,setMountedObsolete]=useState(true);
 const [sharedFirstEnabled,setSharedFirstEnabled]=useState(true);
 const [newCard,setNewCard]=useState(false);
 const [revisit,setRevisit]=useState(false);
 window.mountQueuedConsumers=()=>setQueued(true);
 window.hideQueuedConsumers=()=>{
  setObsoleteEnabled(false);
  setMountedObsolete(false);
  setSharedFirstEnabled(false);
 };
 window.mountNewCard=()=>setNewCard(true);
 window.revisitObsoleteCard=()=>setRevisit(true);
 window.prefetchQueuedMetadata=()=>prefetchTmdbImages('movie',401);
 useEffect(()=>{
  window.queueState={queued,obsoleteEnabled,mountedObsolete,sharedFirstEnabled,newCard,revisit};
 },[queued,obsoleteEnabled,mountedObsolete,sharedFirstEnabled,newCard,revisit]);
 return <main>
  <MetadataConsumer id={101} name="blocker-101"/>
  <MetadataConsumer id={102} name="blocker-102"/>
  <MetadataConsumer id={103} name="blocker-103"/>
  {queued&&<>
   <MetadataConsumer id={201} enabled={obsoleteEnabled||revisit} name="disabled-then-revisited"/>
   {mountedObsolete&&<MetadataConsumer id={202} name="unmounted"/>}
   <MetadataConsumer id={203} enabled={obsoleteEnabled} name="disabled"/>
   <MetadataConsumer id={250} enabled={sharedFirstEnabled} name="shared-hidden"/>
   <MetadataConsumer id={250} name="shared-active"/>
  </>}
  {newCard&&<MetadataConsumer id={301} name="new-card"/>}
 </main>;
}
const rows=Array.from({length:6},(_,row)=>Array.from({length:30},(_,i)=>({id:row*100+i+1,title:'Film '+(row*100+i+1),poster_path:'/poster.svg',backdrop_path:'/poster.svg',media_type:'movie',overview:'Résumé',vote_average:8})));
const history=Array.from({length:5},(_,i)=>({id:900+i,title:'Historique '+(i+1),poster_path:'/poster.svg',backdrop_path:'/poster.svg',media_type:'movie',overview:'Résumé',vote_average:8,lastWatched:new Date().toISOString(),progress:50}));
function App(){
 const settings=useLightMode(); window.settings=settings;
 const testCase=new URLSearchParams(location.search).get('case');
 if(testCase==='requests') return <RequestProbe/>;
 if(testCase==='queued-requests') return <QueuedRequestProbe/>;
 if(testCase==='sections') return <>
  <div style={{height:1300}}/>
  <LazySection index={8} onLoad={load('near')}><Content name="near"/></LazySection>
  <div style={{height:1800}}/>
  <LazySection index={9} onLoad={load('far')}><Content name="far"/></LazySection>
  <div style={{height:1800}}/>
  <LazySection index={1} onLoad={load('immediate')}><Content name="immediate"/></LazySection>
 </>;
 return <main>
  {rows.map((items,index)=><section key={index} data-row={index} style={{marginBottom:60}}>
   <LazySection index={index}><EmblaCarousel title={'Rangée '+index} items={items} mediaType="movie"/></LazySection>
  </section>)}
  <section data-row="history" style={{marginBottom:60}}>
   <LazySection index={6}><EmblaCarousel title="Historique" items={history} mediaType="movie" isHistory onRemoveItem={()=>{}}/></LazySection>
  </section>
 </main>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><MemoryRouter><LightModeProvider><App/></LightModeProvider></MemoryRouter></React.StrictMode>);
`;

await writeFile(path.join(work, 'entry.tsx'), fixture);
await build({
  entryPoints: [path.join(work, 'entry.tsx')], outfile: path.join(work, 'app.js'),
  bundle: true, format: 'esm', target: 'es2020', jsx: 'automatic',
  nodePaths: [path.join(repo, 'node_modules')], alias: { '@': path.join(repo, 'src') },
  define: { 'import.meta.env': '{}' },
  plugins: [{ name: 'fixture-context', setup(builder) {
    if (tmdbImagesBaseline) {
      builder.onLoad({ filter: /useTmdbImages\.ts$/ }, () => ({
        contents: tmdbImagesBaseline,
        loader: 'ts',
        resolveDir: path.join(repo, 'src/hooks'),
      }));
    }
    builder.onResolve({ filter: /useAgeRestrictedContent$|PrefetchLink$|^\.\.\/i18n$|^react-i18next$/ }, ({ path: name }) => ({ path: name, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: name }) => ({
      contents: name.endsWith('useAgeRestrictedContent') ? 'export const useAgeRestrictedContent=items=>({items});'
        : name.endsWith('PrefetchLink') ? "export {Link as PrefetchLink} from 'react-router-dom';"
        : name === 'react-i18next' ? 'export const useTranslation=()=>({t:key=>key});'
        : "export const getTmdbLanguage=()=>window.imageLanguage||'fr-FR';",
      resolveDir: repo,
    }));
  } }],
});
await writeFile(path.join(work, 'base.css'), '@tailwind base;\n@tailwind components;\n@tailwind utilities;');
execFileSync(process.execPath, [path.join(repo, 'node_modules/tailwindcss/lib/cli.js'),
  '-c', path.join(repo, 'tailwind.config.js'), '-i', path.join(work, 'base.css'), '-o', path.join(work, 'ui.css'),
  '--content', ['src/components/EmblaCarousel.tsx', 'src/components/skeletons/*.tsx', 'src/components/ui/Skeleton.tsx'].join(','),
], { cwd: repo, stdio: 'pipe' });
await writeFile(path.join(work, 'index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/ui.css"><link rel="stylesheet" href="/app.css"></head><body style="background:#000;color:white;overflow-x:hidden"><div id="root"></div><script type="module" src="/app.js"></script></body></html>');

const browser = await chromium.launch({
  headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: JSON.parse(process.env.CHROMIUM_ARGS || '[]'),
});
const results = [];
async function open(testCase, mode, options = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, ...options.context });
  await context.addInitScript(({ mode, noObserver, noIdle }) => {
    localStorage.setItem('settings_light_mode', mode);
    if (noObserver) delete window.IntersectionObserver;
    if (noIdle) { delete window.requestIdleCallback; delete window.cancelIdleCallback; }
    localStorage.setItem('progress_900', JSON.stringify({ position: 50, duration: 100 }));
    window.cacheWrites = 0;
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'movix_tmdb_images_cache_v7') window.cacheWrites++;
      return write.call(this, key, value);
    };
  }, { mode, ...options });
  const metrics = { active: 0, peak: 0, requests: [] };
  let releaseBlockedMetadata;
  const blockedMetadata = new Promise(resolve => { releaseBlockedMetadata = resolve; });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'catalog.test') {
      const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const contentType = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html';
      await route.fulfill({ contentType, body: await readFile(path.join(work, name)) });
    } else if (url.pathname.endsWith('/images')) {
      metrics.active++; metrics.peak = Math.max(metrics.peak, metrics.active);
      metrics.requests.push(url.pathname + '?' + url.searchParams.get('include_image_language'));
      const isSlowPoster = options.slowLocalizedPoster && url.pathname.includes('/movie/1/images');
      const metadataId = Number(url.pathname.match(/\/(\d+)\/images$/)?.[1]);
      if (options.blockedMetadataIds?.includes(metadataId)) await blockedMetadata;
      else await new Promise(resolve => setTimeout(resolve, isSlowPoster ? 500 : 40));
      metrics.active--;
      const headers = { 'access-control-allow-origin': '*' };
      if (url.pathname.includes('/13/')) await route.fulfill({ status: 500, headers, json: {} });
      else await route.fulfill({ headers, json: {
        logos: [{ file_path: '/logo.svg', iso_639_1: url.searchParams.get('include_image_language').split(',')[0] }],
        posters: [{ file_path: isSlowPoster ? '/localized-slow.svg' : '/localized.svg', iso_639_1: null }],
      } });
    } else {
      if (options.slowLocalizedPoster && url.pathname.endsWith('/localized-slow.svg')) {
        await new Promise(resolve => setTimeout(resolve, 800));
      }
      await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="342" height="513"><rect width="342" height="513" fill="#335577"/></svg>' });
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://catalog.test/?case=${testCase}`);
  return { page, context, metrics, errors, releaseBlockedMetadata };
}

async function waitForMetric(page, predicate, message) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await page.waitForTimeout(20);
  }
  assert.fail(message);
}

async function waitForVisiblePosters(page, row) {
  await page.waitForFunction(rowName => {
    const section = document.querySelector(`[data-row="${rowName}"]`);
    if (!section) return false;
    const visibleSlides = [...section.querySelectorAll('.embla-slide')].filter(slide => {
      const bounds = slide.getBoundingClientRect();
      return bounds.right > 0 && bounds.left < innerWidth && bounds.bottom > 0 && bounds.top < innerHeight;
    });
    return visibleSlides.length > 0 && visibleSlides.every(slide => {
      const card = slide.querySelector('.carousel-card');
      const poster = card?.querySelector('img');
      return poster?.complete && poster.naturalWidth > 0 && Number.parseFloat(getComputedStyle(poster).opacity) > 0.99;
    });
  }, String(row));
}

async function readRowGeometry(page, row) {
  return page.locator(`[data-row="${row}"]`).evaluate(section => {
    const slides = [...section.querySelectorAll('.embla-slide')];
    const bounds = slides.map(slide => slide.getBoundingClientRect());
    const visible = bounds.map((rect, index) => ({ rect, index }))
      .filter(({ rect }) => rect.right > 0 && rect.left < innerWidth && rect.bottom > 0 && rect.top < innerHeight);
    const gaps = bounds.slice(1).map((rect, index) => rect.left - bounds[index].right);
    return {
      count: slides.length,
      visibleIndices: visible.map(({ index }) => index),
      visibleCards: visible.filter(({ index }) => Boolean(slides[index].querySelector('.carousel-card'))).length,
      visiblePosters: visible.filter(({ index }) => Boolean(slides[index].querySelector('.carousel-card img'))).length,
      minWidth: Math.min(...bounds.map(rect => rect.width)),
      maxWidth: Math.max(...bounds.map(rect => rect.width)),
      minHeight: Math.min(...bounds.map(rect => rect.height)),
      minGap: Math.min(...gaps),
      maxGap: Math.max(...gaps),
    };
  });
}

function assertDesktopRowGeometry(geometry, expectedCount, position) {
  assert.equal(geometry.count, expectedCount, `${position}: keep one stable shell per item`);
  assert.ok(geometry.visibleIndices.length >= 7, `${position}: fill the 1536px viewport`);
  assert.equal(geometry.visibleCards, geometry.visibleIndices.length, `${position}: no empty visible card slot`);
  assert.equal(geometry.visiblePosters, geometry.visibleIndices.length, `${position}: every visible card has a poster`);
  assert.ok(geometry.minWidth >= 180 && geometry.maxWidth <= 200, `${position}: stable desktop card width`);
  assert.ok(geometry.minHeight >= 280, `${position}: reserve poster height before mounting visuals`);
  assert.ok(geometry.minGap >= 0 && geometry.maxGap <= 24, `${position}: no horizontal hole between shells`);
}

async function readMemoryMetrics(context, page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  const [performanceMetrics, dom] = await Promise.all([
    cdp.send('Performance.getMetrics'),
    cdp.send('Memory.getDOMCounters'),
  ]);
  const values = Object.fromEntries(performanceMetrics.metrics.map(metric => [metric.name, metric.value]));
  await cdp.detach();
  return {
    jsHeapMb: Math.round((values.JSHeapUsedSize / 1024 / 1024) * 10) / 10,
    documents: dom.documents,
    nodes: dom.nodes,
    eventListeners: dom.jsEventListeners,
  };
}

async function waitForStableRequests(page, metrics) {
  let stableFor = 0;
  for (let attempt = 0; attempt < 60; attempt++) {
    const requestCount = metrics.requests.length;
    await page.waitForTimeout(250);
    if (metrics.active === 0 && metrics.requests.length === requestCount) {
      stableFor += 250;
      if (stableFor >= 500) return;
    } else {
      stableFor = 0;
    }
  }
  assert.fail(`metadata requests did not settle (${metrics.active} active, ${metrics.requests.length} started)`);
}

try {
  for (const mode of ['off', 'on']) {
    const { page, context, errors } = await open('sections', mode, { noIdle: true });
    await page.waitForFunction(() => window.loads.near === 1 && window.loads.immediate === 1);
    assert.equal(await page.evaluate(() => window.loads.far || 0), 0, 'distant sections stay deferred');
    assert.equal(await page.locator('[data-content="near"]').count(), 1, 'prepared 500px before the viewport');
    await page.evaluate(() => window.scrollTo(0, 3200));
    await page.waitForFunction(() => window.loads.far === 1);
    const mounts = await page.evaluate(() => ({ ...window.mounts }));
    await page.evaluate(() => { window.scrollTo(0, 0); window.settings.setLightModeSetting(window.settings.isLightMode ? 'off' : 'on'); });
    await page.waitForTimeout(100);
    assert.deepEqual(await page.evaluate(() => window.loads), { immediate: 1, near: 1, far: 1 });
    assert.deepEqual(await page.evaluate(() => window.mounts), mounts, 'loaded rows never remount on scroll/mode changes');
    assert.deepEqual(errors, []);
    results.push(`section anticipation and persistence: mode=${mode}, no requestIdleCallback`);
    await context.close();
  }
  {
    const { page, context, errors } = await open('sections', 'on', { noObserver: true, noIdle: true });
    await page.waitForFunction(() => window.loads.far === 1 && window.loads.near === 1);
    const scheduled = await page.evaluate(async () => {
      const calls = [];
      window.scheduleSectionLoad(() => calls.push(performance.now()));
      const cancel = window.scheduleSectionLoad(() => calls.push(-1)); cancel();
      await new Promise(resolve => window.scheduleSectionLoad(() => { calls.push(performance.now()); resolve(); }));
      return calls;
    });
    assert.equal(scheduled.length, 2);
    assert.ok(scheduled[1] - scheduled[0] >= 10, 'yield between row mounts');
    assert.deepEqual(errors, []);
    results.push('legacy TV fallback and cancelled section tasks');
    await context.close();
  }
  {
    const { page, context, metrics, errors } = await open('requests', 'on', { noIdle: true });
    await page.waitForFunction(() => Boolean(window.runRequests));
    assert.equal(metrics.requests.length, 0, 'disabled hooks do not fetch');
    await page.evaluate(() => window.runRequests());
    assert.equal(metrics.requests.length, 13, 'deduplicate queued and in-flight requests');
    assert.ok(metrics.peak <= 3, 'global request limit, including errors');
    assert.equal(await page.evaluate(() => window.cacheWrites), 0, 'no synchronous full-cache write per response');
    await page.waitForFunction(() => window.cacheWrites === 1);
    await page.evaluate(() => window.enableImages());
    await page.waitForFunction(() => document.getElementById('images').textContent.includes('localized.svg'));
    await page.evaluate(() => window.changeLanguage());
    await page.waitForTimeout(150);
    assert.ok(metrics.requests.some(url => url.includes('/999/images?en,null')));
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    assert.equal(await page.evaluate(() => window.cacheWrites), 2, 'pending cache persists on pagehide');
    assert.deepEqual(errors, []);
    results.push('metadata concurrency, deduplication, error recovery, batching and language change');
    await context.close();
  }
  {
    const { page, context, metrics, errors, releaseBlockedMetadata } = await open('queued-requests', 'on', {
      noIdle: true,
      blockedMetadataIds: [101, 102, 103],
    });
    await waitForMetric(page, () => metrics.active === 3, 'three metadata requests did not occupy the queue');
    assert.deepEqual(
      metrics.requests.map(url => Number(url.match(/\/movie\/(\d+)\/images/)?.[1])).sort((a,b)=>a-b),
      [101, 102, 103],
      'the three blockers occupy every metadata slot',
    );

    await page.evaluate(() => window.mountQueuedConsumers());
    await page.waitForFunction(() => window.queueState?.queued && window.queueEffects >= 8);
    await page.evaluate(() => { void window.prefetchQueuedMetadata(); });
    await page.evaluate(() => window.hideQueuedConsumers());
    await page.waitForFunction(() => window.queueState
      && !window.queueState.obsoleteEnabled
      && !window.queueState.mountedObsolete
      && !window.queueState.sharedFirstEnabled);
    await page.evaluate(() => window.mountNewCard());
    await page.waitForFunction(() => window.queueState?.newCard);

    releaseBlockedMetadata();
    await waitForStableRequests(page, metrics);
    const idsAfterRelease = metrics.requests
      .map(url => Number(url.match(/\/movie\/(\d+)\/images/)?.[1]))
      .sort((a,b)=>a-b);
    assert.deepEqual(
      idsAfterRelease,
      [101, 102, 103, 250, 301, 401],
      'skip obsolete queued hooks while keeping a shared consumer, a new card and explicit prefetch',
    );
    assert.equal(idsAfterRelease.filter(id => id === 250).length, 1, 'shared active consumers keep one deduplicated request');
    assert.ok(metrics.peak <= 3, `metadata request concurrency stays bounded (${metrics.peak}/3)`);

    await page.evaluate(() => window.revisitObsoleteCard());
    await waitForStableRequests(page, metrics);
    assert.equal(
      metrics.requests.filter(url => url.includes('/movie/201/images')).length,
      1,
      'revisiting a skipped card performs a real request instead of reading an empty cache entry',
    );
    assert.deepEqual(errors, []);
    results.push('obsolete queued metadata is skipped without losing active, shared or revisited cards');
    await context.close();
  }
  for (const mode of ['off', 'on']) {
    const { page, context, metrics, errors } = await open('carousels', mode, { noIdle: true });
    await page.waitForFunction(() => document.querySelectorAll('.embla-slide img.opacity-100').length >= 4);
    await page.waitForTimeout(400);
    assert.ok(metrics.requests.length < 50, `offscreen metadata stays deferred (${metrics.requests.length}/180)`);
    assert.ok(metrics.peak <= 3);
    const firstRequests = metrics.requests.length;
    await page.mouse.move(350, 180); await page.mouse.down();
    await page.mouse.move(30, 180, { steps: 12 }); await page.mouse.up();
    await page.waitForTimeout(400);
    assert.ok(metrics.requests.length > firstRequests, 'horizontal swipe prepares new cards');
    await page.evaluate(() => window.scrollTo(0, 1200));
    await page.waitForTimeout(500);
    assert.equal(await page.locator('[data-row="5"] .embla-slide').count(), 30);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(() => !document.body.classList.contains('embla-scrolling'));
    const favoriteSlide = await page.locator('[data-row="0"] .embla-slide button').evaluateAll(elements => {
      const button = elements.find(el => {
        const bounds = el.getBoundingClientRect();
        return bounds.left >= 0 && bounds.right <= innerWidth && bounds.bottom > 0 && bounds.top < innerHeight;
      });
      button?.click();
      return button ? [...document.querySelectorAll('[data-row="0"] .embla-slide')].indexOf(button.closest('.embla-slide')) : -1;
    });
    assert.ok(favoriteSlide >= 0, 'a visible favorite button remains interactive after returning vertically');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('watchlist_movie')).length), 1);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(100);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(index => document.querySelectorAll('[data-row="0"] .embla-slide')[index]?.querySelector('.carousel-card button'), favoriteSlide);
    assert.equal(
      await page.locator('[data-row="0"] .embla-slide').nth(favoriteSlide).locator('button').getAttribute('aria-label'),
      'profile.removeFromWatchlist',
      'favorite state survives visual unload/remount'
    );
    assert.equal(await page.locator('[data-row="0"] .carousel-card').first().evaluate(el => getComputedStyle(el).willChange), 'auto');
    assert.deepEqual(errors, []);
    results.push(`mobile carousel, swipe, scroll and favorite: mode=${mode}, peak=${metrics.peak}`);
    await context.close();
  }
  {
    const { page, context, metrics, errors } = await open('carousels', 'off', {
      noIdle: true,
      slowLocalizedPoster: true,
      context: { viewport: { width: 1536, height: 900 }, hasTouch: false },
    });
    await page.waitForFunction(() => {
      const poster = document.querySelector('[data-row="0"] .carousel-card img');
      return poster?.src.endsWith('/poster.svg') && poster.complete && poster.naturalWidth > 0;
    });
    await page.waitForFunction(() => {
      const poster = document.querySelector('[data-row="0"] .carousel-card img');
      return poster?.src.endsWith('/localized-slow.svg') && !poster.complete;
    });
    await page.waitForTimeout(200);
    assert.ok(
      await page.locator('[data-row="0"] .carousel-card img').first().evaluate(poster => Number.parseFloat(getComputedStyle(poster).opacity)) > 0.9,
      'localized poster swap keeps the already loaded poster visible'
    );
    const rowNames = ['0', '1', '2', '3', '4', '5', 'history'];
    for (const row of rowNames) {
      await page.locator(`[data-row="${row}"]`).evaluate(section => section.scrollIntoView({ block: 'center' }));
      await page.locator(`[data-row="${row}"] .embla-slide`).first().waitFor();
      await waitForVisiblePosters(page, row);
      const expectedCount = row === 'history' ? 5 : 30;
      assert.equal(await page.locator(`[data-row="${row}"] .embla-slide`).count(), expectedCount, `${row}: stable shell count`);
    }

    await page.locator('[data-row="0"]').evaluate(section => section.scrollIntoView({ block: 'center' }));
    await waitForVisiblePosters(page, 0);
    const start = await readRowGeometry(page, 0);
    assertDesktopRowGeometry(start, 30, 'carousel start');
    assert.equal(start.visibleIndices[0], 0, 'carousel starts on its first item');

    const next = page.locator('[data-row="0"] button[aria-label="common.next"]');
    for (let i = 0; i < 5; i++) {
      await next.evaluate(button => button.click());
      await page.waitForTimeout(100);
    }
    await page.waitForFunction(() => {
      const slides = [...document.querySelectorAll('[data-row="0"] .embla-slide')];
      const last = slides.at(-1)?.getBoundingClientRect();
      return last && last.left < innerWidth && last.right > 0;
    });
    await waitForVisiblePosters(page, 0);
    const end = await readRowGeometry(page, 0);
    assertDesktopRowGeometry(end, 30, 'carousel end');
    assert.equal(end.visibleIndices.at(-1), 29, 'carousel reaches its last item');
    await page.waitForFunction(() => document.querySelector('[data-row="0"] button[aria-label="common.next"]')?.disabled);
    await page.waitForFunction(() => !document.body.classList.contains('embla-scrolling'));
    await page.locator('[data-row="0"] .embla-slide').first().dispatchEvent('wheel', { deltaX: 500, deltaY: 0 });
    await page.waitForFunction(() => !document.body.classList.contains('embla-scrolling'), null, { timeout: 1000 });

    const previous = page.locator('[data-row="0"] button[aria-label="common.previous"]');
    for (let i = 0; i < 5; i++) {
      await previous.evaluate(button => button.click());
      await page.waitForTimeout(100);
    }
    await page.waitForFunction(() => {
      const first = document.querySelector('[data-row="0"] .embla-slide')?.getBoundingClientRect();
      return first && first.left >= 0 && first.left < 80;
    });
    await waitForVisiblePosters(page, 0);
    const returned = await readRowGeometry(page, 0);
    assertDesktopRowGeometry(returned, 30, 'carousel returned to start');
    assert.equal(returned.visibleIndices[0], 0, 'carousel returns to its first item');
    await page.waitForFunction(() => document.querySelector('[data-row="0"] button[aria-label="common.previous"]')?.disabled);
    await page.waitForFunction(() => !document.body.classList.contains('embla-scrolling'));
    await page.locator('[data-row="0"] .embla-slide').first().dispatchEvent('wheel', { deltaX: -500, deltaY: 0 });
    await page.waitForFunction(() => !document.body.classList.contains('embla-scrolling'), null, { timeout: 1000 });

    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    let keyboardFocus;
    for (let press = 0; press < 80; press++) {
      await page.keyboard.press('Tab');
      keyboardFocus = await page.evaluate(() => {
        const active = document.activeElement;
        const slide = active?.closest('[data-row="0"] .embla-slide');
        return slide && active?.tagName === 'A'
          ? { index: [...slide.parentElement.children].indexOf(slide), href: active.getAttribute('href') }
          : null;
      });
      if (keyboardFocus?.index >= 20) break;
      await page.waitForTimeout(20);
    }
    assert.ok(keyboardFocus?.index >= 20, 'Tab reaches a carousel link that started outside the viewport');
    await page.waitForFunction(index => {
      const slide = document.querySelectorAll('[data-row="0"] .embla-slide')[index];
      const poster = slide?.querySelector('.carousel-card img');
      return document.activeElement === slide?.querySelector('a') && poster?.complete && poster.naturalWidth > 0;
    }, keyboardFocus.index);

    await page.locator('[data-row="history"]').evaluate(section => section.scrollIntoView({ block: 'center' }));
    await waitForVisiblePosters(page, 'history');
    assert.equal(
      await page.evaluate(href => document.activeElement?.getAttribute('href') === href && Boolean(document.activeElement?.closest('.embla-slide')?.querySelector('.carousel-card img')), keyboardFocus.href),
      true,
      'keyboard focus and its card contents survive vertical scrolling'
    );
    assert.equal(
      await page.locator('[data-row="history"] .embla-slide').first().evaluate(slide => [...slide.querySelectorAll('div')].some(element => element.style.width === '50%')),
      true,
      'movie history renders saved playback progress'
    );
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await waitForStableRequests(page, metrics);
    await page.waitForTimeout(100);
    const dom = await page.evaluate(() => ({
      shells: document.querySelectorAll('.embla-slide').length,
      cards: document.querySelectorAll('.carousel-card').length,
      images: document.querySelectorAll('.carousel-card img').length,
      firstRowCards: document.querySelectorAll('[data-row="0"] .carousel-card').length,
    }));
    const memory = await readMemoryMetrics(context, page);
    console.log(JSON.stringify({ desktopCarouselMetrics: { ...dom, ...memory, metadataRequests: metrics.requests.length } }));
    assert.equal(dom.shells, 185, 'all item shells remain available to Embla');
    assert.ok(dom.firstRowCards < 30, 'visuals unmount again when their row leaves the viewport');
    assert.ok(dom.cards <= 96, `active carousel cards stay bounded after visiting every row (${dom.cards}/185)`);
    assert.ok(dom.images <= 192, `active carousel images stay bounded after visiting every row (${dom.images})`);
    assert.deepEqual(errors, []);
    results.push(`desktop geometry, ends, reversible visuals and memory budget: cards=${dom.cards}/185, images=${dom.images}, heap=${memory.jsHeapMb}MB`);
    await context.close();
  }
  console.log(JSON.stringify({ passed: results.length, results }, null, 2));
} finally {
  await browser.close();
  await rm(work, { recursive: true, force: true });
}
