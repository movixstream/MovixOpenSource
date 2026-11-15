'use strict';

const { LATENCY_BUCKETS_MS } = require('./collector');
const { ALERT_THRESHOLDS, describeThresholdAlert } = require('./alerts');
const finite = (value) => Number.isFinite(value) ? value : 0;
const total = (rows, field) => rows.reduce((sum, row) => sum + finite(row[field]), 0);
const escape = (value) => String(value ?? '—').replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|').replace(/`/g, "'");
const mib = (value) => (finite(value) / 1048576).toFixed(2);
const number = (value) => finite(value).toFixed(1);
const redirects = (row) => [301, 302, 303, 307, 308].reduce((sum, status) => sum + finite(row.statuses?.[status]), 0);
const maxOf = (values) => values.reduce((max, value) => Number.isFinite(value) && (max === null || value > max) ? value : max, null);
const orNa = (value, format = number) => value === null || value === undefined ? 'n/d' : format(value);

// 4xx (dont 404 = « pas de contenu », réponse normale d'une source vide), 5xx, et le reste des
// erreurs : abandon du client ou erreur de transport, sans statut HTTP d'erreur.
function statusClasses(row) {
  let client = 0, notFound = 0, server = 0;
  for (const [status, count] of Object.entries(row.statuses || {})) {
    const code = Number(status);
    if (code >= 400 && code < 500) { client += finite(count); if (code === 404) notFound += finite(count); }
    else if (code >= 500 && code < 600) server += finite(count);
  }
  return { client, notFound, server, other: Math.max(0, finite(row.failed) - client - server) };
}

// Un relevé de quelques ms (capture d'alerte, arrêt) divise un petit CPU par une durée minuscule :
// les pics ne portent que sur les relevés d'au moins une demi-période.
function regularPoints(worker, sampleMs) {
  return (worker.resources || []).filter((point) => finite(point.elapsedMs) >= (sampleMs || 5000) / 2);
}

function gcSummary(worker, sampleMs) {
  const points = worker.resources || [];
  const measured = points.filter((point) => point.gc);
  if (!measured.length) return null;
  const byKind = {};
  for (const point of measured) for (const [kind, row] of Object.entries(point.gc.byKind || {})) {
    byKind[kind] ||= { count: 0, durationMs: 0 };
    byKind[kind].count += finite(row.count); byKind[kind].durationMs += finite(row.durationMs);
  }
  const durationMs = total(measured.map((point) => point.gc), 'durationMs');
  const coveredMs = total(measured, 'elapsedMs');
  return { durationMs, count: total(measured.map((point) => point.gc), 'count'), byKind,
    sharePercent: coveredMs ? durationMs * 100 / coveredMs : null,
    peakPerSampleMs: maxOf(regularPoints({ resources: measured }, sampleMs).map((point) => finite(point.gc.durationMs))) };
}

function aggregateDestinations(groups) {
  const destinations = new Map();
  for (const group of groups) {
    const key = JSON.stringify([group.kind, group.destination, group.byteMode]);
    if (!destinations.has(key)) destinations.set(key, { kind: group.kind, destination: group.destination, byteMode: group.byteMode,
      started: 0, completed: 0, failed: 0, redirects: 0, sentBytes: 0, receivedBytes: 0, unknownResponses: 0,
      durationMs: 0, detailLimitedCalls: 0, pids: new Set() });
    const row = destinations.get(key);
    for (const field of ['started', 'completed', 'failed', 'sentBytes', 'receivedBytes', 'unknownResponses', 'durationMs']) row[field] += finite(group[field]);
    row.redirects += redirects(group);
    if (group.aggregation && group.aggregation !== 'operation') row.detailLimitedCalls += finite(group.started);
    for (const pid of group.pids || []) row.pids.add(pid);
  }
  return [...destinations.values()].map((row) => ({ ...row, pids: [...row.pids] })).sort((a, b) => b.receivedBytes - a.receivedBytes);
}

function percentile(histogram, ratio = 0.95) {
  const threshold = histogram.reduce((sum, n) => sum + n, 0) * ratio;
  if (!threshold) return null;
  let seen = 0;
  for (let index = 0; index < histogram.length; index++) {
    seen += histogram[index];
    if (seen >= threshold) return LATENCY_BUCKETS_MS[index];
  }
  return null;
}

function aggregateGroups(workers) {
  const grouped = new Map();
  for (const worker of workers) for (const entry of worker.metrics?.groups || []) {
    const key = JSON.stringify([entry.kind, entry.source, entry.destination, entry.operation, entry.byteMode]);
    let row = grouped.get(key);
    if (!row) {
      row = { ...entry, pids: [], statuses: {}, histogram: LATENCY_BUCKETS_MS.map(() => 0) };
      for (const field of ['started', 'completed', 'failed', 'sentBytes', 'receivedBytes', 'unknownResponses', 'durationMs', 'rows', 'maxDurationMs', 'maxReceivedBytes']) row[field] = 0;
      grouped.set(key, row);
    }
    row.pids.push(worker.pid);
    for (const field of ['started', 'completed', 'failed', 'sentBytes', 'receivedBytes', 'unknownResponses', 'durationMs', 'rows']) row[field] += finite(entry[field]);
    for (const field of ['maxDurationMs', 'maxReceivedBytes']) row[field] = Math.max(row[field], finite(entry[field]));
    for (const [status, count] of Object.entries(entry.statuses || {})) row.statuses[status] = (row.statuses[status] || 0) + count;
    entry.histogram?.forEach((n, index) => { row.histogram[index] += n; });
  }
  return [...grouped.values()].map((row) => ({ ...row, unfinished: row.started - row.completed,
    meanDurationMs: row.completed ? row.durationMs / row.completed : null, p95UpperBoundMs: percentile(row.histogram) }));
}

function resourceStatistics(points, read, threshold = null) {
  const values = points.map((point) => ({ at: point.at, elapsedMs: point.elapsedMs, value: read(point) }))
    .filter((point) => Number.isFinite(point.value) && point.value >= 0 && Number.isFinite(point.elapsedMs) && point.elapsedMs > 0);
  const coveredMs = total(values, 'elapsedMs');
  if (!values.length) return { samples: 0, coveredMs: 0, min: null, mean: null, p95: null, peak: null,
    minAt: null, peakAt: null, aboveThresholdMs: null };
  const sorted = values.slice().sort((a, b) => a.value - b.value);
  let seenMs = 0;
  const p95 = sorted.find((point) => { seenMs += point.elapsedMs; return seenMs >= coveredMs * 0.95; }).value;
  return { samples: values.length, coveredMs, min: sorted[0].value, minAt: sorted[0].at,
    mean: values.reduce((sum, point) => sum + point.value * point.elapsedMs, 0) / coveredMs,
    p95, peak: sorted[sorted.length - 1].value, peakAt: sorted[sorted.length - 1].at,
    aboveThresholdMs: threshold === null ? null : total(values.filter((point) => point.value > threshold), 'elapsedMs') };
}

function buildReport(state) {
  const workers = [...state.workers.values()];
  const groups = aggregateGroups(workers);
  const system = state.system;
  const sockets = new Map();
  for (const worker of workers) for (const entry of worker.metrics?.sockets || []) {
    if (!sockets.has(entry.label)) sockets.set(entry.label, { label: entry.label, receivedBytes: 0, sentBytes: 0, connections: 0 });
    const row = sockets.get(entry.label);
    for (const field of ['receivedBytes', 'sentBytes', 'connections']) row[field] += entry[field];
  }
  const availableRx = system.filter((sample) => Number.isFinite(sample.rxBytes));
  const availableTx = system.filter((sample) => Number.isFinite(sample.txBytes));
  const rate = (sample, field) => Number.isFinite(sample[field]) ? sample[field] * 1000 / sample.elapsedMs / 1048576 : null;
  const resourceStats = {
    cpuPercent: resourceStatistics(system, (sample) => sample.cpuPercent, ALERT_THRESHOLDS.cpuPercent),
    rxMiBPerSecond: resourceStatistics(system, (sample) => rate(sample, 'rxBytes'), ALERT_THRESHOLDS.networkMiBPerSecond),
    txMiBPerSecond: resourceStatistics(system, (sample) => rate(sample, 'txBytes'), ALERT_THRESHOLDS.networkMiBPerSecond),
    memoryBytes: resourceStatistics(system, (sample) => sample.memoryBytes),
  };
  const generatedAt = Date.now();
  const measurementStartedAt = state.measurementStartedAt ?? state.startedAt;
  const measurementElapsedMs = Math.max(0, Math.min(state.endsAt,
    state.measurementFinishedAt ?? state.finishedAt ?? generatedAt) - measurementStartedAt);
  const inboundCalls = total(groups.filter((group) => group.kind === 'inbound'), 'started');
  const outboundCalls = total(groups.filter((group) => ['http', 'fetch', 'cycletls', 'impit'].includes(group.kind)), 'started');
  const report = {
    // v4 : retard de boucle net de la résolution, pauses GC, tas V8, smaps_rollup, démarrages du profileur.
    schemaVersion: 4, generatedAt, startedAt: state.startedAt, endsAt: state.endsAt,
    mode: state.mode || 'diagnostic', measurementStartedAt, measurementFinishedAt: state.measurementFinishedAt ?? null,
    finishedAt: state.finishedAt || null, reason: state.reason || 'running', runDir: state.runDir,
    notification: state.notification || { status: 'pending' },
    alerts: state.alerts || [],
    configuration: { mode: state.mode || 'diagnostic', warmupMs: state.warmupMs || 0,
      measurementDurationMs: state.endsAt - measurementStartedAt, resourceIntervalMs: state.sampleMs, snapshotIntervalMs: state.snapshotMs,
      cpuProfileWindowMs: 5000, cpuProfileIntervalMs: 60000, cpuSamplingIntervalUs: 10000, cpuProfileStartGapMs: 1500,
      eventLoopResolutionMs: 20, alertMinMeasurementMs: state.alertMinMeasurementMs ?? 60000, alertThresholds: ALERT_THRESHOLDS },
    coverage: [
      'HTTP/HTTPS Node et fetch/Undici : appels, durées et corps encodés lorsque disponibles (avant décompression).',
      'CycleTLS/Impit : corps déjà décodés. Les réponses CycleTLS converties en objet ne sont pas resérialisées ; octets inconnus signalés.',
      'Redis : valeurs des réponses (entiers compris) et estimation des commandes ; EVAL libellé par script et famille de KEYS[1] ; MySQL : texte SQL envoyé, lignes et durée, sans taille des résultats par requête.',
      'Sockets Node : deltas bytesRead/bytesWritten depuis leur observation, sans attribution aux requêtes sur connexion partagée. TLS/proxies peuvent modifier leur sens. « Sockets observées » = sockets déjà ouvertes au début de la mesure + nouvelles sockets, pas seulement des connexions neuves.',
      'Conteneur Linux : interfaces hors loopback, CPU cgroup et descendants du master dont CycleTLS. Données absentes = null, jamais zéro.',
      'Durées des appels = temps écoulé cumulé, avec chevauchement possible ; elles ne mesurent pas le CPU de chaque appel. Moyennes ms = appels terminés seulement ; « En cours » = appels lancés et pas encore terminés au moment du rapport.',
      'Profils V8 : fenêtres de 5 s/minute/worker, la première dès le début de la mesure, démarrages décalés de 1,5 s entre slots (jamais deux à la fois) ; temps échantillonné, idle compris, sans profil natif Go/Rust ni extrapolation sur toute l’heure. Chaque Profiler.start bloque le worker pendant que V8 parcourt le tas : durée mesurée à part (« Démarrage profileur »), à ne pas attribuer à l’application.',
      'Origine « background after <route> » : appel lancé après l’envoi des en-têtes de la réponse (travail détaché, ex. rafraîchissement sans attente). « background/startup » : tâche sans requête mesurée, ou chaîne lancée pendant la chauffe.',
      'Workers : pics CPU et p99 calculés sur les relevés d’au moins une demi-période (les relevés de quelques ms d’une capture d’alerte sont exclus). Retard de boucle net de la résolution de 20 ms ; « Pic blocage » inclut le retard du minuteur de relevé, qu’un reset de l’histogramme effacerait.',
      'GC : pauses du thread principal par type (perf_hooks), tas V8 par espace, malloc et mémoire externe ; sous Linux, /proc/self/smaps_rollup (Private_Dirty = mémoire privée, Shared_Clean = pages partagées comptées dans chaque RSS).',
      'Rapport d’alerte : délai de 5 min réservé dès la détection, mais rapport envoyé après au moins une minute de mesure ; une alerte détectée juste avant la fin est incluse dans le rapport final.',
      'Clés/URL/SQL normalisés ; 1024 groupes détaillés/worker puis 256 groupes par destination, type et unité ; au-delà, totaux par type/unité avec avertissement. Aucun mélange HTTP/Redis/SQL.',
      '40 appels les plus lourds par critère et worker, avec les libellés propres à chaque appel même après saturation du détail. Les totaux par destination regroupent le détail sans le compter deux fois.',
      'Redirections 301/302/303/307/308 séparées des erreurs ; les corps de redirection abandonnés volontairement par le client sont signalés comme non entièrement mesurés.',
      'Les corps, valeurs Redis, sockets et compteurs du conteneur sont des vues différentes : ne pas additionner leurs octets.',
      'Les flux déjà ouverts avant la sonde, HTTP/2 natif hors adaptateurs, WebSockets et autres bibliothèques natives ne sont pas attribués par requête.',
      'Mode analyse : cinq minutes de chauffe exclues des appels, octets, ressources, profils et alertes. Une requête commencée avant la mesure reste exclue des agrégats par appel même si elle se termine après. Les sockets et le conteneur mesurent tout le trafic après cette limite à partir de leurs compteurs courants.',
      'Minimums, pics et P95 CPU/réseau portent sur des intervalles d’environ cinq secondes, pas sur des pics instantanés. Moyennes et P95 pondérés par la durée réelle des intervalles disponibles ; durée observée précisée pour chaque mesure.',
      'Pour évaluer une optimisation, comparer des durées et trafics similaires, ainsi que les appels sortants par requête entrante. Un ancien rapport incluant le démarrage n’est pas directement comparable ; ce rapport seul ne prouve pas un gain.',
    ],
    summary: {
      workers: workers.length, expectedWorkers: state.expectedWorkers?.size ?? workers.length,
      workersWithoutFinal: [...(state.expectedWorkers || state.workers.keys())].filter((pid) => !state.workers.get(pid)?.final),
      outboundCalls, inboundCalls, measurementElapsedMs,
      inboundRequestsPerSecond: measurementElapsedMs ? inboundCalls * 1000 / measurementElapsedMs : null,
      outboundCallsPerInboundRequest: inboundCalls ? outboundCalls / inboundCalls : null,
      networkReceivedBytes: availableRx.length ? total(availableRx, 'rxBytes') : null,
      networkSentBytes: availableTx.length ? total(availableTx, 'txBytes') : null,
      containerCpuMinPercent: resourceStats.cpuPercent.min,
      containerCpuMeanPercent: resourceStats.cpuPercent.mean,
      containerCpuPeakPercent: resourceStats.cpuPercent.peak,
    },
    resourceStats,
    warnings: state.warnings,
    groups, destinations: aggregateDestinations(groups), sockets: [...sockets.values()].sort((a, b) => b.receivedBytes - a.receivedBytes),
    processes: [...state.processes.values()].sort((a, b) => b.cpuUsageUs - a.cpuUsageUs),
    workers, timeline: system,
  };
  return report;
}

function renderMarkdown(report) {
  const date = (value) => value ? new Date(value).toISOString() : 'en cours';
  const rows = [
    '# Rapport de ressources Main API', '',
    `Du ${date(report.startedAt)} au ${date(report.finishedAt || report.generatedAt)}. État : **${escape(report.reason)}**.`, '',
    `Mode : **${escape(report.mode || 'diagnostic')}**. Démarrage exclu : ${number((report.configuration.warmupMs || 0) / 60000)} min. Mesure prévue du ${date(report.measurementStartedAt)} au ${date(report.endsAt)} (${number(report.configuration.measurementDurationMs / 60000)} min). Temps de mesure écoulé : ${number(report.summary.measurementElapsedMs / 60000)} min.`, '',
    `Workers observés : ${report.summary.workers} / ${report.summary.expectedWorkers} attendus. Appels HTTP sortants : ${report.summary.outboundCalls}. Requêtes entrantes : ${report.summary.inboundCalls}.`, '',
    `Conteneur : réception ${report.summary.networkReceivedBytes === null ? 'indisponible' : `${mib(report.summary.networkReceivedBytes)} MiB`}, envoi ${report.summary.networkSentBytes === null ? 'indisponible' : `${mib(report.summary.networkSentBytes)} MiB`}. CPU moyen / pic : ${report.summary.containerCpuMeanPercent === null ? 'indisponible' : `${number(report.summary.containerCpuMeanPercent)} % / ${number(report.summary.containerCpuPeakPercent)} %`}. **100 % = un cœur**.`, '',
    `Workers sans état final : ${report.summary.workersWithoutFinal.join(', ') || 'aucun'}. Envoi Discord : ${escape(report.notification.status)}.`, '',
    'Le JSON joint contient tous les groupes, histogrammes de latence, statuts, exemples, maxima, appels lourds, profils et séries par worker. Les tableaux ci-dessous montrent les premiers de chaque classement.', '',
  ];
  if (report.triggeredAlert) {
    const alert = report.triggeredAlert;
    const deferred = alert.deferredUntil ? ` Détectée le ${date(alert.at)} ; rapport différé jusqu’à une minute de mesure.` : '';
    rows.push(`**Alerte : ${escape(describeThresholdAlert(alert))}.**${deferred} La collecte continue ; rapport final prévu le ${date(report.endsAt)}.`, '');
  }
  function table(title, headers, data) {
    rows.push(`## ${title}`, '', `| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`);
    for (const row of data) rows.push(`| ${row.map(escape).join(' | ')} |`);
    if (!data.length) rows.push(`| Aucune donnée | ${headers.slice(1).map(() => '—').join(' | ')} |`);
    rows.push('');
  }
  if (report.resourceStats) {
    const display = (value, format = number) => value === null ? 'indisponible' : format(value);
    table('Minimums, moyennes et pics du conteneur', ['Mesure', 'Minimum', 'Moyenne', 'P95', 'Pic', 'Fin du pic UTC', 'Durée observée s'],
      [['CPU (%)', 'cpuPercent', number], ['Réception (Mio/s)', 'rxMiBPerSecond', number],
        ['Émission (Mio/s)', 'txMiBPerSecond', number], ['Mémoire (Mio)', 'memoryBytes', mib]]
        .map(([label, key, format]) => {
          const stats = report.resourceStats[key];
          return [label, ...['min', 'mean', 'p95', 'peak'].map((field) => display(stats[field], format)),
            stats.peakAt === null ? 'indisponible' : date(stats.peakAt), number(stats.coveredMs / 1000)];
        }));
    const above = (key) => report.resourceStats[key].aboveThresholdMs;
    rows.push(`Durée des fenêtres dépassant les seuils : CPU > 300 % : ${display(above('cpuPercent'), (ms) => `${number(ms / 1000)} s`)} ; réception > 20 Mio/s : ${display(above('rxMiBPerSecond'), (ms) => `${number(ms / 1000)} s`)} ; émission > 20 Mio/s : ${display(above('txMiBPerSecond'), (ms) => `${number(ms / 1000)} s`)}.`, '',
      `Trafic : ${display(report.summary.inboundRequestsPerSecond)} requêtes entrantes/s ; ${display(report.summary.outboundCallsPerInboundRequest)} appels HTTP sortants par requête entrante (tâches de fond comprises). Comparer ces volumes avec la même durée et une charge similaire avant de conclure sur les optimisations.`, '');
  }
  if (report.alerts?.length) table('Alertes pendant la collecte', ['Date UTC', 'Dépassement', 'Envoi Discord'],
    report.alerts.map((alert) => [date(alert.at), describeThresholdAlert(alert), alert.notification?.status || 'pending']));
  const outgoing = report.groups.filter((row) => row.kind !== 'inbound');
  table('Destinations par volume reçu (mêmes appels regroupés)', ['Destination', 'Type / unité', 'Appels', 'En cours', 'Reçu MiB', 'Envoyé MiB', 'Erreurs', 'Redirections', 'Tailles inconnues', 'Appels sans détail de route'],
    (report.destinations || aggregateDestinations(report.groups)).filter((row) => row.kind !== 'inbound').slice(0, 30)
      .map((row) => [row.destination, `${row.kind} / ${row.byteMode}`, row.started, Math.max(0, finite(row.started) - finite(row.completed)), mib(row.receivedBytes), mib(row.sentBytes), row.failed, row.redirects, row.unknownResponses, row.detailLimitedCalls]));
  for (const [title, field] of [['Opérations par volume reçu', 'receivedBytes'], ['Opérations par nombre d’appels', 'started'], ['Opérations par durée cumulée', 'durationMs'], ['Opérations par erreurs', 'failed']]) {
    table(title, ['Type / unité', 'Opération', 'Origine', 'Appels', 'En cours', 'Reçu MiB', 'Tailles inconnues', 'Envoyé MiB', 'Durée totale s', 'Max ms', 'Erreurs', 'Redirections'],
      [...outgoing].sort((a, b) => b[field] - a[field]).slice(0, 25).map((row) => [
        `${row.kind} / ${row.byteMode}`, row.operation, row.source, row.started, finite(row.unfinished), mib(row.receivedBytes), row.unknownResponses, mib(row.sentBytes), number(row.durationMs / 1000), number(row.maxDurationMs), row.failed, redirects(row),
      ]));
  }
  table('Routes entrantes par appels', ['Route', 'Appels', 'En cours', 'Réponses MiB', 'Moyenne ms (terminées)', '4xx', 'dont 404 (pas de contenu)', '5xx', 'Abandons / transport'],
    report.groups.filter((row) => row.kind === 'inbound').sort((a, b) => b.started - a.started).slice(0, 25)
      .map((row) => {
        const classes = statusClasses(row);
        return [row.operation, row.started, finite(row.unfinished), mib(row.sentBytes), orNa(row.meanDurationMs), classes.client, classes.notFound, classes.server, classes.other];
      }));
  table('Sockets Node observées (vue socket, pas un total supplémentaire)', ['Destination', 'Sockets observées (ouvertes au début + nouvelles)', 'Reçu MiB', 'Envoyé MiB'],
    report.sockets.slice(0, 30).map((row) => [row.label, row.connections, mib(row.receivedBytes), mib(row.sentBytes)]));
  table('CPU par processus Linux', ['PID', 'Nom', 'CPU observé s', 'Pic CPU %', 'Pic RSS MiB'],
    report.processes.slice(0, 30).map((row) => [row.pid, row.name, number(row.cpuUsageUs / 1e6), number(row.peakCpuPercent), mib(row.peakRssBytes)]));
  const sampleMs = report.configuration.resourceIntervalMs || 5000;
  table('Workers', ['PID / slot', 'CPU observé s', 'Pic CPU % (relevés ≥ demi-période)', 'Pic RSS MiB', 'Pic retard boucle p99 ms', 'Pic blocage boucle ms', 'Fenêtres profil V8', 'Démarrage profileur ms (n / total / max)', 'État final'],
    report.workers.map((worker) => {
      const points = regularPoints(worker, sampleMs);
      const stall = worker.cpuProfile?.startStallMs;
      return [
        `${worker.pid} / ${worker.slot}`, number(total(worker.resources || [], 'cpuUsageUs') / 1e6),
        orNa(maxOf(points.map((point) => point.cpuPercent))),
        mib(Math.max(0, ...(worker.resources || []).map((point) => finite(point.memory?.rss)))),
        orNa(maxOf(points.map((point) => point.eventLoopP99Ms))),
        orNa(maxOf((worker.resources || []).map((point) => point.eventLoopMaxMs))),
        finite(worker.cpuProfile?.windows),
        stall ? `${finite(stall.count)} / ${number(stall.total)} / ${number(stall.max)}` : 'n/d',
        worker.final ? 'oui' : 'non',
      ];
    }));
  const lastOf = (worker, read) => {
    const points = worker.resources || [];
    for (let index = points.length - 1; index >= 0; index--) { const value = read(points[index]); if (Number.isFinite(value)) return value; }
    return null;
  };
  const kindCell = (summary, kind) => summary?.byKind[kind] ? `${summary.byKind[kind].count} / ${number(summary.byKind[kind].durationMs)}` : '0 / 0.0';
  table('Mémoire et GC par worker (thread principal ; tas au dernier relevé)', ['PID / slot', 'GC ms (part du temps %)', 'Pic GC ms par relevé', 'Mineurs n / ms', 'Majeurs n / ms', 'Incrémentaux n / ms',
    'Old space MiB', 'New space MiB', 'malloc MiB', 'Externe MiB', 'Private_Dirty MiB', 'Shared_Clean MiB'],
    report.workers.map((worker) => {
      const summary = gcSummary(worker, sampleMs);
      return [
        `${worker.pid} / ${worker.slot}`, summary ? `${number(summary.durationMs)} (${orNa(summary.sharePercent)})` : 'n/d', orNa(summary?.peakPerSampleMs),
        summary ? kindCell(summary, 'minor') : 'n/d', summary ? kindCell(summary, 'major') : 'n/d', summary ? kindCell(summary, 'incremental') : 'n/d',
        orNa(lastOf(worker, (point) => point.heap?.spaces?.old_space?.usedBytes), mib), orNa(lastOf(worker, (point) => point.heap?.spaces?.new_space?.usedBytes), mib),
        orNa(lastOf(worker, (point) => point.heap?.mallocedBytes), mib), orNa(lastOf(worker, (point) => point.heap?.externalBytes), mib),
        orNa(lastOf(worker, (point) => point.smapsRollup?.privateDirtyBytes), mib), orNa(lastOf(worker, (point) => point.smapsRollup?.sharedCleanBytes), mib),
      ];
    }));
  const functions = report.workers.flatMap((worker) => (worker.cpuProfile?.functions || []).map((row) => ({ ...row, pid: worker.pid })));
  table('Fonctions V8 les plus échantillonnées (hors idle)', ['PID', 'Fonction', 'Fichier:ligne', 'Échantillons', 'Temps échantillonné ms'],
    functions.filter((row) => !['(idle)', '(root)'].includes(row.name)).sort((a, b) => b.estimatedCpuMs - a.estimatedCpuMs).slice(0, 30)
      .map((row) => [row.pid, row.name, `${row.file || 'V8/natif'}:${row.line || ''}`, row.samples, number(row.estimatedCpuMs)]));
  const busiest = [...report.timeline].filter((point) => point.cpuPercent !== null || point.rxBytes !== null)
    .sort((a, b) => (b.cpuPercent || 0) - (a.cpuPercent || 0) || (b.rxBytes || 0) - (a.rxBytes || 0)).slice(0, 20);
  table('Fenêtres les plus chargées et opérations concomitantes', ['Fin UTC', 'Durée s', 'CPU %', 'Réception MiB/s', 'Activité des workers'],
    busiest.map((point) => {
      const nearby = report.workers.flatMap((worker) => (worker.resources || [])
        .filter((resource) => Math.abs(resource.at - point.at) <= report.configuration.resourceIntervalMs)
        .flatMap((resource) => resource.operations || []));
      return [date(point.at), number(point.elapsedMs / 1000), point.cpuPercent === null ? 'n/d' : number(point.cpuPercent),
        point.rxBytes === null ? 'n/d' : mib(point.rxBytes / (point.elapsedMs / 1000)),
        nearby.sort((a, b) => b.receivedBytes - a.receivedBytes || b.started - a.started).slice(0, 4)
          .map((row) => `${row.operation} (${row.started} appels, ${mib(row.receivedBytes)} MiB ; ${row.source})`).join(' ; ')];
    }));
  rows.push('## Couverture et interprétation', '', ...report.coverage.map((line) => `- ${line}`), '');
  const warnings = [...Object.entries(report.warnings || {}).map(([key, value]) => `${key}: ${value}`),
    ...report.workers.flatMap((worker) => Object.entries(worker.metrics?.warnings || {}).map(([key, value]) => `PID ${worker.pid} ${key}: ${value}`)),
    ...report.workers.filter((worker) => worker.cpuProfile?.errors).map((worker) => `PID ${worker.pid} erreurs de profil V8: ${worker.cpuProfile.errors}`)];
  rows.push('## Mesures indisponibles et budgets', '', ...(warnings.length ? warnings.map((line) => `- ${escape(line)}`) : ['Aucun avertissement remonté.']), '');
  return rows.join('\n');
}

module.exports = { buildReport, renderMarkdown, aggregateGroups };
