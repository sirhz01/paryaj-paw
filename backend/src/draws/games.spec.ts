import { newClientSeed, newServerSeed } from '../fairness/provably-fair';
import {
  BALL_COLORS,
  DEFAULT_LUCKY_SIX_CONFIG,
  DEFAULT_LUCKY_TEN_CONFIG,
  GAME_RULES,
  LUCKY_SIX_SIDE_BETS,
  LUCKY_TEN_SIDE_BETS,
  MARKET_LUCKY_SIX_COEFFICIENTS,
  ballColor,
  betMultiplier,
  drawBalls,
  luckySixPositionProbability,
  luckySixRtpPercent,
  luckyTenRtpPercent,
  normalizeTicketBet,
  rtpTable,
  sideBetProbability,
  validateDrawConfig,
} from './games';

const SIX = DEFAULT_LUCKY_SIX_CONFIG;
const TEN = DEFAULT_LUCKY_TEN_CONFIG;

/** Tirage Lucky Six où les numéros donnés sortent dans cet ordre, suivis des autres boules. */
function sixBalls(first: number[]): number[] {
  const rest = Array.from({ length: 48 }, (_, i) => i + 1).filter((n) => !first.includes(n));
  return [...first, ...rest].slice(0, 35);
}

describe('tirages', () => {
  it('reste stable dans le temps (vecteurs recoupés avec une implémentation Python indépendante)', () => {
    expect(drawBalls('lucky_six', 'paryaj-paw-server-seed', 1)).toEqual([
      17, 31, 47, 10, 29, 4, 7, 14, 45, 21, 18, 27, 22, 36, 5, 23, 38, 12, 15, 42, 3, 13, 44, 25, 32, 37, 43, 16, 1, 19,
      6, 2, 46, 11, 41,
    ]);
    expect(drawBalls('lucky_ten', 'paryaj-paw-server-seed', 1)).toEqual([
      52, 59, 67, 22, 53, 33, 68, 19, 51, 30, 27, 11, 21, 1, 80, 18, 6, 41, 10, 23,
    ]);
  });

  it.each([
    ['lucky_six', 48, 35],
    ['lucky_ten', 80, 20],
  ] as const)('%s : %i boules, %i tirées, toutes distinctes', (game, balls, drawn) => {
    for (let id = 1; id <= 200; id++) {
      const result = drawBalls(game, 'graine', id);
      expect(result).toHaveLength(drawn);
      expect(new Set(result).size).toBe(drawn);
      expect(result.every((n) => n >= 1 && n <= balls)).toBe(true);
    }
  });

  it('répartit les couleurs : 6 boules chacune au Lucky Six, 10 au Lucky 10', () => {
    for (const color of BALL_COLORS) {
      expect(Array.from({ length: 48 }, (_, i) => i + 1).filter((n) => ballColor(n) === color)).toHaveLength(6);
      expect(Array.from({ length: 80 }, (_, i) => i + 1).filter((n) => ballColor(n) === color)).toHaveLength(10);
    }
  });
});

describe('Lucky Six', () => {
  it('somme à 1 les probabilités de position de la 6e boule (6 à 48) ; le ticket gagne dans 13,2 % des cas', () => {
    let total = 0;
    let win = 0;
    for (let k = 6; k <= 48; k++) {
      total += luckySixPositionProbability(k);
      if (k <= 35) win += luckySixPositionProbability(k);
    }
    expect(total).toBeCloseTo(1, 12);
    expect(win).toBeCloseTo(0.1323, 4);
  });

  it('donne 101,9 % de RTP avec la table du marché et 92,5 % avec la table par défaut', () => {
    expect(luckySixRtpPercent(MARKET_LUCKY_SIX_COEFFICIENTS)).toBeCloseTo(101.935, 3);
    expect(luckySixRtpPercent(SIX.positionCoefficients)).toBeCloseTo(92.521, 3);
    const errors = validateDrawConfig('lucky_six', { ...SIX, positionCoefficients: MARKET_LUCKY_SIX_COEFFICIENTS });
    expect(errors).toEqual([expect.stringMatching(/six : RTP 101\.94 %/)]);
  });

  it('paie selon la position de la boule qui complète les 6 numéros', () => {
    const numbers = [3, 8, 15, 22, 40, 47];
    expect(betMultiplier('lucky_six', { type: 'six', numbers }, sixBalls(numbers), SIX)).toBe(10000);
    const at = (position: number) => sixBalls([...numbers.slice(0, 5), ...Array.from({ length: 48 }, (_, i) => i + 1).filter((n) => !numbers.includes(n)).slice(0, position - 6), 47]);
    expect(betMultiplier('lucky_six', { type: 'six', numbers }, at(6), SIX)).toBe(10000);
    expect(betMultiplier('lucky_six', { type: 'six', numbers }, at(10), SIX)).toBe(905);
    expect(betMultiplier('lucky_six', { type: 'six', numbers }, at(35), SIX)).toBe(0.9);
    const missing = sixBalls([1, 2, 4, 5, 6, 7]).filter((n) => n !== 47);
    expect(betMultiplier('lucky_six', { type: 'six', numbers }, missing, SIX)).toBe(0);
  });

  it('règle chaque pari annexe sur la première boule ou les cinq premières', () => {
    // 1re boule 10 : paire et basse ; somme des 5 premières = 67 ; 3 impairs sur 5.
    const balls = sixBalls([10, 1, 3, 5, 48]);
    const color = ballColor(10);
    const win = (type: string, extra: object = {}) =>
      betMultiplier('lucky_six', { type, ...extra }, balls, SIX) > 0;
    expect(win('first_even')).toBe(true);
    expect(win('first_odd')).toBe(false);
    expect(win('first_low')).toBe(true);
    expect(win('first_high')).toBe(false);
    expect(win('first_color', { color })).toBe(true);
    expect(win('first_color', { color: BALL_COLORS.find((c) => c !== color) })).toBe(false);
    expect(win('sum5_under')).toBe(true);
    expect(win('sum5_over')).toBe(false);
    expect(win('more_odd5')).toBe(true);
    expect(win('more_even5')).toBe(false);
    expect(betMultiplier('lucky_six', { type: 'first_even' }, balls, SIX)).toBe(1.85);
  });
});

describe('Lucky 10', () => {
  it('garde chaque ligne de la table par défaut entre 90 et 95 %, bonus compris', () => {
    for (const row of Object.values(TEN.paytable)) {
      const rtp = luckyTenRtpPercent(row, TEN.luckyNumberMultiplier);
      expect(rtp).toBeGreaterThanOrEqual(90);
      expect(rtp).toBeLessThanOrEqual(95);
    }
    // Sans le calibrage, la table du Keno dépasserait 100 % avec le bonus × 2.
    expect(luckyTenRtpPercent([0, 0, 0, 0, 1.1, 3.3, 16, 110, 1100, 5400, 10000].map((m, i) => (i === 0 ? 1.1 : m)), 2)).toBeGreaterThan(100);
  });

  it('applique le bonus quand le dernier numéro tiré fait partie des numéros trouvés', () => {
    const numbers = [5, 9, 77];
    const filler = Array.from({ length: 80 }, (_, i) => i + 1).filter((n) => !numbers.includes(n));
    const bet = { type: 'numbers', numbers };
    expect(betMultiplier('lucky_ten', bet, [5, 9, ...filler.slice(0, 18)], TEN)).toBe(2.6);
    expect(betMultiplier('lucky_ten', bet, [5, ...filler.slice(0, 18), 9], TEN)).toBe(5.2);
    expect(betMultiplier('lucky_ten', bet, filler.slice(0, 20), TEN)).toBe(0);
  });

  it('fait perdre les deux côtés sur une égalité 10/10', () => {
    const tie = Array.from({ length: 20 }, (_, i) => i + 1); // 10 pairs, 10 impairs, tous ≤ 40
    expect(LUCKY_TEN_SIDE_BETS.more_even(tie, { type: 'more_even' })).toBe(false);
    expect(LUCKY_TEN_SIDE_BETS.more_odd(tie, { type: 'more_odd' })).toBe(false);
    expect(LUCKY_TEN_SIDE_BETS.more_low(tie, { type: 'more_low' })).toBe(true);
    expect(LUCKY_TEN_SIDE_BETS.sum_under(tie, { type: 'sum_under' })).toBe(true);
  });

  it('calcule la probabilité exacte des majorités et de la somme', () => {
    expect(sideBetProbability('lucky_ten', 'more_even')).toBeCloseTo(0.39838, 5);
    expect(sideBetProbability('lucky_ten', 'sum_over')).toBeCloseTo(0.4978, 4);
    expect(sideBetProbability('lucky_ten', 'sum_under') + sideBetProbability('lucky_ten', 'sum_over')).toBeCloseTo(1, 12);
  });
});

describe('paris annexes : probabilités exactes contre 100 000 tirages simulés', () => {
  it.each(['lucky_six', 'lucky_ten'] as const)('%s', (game) => {
    const sides = game === 'lucky_six' ? LUCKY_SIX_SIDE_BETS : LUCKY_TEN_SIDE_BETS;
    const wins = Object.fromEntries(Object.keys(sides).map((t) => [t, 0]));
    const seed = newServerSeed();
    const draws = 100_000;
    for (let id = 1; id <= draws; id++) {
      const balls = drawBalls(game, seed, id);
      for (const [type, wins_] of Object.entries(sides)) if (wins_(balls, { type, color: 'red' })) wins[type]++;
    }
    for (const type of Object.keys(sides)) {
      const p = sideBetProbability(game, type);
      expect(Math.abs(wins[type] / draws - p)).toBeLessThan(5 * Math.sqrt((p * (1 - p)) / draws));
    }
  });
});

describe('validation', () => {
  it('accepte les configurations par défaut et publie un RTP par pari', () => {
    expect(validateDrawConfig('lucky_six', SIX)).toEqual([]);
    expect(validateDrawConfig('lucky_ten', TEN)).toEqual([]);
    expect(Object.keys(rtpTable('lucky_six', SIX))).toHaveLength(1 + Object.keys(LUCKY_SIX_SIDE_BETS).length);
    expect(rtpTable('lucky_ten', TEN).numbers_10).toBeCloseTo(93.108, 2);
  });

  it('refuse un intervalle, une fermeture, des mises ou un pari annexe incohérents', () => {
    const errors = validateDrawConfig('lucky_six', {
      ...SIX,
      intervalMinutes: 7,
      closeBeforeSeconds: 2,
      minStakeCents: 500,
      maxStakeCents: 100,
      maxDrawsPerTicket: 0,
      sideBets: { ...SIX.sideBets, first_color: 9, jackpot: 2 },
    });
    expect(errors.length).toBeGreaterThanOrEqual(6);
    expect(errors.join()).toMatch(/pari annexe inconnu : jackpot/);
    expect(errors.join()).toMatch(/first_color : RTP 112\.50/);
  });

  it('refuse une table Lucky Six croissante et une table Lucky 10 incomplète', () => {
    const rising = [...SIX.positionCoefficients];
    rising[29] = 50;
    expect(validateDrawConfig('lucky_six', { ...SIX, positionCoefficients: rising }).join()).toMatch(/plus tardive/);
    const { '10': _, ...nine } = TEN.paytable;
    expect(validateDrawConfig('lucky_ten', { ...TEN, paytable: nine }).join()).toMatch(/paytable 10 numéros/);
    expect(validateDrawConfig('lucky_ten', { ...TEN, maxPicks: 9, paytable: nine })).toEqual([]);
  });
});

describe('normalizeTicketBet', () => {
  it('trie les numéros et garde la couleur des paris de couleur', () => {
    expect(normalizeTicketBet('lucky_six', { type: 'six', numbers: [9, 1, 48, 30, 2, 17] }, SIX).numbers).toEqual([1, 2, 9, 17, 30, 48]);
    expect(normalizeTicketBet('lucky_ten', { type: 'first_color', color: 'blue' }, TEN)).toEqual({ type: 'first_color', color: 'blue' });
    expect(normalizeTicketBet('lucky_ten', { type: 'numbers', numbers: [80] }, TEN).numbers).toEqual([80]);
  });

  it.each([
    ['lucky_six', { type: 'six', numbers: [1, 2, 3, 4, 5] }],
    ['lucky_six', { type: 'six', numbers: [1, 2, 3, 4, 5, 49] }],
    ['lucky_six', { type: 'six', numbers: [1, 1, 3, 4, 5, 6] }],
    ['lucky_six', { type: 'numbers', numbers: [1] }],
    ['lucky_six', { type: 'first_color' }],
    ['lucky_six', { type: 'first_even', color: 'red' }],
    ['lucky_ten', { type: 'numbers', numbers: Array.from({ length: 11 }, (_, i) => i + 1) }],
    ['lucky_ten', { type: 'more_even', numbers: [1] }],
    ['lucky_ten', { type: 'numbers', numbers: [5], color: 'red' }],
    ['lucky_ten', { type: 'jackpot' }],
  ] as const)('%s refuse %j', (game, bet) => {
    expect(() => normalizeTicketBet(game, bet as never, game === 'lucky_six' ? SIX : TEN)).toThrow();
  });

  it('connaît le jeu principal de chaque tirage', () => {
    expect(GAME_RULES.lucky_six.mainType).toBe('six');
    expect(GAME_RULES.lucky_ten.mainType).toBe('numbers');
    expect(newClientSeed()).toHaveLength(16);
  });
});
