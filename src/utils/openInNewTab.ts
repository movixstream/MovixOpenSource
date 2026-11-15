/**
 * Ouvre une URL http(s) dans un nouvel onglet sans jamais lever d'exception.
 *
 * Safari jette « SyntaxError: The string did not match the expected pattern »
 * quand window.open reçoit une URL qu'il ne sait pas analyser (GlitchTip D9,
 * URL d'embed fournie par une source). Certaines WebView n'exposent pas
 * window.open ou le refusent. Renvoie false si rien n'a été ouvert.
 */
export const openInNewTab = (rawUrl: string | null | undefined, features = 'noopener'): boolean => {
  if (!rawUrl) return false;
  let url: URL;
  try {
    url = new URL(rawUrl, window.location.href);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  try {
    if (typeof window.open !== 'function') return false;
    window.open(url.href, '_blank', features);
    return true;
  } catch {
    return false;
  }
};
