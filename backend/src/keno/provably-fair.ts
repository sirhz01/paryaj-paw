import { createHash, createHmac, randomBytes } from 'node:crypto';

export const GRID_SIZE = 80;
export const DRAW_SIZE = 20;

export function newServerSeed(): string {
  return randomBytes(32).toString('hex');
}

export function newClientSeed(): string {
  return randomBytes(8).toString('hex');
}

export function hashServerSeed(serverSeed: string): string {
  return createHash('sha256').update(serverSeed).digest('hex');
}

/**
 * Tirage vérifiable : 20 numéros distincts de 1 à 80, dans l'ordre de sortie.
 *
 * Octets : HMAC-SHA256(clé = graine serveur, message = "graineClient:nonce:bloc"), bloc = 0, 1, 2…
 * lus par entiers de 32 bits big-endian. Pour la position i, avec n = 80 − i numéros restants,
 * une valeur ≥ ⌊2³²/n⌋·n est rejetée (aucun biais de modulo), sinon i + valeur mod n
 * désigne le numéro échangé avec la position i (mélange de Fisher-Yates partiel).
 */
export function drawNumbers(serverSeed: string, clientSeed: string, nonce: number): number[] {
  const pool = Array.from({ length: GRID_SIZE }, (_, i) => i + 1);
  const next = uint32Stream(serverSeed, clientSeed, nonce);
  for (let i = 0; i < DRAW_SIZE; i++) {
    const n = GRID_SIZE - i;
    const limit = Math.floor(0x1_0000_0000 / n) * n;
    let value = next();
    while (value >= limit) value = next();
    const j = i + (value % n);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, DRAW_SIZE);
}

function uint32Stream(serverSeed: string, clientSeed: string, nonce: number): () => number {
  let block = 0;
  let bytes: Buffer = Buffer.alloc(0);
  let offset = 0;
  return () => {
    if (offset + 4 > bytes.length) {
      bytes = createHmac('sha256', serverSeed).update(`${clientSeed}:${nonce}:${block++}`).digest();
      offset = 0;
    }
    const value = bytes.readUInt32BE(offset);
    offset += 4;
    return value;
  };
}

export function countHits(picks: readonly number[], drawn: readonly number[]): number {
  const drawnSet = new Set(drawn);
  return picks.filter((n) => drawnSet.has(n)).length;
}
