import { buildSocialPreviewResponse } from './_lib/socialPreview.js';
import { withSecurityHeaders } from './_lib/securityHeaders.js';

export async function onRequest(context) {
  const pathname = new URL(context.request.url).pathname;

  // Le fichier public/_headers ne s'applique pas aux réponses des Functions :
  // on pose les en-têtes de sécurité ici.
  if (pathname.startsWith('/movie/') || pathname.startsWith('/tv/')) {
    return withSecurityHeaders(await context.next());
  }

  return withSecurityHeaders(await buildSocialPreviewResponse(context));
}
