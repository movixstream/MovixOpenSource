/**
 * CineStream movie source (helper module, not a router).
 *
 * Powers the *movie* path of the wiflix source (see wiflix.js): flemmix sits
 * behind a Cloudflare bot-shield that's painful for films, so movies are
 * scraped from cinestream.info (a public Next.js App Router site) instead.
 * TV stays on flemmix.
 *
 * Flow (all GET, public HTML — no cookie handshake):
 *   1. /search?q=<title>            -> <a href="/film/{slug}"> candidates
 *   2. /film/{slug}                 -> embedded RSC flight carries the TMDB id
 *                                      ("tmdbid":N) + ordered players array
 *                                      ([{name},...]). tmdbid is AUTHORITATIVE
 *                                      (cinestream reuses TMDB ids), so we match
 *                                      on it — no release-year rejection needed.
 *   3. /player/{tmdbid}/{index}     -> <iframe src> embed url for player[index]
 *
 * Player language: a player whose name starts with "vostfr" -> VOSTFR, else VF.
 * Array order is the /player/{tmdbid}/{index} index — preserved end to end.
 *
 * Returns the SAME shape as wiflix's fetchWiflixMovieData so the existing route
 * + cache in wiflix.js consume it unchanged.
 */

const { makeCinestreamRequest } = require("../utils/proxyManager");
const { fetchTmdbDetails } = require("../utils/tmdbCache");
const { redis } = require("../config/redis");
const { createCinestreamAvailability } = require("../utils/cinestreamAvailability");
const cinestreamAvailability = createCinestreamAvailability({ redis });

const TMDB_API_KEY = process.env.TMDB_API_KEY || "";
const TMDB_API_URL = "https://api.themoviedb.org/3";
// Override via env if cinestream rotates domains (no code change).
const CINESTREAM_BASE_URL =
  process.env.CINESTREAM_BASE_URL || "https://cinestream.info";

// Cap film-page confirmations per movie. Search is relevance-sorted and we bump
// year-matches first, so the right film is almost always in the first 1-2.
const MAX_FILM_PAGE_FETCHES = 8;

const toBody = (res) =>
  typeof res.data === "string" ? res.data : JSON.stringify(res.data);

// Les erreurs réseau/HTTP restent temporaires jusqu'au gestionnaire de cache.
// timeout est en millisecondes ici ; le helper attend des secondes.
async function cinestreamGet(url, timeout = 15000) {
  try {
    return await makeCinestreamRequest(url, { timeout: Math.ceil(timeout / 1000) });
  } catch (error) {
    if (error?.code === 'CINESTREAM_UPSTREAM_UNAVAILABLE') throw error;
    // Ne pas conserver le corps HTML ni les identifiants d'un proxy en erreur.
    throw Object.assign(new Error('Connexion à CineStream temporairement indisponible'), {
      code: 'CINESTREAM_UPSTREAM_UNAVAILABLE', httpStatus: 503,
    });
  }
}

// Every cinestream slug ends with its release year ("toy-story-5-2026").
const yearFromSlug = (slug) => {
  const m = slug.match(/-(\d{4})$/);
  return m ? parseInt(m[1], 10) : null;
};

// === Step 1: search -> candidate slugs (dedup, search order preserved) ===
async function searchCinestream(title) {
  const url = `${CINESTREAM_BASE_URL}/search?q=${encodeURIComponent(title)}`;
  const res = await cinestreamGet(url);
  const html = toBody(res);

  const slugs = [];
  const seen = new Set();
  const re = /href="\/film\/([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const slug = m[1];
    if (seen.has(slug)) continue;
    seen.add(slug);
    slugs.push(slug);
  }
  return slugs;
}

// === Step 2: film page -> { tmdbid, players: [{name}, ...] } ===
// RSC flight is embedded *escaped* in the HTML (\"tmdbid\":N, \"players\":[...]).
async function fetchCinestreamFilm(slug) {
  const url = `${CINESTREAM_BASE_URL}/film/${slug}`;
  const res = await cinestreamGet(url);
  const html = toBody(res);

  const tmdbMatch = html.match(/tmdbid\\?":(\d+)/);
  const tmdbid = tmdbMatch ? parseInt(tmdbMatch[1], 10) : null;

  let players = [];
  const playersMatch = html.match(/players\\?":(\[.*?\])/);
  if (playersMatch) {
    try {
      players = JSON.parse(playersMatch[1].replace(/\\"/g, '"'));
    } catch {
      players = [];
    }
  }

  return { tmdbid, players, url };
}

// === Step 3: player page -> iframe embed url for a given index ===
async function fetchCinestreamEmbed(tmdbid, index) {
  const url = `${CINESTREAM_BASE_URL}/player/${tmdbid}/${index}`;
  try {
    const res = await cinestreamGet(url, 12000);
    const html = toBody(res);
    const m = html.match(/<iframe[^>]+src="([^"]+)"/i);
    return m ? m[1] : null;
  } catch (error) {
    if (error?.code === 'CINESTREAM_UPSTREAM_UNAVAILABLE') throw error;
    return null;
  }
}

function categorize(players) {
  const vf = [];
  const vostfr = [];
  for (const p of players) {
    if (p.type === "VOSTFR") vostfr.push(p);
    else vf.push(p);
  }
  return { vf, vostfr };
}

// === Main: same return shape as wiflix's fetchWiflixMovieData ===
async function fetchCinestreamMovieData(tmdbId, cachedData = null) {
  try {
    const tmdbData = await fetchTmdbDetails(
      TMDB_API_URL,
      TMDB_API_KEY,
      tmdbId,
      "movie",
      "fr-FR",
    );

    if (!tmdbData) {
      if (cachedData) return cachedData;
      return {
        success: false,
        error: "Film non trouve sur TMDB",
        tmdb_id: tmdbId,
      };
    }

    return await cinestreamAvailability.run(async () => {
      const tmdbYear = tmdbData.release_date
        ? new Date(tmdbData.release_date).getFullYear()
        : null;

      const titlesToTry = [tmdbData.title, tmdbData.original_title].filter(
        (t, i, arr) => t && arr.indexOf(t) === i,
      );

      // Gather candidate slugs across titles (dedup, keep order).
      const candidates = [];
      const seen = new Set();
      for (const title of titlesToTry) {
        let slugs = [];
        try {
          slugs = await searchCinestream(title);
        } catch (err) {
          if (err?.code === 'CINESTREAM_UPSTREAM_UNAVAILABLE') throw err;
          console.log(`[CINESTREAM SEARCH] "${title}": ${err.message}`);
        }
        for (const slug of slugs) {
          if (seen.has(slug)) continue;
          seen.add(slug);
          candidates.push(slug);
        }
      }

      if (candidates.length === 0)
        return {
          success: false,
          error: "Film non trouve sur CineStream",
          tmdb_id: tmdbId,
          titles_tried: titlesToTry,
        };

      // Bump year-matches first (stable) — tmdbid is the real match, this just
      // minimises wasted film-page fetches on common titles.
      const ranked = tmdbYear
        ? candidates
            .map((slug, i) => ({ slug, i, yearHit: yearFromSlug(slug) === tmdbYear }))
            .sort((a, b) => (b.yearHit ? 1 : 0) - (a.yearHit ? 1 : 0) || a.i - b.i)
            .map((c) => c.slug)
        : candidates;

      // Confirm the right film by tmdbid.
      let matched = null;
      for (const slug of ranked.slice(0, MAX_FILM_PAGE_FETCHES)) {
        let film;
        try {
          film = await fetchCinestreamFilm(slug);
        } catch (err) {
          if (err?.code === 'CINESTREAM_UPSTREAM_UNAVAILABLE') throw err;
          console.log(`[CINESTREAM FILM] "${slug}": ${err.message}`);
          continue;
        }
        if (film.tmdbid === Number(tmdbId)) {
          matched = film;
          break;
        }
      }

      if (!matched)
        return {
          success: false,
          error: "Film non trouve sur CineStream",
          tmdb_id: tmdbId,
          titles_tried: titlesToTry,
        };

      if (!matched.players.length)
        return {
          success: false,
          error: "Aucun lecteur video trouve",
          tmdb_id: tmdbId,
          cinestream_url: matched.url,
        };

      // Resolve each player[index] -> embed url (parallel). Index = the
      // /player/{tmdbid}/{index} index, so map over the array as-is.
      const resolved = await Promise.allSettled(
        matched.players.map((p, index) =>
          fetchCinestreamEmbed(matched.tmdbid, index).then((url) => ({
            name: p.name,
            url,
          })),
        ),
      );
      // Terminer tous les appels déjà lancés avant de libérer la tentative de
      // reprise. Aucun résultat partiel ne remplace les lecteurs en cache.
      const failed = resolved.find((result) => result.status === 'rejected');
      if (failed) throw failed.reason;
      const embeds = resolved.map((result) => result.value);

      const players = [];
      for (const e of embeds) {
        if (!e.url) continue;
        const type = /^vostfr/i.test((e.name || "").trim()) ? "VOSTFR" : "VF";
        const domainMatch = e.url.match(/https?:\/\/(?:www\.)?([^/]+)/);
        players.push({
          name: domainMatch ? domainMatch[1] : e.name,
          url: e.url,
          episode: 1,
          type,
        });
      }

      if (players.length === 0)
        return {
          success: false,
          error: "Aucun lecteur video trouve",
          tmdb_id: tmdbId,
          cinestream_url: matched.url,
        };

      const categorized = categorize(players);
      return {
        success: true,
        tmdb_id: tmdbId,
        title: tmdbData.title,
        original_title: tmdbData.original_title,
        source: "cinestream",
        // Key kept as wiflix_url for response-shape compat with the wiflix route.
        wiflix_url: matched.url,
        players: { vf: categorized.vf, vostfr: categorized.vostfr },
        cache_timestamp: new Date().toISOString(),
      };
    });
  } catch (error) {
    // updateWiflixCache conserve le fichier et diffère l'actualisation sur
    // exception, y compris sans cache : aucune panne ne devient un cache négatif.
    if (error?.code?.startsWith('CINESTREAM_')) throw error;
    console.error(`[CINESTREAM MOVIE] ${tmdbId}: ${error.message}`);
    if (cachedData) return cachedData;
    return {
      success: false,
      error: "Erreur lors de la recuperation des donnees CineStream",
      message: error.message,
      tmdb_id: tmdbId,
    };
  }
}

module.exports = { fetchCinestreamMovieData };
