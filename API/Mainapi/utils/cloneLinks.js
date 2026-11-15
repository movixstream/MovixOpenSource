const axios = require('axios');
const { getPool } = require('../mysqlPool');

const UQLOAD_BASE_URL = 'https://uqload.is';
const DEFAULT_PENDING_RECHECK_MS = 60 * 1000;
const DEFAULT_FAILED_RETRY_MS = 30 * 60 * 1000;
const CLONE_LINKS_TABLE = 'clone_links';
const LEGACY_CLONE_LINKS_TABLE = 'coflix_clone_links';

let ensureCloneLinksStoragePromise = null;
const ongoingCloneSyncs = new Map();

function getConfiguredUqloadBaseUrl() {
  return UQLOAD_BASE_URL.replace(/\/+$/, '');
}

function getUqloadApiKey() {
  return String(process.env.UQLOAD_API_KEY || '').trim();
}

function getUqloadApiBaseUrl() {
  return `${getConfiguredUqloadBaseUrl()}/api`;
}

function getPendingRecheckMs() {
  const parsed = parseInt(process.env.CLONE_LINKS_PENDING_RECHECK_MS || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PENDING_RECHECK_MS;
}

function getFailedRetryMs(lastError = '') {
  if (/^(?:source_unavailable:|no file$)/i.test(lastError)) {
    const delay = Number(process.env.CLONE_LINKS_MISSING_RETRY_MS);
    return Number.isFinite(delay) && delay > 0 ? delay : 24 * 60 * 60 * 1000;
  }
  const parsed = parseInt(process.env.CLONE_LINKS_FAILED_RETRY_MS || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_FAILED_RETRY_MS;
}

function normalizeScope({ mediaType, tmdbId, seasonNumber = 0, episodeNumber = 0 }) {
  return {
    mediaType: mediaType === 'tv' ? 'tv' : 'movie',
    tmdbId: Number(tmdbId) || 0,
    seasonNumber: mediaType === 'tv' ? Number(seasonNumber) || 0 : 0,
    episodeNumber: mediaType === 'tv' ? Number(episodeNumber) || 0 : 0
  };
}

function getSyncKey(scope, sourceFileCode) {
  return [
    scope.mediaType,
    scope.tmdbId,
    scope.seasonNumber,
    scope.episodeNumber,
    sourceFileCode
  ].join(':');
}

function runWithSyncDedup(syncKey, task) {
  if (ongoingCloneSyncs.has(syncKey)) {
    return ongoingCloneSyncs.get(syncKey);
  }

  const promise = (async () => {
    try {
      return await task();
    } finally {
      ongoingCloneSyncs.delete(syncKey);
    }
  })();

  ongoingCloneSyncs.set(syncKey, promise);
  return promise;
}

function shouldRecheck(lastCheckedAt, intervalMs) {
  if (!lastCheckedAt) return true;

  const parsedDate = new Date(lastCheckedAt);
  if (Number.isNaN(parsedDate.getTime())) return true;

  return Date.now() - parsedDate.getTime() >= intervalMs;
}

function sanitizeError(error) {
  if (!error) return 'Erreur inconnue';
  if (typeof error === 'string') return error.slice(0, 1000);
  if (error.response?.data?.msg) return String(error.response.data.msg).slice(0, 1000);
  if (error.message) return String(error.message).slice(0, 1000);
  try {
    return JSON.stringify(error).slice(0, 1000);
  } catch {
    return 'Erreur inconnue';
  }
}

function buildUqloadEmbedUrl(fileCode) {
  if (!fileCode) return null;
  return `${getConfiguredUqloadBaseUrl()}/embed-${fileCode}.html`;
}

function isUqloadUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return false;

  const lowerUrl = rawUrl.toLowerCase();
  if (lowerUrl.includes('uqload')) {
    return true;
  }

  try {
    const configuredHost = new URL(getConfiguredUqloadBaseUrl()).hostname.toLowerCase();
    const parsedHost = new URL(rawUrl).hostname.toLowerCase();
    return parsedHost === configuredHost;
  } catch {
    return false;
  }
}

function extractUqloadFileCode(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;

  const candidates = [rawUrl];
  try {
    candidates.push(decodeURIComponent(rawUrl));
  } catch {
    // Ignore malformed encoded URLs.
  }

  const patterns = [
    /embed-([a-z0-9]+)\.html/i,
    /\/e\/([a-z0-9]+)/i,
    /\/f\/([a-z0-9]+)/i,
    /\/([a-z0-9]{8,})(?:\.html)?(?:[?#].*)?$/i
  ];

  for (const candidate of candidates) {
    if (!isUqloadUrl(candidate)) {
      continue;
    }

    for (const pattern of patterns) {
      const match = candidate.match(pattern);
      if (match?.[1]) {
        return match[1];
      }
    }
  }

  return null;
}

function getPreferredCloneUrl(playerLink) {
  if (!playerLink || typeof playerLink !== 'object') return '';
  if (typeof playerLink.clone_url === 'string' && playerLink.clone_url.trim()) return playerLink.clone_url.trim();
  if (typeof playerLink.decoded_url === 'string' && playerLink.decoded_url.trim()) return playerLink.decoded_url.trim();
  if (typeof playerLink.iframe_src === 'string' && playerLink.iframe_src.trim()) return playerLink.iframe_src.trim();
  if (typeof playerLink.url === 'string' && playerLink.url.trim()) return playerLink.url.trim();
  return '';
}

async function ensureCloneLinksStorage() {
  if (ensureCloneLinksStoragePromise) {
    return ensureCloneLinksStoragePromise;
  }

  ensureCloneLinksStoragePromise = (async () => {
    const pool = getPool();
    if (!pool) {
      throw new Error('MySQL pool not ready for clone links');
    }

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS ${CLONE_LINKS_TABLE} (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        provider ENUM('uqload') NOT NULL,
        media_type ENUM('movie', 'tv') NOT NULL,
        tmdb_id INT NOT NULL,
        season_number INT NOT NULL DEFAULT 0,
        episode_number INT NOT NULL DEFAULT 0,
        source_file_code VARCHAR(64) NOT NULL,
        clone_file_code VARCHAR(64) DEFAULT NULL,
        clone_embed_url VARCHAR(2048) DEFAULT NULL,
        status ENUM('pending', 'ready', 'failed') NOT NULL DEFAULT 'pending',
        last_error TEXT DEFAULT NULL,
        last_checked_at DATETIME DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_clone_scope (provider, media_type, tmdb_id, season_number, episode_number, source_file_code),
        KEY idx_clone_lookup (media_type, tmdb_id, season_number, episode_number),
        KEY idx_clone_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const [legacyTables] = await pool.query(`SHOW TABLES LIKE ?`, [LEGACY_CLONE_LINKS_TABLE]);
    if (Array.isArray(legacyTables) && legacyTables.length > 0) {
      await pool.query(`
        INSERT IGNORE INTO ${CLONE_LINKS_TABLE} (
          id,
          provider,
          media_type,
          tmdb_id,
          season_number,
          episode_number,
          source_file_code,
          clone_file_code,
          clone_embed_url,
          status,
          last_error,
          last_checked_at,
          created_at,
          updated_at
        )
        SELECT
          id,
          provider,
          media_type,
          tmdb_id,
          season_number,
          episode_number,
          source_file_code,
          clone_file_code,
          clone_embed_url,
          status,
          last_error,
          last_checked_at,
          created_at,
          updated_at
        FROM ${LEGACY_CLONE_LINKS_TABLE}
      `);
    }
  })().catch((error) => {
    ensureCloneLinksStoragePromise = null;
    throw error;
  });

  return ensureCloneLinksStoragePromise;
}

async function getCloneRow(scope, sourceFileCode) {
  await ensureCloneLinksStorage();
  const pool = getPool();
  const [rows] = await pool.execute(
    `SELECT id, provider, media_type, tmdb_id, season_number, episode_number, source_file_code,
            clone_file_code, clone_embed_url, status, last_error, last_checked_at, created_at, updated_at
     FROM ${CLONE_LINKS_TABLE}
     WHERE provider = 'uqload'
       AND media_type = ?
       AND tmdb_id = ?
       AND season_number = ?
       AND episode_number = ?
       AND source_file_code = ?
     LIMIT 1`,
    [scope.mediaType, scope.tmdbId, scope.seasonNumber, scope.episodeNumber, sourceFileCode]
  );

  return rows[0] || null;
}

async function getReadyCloneRows(scope, sourceFileCodes) {
  await ensureCloneLinksStorage();
  const uniqueCodes = [...new Set(sourceFileCodes.filter(Boolean))];
  if (uniqueCodes.length === 0) {
    return [];
  }

  const pool = getPool();
  const placeholders = uniqueCodes.map(() => '?').join(', ');
  const [rows] = await pool.execute(
    `SELECT source_file_code, clone_file_code, clone_embed_url, status
     FROM ${CLONE_LINKS_TABLE}
     WHERE provider = 'uqload'
       AND media_type = ?
       AND tmdb_id = ?
       AND season_number = ?
       AND episode_number = ?
       AND status = 'ready'
       AND source_file_code IN (${placeholders})`,
    [scope.mediaType, scope.tmdbId, scope.seasonNumber, scope.episodeNumber, ...uniqueCodes]
  );

  return rows;
}

async function persistCloneRow(scope, payload) {
  await ensureCloneLinksStorage();
  const pool = getPool();
  const lastCheckedAt = payload.lastCheckedAt || new Date();

  await pool.execute(
    `INSERT INTO ${CLONE_LINKS_TABLE} (
      provider,
      media_type,
      tmdb_id,
      season_number,
      episode_number,
      source_file_code,
      clone_file_code,
      clone_embed_url,
      status,
      last_error,
      last_checked_at
    ) VALUES ('uqload', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      clone_file_code = IFNULL(VALUES(clone_file_code), clone_file_code),
      clone_embed_url = IFNULL(VALUES(clone_embed_url), clone_embed_url),
      status = VALUES(status),
      last_error = VALUES(last_error),
      last_checked_at = VALUES(last_checked_at),
      updated_at = CURRENT_TIMESTAMP`,
    [
      scope.mediaType,
      scope.tmdbId,
      scope.seasonNumber,
      scope.episodeNumber,
      payload.sourceFileCode,
      payload.cloneFileCode || null,
      payload.cloneEmbedUrl || null,
      payload.status || 'pending',
      payload.lastError || null,
      lastCheckedAt
    ]
  );

  return getCloneRow(scope, payload.sourceFileCode);
}

async function callUqloadApi(endpoint, params = {}) {
  const apiKey = getUqloadApiKey();
  if (!apiKey) {
    throw new Error('UQLOAD_API_KEY manquante');
  }
  const response = await axios.get(`${getUqloadApiBaseUrl()}${endpoint}`, {
    params: {
      key: apiKey,
      ...params
    },
    timeout: 15000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
      'Accept': 'application/json'
    },
    validateStatus: () => true
  });

  if (response.status >= 400) {
    throw new Error(`Uqload HTTP ${response.status}`);
  }

  const payload = response.data;
  if (!payload || Number(payload.status) !== 200) {
    throw new Error(payload?.msg || 'Erreur API Uqload');
  }

  return payload.result;
}

function extractReturnedFileCode(result) {
  if (!result) return null;
  if (typeof result === 'string' && result.trim()) return result.trim();
  if (Array.isArray(result)) {
    for (const item of result) {
      const nestedCode = extractReturnedFileCode(item);
      if (nestedCode) return nestedCode;
    }
    return null;
  }

  return result.filecode || result.file_code || result.code || result.clone_file_code || null;
}

async function cloneFileByCode(sourceFileCode) {
  const result = await callUqloadApi('/file/clone', { file_code: sourceFileCode });
  const cloneFileCode = extractReturnedFileCode(result);

  if (!cloneFileCode) {
    throw new Error('Aucun filecode renvoye par file/clone');
  }

  return cloneFileCode;
}

async function fetchCloneFileInfo(fileCode) {
  const result = await callUqloadApi('/file/info', { file_code: fileCode });
  const fileInfo = Array.isArray(result) ? result[0] : null;

  if (!fileInfo) {
    return null;
  }

  return {
    fileCode: fileInfo.file_code || fileCode,
    canPlay: Number(fileInfo.canplay) === 1
  };
}

async function syncSingleUqloadClone(scope, playerLink) {
  const sourceFileCode = extractUqloadFileCode(playerLink?.decoded_url);
  if (!sourceFileCode) {
    return null;
  }

  const syncKey = getSyncKey(scope, sourceFileCode);
  return runWithSyncDedup(syncKey, async () => {
    let existingRow = await getCloneRow(scope, sourceFileCode);

    if (existingRow?.status === 'ready' && (existingRow.clone_embed_url || existingRow.clone_file_code)) {
      return existingRow;
    }

    const canCheckPending = existingRow?.clone_file_code &&
      existingRow.status === 'pending' &&
      shouldRecheck(existingRow.last_checked_at, getPendingRecheckMs());

    const canRetryFailed = existingRow?.status === 'failed' &&
      shouldRecheck(existingRow.last_checked_at, getFailedRetryMs(existingRow.last_error));

    if (canCheckPending || (existingRow?.status === 'ready' && existingRow.clone_file_code)) {
      try {
        const fileInfo = await fetchCloneFileInfo(existingRow.clone_file_code);
        if (fileInfo?.canPlay) {
          return await persistCloneRow(scope, {
            sourceFileCode,
            cloneFileCode: fileInfo.fileCode,
            cloneEmbedUrl: buildUqloadEmbedUrl(fileInfo.fileCode),
            status: 'ready',
            lastError: null,
            lastCheckedAt: new Date()
          });
        }

        return await persistCloneRow(scope, {
          sourceFileCode,
          cloneFileCode: existingRow.clone_file_code,
          cloneEmbedUrl: existingRow.clone_embed_url || buildUqloadEmbedUrl(existingRow.clone_file_code),
          status: 'pending',
          lastError: null,
          lastCheckedAt: new Date()
        });
      } catch (error) {
        console.warn(`[CLONE LINKS] File info check failed for ${sourceFileCode}: ${sanitizeError(error)}`);
        return existingRow;
      }
    }

    if (existingRow?.status === 'pending' && existingRow.clone_file_code && !canCheckPending) {
      return existingRow;
    }

    if (existingRow?.status === 'failed' && !canRetryFailed) {
      return existingRow;
    }

    try {
      const cloneFileCode = await cloneFileByCode(sourceFileCode);
      existingRow = await persistCloneRow(scope, {
        sourceFileCode,
        cloneFileCode,
        cloneEmbedUrl: buildUqloadEmbedUrl(cloneFileCode),
        status: 'pending',
        lastError: null,
        lastCheckedAt: new Date()
      });

      try {
        const fileInfo = await fetchCloneFileInfo(cloneFileCode);
        if (fileInfo?.canPlay) {
          return await persistCloneRow(scope, {
            sourceFileCode,
            cloneFileCode: fileInfo.fileCode,
            cloneEmbedUrl: buildUqloadEmbedUrl(fileInfo.fileCode),
            status: 'ready',
            lastError: null,
            lastCheckedAt: new Date()
          });
        }
      } catch (error) {
        console.warn(`[CLONE LINKS] Immediate file info check failed for ${sourceFileCode}: ${sanitizeError(error)}`);
      }

      return existingRow;
    } catch (error) {
      const unavailable = /^no file$/i.test(String(error.message || '').trim());
      const lastError = unavailable ? `source_unavailable: ${sanitizeError(error)}` : sanitizeError(error);
      console[unavailable ? 'warn' : 'error'](`[CLONE LINKS] ${unavailable ? 'Fichier source indisponible, reprise différée' : 'Échec clonage'} ${sourceFileCode}: ${sanitizeError(error)}`);
      return await persistCloneRow(scope, {
        sourceFileCode,
        cloneFileCode: existingRow?.clone_file_code || null,
        cloneEmbedUrl: existingRow?.clone_embed_url || null,
        status: 'failed',
        lastError,
        lastCheckedAt: new Date()
      });
    }
  });
}

async function applyCloneUrlsToPlayerLinks({ mediaType, tmdbId, seasonNumber = 0, episodeNumber = 0, playerLinks }) {
  try {
    if (!Array.isArray(playerLinks) || playerLinks.length === 0) {
      return Array.isArray(playerLinks) ? playerLinks : [];
    }

    const scope = normalizeScope({ mediaType, tmdbId, seasonNumber, episodeNumber });
    const sourceCodes = playerLinks
      .map((playerLink) => extractUqloadFileCode(playerLink?.decoded_url))
      .filter(Boolean);

    if (sourceCodes.length === 0) {
      return playerLinks;
    }

    const readyRows = await getReadyCloneRows(scope, sourceCodes);
    const readyMap = new Map(
      readyRows.map((row) => [
        row.source_file_code,
        row.clone_embed_url || buildUqloadEmbedUrl(row.clone_file_code)
      ])
    );

    return playerLinks.map((playerLink) => {
      const sourceFileCode = extractUqloadFileCode(playerLink?.decoded_url);
      if (!sourceFileCode) {
        return playerLink;
      }

      const cloneUrl = readyMap.get(sourceFileCode);
      if (!cloneUrl) {
        return playerLink;
      }

      return {
        ...playerLink,
        clone_url: cloneUrl
      };
    });
  } catch (error) {
    console.error(`[CLONE LINKS] applyCloneUrlsToPlayerLinks failed: ${sanitizeError(error)}`);
    return Array.isArray(playerLinks) ? playerLinks : [];
  }
}

async function syncCloneLinksForPlayerLinks({ mediaType, tmdbId, seasonNumber = 0, episodeNumber = 0, playerLinks }) {
  try {
    if (!Array.isArray(playerLinks) || playerLinks.length === 0) {
      return Array.isArray(playerLinks) ? playerLinks : [];
    }

    const scope = normalizeScope({ mediaType, tmdbId, seasonNumber, episodeNumber });
    for (const playerLink of playerLinks) {
      if (!extractUqloadFileCode(playerLink?.decoded_url)) {
        continue;
      }

      await syncSingleUqloadClone(scope, playerLink);
    }

    return applyCloneUrlsToPlayerLinks({ mediaType, tmdbId, seasonNumber, episodeNumber, playerLinks });
  } catch (error) {
    console.error(`[CLONE LINKS] syncCloneLinksForPlayerLinks failed: ${sanitizeError(error)}`);
    return Array.isArray(playerLinks) ? playerLinks : [];
  }
}

module.exports = {
  ensureCloneLinksStorage,
  getConfiguredUqloadBaseUrl,
  buildUqloadEmbedUrl,
  extractUqloadFileCode,
  getPreferredCloneUrl,
  applyCloneUrlsToPlayerLinks,
  syncCloneLinksForPlayerLinks
};
