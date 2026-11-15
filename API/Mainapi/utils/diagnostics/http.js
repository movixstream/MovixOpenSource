'use strict';

const http = require('node:http');
const https = require('node:https');
const diagnostics = require('node:diagnostics_channel');
const { httpLabel, httpDestination } = require('./labels');

const safe = (fn) => { try { return fn(); } catch { return undefined; } };
const bytes = (chunk, encoding) => typeof chunk === 'string' ? Buffer.byteLength(chunk, typeof encoding === 'string' ? encoding : undefined)
  : chunk?.byteLength || 0;

// Observe writes and readable.push: attaching a 'data' listener would start reading
// an upstream response before the caller is ready and break stream backpressure.
function observeWrites(stream, span) {
  const write = stream.write, end = stream.end;
  let ending = false;
  function wrappedWrite(chunk, encoding) {
    if (!ending) safe(() => span.send(bytes(chunk, encoding)));
    return write.apply(this, arguments);
  }
  function wrappedEnd(chunk, encoding) {
    safe(() => span.send(bytes(chunk, encoding)));
    ending = true;
    try { return end.apply(this, arguments); } finally { ending = false; }
  }
  stream.write = wrappedWrite; stream.end = wrappedEnd;
  return () => {
    if (stream.write === wrappedWrite) stream.write = write;
    if (stream.end === wrappedEnd) stream.end = end;
  };
}

function observeReadable(stream, span) {
  const push = stream.push;
  function wrappedPush(chunk, encoding) {
    safe(() => span.receive(bytes(chunk, encoding)));
    return push.apply(this, arguments);
  }
  stream.push = wrappedPush;
  return () => { if (stream.push === wrappedPush) stream.push = push; };
}

function instrumentHttp(collector) {
  const undos = [];
  const pending = new Set();
  for (const mod of [http, https]) {
    const original = mod.request, originalGet = mod.get;
    function request() {
      const req = original.apply(this, arguments);
      if (!collector.active) return req;
      if (!collector.recording) {
        // Chauffe exclue : ni libellé complet ni span, seulement la base des sockets persistantes.
        safe(() => {
          const label = `http:${httpDestination(req)}`;
          if (req.socket) collector.trackSocket(req.socket, label);
          else req.once('socket', (socket) => safe(() => collector.trackSocket(socket, label)));
        });
        return req;
      }
      safe(() => {
        const label = httpLabel(req, req.method);
        const span = collector.start({ kind: 'http', ...label, byteMode: 'encoded-body' });
        const restoreWrite = observeWrites(req, span);
        let restoreRead, response, done = false;
        function cleanup() {
          restoreWrite(); restoreRead?.(); pending.delete(cleanup);
          req.removeListener('socket', onSocket); req.removeListener('response', onResponse);
          req.removeListener('error', onError); req.removeListener('close', onClose);
          req.removeListener('upgrade', onUpgrade); req.removeListener('connect', onUpgrade);
          response?.removeListener('end', onEnd); response?.removeListener('error', onError);
          response?.removeListener('aborted', onAbort); response?.removeListener('close', onResponseClose);
        }
        function finish(error, status = response?.statusCode) {
          if (done) return; done = true;
          safe(() => span.finish({ status, error })); cleanup();
        }
        function onError(error) { finish(error); }
        function discardedRedirect() {
          // Axios/follow-redirects destroys the intermediate request and body
          // after Location, without a transport error. Keep real truncations.
          return [301, 302, 303, 307, 308].includes(response?.statusCode) && response.headers.location &&
            req.destroyed && !req.errored && !response.errored;
        }
        function onAbort() {
          if (discardedRedirect()) { span.markUnmeasured(); finish(); }
          else finish('aborted');
        }
        function onEnd() { finish(); }
        function onClose() { if (!response) finish('closed-before-response'); }
        function onResponseClose() {
          if (!response.complete) {
            if (discardedRedirect()) { span.markUnmeasured(); finish(); }
            else finish('incomplete-response');
          } else finish();
        }
        function onSocket(socket) { safe(() => collector.trackSocket(socket, `http:${label.destination}`)); }
        function onUpgrade(res) { finish(undefined, res.statusCode); }
        function onResponse(res) {
          response = res;
          restoreRead = observeReadable(res, span);
          res.once('end', onEnd); res.once('error', onError); res.once('aborted', onAbort); res.once('close', onResponseClose);
        }
        // Bound the live wrapper registry too. Aggregate overflow remains visible.
        if (pending.size >= 8192) { collector.warn('http_pending_budget_exceeded'); cleanup(); return; }
        pending.add(cleanup);
        req.prependOnceListener('response', onResponse);
        req.once('socket', onSocket); req.once('error', onError); req.once('close', onClose);
        req.once('upgrade', onUpgrade); req.once('connect', onUpgrade);
        if (req.socket) onSocket(req.socket);
      });
      return req;
    }
    function get() { const req = request.apply(this, arguments); req.end(); return req; }
    mod.request = request; mod.get = get;
    undos.push(() => { if (mod.request === request) mod.request = original; if (mod.get === get) mod.get = originalGet; });
  }

  const requests = new WeakMap();
  const subscriptions = [];
  function subscribe(name, callback) {
    const channel = diagnostics.channel(name);
    const listener = (message) => { if (collector.active) safe(() => callback(message)); };
    channel.subscribe(listener); subscriptions.push(() => channel.unsubscribe(listener));
  }
  subscribe('undici:request:create', ({ request }) => {
    if (!collector.recording) return;
    requests.set(request, { received: false, method: request.method,
      span: collector.start({ kind: 'fetch', ...httpLabel(`${request.origin}${request.path}`, request.method), byteMode: 'encoded-body' }) });
  });
  subscribe('undici:request:bodyChunkSent', ({ request, chunk }) => requests.get(request)?.span.send(bytes(chunk)));
  subscribe('undici:request:bodyChunkReceived', ({ request, chunk }) => {
    const entry = requests.get(request);
    if (entry) { entry.received = true; entry.span.receive(bytes(chunk)); }
  });
  const statuses = new WeakMap();
  subscribe('undici:request:headers', ({ request, response }) => statuses.set(request, response.statusCode));
  subscribe('undici:request:trailers', ({ request }) => {
    const entry = requests.get(request), status = statuses.get(request);
    // Bundled and npm Undici can coexist. Detect actual events per request, not
    // process.versions.undici (older versions do not publish body chunks).
    if (entry && !entry.received && entry.method !== 'HEAD' && ![204, 304].includes(status)) {
      entry.span.markUnmeasured(); collector.warn('undici_response_bytes_unavailable_or_empty');
    }
    entry?.span.finish({ status }); requests.delete(request); statuses.delete(request);
  });
  subscribe('undici:request:error', ({ request, error }) => {
    requests.get(request)?.span.finish({ error }); requests.delete(request); statuses.delete(request);
  });
  subscribe('undici:client:sendHeaders', ({ request, socket }) => {
    collector.trackSocket(socket, `fetch:${httpLabel(request.origin).destination}`);
  });
  return () => { for (const undo of [...undos, ...subscriptions, ...pending]) safe(undo); pending.clear(); };
}

function inboundMiddleware(collector) {
  return function resourceProbe(req, res, next) {
    // Pendant la chauffe, aucun contexte : les chaînes lancées alors restent « background/startup ».
    if (!collector.recording) return next();
    const label = httpLabel({ path: req.originalUrl || req.url, hostname: 'mainapi', method: req.method });
    const source = `route ${label.operation.replace('mainapi', '')}`;
    return collector.withSource(source, (store) => {
      // En-têtes envoyés = réponse engagée : la suite est du travail détaché. headersSent
      // passe à true dès res.end(), même quand compression n'écrit le corps que plus tard.
      if (store) store.isResponded = () => res.headersSent;
      const span = collector.start({ kind: 'inbound', ...label, destination: 'mainapi', byteMode: 'encoded-body' });
      const restoreRead = observeReadable(req, span);
      const restoreWrite = observeWrites(res, { send: (amount) => span.send(amount) });
      let done = false;
      function finish() {
        if (done) return; done = true;
        // Ne pas retenir res dans le contexte des tâches de fond encore en cours.
        if (store) { store.responded = true; store.isResponded = null; }
        safe(() => span.finish({ status: res.statusCode, error: res.writableFinished ? undefined : 'aborted' }));
        restoreRead(); restoreWrite(); res.removeListener('finish', finish); res.removeListener('close', finish);
      }
      res.once('finish', finish); res.once('close', finish);
      next();
    });
  };
}

module.exports = { instrumentHttp, inboundMiddleware };
