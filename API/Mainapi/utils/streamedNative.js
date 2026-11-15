const { Worker } = require('node:worker_threads');
const { createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const { request } = require('node:https');
const { lookup } = require('node:dns/promises');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { createSingleFlight } = require('./singleFlight');
const { isPublicHttpUrl } = require('./mediaSigning');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
// Pas de liste de domaines : Streamed change souvent de relais et de CDN.
// Seules les URL https publiques (DNS revalidé dans le transport) passent.
function publicUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !isPublicHttpUrl(url.href)) {
    throw new Error('URL Streamed invalide');
  }
  return url;
}

function mediaUrl(value) {
  return publicUrl(value).href;
}

function parseStreamedEmbed(value) {
  const url = publicUrl(value);
  const match = url.pathname.match(/^\/embed\/([a-z0-9-]{1,32})\/([^/]{1,500})\/(\d{1,3})\/?$/);
  if (url.hostname !== 'embed.st' || url.search || url.hash || !match) throw new Error('Lecteur Streamed invalide');
  const [, source, id, stream] = match;
  return { origin: url.origin, source, id: decodeURIComponent(id), stream, path: `${source}/${id}/${stream}` };
}

function encodeStreamedRequest(slot) {
  return Buffer.concat(['source', 'id', 'stream'].map((key, index) => {
    const data = Buffer.from(String(slot[key]));
    const size = []; let length = data.length;
    while (length > 127) { size.push((length & 127) | 128); length >>>= 7; }
    return Buffer.concat([Buffer.from([(index + 1) * 8 + 2, ...size, length]), data]);
  }));
}

function unwrapStreamedSegment(body) {
  const png = body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4e && body[3] === 0x47;
  const webp = body.toString('ascii', 0, 4) === 'RIFF' && body.toString('ascii', 8, 12) === 'WEBP';
  if (!png && !webp) return body;
  for (let offset = 0; offset < Math.min(body.length - 188, 65536); offset++) {
    if (body[offset] === 0x47 && body[offset + 188] === 0x47 &&
      (offset + 376 >= body.length || body[offset + 376] === 0x47)) return body.subarray(offset);
  }
  throw new Error('Segment Streamed invalide');
}

// Les variantes Streamed peuvent avoir des séquences et des horloges MPEG-TS
// indépendantes. Un passage SD -> HD produit alors des fragments hors buffer.
// Garder la variante au débit annoncé le plus élevé pendant toute la lecture.
// Même sélection côté extension dans src/utils/streamedPlayback.ts.
function selectStreamedVariant(text) {
  const lines = text.split('\n');
  const variants = [];
  let pending;
  lines.forEach((line, index) => {
    const value = line.trim();
    if (value.startsWith('#EXT-X-STREAM-INF:')) {
      pending = { tag: index, bitrate: Number(/(?:^|,)BANDWIDTH=(\d+)(?:,|$)/.exec(value.slice(18))?.[1]) || 0 };
    } else if (value && !value.startsWith('#') && pending) {
      variants.push({ ...pending, uri: index });
      pending = undefined;
    }
  });
  if (variants.length < 2) return text;
  const selected = variants.reduce((best, variant) => variant.bitrate > best.bitrate ? variant : best);
  const removed = new Set(variants.filter(variant => variant !== selected).flatMap(variant => [variant.tag, variant.uri]));
  return lines.filter((_, index) => !removed.has(index)).join('\n');
}

function rewriteStreamedPlaylist(text, base, register) {
  return selectStreamedVariant(text).split('\n').map(line => {
    const value = line.trim();
    if (!value) return line;
    if (value.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${register(new URL(uri, base).href)}"`);
    return register(new URL(value, base).href);
  }).join('\n');
}

function execStreamedCurl(args, options, config) {
  return new Promise((resolve, reject) => {
    const child = execFile(process.platform === 'win32' ? 'curl.exe' : 'curl', args, options,
      (error, stdout) => error ? reject(error) : resolve({ stdout }));
    child.stdin.on('error', () => {}); // La fermeture anticipée est remontée par execFile.
    child.stdin.end(config);
  });
}

function createStreamedTransport({ pickProxy = async () => null, lookupImpl = lookup,
  execImpl = execStreamedCurl, requestImpl = request, AgentClass = SocksProxyAgent } = {}) {
  async function destination(url) {
    const target = publicUrl(url);
    const addresses = await lookupImpl(target.hostname, { all: true });
    if (!addresses.length || addresses.some(({ address, family }) => !isPublicHttpUrl(`https://${family === 6 ? `[${address}]` : address}/`))) {
      throw new Error('Destination Streamed non publique');
    }
    return { target, ...(addresses.find(entry => entry.family === 4) || addresses[0]) };
  }

  async function nextProxy() {
    const proxy = await pickProxy();
    if (!proxy) throw new Error('Proxy SOCKS5 Streamed indisponible');
    if (typeof proxy.host !== 'string' || !proxy.host || !Number.isInteger(Number(proxy.port)) || Number(proxy.port) < 1 || Number(proxy.port) > 65535 ||
      (proxy.type && !['socks', 'socks5', 'socks5h'].includes(proxy.type))) throw new Error('Proxy SOCKS5 Streamed invalide');
    const host = proxy.host.includes(':') && !proxy.host.startsWith('[') ? `[${proxy.host}]` : proxy.host;
    const url = new URL(`socks5://${host}:${proxy.port}`);
    if (url.username || url.password || url.pathname || url.search || url.hash) throw new Error('Proxy SOCKS5 Streamed invalide');
    const endpoint = url.href;
    const auth = String(proxy.auth || '');
    if (/[\x00-\x1f\x7f]/.test(auth)) throw new Error('Proxy SOCKS5 Streamed invalide');
    if (auth) {
      const separator = auth.indexOf(':');
      url.username = separator < 0 ? auth : auth.slice(0, separator);
      url.password = separator < 0 ? '' : auth.slice(separator + 1);
    }
    return { url, endpoint, auth };
  }

  // Résolution DNS locale validée et épinglée : SOCKS5 ne résout jamais la cible
  // à nouveau. curl conserve l'empreinte HTTP acceptée par le CDN.
  async function pull(url, referer) {
    for (let hop = 0; hop < 5; hop++) {
      const { target, address, family } = await destination(url);
      const proxy = await nextProxy();
      const quote = value => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
      const config = `proxy = ${quote(proxy.endpoint)}\n${proxy.auth ? `proxy-user = ${quote(proxy.auth)}\n` : ''}`;
      // Les identifiants restent sur stdin, jamais dans argv ni dans un fichier.
      const { stdout } = await execImpl([
        '--disable', '--config', '-', '--globoff', '--silent', '--show-error', '--compressed', '--proto', '=https', '--noproxy', '',
        '--connect-timeout', '5', '--max-time', '15',
        '--resolve', `${target.hostname}:443:${family === 6 ? `[${address}]` : address}`,
        '--header', `Referer: ${referer}`, '--header', `Origin: ${new URL(referer).origin}`,
        '--user-agent', USER_AGENT, '--output', '-', '--write-out', '\nMOVIX_STATUS:%{http_code}\nMOVIX_REDIRECT:%{redirect_url}', '--', target.href,
      ], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024, timeout: 17000, windowsHide: true }, config);
      const marker = stdout.lastIndexOf(Buffer.from('\nMOVIX_STATUS:'));
      const info = marker >= 0 && stdout.subarray(marker).toString('utf8').match(/MOVIX_STATUS:(\d+)\nMOVIX_REDIRECT:(.*)$/s);
      if (!info) throw new Error('Réponse CDN invalide');
      const status = Number(info[1]);
      if ([301, 302, 303, 307, 308].includes(status) && info[2]) { url = info[2].trim(); continue; }
      if (status < 200 || status >= 300) throw new Error(`Streamed HTTP ${status}`);
      return { body: stdout.subarray(0, marker), url: target.href };
    }
    throw new Error('Trop de redirections Streamed');
  }

  async function fetchHandshake(url, options) {
    if (url !== 'https://embed.st/fetch' || options.method !== 'POST') throw new Error('Lecteur Streamed invalide');
    const { target, address, family } = await destination(url);
    const proxy = await nextProxy();
    const agent = new AgentClass(proxy.url, { timeout: 5000 });
    try {
      return await new Promise((resolve, reject) => {
        const req = requestImpl(target, {
          method: 'POST', headers: options.headers, signal: options.signal, agent,
          lookup: (_host, _options, callback) => callback(null, address, family),
        }, res => {
          res.on('error', reject);
          if (res.statusCode < 200 || res.statusCode >= 300) {
            res.resume(); reject(new Error(`Streamed HTTP ${res.statusCode}`)); return;
          }
          const chunks = []; let size = 0;
          res.on('data', chunk => {
            size += chunk.length;
            if (size > 16000) { res.destroy(new Error('Réponse Streamed invalide')); return; }
            chunks.push(chunk);
          });
          res.on('end', () => resolve({ ok: true, status: res.statusCode,
            headers: new Headers(res.headers), arrayBuffer: async () => Buffer.concat(chunks) }));
        });
        req.on('error', reject);
        req.end(options.body);
      });
    } finally { agent.destroy(); }
  }
  return { pull, fetch: fetchHandshake };
}

function createStreamedWorkerDecoder({ WorkerClass = Worker } = {}) {
  const activeWorkers = { public: 0, vip: 0 };
  return function unlock(slot, goat, body, pool = 'public') {
    const capacity = pool === 'vip' ? 2 : 1;
    if (activeWorkers[pool] >= capacity) return Promise.reject(new Error('Décodeur Streamed occupé'));
    activeWorkers[pool]++;
    return new Promise((resolve, reject) => {
      let worker;
      try {
        worker = new WorkerClass(require.resolve('streamed-pk-hls-stream-resolver/src/sources/goat/lock-worker.js'), {
          execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 128 },
          workerData: { slot, goat, bodyHex: body.toString('hex') },
        });
      } catch (error) { activeWorkers[pool]--; reject(error); return; }
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        worker.terminate().catch(() => {}).finally(() => { activeWorkers[pool]--; });
        if (error) reject(error); else resolve(value);
      };
      const timer = setTimeout(() => finish(new Error('Décodage Streamed expiré')), 15000);
      worker.once('message', message => finish(message.ok ? null : new Error('Décodage Streamed impossible'), message.url));
      worker.once('error', error => finish(error));
      worker.once('exit', () => finish(new Error('Décodeur Streamed arrêté')));
    });
  };
}
const unlockStreamed = createStreamedWorkerDecoder();

function createStreamedNativeService({ unlock = unlockStreamed, pickProxy, pull, fetchImpl } = {}) {
  const transport = createStreamedTransport({ pickProxy });
  pull ||= transport.pull;
  fetchImpl ||= transport.fetch;
  const flight = createSingleFlight();
  const cache = new Map();
  const remember = async (key, run) => flight(key, async () => {
    const cached = cache.get(key);
    if (cached && cached.until > Date.now()) return cached.value;
    const value = await run();
    cache.set(key, { value, until: Date.now() + 30000 });
    while (cache.size > 128) cache.delete(cache.keys().next().value);
    return value;
  });

  async function decode({ embedUrl, goat, body }, { vip = false } = {}) {
    const slot = parseStreamedEmbed(embedUrl);
    if (typeof goat !== 'string' || !/^[a-zA-Z0-9]{16,128}$/.test(goat) ||
      typeof body !== 'string' || body.length > 12000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) throw new Error('Réponse Streamed invalide');
    const bytes = Buffer.from(body, 'base64');
    if (bytes.length < 3 || bytes[0] !== 10) throw new Error('Message Streamed invalide');
    const pool = vip ? 'vip' : 'public';
    const key = createHash('sha256').update(`${pool}:${embedUrl}:${goat}:${body}`).digest('hex');
    return remember(key, async () => ({ url: mediaUrl(await unlock(slot, goat, bytes, pool)), referer: 'https://embed.st/' }));
  }

  async function resolve(embedUrl) {
    parseStreamedEmbed(embedUrl);
    return remember(`resolve:${embedUrl}`, async () => {
      let slot = parseStreamedEmbed(embedUrl);
      if (slot.source === 'golf') {
        let page = embedUrl; let referer = 'https://embed.st/';
        for (let hop = 0; hop < 4; hop++) {
          const result = await pull(page, referer);
          const html = result.body.toString('utf8');
          const fid = html.match(/\bfid\s*=\s*["']([^"']+)["']/)?.[1];
          if (fid) {
            const legacy = await pull(`https://exposestrat.com/maestrohd1.php?player=desktop&live=${encodeURIComponent(fid)}`, page);
            const parts = legacy.body.toString('utf8').match(/return\s*\(\s*(\[\s*"[^"]+"(?:\s*,\s*"[^"]+")*\s*\])\.join\(\s*""\s*\)/)?.[1];
            if (!parts) throw new Error('Adresse golf introuvable');
            return { url: mediaUrl(JSON.parse(parts).join('')), referer: 'https://exposestrat.com/' };
          }
          const iframe = html.match(/<iframe\b[^>]*\ssrc\s*=\s*(["'])(.*?)\1/is);
          const encoded = html.match(/<iframe\b[^>]*\sdata-source\s*=\s*(["'])(.*?)\1/is) ||
            html.match(/\.\s*src\s*=\s*atob\s*\(\s*(["'])([A-Za-z0-9+/]+={0,2})\1\s*\)/);
          const next = iframe?.[2] || (encoded && Buffer.from(encoded[2], 'base64').toString('utf8'));
          if (!next) throw new Error('Lecteur golf introuvable');
          const target = new URL(next.replace(/&amp;/g, '&'), result.url).href;
          if (new URL(target).hostname === 'embed.st' && !new URL(target).pathname.startsWith('/embed/golf/')) {
            slot = parseStreamedEmbed(target); embedUrl = target; break;
          }
          referer = page; page = target;
        }
        if (slot.source === 'golf') throw new Error('Lecteur golf natif indisponible');
      }
      const response = await fetchImpl('https://embed.st/fetch', {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Origin: 'https://embed.st', Referer: embedUrl, 'User-Agent': USER_AGENT },
        body: encodeStreamedRequest(slot), signal: AbortSignal.timeout(10000), redirect: 'error',
      });
      if (!response.ok) throw new Error(`Streamed HTTP ${response.status}`);
      const body = Buffer.from(await response.arrayBuffer());
      return decode({ embedUrl, goat: response.headers.get('goat'), body: body.toString('base64') }, { vip: true });
    });
  }
  return {
    decode, resolve,
    pull: (url, referer) => flight(`media:${referer}:${url}`, () => pull(url, referer)),
  };
}

module.exports = { parseStreamedEmbed, encodeStreamedRequest, mediaUrl, unwrapStreamedSegment, selectStreamedVariant,
  rewriteStreamedPlaylist, createStreamedNativeService, createStreamedWorkerDecoder, createStreamedTransport };
