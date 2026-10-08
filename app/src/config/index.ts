export const CONFIG = {
  SITE_URL: 'https://movix.luxe',
  DNS_PRIMARY: '1.1.1.1',
  DNS_SECONDARY: '1.0.0.1',
  DNS_DOH_URL: 'https://cloudflare-dns.com/dns-query',
  APP_NAME: 'Movix',
  USER_AGENT:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
};

export const UPDATE_CHECK = {
  RENTRY_URL: 'https://rentry.co/movix',
  MANIFEST_PATH: '/app/version.json',
  GITHUB_VERSION_RAW_PATH: '/raw/refs/heads/main/app/version.json',
  TIMEOUT_MS: 5000,
  PENDING_DOWNLOAD_KEY: 'update:pendingDownload',
};

// Repli quand rentry ou address.json sont injoignables (souvent le cas derrière
// un VPN, dont l'IP reçoit un défi Cloudflare). À garder aligné sur la liste
// « active » de address.json.
export const FALLBACK_CONFIG = {
  RESOLVER_HOSTS: ['movix.online'],
  PRIMARY_URL: 'https://movix.luxe',
  MIRRORS: [
    'https://movix.college',
    'https://movix.men',
    'https://movix.fun',
    'https://movix.show',
    'https://movix.date',
    'https://movix.chat',
    'https://movix.golf',
    'https://movix.cloud',
    'https://movix.cash',
  ],
  CACHE_KEY: 'address:lastConfig',
  GITHUB_URL: 'https://github.com/movixstream/MovixOpenSource',
  TELEGRAM_URL: 'https://t.me/ix_annonces',
};
