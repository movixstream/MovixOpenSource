'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { createMasterSession, createWorkerSession, parseMode } = require('../session');
const { buildReport, renderMarkdown } = require('../report');
const MiB = 1048576;

function state(system = []) {
  return { mode: 'analyse', warmupMs: 300000, startedAt: 1000, measurementStartedAt: 301000,
    endsAt: 3901000, measurementFinishedAt: 321000, finishedAt: 321000, reason: 'shutdown',
    system, workers: new Map(), processes: new Map(), warnings: {}, sampleMs: 5000, snapshotMs: 30000 };
}

test('les modes sont explicites, diagnostic reste le défaut et analysis est accepté', () => {
  assert.equal(parseMode(), 'diagnostic');
  assert.equal(parseMode('diagnostic'), 'diagnostic');
  assert.equal(parseMode(' ANALYSE '), 'analyse');
  assert.equal(parseMode('analysis'), 'analyse');
  assert.throws(() => parseMode('analyze'), /MAINAPI_PROBE_MODE/);
});

test('un worker créé après la chauffe mesure immédiatement sans relancer cinq minutes d’attente', async () => {
  for (const startsAt of [Date.now() + 300000, Date.now() - 1000]) {
    const messages = [];
    const proc = Object.assign(new EventEmitter(), { env: {}, pid: 123, connected: true,
      cpuUsage: () => ({ user: 0, system: 0 }), memoryUsage: () => ({ rss: 100 }),
      send(message, callback) { messages.push(message); callback(); } });
    const worker = createWorkerSession({ runId: 'replacement', startsAt, endsAt: Date.now() + 3600000 },
      { process: proc, instrumentHttp: false });
    const warming = startsAt > Date.now();
    assert.equal(worker.collector.recording, !warming);
    worker.collector.start({ kind: 'http', operation: 'replacement' }).finish();
    await worker.stop();
    const final = messages.at(-1);
    assert.equal(final.final, true);
    assert.equal(final.metrics.groups.length, warming ? 0 : 1);
    assert.equal(final.cpuProfile.active, false);
    if (warming) {
      assert.equal(final.cpuProfile.windows, 0);
      assert.equal(final.resources.length, 0);
    }
  }
});

test('le rapport calcule minimum, moyenne pondérée, P95, pics et dépassements sur chaque durée disponible', () => {
  const report = buildReport(state([
    { at: 306000, elapsedMs: 5000, cpuPercent: 100, cpuUsageUs: 5e6, rxBytes: 100 * MiB, txBytes: null, memoryBytes: MiB },
    { at: 321000, elapsedMs: 15000, cpuPercent: 400, cpuUsageUs: 60e6, rxBytes: 30 * MiB, txBytes: 315 * MiB, memoryBytes: 3 * MiB },
  ]));
  assert.equal(report.mode, 'analyse');
  assert.equal(report.configuration.measurementDurationMs, 3600000);
  assert.equal(report.summary.measurementElapsedMs, 20000);
  assert.deepEqual(report.resourceStats.cpuPercent, {
    samples: 2, coveredMs: 20000, min: 100, minAt: 306000, mean: 325, p95: 400, peak: 400, peakAt: 321000, aboveThresholdMs: 15000,
  });
  assert.equal(report.resourceStats.rxMiBPerSecond.min, 2);
  assert.equal(report.resourceStats.rxMiBPerSecond.mean, 6.5);
  assert.equal(report.resourceStats.rxMiBPerSecond.peak, 20);
  assert.equal(report.resourceStats.rxMiBPerSecond.aboveThresholdMs, 0, 'le seuil exact ne compte pas comme un dépassement');
  assert.equal(report.resourceStats.txMiBPerSecond.coveredMs, 15000);
  assert.equal(report.resourceStats.txMiBPerSecond.mean, 21, 'la réception absente ne supprime pas l’émission');
  assert.equal(report.resourceStats.txMiBPerSecond.aboveThresholdMs, 15000);
  assert.equal(report.resourceStats.memoryBytes.mean, 2.5 * MiB);
  assert.equal(report.summary.networkSentBytes, 315 * MiB);
  assert.match(renderMarkdown(report), /Minimums, moyennes et pics/);
  assert.match(renderMarkdown(report), /100\.0.*325\.0.*400\.0/);
});

test('les mesures absentes ne deviennent pas un minimum nul, et un vrai zéro reste mesuré', () => {
  const report = buildReport(state([
    { at: 306000, elapsedMs: 5000, cpuPercent: null, rxBytes: null, txBytes: 0, memoryBytes: undefined },
    { at: 321000, elapsedMs: 15000, cpuPercent: NaN, rxBytes: undefined, txBytes: 30 * MiB, memoryBytes: null },
  ]));
  assert.equal(report.resourceStats.cpuPercent.min, null);
  assert.equal(report.resourceStats.cpuPercent.coveredMs, 0);
  assert.equal(report.resourceStats.rxMiBPerSecond.mean, null);
  assert.equal(report.resourceStats.memoryBytes.peak, null);
  assert.equal(report.resourceStats.txMiBPerSecond.min, 0);
  assert.equal(report.resourceStats.txMiBPerSecond.mean, 1.5);
  assert.equal(report.summary.networkReceivedBytes, null);
  assert.equal(report.summary.networkSentBytes, 30 * MiB);
  assert.match(renderMarkdown(report), /CPU \(%\).*indisponible/);
});

test('une heure en analyse finit après 65 minutes et un arrêt pendant la chauffe ne publie aucune mesure', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'movix-probe-analysis-warmup-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const cluster = Object.assign(new EventEmitter(), { workers: {} });
  let samples = 0;
  const master = createMasterSession(cluster, {
    env: { MAINAPI_PROBE_SECONDS: '3600', MAINAPI_PROBE_MODE: 'analyse', MAINAPI_PROBE_DIR: directory },
    systemSampler: { sample: async () => { samples++; throw new Error('warmup must not sample'); } },
    notify: async () => ({ status: 'disabled' }),
  });
  t.after(() => master.stop('cleanup'));
  assert.equal(master.state.measurementStartedAt - master.state.startedAt, 300000);
  assert.equal(master.state.endsAt - master.state.startedAt, 3900000);
  assert.equal(Number(master.workerEnv.MAINAPI_PROBE_STARTS_AT), master.state.measurementStartedAt);
  await master.stop('shutdown');
  const report = JSON.parse(await fs.readFile(path.join(master.runDir, 'report.json'), 'utf8'));
  assert.equal(samples, 0);
  assert.equal(report.summary.measurementElapsedMs, 0);
  assert.equal(report.resourceStats.cpuPercent.min, null);
  assert.equal(report.timeline.length, 0);
  assert.equal(report.alerts.length, 0);
});

test('analyse repart des compteurs après la chauffe, alerte ensuite et finalise automatiquement', { timeout: 5000 }, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'movix-probe-analysis-measure-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const cluster = Object.assign(new EventEmitter(), { workers: {} });
  let baseline = null, samples = 0;
  const notifications = [];
  const master = createMasterSession(cluster, {
    env: { MAINAPI_PROBE_SECONDS: '1', MAINAPI_PROBE_MODE: 'analyse', MAINAPI_PROBE_DIR: directory },
    warmupMs: 200, sampleMs: 40, alertMinMeasurementMs: 0,
    systemSampler: { sample: async () => {
      samples++;
      const at = Date.now(); baseline ??= at;
      const elapsed = at - baseline;
      return { at, warnings: [], processes: [],
        network: { rxBytes: 10000 * MiB + elapsed * 25 * MiB / 1000, txBytes: elapsed * MiB / 1000 },
        cgroup: { cpuUsageUs: 1000000000 + elapsed * 3250, memoryBytes: 100 * MiB } };
    } },
    notify: async ({ reason, runDir }) => {
      notifications.push({ reason, report: JSON.parse(await fs.readFile(path.join(runDir, 'report.json'), 'utf8')) });
      return { status: 'sent' };
    },
  });
  t.after(() => master.stop('cleanup'));
  assert.equal(samples, 0);
  while (!master.state.finishedAt) await new Promise((resolve) => setTimeout(resolve, 20));
  await master.stop('deadline');
  const report = JSON.parse(await fs.readFile(path.join(master.runDir, 'report.json'), 'utf8'));
  assert.equal(report.reason, 'deadline');
  assert.ok(report.timeline.every((point) => point.at - point.elapsedMs >= report.measurementStartedAt));
  assert.equal(report.resourceStats.cpuPercent.min, 325);
  assert.equal(report.resourceStats.cpuPercent.peak, 325);
  assert.ok(Math.abs(report.resourceStats.rxMiBPerSecond.mean - 25) < 0.0001);
  assert.ok(report.summary.networkReceivedBytes < 40 * MiB, 'les 10 000 Mio de démarrage ne sont pas comptés');
  assert.deepEqual(notifications.map((entry) => entry.reason), ['threshold', 'deadline']);
  assert.equal(notifications[1].report.mode, 'analyse');
  assert.equal(report.notification.status, 'sent');
});
