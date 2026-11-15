'use strict';

/**
 * Index du catalogue d'anime-sama.
 *
 * Une tâche de fond lit `sitemap.xml` (la liste des ~2 500 fiches), puis chaque
 * fiche due, et range dans MySQL ce que la fiche publie : nom, genres, langues,
 * saisons, et surtout l'ID TMDB. Une fiche qui n'en publie pas reçoit celui que
 * donne son ID AniList ou MyAnimeList (`resolveTmdb`). Elle lit aussi
 * `/planning/` (les sorties de la semaine). L'index sert trois choses :
 *
 *  - retrouver l'œuvre d'anime-sama d'une fiche TMDB par son ID, au lieu de
 *    comparer des noms ;
 *  - lister le catalogue pour la page Animes ;
 *  - donner les sorties d'animes au calendrier.
 *
 * Deux parties : le magasin (`createAnimeSamaStore`, les requêtes SQL) et la
 * tâche (`createAnimeSamaIndex`, quoi lire et quand). La tâche ne lève jamais :
 * une panne du site ou de la base laisse l'index tel qu'il était.
 */

const { parseTitlePage, parsePlanningPage, parseSitemap, LANGUAGE_IDS } = require('./animeSamaPages');

const DAY_MS = 24 * 60 * 60 * 1000;
const LOCK_KEY = 'animesama:index';
// En dessous, le sitemap n'est pas cru complet : aucune œuvre n'est retirée.
const MIN_SITEMAP_TITLES = 50;
const SITEMAP_HEALTHY_SHARE = 0.7;
const MISSING_KEPT_MS = 30 * DAY_MS;
const PLANNING_KEPT_MS = 60 * DAY_MS;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]{0,190}$/;
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

const FREE_LOCK = Object.freeze({ renew: async () => true, release: async () => {} });
const defaultSleep = ms => new Promise((resolve) => { setTimeout(resolve, ms); });
const failureLabel = error => String(error?.message || error?.code || error || 'erreur').slice(0, 160);
const dayKeyOf = ms => new Date(ms).toISOString().slice(0, 10);

// ---- Magasin MySQL ----

const clip = (value, max) => String(value ?? '').slice(0, max);
const clipOrNull = (value, max) => (typeof value === 'string' && value ? value.slice(0, max) : null);
const idOrNull = value => (Number.isSafeInteger(value) && value > 0 && value <= 4294967295 ? value : null);

// `['Action', 'Drame']` → `|Action|Drame|` : une valeur exacte se filtre par LIKE.
function packList(values, max) {
  let packed = '';
  for (const raw of Array.isArray(values) ? values : []) {
    const value = String(raw ?? '').replace(/\|/g, ' ').trim();
    if (!value || packed.includes(`|${value}|`)) continue;
    const next = `${packed || '|'}${value}|`;
    if (next.length > max) break;
    packed = next;
  }
  return packed;
}
const unpackList = packed => String(packed || '').split('|').filter(Boolean);
const likeEscape = value => String(value).replace(/[\\%_]/g, '\\$&');

function packAltNames(names) {
  const kept = [];
  let size = 2;
  for (const raw of Array.isArray(names) ? names : []) {
    const name = String(raw ?? '').trim().slice(0, 255);
    if (!name || kept.includes(name)) continue;
    size += name.length + 4;
    if (kept.length >= 40 || size > 8000) break;
    kept.push(name);
  }
  return kept.length ? JSON.stringify(kept) : null;
}

function unpackAltNames(raw) {
  if (!raw) return [];
  try {
    const names = JSON.parse(raw);
    return Array.isArray(names) ? names.filter(name => typeof name === 'string') : [];
  } catch {
    return [];
  }
}

const tmdbOf = row => (row.tmdb_id && (row.tmdb_type === 'tv' || row.tmdb_type === 'movie')
  ? { type: row.tmdb_type, id: Number(row.tmdb_id) }
  : null);

const STATUS_FILTERS = { ongoing: 'En cours%', finished: 'Termin%' };
const SORTS = {
  recent: '(year IS NULL), year DESC, first_seen_at DESC, name ASC',
  added: 'first_seen_at DESC, name ASC',
  name: 'name ASC',
};
// Une œuvre visible : elle a au moins une saison d'anime et elle est encore sur le site.
const VISIBLE = 'season_count > 0 AND missing_since IS NULL';

/**
 * Requêtes SQL de l'index. `getPool` rend le pool MySQL du Main API (ou lève
 * tant qu'il n'est pas prêt : l'appelant traite ça comme une panne de la base).
 */
function createAnimeSamaStore({ getPool }) {
  const pool = () => {
    const current = getPool();
    if (!current) throw new Error('Pool MySQL indisponible');
    return current;
  };

  async function listKnown() {
    const [rows] = await pool().query('SELECT slug, checked_at, missing_since FROM anime_sama_titles');
    return rows.map(row => ({
      slug: row.slug,
      checkedAt: Number(row.checked_at) || 0,
      missingSince: row.missing_since === null ? null : Number(row.missing_since),
    }));
  }

  // `keepTmdb` : le lien TMDB déjà rangé reste tel quel (la fiche n'en publie
  // pas et le service de correspondance n'a pas répondu).
  async function saveTitle(slug, fiche, at, { keepTmdb = false } = {}) {
    const tmdbUpdate = keepTmdb ? '' : ' tmdb_type = VALUES(tmdb_type), tmdb_id = VALUES(tmdb_id),';
    const tmdbId = idOrNull(fiche.tmdb?.id);
    const tmdbType = tmdbId && (fiche.tmdb.type === 'tv' || fiche.tmdb.type === 'movie') ? fiche.tmdb.type : null;
    const year = Number.isInteger(fiche.year) && fiche.year >= 1900 && fiche.year <= 2200 ? fiche.year : null;
    const seasons = Array.isArray(fiche.seasons) ? fiche.seasons : [];
    const languages = [...new Set([...(Array.isArray(fiche.languages) ? fiche.languages : []), ...seasons.map(season => season.lang)])]
      .filter(lang => LANGUAGE_IDS.includes(lang));
    await pool().execute(
      `INSERT INTO anime_sama_titles
        (slug, name, alt_names, synopsis, genres, image, poster_path, tmdb_type, tmdb_id, anilist_id, mal_id,
         format, status, year, languages, season_count, hidden_seasons, has_scans, first_seen_at, checked_at, missing_since)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name), alt_names = VALUES(alt_names), synopsis = VALUES(synopsis), genres = VALUES(genres),
         image = VALUES(image), poster_path = VALUES(poster_path),${tmdbUpdate}
         anilist_id = VALUES(anilist_id), mal_id = VALUES(mal_id), format = VALUES(format), status = VALUES(status),
         year = VALUES(year), languages = VALUES(languages), season_count = VALUES(season_count),
         hidden_seasons = VALUES(hidden_seasons), has_scans = VALUES(has_scans), checked_at = VALUES(checked_at),
         missing_since = NULL`,
      [
        slug,
        clip(fiche.name, 255) || slug,
        packAltNames(fiche.altNames),
        clipOrNull(fiche.synopsis, 4000),
        packList(fiche.genres, 512),
        clipOrNull(fiche.image, 512),
        clipOrNull(fiche.posterPath, 128),
        tmdbType,
        tmdbType ? tmdbId : null,
        idOrNull(fiche.anilistId),
        idOrNull(fiche.malId),
        clip(fiche.format, 64),
        clip(fiche.status, 64),
        year,
        packList(languages, 128),
        Math.min(seasons.length, 65535),
        Math.min(Math.max(Number(fiche.hiddenSeasons) || 0, 0), 65535),
        fiche.hasScans ? 1 : 0,
        at,
        at,
      ],
    );
  }

  async function setMissing(slugs, at) {
    for (let start = 0; start < slugs.length; start += 500) {
      const chunk = slugs.slice(start, start + 500);
      await pool().query('UPDATE anime_sama_titles SET missing_since = ? WHERE missing_since IS NULL AND slug IN (?)', [at, chunk]);
    }
  }

  // Les jours de la page sont remplacés d'un bloc ; les autres jours restent.
  async function replacePlanning(days, entries, at) {
    if (!days.length) return;
    const connection = await pool().getConnection();
    try {
      await connection.beginTransaction();
      await connection.query('DELETE FROM anime_sama_planning WHERE day IN (?)', [days]);
      const rows = entries.filter(entry => days.includes(entry.day)).map(entry => [
        entry.day, clip(entry.slug, 191), clip(entry.seasonPath, 100), clip(entry.lang, 16), clip(entry.name, 255) || entry.slug,
        idOrNull(entry.releaseAt), clip(entry.label, 255), clip(entry.state, 16) || 'scheduled', at,
      ]);
      for (let start = 0; start < rows.length; start += 200) {
        await connection.query(
          'INSERT IGNORE INTO anime_sama_planning (day, slug, season_path, lang, name, release_at, label, state, updated_at) VALUES ?',
          [rows.slice(start, start + 200)],
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async function prune(at) {
    await pool().query('DELETE FROM anime_sama_titles WHERE missing_since IS NOT NULL AND missing_since < ?', [at - MISSING_KEPT_MS]);
    await pool().query('DELETE FROM anime_sama_planning WHERE day < ?', [dayKeyOf(at - PLANNING_KEPT_MS)]);
  }

  async function findByTmdb(type, id) {
    const [rows] = await pool().query(
      `SELECT slug, name, alt_names, image, poster_path FROM anime_sama_titles
       WHERE tmdb_type = ? AND tmdb_id = ? AND ${VISIBLE}
       ORDER BY season_count DESC, slug ASC LIMIT 5`,
      [type, id],
    );
    return rows.map(row => ({
      slug: row.slug,
      name: row.name,
      altNames: unpackAltNames(row.alt_names),
      image: row.image || (row.poster_path ? `${TMDB_IMAGE_BASE}${row.poster_path}` : ''),
    }));
  }

  function titleFilters({ search = '', genre = '', language = '', type = '', status = '', linkedOnly = false }) {
    const where = [VISIBLE];
    const params = [];
    if (search) {
      const like = `%${likeEscape(search)}%`;
      where.push('(name LIKE ? OR alt_names LIKE ? OR slug LIKE ?)');
      params.push(like, like, like);
    }
    if (genre) { where.push('genres LIKE ?'); params.push(`%|${likeEscape(genre.replace(/\|/g, ' '))}|%`); }
    if (language) { where.push('languages LIKE ?'); params.push(`%|${likeEscape(language)}|%`); }
    if (type === 'tv' || type === 'movie') { where.push('tmdb_type = ?'); params.push(type); }
    if (STATUS_FILTERS[status]) { where.push('status LIKE ?'); params.push(STATUS_FILTERS[status]); }
    if (linkedOnly) where.push('tmdb_id IS NOT NULL');
    return { clause: where.join(' AND '), params };
  }

  async function listTitles(options = {}) {
    const limit = Math.min(Math.max(Number.parseInt(options.limit, 10) || 48, 1), 60);
    const page = Math.max(Number.parseInt(options.page, 10) || 1, 1);
    const { clause, params } = titleFilters(options);
    const [[count]] = await pool().query(`SELECT COUNT(*) AS total FROM anime_sama_titles WHERE ${clause}`, params);
    const total = Number(count?.total) || 0;
    const [rows] = await pool().query(
      `SELECT slug, name, alt_names, image, poster_path, tmdb_type, tmdb_id, year, genres, languages, format, status, season_count
       FROM anime_sama_titles WHERE ${clause}
       ORDER BY ${SORTS[options.sort] || SORTS.recent} LIMIT ? OFFSET ?`,
      [...params, limit, (page - 1) * limit],
    );
    return {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      items: rows.map(row => ({
        slug: row.slug,
        name: row.name,
        altNames: unpackAltNames(row.alt_names),
        image: row.image || '',
        posterPath: row.poster_path || null,
        tmdb: tmdbOf(row),
        year: row.year === null ? null : Number(row.year),
        genres: unpackList(row.genres),
        languages: unpackList(row.languages),
        format: row.format || '',
        status: row.status || '',
        seasonCount: Number(row.season_count) || 0,
      })),
    };
  }

  // Genres du catalogue visible, du plus fourni au moins fourni.
  async function listGenres() {
    const [rows] = await pool().query(`SELECT genres FROM anime_sama_titles WHERE ${VISIBLE} AND genres <> ''`);
    const counts = new Map();
    for (const row of rows) for (const genre of unpackList(row.genres)) counts.set(genre, (counts.get(genre) || 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr')).map(([name, count]) => ({ name, count }));
  }

  async function readPlanning({ from, to }) {
    const [rows] = await pool().query(
      `SELECT p.day, p.slug, p.season_path, p.lang, p.name, p.release_at, p.label, p.state, p.updated_at,
              t.tmdb_type, t.tmdb_id, t.poster_path, t.image
       FROM anime_sama_planning p LEFT JOIN anime_sama_titles t ON t.slug = p.slug
       WHERE p.day >= ? AND p.day <= ?
       ORDER BY p.day ASC, (p.release_at IS NULL), p.release_at ASC, p.name ASC LIMIT 3000`,
      [from, to],
    );
    let updatedAt = null;
    const entries = rows.map((row) => {
      const stamp = Number(row.updated_at) || 0;
      if (stamp > (updatedAt || 0)) updatedAt = stamp;
      return {
        day: row.day,
        slug: row.slug,
        name: row.name,
        seasonPath: row.season_path,
        lang: row.lang,
        releaseAt: row.release_at === null ? null : Number(row.release_at),
        label: row.label || '',
        state: row.state,
        tmdb: tmdbOf(row),
        posterPath: row.poster_path || null,
        image: row.image || '',
      };
    });
    return { updatedAt, entries };
  }

  // Dernier jour pour lequel une sortie est rangée (`AAAA-MM-JJ`), ou null.
  async function lastPlanningDay() {
    const [[row]] = await pool().query('SELECT MAX(day) AS day FROM anime_sama_planning');
    return row?.day || null;
  }

  return { listKnown, saveTitle, setMissing, replacePlanning, prune, findByTmdb, listTitles, listGenres, readPlanning, lastPlanningDay };
}

// ---- Planning : semaine suivante ----

const shiftDay = (day, days) => dayKeyOf(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS);
// Le planning du site va du lundi au dimanche : dimanche de la semaine de `day`.
const sundayOf = day => shiftDay(day, (7 - new Date(`${day}T00:00:00Z`).getUTCDay()) % 7);
// Sorties qui ne reviennent pas chaque semaine.
const ONE_OFF_PATH = /^(?:film|oav)/i;
const EPISODE_NUMBER = /(Épisode\s+)(\d+)(\s*)$/i;

/**
 * Sorties prévues la semaine suivante : celles de la semaine connue, sept jours
 * plus tard. Le numéro d'épisode avance d'autant d'épisodes que l'œuvre en sort
 * par semaine dans cette langue (« Saison 1 · Épisode 6 » → « … Épisode 7 »).
 */
function expectNextWeek(entries) {
  const weekly = entries.filter(entry => !ONE_OFF_PATH.test(entry.seasonPath));
  const runOf = entry => `${entry.slug}|${entry.seasonPath}|${entry.lang}`;
  const perWeek = new Map();
  for (const entry of weekly) perWeek.set(runOf(entry), (perWeek.get(runOf(entry)) || 0) + 1);
  return weekly.map(entry => ({
    ...entry,
    day: shiftDay(entry.day, 7),
    releaseAt: entry.releaseAt === null ? null : entry.releaseAt + (7 * DAY_MS) / 1000,
    label: String(entry.label || '').replace(EPISODE_NUMBER, (_, word, number, tail) => `${word}${Number(number) + perWeek.get(runOf(entry))}${tail}`),
    state: 'scheduled',
    estimated: true,
  }));
}

// ---- Tâche de fond ----

/**
 * `request` : la requête du Main API vers anime-sama (`axiosAnimeSamaRequest`).
 * `acquireLock(clé)` : bail `{ renew, release }`, ou null si un autre serveur
 * lit déjà le catalogue.
 *
 * Une fiche est due quand elle est nouvelle, revenue au sitemap, ou lue il y a
 * plus de `recheckAfterMs`. Le premier passage lit donc tout le catalogue
 * (~2 500 requêtes espacées de `pauseMs`), les suivants seulement les fiches dues.
 */
function createAnimeSamaIndex({
  store,
  request,
  siteUrl,
  now = Date.now,
  sleep = defaultSleep,
  logger = console,
  acquireLock = async () => FREE_LOCK,
  recheckAfterMs = DAY_MS,
  pauseMs = 400,
  maxFailuresInARow = 5,
  maxPassMs = 45 * 60 * 1000,
  // Plafond de fiches lues par passage (les suivantes attendent le prochain).
  maxTitlesPerPass = Infinity,
  // `resolveTmdb({ anilistId, malId })` : lien TMDB `{ type, id }` d'une fiche
  // qui n'en publie pas, ou null (utils/animeSamaTmdbResolver.js). Lève quand
  // le service de correspondance ne répond pas. Sans lui, rien n'est déduit.
  resolveTmdb = null,
}) {
  let running = false;
  let stopped = false;
  let firstTimer = null;
  let timer = null;

  // `{ html }`, `{ missing: true }` (404) ou `{ failed: 'raison' }`.
  async function readPage(pathname) {
    try {
      const response = await request({ method: 'get', url: new URL(pathname, siteUrl).href, timeout: 15000 });
      if (response?.status === 404) return { missing: true };
      if (response?.status !== undefined && response.status !== 200) return { failed: `HTTP ${response.status}` };
      return { html: typeof response?.data === 'string' ? response.data : '' };
    } catch (error) {
      const status = Number(error?.response?.status);
      if (status === 404) return { missing: true };
      return { failed: Number.isInteger(status) && status > 0 ? `HTTP ${status}` : failureLabel(error) };
    }
  }

  /**
   * Fiche prête à ranger. Si elle ne publie pas d'ID TMDB, elle reçoit celui
   * que donne son ID AniList ou MyAnimeList, sauf quand une autre œuvre porte
   * déjà cet ID : la correspondance comble un trou, elle ne dispute pas une page.
   * `keepTmdb` : le service n'a pas répondu, le lien déjà rangé reste.
   */
  async function linkTitle(slug, fiche) {
    const ids = { anilistId: fiche.anilistId ?? null, malId: fiche.malId ?? null };
    if (fiche.tmdb || typeof resolveTmdb !== 'function' || (!ids.anilistId && !ids.malId)) return { fiche, keepTmdb: false };
    let tmdb;
    try {
      tmdb = await resolveTmdb(ids);
    } catch (error) {
      return { fiche, keepTmdb: true, failure: failureLabel(error) };
    }
    if (!tmdb) return { fiche, keepTmdb: false };
    const holders = await store.findByTmdb(tmdb.type, tmdb.id);
    if (holders.some(title => title.slug !== slug)) return { fiche, keepTmdb: false };
    return { fiche: { ...fiche, tmdb }, keepTmdb: false, derived: true };
  }

  async function refreshPlanning() {
    const page = await readPage('planning/');
    if (page.html === undefined) throw new Error(`Planning AnimeSama illisible (${page.failed || 'page introuvable'})`);
    const { days, entries } = parsePlanningPage(page.html, { now: now() });
    if (!days.length) throw new Error('Planning AnimeSama illisible (aucun jour)');
    await store.replacePlanning(days, entries, now());
    return { days: days.length, entries: entries.length };
  }

  async function crawl(lock = FREE_LOCK) {
    const sitemap = await readPage('sitemap.xml');
    const slugs = sitemap.html === undefined ? [] : parseSitemap(sitemap.html);
    if (!slugs.length) throw new Error(`Sitemap AnimeSama illisible (${sitemap.failed || 'aucune fiche'})`);

    const startedAt = now();
    const known = new Map((await store.listKnown()).map(title => [title.slug, title]));
    const listed = new Set(slugs);
    const present = [...known.values()].filter(title => title.missingSince === null);
    const report = { listed: slugs.length, due: 0, saved: 0, derived: 0, missing: 0, failed: 0, aborted: false };
    const unlinked = { count: 0, reason: '' };

    // Une œuvre absente d'un sitemap complet a été retirée du site. Un sitemap
    // trop court (page tronquée) ne retire rien.
    if (slugs.length >= Math.max(MIN_SITEMAP_TITLES, present.length * SITEMAP_HEALTHY_SHARE)) {
      const gone = present.filter(title => !listed.has(title.slug)).map(title => title.slug);
      if (gone.length) {
        await store.setMissing(gone, startedAt);
        report.missing += gone.length;
      }
    } else if (present.length) {
      logger.warn(`[ANIME-SAMA] Index : Sitemap incomplet (${slugs.length} fiches pour ${present.length} connues), aucune œuvre retirée`);
    }

    const cutoff = startedAt - recheckAfterMs;
    const fresh = slugs.filter(slug => !known.has(slug));
    const stale = slugs.map(slug => known.get(slug))
      .filter(title => title && (title.missingSince !== null || title.checkedAt <= cutoff))
      .sort((a, b) => a.checkedAt - b.checkedAt)
      .map(title => title.slug);
    const due = [...fresh, ...stale].slice(0, Math.max(0, maxTitlesPerPass));
    report.due = due.length;

    let failuresInARow = 0;
    for (let rank = 0; rank < due.length; rank++) {
      if (stopped || now() - startedAt > maxPassMs) { report.aborted = true; break; }
      if (rank > 0) await sleep(pauseMs);
      if (rank % 20 === 19) await Promise.resolve(lock.renew()).catch(() => {});

      const slug = due[rank];
      const page = await readPage(`catalogue/${slug}/`);
      if (page.missing) {
        // Fiche supprimée alors que le sitemap la liste encore.
        if (known.get(slug)?.missingSince === null) {
          await store.setMissing([slug], now());
          report.missing += 1;
        }
        failuresInARow = 0;
        continue;
      }
      const fiche = page.html === undefined ? null : parseTitlePage(page.html, { slug });
      if (!fiche?.valid) {
        // Page de vérification, panne : ce qu'on savait de la fiche est gardé.
        report.failed += 1;
        failuresInARow += 1;
        if (failuresInARow >= maxFailuresInARow) {
          report.aborted = true;
          logger.warn(`[ANIME-SAMA] Index : passage interrompu après ${failuresInARow} fiches illisibles d'affilée (${page.failed || 'page inattendue'})`);
          break;
        }
        continue;
      }
      failuresInARow = 0;
      const linked = await linkTitle(slug, fiche);
      if (linked.failure) { unlinked.count += 1; unlinked.reason = linked.failure; }
      if (linked.derived) report.derived += 1;
      await store.saveTitle(slug, linked.fiche, now(), { keepTmdb: linked.keepTmdb });
      report.saved += 1;
    }

    if (unlinked.count) {
      logger.warn(`[ANIME-SAMA] Index : correspondance AniList/MAL vers TMDB indisponible pour ${unlinked.count} fiche(s) (${unlinked.reason}), liens déjà rangés gardés`);
    }

    await store.prune(now());
    return report;
  }

  /**
   * Un passage complet : planning, puis fiches dues. Rend le bilan, ou null si
   * un autre passage est déjà en cours (ici ou sur un autre serveur). Ne lève jamais.
   */
  async function runOnce() {
    if (running) return null;
    running = true;
    let lock = null;
    try {
      lock = await acquireLock(LOCK_KEY);
      if (!lock) return null;
      const report = { planning: null, listed: 0, due: 0, saved: 0, derived: 0, missing: 0, failed: 0, aborted: false };
      try {
        report.planning = await refreshPlanning();
      } catch (error) {
        logger.warn(`[ANIME-SAMA] Index : ${failureLabel(error)}`);
      }
      try {
        Object.assign(report, await crawl(lock));
        if (report.saved || report.missing || report.failed) {
          const unreadable = report.failed ? `, ${report.failed} en échec` : '';
          const derived = report.derived ? `, dont ${report.derived} reliées à TMDB par leur ID AniList ou MAL` : '';
          logger.log(`[ANIME-SAMA] Index : ${report.listed} fiches au sitemap, ${report.saved} lues${derived}, ${report.missing} retirées${unreadable}`);
        }
      } catch (error) {
        logger.warn(`[ANIME-SAMA] Index : ${failureLabel(error)}`);
      }
      return report;
    } catch (error) {
      logger.warn(`[ANIME-SAMA] Index : ${failureLabel(error)}`);
      return null;
    } finally {
      running = false;
      if (lock) await Promise.resolve().then(() => lock.release()).catch(() => {});
    }
  }

  // Fiche lue par la source pendant une actualisation : l'index en profite.
  async function recordTitle(slug, fiche) {
    if (typeof slug !== 'string' || !SLUG_PATTERN.test(slug) || !fiche || fiche.valid !== true) return false;
    try {
      const linked = await linkTitle(slug, fiche);
      await store.saveTitle(slug, linked.fiche, now(), { keepTmdb: linked.keepTmdb });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Sorties entre deux jours. Le planning du site s'arrête au dimanche de la
   * semaine en cours : la semaine d'après est prévue en recopiant la semaine
   * connue (`estimated: true`). Une sortie prévue n'existe que tant que le site
   * n'a pas publié cette semaine-là, et jamais dans le passé.
   */
  async function readPlanning({ from, to }) {
    const planning = await store.readPlanning({ from, to });
    const lastDay = await store.lastPlanningDay();
    if (!lastDay) return planning;

    const weekEnd = sundayOf(lastDay);
    const first = [from, shiftDay(weekEnd, 1), dayKeyOf(now())].sort().pop();
    const last = [to, shiftDay(weekEnd, 7)].sort()[0];
    if (first > last) return planning;

    const known = await store.readPlanning({ from: shiftDay(weekEnd, -6), to: weekEnd });
    const expected = expectNextWeek(known.entries).filter(entry => entry.day >= first && entry.day <= last);
    return { updatedAt: planning.updatedAt ?? known.updatedAt, entries: [...planning.entries, ...expected] };
  }

  /**
   * Lance la tâche sur le worker désigné : un premier passage après
   * `firstDelayMs`, puis un toutes les `intervalMs`. Rend false si rien n'a été
   * lancé (autre worker, ou déjà lancée).
   */
  function start({ isOwner = true, firstDelayMs = 90 * 1000, intervalMs = 30 * 60 * 1000 } = {}) {
    if (!isOwner || timer) return false;
    stopped = false;
    const tick = () => { runOnce().catch(() => {}); };
    firstTimer = setTimeout(tick, firstDelayMs);
    timer = setInterval(tick, intervalMs);
    firstTimer.unref?.();
    timer.unref?.();
    return true;
  }

  function stop() {
    stopped = true;
    clearTimeout(firstTimer);
    clearInterval(timer);
    firstTimer = null;
    timer = null;
  }

  return {
    runOnce,
    refreshPlanning,
    recordTitle,
    start,
    stop,
    findByTmdb: (type, id) => store.findByTmdb(type, id),
    listTitles: options => store.listTitles(options),
    listGenres: () => store.listGenres(),
    readPlanning,
  };
}

module.exports = { createAnimeSamaIndex, createAnimeSamaStore };
