/**
 * Vérification navigateur du repli commun de `gap` en Flexbox.
 *
 * Aucun serveur, compte ou média distant. Les vrais HLSPlayer et
 * LikeDislikeButton sont montés dans une page construite par esbuild. Le mode
 * legacy peut utiliser un ancien Chromium sans flex-gap via
 * FLEX_GAP_LEGACY_CHROMIUM ; sinon la perte du layout natif est simulée
 * sans masquer rowGap/columnGap au code de repli.
 *
 * Exécution : node tests/flexGap.browser.mjs
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
  ? createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'package.json'))
  : require;
const { chromium } = runtimeRequire('playwright');
const work = process.env.FLEX_GAP_REPORT_DIR
  || await mkdtemp(path.join(tmpdir(), 'movix-flex-gap-'));
const baselineWithoutHelper = process.env.FLEX_GAP_BASELINE === '1';
await mkdir(work, { recursive: true });

const source = (file) => JSON.stringify(path.join(repo, 'src', file));
await writeFile(path.join(work, 'entry.tsx'), `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import i18next from 'i18next';
import {I18nextProvider} from 'react-i18next';
import HLSPlayer from ${source('components/HLSPlayer')};
import LikeDislikeButton from ${source('components/LikeDislikeButton')};
import {LightModeProvider} from ${source('context/LightModeContext')};
import {initFlexGapSupport} from ${source('utils/flexGapSupport')};

function App(){
  return <main data-flex-gap-fixture>
    <section data-fixture="quality">
      <h2>Menu qualité réel</h2>
      <HLSPlayer
        src="fixture://media/source-a.mp4"
        autoPlay={false}
        onlyQualityMenu
        mp4Sources={[
          {url:'fixture://media/source-a.mp4',label:'1080p',language:'FR'},
          {url:'fixture://media/source-b.mp4',label:'720p',language:'FR'},
        ]}
      />
    </section>
    <section data-fixture="controls">
      <h2>Contrôles HLS réels</h2>
      <div className="player-frame">
        <HLSPlayer src="" autoPlay={false} controls />
      </div>
    </section>
    <section data-fixture="likes">
      <h2>Votes réels</h2>
      <LikeDislikeButton contentType="movie" contentId="gap-fixture" />
    </section>
  </main>;
}

initFlexGapSupport();
i18next.init({
  lng:'fr',
  resources:{fr:{translation:{}}},
  interpolation:{escapeValue:false},
  returnNull:false,
}).then(()=>{
  createRoot(document.getElementById('root')).render(
    <MemoryRouter>
      <I18nextProvider i18n={i18next}>
        <LightModeProvider><App/></LightModeProvider>
      </I18nextProvider>
    </MemoryRouter>
  );
});
`);

await build({
  entryPoints: [path.join(work, 'entry.tsx')],
  outfile: path.join(work, 'app.js'),
  bundle: true,
  format: 'esm',
  target: 'chrome83',
  jsx: 'automatic',
  nodePaths: [path.join(repo, 'node_modules')],
  alias: { '@': path.join(repo, 'src') },
  define: {
    'import.meta.env': JSON.stringify({
      VITE_MAIN_API: 'http://gap.test',
      VITE_PROXIES_EMBED_API: 'http://gap.test/proxy',
      VITE_SITE_URL: 'http://gap.test',
      VITE_TMDB_API_KEY: '',
    }),
  },
  plugins: [{
    name: 'fixture-contexts',
    setup(builder) {
      if (baselineWithoutHelper) {
        builder.onResolve({ filter: /flexGapSupport$/ }, ({ path: modulePath }) => ({
          path: modulePath,
          namespace: 'fixture-flex-gap-helper',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture-flex-gap-helper' }, () => ({
          contents: 'export function initFlexGapSupport(){}',
          loader: 'js',
        }));
      }
      builder.onResolve({ filter: /ProfileContext$/ }, ({ path: modulePath }) => ({
        path: modulePath,
        namespace: 'fixture-context',
      }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture-context' }, () => ({
        contents: `
          import React from 'react';
          export const useProfile=()=>({currentProfile:null});
          export const ProfileProvider=({children})=>React.createElement(React.Fragment,null,children);
        `,
        loader: 'js',
        resolveDir: repo,
      }));
    },
  }],
});

await writeFile(path.join(work, 'tailwind.css'), '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n');
execFileSync(process.execPath, [
  path.join(repo, 'node_modules/tailwindcss/lib/cli.js'),
  '-c', path.join(repo, 'tailwind.config.js'),
  '-i', path.join(work, 'tailwind.css'),
  '-o', path.join(work, 'ui.css'),
  '--content', 'src/components/{HLSPlayer,HLSPlayerSettingsPanel,LikeDislikeButton,ui/PinButton,ui/counter}.tsx',
], { cwd: repo, stdio: 'pipe' });

await writeFile(path.join(work, 'fixture.css'), `
html,body,#root{min-height:100%;margin:0}
body{background:#09090b;color:#fff;font-family:Arial,sans-serif}
[data-flex-gap-fixture]{box-sizing:border-box;width:100%;padding:24px;display:grid;grid-template-columns:minmax(0,520px) minmax(0,720px);gap:28px;align-items:start}
[data-fixture]{min-width:0;border:1px solid #3f3f46;border-radius:12px;background:#18181b;padding:16px}
[data-fixture]>h2{margin:0 0 14px;font-size:16px}
[data-fixture="likes"]{grid-column:1/-1}
.player-frame{width:100%;height:405px;position:relative}
[data-fixture="controls"] .video-container{height:100%!important;aspect-ratio:auto!important}
[data-test-no-native-flex-gap]{row-gap:0!important;column-gap:0!important}
@media(max-width:900px){
  [data-flex-gap-fixture]{grid-template-columns:minmax(0,1fr);padding:12px}
  [data-fixture="likes"]{grid-column:auto}
  .player-frame{height:360px}
}
`);
await writeFile(path.join(work, 'index.html'), `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/ui.css"><link rel="stylesheet" href="/fixture.css"></head>
<body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`);

const modernBrowser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
});
const realLegacyExecutable = process.env.FLEX_GAP_LEGACY_CHROMIUM;
const legacyBrowser = realLegacyExecutable
  ? await chromium.launch({ headless: true, executablePath: realLegacyExecutable })
  : modernBrowser;
const results = [];
const failures = [];
let modernReference = null;

function legacySimulation({ legacy, simulated }) {
  if (!legacy || !simulated) return;

  const scrollHeightDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight')
    || Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
  if (scrollHeightDescriptor?.get) {
    const nativeScrollHeight = scrollHeightDescriptor.get;
    Object.defineProperty(Element.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        const isFlexGapProbe = this instanceof HTMLElement
          && this.style.position === 'absolute'
          && this.style.left === '-9999px'
          && this.style.visibility === 'hidden'
          && this.style.display === 'flex'
          && this.style.flexDirection === 'column'
          && this.children.length === 2;
        return isFlexGapProbe ? 0 : nativeScrollHeight.call(this);
      },
    });
  }

  const nativeGetComputedStyle = window.getComputedStyle.bind(window);
  const rememberedGaps = new WeakMap();
  const suppressNativeGap = (root) => {
    const elements = root instanceof Element ? [root, ...root.querySelectorAll('*')] : [];
    for (const element of elements) {
      if (!(element instanceof HTMLElement || element instanceof SVGElement)) continue;
      if (element.hasAttribute('data-test-no-native-flex-gap')) continue;
      const style = nativeGetComputedStyle(element);
      if (style.display !== 'flex' && style.display !== 'inline-flex') continue;
      rememberedGaps.set(element, {
        gap: style.gap,
        rowGap: style.rowGap,
        columnGap: style.columnGap,
      });
      element.setAttribute('data-test-no-native-flex-gap', '');
    }
  };
  window.getComputedStyle = (element, pseudo) => {
    const style = nativeGetComputedStyle(element, pseudo);
    const remembered = rememberedGaps.get(element);
    if (!remembered) return style;
    return new Proxy(style, {
      get(target, property) {
        if (property === 'gap' || property === 'rowGap' || property === 'columnGap') {
          return remembered[property];
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  };
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) suppressNativeGap(node);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
  suppressNativeGap(document.documentElement);
}

const between = (before, after, axis) => axis === 'x'
  ? after.left - before.right
  : after.top - before.bottom;
const closeTo = (actual, expected, message, tolerance = 1.25) => {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${message}: attendu ${expected}px ± ${tolerance}px, obtenu ${actual}px`);
};
const noOverlap = (first, second, message) => {
  const overlapX = Math.min(first.right, second.right) - Math.max(first.left, second.left);
  const overlapY = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
  assert.ok(overlapX <= 0 || overlapY <= 0,
    `${message}: chevauchement ${overlapX.toFixed(2)}×${overlapY.toFixed(2)}px`);
};

async function collectMetrics(page) {
  return page.evaluate(() => {
    const toRect = (elementOrRange) => {
      const value = elementOrRange.getBoundingClientRect();
      return { left:value.left,right:value.right,top:value.top,bottom:value.bottom,width:value.width,height:value.height };
    };
    const toLayoutRect = (element) => ({
      left:element.offsetLeft,
      right:element.offsetLeft+element.offsetWidth,
      top:element.offsetTop,
      bottom:element.offsetTop+element.offsetHeight,
      width:element.offsetWidth,
      height:element.offsetHeight,
    });
    const directTextRange = (element) => {
      const text = Array.from(element.childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      if (!text) throw new Error('Le libellé texte brut du bouton qualité est absent');
      const range = document.createRange();
      range.selectNodeContents(text);
      return range;
    };

    const sourceMenu = document.querySelector('[data-source-menu]');
    if (!sourceMenu) throw new Error('Le vrai menu qualité HLSPlayer est absent');
    const pin = sourceMenu.querySelector('button[aria-label^="settings.sourcePriority."]');
    if (!pin) throw new Error("Le bouton d’épinglage réel est absent");
    const pinWrapper = pin.parentElement;
    const sourceRow = pinWrapper?.parentElement;
    const sourceButton = sourceRow?.querySelector(':scope > button:not([aria-label^="settings.sourcePriority."])');
    if (!sourceRow || !sourceButton || !pinWrapper) throw new Error('La rangée source réelle est introuvable');
    const qualityScan = sourceMenu.querySelector('button[title="watch.qualityCheckTitle"]');
    const qualityIcon = qualityScan?.querySelector('svg');
    if (!qualityScan || !qualityIcon) throw new Error('Le bouton de contrôle qualité réel est absent');

    const centralControls = Array.from(document.querySelectorAll('[data-fixture="controls"] [data-player-controls]'))
      .find(element => element.querySelectorAll(':scope > button').length === 3);
    if (!centralControls) throw new Error('Les contrôles centraux HLSPlayer sont absents');
    const centralButtons = Array.from(centralControls.querySelectorAll(':scope > button'));
    const controlBar = document.querySelector('[data-fixture="controls"] .control-bar');
    const bottomRow = Array.from(controlBar?.children || []).find(element => {
      const style = getComputedStyle(element);
      return style.display === 'flex' && style.flexWrap === 'wrap';
    });
    if (!bottomRow || bottomRow.children.length < 2) throw new Error('La rangée basse HLSPlayer est absente');
    const bottomGroups = Array.from(bottomRow.children).slice(0, 2);

    const voteButtons = Array.from(document.querySelectorAll('[data-fixture="likes"] button'));
    if (voteButtons.length !== 2) throw new Error('Les deux boutons LikeDislikeButton sont absents');
    const firstVoteChildren = Array.from(voteButtons[0].children);
    if (firstVoteChildren.length < 2) throw new Error('Le contenu du bouton Like est incomplet');

    return {
      rootClass: document.documentElement.className,
      userAgent: navigator.userAgent,
      simulatedFlexCount: document.querySelectorAll('[data-test-no-native-flex-gap]').length,
      sourcePair: [toRect(sourceButton), toRect(pinWrapper)],
      qualityRawTextPair: [toRect(qualityIcon), toRect(directTextRange(qualityScan))],
      centralButtons: centralButtons.map(toLayoutRect),
      bottomGroups: bottomGroups.map(toRect),
      bottomWrap: getComputedStyle(bottomRow).flexWrap,
      voteButtons: voteButtons.map(toRect),
      voteStyles: voteButtons.map(element => ({
        inline: element.getAttribute('style'),
        marginLeft: getComputedStyle(element).marginLeft,
        marginRight: getComputedStyle(element).marginRight,
        transform: getComputedStyle(element).transform,
      })),
      voteRowStyle: {
        inline: voteButtons[0].parentElement?.getAttribute('style'),
        gap: getComputedStyle(voteButtons[0].parentElement).gap,
        rowGap: getComputedStyle(voteButtons[0].parentElement).rowGap,
        columnGap: getComputedStyle(voteButtons[0].parentElement).columnGap,
      },
      voteInnerPair: [toRect(firstVoteChildren[0]), toRect(firstVoteChildren[1])],
    };
  });
}

function verifyMetrics(metrics, { legacy }) {
  if (!baselineWithoutHelper) {
    assert.equal(metrics.rootClass.split(/\s+/).includes('no-flex-gap'), legacy,
      legacy ? 'le mode legacy doit activer no-flex-gap' : 'le mode moderne ne doit pas activer no-flex-gap');
  }

  closeTo(between(...metrics.sourcePair, 'x'), 8, 'rangée source HLS + épinglage');
  noOverlap(...metrics.sourcePair, 'rangée source HLS + épinglage');
  closeTo(between(...metrics.qualityRawTextPair, 'x'), 4, 'icône + texte brut du contrôle qualité');
  noOverlap(...metrics.qualityRawTextPair, 'icône + texte brut du contrôle qualité');

  for (let index = 1; index < metrics.centralButtons.length; index += 1) {
    closeTo(between(metrics.centralButtons[index - 1], metrics.centralButtons[index], 'x'), 32,
      `contrôles centraux HLS ${index}`);
    noOverlap(metrics.centralButtons[index - 1], metrics.centralButtons[index],
      `contrôles centraux HLS ${index}`);
  }

  const [bottomLeft, bottomRight] = metrics.bottomGroups;
  noOverlap(bottomLeft, bottomRight, 'groupes de la barre basse HLS');
  if (bottomRight.top >= bottomLeft.bottom - 1) {
    assert.ok(between(bottomLeft, bottomRight, 'y') >= 7,
      'la barre basse HLS revenue à la ligne conserve au moins 8px');
  } else {
    assert.ok(between(bottomLeft, bottomRight, 'x') >= 7,
      'la barre basse HLS conserve au moins 8px entre groupes');
  }

  closeTo(between(...metrics.voteButtons, 'x'), 12, 'boutons Like/Dislike');
  noOverlap(...metrics.voteButtons, 'boutons Like/Dislike');
  closeTo(between(...metrics.voteInnerPair, 'x'), 8, 'icône + compteur Like');
  noOverlap(...metrics.voteInnerPair, 'icône + compteur Like');
}

async function scenario(name, options) {
  const browser = options.legacy ? legacyBrowser : modernBrowser;
  const simulated = options.legacy && !realLegacyExecutable;
  const context = await browser.newContext({
    viewport: { width: options.width || 1320, height: options.height || 980 },
    deviceScaleFactor: options.dpr || 1,
  });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  await context.addInitScript(legacySimulation, { legacy: options.legacy, simulated });
  await context.addInitScript(() => {
    localStorage.setItem('settings_light_mode', 'off');
    localStorage.setItem('settings_anim_transitions', 'true');
  });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'gap.test') return route.abort();
    if (url.pathname === '/api/likes/movie/gap-fixture') {
      return route.fulfill({
        json: { likes: 128, dislikes: 17, userVote: null },
        headers: { 'access-control-allow-origin': '*' },
      });
    }
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const contentType = file.endsWith('.js') ? 'text/javascript'
      : file.endsWith('.css') ? 'text/css'
      : 'text/html';
    try {
      return route.fulfill({ contentType, body: await readFile(path.join(work, file)) });
    } catch {
      return route.abort();
    }
  });

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  let metrics = null;
  try {
    await page.goto(`http://gap.test/?mode=${options.legacy ? 'legacy' : 'modern'}`);
    await page.locator('[data-fixture="likes"] button').nth(1).waitFor();
    await page.locator('[data-source-menu]').waitFor();
    await page.locator('[data-fixture="controls"] .control-bar').waitFor();
    await page.waitForTimeout(400);
    metrics = await collectMetrics(page);
    verifyMetrics(metrics, options);
    assert.deepEqual(pageErrors, [], 'aucune erreur JavaScript dans les vrais composants');
    if (!options.legacy) modernReference = metrics;
    if (options.legacy && modernReference && !realLegacyExecutable) {
      for (const key of ['sourcePair', 'qualityRawTextPair', 'centralButtons', 'voteButtons', 'voteInnerPair']) {
        const modernRects = modernReference[key].flatMap(value => [value.left, value.right, value.top, value.bottom]);
        const legacyRects = metrics[key].flatMap(value => [value.left, value.right, value.top, value.bottom]);
        assert.equal(legacyRects.length, modernRects.length, `${key}: géométrie comparable`);
        legacyRects.forEach((value, index) => closeTo(value, modernRects[index], `${key}[${index}] moderne/legacy`, 1.5));
      }
    }
    await page.screenshot({ path: path.join(work, `${name}.png`), fullPage: true });
    results.push({ name, status: 'passed', options, simulated, metrics, pageErrors });
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    await page.screenshot({ path: path.join(work, `${name}-failed.png`), fullPage: true }).catch(() => {});
    results.push({ name, status: 'failed', options, simulated, error: error.message, metrics, pageErrors });
  } finally {
    await context.tracing.stop({ path: path.join(work, `${name}.trace.zip`) });
    await context.close();
  }
}

try {
  await scenario('modern-flex-gap', { legacy: false });
  await scenario(realLegacyExecutable ? 'legacy-chromium-flex-gap' : 'legacy-simulated-flex-gap', { legacy: true });
  await scenario('modern-byd-wide', { legacy: false, width: 1280, height: 720, dpr: 1.25 });
  await scenario(realLegacyExecutable ? 'legacy-chromium-byd-wide' : 'legacy-simulated-byd-wide', {
    legacy: true,
    width: 1280,
    height: 720,
    dpr: 1.25,
  });
} finally {
  if (legacyBrowser !== modernBrowser) await legacyBrowser.close();
  await modernBrowser.close();
  await writeFile(path.join(work, 'results.json'), JSON.stringify({
    helper: baselineWithoutHelper ? 'désactivé pour baseline' : 'src/utils/flexGapSupport.ts',
    legacyEngine: realLegacyExecutable || 'simulation ciblée du layout Flexbox',
    results,
    failures,
  }, null, 2));
  const passed = results.filter(result => result.status === 'passed').length;
  const report = `# Vérification du repli Flexbox gap\n\nCommande : \`node tests/flexGap.browser.mjs\`\n\nPrérequis : dépendances npm, Playwright et Chromium. Aucun serveur, compte ou média distant ; tout le réseau est intercepté.\n\nVariables facultatives : \`CODEX_PRIMARY_RUNTIME_NODE_MODULES\`, \`FLEX_GAP_REPORT_DIR\`, \`CHROMIUM_EXECUTABLE_PATH\`, \`FLEX_GAP_LEGACY_CHROMIUM\`. \`FLEX_GAP_BASELINE=1\` désactive seulement le helper lorsque son fichier de travail est momentanément indisponible.\n\nHelper testé : ${baselineWithoutHelper ? 'désactivé pour baseline' : 'src/utils/flexGapSupport.ts'}.\n\nComposants réels : HLSPlayer en mode \`onlyQualityMenu\`, HLSPlayer avec contrôles et LikeDislikeButton. Le contexte profil et la réponse API des votes sont simulés.\n\nLe scénario legacy utilise : ${realLegacyExecutable || 'une simulation qui retire le layout natif de gap aux seuls éléments calculés en Flexbox, conserve rowGap/columnGap pour le repli et force la sonde scrollHeight à échouer'}.\n\nFormats : bureau 1320×980 et écran embarqué large 1280×720 à densité 1,25.\n\nAttendus : espacements exacts des rangées sans retour, absence de chevauchement, conservation de la gouttière de la barre basse avec retour à la ligne, traitement du texte brut et géométrie identique entre moteur moderne et simulation legacy.\n\nRésultats : ${passed}/${results.length} scénarios réussis.\n\n${results.map(result => `- ${result.name} : ${result.status}${result.error ? ` — ${result.error}` : ''}`).join('\n')}\n\nChaque scénario produit une capture PNG et une trace Playwright. Les rectangles et distances mesurés sont consignés dans \`results.json\`.\n`;
  await writeFile(path.join(work, 'REPORT.md'), report);
}

console.log(JSON.stringify({
  artifact: work,
  passed: results.length - failures.length,
  total: results.length,
  failures,
}, null, 2));
if (failures.length) process.exitCode = 1;
