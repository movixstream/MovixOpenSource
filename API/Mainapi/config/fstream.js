'use strict';

// Une seule origine pour les routes, la session et les anciennes URLs en cache.
const FSTREAM_BASE_URL = new URL(process.env.FSTREAM_BASE_URL || 'https://french-stream.net').origin;
const legacyHosts = new Set(['french-stream.one', 'www.french-stream.one', 'french-stream.net', 'www.french-stream.net']);

function canonicalFStreamUrl(value) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return value;
  try {
    const url = new URL(value);
    if (!legacyHosts.has(url.hostname) || url.username || url.password) return value;
    return `${FSTREAM_BASE_URL}${url.pathname}${url.search}${url.hash}`;
  } catch { return value; }
}

module.exports = { FSTREAM_BASE_URL, canonicalFStreamUrl };
