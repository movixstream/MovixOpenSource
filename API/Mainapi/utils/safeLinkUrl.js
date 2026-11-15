/**
 * Contrôle du schéma des liens proposés par les membres ou saisis par
 * l'équipe. Ces liens finissent dans un `<iframe src>` ou un `window.open`
 * du site : un `javascript:` (ou `data:`) s'y exécuterait sur l'origine
 * Movix, avec accès à la session du visiteur. Seuls http et https passent.
 */

const HTTP_PROTOCOLS = new Set(['http:', 'https:']);

function hasHttpProtocol(value) {
  try {
    return HTTP_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

/** URL absolue en http(s) : la règle pour tout lien qu'on enregistre. */
function isHttpUrl(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return Boolean(trimmed) && hasHttpProtocol(trimmed);
}

/**
 * Lien déjà stocké : chaîne nue ou objet `{ url, ... }`. Les anciennes entrées
 * sans schéma (`//hote/chemin`) restent servies, le navigateur les charge en
 * https.
 */
function isHttpLinkEntry(link) {
  const url = typeof link === 'string' ? link : link && typeof link === 'object' ? link.url : null;
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  return hasHttpProtocol(trimmed.startsWith('//') ? `https:${trimmed}` : trimmed);
}

/** Lien reçu de l'équipe (chaîne ou objet `{ url }`) : URL absolue exigée. */
function isHttpLinkInput(link) {
  return isHttpUrl(typeof link === 'string' ? link : link && typeof link === 'object' ? link.url : null);
}

module.exports = { isHttpUrl, isHttpLinkEntry, isHttpLinkInput };
