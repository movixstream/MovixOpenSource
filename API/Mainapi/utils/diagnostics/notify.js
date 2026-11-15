'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const https = require('node:https');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const { createGzip } = require('node:zlib');
const { isValidDiscordWebhookUrl } = require('../wiflixProxyTelemetry');
const { describeThresholdAlert } = require('./alerts');

const DEFAULT_USER_ID = '1516102413835305021';
const MAX_MULTIPART_BYTES = 8 * 1024 * 1024;
const MAX_MARKDOWN_BYTES = 512 * 1024;
const MAX_RAW_JSON_BYTES = 128 * 1024 * 1024;
const RESPONSE_LIMIT = 64 * 1024;
const TIMEOUT_MS = 8_000;

function validUserId(value) { return /^\d{16,22}$/.test(String(value || '')); }
function enabled(env) { return String(env.MAINAPI_PROBE_DISCORD_ENABLED || '').toLowerCase() !== 'false'; }
function reportMessage(reason, alert) {
  if (reason === 'threshold') return `Alerte Main API : ${describeThresholdAlert(alert)}. Rapport intermédiaire joint ; la collecte continue.`;
  // Alerte détectée moins d'une minute avant la fin : pas de rapport à part, elle est dans celui-ci.
  const included = alert ? ` Alerte incluse : ${describeThresholdAlert(alert)}.` : '';
  return reason === 'deadline'
    ? `Sonde Main API terminée. Le rapport est joint.${included}`
    : `Sonde Main API arrêtée (${String(reason || 'inconnue').slice(0, 80)}). Le rapport est joint.${included}`;
}
function checkAbort(signal) { if (signal?.aborted) throw new Error('aborted'); }
async function readFileWithin(file, maxBytes, signal) {
  checkAbort(signal);
  const stat = await fsp.stat(file);
  checkAbort(signal);
  if (!stat.isFile()) throw new Error('not_file');
  if (stat.size > maxBytes) throw new RangeError('file_too_large');
  return fsp.readFile(file, { signal });
}
async function gzipReport(jsonFile, outputFile, maxBytes, { signal } = {}) {
  checkAbort(signal);
  const stat = await fsp.stat(jsonFile);
  checkAbort(signal);
  if (!stat.isFile()) throw new Error('not_file');
  if (stat.size > MAX_RAW_JSON_BYTES) throw new RangeError('raw_file_too_large');
  const temporary = `${outputFile}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
  let compressedBytes = 0;
  const limit = new Transform({
    transform(chunk, _encoding, callback) {
      compressedBytes += chunk.length;
      if (compressedBytes > maxBytes) callback(new RangeError('gzip_too_large'));
      else callback(null, chunk);
    }
  });
  try {
    await pipeline(fs.createReadStream(jsonFile), createGzip(), limit, fs.createWriteStream(temporary, { flags: 'wx' }), { signal });
    checkAbort(signal);
    await fsp.rename(temporary, outputFile);
    return compressedBytes;
  } catch (error) {
    await fsp.unlink(temporary).catch(() => {});
    throw error;
  }
}
function multipartBody(payload, files) {
  const boundary = `----movix-probe-${Math.random().toString(16).slice(2)}`;
  const pieces = [];
  const add = (value) => pieces.push(Buffer.isBuffer(value) ? value : Buffer.from(value));
  add(`--${boundary}\r\nContent-Disposition: form-data; name="payload_json"\r\nContent-Type: application/json\r\n\r\n`);
  add(JSON.stringify(payload)); add('\r\n');
  files.forEach((file, index) => {
    add(`--${boundary}\r\nContent-Disposition: form-data; name="files[${index}]"; filename="${file.name}"\r\nContent-Type: ${file.contentType}\r\n\r\n`);
    add(file.data); add('\r\n');
  });
  add(`--${boundary}--\r\n`);
  const body = Buffer.concat(pieces);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}
function defaultTransport({ url, payload, files, timeoutMs = TIMEOUT_MS, requestImpl = https.request, signal }) {
  if (signal?.aborted) return Promise.reject(new Error('aborted'));
  const { body, contentType } = multipartBody(payload, files);
  return new Promise((resolve, reject) => {
    let deadline;
    let settled = false;
    const complete = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      signal?.removeEventListener('abort', abort);
      callback(value);
    };
    const request = requestImpl(url, {
      method: 'POST',
      headers: { 'content-type': contentType, 'content-length': body.length },
    }, (response) => {
      let received = 0;
      response.on('data', (chunk) => {
        received += chunk.length;
        if (received > RESPONSE_LIMIT) {
          const error = new RangeError('response_too_large');
          response.destroy(error);
          complete(reject, error);
        }
      });
      response.once('error', (error) => complete(reject, error));
      response.once('aborted', () => complete(reject, new Error('response_aborted')));
      response.once('close', () => { if (!response.complete) complete(reject, new Error('response_closed')); });
      response.once('end', () => complete(resolve, { statusCode: response.statusCode }));
    });
    deadline = setTimeout(() => request.destroy(new Error('timeout')), Math.max(1, Math.min(TIMEOUT_MS, timeoutMs)));
    function abort() {
      const error = new Error('aborted');
      request.destroy(error);
      complete(reject, error);
    }
    request.once('error', (error) => complete(reject, error));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    request.end(body);
  });
}

async function notifyReport({ runDir, reason = 'deadline', alert, env = process.env, transport = defaultTransport, signal } = {}) {
  const aborted = () => ({ status: 'skipped', reason: 'aborted' });
  if (signal?.aborted) return aborted();
  if (!enabled(env)) return { status: 'skipped', reason: 'disabled' };
  const webhookUrl = env.WIFLIX_PROXY_BLOCK_WEBHOOK_URL;
  if (!isValidDiscordWebhookUrl(webhookUrl)) return { status: 'skipped', reason: webhookUrl ? 'invalid_webhook' : 'missing_webhook' };
  const userId = env.MAINAPI_PROBE_DISCORD_USER_ID || DEFAULT_USER_ID;
  if (!validUserId(userId)) return { status: 'skipped', reason: 'invalid_user_id' };
  if (typeof runDir !== 'string' || !runDir) return { status: 'skipped', reason: 'missing_report' };

  let markdown;
  try { markdown = await readFileWithin(path.resolve(runDir, 'report.md'), MAX_MARKDOWN_BYTES, signal); }
  catch { return signal?.aborted ? aborted() : { status: 'skipped', reason: 'missing_report' }; }

  const files = [{ name: 'report.md', contentType: 'text/markdown; charset=utf-8', data: markdown }];
  let extra = '';
  try {
    const jsonFile = path.resolve(runDir, 'report.json');
    const gzipFile = path.resolve(runDir, 'report.json.gz');
    const gzipBudget = MAX_MULTIPART_BYTES - markdown.length - 16 * 1024;
    if (gzipBudget <= 0) throw new RangeError('multipart_too_large');
    await gzipReport(jsonFile, gzipFile, gzipBudget, { signal });
    const compressed = await readFileWithin(gzipFile, gzipBudget, signal);
    if (markdown.length + compressed.length <= MAX_MULTIPART_BYTES - 16 * 1024) {
      files.push({ name: 'report.json.gz', contentType: 'application/gzip', data: compressed });
    } else {
      extra = ' La pièce report.json.gz dépasse la limite de notification ; le rapport local reste disponible.';
    }
  } catch {
    if (signal?.aborted) return aborted();
    extra = ' La pièce report.json.gz est indisponible ; le rapport local reste disponible.';
  }

  const payload = {
    content: `<@${userId}> ${reportMessage(reason, alert)}${extra}`,
    allowed_mentions: { parse: [], users: [userId] },
    attachments: files.map((file, id) => ({ id, filename: file.name })),
  };
  let response;
  if (signal?.aborted) return aborted();
  try {
    const destination = new URL(webhookUrl);
    destination.searchParams.set('wait', 'true');
    response = await transport({ url: destination.toString(), payload, files, timeoutMs: TIMEOUT_MS, signal });
  } catch {
    return signal?.aborted ? aborted() : { status: 'failed', reason: 'transport_error' };
  }
  const httpStatus = Number(response?.statusCode ?? response?.status);
  if (httpStatus >= 200 && httpStatus < 300) return { status: 'sent', httpStatus };
  return { status: 'failed', reason: httpStatus === 429 ? 'rate_limited' : 'http_error', httpStatus: Number.isFinite(httpStatus) ? httpStatus : undefined };
}

module.exports = { notifyReport, defaultTransport, multipartBody, gzipReport };
