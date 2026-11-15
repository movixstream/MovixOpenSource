'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createMasterSession } = require('../session');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const forever = () => new Promise(() => {});

async function until(predicate) {
  const deadline = Date.now() + 1500;
  while (!await predicate()) {
    if (Date.now() > deadline) throw new Error('condition timeout');
    await delay(10);
  }
}
async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'movix-probe-stop-'));
  const cluster = Object.assign(new EventEmitter(), { workers: {} });
  const master = createMasterSession(cluster, {
    env: { MAINAPI_PROBE_SECONDS: '3600', MAINAPI_PROBE_DIR: directory },
    shutdownBudgetMs: 300, finalWaitMs: 0, sampleMs: 20, alertMinMeasurementMs: 0,
    systemSampler: { sample: async () => ({ at: Date.now(), warnings: [], processes: [], network: null, cgroup: null }) },
    notify: async () => ({ status: 'disabled' }), ...options,
  });
  t.after(async () => {
    await Promise.race([master.stop('shutdown'), delay(700)]);
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { master, cluster, json: path.join(master.runDir, 'report.json') };
}
async function quickStop(master) {
  assert.equal(await Promise.race([master.stop('shutdown').then(() => true), delay(700).then(() => false)]), true,
    'l’arrêt doit respecter son budget même si une dépendance ne répond jamais');
}

test('une lecture système bloquée n’empêche ni l’arrêt ni le rapport local', async (t) => {
  const f = await fixture(t, { systemSampler: { sample: forever }, notify: () => { throw new Error('no Discord on shutdown'); } });
  await quickStop(f.master);
  const report = JSON.parse(await fs.readFile(f.json, 'utf8'));
  assert.equal(report.reason, 'shutdown');
  assert.equal(report.notification.reason, 'server_shutdown');
  assert.equal(f.cluster.listenerCount('message'), 0);
  assert.equal(f.master.active, false);
});

test('une alerte Discord suspendue est annulée et ne retarde pas le rapport partiel', async (t) => {
  let signal, tick = 0, sends = 0;
  const f = await fixture(t, {
    systemSampler: { sample: async () => ({ at: ++tick * 5000, warnings: [], processes: [], network: null,
      cgroup: { cpuUsageUs: tick * 20e6 } }) },
    notify: (request) => { sends++; signal = request.signal; return forever(); },
  });
  await until(() => signal);
  await quickStop(f.master);
  assert.equal(signal.aborted, true);
  assert.equal(sends, 1, 'aucun nouvel envoi final au moment d’éteindre le serveur');
  const report = JSON.parse(await fs.readFile(f.json, 'utf8'));
  assert.equal(report.reason, 'shutdown');
  assert.equal(report.alerts[0].notification.reason, 'server_shutdown');
});

test('un arrêt manuel accélère aussi une finalisation automatique déjà en cours et reste idempotent', async (t) => {
  let signal;
  const f = await fixture(t, { notify: (request) => { signal = request.signal; return forever(); } });
  const automatic = f.master.stop('deadline');
  await until(() => signal);
  assert.equal(f.master.stop('shutdown'), automatic);
  await quickStop(f.master);
  assert.equal(signal.aborted, true);
  assert.equal(JSON.parse(await fs.readFile(f.json, 'utf8')).reason, 'shutdown');
  await f.master.stop('shutdown');
  await delay(350);
  assert.equal(f.master.state.warnings.shutdown_report_timeout, undefined, 'un arrêt terminé ne recrée pas de timer');
});

test('une capture d’alerte retardée ne remplace pas le rapport d’arrêt par un rapport intermédiaire', async (t) => {
  let tick = 0, sends = 0;
  const f = await fixture(t, {
    systemSampler: { sample: async () => ({ at: ++tick * 5000, warnings: [], processes: [], network: null,
      cgroup: { cpuUsageUs: tick * 20e6 } }) },
    notify: async () => { sends++; return { status: 'sent' }; },
  });
  f.cluster.workers.one = { process: { pid: 9876 }, send() {} };
  await until(() => f.master.state.alerts.length);
  await quickStop(f.master);
  await delay(100);
  assert.equal(JSON.parse(await fs.readFile(f.json, 'utf8')).reason, 'shutdown');
  assert.equal(sends, 0);
});

test('une écriture bloquée respecte le budget et conserve le dernier rapport publié', async (t) => {
  const f = await fixture(t);
  await until(async () => (await fs.readFile(f.json, 'utf8')).includes('schemaVersion'));
  const before = await fs.readFile(f.json, 'utf8');
  const write = fs.writeFile;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  fs.writeFile = (file, ...args) => String(file).startsWith(f.master.runDir)
    ? gate.then(() => write(file, ...args)) : write(file, ...args);
  try {
    await quickStop(f.master);
    assert.equal(f.master.state.warnings.shutdown_report_timeout, 1);
    assert.equal(await fs.readFile(f.json, 'utf8'), before);
  } finally {
    fs.writeFile = write;
    release();
  }
  await delay(80);
  assert.equal(await fs.readFile(f.json, 'utf8'), before, 'une écriture tardive ne remplace pas le dernier fichier fiable');
});
