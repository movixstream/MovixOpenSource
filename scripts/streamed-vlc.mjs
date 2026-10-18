#!/usr/bin/env node
// Utilise sharoon7171/streamed-pk-hls-stream-resolver sans modifier Movix.
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';

const exec = promisify(execFile);
const REVISION = '7d918be84d47a924373a9304d7c8856a9daba4c6';
const REPOSITORY = 'https://github.com/sharoon7171/streamed-pk-hls-stream-resolver.git';
const DEFAULT_URL = 'https://streamed.pk/watch/tottenham-hotspur-vs-everton-2494033/golf/1';
const CACHE = join(process.env.LOCALAPPDATA || join(homedir(), '.cache'), 'Movix', 'streamed-vlc');
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

export function inputUrl(raw) {
  const text = raw.trim();
  const markdown = text.match(/^\[[^\]]*\]\((https:\/\/[^\s)]+)\)$/);
  const url = new URL(markdown ? markdown[1] : text);
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !['streamed.pk', 'embed.st'].includes(url.hostname)) {
    throw new Error('Donne une URL HTTPS streamed.pk ou embed.st.');
  }
  return url.href;
}

export function iframeUrl(html, base) {
  const source = html.match(/<iframe\b[^>]*\ssrc\s*=\s*(["'])(.*?)\1/is);
  const encoded = html.match(/<iframe\b[^>]*\sdata-source\s*=\s*(["'])(.*?)\1/is) ||
    html.match(/\.\s*src\s*=\s*atob\s*\(\s*(["'])([A-Za-z0-9+/]+={0,2})\1\s*\)/);
  const value = source?.[2] || (encoded && Buffer.from(encoded[2], 'base64').toString('utf8'));
  if (!value) return null;
  const url = new URL(value.replace(/&amp;/g, '&'), base);
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !['embed.st', 'rockystream.st', 'rockylive.st'].includes(url.hostname)) return null;
  return url.href;
}

async function command(program, args, cwd) {
  const child = spawn(program, args, { cwd, stdio: 'inherit', windowsHide: true });
  const [code] = await once(child, 'exit');
  if (code !== 0) throw new Error(`${program} a échoué (code ${code}).`);
}

async function prepareResolver(directory) {
  await mkdir(directory, { recursive: true });
  if (!existsSync(join(directory, '.git'))) await command('git', ['init', directory]);
  if (!existsSync(join(directory, 'src', 'resolve', 'run.js'))) {
    console.log('Téléchargement du resolver (version fixe)...');
    await command('git', ['fetch', '--depth=1', REPOSITORY, REVISION], directory);
    await command('git', ['checkout', '--detach', 'FETCH_HEAD'], directory);
  }
  const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd: directory, windowsHide: true });
  if (stdout.trim() !== REVISION) throw new Error(`Version inattendue du resolver dans ${directory}.`);
  if (!existsSync(join(directory, 'node_modules', 'happy-dom', 'package.json'))) {
    console.log('Installation des dépendances du resolver...');
    if (process.platform === 'win32') {
      await command(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'npm ci --ignore-scripts --no-audit --no-fund'], directory);
    } else {
      await command('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], directory);
    }
  }
}

async function resolveStream(url, directory) {
  const load = (file) => import(pathToFileURL(join(directory, 'src', file)).href);
  const [{ parseInput }, { run }, { segmentBody }] = await Promise.all([
    load('resolve/parse.js'), load('resolve/run.js'), load('relay/segment.js'),
  ]);
  // Les appels API amont et le worker WASM doivent finir même si la source ne répond plus.
  const deadline = setTimeout(() => {
    console.error('La résolution a dépassé 60 secondes. Relance le script.');
    process.exit(1);
  }, 60_000);
  try {
    const slot = await parseInput(url);
    let embed = `${slot.origin}/embed/${slot.path}`;
    if (slot.source === 'golf') {
      let page = embed;
      let referer = `${slot.origin}/`;
      for (let hop = 0; hop < 3; hop++) {
        const response = await fetch(page, { headers: { Referer: referer, 'User-Agent': USER_AGENT } });
        if (!response.ok) throw new Error(`Lecteur golf : HTTP ${response.status}.`);
        const next = iframeUrl(await response.text(), page);
        if (!next) break; // L'ancien format golf reste traité par le resolver d'origine.
        const nextUrl = new URL(next);
        if (nextUrl.hostname === 'embed.st' && /^\/embed\/(?!golf\/)[^/]+\/[^/]+\/\d+\/?$/.test(nextUrl.pathname)) {
          embed = next;
          console.log(`Lecteur intermédiaire : ${embed}`);
          break;
        }
        referer = page;
        page = next;
      }
    }
    const result = await run({ url: embed }, 'http://127.0.0.1');
    if (!result.ok) throw new Error(`Resolver (${result.stage}) : ${result.error}`);
    return { ...result, segmentBody };
  } finally {
    clearTimeout(deadline);
  }
}

async function pull(url, referer) {
  const { stdout } = await exec(process.platform === 'win32' ? 'curl.exe' : 'curl', [
    '--silent', '--show-error', '--location', '--compressed',
    '--proto', '=https', '--proto-redir', '=https', '--max-redirs', '5',
    '--connect-timeout', '10', '--max-time', '25',
    '--header', `Referer: ${referer}`, '--header', `Origin: ${new URL(referer).origin}`,
    '--user-agent', USER_AGENT, '--output', '-', '--write-out', '\nHTTPSTATUS:%{http_code}', '--', url,
  ], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024, timeout: 30_000, windowsHide: true });
  const marker = stdout.lastIndexOf(Buffer.from('\nHTTPSTATUS:'));
  const status = Number(stdout.subarray(marker + 12).toString('ascii'));
  if (marker < 0 || status < 200 || status >= 300) {
    throw new Error(`Le CDN renvoie HTTP ${status || 'inconnu'}. Relance le script pour réextraire le flux.`);
  }
  return stdout.subarray(0, marker);
}

export function rewritePlaylist(text, base, register) {
  return text.split('\n').map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith('#')) {
      return line.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${register(new URL(uri, base).href)}"`);
    }
    return register(new URL(trimmed, base).href);
  }).join('\n');
}

export async function startRelay(stream, fetchBody = pull) {
  const prefix = `/${randomBytes(18).toString('hex')}/`;
  const rootPath = `${prefix}stream.m3u8`;
  const resources = new Map([[rootPath, stream.m3u8]]);
  let origin;
  let firstSegment = true;
  const register = (target) => {
    const url = new URL(target);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Ressource HLS invalide.');
    const id = createHash('sha256').update(url.href).digest('hex').slice(0, 32);
    const extension = url.pathname.match(/\.(m3u8|ts|m4s|mp4|aac|vtt|key)$/i)?.[0] || '.bin';
    const path = `${prefix}${id}${extension}`;
    resources.delete(path);
    resources.set(path, url.href);
    // Les URLs des segments live changent continuellement : conserver une fenêtre bornée.
    while (resources.size > 2048) resources.delete([...resources.keys()][1]);
    return `${origin}${path}`;
  };
  const server = createServer(async (req, res) => {
    if (req.headers.host !== new URL(origin).host || !['GET', 'HEAD'].includes(req.method) || !resources.has(req.url)) {
      res.writeHead(404).end();
      return;
    }
    try {
      const target = resources.get(req.url);
      let body = await fetchBody(target, stream.referer);
      let type = 'application/octet-stream';
      if (body.toString('utf8', 0, 32).trimStart().startsWith('#EXTM3U')) {
        body = Buffer.from(rewritePlaylist(body.toString('utf8'), target, register));
        type = 'application/vnd.apple.mpegurl';
      } else if (body[0] === 0x47 || body.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) {
        body = stream.segmentBody(body);
        type = 'video/mp2t';
        if (firstSegment) { console.log('Premier segment vidéo transmis par le relais.'); firstSegment = false; }
      }
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) {
      console.error(`Erreur du relais : ${error.message}`);
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' }).end('La source ne répond plus. Relance le script.');
      else res.end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    url: `${origin}${rootPath}`,
    close: () => new Promise((done) => { server.close(done); server.closeAllConnections(); }),
  };
}

async function checkRelay(url) {
  for (let depth = 0; depth < 5; depth++) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Vérification du relais : HTTP ${response.status}.`);
    const body = Buffer.from(await response.arrayBuffer());
    if (!body.length) throw new Error('La source a renvoyé un corps vide.');
    const text = body.toString('utf8');
    if (!text.startsWith('#EXTM3U')) {
      if (depth === 0) throw new Error('La source ne renvoie pas de playlist HLS.');
      console.log(`Playlist et premier segment reçus (${Math.round(body.length / 1024)} Ko).`);
      return;
    }
    const first = text.split(/\r?\n/).find((line) => line.trim() && !line.startsWith('#'));
    if (!first) throw new Error('La playlist ne contient aucun flux. Le direct est peut-être terminé.');
    url = new URL(first.trim(), url).href;
  }
  throw new Error('Trop de playlists imbriquées.');
}

function findVlc(custom) {
  const candidates = [custom, process.env.VLC_PATH,
    join(process.env.ProgramFiles || 'C:\\Program Files', 'VideoLAN', 'VLC', 'vlc.exe'),
    join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'VideoLAN', 'VLC', 'vlc.exe'),
  ].filter(Boolean);
  const found = candidates.find(existsSync);
  if (!found) throw new Error('VLC est introuvable. Utilise --vlc "C:\\chemin\\vlc.exe".');
  return found;
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    check: { type: 'boolean' }, 'no-vlc': { type: 'boolean' },
    resolver: { type: 'string' }, vlc: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('Usage : node scripts/streamed-vlc.mjs [URL] [--check | --no-vlc] [--vlc CHEMIN] [--resolver DOSSIER]\nSans URL : Tottenham Hotspur vs Everton. --check vérifie puis quitte ; --no-vlc conserve le relais sans lancer VLC.');
    return;
  }
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 ou supérieur est nécessaire.');
  if (positionals.length > 1) throw new Error('Donne une seule URL entre guillemets.');
  const url = inputUrl(positionals[0] || DEFAULT_URL);
  const vlc = values.check || values['no-vlc'] ? null : findVlc(values.vlc);
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (target, options = {}) => nativeFetch(target, {
    ...options, signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
  });
  const directory = values.resolver ? resolve(values.resolver) : join(CACHE, REVISION);
  await prepareResolver(directory);
  console.log(`Extraction d'une URL fraîche : ${url}`);
  const stream = await resolveStream(url, directory);
  const relay = await startRelay(stream);
  try {
    console.log(`Adresse locale : ${relay.url}`);
    await checkRelay(relay.url);
    if (values.check) return;
    console.log('Garde ce terminal ouvert pendant la lecture. Ctrl+C arrête le relais.');
    if (values['no-vlc']) {
      await once(process, 'SIGINT');
    } else {
      await mkdir(CACHE, { recursive: true });
      const logfile = join(CACHE, `vlc-${Date.now()}.log`);
      console.log(`Ouverture de VLC. Journal : ${logfile}`);
      const child = spawn(vlc, ['--no-one-instance', '--play-and-exit', '--network-caching=2000',
        '--file-logging', '--verbose=2', `--logfile=${logfile}`, relay.url, 'vlc://quit'], { stdio: 'ignore', shell: false });
      const onInterrupt = () => { child.unref(); void relay.close(); };
      process.once('SIGINT', onInterrupt);
      try {
        const [code] = await once(child, 'exit');
        if (code !== 0) throw new Error(`VLC s'est arrêté (code ${code}). Consulte ${logfile}.`);
      } finally { process.removeListener('SIGINT', onInterrupt); }
    }
  } finally {
    await relay.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(`Erreur : ${error.message}`); process.exitCode = 1; });
}
