import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { sourceEffect, sourceFunction } from './helpers/sourceFunction.mjs';
import { getLocalPlaybackInitPolicy } from '../src/utils/castLocalPlaybackRecovery.ts';
import { observeNativeAudioTracks } from '../src/utils/nativeAudioTracks.ts';

const silentConsole = { log() {}, warn() {}, error() {} };
const noop = () => {};

function videoFixture() {
  const video = new EventTarget();
  Object.assign(video, {
    disableRemotePlayback: false,
    webkitWirelessVideoPlaybackDisabled: false,
    webkitCurrentPlaybackTargetIsWireless: false,
    textTracks: [],
    paused: true,
    currentTime: 42, readyState: 0, isConnected: true,
    removeAttribute(name) { if (name === 'src') this.src = ''; },
    load() { this.currentTime = 0; this.dispatchEvent(new Event('loadstart')); },
    async play() { this.paused = false; this.playCalls = (this.playCalls ?? 0) + 1; },
    setAttribute: noop,
  });
  return video;
}

function initializeAirPlay(video, onStateChange = noop, webkit = true) {
  return sourceFunction('src/utils/castUtils.ts', 'initializeAirPlay', {
    isAirPlaySupported: () => webkit,
    isRemotePlaybackSupported: () => !webkit,
    console: silentConsole,
  })(video, onStateChange);
}

function playerFixture({ hlsSupported = true, autoPlay = false } = {}) {
  const video = videoFixture();
  const hlsRef = { current: null };
  const timers = new Map();
  let nextTimer = 0;
  let fallbacks = 0;
  class Hls extends EventEmitter {
    static Events = new Proxy({}, { get: (_, name) => name });
    static isSupported = () => hlsSupported;
    levels = [{ height: 1080 }];
    currentLevel = 0;
    loadSource() {}
    attachMedia(media) {
      // Hls.js impose ce drapeau avant d'ouvrir ManagedMediaSource sur iPhone.
      media.disableRemotePlayback = true;
      media.dispatchEvent(new Event('loadstart'));
    }
    startLoad() {}
    destroy() { this.removeAllListeners(); this.destroyed = true; video.currentTime = 0; }
  }
  const bindings = {
    isCasting: false, Hls, hlsRef, videoRef: { current: video },
    nativeAirPlay: false, nativeAirPlayRef: { current: false },
    playbackRestoreRef: { current: null }, isAirPlayLoading: false,
    isAirPlaySupported: () => true, isRemotePlaybackSupported: () => false,
    useCallback: callback => callback,
    setNativeAirPlay: value => { bindings.nativeAirPlay = value; },
    setPlaybackRevision: noop,
    setIsAirPlayLoading: value => { bindings.isAirPlayLoading = value; },
    setAirPlayError: value => { bindings.airPlayError = value; },
    setAirPlayAvailable: noop, setIsAirPlaying: noop, setShowCastMenu: noop, t: key => key,
    observeNativeAudioTracks, setCurrentAudioTrack: noop,
    safePlay: media => media.play(),
    postCastPlaybackSuppressedRef: { current: false }, getLocalPlaybackInitPolicy,
    bufferingTimeoutRef: { current: null }, sourceTimeoutRef: { current: null },
    setTimeout: (callback, delay) => {
      const id = ++nextTimer;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout: id => timers.delete(id),
    setIsLoading: noop, setIsBuffering: noop, setBuffered: noop,
    requestHlsFallback: () => { fallbacks++; },
    src: 'https://media.test/master.m3u8', normalizeUqloadEmbedUrl: url => url,
    kisskhSources: [], isMP4Source: () => false, contentTypeMp4Urls: new Set(),
    createHlsConfig: () => ({}), purstreamSources: [], console: silentConsole, window: {},
    qualitiesRef: { current: [] }, qualityPreferenceRef: { current: 'auto' },
    buildHlsQualityOptions: levels => levels, setQualities: noop,
    selectLevelForPreference: () => 0, formatDetectedStreamQuality: () => '1080p',
    rememberSourceQuality: noop, playbackSpeed: 1, lastKnownTimeRef: { current: 0 },
    autoPlay, setAudioTracks: noop, hlsAudioPreferences: new Map(),
    contentQualityKey: 'test', contentQualityKeyRef: { current: 'test' }, selectAudioTrackIndex: () => -1,
    applySelectedTextTrackMode: noop, currentSubtitleRef: { current: -1 },
    failed429Segments: new Set(),
  };
  bindings.restoreLocalPlayback = sourceFunction('src/components/HLSPlayer.tsx', 'restoreLocalPlayback', bindings);
  bindings.requestAirPlay = sourceFunction('src/utils/castUtils.ts', 'requestAirPlay', { console: silentConsole });
  bindings.initializeAirPlay = initializeAirPlay;
  let cleanup;
  const render = (changes = {}) => {
    cleanup?.();
    Object.assign(bindings, changes);
    cleanup = sourceEffect('src/components/HLSPlayer.tsx', 'const clearSourceTimeout', bindings)();
  };
  render();
  return {
    video, bindings, render, get hls() { return hlsRef.current; }, cleanup: () => cleanup?.(),
    startAirPlay: () => sourceFunction('src/components/HLSPlayer.tsx', 'startAirPlay', bindings)(),
    observeAirPlay: () => sourceEffect('src/components/HLSPlayer.tsx', 'const disconnected = wasConnected', bindings)(),
    manifest: () => hlsRef.current.emit(Hls.Events.MANIFEST_PARSED, null, { levels: hlsRef.current.levels }),
    fragment: () => hlsRef.current.emit(Hls.Events.FRAG_LOADED, null, { frag: { sn: 0, type: 'video' } }),
    expireLoading: () => {
      for (const [id, timer] of timers) {
        if (timer.delay === 45000) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
    fallbackCount: () => fallbacks,
    timers,
  };
}

test('Safari : monter le lecteur avec Hls.js déjà chargé préserve ManagedMediaSource', () => {
  const fixture = playerFixture();
  const states = [];
  // Au remontage Hls.js est en cache : l'effet HLS précède l'effet AirPlay.
  const cleanupAirPlay = initializeAirPlay(fixture.video, state => states.push(state));
  try {
    assert.equal(fixture.video.disableRemotePlayback, true);
    fixture.video.webkitCurrentPlaybackTargetIsWireless = true;
    fixture.video.dispatchEvent(new Event('webkitcurrentplaybacktargetiswirelesschanged'));
    assert.equal(states.at(-1).isConnected, true);
    cleanupAirPlay();
    fixture.video.dispatchEvent(new Event('webkitcurrentplaybacktargetiswirelesschanged'));
    assert.equal(states.length, 2, 'le nettoyage retire les écouteurs AirPlay');
  } finally {
    cleanupAirPlay();
    fixture.cleanup();
  }
});

test('la découverte AirPlay conserve les drapeaux du moteur de lecture', () => {
  for (const disabled of [true, false]) {
    const video = videoFixture();
    video.disableRemotePlayback = disabled;
    video.webkitWirelessVideoPlaybackDisabled = disabled;
    const cleanup = initializeAirPlay(video);
    assert.equal(video.disableRemotePlayback, disabled);
    assert.equal(video.webkitWirelessVideoPlaybackDisabled, disabled);
    cleanup();
  }
});

test('la découverte Remote Playback ne réactive pas la sortie distante du média', async () => {
  const video = videoFixture();
  video.disableRemotePlayback = true;
  video.remote = Object.assign(new EventTarget(), {
    state: 'disconnected', watchAvailability: () => Promise.resolve(1),
    cancelWatchAvailability: noop,
  });
  const cleanup = initializeAirPlay(video, noop, false);
  await Promise.resolve();
  assert.equal(video.disableRemotePlayback, true);
  cleanup();
});

test('une demande explicite AirPlay réactive la sortie avant le sélecteur système', async () => {
  const video = videoFixture();
  video.disableRemotePlayback = true;
  video.webkitWirelessVideoPlaybackDisabled = true;
  let pickerCalls = 0;
  let pickerFlags;
  video.webkitShowPlaybackTargetPicker = () => {
    pickerFlags = [video.disableRemotePlayback, video.webkitWirelessVideoPlaybackDisabled];
    pickerCalls++;
  };
  const request = sourceFunction('src/utils/castUtils.ts', 'requestAirPlay', { console: silentConsole });
  const pending = request(video);
  const synchronousPickerCalls = pickerCalls;
  await pending;
  assert.equal(synchronousPickerCalls, 1, 'le sélecteur reste dans le geste utilisateur, avant tout await');
  assert.deepEqual(pickerFlags, [false, false]);
});

for (const progress of ['manifest', 'fragment']) {
  test(`un ${progress} reçu sans média lisible conserve le délai de secours`, () => {
    const fixture = playerFixture();
    try {
      fixture[progress]();
      fixture.expireLoading();
      assert.equal(fixture.fallbackCount(), 1);
    } finally { fixture.cleanup(); }
  });
}

for (const readyEvent of ['canplay', 'playing']) {
  test(`${readyEvent} annule le secours, même sans autoplay`, () => {
    const fixture = playerFixture();
    try {
      fixture.manifest();
      fixture.video.dispatchEvent(new Event(readyEvent));
      fixture.expireLoading();
      assert.equal(fixture.fallbackCount(), 0);
    } finally { fixture.cleanup(); }
  });
}

test('démonter le lecteur annule le secours de la source précédente', () => {
  const fixture = playerFixture();
  fixture.cleanup();
  fixture.expireLoading();
  assert.equal(fixture.fallbackCount(), 0);
});

test('AirPlay garde le master et la position lors du passage natif et du changement de source', async () => {
  const fixture = playerFixture();
  const previousHls = fixture.hls;
  let pickerCalls = 0;
  fixture.video.webkitShowPlaybackTargetPicker = () => { pickerCalls++; };
  fixture.video.paused = false;
  try {
    const pending = fixture.startAirPlay();
    assert.equal(pickerCalls, 1, 'le sélecteur doit être appelé dans le geste utilisateur');
    await pending;
    fixture.render();
    assert.equal(previousHls.destroyed, true);
    assert.equal(fixture.hls, null);
    assert.equal(fixture.video.src, 'https://media.test/master.m3u8');
    assert.equal(fixture.video.disableRemotePlayback, false);
    fixture.video.dispatchEvent(new Event('loadedmetadata'));
    assert.equal(fixture.video.currentTime, 42);
    assert.equal(fixture.video.playCalls, 1);
    assert.equal(fixture.bindings.isAirPlayLoading, false);

    fixture.video.currentTime = 87;
    fixture.video.paused = true;
    fixture.video.webkitCurrentPlaybackTargetIsWireless = true;
    fixture.render({ src: 'https://alternative.test/master.m3u8' });
    fixture.video.dispatchEvent(new Event('loadedmetadata'));
    assert.equal(fixture.hls, null, 'un changement de serveur ne doit pas recréer MSE pendant AirPlay');
    assert.equal(fixture.video.src, 'https://alternative.test/master.m3u8');
    assert.equal(fixture.video.currentTime, 87);
    assert.equal(fixture.video.playCalls, 1, 'une vidéo en pause doit rester en pause');

    fixture.render({ src: 'https://media.test/episode-2.m3u8', contentQualityKey: 'episode-2' });
    fixture.video.dispatchEvent(new Event('loadedmetadata'));
    assert.equal(fixture.video.currentTime, 0, 'la position précédente appartient au premier épisode');
  } finally { fixture.cleanup(); }
});

for (const hlsSupported of [true, false]) {
  test(`une déconnexion AirPlay retrouve le moteur local et la position (MSE : ${hlsSupported})`, async () => {
    const fixture = playerFixture({ hlsSupported, autoPlay: true });
    fixture.video.webkitShowPlaybackTargetPicker = noop;
    fixture.video.currentTime = 42;
    const stopObserving = fixture.observeAirPlay();
    try {
      await fixture.startAirPlay();
      fixture.render();
      fixture.video.dispatchEvent(new Event('loadedmetadata'));
      fixture.video.currentTime = 73;
      fixture.video.paused = true;
      fixture.video.webkitCurrentPlaybackTargetIsWireless = true;
      fixture.video.dispatchEvent(new Event('webkitcurrentplaybacktargetiswirelesschanged'));
      fixture.video.webkitCurrentPlaybackTargetIsWireless = false;
      fixture.video.dispatchEvent(new Event('webkitcurrentplaybacktargetiswirelesschanged'));
      fixture.render();
      if (hlsSupported) fixture.manifest();
      fixture.video.dispatchEvent(new Event('loadedmetadata'));
      assert.equal(Boolean(fixture.hls), hlsSupported);
      assert.equal(fixture.video.currentTime, 73);
      assert.equal(fixture.video.paused, true, 'le retour local ne force pas la lecture');
      assert.equal(fixture.fallbackCount(), 0, 'Safari natif ne doit pas changer de serveur au retour');
    } finally { stopObserving(); fixture.cleanup(); }
  });
}

test('une erreur native AirPlay restaure le lecteur sans callbacks de chargement résiduels', async () => {
  const fixture = playerFixture();
  fixture.video.webkitShowPlaybackTargetPicker = noop;
  try {
    await fixture.startAirPlay();
    fixture.render();
    fixture.video.dispatchEvent(new Event('error'));
    assert.equal(fixture.bindings.nativeAirPlay, false);
    assert.equal(fixture.bindings.isAirPlayLoading, false);
    assert.equal(fixture.bindings.airPlayError, 'watch.airplayError');
    fixture.render();
    fixture.manifest();
    fixture.video.dispatchEvent(new Event('loadedmetadata'));
    assert.ok(fixture.hls);
    assert.equal(fixture.video.currentTime, 42);
    fixture.cleanup();
    assert.equal(fixture.timers.size, 0);
    fixture.video.dispatchEvent(new Event('error'));
    assert.equal(fixture.fallbackCount(), 0);
  } finally { fixture.cleanup(); }
});
