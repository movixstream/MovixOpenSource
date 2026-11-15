'use strict';

const { httpLabel, redisLabel, sqlLabel } = require('./labels');

function safeCall(fn) { try { return fn?.(); } catch { return undefined; } }
function isActive(collector) { return Boolean(collector?.active); }
// Pendant la chauffe, les appels sont exclus : ne calculer ni libellé ni span.
function isRecording(collector) { return isActive(collector) && collector.recording !== false; }
function bytesOf(value) {
  if (Buffer.isBuffer(value)) return value.length;
  if (typeof value === 'string') return Buffer.byteLength(value);
  if (value instanceof Uint8Array) return value.byteLength;
  return 0;
}
function responseBytes(value, state = { seen: 0, truncated: false, unknown: false }, depth = 0) {
  // Réponses entières (INCR, PTTL, EXPIRE…) : taille connue, comme pour une chaîne.
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') return { bytes: String(value).length, ...state };
  const own = bytesOf(value);
  if (own || value == null) return { bytes: own, ...state };
  if (!Array.isArray(value)) return { bytes: 0, ...state, unknown: true };
  if (depth >= 4) return { bytes: 0, ...state, truncated: true };
  let bytes = 0;
  for (const item of value) {
    if (++state.seen > 128) { state.truncated = true; break; }
    const measured = responseBytes(item, state, depth + 1);
    bytes += measured.bytes;
  }
  return { bytes, ...state };
}
function commandBytes(command) {
  const values = [command?.name, ...(Array.isArray(command?.args) ? command.args : [])];
  return values.reduce((total, value) => total + bytesOf(value || String(value ?? '')) + 3, 0);
}
function finish(span, result, error, rows) {
  safeCall(() => {
    if (error) span?.finish?.({ status: error.statusCode || error.status, error, rows });
    else span?.finish?.({ status: result?.statusCode || result?.status, rows });
  });
}
function observe(value, span, success) {
  if (!value || typeof value.then !== 'function') {
    const metadata = safeCall(() => success?.(value));
    finish(span, value, undefined, metadata?.rows);
    return value;
  }
  Promise.resolve(value).then(
    (result) => { const metadata = safeCall(() => success?.(result)); finish(span, result, undefined, metadata?.rows); },
    (error) => finish(span, undefined, error)
  );
  return value;
}
function start(collector, kind, label, byteMode) {
  return safeCall(() => collector.start({ kind, ...label, byteMode }));
}
function trackSocket(collector, socket, label) {
  if (socket) safeCall(() => collector.trackSocket(socket, label));
}

function instrumentRedis(client, collector) {
  if (!client || !isActive(collector) || typeof client.sendCommand !== 'function') return () => {};
  const original = client.sendCommand;
  const observed = new WeakSet();
  const socketSeen = new WeakSet();
  const attachSocket = () => {
    const socket = client.connector?.stream || client.stream;
    if (socket && !socketSeen.has(socket)) { socketSeen.add(socket); trackSocket(collector, socket, 'redis'); }
  };
  const onConnect = () => attachSocket();
  attachSocket();
  safeCall(() => client.on?.('connect', onConnect));
  const wrapped = function instrumentedSendCommand(command) {
    let output;
    try { output = original.apply(this, arguments); }
    catch (error) {
      if (isRecording(collector) && command && typeof command === 'object' && !observed.has(command)) {
        observed.add(command);
        finish(start(collector, 'redis', redisLabel(command)), undefined, error);
      }
      throw error;
    }
    if (!isRecording(collector) || !command || typeof command !== 'object' || observed.has(command)) return output;
    observed.add(command);
    const span = start(collector, 'redis', redisLabel(command), 'redis-values');
    safeCall(() => span?.send?.(commandBytes(command)));
    const promise = command.promise && typeof command.promise.then === 'function' ? command.promise : output;
    observe(promise, span, (result) => {
      const measured = responseBytes(result);
      safeCall(() => span?.receive?.(measured.bytes));
      if (measured.truncated) safeCall(() => collector.warn?.('redis_reply_truncated'));
      if (measured.unknown) safeCall(() => collector.warn?.('redis_reply_unmeasured'));
    });
    return output;
  };
  client.sendCommand = wrapped;
  return () => {
    if (client.sendCommand === wrapped) client.sendCommand = original;
    safeCall(() => client.removeListener?.('connect', onConnect));
  };
}

function rowCount(result) {
  const rows = Array.isArray(result) ? result[0] : result;
  return Array.isArray(rows) ? rows.length : (rows && typeof rows.affectedRows === 'number' ? rows.affectedRows : undefined);
}
function instrumentMysqlPool(pool, collector) {
  if (!pool || !isActive(collector)) return () => {};
  let installed = true;
  const poolRestores = [];
  const activeLeases = new Set();
  const socketSeen = new WeakSet();
  const connectionRecords = new WeakMap();
  const trackConnection = (connection) => {
    const socket = connection?.stream || connection?.connection?.stream;
    if (socket && !socketSeen.has(socket)) { socketSeen.add(socket); trackSocket(collector, socket, 'mysql'); }
  };
  const restoreRecord = (record) => {
    for (const restore of record.restores.reverse()) safeCall(restore);
    record.restores.length = 0;
  };
  const wrapQueryMethods = (target, lease = false) => {
    if (!target || connectionRecords.has(target)) return;
    const record = { restores: [] };
    connectionRecords.set(target, record);
    trackConnection(target);
    for (const method of ['query', 'execute']) {
      if (typeof target[method] !== 'function') continue;
      const original = target[method];
      const wrapped = function instrumentedMysqlQuery(sql) {
        if (!installed || !isRecording(collector)) return original.apply(this, arguments);
        const span = start(collector, 'mysql', sqlLabel(sql), 'sql-text');
        safeCall(() => span?.send?.(bytesOf(String(sql ?? ''))));
        let output;
        try { output = original.apply(this, arguments); }
        catch (error) { finish(span, undefined, error); throw error; }
        return observe(output, span, (result) => {
          safeCall(() => span?.receive?.(0));
          return { rows: rowCount(result) };
        });
      };
      target[method] = wrapped;
      record.restores.push(() => { if (target[method] === wrapped) target[method] = original; });
    }
    if (!lease) { poolRestores.push(record); return; }
    activeLeases.add(record);
    if (typeof target.release === 'function') {
      const originalRelease = target.release;
      const wrappedRelease = function instrumentedRelease() {
        try { return originalRelease.apply(this, arguments); }
        finally {
          restoreRecord(record);
          activeLeases.delete(record);
          connectionRecords.delete(target);
        }
      };
      target.release = wrappedRelease;
      record.restores.push(() => { if (target.release === wrappedRelease) target.release = originalRelease; });
    }
  };
  wrapQueryMethods(pool);
  const onConnection = (connection) => trackConnection(connection);
  safeCall(() => pool.on?.('connection', onConnection));
  if (typeof pool.getConnection === 'function') {
    const originalGetConnection = pool.getConnection;
    const wrappedGetConnection = function instrumentedGetConnection() {
      const output = originalGetConnection.apply(this, arguments);
      if (installed && isActive(collector)) observe(output, null, (connection) => {
        if (installed && isActive(collector)) wrapQueryMethods(connection, true);
      });
      return output;
    };
    pool.getConnection = wrappedGetConnection;
    poolRestores.push({ restores: [() => { if (pool.getConnection === wrappedGetConnection) pool.getConnection = originalGetConnection; }] });
  }
  return () => {
    installed = false;
    for (const record of activeLeases) restoreRecord(record);
    activeLeases.clear();
    for (const record of poolRestores.reverse()) restoreRecord(record);
    safeCall(() => pool.removeListener?.('connection', onConnection));
  };
}

function decodedBody(result, collector, span) {
  const body = result?.body ?? result?.data;
  const size = bytesOf(body);
  safeCall(() => span?.receive?.(size));
  if (body != null && typeof body !== 'string' && !Buffer.isBuffer(body) && !(body instanceof Uint8Array)) safeCall(() => {
    span?.markUnmeasured?.(); collector.warn?.('decoded_body_unmeasured');
  });
}
function wrapCycleTLS(fn, collector) {
  if (typeof fn !== 'function' || !isActive(collector)) return fn;
  return new Proxy(fn, {
    apply(target, thisArg, args) {
      if (!isRecording(collector)) return Reflect.apply(target, thisArg, args);
      const [url, options = {}, method] = args;
      const span = start(collector, 'cycletls', httpLabel(url, method || options?.method || 'GET'), 'decoded-body');
      safeCall(() => span?.send?.(bytesOf(options?.body)));
      let output;
      try { output = Reflect.apply(target, thisArg, args); }
      catch (error) { finish(span, undefined, error); throw error; }
      return observe(output, span, (result) => decodedBody(result, collector, span));
    }
  });
}
function observeTextRequest(collector, kind, url, options, operation) {
  let output;
  if (!isRecording(collector)) return operation();
  const span = start(collector, kind, httpLabel(url, options?.method || 'GET'), 'decoded-body');
  safeCall(() => span?.send?.(bytesOf(options?.body)));
  try { output = operation(); }
  catch (error) { finish(span, undefined, error); throw error; }
  return observe(output, span, (result) => decodedBody(result, collector, span));
}

module.exports = { instrumentRedis, instrumentMysqlPool, wrapCycleTLS, observeTextRequest };
