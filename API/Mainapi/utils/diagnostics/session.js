'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const { createCollector } = require('./collector');
const { instrumentHttp } = require('./http');
const { createCpuSampler } = require('./cpuSampler');
const { createSystemSampler } = require('./systemSampler');
const { buildReport, renderMarkdown } = require('./report');
const { createThresholdGate } = require('./alerts');
const { createGcTracker, heapSummary, createSmapsReader } = require('./memoryStats');

const MESSAGE = 'mainapi-resource-probe-v1';
const SAMPLE_MS = 5000;
const SNAPSHOT_MS = 30000;
// L'histogramme de monitorEventLoopDelay inclut la période de son minuteur interne.
const EVENT_LOOP_RESOLUTION_MS = 20;
// Un rapport d'alerte couvre au moins une minute : sinon moyennes et appels en cours sont faussés.
const ALERT_MIN_MEASUREMENT_MS = 60000;
const unref = (timer) => { timer.unref?.(); return timer; };
const finite = (value) => Number.isFinite(value) ? value : 0;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function boundedWait(promise, ms = 1500, signal) {
  return new Promise((resolve) => {
    let timer;
    const finish = (result) => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); resolve(result); };
    const onAbort = () => finish(false);
    Promise.resolve(promise).then(() => finish(true), () => finish(false));
    if (signal?.aborted || ms <= 0) { finish(false); return; }
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => finish(false), ms);
  });
}

function parseDuration(raw) {
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(21600, Math.max(1, Math.floor(seconds))) : 0;
}

function parseMode(raw) {
  const mode = String(raw || 'diagnostic').trim().toLowerCase();
  if (mode === 'analyse' || mode === 'analysis') return 'analyse';
  if (mode === 'diagnostic') return mode;
  throw new RangeError('MAINAPI_PROBE_MODE doit valoir diagnostic ou analyse');
}

function createWorkerSession(config, options = {}) {
  const proc = options.process || process;
  const sampleMs = options.sampleMs || SAMPLE_MS;
  const snapshotMs = options.snapshotMs || SNAPSHOT_MS;
  const collector = createCollector({ paused: true });
  const restoreHttp = options.instrumentHttp === false ? () => {} : instrumentHttp(collector);
  const cpu = createCpuSampler({ slot: Number(proc.env.MOVIX_WORKER_SLOT) || 0, rootDir: path.resolve(__dirname, '../..'),
    anchorAt: config.startsAt, ...options.cpuOptions });
  const lag = options.eventLoopMonitor || monitorEventLoopDelay({ resolution: EVENT_LOOP_RESOLUTION_MS });
  const gc = options.gcTracker || createGcTracker();
  const smaps = options.smapsReader || createSmapsReader();
  const readHeap = options.heapSummary || heapSummary;
  let previousCpu, previousTick, previousElu, previousRegularTick;
  let previousGroups = new Map();
  let inFlight = null, stopPromise = null, stopped = false;
  const resources = [];
  const undos = [restoreHttp];
  let monitoring = false, sampleTimer, snapshotTimer, warmupTimer;

  // kind : 'regular' (minuteur de 5 s), 'capture' (alerte) ou 'final' (arrêt).
  function sampleResource(kind = 'final') {
    if (!monitoring) return;
    try {
      const tick = performance.now();
      const elapsedMs = Math.max(1, tick - previousTick);
      const usage = proc.cpuUsage();
      const cpuUsageUs = usage.user + usage.system - previousCpu.user - previousCpu.system;
      const elu = performance.eventLoopUtilization();
      const eluDelta = performance.eventLoopUtilization(elu, previousElu);
      const snapshot = collector.snapshot();
      const operations = snapshot.groups.filter((row) => row.kind !== 'inbound').map((row) => {
        const key = JSON.stringify([row.kind, row.operation, row.source, row.byteMode]);
        const previous = previousGroups.get(key);
        return { kind: row.kind, operation: row.operation, source: row.source, byteMode: row.byteMode,
          started: row.started - (previous?.started || 0), receivedBytes: row.receivedBytes - (previous?.receivedBytes || 0) };
      }).filter((row) => row.started || row.receivedBytes)
        .sort((a, b) => b.receivedBytes - a.receivedBytes || b.started - a.started).slice(0, 8);
      previousGroups = new Map(snapshot.groups.map((row) => [JSON.stringify([row.kind, row.operation, row.source, row.byteMode]), row]));
      // Retard réel : la résolution de 20 ms est retirée du p99 et du maximum.
      let eventLoopMaxMs = Math.max(0, lag.max / 1e6 - EVENT_LOOP_RESOLUTION_MS);
      let eventLoopTimerLateMs = null;
      if (kind === 'regular') {
        // Un blocage retarde aussi ce minuteur. reset() efface l'intervalle long de l'histogramme
        // s'il tombe dans le même tour : le retard du minuteur garde ce blocage.
        eventLoopTimerLateMs = Math.max(0, tick - previousRegularTick - sampleMs);
        eventLoopMaxMs = Math.max(eventLoopMaxMs, eventLoopTimerLateMs);
        previousRegularTick = tick;
      }
      let heap = null;
      try { heap = readHeap(); } catch { collector.warn('heap_statistics_failed'); }
      const point = { at: Date.now(), elapsedMs, cpuUsageUs, cpuPercent: cpuUsageUs / elapsedMs / 10,
        memory: proc.memoryUsage(), eventLoopUtilization: finite(eluDelta.utilization),
        eventLoopP99Ms: finite(Math.max(0, lag.percentile(99) / 1e6 - EVENT_LOOP_RESOLUTION_MS)), eventLoopMaxMs: finite(eventLoopMaxMs),
        eventLoopTimerLateMs, gc: gc.take(), heap, smapsRollup: smaps.latest(), operations };
      if (kind === 'capture') point.capture = true;
      resources.push(point);
      if (resources.length > 24) { resources.shift(); collector.warn('ipc_resource_backlog_dropped'); }
      previousCpu = usage; previousTick = tick; previousElu = elu; lag.reset();
      // Lecture /proc asynchrone : jointe au relevé suivant, sans bloquer la boucle.
      void smaps.refresh();
    } catch { collector.warn('worker_resource_sample_failed'); }
  }

  function publish(final = false) {
    if (inFlight) { collector.warn('ipc_backpressure'); return inFlight; }
    if (!proc.connected || typeof proc.send !== 'function') { collector.warn('ipc_unavailable'); return Promise.resolve(); }
    const points = resources.slice();
    const payload = { type: MESSAGE, action: 'snapshot', runId: config.runId, pid: proc.pid,
      slot: Number(proc.env.MOVIX_WORKER_SLOT) || 0, at: Date.now(), final,
      metrics: collector.snapshot(), cpuProfile: cpu.snapshot(), resources: points };
    // One outstanding write, cumulative counters: a skipped snapshot never doubles totals.
    inFlight = new Promise((resolve) => {
      let settled = false;
      function done(error) {
        if (settled) return; settled = true;
        if (error) collector.warn('ipc_send_failed');
        else {
          const lastAt = points[points.length - 1]?.at || 0;
          while (resources.length && resources[0].at <= lastAt) resources.shift();
        }
        resolve();
      }
      try { proc.send(payload, done); } catch (error) { done(error); }
    }).finally(() => { inFlight = null; });
    return inFlight;
  }

  function beginCollection() {
    if (stopped || monitoring) return;
    const remainingWarmup = (config.startsAt || 0) - Date.now();
    if (remainingWarmup > 0) { warmupTimer = unref(setTimeout(beginCollection, remainingWarmup)); return; }
    monitoring = true;
    collector.begin();
    previousCpu = proc.cpuUsage(); previousTick = performance.now(); previousElu = performance.eventLoopUtilization();
    previousRegularTick = previousTick;
    lag.enable(); gc.start(); void smaps.refresh(); cpu.start();
    sampleTimer = unref(setInterval(() => sampleResource('regular'), sampleMs));
    snapshotTimer = unref(setInterval(() => { if (!stopped) void publish(); }, snapshotMs));
    void publish();
  }
  const deadlineTimer = unref(setTimeout(() => { void stop(); }, Math.max(0, config.endsAt - Date.now())));
  function onMessage(message) {
    if (message?.type === MESSAGE && message.runId === config.runId && message.action === 'stop') void stop();
    if (!stopped && message?.type === MESSAGE && message.runId === config.runId && message.action === 'capture') {
      // Les minuteries du master et des workers partagent la même grille de 5 s : un relevé pris
      // juste après le relevé régulier ne dure que quelques ms et mesure surtout ce message.
      if (performance.now() - previousTick >= sampleMs / 5) sampleResource('capture');
      void publish();
    }
  }
  proc.on('message', onMessage);
  const warmupMs = Math.max(0, (config.startsAt || 0) - Date.now());
  if (warmupMs) {
    warmupTimer = unref(setTimeout(beginCollection, warmupMs));
    void publish();
  } else beginCollection();

  function stop() {
    if (stopPromise) return stopPromise;
    stopped = true;
    clearInterval(sampleTimer); clearInterval(snapshotTimer); clearTimeout(deadlineTimer); clearTimeout(warmupTimer);
    proc.removeListener('message', onMessage);
    sampleResource('final');
    collector.stop();
    for (const undo of undos.splice(0)) { try { undo(); } catch { collector.warn('hook_restore_failed'); } }
    lag.disable(); gc.stop();
    const finishBy = performance.now() + (options.stopBudgetMs ?? 1500);
    const remaining = () => Math.max(0, finishBy - performance.now());
    stopPromise = (async () => {
      if (!await boundedWait(cpu.stop(), remaining())) collector.warn('cpu_stop_timeout');
      if (inFlight && !await boundedWait(inFlight, remaining())) { collector.warn('ipc_final_unavailable'); return; }
      if (!remaining() || !await boundedWait(publish(true), remaining())) collector.warn('ipc_final_unavailable');
    })().catch(() => { collector.warn('worker_stop_failed'); });
    return stopPromise;
  }
  return { collector, stop, addUndo: (undo) => undos.push(undo) };
}

function createMasterSession(cluster, options = {}) {
  const env = options.env || process.env;
  const duration = parseDuration(env.MAINAPI_PROBE_SECONDS);
  const mode = parseMode(env.MAINAPI_PROBE_MODE);
  const warmupMs = mode === 'analyse' ? (options.warmupMs ?? 300000) : 0;
  const startedAt = Date.now(), measurementStartedAt = startedAt + warmupMs;
  const endsAt = measurementStartedAt + duration * 1000;
  const sampleMs = options.sampleMs || SAMPLE_MS, snapshotMs = options.snapshotMs || SNAPSHOT_MS;
  const runId = `${new Date(startedAt).toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
  const runDir = path.resolve(env.MAINAPI_PROBE_DIR || path.join(__dirname, '../../diagnostics'), runId);
  fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(runDir, 'report.json'), '{}\n', { mode: 0o600 });
  const state = { runDir, runId, startedAt, measurementStartedAt, endsAt, mode, warmupMs, sampleMs, snapshotMs,
    alertMinMeasurementMs: options.alertMinMeasurementMs ?? ALERT_MIN_MEASUREMENT_MS,
    workers: new Map(), expectedWorkers: new Set(), processes: new Map(), system: [], warnings: {}, alerts: [] };
  const sampler = options.systemSampler || createSystemSampler();
  let previousSystem = null, sampling = null, writing = Promise.resolve(), stopPromise = null, stopped = false;
  let alertTask = null, pendingAlert = null, foldedAlert = null;
  const alertMinMeasurementMs = state.alertMinMeasurementMs;
  let sampleTimer, warmupTimer;
  const notificationAbort = new AbortController();
  let shutdownRequested = false, stopExpired = false, stopComplete = false, freezeSampling = false, shutdownTimer, resolveStop;
  const alertGate = createThresholdGate();
  const maxPoints = Math.ceil(duration * 1000 / sampleMs) + 4;
  function warn(code) { state.warnings[code] = (state.warnings[code] || 0) + 1; }
  function onFork(worker) {
    if (state.expectedWorkers.size < 128) state.expectedWorkers.add(worker.process.pid);
    else warn('expected_worker_budget_exceeded');
  }
  for (const worker of Object.values(cluster.workers || {})) onFork(worker);

  function onMessage(worker, message) {
    if (message?.type !== MESSAGE || message.runId !== runId || message.action !== 'snapshot') return;
    const pid = worker.process.pid;
    if (!state.expectedWorkers.has(pid)) onFork(worker);
    const previous = state.workers.get(pid);
    if (!previous && state.workers.size >= 128) { warn('worker_budget_exceeded'); return; }
    if (previous?.final || (previous && message.at < previous.at)) return;
    const resources = previous?.resources || [];
    const lastAt = resources[resources.length - 1]?.at || 0;
    resources.push(...(message.resources || []).filter((point) => point.at > lastAt));
    if (resources.length > maxPoints) { resources.splice(0, resources.length - maxPoints); warn('worker_timeline_budget_exceeded'); }
    state.workers.set(pid, { pid, slot: message.slot, at: message.at, final: Boolean(message.final),
      metrics: message.metrics, cpuProfile: message.cpuProfile, resources });
  }
  function onExit(worker) {
    const previous = state.workers.get(worker.process.pid);
    if (previous) previous.exitedAt = Date.now();
    else warn('worker_exited_before_snapshot');
  }
  cluster.on('message', onMessage); cluster.on('exit', onExit); cluster.on('fork', onFork);

  function sampleSystem() {
    if (sampling) return sampling;
    sampling = (async () => {
      const current = await sampler.sample();
      if (freezeSampling || stopExpired) return;
      for (const warning of current.warnings || []) warn(warning);
      if (previousSystem) {
        const elapsedMs = Math.max(1, current.at - previousSystem.at);
        const delta = (a, b) => a != null && b != null && a >= b ? a - b : null;
        const cpuUsageUs = delta(current.cgroup?.cpuUsageUs, previousSystem.cgroup?.cpuUsageUs);
        const point = { at: current.at, elapsedMs,
          rxBytes: delta(current.network?.rxBytes, previousSystem.network?.rxBytes),
          txBytes: delta(current.network?.txBytes, previousSystem.network?.txBytes),
          cpuUsageUs, cpuPercent: cpuUsageUs === null ? null : cpuUsageUs / elapsedMs / 10,
          cpuQuotaCores: current.cgroup?.cpuQuotaCores ?? null,
          memoryBytes: current.cgroup?.memoryBytes ?? null, memoryLimitBytes: current.cgroup?.memoryLimitBytes ?? null };
        state.system.push(point);
        if (state.system.length > maxPoints) { state.system.shift(); warn('system_timeline_budget_exceeded'); }
        const before = new Map((previousSystem.processes || []).map((row) => [row.pid, row]));
        for (const process of current.processes || []) {
          if (!state.processes.has(process.pid) && state.processes.size >= 512) { warn('process_budget_exceeded'); continue; }
          const usage = delta(process.cpuUsageUs, before.get(process.pid)?.cpuUsageUs) || 0;
          const row = state.processes.get(process.pid) || { pid: process.pid, name: process.name, cpuUsageUs: 0, peakCpuPercent: 0, peakRssBytes: 0 };
          row.cpuUsageUs += usage;
          row.peakCpuPercent = Math.max(row.peakCpuPercent, usage / elapsedMs / 10);
          row.peakRssBytes = Math.max(row.peakRssBytes, process.rssBytes);
          state.processes.set(process.pid, row);
        }
        queueThresholdAlert(point);
      }
      previousSystem = current;
    })().catch(() => warn('system_sample_failed')).finally(() => { sampling = null; });
    return sampling;
  }

  async function atomicWrite(name, content) {
    const dest = path.join(runDir, name), temp = `${dest}.tmp`;
    await fs.promises.writeFile(temp, content, { mode: 0o600 });
    if (stopExpired) { await fs.promises.unlink(temp).catch(() => {}); return; }
    await fs.promises.rename(temp, dest);
  }
  async function sendNotification(reason, alert) {
    if (shutdownRequested || stopExpired) return { status: 'skipped', reason: 'server_shutdown' };
    const notify = options.notify || require('./notify').notifyReport;
    const controller = new AbortController();
    const abort = () => controller.abort();
    notificationAbort.signal.addEventListener('abort', abort, { once: true });
    let result = { status: 'failed', reason: 'notification_timeout' };
    const task = Promise.resolve().then(() => {
      if (controller.signal.aborted) return;
      return notify({ runDir, reason, alert, env, signal: controller.signal });
    }).then((value) => { if (value) result = value; });
    try {
      await boundedWait(task, options.notificationBudgetMs ?? 15000, controller.signal);
      return shutdownRequested ? { status: 'skipped', reason: 'server_shutdown' } : result;
    } finally {
      notificationAbort.signal.removeEventListener('abort', abort);
      controller.abort(); // Fermer aussi le transport si son délai est dépassé.
    }
  }
  function checkpoint(alert = null) {
    if (alert && (shutdownRequested || stopExpired || stopComplete)) {
      alert.notification = { status: 'skipped', reason: 'server_shutdown' };
      return Promise.resolve();
    }
    writing = writing.then(async () => {
      if (stopExpired || stopComplete) return;
      if (alert && shutdownRequested) { alert.notification = { status: 'skipped', reason: 'server_shutdown' }; return; }
      const report = buildReport(state);
      if (alert) { report.reason = 'threshold'; report.triggeredAlert = alert; }
      await atomicWrite('report.json', JSON.stringify(report));
      if (stopExpired) return;
      await atomicWrite('report.md', renderMarkdown(report));
      // Keep the report pair stable until attachment preparation and sending finish.
      if (alert) {
        alert.notification = await sendNotification('threshold', alert);
      }
    }).catch(() => {
      if (alert) alert.notification = { status: 'failed', reason: 'report_or_notification_failed' };
      warn('report_write_failed');
    });
    return writing;
  }
  function queueThresholdAlert(point) {
    if (stopped || alertTask || pendingAlert) return;
    // Réserver le délai de 5 min dès la détection, même si le rapport est différé.
    const alert = alertGate.take(point);
    if (!alert) return;
    alert.notification = { status: 'pending' };
    state.alerts.push(alert);
    if (state.alerts.length > 128) { state.alerts.shift(); warn('alert_history_budget_exceeded'); }
    const delayMs = measurementStartedAt + alertMinMeasurementMs - Date.now();
    if (delayMs > 0) {
      // Juste après un redémarrage, quelques secondes de mesure ne disent rien : attendre la minute.
      alert.deferredUntil = Date.now() + delayMs;
      pendingAlert = { alert, timer: unref(setTimeout(() => { pendingAlert = null; runThresholdAlert(alert); }, delayMs)) };
      return;
    }
    runThresholdAlert(alert);
  }
  function runThresholdAlert(alert) {
    if (stopped) return;
    alertTask = (async () => {
      const requestedAt = Date.now(), awaiting = [];
      for (const worker of Object.values(cluster.workers || {})) {
        if (state.workers.get(worker.process.pid)?.final) continue;
        awaiting.push(worker.process.pid);
        try { worker.send({ type: MESSAGE, runId, action: 'capture' }, () => {}); } catch { /* Keep last snapshot if unavailable. */ }
      }
      while (!stopped && awaiting.some((pid) => (state.workers.get(pid)?.at || 0) < requestedAt) && Date.now() - requestedAt < 1000) await wait(50);
      await checkpoint(alert);
    })().catch(() => { alert.notification = { status: 'failed', reason: 'alert_failed' }; warn('alert_failed'); })
      .finally(() => { alertTask = null; });
  }
  function beginCollection() {
    if (stopped) return;
    const remainingWarmup = measurementStartedAt - Date.now();
    if (remainingWarmup > 0) { warmupTimer = unref(setTimeout(beginCollection, remainingWarmup)); return; }
    // Le premier relevé sert de référence, jamais de delta depuis le démarrage.
    void sampleSystem();
    sampleTimer = unref(setInterval(() => { void sampleSystem(); }, sampleMs));
  }
  const checkpointTimer = unref(setInterval(() => { void checkpoint(); }, options.checkpointMs || 60000));
  const deadlineTimer = unref(setTimeout(() => { void stop('deadline'); }, Math.max(0, endsAt - Date.now())));
  if (warmupMs) warmupTimer = unref(setTimeout(beginCollection, Math.max(0, measurementStartedAt - Date.now())));
  else beginCollection();
  void checkpoint();
  console.log(`[probe] Mode ${mode} : ${warmupMs / 1000} s exclues, puis ${duration} s de collecte ; rapports : ${runDir}`);

  function stop(reason = 'shutdown') {
    if (stopComplete) return stopPromise;
    // Un SIGTERM doit aussi accélérer une finalisation automatique déjà en cours.
    if (reason === 'shutdown' && !shutdownRequested) {
      shutdownRequested = true;
      state.reason = 'shutdown';
      state.notification = { status: 'skipped', reason: 'server_shutdown' };
      notificationAbort.abort();
      shutdownTimer = setTimeout(() => {
        stopExpired = true; freezeSampling = true;
        warn('shutdown_report_timeout');
        state.finishedAt = Date.now();
        detach();
        console.warn('[probe] Délai d’arrêt atteint ; dernier rapport disponible sur disque.');
        resolveStop?.();
      }, options.shutdownBudgetMs ?? 2000);
    }
    if (stopPromise) return stopPromise;
    stopped = true; clearInterval(sampleTimer); clearInterval(checkpointTimer); clearTimeout(deadlineTimer); clearTimeout(warmupTimer);
    if (pendingAlert) {
      // Arrêt avant la minute de mesure : l'alerte figure dans le rapport final, sans envoi à part.
      clearTimeout(pendingAlert.timer);
      foldedAlert = pendingAlert.alert;
      foldedAlert.notification = { status: 'skipped', reason: 'included_in_final_report' };
      pendingAlert = null;
    }
    stopPromise = new Promise((resolve) => { resolveStop = resolve; });
    void (async () => {
      // Demander le dernier état sans attendre une lecture /proc éventuellement bloquée.
      const awaiting = new Set();
      for (const worker of Object.values(cluster.workers || {})) {
        if (state.workers.get(worker.process.pid)?.final) continue;
        awaiting.add(worker.process.pid);
        try { worker.send({ type: MESSAGE, runId, action: 'stop' }, () => {}); } catch { awaiting.delete(worker.process.pid); }
      }
      const waitStartedAt = Date.now();
      if (sampling && !await boundedWait(sampling, 1000, notificationAbort.signal)) warn('final_system_sample_unavailable');
      if (previousSystem && !shutdownRequested && !stopExpired && !await boundedWait(sampleSystem(), 1000, notificationAbort.signal)) warn('final_system_sample_unavailable');
      freezeSampling = true;
      state.measurementFinishedAt = Date.now();
      while (!stopExpired && [...awaiting].some((pid) => !state.workers.get(pid)?.final && !state.workers.get(pid)?.exitedAt)
        && Date.now() - waitStartedAt < Math.min(options.finalWaitMs ?? 5000, shutdownRequested ? 1000 : 5000)) await wait(50);
      if (stopExpired) return;
      state.reason = shutdownRequested ? 'shutdown' : reason; state.finishedAt = Date.now();
      detach();
      if (alertTask) await boundedWait(alertTask, 16000, notificationAbort.signal);
      if (stopExpired) return;
      await checkpoint();
      if (stopExpired) return;
      state.notification = await sendNotification(state.reason, foldedAlert);
      await checkpoint();
      if (stopExpired) return;
      console.log(`[probe] Rapport ${state.reason === 'deadline' ? 'terminé' : 'partiel'} : ${path.join(runDir, 'report.md')} (Discord: ${state.notification.status})`);
    })().catch(() => { warn('master_stop_failed'); console.warn('[probe] Finalisation incomplète ; consulter le dernier rapport sur disque.'); })
      .finally(() => { stopComplete = true; clearTimeout(shutdownTimer); detach(); resolveStop(); });
    return stopPromise;
  }
  function detach() {
    cluster.removeListener('message', onMessage); cluster.removeListener('exit', onExit);
    cluster.removeListener('fork', onFork);
  }
  return {
    runDir, stop, state,
    get active() { return !stopped; },
    workerEnv: { MAINAPI_PROBE_RUN_ID: runId, MAINAPI_PROBE_STARTS_AT: String(measurementStartedAt),
      MAINAPI_PROBE_ENDS_AT: String(endsAt), MAINAPI_PROBE_MODE: mode },
  };
}

module.exports = { createMasterSession, createWorkerSession, parseDuration, parseMode, MESSAGE };
