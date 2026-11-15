'use strict';
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const writeFileAtomic = require('write-file-atomic');

const SUCCESS_REFRESH_MS = 3 * 60 * 60 * 1000;
// Introuvable confirmé, jamais une panne : réexaminé toutes les 30 minutes.
const NEGATIVE_REFRESH_MS = 30 * 60 * 1000;
// Reprise après échec, par clé : 1, 2, 4, 8 puis 15 minutes au plus.
const RETRY_MS = 60 * 1000;
const MAX_RETRY_MS = 15 * 60 * 1000;
// Écart fixe de ±10 % par clé : des caches écrits ensemble n'expirent pas ensemble.
const FRESHNESS_JITTER = 0.1;

function keySpread(key, jitter) {
  if (!jitter) return 1;
  const unit = createHash('sha1').update(String(key)).digest().readUInt32BE(0) / 2 ** 32;
  return 1 + jitter * (2 * unit - 1);
}

// Le sidecar est partagé sur le même volume que les caches des six workers.
// Il ne change ni les liens conservés, ni leur date de dernière publication.
// `freshnessMs(data, now)` fixe la durée propre à un cache (Wiflix : selon
// l'âge de la sortie) ; par défaut, celle d'un succès ou d'un introuvable.
function createWiflixRefreshState({ now = Date.now, successRefreshMs = SUCCESS_REFRESH_MS,
  negativeRefreshMs = NEGATIVE_REFRESH_MS, isNegative = data => data?.success === false,
  freshnessMs = data => (isNegative(data) ? negativeRefreshMs : successRefreshMs),
  retryMs = RETRY_MS, maxRetryMs = MAX_RETRY_MS, jitter = FRESHNESS_JITTER } = {}) {
  const retryPath = (dir, key) => path.join(dir, `${key}.retry`);
  const retryDelay = attempts => Math.min(retryMs * 2 ** (attempts - 1), Math.max(retryMs, maxRetryMs));
  async function mtime(file) {
    try { return (await fs.stat(file)).mtimeMs; }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  // Le .retry garde le nombre d'échecs consécutifs et la date du dernier.
  // Un ancien fichier vide compte pour un échec à sa date de modification.
  async function lastRetry(dir, key) {
    const file = retryPath(dir, key);
    let content;
    try { content = await fs.readFile(file, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    try {
      const { attempts, at } = JSON.parse(content);
      if (Number.isInteger(attempts) && attempts > 0 && Number.isFinite(at)) return { attempts, at };
    } catch { /* Ancien format : fichier vide. */ }
    const at = await mtime(file);
    return at === null ? null : { attempts: 1, at };
  }
  return {
    async remaining(dir, key, cachedData) {
      const publishedAt = cachedData ? await mtime(path.join(dir, `${key}.json`)) : null;
      const freshness = freshnessMs(cachedData, now()) * keySpread(key, jitter);
      const freshFor = publishedAt === null ? 0 : publishedAt + freshness - now();
      if (freshFor > 0) return freshFor; // Aucun accès supplémentaire pour les caches frais.
      const retry = await lastRetry(dir, key);
      return Math.max(0, retry === null ? 0 : retry.at + retryDelay(retry.attempts) - now());
    },
    // Wiflix l'appelle sous son verrou d'actualisation. Sans verrou (purstream),
    // deux échecs simultanés comptent au pire pour un seul.
    async defer(dir, key) {
      await fs.mkdir(dir, { recursive: true });
      const previous = await lastRetry(dir, key).catch(() => null);
      const at = now();
      // Échecs rapprochés : délai doublé. Après une longue accalmie, retour à 60 s.
      const attempts = previous && at - previous.at < retryDelay(previous.attempts) + maxRetryMs
        ? previous.attempts + 1 : 1;
      await writeFileAtomic(retryPath(dir, key), JSON.stringify({ attempts, at }), { fsync: false });
    },
    async clear(dir, key) {
      try { await fs.unlink(retryPath(dir, key)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    },
  };
}

module.exports = { createWiflixRefreshState, RETRY_MS };
