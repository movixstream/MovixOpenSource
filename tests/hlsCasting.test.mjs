import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceFunction, sourceJsxHandler } from './helpers/sourceFunction.mjs';
import { observeNativeAudioTracks, selectNativeAudioTrack } from '../src/utils/nativeAudioTracks.ts';

const player = 'src/components/HLSPlayer.tsx';
const cast = 'src/utils/castUtils.ts';
const noop = () => {};
const silentConsole = { log: noop, warn: noop, error: noop };

test('le bouton AirPlay reste utilisable quand ManagedMediaSource masque les récepteurs', () => {
  const video = Object.assign(new EventTarget(), { disableRemotePlayback: true });
  let available;
  const cleanup = sourceFunction(cast, 'initializeAirPlay', {
    isAirPlaySupported: () => true, console: silentConsole,
  })(video, state => { available = state.isAvailable; });
  try {
    video.dispatchEvent(Object.assign(new Event('webkitplaybacktargetavailabilitychanged'), { availability: 'unavailable' }));
    assert.equal(available, false);
    const canRequestAirPlay = sourceFunction(player, 'canRequestAirPlay', {
      airPlaySupported: true, airPlayAvailable: available,
    });
    let pickerCalls = 0;
    sourceJsxHandler(player, 'onClick', '!castAvailable && !canRequestAirPlay', {
      isCasting: false, isAirPlaying: false, castAvailable: false, canRequestAirPlay,
      setShowControls: noop, setShowCastMenu: noop, setCastError: noop, setAirPlayError: noop,
      toggleAirPlay: () => { pickerCalls++; },
      toggleCast: () => assert.fail('Chromecast ne doit pas remplacer AirPlay sur Safari'),
    })({ stopPropagation: noop });
    assert.equal(pickerCalls, 1);
    assert.equal(video.disableRemotePlayback, true, 'la découverte seule ne réactive jamais la sortie distante');
  } finally { cleanup(); }
});

test('le diagnostic distingue iOS, SDK en attente, SDK absent et aucun récepteur', () => {
  for (const [navigator, chrome, unavailable, expected] of [
    [{ userAgent: 'Mozilla/5.0 (iPhone) CriOS/130.0 Mobile Safari/604.1' }, {}, true, 'castUnavailableIOS'],
    [{ userAgent: 'Mozilla/5.0 (Macintosh) Safari/605.1', platform: 'MacIntel', maxTouchPoints: 5 }, {}, true, 'castUnavailableIOS'],
    [{ userAgent: 'Mozilla/5.0 Firefox/130.0' }, {}, true, 'castUnavailableUnsupportedBrowser'],
    [{ userAgent: 'Mozilla/5.0 Chrome/130.0.0.0' }, {}, false, 'castSdkLoading'],
    [{ userAgent: 'Mozilla/5.0 Chrome/130.0.0.0' }, {}, true, 'castUnavailableSdkUnavailable'],
    [{ userAgent: 'Mozilla/5.0 Chrome/130.0.0.0' }, { cast: { isAvailable: true } }, true, 'castUnavailableNoDevices'],
  ]) {
    const window = { chrome };
    const isIOSBrowser = sourceFunction(cast, 'isIOSBrowser', { navigator });
    const isWebCastSupported = sourceFunction(cast, 'isWebCastSupported', { navigator, window, isIOSBrowser });
    const reason = sourceFunction(cast, 'getCastUnavailableReason', { window, isIOSBrowser, isWebCastSupported });
    assert.equal(reason(unavailable), `watch.${expected}`);
  }
});

test('Cast envoie le master contenant la piste française séparée, pas la variante vidéo seule', async () => {
  const masterUrl = 'https://media.test/master.m3u8';
  const master = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="French",LANGUAGE="fr",DEFAULT=YES,URI="audio/fr.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720,AUDIO="audio"\nvideo/720.m3u8\n';
  const fetch = async () => ({ ok: true, text: async () => master });
  const parseStreamInfo = sourceFunction(cast, 'parseStreamInfo');
  const parseM3u8Manifest = sourceFunction(cast, 'parseM3u8Manifest', { fetch, parseStreamInfo, URL, console: silentConsole });
  const selectBestStream = sourceFunction(cast, 'selectBestStream');
  const preferFrenchAudioVariant = sourceFunction(cast, 'preferFrenchAudioVariant', { fetch, console: silentConsole });
  const buildSource = sourceFunction(player, 'buildCurrentCastSource', {
    useCallback: fn => fn, src: masterUrl, parseM3u8Manifest, selectBestStream, preferFrenchAudioVariant,
    resolveCastContentType: () => 'application/vnd.apple.mpegurl', isSelectedKisskhMp4: false,
    title: 'Test', tvShow: undefined, poster: undefined,
    videoRef: { current: { currentTime: 42 } }, buildCurrentCastTracks: async () => [],
  });
  const source = await buildSource();
  assert.equal(source.url, masterUrl);
  assert.equal(source.currentTimeSec, 42);
});

test('le menu audio natif change la piste, la mémorise et la retrouve après rechargement', () => {
  const audioTracks = Object.assign(new EventTarget(), {
    0: { label: 'English', language: 'en', enabled: true },
    1: { label: 'Français', language: 'fr', enabled: false }, length: 2,
  });
  const video = Object.assign(new EventTarget(), { audioTracks });
  const preferences = new Map();
  let selected = -1;
  let options = [];
  const cleanup = observeNativeAudioTracks(video, () => preferences.get('film') ?? null, (tracks, index) => {
    options = tracks; selected = index;
  });
  try {
    sourceFunction(player, 'handleAudioTrackChange', {
      hlsRef: { current: null }, videoRef: { current: video }, audioTracks: options,
      hlsAudioPreferences: preferences, contentQualityKey: 'film', selectNativeAudioTrack,
      setCurrentAudioTrack: index => { selected = index; }, setShowSettings: noop,
    })(1);
    assert.equal(audioTracks[1].enabled, true);
    assert.equal(audioTracks[0].enabled, false);
    assert.equal(selected, 1);
    assert.equal(preferences.get('film').language, 'fr');

    // La source suivante annonce les mêmes langues dans l'ordre inverse.
    audioTracks[0] = { label: 'Français', language: 'fr', enabled: false };
    audioTracks[1] = { label: 'English', language: 'en', enabled: true };
    video.dispatchEvent(new Event('loadedmetadata'));
    assert.equal(selected, 0);
    assert.equal(audioTracks[0].enabled, true);
    assert.equal(audioTracks[1].enabled, false);

    audioTracks[0].enabled = false;
    audioTracks[1].enabled = true;
    audioTracks.dispatchEvent(new Event('change'));
    assert.equal(selected, 1, 'une sélection par Safari doit aussi être reflétée dans le menu');
    cleanup();
    audioTracks[0].enabled = true;
    audioTracks[1].enabled = false;
    audioTracks.dispatchEvent(new Event('change'));
    assert.equal(selected, 1, 'un ancien observateur ne doit plus modifier le menu');
  } finally { cleanup(); }
});
