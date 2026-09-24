import assert from 'node:assert/strict';
import test from 'node:test';
import { getAutoLightModeReason, parseLightModeSetting } from '../src/utils/animationPreferences.ts';

test('automatic mode handles unknown hardware and recognizes limited devices', () => {
  assert.equal(getAutoLightModeReason({}, false), null);
  assert.equal(getAutoLightModeReason({ hardwareConcurrency: 0, deviceMemory: 0 }, false), null);
  assert.equal(getAutoLightModeReason({ hardwareConcurrency: 2 }, false), 'cpu');
  assert.equal(getAutoLightModeReason({ deviceMemory: 2 }, false), 'memory');
  assert.equal(getAutoLightModeReason({ hardwareConcurrency: 8, deviceMemory: 8 }, false), null);
  for (const userAgent of ['Tizen', 'Web0S', 'webOS', 'Android TV', 'VIDAA', 'AFTMM', 'BRAVIA', 'HbbTV']) {
    assert.equal(getAutoLightModeReason({ userAgent }, false), 'tv', userAgent);
  }
  assert.equal(getAutoLightModeReason({ userAgent: 'Tizen' }, true), 'reducedMotion');
});

test('invalid and missing saved modes fall back to automatic detection', () => {
  for (const value of [null, '', 'true', 'broken', 'AUTO']) assert.equal(parseLightModeSetting(value), 'auto');
  assert.equal(parseLightModeSetting('on'), 'on');
  assert.equal(parseLightModeSetting('off'), 'off');
});

test('low latency remains opt-in with malformed persisted data', async () => {
  let raw: string | null = null;
  let fail = false;
  let events = 0;
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: () => raw,
    setItem: (_key: string, value: string) => { if (fail) throw new Error('quota'); raw = value; },
  } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { dispatchEvent: () => { events++; } } });
  try {
    const { isLowLatencyEnabled, setLowLatencyEnabled } = await import('../src/utils/lowLatencyPref.ts');
    for (const value of [null, '{', 'null', 'true', '[]', '{"movies":"false","livetv":1}']) {
      raw = value;
      assert.equal(isLowLatencyEnabled('movies'), false);
      assert.equal(isLowLatencyEnabled('livetv'), false);
    }
    raw = '{"livetv":true}';
    assert.equal(setLowLatencyEnabled('movies', true), true);
    assert.equal(isLowLatencyEnabled('movies'), true);
    assert.equal(isLowLatencyEnabled('livetv'), true);
    fail = true;
    assert.equal(setLowLatencyEnabled('movies', false), false);
    assert.equal(isLowLatencyEnabled('movies'), true);
    assert.equal(events, 1);
  } finally {
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
