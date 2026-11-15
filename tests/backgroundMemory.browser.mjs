/**
 * Régression mémoire/rendu de SquareBackground, sans serveur ni réseau.
 *
 * La fixture instrumente document.createElement avant React afin de compter
 * aussi les canvas hors DOM. Elle valide par défaut le budget mémoire et les
 * comportements de la version courante.
 *
 * Exécution : node tests/backgroundMemory.browser.mjs
 * Comparaison informative facultative :
 *   BACKGROUND_BASELINE_REF=<commit> node tests/backgroundMemory.browser.mjs
 * La source de référence est extraite dans le dossier temporaire avec git show ;
 * aucun fichier source du dépôt n'est réécrit.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const runtimeRequire = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ? createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'package.json'))
  : require;
const { chromium } = runtimeRequire('playwright');
const { build } = require('esbuild');
const work = await mkdtemp(path.join(tmpdir(), 'movix-background-memory-'));

const instrumentation = `
(() => {
  const allocations = [];
  const records = new WeakMap();
  let maximumTotalPixels = 0;

  const refresh = () => {
    let total = 0;
    for (const record of allocations) {
      const pixels = record.canvas.width * record.canvas.height;
      record.maximumPixels = Math.max(record.maximumPixels, pixels);
      total += pixels;
    }
    maximumTotalPixels = Math.max(maximumTotalPixels, total);
  };

  const originalCreateElement = Document.prototype.createElement;
  Document.prototype.createElement = function (localName) {
    const element = Reflect.apply(originalCreateElement, this, arguments);
    if (String(localName).toLowerCase() === 'canvas') {
      const record = { canvas: element, maximumPixels: element.width * element.height };
      allocations.push(record);
      records.set(element, record);
      refresh();
    }
    return element;
  };

  for (const property of ['width', 'height']) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, property);
    if (!descriptor?.get || !descriptor?.set) continue;
    Object.defineProperty(HTMLCanvasElement.prototype, property, {
      configurable: descriptor.configurable,
      enumerable: descriptor.enumerable,
      get: descriptor.get,
      set(value) {
        descriptor.set.call(this, value);
        if (records.has(this)) refresh();
      },
    });
  }

  Math.random = () => 0.75;

  window.__canvasAllocations = () => {
    refresh();
    const canvases = allocations.map((record, index) => ({
      index,
      width: record.canvas.width,
      height: record.canvas.height,
      pixels: record.canvas.width * record.canvas.height,
      maximumPixels: record.maximumPixels,
      connected: record.canvas.isConnected,
    }));
    return {
      count: canvases.length,
      currentPixels: canvases.reduce((sum, canvas) => sum + canvas.pixels, 0),
      maximumTotalPixels,
      canvases,
    };
  };

  window.__gridSignature = () => {
    const canvas = document.querySelector('[data-background-root] canvas');
    if (!canvas) return null;
    const context = canvas.getContext('2d');
    const width = Math.min(192, canvas.width);
    const height = Math.min(192, canvas.height);
    const data = context.getImageData(0, 0, width, height).data;
    let hash = 2166136261;
    let alphaSum = 0;
    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3];
      alphaSum += alpha;
      hash ^= data[index]; hash = Math.imul(hash, 16777619);
      hash ^= data[index + 1]; hash = Math.imul(hash, 16777619);
      hash ^= data[index + 2]; hash = Math.imul(hash, 16777619);
      hash ^= alpha; hash = Math.imul(hash, 16777619);
    }
    const alphaAt = (x, y) => data[(y * width + x) * 4 + 3];
    return {
      hash: hash >>> 0,
      alphaSum,
      lineAlpha: alphaAt(48, 24) + alphaAt(96, 24) + alphaAt(24, 48) + alphaAt(24, 96),
      interiorAlpha: alphaAt(24, 24) + alphaAt(72, 72),
    };
  };
})();
`;

function entry(componentPath) {
  return `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SquareBackground } from ${JSON.stringify(componentPath)};

function App() {
  const [mounted, setMounted] = useState(true);
  window.unmountBackground = () => setMounted(false);
  return mounted ? (
    <SquareBackground
      data-background-root
      squareSize={48}
      borderColor="rgba(239, 68, 68, 0.10)"
      mode="combined"
    >
      <div data-tall-content style={{ height: '12000px' }} />
    </SquareBackground>
  ) : <div id="background-unmounted" />;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
`;
}

const backgroundPlugin = {
  name: 'background-context',
  setup(builder) {
    builder.onResolve({ filter: /bgPreferences$/ }, () => ({ path: 'bg-preferences', namespace: 'background' }));
    builder.onResolve({ filter: /LightModeContext$/ }, () => ({ path: 'light-mode', namespace: 'background' }));
    builder.onLoad({ filter: /.*/, namespace: 'background' }, ({ path: fixturePath }) => ({
      contents: fixturePath === 'bg-preferences'
        ? `export const useBgPrefs=()=>({forceSquareSize:false,squareSize:48,forceColor:false,haloEnabled:true});export const getBgAccentRgb=()=> '239, 68, 68';`
        : `export const useLightMode=()=>({isLightMode:false,effectivePrefs:{bgAnimations:true,blurEffects:true}});`,
      resolveDir: repo,
    }));
  },
};

async function createFixture() {
  const variants = {
    current: path.join(repo, 'src/components/ui/square-background.tsx'),
  };

  const baselineRef = process.env.BACKGROUND_BASELINE_REF;
  if (baselineRef) {
    const baselineSource = execFileSync(
      'git',
      ['show', `${baselineRef}:src/components/ui/square-background.tsx`],
      { cwd: repo, encoding: 'utf8' },
    );
    const baselineComponent = path.join(work, 'square-background.baseline.tsx');
    await writeFile(baselineComponent, baselineSource);
    variants.baseline = baselineComponent;
  }

  for (const [variant, componentPath] of Object.entries(variants)) {
    const entryPath = path.join(work, `background-${variant}.tsx`);
    await writeFile(entryPath, entry(componentPath));
    await build({
      entryPoints: [entryPath],
      outfile: path.join(work, `background-${variant}.js`),
      bundle: true,
      format: 'esm',
      target: 'es2022',
      jsx: 'automatic',
      nodePaths: [path.join(repo, 'node_modules')],
      alias: { '@': path.join(repo, 'src') },
      define: { 'import.meta.env': '{}' },
      plugins: [backgroundPlugin],
    });
    await writeFile(path.join(work, `background-${variant}.html`), `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
html,body,#root{margin:0;min-height:100%;background:#000}
[data-background-root]{position:relative;overflow:hidden;background:#000}
[data-background-root]>canvas{position:absolute;inset:0;z-index:0;pointer-events:none}
</style></head><body><div id="root"></div><script type="module" src="/background-${variant}.js"></script></body></html>`);
  }
  return Object.keys(variants);
}

async function exercise(browser, variant) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(instrumentation);
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'background.test') return route.abort();
    const requested = url.pathname.slice(1) || `background-${variant}.html`;
    const localPath = path.join(work, requested);
    try {
      await route.fulfill({ body: await readFile(localPath), contentType: requested.endsWith('.js') ? 'text/javascript' : 'text/html' });
    } catch {
      await route.fulfill({ status: 404, body: 'Not found' });
    }
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`https://background.test/background-${variant}.html`);
  await page.waitForFunction(() => {
    const metrics = window.__canvasAllocations?.();
    return metrics?.currentPixels > 0 && metrics.canvases.some(canvas => !canvas.connected && canvas.pixels > 0);
  });

  const initial = await page.evaluate(() => window.__canvasAllocations());
  const grid = await page.evaluate(() => window.__gridSignature());
  assert.ok(grid.alphaSum > 0, `${variant}: the grid is painted`);
  assert.ok(grid.lineAlpha > grid.interiorAlpha, `${variant}: the grid preserves transparent cells and visible lines`);

  await page.mouse.move(72, 72);
  await page.waitForFunction(hash => window.__gridSignature()?.hash !== hash, grid.hash);
  await page.locator('[data-background-root]').dispatchEvent('pointerleave', { pointerType: 'mouse' });
  await page.waitForFunction(hash => window.__gridSignature()?.hash === hash, grid.hash);

  await page.evaluate(() => window.scrollTo(0, 5000));
  await page.waitForFunction(() => {
    const canvas = document.querySelector('[data-background-root] canvas');
    return window.scrollY > 4500 && canvas?.style.transform;
  });
  const scroll = await page.evaluate(() => {
    const canvas = document.querySelector('[data-background-root] canvas');
    const bounds = canvas.getBoundingClientRect();
    const match = canvas.style.transform.match(/translateY\(([-\d.]+)px\)/);
    return {
      scrollY,
      width: canvas.width,
      height: canvas.height,
      top: bounds.top,
      bottom: bounds.bottom,
      translateY: match ? Number(match[1]) : 0,
    };
  });
  assert.ok(scroll.top <= 0 && scroll.bottom >= 900, `${variant}: the canvas window covers the viewport`);
  assert.equal(scroll.translateY % 48, 0, `${variant}: the canvas window stays aligned to the grid`);
  assert.equal(await page.evaluate(() => window.__gridSignature().hash), grid.hash, `${variant}: scrolling preserves the grid`);
  assert.equal(
    await page.evaluate(() => window.__canvasAllocations().currentPixels),
    initial.currentPixels,
    `${variant}: scrolling keeps a stable backing-store budget`,
  );

  await page.evaluate(() => window.unmountBackground());
  await page.waitForFunction(() => window.__canvasAllocations().currentPixels === 0);
  const cleaned = await page.evaluate(() => window.__canvasAllocations());
  assert.deepEqual(errors, [], `${variant}: no page error`);
  await context.close();
  return { initial, cleaned, grid, scroll };
}

let browser;
try {
  const variants = await createFixture();
  browser = await chromium.launch({ headless: true });
  const current = await exercise(browser, 'current');
  const byteBudget = 12 * 1024 * 1024;
  assert.ok(current.initial.currentPixels * 4 <= byteBudget, 'steady canvas buffers stay within 12 MiB');
  assert.ok(current.initial.maximumTotalPixels * 4 <= byteBudget, 'peak tracked canvas buffers stay within 12 MiB');

  const metrics = {
    currentPixels: current.initial.currentPixels,
    currentBytesRGBA: current.initial.currentPixels * 4,
    currentPeakBytesRGBA: current.initial.maximumTotalPixels * 4,
    budgetBytesRGBA: byteBudget,
    cleanupPixels: current.cleaned.currentPixels,
  };

  if (variants.includes('baseline')) {
    const baseline = await exercise(browser, 'baseline');
    metrics.baselineRef = process.env.BACKGROUND_BASELINE_REF;
    metrics.baselinePixels = baseline.initial.currentPixels;
    metrics.baselineBytesRGBA = baseline.initial.currentPixels * 4;
    metrics.baselinePeakBytesRGBA = baseline.initial.maximumTotalPixels * 4;
    metrics.savedPercent = Math.round((1 - current.initial.currentPixels / baseline.initial.currentPixels) * 1000) / 10;
  }

  console.log(JSON.stringify(metrics, null, 2));
} finally {
  await browser?.close();
  await rm(work, { recursive: true, force: true });
}
