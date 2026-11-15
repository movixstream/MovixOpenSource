'use strict';

const cheerio = require('cheerio');
const { fetchTmdbImages, fetchTmdbCredits, fetchTmdbAlternativeTitles, searchTmdb } = require('./tmdbCache');

const unique = values => [...new Set(values.filter(Boolean))];
const normalize = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '')
  .toLowerCase().replace(/[’'`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const baseTitle = value => String(value || '').replace(/\s*[-–:]?\s*saison\s+\d+.*$/i, '')
  .replace(/\s*\((?:19|20)\d{2}\)\s*$/, '').replace(/\s+-\s+(?:19|20)\d{2}\s*$/, '').trim();
const yearOf = value => Number(String(value || '').match(/\b(?:19|20)\d{2}\b/)?.[0]) || null;
const names = value => (Array.isArray(value) ? value : [value]).flatMap(item =>
  typeof item === 'string' ? item.split(/[,;|]/) : [item?.name]).map(normalize).filter(Boolean);

function titleSimilarity(left, right) {
  const a = normalize(baseTitle(left)), b = normalize(baseTitle(right));
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aa = new Set(a.split(' ')), bb = new Set(b.split(' '));
  const score = [...aa].filter(word => bb.has(word)).length / Math.max(aa.size, bb.size);
  // Préfixe de franchise, pas suffixe de suite (« Alibi.com 2 »).
  const suffix = aa.size >= 2 && b.endsWith(` ${a}`) || bb.size >= 2 && a.endsWith(` ${b}`);
  return suffix ? Math.max(score, 0.85) : score;
}

function searchTitles(titles) {
  const originals = unique(titles.map(title => String(title || '').trim()));
  return unique([...originals, ...originals.flatMap(title => [
    title.replace(/\s*:\s*la s[ée]rie\s*$/i, ''),
    title.replace(/[.:/!?×]/g, ' ').replace(/\s+/g, ' ').trim(),
    title.replace(/\.(?:com|net|org)\b/gi, ''),
    title.replace(/\s*\((?:US|UK|AU)\)\s*$/i, ''),
  ])]).slice(0, 10);
}

function imagePath(value) {
  try {
    const url = new URL(value);
    if (url.hostname !== 'image.tmdb.org') return null;
    return url.pathname.match(/\/([^/]+\.(?:jpg|png|webp))$/i)?.[1] || null;
  } catch { return null; }
}

function parseSourceIdentity(html) {
  const $ = cheerio.load(html);
  const heading = $('h1').first().text().replace(/\s+/g, ' ').trim();
  const structured = [];
  $('script[type="application/ld+json"]').each((_, node) => {
    try {
      const collect = data => {
        if (Array.isArray(data)) data.forEach(collect);
        else if (data && typeof data === 'object') {
          if (['Movie', 'TVSeries', 'TVSeason'].includes(data['@type'])) structured.push(data);
          if (data['@graph']) collect(data['@graph']);
        }
      };
      collect(JSON.parse($(node).text()));
    } catch { /* Les métadonnées HTML restent disponibles. */ }
  });
  const schema = structured.find(item => titleSimilarity(item.name, heading) >= 0.8) || {};
  const seasonMatch = heading.match(/saison\s+(\d+)/i);
  const identity = {
    titles: unique([heading, schema.name]),
    type: schema['@type'] === 'Movie' ? 'movie' : schema['@type'] ? 'tv' : null,
    season: seasonMatch ? Number(seasonMatch[1]) : null,
    year: yearOf(schema.datePublished),
    posters: unique([typeof schema.image === 'string' ? schema.image : schema.image?.url,
      $('.fposter img, .mov-img img, [itemprop="image"]').first().attr('src')]),
    cast: names(schema.actor), directors: names(schema.director || schema.creator),
    synopsis: schema.description || '',
  };
  // Libellés de la fiche uniquement : ni recommandations ni commentaires.
  $('li').each((_, node) => {
    const row = $(node), label = normalize(row.children('.mov-label, span').first().text());
    const content = row.clone();
    content.children('.mov-label, span').first().remove();
    const value = content.text().replace(/\s+/g, ' ').trim();
    if (label === 'titre original') identity.titles.push(value);
    if (label === 'date de sortie') identity.year = yearOf(value);
    if (['realisateur', 'realisateurs', 'createur', 'createurs'].includes(label)) identity.directors.push(...names(value));
    if (label === 'acteurs') identity.cast.push(...names(value));
    if (label === 'synopsis') identity.synopsis = value.replace(/^.*?en Streaming Complet\s*:\s*/i, '');
  });
  const description = $('.fdesc').first().clone();
  description.find('h1,h2,h3,h4,.fdesc-title').remove();
  if (description.text().trim()) identity.synopsis = description.text().replace(/\s+/g, ' ').trim();
  identity.cast = unique(identity.cast);
  identity.directors = unique(identity.directors);
  identity.titles = unique(identity.titles);
  return identity;
}

const synopsisWords = value => new Set(normalize(value).split(' ').filter(word => word.length >= 5));
function synopsisSimilarity(left, right) {
  const a = synopsisWords(left), b = synopsisWords(right);
  if (Math.min(a.size, b.size) < 12) return 0;
  return [...a].filter(word => b.has(word)).length / Math.min(a.size, b.size);
}

// Autres fiches TMDB du même type, au même titre et de la même année. Le
// couple titre + année ne désigne alors plus une seule fiche : « Kraken »
// (2026) est à la fois un film norvégien (1110034) et un film français (1571766).
async function findTmdbHomonyms({ apiUrl, apiKey, type, id, titles, years }) {
  const yearParam = type === 'movie' ? 'primary_release_year' : 'first_air_date_year';
  const searches = titles.slice(0, 3).flatMap(title => years.map(year =>
    searchTmdb(apiUrl, apiKey, type, title, { [yearParam]: year })));
  const found = new Map();
  for (const search of await Promise.all(searches)) {
    for (const item of search?.results || []) {
      if (String(item.id) === String(id)) continue;
      const sameYear = years.includes(yearOf(item.release_date || item.first_air_date));
      const sameTitle = [item.title, item.name, item.original_title, item.original_name]
        .some(other => titles.some(title => titleSimilarity(title, other) >= 0.95));
      if (sameYear && sameTitle) found.set(item.id, item);
    }
  }
  return [...found.values()];
}

const imageNames = images => [...(images?.posters || []), ...(images?.backdrops || [])]
  .map(p => typeof p === 'string' ? p : p.file_path?.split('/').pop()).filter(Boolean);

// Chargements supplémentaires partagés par tous les candidats d'une recherche.
function createIdentityVerifier({ apiUrl, apiKey, type, details, english = null, seasonData = null }) {
  const titles = unique([details.title, details.name, details.original_title, details.original_name,
    english?.title, english?.name]);
  const years = unique([yearOf(details.release_date || details.first_air_date), yearOf(seasonData?.air_date)]);
  let imagesPromise, creditsPromise, aliasesPromise, homonymsPromise;
  // Sans réponse TMDB, on garde l'ancien comportement (titre + année suffisent).
  const homonyms = () => (homonymsPromise ||= findTmdbHomonyms({ apiUrl, apiKey, type, id: details.id, titles, years })
    .catch(() => []));
  const aliases = async () => {
    aliasesPromise ||= fetchTmdbAlternativeTitles(apiUrl, apiKey, details.id, type);
    const result = await aliasesPromise;
    return unique([...titles, ...(result?.titles || result?.results || [])
      .filter(item => ['FR', 'US', 'GB'].includes(item.iso_3166_1)).map(item => item.title)]).slice(0, 12);
  };
  const verify = async (candidate, { enrich = true, season = null } = {}) => {
    const result = { accepted: false, reason: 'identity_unconfirmed' };
    if (candidate.type && candidate.type !== type) return { ...result, reason: 'type_mismatch' };
    if (season != null && candidate.season != null && Number(candidate.season) !== Number(season)) {
      return { ...result, reason: 'season_mismatch' };
    }
    const titleScore = Math.max(0, ...titles.flatMap(a => (candidate.titles || []).map(b => titleSimilarity(a, b))));
    const yearMatches = Boolean(candidate.year && years.includes(Number(candidate.year)));
    Object.assign(result, { titleScore, sourceYear: candidate.year, expectedYears: years, yearMatches });
    // Un homonyme TMDB de la même année : seule une preuve propre à la fiche
    // (affiche, distribution) peut encore trancher.
    const sameYearHomonyms = yearMatches ? await homonyms() : [];
    const ambiguous = sameYearHomonyms.length > 0;
    if (ambiguous) result.homonyms = sameYearHomonyms.map(item => item.id);
    if (titleScore >= 0.95 && yearMatches && !ambiguous) return { ...result, accepted: true, reason: 'title_and_year' };
    if (!enrich) return result;

    const sourceImages = (candidate.posters || []).map(imagePath).filter(Boolean);
    let posters = [details.poster_path, details.backdrop_path, seasonData?.poster_path].filter(Boolean).map(p => p.split('/').pop());
    if (sourceImages.length && !sourceImages.some(p => posters.includes(p))) {
      imagesPromise ||= fetchTmdbImages(apiUrl, apiKey, details.id, type);
      const images = await imagesPromise;
      posters = [...posters, ...imageNames(images)];
    }
    const posterMatch = sourceImages.some(p => posters.includes(p));
    if (posterMatch && titleScore >= 0.3) return { ...result, accepted: true, reason: 'tmdb_image', posterMatch };
    if (ambiguous && sourceImages.length) {
      for (const item of sameYearHomonyms) {
        const own = [item.poster_path, item.backdrop_path].filter(Boolean).map(p => p.split('/').pop());
        const names = sourceImages.some(p => own.includes(p)) ? own
          : imageNames(await fetchTmdbImages(apiUrl, apiKey, item.id, type).catch(() => null));
        if (sourceImages.some(p => names.includes(p))) return { ...result, reason: 'homonym_image', homonymId: item.id };
      }
    }
    const expandedTitles = await aliases();
    const expandedScore = Math.max(titleScore, ...expandedTitles.flatMap(a => (candidate.titles || []).map(b => titleSimilarity(a, b))));
    result.titleScore = expandedScore;
    if (expandedScore >= 0.95 && yearMatches && !ambiguous) return { ...result, accepted: true, reason: 'alternative_title_and_year' };
    if (expandedScore < 0.8) return { ...result, reason: 'title_mismatch' };
    creditsPromise ||= fetchTmdbCredits(apiUrl, apiKey, details.id, type);
    const credits = await creditsPromise;
    const cast = new Set(names(credits?.cast || []));
    const directors = new Set(names([...(details.created_by || []), ...(credits?.crew || []).filter(person =>
      person.job === 'Director' || person.jobs?.some(job => job.job === 'Director'))]));
    const castMatches = unique(candidate.cast || []).filter(name => cast.has(normalize(name))).length;
    const directorMatches = unique(candidate.directors || []).filter(name => directors.has(normalize(name))).length;
    const synopsisScore = Math.max(...[details.overview, english?.overview, seasonData?.overview]
      .map(overview => synopsisSimilarity(candidate.synopsis, overview)));
    // Le résumé seul, un acteur de franchise ou un créateur commun ne suffisent pas.
    const accepted = castMatches >= 3 || castMatches >= 2 && directorMatches >= 1
      || synopsisScore >= 0.75 && (castMatches >= 1 || directorMatches >= 1);
    return { ...result, accepted, reason: accepted ? 'corroborated_metadata' : 'identity_unconfirmed',
      castMatches, directorMatches, synopsisScore: Math.round(synopsisScore * 100) / 100 };
  };
  return { titles, years, aliases, verify };
}

module.exports = { normalize, baseTitle, yearOf, titleSimilarity, searchTitles, parseSourceIdentity, createIdentityVerifier, findTmdbHomonyms };
