import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceFunction } from './helpers/sourceFunction.mjs';

// Uqload sert du HLS (`/hls2/…/master.m3u8`) comme du MP4 (`v.mp4`) : seul le
// MP4 va à la balise <video>, le manifeste passe par hls.js (Firefox refuse
// `application/vnd.apple.mpegurl` en lecture native).
const isMP4Source = sourceFunction('src/components/HLSPlayer.tsx', 'isMP4Source', {
  normalizeUqloadEmbedUrl: url => url,
  PROXIES_EMBED_API: 'https://proxiesembed.movix.miami',
});

test('un master Uqload proxifié reste du HLS', () => {
  const hls = 'https://proxiesembed.movix.miami/uqload-proxy?url=https%3A//strm12.uqload.vc/hls2/02/05842/'
    + '71y90y25hplf_%2Cl%2Cn%2Ch%2C.urlset/master.m3u8%3Ft%3Dx%26s%3D1&exp=1&sig=y';
  assert.equal(isMP4Source(hls), false);
});

test('un fichier Uqload proxifié reste du MP4', () => {
  assert.equal(isMP4Source('https://proxiesembed.movix.miami/uqload-proxy?url=https%3A//m180.uqload.vc/x/v.mp4&sig=y'), true);
  assert.equal(isMP4Source('https://proxiesembed.movix.miami/proxy/https%3A%2F%2Fuqload.is%2Fembed-abc.html'), true);
});
