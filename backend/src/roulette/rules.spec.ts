import {
  BET_TYPES,
  Bet,
  BetType,
  DOUBLE_ZERO,
  INSIDE_BET_TYPES,
  OUTSIDE_BET_TYPES,
  PAYOUTS,
  POCKETS,
  RED_NUMBERS,
  WHEEL_ORDER,
  betReturn,
  colorOf,
  coverage,
  coversAllPockets,
  insidePositions,
  normalizeBets,
  pocketLabel,
  rtpPercent,
  spinNumber,
} from './rules';

const ALL = Array.from({ length: POCKETS }, (_, n) => n);
const EVEN_MONEY: BetType[] = ['red', 'black', 'even', 'odd', 'low', 'high'];

/** Toutes les mises possibles du tapis. */
function everyTablePosition(): Bet[] {
  const bets: Bet[] = [];
  for (const type of INSIDE_BET_TYPES) {
    for (const numbers of insidePositions(type)) bets.push({ type, numbers, amountCents: 1000 });
  }
  for (const index of [1, 2, 3]) {
    bets.push({ type: 'dozen', numbers: coverage('dozen', [], index)!, amountCents: 1000 });
    bets.push({ type: 'column', numbers: coverage('column', [], index)!, amountCents: 1000 });
  }
  for (const type of EVEN_MONEY) bets.push({ type, numbers: coverage(type)!, amountCents: 1000 });
  return bets;
}

function subsets(size: number): number[][] {
  const out: number[][] = [];
  const walk = (start: number, current: number[]) => {
    if (current.length === size) return void out.push([...current]);
    for (let n = start; n < POCKETS; n++) walk(n + 1, [...current, n]);
  };
  walk(0, []);
  return out;
}

describe('roue et tapis', () => {
  it('a 38 cases sur la roue, chacune une fois, et affiche 37 comme « 00 »', () => {
    expect([...WHEEL_ORDER].sort((a, b) => a - b)).toEqual(ALL);
    expect(pocketLabel(DOUBLE_ZERO)).toBe('00');
    expect(pocketLabel(17)).toBe('17');
    expect(colorOf(0)).toBe('green');
    expect(colorOf(DOUBLE_ZERO)).toBe('green');
    expect(colorOf(32)).toBe('red');
    expect(colorOf(15)).toBe('black');
  });

  it.each([
    ['straight', 38],
    ['split', 62],
    ['street', 14],
    ['corner', 22],
    ['top_line', 1],
    ['line', 11],
  ] as const)('%s : %i positions', (type, count) => {
    expect(insidePositions(type)).toHaveLength(count);
  });

  it.each([
    ['split', 2],
    ['street', 3],
    ['corner', 4],
  ] as const)('%s : seules les positions du tapis sont acceptées parmi toutes les combinaisons de %i cases', (type, size) => {
    const key = (positions: number[][]) => positions.map((p) => p.join('-')).sort();
    const accepted = subsets(size).filter((numbers) => coverage(type, numbers) !== null);
    expect(key(accepted)).toEqual(key(insidePositions(type)));
  });

  it('accepte 0-00, 0-1-2, 00-2-3 et la top line, refuse le carré 0-1-2-3 et les faux voisins', () => {
    expect(coverage('split', [DOUBLE_ZERO, 0])).toEqual([0, DOUBLE_ZERO]);
    expect(coverage('split', [17, 20])).toEqual([17, 20]);
    expect(coverage('street', [2, 3, DOUBLE_ZERO])).toEqual([2, 3, DOUBLE_ZERO]);
    expect(coverage('top_line', [0, DOUBLE_ZERO, 1, 2, 3])).toHaveLength(5);
    expect(coverage('corner', [0, 1, 2, 3])).toBeNull();
    expect(coverage('split', [0, 3])).toBeNull();
    expect(coverage('split', [3, 4])).toBeNull();
    expect(coverage('line', [34, 35, 36, 37, 38, 39])).toBeNull();
    expect(coverage('straight', [38])).toBeNull();
    expect(coverage('corner', [29, 25, 28, 26])).toEqual([25, 26, 28, 29]);
  });

  it('couvre 12 numéros par douzaine et colonne, 18 par chance simple, jamais 0 ni 00', () => {
    expect(coverage('dozen', [], 2)).toEqual([13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
    expect(coverage('column', [], 1)).toEqual([1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34]);
    expect(coverage('column', [], 3)?.every((n) => n % 3 === 0)).toBe(true);
    for (const type of EVEN_MONEY) {
      const numbers = coverage(type)!;
      expect(numbers).toHaveLength(18);
      expect(numbers).not.toContain(0);
      expect(numbers).not.toContain(DOUBLE_ZERO);
    }
    expect(coverage('red')).toEqual(RED_NUMBERS);
    expect([...coverage('red')!, ...coverage('black')!].sort((a, b) => a - b)).toEqual(ALL.slice(1, 37));
  });

  it('refuse un index ou des numéros mal placés', () => {
    expect(coverage('dozen', [], 4)).toBeNull();
    expect(coverage('dozen')).toBeNull();
    expect(coverage('column', [1], 1)).toBeNull();
    expect(coverage('red', [], 1)).toBeNull();
    expect(coverage('straight', [5], 1)).toBeNull();
  });

  it('liste 6 mises intérieures et 8 extérieures', () => {
    expect(INSIDE_BET_TYPES).toHaveLength(6);
    expect(OUTSIDE_BET_TYPES).toHaveLength(8);
    expect(BET_TYPES).toHaveLength(14);
  });
});

describe('paiements', () => {
  const positions = everyTablePosition();

  it('teste les 160 positions du tapis', () => {
    expect(positions).toHaveLength(38 + 62 + 14 + 22 + 1 + 11 + 3 + 3 + 6);
  });

  it('paie chaque position sur chacune des 38 cases : 36 / cases couvertes, 7 fois la mise pour la top line', () => {
    for (const bet of positions) {
      for (const number of ALL) {
        const multiple = bet.type === 'top_line' ? 7 : 36 / bet.numbers.length;
        expect(betReturn(bet, number)).toBe(bet.numbers.includes(number) ? bet.amountCents * multiple : 0);
      }
    }
  });

  it('suit la table du cahier des charges (gain net pour 1 misé)', () => {
    expect(PAYOUTS).toEqual({
      straight: 35,
      split: 17,
      street: 11,
      corner: 8,
      top_line: 6,
      line: 5,
      dozen: 2,
      column: 2,
      red: 1,
      black: 1,
      even: 1,
      odd: 1,
      low: 1,
      high: 1,
    });
  });

  it('perd toutes les mises extérieures sur 0 et 00 (pas de La Partage ni d’En Prison)', () => {
    for (const bet of positions.filter((b) => (OUTSIDE_BET_TYPES as string[]).includes(b.type))) {
      expect(betReturn(bet, 0)).toBe(0);
      expect(betReturn(bet, DOUBLE_ZERO)).toBe(0);
    }
  });

  it('donne un RTP de 94,74 % sur toute position, et 92,11 % pour la top line', () => {
    for (const bet of positions) {
      const average = ALL.reduce((sum, n) => sum + betReturn(bet, n), 0) / POCKETS / bet.amountCents;
      expect(average).toBeCloseTo(bet.type === 'top_line' ? 35 / 38 : 36 / 38, 12);
    }
    for (const type of BET_TYPES) expect(rtpPercent(type)).toBeCloseTo(type === 'top_line' ? 92.105 : 94.737, 3);
  });
});

describe('normalizeBets', () => {
  it('additionne les jetons posés sur la même position', () => {
    const bets = normalizeBets([
      { type: 'straight', numbers: [17], amountCents: 1000 },
      { type: 'straight', numbers: [17], amountCents: 2500 },
      { type: 'split', numbers: [20, 17], amountCents: 1000 },
      { type: 'dozen', index: 2, amountCents: 5000 },
    ]);
    expect(bets).toHaveLength(3);
    expect(bets.find((b) => b.type === 'straight')?.amountCents).toBe(3500);
    expect(bets.find((b) => b.type === 'split')?.numbers).toEqual([17, 20]);
  });

  it('ne modifie pas les tableaux reçus', () => {
    const numbers = [20, 17];
    normalizeBets([{ type: 'split', numbers, amountCents: 1000 }]);
    expect(numbers).toEqual([20, 17]);
  });

  it.each([
    [{ type: 'split', numbers: [1, 5], amountCents: 1000 }],
    [{ type: 'straight', numbers: [5], amountCents: 0 }],
    [{ type: 'straight', numbers: [5], amountCents: 10.5 }],
    [{ type: 'voisins_du_zero', amountCents: 1000 }],
    [{ type: 'jackpot', amountCents: 1000 }],
  ])('refuse %j', (request) => {
    expect(() => normalizeBets([request as never])).toThrow();
  });

  it('repère les mises qui couvrent les 38 cases', () => {
    const nearlyAll = normalizeBets([
      { type: 'red', amountCents: 1000 },
      { type: 'black', amountCents: 1000 },
      { type: 'straight', numbers: [0], amountCents: 1000 },
    ]);
    expect(coversAllPockets(nearlyAll)).toBe(false);
    expect(coversAllPockets([...nearlyAll, { type: 'straight', numbers: [DOUBLE_ZERO], amountCents: 1000 }])).toBe(true);
  });
});

describe('tirage', () => {
  it('reste stable dans le temps (vecteur recoupé avec une implémentation Python indépendante)', () => {
    expect(Array.from({ length: 10 }, (_, n) => spinNumber('paryaj-paw-server-seed', 'paryaj-paw-client-seed', n))).toEqual([
      9, 8, 22, 4, 13, 34, 9, 22, 17, 13,
    ]);
  });

  it('tire les 38 cases de façon uniforme', () => {
    const counts = new Array<number>(POCKETS).fill(0);
    for (let nonce = 0; nonce < 38_000; nonce++) counts[spinNumber('a', 'b', nonce)]++;
    expect(counts.every((c) => c > 800 && c < 1200)).toBe(true);
  });
});
