/**
 * Lecteurs qu'anime-sama marque « hors service » (en rouge sur son site).
 *
 * Chaque page de saison publie `var lecteursInfos = {…}` : domaine de
 * l'hébergeur → nom, badges, et `mort: true` quand il ne marche plus. Ces
 * lecteurs ne doivent jamais entrer dans la liste Movix : on lit la même table
 * que le site et on applique la même règle (domaine exact, puis domaine
 * parent : video.sibnet.ru → sibnet.ru ; la première entrée trouvée décide).
 */

// Relevé du 2026-10-19 : sert tant qu'aucune page de saison n'a été lue (ou si
// la table disparaît du site) ; la table lue sur le site la remplace ensuite.
const FALLBACK_HOST_STATUS = new Map([
  ['sibnet.ru', true],
  ['oneupload.to', true],
  ['embed4me.com', true],
  ['player4me.com', true],
  ['4meplayer.com', true],
  ['myvi.top', true],
]);

const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const RETRY_AFTER_FAILURE_MS = 5 * 60 * 1000;

// Table `lecteursInfos` d'une page de saison → Map domaine → hors service ?
// null si la page ne la contient pas ou si elle est illisible.
function parseHostStatus(html) {
  if (typeof html !== 'string') return null;
  const match = html.match(/lecteursInfos\s*=\s*(\{[\s\S]*?\})\s*;/);
  if (!match) return null;
  let infos;
  try {
    infos = JSON.parse(match[1]);
  } catch {
    return null;
  }
  if (!infos || typeof infos !== 'object' || Array.isArray(infos)) return null;
  const status = new Map();
  for (const [domain, info] of Object.entries(infos)) {
    status.set(domain.toLowerCase().replace(/^www\./, ''), Boolean(info && info.mort === true));
  }
  return status.size ? status : null;
}

function isDeadPlayerUrl(url, hostStatus) {
  if (typeof url !== 'string' || !hostStatus || !hostStatus.size) return false;
  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return false;
  }
  const labels = hostname.split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    const domain = labels.slice(i).join('.');
    if (hostStatus.has(domain)) return hostStatus.get(domain);
  }
  return false;
}

/**
 * Table tenue à jour depuis une page de saison, relue au plus une fois par
 * heure. Un échec garde la table connue (ou le relevé de secours) et réessaie
 * 5 min plus tard ; il ne bloque jamais l'actualisation des épisodes.
 */
function createDeadPlayerList({ request = null, now = Date.now, logger = console } = {}) {
  let hostStatus = FALLBACK_HOST_STATUS;
  let nextRefreshAt = 0;
  let inflight = null;

  async function load(pageUrl) {
    try {
      // Même requête que la page catalogue ; seule une table lisible compte.
      const response = await request({ method: 'get', url: pageUrl, timeout: 10000 });
      const parsed = parseHostStatus(response?.data);
      if (!parsed) throw new Error(`table lecteursInfos absente (HTTP ${response?.status ?? '?'})`);
      hostStatus = parsed;
      nextRefreshAt = now() + REFRESH_INTERVAL_MS;
    } catch (error) {
      nextRefreshAt = now() + RETRY_AFTER_FAILURE_MS;
      logger?.warn?.(`[ANIME-SAMA] Lecteurs hors service non relus : ${String(error?.message || error).slice(0, 120)}`);
    }
    return hostStatus;
  }

  return {
    current: () => hostStatus,
    // Page de saison déjà lue ailleurs (langues publiées) : sa table remplace
    // la table connue sans nouvelle requête. Sans table lisible, rien ne change.
    learn(html) {
      const parsed = parseHostStatus(html);
      if (!parsed) return false;
      hostStatus = parsed;
      nextRefreshAt = now() + REFRESH_INTERVAL_MS;
      return true;
    },
    async refresh(pageUrl) {
      if (typeof request !== 'function' || !pageUrl || now() < nextRefreshAt) return hostStatus;
      if (!inflight) inflight = load(pageUrl).finally(() => { inflight = null; });
      return inflight;
    },
  };
}

module.exports = {
  FALLBACK_HOST_STATUS,
  parseHostStatus,
  isDeadPlayerUrl,
  createDeadPlayerList,
};
