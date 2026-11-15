'use strict';

const https = require('https');

// Bug de Node (vu en 24 et 25) : quand le serveur coupe pendant la négociation
// TLS alors que la requête HTTP a déjà écrit ses en-têtes, l'écriture en
// attente (WriteWrap) n'est jamais libérée. Elle retient le TLSSocket, l'objet
// OpenSSL et un tampon de 64 Ko : ~140 Ko natifs et ~9 Ko de tas par échec,
// pour toujours. Un seul site mort appelé en boucle faisait ainsi grimper
// chaque worker de plusieurs centaines de Mo par heure.
//
// Parade : l'agent ne remet la socket à la requête qu'après « secureConnect ».
// Rien n'est écrit avant, donc rien ne reste bloqué si la connexion échoue.
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10000;
const GUARDED = Symbol('movix.tlsHandshakeGuard');

function installTlsHandshakeGuard({ Agent = https.Agent, handshakeTimeoutMs = DEFAULT_HANDSHAKE_TIMEOUT_MS } = {}) {
  const proto = Agent.prototype;
  if (proto[GUARDED]) return false;
  const createConnection = proto.createConnection;

  proto.createConnection = function guardedCreateConnection(options, callback) {
    // Sans rappel (appel direct hors http.Agent), garder le comportement de Node.
    if (typeof callback !== 'function') return createConnection.call(this, options);
    const socket = createConnection.call(this, options);
    if (!socket || typeof socket.once !== 'function') return socket;

    let settled = false;
    const settle = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeListener('secureConnect', onSecure);
      socket.removeListener('error', settle);
      socket.removeListener('close', onClose);
      callback(error || null, error ? undefined : socket);
    };
    const onSecure = () => settle(null);
    // Une fermeture sans erreur laisserait sinon la requête sans socket ni délai.
    const onClose = () => {
      const error = new Error('Client network socket closed before secure TLS connection was established');
      error.code = 'ECONNRESET';
      settle(error);
    };
    // Le délai de la requête (req.setTimeout) ne s'arme qu'une fois la socket
    // remise : la négociation a donc le sien.
    const timer = setTimeout(() => {
      const error = new Error(`TLS handshake timed out after ${handshakeTimeoutMs} ms`);
      error.code = 'ETIMEDOUT';
      socket.destroy(error);
    }, handshakeTimeoutMs);
    timer.unref?.();
    socket.once('secureConnect', onSecure);
    socket.once('error', settle);
    socket.once('close', onClose);
    return undefined;
  };
  Object.defineProperty(proto, GUARDED, { value: true });
  return true;
}

module.exports = { installTlsHandshakeGuard, DEFAULT_HANDSHAKE_TIMEOUT_MS };
