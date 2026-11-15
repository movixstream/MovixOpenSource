// Miniatures de la barre de progression, dans un vrai navigateur.
//
// Les tests Node couvrent les analyseurs, mais Node n'a pas WebCodecs. Ce banc
// fait tourner le vrai worker : la page encode une vidéo H.264, la dépose ici,
// puis vérifie la couleur de chaque miniature décodée. Le serveur sert les
// fichiers avec `Range` et un débit bridé, et note combien d'octets il a
// réellement envoyés : c'est la preuve que le téléchargement est coupé tôt.
//
// Exécution : node tests/seekThumbnails.browser.mjs
//             node tests/seekThumbnails.browser.mjs live   (flux publics, accès réseau)
// Nécessite les dépendances npm et Chrome ou Edge (chemin dans BROWSER sinon).
// Le navigateur tourne sans fenêtre et sans son.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.dirname(here);
const live = process.argv[2] === 'live';

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

const work = mkdtempSync(path.join(os.tmpdir(), 'movix-thumbnails-'));
const esbuild = createRequire(path.join(repo, 'package.json'))('esbuild');
const bundle = (entry, outfile) => esbuild.build({
  entryPoints: [entry], outfile: path.join(work, outfile),
  bundle: true, format: 'esm', target: 'es2022', logLevel: 'warning',
});
await bundle(path.join(here, 'seekThumbnails.browser.page.ts'), 'page.js');
// WORKER_BUNDLE : essayer un worker déjà compilé, par exemple celui du build.
const workerFile = process.env.WORKER_BUNDLE || path.join(work, 'worker.js');
if (!process.env.WORKER_BUNDLE) await bundle(path.join(repo, 'src/workers/seekThumbnails.worker.ts'), 'worker.js');

const media = new Map();
const served = [];
let done;
const finished = new Promise((resolve) => { done = resolve; });

const readBody = request => new Promise((resolve) => {
  const chunks = [];
  request.on('data', chunk => chunks.push(chunk));
  request.on('end', () => resolve(Buffer.concat(chunks)));
});

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://banc');
  if (url.pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><meta charset="utf-8"><script type="module" src="/page.js"></script>');
    return;
  }
  // Le client crée son worker par une URL relative à son propre fichier :
  // depuis /page.js, elle retombe sur ce chemin.
  if (url.pathname === '/page.js' || url.pathname === '/workers/seekThumbnails.worker.ts') {
    response.writeHead(200, { 'content-type': 'text/javascript' });
    response.end(readFileSync(url.pathname === '/page.js' ? path.join(work, 'page.js') : workerFile));
    return;
  }
  if (url.pathname === '/result') {
    response.end('ok');
    done(JSON.parse((await readBody(request)).toString('utf8')));
    return;
  }

  const [, kind, name] = url.pathname.split('/');
  if (request.method === 'PUT' && kind === 'media') {
    media.set(name, await readBody(request));
    response.end('ok');
    return;
  }
  if (kind === 'limited') {
    response.writeHead(429).end();
    return;
  }
  const file = media.get(name);
  if (!file) {
    response.writeHead(404).end();
    return;
  }

  // `/norange/` joue le serveur qui ignore l'en-tête Range.
  const range = kind === 'media' ? /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '') : null;
  const start = range ? Math.min(file.length, Number(range[1])) : 0;
  const end = range && range[2] ? Math.min(file.length, Number(range[2]) + 1) : file.length;
  response.writeHead(range ? 206 : 200, {
    'content-type': 'application/octet-stream',
    'content-length': end - start,
    ...(range ? { 'content-range': `bytes ${start}-${end - 1}/${file.length}` } : {}),
  });

  // Débit bridé (environ 6 Mo/s) : le client a le temps de couper la lecture.
  const record = { path: url.pathname, range: request.headers.range ?? '', total: file.length, sent: 0 };
  served.push(record);
  let closed = false;
  response.on('close', () => { closed = true; });
  for (let at = start; at < end && !closed; at += 32 * 1024) {
    const chunk = file.subarray(at, Math.min(end, at + 32 * 1024));
    response.write(chunk);
    record.sent += chunk.length;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  response.end();
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = spawn(browserPath, [
  '--headless=new', '--mute-audio', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${path.join(work, 'profile')}`,
  `http://127.0.0.1:${server.address().port}/${live ? '?live' : ''}`,
], { stdio: 'ignore' });

const timeout = setTimeout(() => done({ results: [], error: 'délai dépassé (90 s)' }), 90_000);
const report = await finished;
clearTimeout(timeout);
browser.kill();
server.close();
server.closeAllConnections();

let failed = 0;
for (const { name, ok, detail } of report.results) {
  if (!ok) failed++;
  const text = detail === null || detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
  console.log(`${ok ? 'OK ' : 'KO '} ${name}${text}`);
}
if (report.error) console.log(`ERREUR ${report.error}`);

if (!live) {
  console.log('\nOctets servis par requête, sur la taille du fichier :');
  for (const { path: file, range, sent, total } of served) {
    const kilo = value => String(Math.round(value / 1024)).padStart(5);
    console.log(`  ${file.padEnd(24)} ${kilo(sent)} Ko / ${kilo(total)} Ko  ${range}`);
  }
}
console.log(`\n${report.results.length - failed}/${report.results.length} réussis`);

// Le profil du navigateur peut rester verrouillé un instant après son arrêt.
setTimeout(() => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* nettoyé au prochain démarrage du système */ }
  process.exit(failed || report.error || !report.results.length ? 1 : 0);
}, 500);
