'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const { createHash } = require('node:crypto');
const axios = require('axios');
const { isValidDiscordWebhookUrl } = require('./wiflixProxyTelemetry');

const context = new AsyncLocalStorage();
const cooldowns = new Map();
const notifications = [];
const webhookUrl = (process.env.WIFLIX_PROXY_BLOCK_WEBHOOK_URL || '').trim();
const diagnosticsEnabled = process.env.SOURCE_REFRESH_WEBHOOK_ENABLED !== 'false';
const webhookEnabled = diagnosticsEnabled && isValidDiscordWebhookUrl(webhookUrl);
const configuredCooldown = Number(process.env.SOURCE_REFRESH_WEBHOOK_COOLDOWN_MS);
const cooldownMs = Number.isFinite(configuredCooldown) && configuredCooldown > 0
  ? configuredCooldown : 10 * 60 * 1000;
let sending = false;

function safeUrl(value) {
  try {
    const url = new URL(value);
    const pathname = url.pathname.replace(/(\/webhooks\/[^/]+\/)[^/]+/i, '$1[masqué]');
    return `${url.protocol}//${url.host}${pathname}`;
  } catch { return '[URL masquée]'; }
}

function safeText(value, limit = 300) {
  return String(value ?? '')
    .replace(/(?:https?|socks5h?):\/\/[^\s<>"']+/gi, safeUrl)
    .replace(/\b(?:authorization|cookie|api[_-]?key|access[_-]?key|token|password|secret)\s*[:=]\s*\S+/gi, '[secret masqué]')
    .replace(/[\r\n\t`]/g, ' ')
    .slice(0, limit);
}

function safeDetails(details) {
  // Ne jamais sérialiser une erreur axios, une requête, ses headers ou son corps.
  return Object.fromEntries(Object.entries(details).flatMap(([key, value]) => {
    if (/authorization|cookie|password|secret|token|api[_-]?key|access[_-]?key|headers/i.test(key)) return [];
    if (value == null) return [];
    if (Array.isArray(value)) return [[key, value.slice(0, 200).map(item => safeText(item, 80))],
      [`${key}Count`, value.length]];
    if (typeof value === 'object') return [];
    return [[key, typeof value === 'string' ? safeText(value) : value]];
  }));
}

function refreshStep(stage, details = {}, error = null) {
  const active = context.getStore();
  if (!active) return;
  const values = safeDetails(details);
  if (stage === 'cache' || stage === 'tmdb_result') Object.assign(active.details, values);
  active.steps.push({
    stage, elapsedMs: Date.now() - active.startedAt, ...values,
    ...(error ? {
      error: safeText(error.message), code: safeText(error.code, 60),
      httpStatus: Number(error.response?.status) || undefined,
    } : {}),
  });
  if (active.steps.length > 24) active.steps.shift();
}

async function notifyFailure(report, redis) {
  const now = Date.now();
  if (!webhookEnabled) return;
  const key = createHash('sha256').update(JSON.stringify([
    report.source, report.type, report.id, report.season,
    report.reason === 'requested_episode_missing' ? report.episode : null,
    report.reason, report.code, report.httpStatus, report.steps.at(-1)?.stage,
  ])).digest('hex');
  if (now < (cooldowns.get(key) || 0)) return;
  if (notifications.length >= 100) {
    console.warn('[SOURCE REFRESH WEBHOOK] File pleine ; diagnostic conservé dans les logs serveur');
    return;
  }
  cooldowns.delete(key);
  cooldowns.set(key, now + cooldownMs);
  while (cooldowns.size > 500) cooldowns.delete(cooldowns.keys().next().value);
  notifications.push({ report, redis, key });
  if (sending) return;
  sending = true;
  try {
    while (notifications.length) {
      const next = notifications.shift();
      await sendFailure(next.report, next.redis, next.key);
      if (notifications.length) await new Promise(resolve => {
        const timer = setTimeout(resolve, 1000);
        timer.unref?.();
      });
    }
  } finally { sending = false; }
}

async function sendFailure(report, redis, key) {
  try {
    // Dédupliquer entre workers sans laisser Redis bloquer les notifications.
    if (redis && (!redis.status || redis.status === 'ready')) {
      let timer;
      try {
        const acquired = await Promise.race([
          Promise.resolve().then(() => redis.set(`source:refresh-alert:${key}`, '1', 'PX', cooldownMs, 'NX')).catch(() => undefined),
          new Promise(resolve => { timer = setTimeout(resolve, 100); }),
        ]);
        if (acquired === null) return;
      } finally { clearTimeout(timer); }
    }
    const { steps, ...summary } = report;
    const formatValue = value => Array.isArray(value) ? value.join(', ') : String(value);
    const contextLines = Object.entries(summary).map(([name, value]) => `${name} : ${formatValue(value)}`);
    const fitLines = lines => {
      const selected = [];
      for (const line of lines) {
        const bounded = line.length > 350 ? `${line.slice(0, 347)}…` : line;
        if (selected.join('\n').length + bounded.length + 1 > 1000) break;
        selected.push(bounded);
      }
      return selected.join('\n');
    };
    const stepLines = steps.slice().reverse().map(({ stage, elapsedMs, ...values }) =>
      `${stage} (${elapsedMs} ms) — ${Object.entries(values).map(([name, value]) => `${name}=${formatValue(value)}`).join(' ; ')}`);
    const unavailable = ['content_not_found', 'requested_episode_missing', 'stream_not_found'].includes(report.reason);
    await axios.post(webhookUrl, {
      username: 'Movix Sources Monitor',
      allowed_mentions: { parse: [] },
      embeds: [{
        title: `${report.source} : ${unavailable ? 'disponibilité du contenu' : 'actualisation à vérifier'}`,
        color: unavailable ? 0x3498db : 0xe67e22,
        timestamp: report.at,
        fields: [
          { name: 'Motif', value: `${report.reason} : ${report.message}`.slice(0, 1000) },
          { name: 'Contexte', value: fitLines(contextLines) || 'Aucun contexte' },
          { name: 'Dernières étapes (plus récente en premier)', value: fitLines(stepLines) || 'Aucune étape' },
        ],
        footer: { text: `Détail complet dans les logs serveur ; même alerte espacée de ${Math.round(cooldownMs / 60000)} min` },
      }],
    }, { timeout: 4000, maxRedirects: 0, proxy: false });
  } catch (error) {
    console.warn(`[SOURCE REFRESH WEBHOOK] Envoi impossible (${Number(error.response?.status) || safeText(error.code, 60) || 'erreur réseau'})`);
  }
}

function reportRefreshFailure(reason, error, details = {}, redis = null) {
  if (!diagnosticsEnabled) return;
  try {
    const active = context.getStore();
    if (active?.reported) return;
    if (active) active.reported = true;
    const report = {
      source: 'FStream', ...active?.details, ...safeDetails(details),
      at: new Date().toISOString(),
      reason, message: safeText(error?.message || error || reason),
      code: safeText(error?.code, 60), httpStatus: Number(error?.response?.status) || undefined,
      elapsedMs: active ? Date.now() - active.startedAt : undefined,
      steps: active?.steps.slice() || [],
    };
    const availability = ['content_not_found', 'requested_episode_missing', 'stream_not_found'].includes(reason);
    const label = reason === 'requested_episode_missing' ? 'Épisode indisponible après actualisation réussie'
      : availability ? 'Contenu indisponible' : 'Échec actualisation';
    console[availability ? 'info' : 'error'](`[${report.source.toUpperCase()} CACHE] ${label} ${report.cacheKey || report.id || ''}: ${report.message} | ${JSON.stringify(report)}`);
    // Une panne Discord ne doit jamais retarder la réponse ni modifier le cache.
    void notifyFailure(report, active?.redis || redis).catch(() => {});
  } catch { /* Le diagnostic reste indépendant de la récupération. */ }
}

async function withRefreshDiagnostics(details, redis, work) {
  if (!diagnosticsEnabled) return work();
  return context.run({ details: safeDetails(details), redis, steps: [], startedAt: Date.now(), reported: false }, async () => {
    try { return await work(); }
    catch (error) {
      reportRefreshFailure('refresh_exception', error);
      throw error;
    }
  });
}

function recordRefreshResult(data) {
  if (!diagnosticsEnabled) return;
  const episode = context.getStore()?.details.episode;
  refreshStep('result', { total: data.total, episodes: Object.keys(data.episodes || {}), extractedAt: data.metadata?.extractedAt });
  if (episode && data.episodes && !Object.values(data.episodes[String(Number(episode))]?.languages || {}).some(players => Array.isArray(players) && players.length)) {
    reportRefreshFailure('requested_episode_missing', 'Actualisation réussie, mais aucun lecteur pour l’épisode demandé', {
      availableEpisodes: Object.keys(data.episodes), total: data.total,
    });
  }
}

module.exports = { withRefreshDiagnostics, refreshStep, reportRefreshFailure, recordRefreshResult };
