'use strict';

/**
 * Lecture des pages d'anime-sama : fiche d'œuvre, page de saison, planning,
 * sitemap. Fonctions pures — du HTML en entrée, des données en sortie, jamais
 * de réseau ni d'exception. Une page illisible rend une valeur « vide »
 * (`valid: false`, listes vides), que l'appelant distingue d'une page lue.
 */

// Dossiers de langue d'une saison (/catalogue/<œuvre>/<saison>/<langue>/).
const LANGUAGE_IDS = Object.freeze(['vostfr', 'vf', 'vosteng', 'vostspa', 'vj', 'va', 'vf1', 'vf2', 'vkr']);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text) {
  return String(text ?? '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const hex = code[1] === 'x' || code[1] === 'X';
      const point = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isInteger(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
    }
    const known = ENTITIES[code.toLowerCase()];
    return known === undefined ? match : known;
  });
}

// Texte affiché d'un fragment HTML : balises retirées, espaces réduits.
const textOf = html => decodeEntities(String(html ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

const uniq = values => [...new Set(values)];

// Retire les commentaires HTML (`<!-- … -->`, sur plusieurs lignes) sans
// toucher au contenu des <script> : là, `<!--` ne commente que la fin de sa
// ligne. Rend le texte gardé et les commentaires retirés.
function splitHtmlComments(html) {
  const token = /<!--|<script\b[^>]*>/gi;
  const scriptEnd = /<\/script\s*>/gi;
  const removed = [];
  let kept = '';
  let pos = 0;
  while (pos < html.length) {
    token.lastIndex = pos;
    const match = token.exec(html);
    if (!match) { kept += html.slice(pos); break; }
    if (match[0] === '<!--') {
      kept += html.slice(pos, match.index);
      const end = html.indexOf('-->', match.index + 4);
      if (end === -1) { removed.push(html.slice(match.index)); break; }
      removed.push(html.slice(match.index, end + 3));
      pos = end + 3;
    } else {
      scriptEnd.lastIndex = token.lastIndex;
      const close = scriptEnd.exec(html);
      if (!close) { kept += html.slice(pos); break; }
      kept += html.slice(pos, scriptEnd.lastIndex);
      pos = scriptEnd.lastIndex;
    }
  }
  return { kept, removed };
}

const PANEL = /panneau(Anime|Scan)\s*\(\s*(["'])(.*?)\2\s*,\s*(["'])(.*?)\4\s*\)/g;

// Panneaux d'un fragment. « nom » est l'exemple du mode d'emploi de la page.
function panelsOf(text) {
  const panels = [];
  for (const [, kind, , name, , target] of String(text).matchAll(PANEL)) {
    if (name.trim() && name.trim() !== 'nom') panels.push({ kind, name: decodeEntities(name.trim()), target });
  }
  return panels;
}

// « saison1/vostfr », « /catalogue/<œuvre>/saison1/vostfr/ » ou une adresse
// complète → { path: 'saison1', lang: 'vostfr' }. Null si la langue est inconnue.
function parseSeasonTarget(raw, slug = '') {
  let target = String(raw ?? '').trim();
  if (/^https?:\/\//i.test(target)) {
    try { target = new URL(target).pathname; } catch { return null; }
  }
  const parts = target.split('/').filter(Boolean);
  if (parts[0] === 'catalogue') parts.splice(0, 2);
  else if (slug && parts.length > 2 && parts[0] === slug) parts.shift();
  if (parts.length < 2) return null;
  const lang = parts[parts.length - 1].toLowerCase();
  if (!LANGUAGE_IDS.includes(lang)) return null;
  return { path: parts.slice(0, -1).join('/'), lang };
}

function jsonLdOf(html) {
  const match = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return {};
  try {
    const data = JSON.parse(match[1]);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

const stringOf = value => (typeof value === 'string' ? decodeEntities(value).trim() : '');
const stringsOf = value => (Array.isArray(value) ? value : [value]).map(stringOf).filter(Boolean);

// Anime-sama coupe ses genres au trait d'union : « Science-fiction » sort en
// « Science » puis « fiction », « Aliens / Extra-terrestres » en « Aliens /
// Extra » puis « terrestres ». Un genre du site commence par une majuscule : un
// morceau en minuscule est donc la fin du genre d'avant.
function joinSplitGenres(genres) {
  const joined = [];
  for (const genre of genres) {
    if (joined.length && /^\p{Ll}/u.test(genre)) joined[joined.length - 1] += `-${genre}`;
    else joined.push(genre);
  }
  return joined;
}

// Bloc « Informations » de l'anime : `<dt>Format</dt><dd>Série TV</dd>`…
// Quand la fiche a aussi un manga, le bloc de l'anime suit le sous-titre « Anime ».
function infosOf(html) {
  const anime = html.search(/class=["']oe-sous-titre["'][^>]*>\s*Anime\s*</i);
  const list = html.slice(Math.max(anime, 0)).match(/<dl[^>]*class=["'][^"']*\boe-infos\b[^"']*["'][^>]*>([\s\S]*?)<\/dl>/i);
  const infos = {};
  if (!list) return infos;
  for (const [, label, value] of list[1].matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi)) {
    infos[textOf(label)] = textOf(value);
  }
  return infos;
}

const EMPTY_TITLE = Object.freeze({
  valid: false, name: '', altNames: [], synopsis: '', genres: [], image: '', posterPath: null,
  tmdb: null, anilistId: null, malId: null, format: '', status: '', year: null, languages: [],
  seasons: [], hiddenSeasons: 0, hasScans: false,
});

/**
 * Fiche d'une œuvre (/catalogue/<slug>/).
 *
 * `valid` dit si la page est bien une fiche : c'est ce qui permet à l'appelant
 * de croire une fiche sans aucune saison (saisons masquées, œuvre en scans
 * seulement) au lieu de la prendre pour une page cassée.
 */
function parseTitlePage(html, { slug = '' } = {}) {
  if (typeof html !== 'string' || !html) return { ...EMPTY_TITLE };

  const { kept, removed } = splitHtmlComments(html);
  let hiddenSeasons = 0;
  const countHidden = (chunk) => {
    hiddenSeasons += panelsOf(chunk).filter(panel => panel.kind === 'Anime').length;
    return '';
  };
  removed.forEach(countHidden);
  // Dans un <script>, `/* … */`, `<!--` jusqu'à la fin de la ligne et `//` en
  // début de ligne sont des commentaires.
  const code = kept
    .replace(/\/\*[\s\S]*?\*\//g, countHidden)
    .replace(/<!--.*$/gm, countHidden)
    .replace(/^[ \t]*\/\/.*$/gm, countHidden);

  const panels = panelsOf(code);
  const seasons = [];
  for (const panel of panels) {
    if (panel.kind !== 'Anime') continue;
    const target = parseSeasonTarget(panel.target, slug);
    if (target) seasons.push({ name: panel.name, path: target.path, lang: target.lang });
  }

  const isTitlePage = /id=["']titreOeuvre["']/.test(kept) && /\bvar\s+OE_BASE\b|\bfunction\s+panneauAnime\b/.test(kept);
  if (!seasons.length && !isTitlePage) return { ...EMPTY_TITLE };

  const ld = jsonLdOf(kept);
  const infos = infosOf(kept);
  const heading = kept.match(/<h1[^>]*id=["']titreOeuvre["'][^>]*>([\s\S]*?)<\/h1>/i);
  const alters = kept.match(/<p[^>]*id=["']titreAlter["'][^>]*>([\s\S]*?)<\/p>/i);
  const synopsis = kept.match(/<p[^>]*id=["']synopsisText["'][^>]*>([\s\S]*?)<\/p>/i);
  const tmdb = kept.match(/https?:\/\/(?:www\.)?themoviedb\.org\/(tv|movie)\/(\d+)/i);
  const anilist = kept.match(/https?:\/\/(?:www\.)?anilist\.co\/anime\/(\d+)/i);
  const mal = kept.match(/https?:\/\/(?:www\.)?myanimelist\.net\/anime\/(\d+)/i);
  const poster = kept.match(/class=["']oe-affiche["'][^>]*>\s*<img[^>]*\bsrc=["']https?:\/\/image\.tmdb\.org\/t\/p\/[a-z0-9]+(\/[A-Za-z0-9._-]+)["']/i);
  const meta = kept.match(/<p[^>]*class=["']oe-meta["'][^>]*>\s*(\d{4})\b/i);
  const yearText = meta?.[1] || (infos.Diffusion || infos['Début'] || '').match(/\b(19|20)\d{2}\b/)?.[0];
  const siteLanguages = uniq([...(infos['Sur le site'] || '').matchAll(/\b[A-Z][A-Z0-9]{1,6}\b/g)]
    .map(match => match[0].toLowerCase())
    .filter(lang => LANGUAGE_IDS.includes(lang)));

  return {
    valid: true,
    name: stringOf(ld.name) || textOf(heading?.[1]),
    altNames: ld.alternateName !== undefined
      ? stringsOf(ld.alternateName)
      : textOf(alters?.[1]).split(',').map(name => name.trim()).filter(Boolean),
    synopsis: stringOf(ld.description) || textOf(synopsis?.[1]),
    genres: ld.genre !== undefined ? joinSplitGenres(stringsOf(ld.genre)) : [],
    image: stringOf(ld.image),
    posterPath: poster ? poster[1] : null,
    tmdb: tmdb ? { type: tmdb[1].toLowerCase(), id: Number(tmdb[2]) } : null,
    anilistId: anilist ? Number(anilist[1]) : null,
    malId: mal ? Number(mal[1]) : null,
    format: infos.Format || '',
    status: infos.Statut || '',
    year: yearText ? Number(yearText) : null,
    languages: siteLanguages.length ? siteLanguages : uniq(seasons.map(season => season.lang)),
    seasons,
    hiddenSeasons,
    hasScans: panels.some(panel => panel.kind === 'Scan'),
  };
}

// Langues de `var languesDispo = ["vostfr", "vf"];`, ou null si la table est
// absente, vide ou illisible.
function parsePublishedLanguages(html) {
  if (typeof html !== 'string') return null;
  const match = html.match(/languesDispo\s*=\s*(\[[^\]]*\])\s*;/);
  if (!match) return null;
  let langs;
  try {
    langs = JSON.parse(match[1]);
  } catch {
    return null;
  }
  if (!Array.isArray(langs) || !langs.length || !langs.every(lang => typeof lang === 'string')) return null;
  return uniq(langs.map(lang => lang.trim().toLowerCase()).filter(Boolean));
}

// La page de saison numérote ses épisodes avec des appels comme
// `resetListe(); creerListe(62, 143); newSPF("Film"); finirListe(144);`
// (One Piece saison 2 commence à l'épisode 62). Les appels sont relevés dans
// l'ordre de la page, commentaires retirés, puis rejoués comme `videos.js`
// d'anime-sama. Null si la page n'en contient aucun.
const EPISODE_LIST_CALL = /\b(resetListe|creerListe|newSPF|newSP|finirListe)\s*\(([^)]*)\)/g;
const MAX_LISTED_EPISODES = 5000;

function parseEpisodeListCalls(html) {
  if (typeof html !== 'string') return null;
  const code = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[\s;{}])\/\/.*$/gm, '$1');
  const calls = [];
  for (const [, fn, rawArgs] of code.matchAll(EPISODE_LIST_CALL)) {
    const args = rawArgs.split(',').map(arg => arg.trim().replace(/^(['"`])([\s\S]*)\1$/, '$2'));
    calls.push([fn, ...args.filter(arg => arg !== '')]);
  }
  return calls.length ? calls : null;
}

// Noms des épisodes tels que la liste du site les affiche, pour une saison de
// `total` épisodes. `finirListe` va jusqu'au total moins les spéciaux, comme
// sur le site.
function episodeLabelsFromCalls(calls, total) {
  if (!Array.isArray(calls) || !calls.length) return null;
  let labels = [];
  let specials = 0;
  const pushRange = (from, to) => {
    const start = Number.parseInt(from, 10);
    const end = Number.parseInt(to, 10);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    for (let i = start; i <= end && labels.length < MAX_LISTED_EPISODES; i++) labels.push(`Episode ${i}`);
  };
  for (const [fn, ...args] of calls) {
    if (fn === 'resetListe') labels = [];
    else if (fn === 'creerListe') pushRange(args[0], args[1]);
    else if (fn === 'finirListe') pushRange(args[0], total - specials);
    else if (args[0] !== undefined && labels.length < MAX_LISTED_EPISODES) {
      labels.push(fn === 'newSP' ? `Episode ${args[0]}` : args[0]);
      specials++;
    }
  }
  return labels.length ? labels : null;
}

/**
 * Page d'une saison dans une langue (/catalogue/<slug>/<saison>/<langue>/).
 *
 * Depuis le 2026-11-12, la page ne donne plus l'adresse des vidéos : chaque
 * lecteur est un repère `lien:<n°>`, dont l'adresse se demande à
 * `/api/lien.php` avec le jeton de la page (`epsJeton`). `epsMeta` donne
 * l'hébergeur de chaque n° et, en 2e valeur (1 ou 2), une vidéo supprimée.
 *
 * `episodes[i]` liste les lecteurs de l'épisode i dans l'ordre eps1, eps2… :
 * `{ id, host, removed }` pour un repère, `{ url }` pour une adresse écrite en
 * clair (ancien format). Une case vide n'ajoute rien mais garde sa place.
 *
 * `valid` : la page est bien une page de saison. Une saison lisible sans
 * aucun épisode est une saison vidée par anime-sama.
 */
function parseSeasonPage(html) {
  if (typeof html !== 'string' || !html) {
    return { valid: false, langs: null, token: null, listCalls: null, episodeCount: 0, episodes: [] };
  }
  const langs = parsePublishedLanguages(html);

  const lists = [];
  for (const [, rank, body] of html.matchAll(/\bvar\s+eps(\d+)\s*=\s*\[([^\]]*)\]/g)) {
    lists.push([Number(rank), [...body.matchAll(/(["'])(.*?)\1/g)].map(item => item[2].trim())]);
  }
  lists.sort((a, b) => a[0] - b[0]);

  let meta = {};
  const metaMatch = html.match(/\bvar\s+epsMeta\s*=\s*(\{[\s\S]*?\})\s*;/);
  if (metaMatch) {
    try {
      const parsed = JSON.parse(metaMatch[1]);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) meta = parsed;
    } catch { /* table illisible : hébergeurs inconnus, aucun lien marqué supprimé */ }
  }

  const episodeCount = lists.reduce((max, [, items]) => Math.max(max, items.length), 0);
  const episodes = [];
  for (let index = 0; index < episodeCount; index++) {
    const players = [];
    for (const [, items] of lists) {
      const item = items[index];
      if (!item) continue;
      if (item.startsWith('lien:')) {
        const id = item.slice(5).trim();
        if (!/^\d+$/.test(id)) continue;
        const info = Array.isArray(meta[id]) ? meta[id] : [];
        const host = typeof info[0] === 'string' && info[0].trim() ? info[0].trim().toLowerCase() : null;
        players.push({ id, host, removed: info[1] === 1 || info[1] === 2 });
      } else if (/^https?:\/\//i.test(item)) {
        players.push({ url: item });
      }
    }
    episodes.push(players);
  }

  const token = html.match(/\bvar\s+epsJeton\s*=\s*(["'])([^"']*)\1/)?.[2]?.trim() || null;
  return {
    valid: langs !== null || lists.length > 0,
    langs,
    token,
    listCalls: parseEpisodeListCalls(html),
    episodeCount,
    episodes,
  };
}

const pad2 = value => String(value).padStart(2, '0');

// « 09/11 » → « 2026-11-09 » : l'année la plus proche de `now`, pour qu'une
// semaine à cheval sur le Nouvel An garde la bonne année de chaque côté.
function resolveDayKey(day, month, now) {
  const base = new Date(now).getUTCFullYear();
  let best = null;
  for (const year of [base - 1, base, base + 1]) {
    const ts = Date.UTC(year, month - 1, day);
    const date = new Date(ts);
    if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) continue;
    if (!best || Math.abs(ts - now) < Math.abs(best.ts - now)) best = { ts, year };
  }
  return best ? `${best.year}-${pad2(month)}-${pad2(day)}` : null;
}

const attrOf = (attrs, name) => {
  const match = attrs.match(new RegExp(`\\b${name}=(["'])(.*?)\\1`));
  return match ? decodeEntities(match[2]) : '';
};

/**
 * Planning de la semaine (/planning/) : une colonne par jour (« Lundi »,
 * « 09/11 »), une carte par sortie. Seules les sorties d'animes sont rendues.
 *
 * `days` liste tous les jours de la page, même sans anime : l'appelant
 * remplace ces jours-là et garde les semaines passées.
 * `releaseAt` (secondes Unix) est null quand le site n'annonce pas d'heure.
 */
function parsePlanningPage(html, { now = Date.now() } = {}) {
  if (typeof html !== 'string' || !html) return { days: [], entries: [] };

  const header = /<h2[^>]*class=["'][^"']*\btitreJours\b[^"']*["'][^>]*>[\s\S]*?<\/h2>\s*<p[^>]*>\s*(\d{1,2})\/(\d{1,2})\s*<\/p>/g;
  const sections = [];
  for (const match of html.matchAll(header)) {
    const day = resolveDayKey(Number(match[1]), Number(match[2]), now);
    if (day) sections.push({ day, start: match.index + match[0].length });
  }

  const entries = [];
  const seen = new Set();
  sections.forEach((section, rank) => {
    const body = html.slice(section.start, sections[rank + 1]?.start ?? html.length);
    const cards = [...body.matchAll(/<div\s+class=["']([^"']*\bplanning-card\b[^"']*)["']([^>]*)>/g)];
    cards.forEach((card, cardRank) => {
      const classes = card[1].split(/\s+/).filter(Boolean);
      if (!classes.includes('Anime')) return;
      const attrs = card[2];
      const inner = body.slice(card.index + card[0].length, cards[cardRank + 1]?.index ?? body.length);
      const slug = attrOf(attrs, 'data-url').match(/\/catalogue\/([^/]+)\/?/)?.[1] || '';
      const target = parseSeasonTarget(attrOf(attrs, 'data-lien'), slug);
      if (!slug || !target) return;

      const flag = inner.match(/class=["']as-drapeau["'][^>]*>\s*<img[^>]*\balt=["']([^"']*)["']/i)?.[1]?.toLowerCase() || '';
      const classLang = classes.map(name => name.toLowerCase()).find(name => LANGUAGE_IDS.includes(name));
      const lang = LANGUAGE_IDS.includes(flag) ? flag : (classLang || target.lang);
      const info = inner.match(/class=["']as-carte-info["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || '';
      const label = textOf(info.replace(/<svg[\s\S]*?<\/svg>/gi, '').match(/<span>([\s\S]*?)<\/span>/i)?.[1] || '');
      const releaseTs = Number.parseInt(attrOf(attrs, 'data-release-ts'), 10);

      const key = `${section.day}|${slug}|${target.path}|${lang}`;
      if (seen.has(key)) return;
      seen.add(key);
      entries.push({
        slug,
        name: attrOf(attrs, 'data-nom').trim() || slug,
        seasonPath: target.path,
        lang,
        day: section.day,
        releaseAt: Number.isInteger(releaseTs) && releaseTs > 0 ? releaseTs : null,
        label,
        state: classes.includes('pl-sorti') ? 'released' : classes.includes('pl-retard') ? 'delayed' : 'scheduled',
      });
    });
  });

  return { days: uniq(sections.map(section => section.day)), entries };
}

// Slugs des fiches d'œuvres du sitemap (les pages de saison sont ignorées).
function parseSitemap(xml) {
  if (typeof xml !== 'string') return [];
  const slugs = [];
  for (const [, slug] of xml.matchAll(/<loc>\s*https?:\/\/[^/<\s]+\/catalogue\/([a-z0-9][a-z0-9._-]*)\/?\s*<\/loc>/gi)) {
    slugs.push(slug.toLowerCase());
  }
  return uniq(slugs);
}

module.exports = {
  LANGUAGE_IDS,
  decodeEntities,
  parseSeasonTarget,
  parseTitlePage,
  parsePublishedLanguages,
  parseEpisodeListCalls,
  episodeLabelsFromCalls,
  parseSeasonPage,
  parsePlanningPage,
  parseSitemap,
};
