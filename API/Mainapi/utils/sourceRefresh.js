const { createSingleFlight } = require('./singleFlight');
const { compactRefreshError } = require('./refreshError');

// Métadonnées uniquement : ne conserve ni catalogue ni réponse propre à un user.
function createSourceRefresh({ retryMs = 60000, maxEntries = 2000 } = {}) {
  const flight = createSingleFlight();
  const checks = new Map();
  const failures = new Map();
  const remember = (map, key, value) => {
    map.delete(key);
    map.set(key, value);
    if (map.size > maxEntries) map.delete(map.keys().next().value);
  };
  const getFailure = (key) => {
    const failure = failures.get(key);
    if (failure && Date.now() < failure.retryAt) return failure.error;
    failures.delete(key);
    return null;
  };
  return {
    getFailure,
    recentlyChecked(key, intervalMs) {
      const checkedAt = checks.get(key);
      return checkedAt !== undefined && Date.now() - checkedAt < intervalMs;
    },
    markChecked(key) { remember(checks, key, Date.now()); },
    forget(key) { checks.delete(key); failures.delete(key); },
    run(key, task) {
      return flight(key, async () => {
        const failure = getFailure(key);
        if (failure) throw failure;
        try {
          return await task();
        } catch (error) {
          remember(failures, key, { retryAt: Date.now() + retryMs, error: compactRefreshError(error) });
          throw error;
        }
      });
    },
  };
}

function waitForSource(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); }),
  ]).finally(() => clearTimeout(timer));
}

module.exports = { createSourceRefresh, waitForSource };
