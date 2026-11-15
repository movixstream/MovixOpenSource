'use strict';

// Proxys French-Stream : un petit groupe stable par worker, au lieu d'un proxy
// tiré au hasard à chaque appel. Parmi les centaines de proxys ProxyScrape, le
// tirage ne retombait presque jamais sur un agent keep-alive déjà ouvert :
// chaque appel refaisait la connexion au proxy, sa négociation et la poignée
// de main TLS avec French-Stream (getPeerCertificate en tête du profil V8).
// Avec quelques proxys, les agents de fstreamAgentPool (un par proxy)
// réutilisent leurs connexions. Chaque place est renouvelée après `rotateMs`
// pour répartir la charge sur d'autres IP, et un proxy fautif quitte le groupe.
//
// La recherche (search.php) a sa propre limite : environ 22 appels par minute
// et par IP, comptés pour tous les domaines du site à la fois (fs16.lol,
// french-stream.net…) ; au-delà, 429 pendant moins d'une minute. Les pages et
// les autres appels AJAX n'entrent pas dans ce compte. Chaque IP du groupe
// garde une marge sous cette limite ; quand toutes l'ont atteinte, le groupe
// s'agrandit d'un proxy jusqu'à l'échéance de celui-ci.

const DEFAULT_GROUP_SIZE = 4;
const DEFAULT_ROTATE_MS = 3 * 60 * 1000;
const DEFAULT_SEARCH_LIMIT = 20;
const SEARCH_WINDOW_MS = 60 * 1000;
// Plafond du groupe agrandi par les recherches, en multiple de sa taille.
const MAX_GROWTH_FACTOR = 4;
// Repos d'un proxy écarté : long après un refus ou une limite, court après un
// délai dépassé ou une connexion impossible, souvent passagers.
const REFUSED_REST_MS = 2 * 60 * 1000;
const TRANSPORT_REST_MS = 30 * 1000;
const MAX_RESTING = 1000;
const BLOCKING_STATUSES = new Set([403, 407, 429]);
const SOCKET_RESET_CODES = new Set(['ECONNRESET', 'EPIPE']);

const positiveInteger = (value, fallback) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
};

// Socket keep-alive fermée par l'autre bout au moment d'être reprise : la
// requête peut repartir sur une connexion neuve, le proxy n'est pas en cause.
function isFStreamSocketReset(error) {
  return !error?.response && SOCKET_RESET_CODES.has(error?.code);
}

// Le proxy est en cause : refus (403, 407), limite (429), erreur 5xx, délai
// dépassé ou connexion impossible. Une page absente (404) prouve au contraire
// que le proxy fonctionne.
function isFStreamProxyFault(error) {
  const status = Number(error?.response?.status);
  if (status > 0) return BLOCKING_STATUSES.has(status) || status >= 500;
  return !isFStreamSocketReset(error);
}

/**
 * @param {{ getPools: () => Array<{ list: object[], type: string }> }} options
 *   getPools renvoie les listes de proxys courantes (modifiées sur place par
 *   proxyManager lors des rafraîchissements ProxyScrape).
 */
function createFStreamProxyPicker({
  getPools,
  size = positiveInteger(process.env.FSTREAM_PROXY_GROUP_SIZE, DEFAULT_GROUP_SIZE),
  rotateMs = positiveInteger(process.env.FSTREAM_PROXY_ROTATE_MS, DEFAULT_ROTATE_MS),
  searchLimit = positiveInteger(process.env.FSTREAM_PROXY_SEARCHES_PER_MIN, DEFAULT_SEARCH_LIMIT),
  now = Date.now,
  random = Math.random,
}) {
  let group = [];
  let cursor = 0;
  const resting = new Map();
  // L'IP seule : ProxyScrape donne chacune de ses IP en SOCKS5 et en HTTP, et
  // French-Stream compte par IP. Le groupe ne prend donc jamais les deux formes
  // d'une même IP, et un 429 sur l'une met aussi l'autre au repos.
  const keyOf = (_type, proxy) => String(proxy?.host);

  function rest(key, ms) {
    resting.delete(key);
    resting.set(key, now() + ms);
    if (resting.size > MAX_RESTING) {
      const time = now();
      for (const [other, until] of resting) if (until <= time) resting.delete(other);
      while (resting.size > MAX_RESTING) resting.delete(resting.keys().next().value);
    }
  }

  // Un proxy au repos ne sert qu'à défaut d'autre : jamais d'accès direct
  // imposé par le groupe tant que le pool contient un proxy.
  function draw(pools, total, taken, time) {
    let fallback = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      let index = Math.floor(random() * total);
      for (const { list, type } of pools) {
        if (index >= list.length) { index -= list.length; continue; }
        const proxy = list[index];
        const key = keyOf(type, proxy);
        if (!proxy || taken.has(key)) break;
        if ((resting.get(key) || 0) > time) { fallback ||= { key, proxy, type, resting: true }; break; }
        return { key, proxy, type };
      }
    }
    return fallback;
  }

  function currentPools() {
    const pools = (getPools() || []).filter(pool => Array.isArray(pool?.list) && pool.list.length > 0);
    return { pools, total: pools.reduce((sum, pool) => sum + pool.list.length, 0) };
  }

  function addMember(drawn, time) {
    const member = {
      key: drawn.key,
      // Échéances étalées : le groupe se renouvelle par petites touches.
      expiresAt: time + Math.round(rotateMs * (0.75 + random() * 0.5)),
      // Heures des recherches de la dernière minute, de la plus ancienne à la plus récente.
      searches: [],
    };
    member.entry = {
      proxy: drawn.proxy,
      type: drawn.type,
      // Appelé par withFStreamProxy à chaque échec de requête.
      onFailure(error) {
        if (!isFStreamProxyFault(error)) return;
        group = group.filter(other => other !== member);
        rest(member.key, error?.response ? REFUSED_REST_MS : TRANSPORT_REST_MS);
      },
    };
    group.push(member);
    return member;
  }

  function refill() {
    const time = now();
    if (group.some(member => member.expiresAt <= time)) {
      group = group.filter(member => member.expiresAt > time);
    }
    if (group.length >= size) return;
    const { pools, total } = currentPools();
    const taken = new Set(group.map(member => member.key));
    while (group.length < Math.min(size, total)) {
      const drawn = draw(pools, total, taken, time);
      if (!drawn) break;
      taken.add(drawn.key);
      addMember(drawn, time);
    }
  }

  function searchBudgetLeft(member, time) {
    const { searches } = member;
    while (searches.length > 0 && searches[0] <= time - SEARCH_WINDOW_MS) searches.shift();
    return searchLimit - searches.length;
  }

  // Tous les proxys du groupe ont atteint leur plafond : un proxy de plus, jamais
  // un proxy au repos (il vient de recevoir un refus ou une limite).
  function grow(time) {
    if (group.length >= size * MAX_GROWTH_FACTOR) return null;
    const { pools, total } = currentPools();
    if (group.length >= total) return null;
    const drawn = draw(pools, total, new Set(group.map(member => member.key)), time);
    return drawn && !drawn.resting ? addMember(drawn, time) : null;
  }

  return {
    // Jusqu'à `count` proxys distincts du groupe, en tourniquet : la requête
    // puis ses reprises éventuelles. Liste vide sans aucun proxy configuré.
    candidates(count = 1) {
      refill();
      if (group.length === 0) return [];
      const start = cursor % group.length;
      cursor = (start + 1) % group.length;
      const picked = [];
      for (let offset = 0; offset < Math.min(count, group.length); offset++) {
        picked.push(group[(start + offset) % group.length].entry);
      }
      return picked;
    },
    next() {
      return this.candidates(1)[0] || null;
    },
    // Proxy d'une recherche : le suivant du tourniquet qui n'a pas atteint son
    // plafond par minute. Si le groupe ne peut plus s'agrandir (pool épuisé),
    // celui dont le plafond se libère le plus tôt.
    nextSearch() {
      refill();
      const time = now();
      let chosen = null;
      for (let offset = 0; offset < group.length && !chosen; offset++) {
        const index = (cursor + offset) % group.length;
        if (searchBudgetLeft(group[index], time) > 0) {
          chosen = group[index];
          cursor = (index + 1) % group.length;
        }
      }
      chosen ||= grow(time);
      chosen ||= group.reduce((best, member) => (
        !best || (member.searches[0] ?? 0) < (best.searches[0] ?? 0) ? member : best
      ), null);
      if (!chosen) return null;
      chosen.searches.push(time);
      if (chosen.searches.length > searchLimit) chosen.searches.shift();
      return chosen.entry;
    },
    get size() {
      return group.length;
    },
  };
}

module.exports = {
  createFStreamProxyPicker,
  isFStreamProxyFault,
  isFStreamSocketReset,
};
