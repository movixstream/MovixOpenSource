/**
 * Briques communes aux lecteurs de conteneurs des miniatures de la barre de
 * progression : le type d'une image clé prête à décoder, et les chaînes de
 * codec que WebCodecs attend.
 *
 * Ces fichiers n'importent rien du navigateur : ils se testent avec Node.
 */

/** Une image clé encodée, telle que `VideoDecoder` peut la recevoir. */
export type EncodedKeyframe = {
  codec: string;
  /**
   * Boîte de configuration du codec (avcC, hvcC). Absente pour l'Annex B, où
   * les jeux de paramètres voyagent dans `data`.
   */
  description?: Uint8Array;
  data: Uint8Array;
};

export type KeyframeScan =
  | { status: 'found'; keyframe: EncodedKeyframe }
  /** Le tampon s'arrête avant la fin de l'image : il faut lire la suite. */
  | { status: 'need-more' }
  | { status: 'unsupported'; reason: string };

export const unsupported = (reason: string): { status: 'unsupported'; reason: string } => ({
  status: 'unsupported',
  reason,
});

const hex2 = (value: number): string => value.toString(16).padStart(2, '0');

/** `avc1.64001f` : profil, drapeaux de contrainte et niveau, lus dans le SPS. */
export const avcCodecString = (
  prefix: string,
  profile: number,
  constraints: number,
  level: number,
): string => `${prefix}.${hex2(profile)}${hex2(constraints)}${hex2(level)}`;

/**
 * `hvc1.1.6.L93.B0`, à partir des 12 octets `profile_tier_level` communs au
 * SPS et à la boîte hvcC :
 * octet 0 = espace (2 bits), palier (1 bit), profil (5 bits) ;
 * octets 1-4 = drapeaux de compatibilité ; 5-10 = contraintes ; 11 = niveau.
 */
export const hevcCodecString = (prefix: string, ptl: Uint8Array): string => {
  const space = ['', 'A', 'B', 'C'][ptl[0] >> 6];
  const tier = ptl[0] & 0x20 ? 'H' : 'L';
  const profile = ptl[0] & 0x1f;

  // La chaîne de codec lit les drapeaux de compatibilité à l'envers.
  const flags = ((ptl[1] << 24) | (ptl[2] << 16) | (ptl[3] << 8) | ptl[4]) >>> 0;
  let reversed = 0;
  for (let bit = 0; bit < 32; bit++) {
    if (flags & (1 << bit)) reversed |= 1 << (31 - bit);
  }

  // Les octets de contrainte nuls en fin de liste ne s'écrivent pas.
  let end = 11;
  while (end > 5 && ptl[end - 1] === 0) end--;
  let constraints = '';
  for (let i = 5; i < end; i++) constraints += `.${ptl[i].toString(16).toUpperCase()}`;

  return `${prefix}.${space}${profile}.${(reversed >>> 0).toString(16).toUpperCase()}.${tier}${ptl[11]}${constraints}`;
};

export const concatBytes = (chunks: Uint8Array[], total: number): Uint8Array => {
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
};
