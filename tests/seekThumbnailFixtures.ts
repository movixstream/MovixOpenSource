// Fabrique de petits fichiers MPEG-TS, MP4 et fMP4 pour les tests des
// miniatures de la barre de progression. Les conteneurs sont réduits à ce que
// lisent nos analyseurs : ce ne sont pas des vidéos lisibles par un lecteur.

export const bytes = (...parts: Array<Uint8Array | number[]>): Uint8Array => {
  const arrays = parts.map(part => (part instanceof Uint8Array ? part : Uint8Array.from(part)));
  const out = new Uint8Array(arrays.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of arrays) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

const u16 = (value: number): number[] => [(value >> 8) & 0xff, value & 0xff];
const u32 = (value: number): number[] => [
  (value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff,
];
const ascii = (text: string): number[] => Array.from(text, char => char.charCodeAt(0));

// ---------------------------------------------------------------------------
// Annex B factice (pour les tests Node, qui ne décodent rien)
// ---------------------------------------------------------------------------

/** SPS H.264 « High 3.1 » : seuls profil, contraintes et niveau sont lus. */
export const FAKE_SPS = [0x67, 0x64, 0x00, 0x1f, 0xac, 0xd9];
export const FAKE_PPS = [0x68, 0xeb, 0xe3, 0xcb];

export const fakeAccessUnit = (options: {
  key: boolean;
  params?: boolean;
  size?: number;
  /** Tranche de type I sans être un IDR, comme en tête d'un GOP ouvert. */
  intra?: boolean;
}): Uint8Array => {
  const payload = new Uint8Array(options.size ?? 300).fill(0xab);
  // En-tête de tranche : first_mb_in_slice = 0, slice_type = 7 (I).
  if (options.intra) payload[0] = 0x88;
  return bytes(
    [0, 0, 0, 1, 0x09, 0xf0],
    options.params ?? options.key ? [0, 0, 0, 1, ...FAKE_SPS, 0, 0, 0, 1, ...FAKE_PPS] : [],
    [0, 0, 1, options.key ? 0x65 : 0x41],
    payload,
  );
};

// ---------------------------------------------------------------------------
// MPEG-TS
// ---------------------------------------------------------------------------

const PMT_PID = 0x100;
const VIDEO_PID = 0x101;
const AUDIO_PID = 0x102;

const tsPacket = (pid: number, unitStart: boolean, counter: number, payload: Uint8Array): Uint8Array => {
  const packet = new Uint8Array(188).fill(0xff);
  packet[0] = 0x47;
  packet[1] = (unitStart ? 0x40 : 0) | (pid >> 8);
  packet[2] = pid & 0xff;
  const stuffing = 184 - payload.length;
  if (stuffing === 0) {
    packet[3] = 0x10 | (counter & 0x0f);
    packet.set(payload, 4);
    return packet;
  }
  // Champ d'adaptation : il comble le paquet devant la charge utile.
  packet[3] = 0x30 | (counter & 0x0f);
  packet[4] = stuffing - 1;
  if (stuffing > 1) packet[5] = 0x00;
  packet.set(payload, 4 + stuffing);
  return packet;
};

const pesPackets = (
  pid: number,
  streamId: number,
  payload: Uint8Array,
  counter: { value: number },
  bounded: boolean,
): Uint8Array[] => {
  const header = [0x80, 0x80, 0x05, 0x21, 0x00, 0x01, 0x00, 0x01];
  const length = bounded ? header.length + payload.length : 0;
  const pes = bytes([0x00, 0x00, 0x01, streamId, ...u16(length), ...header], payload);
  const packets: Uint8Array[] = [];
  for (let at = 0; at < pes.length; at += 184) {
    packets.push(tsPacket(pid, at === 0, counter.value++, pes.subarray(at, Math.min(pes.length, at + 184))));
  }
  return packets;
};

export type TsOptions = {
  /** Unités d'accès Annex B, une par image. */
  frames: Uint8Array[];
  hevc?: boolean;
  /** Octets parasites devant le flux, comme le font certains hébergeurs. */
  prefix?: Uint8Array;
  /** Écrit la longueur du paquet PES au lieu de 0. */
  boundedPes?: boolean;
  /** Paquets de bourrage ajoutés à la fin, pour simuler un gros segment. */
  paddingPackets?: number;
};

export const buildTs = (options: TsOptions): Uint8Array => {
  const pat = bytes(
    [0x00, 0x00, 0xb0, 0x0d, 0x00, 0x01, 0xc1, 0x00, 0x00],
    [0x00, 0x01, 0xe0 | (PMT_PID >> 8), PMT_PID & 0xff],
    [0, 0, 0, 0],
  );
  const pmt = bytes(
    [0x00, 0x02, 0xb0, 0x17, 0x00, 0x01, 0xc1, 0x00, 0x00],
    [0xe0 | (VIDEO_PID >> 8), VIDEO_PID & 0xff, 0xf0, 0x00],
    // Une piste audio d'abord : l'analyseur doit la passer.
    [0x0f, 0xe0 | (AUDIO_PID >> 8), AUDIO_PID & 0xff, 0xf0, 0x00],
    [options.hevc ? 0x24 : 0x1b, 0xe0 | (VIDEO_PID >> 8), VIDEO_PID & 0xff, 0xf0, 0x00],
    [0, 0, 0, 0],
  );

  const packets: Uint8Array[] = [tsPacket(0, true, 0, pat), tsPacket(PMT_PID, true, 0, pmt)];
  const video = { value: 0 };
  const audio = { value: 0 };
  for (const frame of options.frames) {
    packets.push(...pesPackets(VIDEO_PID, 0xe0, frame, video, options.boundedPes ?? false));
    packets.push(...pesPackets(AUDIO_PID, 0xc0, new Uint8Array(96).fill(0x55), audio, true));
  }
  for (let i = 0; i < (options.paddingPackets ?? 0); i++) {
    packets.push(tsPacket(0x1fff, false, 0, new Uint8Array(184).fill(0xff)));
  }
  return bytes(options.prefix ?? [], ...packets);
};

// ---------------------------------------------------------------------------
// MP4
// ---------------------------------------------------------------------------

export const box = (type: string, ...parts: Array<Uint8Array | number[]>): Uint8Array => {
  const body = bytes(...parts);
  return bytes(u32(body.length + 8), ascii(type), body);
};

const fullBox = (type: string, flags: number, ...parts: Array<Uint8Array | number[]>): Uint8Array => (
  box(type, u32(flags), ...parts)
);

/** avcC minimal : version, profil, contraintes, niveau. */
export const FAKE_AVCC = Uint8Array.from([0x01, 0x64, 0x00, 0x1f, 0xff, 0xe0, 0x00]);

const visualSampleEntry = (format: string, config: Uint8Array, configType: string): Uint8Array => box(
  format,
  new Uint8Array(6), u16(1),
  new Uint8Array(16),
  u16(320), u16(180),
  u32(0x00480000), u32(0x00480000), u32(0),
  u16(1), new Uint8Array(32), u16(0x18), u16(0xffff),
  box(configType, config),
);

export type Mp4Sample = { data: Uint8Array; key: boolean; duration: number };

export type Mp4Options = {
  samples: Mp4Sample[];
  timescale?: number;
  /** Boîte de configuration du codec (avcC par défaut). */
  config?: Uint8Array;
  format?: string;
  configType?: string;
  trackId?: number;
  /** `moov` après les données, comme les fichiers non optimisés pour le web. */
  moovLast?: boolean;
  samplesPerChunk?: number;
  /** Octets ajoutés dans `mdat` après les images, pour simuler un gros fichier. */
  padding?: number;
  /** Omet la table des images clés : toutes les images en sont. */
  noSyncTable?: boolean;
};

const videoTrak = (options: Mp4Options, stbl: Uint8Array): Uint8Array => {
  const trackId = options.trackId ?? 2;
  return box(
    'trak',
    fullBox('tkhd', 3, u32(0), u32(0), u32(trackId), new Uint8Array(68)),
    box(
      'mdia',
      fullBox('mdhd', 0, u32(0), u32(0), u32(options.timescale ?? 1000), u32(0), u32(0)),
      fullBox('hdlr', 0, u32(0), ascii('vide'), new Uint8Array(13)),
      box('minf', stbl),
    ),
  );
};

const audioTrak = (): Uint8Array => box(
  'trak',
  fullBox('tkhd', 3, u32(0), u32(0), u32(1), new Uint8Array(68)),
  box('mdia', fullBox('hdlr', 0, u32(0), ascii('soun'), new Uint8Array(13))),
);

const stsd = (options: Mp4Options): Uint8Array => fullBox(
  'stsd',
  0,
  u32(1),
  visualSampleEntry(options.format ?? 'avc1', options.config ?? FAKE_AVCC, options.configType ?? 'avcC'),
);

/** MP4 classique. Rend le fichier et la position de chaque image. */
export const buildMp4 = (options: Mp4Options): { file: Uint8Array; offsets: number[] } => {
  const { samples } = options;
  const perChunk = options.samplesPerChunk ?? 2;
  const ftyp = box('ftyp', ascii('isom'), u32(0), ascii('isomavc1'));
  const data = bytes(...samples.map(sample => sample.data), new Uint8Array(options.padding ?? 0));

  const moov = (dataStart: number): { moov: Uint8Array; offsets: number[] } => {
    const offsets: number[] = [];
    let at = dataStart;
    for (const sample of samples) {
      offsets.push(at);
      at += sample.data.length;
    }
    const chunkOffsets = offsets.filter((_, index) => index % perChunk === 0);
    const syncNumbers = samples.flatMap((sample, index) => (sample.key ? [index + 1] : []));
    const stbl = box(
      'stbl',
      stsd(options),
      fullBox('stts', 0, u32(samples.length), ...samples.map(sample => [...u32(1), ...u32(sample.duration)])),
      options.noSyncTable ? [] : fullBox('stss', 0, u32(syncNumbers.length), ...syncNumbers.map(u32)),
      fullBox('stsc', 0, u32(1), u32(1), u32(perChunk), u32(1)),
      fullBox('stsz', 0, u32(0), u32(samples.length), ...samples.map(sample => u32(sample.data.length))),
      fullBox('stco', 0, u32(chunkOffsets.length), ...chunkOffsets.map(u32)),
    );
    return { moov: box('moov', audioTrak(), videoTrak(options, stbl)), offsets };
  };

  if (options.moovLast) {
    const built = moov(ftyp.length + 8);
    return { file: bytes(ftyp, box('mdat', data), built.moov), offsets: built.offsets };
  }
  // Les positions dépendent de la taille de moov, qui ne dépend pas d'elles.
  const size = moov(0).moov.length;
  const built = moov(ftyp.length + size + 8);
  return { file: bytes(ftyp, built.moov, box('mdat', data)), offsets: built.offsets };
};

/** Segment d'initialisation fMP4 : codec seul, sans table d'échantillons. */
export const buildInitSegment = (options: Omit<Mp4Options, 'samples'>): Uint8Array => {
  const trackId = options.trackId ?? 2;
  const stbl = box('stbl', stsd({ ...options, samples: [] }));
  return bytes(
    box('ftyp', ascii('iso5'), u32(0), ascii('iso5avc1')),
    box(
      'moov',
      videoTrak({ ...options, samples: [] }, stbl),
      box('mvex', fullBox('trex', 0, u32(trackId), u32(1), u32(0), u32(0), u32(0))),
    ),
  );
};

/** Segment média fMP4 : `moof` puis `mdat`, décalages comptés depuis `moof`. */
export const buildFragment = (
  samples: Mp4Sample[],
  options: { trackId?: number; padding?: number } = {},
): Uint8Array => {
  const trackId = options.trackId ?? 2;
  const moof = (dataOffset: number): Uint8Array => box(
    'moof',
    fullBox('mfhd', 0, u32(1)),
    box(
      'traf',
      // 0x020000 : les décalages partent du début du moof.
      fullBox('tfhd', 0x020000, u32(trackId)),
      fullBox('tfdt', 0, u32(0)),
      // 0x001 décalage des données, 0x100 durées, 0x200 tailles.
      fullBox(
        'trun',
        0x000301,
        u32(samples.length),
        u32(dataOffset),
        ...samples.map(sample => [...u32(sample.duration), ...u32(sample.data.length)]),
      ),
    ),
  );
  const size = moof(0).length;
  return bytes(
    box('styp', ascii('msdh'), u32(0), ascii('msdhmsix')),
    moof(size + 8),
    box('mdat', ...samples.map(sample => sample.data), new Uint8Array(options.padding ?? 0)),
  );
};
