// Miniatures de la barre de progression : les analyseurs doivent trouver la
// première image clé sans lire tout le segment, situer les images d'un MP4
// d'après sa table, et déchiffrer un segment AES coupé en route.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createCbcDecryptor } from '../src/services/seekThumbnails/aesCbc.ts';
import { findFragmentAt, hlsThumbnailTarget } from '../src/services/seekThumbnails/hlsTarget.ts';
import { hevcCodecString } from '../src/services/seekThumbnails/media.ts';
import {
  findFirstFragmentSample,
  findKeyframe,
  locateMoov,
  looksLikeMp4,
  parseInitSegment,
  parseMoov,
} from '../src/services/seekThumbnails/mp4Keyframe.ts';
import { scanTsKeyframe } from '../src/services/seekThumbnails/tsKeyframe.ts';
import {
  box, buildFragment, buildInitSegment, buildMp4, buildTs, bytes, fakeAccessUnit, FAKE_AVCC,
} from './seekThumbnailFixtures.ts';

const found = (scan: ReturnType<typeof scanTsKeyframe>) => {
  assert.equal(scan.status, 'found');
  if (scan.status !== 'found') throw new Error('image clé attendue');
  return scan.keyframe;
};

test('TS : la première image clé sort sans lire la fin du segment', () => {
  const key = fakeAccessUnit({ key: true, size: 2000 });
  const segment = buildTs({
    frames: [key, fakeAccessUnit({ key: false }), fakeAccessUnit({ key: false })],
    paddingPackets: 4000,
  });
  // Assez pour l'image clé et le début de la suivante, soit 1 % du segment.
  const head = segment.subarray(0, 188 * 20);
  assert.ok(head.length < segment.length / 100 * 2);
  const keyframe = found(scanTsKeyframe(head, false));
  assert.equal(keyframe.codec, 'avc1.64001f');
  assert.deepEqual(keyframe.data, key);
  assert.equal(keyframe.description, undefined);
});

test('TS : une image coupée demande la suite, puis se complète', () => {
  const key = fakeAccessUnit({ key: true, size: 5000 });
  const segment = buildTs({ frames: [key, fakeAccessUnit({ key: false })] });
  assert.equal(scanTsKeyframe(segment.subarray(0, 188 * 6), false).status, 'need-more');
  assert.deepEqual(found(scanTsKeyframe(segment, false)).data, key);
});

test('TS : la dernière image d\'un segment complet compte, même sans paquet après elle', () => {
  const key = fakeAccessUnit({ key: true });
  const segment = buildTs({ frames: [fakeAccessUnit({ key: false }), key] }).subarray(0, 188 * 7);
  assert.equal(scanTsKeyframe(segment, false).status, 'need-more');
  assert.deepEqual(found(scanTsKeyframe(segment, true)).data, key);
});

test('TS : la longueur du paquet PES clôt l\'image sans attendre la suivante', () => {
  const key = fakeAccessUnit({ key: true, size: 700 });
  const segment = buildTs({ frames: [key], boundedPes: true });
  // Sans le paquet audio qui suit, et sans dire que le segment est fini.
  const videoOnly = segment.subarray(0, 188 * (2 + Math.ceil((key.length + 14) / 184)));
  assert.deepEqual(found(scanTsKeyframe(videoOnly, false)).data, key);
});

test('TS : un faux en-tête devant le flux n\'empêche pas la synchro', () => {
  const key = fakeAccessUnit({ key: true });
  const png = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], new Uint8Array(77).fill(0x47));
  const segment = buildTs({ frames: [key, fakeAccessUnit({ key: false })], prefix: png });
  assert.deepEqual(found(scanTsKeyframe(segment, true)).data, key);
});

test('TS : une image clé sans ses paramètres reçoit ceux vus plus tôt', () => {
  const withParams = fakeAccessUnit({ key: false, params: true });
  const bareKey = fakeAccessUnit({ key: true, params: false });
  const segment = buildTs({ frames: [withParams, bareKey, fakeAccessUnit({ key: false })] });
  const keyframe = found(scanTsKeyframe(segment, true));
  // SPS puis PPS en tête, chacun derrière un code de départ, puis l'image.
  assert.deepEqual(keyframe.data.subarray(0, 5), Uint8Array.from([0, 0, 0, 1, 0x67]));
  assert.deepEqual(keyframe.data.subarray(keyframe.data.length - bareKey.length), bareKey);
});

test('TS : GOP ouvert, une image I avec ses paramètres sert d\'entrée', () => {
  const open = fakeAccessUnit({ key: false, params: true, intra: true });
  const segment = buildTs({ frames: [fakeAccessUnit({ key: false }), open, fakeAccessUnit({ key: false })] });
  assert.deepEqual(found(scanTsKeyframe(segment, true)).data, open);
});

test('TS : ni image clé ni synchro, c\'est dit plutôt que d\'attendre sans fin', () => {
  const noKey = buildTs({ frames: [fakeAccessUnit({ key: false }), fakeAccessUnit({ key: false })] });
  assert.equal(scanTsKeyframe(noKey, true).status, 'unsupported');
  assert.equal(scanTsKeyframe(new Uint8Array(4096).fill(0x11), true).status, 'unsupported');
  assert.equal(scanTsKeyframe(new Uint8Array(4096).fill(0x11), false).status, 'need-more');
});

test('TS : HEVC, la chaîne de codec vient du SPS', () => {
  // SPS « Main, niveau 3.1 » avec ses octets anti-émulation (00 00 03).
  const sps = [
    0x42, 0x01, 0x01, 0x01, 0x60, 0x00, 0x00, 0x03, 0x00, 0x90, 0x00, 0x00, 0x03,
    0x00, 0x00, 0x03, 0x00, 0x5d, 0xa0, 0x02, 0x80,
  ];
  const unit = bytes(
    [0, 0, 0, 1, 0x40, 0x01, 0x0c, 0x01], [0, 0, 0, 1, ...sps], [0, 0, 0, 1, 0x44, 0x01, 0xc1],
    [0, 0, 1, 0x26, 0x01], new Uint8Array(200).fill(0xab),
  );
  const segment = buildTs({ frames: [unit], hevc: true });
  assert.equal(found(scanTsKeyframe(segment, true)).codec, 'hev1.1.6.L93.90');
  assert.equal(
    hevcCodecString('hvc1', Uint8Array.from([0x22, 0x20, 0, 0, 0, 0xb0, 0, 0, 0, 0, 0, 150])),
    'hvc1.2.4.H150.B0',
  );
});

const samples = (count: number, keyEvery: number) => Array.from({ length: count }, (_, index) => ({
  data: new Uint8Array(100 + index).fill(index + 1),
  key: index % keyEvery === 0,
  duration: 500,
}));

for (const moovLast of [false, true]) {
  test(`MP4 : table des images clés, moov ${moovLast ? 'à la fin' : 'au début'}`, () => {
    const list = samples(9, 4);
    const { file, offsets } = buildMp4({ samples: list, moovLast, padding: 3 * 1024 * 1024 });

    // Le début du fichier suffit à dire où est moov.
    let location = locateMoov(file.subarray(0, 4096));
    let base = 0;
    if (moovLast) {
      assert.equal(location.status, 'elsewhere');
      if (location.status !== 'elsewhere') return;
      base = location.offset;
      location = locateMoov(file.subarray(base), base);
    }
    assert.equal(location.status, 'found');
    if (location.status !== 'found') return;

    const { track, keyframes } = parseMoov(file.subarray(base), location.start, location.end);
    assert.equal(track.codec, 'avc1.64001f');
    assert.equal(track.trackId, 2);
    assert.deepEqual(track.description, FAKE_AVCC);
    assert.deepEqual(Array.from(keyframes.times), [0, 2, 4]);
    assert.deepEqual(Array.from(keyframes.offsets), [offsets[0], offsets[4], offsets[8]]);

    // Chaque position pointe bien sur les octets de l'image.
    const ref = findKeyframe(keyframes, 3.9);
    assert.ok(ref);
    assert.deepEqual({ from: ref.from, to: ref.to }, { from: 2, to: 4 });
    assert.deepEqual(file.subarray(ref.offset, ref.offset + ref.size), list[4].data);
    assert.equal(findKeyframe(keyframes, 99)?.to, Infinity);
    assert.equal(findKeyframe(keyframes, -1)?.from, 0);
  });
}

test('MP4 : moov coupé, on sait combien d\'octets il manque', () => {
  const { file } = buildMp4({ samples: samples(40, 5) });
  const location = locateMoov(file.subarray(0, 200));
  assert.equal(location.status, 'partial');
  if (location.status !== 'partial') return;
  assert.equal(locateMoov(file.subarray(0, location.needed)).status, 'found');
  assert.equal(locateMoov(file.subarray(0, 6)).status, 'need-more');
});

test('MP4 : sans table des images clés, on en garde une par quart de seconde', () => {
  const list = Array.from({ length: 20 }, (_, index) => ({
    data: new Uint8Array(50).fill(index), key: true, duration: 100,
  }));
  const { file } = buildMp4({ samples: list, noSyncTable: true });
  const location = locateMoov(file);
  assert.equal(location.status, 'found');
  if (location.status !== 'found') return;
  const { keyframes } = parseMoov(file, location.start, location.end);
  assert.deepEqual(Array.from(keyframes.times), [0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8]);
});

test('MP4 : ce qui n\'est pas exploitable est refusé clairement', () => {
  // WebM déguisé en .mp4
  assert.equal(locateMoov(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 1, 2, 3, 4])).status, 'unsupported');
  // Vidéo protégée : l'entrée s'appelle encv.
  const drm = buildMp4({ samples: samples(2, 1), format: 'encv' }).file;
  const location = locateMoov(drm);
  assert.equal(location.status, 'found');
  if (location.status !== 'found') return;
  assert.throws(() => parseMoov(drm, location.start, location.end), /encv/);
  // Fichier fragmenté d'un bloc : moov sans table.
  assert.equal(findKeyframe(parseInitMoov().keyframes, 3), null);
});

const parseInitMoov = () => {
  const init = buildInitSegment({});
  const location = locateMoov(init);
  if (location.status !== 'found') throw new Error('moov attendu');
  return parseMoov(init, location.start, location.end);
};

test('fMP4 : la première image du segment se lit dans moof', () => {
  const track = parseInitSegment(buildInitSegment({ trackId: 7 }));
  assert.equal(track.codec, 'avc1.64001f');
  assert.equal(track.trackId, 7);

  const list = samples(3, 3);
  const segment = buildFragment(list, { trackId: 7, padding: 500_000 });
  assert.ok(looksLikeMp4(segment));

  // moof incomplet : il faut lire la suite.
  assert.equal(findFirstFragmentSample(segment.subarray(0, 60), track, false).status, 'need-more');
  const sample = findFirstFragmentSample(segment.subarray(0, 400), track, false);
  assert.equal(sample.status, 'found');
  if (sample.status !== 'found') return;
  assert.deepEqual(segment.subarray(sample.offset, sample.offset + sample.size), list[0].data);

  // Une autre piste que la vidéo : rien à en tirer.
  assert.equal(findFirstFragmentSample(segment, { trackId: 1, defaultSampleSize: 0 }, true).status, 'unsupported');
});

test('fMP4 : les codecs HEVC, AV1 et VP9 donnent leur chaîne', () => {
  const codecOf = (format: string, configType: string, config: number[]) => parseInitSegment(
    buildInitSegment({ format, configType, config: Uint8Array.from(config) }),
  ).codec;
  assert.equal(
    codecOf('hvc1', 'hvcC', [1, 0x01, 0x60, 0, 0, 0, 0x90, 0, 0, 0, 0, 0, 93, 0xf0]),
    'hvc1.1.6.L93.90',
  );
  assert.equal(codecOf('av01', 'av1C', [0x81, 0x08, 0x0c, 0x00]), 'av01.0.08M.08');
  assert.equal(codecOf('av01', 'av1C', [0x81, 0x0d, 0x4c, 0x00]), 'av01.0.13M.10');
  assert.equal(codecOf('vp09', 'vpcC', [1, 0, 0, 0, 0, 31, 0x80, 1, 1, 1]), 'vp09.00.31.08');
});

test('TS et MP4 ne se confondent pas', () => {
  assert.equal(looksLikeMp4(buildTs({ frames: [fakeAccessUnit({ key: true })] })), false);
  assert.ok(looksLikeMp4(box('styp', [1, 2, 3, 4])));
});

test('AES-128 : le début d\'un segment se déchiffre sans attendre sa fin', async () => {
  const keyBytes = Uint8Array.from({ length: 16 }, (_, index) => index * 7 + 1);
  const iv = Uint8Array.from({ length: 16 }, (_, index) => 255 - index);
  const plain = Uint8Array.from({ length: 5000 }, (_, index) => (index * 31) & 0xff);
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-CBC', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, plain));

  // Morceaux de tailles quelconques, comme le réseau les livre.
  const decrypt = await createCbcDecryptor(keyBytes, iv);
  const first = await decrypt(cipher.subarray(0, 1001), false);
  assert.deepEqual(first, plain.subarray(0, 992));
  const second = await decrypt(cipher.subarray(1001, 1003), false);
  assert.equal(second.length, 0);
  const third = await decrypt(cipher.subarray(1003, 3000), false);
  assert.deepEqual(third, plain.subarray(992, 2992));

  // Jusqu'au bout : tout le clair est là, suivi du seul bourrage.
  const rest = await decrypt(cipher.subarray(3000), true);
  assert.deepEqual(rest.subarray(0, plain.length - 2992), plain.subarray(2992));
  assert.ok(rest.length - (plain.length - 2992) <= 16);

  await assert.rejects(createCbcDecryptor(keyBytes.subarray(0, 8), iv));
});

test('HLS : un fragment devient une demande de miniature', () => {
  const playlist = 'https://cdn.test/video/720p/index.m3u8';
  const fragments = [0, 6, 12].map(start => ({ url: `seg${start}.ts`, start, duration: 6 }));
  assert.equal(findFragmentAt(fragments, 0)?.start, 0);
  assert.equal(findFragmentAt(fragments, 11.9)?.start, 6);
  assert.equal(findFragmentAt(fragments, 12)?.start, 12);
  // Le dernier pixel de la barre tombe après la fin : dernier fragment.
  assert.equal(findFragmentAt(fragments, 18.2)?.start, 12);
  assert.equal(findFragmentAt([], 3), null);

  assert.deepEqual(hlsThumbnailTarget(fragments[1], playlist), {
    job: { kind: 'hls', segment: { url: 'https://cdn.test/video/720p/seg6.ts' } },
    span: { from: 6, to: 12 },
  });

  const iv = new Uint8Array(16).fill(3);
  const encrypted = hlsThumbnailTarget({
    url: 'https://cdn.test/all.mp4',
    start: 0,
    duration: 4,
    byteRange: [800, 1800],
    initSegment: { url: 'https://cdn.test/all.mp4', start: 0, duration: 0, byteRange: [0, 800] },
    decryptdata: { method: 'AES-128', uri: '../key.bin', iv, key: null },
  }, playlist);
  assert.deepEqual(encrypted?.job, {
    kind: 'hls',
    segment: {
      url: 'https://cdn.test/all.mp4',
      range: [800, 1800],
      aes: { iv, keyUrl: 'https://cdn.test/video/key.bin' },
    },
    init: { url: 'https://cdn.test/all.mp4', range: [0, 800] },
  });

  // DRM et trous de playlist : pas de miniature possible.
  const sampleAes = { method: 'SAMPLE-AES', uri: 'skd://key', iv, key: null };
  assert.equal(hlsThumbnailTarget({ ...fragments[0], decryptdata: sampleAes }, playlist), null);
  assert.equal(hlsThumbnailTarget({ ...fragments[0], gap: true }, playlist), null);
});
