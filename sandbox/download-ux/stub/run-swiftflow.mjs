/**
 * Test réel SwiftFlow (pipeline visionnage → MP4), pas `/download`.
 *
 * Prérequis :
 *   export MOVIX_MAIN_API=https://ton-main-api
 * Optionnel (route web Turnstile) :
 *   export MOVIX_TURNSTILE_TOKEN=...
 *   export MOVIX_ACCESS_KEY=...   # VIP si besoin ailleurs
 *
 * Pour sandbox sans captcha (route télé) :
 *   node ... --tv 550
 *
 * Usage :
 *   node sandbox/download-ux/stub/run-swiftflow.mjs 550
 *   node sandbox/download-ux/stub/run-swiftflow.mjs --tv 1396 1 1
 */

const base = process.env.MOVIX_MAIN_API?.replace(/\/+$/, '');
if (!base) {
  console.error(JSON.stringify({
    error: 'MOVIX_MAIN_API manquant',
    hint: 'export MOVIX_MAIN_API=https://… puis relancer',
    goal: 'Remplacer /download DDL par resolve visionnage (SwiftFlow MP4 en P0)',
  }, null, 2));
  process.exit(1);
}

const args = process.argv.slice(2);
const useTv = args.includes('--tv');
const nums = args.filter((a) => a !== '--tv').map(Number);

let media;
if (useTv || nums.length >= 3) {
  const [tmdbId, season, episode] = useTv ? nums : nums;
  media = { type: 'tv', tmdbId, season, episode };
} else {
  media = { type: 'movie', tmdbId: nums[0] || 550 };
}

function joinUrl(b, p) {
  return `${b.replace(/\/+$/, '')}/${p.replace(/^\/+/, '')}`;
}

function parseQuality(raw) {
  if (!raw) return undefined;
  const m = String(raw).match(/(\d{3,4})/);
  return m ? Number(m[1]) : undefined;
}

async function main() {
  const catalogPath =
    media.type === 'movie'
      ? `/api/swiftflow/movie/${media.tmdbId}`
      : `/api/swiftflow/tv/${media.tmdbId}/season/${media.season}?episode=${media.episode}`;

  const catRes = await fetch(joinUrl(base, catalogPath), {
    headers: {
      Accept: 'application/json',
      ...(process.env.MOVIX_ACCESS_KEY
        ? { 'x-access-key': process.env.MOVIX_ACCESS_KEY }
        : {}),
    },
  });
  const catalog = await catRes.json();
  const entries = catalog?.mp4?.available ? catalog.mp4.entries || [] : [];

  if (!entries.length) {
    console.log(JSON.stringify({
      media,
      catalogOk: catRes.ok,
      success: catalog?.success,
      mp4: catalog?.mp4 || null,
      candidates: [],
      note: 'Aucun MP4 catalogue — titre absent SwiftFlow ou cache froid',
    }, null, 2));
    process.exit(0);
  }

  const resolvePath = useTv || process.env.MOVIX_USE_TV_MP4 === '1'
    ? '/api/swiftflow/tv/mp4/resolve'
    : '/api/swiftflow/mp4/resolve';

  const candidates = [];
  for (const entry of entries) {
    const body = {
      kind: media.type,
      tmdbId: media.tmdbId,
      index: entry.index,
      ...(media.type === 'tv'
        ? { season: media.season, episode: media.episode }
        : {}),
      ...(!resolvePath.includes('/tv/')
        ? { turnstileToken: process.env.MOVIX_TURNSTILE_TOKEN || '' }
        : {}),
    };
    const r = await fetch(joinUrl(base, resolvePath), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(process.env.MOVIX_ACCESS_KEY
          ? { 'x-access-key': process.env.MOVIX_ACCESS_KEY }
          : {}),
      },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (r.ok && data?.success && data.url) {
      candidates.push({
        id: `swiftflow-${media.tmdbId}-${entry.index}`,
        source: 'swiftflow',
        hoster: 'swiftflow-mp4',
        kind: 'mp4',
        quality: parseQuality(data.quality || entry.quality),
        label: data.label || entry.label,
        url: data.url,
        // Ne pas logger l’URL complète en CI publique si besoin — ici sandbox local OK
      });
    } else {
      candidates.push({
        index: entry.index,
        resolveFailed: true,
        status: r.status,
        error: data?.error || 'resolve failed',
      });
    }
  }

  console.log(JSON.stringify({
    goal: 'visionnage → download (plus /download DDL)',
    media,
    resolvePath,
    entryCount: entries.length,
    candidates,
  }, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ error: String(e?.message || e) }, null, 2));
  process.exit(1);
});
