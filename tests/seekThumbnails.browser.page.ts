// Page du banc `seekThumbnails.browser.mjs`. Elle encode une vraie vidéo
// H.264 dans le navigateur, la range dans des conteneurs TS, fMP4 et MP4, la
// dépose sur le serveur du banc, puis demande des miniatures au vrai
// SeekThumbnailer et vérifie la couleur de chaque image rendue.
import { hlsThumbnailTarget, type ThumbnailTarget } from '../src/services/seekThumbnails/hlsTarget.ts';
import { SeekThumbnailer } from '../src/services/seekThumbnails/seekThumbnailer.ts';
import {
  buildFragment, buildInitSegment, buildMp4, buildTs, bytes, type Mp4Sample,
} from './seekThumbnailFixtures.ts';

const WIDTH = 320;
const HEIGHT = 180;
const COLORS: Array<[number, number, number]> = [[215, 35, 35], [35, 190, 60], [45, 70, 215]];
const NAMES = ['rouge', 'vert', 'bleu'];
/** Durée d'une image, en microsecondes : trois images par couleur, 1,5 s. */
const FRAME_US = 500_000;

type Gop = { key: Uint8Array; deltas: Uint8Array[] };
type Encoded = { gops: Gop[]; description?: Uint8Array };

const results: Array<{ name: string; ok: boolean; detail: unknown }> = [];
const log = (name: string, ok: boolean, detail: unknown = null) => results.push({ name, ok, detail });

const encode = async (format: 'annexb' | 'avc'): Promise<Encoded> => {
  const config: VideoEncoderConfig = {
    codec: 'avc1.42001f', width: WIDTH, height: HEIGHT, bitrate: 600_000, framerate: 2, avc: { format },
  };
  if (!(await VideoEncoder.isConfigSupported(config)).supported) {
    throw new Error('encodeur H.264 indisponible dans ce navigateur');
  }

  const out: Encoded = { gops: [] };
  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      const description = metadata?.decoderConfig?.description;
      if (description && !out.description) {
        out.description = description instanceof ArrayBuffer
          ? new Uint8Array(description.slice(0))
          : new Uint8Array(description.buffer.slice(description.byteOffset, description.byteOffset + description.byteLength) as ArrayBuffer);
      }
      if (chunk.type === 'key') out.gops.push({ key: data, deltas: [] });
      else out.gops[out.gops.length - 1].deltas.push(data);
    },
    error: (error) => { throw error; },
  });
  encoder.configure(config);

  const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas 2D indisponible');
  let timestamp = 0;
  for (const [red, green, blue] of COLORS) {
    for (let i = 0; i < 3; i++) {
      context.fillStyle = `rgb(${red},${green},${blue})`;
      context.fillRect(0, 0, WIDTH, HEIGHT);
      // Un carré qui bouge : les images suivantes ne sont pas vides.
      context.fillStyle = 'white';
      context.fillRect(10 + i * 12, 10, 24, 24);
      const frame = new VideoFrame(canvas, { timestamp, duration: FRAME_US });
      encoder.encode(frame, { keyFrame: i === 0 });
      frame.close();
      timestamp += FRAME_US;
    }
  }
  await encoder.flush();
  encoder.close();
  return out;
};

const put = async (name: string, data: Uint8Array) => {
  const response = await fetch(`/media/${name}`, { method: 'PUT', body: data as BodyInit });
  if (!response.ok) throw new Error(`dépôt de ${name} : ${response.status}`);
};

const absolute = (path: string) => new URL(path, location.href).href;

const probe = document.createElement('canvas');
const centerColor = (bitmap: ImageBitmap): [number, number, number] => {
  probe.width = bitmap.width;
  probe.height = bitmap.height;
  const context = probe.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('canvas 2D indisponible');
  context.drawImage(bitmap, 0, 0);
  const pixel = context.getImageData(bitmap.width >> 1, bitmap.height >> 1, 1, 1).data;
  return [pixel[0], pixel[1], pixel[2]];
};

const describe = (bitmap: ImageBitmap) => `${bitmap.width}x${bitmap.height} rgb(${centerColor(bitmap).join(',')})`;

const matches = (bitmap: ImageBitmap | null, color: number): boolean => {
  if (!bitmap) return false;
  const got = centerColor(bitmap);
  const want = COLORS[color];
  return Math.hypot(got[0] - want[0], got[1] - want[1], got[2] - want[2]) < 60;
};

const hlsTarget = (name: string, index: number, extra: Record<string, unknown> = {}): ThumbnailTarget => {
  const target = hlsThumbnailTarget(
    { url: `/media/${name}`, start: index * 1.5, duration: 1.5, ...extra },
    location.href,
  );
  if (!target) throw new Error(`cible refusée pour ${name}`);
  return target;
};

const expectColor = async (
  label: string,
  thumbnails: SeekThumbnailer,
  target: ThumbnailTarget,
  time: number,
  color: number,
) => {
  const started = performance.now();
  const bitmap = await thumbnails.load(target, time);
  const elapsed = Math.round(performance.now() - started);
  log(label, matches(bitmap, color), bitmap
    ? `${describe(bitmap)}, attendu ${NAMES[color]}, ${elapsed} ms`
    : `aucune image, ${elapsed} ms`);
};

const local = async () => {
  log('WebCodecs présent', SeekThumbnailer.isSupported(), navigator.userAgent);

  const annexb = await encode('annexb');
  const avc = await encode('avc');
  log('encodage de test', annexb.gops.length === 3 && avc.gops.length === 3 && !!avc.description, {
    annexb: annexb.gops.map(gop => gop.key.length),
    avc: avc.gops.map(gop => gop.key.length),
    avcC: avc.description?.length,
  });
  const tsFrames = (index: number) => [annexb.gops[index].key, ...annexb.gops[index].deltas];

  // --- HLS en MPEG-TS : trois segments d'environ 1 Mo ---------------------
  for (let i = 0; i < 3; i++) await put(`seg${i}.ts`, buildTs({ frames: tsFrames(i), paddingPackets: 5500 }));
  let thumbnails = new SeekThumbnailer(384);
  for (let i = 0; i < 3; i++) {
    await expectColor(`HLS TS, segment ${i}`, thumbnails, hlsTarget(`seg${i}.ts`, i), i * 1.5 + 0.7, i);
  }

  // Le cache répond sans réseau, sur tout l'intervalle du segment.
  log('cache : image du segment disponible aussitôt', matches(thumbnails.peek(1.6), 1) && thumbnails.peek(99) === null);

  // Rafale : 0 part aussitôt, 3 vise le même segment et s'y raccroche ;
  // 1, 2 et 4 sont remplacées par la demande suivante.
  thumbnails.reset();
  const burst = await Promise.all([0, 1, 2, 0, 1, 2].map(i => (
    thumbnails.load(hlsTarget(`seg${i}.ts`, i), i * 1.5 + 0.2)
  )));
  log(
    'rafale : la dernière demande gagne',
    matches(burst[5], 2) && burst[0] !== null && burst[0] === burst[3] && [1, 2, 4].every(i => burst[i] === null),
    burst.map(bitmap => (bitmap ? 'image' : 'rien')).join(' '),
  );

  // --- Faux en-tête devant le flux ----------------------------------------
  const png = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], new Uint8Array(120));
  await put('masked.ts', buildTs({ frames: tsFrames(1), prefix: png, paddingPackets: 2000 }));
  thumbnails.reset();
  await expectColor('HLS TS derrière un faux en-tête PNG', thumbnails, hlsTarget('masked.ts', 0), 0.5, 1);

  // --- AES-128 --------------------------------------------------------------
  const keyBytes = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const aesKey = await crypto.subtle.importKey('raw', keyBytes, 'AES-CBC', false, ['encrypt']);
  const clear = buildTs({ frames: tsFrames(2), paddingPackets: 5500 });
  await put('enc.ts', new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, aesKey, clear as BufferSource)));
  await put('key.bin', keyBytes);
  thumbnails.reset();
  await expectColor('HLS TS chiffré AES-128, clé téléchargée', thumbnails, hlsTarget('enc.ts', 0, {
    decryptdata: { method: 'AES-128', uri: '/media/key.bin', iv, key: null },
  }), 0.5, 2);
  thumbnails.reset();
  await expectColor('HLS TS chiffré AES-128, clé déjà connue', thumbnails, hlsTarget('enc.ts', 0, {
    decryptdata: { method: 'AES-128', uri: '/media/absente.bin', iv, key: keyBytes },
  }), 0.5, 2);

  // --- HLS en fMP4 -----------------------------------------------------------
  const sample = (data: Uint8Array, key: boolean): Mp4Sample => ({ data, key, duration: 500 });
  const gopSamples = (gop: Gop) => [sample(gop.key, true), ...gop.deltas.map(delta => sample(delta, false))];
  const init = buildInitSegment({ config: avc.description });
  const fragments = avc.gops.map(gop => buildFragment(gopSamples(gop), { padding: 900_000 }));
  await put('init.mp4', init);
  for (let i = 0; i < 3; i++) await put(`frag${i}.m4s`, fragments[i]);
  thumbnails.reset();
  const initSegment = { url: '/media/init.mp4', start: 0, duration: 0 };
  for (let i = 0; i < 3; i++) {
    await expectColor(`HLS fMP4, segment ${i}`, thumbnails, hlsTarget(`frag${i}.m4s`, i, { initSegment }), i * 1.5 + 0.4, i);
  }

  // Un seul fichier, adressé par plages d'octets.
  await put('single.mp4', bytes(init, ...fragments));
  thumbnails.reset();
  let at = init.length;
  for (let i = 0; i < 3; i++) {
    const byteRange = [at, at + fragments[i].length];
    at = byteRange[1];
    await expectColor(`HLS fMP4 par plages, segment ${i}`, thumbnails, hlsTarget('single.mp4', i, {
      byteRange,
      initSegment: { url: '/media/single.mp4', start: 0, duration: 0, byteRange: [0, init.length] },
    }), i * 1.5 + 0.4, i);
  }

  // --- MP4 direct -------------------------------------------------------------
  const samples = avc.gops.flatMap(gopSamples);
  for (const moovLast of [false, true]) {
    const name = moovLast ? 'movie-tail.mp4' : 'movie-fast.mp4';
    await put(name, buildMp4({ samples, config: avc.description, moovLast, padding: 6 * 1024 * 1024 }).file);
    thumbnails.reset();
    const label = `MP4 direct, moov ${moovLast ? 'à la fin' : 'au début'}`;
    const url = absolute(`/media/${name}`);
    for (const [time, color] of [[0.2, 0], [2.9, 1], [3.4, 2]] as const) {
      await expectColor(`${label}, t=${time} s`, thumbnails, { job: { kind: 'mp4', url, time } }, time, color);
    }
    // L'intervalle rendu par le worker couvre tout le GOP.
    log(`${label} : cache par intervalle`, matches(thumbnails.peek(1.6), 1) && matches(thumbnails.peek(4.4), 2));
  }
  thumbnails.dispose();

  // --- Cas où le lecteur doit reprendre son ancien aperçu ---------------------
  thumbnails = new SeekThumbnailer(384);
  const noRange = await thumbnails.load({ job: { kind: 'mp4', url: absolute('/norange/movie-fast.mp4'), time: 3.4 } }, 3.4);
  log('serveur sourd à Range : abandon propre', noRange === null && thumbnails.disabled);
  thumbnails.dispose();

  thumbnails = new SeekThumbnailer(384);
  const missing = await thumbnails.load(hlsTarget('absent.ts', 0), 0.5);
  log('segment 404 : abandon propre', missing === null && thumbnails.disabled);
  thumbnails.dispose();

  thumbnails = new SeekThumbnailer(384);
  const limited = await thumbnails.load(
    { job: { kind: 'hls', segment: { url: absolute('/limited/seg0.ts') } }, span: { from: 0, to: 1.5 } },
    0.5,
  );
  log('HTTP 429 : pause, sans abandon', limited === null && thumbnails.paused && !thumbnails.disabled);
  thumbnails.dispose();

  thumbnails = new SeekThumbnailer(384);
  await put('junk.ts', new Uint8Array(300_000).fill(0x11));
  const junk = await thumbnails.load(hlsTarget('junk.ts', 0), 0.5);
  log('fichier illisible : abandon propre', junk === null && thumbnails.disabled);
  thumbnails.dispose();
};

/** Flux publics de démonstration : un vrai encodeur derrière un vrai CDN. */
const live = async () => {
  console.debug = (...args: unknown[]) => { log('   journal', true, args.join(' ')); };
  const thumbnails = new SeekThumbnailer(384);

  const playlist = async (url: string) => (
    (await (await fetch(url)).text()).split('\n').map(line => line.trim()).filter(Boolean)
  );
  // Plage « longueur@début » ; sans début, elle suit le segment précédent.
  const range = (text: string | undefined, previousEnd: number): number[] | undefined => {
    const match = text?.match(/(\d+)(?:@(\d+))?/);
    if (!match) return undefined;
    const start = match[2] !== undefined ? Number(match[2]) : previousEnd;
    return [start, start + Number(match[1])];
  };

  const tryStream = async (label: string, master: string) => {
    try {
      const variantLine = (await playlist(master)).find(line => !line.startsWith('#'));
      if (!variantLine) throw new Error('playlist maîtresse vide');
      const variant = new URL(variantLine, master).href;
      const media = await playlist(variant);
      const mapLine = media.find(line => line.startsWith('#EXT-X-MAP'));
      const map = mapLine?.match(/URI="([^"]+)"/)?.[1];
      const mapRange = range(mapLine?.match(/BYTERANGE="([^"]+)"/)?.[1], 0);

      const segments: Array<{ url: string; byteRange?: number[] }> = [];
      let pending: string | undefined;
      let previousEnd = 0;
      for (const line of media) {
        if (line.startsWith('#EXT-X-BYTERANGE:')) {
          pending = line.slice('#EXT-X-BYTERANGE:'.length);
        } else if (!line.startsWith('#')) {
          const byteRange = range(pending, previousEnd);
          if (byteRange) previousEnd = byteRange[1];
          segments.push({ url: line, byteRange });
          pending = undefined;
        }
      }
      log(`${label} : playlist`, segments.length > 0, `${segments.length} segments, plages=${!!segments[0]?.byteRange}, init=${map ?? 'aucun'}`);

      thumbnails.reset();
      for (const index of [0, Math.min(3, segments.length - 1)]) {
        const started = performance.now();
        const target = hlsThumbnailTarget({
          ...segments[index],
          start: index * 10,
          duration: 10,
          initSegment: map ? { url: map, start: 0, duration: 0, byteRange: mapRange } : null,
        }, variant);
        const bitmap = target ? await thumbnails.load(target, index * 10 + 1) : null;
        log(`${label}, segment ${index}`, !!bitmap, bitmap
          ? `${describe(bitmap)}, ${Math.round(performance.now() - started)} ms`
          : `échec (abandon=${thumbnails.disabled})`);
      }
    } catch (error) {
      log(label, false, `inaccessible : ${error}`);
    }
  };

  await tryStream('flux public TS', 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8');
  await tryStream('flux public fMP4', 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8');

  thumbnails.reset();
  const mp4 = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
  for (const time of [1, 4]) {
    const started = performance.now();
    const bitmap = await thumbnails.load({ job: { kind: 'mp4', url: mp4, time } }, time);
    log(`MP4 public, t=${time} s`, !!bitmap, bitmap
      ? `${describe(bitmap)}, ${Math.round(performance.now() - started)} ms`
      : `échec (abandon=${thumbnails.disabled})`);
  }
  thumbnails.dispose();
};

const finish = (error?: unknown) => fetch('/result', {
  method: 'POST',
  body: JSON.stringify({
    results,
    error: error ? String(error instanceof Error ? error.stack ?? error.message : error) : null,
  }),
});

window.addEventListener('unhandledrejection', (event) => { void finish(event.reason); });
(new URLSearchParams(location.search).has('live') ? live() : local()).then(() => finish(), finish);
