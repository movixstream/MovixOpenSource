// En-têtes de sécurité du site, partagés par le serveur Hono (Coolify,
// server/index.js) et les Functions Cloudflare Pages (functions/_middleware.js).
// Ils reprennent ceux du Main API (API/Mainapi/middleware/security.js), plus
// HSTS et une CSP.
//
// La CSP reste volontairement large : les lecteurs sont des iframes de dizaines
// d'hébergeurs, hls.js lit des segments sur n'importe quel CDN, et les applis
// mobiles passent par un proxy local en http://127.0.0.1. Elle bloque ce qui
// ne sert jamais ici : plugins (<object>), <base> détourné, scripts en http,
// et l'intégration du site dans une iframe d'un autre domaine.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self' https: data: blob:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https: blob:",
  "style-src 'self' 'unsafe-inline' https:",
  "img-src 'self' https: http: data: blob:",
  "media-src 'self' https: http: data: blob:",
  "font-src 'self' https: data:",
  "connect-src 'self' https: http: wss: ws: data: blob:",
  "frame-src 'self' https: http: data: blob:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
].join('; ');

export const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  // Pas de includeSubDomains : un sous-domaine encore servi en http serait
  // coupé pendant un an.
  'Strict-Transport-Security': 'max-age=31536000',
  'X-Content-Type-Options': 'nosniff',
  // SAMEORIGIN plutôt que DENY : le site peut s'intégrer lui-même.
  'X-Frame-Options': 'SAMEORIGIN',
  'X-XSS-Protection': '0',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
});

/** Ajoute les en-têtes à une Response sans écraser ceux déjà posés. */
export function withSecurityHeaders(response) {
  let res = response;
  try {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      if (!res.headers.has(name)) res.headers.set(name, value);
    }
  } catch {
    // Headers immuables (réponse de fetch ou d'asset) : on recopie.
    res = new Response(response.body, response);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      if (!res.headers.has(name)) res.headers.set(name, value);
    }
  }
  return res;
}
