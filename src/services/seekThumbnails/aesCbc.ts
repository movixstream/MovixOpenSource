/**
 * Déchiffrement AES-128-CBC au fil de l'eau, pour les segments HLS chiffrés.
 *
 * WebCrypto ne sait déchiffrer qu'un message entier : il vérifie le bourrage
 * du dernier bloc et refuse un message coupé. Or on veut s'arrêter après la
 * première image. L'astuce : fabriquer soi-même le bloc de bourrage qui suit
 * les blocs déjà reçus (chiffrer un message vide avec, pour vecteur, le
 * dernier bloc reçu), le coller au bout, et déchiffrer le tout.
 */

const BLOCK = 16;
const EMPTY = new Uint8Array(0);

/** Rend le clair de chaque morceau reçu ; `final` marque la fin du segment. */
export type CbcDecryptor = (chunk: Uint8Array, final: boolean) => Promise<Uint8Array>;

export const createCbcDecryptor = async (
  keyBytes: Uint8Array,
  iv: Uint8Array,
): Promise<CbcDecryptor> => {
  if (keyBytes.length !== BLOCK || iv.length !== BLOCK) {
    throw new Error('clé ou vecteur AES-128 de mauvaise taille');
  }
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes as BufferSource,
    'AES-CBC',
    false,
    ['encrypt', 'decrypt'],
  );

  // Vecteur du prochain bloc : le dernier bloc chiffré déjà traité.
  let vector: Uint8Array = iv.slice();
  // Octets reçus qui ne forment pas encore un bloc complet.
  let carry: Uint8Array = EMPTY;

  return async (chunk, final) => {
    let input = chunk;
    if (carry.length) {
      input = new Uint8Array(carry.length + chunk.length);
      input.set(carry, 0);
      input.set(chunk, carry.length);
    }

    const usable = input.length - (input.length % BLOCK);
    carry = final ? EMPTY : input.slice(usable);
    if (!usable) return EMPTY;

    const last = input.slice(usable - BLOCK, usable);
    const padding = await crypto.subtle.encrypt(
      { name: 'AES-CBC', iv: last as BufferSource },
      key,
      EMPTY as BufferSource,
    );
    const padded = new Uint8Array(usable + BLOCK);
    padded.set(input.subarray(0, usable), 0);
    padded.set(new Uint8Array(padding, 0, BLOCK), usable);

    const plain = await crypto.subtle.decrypt(
      { name: 'AES-CBC', iv: vector as BufferSource },
      key,
      padded as BufferSource,
    );
    vector = last;
    return new Uint8Array(plain);
  };
};
