'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createWiflixRefreshState, RETRY_MS } = require('../../utils/wiflixRefreshState');

const minute = 60 * 1000;
const hour = 60 * minute;

async function tempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wiflix-state-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('RETRY_MS reste exporté : premier délai de reprise de 60 secondes', () => {
  assert.equal(RETRY_MS, minute);
});

test('les reprises d’une clé doublent jusqu’à 15 minutes et clear repart de zéro', async t => {
  const dir = await tempDir(t);
  let time = 1_700_000_000_000;
  const state = createWiflixRefreshState({ now: () => time });
  const delays = [];
  for (let attempt = 0; attempt < 6; attempt++) {
    await state.defer(dir, 'key');
    delays.push(await state.remaining(dir, 'key', null));
    time += delays.at(-1); // Nouvel échec dès l'échéance.
  }
  assert.deepEqual(delays, [1, 2, 4, 8, 15, 15].map(n => n * minute));
  // Une autre clé garde son propre compteur.
  await state.defer(dir, 'other');
  assert.equal(await state.remaining(dir, 'other', null), minute);
  await state.clear(dir, 'key');
  assert.equal(await state.remaining(dir, 'key', null), 0);
  await state.defer(dir, 'key');
  assert.equal(await state.remaining(dir, 'key', null), minute);
});

test('après une longue accalmie, un nouvel échec repart à 60 secondes', async t => {
  const dir = await tempDir(t);
  let time = 1_700_000_000_000;
  const state = createWiflixRefreshState({ now: () => time });
  for (let attempt = 0; attempt < 3; attempt++) {
    await state.defer(dir, 'key');
    time += await state.remaining(dir, 'key', null);
  }
  // Troisième délai (4 min) écoulé depuis plus de 15 min.
  time += 15 * minute + 1;
  await state.defer(dir, 'key');
  assert.equal(await state.remaining(dir, 'key', null), minute);
});

test('un ancien fichier .retry vide compte pour un échec à sa date de modification', async t => {
  const dir = await tempDir(t);
  const file = path.join(dir, 'key.retry');
  await fs.writeFile(file, '');
  const { mtimeMs } = await fs.stat(file);
  let time = mtimeMs + 20_000;
  const state = createWiflixRefreshState({ now: () => time });
  assert.equal(await state.remaining(dir, 'key', null), 40_000);
  // L'échec suivant est le deuxième : reprise après 2 min.
  await state.defer(dir, 'key');
  assert.equal(await state.remaining(dir, 'key', null), 2 * minute);
});

test('la fraîcheur varie de ±10 % selon la clé, de façon identique dans chaque worker', async t => {
  const dir = await tempDir(t);
  let time = 0;
  const worker = createWiflixRefreshState({ now: () => time });
  const otherWorker = createWiflixRefreshState({ now: () => time });
  const exact = createWiflixRefreshState({ now: () => time, jitter: 0 });
  const success = { success: true, players: {} }, negative = { success: false };
  const ratios = [];
  for (let index = 0; index < 40; index++) {
    const key = `wiflix_movie_${index}`;
    const file = path.join(dir, `${key}.json`);
    await fs.writeFile(file, '{}');
    time = (await fs.stat(file)).mtimeMs; // Publié à l'instant.
    const fresh = await worker.remaining(dir, key, success);
    const freshNegative = await worker.remaining(dir, key, negative);
    assert.ok(fresh >= 2.7 * hour && fresh <= 3.3 * hour, `${key} : ${fresh}`);
    // Un introuvable confirmé reste 30 minutes, avec le même écart.
    assert.ok(Math.abs(freshNegative / (30 * minute) - fresh / (3 * hour)) < 1e-9, key);
    assert.equal(await otherWorker.remaining(dir, key, success), fresh, key);
    assert.equal(await exact.remaining(dir, key, success), 3 * hour, key);
    assert.equal(await exact.remaining(dir, key, negative), 30 * minute, key);
    ratios.push(fresh / (3 * hour));
  }
  // Des caches écrits ensemble expirent à des moments différents.
  assert.ok(ratios.some(ratio => ratio < 0.97) && ratios.some(ratio => ratio > 1.03));
  assert.ok(new Set(ratios).size > 35);
});
