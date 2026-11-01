import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** TOTP (RFC 6238) : HMAC-SHA1, pas de 30 secondes, compatible Google Authenticator. */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_MS = 30_000;

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of text.replace(/=+$/, '').toUpperCase()) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error('base32 invalide');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpCounter(timeMs = Date.now()): number {
  return Math.floor(timeMs / STEP_MS);
}

export function totpAt(secret: string, counter: number, digits = 6): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** Compteur du code accepté (décalage d'horloge de ±30 s toléré), ou null. */
export function matchTotp(secret: string, code: string, timeMs = Date.now()): number | null {
  const now = totpCounter(timeMs);
  for (const counter of [now - 1, now, now + 1]) {
    const expected = Buffer.from(totpAt(secret, counter));
    const given = Buffer.from(code);
    if (expected.length === given.length && timingSafeEqual(expected, given)) return counter;
  }
  return null;
}

export function otpauthUrl(secret: string, account: string): string {
  const label = encodeURIComponent(`Paryaj Paw:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=Paryaj%20Paw&algorithm=SHA1&digits=6&period=30`;
}
