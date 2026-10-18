import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceEffect } from './helpers/sourceFunction.mjs';

// Un <video> ne se relie qu'une fois à un MediaElementSourceNode : si le
// contexte du booster se ferme pendant le double montage du StrictMode, le
// remontage ne peut plus le recréer et la vidéo reste muette.
function audioContextFixture() {
  const timers = new Map();
  let nextTimer = 1;
  const context = {
    state: 'running',
    closes: 0,
    close() {
      this.closes++;
      this.state = 'closed';
      return Promise.resolve();
    },
  };
  const effect = sourceEffect('src/components/HLSPlayer.tsx', 'audioContextCloseTimerRef', {
    audioContextRef: { current: context },
    audioContextCloseTimerRef: { current: null },
    console,
    setTimeout: callback => {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout: id => timers.delete(id),
  });
  const flushTimers = () => {
    const pending = [...timers.values()];
    timers.clear();
    pending.forEach(callback => callback());
  };
  return { context, effect, flushTimers };
}

test('le double montage du StrictMode garde ouvert le contexte audio du booster', () => {
  const { context, effect, flushTimers } = audioContextFixture();
  const simulatedUnmount = effect();
  simulatedUnmount();
  const unmount = effect();
  flushTimers();
  assert.equal(context.closes, 0);
  assert.equal(context.state, 'running');

  unmount();
  flushTimers();
  assert.equal(context.closes, 1, 'le vrai démontage libère toujours le contexte');
});

test('un contexte déjà fermé n’est pas refermé', () => {
  const { context, effect, flushTimers } = audioContextFixture();
  context.state = 'closed';
  effect()();
  flushTimers();
  assert.equal(context.closes, 0);
});
