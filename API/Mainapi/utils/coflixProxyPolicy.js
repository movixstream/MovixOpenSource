'use strict';

/** Quarantaine courte par proxy, sans conserver les erreurs Axios ni leur HTML. */
function createCoflixProxyPolicy({ now = Date.now, cooldownMs = 30000, maxEntries = 256 } = {}) {
  const failures = new Map();
  const keyFor = (proxy, socks) => `${socks ? 'socks' : 'http'}://${proxy.host}:${proxy.port}`;
  const isAvailable = (proxy, socks) => {
    const key = keyFor(proxy, socks);
    if ((failures.get(key)?.until || 0) > now()) return false;
    failures.delete(key);
    return true;
  };
  return {
    isAvailable,
    healthy(proxy, socks) { failures.delete(keyFor(proxy, socks)); },
    failed(proxy, socks, error) {
      const status = error?.response?.status;
      if (status && ![403, 407, 408, 425, 429].includes(status) && !(status >= 500 && status < 600)) return;
      const key = keyFor(proxy, socks);
      failures.delete(key);
      failures.set(key, { until: now() + cooldownMs, code: status || String(error?.code || 'transport-error').slice(0, 64) });
      while (failures.size > maxEntries) failures.delete(failures.keys().next().value);
    },
  };
}

module.exports = { createCoflixProxyPolicy };
