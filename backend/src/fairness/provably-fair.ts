import { createHash, createHmac, randomBytes } from 'node:crypto';

/** Jeux qui ont chacun leur paire de graines et leur suite de nonces par joueur. */
export type Game = 'keno' | 'roulette';

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
 * Entiers de 32 bits big-endian lus dans HMAC-SHA256(clé = graine serveur,
 * message = "graineClient:nonce:bloc"), bloc = 0, 1, 2…
 */
export function uint32Stream(serverSeed: string, clientSeed: string, nonce: number): () => number {
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

/** Entier uniforme dans [0, n) : rejet des valeurs ≥ ⌊2³²/n⌋·n, donc aucun biais de modulo. */
export function uniformInt(next: () => number, n: number): number {
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  let value = next();
  while (value >= limit) value = next();
  return value % n;
}
