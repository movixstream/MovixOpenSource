// Tas des effets d'ambiance : la neige ne doit ni apparaître ni disparaître
// en s'éboulant, rester sous la pente naturelle, glisser par les bords et
// suivre l'arrondi des coins. Un tas qui « gonfle » finirait par couvrir les affiches.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  capacityProfile, carveCircle, columnCount, cornerDrop, deposit, melt, relax, resample, smooth, sum,
} from '../src/components/ambient/pilePhysics.ts';

const volume = (h: Float32Array, colW: number) => sum(h) * colW;

test('un dépôt garde son volume, même au bord', () => {
  const h = new Float32Array(40);
  deposit(h, 20, 30, 3);
  assert.ok(Math.abs(volume(h, 3) - 30) < 1e-3);
  const edge = new Float32Array(40);
  deposit(edge, 0, 12, 3);
  assert.ok(Math.abs(volume(edge, 3) - 12) < 1e-3);
});

test("l'éboulement conserve la neige et respecte la pente", () => {
  const n = 60;
  const colW = 3;
  const h = new Float32Array(n);
  h[30] = 40;
  const cap = new Float32Array(n).fill(100);
  let spilled = 0;
  for (let k = 0; k < 400; k++) {
    const s = relax(h, cap, colW, 0.85, 2);
    spilled += s.left + s.right;
  }
  assert.ok(Math.abs(volume(h, colW) + spilled - 40 * colW) < 1e-2);
  for (let i = 0; i < n - 1; i++) assert.ok(Math.abs(h[i] - h[i + 1]) <= 0.85 * colW + 0.05);
});

test('le tassement arrondit une pointe sans changer le volume', () => {
  const h = new Float32Array(30);
  h[15] = 12;
  const tmp = new Float32Array(30);
  for (let k = 0; k < 20; k++) smooth(h, 0.2, tmp);
  assert.ok(Math.abs(sum(h) - 12) < 1e-4);
  assert.ok(h[15] < 4);
  assert.ok(h[12] > 0.2 && Math.abs(h[12] - h[18]) < 1e-5);
});

test('ce qui dépasse la capacité tombe du côté le plus proche', () => {
  const h = new Float32Array(10).fill(5);
  const cap = new Float32Array(10).fill(3);
  const spill = relax(h, cap, 2, 10, 1);
  assert.ok(h.every((v) => v <= 3 + 1e-6));
  assert.ok(Math.abs(spill.left - spill.right) < 1e-6);
  assert.ok(Math.abs(spill.left + spill.right - 2 * 10 * 2) < 1e-3);
});

test('les coins arrondis tiennent moins de neige que le milieu', () => {
  const cap = capacityProfile(64, 192, 14, 12);
  assert.ok(cap[0] < cap[32] * 0.5);
  assert.equal(cap[32], 14);
  assert.equal(cornerDrop(96, 192, 12), 0);
  assert.equal(cornerDrop(0, 192, 12), 12);
  assert.ok(cornerDrop(3, 192, 12) > 0 && cornerDrop(3, 192, 12) < 12);
});

test('le curseur retire exactement la neige traversée', () => {
  const n = 40;
  const colW = 3;
  const h = new Float32Array(n).fill(10);
  const base = new Float32Array(n);
  const removed = new Float32Array(n);
  const before = volume(h, colW);
  // Disque centré sur le haut du tas : il en emporte la partie supérieure.
  const total = carveCircle(h, base, colW, 60, -10, 6, removed);
  assert.ok(total > 0);
  assert.ok(Math.abs(before - volume(h, colW) - total) < 1e-3);
  assert.ok(Math.abs(sum(removed) - total) < 1e-3);
  // Sous la neige (dans l'affiche), le curseur ne touche à rien.
  const untouched = carveCircle(h, base, colW, 60, 20, 6, removed);
  assert.equal(untouched, 0);
});

test('la fonte ne passe jamais sous zéro et touche plus les gros tas', () => {
  const h = new Float32Array([0, 1, 10]);
  melt(h, 1, 0.5, 0.1);
  assert.equal(h[0], 0);
  assert.ok(Math.abs(h[1] - 0.4) < 1e-6);
  assert.ok(Math.abs(h[2] - 8.5) < 1e-6);
  melt(h, 100, 0.5, 0.1);
  assert.ok(h.every((v) => v === 0));
});

test('colonnes et rééchantillonnage', () => {
  assert.equal(columnCount(192), 64);
  assert.equal(columnCount(10), 8);
  assert.equal(columnCount(5000), 160);
  const r = resample(new Float32Array([2, 2, 2, 2]), 9);
  assert.equal(r.length, 9);
  assert.ok(r.every((v) => Math.abs(v - 2) < 1e-6));
});
