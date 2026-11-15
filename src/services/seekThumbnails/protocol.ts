/**
 * Messages échangés entre le lecteur et le worker des miniatures.
 */

/** Où lire un segment : URL, plage d'octets et chiffrement éventuels. */
export type SegmentRef = {
  url: string;
  /** [début, fin exclue], comme dans hls.js. */
  range?: [number, number];
  /** AES-128 sur le segment entier. Sans `key`, le worker la télécharge. */
  aes?: { iv: Uint8Array; key?: Uint8Array; keyUrl: string };
};

export type ThumbnailJob =
  | { kind: 'hls'; segment: SegmentRef; init?: SegmentRef }
  | { kind: 'mp4'; url: string; time: number };

/** Intervalle de la vidéo, en secondes, que la miniature représente. */
export type ThumbnailSpan = { from: number; to: number };

export type ThumbnailRequest =
  | { type: 'thumbnail'; id: number; job: ThumbnailJob; maxWidth: number }
  | { type: 'cancel'; id: number }
  | { type: 'reset' };

export type ThumbnailFailure =
  /** Format, codec ou serveur incompatible : réessayer ne changera rien. */
  | 'unsupported'
  | 'http'
  | 'network'
  | 'decode'
  | 'aborted';

export type ThumbnailResponse =
  | { type: 'thumbnail'; id: number; bitmap: ImageBitmap; span?: ThumbnailSpan }
  | { type: 'failed'; id: number; failure: ThumbnailFailure; status?: number; reason: string };
