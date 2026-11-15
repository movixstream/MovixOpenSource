'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const writeFileAtomic = require('write-file-atomic');

const SUCCESS_REFRESH_MS = 3 * 60 * 60 * 1000;
const NEGATIVE_REFRESH_MS = 5 * 60 * 1000;
const RETRY_MS = 60 * 1000;

// Le sidecar est partagé sur le même volume que les caches des six workers.
// Il ne change ni les liens conservés, ni leur date de dernière publication.
function createWiflixRefreshState({ now = Date.now, successRefreshMs = SUCCESS_REFRESH_MS,
  negativeRefreshMs = NEGATIVE_REFRESH_MS, isNegative = data => data?.success === false } = {}) {
  const retryPath = (dir, key) => path.join(dir, `${key}.retry`);
  async function mtime(file) {
    try { return (await fs.stat(file)).mtimeMs; }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  return {
    async remaining(dir, key, cachedData) {
      const publishedAt = cachedData ? await mtime(path.join(dir, `${key}.json`)) : null;
      const freshness = isNegative(cachedData) ? negativeRefreshMs : successRefreshMs;
      const freshFor = publishedAt === null ? 0 : publishedAt + freshness - now();
      if (freshFor > 0) return freshFor; // Aucun accès supplémentaire pour les caches frais.
      const attemptedAt = await mtime(retryPath(dir, key));
      return Math.max(0, attemptedAt === null ? 0 : attemptedAt + RETRY_MS - now());
    },
    async defer(dir, key) {
      await fs.mkdir(dir, { recursive: true });
      await writeFileAtomic(retryPath(dir, key), '', { fsync: false });
    },
    async clear(dir, key) {
      try { await fs.unlink(retryPath(dir, key)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    },
  };
}

module.exports = { createWiflixRefreshState, RETRY_MS };
