// Passage des données de synchro (`progress_*`, `continueWatching`, marques
// « Déjà vu » `watched_movie` / `watched_tv` / `watched_episodes_tv_*`) vers
// les tables de l'historique :
// - miroir de chaque POST `/api/sync` (au mieux, erreurs seulement loguées) ;
// - import silencieux des anciennes données d'un profil, une seule fois ;
// - élagage des plus vieilles `progress_*` pour ne plus buter sur le mur
//   des 600 clés du fichier de synchro.

const crypto = require('crypto');
const {
  parseProgressKey,
  parseProgressValue,
  parseContinueWatching,
  parseMarksKey,
  parseMarks,
  isFinished,
} = require('./historyRules');

// Après élagage, on redescend 50 clés sous la limite pour ne pas élaguer à
// chaque synchro suivante.
const PRUNE_MARGIN = 50;
const IMPORT_LOCK_TIMEOUT_SECONDS = 30;
// Après un import raté, on attend avant de réessayer : la synchro tourne
// toutes les quelques secondes pendant une lecture.
const IMPORT_RETRY_DELAY_MS = 10 * 60 * 1000;
const MAX_REMEMBERED_OWNERS = 10000;
// Chaque import garde une connexion MySQL (verrou) pendant toute sa durée.
const MAX_CONCURRENT_IMPORTS = 2;
// Réglage « Désactiver l'historique » du site (`'true'` / `'false'`).
const HISTORY_DISABLED_KEY = 'settings_disable_history';

// Mémoire du processus : profils déjà importés, imports en cours, échecs récents.
let activeImports = 0;
const knownImported = new Set();
const inFlightImports = new Map();
const failedImports = new Map();

function warn(message, error) {
  console.warn(`[HISTORY] ${message}:`, error && error.message ? error.message : error);
}

function ownerKey(owner) {
  return `${owner.userType}:${owner.userId}:${owner.profileId}`;
}

function titleKey(mediaType, tmdbId) {
  return `${mediaType}:${tmdbId}`;
}

function buildImportLockName(owner) {
  const digest = crypto.createHash('sha1').update(ownerKey(owner)).digest('hex');
  return `mainapi:history-import:${digest}`;
}

function rememberBounded(collection, key, value) {
  if (collection.size >= MAX_REMEMBERED_OWNERS) collection.clear();
  if (collection instanceof Map) collection.set(key, value);
  else collection.add(key);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Map des valeurs précédentes. Pas de `instanceof Map` : une Map créée dans un
// autre contexte (tests chargés par `vm`) ne passerait pas.
function isMapLike(value) {
  return Boolean(value) && typeof value.get === 'function' && typeof value.has === 'function';
}

// `continueWatching` présent et lisible (même vide) : objet ou tableau JSON.
function isContinueWatchingReadable(raw) {
  if (typeof raw !== 'string') return false;
  try {
    const data = JSON.parse(raw);
    return Boolean(data) && typeof data === 'object';
  } catch {
    return false;
  }
}

// Horodatage d'une valeur `progress_*` ; illisible → la plus vieille.
function progressTime(raw) {
  const value = parseProgressValue(raw);
  return value ? value.updatedAt.getTime() : Number.NEGATIVE_INFINITY;
}

// Une entrée par titre (`media_type:tmdb_id`), la plus récemment ouverte ;
// une entrée sans date compte comme la plus vieille.
function latestEntryPerTitle(entries) {
  const byTitle = new Map();
  for (const entry of entries) {
    const key = titleKey(entry.mediaType, entry.tmdbId);
    const current = byTitle.get(key);
    const time = entry.lastAccessed ? entry.lastAccessed.getTime() : Number.NEGATIVE_INFINITY;
    const currentTime = current && current.lastAccessed ? current.lastAccessed.getTime() : Number.NEGATIVE_INFINITY;
    if (!current || time > currentTime) byTitle.set(key, entry);
  }
  return [...byTitle.values()];
}

/**
 * Si `serverData` a plus de `maxKeys` clés, supprime les `progress_*` les plus
 * anciennes (par `timestamp`, valeurs illisibles d'abord) jusqu'à
 * `maxKeys - 50` clés. Modifie `serverData` et renvoie les clés supprimées.
 */
function pruneProgressKeys(serverData, maxKeys) {
  if (!isPlainObject(serverData)) return [];
  const keys = Object.keys(serverData);
  if (keys.length <= maxKeys) return [];

  const target = Math.max(maxKeys - PRUNE_MARGIN, 0);
  const candidates = keys
    .filter((key) => key.startsWith('progress_'))
    .map((key) => ({ key, time: progressTime(serverData[key]) }))
    .sort((a, b) => a.time - b.time);

  const removed = [];
  let remaining = keys.length;
  for (const { key } of candidates) {
    if (remaining <= target) break;
    delete serverData[key];
    removed.push(key);
    remaining--;
  }
  return removed;
}

async function mirrorContinueWatching(historyStore, owner, raw, previousRaw) {
  // Date de la dernière ouverture déjà connue pour chaque titre (null : sans date).
  const previous = new Map();
  if (typeof previousRaw === 'string') {
    for (const entry of latestEntryPerTitle(parseContinueWatching(previousRaw))) {
      previous.set(titleKey(entry.mediaType, entry.tmdbId), entry.lastAccessed ? entry.lastAccessed.getTime() : null);
    }
  }

  const entries = latestEntryPerTitle(parseContinueWatching(raw));

  // Entrée retirée par rapport à l'ancienne valeur : l'utilisateur a retiré
  // le titre de « Reprendre ». Seulement si la nouvelle valeur est lisible,
  // pour ne pas tout masquer sur une valeur abîmée.
  if (isContinueWatchingReadable(raw)) {
    const current = new Set(entries.map((entry) => titleKey(entry.mediaType, entry.tmdbId)));
    for (const title of previous.keys()) {
      if (current.has(title)) continue;
      const [mediaType, tmdbId] = title.split(':');
      try {
        await historyStore.hide(owner, mediaType, Number(tmdbId));
      } catch (error) {
        warn(`retrait de ${title} non recopié`, error);
      }
    }
  }

  for (const entry of entries) {
    // Sans date, impossible de dire si l'ouverture est plus récente.
    if (!entry.lastAccessed) continue;
    const known = previous.get(titleKey(entry.mediaType, entry.tmdbId));
    if (typeof known === 'number' && known >= entry.lastAccessed.getTime()) continue;
    try {
      await historyStore.touch(owner, {
        mediaType: entry.mediaType,
        tmdbId: entry.tmdbId,
        season: entry.season,
        episode: entry.episode,
        at: entry.lastAccessed,
      });
    } catch (error) {
      warn(`ouverture ${entry.mediaType}:${entry.tmdbId} non recopiée`, error);
    }
  }
}

/**
 * Marques « Déjà vu » d'une clé : différence entre l'ancienne et la nouvelle
 * valeur (ajouts → `addMarks`, retraits → `removeMarks`). Clé supprimée →
 * toutes ses marques partent. Nouvelle valeur illisible → rien ne bouge ;
 * ancienne valeur inconnue ou illisible → ajouts seulement.
 */
async function mirrorMarks(historyStore, owner, key, raw, previousRaw, previousKnown, serverData = null) {
  const current = typeof raw === 'string' ? parseMarks(key, raw) : new Map();
  if (!current) return;
  let previous = null;
  if (previousKnown) previous = typeof previousRaw === 'string' ? parseMarks(key, previousRaw) : new Map();

  // Un épisode peut être marqué par deux clés (watched_episodes_tv_* et
  // l'ancienne watched_tv_episodes) : on ne le retire pas s'il l'est encore
  // par une autre clé de la valeur finale du profil.
  const elsewhere = new Set();
  for (const [otherKey, otherRaw] of Object.entries(isPlainObject(serverData) ? serverData : {})) {
    if (otherKey === key || !parseMarksKey(otherKey)) continue;
    const marks = parseMarks(otherKey, otherRaw);
    if (marks) for (const id of marks.keys()) elsewhere.add(id);
  }
  const removals = previous
    ? [...previous].filter(([id]) => !current.has(id) && !elsewhere.has(id)).map(([, mark]) => mark)
    : [];
  const additions = [...current].filter(([id]) => !previous || !previous.has(id)).map(([, mark]) => mark);
  if (removals.length > 0) {
    try {
      await historyStore.removeMarks(owner, removals);
    } catch (error) {
      warn(`retraits de ${key} non recopiés`, error);
    }
  }
  if (additions.length > 0) {
    try {
      await historyStore.addMarks(owner, additions);
    } catch (error) {
      warn(`marques de ${key} non recopiées`, error);
    }
  }
}

/** Vrai si une op de l'envoi touche une clé de marques « Déjà vu ». */
function touchesMarks(ops) {
  return (Array.isArray(ops) ? ops : []).some((op) => op && parseMarksKey(op.key));
}

/**
 * Marques « Déjà vu » d'un POST `/api/sync` : à appeler SOUS le verrou de
 * synchro du profil et à attendre, pour que deux envois s'appliquent dans
 * l'ordre (un retrait ne peut plus passer avant l'ajout qui le précède).
 * Toute op compte (le site envoie arrayAdd / arrayRemove pour les listes,
 * objPatch pour les épisodes, remove pour vider la clé) ; seule la
 * différence entre valeur finale et précédente est écrite.
 * Ne lève jamais : les erreurs sont loguées `[HISTORY]`.
 */
async function applyMarkOps(historyStore, owner, ops, serverData, previousValues = null) {
  try {
    const keys = new Set();
    for (const op of Array.isArray(ops) ? ops : []) {
      if (op && parseMarksKey(op.key)) keys.add(op.key);
    }
    const previousMap = isMapLike(previousValues) ? previousValues : null;
    for (const key of keys) {
      const raw = serverData ? serverData[key] : undefined;
      const previousRaw = previousMap ? previousMap.get(key) : undefined;
      if (previousRaw === raw) continue;
      await mirrorMarks(historyStore, owner, key, raw, previousRaw, Boolean(previousMap && previousMap.has(key)), serverData);
    }
  } catch (error) {
    warn('marques de la synchro interrompues', error);
  }
}

/**
 * Toutes les marques « Déjà vu » d'un profil (données de synchro).
 * `complete` faux si une clé de marques est illisible : ses marques sont
 * inconnues, on ne doit alors rien retirer.
 * @returns {{ marks: object[], complete: boolean }}
 */
function marksOfProfile(profileData) {
  const data = isPlainObject(profileData) ? profileData : {};
  // Union de toutes les clés de marques (un épisode marqué par deux clés
  // ne compte qu'une fois ; la date connue l'emporte sur une date absente).
  const marks = new Map();
  let complete = true;
  for (const [key, raw] of Object.entries(data)) {
    if (!parseMarksKey(key)) continue;
    const parsed = parseMarks(key, raw);
    if (!parsed) {
      complete = false;
      continue;
    }
    for (const [id, mark] of parsed) {
      const known = marks.get(id);
      if (!known || (!known.markedAt && mark.markedAt)) marks.set(id, mark);
    }
  }
  return { marks: [...marks.values()], complete };
}

/**
 * Recopie dans l'historique les ops `set`/`objPatch` d'un POST `/api/sync`.
 * Un `remove` de `continueWatching`, ou `settings_disable_history` passé à
 * `'true'`, vide la rangée « Reprendre » (`hideAll`). Les clés de marques
 * « Déjà vu » ne passent pas ici mais par `applyMarkOps`, sous le verrou.
 * `serverData` donne la valeur finale de chaque clé ; `previousValues`
 * (Map clé → valeur avant les ops, facultative) évite de recopier une clé
 * renvoyée telle quelle. Ne lève jamais : les erreurs sont loguées `[HISTORY]`.
 */
async function mirrorSyncOps(historyStore, owner, ops, serverData, previousValues = null) {
  try {
    const keys = new Set();
    let continueWatchingRemoved = false;
    for (const op of Array.isArray(ops) ? ops : []) {
      if (!op || typeof op.key !== 'string') continue;
      if (op.op === 'remove' && op.key === 'continueWatching') continueWatchingRemoved = true;
      if (op.op !== 'set' && op.op !== 'objPatch') continue;
      if (parseMarksKey(op.key)) continue;
      keys.add(op.key);
    }
    const previousMap = isMapLike(previousValues) ? previousValues : null;

    // Rangée vidée : clé `continueWatching` supprimée (et pas remise dans le
    // même envoi) ou historique désactivé dans les réglages. Masquage fait en
    // dernier, pour qu'aucune progression recopiée ne fasse revenir un titre.
    let clearAll = continueWatchingRemoved && (!serverData || typeof serverData.continueWatching !== 'string');

    for (const key of keys) {
      const raw = serverData ? serverData[key] : undefined;
      const previousRaw = previousMap ? previousMap.get(key) : undefined;

      if (typeof raw !== 'string') continue;
      if (previousRaw === raw) continue;

      if (key === HISTORY_DISABLED_KEY) {
        if (raw === 'true') clearAll = true;
        continue;
      }

      if (key === 'continueWatching') {
        await mirrorContinueWatching(historyStore, owner, raw, previousRaw);
        continue;
      }

      const target = parseProgressKey(key);
      if (!target) continue;
      const value = parseProgressValue(raw);
      if (!value) continue;
      try {
        await historyStore.recordProgress(owner, { ...target, ...value });
      } catch (error) {
        warn(`progression ${key} non recopiée`, error);
      }
    }

    if (clearAll) {
      try {
        await historyStore.hideAll(owner);
      } catch (error) {
        warn('rangée « Reprendre » non vidée', error);
      }
    }
  } catch (error) {
    warn('miroir de la synchro interrompu', error);
  }
}

async function markImported(pool, owner) {
  await pool.execute(
    `INSERT INTO watch_history_imports (user_type, user_id, profile_id, imported_at)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE imported_at = imported_at`,
    [owner.userType, owner.userId, owner.profileId, new Date()],
  );
}

async function isImported(pool, owner) {
  const [rows] = await pool.execute(
    `SELECT 1 AS found FROM watch_history_imports
    WHERE user_type = ? AND user_id = ? AND profile_id = ?
    LIMIT 1`,
    [owner.userType, owner.userId, owner.profileId],
  );
  return Array.isArray(rows) && rows.length > 0;
}

/**
 * Importe les anciennes données d'un profil : toutes les `progress_*`, puis
 * `continueWatching` (une entrée par titre). Les marques « Déjà vu » n'en
 * font pas partie : elles sont relues dans le fichier sous le verrou de
 * synchro après l'import (`options.afterImport` de `ensureImported`), sinon
 * des données lues avant un retrait pourraient le défaire. Une entrée déjà couverte par une
 * progression n'est touchée que si son ouverture est plus récente ; une entrée
 * sans date prend celle de sa progression la plus récente, sinon 1970-01-01.
 * Si `continueWatching` existe et se lit (même vide), un titre avec progression
 * mais absent de la liste a été retiré de « Reprendre » par l'utilisateur : il
 * est importé masqué (`hide` après sa progression). Exception : un film fini,
 * déjà hors de la rangée. Une série absente est masquée même si son dernier
 * épisode est fini, sinon elle reviendrait sur l'épisode suivant. Sans clé
 * `continueWatching`, tout reste visible. Avec `settings_disable_history`
 * à `'true'`, tout est importé puis masqué (`hideAll`).
 * Une erreur SQL est propagée. Avec `options.pool`, marque `watch_history_imports`
 * une fois tout importé.
 * @returns {Promise<{ progress: number, titles: number, hidden: number }>}
 */
async function importProfile(historyStore, owner, profileData, options = {}) {
  const data = isPlainObject(profileData) ? profileData : {};
  const latestProgress = new Map();
  const finishedMovies = new Set();
  const titles = new Set();
  let progress = 0;
  let hidden = 0;

  for (const [key, raw] of Object.entries(data)) {
    const target = parseProgressKey(key);
    if (!target) continue;
    const value = parseProgressValue(raw);
    if (!value) continue;
    await historyStore.recordProgress(owner, { ...target, ...value });
    progress++;
    const title = titleKey(target.mediaType, target.tmdbId);
    titles.add(title);
    const time = value.updatedAt.getTime();
    if (!latestProgress.has(title) || latestProgress.get(title) < time) latestProgress.set(title, time);
    if (target.mediaType === 'movie' && isFinished(value.position, value.duration)) finishedMovies.add(title);
  }

  const continueEntries = latestEntryPerTitle(parseContinueWatching(data.continueWatching));

  if (isContinueWatchingReadable(data.continueWatching)) {
    const listed = new Set(continueEntries.map((entry) => titleKey(entry.mediaType, entry.tmdbId)));
    for (const title of latestProgress.keys()) {
      if (listed.has(title) || finishedMovies.has(title)) continue;
      const [mediaType, tmdbId] = title.split(':');
      await historyStore.hide(owner, mediaType, Number(tmdbId));
      hidden++;
    }
  }

  for (const entry of continueEntries) {
    const title = titleKey(entry.mediaType, entry.tmdbId);
    const latest = latestProgress.get(title);
    const opened = entry.lastAccessed ? entry.lastAccessed.getTime() : null;
    // Déjà en place grâce à sa progression, et pas d'ouverture plus récente.
    if (latest !== undefined && (opened === null || opened <= latest)) continue;
    await historyStore.touch(owner, {
      mediaType: entry.mediaType,
      tmdbId: entry.tmdbId,
      season: entry.season,
      episode: entry.episode,
      at: new Date(opened ?? latest ?? 0),
    });
    titles.add(title);
  }

  // Historique désactivé : progressions gardées, mais rien dans « Reprendre ».
  if (data[HISTORY_DISABLED_KEY] === 'true') {
    hidden += Number(await historyStore.hideAll(owner)) || 0;
  }

  if (options.pool) await markImported(options.pool, owner);
  return { progress, titles: titles.size, hidden };
}

/**
 * Importe le profil s'il ne l'a jamais été (ligne `watch_history_imports`
 * absente). Un seul import à la fois par propriétaire : dans ce processus
 * (promesse partagée) et entre processus (verrou MySQL
 * `mainapi:history-import:<sha1>`). Au plus 2 imports en même temps par
 * processus (chacun garde une connexion pour son verrou) : au-delà, l'import
 * est sauté et retenté à un prochain appel. `readProfileData(userType, userId,
 * profileId)` n'est appelée que si l'import a lieu. `options.afterImport(owner)`
 * est lancé (sans être attendu) après un import fait par cet appel. Ne lève jamais.
 * @returns {Promise<'imported' | 'already' | 'deferred' | 'failed'>}
 *   'imported' : import fait par cet appel ; 'already' : déjà marqué ;
 *   'deferred' : remis à plus tard (délai après échec ou aucune place libre) ;
 *   'failed' : import en échec, profil non marqué (erreur loguée `[HISTORY]`).
 */
async function ensureImported(pool, historyStore, owner, readProfileData, options = {}) {
  const key = ownerKey(owner);
  if (knownImported.has(key)) return 'already';

  const running = inFlightImports.get(key);
  if (running) return running;

  const failedAt = failedImports.get(key);
  if (failedAt !== undefined && Date.now() - failedAt < IMPORT_RETRY_DELAY_MS) return 'deferred';

  const withLock = options.withLock || require('../mysqlPool').withMysqlAdvisoryLock;
  const task = (async () => {
    try {
      // Vérification sans verrou ni place : un simple SELECT.
      if (await isImported(pool, owner)) {
        rememberBounded(knownImported, key);
        return 'already';
      }
      if (activeImports >= MAX_CONCURRENT_IMPORTS) return 'deferred';

      activeImports++;
      let status;
      try {
        status = await withLock(pool, buildImportLockName(owner), async () => {
          // Un autre processus a pu importer pendant l'attente du verrou.
          if (await isImported(pool, owner)) return 'already';
          const data = await readProfileData(owner.userType, owner.userId, owner.profileId);
          const result = await importProfile(historyStore, owner, data, { pool });
          console.log(`[HISTORY] profil importé : ${result.progress} progressions, ${result.titles} titres, ${result.hidden} masqués`);
          return 'imported';
        }, { timeoutSeconds: IMPORT_LOCK_TIMEOUT_SECONDS });
      } finally {
        activeImports--;
      }
      failedImports.delete(key);
      rememberBounded(knownImported, key);
      // Marques « Déjà vu » relues par l'appelant sous le verrou de synchro.
      // Jamais attendu : une synchro peut attendre cet import en tenant déjà
      // ce verrou.
      if (status === 'imported' && typeof options.afterImport === 'function') {
        Promise.resolve()
          .then(() => options.afterImport(owner))
          .catch((error) => warn('marques du profil importé non relues', error));
      }
      return status;
    } catch (error) {
      rememberBounded(failedImports, key, Date.now());
      warn('import du profil en échec', error);
      return 'failed';
    }
  })();

  inFlightImports.set(key, task);
  try {
    return await task;
  } finally {
    inFlightImports.delete(key);
  }
}

module.exports = {
  PRUNE_MARGIN,
  applyMarkOps,
  buildImportLockName,
  ensureImported,
  importProfile,
  marksOfProfile,
  mirrorSyncOps,
  pruneProgressKeys,
  touchesMarks,
};
