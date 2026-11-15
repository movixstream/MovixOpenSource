/**
 * Première image clé d'un segment MPEG-TS.
 *
 * L'aperçu de la barre de progression n'a besoin que d'une image par segment.
 * Le segment est donc lu au fil de l'eau, et la lecture s'arrête dès que
 * l'unité d'accès de la première image clé est complète : quelques centaines
 * de kilo-octets au lieu du segment entier.
 *
 * L'image reste au format Annex B (codes de départ 00 00 01), que WebCodecs
 * accepte tel quel quand la configuration n'a pas de `description`.
 */
import {
  avcCodecString,
  concatBytes,
  hevcCodecString,
  unsupported,
  type EncodedKeyframe,
  type KeyframeScan,
} from './media.ts';

const PACKET_SIZE = 188;
const SYNC_BYTE = 0x47;
/** Au-delà, un flux sans octet de synchro n'est pas du MPEG-TS. */
const SYNC_SCAN_LIMIT = 256 * 1024;

const STREAM_TYPE_H264 = 0x1b;
const STREAM_TYPE_HEVC = 0x24;

type ParameterSets = { vps?: Uint8Array; sps?: Uint8Array; pps?: Uint8Array };

/**
 * Premier octet de synchro suivi de deux autres à 188 octets d'intervalle.
 * Certains hébergeurs collent un faux en-tête d'image devant leurs segments :
 * on cherche donc plus loin que le premier octet.
 */
const findSync = (data: Uint8Array, from: number): number => {
  const last = data.length - 2 * PACKET_SIZE;
  for (let i = from; i < last; i++) {
    if (
      data[i] === SYNC_BYTE
      && data[i + PACKET_SIZE] === SYNC_BYTE
      && data[i + 2 * PACKET_SIZE] === SYNC_BYTE
    ) {
      return i;
    }
  }
  return -1;
};

/** Appelle `visit(début, fin)` pour chaque NAL, code de départ exclu. */
const forEachNal = (data: Uint8Array, visit: (start: number, end: number) => void): void => {
  const length = data.length;
  let nalStart = -1;
  let i = 0;
  while (i + 2 < length) {
    const third = data[i + 2];
    // Un troisième octet > 1 exclut tout code de départ sur ces trois octets.
    if (third > 1) {
      i += 3;
      continue;
    }
    if (third === 1 && data[i] === 0 && data[i + 1] === 0) {
      if (nalStart >= 0) {
        // Code de départ à 4 octets : son zéro de tête n'appartient pas au NAL.
        const end = i > nalStart && data[i - 1] === 0 ? i - 1 : i;
        visit(nalStart, end);
      }
      nalStart = i + 3;
      i += 3;
      continue;
    }
    i++;
  }
  if (nalStart >= 0 && nalStart < length) visit(nalStart, length);
};

/** Retire les octets anti-émulation (00 00 03 → 00 00). */
const unescapeRbsp = (nal: Uint8Array): Uint8Array => {
  const out = new Uint8Array(nal.length);
  let written = 0;
  let zeros = 0;
  for (let i = 0; i < nal.length; i++) {
    const byte = nal[i];
    if (zeros >= 2 && byte === 3) {
      zeros = 0;
      continue;
    }
    out[written++] = byte;
    zeros = byte === 0 ? zeros + 1 : 0;
  }
  return out.subarray(0, written);
};

/**
 * Vrai si la tranche H.264 est de type I. L'en-tête de tranche commence par
 * deux entiers Exp-Golomb : `first_mb_in_slice`, puis `slice_type`.
 */
const isIntraSlice = (data: Uint8Array, start: number, end: number): boolean => {
  let bit = (start + 1) * 8;
  const limit = Math.min(end, start + 12) * 8;
  const readBit = (): number => (bit < limit ? (data[bit >> 3] >> (7 - (bit++ & 7))) & 1 : 1);
  const readUnsigned = (): number => {
    let zeros = 0;
    while (zeros < 24 && readBit() === 0) zeros++;
    let value = 0;
    for (let i = 0; i < zeros; i++) value = (value << 1) | readBit();
    return (1 << zeros) - 1 + value;
  };
  readUnsigned();
  const type = readUnsigned() % 5;
  return type === 2 || type === 4;
};

const START_CODE = new Uint8Array([0, 0, 0, 1]);

/**
 * Regarde une unité d'accès (une image). Rend l'image clé prête à décoder, ou
 * `null` si ce n'en est pas une. Les jeux de paramètres croisés en route sont
 * gardés dans `sets` : une image clé qui ne les répète pas les reçoit en tête.
 */
const inspectAccessUnit = (
  unit: Uint8Array,
  hevc: boolean,
  sets: ParameterSets,
): EncodedKeyframe | null => {
  let key = false;
  let ownSps = false;
  let intra = false;
  let sliceSeen = false;

  forEachNal(unit, (start, end) => {
    if (end <= start) return;
    if (hevc) {
      const type = (unit[start] >> 1) & 0x3f;
      if (type === 32) sets.vps = unit.slice(start, end);
      else if (type === 33) { sets.sps = unit.slice(start, end); ownSps = true; }
      else if (type === 34) sets.pps = unit.slice(start, end);
      // 16 à 21 : BLA, IDR et CRA, les points d'entrée du flux.
      else if (type >= 16 && type <= 21) key = true;
    } else {
      const type = unit[start] & 0x1f;
      if (type === 7) { sets.sps = unit.slice(start, end); ownSps = true; }
      else if (type === 8) sets.pps = unit.slice(start, end);
      else if (type === 5) key = true;
      else if (type === 1 && !sliceSeen) {
        sliceSeen = true;
        intra = isIntraSlice(unit, start, end);
      }
    }
  });

  // GOP ouvert : pas d'IDR, mais une image I précédée de ses jeux de
  // paramètres. On la tente ; un décodeur qui n'en veut pas le dira.
  if (!hevc && !key && ownSps && intra) key = true;

  const { vps, sps, pps } = sets;
  if (!key || !sps || !pps || sps.length < 4) return null;
  if (hevc && (!vps || sps.length < 16)) return null;

  let codec: string;
  if (hevc) {
    // Après l'en-tête NAL (2 octets) et un octet d'identifiants vient
    // `profile_tier_level`, aligné sur l'octet.
    const rbsp = unescapeRbsp(sps.subarray(2, 34));
    if (rbsp.length < 13) return null;
    codec = hevcCodecString('hev1', rbsp.subarray(1, 13));
  } else {
    codec = avcCodecString('avc1', sps[1], sps[2], sps[3]);
  }

  if (ownSps) return { codec, data: unit };

  const head = hevc && vps ? [START_CODE, vps, START_CODE, sps, START_CODE, pps] : [START_CODE, sps, START_CODE, pps];
  const chunks = [...head, unit];
  return { codec, data: concatBytes(chunks, chunks.reduce((sum, chunk) => sum + chunk.length, 0)) };
};

/**
 * Cherche la première image clé dans le début d'un segment.
 *
 * `final` dit que `data` va jusqu'à la fin du segment : la dernière image est
 * alors complète même sans paquet suivant pour la clore.
 */
export const scanTsKeyframe = (data: Uint8Array, final: boolean): KeyframeScan => {
  const sync = findSync(data, 0);
  if (sync < 0) {
    return !final && data.length < SYNC_SCAN_LIMIT
      ? { status: 'need-more' }
      : unsupported('aucune synchro MPEG-TS');
  }

  let pmtPid = -1;
  let videoPid = -1;
  let pmtSeen = false;
  let hevc = false;
  const sets: ParameterSets = {};

  // Charge utile du paquet PES vidéo en cours : une image.
  let chunks: Uint8Array[] = [];
  let collected = 0;
  let expected = 0;
  let collecting = false;

  const finish = (): KeyframeScan | null => {
    if (!collecting || collected === 0) return null;
    const unit = concatBytes(chunks, collected);
    chunks = [];
    collected = 0;
    collecting = false;
    const keyframe = inspectAccessUnit(unit, hevc, sets);
    return keyframe ? { status: 'found', keyframe } : null;
  };

  for (let packet = sync; packet + PACKET_SIZE <= data.length; packet += PACKET_SIZE) {
    if (data[packet] !== SYNC_BYTE) {
      const next = findSync(data, packet + 1);
      if (next < 0) break;
      packet = next - PACKET_SIZE;
      continue;
    }

    const end = packet + PACKET_SIZE;
    const unitStart = (data[packet + 1] & 0x40) !== 0;
    const pid = ((data[packet + 1] & 0x1f) << 8) | data[packet + 2];
    const adaptation = (data[packet + 3] >> 4) & 0x3;
    let offset = packet + 4;
    if (adaptation & 0x2) offset += 1 + data[offset];
    if (!(adaptation & 0x1) || offset >= end) continue;

    if (pid === 0) {
      // PAT : donne le PID de la table du programme.
      if (unitStart) offset += 1 + data[offset];
      if (offset + 8 > end) continue;
      const sectionLength = ((data[offset + 1] & 0x0f) << 8) | data[offset + 2];
      const tableEnd = Math.min(end, offset + 3 + sectionLength - 4);
      for (let i = offset + 8; i + 4 <= tableEnd; i += 4) {
        const program = (data[i] << 8) | data[i + 1];
        if (program !== 0) {
          pmtPid = ((data[i + 2] & 0x1f) << 8) | data[i + 3];
          break;
        }
      }
    } else if (pid === pmtPid && videoPid < 0) {
      // PMT : donne le PID et le codec de la piste vidéo.
      if (unitStart) offset += 1 + data[offset];
      if (offset + 12 > end) continue;
      pmtSeen = true;
      const sectionLength = ((data[offset + 1] & 0x0f) << 8) | data[offset + 2];
      const programInfoLength = ((data[offset + 10] & 0x0f) << 8) | data[offset + 11];
      const tableEnd = Math.min(end, offset + 3 + sectionLength - 4);
      let i = offset + 12 + programInfoLength;
      while (i + 5 <= tableEnd) {
        const streamType = data[i];
        if (streamType === STREAM_TYPE_H264 || streamType === STREAM_TYPE_HEVC) {
          videoPid = ((data[i + 1] & 0x1f) << 8) | data[i + 2];
          hevc = streamType === STREAM_TYPE_HEVC;
          break;
        }
        i += 5 + (((data[i + 3] & 0x0f) << 8) | data[i + 4]);
      }
    } else if (pid === videoPid) {
      if (unitStart) {
        // Un nouveau paquet PES commence : le précédent est donc complet.
        const done = finish();
        if (done) return done;
        collecting = false;
        if (end - offset >= 9 && data[offset] === 0 && data[offset + 1] === 0 && data[offset + 2] === 1) {
          const pesLength = (data[offset + 4] << 8) | data[offset + 5];
          const headerLength = data[offset + 8];
          // Longueur nulle = non bornée, le cas courant pour la vidéo.
          expected = pesLength > 0 ? pesLength - 3 - headerLength : 0;
          offset += 9 + headerLength;
          collecting = true;
        }
      }
      if (collecting && offset < end) {
        chunks.push(data.subarray(offset, end));
        collected += end - offset;
        if (expected > 0 && collected >= expected) {
          const done = finish();
          if (done) return done;
        }
      }
    }
  }

  if (pmtSeen && videoPid < 0) return unsupported('pas de piste vidéo H.264 ou HEVC');
  if (!final) return { status: 'need-more' };
  return finish() ?? unsupported('aucune image clé dans le segment');
};
