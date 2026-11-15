/**
 * Vérifie le vrai EmblaCarouselPlatforms quand le repli Flexbox applique ses
 * marges après le commit React. Aucun serveur ni accès à un média distant.
 *
 * Exécution :
 *   FLEX_GAP_LEGACY_CHROMIUM=<chrome.exe antérieur à 84> \
 *   CODEX_PRIMARY_RUNTIME_NODE_MODULES=<node_modules avec Playwright> \
 *   node tests/flexGapCarousel.browser.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
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
const work = process.env.FLEX_GAP_CAROUSEL_REPORT_DIR || process.env.FLEX_GAP_REPORT_DIR
  || await mkdtemp(path.join(tmpdir(), 'movix-flex-gap-carousel-'));
await mkdir(work, { recursive: true });

const componentPath = path.join(repo, 'src/components/EmblaCarouselPlatforms.tsx');
const helperPath = path.join(repo, 'src/utils/flexGapSupport.ts');
const emblaPath = path.join(repo, 'node_modules/embla-carousel/esm/embla-carousel.esm.js');
const shim = (name) => path.join(work, name);
const baseline = process.env.FLEX_GAP_BASELINE === '1';

await writeFile(shim('light-mode.ts'), `
export const useLightMode=()=>({effectivePrefs:{transitions:false,bgAnimations:false}});
`, 'utf8');
await writeFile(shim('prefetch-link.tsx'), `
import React from 'react';
export const PrefetchLink=({to,children,...props})=><a href={to} {...props}>{children}</a>;
`, 'utf8');
await writeFile(shim('i18n.ts'), `
export const useTranslation=()=>({t:(key)=>key});
`, 'utf8');
await writeFile(shim('embla-proxy.ts'), `
import EmblaCarousel from ${JSON.stringify(emblaPath)};
const instrumented=(root,options,plugins)=>{
  const api=EmblaCarousel(root,options,plugins);
  window.__embla=api;
  window.__emblaEvents.push({type:'create',at:performance.now(),snaps:api.internalEngine().scrollSnaps.slice()});
  const reInit=api.reInit.bind(api);
  api.reInit=(...args)=>{
    const result=reInit(...args);
    window.__emblaEvents.push({type:'reInit',at:performance.now(),snaps:api.internalEngine().scrollSnaps.slice()});
    return result;
  };
  api.on('select',()=>window.__emblaEvents.push({type:'select',at:performance.now(),index:api.selectedScrollSnap()}));
  return api;
};
Object.defineProperty(instrumented,'globalOptions',{
  get:()=>EmblaCarousel.globalOptions,
  set:(value)=>{EmblaCarousel.globalOptions=value;},
});
export default instrumented;
`, 'utf8');
await writeFile(shim('entry.tsx'), `
import React from 'react';
import {createRoot} from 'react-dom/client';
import EmblaCarouselPlatforms from ${JSON.stringify(componentPath)};
import {initFlexGapSupport} from ${JSON.stringify(helperPath)};

window.__emblaEvents=[];
window.__styleEvents=[];
new MutationObserver(records=>{
  for(const record of records){
    if(record.type==='attributes' && record.attributeName==='style'){
      const target=record.target;
      if(target.closest?.('[data-carousel-fixture]')){
        window.__styleEvents.push({at:performance.now(),className:target.className,style:target.getAttribute('style')});
      }
    }
  }
}).observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:['style']});

const pixel='data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/%3E';
const items=Array.from({length:8},(_,index)=>({
  id:index+1,src:pixel,alt:'Plateforme '+(index+1),route:'/platform/'+(index+1)
}));

initFlexGapSupport();
createRoot(document.getElementById('root')).render(
  <main data-carousel-fixture><EmblaCarouselPlatforms title="Plateformes" items={items}/></main>
);
`, 'utf8');

await build({
  entryPoints: [shim('entry.tsx')],
  outfile: shim('app.js'),
  bundle: true,
  format: 'iife',
  target: 'chrome83',
  jsx: 'automatic',
  nodePaths: [path.join(repo, 'node_modules')],
  alias: { '@': path.join(repo, 'src') },
  plugins: [{
    name: 'carousel-fixture-shims',
    setup(builder) {
      builder.onResolve({ filter: /^embla-carousel$/ }, () => ({ path: shim('embla-proxy.ts') }));
      builder.onResolve({ filter: /LightModeContext$/ }, () => ({ path: shim('light-mode.ts') }));
      builder.onResolve({ filter: /PrefetchLink$/ }, () => ({ path: shim('prefetch-link.tsx') }));
      builder.onResolve({ filter: /^react-i18next$/ }, () => ({ path: shim('i18n.ts') }));
      if (baseline) {
        builder.onResolve({ filter: /flexGapSupport(?:\.[cm]?[jt]sx?)?$/ }, () => ({ path: 'flex-gap-baseline', namespace: 'fixture' }));
        builder.onLoad({ filter: /^flex-gap-baseline$/, namespace: 'fixture' }, () => ({
          contents: `
            export const FLEX_GAP_UPDATED_EVENT='movix:flex-gap-updated';
            export const getFlexGapLayoutRevision=()=>0;
            export function initFlexGapSupport(){}
          `,
          loader: 'js',
        }));
      }
    },
  }],
});

const css = `
*{box-sizing:border-box}html,body,#root{margin:0;width:100%;min-height:100%;overflow-x:hidden}
body{font:16px Arial;background:#15151d;color:white}main{width:760px;max-width:100%;margin:40px auto}
.w-full{width:100%}.relative{position:relative}.block{display:block}.flex{display:flex}.hidden{display:none}
.flex-none{flex:none}.gap-6{gap:1.5rem}.overflow-visible{overflow:visible}.select-none{user-select:none}
.pr-8{padding-right:2rem}.pl-4{padding-left:1rem}.py-8{padding-top:2rem;padding-bottom:2rem}
.w-8{width:2rem}.w-12{width:3rem}.h-32{height:8rem}.w-\\[250px\\]{width:250px}.h-\\[150px\\]{height:150px}
.absolute{position:absolute}.left-6{left:1.5rem}.right-6{right:1.5rem}.top-1\\/2{top:50%}.z-20{z-index:20}
.pointer-events-none{pointer-events:none}.pointer-events-auto{pointer-events:auto}.\\!opacity-0{opacity:0!important}
.bg-white{background:#fff}.rounded-xl{border-radius:.75rem}.items-center{align-items:center}.justify-center{justify-content:center}
@media(min-width:768px){.md\\:flex{display:flex}.md\\:pr-16{padding-right:4rem}.md\\:pl-6{padding-left:1.5rem}.md\\:w-24{width:6rem}.md\\:left-8{left:2rem}.md\\:right-8{right:2rem}}
@media(max-width:767px){.gap-6{gap:.75rem}}
`;
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`;
const app = await readFile(shim('app.js'));
const executablePath = process.env.FLEX_GAP_LEGACY_CHROMIUM;

const browser = await chromium.launch({ headless: true, executablePath });
const context = await browser.newContext({ viewport: { width: 1024, height: 600 } });
await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
await context.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.hostname !== 'flex-carousel.test') return route.abort();
  return route.fulfill({
    contentType: url.pathname === '/app.js' ? 'text/javascript' : 'text/html',
    body: url.pathname === '/app.js' ? app : html,
  });
});

const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
const measure = () => page.evaluate(() => {
  const viewport = document.querySelector('[data-carousel-fixture] .overflow-visible');
  const container = viewport?.firstElementChild;
  const slides = [...(container?.children || [])].slice(0, -1);
  const rect = element => {
    const value = element.getBoundingClientRect();
    return { left:value.left, right:value.right, width:value.width, top:value.top, bottom:value.bottom };
  };
  const slideRects = slides.map(rect);
  return {
    rootClass: document.documentElement.className,
    viewport: rect(viewport),
    container: rect(container),
    slides: slideRects,
    gaps: slideRects.slice(1).map((value,index)=>value.left-slideRects[index].right),
    margins: slides.map(slide=>({left:getComputedStyle(slide).marginLeft,right:getComputedStyle(slide).marginRight})),
    snaps: window.__embla.internalEngine().scrollSnaps.slice(),
    selected: window.__embla.selectedScrollSnap(),
    canScrollPrev: window.__embla.canScrollPrev(),
    canScrollNext: window.__embla.canScrollNext(),
    events: window.__emblaEvents.slice(),
    styleEvents: window.__styleEvents.slice(),
  };
});

try {
  await page.goto('http://flex-carousel.test/');
  await page.waitForFunction(() => Boolean(window.__embla));
  await settle();
  const initial = await measure();

  const next = page.locator('button[aria-label="common.next"]');
  const visited = [initial.selected];
  for (let index = 0; index < 4 && await next.isEnabled(); index += 1) {
    if (!await page.evaluate(() => window.__embla.canScrollNext())) break;
    await next.click({ force: true });
    await settle();
    visited.push(await page.evaluate(() => window.__embla.selectedScrollSnap()));
  }
  const afterButtons = await measure();

  await page.evaluate(() => window.__embla.scrollTo(0, true));
  await page.setViewportSize({ width: 700, height: 600 });
  await settle();
  const afterResponsiveGap = await measure();
  const responsiveVisited = [afterResponsiveGap.selected];
  for (let index = 0; index < 12; index += 1) {
    if (!await page.evaluate(() => window.__embla.canScrollNext())) break;
    await page.evaluate(() => window.__embla.scrollNext(true));
    await settle();
    responsiveVisited.push(await page.evaluate(() => window.__embla.selectedScrollSnap()));
  }
  const afterResponsiveButtons = await measure();

  const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 0.8, `${message}: attendu ${expected}, observé ${actual}`);
  const expectedGap = baseline ? 0 : 24;
  const expectedStep = 250 + expectedGap;
  initial.gaps.forEach(gap => near(gap, expectedGap, 'gap DOM initial'));
  assert.ok(visited.length >= 2 && visited.at(-1) > 0, 'le bouton suivant doit changer le snap');
  assert.equal(afterButtons.canScrollNext, false, 'le dernier snap doit désactiver la flèche suivante');
  assert.ok(afterButtons.slides.at(-1).right <= afterButtons.viewport.right + 0.8, 'le dernier élément doit être entièrement visible au dernier snap');
  const responsiveGap = baseline ? 0 : 12;
  afterResponsiveGap.gaps.forEach(gap => near(gap, responsiveGap, 'gap DOM responsive'));
  assert.equal(afterResponsiveButtons.canScrollNext, false, 'la flèche responsive doit atteindre la fin');
  assert.ok(afterResponsiveButtons.slides.at(-1).right <= afterResponsiveButtons.viewport.right + 0.8, 'le dernier élément responsive doit être entièrement visible');
  assert.deepEqual(pageErrors, [], 'aucune erreur JavaScript');

  // Le premier snap inclut le padding de début du conteneur ; comparer deux
  // snaps intérieurs isole bien largeur de carte + espacement.
  const snapStepBefore = initial.snaps.length > 2 ? Math.abs(initial.snaps[2] - initial.snaps[1]) : 0;
  const responsiveSnapStep = afterResponsiveGap.snaps.length > 2
    ? Math.abs(afterResponsiveGap.snaps[2] - afterResponsiveGap.snaps[1])
    : 0;
  near(snapStepBefore, expectedStep, 'pas Embla initial');
  near(responsiveSnapStep, 250 + responsiveGap, 'pas Embla responsive');
  const report = {
    browser: browser.version(),
    baseline,
    expectedStep,
    snapStepBefore,
    responsiveSnapStep,
    staleInitial: Math.abs(snapStepBefore - expectedStep) > 0.8,
    visited,
    responsiveVisited,
    initial,
    afterButtons,
    afterResponsiveGap,
    afterResponsiveButtons,
    pageErrors,
  };
  await writeFile(shim('report.json'), JSON.stringify(report, null, 2), 'utf8');
  await writeFile(shim('report.md'), `# Embla et repli Flexbox\n\nCommande : \`node tests/flexGapCarousel.browser.mjs\`. Prérequis : dépendances npm et Playwright/Chromium. \`FLEX_GAP_LEGACY_CHROMIUM\` choisit le moteur ancien, \`CODEX_PRIMARY_RUNTIME_NODE_MODULES\` peut fournir Playwright, \`FLEX_GAP_REPORT_DIR\` conserve les artefacts. Aucun serveur ni compte ; médias locaux, vrai EmblaCarouselPlatforms avec CSS de disposition isolée.\n\nNavigateur : ${report.browser}\n\n- Mode : ${baseline ? 'témoin sans repli' : 'repli réel'}\n- Pas Embla initial attendu/observé : ${expectedStep}/${snapStepBefore} px\n- Pas responsive attendu/observé : ${250 + responsiveGap}/${responsiveSnapStep} px\n- Snaps initiaux obsolètes : ${report.staleInitial ? 'oui' : 'non'}\n- Index visités par la flèche : ${visited.join(', ')}\n- Index responsive : ${responsiveVisited.join(', ')}\n- Dernier élément entièrement visible : oui\n\nLes mesures complètes sont dans report.json ; la trace et la capture permettent de reproduire le résultat.\n`, 'utf8');
  await page.screenshot({ path: shim('legacy-responsive-end.png'), fullPage: true });
  console.log(JSON.stringify({ report:shim('report.md'), browser:report.browser, snapStepBefore, responsiveSnapStep, staleInitial:report.staleInitial, visited, responsiveVisited }, null, 2));
} catch (error) {
  await writeFile(shim('report.json'), JSON.stringify({ status:'failed', browser:browser.version(), error:error.message, pageErrors, observed:await measure().catch(()=>null) },null,2));
  await writeFile(shim('report.md'), `# Échec du contrôle Embla\n\nCommande : \`node tests/flexGapCarousel.browser.mjs\`. Dépendances npm et Playwright/Chromium nécessaires ; \`FLEX_GAP_LEGACY_CHROMIUM\` sélectionne l'ancien moteur. Fixture locale sans réseau extérieur ni compte.\n\nAttendu : espaces de 24 puis 12 px, positions Embla correspondantes et dernière carte visible après navigation. Observé : ${error.message}.\n\nMesures : report.json. Capture et trace jointes.\n`);
  await page.screenshot({path:shim('failed.png'),fullPage:true}).catch(()=>{});
  throw error;
} finally {
  await context.tracing.stop({ path: shim('legacy.trace.zip') });
  await browser.close();
}
