import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSocialPreviewResponse } from '../functions/_lib/socialPreview.js';
import { registerGracefulShutdown } from './gracefulShutdown.js';
import { isVersionedAsset, startAssetHistory } from './asset-history.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const INDEX_HTML = join(DIST, 'index.html');

if (!existsSync(DIST)) {
  console.error(`[server] dist/ introuvable (${DIST}). Lance "npm run build" avant "npm start".`);
  process.exit(1);
}

const app = new Hono();
const indexHtml = await readFile(INDEX_HTML, 'utf8');
const archivedAssets = await startAssetHistory(DIST);
const PUBLIC_HTML_PATHS = new Set([
  '/', '/index.html', '/movies', '/anime', '/tv-shows', '/collections', '/search',
  '/about', '/privacy', '/terms-of-service', '/extension', '/app',
  '/list-catalog', '/top10', '/calendar', '/live-tv', '/cinegraph',
]);

// Médias et polices servis depuis public/ : leur nom ne porte pas de hash, on
// ne peut donc pas les déclarer immuables — mais ils ne changent quasiment
// jamais. Le `no-cache` qui s'appliquait à eux était le pire des cas : le
// serveur statique n'émet ni ETag ni Last-Modified, donc le navigateur n'avait
// aucun moyen de revalider et retéléchargeait le fichier *en entier* à chaque
// page. Le logo seul pèse près de 800 Ko, et sert de favicon partout.
const MEDIA_ASSET_RE = /\.(?:png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|mp4|webm|m4v|mp3|wasm)$/i;

// Fichiers de pilotage : ils doivent pouvoir changer sans délai, sinon un
// déploiement met des heures à atteindre les clients.
const ALWAYS_REVALIDATE = new Set([
  '/sw.js',
  '/manifest.json',
  '/robots.txt',
  '/sitemap.xml',
  '/index.html',
  '/_redirects',
  '/_routes.json',
]);

app.use('/*', async (c, next) => {
  await next();
  const path = new URL(c.req.url).pathname;
  const status = c.res.status;

  // Les erreurs et la sonde ne doivent jamais être conservées par un cache.
  // Ces exceptions passent avant le garde-fou des headers pour rester
  // effectives même lorsqu'une route en a déjà défini un.
  if (status >= 400 || path === '/health') {
    c.header('Cache-Control', 'no-store');
    c.header('Cloudflare-CDN-Cache-Control', 'no-store');
    return;
  }

  // Only the public SPA shell/metadata is eligible for a short CDN cache.
  // Authentication, VIP, private rooms and unknown routes stay out of it.
  if (c.res.headers.get('content-type')?.toLowerCase().startsWith('text/html')) {
    const publicPath = PUBLIC_HTML_PATHS.has(path) || /^\/(?:movie|tv)\/[^/]+\/?$/.test(path);
    const cacheable = status === 200 && ['GET', 'HEAD'].includes(c.req.method)
      && publicPath && !c.req.header('authorization') && !c.res.headers.has('set-cookie');
    c.header('Cache-Control', 'no-cache');
    c.header('Cloudflare-CDN-Cache-Control', cacheable ? 'public, max-age=60' : 'no-store');
    return;
  }

  // Le chargeur JS et le binaire WASM doivent chacun être revalidés avant
  // réutilisation, car leurs noms restent stables entre les déploiements.
  if (path.startsWith('/wasm/watchparty-sync/')) {
    c.header('Cache-Control', 'no-cache, must-revalidate');
    c.header('Cloudflare-CDN-Cache-Control', 'no-store');
    return;
  }

  if (c.res.headers.has('cache-control')) return;
  const isOk = status === 200;

  if (path.startsWith('/assets/') && isOk && isVersionedAsset(path.slice('/assets/'.length))) {
    // Nom hashé par Vite : le contenu ne changera jamais sous cette URL.
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (isOk && MEDIA_ASSET_RE.test(path) && !ALWAYS_REVALIDATE.has(path)) {
    // Une journée de cache ferme, puis une semaine où la version en cache est
    // servie immédiatement pendant que le navigateur va chercher la nouvelle.
    c.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  } else {
    c.header('Cache-Control', 'no-cache, must-revalidate');
    c.header('Cloudflare-CDN-Cache-Control', 'no-store');
  }
});

app.get('/health', (c) => c.json({ ok: true, runtime: 'node', app: 'movix-hono' }));

const toCloudflareCtx = (c) => ({
  request: new Request(c.req.url, { method: c.req.method, headers: c.req.raw.headers }),
  env: process.env,
  next: async () => {
    return new Response(indexHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  },
});

const socialPreviewHandler = async (c) => {
  const res = await buildSocialPreviewResponse(toCloudflareCtx(c));
  return res;
};

app.get('/movie/:id', socialPreviewHandler);
app.get('/tv/:id', socialPreviewHandler);

app.use('/*', serveStatic({ root: DIST }));

if (archivedAssets) {
  const serveArchived = serveStatic({
    root: archivedAssets,
    rewriteRequestPath: (path) => path.slice('/assets/'.length),
  });
  app.use('/assets/*', async (c, next) => {
    let name;
    try { name = decodeURIComponent(c.req.path).slice('/assets/'.length); }
    catch { return c.text('Bad Request', 400); }
    if (!['GET', 'HEAD'].includes(c.req.method) || !isVersionedAsset(name)) return next();
    return serveArchived(c, next);
  });
}

app.get('*', async (c) => {
  const path = new URL(c.req.url).pathname;
  if (path.startsWith('/assets/') || path === '/api' || path.startsWith('/api/') || /\.[^/]+$/.test(path)) {
    return c.text('Not Found', 404);
  }
  return c.html(indexHtml);
});

const port = Number(process.env.PORT) || 3001;
const server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  console.log(`[server] Movix Hono → http://0.0.0.0:${info.port}`);
});

registerGracefulShutdown(server);
