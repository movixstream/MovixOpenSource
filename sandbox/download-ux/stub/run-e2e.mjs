/**
 * Parcours propre bout-en-bout (ordre recommandé) :
 *   .env → resolve multi (swiftflow + watch-catalog) → rank → download
 * Préfère MP4, sinon HLS (ffmpeg).
 *
 *   node --experimental-strip-types sandbox/download-ux/stub/run-e2e.mjs --smoke 175
 */

import { loadSandboxEnv } from './loadEnv.ts';
import { resolvePlayable } from './resolvePlayable.ts';
import { download, DEFAULT_DEST_DIR } from './download.ts';

loadSandboxEnv();

const SMOKE = 2_000_000;

function parseArgs(argv) {
  const out = {
    smoke: false,
    tmdbId: 175,
    season: undefined,
    episode: undefined,
    title: undefined,
    destDir: undefined,
    help: false,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') out.help = true;
    else if (a === '--smoke') out.smoke = true;
    else if (a === '--dest') out.destDir = argv[++i];
    else if (a === '--title') out.title = argv[++i];
    else if (a === '--tv') {
      out.season = Number(argv[++i]);
      out.episode = Number(argv[++i]);
    } else if (!a.startsWith('-')) rest.push(a);
  }
  if (rest[0]) out.tmdbId = Number(rest[0]);
  return out;
}

function redact(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.slice(0, 40)}…`;
  } catch {
    return String(url).slice(0, 48);
  }
}

function isDownloadable(c) {
  if (c.kind === 'mp4') return true;
  if (c.kind === 'hls') return true;
  if (c.kind === 'unknown' && /\.mp4(\?|$)/i.test(c.url)) return true;
  return false;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Usage: node --experimental-strip-types sandbox/download-ux/stub/run-e2e.mjs [--smoke] [--tv S E] [tmdbId]
Requires sandbox/download-ux/.env with MOVIX_MAIN_API (+ MOVIX_ACCESS_KEY for HLS).`);
  process.exit(0);
}

if (!process.env.MOVIX_MAIN_API) {
  console.error(JSON.stringify({ error: 'MOVIX_MAIN_API manquant (.env)' }, null, 2));
  process.exit(1);
}

// Sandbox : resolve MP4 sans Turnstile
if (!process.env.MOVIX_USE_TV_MP4) process.env.MOVIX_USE_TV_MP4 = '1';

const media =
  args.season != null && args.episode != null
    ? {
        type: 'tv',
        tmdbId: args.tmdbId,
        season: args.season,
        episode: args.episode,
        title: args.title,
      }
    : { type: 'movie', tmdbId: args.tmdbId, title: args.title };

const resolveOpts = {
  mainApiBase: process.env.MOVIX_MAIN_API,
  accessKey: process.env.MOVIX_ACCESS_KEY,
  useTvMp4Resolve: process.env.MOVIX_USE_TV_MP4 === '1',
  // Explicit: stub off, real providers
  providers: ['swiftflow', 'watch-catalog'],
};

const all = await resolvePlayable(media, resolveOpts);
const candidates = all.filter(isDownloadable);

const summary = {
  media,
  vip: Boolean(process.env.MOVIX_ACCESS_KEY),
  resolved: all.length,
  downloadable: candidates.length,
  top: candidates.slice(0, 5).map((c) => ({
    id: c.id,
    source: c.source,
    hoster: c.hoster,
    kind: c.kind,
    quality: c.quality,
    score: c.score,
    url: redact(c.url),
  })),
};

if (!candidates.length) {
  console.log(JSON.stringify({ ...summary, result: { ok: false, error: 'no downloadable candidates' } }, null, 2));
  process.exit(1);
}

const result = await download(candidates, {
  destDir: args.destDir || DEFAULT_DEST_DIR,
  maxBytes: args.smoke ? SMOKE : undefined,
  skipIfExists: true,
  failover: true,
  onProgress: (p) => {
    if (p.phase === 'fetching' || p.phase === 'done') {
      process.stderr.write(`[dl] ${p.phase} ${p.message || ''} ${p.bytesReceived ?? ''}\n`);
    }
  },
});

console.log(JSON.stringify({ ...summary, result }, null, 2));
process.exit(result.ok ? 0 : 1);
