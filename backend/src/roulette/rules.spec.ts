import {
  Bet,
  BetType,
  DOUBLE_ZERO,
  EVEN_MONEY_BET_TYPES,
  INSIDE_BET_TYPES,
  OUTSIDE_BET_TYPES,
  PAYOUTS,
  POCKETS,
  RED_NUMBERS,
  WHEEL_ORDER,
  WHEEL_ORDERS,
  betReturn,
  betTypesOf,
  colorOf,
  coverage,
  coversAllPockets,
  expandRacetrack,
  insidePositions,
  normalizeBets,
  pocketLabel,
  rtpPercent,
  spinNumber,
} from './rules';

const ALL = Array.from({ length: POCKETS }, (_, n) => n);

/** Toutes les mises possibles du tapis, construites indépendamment des tables du moteur. */
function everyTablePosition(): Bet[] {
  const bets: Bet[] = [];
  for (const type of INSIDE_BET_TYPES) {
    for (const numbers of insidePositions(type)) bets.push({ type, numbers, amountCents: 1000 });
  }
  for (const index of [1, 2, 3]) {
    bets.push({ type: 'dozen', numbers: coverage('dozen', [], index)!, amountCents: 1000 });
    bets.push({ type: 'column', numbers: coverage('column', [], index)!, amountCents: 1000 });
  }
  for (const type of ['red', 'black', 'even', 'odd', 'low', 'high'] as BetType[]) {
    bets.push({ type, numbers: coverage(type)!, amountCents: 1000 });
  }
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

describe('positions du tapis', () => {
  it.each([
    ['straight', 37],
    ['split', 60],
    ['street', 14],
    ['corner', 23],
    ['line', 11],
  ] as const)('%s : %i positions', (type, count) => {
    expect(insidePositions(type)).toHaveLength(count);
  });

  it.each([
    ['split', 2],
    ['street', 3],
    ['corner', 4],
  ] as const)('%s : seules les positions du tapis sont acceptées parmi toutes les combinaisons de %i numéros', (type, size) => {
    const key = (positions: number[][]) => positions.map((p) => p.join('-')).sort();
    const accepted = subsets(size).filter((numbers) => coverage(type, numbers) !== null);
    expect(key(accepted)).toEqual(key(insidePositions(type)));
  });

  it('reconnaît les chevaux, transversales et carrés usuels, et refuse les faux voisins', () => {
    expect(coverage('split', [0, 2])).toEqual([0, 2]);
    expect(coverage('split', [17, 20])).toEqual([17, 20]);
    expect(coverage('split', [3, 4])).toBeNull();
    expect(coverage('street', [0, 2, 3])).toEqual([0, 2, 3]);
    expect(coverage('corner', [0, 1, 2, 3])).toEqual([0, 1, 2, 3]);
    expect(coverage('corner', [3, 4, 6, 7])).toBeNull();
    expect(coverage('line', [31, 32, 33, 34, 35, 36])).toHaveLength(6);
    expect(coverage('line', [34, 35, 36, 37, 38, 39])).toBeNull();
    expect(coverage('straight', [37])).toBeNull();
    expect(coverage('straight', [36, 35])).toBeNull();
  });

  it('accepte les numéros dans le désordre et les trie', () => {
    expect(coverage('corner', [29, 25, 28, 26])).toEqual([25, 26, 28, 29]);
  });

  it('couvre 12 numéros par douzaine et colonne, 18 par chance simple, jamais le zéro', () => {
    expect(coverage('dozen', [], 2)).toEqual([13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
    expect(coverage('column', [], 1)).toEqual([1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34]);
    expect(coverage('column', [], 3)?.every((n) => n % 3 === 0)).toBe(true);
    for (const type of EVEN_MONEY_BET_TYPES) {
      const numbers = coverage(type)!;
      expect(numbers).toHaveLength(18);
      expect(numbers).not.toContain(0);
    }
    expect(coverage('red')).toEqual(RED_NUMBERS);
    expect([...coverage('red')!, ...coverage('black')!].sort((a, b) => a - b)).toEqual(ALL.slice(1));
  });

  it('refuse un index ou des numéros mal placés', () => {
    expect(coverage('dozen', [], 4)).toBeNull();
    expect(coverage('dozen')).toBeNull();
    expect(coverage('column', [1], 1)).toBeNull();
    expect(coverage('red', [], 1)).toBeNull();
    expect(coverage('straight', [5], 1)).toBeNull();
  });
});

describe('paiements', () => {
  const positions = everyTablePosition();

  it('teste les 154 positions du tapis', () => {
    expect(positions).toHaveLength(37 + 60 + 14 + 23 + 11 + 3 + 3 + 6);
  });

  it('paie chaque position sur chacun des 37 numéros : 36 / numéros couverts si gagnant, rien sinon', () => {
    for (const bet of positions) {
      for (const number of ALL) {
        const expected = bet.numbers.includes(number) ? (bet.amountCents * 36) / bet.numbers.length : 0;
        expect(betReturn(bet, number, false)).toBe(expected);
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

  it('rend en moyenne 36/37 de la mise sur toute position, soit un RTP de 97,30 %', () => {
    for (const bet of positions) {
      const average = ALL.reduce((sum, n) => sum + betReturn(bet, n, false), 0) / POCKETS;
      expect(average / bet.amountCents).toBeCloseTo(36 / 37, 12);
    }
    for (const type of betTypesOf('european')) expect(rtpPercent(type, false)).toBeCloseTo(97.297, 3);
  });

  it('La Partage rend la moitié des chances simples sur le zéro, rien aux autres mises', () => {
    for (const bet of positions) {
      const partage = betReturn(bet, 0, true);
      if (EVEN_MONEY_BET_TYPES.includes(bet.type)) expect(partage).toBe(500);
      else expect(partage).toBe(betReturn(bet, 0, false));
    }
    expect(betReturn({ type: 'red', numbers: coverage('red')!, amountCents: 1001 }, 0, true)).toBe(500);
    expect(rtpPercent('red', true)).toBeCloseTo(98.649, 3);
    expect(rtpPercent('straight', true)).toBeCloseTo(97.297, 3);
  });
});

describe('piste (racetrack)', () => {
  const covered = (bets: Bet[]) => [...new Set(bets.flatMap((b) => b.numbers))].sort((a, b) => a - b);
  const chips = (bets: Bet[], chip: number) => bets.reduce((sum, b) => sum + b.amountCents, 0) / chip;

  it('voisins du zéro : 9 jetons sur les 17 numéros de 22 à 25 sur la roue', () => {
    const bets = expandRacetrack('voisins_du_zero', 1000);
    expect(chips(bets, 1000)).toBe(9);
    const at = WHEEL_ORDER.indexOf(22);
    const sector = Array.from({ length: 17 }, (_, i) => WHEEL_ORDER[(at + i) % POCKETS]);
    expect(covered(bets)).toEqual([...sector].sort((a, b) => a - b));
    expect(sector.at(-1)).toBe(25);
  });

  it('tiers : 6 chevaux sur les 12 numéros de 27 à 33 sur la roue', () => {
    const bets = expandRacetrack('tiers', 1000);
    expect(chips(bets, 1000)).toBe(6);
    const at = WHEEL_ORDER.indexOf(27);
    expect(covered(bets)).toEqual(
      Array.from({ length: 12 }, (_, i) => WHEEL_ORDER[(at + i) % POCKETS]).sort((a, b) => a - b),
    );
  });

  it('orphelins : 5 jetons sur les 8 numéros restants', () => {
    const bets = expandRacetrack('orphelins', 1000);
    expect(chips(bets, 1000)).toBe(5);
    expect(covered(bets)).toEqual([1, 6, 9, 14, 17, 20, 31, 34]);
  });

  it('les trois secteurs couvrent la roue une seule fois', () => {
    const all = ['voisins_du_zero', 'tiers', 'orphelins'].flatMap((t) => covered(expandRacetrack(t as 'tiers', 1)));
    expect(all.sort((a, b) => a - b)).toEqual(ALL);
  });

  it('chaque mise dépliée est une position valide du tapis', () => {
    for (const type of ['voisins_du_zero', 'tiers', 'orphelins'] as const) {
      for (const bet of expandRacetrack(type, 1)) expect(coverage(bet.type, bet.numbers)).toEqual(bet.numbers);
    }
  });

  it('voisins d’un numéro : lui et deux voisins de chaque côté, y compris au bout de la roue', () => {
    expect(expandRacetrack('neighbors', 1000, 0).map((b) => b.numbers[0])).toEqual([3, 26, 0, 32, 15]);
    expect(expandRacetrack('neighbors', 1000, 26).map((b) => b.numbers[0])).toEqual([35, 3, 26, 0, 32]);
    expect(() => expandRacetrack('neighbors', 1000)).toThrow();
    expect(() => expandRacetrack('neighbors', 1000, 37)).toThrow();
  });
});

describe('normalizeBets', () => {
  it('additionne les jetons posés sur la même position et déplie la piste', () => {
    const bets = normalizeBets([
      { type: 'straight', numbers: [17], amountCents: 1000 },
      { type: 'straight', numbers: [17], amountCents: 2500 },
      { type: 'split', numbers: [20, 17], amountCents: 1000 },
      { type: 'orphelins', amountCents: 1000 },
      { type: 'dozen', index: 2, amountCents: 5000 },
    ]);
    expect(bets.find((b) => b.type === 'straight' && b.numbers[0] === 17)?.amountCents).toBe(3500);
    expect(bets.find((b) => b.type === 'split' && b.numbers.join() === '17,20')?.amountCents).toBe(2000);
    expect(bets.reduce((sum, b) => sum + b.amountCents, 0)).toBe(3500 + 1000 + 5000 + 5000);
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
    [{ type: 'tiers', numbers: [5], amountCents: 1000 }],
    [{ type: 'neighbors', amountCents: 1000 }],
    [{ type: 'voisins_du_zero', index: 1, amountCents: 1000 }],
    [{ type: 'jackpot', amountCents: 1000 }],
  ])('refuse %j', (request) => {
    expect(() => normalizeBets([request as never])).toThrow();
  });
});

describe('tirage', () => {
  it('reste stable dans le temps (vecteur recoupé avec une implémentation Python indépendante)', () => {
    expect(Array.from({ length: 10 }, (_, n) => spinNumber('paryaj-paw-server-seed', 'paryaj-paw-client-seed', n))).toEqual([
      6, 13, 11, 28, 25, 10, 36, 17, 23, 7,
    ]);
  });

  it('sort chaque numéro de 0 à 36 sur 37 000 tours', () => {
    const counts = new Array<number>(POCKETS).fill(0);
    for (let nonce = 0; nonce < 37_000; nonce++) counts[spinNumber('a', 'b', nonce)]++;
    expect(counts.every((c) => c > 800 && c < 1200)).toBe(true);
  });

  it('donne la couleur du numéro', () => {
    expect(colorOf(0)).toBe('green');
    expect(colorOf(32)).toBe('red');
    expect(colorOf(15)).toBe('black');
  });

  it('repère les mises qui couvrent tout le tapis', () => {
    expect(coversAllPockets(normalizeBets([{ type: 'red', amountCents: 1000 }, { type: 'black', amountCents: 1000 }]))).toBe(false);
    expect(
      coversAllPockets(
        normalizeBets([
          { type: 'red', amountCents: 1000 },
          { type: 'black', amountCents: 1000 },
          { type: 'straight', numbers: [0], amountCents: 1000 },
        ]),
      ),
    ).toBe(true);
  });

  it('liste les mises extérieures', () => {
    expect(OUTSIDE_BET_TYPES).toHaveLength(8);
  });
});

describe('roulette américaine', () => {
  const AMERICAN = Array.from({ length: 38 }, (_, n) => n);

  function americanPositions(): Bet[] {
    const bets: Bet[] = [];
    for (const type of INSIDE_BET_TYPES) {
      for (const numbers of insidePositions(type, 'american')) bets.push({ type, numbers, amountCents: 1000 });
    }
    for (const index of [1, 2, 3]) {
      bets.push({ type: 'dozen', numbers: coverage('dozen', [], index, 'american')!, amountCents: 1000 });
      bets.push({ type: 'column', numbers: coverage('column', [], index, 'american')!, amountCents: 1000 });
    }
    for (const type of EVEN_MONEY_BET_TYPES) bets.push({ type, numbers: coverage(type)!, amountCents: 1000 });
    return bets;
  }

  it.each([
    ['straight', 38],
    ['split', 62],
    ['street', 14],
    ['corner', 22],
    ['top_line', 1],
    ['line', 11],
  ] as const)('%s : %i positions', (type, count) => {
    expect(insidePositions(type, 'american')).toHaveLength(count);
  });

  it('a 38 cases sur la roue, chacune une fois, et affiche 37 comme « 00 »', () => {
    expect([...WHEEL_ORDERS.american].sort((a, b) => a - b)).toEqual(AMERICAN);
    expect(pocketLabel(DOUBLE_ZERO)).toBe('00');
    expect(pocketLabel(17)).toBe('17');
    expect(colorOf(DOUBLE_ZERO)).toBe('green');
  });

  it('accepte 0-00, 0-1-2, 00-2-3 et la top line, refuse le carré 0-1-2-3 de l’européenne', () => {
    expect(coverage('split', [DOUBLE_ZERO, 0], undefined, 'american')).toEqual([0, DOUBLE_ZERO]);
    expect(coverage('street', [2, 3, DOUBLE_ZERO], undefined, 'american')).toEqual([2, 3, DOUBLE_ZERO]);
    expect(coverage('top_line', [0, DOUBLE_ZERO, 1, 2, 3], undefined, 'american')).toHaveLength(5);
    expect(coverage('corner', [0, 1, 2, 3], undefined, 'american')).toBeNull();
    expect(coverage('split', [0, 3], undefined, 'american')).toBeNull();
    expect(coverage('top_line', [0, 1, 2, 3, DOUBLE_ZERO])).toBeNull();
    expect(coverage('straight', [DOUBLE_ZERO])).toBeNull();
  });

  it('paie chaque position sur chacune des 38 cases : 36 / cases couvertes, sauf la top line (7×)', () => {
    for (const bet of americanPositions()) {
      for (const number of AMERICAN) {
        const multiple = bet.type === 'top_line' ? 7 : 36 / bet.numbers.length;
        expect(betReturn(bet, number, false)).toBe(bet.numbers.includes(number) ? bet.amountCents * multiple : 0);
      }
    }
  });

  it('perd toutes les mises extérieures sur 0 et 00', () => {
    for (const type of ['dozen', 'column', ...EVEN_MONEY_BET_TYPES] as BetType[]) {
      const numbers = coverage(type, [], type === 'dozen' || type === 'column' ? 1 : undefined, 'american')!;
      for (const zero of [0, DOUBLE_ZERO]) expect(betReturn({ type, numbers, amountCents: 1000 }, zero, false)).toBe(0);
    }
  });

  it('donne un RTP de 94,74 %, et 92,11 % pour la top line', () => {
    for (const bet of americanPositions()) {
      const average = AMERICAN.reduce((sum, n) => sum + betReturn(bet, n, false), 0) / 38 / bet.amountCents;
      expect(average).toBeCloseTo(bet.type === 'top_line' ? 35 / 38 : 36 / 38, 12);
    }
    expect(rtpPercent('straight', false, 'american')).toBeCloseTo(94.737, 3);
    expect(rtpPercent('top_line', false, 'american')).toBeCloseTo(92.105, 3);
  });

  it('refuse la piste et repère les mises qui couvrent les 38 cases', () => {
    expect(() => normalizeBets([{ type: 'tiers', amountCents: 1000 }], 'american')).toThrow();
    const nearlyAll = [
      { type: 'red' as const, amountCents: 1000 },
      { type: 'black' as const, amountCents: 1000 },
      { type: 'straight' as const, numbers: [0], amountCents: 1000 },
    ];
    expect(coversAllPockets(normalizeBets(nearlyAll, 'american'), 'american')).toBe(false);
    const all = normalizeBets([...nearlyAll, { type: 'straight', numbers: [DOUBLE_ZERO], amountCents: 1000 }], 'american');
    expect(coversAllPockets(all, 'american')).toBe(true);
  });

  it('tire les 38 cases de façon uniforme', () => {
    const counts = new Array<number>(38).fill(0);
    for (let nonce = 0; nonce < 38_000; nonce++) counts[spinNumber('a', 'b', nonce, 'american')]++;
    expect(counts.every((c) => c > 800 && c < 1200)).toBe(true);
  });
});
