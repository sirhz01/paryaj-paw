
import { drawRound } from './draw';
import { WHEEL_ORDER } from './games';

/** Intégrité des tirages : déterministes, uniformes, et ne dépendant que de la graine (jamais des mises). */
describe('drawRound', () => {
  const seed = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9'; // graine fixe : le test ne peut pas échouer au hasard

  it('est déterministe : même graine, jour et tour → même résultat (vérifiable après coup)', () => {
    for (const game of ['roulette', 'keno', 'luckysix', 'luckyx'] as const) {
      expect(drawRound(game, seed, '2026-11-04', 7)).toEqual(drawRound(game, seed, '2026-11-04', 7));
    }
    expect(drawRound('luckyx', seed, '2026-11-04', 7)).not.toEqual(drawRound('luckyx', seed, '2026-11-04', 8));
  });

  it('ne prend que la graine, le jour et le tour : aucun paramètre de mise', () => {
    expect(drawRound.length).toBe(4);
  });

  it('Lucky X : 36 boules distinctes parmi 50, dans un ordre aléatoire (la 50 peut sortir en premier)', () => {
    let notSorted = 0;
    const first = new Array(51).fill(0);
    const rounds = 4000;
    for (let r = 0; r < rounds; r++) {
      const { draw } = drawRound('luckyx', seed, '2026-11-04', r) as { draw: number[] };
      expect(draw).toHaveLength(36);
      expect(new Set(draw).size).toBe(36);
      expect(draw.every((n) => n >= 1 && n <= 50)).toBe(true);
      if (draw.some((n, i) => i > 0 && n < draw[i - 1])) notSorted++;
      first[draw[0]]++;
    }
    expect(notSorted).toBeGreaterThan(rounds * 0.99);
    expect(first[50]).toBeGreaterThan(0);
    // La première boule est uniforme sur 50 (khi-deux, 49 ddl, seuil 0,1 % ≈ 85,4).
    const e = rounds / 50;
    const chi = first.slice(1).reduce((a, c) => a + (c - e) ** 2 / e, 0);
    expect(chi).toBeLessThan(85.4);
  });

  it('Roulette : les 38 cases sortent avec la même fréquence (khi-deux, 37 ddl, seuil 0,1 % ≈ 69,0)', () => {
    const counts = new Map<string, number>(WHEEL_ORDER.map((n) => [n, 0]));
    const rounds = 38000;
    for (let r = 0; r < rounds; r++) {
      const { n } = drawRound('roulette', seed, '2026-11-04', r) as { n: string };
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    const e = rounds / 38;
    const chi = [...counts.values()].reduce((a, c) => a + (c - e) ** 2 / e, 0);
    expect(counts.size).toBe(38);
    expect(chi).toBeLessThan(69);
  });
});
