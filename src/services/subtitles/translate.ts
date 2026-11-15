import axios from 'axios';

/**
 * Traduction des répliques par les services publics de Google Traduction et
 * de Microsoft (celui du traducteur d'Edge), appelés depuis le navigateur.
 *
 * Chaque point d'accès a sa propre limite. Quand l'un refuse (429, page
 * « trafic inhabituel » sans en-tête CORS, coupure réseau), le suivant prend le
 * relais, et celui qui a répondu passe en tête pour les blocs suivants.
 * Microsoft vient juste après le premier Google : un blocage Google de toute
 * l'adresse IP du visiteur ne le touche pas.
 *
 * Pas de repli réplique par réplique : des centaines de requêtes lancées d'un
 * coup font bloquer l'adresse IP du visiteur pendant des heures, et la
 * traduction échoue ensuite partout pour lui.
 */

export interface TranslateRequest {
  url: string;
  params?: Record<string, string>;
  body: URLSearchParams | string;
  headers?: Record<string, string>;
}

export type TranslatePost = (request: TranslateRequest) => Promise<unknown>;

interface TranslateEndpoint {
  id: string;
  /** `null` : réponse reçue mais inutilisable pour ce bloc. */
  translate(plains: string[], targetLang: string, post: TranslatePost): Promise<string[] | null>;
}

const REQUEST_TIMEOUT_MS = 15_000;
const GTX_SEPARATOR = '\n\n||||\n\n';

const asJson = (data: unknown): unknown => (typeof data === 'string' ? JSON.parse(data) : data);

/** `client=gtx` : un seul texte, les répliques collées par un séparateur. */
function gtxEndpoint(host: string): TranslateEndpoint {
  return {
    id: `gtx@${host}`,
    async translate(plains, targetLang, post) {
      const data = asJson(await post({
        url: `https://${host}/translate_a/single`,
        params: { client: 'gtx', sl: 'auto', tl: targetLang, dt: 't' },
        body: new URLSearchParams({ q: plains.join(GTX_SEPARATOR) }),
      }));
      const segments = Array.isArray(data) && Array.isArray(data[0]) ? data[0] : [];
      const full = segments
        .map((segment: unknown) => (Array.isArray(segment) && typeof segment[0] === 'string' ? segment[0] : ''))
        .join('');
      const parts = full.split(/\s*\|{4}\s*/);
      // Un séparateur perdu décale toutes les répliques qui suivent.
      return parts.length === plains.length ? parts.map(part => part.trim()) : null;
    },
  };
}

/** `client=dict-chrome-ex` : un paramètre `q` par réplique, une traduction par réplique. */
const dictEndpoint: TranslateEndpoint = {
  id: 'dict-chrome-ex@clients5.google.com',
  async translate(plains, targetLang, post) {
    const body = new URLSearchParams();
    for (const plain of plains) body.append('q', plain);
    const data = asJson(await post({
      url: 'https://clients5.google.com/translate_a/t',
      params: { client: 'dict-chrome-ex', sl: 'auto', tl: targetLang },
      body,
    }));
    if (!Array.isArray(data) || data.length !== plains.length) return null;
    // Avec sl=auto, chaque entrée vaut [traduction, langue détectée].
    return data.map((entry: unknown) => {
      const value = Array.isArray(entry) ? entry[0] : entry;
      return typeof value === 'string' ? value.trim() : '';
    });
  },
};

/** Codes du lecteur (ISO 639-1) que Microsoft écrit autrement. */
const MICROSOFT_LANGS: Record<string, string> = {
  zh: 'zh-Hans',
  no: 'nb',
  // Google rend le serbe en cyrillique : même choix ici.
  sr: 'sr-Cyrl',
};

/** Traducteur d'Edge : une liste de répliques en JSON, sans jeton. */
const microsoftEndpoint: TranslateEndpoint = {
  id: 'microsoft@edge.microsoft.com',
  async translate(plains, targetLang, post) {
    const data = asJson(await post({
      url: 'https://edge.microsoft.com/translate/translatetext',
      params: { from: '', to: MICROSOFT_LANGS[targetLang] ?? targetLang, isEnterpriseClient: 'false' },
      body: JSON.stringify(plains),
      headers: { 'Content-Type': 'application/json' },
    }));
    if (!Array.isArray(data) || data.length !== plains.length) return null;
    return data.map((entry: { translations?: Array<{ text?: unknown }> } | null) => {
      const value = entry?.translations?.[0]?.text;
      return typeof value === 'string' ? value.trim() : '';
    });
  },
};

const HTML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function textToTranslateHtml(plain: string): string {
  return plain.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

export function translateHtmlToText(html: string): string {
  return html
    .replace(/\s*<br\s*\/?>\s*/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
      if (code[0] === '#') {
        const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(point) ? String.fromCodePoint(point) : entity;
      }
      return HTML_ENTITIES[code.toLowerCase()] ?? entity;
    })
    .trim();
}

/**
 * Service de la traduction de page de Chrome. La clé est la clé publique que
 * Google met dans son propre script de traduction de sites ; les extensions
 * TWP, Kiss Translator et Read Frog utilisent la même.
 */
const translateHtmlEndpoint: TranslateEndpoint = {
  id: 'translateHtml@translate-pa.googleapis.com',
  async translate(plains, targetLang, post) {
    const data = asJson(await post({
      url: 'https://translate-pa.googleapis.com/v1/translateHtml',
      body: JSON.stringify([[plains.map(textToTranslateHtml), 'auto', targetLang], 'wt_lib']),
      headers: {
        'Content-Type': 'application/json+protobuf',
        'X-Goog-API-Key': 'AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520',
      },
    }));
    const translated = Array.isArray(data) && Array.isArray(data[0]) ? data[0] : null;
    if (!translated || translated.length !== plains.length) return null;
    return translated.map((value: unknown) => (typeof value === 'string' ? translateHtmlToText(value) : ''));
  },
};

export const TRANSLATE_ENDPOINTS: readonly TranslateEndpoint[] = [
  gtxEndpoint('translate.googleapis.com'),
  microsoftEndpoint,
  translateHtmlEndpoint,
  dictEndpoint,
  gtxEndpoint('clients5.google.com'),
];

let preferredEndpoint = 0;

export function resetPreferredTranslateEndpoint(): void {
  preferredEndpoint = 0;
}

const axiosPost: TranslatePost = async ({ url, params, body, headers }) =>
  (await axios.post(url, body, { params, headers, timeout: REQUEST_TIMEOUT_MS })).data;

/**
 * Traduit un bloc de répliques. Les balises HTML sont retirées avant l'envoi.
 * Les clés du résultat sont les textes d'origine ; une réplique absente garde
 * son texte d'origine à l'affichage.
 */
export async function translateSubtitleTexts(
  texts: string[],
  targetLang: string,
  post: TranslatePost = axiosPost,
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  const items = texts
    .map(text => ({ text, plain: text.replace(/<[^>]*>/g, '') }))
    .filter(item => item.plain.trim());
  if (!items.length) return results;
  const plains = items.map(item => item.plain);

  for (let attempt = 0; attempt < TRANSLATE_ENDPOINTS.length; attempt++) {
    const index = (preferredEndpoint + attempt) % TRANSLATE_ENDPOINTS.length;
    let translated: string[] | null = null;
    try {
      translated = await TRANSLATE_ENDPOINTS[index].translate(plains, targetLang, post);
    } catch {
      // Refus ou coupure : point d'accès suivant.
    }
    if (!translated) continue;

    preferredEndpoint = index;
    translated.forEach((value, i) => {
      if (value) results.set(items[i].text, value);
    });
    return results;
  }

  return results;
}
