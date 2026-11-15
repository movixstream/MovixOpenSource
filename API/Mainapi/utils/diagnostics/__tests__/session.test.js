'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { fork, spawnSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { createMasterSession, createWorkerSession } = require('../session');

const fixture = path.join(__dirname, 'fixtures', 'probe-cluster.cjs');

function cleanProbeEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('MAINAPI_PROBE_')) delete env[key];
  return { ...env, MAINAPI_PROBE_DISCORD_ENABLED: 'false', ...extra };
}

function runFixture(env) {
  return new Promise((resolve, reject) => {
    const child = fork(fixture, [], { env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true; clearTimeout(timeout);
      child.removeListener('error', onError); child.removeListener('exit', onExit); child.removeListener('message', onMessage);
      callback(value);
    };
    const timeout = setTimeout(() => { child.kill(); finish(reject, new Error('fixture timeout')); }, 12000);
    const onError = (error) => finish(reject, error);
    const onExit = (code, signal) => { if (code && !signal) finish(reject, new Error(`fixture exited ${code}`)); };
    const onMessage = (message) => { if (message?.type === 'fixture-result') finish(resolve, { child, message }); };
    child.once('error', onError); child.once('exit', onExit); child.on('message', onMessage);
  });
}

test('cluster de deux workers conserve une échéance, un rapport et des snapshots cumulatifs', { timeout: 15000 }, async (t) => {
  const reportDir = await fs.mkdtemp(path.join(os.tmpdir(), 'movix-probe-'));
  t.after(() => fs.rm(reportDir, { recursive: true, force: true }));
  const { child, message } = await runFixture(cleanProbeEnv({ MAINAPI_PROBE_SECONDS: '2', MAINAPI_PROBE_DIR: reportDir }));
  t.after(() => { if (child.connected) child.disconnect(); if (!child.killed) child.kill(); });
  assert.equal(message.activeWorkers, 2, 'les workers restent vivants après stop de la sonde');
  const [json, markdown] = await Promise.all([
    fs.readFile(path.join(message.runDir, 'report.json'), 'utf8'), fs.readFile(path.join(message.runDir, 'report.md'), 'utf8'),
  ]);
  const report = JSON.parse(json);
  assert.equal(report.reason, 'fixture');
  assert.equal(report.endsAt, message.endsAt);
  assert.ok(message.workerEndsAt.every((endsAt) => endsAt === report.endsAt), 'le remplacement conserve l’échéance absolue');
  assert.equal(report.summary.workers, 3, 'un remplacement conserve les données du worker arrêté');
  assert.equal(report.summary.outboundCalls, 3, 'les snapshots cumulés et dupliqués ne doublent pas les appels');
  assert.ok(report.workers.some((worker) => worker.exitedAt), 'le worker remplacé reste visible');
  assert.ok(report.workers.filter((worker) => !worker.exitedAt).every((worker) => worker.final), 'les workers encore vivants ont arrêté hooks et profileurs');
  assert.match(markdown, /Rapport de ressources Main API/);
});

test('worker sans callback IPC ne publie qu’une fois et stop reste borné', { timeout: 6000 }, async () => {
  class FakeProcess extends EventEmitter {
    constructor() { super(); this.env = { MOVIX_WORKER_SLOT: '0' }; this.pid = 4242; this.connected = true; this.sends = 0; }
    send() { this.sends += 1; }
    cpuUsage() { return { user: 0, system: 0 }; }
    memoryUsage() { return { rss: 1, heapTotal: 1, heapUsed: 1, external: 0, arrayBuffers: 0 }; }
  }
  const proc = new FakeProcess();
  const session = createWorkerSession({ runId: 'blocked-ipc', endsAt: Date.now() + 10000 }, {
    process: proc, instrumentHttp: false, sampleMs: 100, snapshotMs: 100,
    cpuOptions: { profileMs: 60000, intervalMs: 60000 },
  });
  await new Promise((resolve) => setTimeout(resolve, 1700));
  assert.equal(proc.sends, 1);
  const started = Date.now();
  await session.stop();
  assert.ok(Date.now() - started <= 2000);
  assert.equal(session.collector.active, false);
  assert.equal(proc.listenerCount('message'), 0);
});

function measuringProcess() {
  const messages = [];
  const proc = Object.assign(new EventEmitter(), { env: { MOVIX_WORKER_SLOT: '0' }, pid: 5151, connected: true, messages,
    cpuUsage: () => ({ user: 0, system: 0 }), memoryUsage: () => ({ rss: 100, heapTotal: 1, heapUsed: 1, external: 0, arrayBuffers: 0 }),
    send(message, callback) { messages.push(message); callback(); } });
  return proc;
}
const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
const fakeLag = () => ({ enable() {}, disable() {}, reset() { this.resets++; }, resets: 0, percentile: () => 25e6, max: 32e6 });

test('une capture juste après le relevé régulier ne crée pas de point de quelques ms', { timeout: 5000 }, async () => {
  const proc = measuringProcess();
  const capture = () => proc.emit('message', { type: 'mainapi-resource-probe-v1', runId: 'capture', action: 'capture' });
  const session = createWorkerSession({ runId: 'capture', startsAt: Date.now() - 1, endsAt: Date.now() + 10000 }, {
    process: proc, instrumentHttp: false, sampleMs: 1000, snapshotMs: 60000, eventLoopMonitor: fakeLag(),
    cpuOptions: { profileMs: 60000, intervalMs: 60000, sessionFactory: () => ({ connect() { throw new Error('off'); }, disconnect() {}, post() {} }) },
  });
  await settle();
  capture();
  await settle();
  assert.equal(proc.messages.length, 2, 'la capture publie quand même un état frais');
  assert.deepEqual(proc.messages[1].resources, [], 'pas de point de capture moins de sampleMs/5 après le dernier relevé');
  await settle(300);
  capture();
  await settle();
  const [point] = proc.messages[2].resources;
  assert.equal(point.capture, true);
  assert.ok(point.elapsedMs >= 200);
  await session.stop();
});

test('le retard de boucle retire la résolution et garde un blocage qui retarde le relevé', { timeout: 5000 }, async () => {
  const proc = measuringProcess();
  const lag = fakeLag();
  const session = createWorkerSession({ runId: 'lag', startsAt: Date.now() - 1, endsAt: Date.now() + 10000 }, {
    process: proc, instrumentHttp: false, sampleMs: 100, snapshotMs: 60000, eventLoopMonitor: lag,
    cpuOptions: { profileMs: 60000, intervalMs: 60000, sessionFactory: () => ({ connect() { throw new Error('off'); }, disconnect() {}, post() {} }) },
  });
  await settle(10);
  const blockedUntil = Date.now() + 300;
  while (Date.now() < blockedUntil) { /* blocage synchrone du thread principal */ }
  await settle(30);
  await session.stop();
  const points = proc.messages.flatMap((message) => message.resources);
  const regular = points.find((point) => point.eventLoopTimerLateMs !== null);
  assert.ok(regular, JSON.stringify(points));
  assert.equal(regular.eventLoopP99Ms, 5, 'p99 de 25 ms brut = 5 ms de retard réel');
  assert.ok(regular.eventLoopTimerLateMs >= 150, `retard du minuteur ${regular.eventLoopTimerLateMs}`);
  assert.ok(regular.eventLoopMaxMs >= regular.eventLoopTimerLateMs, 'le blocage n’est pas effacé par reset()');
  assert.ok(regular.gc && Number.isFinite(regular.gc.durationMs));
  assert.ok(regular.heap.spaces.old_space.usedBytes > 0);
  assert.ok(lag.resets >= 1);
});

test('une alerte dès les premières secondes attend une minute de mesure et garde le délai de 5 min', { timeout: 5000 }, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'movix-probe-deferred-'));
  const cluster = Object.assign(new EventEmitter(), { workers: {} });
  const calls = [];
  let samples = 0;
  const master = createMasterSession(cluster, {
    env: cleanProbeEnv({ MAINAPI_PROBE_SECONDS: '20', MAINAPI_PROBE_DIR: directory }), sampleMs: 15, alertMinMeasurementMs: 400,
    systemSampler: { sample: async () => ({ at: Date.now(), warnings: [], processes: [], network: null, cgroup: { cpuUsageUs: ++samples * 60e6 } }) },
    notify: async (request) => {
      calls.push({ reason: request.reason, report: JSON.parse(await fs.readFile(path.join(request.runDir, 'report.json'), 'utf8')) });
      return { status: 'sent' };
    },
  });
  t.after(async () => { await master.stop('cleanup'); await fs.rm(directory, { recursive: true, force: true }); });
  await settle(150);
  assert.equal(master.state.alerts.length, 1, 'alerte enregistrée dès la détection');
  assert.equal(master.state.alerts[0].notification.status, 'pending');
  assert.ok(master.state.alerts[0].deferredUntil >= master.state.measurementStartedAt + 400);
  assert.equal(calls.length, 0, 'aucun rapport de 5 s');
  const deadline = Date.now() + 2000;
  while (!calls.length && Date.now() < deadline) await settle();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].reason, 'threshold');
  assert.ok(calls[0].report.summary.measurementElapsedMs >= 400);
  assert.match(await fs.readFile(path.join(master.runDir, 'report.md'), 'utf8'), /rapport différé.*rapport final prévu/);
  assert.equal(master.state.alerts.length, 1, 'le délai de 5 min a été réservé à la détection');
});

test('un arrêt avant la minute de mesure inclut l’alerte dans le rapport final sans bloquer stop', { timeout: 5000 }, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'movix-probe-folded-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const cluster = Object.assign(new EventEmitter(), { workers: {} });
  const calls = [];
  let samples = 0;
  const master = createMasterSession(cluster, {
    env: cleanProbeEnv({ MAINAPI_PROBE_SECONDS: '20', MAINAPI_PROBE_DIR: directory }), sampleMs: 15, finalWaitMs: 10,
    systemSampler: { sample: async () => ({ at: Date.now(), warnings: [], processes: [], network: null, cgroup: { cpuUsageUs: ++samples * 60e6 } }) },
    notify: async (request) => { calls.push(request); return { status: 'sent' }; },
  });
  while (!master.state.alerts.length) await settle(10);
  const started = Date.now();
  await master.stop('deadline');
  assert.ok(Date.now() - started < 2000);
  assert.deepEqual(calls.map((call) => call.reason), ['deadline']);
  assert.ok(calls[0].alert, 'le message final mentionne l’alerte incluse');
  const report = JSON.parse(await fs.readFile(path.join(master.runDir, 'report.json'), 'utf8'));
  assert.deepEqual(report.alerts[0].notification, { status: 'skipped', reason: 'included_in_final_report' });
  assert.equal(report.schemaVersion, 4);
});

test('master signale les workers attendus sans snapshot', { timeout: 5000 }, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'movix-probe-expected-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const cluster = new EventEmitter();
  const pid = 8765;
  cluster.workers = { one: { process: { pid }, send(_message, callback) { callback?.(); } } };
  const master = createMasterSession(cluster, {
    env: cleanProbeEnv({ MAINAPI_PROBE_SECONDS: '1', MAINAPI_PROBE_DIR: directory }), sampleMs: 100, checkpointMs: 100, finalWaitMs: 10,
    systemSampler: { sample: async () => ({ at: Date.now(), warnings: [], network: null, cgroup: null, processes: null }) }, notify: async () => ({ status: 'disabled' }),
  });
  await master.stop('test');
  const report = JSON.parse(await fs.readFile(path.join(master.runDir, 'report.json'), 'utf8'));
  assert.equal(report.summary.workers, 0);
  assert.deepEqual(report.summary.workersWithoutFinal, [pid]);
});

test('un pic capture les workers et envoie un rapport intermédiaire sans bloquer le rapport final', { timeout: 5000 }, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'movix-probe-alert-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const cluster = new EventEmitter();
  const calls = [];
  let samples = 0, captures = 0, master;
  let alertDelivered;
  const delivered = new Promise((resolve) => { alertDelivered = resolve; });
  const worker = { process: { pid: 7654 }, send(message, callback) {
    if (message.action === 'capture') captures++;
    cluster.emit('message', worker, { type: message.type, runId: message.runId, action: 'snapshot', at: Date.now(),
      slot: 0, final: message.action === 'stop', metrics: { groups: [], sockets: [], warnings: {} }, resources: [] });
    callback?.();
  } };
  cluster.workers = { one: worker };
  master = createMasterSession(cluster, {
    env: cleanProbeEnv({ MAINAPI_PROBE_SECONDS: '20', MAINAPI_PROBE_DIR: directory }), sampleMs: 15, alertMinMeasurementMs: 0,
    systemSampler: { sample: async () => ({ at: 100000 + (++samples * 5000), warnings: [], processes: [],
      network: { rxBytes: samples * 105 * 1048576, txBytes: 0 }, cgroup: { cpuUsageUs: samples * 16e6 } }) },
    notify: async (request) => {
      const report = JSON.parse(await fs.readFile(path.join(request.runDir, 'report.json'), 'utf8'));
      calls.push({ request, report });
      if (request.reason === 'threshold') alertDelivered();
      return { status: 'sent', httpStatus: 200 };
    },
  });
  t.after(() => master.stop('test-cleanup'));
  await delivered;
  assert.equal(master.active, true);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(calls.length, 1);
  assert.equal(captures, 1);
  assert.equal(calls[0].request.reason, 'threshold');
  assert.equal(calls[0].report.finishedAt, null);
  assert.deepEqual(calls[0].report.triggeredAlert.triggers, ['network-rx', 'cpu']);
  assert.equal(calls[0].report.workers.length, 1);
  await master.stop('deadline');
  assert.deepEqual(calls.map((call) => call.request.reason), ['threshold', 'deadline']);
  const final = JSON.parse(await fs.readFile(path.join(master.runDir, 'report.json'), 'utf8'));
  assert.equal(final.reason, 'deadline');
  assert.equal(final.alerts.length, 1);
  assert.equal(final.alerts[0].notification.status, 'sent');
  assert.equal(final.notification.status, 'sent');
});

test('échéance automatique finalise les workers sans arrêter le processus cluster', { timeout: 10000 }, async (t) => {
  const reportDir = await fs.mkdtemp(path.join(os.tmpdir(), 'movix-probe-deadline-'));
  t.after(() => fs.rm(reportDir, { recursive: true, force: true }));
  const { child, message } = await runFixture(cleanProbeEnv({ MAINAPI_PROBE_SECONDS: '1', MAINAPI_PROBE_DIR: reportDir, FIXTURE_PROBE_DEADLINE: '1' }));
  t.after(() => { if (child.connected) child.disconnect(); if (!child.killed) child.kill(); });
  const report = JSON.parse(await fs.readFile(path.join(message.runDir, 'report.json'), 'utf8'));
  assert.equal(message.reason, 'deadline');
  assert.equal(report.reason, 'deadline');
  assert.equal(message.activeWorkers, 2);
  assert.ok(report.workers.filter((worker) => !worker.exitedAt).every((worker) => worker.final));
  assert.ok(message.workerEndsAt.every((endsAt) => endsAt === report.endsAt));
});

test('bridge inerte et worker de remplacement expiré ne créent pas de timer ou hook', () => {
  const index = path.resolve(__dirname, '..', 'index.js').replace(/\\/g, '\\\\');
  const code = `let timers=0; const original=setTimeout; global.setTimeout=(...args)=>{timers++; return original(...args)}; const p=require('${index}'); const disabled=p.startProbe({isPrimary:false},{env:{MAINAPI_PROBE_SECONDS:'2',MAINAPI_PROBE_RUN_ID:'x',MAINAPI_PROBE_ENDS_AT:'1'}}); if(disabled.active||timers) process.exit(1);`;
  const result = spawnSync(process.execPath, ['-e', code], { env: cleanProbeEnv(), encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
});

test('analyse conserve la fenêtre commune et exclut la chauffe dans un vrai cluster avec remplacement', { timeout: 10000 }, async (t) => {
  const reportDir = await fs.mkdtemp(path.join(os.tmpdir(), 'movix-probe-analysis-cluster-'));
  t.after(() => fs.rm(reportDir, { recursive: true, force: true }));
  const { child, message } = await runFixture(cleanProbeEnv({ MAINAPI_PROBE_SECONDS: '2', MAINAPI_PROBE_MODE: 'analyse',
    MAINAPI_PROBE_DIR: reportDir, FIXTURE_ANALYSIS: '1', FIXTURE_PROBE_DEADLINE: '1' }));
  t.after(() => { if (child.connected) child.disconnect(); if (!child.killed) child.kill(); });
  const report = JSON.parse(await fs.readFile(path.join(message.runDir, 'report.json'), 'utf8'));
  assert.equal(report.mode, 'analyse');
  assert.equal(report.reason, 'deadline');
  assert.equal(report.configuration.measurementDurationMs, 2000);
  assert.equal(report.summary.workers, 3);
  assert.equal(report.summary.outboundCalls, 2);
  assert.ok(report.groups.every((group) => group.operation === 'after-warmup'));
  assert.ok(message.workerStartsAt.every((at) => at === report.measurementStartedAt));
  assert.ok(message.workerEndsAt.every((at) => at === report.endsAt));
  assert.ok(report.workers.flatMap((worker) => worker.resources).every((point) => point.at >= report.measurementStartedAt));
  assert.ok(report.workers.filter((worker) => !worker.exitedAt).every((worker) => worker.final));
  assert.equal(message.activeWorkers, 2);
});

test('répertoire de rapport invalide échoue ouvert via le bridge', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'movix-probe-file-'));
  const file = path.join(root, 'not-a-directory');
  await fs.writeFile(file, 'x');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const index = path.resolve(__dirname, '..', 'index.js').replace(/\\/g, '\\\\');
  const code = `const p=require('${index}'); const result=p.startProbe({isPrimary:true,on(){},removeListener(){},workers:{}},{env:{MAINAPI_PROBE_SECONDS:'1',MAINAPI_PROBE_DIR:${JSON.stringify(file)},MAINAPI_PROBE_DISCORD_ENABLED:'false'}}); if(result.active) process.exit(1);`;
  const result = spawnSync(process.execPath, ['-e', code], { env: cleanProbeEnv(), encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
});
