// Réglages des effets d'ambiance : ce qui sort du stockage doit toujours être
// utilisable (au moins un effet, opacité bornée), et les réglages de l'ancien
// mode neige ne doivent pas se perdre au passage.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AMBIENT_MIN_OPACITY, DEFAULT_AMBIENT_OPTIONS, normalizeAmbientOptions, toggleAmbientEffect,
} from '../src/components/ambient/ambientOptions.ts';

test('sans rien de stocké, les réglages par défaut', () => {
  assert.deepEqual(normalizeAmbientOptions(null), DEFAULT_AMBIENT_OPTIONS);
  assert.deepEqual(normalizeAmbientOptions('abîmé', 12), DEFAULT_AMBIENT_OPTIONS);
});

test("les réglages de l'ancien mode neige sont repris", () => {
  const kept = normalizeAmbientOptions(null, { intensity: 'heavy', accumulate: false, melt: false });
  assert.deepEqual(kept, { effects: ['snow'], intensity: 'heavy', opacity: 1, settle: 'off', fade: false });
  const tenue = normalizeAmbientOptions(null, { intensity: 'variable', accumulate: true, melt: true });
  assert.equal(tenue.settle, 'all');
  assert.equal(tenue.intensity, 'variable');
});

test("le nouveau format l'emporte sur l'ancien", () => {
  const options = normalizeAmbientOptions({ effects: ['rain'], settle: 'ground' }, { intensity: 'heavy', accumulate: false });
  assert.deepEqual(options.effects, ['rain']);
  assert.equal(options.settle, 'ground');
  assert.equal(options.intensity, 'normal');
});

test('effets inconnus retirés, ordre fixe, jamais vide', () => {
  assert.deepEqual(normalizeAmbientOptions({ effects: ['petals', 'lave', 'snow', 'snow'] }).effects, ['snow', 'petals']);
  assert.deepEqual(normalizeAmbientOptions({ effects: ['halloween', 'popcorn'] }).effects, ['popcorn', 'halloween']);
  assert.deepEqual(normalizeAmbientOptions({ effects: [] }).effects, ['snow']);
  assert.deepEqual(normalizeAmbientOptions({ effects: 'rain' }).effects, ['snow']);
});

test("l'opacité reste dans ses bornes", () => {
  assert.equal(normalizeAmbientOptions({ opacity: 0 }).opacity, AMBIENT_MIN_OPACITY);
  assert.equal(normalizeAmbientOptions({ opacity: 7 }).opacity, 1);
  assert.equal(normalizeAmbientOptions({ opacity: 'x' }).opacity, 1);
  assert.equal(normalizeAmbientOptions({ opacity: 0.6 }).opacity, 0.6);
});

test('on mélange les effets, sans pouvoir couper le dernier', () => {
  const mixed = toggleAmbientEffect(toggleAmbientEffect(DEFAULT_AMBIENT_OPTIONS, 'rain'), 'leaves');
  assert.deepEqual(mixed.effects, ['snow', 'leaves', 'rain']);
  const less = toggleAmbientEffect(toggleAmbientEffect(mixed, 'snow'), 'rain');
  assert.deepEqual(less.effects, ['leaves']);
  assert.equal(toggleAmbientEffect(less, 'leaves'), less);
});
