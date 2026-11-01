import { DRAW_SIZE, GRID_SIZE, countHits, drawNumbers, hashServerSeed } from './provably-fair';

describe('drawNumbers', () => {
  it('tire 20 numéros distincts entre 1 et 80', () => {
    for (let nonce = 0; nonce < 500; nonce++) {
      const drawn = drawNumbers('graine-serveur', 'graine-client', nonce);
      expect(drawn).toHaveLength(DRAW_SIZE);
      expect(new Set(drawn).size).toBe(DRAW_SIZE);
      expect(drawn.every((n) => Number.isInteger(n) && n >= 1 && n <= GRID_SIZE)).toBe(true);
    }
  });

  it('est déterministe pour des graines et un nonce donnés', () => {
    expect(drawNumbers('a', 'b', 7)).toEqual(drawNumbers('a', 'b', 7));
  });

  it('change avec le nonce, la graine client ou la graine serveur', () => {
    const base = drawNumbers('a', 'b', 0);
    expect(drawNumbers('a', 'b', 1)).not.toEqual(base);
    expect(drawNumbers('a', 'c', 0)).not.toEqual(base);
    expect(drawNumbers('z', 'b', 0)).not.toEqual(base);
  });

  // Vecteur de référence publié aux joueurs, recoupé avec une implémentation Python indépendante.
  it('reste stable dans le temps', () => {
    expect(drawNumbers('paryaj-paw-server-seed', 'paryaj-paw-client-seed', 0)).toEqual([
      54, 65, 20, 55, 27, 43, 70, 16, 66, 3, 34, 9, 40, 64, 26, 14, 28, 50, 68, 48,
    ]);
  });
});

describe('hashServerSeed', () => {
  it('donne le SHA-256 hexadécimal', () => {
    expect(hashServerSeed('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('countHits', () => {
  it('compte les numéros choisis présents dans le tirage', () => {
    expect(countHits([1, 2, 3, 4], [3, 4, 5, 6])).toBe(2);
    expect(countHits([10], [1, 2, 3])).toBe(0);
  });
});
