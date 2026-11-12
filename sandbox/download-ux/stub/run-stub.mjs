/**
 * Démo CLI — resolve multi-sources (stub actif) → rank → download.
 *
 *   node sandbox/download-ux/stub/run-stub.mjs
 *   node sandbox/download-ux/stub/run-stub.mjs empty
 *   node sandbox/download-ux/stub/run-stub.mjs fail
 *   node sandbox/download-ux/stub/run-stub.mjs providers
 */

const ALL_PROVIDER_IDS = [
  'stub',
  'swiftflow',
  'wiflix',
  'fstream',
  'j1f',
  'coflix',
  'cpasmal',
  'voirdrama',
  'animeSama',
  'frenchstream',
];

function assertMediaRef(media) {
  if (media.type !== 'movie' && media.type !== 'tv') {
    throw new Error(`MediaRef.type invalide: ${media.type}`);
  }
  if (!Number.isInteger(media.tmdbId) || media.tmdbId <= 0) {
    throw new Error(`MediaRef.tmdbId invalide: ${media.tmdbId}`);
  }
  if (media.type === 'tv' && media.episode != null && media.season == null) {
    throw new Error('MediaRef.episode exige MediaRef.season');
  }
  if (media.type === 'movie' && (media.season != null || media.episode != null)) {
    throw new Error('MediaRef movie ne doit pas porter season/episode');
  }
}

function scoreCandidate(c) {
  const kind = c.kind === 'mp4' ? 3000 : c.kind === 'hls' ? 1000 : 0;
  const quality = typeof c.quality === 'number' ? c.quality : 0;
  return kind + quality;
}

function rankCandidates(candidates) {
  return [...candidates]
    .map((c) => ({ ...c, score: scoreCandidate(c) }))
    .sort((a, b) => b.score - a.score);
}

/** Simule registry : seul stub enabled pour l’instant. */
async function resolveFromProviders(media, options = {}) {
  assertMediaRef(media);
  const mode = options.mode ?? 'stub-ok';
  const filter = options.providers;
  const enabled = filter?.length ? filter : ['stub'];

  const out = [];
  for (const id of enabled) {
    if (id !== 'stub') continue; // placeholders → []
    if (mode === 'stub-fail') {
      throw new Error('stub-fail: resolvePlayable a simulé une panne infra');
    }
    if (mode === 'stub-empty') continue;
    const label = media.title || `movie/${media.tmdbId}`;
    out.push({
      id: `stub-${media.tmdbId}`,
      media: { ...media },
      hoster: 'stub',
      source: 'stub',
      kind: 'mp4',
      quality: 1080,
      url: `https://stub.local/playable/${encodeURIComponent(label)}.mp4`,
    });
  }
  return rankCandidates(out);
}

async function download(candidates, options = {}) {
  const list = Array.isArray(candidates) ? candidates : [candidates];
  let attempts = 0;
  for (const candidate of list) {
    attempts += 1;
    options.onProgress?.({ phase: 'fetching', message: candidate.source });
    const url = String(candidate.url || '').toLowerCase();
    if (url.includes('fail')) {
      continue;
    }
    if (url.includes('skip')) {
      return { ok: true, status: 'skipped', candidateId: candidate.id, skipped: true, attempts };
    }
    return {
      ok: true,
      status: 'completed',
      candidateId: candidate.id,
      message: `stub completed via ${candidate.source} (no file written)`,
      score: candidate.score,
      attempts,
    };
  }
  return { ok: false, status: 'failed', candidateId: '', error: 'no candidates', attempts };
}

const modeArg = process.argv[2] || 'ok';

if (modeArg === 'providers') {
  console.log(
    JSON.stringify(
      {
        goal: 'Remplacer /download DDL par visionnage → resolve → download',
        activeNow: ['stub', process.env.MOVIX_MAIN_API ? 'swiftflow' : null].filter(Boolean),
        implemented: ['stub', 'swiftflow'],
        todoResolve: ALL_PROVIDER_IDS.filter((id) => id !== 'stub' && id !== 'swiftflow'),
        testSwiftflow: 'MOVIX_MAIN_API=… node sandbox/download-ux/stub/run-swiftflow.mjs [--tv] <tmdbId>',
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const mode =
  modeArg === 'empty' ? 'stub-empty' : modeArg === 'fail' ? 'stub-fail' : 'stub-ok';

const media = { type: 'movie', tmdbId: 550, title: 'Fight Club (stub)' };

try {
  const candidates = await resolveFromProviders(media, { mode });
  const result = await download(candidates, {});
  console.log(JSON.stringify({ mode, candidates, result, registry: ALL_PROVIDER_IDS }, null, 2));
  process.exit(result.ok || result.error === 'no candidates' ? 0 : 1);
} catch (err) {
  console.error(JSON.stringify({ mode, error: String(err?.message || err) }, null, 2));
  process.exit(mode === 'stub-fail' ? 0 : 1);
}
