import { uint32Stream, uniformInt } from '../fairness/provably-fair';

/** Européenne : 37 cases (0 à 36). Américaine : 38 cases, la case 37 représente le 00. */
export type Variant = 'european' | 'american';
export const VARIANTS: Variant[] = ['european', 'american'];
export const DOUBLE_ZERO = 37;

/** Nombre de cases de la roue européenne (conservé pour les appels sans variante). */
export const POCKETS = 37;

export function pocketCount(variant: Variant): number {
  return variant === 'american' ? 38 : 37;
}

/** Ordre des cases sur la roue, dans le sens horaire à partir du zéro. */
export const WHEEL_ORDERS: Record<Variant, number[]> = {
  european: [
    0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29,
    7, 28, 12, 35, 3, 26,
  ],
  american: [
    0, 28, 9, 26, 30, 11, 7, 20, 32, 17, 5, 22, 34, 15, 3, 24, 36, 13, 1, DOUBLE_ZERO, 27, 10, 25, 29, 12, 8, 19, 31, 18,
    6, 21, 33, 16, 4, 23, 35, 14, 2,
  ],
};
export const WHEEL_ORDER = WHEEL_ORDERS.european;

export const RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];

export type InsideBetType = 'straight' | 'split' | 'street' | 'corner' | 'top_line' | 'line';
export type OutsideBetType = 'dozen' | 'column' | 'red' | 'black' | 'even' | 'odd' | 'low' | 'high';
export type BetType = InsideBetType | OutsideBetType;
export type RacetrackBetType = 'voisins_du_zero' | 'tiers' | 'orphelins' | 'neighbors';

export const INSIDE_BET_TYPES: InsideBetType[] = ['straight', 'split', 'street', 'corner', 'top_line', 'line'];
export const OUTSIDE_BET_TYPES: OutsideBetType[] = ['dozen', 'column', 'red', 'black', 'even', 'odd', 'low', 'high'];
export const BET_TYPES: BetType[] = [...INSIDE_BET_TYPES, ...OUTSIDE_BET_TYPES];
export const RACETRACK_BET_TYPES: RacetrackBetType[] = ['voisins_du_zero', 'tiers', 'orphelins', 'neighbors'];

/** Types de mise qui existent sur le tapis de chaque variante (la top line n'existe qu'en américaine). */
export function betTypesOf(variant: Variant): BetType[] {
  return variant === 'american' ? BET_TYPES : BET_TYPES.filter((t) => t !== 'top_line');
}

/** Gain net pour 1 misé (tables européenne et américaine standard). */
export const PAYOUTS: Record<BetType, number> = {
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
};

/** Mises simples, concernées par La Partage. */
export const EVEN_MONEY_BET_TYPES: BetType[] = ['red', 'black', 'even', 'odd', 'low', 'high'];

/** Mise telle qu'envoyée par le client : une position du tapis ou une annonce de la piste. */
export interface BetRequest {
  type: BetType | RacetrackBetType;
  /** Numéros de la position (mises intérieures, 37 = 00) ou numéro central (`neighbors`). */
  numbers?: number[];
  /** 1, 2 ou 3 pour une douzaine ou une colonne. */
  index?: number;
  /** Montant sur la position ; pour une annonce de la piste, valeur d'un jeton. */
  amountCents: number;
}

/** Mise sur une position du tapis, avec les numéros qu'elle couvre. */
export interface Bet {
  type: BetType;
  numbers: number[];
  amountCents: number;
}

export class InvalidBetError extends Error {}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const RED = new Set(RED_NUMBERS);
const EVEN_MONEY = new Set<BetType>(EVEN_MONEY_BET_TYPES);

/** Chevaux entre deux numéros de 1 à 36 : côte à côte dans une rangée ou l'un sous l'autre. */
const TABLE_SPLITS: number[][] = range(1, 35).flatMap((a) =>
  [a + 1, a + 3].filter((b) => b <= 36 && (b === a + 3 || a % 3 !== 0)).map((b) => [a, b]),
);
const TABLE_STREETS: number[][] = range(0, 11).map((k) => range(3 * k + 1, 3 * k + 3));
const TABLE_CORNERS: number[][] = range(1, 32)
  .filter((n) => n % 3 !== 0)
  .map((n) => [n, n + 1, n + 3, n + 4]);
const LINES: number[][] = range(0, 10).map((k) => range(3 * k + 1, 3 * k + 6));

const POSITIONS: Record<Variant, Record<InsideBetType, number[][]>> = {
  european: {
    straight: range(0, 36).map((n) => [n]),
    split: [[0, 1], [0, 2], [0, 3], ...TABLE_SPLITS],
    street: [...TABLE_STREETS, [0, 1, 2], [0, 2, 3]],
    corner: [[0, 1, 2, 3], ...TABLE_CORNERS],
    top_line: [],
    line: LINES,
  },
  american: {
    straight: range(0, 37).map((n) => [n]),
    // 0 touche 1 et 2, 00 touche 2 et 3, et 0-00 se jouent à cheval.
    split: [[0, 1], [0, 2], [0, DOUBLE_ZERO], [2, DOUBLE_ZERO], [3, DOUBLE_ZERO], ...TABLE_SPLITS],
    street: [...TABLE_STREETS, [0, 1, 2], [2, 3, DOUBLE_ZERO]],
    corner: TABLE_CORNERS,
    top_line: [[0, 1, 2, 3, DOUBLE_ZERO]],
    line: LINES,
  },
};

/** Toutes les positions possibles d'une mise intérieure. */
export function insidePositions(type: InsideBetType, variant: Variant = 'european'): number[][] {
  return POSITIONS[variant][type];
}

/** Numéros couverts par une mise du tapis ; null si la combinaison n'existe pas sur cette variante. */
export function coverage(
  type: BetType,
  numbers: readonly number[] = [],
  index?: number,
  variant: Variant = 'european',
): number[] | null {
  const isInside = (INSIDE_BET_TYPES as string[]).includes(type);
  const usesIndex = type === 'dozen' || type === 'column';
  if ((!isInside && numbers.length > 0) || (!usesIndex && index !== undefined)) return null;

  if (isInside) {
    const sorted = [...numbers].sort((a, b) => a - b);
    const same = (position: number[]) => position.length === sorted.length && position.every((n, i) => n === sorted[i]);
    return insidePositions(type as InsideBetType, variant).some(same) ? sorted : null;
  }
  if (usesIndex && (index === undefined || ![1, 2, 3].includes(index))) return null;

  const all = range(1, 36);
  switch (type as OutsideBetType) {
    case 'dozen':
      return range(12 * (index! - 1) + 1, 12 * index!);
    case 'column':
      return all.filter((n) => n % 3 === index! % 3);
    case 'red':
      return all.filter((n) => RED.has(n));
    case 'black':
      return all.filter((n) => !RED.has(n));
    case 'even':
      return all.filter((n) => n % 2 === 0);
    case 'odd':
      return all.filter((n) => n % 2 === 1);
    case 'low':
      return range(1, 18);
    case 'high':
      return range(19, 36);
  }
}

/** Annonces de la piste européenne : [type, numéros, nombre de jetons]. */
type Announce = [BetType, number[], number][];

const VOISINS_DU_ZERO: Announce = [
  ['street', [0, 2, 3], 2],
  ['split', [4, 7], 1],
  ['split', [12, 15], 1],
  ['split', [18, 21], 1],
  ['split', [19, 22], 1],
  ['corner', [25, 26, 28, 29], 2],
  ['split', [32, 35], 1],
];
const TIERS: Announce = [
  ['split', [5, 8], 1],
  ['split', [10, 11], 1],
  ['split', [13, 16], 1],
  ['split', [23, 24], 1],
  ['split', [27, 30], 1],
  ['split', [33, 36], 1],
];
const ORPHELINS: Announce = [
  ['straight', [1], 1],
  ['split', [6, 9], 1],
  ['split', [14, 17], 1],
  ['split', [17, 20], 1],
  ['split', [31, 34], 1],
];

/** Déplie une annonce de la piste européenne en mises du tapis ; `chipCents` est la valeur d'un jeton. */
export function expandRacetrack(type: RacetrackBetType, chipCents: number, center?: number): Bet[] {
  if (type === 'neighbors') {
    if (center === undefined || !Number.isInteger(center) || center < 0 || center >= POCKETS) {
      throw new InvalidBetError('neighbors');
    }
    const at = WHEEL_ORDER.indexOf(center);
    return [-2, -1, 0, 1, 2].map((offset) => ({
      type: 'straight' as const,
      numbers: [WHEEL_ORDER[(at + offset + POCKETS) % POCKETS]],
      amountCents: chipCents,
    }));
  }
  const announce = { voisins_du_zero: VOISINS_DU_ZERO, tiers: TIERS, orphelins: ORPHELINS }[type];
  return announce.map(([betType, numbers, chips]) => ({ type: betType, numbers, amountCents: chips * chipCents }));
}

function isRacetrack(type: string): type is RacetrackBetType {
  return (RACETRACK_BET_TYPES as string[]).includes(type);
}

/** Mises du tapis prêtes à jouer : annonces dépliées, positions identiques additionnées. */
export function normalizeBets(requests: readonly BetRequest[], variant: Variant = 'european'): Bet[] {
  const merged = new Map<string, Bet>();
  const add = (bet: Bet) => {
    const key = `${bet.type}:${bet.numbers.join('-')}`;
    const existing = merged.get(key);
    if (existing) existing.amountCents += bet.amountCents;
    else merged.set(key, { ...bet, numbers: [...bet.numbers] });
  };

  for (const request of requests) {
    if (!Number.isSafeInteger(request.amountCents) || request.amountCents <= 0) {
      throw new InvalidBetError(request.type);
    }
    if (isRacetrack(request.type)) {
      // La piste suit l'ordre de la roue européenne : pas d'annonces en américaine.
      const numbers = request.numbers ?? [];
      const expected = request.type === 'neighbors' ? 1 : 0;
      if (variant !== 'european' || numbers.length !== expected || request.index !== undefined) {
        throw new InvalidBetError(request.type);
      }
      expandRacetrack(request.type, request.amountCents, numbers[0]).forEach(add);
      continue;
    }
    if (!(BET_TYPES as string[]).includes(request.type)) throw new InvalidBetError(request.type);
    const numbers = coverage(request.type, request.numbers, request.index, variant);
    if (!numbers) throw new InvalidBetError(request.type);
    add({ type: request.type, numbers, amountCents: request.amountCents });
  }
  return [...merged.values()];
}

/** Montant rendu pour une mise : mise + gain si elle gagne, moitié de la mise simple sur le zéro avec La Partage. */
export function betReturn(bet: Bet, number: number, laPartage: boolean): number {
  if (bet.numbers.includes(number)) return bet.amountCents * (PAYOUTS[bet.type] + 1);
  if (number === 0 && laPartage && EVEN_MONEY.has(bet.type)) return Math.floor(bet.amountCents / 2);
  return 0;
}

/** Vrai si les mises couvrent toutes les cases de la roue (signal anti-blanchiment). */
export function coversAllPockets(bets: readonly Bet[], variant: Variant = 'european'): boolean {
  return new Set(bets.flatMap((b) => b.numbers)).size === pocketCount(variant);
}

export function colorOf(number: number): 'green' | 'red' | 'black' {
  if (number === 0 || number === DOUBLE_ZERO) return 'green';
  return RED.has(number) ? 'red' : 'black';
}

/** Libellé affiché : « 00 » pour la case 37 de la roulette américaine. */
export function pocketLabel(number: number): string {
  return number === DOUBLE_ZERO ? '00' : String(number);
}

/** Numéro tiré, uniforme sur toutes les cases de la variante, à partir des graines du joueur (HMAC-SHA256). */
export function spinNumber(serverSeed: string, clientSeed: string, nonce: number, variant: Variant = 'european'): number {
  return uniformInt(uint32Stream(serverSeed, clientSeed, nonce), pocketCount(variant));
}

const COVERAGE_SIZE: Record<BetType, number> = {
  straight: 1,
  split: 2,
  street: 3,
  corner: 4,
  top_line: 5,
  line: 6,
  dozen: 12,
  column: 12,
  red: 18,
  black: 18,
  even: 18,
  odd: 18,
  low: 18,
  high: 18,
};

/**
 * RTP théorique en % d'une mise : 97,30 % en européenne (98,65 % pour une chance simple avec La Partage),
 * 94,74 % en américaine, 92,11 % pour la top line.
 */
export function rtpPercent(type: BetType, laPartage: boolean, variant: Variant = 'european'): number {
  const pockets = pocketCount(variant);
  const win = (COVERAGE_SIZE[type] / pockets) * (PAYOUTS[type] + 1);
  const partage = laPartage && EVEN_MONEY.has(type) ? 0.5 / pockets : 0;
  return 100 * (win + partage);
}
