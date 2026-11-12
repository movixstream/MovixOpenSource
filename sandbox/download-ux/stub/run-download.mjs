/**
 * CLI — resolve (SwiftFlow) puis download MP4 réel (ksama-like).
 *
 * Prérequis resolve :
 *   export MOVIX_MAIN_API=https://api.movix.miami
 *   export MOVIX_USE_TV_MP4=1          # route TV sans Turnstile (sandbox)
 *
 * Usage :
 *   # Resolve movie 175 puis smoke-download (~2 Mo)
 *   node --experimental-strip-types sandbox/download-ux/stub/run-download.mjs --smoke 175
 *
 *   # URL déjà résolue
 *   node --experimental-strip-types sandbox/download-ux/stub/run-download.mjs --url 'https://cdn…/x.mp4' --smoke
 *
 *   # Stub no-op (pas de réseau)
 *   node --experimental-strip-types sandbox/download-ux/stub/run-download.mjs --stub
 *
 * Options :
 *   --smoke            maxBytes=2_000_000 (vérif bytes sans tirer 3 Go)
 *   --max-bytes N      plafond octets
 *   --dest DIR         dossier cible (défaut: sandbox/download-ux/tmp-downloads)
 *   --url URL          skip resolve ; télécharge cette URL mp4
 *   --tv S E           média série (saison / épisode)
 *   --stub             resolve stub local (no-op download)
 *   --title "…"        libellé fichier
 */

import { resolvePlayable } from './resolvePlayable.ts';
import { DEFAULT_DEST_DIR, download } from './download.ts';

const SMOKE_MAX_BYTES = 2_000_000;

function printHelp() {
  console.log(`Usage:
  node --experimental-strip-types sandbox/download-ux/stub/run-download.mjs [options] [tmdbId]

Options:
  --smoke            cap download at ${SMOKE_MAX_BYTES} bytes
  --max-bytes N      custom byte cap
  --dest DIR         output directory
  --url URL          download an already-resolved http(s) mp4 URL
  --tv SEASON EP     treat as TV episode
  --stub             stub resolve + no-op download (no MOVIX_MAIN_API)
  --title TEXT       filename label
  -h, --help         this help
`);
}

function parseArgs(argv) {
  const out = {
    smoke: false,
    maxBytes: undefined,
    destDir: undefined,
    url: undefined,
    stub: false,
    title: undefined,
    season: undefined,
    episode: undefined,
    tmdbId: undefined,
    help: false,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '-h' || a === '--help') out.help = true;
    else if (a === '--smoke') out.smoke = true;
    else if (a === '--stub') out.stub = true;
    else if (a === '--url') out.url = argv[++i];
    else if (a === '--dest') out.destDir = argv[++i];
    else if (a === '--title') out.title = argv[++i];
    else if (a === '--max-bytes') out.maxBytes = Number(argv[++i]);
    else if (a === '--tv') {
      out.season = Number(argv[++i]);
      out.episode = Number(argv[++i]);
    } else if (a.startsWith('-')) {
      throw new Error(`option inconnue: ${a}`);
    } else {
      rest.push(a);
    }
  }
  if (rest[0] != null) out.tmdbId = Number(rest[0]);
  return out;
}

function redactUrl(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.slice(0, 48)}${u.pathname.length > 48 ? '…' : ''}`;
  } catch {
    return String(url).slice(0, 64);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const maxBytes = args.smoke
    ? args.maxBytes || SMOKE_MAX_BYTES
    : args.maxBytes;

  const downloadOptions = {
    destDir: args.destDir || DEFAULT_DEST_DIR,
    skipIfExists: true,
    maxBytes,
    onProgress: (p) => {
      if (p.phase === 'writing' && p.bytesReceived != null) {
        const total = p.bytesTotal != null ? `/${p.bytesTotal}` : '';
        process.stderr.write(`\r  ${p.bytesReceived}${total} bytes  `);
      }
    },
  };

  if (args.url) {
    const candidate = {
      id: 'cli-url',
      media: {
        type: 'movie',
        tmdbId: args.tmdbId || 0,
        title: args.title || 'direct-url',
      },
      hoster: 'cli',
      source: 'cli',
      kind: 'mp4',
      url: args.url,
    };
    // MediaRef exige tmdbId > 0 seulement via resolvePlayable — download accepte.
    if (!candidate.media.tmdbId) candidate.media.tmdbId = 1;
    const result = await download(candidate, downloadOptions);
    process.stderr.write('\n');
    console.log(
      JSON.stringify(
        {
          mode: 'url',
          url: redactUrl(args.url),
          maxBytes: maxBytes ?? null,
          destDir: downloadOptions.destDir,
          result,
        },
        null,
        2,
      ),
    );
    process.exit(result.ok ? 0 : 1);
  }

  if (args.stub) {
    const media = {
      type: 'movie',
      tmdbId: args.tmdbId || 550,
      title: args.title || 'Fight Club (stub)',
    };
    const candidates = await resolvePlayable(media, {
      providers: ['stub'],
      mode: 'stub-ok',
    });
    const result = await download(candidates, downloadOptions);
    process.stderr.write('\n');
    console.log(
      JSON.stringify(
        {
          mode: 'stub',
          media,
          candidates: candidates.map((c) => ({ ...c, url: redactUrl(c.url) })),
          result,
        },
        null,
        2,
      ),
    );
    process.exit(result.ok ? 0 : 1);
  }

  const base = (process.env.MOVIX_MAIN_API || '').trim();
  if (!base) {
    console.error(
      JSON.stringify(
        {
          error: 'MOVIX_MAIN_API manquant (ou passez --url / --stub)',
          hint: 'export MOVIX_MAIN_API=https://api.movix.miami',
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  const tmdbId = args.tmdbId || 175;
  const isTv = args.season != null && args.episode != null;
  const media = isTv
    ? {
        type: 'tv',
        tmdbId,
        season: args.season,
        episode: args.episode,
        title: args.title,
      }
    : { type: 'movie', tmdbId, title: args.title };

  const useTvMp4 =
    process.env.MOVIX_USE_TV_MP4 === '1' ||
    process.env.MOVIX_USE_TV_MP4 === 'true' ||
    isTv;

  const resolveOptions = {
    providers: ['swiftflow'],
    mainApiBase: base,
    useTvMp4Resolve: useTvMp4,
    accessKey: process.env.MOVIX_ACCESS_KEY || undefined,
    turnstileToken: process.env.MOVIX_TURNSTILE_TOKEN || undefined,
  };

  process.stderr.write(
    `resolve ${media.type}/${media.tmdbId} via swiftflow (useTvMp4=${useTvMp4})…\n`,
  );
  const candidates = await resolvePlayable(media, resolveOptions);
  if (!candidates.length) {
    console.log(
      JSON.stringify(
        {
          media,
          candidates: [],
          error: 'aucun candidat — titre absent SwiftFlow ou resolve échoué',
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  process.stderr.write(
    `download ${candidates.length} candidat(s), maxBytes=${maxBytes ?? '∞'}…\n`,
  );
  const result = await download(candidates, downloadOptions);
  process.stderr.write('\n');

  console.log(
    JSON.stringify(
      {
        goal: 'visionnage → resolve → download (pas /download DDL)',
        media,
        maxBytes: maxBytes ?? null,
        destDir: downloadOptions.destDir,
        candidates: candidates.map((c) => ({
          id: c.id,
          source: c.source,
          hoster: c.hoster,
          kind: c.kind,
          quality: c.quality,
          score: c.score,
          url: redactUrl(c.url),
        })),
        result,
      },
      null,
      2,
    ),
  );
  process.exit(result.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(JSON.stringify({ error: String(e?.message || e) }, null, 2));
  process.exit(1);
});
