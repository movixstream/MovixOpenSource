/**
 * N'accepte les en-têtes d'IP client (cf-connecting-ip, x-forwarded-for,
 * x-real-ip, true-client-ip) que s'ils viennent d'un relais de confiance.
 *
 * Les limites de débit et les bans lisent l'IP dans ces en-têtes. Derrière
 * Cloudflare, c'est sûr : Cloudflare les remplace. Mais si le port du serveur
 * est joignable en direct, n'importe qui pouvait choisir son IP, contourner
 * les limites ou faire bannir l'IP d'un autre. On efface donc ces en-têtes
 * quand la connexion ne vient ni de Cloudflare ni du réseau local (tunnel,
 * Docker, reverse proxy sur la machine).
 *
 * TRUSTED_PROXY_IPS : relais de confiance en plus (IP ou plages CIDR séparées
 * par des virgules). Indispensable quand le reverse proxy de la machine
 * contacte l'API par l'IP publique du serveur : c'est alors cette IP que
 * Node voit pour chaque requête, et sans elle tous les visiteurs perdraient
 * leur IP (donc partageraient les mêmes limites).
 *
 * TRUSTED_PROXY_HEADERS=all désactive le filtre (relais tiers devant l'API).
 */

const net = require('net');

// Plages publiées sur https://www.cloudflare.com/ips/
const CLOUDFLARE_RANGES = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
  '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
];

// Loopback, réseaux privés et lien local : tunnel cloudflared, Docker,
// reverse proxy local.
const LOCAL_RANGES = [
  '127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16',
  '100.64.0.0/10', '::1/128', 'fc00::/7', 'fe80::/10',
];

const CLIENT_IP_HEADERS = ['cf-connecting-ip', 'x-forwarded-for', 'x-real-ip', 'true-client-ip', 'cf-connecting-ipv6'];

function buildBlockList(ranges) {
  const list = new net.BlockList();
  for (const range of ranges) {
    const [address, prefix] = range.split('/');
    const family = net.isIP(address);
    if (!family) {
      console.warn(`[TrustedProxy] Entrée ignorée dans TRUSTED_PROXY_IPS : ${range}`);
      continue;
    }
    const bits = prefix === undefined ? (family === 6 ? 128 : 32) : Number(prefix);
    list.addSubnet(address, bits, family === 6 ? 'ipv6' : 'ipv4');
  }
  return list;
}

function extraTrustedRanges() {
  return String(process.env.TRUSTED_PROXY_IPS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

const TRUSTED = buildBlockList([...CLOUDFLARE_RANGES, ...LOCAL_RANGES, ...extraTrustedRanges()]);

function normalizePeerAddress(address) {
  const value = String(address || '');
  // Adresse IPv4 vue par une socket IPv6 (::ffff:1.2.3.4).
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(value);
  return mapped ? mapped[1] : value;
}

function isTrustedPeer(address) {
  const peer = normalizePeerAddress(address);
  const family = net.isIP(peer);
  if (!family) return false;
  return TRUSTED.check(peer, family === 6 ? 'ipv6' : 'ipv4');
}

let warned = false;

function trustedProxyHeaders(req, res, next) {
  if (String(process.env.TRUSTED_PROXY_HEADERS || '').trim().toLowerCase() === 'all') {
    return next();
  }
  const peer = req.socket?.remoteAddress;
  if (!isTrustedPeer(peer)) {
    let stripped = false;
    for (const header of CLIENT_IP_HEADERS) {
      if (req.headers[header] !== undefined) {
        delete req.headers[header];
        stripped = true;
      }
    }
    if (stripped && !warned) {
      warned = true;
      console.warn(`[TrustedProxy] En-têtes d'IP ignorés pour une connexion directe (${normalizePeerAddress(peer)}). Si c'est un relais légitime, l'ajouter à TRUSTED_PROXY_IPS.`);
    }
  }
  return next();
}

module.exports = { trustedProxyHeaders, isTrustedPeer, CLIENT_IP_HEADERS };
