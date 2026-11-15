'use strict';
// agent-base (agents des proxys HTTP, HTTPS et SOCKS) devine http ou https en
// lisant `new Error().stack` : Node lit `agent.protocol` et `agent.defaultPort`
// à chaque requête, soit deux piles formatées par appel sortant. Sur le
// serveur, ts-node installe source-map-support, qui repasse chaque ligne de pile
// par sa table de correspondance (profil du 2026-10-19 : isSecureEndpoint et
// source-map-support parmi les fonctions les plus échantillonnées).
// Même réponse, sans formatage : les appelants bruts de la pile, bornés.
const { Agent } = require('agent-base');

const STACK_DEPTH = 12;
const rawCallSites = (_error, callSites) => callSites;

function isHttpsFile(fileName) {
  return typeof fileName === 'string'
    && (fileName === 'node:https' || fileName === 'https.js' || fileName.endsWith('/https.js'));
}

function calledFromHttpsModule() {
  const { stackTraceLimit, prepareStackTrace } = Error;
  Error.stackTraceLimit = STACK_DEPTH;
  Error.prepareStackTrace = rawCallSites;
  try {
    const callSites = new Error().stack;
    return Array.isArray(callSites) && callSites.some((site) => isHttpsFile(site?.getFileName?.()));
  } finally {
    Error.stackTraceLimit = stackTraceLimit;
    Error.prepareStackTrace = prepareStackTrace;
  }
}

function isSecureEndpoint(options) {
  if (options) {
    if (typeof options.secureEndpoint === 'boolean') return options.secureEndpoint;
    if (typeof options.protocol === 'string') return options.protocol === 'https:';
  }
  return calledFromHttpsModule();
}

// Une version d'agent-base sans cette méthode garde son comportement d'origine.
if (Agent && typeof Agent.prototype.isSecureEndpoint === 'function') {
  Agent.prototype.isSecureEndpoint = isSecureEndpoint;
}

module.exports = { isSecureEndpoint, calledFromHttpsModule };
