import { drawWithoutReplacement, uint32Stream } from '../fairness/provably-fair';
import { Paytable, RTP_MAX_PERCENT, RTP_MIN_PERCENT, binomial, hitProbability } from '../keno/paytable';

/** Jeux à tirage programmé, communs à tous les joueurs. */
export type DrawGame = 'lucky_six' | 'lucky_ten';
export const DRAW_GAMES: DrawGame[] = ['lucky_six', 'lucky_ten'];

/** 8 couleurs ; le numéro n a la couleur (n − 1) mod 8 (6 boules par couleur au Lucky Six, 10 au Lucky 10). */
export const BALL_COLORS = ['red', 'green', 'blue', 'purple', 'brown', 'yellow', 'orange', 'black'] as const;
export type BallColor = (typeof BALL_COLORS)[number];

export function ballColor(n: number): BallColor {
  return BALL_COLORS[(n - 1) % BALL_COLORS.length];
}

interface CommonConfig {
  intervalMinutes: number;
  /** Les mises ferment ce nombre de secondes avant le tirage. */
  closeBeforeSeconds: number;
  minStakeCents: number;
  maxStakeCents: number;
  maxDrawsPerTicket: number;
  /** Plafond de gain par ticket et par tirage. */
  maxPayoutCents: number;
  /** Au-dessus, le gain attend la validation de la finance avant d'être crédité. */
  reviewThresholdCents: number;
  /** Coefficient (× la mise) de chaque pari annexe. */
  sideBets: Record<string, number>;
}

export interface LuckySixConfig extends CommonConfig {
  /** Coefficients des positions 6 à 35 de la boule qui complète les 6 numéros. */
  positionCoefficients: number[];
}

export interface LuckyTenConfig extends CommonConfig {
  maxPicks: number;
  /** Même format que le Keno ; l'indice = numéros trouvés. */
  paytable: Paytable;
  /** Gain multiplié si le dernier numéro tiré fait partie des numéros trouvés. */
  luckyNumberMultiplier: number;
}

export type DrawConfig = LuckySixConfig | LuckyTenConfig;

/** Pari d'un ticket : les numéros du jeu principal (`six`, `numbers`) ou un pari annexe. */
export interface TicketBet {
  type: string;
  numbers?: number[];
  color?: BallColor;
}

export class InvalidTicketBetError extends Error {}

const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);
const twoDecimals = (v: number) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9;
const validCoefficient = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && twoDecimals(v);
const positiveInt = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
const inRtpRange = (rtp: number) => rtp >= RTP_MIN_PERCENT && rtp <= RTP_MAX_PERCENT;

/** Numéros distincts dans 1…max, triés ; null sinon. */
function distinctNumbers(numbers: unknown, count: [number, number], max: number): number[] | null {
  if (!Array.isArray(numbers) || numbers.length < count[0] || numbers.length > count[1]) return null;
  if (!numbers.every((n) => Number.isInteger(n) && n >= 1 && n <= max) || new Set(numbers).size !== numbers.length) {
    return null;
  }
  return [...(numbers as number[])].sort((a, b) => a - b);
}

/** Identiques aux configurations insérées par migrations/003_four_games.sql (RTP visé : 92,5 %). */
export const DEFAULT_LUCKY_SIX_CONFIG: LuckySixConfig = {
  intervalMinutes: 5,
  closeBeforeSeconds: 10,
  minStakeCents: 100,
  maxStakeCents: 100000,
  maxDrawsPerTicket: 10,
  maxPayoutCents: 100000000,
  reviewThresholdCents: 5000000,
  positionCoefficients: [
    10000, 7500, 5000, 2500, 905, 455, 270, 180, 135, 91, 82, 73, 63, 54, 45, 36, 27, 23, 18, 14, 9.1, 8.2, 7.3, 6.3, 5.4,
    4.5, 3.6, 2.7, 1.8, 0.9,
  ],
  sideBets: {
    first_even: 1.85,
    first_odd: 1.85,
    first_low: 1.85,
    first_high: 1.85,
    first_color: 7.4,
    sum5_under: 1.85,
    sum5_over: 1.85,
    more_even5: 1.85,
    more_odd5: 1.85,
  },
};

export const DEFAULT_LUCKY_TEN_CONFIG: LuckyTenConfig = {
  intervalMinutes: 5,
  closeBeforeSeconds: 10,
  minStakeCents: 100,
  maxStakeCents: 100000,
  maxDrawsPerTicket: 20,
  maxPicks: 10,
  maxPayoutCents: 100000000,
  reviewThresholdCents: 5000000,
  luckyNumberMultiplier: 2,
  paytable: {
    '1': [0, 3.5],
    '2': [0, 0.9, 8.6],
    '3': [0, 0, 2.6, 33],
    '4': [0, 0, 1.2, 5.9, 95],
    '5': [0, 0, 0.5, 2.8, 14, 375],
    '6': [0, 0, 0, 1.6, 6.5, 65, 1250],
    '7': [0, 0, 0, 0.9, 3.6, 18, 180, 4550],
    '8': [0, 0, 0, 0.4, 1.7, 8.7, 69, 865, 10000],
    '9': [0, 0, 0, 0.4, 1.3, 4.2, 26, 210, 2100, 10000],
    '10': [0.9, 0, 0, 0, 0.9, 2.6, 12, 85, 850, 4150, 10000],
  },
  sideBets: {
    more_even: 2.32,
    more_odd: 2.32,
    more_low: 2.32,
    more_high: 2.32,
    sum_under: 1.84,
    sum_over: 1.86,
    first_even: 1.85,
    first_odd: 1.85,
    first_color: 7.4,
  },
};

/** Table « du marché » du cahier des charges (positions 6 à 35) : RTP de 101,9 %, refusée par la validation. */
export const MARKET_LUCKY_SIX_COEFFICIENTS = [
  10000, 7500, 5000, 2500, 1000, 500, 300, 200, 150, 100, 90, 80, 70, 60, 50, 40, 30, 25, 20, 15, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
];

// Lucky Six -----------------------------------------------------------------------------------

const SIX_BALLS = 48;
const SIX_DRAWN = 35;
export const LUCKY_SIX_FIRST_POSITION = 6;

export const LUCKY_SIX_SIDE_BETS: Record<string, (balls: number[], bet: TicketBet) => boolean> = {
  first_even: (b) => b[0] % 2 === 0,
  first_odd: (b) => b[0] % 2 === 1,
  first_low: (b) => b[0] <= 24,
  first_high: (b) => b[0] >= 25,
  first_color: (b, bet) => ballColor(b[0]) === bet.color,
  sum5_under: (b) => sum(b.slice(0, 5)) <= 122,
  sum5_over: (b) => sum(b.slice(0, 5)) >= 123,
  more_even5: (b) => b.slice(0, 5).filter((n) => n % 2 === 0).length >= 3,
  more_odd5: (b) => b.slice(0, 5).filter((n) => n % 2 === 1).length >= 3,
};

/** Probabilité exacte de chaque pari annexe : symétrie n ↔ 49 − n pour les sommes, 6 boules sur 48 par couleur. */
const LUCKY_SIX_SIDE_PROBABILITY: Record<string, number> = {
  first_even: 0.5,
  first_odd: 0.5,
  first_low: 0.5,
  first_high: 0.5,
  first_color: 1 / 8,
  sum5_under: 0.5,
  sum5_over: 0.5,
  more_even5: 0.5,
  more_odd5: 0.5,
};

/** Probabilité que la 6e boule du joueur sorte en position k : ses 6 boules occupent 6 positions sur 48 au hasard. */
export function luckySixPositionProbability(position: number): number {
  return binomial(position - 1, 5) / binomial(SIX_BALLS, 6);
}

export function luckySixRtpPercent(coefficients: readonly number[]): number {
  return 100 * coefficients.reduce((s, c, i) => s + c * luckySixPositionProbability(i + LUCKY_SIX_FIRST_POSITION), 0);
}

// Lucky 10 -------------------------------------------------------------------------------------

const TEN_BALLS = 80;
const TEN_DRAWN = 20;

export const LUCKY_TEN_SIDE_BETS: Record<string, (balls: number[], bet: TicketBet) => boolean> = {
  more_even: (b) => b.filter((n) => n % 2 === 0).length > 10,
  more_odd: (b) => b.filter((n) => n % 2 === 1).length > 10,
  more_low: (b) => b.filter((n) => n <= 40).length > 10,
  more_high: (b) => b.filter((n) => n >= 41).length > 10,
  sum_under: (b) => sum(b) <= 810,
  sum_over: (b) => sum(b) >= 811,
  first_even: (b) => b[0] % 2 === 0,
  first_odd: (b) => b[0] % 2 === 1,
  first_color: (b, bet) => ballColor(b[0]) === bet.color,
};

let luckyTenSideProbabilities: Record<string, number> | undefined;

/** Probabilités exactes : loi hypergéométrique pour les majorités (10/10 perd), dénombrement des sommes de 20 numéros. */
function luckyTenSideProbability(type: string): number {
  if (!luckyTenSideProbabilities) {
    const tie = binomial(40, 10) ** 2 / binomial(TEN_BALLS, TEN_DRAWN);
    const maxSum = 1410;
    const ways = Array.from({ length: TEN_DRAWN + 1 }, () => new Float64Array(maxSum + 1));
    ways[0][0] = 1;
    for (let n = 1; n <= TEN_BALLS; n++) {
      for (let c = Math.min(n, TEN_DRAWN); c >= 1; c--) {
        for (let s = maxSum; s >= n; s--) ways[c][s] += ways[c - 1][s - n];
      }
    }
    const total = sum(Array.from(ways[TEN_DRAWN]));
    const over = sum(Array.from(ways[TEN_DRAWN].subarray(811))) / total;
    luckyTenSideProbabilities = {
      more_even: (1 - tie) / 2,
      more_odd: (1 - tie) / 2,
      more_low: (1 - tie) / 2,
      more_high: (1 - tie) / 2,
      sum_under: 1 - over,
      sum_over: over,
      first_even: 0.5,
      first_odd: 0.5,
      first_color: 1 / 8,
    };
  }
  return luckyTenSideProbabilities[type];
}

/** RTP d'une ligne de la table, bonus compris : avec h numéros trouvés, le dernier tiré en fait partie avec la probabilité h/20. */
export function luckyTenRtpPercent(row: readonly number[], bonus: number): number {
  const picks = row.length - 1;
  return 100 * row.reduce((s, m, hits) => s + m * hitProbability(picks, hits) * (1 + ((bonus - 1) * hits) / TEN_DRAWN), 0);
}

// Règles communes ------------------------------------------------------------------------------

interface GameRules {
  balls: number;
  drawn: number;
  sideBets: Record<string, (balls: number[], bet: TicketBet) => boolean>;
  sideBetProbability(type: string): number;
  mainType: string;
}

export const GAME_RULES: Record<DrawGame, GameRules> = {
  lucky_six: {
    balls: SIX_BALLS,
    drawn: SIX_DRAWN,
    sideBets: LUCKY_SIX_SIDE_BETS,
    sideBetProbability: (type) => LUCKY_SIX_SIDE_PROBABILITY[type],
    mainType: 'six',
  },
  lucky_ten: {
    balls: TEN_BALLS,
    drawn: TEN_DRAWN,
    sideBets: LUCKY_TEN_SIDE_BETS,
    sideBetProbability: luckyTenSideProbability,
    mainType: 'numbers',
  },
};

export function sideBetProbability(game: DrawGame, type: string): number {
  return GAME_RULES[game].sideBetProbability(type);
}

/** Boules du tirage, dans l'ordre de sortie : HMAC-SHA256(graine du tirage, "jeu:numéro du tirage:bloc"). */
export function drawBalls(game: DrawGame, serverSeed: string, drawId: number): number[] {
  const rules = GAME_RULES[game];
  return drawWithoutReplacement(uint32Stream(serverSeed, game, drawId), rules.balls, rules.drawn);
}

/** Pari vérifié et normalisé (numéros triés) ; lève InvalidTicketBetError s'il n'existe pas. */
export function normalizeTicketBet(game: DrawGame, bet: TicketBet, config: DrawConfig): TicketBet {
  const rules = GAME_RULES[game];
  if (bet.type === rules.mainType) {
    const count: [number, number] = game === 'lucky_six' ? [6, 6] : [1, (config as LuckyTenConfig).maxPicks];
    const numbers = distinctNumbers(bet.numbers, count, rules.balls);
    if (!numbers || bet.color !== undefined) throw new InvalidTicketBetError(bet.type);
    return { type: bet.type, numbers };
  }
  if (!(bet.type in rules.sideBets) || (bet.numbers !== undefined && bet.numbers.length > 0)) {
    throw new InvalidTicketBetError(bet.type);
  }
  if (bet.type === 'first_color') {
    if (!BALL_COLORS.includes(bet.color as BallColor)) throw new InvalidTicketBetError(bet.type);
    return { type: bet.type, color: bet.color };
  }
  if (bet.color !== undefined) throw new InvalidTicketBetError(bet.type);
  return { type: bet.type };
}

/** Coefficient gagné par un pari sur un tirage (0 s'il perd). */
export function betMultiplier(game: DrawGame, bet: TicketBet, balls: number[], config: DrawConfig): number {
  const rules = GAME_RULES[game];
  if (bet.type !== rules.mainType) return rules.sideBets[bet.type](balls, bet) ? config.sideBets[bet.type] : 0;

  const numbers = bet.numbers!;
  if (game === 'lucky_six') {
    const positions = numbers.map((n) => balls.indexOf(n));
    if (positions.includes(-1)) return 0;
    const completedAt = Math.max(...positions) + 1;
    return (config as LuckySixConfig).positionCoefficients[completedAt - LUCKY_SIX_FIRST_POSITION];
  }
  const ten = config as LuckyTenConfig;
  const drawn = new Set(balls);
  const hits = numbers.filter((n) => drawn.has(n)).length;
  const base = ten.paytable[String(numbers.length)][hits];
  const luckyHit = base > 0 && numbers.includes(balls[balls.length - 1]);
  return luckyHit ? Math.round(base * ten.luckyNumberMultiplier * 100) / 100 : base;
}

const INTERVALS = [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60];

/** Liste des problèmes ; vide si la configuration est utilisable. RTP de chaque pari entre 90 et 95 %. */
export function validateDrawConfig(game: DrawGame, config: DrawConfig): string[] {
  const errors: string[] = [];
  const c = config as unknown as Record<string, unknown>;
  if (!INTERVALS.includes(c.intervalMinutes as number)) errors.push(`intervalMinutes : ${INTERVALS.join(', ')}`);
  const closeMax = (Number(c.intervalMinutes) || 1) * 60 - 30;
  if (!positiveInt(c.closeBeforeSeconds) || (c.closeBeforeSeconds as number) < 5 || (c.closeBeforeSeconds as number) > closeMax) {
    errors.push(`closeBeforeSeconds : entier de 5 à ${closeMax}`);
  }
  if (!positiveInt(c.minStakeCents) || !positiveInt(c.maxStakeCents) || (c.maxStakeCents as number) < (c.minStakeCents as number)) {
    errors.push('minStakeCents et maxStakeCents : entiers, 0 < min ≤ max');
  }
  if (!positiveInt(c.maxDrawsPerTicket) || (c.maxDrawsPerTicket as number) > 50) errors.push('maxDrawsPerTicket : 1 à 50');
  if (!positiveInt(c.maxPayoutCents)) errors.push('maxPayoutCents : entier positif');
  if (!positiveInt(c.reviewThresholdCents)) errors.push('reviewThresholdCents : entier positif');

  const rules = GAME_RULES[game];
  const sideBets = (c.sideBets ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(sideBets)) if (!(key in rules.sideBets)) errors.push(`pari annexe inconnu : ${key}`);
  for (const type of Object.keys(rules.sideBets)) {
    const coefficient = sideBets[type];
    if (!validCoefficient(coefficient)) {
      errors.push(`${type} : coefficient positif à 2 décimales maximum`);
      continue;
    }
    const rtp = 100 * coefficient * rules.sideBetProbability(type);
    if (!inRtpRange(rtp)) errors.push(`${type} : RTP ${rtp.toFixed(2)} % hors de ${RTP_MIN_PERCENT}–${RTP_MAX_PERCENT} %`);
  }

  if (game === 'lucky_six') {
    const coefficients = c.positionCoefficients;
    if (!Array.isArray(coefficients) || coefficients.length !== SIX_DRAWN - LUCKY_SIX_FIRST_POSITION + 1 || !coefficients.every(validCoefficient)) {
      errors.push('positionCoefficients : 30 coefficients (positions 6 à 35) à 2 décimales maximum');
    } else {
      if (coefficients.some((v, i) => i > 0 && v > coefficients[i - 1])) {
        errors.push('positionCoefficients : une position plus tardive ne peut pas payer plus');
      }
      const rtp = luckySixRtpPercent(coefficients);
      if (!inRtpRange(rtp)) errors.push(`six : RTP ${rtp.toFixed(2)} % hors de ${RTP_MIN_PERCENT}–${RTP_MAX_PERCENT} %`);
    }
    return errors;
  }

  const maxPicks = c.maxPicks as number;
  const bonus = c.luckyNumberMultiplier;
  if (!Number.isInteger(maxPicks) || maxPicks < 1 || maxPicks > 10) errors.push('maxPicks : 1 à 10');
  if (!validCoefficient(bonus) || bonus < 1) errors.push('luckyNumberMultiplier : au moins 1, 2 décimales maximum');
  const paytable = (c.paytable ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(paytable)) {
    const picks = Number(key);
    if (!Number.isInteger(picks) || picks < 1 || picks > maxPicks) errors.push(`paytable : clé inattendue ${key}`);
  }
  for (let picks = 1; picks <= (Number.isInteger(maxPicks) ? Math.min(maxPicks, 10) : 0); picks++) {
    const row = paytable[String(picks)];
    if (!Array.isArray(row) || row.length !== picks + 1 || !row.every(validCoefficient)) {
      errors.push(`paytable ${picks} numéros : ${picks + 1} coefficients à 2 décimales maximum`);
      continue;
    }
    if (validCoefficient(bonus)) {
      const rtp = luckyTenRtpPercent(row, bonus);
      if (!inRtpRange(rtp)) errors.push(`paytable ${picks} numéros : RTP ${rtp.toFixed(2)} % hors de ${RTP_MIN_PERCENT}–${RTP_MAX_PERCENT} %`);
    }
  }
  return errors;
}

/** RTP théorique de chaque pari, pour la page des règles. */
export function rtpTable(game: DrawGame, config: DrawConfig): Record<string, number> {
  const rules = GAME_RULES[game];
  const side = Object.fromEntries(
    Object.keys(rules.sideBets).map((type) => [type, 100 * config.sideBets[type] * rules.sideBetProbability(type)]),
  );
  if (game === 'lucky_six') {
    return { six: luckySixRtpPercent((config as LuckySixConfig).positionCoefficients), ...side };
  }
  const ten = config as LuckyTenConfig;
  const main = Object.fromEntries(
    Object.entries(ten.paytable).map(([picks, row]) => [`numbers_${picks}`, luckyTenRtpPercent(row, ten.luckyNumberMultiplier)]),
  );
  return { ...main, ...side };
}
