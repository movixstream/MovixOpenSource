/**
 * Real layout verification, without a server or external requests.
 * Run: node tests/flexGapLayout.browser.mjs
 * Requires esbuild, Playwright + Chromium; CODEX_PRIMARY_RUNTIME_NODE_MODULES
 * can supply Playwright. FLEX_GAP_LEGACY_CHROMIUM points to Chromium < 84.
 * FLEX_GAP_REPORT_DIR retains report, screenshots and traces, including failures.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const runtimeRequire = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ? createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'package.json')) : require;
const { chromium } = runtimeRequire('playwright');
const work = process.env.FLEX_GAP_REPORT_DIR || await mkdtemp(path.join(tmpdir(), 'movix-flex-layout-'));
await mkdir(work, { recursive: true });
await build({
  stdin: { contents: `import {initFlexGapSupport} from ${JSON.stringify(path.join(repo, 'src/utils/flexGapSupport.ts'))};
    window.startGapFallback=location.search.includes('baseline')?()=>{}:initFlexGapSupport;
    if(!location.search.includes('baseline'))initFlexGapSupport();`, resolveDir: repo },
  outfile: path.join(work, 'app.js'), bundle: true, format: 'iife', target: 'chrome80',
});
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box}body{margin:20px;font:16px Arial;background:#15151d;color:white}
section{margin:16px 0;padding:10px;background:#242430}h2{font-size:14px;margin:0 0 8px}
.row{display:flex;gap:12px}.item{width:40px;height:24px;flex:none;background:#ce2342}
.column{display:flex;flex-direction:column;row-gap:10px;column-gap:4px}
.raw{display:inline-flex;gap:8px;background:#406080;padding:8px;border:2px solid transparent}
.raw i{width:20px;height:20px;flex:none;background:#acddff}
.hidden{display:none}.absolute{position:absolute;top:0;left:0}
.nested{display:flex;gap:16px}.nested>div{display:flex;gap:5px}
.grid{display:grid;grid-template-columns:40px 40px;gap:9px;width:89px}
.responsive{display:flex;flex-direction:column;gap:6px}
@media(min-width:700px){.responsive{flex-direction:row;gap:20px}}
[data-density=compact] .density{gap:4px}.density{display:flex;gap:14px}
[data-state=closed]{display:none}
#transition button{padding:0;border:0;transition:all 250ms linear,opacity 500ms ease;background:black}
#transition button.active{background:white}
#hover-only button{padding:0;border:0;background:black}
#hover-only button:hover{background:white;transition:background-color 250ms linear}
</style></head><body>
<section><h2>Rangée, masqués et position absolue</h2><div id="row" class="row" style="position:relative"><b class="item hidden"></b><b class="item" id="row-a"></b><b class="item absolute" style="top:-10px;width:5px;height:5px"></b><b class="item" id="row-b"></b></div></section>
<section><h2>Colonne</h2><div id="column" class="column"><b class="item"></b><b class="item"></b><b class="item"></b></div></section>
<section><h2>Texte anonyme</h2><button id="raw" class="raw">Avant<i></i>Après</button></section>
<section><h2>Directions et ordre</h2><div id="reverse" class="row" style="flex-direction:row-reverse;width:200px"><b class="item"></b><b class="item"></b></div><div id="rtl" class="row" dir="rtl" style="width:200px"><b class="item"></b><b class="item"></b></div><div id="order" class="row"><b class="item" style="order:2"></b><b class="item" style="order:0"></b><b class="item" style="order:1"></b></div></section>
<section><h2>Imbrication et grille</h2><div id="nested" class="nested"><div><b class="item"></b><b class="item"></b></div><div><b class="item"></b><b class="item"></b></div></div><div id="grid" class="grid"><b class="item"></b><b class="item"></b><b class="item"></b></div></section>
<section><h2>Marges existantes et automatiques</h2><div id="margin" class="row" style="gap:8px"><b class="item" style="margin-right:3px!important"></b><b class="item"></b></div><div id="auto" class="row" style="width:320px"><b class="item" style="margin-right:auto"></b><b class="item"></b></div></section>
<section><h2>Retours à la ligne</h2><div id="wrap" class="row" style="flex-wrap:wrap;gap:10px;width:150px"><b class="item" style="width:60px"></b><b class="item" style="width:60px"></b><b class="item" style="width:60px"></b><b class="item" style="width:60px"></b></div></section>
<section><h2>Boutons avec transition CSS</h2><div id="transition" class="row"><button class="item"></button><button class="item"></button></div></section>
<section><h2>Transition activée au survol</h2><div id="hover-only" class="row"><button class="item"></button><button class="item"></button></div></section>
<section><h2>Changements responsive et états</h2><div id="responsive" class="responsive"><b class="item"></b><b class="item"></b></div><div id="density" class="density"><b class="item"></b><b class="item"></b></div><div id="state" class="row"><b class="item"></b><b class="item" data-state="closed"></b><b class="item"></b></div></section>
<div id="parking"></div><script src="/app.js"></script></body></html>`;
await writeFile(path.join(work, 'index.html'), html);
const results = [];
const executables = [{ name: 'modern', path: process.env.CHROMIUM_EXECUTABLE_PATH }];
if (process.env.FLEX_GAP_LEGACY_CHROMIUM) executables.push({ name: 'legacy', path: process.env.FLEX_GAP_LEGACY_CHROMIUM });

for (const executable of executables) {
  const browser = await chromium.launch({ headless: true, executablePath: executable.path || undefined });
  const context = await browser.newContext({ viewport: { width: 960, height: 1100 } });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'flex-layout.test') return route.abort();
    return route.fulfill({ contentType: url.pathname === '/app.js' ? 'text/javascript' : 'text/html', body: url.pathname === '/app.js' ? await readFile(path.join(work, 'app.js')) : html });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const result = { browser: executable.name, version: browser.version(), cases: [] };
  async function check(name, fn) {
    try { const observed = await fn(); result.cases.push({ name, status: 'passed', observed }); }
    catch (error) { result.cases.push({ name, status: 'failed', error: error.message }); }
  }
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
  const rects = selector => page.locator(selector).evaluateAll(elements => elements.map(e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; }));
  const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 0.7, `${message}: attendu ${expected}, observé ${actual}`);
  try {
    await page.goto(`http://flex-layout.test/${process.env.FLEX_GAP_BASELINE ? '?baseline' : ''}`);
    await settle();
    await check('espace horizontal avec enfants masqués et absolus', async () => {
      const r = await rects('#row-a,#row-b'); near(r[1].x - r[0].right, 12, 'intervalle horizontal');
      near((await rects('#row .absolute'))[0].x, (await rects('#row'))[0].x, 'enfant absolu'); return r;
    });
    await check('colonne', async () => { const r = await rects('#column>*'); near(r[1].y-r[0].bottom,10,'intervalle vertical'); near(r[2].y-r[1].bottom,10,'deuxième intervalle'); return r; });
    await check('texte avant et après une icône sans wrapper DOM', async () => {
      const r = await page.locator('#raw').evaluate(el => Array.from(el.childNodes).map(node => { const range = document.createRange(); range.selectNode(node); const r = range.getBoundingClientRect(); return {x:r.x,right:r.right,type:node.nodeType}; }));
      assert.deepEqual(r.map(n=>n.type),[3,1,3]); near(r[1].x-r[0].right,8,'texte–icône'); near(r[2].x-r[1].right,8,'icône–texte'); return r;
    });
    for (const id of ['reverse','rtl','order']) await check(id, async () => { const r = (await rects(`#${id}>*`)).sort((a,b)=>a.x-b.x); for(let i=1;i<r.length;i++)near(r[i].x-r[i-1].right,12,id); return r; });
    await check('flex imbriqués', async () => { const outer=await rects('#nested>div'); const inner=await rects('#nested>div:first-child>*'); near(outer[1].x-outer[0].right,16,'extérieur'); near(inner[1].x-inner[0].right,5,'intérieur'); return {outer,inner}; });
    await check('grille intacte', async () => { const r=await rects('#grid>*'); near(r[1].x-r[0].right,9,'colonnes grid'); near(r[2].y-r[0].bottom,9,'lignes grid'); assert.equal(await page.locator('#grid>*').first().getAttribute('style'),null); return r; });
    await check('marge numérique et priorité conservées', async () => { const r=await rects('#margin>*'); near(r[1].x-r[0].right,11,'marge + gap'); return r; });
    await check('marge automatique conserve l’alignement à droite', async () => { const c=(await rects('#auto'))[0]; const r=await rects('#auto>*'); near(r[1].right,c.right,'alignement'); assert.equal(await page.locator('#auto>*').first().evaluate(e=>e.style.marginRight),'auto'); return r; });
    await check('wrap sans chevauchement ni déplacement du parent', async () => { const c=(await rects('#wrap'))[0]; const r=await rects('#wrap>*'); near(c.width,150,'largeur parent'); near(r[0].x,c.x,'origine'); near(r[1].x-r[0].right,10,'espace dans la ligne'); near(r[2].y-r[0].bottom,10,'espace entre lignes'); return r; });
    await check('transition-all sans cumul de marge et avec animation de couleur', async () => {
      const samples=[];
      for(let i=0;i<5;i++) {
        await page.locator('#transition button').first().evaluate((e,i)=>e.classList.toggle('active',i%2===0),i);
        await page.waitForTimeout(65);
        const r=await rects('#transition>*'); const gap=r[1].x-r[0].right; samples.push(gap); near(gap,12,'marge stable après changement de classe');
      }
      const color=await page.locator('#transition button').first().evaluate(e=>getComputedStyle(e).backgroundColor);
      const channels=color.match(/[\d.]+/g).map(Number); assert.ok(channels[0]>0&&channels[0]<255,'la transition de couleur continue');
      return {samples,color};
    });
    await check('transition ajoutée uniquement au survol préservée', async () => {
      await page.locator('#hover-only button').first().hover(); await page.waitForTimeout(65);
      const color=await page.locator('#hover-only button').first().evaluate(e=>getComputedStyle(e).backgroundColor);
      const channel=Number(color.match(/[\d.]+/)[0]); assert.ok(channel>0&&channel<255,`couleur intermédiaire attendue, observé ${color}`);
      return color;
    });
    await check('responsive grand écran', async () => { const r=await rects('#responsive>*'); near(r[1].x-r[0].right,20,'gap desktop'); return r; });
    await page.setViewportSize({width:540,height:1100}); await settle();
    await check('responsive petite largeur', async () => { const r=await rects('#responsive>*'); near(r[1].y-r[0].bottom,6,'gap mobile'); near(r[1].x,r[0].x,'ancienne marge horizontale supprimée'); return r; });
    await page.evaluate(() => { document.documentElement.dataset.density='compact'; document.querySelector('#state>[data-state]').dataset.state='open'; document.querySelector('#margin').firstElementChild.style.setProperty('margin-right','6px','important'); }); await settle();
    await check('attribut ancêtre, état et modification de marge', async () => { const d=await rects('#density>*'); near(d[1].x-d[0].right,4,'classe ancêtre'); const s=await rects('#state>*'); near(s[1].x-s[0].right,12,'enfant révélé'); near(s[2].x-s[1].right,12,'suivant'); const m=await rects('#margin>*'); near(m[1].x-m[0].right,14,'marge modifiée'); return {d,s,m}; });
    await page.evaluate(() => { document.querySelector('#responsive').style.gap='0'; document.querySelector('#parking').appendChild(document.querySelector('#margin').firstElementChild); const portal=document.createElement('div'); portal.id='portal'; portal.className='row'; portal.innerHTML='<b class="item"></b><b class="item"></b>'; document.body.appendChild(portal); }); await settle();
    await check('gap supprimé, nœud déplacé et portail', async () => { const r=await rects('#responsive>*'); near(r[1].y-r[0].bottom,0,'gap supprimé'); const p=await rects('#portal>*'); near(p[1].x-p[0].right,12,'portail'); assert.equal(await page.locator('#parking>*').evaluate(e=>e.style.marginRight),'6px'); return {r,p}; });
    await page.evaluate(() => { document.querySelector('#raw').firstChild.data=''; }); await settle();
    await check('texte devenu vide sans toucher au DOM React', async () => { const r=await rects('#raw,#raw i'); near(r[1].x-r[0].x,10,'padding du bouton sans marge devenue inutile'); return r; });
    await page.evaluate(() => { const el=document.querySelector('#responsive'); el.className='grid'; el.style.removeProperty('gap'); window.startGapFallback(); }); await settle();
    await check('passage Flex vers Grid et initialisation répétée', async () => { const r=await rects('#responsive>*'); near(r[1].x-r[0].right,9,'gap Grid sans marge héritée'); const p=await rects('#portal>*'); near(p[1].x-p[0].right,12,'gap non cumulé'); return {r,p}; });
    await check('animations transform/opacité sans recalcul permanent', async () => {
      const count=await page.evaluate(async () => { let calls=0; const original=window.getComputedStyle; window.getComputedStyle=function(...args){calls++;return original.apply(this,args)}; for(let i=0;i<5;i++){document.querySelector('#row-a').style.transform='translateY('+i+'px)'; document.querySelector('#row-a').style.opacity=String(.5+i/10); await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));} window.getComputedStyle=original; return calls; }); assert.equal(count,0,'aucun scan dû à une animation'); return count;
    });
    await check('aucune erreur JavaScript', async () => { assert.deepEqual(errors,[]); return errors; });
    await page.screenshot({ path: path.join(work, `${executable.name}.png`), fullPage:true });
  } finally {
    await context.tracing.stop({ path: path.join(work, `${executable.name}.trace.zip`) });
    await browser.close(); results.push(result);
  }
}
await writeFile(path.join(work,'report.json'),JSON.stringify(results,null,2));
await writeFile(path.join(work,'report.md'),`# Vérification du repli Flexbox\n\nCommande : \`node tests/flexGapLayout.browser.mjs\`\n\nPrérequis : dépendances npm, Playwright/Chromium ; \`FLEX_GAP_LEGACY_CHROMIUM\` pour Chromium < 84. Aucun compte, média ni service externe. Fixtures HTML/CSS locales : rangées, colonnes, Grid, texte brut, marges auto, wrap, portails, responsive et mutations.\n\nMode : ${process.env.FLEX_GAP_BASELINE?'sans correction (témoin)':'correction réelle'}. Le wrap conserve volontairement une petite gouttière extérieure sur ancien moteur.\n\n${results.map(r=>`## ${r.browser} ${r.version}\n\n`+r.cases.map(c=>`- ${c.status==='passed'?'OK':'ÉCHEC'} — ${c.name}${c.error?': '+c.error:''}`).join('\n')).join('\n\n')}\n\nLes mesures attendues et observées sont dans report.json ; captures PNG et traces Playwright jointes.\n`);
console.log(JSON.stringify({report:path.join(work,'report.md'),results:results.map(r=>({browser:r.browser,version:r.version,passed:r.cases.filter(c=>c.status==='passed').length,failed:r.cases.filter(c=>c.status==='failed')}))},null,2));
if(results.some(r=>r.cases.some(c=>c.status==='failed')))process.exitCode=1;
