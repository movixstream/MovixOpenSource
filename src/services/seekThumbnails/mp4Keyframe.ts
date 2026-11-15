/**
 * Images clés d'un MP4, sans télécharger la vidéo.
 *
 * - MP4 classique : la boîte `moov` contient la table de tous les échantillons.
 *   On en tire, pour chaque image clé, son instant, sa position et sa taille
 *   dans le fichier. Une miniature coûte alors une seule requête `Range` sur
 *   les octets de cette image.
 * - MP4 fragmenté (segments HLS en fMP4) : le segment d'initialisation donne le
 *   codec, et la boîte `moof` de chaque segment dit où commence sa première
 *   image.
 */
import { avcCodecString, hevcCodecString, unsupported } from './media.ts';

type Box = { type: string; start: number; body: number; end: number };

const u32 = (d: Uint8Array, at: number): number => (
  ((d[at] << 24) | (d[at + 1] << 16) | (d[at + 2] << 8) | d[at + 3]) >>> 0
);
const i32 = (d: Uint8Array, at: number): number => (
  (d[at] << 24) | (d[at + 1] << 16) | (d[at + 2] << 8) | d[at + 3]
);
const u64 = (d: Uint8Array, at: number): number => u32(d, at) * 4294967296 + u32(d, at + 4);
const fourcc = (d: Uint8Array, at: number): string => (
  String.fromCharCode(d[at], d[at + 1], d[at + 2], d[at + 3])
);

/** En-tête de boîte ; `size` vaut 0 quand la boîte court jusqu'à la fin du fichier. */
const readHeader = (
  d: Uint8Array,
  at: number,
  limit: number,
): { type: string; header: number; size: number } | null => {
  if (at + 8 > limit) return null;
  const size = u32(d, at);
  if (size !== 1) return { type: fourcc(d, at + 4), header: 8, size };
  if (at + 16 > limit) return null;
  return { type: fourcc(d, at + 4), header: 16, size: u64(d, at + 8) };
};

/** Boîtes entièrement contenues dans [from, to). */
const childBoxes = (d: Uint8Array, from: number, to: number): Box[] => {
  const boxes: Box[] = [];
  let at = from;
  while (at + 8 <= to) {
    const header = readHeader(d, at, to);
    if (!header) break;
    const size = header.size === 0 ? to - at : header.size;
    if (size < header.header || at + size > to) break;
    boxes.push({ type: header.type, start: at, body: at + header.header, end: at + size });
    at += size;
  }
  return boxes;
};

const childBox = (d: Uint8Array, parent: Box | undefined, type: string): Box | undefined => (
  parent ? childBoxes(d, parent.body, parent.end).find(box => box.type === type) : undefined
);

// ---------------------------------------------------------------------------
// Où est `moov` ?
// ---------------------------------------------------------------------------

export type MoovLocation =
  /** `moov` est entier dans le tampon, de `start` à `end`. */
  | { status: 'found'; start: number; end: number }
  /** La suite est proche : continuer à lire jusqu'à `needed` octets de tampon. */
  | { status: 'partial'; needed: number }
  /** `moov` est après une grosse boîte (mdat) : reprendre à cette position du fichier. */
  | { status: 'elsewhere'; offset: number }
  | { status: 'need-more' }
  | { status: 'unsupported'; reason: string };

/** En deçà, on laisse le flux arriver plutôt que d'ouvrir une autre requête. */
const NEARBY_BYTES = 1024 * 1024;

const isPrintable = (d: Uint8Array, at: number): boolean => {
  for (let i = at; i < at + 4; i++) {
    if (d[i] < 0x20 || d[i] > 0x7e) return false;
  }
  return true;
};

/**
 * Suit la chaîne des boîtes de premier niveau jusqu'à `moov`.
 * `baseOffset` est la position du tampon dans le fichier.
 */
export const locateMoov = (data: Uint8Array, baseOffset = 0): MoovLocation => {
  let at = 0;
  for (;;) {
    if (at + 8 > data.length) {
      if (at <= data.length) return { status: 'need-more' };
      return at - data.length <= NEARBY_BYTES
        ? { status: 'partial', needed: at + 8 }
        : { status: 'elsewhere', offset: baseOffset + at };
    }
    if (!isPrintable(data, at + 4)) return unsupported('ce fichier n\'est pas un MP4');
    const header = readHeader(data, at, data.length);
    if (!header) return { status: 'need-more' };
    if (header.type === 'moov') {
      if (header.size === 0) return unsupported('boîte moov sans taille');
      return at + header.size <= data.length
        ? { status: 'found', start: at, end: at + header.size }
        : { status: 'partial', needed: at + header.size };
    }
    // Taille nulle : la boîte (mdat) va jusqu'au bout, il n'y a rien derrière.
    if (header.size < header.header) return unsupported('boîte moov introuvable');
    at += header.size;
  }
};

// ---------------------------------------------------------------------------
// Lecture de `moov`
// ---------------------------------------------------------------------------

export type VideoTrack = {
  trackId: number;
  codec: string;
  description?: Uint8Array;
  /** Taille d'échantillon par défaut (boîte trex), utile aux fragments. */
  defaultSampleSize: number;
};

/** Images clés triées par instant ; trois tableaux parallèles. */
export type KeyframeIndex = {
  /** Instant en secondes. */
  times: Float64Array;
  /** Position dans le fichier. */
  offsets: Float64Array;
  sizes: Uint32Array;
};

export type MoovInfo = { track: VideoTrack; keyframes: KeyframeIndex };

/** Longueur de l'en-tête d'une entrée vidéo de `stsd`, avant ses boîtes enfants. */
const VISUAL_SAMPLE_ENTRY = 86;

const readVideoCodec = (d: Uint8Array, stsd: Box): { codec: string; description?: Uint8Array } => {
  const entryStart = stsd.body + 8;
  if (entryStart + VISUAL_SAMPLE_ENTRY > stsd.end) throw new Error('boîte stsd tronquée');
  const entryEnd = Math.min(stsd.end, entryStart + u32(d, entryStart));
  const format = fourcc(d, entryStart + 4);
  const boxes = childBoxes(d, entryStart + VISUAL_SAMPLE_ENTRY, entryEnd);
  const config = (type: string): Uint8Array => {
    const box = boxes.find(candidate => candidate.type === type);
    if (!box) throw new Error(`boîte ${type} absente`);
    return d.slice(box.body, box.end);
  };

  switch (format) {
    case 'avc1':
    case 'avc3': {
      const avcC = config('avcC');
      if (avcC.length < 4) throw new Error('boîte avcC tronquée');
      return { codec: avcCodecString(format, avcC[1], avcC[2], avcC[3]), description: avcC };
    }
    case 'hvc1':
    case 'hev1': {
      const hvcC = config('hvcC');
      if (hvcC.length < 13) throw new Error('boîte hvcC tronquée');
      return { codec: hevcCodecString(format, hvcC.subarray(1, 13)), description: hvcC };
    }
    case 'av01': {
      const av1C = config('av1C');
      if (av1C.length < 4) throw new Error('boîte av1C tronquée');
      const profile = av1C[1] >> 5;
      const level = av1C[1] & 0x1f;
      const tier = av1C[2] & 0x80 ? 'H' : 'M';
      const twelveBit = profile === 2 && (av1C[2] & 0x20) !== 0;
      const depth = av1C[2] & 0x40 ? (twelveBit ? 12 : 10) : 8;
      return {
        codec: `av01.${profile}.${String(level).padStart(2, '0')}${tier}.${String(depth).padStart(2, '0')}`,
      };
    }
    case 'vp09': {
      const vpcC = config('vpcC');
      if (vpcC.length < 7) throw new Error('boîte vpcC tronquée');
      const two = (value: number) => String(value).padStart(2, '0');
      return { codec: `vp09.${two(vpcC[4])}.${two(vpcC[5])}.${two(vpcC[6] >> 4)}` };
    }
    default:
      // `encv` (DRM) et les vieux codecs arrivent ici.
      throw new Error(`codec vidéo non géré : ${format}`);
  }
};

/** Sans table des images clés, garder au plus une image par quart de seconde. */
const MIN_KEYFRAME_GAP = 0.25;

const EMPTY_INDEX: KeyframeIndex = {
  times: new Float64Array(0),
  offsets: new Float64Array(0),
  sizes: new Uint32Array(0),
};

/**
 * Parcourt une fois la table des échantillons pour situer chaque image clé.
 * La position d'un échantillon n'est écrite nulle part : elle se déduit du
 * début de son bloc (stco) et de la taille des échantillons qui le précèdent.
 */
const buildKeyframeIndex = (d: Uint8Array, stbl: Box, timescale: number): KeyframeIndex => {
  const boxes = childBoxes(d, stbl.body, stbl.end);
  const find = (type: string) => boxes.find(box => box.type === type);
  const stsz = find('stsz');
  const stco = find('stco');
  const co64 = find('co64');
  const stsc = find('stsc');
  const stts = find('stts');
  const stss = find('stss');
  const chunkBox = stco ?? co64;
  if (!stsz || !chunkBox || !stsc || !stts || !timescale) return EMPTY_INDEX;

  const fixedSize = u32(d, stsz.body + 4);
  const sizesAt = stsz.body + 12;
  let sampleCount = u32(d, stsz.body + 8);
  if (!fixedSize) sampleCount = Math.min(sampleCount, Math.floor((stsz.end - sizesAt) / 4));

  const wide = !stco;
  const chunksAt = chunkBox.body + 8;
  const chunkCount = Math.min(
    u32(d, chunkBox.body + 4),
    Math.floor((chunkBox.end - chunksAt) / (wide ? 8 : 4)),
  );

  const stscAt = stsc.body + 8;
  const stscCount = Math.min(u32(d, stsc.body + 4), Math.floor((stsc.end - stscAt) / 12));
  const sttsAt = stts.body + 8;
  const sttsCount = Math.min(u32(d, stts.body + 4), Math.floor((stts.end - sttsAt) / 8));
  const syncAt = stss ? stss.body + 8 : 0;
  const syncCount = stss ? Math.min(u32(d, stss.body + 4), Math.floor((stss.end - syncAt) / 4)) : 0;
  if (!sampleCount || !chunkCount || !stscCount || !sttsCount) return EMPTY_INDEX;

  const times: number[] = [];
  const offsets: number[] = [];
  const sizes: number[] = [];

  let sample = 0;
  let stscIndex = 0;
  let syncIndex = 0;
  let sttsIndex = 0;
  let sttsLeft = u32(d, sttsAt);
  let delta = u32(d, sttsAt + 4);
  let dts = 0;
  let lastKept = -Infinity;

  for (let chunk = 0; chunk < chunkCount && sample < sampleCount; chunk++) {
    // `first_chunk` est compté à partir de 1.
    while (stscIndex + 1 < stscCount && chunk + 1 >= u32(d, stscAt + 12 * (stscIndex + 1))) stscIndex++;
    const samplesInChunk = u32(d, stscAt + 12 * stscIndex + 4);
    let offset = wide ? u64(d, chunksAt + 8 * chunk) : u32(d, chunksAt + 4 * chunk);

    for (let k = 0; k < samplesInChunk && sample < sampleCount; k++, sample++) {
      const size = fixedSize || u32(d, sizesAt + 4 * sample);

      // Sans stss, chaque échantillon est une image clé.
      let sync = !stss;
      if (stss && syncIndex < syncCount && u32(d, syncAt + 4 * syncIndex) === sample + 1) {
        sync = true;
        syncIndex++;
      }
      if (sync) {
        const time = dts / timescale;
        if (stss || time - lastKept >= MIN_KEYFRAME_GAP) {
          times.push(time);
          offsets.push(offset);
          sizes.push(size);
          lastKept = time;
        }
      }

      offset += size;
      dts += delta;
      if (--sttsLeft <= 0 && sttsIndex + 1 < sttsCount) {
        sttsIndex++;
        sttsLeft = u32(d, sttsAt + 8 * sttsIndex);
        delta = u32(d, sttsAt + 8 * sttsIndex + 4);
      }
    }
  }

  return {
    times: Float64Array.from(times),
    offsets: Float64Array.from(offsets),
    sizes: Uint32Array.from(sizes),
  };
};

/**
 * Lit la boîte `moov` située en [start, end) : codec de la première piste
 * vidéo et, pour un MP4 classique, table de ses images clés.
 * Lève une erreur quand la vidéo n'est pas exploitable (DRM, codec inconnu).
 */
export const parseMoov = (data: Uint8Array, start: number, end: number): MoovInfo => {
  const header = readHeader(data, start, end);
  if (!header || header.type !== 'moov') throw new Error('boîte moov attendue');
  const top = childBoxes(data, start + header.header, end);

  const defaultSizes = new Map<number, number>();
  const mvex = top.find(box => box.type === 'mvex');
  if (mvex) {
    for (const box of childBoxes(data, mvex.body, mvex.end)) {
      if (box.type === 'trex' && box.end - box.body >= 24) {
        defaultSizes.set(u32(data, box.body + 4), u32(data, box.body + 16));
      }
    }
  }

  for (const trak of top) {
    if (trak.type !== 'trak') continue;
    const mdia = childBox(data, trak, 'mdia');
    const hdlr = childBox(data, mdia, 'hdlr');
    if (!hdlr || hdlr.end - hdlr.body < 12 || fourcc(data, hdlr.body + 8) !== 'vide') continue;

    const stbl = childBox(data, childBox(data, mdia, 'minf'), 'stbl');
    const stsd = childBox(data, stbl, 'stsd');
    if (!stbl || !stsd) continue;

    // Version 1 : dates sur 64 bits, donc champs décalés de 8 octets.
    const tkhd = childBox(data, trak, 'tkhd');
    const mdhd = childBox(data, mdia, 'mdhd');
    const trackId = tkhd ? u32(data, tkhd.body + (data[tkhd.body] === 1 ? 20 : 12)) : 1;
    const timescale = mdhd ? u32(data, mdhd.body + (data[mdhd.body] === 1 ? 20 : 12)) : 0;

    return {
      track: {
        trackId,
        ...readVideoCodec(data, stsd),
        defaultSampleSize: defaultSizes.get(trackId) ?? 0,
      },
      keyframes: buildKeyframeIndex(data, stbl, timescale),
    };
  }
  throw new Error('aucune piste vidéo');
};

/** Segment d'initialisation d'un flux fMP4 : seul le codec nous intéresse. */
export const parseInitSegment = (data: Uint8Array): VideoTrack => {
  const location = locateMoov(data);
  if (location.status !== 'found') throw new Error('segment d\'initialisation sans moov');
  return parseMoov(data, location.start, location.end).track;
};

export type KeyframeRef = {
  offset: number;
  size: number;
  /** L'image vaut pour [from, to) : jusqu'à l'image clé suivante. */
  from: number;
  to: number;
};

/** Dernière image clé située à `time` ou avant. */
export const findKeyframe = (index: KeyframeIndex, time: number): KeyframeRef | null => {
  const count = index.times.length;
  if (!count) return null;
  let low = 0;
  let high = count - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (index.times[middle] <= time) low = middle;
    else high = middle - 1;
  }
  return {
    offset: index.offsets[low],
    size: index.sizes[low],
    from: index.times[low],
    to: low + 1 < count ? index.times[low + 1] : Infinity,
  };
};

// ---------------------------------------------------------------------------
// Segments fragmentés
// ---------------------------------------------------------------------------

export type FragmentSample =
  /** Position dans le tampon ; peut dépasser sa fin, il faut alors lire la suite. */
  | { status: 'found'; offset: number; size: number }
  | { status: 'need-more' }
  | { status: 'unsupported'; reason: string };

/**
 * Premier échantillon vidéo d'un segment fMP4, d'après sa boîte `moof`.
 * `fileOffset` est la position du segment dans son fichier, pour les flux à
 * plages d'octets dont les décalages sont comptés depuis le début du fichier.
 */
export const findFirstFragmentSample = (
  data: Uint8Array,
  track: Pick<VideoTrack, 'trackId' | 'defaultSampleSize'>,
  final: boolean,
  fileOffset = 0,
): FragmentSample => {
  let at = 0;
  while (at + 8 <= data.length) {
    const header = readHeader(data, at, data.length);
    if (!header) break;
    if (header.size < header.header) return unsupported('boîte sans taille avant le fragment');

    if (header.type !== 'moof') {
      at += header.size;
      continue;
    }
    if (at + header.size > data.length) break;

    for (const traf of childBoxes(data, at + header.header, at + header.size)) {
      if (traf.type !== 'traf') continue;
      const tfhd = childBox(data, traf, 'tfhd');
      const trun = childBox(data, traf, 'trun');
      if (!tfhd || !trun || u32(data, tfhd.body + 4) !== track.trackId) continue;

      const trackFlags = u32(data, tfhd.body) & 0xffffff;
      let field = tfhd.body + 8;
      // Sans base explicite, les décalages partent du début du moof.
      let base = at;
      const explicitBase = (trackFlags & 0x1) !== 0;
      if (explicitBase) { base = u64(data, field) - fileOffset; field += 8; }
      if (trackFlags & 0x2) field += 4;
      if (trackFlags & 0x8) field += 4;
      let size = track.defaultSampleSize;
      if (trackFlags & 0x10) size = u32(data, field);

      const runFlags = u32(data, trun.body) & 0xffffff;
      if (!u32(data, trun.body + 4)) continue;
      field = trun.body + 8;
      if (!(runFlags & 0x1)) return unsupported('fragment sans décalage de données');
      const dataOffset = i32(data, field);
      field += 4;
      if (runFlags & 0x4) field += 4;
      if (runFlags & 0x100) field += 4;
      if (runFlags & 0x200) size = u32(data, field);

      if (!size) return unsupported('taille de la première image inconnue');
      return { status: 'found', offset: base + dataOffset, size };
    }
    return unsupported('fragment sans piste vidéo');
  }
  return final ? unsupported('aucun fragment dans le segment') : { status: 'need-more' };
};

/** Les segments fMP4 commencent par l'une de ces boîtes. */
const FRAGMENT_BOXES = new Set(['styp', 'moof', 'sidx', 'ftyp', 'moov', 'emsg', 'prft', 'free', 'mdat']);

export const looksLikeMp4 = (data: Uint8Array): boolean => (
  data.length >= 8 && FRAGMENT_BOXES.has(fourcc(data, 4))
);
