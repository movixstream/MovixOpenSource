const { createLiveTvRefresh } = require('./liveTvCache');
const { isPublicHttpUrl } = require('./mediaSigning');
const { createHash } = require('node:crypto');

const STREAMED_BASE = 'https://streamed.pk';
const MATCH_TTL = 60000;
const STREAM_TTL = 30000;
const STALE_TTL = 5 * 60000;
// /live met parfois plus d'une heure à inclure un match commencé.
const STARTED_GRACE = 3 * 3600000;
const SOURCE_ORDER = new Map([['golf', 0], ['foxtrot', 1]]);

// Identifiants de /api/sports ; le manifeste reste disponible si Streamed tombe.
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

const isMatchId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,250}$/.test(value);
const matchSources = match => {
  const seen = new Set();
  return (Array.isArray(match.sources) ? match.sources : []).filter(ref => {
    if (!ref || typeof ref.source !== 'string' || !/^[a-z0-9-]{1,32}$/.test(ref.source) ||
        typeof ref.id !== 'string' || !ref.id || ref.id.length > 500 || ref.id === '.' || ref.id === '..') return false;
    const key = `${ref.source}:${ref.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 16);
};

function imageUrl(value, badge = false) {
  if (typeof value !== 'string' || !value) return '';
  if (badge) return `${STREAMED_BASE}/api/images/badge/${encodeURIComponent(value)}.webp`;
  try {
    const url = new URL(value, STREAMED_BASE);
    if (url.origin !== STREAMED_BASE || !url.pathname.startsWith('/api/images/')) return '';
    if (!url.pathname.endsWith('.webp')) url.pathname += '.webp';
    return url.href;
  } catch { return ''; }
}

function parseMatch(match, liveIds) {
  const sport = SPORT_BY_ID.get(match.category) || SPORT_BY_ID.get('other');
  const timestamp = Number(match.date);
  const isLive = liveIds.has(match.id);
  const home = match.teams?.home;
  const away = match.teams?.away;
  return {
    id: `streamed_${match.id}`,
    type: 'tv',
    name: match.title,
    poster: imageUrl(match.poster) || imageUrl(home?.badge, true),
    genres: [sport.name.toLowerCase()],
    _timestamp: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : undefined,
    _isLive: isLive,
    _status: isLive ? 'live' : 'upcoming',
    _serverCount: matchSources(match).length,
    _sport: sport.name,
    _sportKey: sport.key,
    _emoji: sport.emoji,
    _homeTeam: home?.name || '',
    _awayTeam: away?.name || '',
    _homeLogo: imageUrl(home?.badge, true),
    _awayLogo: imageUrl(away?.badge, true),
  };
}

function createStreamedSource({ axios, readCache, writeCache, now = Date.now }) {
  const refresh = createLiveTvRefresh({ now });

  async function request(pathname) {
    const { data } = await axios.get(`${STREAMED_BASE}${pathname}`, {
      headers: { Accept: 'application/json' },
      timeout: 10000,
      maxContentLength: 5 * 1024 * 1024,
    });
    if (!Array.isArray(data)) throw new Error('Réponse Streamed invalide');
    return data;
  }

  async function cached(key, ttl, load) {
    const hit = await readCache(key, ttl);
    if (hit) return hit;
    return refresh(key, async () => {
      const fresh = await readCache(key, ttl);
      if (fresh) return fresh;
      const value = await load();
      if (!await writeCache(key, value)) throw new Error('Publication du cache Streamed impossible');
      return value;
    }, () => readCache(key, STALE_TTL));
  }

  const getMatches = () => cached('matches_v1', MATCH_TTL, async () => {
    // /live fait foi : l'heure de début seule ne prouve pas qu'un match joue.
    const [all, live] = await Promise.all([request('/api/matches/all'), request('/api/matches/live')]);
    const valid = match => match && isMatchId(match.id) && typeof match.title === 'string' && match.title.trim();
    return {
      matches: [...new Map([...all, ...live].filter(valid).map(match => [match.id, match])).values()],
      liveIds: live.filter(valid).map(match => match.id),
    };
  });

  async function getCatalog(catalogId) {
    const category = catalogId.slice('streamed_'.length);
    if (!catalogId.startsWith('streamed_') || !SPORT_BY_ID.has(category)) return [];
    const { matches, liveIds } = await getMatches();
    const live = new Set(liveIds);
    return matches
      .filter(match => (category === 'all' || match.category === category) &&
        (live.has(match.id) || Number(match.date) >= now() - STARTED_GRACE))
      .map(match => parseMatch(match, live))
      .sort((a, b) => Number(b._isLive) - Number(a._isLive) || (a._timestamp || 0) - (b._timestamp || 0));
  }

  async function getStreams(channelId) {
    const matchId = channelId.slice('streamed_'.length);
    if (!channelId.startsWith('streamed_') || !isMatchId(matchId)) return [];
    const { matches } = await getMatches();
    const match = matches.find(item => item.id === matchId);
    if (!match) return [];

    return cached(`streams_${matchId}_v2`, STREAM_TTL, async () => {
      // Golf puis Foxtrot ; les autres sources gardent leur ordre amont.
      const refs = matchSources(match).sort((a, b) =>
        (SOURCE_ORDER.get(a.source) ?? SOURCE_ORDER.size) - (SOURCE_ORDER.get(b.source) ?? SOURCE_ORDER.size));
      if (!refs.length) return [];
      const results = await Promise.allSettled(refs.map(ref =>
        request(`/api/stream/${ref.source}/${encodeURIComponent(ref.id)}`)));
      const seen = new Set();
      const streams = [];
      results.forEach((result, index) => {
        if (result.status !== 'fulfilled') return;
        for (const stream of result.value) {
          const url = stream?.embedUrl;
          if (typeof url !== 'string' || !url.startsWith('https://') || !isPublicHttpUrl(url) || seen.has(url)) continue;
          seen.add(url);
          const language = typeof stream.language === 'string' ? stream.language.trim() : '';
          streams.push({
            _streamedKey: createHash('sha256').update(url).digest('hex').slice(0, 24),
            title: [refs[index].source, stream.streamNo, language, stream.hd ? 'HD' : 'SD'].filter(Boolean).join(' · '),
            url, _isEmbed: true,
            behaviorHints: { notWebReady: false },
          });
        }
      });
      if (!streams.length && results.some(result => result.status === 'rejected')) {
        throw new Error('Lecteurs Streamed indisponibles');
      }
      return streams;
    });
  }

  return { getCatalog, getStreams };
}

module.exports = { createStreamedSource, STREAMED_CATALOGS };
