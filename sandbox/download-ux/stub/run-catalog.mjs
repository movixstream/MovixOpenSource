/**
 * Resolve général catalogues visionnage (embeds / m3u8 si VIP).
 *
 *   MOVIX_MAIN_API=https://api.movix.miami \
 *     node sandbox/download-ux/stub/run-catalog.mjs 175
 *
 * Avec VIP (m3u8 via ?resolve=1) :
 *   MOVIX_ACCESS_KEY=… MOVIX_MAIN_API=… node … 175
 */

const base = process.env.MOVIX_MAIN_API?.replace(/\/+$/, '');
if (!base) {
  console.error(JSON.stringify({ error: 'MOVIX_MAIN_API manquant' }, null, 2));
  process.exit(1);
}

const tmdbId = Number(process.argv[2] || 175);
const media = { type: 'movie', tmdbId };
const accessKey = process.env.MOVIX_ACCESS_KEY || '';
const resolveQ = accessKey ? '?resolve=1' : '';

const paths = [
  `/api/wiflix/movie/${tmdbId}${resolveQ}`,
  `/api/fstream/movie/${tmdbId}${resolveQ}`,
  `/api/j1f/movie/${tmdbId}${resolveQ}`,
  `/api/swiftflow/movie/${tmdbId}${resolveQ}`,
];

function collect(data) {
  const out = [];
  const walk = (node, source) => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const p of node) {
        if (p && typeof p === 'object' && (p.url || p.m3u8Url)) {
          out.push({
            source,
            hoster: p.name || p.type || 'embed',
            kind: p.m3u8Url ? 'hls' : 'unknown',
            hasM3u8: Boolean(p.m3u8Url),
            url: p.m3u8Url || p.url,
          });
        }
      }
      return;
    }
    if (typeof node !== 'object') return;
    if (node.players) walk(node.players, source);
    if (node.vf) walk(node.vf, source);
    if (node.vostfr) walk(node.vostfr, source);
    if (node.links) walk(node.links, source);
  };
  walk(data, data.source || 'catalog');
  return out;
}

const summary = [];
for (const path of paths) {
  const res = await fetch(`${base}${path}`, {
    headers: {
      Accept: 'application/json',
      ...(accessKey ? { 'x-access-key': accessKey } : {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  const items = collect(data);
  summary.push({
    path,
    http: res.status,
    success: data.success,
    players: items.length,
    withM3u8: items.filter((i) => i.hasM3u8).length,
    sample: items.slice(0, 3).map((i) => ({
      hoster: i.hoster,
      kind: i.kind,
      urlHost: (() => {
        try {
          return new URL(i.url).host;
        } catch {
          return null;
        }
      })(),
    })),
  });
}

console.log(
  JSON.stringify(
    {
      goal: 'resolve général visionnage (pas /download DDL)',
      media,
      usedResolve1: Boolean(accessKey),
      debridNote:
        'Debrid (/api/media/debrid/unlock) = unlock liens hébergeurs DDL (1fichier…), parallèle Darki — pas le resolve embed lecture',
      catalogs: summary,
    },
    null,
    2,
  ),
);
