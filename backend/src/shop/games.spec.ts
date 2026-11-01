import { drawRound } from './draw';
import {
  NUMBER_GAMES,
  ShopPaytables,
  TicketLine,
  WHEEL_ORDER,
  checkPicks,
  lineWin,
  numbersLine,
  rouletteKeyNumbers,
  rouletteLine,
  rtpReport,
  ticketWin,
  validatePaytables,
} from './games';

/** Valeurs de l'écran de la boutique (migration 003). */
const PAYTABLES: ShopPaytables = {
  keno: {
    '1': { '1': 3 },
    '2': { '2': 19 },
    '3': { '2': 2, '3': 25 },
    '4': { '2': 1, '3': 5, '4': 80 },
    '5': { '3': 3, '4': 15, '5': 400 },
    '6': { '3': 1, '4': 4, '5': 20, '6': 300 },
    '7': { '4': 2, '5': 10, '6': 60, '7': 800 },
    '8': { '4': 1, '5': 5, '6': 25, '7': 200, '8': 2000 },
    '9': { '0': 1, '4': 2, '5': 10, '6': 25, '7': 125, '8': 1000, '9': 5000 },
    '10': { '5': 2, '6': 10, '7': 50, '8': 300, '9': 2500, '10': 10000 },
  },
  luckysix: [10000, 7500, 5000, 2500, 1000, 500, 300, 200, 150, 100, 80, 60, 40, 30, 25, 20, 18, 16, 14, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
  luckyx: { single: 2.04, tiers: { '2': 4.61, '3': 10.6, '4': 24.7, '5': 58.7, '6': 142, '7': 350, '8': 881, '9': 2266, '10': 5959 } },
};

const line = (partial: Partial<TicketLine> & Pick<TicketLine, 'picks'>): TicketLine => ({
  label: 'x', odds: 1, stakeCents: 10000, possibleCents: 0, ...partial,
});

describe('roulette américaine', () => {
  it('couvre les 38 cases de la roue, chacune une fois', () => {
    expect(new Set(WHEEL_ORDER).size).toBe(38);
    expect(WHEEL_ORDER).toContain('00');
  });

  it('rejette les clés qui ne sont pas sur le tapis', () => {
    for (const key of ['n:37', 'n:000', 'n:01', 'st:2', 'st:37', 'six:34', 'six:2', 'col:4', 'doz:0', 'red:1', 'foo', 'n:']) {
      expect(rouletteKeyNumbers(key)).toBeNull();
    }
  });

  it('énumère les numéros de chaque position', () => {
    expect(rouletteKeyNumbers('n:00')).toEqual(['00']);
    expect(rouletteKeyNumbers('st:19')).toEqual(['19', '20', '21']);
    expect(rouletteKeyNumbers('six:31')).toEqual(['31', '32', '33', '34', '35', '36']);
    expect(rouletteKeyNumbers('col:1')).toHaveLength(12);
    expect(rouletteKeyNumbers('col:3')![0]).toBe('3');
    expect(rouletteKeyNumbers('doz:3')![0]).toBe('25');
    expect(rouletteKeyNumbers('red')).toHaveLength(18);
    expect(rouletteKeyNumbers('black')).toHaveLength(18);
    expect(rouletteKeyNumbers('basket')).toEqual(['0', '00', '1', '2', '3']);
  });

  it('paie selon la table standard et perd sur 0 et 00 pour les chances simples', () => {
    const win = (key: string, n: string) => lineWin('roulette', rouletteLine(key, 10000, true)!, { n }, PAYTABLES);
    expect(win('n:17', '17')).toBe(360000);
    expect(win('n:00', '00')).toBe(360000);
    expect(win('n:17', '18')).toBe(0);
    expect(win('st:19', '21')).toBe(120000);
    expect(win('six:1', '6')).toBe(60000);
    expect(win('col:2', '14')).toBe(30000);
    expect(win('doz:2', '13')).toBe(30000);
    expect(win('red', '1')).toBe(20000);
    expect(win('red', '0')).toBe(0);
    expect(win('even', '00')).toBe(0);
    expect(win('low', '18')).toBe(20000);
    expect(win('high', '18')).toBe(0);
    expect(win('basket', '00')).toBe(70000);
    expect(win('basket', '4')).toBe(0);
  });

  it('refuse le top line quand il est désactivé', () => {
    expect(rouletteLine('basket', 10000, false)).toBeNull();
  });

  it('chaque position gagne exactement pour les numéros qu\'elle couvre', () => {
    const keys = ['red', 'black', 'even', 'odd', 'low', 'high', 'col:1', 'col:2', 'col:3', 'doz:1', 'doz:2', 'doz:3', 'st:1', 'six:4', 'basket'];
    for (const key of keys) {
      const covered = rouletteKeyNumbers(key)!;
      for (const n of WHEEL_ORDER) {
        const won = lineWin('roulette', rouletteLine(key, 100, true)!, { n }, PAYTABLES) > 0;
        expect(won).toBe(covered.includes(n));
      }
    }
  });

  it('calcule la cote et le gain possible côté serveur', () => {
    const l = rouletteLine('doz:1', 2500, true)!;
    expect(l).toMatchObject({ label: 'Douzaine 1', odds: 3, possibleCents: 7500, picks: ['DOUZAINE 1'] });
    expect(rouletteLine('n:5', 100, true)!.picks).toEqual(['5']);
  });

  it('accepte les chevaux (17:1) et les carrés (8:1) standard, y compris avec 0 et 00', () => {
    // Chevaux : horizontal 1-4, vertical 1-2, et les chevaux du zéro ; 1-5 n'est pas un cheval.
    expect(rouletteKeyNumbers('sp:1-4')).toEqual(['1', '4']);
    expect(rouletteKeyNumbers('sp:1-2')).toEqual(['1', '2']);
    expect(rouletteKeyNumbers('sp:0-00')).toEqual(['0', '00']);
    expect(rouletteKeyNumbers('sp:3-00')).toEqual(['3', '00']);
    expect(rouletteKeyNumbers('sp:1-5')).toBeNull();
    expect(rouletteKeyNumbers('sp:3-4')).toBeNull(); // 3 est en haut de colonne : pas de cheval vertical
    // Carrés : coin bas-gauche, couvre m, m+1, m+3, m+4 ; 3 (haut de colonne) n'en est pas un.
    expect(rouletteKeyNumbers('co:1')).toEqual(['1', '2', '4', '5']);
    expect(rouletteKeyNumbers('co:32')).toEqual(['32', '33', '35', '36']);
    expect(rouletteKeyNumbers('co:3')).toBeNull();
    expect(rouletteKeyNumbers('co:33')).toBeNull();
    const win = (key: string, n: string) => lineWin('roulette', rouletteLine(key, 10000, true)!, { n }, PAYTABLES);
    expect(win('sp:1-4', '4')).toBe(180000); // 17:1 + mise
    expect(win('sp:1-4', '2')).toBe(0);
    expect(win('co:1', '5')).toBe(90000); //  8:1 + mise
    expect(win('co:1', '3')).toBe(0);
    expect(rouletteLine('sp:1-4', 100, true)!.picks).toEqual(['1', '4']);
  });

  it('avantage maison 5,26 % sur les mises intérieures (sauf top line à 7,89 %)', () => {
    const rtp = (line: string) => rtpReport(PAYTABLES, true).find((r) => r.game === 'roulette' && r.line === line)!.rtpPercent;
    for (const line of ['straight', 'split', 'street', 'corner', 'six']) expect(rtp(line)).toBeCloseTo(94.74, 2);
    expect(rtp('top line')).toBeCloseTo(92.11, 2); // pari à 5 numéros (0,00,1,2,3) : la pire mise de la roue
  });
});

describe('Keno 20/80', () => {
  it('paie selon le nombre de numéros trouvés', () => {
    const picks = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const k = numbersLine('keno', picks, 10000, PAYTABLES)!;
    const win = (draw: number[]) => lineWin('keno', k, { draw }, PAYTABLES);
    expect(win([1, 2, 3, 4, 10, 11])).toBe(20000);
    expect(win([20, 21, 22])).toBe(10000);
    expect(win([1, 2, 3, 21])).toBe(0);
    expect(win([1, 2, 3, 4, 5, 6, 7, 8, 9])).toBe(50_000_000);
  });

  it('affiche la cote maximale de la ligne', () => {
    expect(numbersLine('keno', [5, 1, 3], 100, PAYTABLES)).toMatchObject({ label: 'Keno 3 numéros', odds: 25, picks: [1, 3, 5] });
  });
});

describe('Lucky Six', () => {
  const picks = [1, 2, 3, 4, 5, 6];
  const l = numbersLine('luckysix', picks, 100, PAYTABLES)!;
  const draw = (sixthAt: number) => {
    const balls = Array.from({ length: 35 }, (_, i) => 7 + i); // 7…41, aucun des six numéros
    [1, 2, 3, 4, 5].forEach((p, i) => (balls[i] = p));
    if (sixthAt <= 35) balls[sixthAt - 1] = 6;
    return { draw: balls };
  };

  it('paie selon la position de la boule qui complète les six numéros', () => {
    expect(lineWin('luckysix', l, draw(6), PAYTABLES)).toBe(100 * 10000);
    expect(lineWin('luckysix', l, draw(7), PAYTABLES)).toBe(100 * 7500);
    expect(lineWin('luckysix', l, draw(20), PAYTABLES)).toBe(100 * 25);
    expect(lineWin('luckysix', l, draw(35), PAYTABLES)).toBe(100);
  });

  it('perd si un numéro ne sort pas dans les 35 boules', () => {
    expect(lineWin('luckysix', l, draw(36), PAYTABLES)).toBe(0);
  });
});

describe('Lucky X', () => {
  it('pari simple : gagne si le numéro est parmi les 36 boules tirées', () => {
    const l = numbersLine('luckyx', [9], 100, PAYTABLES)!;
    expect(l).toMatchObject({ label: 'Pari simple', odds: 2.04 });
    expect(lineWin('luckyx', l, { draw: [1, 2, 3, 4, 5, 9, 10] }, PAYTABLES)).toBe(204);
    expect(lineWin('luckyx', l, { draw: [1, 2, 3, 4, 5, 6, 10] }, PAYTABLES)).toBe(0);
  });

  it('N numéros : tous doivent être tirés', () => {
    const l = numbersLine('luckyx', [4, 8, 15], 100, PAYTABLES)!;
    expect(lineWin('luckyx', l, { draw: [15, 8, 4, 40] }, PAYTABLES)).toBe(1060);
    expect(lineWin('luckyx', l, { draw: [15, 8, 40] }, PAYTABLES)).toBe(0);
  });
});

describe('ticketWin', () => {
  it('additionne les lignes puis applique le plafond de gain', () => {
    const lines = [rouletteLine('n:1', 10000, true)!, rouletteLine('red', 10000, true)!];
    expect(ticketWin('roulette', lines, { n: '1' }, PAYTABLES, 10_000_000)).toBe(380000);
    expect(ticketWin('roulette', lines, { n: '1' }, PAYTABLES, 100000)).toBe(100000);
  });
});

describe('checkPicks', () => {
  it('contrôle le nombre, les doublons et les bornes de la grille', () => {
    expect(checkPicks('keno', [1, 80])).toBeNull();
    expect(checkPicks('keno', [])).toMatch(/1 à 10/);
    expect(checkPicks('keno', [1, 1])).toMatch(/double/);
    expect(checkPicks('keno', [81])).toMatch(/1 à 80/);
    expect(checkPicks('luckysix', [1, 2, 3, 4, 5])).toMatch(/6 à 6/);
    expect(checkPicks('luckyx', [0])).toMatch(/1 à 80/);
    expect(checkPicks('luckyx', [1.5])).toMatch(/1 à 80/);
  });
});

describe('tirage vérifiable', () => {
  const seed = 'a'.repeat(64);

  it('est déterministe pour une même graine, un même jour et un même tour', () => {
    for (const game of ['roulette', 'keno', 'luckysix', 'luckyx'] as const) {
      expect(drawRound(game, seed, '2026-11-01', 7)).toEqual(drawRound(game, seed, '2026-11-01', 7));
    }
    expect(drawRound('keno', seed, '2026-11-01', 7)).not.toEqual(drawRound('keno', seed, '2026-11-01', 8));
  });

  it('tire le bon nombre de boules distinctes dans la grille', () => {
    for (const game of ['keno', 'luckysix', 'luckyx'] as const) {
      const { draw } = drawRound(game, seed, '2026-11-01', 1) as { draw: number[] };
      expect(draw).toHaveLength(NUMBER_GAMES[game].drawn);
      expect(new Set(draw).size).toBe(draw.length);
      expect(draw.every((n) => n >= 1 && n <= NUMBER_GAMES[game].max)).toBe(true);
    }
    expect(WHEEL_ORDER).toContain((drawRound('roulette', seed, '2026-11-01', 1) as { n: string }).n);
  });

  it('couvre les 38 cases de la roulette de façon uniforme', () => {
    const counts = new Map<string, number>();
    const rounds = 38_000;
    for (let i = 1; i <= rounds; i++) {
      const { n } = drawRound('roulette', `seed-${i % 50}`, '2026-11-01', i) as { n: string };
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    expect(counts.size).toBe(38);
    const expected = rounds / 38;
    const chi2 = [...counts.values()].reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0);
    expect(chi2).toBeLessThan(65); // khi-deux à 37 degrés de liberté, seuil p = 0,003
  });
});

describe('RTP', () => {
  const rtp = (game: string, line: string) => rtpReport(PAYTABLES, true).find((r) => r.game === game && r.line === line)!.rtpPercent;

  it('roulette américaine : 94,74 % partout, 92,11 % sur le top line', () => {
    expect(rtp('roulette', 'straight')).toBeCloseTo(94.74, 2);
    expect(rtp('roulette', 'chance simple')).toBeCloseTo(94.74, 2);
    expect(rtp('roulette', 'top line')).toBeCloseTo(92.11, 2);
  });

  it('calcule exactement les lignes Keno, Lucky Six et Lucky X', () => {
    expect(rtp('keno', '1 numéros')).toBeCloseTo(75, 2);
    expect(rtp('keno', '2 numéros')).toBeCloseTo(114.24, 2);
    expect(rtp('luckysix', '6 numéros')).toBeCloseTo(85.9, 1);
    expect(rtp('luckyx', '1 numéro')).toBeCloseTo(91.8, 2);
    expect(rtp('luckyx', '2 boules')).toBeCloseTo(91.91, 1);
  });

  it('validatePaytables refuse une ligne qui rend plus que la mise', () => {
    expect(validatePaytables(PAYTABLES).join()).toMatch(/keno 2 numéros : RTP de 114/);
    const safe = { ...PAYTABLES, keno: { ...PAYTABLES.keno, '2': { '2': 15 } } };
    expect(validatePaytables(safe)).toEqual([]);
  });

  it('validatePaytables refuse une structure incomplète', () => {
    expect(validatePaytables({ ...PAYTABLES, luckysix: [1, 2, 3] }).join()).toMatch(/luckysix/);
    expect(validatePaytables({ ...PAYTABLES, keno: { '1': { '1': 3 } } }).join()).toMatch(/ligne 2 manquante/);
  });
});
