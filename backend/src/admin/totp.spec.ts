import { base32Decode, base32Encode, matchTotp, totpAt, totpCounter } from './totp';

// Vecteurs SHA-1 de la RFC 6238, annexe B (secret ASCII "12345678901234567890").
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP', () => {
  it('encode et décode le base32', () => {
    expect(RFC_SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(RFC_SECRET).toString()).toBe('12345678901234567890');
  });

  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
  ])('à t = %i s donne %s', (seconds, code) => {
    expect(totpAt(RFC_SECRET, totpCounter(seconds * 1000), 8)).toBe(code);
  });

  it('accepte le pas courant et ses voisins, refuse au-delà', () => {
    const now = 1_700_000_000_000;
    const counter = totpCounter(now);
    expect(matchTotp(RFC_SECRET, totpAt(RFC_SECRET, counter), now)).toBe(counter);
    expect(matchTotp(RFC_SECRET, totpAt(RFC_SECRET, counter - 1), now)).toBe(counter - 1);
    expect(matchTotp(RFC_SECRET, totpAt(RFC_SECRET, counter + 2), now)).toBeNull();
  });
});
