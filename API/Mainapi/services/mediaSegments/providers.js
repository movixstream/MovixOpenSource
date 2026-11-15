/**
 * Fournisseurs d'horodatages de segments.
 *
 * Chaque fournisseur expose la meme forme : `fetch(context)` renvoie une liste
 * de propositions normalisees, ou leve. Aucun ne connait les autres — c'est
 * `consensus.js` qui les confronte.
 *
 * Proposition normalisee :
 *   { type, start, end, confidence, source, match, referenceLength }
 *   - `start` / `end` en secondes,
 *   - `confidence` dans [0, 1],
 *   - `match` : qualite du recalage sur la duree reelle quand le fournisseur
 *     sait le faire (`exact`, `shifted`, `agnostic`),
 *   - `referenceLength` : duree de l'episode sur lequel le releve a ete fait,
 *     quand elle est connue — sert a rejeter un releve fait sur un autre
 *     encodage.
 */

const axios = require('axios');

const { getAdoptedCandidates } = require('./communityStore');

const {
  DURATION_TOLERANCE_SEC,
  UPSTREAM_TIMEOUT_MS,
  USER_AGENT,
} = require('./constants');

const ANISKIP_BASE = 'https://api.aniskip.com/v2';
const SKIPDB_BASE = 'https://api.skipdb.tv/api';
const INTRODB_BASE = 'https://api.introdb.app';
const THEINTRODB_BASE = 'https://api.theintrodb.org/v4';

const JSON_HEADERS = { 'User-Agent': USER_AGENT, Accept: 'application/json' };

/**
 * Filtre commun applique a toute proposition, quel que soit le fournisseur.
 *
 * C'est le garde-fou central de la fonctionnalite. Les sources de Movix sont
 * scrapees chez des hosters differents : pub en tete, recap absent, encodage
 * plus court de quelques secondes. Appliquer tel quel un timestamp releve sur
 * un autre encodage ferait sauter l'utilisateur en plein milieu d'une scene.
 */
function accept(candidate, duration) {
  const { start, end, referenceLength } = candidate;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  if (start < 0 || end <= start) return false;
  // Segment d'une seconde : bruit de saisie, pas un generique.
  if (end - start < 2) return false;
  if (duration !== null && end > duration + 1) return false;
  if (
    duration !== null &&
    Number.isFinite(referenceLength) &&
    referenceLength > 0 &&
    Math.abs(referenceLength - duration) > DURATION_TOLERANCE_SEC
  ) {
    return false;
  }
  return true;
}

/**
 * Erreur portant un statut lisible pour l'interface.
 *
 * Un « erreur » generique dans le panneau de reglages n'aide personne : on
 * distingue au minimum le service qui refuse (rate limit) de celui qui repond
 * mal, et on garde le detail HTTP pour l'infobulle.
 */
function providerError(status, detail) {
  return Object.assign(new Error(detail), { providerStatus: status, providerDetail: detail });
}

/**
 * Traduit une reponse HTTP en decision commune a tous les fournisseurs.
 * Renvoie `true` quand il faut lire le corps, `false` quand « rien a signaler »,
 * et leve pour tout ce qui merite d'apparaitre comme un probleme.
 */
function classifyResponse(res) {
  const status = res.status;
  if (status === 200) return true;
  // 404 = pas de releve pour cet episode. 400/422 = l'identifiant ne veut rien
  // dire pour ce service (mapping approximatif, numerotation d'episode qui ne
  // correspond pas). Dans les deux cas il n'y a rien a proposer, mais ce n'est
  // pas une panne : afficher « erreur » ferait croire a un service casse.
  if (status === 404 || status === 400 || status === 422) return false;
  if (status === 429) throw providerError('rate-limited', 'HTTP 429');
  if (status === 401 || status === 403) throw providerError('unauthorized', `HTTP ${status}`);
  throw providerError('error', `HTTP ${status}`);
}

/** Statuts acceptes sans lever : la classification se fait dans `classifyResponse`. */
const ACCEPT_ANY_CLIENT_STATUS = (status) => status < 500;

function clampConfidence(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
}

// ===========================================================================
// AniSkip — animes uniquement, indexe par MyAnimeList
// ===========================================================================
const ANISKIP_TYPES = ['op', 'ed', 'mixed-op', 'mixed-ed', 'recap'];
const ANISKIP_TYPE_MAP = {
  'op': 'intro',
  'mixed-op': 'intro',
  'ed': 'outro',
  'mixed-ed': 'outro',
  'recap': 'recap',
};

const aniskip = {
  id: 'aniskip',
  label: 'AniSkip',
  requires: 'malId',
  supportsMovies: false,
  isConfigured: () => true,
  async fetch({ malId, episode, duration }) {
    const res = await axios.get(`${ANISKIP_BASE}/skip-times/${malId}/${episode}`, {
      // episodeLength=0 = "n'importe quelle duree". On filtre nous-memes via
      // `accept` : laisser AniSkip filtrer renverrait un tableau vide des que
      // l'encodage du hoster differe de quelques secondes, sans dire pourquoi.
      params: { types: ANISKIP_TYPES, episodeLength: 0 },
      // Forme objet obligatoire depuis axios 1.x : passer directement une
      // fonction ici est ignore en silence, et la requete part alors avec la
      // serialisation par defaut.
      paramsSerializer: {
        serialize: (params) => {
          const parts = params.types.map((type) => `types[]=${encodeURIComponent(type)}`);
          parts.push(`episodeLength=${params.episodeLength}`);
          return parts.join('&');
        },
      },
      timeout: UPSTREAM_TIMEOUT_MS,
      headers: JSON_HEADERS,
      validateStatus: ACCEPT_ANY_CLIENT_STATUS,
    });

    if (!classifyResponse(res)) return [];
    if (!res.data?.found || !Array.isArray(res.data.results)) return [];

    return res.data.results
      .map((entry) => {
        const type = ANISKIP_TYPE_MAP[entry?.skipType];
        if (!type) return null;
        const referenceLength = Number(entry?.episodeLength);
        return {
          type,
          start: Number(entry?.interval?.startTime),
          end: Number(entry?.interval?.endTime),
          confidence: 1,
          source: 'aniskip',
          match: null,
          referenceLength: Number.isFinite(referenceLength) && referenceLength > 0 ? referenceLength : null,
        };
      })
      .filter((candidate) => candidate && accept(candidate, duration));
  },
};

// ===========================================================================
// SkipDB — series et films, indexe par IMDb. Millisecondes.
// Seul fournisseur qui recale lui-meme sur la duree du flux.
// ===========================================================================
const SKIPDB_TYPES = ['intro', 'recap', 'outro', 'preview'];

const skipdb = {
  id: 'skipdb',
  label: 'SkipDB',
  requires: 'imdbId',
  supportsMovies: true,
  isConfigured: () => true,
  async fetch({ imdbId, season, episode, duration }) {
    const params = { imdb_id: imdbId, adjust: 'conservative' };
    if (season !== null) params.season = season;
    if (episode !== null) params.episode = episode;
    // Sans `duration`, SkipDB repond `match: "agnostic"` : timestamps bruts,
    // sans recalage. On la transmet des qu'on l'a.
    if (duration !== null) params.duration = duration;

    const res = await axios.get(`${SKIPDB_BASE}/segments`, {
      params,
      timeout: UPSTREAM_TIMEOUT_MS,
      headers: JSON_HEADERS,
      validateStatus: ACCEPT_ANY_CLIENT_STATUS,
    });

    if (!classifyResponse(res)) return [];
    if (!res.data?.segments) return [];

    const out = [];
    for (const type of SKIPDB_TYPES) {
      const entry = res.data.segments[type];
      if (!entry) continue;
      const start = Number(entry.start_ms) / 1000;
      const end = Number(entry.end_ms) / 1000;
      // `0,0` est la sentinelle SkipDB pour "il est confirme qu'il n'y a pas de
      // segment de ce type ici" — surtout pas un segment de longueur nulle.
      if (start === 0 && end === 0) continue;
      // `out-of-range` : SkipDB n'a pas su recaler sur cette duree.
      if (entry.match === 'out-of-range') continue;

      const candidate = {
        type,
        start,
        end,
        confidence: clampConfidence(entry.confidence, 0.6),
        source: 'skipdb',
        match: typeof entry.match === 'string' ? entry.match : null,
        referenceLength: null,
      };
      if (accept(candidate, duration)) out.push(candidate);
    }
    return out;
  },
};

// ===========================================================================
// IntroDB — series, indexe par IMDb. Secondes ET millisecondes.
// ===========================================================================
const INTRODB_TYPES = ['intro', 'recap', 'outro'];

const introdb = {
  id: 'introdb',
  label: 'IntroDB',
  requires: 'imdbId',
  supportsMovies: false,
  isConfigured: () => true,
  async fetch({ imdbId, season, episode, duration }) {
    const params = { imdb_id: imdbId };
    if (season !== null) params.season = season;
    if (episode !== null) params.episode = episode;

    const res = await axios.get(`${INTRODB_BASE}/segments`, {
      params,
      timeout: UPSTREAM_TIMEOUT_MS,
      headers: JSON_HEADERS,
      validateStatus: ACCEPT_ANY_CLIENT_STATUS,
    });

    if (!classifyResponse(res)) return [];
    if (!res.data) return [];

    const out = [];
    for (const type of INTRODB_TYPES) {
      const entry = res.data[type];
      if (!entry) continue;
      const start = Number(entry.start_sec ?? (Number(entry.start_ms) / 1000));
      const end = Number(entry.end_sec ?? (Number(entry.end_ms) / 1000));
      if (start === 0 && end === 0) continue;

      // `submission_count` a 1 signifie une seule contribution non confrontee :
      // on plafonne la confiance pour que le consensus ne la prenne pas pour
      // une verite etablie.
      const submissions = Number(entry.submission_count);
      const rawConfidence = clampConfidence(entry.confidence, 0.5);
      const confidence = Number.isFinite(submissions) && submissions <= 1
        ? Math.min(rawConfidence, 0.5)
        : rawConfidence;

      const candidate = {
        type,
        start,
        end,
        confidence,
        source: 'introdb',
        match: null,
        referenceLength: null,
      };
      if (accept(candidate, duration)) out.push(candidate);
    }
    return out;
  },
};

// ===========================================================================
// TheIntroDB — series et films, indexe par TMDB (le plus precis pour Movix,
// qui raisonne deja en TMDB). Distingue `credits` de `outro`.
//
// API v4 (`GET /v4/media`), ouverte en lecture. v1 est supprimée (404), v2 et
// v3 sont gelées et vont fermer. `season` et `episode` vont ensemble (sinon
// 400) : sans les deux, `tmdb_id` désigne un film. Le service convertit
// lui-même la numérotation TMDB vers l'ordre TVDB : pas besoin de `mapping`.
//
// Réponse : indexée par `tvdb_id` (plus de `tmdb_id`), un tableau par type, en
// millisecondes. Avec `details=true`, chaque relevé porte aussi `confidence`.
//   { tvdb_id, intro: [{ start_ms, end_ms }], credits: [{ start_ms: 3433269, end_ms: null }] }
// `start_ms: null` = depuis le début, `end_ms: null` = jusqu'à la fin.
// ===========================================================================
const THEINTRODB_TYPE_MAP = {
  intro: 'intro',
  recap: 'recap',
  credits: 'credits',
  outro: 'outro',
  preview: 'preview',
};

const theintrodb = {
  id: 'theintrodb',
  label: 'TheIntroDB',
  requires: null,
  supportsMovies: true,
  isConfigured: () => true,
  async fetch({ tmdbId, imdbId, season, episode, duration }) {
    // `tmdb_id` est l'identifiant recommande ; `imdb_id` sert de repli.
    const params = tmdbId ? { tmdb_id: tmdbId } : { imdb_id: imdbId };
    if (season !== null) params.season = season;
    if (episode !== null) params.episode = episode;
    // `details` renvoie la vraie confiance de chaque relevé. `duration_ms`
    // choisit la version la plus proche du flux (version longue, cinéma…).
    params.details = true;
    if (duration !== null) params.duration_ms = Math.round(duration * 1000);

    // Cle facultative : la lecture est ouverte, une cle ne sert qu'a relever
    // le quota. Une cle invalide est ignoree par le service.
    const apiKey = process.env.THEINTRODB_API_KEY;
    const headers = apiKey ? { ...JSON_HEADERS, Authorization: `Bearer ${apiKey}` } : JSON_HEADERS;

    const res = await axios.get(`${THEINTRODB_BASE}/media`, {
      params,
      timeout: UPSTREAM_TIMEOUT_MS,
      headers,
      validateStatus: ACCEPT_ANY_CLIENT_STATUS,
    });

    if (!classifyResponse(res)) return [];
    if (!res.data || typeof res.data !== 'object') return [];

    const out = [];
    for (const [key, type] of Object.entries(THEINTRODB_TYPE_MAP)) {
      const raw = res.data[key];
      const entries = Array.isArray(raw) ? raw : raw ? [raw] : [];
      for (const entry of entries) {
        const startMs = entry?.start_ms;
        const endMs = entry?.end_ms;
        const start = startMs == null ? 0 : Number(startMs) / 1000;
        // Fin ouverte (generique jusqu'au bout) : on ne peut la borner qu'avec
        // la duree reelle du flux. Sans elle, le releve est inutilisable.
        const end = endMs == null ? duration : Number(endMs) / 1000;
        if (end === null || end === undefined) continue;
        if (start === 0 && end === 0) continue;

        const candidate = {
          type,
          start,
          end,
          confidence: clampConfidence(entry?.confidence, 0.7),
          source: 'theintrodb',
          match: null,
          referenceLength: null,
        };
        if (accept(candidate, duration)) out.push(candidate);
      }
    }
    return out;
  },
};

// ===========================================================================
// Movix — propositions de la communaute adoptees (score >= 3).
//
// Pas d'appel reseau : les releves sont dans notre propre base. Le filtrage
// par duree de reference est fait cote SQL, et `accept` repasse dessus pour
// appliquer exactement les memes regles qu'aux sources externes.
// ===========================================================================
const movix = {
  id: 'movix',
  label: 'Movix',
  requires: null,
  supportsMovies: true,
  isConfigured: () => true,
  // Seule source jamais mise en cache : un vote doit se voir immediatement, et
  // la lecture se fait dans notre propre base, donc elle ne coute presque rien.
  cacheable: false,
  async fetch({ mediaType, tmdbId, season, episode, duration }) {
    const candidates = await getAdoptedCandidates({
      mediaType,
      tmdbId,
      season: season ?? undefined,
      episode: episode ?? undefined,
      durationSec: duration ?? undefined,
    });
    return candidates.filter((candidate) => accept(candidate, duration));
  },
};

const PROVIDERS = [movix, aniskip, skipdb, introdb, theintrodb];
const PROVIDERS_BY_ID = new Map(PROVIDERS.map((provider) => [provider.id, provider]));

module.exports = { PROVIDERS, PROVIDERS_BY_ID, accept };
