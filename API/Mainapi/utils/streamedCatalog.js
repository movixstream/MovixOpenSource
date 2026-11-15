const { createLiveTvRefresh } = require('./liveTvCache');
const { isPublicHttpUrl } = require('./mediaSigning');

// Streamed (streamed.pk) a fermé : les catalogues « streamed_* » viennent de PPV.
const PPV_API = 'https://api.ppv.st';
const MATCH_TTL = 60000;
const STALE_TTL = 5 * 60000;

// Le manifeste reste disponible si PPV tombe.
const SPORTS = [
  ['all', 'Tous les sports', '🏅'],
  ['football', 'Football', '⚽'],
  ['basketball', 'Basketball', '🏀'],
  ['american-football', 'Football américain', '🏈'],
  ['hockey', 'Hockey', '🏒'],
  ['baseball', 'Baseball', '⚾'],
  ['motor-sports', 'Sports mécaniques', '🏎️'],
  ['fight', 'Sports de combat', '🥊'],
  ['tennis', 'Tennis', '🎾'],
  ['rugby', 'Rugby', '🏉'],
  ['golf', 'Golf', '⛳'],
  ['billiards', 'Billard', '🎱'],
  ['afl', 'Football australien', '🏉'],
  ['darts', 'Fléchettes', '🎯'],
  ['cricket', 'Cricket', '🏏'],
  ['other', 'Autres sports', '🏟️'],
];
const SPORT_BY_ID = new Map(SPORTS.map(([key, name, emoji]) => [key, { key, name, emoji }]));
const STREAMED_CATALOGS = SPORTS.map(([key, name, emoji]) => ({
  id: `streamed_${key}`, type: 'tv', name, _emoji: emoji, _free: true,
}));

// Noms de catégorie PPV (anglais) vers les clés des catalogues.
const CATEGORY_KEYS = new Map([
  ['football', 'football'], ['soccer', 'football'],
  ['basketball', 'basketball'],
  ['american football', 'american-football'],
  ['ice hockey', 'hockey'], ['hockey', 'hockey'],
  ['baseball', 'baseball'],
  ['motorsports', 'motor-sports'], ['motor sports', 'motor-sports'], ['formula 1', 'motor-sports'],
  ['f1', 'motor-sports'], ['motogp', 'motor-sports'], ['nascar', 'motor-sports'],
  ['combat sports', 'fight'], ['fighting', 'fight'], ['boxing', 'fight'], ['mma', 'fight'],
  ['ufc', 'fight'], ['wrestling', 'fight'], ['wwe', 'fight'],
  ['tennis', 'tennis'],
  ['rugby', 'rugby'],
  ['golf', 'golf'],
  ['billiards', 'billiards'], ['snooker', 'billiards'],
  ['australian football', 'afl'], ['afl', 'afl'],
  ['darts', 'darts'],
  ['cricket', 'cricket'],
]);
const sportOf = category =>
  SPORT_BY_ID.get(CATEGORY_KEYS.get(String(category || '').trim().toLowerCase())) || SPORT_BY_ID.get('other');

const isMatchId = value => typeof value === 'string' && /^[0-9]{1,12}$/.test(value);
const embedUrl = value =>
  typeof value === 'string' && value.startsWith('https://') && isPublicHttpUrl(value) ? value : '';

function parseMatch(item, nowSeconds) {
  const sport = sportOf(item.category_name);
  const start = Number(item.starts_at);
  const end = Number(item.ends_at);
  const isLive = start <= nowSeconds && nowSeconds < end;
  const [home = '', away = ''] = item.name.split(/\s+vs\.?\s+/i);
  return {
    id: `streamed_${item.id}`,
    type: 'tv',
    name: item.name,
    poster: embedUrl(item.poster),
    genres: [sport.name.toLowerCase()],
    _timestamp: start * 1000,
    _isLive: isLive,
    _status: isLive ? 'live' : 'upcoming',
    _serverCount: 1 + (Array.isArray(item.substreams) ? item.substreams.length : 0),
    _sport: sport.name,
    _sportKey: sport.key,
    _emoji: sport.emoji,
    _homeTeam: away ? home.trim() : '',
    _awayTeam: away.trim(),
    _homeLogo: '',
    _awayLogo: '',
  };
}

function createStreamedSource({ axios, readCache, writeCache, now = Date.now }) {
  const refresh = createLiveTvRefresh({ now });

  async function cached(key, ttl, load) {
    const hit = await readCache(key, ttl);
    if (hit) return hit;
    return refresh(key, async () => {
      const fresh = await readCache(key, ttl);
      if (fresh) return fresh;
      const value = await load();
      if (!await writeCache(key, value)) throw new Error('Publication du cache PPV impossible');
      return value;
    }, () => readCache(key, STALE_TTL));
  }

  // Une seule liste donne matchs, horaires et lecteurs : pas d'appel par match.
  const getMatches = () => cached('ppv_matches_v1', MATCH_TTL, async () => {
    const { data } = await axios.get(`${PPV_API}/api/streams`, {
      headers: { Accept: 'application/json' },
      timeout: 10000,
      maxContentLength: 5 * 1024 * 1024,
    });
    if (!data?.success || !Array.isArray(data.streams)) throw new Error('Réponse PPV invalide');
    const matches = new Map();
    for (const category of data.streams) {
      // Les chaînes 24/7 ne sont pas des matchs.
      if (category?.always_live || !Array.isArray(category.streams)) continue;
      for (const item of category.streams) {
        const id = String(item?.id ?? '');
        if (!isMatchId(id) || item.always_live || typeof item.name !== 'string' || !item.name.trim() ||
            !Number.isFinite(Number(item.starts_at)) || !Number.isFinite(Number(item.ends_at))) continue;
        matches.set(id, {
          id: Number(id), name: item.name.trim(), category_name: item.category_name || category.category,
          poster: item.poster, starts_at: Number(item.starts_at), ends_at: Number(item.ends_at),
          locale: item.locale, tag: item.tag, source_tag: item.source_tag, iframe: item.iframe,
          substreams: (Array.isArray(item.substreams) ? item.substreams : []).slice(0, 15).map(sub => ({
            locale: sub?.locale, source_tag: sub?.source_tag, iframe: sub?.iframe,
          })),
        });
      }
    }
    return { matches: [...matches.values()] };
  });

  async function getCatalog(catalogId) {
    const category = catalogId.slice('streamed_'.length);
    if (!catalogId.startsWith('streamed_') || !SPORT_BY_ID.has(category)) return [];
    const { matches } = await getMatches();
    const nowSeconds = now() / 1000;
    return matches
      .filter(item => item.ends_at > nowSeconds)
      .map(item => parseMatch(item, nowSeconds))
      .filter(match => category === 'all' || match._sportKey === category)
      .sort((a, b) => Number(b._isLive) - Number(a._isLive) || a._timestamp - b._timestamp);
  }

  async function getStreams(channelId) {
    const matchId = channelId.slice('streamed_'.length);
    if (!channelId.startsWith('streamed_') || !isMatchId(matchId)) return [];
    const { matches } = await getMatches();
    const match = matches.find(item => String(item.id) === matchId);
    if (!match) return [];
    const seen = new Set();
    const streams = [];
    for (const ref of [match, ...match.substreams]) {
      const url = embedUrl(ref.iframe);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const locale = typeof ref.locale === 'string' ? ref.locale.trim() : '';
      const label = typeof ref.source_tag === 'string' ? ref.source_tag.trim() : '';
      streams.push({
        title: [label || `PPV ${streams.length + 1}`, locale].filter(Boolean).join(' · '),
        url, _isEmbed: true,
        behaviorHints: { notWebReady: false },
      });
    }
    return streams;
  }

  return { getCatalog, getStreams };
}

module.exports = { createStreamedSource, STREAMED_CATALOGS };
